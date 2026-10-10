import { check, secret, ownedAccount, gmailClient, cacheMessages, accountRules, mapLimit, fullThread, MailError, hash, invalidateThread } from './services.ts';
import { buildMime, validateDraft, header, MAX_ATTACHMENT_BYTES } from './domain.mjs';
import { draftAttachmentPath, outboxAttachmentPath, getAttachmentObject, putAttachmentObject, removeAttachmentObjects, encodeAttachmentData, decodeAttachmentData } from './attachments.ts';
export async function enqueue(admin:any,account:any,input:any) {
 let draft=validateDraft(input);
 if(!/^[0-9a-f-]{36}$/i.test(input.id||'')) throw new MailError(400,'Missing send request ID.');
 const sendAt=input.sendAt?new Date(input.sendAt):new Date();
 if(!Number.isFinite(sendAt.getTime())||sendAt.getTime()>Date.now()+366*86400000 || input.sendAt && sendAt.getTime()<Date.now()+30000) throw new MailError(400,'Schedule at least one minute in the future (up to one year).');
 let parent=null;
 if(input.threadId) {
  const api=await gmailClient(admin,account),t=await fullThread(api,input.threadId);
  const m=(t.messages||[]).find((m:any)=>m.id===input.replyMessageId);
  if(!m) throw new MailError(400,'The original reply message could not be found. Reopen the thread.');
  if(!header(m,'Message-ID')) throw new MailError(400,'The original has no Message-ID; compose a new message instead.');
  parent={subject:header(m,'Subject'),messageId:header(m,'Message-ID'),references:header(m,'References')};
 }
 const draftId=draft.attachments.length?( /^[0-9a-f-]{36}$/i.test(input.draftId||'')?String(input.draftId):null):null;
 if(draft.attachments.length&&!draftId)throw new MailError(400,'Attachments are not linked to a valid draft.');
 const payload={...draft,draftId,threadId:input.threadId||null,parent};
 const digest=await hash(JSON.stringify({account:account.id,...payload,sendAt:input.sendAt||null}));
 const existing=check(await admin.from('eren_mail_outbox').select('*').eq('id',input.id).maybeSingle());
 if(existing) {
  if(existing.workspace_hash!==account.workspace_hash||existing.payload_hash!==digest) throw new MailError(409,'This send request already exists with different text. Check Outbox before starting a new message.');
  return existing;
 }
 const copied:string[]=[];let total=0;
 try {
  for(const ref of draft.attachments) {
   let bytes:Uint8Array;
   try{bytes=await getAttachmentObject(admin,draftAttachmentPath(account.workspace_hash,draftId!,ref.id));}
   catch{
    const legacy=await secret(admin,'eren-mail:'+account.workspace_hash+':draft:'+draftId+':attachment:'+ref.id);
    if(!legacy)throw new MailError(400,'An attachment is missing. Remove it and add it again.');
    let old:any;try{old=JSON.parse(legacy);}catch{throw new MailError(400,'An attachment could not be read. Remove it and add it again.');}
    if(old.id!==ref.id||old.name!==ref.name||old.type!==ref.type||Number(old.size)!==ref.size||typeof old.data!=='string')throw new MailError(400,'An attachment changed unexpectedly. Remove it and add it again.');
    try{bytes=decodeAttachmentData(old.data);}catch{throw new MailError(400,'An attachment is corrupted. Remove it and add it again.');}
   }
   total+=bytes.length;if(bytes.length!==ref.size||total>MAX_ATTACHMENT_BYTES)throw new MailError(400,'Attachments are too large or corrupted.');
   const path=outboxAttachmentPath(account.workspace_hash,input.id,ref.id);
   try{await putAttachmentObject(admin,path,bytes,ref.type);}catch{throw new MailError(503,'Attachment storage is temporarily unavailable. Retry sending.');}
   copied.push(path);
  }
 }catch(e){try{await removeAttachmentObjects(admin,copied);}catch{}throw e;}
 const name=`eren-mail:${account.workspace_hash}:outbox:${input.id}`;
 const result=await admin.from('eren_mail_outbox').insert({id:input.id,workspace_hash:account.workspace_hash,account_id:account.id,to_address:draft.to,subject:parent?parent.subject:draft.subject,thread_id:input.threadId||null,secret_name:name,payload_hash:digest,rfc_message_id:`${input.id}@eren-mail.invalid`,send_at:sendAt.toISOString(),status:'processing',locked_until:new Date(Date.now()+120000).toISOString()}).select('*').single();
 if(result.error?.code==='23505') throw new MailError(409,'This send is already queued. Check Outbox.');
 const row=check(result);
 try { await secret(admin,name,JSON.stringify(payload));check(await admin.from('eren_mail_outbox').update({status:'pending',locked_until:null}).eq('id',input.id)); }
 catch(e) {try{await removeAttachmentObjects(admin,copied);}catch{}await admin.from('eren_mail_outbox').update({status:'failed',error:'Could not save send payload. Draft preserved on device.'}).eq('id',input.id);throw e;}
 return {...row,status:'pending'};
}
export async function deliver(admin:any,job:any) {
 let started=false;
 try {
  // Reject stale/cancelled claims before fetching secrets or attachment bytes.
  const active=check(await admin.from('eren_mail_outbox').select('id').eq('id',job.id).eq('status','processing').eq('attempts',job.attempts).gt('locked_until',new Date().toISOString()).maybeSingle());
  if(!active)return;
  const account=await ownedAccount(admin,job.workspace_hash,job.account_id),api=await gmailClient(admin,account);
  const stored=await secret(admin,job.secret_name);if(!stored) throw new MailError(400,'Send payload missing. Restore your draft and try again.');
  const payload=JSON.parse(stored),loaded=[];let total=0;
  for(const ref of payload.attachments||[]) {
   let bytes:Uint8Array;
   if(typeof ref.data==='string'){try{bytes=decodeAttachmentData(ref.data);}catch{throw new MailError(400,'An attachment is corrupted. Restore the draft and add it again.');}}
   else{try{bytes=await getAttachmentObject(admin,outboxAttachmentPath(job.workspace_hash,job.id,ref.id));}catch{throw new MailError(400,'An attachment is missing from the queued message. Restore the draft and add it again.');}}
   total+=bytes.length;if(bytes.length!==Number(ref.size)||total>MAX_ATTACHMENT_BYTES)throw new MailError(400,'Attachments are too large or corrupted.');
   loaded.push({...ref,data:encodeAttachmentData(bytes)});
  }
  const raw=buildMime({...payload,attachments:loaded},account.email,job.rfc_message_id,payload.parent);
  const ready=check(await admin.from('eren_mail_outbox').update({status:'sending',locked_until:new Date(Date.now()+120000).toISOString()}).eq('id',job.id).eq('status','processing').eq('attempts',job.attempts).gt('locked_until',new Date().toISOString()).select('id').maybeSingle());
  if(!ready) return;
  started=true;
  const sent=await api('messages/send','POST',{raw,...(payload.threadId?{threadId:payload.threadId}:{})});
  if(sent.threadId||payload.threadId)invalidateThread(account.workspace_hash,account.id,sent.threadId||payload.threadId);
  check(await admin.from('eren_mail_outbox').update({status:'sent',gmail_id:sent.id,sent_at:new Date().toISOString(),error:null,locked_until:null}).eq('id',job.id));
  await secret(admin,job.secret_name,null,true);
  try{await removeAttachmentObjects(admin,(payload.attachments||[]).map((a:any)=>outboxAttachmentPath(job.workspace_hash,job.id,a.id)));}catch{}
 } catch(e) {
  const definitive=started && e instanceof MailError && e.code==='gmail_error' && [400,401,403,404,413,429].includes(e.status);
  const transient=!started && (!(e instanceof MailError)||e.status>=500||e.status===429) && job.attempts<5;
  check(await admin.from('eren_mail_outbox').update({status:started&&!definitive?'uncertain':transient?'pending':'failed',send_at:transient?new Date(Date.now()+Math.min(30,2**job.attempts)*60000).toISOString():job.send_at,error:started&&!definitive?'Gmail may have accepted this message. Check status; it will not be resent automatically.':transient?'Temporary service issue; retry scheduled.':'Send failed. Open Outbox to recover the draft.',locked_until:null}).eq('id',job.id).eq('attempts',job.attempts).eq('status',started?'sending':'processing'));
 }
}
export async function reconcile(admin:any,job:any) {
 if(!['sending','uncertain'].includes(job.status)) return job;
 const account=await ownedAccount(admin,job.workspace_hash,job.account_id),api=await gmailClient(admin,account);
 const found=await api('messages?q='+encodeURIComponent('in:sent rfc822msgid:'+job.rfc_message_id));
 if(found.messages?.length) {
  check(await admin.from('eren_mail_outbox').update({status:'sent',gmail_id:found.messages[0].id,sent_at:new Date().toISOString(),error:null}).eq('id',job.id));
  const stored=await secret(admin,job.secret_name);if(stored){try{const payload=JSON.parse(stored);await removeAttachmentObjects(admin,(payload.attachments||[]).map((a:any)=>outboxAttachmentPath(job.workspace_hash,job.id,a.id)));}catch{}}
  await secret(admin,job.secret_name,null,true);return {...job,status:'sent'};
 }
 return {...job,error:'Not found in Sent yet. Gmail indexing can take time. Check again before composing a replacement.'};
}
const SYNC_BATCH_SIZE=3;
const BACKFILL_BATCH_SIZE=3;
export async function syncAccount(admin:any,account:any) {
 const lease=crypto.randomUUID(),now=new Date().toISOString();
 const locked=check(await admin.from('eren_mail_accounts').update({last_sync_attempt_at:new Date().toISOString(),sync_lock_id:lease,sync_lock_until:new Date(Date.now()+110000).toISOString()}).eq('id',account.id).or('sync_lock_until.is.null,sync_lock_until.lt.'+now).select('*').maybeSingle());
 if(!locked) return {busy:true};
 account=locked;
 try {
  const api=await gmailClient(admin,account),rules=await accountRules(admin,account);
  let ids:string[]=[],next:any={},history:any;
  if(account.history_id && !account.sync_pending) {
   try {history=await api('history?'+new URLSearchParams({startHistoryId:account.history_id,maxResults:'30',...(account.sync_page?{pageToken:account.sync_page}:{})}));}
   catch(e) {
    if(e.status!==404 && !(e.status===400 && account.sync_page)) throw e;
    account.history_id=null;account.backfill_page=null;account.initial_history=null;
    next={history_id:null,sync_page:null,backfill_page:null,initial_history:null};
   }
  }
  if(history) {
   ids=[...new Set<string>((history.history||[]).flatMap((h:any)=>[...(h.messages||[]),...(h.messagesAdded||[]).map((x:any)=>x.message),...(h.messagesDeleted||[]).map((x:any)=>x.message),...(h.labelsAdded||[]).map((x:any)=>x.message),...(h.labelsRemoved||[]).map((x:any)=>x.message)].map((m:any)=>m.id)))];
   next={...next,sync_page:history.nextPageToken||null,...(!history.nextPageToken?{history_id:history.historyId}:{})};
  }
  if(account.sync_pending) {
   ids=account.sync_pending.ids;
   next={...account.sync_pending.next,sync_pending:null};
  }
  // A single Gmail history event can contain thousands of label changes.
  // Persist the remainder; only advance the Gmail cursor after the entire page drains.
  if(ids.length>SYNC_BATCH_SIZE) {
   next={sync_pending:{ids:ids.slice(SYNC_BATCH_SIZE),next}};
   ids=ids.slice(0,SYNC_BATCH_SIZE);
  }
  const fetchMessages=async(messageIds:string[])=>mapLimit(messageIds,async(id:string)=>{
   try {const m=await api('messages/'+id+'?format=full');await cacheMessages(admin,account,[m],rules);}
   catch(e){if(e.status===404) check(await admin.from('eren_mail_messages').delete().eq('account_id',account.id).eq('id',id));else throw e;}
  });
  await fetchMessages(ids);
  // New-mail history is always processed before one bounded older-mail backfill page.
  // The initial cursor is active immediately, so large mailboxes don't delay new mail.
  if(!next.sync_pending && !next.sync_page && (!account.history_id || account.backfill_page)) {
   const baseline=account.history_id||(await api('profile')).historyId;
   let page;
   try {page=await api('messages?'+new URLSearchParams({maxResults:String(BACKFILL_BATCH_SIZE),q:'-in:trash -in:spam',...(account.backfill_page?{pageToken:account.backfill_page}:{})}));}
   catch(e) {if(e.status!==400||!account.backfill_page)throw e;page=await api('messages?maxResults='+BACKFILL_BATCH_SIZE+'&q=-in%3Atrash%20-in%3Aspam');}
   const older=(page.messages||[]).map((m:any)=>m.id);
   await fetchMessages(older);ids.push(...older);
   next={...next,backfill_page:page.nextPageToken||null,...(!account.history_id?{history_id:baseline}:{}),initial_history:null};
  }
  check(await admin.from('eren_mail_accounts').update({...next,last_sync_at:new Date().toISOString(),sync_error:null,status:'active'}).eq('id',account.id).eq('sync_lock_id',lease));
  return {synced:ids.length};
 } catch(e) {
  check(await admin.from('eren_mail_accounts').update({sync_error:e.code==='reauthorize'?'Reconnect account':'Sync paused; automatic retry next cycle.'}).eq('id',account.id).eq('sync_lock_id',lease));
  return {error:true};
 } finally {check(await admin.from('eren_mail_accounts').update({sync_lock_until:null,sync_lock_id:null}).eq('id',account.id).eq('sync_lock_id',lease));}
}
export async function tick(admin:any) {
 const started=new Date().toISOString();check(await admin.from('eren_mail_health').upsert({id:'worker',last_started_at:started}));
 check(await admin.from('eren_mail_outbox').update({status:'uncertain',error:'Delivery interrupted; check status before resending.'}).eq('status','sending').lt('locked_until',started));
 const jobs=check(await admin.rpc('eren_mail_claim',{}));
 let synced:any[]=[];
 // Keep each cron invocation deliberately small. A send (especially with attachments)
 // gets the whole Edge budget; otherwise sync exactly one account in a bounded batch.
 if(jobs.length) {
  await deliver(admin,jobs[0]);
 } else {
  const accounts=check(await admin.from('eren_mail_accounts').select('*').eq('status','active').order('last_sync_attempt_at',{ascending:true,nullsFirst:true}).limit(1));
  synced=await mapLimit(accounts,(a:any)=>syncAccount(admin,a),1);
 }
 const expired=check(await admin.from('eren_mail_oauth').select('state_hash,pending_secret').lt('expires_at',started).limit(20));
 for(const o of expired) {if(o.pending_secret) await secret(admin,o.pending_secret,null,true);check(await admin.from('eren_mail_oauth').delete().eq('state_hash',o.state_hash));}
 // Cleanup is maintenance, not part of the hot path.
 if(new Date().getUTCMinutes()%15===0)check(await admin.from('eren_mail_limits').delete().lt('started_at',new Date(Date.now()-86400000).toISOString()));
 const result={jobs:jobs.length,accounts:synced.length,errors:synced.filter(x=>x.error).length};
 check(await admin.from('eren_mail_health').update({last_finished_at:new Date().toISOString(),result}).eq('id','worker'));
 return result;
}
