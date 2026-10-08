import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = name => readFileSync(new URL(`../sites/eren/${name}`, import.meta.url), 'utf8');

test('scope scripts and service worker parse', () => {
  for (const name of ['skeuo-runtime.js', 'pc-audio-scope.js', 'sw.js']) {
    assert.doesNotThrow(() => new Script(read(name), { filename: name }));
  }
});

test('scope HTML and service worker cache use the same asset versions', () => {
  for (const name of ['skeuo-runtime', 'pc-audio-scope']) {
    const asset = read('skeuo-demo.html').match(new RegExp(`${name}\\.js\\?v=\\d+`))?.[0];
    assert.ok(asset, `${name} has a versioned script reference`);
    assert.ok(read('sw.js').includes(`asset('${asset}')`));
  }
});
