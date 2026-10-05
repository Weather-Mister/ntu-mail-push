// Per-isolate memory only. Never browser storage, database token caches or logs.
// Ownership is still checked on every API request before these caches are used.
export class ShortCache {
 private entries=new Map<string,{value:any;until:number;bytes:number}>();
 constructor(private ttl=30000,private maxEntries=48,private maxBytes=12*1024*1024){}
 get(key:string) {
  const entry=this.entries.get(key);
  if(!entry||entry.until<=Date.now()){this.entries.delete(key);return undefined;}
  return structuredClone(entry.value);
 }
 set(key:string,value:any) {
  const bytes=JSON.stringify(value).length*2;
  if(bytes>this.maxBytes/2)return;
  this.entries.delete(key);
  this.entries.set(key,{value:structuredClone(value),until:Date.now()+this.ttl,bytes});
  let total=[...this.entries.values()].reduce((sum,e)=>sum+e.bytes,0);
  while(this.entries.size>this.maxEntries||total>this.maxBytes){const key=this.entries.keys().next().value!,entry=this.entries.get(key)!;total-=entry.bytes;this.entries.delete(key);}
 }
 deletePrefix(prefix:string){for(const key of this.entries.keys())if(key.startsWith(prefix))this.entries.delete(key);}
}
export const threadCache=new ShortCache();
export function defer(work:Promise<any>) {
 const pending=work.catch(()=>{}); // Only reconstructible metadata, never sends/rules.
 (globalThis as any).EdgeRuntime?.waitUntil(pending);
 return pending;
}
