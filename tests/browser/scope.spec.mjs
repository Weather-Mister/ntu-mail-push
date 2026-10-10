import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

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
    <svg viewBox="0 0 200 42"><path id="scheduleScopeAfterglow" d=""/><path id="scheduleScopeTrace" d="M0 21H200"/></svg>
    <label for="scopeAudioSensitivity">WAVEFORM INTENSITY</label>
    <input type="range" id="scopeAudioSensitivity" min="1" max="5" value="4" />
    <output id="scopeAudioSensitivityValue">WILD</output>
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

test('restored audio scope plots real signed time-domain samples, not a synthetic sine', async ({ page }) => {
  const errors = await mount(page, true);
  const result = await page.evaluate(() => {
    const wave = new Array(128).fill(0);
    wave[0] = -0.5;
    wave[64] = 0.25;
    wave[127] = 0.65;
    let current = { rms: 0.5, pitch: 0, bins: new Array(64).fill(0), wave };
    window.NTUScopeAudio = { read: () => current };
    refreshScheduleScopeMeta();
    scheduleScopeAudioGain = 1;
    drawScheduleScope(300);
    const first = scheduleScopeTrace.getAttribute('d');
    const gainAfterFirst = scheduleScopeAudioGain;

    // Deliberately vary the *old* fabricated pitch and envelope readings.
    // Actual signed audio samples now solely determine waveform shape.
    current = { ...current, pitch: 1, bins: new Array(64).fill(1) };
    scheduleScopeAudioGain = 1;
    drawScheduleScope(360);
    const second = scheduleScopeTrace.getAttribute('d');

    current = { ...current, wave: new Array(128).fill(0) };
    drawScheduleScope(420);
    const silent = scheduleScopeTrace.getAttribute('d');

    current = null;
    refreshScheduleScopeMeta();
    drawScheduleScope(480);
    return {
      first, second, silent,
      gainAfterFirst,
      firstY: Number(first.match(/^M0 ([-0-9.]+)/)?.[1]),
      lastY: Number(first.match(/L200 ([-0-9.]+)$/)?.[1]),
      label: scheduleScopeLabel.textContent,
      mode: scheduleScopeMode.textContent,
      fallback: scheduleScopeTrace.getAttribute('d')
    };
  });
  expect(result.first).toBe(result.second);
  expect(result.firstY).toBeCloseTo(21 + Math.tanh(-0.5 * result.gainAfterFirst * 1.15) * 18, 1);
  expect(result.lastY).toBeCloseTo(21 + Math.tanh(0.65 * result.gainAfterFirst * 1.15) * 18, 1);
  expect(result.first).not.toContain('NaN');
  expect(result.gainAfterFirst).toBeGreaterThan(1);
  expect(result.silent).toMatch(/^M0 21\.00(?: L\d+ 21\.00)+$/);
  expect(result.mode).toBe('NEXT START');
  expect(result.label).toBe('ΔT / SCHED');
  expect(result.fallback).not.toBe(result.silent);
  expect(errors).toEqual([]);
});

test('audio scope stays inside CRT boundaries for clipped and very quiet audio', async ({ page }) => {
  const errors = await mount(page, true);
  const result = await page.evaluate(() => {
    let wave = Array.from({length: 128}, (_, i) => i % 2 ? 1 : -1);
    window.NTUScopeAudio = {read: () => ({rms: 1, bins: new Array(64).fill(1), pitch: 0, wave})};
    drawScheduleScope(1);
    const clipped = scheduleScopeTrace.getAttribute('d');
    wave = wave.map(n => n * 0.01);
    scheduleScopeAudioGain = 1;
    drawScheduleScope(50);
    const quiet = scheduleScopeTrace.getAttribute('d');
    const ys = path => Array.from(path.matchAll(/[ML]\d+ ([-\d.]+)/g), m => Number(m[1]));
    return { clippedYs: ys(clipped), quietYs: ys(quiet) };
  });
  expect(Math.min(...result.clippedYs)).toBeGreaterThanOrEqual(2.5);
  expect(Math.max(...result.clippedYs)).toBeLessThanOrEqual(39.5);
  expect(Math.max(...result.quietYs) - Math.min(...result.quietYs)).toBeGreaterThan(10);
  expect(Math.max(...result.quietYs)).toBeLessThanOrEqual(39.5);
  expect(errors).toEqual([]);
});

