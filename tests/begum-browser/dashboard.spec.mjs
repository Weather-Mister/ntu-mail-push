import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const tasks = [];
  await page.addInitScript(() => {
    const NativeSocket=window.WebSocket;
    window.WebSocket=class {
      static OPEN=1;
      constructor(url){
        if(!String(url).includes('begum-schedule-api.begum-schedule-fb773613.workers.dev'))return new NativeSocket(url);
        this.readyState=1;setTimeout(()=>this.onopen?.(),0);
      }
      send(raw){if(JSON.parse(raw).event==='pair')setTimeout(()=>this.onmessage?.({data:JSON.stringify({event:'ready'})}),0);}
      close(){this.readyState=3;this.onclose?.({code:1008});}
    };
  });
  await page.route(url => url.pathname.includes('/functions/v1/ntu-schedule-api') || url.origin==='https://begum-schedule-api.begum-schedule-fb773613.workers.dev', route => {
    const u = new URL(route.request().url());
    const path = u.searchParams.get('route') || '';
    const request = route.request();
    let data = {};
    if (path === 'todos/list') data = { tasks };
    else if (path === 'cool-calendar') data = { events:[] };
    else if (path === 'todos/create'){
      const task = request.postDataJSON();
      tasks.unshift(task);
      data = { task };
    } else if (path === 'todos/update'){
      const item = request.postDataJSON();
      const existing = tasks.find(t=>t.id===item.id);
      if (existing) existing.done = item.done;
      data = {ok:true};
    } else if (path === 'todos/delete'){
      const item = request.postDataJSON();
      const index = tasks.findIndex(t=>t.id===item.id);
      if (index>=0) tasks.splice(index,1);
      data = {ok:true};
    } else if (path === 'todos/import'){
      data = {ok:true};
    } else if (path === 'status'){
      data = {ok:true};
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
});


test('Garden production matches demo layout while every live feature remains connected', async ({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?pair=begum');
 await expect(page.locator('.garden .hero-bee')).toHaveCount(2);
 await expect(page.locator('#scheduleList')).toBeVisible();
 await expect(page.locator('#coolDeadlines')).toBeVisible();
 await expect(page.locator('#todoInput')).toBeVisible();
 await expect(page.locator('#ntuHubSection')).toBeVisible();
 await expect(page.locator('#nextClass')).toBeVisible();
 await expect(page.locator('#placesButton, #placesDialog')).toHaveCount(0);
 await expect(page.locator('#pageRefreshButton')).toBeVisible();
 await expect(page.locator('#mailAlertButton')).toBeVisible();
 await expect(page.locator('[data-day]')).toHaveCount(6);
 await expect(page.locator('.transfer-section, #hanziWidgetSlot')).toHaveCount(0);
 await page.locator('[data-day="2"]').click();
 await expect(page.locator('#selectedDay')).toHaveText('Tuesday in bloom');
 await expect(page.locator('.optional-pill')).toBeVisible();
 await page.locator('[data-day="1"]').click();
 await expect(page.locator('.lesson')).toHaveCount(2);
 await page.locator('.lesson').first().click();
 await expect(page.locator('#lessonDialog')).toBeVisible();
 await page.locator('#closeDialog').click();
 await page.locator('#todoInput').fill('Review macro');
 await page.locator('#todoForm button[type="submit"]').click();
 await expect(page.locator('.todo-item')).toContainText('Review macro');
 if(testInfo.project.name.startsWith('mac')){
  const classes=await page.locator('.classes-panel').boundingBox();
  const cool=await page.locator('.cool-section').boundingBox();
  const tasks=await page.locator('.todo-section').boundingBox();
  const rail=await page.locator('.day-rail').boundingBox();
  const shortcuts=await page.locator('.links-panel').boundingBox();
  expect(classes&&cool&&tasks&&rail&&shortcuts).toBeTruthy();
  expect(Math.abs(classes.y-cool.y)).toBeLessThan(4);
  expect(Math.abs(classes.width-cool.width)).toBeLessThan(6);
  expect(classes.x+classes.width).toBeLessThan(cool.x+5);
  expect(cool.x+cool.width).toBeLessThan(tasks.x+5);
  expect(rail.y+rail.height).toBeLessThan(classes.y+5);
  expect(tasks.y+tasks.height).toBeLessThan(shortcuts.y+5);
  expect(classes.height).toBeGreaterThan(300);
  await expect(page.locator('.desktop-shortcuts-column .ntu-hub')).toBeVisible();
  await expect(page.locator('.desktop-shortcuts-column .hub-stats')).toBeVisible();
  await page.locator('#todoInput').evaluate(input => input.blur());
  await page.keyboard.press('5');
  await expect(page.locator('#selectedDay')).toHaveText('Friday in bloom');
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#quickAccessRow .ntu-hub')).toBeVisible();
  await expect(page.locator('#quickAccessRow .hub-stats')).toBeVisible();
  await page.setViewportSize(testInfo.project.use.viewport);
  await expect(page.locator('.desktop-shortcuts-column .ntu-hub')).toBeVisible();
 } else {
  await expect(page.locator('#quickAccessRow .ntu-hub')).toBeVisible();
  await expect(page.locator('#quickAccessRow .hub-stats')).toBeVisible();
 }
 const overflows=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);
 expect(overflows).toBe(false);
 expect(errors).toEqual([]);
});


test('Garden polish has stacked COOL dates, colorful lessons and no clipped day tiles', async ({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/functions/v1/ntu-schedule-api**',route=>{
  const kind=new URL(route.request().url()).searchParams.get('route');
  if(kind!=='cool-calendar') return route.fallback();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({events:[
   {id:'garden-regression-1',date:'2026-12-11',dueAt:'2026-12-11T20:00:00+08:00',
    title:'Reflection on week 15',course:'Global Health',url:'https://cool.ntu.edu.tw/',allDay:false}
  ]})});
 });
 await page.goto('/?pair=begum');
 await expect(page.locator('.hero #nextClass')).toBeVisible();
 await expect(page.locator('.todo-heading-row .honey-jar')).toBeVisible();
 await expect(page.locator('.week-actions #placesButton, .week-actions #weekDateJump')).toHaveCount(0);
 await expect(page.locator('#placesButton, #placesDialog')).toHaveCount(0);
 await expect(page.locator('.cool-month').first()).toHaveText('Dec');
 await expect(page.locator('.cool-date strong').first()).toHaveText('11');
 await expect(page.locator('.cool-weekday').first()).toHaveText('Fri');
 await expect(page.locator('.cool-item').first()).toHaveAttribute('style',/--cool-color:\s*#8aae94/);
 await page.locator('[data-day="1"]').click();
 await expect(page.locator('.lesson').first()).toHaveAttribute('style',/--course-color:\s*#d997ae/);
 const positions=await page.evaluate(()=>{
   const box=el=>el.getBoundingClientRect();
   const rail=box(document.querySelector('.day-rail'));
   const tiles=[...document.querySelectorAll('.day-rail .day-tile')];
   const dayOk=tiles.every(el=>{
    const r=box(el),d=box(el.querySelector('.day-date'));
    return r.left>=rail.left-2 && r.right<=rail.right+2 && r.top>=rail.top-2 &&
           r.bottom<=rail.bottom+2 && d.top>=r.top-2 && d.bottom<=r.bottom+2;
   });
   const next=box(document.querySelector('#nextClass')),hero=box(document.querySelector('.hero'));
   const nextOk=next.top>=hero.top-2 && next.bottom<=hero.bottom+2;
   const date=box(document.querySelector('.cool-date')),copy=box(document.querySelector('.cool-copy'));
   return {dayOk,nextOk,dateOk:date.right<=copy.left+3,
     horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2,
     layout:[rail.width,hero.height,next.width]};
 });
 expect(positions.dayOk).toBe(true);
 expect(positions.nextOk).toBe(true);
 expect(positions.dateOk).toBe(true);
 expect(positions.horizontalOverflow).toBe(false);
 expect(errors).toEqual([]);
});


