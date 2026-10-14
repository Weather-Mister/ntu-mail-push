import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,writeFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../cutover/'+name,import.meta.url),'utf8');
test('Begüm cutover preserves rows and notification writes, blocks only her stale schedule writes, and rolls back',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;
   CREATE TABLE schedule_workspaces(workspace_hash text PRIMARY KEY,app_slug text UNIQUE);
   INSERT INTO schedule_workspaces VALUES('eren-owner','eren'),('begum-owner','begum');
   CREATE TABLE schedule_manual_tasks(id text PRIMARY KEY,workspace_hash text,text text);
   CREATE TABLE schedule_transfer_items(id text PRIMARY KEY,workspace_hash text,content text);
   INSERT INTO schedule_manual_tasks VALUES('e','eren-owner','Eren original'),('b','begum-owner','Begum original');
   INSERT INTO schedule_transfer_items VALUES('e','eren-owner','original'),('b','begum-owner','original');
   CREATE TABLE push_subscriptions(id text PRIMARY KEY,endpoint text);INSERT INTO push_subscriptions VALUES('original','https://push.invalid');`);
  await db.exec('BEGIN;'+read('begum-freeze.sql')+'COMMIT;');
  for(const sql of ["UPDATE schedule_manual_tasks SET text='stale' WHERE id='b'","DELETE FROM schedule_manual_tasks WHERE id='b'","INSERT INTO schedule_manual_tasks VALUES('b2','begum-owner','stale')","UPDATE schedule_manual_tasks SET workspace_hash='begum-owner' WHERE id='e'","UPDATE schedule_transfer_items SET content='stale' WHERE id='b'"])await assert.rejects(()=>db.exec(sql),/moved to Cloudflare/);
  await db.exec("UPDATE schedule_manual_tasks SET text='Eren updated' WHERE id='e';UPDATE push_subscriptions SET endpoint='https://still-works.invalid' WHERE id='original';");
  assert.equal((await db.query("SELECT text FROM schedule_manual_tasks WHERE id='b'")).rows[0].text,'Begum original');
  assert.equal((await db.query("SELECT text FROM schedule_manual_tasks WHERE id='e'")).rows[0].text,'Eren updated');
  await db.exec(read('begum-unfreeze.sql'));await db.exec("UPDATE schedule_manual_tasks SET text='Reconciled original' WHERE id='b'");
  assert.equal((await db.query('SELECT count(*)::int AS n FROM schedule_manual_tasks')).rows[0].n,2);
  writeFileSync(new URL('../evidence/cutover-local.json',import.meta.url),JSON.stringify({passed:true,rowsPreserved:true,notificationsWritable:true,begumOnly:true,rollbackPassed:true}));
 }finally{await db.close();}
});
