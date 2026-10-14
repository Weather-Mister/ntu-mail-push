import { sqliteFiles } from './sqlite-files.mjs';
const encoder=new TextEncoder(),MAX_FILE=100*1024*1024;
export const transferRoutes=new Map([
  ['transfer/list','GET'],['transfer/text','POST'],['transfer/upload','POST'],
  ['transfer/upload-chunk','POST'],['transfer/finalize','POST'],['transfer/chunk','GET'],
  ['transfer/file','GET'],['transfer/delete','POST'],['transfer/object','GET']
]);
function chunks(content) {try{const value=JSON.parse(content||'{}');return value.chunked&&Array.isArray(value.keys)?value.keys:[]}catch{return []}}
const uploadId=value=>/^[a-zA-Z0-9_-]{12,80}$/.test(String(value||''))?String(value):'';
async function signature(env,id,expires,download) {
  if(!/^[a-f0-9]{64}$/i.test(env.DOWNLOAD_SIGNING_KEY||''))throw new Error('File signing secret not configured');
  const key=await crypto.subtle.importKey('raw',encoder.encode(env.DOWNLOAD_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode([env.APP_SLUG,id,expires,download].join('|'))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function validDownload(req,env) {
  const url=new URL(req.url),expires=url.searchParams.get('expires'),id=url.searchParams.get('id'),download=url.searchParams.get('download')||'0',supplied=url.searchParams.get('sig');
  if(url.searchParams.get('route')!=='transfer/object'||!id||!/^\d+$/.test(expires||'')||Number(expires)<Math.floor(Date.now()/1000)||Number(expires)>Math.floor(Date.now()/1000)+3600||!['0','1'].includes(download)||!/^[a-f0-9]{64}$/.test(supplied||''))return false;
  const expected=await signature(env,id,expires,download);let mismatch=0;
  for(let index=0;index<64;index++)mismatch|=expected.charCodeAt(index)^supplied.charCodeAt(index);
  return mismatch===0;
}
async function fileUrl(req,env,id,download=false) {
  const url=new URL(req.url);url.search='';const expires=String(Math.floor(Date.now()/1000)+3600),mode=download?'1':'0';
  for(const [key,value]of Object.entries({route:'transfer/object',id,expires,download:mode,sig:await signature(env,id,expires,mode)}))url.searchParams.set(key,value);
  return url.toString();
}
export async function handleTransfer(req,env,owner,reply,readJson) {
  const route=new URL(req.url).searchParams.get('route'),prefix=owner.source_workspace_hash+'/';
  if(env.TRANSFER_ENABLED!=='true')return reply({error:'Transfer staging is not enabled.'},503);
  const storage=env.FILE_STORE?sqliteFiles(env):env.FILES;
  if(!storage||!/^[a-f0-9]{64}$/i.test(env.DOWNLOAD_SIGNING_KEY||''))return reply({error:'File storage is not configured.'},503);
  const owned=key=>typeof key==='string'&&key.startsWith(prefix);
  let skipped=[];try{skipped=JSON.parse(env.SKIPPED_TRANSFER_IDS||'[]')}catch{return reply({error:'Transfer configuration is invalid.'},503)}
  if(!Array.isArray(skipped)||skipped.length>40||skipped.some(id=>typeof id!=='string'||!id||id.length>120))return reply({error:'Transfer configuration is invalid.'},503);
  const itemById=id=>skipped.includes(id)?null:env.DB.prepare('SELECT * FROM schedule_transfer_items WHERE id=?').bind(id).first();
  async function view(row) {
    return {id:row.id,kind:row.kind,content:row.kind==='file'?'':row.content||'',filename:row.filename||'',contentType:row.content_type||'',bytes:row.bytes||0,createdAt:row.created_at,
      url:row.storage_key?await fileUrl(req,env,row.id):'',downloadUrl:row.storage_key?await fileUrl(req,env,row.id,true):'',chunkCount:row.kind==='file'?chunks(row.content).length:0};
  }
  if(route==='transfer/list') {
    const {results}=await env.DB.prepare('SELECT * FROM schedule_transfer_items WHERE id NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT 40').bind(JSON.stringify(skipped)).all();
    return reply({items:await Promise.all(results.map(view))});
  }
  if(route==='transfer/text') {
    const input=await readJson(req),content=String(input?.content||'').trim();
    if(!content)return reply({error:'Nothing to send.'},400);
    if(content.length>20000)return reply({error:'Text is too long.'},413);
    let kind='text';try{const url=new URL(content);if(['http:','https:'].includes(url.protocol)&&!/\s/.test(content))kind='link'}catch{}
    const row=await env.DB.prepare('INSERT INTO schedule_transfer_items(id,kind,content) VALUES(?,?,?) RETURNING id,kind,content,created_at').bind(crypto.randomUUID(),kind,content).first();
    return reply({item:row});
  }
  if(!storage)return reply({error:'File storage is not configured.'},503);
  if(['transfer/upload','transfer/upload-chunk'].includes(route)) {
    if(!req.headers.get('Content-Type')?.startsWith('multipart/form-data;'))return reply({error:'Multipart file upload required.'},400);
    // Bound the multipart request before parsing it into memory.
    const limit=(route==='transfer/upload'?10:5)*1024*1024+64*1024;
    const reader=req.body?.getReader();if(!reader)return reply({error:'No file selected.'},400);
    const parts=[];let size=0;while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit){await reader.cancel();return reply({error:'File is too large.'},413)}parts.push(next.value)}
    const buffer=new Uint8Array(size);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.byteLength}
    const form=await new Response(buffer,{headers:{'Content-Type':req.headers.get('Content-Type')||''}}).formData();
    if(route==='transfer/upload') {
      const file=form.get('file');if(!(file instanceof File))return reply({error:'No file selected.'},400);
      if(file.size>10*1024*1024)return reply({error:'File is too large. Maximum size is 10 MB.'},413);
      const filename=String(file.name||'file').slice(0,240),type=file.type||'application/octet-stream',id=crypto.randomUUID();
      const extension=filename.match(/(\.[a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase()||'',key=`${prefix}files/${id}${extension}`;
      await storage.put(key,file.stream(),{httpMetadata:{contentType:type}});
      try {const row=await env.DB.prepare('INSERT INTO schedule_transfer_items(id,kind,storage_key,filename,content_type,bytes) VALUES(?,?,?,?,?,?) RETURNING *').bind(id,'file',key,filename,type,file.size).first();return reply({item:{...row,url:await fileUrl(req,env,id)}})}
      catch(error){await storage.delete(key);throw error}
    }
    const chunk=form.get('chunk'),id=uploadId(form.get('uploadId')),index=Number(form.get('index')),count=Number(form.get('totalChunks')),bytes=Number(form.get('totalBytes'));
    if(!(chunk instanceof File)||!id||!Number.isInteger(index)||index<0||index>=25||!Number.isInteger(count)||count<1||count>25||index>=count)return reply({error:'Invalid file chunk.'},400);
    if(!Number.isFinite(bytes)||bytes<1||bytes>MAX_FILE||chunk.size>5*1024*1024)return reply({error:'File is too large. Maximum size is 100 MB.'},413);
    const key=`${prefix}chunks/${id}/${String(index).padStart(3,'0')}`;
    await storage.put(key,chunk.stream(),{httpMetadata:{contentType:'application/octet-stream'}});
    return reply({ok:true,key,index});
  }
  if(route==='transfer/finalize') {
    const input=await readJson(req),id=uploadId(input?.uploadId),count=Number(input?.totalChunks),bytes=Number(input?.totalBytes);
    if(!id||!Number.isInteger(count)||count<1||count>25)return reply({error:'Invalid chunk count.'},400);
    if(!Number.isFinite(bytes)||bytes<1||bytes>MAX_FILE)return reply({error:'File is too large. Maximum size is 100 MB.'},413);
    const keys=Array.from({length:count},(_,index)=>`${prefix}chunks/${id}/${String(index).padStart(3,'0')}`);
    let received=0;for(const key of keys){const object=await storage.head(key);if(!object)return reply({error:'Upload is incomplete. Please try again.'},409);received+=object.size}
    if(received!==bytes)return reply({error:'Upload size did not match. Please try again.'},409);
    const row=await env.DB.prepare('INSERT INTO schedule_transfer_items(id,kind,content,filename,content_type,bytes) VALUES(?,?,?,?,?,?) RETURNING *').bind(crypto.randomUUID(),'file',JSON.stringify({chunked:true,keys}),String(input.filename||'file').slice(0,240),String(input.contentType||'application/octet-stream').slice(0,180),bytes).first();
    return reply({item:row});
  }
  if(route==='transfer/chunk') {
    const url=new URL(req.url),id=url.searchParams.get('id')||'',index=Number(url.searchParams.get('index'));
    if(!id||!Number.isInteger(index)||index<0||index>100)return reply({error:'Invalid chunk request.'},400);
    const row=await itemById(id),key=row?.kind==='file'?chunks(row.content)[index]:null;
    if(!owned(key))return reply({error:'Chunk not found.'},404);
    const object=await storage.get(key);if(!object)return reply({error:'Chunk not found.'},404);
    return new Response(object.body,{headers:{...Object.fromEntries(reply({}).headers),'Content-Type':'application/octet-stream','Content-Length':String(object.size)}});
  }
  if(route==='transfer/file'||route==='transfer/object') {
    const url=new URL(req.url),row=await itemById(url.searchParams.get('id')||'');
    if(!row||row.kind!=='file'||!owned(row.storage_key))return reply({error:'File not found.'},404);
    if(route==='transfer/file')return Response.redirect(await fileUrl(req,env,row.id,true),302);
    const object=await storage.get(row.storage_key);if(!object)return reply({error:'File not found.'},404);
    const headers=new Headers(reply({}).headers);headers.set('Content-Type',row.content_type||'application/octet-stream');headers.set('Content-Length',String(object.size));headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
    // Treat transferred files as downloads; untrusted HTML never executes on the API origin.
    headers.set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.filename||'download')}`);
    return new Response(object.body,{headers});
  }
  if(route==='transfer/delete') {
    const input=await readJson(req),row=await itemById(String(input?.id||''));if(!row)return reply({error:'Item not found.'},404);
    const keys=[row.storage_key,row.download_storage_key,...chunks(row.content)].filter(owned);
    if(keys.length)await storage.delete([...new Set(keys)]);
    await env.DB.prepare('DELETE FROM schedule_transfer_items WHERE id=?').bind(row.id).run();return reply({ok:true});
  }
  return reply({error:'Not found.'},404);
}