test('Thursday courses remain readable, inside their cards, and need no schedule scrolling', async ({page})=>{
 await page.goto('/?pair=begum');
 // Choose a regular Thursday explicitly; the current week can contain one-time Chatterbox lessons.
 await page.locator('#weekDateJump').fill('2026-10-08');
 await page.locator('[data-day="4"]').click();
 await expect(page.locator('.lesson')).toHaveCount(3);
 const layout=await page.evaluate(()=>{
  const list=document.querySelector('#scheduleList');
  const panel=document.querySelector('.classes-panel');
  const cardEls=[...list.querySelectorAll('.lesson')];
  const bounds=e=>e.getBoundingClientRect();
  const panelBox=bounds(panel),listBox=bounds(list);
  return {
    overflowY:getComputedStyle(list).overflowY,
    hasInternalScroll:list.scrollHeight>list.clientHeight+3,
    lastCardVisible:bounds(cardEls.at(-1)).bottom<=panelBox.bottom-20,
    cardsNotClipped:cardEls.every(e=>{
      const b=bounds(e),t=bounds(e.querySelector('.time-block')),copy=bounds(e.querySelector('.lesson-card'));
      return b.left>=listBox.left-3 && b.right<=listBox.right+3 &&
             t.right<=copy.left+3 && copy.right<=b.right+3 &&
             copy.top>=b.top-3 && copy.bottom<=b.bottom+3;
    }),
    pseudoRemoved:getComputedStyle(cardEls[0].querySelector('.lesson-card'),'::before').content==='none',
    grassRemoved:getComputedStyle(document.querySelector('.garden'),'::after').content==='none'
  };
 });
 expect(layout.overflowY).toBe('visible');
 expect(layout.hasInternalScroll).toBe(false);
 expect(layout.lastCardVisible).toBe(true);
 expect(layout.cardsNotClipped).toBe(true);
 expect(layout.pseudoRemoved).toBe(true);
 expect(layout.grassRemoved).toBe(true);
});


