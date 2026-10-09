const courses = {
  women: { name: 'Exploring Taiwan: Women and Taiwanese Society', color: '#aa5f86', location: 'Boya Building · Room 202' },
  globalhealth: { name: 'Essentials of Global Health', color: '#47796b', location: 'NTU Hospital · Room 211' },
  macro: { name: 'Macroeconomics (1)', color: '#b07838', location: 'Social Sciences Building · Room 202' },
  statistics: { name: 'Statistics with Recitation', color: '#4f6f93', location: 'Social Sciences Building · Room 502' },
  period: { name: 'Period: Theory, Thoughts and Actions', color: '#7a629e', location: 'Boya Building · Room 102' },
  resources: { name: 'Exploring Taiwan: Natural Resources Conservation and Management', color: '#537a49', location: 'Boya Building · Room 202' },
  micro: { name: 'Microeconomics (1)', color: '#b55d50', location: 'Social Sciences Building · Room 507' },
  toc: { name: 'TOC', color: '#6a7c94', price: '$800' },
  chatterbox: { name: 'Chatterbox Coffee', color: '#98715a', oneOff:true }
};

const mapLinks = {
  women: 'https://maps.google.com?q=No.%201%E8%99%9F,%20Section%204,%20Roosevelt%20Rd,%20Xuefu%20Village,%20Da%E2%80%99an%20District,%20Taipei%20City,%20106&ftid=0x3442a989d9909417:0x13a8ef0043681664&entry=gps&shh=CAE&lucs=,94297699,94231188,94280568,47071704,94218641,94282134,100835694,94286869,100820247,100822504&g_st=ic',
  globalhealth: 'https://maps.app.goo.gl/EzjGfRj1Fs2i8gqM8?g_st=iw',
  macro: 'https://maps.app.goo.gl/KeNqu32753ZidRCF8?g_st=iw',
  statistics: 'https://maps.app.goo.gl/KeNqu32753ZidRCF8?g_st=iw',
  period: 'https://maps.google.com?q=No.%201%E8%99%9F,%20Section%204,%20Roosevelt%20Rd,%20Xuefu%20Village,%20Da%E2%80%99an%20District,%20Taipei%20City,%20106&ftid=0x3442a989d9909417:0x13a8ef0043681664&entry=gps&shh=CAE&lucs=,94297699,94231188,94280568,47071704,94218641,94282134,100835694,94286869,100820247,100822504&g_st=ic',
  resources: 'https://maps.google.com?q=No.%201%E8%99%9F,%20Section%204,%20Roosevelt%20Rd,%20Xuefu%20Village,%20Da%E2%80%99an%20District,%20Taipei%20City,%20106&ftid=0x3442a989d9909417:0x13a8ef0043681664&entry=gps&shh=CAE&lucs=,94297699,94231188,94280568,47071704,94218641,94282134,100835694,94286869,100820247,100822504&g_st=ic',
  micro: 'https://maps.app.goo.gl/KeNqu32753ZidRCF8?g_st=iw'
};

const meetingLinks = {};
const NTU_MAIL_URL = 'https://wmail1.cc.ntu.edu.tw/rc/index.php';

const SCHEDULE_API_URL = 'https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/ntu-schedule-api';
const SCHEDULE_PAIRING_STORAGE_KEY = 'ntu-schedule-begum-pairing-key-v1';
let schedulePairingKey = '';
const nativeFetch = window.fetch.bind(window);

try {
  const launchUrl = new URL(window.location.href);
  const launchPair = (launchUrl.searchParams.get('pair') || '').trim().toLowerCase();
  if (launchPair === 'begum'){
    localStorage.setItem(SCHEDULE_PAIRING_STORAGE_KEY, 'begum');
    launchUrl.searchParams.delete('pair');
    history.replaceState({}, '', launchUrl.pathname + launchUrl.search + launchUrl.hash);
  }
  schedulePairingKey = localStorage.getItem(SCHEDULE_PAIRING_STORAGE_KEY) || '';
} catch (error) {}

function showPairingDialog(message = ''){
  if (pairingStatus && message) pairingStatus.textContent = message;
  if (!pairingDialog) return;
  if (typeof pairingDialog.showModal === 'function'){
    if (!pairingDialog.open) pairingDialog.showModal();
  } else {
    pairingDialog.setAttribute('open', '');
  }
}

function requirePairing(){
  if (schedulePairingKey) return schedulePairingKey;
  showPairingDialog('Enter the word begum once on this device.');
  throw new Error('Pairing required');
}

window.fetch = async function scheduleScopedFetch(input, init = {}){
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  const parsed = rawUrl ? new URL(rawUrl, window.location.href) : null;

  if (!parsed || parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/api/')){
    return nativeFetch(input, init);
  }

  const key = requirePairing();
  const target = new URL(SCHEDULE_API_URL);
  target.searchParams.set('route', parsed.pathname.slice(5));
  parsed.searchParams.forEach((value, name) => target.searchParams.append(name, value));

  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('x-schedule-key', key);

  const response = await nativeFetch(target.toString(), { ...init, headers });
  if (response.status === 401){
    schedulePairingKey = '';
    try { localStorage.removeItem(SCHEDULE_PAIRING_STORAGE_KEY); } catch (error) {}
    showPairingDialog('Pairing failed. Enter the word begum.');
  }
  return response;
};


