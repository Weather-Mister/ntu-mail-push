// Synthetic input only. Run in a separate process so peak memory is attributable.
import { buildMime } from '../../supabase/functions/eren-mail/domain.mjs';
import { encodeAttachmentData } from '../../supabase/functions/eren-mail/attachments.ts';
const size = Number(process.argv[2] || 9086982);
const started = performance.now();
const bytes = new Uint8Array(size);
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
const raw = buildMime({to:'test@example.org',subject:'Synthetic attachment',body:'Memory regression test',attachments:[{
  id:'11111111-1111-4111-8111-111111111111',name:'synthetic.bin',type:'application/octet-stream',size,data:encodeAttachmentData(bytes),
}]},'sender@example.org','synthetic@eren-mail.invalid');
// Optional diagnostic includes JSON serialization overhead; the regression budget
// is specifically for MIME encoding, not the complete hosted request.
const requestBody=process.argv.includes('--json')?JSON.stringify({raw}):null;
console.log(JSON.stringify({size,encodedBytes:raw.length,jsonBytes:requestBody?.length,milliseconds:Math.round(performance.now()-started),peakRssBytes:process.resourceUsage().maxRSS*1024}));
