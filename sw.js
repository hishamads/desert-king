/* =====================================================================
 * ملاحة ملك الصحراء — Service Worker (sw.js)
 * ---------------------------------------------------------------------
 * Responsibilities:
 *   1. Pre-cache the app shell (HTML/CSS/JS/icons/manifest) at install
 *      time so the app opens with ZERO network (Airplane Mode).
 *   2. Pre-cache the Leaflet library from the CDN (best effort) so the
 *      map engine is also available offline after the first online run.
 *   3. Serve map tiles cache-first from a dedicated, long-lived cache
 *      ("desertnav-tiles-v1"). Tiles you browse online are cached
 *      automatically; tiles pre-downloaded with «حفظ المنطقة» are read
 *      from the same cache. When a tile is missing offline we return a
 *      network error so the app can detect it and switch to the radar.
 *
 * IMPORTANT: bump VERSION every time you change index.html / style.css /
 * app.js, otherwise installed devices keep serving the old cached files.
 * ===================================================================== */

const VERSION = 'v2.5.1';
const SHELL_CACHE = `desertnav-shell-${VERSION}`; // replaced on each release
const CDN_CACHE = 'desertnav-cdn-v1';             // Leaflet (rarely changes)
const TILE_CACHE = 'desertnav-tiles-v1';          // map tiles — NEVER auto-deleted on update

/* Files that make up the app shell (relative to the SW scope). */
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './lang.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './lib/leaflet.js',
  './lib/leaflet.css',
  './lib/leaflet-rotate.js',
  './lib/pmtiles.js',
  './lib/protomaps-leaflet.js',
  './كشتات-حسب-المنطقة.gpx',
  './طريق-المخيم.gpx'
];

/* External libraries. Since v2.0 Leaflet is served from ./lib (in SHELL_ASSETS),
 * so nothing is needed from a CDN; kept for older cached pages. */
const CDN_ASSETS = [];

/* Hostnames that serve map tiles (must match LAYERS in app.js). */
const TILE_HOSTS = [
  'server.arcgisonline.com',
  'tile.opentopomap.org',
  'tile.openstreetmap.org'
];

/* ---------------------------------------------------------------------
 * Tile-key normalisation (identical copy lives in app.js).
 * OpenTopoMap uses a/b/c sub-domains: the same tile can be requested
 * from a.tile..., b.tile... or c.tile... We always store it under the
 * "a." host so a tile downloaded once is found whatever sub-domain
 * Leaflet picks later.
 * ------------------------------------------------------------------- */
function tileKey(urlString) {
  const u = new URL(urlString);
  u.searchParams.delete('co');          // "cache-only" marker used by fallback layers
  u.hostname = u.hostname.replace(/^[abc]\.tile\.opentopomap\.org$/, 'a.tile.opentopomap.org');
  return u.toString();
}

function isTileRequest(url) {
  return TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
}

/* ---------------------------------------------------------------------
 * INSTALL — cache the shell (must succeed) + CDN libs (best effort,
 * because the first install could happen on a flaky connection).
 * ------------------------------------------------------------------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // cache: 'reload' bypasses the HTTP cache so we store fresh copies.
    await shell.addAll(SHELL_ASSETS.map(u => new Request(u, { cache: 'reload' })));

    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_ASSETS.map(async url => {
      try {
        if (await cdn.match(url)) return;                 // already cached
        const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (resp.ok) await cdn.put(url, resp);
      } catch (e) { /* offline during install — retried at runtime */ }
    }));

    await self.skipWaiting(); // activate the new SW immediately
  })());
});

/* ---------------------------------------------------------------------
 * ACTIVATE — delete old shell caches from previous VERSIONs.
 * The tile cache is deliberately kept so offline maps survive updates.
 * ------------------------------------------------------------------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('desertnav-shell-') && k !== SHELL_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------------------------------------------------------------------
 * FETCH — route every GET request to the right strategy.
 * ------------------------------------------------------------------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (isTileRequest(url)) {
    event.respondWith(tileStrategy(url));
    return;
  }
  // The vector-map parts (~90 MB each) are stored by the app in IndexedDB:
  // never copy them into the shell cache.
  if (url.origin === self.location.origin && url.pathname.includes('/vector/')) return;
  if (url.origin === self.location.origin) {
    event.respondWith(shellStrategy(req));
    return;
  }
  if (url.hostname === 'unpkg.com') {
    event.respondWith(cdnStrategy(req));
  }
  // Anything else goes to the network untouched.
});

/* App shell: cache-first. Navigations fall back to index.html offline. */
async function shellStrategy(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp.ok && resp.type === 'basic') cache.put(req, resp.clone()).catch(() => {});
    return resp;
  } catch (e) {
    if (req.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    return Response.error();
  }
}

/* Leaflet from CDN: cache-first, filled at install or first online use. */
async function cdnStrategy(req) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  try {
    const resp = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (resp.ok) cache.put(req.url, resp.clone()).catch(() => {});
    return resp;
  } catch (e) {
    return Response.error();
  }
}

/* Map tiles: cache-first; on a miss fetch & store; offline miss = error
 * (Leaflet fires "tileerror", which the app uses to switch to radar). */
async function tileStrategy(url) {
  const cache = await caches.open(TILE_CACHE);
  const key = tileKey(url.toString());
  const cached = await cache.match(key);
  if (cached) return cached;
  // Fallback layers (terrain under satellite, coarse all-Saudi background)
  // ask with ?co=1: serve them ONLY from the device, never from the network,
  // so they cost no data and only fill gaps.
  if (url.searchParams.has('co')) return Response.error();
  try {
    let resp;
    try {
      // Prefer a CORS response: it is stored at its real size.
      resp = await fetch(key, { mode: 'cors', credentials: 'omit' });
    } catch (corsErr) {
      // Server without CORS headers → opaque response (still displayable).
      resp = await fetch(key, { mode: 'no-cors' });
    }
    if (resp && (resp.ok || resp.type === 'opaque')) {
      cache.put(key, resp.clone()).catch(() => {}); // quota errors are ignored
    }
    return resp;
  } catch (e) {
    return Response.error();
  }
}

/* Allow the page to ask a waiting SW to take over immediately. */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
