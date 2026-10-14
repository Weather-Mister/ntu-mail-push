import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRuntime } from '../scripts/local-runtime.mjs';
import { fixture } from './fixtures.mjs';
import { hashKey } from '../src/worker.mjs';
const keys = { eren: 'local-eren-secret-'.repeat(3), begum: 'local-begum-secret-'.repeat(3) };
test('real Cloudflare runtime: isolated D1 CRUD and two authenticated WebSockets receive task updates', async () => {
  const eren=await startRuntime('eren',keys.eren,fixture());
  let begum;
  const sockets=[];
  try {
    begum=await startRuntime('begum',keys.begum,fixture());
    const call=async(person,route,body,key=keys[person])=>(person==='eren'?eren:begum).dispatchFetch(`https://staging.invalid/?route=${route}`,{
      method:body===undefined?'GET':'POST',headers:{'x-schedule-key':key,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    assert.equal((await call('begum','todos/list',undefined,keys.eren)).status,401);
    const events=[];
    for(let i=0;i<2;i++) {
      const response=await eren.dispatchFetch('https://staging.invalid/?route=todos/socket',{headers:{Upgrade:'websocket',Origin:'http://127.0.0.1:4173','x-schedule-auth-hash':await hashKey(keys.begum)}});
      assert.equal(response.status,101);
      const socket=response.webSocket;sockets.push(socket);socket.accept();
      const messages=[];events.push(messages);
      socket.addEventListener('message',event=>messages.push(JSON.parse(event.data)));
      socket.send(JSON.stringify({event:'pair',key:keys.eren}));
    }
    await until(()=>events.every(messages=>messages.some(message=>message.event==='ready')));
    const created=await call('eren','todos/create',{id:'shared-live-task',text:'Cross-device staging task'});
    assert.equal(created.status,200);
    await until(()=>events.every(messages=>messages.some(message=>message.event==='changed')));
    assert.equal((await (await call('eren','todos/list')).json()).tasks.some(task=>task.id==='shared-live-task'),true);
    assert.equal((await (await call('begum','todos/list')).json()).tasks.some(task=>task.id==='shared-live-task'),false);
    assert.equal((await call('eren','push/subscribe',{subscription:{}})).status,404);
    const unauth=await eren.dispatchFetch('https://staging.invalid/?route=todos/socket',{headers:{Upgrade:'websocket'}});
    const rejected=unauth.webSocket;sockets.push(rejected);rejected.accept();
    const closed=new Promise(resolve=>rejected.addEventListener('close',resolve,{once:true}));
    rejected.send(JSON.stringify({event:'pair',key:keys.begum}));
    const result=await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Unauthenticated socket was not rejected')),2000))]);
    assert.equal(result.code,1008);
  } finally { for(const socket of sockets)try{socket.close()}catch{} await eren.dispose(); await begum?.dispose(); }
});
async function until(predicate) {
  const deadline=Date.now()+3000;
  while(!predicate()) { if(Date.now()>deadline)throw new Error('Task signal was not delivered');await new Promise(resolve=>setTimeout(resolve,20)); }
}
