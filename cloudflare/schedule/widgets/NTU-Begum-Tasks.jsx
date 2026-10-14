import {React, run} from 'uebersicht';
// Install just this file in Übersicht's widgets folder. No other files are needed.
// Adjust these numbers if you want to move or resize the card.
const PAIRING_KEY = 'begum';
const TOP = 230, RIGHT = 24, WIDTH = 368, HEIGHT = 385;
const SCHEDULE_URL = 'https://weather-mister.github.io/ntu-mail-push/begum/';

// Begüm NTU Schedule — same tasks on the website and desktop, via Cloudflare.
const API_URL = "https://begum-schedule-api.begum-schedule-fb773613.workers.dev";
const socketUrl = new URL(API_URL);
socketUrl.protocol = 'wss:';
socketUrl.searchParams.set('route','todos/socket');
const WS_URL = socketUrl.href;
const KEY = String(PAIRING_KEY || '').trim();
const CACHE_KEY = 'ntu-begum-uebersicht-manual-tasks-v1';
const VALID_KEY = KEY.toLowerCase() === 'begum';
const INSTANCE_KEY='__ntuBegumTasksV2'; // Stops the previous widget session after replacement.
let session=null,counter=0;
export const refreshFrequency=2000; // Local focus check; idle HTTP only every 15s.
export const className = `
  position: fixed;
  top: ${Math.max(0, Number(TOP) || 0)}px;
  right: ${Math.max(0, Number(RIGHT) || 0)}px;
  width: ${Math.max(300, Number(WIDTH) || 368)}px;
  height: ${Math.max(250, Number(HEIGHT) || 385)}px;
  pointer-events: auto;
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  -webkit-font-smoothing: antialiased;
  color: #39513e;
  .nt-tasks { box-sizing: border-box; position: relative; height: 100%; width: 100%; display: flex; flex-direction: column; overflow: hidden; padding: 19px; border-radius: 22px; border: 1px solid #dce6d1; background: rgba(255,253,247,.97); box-shadow: 0 8px 28px rgba(47,73,43,.12), inset 0 1px 0 rgba(255,255,255,.8); transition: background .28s ease, border-color .28s ease, box-shadow .28s ease; -webkit-backdrop-filter: blur(28px) saturate(120%); backdrop-filter: blur(28px) saturate(120%); }
  .nt-tasks * { box-sizing: border-box; }
  .nt-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 13px; flex: 0 0 auto; }
  .nt-heading-copy { min-width: 0; }
  .nt-eyebrow { margin: 0 0 7px; font-size: 9px; font-weight: 800; color: #7b9271; letter-spacing: .13em; line-height: 1.4; }
  .nt-title { font-family: 'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif; font-size: 25px; line-height: 1.12; font-weight: 600; letter-spacing: -.055em; }
  .nt-honey { flex: 0 0 auto; text-align: center; }
  .nt-jar { display: block; width: 57px; height: 45px; margin: -6px auto 1px; pointer-events: none; }
  .nt-count { display: block; background: #fff0ca; color: #9b702e; border: 1px solid #f1dca9; padding: 4px 8px; border-radius: 20px; font-size: 9px; line-height: 1.1; font-weight: 800; white-space: nowrap; }
  .nt-compose { display: flex; gap: 7px; margin: 0 0 10px; flex: 0 0 auto; }
  .nt-compose input { flex: 1; min-width: 0; min-height: 38px; border: 1px solid #dbe6d2; border-radius: 10px; background: #f9fbf3; color: #39513e; padding: 0 11px; font: inherit; font-size: 12px; outline: none; user-select: text; }
  .nt-compose input:focus { border-color: #6ca47a; box-shadow: 0 0 0 3px rgba(108,164,122,.13); }
  .nt-compose input::placeholder { color: #95a38b; }
  .nt-compose button { flex: 0 0 auto; min-width: 46px; border: 0; border-radius: 10px; background: #457952; color: white; font-family: inherit; font-size: 12px; font-weight: 750; cursor: pointer; }
  .nt-compose button:hover:not(:disabled) { background: #315f3f; }
  .nt-tasks button:disabled { opacity: .4; cursor: default; }
  .nt-tasks button:focus-visible { outline: 2px solid #6ca47a; outline-offset: 3px; }
  .nt-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #c6d8bd transparent; padding-right: 3px; }
  .nt-item { min-height: 40px; display: flex; gap: 10px; align-items: center; border-bottom: 1px dashed #e1e9d6; padding: 8px 0; }
  .nt-check { width: 20px; height: 20px; flex: 0 0 20px; border: 1.5px solid #9fbea5; border-radius: 7px; background: #fff; color: #fff; font-size: 13px; line-height: 17px; padding: 0; cursor: pointer; }
  .nt-check.is-done { background: #6ca47a; border-color: #6ca47a; }
  .nt-check:hover { border-color: #457952; }
  .nt-task-text { flex: 1; min-width: 0; overflow-wrap: anywhere; color: #536b58; font-size: 13px; font-weight: 500; line-height: 1.45; }
  .nt-task-text.is-done { color: #a3b1a3; text-decoration: line-through; }
  .nt-delete { flex: 0 0 26px; height: 26px; border: none; background: transparent; border-radius: 7px; color: #acb5a8; font-size: 20px; line-height: 1; cursor: pointer; }
  .nt-delete:hover { background: #fff1ee; color: #bb6f75; }
  .nt-empty { color: #7b9271; text-align: center; margin: auto; padding: 25px 12px; font-size: 12px; line-height: 1.65; }
  .nt-footer { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e1e9d6; font-size: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #7b9271; flex: 0 0 auto; }
  .nt-live { display: inline-flex; align-items: center; gap: 6px; }
  .nt-dot { width: 6px; height: 6px; display: inline-block; border-radius: 50%; background: #b6bbae; }
  .nt-dot.online { background: #6ca47a; }
  .nt-open { color: #457952; background: transparent; border: none; font-family: inherit; font-size: 10px; font-weight: 750; cursor: pointer; padding: 3px 0; white-space: nowrap; }
  .nt-open:hover { color: #315f3f; text-decoration: underline; text-underline-offset: 3px; }
  .nt-error { color: #b06468; font-size: 11px; line-height: 1.4; margin-bottom: 8px; }
  .nt-setup { color: #7b9271; line-height: 1.55; font-size: 13px; }
  .nt-footer-actions { display: flex; gap: 12px; }
  .nt-tasks.is-inactive { background: linear-gradient(145deg,rgba(255,253,247,.72),rgba(234,241,224,.48)); border-color: rgba(242,248,232,.72); box-shadow: inset 0 1px 0 rgba(255,255,255,.65),0 8px 24px rgba(40,58,35,.11); color: #39513e; }
  .is-inactive .nt-compose input { background: rgba(249,251,243,.45); border-color: rgba(169,190,155,.5); }
  .is-inactive .nt-count { background: rgba(255,240,202,.65); }
  .is-inactive .nt-check { background: rgba(255,255,255,.45); }
  .is-inactive .nt-check.is-done { background: #6ca47a; }
  @media (prefers-color-scheme: dark) {
    .nt-tasks.is-inactive { background: linear-gradient(145deg,rgba(48,65,46,.74),rgba(28,42,29,.60)); border-color: rgba(169,190,155,.28); color: #f4f5e9; }
    .is-inactive .nt-eyebrow, .is-inactive .nt-footer, .is-inactive .nt-open, .is-inactive .nt-empty, .is-inactive .nt-delete, .is-inactive .nt-setup { color: #c0d1ae; }
    .is-inactive .nt-task-text, .is-inactive .nt-compose input { color: #f4f5e9; }
    .is-inactive .nt-task-text.is-done { color: #93a28c; }
    .is-inactive .nt-compose input { background: rgba(226,240,216,.09); }
    .is-inactive .nt-compose input::placeholder { color: #aabc9c; }
    .is-inactive .nt-check { background: rgba(255,255,255,.10); }
    .is-inactive .nt-check.is-done { background: #6ca47a; }
    .is-inactive .nt-item, .is-inactive .nt-footer { border-color: rgba(169,190,155,.22); }
    .is-inactive .nt-count { background: rgba(255,240,202,.15); color: #f2d895; border-color: rgba(241,220,169,.24); }
    .is-inactive .nt-error { color: #f0b9b9; }
  }
  @media (prefers-reduced-transparency: reduce) { .nt-tasks.is-inactive { background: #eef3e6; } }
  @media (prefers-color-scheme: dark) and (prefers-reduced-transparency: reduce) { .nt-tasks.is-inactive { background: #2e412f; } }
  @media (prefers-reduced-motion: reduce) { .nt-tasks { transition: none; } }
`;

