import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../../sites/eren/skeuo-runtime.js', import.meta.url), 'utf8');
const schedule = runtime.slice(
  runtime.indexOf('/* Schedule interval oscilloscope.'),
  runtime.lastIndexOf("if ('serviceWorker' in navigator)")
);
const html = readFileSync(new URL('../../sites/eren/skeuo-demo.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../sites/eren/sw.js', import.meta.url), 'utf8');

async function mount(page, reducedMotion = false) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.setContent(`<div class="schedule-scope" id="scheduleScope" role="img" aria-label="Schedule interval monitor">
    <span id="scheduleScopeLabel">ΔT / SCHED</span>
    <b id="scheduleScopeValue">--</b>
    <svg viewBox="0 0 200 42"><path id="scheduleScopeTrace" d="M0 21H200"/></svg>
    <span id="scheduleScopeMode">NEXT START</span>
    <span id="scheduleScopeHint">λ ∝ ΔT</span>
  </div>`);
  await page.evaluate(() => {
    window.nextScheduleClass = { state: 'Next', startAt: new Date(Date.now() + 30 * 60000) };
    window.getNextClass = () => window.nextScheduleClass;
    window.captureCalls = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: () => { window.captureCalls++; throw Error('Unexpected display capture'); },
        getUserMedia: () => { window.captureCalls++; throw Error('Unexpected microphone capture'); }
      }
    });
  });
  await page.addScriptTag({ content: schedule });
  return errors;
}

test('schedule oscilloscope initializes with next-class countdown', async ({ page }) => {
  const errors = await mount(page);
  await expect(page.locator('#scheduleScopeValue')).toHaveText('30m');
  await expect(page.locator('#scheduleScopeMode')).toHaveText('NEXT START');
  await expect(page.locator('#scheduleScopeLabel')).toHaveText('ΔT / SCHED');
  await expect(page.locator('#scheduleScopeHint')).toHaveText('λ ∝ ΔT');
  expect(errors).toEqual([]);
});

test('schedule oscilloscope is display-only, not an audio-capture control', async ({ page }) => {
  const errors = await mount(page);
  const scope = page.locator('#scheduleScope');
  await expect(scope).toHaveAttribute('role', 'img');
  await expect(scope).not.toHaveAttribute('tabindex');
  await expect(scope).not.toHaveAttribute('aria-pressed');
  await scope.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => captureCalls)).toBe(0);
  await expect(scope).not.toHaveClass(/pc-audio|is-audio/);
  await expect(page.locator('#scheduleScopeMode')).toHaveText('NEXT START');
  expect(errors).toEqual([]);
});

test('live class shows real time until the class ends', async ({ page }) => {
  const errors = await mount(page);
  await page.evaluate(() => {
    window.nextScheduleClass = { state: 'Now', endAt: new Date(Date.now() + 12 * 60000) };
    refreshScheduleScopeMeta();
  });
  await expect(page.locator('#scheduleScopeMode')).toHaveText('LIVE END');
  await expect(page.locator('#scheduleScopeValue')).toHaveText('12m');
  await expect(page.locator('#scheduleScope')).toHaveAttribute('aria-label', /until the current class ends/);
  expect(errors).toEqual([]);
});

test('schedule with no upcoming class falls back to CLEAR', async ({ page }) => {
  const errors = await mount(page);
  await page.evaluate(() => {
    window.nextScheduleClass = null;
    refreshScheduleScopeMeta();
    drawScheduleScope(1000);
  });
  await expect(page.locator('#scheduleScopeMode')).toHaveText('CLEAR');
  await expect(page.locator('#scheduleScopeValue')).toHaveText('--');
  await expect(page.locator('#scheduleScope')).toHaveAttribute('aria-label', /no upcoming classes/);
  expect(errors).toEqual([]);
});

