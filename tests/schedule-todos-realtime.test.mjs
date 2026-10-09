import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=fs.readFileSync(new URL('../sites/eren/todo-realtime.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../sites/eren/app.js',import.meta.url),'utf8');

test('GitHub schedule subscribes to workspace-scoped change events, not task contents',async()=>{
 const sampleKey='test-pairing-key-longer-than-thirty-two-chars';
 const sockets=[];
 const notifications=[];
 const pending=[];
 const timers=new Map();
 class Socket {
  static OPEN=1;
  readyState=1;
  sent=[];
  constructor(url){this.url=url;sockets.push(this)}
  send(msg){this.sent.push(JSON.parse(msg))}
  close(){this.readyState=3;this.onclose?.()}
 }
 const window={
   addEventListener(name,callback){},
   dispatchEvent(event){notifications.push(event.type)},
 };
 const context={
   window,document:{addEventListener(){},hidden:false},
   navigator:{onLine:true},
   localStorage:{getItem:()=>sampleKey},
   WebSocket:Socket,
   TextEncoder,crypto:webcrypto,
   URL,Event:class Event{constructor(type){this.type=type}},
   setTimeout:(fn)=>{pending.push(fn);return 1},
   clearTimeout(){},setInterval:(fn)=>{timers.set(1,fn);return 1},
   clearInterval(){},console
 };
 vm.runInNewContext(source,context);
 for(let i=0;i<15&&!sockets.length;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(sockets.length,1);
 const ws=sockets[0];
 assert.ok(!ws.url.includes(sampleKey),'pairing key never used in WS URL');
 ws.onopen();
 const message=ws.sent[0];
 assert.equal(message.event,'phx_join');
 assert.match(message.topic,/^realtime:schedule-todos:[a-f0-9]{64}$/);
 assert.ok(!message.topic.includes(sampleKey));
 ws.onmessage({data:JSON.stringify({topic:message.topic,event:'phx_reply',payload:{status:'ok'}})});
 assert.deepEqual(notifications,['schedule-todos-changed']);
 ws.onmessage({data:JSON.stringify({topic:message.topic,event:'broadcast',payload:{event:'changed',payload:{}}})});
 assert.deepEqual(notifications,['schedule-todos-changed','schedule-todos-changed']);
 ws.onmessage({data:JSON.stringify({topic:'realtime:schedule-todos:other',event:'broadcast',payload:{event:'changed'}})});
 assert.equal(notifications.length,2,'other workspaces do not notify this schedule');
});
test('GitHub schedule consumes task events and does not task-poll every eight seconds',()=>{
 assert.match(app,/addEventListener\('schedule-todos-changed',\s*\(\) => \{ void syncTodos\(\); \}\)/);
 const matches=[...app.matchAll(/setInterval\(\(\) => \{[\s\S]{0,160}?\}, 8000\);/g)];
 assert.equal(matches.length,1);
 assert.ok(!matches[0][0].includes('syncTodos()'));
});
