import {test,expect} from '@playwright/test';
test('NTU reader requests only the clicked message, never speculative raw downloads',async({page})=>{
 const threads=[],account={id:'ntu-fixture',email:'student@example.invalid',display_name:'Student',provider:'ntu',status:'active'};
 const messages=[0,1].map(i=>({id:'message-'+i,threadId:'thread-'+i,accountId:account.id,sender:'Fixture',email:'teacher@example.invalid',subject:'Fixture '+i,timestamp:Date.now()-i,labels:['INBOX'],classification:{type:'University',priority:'Normal',action:'FYI'},snippet:'Fixture content'}));
 await page.addInitScript(()=>{localStorage.setItem('ntu-schedule-begum-pairing-key-v1','begum');localStorage.setItem('begum-mail-access-key-v1','b'.repeat(40));});
 await page.route('https://**/*',async route=>{
  const url=new URL(route.request().url()),action=url.searchParams.get('route');let data={};
  if(url.pathname.includes('/eren-mail')){
   if(action==='bootstrap')data={accounts:[account],preferences:{},messages};
   if(action==='accounts')data={accounts:[account]};
   if(action==='status')data={configured:true,aiConfigured:true};
   if(action==='mail'||action==='cached-mail')data={messages,cursor:{[account.id]:null},hasMore:false,errors:[]};
   if(action==='thread'){threads.push(url.searchParams.get('threadId'));await new Promise(resolve=>setTimeout(resolve,300));data={threadId:threads.at(-1),accountId:account.id,messages:[{...messages[0],text:'Opened only on demand',html:'',attachments:[],unsubscribe:{}}]};}
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/');await page.locator('#mailDashboardButton').click();await expect(page.locator('#mailxList .mailx-message')).toHaveCount(2);
 await page.waitForTimeout(1600);expect(threads).toEqual([]);
 await page.locator('#mailxList .mailx-message').first().click();await expect(page.locator('.mailx-mail-body')).toContainText('Opened only on demand');expect(threads).toEqual(['thread-0']);
});
