import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const tasks = [];
  await page.route('**/functions/v1/ntu-schedule-api**', route => {
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
 await expect(page.locator('#placesButton')).toBeVisible();
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