const schedule = {
  1: [
    { course:'women', start:'10:20', end:'12:10', period:'3–4' },
    { course:'globalhealth', start:'13:20', end:'16:20', period:'6–8' }
  ],
  2: [
    { course:'macro', start:'10:20', end:'13:10', period:'3–5', optional:true }
  ],
  3: [
    { course:'statistics', start:'09:10', end:'12:10', period:'2–4' },
    { course:'period', start:'16:30', end:'18:20', period:'9–10' }
  ],
  4: [
    { course:'resources', start:'13:20', end:'15:10', period:'6–7' },
    { course:'statistics', start:'15:30', end:'17:20', period:'8–9' },
    { course:'toc', start:'18:30', end:'19:20' }
  ],
  5: [
    { course:'toc', start:'10:20', end:'12:10' },
    { course:'micro', start:'13:20', end:'16:20', period:'6–8' }
  ],
  6: []
};

// Only dates checked for Begüm in the supplied Chatterbox Coffee sign-up sheet.
// 10/14 is the single yellow-highlighted row; 6:30–7:30 is treated as evening.
const specialSchedule = {
  '2026-09-29': [{ course:'chatterbox', start:'12:20', end:'13:10' }],
  '2026-10-07': [{ course:'chatterbox', start:'12:20', end:'13:10' }],
  '2026-10-14': [{ course:'chatterbox', start:'18:30', end:'19:30' }],
  '2026-10-15': [{ course:'chatterbox', start:'12:20', end:'13:10' }],
  '2026-11-06': [{ course:'chatterbox', start:'12:20', end:'13:10' }],
  '2026-11-13': [{ course:'chatterbox', start:'12:20', end:'13:10' }],
  '2026-11-17': [{ course:'chatterbox', start:'12:20', end:'13:10' }],
  '2026-11-26': [{ course:'chatterbox', start:'12:20', end:'13:10' }],
  '2026-12-02': [{ course:'chatterbox', start:'12:20', end:'13:10' }],
  '2026-12-11': [{ course:'chatterbox', start:'12:20', end:'13:10' }]
};
const dateReminders = {};

const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const nowForWeek = new Date();
const baseWeekMonday = new Date(nowForWeek);
const dayOffset = (nowForWeek.getDay() + 6) % 7;
baseWeekMonday.setDate(nowForWeek.getDate() - dayOffset);
baseWeekMonday.setHours(12, 0, 0, 0);

const list = document.getElementById('scheduleList');
const selectedDayEl = document.getElementById('selectedDay');
const selectedDateEl = document.getElementById('selectedDate');
const classCountEl = document.getElementById('classCount');
const nextClassEl = document.getElementById('nextClass');
const dayButtons = [...document.querySelectorAll('[data-day]')];
const dialog = document.getElementById('lessonDialog');
const closeDialog = document.getElementById('closeDialog');
const mapButton = document.getElementById('mapButton');
const meetingButton = document.getElementById('meetingButton');
const coolDeadlinesEl = document.getElementById('coolDeadlines');
const coolRefreshButton = document.getElementById('coolRefresh');
const todoForm = document.getElementById('todoForm');
const todoInput = document.getElementById('todoInput');
const todoList = document.getElementById('todoList');
const todoCount = document.getElementById('todoCount');
const todoMoreButton = document.getElementById('todoMoreButton');
const pageRefreshButton = document.getElementById('pageRefreshButton');
const placesButton = document.getElementById('placesButton');
const placesDialog = document.getElementById('placesDialog');
const closePlacesDialog = document.getElementById('closePlacesDialog');
const mailAlertButton = document.getElementById('mailAlertButton');
const mailAlertStatus = document.getElementById('mailAlertStatus');
const mailAlertDialog = document.getElementById('mailAlertDialog');
const closeMailAlertDialog = document.getElementById('closeMailAlertDialog');
const pushSetupStatus = document.getElementById('pushSetupStatus');
const enablePushButton = document.getElementById('enablePushButton');
const testPushButton = document.getElementById('testPushButton');
const pushSubscriptionValue = document.getElementById('pushSubscriptionValue');
const vapidPrivateValue = document.getElementById('vapidPrivateValue');
const pairingDialog = document.getElementById('pairingDialog');
const closePairingDialog = document.getElementById('closePairingDialog');
const pairingForm = document.getElementById('pairingForm');
const pairingInput = document.getElementById('pairingInput');
const pairingStatus = document.getElementById('pairingStatus');

let selectedDay = normalizeDay(new Date().getDay());
let dialogLesson = null;
let coolEvents = [];
let coolExpanded = false;
const COOL_DONE_KEY = 'begum-ntu-cool-done-v1';
const COOL_CACHE_KEY = 'begum-ntu-cool-events-v1';
const TODO_KEY = 'begum-ntu-manual-todos-v1';
const TODO_MIGRATED_KEY = 'begum-ntu-manual-todos-synced-v1';
const TODO_PENDING_KEY = 'begum-ntu-manual-todos-pending-v1';
let coolDone = loadCoolDone();
let todos = loadTodos();
let todoExpanded = false;

// Keep the two schedule PWAs and their storage independent. This only moves
// Begüm's existing shortcuts to convenient places on larger screens.
const desktopLayoutQuery = window.matchMedia('(min-width: 860px)');
const utilityColumn = document.querySelector('.utility-column');
const quickAccessRow = document.getElementById('quickAccessRow');
const desktopShortcutsColumn = document.querySelector('.desktop-shortcuts-column');
const ntuHubSection = document.getElementById('ntuHubSection');
const studyHubSection = document.querySelector('.study-hub:not(.ntu-hub)');
const unscheduledNote = document.querySelector('.unscheduled-note');

