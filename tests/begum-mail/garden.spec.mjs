import '../browser/skeuo-unified-mail.spec.mjs';
import '../browser/mail.spec.mjs';
import {test,expect} from '@playwright/test';

async function setup(page,{format='html',failOnce=false,provider='ntu'}={}){
 const calls=[],errors=[];page.on('pageerror',e=>{if(!e.message.includes("Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag."))errors.push(e.message);});
 const message={id:'modern-chinese',threadId:'modern-thread',accountId:'modern-account',sender:'NTU COOL',email:'teacher@ntu.edu.tw',from:'NTU COOL <teacher@ntu.edu.tw>',to:'student@example.test',subject:'作業提醒：請確認繳交日期',timestamp:Date.now(),labels:['INBOX'],classification:{type:'University',priority:'Normal',action:'FYI',blocked:false,ruleIds:[]},snippet:'請在10月12日前繳交作業。',text:'請在10月12日前繳交作業。',html:format==='html'?'<p>請在10月12日前繳交作業。</p>':'',attachments:[],unsubscribe:{}};
 const accounts=[{id:message.accountId,email:'student@example.test',display_name:'Student',provider,status:'active'}];
 let attempts=0;
 await page.addInitScript(()=>{if(window.top===window.self){localStorage.setItem('ntu-schedule-begum-pairing-key-v1','begum');localStorage.setItem('begum-mail-access-key-v1','b'.repeat(40));}});
 await page.route('https://**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),action=url.searchParams.get('route');let body={};try{body=req.postDataJSON()||{};}catch{}
  let data={},status=200;
  if(url.pathname.includes('/eren-mail')){
   if(action==='bootstrap')data={accounts,preferences:{},messages:[message]};
   if(action==='accounts')data={accounts};
   if(action==='mail'||action==='cached-mail')data={messages:[message],cursor:{[message.accountId]:null},hasMore:false,errors:[]};
   if(action==='thread')data={threadId:message.threadId,accountId:message.accountId,messages:[message]};
   if(action==='status')data={configured:true,aiConfigured:true,types:['University'],priorities:['Normal'],actions:['FYI']};
   if(action==='rules')data={rules:[]};
   if(action==='translate'){
    calls.push(body);attempts++;
    if(failOnce&&attempts===1){status=502;data={error:'Gemini temporarily unavailable'};}
    else data={subject:'Homework reminder',body:'Submit by October 12.',bodyHtml:'<p>Submit by <strong>October 12</strong>.</p><table><tr><th>Due</th><td>October 12</td></tr></table><a href="https://cool.ntu.edu.tw/">Open COOL</a><script>window.translationInjected=true</script><img src=x onerror=alert(1)>'};
   }
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/');await page.locator('#mailDashboardButton').click();await page.locator('#mailxList .mailx-message').first().click();
 return {calls,errors};
}
for(const format of ['text','html'])test(`modern mobile ${format} mail uses styled Gemini translation with cached Original/English toggle`,async({page},info)=>{

 const {calls,errors}=await setup(page,{format,provider:format==='text'?'gmail':'ntu'});
 const button=page.locator('.mailx-reader-title-row > [data-mailx-translate]');await expect(button).toHaveText('⇄Translate');expect(calls).toHaveLength(0);
 const appearance=await button.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {radius:s.borderRadius,background:s.backgroundColor,color:s.color,height:r.height,right:r.right};});
 expect(appearance.radius).toBe('999px');expect(appearance.background).toBe('rgb(234, 240, 226)');expect(appearance.color).toBe('rgb(77, 112, 92)');expect(appearance.height).toBeGreaterThanOrEqual(36);expect(appearance.right).toBeLessThanOrEqual(page.viewportSize().width);
 await button.click();const translation=page.locator('.mailx-translation');await expect(translation).toBeVisible();await expect(translation.locator('table')).toContainText('October 12');await expect(translation.locator('strong')).toHaveText('October 12');
 await expect(translation.locator('script,img')).toHaveCount(0);await expect(translation.locator('a')).toHaveAttribute('target','_blank');expect(await page.evaluate(()=>window.translationInjected)).toBeUndefined();
 const original=page.locator(format==='html'?'.mailx-thread-details.is-current > .mailx-original-body':'.mailx-thread-details.is-current > .mailx-mail-body');await expect(original).toBeHidden();await expect(button).toHaveAttribute('aria-pressed','true');await expect(button).toContainText('Original');
 expect(calls).toEqual([{accountId:'modern-account',messageId:'modern-chinese'}]);
 await button.click();await expect(original).toBeVisible();await expect(translation).toHaveCount(0);await expect(button).toContainText('English');await button.click();await expect(translation).toBeVisible();expect(calls).toHaveLength(1);expect(errors).toEqual([]);
});
test('modern mobile Gemini failure preserves original mail and permits retry',async({page},info)=>{
 test.skip(info.project.name!=='iphone','Mobile modern reader feature');const {calls}=await setup(page,{format:'text',failOnce:true});
 const button=page.locator('[data-mailx-translate]');await button.click();await expect(page.locator('#mailxToast')).toContainText('Translation failed');await expect(button).toBeEnabled();await expect(page.locator('.mailx-thread-details.is-current > .mailx-mail-body')).toBeVisible();await expect(page.locator('.mailx-translation')).toHaveCount(0);
 await button.click();await expect(page.locator('.mailx-translation')).toBeVisible();expect(calls).toHaveLength(2);
});
test('Garden desktop translation preserves Chinese original and uses isolated device state',async({page})=>{
 await page.setViewportSize({width:1440,height:900});const {calls}=await setup(page,{format:'text'});
 await expect(page.locator('[data-mailx-translate]')).toBeVisible();
 await page.locator('[data-mailx-translate]').click();await expect(page.locator('.mailx-translation')).toBeVisible();
 await page.locator('[data-mailx-translate]').click();await expect(page.locator('.mailx-mail-body')).toContainText('請在10月12日前繳交作業。');
 expect(calls).toHaveLength(1);
 const state=await page.evaluate(()=>({begum:localStorage.getItem('ntu-schedule-begum-pairing-key-v1'),eren:localStorage.getItem('ntu-schedule-pairing-key-v1'),bodyScroll:document.documentElement.scrollWidth>innerWidth}));
 expect(state).toEqual({begum:'begum',eren:null,bodyScroll:false});
 await page.locator('#mailxSettings').click();await expect(page.locator('#mailxConnect')).toBeVisible();await expect(page.locator('#mailxConnectNtu')).toBeVisible();
 await page.screenshot({path:'test-results/begum-mail-desktop.png',fullPage:true});
});