test('COOL deadlines and honey-do tasks scroll independently while class cards stay visible', async ({page})=>{
 await page.goto('/?pair=begum');
 // Choose a regular Thursday explicitly; the current week can contain one-time Chatterbox lessons.
 await page.locator('#weekDateJump').fill('2026-10-08');
 await page.locator('[data-day="4"]').click();
 await expect(page.locator('.lesson')).toHaveCount(3);
 const result=await page.evaluate(()=>{
   const deadlines=document.querySelector('#coolDeadlines');
   const todos=document.querySelector('#todoList');
   const classes=document.querySelector('#scheduleList');
   for(let i=0;i<24;i++){
     const item=document.createElement('article');
     item.className='cool-item';
     item.textContent='Test deadline '+i;
     item.style.minHeight='70px';
     deadlines.append(item);
     const task=document.createElement('article');
     task.className='todo-item';
     task.textContent='Test task '+i;
     task.style.minHeight='38px';
     todos.append(task);
   }
   const bounds=element=>element.getBoundingClientRect();
   const headers={
     cool:bounds(document.querySelector('.cool-heading-row')).top,
     todo:bounds(document.querySelector('.todo-heading-row')).top,
     coolFooter:bounds(document.querySelector('.cool-meta')).bottom,
     todoForm:bounds(document.querySelector('.todo-form')).bottom
   };
   const coolOverflow=getComputedStyle(deadlines).overflowY;
   const todoOverflow=getComputedStyle(todos).overflowY;
   deadlines.scrollTop=deadlines.scrollHeight;
   todos.scrollTop=todos.scrollHeight;
   const after={
     cool:bounds(document.querySelector('.cool-heading-row')).top,
     todo:bounds(document.querySelector('.todo-heading-row')).top,
     coolFooter:bounds(document.querySelector('.cool-meta')).bottom,
     todoForm:bounds(document.querySelector('.todo-form')).bottom
   };
   return {
     coolOverflow,todoOverflow,
     coolScrollable:deadlines.scrollHeight>deadlines.clientHeight+8 && deadlines.scrollTop>0,
     todoScrollable:todos.scrollHeight>todos.clientHeight+8 && todos.scrollTop>0,
     pinnedHeaders:Math.abs(headers.cool-after.cool)<2&&Math.abs(headers.todo-after.todo)<2,
     pinnedFooters:Math.abs(headers.coolFooter-after.coolFooter)<2&&Math.abs(headers.todoForm-after.todoForm)<2,
     classesOverflow:getComputedStyle(classes).overflowY,
     classesScrollbar:classes.scrollHeight>classes.clientHeight+3
   };
 });
 expect(result.coolOverflow).toBe('auto');
 expect(result.todoOverflow).toBe('auto');
 expect(result.coolScrollable).toBe(true);
 expect(result.todoScrollable).toBe(true);
 expect(result.pinnedHeaders).toBe(true);
 expect(result.pinnedFooters).toBe(true);
 expect(result.classesOverflow).toBe('visible');
 expect(result.classesScrollbar).toBe(false);
});


