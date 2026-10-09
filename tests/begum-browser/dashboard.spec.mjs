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
    await expect(page.locator('.week-preview')).toHaveCount(6);
    await expect(page.locator('.week-overview')).toBeVisible();
    await expect(page.locator('.desktop-clock')).toBeVisible();
    const rail = await page.locator('.desktop-day-rail').boundingBox();
    const schedule = await page.locator('.schedule-column').boundingBox();
    const tools = await page.locator('.utility-column').boundingBox();
    expect(rail && schedule && tools).toBeTruthy();
    expect(rail.x).toBeLessThan(schedule.x);
    expect(schedule.x).toBeLessThan(tools.x);
    await page.keyboard.press('5');
    await expect(page.locator('#selectedDay')).toHaveText('Friday');
    await page.locator('[data-week-day="3"]').click();
    await expect(page.locator('#selectedDay')).toHaveText('Wednesday');
    await expect(page.locator('.desktop-day-rail .ntu-hub')).toBeVisible();
  } else {
    await expect(page.locator('.week-overview')).toBeHidden();
    await expect(page.locator('.desktop-today')).toBeHidden();
    await expect(page.locator('#quickAccessRow .ntu-hub')).toBeVisible();
  }

  await page.locator('#todoInput').fill('Review Mac schedule');
  await page.locator('#todoForm button[type="submit"]').click();
  await expect(page.locator('.todo-item')).toContainText('Review Mac schedule');
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(hasHorizontalOverflow).toBe(false);
  expect(errors).toEqual([]);
});
