const courses = {
  mechanism: { name: 'Mechanism', color: '#b55d50', location: '繡山講堂' },
  engmath: { name: 'Engineering Mathematics (1)', color: '#5f67af', location: 'Room 114' },
  statics: { name: 'Statics', color: '#b07838', location: '繡山講堂' },
  intro: { name: 'Introduction to Mechanical Engineering', color: '#47796b', location: 'Room B113' },
  materials: { name: 'Engineering Materials', color: '#7a629e', location: '進學講堂' },
  pe: { name: 'Health Related Physical Fitness', color: '#4382a0', location: 'F-I' },
  psychology: { name: 'General Psychology', color: '#aa5f86', location: 'Room 102' },
  chinese: { name: 'General Chinese Language Course (I)', color: '#537a49', location: 'Room 406' },
  english: { name: 'Academic English for Science and Engineering – Reading and Writing', color: '#4f6f93', location: 'Room 312' },
  icl: { name: 'ICL', color: '#c94747', location: 'Location TBA' }
};

const mapLinks = {
  mechanism: 'https://www.google.com/maps/search/?api=1&query=%E6%A9%9F%E6%A2%B0%E7%B3%BB%E9%A4%A8%2F%E5%AE%97%E5%80%AC%E7%AB%A0%E9%A4%A8',
  engmath: 'https://maps.app.goo.gl/x4yDgcQJRQ7apkH26',
  statics: 'https://www.google.com/maps/search/?api=1&query=%E6%A9%9F%E6%A2%B0%E7%B3%BB%E9%A4%A8%2F%E5%AE%97%E5%80%AC%E7%AB%A0%E9%A4%A8',
  intro: 'https://maps.app.goo.gl/x4yDgcQJRQ7apkH26',
  materials: 'https://www.google.com/maps/search/?api=1&query=%E6%A9%9F%E6%A2%B0%E7%B3%BB%E9%A4%A8%2F%E5%AE%97%E5%80%AC%E7%AB%A0%E9%A4%A8',
  pe: 'https://maps.app.goo.gl/QUxR9sY5Yv2X1bwo7',
  psychology: 'https://maps.app.goo.gl/67JR7tQVG6QehZ6m9',
  chinese: 'https://maps.app.goo.gl/oRx5Z94PqURWoG6d7',
  english: 'https://maps.app.goo.gl/xW3eeFvFCxZ1USdt5',
  icl: ''
};

const meetingLinks = {
  icl: 'https://meet.google.com/exs-vbjn-vpq'
};

const NTU_MAIL_URL = 'https://wmail1.cc.ntu.edu.tw/rc/index.php';

const SCHEDULE_API_URL = 'https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/ntu-schedule-api';
const SCHEDULE_PAIRING_KEY = 'ntu-schedule-pairing-key-v1';
let schedulePairingKey = '';

try {
  const launchUrl = new URL(window.location.href);
  const launchPair = launchUrl.searchParams.get('pair');
  if (launchPair && launchPair.length >= 32 && launchPair.length <= 200){
    localStorage.setItem(SCHEDULE_PAIRING_KEY, launchPair);
    launchUrl.searchParams.delete('pair');
    history.replaceState({}, '', launchUrl.pathname + launchUrl.search + launchUrl.hash);
  }
  schedulePairingKey = localStorage.getItem(SCHEDULE_PAIRING_KEY) || '';
} catch (error) {}

function scheduleApiUrl(route, query = {}){
  const url = new URL(SCHEDULE_API_URL);
  url.searchParams.set('route', route);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  return url.toString();
}

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
  showPairingDialog('Enter the pairing key once on this device to sync private schedule data.');
  throw new Error('Pairing required');
}

async function scheduleFetch(route, options = {}, query = {}){
  const key = requirePairing();
  const headers = new Headers(options.headers || {});
  headers.set('x-schedule-key', key);

  const response = await fetch(scheduleApiUrl(route, query), {
    ...options,
    headers
  });

  if (response.status === 401){
    schedulePairingKey = '';
    try { localStorage.removeItem(SCHEDULE_PAIRING_KEY); } catch (error) {}
    showPairingDialog('This device is no longer paired. Enter the pairing key again.');
  }

  return response;
}


const schedule = {
  1: [
    { course:'mechanism', start:'09:10', end:'10:00', period:'2' },
    { course:'engmath', start:'10:20', end:'12:10', period:'3–4' },
    { course:'psychology', start:'14:20', end:'17:20', period:'7–9' },
    { course:'chinese', start:'18:25', end:'21:05', period:'A–C' }
  ],
  2: [
    { course:'statics', start:'10:20', end:'12:10', period:'3–4' },
    { course:'intro', start:'13:20', end:'14:10', period:'6' },
    { course:'materials', start:'15:30', end:'17:20', period:'8–9' }
  ],
  3: [
    { course:'engmath', start:'09:10', end:'10:00', period:'2' },
    { course:'mechanism', start:'10:20', end:'12:10', period:'3–4' },
    { course:'chinese', start:'18:25', end:'21:05', period:'A–C' }
  ],
  4: [
    { course:'materials', start:'09:10', end:'10:00', period:'2' },
    { course:'pe', start:'10:20', end:'12:10', period:'3–4' }
  ],
  5: [
    { course:'english', start:'13:20', end:'15:10', period:'6–7' }
  ],
  6: []
};

const specialSchedule = {
  '2026-09-24': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-10-01': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-10-08': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-10-22': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-10-29': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-11-05': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-11-12': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-12-03': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-12-10': [{ course:'icl', start:'16:20', end:'17:00' }],
  '2026-12-17': [{ course:'icl', start:'16:20', end:'17:00' }]
};

