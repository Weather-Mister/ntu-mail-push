import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../sites/eren/campus-tasks.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],handlers={},stored=new Map(),key='synthetic-private-key-'.repeat(3);let mode='unlinked';
 const original=async(input,init)=>{const url=String(input instanceof Request?input.url:input);calls.push({url,init});return url.includes('/personal-tasks/bridge')?Response.json(mode==='unlinked'?{code:'not_linked'}:mode==='error'?{error:'Unavailable'}:{tasks:[]},{status:mode==='unlinked'?404:mode==='error'?503:200}):Response.json({legacy:true});};
 const window={SCHEDULE_MIGRATION:{app:'eren',apiUrl:'https://eren-schedule-data-staging.eren-schedule-a84b7436.workers.dev'},fetch:original,opener:null,addEventListener(name,fn){handlers[name]=fn;},dispatchEvent(){}};
 vm.runInNewContext(code,{window,document:{hidden:false,addEventListener(){}},navigator:{onLine:true},location:new URL('https://weather-mister.github.io/ntu-mail-push/sites/eren/'),history:{replaceState(){}},localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},URL,URLSearchParams,Request,Response,Headers,Event,setInterval(){}});
 const request=route=>window.fetch('https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/ntu-schedule-api?route='+route,{headers:{'x-schedule-key':key}});
 return {calls,stored,request,setMode(value){mode=value;}};
}
test('only task requests use Campus Week; an explicitly unlinked account retains the existing store',async()=>{
 const f=fixture();assert.equal((await(await f.request('todos/list')).json()).legacy,true);assert.equal(f.calls.length,2);
 f.calls.length=0;await f.request('cool-calendar');assert.equal(f.calls.length,1);assert.equal(f.calls[0].url.includes('campusweek'),false);
});
test('after linking, outages cannot silently fork the tasks back to the old service',async()=>{
 const f=fixture();f.setMode('linked');assert.equal((await f.request('todos/list')).status,200);assert.equal(f.calls[0].init.credentials,'omit');assert.equal(f.calls[0].init.headers['x-schedule-key'].startsWith('synthetic'),true);
 f.calls.length=0;f.setMode('error');assert.equal((await f.request('todos/list')).status,503);assert.equal(f.calls.length,1);
 f.setMode('unlinked');assert.equal((await f.request('todos/list')).status,404);assert.equal(f.calls.length,2,'no legacy fallback after cutover');
});
