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

test('Begüm schedule works at all target widths without device-transfer tools', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?pair=begum');
  await expect(page.locator('#selectedDay')).toBeVisible();
  await expect(page.locator('#coolDeadlines')).toBeVisible();
  await expect(page.locator('#todoInput')).toBeVisible();
  await expect(page.locator('#ntuHubSection')).toBeVisible();
  await expect(page.locator('.transfer-section')).toHaveCount(0);
  await expect(page.locator('#transferForm')).toHaveCount(0);
  await expect(page.locator('#hanziWidgetSlot')).toHaveCount(0);
  await page.locator('[data-day="2"]').click();
  await expect(page.locator('#selectedDay')).toHaveText('Tuesday');
  await expect(page.locator('.optional-pill')).toBeVisible();
  await page.locator('[data-day="1"]').click();
  await expect(page.locator('.lesson')).toHaveCount(2);
  await page.locator('.lesson').first().click();
  await expect(page.locator('#lessonDialog')).toBeVisible();
  await page.locator('#closeDialog').click();

  if (testInfo.project.name.startsWith('mac')){
    await expect(page.locator('.week-overview,.week-preview')).toHaveCount(0);
    await expect(page.locator('.desktop-clock')).toBeVisible();
    const rail = await page.locator('.desktop-day-rail').boundingBox();
    const schedule = await page.locator('.schedule-column').boundingBox();
    const deadlines = await page.locator('.cool-section').boundingBox();
    const tasks = await page.locator('.todo-section').boundingBox();
    const shortcuts = await page.locator('.desktop-shortcuts-column').boundingBox();
    expect(rail && schedule && deadlines && tasks && shortcuts).toBeTruthy();
    expect(schedule.x + schedule.width).toBeLessThanOrEqual(tasks.x + 3);
    expect(tasks.x + tasks.width).toBeLessThanOrEqual(shortcuts.x + 3);
    expect(Math.abs(schedule.y - deadlines.y)).toBeLessThan(3);
    expect(Math.abs(schedule.y - shortcuts.y)).toBeLessThan(3);
    expect(Math.abs(schedule.y + schedule.height - tasks.y - tasks.height)).toBeLessThan(3);
    expect(schedule.height).toBeGreaterThan(450);
    expect(schedule.width).toBeGreaterThan(330);
    expect(tasks.width).toBeGreaterThan(240);
    expect(tasks.height).toBeGreaterThan(230);
    if (testInfo.project.name === 'mac-1440') {
      expect(rail.x).toBeLessThan(schedule.x);
      expect(Math.abs(rail.y - schedule.y)).toBeLessThan(3);
      expect(schedule.width).toBeGreaterThan(470);
    } else {
      expect(rail.y + rail.height).toBeLessThanOrEqual(schedule.y);
    }
    for (const day of ['1','2','3','4','5','6']) {
      const button = await page.locator('[data-day="' + day + '"]').boundingBox();
      expect(button.height).toBeGreaterThanOrEqual(50);
      expect(button.width).toBeGreaterThan(70);
    }
    const mondayCard = await page.locator('.lesson-card').first().boundingBox();
    expect(mondayCard.height).toBeGreaterThanOrEqual(96);
    await page.keyboard.press('5');
    await expect(page.locator('#selectedDay')).toHaveText('Friday');
    await page.keyboard.press('3');
    await expect(page.locator('#selectedDay')).toHaveText('Wednesday');
    await expect(page.locator('.desktop-shortcuts-column .ntu-hub')).toBeVisible();
    await expect(page.locator('.desktop-shortcuts-column .hub-stats')).toBeVisible();
  } else {
    await expect(page.locator('.week-overview,.week-preview')).toHaveCount(0);
    await expect(page.locator('.desktop-today')).toBeHidden();
    await expect(page.locator('#quickAccessRow .ntu-hub')).toBeVisible();
    await expect(page.locator('#quickAccessRow .hub-stats')).toBeVisible();
  }

  await page.locator('#todoInput').fill('Review Mac schedule');
  await page.locator('#todoForm button[type="submit"]').click();
  await expect(page.locator('.todo-item')).toContainText('Review Mac schedule');
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(hasHorizontalOverflow).toBe(false);
  if (testInfo.project.name.startsWith('mac')) {
    await page.setViewportSize({width:390,height:844});
    await expect(page.locator('#quickAccessRow .ntu-hub')).toBeVisible();
    await expect(page.locator('#quickAccessRow .hub-stats')).toBeVisible();
    await expect(page.locator('.desktop-shortcuts-column')).toBeHidden();
    await page.setViewportSize(testInfo.project.use.viewport);
    await expect(page.locator('.desktop-shortcuts-column .ntu-hub')).toBeVisible();
    await expect(page.locator('.desktop-shortcuts-column .hub-stats')).toBeVisible();
    await expect(page.locator('#todoList')).toContainText('Review Mac schedule');
    await expect(page.locator('#ntuHubSection')).toHaveCount(1);
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
