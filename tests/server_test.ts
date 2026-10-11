import { ShortCache } from '../supabase/functions/eren-mail/memory.ts';
const assert:any=Object.assign((ok:any,message='Assertion failed')=>{if(!ok)throw new Error(message);},{
 equal:(a:any,b:any)=>{if(a!==b)throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);},
 match:(s:string,r:RegExp)=>{if(!r.test(s))throw new Error('Pattern did not match');},
 deepEqual:(a:any,b:any)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Not deeply equal');},
 rejects:async(fn:any)=>{let rejected=false;try{await fn();}catch{rejected=true;}if(!rejected)throw new Error('Expected rejection');}
});
import { safeHtml, workspaceFor, hash, revise, translateMessage, threadMessageViews, fullThread, gmailClient, clearMailMemory, cachedOverviews } from '../supabase/functions/eren-mail/services.ts';
import { inlineImages } from '../supabase/functions/eren-mail/render.ts';
import { deliver, enqueue, reconcile, syncAccount } from '../supabase/functions/eren-mail/jobs.ts';
import { oauthStart, oauthFinish } from '../supabase/functions/eren-mail/oauth.ts';
import { publicIPv4 } from '../supabase/functions/eren-mail/unsubscribe.ts';
import { decodeBody, b64url } from '../supabase/functions/eren-mail/domain.mjs';
class MemoryDB {
 tables:any={};secrets:any={};storageObjects=new Map<string,Uint8Array>();
 storage={from:(bucket:string)=>({
  upload:async(path:string,data:any)=>{const bytes=data instanceof Uint8Array?data:new Uint8Array(await data.arrayBuffer());this.storageObjects.set(bucket+'/'+path,new Uint8Array(bytes));return {data:{path},error:null};},
  download:async(path:string)=>{const bytes=this.storageObjects.get(bucket+'/'+path);if(!bytes)return {data:null,error:{message:'not found'}};const copy=new Uint8Array(bytes.length);copy.set(bytes);return {data:new Blob([copy.buffer]),error:null};},
  remove:async(paths:string[])=>{for(const path of paths)this.storageObjects.delete(bucket+'/'+path);return {data:[],error:null};}
 })};
 constructor(){this.tables={eren_mail_accounts:[],eren_mail_outbox:[],eren_mail_messages:[],eren_mail_rules:[],eren_mail_oauth:[],schedule_workspaces:[]};}
 from(table:string){
  const db=this;let op='select',values:any,filters:any[]=[],single=false,limit=Infinity,conflict='id';
  const b:any={select:()=>b,eq:(k:any,v:any)=>{filters.push((r:any)=>r[k]===v);return b;},neq:(k:any,v:any)=>{filters.push((r:any)=>r[k]!==v);return b;},gt:(k:any,v:any)=>{filters.push((r:any)=>r[k]>v);return b;},lt:(k:any,v:any)=>{filters.push((r:any)=>r[k]<v);return b;},in:(k:any,v:any)=>{filters.push((r:any)=>v.includes(r[k]));return b;},or:()=>b,order:()=>b,limit:(v:any)=>{limit=v;return b;},maybeSingle:()=>{single=true;return b;},single:()=>{single=true;return b;},insert:(v:any)=>{op='insert';values=v;return b;},upsert:(v:any,opts:any={})=>{op='upsert';values=v;conflict=opts.onConflict||'id';return b;},update:(v:any)=>{op='update';values=v;return b;},delete:()=>{op='delete';return b;},then:(resolve:any,reject:any)=>{
   try{
    let rows=db.tables[table]||=[];let selected=rows.filter((r:any)=>filters.every(f=>f(r))).slice(0,limit);
    if(op==='insert'||op==='upsert') {
     selected=[];
     for(const row of Array.isArray(values)?values:[values]) {
      const existing=rows.find((r:any)=>conflict.split(',').every(k=>r[k]===row[k]));
      if(existing&&op==='insert'){resolve({data:null,error:{code:'23505'}});return;}
      if(existing){Object.assign(existing,row);selected.push(existing);}else{const r={...row,expires_at:row.expires_at||new Date(Date.now()+600000).toISOString(),status:row.status||(table==='eren_mail_oauth'?'waiting':undefined)};rows.push(r);selected.push(r);}
     }
    }
    if(op==='update')selected.forEach((r:any)=>Object.assign(r,values));
    if(op==='delete')db.tables[table]=rows.filter((r:any)=>!selected.includes(r));
    resolve({data:structuredClone(single?selected[0]||null:selected),error:null});
   }catch(e){reject(e);}
  }};return b;
 }
 rpc(name:string,args:any){if(name==='eren_mail_secret'){if(args.p_delete)delete this.secrets[args.p_name];else if(args.p_value!==null&&args.p_value!==undefined)this.secrets[args.p_name]=args.p_value;return Promise.resolve({data:args.p_value?null:this.secrets[args.p_name]||null,error:null});}throw new Error(name);}
}
function setup(){clearMailMemory();const db=new MemoryDB(),a:any={id:'11111111-1111-4111-8111-111111111111',workspace_hash:'workspace',email:'me@example.org',secret_name:'eren-mail:workspace:account:1',status:'active'};db.tables.eren_mail_accounts.push(a);db.secrets[a.secret_name]='refresh-test';db.secrets['eren-mail:workspace:config:GOOGLE_CLIENT_ID']='client';db.secrets['eren-mail:workspace:config:GOOGLE_CLIENT_SECRET']='secret-test';return {db,a};}
async function fetching(fn:any,run:any){const old=globalThis.fetch;globalThis.fetch=fn;try{await run();}finally{globalThis.fetch=old;}}
Deno.test('Gmail concurrent clients refresh once and reuse an unexpired server-only token',async()=>{
 const {db,a}=setup();let refreshes=0,gmail=0,clock=Date.now();const now=Date.now;Date.now=()=>clock;
 try{await fetching(async(url:any)=>{if(String(url).includes('oauth2')){refreshes++;return Response.json({access_token:'access-test',expires_in:3600});}gmail++;return Response.json({ok:true});},async()=>{
  const clients=await Promise.all([gmailClient(db,a),gmailClient(db,a),gmailClient(db,a)]);await Promise.all(clients.map(api=>api('profile')));assert.equal(refreshes,1);assert.equal(gmail,3);
  await (await gmailClient(db,a))('profile');assert.equal(refreshes,1);
  clock+=901000;await gmailClient(db,a);assert.equal(refreshes,2);
  clearMailMemory(a.workspace_hash);await gmailClient(db,a);assert.equal(refreshes,3);
 });}finally{Date.now=now;clearMailMemory();}
});
Deno.test('short thread cache expires, clones data, enforces limits and invalidates account scope',()=>{
 const cache=new ShortCache(10,2,2000),now=Date.now;let clock=100;Date.now=()=>clock;
 try{cache.set('w:a:t1',{labels:['INBOX']});const value=cache.get('w:a:t1');value.labels=[];assert.equal(cache.get('w:a:t1').labels[0],'INBOX');cache.set('w:a:t2',{});cache.set('w:b:t3',{});assert.equal(cache.get('w:a:t1'),undefined);cache.deletePrefix('w:a:');assert.equal(cache.get('w:a:t2'),undefined);assert(cache.get('w:b:t3'));clock+=11;assert.equal(cache.get('w:b:t3'),undefined);}finally{Date.now=now;}
});
Deno.test('cached first view groups threads and never includes another account or full bodies',()=>{
 const row={id:'m1',account_id:'a1',thread_id:'t1',sender:'prof@example.org',sender_name:'Professor',subject:'Meeting',snippet:'Hello',internal_date:10,labels:['INBOX'],classification:{type:'University'}};
 const views=cachedOverviews([row,{...row,id:'m2',internal_date:20,labels:['SENT']},{...row,account_id:'foreign',thread_id:'other'}],[{id:'a1',display_name:'University'}]);assert.equal(views.length,1);assert.equal(views[0].count,2);assert.equal(views[0].timestamp,20);assert.equal(views[0].sender,'Professor');assert(!('text' in views[0]));assert(!('html' in views[0]));
});
Deno.test('reader enables external images by default while summary rows skip HTML rendering',()=>{
 const message={id:'m1',threadId:'t1',labelIds:['INBOX'],payload:{headers:[],mimeType:'text/html',body:{data:b64url('<p style="color:#223344">Hello</p><img src="https://images.example.org/banner.png">')}}};
 const reader=threadMessageViews([message],[])[0],overview=threadMessageViews([message],[],true)[0];assert(reader.html.includes('src="https://images.example.org/banner.png"'));assert(!reader.hasExternalImages);assert.equal(overview.html,'');
});
Deno.test('HTML mail cannot execute scripts, forms, remote images or CSS tracking',()=>{
 const html=safeHtml('<script>steal()</script><img src="https://track.example.org/x"><style>@import url(https://track.test)</style><form action="https://evil.test"><input></form><a href="javascript:alert(1)">bad</a><a href="https://example.org">safe</a><p onmouseover="steal()">Hello</p><svg onload="steal()"></svg>');
 assert(!html.includes('steal'));assert(!html.includes('javascript:'));assert(!html.includes('track.'));assert(!html.includes('<form'));assert(!html.includes('<svg'));assert(html.includes("default-src 'none'"));assert(html.includes('Hello'));
});
Deno.test('newsletter text styling survives; CSS cannot make tracking requests',()=>{
 const html=safeHtml('<style>@import "https://track.example.org";.hero{font-size:32px;color:#112233;background:url(https://track.example.org);position:fixed}@media screen and (max-width:600px){.hero{font-size:20px}}</style><table bgcolor="#ccddff" width="600"><tr><td style="padding:24px;text-align:center;background-color:#ccddff"><h1 class="hero" style="font-family:Arial,sans-serif;font-weight:bold">Less searching</h1><a style="background:#4066ff;border-radius:20px;color:#ffffff;padding:10px 20px" href="https://example.org">Shop</a></td></tr></table>');
 for(const text of ['font-size:32px','font-size:20px','font-family:Arial,sans-serif','font-weight:bold','background-color:#ccddff','border-radius:20px','bgcolor="#ccddff"','class="hero"'])assert(html.includes(text),text);
 assert(!html.includes('track.example'));assert(!html.includes('position:fixed'));assert(!html.includes('@import'));
});
Deno.test('sanitizer respects image mode and cannot enable scripts or unsafe sources',()=>{
 const input='<img src="https://images.example.org/banner.png" alt="Banner" width="600"><img src="javascript:alert(1)"><img src="data:image/svg+xml,bad"><img src="https://127.0.0.1/x"><img src="https://user:pass@example.org/x"><script>alert(1)</script>';
 const blocked=safeHtml(input),enabled=safeHtml(input,{externalImages:true});
 assert(!blocked.includes('images.example'));assert(blocked.includes('data-external-image'));assert(enabled.includes('src="https://images.example.org/banner.png"'));assert(enabled.includes('referrerpolicy="no-referrer"'));
 for(const text of ['javascript:','svg+xml','127.0.0.1','user:pass','<script>'])assert(!enabled.includes(text),text);
 assert(enabled.includes("default-src 'none'"));
});
Deno.test('CID raster images display without remote requests; SVG or invalid attachments cannot render',()=>{
 const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 const images=inlineImages({parts:[{mimeType:'image/png',headers:[{name:'Content-ID',value:'<logo@example.org>'}],body:{data}},{mimeType:'image/svg+xml',headers:[{name:'Content-ID',value:'<evil>'}],body:{data:btoa('<svg onload="alert(1)"></svg>')}},{mimeType:'image/png',headers:[{name:'Content-ID',value:'<fake>'}],body:{data:btoa('<script>bad</script>')}}]});
 assert.equal(images.size,1);const html=safeHtml('<img src="cid:logo%40example.org"><img src="cid:evil"><img src="cid:fake">',{inlineImages:images});assert(html.includes('data:image/png;base64,'+data));assert(!html.includes('<script>'));assert(!html.includes('svg+xml'));assert(!html.includes('https:'));
});
Deno.test('reader retrieves inline Gmail attachments with limits; image failure preserves thread',async()=>{
 const calls:string[]=[];
 const make=()=>({messages:[{id:'m1',internalDate:'1',payload:{parts:[{mimeType:'image/png',headers:[{name:'Content-ID',value:'<logo>'}],body:{attachmentId:'logo',size:100}},{mimeType:'image/png',headers:[{name:'Content-ID',value:'<large>'}],body:{attachmentId:'large',size:3*1024*1024}},{mimeType:'image/png',headers:[{name:'Content-ID',value:'<broken>'}],body:{attachmentId:'broken',size:100}}]}}]});
 const api=async(path:string)=>{calls.push(path);if(path.startsWith('threads/'))return make();if(path.endsWith('/broken'))throw new Error('image unavailable');return {data:'iVBORw0KGgo='};};
 await fullThread(api,'thread1');assert.equal(calls.length,1);calls.length=0;
 const t=await fullThread(api,'thread1',true);assert.equal(t.messages.length,1);assert(calls.some(x=>x.endsWith('/logo')));assert(calls.some(x=>x.endsWith('/broken')));assert(!calls.some(x=>x.endsWith('/large')));
});
Deno.test('SSRF filters reject private and special ranges',()=>{for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','172.31.2.3','192.168.1.1','169.254.169.254','100.64.0.1','224.0.0.1','198.18.0.1','203.0.113.1','192.0.2.1','0.0.0.0','::1'])assert.equal(publicIPv4(ip),false,ip);assert.equal(publicIPv4('8.8.8.8'),true);});
Deno.test('Eren workspace owns access; Begum and unknown keys cannot access Mail',async()=>{
 const {db}=setup(),eren='e'.repeat(40),begum='b'.repeat(40);db.tables.schedule_workspaces=[{workspace_hash:await hash(eren),app_slug:'eren'},{workspace_hash:await hash(begum),app_slug:'begum'}];
 assert.equal(await workspaceFor(new Request('https://test.org',{headers:{'x-schedule-key':eren}}),db),await hash(eren));
 for(const key of [begum,'wrong','x'.repeat(40)])await assert.rejects(()=>workspaceFor(new Request('https://test.org',{headers:{'x-schedule-key':key}}),db));
});
Deno.test('OAuth is one account per grant with PKCE and browser-bound finish',async()=>{
 Deno.env.set('SUPABASE_URL','https://test.supabase.co');const {db}=setup();
 const result=await oauthStart(db,'workspace',{challenge:await hash('proof')});const u=new URL(result.url);
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('access_type'),'offline');assert.equal(u.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.modify');assert(!u.href.includes('secret-test'));
 await assert.rejects(()=>oauthFinish(db,'workspace',{state:result.state,proof:'wrong'}));
 const row=db.tables.eren_mail_oauth[0];Object.assign(row,{status:'ready',pending_secret:'eren-mail:pending',email:'second@example.org'});db.secrets[row.pending_secret]='new-refresh';
 const saved=await oauthFinish(db,'workspace',{state:result.state,proof:'proof'});assert.equal(saved.connected,true);assert.equal(db.tables.eren_mail_accounts.length,2);
 assert(!JSON.stringify(saved).includes('refresh'));assert.equal(row.status,'done');
});
Deno.test('real send constructs selected From and Gmail thread; repeated enqueue stays idempotent',async()=>{
 const {db,a}=setup();let sent:any=null;
 await fetching(async(url:any,init:any)=>{const u=String(url);if(u.includes('oauth2'))return Response.json({access_token:'access-test'});if(u.includes('threads/t1'))return Response.json({messages:[{id:'m1',payload:{headers:[{name:'Subject',value:'Meeting'},{name:'Message-ID',value:'<source@example.org>'}]}}]});if(u.endsWith('messages/send')){sent=JSON.parse(init.body);return Response.json({id:'sent1',threadId:'t1'});}throw new Error(u);},async()=>{
  const input={id:crypto.randomUUID(),to:'friend@example.org',subject:'Re: Meeting',body:'Thursday after 4.',threadId:'t1',replyMessageId:'m1'};
  const job=await enqueue(db,a,input);assert.equal(db.tables.eren_mail_outbox.length,1);
  assert.equal((await enqueue(db,a,input)).id,job.id);assert.equal(db.tables.eren_mail_outbox.length,1);
  await assert.rejects(()=>enqueue(db,a,{...input,body:'Changed text'}));
  db.tables.eren_mail_outbox[0].status='processing';await deliver(db,{...job,attempts:1});
  assert.equal(sent.threadId,'t1');const raw=decodeBody(sent.raw);assert.match(raw,/From: me@example.org/);assert.match(raw,/In-Reply-To: <source@example.org>/);assert.equal(db.tables.eren_mail_outbox[0].status,'sent');assert.equal(db.secrets[job.secret_name],undefined);
 });
});

Deno.test('queued send resolves durable draft attachments and emits mixed MIME',async()=>{
 const {db,a}=setup(),draftId='22222222-2222-4222-8222-222222222222',attId='33333333-3333-4333-8333-333333333333';let sent:any=null;
 db.storageObjects.set('eren-mail-attachments/workspace/draft/'+draftId+'/'+attId,new TextEncoder().encode('attachment bytes'));
 await fetching(async(url:any,init:any)=>{const u=String(url);if(u.includes('oauth2'))return Response.json({access_token:'access-test'});if(u.endsWith('messages/send')){sent=JSON.parse(init.body);return Response.json({id:'sent2',threadId:'new-thread'});}throw new Error(u);},async()=>{
  const input={id:crypto.randomUUID(),draftId,to:'friend@example.org',subject:'Report',body:'See attached.',bodyHtml:'<p>See <strong>attached</strong>.</p>',attachments:[{id:attId,name:'report.txt',type:'text/plain',size:16}]};
  const job=await enqueue(db,a,input);const stored=JSON.parse(db.secrets[job.secret_name]);assert.equal(stored.attachments[0].data,undefined);assert([...db.storageObjects.keys()].some(k=>k.includes('/outbox/'+job.id+'/'+attId)));
  db.tables.eren_mail_outbox[0].status='processing';await deliver(db,{...job,attempts:1});
  const raw=decodeBody(sent.raw);assert.match(raw,/Content-Type: multipart\/mixed/);assert.match(raw,/Content-Disposition: attachment/);assert.match(raw,/report\.txt/);assert.match(raw,/Content-Type: text\/html/);
 });
});
Deno.test('legacy Vault draft attachments still migrate into outbox storage',async()=>{
 const {db,a}=setup(),draftId='42222222-2222-4222-8222-222222222222',attId='43333333-3333-4333-8333-333333333333',data=btoa('legacy bytes');
 db.secrets['eren-mail:workspace:draft:'+draftId+':attachment:'+attId]=JSON.stringify({id:attId,name:'legacy.txt',type:'text/plain',size:12,data});
 const job=await enqueue(db,a,{id:crypto.randomUUID(),draftId,to:'friend@example.org',subject:'Legacy',body:'See attached.',attachments:[{id:attId,name:'legacy.txt',type:'text/plain',size:12}]});
 assert([...db.storageObjects.keys()].some(k=>k.includes('/outbox/'+job.id+'/'+attId)));
 assert.equal(JSON.parse(db.secrets[job.secret_name]).attachments[0].data,undefined);
});

Deno.test('uncertain sends are not blindly retried and can reconcile by Message-ID',async()=>{
 const {db,a}=setup();let sends=0,found=false;
 await fetching(async(url:any)=>{const u=String(url);if(u.includes('oauth2'))return Response.json({access_token:'access-test'});if(u.endsWith('messages/send')){sends++;throw new TypeError('network lost');}if(u.includes('rfc822msgid'))return Response.json({messages:found?[{id:'actually-sent'}]:[]});throw new Error(u);},async()=>{
  const j=await enqueue(db,a,{id:crypto.randomUUID(),to:'friend@example.org',subject:'Hi',body:'Body'});db.tables.eren_mail_outbox[0].status='processing';await deliver(db,{...j,attempts:1});const job=db.tables.eren_mail_outbox[0];assert.equal(job.status,'uncertain');
  await deliver(db,{...job,attempts:2});assert.equal(sends,1);
  assert.equal((await reconcile(db,job)).status,'uncertain');found=true;assert.equal((await reconcile(db,job)).status,'sent');assert.equal(sends,1);
 });
});
Deno.test('cancelled jobs cannot cross the send boundary',async()=>{
 const {db,a}=setup();let sends=0;
 await fetching(async(url:any)=>{if(String(url).includes('oauth2'))return Response.json({access_token:'access-test'});sends++;return Response.json({id:'bad'});},async()=>{
  const j=await enqueue(db,a,{id:crypto.randomUUID(),to:'friend@example.org',subject:'Hi',body:'Body'});db.tables.eren_mail_outbox[0].status='cancelled';await deliver(db,j);assert.equal(sends,0);
 });
});
Deno.test('new-mail history is processed while old mail is still backfilling',async()=>{
 const {db,a}=setup();Object.assign(a,{history_id:'10',backfill_page:'older'});const paths:string[]=[];
 await fetching(async(url:any)=>{const u=String(url);paths.push(u);if(u.includes('oauth2'))return Response.json({access_token:'access'});if(u.includes('/history?'))return Response.json({historyId:'11',history:[{messagesAdded:[{message:{id:'new'}}]}]});if(u.includes('/messages?'))return Response.json({messages:[{id:'old'}],nextPageToken:'older2'});if(u.includes('/messages/new')||u.includes('/messages/old'))return Response.json({id:u.includes('/new')?'new':'old',threadId:'t1',internalDate:'123',payload:{headers:[],mimeType:'text/plain',body:{data:b64url('Hello')}}});throw new Error(u);},async()=>{
  await syncAccount(db,a);assert.equal(db.tables.eren_mail_accounts[0].history_id,'11');assert.equal(db.tables.eren_mail_accounts[0].backfill_page,'older2');assert.equal(db.tables.eren_mail_messages.length,2);assert(paths.findIndex(p=>p.includes('/history?'))<paths.findIndex(p=>p.includes('/messages?')));
 });
});
Deno.test('Gemini receives latest rich draft, preserves formatting contract and errors preserve caller state',async()=>{
 const {db,a}=setup();db.secrets['eren-mail:workspace:config:GEMINI_API_KEY']='gemini-test';db.secrets['eren-mail:workspace:config:GEMINI_MODEL']='configurable-model';const input={body:'I can meet after 4.',bodyHtml:'<p>I can meet <strong>after 4</strong>.</p>',to:'friend@example.org',subject:'Thursday',instruction:'Make warmer'};let got:any;
 await fetching(async(url:any,init:any)=>{assert(String(url).includes('/configurable-model:'));got=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({body:'Warm revision',bodyHtml:'<p><strong>Warm</strong> revision<script>x()</script></p>'})}]}}]});},async()=>{const r=await revise(db,a,input);assert.equal(r.body,'Warm revision');assert.equal(r.bodyHtml,'<p><strong>Warm</strong> revision</p>');});
 const data=JSON.parse(got.contents[0].parts[0].text);assert.equal(data.currentEditableDraft,'I can meet after 4.');assert.equal(data.currentEditableHtml,'<p>I can meet <strong>after 4</strong>.</p>');assert.deepEqual(data.threadContext,[]);assert.equal(got.generationConfig.responseMimeType,'application/json');
 await fetching(async()=>new Response('',{status:429}),async()=>{await assert.rejects(()=>revise(db,a,input));assert.equal(input.body,'I can meet after 4.');});
});

