import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest('hex');
test('Begüm Gmail flow preserves Cloudflare callback, PKCE, browser proof, account identity and callback replay rejection',async()=>{
 let source=stripTypeScriptTypes(readFileSync(new URL('../cloudflare/mail/runtime/provider/oauth.ts',import.meta.url),'utf8'));
 source=source.replace(/^import[^;]*;\s*/gm,'').replaceAll('export async function','async function');
 const oauth=[],accounts=[{id:'fixture-existing',workspace_hash:'fixture-owner',provider:'gmail',email:'fixture@example.invalid',display_name:'Saved name'}],secrets=new Map();let exchanged=0;
 const admin={from(table){const rows=table==='eren_mail_oauth'?oauth:accounts;let filters=[],update=null;const chain={insert(row){rows.push({...row,status:'waiting',expires_at:new Date(Date.now()+60000).toISOString()});return Promise.resolve({data:null});},upsert(row){Object.assign(accounts[0],row);return Promise.resolve({data:null});},update(row){update=row;return chain;},select(){return chain;},eq(key,value){filters.push(row=>row[key]===value);return chain;},gt(key,value){filters.push(row=>row[key]>value);return chain;},async maybeSingle(){const row=rows.find(row=>filters.every(f=>f(row)));if(row&&update)Object.assign(row,update);return {data:row?{...row}:null};},then(done){return chain.maybeSingle().then(done);}};return chain;}};
 class MailError extends Error{constructor(status,message){super(message);this.status=status;}}
 const registered='https://begum-mail-api.begum-schedule-fb773613.workers.dev/eren-mail/oauth/callback';
 const context={URL,Response,Date,crypto,TextEncoder,AbortSignal,MailError,environment:()=>({MAIL_OAUTH_STATE_PREFIX:'begumCF-',MAIL_MODE:'live'}),check:value=>value.data,config:async()=>({GOOGLE_CLIENT_ID:'synthetic.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'synthetic'}),hash:async s=>digest(s),random:()=> 'x'.repeat(43),REDIRECT:()=>registered,SCOPES:'https://www.googleapis.com/auth/gmail.modify',b64url:bytes=>Buffer.from(bytes).toString('base64url'),siteFor:async()=> 'https://weather-mister.github.io/ntu-mail-push/begum/',tokenRequest:async input=>{exchanged++;assert.equal(input.redirect_uri,registered);return {access_token:'synthetic',refresh_token:'synthetic-refresh',scope:'https://www.googleapis.com/auth/gmail.modify'};},secret:async(_admin,name,value)=>{if(value)secrets.set(name,value);return secrets.get(name);},fetch:async()=>Response.json({emailAddress:'fixture@example.invalid'})};
 runInNewContext(source+'\nthis.hooks={oauthStart,oauthCallback,oauthFinish};',context);
 const started=await context.hooks.oauthStart(admin,'fixture-owner',{challenge:digest('local-proof')});const authorize=new URL(started.url);assert.equal(started.state.length,43);assert(started.state.startsWith('begumCF-'));assert.equal(authorize.searchParams.get('redirect_uri'),registered);assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
 const callback=new URL('https://mail.invalid/?'+new URLSearchParams({state:started.state,code:'synthetic'}));const response=await context.hooks.oauthCallback(admin,callback);assert.equal(response.status,303);assert(response.headers.get('Location').startsWith('https://weather-mister.github.io/ntu-mail-push/begum/'));
 await assert.rejects(context.hooks.oauthCallback(admin,callback),error=>error.status===400);assert.equal(exchanged,1);
 await assert.rejects(context.hooks.oauthFinish(admin,'fixture-owner',{state:started.state,proof:'wrong'}),error=>error.status===400);
 assert.equal((await context.hooks.oauthFinish(admin,'fixture-owner',{state:started.state,proof:'local-proof'})).connected,true);assert.equal(accounts.length,1);assert.equal(accounts[0].id,'fixture-existing');assert.equal(accounts[0].display_name,'Saved name');
});