const dateReminders = {
  '2026-11-09': { title:'ICL trip', text:'ICL trip · Nov 9–10', color:'#c94747' },
  '2026-11-10': { title:'ICL trip', text:'ICL trip · Nov 9–10', color:'#c94747' }
};

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
const hanziWidgetSlot = document.getElementById('hanziWidgetSlot');
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
const transferForm = document.getElementById('transferForm');
const transferText = document.getElementById('transferText');
const transferFileInput = document.getElementById('transferFileInput');
const transferFileLabel = document.getElementById('transferFileLabel');
const transferSendButton = document.getElementById('transferSendButton');
const transferStatus = document.getElementById('transferStatus');
const transferStatusDot = document.getElementById('transferStatusDot');
const transferList = document.getElementById('transferList');
const transferRefresh = document.getElementById('transferRefresh');
const transferMoreButton = document.getElementById('transferMoreButton');
const transferSection = document.querySelector('.transfer-section');
const transferHomeAnchor = document.getElementById('transferHomeAnchor');
const utilityColumn = document.querySelector('.utility-column');
const quickAccessRow = document.getElementById('quickAccessRow');
const ntuHubSection = document.getElementById('ntuHubSection');
const transferSaveDialog = document.getElementById('transferSaveDialog');
const closeTransferSaveDialog = document.getElementById('closeTransferSaveDialog');
const transferSaveName = document.getElementById('transferSaveName');
const transferSaveMeta = document.getElementById('transferSaveMeta');
const transferSaveHint = document.getElementById('transferSaveHint');
const transferNativeSaveButton = document.getElementById('transferNativeSaveButton');
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
const COOL_DONE_KEY = 'ntu-cool-done-v1';
const COOL_CACHE_KEY = 'ntu-cool-events-v1';
const TODO_KEY = 'ntu-manual-todos-v1';
const TODO_MIGRATED_KEY = 'ntu-manual-todos-synced-v1';
const TODO_PENDING_KEY = 'ntu-manual-todos-pending-v1';
let coolDone = loadCoolDone();
let todos = loadTodos();
let transferItems = [];
let transferLoadPromise = null;
let todoSyncPromise = null;
let todoExpanded = false;
let transferExpanded = false;
const preparedTransferFiles = new Map();
let activePreparedTransferId = null;
const HANZI_WIDGET_CACHE_KEY = 'ntu-hanzi-widget-cache-v1';
let hanziWidgetData = null;
let hanziWidgetLoading = false;
let hanziWidgetError = false;
try {
  const cached = JSON.parse(localStorage.getItem(HANZI_WIDGET_CACHE_KEY) || 'null');
  if (cached && typeof cached.streak === 'number') hanziWidgetData = cached;
} catch (error) {}

