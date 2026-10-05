import {test,expect} from '@playwright/test';
const accounts=[{id:'a1',email:'first@example.org',display_name:'Personal',status:'active'},{id:'a2',email:'second@example.org',display_name:'University',status:'active'}];
const classification={type:'University',context:'Engineering Mathematics',priority:'High',action:'Needs reply',code:null,blocked:false};
const msg={id:'m1',threadId:'t1',accountId:'a1',sender:'Professor',from:'Professor <prof@example.org>',email:'prof@example.org',replyTo:'prof@example.org',to:'first@example.org',cc:'',subject:'Thursday meeting',timestamp:Date.now(),labels:['INBOX','UNREAD'],snippet:'Can you meet Thursday?',classification,unsubscribe:{web:null,mailto:null,listId:'',oneClick:false},text:'Can you meet Thursday?\nFull message content.',html:'',attachments:[],count:1};
const composeButton=page=>page.locator('#mailxComposeMobile:visible, #mailxComposeMain:visible').first();
async function boot(page,options={}){
 const calls=[],errors=[];page.on('pageerror',e=>{if(!e.message.includes("Failed to read the 'serviceWorker' property from 'Navigator'")||!e.message.includes('sandboxed'))errors.push(e.message);});
 await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('ntu-schedule-pairing-key-v1','test-key-'.repeat(6));});
 await page.route('https://**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),r=url.searchParams.get('route');let body={};try{body=req.postDataJSON()||{};}catch{}calls.push({route:r,body,url});
  let data={};const first=options.oldTimestamp?{...msg,timestamp:options.oldTimestamp}:msg;
  if(url.pathname.includes('/eren-mail')){
   if(r==='status')data={configured:true,aiConfigured:true,types:['University','Promotion','Receipt / Order','Other'],priorities:['High','Normal','Low','Muted'],actions:['Needs reply','Deadline','Waiting','FYI','No action'],health:{last_finished_at:new Date().toISOString()},redirectUri:'https://api.example.org/callback'};
   if(r==='bootstrap')data={accounts,preferences:{},messages:[first,{...msg,id:'m2',threadId:'t2',accountId:'a2',sender:'Bank',subject:'Your receipt',classification:{...classification,type:'Receipt / Order',priority:'Normal',action:'FYI'}}]};if(r==='accounts')data={accounts};if(r==='preferences')data={preferences:{}};if(r==='rules')data={rules:[]};if(r==='outbox')data={jobs:[]};if(r==='drafts')data={drafts:[]};
   if(r==='mail'){if(options.mailDelay)await new Promise(r=>setTimeout(r,options.mailDelay));let messages=[first,{...msg,id:'m2',threadId:'t2',accountId:'a2',sender:'Bank',subject:'Your receipt',classification:{...classification,type:'Receipt / Order',priority:'Normal',action:'FYI'}}];if(url.searchParams.get('accountId')!=='all')messages=messages.filter(m=>m.accountId===url.searchParams.get('accountId'));data=options.mailFail?{messages:[],cursor:{a1:'',a2:''},hasMore:false,errors:accounts.map(a=>({accountId:a.id,error:'Gmail temporarily unavailable'}))}:options.partialFail?{messages:messages.filter(m=>m.accountId==='a2'),cursor:{a1:null,a2:null},hasMore:false,errors:[{accountId:'a1',threadIds:['t1'],error:'One thread temporarily unavailable'}]}:{messages,cursor:{a1:null,a2:null},hasMore:false,errors:[]};}
   if(r==='thread'){if(options.threadDelay)await new Promise(r=>setTimeout(r,options.threadDelay));const images=true;data={threadId:url.searchParams.get('threadId'),accountId:url.searchParams.get('accountId'),messages:[{...first,threadId:url.searchParams.get('threadId'),...(options.html?{html:images?options.imagesHtml:options.html,hasExternalImages:!images,externalImages:images}: {})}]};}
   if(r==='ai'){
    if(options.aiDelay)await new Promise(r=>setTimeout(r,options.aiDelay));
    if(options.aiFail)return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Gemini quota exhausted. Your draft has been preserved.'})});
    const revised=options.aiBody!==undefined?options.aiBody:(body.body?'Warm: '+body.body:'I can meet after 3.');
    data={body:revised,...(options.richAiHtml!==undefined?{bodyHtml:options.richAiHtml}:{})};
   }
   if(r==='drafts/attachment'){
    options._attachmentAttempts=(options._attachmentAttempts||0)+1;
    if(options.attachmentFailOnce&&options._attachmentAttempts===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Attachment upload failed'})});
    data={attachment:{id:body.id,name:body.name,type:body.type,size:body.size}};
   }
   if(r==='drafts/attachment/delete')data={ok:true};
   if(r==='modify'&&options.modifyFail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Gmail unavailable'})});if(r==='send'){if(options.sendDelay)await new Promise(r=>setTimeout(r,options.sendDelay));data={job:{id:body.id,status:body.sendAt?'pending':'sent'}};}
  }else if(url.pathname.includes('ntu-schedule-api')){
   if(r==='todos/list')data={tasks:[{id:'task1',text:'Existing manual task',done:false}]};
   if(r==='transfer/list')data={items:[{id:'x1',kind:'text',content:'Existing transfer',createdAt:new Date().toISOString()}]};
   if(r==='cool-calendar')data={events:[{id:'cool1',title:'Existing COOL assignment',course:'Engineering Mathematics',dueAt:new Date(Date.now()+86400000).toISOString(),date:new Date().toISOString().slice(0,10),url:'https://cool.ntu.edu.tw/courses/1/assignments/2'}]};
   if(r==='hanzi-widget')data={streak:7,practiceToday:3,practiceGoal:10,username:'eren',nextCharacter:'學'};
   if(r==='status')data={ok:true,app:'eren'};
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/');await page.locator('#mailDashboardButton').click();await expect(page.locator('#mailxList .mailx-message')).toHaveCount(2);return {calls,errors};
}
test('dashboard remains intact; live account selector combines and filters inbox',async({page},info)=>{
 const {calls,errors}=await boot(page);await expect(page.locator('.topbar-actions > #mailDashboardButton')).toHaveCount(1);await expect(page.locator('#ntuHubSection #mailDashboardButton')).toHaveCount(0);await expect(page.locator('#mailxConnection')).toBeHidden();const listSelector=page.locator('.mailx-account-select-list'),navSelector=page.locator('.mailx-nav [data-mailx-account-filter]'),selector=info.project.name==='iphone'?listSelector:navSelector;await expect(selector.locator('option')).toHaveCount(3);if(info.project.name==='iphone'){await expect(listSelector).toBeVisible();}else{await expect(listSelector).toBeHidden();await expect(navSelector).toBeVisible();}await selector.selectOption('a2');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(1);await expect(page.locator('#mailxList')).toContainText('Your receipt');await selector.selectOption('all');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(2);
 await page.locator('#mailxClose').click();await page.locator('[data-day="1"]').click();await expect(page.locator('#scheduleList')).toContainText('Engineering Mathematics');
 await expect(page.locator('#todoList')).toContainText('Existing manual task');await expect(page.locator('#transferList')).toContainText('Existing transfer');await expect(page.locator('#coolDeadlines')).toContainText('Existing COOL assignment');await expect(page.locator('a[aria-label="Open NTU Mail"]')).toHaveAttribute('href','https://wmail1.cc.ntu.edu.tw/rc/index.php');expect(calls.some(c=>c.route==='hanzi-widget')).toBeTruthy();expect(errors).toEqual([]);
});
test('full reader, mobile back, normal reply and safe controls',async({page},info)=>{
 await boot(page);await page.locator('#mailxList .mailx-message').first().click();await expect(page.locator('.mailx-mail-body')).toContainText('Full message content.');await expect(page.getByRole('button',{name:'Reply with AI',exact:true})).toHaveCount(0);await expect(page.locator('[data-action="unsubscribe"]')).toHaveCount(0);
 if(info.project.name==='iphone'){await expect(page.locator('.mailx-list-pane')).toBeHidden();await page.locator('[data-action="back"]').click();await expect(page.locator('.mailx-list-pane')).toBeVisible();await page.locator('#mailxList .mailx-message').first().click();}
 await page.locator('[data-action="reply"]').click();await expect(page.locator('#mailxTo')).toHaveValue('prof@example.org');await expect(page.locator('#mailxFrom')).toHaveValue('a1');await expect(page.locator('#mailxFrom')).toBeDisabled();
 const prompt=await page.locator('#mailxAiPrompt').boundingBox(),body=await page.locator('#mailxBody').boundingBox();expect(prompt.y).toBeLessThan(body.y);
 await page.screenshot({path:`test-results/${info.project.name}-composer.png`});
});
test('AI revisions use current manual edits; Undo and Redo preserve text',async({page})=>{
 const {calls}=await boot(page);await composeButton(page).click();await page.locator('#mailxAiPrompt').fill('Meet after 3');await page.locator('#mailxGenerate').click();await expect(page.locator('#mailxBody')).toHaveText('I can meet after 3.');await page.locator('#mailxBody').fill('I can meet after 4.');await page.locator('#mailxAiPrompt').fill('Make warmer');await page.locator('#mailxGenerate').click();await expect(page.locator('#mailxBody')).toHaveText('Warm: I can meet after 4.');expect(calls.filter(c=>c.route==='ai').at(-1).body.body).toBe('I can meet after 4.');await page.locator('#mailxUndo').click();await expect(page.locator('#mailxBody')).toHaveText('I can meet after 4.');await page.locator('#mailxRedo').click();await expect(page.locator('#mailxBody')).toHaveText('Warm: I can meet after 4.');
});
test('AI failure keeps the draft; edits during generation win',async({page})=>{
 await boot(page,{aiFail:true});await composeButton(page).click();await page.locator('#mailxBody').fill('My current draft.');await page.locator('#mailxAiPrompt').fill('Revise');await page.locator('#mailxGenerate').click();await expect(page.locator('#mailxComposeError')).toContainText('quota');await expect(page.locator('#mailxBody')).toHaveText('My current draft.');
});
test('late AI response cannot overwrite typing or a different composer',async({page})=>{
 await boot(page,{aiDelay:500});await composeButton(page).click();await page.locator('#mailxBody').fill('Original');await page.locator('#mailxAiPrompt').fill('Warm');await page.locator('#mailxGenerate').click();await page.locator('#mailxBody').fill('New manual edit');await expect(page.locator('#mailxToast')).toContainText('You edited this draft');await expect(page.locator('#mailxBody')).toHaveText('New manual edit');
});
test('archive uses API; local block scope stays distinct from Spam',async({page})=>{
 const {calls}=await boot(page);await page.locator('#mailxList .mailx-message').first().click();await page.locator('[data-action="block"]').click();await page.locator('#ruleScope').selectOption('sender');await page.locator('#ruleSave').click();await expect(page.locator('#mailxSheet')).toHaveCount(0);const rule=calls.find(c=>c.route==='rules'&&c.body.effects);expect(rule.body.effects).toEqual({blocked:true});expect(rule.body.scope).toBe('sender');expect(JSON.stringify(calls)).not.toContain('SPAM');await page.locator('[data-action="archive"]').click();await expect.poll(()=>calls.some(c=>c.route==='modify'&&c.body.action==='archive')).toBeTruthy();
});
test('duplicate Send is disabled and scheduled sending is a server request',async({page})=>{
 const {calls}=await boot(page,{sendDelay:500});await composeButton(page).click();await page.locator('#mailxTo').fill('friend@example.org');await page.locator('#mailxSubject').fill('Hello');await page.locator('#mailxBody').fill('Daily driver test');await page.locator('#mailxSend').click();await expect(page.locator('#mailxSend')).toBeDisabled();await expect(page.locator('#mailxCompose')).toBeHidden();expect(calls.filter(c=>c.route==='send')).toHaveLength(1);await expect.poll(()=>page.locator('#mailxSend').isDisabled()).toBe(false);
 await composeButton(page).click();await page.locator('#mailxTo').fill('friend@example.org');await page.locator('#mailxBody').fill('Scheduled');await page.locator('#mailxSchedule').click();await page.locator('#mailxSendAt').fill('2027-01-10T15:30');await page.locator('#mailxConfirmSchedule').click();await expect(page.locator('#mailxCompose')).toBeHidden();expect(calls.filter(c=>c.route==='send').at(-1).body.sendAt).toBeTruthy();
});

test('styled newsletter images load by default without a notice',async({page})=>{
 const head=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{margin:0}table{max-width:100%}h1{font-size:32px;font-family:Arial,sans-serif}</style>`;
 const html=`${head}<table bgcolor="#ccddff" width="600"><tr><td style="text-align:center;padding:24px"><h1>Less searching. More saving.</h1><span data-external-image="blocked">[Honey illustration]</span><a href="https://example.org" style="background:#4066ff;color:#fff;border-radius:20px;padding:10px 20px">Start shopping</a></td></tr></table>`;
 const imagesHtml=html.replace('data:;', 'data: https:;').replace('<span data-external-image="blocked">[Honey illustration]</span>','<img src="https://images.example.org/banner.png" alt="Honey illustration">');
 const {calls,errors}=await boot(page,{html,imagesHtml});await page.locator('#mailxList .mailx-message').first().click();
 const frame=page.frameLocator('.mailx-html-body');await expect(frame.locator('h1')).toHaveCSS('font-size','32px');await expect(frame.locator('td')).toHaveCSS('text-align','center');await expect(frame.locator('a')).toHaveCSS('background-color','rgb(64, 102, 255)');
 await expect(page.locator('.mailx-image-notice')).toHaveCount(0);await expect(page.getByRole('button',{name:'Show external images',exact:true})).toHaveCount(0);await expect(frame.locator('img')).toHaveAttribute('src','https://images.example.org/banner.png');
 expect(calls.filter(c=>c.route==='thread').some(c=>c.url.searchParams.has('externalMessageId'))).toBe(false);await expect(page.locator('.mailx-html-body')).toHaveAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');expect(errors).toEqual([]);
});

test('cached readers and views avoid repeated waits; first view appears before slow Gmail refresh',async({page},info)=>{
 const {calls}=await boot(page,{mailDelay:1500,threadDelay:500});
 await expect(page.locator('#mailxList')).toContainText('Thursday meeting');await page.locator('#mailxList .mailx-message').first().click();await expect(page.locator('.mailx-mail-body')).toContainText('Full message content.');
 if(info.project.name==='iphone')await page.locator('[data-action="back"]').click();else await page.locator('[data-mailx-filter="inbox"]').click();const requests=calls.filter(c=>c.route==='thread').length;const start=Date.now();await page.locator('#mailxList .mailx-message').first().click();await expect(page.locator('.mailx-mail-body')).toContainText('Full message content.',{timeout:500});expect(Date.now()-start).toBeLessThan(700);expect(calls.filter(c=>c.route==='thread')).toHaveLength(requests);
 if(info.project.name==='iphone')await page.locator('[data-action="back"]').click();else await page.locator('[data-mailx-filter="inbox"]').click();await expect.poll(()=>page.locator('#mailxNotice').textContent()).toBe('');
 const selector=info.project.name==='iphone'?page.locator('.mailx-account-select-list'):page.locator('.mailx-nav [data-mailx-account-filter]');await selector.selectOption('a2');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(1);await expect.poll(()=>page.locator('#mailxNotice').textContent()).toBe('');const lists=calls.filter(c=>c.route==='mail').length;await selector.selectOption('all');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(2,{timeout:500});expect(calls.filter(c=>c.route==='mail')).toHaveLength(lists);
});
test('archive gives immediate list feedback and restores the message when Gmail fails',async({page})=>{
 await boot(page,{modifyFail:true});await page.locator('#mailxList .mailx-message').first().click();await page.locator('[data-action="archive"]').click();await expect(page.locator('#mailxToast')).toContainText('Change failed');await expect(page.locator('#mailxList')).toContainText('Thursday meeting');
});

test('failed refresh preserves loaded mail, remains retryable and does not leak stale search results',async({page})=>{
 const {calls}=await boot(page,{mailFail:true});await expect(page.locator('#mailxNotice')).toContainText('Previously loaded mail is kept');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(2);await page.locator('#mailxRefresh').click();await expect(page.locator('#mailxNotice')).toContainText('Previously loaded mail is kept');expect(calls.filter(c=>c.route==='mail').length).toBeGreaterThanOrEqual(2);await page.locator('#mailxSearch').fill('nonexistent-search');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(0);
});
test('a failed thread preserves its existing row alongside successful account results',async({page})=>{
 await boot(page,{partialFail:true});await expect(page.locator('#mailxNotice')).toContainText('One thread temporarily unavailable');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(2);await expect(page.locator('#mailxList')).toContainText('Thursday meeting');await expect(page.locator('#mailxList')).toContainText('Your receipt');
});

test('workspace chrome is singular, grouped, and reader footer is structurally separate',async({page})=>{
 await boot(page);
 await expect(page.locator('#mailxComposeTop')).toHaveCount(0);
 await expect(page.locator('#mailxComposeMain')).toHaveCount(1);
 await expect(page.locator('.mailx-nav-group')).toHaveCount(4);
 await page.locator('#mailxList .mailx-message').first().click();
 await expect(page.locator('.mailx-reader > .mailx-reply-bar')).toHaveCount(1);
 await expect(page.locator('.mailx-reader-scroll .mailx-reply-bar')).toHaveCount(0);
 await expect(page.locator('.mailx-reply-inline')).toHaveCount(0);
});

test('desktop splitters resize panes and persist their widths',async({page},info)=>{
 test.skip(info.project.name==='iphone','desktop interaction');
 await boot(page);
 const list=page.locator('.mailx-list-pane'),splitter=page.locator('[data-mailx-resizer="list"]');
 const before=await list.boundingBox(),handle=await splitter.boundingBox();
 expect(before).toBeTruthy();expect(handle).toBeTruthy();
 await page.mouse.move(handle.x+handle.width/2,handle.y+60);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+72,handle.y+60,{steps:5});await page.mouse.up();
 const after=await list.boundingBox();expect(after.width).toBeGreaterThan(before.width+40);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('eren-mail-layout-v1')||'{}'));
 expect(saved.list).toBeGreaterThan(before.width+40);
});

test('desktop composer can be dragged without moving when editing fields',async({page},info)=>{
 test.skip(info.project.name==='iphone','desktop interaction');
 await boot(page);await composeButton(page).click();
 const pane=page.locator('#mailxCompose'),head=page.locator('#mailxCompose .mailx-compose-head');
 const before=await pane.boundingBox(),h=await head.boundingBox();expect(before).toBeTruthy();expect(h).toBeTruthy();
 await page.mouse.move(h.x+120,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+40,h.y+h.height/2+36,{steps:5});await page.mouse.up();
 const after=await pane.boundingBox();expect(after.x).toBeLessThan(before.x-50);expect(after.y).toBeGreaterThanOrEqual(before.y);
 const stable=await pane.boundingBox();await page.locator('#mailxSubject').click();await page.locator('#mailxSubject').fill('Still here');const edited=await pane.boundingBox();
 expect(Math.abs(edited.x-stable.x)).toBeLessThan(2);expect(Math.abs(edited.y-stable.y)).toBeLessThan(2);
});

test('touch swipe left archives immediately through the same Gmail action',async({page},info)=>{
 test.skip(info.project.name!=='iphone','touch-only interaction');
 const {calls}=await boot(page);await expect.poll(()=>page.locator('#mailxRefresh').isDisabled()).toBe(false);
 const wrap=page.locator('[data-swipe-row="0"]');await expect(wrap).toHaveAttribute('data-swipe-enabled','1');
 await wrap.evaluate(async el=>{
   const target=el.querySelector('.mailx-message'),r=el.getBoundingClientRect(),id=41,y=r.top+r.height/2,start=r.right-18,mid=start-64,end=Math.max(r.left+12,start-150);
   const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
   const fire=(type,x,buttons)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:true,button:0,buttons,clientX:x,clientY:y}));
   fire('pointerdown',start,1);fire('pointermove',mid,1);await frame();fire('pointermove',end,1);await frame();fire('pointerup',end,0);
 });
 await expect.poll(()=>calls.some(c=>c.route==='modify'&&c.body.action==='archive')).toBeTruthy();
 await expect(page.locator('#mailxToast')).toContainText('Archived');
 await expect(page.locator('#mailxToast button')).toHaveText('Undo');
});


test('mail history shows a year for messages outside the current year',async({page})=>{
 const oldYear=new Date().getFullYear()-2,oldTimestamp=new Date(oldYear,9,2,23,5).getTime();
 await boot(page,{oldTimestamp});
 const oldMessage=page.locator('#mailxList .mailx-message').filter({hasText:'Thursday meeting'}).first();
 await expect(oldMessage.locator('.mailx-time')).toContainText(String(oldYear));
 await oldMessage.click();
 await expect(page.locator('.mailx-thread-message').last().locator('summary').first()).toContainText(String(oldYear));
});

test('compose uses an icon draft action, clean Gemini label, and visible AI spinner',async({page})=>{
 await boot(page,{aiDelay:500});await composeButton(page).click();
 await expect(page.locator('#mailxSaveDraft')).toHaveAttribute('aria-label','Save draft');
 await expect(page.locator('#mailxSaveDraft')).toHaveText('');
 await expect(page.locator('.mailx-ai-label')).toContainText('Gemini');
 await expect(page.locator('.mailx-ai-label')).not.toContainText('edits the body below');
 await page.locator('#mailxAiPrompt').fill('Write a short reply');
 await page.locator('#mailxGenerate').click();
 await expect(page.locator('#mailxGenerate')).toHaveClass(/is-loading/);
 await expect(page.locator('#mailxGenerate')).toHaveAttribute('aria-busy','true');
 await expect(page.locator('.mailx-ai-spinner')).toBeVisible();
 await expect(page.locator('.mailx-ai-generate-label')).toHaveText('Revising…');
 await expect(page.locator('#mailxBody')).toHaveText('I can meet after 3.');
 await expect(page.locator('#mailxGenerate')).not.toHaveClass(/is-loading/);
});

test('mobile compose action sits in the top bar with the other controls',async({page},info)=>{
 test.skip(info.project.name!=='iphone','mobile-only layout');
 await boot(page);
 await expect(page.locator('#mailxComposeMain')).toBeHidden();
 const compose=page.locator('#mailxComposeMobile'),settings=page.locator('#mailxSettings'),close=page.locator('#mailxClose');
 await expect(compose).toBeVisible();
 const [c,sb,cl]=await Promise.all([compose.boundingBox(),settings.boundingBox(),close.boundingBox()]);
 expect(c).toBeTruthy();expect(sb).toBeTruthy();expect(cl).toBeTruthy();
 expect(Math.abs(c.y-sb.y)).toBeLessThan(3);expect(Math.abs(c.y-cl.y)).toBeLessThan(3);
 await compose.click();await expect(page.locator('#mailxCompose')).toHaveClass(/is-open/);
});


test('rich formatting and durable attachments are included in send payload',async({page})=>{
 const {calls}=await boot(page);await composeButton(page).click();await page.locator('#mailxTo').fill('friend@example.org');await page.locator('#mailxSubject').fill('Rich mail');await page.locator('#mailxBody').fill('Hello formatted');
 await page.locator('#mailxBody').evaluate(el=>{const text=el.firstChild,r=document.createRange();r.setStart(text,6);r.setEnd(text,15);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
 await page.getByRole('button',{name:'Bold'}).click();
 await expect.poll(()=>page.locator('#mailxBody').evaluate(el=>el.innerHTML)).toMatch(/<(b|strong)>formatted<\/(b|strong)>/i);
 await page.locator('#mailxAttachmentInput').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('hello attachment')});
 await expect(page.locator('.mailx-attachment-chip')).toContainText('notes.txt');await expect(page.locator('.mailx-attachment-chip')).toContainText(/B|KB/);
 await expect.poll(()=>calls.filter(c=>c.route==='drafts/attachment').length).toBe(1);
 await page.locator('#mailxSend').click();await expect(page.locator('#mailxCompose')).toBeHidden();
 const send=calls.filter(c=>c.route==='send').at(-1).body;expect(send.draftId).toBeTruthy();expect(send.attachments).toHaveLength(1);expect(send.attachments[0].name).toBe('notes.txt');expect(send.body).toContain('Hello formatted');expect(send.bodyHtml).toMatch(/<(b|strong)>formatted<\/(b|strong)>/i);
});

test('failed attachment upload can be retried before sending',async({page})=>{
 const {calls}=await boot(page,{attachmentFailOnce:true});await composeButton(page).click();await page.locator('#mailxTo').fill('friend@example.org');await page.locator('#mailxBody').fill('Retry test');
 await page.locator('#mailxAttachmentInput').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from('retry me')});
 await expect(page.locator('.mailx-attachment-chip')).toHaveClass(/is-error/);await expect(page.locator('.mailx-attachment-chip')).toContainText('Retry');
 await page.locator('[data-attachment-retry]').click();await expect(page.locator('.mailx-attachment-chip')).not.toHaveClass(/is-error/);await expect.poll(()=>calls.filter(c=>c.route==='drafts/attachment').length).toBe(2);
 await page.locator('#mailxSend').click();await expect(page.locator('#mailxCompose')).toBeHidden();expect(calls.filter(c=>c.route==='send').at(-1).body.attachments).toHaveLength(1);
});

test('Gemini rich revisions preserve returned formatting and Undo restores prior rich HTML',async({page})=>{
 await boot(page,{richAiHtml:'<p>Warm: <strong>I can meet after 4.</strong></p>'});await composeButton(page).click();await page.locator('#mailxBody').fill('I can meet after 4.');await page.locator('#mailxAiPrompt').fill('Make warmer');await page.locator('#mailxGenerate').click();
 await expect(page.locator('#mailxBody')).toContainText('Warm:');await expect.poll(()=>page.locator('#mailxBody').evaluate(el=>el.innerHTML)).toContain('<strong>');
 await page.locator('#mailxUndo').click();await expect(page.locator('#mailxBody')).toHaveText('I can meet after 4.');
});


test('plain Gemini line breaks render as real editor breaks',async({page})=>{
 await boot(page,{aiBody:'First line\nSecond line\n\nNew paragraph.',richAiHtml:''});await composeButton(page).click();await page.locator('#mailxAiPrompt').fill('Keep my paragraphs');await page.locator('#mailxGenerate').click();
 await expect.poll(()=>page.locator('#mailxBody').evaluate(el=>el.innerText)).toBe('First line\nSecond line\n\nNew paragraph.');
 const html=await page.locator('#mailxBody').evaluate(el=>el.innerHTML);expect(html).toBe('First line<br>Second line<br><br>New paragraph.');
});

test('composer defensively renders HTML returned in Gemini body instead of printing tags',async({page})=>{
 const malformed='<div style="font-family:Arial"><h2 style="color:red">Project Update</h2><p>Progress below:</p><ul><li><strong>Phase 1:</strong> Complete.</li><li><em>Phase 2:</em> Testing.</li></ul></div>';
 await boot(page,{aiBody:malformed,richAiHtml:''});await composeButton(page).click();await page.locator('#mailxAiPrompt').fill('Format update');await page.locator('#mailxGenerate').click();
 await expect(page.locator('#mailxBody')).toContainText('Project Update');await expect(page.locator('#mailxBody')).not.toContainText('<h2');
 const html=await page.locator('#mailxBody').evaluate(el=>el.innerHTML);expect(html).toContain('<h2>Project Update</h2>');expect(html).not.toContain('style=');
});
