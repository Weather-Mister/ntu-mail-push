import { safeWebUrl } from './domain.mjs';
import { MailError } from './services.ts';
export function publicIPv4(ip:string) {
 const p=ip.split('.').map(Number);
 if(p.length!==4||p.some(x=>!Number.isInteger(x)||x<0||x>255)) return false;
 const [a,b,c]=p;
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export async function oneClickUnsubscribe(value:string) {
 const safe=safeWebUrl(value);if(!safe) throw new MailError(400,'Unsafe unsubscribe URL.');
 const url=new URL(safe);
 // Pin a public IP before connecting, then validate TLS against the original hostname.
 // No second DNS resolution (rebinding), redirects, cookies, OAuth headers or remote GETs.
 const ips=await Deno.resolveDns(url.hostname,'A');
 if(!ips.length||ips.some(ip=>!publicIPv4(ip))) throw new MailError(400,'This unsubscribe host cannot be contacted safely.');
 let conn:Deno.Conn|null=null,expired=false;
 const timer=setTimeout(()=>{expired=true;try{conn?.close();}catch{}},8000);
 try {
  conn=await Deno.connect({hostname:ips[0],port:443});
  if(expired) throw new Error('timeout');
  conn=await Deno.startTls(conn as Deno.TcpConn,{hostname:url.hostname,alpnProtocols:['http/1.1']});
  if(expired) throw new Error('timeout');
  const body='List-Unsubscribe=One-Click';
  const bytes=new TextEncoder().encode(`POST ${url.pathname+url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
  let sent=0;while(sent<bytes.length) sent+=await conn.write(bytes.subarray(sent));
  const buf=new Uint8Array(1024);let first='';
  while(first.length<8192&&!first.includes('\r\n')) {const n=await conn.read(buf);if(n===null)break;first+=new TextDecoder().decode(buf.subarray(0,n));}
  const status=Number(first.match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);
  if(status<200||status>=300||!status) throw new MailError(502,'Sender did not confirm unsubscribe. No block or mute rule was added. Use its web unsubscribe page.');
  return {status:'requested'};
 } catch(e) {if(e instanceof MailError) throw e;throw new MailError(502,'Unsubscribe could not be confirmed. Use the sender’s web unsubscribe page.');}
 finally {clearTimeout(timer);try{conn?.close();}catch{}}
}
