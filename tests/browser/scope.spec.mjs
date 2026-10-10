import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../../sites/eren/skeuo-runtime.js', import.meta.url), 'utf8');
const schedule = runtime.slice(
  runtime.indexOf('/* Schedule interval oscilloscope.'),
  runtime.lastIndexOf("if ('serviceWorker' in navigator)")
);
const html = readFileSync(new URL('../../sites/eren/skeuo-demo.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../sites/eren/sw.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../../sites/eren/scope-audio-bridge.js', import.meta.url), 'utf8');

async function mount(page, reducedMotion = false) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.setContent(`<div class="schedule-scope" id="scheduleScope" role="group" aria-label="Schedule interval monitor">
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

test('oscilloscope has separate opt-in AUX controls and never captures browser audio', async ({ page }) => {
  const errors = await mount(page);
  const scope = page.locator('#scheduleScope');
  await expect(scope).toHaveAttribute('role', 'group');
  expect(html).toContain('id="scopeAudioToggle"');
  expect(html).toContain('id="scopeAudioDialog"');
  expect(html).toContain('id="scopeAudioDisconnect"');
  await scope.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => captureCalls)).toBe(0);
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

test('companion waveform switches on with data, and returns to schedule on disconnect', async ({ page }) => {
  const errors = await mount(page, true);
  const scope = page.locator('#scheduleScope');
  const result = await page.evaluate(() => {
    const quiet = { rms: 0, pitch: 0, bins: new Array(64).fill(0) };
    const music = { rms: .8, pitch: .4, bins: new Array(64).fill(.75) };
    let current = music;
    window.NTUScopeAudio = { read: () => current };
    refreshScheduleScopeMeta();
    drawScheduleScope(500);
    const live = { mode: scheduleScopeMode.textContent, label: scheduleScope.querySelector('#scheduleScopeLabel').textContent, path: scheduleScopeTrace.getAttribute('d') };
    current = quiet;
    drawScheduleScope(600);
    const silence = scheduleScopeTrace.getAttribute('d');
    current = null;
    refreshScheduleScopeMeta();
    drawScheduleScope(700);
    return { live, silence, fallbackMode: scheduleScopeMode.textContent, fallbackLabel: scheduleScope.querySelector('#scheduleScopeLabel').textContent, fallbackPath: scheduleScopeTrace.getAttribute('d') };
  });
  expect(result.live.mode).toBe('SYSTEM AUDIO');
  expect(result.live.label).toBe('SIGNAL / PC');
  expect(result.live.path).toMatch(/^M0\.0 /);
  expect(result.live.path).not.toContain('NaN');
  expect(result.silence).toMatch(/M0\.0 21\.00/);
  expect(result.silence).not.toContain('NaN');
  expect(result.fallbackMode).toBe('NEXT START');
  expect(result.fallbackLabel).toBe('ΔT / SCHED');
  expect(result.fallbackPath).not.toBe(result.silence);
  expect(errors).toEqual([]);
});

test('local pairing requires a key, accepts only measured envelopes, and disconnects cleanly', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent(`<button id="scopeAudioToggle">AUX</button>
  <dialog id="scopeAudioDialog"><button id="scopeAudioClose">X</button>
  <form id="scopeAudioForm"><input id="scopeAudioKey"><p id="scopeAudioStatus"></p><button type="submit">CONNECT</button></form>
  <button id="scopeAudioDisconnect">DISCONNECT</button></dialog>`);
  await page.evaluate(() => {
    class FakeSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      static last = null;
      constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; FakeSocket.last = this; }
      addEventListener(name, cb) { (this.listeners[name] ??= []).push(cb); }
      dispatch(name, payload = {}) { for (const cb of this.listeners[name] || []) cb(payload); }
      close() { this.readyState = 3; this.dispatch('close', { code: 1000 }); }
    }
    window.WebSocket = FakeSocket;
    window.FakeSocket = FakeSocket;
  });
  await page.addScriptTag({ content: bridge });
  await page.locator('#scopeAudioToggle').click();
  await page.locator('#scopeAudioKey').fill('bad key');
  await page.locator('#scopeAudioForm button').click();
  await expect(page.locator('#scopeAudioStatus')).toContainText('32-character');
  const key = '0123456789ABCDEF0123456789ABCDEF';
  await page.locator('#scopeAudioKey').fill(key);
  await page.locator('#scopeAudioForm button').click();
  const result = await page.evaluate(() => {
    const socket = window.FakeSocket.last;
    const url = socket.url;
    socket.readyState = 1;
    socket.dispatch('open');
    socket.dispatch('message', { data: JSON.stringify({ type: 'levels', version: 1, rms: .5, pitch: .2, bins: new Array(64).fill(.4) }) });
    const fresh = window.NTUScopeAudio.read();
    socket.dispatch('message', { data: JSON.stringify({ type: 'levels', version: 1, rms: .5, pitch: .2, bins: [1, 2] }) });
    const stillFresh = window.NTUScopeAudio.read();
    return { url, fresh, stillFresh };
  });
  expect(result.url).toBe(`ws://127.0.0.1:43187/stream?key=${key}`);
  expect(result.fresh.bins).toHaveLength(64);
  expect(result.stillFresh.bins).toHaveLength(64);
  await page.locator('#scopeAudioDisconnect').click();
  expect(await page.evaluate(() => window.NTUScopeAudio.read())).toBe(null);
  expect(errors).toEqual([]);
});

test('audio bridge uses localhost only and no browser capture APIs', async () => {
  expect(schedule + bridge).not.toMatch(/getDisplayMedia|getUserMedia|AudioContext|MediaRecorder/);
  expect(bridge).toContain('ws://127.0.0.1:43187');
  expect(html).toContain('scope-audio-bridge.js?v=1');
  expect(html).not.toContain('pc-audio-scope.js');
  expect(sw).toContain("asset('scope-audio-bridge.js?v=1')");
});
