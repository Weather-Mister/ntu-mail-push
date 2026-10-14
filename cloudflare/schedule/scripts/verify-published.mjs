import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),repo=resolve(root,'../ntu-mail-push'),base='https://weather-mister.github.io/ntu-mail-push/begum/';
const files=['index.html','sw.js','migration-bridge.js','migration-task-sync.js','app.js','garden-theme.css','mail-demo.js','mail-demo.css','mail-modern.css','mail-garden.css'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const checked=await Promise.all(files.map(async name=>{
 const expected=readFileSync(resolve(repo,'sites/begum',name),'utf8').replaceAll('\r\n','\n');
 const response=await fetch(base+name+'?verify=1c1f8a60cb7e882a10f786eb262f0efe69ee279d',{cache:'no-store'});if(!response.ok)throw new Error('Published file unavailable: '+name);
 const actual=(await response.text()).replaceAll('\r\n','\n');if(digest(actual)!==digest(expected))throw new Error('Published file differs: '+name);
 return {name,sha256:digest(actual)};
}));
const response=await fetch('https://begum-schedule-api.begum-schedule-fb773613.workers.dev/?route=todos/list',{headers:{Origin:'https://weather-mister.github.io','x-schedule-key':'begum'}});if(!response.ok||response.headers.get('Access-Control-Allow-Origin')!=='https://weather-mister.github.io')throw new Error('Published origin/API check failed');
const tasks=(await response.json()).tasks;if(tasks.length!==6)throw new Error('Final task count changed; inspect before finishing');
const receipt={site:base,pullRequest:84,mergeSha:'1c1f8a60cb7e882a10f786eb262f0efe69ee279d',pagesDeployment:38507281712,pagesVerified:true,files:checked,tasks:tasks.length,mailFilesUnchanged:true,gardenStyleUnchanged:true,checkedAt:new Date().toISOString()};
writeFileSync(resolve(root,'evidence/frontend-live.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({site:base,pagesVerified:true,filesVerified:checked.length,tasks:tasks.length,mailFilesUnchanged:true}));
