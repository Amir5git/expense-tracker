'use strict';

/**
 * Service worker.
 *
 * Strategy:
 *  - App shell (HTML/JS/CSS/manifest): network-first so updates apply
 *    immediately; falls back to the cache when offline.
 *  - Icons: cache-first (they never change without a version bump).
 *  - API calls: always live network.
 */

const CACHE = 'expense-tracker-v3';
const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/state.js',
  '/js/api.js',
  '/js/charts.js',
  '/js/modals.js',
  '/js/views.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/favicon-64.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live data

  const isIcon = url.pathname.startsWith('/icons/');

  event.respondWith(
    (async () => {
      // icons are versioned with the app: serve from cache when we have them
      if (isIcon) {
        const cached = await caches.match(req);
        if (cached) return cached;
      }
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