const validateTask = t => t && typeof t.id === 'string' && typeof t.text === 'string' && typeof t.done === 'boolean';
export const initialState={tasks:[],draft:'',loading:true,refreshing:false,connected:false,busy:false,error:'',saveError:'',configured:VALID_KEY,active:false,hasSnapshot:false};
export const updateState=(action,state=initialState)=>{
  switch(action.type){
    case 'TASKS': return {...state,tasks:action.tasks,loading:false,refreshing:false,error:'',hasSnapshot:true};
    case 'SAVED': return {...state,tasks:action.tasks,loading:false,error:'',saveError:'',hasSnapshot:true};
    case 'SAVE_ERROR': return {...state,saveError:action.error};
    case 'SAVE_CONFIRMED': return {...state,saveError:''};
    case 'REFRESHING': return {...state,refreshing:true};
    case 'CACHE': return {...state,tasks:action.tasks,loading:true};
    case 'DRAFT': return {...state,draft:action.value};
    case 'CLEAR_DRAFT': return {...state,draft:state.draft===action.value?'':state.draft};
    case 'BUSY': return {...state,busy:action.busy};
    case 'CONNECTED': return {...state,connected:action.connected};
    case 'ACTIVE': return {...state,active:action.active};
    case 'ERROR': return {...state,loading:false,refreshing:false,error:action.error};
    default: return state;
  }
};
const shellQuote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
function apiUrl(route){const url=new URL(API_URL);url.searchParams.set('route','todos/'+route);return url.href;}
function requestWithTimeout(request,timeout=20000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Request timed out.')),timeout);
    request.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
}
async function api(route,body){
  const args=['/usr/bin/curl','--silent','--show-error','--connect-timeout','8','--max-time','18','--request',body?'POST':'GET','--header','x-schedule-key: '+KEY,'--header','Cache-Control: no-cache','--write-out','\n%{http_code}'];
  if(body)args.push('--header','Content-Type: application/json','--data-raw',JSON.stringify(body));
  args.push(apiUrl(route));
  let output;
  try{output=await requestWithTimeout(run(args.map(shellQuote).join(' ')));}
  catch{throw new Error('Couldn’t connect. Your tasks are kept here; press Refresh to try again.');}
  const split=output.lastIndexOf('\n'),status=Number(output.slice(split+1).trim());
  if(split<0||!Number.isFinite(status))throw new Error('Couldn’t load tasks. Press Refresh to try again.');
  let result;try{result=JSON.parse(output.slice(0,split));}catch{throw new Error('Couldn’t load tasks. Press Refresh to try again.');}
  if(status<200||status>=300)throw new Error(status===401?'Pairing key not recognized.':(result && result.error)||'Couldn’t load tasks. Press Refresh to try again.');
  return result;
}
function current(s){return s&&!s.stopped&&session===s;}
function emit(s,event){if(current(s))s.dispatch(event);}
function snapshot(s,tasks,type='TASKS'){
  if(!current(s))return;
  s.tasks=tasks;emit(s,{type,tasks});
  try{localStorage.setItem(CACHE_KEY,JSON.stringify(tasks));}catch{}
  if(s.pendingCreate&&tasks.some(t=>t.id===s.pendingCreate.id&&t.text===s.pendingCreate.text)){
    emit(s,{type:'CLEAR_DRAFT',value:s.pendingCreate.draft});emit(s,{type:'SAVE_CONFIRMED'});s.pendingCreate=null;
  }
  const pending=s.pendingWrite;
  if(pending){
    const task=tasks.find(t=>t.id===pending.body.id);
    const confirmed=pending.route==='delete'?!task:pending.route==='update'?task&&task.done===pending.body.done:task&&task.text===pending.body.text;
    if(confirmed){s.pendingWrite=null;emit(s,{type:'SAVE_CONFIRMED'});if(pending.after)pending.after();}
  }
}
async function fetchTasks(s){
  if(!current(s))return;
  if(s.loading){s.reload=true;return;}
  s.loading=true;s.lastFetch=Date.now();const revision=s.revision;emit(s,{type:'REFRESHING'});
  try{
    const data=await api('list');
    if(!data||!Array.isArray(data.tasks)||!data.tasks.every(validateTask))throw new Error('Task list is invalid. Press Refresh to retry.');
    if(!current(s))return;
    if(revision!==s.revision){s.reload=true;return;}
    snapshot(s,data.tasks);
  }catch(error){emit(s,{type:'ERROR',error:error.message||'Network unavailable.'});}
  finally{s.loading=false;if(current(s)&&s.reload){s.reload=false;queueRefresh(s);}}
}
function queueRefresh(s){if(!current(s))return;clearTimeout(s.refreshTimer);s.refreshTimer=setTimeout(()=>{s.refreshTimer=null;void fetchTasks(s);},160);}
async function mutate(dispatch,route,body,after){
  const s=session;if(!current(s)||s.busy)return;
  s.pendingWrite={route,body,after};
  s.busy=true;s.revision++;emit(s,{type:'BUSY',busy:true});
  try{
    const data=await api(route,body);if(!current(s))return;
    if(route==='delete'?(!data||data.ok!==true):(!data||!validateTask(data.task)||data.task.id!==body.id))throw new Error('Couldn’t confirm the save. Press Refresh before trying again.');
    s.revision++;
    const tasks=route==='delete'?s.tasks.filter(t=>t.id!==body.id):route==='create'?[data.task,...s.tasks.filter(t=>t.id!==body.id)]:s.tasks.map(t=>t.id===body.id?data.task:t);
    s.pendingWrite=null;snapshot(s,tasks,'SAVED');if(after)after();await fetchTasks(s);
  }
  catch(error){if(s.pendingWrite)emit(s,{type:'SAVE_ERROR',error:error.message||'Could not save task.'});if(current(s))await fetchTasks(s);}
  finally{s.busy=false;emit(s,{type:'BUSY',busy:false});}
}
function newTaskId(){return 'mac-'+Date.now().toString(36)+'-'+(++counter).toString(36)+'-'+Math.random().toString(36).slice(2,12);}
function openSchedule(){run('/usr/bin/open '+shellQuote(SCHEDULE_URL)).catch(()=>{});}
function clearConnection(s){
  clearTimeout(s.retry);s.retry=null;clearTimeout(s.joinTimer);s.joinTimer=null;clearInterval(s.heartbeat);s.heartbeat=null;
  const old=s.socket;s.socket=null;s.joined=false;
  if(old){old.onopen=old.onmessage=old.onclose=old.onerror=null;try{old.close();}catch{}}
}
function retryConnection(s){
  if(!current(s))return;
  clearConnection(s);emit(s,{type:'CONNECTED',connected:false});
  if(navigator.onLine===false)return;
  s.retry=setTimeout(()=>connect(s),s.retryDelay);s.retryDelay=Math.min(s.retryDelay*2,30000);
}
function connect(s){
  if(!current(s))return;
  clearConnection(s);emit(s,{type:'CONNECTED',connected:false});if(navigator.onLine===false)return;
  let ws;try{ws=new WebSocket(WS_URL);}catch{retryConnection(s);return;}
  s.socket=ws;const alive=()=>current(s)&&s.socket===ws;
  s.joinTimer=setTimeout(()=>{if(alive())retryConnection(s);},12000);
  ws.onopen=()=>{if(alive())ws.send(JSON.stringify({event:'pair',key:KEY}));};
  ws.onmessage=e=>{
    if(!alive())return;let msg;try{msg=JSON.parse(e.data);}catch{return;}
    if(msg.event==='ready'){
      clearTimeout(s.joinTimer);s.joinTimer=null;s.joined=true;s.retryDelay=1500;emit(s,{type:'CONNECTED',connected:true});queueRefresh(s);
    }else if(msg.event==='changed'&&s.joined)queueRefresh(s);
  };
  ws.onclose=e=>{if(!alive())return;if(e.code===1008){clearConnection(s);emit(s,{type:'CONNECTED',connected:false});emit(s,{type:'ERROR',error:'Pairing key not recognized.'});return;}retryConnection(s);};
  ws.onerror=()=>{if(alive())try{ws.close();}catch{retryConnection(s);}};
}
function resume(s){if(current(s)){void fetchTasks(s);connect(s);}}
export const init=dispatch=>{
  if(window[INSTANCE_KEY])window[INSTANCE_KEY]();
  const s={dispatch,tasks:[],stopped:false,busy:false,loading:false,reload:false,revision:0,lastFetch:0,lastTick:Date.now(),retryDelay:1500,listeners:[]};session=s;
  const listen=(target,name,fn)=>{target.addEventListener(name,fn);s.listeners.push(()=>target.removeEventListener(name,fn));};
  const stop=()=>{if(s.stopped)return;s.stopped=true;clearConnection(s);clearTimeout(s.refreshTimer);if(s.observer)s.observer.disconnect();s.listeners.forEach(remove=>remove());if(window[INSTANCE_KEY]===stop)delete window[INSTANCE_KEY];};
  s.stop=stop;
  window[INSTANCE_KEY]=stop;if(!VALID_KEY)return;
  try{const tasks=JSON.parse(localStorage.getItem(CACHE_KEY)||'[]');if(Array.isArray(tasks)&&tasks.every(validateTask)&&tasks.length){s.tasks=tasks;emit(s,{type:'CACHE',tasks});}}catch{}
  emit(s,{type:'BUSY',busy:false});void fetchTasks(s);connect(s);
  listen(window,'online',()=>resume(s));
  listen(window,'offline',()=>{clearConnection(s);emit(s,{type:'CONNECTED',connected:false});emit(s,{type:'ERROR',error:'You’re offline. Displayed tasks are kept; reconnect to refresh.'});});
  listen(window,'focus',()=>{emit(s,{type:'ACTIVE',active:true});resume(s);});
  listen(window,'blur',()=>emit(s,{type:'ACTIVE',active:false}));
  listen(document,'visibilitychange',()=>{if(!document.hidden)resume(s);});
  listen(window,'pagehide',stop);
};
function attachCard(element){
  const s=session;if(!element||!current(s))return;s.element=element;
  if(!s.observer&&typeof MutationObserver==='function'){
    s.observer=new MutationObserver(()=>{if(current(s)&&s.element&&!s.element.isConnected)s.stop();});
    s.observer.observe(document.body,{childList:true,subtree:true});
  }
}
// NSWorkspace reads the frontmost app without System Events/Automation access.
const FOCUS_SCRIPT='ObjC.import("AppKit"); ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier)';
export const command=async dispatch=>{
  if(!session||session.stopped)init(dispatch);
  const s=session;if(!VALID_KEY||!current(s))return;s.dispatch=dispatch;
  const now=Date.now(),woke=now-s.lastTick>10000;s.lastTick=now;
  if(woke)resume(s);else if(now-s.lastFetch>=15000&&!s.busy)void fetchTasks(s);
  try{const app=(await requestWithTimeout(run('/usr/bin/osascript -l JavaScript -e '+shellQuote(FOCUS_SCRIPT)),1800)).trim().toLowerCase();emit(s,{type:'ACTIVE',active:app==='com.apple.finder'||app==='tracesof.uebersicht'});}
  catch{/* Use focus/blur fallback when macOS cannot report the active app. */}
};

