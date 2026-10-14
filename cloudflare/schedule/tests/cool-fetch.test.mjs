import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCoolFeed } from '../src/cool.mjs';
test('calendar fetch allows bounded NTU HTTPS redirects and refuses credential or off-site destinations',async()=>{
 const calls=[];
 const response=await fetchCoolFeed('https://cool.ntu.edu.tw/private-feed',async(url,options)=>{calls.push(url);assert.equal(options.redirect,'manual');return calls.length===1?new Response(null,{status:302,headers:{Location:'/canonical-feed'}}):new Response('calendar');});
 assert.equal(await response.text(),'calendar');assert.equal(calls.length,2);
 for(const location of ['https://another.invalid/feed','http://cool.ntu.edu.tw/feed','https://user:password@cool.ntu.edu.tw/feed']) {
  let count=0;await assert.rejects(fetchCoolFeed('https://cool.ntu.edu.tw/feed',async()=>{count++;return new Response(null,{status:302,headers:{Location:location}});}),/Untrusted calendar/);assert.equal(count,1);
 }
});
