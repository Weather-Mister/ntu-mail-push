const CACHE_NAME = 'ntu-schedule-v91';
const NTU_MAIL_URL = 'https://wmail1.cc.ntu.edu.tw/rc/index.php';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=110',
  '/vendor/ffmpeg/ffmpeg.js?v=1',
  '/vendor/ffmpeg/814.ffmpeg.js',
  '/app.js?v=106',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/hub-statics.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/transfer/') || url.pathname.startsWith('/api/todos/') || url.pathname === '/api/hanzi-widget') {
    event.respondWith(fetch(request, { cache:'no-store' }));
    return;
  }

  if (url.pathname === '/api/cool-calendar') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache:'no-store' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then(cached => cached || caches.match('/')))
    );
    return;
  }

  const freshShell = new Set(['/styles.css','/app.js','/manifest.webmanifest']);
  if (freshShell.has(url.pathname)) {
    event.respondWith(
      fetch(request, { cache:'no-store' })
        .then(response => {
          if (response.ok) {
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
          if (response.ok) {
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
  const title = 'NTU Mail';
  event.waitUntil(self.registration.showNotification(title, {
    body:data.body || 'You have a new NTU Mail message.',
    icon:'/api/icon-180',
    badge:'/api/icon-180',
    tag:data.tag || 'ntu-mail',
    renotify:true,
    data:{ url:NTU_MAIL_URL }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedTarget = event.notification.data?.url || '/';
  const target = requestedTarget === '/?open=ntu-mail' ? NTU_MAIL_URL : requestedTarget;
  const targetUrl = new URL(target, self.location.origin);

  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      if (targetUrl.origin !== self.location.origin){
        return clients.openWindow(targetUrl.href);
      }

      const existing = list.find(client => {
        try { return new URL(client.url).origin === targetUrl.origin; } catch (error) { return false; }
      });
      if (existing){
        existing.navigate(targetUrl.href);
        return existing.focus();
      }
      return clients.openWindow(targetUrl.href);
    })
  );
});