test('desktop garden and all class cards fit the viewport',async ({page},testInfo)=>{
 if(!testInfo.project.name.startsWith('mac')) return;
 await page.goto('/?pair=begum');
 for(const day of [1,2,3,4,5,6]){
  await page.locator('[data-day="'+day+'"]').click();
  const result=await page.evaluate(()=>{
   const box=e=>e.getBoundingClientRect();
   const panel=document.querySelector('.classes-panel');
   const list=document.querySelector('#scheduleList');
   const cards=[...list.querySelectorAll('.lesson')];
   const outer=document.querySelector('.garden');
   const p=box(panel),o=box(outer);
   return {
     outerFits:o.top>=-2&&o.bottom<=innerHeight+2,
     noPageScroll:document.documentElement.scrollHeight<=innerHeight+2,
     allCardsFit:cards.every(c=>box(c).bottom<=p.bottom-18&&box(c).top>=p.top-2),
     noScheduleScroll:list.scrollHeight<=list.clientHeight+3,
     noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth+2
   };
  });
  expect(result.outerFits,'day '+day+' viewport fit').toBe(true);
  expect(result.noPageScroll,'day '+day+' page scroll').toBe(true);
  expect(result.allCardsFit,'day '+day+' cards').toBe(true);
  expect(result.noScheduleScroll,'day '+day+' schedule scroll').toBe(true);
  expect(result.noHorizontalOverflow,'day '+day+' width').toBe(true);
 }
});


