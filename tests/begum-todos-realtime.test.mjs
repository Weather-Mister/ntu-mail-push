import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=fs.readFileSync(new URL('../sites/begum/todo-realtime.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../sites/begum/app.js',import.meta.url),'utf8');

test('Begum task realtime uses Begum storage key and matching workspace topic',async()=>{
 const events=[],sockets=[],callbacks={};
 const pairing='begum';
 class Socket {
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=1;this.sent=[];sockets.push(this)}
  send(s){this.sent.push(JSON.parse(s))}
  close(){this.readyState=3;this.onclose?.()}
 }
 const context={
  window:{addEventListener:(name,cb)=>callbacks[name]=cb,dispatchEvent:(event)=>events.push(event.type)},
  document:{addEventListener(){},hidden:false},navigator:{onLine:true},
  localStorage:{getItem(key){assert.equal(key,'ntu-schedule-begum-pairing-key-v1');return pairing}},
  crypto:webcrypto,TextEncoder,WebSocket:Socket,
  setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
  Event:class Event{constructor(type){this.type=type}},console
 };
 vm.runInNewContext(source,context);
 for(let i=0;i<25&&!sockets.length;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(sockets.length,1);
 const ws=sockets[0];assert.equal(ws.url.includes('begum'),false);
 ws.onopen();
 const join=ws.sent[0];assert.equal(join.event,'phx_join');
 const encoded=Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode('begum'))),b=>b.toString(16).padStart(2,'0')).join('');
 assert.equal(join.topic,'realtime:schedule-todos:'+encoded);
 ws.onmessage({data:JSON.stringify({topic:join.topic,event:'phx_reply',payload:{status:'ok'}})});
 ws.onmessage({data:JSON.stringify({topic:join.topic,event:'broadcast',payload:{event:'changed',payload:{}}})});
 assert.deepEqual(events,['schedule-todos-changed','schedule-todos-changed']);
 ws.onmessage({data:JSON.stringify({topic:'realtime:schedule-todos:other',event:'broadcast',payload:{event:'changed'}})});
 assert.equal(events.length,2);
});
test('Begum schedule reloads on task events and has no 60-second task polling',()=>{
 assert.match(app,/addEventListener\('schedule-todos-changed',\s*\(\) => \{ void syncTodos\(\); \}\)/);
 assert.doesNotMatch(app,/setInterval\(\(\) => \{ if \(!document.hidden\) void syncTodos\(\); \}, 60000\)/);
});
