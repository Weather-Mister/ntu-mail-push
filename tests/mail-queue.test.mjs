import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('Postgres claims enforce retry budget after hard crashes and preserve recoverable jobs',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create table public.eren_mail_outbox(id uuid primary key,status text not null,attempts int not null default 0,
    send_at timestamptz not null default now(),locked_until timestamptz,error text,secret_name text default 'preserved');`);
  await db.exec(readFileSync('supabase/migrations/20261010052955_eren_mail_retry_budget.sql','utf8'));
  const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
  await db.query('insert into eren_mail_outbox(id,status) values ($1,$2)',[id(1),'pending']);
  for(let attempt=1;attempt<=5;attempt++) {
   const {rows}=await db.query('select * from eren_mail_claim()');
   assert.equal(rows.length,1);assert.equal(rows[0].attempts,attempt);assert.equal(rows[0].status,'processing');
   assert.equal((await db.query('select * from eren_mail_claim()')).rows.length,0,'live lease must not be stolen');
   // Simulate an uncatchable memory termination followed by lease expiry.
   await db.query("update eren_mail_outbox set locked_until=now()-interval '1 second' where id=$1",[id(1)]);
  }
  for(let tick=0;tick<50;tick++)assert.equal((await db.query('select * from eren_mail_claim()')).rows.length,0);
  const failed=(await db.query('select * from eren_mail_outbox where id=$1',[id(1)])).rows[0];
  assert.equal(failed.attempts,5);assert.equal(failed.status,'failed');assert.equal(failed.secret_name,'preserved');assert.match(failed.error,/recover/);

  await db.exec(`insert into eren_mail_outbox(id,status,attempts,locked_until) values
   ('${id(2)}','processing',2708,now()-interval '1 minute'),
   ('${id(3)}','pending',0,null),('${id(4)}','sending',5,now()-interval '1 minute'),
   ('${id(5)}','uncertain',5,null),('${id(6)}','cancelled',1,null),
   ('${id(7)}','sent',1,null),('${id(8)}','processing',5,now()+interval '1 minute'),
   ('${id(9)}','pending',5,null);
   insert into eren_mail_outbox(id,status,send_at) values ('${id(10)}','pending',now()+interval '1 day');`);
  // A targeted claim does not disturb another job, including exhausted jobs.
  assert.equal((await db.query('select * from eren_mail_claim($1)',[id(3)])).rows[0].id,id(3));
  assert.equal((await db.query('select status from eren_mail_outbox where id=$1',[id(2)])).rows[0].status,'processing');
  assert.equal((await db.query('select * from eren_mail_claim()')).rows.length,0);
  const states=(await db.query('select id,status,attempts from eren_mail_outbox order by id')).rows;
  assert.deepEqual(states.slice(1).map(r=>r.status),['failed','processing','sending','uncertain','cancelled','sent','processing','failed','pending']);
  assert.equal(states[1].attempts,2708,'no reset or automatic replay of the incident message');
  const grants=(await db.query(`select has_function_privilege('anon','public.eren_mail_claim(uuid)','execute') as anon,
   has_function_privilege('authenticated','public.eren_mail_claim(uuid)','execute') as authenticated,
   has_function_privilege('service_role','public.eren_mail_claim(uuid)','execute') as service,
   prosecdef from pg_proc where proname='eren_mail_claim'`)).rows[0];
  assert.deepEqual(grants,{anon:false,authenticated:false,service:true,prosecdef:false});
 } finally {await db.close();}
});