test('Up Next reads as inline garden typography with a subtle divider',async ({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?pair=begum');
 await expect(page.locator('.hero-info .hero-copy h1')).toContainText('Every day, a little');
 await expect(page.locator('.hero-info > #nextClass .next-label')).toBeVisible();
 await expect(page.locator('.hero-info > #nextClass .next-title')).toBeVisible();
 const state=await page.evaluate(()=>{
  const box=el=>el.getBoundingClientRect();
  const hero=box(document.querySelector('.hero'));
  const heading=box(document.querySelector('.hero-copy'));
  const nextEl=document.querySelector('.hero-info > #nextClass');
  const next=box(nextEl);
  const css=getComputedStyle(nextEl);
  return {
    bar:parseFloat(css.borderLeftWidth),
    translucent:css.backgroundColor==='rgba(0, 0, 0, 0)',
    noCard:css.boxShadow==='none',
    contained:next.top>=hero.top-2 && next.bottom<=hero.bottom+2 &&
              next.left>=hero.left-2 && next.right<=hero.right+2,
    beside:next.left>=heading.right-2 && Math.abs(next.top-heading.top)<50,
    below:next.top>=heading.bottom-2,
    overflow:document.documentElement.scrollWidth>innerWidth+2,
    pageScroll:document.documentElement.scrollHeight>innerHeight+2
  };
 });
 expect(state.bar).toBeGreaterThanOrEqual(1);
 expect(state.bar).toBeLessThanOrEqual(3);
 expect(state.translucent).toBe(true);
 expect(state.noCard).toBe(true);
 expect(state.contained).toBe(true);
 expect(state.overflow).toBe(false);
 if(testInfo.project.name.startsWith('mac')){
   expect(state.beside).toBe(true);
   expect(state.pageScroll).toBe(false);
 } else {
   expect(state.below).toBe(true);
 }
 expect(errors).toEqual([]);
});
test('TOC is listed on both days with $800 in place of a location', async ({ page }) => {
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?pair=begum');

  for (const [day, start, end] of [['4', '18:30', '19:20'], ['5', '10:20', '12:10']]){
    await page.locator('[data-day="' + day + '"]').click();
    const toc = page.locator('.lesson').filter({has:page.locator('.lesson-title', {hasText:'TOC'})});
    await expect(toc).toHaveCount(1);
    await expect(toc.locator('.time-start')).toHaveText(start);
    await expect(toc.locator('.time-end')).toHaveText(end);
    await expect(toc.locator('.lesson-meta')).toHaveText('$800');
    await toc.click();
    await expect(page.locator('#dialogLocationLabel')).toHaveText('Fee');
    await expect(page.locator('#dialogLocation')).toHaveText('$800');
    await expect(page.locator('#mapButton')).toBeHidden();
    await page.locator('#closeDialog').click();
  }
  expect(errors).toEqual([]);
});


test('checked Chatterbox dates appear only in their exact weeks without yellow highlighting', async ({ page }) => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/?pair=begum');

  const sessions=[
    ['2026-09-29','12:20','13:10'],
    ['2026-10-07','12:20','13:10'],
    ['2026-10-14','18:30','19:30'],
    ['2026-10-15','12:20','13:10'],
    ['2026-11-06','12:20','13:10'],
    ['2026-11-13','12:20','13:10'],
    ['2026-11-17','12:20','13:10'],
    ['2026-11-26','12:20','13:10'],
    ['2026-12-02','12:20','13:10'],
    ['2026-12-11','12:20','13:10']
  ];
  for(const [date,start,end] of sessions){
    await page.locator('#weekDateJump').fill(date);
    await expect(page.locator('#weekDateJump')).toHaveValue(date);
    const chatterbox=page.locator('.lesson').filter({has:page.locator('.lesson-title', {hasText:'Chatterbox Coffee'})});
    await expect(chatterbox).toHaveCount(1);
    await expect(chatterbox.locator('.time-start')).toHaveText(start);
    await expect(chatterbox.locator('.time-end')).toHaveText(end);
    await expect(chatterbox).not.toHaveClass(/chatterbox-highlight/);
    if(date==='2026-10-14'){
      await chatterbox.click();
      await expect(page.locator('#dialogTitle')).toHaveText('Chatterbox Coffee');
      await expect(page.locator('#dialogLocationLabel')).toHaveText('Session date');
      await expect(page.locator('#mapButton')).toBeHidden();
      await page.locator('#closeDialog').click();
    }
  }
  for(const date of ['2026-09-21','2026-10-19','2026-11-09','2026-12-07']){
    await page.locator('#weekDateJump').fill(date);
    await expect(page.locator('.lesson-title', {hasText:'Chatterbox Coffee'})).toHaveCount(0);
  }

  await page.locator('#weekDateJump').fill('2026-10-14');
  await expect(page.locator('#selectedDate')).toContainText('Oct 14, 2026');
  await page.locator('#previousWeek').click();
  await expect(page.locator('#selectedDate')).toContainText('Oct 7, 2026');
  await page.locator('#nextWeek').click();
  await expect(page.locator('#selectedDate')).toContainText('Oct 14, 2026');
  expect(errors).toEqual([]);
});

