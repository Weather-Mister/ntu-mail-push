const CACHE_NAME = 'begum-schedule-github-v13';
const NTU_MAIL_URL = 'https://wmail1.cc.ntu.edu.tw/rc/index.php';
const ROOT = new URL(self.registration.scope).pathname;
const asset = path => ROOT + (path.startsWith('/') ? path.slice(1) : path);
const ICON_URL = new URL('apple-touch-icon.png', self.registration.scope).href;
const APP_SHELL = [
  ROOT,
  asset('index.html'),
  asset('styles.css?v=110'),
  asset('garden-theme.css?v=6'),
  asset('app.js?v=118'),
  asset('todo-realtime.js?v=1'),
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

  const freshShell = new Set([asset('styles.css'), asset('garden-theme.css'), asset('app.js'), asset('manifest.webmanifest')]);
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
    data:{ url:NTU_MAIL_URL }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || self.registration.scope, self.registration.scope);
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      if (targetUrl.origin !== self.location.origin) return clients.openWindow(targetUrl.href);
      const existing = list.find(client => {
        try { return new URL(client.url).pathname.startsWith(ROOT); } catch (error) { return false; }
      });
      if (existing){ existing.navigate(targetUrl.href); return existing.focus(); }
      return clients.openWindow(targetUrl.href);
    })
  );
});
