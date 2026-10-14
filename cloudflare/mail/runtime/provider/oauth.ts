import { environment } from '../context.mjs';
import { check, config, secret, hash, random, REDIRECT, SCOPES, siteFor, tokenRequest, MailError } from './services.ts';
import { b64url } from './domain.mjs';
export async function oauthStart(admin:any,workspace:string,input:any) {
 if(!/^[a-f0-9]{64}$/.test(input.challenge||'')) throw new MailError(400,'Invalid browser proof.');
 const cfg=await config(admin,workspace);
 if(!cfg.GOOGLE_CLIENT_ID||!cfg.GOOGLE_CLIENT_SECRET) throw new MailError(503,'Add your Google OAuth app in Mail Settings first.');
 const state=(String(environment().MAIL_OAUTH_STATE_PREFIX||'')+random()).slice(0,43),verifier=random();
 check(await admin.from('eren_mail_oauth').insert({state_hash:await hash(state),workspace_hash:workspace,browser_challenge:input.challenge,verifier}));
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 const params={client_id:cfg.GOOGLE_CLIENT_ID,redirect_uri:REDIRECT(),response_type:'code',scope:SCOPES,access_type:'offline',prompt:'consent select_account',state,code_challenge:b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),code_challenge_method:'S256'};
 for(const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
 return {url:url.href,state};
}
export async function oauthCallback(admin:any,url:URL) {
 const state=url.searchParams.get('state')||'';
 if(!/^[\w-]{43}$/.test(state)) throw new MailError(400,'Invalid or expired OAuth request.');
 const stateHash=await hash(state);
 // Consume the callback atomically; duplicate callbacks cannot exchange the code twice.
 const row=check(await admin.from('eren_mail_oauth').update({status:'exchanging'}).eq('state_hash',stateHash).eq('status','waiting').gt('expires_at',new Date().toISOString()).select('*').maybeSingle());
 if(!row) throw new MailError(400,'OAuth request expired. Return to Mail and connect again.');
 const site=await siteFor(admin,row.workspace_hash);
 try {
  if(url.searchParams.has('error')) throw new MailError(400,'Google authorization was cancelled.');
  const code=url.searchParams.get('code');if(!code) throw new MailError(400,'Missing authorization code.');
  const cfg=await config(admin,row.workspace_hash);
  const token=await tokenRequest({client_id:cfg.GOOGLE_CLIENT_ID,client_secret:cfg.GOOGLE_CLIENT_SECRET,code,code_verifier:row.verifier,redirect_uri:REDIRECT(),grant_type:'authorization_code'});
  if(!token.refresh_token||!String(token.scope||'').split(' ').includes(SCOPES)) throw new MailError(400,'Gmail permission was not granted. Reconnect and allow mail access.');
  const profileResponse=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
  if(!profileResponse.ok) throw new MailError(502,'Could not verify this Gmail account.');
  const profile=await profileResponse.json();
  if(environment().MAIL_MODE==='staging'&&environment().MAIL_CONNECT_TESTS_ALLOWED==='true'){const existing=check(await admin.from('eren_mail_accounts').select('id').eq('workspace_hash',row.workspace_hash).eq('provider','gmail').eq('email',String(profile.emailAddress).toLowerCase()).maybeSingle());if(!existing)throw new MailError(400,'This staging test reconnects only an existing Gmail account.');}
  const name=`eren-mail:${row.workspace_hash}:oauth:${stateHash}`;
  await secret(admin,name,token.refresh_token);
  check(await admin.from('eren_mail_oauth').update({status:'ready',pending_secret:name,email:String(profile.emailAddress).toLowerCase(),scopes:token.scope,verifier:''}).eq('state_hash',stateHash));
  // No OAuth code, token, pairing key or browser proof reaches the return URL.
  return Response.redirect(site+'?open=mail&connected=1',303);
 } catch(e) {
  check(await admin.from('eren_mail_oauth').update({status:'failed',verifier:''}).eq('state_hash',stateHash));
  return Response.redirect(site+'?open=mail&connect_error=1',303);
 }
}
export async function oauthFinish(admin:any,workspace:string,input:any) {
 const stateHash=await hash(String(input.state||''));
 const row=check(await admin.from('eren_mail_oauth').select('*').eq('state_hash',stateHash).eq('workspace_hash',workspace).gt('expires_at',new Date().toISOString()).maybeSingle());
 if(!row||row.browser_challenge!==await hash(String(input.proof||''))) throw new MailError(400,'This connection must be completed on the device where it started.');
 if(row.status==='failed') throw new MailError(400,'Google authorization was not completed. Please reconnect.');
 if(row.status==='waiting'||row.status==='exchanging') return {pending:true};
 if(row.status==='done') return {connected:true,email:row.email};
 if(row.status!=='ready') throw new MailError(409,'Connection is being saved. Try again shortly.');
 const claimed=check(await admin.from('eren_mail_oauth').update({status:'saving'}).eq('state_hash',stateHash).eq('status','ready').select('state_hash').maybeSingle());
 if(!claimed) return {pending:true};
 try {
  const existing=check(await admin.from('eren_mail_accounts').select('id,display_name,provider').eq('workspace_hash',workspace).eq('email',row.email).maybeSingle());
  if(existing?.provider==='ntu')throw new MailError(409,'This address is already connected as NTU Mail.');
  const id=existing?.id||crypto.randomUUID(),name=`eren-mail:${workspace}:account:${id}`;
  const refresh=await secret(admin,row.pending_secret);
  if(!refresh) throw new MailError(400,'Connection expired. Reconnect.');
  await secret(admin,name,refresh);
  check(await admin.from('eren_mail_accounts').upsert({id,workspace_hash:workspace,provider:'gmail',email:row.email,display_name:existing?.display_name||row.email,secret_name:name,status:'active',sync_error:null},{onConflict:'workspace_hash,email'}));
  check(await admin.from('eren_mail_oauth').update({status:'done'}).eq('state_hash',stateHash));
  await secret(admin,row.pending_secret,null,true);
  return {connected:true,email:row.email};
 } catch(e) { await admin.from('eren_mail_oauth').update({status:'ready'}).eq('state_hash',stateHash); throw e; }
}