test('mobile garden aligns Taipei time with the university label', async ({page}) => {
  for (const width of [320,375,390,430,480]) {
    await page.setViewportSize({width, height:844});
    await page.goto('/?pair=begum');
    const result = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const clock = rect('#desktopClock');
      const eyebrow = rect('.hero-copy .eyebrow');
      const headline = rect('.hero-copy h1');
      const header = rect('.garden .hero');
      const padding = parseFloat(getComputedStyle(document.querySelector('.hero-copy .eyebrow')).paddingRight);
      return {
        sameLine: Math.abs(clock.top-eyebrow.top) < 5,
        reservedForClock: clock.left >= eyebrow.right - padding - 3,
        titleClear: eyebrow.bottom <= headline.top + 1,
        headlineFits: headline.right <= innerWidth + 2,
        headerFits: headline.bottom <= header.bottom,
        noSemester: !document.querySelector('.hero-copy .eyebrow').textContent.includes('FALL 2026'),
        abbreviatedClock: getComputedStyle(document.querySelector('#desktopClock > span')).display==='none',
        noFloatingEmoji: getComputedStyle(document.querySelector('.garden-floral-corners')).display === 'none',
        noFooterDingbat: !document.querySelector('.foot').textContent.includes('✿'),
        clockPosition: getComputedStyle(document.querySelector('#desktopClock')).position
      };
    });
    for(const [key,value] of Object.entries(result)){
      if(key==='clockPosition')expect(value, width+'px: '+key).toBe('absolute');
      else expect(value, width+'px: '+key).toBe(true);
    }
  }
});

test('mobile Up Next course titles wrap without clipping', async ({page}) => {
  for (const width of [320,375,390,610,664,820]) {
    await page.setViewportSize({width,height:844});
    await page.goto('/?pair=begum');
    const result = await page.evaluate(() => {
      const title = document.querySelector('#nextClass .next-title');
      title.textContent = 'Exploring Taiwan: Women and Taiwanese Society, Contemporary Perspectives';
      const titleRect = title.getBoundingClientRect();
      const next = document.querySelector('#nextClass');
      const countdown = next.querySelector('.next-countdown');
      const sectionRect = next.getBoundingClientRect();
      const countdownRect = countdown?.getBoundingClientRect();
      const heroRect = document.querySelector('.garden .hero').getBoundingClientRect();
      const weekbarRect = document.querySelector('.weekbar').getBoundingClientRect();
      const style = getComputedStyle(title);
      return {
        textFullyFits: title.scrollHeight <= title.clientHeight + 2,
        notClamped: style.webkitLineClamp === 'none',
        visibleOverflow: style.overflow === 'visible',
        withinHeader: titleRect.top >= heroRect.top && titleRect.bottom <= heroRect.bottom,
        withinViewport: titleRect.left >= 0 && titleRect.right <= innerWidth,
        countdownExists: !!countdownRect,
        countdownFullyInsideHero: !!countdownRect &&
          countdownRect.bottom + 4 <= heroRect.bottom,
        countdownFullyInsideSection: !!countdownRect &&
          countdownRect.bottom <= sectionRect.bottom + 1,
        titleNotOverCountdown: !!countdownRect &&
          titleRect.bottom <= countdownRect.top + 1,
        heroNotBehindWeekbar: heroRect.bottom <= weekbarRect.top + 1
      };
    });
    expect(result.textFullyFits, 'full class title at width ' + width).toBe(true);
    expect(result.notClamped, 'line clamp at width ' + width).toBe(true);
    expect(result.visibleOverflow, 'title overflow at width ' + width).toBe(true);
    expect(result.withinHeader, 'title outside header at width ' + width).toBe(true);
    expect(result.withinViewport, 'title outside screen at width ' + width).toBe(true);
    expect(result.countdownExists, 'missing countdown at width ' + width).toBe(true);
    expect(result.countdownFullyInsideHero, 'countdown clipped by header at width ' + width).toBe(true);
    expect(result.countdownFullyInsideSection, 'countdown clipped by Up Next section at width ' + width).toBe(true);
    expect(result.titleNotOverCountdown, 'title overlaps countdown at width ' + width).toBe(true);
    expect(result.heroNotBehindWeekbar, 'header overlaps week bar at width ' + width).toBe(true);
  }
});

