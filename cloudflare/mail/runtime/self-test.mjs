import { ownedAccount,check } from './provider/services.ts';
import { enqueue,deliver,reconcile } from './provider/jobs.ts';
export const TEST_SUBJECT='Cloudflare mail test';
export const TEST_BODY='This is a test of Eren’s new Cloudflare mail service. No action is needed.';
export async function testId(nonce,accountId) {
 if(!/^[a-f0-9]{64}$/.test(nonce||''))throw new Error('A reviewed mail test session is required');
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nonce+'|'+accountId)));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const text=[...bytes.subarray(0,16)].map(value=>value.toString(16).padStart(2,'0')).join('');return [text.slice(0,8),text.slice(8,12),text.slice(12,16),text.slice(16,20),text.slice(20)].join('-');
}
export async function selfTest(req,admin,env) {
 const route=new URL(req.url).searchParams.get('route'),accountId=new URL(req.url).searchParams.get('accountId');
 const account=await ownedAccount(admin,env.MAIL_WORKSPACE_HASH,accountId),id=await testId(env.MAIL_TEST_NONCE,account.id);
 if(route==='migration/test-send') {
  // Recipient and content are fixed here. The operator cannot send arbitrary
  // messages, add recipients, attach files or use an unrelated account.
  const job=await enqueue(admin,account,{id,to:account.email,subject:TEST_SUBJECT,body:TEST_BODY,bodyHtml:'',attachments:[]});
  if(job.status==='pending')for(const claimed of check(await admin.rpc('eren_mail_claim',{p_id:id})))await deliver(admin,claimed);
 }
 let job=check(await admin.from('eren_mail_outbox').select('*').eq('id',id).eq('workspace_hash',env.MAIL_WORKSPACE_HASH).maybeSingle());
 if(!job)return {status:'not_started',provider:account.provider};
 if(route==='migration/test-check')job=await reconcile(admin,job);
 return {status:job.status,provider:account.provider,sentAt:job.sent_at||null,error:job.error||null};
}
