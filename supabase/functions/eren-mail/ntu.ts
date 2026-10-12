import PostalMime from 'postal-mime';
import { MailError, secret, check, hash, cacheMessages, accountRules, messageView, mapLimit } from './services.ts';
import { b64url, decodeBody, plainText, header, address } from './domain.mjs';

const ROOT='https://wmail1.cc.ntu.edu.tw/rc/';
const MAX_RAW=30*1024*1024;
const sessions=new Map<string,Roundcube>();
const pendingSessions=new Map<string,Promise<Roundcube>>();
export function clearNtuMemory(workspace='') {for(const [key,s] of sessions)if(key.startsWith(workspace)){s.close();sessions.delete(key);}for(const key of pendingSessions.keys())if(key.startsWith(workspace))pendingSessions.delete(key);}

// Roundcube returns JSON containing UI commands, not a REST data model. Parse only
// the command name and JSON arguments. Never eval any provider JavaScript or HTML.
export function parseRoundcubeCommands(source:string) {
 if(typeof source!=='string'||source.length>4*1024*1024)throw new MailError(502,'NTU returned an invalid mailbox response.');
 const commands:{name:string;args:any[]}[]=[];let p=0;
 const whitespace=()=>{while(/\s/.test(source[p]||'')&&p<source.length)p++;};
 const value=()=>{
  whitespace();const start=p;let depth=0,quoted=false,escaped=false;
  for(;p<source.length;p++){
   const c=source[p];
   if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"'){quoted=true;continue;}
   if(c==='{'||c==='[')depth++;
   else if(c==='}'||c===']')depth--;
   else if(depth===0&&(c===','||c===')'))break;
  }
  if(quoted||depth!==0)throw new Error('Malformed JSON');
  return JSON.parse(source.slice(start,p));
 };
 try{
  while(p<source.length){whitespace();if(p===source.length)break;const m=/^this\.([a-zA-Z_][\w]*)\(/.exec(source.slice(p));if(!m)throw new Error('Non-data command');p+=m[0].length;const args=[];whitespace();
   if(source[p]!==')')for(;;){args.push(value());whitespace();if(source[p]===')')break;if(source[p++]!==',')throw new Error('Invalid separator');}
   if(source[p++]!==')')throw new Error('Invalid ending');whitespace();if(source[p++ ]!==';')throw new Error('Invalid terminator');commands.push({name:m[1],args});
  }
 }catch{throw new MailError(502,'NTU returned an unsupported mailbox response.');}
 return commands;
}
export function roundcubeEnvironment(html:string) {
 const marker='rcmail.set_env(';const start=html.indexOf(marker);if(start<0)return {};
 let p=start+marker.length,depth=0,quoted=false,escaped=false;
 for(let i=p;i<html.length;i++){
  const c=html[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(html.slice(p,i+1));}catch{return {};}}
 }
 return {};
}
function cleanText(value:any){return plainText(String(value??'')).replace(/&#x([0-9a-f]+);/gi,(_,s)=>String.fromCodePoint(Math.min(parseInt(s,16),0x10ffff))).replace(/&#039;|&apos;/g,"'").trim();}
function metadataAddress(html:any){const text=cleanText(html),title=String(html||'').match(/\btitle=["']([^"']+)["']/i)?.[1];const email=(cleanText(title||'').match(/[^\s<>"']+@[^\s<>"']+/)||text.match(/[^\s<>"']+@[^\s<>"']+/))?.[0];return email&&email!==text?`${text} <${email}>`:text;}
export function ntuDate(value:any,now=Date.now()) {
 const html=String(value||''),text=cleanText(html.match(/\btitle=["']([^"']+)["']/i)?.[1]||html);
 let s=text;const local=new Date(now+8*3600000).toISOString().slice(0,10);
 if(/^today\b/i.test(s))s=s.replace(/^today\s*,?\s*/i,local+' ');
 if(/^yesterday\b/i.test(s))s=s.replace(/^yesterday\s*,?\s*/i,new Date(now+8*3600000-86400000).toISOString().slice(0,10)+' ');
 if(/^\d\d?:\d\d/.test(s))s=local+' '+s;
 const weekday=s.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2}:\d{2}(?::\d{2})?)/i);if(weekday){const names=['sun','mon','tue','wed','thu','fri','sat'],today=new Date(now+8*3600000).getUTCDay(),delta=(today-names.indexOf(weekday[1].toLowerCase())+7)%7;s=new Date(now+8*3600000-delta*86400000).toISOString().slice(0,10)+' '+weekday[2];}
 const iso=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
 if(iso)s=`${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}T${iso[4].padStart(2,'0')}:${iso[5]}:${iso[6]||'00'}+08:00`;
 const parsed=Date.parse(s);return Number.isFinite(parsed)?parsed:0;
}
export function rawMessageId(raw:Uint8Array){
 const text=new TextDecoder().decode(raw.subarray(0,65536)).split(/\r?\n\r?\n/,1)[0].replace(/\r?\n[ \t]+/g,' ');
 return (text.match(/^Message-ID:[ \t]*([^\r\n]*)/mi)?.[1]||'').trim().replace(/^<|>$/g,'');
}
function validFolder(folder:any){if(typeof folder!=='string'||!folder||folder.length>200||/[\r\n\0]/.test(folder))throw new MailError(400,'Invalid NTU folder.');return folder;}
function logicalId(folder:string,uid:string){if(!/^\d{1,15}$/.test(uid))throw new MailError(502,'NTU returned an invalid message identifier.');return 'ntu_'+b64url(JSON.stringify([folder,uid]));}
function initialRef(id:string){try{const [mailbox,uid]=JSON.parse(decodeBody(id.slice(4)));validFolder(mailbox);if(!id.startsWith('ntu_')||!/^\d{1,15}$/.test(uid))throw new Error();return {mailbox,uid};}catch{throw new MailError(400,'Invalid NTU message.');}}
function labelsFor(folder:string,flags:any,s:Roundcube){return [...(folder==='INBOX'?['INBOX']:[]),...(folder===s.folders.sent?['SENT']:[]),...(folder===s.folders.drafts?['DRAFT']:[]),...(folder===s.folders.trash?['TRASH']:[]),...(folder===s.folders.junk?['SPAM']:[]),...(!flags.seen?['UNREAD']:[]),...(flags.flagged?['STARRED']:[])];}

class Roundcube {
 cookies=new Map<string,string>();env:any={};folders={sent:'Sent',drafts:'Drafts',trash:'Trash',junk:'Junk',archive:'Archive'};last=Date.now();private chain:Promise<any>=Promise.resolve();private closed=false;
 constructor(public credentials:{username:string;password:string}){}
 close(){this.closed=true;this.cookies.clear();this.credentials.password='';}
 serial<T>(work:()=>Promise<T>):Promise<T>{const pending=this.chain.catch(()=>{}).then(()=>{if(this.closed)throw new MailError(401,'Reconnect NTU Mail.','reauthorize');return work();});this.chain=pending.catch(()=>{});return pending;}
 async fetch(path:string,init:RequestInit={},limit=4*1024*1024):Promise<Response>{
  let url=new URL(path,ROOT);if(url.origin!==new URL(ROOT).origin||!url.pathname.startsWith('/rc/'))throw new MailError(400,'Invalid NTU request.');
  let method=init.method||'GET',body=init.body;
  for(let redirects=0;redirects<5;redirects++){
   const headers=new Headers(init.headers);if(this.cookies.size)headers.set('Cookie',[...this.cookies].map(([k,v])=>k+'='+v).join('; '));headers.set('User-Agent','Eren-Mail/1.0');
   let r:Response;try{r=await fetch(url,{...init,method,body,headers,redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new MailError(502,'Could not reach NTU Mail. Please retry.','ntu_unavailable');}
   for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';',1)[0],at=pair.indexOf('=');if(at>0){const key=pair.slice(0,at),value=pair.slice(at+1);if(value)this.cookies.set(key,value);else this.cookies.delete(key);}}
   if([301,302,303,307,308].includes(r.status)){
    const location=r.headers.get('location');await r.body?.cancel();if(!location)throw new MailError(502,'NTU returned an incomplete redirect.');
    const target=new URL(location,url);if(target.origin!==new URL(ROOT).origin||!target.pathname.startsWith('/rc/'))throw new MailError(502,'NTU returned an unexpected redirect.');
    url=target;if(r.status===303||[301,302].includes(r.status)&&method==='POST'){method='GET';body=undefined;}continue;
   }
   if(!r.ok){await r.body?.cancel();throw new MailError(r.status===404?404:502,r.status===404?'Message no longer exists in NTU Mail.':'NTU Mail is temporarily unavailable.','ntu_unavailable');}
   const length=Number(r.headers.get('content-length'));if(length>limit){await r.body?.cancel();throw new MailError(413,'This NTU message is over the download limit.');}
   // A stream limit is necessary when the provider omits Content-Length.
   const reader=r.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
   if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new MailError(413,'This NTU message is over the download limit.');}chunks.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   this.last=Date.now();return new Response(bytes,{status:r.status,headers:r.headers});
  }
  throw new MailError(502,'NTU returned too many redirects.');
 }
 async login(){
  const page=await (await this.fetch('index.php')).text(),inputs:Record<string,string>={};
  for(const tag of page.matchAll(/<input\b[^>]*>/gi)){const attrs=Object.fromEntries([...tag[0].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),cleanText(m[2])]));if(attrs.type==='hidden'&&attrs.name)inputs[attrs.name]=attrs.value||'';}
  if(!inputs._token)throw new MailError(502,'NTU sign-in is temporarily unavailable.');
  const data=new URLSearchParams({...inputs,_task:'login',_action:'login',_user:this.credentials.username,_pass:this.credentials.password,_timezone:'Asia/Taipei',_url:''});
  const html=await (await this.fetch('?_task=login',{method:'POST',body:data,headers:{'Content-Type':'application/x-www-form-urlencoded'}})).text();this.env=roundcubeEnvironment(html);
  if(this.env.task!=='mail'||!this.env.request_token)throw new MailError(401,'NTU sign-in failed. Check your student ID and mailbox password.','reauthorize');
  for(const [key,names] of Object.entries({sent:['sent_mailbox','sent_mbox'],drafts:['drafts_mailbox','drafts_mbox'],trash:['trash_mailbox','trash_mbox'],junk:['junk_mailbox','junk_mbox'],archive:['archive_mailbox','archive_mbox']}))for(const name of names)if(this.env[name]){this.folders[key]=validFolder(this.env[name]);break;}
 }
 async ajax(action:string,params:Record<string,string>={},post=false,task='mail'){
  const fields={_task:task,_action:action,_remote:'1',_token:this.env.request_token,...params};
  const headers={'X-Requested-With':'XMLHttpRequest','X-Roundcube-Request':this.env.request_token,...(post?{'Content-Type':'application/x-www-form-urlencoded'}:{})};
  const r=await this.fetch(post?'?'+new URLSearchParams({_task:task,_action:action}):'?'+new URLSearchParams(fields),{method:post?'POST':'GET',headers,...(post?{body:new URLSearchParams(fields)}:{})});
  let data:any;try{data=await r.json();}catch{throw new MailError(502,'NTU returned an unsupported mailbox response.');}
  if(data.action!==action)throw new MailError(401,'NTU session expired. Reconnect NTU Mail.','ntu_session_expired');
  const commands=parseRoundcubeCommands(data.exec||'');if(commands.some(c=>c.name==='display_message'&&c.args[1]==='error'))throw new MailError(502,'NTU could not complete this mail action.','ntu_action_failed');
  if(data.env)this.env={...this.env,...data.env};for(const c of commands)if(c.name==='set_env'&&c.args[0]&&typeof c.args[0]==='object')this.env={...this.env,...c.args[0]};
  return {env:data.env||{},commands};
 }
 async list(folder:string,page=1,q='',filter='',scope='base',headers='subject,from,to,text'){
  validFolder(folder);page=Math.max(1,Math.min(1000,Math.floor(page)||1));let result;
  if(q||filter){result=await this.ajax('search',{_mbox:folder,_q:q,_filter:filter||'ALL',_scope:scope,_headers:headers});if(page>1)result=await this.ajax('list',{_mbox:folder,_page:String(page),_search:this.env.search_request||''});}
  else result=await this.ajax('list',{_mbox:folder,_page:String(page)});
  const rows=result.commands.filter(c=>c.name==='add_message_row').map(c=>({uid:String(c.args[0]),columns:c.args[1]||{},flags:c.args[2]||{}}));
  return {rows,hasMore:page<Number(result.env.pagecount||this.env.pagecount||1),count:Number(result.env.messagecount??this.env.messagecount??0)};
 }
 async raw(ref:any){const params=new URLSearchParams({_task:'mail',_action:'viewsource',_mbox:validFolder(ref.mailbox),_uid:ref.uid,_save:'1',_token:this.env.request_token});const r=await this.fetch('?'+params,{},MAX_RAW);const bytes=new Uint8Array(await r.arrayBuffer());const head=new TextDecoder().decode(bytes.subarray(0,4000));if(!/^[A-Za-z][\w-]*\s*:/m.test(head)||/rcmail\.set_env\(/.test(head))throw new MailError(404,'Message no longer exists in NTU Mail.');return bytes;}
 async find(folder:string,messageId:string){
  const expected=String(messageId||'').trim().replace(/^<|>$/g,'');if(!expected||expected.length>1000||/[\r\n\0]/.test(expected))return [];
  // Roundcube does not support searching a Message-ID header directly. TEXT finds
  // candidates (including reply References); compare the actual root header so
  // reconciliation can never mistake a different message for this queued send.
  const matches=[];let page=1;
  do{const list=await this.list(folder,page,JSON.stringify(expected),'','base','text');for(const row of list.rows){if(!/^\d{1,15}$/.test(row.uid))continue;const bytes=await this.raw({mailbox:folder,uid:row.uid});if(rawMessageId(bytes)===expected)matches.push(row);}if(!list.hasMore)break;}while(++page<=5);
  return matches;
 }
 async ensureFolder(folder:string){
  if(Object.hasOwn(this.env.mailboxes||{},folder))return;
  // Folder saving is a framed form action, not a remote AJAX action. Refresh the
  // actual mailbox environment afterwards; never assume creation succeeded.
  const fields={_task:'settings',_action:'save-folder',_name:folder,_parent:'',_mbox:'',_type:'mail',_framed:'1',_token:this.env.request_token};
  await this.fetch('?_task=settings&_action=save-folder',{method:'POST',body:new URLSearchParams(fields),headers:{'Content-Type':'application/x-www-form-urlencoded'}});
  const html=await(await this.fetch('?_task=mail')).text(),env=roundcubeEnvironment(html);
  if(env.task!=='mail'||!Object.hasOwn(env.mailboxes||{},folder))throw new MailError(502,'NTU could not create the destination folder. Please retry.','ntu_action_failed');
  this.env={...this.env,...env};

 }
}
export async function ntuSession(admin:any,account:any):Promise<Roundcube>{
 const key=account.workspace_hash+':'+account.id;const current=sessions.get(key);if(current&&Date.now()-current.last<180000)return current;
 let pending=pendingSessions.get(key);if(!pending){pending=(async()=>{const value=await secret(admin,account.secret_name);let credentials:any;try{credentials=JSON.parse(value);}catch{}if(!credentials?.username||!credentials?.password)throw new MailError(401,'Reconnect NTU Mail.','reauthorize');const session=new Roundcube(credentials);await session.login();if(sessions.size>=20){const oldest=sessions.keys().next().value!;sessions.get(oldest)?.close();sessions.delete(oldest);}sessions.set(key,session);return session;})();pendingSessions.set(key,pending);}
 try{return await pending;}catch(e){if(e.code==='reauthorize')check(await admin.from('eren_mail_accounts').update({status:'reauthorize',sync_error:'Reconnect NTU Mail'}).eq('id',account.id));throw e;}finally{if(pendingSessions.get(key)===pending)pendingSessions.delete(key);}
}
async function reference(admin:any,account:any,id:string){const row=check(await admin.from('eren_mail_messages').select('provider_ref,labels').eq('account_id',account.id).eq('id',id).maybeSingle());const ref=row?.provider_ref||initialRef(id);validFolder(ref.mailbox);if(!/^\d{1,15}$/.test(ref.uid||''))throw new MailError(404,'This message is still being located in NTU Mail. Refresh the mailbox.');return {...ref,labels:row?.labels||[]};}
async function metadata(admin:any,account:any,s:Roundcube,rows:any[],folder:string){
 const refs=check(await admin.from('eren_mail_messages').select('id,provider_ref,internal_date,snippet,classification').eq('account_id',account.id).limit(5000)),byLocation=new Map<string,any>();for(const row of refs)if(row.provider_ref)byLocation.set(row.provider_ref.mailbox+':'+row.provider_ref.uid,row);
 return rows.map((row,index)=>{
  const flags=row.flags,mailbox=validFolder(flags.mbox||folder),uid=row.uid.endsWith('-'+mailbox)?row.uid.slice(0,-mailbox.length-1):row.uid;if(!/^\d{1,15}$/.test(uid))throw new MailError(502,'NTU returned an unsupported message identifier.');
  const old=byLocation.get(mailbox+':'+uid),id=old?.id||logicalId(mailbox,uid),subject=cleanText(row.columns.subject)||'(no subject)',from=metadataAddress(row.columns.from||row.columns.fromto),to=metadataAddress(row.columns.to),date=ntuDate(row.columns.date)||old?.internal_date||0;
  return {id,threadId:id,metadataOnly:true,cachedClassification:old?.classification,cachedSnippet:old?.snippet,labelIds:labelsFor(mailbox,flags,s),internalDate:String(date),snippet:'',providerRef:{...old?.provider_ref,mailbox,uid},payload:{headers:[{name:'Subject',value:subject},{name:'From',value:from},{name:'To',value:to}],mimeType:'text/plain',body:{data:''}},hasAttachments:!/^text\//.test(flags.ctype||'text/plain')};
 });
}
export async function ntuList(admin:any,account:any,filter='inbox',query='',cursor=''){
 const s=await ntuSession(admin,account);return await s.serial(async()=>{
  let page=1,index=0;try{if(cursor){const parsed=JSON.parse(decodeBody(cursor));page=parsed.page;index=parsed.index;if(!Number.isInteger(page)||page<1||page>1000||!Number.isInteger(index)||index<0)throw new Error();}}catch{throw new MailError(400,'Invalid NTU mail page.');}
  const all=['all','starred','codes','low','blocked'].includes(filter);const folders=(all?['INBOX',s.folders.sent,s.folders.archive]:filter==='sent'?[s.folders.sent]:filter==='trash'?[s.folders.trash]:filter==='archived'?[s.folders.archive]:filter==='gmail-drafts'?[s.folders.drafts]:['INBOX']).filter(f=>f!=='Archive'||Object.hasOwn(s.env.mailboxes||{},f));
  if(index>=folders.length)return {messages:[],next:null};const folder=folders[index],flag=filter==='unread'?'UNSEEN':filter==='starred'?'FLAGGED':'';
  const listing=await s.list(folder,page,query,flag),messages=await metadata(admin,account,s,listing.rows,folder);
  const next=listing.hasMore?b64url(JSON.stringify({index,page:page+1})):index+1<folders.length?b64url(JSON.stringify({index:index+1,page:1})):null;
  return {messages,next};
 });
}
async function fullMessage(admin:any,account:any,s:Roundcube,id:string){
 const ref=await reference(admin,account,id),raw=await s.raw(ref),email=await PostalMime.parse(raw);
 const payload:any={mimeType:'multipart/mixed',headers:email.headers.map(h=>({name:h.key,value:h.value})),parts:[]};
 for(const [name,value] of [['Subject',email.subject],['From',email.from?`${email.from.name||''} <${email.from.address}>`:null],['To',email.to?.map(a=>a.address||'').join(', ')]])if(value){payload.headers=payload.headers.filter(h=>h.name.toLowerCase()!==String(name).toLowerCase());payload.headers.push({name,value});}
 if(email.text)payload.parts.push({partId:'text',mimeType:'text/plain',body:{data:b64url(email.text)}});if(email.html)payload.parts.push({partId:'html',mimeType:'text/html',body:{data:b64url(email.html)}});
 for(const [index,a] of email.attachments.entries()){const bytes=typeof a.content==='string'?Uint8Array.from(atob(a.content),c=>c.charCodeAt(0)):new Uint8Array(a.content);payload.parts.push({partId:'att'+index,filename:a.filename||'attachment',mimeType:a.mimeType,headers:a.contentId?[{name:'Content-ID',value:a.contentId}]:[],body:{attachmentId:'att'+index,size:bytes.length,data:b64url(bytes)}});}
 const message={id,threadId:id,internalDate:String(Date.parse(email.date||'')||0),labelIds:ref.labels,snippet:(email.text||plainText(email.html||'')).trim().slice(0,250),payload,providerRef:{...ref,message_id:email.messageId||header({payload},'Message-ID')}};
 delete message.providerRef.labels;return message;
}
async function mutate(admin:any,account:any,s:Roundcube,id:string,action:string){
 const ref=await reference(admin,account,id);const flags:any={read:'read',unread:'unread',star:'flagged',unstar:'unflagged'};
 if(flags[action]){await s.ajax('mark',{_mbox:ref.mailbox,_uid:ref.uid,_flag:flags[action]},true);return;}
 const target=action==='archive'?s.folders.archive:action==='trash'?s.folders.trash:action==='unarchive'||action==='untrash'?'INBOX':null;if(!target)throw new MailError(400,'Unsupported NTU mail action.');if(target===ref.mailbox)return;
 const message=await fullMessage(admin,account,s,id),messageId=header(message,'Message-ID');if(!messageId)throw new MailError(409,'This message has no stable Message-ID. Move it in NTU webmail instead.');
 await s.ensureFolder(target);const before=new Set((await s.find(target,messageId)).map(r=>r.uid));
 await s.ajax('move',{_mbox:ref.mailbox,_uid:ref.uid,_target_mbox:target},true);
 const matches=(await s.find(target,messageId)).filter(r=>!before.has(r.uid));if(matches.length!==1)throw new MailError(409,'NTU moved the message, but its new location needs a mailbox refresh.');
 check(await admin.from('eren_mail_messages').update({provider_ref:{...message.providerRef,mailbox:target,uid:matches[0].uid}}).eq('account_id',account.id).eq('id',id));
}
export function roundcubeFormInputs(html:string){
 const inputs:Record<string,string>={};
 for(const tag of html.matchAll(/<input\b[^>]*>/gi)){const attrs=Object.fromEntries([...tag[0].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),cleanText(m[2])]));if(attrs.name&&attrs.type==='hidden')inputs[attrs.name]=attrs.value||'';}
 return inputs;
}
export function roundcubeSendResult(html:string){
 // Framed sends contain only provider-generated commands. Consume JSON data,
 // never execute the frame's scripts. A Sent lookup independently confirms it.
 const commands=[];
 for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
  const source=script[1];const pattern=/(?:parent\.)?rcmail\.(sent_successfully|display_message)\(/g;let m;
  while((m=pattern.exec(source))){let p=pattern.lastIndex,quoted=false,escaped=false,depth=0;
   for(;p<source.length;p++){const c=source[p];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='{'||c==='['||c==='(')depth++;else if(c==='}'||c===']')depth--;else if(c===')'){if(depth===0)break;depth--;}}
   if(source[p]!==')'||source[p+1]!==';')continue;
   try{commands.push(...parseRoundcubeCommands('this.'+m[1]+'('+source.slice(pattern.lastIndex,p)+');'));}catch{}
   pattern.lastIndex=p+2;
  }
 }
 return {accepted:commands.some(c=>c.name==='sent_successfully'&&c.args[0]==='confirmation'),rejected:commands.some(c=>c.name==='display_message'&&c.args[1]==='error'),warning:commands.some(c=>c.name==='sent_successfully'&&c.args[3])};
}
export async function ntuSend(admin:any,account:any,s:Roundcube,rawEncoded:string){
 const raw=Uint8Array.from(atob(rawEncoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)),email=await PostalMime.parse(raw),recipients=email.to?.flatMap(a=>'address'in a&&a.address?[a.address]:[])||[];
 if(address(email.from?.address||'')!==account.email||!recipients.length||!email.messageId)throw new MailError(400,'Invalid NTU sender or recipients.','mail_delivery_rejected');
 // Import the queued MIME as a draft so Roundcube preserves the stable Message-ID,
 // reply headers and uploaded attachments, and saves its own Sent copy.
 if((await s.find(s.folders.sent,email.messageId)).length)return {id:'ntu_sent_'+b64url(email.messageId)};
 let drafts=await s.find(s.folders.drafts,email.messageId);
 if(!drafts.length){
  const form=new FormData();for(const [key,value] of Object.entries({_task:'mail',_action:'import',_mbox:s.folders.drafts,_remote:'1',_token:s.env.request_token}))form.append(key,value);form.append('_file[]',new Blob([raw.buffer as ArrayBuffer],{type:'message/rfc822'}),'queued.eml');
  await s.fetch('?_task=mail&_action=import&_mbox='+encodeURIComponent(s.folders.drafts),{method:'POST',body:form,headers:{'X-Requested-With':'XMLHttpRequest','X-Roundcube-Request':s.env.request_token}},4*1024*1024);
  drafts=await s.find(s.folders.drafts,email.messageId);
 }
 if(drafts.length!==1)throw new MailError(400,'NTU could not prepare this message. Restore the draft and retry.','mail_delivery_rejected');
 const uid=drafts[0].uid,compose=await(await s.fetch('?'+new URLSearchParams({_task:'mail',_action:'compose',_draft_uid:uid,_mbox:s.folders.drafts,_token:s.env.request_token}))).text(),env=roundcubeEnvironment(compose),fields=roundcubeFormInputs(compose);
 if(!env.compose_id||String(env.draft_id)!==uid||!fields._token)throw new MailError(400,'NTU could not prepare this draft. Restore it and retry.','mail_delivery_rejected');
 const attachments=Object.values(env.attachments||{}) as any[];
 if(attachments.length!==email.attachments.length||email.attachments.some(a=>!attachments.some(b=>b.name===a.filename)))throw new MailError(400,'NTU did not load every attachment. Restore the draft and retry.','mail_delivery_rejected');
 Object.assign(fields,{_task:'mail',_action:'send',_id:String(env.compose_id),_from:account.email,_to:recipients.join(', '),_cc:'',_bcc:'',_subject:email.subject||'',_message:email.html||email.text||'',_is_html:email.html?'1':'0',_draft:'',_draft_saveid:uid,_framed:'1',_charset:'UTF-8',_dsn:'',_mdn:''});
 let result;try{const response=await(await s.fetch('?_task=mail&_action=send',{method:'POST',body:new URLSearchParams(fields),headers:{'Content-Type':'application/x-www-form-urlencoded'}},4*1024*1024)).text();result=roundcubeSendResult(response);}catch{throw new MailError(502,'NTU delivery could not be confirmed. Check Outbox before sending again.','ntu_send_uncertain');}
 // A transport failure never triggers another send. Queue reconciliation uses the
 // preserved Message-ID to locate a later Sent copy without duplicating delivery.
 let confirmed=false;try{confirmed=(await s.find(s.folders.sent,email.messageId)).length>0;}catch{}
 if(!confirmed&&!result.accepted){if(result.rejected)throw new MailError(400,'NTU webmail rejected this send. Restore the draft and check its recipients.','mail_delivery_rejected');throw new MailError(502,'NTU delivery could not be confirmed. Check Outbox before sending again.','ntu_send_uncertain');}
 return {id:'ntu_sent_'+b64url(email.messageId),warning:confirmed?'':'Delivered through NTU webmail, but saving the Sent copy was not confirmed.'};
}
export async function ntuClient(admin:any,account:any){
 const s=await ntuSession(admin,account);
 const api=async(path:string,method='GET',body?:any)=>s.serial(async()=>{
  const url=new URL(path,'https://provider.invalid/'),parts=url.pathname.slice(1).split('/'),id=decodeURIComponent(parts[1]||'');
  if(parts[0]==='threads'&&id){if(method==='GET')return {id,messages:[await fullMessage(admin,account,s,id)]};if(parts[2]==='modify'){const add=body.addLabelIds||[],remove=body.removeLabelIds||[];for(const [label,action] of [['UNREAD',add.includes('UNREAD')?'unread':remove.includes('UNREAD')?'read':null],['STARRED',add.includes('STARRED')?'star':remove.includes('STARRED')?'unstar':null],['INBOX',add.includes('INBOX')?'unarchive':remove.includes('INBOX')?'archive':null]])if(action)await mutate(admin,account,s,id,action);return {};}if(parts[2]==='trash'||parts[2]==='untrash'){await mutate(admin,account,s,id,parts[2]);return {};}}
  if(parts[0]==='messages'&&id==='send'&&method==='POST')return await ntuSend(admin,account,s,body.raw);
  if(parts[0]==='messages'&&id==='batchModify'&&method==='POST'){for(const item of body.ids||[])await mutate(admin,account,s,item,'read');return {};}
  if(parts[0]==='messages'&&id){const message=await fullMessage(admin,account,s,id);if(parts[2]==='attachments'){const part=message.payload.parts.find(p=>p.partId===decodeURIComponent(parts[3]||''));if(!part)throw new MailError(404,'NTU attachment not found.');return {data:part.body.data};}return message;}
  if(parts[0]==='messages'&&!id){const q=url.searchParams.get('q')||'';if(q.includes('rfc822msgid:')){const rows=await s.find(s.folders.sent,q.split('rfc822msgid:')[1]);return {messages:rows.map(r=>({id:logicalId(s.folders.sent,r.uid)}))};}const list=await s.list('INBOX',1,'',q.includes('is:unread')?'UNSEEN':'');return {messages:list.rows.map(r=>({id:logicalId('INBOX',r.uid)})),nextPageToken:list.hasMore?'2':undefined};}
  throw new MailError(400,'Unsupported NTU mail operation.');
 });
 return Object.assign(api,{mailAccountKey:account.workspace_hash+':'+account.id});
}
export async function connectNtu(admin:any,workspace:string,input:any){
 const username=String(input.username||input.email||'').trim().toLowerCase().replace(/@ntu\.edu\.tw$/i,''),password=input.password;
 if(!/^[bdrft]\d{8}$/.test(username)||typeof password!=='string'||!password||password.length>1000)throw new MailError(400,'Use your NTU student ID and mailbox password.');
 const email=username+'@ntu.edu.tw',existing=check(await admin.from('eren_mail_accounts').select('*').eq('workspace_hash',workspace).eq('email',email).maybeSingle());if(existing&&existing.provider!=='ntu')throw new MailError(409,'This address is connected through another provider.');
 const s=new Roundcube({username,password});try{await s.login();}catch(e){s.close();throw e;}
 const account={id:existing?.id||crypto.randomUUID(),workspace_hash:workspace,email,display_name:existing?.display_name||'NTU Mail',provider:'ntu',status:'active',sync_error:null,secret_name:'',provider_state:{folders:s.folders}};account.secret_name=`eren-mail:${workspace}:account:${account.id}`;
 await secret(admin,account.secret_name,JSON.stringify({username,password}));check(await admin.from('eren_mail_accounts').upsert(account,{onConflict:'workspace_hash,email'}));clearNtuMemory(workspace);sessions.set(workspace+':'+account.id,s);
 const rules=await accountRules(admin,account),page=await ntuList(admin,account);await cacheMessages(admin,account,page.messages,rules);
 check(await admin.from('eren_mail_accounts').update({last_sync_at:new Date().toISOString()}).eq('id',account.id));
 return {connected:true,email,accountId:account.id};
}
export async function syncNtu(admin:any,account:any){
 const rules=await accountRules(admin,account),state=account.provider_state||{};
 // Always refresh the inbox's live flags, then advance one bounded backfill page.
 const latest=await ntuList(admin,account);await cacheMessages(admin,account,latest.messages,rules);
 const cursor=state.backfill??latest.next;if(cursor){const page=await ntuList(admin,account,'all','',cursor);await cacheMessages(admin,account,page.messages,rules);state.backfill=page.next||null;}else state.backfill=latest.next;
 return {synced:latest.messages.length,provider_state:state};
}