test('desktop Up Next does not clip long titles or the countdown', async ({page}) => {
  for (const [width,height] of [[1440,900],[1180,780],[1000,760],[960,680]]) {
    await page.setViewportSize({width,height});
    await page.goto('/?pair=begum');
    const result=await page.evaluate(()=>{
      const next=document.querySelector('#nextClass');
      const copy=next.querySelector('.next-copy');
      const title=next.querySelector('.next-title');
      title.textContent='Exploring Taiwan: Women and Taiwanese Society';
      let countdown=next.querySelector('.next-countdown');
      if(!countdown){
        countdown=document.createElement('p');
        countdown.className='next-countdown';
        copy.append(countdown);
      }
      countdown.textContent='in 27 hr 42 min';
      const rect=e=>e.getBoundingClientRect();
      const t=rect(title),d=rect(countdown),n=rect(next),h=rect(document.querySelector('.hero'));
      const titleStyle=getComputedStyle(title),countdownStyle=getComputedStyle(countdown);
      return {
        titleDisplay:titleStyle.display,
        titleOverflow:titleStyle.overflow,
        titleLineClamp:titleStyle.webkitLineClamp,
        titleFullyLaidOut:title.scrollHeight<=title.clientHeight+2,
        titleClearOfCountdown:t.bottom<=d.top+1,
        countdownWithinNext:d.bottom<=n.bottom+1,
        countdownWithinHero:d.bottom<=h.bottom-2,
        titleWithinHero:t.left>=h.left-2&&t.right<=h.right+2,
        countdownVisible:countdownStyle.display!=='none'&&countdownStyle.visibility==='visible'
      };
    });
    expect(result.titleDisplay,'title display at '+width).toBe('block');
    expect(result.titleOverflow,'title overflow at '+width).toBe('visible');
    expect(result.titleLineClamp,'title clamp at '+width).toBe('none');
    expect(result.titleFullyLaidOut,'title clipped at '+width).toBe(true);
    expect(result.titleClearOfCountdown,'title overlaps countdown at '+width).toBe(true);
    expect(result.countdownWithinNext,'countdown outside next panel at '+width).toBe(true);
    expect(result.countdownWithinHero,'countdown outside hero at '+width).toBe(true);
    expect(result.titleWithinHero,'title outside hero at '+width).toBe(true);
    expect(result.countdownVisible,'countdown hidden at '+width).toBe(true);
  }
});


test('Garden phone shortcuts have no emoji, no dead space and usable buttons',async({page})=>{
 await page.goto('/?pair=begum');
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  await expect(page.locator('.links-panel .side-heading > span')).toHaveCount(0);
  await expect(page.locator('#quickAccessRow .hub-stats')).toBeVisible();
  const buttons=page.locator('#quickAccessRow .ntu-hub-grid .hub-app');
  await expect(buttons).toHaveCount(3);
  const metrics=await page.evaluate(()=>{
   const rect=el=>el.getBoundingClientRect();
   const panel=rect(document.querySelector('.links-panel'));
   const buttons=[...document.querySelectorAll('#quickAccessRow .ntu-hub-grid .hub-app')].map(rect);
   return {
    blankSpace:panel.bottom-Math.max(...buttons.map(r=>r.bottom)),
    minimumHeight:getComputedStyle(document.querySelector('.links-panel')).minHeight,
    buttonsOnOneRow:Math.max(...buttons.map(r=>r.top))-Math.min(...buttons.map(r=>r.top))<2,
    buttonsInside:buttons.every(r=>r.left>=panel.left&&r.right<=panel.right),
    overflow:document.documentElement.scrollWidth>innerWidth+2
   };
  });
  expect(metrics.minimumHeight).toBe('0px');
  expect(metrics.blankSpace).toBeLessThan(30);
  expect(metrics.buttonsOnOneRow).toBe(true);
  expect(metrics.buttonsInside).toBe(true);
  expect(metrics.overflow).toBe(false);
 }
});


