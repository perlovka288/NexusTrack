'use strict';
// NEXUS: service worker. Оболочка сайта работает без сети, данные берутся из сети, а при её отсутствии показывается последняя копия.
const V = 'nexus-shell-v72', SHELL = ['/', '/index.html', '/style.css', '/coverflow.css', '/catalog.css', '/sx.css', '/nexus-v4.css', '/nexus-compat.css', '/nexus-v5.css', '/nexus-v6.css', '/nexus-v6.js', '/nexus-v7.css', '/nexus-v7.js', '/nexus-fast.js', '/search.js', '/catalog-data.js', '/filters.js', '/rewind.js', '/coverflow.js', '/app.js', '/nexus-catalog.js', '/extra.js', '/profile.js', '/nexus-ui.js', '/nexus-more.js', '/nexus-features.js', '/switch-ui.js', '/sx.js', '/nexus-v4.js',
  '/manifest.webmanifest', '/img/logo.png', '/img/icon-192.png', '/img/icon-512.png'];
const READ_API = /^\/api\/(lib|meta|profile|folders|installed)$/;
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url); if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname === '/api/events' || u.pathname.startsWith('/proxy')) return;
  if (u.pathname.startsWith('/api/')) {            // читаем из сети; нет сети: последняя сохранённая копия библиотеки и профиля
    if (!READ_API.test(u.pathname)) return;
    e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(ch => ch.put(r, c)); } return res; }).catch(() => caches.match(r).then(m => m || new Response('{}', {status: 503, headers: {'content-type': 'application/json'}}))));
    return;
  }
  e.respondWith(caches.match(r).then(m => { const net = fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(ch => ch.put(r, c)); } return res; }).catch(() => m); return m || net; }));
});