test('web-only intensity boosts the same real audio and remembers the setting', async ({ page }) => {
  const errors = await mount(page, true);
  const result = await page.evaluate(() => {
    const wave = Array.from({ length: 128 }, (_, i) => (i % 8 < 4 ? 0.005 : -0.005));
    window.NTUScopeAudio = { read: () => ({
      rms: 0.004, bins: new Array(64).fill(0), pitch: 0, wave
    }) };
    setScopeSensitivity(1);
    scheduleScopeAudioGain = 1;
    drawScheduleScope(100);
    const classic = scheduleScopeTrace.getAttribute('d');
    setScopeSensitivity(5);
    scheduleScopeAudioGain = 1;
    drawScheduleScope(160);
    const maximum = scheduleScopeTrace.getAttribute('d');
    const span = path => {
      const y = [...path.matchAll(/[ML]\d+ ([-\d.]+)/g)].map(m => Number(m[1]));
      return Math.max(...y) - Math.min(...y);
    };
    return {
      classic: span(classic), maximum: span(maximum),
      label: document.getElementById('scopeAudioSensitivityValue').textContent,
      control: document.getElementById('scopeAudioSensitivity').value,
      afterglow: document.getElementById('scheduleScopeAfterglow').getAttribute('d'),
      live: document.getElementById('scheduleScopeTrace').getAttribute('d')
    };
  });
  expect(result.maximum).toBeGreaterThan(result.classic * 1.3);
  expect(result.maximum).toBeGreaterThan(28);
  expect(result.label).toBe('MAX');
  expect(result.control).toBe('5');
  expect(result.afterglow).not.toBe(result.live);
  expect(errors).toEqual([]);
});

test('scope intensity can be adjusted without the Windows binary or audio capture', async ({ page }) => {
  const originPage = 'https://weather-mister.github.io/ntu-mail-push/scope-slider-test.html';
  await page.route(originPage, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body>Test</body></html>'
  }));
  await page.goto(originPage);
  const errors = await mount(page, true);
  const slider = page.locator('#scopeAudioSensitivity');
  await expect(slider).toHaveValue('4');
  await expect(page.locator('#scopeAudioSensitivityValue')).toHaveText('WILD');
  await slider.evaluate(element => {
    element.value = '2';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#scopeAudioSensitivityValue')).toHaveText('LIVE');
  const persisted = await page.evaluate(() => localStorage.getItem('ntu-scope-visual-intensity-v1'));
  expect(persisted).toBe('2');
  expect(await page.evaluate(() => captureCalls)).toBe(0);
  expect(errors).toEqual([]);
});

test('local pairing validates signed wave snapshots and keeps older helpers compatible', async ({ page }) => {
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
    const wave = Array.from({ length: 128 }, (_, i) => (i - 64) / 128);
    socket.dispatch('message', { data: JSON.stringify({ type: 'levels', version: 1, rms: .5, pitch: .2, bins: new Array(64).fill(.4), wave }) });
    const fresh = window.NTUScopeAudio.read();
    socket.dispatch('message', { data: JSON.stringify({ type: 'levels', version: 1, rms: .5, pitch: .2, bins: new Array(64).fill(.4), wave: new Array(128).fill(7) }) });
    const stillFresh = window.NTUScopeAudio.read();
    socket.dispatch('message', { data: JSON.stringify({ type: 'levels', version: 1, rms: .5, pitch: .2, bins: new Array(64).fill(.4) }) });
    const legacy = window.NTUScopeAudio.read();
    return { url, fresh, stillFresh, legacy };
  });
  expect(result.url).toBe(`ws://127.0.0.1:43187/stream?key=${key}`);
  expect(result.fresh.bins).toHaveLength(64);
  expect(result.fresh.wave).toHaveLength(128);
  expect(result.fresh.wave[0]).toBe(-0.5);
  expect(result.stillFresh.wave).toEqual(result.fresh.wave);
  expect(result.legacy.wave).toBe(null);
  await page.locator('#scopeAudioDisconnect').click();
  expect(await page.evaluate(() => window.NTUScopeAudio.read())).toBe(null);
  expect(errors).toEqual([]);
});

test('audio bridge uses localhost only and no browser capture APIs', async () => {
  expect(schedule + bridge).not.toMatch(/getDisplayMedia|getUserMedia|AudioContext|MediaRecorder/);
  expect(bridge).toContain('ws://127.0.0.1:43187');
  expect(html).toContain('scope-audio-bridge.js?v=2');
  expect(html).not.toContain('pc-audio-scope.js');
  expect(sw).toContain("asset('scope-audio-bridge.js?v=2')");
});

test('Firefox permits a GitHub HTTPS page to connect to a local WebSocket with explicit consent', async ({ page }) => {
  const server = createServer(socket => {
    socket.once('data', bytes => {
      const request = bytes.toString('utf8');
      const key = /Sec-WebSocket-Key:\s*([^\r\n]+)/i.exec(request)?.[1]?.trim();
      if (!key) { socket.destroy(); return; }
      const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
        + 'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const testUrl = 'https://weather-mister.github.io/ntu-mail-push/test-bridge.html';
    await page.route(testUrl, route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body>Loopback transport test</body></html>'
    }));
    await page.goto(testUrl);
    const result = await page.evaluate(port => new Promise(resolve => {
      const socket = new WebSocket('ws://127.0.0.1:' + port + '/stream');
      const timeout = setTimeout(() => resolve('timeout'), 8000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve('open'); socket.close(); });
      socket.addEventListener('error', () => { clearTimeout(timeout); resolve('error'); });
    }), port);
    expect(result).toBe('open');
  } finally {
    server.close();
  }
});
