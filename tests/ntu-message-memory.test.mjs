import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {NtuMessageMemory,messageWithoutAttachmentData} from '../cloudflare/mail/runtime/ntu-message-memory.mjs';
import {readNtuWithFreshSession,retireNtuSessionWhenIdle} from '../cloudflare/mail/runtime/ntu-read-recovery.mjs';
import {ntuSessionKey} from '../cloudflare/mail/runtime/ntu-session-key.mjs';
const account={workspace_hash:'owner-a',id:'account-a'},ref={mailbox:'INBOX',uid:'7'};
const mime={id:'mail-a',payload:{parts:[{mimeType:'text/html',body:{data:'body-text'}},{partId:'att0',filename:'image.png',body:{attachmentId:'att0',size:3,data:'AQID'}}]}};

test('NTU MIME cache separates owners, accounts and changed locations; limits memory and expires entries',()=>{
 const cache=new NtuMessageMemory(10000,1,10000),key=cache.key(account,'mail-a',ref);
 cache.set(key,mime);const hit=cache.get(key);hit.payload.parts[0].body.data='changed';assert.equal(cache.get(key).payload.parts[0].body.data,'body-text');
 for(const [a,r]of [[{...account,workspace_hash:'owner-b'},ref],[{...account,id:'account-b'},ref],[account,{...ref,uid:'8'}],[account,{...ref,mailbox:'Trash'}]])assert.equal(cache.get(cache.key(a,'mail-a',r)),null);
 const next=cache.key(account,'mail-b',ref);cache.set(next,mime);assert.equal(cache.get(key),null);assert(cache.bytes<=cache.maxBytes);cache.clear('owner-b');assert(cache.get(next));cache.clear('owner-a');assert.equal(cache.bytes,0);
 cache.set(key,mime);cache.entries.get(key).until=0;assert.equal(cache.get(key),null);assert.equal(cache.bytes,0);
 cache.set(key,{huge:'x'.repeat(6000)});assert.equal(cache.get(key),null);
});
test('Initial NTU message preserves readable body and attachment metadata while binary data loads separately',()=>{
 const compact=messageWithoutAttachmentData(mime);assert.equal(compact.payload.parts[0].body.data,'body-text');assert.equal(compact.payload.parts[1].body.data,undefined);assert.equal(compact.payload.parts[1].body.attachmentId,'att0');assert.equal(mime.payload.parts[1].body.data,'AQID');
});
function fixture(){
 let row={provider_ref:{...ref},labels:['INBOX','UNREAD']},downloads=0,parses=0;
 const admin={from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:structuredClone(row),error:null};}};}};
 class MailError extends Error{constructor(status,message,code='mail_error'){super(message);this.status=status;this.code=code;}}
 const b64url=v=>Buffer.from(typeof v==='string'?v:v.buffer,v.byteOffset||0,v.byteLength).toString('base64url');
 const session={serial:fn=>fn(),chain:Promise.resolve(),folders:{trash:'Trash',archive:'Archive'},close(){},async raw(){downloads++;return new TextEncoder().encode('From: fixture@example.invalid\r\n\r\nBody');}};
 const context={NtuMessageMemory,messageWithoutAttachmentData,readNtuWithFreshSession,retireNtuSessionWhenIdle,ntuSessionKey,environment:()=>({}),MailError,TextDecoder,TextEncoder,Response,Buffer,URL,URLSearchParams,structuredClone,Date,crypto,atob,b64url,decodeBody:v=>Buffer.from(v,'base64url').toString(),header:()=>'',plainText:v=>v.replace(/<[^>]+>/g,''),check:r=>r.data,PostalMime:{async parse(){parses++;return {headers:[],subject:'Synthetic',date:'2026-10-14T00:00:00Z',messageId:'fixture-id',text:'Hello',html:'<p>Hello</p><img src="cid:img">',attachments:[{filename:'image.png',mimeType:'image/png',contentId:'img',content:new Uint8Array([1,2,3])},{filename:'doc.pdf',mimeType:'application/pdf',content:new Uint8Array([4,5])}]};}}};
 const source=stripTypeScriptTypes(readFileSync(new URL('../cloudflare/mail/runtime/provider/ntu.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import[^;]*;\s*/gm,'').replaceAll('export async function','async function').replaceAll('export function','function');
 runInNewContext(source+'\nthis.hooks={fullMessage,Roundcube,ntuClient,setSession(fn){ntuSession=fn;}};',context);
 return {context,admin,session,setRow(value){row=value;},stats:()=>({downloads,parses})};
}
test('Large attachment data is parsed once across initial read, image hydration and attachment download; labels stay current',async()=>{
 const f=fixture();const first=await f.context.hooks.fullMessage(f.admin,account,f.session,'mail-a');assert(first.payload.parts.every(p=>!p.body.attachmentId||!p.body.data));
 const rich=await f.context.hooks.fullMessage(f.admin,account,f.session,'mail-a',true);assert.equal(rich.payload.parts.find(p=>p.partId==='att0').body.data,'AQID');assert.deepEqual(f.stats(),{downloads:1,parses:1});
 f.setRow({provider_ref:{...ref},labels:['INBOX']});const reopened=await f.context.hooks.fullMessage(f.admin,account,f.session,'mail-a');assert.deepEqual(Array.from(reopened.labelIds),['INBOX']);assert.deepEqual(f.stats(),{downloads:1,parses:1});
 f.setRow({provider_ref:{mailbox:'Archive',uid:'8'},labels:[]});await f.context.hooks.fullMessage(f.admin,account,f.session,'mail-a');assert.deepEqual(f.stats(),{downloads:2,parses:2});
});
test('NTU GET retries an expired session once; mailbox mutations do not replay',async()=>{
 const f=fixture();let acquired=0;
 f.context.hooks.setSession(async()=>{acquired++;return acquired===1?{...f.session,serial:async()=>{throw Object.assign(new Error('expired'),{code:'ntu_session_expired'});}}:f.session;});
 const api=await f.context.hooks.ntuClient(f.admin,account);const t=await api('threads/mail-a?format=full');assert.equal(t.messages.length,1);assert.equal(acquired,2);
 acquired=0;f.context.hooks.setSession(async()=>{acquired++;return {...f.session,raw:async()=>{throw Object.assign(new Error('transport'),{code:'ntu_unavailable'});}};});
 await assert.rejects(()=>api('threads/mail-a/trash','POST'),{code:'ntu_unavailable'});assert.equal(acquired,1);
});
test('NTU source reader distinguishes an expired login page from missing mail and accepts literal Roundcube text in an email',async()=>{
 const f=fixture(),s=new f.context.hooks.Roundcube({username:'fixture',password:'synthetic'});s.env.request_token='synthetic';
 s.fetch=async()=>new Response('<!doctype html><html><script>rcmail.set_env({"task":"login"});</script>');await assert.rejects(()=>s.raw(ref),{code:'ntu_session_expired'});
 s.fetch=async()=>new Response('<!doctype html><html><script>rcmail.set_env({"task":"mail"});</script>');await assert.rejects(()=>s.raw(ref),{code:'ntu_message_missing'});
 s.fetch=async()=>new Response('From: fixture@example.invalid\r\nSubject: Synthetic\r\n\r\nrcmail.set_env({"task":"login"});');assert((await s.raw(ref)).length>0);
});
