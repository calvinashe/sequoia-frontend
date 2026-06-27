// Sequoia Service Worker
const CACHE = 'sequoia-v101';
const BASE  = '';
// App shell only — kept tiny so first load is fast. Audio (ambience + lo-fi,
// ~73MB total) is cached on first play via runtime caching below, NOT here.
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable.png',
];

// ── Install: cache app shell (fail-safe) ─────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(SHELL.map(url => c.add(url)))
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: clear old caches ────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API, cache-first for shell ──
self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith('http')) return;

  const url = new URL(e.request.url);

  // Always network for Canvas, backend API, Firebase, Stripe
  const isAPI = url.hostname.includes('instructure.com')
    || url.hostname.includes('onrender.com')
    || url.hostname.includes('firebaseapp.com')
    || url.hostname.includes('googleapis.com')
    || url.hostname.includes('gstatic.com')   // Firebase SDK scripts — always fetch fresh
    || url.hostname.includes('stripe.com')
    || url.hostname.includes('posthog.com');

  if (isAPI) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // ── Audio (ambience + lo-fi): cache on first play, then offline-ready ──
  // The <audio> element sends Range requests → 206 responses, which the Cache
  // API refuses to store. So on a miss we fetch the FULL file (no Range header)
  // to get a cacheable 200, store it, and return it. Returning a 200 to a Range
  // request is valid and plays fine.
  if (url.pathname.startsWith('/audio/') && url.pathname.endsWith('.mp3')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
        try {
          const res = await fetch(url.pathname);
          if (res && res.status === 200) cache.put(url.pathname, res.clone());
          return res;
        } catch (_) {
          return new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // Cache-first for app shell and static assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(BASE + '/index.html'));
    })
  );
});

// ── Push notifications ────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Sequoia 🌲', body: 'Time to study!' };
  try { data = e.data.json(); } catch (_) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    BASE + '/icon-192.png',
      badge:   BASE + '/icon-192.png',
      tag:     data.tag || 'sequoia',
      data:    data,
      actions: data.actions || [],
      vibrate: [100, 50, 100],
    })
  );
});

// ── Notification click: open app and navigate to deep link ───────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || BASE + '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          // Navigate to the target URL (honours ?tab= deep links) then focus
          if ('navigate' in client) {
            return client.navigate(target).then(c => c?.focus());
          }
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
