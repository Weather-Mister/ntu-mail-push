import {test,expect} from '@playwright/test';

const destination='https://mail-link.example.test/info?x=1&y=2';
const text=`Open ${destination}. Also (https://mail-link.example.test/wiki/Topic_(One)). Visit www.mail-link.example.test. Help mailto:support@example.test. Unsafe javascript:alert(1). Literal <img src=x onerror=alert(1)>.`;
const html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body><p>${text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</p><a href="https://mail-link.example.test/named">Named link</a><a href="javascript:alert(1)">Unsafe link</a><script>window.injectedByEmail=true</script></body></html>`;
for(const path of ['/','/skeuo-demo.html'])for(const format of ['text','html']){
 test(`${path} ${format} email links open safely and have a subtle green glow`,async({page,context})=>{
  const message={id:'link-message',threadId:'link-thread',accountId:'link-account',accountName:'NTU Mail',sender:'Professor',email:'teacher@example.test',from:'Professor <teacher@example.test>',to:'me@example.test',subject:'Link check',timestamp:Date.now(),labels:['INBOX'],classification:{type:'University',priority:'Normal',action:'FYI',blocked:false,ruleIds:[]},snippet:'Email links',text,html:format==='html'?html:'',attachments:[],unsubscribe:{}};
  const accounts=[{id:'link-account',email:'me@example.test',display_name:'NTU Mail',provider:'ntu',status:'active'}];
  await page.addInitScript(()=>localStorage.setItem('ntu-schedule-pairing-key-v1','test-key-'.repeat(6)));
  await context.route('https://mail-link.example.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>Test link opened</p>'}));
  await page.route('https://**/*',async route=>{
   const url=new URL(route.request().url()),action=url.searchParams.get('route');let data={};
   if(url.pathname.includes('/eren-mail')){
    if(action==='bootstrap')data={accounts,preferences:{},messages:[message]};
    if(action==='accounts')data={accounts};
    if(action==='mail'||action==='cached-mail')data={messages:[message],cursor:{'link-account':null},hasMore:false,errors:[]};
    if(action==='thread')data={threadId:message.threadId,accountId:message.accountId,messages:[message]};
    if(action==='status')data={configured:true,aiConfigured:true,types:['University'],priorities:['Normal'],actions:['FYI']};
    if(action==='rules')data={rules:[]};
   }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(path);await page.locator('#mailDashboardButton').click();await page.locator('#mailxList .mailx-message').first().click();
  const body=format==='html'?(path==='/'?page.frameLocator('.mailx-html-body').locator('body'):page.locator('.mailx-original-body')):page.locator('.mailx-thread-details.is-current > .mailx-mail-body');
  const link=body.locator(`a[href="${destination}"]`);await expect(link).toHaveText(destination);await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel','noopener noreferrer');
  await expect(body.locator('a[href="https://mail-link.example.test/wiki/Topic_(One)"]')).toHaveCount(1);
  await expect(body.locator('a[href="https://www.mail-link.example.test/"]')).toHaveCount(1);await expect(body.locator('a[href="mailto:support@example.test"]')).toHaveCount(1);
  await expect(body.locator('a[href^="javascript:"],img[onerror]')).toHaveCount(0);await expect(body.locator('a a')).toHaveCount(0);
  const appearance=await link.evaluate(el=>({color:getComputedStyle(el).color,shadow:getComputedStyle(el).textShadow}));expect(appearance.shadow).not.toBe('none');expect(appearance.color).toBe(path==='/skeuo-demo.html'?'rgb(169, 214, 165)':'rgb(62, 116, 80)');
  if(format==='html')await expect(body.locator('a[href="https://mail-link.example.test/named"]')).toHaveCount(1);
  const [popup]=await Promise.all([page.waitForEvent('popup'),link.click()]);await expect(popup).toHaveURL(destination);await popup.close();await expect(page.locator('#mailxReader')).toBeVisible();
  expect(await page.evaluate(()=>window.injectedByEmail)).toBeUndefined();
 });
}
