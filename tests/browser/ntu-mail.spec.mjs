import {test,expect} from '@playwright/test';
const ntuId='22222222-2222-4222-8222-222222222222',gmailId='11111111-1111-4111-8111-111111111111';
const classification={type:'University',priority:'Normal',action:'FYI',blocked:false,ruleIds:[]};
for(const path of ['/','/skeuo-demo.html']){
 test(`${path} NTU and Gmail share account selection, reader actions, attachments and reply sender`,async({page})=>{
  const calls=[],errors=[];page.on('pageerror',e=>{if(!e.message.includes('serviceWorker'))errors.push(e.message);});
  await page.addInitScript(()=>localStorage.setItem('ntu-schedule-pairing-key-v1','test-key-'.repeat(6)));
  const accounts=[{id:gmailId,email:'me@gmail.com',display_name:'Personal',provider:'gmail',status:'active'},{id:ntuId,email:'b15999999@ntu.edu.tw',display_name:'NTU Mail',provider:'ntu',status:'active'}];
  const ntu={id:'ntu_SU5CT1g_1',threadId:'ntu_SU5CT1g_1',accountId:ntuId,accountName:'NTU Mail',sender:'Professor',from:'Professor <teacher@ntu.edu.tw>',email:'teacher@ntu.edu.tw',replyTo:'teacher@ntu.edu.tw',to:accounts[1].email,subject:'NTU class notice',timestamp:Date.now(),labels:['INBOX','UNREAD'],classification,snippet:'Class begins at 10.',text:'Class begins at 10.',html:'',unsubscribe:{},attachments:[{id:'att0',partId:'att0',filename:'agenda.txt',mimeType:'text/plain',size:5}],count:1};
  const gmail={...ntu,id:'gmail-one',threadId:'gmail-thread',accountId:gmailId,accountName:'Personal',subject:'Personal mail',attachments:[]};
  await page.route('https://**/*',async route=>{const req=route.request(),url=new URL(req.url()),r=url.searchParams.get('route');let body={};try{body=req.postDataJSON()||{};}catch{}let data={};
   if(url.pathname.includes('/eren-mail')){calls.push({r,body});
    if(r==='bootstrap')data={accounts,preferences:{},messages:[ntu,gmail]};
    if(r==='accounts')data={accounts};
    if(r==='status')data={configured:true,aiConfigured:true,types:['University'],priorities:['Normal'],actions:['FYI'],health:{}};
    if(r==='rules')data={rules:[]};
    if(r==='mail'||r==='cached-mail'){const selected=url.searchParams.get('accountId');data={messages:[ntu,gmail].filter(m=>!selected||selected==='all'||m.accountId===selected),cursor:{[ntuId]:null,[gmailId]:null},hasMore:false,errors:[]};}
    if(r==='thread')data={threadId:ntu.threadId,accountId:ntuId,messages:[ntu]};
    if(r==='modify-batch')data={results:body.operations.map(()=>({ok:true}))};
    if(r==='drafts')data={drafts:[],ok:true};
    if(r==='attachment')data={data:'aGVsbG8',filename:'agenda.txt',mimeType:'text/plain',size:5};
    if(r==='send')data={job:{id:body.id,status:'sent'}};
   }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(path);await page.locator('#mailDashboardButton').click();await expect(page.locator('#mailxList .mailx-message')).toHaveCount(2);
  const selector=page.locator('.mailx-top-account');await selector.selectOption(ntuId);await expect(page.locator('#mailxList .mailx-message')).toHaveCount(1);await expect(page.locator('#mailxList')).toContainText('NTU class notice');
  await page.locator('#mailxList .mailx-message').first().click();await expect(page.locator('#mailxReader')).toContainText('Class begins at 10.');
  await expect.poll(()=>calls.some(c=>c.r==='modify-batch'&&c.body.operations.some(op=>op.accountId===ntuId&&op.action==='read'))).toBeTruthy();
  await expect(page.locator('#mailxReader')).toContainText('agenda.txt');
  await page.locator('[data-action="reply"]').click();await expect(page.locator('#mailxFrom')).toHaveValue(ntuId);await expect(page.locator('#mailxFrom')).toBeDisabled();await expect(page.locator('#mailxTo')).toHaveValue('teacher@ntu.edu.tw');
  await page.locator('#mailxBody').fill('Thank you.');await page.locator('#mailxSend').click();await expect.poll(()=>calls.some(c=>c.r==='send'&&c.body.accountId===ntuId&&c.body.threadId===ntu.threadId&&c.body.body==='Thank you.')).toBeTruthy();
  await expect(page.locator('#mailxToast')).toContainText('Sent through NTU Mail');
  await page.locator('#mailxSettings').click();await page.locator('#mailxConnectNtu').click();await expect(page.locator('#mailxNtuConnect')).toBeVisible();await expect(page.locator('#mailxNtuConnect input[name="password"]')).toHaveAttribute('type','password');
  expect(errors).toEqual([]);
 });
}