test('wave animates over time and remains a valid SVG path', async ({ page }) => {
  const errors = await mount(page);
  const trace = page.locator('#scheduleScopeTrace');
  const before = await trace.getAttribute('d');
  await expect.poll(() => trace.getAttribute('d'), { timeout: 5000 }).not.toBe(before);
  const after = await trace.getAttribute('d');
  expect(after).toMatch(/^M0\.0 [-\d.]+ L/);
  expect(after).toMatch(/L200\.0 [-\d.]+$/);
  expect(after).not.toMatch(/NaN|Infinity/);
  expect(errors).toEqual([]);
});

test('wave shortens as a schedule boundary gets closer', async ({ page }) => {
  const errors = await mount(page, true);
  const crossings = await page.evaluate(() => {
    const calculate = minutes => {
      scheduleScopeState = { active: true, live: false, minutes };
      drawScheduleScope(0);
      const ys = Array.from(scheduleScopeTrace.getAttribute('d').matchAll(/[ML][\d.]+ ([-\d.]+)/g), m => Number(m[1]) - 21);
      let count = 0;
      for (let i = 1; i < ys.length; i++) {
        if (ys[i - 1] * ys[i] < 0) count++;
      }
      return count;
    };
    return { far: calculate(360), soon: calculate(1) };
  });
  expect(crossings.soon).toBeGreaterThan(crossings.far * 2);
  expect(errors).toEqual([]);
});

test('the wave stays continuous while urgency changes', async ({ page }) => {
  const errors = await mount(page);
  const result = await page.evaluate(() => {
    scheduleScopeState = { active: true, live: false, minutes: 60 };
    scheduleScopeLastTs = 10000000;
    scheduleScopePhase = 7;
    drawScheduleScope(10000060);
    const before = scheduleScopePhase;
    scheduleScopeState.minutes = 0;
    drawScheduleScope(10000120);
    const after = scheduleScopePhase;
    drawScheduleScope(20000120);
    return {
      delta: after - before,
      resumeDelta: scheduleScopePhase - after,
      path: scheduleScopeTrace.getAttribute('d')
    };
  });
  expect(result.delta).toBeCloseTo(0.297, 8);
  expect(result.resumeDelta).toBeCloseTo(0.495, 8);
  expect(result.path).toMatch(/L200\.0 [-\d.]+$/);
  expect(result.path).not.toContain('NaN');
  expect(errors).toEqual([]);
});

test('reduced motion does not advance waveform phase', async ({ page }) => {
  const errors = await mount(page, true);
  const result = await page.evaluate(() => {
    const before = scheduleScopePhase;
    drawScheduleScope(1000);
    drawScheduleScope(1060);
    return [before, scheduleScopePhase];
  });
  expect(result).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('waveform height depends on schedule state alone', async ({ page }) => {
  const errors = await mount(page, true);
  const peaks = await page.evaluate(() => {
    const peak = (active, live) => {
      scheduleScopeState = { active, live, minutes: 60 };
      drawScheduleScope(0);
      const ys = Array.from(scheduleScopeTrace.getAttribute('d').matchAll(/[ML][\d.]+ ([-\d.]+)/g), m => Number(m[1]) - 21);
      return Math.max(...ys.map(Math.abs));
    };
    return { clear: peak(false, false), waiting: peak(true, false), live: peak(true, true) };
  });
  expect(peaks.waiting).toBeGreaterThan(peaks.clear * 3);
  expect(peaks.live).toBeGreaterThan(peaks.waiting);
  expect(errors).toEqual([]);
});

test('oscilloscope uses no browser audio APIs or audio-only PWA assets', async () => {
  expect(schedule).not.toMatch(/getDisplayMedia|getUserMedia|AudioContext|audioLevel|pc-audio/);
  expect(html).not.toContain('pc-audio-scope.js');
  expect(html).not.toMatch(/id="scheduleScope"[^>]*role="button"/);
  expect(html).not.toMatch(/\.schedule-scope\.is-audio|\.schedule-scope:focus-visible/);
  expect(sw).not.toContain('pc-audio-scope.js');
});