const HoneyJar=()=> <svg className="nt-jar" viewBox="0 0 64 50" aria-hidden="true" focusable="false">
  <path d="M51 38c1-7 1-15-2-20m2 12c6-1 7-5 7-5-5-1-7 1-7 5m0 5c-5-1-7-4-7-4 5-2 7 0 7 4" fill="#9fbea5" stroke="#7d9c76" strokeWidth="1.4" strokeLinecap="round"/>
  <g transform="translate(49 17)"><ellipse rx="3.4" ry="6" fill="#edb8bf" transform="rotate(-18) translate(0 -4)"/><ellipse rx="3.4" ry="6" fill="#edb8bf" transform="rotate(72) translate(0 -4)"/><ellipse rx="3.4" ry="6" fill="#edb8bf" transform="rotate(162) translate(0 -4)"/><ellipse rx="3.4" ry="6" fill="#edb8bf" transform="rotate(252) translate(0 -4)"/><circle r="3.2" fill="#f3d47b"/></g>
  <g transform="rotate(8 25 27)"><rect x="12" y="12" width="25" height="33" rx="8" fill="#fff6dc" stroke="#d8b46c" strokeWidth="1.2"/><path d="M13 25c4 2 8-2 12 0s8 3 11 0v12a7 7 0 0 1-7 7H20a7 7 0 0 1-7-7Z" fill="#efc561"/><rect x="11" y="9" width="27" height="7" rx="3" fill="#9fbea5" stroke="#7d9c76" strokeWidth="1.2"/><path d="M16 10v4m4-4v4m4-4v4m4-4v4m4-4v4" stroke="#dce6d1" strokeWidth="1"/><rect x="17" y="28" width="15" height="11" rx="4" fill="#fff9e9"/><path d="m21 33 2 2 4-4" fill="none" stroke="#9b702e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></g>
  <g transform="translate(7 8) rotate(-20)"><ellipse cx="-1" cy="-3" rx="3" ry="4" fill="#fffdf7" stroke="#b5c5b0" strokeWidth=".8"/><ellipse cx="3" cy="-3" rx="3" ry="4" fill="#fffdf7" stroke="#b5c5b0" strokeWidth=".8"/><ellipse rx="5.5" ry="3.5" fill="#efc561"/><path d="M-1-3v6m3-6v6" stroke="#7c6c45" strokeWidth="1.3"/><circle cx="5" cy="-.5" r=".8" fill="#7c6c45"/></g>
