import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const root=new URL('../',import.meta.url);
test('Begüm adapter moves tasks and calendar while preserving every mail and notification request',async()=>{
  const calls=[];
  const window={location:{href:'https://weather-mister.github.io/ntu-mail-push/begum/'},SCHEDULE_MIGRATION:{enabled:true,app:'begum',apiUrl:'https://begum-schedule-api.preview-validation.workers.dev',transferEnabled:true},fetch:async(input,init)=>{const request=new Request(input,init);calls.push(request);return Response.json({ok:true});}};
  runInNewContext(readFileSync(new URL('artifacts/frontend/migration-bridge.js',root),'utf8'),{window,URL,Request,Headers});
  const legacy='https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/';
  for(const route of ['status','todos/list','todos/create','todos/update','todos/delete','todos/import','cool-calendar','transfer/upload']){
    await window.fetch(legacy+'ntu-schedule-api?route='+route,{method:'POST',headers:{'x-schedule-key':'begum'},body:'original-body'});
    assert.equal(new URL(calls.at(-1).url).hostname,'begum-schedule-api.preview-validation.workers.dev');
    assert.equal(calls.at(-1).headers.get('x-schedule-key'),'begum');assert.equal(await calls.at(-1).text(),'original-body');
  }
  for(const route of ['bootstrap','mail','thread','sync','send','ntu/connect','drafts','ai','translate']){
    const url=legacy+'eren-mail?route='+route;await window.fetch(url,{method:'POST',body:'untouched'});
    assert.equal(calls.at(-1).url,url);assert.equal(await calls.at(-1).text(),'untouched');
  }
  for(const route of ['push/config','push/subscribe','push/test']){
    const url=legacy+'ntu-schedule-api?route='+route;await window.fetch(url);assert.equal(calls.at(-1).url,url);
  }
});
test('single-file widget authenticates its socket, reloads changed tasks and stops rejected-key retries',async()=>{
  let code=readFileSync(new URL('artifacts/widget/widget.mjs',root),'utf8');
  code=code.replace(/^import \{ React, run \} from "uebersicht";\s*/, '').replace(/export \{[\s\S]*?\};\s*$/, '');
  code+='\nthis.hooks={init,initialState,updateState,mutate};';
  const tasks=[{id:'original',text:'Saved task',done:false}];const requests=[],sockets=[],timers=new Map();let next=0,state;
  class Socket{static OPEN=1;constructor(url){this.url=url;this.readyState=1;this.sent=[];sockets.push(this);}send(value){this.sent.push(JSON.parse(value));}close(){this.closed=true;}}
  const eventTarget={addEventListener(){},removeEventListener(){}};
  const context={URL,React:{},WebSocket:Socket,navigator:{onLine:true},window:{...eventTarget},document:{...eventTarget,hidden:false},localStorage:{getItem:()=>null,setItem(){}},setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>0,clearInterval(){},run:async command=>{
    requests.push(command);
    if(command.includes('todos%2Fupdate')){tasks[0].done=true;return JSON.stringify({task:tasks[0]})+'\n200';}
    return JSON.stringify({tasks})+'\n200';
  }};
  runInNewContext(code,context);state=context.hooks.initialState;
  const dispatch=action=>{state=context.hooks.updateState(action,state);};
  context.hooks.init(dispatch);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.tasks.length,1);assert.ok(requests[0].includes('x-schedule-key: begum'));
  const socket=sockets[0];assert.equal(new URL(socket.url).searchParams.get('route'),'todos/socket');assert.equal(new URL(socket.url).searchParams.has('key'),false);
  socket.onopen();assert.equal(socket.sent[0].event,'pair');assert.equal(socket.sent[0].key,'begum');
  socket.onmessage({data:JSON.stringify({event:'ready'})});assert.equal(state.connected,true);
  socket.onmessage({data:JSON.stringify({event:'changed'})});const refresh=[...timers.values()].find(t=>t.ms===160);assert.ok(refresh);refresh.fn();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);
  await context.hooks.mutate(dispatch,'update',{id:'original',done:true});assert.equal(state.tasks[0].done,true);
  socket.onclose({code:1008});assert.equal(state.connected,false);assert.equal(state.error,'Pairing key not recognized.');assert.equal([...timers.values()].some(t=>t.ms===1500),false);
});
