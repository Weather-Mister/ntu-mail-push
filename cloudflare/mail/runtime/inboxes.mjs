export function mergeInboxes(results) {
 return {messages:results.flatMap(result=>result.messages||[]).sort((a,b)=>b.timestamp-a.timestamp),cursor:Object.fromEntries(results.flatMap(result=>Object.entries(result.cursor||{}))),hasMore:results.some(result=>result.hasMore),errors:results.flatMap(result=>result.errors||[])};
}
export async function allInboxes(req,stub) {
 const url=new URL(req.url);url.searchParams.set('route','accounts');
 const listed=await stub.fetch(new Request(url,{headers:req.headers}));if(!listed.ok)return listed;
 const accounts=(await listed.json()).accounts||[],results=new Array(accounts.length);let index=0;
 // Each mailbox gets its own Durable Object invocation and request budget.
 // This retains the existing combined result while bounding network fanout.
 await Promise.all(Array.from({length:Math.min(2,accounts.length)},async()=>{
  while(index<accounts.length){const current=index++,account=accounts[current],target=new URL(req.url);target.searchParams.set('accountId',account.id);
   const response=await stub.fetch(new Request(target,{headers:req.headers}));
   results[current]=response.ok?await response.json():{messages:[],cursor:{[account.id]:''},hasMore:true,errors:[{accountId:account.id,error:'This mailbox is temporarily unavailable.'}]};
  }
 }));
 return Response.json(mergeInboxes(results),{headers:listed.headers});
}
