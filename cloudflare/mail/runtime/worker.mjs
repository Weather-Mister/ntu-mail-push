import { handle } from './provider/index.ts';
import { tick } from './provider/jobs.ts';
import { MailDatabase } from './database.mjs';
import { mailSchema } from './schema.mjs';
import { withMailContext } from './context.mjs';
import { FileStore } from '../src/sqlite-files.mjs';
import { importMail } from './import.mjs';
import { allInboxes } from './inboxes.mjs';
import { ntuList } from './provider/ntu.ts';
import { selfTest } from './self-test.mjs';
import { MailError } from './provider/services.ts';
import { revise } from './provider/services.ts';
const encoder=new TextEncoder();
const reads=new Set(['bootstrap','status','accounts','cached-mail','mail','thread','attachment','drafts','outbox','preferences','rules']);
const connectApproved=env=>env.MAIL_MODE==='staging'&&env.MAIL_CONNECT_TESTS_ALLOWED==='true'&&Number(env.MAIL_CONNECT_TEST_UNTIL)>Date.now();
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
async function paired(req,env) {
 const key=req.headers.get('x-schedule-key')||'';if(key.length<32||key.length>200||!/^[a-f0-9]{64}$/.test(env.MAIL_KEY_HASH||''))return false;
 const supplied=await hash(key);let mismatch=0;for(let i=0;i<64;i++)mismatch|=supplied.charCodeAt(i)^env.MAIL_KEY_HASH.charCodeAt(i);return mismatch===0;
}
async function migrationAccess(req,env) {
 const key=req.headers.get('x-mail-stage-key')||'';if(key.length!==64||!/^[a-f0-9]{64}$/.test(env.MAIL_STAGE_KEY_HASH||''))return false;
 const supplied=await hash(key);let mismatch=0;for(let i=0;i<64;i++)mismatch|=supplied.charCodeAt(i)^env.MAIL_STAGE_KEY_HASH.charCodeAt(i);return mismatch===0;
}
export function routeOf(req){const url=new URL(req.url);return url.searchParams.get('route')||url.pathname.split('/eren-mail/')[1]||'';}
function reply(req,env,data,status) {
 const origin=req.headers.get('Origin')||'',allowed=(env.ALLOWED_ORIGINS||'').split(',');
 return Response.json(data,{status,headers:{'Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'content-type,x-schedule-key','Access-Control-Allow-Methods':'GET,POST,OPTIONS',...(origin&&allowed.includes(origin)?{'Access-Control-Allow-Origin':origin}:{})}});
}
async function gate(req,env) {
 const origin=req.headers.get('Origin');if(origin&&!(env.ALLOWED_ORIGINS||'').split(',').includes(origin))return reply(req,env,{error:'Origin not allowed.'},403);
 if(req.method==='OPTIONS')return reply(req,env,{ok:true},200);
 if(!['eren','begum'].includes(env.APP_SLUG)||!/^https:\/\//.test(env.MAIL_BASE_URL||''))return reply(req,env,{error:'Mail service not configured.'},503);
 const route=routeOf(req);
 if(['migration/live-health','migration/ntu-read-check'].includes(route))return req.method==='GET'&&await migrationAccess(req,env)?null:reply(req,env,{error:'Maintenance authorization required.'},403);
 if(route==='migration/ai-check')return env.MAIL_MODE==='staging'&&req.method==='GET'&&await migrationAccess(req,env)?null:reply(req,env,{error:'Migration authorization required.'},403);
 if(route==='migration/connect-ready')return env.MAIL_MODE==='staging'&&req.method==='GET'&&await migrationAccess(req,env)?null:reply(req,env,{error:'Migration authorization required.'},403);
 if(['oauth/start','oauth/finish','oauth/callback'].includes(route)&&env.MAIL_MODE==='staging')return connectApproved(env)&&req.method===(route==='oauth/callback'?'GET':'POST')&&(route==='oauth/callback'||await migrationAccess(req,env))?null:reply(req,env,{error:'Controlled Gmail connection testing is not enabled.'},403);
 if(route==='migration/test-ready')return env.MAIL_MODE==='staging'&&req.method==='GET'&&await migrationAccess(req,env)?null:reply(req,env,{error:'Migration authorization required.'},403);
 if(['migration/test-send','migration/test-check'].includes(route))return env.MAIL_MODE==='staging'&&env.MAIL_TESTS_ALLOWED==='true'&&req.method===(route==='migration/test-send'?'POST':'GET')&&await migrationAccess(req,env)?null:reply(req,env,{error:'Explicit mail test approval required.'},403);
 if(route==='migration/import')return env.MAIL_MODE==='staging'&&req.method==='POST'&&await migrationAccess(req,env)?null:reply(req,env,{error:'Migration authorization required.'},403);
 if(route==='worker'||route==='ntu/import')return reply(req,env,{error:'Internal mail jobs are not public routes.'},404);
 if(env.MAIL_MODE!=='live'&&(req.method!=='GET'||!reads.has(route)))return reply(req,env,{error:'Mail staging blocks provider changes and sending.'},403);
 if(route!=='oauth/callback'&&!await paired(req,env)&&!(env.MAIL_MODE==='staging'&&reads.has(route)&&await migrationAccess(req,env)))return reply(req,env,{error:'Pair this device with your private Mail access key.'},401);
 return null;
}
export default {
 async fetch(req,env) {
  const blocked=await gate(req,env);if(blocked)return blocked;
  const stub=env.MAIL_STORE.get(env.MAIL_STORE.idFromName(env.APP_SLUG)),selected=new URL(req.url).searchParams.get('accountId');
  // A running Durable Object can retain its constructor environment after a
  // secret-only update. Forward the current test permission only after the
  // gateway has authenticated this request. Client-supplied values are replaced.
  const headers=new Headers(req.headers);
  headers.set('x-mail-runtime-mode',env.MAIL_MODE==='live'?'live':'staging');
  headers.set('x-mail-runtime-jobs',env.MAIL_MODE==='live'&&env.MAIL_JOBS_ENABLED==='true'?'true':'false');
  headers.delete('x-mail-approved-test-nonce');
  headers.delete('x-mail-approved-connect-until');
  if(connectApproved(env)&&['migration/connect-ready','oauth/start','oauth/callback','oauth/finish'].includes(routeOf(req)))headers.set('x-mail-approved-connect-until',env.MAIL_CONNECT_TEST_UNTIL);
  if(['migration/test-ready','migration/test-send','migration/test-check'].includes(routeOf(req))&&env.MAIL_MODE==='staging'&&env.MAIL_TESTS_ALLOWED==='true'&&/^[a-f0-9]{64}$/.test(env.MAIL_TEST_NONCE||''))headers.set('x-mail-approved-test-nonce',env.MAIL_TEST_NONCE);
  if(routeOf(req)==='migration/test-send') {
   // The endpoint never forwards arbitrary caller content to the sender.
   // Drain a bounded body before dispatch so early ownership failures can
   // respond cleanly even through the local runtime's streaming proxy.
   const reader=req.body?.getReader();let size=0;
   if(reader)while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>150000){await reader.cancel();return reply(req,env,{error:'Test request is too large.'},413);}}
   req=new Request(req.url,{method:req.method,headers});
  }else req=new Request(req,{headers});
  if(routeOf(req)==='migration/test-ready'){
   const result=await stub.fetch(req);if(!result.ok)return result;
   return Response.json({gatewayApproved:env.MAIL_TESTS_ALLOWED==='true',...await result.json()},{headers:{'Cache-Control':'no-store'}});
  }
  if(routeOf(req)==='migration/connect-ready'){
   const result=await stub.fetch(req);if(!result.ok)return result;
   return Response.json({gatewayApproved:connectApproved(env),...await result.json()},{headers:{'Cache-Control':'no-store'}});
  }
  if(routeOf(req)==='mail'&&req.method==='GET'&&(!selected||selected==='all'))return allInboxes(req,stub);
  return stub.fetch(req);
 },
 async scheduled(_event,env,ctx) {
  if(env.MAIL_MODE!=='live'||env.MAIL_JOBS_ENABLED!=='true')return;
  ctx.waitUntil(env.MAIL_STORE.get(env.MAIL_STORE.idFromName(env.APP_SLUG)).fetch('https://mail.internal/tick',{method:'POST',headers:{'x-mail-runtime-mode':'live','x-mail-runtime-jobs':'true'}}));
 }
};
export class MailStore {
 constructor(state,env) {
  this.state=state;this.env=env;this.sql=state.storage.sql;this.sql.exec(mailSchema);
  if(!/^[a-f0-9]{64}$/.test(env.MAIL_WORKSPACE_HASH||''))throw new Error('Mail owner not configured');
  this.sql.exec('INSERT OR IGNORE INTO schedule_workspaces(workspace_hash,app_slug) VALUES(?,?)',env.MAIL_WORKSPACE_HASH,env.APP_SLUG);
  const owners=this.sql.exec('SELECT workspace_hash,app_slug FROM schedule_workspaces').toArray();
  if(owners.length!==1||owners[0].app_slug!==env.APP_SLUG||owners[0].workspace_hash!==env.MAIL_WORKSPACE_HASH)throw new Error('Mail ownership mismatch');
  this.admin=new MailDatabase(state,env);this.ticking=false;
 }
 async fetch(req) {
  // The private binding receives mode flags replaced by the authenticated
  // gateway, so warm objects observe a cutover/rollback without stale flags.
  const runtimeEnv={...this.env,MAIL_MODE:req.headers.get('x-mail-runtime-mode')==='live'?'live':'staging',MAIL_JOBS_ENABLED:req.headers.get('x-mail-runtime-jobs')==='true'?'true':'false'};
  if(new URL(req.url).hostname==='mail.internal'&&new URL(req.url).pathname==='/tick'&&req.method==='POST') {
   if(runtimeEnv.MAIL_MODE!=='live'||runtimeEnv.MAIL_JOBS_ENABLED!=='true')return new Response(null,{status:403});
   if(this.ticking)return new Response(null,{status:409});this.ticking=true;
   try{return await withMailContext({env:{...runtimeEnv,MAIL_NTU_BACKGROUND:true},state:this.state,admin:this.admin,origin:''},async()=>Response.json(await tick(this.admin)))}
   catch{return Response.json({error:'Mail worker paused; no job is automatically replayed.'},{status:503})}finally{this.ticking=false}
  }
  const currentNonce=req.headers.get('x-mail-approved-test-nonce');
  const connectUntil=req.headers.get('x-mail-approved-connect-until');
  const requestEnv={...runtimeEnv,MAIL_NTU_BACKGROUND:['mail','cached-mail'].includes(routeOf(req)),MAIL_CONNECT_TESTS_ALLOWED:Number(connectUntil)>Date.now()?'true':'false',MAIL_CONNECT_TEST_UNTIL:connectUntil||'0'};
  const testEnv={...requestEnv,MAIL_TESTS_ALLOWED:/^[a-f0-9]{64}$/.test(currentNonce||'')?'true':'false',MAIL_TEST_NONCE:currentNonce||''};
  const blocked=await gate(req,['migration/test-ready','migration/test-send','migration/test-check'].includes(routeOf(req))?testEnv:requestEnv);if(blocked)return blocked;
  if(routeOf(req)==='migration/ntu-read-check')return withMailContext({env:requestEnv,state:this.state,admin:this.admin,origin:''},async()=>{
   const account=this.sql.exec("SELECT * FROM eren_mail_accounts WHERE provider='ntu'").toArray()[0];if(!account)return Response.json({present:false},{status:404});
   try{let cursor='',counts=[];for(let page=0;page<3;page++){const result=await ntuList(this.admin,{...account,provider_state:JSON.parse(account.provider_state||'{}')},'inbox','',cursor);counts.push(result.messages.length);cursor=result.next||'';if(!cursor)break;}return Response.json({passed:true,provider:'ntu',accountStatus:account.status,inboxCount:counts[0],paginationCounts:counts,hasNext:!!cursor,readOnly:true,emailsSent:0});}
   catch(error){return Response.json({passed:false,provider:'ntu',accountStatus:account.status,code:error instanceof MailError?error.code:'internal_error',error:error instanceof MailError?error.message:'NTU read failed.',readOnly:true,emailsSent:0},{status:error instanceof MailError?error.status:503});}
  });
  if(routeOf(req)==='migration/live-health'){
   const health=this.sql.exec("SELECT last_started_at,last_finished_at,result FROM eren_mail_health WHERE id='worker'").toArray()[0]||null;
   return Response.json({mode:requestEnv.MAIL_MODE,jobsEnabled:requestEnv.MAIL_JOBS_ENABLED==='true',accounts:this.sql.exec('SELECT count(*) AS n FROM eren_mail_accounts').one().n,pendingOrUncertainJobs:this.sql.exec("SELECT count(*) AS n FROM eren_mail_outbox WHERE status IN ('pending','processing','sending','uncertain')").one().n,sentJobs:this.sql.exec("SELECT count(*) AS n FROM eren_mail_outbox WHERE status='sent'").one().n,cachedMessages:this.sql.exec('SELECT count(*) AS n FROM eren_mail_messages').one().n,health:health?{...health,result:JSON.parse(health.result||'{}')}:null},{headers:{'Cache-Control':'no-store'}});
  }
  if(routeOf(req)==='migration/ai-check')return withMailContext({env:requestEnv,state:this.state,admin:this.admin,origin:''},async()=>{
   const account=this.sql.exec("SELECT * FROM eren_mail_accounts WHERE provider='gmail' ORDER BY id LIMIT 1").toArray()[0];
   if(!account)return Response.json({passed:false,error:'No owned Gmail account.'},{status:503});
   try{const revision=await revise(this.admin,account,{instruction:'Rewrite this one-sentence test draft clearly. Keep its meaning.',body:'This is a test of the existing AI draft connection.',bodyHtml:'<p>This is a test of the existing AI draft connection.</p>',subject:'Migration AI check',to:''});return Response.json({passed:!!revision.body,provider:'existing Gemini configuration',syntheticInputOnly:true,emailsSent:0,providerMailboxChanges:0,sourceChanges:0});}
   catch(error){return Response.json({passed:false,error:error instanceof MailError?error.message:'AI compatibility check failed.',syntheticInputOnly:true,emailsSent:0},{status:error instanceof MailError?error.status:503});}
  });
  if(routeOf(req)==='migration/connect-ready')return Response.json({objectApproved:connectApproved(requestEnv)},{headers:{'Cache-Control':'no-store'}});
  if(routeOf(req)==='migration/test-ready')return Response.json({objectApproved:testEnv.MAIL_TESTS_ALLOWED==='true',nonceConfigured:/^[a-f0-9]{64}$/.test(testEnv.MAIL_TEST_NONCE||'')},{headers:{'Cache-Control':'no-store'}});
  if(routeOf(req)==='migration/import') {
   if(this.importing)return Response.json({error:'Migration already running.'},{status:409});this.importing=true;
   try{return Response.json(await importMail(req,this.admin,this.env))}catch{return Response.json({error:'Mail migration validation failed. Source data is unchanged.'},{status:503})}finally{this.importing=false}
  }
  const migrationWorkspace=requestEnv.MAIL_MODE==='staging'&&await migrationAccess(req,requestEnv)?requestEnv.MAIL_WORKSPACE_HASH:null;
  return withMailContext({env:requestEnv,state:this.state,admin:this.admin,origin:req.headers.get('Origin')||'',migrationWorkspace},async()=>{
   if(['migration/test-send','migration/test-check'].includes(routeOf(req))) {
    try{return Response.json(await selfTest(req,this.admin,testEnv))}catch(error){return Response.json({error:'The controlled test could not complete; check Outbox before retrying.'},{status:error instanceof MailError?error.status:503})}
   }
   return handle(req);
  });
 }
}
export class MailAttachments extends FileStore {
 constructor(state,env){super(state,{...env,FILE_OBJECT_MAX_BYTES:20*1024*1024,FILE_UPLOAD_CONCURRENCY:1});}
}
