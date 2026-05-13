// Sequoia Service Worker
const CACHE = 'sequoia-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.svg', '/icon-512.svg'];

// ── Install: cache app shell ──────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
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

// ── Fetch: cache-first for shell, network-first for API ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always hit network for Canvas API calls
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
      });
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
      icon:    '/icon-192.svg',
      badge:   '/icon-192.svg',
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
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
