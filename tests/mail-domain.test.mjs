import test from 'node:test';
import assert from 'node:assert/strict';
import {loginCode,classify,b64url,decodeBody,bodies,resolveAttachmentPart,unsubscribeInfo,buildMime,validateDraft,validateEffects,validateAttachmentRefs,MAX_ATTACHMENT_BYTES,AI_SYSTEM,safeWebUrl,normalizeAiRevision} from '../supabase/functions/eren-mail/domain.mjs';
const message=(subject,text,extra={})=>({id:'m1',threadId:'t1',internalDate:'1700000000000',labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'Subject',value:subject},{name:'From',value:'Sender <news@food.test>'},...(extra.headers||[])],body:{data:b64url(text)}},...Object.fromEntries(Object.entries(extra).filter(([k])=>k!=='headers'))});

test('attachment validation allows up to 20 MB total and rejects more',()=>{
 assert.equal(MAX_ATTACHMENT_BYTES,20*1024*1024);
 const id='11111111-1111-4111-8111-111111111111';
 assert.equal(validateAttachmentRefs([{id,name:'large.pdf',type:'application/pdf',size:20*1024*1024}])[0].size,20*1024*1024);
 assert.throws(()=>validateAttachmentRefs([{id,name:'too-large.pdf',type:'application/pdf',size:20*1024*1024+1}]),/Invalid attachment|too large/);
});
test('verification codes require authentication context and explicit token placement',()=>{
 assert.equal(loginCode('Your verification code','Your verification code is 483921'), '483921');
 assert.equal(loginCode('Sign-in verification','AB12CD is your verification code'), 'AB12CD');
 assert.equal(loginCode('驗證碼','您的驗證碼：582193'), '582193');
 assert.equal(loginCode('Verification','Your verification code is 8642'),'8642');
 assert.equal(loginCode('Order receipt','Order 482991 has shipped'),null);
 assert.equal(loginCode('Login notification','You logged in during 2026. Call 123456.'),null);
 assert.equal(loginCode('Your verification code','Your verification code is required'),null);
});
test('receipts stay Normal despite List-Unsubscribe; typed promotion rules do not block receipts',()=>{
 const h=[{name:'List-Unsubscribe',value:'<https://food.test/unsubscribe>'},{name:'List-ID',value:'promos.food.test'}];
 const rule={id:'r',scope:'domain',match_value:'food.test',type_match:'Promotion',effects:{priority:'Muted',blocked:true}};
 const receipt=classify(message('Your order has shipped','Receipt for your order',{headers:h}),[rule]);
 assert.equal(receipt.type,'Receipt / Order');assert.equal(receipt.priority,'Normal');assert.equal(receipt.blocked,false);
 const promo=classify(message('40% off','promo code TODAY',{headers:h}),[rule]);assert.equal(promo.priority,'Muted');assert.equal(promo.blocked,true);
});
test('manual rules override inference; specific context and action remain independent',()=>{
 const rules=[{id:'r1',scope:'domain',match_value:'food.test',effects:{priority:'Low'}},{id:'r2',scope:'sender',match_value:'news@food.test',effects:{priority:'High',context:'Engineering Mathematics'}},{id:'r3',scope:'thread',match_value:'t1',effects:{action:'Waiting',type:'University'}}];
 const r=classify(message('Verification code','Your verification code is 398421'),rules);
 assert.equal(r.type,'University');assert.equal(r.priority,'High');assert.equal(r.context,'Engineering Mathematics');assert.equal(r.action,'Waiting');assert.equal(r.code,'398421');
});
test('uncertain mail is visible Other with Needs classification',()=>{const r=classify(message('Hello','Something new.'));assert.equal(r.type,'Other');assert.equal(r.needsClassification,true);assert.equal(r.blocked,false);});
test('unsubscribe understands HTTPS, one-click and mailto without inventing availability',()=>{
 const r=unsubscribeInfo(message('Test','',{headers:[{name:'List-Unsubscribe',value:'<https://mail.example.org/unsub?id=1>, <mailto:leave@list.example.org?subject=Unsubscribe&body=Remove%20me>'},{name:'List-Unsubscribe-Post',value:'List-Unsubscribe=One-Click'}]}));
 assert.equal(r.oneClick,true);assert.equal(r.mailto.body,'Remove me');assert.equal(r.web,'https://mail.example.org/unsub?id=1');
 assert.equal(unsubscribeInfo(message('Test','Unsubscribe here!')).web,null);
 for(const url of ['javascript:alert(1)','http://safe.com','https://127.0.0.1/','https://[::1]/','https://user:pass@safe.com/','https://safe.com:444/','https://host.internal/'])assert.equal(safeWebUrl(url),null);
});
test('UTF-8 MIME and replies contain threading headers and complete edited body',()=>{
 const raw=decodeBody(buildMime({to:'friend@example.org',subject:'ignored subject',body:'您好\nI can meet after 4.'},'me@example.org','request@eren-mail.invalid',{subject:'Question about Thursday',messageId:'<original@example.org>',references:'<first@example.org>'}));
 assert.match(raw,/In-Reply-To: <original@example.org>/);assert.match(raw,/References: <first@example.org>\r\n <original@example.org>/);assert.match(raw,/Message-ID: <request@eren-mail.invalid>/);
 const body=raw.split('\r\n\r\n')[1];assert.equal(decodeBody(body),'您好\r\nI can meet after 4.');assert.match(raw,/Subject: =\?UTF-8\?B\?/);
});
test('reject mail header injection and malformed rule effects',()=>{
 for(const draft of [{to:'x@y.com\r\nBcc: evil@example.org',subject:'Hi',body:'hi'},{to:'x@y.com',subject:'Hi\nBcc: x@y.com',body:'hi'},{to:'invalid',subject:'Hi',body:'hi'}])assert.throws(()=>validateDraft(draft));
 assert.throws(()=>validateEffects({blocked:'true'}));assert.throws(()=>validateEffects({priority:'Urgent'}));assert.throws(()=>validateEffects({account_id:'steal'}));
});
test('multipart traversal extracts text and attachments without conflating HTML',()=>{
 const r=bodies({parts:[{mimeType:'multipart/alternative',parts:[{mimeType:'text/plain',body:{data:b64url('Hello 世界')}},{mimeType:'text/html',body:{data:b64url('<b>Hello 世界</b>')}}]},{partId:'2',filename:'receipt.pdf',mimeType:'application/pdf',body:{attachmentId:'att',size:42}}]});
 assert.equal(r.text.trim(),'Hello 世界');assert.equal(r.html,'<b>Hello 世界</b>');assert.equal(r.attachments[0].filename,'receipt.pdf');
});
test('received attachment lookup survives Gmail rotating the opaque attachment ID',()=>{
 const payload={parts:[{partId:'1',filename:'lecture.pdf',mimeType:'application/pdf',body:{attachmentId:'fresh-gmail-id',size:2048}}]};
 const part=resolveAttachmentPart(payload,'stale-gmail-id','1');
 assert.equal(part.id,'fresh-gmail-id');assert.equal(part.partId,'1');assert.equal(part.filename,'lecture.pdf');
});

