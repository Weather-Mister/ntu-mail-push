import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { b64, b64url, buildMime } from '../supabase/functions/eren-mail/domain.mjs';
import { encodeAttachmentData, decodeAttachmentData } from '../supabase/functions/eren-mail/attachments.ts';

test('native encoders preserve byte slices, base64 padding, Unicode and strict decode validation',()=>{
 for(const size of [0,1,2,3,75,76,77,32767,32768,32769]) {
  const backing=Uint8Array.from({length:size+4},(_,i)=>i%256),bytes=backing.subarray(2,size+2);
  const expected=Buffer.from(bytes).toString('base64');
  assert.equal(b64(bytes),expected);assert.equal(encodeAttachmentData(bytes),expected);
  assert.equal(b64url(bytes),Buffer.from(bytes).toString('base64url'));
  assert.deepEqual([...decodeAttachmentData(expected)],[...bytes]);
 }
 assert.equal(b64url('您好 🙂\n'),Buffer.from('您好 🙂\n').toString('base64url'));
 for(const bad of ['a','a===','ab=c','%%%%'])assert.throws(()=>decodeAttachmentData(bad));
});

test('MIME folding round-trips multiple binary attachments with Unicode filenames',()=>{
 const originals=[Uint8Array.from({length:9086982},(_,i)=>i%251),new Uint8Array([0,128,255,1])];
 const attachments=originals.map((bytes,i)=>({id:`11111111-1111-4111-8111-11111111111${i}`,name:`報告${i}.bin`,type:'application/octet-stream',size:bytes.length,data:encodeAttachmentData(bytes)}));
 const raw=buildMime({to:'test@example.org',subject:'您好',body:'Test',bodyHtml:'<p>Test</p>',attachments},'me@example.org','memory@eren-mail.invalid');
 const mime=Buffer.from(raw,'base64url').toString('utf8');
 const encoded=[...mime.matchAll(/Content-Disposition: attachment;[^\r]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)(?=\r\n--)/g)];
 assert.equal(encoded.length,2);
 encoded.forEach((part,i)=>{
  assert(part[1].split('\r\n').every(line=>line.length<=76));
  assert.deepEqual(Buffer.from(part[1],'base64'),Buffer.from(originals[i]));
 });
 assert.match(mime,/filename\*=UTF-8''%E5%A0%B1%E5%91%8A0.bin/);
 for(const data of ['a','YQ=','Y===','YQ=x'])assert.throws(()=>buildMime({to:'test@example.org',subject:'x',body:'x',attachments:[{...attachments[1],size:1,data}]},'me@example.org','invalid'));
});

test('incident-sized and maximum supported attachments stay within the encoder memory budget',()=>{
 for(const size of [9086982,20*1024*1024]) {
  const result=JSON.parse(execFileSync(process.execPath,['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON','tests/fixtures/attachment-memory.mjs',String(size)],{encoding:'utf8'}));
  // Full process RSS, stricter than V8 heap alone. Leave room for worker overhead.
  assert(result.peakRssBytes<230*1024*1024,JSON.stringify(result));
  assert(result.encodedBytes>size);
 }
});
