import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = name => readFileSync(new URL('../sites/begum/' + name, import.meta.url), 'utf8');
const html = read('index.html');
const app = read('app.js');
const css = read('desktop-renewal.css');
const sw = read('sw.js');

test('Begüm desktop redesign retains functional schedule and device pairing', () => {
  assert.doesNotThrow(() => new Script(app, { filename: 'begum/app.js' }));
  assert.doesNotThrow(() => new Script(sw, { filename: 'begum/sw.js' }));
  for (const id of ['scheduleList','nextClass','todoForm','coolDeadlines','pairingDialog','placesDialog','ntuHubSection','mailAlertDialog']) {
    assert.ok(html.includes('id="' + id + '"'), id + ' remains available');
  }
  for (const feature of ['function renderDay()', 'function renderNextClass()', 'function syncTodos()', 'function renderCoolDeadlines()', 'function positionHubs()', 'if (pairingForm)']) {
    assert.ok(app.includes(feature), feature + ' remains wired');
  }
  assert.match(css, /grid-template-areas:"days schedule schedule" "days cool todo"/);
  assert.match(css, /@media\(max-width:859px\)/);
});

test('single day navigation and generous side-by-side utility layout', () => {
  assert.doesNotMatch(html, /weekOverview|week-overview/);
  assert.doesNotMatch(app, /weekOverview|renderWeekOverview|week-preview/);
  assert.doesNotMatch(css, /week-preview|week-overview/);
  assert.match(css, /grid-template-rows:minmax\(0,1\.12fr\) minmax\(0,1fr\)/);
  assert.match(css, /\.cool-section\{grid-area:cool\}/);
  assert.match(css, /\.todo-section\{grid-area:todo\}/);
  assert.match(app, /const studyTarget = desktop \? desktopDayRail|if \(studyHubSection && desktopDayRail/);
});

test('Begüm removes transfer and Hanzi UI, code and heavy FFmpeg preloading', () => {
  assert.doesNotMatch(html, /transferForm|transfer-section|transferSaveDialog|Phone ↔ PC|vendor\/ffmpeg/);
  assert.doesNotMatch(app, /transferForm|loadTransfers|sendTransfer|transferItems|hanziWidgetSlot|loadHanziWidget|vendor\/ffmpeg/);
  assert.doesNotMatch(sw, /vendor\/ffmpeg/);
  assert.ok(!html.includes('hanziWidgetSlot'));
});

test('Begüm PWA assets remain scoped and version matched', () => {
  for (const asset of ['app.js?v=110','desktop-renewal.css?v=3']) {
    assert.ok(html.includes(asset), 'HTML references ' + asset);
    assert.ok(sw.includes(asset), 'cache includes ' + asset);
  }
  assert.match(sw, /const ROOT = new URL\(self.registration.scope\)\.pathname/);
  assert.match(app, /serviceWorker\.register\('\.\/sw\.js\?v=3'/);
  assert.match(app, /begum-ntu-manual-todos-v1/);
  assert.match(app, /ntu-schedule-begum-pairing-key-v1/);
});

test('TOC meets Thursday evening and Friday morning and shows a fee, not a location', () => {
  assert.match(app, /toc:\s*\{\s*name: 'TOC',[^\n]*price: '\$800'/);
  assert.match(app, /4:\s*\[[\s\S]*?\{ course:'toc', start:'18:30', end:'19:20' \}/);
  assert.match(app, /5:\s*\[\s*\{ course:'toc', start:'10:20', end:'12:10' \}/);
  assert.match(app, /course\.price \|\| course\.location/);
  assert.ok(html.includes('id="dialogLocationLabel"'));
  assert.ok(html.includes('id="dialogDetailIcon"'));
  assert.match(app, /mapButton\.hidden = Boolean\(course\.price\)/);
});
