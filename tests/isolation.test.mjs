import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const read=p=>fs.readFileSync(p,'utf8');
test('mail files and secrets stay outside the Pages artifact',()=>{
 const paths=execFileSync('git',['ls-files','sites/eren'],{encoding:'utf8'}).trim().split('\n');
 for(const p of paths.filter(p=>/\.(js|html|css)$/.test(p))){const source=read(p);assert(!/AIza[\w-]{30,}|GOCSPX-[\w-]+|-----BEGIN .*PRIVATE KEY-----/.test(source),p+' leaked a credential');assert(!/SUPABASE_SERVICE_ROLE_KEY|refresh_token\s*[:=]|client_secret\s*[:=]/.test(source),p+' contains server credentials');}
 const html=read('sites/eren/index.html'),sw=read('sites/eren/sw.js');assert(html.includes('href="https://wmail1.cc.ntu.edu.tw/rc/index.php"'));assert(sw.includes("ROOT + 'begum/'"));assert(sw.includes("data:{ url:NTU_MAIL_URL }"));assert(sw.includes('ntu-schedule-github-v9'));
 for(const asset of ['mail-demo.js?v=6','mail-demo.css?v=4']){assert(html.includes(asset));assert(sw.includes(asset));}
});
test('mail implementation cannot mutate Gmail Spam or permanently delete mail',()=>{
 const code=read('supabase/functions/eren-mail/index.ts')+read('supabase/functions/eren-mail/jobs.ts');assert(!/addLabelIds:\s*\[\s*['"]SPAM/.test(code));assert(!/messages\/.*['"]DELETE['"]|threads\/.*['"]DELETE['"]/.test(code));assert(!read('sites/eren/mail-demo.js').includes('mockGenerate'));
});
test('new mail SQL is service-only and keeps definer routines private',()=>{
 const sql=read('supabase/migrations/20261004123823_eren_mail.sql');assert(sql.includes('enable row level security'));assert(sql.includes('from public,anon,authenticated'));assert(sql.includes('eren_mail_private.secret'));assert(sql.includes('security invoker'));assert(!/create (?:or replace )?function public\.[\s\S]{0,250}?security definer/i.test(sql));
});