test('Garden Mail requires its private key even when the public schedule word is paired',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('ntu-schedule-begum-pairing-key-v1','begum');localStorage.removeItem('begum-mail-access-key-v1');});
 const keys=[];await page.route('**/functions/v1/eren-mail**',route=>{keys.push(route.request().headers()['x-schedule-key']);const r=new URL(route.request().url()).searchParams.get('route');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(r==='bootstrap'?{accounts:[],messages:[],preferences:{}}:r==='mail'||r==='cached-mail'?{messages:[],cursor:{},hasMore:false}:r==='accounts'?{accounts:[]}:{configured:true,aiConfigured:true})});});
 await page.route('**/functions/v1/ntu-schedule-api**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"tasks":[],"events":[],"ok":true}'}));
 await page.goto('/');await page.locator('#mailDashboardButton').click();await expect(page.locator('#mailxUnlockForm')).toBeVisible();expect(keys).toHaveLength(0);
 await page.locator('#mailxAccessKey').fill('b'.repeat(40));await page.locator('#mailxUnlockForm button').click();await expect(page.locator('#mailxUnlockForm')).toHaveCount(0);
 expect(keys.length).toBeGreaterThan(0);expect(keys.every(k=>k==='b'.repeat(40))).toBeTruthy();
 expect(await page.evaluate(()=>localStorage.getItem('begum-mail-access-key-v1'))).toBe('b'.repeat(40));
});