test('AI policy treats thread as untrusted context and preserves rich draft output',()=>{assert.match(AI_SYSTEM,/current draft is authoritative/i);assert.match(AI_SYSTEM,/never invent/i);assert.match(AI_SYSTEM,/untrusted/i);assert.match(AI_SYSTEM,/bodyHtml/);assert.match(AI_SYSTEM,/Return ONLY JSON/i);});


test('rich HTML and attachments produce multipart MIME with a plain-text fallback',()=>{
 const data=btoa('hello attachment');
 const raw=decodeBody(buildMime({
  to:'friend@example.org',
  subject:'Formatted',
  body:'Hello world',
  bodyHtml:'<p>Hello <strong>world</strong> <script>bad()</script></p>',
  attachments:[{id:'11111111-1111-4111-8111-111111111111',name:'notes ü.txt',type:'text/plain',size:16,data}]
 },'me@example.org','request@eren-mail.invalid'));
 assert.match(raw,/Content-Type: multipart\/mixed/);
 assert.match(raw,/Content-Type: multipart\/alternative/);
 assert.match(raw,/Content-Type: text\/html; charset=UTF-8/);
 assert.match(raw,/Content-Disposition: attachment/);
 assert.match(raw,/filename\*=UTF-8''notes%20%C3%BC\.txt/);
 assert(!raw.includes('<script>'));
 const encodedHtml=raw.match(/Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/)?.[1]||'';
 assert(decodeBody(encodedHtml).includes('<strong>world</strong>'));
});

test('rich draft validation rejects unsafe HTML and oversized attachment references',()=>{
 const draft=validateDraft({to:'friend@example.org',subject:'Hi',body:'Hello',bodyHtml:'<p onclick="x()">Hi <strong>there</strong><script>x()</script></p>',attachments:[]});
 assert.equal(draft.bodyHtml,'<p>Hi <strong>there</strong></p>');
 assert.throws(()=>validateDraft({to:'friend@example.org',subject:'Hi',body:'Hello',attachments:[{id:'11111111-1111-4111-8111-111111111111',name:'huge.bin',type:'application/octet-stream',size:9*1024*1024}]}));
});


test('Gemini normalization repairs HTML accidentally returned in body and preserves structure',()=>{
 const r=normalizeAiRevision({
  body:'<div style="font-family:Arial"><h2 style="color:red">Project Update</h2><p>Please see the key highlights below:</p><ul style="list-style:square"><li><strong>Phase 1:</strong> Completed.</li><li><em>Phase 2:</em> Testing.</li></ul><blockquote style="color:#444"><strong>Note:</strong> Upload docs.</blockquote><p>Questions? <a href="mailto:example@email.com" style="color:blue">Reach out</a>.</p>',
  bodyHtml:''
 });
 assert.equal(r.bodyHtml,'<div><h2>Project Update</h2><p>Please see the key highlights below:</p><ul><li><strong>Phase 1:</strong> Completed.</li><li><em>Phase 2:</em> Testing.</li></ul><blockquote><strong>Note:</strong> Upload docs.</blockquote><p>Questions? <a href="mailto:example@email.com">Reach out</a>.</p></div>');
 assert.match(r.body,/Project Update\n\nPlease see the key highlights below:/);
 assert.match(r.body,/Phase 1: Completed\.\nPhase 2: Testing\./);
 assert.match(r.body,/Note: Upload docs\./);
 assert(!r.body.includes('<h2'));
});

test('Gemini normalization keeps plain-text line and blank-line breaks',()=>{
 const r=normalizeAiRevision({body:'First line\r\nSecond line\r\n\r\nNew paragraph.',bodyHtml:''});
 assert.equal(r.body,'First line\nSecond line\n\nNew paragraph.');
 assert.equal(r.bodyHtml,'');
});

test('Gemini normalization derives matching plain text from formatted HTML',()=>{
 const r=normalizeAiRevision({body:'wrong fallback',bodyHtml:'<p>Hello <strong>there</strong>.</p><p><br></p><p>Next paragraph.</p>'});
 assert.equal(r.bodyHtml,'<p>Hello <strong>there</strong>.</p><p><br /></p><p>Next paragraph.</p>');
 assert.match(r.body,/Hello there\.\n\nNext paragraph\./);
 assert(!r.body.includes('wrong fallback'));
});
