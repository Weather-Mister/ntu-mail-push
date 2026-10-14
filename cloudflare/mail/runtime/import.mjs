import { primaryKeys,jsonColumns } from './schema.mjs';
const canonical=value=>JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item);
export const importTables=['eren_mail_accounts','eren_mail_messages','eren_mail_rules','eren_mail_outbox','eren_mail_drafts','eren_mail_preferences','eren_mail_unsubscribes'];
export function validateMailTransfer(snapshot,env) {
 if(snapshot.format!==1||snapshot.source_project!=='evckshjtzikuusnkdnjn'||snapshot.workspace?.app_slug!==env.APP_SLUG||snapshot.workspace.workspace_hash!==env.MAIL_WORKSPACE_HASH)throw new Error('Mail import ownership mismatch');
 const owner=env.MAIL_WORKSPACE_HASH,accounts=new Set(snapshot.tables.eren_mail_accounts.map(row=>row.id));
 for(const table of importTables) {
  const rows=snapshot.tables[table];if(!Array.isArray(rows)||rows.length>10000)throw new Error('Invalid mail import table');
  for(const row of rows){if(row.workspace_hash&&row.workspace_hash!==owner||row.account_id&&!accounts.has(row.account_id))throw new Error('Cross-owner mail import rejected');}
 }
 if(snapshot.tables.eren_mail_outbox.some(row=>['pending','processing','sending','uncertain'].includes(row.status)))throw new Error('Mail deliveries need reconciliation before importing');
 if(!Array.isArray(snapshot.secrets)||snapshot.secrets.some(secret=>!secret.name.startsWith('eren-mail:'+owner+':')||typeof secret.value!=='string'))throw new Error('Invalid mail secret ownership');
 const secrets=new Set(snapshot.secrets.map(secret=>secret.name));
 for(const account of snapshot.tables.eren_mail_accounts)if(!secrets.has(account.secret_name))throw new Error('Account credentials are missing');
 if(snapshot.attachment_objects!==0)throw new Error('Existing attachment objects must be copied before mail import');
 return snapshot;
}
export async function importMail(req,admin,env) {
 const reader=req.body?.getReader();if(!reader)throw new Error('Import payload required');
 const parts=[];let size=0;
 while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>32*1024*1024){await reader.cancel();throw new Error('Mail import needs splitting')}parts.push(next.value)}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
 const snapshot=validateMailTransfer(JSON.parse(new TextDecoder().decode(bytes)),env);
 if(admin.sql.exec('SELECT count(*) AS n FROM mail_migration').one().n||admin.sql.exec('SELECT count(*) AS n FROM mail_secrets').one().n||importTables.some(table=>admin.sql.exec('SELECT count(*) AS n FROM '+table).one().n))throw new Error('Mail import destination must be empty');
 const installed=[];
 try {
  for(const secret of snapshot.secrets){await admin.privateSecret(secret.name,secret.value);installed.push(secret.name);if(await admin.privateSecret(secret.name)!==secret.value)throw new Error('Credential encryption parity failed')}
  admin.state.storage.transactionSync(()=>{
   for(const table of importTables)for(const original of snapshot.tables[table]) {
    const row=table==='eren_mail_accounts'?{...original,sync_lock_until:null,sync_lock_id:null}:original;
    const names=Object.keys(row);if(names.some(name=>!admin.columns[table].includes(name)))throw new Error('Unexpected source mail column');
    const values=names.map(name=>row[name]===null?null:typeof row[name]==='object'?JSON.stringify(row[name]):typeof row[name]==='boolean'?Number(row[name]):row[name]);
    admin.sql.exec('INSERT INTO '+table+' ('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')',...values);
    const keys=primaryKeys[table],stored=admin.sql.exec('SELECT * FROM '+table+' WHERE '+keys.map(key=>key+'=?').join(' AND '),...keys.map(key=>row[key])).one();
    const decoded=Object.fromEntries(Object.entries(stored).map(([name,value])=>[name,value===null?null:jsonColumns.has(name)?JSON.parse(value):name==='enabled'?Boolean(value):value]));
    if(canonical(decoded)!==canonical(row))throw new Error('Mail record parity failed');
   }
   admin.sql.exec('INSERT INTO mail_migration VALUES(1,?)',snapshot.snapshot_at);
  });
  return {imported:true,counts:Object.fromEntries(importTables.map(table=>[table,snapshot.tables[table].length])),metadataParity:true,credentialEncryptionParity:true,credentialsEncrypted:true,jobsEnabled:false};
 }catch(error){for(const name of installed)await admin.privateSecret(name,null,true);throw error;}
}
