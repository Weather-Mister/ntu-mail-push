import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {tokenForBegum} from './connection.mjs';
import {ACCOUNT_ID} from './deploy-begum.mjs';
import {personSnapshot} from './snapshot.mjs';
import {parseCoolFeed,fetchCoolFeed} from '../src/cool.mjs';
const root=resolve(import.meta.dirname,'..'),resource=JSON.parse(readFileSync(resolve(root,'evidence/resources.json'),'utf8'));
const source=personSnapshot(JSON.parse(readFileSync(resolve(root,'.private/snapshot.json'),'utf8')),'begum');
const workerUrl=`https://${resource.workerName}.${resource.subdomain}.workers.dev`,token=tokenForBegum();
const canonical=rows=>JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)).map(t=>({id:t.id,text:t.text,done:Boolean(t.done),createdAt:t.createdAt||t.created_at,updatedAt:t.updatedAt||t.updated_at})));
const call=async(route,body,origin='https://weather-mister.github.io')=>{
 const response=await fetch(workerUrl+'?route='+route,{method:body?'POST':'GET',headers:{'x-schedule-key':'begum',Origin:origin,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Live ${route} failed (${response.status})`);return response;
};
if(process.argv.includes('--readiness')){const status=await(await call('status')).json();console.log(JSON.stringify({workerUrl,status,httpsReady:true}));process.exit(0);}
const initialTasks=(await(await call('todos/list')).json()).tasks;
if(canonical(initialTasks)!==canonical(source.tasks))throw new Error('Source/D1 task parity mismatch before testing');
const db=async()=>{
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${resource.databaseId}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT * FROM schedule_manual_tasks;'})});
 const value=await response.json();if(!response.ok||!value.success)throw new Error('D1 validation failed');return value.result[0].results;
};
if(canonical(await db())!==canonical(source.tasks))throw new Error('D1 field parity failed');
for(const route of ['mail','push/config']){const response=await fetch(workerUrl+'?route='+route);if(response.status!==404)throw new Error('Excluded service became available');}
if((await fetch(workerUrl+'?route=todos/list')).status!==401)throw new Error('Task authentication failed');
if((await fetch(workerUrl+'?route=todos/list',{headers:{Origin:'https://untrusted.invalid','x-schedule-key':'begum'}})).status!==403)throw new Error('Origin restriction failed');
await call('status',undefined,'http://127.0.0.1:41416');await call('status',undefined,'http://localhost:41416');
const calendar=(await(await call('cool-calendar')).json()).events;
const feed=await fetchCoolFeed(source.owner.cool_feed_url);if(!feed.ok)throw new Error('Direct calendar failed');
if(JSON.stringify(calendar)!==JSON.stringify(parseCoolFeed(await feed.text())))throw new Error('Calendar parity failed');
const sockets=[],temporaryTasks=[],temporaryItems=[];
const waitFor=async condition=>{const until=Date.now()+5000;while(!condition()){if(Date.now()>until)throw new Error('Task signal timed out');await new Promise(done=>setTimeout(done,20));}};
try{
 const socketUrl=new URL(workerUrl);socketUrl.protocol='wss:';socketUrl.searchParams.set('route','todos/socket');
 for(let i=0;i<2;i++){
  const socket=new WebSocket(socketUrl);sockets.push(socket);socket.events=[];
  await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket pairing timed out')),15000);socket.onopen=()=>socket.send(JSON.stringify({event:'pair',key:'begum'}));socket.onerror=()=>{clearTimeout(timer);reject(new Error('Socket connection failed'));};socket.onmessage=e=>{const message=JSON.parse(e.data);socket.events.push(message.event);if(message.event==='ready'){clearTimeout(timer);done();}};});
 }
 const task=(await(await call('todos/create',{id:'migration-check-'+randomBytes(6).toString('hex'),text:'Temporary migration check'})).json()).task;temporaryTasks.push(task.id);
 await waitFor(()=>sockets.every(s=>s.events.includes('changed')));
 const updated=(await(await call('todos/update',{id:task.id,done:true})).json()).task;if(!updated.done)throw new Error('Task update failed');
 const bytes=randomBytes(1024*1024+317),form=new FormData();form.append('file',new File([bytes],'migration-check.bin',{type:'application/octet-stream'}));
 const item=(await(await call('transfer/upload',form)).json()).item;temporaryItems.push(item.id);
 const download=await fetch(item.url);if(!download.ok)throw new Error('Signed download failed');
 const digest=b=>createHash('sha256').update(b).digest('hex');if(digest(Buffer.from(await download.arrayBuffer()))!==digest(bytes))throw new Error('File checksum mismatch');
 const changedSignature=new URL(item.url);changedSignature.searchParams.set('sig','0'.repeat(64));if((await fetch(changedSignature)).status!==401)throw new Error('Invalid signature accepted');
 const uploadId='migration-chunks-'+randomBytes(6).toString('hex'),parts=[randomBytes(700123),randomBytes(800321)],total=parts.reduce((n,b)=>n+b.length,0);
 for(let index=0;index<parts.length;index++){
  const data=new FormData();data.append('chunk',new File([parts[index]],'chunk.bin'));
  for(const [name,value]of Object.entries({uploadId,index,totalChunks:parts.length,totalBytes:total}))data.append(name,String(value));
  await call('transfer/upload-chunk',data);
 }
 const chunked=(await(await call('transfer/finalize',{uploadId,totalChunks:parts.length,totalBytes:total,filename:'migration-chunks.bin',contentType:'application/octet-stream'})).json()).item;temporaryItems.push(chunked.id);
 const fetched=[];for(let index=0;index<parts.length;index++)fetched.push(Buffer.from(await(await call('transfer/chunk&id='+chunked.id+'&index='+index)).arrayBuffer()));
 if(digest(Buffer.concat(fetched))!==digest(Buffer.concat(parts)))throw new Error('Chunked checksum mismatch');
}finally{
 for(const id of temporaryItems)await call('transfer/delete',{id});
 for(const id of temporaryTasks)await call('todos/delete',{id});
 for(const socket of sockets)socket.close();
}
if(canonical((await(await call('todos/list')).json()).tasks)!==canonical(initialTasks))throw new Error('Task cleanup/source parity failed');
if((await(await call('transfer/list')).json()).items.length)throw new Error('Transfer test cleanup failed');
const result={person:'begum',accountId:ACCOUNT_ID,databaseId:resource.databaseId,workerUrl,tasks:initialTasks.length,transfers:0,taskParity:true,coolParity:true,coolAssignments:calendar.length,twoDeviceSync:true,directFileChecksum:true,chunkedFileChecksum:true,widgetOriginsAccepted:true,authenticationVerified:true,syntheticDataCleaned:true,mailChanged:false,notificationsChanged:false,frontendSwitched:false,checkedAt:new Date().toISOString()};
writeFileSync(resolve(root,'evidence/deployed.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
