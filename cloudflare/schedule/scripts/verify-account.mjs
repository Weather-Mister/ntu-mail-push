import {tokenForBegum} from './connection.mjs';
import {ACCOUNT_ID} from './deploy-begum.mjs';
const token=tokenForBegum();
const api=async(path,method='GET',body)=>{
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT_ID+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok||!data.success){const error=new Error('Cloudflare account operation failed '+response.status);error.codes=(data.errors||[]).map(e=>e.code);throw error;}return data.result;
};
if((await api('')).id!==ACCOUNT_ID)throw new Error('Account mismatch');
let subdomain;
try{subdomain=(await api('/workers/subdomain')).subdomain;}
catch(error){if(!process.argv.includes('--initialize')||!error.codes.includes(10007))throw error;subdomain=(await api('/workers/subdomain','PUT',{subdomain:'begum-schedule-'+ACCOUNT_ID.slice(0,8)})).subdomain;}
const databases=await api('/d1/database?per_page=100'),workers=await api('/workers/scripts');
console.log(JSON.stringify({accountId:ACCOUNT_ID,connectionVerified:true,workersSubdomain:subdomain,databases:databases.map(d=>({name:d.name,id:d.uuid})),workers:workers.map(w=>w.id)}));
