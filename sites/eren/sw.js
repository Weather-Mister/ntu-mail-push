const CACHE_NAME = 'ntu-schedule-github-v77';
const ROOT = new URL(self.registration.scope).pathname;
const asset = path => ROOT + (path.startsWith('/') ? path.slice(1) : path);
const ICON_URL = new URL('schedule-icon-180.png', self.registration.scope).href;

const APP_SHELL = [
  ROOT,
  asset('index.html'),
  asset('styles.css?v=113'),
  asset('mail-demo.css?v=12'),
  asset('mail-modern.css?v=5'),
  asset('vendor/ffmpeg/ffmpeg.js?v=1'),
  asset('vendor/ffmpeg/814.ffmpeg.js'),
  asset('app.js?v=111'),
  asset('todo-realtime.js?v=1'),
  asset('mail-demo.js?v=35'),
  asset('skeuo-translation.css?v=7'),
  asset('skeuo-compose-fix.css?v=1'),
  asset('skeuo-demo.html'),
  asset('scope-audio-bridge.js?v=2'),
  asset('skeuo-runtime.js?v=29'),
  asset('slider-knob.css?v=4'),
  asset('skeuo-scrollbars.css?v=16'),
  asset('skeuo-scrollbars.js?v=14'),
  asset('skeuo-fader-cap.svg?v=4'),
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
    const canonical = url.pathname.endsWith('/skeuo-demo.html') ? asset('skeuo-demo.html') : asset('index.html');
    const network = fetch(request, { cache:'no-store' }).then(async response => {
      if (response.ok){
        const cache = await caches.open(CACHE_NAME);
        await cache.put(canonical, response.clone());
      }
      return response;
    });
    event.respondWith(
      network.catch(() =>
        caches.match(canonical)
          .then(cached => cached || caches.match(asset('index.html')))
          .then(fallback => fallback || caches.match(ROOT))
      )
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
    data:{ url:self.registration.scope }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Always enter this PWA, including notifications queued by the old worker.
  const appUrl = new URL(self.registration.scope);

  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      const existing = list.find(client => {
        try {
          const url = new URL(client.url);
          return url.origin === appUrl.origin && url.pathname.startsWith(ROOT) &&
            url.pathname !== ROOT + 'begum' && !url.pathname.startsWith(ROOT + 'begum/');
        }
        catch (error) { return false; }
      });

      if (existing){
        return existing.focus().catch(() => clients.openWindow(appUrl.href));
      }

      return clients.openWindow(appUrl.href);
    })
  );
});