function positionHubs(){
  const desktop = desktopLayoutQuery.matches;
  const noteTarget = desktop ? desktopShortcutsColumn : document.querySelector('.app-shell');
  if (desktop){
    // Keep campus shortcuts beside the timetable and tasks, with day navigation separate.
    if (ntuHubSection && desktopShortcutsColumn && ntuHubSection.parentElement !== desktopShortcutsColumn) desktopShortcutsColumn.appendChild(ntuHubSection);
    if (studyHubSection && desktopShortcutsColumn && studyHubSection.parentElement !== desktopShortcutsColumn) desktopShortcutsColumn.appendChild(studyHubSection);
  } else {
    // Retain the original mobile quick-access order.
    if (studyHubSection && quickAccessRow && studyHubSection.parentElement !== quickAccessRow) quickAccessRow.insertBefore(studyHubSection, quickAccessRow.firstChild);
    if (ntuHubSection && quickAccessRow && ntuHubSection.parentElement !== quickAccessRow) quickAccessRow.appendChild(ntuHubSection);
    if (studyHubSection && ntuHubSection && quickAccessRow && studyHubSection.nextElementSibling !== ntuHubSection) quickAccessRow.insertBefore(studyHubSection, ntuHubSection);
  }
  if (unscheduledNote && noteTarget && unscheduledNote.parentElement !== noteTarget) noteTarget.appendChild(unscheduledNote);
}
positionHubs();
desktopLayoutQuery.addEventListener?.('change', () => {
  positionHubs();
  renderCoolDeadlines();
});

function updateDesktopClock(){
  const target = document.getElementById('desktopClock');
  if (!target) return;
  const date = new Date();
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Taipei', weekday:'short', month:'short', day:'numeric' }).format(date);
  const timeLabel = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Taipei', hour:'2-digit', minute:'2-digit', hour12:false }).format(date);
  target.innerHTML = '<span>' + escapeHtml(dateLabel) + '</span><strong>' + escapeHtml(timeLabel) + '</strong><small>TPE</small>';
}

function normalizeDay(day){
  if (day === 0) return 1;
  return Math.min(6, Math.max(1, day));
}

function minutes(time){
  const [h,m] = time.split(':').map(Number);
  return h * 60 + m;
}

function displayTime(time){
  const [h,m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2,'0')} ${suffix}`;
}

function lessonStartDate(date, lesson){
  const d = new Date(date);
  const [h,m] = lesson.start.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function lessonEndDate(date, lesson){
  const d = new Date(date);
  const [h,m] = lesson.end.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function countdownText(startAt){
  const diffMinutes = Math.max(0, Math.ceil((startAt.getTime() - Date.now()) / 60000));
  if (diffMinutes < 60) return `in ${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return mins ? `in ${hours} hr ${mins} min` : `in ${hours} hr`;
}

function setWeekTo(date){
  const weekdayOffset = (date.getDay() + 6) % 7;
  baseWeekMonday.setFullYear(date.getFullYear(), date.getMonth(), date.getDate() - weekdayOffset);
  baseWeekMonday.setHours(12, 0, 0, 0);
}

function shiftWeek(weeks){
  baseWeekMonday.setDate(baseWeekMonday.getDate() + 7 * weeks);
  renderDay();
  renderCoolDeadlineDots();
}

function weekLabel(){
  const saturday = dateForDay(6);
  if (baseWeekMonday.getMonth() === saturday.getMonth()){
    return `${shortMonths[baseWeekMonday.getMonth()]} ${baseWeekMonday.getDate()}–${saturday.getDate()}`;
  }
  return `${shortMonths[baseWeekMonday.getMonth()]} ${baseWeekMonday.getDate()} – ${shortMonths[saturday.getMonth()]} ${saturday.getDate()}`;
}

function dateForDay(day){
  const d = new Date(baseWeekMonday);
  d.setDate(baseWeekMonday.getDate() + day - 1);
  return d;
}

const mechanismNoOnsiteDates = new Set([
  '2026-09-09',
  '2026-09-23',
  '2026-10-28',
  '2026-11-18',
  '2026-12-02'
]);