export async function ntuMarkAllRead(admin:any,account:any){
 const s=await ntuSession(admin,account);return await s.serial(async()=>{const unread=await s.list('INBOX',1,'','UNSEEN');if(!unread.count)return 0;await s.ajax('mark',{_mbox:'INBOX',_uid:'*',_flag:'read',_folders:'cur'},true);const rows=check(await admin.from('eren_mail_messages').select('id,thread_id').eq('account_id',account.id).contains('labels',['INBOX','UNREAD']));if(rows.length)check(await admin.rpc('eren_mail_apply_cache_actions',{p_actions:rows.map(r=>({accountId:account.id,threadId:r.thread_id,action:'read'}))}));return unread.count;});
}

// One-time operator provisioning uses the owner's existing NTU credentials in
// GitHub Secrets. They travel directly from that runner to Vault over HTTPS,
// never through source, artifacts, logs, or the browser. Import must first be
// enabled privately, and only the pinned repository/ref/workflow OIDC grant works.
let githubKeys:any=null,githubKeysUntil=0;
export async function verifyNtuRunner(token:string,expected:any){
 if(typeof token!=='string'||token.length>12000)throw new MailError(401,'Invalid NTU provisioning proof.');
 let protectedHeader:any,claims:any,parts:string[];try{parts=token.split('.');if(parts.length!==3)throw new Error();protectedHeader=JSON.parse(decodeBody(parts[0]));claims=JSON.parse(decodeBody(parts[1]));}catch{throw new MailError(401,'Invalid NTU provisioning proof.');}
 const now=Math.floor(Date.now()/1000);
 if(protectedHeader.alg!=='RS256'||typeof protectedHeader.kid!=='string'||claims.iss!=='https://token.actions.githubusercontent.com'||claims.aud!=='eren-mail-ntu-import'||claims.repository!=='Weather-Mister/ntu-mail-push'||String(claims.repository_id)!=='1373793193'||claims.ref!==expected.ref||claims.workflow_ref!==expected.workflow||claims.event_name!=='push'||!Number.isFinite(claims.exp)||claims.exp<now||claims.exp>now+900||!Number.isFinite(claims.iat)||claims.iat<now-600||claims.iat>now+30||claims.nbf&&claims.nbf>now+30)throw new MailError(401,'NTU provisioning proof does not match the authorized runner.');
 if(!githubKeys||githubKeysUntil<Date.now()){const r=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new MailError(502,'Could not verify NTU provisioning proof.');githubKeys=await r.json();githubKeysUntil=Date.now()+300000;}
 const jwk=githubKeys.keys?.find((k:any)=>k.kid===protectedHeader.kid&&k.kty==='RSA');if(!jwk)throw new MailError(401,'Unknown provisioning signature.');
 let ok=false;try{const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);const signature=Uint8Array.from(atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,new TextEncoder().encode(parts[0]+'.'+parts[1]));}catch{}
 if(!ok)throw new MailError(401,'Invalid provisioning signature.');return claims;
}
export async function importNtuFromRunner(admin:any,req:Request){
 const saved=await secret(admin,'eren-mail:ntu-import');let expected:any;try{expected=JSON.parse(saved);}catch{}
 if(!expected?.workspace||!expected?.ref||!expected?.workflow||Date.parse(expected.expires)<Date.now())throw new MailError(403,'NTU provisioning is not enabled.');
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')||'',claims=await verifyNtuRunner(token,expected);const raw=await req.text();if(raw.length>5000)throw new MailError(413,'Provisioning request is too large.');let input:any;try{input=JSON.parse(raw);}catch{throw new MailError(400,'Invalid provisioning request.');}
 const workspace=check(await admin.from('schedule_workspaces').select('workspace_hash').eq('workspace_hash',expected.workspace).eq('app_slug','eren').maybeSingle());if(!workspace)throw new MailError(403,'Invalid provisioning workspace.');
 const lease='ntu-import:'+expected.workspace+':'+String(claims.jti||await hash(token));if(!check(await admin.rpc('eren_mail_rate',{p_bucket:lease,p_limit:1,p_seconds:600})))throw new MailError(409,'Provisioning proof was already used.');
 const result=await connectNtu(admin,expected.workspace,input);await secret(admin,'eren-mail:ntu-import',null,true);return result;
}