test('Mobile hero positions the clock inline and pins subdued scenery flush right',async({page},testInfo)=>{
 if(testInfo.project.name==='mac-1440'||testInfo.project.name==='mac-1000')return;
 await page.goto('/?pair=begum');
 for(const width of [320,390,430,480]){
   await page.setViewportSize({width,height:844});
   const result=await page.evaluate(()=>{
     const rect=selector=>document.querySelector(selector)?.getBoundingClientRect();
     const hero=rect('.garden .hero');
     const clock=rect('.garden #desktopClock');
     const eyebrow=rect('.garden .hero .eyebrow');
     const copy=rect('.garden .hero .hero-copy');
     const upnext=rect('.garden .hero .hero-next-class');
     const art=rect('.garden .hero .hero-art');
     const svg=rect('.garden .hero .hero-art>svg');
     const heading=rect('.garden .hero h1');
     return {
       clockInline:Math.abs(clock.top-eyebrow.top)<5,
       copyAboveUpnext:copy.bottom<=upnext.top+1,
       upnextAboveArt:upnext.bottom<=art.top+1,
       artAtBottom:Math.abs(art.bottom-hero.bottom)<4,
       artIsInFlow:getComputedStyle(document.querySelector('.garden .hero .hero-art')).position==='relative',
       alignedLeft:Math.abs(copy.left-upnext.left)<3,
       artFullBleed:Math.abs(art.left-hero.left)<3&&Math.abs(art.right-hero.right)<3,
       svgAtRight:Math.abs(svg.right-hero.right)<3,
       artSmaller:art.height<=98,
       artFainter:parseFloat(getComputedStyle(document.querySelector('.garden .hero .hero-art')).opacity)<=.75,
       headingInBounds:heading.right<=hero.right+1,
       noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth+2
     };
   });
   for(const [key,value] of Object.entries(result))expect(value, width+'px: '+key).toBe(true);
 }
});


test('Tablet and resized desktop keep the previous responsive header instead of phone composition',async({page},testInfo)=>{
 if(testInfo.project.name==='mac-1440'||testInfo.project.name==='mac-1000')return;
 await page.goto('/?pair=begum');
 for(const width of [481,540,610,768,900]){
   await page.setViewportSize({width,height:844});
   const metrics=await page.evaluate(()=>{
     const hero=document.querySelector('.garden .hero');
     const clock=document.querySelector('#desktopClock');
     const clockDate=document.querySelector('#desktopClock > span');
     const art=document.querySelector('.garden .hero-art');
     return {
       heroLayout:getComputedStyle(hero).display,
       sceneryLayout:getComputedStyle(art).position,
       clockDateVisible:getComputedStyle(clockDate).display!=='none',
       phoneGridActive:getComputedStyle(hero).gridTemplateAreas.includes('"scenery"'),
       viewportFits:document.documentElement.scrollWidth<=innerWidth+2
     };
   });
   expect(metrics.heroLayout,width+'px retains pre-phone header').not.toBe('grid');
   expect(metrics.sceneryLayout,width+'px retains old artwork placement').toBe('absolute');
   expect(metrics.clockDateVisible,width+'px retains full clock').toBe(true);
   expect(metrics.phoneGridActive,width+'px no phone grid').toBe(false);
   expect(metrics.viewportFits,width+'px no horizontal overflow').toBe(true);
 }
});
