import { test, expect } from '@playwright/test';

const classification={type:'University',context:'NTU COOL',priority:'Normal',action:'FYI',code:null,blocked:false};
const message={id:'chinese-id',threadId:'thread-1',accountId:'account-1',sender:'NTU COOL',
  from:'NTU COOL <noreply@cool.ntu.edu.tw>',email:'noreply@cool.ntu.edu.tw',to:'student@example.com',cc:'',
  replyTo:'noreply@cool.ntu.edu.tw',subject:'作業提醒',timestamp:Date.now(),labels:['INBOX'],
  snippet:'請在10月12日前繳交作業。',classification,
  unsubscribe:{web:null,mailto:null,listId:'',oneClick:false},
  text:'請在10月12日前繳交作業。',html:'',attachments:[]};
test('skeuo reader translates Chinese mail on demand and can restore the original',async({page})=>{
  const calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('ntu-schedule-pairing-key-v1','test-key-'.repeat(6)));
  await page.route('https://**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),action=url.searchParams.get('route');
    let body={};try{body=request.postDataJSON()||{};}catch{}
    calls.push({action,body});
    let data={ok:true};
    if(url.pathname.includes('eren-mail')){
      if(action==='bootstrap')data={accounts:[{id:'account-1',display_name:'NTU',email:'student@example.com',status:'active'}],preferences:{},messages:[message]};
      if(action==='cached-mail'||action==='mail')data={messages:[message],cursor:{'account-1':null},hasMore:false,errors:[]};
      if(action==='thread')data={threadId:'thread-1',accountId:'account-1',messages:[message]};
      if(action==='rules')data={rules:[]};
      if(action==='accounts')data={accounts:[{id:'account-1',display_name:'NTU',email:'student@example.com',status:'active'}]};
      if(action==='status')data={configured:true,aiConfigured:true,types:['University'],priorities:['Normal'],actions:['FYI']};
      if(action==='translate')data={subject:'Homework reminder',body:'Please submit your homework by October 12.'};
      if(action==='modify-batch')data={results:(body.operations||[]).map(()=>({ok:true}))};
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/skeuo-demo.html');
  await page.locator('#mailDashboardButton').click();
  await expect(page.locator('#mailxList .mailx-message')).toHaveCount(1);
  await page.locator('#mailxList .mailx-message').first().click();
  const translate=page.locator('.mailx-reader-title-row > [data-mailx-translate]');
  await expect(translate).toContainText('TRANSLATE');
  await expect(page.locator('.mailx-thread-details [data-mailx-translate]')).toHaveCount(0);
  await expect(page.locator('.mailx-translate-controls')).toHaveCount(0);
  await expect(page.locator('#mailxReader')).not.toContainText('Gemini · only when requested');
  const heading=await page.locator('.mailx-reader-title-row').boundingBox();
  const subject=await page.locator('.mailx-reader-title-row .mailx-reader-subject').boundingBox();
  const button=await translate.boundingBox();
  expect(heading&&subject&&button).toBeTruthy();
  expect(button.x).toBeGreaterThanOrEqual(subject.x+subject.width-1);
  expect(button.y).toBeGreaterThanOrEqual(heading.y-1);
  expect(button.y+button.height).toBeLessThanOrEqual(heading.y+heading.height+1);
  expect(heading.height).toBeLessThanOrEqual(34);
  expect(await translate.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(170, 255, 171)');
  expect(calls.some(c=>c.action==='translate')).toBe(false);
  await page.locator('[data-mailx-translate]').click();
  await expect(page.locator('.mailx-translation-body')).toContainText('October 12');
  await expect(page.locator('.mailx-thread-details.is-current > .mailx-mail-body')).toBeHidden();
  expect(calls.filter(c=>c.action==='translate')).toEqual([{action:'translate',body:{accountId:'account-1',messageId:'chinese-id'}}]);
  await page.locator('[data-mailx-translate]').click();
  await expect(page.locator('.mailx-thread-details.is-current > .mailx-mail-body')).toContainText('請在10月12日前繳交作業');
  await expect(page.locator('.mailx-translation')).toHaveCount(0);
  await page.locator('[data-mailx-translate]').click();
  await expect(page.locator('.mailx-translation-body')).toContainText('October 12');
  expect(calls.filter(c=>c.action==='translate')).toHaveLength(1);
  expect(errors).toEqual([]);
});
