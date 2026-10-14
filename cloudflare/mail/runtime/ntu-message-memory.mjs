// Private, bounded MIME cache. It never enters browser storage or a public cache.
export class NtuMessageMemory {
 constructor(ttl=300000,maxEntries=24,maxBytes=24*1024*1024){this.ttl=ttl;this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.entries=new Map();this.bytes=0;}
 key(account,id,ref){return JSON.stringify([account.workspace_hash,account.id,id,ref.mailbox,String(ref.uid)]);}
 has(key){const entry=this.entries.get(key);if(entry&&entry.until>Date.now())return true;this.drop(key);return false;}
 get(key){const entry=this.entries.get(key);if(!entry)return null;if(entry.until<=Date.now()){this.drop(key);return null;}this.entries.delete(key);this.entries.set(key,entry);return structuredClone(entry.message);}
 drop(key){const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key);}}
 set(key,message){this.drop(key);const bytes=JSON.stringify(message).length*2;if(bytes>this.maxBytes/2)return;this.entries.set(key,{message:structuredClone(message),bytes,until:Date.now()+this.ttl});this.bytes+=bytes;while(this.entries.size>this.maxEntries||this.bytes>this.maxBytes)this.drop(this.entries.keys().next().value);}
 clear(workspace=''){for(const key of this.entries.keys())if(!workspace||JSON.parse(key)[0]===workspace)this.drop(key);}
}
export function messageWithoutAttachmentData(message){
 const copy=structuredClone(message);
 function visit(part){if(part.body?.attachmentId)delete part.body.data;for(const child of part.parts||[])visit(child);}
 visit(copy.payload);return copy;
}
