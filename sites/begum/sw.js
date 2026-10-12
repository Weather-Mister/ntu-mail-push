const CACHE_NAME = 'begum-schedule-github-v27';
const NTU_MAIL_URL = 'https://wmail1.cc.ntu.edu.tw/rc/index.php';
const ROOT = new URL(self.registration.scope).pathname;
const asset = path => ROOT + (path.startsWith('/') ? path.slice(1) : path);
const ICON_URL = new URL('apple-touch-icon.png', self.registration.scope).href;
const APP_SHELL = [
  ROOT,
  asset('index.html'),
  asset('styles.css?v=110'),
  asset('garden-theme.css?v=12'),
  asset('app.js?v=118'),
  asset('todo-realtime.js?v=1'),
  asset('garden-bees.js?v=2'),
  asset('mail-demo.js?v=36'),
  asset('mail-demo.css?v=12'),
  asset('mail-modern.css?v=5'),
  asset('mail-garden.css?v=6'),
  asset('manifest.webmanifest?v=1'),
  asset('garden-favicon.svg'),
  asset('apple-touch-icon.png'),
  asset('icon-512.png')
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('begum-schedule-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(ROOT)) return;

  if (request.mode === 'navigate'){
    event.respondWith(
      fetch(request, { cache:'no-store' })
        .then(response => {
          if (response.ok){
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(asset('index.html'), copy));
          }
          return response;
        })
        .catch(() => caches.match(asset('index.html')).then(cached => cached || caches.match(ROOT)))
    );
    return;
  }

  const freshShell = new Set([asset('styles.css'), asset('garden-theme.css'), asset('app.js'), asset('garden-bees.js'), asset('mail-demo.js'), asset('mail-demo.css'), asset('mail-modern.css'), asset('mail-garden.css'), asset('manifest.webmanifest')]);
  if (freshShell.has(url.pathname)){
    event.respondWith(
      fetch(request, { cache:'no-store' })
        .then(response => {
          if (response.ok){
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok){
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) {}
  event.waitUntil(self.registration.showNotification('NTU Mail', {
    body:data.body || 'You have a new NTU Mail message.',
    icon:ICON_URL,
    badge:ICON_URL,
    tag:data.tag || 'begum-ntu-mail',
    renotify:true,
    data:{ url:self.registration.scope }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const appUrl = new URL(self.registration.scope);
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const existing=list.find(client=>{
      try { const url=new URL(client.url);return url.origin===appUrl.origin&&url.pathname.startsWith(ROOT); }
      catch { return false; }
    });
    return existing?existing.focus().catch(()=>clients.openWindow(appUrl.href)):clients.openWindow(appUrl.href);
  }));
});
