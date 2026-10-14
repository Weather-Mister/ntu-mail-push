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
  assert.match(sw, /ntu-schedule-github-v80/);
  for (const ref of ["app.js?v=114", "skeuo-runtime.js?v=32"]) {
    assert.ok(sw.includes(ref), ref);
  }
  assert.ok(modern.includes('./app.js?v=114'));
  assert.ok(skeuo.includes('./skeuo-runtime.js?v=32'));
});

test('Statics Week 9, Materials Week 8, and Statics Quiz II Week 13 dates stay correct in both schedule views', () => {
  for (const path of ['sites/eren/app.js', 'sites/eren/skeuo-runtime.js']) {
    const source = readFileSync(new URL(path, ROOT), 'utf8');
    assert.match(source, /academic-materials-midterm-1', date:'2026-10-27', dueAt:'2026-10-27T23:59:59\+08:00'/, path);
    assert.match(source, /academic-statics-midterm', date:'2026-11-03', dueAt:'2026-11-03T23:59:59\+08:00'/, path);
    assert.match(source, /academic-statics-quiz-2', date:'2026-12-01', dueAt:'2026-12-01T23:59:59\+08:00'/, path);
  }
});
