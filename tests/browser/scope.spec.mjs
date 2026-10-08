import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../../sites/eren/skeuo-runtime.js', import.meta.url), 'utf8');
const schedule = runtime.slice(runtime.indexOf('/* Schedule interval oscilloscope.'), runtime.lastIndexOf("if ('serviceWorker' in navigator)"));
const audio = readFileSync(new URL('../../sites/eren/pc-audio-scope.js', import.meta.url), 'utf8');

async function mount(page, reducedMotion = false, firefox = false) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.setContent(`<div id="scheduleScope" role="button" tabindex="0">
    <span id="scheduleScopeLabel">ΔT / SCHED</span><b id="scheduleScopeValue">--</b>
    <svg><path id="scheduleScopeTrace" d="M0 21H200"/></svg>
    <span id="scheduleScopeMode">NEXT START</span><span id="scheduleScopeHint">λ ∝ ΔT</span>
  </div>`);
  await page.evaluate(isFirefox => {
    // Run the same Chrome-path and Firefox-path cases on both browser engines.
    // Without this override, the non-Firefox tests inadvertently enter Firefox
    // mode when the entire suite runs in a real Firefox binary.
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: isFirefox ? 'Mozilla/5.0 Firefox/145.0' : 'Mozilla/5.0 Chrome/145.0'
    });
    if (isFirefox) {
      const saved = new Map();
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: { getItem: key => saved.get(key) ?? null, setItem: (key, val) => saved.set(key, String(val)) }
      });
      window.testAudioLevels = [0, 0];
      window.testAnalyserCount = 0;
    }
    window.inputCalls = [];
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
    if (isFirefox) {
      const originalAnalyser = window.AudioContext.prototype.createAnalyser;
      window.AudioContext.prototype.createAnalyser = function() {
        const analyser = originalAnalyser.call(this);
        const index = window.testAnalyserCount++;
        analyser.getByteTimeDomainData = data => {
          const amplitude = window.testAudioLevels[index] || 0;
          for (let i = 0; i < data.length; i++) data[i] = 128 + Math.round(amplitude * (i % 2 ? 1 : -1));
        };
        return analyser;
      };
    }
    window.captureCalls = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: constraints => {
        window.inputCalls.push(constraints);
        return new Promise((resolve, reject) => {
          window.resolveInput = resolve;
          window.rejectInput = reject;
        });
      },
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'microphone', label: 'Microphone' },
        { kind: 'audioinput', deviceId: 'loopback', label: 'Stereo Mix (Loopback)' }
      ],
      getDisplayMedia: () => {
        window.captureCalls++;
        return new Promise((resolve, reject) => {
          window.resolveCapture = resolve;
          window.rejectCapture = reject;
        });
      }
    } });
    window.inputTracks = [];
    window.provideInput = async (name = 'Input') => {
      const producer = new NativeContext();
      const oscillator = producer.createOscillator();
      const destination = producer.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      await producer.resume();
      window.producer = producer;
      window.pickedTracks = destination.stream.getAudioTracks();
      const track = window.pickedTracks[0];
      Object.defineProperty(track, 'label', { configurable: true, value: name });
      window.inputTracks.push(track);
      window.resolveInput(new MediaStream(window.pickedTracks));
    };
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
  }, firefox);
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

test('Firefox uses an audio input without display sharing', async ({ page }) => {
  const errors = await mount(page, false, true);
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await expect(page.locator('#scheduleScopeMode')).toHaveText('CHOOSE INPUT');
  expect(await page.evaluate(() => window.captureCalls)).toBe(0);
  expect(await page.evaluate(() => window.inputCalls[0])).toMatchObject({
    video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  });
  await page.evaluate(() => window.provideInput());
  await expect(scope).toHaveClass(/pc-audio-active/);
  await expect(page.locator('#scheduleScopeMode')).toHaveText('AUDIO INPUT');
  await scope.click();
  await expect(scope).not.toHaveClass(/pc-audio-active/);
  expect(await page.evaluate(() => pickedTracks.every(t => t.readyState === 'ended'))).toBe(true);
  expect(errors).toEqual([]);
});

