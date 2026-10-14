import { sqliteFiles } from './sqlite-files.mjs';
const maxBytes=10*1024*1024;
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
function references(row) {
 let chunks=[];try{const value=JSON.parse(row.content||'{}');if(value.chunked&&Array.isArray(value.keys))chunks=value.keys;}catch{}
 return [row.storage_key,row.download_storage_key,...chunks].filter(Boolean);
}
export async function importFile(req,env,owner,reply) {
 // One-time staging import only. This route is absent during ordinary transfer
 // use and may never overwrite an existing object with different bytes.
 if(env.FILE_IMPORT_MODE!=='staging'||env.TRANSFER_ENABLED==='true'||!env.FILE_STORE)return reply({error:'Not found.'},404);
 const url=new URL(req.url),key=url.searchParams.get('key'),expected=url.searchParams.get('sha256');
 if(typeof key!=='string'||!key.startsWith(owner.source_workspace_hash+'/')||key.includes('..')||!key.length||key.length>1024||!/^[a-f0-9]{64}$/.test(expected||''))return reply({error:'Invalid migration object.'},400);
 const rows=(await env.DB.prepare("SELECT storage_key,download_storage_key,content FROM schedule_transfer_items WHERE kind='file'").all()).results;
 if(!rows.some(row=>references(row).includes(key)))return reply({error:'Object is not referenced by the copied owner data.'},404);
 const storage=sqliteFiles(env),old=await storage.get(key);
 if(url.searchParams.get('route')==='migration/file-check') {
  if(!old)return reply({error:'Object not copied yet.'},404);
  const bytes=await new Response(old.body).arrayBuffer();
  return reply({bytes:bytes.byteLength,sha256:await digest(bytes),matched:await digest(bytes)===expected});
 }
 if(old) {
  const bytes=await new Response(old.body).arrayBuffer();
  return await digest(bytes)===expected?reply({copied:true,alreadyPresent:true,bytes:bytes.byteLength,sha256:expected}):reply({error:'An existing object differs; it was not overwritten.'},409);
 }
 const reader=req.body?.getReader();if(!reader)return reply({error:'Object bytes required.'},400);
 let length=0;const parts=[];
 while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>maxBytes){await reader.cancel();return reply({error:'Migration object exceeds the direct object limit.'},413);}parts.push(next.value);}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 if(await digest(bytes)!==expected)return reply({error:'Migration checksum mismatch; no object was stored.'},400);
 await storage.put(key,bytes,{httpMetadata:{contentType:req.headers.get('Content-Type')||'application/octet-stream'}});
 return reply({copied:true,alreadyPresent:false,bytes:length,sha256:expected});
}