function dateKey(date){
  const year = date.getFullYear();
  const month = String(date.getMonth()+1).padStart(2,'0');
  const day = String(date.getDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}

function lessonsForDate(date, day = date.getDay()){
  const regular = day >= 1 && day <= 6 ? (schedule[day] || []) : [];
  const special = specialSchedule[dateKey(date)] || [];
  return [...regular, ...special].sort((a,b) => minutes(a.start) - minutes(b.start));
}

function escapeHtml(value = ''){
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function loadCoolDone(){
  try {
    const saved = JSON.parse(localStorage.getItem(COOL_DONE_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved : []);
  } catch (error) {
    return new Set();
  }
}

function saveCoolDone(){
  try {
    localStorage.setItem(COOL_DONE_KEY, JSON.stringify([...coolDone]));
  } catch (error) {}
}

function loadTodos(){
  try {
    const saved = JSON.parse(localStorage.getItem(TODO_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(item => item && typeof item.text === 'string') : [];
  } catch (error) {
    return [];
  }
}

function saveTodos(){
  try {
    localStorage.setItem(TODO_KEY, JSON.stringify(todos));
  } catch (error) {}
}

function loadTodoPending(){
  try {
    const saved = JSON.parse(localStorage.getItem(TODO_PENDING_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    return [];
  }
}

function saveTodoPending(ops){
  try {
    localStorage.setItem(TODO_PENDING_KEY, JSON.stringify(ops));
  } catch (error) {}
}

function queueTodoOp(op){
  const ops = loadTodoPending();
  ops.push(op);
  saveTodoPending(ops.slice(-200));
}

async function todoApi(path, body){
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type':'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache:'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Task sync failed');
  return data;
}

async function flushTodoPending(){
  const ops = loadTodoPending();
  if (!ops.length) return true;

  for (let index = 0; index < ops.length; index += 1){
    const op = ops[index];
    try {
      if (op.type === 'create') await todoApi('/api/todos/create', op.task);
      if (op.type === 'update') await todoApi('/api/todos/update', { id:op.id, done:Boolean(op.done) });
      if (op.type === 'delete') await todoApi('/api/todos/delete', { id:op.id });
    } catch (error) {
      saveTodoPending(ops.slice(index));
      return false;
    }
  }

  saveTodoPending([]);
  return true;
}

async function syncTodos(){
  try {
    const migrated = localStorage.getItem(TODO_MIGRATED_KEY) === '1';

    if (!migrated){
      if (todos.length){
        await todoApi('/api/todos/import', {
          tasks:todos.map(item => ({
            id:String(item.id || ''),
            text:String(item.text || ''),
            done:Boolean(item.done)
          }))
        });
      }
      localStorage.setItem(TODO_MIGRATED_KEY, '1');
    }

    const pendingFlushed = await flushTodoPending();
    if (!pendingFlushed) return;

    const data = await todoApi('/api/todos/list');
    todos = Array.isArray(data.tasks) ? data.tasks : [];
    saveTodos();
    renderTodos();
  } catch (error) {
    renderTodos();
  }
}

function renderTodos(){
  if (!todoList || !todoCount) return;

  const openCount = todos.filter(item => !item.done).length;
  todoCount.textContent = `${openCount} ${openCount === 1 ? 'task' : 'tasks'}`;
  todoList.classList.toggle('is-expanded', todoExpanded);
  if (todoMoreButton){
    todoMoreButton.hidden = todos.length <= 3;
    todoMoreButton.textContent = todoExpanded ? 'Show less' : `Show more (${Math.max(0, todos.length - 3)})`;
  }

  if (!todos.length){
    todoList.innerHTML = '<div class="todo-empty">No manual tasks yet.</div>';
    return;
  }

  todoList.innerHTML = todos.map(item => `
    <article class="todo-item ${item.done ? 'done' : ''}" data-todo-id="${escapeHtml(item.id)}">
      <button class="todo-check" type="button" aria-label="${item.done ? 'Mark as not done' : 'Mark as done'}" aria-pressed="${item.done}">✓</button>
      <span class="todo-text">${escapeHtml(item.text)}</span>
      <button class="todo-delete" type="button" aria-label="Delete task">×</button>
    </article>`).join('');

  todoList.querySelectorAll('.todo-item').forEach(itemEl => {
    const id = itemEl.dataset.todoId;
    const check = itemEl.querySelector('.todo-check');
    const remove = itemEl.querySelector('.todo-delete');

    check?.addEventListener('click', () => void toggleTodo(id));
    remove?.addEventListener('click', () => void removeTodo(id));
  });
}

async function addTodo(text){
  const cleanText = String(text || '').trim();
  if (!cleanText) return;

  const task = {
    id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    text: cleanText.slice(0, 500),
    done: false
  };

  todos.unshift(task);
  saveTodos();
  renderTodos();

  try {
    await todoApi('/api/todos/create', task);
  } catch (error) {
    queueTodoOp({ type:'create', task });
  }
}

async function toggleTodo(id){
  const item = todos.find(todo => todo.id === id);
  if (!item) return;

  item.done = !item.done;
  saveTodos();
  renderTodos();

  try {
    await todoApi('/api/todos/update', { id, done:item.done });
  } catch (error) {
    queueTodoOp({ type:'update', id, done:item.done });
  }
}

async function removeTodo(id){
  const existing = todos.find(todo => todo.id === id);
  if (!existing) return;

  todos = todos.filter(todo => todo.id !== id);
  saveTodos();
  renderTodos();

  try {
    await todoApi('/api/todos/delete', { id });
  } catch (error) {
    queueTodoOp({ type:'delete', id });
  }
}

function loadCachedCoolEvents(){
  try {
    const saved = JSON.parse(localStorage.getItem(COOL_CACHE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    return [];
  }
}

function saveCachedCoolEvents(){
  try {
    localStorage.setItem(COOL_CACHE_KEY, JSON.stringify(coolEvents));
  } catch (error) {}
}

function coolDueLabel(event){
  const due = new Date(event.dueAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const dayDiff = Math.round((dueDay - today) / 86400000);

  if (event.allDay){
    if (dayDiff === 0) return 'Due today';
    if (dayDiff === 1) return 'Due tomorrow';
    return `Due ${shortMonths[due.getMonth()]} ${due.getDate()}`;
  }

  const diffMinutes = Math.ceil((due.getTime() - now.getTime()) / 60000);
  if (diffMinutes <= 0) return 'Due now';
  if (diffMinutes < 60) return `Due in ${diffMinutes} min`;
  if (diffMinutes < 1440){
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return mins ? `Due in ${hours} hr ${mins} min` : `Due in ${hours} hr`;
  }
  if (dayDiff === 1) return `Tomorrow · ${displayTime(`${String(due.getHours()).padStart(2,'0')}:${String(due.getMinutes()).padStart(2,'0')}`)}`;
  return `Due ${shortMonths[due.getMonth()]} ${due.getDate()}`;
}

function renderCoolDeadlineDots(){
  dayButtons.forEach(btn => {
    const day = Number(btn.dataset.day);
    const key = dateKey(dateForDay(day));
    btn.classList.toggle('has-deadline', coolEvents.some(event => event.date === key));
  });
}

function renderCoolDeadlines(){
  if (!coolDeadlinesEl) return;

  const now = Date.now();
  const upcoming = coolEvents
    .filter(event => new Date(event.dueAt).getTime() >= now - 60000);

  if (!upcoming.length){
    coolDeadlinesEl.innerHTML = `<div class="cool-status">No upcoming COOL deadlines.</div>`;
    renderCoolDeadlineDots();
    return;
  }

  const desktopDeadlines = desktopLayoutQuery.matches;
  const visible = desktopDeadlines ? upcoming : (coolExpanded ? upcoming : upcoming.slice(0, 3));
  const hiddenCount = Math.max(0, upcoming.length - 3);

  const itemsHtml = visible.map(event => {
    const due = new Date(event.dueAt);
    const dateText = `${shortMonths[due.getMonth()]} ${due.getDate()}`;
    const dayText = dayNames[due.getDay()].slice(0,3);
    const done = coolDone.has(event.id);
    return `
      <article class="cool-item ${done ? 'done' : ''}">
        <a class="cool-main" href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer external" aria-label="Open ${escapeHtml(event.title)} in Safari">
          <div class="cool-date"><strong>${dateText}</strong><span>${dayText}</span></div>
          <div class="cool-copy">
            <p class="cool-title">${escapeHtml(event.title)}</p>
            <p class="cool-course">${escapeHtml(event.course)}</p>
          </div>
          <span class="cool-due">${done ? 'Done' : escapeHtml(coolDueLabel(event))}</span>
        </a>
        <button class="cool-done-button ${done ? 'is-done' : ''}" type="button" data-event-id="${escapeHtml(event.id)}" aria-pressed="${done}" aria-label="${done ? 'Mark as not done' : 'Mark as done'}">✓</button>
      </article>`;
  }).join('');

  const toggleHtml = !desktopDeadlines && upcoming.length > 3
    ? `<button id="coolToggle" class="cool-toggle" type="button" aria-expanded="${coolExpanded}">${coolExpanded ? 'Show less' : `Show ${hiddenCount} more`}</button>`
    : '';

  coolDeadlinesEl.innerHTML = itemsHtml + toggleHtml;

  const toggle = document.getElementById('coolToggle');
  if (toggle){
    toggle.addEventListener('click', () => {
      coolExpanded = !coolExpanded;
      renderCoolDeadlines();
    });
  }

  coolDeadlinesEl.querySelectorAll('.cool-done-button').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.eventId;
      if (!id) return;
      if (coolDone.has(id)) coolDone.delete(id);
      else coolDone.add(id);
      saveCoolDone();
      renderCoolDeadlines();
    });
  });

  renderCoolDeadlineDots();
}

async function loadCoolDeadlines(force = false){
  if (!coolDeadlinesEl) return;

  if (!force){
    const cached = loadCachedCoolEvents();
    if (cached.length){
      coolEvents = cached;
      renderCoolDeadlines();
    }
  } else {
    coolDeadlinesEl.innerHTML = `<div class="cool-status">Refreshing deadlines…</div>`;
  }

  if (coolRefreshButton) coolRefreshButton.disabled = true;

  try {
    const response = await fetch('/api/cool-calendar', { cache: force ? 'reload' : 'no-cache' });
    if (!response.ok) throw new Error('COOL sync failed');
    const data = await response.json();
    coolEvents = Array.isArray(data.events) ? data.events : [];
    saveCachedCoolEvents();
    renderCoolDeadlines();
  } catch (error) {
    if (!coolEvents.length){
      coolDeadlinesEl.innerHTML = `<div class="cool-status">Couldn’t sync NTU COOL right now.</div>`;
    }
  } finally {
    if (coolRefreshButton) coolRefreshButton.disabled = false;
  }
}

function isLessonInactive(){
  return false;
}

function isCurrentLesson(day, lesson){
  const now = new Date();
  if (now.getDay() !== day || dateKey(dateForDay(day)) !== dateKey(now) || isLessonInactive(day, lesson, now)) return false;
  const nowMin = now.getHours()*60 + now.getMinutes();
  return nowMin >= minutes(lesson.start) && nowMin <= minutes(lesson.end);
}

function isLessonCompleted(day, lesson, date = dateForDay(day)){
  if (isLessonInactive(day, lesson, date)) return false;
  const now = new Date();
  const lessonDate = new Date(date);
  lessonDate.setHours(0,0,0,0);
  const today = new Date(now);
  today.setHours(0,0,0,0);
  if (lessonDate < today) return true;
  if (lessonDate > today) return false;
  const nowMin = now.getHours()*60 + now.getMinutes();
  return nowMin > minutes(lesson.end);
}

function renderDay(){
  const date = dateForDay(selectedDay);
  const lessons = lessonsForDate(date, selectedDay);
  selectedDayEl.textContent = dayNames[selectedDay];
  selectedDateEl.textContent = `${shortMonths[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  classCountEl.textContent = `${lessons.length} ${lessons.length === 1 ? 'class' : 'classes'}`;
  const weekRangeEl = document.getElementById('weekRange');
  if (weekRangeEl) weekRangeEl.textContent = weekLabel();
  const weekDateJump = document.getElementById('weekDateJump');
  if (weekDateJump) weekDateJump.value = dateKey(date);

  dayButtons.forEach(btn => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active', day === selectedDay);
    btn.classList.toggle('today', dateKey(dateForDay(day)) === dateKey(new Date()));
    btn.querySelector('small').textContent = dateForDay(day).getDate();
    btn.setAttribute('aria-pressed', day === selectedDay ? 'true' : 'false');
  });

  const reminder = dateReminders[dateKey(date)];
  const reminderHtml = reminder ? `
    <div class="date-reminder" style="--reminder-color:${reminder.color}">
      <span class="date-reminder-dot"></span>
      <div><strong>${reminder.title}</strong><span>${reminder.text}</span></div>
    </div>` : '';

  if (!lessons.length){
    list.innerHTML = reminderHtml || `<div class="empty-state"><strong>No classes</strong>Saturday is clear.</div>`;
    return;
  }

  list.innerHTML = reminderHtml + lessons.map((lesson,index) => {
    const course = courses[lesson.course];
    const inactive = isLessonInactive(selectedDay, lesson, date);
    const live = !inactive && isCurrentLesson(selectedDay, lesson);
    const completed = !inactive && isLessonCompleted(selectedDay, lesson, date);
    return `
      <button class="lesson ${live ? 'live' : ''} ${completed ? 'completed' : ''} ${inactive ? 'inactive' : ''}" type="button" data-index="${index}" style="--course-color:${course.color}" ${inactive ? 'disabled aria-disabled="true"' : ''}>
        <span class="time-block">
          <span class="time-start">${lesson.start}</span>
          <span class="time-end">${lesson.end}</span>
          ${lesson.period ? `<span class="time-period">${lesson.period}</span>` : ''}
        </span>
        <span class="lesson-card">
          <span class="lesson-title">${course.name}</span>
          <span class="lesson-meta">
            ${inactive ? '<span class="no-lecture">No lecture</span>' : `${live ? '<span class="live-pill">Happening now</span>' : ''}${lesson.optional ? '<span class="optional-pill">Optional</span>' : ''}<span>${course.price || course.location || 'One-time session'}</span>`}
          </span>
          ${inactive ? '' : '<span class="lesson-arrow">›</span>'}
        </span>
      </button>`;
  }).join('');

  list.querySelectorAll('.lesson').forEach(btn => btn.addEventListener('click', () => {
    const lesson = lessons[Number(btn.dataset.index)];
    openLesson(lesson, selectedDay);
  }));
}

function getNextClass(){
  const now = new Date();
  const today = now.getDay();
  const nowMin = now.getHours()*60 + now.getMinutes();

  if (today >= 1 && today <= 6){
    const todayClasses = lessonsForDate(now, today).filter(x => !isLessonInactive(today, x, now));
    const live = todayClasses.find(x => nowMin >= minutes(x.start) && nowMin <= minutes(x.end));
    if (live) return { lesson:live, day:today, state:'Now', startAt:lessonStartDate(now, live), endAt:lessonEndDate(now, live) };
    const later = todayClasses.find(x => minutes(x.start) > nowMin);
    if (later) return { lesson:later, day:today, state:'Next', startAt:lessonStartDate(now, later) };
  }

  for (let offset=1; offset<=7; offset++){
    const d = new Date(now);
    d.setDate(now.getDate()+offset);
    const day = d.getDay();
    const activeClasses = lessonsForDate(d, day).filter(x => !isLessonInactive(day, x, d));
    if (activeClasses.length){
      return { lesson:activeClasses[0], day, state: day === ((today+1)%7) ? 'Tomorrow' : dayNames[day], startAt:lessonStartDate(d, activeClasses[0]) };
    }
  }
  return null;
}

function renderNextClass(){
  const next = getNextClass();
  let classMarkup = `
    <div class="next-copy">
      <p class="next-label">Up next</p>
      <p class="next-title">No upcoming classes</p>
    </div>`;

  if (next){
    const course = courses[next.lesson.course];
    const countdown = next.state === 'Now'
      ? `<p class="next-countdown">ends ${countdownText(next.endAt)}</p>`
      : `<p class="next-countdown">${countdownText(next.startAt)}</p>`;
    classMarkup = `
      <div class="next-copy">
        <p class="next-label">${next.state === 'Now' ? 'Happening now' : 'Up next'}</p>
        <p class="next-title">${course.name}</p>
        <p class="next-meta">${dayNames[next.day]} · ${displayTime(next.lesson.start)}–${displayTime(next.lesson.end)}${next.lesson.period ? ` · Period ${next.lesson.period}` : ''}${next.lesson.optional ? ' · Optional attendance' : ''}</p>
        ${countdown}
      </div>
      <div class="next-badge"><strong>${next.state}</strong><small>${next.lesson.start}</small></div>`;
  }

  nextClassEl.innerHTML = classMarkup;
}

function openLesson(lesson, day){
  dialogLesson = lesson;
  const course = courses[lesson.course];
  dialog.style.setProperty('--dialog-color', course.color);
  document.getElementById('dialogDay').textContent = dayNames[day];
  document.getElementById('dialogTitle').textContent = course.name;
  document.getElementById('dialogTime').textContent = `${displayTime(lesson.start)} – ${displayTime(lesson.end)}${lesson.period ? ` · Period ${lesson.period}` : ''}${lesson.optional ? ' · Optional attendance' : ''}`;
  const url = mapLinks[lesson.course];
  const meetingUrl = meetingLinks[lesson.course];
  const oneOff = Boolean(course.oneOff);
  const date = dateForDay(day);
  document.getElementById('dialogLocation').textContent = oneOff
    ? `${dayNames[day]}, ${shortMonths[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
    : (course.price || course.location);
  document.getElementById('dialogLocationLabel').textContent = oneOff ? 'Session date' : (course.price ? 'Fee' : 'Class location');
  document.getElementById('dialogDetailIcon').textContent = oneOff ? '☕' : (course.price ? '$' : '⌖');
  mapButton.hidden = oneOff || Boolean(course.price);
  mapButton.disabled = !url;
  mapButton.textContent = url ? 'Open in Google Maps' : 'Map link coming soon';
  meetingButton.hidden = lesson.course !== 'icl';
  if (lesson.course === 'icl') {
    meetingButton.disabled = !meetingUrl;
    meetingButton.textContent = meetingUrl ? 'Open online meeting' : 'Online meeting link coming soon';
  }
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open','');
}

closeDialog.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
mapButton.addEventListener('click', () => {
  if (!dialogLesson) return;
  const url = mapLinks[dialogLesson.course];
  if (!url) return;
  if (dialog.open) dialog.close();
  window.location.assign(url);
});
meetingButton.addEventListener('click', () => {
  if (!dialogLesson) return;
  const url = meetingLinks[dialogLesson.course];
  if (!url) return;
  if (dialog.open) dialog.close();
  window.location.assign(url);
});

function base64UrlToUint8Array(value){
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

let pushConfig = null;

async function loadPushConfig(){
  if (pushConfig) return pushConfig;
  const response = await fetch('/api/push/config', { cache:'no-store' });
  if (!response.ok) throw new Error('Could not load push configuration');
  pushConfig = await response.json();
  return pushConfig;
}

async function refreshPushStatus(){
  if (!pushSetupStatus || !enablePushButton || !testPushButton) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)){
    pushSetupStatus.textContent = 'On iPhone, open the installed Home Screen app to enable push notifications.';
    enablePushButton.disabled = true;
    testPushButton.disabled = true;
    return;
  }

  try {
    await loadPushConfig();
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const denied = Notification.permission === 'denied';
    if (subscription){
      if (pushSubscriptionValue) pushSubscriptionValue.textContent = JSON.stringify(subscription.toJSON());
      pushSetupStatus.textContent = 'Notifications are enabled on this device.';
      enablePushButton.textContent = 'Notifications enabled';
      enablePushButton.disabled = true;
      testPushButton.disabled = false;
      if (mailAlertStatus) mailAlertStatus.textContent = 'Enabled on this device';
      try { localStorage.setItem('begum-ntu-mail-push-enabled', '1'); } catch (error) {}
    } else if (denied){
      pushSetupStatus.textContent = 'Notifications are blocked for this app. Enable them in iPhone Settings to continue.';
      enablePushButton.textContent = 'Notifications blocked';
      enablePushButton.disabled = true;
      testPushButton.disabled = true;
    } else {
      pushSetupStatus.textContent = 'Enable once, then the installed app can receive NTU Mail alerts while closed.';
      enablePushButton.textContent = 'Enable notifications';
      enablePushButton.disabled = false;
      testPushButton.disabled = true;
    }
  } catch (error) {
    pushSetupStatus.textContent = 'Could not load notification setup right now.';
    enablePushButton.disabled = false;
    testPushButton.disabled = true;
  }
}

async function enableMailPush(){
  if (!enablePushButton || !pushSetupStatus) return;
  enablePushButton.disabled = true;
  pushSetupStatus.textContent = 'Requesting notification permission…';
  try {
    const config = await loadPushConfig();
    const permission = await Notification.requestPermission();
    if (permission !== 'granted'){
      pushSetupStatus.textContent = permission === 'denied'
        ? 'Notifications were blocked. You can change this in iPhone Settings.'
        : 'Notification permission was not granted.';
      enablePushButton.disabled = permission === 'denied';
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription){
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:base64UrlToUint8Array(config.publicKey)
      });
    }

    const response = await fetch('/api/push/subscribe', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ subscription:subscription.toJSON() })
    });
    if (!response.ok) throw new Error('Could not save subscription');

    try { localStorage.setItem('begum-ntu-mail-push-enabled', '1'); } catch (error) {}
    await refreshPushStatus();
  } catch (error) {
    pushSetupStatus.textContent = 'Could not enable notifications on this device.';
    enablePushButton.disabled = false;
  }
}

async function sendTestPush(){
  if (!testPushButton || !pushSetupStatus) return;
  testPushButton.disabled = true;
  pushSetupStatus.textContent = 'Checking test setup…';
  try {
    const response = await fetch('/api/push/test', { method:'POST' });
    const data = await response.json();
    if (data.githubRequired){
      pushSetupStatus.textContent = data.message;
      return;
    }
    if (!response.ok || !data.ok) throw new Error(data.message || 'Test push failed');
    pushSetupStatus.textContent = 'Test sent. It should appear as an NTU Schedule notification.';
  } catch (error) {
    pushSetupStatus.textContent = `Test failed: ${error?.message || 'unknown error'}`;
  } finally {
    testPushButton.disabled = false;
  }
}

if (mailAlertButton){
  try {
    if (localStorage.getItem('begum-ntu-mail-push-enabled') === '1' && mailAlertStatus) mailAlertStatus.textContent = 'Enabled on this device';
  } catch (error) {}
  mailAlertButton.addEventListener('click', () => {
    if (typeof mailAlertDialog.showModal === 'function') mailAlertDialog.showModal();
    else mailAlertDialog.setAttribute('open','');
    refreshPushStatus();
  });
}

if (closeMailAlertDialog) closeMailAlertDialog.addEventListener('click', () => mailAlertDialog.close());
if (mailAlertDialog) mailAlertDialog.addEventListener('click', event => { if (event.target === mailAlertDialog) mailAlertDialog.close(); });
if (enablePushButton) enablePushButton.addEventListener('click', enableMailPush);
if (testPushButton) testPushButton.addEventListener('click', sendTestPush);

document.querySelectorAll('[data-copy-target]').forEach(button => {
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent || '');
      const old = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = old; }, 1200);
    } catch (error) {}
  });
});

