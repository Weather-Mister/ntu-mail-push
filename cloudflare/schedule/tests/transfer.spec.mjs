import test from 'node:test';
import assert from 'node:assert/strict';
import { startRuntime } from '../scripts/local-runtime.mjs';
import { fixture } from './fixtures.mjs';
test('real Cloudflare runtime: SQLite file uploads, signed downloads, chunk assembly, size validation and deletes',async()=>{
  const key='local-file-test-'.repeat(3),runtime=await startRuntime('eren',key,fixture(),0,true);
  const call=async(route,body)=>{
    const request=new Request('https://staging.invalid/?route='+route,{method:body?'POST':'GET',headers:{'x-schedule-key':key,...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
    return runtime.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(body?{body:await request.arrayBuffer()}:{})});
  };
  try {
    const text=await call('transfer/text',{content:'https://example.com/'});assert.equal((await text.json()).item.kind,'link');
    const form=new FormData();form.append('file',new File(['Original file bytes'],'hello.txt',{type:'text/plain'}));
    const uploaded=await call('transfer/upload',form);assert.equal(uploaded.status,200);
    const item=(await uploaded.json()).item;assert.equal(item.bytes,19);
    const download=await runtime.dispatchFetch(item.url);assert.equal(download.status,200);assert.equal(await download.text(),'Original file bytes');
    const tampered=new URL(item.url);tampered.searchParams.set('id','someone-elses-file');assert.equal((await runtime.dispatchFetch(tampered)).status,401);
    const uploadId='staging-chunk-upload-123',parts=['first part','second part'];const total=parts.join('').length;
    for(let index=0;index<parts.length;index++) {
      const data=new FormData();data.append('chunk',new File([parts[index]],'chunk.bin'));for(const [name,value]of Object.entries({uploadId,index,totalChunks:parts.length,totalBytes:total}))data.append(name,String(value));
      assert.equal((await call('transfer/upload-chunk',data)).status,200);
    }
    assert.equal((await call('transfer/finalize',{uploadId,totalChunks:2,totalBytes:total+1})).status,409);
    const finished=await call('transfer/finalize',{uploadId,totalChunks:2,totalBytes:total,filename:'joined.txt',contentType:'text/plain'});assert.equal(finished.status,200);
    const chunked=(await finished.json()).item;
    let joined='';for(let index=0;index<2;index++)joined+=await(await call(`transfer/chunk&id=${chunked.id}&index=${index}`)).text();assert.equal(joined,parts.join(''));
    const listed=(await(await call('transfer/list')).json()).items;assert.equal(listed.find(row=>row.id===chunked.id).chunkCount,2);
    assert.equal((await call('transfer/finalize',{uploadId,totalChunks:2,totalBytes:100*1024*1024+1})).status,413);
    assert.equal((await call('transfer/delete',{id:item.id})).status,200);assert.equal((await runtime.dispatchFetch(item.url)).status,404);
    assert.equal((await call('transfer/delete',{id:chunked.id})).status,200);
  }finally{await runtime.dispose()}
});
