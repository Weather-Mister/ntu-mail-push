import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { hashKey, TaskSync } from '../src/worker.mjs';
import { parseCoolFeed } from '../src/cool.mjs';
import { makeDatabase, validateSnapshot, personSnapshot, importSql } from '../scripts/snapshot.mjs';
import { fixture } from './fixtures.mjs';
import { d1 } from './sqlite-adapter.mjs';

const key = 'local-staging-key-'.repeat(3);
async function env(person = 'eren') {
  const db = makeDatabase(fixture(),person);
  const signals = [];
  return { db, signals, APP_SLUG: person, DB: d1(db), SCHEDULE_KEY_HASH: await hashKey(key + person), ALLOWED_ORIGINS: 'https://weather-mister.github.io', TASK_SYNC: {
    idFromName: person => person, get: () => ({ fetch: async () => { signals.push('changed'); return new Response(null,{status:204}); } })
  }};
}
async function request(config, route, body, custom = {}) {
  return worker.fetch(new Request(`https://staging.invalid/?route=${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'x-schedule-key': key + config.APP_SLUG, 'content-type':'application/json', ...custom },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), config);
}
test('tasks preserve CRUD response contracts, imports, timestamps and task ordering', async () => {
  const config = await env();
  const create = await request(config,'todos/create',{id:'client-id',text:'New task'});
  const item = (await create.json()).task;
  assert.equal(item.id,'client-id'); assert.equal(item.done,false); assert.ok(Date.parse(item.createdAt));
  const updated = (await (await request(config,'todos/update',{id:item.id,done:true})).json()).task;
  assert.equal(updated.done,true); assert.equal(updated.createdAt,item.createdAt);
  const imported = await (await request(config,'todos/import',{tasks:[{id:item.id,text:'Should not overwrite'}, {id:'new-import',text:'Imported',done:true}]})).json();
  assert.equal(imported.imported,1);
  const tasks = (await (await request(config,'todos/list')).json()).tasks;
  assert.equal(tasks.length,3); assert.equal(tasks.find(row=>row.id===item.id).text,'New task');
  assert.equal((await request(config,'todos/update',{id:'missing',done:true})).status,404);
  assert.equal((await request(config,'todos/update',{id:item.id,done:'false'})).status,400);
  assert.equal((await request(config,'todos/create',{text:'x'.repeat(501)})).status,400);
  assert.equal((await request(config,'todos/delete',{id:item.id})).status,200);
  assert.equal(config.signals.length,4);
  config.db.close();
});
test('different accounts and databases reject the other person and fail closed on a misbinding', async () => {
  const eren = await env('eren'), begum = await env('begum');
  assert.equal((await request(begum,'todos/list',undefined,{'x-schedule-key':key+'eren'})).status,401);
  const erenTasks = (await (await request(eren,'todos/list')).json()).tasks;
  assert.equal(erenTasks.some(row => row.id==='task-begum'),false);
  eren.DB = begum.DB;
  assert.equal((await request(eren,'todos/list')).status,503);
  eren.db.close(); begum.db.close();
});
test('a 200-task import fits the free-tier statement and parameter limits', async () => {
  const config=await env();
  const input=Array.from({length:200},(_,index)=>({id:'import-'+index,text:'Task '+index}));
  assert.equal((await (await request(config,'todos/import',{tasks:input})).json()).imported,200);
  assert.equal((await (await request(config,'todos/import',{tasks:input})).json()).imported,0);
  config.db.close();
});
test('no push, mail or arbitrary route can execute, and transfer staging is gated', async () => {
  const config = await env();
  for (const route of ['push/config','push/subscribe','push/test','mail','../todos/list','todos/list/extra']) assert.equal((await request(config,route)).status,404);
  assert.equal((await request(config,'transfer/upload',{})).status,503);
  assert.equal((await request(config,'todos/list',{})).status,405);
  assert.equal((await request(config,'todos/list',undefined,{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await request(config,'todos/list',undefined,{'x-schedule-key':''})).status,401);
  config.db.close();
});
test('a sync service outage cannot undo a committed task', async () => {
  const config=await env(); config.TASK_SYNC.get=()=>({fetch:async()=>{throw new Error('Unavailable')}});
  assert.equal((await request(config,'todos/create',{id:'offline-sync',text:'Saved'})).status,200);
  assert.ok((await (await request(config,'todos/list')).json()).tasks.find(task=>task.id==='offline-sync'));
  config.db.close();
});
test('snapshot import validates ownership, preserves existing rows and refuses reruns', () => {
  const snapshot=fixture(); const db=makeDatabase(snapshot,'eren');
  assert.equal(db.prepare('SELECT text FROM schedule_manual_tasks').get().text, personSnapshot(snapshot,'eren').tasks[0].text);
  assert.throws(()=>db.exec(importSql(snapshot,'eren')));
  const corrupt=structuredClone(snapshot); corrupt.tasks[0].workspace_hash='f'.repeat(64);
  assert.throws(()=>validateSnapshot(corrupt),/Orphaned/);
  db.close();
});
test('COOL parser matches assignment links, Taipei dates, escaped text and ignores other calendar events', () => {
  const events=parseCoolFeed('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-assignment-123\r\nSUMMARY:Homework\\, one [Math]\r\nDTSTART;VALUE=DATE:20261014\r\nURL:https://cool.ntu.edu.tw/calendar?include_contexts=course_456\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:other\r\nSUMMARY:Ignore\r\nDTSTART:20261014T120000Z\r\nEND:VEVENT\r\nEND:VCALENDAR');
  assert.equal(events.length,1); assert.equal(events[0].title,'Homework, one'); assert.equal(events[0].course,'Math');
  assert.equal(events[0].dueAt,'2026-10-14T23:59:59+08:00'); assert.equal(events[0].url,'https://cool.ntu.edu.tw/courses/456/assignments/123');
});
test('task hub authenticates before delivering refresh signals and never broadcasts content or keys', async () => {
  const sent=[],attachment={};const socket={deserializeAttachment:()=>attachment,serializeAttachment:value=>Object.assign(attachment,value),send:value=>sent.push(value),close:()=>sent.push('closed')};
  const sync=new TaskSync({getWebSockets:()=>[socket]},{SCHEDULE_KEY_HASH:await hashKey(key)});
  await sync.fetch(new Request('https://sync.internal/changed',{method:'POST'})); assert.deepEqual(sent,[]);
  await sync.webSocketMessage(socket,JSON.stringify({event:'pair',key}));
  await sync.fetch(new Request('https://sync.internal/changed',{method:'POST'}));
  assert.deepEqual(sent.map(value=>JSON.parse(value)),[{event:'ready'},{event:'changed'}]);
  const nextKey='new-live-pairing-key-'.repeat(3),nextHash=await hashKey(nextKey);
  await sync.fetch(new Request('https://sync.internal/changed',{method:'POST',headers:{'x-schedule-auth-hash':nextHash}}));assert.equal(sent.at(-1),'closed','Retired staging sockets must not receive live refreshes');
  sent.length=0;socket.serializeAttachment({paired:false,authHash:nextHash});
  await sync.webSocketMessage(socket,JSON.stringify({event:'pair',key:nextKey}));
  await sync.fetch(new Request('https://sync.internal/changed',{method:'POST',headers:{'x-schedule-auth-hash':nextHash}}));
  assert.deepEqual(sent.map(value=>JSON.parse(value)),[{event:'ready'},{event:'changed'}],'A warm object must authenticate using the current gateway hash');
});
