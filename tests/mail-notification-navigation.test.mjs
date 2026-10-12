import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('sites/eren/sw.js','utf8'),scope='https://weather-mister.github.io/ntu-mail-push/';
function worker(windows=[]){
 const listeners={},opened=[],notifications=[];
 vm.runInNewContext(source,{URL,self:{registration:{scope,showNotification:async(title,options)=>notifications.push({title,options})},location:new URL(scope),addEventListener:(name,handler)=>listeners[name]=handler},clients:{matchAll:async()=>windows,openWindow:async url=>opened.push(url)}});
 return {listeners,opened,notifications};
}
async function click(w,url){let pending,closed=false;w.listeners.notificationclick({notification:{data:{url},close:()=>{closed=true;}},waitUntil:p=>{pending=p;}});await pending;assert(closed);}
test('NTU mail push keeps its contents but targets the schedule PWA',async()=>{
 const w=worker();let pending;w.listeners.push({data:{json:()=>({body:'New class notice',tag:'ntu-mail',url:'https://wmail1.cc.ntu.edu.tw/rc/index.php'})},waitUntil:p=>{pending=p;}});await pending;
 assert.equal(w.notifications[0].title,'NTU Mail');assert.equal(w.notifications[0].options.body,'New class notice');assert.equal(w.notifications[0].options.tag,'ntu-mail');assert.equal(w.notifications[0].options.data.url,scope);
});
for(const url of ['https://wmail1.cc.ntu.edu.tw/rc/index.php','/?open=ntu-mail',undefined])test(`notification tap enters PWA for ${url||'missing'} destination`,async()=>{
 const w=worker();await click(w,url);assert.deepEqual(w.opened,[scope]);
});
test('notification tap focuses the existing terminal without navigating away from its current reader',async()=>{
 let focused=0;const w=worker([{url:scope+'skeuo-demo.html',focus:async()=>{focused++;},navigate:()=>{throw new Error('Reader was replaced');}}]);await click(w,'https://wmail1.cc.ntu.edu.tw/rc/index.php');assert.equal(focused,1);assert.deepEqual(w.opened,[]);
});
test('notification tap does not focus Begum or another GitHub PWA',async()=>{
 const w=worker([scope+'begum',scope+'begum/',scope+'begum/desk-demo.html','https://weather-mister.github.io/hanzi-steps/','https://example.test/ntu-mail-push/'].map(url=>({url,focus:()=>{throw new Error('Wrong app focused');}})));await click(w,scope);assert.deepEqual(w.opened,[scope]);
});
test('notification tap opens the PWA if its existing window closed before focus',async()=>{
 const w=worker([{url:scope,focus:async()=>{throw new Error('Closed');}}]);await click(w,scope);assert.deepEqual(w.opened,[scope]);
});
