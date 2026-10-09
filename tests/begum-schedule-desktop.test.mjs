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
  assert.match(css, /grid-template-areas:"days schedule tools shortcuts"/);
  assert.match(css, /@media\(max-width:859px\)/);
});

test('single day navigation and full-height schedule with adjacent tools and shortcuts', () => {
  assert.doesNotMatch(html, /weekOverview|week-overview/);
  assert.doesNotMatch(app, /weekOverview|renderWeekOverview|week-preview/);
  assert.doesNotMatch(css, /week-preview|week-overview/);
  assert.match(css, /grid-template-areas:"days days days" "schedule tools shortcuts"/);
  assert.match(css, /\.utility-column\{grid-area:tools;/);
  assert.match(css, /\.desktop-shortcuts-column\{grid-area:shortcuts;/);
  assert.match(app, /if \(studyHubSection && desktopShortcutsColumn/);
});

test('Begüm removes transfer and Hanzi UI, code and heavy FFmpeg preloading', () => {
  assert.doesNotMatch(html, /transferForm|transfer-section|transferSaveDialog|Phone ↔ PC|vendor\/ffmpeg/);
  assert.doesNotMatch(app, /transferForm|loadTransfers|sendTransfer|transferItems|hanziWidgetSlot|loadHanziWidget|vendor\/ffmpeg/);
  assert.doesNotMatch(sw, /vendor\/ffmpeg/);
  assert.ok(!html.includes('hanziWidgetSlot'));
});

test('Begüm PWA assets remain scoped and version matched', () => {
  for (const asset of ['app.js?v=113','todo-realtime.js?v=1','desktop-renewal.css?v=5']) {
    assert.ok(html.includes(asset), 'HTML references ' + asset);
    assert.ok(sw.includes(asset), 'cache includes ' + asset);
  }
  assert.match(sw, /const ROOT = new URL\(self.registration.scope\)\.pathname/);
  assert.match(app, /serviceWorker\.register\('\.\/sw\.js\?v=7'/);
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
  assert.match(app, /mapButton\.hidden = oneOff \|\| Boolean\(course\.price\)/);
});


test('only Begüm checked Chatterbox Coffee dates are in the one-time schedule', () => {
  const checked = [
    ['2026-09-29','12:20','13:10'],
    ['2026-10-07','12:20','13:10'],
    ['2026-10-14','18:30','19:30'],
    ['2026-10-15','12:20','13:10'],
    ['2026-11-06','12:20','13:10'],
    ['2026-11-13','12:20','13:10'],
    ['2026-11-17','12:20','13:10'],
    ['2026-11-26','12:20','13:10'],
    ['2026-12-02','12:20','13:10'],
    ['2026-12-11','12:20','13:10']
  ];
  assert.match(app, /chatterbox:\s*\{\s*name: 'Chatterbox Coffee'/);
  for(const [date,start,end] of checked){
    assert.ok(app.includes(
      "'" + date + "': [{ course:'chatterbox', start:'" + start + "', end:'" + end + "' }]"
    ), 'expected Chatterbox session ' + date);
  }
  for(const date of ['2026-09-21','2026-10-19','2026-11-09','2026-12-07']){
    assert.doesNotMatch(app, new RegExp("'" + date + "':\\s*\\[\\{ course:'chatterbox'"));
  }
  assert.doesNotMatch(app, /chatterbox-highlight|highlight:'yellow'|highlight-day/);
  assert.doesNotMatch(css, /chatterbox-highlight|highlight-day/);
  assert.equal((app.match(/course:'chatterbox', start:/g) || []).length, 10);
});

test('the 2026 date navigation is reachable on desktop and mobile', () => {
  for(const id of ['previousWeek','nextWeek','weekRange','weekDateJump']){
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(app, /function shiftWeek\(weeks\)/);
  assert.match(app, /function setWeekTo\(date\)/);
  assert.match(app, /getElementById\('weekDateJump'\)\?\.addEventListener\('change'/);
  assert.match(app, /setWeekTo\(new Date\(\)\)/);
});
