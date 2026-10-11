/* Eren Mail. Keeps the original mailx shell and visual language; no mock mail. */
(() => {
  'use strict';
  const API='https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/eren-mail';
  const PREF='eren-mail-preferences-v1', DRAFT='eren-mail-draft-v1', OAUTH='eren-mail-oauth-v1', LAYOUT='eren-mail-layout-v2', FLOATING='eren-mail-floating-v1';
  const translationCache=new Map(),translatedOpen=new Set();
  const isSkeuoDemo=()=>location.pathname.endsWith('/skeuo-demo.html');
  const hasChinese=text=>/[\u3400-\u9fff]/.test(String(text||''));
  const translationKey=(thread,msg)=>thread.accountId+':'+msg.id;
  const wantsEnglish=(thread,msg)=>translatedOpen.has(translationKey(thread,msg))&&translationCache.has(translationKey(thread,msg));
  const state={filter:'inbox',account:'all',query:'',accounts:[],messages:[],selected:null,thread:null,cursor:{},hasMore:false,history:[],redo:[],replyContext:null,loadVersion:0,readVersion:0,composeVersion:0,editVersion:0,busySend:false,busyAi:false,requestId:null,requestPayload:null,draftId:null};
  let messagesKey='',bootstrapRequest=null,bootstrapAt=0;
  function bootstrap(){if(!bootstrapRequest||Date.now()-bootstrapAt>30000){bootstrapAt=Date.now();bootstrapRequest=api('bootstrap').catch(e=>{bootstrapRequest=null;throw e;});}return bootstrapRequest;}
  const pageCache=new Map(),threadCache=new Map(),threadRequests=new Map(),threadImageRequests=new Map(),getRequests=new Map();
  let cacheOwner='',cacheEpoch=0,initialized=false,preferenceTimer;
  function clearPageCache(){bootstrapRequest=null;pageCache.clear();}
  const viewKey=()=>JSON.stringify([state.account,state.filter,state.query]);
  const threadKey=m=>m.accountId+':'+m.threadId;
  function clearMailCache(){translationCache.clear();translatedOpen.clear();bootstrapRequest=null;cacheEpoch++;pageCache.clear();threadCache.clear();threadRequests.clear();threadImageRequests.clear();getRequests.clear();}
  function ownCache(){const owner=typeof requirePairing==='function'?requirePairing():'';if(cacheOwner&&cacheOwner!==owner){clearMailCache();state.readVersion++;state.loadVersion++;initialized=false;state.accounts=[];state.messages=[];state.thread=null;}cacheOwner=owner;return owner;}
  function putCache(cache,key,value,limit=20){cache.delete(key);cache.set(key,{value,at:Date.now()});while(cache.size>limit)cache.delete(cache.keys().next().value);}
  async function fetchThread(m,force=false){
    const key=threadKey(m),cached=threadCache.get(key);if(!force&&cached&&Date.now()-cached.at<45000)return cached.value;
    if(threadRequests.has(key))return threadRequests.get(key);
    const owner=cacheOwner,epoch=cacheEpoch;const pending=api('thread',null,{accountId:m.accountId,threadId:m.threadId}).then(t=>{if(owner===cacheOwner&&epoch===cacheEpoch&&t.messages.reduce((n,m)=>n+(m.html?.length||0)+(m.text?.length||0),0)<2000000)putCache(threadCache,key,t,8);return t;});threadRequests.set(key,pending);
    try{return await pending;}finally{if(threadRequests.get(key)===pending)threadRequests.delete(key);}
  }
  function hydrateThreadImages(m,version){
    const key=threadKey(m),cached=threadCache.get(key)?.value;
    if(!cached||cached.imagesLoaded||!cached.messages?.some(msg=>msg.hasInlineImages)||threadImageRequests.has(key))return;
    const owner=cacheOwner,epoch=cacheEpoch;
    const pending=api('thread',null,{accountId:m.accountId,threadId:m.threadId,images:1}).then(t=>{
      if(owner!==cacheOwner||epoch!==cacheEpoch)return;
      if(t.messages.reduce((n,msg)=>n+(msg.html?.length||0)+(msg.text?.length||0),0)<2000000)putCache(threadCache,key,t,8);
      if(version===state.readVersion&&state.selected===key&&state.thread){
        state.thread=t;
        $$('[data-body]').forEach(frame=>{const i=Number(frame.dataset.body);if(frame.dataset.loaded==='1'&&t.messages[i]?.html)frame.srcdoc=t.messages[i].html;});
      }
    }).catch(()=>{}).finally(()=>{if(threadImageRequests.get(key)===pending)threadImageRequests.delete(key);});
    threadImageRequests.set(key,pending);
  }
  function prefetchReaders(){
    if(!dialog.open||navigator.connection?.saveData)return;
    const targets=state.messages.slice(0,2);
    const run=()=>targets.forEach((m,i)=>setTimeout(()=>{if(dialog.open)fetchThread(m).catch(()=>{});},i*250));
    if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:1200});else setTimeout(run,300);
  }
  let dialog,shell,listEl,readerEl,searchEl,accountEls=[],toastTimer,searchTimer,draftTimer,draftSaveChain=Promise.resolve(),status={types:['University','Personal','Finance','Shopping','Travel','Work','Security','Login Code','Receipt / Order','Newsletter','Promotion','Account Notification','Social','Other'],priorities:['High','Normal','Low','Muted'],actions:['Needs reply','Deadline','Waiting','FYI','No action']},rules=[];
  const isEmbedded=()=>!!dialog?.classList?.contains('mail-console-view');
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const $=s=>dialog.querySelector(s), $$=s=>[...dialog.querySelectorAll(s)];
  const views={inbox:'Inbox',unread:'Unread',starred:'Starred',trash:'Trash',important:'Important',reply:'Needs reply',codes:'Codes',low:'Low',all:'All mail',blocked:'Blocked',archived:'Archived',sent:'Sent',drafts:'Drafts',outbox:'Outbox'};
  const categoryLabel=k=>views[k]||'Mail';
  const accountName=id=>state.accounts.find(a=>a.id===id)?.display_name||'Account';
  const time=t=>{const d=new Date(t),opts={month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'};if(d.getFullYear()!==new Date().getFullYear())opts.year='numeric';return d.toLocaleString([],opts);};
  const option=(v,label,selected)=>`<option value="${escapeHtml(v)}"${selected===v?' selected':''}>${escapeHtml(label)}</option>`;
  function readStore(key,fallback){try{return JSON.parse(sessionStorage.getItem(key)||'null')||fallback;}catch{return fallback;}}
  function writeStore(key,value){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}}
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function bindPointerDrag(el,hooks={}){
    if(!el||el.dataset.mailxDragBound)return;
    el.dataset.mailxDragBound='1';
    el.addEventListener('pointerdown',e=>{
      if(e.isPrimary===false||(e.button!==undefined&&e.button!==0)||(hooks.canStart&&!hooks.canStart(e)))return;
      const id=e.pointerId,startX=e.clientX,startY=e.clientY;
      let active=true,raf=0,lastEvent=e;
      const emit=(name,ev)=>hooks[name]?.({event:ev,startX,startY,x:ev.clientX,y:ev.clientY,dx:ev.clientX-startX,dy:ev.clientY-startY});
      try{el.setPointerCapture?.(id);}catch{}
      emit('onStart',e);
      const move=ev=>{
        if(!active||ev.pointerId!==id)return;
        lastEvent=ev;
        cancelAnimationFrame(raf);
        raf=requestAnimationFrame(()=>emit('onMove',lastEvent));
      };
      const finish=(ev,cancelled=false)=>{
        if(!active||ev.pointerId!==id)return;
        active=false;
        if(raf){cancelAnimationFrame(raf);if(!cancelled)emit('onMove',lastEvent);}
        el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',cancel);
        try{if(el.hasPointerCapture?.(id))el.releasePointerCapture(id);}catch{}
        emit(cancelled?'onCancel':'onEnd',ev);
      };
      const up=ev=>finish(ev,false),cancel=ev=>finish(ev,true);
      el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',cancel);
    });
  }
  function layoutBounds(){
    const main=$('.mailx-main'),width=main?.clientWidth||dialog?.clientWidth||1180,compact=width<1040;
    return {width,navMin:64,navMax:64,listMin:compact?280:320,readerMin:compact?320:400,gutters:9};
  }
  function clampLayout(nav,list){
    const b=layoutBounds();nav=clamp(Number(nav)||210,b.navMin,b.navMax);
    const listMax=Math.max(b.listMin,b.width-b.gutters-b.readerMin-nav);
    list=clamp(Number(list)||360,b.listMin,Math.min(620,listMax));
    return {nav,list};
  }
  function applyLayout(nav,list,persist=false){
    const main=$('.mailx-main');if(!main)return;
    const v=clampLayout(nav,list);main.style.setProperty('--mailx-nav-w',v.nav+'px');main.style.setProperty('--mailx-list-w',v.list+'px');
    if(persist)try{localStorage.setItem(LAYOUT,JSON.stringify(v));}catch{}
  }
  function initSplitters(){
    let saved={};try{saved=JSON.parse(localStorage.getItem(LAYOUT)||'{}');}catch{}
    applyLayout(saved.nav||210,saved.list||360);
    const main=$('.mailx-main');
    $$('[data-mailx-resizer]').forEach(splitter=>{
      let startNav=0,startList=0;
      const kind=splitter.dataset.mailxResizer;
      bindPointerDrag(splitter,{
        canStart:()=>matchMedia('(min-width:861px)').matches,
        onStart:()=>{const v=clampLayout(parseFloat(getComputedStyle(main).getPropertyValue('--mailx-nav-w')),parseFloat(getComputedStyle(main).getPropertyValue('--mailx-list-w')));startNav=v.nav;startList=v.list;shell.classList.add('is-resizing');},
        onMove:({dx})=>{if(kind==='nav')applyLayout(startNav+dx,startList);else applyLayout(startNav,startList+dx);},
        onEnd:()=>{shell.classList.remove('is-resizing');const v=clampLayout(parseFloat(getComputedStyle(main).getPropertyValue('--mailx-nav-w')),parseFloat(getComputedStyle(main).getPropertyValue('--mailx-list-w')));applyLayout(v.nav,v.list,true);},
        onCancel:()=>{shell.classList.remove('is-resizing');applyLayout(startNav,startList);}
      });
      splitter.addEventListener('dblclick',()=>{try{localStorage.removeItem(LAYOUT);}catch{}applyLayout(210,360);});
      splitter.addEventListener('keydown',e=>{
        if(!matchMedia('(min-width:861px)').matches||!['ArrowLeft','ArrowRight'].includes(e.key))return;
        e.preventDefault();const v=clampLayout(parseFloat(getComputedStyle(main).getPropertyValue('--mailx-nav-w')),parseFloat(getComputedStyle(main).getPropertyValue('--mailx-list-w'))),delta=e.key==='ArrowRight'?16:-16;
        if(kind==='nav')applyLayout(v.nav+delta,v.list,true);else applyLayout(v.nav,v.list+delta,true);
      });
    });
    window.addEventListener('resize',()=>{if(matchMedia('(min-width:861px)').matches){const v=clampLayout(parseFloat(getComputedStyle(main).getPropertyValue('--mailx-nav-w')),parseFloat(getComputedStyle(main).getPropertyValue('--mailx-list-w')));applyLayout(v.nav,v.list);}});
  }
  let floatingZ=30;
  function focusFloating(panel){if(panel)panel.style.zIndex=String(++floatingZ);}
  function floatingStore(){
    try{return JSON.parse(sessionStorage.getItem(FLOATING)||'{}');}catch{return {};}
  }
  function saveFloating(key,panel){
    if(matchMedia('(max-width:860px)').matches)return;
    const d=dialog.getBoundingClientRect(),r=panel.getBoundingClientRect(),all=floatingStore();
    all[key]={left:r.left-d.left,top:r.top-d.top};
    try{sessionStorage.setItem(FLOATING,JSON.stringify(all));}catch{}
  }
  function placeFloating(panel,key){
    if(!panel)return;
    if(matchMedia('(max-width:860px)').matches){panel.style.left='';panel.style.top='';panel.style.right='';return;}
    const d=dialog.getBoundingClientRect(),r=panel.getBoundingClientRect(),saved=floatingStore()[key]||{};
    const maxLeft=Math.max(8,d.width-r.width-8),maxTop=Math.max(8,d.height-r.height-8);
    const left=clamp(Number.isFinite(saved.left)?saved.left:maxLeft,8,maxLeft),top=clamp(Number.isFinite(saved.top)?saved.top:12,8,maxTop);
    panel.style.left=left+'px';panel.style.top=top+'px';panel.style.right='auto';
  }
  function prepareFloating(panel,key){
    if(!panel)return;
    const handle=panel.querySelector('.mailx-compose-head');if(!handle)return;
    panel.addEventListener('pointerdown',()=>focusFloating(panel),true);
    let baseLeft=0,baseTop=0;
    bindPointerDrag(handle,{
      canStart:e=>matchMedia('(min-width:861px)').matches&&!e.target.closest('button,input,textarea,select,a,label'),
      onStart:()=>{placeFloating(panel,key);const d=dialog.getBoundingClientRect(),r=panel.getBoundingClientRect();baseLeft=r.left-d.left;baseTop=r.top-d.top;panel.classList.add('is-dragging');},
      onMove:({dx,dy})=>{const d=dialog.getBoundingClientRect(),r=panel.getBoundingClientRect();panel.style.left=clamp(baseLeft+dx,8,Math.max(8,d.width-r.width-8))+'px';panel.style.top=clamp(baseTop+dy,8,Math.max(8,d.height-r.height-8))+'px';},
      onEnd:()=>{panel.classList.remove('is-dragging');saveFloating(key,panel);},
      onCancel:()=>{panel.classList.remove('is-dragging');placeFloating(panel,key);}
    });
  }
  function initMailWorkspaceInteractions(){
    initSplitters();prepareFloating(ce().pane,'compose');
    window.addEventListener('resize',()=>{if(ce().pane.classList.contains('is-open'))placeFloating(ce().pane,'compose');const sheet=$('#mailxSheet');if(sheet)placeFloating(sheet,'sheet');});
  }
  async function api(route,body=null,params={}) {
    let key;try{key=typeof requirePairing==='function'?requirePairing():'';}catch(e){dialog.close();throw e;}
    const url=new URL(API);url.searchParams.set('route',route);Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));});
    const requestKey=body===null?url.toString():'';
    if(requestKey&&getRequests.has(requestKey))return getRequests.get(requestKey);
    const pending=(async()=>{
      let r;try{r=await fetch(url,{method:body===null?'GET':'POST',headers:{'x-schedule-key':key,...(body===null?{}:{'Content-Type':'application/json'})},body:body===null?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(['ai','translate'].includes(route)?65000:['send','drafts/attachment'].includes(route)?90000:30000)});}catch{throw new Error('Connection interrupted. Your draft is safe. For sends, check Outbox before trying again.');}
      const data=await r.json().catch(()=>({error:'Mail service is unavailable.'}));
      if(!r.ok)throw new Error(data.error||'Mail request failed.');return data;
    })();
    if(requestKey)getRequests.set(requestKey,pending);
    try{return await pending;}finally{if(requestKey&&getRequests.get(requestKey)===pending)getRequests.delete(requestKey);}
  }
  const mutationQueue=[];let mutationTimer=0,mutationFlushPromise=null;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function queueMailMutation(target,action){
    return new Promise((resolve,reject)=>{
      mutationQueue.push({accountId:target.accountId,threadId:target.threadId,action,resolve,reject});
      clearTimeout(mutationTimer);
      if(mutationQueue.length>=8)queueMicrotask(()=>flushMailMutations());
      else mutationTimer=setTimeout(()=>flushMailMutations(),140);
    });
  }
  async function flushMailMutations(){
    if(mutationFlushPromise)return mutationFlushPromise;
    clearTimeout(mutationTimer);
    mutationFlushPromise=(async()=>{
      while(mutationQueue.length){
        const batch=mutationQueue.splice(0,40),operations=batch.map(({accountId,threadId,action})=>({accountId,threadId,action}));
        let data,lastError;
        for(let attempt=0;attempt<3;attempt++){
          try{data=await api('modify-batch',{operations});break;}
          catch(e){lastError=e;if(attempt<2)await pause(250*(2**attempt));}
        }
        if(!data){batch.forEach(item=>item.reject(lastError||new Error('Mail action failed.')));continue;}
        batch.forEach((item,i)=>{const result=data.results?.[i];if(result?.ok)item.resolve(result);else item.reject(new Error(result?.error||'Mail action failed.'));});
      }
    })().finally(()=>{mutationFlushPromise=null;if(mutationQueue.length)mutationTimer=setTimeout(()=>flushMailMutations(),0);});
    return mutationFlushPromise;
  }
  function notice(text=''){const el=$('#mailxNotice');el.textContent=text;el.hidden=!text;}
  function showToast(text,action=null){
    const el=$('#mailxToast');el.innerHTML='<span>'+escapeHtml(text)+'</span>'+(action?'<button type="button">'+escapeHtml(action.label||'Undo')+'</button>':'');el.classList.toggle('has-action',!!action);el.classList.add('is-visible');clearTimeout(toastTimer);
    const button=el.querySelector('button');if(button)button.onclick=async()=>{button.disabled=true;try{await action.onClick?.();}catch(e){showToast(e.message);}finally{el.classList.remove('is-visible');}};
    toastTimer=setTimeout(()=>el.classList.remove('is-visible'),action?7000:5000);
  }
  const guarded=fn=>async(...args)=>{try{return await fn(...args);}catch(e){showToast(e.message);}};
  function remember(){const p={account:state.account,filter:state.filter};try{localStorage.setItem(PREF,JSON.stringify(p));}catch{}clearTimeout(preferenceTimer);preferenceTimer=setTimeout(()=>api('preferences',p).catch(()=>{}),700);}
  function renderFilters(){
    $$('[data-mailx-filter]').forEach(b=>{b.classList.toggle('is-active',state.filter===b.dataset.mailxFilter);b.setAttribute('aria-pressed',String(state.filter===b.dataset.mailxFilter));});
    $$('[data-mailx-mobile-filter]').forEach(b=>b.classList.toggle('is-active',state.filter===b.dataset.mailxMobileFilter));
    accountEls.forEach(el=>{el.innerHTML=option('all','All connected',state.account)+state.accounts.map(a=>option(a.id,a.display_name,state.account)).join('');});
    if($('#mailxAccountAvatar'))$('#mailxAccountAvatar').textContent=state.account==='all'?'∞':initials(accountName(state.account));
    $('#mailxView').innerHTML=Object.entries(views).map(([v,l])=>option(v,l,state.filter)).join('');
  }
  function chipsFor(m){const c=m.classification||{};return [c.priority==='High'?'<span class="mailx-chip high">High</span>':'',c.type==='Login Code'?'<span class="mailx-chip code">Code</span>':'',c.action&&c.action!=='No action'?`<span class="mailx-chip reply">${escapeHtml(c.action)}</span>`:'',['Low','Muted'].includes(c.priority)?`<span class="mailx-chip low">${c.priority}</span>`:'',c.blocked?'<span class="mailx-chip blocked">Blocked</span>':'',c.needsClassification?'<span class="mailx-chip">Needs classification</span>':''].join('');}
  const icons={inbox:'<path d="M4 4h16v16H4zM4 13h4l2 3h4l2-3h4"/>',starred:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',sent:'<path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14"/>',drafts:'<path d="M13 4H5v16h14v-8M11 13l1-4 7-7 3 3-7 7-4 1Z"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',archive:'<path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/>',unread:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'};
  const icon=k=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+(icons[k]||icons.inbox)+'</svg>';
  const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]).join('').toUpperCase();
  const avatar=name=>'<span class="mailx-avatar tone-'+([...String(name)].reduce((n,c)=>n+c.codePointAt(0),0)%5)+'" aria-hidden="true">'+escapeHtml(initials(name))+'</span>';
  function updateUnread(){
    const unread=state.messages.filter(m=>m.labels.includes('UNREAD')&&m.labels.includes('INBOX')&&!m.labels.includes('TRASH')&&!m.classification?.blocked);
    $('#mailxUnreadCount').textContent=unread.length||'';
    const launch=document.querySelector('#mailDashboardButton'),badge=launch?.querySelector('.mailx-launch-count');
    if(badge){badge.textContent=unread.length||'';badge.hidden=!unread.length;launch.title=unread.length?unread.length+' unread in loaded mail':'Open Mail';}
    const peek=document.querySelector('#mailxPeek');if(!peek)return;
    peek.innerHTML='<strong>Latest unread</strong>'+unread.slice(0,3).map((m,i)=>'<button data-peek="'+i+'">'+avatar(m.sender)+'<span><b>'+escapeHtml(m.sender)+'</b><span>'+escapeHtml(m.subject)+'</span></span></button>').join('')+(unread.length?'':'<p>No unread messages in loaded mail.</p>');
    peek.querySelectorAll('[data-peek]').forEach(b=>b.onclick=guarded(async()=>{const m=unread[+b.dataset.peek];peek.hidden=true;await openDialog();await selectMessage(m);}));
  }
  function restoreListMessage(m,key,labels=null){
    if(!m||key!==viewKey())return;
    if(labels)m.labels=labels.slice();
    const id=threadKey(m),index=state.messages.findIndex(x=>threadKey(x)===id),visible=matchesView(m,state.filter);
    if(visible&&index<0)state.messages.push(m);
    else if(!visible&&index>=0)state.messages.splice(index,1);
    state.messages.sort((a,b)=>b.timestamp-a.timestamp);
    renderList();
  }
  async function rowAction(m,action){
    if(action==='archive')return archiveFromList(m);
    if(m.pendingAction)return;
    const key=viewKey(),labels=m.labels.slice();m.pendingAction=true;
    const changes={star:['STARRED',true],unstar:['STARRED',false],unread:['UNREAD',true],read:['UNREAD',false],trash:['TRASH',true],untrash:['TRASH',false]},[label,add]=changes[action];
    m.labels=add?[...new Set([...m.labels,label])]:m.labels.filter(x=>x!==label);
    state.loadVersion++;clearPageCache();state.messages=state.messages.filter(x=>matchesView(x,state.filter));renderList();
    if((action==='trash'||action==='untrash')&&state.selected===threadKey(m)){state.readVersion++;state.thread=null;state.selected=null;shell.classList.remove('is-reading','is-reader-focused');blankReader();}
    try{await queueMailMutation(m,action);clearPageCache();
      // If Trash was opened while this queued mutation was still running, refresh it now.
      // This closes the gap where the first Trash request could finish before Gmail moved the thread.
      if(action==='trash'&&state.filter==='trash')loadMail(false,true).catch(e=>showToast(e.message));
      if(action==='trash')showToast('Moved to Trash',{label:'Undo',onClick:async()=>{
        const trashedLabels=m.labels.slice();restoreListMessage(m,key,labels);
        try{await queueMailMutation(m,'untrash');clearPageCache();showToast('Trash undone');loadMail(false,true);}
        catch(e){restoreListMessage(m,key,trashedLabels);throw e;}
      }});
      else showToast(({star:'Starred',unstar:'Star removed',unread:'Marked unread',read:'Marked read',untrash:'Restored from Trash'})[action]);
    }catch(e){restoreListMessage(m,key,labels);showToast('Change failed: '+e.message);}finally{m.pendingAction=false;}
  }
  function renderList(){
    renderFilters();$('#mailxListMeta').textContent=`${categoryLabel(state.filter)} · ${state.messages.length} loaded`;
    updateUnread();
    listEl.innerHTML=state.messages.length?state.messages.map((m,i)=>{
      const unread=m.labels.includes('UNREAD'),starred=m.labels.includes('STARRED');
      return '<div class="mailx-message-wrap" data-swipe-row="'+i+'" data-swipe-enabled="'+(m.labels.includes('INBOX')&&!m.labels.includes('TRASH')?'1':'0')+'"><div class="mailx-swipe-action" aria-hidden="true">Archive</div><button class="mailx-message '+(state.selected===threadKey(m)?'is-selected ':'')+(unread?'is-unread':'')+'" type="button" data-row="'+i+'" aria-pressed="'+(state.selected===threadKey(m))+'">'+avatar(m.sender)+'<span class="mailx-row-content"><span class="mailx-message-head"><span class="mailx-sender">'+escapeHtml(m.sender)+'</span><span class="mailx-time">'+escapeHtml(time(m.timestamp))+'</span></span><span class="mailx-subject">'+(unread?'<span class="mailx-unread-dot" aria-label="Unread"></span>':'')+escapeHtml(m.subject)+(m.count>1?' <small>('+m.count+')</small>':'')+'</span><span class="mailx-snippet">'+escapeHtml(m.snippet)+'</span><span class="mailx-message-foot"><span class="mailx-account">'+escapeHtml(accountName(m.accountId))+'</span>'+(m.hasAttachments||m.attachments?.length?'<span title="Has attachments" aria-label="Has attachments">⌁</span>':'')+(starred?'<span class="mailx-star-indicator" aria-label="Starred">★</span>':'')+(m.classification?.code?'<span class="mailx-code-mini">'+escapeHtml(m.classification.code)+'</span>':m.classification?.action==='Needs reply'?'<span class="mailx-row-status">Needs reply</span>':'')+'</span></span></button><div class="mailx-row-actions">'+[[starred?'unstar':'star',starred?'Remove star':'Star','starred'],...(m.labels.includes('TRASH')?[['untrash','Restore from Trash','archive']]:[['archive','Archive','archive'],['trash','Move to Trash','trash']]),[unread?'read':'unread',unread?'Mark read':'Mark unread','unread']].map(([action,label,glyph])=>'<button type="button" data-row-action="'+action+'" data-index="'+i+'" title="'+label+'" aria-label="'+label+'">'+icon(glyph)+'</button>').join('')+'</div></div>';
    }).join(''):'<div class="mailx-empty-list">'+(state.accounts.length?'No matching messages in this page. Older matches may be available below.':'Connect a Gmail account in Settings to get started.')+'</div>';
    $$('[data-row-action]').forEach(b=>b.onclick=guarded(()=>rowAction(state.messages[+b.dataset.index],b.dataset.rowAction)));
    if(state.hasMore)listEl.insertAdjacentHTML('beforeend','<button id="mailxMore" class="mailx-load-more">Load more mail</button>');
    $$('[data-row]').forEach(b=>b.addEventListener('click',guarded(()=>selectMessage(state.messages[Number(b.dataset.row)]))));
    wireSwipeRows();
    $('#mailxMore')?.addEventListener('click',guarded(()=>loadMail(true)));
  }
  function wireSwipeRows(){
    $$('[data-swipe-row]').forEach(wrap=>{
      if(wrap.dataset.swipeEnabled!=='1')return;
      const row=wrap.querySelector('.mailx-message');let intent='',suppress=false;
      bindPointerDrag(row,{
        canStart:e=>['touch','pen'].includes(e.pointerType),
        onStart:()=>{intent='';suppress=false;wrap.classList.remove('is-snapping','is-committing');row.style.transform='';},
        onMove:({event,dx,dy})=>{
          if(!intent&&Math.hypot(dx,dy)>8)intent=Math.abs(dx)>Math.abs(dy)*1.15?'x':'y';
          if(intent!=='x'||dx>=0)return;
          event.preventDefault();suppress=true;
          const shift=Math.max(-Math.min(132,wrap.clientWidth*.42),dx);row.style.transform=`translate3d(${shift}px,0,0)`;
        },
        onEnd:({dx,dy})=>{
          if(!intent&&Math.hypot(dx,dy)>8)intent=Math.abs(dx)>Math.abs(dy)*1.15?'x':'y';
          if(suppress||intent==='x'){wrap._mailxSuppressClick=true;setTimeout(()=>wrap._mailxSuppressClick=false,280);}
          if(intent==='x'&&dx<0&&-dx>=Math.min(96,wrap.clientWidth*.24)){
            wrap.classList.add('is-committing');row.style.transform='';const m=state.messages[Number(wrap.dataset.swipeRow)];setTimeout(()=>{if(m)archiveFromList(m);},150);
          }else{wrap.classList.add('is-snapping');row.style.transform='';setTimeout(()=>wrap.classList.remove('is-snapping'),180);}
        },
        onCancel:()=>{row.style.transform='';wrap.classList.add('is-snapping');}
      });
      wrap.addEventListener('click',e=>{if(wrap._mailxSuppressClick){e.preventDefault();e.stopImmediatePropagation();wrap._mailxSuppressClick=false;}},true);
    });
  }
  async function archiveFromList(m){
    if(!m||!m.labels?.includes('INBOX'))return;
    const key=viewKey(),index=state.messages.findIndex(x=>threadKey(x)===threadKey(m)),wasSelected=state.selected===threadKey(m);
    const next=state.messages[index+1]||state.messages[index-1]||null;
    state.readVersion++;state.loadVersion++;state.messages=state.messages.filter(x=>threadKey(x)!==threadKey(m));clearPageCache();renderList();
    if(wasSelected){state.selected=null;state.thread=null;if(next&&matchMedia('(min-width:861px)').matches)selectMessage(next).catch(e=>showToast(e.message));else{shell.classList.remove('is-reading','is-reader-focused');blankReader();}}
    try{
      await queueMailMutation(m,'archive');clearPageCache();
      showToast('Archived',{label:'Undo',onClick:async()=>{
        restoreListMessage(m,key);
        try{await queueMailMutation(m,'unarchive');clearPageCache();showToast('Archive undone');loadMail(false,true);}
        catch(e){if(key===viewKey()){state.messages=state.messages.filter(x=>threadKey(x)!==threadKey(m));renderList();}throw e;}
      }});
      loadMail(false,true);
    }catch(e){restoreListMessage(m,key);showToast('Change failed: '+e.message);}
  }
  async function loadMail(more=false,force=false){
    ownCache();if(['drafts','outbox'].includes(state.filter))return loadSpecial();
    const version=++state.loadVersion,key=viewKey(),cached=pageCache.get(key);
    if(!more&&cached){messagesKey=key;Object.assign(state,cached.value);renderList();if(!force&&Date.now()-cached.at<60000){notice('');prefetchReaders();return;}}
    else if(!more){state.messages=state.query&&messagesKey!==key?[]:state.messages.filter(m=>(state.account==='all'||m.accountId===state.account)&&matchesView(m,state.filter));messagesKey=key;state.hasMore=false;renderList();}
    notice('Updating mailbox…');$('#mailxRefresh').disabled=true;
    try{
      const advanced=/\b(?:from|to|cc|bcc|subject|has|is|in|label|before|after|newer|older):/i.test(state.query);
      const params={accountId:state.account,filter:state.filter,q:state.query,cursor:JSON.stringify(more?state.cursor:{})};
      let data;
      // Trash must be authoritative: recently deleted threads can race the background cache.
      if(advanced||state.filter==='trash')data=await api('mail',null,params);
      else{
        try{data=await api('cached-mail',null,params);}
        catch{data=await api('mail',null,params);}
      }
      if(version!==state.loadVersion)return;
      const incoming=Array.isArray(data?.messages)?data.messages:[];
      const errors=Array.isArray(data?.errors)?data.errors:[];
      const failed=new Map(errors.map(e=>[e.accountId,e.threadIds]));
      const retained=state.messages.filter(m=>failed.has(m.accountId)&&(!failed.get(m.accountId)||failed.get(m.accountId).includes(m.threadId)));
      const rows=more?[...state.messages,...incoming]:[...retained,...incoming];
      state.messages=[...new Map(rows.map(m=>[threadKey(m),m])).values()].sort((a,b)=>b.timestamp-a.timestamp);
      state.cursor=data?.cursor&&typeof data.cursor==='object'?data.cursor:{};state.hasMore=Boolean(data?.hasMore);if(!errors.length)putCache(pageCache,key,{messages:state.messages,cursor:state.cursor,hasMore:state.hasMore});renderList();prefetchReaders();
      notice(data.errors?.map(e=>accountName(e.accountId)+': '+e.error+' Previously loaded mail is kept; refresh to retry.').join(' · ')||'');
    }catch(e){if(version===state.loadVersion)notice(e.message);}
    finally{if(version===state.loadVersion)$('#mailxRefresh').disabled=false;}
  }
  function matchesView(m,filter){const l=m.labels,c=m.classification;if(filter==='trash')return l.includes('TRASH');if(l.includes('TRASH')||l.includes('SPAM'))return false;if(filter==='starred')return l.includes('STARRED');if(filter==='unread')return l.includes('INBOX')&&l.includes('UNREAD')&&!c.blocked;if(['all','archived','sent','blocked','codes','low'].includes(filter))return filter==='all'||filter==='archived'&&!l.includes('INBOX')&&!l.includes('DRAFT')||filter==='sent'&&l.includes('SENT')||filter==='blocked'&&c.blocked||filter==='codes'&&c.type==='Login Code'||filter==='low'&&['Low','Muted'].includes(c.priority);if(c.blocked)return false;return l.includes('INBOX')&&(filter==='important'?c.priority==='High':filter==='reply'?c.action==='Needs reply':c.priority!=='Muted');}
  function blankReader(){readerEl.innerHTML='<div class="mailx-reader-empty"><div class="mailx-reader-empty-icon">✉</div><strong>Select a message</strong><span>Your connected accounts, together.</span></div>';}
  async function selectMessage(m){
    ownCache();const version=++state.readVersion,key=threadKey(m),cached=threadCache.get(key);state.selected=key;shell.classList.add('is-reading');renderList();
    if(cached){state.thread=cached.value;renderReader();}else{
      state.thread=null;readerEl.innerHTML='<div class="mailx-reader-toolbar"><button class="mailx-action mailx-reader-back" id="mailxLoadingBack">← Back</button></div><div class="mailx-empty-list">Opening thread…</div>';
      $('#mailxLoadingBack').onclick=()=>{state.readVersion++;shell.classList.remove('is-reading','is-reader-focused');};
    }
    try{
      const thread=await fetchThread(m);if(version!==state.readVersion)return;
      if(state.thread!==thread){state.thread=thread;renderReader();}
      hydrateThreadImages(m,version);
      if(m.labels.includes('UNREAD')){
        m.labels=m.labels.filter(x=>x!=='UNREAD');if(state.filter==='unread')state.messages=state.messages.filter(x=>x!==m);renderList();
        queueMailMutation(m,'read').catch(()=>{if(!m.labels.includes('UNREAD'))m.labels.push('UNREAD');if(version===state.readVersion)renderList();});
      }
    }catch(e){if(version===state.readVersion){if(cached)showToast('Showing the saved view: '+e.message);else readerEl.insertAdjacentHTML('beforeend',`<p class="mailx-inline-error">${escapeHtml(e.message)}</p>`);}}
  }
  function currentMessage(){return state.thread?.messages.at(-1);}
  function translationControls(t,msg,i) {
    if(!isSkeuoDemo()||!hasChinese(msg.subject+' '+msg.text+' '+msg.snippet))return '';
    const stored=translationCache.has(translationKey(t,msg)),active=wantsEnglish(t,msg);
    const label=stored?(active?'ORIGINAL':'ENGLISH'):'TRANSLATE';
    const description=stored?(active?'Show original Chinese email':'Show English translation'):'Translate Chinese email to English';
    return `<button class="mailx-translate-button" type="button" data-mailx-translate="${i}" aria-label="${description}" aria-pressed="${active}" title="${description}"><span class="mailx-translate-symbol" aria-hidden="true">⇄</span>${label}</button>`;
  }
  function translatedBlock(t,msg,i) {
    if(!wantsEnglish(t,msg))return '';
    const translation=translationCache.get(translationKey(t,msg));
    return `<div class="mailx-translation" data-mailx-translation="${i}"><div class="mailx-translation-label">ENGLISH TRANSLATION</div>${hasChinese(msg.subject)?`<div class="mailx-translation-subject">${escapeHtml(translation.subject)}</div>`:''}<div class="mailx-translation-body">${escapeHtml(translation.body)}</div></div>`;
  }
  function rerenderReaderPreservingPosition() {
    const previous=readerEl.querySelector('.mailx-reader-scroll'),position=previous?.scrollTop||0;
    renderReader();
    const current=readerEl.querySelector('.mailx-reader-scroll');if(current)current.scrollTop=position;
  }
  function renderReader(){
    const t=state.thread;if(!t)return blankReader();const m=currentMessage(),account=state.accounts.find(a=>a.id===t.accountId),incoming=[...t.messages].reverse().find(x=>address(x.email)!==address(account?.email))||m;
    const c=incoming.classification,unsub=incoming.unsubscribe,archived=!t.messages.some(x=>x.labels.includes('INBOX'));
    const focused=shell.classList.contains('is-reader-focused');
    readerEl.innerHTML=`<div class="mailx-reader-toolbar"><button class="mailx-action mailx-reader-back" data-action="back" aria-label="Back to mail list">←</button><button class="mailx-action" data-action="archive">${archived?'Unarchive':'Archive'}</button><button class="mailx-action" data-action="mute">Mute</button><button class="mailx-action danger" data-action="block">Block</button>${unsub.web||unsub.mailto?'<button class="mailx-action good" data-action="unsubscribe">Unsubscribe</button>':''}<button class="mailx-action" data-action="unread">Unread</button><button class="mailx-action mailx-toolbar-reply" data-action="reply">Reply</button><button class="mailx-action mailx-toolbar-forward" data-action="forward">Forward</button>${isEmbedded()?'<button class="mailx-action" data-action="classify">Rule</button><button class="mailx-action" data-action="sender">Sender</button>':''}<span class="mailx-toolbar-spacer"></span><button class="mailx-action mailx-focus-action" data-action="focus" aria-pressed="${focused?'true':'false'}">${focused?'Exit focus':'Focus'}</button></div><div class="mailx-reader-scroll"><div class="mailx-reader-head"><div class="mailx-reader-title-row"><h2 class="mailx-reader-subject">${escapeHtml(m.subject)}</h2>${translationControls(t,m,t.messages.length-1)}${isEmbedded()?'':'<div class="mailx-reader-head-actions"><button class="mailx-action" data-action="classify">Rule</button><button class="mailx-action" data-action="sender">Sender</button></div>'}</div><div class="mailx-reader-tags"><span class="mailx-account">${escapeHtml(accountName(t.accountId))}</span><span class="mailx-chip">${escapeHtml(c.type)}</span><span class="mailx-chip">${escapeHtml(c.context||'No context')}</span>${chipsFor(incoming)}</div></div>${t.messages.map((msg,i)=>`<article class="mailx-thread-message${i===t.messages.length-1?' is-current':''}"><details class="mailx-thread-details${i===t.messages.length-1?' is-current':''}" ${i===t.messages.length-1?'open':''}><summary>${avatar(msg.sender)}<span class="mailx-thread-summary"><strong>${escapeHtml(msg.sender)}</strong><span>${escapeHtml(msg.snippet||msg.text?.slice(0,110))}</span></span><time>${escapeHtml(time(msg.timestamp))}</time></summary><details class="mailx-message-meta"><summary>Message details</summary><div class="mailx-sender-row"><div class="mailx-sender-details"><div class="mailx-sender-email">From: ${escapeHtml(msg.from)}</div><div class="mailx-recipient-line">To: ${escapeHtml(msg.to)}${msg.cc?' · Cc: '+escapeHtml(msg.cc):''}</div><div class="mailx-recipient-line">Date: ${escapeHtml(time(msg.timestamp))} · ${escapeHtml(accountName(t.accountId))}</div></div></div></details>${msg.classification.code?`<div class="mailx-login-card ${Date.now()-msg.timestamp>3600000?'is-old-code':''}"><div class="mailx-login-label">${Date.now()-msg.timestamp>3600000?'OLDER CODE · MAY HAVE EXPIRED':'VERIFICATION CODE'}</div><div class="mailx-login-code">${escapeHtml(msg.classification.code)}</div><button class="mailx-copy-code" data-copy="${i}">Copy code</button></div>`:''}${msg.html?`<iframe class="mailx-html-body" data-body="${i}" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Email body from ${escapeHtml(msg.sender)}"></iframe><details class="mailx-text-alternative"><summary>Plain text / accessible view</summary><div class="mailx-mail-body">${escapeHtml(msg.text)}</div></details>`:`<div class="mailx-mail-body">${escapeHtml(msg.text||'(No text body)')}</div>`}${translatedBlock(t,msg,i)}${msg.attachments.length?`<div class="mailx-attachments">${msg.attachments.map((a,j)=>`<button class="mailx-attachment-download" data-attachment="${i}:${j}" title="Download ${escapeHtml(a.filename)}"><span class="mailx-file-type">${escapeHtml(a.filename.split('.').pop().slice(0,5).toUpperCase())}</span><span><strong>${escapeHtml(a.filename)}</strong><small>${formatBytes(a.size)} · Download ↓</small></span></button>`).join('')}</div>`:''}</details></article>`).join('')}</div>`;
    // Keep the original mail body as a direct child; hide it only while viewing the English translation.
    if(isSkeuoDemo())$$('.mailx-thread-details').forEach((details,i)=>{
      if(wantsEnglish(t,t.messages[i]))details.querySelectorAll('.mailx-html-body,.mailx-text-alternative,.mailx-mail-body').forEach(el=>{el.hidden=true;});
    });
    const toolbar=$('.mailx-reader-toolbar'),more=document.createElement('details');more.className='mailx-reader-more';more.innerHTML='<summary aria-label="More message actions" title="More message actions">'+icon('more')+'</summary><div></div>';toolbar.insertBefore(more,$('.mailx-toolbar-spacer'));for(const action of (isEmbedded()?['mute','block','unsubscribe']:['mute','block','unsubscribe','classify','sender'])){const button=$('[data-action="'+action+'"]');if(button)more.querySelector('div').appendChild(button);}
    const loadBody=details=>details.querySelectorAll('[data-body]').forEach(frame=>{if(!frame.dataset.loaded){frame.srcdoc=t.messages[Number(frame.dataset.body)].html;frame.dataset.loaded='1';}});
    $$('.mailx-thread-details').forEach(details=>{if(details.open)loadBody(details);details.addEventListener('toggle',()=>{if(details.open)loadBody(details);});});
    $$('[data-mailx-translate]').forEach(b=>b.onclick=guarded(async()=>{
      const msg=t.messages[Number(b.dataset.mailxTranslate)],key=translationKey(t,msg);
      if(translationCache.has(key)) {
        if(translatedOpen.has(key))translatedOpen.delete(key);else translatedOpen.add(key);
        return rerenderReaderPreservingPosition();
      }
      b.disabled=true;b.textContent='WORKING…';
      try {
        const result=await api('translate',{accountId:t.accountId,messageId:msg.id});
        if(typeof result.body!=='string'||!result.body.trim())throw new Error('Gemini returned no readable text.');
        if(translationCache.size>=30)translationCache.delete(translationCache.keys().next().value);
        translationCache.set(key,{subject:result.subject||msg.subject,body:result.body});
        translatedOpen.add(key);
        if(state.thread===t)rerenderReaderPreservingPosition();
      }catch(e){
        if(state.thread===t){b.disabled=false;b.innerHTML='<span class="mailx-translate-symbol" aria-hidden="true">⇄</span>TRANSLATE';showToast('Translation failed: '+e.message);}
      }
    }));
    $$('[data-copy]').forEach(b=>b.onclick=guarded(async()=>{await navigator.clipboard.writeText(t.messages[+b.dataset.copy].classification.code);showToast('Code copied');}));
    $$('[data-attachment]').forEach(b=>b.onclick=guarded(async()=>{b.disabled=true;try{const [i,j]=b.dataset.attachment.split(':').map(Number),msg=t.messages[i],a=msg.attachments[j];const data=await api('attachment',null,{accountId:t.accountId,messageId:msg.id,attachmentId:a.id,partId:a.partId});const bytes=Uint8Array.from(atob(data.data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download=data.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}finally{b.disabled=false;}}));
    $$('[data-action]').forEach(b=>b.onclick=guarded(async()=>{
      const action=b.dataset.action;
      if(action==='back'){shell.classList.remove('is-reading','is-reader-focused');return;}
      if(action==='focus'){const active=shell.classList.toggle('is-reader-focused');b.textContent=active?'Exit focus':'Focus';b.setAttribute('aria-pressed',String(active));return;}
      if(action==='forward')return forwardMessage(m,t.accountId);
      if(action==='reply')return openComposer({...incoming,accountId:t.accountId,threadId:t.threadId});
      if(action==='classify'||action==='mute'||action==='block')return ruleEditor(incoming,t.accountId,action);
      if(action==='sender')return senderDetails(incoming,t.accountId);
      if(action==='unsubscribe')return unsubscribe(incoming,t.accountId);
      if(action==='archive'&&!archived){const listMessage=state.messages.find(x=>threadKey(x)===threadKey(t))||{...m,accountId:t.accountId,threadId:t.threadId,labels:['INBOX']};return archiveFromList(listMessage);}
      b.disabled=true;const key=viewKey(),removed=state.messages.find(x=>threadKey(x)===threadKey(t))||null;state.readVersion++;state.loadVersion++;clearPageCache();
      state.messages=state.messages.filter(m=>threadKey(m)!==threadKey(t));renderList();shell.classList.remove('is-reading','is-reader-focused');showToast(action==='unread'?'Marking unread…':archived?'Returning to inbox…':'Archiving…');
      try{await queueMailMutation({accountId:t.accountId,threadId:t.threadId},action==='archive'?(archived?'unarchive':'archive'):action);clearPageCache();showToast(action==='unread'?'Marked unread':archived?'Returned to inbox':'Archived in Gmail');loadMail(false,true);}
      catch(e){if(removed)restoreListMessage(removed,key);showToast('Change failed: '+e.message);}finally{b.disabled=false;}
    }));
  }
  function address(v=''){return (v.match(/<([^<>]+)>/)?.[1]||v).trim().toLowerCase();}
  let currentAttachments=[],attachmentUploads=new Map(),savedEditorRange=null;
  const editorTags=new Set(['P','DIV','BR','STRONG','B','EM','I','U','S','STRIKE','UL','OL','LI','BLOCKQUOTE','H1','H2','H3','A','SPAN']);
  function ce(){return{pane:$('#mailxCompose'),title:$('#mailxComposeTitle'),context:$('#mailxComposeContext'),from:$('#mailxFrom'),to:$('#mailxTo'),subject:$('#mailxSubject'),prompt:$('#mailxAiPrompt'),body:$('#mailxBody'),generate:$('#mailxGenerate')};}
  function setAiBusy(c,busy){
    state.busyAi=busy;c.generate.disabled=busy;c.generate.classList.toggle('is-loading',busy);c.generate.setAttribute('aria-busy',String(busy));
    const label=c.generate.querySelector('.mailx-ai-generate-label');if(label)label.textContent=busy?'Revising…':'Generate';
  }
  function cleanEditorHtml(html=''){
    const template=document.createElement('template');template.innerHTML=String(html||'');
    [...template.content.querySelectorAll('*')].reverse().forEach(el=>{
      if(!editorTags.has(el.tagName)){el.replaceWith(...el.childNodes);return;}
      [...el.attributes].forEach(a=>el.removeAttribute(a.name));
      if(el.tagName==='A'){
        const source=document.createElement('template');source.innerHTML=String(html||'');
      }
    });
    // Restore only safe href/title attributes from a separately parsed tree by walking in order.
    const source=document.createElement('template');source.innerHTML=String(html||'');
    const safeLinks=[...template.content.querySelectorAll('a')],rawLinks=[...source.content.querySelectorAll('a')];
    safeLinks.forEach((a,i)=>{
      const raw=rawLinks[i],href=raw?.getAttribute('href')||'',title=raw?.getAttribute('title')||'';
      try{const u=new URL(href,location.href);if(['http:','https:','mailto:'].includes(u.protocol))a.setAttribute('href',href);}catch{}
      if(title)a.setAttribute('title',title.slice(0,200));
    });
    return template.innerHTML;
  }
  function editorText(){return ce().body.innerText.replace(/\u00a0/g,' ').replace(/\r\n?/g,'\n');}
  function editorHtml(){return ce().body.innerHTML;}
  function editorState(){return{body:editorText(),bodyHtml:editorHtml()};}
  function looksLikeEditorHtml(value=''){return /<\/?(?:p|div|br|strong|b|em|i|u|s|strike|ul|ol|li|blockquote|h[1-3]|a|span)\b/i.test(String(value||''));}
  function plainToEditorHtml(text=''){return escapeHtml(String(text||'').replace(/\r\n?/g,'\n')).replace(/\n/g,'<br>');}
  function setEditor(body='',html=''){const c=ce(),rich=html||(!html&&looksLikeEditorHtml(body)?body:'');c.body.innerHTML=rich?cleanEditorHtml(rich):plainToEditorHtml(body);}
  function completedAttachmentRefs(){return currentAttachments.filter(a=>a.status==='done').map(({id,name,type,size})=>({id,name,type,size}));}
  function draftSnapshot(){const c=ce(),content=editorState();return{id:state.draftId,accountId:c.from.value,to:c.to.value,subject:c.subject.value,...content,attachments:completedAttachmentRefs(),threadId:state.replyContext?.threadId||null,replyMessageId:state.replyContext?.id||null};}
  function keepDraft(){if(!state.draftId)return;writeStore(DRAFT,{...draftSnapshot(),requestId:state.requestId,requestPayload:state.requestPayload});}
  function formatBytes(bytes){return bytes<1024?bytes+' B':bytes<1024*1024?Math.ceil(bytes/1024)+' KB':(bytes/1024/1024).toFixed(1)+' MB';}
  function renderAttachments(){
    const box=$('#mailxAttachments');if(!box)return;
    box.innerHTML=currentAttachments.map(a=>`<div class="mailx-attachment-chip ${a.status==='error'?'is-error':a.status==='uploading'?'is-uploading':''}" data-attachment-id="${escapeHtml(a.id)}"><span class="mailx-attachment-icon">📎</span><span class="mailx-attachment-info"><strong>${escapeHtml(a.name)}</strong><small>${a.status==='uploading'?'Uploading…':a.status==='error'?(a.error||'Upload failed'):formatBytes(a.size)}</small></span>${a.status==='uploading'?'<span class="mailx-attachment-spinner" aria-label="Uploading"></span>':a.status==='error'&&a.file?'<button type="button" data-attachment-retry aria-label="Retry attachment">Retry</button>':''}<button type="button" data-attachment-remove aria-label="Remove ${escapeHtml(a.name)}">×</button></div>`).join('');
    $$('[data-attachment-remove]').forEach(b=>b.onclick=()=>removeAttachment(b.closest('[data-attachment-id]').dataset.attachmentId));
    $$('[data-attachment-retry]').forEach(b=>b.onclick=()=>retryAttachment(b.closest('[data-attachment-id]').dataset.attachmentId));
  }
  function fileBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(r.error||new Error('Could not read file.'));r.readAsDataURL(file);});}
  async function uploadAttachment(entry){
    entry.status='uploading';entry.error='';renderAttachments();
    const task=(async()=>{
      try{
        const data=await fileBase64(entry.file);
        const result=await api('drafts/attachment',{draftId:state.draftId,id:entry.id,name:entry.name,type:entry.type,size:entry.size,data});
        const current=currentAttachments.find(a=>a.id===entry.id);if(!current)return;
        Object.assign(current,result.attachment,{status:'done',error:'',file:null});renderAttachments();keepDraft();scheduleDraftSave();
      }catch(e){
        const current=currentAttachments.find(a=>a.id===entry.id);if(current){current.status='error';current.error=e.message||'Upload failed';renderAttachments();$('#mailxComposeError').textContent='Attachment upload failed. Retry it or remove it before sending.';}
      }finally{attachmentUploads.delete(entry.id);}
    })();
    attachmentUploads.set(entry.id,task);return task;
  }
  async function addFiles(files){
    const list=[...files];if(!list.length)return;clearTimeout(draftTimer);
    try{await saveDraft();}catch(e){showToast('Save the draft before attaching files: '+e.message);return;}
    let used=currentAttachments.reduce((n,a)=>n+a.size,0);
    for(const file of list){
      if(currentAttachments.length>=8){showToast('You can attach up to 8 files.');break;}
      if(file.size>20*1024*1024||used+file.size>20*1024*1024){showToast('Attachments can total up to 20 MB.');break;}
      const entry={id:crypto.randomUUID(),name:file.name||'attachment',type:file.type||'application/octet-stream',size:file.size,status:'uploading',error:'',file};currentAttachments.push(entry);used+=file.size;uploadAttachment(entry);
    }
    renderAttachments();keepDraft();
  }
  async function removeAttachment(id){
    const entry=currentAttachments.find(a=>a.id===id);if(!entry)return;
    if(entry.status==='uploading'){showToast('Wait for this attachment to finish uploading.');return;}
    currentAttachments=currentAttachments.filter(a=>a.id!==id);renderAttachments();keepDraft();scheduleDraftSave();
    if(entry.status==='done')api('drafts/attachment/delete',{draftId:state.draftId,id}).catch(()=>showToast('Attachment removed locally; server cleanup will retry with the draft.'));
  }
  function retryAttachment(id){const entry=currentAttachments.find(a=>a.id===id);if(entry?.status==='error'&&entry.file)uploadAttachment(entry);}
  async function waitForAttachmentUploads(requireSuccess=false){
    if(attachmentUploads.size)await Promise.allSettled([...attachmentUploads.values()]);
    const failed=currentAttachments.filter(a=>a.status!=='done');
    if(requireSuccess&&failed.length){showToast('Retry or remove failed attachments before sending.');return false;}
    return true;
  }
  function saveEditorRange(){
    const sel=getSelection();if(!sel?.rangeCount)return;const range=sel.getRangeAt(0),body=ce().body;
    if(body.contains(range.commonAncestorContainer))savedEditorRange=range.cloneRange();
  }
  function restoreEditorRange(){
    if(!savedEditorRange)return;const sel=getSelection();sel.removeAllRanges();sel.addRange(savedEditorRange);
  }
  function composerChanged(){state.editVersion++;state.redo=[];saveEditorRange();keepDraft();if(!attachmentUploads.size)scheduleDraftSave();}
  function formatEditor(command,value=null){
    restoreEditorRange();ce().body.focus();document.execCommand(command,false,value);saveEditorRange();composerChanged();updateFormatState();
  }
  function updateFormatState(){
    $$('[data-format-command]').forEach(b=>{const cmd=b.dataset.formatCommand;b.classList.toggle('is-active',!!document.queryCommandState?.(cmd));});
  }
  async function forwardMessage(m,accountId){
    const attachments=m.attachments||[];
    if(attachments.length>8||attachments.reduce((n,a)=>n+a.size,0)>20*1024*1024){showToast('This message exceeds the 8-file / 20 MB forwarding limit. Download its attachments to share separately.');return;}
    const header='---------- Forwarded message ----------\nFrom: '+m.from+'\nDate: '+new Date(m.timestamp).toLocaleString()+'\nSubject: '+m.subject+'\nTo: '+m.to+(m.cc?'\nCc: '+m.cc:'');
    const opened=await openComposer(null,{accountId,to:'',subject:/^fwd?:/i.test(m.subject)?m.subject:'Fwd: '+m.subject,body:'\n\n'+header+'\n\n'+(m.text||m.snippet||''),forward:true});
    if(!opened)return;
    ce().to.focus();const version=state.composeVersion,draftId=state.draftId;
    // Register every copy immediately so Send cannot race an in-flight download.
    if(attachments.length){
      const ready=saveDraft();
      for(const a of attachments){
        const entry={id:crypto.randomUUID(),name:a.filename,type:a.mimeType||'application/octet-stream',size:a.size,status:'uploading',error:'',file:null};currentAttachments.push(entry);
        const task=(async()=>{try{await ready;const data=await api('attachment',null,{accountId,messageId:m.id,attachmentId:a.id,partId:a.partId});
          if(version!==state.composeVersion||draftId!==state.draftId)return;
          const bytes=Uint8Array.from(atob(data.data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
          entry.file=new File([bytes],data.filename||a.filename,{type:data.mimeType||entry.type});
          if(bytes.length>20*1024*1024)throw new Error('Attachment exceeds 20 MB');
          await uploadAttachment(entry);
        }catch(e){if(version===state.composeVersion){entry.status='error';entry.error=e.message;renderAttachments();$('#mailxComposeError').textContent='Could not copy an original attachment. Remove it or reopen Forward to retry.';}}finally{attachmentUploads.delete(entry.id);}})();attachmentUploads.set(entry.id,task);
      }
      renderAttachments();
    }
  }
  async function openComposer(m=null,existing=null){
    if(!state.accounts.length){showToast('Connect a Gmail account first.');return settings();}
    if(state.busySend){showToast('Wait for the send to finish.');return;}
    if(attachmentUploads.size){showToast('Wait for attachments to finish before opening another draft.');return;}
    if(ce().pane.classList.contains('is-open')&&(editorText().trim()||ce().to.value||currentAttachments.length)&&!confirm('Save this draft and open another message?'))return;
    if(ce().pane.classList.contains('is-open')&&(editorText().trim()||currentAttachments.length))await saveDraft();
    const c=ce();state.composeVersion++;state.editVersion++;state.busyAi=false;state.replyContext=m;state.history=[];state.redo=[];state.requestId=existing?.requestId||null;state.requestPayload=existing?.requestPayload||null;state.draftId=existing?.id||crypto.randomUUID();currentAttachments=(existing?.attachments||[]).map(a=>({...a,status:'done',error:'',file:null}));attachmentUploads.clear();
    const selected=m?.accountId||existing?.accountId||(state.account!=='all'?state.account:state.accounts[0].id);
    c.from.innerHTML=state.accounts.map(a=>option(a.id,a.display_name+' · '+a.email,selected)).join('');c.from.disabled=!!(m||existing?.threadId);
    c.to.value=existing?.to||(m?(address(m.email)===address(state.accounts.find(a=>a.id===selected)?.email)?m.to:address(m.replyTo)): '');
    c.subject.value=existing?.subject||(m?(/^re:/i.test(m.subject)?m.subject:'Re: '+m.subject):'');c.subject.readOnly=!!(m||existing?.threadId);
    if(existing?.threadId)state.replyContext={threadId:existing.threadId,id:existing.replyMessageId};
    setEditor(existing?.body||'',existing?.bodyHtml||'');savedEditorRange=null;c.prompt.value='';setAiBusy(c,false);renderAttachments();
    c.title.textContent=state.replyContext?'Reply':existing?.forward?'Forward':'New message';c.context.textContent=state.replyContext?'Replying in the original Gmail thread':existing?.forward?'Choose a recipient · original message included':'AI revises the current editable draft below';
    $('#mailxComposeError').textContent='';$('#mailxDraftState').textContent='Saved on this tab as you type';
    c.pane.classList.add('is-open');requestAnimationFrame(()=>{placeFloating(c.pane,'compose');focusFloating(c.pane);});keepDraft();setTimeout(()=>existing?.forward?c.to.focus():c.body.focus(),30);return true;
  }
  async function closeComposer(){
    if(state.busySend)return showToast('Wait for the send to finish.');
    await waitForAttachmentUploads(false);keepDraft();clearTimeout(draftTimer);
    if(editorText().trim()||currentAttachments.length)saveDraft().catch(()=>showToast('Draft is kept on this tab; reconnect to save it securely.'));
    state.composeVersion++;ce().pane.classList.remove('is-open');
  }
  async function saveDraft(snapshot=draftSnapshot()){
    if(!snapshot.id||!snapshot.accountId)return;keepDraft();
    const save=draftSaveChain.catch(()=>{}).then(()=>api('drafts',snapshot));draftSaveChain=save;
    await save;if(snapshot.id===state.draftId&&snapshot.body===editorText())$('#mailxDraftState').textContent='Draft saved securely';
  }
  function scheduleDraftSave(){clearTimeout(draftTimer);$('#mailxDraftState').textContent='Saving draft…';draftTimer=setTimeout(()=>{if(!state.busySend)saveDraft().catch(()=>{$('#mailxDraftState').textContent='Offline · draft kept on this tab';});},1200);}
  async function runAi(){
    const c=ce(),instruction=c.prompt.value.trim();if(state.busyAi||state.busySend)return;
    if(!instruction){c.prompt.focus();return showToast('Tell Gemini what to write or change.');}
    const snapshot=draftSnapshot(),version=state.composeVersion,edited=state.editVersion;setAiBusy(c,true);$('#mailxComposeError').textContent='';
    try{
      const result=await api('ai',{...snapshot,instruction});
      if(version!==state.composeVersion)return;
      if(edited!==state.editVersion||JSON.stringify(snapshot)!==JSON.stringify(draftSnapshot())){showToast('You edited this draft during generation. Your edits are kept; run AI again to include them.');return;}
      state.history.push(editorState());state.redo=[];setEditor(result.body,result.bodyHtml||'');state.editVersion++;c.prompt.value='';keepDraft();scheduleDraftSave();c.body.focus();
    }catch(e){if(version===state.composeVersion)$('#mailxComposeError').textContent=e.message;}
    finally{if(version===state.composeVersion)setAiBusy(c,false);}
  }
  function undoAi(){if(state.busySend||!state.history.length)return;state.redo.push(editorState());const v=state.history.pop();setEditor(v.body,v.bodyHtml);state.editVersion++;keepDraft();scheduleDraftSave();}
  function redoAi(){if(state.busySend||!state.redo.length)return;state.history.push(editorState());const v=state.redo.pop();setEditor(v.body,v.bodyHtml);state.editVersion++;keepDraft();scheduleDraftSave();}
  async function send(sendAt=null){
    if(state.busySend)return;clearTimeout(draftTimer);const c=ce();
    if(!c.to.reportValidity()||!c.to.value.trim()||(!editorText().trim()&&!currentAttachments.length)){showToast('Add a recipient and email body or attachment.');return;}
    if(!await waitForAttachmentUploads(true))return;
    if(state.busySend)return;
    const payload={...draftSnapshot(),draftId:state.draftId,sendAt};delete payload.id;
    if(state.requestId&&JSON.stringify(payload)!==JSON.stringify(state.requestPayload)){showToast('A previous send is unresolved. Check Outbox before sending changed text.');return;}
    state.requestId ||=crypto.randomUUID();state.requestPayload=payload;keepDraft();state.busySend=true;state.composeVersion++;
    const editing=[c.from,c.to,c.subject,c.prompt];const previous=editing.map(el=>el.disabled);editing.forEach(el=>el.disabled=true);const editable=c.body.getAttribute('contenteditable');c.body.setAttribute('contenteditable','false');
    $('#mailxSend').disabled=true;$('#mailxSchedule').disabled=true;$('#mailxSaveDraft').disabled=true;$('#mailxAttach').disabled=true;$$('[data-format-command]').forEach(b=>b.disabled=true);$('#mailxBlockFormat').disabled=true;$('#mailxComposeError').textContent='';
    try{
      await draftSaveChain.catch(()=>{});
      const {job}=await api('send',{...payload,id:state.requestId});
      if(job.status==='failed')throw new Error(job.error+' Open Outbox to restore it.');
      if(job.status==='uncertain')throw new Error('Delivery is uncertain. Check Outbox; do not send a duplicate.');
      showToast(job.status==='sent'?'Sent through Gmail':sendAt?'Scheduled on the server':'Send queued on the server. Check Outbox for its status.');
      api('drafts/delete',{id:state.draftId}).catch(()=>{});try{sessionStorage.removeItem(DRAFT);}catch{}
      c.pane.classList.remove('is-open');state.requestId=null;state.requestPayload=null;state.draftId=null;state.replyContext=null;currentAttachments=[];clearMailCache();loadMail(false,true);
    }catch(e){$('#mailxComposeError').textContent=e.message;keepDraft();}
    finally{state.busySend=false;editing.forEach((el,i)=>el.disabled=previous[i]);c.body.setAttribute('contenteditable',editable||'true');$('#mailxSend').disabled=false;$('#mailxSchedule').disabled=false;$('#mailxSaveDraft').disabled=false;$('#mailxAttach').disabled=false;$$('[data-format-command]').forEach(b=>b.disabled=false);$('#mailxBlockFormat').disabled=false;setAiBusy(c,false);}
  }
  function sheet(title,html,onMount){
    $('#mailxSheet')?.remove();const panel=document.createElement('section');panel.id='mailxSheet';panel.className='mailx-sheet';panel.setAttribute('aria-label',title);
    panel.innerHTML=`<div class="mailx-compose-head"><strong>${escapeHtml(title)}</strong><button class="mailx-icon-button mailx-compose-close" aria-label="Close panel">×</button></div><div class="mailx-sheet-body">${html}</div><div class="mailx-inline-error" role="alert" id="mailxSheetError"></div>`;dialog.appendChild(panel);prepareFloating(panel,'sheet');requestAnimationFrame(()=>{placeFloating(panel,'sheet');focusFloating(panel);});panel.querySelector('.mailx-compose-close').onclick=()=>panel.remove();onMount?.(panel);panel.querySelector('input,button,select')?.focus();return panel;
  }
  const sheetGuard=fn=>async(...args)=>{try{await fn(...args);}catch(e){const el=$('#mailxSheetError');if(el)el.textContent=e.message;else showToast(e.message);}};
  function scheduleSend(){sheet('Schedule send',`<p>Sent by the server even when this PWA is closed.</p><label>Your device’s local time<input id="mailxSendAt" type="datetime-local" required></label><button class="mailx-send" id="mailxConfirmSchedule">Schedule</button>`,p=>{p.querySelector('#mailxConfirmSchedule').onclick=sheetGuard(async()=>{const input=p.querySelector('#mailxSendAt');if(!input.reportValidity())return;const date=new Date(input.value);if(date.getTime()<Date.now()+60000)throw new Error('Choose a time at least one minute ahead.');p.remove();await send(date.toISOString());});});}
  async function unsubscribe(m,accountId){
    const u=m.unsubscribe;sheet('Unsubscribe',`<p>This affects this mailing list. No sender block is added, so receipts and account mail can still arrive.</p>${u.oneClick?'<button class="mailx-send" id="mailxOneClick">Confirm one-click unsubscribe</button>':''}${u.web?`<p><a href="${escapeHtml(u.web)}" target="_blank" rel="noopener noreferrer">Open sender’s unsubscribe page</a></p>`:''}${u.mailto?'<button class="mailx-action" id="mailxUnsubEmail">Review unsubscribe email</button>':''}`,p=>{
      p.querySelector('#mailxOneClick')?.addEventListener('click',sheetGuard(async()=>{const b=p.querySelector('#mailxOneClick');b.disabled=true;try{await api('unsubscribe',{accountId,messageId:m.id,confirm:true});p.remove();showToast('Sender accepted the unsubscribe request. Delivery changes may take time.');}finally{b.disabled=false;}}));
      p.querySelector('#mailxUnsubEmail')?.addEventListener('click',sheetGuard(async()=>{p.remove();await openComposer(null,{accountId,to:u.mailto.to,subject:u.mailto.subject,body:u.mailto.body});}));
    });
  }
  async function ruleEditor(m,accountId,mode='classify'){
    const c=m.classification,types=status.types||[],priorities=status.priorities||[],actions=status.actions||[];
    const scopes=[['thread','This thread'],['sender',m.email],['domain',m.email.split('@')[1]]];if(m.unsubscribe.listId)scopes.push(['list','This mailing list']);
    sheet(mode==='block'?'Block locally':mode==='mute'?'Mute mail':'Classification & rules',`<p>Permanent rules can be removed in Settings. Mail remains in Gmail and All mail.</p><label>Apply to<select id="ruleScope">${scopes.map(([v,l])=>option(v,l,mode==='classify'?'thread':m.unsubscribe.listId?'list':'sender')).join('')}</select></label><label>Only this mail type<select id="ruleTypeMatch">${option('','All types','')+types.map(t=>option(t,t,mode!=='classify'&&['Promotion','Newsletter','Receipt / Order'].includes(c.type)?c.type:'')).join('')}</select></label>${mode==='classify'?`<label>Type<select id="ruleType">${types.map(t=>option(t,t,c.type)).join('')}</select></label><label>Priority<select id="rulePriority">${priorities.map(t=>option(t,t,c.priority)).join('')}</select></label><label>Context<input id="ruleContext" maxlength="120" value="${escapeHtml(c.context)}"></label><label>Action<select id="ruleAction">${actions.map(t=>option(t,t,c.action)).join('')}</select></label>`:''}<button class="mailx-send" id="ruleSave">${mode==='block'?'Confirm local block':mode==='mute'?'Confirm mute':'Save rule'}</button>`,p=>{
      p.querySelector('#ruleSave').onclick=sheetGuard(async()=>{
        const scope=p.querySelector('#ruleScope').value,typeMatch=p.querySelector('#ruleTypeMatch').value,value=({thread:m.threadId,sender:m.email,domain:m.email.split('@')[1],list:m.unsubscribe.listId})[scope];
        const effects=mode==='block'?{blocked:true}:mode==='mute'?{priority:'Muted'}:{type:p.querySelector('#ruleType').value,priority:p.querySelector('#rulePriority').value,context:p.querySelector('#ruleContext').value,action:p.querySelector('#ruleAction').value};
        const saveButton=p.querySelector('#ruleSave');saveButton.disabled=true;try{await api('rules',{accountId,scope,value,typeMatch,effects});p.remove();showToast('Rule saved. Remove it in Settings to undo.');clearMailCache();const current=state.thread;await Promise.all([loadMail(false,true),current?fetchThread({accountId,threadId:current.threadId},true).then(updated=>{if(state.thread===current){state.thread=updated;renderReader();}}):Promise.resolve()]);}finally{saveButton.disabled=false;}
      });
    });
  }
  async function senderDetails(m,accountId){
    const related=state.messages.filter(x=>x.accountId===accountId&&x.email===m.email),counts={};related.forEach(x=>counts[x.classification.type]=(counts[x.classification.type]||0)+1);
    sheet(m.sender,`<p>${escapeHtml(m.email)}</p><p>${related.length} threads in the loaded results</p>${Object.entries(counts).map(([t,n])=>`<p>${escapeHtml(t)} · ${n}</p>`).join('')}<button class="mailx-action" id="senderView">View all sender mail</button> <button class="mailx-action" id="senderRule">Set a type-specific rule</button>`,p=>{p.querySelector('#senderView').onclick=()=>{p.remove();searchEl.value='from:'+m.email;state.query=searchEl.value;state.account=accountId;setFilter('all');};p.querySelector('#senderRule').onclick=guarded(()=>ruleEditor(m,accountId));});
  }
  async function loadSpecial(){
    const version=++state.loadVersion;renderFilters();notice('Loading…');$('#mailxRefresh').disabled=true;$('#mailxListMeta').textContent=categoryLabel(state.filter);
    try{
      const isDraft=state.filter==='drafts',data=await api(isDraft?'drafts':'outbox');if(version!==state.loadVersion)return;
      const rows=(isDraft?data.drafts:data.jobs).filter(r=>state.account==='all'||r.account_id===state.account);
      listEl.innerHTML=rows.map((r,i)=>isDraft
        ? `<div class="mailx-message-wrap">
            <button class="mailx-message" type="button" data-draft="${i}">
              ${avatar(accountName(r.account_id))}
              <span class="mailx-row-content">
                <span class="mailx-message-head"><span class="mailx-sender">${escapeHtml(accountName(r.account_id))}</span><span class="mailx-time">${escapeHtml(time(r.updated_at))}</span></span>
                <span class="mailx-subject">${escapeHtml(r.subject||'(no subject)')}</span>
                <span class="mailx-snippet">${r.to_address?'To: '+escapeHtml(r.to_address):'No recipient yet'}</span>
                <span class="mailx-message-foot"><span class="mailx-account">Draft</span><span class="mailx-row-status">Saved draft</span></span>
              </span>
            </button>
            <div class="mailx-row-actions"><button data-row-action="trash" data-delete-draft="${i}" type="button" title="Delete draft" aria-label="Delete draft">×</button></div>
          </div>`
        : `<div class="mailx-message"><strong>${escapeHtml(r.subject||'(no subject)')}</strong><div class="mailx-snippet">${escapeHtml(accountName(r.account_id))}${r.to_address?' · '+escapeHtml(r.to_address):''}</div><p>${escapeHtml(r.status+' · '+time(r.send_at))}</p>${r.error?`<p class="mailx-inline-error">${escapeHtml(r.error)}</p>`:''}${['pending','processing'].includes(r.status)?`<button class="mailx-action" data-cancel="${i}">Cancel send</button>`:''}${['sending','uncertain'].includes(r.status)?`<button class="mailx-action" data-check="${i}">Check Gmail delivery</button>`:''}${['cancelled','failed'].includes(r.status)?`<button class="mailx-action" data-restore="${i}">Restore draft</button>`:''}</div>`
      ).join('')||'<div class="mailx-empty-list">Nothing here yet.</div>';
      $$('[data-draft]').forEach(b=>b.onclick=guarded(async()=>{const {draft}=await api('drafts/open',{id:rows[+b.dataset.draft].id});await openComposer(null,draft);}));
      $$('[data-delete-draft]').forEach(b=>b.onclick=guarded(async()=>{if(!confirm('Delete this saved Mail draft?'))return;await api('drafts/delete',{id:rows[+b.dataset.deleteDraft].id});await loadSpecial();}));
      for(const action of ['cancel','check','restore'])$$('[data-'+action+']').forEach(b=>b.onclick=guarded(async()=>{const row=rows[+b.dataset[action]];if(action==='cancel'&&!confirm('Cancel this scheduled send?'))return;b.disabled=true;try{const data=await api('outbox/'+action,{id:row.id});if(action==='restore'){await openComposer(null,data.draft);showToast(data.note);}else{await loadSpecial();if(data.job?.error)showToast(data.job.error);}}finally{b.disabled=false;}}));
      notice('');
    }catch(e){if(version===state.loadVersion)notice(e.message);}
    finally{if(version===state.loadVersion)$('#mailxRefresh').disabled=false;}
  }
  function setFilter(filter){state.filter=filter;state.readVersion++;shell.classList.remove('is-reading','is-reader-focused');remember();loadMail();}
  async function connect(){
    const proof=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),challenge=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof))),b=>b.toString(16).padStart(2,'0')).join('');
    const pending=await api('oauth/start',{challenge});writeStore(OAUTH,{state:pending.state,proof,expires:Date.now()+600000});
    keepDraft();location.assign(pending.url);
  }
  async function finishConnection(){
    const pending=readStore(OAUTH,null);if(!pending||pending.expires<Date.now())return;
    const result=await api('oauth/finish',{state:pending.state,proof:pending.proof});
    if(result.pending)return;
    sessionStorage.removeItem(OAUTH);showToast('Connected '+result.email);clearMailCache();await refreshAccounts();await loadMail(false,true);
  }
  async function settings(){
    const loading=sheet('Mail settings','<p>Loading settings…</p>');
    const data=await Promise.all([api('status'),api('rules')]);status=data[0];rules=data[1].rules;if(!loading.isConnected)return;
    sheet('Mail settings',`<h3>Connected accounts</h3>${state.accounts.map((a,i)=>`<div class="mailx-settings-account"><strong>${escapeHtml(a.display_name)}</strong><p>${escapeHtml(a.email)} · ${escapeHtml(a.status)}</p><small>${a.last_sync_at?'Last sync '+escapeHtml(time(a.last_sync_at)):'Initial sync pending'}${a.sync_error?' · '+escapeHtml(a.sync_error):''}</small><p><button class="mailx-action" data-rename="${i}">Rename</button> <button class="mailx-action" data-disconnect="${i}">Disconnect</button></p></div>`).join('')||'<p>No Gmail accounts connected.</p>'}<button class="mailx-send" id="mailxConnect">Connect Gmail</button><h3>Rules · reversible</h3>${rules.map((r,i)=>`<div class="mailx-rule"><span>${escapeHtml(r.scope+': '+r.match_value)}${r.type_match?' · '+escapeHtml(r.type_match):''}<br>${escapeHtml(Object.entries(r.effects).map(([k,v])=>k+': '+v).join(', '))}</span><button class="mailx-action" data-remove-rule="${i}">Remove</button></div>`).join('')||'<p>No saved rules.</p>'}<h3>Background service</h3><p>${status.health?.last_finished_at?'Last completed: '+escapeHtml(time(status.health.last_finished_at)):'Scheduler has not completed a run yet.'}</p><details ${status.configured?'':'open'}><summary>Google & Gemini setup</summary><p>Secrets are sent directly to the protected backend and stored encrypted. Existing values are never displayed.</p><p>Google callback URL:</p><code class="mailx-callback">${escapeHtml(status.redirectUri)}</code><form id="mailxConfig" autocomplete="off"><label>Google Web OAuth client ID<input name="GOOGLE_CLIENT_ID" type="text" autocomplete="off" placeholder="Leave blank to keep current"></label><label>Google client secret<input name="GOOGLE_CLIENT_SECRET" type="password" autocomplete="new-password" placeholder="Leave blank to keep current"></label><label>Gemini API key<input name="GEMINI_API_KEY" type="password" autocomplete="new-password" placeholder="Leave blank to keep current"></label><label>Gemini model<input name="GEMINI_MODEL" type="text" value="${escapeHtml(status.model||'')}" placeholder="Model ID from Google AI Studio"></label><p>AI sends only the current draft and relevant thread to Gemini when you request a revision.</p><button class="mailx-send" type="submit">Save securely</button></form><p><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Google OAuth configuration</a> · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Gemini API key</a></p></details>`,p=>{
      p.querySelector('#mailxConnect').onclick=sheetGuard(connect);
      p.querySelector('#mailxConfig').onsubmit=sheetGuard(async e=>{e.preventDefault();const form=e.target,values=Object.fromEntries(new FormData(form));const b=form.querySelector('button');b.disabled=true;try{await api('settings',values);form.reset();showToast('Settings saved securely');await settings();}finally{b.disabled=false;}});
      p.querySelectorAll('[data-remove-rule]').forEach(b=>b.onclick=sheetGuard(async()=>{await api('rules/delete',{id:rules[+b.dataset.removeRule].id});clearMailCache();await settings();await loadMail(false,true);}));
      p.querySelectorAll('[data-rename]').forEach(b=>b.onclick=sheetGuard(async()=>{const a=state.accounts[+b.dataset.rename],name=prompt('Account display name',a.display_name);if(!name)return;await api('accounts/rename',{accountId:a.id,name});await refreshAccounts();await settings();}));
      p.querySelectorAll('[data-disconnect]').forEach(b=>b.onclick=sheetGuard(async()=>{const a=state.accounts[+b.dataset.disconnect];if(!confirm('Disconnect '+a.email+'? Gmail mail will remain untouched.'))return;const r=await api('accounts/disconnect',{accountId:a.id,confirm:a.email});clearMailCache();await refreshAccounts();await settings();await loadMail(false,true);showToast(r.revoked?'Account disconnected':'Disconnected locally. Also remove this app in Google Account permissions.');}));
    });
  }
  async function refreshAccounts(){const before=state.accounts.map(a=>a.id).join(','),data=await api('accounts');state.accounts=data.accounts;if(state.account!=='all'&&!state.accounts.some(a=>a.id===state.account))state.account='all';state.messages=state.messages.filter(m=>state.accounts.some(a=>a.id===m.accountId));if(['drafts','outbox'].includes(state.filter))renderFilters();else renderList();if(before!==state.accounts.map(a=>a.id).join(',')){clearMailCache();loadMail(false,true);}}
  async function openDialog(){
    if(!dialog.open)dialog.showModal();shell.classList.remove('is-reading','is-reader-focused');
    if(matchMedia('(min-width:861px)').matches){
      const main=$('.mailx-main'),v=clampLayout(parseFloat(getComputedStyle(main).getPropertyValue('--mailx-nav-w')),parseFloat(getComputedStyle(main).getPropertyValue('--mailx-list-w')));
      applyLayout(v.nav,v.list);
    }
    try{
      ownCache();
      if(initialized){renderList();Promise.all([refreshAccounts(),loadMail()]).catch(e=>showToast(e.message));return;}
      const data=await bootstrap();state.accounts=data.accounts;
      let local={};try{local=JSON.parse(localStorage.getItem(PREF)||'{}');}catch{}
      const pref={...data.preferences,...local};state.filter=views[pref.filter]?pref.filter:'inbox';state.account=state.accounts.some(a=>a.id===pref.account)?pref.account:'all';
      state.messages=(data.messages||[]).filter(m=>(state.account==='all'||m.accountId===state.account)&&matchesView(m,state.filter));state.hasMore=false;initialized=true;
      if($('#mailxConnection'))$('#mailxConnection').textContent=state.accounts.length?'Gmail':'Setup';renderList();prefetchReaders();
      api('status').then(value=>{status=value;if($('#mailxConnection'))$('#mailxConnection').textContent=status.configured?'Gmail':'Setup needed';}).catch(()=>{});
      if(readStore(OAUTH,null))await finishConnection();else loadMail(false,true);
      const params=new URLSearchParams(location.search);if(params.has('connect_error'))showToast('Google connection was not completed. Try connecting again.');
      if(params.has('connected')&&!readStore(OAUTH,null)&&!state.accounts.length)notice('Return to the browser or PWA where you started connecting to complete account pairing.');
      if(params.has('connected')||params.has('connect_error')){params.delete('connected');params.delete('connect_error');history.replaceState({},'',location.pathname+'?'+params.toString());}
    }catch(e){notice(e.message);}
  }
  function modernChrome(){
    const top=$('.mailx-topbar'),nav=$('.mailx-nav'),search=$('#mailxSearch'),refresh=$('#mailxRefresh'),compose=$('#mailxComposeMain');
    $('.mailx-top-spacer').replaceWith(search);refresh.textContent='↻';refresh.title='Refresh mail';refresh.setAttribute('aria-label','Refresh mail');top.insertBefore(refresh,$('#mailxSettings'));
    compose.textContent='＋ Compose';top.insertBefore(compose,$('#mailxSettings'));$('#mailxComposeMobile').hidden=true;
    const account=$('.mailx-nav [data-mailx-account-filter]');account.classList.add('mailx-top-account');const switcher=document.createElement('label');switcher.className='mailx-account-switch';switcher.title='Switch connected account';switcher.innerHTML='<span id="mailxAccountAvatar" aria-hidden="true">∞</span>';switcher.appendChild(account);top.insertBefore(switcher,$('#mailxSettings'));
    $('#mailxSettings').innerHTML=icon('more');$('#mailxSettings').title='Accounts, rules and settings';
    nav.innerHTML=['inbox','unread','starred','sent','drafts','trash'].map(k=>'<button class="mailx-filter" data-mailx-filter="'+k+'" aria-label="'+categoryLabel(k)+'" title="'+categoryLabel(k)+'">'+icon(k)+(k==='inbox'?'<span id="mailxUnreadCount" class="mailx-rail-count"></span>':'')+'</button>').join('')+'<span class="mailx-rail-divider"></span><button class="mailx-filter" data-mailx-filter="archived" aria-label="Archived" title="Archived">'+icon('archive')+'</button>';
    $('[data-mailx-resizer="nav"]').remove();
    $('.mailx-mobile-tabs').innerHTML=['inbox','unread','starred','sent','drafts','trash'].map(k=>'<button class="mailx-mobile-tab" data-mailx-mobile-filter="'+k+'">'+categoryLabel(k)+'</button>').join('');
    const launch=document.querySelector('#mailDashboardButton');launch.insertAdjacentHTML('beforeend','<span class="mailx-launch-count" hidden></span>');
    const peek=document.createElement('section');peek.id='mailxPeek';peek.className='mailx-peek';peek.hidden=true;peek.setAttribute('aria-label','Latest unread mail');document.body.appendChild(peek);
    let timer;const hide=()=>{timer=setTimeout(()=>peek.hidden=true,200);},show=()=>{if(!peek.innerHTML||dialog.open)return;clearTimeout(timer);const r=launch.getBoundingClientRect();peek.style.top=(r.bottom+8)+'px';peek.style.right=Math.max(12,innerWidth-r.right)+'px';peek.hidden=false;};
    launch.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')show();});launch.addEventListener('focus',show);launch.addEventListener('pointerleave',hide);launch.addEventListener('blur',hide);peek.addEventListener('pointerenter',()=>clearTimeout(timer));peek.addEventListener('pointerleave',hide);peek.addEventListener('focusin',()=>clearTimeout(timer));peek.addEventListener('focusout',hide);launch.addEventListener('click',()=>peek.hidden=true);
  }
  function mount(){
    const launch=document.querySelector('#mailDashboardButton');if(!launch)return;
    const embeddedDialog=document.querySelector('#mailDemoDialog.mail-console-view');
    launch.addEventListener('click',e=>{e.preventDefault();if(embeddedDialog&&dialog?.open)dialog.close();else openDialog();});launch.setAttribute('aria-label','Open Mail');launch.title='Open Mail';
    if(!embeddedDialog){dialog=document.createElement('dialog');dialog.id='mailDemoDialog';dialog.className='mailx-dialog';
    dialog.innerHTML='<div class="mailx-shell" id="mailxShell"><header class="mailx-topbar"><div class="mailx-brand"><span class="mailx-brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m5 8 7 5 7-5"/></svg></span><span class="mailx-title">Mail</span><span class="mailx-demo-badge" id="mailxConnection">Mail</span></div><div class="mailx-top-spacer"></div><button class="mailx-top-action mailx-compose-mobile" type="button" id="mailxComposeMobile">＋ Compose</button><button class="mailx-top-action" type="button" id="mailxSettings" aria-label="Mail settings">⚙</button><button class="mailx-icon-button" type="button" id="mailxClose" aria-label="Close mail">×</button></header><div class="mailx-mobile-tabs">'+['inbox','important','reply','codes','low','all'].map(k=>'<button class="mailx-mobile-tab" data-mailx-mobile-filter="'+k+'">'+categoryLabel(k)+'</button>').join('')+'</div><div class="mailx-main"><nav class="mailx-nav" aria-label="Mail views"><button class="mailx-compose-main" type="button" id="mailxComposeMain">＋ Compose</button><div class="mailx-nav-label">MAIL</div>'+[['inbox','important','reply'],['codes','low'],['all','blocked','archived'],['sent','drafts','outbox']].map(group=>'<div class="mailx-nav-group">'+group.map(k=>'<button class="mailx-filter" type="button" data-mailx-filter="'+k+'"><span>'+categoryLabel(k)+'</span></button>').join('')+'</div>').join('')+'<div class="mailx-nav-label">ACCOUNT</div><select class="mailx-account-select" data-mailx-account-filter aria-label="Connected account"><option value="all">All connected</option></select><p class="mailx-nav-note">Local blocks stay available in Blocked and All mail.</p></nav><div class="mailx-resizer" data-mailx-resizer="nav" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize mail navigation"></div><section class="mailx-list-pane"><div class="mailx-list-tools"><div class="mailx-list-controls"><input aria-label="Search mail" id="mailxSearch" class="mailx-search" type="search" placeholder="Search mail…" autocomplete="off"><select class="mailx-account-select mailx-account-select-list" data-mailx-account-filter aria-label="Connected account"><option value="all">All connected</option></select></div><div class="mailx-list-meta" id="mailxListMeta"></div><div class="mailx-list-extra"><select id="mailxView" aria-label="Mail view"></select><button class="mailx-action" id="mailxMarkAllRead">Mark all read</button><button class="mailx-action" id="mailxRefresh">↻ Refresh</button></div><div id="mailxNotice" role="status"></div></div><div class="mailx-list" id="mailxList"></div></section><div class="mailx-resizer" data-mailx-resizer="list" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize message list"></div><section class="mailx-reader" id="mailxReader"></section></div></div><section aria-label="Email composer" class="mailx-compose" id="mailxCompose"><div class="mailx-compose-head"><div><div class="mailx-compose-title" id="mailxComposeTitle">New message</div><div class="mailx-compose-context" id="mailxComposeContext"></div></div><button class="mailx-icon-button mailx-compose-close" id="mailxComposeClose" type="button" aria-label="Close composer">×</button></div><div class="mailx-compose-fields"><div class="mailx-field-row"><label for="mailxFrom">From</label><select id="mailxFrom" aria-label="Sending account"></select></div><div class="mailx-field-row"><label for="mailxTo">To</label><input id="mailxTo" type="email" multiple placeholder="name@example.com"></div><div class="mailx-field-row"><label for="mailxSubject">Subject</label><input id="mailxSubject" type="text" placeholder="Subject"></div></div><div class="mailx-ai-wrap"><div class="mailx-ai-label"><span>AI COMMAND</span><span>Gemini</span></div><div class="mailx-ai-row"><textarea aria-label="AI instruction" id="mailxAiPrompt" class="mailx-ai-prompt" placeholder="Tell AI what to write or change. It always uses the current email draft below as reference."></textarea><button id="mailxGenerate" class="mailx-ai-generate" type="button"><span class="mailx-ai-spinner" aria-hidden="true"></span><span class="mailx-ai-generate-label">Generate</span></button></div><div class="mailx-ai-chips"><button class="mailx-ai-chip" type="button" data-mailx-ai-chip="make it shorter">Shorter</button><button class="mailx-ai-chip" type="button" data-mailx-ai-chip="make it warmer and friendlier">Warmer</button><button class="mailx-ai-chip" type="button" data-mailx-ai-chip="make it more formal">More formal</button><button class="mailx-ai-chip" type="button" data-mailx-ai-chip="fix the grammar without changing my meaning">Fix grammar</button></div></div><div class="mailx-editor-label"><span>EMAIL</span><span class="mailx-editor-tools"><button id="mailxUndo" type="button">Undo AI</button><button id="mailxRedo" type="button">Redo</button></span></div><div class="mailx-format-toolbar" role="toolbar" aria-label="Text formatting"><select id="mailxBlockFormat" aria-label="Text style"><option value="p">Normal</option><option value="h3">Small heading</option><option value="h2">Heading</option><option value="h1">Large heading</option><option value="blockquote">Quote</option></select><span class="mailx-format-divider"></span><button type="button" data-format-command="bold" aria-label="Bold"><strong>B</strong></button><button type="button" data-format-command="italic" aria-label="Italic"><em>I</em></button><button type="button" data-format-command="underline" aria-label="Underline"><u>U</u></button><button type="button" data-format-command="strikeThrough" aria-label="Strikethrough"><s>S</s></button><span class="mailx-format-divider"></span><button type="button" data-format-command="insertUnorderedList" aria-label="Bulleted list">• List</button><button type="button" data-format-command="insertOrderedList" aria-label="Numbered list">1. List</button><button type="button" id="mailxLink" aria-label="Add link">Link</button><button type="button" data-format-command="removeFormat" aria-label="Clear formatting">Clear</button><span class="mailx-format-spacer"></span><button type="button" id="mailxAttach" class="mailx-attach-button" aria-label="Add attachments" title="Attach files">📎</button><input id="mailxAttachmentInput" type="file" multiple hidden></div><div aria-label="Editable email body" id="mailxBody" class="mailx-email-body" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Write manually here, or use the AI command above…"></div><div id="mailxAttachments" class="mailx-attachment-list" aria-live="polite"></div><div id="mailxComposeError" class="mailx-inline-error" role="alert"></div><div class="mailx-compose-foot"><span class="mailx-compose-note"><span id="mailxDraftState">Your editable draft</span></span><button class="mailx-action mailx-save-draft-icon" id="mailxSaveDraft" type="button" aria-label="Save draft" title="Save draft"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h8V4"/><path d="M8 20v-6h8v6"/></svg></button><button class="mailx-schedule" id="mailxSchedule" type="button">Schedule</button><button class="mailx-send" id="mailxSend" type="button">Send</button></div></section><div class="mailx-toast" id="mailxToast" role="status"></div>';
    document.body.appendChild(dialog);modernChrome();
    }else{
      dialog=embeddedDialog;dialog.open=false;
      const machine=dialog.closest('.machine');
      const setEmbeddedMode=open=>{
        dialog.open=!!open;dialog.classList.toggle('is-open',!!open);machine?.classList.toggle('mail-mode',!!open);
        const title=document.getElementById('consoleTitle'),eyebrow=document.getElementById('consoleEyebrow'),serial=document.getElementById('consoleSerial'),legend=document.getElementById('mailKeyLegend'),glyph=document.getElementById('mailKeyGlyph');
        if(title)title.textContent=open?'Mail':'My Schedule';
        if(eyebrow)eyebrow.textContent=open?'NTU PERSONAL MAIL TERMINAL':'NATIONAL TAIWAN UNIVERSITY · FALL 2026';
        if(serial)serial.textContent=open?'MAIL WORKSPACE / NTU-ME-06':'PERSONAL ACADEMIC CONSOLE / NTU-ME-06';
        if(legend)legend.textContent=open?'BACK':'MAIL';if(glyph)glyph.textContent=open?'←':'✉';
        if(!open)shell?.classList.remove('is-reading','is-reader-focused');
      };
      dialog.showModal=()=>setEmbeddedMode(true);
      dialog.close=()=>{try{keepDraft();}catch{}dialog.querySelector('#mailxCompose')?.classList.remove('is-open');dialog.querySelector('#mailxSheet')?.remove();setEmbeddedMode(false);};
      dialog.querySelector('#mailxListResizer')?.setAttribute('data-mailx-resizer','list');
    }
    shell=$('#mailxShell');listEl=$('#mailxList');readerEl=$('#mailxReader');searchEl=$('#mailxSearch');accountEls=[...dialog.querySelectorAll('[data-mailx-account-filter]')];if(!accountEls.length&&$('#mailxAccount'))accountEls=[$('#mailxAccount')];initMailWorkspaceInteractions();
    if($('#mailxClose'))$('#mailxClose').onclick=()=>{keepDraft();dialog.close();};$('#mailxSettings').onclick=guarded(settings);
    $('#mailxComposeMain').onclick=guarded(()=>openComposer());$('#mailxComposeMobile').onclick=guarded(()=>openComposer());$('#mailxComposeClose').onclick=closeComposer;
    $('#mailxGenerate').onclick=runAi;$('#mailxUndo').onclick=undoAi;$('#mailxRedo').onclick=redoAi;$('#mailxSchedule').onclick=scheduleSend;$('#mailxSend').onclick=()=>send();$('#mailxSaveDraft').onclick=guarded(()=>saveDraft());
    $('#mailxAttach').onclick=()=>$('#mailxAttachmentInput').click();$('#mailxAttachmentInput').onchange=e=>{addFiles(e.target.files);e.target.value='';};
    $$('[data-format-command]').forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>formatEditor(b.dataset.formatCommand);});
    $('#mailxBlockFormat').onchange=e=>{formatEditor('formatBlock',e.target.value);};$('#mailxLink').onmousedown=e=>e.preventDefault();$('#mailxLink').onclick=()=>{restoreEditorRange();const sel=getSelection();if(!sel||sel.isCollapsed)return showToast('Select text to turn into a link.');const href=prompt('Link URL');if(!href)return;try{const u=new URL(href);if(!['http:','https:','mailto:'].includes(u.protocol))throw 0;formatEditor('createLink',href);}catch{showToast('Use an http, https, or mailto link.');}};
    $('#mailxRefresh').onclick=guarded(async()=>{
      const button=$('#mailxRefresh');button.disabled=true;
      try{
        const ids=(state.account==='all'?state.accounts.map(a=>a.id):[state.account]).filter(Boolean).slice(0,3);
        await Promise.all(ids.map(accountId=>api('sync',{accountId}).catch(()=>null)));
        clearPageCache();await refreshAccounts();await loadMail(false,true);
      }finally{button.disabled=false;}
    });
    $('#mailxMarkAllRead').onclick=guarded(async()=>{const b=$('#mailxMarkAllRead');b.disabled=true;try{showToast('Marking all unread as read…');const data=await api('mark-all-read',{accountId:state.account});clearMailCache();state.messages.forEach(m=>{m.labels=m.labels.filter(x=>x!=='UNREAD');});state.messages=state.messages.filter(m=>matchesView(m,state.filter));renderList();showToast(data.count?('Marked '+data.count+' messages read'):'No unread messages');await loadMail(false,true);}finally{b.disabled=false;}});
    $('#mailxView').onchange=e=>setFilter(e.target.value);
    $$('[data-mailx-filter]').forEach(b=>b.onclick=()=>setFilter(b.dataset.mailxFilter));$$('[data-mailx-mobile-filter]').forEach(b=>b.onclick=()=>setFilter(b.dataset.mailxMobileFilter));
    $$('[data-mailx-ai-chip]').forEach(b=>b.onclick=()=>{ce().prompt.value=b.dataset.mailxAiChip;runAi();});
    searchEl.oninput=()=>{state.query=searchEl.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadMail(),350);};
    accountEls.forEach(el=>el.onchange=()=>{state.account=el.value;state.readVersion++;shell.classList.remove('is-reading','is-reader-focused');remember();loadMail();});
    [ce().from,ce().to,ce().subject].forEach(el=>el.addEventListener('input',()=>{state.editVersion++;state.redo=[];keepDraft();if(!attachmentUploads.size)scheduleDraftSave();}));
    ce().body.addEventListener('input',composerChanged);ce().body.addEventListener('keyup',saveEditorRange);ce().body.addEventListener('mouseup',saveEditorRange);
    ce().body.addEventListener('paste',e=>{if(e.clipboardData?.files?.length){e.preventDefault();addFiles(e.clipboardData.files);}});
    ce().pane.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();ce().pane.classList.add('is-file-drag');}});
    ce().pane.addEventListener('dragleave',e=>{if(!ce().pane.contains(e.relatedTarget))ce().pane.classList.remove('is-file-drag');});
    ce().pane.addEventListener('drop',e=>{ce().pane.classList.remove('is-file-drag');if(e.dataTransfer?.files?.length){e.preventDefault();addFiles(e.dataTransfer.files);}});
    document.addEventListener('selectionchange',()=>{if(dialog.open&&ce().pane.classList.contains('is-open')){saveEditorRange();updateFormatState();}});
    dialog.addEventListener('cancel',e=>{if($('#mailxSheet')){e.preventDefault();$('#mailxSheet').remove();}else if(ce().pane.classList.contains('is-open')){e.preventDefault();closeComposer();}else keepDraft();});
    window.addEventListener('pagehide',keepDraft);window.addEventListener('focus',()=>{if(dialog.open)guarded(finishConnection)();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&dialog.open&&!ce().pane.classList.contains('is-open'))guarded(()=>loadMail())();});
    blankReader();renderFilters();setTimeout(()=>{if(!dialog.open&&localStorage.getItem('ntu-schedule-pairing-key-v1')){ownCache();bootstrap().then(data=>{if(!initialized){state.accounts=data.accounts;state.messages=data.messages||[];updateUnread();}}).catch(()=>{});}},1500);const open=new URLSearchParams(location.search).get('open');if(open==='mail'||open==='mail-demo')setTimeout(openDialog,80);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();

