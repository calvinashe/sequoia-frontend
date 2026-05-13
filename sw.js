// Sequoia Service Worker
const CACHE = 'sequoia-v4';
const BASE  = '/sequoia-frontend';
const SHELL = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/icon-192.svg',
  BASE + '/icon-512.svg',
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

// ── Fetch: skip non-http requests, cache-first for shell ─
self.addEventListener('fetch', e => {
  // Skip non-http(s) requests (chrome-extension, etc.)
  if (!e.request.url.startsWith('http')) return;

  const url = new URL(e.request.url);

  // Always hit network for API calls
  if (url.hostname.includes('instructure.com') || url.pathname.startsWith('/api')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request));
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
      icon:    BASE + '/icon-192.svg',
      badge:   BASE + '/icon-192.svg',
      tag:     data.tag || 'sequoia',
      data:    data,
      actions: data.actions || [],
      vibrate: [100, 50, 100],
    })
  );
});

// ── Notification click: open app ─────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || BASE + '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) return client.focus();
      }
      return clients.openWindow(target);
    })
  );
});
