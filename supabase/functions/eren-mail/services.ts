import { createClient } from '@supabase/supabase-js';
import { safeHtml, inlineImages } from './render.ts';
export { safeHtml } from './render.ts';
import { threadCache } from './memory.ts';
let memoryEpoch=0;
const accessTokens=new Map<string,{value:string;until:number}>(),tokenRequests=new Map<string,Promise<any>>();
export function clearMailMemory(workspace='') {memoryEpoch++;for(const key of accessTokens.keys())if(key.startsWith(workspace))accessTokens.delete(key);for(const key of tokenRequests.keys())if(key.startsWith(workspace))tokenRequests.delete(key);threadCache.deletePrefix(workspace);}
export function invalidateThread(workspace:string,accountId:string,threadId:string) {threadCache.deletePrefix(`${workspace}:${accountId}:${threadId}:`);}
import { header, address, senderName, bodies, plainText, classify, unsubscribeInfo, b64url, AI_SYSTEM, sanitizeRichBody, normalizeAiRevision } from './domain.mjs';
export class MailError extends Error { constructor(public status:number, message:string, public code='mail_error') { super(message); } }
export const check = (result:any) => { if(result.error) throw new MailError(503,'Mail storage is temporarily unavailable. Your draft has not been discarded.'); return result.data; };
export const db = () => createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
export async function hash(s:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''); }
export const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const secret = async (admin:any,name:string,value:string|null=null,remove=false) => check(await admin.rpc('eren_mail_secret',{p_name:name,p_value:value,p_delete:remove}));
export async function config(admin:any,workspace:string,names=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GEMINI_API_KEY','GEMINI_MODEL']) {
 const values=await Promise.all(names.map(async n=>Deno.env.get('MAIL_'+n)||await secret(admin,`eren-mail:${workspace}:config:${n}`)||''));
 return Object.fromEntries(names.map((n,i)=>[n,values[i]]));
}
export const BASE = () => Deno.env.get('SUPABASE_URL')!+'/functions/v1/eren-mail';
export const SITE = 'https://weather-mister.github.io/ntu-mail-push/';
export const REDIRECT = () => BASE()+'/oauth/callback';
export const SCOPES='https://www.googleapis.com/auth/gmail.modify';
export async function rate(admin:any,bucket:string,limit=120,seconds=60) {
 if(!check(await admin.rpc('eren_mail_rate',{p_bucket:bucket,p_limit:limit,p_seconds:seconds}))) throw new MailError(429,'Too many requests. Please try again shortly.');
}
export async function workspaceFor(req:Request,admin:any) {
 const key=req.headers.get('x-schedule-key') || '';
 if(key.length<32 || key.length>200) throw new MailError(401,'Pair this device with your Eren schedule first.');
 const workspace=hash(key);
 const row=check(await admin.from('schedule_workspaces').select('workspace_hash,app_slug').eq('workspace_hash',await workspace).eq('app_slug','eren').maybeSingle());
 if(!row) throw new MailError(401,'This key cannot access Eren Mail.');
 return row.workspace_hash;
}
export async function ownedAccount(admin:any,workspace:string,id:string) {
 if(!/^[a-f0-9-]{36}$/i.test(id||'')) throw new MailError(400,'Select a connected account.');
 const a=check(await admin.from('eren_mail_accounts').select('*').eq('workspace_hash',workspace).eq('id',id).maybeSingle());
 if(!a || a.status==='disconnecting') throw new MailError(404,'Connected account not found.');
 return a;
}
export async function tokenRequest(params:Record<string,string>) {
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});
 const data=await r.json();
 if(!r.ok) throw new MailError(r.status===400?401:502,r.status===400?'Google authorization expired. Reconnect this account.':'Google authorization is temporarily unavailable.',data.error==='invalid_grant'?'reauthorize':'oauth_error');
 return data;
}
export async function gmailClient(admin:any,account:any) {
 const key=account.workspace_hash+':'+account.id+':'+account.secret_name;
 let token=accessTokens.get(key);
 if(!token||token.until<=Date.now()) {
  let pending=tokenRequests.get(key);
  if(!pending) {
   const epoch=memoryEpoch;
   pending=(async()=>{
    const [cfg,refresh]=await Promise.all([config(admin,account.workspace_hash,['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']),secret(admin,account.secret_name)]);
    if(!refresh)throw new MailError(401,'Reconnect this Gmail account.','reauthorize');
    let response;
    try{response=await tokenRequest({client_id:cfg.GOOGLE_CLIENT_ID,client_secret:cfg.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'});}
    catch(e){if(e.code==='reauthorize')check(await admin.from('eren_mail_accounts').update({status:'reauthorize',sync_error:'Reconnect account'}).eq('id',account.id));throw e;}
    const value={value:response.access_token,until:Date.now()+Math.max(0,Math.min(900,Number(response.expires_in)||300)-60)*1000};
    if(accessTokens.size>=64)accessTokens.delete(accessTokens.keys().next().value!);
    if(epoch===memoryEpoch)accessTokens.set(key,value);return value;
   })();tokenRequests.set(key,pending);
  }
  try{token=await pending;}finally{if(tokenRequests.get(key)===pending)tokenRequests.delete(key);}
 }
 let accessToken=token.value;
 const api=async (path:string,method='GET',body?:any,alreadyRefreshed=false) => {
  let refreshed=alreadyRefreshed;
  for(let attempt=0;;attempt++) {
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{method,headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok) {
   if(r.status===401&&accessTokens.get(key)?.value===accessToken)accessTokens.delete(key);
   // Keep only a known reason code, never Google's message/body/resource IDs.
   const error=await r.json().catch(()=>({})),candidate=error.error?.errors?.[0]?.reason||error.error?.status;
   const reasons=['authError','invalidCredentials','insufficientPermissions','accessNotConfigured','domainPolicy','rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','backendError','badRequest','invalidArgument','INVALID_ARGUMENT','PERMISSION_DENIED','UNAUTHENTICATED','RESOURCE_EXHAUSTED','INTERNAL','UNAVAILABLE'];
   const reason=reasons.includes(candidate)?candidate:'unknown';
   if(method==='GET'&&r.status===401&&!refreshed) {
    refreshed=true;
    const renewed=await gmailClient(admin,account);
    return renewed(path,method,body, true);
   }
   if(method==='GET'&&attempt<2&&(r.status===429||r.status>=500||r.status===403&&['rateLimitExceeded','userRateLimitExceeded'].includes(reason))) {
    await new Promise(resolve=>setTimeout(resolve,1000*2**attempt+Math.random()*250));continue;
   }
   const failure=new MailError(r.status,r.status===404?'Message no longer exists in Gmail.':r.status===429?'Gmail is rate limiting requests. Try again shortly.':`Gmail could not complete this request (${r.status}; ${reason}).`,'gmail_error');
   (failure as any).reason=reason;throw failure;
  }
  return r.status===204?{}:await r.json();
  }
 };
 return Object.assign(api,{mailAccountKey:account.workspace_hash+':'+account.id});
}
export async function accountRules(admin:any,account:any) {
 const rows=check(await admin.from('eren_mail_rules').select('*').eq('workspace_hash',account.workspace_hash).eq('enabled',true));
 return rows.filter((r:any)=>!r.account_id||r.account_id===account.id);
}
export function cachedOverviews(rows:any[],accounts:any[]) {
 const allowed=new Map(accounts.map(a=>[a.id,a])),threads=new Map<string,any[]>();
 for(const row of rows){if(!allowed.has(row.account_id))continue;const key=row.account_id+':'+row.thread_id;if(!threads.has(key))threads.set(key,[]);threads.get(key)!.push(row);}
 return [...threads.values()].map(rows=>{
  rows.sort((a,b)=>b.internal_date-a.internal_date);
  const row=rows.find(r=>r.labels.includes('INBOX'))||rows[0],account=allowed.get(row.account_id)!;
  return {id:row.id,threadId:row.thread_id,accountId:row.account_id,accountName:account.display_name,sender:row.sender_name,email:row.sender,subject:row.subject,snippet:row.snippet,timestamp:rows[0].internal_date,labels:[...new Set(rows.flatMap(r=>r.labels))],classification:row.classification,count:rows.length};
 }).filter(m=>!m.labels.includes('TRASH')&&!m.labels.includes('SPAM')).sort((a,b)=>b.timestamp-a.timestamp);
}
export function messageView(m:any,rules:any[],inherited:any={},externalImages=true,summaryOnly=false) {
 const content=bodies(m.payload), c=classify(m,rules,inherited), html=!summaryOnly&&content.html?safeHtml(content.html,{externalImages,inlineImages:inlineImages(m.payload)}):'';
 return {id:m.id,threadId:m.threadId,from:header(m,'From'),sender:senderName(header(m,'From')),email:address(header(m,'From')),to:header(m,'To'),cc:header(m,'Cc'),replyTo:header(m,'Reply-To')||header(m,'From'),subject:header(m,'Subject')||'(no subject)',timestamp:Number(m.internalDate),labels:m.labelIds||[],snippet:m.snippet||'',classification:c,unsubscribe:unsubscribeInfo(m),text:content.text||plainText(content.html),html,hasExternalImages:html.includes('data-external-image'),externalImages,attachments:content.attachments};
}
export function threadMessageViews(messages:any[],rules:any[],summaryOnly=false) {
 const views=messages.map(m=>messageView(m,rules,{},true,summaryOnly));
 const latest=[...views].reverse().find(v=>!v.labels.includes('DRAFT'));
 if(latest?.labels.includes('SENT')) {
  for(const v of views) {
   const explicit=rules.some(r=>v.classification.ruleIds.includes(r.id)&&r.effects.action);
   if(!explicit && v.classification.action==='Needs reply') v.classification.action='Waiting';
  }
 }
 return views;
}
export async function cacheMessages(admin:any,account:any,messages:any[],rules:any[]) {
 if(!messages.length) return;
 // Thread rules are the authoritative context inheritance; inferred context stays conservative.
 const rows=messages.map(m=>{const v=messageView(m,rules,{},false,true);return {account_id:account.id,id:m.id,thread_id:m.threadId,sender:v.email,sender_name:v.sender,subject:v.subject,snippet:v.snippet,internal_date:v.timestamp,labels:v.labels,classification:v.classification,list_id:v.unsubscribe.listId,updated_at:new Date().toISOString()};});
 check(await admin.from('eren_mail_messages').upsert(rows,{onConflict:'account_id,id'}));
}
export async function mapLimit(items:any[],fn:(v:any)=>Promise<any>,n=4) {
 const out=new Array(items.length); let index=0;
 await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(index<items.length){const i=index++;out[i]=await fn(items[i]);}}));return out;
}
export async function fullThread(api:any,id:string,loadImages=false) {
 if(!/^[a-zA-Z0-9_-]{1,200}$/.test(id||'')) throw new MailError(400,'Invalid thread.');
 const cacheKey=api.mailAccountKey?api.mailAccountKey+':'+id+':full':'';
 const ready=loadImages&&cacheKey?threadCache.get(cacheKey+'images'):undefined;if(ready)return ready;
 const cached=cacheKey?threadCache.get(cacheKey):undefined;
 const t=cached||await api('threads/'+encodeURIComponent(id)+'?format=full');
 if(!cached&&cacheKey)threadCache.set(cacheKey,t);
 t.messages=(t.messages||[]).sort((a:any,b:any)=>Number(a.internalDate)-Number(b.internalDate));
 // Gmail may put a large text-only body in a body attachment; retrieve it too.
 let imageBytes=0,imageCount=0;
 for(const m of t.messages||[]) {
  async function visit(p:any) {
   if(!p.filename && /^text\/(plain|html)$/.test(p.mimeType) && p.body?.attachmentId && !p.body.data) {
    const b=await api(`messages/${m.id}/attachments/${encodeURIComponent(p.body.attachmentId)}`);p.body.data=b.data;
   }
   // Only raster CID images, bounded across the thread. Never fetch sender URLs.
   const cid=(p.headers||[]).some((h:any)=>h.name.toLowerCase()==='content-id');
   if(loadImages && cid && /^image\/(png|jpeg|gif|webp)$/.test(p.mimeType||'') && p.body?.size<=2*1024*1024 && imageCount<24 && imageBytes+p.body.size<=8*1024*1024) {
    imageCount++;imageBytes+=p.body.size;
    if(p.body.attachmentId&&!p.body.data) {try{p.body.data=(await api(`messages/${m.id}/attachments/${encodeURIComponent(p.body.attachmentId)}`)).data;}catch{/* Text and other mail remain readable if an image fails. */}}
   }
   await mapLimit(p.parts||[],visit,4);
  }
  await visit(m.payload||{});
 }
 if(loadImages&&cacheKey)threadCache.set(cacheKey+'images',t);
 return t;
}
export async function revise(admin:any,account:any,input:any) {
 const cfg=await config(admin,account.workspace_hash);
 if(!cfg.GEMINI_API_KEY||!cfg.GEMINI_MODEL) throw new MailError(503,'Gemini is not configured. Your draft is safe; you can keep writing and send normally.');
 if(typeof input.instruction!=='string'||!input.instruction.trim()||input.instruction.length>4000||typeof input.body!=='string'||input.body.length>100000) throw new MailError(400,'Enter a shorter instruction or draft.');
 if(!/^[a-zA-Z0-9._-]+$/.test(cfg.GEMINI_MODEL)) throw new MailError(503,'Configure a valid Gemini model name.');
 let context:any[]=[];
 if(input.threadId) {
  const api=await gmailClient(admin,account),t=await fullThread(api,input.threadId);
  context=(t.messages||[]).slice(-6).map((m:any)=>{const c=bodies(m.payload);return {from:header(m,'From'),to:header(m,'To'),subject:header(m,'Subject'),body:(c.text||plainText(c.html)).slice(0,6000)};});
 }
 let currentHtml='';try{currentHtml=sanitizeRichBody(String(input.bodyHtml||''));}catch{currentHtml='';}
 const payload={threadContext:context,recipient:String(input.to||'').slice(0,2000),subject:String(input.subject||'').slice(0,500),currentEditableDraft:input.body,currentEditableHtml:currentHtml,latestUserInstruction:input.instruction};
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.GEMINI_MODEL}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':cfg.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:AI_SYSTEM}]},contents:[{role:'user',parts:[{text:JSON.stringify(payload)}]}],generationConfig:{temperature:0.3,maxOutputTokens:8192,responseMimeType:'application/json'}}),signal:AbortSignal.timeout(45000)});
 if(!r.ok) {await r.body?.cancel();throw new MailError(502,'Gemini is unavailable or its quota is exhausted. Your current draft has been preserved.');}
 const data=await r.json(),candidate=data.candidates?.[0];
 const text=(candidate?.content?.parts||[]).filter((p:any)=>!p.thought).map((p:any)=>p.text||'').join('').trim();
 if(!text||candidate.finishReason!=='STOP') throw new MailError(502,'Gemini did not return a complete revision. Your draft has been preserved.');
 let parsed:any;try{parsed=JSON.parse(text);}catch{throw new MailError(502,'Gemini returned an invalid revision. Your draft has been preserved.');}
 let revision;try{revision=normalizeAiRevision(parsed);}catch{throw new MailError(502,'Gemini returned unsafe or invalid formatting. Your draft has been preserved.');}
 if(!revision.body)throw new MailError(502,'Gemini returned an empty revision. Your draft has been preserved.');
 return revision;
}