</svg>;

export const render=(state,dispatch)=>{
  if(!state.configured)return <div className={'nt-tasks'+(state.active?' is-active':' is-inactive')}><p className="nt-eyebrow">NTU · BEGÜM</p><div className="nt-title">The honey-do list</div><p className="nt-setup">Set <code>PAIRING_KEY</code> to <b>begum</b> at the top of this file. Save the file, then refresh widgets.</p><button className="nt-open" onClick={openSchedule}>Open schedule ↗</button></div>;
  const active=state.tasks.filter(t=>!t.done).length;
  const error=state.saveError||state.error;
  const add=()=>{
    const text=state.draft.trim().slice(0,500),s=session;if(!text||state.busy||!current(s))return;
    if(!s.pendingCreate||s.pendingCreate.text!==text)s.pendingCreate={id:newTaskId(),text,draft:state.draft};
    else s.pendingCreate.draft=state.draft;
    void mutate(dispatch,'create',{id:s.pendingCreate.id,text},()=>dispatch({type:'CLEAR_DRAFT',value:state.draft}));
  };
  return <div ref={element=>attachCard(element)} className={'nt-tasks'+(state.active?' is-active':' is-inactive')}>
    <div className="nt-heading"><div className="nt-heading-copy"><p className="nt-eyebrow">SWEET LITTLE THINGS</p><div className="nt-title">The honey-do list</div></div><div className="nt-honey"><HoneyJar/><span className="nt-count">{active} {active===1?'task':'tasks'}</span></div></div>
    <div className="nt-compose">
      <input type="text" maxLength={500} placeholder="Add a task…" aria-label="New task" value={state.draft} onChange={e=>dispatch({type:'DRAFT',value:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&!e.isComposing&&!(e.nativeEvent&&e.nativeEvent.isComposing)&&e.keyCode!==229){e.preventDefault();add()}}}/>
      <button type="button" onClick={add} disabled={state.busy||!state.draft.trim()}>Add</button>
    </div>
    {error&&<div className="nt-error" role="alert">{error}</div>}
    <div className="nt-list">
      {state.loading&&!state.tasks.length?<div className="nt-empty">Loading tasks…</div>:
       !state.tasks.length&&state.error?<div className="nt-empty">Your tasks will appear when the connection is restored.</div>:
       !state.tasks.length?<div className="nt-empty">No manual tasks yet.<br/>Add one above to sync it with your schedule.</div>:
       state.tasks.map(task=><div className="nt-item" key={task.id}>
         <button type="button" className={'nt-check'+(task.done?' is-done':'')} aria-label={task.done?'Mark as not done':'Mark as done'} disabled={state.busy} onClick={()=>void mutate(dispatch,'update',{id:task.id,done:!task.done})}>{task.done?'✓':''}</button>
         <span className={'nt-task-text'+(task.done?' is-done':'')}>{task.text}</span>
         <button type="button" className="nt-delete" aria-label="Delete task" disabled={state.busy} onClick={()=>void mutate(dispatch,'delete',{id:task.id})}>×</button>
       </div>)}
    </div>
    <div className="nt-footer"><span className="nt-live"><i className={'nt-dot'+(state.hasSnapshot&&!error?' online':'')}/>{state.saveError?'Save failed':state.error?'Offline':state.busy?'Saving…':state.loading?'Loading…':state.refreshing?'Refreshing…':'Up to date'}</span><span className="nt-footer-actions"><button type="button" className="nt-open" aria-label="Refresh tasks" disabled={state.refreshing||state.busy} onClick={()=>resume(session)}>↻ Refresh</button><button type="button" className="nt-open" onClick={openSchedule}>Schedule ↗</button></span></div>
  </div>
};
