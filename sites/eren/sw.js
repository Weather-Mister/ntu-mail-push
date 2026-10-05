const CACHE_NAME = 'ntu-schedule-github-v14';
const NTU_MAIL_URL = 'https://wmail1.cc.ntu.edu.tw/rc/index.php';
const ROOT = new URL(self.registration.scope).pathname;
const asset = path => ROOT + (path.startsWith('/') ? path.slice(1) : path);
const ICON_URL = new URL('schedule-icon-180.png', self.registration.scope).href;

const APP_SHELL = [
  ROOT,
  asset('index.html'),
  asset('styles.css?v=112'),
  asset('mail-demo.css?v=7'),
  asset('vendor/ffmpeg/ffmpeg.js?v=1'),
  asset('vendor/ffmpeg/814.ffmpeg.js'),
  asset('app.js?v=107'),
  asset('mail-demo.js?v=11'),
  asset('manifest.webmanifest?v=2'),
  asset('favicon.svg'),
  asset('hub-statics.svg'),
  asset('schedule-icon-180.png'),
  asset('schedule-icon-512.png')
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
      .then(keys => Promise.all(keys.filter(key => key.startsWith('ntu-schedule-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(ROOT + 'begum/')) return;

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

  const freshShell = new Set([
    asset('styles.css'),
    asset('mail-demo.css'),
    asset('app.js'),
    asset('mail-demo.js'),
    asset('manifest.webmanifest')
  ]);

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
    tag:data.tag || 'ntu-mail',
    renotify:true,
    data:{ url:NTU_MAIL_URL }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedTarget = event.notification.data?.url || self.registration.scope;
  const target = requestedTarget === '/?open=ntu-mail' ? NTU_MAIL_URL : requestedTarget;
  const targetUrl = new URL(target, self.registration.scope);

  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      if (targetUrl.origin !== self.location.origin){
        return clients.openWindow(targetUrl.href);
      }

      const existing = list.find(client => {
        try { return new URL(client.url).origin === targetUrl.origin; }
        catch (error) { return false; }
      });

      if (existing){
        existing.navigate(targetUrl.href);
        return existing.focus();
      }

      return clients.openWindow(targetUrl.href);
    })
  );
});
