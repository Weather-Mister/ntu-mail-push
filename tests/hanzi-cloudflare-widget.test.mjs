import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const cloudflare = 'https://hanzi-steps-api.weatherisgood06.workers.dev/widget?username=eren';

test('both GitHub schedule views fetch Hanzi directly from Cloudflare', () => {
  for (const path of ['sites/eren/app.js', 'sites/eren/skeuo-runtime.js']) {
    const source = readFileSync(new URL(path, ROOT), 'utf8');
    assert.ok(source.includes(`const HANZI_WIDGET_URL = '${cloudflare}';`), path);
    assert.match(source, /fetch\(HANZI_WIDGET_URL, \{ cache:'no-store' \}\)/, path);
    assert.doesNotMatch(source, /scheduleFetch\('hanzi-widget'/, path);
    assert.match(source, /scheduleFetch\(route, options = \{\}, query = \{\}\)/, 'Other paired schedule services are unchanged');
  }
});

test('PWA asset versions match the new schedule scripts', () => {
  const sw = readFileSync(new URL('sites/eren/sw.js', ROOT), 'utf8');
  const modern = readFileSync(new URL('sites/eren/index.html', ROOT), 'utf8');
  const skeuo = readFileSync(new URL('sites/eren/skeuo-demo.html', ROOT), 'utf8');
  assert.match(sw, /ntu-schedule-github-v78/);
  for (const ref of ["app.js?v=112", "skeuo-runtime.js?v=30"]) {
    assert.ok(sw.includes(ref), ref);
  }
  assert.ok(modern.includes('./app.js?v=112'));
  assert.ok(skeuo.includes('./skeuo-runtime.js?v=30'));
});
