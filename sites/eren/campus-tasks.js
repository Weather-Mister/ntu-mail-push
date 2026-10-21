// Eren's task link only. Mail, calendar, file transfers and Begüm keep their services.
(() => {
 if(window.SCHEDULE_MIGRATION?.app!=='eren')return;
 const campus='https://ntu.campusweek.workers.dev',bridge=campus+'/api/personal-tasks/bridge';
 const routes=new Set(['todos/list','todos/create','todos/update','todos/delete','todos/import']);
 const endpoints=new Set(['https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/ntu-schedule-api',window.SCHEDULE_MIGRATION.apiUrl.replace(/\/$/,'')]);
 const marker='campus-week:eren-tasks-linked-v1';let linked=false;
 try{linked=localStorage.getItem(marker)==='1';}catch{}
 const mark=()=>{linked=true;try{localStorage.setItem(marker,'1');}catch{}};
 const nonce=new URLSearchParams(location.hash.slice(1)).get('campus-tasks-link');
 const pairing=!!window.opener&&/^[a-f0-9]{48}$/.test(nonce||'');
 let sent=false,finish;
 const ready=pairing?new Promise(resolve=>{finish=resolve;}):Promise.resolve(true);
 const refresh=()=>window.dispatchEvent(new Event('schedule-todos-changed'));
 if(pairing){
  history.replaceState(null,'',location.pathname+location.search);
  const send=()=>{
   let key='';try{key=localStorage.getItem('ntu-schedule-pairing-key-v1')||'';}catch{}
   if(sent||key.length<32||key.length>200)return;sent=true;
   window.opener.postMessage({type:'eren-campus-task-key',nonce,key},campus);
  };
  window.addEventListener('schedule-pairing-changed',send);
  window.addEventListener('message',event=>{
   if(event.origin!==campus||event.source!==window.opener||event.data?.type!=='campus-task-link-result'||event.data.nonce!==nonce)return;
   if(event.data.ok===true){mark();finish(true);refresh();}else finish(false);
  });
  send();
 }
 const previous=window.fetch.bind(window);
 window.fetch=async function campusTasksFetch(input,init){
  const request=new Request(input instanceof Request?input:new URL(String(input),location.href),init),url=new URL(request.url),route=url.searchParams.get('route');
  if(!endpoints.has((url.origin+url.pathname).replace(/\/$/,''))||!routes.has(route))return previous(input,init);
  const key=request.headers.get('x-schedule-key')||'';
  if(!key)return previous(input,init);
  if(!await ready)throw new Error('The Campus Week task connection was not completed.');
  const response=await previous(bridge+'?route='+encodeURIComponent(route),{
   method:request.method,headers:{'x-schedule-key':key,...(request.method==='POST'?{'Content-Type':'application/json'}:{})},
   body:request.method==='POST'?await request.clone().text():undefined,credentials:'omit',cache:'no-store',redirect:'error',signal:request.signal
  });
  if(response.ok){mark();return response;}
  // Only an explicit, never-linked state can use the old store. Outages and key
  // failures after cutover must keep queued edits instead of creating two lists.
  if(!linked&&response.status===404&&(await response.clone().json().catch(()=>({}))).code==='not_linked')return previous(input,init);
  return response;
 };
 const check=()=>{if(linked&&!document.hidden&&navigator.onLine)refresh();};
 setInterval(check,10000);window.addEventListener('focus',check);window.addEventListener('online',check);document.addEventListener('visibilitychange',check);
 window.addEventListener('storage',event=>{if(event.key===marker&&event.newValue==='1'){linked=true;refresh();}});
})();
