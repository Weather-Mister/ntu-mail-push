const assert:any=Object.assign((ok:any,message='Assertion failed')=>{if(!ok)throw new Error(message);},{
 equal:(a:any,b:any)=>{if(a!==b)throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);},
 match:(s:string,r:RegExp)=>{if(!r.test(s))throw new Error('Pattern did not match');},
 deepEqual:(a:any,b:any)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Not deeply equal');},
 rejects:async(fn:any)=>{let rejected=false;try{await fn();}catch{rejected=true;}if(!rejected)throw new Error('Expected rejection');}
});
import { safeHtml, workspaceFor, hash, revise, threadMessageViews } from '../supabase/functions/eren-mail/services.ts';
import { deliver, enqueue, reconcile, syncAccount } from '../supabase/functions/eren-mail/jobs.ts';
import { oauthStart, oauthFinish } from '../supabase/functions/eren-mail/oauth.ts';
import { publicIPv4 } from '../supabase/functions/eren-mail/unsubscribe.ts';
import { decodeBody, b64url } from '../supabase/functions/eren-mail/domain.mjs';
class MemoryDB {
 tables:any={};secrets:any={};
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
function setup(){const db=new MemoryDB(),a={id:'11111111-1111-4111-8111-111111111111',workspace_hash:'workspace',email:'me@example.org',secret_name:'eren-mail:workspace:account:1',status:'active'};db.tables.eren_mail_accounts.push(a);db.secrets[a.secret_name]='refresh-test';db.secrets['eren-mail:workspace:config:GOOGLE_CLIENT_ID']='client';db.secrets['eren-mail:workspace:config:GOOGLE_CLIENT_SECRET']='secret-test';return {db,a};}
async function fetching(fn:any,run:any){const old=globalThis.fetch;globalThis.fetch=fn;try{await run();}finally{globalThis.fetch=old;}}
Deno.test('HTML mail cannot execute scripts, forms, remote images or CSS tracking',()=>{
 const html=safeHtml('<script>steal()</script><img src="https://track.example.org/x"><style>@import url(https://track.test)</style><form action="https://evil.test"><input></form><a href="javascript:alert(1)">bad</a><a href="https://example.org">safe</a><p onmouseover="steal()">Hello</p><svg onload="steal()"></svg>');
 assert(!html.includes('steal'));assert(!html.includes('javascript:'));assert(!html.includes('track.'));assert(!html.includes('<form'));assert(!html.includes('<svg'));assert(html.includes("default-src 'none'"));assert(html.includes('Hello'));
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
Deno.test('Gemini receives latest edited body and only requested thread; errors preserve caller state',async()=>{
 const {db,a}=setup();db.secrets['eren-mail:workspace:config:GEMINI_API_KEY']='gemini-test';db.secrets['eren-mail:workspace:config:GEMINI_MODEL']='configurable-model';const input={body:'I can meet after 4.',to:'friend@example.org',subject:'Thursday',instruction:'Make warmer'};let got:any;
 await fetching(async(url:any,init:any)=>{assert(String(url).includes('/configurable-model:'));got=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Warm revision'}]}}]});},async()=>{assert.equal((await revise(db,a,input)).body,'Warm revision');});
 const data=JSON.parse(got.contents[0].parts[0].text);assert.equal(data.currentEditableDraft,'I can meet after 4.');assert.deepEqual(data.threadContext,[]);
 await fetching(async()=>new Response('',{status:429}),async()=>{await assert.rejects(()=>revise(db,a,input));assert.equal(input.body,'I can meet after 4.');});
});

Deno.test('reply sent later changes inferred Needs reply to Waiting but preserves explicit corrections',()=>{
 const incoming={id:'m1',threadId:'t1',labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'friend@example.org'}],body:{data:b64url('Can you reply?')}}};
 const sent={...incoming,id:'m2',labelIds:['SENT'],payload:{...incoming.payload,body:{data:b64url('Yes, Thursday.')}}};
 assert.equal(threadMessageViews([incoming,sent],[])[0].classification.action,'Waiting');
 assert.equal(threadMessageViews([incoming,sent],[{id:'r1',scope:'thread',match_value:'t1',effects:{action:'Needs reply'}}])[0].classification.action,'Needs reply');
});
