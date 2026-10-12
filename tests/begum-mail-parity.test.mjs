import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Begüm and Eren execute identical mail client code and base styles',()=>{
 for(const name of ['mail-demo.js','mail-demo.css','mail-modern.css'])assert.equal(read('sites/begum/'+name),read('sites/eren/'+name));
 assert.match(read('sites/begum/index.html'),/data-workspace="begum"/);
 assert.match(read('sites/begum/sw.js'),/mail-garden.css/);
});

test('Begüm notification taps enter her PWA, including old webmail notification destinations',async()=>{
 const {default:vm}=await import('node:vm');
 const listeners={},opened=[],scope='https://weather-mister.github.io/ntu-mail-push/begum/';
 let focused=0;
 const context={URL,self:{registration:{scope},location:new URL(scope),addEventListener:(name,fn)=>listeners[name]=fn},clients:{matchAll:async()=>[{url:scope+'?open=mail',focus:async()=>focused++,navigate:()=>assert.fail('Must retain the active reader')}],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(read('sites/begum/sw.js'),context);
 let pending;listeners.notificationclick({notification:{data:{url:'https://wmail1.cc.ntu.edu.tw/rc/index.php'},close:()=>{}},waitUntil:p=>pending=p});await pending;
 assert.equal(focused,1);assert.deepEqual(opened,[]);
 context.clients.matchAll=async()=>[{url:'https://weather-mister.github.io/ntu-mail-push/',focus:()=>assert.fail('Wrong workspace')}];
 listeners.notificationclick({notification:{data:{},close:()=>{}},waitUntil:p=>pending=p});await pending;
 assert.deepEqual(opened,[scope]);
});
