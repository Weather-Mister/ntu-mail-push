/* Eren Mail. Keeps the original mailx shell and visual language; no mock mail. */
(() => {
  'use strict';
  const API='https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/eren-mail';
  const PREF='eren-mail-preferences-v1', DRAFT='eren-mail-draft-v1', OAUTH='eren-mail-oauth-v1', LAYOUT='eren-mail-layout-v1', FLOATING='eren-mail-floating-v1';
  const state={filter:'inbox',account:'all',query:'',accounts:[],messages:[],selected:null,thread:null,cursor:{},hasMore:false,history:[],redo:[],replyContext:null,loadVersion:0,readVersion:0,composeVersion:0,editVersion:0,busySend:false,busyAi:false,requestId:null,requestPayload:null,draftId:null};
  let messagesKey='';
  const pageCache=new Map(),threadCache=new Map(),threadRequests=new Map();
  let cacheOwner='',cacheEpoch=0,initialized=false,preferenceTimer;
  const viewKey=()=>JSON.stringify([state.account,state.filter,state.query]);
  const threadKey=m=>m.accountId+':'+m.threadId;
  function clearMailCache(){cacheEpoch++;pageCache.clear();threadCache.clear();threadRequests.clear();}
  function ownCache(){const owner=typeof requirePairing==='function'?requirePairing():'';if(cacheOwner&&cacheOwner!==owner){clearMailCache();state.readVersion++;state.loadVersion++;initialized=false;state.accounts=[];state.messages=[];state.thread=null;}cacheOwner=owner;return owner;}
  function putCache(cache,key,value,limit=20){cache.delete(key);cache.set(key,{value,at:Date.now()});while(cache.size>limit)cache.delete(cache.keys().next().value);}
  async function fetchThread(m,force=false){
    const key=threadKey(m),cached=threadCache.get(key);if(!force&&cached&&Date.now()-cached.at<45000)return cached.value;
    if(threadRequests.has(key))return threadRequests.get(key);
    const owner=cacheOwner,epoch=cacheEpoch;const pending=api('thread',null,{accountId:m.accountId,threadId:m.threadId}).then(t=>{if(owner===cacheOwner&&epoch===cacheEpoch&&t.messages.reduce((n,m)=>n+(m.html?.length||0)+(m.text?.length||0),0)<2000000)putCache(threadCache,key,t,6);return t;});threadRequests.set(key,pending);
    try{return await pending;}finally{if(threadRequests.get(key)===pending)threadRequests.delete(key);}
  }
  function prefetchReaders(){if(!dialog.open)return;state.messages.slice(0,3).forEach(m=>fetchThread(m).catch(()=>{}));}
  let dialog,shell,listEl,readerEl,searchEl,accountEls=[],toastTimer,searchTimer,draftTimer,draftSaveChain=Promise.resolve(),status={types:['University','Personal','Finance','Shopping','Travel','Work','Security','Login Code','Receipt / Order','Newsletter','Promotion','Account Notification','Social','Other'],priorities:['High','Normal','Low','Muted'],actions:['Needs reply','Deadline','Waiting','FYI','No action']},rules=[];
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const $=s=>dialog.querySelector(s), $$=s=>[...dialog.querySelectorAll(s)];
  const views={inbox:'Inbox',important:'Important',reply:'Needs reply',codes:'Codes',low:'Low',all:'All mail',blocked:'Blocked',archived:'Archived',sent:'Sent',drafts:'Drafts',outbox:'Outbox'};
  const categoryLabel=k=>views[k]||'Mail';
  const accountName=id=>state.accounts.find(a=>a.id===id)?.display_name||'Account';
  const time=t=>new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
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
    return {width,navMin:compact?168:180,navMax:Math.min(292,width*.3),listMin:compact?250:285,readerMin:compact?320:400,gutters:18};
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
    let r;try{r=await fetch(url,{method:body===null?'GET':'POST',headers:{'x-schedule-key':key,...(body===null?{}:{'Content-Type':'application/json'})},body:body===null?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(route==='ai'?65000:90000)});}catch{throw new Error('Connection interrupted. Your draft is safe. For sends, check Outbox before trying again.');}
    const data=await r.json().catch(()=>({error:'Mail service is unavailable.'}));
    if(!r.ok)throw new Error(data.error||'Mail request failed.');return data;
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
    $$('[data-mailx-filter]').forEach(b=>b.classList.toggle('is-active',state.filter===b.dataset.mailxFilter));
    $$('[data-mailx-mobile-filter]').forEach(b=>b.classList.toggle('is-active',state.filter===b.dataset.mailxMobileFilter));
    accountEls.forEach(el=>{el.innerHTML=option('all','All connected',state.account)+state.accounts.map(a=>option(a.id,a.display_name,state.account)).join('');});
    $('#mailxView').innerHTML=Object.entries(views).map(([v,l])=>option(v,l,state.filter)).join('');
  }
  function chipsFor(m){const c=m.classification||{};return [c.priority==='High'?'<span class="mailx-chip high">High</span>':'',c.type==='Login Code'?'<span class="mailx-chip code">Code</span>':'',c.action&&c.action!=='No action'?`<span class="mailx-chip reply">${escapeHtml(c.action)}</span>`:'',['Low','Muted'].includes(c.priority)?`<span class="mailx-chip low">${c.priority}</span>`:'',c.blocked?'<span class="mailx-chip blocked">Blocked</span>':'',c.needsClassification?'<span class="mailx-chip">Needs classification</span>':''].join('');}
  function renderList(){
    renderFilters();$('#mailxListMeta').textContent=`${categoryLabel(state.filter)} · ${state.messages.length} loaded`;
    listEl.innerHTML=state.messages.length?state.messages.map((m,i)=>`<div class="mailx-message-wrap" data-swipe-row="${i}" data-swipe-enabled="${m.labels.includes('INBOX')?'1':'0'}"><div class="mailx-swipe-action" aria-hidden="true">Archive</div><button class="mailx-message ${state.selected===m.accountId+':'+m.threadId?'is-selected':''} ${m.labels.includes('UNREAD')?'is-unread':''}" type="button" data-row="${i}"><div class="mailx-message-head">${m.labels.includes('UNREAD')?'<span class="mailx-unread-dot"></span>':''}<span class="mailx-sender">${escapeHtml(m.sender)}</span><span class="mailx-account" title="${escapeHtml(accountName(m.accountId))}">${escapeHtml(accountName(m.accountId))}</span><span class="mailx-time">${escapeHtml(time(m.timestamp))}</span></div><div class="mailx-subject">${escapeHtml(m.subject)}${m.count>1?' ('+m.count+')':''}</div><div class="mailx-snippet">${escapeHtml(m.snippet)}</div><div class="mailx-message-foot">${chipsFor(m)}${m.classification.code?`<span class="mailx-code-mini ${Date.now()-m.timestamp>3600000?'is-old-code':''}">${escapeHtml(m.classification.code)}</span>`:''}</div></button></div>`).join(''):'<div class="mailx-empty-list">'+(state.accounts.length?'No matching messages in this page. Older matches may be available below.':'Connect a Gmail account in Settings to get started.')+'</div>';
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
        canStart:()=>true,
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
    const key=viewKey(),previous=state.messages.slice(),index=state.messages.findIndex(x=>threadKey(x)===threadKey(m)),wasSelected=state.selected===threadKey(m);
    const next=state.messages[index+1]||state.messages[index-1]||null;
    state.readVersion++;state.loadVersion++;state.messages=state.messages.filter(x=>threadKey(x)!==threadKey(m));clearMailCache();renderList();
    if(wasSelected){state.selected=null;state.thread=null;if(next&&matchMedia('(min-width:861px)').matches)selectMessage(next).catch(e=>showToast(e.message));else{shell.classList.remove('is-reading','is-reader-focused');blankReader();}}
    try{
      await api('modify',{accountId:m.accountId,threadId:m.threadId,action:'archive'});clearMailCache();
      showToast('Archived',{label:'Undo',onClick:async()=>{
        if(key===viewKey()){state.messages=previous;renderList();}
        await api('modify',{accountId:m.accountId,threadId:m.threadId,action:'unarchive'});clearMailCache();showToast('Archive undone');loadMail(false,true);
      }});
      loadMail(false,true);
    }catch(e){if(key===viewKey()){state.messages=previous;renderList();}showToast('Change failed: '+e.message);}
  }
  async function loadMail(more=false,force=false){
    ownCache();if(['drafts','outbox'].includes(state.filter))return loadSpecial();
    const version=++state.loadVersion,key=viewKey(),cached=pageCache.get(key);
    if(!more&&cached){messagesKey=key;Object.assign(state,cached.value);renderList();if(!force&&Date.now()-cached.at<30000){notice('');prefetchReaders();return;}}
    else if(!more){state.messages=state.query&&messagesKey!==key?[]:state.messages.filter(m=>(state.account==='all'||m.accountId===state.account)&&matchesView(m,state.filter));messagesKey=key;state.hasMore=false;renderList();}
    notice('Updating mailbox…');$('#mailxRefresh').disabled=true;
    try{
      const data=await api('mail',null,{accountId:state.account,filter:state.filter,q:state.query,cursor:JSON.stringify(more?state.cursor:{})});
      if(version!==state.loadVersion)return;
      const failed=new Map((data.errors||[]).map(e=>[e.accountId,e.threadIds]));
      const retained=state.messages.filter(m=>failed.has(m.accountId)&&(!failed.get(m.accountId)||failed.get(m.accountId).includes(m.threadId)));
      const rows=more?[...state.messages,...data.messages]:[...retained,...data.messages];
      state.messages=[...new Map(rows.map(m=>[threadKey(m),m])).values()].sort((a,b)=>b.timestamp-a.timestamp);
      state.cursor=data.cursor;state.hasMore=data.hasMore;if(!data.errors?.length)putCache(pageCache,key,{messages:state.messages,cursor:state.cursor,hasMore:state.hasMore});renderList();prefetchReaders();
      notice(data.errors?.map(e=>accountName(e.accountId)+': '+e.error+' Previously loaded mail is kept; refresh to retry.').join(' · ')||'');
    }catch(e){if(version===state.loadVersion)notice(e.message);}
    finally{if(version===state.loadVersion)$('#mailxRefresh').disabled=false;}
  }
  function matchesView(m,filter){const l=m.labels,c=m.classification;if(['all','archived','sent','blocked','codes','low'].includes(filter))return filter==='all'||filter==='archived'&&!l.includes('INBOX')&&!l.includes('DRAFT')||filter==='sent'&&l.includes('SENT')||filter==='blocked'&&c.blocked||filter==='codes'&&c.type==='Login Code'||filter==='low'&&['Low','Muted'].includes(c.priority);if(c.blocked)return false;return l.includes('INBOX')&&(filter==='important'?c.priority==='High':filter==='reply'?c.action==='Needs reply':c.priority!=='Muted');}
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
      if(m.labels.includes('UNREAD')){
        m.labels=m.labels.filter(x=>x!=='UNREAD');renderList();
        api('modify',{accountId:m.accountId,threadId:m.threadId,action:'read'}).catch(()=>{if(!m.labels.includes('UNREAD'))m.labels.push('UNREAD');if(version===state.readVersion)renderList();});
      }
    }catch(e){if(version===state.readVersion){if(cached)showToast('Showing the saved view: '+e.message);else readerEl.insertAdjacentHTML('beforeend',`<p class="mailx-inline-error">${escapeHtml(e.message)}</p>`);}}
  }
  function currentMessage(){return state.thread?.messages.at(-1);}
  function renderReader(){
    const t=state.thread;if(!t)return blankReader();const m=currentMessage(),account=state.accounts.find(a=>a.id===t.accountId),incoming=[...t.messages].reverse().find(x=>address(x.email)!==address(account?.email))||m;
    const c=incoming.classification,unsub=incoming.unsubscribe,archived=!t.messages.some(x=>x.labels.includes('INBOX'));
    const focused=shell.classList.contains('is-reader-focused');
    readerEl.innerHTML=`<div class="mailx-reader-toolbar"><button class="mailx-action mailx-reader-back" data-action="back" aria-label="Back to mail list">←</button><button class="mailx-action" data-action="archive">${archived?'Unarchive':'Archive'}</button><button class="mailx-action" data-action="mute">Mute</button><button class="mailx-action danger" data-action="block">Block</button>${unsub.web||unsub.mailto?'<button class="mailx-action good" data-action="unsubscribe">Unsubscribe</button>':''}<button class="mailx-action" data-action="unread">Unread</button><span class="mailx-toolbar-spacer"></span><button class="mailx-action mailx-focus-action" data-action="focus" aria-pressed="${focused?'true':'false'}">${focused?'Exit focus':'Focus'}</button></div><div class="mailx-reader-scroll"><div class="mailx-reader-head"><div class="mailx-reader-title-row"><h2 class="mailx-reader-subject">${escapeHtml(m.subject)}</h2><div class="mailx-reader-head-actions"><button class="mailx-action" data-action="classify">Rule</button><button class="mailx-action" data-action="sender">Sender</button></div></div><div class="mailx-reader-tags"><span class="mailx-account">${escapeHtml(accountName(t.accountId))}</span><span class="mailx-chip">${escapeHtml(c.type)}</span><span class="mailx-chip">${escapeHtml(c.context||'No context')}</span>${chipsFor(incoming)}</div></div>${t.messages.map((msg,i)=>`<article class="mailx-thread-message"><details ${i===t.messages.length-1?'open':''}><summary><span><strong>${escapeHtml(msg.sender)}</strong> · ${escapeHtml(time(msg.timestamp))}</span></summary><details class="mailx-message-meta"><summary>Message details</summary><div class="mailx-sender-row"><div class="mailx-sender-details"><div class="mailx-sender-email">From: ${escapeHtml(msg.from)}</div><div class="mailx-recipient-line">To: ${escapeHtml(msg.to)}${msg.cc?' · Cc: '+escapeHtml(msg.cc):''}</div><div class="mailx-recipient-line">${escapeHtml(accountName(t.accountId))}</div></div></div></details>${msg.classification.code?`<div class="mailx-login-card ${Date.now()-msg.timestamp>3600000?'is-old-code':''}"><div class="mailx-login-label">${Date.now()-msg.timestamp>3600000?'OLDER CODE · MAY HAVE EXPIRED':'VERIFICATION CODE'}</div><div class="mailx-login-code">${escapeHtml(msg.classification.code)}</div><button class="mailx-copy-code" data-copy="${i}">Copy code</button></div>`:''}${msg.html?`<iframe class="mailx-html-body" data-body="${i}" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Email body from ${escapeHtml(msg.sender)}"></iframe><details class="mailx-text-alternative"><summary>Plain text / accessible view</summary><div class="mailx-mail-body">${escapeHtml(msg.text)}</div></details>`:`<div class="mailx-mail-body">${escapeHtml(msg.text||'(No text body)')}</div>`}${msg.attachments.length?`<div class="mailx-attachments">${msg.attachments.map((a,j)=>`<button class="mailx-action" data-attachment="${i}:${j}">↓ ${escapeHtml(a.filename)} · ${Math.ceil(a.size/1024)} KB</button>`).join('')}</div>`:''}</details></article>`).join('')}</div><div class="mailx-reply-bar"><button class="mailx-reply-button" data-action="reply">Reply</button></div>`;
    $$('[data-body]').forEach(frame=>{frame.srcdoc=t.messages[Number(frame.dataset.body)].html;});
    $$('[data-copy]').forEach(b=>b.onclick=guarded(async()=>{await navigator.clipboard.writeText(t.messages[+b.dataset.copy].classification.code);showToast('Code copied');}));
    $$('[data-attachment]').forEach(b=>b.onclick=guarded(async()=>{b.disabled=true;try{const [i,j]=b.dataset.attachment.split(':').map(Number),msg=t.messages[i],a=msg.attachments[j];const data=await api('attachment',null,{accountId:t.accountId,messageId:msg.id,attachmentId:a.id,partId:a.partId});const bytes=Uint8Array.from(atob(data.data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download=data.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}finally{b.disabled=false;}}));
    $$('[data-action]').forEach(b=>b.onclick=guarded(async()=>{
      const action=b.dataset.action;
      if(action==='back'){shell.classList.remove('is-reading','is-reader-focused');return;}
      if(action==='focus'){const active=shell.classList.toggle('is-reader-focused');b.textContent=active?'Exit focus':'Focus';b.setAttribute('aria-pressed',String(active));return;}
      if(action==='reply')return openComposer({...incoming,accountId:t.accountId,threadId:t.threadId});
      if(action==='classify'||action==='mute'||action==='block')return ruleEditor(incoming,t.accountId,action);
      if(action==='sender')return senderDetails(incoming,t.accountId);
      if(action==='unsubscribe')return unsubscribe(incoming,t.accountId);
      if(action==='archive'&&!archived){const listMessage=state.messages.find(x=>threadKey(x)===threadKey(t))||{...m,accountId:t.accountId,threadId:t.threadId,labels:['INBOX']};return archiveFromList(listMessage);}
      b.disabled=true;const key=viewKey(),previous=state.messages.slice();state.readVersion++;state.loadVersion++;clearMailCache();
      state.messages=state.messages.filter(m=>threadKey(m)!==threadKey(t));renderList();shell.classList.remove('is-reading','is-reader-focused');showToast(action==='unread'?'Marking unread…':archived?'Returning to inbox…':'Archiving…');
      try{await api('modify',{accountId:t.accountId,threadId:t.threadId,action:action==='archive'?(archived?'unarchive':'archive'):action});clearMailCache();showToast(action==='unread'?'Marked unread':archived?'Returned to inbox':'Archived in Gmail');loadMail(false,true);}
      catch(e){if(key===viewKey()){state.messages=previous;renderList();}showToast('Change failed: '+e.message);}finally{b.disabled=false;}
    }));
  }
  function address(v=''){return (v.match(/<([^<>]+)>/)?.[1]||v).trim().toLowerCase();}
  function ce(){return{pane:$('#mailxCompose'),title:$('#mailxComposeTitle'),context:$('#mailxComposeContext'),from:$('#mailxFrom'),to:$('#mailxTo'),subject:$('#mailxSubject'),prompt:$('#mailxAiPrompt'),body:$('#mailxBody'),generate:$('#mailxGenerate')};}
  function draftSnapshot(){const c=ce();return{id:state.draftId,accountId:c.from.value,to:c.to.value,subject:c.subject.value,body:c.body.value,threadId:state.replyContext?.threadId||null,replyMessageId:state.replyContext?.id||null};}
  function keepDraft(){if(!state.draftId)return;writeStore(DRAFT,{...draftSnapshot(),requestId:state.requestId,requestPayload:state.requestPayload});}
  async function openComposer(m=null,existing=null){
    if(!state.accounts.length){showToast('Connect a Gmail account first.');return settings();}
    if(state.busySend){showToast('Wait for the send to finish.');return;}
    if(ce().pane.classList.contains('is-open')&&(ce().body.value||ce().to.value)&&!confirm('Save this draft and open another message?'))return;
    if(ce().pane.classList.contains('is-open')&&ce().body.value)await saveDraft();
    const c=ce();state.composeVersion++;state.editVersion++;state.busyAi=false;state.replyContext=m;state.history=[];state.redo=[];state.requestId=existing?.requestId||null;state.requestPayload=existing?.requestPayload||null;state.draftId=existing?.id||crypto.randomUUID();
    const selected=m?.accountId||existing?.accountId||(state.account!=='all'?state.account:state.accounts[0].id);
    c.from.innerHTML=state.accounts.map(a=>option(a.id,a.display_name+' · '+a.email,selected)).join('');c.from.disabled=!!(m||existing?.threadId);
    c.to.value=existing?.to||(m?(address(m.email)===address(state.accounts.find(a=>a.id===selected)?.email)?m.to:address(m.replyTo)): '');
    c.subject.value=existing?.subject||(m?(/^re:/i.test(m.subject)?m.subject:'Re: '+m.subject):'');c.subject.readOnly=!!(m||existing?.threadId);
    if(existing?.threadId)state.replyContext={threadId:existing.threadId,id:existing.replyMessageId};
    c.body.value=existing?.body||'';c.prompt.value='';c.generate.disabled=false;c.generate.textContent='Generate';
    c.title.textContent=state.replyContext?'Reply':'New message';c.context.textContent=state.replyContext?'Replying in the original Gmail thread':'AI revises the current editable draft below';
    $('#mailxComposeError').textContent='';$('#mailxDraftState').textContent='Saved on this tab as you type';
    c.pane.classList.add('is-open');requestAnimationFrame(()=>{placeFloating(c.pane,'compose');focusFloating(c.pane);});keepDraft();setTimeout(()=>c.body.focus(),30);
  }
  async function closeComposer(){if(state.busySend)return showToast('Wait for the send to finish.');keepDraft();clearTimeout(draftTimer);if(ce().body.value)saveDraft().catch(()=>showToast('Draft is kept on this tab; reconnect to save it securely.'));state.composeVersion++;ce().pane.classList.remove('is-open');}
  async function saveDraft(snapshot=draftSnapshot()){
    if(!snapshot.id||!snapshot.accountId)return;keepDraft();
    const save=draftSaveChain.catch(()=>{}).then(()=>api('drafts',snapshot));draftSaveChain=save;
    await save;if(snapshot.id===state.draftId&&snapshot.body===ce().body.value)$('#mailxDraftState').textContent='Draft saved securely';
  }
  function scheduleDraftSave(){clearTimeout(draftTimer);$('#mailxDraftState').textContent='Saving draft…';draftTimer=setTimeout(()=>{if(!state.busySend)saveDraft().catch(()=>{$('#mailxDraftState').textContent='Offline · draft kept on this tab';});},1200);}
  async function runAi(){
    const c=ce(),instruction=c.prompt.value.trim();if(state.busyAi||state.busySend)return;
    if(!instruction){c.prompt.focus();return showToast('Tell Gemini what to write or change.');}
    const snapshot=draftSnapshot(),version=state.composeVersion,edited=state.editVersion;state.busyAi=true;c.generate.disabled=true;c.generate.textContent='Revising…';$('#mailxComposeError').textContent='';
    try{
      const result=await api('ai',{...snapshot,instruction});
      if(version!==state.composeVersion)return;
      if(edited!==state.editVersion||JSON.stringify(snapshot)!==JSON.stringify(draftSnapshot())){showToast('You edited this draft during generation. Your edits are kept; run AI again to include them.');return;}
      state.history.push(c.body.value);state.redo=[];c.body.value=result.body;state.editVersion++;c.prompt.value='';keepDraft();scheduleDraftSave();c.body.focus();
    }catch(e){if(version===state.composeVersion)$('#mailxComposeError').textContent=e.message;}
    finally{if(version===state.composeVersion){state.busyAi=false;c.generate.disabled=false;c.generate.textContent='Generate';}}
  }
  function undoAi(){if(state.busySend||!state.history.length)return;state.redo.push(ce().body.value);ce().body.value=state.history.pop();state.editVersion++;keepDraft();scheduleDraftSave();}
  function redoAi(){if(state.busySend||!state.redo.length)return;state.history.push(ce().body.value);ce().body.value=state.redo.pop();state.editVersion++;keepDraft();scheduleDraftSave();}
  async function send(sendAt=null){
    if(state.busySend)return;clearTimeout(draftTimer);const c=ce();if(!c.to.reportValidity()||!c.to.value.trim()||!c.body.value.trim()){showToast('Add a recipient and email body.');return;}
    const payload={...draftSnapshot(),sendAt};delete payload.id;
    if(state.requestId&&JSON.stringify(payload)!==JSON.stringify(state.requestPayload)){showToast('A previous send is unresolved. Check Outbox before sending changed text.');return;}
    state.requestId ||=crypto.randomUUID();state.requestPayload=payload;keepDraft();state.busySend=true;state.composeVersion++;
    const editing=[c.from,c.to,c.subject,c.body,c.prompt];const previous=editing.map(el=>el.disabled);editing.forEach(el=>el.disabled=true);
    $('#mailxSend').disabled=true;$('#mailxSchedule').disabled=true;$('#mailxSaveDraft').disabled=true;$('#mailxComposeError').textContent='';
    try{
      await draftSaveChain.catch(()=>{});
      const {job}=await api('send',{...payload,id:state.requestId});
      if(job.status==='failed')throw new Error(job.error+' Open Outbox to restore it.');
      if(job.status==='uncertain')throw new Error('Delivery is uncertain. Check Outbox; do not send a duplicate.');
      showToast(job.status==='sent'?'Sent through Gmail':sendAt?'Scheduled on the server':'Send queued on the server. Check Outbox for its status.');
      api('drafts/delete',{id:state.draftId}).catch(()=>{});try{sessionStorage.removeItem(DRAFT);}catch{}
      c.pane.classList.remove('is-open');state.requestId=null;state.requestPayload=null;state.draftId=null;state.replyContext=null;clearMailCache();loadMail(false,true);
    }catch(e){$('#mailxComposeError').textContent=e.message;keepDraft();}
    finally{state.busySend=false;editing.forEach((el,i)=>el.disabled=previous[i]);$('#mailxSend').disabled=false;$('#mailxSchedule').disabled=false;$('#mailxSaveDraft').disabled=false;state.busyAi=false;c.generate.disabled=false;c.generate.textContent='Generate';}
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
      listEl.innerHTML=rows.map((r,i)=>`<div class="mailx-message"><strong>${escapeHtml(r.subject||'(no subject)')}</strong><div class="mailx-snippet">${escapeHtml(accountName(r.account_id))}${r.to_address?' · '+escapeHtml(r.to_address):''}</div><p>${isDraft?escapeHtml(time(r.updated_at)):escapeHtml(r.status+' · '+time(r.send_at))}</p>${r.error?`<p class="mailx-inline-error">${escapeHtml(r.error)}</p>`:''}${isDraft?`<button class="mailx-action" data-draft="${i}">Open draft</button> <button class="mailx-action" data-delete-draft="${i}">Delete draft</button>`:`${['pending','processing'].includes(r.status)?`<button class="mailx-action" data-cancel="${i}">Cancel send</button>`:''}${['sending','uncertain'].includes(r.status)?`<button class="mailx-action" data-check="${i}">Check Gmail delivery</button>`:''}${['cancelled','failed'].includes(r.status)?`<button class="mailx-action" data-restore="${i}">Restore draft</button>`:''}`}</div>`).join('')||'<div class="mailx-empty-list">Nothing here yet.</div>';
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
      const data=await api('bootstrap');state.accounts=data.accounts;
      let local={};try{local=JSON.parse(localStorage.getItem(PREF)||'{}');}catch{}
      const pref={...data.preferences,...local};state.filter=views[pref.filter]?pref.filter:'inbox';state.account=state.accounts.some(a=>a.id===pref.account)?pref.account:'all';
      state.messages=(data.messages||[]).filter(m=>(state.account==='all'||m.accountId===state.account)&&matchesView(m,state.filter));state.hasMore=false;initialized=true;
      $('#mailxConnection').textContent=state.accounts.length?'Gmail':'Setup';renderList();prefetchReaders();
      api('status').then(value=>{status=value;$('#mailxConnection').textContent=status.configured?'Gmail':'Setup needed';}).catch(()=>{});
      if(readStore(OAUTH,null))await finishConnection();else loadMail(false,true);
      const draft=readStore(DRAFT,null);if(draft&&!ce().pane.classList.contains('is-open')&&state.accounts.some(a=>a.id===draft.accountId)){notice('An unsent draft is saved on this tab.');$('#mailxNotice').insertAdjacentHTML('beforeend',' <button class="mailx-action" id="mailxResume">Resume draft</button>');$('#mailxResume').onclick=guarded(()=>openComposer(null,draft));}
      const params=new URLSearchParams(location.search);if(params.has('connect_error'))showToast('Google connection was not completed. Try connecting again.');
      if(params.has('connected')&&!readStore(OAUTH,null)&&!state.accounts.length)notice('Return to the browser or PWA where you started connecting to complete account pairing.');
      if(params.has('connected')||params.has('connect_error')){params.delete('connected');params.delete('connect_error');history.replaceState({},'',location.pathname+'?'+params.toString());}
    }catch(e){notice(e.message);}
  }
  function mount(){
    const launch=document.querySelector('#mailDashboardButton');if(!launch)return;launch.addEventListener('click',e=>{e.preventDefault();openDialog();});launch.setAttribute('aria-label','Open Mail');launch.title='Open Mail';
    dialog=document.createElement('dialog');dialog.id='mailDemoDialog';dialog.className='mailx-dialog';
    dialog.innerHTML='<div class="mailx-shell" id="mailxShell"><header class="mailx-topbar"><div class="mailx-brand"><span class="mailx-brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m5 8 7 5 7-5"/></svg></span><span class="mailx-title">Mail</span><span class="mailx-demo-badge" id="mailxConnection">Mail</span></div><div class="mailx-top-spacer"></div><button class="mailx-top-action" type="button" id="mailxSettings" aria-label="Mail settings">⚙</button><button class="mailx-icon-button" type="button" id="mailxClose" aria-label="Close mail">×</button></header><div class="mailx-mobile-tabs">'+['inbox','important','reply','codes','low','all'].map(k=>'<button class="mailx-mobile-tab" data-mailx-mobile-filter="'+k+'">'+categoryLabel(k)+'</button>').join('')+'</div><div class="mailx-main"><nav class="mailx-nav" aria-label="Mail views"><button class="mailx-compose-main" type="button" id="mailxComposeMain">＋ Compose</button><div class="mailx-nav-label">MAIL</div>'+[['inbox','important','reply'],['codes','low'],['all','blocked','archived'],['sent','drafts','outbox']].map(group=>'<div class="mailx-nav-group">'+group.map(k=>'<button class="mailx-filter" type="button" data-mailx-filter="'+k+'"><span>'+categoryLabel(k)+'</span></button>').join('')+'</div>').join('')+'<div class="mailx-nav-label">ACCOUNT</div><select class="mailx-account-select" data-mailx-account-filter aria-label="Connected account"><option value="all">All connected</option></select><p class="mailx-nav-note">Local blocks stay available in Blocked and All mail.</p></nav><div class="mailx-resizer" data-mailx-resizer="nav" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize mail navigation"></div><section class="mailx-list-pane"><div class="mailx-list-tools"><div class="mailx-list-controls"><input aria-label="Search mail" id="mailxSearch" class="mailx-search" type="search" placeholder="Search mail…" autocomplete="off"><select class="mailx-account-select mailx-account-select-list" data-mailx-account-filter aria-label="Connected account"><option value="all">All connected</option></select></div><div class="mailx-list-meta" id="mailxListMeta"></div><div class="mailx-list-extra"><select id="mailxView" aria-label="Mail view"></select><button class="mailx-action" id="mailxRefresh">↻ Refresh</button></div><div id="mailxNotice" role="status"></div></div><div class="mailx-list" id="mailxList"></div></section><div class="mailx-resizer" data-mailx-resizer="list" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize message list"></div><section class="mailx-reader" id="mailxReader"></section></div></div><section aria-label="Email composer" class="mailx-compose" id="mailxCompose"><div class="mailx-compose-head"><div><div class="mailx-compose-title" id="mailxComposeTitle">New message</div><div class="mailx-compose-context" id="mailxComposeContext"></div></div><button class="mailx-icon-button mailx-compose-close" id="mailxComposeClose" type="button" aria-label="Close composer">×</button></div><div class="mailx-compose-fields"><div class="mailx-field-row"><label for="mailxFrom">From</label><select id="mailxFrom" aria-label="Sending account"></select></div><div class="mailx-field-row"><label for="mailxTo">To</label><input id="mailxTo" type="email" multiple placeholder="name@example.com"></div><div class="mailx-field-row"><label for="mailxSubject">Subject</label><input id="mailxSubject" type="text" placeholder="Subject"></div></div><div class="mailx-ai-wrap"><div class="mailx-ai-label"><span>AI COMMAND</span><span>Gemini · edits the body below</span></div><div class="mailx-ai-row"><textarea aria-label="AI instruction" id="mailxAiPrompt" class="mailx-ai-prompt" placeholder="Tell AI what to write or change. It always uses the current email draft below as reference."></textarea><button id="mailxGenerate" class="mailx-ai-generate" type="button">Generate</button></div><div class="mailx-ai-chips"><button class="mailx-ai-chip" type="button" data-mailx-ai-chip="make it shorter">Shorter</button><button class="mailx-ai-chip" type="button" data-mailx-ai-chip="make it warmer and friendlier">Warmer</button><button class="mailx-ai-chip" type="button" data-mailx-ai-chip="make it more formal">More formal</button><button class="mailx-ai-chip" type="button" data-mailx-ai-chip="fix the grammar without changing my meaning">Fix grammar</button></div></div><div class="mailx-editor-label"><span>EMAIL</span><span class="mailx-editor-tools"><button id="mailxUndo" type="button">Undo AI</button><button id="mailxRedo" type="button">Redo</button></span></div><textarea aria-label="Editable email body" id="mailxBody" class="mailx-email-body" placeholder="Write manually here, or use the AI command above…"></textarea><div id="mailxComposeError" class="mailx-inline-error" role="alert"></div><div class="mailx-compose-foot"><span class="mailx-compose-note"><span id="mailxDraftState">Your editable draft</span></span><button class="mailx-action" id="mailxSaveDraft" type="button">Save draft</button><button class="mailx-schedule" id="mailxSchedule" type="button">Schedule</button><button class="mailx-send" id="mailxSend" type="button">Send</button></div></section><div class="mailx-toast" id="mailxToast" role="status"></div>';
    document.body.appendChild(dialog);shell=$('#mailxShell');listEl=$('#mailxList');readerEl=$('#mailxReader');searchEl=$('#mailxSearch');accountEls=$$('[data-mailx-account-filter]');initMailWorkspaceInteractions();
    $('#mailxClose').onclick=()=>{keepDraft();dialog.close();};$('#mailxSettings').onclick=guarded(settings);
    $('#mailxComposeMain').onclick=guarded(()=>openComposer());$('#mailxComposeClose').onclick=closeComposer;
    $('#mailxGenerate').onclick=runAi;$('#mailxUndo').onclick=undoAi;$('#mailxRedo').onclick=redoAi;$('#mailxSchedule').onclick=scheduleSend;$('#mailxSend').onclick=()=>send();$('#mailxSaveDraft').onclick=guarded(()=>saveDraft());
    $('#mailxRefresh').onclick=guarded(async()=>{clearMailCache();await Promise.all([refreshAccounts(),loadMail(false,true)]);});$('#mailxView').onchange=e=>setFilter(e.target.value);
    $$('[data-mailx-filter]').forEach(b=>b.onclick=()=>setFilter(b.dataset.mailxFilter));$$('[data-mailx-mobile-filter]').forEach(b=>b.onclick=()=>setFilter(b.dataset.mailxMobileFilter));
    $$('[data-mailx-ai-chip]').forEach(b=>b.onclick=()=>{ce().prompt.value=b.dataset.mailxAiChip;runAi();});
    searchEl.oninput=()=>{state.query=searchEl.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadMail(),350);};
    accountEls.forEach(el=>el.onchange=()=>{state.account=el.value;state.readVersion++;shell.classList.remove('is-reading','is-reader-focused');remember();loadMail();});
    [ce().from,ce().to,ce().subject,ce().body].forEach(el=>el.addEventListener('input',()=>{state.editVersion++;state.redo=[];keepDraft();scheduleDraftSave();}));
    dialog.addEventListener('cancel',e=>{if($('#mailxSheet')){e.preventDefault();$('#mailxSheet').remove();}else if(ce().pane.classList.contains('is-open')){e.preventDefault();closeComposer();}else keepDraft();});
    window.addEventListener('pagehide',keepDraft);window.addEventListener('focus',()=>{if(dialog.open)guarded(finishConnection)();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&dialog.open&&!ce().pane.classList.contains('is-open'))guarded(()=>loadMail())();});
    blankReader();renderFilters();const open=new URLSearchParams(location.search).get('open');if(open==='mail'||open==='mail-demo')setTimeout(openDialog,80);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
