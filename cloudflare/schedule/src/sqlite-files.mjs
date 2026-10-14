// Private file storage on the existing Workers Free plan. No R2 or billing setup.
// Each BLOB stays below SQLite's 2 MB row limit; the application caps live data
// at 512 MiB to leave room below the Free plan's 1 GB per-object limit.
const PART_BYTES=1024*1024, MAX_OBJECT_BYTES=10*1024*1024;
export const FILE_BUDGET_BYTES=512*1024*1024;
export class FileStorageError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export function sqliteFiles(env) {
  const stub=env.FILE_STORE.get(env.FILE_STORE.idFromName(env.APP_SLUG));
  const url=key=>'https://files.internal/object?key='+encodeURIComponent(key);
  async function checked(response) {
    if(!response.ok){const value=await response.json().catch(()=>({}));throw new FileStorageError(response.status,value.error||'File storage is unavailable.');}
    return response;
  }
  return {
    async put(key,body,options={}) {
      await checked(await stub.fetch(url(key),{method:'PUT',body,headers:{'Content-Type':options.httpMetadata?.contentType||'application/octet-stream'}}));
    },
    async head(key) {
      const result=await stub.fetch(url(key),{method:'HEAD'});
      if(result.status===404)return null;
      await checked(result);return {size:Number(result.headers.get('Content-Length'))};
    },
    async get(key) {
      const result=await stub.fetch(url(key));if(result.status===404)return null;
      await checked(result);return {size:Number(result.headers.get('Content-Length')),body:result.body};
    },
    async delete(keys) {
      await checked(await stub.fetch('https://files.internal/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Array.isArray(keys)?keys:[keys])}));
    }
  };
}
export class FileStore {
  constructor(state,env) {
    this.state=state;this.env=env;this.sql=state.storage.sql;this.uploads=0;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS files(key TEXT PRIMARY KEY,size INTEGER NOT NULL,content_type TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS file_parts(key TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(key,part));
      CREATE TABLE IF NOT EXISTS file_usage(singleton INTEGER PRIMARY KEY CHECK(singleton=1),bytes INTEGER NOT NULL,objects INTEGER NOT NULL);
      INSERT OR IGNORE INTO file_usage VALUES(1,0,0);`);
  }
  valid(key){return typeof key==='string'&&key.length<=1024&&/^[a-f0-9]{64}\//.test(key)&&!/[\x00-\x1f]/.test(key);}
  row(key){return this.sql.exec('SELECT size,content_type FROM files WHERE key=?',key).toArray()[0];}
  remove(key) {
    const old=this.row(key);if(!old)return;
    this.sql.exec('DELETE FROM file_parts WHERE key=?',key);
    this.sql.exec('DELETE FROM files WHERE key=?',key);
    this.sql.exec('UPDATE file_usage SET bytes=bytes-?,objects=objects-1 WHERE singleton=1',old.size);
  }
  async fetch(req) {
    const url=new URL(req.url),key=url.searchParams.get('key');
    try {
      if(url.pathname==='/delete'&&req.method==='POST') {
        if(Number(req.headers.get('Content-Length'))>32*1024)return Response.json({error:'Delete request is too large.'},{status:413});
        const text=await req.text();if(text.length>32*1024)return Response.json({error:'Delete request is too large.'},{status:413});
        let keys;try{keys=JSON.parse(text)}catch{return Response.json({error:'Invalid delete request.'},{status:400})}
        if(!Array.isArray(keys)||keys.length>30||!keys.every(value=>this.valid(value)))return Response.json({error:'Invalid storage keys.'},{status:400});
        this.state.storage.transactionSync(()=>{for(const value of new Set(keys))this.remove(value)});
        return new Response(null,{status:204});
      }
      if(url.pathname!=='/object'||!this.valid(key))return Response.json({error:'Invalid storage key.'},{status:400});
      if(req.method==='PUT') {
        if(this.uploads>=(this.env.FILE_UPLOAD_CONCURRENCY||3))return Response.json({error:'File storage is busy. Please try again.'},{status:429});
        this.uploads++;
        try {
          const reader=req.body?.getReader(),parts=[];let size=0;
          if(reader)while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>(this.env.FILE_OBJECT_MAX_BYTES||MAX_OBJECT_BYTES)){await reader.cancel();return Response.json({error:'File is too large.'},{status:413})}parts.push(next.value)}
          const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
          this.state.storage.transactionSync(()=>{
            const old=this.row(key),usage=this.sql.exec('SELECT bytes,objects FROM file_usage WHERE singleton=1').one();
            if(usage.bytes-(old?.size||0)+size>FILE_BUDGET_BYTES||usage.objects+(old?0:1)>4096)throw new FileStorageError(507,'File storage is full. Download and remove an existing transfer before uploading more.');
            this.remove(key);
            this.sql.exec('INSERT INTO files VALUES(?,?,?)',key,size,(req.headers.get('Content-Type')||'application/octet-stream').slice(0,180));
            for(let start=0,part=0;start<size;start+=PART_BYTES,part++)this.sql.exec('INSERT INTO file_parts VALUES(?,?,?)',key,part,bytes.slice(start,start+PART_BYTES).buffer);
            this.sql.exec('UPDATE file_usage SET bytes=bytes+?,objects=objects+1 WHERE singleton=1',size);
          });
          return new Response(null,{status:204});
        }finally{this.uploads--}
      }
      if(!['GET','HEAD'].includes(req.method))return new Response(null,{status:405});
      const row=this.row(key);if(!row)return new Response(null,{status:404});
      const headers={'Content-Length':String(row.size),'Content-Type':row.content_type,'Cache-Control':'no-store'};
      if(req.method==='HEAD')return new Response(null,{headers});
      // Consume the cursor synchronously: a cursor held across awaits does not
      // provide snapshot isolation. At most 10 MiB is retained per download.
      const parts=this.sql.exec('SELECT data FROM file_parts WHERE key=? ORDER BY part',key).toArray();
      let index=0;
      return new Response(new ReadableStream({pull(controller){if(index<parts.length){const part=parts[index];parts[index++]=null;controller.enqueue(new Uint8Array(part.data))}else controller.close()}}),{headers});
    }catch(error) {
      if(error instanceof FileStorageError)return Response.json({error:error.message},{status:error.status});
      return Response.json({error:'File storage request failed. Existing files are retained.'},{status:503});
    }
  }
}
