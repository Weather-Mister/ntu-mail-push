import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startRuntime } from '../scripts/local-runtime.mjs';
import { fixture } from './fixtures.mjs';
test('file migration checks owner/reference/checksum, verifies stored bytes, and never overwrites a differing object',async()=>{
 const key='local-file-import-key-'.repeat(3),prefix='1'.repeat(64)+'/',storageKey=prefix+'files/fixture.txt',bytes=Buffer.from('Original source object'),sha=createHash('sha256').update(bytes).digest('hex');
 const runtime=await startRuntime('eren',key,fixture(),0,false,true);
 try {
  const db=await runtime.getD1Database('DB');await db.prepare("INSERT INTO schedule_transfer_items(id,kind,storage_key,bytes) VALUES('fixture','file',?,?)").bind(storageKey,bytes.length).run();
  const call=(route,objectKey=storageKey,hash=sha,body)=>runtime.dispatchFetch('https://staging.invalid/?'+new URLSearchParams({route,key:objectKey,sha256:hash}),{method:body?'POST':'GET',headers:{'x-schedule-key':key},...(body?{body}:{})});
  assert.equal((await call('migration/file-import',storageKey,'a'.repeat(64),bytes)).status,400);
  assert.equal((await call('migration/file-import','2'.repeat(64)+'/files/other.txt',sha,bytes)).status,400);
  assert.equal((await call('migration/file-import',prefix+'files/unreferenced.txt',sha,bytes)).status,404);
  assert.equal((await call('migration/file-import',storageKey,sha,bytes)).status,200);
  const checked=await (await call('migration/file-check')).json();assert.equal(checked.matched,true);assert.equal(checked.bytes,bytes.length);
  assert.equal((await (await call('migration/file-import',storageKey,sha,bytes)).json()).alreadyPresent,true);
  assert.equal((await call('migration/file-import',storageKey,'b'.repeat(64),Buffer.from('Replacement'))).status,409);
  assert.equal((await (await call('migration/file-check')).json()).sha256,sha);
 }finally{await runtime.dispose();}
});
test('ordinary schedule deployments have no active file import endpoint',async()=>{
 const key='local-file-import-key-'.repeat(3),runtime=await startRuntime('eren',key,fixture());
 try{assert.equal((await runtime.dispatchFetch('https://staging.invalid/?route=migration/file-import',{method:'POST',headers:{'x-schedule-key':key},body:'No changes'})).status,404);}finally{await runtime.dispose();}
});
