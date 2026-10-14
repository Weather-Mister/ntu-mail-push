import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {personSnapshot,validateSnapshot} from './snapshot.mjs';
import {parseCoolFeed,fetchCoolFeed} from '../src/cool.mjs';
const root=resolve(import.meta.dirname,'..');
export const ACCOUNT_ID='fb77361332c979fc8a3e0d25a03d8f69';
export function metadata(config,databaseId,owner,signingKey){
  if(config.account_id!==ACCOUNT_ID||config.vars.APP_SLUG!=='begum'||config.name!=='begum-schedule-api')throw new Error('Begüm account/resource mismatch');
  if(owner.app_slug!=='begum'||owner.workspace_hash!==createHash('sha256').update('begum').digest('hex'))throw new Error('Unexpected Begüm source owner');
  if(!databaseId||!/^[a-f0-9]{64}$/.test(signingKey))throw new Error('Missing resources/secrets');
  const feed=new URL(owner.cool_feed_url);if(feed.protocol!=='https:'||feed.hostname!=='cool.ntu.edu.tw')throw new Error('Unexpected calendar host');
  return {main_module:'worker.mjs',compatibility_date:config.compatibility_date,usage_model:'standard',observability:{enabled:false},bindings:[
    ...Object.entries(config.vars).map(([name,text])=>({name,type:'plain_text',text})),
    {name:'DB',type:'d1',id:databaseId},
    {name:'TASK_SYNC',type:'durable_object_namespace',class_name:'TaskSync'},
    {name:'FILE_STORE',type:'durable_object_namespace',class_name:'FileStore'},
    {name:'SCHEDULE_KEY_HASH',type:'secret_text',text:owner.workspace_hash},
    {name:'COOL_FEED_URL',type:'secret_text',text:owner.cool_feed_url},
    {name:'DOWNLOAD_SIGNING_KEY',type:'secret_text',text:signingKey}
  ],migrations:{new_tag:'v2',steps:[{new_sqlite_classes:['TaskSync']},{new_sqlite_classes:['FileStore']}]}};
}
export async function deploy({token,fetcher=fetch}){
  if(!token||token.length<20)throw new Error('Begüm Cloudflare connection required. Use BEGUM_CLOUDFLARE_API_TOKEN or .private/cloudflare-token.txt.');
  const config=JSON.parse(readFileSync(resolve(root,'config/begum.json'),'utf8'));
  const snapshot=validateSnapshot(JSON.parse(readFileSync(resolve(root,'.private/snapshot.json'),'utf8')));
  if(Date.now()-Date.parse(snapshot.snapshot_at)>15*60*1000)throw new Error('Refresh the Begüm source snapshot before deployment.');
  const expected=personSnapshot(snapshot,'begum');
  if(expected.transfers.length)throw new Error('The source gained transfer items; perform a fresh file migration audit.');
  if(existsSync(resolve(root,'evidence/deployed.json')))throw new Error('Deployment exists. Validate it and perform cutover; never repeat the initial import.');
  const api=async(path,method='GET',body)=>{
    if(!path.startsWith('/accounts/'+ACCOUNT_ID))throw new Error('Only Begüm’s account is permitted');
    const form=body instanceof FormData;
    const result=await fetcher('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,...(!form?{'Content-Type':'application/json'}:{})},...(body?{body:form?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
    const data=await result.json();if(!result.ok||!data.success)throw new Error(`Cloudflare operation failed (${result.status}; codes ${(data.errors||[]).map(e=>e.code).join(',')}). Private values are not logged.`);return data.result;
  };
  if((await api('/accounts/'+ACCOUNT_ID)).id!==ACCOUNT_ID)throw new Error('Cloudflare account mismatch');
  const prefix='/accounts/'+ACCOUNT_ID;
  const workers=await api(prefix+'/workers/scripts');if(workers.some(w=>w.id===config.name))throw new Error('Worker already exists; inspect it before updating.');
  const dbs=await api(prefix+'/d1/database?per_page=100');if(dbs.some(d=>d.name==='begum-schedule-db'))throw new Error('Database already exists; inspect it before importing.');
  let subdomain;
  try{subdomain=(await api(prefix+'/workers/subdomain')).subdomain;}catch(error){throw new Error('Initialize this account’s Workers subdomain in Cloudflare before deploying.');}
  if(!subdomain)throw new Error('Workers subdomain has not been initialized.');
  const database=await api(prefix+'/d1/database','POST',{name:'begum-schedule-db',primary_location_hint:'apac'});
  writeFileSync(resolve(root,'evidence/resources.json'),JSON.stringify({accountId:ACCOUNT_ID,databaseId:database.uuid,workerName:config.name,subdomain,createdAt:new Date().toISOString()},null,2));
  // Each statement is parameterized below for user-controlled task content. Schema statements contain no user data.
  const schema=readFileSync(resolve(root,'migrations/0001_schedule.sql'),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
  for(const statement of schema)await api(prefix+`/d1/database/${database.uuid}/query`,'POST',{sql:statement});
  const query=(sql,params=[])=>api(prefix+`/d1/database/${database.uuid}/query`,'POST',{sql,params});
  await query('INSERT INTO migration_owner VALUES(1,?,?,?)',['begum',expected.owner.workspace_hash,snapshot.snapshot_at]);
  for(const task of expected.tasks)await query('INSERT INTO schedule_manual_tasks VALUES(?,?,?,?,?)',[task.id,task.text,Number(task.done),task.created_at,task.updated_at]);
  const compare=rows=>JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)).map(({id,text,done,created_at,updated_at})=>({id,text,done:Number(done),created_at,updated_at})));
  const imported=(await query('SELECT * FROM schedule_manual_tasks'))[0].results;
  if(compare(imported)!==compare(expected.tasks))throw new Error('D1 task parity failed; source remains unchanged.');
  const bindingMetadata=metadata(config,database.uuid,expected.owner,randomBytes(32).toString('hex'));
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(bindingMetadata)],{type:'application/json'}));
  form.set('worker.mjs',new Blob([readFileSync(resolve(root,'artifacts/worker.mjs'))],{type:'application/javascript+module'}),'worker.mjs');
  await api(prefix+'/workers/scripts/'+config.name,'PUT',form);
  await api(prefix+'/workers/scripts/'+config.name+'/subdomain','POST',{enabled:true,previews_enabled:false});
  const workerUrl=`https://${config.name}.${subdomain}.workers.dev`;
  const call=async(route,body)=>{
    const result=await fetcher(workerUrl+'?route='+route,{method:body?'POST':'GET',headers:{'x-schedule-key':'begum',Origin:'https://weather-mister.github.io',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if(!result.ok)throw new Error(`Live ${route} check failed (${result.status}).`);return result.json();
  };
  const listed=await call('todos/list');
  if(compare(listed.tasks.map(t=>({...t,created_at:t.createdAt,updated_at:t.updatedAt})))!==compare(expected.tasks))throw new Error('Live task parity failed');
  const calendar=await call('cool-calendar');const directFeed=await fetchCoolFeed(expected.owner.cool_feed_url,fetcher);if(!directFeed.ok)throw new Error('Direct COOL read failed');
  if(JSON.stringify(calendar.events)!==JSON.stringify(parseCoolFeed(await directFeed.text())))throw new Error('COOL feed parity failed');
  const wsUrl=new URL(workerUrl);wsUrl.protocol='wss:';wsUrl.searchParams.set('route','todos/socket');
  const sockets=[];let testTask;
  try{
    for(let i=0;i<2;i++){
      const socket=new WebSocket(wsUrl);sockets.push(socket);socket.events=[];
      await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Live task socket timeout')),15000);socket.onopen=()=>socket.send(JSON.stringify({event:'pair',key:'begum'}));socket.onerror=()=>{clearTimeout(timeout);reject(new Error('Live task socket failed'));};socket.onmessage=e=>{const msg=JSON.parse(e.data);socket.events.push(msg.event);if(msg.event==='ready'){clearTimeout(timeout);done();}};});
    }
    testTask=(await call('todos/create',{id:'migration-check-'+randomBytes(6).toString('hex'),text:'Temporary migration check'})).task;
    await call('todos/update',{id:testTask.id,done:true});
    if(!sockets.every(s=>s.events.includes('changed')))throw new Error('Cross-device task invalidation failed');
  }finally{if(testTask)await call('todos/delete',{id:testTask.id});for(const socket of sockets)socket.close();}
  if(compare((await query('SELECT * FROM schedule_manual_tasks'))[0].results)!==compare(expected.tasks))throw new Error('Tasks changed during validation; refresh the source comparison.');
  const receipt={person:'begum',accountId:ACCOUNT_ID,databaseId:database.uuid,workerUrl,tasks:expected.tasks.length,transfers:0,taskParity:true,coolParity:true,twoDeviceSync:true,mailChanged:false,notificationsChanged:false,frontendSwitched:false,checkedAt:new Date().toISOString()};
  writeFileSync(resolve(root,'evidence/deployed.json'),JSON.stringify(receipt,null,2));return receipt;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(process.argv[2]!=='--deploy'){console.log(JSON.stringify({accountId:ACCOUNT_ID,worker:'begum-schedule-api',database:'begum-schedule-db',mailExcluded:true,notificationsExcluded:true,frontendSwitchAfterLiveChecks:true,remoteChanges:false}));}
  else {const privateToken=resolve(root,'.private/cloudflare-token.txt');const token=process.env.BEGUM_CLOUDFLARE_API_TOKEN||(existsSync(privateToken)?readFileSync(privateToken,'utf8').trim():'');console.log(JSON.stringify(await deploy({token}),null,2));}
}
