import {test,expect} from '@playwright/test';

const classification={type:'University',context:'',priority:'Normal',action:'FYI',code:null,blocked:false};
const inbox={id:'mail-a',threadId:'thread-a',accountId:'account-a',sender:'NTU',from:'NTU <notice@ntu.edu.tw>',
  email:'notice@ntu.edu.tw',to:'student@example.org',cc:'',replyTo:'notice@ntu.edu.tw',
  subject:'Reminder',timestamp:Date.now(),labels:['INBOX'],snippet:'Welcome',classification,
  unsubscribe:{web:null,mailto:null,listId:'',oneClick:false},text:'Welcome',html:'',attachments:[]};

async function setup(page){
  const calls=[],errors=[];
  let sendError=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{if(window.top===window.self)localStorage.setItem('ntu-schedule-pairing-key-v1','test-key-'.repeat(6));});
  await page.route('https://**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),action=url.searchParams.get('route');
    let body={};try{body=request.postDataJSON()||{};}catch{}
    calls.push({action,body});
    if(!url.pathname.includes('eren-mail'))return route.continue();
    if(action==='send'&&sendError)return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'Mail sending is temporarily unavailable for this account.'})});
    let data={ok:true};
    if(action==='bootstrap')data={accounts:[{id:'account-a',display_name:'NTU',email:'student@example.org',status:'active'}],preferences:{},messages:[inbox]};
    if(action==='cached-mail'||action==='mail')data={messages:[inbox],cursor:{'account-a':null},hasMore:false,errors:[]};
    if(action==='accounts')data={accounts:[{id:'account-a',display_name:'NTU',email:'student@example.org',status:'active'}]};
    if(action==='status')data={configured:true,aiConfigured:true,types:['University'],priorities:['Normal'],actions:['FYI']};
    if(action==='rules')data={rules:[]};
    if(action==='drafts/attachment')data={attachment:{id:body.id,name:body.name,type:body.type,size:body.size}};
    if(action==='send')data={job:{status:'sent',id:'job-a'}};
    if(action==='thread')data={threadId:'thread-a',accountId:'account-a',messages:[inbox]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/skeuo-demo.html');
  await page.locator('#mailDashboardButton').click();
  await expect(page.locator('#mailxComposeMain')).toBeVisible();
  await page.locator('#mailxComposeMain').click();
  await expect(page.locator('#mailxCompose')).toBeVisible();
  return {calls,errors,failSend(value){sendError=value;}};
}

async function assertUnclipped(page,selector){
  const bounds=await page.evaluate(sel=>{
    const item=document.querySelector(sel),composer=document.querySelector('#mailxCompose');
    if(!item||!composer)return null;
    const r=item.getBoundingClientRect(),c=composer.getBoundingClientRect();
    return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,
      clipTop:c.top,clipBottom:c.bottom,clipLeft:c.left,clipRight:c.right,
      height:r.height,shown:getComputedStyle(item).display!=='none'};
  },selector);
  expect(bounds).toBeTruthy();
  expect(bounds.shown).toBe(true);
  expect(bounds.height).toBeGreaterThan(12);
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.clipTop-1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.clipBottom+1);
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.clipLeft-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.clipRight+1);
}

test('compose shows upload chips and lets a real attachment payload go through Send',async({page})=>{
  const {calls,errors}=await setup(page);
  await page.locator('#mailxSend').click();
  await expect(page.locator('#mailxComposeError')).toContainText('valid recipient');

  await page.locator('#mailxTo').fill('recipient@example.org');
  await page.locator('#mailxSubject').fill('NTU notes');
  await page.locator('#mailxBody').fill('Please see the attached files.');
  await page.locator('#mailxAttachmentInput').setInputFiles([
    {name:'receipt.txt',mimeType:'text/plain',buffer:Buffer.from('Amount NT$96')},
    {name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('Lecture notes')}
  ]);

  await expect(page.locator('.mailx-attachment-chip')).toHaveCount(2);
  await expect(page.locator('.mailx-attachment-chip.is-uploading')).toHaveCount(0);
  await expect(page.locator('.mailx-attachment-chip')).toContainText(['receipt.txt','notes.txt']);
  await expect(page.locator('#mailxComposeError')).toBeEmpty();
  await assertUnclipped(page,'.mailx-attachment-chip:first-child');
  await assertUnclipped(page,'#mailxSend');
  const shelf=await page.locator('#mailxAttachments').evaluate(el=>({height:el.getBoundingClientRect().height,scrollHeight:el.scrollHeight}));
  expect(shelf.height).toBeGreaterThanOrEqual(35);

  await page.locator('#mailxSend').click();
  await expect(page.locator('#mailxCompose')).toBeHidden();
  const sends=calls.filter(c=>c.action==='send');
  expect(sends).toHaveLength(1);
  expect(sends[0].body.to).toBe('recipient@example.org');
  expect(sends[0].body.body).toContain('Please see the attached files');
  expect(sends[0].body.attachments).toHaveLength(2);
  expect(sends[0].body.attachments.map(a=>a.name)).toEqual(['receipt.txt','notes.txt']);
  expect(calls.filter(c=>c.action==='drafts/attachment')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('composer surfaces send failure without losing attached files; retry remains available',async({page})=>{
  const {calls,errors,failSend}=await setup(page);
  await page.locator('#mailxTo').fill('recipient@example.org');
  await page.locator('#mailxSubject').fill('Important');
  await page.locator('#mailxBody').fill('Please see attachment.');
  await page.locator('#mailxAttachmentInput').setInputFiles({name:'proof.txt',mimeType:'text/plain',buffer:Buffer.from('proof')});
  await expect(page.locator('.mailx-attachment-chip.is-uploading')).toHaveCount(0);
  await expect(page.locator('.mailx-attachment-chip')).toHaveCount(1);
  failSend(true);
  await page.locator('#mailxSend').click();
  await expect(page.locator('#mailxComposeError')).toContainText('temporarily unavailable');
  await assertUnclipped(page,'#mailxComposeError');
  await expect(page.locator('#mailxCompose')).toBeVisible();
  await expect(page.locator('.mailx-attachment-chip')).toContainText('proof.txt');
  await expect(page.locator('#mailxSend')).toBeEnabled();

  failSend(false);
  await page.locator('#mailxSend').click();
  await expect(page.locator('#mailxCompose')).toBeHidden();
  const sends=calls.filter(c=>c.action==='send');
  expect(sends).toHaveLength(2);
  expect(sends[0].body.id).toBe(sends[1].body.id); // idempotent retry
  expect(errors).toEqual([]);
});

test('short laptop display keeps Send and attachment tray within the composer',async({page})=>{
  await page.setViewportSize({width:1080,height:640});
  const {errors}=await setup(page);
  await page.locator('#mailxTo').fill('recipient@example.org');
  await page.locator('#mailxAttachmentInput').setInputFiles({name:'short-screen.txt',mimeType:'text/plain',buffer:Buffer.from('test')});
  await expect(page.locator('.mailx-attachment-chip.is-uploading')).toHaveCount(0);
  await expect(page.locator('.mailx-attachment-chip')).toContainText('short-screen.txt');
  await assertUnclipped(page,'.mailx-attachment-chip:first-child');
  await assertUnclipped(page,'#mailxSend');
  expect(errors).toEqual([]);
});
