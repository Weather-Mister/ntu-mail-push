import {test,expect} from '@playwright/test';
const accounts=[{id:'a1',email:'first@example.org',display_name:'Personal',status:'active'},{id:'a2',email:'second@example.org',display_name:'University',status:'active'}];
const classification={type:'University',context:'Engineering Mathematics',priority:'High',action:'Needs reply',code:null,blocked:false};
const msg={id:'m1',threadId:'t1',accountId:'a1',sender:'Professor',from:'Professor <prof@example.org>',email:'prof@example.org',replyTo:'prof@example.org',to:'first@example.org',cc:'',subject:'Thursday meeting',timestamp:Date.now(),labels:['INBOX','UNREAD'],snippet:'Can you meet Thursday?',classification,unsubscribe:{web:null,mailto:null,listId:'',oneClick:false},text:'Can you meet Thursday?\nFull message content.',html:'',attachments:[],count:1};
async function boot(page,options={}){
 const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('ntu-schedule-pairing-key-v1','test-key-'.repeat(6)));
 await page.route('https://**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),r=url.searchParams.get('route');let body={};try{body=req.postDataJSON()||{};}catch{}calls.push({route:r,body,url});
  let data={};
  if(url.pathname.includes('/eren-mail')){
   if(r==='status')data={configured:true,aiConfigured:true,types:['University','Promotion','Receipt / Order','Other'],priorities:['High','Normal','Low','Muted'],actions:['Needs reply','Deadline','Waiting','FYI','No action'],health:{last_finished_at:new Date().toISOString()},redirectUri:'https://api.example.org/callback'};
   if(r==='accounts')data={accounts};if(r==='preferences')data={preferences:{}};if(r==='rules')data={rules:[]};if(r==='outbox')data={jobs:[]};if(r==='drafts')data={drafts:[]};
   if(r==='mail'){let messages=[msg,{...msg,id:'m2',threadId:'t2',accountId:'a2',sender:'Bank',subject:'Your receipt',classification:{...classification,type:'Receipt / Order',priority:'Normal',action:'FYI'}}];if(url.searchParams.get('accountId')!=='all')messages=messages.filter(m=>m.accountId===url.searchParams.get('accountId'));data={messages,cursor:{a1:null,a2:null},hasMore:false,errors:[]};}
   if(r==='thread')data={threadId:url.searchParams.get('threadId'),accountId:url.searchParams.get('accountId'),messages:[{...msg,threadId:url.searchParams.get('threadId')}]};
   if(r==='ai'){
    if(options.aiDelay)await new Promise(r=>setTimeout(r,options.aiDelay));
    if(options.aiFail)return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Gemini quota exhausted. Your draft has been preserved.'})});
    data={body:body.body?'Warm: '+body.body:'I can meet after 3.'};
   }
   if(r==='send'){if(options.sendDelay)await new Promise(r=>setTimeout(r,options.sendDelay));data={job:{id:body.id,status:body.sendAt?'pending':'sent'}};}
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
test('dashboard remains intact; live account selector combines and filters inbox',async({page})=>{
 const {calls,errors}=await boot(page);const selector=page.locator('.mailx-account-select-list');await expect(selector.locator('option')).toHaveCount(3);await selector.selectOption('a2');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(1);await expect(page.locator('#mailxList')).toContainText('Your receipt');await selector.selectOption('all');await expect(page.locator('#mailxList .mailx-message')).toHaveCount(2);
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
 const {calls}=await boot(page);await page.locator('#mailxComposeTop').click();await page.locator('#mailxAiPrompt').fill('Meet after 3');await page.locator('#mailxGenerate').click();await expect(page.locator('#mailxBody')).toHaveValue('I can meet after 3.');await page.locator('#mailxBody').fill('I can meet after 4.');await page.locator('#mailxAiPrompt').fill('Make warmer');await page.locator('#mailxGenerate').click();await expect(page.locator('#mailxBody')).toHaveValue('Warm: I can meet after 4.');expect(calls.filter(c=>c.route==='ai').at(-1).body.body).toBe('I can meet after 4.');await page.locator('#mailxUndo').click();await expect(page.locator('#mailxBody')).toHaveValue('I can meet after 4.');await page.locator('#mailxRedo').click();await expect(page.locator('#mailxBody')).toHaveValue('Warm: I can meet after 4.');
});
test('AI failure keeps the draft; edits during generation win',async({page})=>{
 await boot(page,{aiFail:true});await page.locator('#mailxComposeTop').click();await page.locator('#mailxBody').fill('My current draft.');await page.locator('#mailxAiPrompt').fill('Revise');await page.locator('#mailxGenerate').click();await expect(page.locator('#mailxComposeError')).toContainText('quota');await expect(page.locator('#mailxBody')).toHaveValue('My current draft.');
});
test('late AI response cannot overwrite typing or a different composer',async({page})=>{
 await boot(page,{aiDelay:500});await page.locator('#mailxComposeTop').click();await page.locator('#mailxBody').fill('Original');await page.locator('#mailxAiPrompt').fill('Warm');await page.locator('#mailxGenerate').click();await page.locator('#mailxBody').fill('New manual edit');await expect(page.locator('#mailxToast')).toContainText('You edited this draft');await expect(page.locator('#mailxBody')).toHaveValue('New manual edit');
});
test('archive uses API; local block scope stays distinct from Spam',async({page})=>{
 const {calls}=await boot(page);await page.locator('#mailxList .mailx-message').first().click();await page.locator('[data-action="block"]').click();await page.locator('#ruleScope').selectOption('sender');await page.locator('#ruleSave').click();await expect(page.locator('#mailxSheet')).toHaveCount(0);const rule=calls.find(c=>c.route==='rules'&&c.body.effects);expect(rule.body.effects).toEqual({blocked:true});expect(rule.body.scope).toBe('sender');expect(JSON.stringify(calls)).not.toContain('SPAM');await page.locator('[data-action="archive"]').click();await expect.poll(()=>calls.some(c=>c.route==='modify'&&c.body.action==='archive')).toBeTruthy();
});
test('duplicate Send is disabled and scheduled sending is a server request',async({page})=>{
 const {calls}=await boot(page,{sendDelay:500});await page.locator('#mailxComposeTop').click();await page.locator('#mailxTo').fill('friend@example.org');await page.locator('#mailxSubject').fill('Hello');await page.locator('#mailxBody').fill('Daily driver test');await page.locator('#mailxSend').click();await expect(page.locator('#mailxSend')).toBeDisabled();await expect(page.locator('#mailxCompose')).toBeHidden();expect(calls.filter(c=>c.route==='send')).toHaveLength(1);
 await page.locator('#mailxComposeTop').click();await page.locator('#mailxTo').fill('friend@example.org');await page.locator('#mailxBody').fill('Scheduled');await page.locator('#mailxSchedule').click();await page.locator('#mailxSendAt').fill('2027-01-10T15:30');await page.locator('#mailxConfirmSchedule').click();await expect(page.locator('#mailxCompose')).toBeHidden();expect(calls.filter(c=>c.route==='send').at(-1).body.sendAt).toBeTruthy();
});
