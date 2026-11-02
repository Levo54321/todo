// Minimal service worker for luc-todo. It exists only so desktop Chrome/Edge offer "Install app".
// It deliberately caches NOTHING and never answers a request itself: every page, script and /api call
// goes straight to the network exactly as before, so an installed copy can never show stale tasks or code.
// Do not add caching here without asking Luc: the iPad relies on always loading the latest deploy.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* pass through to the network */ });
