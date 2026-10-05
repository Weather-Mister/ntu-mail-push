import { createClient } from '@supabase/supabase-js';
import sanitizeHtml from 'sanitize-html';
import { header, address, senderName, bodies, plainText, classify, unsubscribeInfo, b64url, AI_SYSTEM } from './domain.mjs';
export class MailError extends Error { constructor(public status:number, message:string, public code='mail_error') { super(message); } }
export const check = (result:any) => { if(result.error) throw new MailError(503,'Mail storage is temporarily unavailable. Your draft has not been discarded.'); return result.data; };
export const db = () => createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
export async function hash(s:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''); }
export const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const secret = async (admin:any,name:string,value:string|null=null,remove=false) => check(await admin.rpc('eren_mail_secret',{p_name:name,p_value:value,p_delete:remove}));
export async function config(admin:any,workspace:string) {
 const names=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GEMINI_API_KEY','GEMINI_MODEL'];
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
 const cfg=await config(admin,account.workspace_hash), refresh=await secret(admin,account.secret_name);
 if(!refresh) throw new MailError(401,'Reconnect this Gmail account.','reauthorize');
 let token;
 try { token=await tokenRequest({client_id:cfg.GOOGLE_CLIENT_ID,client_secret:cfg.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'}); }
 catch(e) { if(e.code==='reauthorize') check(await admin.from('eren_mail_accounts').update({status:'reauthorize',sync_error:'Reconnect account'}).eq('id',account.id));throw e; }
 return async (path:string,method='GET',body?:any) => {
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok) {
   // Do not expose Google's response: it can contain mail data and credentials.
   await r.body?.cancel();
   throw new MailError(r.status,r.status===404?'Message no longer exists in Gmail.':r.status===429?'Gmail is rate limiting requests. Try again shortly.':'Gmail could not complete this request.','gmail_error');
  }
  return r.status===204?{}:await r.json();
 };
}
export async function accountRules(admin:any,account:any) {
 const rows=check(await admin.from('eren_mail_rules').select('*').eq('workspace_hash',account.workspace_hash).eq('enabled',true));
 return rows.filter((r:any)=>!r.account_id||r.account_id===account.id);
}
export function safeHtml(html:string) {
 const clean=sanitizeHtml(html,{
  allowedTags:['p','br','div','span','b','strong','i','em','u','s','blockquote','pre','code','h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tfoot','tr','td','th','hr','a'],
  allowedAttributes:{a:['href','title'],td:['colspan','rowspan'],th:['colspan','rowspan']},
  allowedSchemes:['https','http','mailto'],allowProtocolRelative:false,
  transformTags:{a:(_tag,attrs)=>({tagName:'a',attribs:{...attrs,target:'_blank',rel:'noopener noreferrer'}})},
  nonTextTags:['script','style','textarea','noscript','iframe','object','template'],
 });
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>body{font:14px/1.65 system-ui;color:#343330;margin:12px;overflow-wrap:anywhere}table{max-width:100%;border-collapse:collapse}td,th{padding:4px}pre{white-space:pre-wrap}a{color:#263f77}blockquote{border-left:2px solid #ddd;padding-left:12px;margin-left:0}</style></head><body>'+clean+'</body></html>';
}
export function messageView(m:any,rules:any[],inherited:any={}) {
 const content=bodies(m.payload), c=classify(m,rules,inherited);
 return {id:m.id,threadId:m.threadId,from:header(m,'From'),sender:senderName(header(m,'From')),email:address(header(m,'From')),to:header(m,'To'),cc:header(m,'Cc'),replyTo:header(m,'Reply-To')||header(m,'From'),subject:header(m,'Subject')||'(no subject)',timestamp:Number(m.internalDate),labels:m.labelIds||[],snippet:m.snippet||'',classification:c,unsubscribe:unsubscribeInfo(m),text:content.text||plainText(content.html),html:content.html?safeHtml(content.html):'',attachments:content.attachments};
}
export function threadMessageViews(messages:any[],rules:any[]) {
 const views=messages.map(m=>messageView(m,rules));
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
 const rows=messages.map(m=>{const v=messageView(m,rules);return {account_id:account.id,id:m.id,thread_id:m.threadId,sender:v.email,sender_name:v.sender,subject:v.subject,snippet:v.snippet,internal_date:v.timestamp,labels:v.labels,classification:v.classification,list_id:v.unsubscribe.listId,updated_at:new Date().toISOString()};});
 check(await admin.from('eren_mail_messages').upsert(rows,{onConflict:'account_id,id'}));
}
export async function mapLimit(items:any[],fn:(v:any)=>Promise<any>,n=4) {
 const out=new Array(items.length); let index=0;
 await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(index<items.length){const i=index++;out[i]=await fn(items[i]);}}));return out;
}
export async function fullThread(api:any,id:string) {
 if(!/^[a-zA-Z0-9_-]{1,200}$/.test(id||'')) throw new MailError(400,'Invalid thread.');
 const t=await api('threads/'+encodeURIComponent(id)+'?format=full');
 t.messages=(t.messages||[]).sort((a:any,b:any)=>Number(a.internalDate)-Number(b.internalDate));
 // Gmail may put a large text-only body in a body attachment; retrieve it too.
 for(const m of t.messages||[]) {
  async function visit(p:any) {
   if(!p.filename && /^text\/(plain|html)$/.test(p.mimeType) && p.body?.attachmentId && !p.body.data) {
    const b=await api(`messages/${m.id}/attachments/${encodeURIComponent(p.body.attachmentId)}`);p.body.data=b.data;
   }
   for(const child of p.parts||[]) await visit(child);
  }
  await visit(m.payload||{});
 }
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
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.GEMINI_MODEL}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':cfg.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:AI_SYSTEM}]},contents:[{role:'user',parts:[{text:JSON.stringify({threadContext:context,recipient:String(input.to||'').slice(0,2000),subject:String(input.subject||'').slice(0,500),currentEditableDraft:input.body,latestUserInstruction:input.instruction})}]}],generationConfig:{temperature:0.3,maxOutputTokens:8192}}),signal:AbortSignal.timeout(45000)});
 if(!r.ok) {await r.body?.cancel();throw new MailError(502,'Gemini is unavailable or its quota is exhausted. Your current draft has been preserved.');}
 const data=await r.json(), candidate=data.candidates?.[0];
 const body=(candidate?.content?.parts||[]).filter((p:any)=>!p.thought).map((p:any)=>p.text||'').join('').trim();
 if(!body||candidate.finishReason!=='STOP') throw new MailError(502,'Gemini did not return a complete revision. Your draft has been preserved.');
 return {body};
}
