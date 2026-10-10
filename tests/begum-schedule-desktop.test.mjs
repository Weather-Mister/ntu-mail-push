import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = name => readFileSync(new URL('../sites/begum/' + name, import.meta.url), 'utf8');
const html = read('index.html');
const app = read('app.js');
const css = read('garden-theme.css');
const sw = read('sw.js');
const bees = read('garden-bees.js');

test('Begüm live garden preserves all production integrations', () => {
  assert.doesNotThrow(() => new Script(app, {filename:'begum/app.js'}));
  assert.doesNotThrow(() => new Script(sw, {filename:'begum/sw.js'}));
  for (const id of ['scheduleList','nextClass','todoForm','coolDeadlines','coolRefresh','pairingDialog','ntuHubSection','mailAlertDialog','todoMoreButton','weekDateJump','mailAlertButton','pageRefreshButton','quickAccessRow']) assert.ok(html.includes('id="'+id+'"'),id);
  for (const feature of ['function renderDay()', 'function renderNextClass()', 'function syncTodos()', 'function renderCoolDeadlines()', 'function positionHubs()', 'if (pairingForm)']) assert.ok(app.includes(feature),feature);
  for (const klass of ['app-shell garden','schedule-split','panel cool-panel cool-section','panel tasks-panel todo-section','panel links-panel']) assert.ok(html.includes('class="'+klass+'"'),klass);
  for (const selector of ['.garden .cool-section','.garden .schedule-list .lesson','.garden .todo-section']) assert.ok(css.includes(selector),selector);
});
test('production retains the exact demo garden identity and a 50/50 schedule and COOL split', () => {
  const demo = read('desk-demo/index.html');
  const theme = demo.slice(demo.indexOf('<style>') + 7,demo.indexOf('</style>'));
  assert.ok(theme.length > 20000 && css.startsWith(theme), 'garden production starts with exact demo stylesheet');
  for (const part of ['class="hero"','class="hero-bee bee-a"','class="hero-bee bee-b"','THE FLOWER BED','SWEET LITTLE THINGS','Made to grow at your own pace']) assert.ok(html.includes(part),part);
  assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert.ok(css.includes('@media(max-width:610px)'));
  assert.ok(app.includes('if (studyHubSection && desktopShortcutsColumn'));
  assert.doesNotMatch(html,/weekOverview|week-overview|sample-task|demoCoolItems/);
});
test('Garden polish keeps demo colors, honey jar, compact controls and live data', () => {
  assert.ok(html.includes('class="honey-jar"'));
  assert.ok(html.includes('class="next-class hero-next-class"'));
  assert.ok(html.includes('class="week-caption week-picker"'));
  assert.ok(html.includes('id="weekDateJump"'));
  assert.doesNotMatch(html,/placesButton|placesDialog|garden-links-footer/);
  assert.doesNotMatch(html,/class="date-jump"/);
  assert.match(app,/gardenCourseColors/);
  assert.match(app,/cool-month/);
  assert.match(app,/cool-weekday/);
  assert.match(css,/Garden layout polish/);
  assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important/);
});

test('Begüm removes transfer and Hanzi UI, code and heavy FFmpeg preloading', () => {
  assert.doesNotMatch(html, /transferForm|transfer-section|transferSaveDialog|Phone ↔ PC|vendor\/ffmpeg/);
  assert.doesNotMatch(app, /transferForm|loadTransfers|sendTransfer|transferItems|hanziWidgetSlot|loadHanziWidget|vendor\/ffmpeg/);
  assert.doesNotMatch(sw, /vendor\/ffmpeg/);
  assert.ok(!html.includes('hanziWidgetSlot'));
});

test('Begüm PWA assets remain scoped and version matched', () => {
  for (const asset of ['app.js?v=118','todo-realtime.js?v=1','garden-theme.css?v=7','garden-bees.js?v=1']) {
    assert.ok(html.includes(asset), 'HTML references ' + asset);
    assert.ok(sw.includes(asset), 'cache includes ' + asset);
  }
  assert.match(sw, /const ROOT = new URL\(self.registration.scope\)\.pathname/);
  assert.match(app, /serviceWorker\.register\('\.\/sw\.js\?v=13'/);
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

test('Begüm decorative bee script loads and respects motion preferences', () => {
  assert.doesNotThrow(() => new Script(bees,{filename:'begum/garden-bees.js'}));
  assert.ok(html.includes('garden-floral-corners'));
  assert.ok(html.includes('garden-bees.js?v=1'));
  assert.ok(sw.includes('garden-bees.js?v=1'));
  assert.ok(css.includes('.garden-flight-layer'));
  assert.ok(css.includes('.garden-flyer'));
  assert.ok(css.includes('.garden-pollen'));
  assert.ok(bees.includes('prefers-reduced-motion: reduce'));
  assert.ok(bees.includes('garden-flight-layer'));
});
