import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../../sites/eren/skeuo-runtime.js', import.meta.url), 'utf8');
const schedule = runtime.slice(runtime.indexOf('/* Schedule interval oscilloscope.'), runtime.lastIndexOf("if ('serviceWorker' in navigator)"));
const audio = readFileSync(new URL('../../sites/eren/pc-audio-scope.js', import.meta.url), 'utf8');

async function mount(page, reducedMotion = false) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.setContent(`<div id="scheduleScope" role="button" tabindex="0">
    <span id="scheduleScopeLabel">ΔT / SCHED</span><b id="scheduleScopeValue">--</b>
    <svg><path id="scheduleScopeTrace" d="M0 21H200"/></svg>
    <span id="scheduleScopeMode">NEXT START</span><span id="scheduleScopeHint">λ ∝ ΔT</span>
  </div>`);
  await page.evaluate(() => {
    window.getNextClass = () => ({ state: 'Next', startAt: new Date(Date.now() + 1800000) });
    const NativeContext = window.AudioContext;
    window.contexts = [];
    window.AudioContext = class extends NativeContext {
      constructor() { super(); window.contexts.push(this); }
      createMediaStreamSource(stream) {
        if (window.failSetup) throw new Error('Test setup failure');
        return super.createMediaStreamSource(stream);
      }
    };
    window.captureCalls = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getDisplayMedia: () => {
        window.captureCalls++;
        return new Promise((resolve, reject) => {
          window.resolveCapture = resolve;
          window.rejectCapture = reject;
        });
      }
    } });
    window.provideCapture = async (includeAudio = true) => {
      // Synthetic audio stays in memory; no speaker or system capture is used.
      const producer = new NativeContext();
      const oscillator = producer.createOscillator();
      const destination = producer.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      await producer.resume();
      window.producer = producer;
      const canvas = document.createElement('canvas');
      canvas.getContext('2d').fillRect(0, 0, 20, 20);
      const video = canvas.captureStream(1).getVideoTracks()[0];
      const tracks = includeAudio ? [...destination.stream.getAudioTracks(), video] : [video];
      window.pickedTracks = tracks;
      window.resolveCapture(new MediaStream(tracks));
    };
  });
  await page.addScriptTag({ content: schedule });
  await page.addScriptTag({ content: audio });
  return errors;
}

test('schedule initializes without a DOM API error', async ({ page }) => {
  const errors = await mount(page);
  await expect(page.locator('#scheduleScopeMode')).toHaveText('NEXT START');
  await expect(page.locator('#scheduleScopeValue')).toHaveText('30m');
  expect(errors).toEqual([]);
});

test('pending and live capture keep control of the scope until stopped', async ({ page }) => {
  const errors = await mount(page);
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await scope.click();
  await page.evaluate(() => { refreshScheduleScopeMeta(); drawScheduleScope(2000); });
  expect(await page.evaluate(() => window.captureCalls)).toBe(1);
  await expect(page.locator('#scheduleScopeMode')).toHaveText('CHOOSE OUTPUT');
  await page.evaluate(() => window.provideCapture());
  await expect(scope).toHaveClass(/pc-audio-active/);
  const path = await page.locator('#scheduleScopeTrace').getAttribute('d');
  await expect.poll(() => page.locator('#scheduleScopeTrace').getAttribute('d')).not.toBe(path);
  await page.evaluate(() => { refreshScheduleScopeMeta(); drawScheduleScope(3000); });
  await expect(page.locator('#scheduleScopeValue')).toHaveText('LIVE');
  expect(await page.evaluate(() => pickedTracks.every(t => t.readyState === 'live'))).toBe(true);
  await scope.click();
  await expect(scope).not.toHaveClass(/pc-audio-active/);
  await expect(page.locator('#scheduleScopeLabel')).toHaveText('ΔT / SCHED');
  await expect(page.locator('#scheduleScopeMode')).toHaveText('NEXT START');
  expect(await page.evaluate(() => pickedTracks.every(t => t.readyState === 'ended'))).toBe(true);
  expect(errors).toEqual([]);
});

test('no-audio and cancelled capture remain visible and allow retry', async ({ page }) => {
  const errors = await mount(page);
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await page.evaluate(() => window.provideCapture(false));
  await expect(page.locator('#scheduleScopeMode')).toHaveText('NO AUDIO TRACK');
  await page.evaluate(() => { refreshScheduleScopeMeta(); drawScheduleScope(2000); });
  await expect(page.locator('#scheduleScopeMode')).toHaveText('NO AUDIO TRACK');
  expect(await page.evaluate(() => pickedTracks.every(t => t.readyState === 'ended'))).toBe(true);
  await scope.press('Enter');
  await page.evaluate(() => rejectCapture(new DOMException('Cancelled', 'NotAllowedError')));
  await expect(page.locator('#scheduleScopeMode')).toHaveText('CANCELLED');
  await scope.click();
  await page.evaluate(() => window.provideCapture());
  await expect(scope).toHaveClass(/pc-audio-active/);
  expect(errors).toEqual([]);
});

for (const kind of ['audio', 'video']) {
  test(`${kind} track ending restores schedule mode`, async ({ page }) => {
    const errors = await mount(page);
    await page.locator('#scheduleScope').click();
    await page.evaluate(() => window.provideCapture());
    await expect(page.locator('#scheduleScope')).toHaveClass(/pc-audio-active/);
    await page.evaluate(kind => {
      const track = pickedTracks.find(t => t.kind === kind);
      track.stop();
      track.dispatchEvent(new Event('ended'));
    }, kind);
    await expect(page.locator('#scheduleScopeLabel')).toHaveText('ΔT / SCHED');
    await expect(page.locator('#scheduleScopeMode')).toHaveText('NEXT START');
    expect(errors).toEqual([]);
  });
}

test('setup failures release resources and retry successfully', async ({ page }) => {
  const errors = await mount(page);
  await page.evaluate(() => { window.failSetup = true; });
  await page.locator('#scheduleScope').click();
  await page.evaluate(() => window.provideCapture());
  await expect(page.locator('#scheduleScopeMode')).toHaveText('CAPTURE ERROR');
  await expect.poll(() => page.evaluate(() => contexts[0].state)).toBe('closed');
  expect(await page.evaluate(() => pickedTracks.every(t => t.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => { window.failSetup = false; });
  await page.locator('#scheduleScope').click();
  await page.evaluate(() => window.provideCapture());
  await expect(page.locator('#scheduleScope')).toHaveClass(/pc-audio-active/);
  expect(errors).toEqual([]);
});

test('phase stays continuous as urgency changes and trace reaches its edge', async ({ page }) => {
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
    return { delta: after - before, resumeDelta: scheduleScopePhase - after,
      path: scheduleScopeTrace.getAttribute('d') };
  });
  expect(result.delta).toBeCloseTo(0.297, 8);
  expect(result.resumeDelta).toBeCloseTo(0.495, 8);
  expect(result.path).toMatch(/L200\.0 [-\d.]+$/);
  expect(result.path).not.toContain('NaN');
  expect(errors).toEqual([]);
});

test('reduced motion keeps schedule phase still', async ({ page }) => {
  const errors = await mount(page, true);
  const phases = await page.evaluate(() => {
    const before = scheduleScopePhase;
    drawScheduleScope(1000);
    drawScheduleScope(1060);
    return [before, scheduleScopePhase];
  });
  expect(phases).toEqual([0, 0]);
  expect(errors).toEqual([]);
});
