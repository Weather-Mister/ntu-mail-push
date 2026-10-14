import { connect } from 'cloudflare:sockets';
import { safeWebUrl } from './domain.mjs';
import { MailError } from './services.ts';
// Retain the original public-address policy. The real-edge SNI behavior must
// pass validation; never fall back to DNS rebinding or skip TLS verification.
export function publicIPv4(ip:string) {
 const p=ip.split('.').map(Number);if(p.length!==4||p.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
 const [a,b,c]=p;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export async function oneClickUnsubscribe(value:string) {
 const safe=safeWebUrl(value);if(!safe)throw new MailError(400,'Unsafe unsubscribe URL.');
 const url=new URL(safe),dns=new URL('https://cloudflare-dns.com/dns-query');dns.searchParams.set('name',url.hostname);dns.searchParams.set('type','A');
 const response=await fetch(dns,{headers:{Accept:'application/dns-json'},redirect:'manual',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new MailError(502,'Unsubscribe host could not be checked safely.');
 const resolved=await response.json() as any,ips=(resolved.Answer||[]).filter((row:any)=>row.type===1).map((row:any)=>row.data);
 if(!ips.length||ips.some((ip:string)=>!publicIPv4(ip)))throw new MailError(400,'This unsubscribe host cannot be contacted safely.');
 let socket:any,expired=false;
 const timer=setTimeout(()=>{expired=true;socket?.close().catch(()=>{});},8000);
 try {
  socket=connect({hostname:ips[0],port:443},{secureTransport:'starttls'});
  socket.closed.catch(()=>{});await socket.opened;if(expired)throw new Error('timeout');
  socket=socket.startTls({expectedServerHostname:url.hostname});socket.closed.catch(()=>{});await socket.opened;
  const body='List-Unsubscribe=One-Click',writer=socket.writable.getWriter();
  await writer.write(new TextEncoder().encode(`POST ${url.pathname+url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`));writer.releaseLock();
  const reader=socket.readable.getReader();let first='';
  while(first.length<8192&&!first.includes('\r\n')){const next=await reader.read();if(next.done)break;first+=new TextDecoder().decode(next.value)}reader.releaseLock();
  const status=Number(first.match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);if(status<200||status>=300||!status)throw new Error('not confirmed');
  return {status:'requested'};
 }catch{throw new MailError(502,'Unsubscribe could not be confirmed. Use the sender’s web unsubscribe page.');}
 finally{clearTimeout(timer);await socket?.close().catch(()=>{});}
}