Deno.test('Chinese email translation fetches only an owned Gmail message and retains exact details',async()=>{
 const {db,a}=setup();
 db.secrets['eren-mail:workspace:config:GEMINI_API_KEY']='gemini-test';
 db.secrets['eren-mail:workspace:config:GEMINI_MODEL']='configurable-model';
 let geminiCalls=0,sent:any;
 await fetching(async(url:any,init:any)=>{
   const value=String(url);
   if(value.includes('oauth2'))return Response.json({access_token:'access-test',expires_in:3600});
   if(value.includes('/messages/chinese-id?format=full'))return Response.json({id:'chinese-id',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'作業提醒'}],body:{data:b64url('請在10月12日前繳交作業。') }}});
   if(value.includes('generativelanguage.googleapis.com')){
     geminiCalls++;sent=JSON.parse(init.body);
     return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({subject:'Homework reminder',body:'Submit your homework by October 12.'})}]}}]});
   }
   throw new Error('Unexpected network request: '+value);
 },async()=>{
   const result=await translateMessage(db,a,{messageId:'chinese-id'});
   assert.equal(result.subject,'Homework reminder');
   assert.equal(result.body,'Submit your homework by October 12.');
   assert.equal(geminiCalls,1);
   const data=JSON.parse(sent.contents[0].parts[0].text);
   assert.equal(data.body,'請在10月12日前繳交作業。');
   assert.match(sent.systemInstruction.parts[0].text,/untrusted content/);
   await assert.rejects(()=>translateMessage(db,a,{messageId:'../../other'}));
 });
 clearMailMemory();
});