document.getElementById('previousWeek')?.addEventListener('click', () => shiftWeek(-1));
document.getElementById('nextWeek')?.addEventListener('click', () => shiftWeek(1));
document.getElementById('weekDateJump')?.addEventListener('change', event => {
  const value = event.target.value;
  if (!/^2026-(0[9]|1[0-2])-\d{2}$/.test(value)) return;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return;
  setWeekTo(date);
  selectedDay = normalizeDay(date.getDay());
  renderDay();
  renderCoolDeadlineDots();
});

dayButtons.forEach(btn => btn.addEventListener('click', () => {
  selectedDay = Number(btn.dataset.day);
  renderDay();
}));

const jumpTodayButton = document.getElementById('jumpTodayButton');
if (jumpTodayButton) jumpTodayButton.addEventListener('click', () => {
  setWeekTo(new Date());
  selectedDay = normalizeDay(new Date().getDay());
  renderDay();
});

document.addEventListener('keydown', event => {
  if (!desktopLayoutQuery.matches || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
  if (document.querySelector('dialog[open]') || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  let next = selectedDay;
  if (/^[1-6]$/.test(event.key)) next = Number(event.key);
  else if (event.key === 'ArrowLeft') next = Math.max(1, selectedDay - 1);
  else if (event.key === 'ArrowRight') next = Math.min(6, selectedDay + 1);
  else if (event.key.toLowerCase() === 't') { setWeekTo(new Date()); next = normalizeDay(new Date().getDay()); }
  else return;
  event.preventDefault();
  selectedDay = next;
  renderDay();
});

if (pageRefreshButton){
  pageRefreshButton.addEventListener('click', () => window.location.reload());
}

if (placesButton && placesDialog){
  placesButton.addEventListener('click', () => {
    if (typeof placesDialog.showModal === 'function') placesDialog.showModal();
    else placesDialog.setAttribute('open','');
  });
}

if (closePlacesDialog && placesDialog){
  closePlacesDialog.addEventListener('click', () => placesDialog.close());
}

if (placesDialog){
  placesDialog.addEventListener('click', event => {
    if (event.target === placesDialog) placesDialog.close();
  });
  placesDialog.querySelectorAll('.place-link').forEach(link => {
    link.addEventListener('click', () => {
      if (placesDialog.open) placesDialog.close();
    });
  });
}

if (coolRefreshButton){
  coolRefreshButton.addEventListener('click', () => loadCoolDeadlines(true));
}

if (todoForm){
  todoForm.addEventListener('submit', event => {
    event.preventDefault();
    void addTodo(todoInput?.value);
    if (todoInput){
      todoInput.value = '';
      todoInput.focus();
    }
  });
}

if (todoMoreButton){
  todoMoreButton.addEventListener('click', () => {
    todoExpanded = !todoExpanded;
    renderTodos();
  });
}

window.addEventListener('schedule-todos-changed', () => { void syncTodos(); });
window.addEventListener('focus', () => { void syncTodos(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void syncTodos();
});

if (pairingForm){
  pairingForm.addEventListener('submit', async event => {
    event.preventDefault();
    const value = String(pairingInput?.value || '').trim().toLowerCase();
    if (value !== 'begum'){
      if (pairingStatus) pairingStatus.textContent = 'Enter the word begum.';
      return;
    }
    schedulePairingKey = 'begum';
    try { localStorage.setItem(SCHEDULE_PAIRING_STORAGE_KEY, 'begum'); } catch (error) {}
    try {
      const response = await window.fetch('/api/status', { cache:'no-store' });
      if (!response.ok) throw new Error('Pairing failed');
      if (pairingDialog?.open) pairingDialog.close();
      if (pairingInput) pairingInput.value = '';
      void syncTodos();
      window.dispatchEvent(new Event('schedule-pairing-changed'));
      loadCoolDeadlines(true);
      void refreshPushStatus();
    } catch (error) {
      schedulePairingKey = '';
      try { localStorage.removeItem(SCHEDULE_PAIRING_STORAGE_KEY); } catch (ignored) {}
      if (pairingStatus) pairingStatus.textContent = 'Could not pair this device.';
    }
  });
}
if (closePairingDialog){
  closePairingDialog.addEventListener('click', () => {
    if (schedulePairingKey && pairingDialog?.open) pairingDialog.close();
  });
}
if (pairingDialog){
  pairingDialog.addEventListener('cancel', event => {
    if (!schedulePairingKey) event.preventDefault();
  });
}
if (!schedulePairingKey) showPairingDialog();

renderDay();
renderNextClass();
renderTodos();
void syncTodos();
loadCoolDeadlines();
updateDesktopClock();
setInterval(() => { renderNextClass(); renderDay(); updateDesktopClock(); }, 30000);
// Task updates are event-driven; reconnecting reloads the authoritative snapshot.

const launchParams = new URLSearchParams(window.location.search);
if (launchParams.get('open') === 'ntu-mail'){
  // Legacy notification links should never replace the standalone PWA with NTU Mail.
  history.replaceState({}, '', window.location.pathname);
}

if ('serviceWorker' in navigator){
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js?v=7', { updateViaCache:'none' });
      await registration.update();
    } catch (error) {}
  });
}