test('Firefox multi-input selector remembers selections and switches to the active signal', async ({ page }) => {
  const errors = await mount(page, false, true);
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await page.evaluate(() => window.provideInput('Microphone'));
  await expect(scope).toHaveClass(/pc-audio-active/);
  await scope.click({ button: 'right' });
  const menu = page.getByRole('group', { name: 'Oscilloscope audio inputs' });
  await expect(menu).toBeVisible();
  await menu.getByRole('checkbox', { name: 'Microphone' }).check();
  await menu.getByRole('checkbox', { name: 'Stereo Mix (Loopback)' }).check();
  await menu.getByRole('button', { name: 'Apply' }).click();

  const selected = await page.evaluate(() => JSON.parse(localStorage.getItem('ntu-scope-firefox-inputs')));
  expect(selected).toEqual(['microphone', 'loopback']);
  await expect.poll(() => page.evaluate(() => window.inputCalls.length)).toBe(2);
  expect((await page.evaluate(() => window.inputCalls[1])).audio.deviceId).toEqual({ exact: 'microphone' });
  await page.evaluate(() => window.provideInput('Loopback A'));
  await expect.poll(() => page.evaluate(() => window.inputCalls.length)).toBe(3);
  expect((await page.evaluate(() => window.inputCalls[2])).audio.deviceId).toEqual({ exact: 'loopback' });
  await page.evaluate(() => window.provideInput('Loopback B'));
  await expect(scope).toHaveClass(/pc-audio-active/);
  await expect(page.locator('#scheduleScopeLabel')).toHaveText('AUDIO / AUTO');
  await expect(page.locator('#scheduleScopeValue')).toHaveText('2 IN');

  await page.evaluate(() => { window.testAudioLevels = [0, 100, 0]; });
  await expect(page.locator('#scheduleScopeMode')).toHaveText('AUTO: LOOPBACK A');
  await page.evaluate(() => { window.testAudioLevels = [0, 0, 120]; });
  await expect(page.locator('#scheduleScopeMode')).toHaveText('AUTO: LOOPBACK B', { timeout: 4000 });

  await scope.press('Shift+Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await scope.click();
  await expect(scope).not.toHaveClass(/pc-audio-active/);
  expect(await page.evaluate(() => window.inputTracks.every(t => t.readyState === 'ended'))).toBe(true);
  expect(errors).toEqual([]);
});

test('Firefox auto-input survives a disconnected source and retains remaining signal', async ({ page }) => {
  const errors = await mount(page, false, true);
  await page.evaluate(() => localStorage.setItem('ntu-scope-firefox-inputs', JSON.stringify(['microphone', 'loopback'])));
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await page.evaluate(() => window.provideInput('Loopback A'));
  await expect.poll(() => page.evaluate(() => window.inputCalls.length)).toBe(2);
  await page.evaluate(() => window.provideInput('Loopback B'));
  await expect(page.locator('#scheduleScopeValue')).toHaveText('2 IN');
  await page.evaluate(() => {
    inputTracks[0].stop();
    inputTracks[0].dispatchEvent(new Event('ended'));
  });
  await expect(page.locator('#scheduleScopeValue')).toHaveText('LIVE');
  await expect(scope).toHaveClass(/pc-audio-active/);
  await scope.click();
  expect(errors).toEqual([]);
});

test('Firefox rejected permission leaves an informative retry state', async ({ page }) => {
  const errors = await mount(page, false, true);
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await page.evaluate(() => rejectInput(new DOMException('Blocked', 'NotAllowedError')));
  await expect(page.locator('#scheduleScopeMode')).toHaveText('INPUT BLOCKED');
  await expect(scope).not.toHaveClass(/pc-audio-active/);
  await scope.click();
  await page.evaluate(() => window.provideInput());
  await expect(scope).toHaveClass(/pc-audio-active/);
  expect(errors).toEqual([]);
});


test('Firefox input permission begins only on activation, then can be cancelled', async ({ page }) => {
  const errors = await mount(page, false, true);
  const scope = page.locator('#scheduleScope');
  expect(await page.evaluate(() => inputCalls.length)).toBe(0);
  await scope.click();
  await expect(page.locator('#scheduleScopeMode')).toHaveText('CHOOSE INPUT');
  await scope.click();
  await expect(scope).not.toHaveClass(/pc-audio-pending|pc-audio-active/);
  await page.evaluate(() => window.provideInput('Late device'));
  await expect.poll(() => page.evaluate(() => inputTracks[0]?.readyState)).toBe('ended');
  await expect(scope).not.toHaveClass(/pc-audio-active/);
  expect(await page.evaluate(() => inputCalls.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('Firefox stop while second input permission is pending releases both tracks', async ({ page }) => {
  const errors = await mount(page, false, true);
  await page.evaluate(() => localStorage.setItem('ntu-scope-firefox-inputs', JSON.stringify(['microphone', 'loopback'])));
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await page.evaluate(() => window.provideInput('Device A'));
  await expect.poll(() => page.evaluate(() => inputCalls.length)).toBe(2);
  await scope.click();
  await page.evaluate(() => window.provideInput('Late B'));
  await expect.poll(() => page.evaluate(() => inputTracks.every(t => t.readyState === 'ended'))).toBe(true);
  await expect(scope).not.toHaveClass(/pc-audio-active|pc-audio-pending/);
  expect(errors).toEqual([]);
});

test('Firefox missing first input falls through to next previously selected device', async ({ page }) => {
  const errors = await mount(page, false, true);
  await page.evaluate(() => localStorage.setItem('ntu-scope-firefox-inputs', JSON.stringify(['gone', 'loopback'])));
  await page.locator('#scheduleScope').click();
  await page.evaluate(() => rejectInput(new DOMException('Missing input', 'NotFoundError')));
  await expect.poll(() => page.evaluate(() => inputCalls.length)).toBe(2);
  expect((await page.evaluate(() => inputCalls[1])).audio.deviceId).toEqual({ exact: 'loopback' });
  await page.evaluate(() => window.provideInput('Loopback B'));
  await expect(page.locator('#scheduleScope')).toHaveClass(/pc-audio-active/);
  await expect(page.locator('#scheduleScopeValue')).toHaveText('LIVE');
  expect(errors).toEqual([]);
});

test('Firefox denial stops probing the remaining inputs', async ({ page }) => {
  const errors = await mount(page, false, true);
  await page.evaluate(() => localStorage.setItem('ntu-scope-firefox-inputs', JSON.stringify(['microphone', 'loopback'])));
  await page.locator('#scheduleScope').click();
  await page.evaluate(() => rejectInput(new DOMException('Permission denied', 'NotAllowedError')));
  await expect(page.locator('#scheduleScopeMode')).toHaveText('INPUT BLOCKED');
  expect(await page.evaluate(() => inputCalls.length)).toBe(1);
  await expect(page.locator('#scheduleScope')).not.toHaveClass(/pc-audio-active/);
  expect(errors).toEqual([]);
});

test('Firefox second-source denial preserves the first live capture', async ({ page }) => {
  const errors = await mount(page, false, true);
  await page.evaluate(() => localStorage.setItem('ntu-scope-firefox-inputs', JSON.stringify(['microphone', 'loopback'])));
  await page.locator('#scheduleScope').click();
  await page.evaluate(() => window.provideInput('Microphone'));
  await expect.poll(() => page.evaluate(() => inputCalls.length)).toBe(2);
  await page.evaluate(() => rejectInput(new DOMException('Denied second', 'NotAllowedError')));
  await expect(page.locator('#scheduleScope')).toHaveClass(/pc-audio-active/);
  await expect(page.locator('#scheduleScopeValue')).toHaveText('LIVE');
  expect(await page.evaluate(() => inputTracks[0].readyState)).toBe('live');
  expect(errors).toEqual([]);
});

test('Firefox all unavailable devices restore safe retry state', async ({ page }) => {
  const errors = await mount(page, false, true);
  await page.evaluate(() => localStorage.setItem('ntu-scope-firefox-inputs', JSON.stringify(['gone1','gone2'])));
  await page.locator('#scheduleScope').click();
  await page.evaluate(() => rejectInput(new DOMException('Missing', 'NotFoundError')));
  await expect.poll(() => page.evaluate(() => inputCalls.length)).toBe(2);
  await page.evaluate(() => rejectInput(new DOMException('Missing', 'NotFoundError')));
  await expect(page.locator('#scheduleScopeMode')).toHaveText('NO AUDIO INPUT');
  await expect(page.locator('#scheduleScope')).not.toHaveClass(/pc-audio-active|pc-audio-pending/);
  expect(errors).toEqual([]);
});

test('Firefox stale device enumeration cannot reopen picker after stopping', async ({ page }) => {
  const errors = await mount(page, false, true);
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await page.evaluate(() => window.provideInput('Mic'));
  await expect(scope).toHaveClass(/pc-audio-active/);
  await page.evaluate(() => {
    navigator.mediaDevices.enumerateDevices = () => new Promise(resolve => { window.finishEnumeration = resolve; });
  });
  await scope.click({ button: 'right' });
  await scope.click();
  await page.evaluate(() => finishEnumeration([{kind:'audioinput',deviceId:'microphone',label:'Microphone'}]));
  await expect(page.getByRole('group', { name: 'Oscilloscope audio inputs' })).toHaveCount(0);
  await expect(scope).not.toHaveClass(/pc-audio-active/);
  expect(errors).toEqual([]);
});

test('Firefox saved selection restarts with the same two specific inputs', async ({ page }) => {
  const errors = await mount(page, false, true);
  await page.evaluate(() => localStorage.setItem('ntu-scope-firefox-inputs', JSON.stringify(['microphone', 'loopback'])));
  const scope = page.locator('#scheduleScope');
  await scope.click();
  await page.evaluate(() => window.provideInput('Mic'));
  await expect.poll(() => page.evaluate(() => inputCalls.length)).toBe(2);
  await page.evaluate(() => window.provideInput('Loopback'));
  await expect(scope).toHaveClass(/pc-audio-active/);
  await scope.click();
  await scope.click();
  await expect.poll(() => page.evaluate(() => inputCalls.length)).toBe(3);
  expect((await page.evaluate(() => inputCalls[2])).audio.deviceId).toEqual({ exact: 'microphone' });
  await page.evaluate(() => window.provideInput('Mic'));
  await expect.poll(() => page.evaluate(() => inputCalls.length)).toBe(4);
  expect((await page.evaluate(() => inputCalls[3])).audio.deviceId).toEqual({ exact: 'loopback' });
  await page.evaluate(() => window.provideInput('Loopback'));
  await expect(page.locator('#scheduleScopeValue')).toHaveText('2 IN');
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

test('audio loudness changes height while preserving schedule wave spacing', async ({ page }) => {
  const errors = await mount(page, true);
  const result = await page.evaluate(() => {
    scheduleScopeState = { active: true, live: false, minutes: 60 };
    const points = level => {
      drawScheduleScope(0, level);
      return Array.from(scheduleScopeTrace.getAttribute('d').matchAll(/[ML]([\d.]+) ([-\d.]+)/g), m => [Number(m[1]), Number(m[2]) - 21]);
    };
    return { schedule: points(null), quiet: points(0), loud: points(1) };
  });
  expect(result.loud.map(p => p[0])).toEqual(result.schedule.map(p => p[0]));
  for (let i = 0; i < result.schedule.length; i++) {
    const [x, deviation] = result.schedule[i];
    if (Math.abs(deviation) > 0.05) {
      expect(Math.sign(result.quiet[i][1]), `quiet wave at x=${x}`).toBe(Math.sign(deviation));
      expect(Math.sign(result.loud[i][1]), `loud wave at x=${x}`).toBe(Math.sign(deviation));
    }
  }
  const peak = points => Math.max(...points.map(p => Math.abs(p[1])));
  expect(peak(result.loud)).toBeGreaterThan(peak(result.quiet) * 7);
  expect(errors).toEqual([]);
});