Deno.test('Gemini repairs HTML returned in the plain body field and keeps paragraph breaks',async()=>{
 const {db,a}=setup();db.secrets['eren-mail:workspace:config:GEMINI_API_KEY']='gemini-test';db.secrets['eren-mail:workspace:config:GEMINI_MODEL']='configurable-model';
 const input={body:'Original draft',bodyHtml:'',to:'friend@example.org',subject:'Update',instruction:'Format this clearly'};
 const malformed='<div style="font-family:Arial"><h2 style="color:#123456">Project Update</h2><p>Progress below:</p><ul><li><strong>Phase 1:</strong> Complete.</li><li><em>Phase 2:</em> Testing.</li></ul><p><strong>Note:</strong> Upload docs.</p></div>';
 await fetching(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({body:malformed,bodyHtml:''})}]}}]}),async()=>{
  const r=await revise(db,a,input);
  assert(!r.body.includes('<div'));assert.match(r.body,/Project Update\n\nProgress below:/);assert.match(r.body,/Phase 1: Complete\.\nPhase 2: Testing\./);
  assert(r.bodyHtml.includes('<h2>Project Update</h2>'));assert(!r.bodyHtml.includes('style='));
 });
});

Deno.test('reply sent later changes inferred Needs reply to Waiting but preserves explicit corrections',()=>{
 const incoming={id:'m1',threadId:'t1',labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'friend@example.org'}],body:{data:b64url('Can you reply?')}}};
 const sent={...incoming,id:'m2',labelIds:['SENT'],payload:{...incoming.payload,body:{data:b64url('Yes, Thursday.')}}};
 assert.equal(threadMessageViews([incoming,sent],[])[0].classification.action,'Waiting');
 assert.equal(threadMessageViews([incoming,sent],[{id:'r1',scope:'thread',match_value:'t1',effects:{action:'Needs reply'}}])[0].classification.action,'Needs reply');
});
Deno.test('large Gmail change pages resume without advancing history early or losing IDs',async()=>{
 const {db,a}=setup();Object.assign(a,{history_id:'10'});let historyRequests=0;
 await fetching(async(url:any)=>{
  const u=String(url);if(u.includes('oauth2'))return Response.json({access_token:'access'});
  if(u.includes('/history?')){historyRequests++;return Response.json({historyId:'99',history:[{messagesAdded:Array.from({length:53},(_,i)=>({message:{id:'m'+i}}))}]});}
  const id=u.match(/\/messages\/(m\d+)/)?.[1];if(id)return Response.json({id,threadId:'t1',internalDate:'123',payload:{headers:[],mimeType:'text/plain',body:{data:b64url('Hello')}}});
  throw new Error(u);
 },async()=>{
  await syncAccount(db,a);assert.equal(a.history_id,'10');assert.equal(a.sync_pending.ids.length,50);assert.equal(db.tables.eren_mail_messages.length,3);
  for(let i=0;i<30&&a.sync_pending;i++)await syncAccount(db,a);
  assert.equal(a.history_id,'99');assert.equal(a.sync_pending,null);assert.equal(db.tables.eren_mail_messages.length,53);assert.equal(historyRequests,1);
 });
});
Deno.test('stale Gmail authorization refreshes once for reads; persistent 401 terminates',async()=>{
 const {db,a}=setup();let refreshes=0,reads=0;
 await fetching(async(url:any)=>{if(String(url).includes('oauth2')){refreshes++;return Response.json({access_token:'token'+refreshes,expires_in:3600});}reads++;return reads===1?Response.json({error:{status:'UNAUTHENTICATED'}},{status:401}):Response.json({ok:true});},async()=>{assert((await (await gmailClient(db,a))('profile')).ok);assert.equal(refreshes,2);assert.equal(reads,2);});
 clearMailMemory();refreshes=0;reads=0;
 await fetching(async(url:any)=>{if(String(url).includes('oauth2')){refreshes++;return Response.json({access_token:'token'+refreshes});}reads++;return Response.json({error:{status:'UNAUTHENTICATED'}},{status:401});},async()=>{await assert.rejects(()=>(gmailClient(db,a).then(api=>api('profile'))));assert.equal(reads,2);assert.equal(refreshes,2);});clearMailMemory();
});
Deno.test('Gmail transient reads retry; sends and permission errors never retry',async()=>{
 const {db,a}=setup();let requests=0;
 await fetching(async(url:any)=>{if(String(url).includes('oauth2'))return Response.json({access_token:'test',expires_in:3600});requests++;return requests===1?Response.json({error:{status:'UNAVAILABLE'}},{status:503}):Response.json({ok:true});},async()=>{assert((await (await gmailClient(db,a))('profile')).ok);assert.equal(requests,2);});
 for(const method of ['GET','POST']){requests=0;await fetching(async()=>{requests++;return Response.json({error:{errors:[{reason:method==='POST'?'backendError':'insufficientPermissions',message:'PRIVATE CONTENT'}]}},{status:method==='POST'?503:403});},async()=>{try{await (await gmailClient(db,a))('messages/send',method,method==='POST'?{raw:'test'}:undefined);throw new Error('Expected failure');}catch(e){assert(!e.message.includes('PRIVATE CONTENT'));assert.equal(e.reason,method==='POST'?'backendError':'insufficientPermissions');}assert.equal(requests,1);});}clearMailMemory();
});
