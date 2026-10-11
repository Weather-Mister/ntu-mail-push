import {test,expect} from '@playwright/test';

const classification={type:'Account Notification',context:'',priority:'Normal',action:'FYI',code:null,blocked:false};
const gif='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const html='<!doctype html><html><head><style>body{background:white;color:#000}p{color:blue;font-size:30px}</style></head>'+
  '<body><div style="background:#fff;color:red"><h2 style="color:blue">華南銀行通知</h2>'+
  '<p style="color:blue;font-size:30px">Card activity recorded on October 10.</p>'+
  '<table bgcolor="#ffffff" style="background:white;color:red"><tbody>'+
  '<tr><th>交易金額</th><td>NT$96</td></tr><tr><th>卡號</th><td>****29</td></tr></tbody></table>'+
  '<ul><li>Check your statement</li><li>Keep your details safe</li></ul>'+
  '<a href="https://bank.example.org/details" style="color:red">Statement link</a>'+
  '<a href="javascript:alert(1)">Unsafe link</a>'+
  '<img src="'+gif+'" alt="Bank logo" width="80" height="30" />'+
  '<script>window.injectedByEmail=true</script></div></body></html>';

function mockMessage({htmlBody=html,subject='華南銀行通知',text='交易金額：NT$96\n卡號：****29'}) {
  return {id:'mail-one',threadId:'thread-one',accountId:'account-one',
    sender:'Hua Nan Bank',from:'Hua Nan Bank <alerts@bank.example.org>',
    email:'alerts@bank.example.org',to:'me@example.org',cc:'',
    replyTo:'alerts@bank.example.org',subject,timestamp:Date.now(),labels:['INBOX'],
    snippet:text,classification,unsubscribe:{web:null,mailto:null,listId:'',oneClick:false},
    text,html:htmlBody,attachments:[]};
}
async function setup(page,message) {
  const errors=[],actions=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('ntu-schedule-pairing-key-v1','test-key-'.repeat(6)));
  await page.route('https://**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),action=url.searchParams.get('route');
    actions.push(action);
    let data={ok:true};
    if(url.pathname.includes('eren-mail')){
      if(action==='bootstrap')data={accounts:[{id:'account-one',display_name:'Eren',email:'me@example.org',status:'active'}],preferences:{},messages:[message]};
      if(action==='cached-mail'||action==='mail')data={messages:[message],cursor:{'account-one':null},hasMore:false,errors:[]};
      if(action==='thread')data={threadId:'thread-one',accountId:'account-one',messages:[message]};
      if(action==='accounts')data={accounts:[{id:'account-one',display_name:'Eren',email:'me@example.org',status:'active'}]};
      if(action==='rules')data={rules:[]};
      if(action==='status')data={configured:true,aiConfigured:true,types:['Account Notification'],priorities:['Normal'],actions:['FYI']};
      if(action==='translate')data={subject:'Hua Nan Bank Notice',body:'Transaction amount: NT$96\nCard: ****29',bodyHtml:'<h2>Hua Nan Bank Notice</h2><table><tr><th>Amount</th><td>NT$96</td></tr></table>'};
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/skeuo-demo.html');
  await page.locator('#mailDashboardButton').click();
  await expect(page.locator('#mailxList .mailx-message')).toHaveCount(1);
  await page.locator('#mailxList .mailx-message').first().click();
  return {errors,actions};
}

test('HTML mail defaults to native CRT typography, retains tables/images/links, original layout is optional',async({page})=>{
  const {errors,actions}=await setup(page,mockMessage({}));
  const body=page.locator('.mailx-original-body');
  await expect(body).toBeVisible();
  await expect(body).toContainText('NT$96');
  await expect(body.locator('tr')).toHaveCount(2);
  await expect(body.locator('li')).toHaveCount(2);
  await expect(body.locator('img[alt="Bank logo"]')).toHaveCount(1);
  await expect(body.locator('a[href="https://bank.example.org/details"]')).toHaveCount(1);
  await expect(body.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(body.locator('script,style,iframe')).toHaveCount(0);
  const appearance=await body.evaluate(el=>{
    const p=el.querySelector('p'),table=el.querySelector('table');
    return {
      background:getComputedStyle(el).backgroundColor,
      color:getComputedStyle(el).color,
      fontSize:getComputedStyle(p).fontSize,
      textColor:getComputedStyle(p).color,
      tableBackground:getComputedStyle(table).backgroundColor,
      hasInlineStyle:!!p.getAttribute('style'),
    };
  });
  expect(appearance.background).toBe('rgba(0, 0, 0, 0)');
  expect(appearance.color).toBe('rgb(207, 210, 196)');
  expect(appearance.fontSize).toBe('12px');
  expect(appearance.textColor).toBe('rgb(207, 210, 196)');
  expect(appearance.tableBackground).toBe('rgba(0, 0, 0, 0)');
  expect(appearance.hasInlineStyle).toBe(false);
  expect(await page.evaluate(()=>window.injectedByEmail)).toBeUndefined();

  const original=page.locator('.mailx-original-layout');
  await expect(original).not.toHaveAttribute('open');
  const frame=original.locator('iframe');
  expect(await frame.getAttribute('srcdoc')).toBeNull();
  await original.locator('summary').click();
  await expect(original).toHaveAttribute('open');
  await expect(frame).toHaveAttribute('srcdoc',/background:white/);
  await expect(body).toBeVisible();

  await page.locator('[data-mailx-translate]').click();
  await expect(page.locator('.mailx-translation-body table')).toContainText('NT$96');
  await expect(body).toBeHidden();
  await expect(original).toBeHidden();
  await page.locator('[data-mailx-translate]').click();
  await expect(body).toBeVisible();
  await expect(page.locator('.mailx-translation')).toHaveCount(0);
  expect(actions.filter(action=>action==='translate')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('plain text mail keeps the same dark, readable terminal presentation',async({page})=>{
  const {errors,actions}=await setup(page,mockMessage({subject:'Welcome',htmlBody:'',text:'Hello,\n\nYour account is ready.\n\nThank you.'}));
  await expect(page.locator('.mailx-original-body,.mailx-original-layout')).toHaveCount(0);
  const body=page.locator('.mailx-thread-details.is-current > .mailx-mail-body');
  await expect(body).toBeVisible();
  await expect(body).toContainText('Your account is ready.');
  expect(await body.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(207, 210, 196)');
  expect(actions.filter(action=>action==='translate')).toHaveLength(0);
  expect(errors).toEqual([]);
});