function isIOSDevice(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function updateTransferStatusDot(){
  if (!transferStatusDot || !transferStatus) return;
  const text = String(transferStatus.textContent || '').toLowerCase();
  const isError = /could not|failed|error/.test(text);
  transferStatusDot.classList.toggle('is-error', isError);
  transferStatusDot.classList.toggle('is-ok', !isError);
}

updateTransferStatusDot();
if (transferStatus){
  new MutationObserver(updateTransferStatusDot).observe(transferStatus, { childList:true, characterData:true, subtree:true });
}

const desktopTransferQuery = window.matchMedia('(min-width: 860px)');

function placeTransferForViewport(){
  const ntuHub = document.getElementById('ntuHubSection');
  const dayRail = document.querySelector('.desktop-day-rail');
  const quickAccess = document.getElementById('quickAccessRow');
  const hubParent = desktopTransferQuery.matches ? dayRail : quickAccess;
  if (ntuHub && hubParent && ntuHub.parentElement !== hubParent) hubParent.appendChild(ntuHub);
  if (!transferSection || !transferHomeAnchor) return;

  if (desktopTransferQuery.matches && utilityColumn){
    if (transferSection.parentElement !== utilityColumn){
      utilityColumn.appendChild(transferSection);
    }
  } else if (transferSection.previousElementSibling !== transferHomeAnchor){
    transferHomeAnchor.after(transferSection);
  }
}

placeTransferForViewport();
desktopTransferQuery.addEventListener?.('change', () => {
  placeTransferForViewport();
  renderCoolDeadlines();
});

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
  const route = String(path || '').startsWith('/api/') ? String(path).slice(5) : String(path || '');
  const response = await scheduleFetch(route, {
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
  if (todoSyncPromise) return todoSyncPromise;
  todoSyncPromise = (async () => {
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
  })();
  try { return await todoSyncPromise; }
  finally { todoSyncPromise = null; }
}

function renderTodos(){
  if (!todoList || !todoCount) return;

  const openCount = todos.filter(item => !item.done).length;
  todoCount.textContent = `${String(openCount).padStart(2,'0')} ${openCount === 1 ? 'TASK' : 'TASKS'}`;
  if (todoMoreButton) todoMoreButton.hidden = true;

  if (!todos.length){
    todoList.innerHTML = '<div class="task"><button class="key taskbox" type="button" disabled></button><span>No manual tasks yet</span><small>--</small></div>';
    return;
  }

  todoList.innerHTML = todos.map((item,index) => `
    <div class="task ${item.done ? 'done' : ''}" data-todo-id="${escapeHtml(item.id)}">
      <button class="key taskbox ${item.done ? 'pressed' : ''}" type="button" aria-label="${item.done ? 'Mark as not done' : 'Mark as done'}" aria-pressed="${item.done}"></button>
      <span>${escapeHtml(item.text)}</span>
      <button class="todo-delete-skeuo" type="button" aria-label="Delete task" title="Delete task">${String(index + 1).padStart(2,'0')}</button>
    </div>`).join('');

  todoList.querySelectorAll('.task').forEach(itemEl => {
    const id = itemEl.dataset.todoId;
    itemEl.querySelector('.taskbox')?.addEventListener('click', () => void toggleTodo(id));
    itemEl.querySelector('.todo-delete-skeuo')?.addEventListener('click', () => void removeTodo(id));
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

function transferTime(value){
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
    : date.toLocaleDateString([], { month:'short', day:'numeric' });
}

function transferSize(bytes){
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function renderTransfers(){
  if (!transferList) return;
  if (transferMoreButton) transferMoreButton.hidden = true;

  if (!transferItems.length){
    transferList.innerHTML = '<div class="transferitem" data-kind="T"><strong>Nothing here yet</strong><small>TRANSFER BUFFER EMPTY</small></div>';
    return;
  }

  transferList.innerHTML = transferItems.map(item => {
    const isFile = item.kind === 'file';
    const isLink = item.kind === 'link';
    const kind = isFile ? 'F' : (isLink ? 'L' : 'T');
    const title = isFile ? (item.filename || 'File') : (item.content || '');
    const meta = isFile
      ? `FILE · ${transferTime(item.createdAt).toUpperCase()} · ${transferSize(item.bytes)}`
      : `${isLink ? 'LINK' : 'TEXT'} · ${transferTime(item.createdAt).toUpperCase()}`;
    const hasDirectFile = isFile && Boolean(item.url);
    const hasChunks = isFile && Number(item.chunkCount || 0) > 0;

    const openAction = hasDirectFile
      ? `<a class="transfer-action-skeuo" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer external">OPEN</a><a class="transfer-action-skeuo" href="${escapeHtml(item.downloadUrl || item.url)}" target="_blank" rel="noopener noreferrer external">SAVE</a>`
      : hasChunks
        ? `<button class="transfer-action-skeuo" type="button" data-transfer-action="download" data-id="${escapeHtml(item.id)}">${isIOSDevice() ? (preparedTransferFiles.has(item.id) ? 'SAVE' : 'PREP') : 'SAVE'}</button>`
        : isLink
          ? `<a class="transfer-action-skeuo" href="${escapeHtml(item.content)}" target="_blank" rel="noopener noreferrer external">OPEN</a>`
          : '';

    const copyAction = !isFile
      ? `<button class="transfer-action-skeuo" type="button" data-transfer-action="copy" data-id="${escapeHtml(item.id)}">COPY</button>`
      : '';

    return `
      <div class="transferitem" data-kind="${kind}" tabindex="0">
        <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
        <small>${escapeHtml(meta)}</small>
        <div class="transfer-actions-skeuo">
          ${openAction}
          ${copyAction}
          <button class="transfer-action-skeuo" type="button" data-transfer-action="delete" data-id="${escapeHtml(item.id)}" aria-label="Delete transfer">×</button>
        </div>
      </div>`;
  }).join('');
}

async function loadTransfers(silent = false){
  if (!transferList) return;
  if (transferLoadPromise) return transferLoadPromise;
  transferLoadPromise = (async () => {
    if (!silent) {
      if (transferRefresh) transferRefresh.disabled = true;
      if (transferStatus) transferStatus.textContent = 'Syncing transfer inbox…';
    }
    try {
      const response = await scheduleFetch('transfer/list', { cache:'no-store' });
      if (!response.ok) throw new Error('Could not sync');
      const data = await response.json();
      transferItems = Array.isArray(data.items) ? data.items : [];
      renderTransfers();
      if (transferStatus && (!silent || transferStatusDot?.classList.contains('is-error'))) transferStatus.textContent = 'Synced';
    } catch (error) {
      if (!silent && transferStatus) transferStatus.textContent = 'Could not sync transfers right now.';
    } finally {
      if (transferRefresh) transferRefresh.disabled = false;
    }
  })();
  try { return await transferLoadPromise; }
  finally { transferLoadPromise = null; }
}

async function sendTransferText(content){
  const response = await scheduleFetch('transfer/text', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ content })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not send text');
}

let ffmpegConverter = null;
let ffmpegConverterLoading = null;
let ffmpegCoreBlobUrls = null;

function isMovFile(file){
  return /\.mov$/i.test(file?.name || '') || String(file?.type || '').toLowerCase() === 'video/quicktime';
}

async function remoteBlobUrl(url, mimeType){
  const response = await fetch(url, { cache:'force-cache' });
  if (!response.ok) throw new Error('Could not load the video converter.');
  const blob = await response.blob();
  return URL.createObjectURL(new Blob([blob], { type:mimeType }));
}

async function getFfmpegConverter(){
  if (ffmpegConverter?.loaded) return ffmpegConverter;
  if (ffmpegConverterLoading) return ffmpegConverterLoading;

  ffmpegConverterLoading = (async () => {
    if (!globalThis.FFmpegWASM?.FFmpeg) throw new Error('Video converter did not load.');

    if (transferStatus) transferStatus.textContent = 'Preparing MOV → MP4 converter…';
    if (!ffmpegCoreBlobUrls){
      const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
      const [coreURL, wasmURL] = await Promise.all([
        remoteBlobUrl(`${base}/ffmpeg-core.js`, 'text/javascript'),
        remoteBlobUrl(`${base}/ffmpeg-core.wasm`, 'application/wasm')
      ]);
      ffmpegCoreBlobUrls = { coreURL, wasmURL };
    }

    const ffmpeg = new globalThis.FFmpegWASM.FFmpeg();
    await ffmpeg.load(ffmpegCoreBlobUrls);
    ffmpegConverter = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegConverterLoading;
  } catch (error) {
    ffmpegConverterLoading = null;
    throw error;
  }
}

async function convertMovToMp4(file){
  const ffmpeg = await getFfmpegConverter();
  const token = globalThis.crypto?.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const inputDir = `/mov-${token}`;
  const inputPath = `${inputDir}/${file.name}`;
  const outputPath = `converted-${token}.mp4`;
  const outputName = file.name.replace(/\.mov$/i, '') + '.mp4';
  let mounted = false;

  try {
    if (transferStatus) transferStatus.textContent = `Converting ${file.name} to MP4…`;
    await ffmpeg.createDir(inputDir);

    try {
      await ffmpeg.mount(globalThis.FFmpegWASM.FFFSType.WORKERFS, { files:[file] }, inputDir);
      mounted = true;
    } catch (error) {
      await ffmpeg.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()));
    }

    let result = await ffmpeg.exec([
      '-i', inputPath,
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      '-c', 'copy',
      '-movflags', '+faststart',
      outputPath
    ]);

    if (result !== 0){
      try { await ffmpeg.deleteFile(outputPath); } catch (error) {}
      if (transferStatus) transferStatus.textContent = `Re-encoding ${file.name} for MP4 compatibility…`;
      result = await ffmpeg.exec([
        '-i', inputPath,
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        outputPath
      ]);
    }

    if (result !== 0) throw new Error(`Could not convert ${file.name} to MP4.`);
    const data = await ffmpeg.readFile(outputPath);
    return new File([data], outputName, { type:'video/mp4', lastModified:Date.now() });
  } finally {
    try { await ffmpeg.deleteFile(outputPath); } catch (error) {}
    if (mounted){
      try { await ffmpeg.unmount(inputDir); } catch (error) {}
    } else {
      try { await ffmpeg.deleteFile(inputPath); } catch (error) {}
    }
    try { await ffmpeg.deleteDir(inputDir); } catch (error) {}
  }
}

async function sendTransferFile(file, onProgress){
  const CHUNK_SIZE = 4 * 1024 * 1024;

  if (file.size <= CHUNK_SIZE){
    const form = new FormData();
    form.append('file', file, file.name);
    const response = await scheduleFetch('transfer/upload', { method:'POST', body:form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Could not send ${file.name}`);
    onProgress?.(1, 1);
    return;
  }

  const uploadId = globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let index = 0; index < totalChunks; index += 1){
    const start = index * CHUNK_SIZE;
    const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
    const form = new FormData();
    form.append('chunk', chunk, `${file.name}.part${index}`);
    form.append('uploadId', uploadId);
    form.append('index', String(index));
    form.append('totalChunks', String(totalChunks));
    form.append('totalBytes', String(file.size));

    const response = await scheduleFetch('transfer/upload-chunk', { method:'POST', body:form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Could not send ${file.name}`);
    onProgress?.(index + 1, totalChunks);
  }

  const response = await scheduleFetch('transfer/finalize', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({
      uploadId,
      totalChunks,
      totalBytes:file.size,
      filename:file.name,
      contentType:file.type || 'application/octet-stream'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Could not finish ${file.name}`);
}

async function prepareTransferFile(item, button){
  const count = Number(item?.chunkCount || 0);
  const oldText = button?.textContent || (isIOSDevice() ? 'Save' : 'Download');
  if (button){
    button.disabled = true;
    button.textContent = '0%';
  }

  try {
    const chunks = [];
    let received = 0;

    if (count > 0){
      for (let index = 0; index < count; index += 1){
        const response = await scheduleFetch('transfer/chunk', { cache:'no-store' }, { id:item.id, index });
        if (!response.ok) throw new Error('Could not download file');
        const blob = await response.blob();
        chunks.push(blob);
        received += Number(blob.size || 0);

        if (button){
          const expected = Number(item.bytes || 0);
          const pct = expected
            ? Math.min(100, Math.round((received / expected) * 100))
            : Math.round(((index + 1) / count) * 100);
          button.textContent = `${pct}%`;
        }
      }
    } else {
      const response = item.url
        ? await fetch(item.url, { cache:'no-store' })
        : await scheduleFetch('transfer/file', { cache:'no-store' }, { id:item.id });
      if (!response.ok) throw new Error('Could not download file');
      const blob = await response.blob();
      chunks.push(blob);
      received = Number(blob.size || 0);
      if (button) button.textContent = '100%';
    }

    const expected = Number(item.bytes || 0);
    if (expected && received !== expected) throw new Error('Downloaded file was incomplete. Please try again.');

    return new File(
      chunks,
      item.filename || 'file',
      { type:item.contentType || chunks[0]?.type || 'application/octet-stream', lastModified:Date.now() }
    );
  } finally {
    if (button){
      button.disabled = false;
      button.textContent = oldText;
    }
  }
}

function isPdfTransferFile(file){
  return String(file?.type || '').toLowerCase() === 'application/pdf'
    || /\.pdf$/i.test(String(file?.name || ''));
}

function openPreparedTransferFile(file){
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 300000);
}

function showPreparedTransferDialog(item, file){
  activePreparedTransferId = item.id;
  const isPdf = isPdfTransferFile(file);
  if (transferSaveName) transferSaveName.textContent = file.name;
  if (transferSaveMeta) transferSaveMeta.textContent = transferSize(file.size);
  if (transferSaveHint){
    transferSaveHint.textContent = isPdf
      ? 'Tap “Open PDF”, then use the Share button in the PDF viewer to save it to Files.'
      : 'Tap “Save to Files”, then choose “Save to Files” in the iOS share sheet.';
  }
  if (transferNativeSaveButton){
    transferNativeSaveButton.disabled = false;
    transferNativeSaveButton.textContent = isPdf ? 'Open PDF' : 'Save to Files';
  }

  if (transferSaveDialog){
    if (typeof transferSaveDialog.showModal === 'function') transferSaveDialog.showModal();
    else transferSaveDialog.setAttribute('open','');
  }
}

async function downloadTransferFile(item, button){
  if (isIOSDevice()){
    let prepared = preparedTransferFiles.get(item.id);

    if (!prepared){
      prepared = await prepareTransferFile(item, button);
      preparedTransferFiles.set(item.id, prepared);
      renderTransfers();
    }

    showPreparedTransferDialog(item, prepared);
    if (transferStatus) transferStatus.textContent = `${prepared.name} is ready to save.`;
    return;
  }

  const file = await prepareTransferFile(item, button);
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = file.name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  if (transferStatus) transferStatus.textContent = `${file.name} downloaded.`;
}

async function submitTransfers(event){
  event?.preventDefault();
  if (!transferForm || !transferSendButton) return;

  const text = String(transferText?.value || '').trim();
  const files = [...(transferFileInput?.files || [])];
  if (!text && !files.length){
    if (transferStatus) transferStatus.textContent = 'Paste text, a link, or choose a file first.';
    return;
  }

  const oversized = files.find(file => file.size > 100 * 1024 * 1024);
  if (oversized){
    if (transferStatus) transferStatus.textContent = `${oversized.name} is over the 100 MB limit.`;
    return;
  }

  transferSendButton.disabled = true;
  try {
    let completed = 0;
    const total = (text ? 1 : 0) + files.length;

    if (text){
      if (transferStatus) transferStatus.textContent = `Sending ${completed + 1} of ${total}…`;
      await sendTransferText(text);
      completed += 1;
    }

    for (const file of files){
      let uploadFile = file;

      if (isMovFile(file)){
        uploadFile = await convertMovToMp4(file);
        if (uploadFile.size > 100 * 1024 * 1024){
          throw new Error(`${uploadFile.name} is over the 100 MB limit after conversion.`);
        }
      }

      if (transferStatus) transferStatus.textContent = `Sending ${completed + 1} of ${total}: ${uploadFile.name}`;
      await sendTransferFile(uploadFile, (done, count) => {
        if (!transferStatus) return;
        const pct = Math.round((done / count) * 100);
        transferStatus.textContent = `Sending ${completed + 1} of ${total}: ${uploadFile.name} · ${pct}%`;
      });
      completed += 1;
    }

    if (transferText) transferText.value = '';
    if (transferFileInput) transferFileInput.value = '';
    if (transferFileLabel) transferFileLabel.textContent = 'Add file';
    await loadTransfers(true);
    if (transferStatus) transferStatus.textContent = total === 1 ? 'Sent. It is ready on your other device.' : `${total} items sent. They are ready on your other device.`;
  } catch (error) {
    if (transferStatus) transferStatus.textContent = error?.message || 'Transfer failed.';
  } finally {
    transferSendButton.disabled = false;
  }
}

async function deleteTransfer(id){
  const response = await scheduleFetch('transfer/delete', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ id })
  });
  if (!response.ok) throw new Error('Could not delete');
  transferItems = transferItems.filter(item => item.id !== id);
  renderTransfers();
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
  const events = [...coolEvents]
    .filter(event => event && event.dueAt && new Date(event.dueAt).getTime() >= now - 60000)
    .sort((a,b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  if (!events.length){
    coolDeadlinesEl.innerHTML = '<div class="cool-empty-key"><strong>NO COOL ENTRIES</strong><small>SYNCED · CLEAR</small></div>';
    renderCoolDeadlineDots();
    return;
  }

  coolDeadlinesEl.innerHTML = events.map(event => {
    const due = new Date(event.dueAt);
    const done = coolDone.has(event.id);
    const dueLabel = coolDueLabel(event).toUpperCase();
    const course = String(event.course || 'NTU COOL').toUpperCase();

    const hours = Math.max(0, (due.getTime() - now) / 3600000);
    const urgency = hours <= 12 ? 'urgent' : (hours <= 72 ? 'soon' : '');
    const progress = Math.round(Math.max(12, Math.min(92, 92 - (hours / 168) * 70)));

    return `
      <article class="cool-key-row ${urgency} ${done ? 'is-finished' : ''}" data-event-id="${escapeHtml(event.id)}">
        <div class="cool-deadline-key" aria-label="Deadline ${escapeHtml(dueLabel)}">
          <span class="cool-deadline-mon">${escapeHtml(shortMonths[due.getMonth()].toUpperCase())}</span>
          <strong class="cool-deadline-day">${String(due.getDate()).padStart(2,'0')}</strong>
          <small class="cool-deadline-time">${event.allDay ? 'ALL DAY' : escapeHtml(displayTime(`${String(due.getHours()).padStart(2,'0')}:${String(due.getMinutes()).padStart(2,'0')}`).replace(' ',''))}</small>
        </div>
        <a class="cool-entry-key" href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer external">
          <span class="cool-entry-title">${escapeHtml(event.title)}</span>
          <span class="cool-entry-meta">${escapeHtml(course)} · ${escapeHtml(done ? 'FINISHED' : dueLabel)}</span>
          <span class="cool-entry-bar" aria-hidden="true"><i style="--p:${progress}%"></i></span>
        </a>
        <button
          class="cool-finish-key ${done ? 'is-pressed' : ''}"
          type="button"
          data-event-id="${escapeHtml(event.id)}"
          aria-pressed="${done}"
          aria-label="${done ? 'Mark as not finished' : 'Mark as finished'}">
          <span class="keylegend">DONE</span>
          <span class="cool-finish-label">${done ? '✓' : 'FINISH'}</span>
        </button>
      </article>`;
  }).join('');

  coolDeadlinesEl.querySelectorAll('.cool-finish-key').forEach(button => {
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
    const response = await scheduleFetch('cool-calendar', { cache: force ? 'reload' : 'no-cache' });
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

function isLessonInactive(day, lesson, date = dateForDay(day)){
  if (lesson.course !== 'mechanism') return false;
  if (day === 1) return true;
  return day === 3 && mechanismNoOnsiteDates.has(dateKey(date));
}

function isCurrentLesson(day, lesson){
  const now = new Date();
  if (now.getDay() !== day || isLessonInactive(day, lesson, now)) return false;
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
  const semesterStart = new Date(2026, 8, 7, 12, 0, 0, 0);
  const semesterWeek = Math.max(1, Math.floor((date.getTime() - semesterStart.getTime()) / 604800000) + 1);

  selectedDayEl.textContent = dayNames[selectedDay];
  selectedDateEl.textContent = `${shortMonths[date.getMonth()].toUpperCase()} ${String(date.getDate()).padStart(2,'0')} / WEEK ${String(semesterWeek).padStart(2,'0')}`;
  const openSlots = Math.max(0, 4 - lessons.length);
  classCountEl.textContent = `${String(lessons.length).padStart(2,'0')} ${lessons.length === 1 ? 'CLASS' : 'CLASSES'} · ${String(openSlots).padStart(2,'0')} ${openSlots === 1 ? 'OPEN SLOT' : 'OPEN SLOTS'}`;

  dayButtons.forEach(btn => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active', day === selectedDay);
    btn.classList.toggle('today', day === new Date().getDay());
    const small = btn.querySelector('small');
    if (small) small.textContent = String(dateForDay(day).getDate()).padStart(2,'0');
    btn.setAttribute('aria-pressed', day === selectedDay ? 'true' : 'false');
  });

  const reminder = dateReminders[dateKey(date)];
  const reminderHtml = reminder
    ? `<div class="date-reminder-skeuo" title="${escapeHtml(reminder.text)}">${escapeHtml(reminder.text)}</div>`
    : '';

  const codes = {
    mechanism:'ME-MECH', engmath:'ME2001', statics:'ME-STAT', intro:'ME-INTRO',
    materials:'ME-MAT', pe:'PE', psychology:'PSY', chinese:'CHN', english:'ENG', icl:'ICL'
  };

  const lessonHtml = lessons.map((lesson,index) => {
    const course = courses[lesson.course];
    const inactive = isLessonInactive(selectedDay, lesson, date);
    const live = !inactive && isCurrentLesson(selectedDay, lesson);
    const completed = !inactive && isLessonCompleted(selectedDay, lesson, date);
    const meta = inactive
      ? 'NO LECTURE'
      : `${course.location.toUpperCase()}${live ? ' · HAPPENING NOW' : ''}`;

    const desktopStatic = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    return `
      <div class="lesson ${live ? 'live' : ''} ${completed ? 'completed' : ''} ${inactive ? 'inactive' : ''}"
           data-index="${index}" role="${inactive || desktopStatic ? 'presentation' : 'button'}" ${inactive ? 'aria-disabled="true"' : (desktopStatic ? '' : 'tabindex="0"')}
           style="--course:${course.color}">
        <div class="time"><span class="time-slot"><span class="time-start">${lesson.start}</span><span class="time-sep">–</span><span class="time-end">${lesson.end}</span></span>${lesson.period ? `<span class="time-period">PERIOD ${escapeHtml(lesson.period)}</span>` : ""}</div>
        <div class="lessoncard">
          <strong>${escapeHtml(course.name)}</strong>
          <small>${escapeHtml(meta)}</small>
          <span class="card-code">${escapeHtml(codes[lesson.course] || lesson.course.toUpperCase())}</span>
        </div>
      </div>`;
  }).join('');

  const emptyHtml = Array.from({ length:openSlots }, (_,slot) => `
    <div class="lesson open-slot">
      <div class="time"><span class="time-slot"><span class="time-start">—</span><span class="time-sep">·</span><span class="time-end">OPEN</span></span><span class="time-period">NO PERIOD</span></div>
      <div class="lessoncard" style="opacity:.52;--course:#6d7069">
        <strong>${lessons.length || slot ? 'Open schedule slot' : 'No classes'}</strong>
        <small>SCHEDULE SLOT AVAILABLE</small>
        <span class="card-code">EMPTY</span>
      </div>
    </div>`).join('');

  list.innerHTML = reminderHtml + lessonHtml + emptyHtml;

  list.querySelectorAll('.lesson[data-index]:not(.inactive)').forEach(item => {
    const canOpenLesson = () => !window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    const open = () => {
      if (!canOpenLesson()) return;
      const lesson = lessons[Number(item.dataset.index)];
      if (lesson) openLesson(lesson, selectedDay);
    };
    item.addEventListener('click', open);
    item.addEventListener('keydown', event => {
      if (!canOpenLesson()) return;
      if (event.key === 'Enter' || event.key === ' '){
        event.preventDefault();
        open();
      }
    });
  });
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

function hanziWidgetStatus(){
  if (!hanziWidgetData) return hanziWidgetError ? 'OFFLINE' : 'SYNCING';
  if (hanziWidgetData.practicedToday) return 'STREAK SECURED';
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone:'Asia/Taipei',
    hour:'2-digit',
    hour12:false
  }).format(new Date())) % 24;
  if (hour >= 23) return 'LAST HOUR';
  if (hour >= 21) return 'STREAK AT RISK';
  if (hour >= 18) return 'KEEP IT GOING';
  return 'TODAY';
}

function hanziWidgetMarkup(){
  if (!hanziWidgetData){
    return `
      <div class="streak"><span class="micro">HANZI STEPS</span><b>—</b><span class="micro">DAY STREAK</span></div>
      <div class="next"><div class="nexthead"><span class="micro">UP NEXT / SYNC</span><span class="micro">—/10</span></div><div class="charline"><span class="char">字</span><span class="pinyin">${hanziWidgetError ? 'offline' : 'syncing'}<small>${hanziWidgetError ? 'live progress unavailable' : 'live progress…'}</small></span></div></div>
      <span class="panel-code">HS-AUX/SYNC</span>`;
  }

  const data = hanziWidgetData;
  const next = (Array.isArray(data.nextCharacters) && data.nextCharacters.length
    ? data.nextCharacters[0]
    : data.nextCharacter) || {};
  const goal = Math.max(1, Number(data.todayGoal) || 10);
  const progress = Math.max(0, Math.min(goal, Number(data.todayProgress) || 0));
  const unit = next.unit || data.unit || '';

  return `
    <div class="streak"><span class="micro">HANZI STEPS</span><b>${escapeHtml(String(data.streak))}</b><span class="micro">DAY STREAK</span></div>
    <div class="next">
      <div class="nexthead"><span class="micro">UP NEXT / UNIT ${escapeHtml(String(unit))}</span><span class="micro">${progress}/${goal}</span></div>
      <div class="charline"><span class="char">${escapeHtml(next.character || '字')}</span><span class="pinyin">${escapeHtml(next.pinyin || '')}<small>${escapeHtml(next.meaning || 'next character')}</small></span></div>
    </div>
    <span class="panel-code">HS-AUX/${escapeHtml(String(unit || 'LIVE'))}</span>`;
}

async function loadHanziWidget(){
  if (hanziWidgetLoading) return;
  hanziWidgetLoading = true;
  try {
    const response = await scheduleFetch('hanzi-widget', { cache:'no-store' });
    if (!response.ok) throw new Error('Hanzi widget request failed');
    const data = await response.json();
    if (!data || typeof data.streak !== 'number') throw new Error('Invalid Hanzi widget payload');
    hanziWidgetData = data;
    hanziWidgetError = false;
    try { localStorage.setItem(HANZI_WIDGET_CACHE_KEY, JSON.stringify(data)); } catch (error) {}
  } catch (error) {
    hanziWidgetError = true;
  } finally {
    hanziWidgetLoading = false;
    renderNextClass();
  }
}

function renderNextClass(){
  const next = getNextClass();

  if (!next){
    nextClassEl.innerHTML = '<span class="eyebrow">UP NEXT / CHANNEL 01</span><strong>No upcoming classes</strong><p>SCHEDULE CLEAR</p>';
  } else {
    const course = courses[next.lesson.course];
    if (next.state === 'Now'){
      const remaining = countdownText(next.endAt).replace(/^in /,'').toUpperCase();
      nextClassEl.innerHTML = `<span class="eyebrow">HAPPENING NOW / CHANNEL 01</span><strong>${escapeHtml(course.name)}</strong><p>${escapeHtml(course.location.toUpperCase())} · END ${next.lesson.end} · ${escapeHtml(remaining)} REMAINING</p>`;
    } else {
      const until = countdownText(next.startAt).toUpperCase();
      nextClassEl.innerHTML = `<span class="eyebrow">UP NEXT / CHANNEL 01</span><strong>${escapeHtml(course.name)}</strong><p>${escapeHtml(course.location.toUpperCase())} · START ${next.lesson.start} · ${escapeHtml(until)}</p>`;
    }
  }

  if (hanziWidgetSlot) hanziWidgetSlot.innerHTML = hanziWidgetMarkup();
}

function openLesson(lesson, day){
  dialogLesson = lesson;
  const course = courses[lesson.course];
  dialog.style.setProperty('--dialog-color', course.color);
  document.getElementById('dialogDay').textContent = dayNames[day];
  document.getElementById('dialogTitle').textContent = course.name;
  document.getElementById('dialogTime').textContent = `${displayTime(lesson.start)} – ${displayTime(lesson.end)}${lesson.period ? ` · Period ${lesson.period}` : ''}`;
  const url = mapLinks[lesson.course];
  const meetingUrl = meetingLinks[lesson.course];
  document.getElementById('dialogLocation').textContent = course.location;
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
  const response = await scheduleFetch('push/config', { cache:'no-store' });
  if (!response.ok) throw new Error('Could not load push configuration');
  pushConfig = await response.json();
  if (vapidPrivateValue) vapidPrivateValue.textContent = pushConfig.privateKey || 'Unavailable';
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
      try { localStorage.setItem('ntu-mail-push-enabled', '1'); } catch (error) {}
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

    const response = await scheduleFetch('push/subscribe', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ subscription:subscription.toJSON() })
    });
    if (!response.ok) throw new Error('Could not save subscription');

    try { localStorage.setItem('ntu-mail-push-enabled', '1'); } catch (error) {}
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
    const response = await scheduleFetch('push/test', { method:'POST' });
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
    if (localStorage.getItem('ntu-mail-push-enabled') === '1' && mailAlertStatus) mailAlertStatus.textContent = 'Enabled on this device';
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

if (closePairingDialog) closePairingDialog.addEventListener('click', () => {
  if (schedulePairingKey) pairingDialog?.close();
});
if (pairingDialog) pairingDialog.addEventListener('cancel', event => {
  if (!schedulePairingKey) event.preventDefault();
});
if (pairingForm) pairingForm.addEventListener('submit', async event => {
  event.preventDefault();
  const candidate = String(pairingInput?.value || '').trim();
  if (candidate.length < 32 || candidate.length > 200){
    if (pairingStatus) pairingStatus.textContent = 'That pairing key is not valid.';
    return;
  }

  const submit = pairingForm.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  if (pairingStatus) pairingStatus.textContent = 'Pairing…';

  try {
    const response = await fetch(scheduleApiUrl('status'), {
      headers:{ 'x-schedule-key':candidate },
      cache:'no-store'
    });
    if (!response.ok) throw new Error('Pairing key not recognized.');

    schedulePairingKey = candidate;
    localStorage.setItem(SCHEDULE_PAIRING_KEY, candidate);
    if (pairingInput) pairingInput.value = '';
    if (pairingStatus) pairingStatus.textContent = 'Paired.';
    pairingDialog?.close();

    void syncTodos();
    void loadHanziWidget();
    void loadCoolDeadlines(true);
    void loadTransfers();
  } catch (error) {
    if (pairingStatus) pairingStatus.textContent = error?.message || 'Could not pair this device.';
  } finally {
    if (submit) submit.disabled = false;
  }
});

if (!schedulePairingKey){
  queueMicrotask(() => showPairingDialog());
}


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

dayButtons.forEach(btn => btn.addEventListener('click', () => {
  selectedDay = Number(btn.dataset.day);
  renderDay();
}));

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

if (transferForm){
  transferForm.addEventListener('submit', event => {
    event.preventDefault();
    void submitTransfers(event);
  });
}
if (transferSendButton){
  transferSendButton.addEventListener('click', event => {
    event.preventDefault();
    void submitTransfers(event);
  });
}
if (transferRefresh) transferRefresh.addEventListener('click', () => loadTransfers());
if (transferMoreButton){
  transferMoreButton.addEventListener('click', () => {
    transferExpanded = !transferExpanded;
    renderTransfers();
  });
}

if (closeTransferSaveDialog && transferSaveDialog){
  closeTransferSaveDialog.addEventListener('click', () => transferSaveDialog.close());
}
if (transferSaveDialog){
  transferSaveDialog.addEventListener('click', event => {
    if (event.target === transferSaveDialog) transferSaveDialog.close();
  });
}
if (transferNativeSaveButton){
  transferNativeSaveButton.addEventListener('click', async () => {
    const file = preparedTransferFiles.get(activePreparedTransferId);
    if (!file){
      if (transferSaveHint) transferSaveHint.textContent = 'The prepared file is no longer available. Close this and tap Prepare again.';
      return;
    }

    if (isPdfTransferFile(file)){
      openPreparedTransferFile(file);
      if (transferStatus) transferStatus.textContent = file.name + ' opened in the PDF viewer.';
      if (transferSaveDialog?.open) transferSaveDialog.close();
      return;
    }

    const shareData = { files:[file] };
    const canShareFile = Boolean(navigator.share)
      && (!navigator.canShare || navigator.canShare(shareData));

    if (!canShareFile){
      openPreparedTransferFile(file);
      if (transferStatus) transferStatus.textContent = file.name + ' opened for saving.';
      if (transferSaveDialog?.open) transferSaveDialog.close();
      return;
    }

    transferNativeSaveButton.disabled = true;
    transferNativeSaveButton.textContent = 'Opening…';

    try {
      await navigator.share(shareData);
      if (transferStatus) transferStatus.textContent = file.name + ' was handed to iOS.';
      if (transferSaveDialog?.open) transferSaveDialog.close();
    } catch (error) {
      if (error?.name !== 'AbortError' && transferSaveHint){
        transferSaveHint.textContent = 'iOS could not open the share sheet. Tap Save to Files again, or open the site in Safari.';
      }
    } finally {
      transferNativeSaveButton.disabled = false;
      transferNativeSaveButton.textContent = 'Save to Files';
    }
  });
}

if (transferFileInput){
  transferFileInput.addEventListener('change', () => {
    const files = [...(transferFileInput.files || [])];
    if (!transferFileLabel) return;
    transferFileLabel.textContent = files.length === 0
      ? 'Add file'
      : files.length === 1
        ? (isMovFile(files[0]) ? `${files[0].name} → MP4` : files[0].name)
        : `${files.length} files selected`;

    const movCount = files.filter(isMovFile).length;
    if (movCount && transferStatus){
      transferStatus.textContent = movCount === 1
        ? 'MOV will be converted to MP4 automatically before upload.'
        : `${movCount} MOV files will be converted to MP4 automatically before upload.`;
    }
  });
}
if (transferList){
  transferList.addEventListener('click', async event => {
    const button = event.target.closest('[data-transfer-action]');
    if (!button) return;
    const id = button.dataset.id;
    const item = transferItems.find(entry => entry.id === id);
    if (!item) return;

    if (button.dataset.transferAction === 'copy'){
      try {
        await navigator.clipboard.writeText(item.content || '');
        const old = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = old; }, 1000);
      } catch (error) {
        if (transferStatus) transferStatus.textContent = 'Could not copy to clipboard.';
      }
    }

    if (button.dataset.transferAction === 'download'){
      try {
        await downloadTransferFile(item, button);
      } catch (error) {
        if (transferStatus) transferStatus.textContent = isIOSDevice()
          ? 'Could not save that file on iPhone.'
          : 'Could not download that file.';
      }
    }

    if (button.dataset.transferAction === 'delete'){
      button.disabled = true;
      try {
        await deleteTransfer(id);
        preparedTransferFiles.delete(id);
        if (transferStatus) transferStatus.textContent = 'Deleted from the transfer inbox.';
      } catch (error) {
        button.disabled = false;
        if (transferStatus) transferStatus.textContent = 'Could not delete that item.';
      }
    }
  });
}

let lastForegroundRefresh = 0;
function refreshForegroundData(force = false){
  if (document.hidden) return;
  const now = Date.now();
  if (!force && now - lastForegroundRefresh < 10000) return;
  lastForegroundRefresh = now;
  void loadTransfers(true);
  void syncTodos();
  void loadHanziWidget();
}
window.addEventListener('focus', () => refreshForegroundData());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshForegroundData();
});

renderDay();
renderNextClass();
renderTodos();
void syncTodos();
void loadHanziWidget();
loadCoolDeadlines();
loadTransfers();
lastForegroundRefresh = Date.now();
setInterval(() => {
  if (!document.hidden){ renderNextClass(); renderDay(); }
}, 30000);
setInterval(() => {
  if (!document.hidden) void loadHanziWidget();
}, 300000);
setInterval(() => {
  if (!document.hidden) void loadTransfers(true);
}, 12000);
setInterval(() => {
  if (!document.hidden) void syncTodos();
}, 60000);

/* Decoy-only hardware-console enhancements. Production site remains untouched. */
document.querySelectorAll('[data-open-url]').forEach(button => {
  button.addEventListener('click', () => {
    const url = button.dataset.openUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  });
});

const skeuoNext = document.getElementById('nextClass');
const skeuoLiveLed = document.getElementById('skeuoLiveLed');
const skeuoLiveState = document.getElementById('skeuoLiveState');

function syncSkeuoLiveIndicator(){
  if (!skeuoNext || !skeuoLiveLed || !skeuoLiveState) return;
  const label = String(skeuoNext.querySelector('.eyebrow')?.textContent || '').toLowerCase();
  const live = label.includes('happening');
  skeuoLiveLed.classList.toggle('off', !live);
  skeuoLiveState.textContent = live ? 'LIVE' : 'NEXT';
}

if (skeuoNext){
  new MutationObserver(syncSkeuoLiveIndicator).observe(skeuoNext, {
    childList:true,
    subtree:true,
    characterData:true
  });
}
syncSkeuoLiveIndicator();

/* Schedule interval oscilloscope.
   The displayed ΔT is real time to the next schedule boundary.
   Longer ΔT produces a longer wavelength; the trace compresses and jitters as the boundary approaches. */
const scheduleScope = document.getElementById('scheduleScope');
const scheduleScopeTrace = document.getElementById('scheduleScopeTrace');
const scheduleScopeValue = document.getElementById('scheduleScopeValue');
const scheduleScopeMode = document.getElementById('scheduleScopeMode');
const scheduleScopeReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let scheduleScopeState = { active:false, live:false, minutes:0, mode:'CLEAR', aria:'Schedule clear' };
let scheduleScopeLastMeta = 0;
let scheduleScopeLastDraw = 0;

function formatScheduleScopeDelta(ms){
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h${String(minutes).padStart(2,'0')}` : `${hours}h`;
}

function readScheduleScope(){
  const next = getNextClass();
  if (!next) return { active:false, live:false, minutes:0, mode:'CLEAR', aria:'Schedule interval monitor, no upcoming classes' };

  const live = next.state === 'Now';
  const target = live ? next.endAt : next.startAt;
  const deltaMs = Math.max(0, target.getTime() - Date.now());
  const value = formatScheduleScopeDelta(deltaMs);
  return {
    active:true,
    live,
    minutes:deltaMs / 60000,
    mode:live ? 'LIVE END' : 'NEXT START',
    value,
    aria:`Schedule interval monitor, ${value} ${live ? 'until the current class ends' : 'until the next class starts'}`
  };
}

function refreshScheduleScopeMeta(){
  if (!scheduleScope) return;
  scheduleScopeState = readScheduleScope();
  if (scheduleScopeValue) scheduleScopeValue.textContent = scheduleScopeState.active ? scheduleScopeState.value : '--';
  if (scheduleScopeMode) scheduleScopeMode.textContent = scheduleScopeState.mode;
  scheduleScope.setAttribute('aria-label', scheduleScopeState.aria);
}

function drawScheduleScope(timestamp=0){
  if (!scheduleScopeTrace) return;

  const width = 160;
  const mid = 21;
  const minutes = Math.max(0, scheduleScopeState.minutes || 0);
  const boundedMinutes = Math.min(360, minutes);
  const wavelength = scheduleScopeState.active
    ? 12 + Math.sqrt(boundedMinutes / 360) * 42
    : 80;
  const urgency = scheduleScopeState.active ? 1 - Math.min(1, minutes / 180) : 0;
  const amplitude = scheduleScopeState.active ? (scheduleScopeState.live ? 8.1 : 6.4) : 1.1;
  const phase = scheduleScopeReducedMotion ? 0 : timestamp * (0.00155 + urgency * 0.0042);
  const jitterStrength = scheduleScopeState.active ? 0.35 + urgency * 1.05 : 0.12;

  let d = '';
  for (let x=0; x<=width; x+=2){
    const base = Math.sin((x / wavelength) * Math.PI * 2 + phase) * amplitude;
    const jitter =
      Math.sin(x * 1.41 + phase * 3.2) * jitterStrength * 0.52 +
      Math.sin(x * 0.37 - phase * 1.7) * jitterStrength * 0.34;
    const y = mid + base + jitter;
    d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(2)} `;
  }
  scheduleScopeTrace.setAttribute('d', d.trim());
}

function animateScheduleScope(timestamp){
  if (!scheduleScope || !scheduleScopeTrace) return;

  if (timestamp - scheduleScopeLastMeta > 1000){
    scheduleScopeLastMeta = timestamp;
    refreshScheduleScopeMeta();
  }
  if (!document.hidden && scheduleScope.offsetParent !== null && timestamp - scheduleScopeLastDraw > 55){
    scheduleScopeLastDraw = timestamp;
    drawScheduleScope(timestamp);
  }
  requestAnimationFrame(animateScheduleScope);
}

if (scheduleScope && scheduleScopeTrace){
  refreshScheduleScopeMeta();
  drawScheduleScope(0);
  if (scheduleScopeReducedMotion){
    setInterval(() => {
      if (!document.hidden){
        refreshScheduleScopeMeta();
        drawScheduleScope(0);
      }
    }, 1000);
  } else {
    requestAnimationFrame(animateScheduleScope);
  }
}

if ('serviceWorker' in navigator){
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js?v=93', { updateViaCache:'none' });
      await registration.update();
    } catch (error) {}
  });
}
