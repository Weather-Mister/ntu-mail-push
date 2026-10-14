import { connect as rawConnect } from 'cloudflare:sockets';
import { connect as tlsConnect } from 'node:tls';
const encoder=new TextEncoder();
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
async function address(host){const url=new URL('https://cloudflare-dns.com/dns-query');url.searchParams.set('name',host);url.searchParams.set('type','A');const response=await fetch(url,{headers:{Accept:'application/dns-json'},redirect:'manual',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('DNS status '+response.status);const data=await response.json();const ip=data.Answer?.find(item=>item.type===1)?.data;if(!ip)throw new Error('DNS answer absent');return ip;}
async function rawProbe(host,ip){
 let socket;const timer=setTimeout(()=>socket?.close().catch(()=>{}),8000);
 try{socket=rawConnect({hostname:ip,port:443},{secureTransport:'starttls'});socket.closed.catch(()=>{});await socket.opened;socket=socket.startTls({expectedServerHostname:host});socket.closed.catch(()=>{});await socket.opened;const writer=socket.writable.getWriter();await writer.write(encoder.encode(`HEAD /zen HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Eren-migration-check\r\nConnection: close\r\n\r\n`));writer.releaseLock();const reader=socket.readable.getReader(),result=await reader.read();reader.releaseLock();return {passed:!result.done&&/^HTTP\/1\.[01] \d{3}/.test(new TextDecoder().decode(result.value))};}catch{return {passed:false}}finally{clearTimeout(timer);await socket?.close().catch(()=>{});}
}
async function hostnameProbe(host,ip){
 let socket;const timer=setTimeout(()=>socket?.close().catch(()=>{}),8000);
 try{socket=rawConnect({hostname:host,port:443},{secureTransport:'starttls'});socket.closed.catch(()=>{});const info=await socket.opened,remote=info.remoteAddress;const peerMatches=remote===ip||remote===ip+':443';socket=socket.startTls();socket.closed.catch(()=>{});await socket.opened;const writer=socket.writable.getWriter();await writer.write(encoder.encode(`HEAD /zen HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Eren-migration-check\r\nConnection: close\r\n\r\n`));writer.releaseLock();const reader=socket.readable.getReader(),result=await reader.read();reader.releaseLock();return {passed:!result.done&&/^HTTP\/1\.[01] \d{3}/.test(new TextDecoder().decode(result.value)),remoteAvailable:!!remote,peerMatches,publicProbeRemote:remote,publicProbeExpected:ip};}catch{return {passed:false}}finally{clearTimeout(timer);await socket?.close().catch(()=>{});}
}
async function nodeProbe(host,ip,servername=host){
 return new Promise(done=>{
  let socket,finished=false;const complete=value=>{if(finished)return;finished=true;clearTimeout(timer);socket?.destroy();done(value);};
  const timer=setTimeout(()=>complete({passed:false}),8000);
  try{socket=tlsConnect({host:ip,port:443,servername,rejectUnauthorized:true},()=>{if(!socket.authorized)return complete({passed:false});socket.write(`HEAD /zen HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Eren-migration-check\r\nConnection: close\r\n\r\n`);});socket.once('data',bytes=>complete({passed:/^HTTP\/1\.[01] \d{3}/.test(bytes.toString())}));socket.once('error',()=>complete({passed:false}));socket.once('end',()=>complete({passed:false}));}catch{complete({passed:false});}
 });
}
export default {async fetch(req,env){
 const key=req.headers.get('x-mail-stage-key')||'';if(key.length!==64||await hash(key)!==env.NETWORK_STAGE_KEY_HASH)return new Response(null,{status:401});
 try{const host='api.github.com',ip=await address(host);return Response.json({hostname:await hostnameProbe(host,ip),rawPinned:await rawProbe(host,ip),nodePinned:await nodeProbe(host,ip),nodeWrongHostname:await nodeProbe(host,ip,'wrong.example.invalid'),publicReadOnlyProbe:true,unsubscribeActions:0});}catch(error){return Response.json({error:'Network probe could not complete safely.',diagnostic:String(error?.message||'Unknown').slice(0,160)},{status:503});}
}};
