import { primaryKeys,jsonColumns } from './schema.mjs';
import { sqliteFiles } from '../src/sqlite-files.mjs';
const encode=(key,value)=>value===null?null:jsonColumns.has(key)?JSON.stringify(value):typeof value==='boolean'?Number(value):value;
const decode=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value===null?null:jsonColumns.has(key)?JSON.parse(value):key==='enabled'?Boolean(value):value]));
const ident=value=>{if(!/^[a-z_]+$/.test(value))throw new Error('Invalid mail column');return '"'+value+'"';};
const checkedColumns=(admin,table,value)=>{const columns=value==='*'?admin.columns[table]:String(value).split(',');if(!columns.length||columns.some(name=>!admin.columns[table].includes(name)))throw new Error('Unsupported mail projection');return columns.map(ident).join(',');};
class Query {
  constructor(admin,table){this.admin=admin;this.table=table;this.operation='select';this.fields='*';this.filters=[];this.values=[];this.sort=[];this.max=null;this.cardinality='array';}
  select(fields='*'){this.fields=fields;this.returning=true;return this;}
  insert(rows){this.operation='insert';this.rows=Array.isArray(rows)?rows:[rows];this.returning=false;return this;}
  upsert(rows,options={}){this.insert(rows);this.operation='upsert';this.conflict=options.onConflict?.split(',')||primaryKeys[this.table];return this;}
  update(values){this.operation='update';this.patch=values;this.returning=false;return this;}
  delete(){this.operation='delete';this.returning=false;return this;}
  column(name){if(this.table==='eren_mail_messages'&&name==='workspace_hash')return '(SELECT workspace_hash FROM eren_mail_accounts WHERE eren_mail_accounts.id=eren_mail_messages.account_id)';if(!this.admin.columns[this.table].includes(name))throw new Error('Unknown mail column');return ident(name);}
  compare(name,op,value){this.filters.push(this.column(name)+' '+op+' ?');this.values.push(encode(name,value));return this;}
  eq(name,value){return this.compare(name,'=',value);} neq(name,value){return this.compare(name,'!=',value);}
  gt(name,value){return this.compare(name,'>',value);} lt(name,value){return this.compare(name,'<',value);}
  in(name,values){if(!Array.isArray(values)||values.length>5000)throw new Error('Invalid mail filter');this.filters.push(this.column(name)+' IN (SELECT value FROM json_each(?))');this.values.push(JSON.stringify(values.map(value=>encode(name,value))));return this;}
  contains(name,values){if(!jsonColumns.has(name)||!Array.isArray(values))throw new Error('Invalid array filter');for(const value of values){this.filters.push(`EXISTS(SELECT 1 FROM json_each(${this.column(name)}) WHERE value=?)`);this.values.push(value)}return this;}
  or(value){const match=String(value).match(/^sync_lock_until\.is\.null,sync_lock_until\.lt\.(.+)$/);if(!match)throw new Error('Unsupported mail filter');this.filters.push('(sync_lock_until IS NULL OR sync_lock_until < ?)');this.values.push(match[1]);return this;}
  order(name,options={}){const asc=options.ascending!==false;this.sort.push(this.column(name)+(asc?' ASC':' DESC')+((options.nullsFirst??!asc)?' NULLS FIRST':' NULLS LAST'));return this;}
  limit(value){if(!Number.isInteger(value)||value<0||value>5000)throw new Error('Invalid mail limit');this.max=value;return this;}
  single(){this.cardinality='single';return this;} maybeSingle(){this.cardinality='maybe';return this;}
  async execute() {
    try {
      const table=ident(this.table),where=this.filters.length?' WHERE '+this.filters.join(' AND '):'',projection=checkedColumns(this.admin,this.table,this.fields);
      let rows=[];
      if(this.operation==='select') {
        // Do not expand a large IN list beyond SQLite's 100 bind parameters.
        if(this.values.length>100)throw new Error('Mail batch needs splitting');
        rows=this.admin.sql.exec('SELECT '+projection+' FROM '+table+where+(this.sort.length?' ORDER BY '+this.sort.join(','):'')+(this.max===null?'':' LIMIT '+this.max),...this.values).toArray();
      }else {
        if(this.operation!=='delete'&&this.admin.sql.databaseSize>512*1024*1024)throw new Error('Mail storage allowance reached');
        this.admin.state.storage.transactionSync(()=>{
          if(this.operation==='update') {
            const names=Object.keys(this.patch);names.forEach(name=>this.column(name));
            rows=this.admin.sql.exec('UPDATE '+table+' SET '+names.map(name=>ident(name)+'=?').join(',')+where+(this.returning?' RETURNING '+projection:''),...names.map(name=>encode(name,this.patch[name])),...this.values).toArray();
          }else if(this.operation==='delete')rows=this.admin.sql.exec('DELETE FROM '+table+where+(this.returning?' RETURNING '+projection:''),...this.values).toArray();
          else for(const original of this.rows) {
            const row={...original};if(['eren_mail_accounts','eren_mail_rules'].includes(this.table)&&!row.id)row.id=crypto.randomUUID();
            const names=Object.keys(row);names.forEach(name=>this.column(name));
            let conflict='';
            if(this.operation==='upsert') {this.conflict.forEach(name=>this.column(name));const changed=names.filter(name=>!this.conflict.includes(name));conflict=' ON CONFLICT ('+this.conflict.map(ident).join(',')+') '+(changed.length?'DO UPDATE SET '+changed.map(name=>ident(name)+'=excluded.'+ident(name)).join(','):'DO NOTHING');}
            rows.push(...this.admin.sql.exec('INSERT INTO '+table+' ('+names.map(ident).join(',')+') VALUES ('+names.map(()=>'?').join(',')+')'+conflict+(this.returning?' RETURNING '+projection:''),...names.map(name=>encode(name,row[name]))).toArray());
          }
        });
      }
      rows=rows.map(decode);
      if(this.cardinality!=='array') {if(rows.length>1||this.cardinality==='single'&&rows.length!==1)throw new Error('Mail row cardinality mismatch');return {data:rows[0]||null,error:null};}
      return {data:this.returning||this.operation==='select'?rows:null,error:null};
    }catch(error){return {data:null,error:{code:String(error.message).includes('UNIQUE constraint')?'23505':'MAIL_STORAGE',message:'Mail storage request failed'}};}
  }
  then(resolve,reject){return this.execute().then(resolve,reject);}
}
export class MailDatabase {
  constructor(state,env) {
    this.state=state;this.sql=state.storage.sql;this.env=env;
    this.columns=Object.fromEntries(Object.keys(primaryKeys).map(table=>[table,this.sql.exec('PRAGMA table_info('+ident(table)+')').toArray().map(row=>row.name)]));
    const files=env.FILE_STORE?sqliteFiles(env):null;
    this.storage={from:bucket=>{
      if(bucket!=='eren-mail-attachments'||!files)throw new Error('Private mail attachments not configured');
      return {
        upload:async(path,bytes,options={})=>{try{await files.put(path,new Blob([bytes]).stream(),{httpMetadata:{contentType:options.contentType}});return {error:null}}catch{return {error:{message:'Attachment storage failed'}}}},
        download:async path=>{try{const item=await files.get(path);return item?{data:await new Response(item.body).blob(),error:null}:{data:null,error:{message:'Attachment not found'}}}catch{return {data:null,error:{message:'Attachment download failed'}}}},
        remove:async paths=>{try{await files.delete(paths);return {error:null}}catch{return {error:{message:'Attachment removal failed'}}}}
      };
    }};
  }
  from(table){if(!primaryKeys[table])throw new Error('Unknown mail table');return new Query(this,table);}
  async encryptionKey() {
    const hex=this.env.MAIL_ENCRYPTION_KEY;if(!/^[a-f0-9]{64}$/i.test(hex||''))throw new Error('Mail encryption key missing');
    return crypto.subtle.importKey('raw',Uint8Array.from(hex.match(/../g),value=>parseInt(value,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  async privateSecret(name,value=null,remove=false) {
    if(!name.startsWith('eren-mail:'+this.env.MAIL_WORKSPACE_HASH+':'))throw new Error('Secret ownership mismatch');
    if(remove){this.sql.exec('DELETE FROM mail_secrets WHERE name=?',name);return null;}
    const key=await this.encryptionKey(),encoder=new TextEncoder();
    if(value!==null) {
      if(this.sql.databaseSize>512*1024*1024)throw new Error('Mail storage allowance reached');
      const bytes=encoder.encode(value);if(bytes.length>30*1024*1024)throw new Error('Mail secret is too large');
      const generation=crypto.randomUUID(),parts=[];
      for(let offset=0,part=0;offset<bytes.length||part===0;offset+=1024*1024,part++) {
        const iv=crypto.getRandomValues(new Uint8Array(12)),aad=encoder.encode([this.env.APP_SLUG,name,generation,part].join('|'));
        parts.push({iv:iv.buffer,ciphertext:await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,bytes.subarray(offset,offset+1024*1024))});
      }
      this.state.storage.transactionSync(()=>{
        this.sql.exec('DELETE FROM mail_secrets WHERE name=?',name);
        this.sql.exec('INSERT INTO mail_secrets VALUES(?,?,?)',name,generation,parts.length);
        for(let part=0;part<parts.length;part++)this.sql.exec('INSERT INTO mail_secret_parts VALUES(?,?,?,?)',name,part,parts[part].iv,parts[part].ciphertext);
      });return null;
    }
    const manifest=this.sql.exec('SELECT generation,parts FROM mail_secrets WHERE name=?',name).toArray()[0];if(!manifest)return null;
    const parts=this.sql.exec('SELECT part,iv,ciphertext FROM mail_secret_parts WHERE name=? ORDER BY part',name).toArray();if(parts.length!==manifest.parts)throw new Error('Incomplete mail secret');
    const decoder=new TextDecoder();let decoded='';
    for(const part of parts){const aad=encoder.encode([this.env.APP_SLUG,name,manifest.generation,part.part].join('|'));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:part.iv,additionalData:aad},key,part.ciphertext);decoded+=decoder.decode(plain,{stream:true})}
    return decoded+decoder.decode();
  }
  async rpc(name,args={}) {
    try {
      let data=null;
      if(name==='eren_mail_secret')data=await this.privateSecret(args.p_name,args.p_value??null,args.p_delete||false);
      else if(name==='eren_mail_rate') {
        const now=new Date(),started=now.toISOString(),cutoff=new Date(now.getTime()-args.p_seconds*1000).toISOString();
        const row=this.sql.exec(`INSERT INTO eren_mail_limits(bucket,started_at,hits) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN started_at<? THEN 1 ELSE hits+1 END,started_at=CASE WHEN started_at<? THEN excluded.started_at ELSE started_at END RETURNING hits`,args.p_bucket,started,cutoff,cutoff).one();data=row.hits<=args.p_limit;
      }else if(name==='eren_mail_claim') {
        const now=new Date(),started=now.toISOString(),until=new Date(now.getTime()+120000).toISOString();
        data=this.sql.exec(`UPDATE eren_mail_outbox SET status='processing',locked_until=?,attempts=attempts+1 WHERE id IN (SELECT id FROM eren_mail_outbox WHERE (? IS NULL OR id=?) AND send_at<=? AND (status='pending' OR status='processing' AND locked_until<?) ORDER BY send_at LIMIT 1) RETURNING *`,until,args.p_id??null,args.p_id??null,started,started).toArray().map(decode);
      }else if(name==='eren_mail_apply_cache_actions') {
        const operations=args.p_actions;if(!Array.isArray(operations)||operations.length>100)throw new Error('Invalid mail actions');
        const effects={trash:[['INBOX'],['TRASH']],untrash:[['TRASH'],['INBOX']],archive:[['INBOX'],[]],unarchive:[[],['INBOX']],read:[['UNREAD'],[]],unread:[[],['UNREAD']],star:[[],['STARRED']],unstar:[['STARRED'],[]]};
        this.state.storage.transactionSync(()=>{for(const operation of operations){const effect=effects[operation.action];if(!effect)throw new Error('Invalid mail action');const rows=this.sql.exec('SELECT id,labels FROM eren_mail_messages WHERE account_id=? AND thread_id=?',operation.accountId,operation.threadId).toArray();for(const row of rows){const labels=[...new Set([...JSON.parse(row.labels).filter(label=>!effect[0].includes(label)),...effect[1]])];this.sql.exec('UPDATE eren_mail_messages SET labels=?,updated_at=? WHERE account_id=? AND id=?',JSON.stringify(labels),new Date().toISOString(),operation.accountId,row.id)}}});
      }else throw new Error('Unknown mail operation');
      return {data,error:null};
    }catch{return {data:null,error:{code:'MAIL_STORAGE',message:'Mail private operation failed'}};}
  }
}
