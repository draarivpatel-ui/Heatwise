/* HeatWise service worker: the page opens with no signal (say, at a field or job site) after one online visit.
 *
 * Network first for every same-origin file, cached copy only when the network fails, so a new deploy always
 * wins. Weather APIs (NWS, Open-Meteo) are other origins and are never cached here: js/forecast.js keeps the
 * last good forecast per place in localStorage (reused for 30 min, stands in up to 3 h when the APIs fail,
 * always labelled with its age). Old HeatWise caches are deleted on activate; other apps' caches on the same
 * domain are never touched. Bump VERSION whenever the SHELL list changes.
 */
var VERSION = 'hw-12';
var CACHE = 'heatwise-' + VERSION;
var SHELL = ['./', 'index.html', 'styles.css',
  'js/app.js', 'js/i18n.js', 'js/heat.js', 'js/plan.js', 'js/forecast.js', 'js/places.js', 'js/validation-ui.js', 'js/validation.js',
  'data/validation/replay-iah-2023-08-24.json', 'data/validation/nws-hgx.json', 'data/validation/openmeteo.json',
  'fonts/public-sans-400.woff2', 'fonts/public-sans-600.woff2', 'fonts/public-sans-800.woff2', 'fonts/plex-mono-500.woff2'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('heatwise-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // weather APIs: straight to the network
  var key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(key, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(key, { ignoreSearch: true }).then(function (r) { return r || caches.match('./'); });
  }));
});
