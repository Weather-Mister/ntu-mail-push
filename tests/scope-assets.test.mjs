import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = name => readFileSync(new URL(`../sites/eren/${name}`, import.meta.url), 'utf8');

test('schedule-only scope and service worker scripts parse', () => {
  for (const name of ['skeuo-runtime.js', 'sw.js']) {
    assert.doesNotThrow(() => new Script(read(name), { filename: name }));
  }
});

test('schedule runtime and offline cache use the same script version', () => {
  const html = read('skeuo-demo.html');
  const asset = html.match(/skeuo-runtime\.js\?v=\d+/)?.[0];
  assert.ok(asset, 'schedule runtime has a versioned script reference');
  assert.ok(read('sw.js').includes(`asset('${asset}')`));
});

test('scope is schedule-only and has no audio capture assets or controls', () => {
  const html = read('skeuo-demo.html');
  const runtime = read('skeuo-runtime.js');
  const sw = read('sw.js');
  assert.ok(!existsSync(new URL('../sites/eren/pc-audio-scope.js', import.meta.url)));
  assert.doesNotMatch(html, /pc-audio-scope|pc-audio-active|\.schedule-scope\.is-audio/);
  assert.match(html, /id="scheduleScope" role="img"/);
  assert.doesNotMatch(sw, /pc-audio-scope/);
  assert.doesNotMatch(runtime, /getDisplayMedia|getUserMedia|AudioContext|audioLevel|pc-audio/);
});
