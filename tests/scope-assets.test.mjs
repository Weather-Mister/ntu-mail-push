import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = name => readFileSync(new URL(`../sites/eren/${name}`, import.meta.url), 'utf8');

test('schedule-only scope and service worker scripts parse', () => {
  for (const name of ['skeuo-runtime.js', 'scope-audio-bridge.js', 'sw.js']) {
    assert.doesNotThrow(() => new Script(read(name), { filename: name }));
  }
});

test('schedule runtime and offline cache use the same script version', () => {
  const html = read('skeuo-demo.html');
  const asset = html.match(/skeuo-runtime\.js\?v=\d+/)?.[0];
  assert.ok(asset, 'schedule runtime has a versioned script reference');
  assert.ok(read('sw.js').includes(`asset('${asset}')`));
});

test('scope uses an opt-in localhost bridge without browser media capture APIs', () => {
  const html = read('skeuo-demo.html');
  const runtime = read('skeuo-runtime.js');
  const sw = read('sw.js');
  assert.ok(!existsSync(new URL('../sites/eren/pc-audio-scope.js', import.meta.url)));
  assert.doesNotMatch(html, /pc-audio-scope|pc-audio-active|\.schedule-scope\.is-audio/);
  assert.match(html, /id="scheduleScope" role="group"/);
  assert.match(html, /id="scopeAudioToggle"/);
  assert.match(html, /id="scopeAudioDialog"/);
  assert.match(html, /scope-audio-bridge\.js\?v=2/);
  assert.match(sw, /asset\('scope-audio-bridge\.js\?v=2'\)/);
  assert.match(read('scope-audio-bridge.js'), /ws:\/\/127\.0\.0\.1:43187/);
  assert.doesNotMatch(sw, /pc-audio-scope/);
  assert.doesNotMatch(runtime, /getDisplayMedia|getUserMedia|AudioContext|audioLevel|pc-audio/);
});
