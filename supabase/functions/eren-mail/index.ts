import { defer } from './memory.ts';
import { db, check, secret, hash, config, workspaceFor, ownedAccount, gmailClient, accountRules, cacheMessages, messageView, threadMessageViews, fullThread, mapLimit, revise, MailError, rate, REDIRECT, SITE, clearMailMemory, invalidateThread, cachedOverviews } from './services.ts';
import { oauthStart, oauthCallback, oauthFinish } from './oauth.ts';
import { enqueue, deliver, reconcile, tick, syncAccount } from './jobs.ts';
import { oneClickUnsubscribe } from './unsubscribe.ts';
import { TYPES, PRIORITIES, ACTIONS, validateEffects, validateAttachmentRefs, sanitizeRichBody, MAX_ATTACHMENT_BYTES, header, address, unsubscribeInfo, bodies, decodeBody, resolveAttachmentPart } from './domain.mjs';
const ACCOUNT_FIELDS='id,email,display_name,status,last_sync_at,sync_error';
const OUTBOX_FIELDS='id,account_id,to_address,subject,send_at,status,error,gmail_id,created_at,sent_at';
const origin=new URL(SITE).origin;
function response(data:any,status=200) {return Response.json(data,{status,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type,x-schedule-key','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}
const mustPost=(req:Request)=>{if(req.method!=='POST') throw new MailError(405,'Use POST for this action.');};
const id=(v:any)=>{if(!/^[a-zA-Z0-9_-]{1,200}$/.test(v||''))throw new MailError(400,'Invalid message ID.');return v;};
const uuid=(v:any,label='ID')=>{if(!/^[0-9a-f-]{36}$/i.test(v||''))throw new MailError(400,'Invalid '+label+'.');return String(v);};
const attachmentSecret=(workspace:string,draftId:string,attachmentId:string)=>'eren-mail:'+workspace+':draft:'+draftId+':attachment:'+attachmentId;
const attachmentRef=(a:any)=>({id:a.id,name:a.name,type:a.type,size:a.size});
function visible(v:any,filter:string) {
 const c=v.classification,l=v.labels;
 if(filter==='all')return true;
 if(filter==='blocked')return c.blocked;
 if(c.blocked)return false;
 if(filter==='low')return ['Low','Muted'].includes(c.priority);
 if(filter==='archived')return !l.includes('INBOX')&&!l.includes('DRAFT')&&!l.includes('TRASH')&&!l.includes('SPAM');
 if(filter==='sent')return l.includes('SENT');
 if(filter==='gmail-drafts')return l.includes('DRAFT');
 if(filter==='important')return c.priority==='High'&&l.includes('INBOX');
 if(filter==='reply')return c.action==='Needs reply'&&l.includes('INBOX');
 if(filter==='codes')return c.type==='Login Code';
 return l.includes('INBOX')&&c.priority!=='Muted';
}
export async function handle(req:Request) {
 const reqOrigin=req.headers.get('Origin');
 if(reqOrigin&&reqOrigin!==origin) return response({error:'Origin not allowed.'},403);
 if(req.method==='OPTIONS')return response({ok:true});
 const admin=db(),url=new URL(req.url),route=url.searchParams.get('route')||url.pathname.split('/eren-mail/')[1]||'';
 try {
  if(route==='oauth/callback'&&req.method==='GET')return await oauthCallback(admin,url);
  if(route==='worker') {
   mustPost(req);
   const key=req.headers.get('x-mail-cron')||'',expected=await secret(admin,'eren-mail:cron');
   if(!expected||key.length<32||await hash(key)!==await hash(expected)) throw new MailError(401,'Unauthorized worker.');
   return response(await tick(admin));
  }
  if(!['GET','POST'].includes(req.method))throw new MailError(405,'Method not allowed.');
  const workspace=await workspaceFor(req,admin);
  await rate(admin,workspace+':api',180);
  let input:any={};
  if(req.method==='POST') {
   if(!req.headers.get('Content-Type')?.includes('application/json'))throw new MailError(415,'Use JSON.');
   const raw=await req.text(),maxBody=route==='drafts/attachment'?12*1024*1024:150000;if(raw.length>maxBody)throw new MailError(413,'Request too large.');
   try{input=JSON.parse(raw);}catch{throw new MailError(400,'Invalid JSON.');}
   if(!input||typeof input!=='object'||Array.isArray(input))throw new MailError(400,'Invalid request.');
  }
  const get=(k:string)=>req.method==='GET'?url.searchParams.get(k):input[k];
  if(route==='bootstrap'&&req.method==='GET') {
   const [accounts,preferences]=await Promise.all([
    admin.from('eren_mail_accounts').select(ACCOUNT_FIELDS).eq('workspace_hash',workspace).neq('status','disconnecting').order('created_at').then(check),
    admin.from('eren_mail_preferences').select('preferences').eq('workspace_hash',workspace).maybeSingle().then(check),
   ]);
   const rows=accounts.length?check(await admin.from('eren_mail_messages').select('id,account_id,thread_id,sender,sender_name,subject,snippet,internal_date,labels,classification').in('account_id',accounts.map((a:any)=>a.id)).order('internal_date',{ascending:false}).limit(200)):[];
   return response({accounts,preferences:preferences?.preferences||{},messages:cachedOverviews(rows,accounts)});
  }
  if(route==='status'&&req.method==='GET') {
   const cfg=await config(admin,workspace),health=check(await admin.from('eren_mail_health').select('*').eq('id','worker').maybeSingle());
   return response({configured:!!(cfg.GOOGLE_CLIENT_ID&&cfg.GOOGLE_CLIENT_SECRET),aiConfigured:!!(cfg.GEMINI_API_KEY&&cfg.GEMINI_MODEL),model:cfg.GEMINI_MODEL||'',redirectUri:REDIRECT(),health,types:TYPES,priorities:PRIORITIES,actions:ACTIONS});
  }
  if(route==='settings') {
   mustPost(req);await rate(admin,workspace+':settings',10);
   const allowed=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GEMINI_API_KEY','GEMINI_MODEL'];
   for(const [key,value] of Object.entries(input)) {
    if(!allowed.includes(key)||typeof value!=='string'||value.length>4000)throw new MailError(400,'Invalid setting.');
    if(key==='GEMINI_MODEL'&&value&&!/^[\w.-]+$/.test(value))throw new MailError(400,'Invalid model name.');
    if(key==='GOOGLE_CLIENT_ID'&&value&&!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(value))throw new MailError(400,'Use a Google Web OAuth client ID.');
    if(value)await secret(admin,`eren-mail:${workspace}:config:${key}`,value);
   }
   clearMailMemory(workspace);return response({ok:true});
  }
  if(route==='oauth/start'){mustPost(req);await rate(admin,workspace+':oauth',10);return response(await oauthStart(admin,workspace,input));}
  if(route==='oauth/finish'){mustPost(req);const result=await oauthFinish(admin,workspace,input);clearMailMemory(workspace);return response(result);}
  if(route==='accounts'&&req.method==='GET')return response({accounts:check(await admin.from('eren_mail_accounts').select(ACCOUNT_FIELDS).eq('workspace_hash',workspace).neq('status','disconnecting').order('created_at'))});
  if(route==='accounts/rename') {mustPost(req);const a=await ownedAccount(admin,workspace,input.accountId);const name=String(input.name||'').trim().slice(0,80);if(!name)throw new MailError(400,'Enter a display name.');check(await admin.from('eren_mail_accounts').update({display_name:name}).eq('id',a.id));return response({ok:true});}
  if(route==='accounts/disconnect') {
   mustPost(req);const a=await ownedAccount(admin,workspace,input.accountId);
   const pending=check(await admin.from('eren_mail_outbox').select('id').eq('account_id',a.id).in('status',['pending','processing','sending','uncertain']).limit(1));
   if(pending.length)throw new MailError(409,'Cancel pending sends and resolve uncertain sends before disconnecting.');
   if(input.confirm!==a.email)throw new MailError(400,'Confirm the account email before disconnecting.');
   check(await admin.from('eren_mail_accounts').update({status:'disconnecting'}).eq('id',a.id));
   clearMailMemory(workspace);const token=await secret(admin,a.secret_name);
   let revoked=false;
   try{const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(10000)});revoked=r.ok;await r.body?.cancel();}catch{}
   const jobs=check(await admin.from('eren_mail_outbox').select('secret_name').eq('account_id',a.id));
   const drafts=check(await admin.from('eren_mail_drafts').select('id,secret_name').eq('account_id',a.id));
   for(const row of drafts){const stored=await secret(admin,row.secret_name);if(stored){try{for(const att of JSON.parse(stored).attachments||[])await secret(admin,attachmentSecret(workspace,row.id,att.id),null,true);}catch{}}}
   for(const row of [...jobs,...drafts])await secret(admin,row.secret_name,null,true);
   await secret(admin,a.secret_name,null,true);
   check(await admin.from('eren_mail_outbox').delete().eq('account_id',a.id));
   check(await admin.from('eren_mail_accounts').delete().eq('id',a.id));
   return response({ok:true,revoked});
  }
  if(route==='preferences') {
   if(req.method==='GET')return response({preferences:check(await admin.from('eren_mail_preferences').select('preferences').eq('workspace_hash',workspace).maybeSingle())?.preferences||{}});
   const preferences={account:String(input.account||'all').slice(0,50),filter:String(input.filter||'inbox').slice(0,30)};
   check(await admin.from('eren_mail_preferences').upsert({workspace_hash:workspace,preferences}));return response({ok:true});
  }
  if(route==='mail'&&req.method==='GET') {
   const filter=String(get('filter')||'inbox'),query=String(get('q')||'').slice(0,1000),which=get('accountId');
   const accounts=which&&which!=='all'?[await ownedAccount(admin,workspace,which)]:check(await admin.from('eren_mail_accounts').select('*').eq('workspace_hash',workspace).neq('status','disconnecting').order('created_at'));
   let cursors:any={};try{cursors=JSON.parse(String(get('cursor')||'{}'));}catch{throw new MailError(400,'Invalid mail page.');}
   if(!cursors||typeof cursors!=='object'||Array.isArray(cursors))throw new MailError(400,'Invalid cursor.');
   const results=await mapLimit(accounts,async(a:any)=>{
    if(cursors[a.id]===null)return {messages:[],next:null,accountId:a.id};
    try {
     const [api,rules]=await Promise.all([gmailClient(admin,a),accountRules(admin,a)]);
     const base=({inbox:'in:inbox',important:'in:inbox',reply:'in:inbox',codes:'',low:'',blocked:'',archived:'-in:inbox -in:drafts',sent:'in:sent','gmail-drafts':'in:drafts',all:''} as any)[filter]??'in:inbox';
     const params=new URLSearchParams({maxResults:'12',q:`${base} ${query} -in:trash -in:spam`.trim()});
     if(cursors[a.id]) params.set('pageToken',String(cursors[a.id]).slice(0,2000));
     const page=await api('threads?'+params);
     const cachedMessages:any[]=[],failures:any[]=[];
     const threadViews=await mapLimit(page.threads||[],async(t:any)=>{
      let full;try{full=await fullThread(api,t.id);}catch(e){failures.push({threadId:t.id,error:e instanceof MailError?e.message:'Could not read this thread.'});return null;}
      const msgs=full.messages||[];
      cachedMessages.push(...msgs);
      const views=threadMessageViews(msgs,rules,true);
      // For inbox keep the most recent incoming message as the classification source.
      const candidate=filter==='sent' ? ([...views].reverse().find((v:any)=>v.labels.includes('SENT'))||views.at(-1)) : ([...views].reverse().find((v:any)=>v.labels.includes('INBOX'))||views.at(-1));
      if(!candidate)return null;
      const labels=[...new Set<string>(views.flatMap((v:any)=>v.labels))];
      const overview={...candidate,labels,accountId:a.id,accountName:a.display_name,count:views.length,timestamp:Math.max(...views.map((v:any)=>v.timestamp))};
      delete overview.html;delete overview.text;delete overview.attachments;
      return visible(overview,filter)?overview:null;
     },8);
     defer(cacheMessages(admin,a,cachedMessages,rules));
     let fallback:any[]=[];
     if(failures.length) {
      const saved=await admin.from('eren_mail_messages').select('*').eq('workspace_hash',workspace).eq('account_id',a.id).in('thread_id',failures.map(f=>f.threadId));
      if(!saved.error)fallback=cachedOverviews(saved.data||[],[a]).filter(m=>visible(m,filter));
     }
     return {accountId:a.id,messages:[...threadViews.filter(Boolean),...fallback],next:page.nextPageToken||null,failures,error:failures.length?failures[0].error:undefined};
    }catch(e){return {accountId:a.id,messages:[],next:cursors[a.id]||'',error:e instanceof MailError?e.message:'Could not reach this account.'};}
   },2);
   return response({messages:results.flatMap(r=>r.messages).sort((a,b)=>b.timestamp-a.timestamp),cursor:Object.fromEntries(results.map(r=>[r.accountId,r.next])),hasMore:results.some(r=>!!r.next),errors:results.filter(r=>r.error).map(r=>({accountId:r.accountId,error:r.error,threadIds:r.failures?.map((f:any)=>f.threadId)}))});
  }
  if(route==='thread'&&req.method==='GET') {
   const a=await ownedAccount(admin,workspace,get('accountId'));
   const [api,rules]=await Promise.all([gmailClient(admin,a),accountRules(admin,a)]),t=await fullThread(api,id(get('threadId')),true);
   defer(cacheMessages(admin,a,t.messages||[],rules));
   return response({threadId:t.id,accountId:a.id,messages:threadMessageViews(t.messages||[],rules)});
  }
  if(route==='attachment'&&req.method==='GET') {
   const a=await ownedAccount(admin,workspace,get('accountId')),api=await gmailClient(admin,a),m=await api('messages/'+id(get('messageId'))+'?format=full');
   const part=bodies(m.payload).attachments.find((p:any)=>p.id===get('attachmentId')&&p.partId===get('partId'));
   if(!part)throw new MailError(404,'Attachment not found.');if(part.size>20*1024*1024)throw new MailError(413,'This attachment is over the 20 MB download limit.');
   let data;
   if(part.id) data=(await api(`messages/${m.id}/attachments/${encodeURIComponent(part.id)}`)).data;
   else {const find=(p:any):any=>p.partId===part.partId?p:(p.parts||[]).map(find).find(Boolean);data=find(m.payload)?.body?.data;}
   return response({data,filename:part.filename,mimeType:'application/octet-stream'});
  }
  if(route==='modify') {
   mustPost(req);const a=await ownedAccount(admin,workspace,input.accountId),api=await gmailClient(admin,a);
   const mods=({archive:{removeLabelIds:['INBOX']},unarchive:{addLabelIds:['INBOX']},read:{removeLabelIds:['UNREAD']},unread:{addLabelIds:['UNREAD']}} as any)[input.action];
   if(!mods)throw new MailError(400,'Invalid mail action.');
   await api('threads/'+id(input.threadId)+'/modify','POST',mods);invalidateThread(workspace,a.id,input.threadId);return response({ok:true});
  }
  if(route==='rules') {
   if(req.method==='GET')return response({rules:check(await admin.from('eren_mail_rules').select('*').eq('workspace_hash',workspace).order('created_at',{ascending:false}))});
   if(input.accountId)await ownedAccount(admin,workspace,input.accountId);
   if(!['sender','domain','list','thread','message'].includes(input.scope)||typeof input.value!=='string'||!input.value.trim()||input.value.length>500||input.typeMatch&&!TYPES.includes(input.typeMatch))throw new MailError(400,'Invalid rule scope.');
   let effects;try{effects=validateEffects(input.effects);}catch(e){throw new MailError(400,e.message);}
   if(['thread','message'].includes(input.scope)&&!input.accountId)throw new MailError(400,'Thread corrections need an account.');
   const value=['thread','message'].includes(input.scope)?input.value:input.value.trim().toLowerCase();
   const row=check(await admin.from('eren_mail_rules').insert({workspace_hash:workspace,account_id:input.accountId||null,scope:input.scope,match_value:value,type_match:input.typeMatch||null,effects}).select('*').single());
   return response({rule:row});
  }
  if(route==='rules/delete'){mustPost(req);check(await admin.from('eren_mail_rules').delete().eq('id',input.id).eq('workspace_hash',workspace));return response({ok:true});}
  if(route==='unsubscribe') {
   mustPost(req);const a=await ownedAccount(admin,workspace,input.accountId),api=await gmailClient(admin,a),m=await api('messages/'+id(input.messageId)+'?format=metadata&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post&metadataHeaders=List-ID');
   const info=unsubscribeInfo(m);
   if(input.confirm!==true||!info.oneClick)throw new MailError(400,'This message does not support confirmed one-click unsubscribe.');
   const result=await oneClickUnsubscribe(info.web);
   check(await admin.from('eren_mail_unsubscribes').upsert({account_id:a.id,message_id:m.id,status:result.status,updated_at:new Date().toISOString()}));
   return response(result);
  }
  if(route==='ai'){mustPost(req);await rate(admin,workspace+':ai',12);const a=await ownedAccount(admin,workspace,input.accountId);return response(await revise(admin,a,input));}
  if(route==='send') {
   mustPost(req);await rate(admin,workspace+':send',20);const a=await ownedAccount(admin,workspace,input.accountId);
   const job=await enqueue(admin,a,input);
   if(!input.sendAt&&job.status==='pending') {const jobs=check(await admin.rpc('eren_mail_claim',{p_id:job.id}));for(const claimed of jobs)await deliver(admin,claimed);}
   return response({job:check(await admin.from('eren_mail_outbox').select(OUTBOX_FIELDS).eq('id',job.id).eq('workspace_hash',workspace).single())});
  }
  if(route==='outbox'&&req.method==='GET')return response({jobs:check(await admin.from('eren_mail_outbox').select(OUTBOX_FIELDS).eq('workspace_hash',workspace).order('created_at',{ascending:false}).limit(100))});
  if(route.startsWith('outbox/')) {
   mustPost(req);const job=check(await admin.from('eren_mail_outbox').select('*').eq('id',input.id).eq('workspace_hash',workspace).maybeSingle());
   if(!job)throw new MailError(404,'Send not found.');
   if(route==='outbox/cancel') {
    const changed=check(await admin.from('eren_mail_outbox').update({status:'cancelled',locked_until:null}).eq('id',job.id).in('status',['pending','processing']).select('id').maybeSingle());
    if(!changed)throw new MailError(409,'This send has already started and cannot be cancelled.');
    return response({ok:true});
   }
   if(route==='outbox/check')return response({job:((j:any)=>Object.fromEntries(OUTBOX_FIELDS.split(',').map(k=>[k,j[k]])))(await reconcile(admin,job))});
   if(route==='outbox/restore') {
    if(!['cancelled','failed'].includes(job.status))throw new MailError(409,'Cancel the send first. Uncertain sends must be checked before restoring.');
    const stored=await secret(admin,job.secret_name);if(!stored)throw new MailError(404,'Draft no longer available.');
    const payload=JSON.parse(stored),draftId=crypto.randomUUID(),attachments=[];
    for(const a of payload.attachments||[]) {
     const ref=attachmentRef(a);await secret(admin,attachmentSecret(workspace,draftId,ref.id),JSON.stringify(a));attachments.push(ref);
    }
    const restored={id:draftId,accountId:job.account_id,to:payload.to||'',subject:payload.subject||'',body:payload.body||'',bodyHtml:payload.bodyHtml||'',attachments,threadId:null,replyMessageId:null};
    const name='eren-mail:'+workspace+':draft:'+draftId;await secret(admin,name,JSON.stringify(restored));
    check(await admin.from('eren_mail_drafts').upsert({id:draftId,workspace_hash:workspace,account_id:job.account_id,secret_name:name,subject:restored.subject,updated_at:new Date().toISOString()}));
    return response({draft:restored,note:'Restored as a new message. Attachments were restored too. To preserve a reply thread, reopen the thread instead.'});
   }
  }
  if(route==='drafts/attachment') {
   mustPost(req);await rate(admin,workspace+':attachment',30,60);
   const draftId=uuid(input.draftId,'draft ID'),attachmentId=uuid(input.id,'attachment ID');
   const row=check(await admin.from('eren_mail_drafts').select('*').eq('id',draftId).eq('workspace_hash',workspace).maybeSingle());
   if(!row)throw new MailError(409,'Save the draft before adding attachments.');
   const refs=validateAttachmentRefs([{id:attachmentId,name:input.name,type:input.type||'application/octet-stream',size:Number(input.size)}]),ref=refs[0];
   if(typeof input.data!=='string'||input.data.length>Math.ceil(MAX_ATTACHMENT_BYTES*4/3)+16)throw new MailError(400,'Attachment is too large.');
   const data=input.data.replace(/\s+/g,'');let bytes=0;try{bytes=atob(data).length;}catch{throw new MailError(400,'Attachment data is invalid.');}
   if(bytes!==ref.size||bytes>MAX_ATTACHMENT_BYTES)throw new MailError(400,'Attachment size does not match.');
   await secret(admin,attachmentSecret(workspace,draftId,attachmentId),JSON.stringify({...ref,data}));
   const stored=await secret(admin,row.secret_name);if(stored){const draft=JSON.parse(stored),attachments=validateAttachmentRefs([...(draft.attachments||[]).filter((a:any)=>a.id!==ref.id),ref]);await secret(admin,row.secret_name,JSON.stringify({...draft,attachments}));}
   return response({attachment:ref});
  }
  if(route==='drafts/attachment/delete') {
   mustPost(req);const draftId=uuid(input.draftId,'draft ID'),attachmentId=uuid(input.id,'attachment ID');
   const row=check(await admin.from('eren_mail_drafts').select('*').eq('id',draftId).eq('workspace_hash',workspace).maybeSingle());
   if(!row)throw new MailError(404,'Draft not found.');
   await secret(admin,attachmentSecret(workspace,draftId,attachmentId),null,true);
   const stored=await secret(admin,row.secret_name);if(stored){const draft=JSON.parse(stored),attachments=(draft.attachments||[]).filter((a:any)=>a.id!==attachmentId);await secret(admin,row.secret_name,JSON.stringify({...draft,attachments}));}
   return response({ok:true});
  }
  if(route==='drafts') {
   if(req.method==='GET')return response({drafts:check(await admin.from('eren_mail_drafts').select('id,account_id,subject,updated_at').eq('workspace_hash',workspace).order('updated_at',{ascending:false}).limit(100))});
   const a=await ownedAccount(admin,workspace,input.accountId),draftId=uuid(input.id,'draft ID');
   if(typeof input.body!=='string'||input.body.length>100000)throw new MailError(400,'Invalid draft.');
   const attachments=validateAttachmentRefs(input.attachments||[]),bodyHtml=input.bodyHtml==null?'':sanitizeRichBody(input.bodyHtml);
   const old=check(await admin.from('eren_mail_drafts').select('workspace_hash,secret_name').eq('id',draftId).maybeSingle());
   if(old&&old.workspace_hash!==workspace)throw new MailError(404,'Draft not found.');
   const name='eren-mail:'+workspace+':draft:'+draftId,previous=old?.secret_name?await secret(admin,old.secret_name):null;
   const draft={id:draftId,accountId:a.id,to:String(input.to||'').slice(0,2000),subject:String(input.subject||'').slice(0,500),body:input.body,bodyHtml,attachments,threadId:input.threadId||null,replyMessageId:input.replyMessageId||null};
   await secret(admin,name,JSON.stringify(draft));
   check(await admin.from('eren_mail_drafts').upsert({id:draftId,workspace_hash:workspace,account_id:a.id,secret_name:name,subject:draft.subject,updated_at:new Date().toISOString()}));
   if(previous){try{const keep=new Set(attachments.map((a:any)=>a.id));for(const att of JSON.parse(previous).attachments||[])if(!keep.has(att.id))await secret(admin,attachmentSecret(workspace,draftId,att.id),null,true);}catch{}}
   return response({ok:true});
  }
  if(route==='drafts/open'||route==='drafts/delete') {
   mustPost(req);const draft=check(await admin.from('eren_mail_drafts').select('*').eq('id',input.id).eq('workspace_hash',workspace).maybeSingle());
   if(!draft)throw new MailError(404,'Draft not found.');
   const stored=await secret(admin,draft.secret_name),value=stored?JSON.parse(stored):null;
   if(route==='drafts/open')return response({draft:value});
   for(const a of value?.attachments||[])await secret(admin,attachmentSecret(workspace,draft.id,a.id),null,true);
   await secret(admin,draft.secret_name,null,true);check(await admin.from('eren_mail_drafts').delete().eq('id',draft.id));return response({ok:true});
  }
  if(route==='sync'){mustPost(req);await rate(admin,workspace+':sync',3,60);const a=await ownedAccount(admin,workspace,input.accountId);return response(await syncAccount(admin,a));}
  throw new MailError(404,'Mail route not found.');
 }catch(e){return response({error:e instanceof MailError?e.message:'Mail is temporarily unavailable. Your draft has been preserved.',code:e instanceof MailError?e.code:'internal_error'},e instanceof MailError?e.status:503);}
}
if(import.meta.main)Deno.serve(handle);
