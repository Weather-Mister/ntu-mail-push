import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MailDatabase } from './runtime/database.mjs';
import { mailSchema } from './runtime/schema.mjs';
const workspace='1'.repeat(64),account='12345678-1234-1234-1234-123456789012';
function setup() {
 const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON;');database.exec(mailSchema);
 const sql={databaseSize:0,exec(query,...values){const statement=database.prepare(query);values=values.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value);const rows=statement.columns().length?statement.all(...values):(statement.run(...values),[]);return {toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0]}}}};
 const state={storage:{sql,transactionSync(fn){database.exec('BEGIN;');try{const value=fn();database.exec('COMMIT;');return value}catch(error){database.exec('ROLLBACK;');throw error}}}};
 const admin=new MailDatabase(state,{APP_SLUG:'eren',MAIL_WORKSPACE_HASH:workspace,MAIL_ENCRYPTION_KEY:'a'.repeat(64)});
 sql.exec('INSERT INTO schedule_workspaces(workspace_hash,app_slug) VALUES(?,?)',workspace,'eren');
 return {database,sql,admin};
}
const good=result=>{assert.equal(result.error,null);return result.data;};
test('Cloudflare mail: ownership filters, JSON data, large ID lists and conditional leases',async()=>{
 const {database,admin}=setup();try {
  good(await admin.from('eren_mail_accounts').insert({id:account,workspace_hash:workspace,email:'fixture@example.invalid',display_name:'Fixture',secret_name:`eren-mail:${workspace}:account:${account}`}).select('*').single());
  const created=good(await admin.from('eren_mail_accounts').select('*').eq('id',account).single());assert.deepEqual(created.provider_state,{});
  assert.equal(good(await admin.from('eren_mail_accounts').select('*').eq('workspace_hash','2'.repeat(64)).maybeSingle()),null);
  const now=new Date().toISOString();
  const claims=await Promise.all(['lease-a','lease-b'].map(lease=>admin.from('eren_mail_accounts').update({sync_lock_id:lease,sync_lock_until:new Date(Date.now()+120000).toISOString()}).eq('id',account).or('sync_lock_until.is.null,sync_lock_until.lt.'+now).select('id').maybeSingle()));
  assert.equal(claims.filter(result=>good(result)).length,1);
  const row={account_id:account,id:'message',thread_id:'thread',sender:'fixture@example.invalid',sender_name:'Fixture',subject:'Synthetic',snippet:'Synthetic',internal_date:1,labels:['INBOX','UNREAD'],classification:{priority:'High'},provider_ref:{mailbox:'INBOX',uid:'5'}};
  good(await admin.from('eren_mail_messages').upsert(row,{onConflict:'account_id,id'}));
  const rows=good(await admin.from('eren_mail_messages').select('*').contains('labels',['INBOX','UNREAD']).in('id',['message',...Array.from({length:200},(_,i)=>String(i))]));assert.equal(rows.length,1);assert.deepEqual(rows[0].provider_ref,row.provider_ref);
  good(await admin.rpc('eren_mail_apply_cache_actions',{p_actions:[{accountId:account,threadId:'thread',action:'trash'}]}));
  assert.deepEqual(good(await admin.from('eren_mail_messages').select('labels').single()).labels,['UNREAD','TRASH']);
  assert.notEqual((await admin.from('eren_mail_messages').select('secret')).error,null);
 }finally{database.close()}
});
test('Cloudflare mail: atomic outbox claim never automatically replays an uncertain delivery',async()=>{
 const {database,admin}=setup();try {
  good(await admin.from('eren_mail_accounts').insert({id:account,workspace_hash:workspace,email:'fixture@example.invalid',display_name:'Fixture',secret_name:`eren-mail:${workspace}:account:${account}`}));
  const jobs=['pending','sending','uncertain','sent'].map((status,index)=>({id:'job-'+index,workspace_hash:workspace,account_id:account,to_address:'fixture@example.invalid',subject:'Synthetic',secret_name:`eren-mail:${workspace}:outbox:${index}`,payload_hash:'synthetic',rfc_message_id:'fixture-'+index,send_at:'2026-01-01T00:00:00.000Z',status}));
  good(await admin.from('eren_mail_outbox').insert(jobs));
  const results=await Promise.all(Array.from({length:8},()=>admin.rpc('eren_mail_claim',{})));
  assert.deepEqual(results.flatMap(good).map(row=>row.id),['job-0']);assert.equal(good(results.find(result=>result.data.length)).at(0).attempts,1);
  assert.equal(good(await admin.rpc('eren_mail_claim',{p_id:'job-2'})).length,0);
  const limits=await Promise.all(Array.from({length:8},()=>admin.rpc('eren_mail_rate',{p_bucket:'test',p_limit:3,p_seconds:60})));assert.equal(limits.filter(result=>good(result)).length,3);
 }finally{database.close()}
});
test('Cloudflare mail: encrypted secrets span SQLite-safe rows and reject wrong owners or tampering',async()=>{
 const {database,sql,admin}=setup();try {
  const name=`eren-mail:${workspace}:config:fixture`,value='𝄞 secret fixture '.repeat(80000);
  good(await admin.rpc('eren_mail_secret',{p_name:name,p_value:value}));
  const parts=sql.exec('SELECT iv,ciphertext FROM mail_secret_parts WHERE name=?',name).toArray();assert.ok(parts.length>1);assert.ok(parts.every(part=>part.ciphertext.byteLength<2*1024*1024));
  assert.equal(good(await admin.rpc('eren_mail_secret',{p_name:name})),value);
  assert.ok(!new TextDecoder().decode(parts[0].ciphertext).includes('secret fixture'));
  assert.notEqual((await admin.rpc('eren_mail_secret',{p_name:`eren-mail:${'2'.repeat(64)}:config:fixture`,p_value:'other'})).error,null);
  sql.exec('UPDATE mail_secret_parts SET ciphertext=? WHERE name=? AND part=0',new Uint8Array(20).buffer,name);
  assert.notEqual((await admin.rpc('eren_mail_secret',{p_name:name})).error,null);
  good(await admin.rpc('eren_mail_secret',{p_name:name,p_delete:true}));assert.equal(sql.exec('SELECT count(*) AS n FROM mail_secret_parts').one().n,0);
 }finally{database.close()}
});
