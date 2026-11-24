/* =====================================================================
 * ملاحة ملك الصحراء — app.js
 * ---------------------------------------------------------------------
 * Offline-first desert navigation & GPS track recorder (vanilla JS).
 *
 * Module map (each is a plain object with methods):
 *   §1  Constants & configuration
 *   §2  Geo / formatting utilities
 *   §3  Store       — IndexedDB persistence (localStorage fallback)
 *   §4  S           — single in-memory application state
 *   §5  UI          — toast, sheets, frame scheduler
 *   §6  GPS         — watchPosition, speed/course derivation
 *   §7  Heading     — compass (DeviceOrientation) + GPS course fusion
 *   §8  Recorder    — start/pause/resume/save, jitter & battery filters
 *   §9  Waypoints   — save/delete/categories
 *   §10 Guide       — go-to point, follow track, backtrack (العودة على الأثر)
 *   §11 MapView     — Leaflet map, layers, markers, auto radar fallback
 *   §12 Radar       — canvas coordinate grid + tactical radar (no tiles)
 *   §13 Offline     — "حفظ المنطقة" tile pre-caching (Cache Storage)
 *   §14 GPX         — export / import (Garmin & Google Earth compatible)
 *   §15 WakeLock    — keep the screen on (iOS 16.4+, Android, desktop)
 *   §16 Lists       — waypoint / track / region list rendering
 *   §17 Telemetry   — live data bar
 *   §18 Actions     — every button (data-act="...") handler
 *   §19 Boot        — startup sequence & Service Worker registration
 * ===================================================================== */
'use strict';

/* =====================================================================
 * §1 CONSTANTS & CONFIGURATION
 * ===================================================================== */
const APP_VERSION = '2.6.0';
const TILE_CACHE = 'desertnav-tiles-v1';          // must match sw.js
const MAX_DOWNLOAD_MB = 500;                      // safety cap per area (estimated size)
const DEFAULT_CENTER = { lat: 25.9800, lon: 48.6600 }; // camp route area, Urayrah (before first fix)
const TRANSPARENT_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* Base map layers. Add/replace providers here (respect their usage terms). */
const LAYERS = {
  sat: {
    name: 'قمر صناعي', short: 'قمر',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subs: '', maxNative: 18, kbPerTile: 22,
    attr: 'Imagery © Esri, Maxar, Earthstar Geographics'
  },
  topo: {
    name: 'تضاريس', short: 'تضاريس',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subs: 'abc', maxNative: 17, kbPerTile: 30,
    attr: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)'
  },
  osm: {
    name: 'شوارع', short: 'شوارع',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subs: '', maxNative: 19, kbPerTile: 18,
    attr: '© OpenStreetMap contributors'
  }
};
const LAYER_ORDER = ['sat', 'topo', 'osm'];

/* All-Saudi terrain background (downloaded once from the «حفظ المنطقة» sheet). */
const KSA_BOUNDS = { n: 32.6, s: 16.0, w: 34.4, e: 55.8 };
const BG_LAYER = 'topo', BG_MAX_ZOOM = 9;
const BG_SAT_MAX_ZOOM = 11;   // whole-Kingdom satellite pack (≈350 MB) — upscaled when zoomed in further

/* Waypoint categories: key → Arabic label, emoji icon, Garmin GPX <sym>. */
const CATS = {
  camp:   { label: 'مخيم',        icon: '⛺', sym: 'Campground' },
  well:   { label: 'بئر',         icon: '💧', sym: 'Drinking Water' },
  sand:   { label: 'غراز',        icon: '🏜️', sym: 'Danger Area' },
  meet:   { label: 'نقطة التقاء', icon: '🚩', sym: 'Flag, Blue' },
  danger: { label: 'خطر',         icon: '⚠️', sym: 'Skull and Crossbones' },
  car:    { label: 'سيارة',       icon: '🚙', sym: 'Car' },
  home:   { label: 'منزل',        icon: '🏠', sym: 'Residence' },
  farm:   { label: 'مزرعة',       icon: '🌴', sym: 'Farm' },
  other:  { label: 'عامة',        icon: '📍', sym: 'Waypoint' }
};

/* Road routing (paved part). OSRM public server — fine for personal use;
 * for heavy use host your own OSRM or switch to another provider here. */
const ROUTER_URL = 'https://router.project-osrm.org/route/v1/driving/';
const OFFROAD_KMH = 25;   // assumed average speed off-road, for time estimates

/* Line styles — the same meaning on the map and on the radar. */
const LINE = {
  road:    { color: '#3b82f6', weight: 6, dash: null },        // planned paved road
  offroad: { color: '#f59e0b', weight: 5, dash: [12, 10] },    // unpaved — saved track
  direct:  { color: '#f59e0b', weight: 3, dash: [2, 8] },      // unpaved — straight line
  rec:     { color: '#ef4444', weight: 5, dash: null },        // NEW recording
  saved:   { color: '#22d3ee', weight: 4, dash: null },        // previously recorded
  imported:{ color: '#a78bfa', weight: 4, dash: null }         // imported GPX
};

/* Region grouping for the waypoint list (order shown to the user). */
const REGION_ORDER = ['المنطقة الشرقية', 'منطقة الرياض'];
const REGION_REF = 'نقاط مرجعية (ليست مواقع تخييم)';
const REGION_MINE = 'نقاطي';
const VERIFY_OK = '[موثّق]', VERIFY_NO = '[غير موثّق]';

/** Sort key for a region name: known regions first, references and own points last. */
function regionRank(r) {
  const i = REGION_ORDER.indexOf(r);
  if (i >= 0) return i;
  if (r === REGION_REF) return 98;
  if (r === REGION_MINE) return 99;
  return 50;
}

/** Small badge: موثّق / غير موثّق (nothing for the user's own points). */
function verifyBadge(w) {
  if (w.verified === true) return '<span class="tag ok">موثّق ✓</span>';
  if (w.verified === false) return '<span class="tag warn">غير موثّق</span>';
  return '';
}

/* User-adjustable settings (persisted in IndexedDB "kv" store). */
const DEFAULT_SETTINGS = {
  minDist: 10,       // m   — record a point after moving at least this far
  interval: 30,      // s   — or after this long, if moved a little (≥3 m)
  maxAcc: 35,        // m   — ignore fixes worse than this (jitter filter)
  wakeLock: true,    // keep screen on
  autoRadar: true,   // switch to radar automatically when tiles are missing
  headingUp: false,  // radar rotates with heading
  layer: 'sat',
  uiLang: 'ar',      // app language: 'ar' | 'en'
  voiceOn: true,     // spoken guidance
  voiceLang: 'ar',   // voice language: 'ar' | 'en' (independent of the app language)
  natKey: '',        // Saudi National Address (SPL) API subscription key
  voiceVol: 1        // 0.3 … 1
};

/* =====================================================================
 * §2 GEO & FORMATTING UTILITIES
 * ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;
const norm360 = a => ((a % 360) + 360) % 360;
/** Signed smallest difference a-b in degrees, range (-180, 180]. */
const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Great-circle distance in metres (haversine formula). */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (true north, 0-360°) from point 1 to point 2. */
function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return norm360(toDeg(Math.atan2(y, x)));
}

/** 8-point Arabic cardinal direction. */
function cardinal(deg, lang) {
  lang = lang || LG.ui;
  const names = lang === 'en'
    ? ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
    : ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
  return names[Math.round(norm360(deg) / 45) % 8];
}

/** Decimal degrees → DMS string, e.g. 24°42'49.0" N */
function toDMS(deg, isLat) {
  const hemi = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  let a = Math.abs(deg);
  let d = Math.floor(a);
  let m = Math.floor((a - d) * 60);
  let s = ((a - d) * 60 - m) * 60;
  if (s >= 59.95) { s = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}" ${hemi}`;
}

function fmtDist(m) {
  if (m == null || isNaN(m)) return '--';
  if (m < 1000) return `${Math.round(m)} ${X('م', 'm')}`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} ${X('كم', 'km')}`;
}

function fmtDuration(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/** Short duration for navigation: "1 س 12 د" / "12 د" / "< 1 د". */
function fmtDurShort(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return X('أقل من دقيقة', 'under a minute');
  return m >= 60 ? `${Math.floor(m / 60)} ${X('س', 'h')} ${m % 60} ${X('د', 'min')}` : `${m} ${X('د', 'min')}`;
}

const MODE_BADGE_TEXT = 'رادار — بدون خرائط';

function fmtDate(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeXml = escapeHtml;

/** Parse a coordinate typed by the user: decimal ("24.7136") or DMS ("24 42 49 N"). */
function parseCoord(str, isLat) {
  if (str == null) return NaN;
  let s = String(str).trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.');
  const neg = /[SWsw]|^-/.test(s);
  const nums = s.match(/\d+(\.\d+)?/g);
  if (!nums) return NaN;
  let v = parseFloat(nums[0]);
  if (nums[1]) v += parseFloat(nums[1]) / 60;
  if (nums[2]) v += parseFloat(nums[2]) / 3600;
  if (neg) v = -v;
  const lim = isLat ? 90 : 180;
  return Math.abs(v) <= lim ? v : NaN;
}

/**
 * Parse a coordinate PAIR from anything a user may paste:
 *   "25.979029, 48.798508" · "25°58'44.5\"N 48°47'54.6\"E" ·
 *   Google Maps links containing @lat,lon or ?q=lat,lon / ll= / destination=
 * Returns {lat, lon} or null.
 */
function parsePair(str) {
  if (!str) return null;
  let s = String(str).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').trim();
  try { s = decodeURIComponent(s); } catch (e) {}
  const ok = (lat, lon) => (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) ? { lat, lon } : null;
  let m = s.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) ||
          s.match(/[?&](?:q|ll|query|destination|daddr|center)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (m) return ok(parseFloat(m[1]), parseFloat(m[2]));
  const dms = [...s.matchAll(/(\d+)\s*°\s*(\d+)\s*['′]\s*([\d.]+)\s*(?:"|″|'')?\s*([NSEWnsew])/g)];
  if (dms.length >= 2) {
    const v = x => (parseInt(x[1], 10) + parseInt(x[2], 10) / 60 + parseFloat(x[3]) / 3600) * (/[SWsw]/.test(x[4]) ? -1 : 1);
    const a = dms[0], b = dms[1];
    return /[NSns]/.test(a[4]) ? ok(v(a), v(b)) : ok(v(b), v(a));
  }
  m = s.match(/(-?\d{1,2}\.\d+)\s*[,،\s]\s*(-?\d{1,3}\.\d+)/);
  return m ? ok(parseFloat(m[1]), parseFloat(m[2])) : null;
}

/** Same tile-key normalisation as sw.js (a/b/c sub-domains → "a"). */
function tileKey(urlString) {
  const u = new URL(urlString);
  u.searchParams.delete('co');
  u.hostname = u.hostname.replace(/^[abc]\.tile\.opentopomap\.org$/, 'a.tile.opentopomap.org');
  return u.toString();
}

/** Current screen rotation in degrees (0/90/180/270) for compass correction. */
function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}

/** Sum of distances along a list of [lat, lon, ...] points. */
function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return d;
}

/* =====================================================================
 * §3 STORE — IndexedDB wrapper with automatic localStorage fallback.
 * Object stores:
 *   tracks    { id, name, created, segments:[[ [lat,lon,ele,time], ... ]], distance, durationMs, imported, visible }
 *   waypoints { id, name, cat, lat, lon, alt, created }
 *   kv        { key, value }  — settings, active recording, offline regions
 * ===================================================================== */
const Store = {
  db: null,
  useLS: false,

  /** Open (or create/upgrade) the database. Never rejects: falls back to LS. */
  async open() {
    // A transient IndexedDB failure must not silently switch to an empty
    // localStorage (the saved places would look "erased"): retry once.
    await this._open();
    if (this.useLS && 'indexedDB' in window) {
      this.useLS = false;
      await new Promise(r => setTimeout(r, 400));
      await this._open();
    }
  },

  _open() {
    return new Promise(resolve => {
      if (!('indexedDB' in window)) { this.useLS = true; return resolve(); }
      let req;
      try { req = indexedDB.open('desertnav', 1); }
      catch (e) { this.useLS = true; return resolve(); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('waypoints')) db.createObjectStore('waypoints', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => { this.useLS = true; resolve(); };
      req.onblocked = () => { this.useLS = true; resolve(); };
    });
  },

  /** Run one request inside a transaction and resolve with its result. */
  _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  /* localStorage fallback: each store is one JSON object keyed by id. */
  _lsLoad(store) { try { return JSON.parse(localStorage.getItem('dn_' + store) || '{}'); } catch (e) { return {}; } },
  _lsSave(store, obj) {
    try { localStorage.setItem('dn_' + store, JSON.stringify(obj)); }
    catch (e) { UI.toast('⚠️ مساحة التخزين ممتلئة'); }
  },

  async getAll(store) {
    if (this.useLS) return Object.values(this._lsLoad(store));
    return (await this._tx(store, 'readonly', s => s.getAll())) || [];
  },
  async put(store, obj) {
    if (this.useLS) { const m = this._lsLoad(store); m[obj.id] = obj; this._lsSave(store, m); return; }
    await this._tx(store, 'readwrite', s => s.put(obj));
    if (store === 'waypoints') scheduleWpBackup();
  },
  async del(store, id) {
    if (this.useLS) { const m = this._lsLoad(store); delete m[id]; this._lsSave(store, m); return; }
    await this._tx(store, 'readwrite', s => s.delete(id));
    if (store === 'waypoints') scheduleWpBackup();
  },
  async kvGet(key, def = null) {
    if (this.useLS) { const m = this._lsLoad('kv'); return key in m ? m[key] : def; }
    const row = await this._tx('kv', 'readonly', s => s.get(key));
    return row ? row.value : def;
  },
  async kvSet(key, value) {
    if (this.useLS) { const m = this._lsLoad('kv'); m[key] = value; this._lsSave('kv', m); return; }
    await this._tx('kv', 'readwrite', s => s.put({ key, value }));
  }
};

/* =====================================================================
 * §4 APPLICATION STATE (single source of truth)
 * ===================================================================== */
const S = {
  settings: { ...DEFAULT_SETTINGS },
  pos: null,               // latest fix {lat, lon, alt, acc, speed, course, t}
  compassHeading: null,    // smoothed magnetic heading from sensors
  compassTime: 0,
  heading: null,           // fused heading used everywhere
  headingSrc: '',
  rec: null,               // active recording (see Recorder.blank)
  tracks: [],
  waypoints: [],
  regions: [],             // downloaded offline areas
  target: null,            // guidance target (see Guide)
  lastPlan: null,          // last computed route (offline-ready)
  pin: null,               // dropped pin {lat, lon} from a long-press
  view: 'map',             // 'map' | 'radar'
  autoSwitched: false,     // radar chosen automatically (tiles missing)
  follow: true,            // keep the view centred on the user
  gpsWatchId: null,
  started: false
};

/* =====================================================================
 * §5 UI HELPERS — toast, bottom sheets, render-frame scheduler
 * ===================================================================== */
const UI = {
  _toastTimer: null,
  _frameQueued: false,
  _openSheet: null,

  toast(msg, ms = 2800) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  },

  openSheet(id) {
    this.closeSheet();
    const el = document.getElementById(id);
    if (!el) return;
    $('#backdrop').hidden = false;
    el.classList.add('open');
    document.body.classList.add('sheet-open');
    this._openSheet = el;
  },

  closeSheet() {
    // Closing the place card (not moving on to plan/save) removes the dropped pin.
    if (this._openSheet && this._openSheet.id === 'sheet-place' && !this._keepPin && typeof Place !== 'undefined') Place.clearPin();
    this._keepPin = false;
    if (this._openSheet) this._openSheet.classList.remove('open');
    this._openSheet = null;
    $('#backdrop').hidden = true;
    document.body.classList.remove('sheet-open');
    if (typeof setTabActive === 'function') setTabActive('tab-explore');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  },

  /**
   * Batch all visual updates into one animation frame. GPS fires ~1 Hz but
   * the compass fires up to 60 Hz; this keeps the DOM/canvas work minimal.
   */
  frame() {
    if (this._frameQueued) return;
    this._frameQueued = true;
    requestAnimationFrame(() => {
      this._frameQueued = false;
      Telemetry.render();
      Guide.render();
      MapView.updateHeading();
      Radar.draw();
      updateCompass();
    });
  }
};

/* =====================================================================
 * §6 GPS — continuous high-accuracy position watch
 * ===================================================================== */
const GPS = {
  start() {
    if (!('geolocation' in navigator)) { UI.toast('هذا الجهاز لا يدعم تحديد الموقع'); return; }
    if (S.gpsWatchId != null) return;
    if (!window.isSecureContext) UI.toast('⚠️ يجب فتح التطبيق عبر HTTPS ليعمل GPS', 6000);
    this.setStatus('search');
    S.gpsWatchId = navigator.geolocation.watchPosition(
      p => this.onPos(p),
      e => this.onErr(e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  },

  /** Restart the watch (iOS sometimes stops delivering after backgrounding). */
  restart() {
    if (S.gpsWatchId != null) navigator.geolocation.clearWatch(S.gpsWatchId);
    S.gpsWatchId = null;
    this.start();
  },

  /**
   * Handle a new fix: derive speed/course when the device omits them,
   * then feed every module that depends on position.
   */
  onPos(p) {
    const c = p.coords;
    const t = p.timestamp || Date.now();
    const prev = S.pos;

    let speed = (typeof c.speed === 'number' && !isNaN(c.speed) && c.speed >= 0) ? c.speed : null;
    let course = (typeof c.heading === 'number' && !isNaN(c.heading) && speed > 0.5) ? c.heading : null;

    if (prev) {
      const dt = (t - prev.t) / 1000;
      const d = haversine(prev.lat, prev.lon, c.latitude, c.longitude);
      // Derive speed from successive fixes if the device didn't provide it.
      if (speed == null && dt > 0.5) speed = d > c.accuracy * 0.5 ? d / dt : 0;
      // Derive course when moving and the displacement exceeds the noise.
      if (course == null && speed > 1.5 && d > Math.max(4, c.accuracy * 0.5)) {
        course = bearing(prev.lat, prev.lon, c.latitude, c.longitude);
      }
    }

    S.pos = {
      lat: c.latitude, lon: c.longitude,
      alt: (typeof c.altitude === 'number' && !isNaN(c.altitude)) ? c.altitude : null,
      acc: c.accuracy, speed, course, t
    };

    this.setStatus(c.accuracy <= 15 ? 'good' : c.accuracy <= 50 ? 'fair' : 'poor');
    Heading.update();
    Recorder.onPos(S.pos);
    Guide.update();
    MapView.onPos();
    UI.frame();
  },

  onErr(e) {
    if (e.code === 1) {
      this.setStatus('denied');
      UI.toast('تم رفض إذن الموقع. في الآيفون: الإعدادات ← الخصوصية ← خدمات الموقع ← Safari ← "أثناء الاستخدام" + "الموقع الدقيق"', 9000);
    } else if (e.code === 2) {
      this.setStatus('poor');
      UI.toast('تعذّر تحديد الموقع — تأكد من رؤية السماء');
    } else {
      this.setStatus('search'); // timeout: watch keeps running
    }
  },

  /** Stop the GPS watch (used by «خروج»). */
  stop() {
    if (S.gpsWatchId != null) navigator.geolocation.clearWatch(S.gpsWatchId);
    S.gpsWatchId = null;
    this.setStatus('off');
  },

  setStatus(st) {
    const dot = $('#gps-dot');
    dot.className = 'dot dot-' + st;
  }
};

/* =====================================================================
 * §7 HEADING — compass sensors fused with GPS course over ground
 * ---------------------------------------------------------------------
 * • iOS: DeviceOrientationEvent.requestPermission() (user gesture) then
 *   e.webkitCompassHeading (0 = magnetic north, clockwise).
 * • Android/Chrome: "deviceorientationabsolute" → heading = 360 - alpha.
 * • In a moving vehicle (>10 km/h) the GPS course is far more reliable
 *   than a phone compass surrounded by steel, so it takes priority.
 * ===================================================================== */
const Heading = {
  listening: false,

  async enable() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') { UI.toast('لم يُمنح إذن البوصلة — سيُستخدم اتجاه GPS أثناء الحركة', 5000); return false; }
      }
    } catch (e) {
      // Thrown when not called from a user gesture; the start button handles that.
      return false;
    }
    if (!this.listening) {
      this._evt = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
      this._fn = ev => this.onOrient(ev);
      window.addEventListener(this._evt, this._fn, true);
      this.listening = true;
    }
    return true;
  },

  /** Stop listening to the compass (used by «خروج»). */
  disable() {
    if (this.listening) window.removeEventListener(this._evt, this._fn, true);
    this.listening = false;
  },

  onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading) && e.webkitCompassHeading >= 0) {
      h = e.webkitCompassHeading;                       // iOS
    } else if ((e.absolute === true || e.type === 'deviceorientationabsolute') && e.alpha != null) {
      h = 360 - e.alpha;                                // Android / absolute
    }
    if (h == null) return;                              // relative-only sensor: unusable
    h = norm360(h + screenAngle());                     // landscape correction

    // Circular low-pass filter (handles the 359°→0° wrap) to stop jitter.
    S.compassHeading = S.compassHeading == null
      ? h
      : norm360(S.compassHeading + angleDiff(h, S.compassHeading) * 0.2);
    S.compassTime = Date.now();
    this.update();
  },

  /** Pick the best heading source and trigger a redraw if it changed. */
  update() {
    const p = S.pos;
    let h = null, src = '';
    const compassFresh = S.compassHeading != null && Date.now() - S.compassTime < 3000;
    if (p && p.course != null && p.speed != null && p.speed >= 2.8) { h = p.course; src = 'GPS'; }
    else if (compassFresh) { h = S.compassHeading; src = 'بوصلة'; }
    else if (p && p.course != null) { h = p.course; src = 'GPS'; }

    const changed = (h == null) !== (S.heading == null) || (h != null && Math.abs(angleDiff(h, S.heading)) >= 0.8);
    S.heading = h;
    S.headingSrc = src;
    if (changed) UI.frame();
  }
};

/* =====================================================================
 * §8 RECORDER — track recording with battery & jitter filters
 * ---------------------------------------------------------------------
 * A recording holds one or more SEGMENTS: pausing then resuming starts a
 * new segment so the gap is not drawn or counted in the distance (GPX
 * <trkseg>). Points are compact arrays [lat, lon, ele, timeMs].
 * The active recording is autosaved every 10 s so nothing is lost if iOS
 * kills the page; it is restored (paused) at the next launch.
 * ===================================================================== */
const Recorder = {
  blank() {
    return { id: null, status: 'idle', segments: [], distance: 0, elapsedMs: 0, segStart: 0, startTime: 0, lastSaved: 0 };
  },

  start() {
    S.rec = { ...this.blank(), id: uid(), status: 'recording', segments: [[]], segStart: Date.now(), startTime: Date.now() };
    if (S.pos && S.pos.acc <= S.settings.maxAcc) this.addPoint(S.pos);
    MapView.renderRec();
    this.persist();
    this.refreshUI();
    UI.toast('⏺ بدأ تسجيل المسار');
  },

  pause() {
    if (S.rec.status !== 'recording') return;
    S.rec.elapsedMs += Date.now() - S.rec.segStart;
    S.rec.status = 'paused';
    this.persist();
    this.refreshUI();
    UI.toast('⏸ تم الإيقاف المؤقت');
  },

  resume() {
    if (S.rec.status !== 'paused') return;
    S.rec.status = 'recording';
    S.rec.segStart = Date.now();
    S.rec.segments.push([]);                      // new segment after a pause
    if (S.pos && S.pos.acc <= S.settings.maxAcc) this.addPoint(S.pos);
    this.persist();
    this.refreshUI();
    UI.toast('▶ استؤنف التسجيل');
  },

  elapsed() {
    const r = S.rec;
    return r.elapsedMs + (r.status === 'recording' ? Date.now() - r.segStart : 0);
  },

  pointCount() { return S.rec.segments.reduce((n, s) => n + s.length, 0); },

  lastPoint() {
    for (let i = S.rec.segments.length - 1; i >= 0; i--) {
      const s = S.rec.segments[i];
      if (s.length) return s[s.length - 1];
    }
    return null;
  },

  /**
   * Decide whether a new fix becomes a track point:
   *   • reject poor accuracy (> maxAcc)
   *   • reject impossible jumps (> 250 km/h implied)
   *   • accept if moved ≥ minDist (and beyond half the accuracy radius)
   *   • or if interval elapsed and moved at least a little
   */
  onPos(p) {
    const r = S.rec;
    if (!r || r.status !== 'recording') return;
    if (p.acc > S.settings.maxAcc) return;

    const seg = r.segments[r.segments.length - 1];
    const last = seg[seg.length - 1];
    if (!last) { this.addPoint(p); return; }

    const d = haversine(last[0], last[1], p.lat, p.lon);
    const dt = (p.t - last[3]) / 1000;
    if (dt <= 0) return;
    if (d / dt > 70) return;                                  // GPS spike

    const noise = p.acc * 0.5;
    const byDist = d >= S.settings.minDist && d >= noise;
    const byTime = dt >= S.settings.interval && d >= Math.max(3, noise);
    if (byDist || byTime) {
      r.distance += d;
      this.addPoint(p);
    }
  },

  addPoint(p) {
    const pt = [
      Math.round(p.lat * 1e7) / 1e7,
      Math.round(p.lon * 1e7) / 1e7,
      p.alt != null ? Math.round(p.alt * 10) / 10 : null,
      p.t || Date.now()
    ];
    S.rec.segments[S.rec.segments.length - 1].push(pt);
    MapView.addRecPoint(pt);
    if (Date.now() - S.rec.lastSaved > 10000) this.persist();
    UI.frame();
  },

  persist() {
    if (!S.rec) return;
    S.rec.lastSaved = Date.now();
    Store.kvSet('activeRec', S.rec.status === 'idle' ? null : S.rec).catch(() => {});
  },

  /** Open the "finish" sheet (pauses first so the clock stops). */
  requestStop() {
    if (S.rec.status === 'idle') return;
    if (S.rec.status === 'recording') this.pause();
    $('#trk-name').value = `مسار ${fmtDate(S.rec.startTime)}`;
    $('#save-summary').textContent =
      `${fmtDist(S.rec.distance)} · ${fmtDuration(this.elapsed())} · ${this.pointCount()} pts`;
    UI.openSheet('sheet-save');
  },

  async save(name, alsoPlace) {
    const r = S.rec;
    const segments = r.segments.filter(s => s.length > 0);
    if (segments.reduce((n, s) => n + s.length, 0) < 2) {
      UI.toast('المسار قصير جداً (أقل من نقطتين) — لم يُحفظ');
      return;
    }
    const track = {
      id: r.id, name: name || `مسار ${fmtDate(r.startTime)}`,
      created: r.startTime, segments, distance: r.distance,
      durationMs: r.elapsedMs, imported: false, visible: true
    };
    await Store.put('tracks', track);
    S.tracks.push(track);
    this.discard(true);
    MapView.renderTracks();
    if (alsoPlace) { await saveTrackEndAsPlace(track, true); UI.toast(`✅ تم حفظ «${track.name}» كمسار وكموقع`); }
    else UI.toast('✅ تم حفظ المسار');
  },

  discard(silent) {
    S.rec = this.blank();
    Store.kvSet('activeRec', null).catch(() => {});
    MapView.renderRec();
    this.refreshUI();
    if (!silent) UI.toast('تم حذف التسجيل');
  },

  /** Restore an unfinished recording after the app was closed/killed. */
  async restore() {
    S.rec = this.blank();
    const saved = await Store.kvGet('activeRec', null).catch(() => null);
    if (!saved || !saved.status || saved.status === 'idle') return;
    if (saved.status === 'recording') {
      // Count time only up to the last stored point, then hold paused.
      let last = null;
      for (const s of saved.segments) if (s.length) last = s[s.length - 1];
      saved.elapsedMs += Math.max(0, (last ? last[3] : saved.segStart) - saved.segStart);
      saved.status = 'paused';
    }
    S.rec = saved;
    UI.toast('↺ تمت استعادة تسجيل غير مكتمل — اضغط «استئناف» للمتابعة', 5000);
  },

  /** Update the record FAB, the small recording pill and the recording sheet. */
  refreshUI() {
    const r = S.rec, idle = r.status === 'idle', paused = r.status === 'paused';
    const fab = $('#btn-rec');
    fab.classList.toggle('recording', r.status === 'recording');
    fab.classList.toggle('paused', paused);
    fab.querySelector('.tb-ico').textContent = r.status === 'recording' ? '❚❚' : paused ? '▶' : '●';
    $('#btn-rec-lbl').textContent = r.status === 'recording' ? 'إيقاف مؤقت' : paused ? 'استئناف' : 'تسجيل';
    $('#btn-stop').disabled = idle;
    $('#rs-toggle').textContent = r.status === 'recording' ? '⏸ إيقاف مؤقت' : '▶ استئناف';
    $('#rec-panel').hidden = idle;
    if (!idle) {
      const time = fmtDuration(this.elapsed()), dist = fmtDist(r.distance);
      $('#rec-badge').classList.toggle('paused', paused);
      $('#rec-time').textContent = time;
      $('#rec-dist').textContent = dist;
      $('#rs-time').textContent = time;
      $('#rs-dist').textContent = dist;
      $('#rec-pts').textContent = this.pointCount();
    }
  }
};

/* =====================================================================
 * §9 WAYPOINTS
 * ===================================================================== */
const Waypoints = {
  selectedCat: 'camp',

  /** Build the category chips once. */
  initForm() {
    $('#wp-cats').innerHTML = Object.entries(CATS).map(([k, c]) =>
      `<button type="button" class="cat${k === this.selectedCat ? ' sel' : ''}" data-act="wp-cat" data-cat="${k}">
         <span>${c.icon}</span>${c.label}</button>`).join('');
  },

  openForm(atLat, atLon) {
    const p = atLat != null ? null : S.pos;
    const n = S.waypoints.length + 1;
    $('#wp-name').value = `${CATS[this.selectedCat].label} ${n}`;
    if (p) {
      $('#wp-lat').value = p.lat.toFixed(6);
      $('#wp-lon').value = p.lon.toFixed(6);
      $('#wp-hint').textContent = `من موقعك الحالي (دقة ±${Math.round(p.acc)} م) — يمكنك تعديلها يدوياً.`;
    } else if (atLat != null) {
      $('#wp-lat').value = atLat.toFixed(6);
      $('#wp-lon').value = atLon.toFixed(6);
      $('#wp-hint').textContent = 'من الدبوس الذي وضعته على الخريطة — يمكنك تعديلها يدوياً.';
    } else {
      const c = MapView.viewCenter();
      $('#wp-lat').value = c.lat.toFixed(6);
      $('#wp-lon').value = c.lon.toFixed(6);
      $('#wp-hint').textContent = 'لا يوجد إشارة GPS بعد — الإحداثيات من مركز الشاشة. يمكنك لصق إحداثيات أو رابط خرائط جوجل في خانة خط العرض.';
    }
    UI.openSheet('sheet-wp');
  },

  selectCat(cat) {
    const oldLabel = CATS[this.selectedCat].label;
    this.selectedCat = cat;
    $$('#wp-cats .cat').forEach(b => b.classList.toggle('sel', b.dataset.cat === cat));
    // Auto-rename if the user hasn't typed a custom name.
    const nameEl = $('#wp-name');
    if (nameEl.value.startsWith(oldLabel)) nameEl.value = nameEl.value.replace(oldLabel, CATS[cat].label);
  },

  async saveFromForm() {
    const lat = parseCoord($('#wp-lat').value, true);
    const lon = parseCoord($('#wp-lon').value, false);
    if (isNaN(lat) || isNaN(lon)) { UI.toast('إحداثيات غير صحيحة'); return; }
    const wp = {
      id: uid(),
      name: $('#wp-name').value.trim() || CATS[this.selectedCat].label,
      cat: this.selectedCat, lat, lon,
      alt: S.pos && S.pos.alt != null ? Math.round(S.pos.alt) : null,
      created: Date.now()
    };
    await this.add(wp);
    UI.closeSheet();
    navigator.vibrate && navigator.vibrate(60);
    UI.toast(`${CATS[wp.cat].icon} تم حفظ «${wp.name}»`);
  },

  async add(wp) {
    await Store.put('waypoints', wp);
    S.waypoints.push(wp);
    MapView.renderWaypoints();
    Radar.draw();
  },

  async remove(id) {
    await Store.del('waypoints', id);
    S.waypoints = S.waypoints.filter(w => w.id !== id);
    if (S.target && S.target.wpId === id) Guide.stop();
    MapView.renderWaypoints();
    Radar.draw();
  }
};

/* =====================================================================
 * §10 GUIDE — go-to point, follow track, backtrack, planned route
 * ---------------------------------------------------------------------
 * mode 'point': straight-line pointer to a waypoint / track start.
 * mode 'track': follow a polyline — a saved track (forward or reversed
 *   for backtrack) or a PLANNED route (paved part from the router + the
 *   unpaved part from a saved track). Planned routes also carry:
 *     segKind[i]  'road' | 'offroad' | 'direct' for segment pts[i]→pts[i+1]
 *     steps[]     { along, text, kind } turn instructions along the path
 *   The user is projected onto the nearest SEGMENT; the steering point is
 *   60 m ahead along the path. Remaining = distance to it + path after it.
 * ===================================================================== */
const Guide = {
  arrived: false,

  setPoint(name, lat, lon, extra = {}) {
    S.target = { mode: 'point', name, lat, lon, ...extra };
    this.arrived = false;
    Store.kvSet('activePlan', null).catch(() => {});
    this.afterSet();
  },

  setTrack(name, segments, reverse) {
    let pts = segments.flat().map(p => [p[0], p[1]]);
    if (reverse) pts.reverse();
    Store.kvSet('activePlan', null).catch(() => {});
    this.setPath(name, pts, {});
  },

  /** Follow a planned route (see Router.plan). Persisted for offline restarts. */
  setPlan(plan, silent) {
    Store.kvSet('activePlan', plan).catch(() => {});
    this.setPath(plan.name, plan.pts, { isPlan: true, segKind: plan.segKind, steps: plan.steps, parts: plan.parts }, silent);
  },

  /** Common set-up for any polyline target. */
  setPath(name, pts, extra, silent) {
    pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    if (pts.length < 2) { UI.toast('المسار لا يحتوي نقاطاً كافية'); return; }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    S.target = { mode: 'track', name, pts, cum, near: 0, idx: 0, along: 0, lat: pts[0][0], lon: pts[0][1], needFull: true, lastKind: null, ...extra };
    this.arrived = false;
    this.afterSet(silent);
  },

  afterSet(silent) {
    $('#guide').hidden = false;
    $('#guide-bottom').hidden = false;
    document.body.classList.add('guiding');
    $('#guide').classList.remove('arrived');
    UI.closeSheet();
    this.update();
    MapView.renderPlan();
    MapView.renderGuide();
    UI.frame();
    if (!silent) { UI.toast('🧭 بدأ التوجيه إلى: ' + S.target.name); Voice.onStart(S.target); }
  },

  stop() {
    S.target = null;
    Store.kvSet('activePlan', null).catch(() => {});
    $('#guide').hidden = true;
    $('#guide-bottom').hidden = true;
    document.body.classList.remove('guiding');
    MapView.renderPlan();
    MapView.renderGuide();
    UI.frame();
  },

  /**
   * Re-locate the steering point along the followed path.
   * 1. Project the user onto every nearby SEGMENT (not just vertices — saved
   *    route points can be kilometres apart) in a local flat frame (metres).
   * 2. The closest projection gives the cross-track error (offTrack) and the
   *    distance already covered along the path (t.along).
   * 3. The steering point is interpolated 60 m further along the path.
   */
  updateTrackTarget() {
    const t = S.target, p = S.pos, pts = t.pts, cum = t.cum;
    const last = pts.length - 1, total = cum[last];
    const kx = 111320 * Math.cos(toRad(p.lat)), ky = 110574;
    const from = t.needFull ? 0 : Math.max(0, t.near - 30);
    const to = t.needFull ? last : Math.min(last, t.near + 400);
    let best = { i: t.near, f: 0, d: Infinity };
    for (let i = from; i < to; i++) {
      // Segment A→B and user P in metres relative to P.
      const ax = (pts[i][1] - p.lon) * kx, ay = (pts[i][0] - p.lat) * ky;
      const bx = (pts[i + 1][1] - p.lon) * kx, by = (pts[i + 1][0] - p.lat) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const f = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + f * dx, ay + f * dy);
      if (d < best.d) best = { i, f, d };
    }
    t.near = best.i;
    t.offTrack = best.d;
    t.needFull = best.d > 300;               // far from the path → full search next fix
    t.along = cum[best.i] + best.f * (cum[best.i + 1] - cum[best.i]);

    // Steering point: 60 m ahead along the path (interpolated), capped at the end.
    const goal = Math.min(total, t.along + 60);
    let j = best.i;
    while (j < last - 1 && cum[j + 1] < goal) j++;
    const segLen = cum[j + 1] - cum[j];
    const g = segLen > 0 ? (goal - cum[j]) / segLen : 1;
    t.lat = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * g;
    t.lon = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * g;
    t.idx = j + 1;
    t.restAfter = total - goal;              // path length beyond the steering point
  },

  /** Road type of the segment the user is on (planned routes only). */
  currentKind() {
    const t = S.target;
    return t && t.segKind ? t.segKind[Math.min(t.near, t.segKind.length - 1)] : null;
  },

  /** Called on every GPS fix: compute distance/bearing, arrival, road-type change. */
  update() {
    const t = S.target, p = S.pos;
    if (!t || !p) return;
    if (t.mode === 'track') this.updateTrackTarget();
    t.dist = haversine(p.lat, p.lon, t.lat, t.lon);
    t.brg = bearing(p.lat, p.lon, t.lat, t.lon);
    if (t.mode === 'track') {
      const last = t.pts.length - 1;
      t.remaining = t.dist + t.restAfter;
      t.finalDist = haversine(p.lat, p.lon, t.pts[last][0], t.pts[last][1]);
    } else {
      t.remaining = t.dist;
      t.finalDist = t.dist;
    }

    // Entering the unpaved part: suggest recording (only on request — never automatic).
    const kind = this.currentKind();
    if (kind && t.lastKind === 'road' && kind !== 'road' && t.offTrack < 150) {
      navigator.vibrate && navigator.vibrate([150, 80, 150]);
      UI.toast(S.rec.status === 'recording'
        ? '🏜️ دخلت الطريق غير المعبّد — التسجيل يعمل'
        : '🏜️ بداية غير المعبّد — اضغط ● لتسجيل مسارك', 6000);
      Voice.onUnpaved();
    }
    if (kind) t.lastKind = kind;

    const arriveR = Math.max(20, Math.min(p.acc, 60));
    if (!this.arrived && t.finalDist <= arriveR) {
      this.arrived = true;
      $('#guide').classList.add('arrived');
      navigator.vibrate && navigator.vibrate([250, 120, 250, 120, 400]);
      UI.toast('🎯 وصلت إلى الهدف: ' + t.name, 6000);
      Voice.onArrive(t);
    } else if (this.arrived && t.finalDist > arriveR * 3) {
      this.arrived = false;
      $('#guide').classList.remove('arrived');
    }
    Voice.tick(t);
    MapView.renderGuide();
  },

  /** Paint the navigation banner (top) and summary card (bottom). */
  render() {
    const t = S.target;
    if (!t) return;
    const banner = $('#guide'), nextEl = $('#guide-next'), noteEl = $('#guide-note');
    $('#guide-name').textContent = (t.isPlan ? '🚗 ' : t.mode === 'track' ? '〰 ' : '◉ ') + t.name;
    if (!S.pos || t.dist == null) {
      nextEl.textContent = 'بانتظار إشارة GPS…';
      $('#guide-dist').textContent = '--';
      return;
    }
    const kind = this.currentKind();
    banner.classList.toggle('off', !t.isPlan || kind !== 'road');

    // Banner text: next turn (planned routes) or a plain direction.
    let text;
    const nx = t.steps && t.steps.find(s => s.along > t.along - 20);   // keep a step visible until ~20 m past it
    if (nx) {
      const d = nx.along - t.along;
      text = (d < 40 ? X('الآن: ', 'Now: ') : X(`بعد ${fmtDist(d)}: `, `In ${fmtDist(d)}: `)) + stepLabel(nx, LG.ui, false);
    } else if (t.mode === 'track') {
      text = X(`اتبع المسار — اتجه ${cardinal(t.brg)}`, `Follow the track — head ${cardinal(t.brg)}`);
    } else {
      text = X(`اتجه ${cardinal(t.brg)} — ${fmtDist(t.dist)}`, `Head ${cardinal(t.brg)} — ${fmtDist(t.dist)}`);
    }
    nextEl.textContent = text;

    // Bottom card: remaining distance, time and arrival clock.
    $('#guide-dist').textContent = fmtDist(t.remaining);
    const v = S.pos.speed;
    if (v && v > 1) {
      const ms = t.remaining / v * 1000, at = new Date(Date.now() + ms);
      $('#guide-eta').textContent = `${fmtDurShort(ms)} · ${X('وصول', 'arrive')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    } else $('#guide-eta').textContent = '';
    $('#guide-brg').textContent = `${Math.round(t.brg)}°`;
    $('#guide-card').textContent = X(cardinal(t.brg, 'ar'), cardinal(t.brg, 'en').toUpperCase());

    // Arrow: relative to where the phone/vehicle points when heading is known.
    const rel = S.heading != null ? angleDiff(t.brg, S.heading) : t.brg;
    $('#guide-arrow').style.transform = `rotate(${rel}deg)`;
    const off = t.mode === 'track' && t.offTrack > 80;
    noteEl.textContent = off ? `${X('⚠️ خارج المسار بـ ', '⚠️ Off route by ')}${fmtDist(t.offTrack)}`
      : (S.heading == null ? 'السهم بالنسبة للشمال — تحرّك أو فعّل البوصلة' : '');
    noteEl.classList.toggle('warn', off);

    const kindEl = $('#guide-kind');
    if (kind) {
      kindEl.textContent = kind === 'road' ? 'معبّد' : kind === 'offroad' ? 'غير معبّد · مسار محفوظ' : 'غير معبّد · مباشر';
      kindEl.classList.toggle('off', kind !== 'road');
      kindEl.hidden = false;
    } else kindEl.hidden = true;
  }
};

/** Text of a plan step in 'ar' or 'en' (older saved plans keep their Arabic text). */
function stepLabel(st, lang, forVoice) {
  lang = lang || LG.ui;
  if (st.m) return Router.stepText({ maneuver: st.m, name: st.nm }, lang, forVoice);
  const nm = Voice.nm(st.to, lang);
  if (st.sp === 'off') return lang === 'en' ? 'Enter the unpaved section — follow the saved track' : 'ادخل غير المعبّد — اتبع المسار المحفوظ';
  if (st.sp === 'direct') return lang === 'en' ? 'End of the paved road — head straight to the destination' : 'نهاية الطريق المعبّد — اتجه مباشرة نحو الوجهة';
  if (st.sp === 'arrive') return lang === 'en' ? 'Arrive' + (nm ? ' at ' + nm : ' at your destination') : 'الوصول إلى ' + (st.to || '');
  return st.text || '';
}

/* =====================================================================
 * §10a VOICE — spoken guidance (Web Speech API, works offline)
 * ---------------------------------------------------------------------
 * The voice language (ar/en) is independent of the app language. iOS only
 * allows speech after a user gesture, so the first tap unlocks it. Voices
 * come from the phone (iPhone: Settings → Accessibility → Spoken Content
 * → Voices). Output goes through whatever audio route is active, e.g. the
 * car's Bluetooth / CarPlay audio.
 * Announcements: route start, each turn (≈1 km, ≈300 m, "now"), entering
 * the unpaved part, off-route / back on route, remaining-distance
 * milestones, "destination is on your left/right", arrival.
 * ===================================================================== */
const Voice = {
  voices: [], warned: false, unlocked: false, lastText: '', lastLang: 'ar',

  supported() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; },

  init() {
    if (!this.supported()) return;
    const load = () => { this.voices = speechSynthesis.getVoices() || []; this.refreshUI(); };
    load();
    if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', load);
    const unlock = () => { this.unlock(); document.removeEventListener('pointerdown', unlock, true); };
    document.addEventListener('pointerdown', unlock, true);
  },

  /** A silent utterance inside a tap unlocks speech on iOS. */
  unlock() {
    if (this.unlocked || !this.supported()) return;
    this.unlocked = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
  },

  /** Best installed voice for 'ar' / 'en' (prefers ar-SA / en-US). */
  pick(lang) {
    const base = lang === 'en' ? 'en' : 'ar';
    const list = this.voices.filter(v => (v.lang || '').toLowerCase().replace('_', '-').startsWith(base));
    if (!list.length) return null;
    const pref = base === 'ar' ? ['ar-sa'] : ['en-us', 'en-gb'];
    for (const pl of pref) { const v = list.find(x => x.lang.toLowerCase().replace('_', '-') === pl); if (v) return v; }
    return list[0];
  },

  /** Speak `text`. urgent = interrupt what is being said (turn "now", off-route, arrival). */
  say(text, opt = {}) {
    if (!text || !this.supported() || (!S.settings.voiceOn && !opt.force)) return false;
    const lang = opt.lang || S.settings.voiceLang || 'ar';
    this.lastText = text; this.lastLang = lang;
    if (!opt.urgent && speechSynthesis.pending) return false;           // do not pile up stale messages
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pick(lang);
    if (v) u.voice = v;
    u.lang = v ? v.lang : (lang === 'en' ? 'en-US' : 'ar-SA');
    u.volume = Math.max(0.1, Math.min(1, +S.settings.voiceVol || 1));
    u.rate = lang === 'en' ? 1 : 0.95;
    if (!v && this.voices.length && !this.warned) {
      this.warned = true;
      UI.toast('لا يوجد صوت متاح على الجهاز للغة المختارة — من الآيفون: الإعدادات ← إمكانية الوصول ← المحتوى المنطوق ← الأصوات', 8000);
    }
    const go = () => { try { speechSynthesis.resume(); speechSynthesis.speak(u); } catch (e) {} };
    if (opt.urgent) { try { speechSynthesis.cancel(); } catch (e) {} setTimeout(go, 70); } else go();
    return true;
  },

  repeat() { if (this.lastText) this.say(this.lastText, { lang: this.lastLang, urgent: true }); },

  /* ----- phrase helpers ----- */
  /** Spoken distance, rounded: "300 متر" / "1.5 كيلومتر" / "300 meters". */
  dist(m, lang) {
    const en = lang === 'en';
    if (m < 1000) {
      const r = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
      return en ? `${r} meters` : `${r} متر`;
    }
    const k = Math.round(m / 100) / 10;
    return en ? `${k} ${k === 1 ? 'kilometer' : 'kilometers'}` : `${k} ${k === 1 ? 'كيلومتر' : 'كيلومتر'}`;
  },
  /** Names written in Arabic are not read by an English voice. */
  nm(name, lang) { return (name && !(lang === 'en' && /[؀-ۿ]/.test(name))) ? name : ''; },

  /** Announce the start of guidance. */
  onStart(t) {
    t.v = null;
    const lang = S.settings.voiceLang, nm = this.nm(t.name, lang);
    const d = t.remaining != null ? t.remaining : (S.pos ? haversine(S.pos.lat, S.pos.lon, t.lat, t.lon) : null);
    const ds = d != null ? this.dist(d, lang) : '';
    this.say(lang === 'en'
      ? `Navigation started${nm ? ' to ' + nm : ''}.${ds ? ' Distance ' + ds + '.' : ''}`
      : `بدأ التوجيه إلى ${nm}.${ds ? ' المسافة ' + ds + '.' : ''}`, { urgent: true });
  },

  onArrive(t) {
    const lang = S.settings.voiceLang, nm = this.nm(t.name, lang);
    this.say(lang === 'en' ? `You have arrived${nm ? ' at ' + nm : ''}.` : `وصلت إلى ${nm}.`, { urgent: true });
  },

  onUnpaved() {
    const lang = S.settings.voiceLang;
    this.say(lang === 'en' ? 'Entering the unpaved section.' : 'دخلت الطريق غير المعبّد.');
  },

  /** Called on every GPS fix while guiding. */
  tick(t) {
    if (!S.settings.voiceOn || !this.supported() || !S.pos) return;
    const lang = S.settings.voiceLang, en = lang === 'en', now = Date.now();
    const v = t.v || (t.v = { done: {}, first: true, offN: 0, offAt: 0, offOn: false, remDone: {}, dirN: 0, dirAt: 0 });
    const speed = Math.max(0, S.pos.speed || 0);
    const off = t.mode === 'track' && t.offTrack != null ? t.offTrack : 0;

    // 1. Off route / back on route.
    if (t.mode === 'track') {
      if (off > 100) v.offN++; else v.offN = 0;
      if (v.offN >= 3 && (!v.offOn || now - v.offAt > 45000) && !Guide.arrived) {
        v.offOn = true; v.offAt = now;
        const d = this.dist(off, lang);
        this.say(en ? `You are off route by ${d}.` : `ابتعدت عن المسار بمقدار ${d}.`, { urgent: true });
      } else if (v.offOn && off < 50) {
        v.offOn = false;
        this.say(en ? 'Back on route.' : 'عدت إلى المسار.', { urgent: true });
      }
    }

    // 2. Turns (planned routes). far ≈1 km, near ≈ 20 s ahead (200–450 m), now ≈ 40 m.
    if (t.steps && t.along != null && off < 150) {
      const k = t.steps.findIndex(s => s.along > t.along - 20 && !(s.m && s.m.type === 'depart'));
      if (k >= 0) {
        const st = t.steps[k], d = st.along - t.along;
        const prev = k > 0 ? t.steps[k - 1].along : 0;
        const special = !!st.sp && st.sp !== 'arrive';
        const stages = special
          ? [['n', 200], ['w', 40]]
          : [['f', (st.along - prev) > 1300 ? 1000 : -1], ['n', Math.min(450, Math.max(200, speed * 20))], ['w', Math.max(40, speed * 3)]];
        const crossed = stages.filter(([id, thr]) => thr > 0 && d <= thr && !v.done[k + id]);
        crossed.forEach(([id]) => { v.done[k + id] = 1; });
        if (crossed.length && !v.first) {
          const last = crossed[crossed.length - 1][0];
          const instr = stepLabel(st, lang, true);
          const msg = last === 'w' ? instr : (en ? `In ${this.dist(d, lang)}: ${instr}` : `بعد ${this.dist(d, lang)}: ${instr}`);
          this.say(msg, { urgent: last === 'w' });
        }
      }
    }

    // 3. Remaining-distance milestones (tracks and direct points; fewer for planned routes).
    if (t.remaining != null) {
      const ms = t.isPlan ? [5000, 2000, 1000] : [10000, 5000, 2000, 1000, 500, 200];
      let say = null;
      for (const m of ms) if (t.remaining <= m && !v.remDone[m]) { v.remDone[m] = 1; say = m; }
      if (say && !v.first && !Guide.arrived) {
        const d = this.dist(t.remaining, lang);
        this.say(en ? `${d} remaining.` : `المتبقي ${d}.`);
      }
    }

    // 4. Direct-to-point: tell where the destination is when the heading is clearly off.
    if (t.mode === 'point' && S.heading != null && speed > 3 && !Guide.arrived) {
      const rel = angleDiff(t.brg, S.heading);
      if (Math.abs(rel) > 50) v.dirN++; else v.dirN = 0;
      if (v.dirN >= 4 && now - v.dirAt > 25000) {
        v.dirAt = now; v.dirN = 0;
        const side = Math.abs(rel) > 130 ? (en ? 'behind you' : 'خلفك') : rel > 0 ? (en ? 'to your right' : 'على يمينك') : (en ? 'to your left' : 'على يسارك');
        this.say(en ? `The destination is ${side}.` : `الوجهة ${side}.`);
      }
    }
    v.first = false;
  },

  toggle() {
    S.settings.voiceOn = !S.settings.voiceOn;
    saveSettings();
    if (!S.settings.voiceOn && this.supported()) { try { speechSynthesis.cancel(); } catch (e) {} }
    this.refreshUI();
    UI.toast(S.settings.voiceOn ? '🔊 التوجيه الصوتي: تشغيل' : '🔇 التوجيه الصوتي: إيقاف');
  },

  test() {
    this.unlock();
    const lang = S.settings.voiceLang;
    this.say(lang === 'en' ? 'Voice test. Voice guidance is working.' : 'اختبار الصوت. التوجيه الصوتي يعمل.', { urgent: true, force: true });
  },

  refreshUI() {
    const b = $('#guide-voice');
    if (b) b.textContent = S.settings.voiceOn ? '🔊' : '🔇';
    const h = $('#voice-hint');
    if (h) {
      if (!this.supported()) h.textContent = X('هذا المتصفح لا يدعم الصوت', 'This browser does not support speech');
      else if (this.voices.length && !this.pick(S.settings.voiceLang))
        h.textContent = X('لا يوجد صوت لهذه اللغة على الجهاز — الإعدادات ← إمكانية الوصول ← المحتوى المنطوق ← الأصوات', 'No voice installed for this language — Settings → Accessibility → Spoken Content → Voices');
      else h.textContent = '';
    }
  }
};

/* =====================================================================
 * §10b ROUTER — paved-road routing + unpaved continuation
 * ---------------------------------------------------------------------
 * Paved part: OSRM routing service (OpenStreetMap roads, car profile —
 * desert tracks are not routable, so the result stays on real roads).
 * Needs internet ONCE: the computed plan is stored on the device and
 * can be started later with no connection.
 * Unpaved part: if the destination is the END of a saved track (e.g. the
 * camp route), the road route goes to that track's START and the saved
 * track is followed from there. Otherwise a direct line joins the last
 * road point to the destination. Without internet the road part is
 * replaced by a direct line (still useful as a bearing).
 * ===================================================================== */
const Router = {
  MOD: {
    right: 'يميناً', left: 'يساراً', 'slight right': 'قليلاً لليمين', 'slight left': 'قليلاً لليسار',
    'sharp right': 'بحدة لليمين', 'sharp left': 'بحدة لليسار', straight: 'مباشرة', uturn: 'للخلف'
  },

  MOD_EN: {
    right: 'right', left: 'left', 'slight right': 'slightly right', 'slight left': 'slightly left',
    'sharp right': 'sharply right', 'sharp left': 'sharply left', straight: 'straight', uturn: 'around'
  },

  /** Instruction from an OSRM-like step {maneuver:{type,modifier,exit}, name}, in 'ar' or 'en'.
   *  forVoice drops Arabic road names from English speech (an English voice cannot read them). */
  stepText(st, lang = 'ar', forVoice = false) {
    const m = st.maneuver || {};
    let nm = st.name || '';
    if (lang === 'en') {
      if (forVoice && /[\u0600-\u06FF]/.test(nm)) nm = '';
      const mod = this.MOD_EN[m.modifier] || '';
      const on = nm ? ` onto ${nm}` : '';
      if (m.modifier === 'uturn') return 'Make a U-turn' + on;
      switch (m.type) {
        case 'depart': return 'Head out' + (nm ? ` on ${nm}` : '');
        case 'arrive': return 'End of the paved road';
        case 'roundabout': case 'rotary': case 'roundabout turn':
          return (m.exit ? `At the roundabout take exit ${m.exit}` : 'Enter the roundabout') + on;
        case 'exit roundabout': case 'exit rotary': return 'Exit the roundabout' + on;
        case 'merge': return `Merge ${mod}`.trim() + on;
        case 'on ramp': return `Take the ramp ${mod}`.trim() + on;
        case 'off ramp': return `Take the exit ${mod}`.trim() + on;
        case 'fork': return `Keep ${mod || 'straight'} at the fork`.trim() + on;
        case 'end of road': return `At the end of the road turn ${mod}`.trim() + on;
        case 'continue': case 'new name': return `Continue ${mod || 'straight'}` + on;
        default: return (m.modifier === 'straight' ? 'Continue straight' : `Turn ${mod}`.trim()) + on;
      }
    }
    const mod = this.MOD[m.modifier] || '';
    const name = nm ? ` — ${nm}` : '';
    if (m.modifier === 'uturn') return 'استدر للخلف' + name;
    switch (m.type) {
      case 'depart': return 'انطلق' + name;
      case 'arrive': return 'نهاية الطريق المعبّد';
      case 'roundabout': case 'rotary': case 'roundabout turn':
        return `في الدوّار خذ المخرج ${m.exit || ''}`.trim() + name;
      case 'exit roundabout': case 'exit rotary': return 'اخرج من الدوّار' + name;
      case 'merge': return `اندمج ${mod}`.trim() + name;
      case 'on ramp': return `خذ المدخل ${mod}`.trim() + name;
      case 'off ramp': return `خذ المخرج ${mod}`.trim() + name;
      case 'fork': return `خذ التفرّع ${mod}`.trim() + name;
      case 'end of road': return `في نهاية الطريق انعطف ${mod}`.trim() + name;
      case 'continue': case 'new name': return `استمر ${mod || 'مباشرة'}` + name;
      default: return (m.modifier === 'straight' ? 'استمر مباشرة' : `انعطف ${mod}`.trim()) + name;
    }
  },

  /** Ask OSRM for a driving route a → b. Throws when offline / no route. */
  async osrm(a, b) {
    const url = `${ROUTER_URL}${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}` +
                '?overview=full&geometries=geojson&steps=true';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.message || 'لا يوجد طريق');
      const rt = j.routes[0];
      let acc = 0;
      const steps = [];
      for (const st of (rt.legs[0] && rt.legs[0].steps) || []) {
        const mv = st.maneuver || {};
        steps.push({ rel: acc, text: this.stepText(st), type: mv.type,
                     m: { type: mv.type, modifier: mv.modifier, exit: mv.exit }, nm: st.name || '' });
        acc += st.distance;
      }
      return {
        pts: rt.geometry.coordinates.map(c => [c[1], c[0]]),
        distance: rt.distance, duration: rt.duration, steps,
        snapStart: j.waypoints[0].distance || 0, snapEnd: j.waypoints[1].distance || 0
      };
    } finally { clearTimeout(timer); }
  },

  /** A saved track whose END is at the destination (≤ 80 m) → used for the unpaved approach. */
  findApproachTrack(dest) {
    let best = null, bestD = 80;
    for (const t of S.tracks) {
      const ls = t.segments[t.segments.length - 1], e = ls[ls.length - 1];
      const d = haversine(dest.lat, dest.lon, e[0], e[1]);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  },

  /** Minimum distance (m) from a point to a polyline (segment projection). */
  distToPath(p, pts) {
    const kx = 111320 * Math.cos(toRad(p.lat)), ky = 110574;
    let best = Infinity, idx = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = (pts[i][1] - p.lon) * kx, ay = (pts[i][0] - p.lat) * ky;
      const bx = (pts[i + 1][1] - p.lon) * kx, by = (pts[i + 1][0] - p.lat) * ky;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const f = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const d = Math.hypot(ax + f * dx, ay + f * dy);
      if (d < best) { best = d; idx = i; }
    }
    return { d: best, idx };
  },

  /**
   * Build a plan from → to.
   * Returns { name, pts, segKind, steps, parts:[{kind, pts}], roadM, offM, durationS, online, created }.
   */
  async plan(from, to) {
    const approach = to.noApproach ? null : (to.trackId ? S.tracks.find(t => t.id === to.trackId) : this.findApproachTrack(to));
    let offPts = approach ? approach.segments.flat().map(p => [p[0], p[1]]) : null;
    const parts = [];
    const osrmSteps = [];
    let online = true, roadDuration = 0;

    // Already inside / next to the unpaved route? Follow it from the nearest point.
    if (offPts) {
      const near = this.distToPath(from, offPts);
      if (near.d < 300) {
        offPts = offPts.slice(near.idx);
        parts.push({ kind: 'direct', pts: [[from.lat, from.lon], offPts[0]] });
        parts.push({ kind: 'offroad', pts: offPts });
        return this.finish(from, to, parts, osrmSteps, true, 0, approach);
      }
    }

    const roadGoal = offPts ? { lat: offPts[0][0], lon: offPts[0][1] } : to;
    let road = null;
    try { road = await this.osrm(from, roadGoal); }
    catch (e) { online = false; console.warn('routing failed', e); }

    if (road && road.pts.length > 1) {
      roadDuration = road.duration;
      if (road.snapStart > 40) parts.push({ kind: 'direct', pts: [[from.lat, from.lon], road.pts[0]] });
      parts.push({ kind: 'road', pts: road.pts, steps: road.steps });
      const end = road.pts[road.pts.length - 1];
      const gapTo = offPts ? offPts[0] : [to.lat, to.lon];
      if (haversine(end[0], end[1], gapTo[0], gapTo[1]) > 40) parts.push({ kind: 'direct', pts: [end, gapTo] });
    } else {
      parts.push({ kind: 'direct', pts: [[from.lat, from.lon], offPts ? offPts[0] : [to.lat, to.lon]] });
    }
    if (offPts) parts.push({ kind: 'offroad', pts: offPts });
    return this.finish(from, to, parts, osrmSteps, online, roadDuration, approach);
  },

  /** Concatenate parts into one path with per-segment kind and absolute-distance steps. */
  finish(from, to, parts, _unused, online, roadDuration, approach) {
    const pts = [], segKind = [], steps = [];
    let along = 0, roadM = 0, offM = 0;
    parts.forEach((part, pi) => {
      const startAlong = along;
      for (const p of part.pts) {
        if (pts.length) {
          const q = pts[pts.length - 1];
          if (q[0] === p[0] && q[1] === p[1]) continue;
          const d = haversine(q[0], q[1], p[0], p[1]);
          along += d;
          if (part.kind === 'road') roadM += d; else offM += d;
          segKind.push(part.kind);
        }
        pts.push([p[0], p[1]]);
      }
      // Instructions for this part.
      if (part.kind === 'road' && part.steps) {
        for (const s of part.steps) {
          if (s.type === 'arrive' && pi < parts.length - 1) continue;   // replaced below
          steps.push({ along: startAlong + s.rel, text: s.text, kind: 'road', m: s.m, nm: s.nm });
        }
      } else if (part.kind === 'offroad') {
        steps.push({ along: startAlong, text: 'ادخل غير المعبّد — اتبع المسار المحفوظ', kind: 'offroad', sp: 'off' });
      } else if (part.kind === 'direct' && pi > 0) {
        steps.push({ along: startAlong, text: 'نهاية الطريق المعبّد — اتجه مباشرة نحو الوجهة', kind: 'direct', sp: 'direct' });
      }
    });
    steps.push({ along, text: 'الوصول إلى ' + to.name, kind: segKind[segKind.length - 1] || 'road', sp: 'arrive', to: to.name });
    steps.sort((a, b) => a.along - b.along);
    return {
      name: to.name, from: { lat: from.lat, lon: from.lon, name: from.name }, to: { lat: to.lat, lon: to.lon, name: to.name },
      pts, segKind, steps, parts: parts.map(p => ({ kind: p.kind, pts: p.pts })),
      roadM, offM, durationS: roadDuration + offM / (OFFROAD_KMH / 3.6), online, created: Date.now()
    };
  }
};

/* =====================================================================
 * §10c PLAN SHEET — choose «من / إلى», compute, start
 * ===================================================================== */
const PlanUI = {
  result: null,

  /** Options for the «من» and «إلى» selects. */
  options(isFrom) {
    const o = [];
    if (isFrom) o.push(['me', '📡 موقعي الحالي']);
    const wps = [...S.waypoints].filter(w => w.region !== REGION_REF)
      .sort((a, b) => regionRank(a.region || REGION_MINE) - regionRank(b.region || REGION_MINE)
        || (a.region || '').localeCompare(b.region || '', 'ar') || a.name.localeCompare(b.name, 'ar'));
    let lastRegion = null;
    for (const w of wps) {
      const r = w.region || REGION_MINE;
      if (r !== lastRegion) { o.push(['__group', r]); lastRegion = r; }
      const c = CATS[w.cat] || CATS.other;
      const withTrack = !isFrom && Router.findApproachTrack(w) ? ' (مع مسار غير معبّد)' : '';
      o.push(['wp:' + w.id, `${c.icon} ${w.name}${withTrack}${w.verified === false ? ' · غير موثّق' : ''}`]);
    }
    for (const t of S.tracks) {
      if (!isFrom) o.push(['trkend:' + t.id, `🏁 نهاية: ${t.name}`]);
      o.push(['trkstart:' + t.id, `🟢 بداية: ${t.name}`]);
    }
    o.push(['center', '✛ مركز الشاشة']);
    o.push(['coord', '⌨ إحداثيات / رابط خرائط جوجل']);
    // '__group' rows become <optgroup> headers (region names).
    let html = '', open = false;
    for (const [v, l] of o) {
      if (v === '__group') { html += (open ? '</optgroup>' : '') + `<optgroup label="${escapeHtml(l)}">`; open = true; continue; }
      if (open && !v.startsWith('wp:')) { html += '</optgroup>'; open = false; }
      html += `<option value="${v}">${escapeHtml(l)}</option>`;
    }
    return html + (open ? '</optgroup>' : '');
  },

  open(toKey, autoCalc, toCoordText) {
    $('#plan-from').innerHTML = this.options(true);
    $('#plan-to').innerHTML = this.options(false);
    if (!S.pos) $('#plan-from').value = 'center';
    if (toCoordText) $('#plan-to-coord').value = toCoordText;
    if (toKey) $('#plan-to').value = toKey;
    else {
      // Default destination: a waypoint that ends a saved track (e.g. the camp), else the first one.
      const w = S.waypoints.find(x => Router.findApproachTrack(x));
      if (w) $('#plan-to').value = 'wp:' + w.id;
    }
    this.syncCoordFields();
    this.result = null;
    $('#plan-summary').hidden = true;
    $('#plan-go').disabled = true;
    $('#plan-last').hidden = !S.lastPlan;
    if (S.lastPlan) $('#plan-last').textContent = `↺ آخر مسار محسوب: ${S.lastPlan.name} (يعمل دون اتصال)`;
    UI.openSheet('sheet-plan');
    if (autoCalc) this.calc();
  },

  syncCoordFields() {
    $('#plan-from-coord-wrap').hidden = $('#plan-from').value !== 'coord';
    $('#plan-to-coord-wrap').hidden = $('#plan-to').value !== 'coord';
  },

  /** Turn a select value into {lat, lon, name, trackId?, noApproach?}. */
  resolve(key, coordInput) {
    if (key === 'me') return S.pos ? { lat: S.pos.lat, lon: S.pos.lon, name: 'موقعي' } : null;
    if (key === 'center') { const c = MapView.viewCenter(); return { ...c, name: 'مركز الشاشة' }; }
    if (key === 'coord') {
      const p = parsePair($(coordInput).value);
      return p ? { ...p, name: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` } : null;
    }
    const [type, id] = key.split(':');
    if (type === 'wp') { const w = S.waypoints.find(x => x.id === id); return w && { lat: w.lat, lon: w.lon, name: w.name }; }
    const t = S.tracks.find(x => x.id === id);
    if (!t) return null;
    if (type === 'trkend') {
      const ls = t.segments[t.segments.length - 1], e = ls[ls.length - 1];
      return { lat: e[0], lon: e[1], name: 'نهاية ' + t.name, trackId: t.id };
    }
    const s = t.segments[0][0];
    return { lat: s[0], lon: s[1], name: 'بداية ' + t.name, noApproach: true };
  },

  async calc() {
    const from = this.resolve($('#plan-from').value, '#plan-from-coord');
    const to = this.resolve($('#plan-to').value, '#plan-to-coord');
    if (!from) { UI.toast($('#plan-from').value === 'me' ? 'لا توجد إشارة GPS بعد — اختر نقطة بداية أخرى' : 'إحداثيات البداية غير صحيحة'); return; }
    if (!to) { UI.toast('إحداثيات الوجهة غير صحيحة'); return; }
    const sum = $('#plan-summary');
    sum.hidden = false;
    sum.innerHTML = 'جارٍ حساب المسار…';
    $('#plan-calc').disabled = true;
    try {
      const plan = await Router.plan(from, to);
      this.result = plan;
      S.lastPlan = plan;
      Store.kvSet('lastPlan', plan).catch(() => {});
      sum.innerHTML =
        `<div>الطول: <b class="ltr">${fmtDist(plan.roadM + plan.offM)}</b> · الوقت التقريبي: <b class="ltr">${fmtDuration(plan.durationS * 1000)}</b></div>` +
        `<div><i class="lg road"></i> معبّد: <span class="ltr">${fmtDist(plan.roadM)}</span> &nbsp; <i class="lg off"></i> غير معبّد: <span class="ltr">${fmtDist(plan.offM)}</span></div>` +
        (plan.online ? '<div class="warn">✓ حُفظ المسار على الجهاز — يمكن بدء الملاحة لاحقاً دون اتصال.</div>'
                     : '<div class="warn">⚠️ تعذّر الاتصال بخدمة الطرق — الجزء المعبّد مرسوم كخط مباشر. أعد الحساب عند توفر الإنترنت.</div>');
      $('#plan-go').disabled = false;
    } catch (e) {
      sum.innerHTML = '<div class="warn">تعذّر حساب المسار: ' + escapeHtml(e.message) + '</div>';
    } finally {
      $('#plan-calc').disabled = false;
    }
  },

  go() {
    if (!this.result) return;
    Guide.setPlan(this.result);
    setFollow(true);
  },

  last() { if (S.lastPlan) { Guide.setPlan(S.lastPlan); setFollow(true); } }
};

/* =====================================================================
 * §11 MAP VIEW — Leaflet (online tiles + cached offline tiles)
 * ===================================================================== */
const MapView = {
  map: null,
  base: null,
  me: null, acc: null,
  recLine: null, guideLine: null, targetMk: null,
  wpLayer: null, trkLayer: null, regionLayer: null,
  tileOk: 0, tileErr: 0, _fallbackTimer: null,
  firstFix: true,

  available() { return typeof window.L !== 'undefined' && !!this.map; },

  init() {
    if (typeof window.L === 'undefined') return false;   // Leaflet not cached yet
    this.map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lon],
      zoom: 6,
      maxZoom: 19,
      worldCopyJump: true,
      tap: false,
      // leaflet-rotate: the map turns with the direction of travel (compass button)
      rotate: true, bearing: 0, touchRotate: false, shiftKeyRotate: false,
      rotateControl: false, compassBearing: false
    });
    this.map.attributionControl.setPrefix(false);
    this.map.attributionControl.setPosition('bottomleft');   // under the FABs

    this.regionLayer = L.layerGroup().addTo(this.map);
    this.trkLayer = L.layerGroup().addTo(this.map);
    this.planLayer = L.layerGroup().addTo(this.map);
    this.recLine = L.polyline([], { color: LINE.rec.color, weight: LINE.rec.weight, opacity: .95 }).addTo(this.map);
    this.guideLine = L.polyline([], { color: '#ffd54f', weight: 3, dashArray: '10 8', interactive: false }).addTo(this.map);
    this.wpLayer = L.layerGroup().addTo(this.map);

    this.setLayer(S.settings.layer, true);

    // Manual dragging disables follow mode.
    this.map.on('dragstart', () => setFollow(false));
    // Long-press (iOS/Android) or right-click: drop a pin there.
    this.map.on('contextmenu', e => Place.openPin(e.latlng.lat, e.latlng.lng));
    // Reset tile counters each time the view changes (for radar fallback).
    this.map.on('movestart zoomstart', () => { this.tileOk = 0; this.tileErr = 0; });
    // Markers scale with zoom (small when zoomed out, full size up close).
    this.map.on('zoomend', () => this.scaleMarkers());
    this.scaleMarkers();
    return true;
  },

  /**
   * Build the layer stack (bottom → top). Fallback layers are CACHE-ONLY
   * (URL marker ?co=1 → sw.js never touches the network for them):
   *   1. coarse all-Saudi terrain (zoom ≤ 9, stretched when zoomed in)
   *   2. the other detailed layer (terrain under satellite, or satellite
   *      under terrain/streets) — fills single missing tiles
   *   3. the selected layer (network + cache)
   * Missing tiles of an upper layer are transparent, so the best image
   * available on the device always shows through.
   */
  makeLayer(key, { cacheOnly = false, maxNative, zIndex }) {
    const def = LAYERS[key];
    const url = def.url + (cacheOnly ? '?co=1' : '');
    const layer = L.tileLayer(url, {
      subdomains: def.subs || 'abc',
      maxNativeZoom: maxNative || def.maxNative,
      maxZoom: 19,
      attribution: cacheOnly ? '' : def.attr,
      errorTileUrl: TRANSPARENT_PX,    // never show broken gray tiles
      keepBuffer: 3,
      updateWhenIdle: true,
      zIndex
    });
    // A real image counts as "loaded"; the transparent error pixel does not.
    layer.on('tileload', e => { if (!String(e.tile.src).startsWith('data:')) this.tileOk++; });
    layer.on('tileerror', () => { if (!cacheOnly) { this.tileErr++; this.scheduleFallbackCheck(); } });
    return layer.addTo(this.map);
  },

  /** Switch base layer (and rebuild the fallback stack). */
  setLayer(key, silent) {
    if (key === 'vec') return this.setVectorLayer(silent);
    if (!LAYERS[key]) key = 'sat';
    for (const l of [this.base, this.fb, this.bg, this.bgSat, this.vec]) if (l) this.map.removeLayer(l);
    this.vec = null;
    // Bottom → top: Kingdom terrain (z≤9), Kingdom satellite (z≤11), other detailed layer, selected layer.
    this.bg = this.makeLayer(BG_LAYER, { cacheOnly: true, maxNative: BG_MAX_ZOOM, zIndex: 1 });
    this.bgSat = this.makeLayer('sat', { cacheOnly: true, maxNative: BG_SAT_MAX_ZOOM, zIndex: 2 });
    this.fb = this.makeLayer(key === 'sat' ? 'topo' : 'sat', { cacheOnly: true, zIndex: 3 });
    this.base = this.makeLayer(key, { zIndex: 4 });
    S.settings.layer = key;
    saveSettings();
    updateLayerCards();
    if (!silent) UI.toast('الخريطة: ' + LAYERS[key].name);
  },

  /** Offline vector map of the whole Kingdom (roads, names, villages). */
  async setVectorLayer(silent) {
    const layer = await Vector.makeLayer();
    if (!layer) {
      UI.toast('الخريطة الرسومية غير محفوظة بعد — نزّلها من «حفظ المنطقة»', 4500);
      if (S.settings.layer === 'vec') { S.settings.layer = 'sat'; saveSettings(); }
      if (!this.base) this.setLayer('sat', true);
      updateLayerCards();
      return;
    }
    for (const l of [this.base, this.fb, this.bg, this.bgSat, this.vec]) if (l) this.map.removeLayer(l);
    this.base = this.fb = this.bg = this.bgSat = null;
    this.vec = layer.addTo(this.map);
    S.settings.layer = 'vec';
    saveSettings();
    updateLayerCards();
    if (!silent) UI.toast('الخريطة: رسومية (بدون إنترنت)');
  },

  /**
   * If tiles keep failing and none load (no signal + area not downloaded),
   * switch to the radar automatically instead of showing an empty map.
   */
  scheduleFallbackCheck() {
    clearTimeout(this._fallbackTimer);
    this._fallbackTimer = setTimeout(() => {
      if (S.view === 'map' && S.settings.autoRadar && this.tileErr >= 3 && this.tileOk === 0) {
        // Prefer the offline vector map when it is saved; radar otherwise.
        if (S.settings.layer !== 'vec' && Vector.hasData) {
          this.setLayer('vec', true);
          UI.toast('🗺️ لا توجد صور محفوظة هنا — تم التحويل للخريطة الرسومية', 4500);
          return;
        }
        setView('radar', true);
        UI.toast('📡 لا توجد صور ولا تضاريس محفوظة لهذه المنطقة — تم التحويل لوضع الرادار', 4500);
      }
    }, 1500);
  },

  /** Centre of whatever the user is looking at (map or radar). */
  viewCenter() {
    if (S.view === 'radar' || !this.map) return Radar.getCenter();
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  },

  /** Update the live marker & accuracy circle; follow if enabled. */
  onPos() {
    if (!this.map || !S.pos) return;
    const ll = [S.pos.lat, S.pos.lon];
    if (!this.me) {
      this.me = L.marker(ll, {
        icon: L.divIcon({ className: '', html: '<div class="me no-heading"><div class="me-cone"></div><div class="me-dot"></div></div>', iconSize: [70, 70], iconAnchor: [35, 35] }),
        interactive: false, zIndexOffset: 1000, keyboard: false
      }).addTo(this.map);
      this.acc = L.circle(ll, { radius: S.pos.acc, color: '#1a73e8', weight: 1, fillOpacity: .1, interactive: false }).addTo(this.map);
    } else {
      this.me.setLatLng(ll);
      this.acc.setLatLng(ll).setRadius(S.pos.acc);
    }
    if (S.follow && S.view === 'map') {
      if (this.firstFix) { this.map.setView(ll, 15, { animate: false }); this.firstFix = false; }
      else this.map.panTo(ll, { animate: true, duration: .4 });
    }
  },

  /** Screen rotation of the map in degrees (0 = north up). */
  // leaflet-rotate turns the map content clockwise by its bearing, so the
  // direction shown at the top of the screen is -bearing.
  screenRot() { return this.map && this.map.getBearing ? -this.map.getBearing() : 0; },

  /** Heading-up: keep the direction of travel pointing up (like Google Maps). */
  applyBearing() {
    if (!this.map || !this.map.setBearing) return;
    const want = (S.settings.headingUp && S.heading != null) ? S.heading : 0;   // direction to show at the top
    if (Math.abs(angleDiff(want, this.screenRot())) >= 2) this.map.setBearing((360 - want) % 360);
  },

  /** Rotate the heading cone on the live marker. */
  updateHeading() {
    this.applyBearing();
    if (!this.me) return;
    const el = this.me.getElement();
    if (!el) return;
    const me = el.firstElementChild;
    const cone = me && me.firstElementChild;
    if (!cone) return;
    me.classList.toggle('no-heading', S.heading == null);
    if (S.heading != null) cone.style.transform = `rotate(${S.heading - this.screenRot()}deg)`;
  },

  /* ---- current recording polyline ---- */
  renderRec() {
    if (!this.map) return;
    const segs = (S.rec && S.rec.segments) || [];
    this.recLine.setLatLngs(segs.filter(s => s.length).map(s => s.map(p => [p[0], p[1]])));
  },
  addRecPoint(pt) {
    if (!this.map) return;
    // Rebuild cheaply: Leaflet handles multi-polylines as nested arrays.
    this.renderRec();
  },

  /* ---- saved / imported tracks ---- */
  renderTracks() {
    Radar.draw();
    if (!this.map) return;
    this.trkLayer.clearLayers();
    for (const t of S.tracks) {
      if (!t.visible) continue;
      const latlngs = t.segments.map(s => s.map(p => [p[0], p[1]]));
      const st = t.imported ? LINE.imported : LINE.saved;
      L.polyline(latlngs, { color: st.color, weight: st.weight, opacity: .9 })
        .bindPopup(this.trackPopup(t))
        .addTo(this.trkLayer);
      const first = t.segments[0][0];
      const lastSeg = t.segments[t.segments.length - 1];
      const last = lastSeg[lastSeg.length - 1];
      L.marker([first[0], first[1]], { icon: L.divIcon({ className: '', html: '<div class="trk-end s"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false }).addTo(this.trkLayer);
      L.marker([last[0], last[1]], { icon: L.divIcon({ className: '', html: '<div class="trk-end e"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false }).addTo(this.trkLayer);
    }
  },

  trackPopup(t) {
    return `<b>${escapeHtml(t.name)}</b><br><span class="ltr">${fmtDist(t.distance)}</span>
      <div class="pop-actions">
        <button class="btn btn-sm" data-act="trk-follow" data-id="${t.id}">اتبع المسار</button>
        <button class="btn btn-sm" data-act="trk-back" data-id="${t.id}">عودة على الأثر</button>
        <button class="btn btn-sm" data-act="trk-start" data-id="${t.id}">إلى البداية</button>
      </div>`;
  },

  /* ---- waypoints ---- */
  scaleMarkers() {
    const z = this.map.getZoom();
    const k = Math.max(0.5, Math.min(1.15, 0.5 + (z - 5) * 0.075));   // z5 → 0.5 … z14+ → ~1.15
    const el = this.map.getContainer();
    el.style.setProperty('--mk', k.toFixed(2));
    el.classList.toggle('mk-nolabel', z < 9);                           // hide names when far out
  },

  renderWaypoints() {
    if (!this.map) return;
    this.wpLayer.clearLayers();
    for (const w of S.waypoints) {
      const c = CATS[w.cat] || CATS.other;
      L.marker([w.lat, w.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="wp-mk"><div class="wp-ico"><span>${c.icon}</span></div><div class="wp-lbl">${escapeHtml(w.name)}</div></div>`,
          iconSize: [120, 60], iconAnchor: [60, 40]
        })
      }).on('click', () => Place.openWp(w))      // Google-style info card
        .addTo(this.wpLayer);
    }
  },

  /* ---- dropped pin (long-press) ---- */
  showPin() {
    if (!this.map) return;
    if (this.pinMk) { this.map.removeLayer(this.pinMk); this.pinMk = null; }
    if (!S.pin) return;
    this.pinMk = L.marker([S.pin.lat, S.pin.lon], {
      icon: L.divIcon({ className: '', html: '<div class="drop-pin"></div>', iconSize: [28, 40], iconAnchor: [14, 40] }),
      interactive: false, zIndexOffset: 900
    }).addTo(this.map);
  },

  /* ---- downloaded regions (dashed rectangles) ---- */
  renderRegions() {
    Radar.draw();
    if (!this.map) return;
    this.regionLayer.clearLayers();
    for (const r of S.regions) {
      L.rectangle([[r.b.s, r.b.w], [r.b.n, r.b.e]], {
        color: '#10b981', weight: 1.5, dashArray: '6 6', fill: false, interactive: false
      }).addTo(this.regionLayer);
    }
  },

  /* ---- planned route: paved solid blue, unpaved dashed/dotted orange ---- */
  renderPlan() {
    Radar.draw();
    if (!this.map) return;
    this.planLayer.clearLayers();
    const t = S.target;
    if (!t || !t.parts) return;
    for (const part of t.parts) {
      const st = LINE[part.kind];
      if (part.kind === 'road') {   // dark casing under the blue line for contrast on satellite
        L.polyline(part.pts, { color: '#0b1f4d', weight: st.weight + 4, opacity: .8, interactive: false }).addTo(this.planLayer);
      }
      L.polyline(part.pts, { color: st.color, weight: st.weight, opacity: .95, dashArray: st.dash ? st.dash.join(' ') : null, interactive: false })
        .addTo(this.planLayer);
    }
    this.recLine.bringToFront();
  },

  /* ---- guidance line & target marker ---- */
  renderGuide() {
    if (!this.map) return;
    const t = S.target;
    if (!t || !S.pos) {
      this.guideLine.setLatLngs([]);
      if (this.targetMk) { this.map.removeLayer(this.targetMk); this.targetMk = null; }
      return;
    }
    this.guideLine.setLatLngs([[S.pos.lat, S.pos.lon], [t.lat, t.lon]]);
    if (!this.targetMk) {
      this.targetMk = L.marker([t.lat, t.lon], {
        icon: L.divIcon({ className: '', html: '<div class="target-mk"></div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
        interactive: false
      }).addTo(this.map);
    } else this.targetMk.setLatLng([t.lat, t.lon]);
  },

  fitPoints(latlngs) {
    if (!this.map || !latlngs.length) return;
    setFollow(false);
    this.map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 });
  },

  renderAll() {
    this.renderRegions();
    this.renderTracks();
    this.renderWaypoints();
    this.renderRec();
    this.renderPlan();
    this.renderGuide();
  }
};

/* =====================================================================
 * §12 RADAR — offline coordinate grid & tactical radar (HTML canvas)
 * ---------------------------------------------------------------------
 * Pure geometry, needs no tiles. Uses a local equirectangular projection
 * around the view centre (accurate to well under 1 % for the few tens of
 * km shown on screen):
 *     x = Δlon · 111 320 · cos(lat₀) / mpp     y = −Δlat · 110 574 / mpp
 * mpp = metres per CSS pixel (zoom). Optional heading-up rotation.
 * Gestures: one-finger drag = pan, pinch / wheel = zoom.
 * ===================================================================== */
const Radar = {
  canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
  mpp: 4,                  // metres per pixel
  center: null,            // manual centre when not following
  pointers: new Map(),
  pinch: null,
  _queued: false,

  init() {
    this.canvas = $('#radar');
    this.ctx = this.canvas.getContext('2d');
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    this.bindGestures();
    this.resize();
  },

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.W = r.width; this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.draw();
  },

  getCenter() {
    if (S.follow && S.pos) return { lat: S.pos.lat, lon: S.pos.lon };
    if (this.center) return this.center;
    if (S.pos) return { lat: S.pos.lat, lon: S.pos.lon };
    return { ...DEFAULT_CENTER };
  },

  rotation() { return S.settings.headingUp && S.heading != null ? S.heading : 0; },

  /** World (lat/lon) → pixel offset from centre (before rotation). */
  project(lat, lon, c) {
    const kx = 111320 * Math.cos(toRad(c.lat));
    return [(lon - c.lon) * kx / this.mpp, -(lat - c.lat) * 110574 / this.mpp];
  },
  /** Inverse of project(). */
  unproject(x, y, c) {
    const kx = 111320 * Math.cos(toRad(c.lat));
    return { lat: c.lat - y * this.mpp / 110574, lon: c.lon + x * this.mpp / kx };
  },

  /** World point → screen pixel (includes the heading-up rotation). */
  screenOf(lat, lon) {
    const c = this.getCenter();
    const [x, y] = this.project(lat, lon, c);
    const r = -toRad(this.rotation());
    return [this.W / 2 + x * Math.cos(r) - y * Math.sin(r), this.H / 2 + x * Math.sin(r) + y * Math.cos(r)];
  },
  /** Screen pixel → world point. */
  worldAt(sx, sy) {
    const c = this.getCenter();
    const dx = sx - this.W / 2, dy = sy - this.H / 2, r = toRad(this.rotation());
    return this.unproject(dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r), c);
  },
  /** Nearest waypoint within 26 px of a screen point, or null. */
  hitWaypoint(sx, sy) {
    let best = null, bestD = 26;
    for (const w of S.waypoints) {
      const [x, y] = this.screenOf(w.lat, w.lon);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bestD) { bestD = d; best = w; }
    }
    return best;
  },

  /** Lat/lon bounds of the visible area (used by «حفظ المنطقة»). */
  getBounds() {
    const c = this.getCenter();
    const half = Math.hypot(this.W, this.H) / 2;
    const a = this.unproject(-half, -half, c), b = this.unproject(half, half, c);
    return { n: a.lat, s: b.lat, w: a.lon, e: b.lon };
  },

  zoom(factor) {
    this.mpp = Math.min(3000, Math.max(0.25, this.mpp * factor));
    this.draw();
  },

  /** Coalesce draw requests into one animation frame. */
  draw() {
    if (S.view !== 'radar' || !this.ctx || this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => { this._queued = false; this._paint(); });
  },

  /* ---------- painting ---------- */
  _paint() {
    const { ctx, W, H, dpr } = this;
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background: dark radial gradient.
    const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, '#0a1219'); g.addColorStop(1, '#030507');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const c = this.getCenter();
    const rot = toRad(this.rotation());

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-rot);                       // heading-up: rotate the world

    this._grid(c, rot);
    this._regions(c);
    this._rings(c, rot);
    this._tracks(c);
    this._recTrack(c);
    this._guide(c);
    this._waypoints(c, rot);
    this._user(c);

    ctx.restore();
    this._hud(c, rot);
  },

  /** Lat/lon graticule with adaptive "nice" spacing and edge labels. */
  _grid(c, rot) {
    const { ctx } = this;
    const halfPx = Math.hypot(this.W, this.H) / 2;
    const latSpan = halfPx * this.mpp / 110574;
    const lonSpan = halfPx * this.mpp / (111320 * Math.cos(toRad(c.lat)));
    const steps = [0.00005, 0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
    const step = steps.find(s => (2 * latSpan) / s <= 8) || 10;
    const dec = step >= 1 ? 0 : Math.min(5, Math.ceil(-Math.log10(step)));
    const labelR = Math.min(this.W, this.H) / 2 - 14;

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(34,211,238,0.18)';
    ctx.fillStyle = 'rgba(103,232,249,0.85)';
    ctx.font = '600 11px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Parallels (constant latitude) → horizontal lines.
    for (let lat = Math.floor((c.lat - latSpan) / step) * step; lat <= c.lat + latSpan; lat += step) {
      const y = this.project(lat, c.lon, c)[1];
      ctx.beginPath(); ctx.moveTo(-halfPx, y); ctx.lineTo(halfPx, y); ctx.stroke();
      if (Math.abs(y) < labelR) this._label(`${lat.toFixed(dec)}°`, -Math.sqrt(labelR * labelR - y * y) + 26, y, rot);
    }
    // Meridians (constant longitude) → vertical lines.
    for (let lon = Math.floor((c.lon - lonSpan) / step) * step; lon <= c.lon + lonSpan; lon += step) {
      const x = this.project(c.lat, lon, c)[0];
      ctx.beginPath(); ctx.moveTo(x, -halfPx); ctx.lineTo(x, halfPx); ctx.stroke();
      if (Math.abs(x) < labelR) this._label(`${lon.toFixed(dec)}°`, x, Math.sqrt(labelR * labelR - x * x) - 8, rot);
    }
  },

  /** Draw text that stays upright even when the world is rotated. */
  _label(text, x, y, rot, color) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(3,5,7,0.75)';
    ctx.fillRect(-w / 2, -8, w, 16);
    ctx.fillStyle = color || 'rgba(103,232,249,0.9)';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  },

  /** Range rings around the user (or centre) with distance labels. */
  _rings(c, rot) {
    const { ctx } = this;
    const o = S.pos ? this.project(S.pos.lat, S.pos.lon, c) : [0, 0];
    const maxR = Math.min(this.W, this.H) / 2;
    const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
    const ringM = steps.find(s => (maxR * this.mpp) / s <= 4) || 200000;
    ctx.strokeStyle = 'rgba(16,185,129,0.45)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    for (let i = 1; i <= 6; i++) {
      const r = ringM * i / this.mpp;
      if (r > maxR * 1.6) break;
      ctx.beginPath(); ctx.arc(o[0], o[1], r, 0, Math.PI * 2); ctx.stroke();
      // Label at the ring's top in SCREEN space: the screen "up" vector
      // (0,-r) expressed in the rotated world frame is (r·sinθ, −r·cosθ).
      const lx = o[0] + Math.sin(rot) * r, ly = o[1] - Math.cos(rot) * r;
      this._label(fmtDist(ringM * i), lx, ly, rot, 'rgba(110,231,183,0.95)');
    }
    ctx.setLineDash([]);
  },

  _polyline(pts, c, color, width, dash) {
    const { ctx } = this;
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    let lx = null, ly = null;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = this.project(pts[i][0], pts[i][1], c);
      if (i === 0) ctx.moveTo(x, y);
      else if (Math.abs(x - lx) + Math.abs(y - ly) < 1.5 && i < pts.length - 1) continue; // skip sub-pixel points
      else ctx.lineTo(x, y);
      lx = x; ly = y;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  },

  _dot(lat, lon, c, color, r) {
    const [x, y] = this.project(lat, lon, c);
    const { ctx } = this;
    ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  },

  _regions(c) {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(16,185,129,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
    for (const r of S.regions) {
      const [x1, y1] = this.project(r.b.n, r.b.w, c);
      const [x2, y2] = this.project(r.b.s, r.b.e, c);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
    ctx.setLineDash([]);
  },

  _tracks(c) {
    for (const t of S.tracks) {
      if (!t.visible) continue;
      const color = t.imported ? LINE.imported.color : LINE.saved.color;
      for (const seg of t.segments) this._polyline(seg, c, color, 3);
      const f = t.segments[0][0];
      const ls = t.segments[t.segments.length - 1], l = ls[ls.length - 1];
      this._dot(f[0], f[1], c, '#10b981', 5);
      this._dot(l[0], l[1], c, '#ef4444', 5);
    }
  },

  _recTrack(c) {
    if (!S.rec || S.rec.status === 'idle') return;
    for (const seg of S.rec.segments) this._polyline(seg, c, LINE.rec.color, 4);
    const f = S.rec.segments.find(s => s.length);
    if (f) this._dot(f[0][0], f[0][1], c, '#10b981', 6);
  },

  _guide(c) {
    const t = S.target;
    if (!t) return;
    const { ctx } = this;
    if (t.parts) {
      for (const part of t.parts) { const st = LINE[part.kind]; this._polyline(part.pts, c, st.color, st.weight - 1, st.dash); }
    } else if (t.mode === 'track') this._polyline(t.pts, c, 'rgba(255,213,79,0.35)', 6);
    const [tx, ty] = this.project(t.lat, t.lon, c);
    if (S.pos) {
      const [ux, uy] = this.project(S.pos.lat, S.pos.lon, c);
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 2.5; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
    }
    // Crosshair target.
    ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(tx, ty, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx - 20, ty); ctx.lineTo(tx + 20, ty); ctx.moveTo(tx, ty - 20); ctx.lineTo(tx, ty + 20); ctx.stroke();
  },

  _waypoints(c, rot) {
    const { ctx } = this;
    for (const w of S.waypoints) {
      const [x, y] = this.project(w.lat, w.lon, c);
      if (Math.abs(x) > this.W || Math.abs(y) > this.H) continue;   // off-screen
      const cat = CATS[w.cat] || CATS.other;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);                          // keep upright
      ctx.fillStyle = 'rgba(7,10,14,0.85)'; ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '17px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cat.icon, 0, 1);
      if (w.verified === false) {          // small amber dot = unverified
        ctx.fillStyle = '#f29900'; ctx.beginPath(); ctx.arc(11, -11, 4.5, 0, Math.PI * 2); ctx.fill();
      }
      if (this.mpp < 400) {                // names only when zoomed in enough (avoid clutter)
        ctx.font = '700 12px -apple-system, Segoe UI, sans-serif';
        const tw = ctx.measureText(w.name).width + 10;
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(-tw / 2, 18, tw, 17);
        ctx.fillStyle = '#fff'; ctx.fillText(w.name, 0, 27);
      }
      ctx.restore();
    }
    if (S.pin) {                           // dropped pin
      const [x, y] = this.project(S.pin.lat, S.pin.lon, c);
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.fillStyle = '#d93025'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, -22, 11, Math.PI * 0.8, Math.PI * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -22, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  },

  /** User position: accuracy disc, heading cone, centre dot. */
  _user(c) {
    if (!S.pos) return;
    const { ctx } = this;
    const [x, y] = this.project(S.pos.lat, S.pos.lon, c);
    const accR = S.pos.acc / this.mpp;
    if (accR > 6) {
      ctx.fillStyle = 'rgba(34,211,238,0.08)'; ctx.strokeStyle = 'rgba(34,211,238,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, accR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (S.heading != null) {
      const a = toRad(S.heading - 90);          // canvas 0 rad = east; north = -90°
      const len = 90;
      const cone = ctx.createRadialGradient(x, y, 4, x, y, len);
      cone.addColorStop(0, 'rgba(34,211,238,0.75)'); cone.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = cone;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, len, a - 0.42, a + 0.42); ctx.closePath(); ctx.fill();
      // Heading line.
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
    }
    ctx.fillStyle = '#22d3ee'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  },

  /** Screen-fixed overlay: north indicator, scale bar, centre coordinates. */
  _hud(c, rot) {
    const { ctx, W, H } = this;
    // North indicator (left side, below the zoom buttons — clear of the guide panel).
    const nx = W - 34, ny = 232;
    ctx.save();
    ctx.translate(nx, ny); ctx.rotate(-rot);
    ctx.fillStyle = 'rgba(3,5,7,0.8)'; ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(6, 2); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '800 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, 9);
    ctx.restore();

    // Scale bar (left, under the north indicator): nice length ≥ 70 px.
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    const m = nice.find(v => v / this.mpp >= 70) || 100000;
    const px = m / this.mpp;
    const bx = W - 14 - px, by = 284;    // right side, under the north indicator
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(bx, by); ctx.lineTo(bx + px, by); ctx.lineTo(bx + px, by - 6); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 12px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(fmtDist(m), bx + px / 2, by - 6);

    // Centre coordinates (bottom-left) when not following the user.
    if (!S.follow || !S.pos) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(103,232,249,0.95)';
      ctx.fillText(`${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, 12, H - 12);
      // Centre crosshair.
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(W / 2 - 10, H / 2); ctx.lineTo(W / 2 + 10, H / 2);
      ctx.moveTo(W / 2, H / 2 - 10); ctx.lineTo(W / 2, H / 2 + 10); ctx.stroke();
    }
    if (!S.pos) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,179,0,0.9)'; ctx.font = '700 14px -apple-system, Segoe UI, sans-serif';
      ctx.fillText('بانتظار إشارة GPS…', W / 2, H / 2 + 40);
    }
  },

  /* ---------- gestures: pan / pinch / wheel ---------- */
  bindGestures() {
    const cv = this.canvas;
    const dist = () => { const p = [...this.pointers.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };

    const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let press = null;   // tap / long-press tracking for a single finger

    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (this.pointers.size === 2) { this.pinch = { d: dist(), mpp: this.mpp }; if (press) clearTimeout(press.timer); press = null; return; }
      const [lx, ly] = local(e);
      press = { t: Date.now(), lx, ly, long: false, moved: false };
      // Long-press on the radar: drop a pin there (like Google Maps).
      press.timer = setTimeout(() => {
        if (!press || press.moved) return;
        press.long = true;
        const p = this.worldAt(press.lx, press.ly);
        navigator.vibrate && navigator.vibrate(30);
        Place.openPin(p.lat, p.lon);
      }, 600);
    });

    cv.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (press && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) { press.moved = true; clearTimeout(press.timer); }
      if (this.pointers.size === 1) {
        if (S.follow && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6) return; // ignore tiny moves
        if (S.follow || !this.center) { this.center = this.getCenter(); setFollow(false); }
        // Screen delta → world delta (undo the view rotation).
        const r = toRad(this.rotation());
        const wx = dx * Math.cos(r) - dy * Math.sin(r);
        const wy = dx * Math.sin(r) + dy * Math.cos(r);
        this.center = this.unproject(-wx, -wy, this.center);
        this.draw();
      } else if (this.pointers.size === 2 && this.pinch) {
        this.mpp = Math.min(3000, Math.max(0.25, this.pinch.mpp * this.pinch.d / Math.max(1, dist())));
        this.draw();
      }
    });

    const end = e => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (press) {
        clearTimeout(press.timer);
        // Short tap without moving: open the info card of the tapped point.
        if (e.type === 'pointerup' && !press.moved && !press.long && Date.now() - press.t < 500) {
          const w = this.hitWaypoint(press.lx, press.ly);
          if (w) Place.openWp(w);
        }
        press = null;
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2); }, { passive: false });
  }
};

/* =====================================================================
 * §12b PLACE CARD — tap a point (or long-press anywhere) to see its info
 * and pick it as the destination, like Google Maps.
 * ===================================================================== */
const Place = {
  cur: null,

  openWp(w) { this.cur = { type: 'wp', w }; S.pin = null; this.redrawPin(); this.render(); },
  openPin(lat, lon) { this.cur = { type: 'pin', lat, lon }; S.pin = { lat, lon }; this.redrawPin(); this.render(); },
  /** A named place from the offline search (not saved yet). */
  openNamed(r) { this.cur = { type: 'pin', lat: r.lat, lon: r.lon, name: r.name, icon: r.icon, label: r.label }; S.pin = { lat: r.lat, lon: r.lon }; this.redrawPin(); this.render(); },

  redrawPin() { MapView.showPin(); Radar.draw(); },
  clearPin() { if (S.pin) { S.pin = null; this.redrawPin(); } },

  /** Coordinates, name and icon of the current place. */
  info() {
    const c = this.cur;
    if (c.type === 'wp') {
      const cat = CATS[c.w.cat] || CATS.other;
      return { lat: c.w.lat, lon: c.w.lon, name: c.w.name, icon: cat.icon, label: cat.label, w: c.w };
    }
    return { lat: c.lat, lon: c.lon, name: c.name || 'نقطة محددة', icon: c.icon || '📌', label: c.label || 'دبوس من الخريطة' };
  },

  render() {
    const i = this.info();
    $('#pl-title').textContent = `${i.icon} ${i.name}`;
    const w = i.w;
    let meta = `<div class="pl-row">${escapeHtml(i.label)}${w && w.region ? ' · ' + escapeHtml(w.region) : ''} ${w ? verifyBadge(w) : ''}</div>`;
    if (S.pos) {
      const d = haversine(S.pos.lat, S.pos.lon, i.lat, i.lon), b = bearing(S.pos.lat, S.pos.lon, i.lat, i.lon);
      meta += `<div class="pl-dist"><b class="ltr">${fmtDist(d)}</b> · <span class="ltr">${Math.round(b)}°</span> ${cardinal(b)} <small>(خط مستقيم)</small></div>`;
    }
    meta += `<div class="pl-coords ltr">${i.lat.toFixed(6)}, ${i.lon.toFixed(6)}<br>${toDMS(i.lat, true)}  ${toDMS(i.lon, false)}</div>`;
    if (w && w.note) meta += `<div class="pl-note">${escapeHtml(w.note)}</div>`;
    if (w && Router.findApproachTrack(w)) meta += '<div class="pl-note">〰 لها مسار غير معبّد محفوظ — «الاتجاهات» تستخدمه تلقائياً</div>';
    $('#pl-meta').innerHTML = meta;
    $('#pl-save').hidden = !!w;
    UI._keepPin = true;                  // re-opening the card must not drop the new pin
    UI.openSheet('sheet-place');
  },

  route() {
    UI._keepPin = true;
    const i = this.info();
    if (i.w) PlanUI.open('wp:' + i.w.id, true);
    else PlanUI.open('coord', true, `${i.lat.toFixed(6)}, ${i.lon.toFixed(6)}`);
  },
  direct() {
    const i = this.info();
    Guide.setPoint(`${i.icon} ${i.name}`, i.lat, i.lon, i.w ? { wpId: i.w.id } : {});
    this.clearPin();
  },
  save() {
    UI._keepPin = true; const i = this.info(); Waypoints.openForm(i.lat, i.lon);
    if (this.cur && this.cur.name) $('#wp-name').value = this.cur.name.slice(0, 40);
  },
  copy() {
    const i = this.info(), txt = `${i.lat.toFixed(6)}, ${i.lon.toFixed(6)}`;
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => UI.toast('تم نسخ الإحداثيات: ' + txt), () => UI.toast(txt));
    else UI.toast(txt);
  }
};

/* =====================================================================
 * §13 OFFLINE TILES — «حفظ المنطقة للعمل بدون إنترنت»
 * ---------------------------------------------------------------------
 * Enumerates every XYZ tile covering the visible bounds for zoom levels
 * zMin…zMax, downloads them 6 at a time and stores them in the same
 * Cache Storage bucket the Service Worker reads from. Tiles already
 * cached are skipped, so re-running a download only fetches gaps.
 * ===================================================================== */
const Offline = {
  running: false,
  abort: false,

  lon2x(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); },
  lat2y(lat, z) {
    const r = toRad(Math.max(-85.0511, Math.min(85.0511, lat)));
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
  },

  currentBounds() {
    if (S.view === 'map' && MapView.map) {
      const b = MapView.map.getBounds();
      return { n: b.getNorth(), s: b.getSouth(), w: b.getWest(), e: b.getEast() };
    }
    return Radar.getBounds();
  },

  count(b, zmin, zmax) {
    let n = 0;
    for (let z = zmin; z <= zmax; z++) {
      const nx = this.lon2x(b.e, z) - this.lon2x(b.w, z) + 1;
      const ny = this.lat2y(b.s, z) - this.lat2y(b.n, z) + 1;
      n += nx * ny;
    }
    return n;
  },

  *tiles(b, zmin, zmax) {
    for (let z = zmin; z <= zmax; z++) {
      const x0 = this.lon2x(b.w, z), x1 = this.lon2x(b.e, z);
      const y0 = this.lat2y(b.n, z), y1 = this.lat2y(b.s, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) yield { z, x, y };
    }
  },

  tileUrl(layerKey, t) {
    const def = LAYERS[layerKey];
    return tileKey(def.url
      .replace('{s}', def.subs ? def.subs[0] : '')
      .replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y));
  },

  /** Fill the download sheet selects and show the estimate. */
  openSheet() {
    if (!('caches' in window)) { UI.toast('التخزين غير متاح — افتح التطبيق عبر HTTPS'); return; }
    $('#dl-layer').innerHTML = LAYER_ORDER.map(k =>
      `<option value="${k}" ${k === S.settings.layer ? 'selected' : ''}>${LAYERS[k].name}</option>`).join('');
    const zOpts = sel => Array.from({ length: 13 }, (_, i) => i + 5)
      .map(z => `<option value="${z}" ${z === sel ? 'selected' : ''}>${z}</option>`).join('');
    $('#dl-zmin').innerHTML = zOpts(12);
    $('#dl-zmax').innerHTML = zOpts(16);
    $('#dl-status').textContent = '';
    $('#dl-progress').hidden = true;
    this.bounds = this.currentBounds();
    this.estimate();
    UI.openSheet('sheet-dl');
  },

  /** Preset: coarse terrain for the whole Kingdom (background layer). */
  presetKSA() {
    this.bounds = { ...KSA_BOUNDS };
    $('#dl-layer').value = BG_LAYER;
    $('#dl-zmin').value = 5;
    $('#dl-zmax').value = BG_MAX_ZOOM;
    this.estimate();
    $('#dl-status').textContent = 'المنطقة: المملكة كاملة — اضغط «ابدأ التنزيل»';
  },

  /** Preset: satellite imagery for the whole Kingdom up to zoom 11 (smallest useful full map). */
  presetKSASat() {
    this.bounds = { ...KSA_BOUNDS };
    $('#dl-layer').value = 'sat';
    $('#dl-zmin').value = 5;
    $('#dl-zmax').value = BG_SAT_MAX_ZOOM;
    this.estimate();
    $('#dl-status').textContent = 'المنطقة: المملكة كاملة (قمر صناعي) — يُفضّل واي فاي — اضغط «ابدأ التنزيل»';
  },

  estimate() {
    let zmin = +$('#dl-zmin').value, zmax = +$('#dl-zmax').value;
    if (zmin > zmax) [zmin, zmax] = [zmax, zmin];
    const n = this.count(this.bounds, zmin, zmax);
    const mb = n * LAYERS[$('#dl-layer').value].kbPerTile / 1024;
    const tooMany = mb > MAX_DOWNLOAD_MB;
    $('#dl-est').textContent = `${n.toLocaleString('en')} مربع ≈ ${mb.toFixed(mb < 10 ? 1 : 0)} ميجابايت` +
      (tooMany ? ` — أكثر من الحد (${MAX_DOWNLOAD_MB} ميجابايت): قرّب الخريطة أو قلّل مستوى التكبير` : '');
    $('#dl-start').disabled = tooMany || this.running;
    return { n, zmin, zmax, tooMany };
  },

  async start() {
    if (this.running) return;
    const { n, zmin, zmax, tooMany } = this.estimate();
    if (tooMany) return;
    const layer = $('#dl-layer').value;
    if (navigator.onLine === false) { UI.toast('لا يوجد اتصال بالإنترنت'); return; }

    this.running = true; this.abort = false;
    $('#dl-start').disabled = true;
    $('#dl-cancel').hidden = false;
    $('#dl-progress').hidden = false;
    const bar = $('#dl-bar'), status = $('#dl-status');

    const cache = await caches.open(TILE_CACHE);
    const iter = this.tiles(this.bounds, zmin, zmax);
    let done = 0, ok = 0, skipped = 0, failed = 0;

    const fetchTile = async url => {
      try { return await fetch(url, { mode: 'cors', credentials: 'omit' }); }
      catch (e) { return await fetch(url, { mode: 'no-cors' }); }   // provider without CORS
    };

    // 6 parallel workers pulling from one shared generator.
    const worker = async () => {
      for (let n2 = iter.next(); !n2.done && !this.abort; n2 = iter.next()) {
        const url = this.tileUrl(layer, n2.value);
        try {
          if (await cache.match(url)) skipped++;
          else {
            const r = await fetchTile(url);
            if (r.ok || r.type === 'opaque') { await cache.put(url, r); ok++; }
            else failed++;
          }
        } catch (e) {
          failed++;
          if (e && e.name === 'QuotaExceededError') { this.abort = true; UI.toast('⚠️ امتلأت مساحة التخزين', 5000); }
        }
        done++;
        if (done % 5 === 0 || done === n) {
          bar.style.width = `${(done / n * 100).toFixed(1)}%`;
          status.textContent = `${done}/${n}  ✓${ok}  ↷${skipped}  ✗${failed}`;
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    const aborted = this.abort;
    this.running = false;
    $('#dl-cancel').hidden = true;
    $('#dl-start').disabled = false;
    status.textContent = `${done}/${n}  ✓${ok}  ↷${skipped}  ✗${failed}`;

    if (ok + skipped > 0) {
      const region = { id: uid(), layer, b: this.bounds, zmin, zmax, tiles: ok + skipped, created: Date.now() };
      S.regions.push(region);
      await Store.kvSet('regions', S.regions);
      MapView.renderRegions();
    }
    UI.toast(aborted ? 'تم إيقاف التنزيل' : (failed ? `اكتمل مع ${failed} مربع فاشل — أعد المحاولة لاستكمالها` : '✅ تم حفظ المنطقة للعمل بدون إنترنت'), 4500);
    updateStorageInfo();
  },

  async clearAll() {
    if (!confirm('مسح كل مربعات الخرائط المحفوظة؟ (المسارات والنقاط لن تُحذف)')) return;
    if ('caches' in window) await caches.delete(TILE_CACHE);
    S.regions = [];
    await Store.kvSet('regions', []);
    MapView.renderRegions();
    updateStorageInfo();
    UI.toast('تم مسح الخرائط المحفوظة');
  },

  async removeRegion(id) {
    // Tiles can be shared between overlapping regions, so only the outline is removed.
    S.regions = S.regions.filter(r => r.id !== id);
    await Store.kvSet('regions', S.regions);
    MapView.renderRegions();
  }
};

/** Show used / available storage in the settings sheet. */
async function updateStorageInfo() {
  const el = $('#storage-info');
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      el.textContent = `المستخدم: ${(usage / 1048576).toFixed(1)} م.ب من ${(quota / 1048576).toFixed(0)} م.ب` +
        (persisted ? ' · التخزين دائم ✓' : '');
    } else el.textContent = '';
  } catch (e) { el.textContent = ''; }
}

/* =====================================================================
 * §14 GPX — export & import (GPX 1.1, Garmin/Google Earth compatible)
 * ===================================================================== */
const GPX = {
  build({ tracks = [], waypoints = [], name = 'DesertNav' }) {
    const iso = ts => new Date(ts).toISOString();
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<gpx version="1.1" creator="DesertNav PWA" xmlns="http://www.topografix.com/GPX/1/1" ' +
             'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
             'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">');
    out.push(`  <metadata><name>${escapeXml(name)}</name><time>${iso(Date.now())}</time></metadata>`);

    for (const w of waypoints) {
      const c = CATS[w.cat] || CATS.other;
      out.push(`  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">`);
      if (w.alt != null) out.push(`    <ele>${w.alt}</ele>`);
      out.push(`    <time>${iso(w.created)}</time>`);
      out.push(`    <name>${escapeXml(w.name)}</name>`);
      if (w.region) out.push(`    <cmt>${escapeXml(w.region)}</cmt>`);
      const mark = w.verified === true ? VERIFY_OK + ' ' : w.verified === false ? VERIFY_NO + ' ' : '';
      out.push(`    <desc>${escapeXml(mark + (w.note || c.label))}</desc>`);
      out.push(`    <sym>${escapeXml(c.sym)}</sym>`);
      out.push(`    <type>${escapeXml(w.cat)}</type>`);
      out.push('  </wpt>');
    }

    for (const t of tracks) {
      out.push('  <trk>');
      out.push(`    <name>${escapeXml(t.name)}</name>`);
      for (const seg of t.segments) {
        out.push('    <trkseg>');
        for (const p of seg) {
          let line = `      <trkpt lat="${p[0].toFixed(7)}" lon="${p[1].toFixed(7)}">`;
          if (p[2] != null) line += `<ele>${p[2]}</ele>`;
          if (p[3]) line += `<time>${iso(p[3])}</time>`;
          out.push(line + '</trkpt>');
        }
        out.push('    </trkseg>');
      }
      out.push('  </trk>');
    }
    out.push('</gpx>');
    return out.join('\n');
  },

  /**
   * Deliver a file to the user. On iOS the Web Share sheet ("Save to Files",
   * AirDrop, WhatsApp…) is the reliable path; elsewhere a normal download.
   */
  async saveFile(filename, text) {
    const blob = new Blob([text], { type: 'application/gpx+xml' });
    try {
      const file = new File([blob], filename, { type: 'application/gpx+xml' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;     // user closed the share sheet
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  safeName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'track'; },

  exportTrack(t) {
    this.saveFile(`${this.safeName(t.name)}.gpx`, this.build({ tracks: [t], name: t.name }));
  },

  exportAll() {
    if (!S.tracks.length && !S.waypoints.length) { UI.toast('لا توجد بيانات للتصدير'); return; }
    this.saveFile(`desertnav_${fmtDate(Date.now()).replace(/[: ]/g, '-')}.gpx`,
      this.build({ tracks: S.tracks, waypoints: S.waypoints, name: 'DesertNav export' }));
  },

  /** Map a GPX <type>/<sym> back to one of our categories. */
  catFrom(type, sym) {
    if (type && CATS[type]) return type;
    const s = (sym || '').toLowerCase();
    if (s.includes('camp')) return 'camp';
    if (s.includes('water') || s.includes('well')) return 'well';
    if (s.includes('skull') || s.includes('danger') || s.includes('hazard')) return 'danger';
    if (s.includes('car') || s.includes('vehicle')) return 'car';
    if (s.includes('flag')) return 'meet';
    if (s.includes('residence') || s.includes('house') || s.includes('home')) return 'home';
    if (s.includes('farm')) return 'farm';
    return 'other';
  },

  /** Parse GPX text → { tracks, waypoints } (tracks, routes and waypoints). */
  parse(text, fileName) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('gpx').length) {
      throw new Error('ملف GPX غير صالح');
    }
    const childText = (el, tag) => { const c = el.getElementsByTagName(tag)[0]; return c ? c.textContent.trim() : ''; };
    const readPt = el => {
      const lat = parseFloat(el.getAttribute('lat')), lon = parseFloat(el.getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) return null;
      const ele = parseFloat(childText(el, 'ele'));
      const time = Date.parse(childText(el, 'time'));
      return [lat, lon, isNaN(ele) ? null : ele, isNaN(time) ? null : time];
    };
    const base = fileName.replace(/\.gpx$/i, '');
    const tracks = [];

    const mkTrack = (name, segments) => {
      segments = segments.filter(s => s.length > 0);
      if (!segments.length) return;
      const times = segments.flat().map(p => p[3]).filter(Boolean);
      tracks.push({
        id: uid(), name: name || base, created: times[0] || Date.now(), segments,
        distance: segments.reduce((d, s) => d + pathLength(s), 0),
        durationMs: times.length > 1 ? times[times.length - 1] - times[0] : 0,
        imported: true, visible: true
      });
    };

    for (const trk of doc.getElementsByTagName('trk')) {
      const segs = [];
      for (const seg of trk.getElementsByTagName('trkseg')) {
        segs.push(Array.from(seg.getElementsByTagName('trkpt')).map(readPt).filter(Boolean));
      }
      mkTrack(childText(trk, 'name'), segs);
    }
    for (const rte of doc.getElementsByTagName('rte')) {
      mkTrack(childText(rte, 'name') || base + ' (route)',
        [Array.from(rte.getElementsByTagName('rtept')).map(readPt).filter(Boolean)]);
    }
    const waypoints = [];
    for (const w of doc.getElementsByTagName('wpt')) {
      const p = readPt(w);
      if (!p) continue;
      const type = childText(w, 'type');
      let desc = childText(w, 'desc');
      // Points from other people's files are "unverified" unless marked otherwise.
      const verified = desc.startsWith(VERIFY_OK) ? true : false;
      desc = desc.replace(VERIFY_OK, '').replace(VERIFY_NO, '').trim();
      waypoints.push({
        id: uid(), name: childText(w, 'name') || 'نقطة مستوردة',
        cat: this.catFrom(type, childText(w, 'sym')),
        region: childText(w, 'cmt') || (type && !CATS[type] ? type : ''),
        verified, note: desc,
        lat: p[0], lon: p[1], alt: p[2] != null ? Math.round(p[2]) : null, created: p[3] || Date.now()
      });
    }
    return { tracks, waypoints };
  },

  async importFiles(files) {
    let nt = 0, nw = 0;
    const all = [];
    for (const f of files) {
      try {
        const text = await f.text();
        const { tracks, waypoints } = this.parse(text, f.name);
        for (const t of tracks) { await Store.put('tracks', t); S.tracks.push(t); nt++; all.push(...t.segments.flat()); }
        for (const w of waypoints) { await Store.put('waypoints', w); S.waypoints.push(w); nw++; all.push([w.lat, w.lon]); }
      } catch (e) {
        UI.toast(`تعذر قراءة ${f.name}: ${e.message}`, 5000);
      }
    }
    if (nt || nw) {
      MapView.renderTracks();
      MapView.renderWaypoints();
      if (all.length) {
        if (S.view === 'map') MapView.fitPoints(all.map(p => [p[0], p[1]]));
        else { setFollow(false); Radar.center = { lat: all[0][0], lon: all[0][1] }; Radar.draw(); }
      }
      Lists.render();
      UI.toast(`✅ تم استيراد ${nt} مسار و ${nw} نقطة`);
    }
  },

  /* «تحميل مواقع الكشتات» — fetch the GPX files bundled with the site
   * (also pre-cached by the service worker, so it works offline after
   * the first visit). Items already present (same name + within 50 m,
   * or a track with the same name) are skipped, so pressing twice is safe. */
  BUNDLED: ['./كشتات-حسب-المنطقة.gpx', './طريق-المخيم.gpx'],

  async loadBundled(silent) {
    let nt = 0, nw = 0, skipped = 0;
    const all = [];
    if (!silent) UI.toast('⏳ جارٍ تحميل مواقع الكشتات…');
    for (const url of this.BUNDLED) {
      try {
        const res = await fetch(encodeURI(url));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { tracks, waypoints } = this.parse(await res.text(), url.slice(2));
        for (const t of tracks) {
          if (S.tracks.some(x => x.name === t.name)) { skipped++; continue; }
          await Store.put('tracks', t); S.tracks.push(t); nt++; all.push(...t.segments.flat());
        }
        for (const w of waypoints) {
          if (S.waypoints.some(x => x.name === w.name && haversine(x.lat, x.lon, w.lat, w.lon) < 50)) { skipped++; continue; }
          await Store.put('waypoints', w); S.waypoints.push(w); nw++; all.push([w.lat, w.lon]);
        }
      } catch (e) {
        if (!silent) UI.toast('تعذر تحميل المواقع — تأكد من الاتصال بالإنترنت أول مرة', 5000);
        return false;
      }
    }
    if (nt || nw) {
      MapView.renderTracks();
      MapView.renderWaypoints();
      if (all.length && !silent) {
        if (S.view === 'map') MapView.fitPoints(all.map(p => [p[0], p[1]]));
        else { setFollow(false); Radar.center = { lat: all[0][0], lon: all[0][1] }; Radar.draw(); }
      }
      Radar.draw();
      Lists.render();
      if (!silent) UI.toast(`✅ تمت إضافة ${nw} موقع و ${nt} مسار`);
    } else if (!silent) {
      UI.toast(skipped ? '✔ مواقع الكشتات موجودة مسبقاً' : 'لا توجد مواقع جديدة');
    }
    return true;
  }
};

/* =====================================================================
 * §14b VECTOR — offline vector map of the whole Kingdom («الخريطة الرسومية»)
 * ---------------------------------------------------------------------
 * A PMTiles archive (Protomaps basemap, OpenStreetMap data) built by the
 * GitHub Action in .github/workflows/build-vector.yml and served from
 * ./vector/ in parts of 90 MB (GitHub's file limit). The parts are kept as
 * Blobs in their own IndexedDB database; reading a tile slices the Blob, so
 * the ~250 MB file is never loaded into memory. Rendering: protomaps-leaflet.
 * ===================================================================== */
const Vector = {
  DB: 'desertnav-vector',
  db: null,
  running: false,

  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('parts', { keyPath: 'name' });
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  async _req(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('parts', mode);
      const r = fn(tx.objectStore('parts'));
      tx.oncomplete = () => resolve(r ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  get(name) { return this._req('readonly', st => st.get(name)); },
  put(obj) { return this._req('readwrite', st => st.put(obj)); },
  clear() { return this._req('readwrite', st => st.clear()); },

  /** Saved archive description, or null. */
  async meta() { try { return (await this.get('__meta')) || null; } catch (e) { return null; } },

  /** Download every part (skips parts already stored) — resumable. */
  async download() {
    if (this.running) return;
    if (navigator.onLine === false) { UI.toast('لا يوجد اتصال بالإنترنت'); return; }
    this.running = true;
    const bar = $('#dl-bar'), status = $('#dl-status');
    $('#dl-progress').hidden = false;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      const idx = await (await fetch('./vector/index.json', { cache: 'no-store' })).json();
      const old = await this.meta();
      if (old && old.size !== idx.size) { await this.clear(); }    // new build on the server
      let done = 0;
      for (let i = 0; i < idx.parts.length; i++) {
        const name = idx.parts[i];
        const have = await this.get(name);
        if (have && have.blob && have.blob.size > 0) { done += have.blob.size; continue; }
        status.textContent = `جارٍ تنزيل الجزء ${i + 1} من ${idx.parts.length}…`;
        const resp = await fetch('./vector/' + name, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        // Stream for progress, then store as one Blob.
        const total = +resp.headers.get('Content-Length') || 0;
        const reader = resp.body.getReader(), chunks = [];
        let got = 0;
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          chunks.push(value); got += value.length;
          const pct = ((done + got) / idx.size) * 100;
          bar.style.width = pct.toFixed(1) + '%';
          status.textContent = `الخريطة الرسومية: ${pct.toFixed(0)}% (${Math.round((done + got) / 1048576)} من ${Math.round(idx.size / 1048576)} م.ب)`;
        }
        if (total && got !== total) throw new Error('انقطع التنزيل');
        const blob = new Blob(chunks);
        chunks.length = 0;
        await this.put({ name, blob });
        done += blob.size;
      }
      await this.put({ name: '__meta', parts: idx.parts, size: idx.size, maxzoom: idx.maxzoom, saved: Date.now() });
      try {
        status.textContent = 'جارٍ تنزيل فهرس البحث…';
        const sr = await fetch('./vector/search.json', { cache: 'no-store' });
        if (sr.ok) { await this.put({ name: '__search', blob: await sr.blob() }); Search.idx = null; Search.loading = null; }
      } catch (e) { /* search index is optional; fetched later on first search */ }
      bar.style.width = '100%';
      status.textContent = '✅ تم حفظ الخريطة الرسومية للمملكة كاملة';
      UI.toast('✅ الخريطة الرسومية جاهزة — اخترها من زر الطبقات', 4500);
      this.refreshUI();
    } catch (e) {
      const full = e && e.name === 'QuotaExceededError';
      status.textContent = full ? '⚠️ امتلأت مساحة التخزين' : `توقف التنزيل (${e.message}) — اضغط الزر مرة أخرى لاستكمال ما تبقى`;
    } finally {
      this.running = false;
    }
  },

  async remove() {
    if (!confirm('حذف الخريطة الرسومية من الجهاز؟')) return;
    await this.clear();
    if (S.settings.layer === 'vec') MapView.setLayer('sat', true);
    this.refreshUI();
    UI.toast('تم حذف الخريطة الرسومية');
  },

  /** Build the Leaflet layer from the stored parts, or null if not downloaded. */
  async makeLayer() {
    if (typeof protomapsL === 'undefined' || typeof pmtiles === 'undefined') return null;
    const meta = await this.meta();
    if (!meta) return null;
    const blobs = [];
    for (const n of meta.parts) {
      const r = await this.get(n);
      if (!r || !r.blob) return null;
      blobs.push(r.blob);
    }
    const starts = [];
    let acc = 0;
    for (const b of blobs) { starts.push(acc); acc += b.size; }
    // PMTiles "Source" that reads byte ranges across the stored parts.
    const source = {
      getKey: () => 'ksa-vector-' + meta.saved,
      async getBytes(offset, length) {
        const end = Math.min(offset + length, acc);
        const pieces = [];
        for (let i = 0; i < blobs.length; i++) {
          const a = starts[i], b = a + blobs[i].size;
          if (b <= offset || a >= end) continue;
          pieces.push(blobs[i].slice(Math.max(offset, a) - a, Math.min(end, b) - a));
        }
        return { data: await new Blob(pieces).arrayBuffer() };
      }
    };
    const archive = new pmtiles.PMTiles(source);
    const layer = protomapsL.leafletLayer({
      url: archive, flavor: 'light', lang: LG.ui === 'en' ? 'en' : 'ar', maxDataZoom: meta.maxzoom || 13,
      attribution: '© OpenStreetMap · Protomaps'
    });
    if (layer.setZIndex) layer.setZIndex(4);
    return layer;
  },

  async refreshUI() {
    const m = await this.meta();
    this.hasData = !!m;
    const b = $('#vec-dl'), r = $('#vec-rm');
    if (b) b.textContent = m ? '🗺️ الخريطة الرسومية محفوظة ✓ (تحديث)' : '🗺️ الخريطة الرسومية للمملكة كاملة (≈255 م.ب)';
    if (r) r.hidden = !m;
  }
};

/* =====================================================================
 * §14c SEARCH — «إلى أين؟» offline place search
 * ---------------------------------------------------------------------
 * Sources, in this order: coordinates / Google-Maps links, saved places,
 * and the offline index vector/search.json (every named feature of the
 * vector map: cities, villages, districts, roads, valleys, mountains,
 * fuel, mosques, wells…), built by tools/build_search.py. The index is
 * stored with the vector map in IndexedDB, so search works offline.
 * Arabic is normalised (أ/إ/آ→ا, ة→ه, ى→ي, no diacritics or tatweel).
 * ===================================================================== */
const KIND_AR = {
  city: ['مدينة', '🏙️'], town: ['بلدة', '🏘️'], village: ['قرية', '🏡'], hamlet: ['هجرة', '🏡'],
  locality: ['موقع', '📍'], neighbourhood: ['حي', '🏘️'], suburb: ['حي', '🏘️'], macrohood: ['حي', '🏘️'],
  isolated_dwelling: ['مسكن', '🏠'], farm: ['مزرعة', '🌴'], region: ['منطقة', '🗺️'], country: ['دولة', '🗺️'],
  fuel: ['محطة وقود', '⛽'], place_of_worship: ['مسجد', '🕌'], hospital: ['مستشفى', '🏥'], clinic: ['مستوصف', '🏥'],
  pharmacy: ['صيدلية', '💊'], school: ['مدرسة', '🏫'], university: ['جامعة', '🎓'], college: ['كلية', '🎓'],
  police: ['شرطة', '🚓'], restaurant: ['مطعم', '🍽️'], cafe: ['مقهى', '☕'], fast_food: ['مطعم', '🍽️'],
  supermarket: ['تموينات', '🛒'], convenience: ['بقالة', '🛒'], marketplace: ['سوق', '🛒'], hotel: ['فندق', '🏨'],
  bank: ['بنك', '🏦'], atm: ['صراف', '🏧'], car_repair: ['ورشة', '🔧'], park: ['حديقة', '🌳'],
  peak: ['جبل', '⛰️'], volcano: ['بركان', '⛰️'], hill: ['تل', '⛰️'], valley: ['وادي', '🏜️'], wadi: ['وادي', '🏜️'],
  sand: ['رمال', '🏜️'], desert: ['صحراء', '🏜️'], dune: ['كثبان', '🏜️'], beach: ['شاطئ', '🏖️'],
  water: ['ماء', '💧'], lake: ['بحيرة', '💧'], reservoir: ['خزان', '💧'], spring: ['عين', '💧'], well: ['بئر', '💧'],
  water_well: ['بئر', '💧'], river: ['وادي / شعيب', '🏜️'], stream: ['شعيب', '🏜️'], canal: ['قناة', '💧'], wetland: ['سبخة', '💧'],
  administrative: ['منطقة إدارية', '🗺️'], place: ['مكان', '📍'], scrub: ['شجيرات', '🌿'], rail: ['سكة حديد', '🚆'], ferry: ['عبّارة', '⛴️'],
  mall: ['مجمع تجاري', '🛍️'], townhall: ['بلدية', '🏛️'], post_office: ['بريد', '📮'], library: ['مكتبة', '📚'], stadium: ['ملعب', '🏟️'], bare_rock: ['صخور', '🪨'], ocean: ['بحر', '🌊'], sea: ['بحر', '🌊'], bay: ['خليج', '🌊'],
  aerodrome: ['مطار', '✈️'], airport: ['مطار', '✈️'], station: ['محطة', '🚉'], bus_stop: ['موقف', '🚌'],
  highway: ['طريق سريع', '🛣️'], major_road: ['طريق', '🛣️'], minor_road: ['شارع', '🛣️'], other: ['طريق', '🛣️'], path: ['ممر', '🥾'],
  military: ['منطقة عسكرية', '⚠️'], nature_reserve: ['محمية', '🌿'], national_park: ['متنزه', '🌿'], protected_area: ['محمية', '🌿'],
  attraction: ['معلم', '⭐'], museum: ['متحف', '🏛️'], archaeological_site: ['موقع أثري', '🏛️'], ruins: ['آثار', '🏛️'], viewpoint: ['مطل', '👁️'],
  camp_site: ['مخيم', '⛺'], industrial: ['منطقة صناعية', '🏭'], residential: ['سكني', '🏘️'], cemetery: ['مقبرة', '🪦']
};
const PLACE_RANK = { country: 0, region: 1, city: 2, town: 3, village: 4, suburb: 5, neighbourhood: 5, hamlet: 6, locality: 6 };

function normAr(t) {
  return String(t || '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')       // diacritics, tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s+/g, ' ').trim();
}

const Search = {
  idx: null,          // { kinds, d, norm[] }
  loading: null,

  async load() {
    if (this.idx) return this.idx;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let text = null;
      try { const r = await Vector.get('__search'); if (r && r.blob) text = await r.blob.text(); } catch (e) {}
      if (!text && navigator.onLine !== false) {
        try {
          const resp = await fetch('./vector/search.json', { cache: 'no-store' });
          if (resp.ok) { const blob = await resp.blob(); text = await blob.text(); Vector.put({ name: '__search', blob }).catch(() => {}); }
        } catch (e) {}
      }
      if (!text) { this.loading = null; return null; }
      const j = JSON.parse(text);
      j.norm = j.d.map(r => normAr(r[0]) + (r[1] ? ' ' + normAr(r[1]) : ''));
      j.kindKey = j.kinds.map(k => k.split(':')[1] || k.split(':')[0]);
      j.kindLayer = j.kinds.map(k => k.split(':')[0]);
      this.idx = j;
      return j;
    })();
    return this.loading;
  },

  label(kindKey, layer) {
    const k = KIND_AR[kindKey] || (layer === 'roads' ? KIND_AR.major_road : layer === 'water' ? KIND_AR.water : null);
    return k || ['مكان', '📍'];
  },

  /** Returns up to `max` results for the query. */
  query(q, max = 40) {
    const out = [];
    const qn = normAr(q);
    if (!qn) return out;
    const here = S.pos || (MapView.map ? (c => ({ lat: c.lat, lon: c.lng }))(MapView.map.getCenter()) : null);
    const dist = (la, lo) => here ? haversine(here.lat, here.lon, la, lo) : 0;

    // 1. Coordinates or a Google-Maps link.
    const pair = parsePair(q);
    if (pair) out.push({ name: `${pair.lat.toFixed(5)}, ${pair.lon.toFixed(5)}`, lat: pair.lat, lon: pair.lon, icon: '🎯', label: 'إحداثيات', type: 'coord' });

    const toks = qn.split(' ');
    const match = n => toks.every(t => n.includes(t));

    // 2. Saved places.
    for (const w of S.waypoints) {
      const n = normAr(w.name + ' ' + (w.region || '') + ' ' + (w.note || ''));
      if (match(n)) { const c = CATS[w.cat] || CATS.other; out.push({ name: w.name, lat: w.lat, lon: w.lon, icon: c.icon, label: 'محفوظ · ' + c.label, type: 'wp', w, d: dist(w.lat, w.lon) }); }
    }
    for (const t of S.tracks) {
      if (!match(normAr(t.name))) continue;
      const segs = t.segments.filter(sg => sg.length);
      if (!segs.length) continue;
      const last = segs[segs.length - 1][segs[segs.length - 1].length - 1];
      out.push({ name: t.name, lat: last[0], lon: last[1], icon: '〰', label: 'مسار محفوظ · ' + fmtDist(t.distance), type: 'trk', t, d: dist(last[0], last[1]) });
    }
    out.sort((a, b) => (a.d || 0) - (b.d || 0));

    // 3. Offline index.
    const j = this.idx;
    if (j) {
      const hits = [];
      for (let i = 0; i < j.d.length; i++) {
        const n = j.norm[i];
        if (!match(n)) continue;
        const r = j.d[i], kk = j.kindKey[r[4]], layer = j.kindLayer[r[4]];
        const starts = n.startsWith(qn) ? 0 : (' ' + n).includes(' ' + toks[0]) ? 1 : 2;
        const rank = layer === 'places' ? (PLACE_RANK[kk] ?? 6) : 8;
        const d = dist(r[2], r[3]);
        hits.push({ i, score: starts * 1e9 + Math.min(rank, 8) * 1e8 * (n === qn ? 0 : 1) + d, d, kk, layer });
        if (hits.length > 4000) break;
      }
      hits.sort((a, b) => a.score - b.score);
      const shown = [];
      for (const h of hits) {
        if (shown.length >= max) break;
        const r = j.d[h.i];
        // Long valleys/roads are stored in pieces: show one per name within 25 km.
        if (shown.some(x => x.name === r[0] && x.kk === h.kk && haversine(x.lat, x.lon, r[2], r[3]) < 25000)) continue;
        const [lbl, ico] = this.label(h.kk, h.layer);
        shown.push({ name: r[0], en: r[1], lat: r[2], lon: r[3], icon: ico, label: lbl, type: 'idx', d: h.d, kk: h.kk });
      }
      out.push(...shown);
    }
    return out.slice(0, max + 10);
  },

  online: [], onlineQ: '', onlineBusy: false,

  /** Online lookup (OpenStreetMap Nominatim) for any place in the world — only when connected.
   *  Rate-limited by the caller (≥ 900 ms after typing stops, min 3 chars). */
  /** Saudi short address (4 letters + 4 digits, e.g. EMMA4120) via the official SPL API (needs a free key). */
  async fetchShort(code) {
    const key = (S.settings.natKey || '').trim();
    this.onlineQ = code;
    if (!key) { this.online = [{ name: code, sub: X('أضف مفتاح العنوان الوطني في الإعدادات', 'Add your National Address key in Settings'), lat: 0, lon: 0, icon: '🔑', label: X('العنوان الوطني', 'National Address'), type: 'nokey', d: 0 }]; this.render(); return; }
    if (navigator.onLine === false) { this.online = []; this.render(); return; }
    this.onlineBusy = true; this.render();
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch('https://apina.address.gov.sa/NationalAddress/GeoCodeByShortAddress/GeoCodeByShortlAddress?format=json&shortaddress=' + encodeURIComponent(code) + '&api_key=' + encodeURIComponent(key), { signal: ctl.signal });
      clearTimeout(to);
      const j = await r.json().catch(() => null);
      const pts = [];
      const walk = o => {                                  // find {lat, lon} pairs whatever the field names
        if (!o || typeof o !== 'object') return;
        const ks = Object.keys(o);
        const la = ks.find(k => /^(lat|latitude|y)$/i.test(k)), lo = ks.find(k => /^(lon|lng|long|longitude|x)$/i.test(k));
        if (la && lo && isFinite(+o[la]) && isFinite(+o[lo]) && (+o[la]) !== 0) { pts.push({ lat: +o[la], lon: +o[lo], o }); return; }
        ks.forEach(k => walk(o[k]));
      };
      walk(j);
      const txt = o => [o.BuildingNumber, o.StreetName, o.District, o.City].filter(Boolean).join('، ');
      this.online = pts.slice(0, 5).map(x => ({ name: code, sub: txt(x.o), lat: x.lat, lon: x.lon, icon: '🏠', label: X('العنوان الوطني', 'National Address'), type: 'net', d: 0 }));
      if (!this.online.length) this.online = [{ name: code, sub: r.status === 401 || r.status === 403 ? X('المفتاح غير صالح', 'Invalid key') : X('لم يُعثر على العنوان', 'Address not found'), lat: 0, lon: 0, icon: '⚠️', label: X('العنوان الوطني', 'National Address'), type: 'nokey', d: 0 }];
    } catch (e) {
      this.online = [{ name: code, sub: X('تعذّر الاتصال بخدمة العنوان الوطني', 'Could not reach the National Address service'), lat: 0, lon: 0, icon: '⚠️', label: X('العنوان الوطني', 'National Address'), type: 'nokey', d: 0 }];
    }
    this.onlineBusy = false; this.render();
  },

  async fetchOnline(q) {
    q = (q || '').trim();
    if (/^[A-Za-z]{4}\s?\d{4}$/.test(q)) return this.fetchShort(q.replace(/\s/g, '').toUpperCase());
    if (q.length < 3 || navigator.onLine === false || parsePair(q)) { this.online = []; this.onlineQ = q; this.onlineBusy = false; this.render(); return; }
    if (q === this.onlineQ && this.online.length) return;
    this.onlineBusy = true; this.render();
    try {
      const c = MapView.map ? MapView.map.getCenter() : null;
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=12&accept-language=' + (LG.ui === 'en' ? 'en' : 'ar,en')
        + '&q=' + encodeURIComponent(q);
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, { signal: ctl.signal }); clearTimeout(to);
      const j = r.ok ? await r.json() : [];
      if ($('#srch-q').value.trim() !== q) return;                       // user kept typing
      const here = S.pos || (c ? { lat: c.lat, lon: c.lng } : null);
      this.online = j.map(x => {
        const la = +x.lat, lo = +x.lon;
        return { name: (x.name || (x.display_name || '').split(',')[0] || q), sub: (x.display_name || '').split(',').slice(1, 3).join('،').trim(),
                 lat: la, lon: lo, icon: '🌐', label: 'من الإنترنت', type: 'net', d: here ? haversine(here.lat, here.lon, la, lo) : 0 };
      });
      this.onlineQ = q;
    } catch (e) { this.online = []; }
    this.onlineBusy = false; this.render();
  },

  async open() {
    UI.openSheet('sheet-search');
    const inp = $('#srch-q');
    setTimeout(() => inp.focus(), 60);
    if (!this.idx) {
      $('#srch-hint').textContent = 'جارٍ تجهيز فهرس البحث…';
      const j = await this.load();
      $('#srch-hint').textContent = j
        ? `ابحث في ${j.d.length.toLocaleString('en')} اسم: مدن، قرى، أحياء، طرق، أودية، جبال، محطات، مساجد… أو الصق إحداثيات أو رابط خرائط جوجل. ومع الإنترنت يبحث أيضاً في أي مكان بالعالم.`
        : 'البحث في الأماكن يعمل دون إنترنت بعد تنزيل «الخريطة الرسومية». الآن: مواقعك المحفوظة والإحداثيات فقط.';
    }
    this.render();
  },

  render() {
    const q = $('#srch-q').value;
    this.results = this.query(q);
    if (this.onlineQ.replace(/\s/g, '').toUpperCase() === q.trim().replace(/\s/g, '').toUpperCase()) {
      const have = this.results;
      this.results = have.concat(this.online.filter(o => !have.some(h => Math.abs(h.lat - o.lat) < 0.002 && Math.abs(h.lon - o.lon) < 0.002)));
    }
    const box = $('#srch-res');
    if (!q.trim()) { box.innerHTML = ''; return; }
    const busy = this.onlineBusy ? `<p class="empty">${X('جارٍ البحث عبر الإنترنت…', 'Searching online…')}</p>` : '';
    if (!this.results.length) { box.innerHTML = busy || `<p class="empty">${X('لا توجد نتائج', 'No results')}${navigator.onLine === false ? X(' — لا يوجد إنترنت للبحث الموسّع', ' — offline, no wider search') : ''}</p>`; return; }
    box.innerHTML = this.results.map((r, k) => `
      <button class="srch-item" data-act="srch-pick" data-k="${k}">
        <span class="srch-ico">${r.icon}</span>
        <span class="srch-txt"><b>${escapeHtml(r.name)}</b>${r.en ? ` <small class="ltr">${escapeHtml(r.en)}</small>` : ''}<br>
        <small><span>${escapeHtml(r.label)}</span>${r.sub ? ' · ' + escapeHtml(r.sub) : ''}${r.d ? ' · <span class="ltr">' + fmtDist(r.d) + '</span>' : ''}</small></span>
      </button>`).join('') + busy;
  },

  pick(k) {
    const r = this.results && this.results[k];
    if (!r) return;
    if (r.type === 'nokey') { if (!S.settings.natKey) { UI.openSheet('sheet-menu'); setTimeout(() => $('#set-natkey') && $('#set-natkey').focus(), 300); } return; }
    setFollow(false);
    if (S.view === 'map' && MapView.map) MapView.map.setView([r.lat, r.lon], Math.max(MapView.map.getZoom(), r.type === 'idx' && r.label === 'مدينة' ? 11 : 14));
    else { Radar.center = { lat: r.lat, lon: r.lon }; Radar.draw(); }
    if (r.type === 'wp') Place.openWp(r.w);
    else if (r.type === 'trk') {
      if (S.view === 'map' && MapView.map) MapView.fitPoints(r.t.segments.flat().map(p => [p[0], p[1]]));
      Place.openNamed({ ...r, label: 'نهاية ' + r.label });
    }
    else Place.openNamed(r);
  }
};

/* =====================================================================
 * §15 WAKE LOCK — «إبقاء الشاشة نشطة»
 * ---------------------------------------------------------------------
 * On iPhone, locking the screen suspends the page and stops GPS updates.
 * The Screen Wake Lock API (Safari 16.4+; reliable in Home-Screen apps
 * from iOS 18.4) prevents auto-lock. The lock is released automatically
 * whenever the app is hidden, so we re-acquire it on visibilitychange.
 * ===================================================================== */
const WakeLock = {
  sentinel: null,

  supported() { return 'wakeLock' in navigator; },

  async set(on) {
    S.settings.wakeLock = on;
    saveSettings();
    if (on) await this.acquire();
    else if (this.sentinel) { try { await this.sentinel.release(); } catch (e) {} this.sentinel = null; }
    this.refreshUI();
  },

  async acquire() {
    if (!this.supported()) { this.refreshUI(); return false; }
    if (this.sentinel || document.visibilityState !== 'visible') return !!this.sentinel;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => { this.sentinel = null; this.refreshUI(); });
    } catch (e) {
      this.sentinel = null;
    }
    this.refreshUI();
    return !!this.sentinel;
  },

  refreshUI() {
    $('#set-wakelock').checked = !!S.settings.wakeLock;
    $('#wl-state').textContent = !this.supported() ? X('(غير مدعوم — حدّث النظام)', '(not supported — update iOS)') :
      (this.sentinel ? X('(مفعّل ✓)', '(on ✓)') : (S.settings.wakeLock ? X('(بانتظار التفعيل)', '(waiting)') : ''));
  }
};

/* =====================================================================
 * §16 LISTS — waypoints / tracks / regions in the bottom sheet
 * ===================================================================== */
const Lists = {
  tab: 'wps',

  setTab(tab) {
    this.tab = tab;
    $$('#sheet-lists .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ['wps', 'trks', 'regions'].forEach(k => { $('#tab-' + k).hidden = k !== tab; });
    this.render();
  },

  /** Distance & bearing from the user, if we have a fix. */
  rel(lat, lon) {
    if (!S.pos) return '';
    const d = haversine(S.pos.lat, S.pos.lon, lat, lon);
    const b = bearing(S.pos.lat, S.pos.lon, lat, lon);
    return ` · <span class="ltr">${fmtDist(d)}</span> ${cardinal(b)}`;
  },

  render() {
    // Waypoints grouped by region; inside a region: nearest first (or by name without a fix).
    const groups = new Map();
    for (const w of S.waypoints) {
      const r = w.region || REGION_MINE;
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(w);
    }
    const near = (a, b) => haversine(S.pos.lat, S.pos.lon, a.lat, a.lon) - haversine(S.pos.lat, S.pos.lon, b.lat, b.lon);
    const regions = [...groups.keys()].sort((a, b) => regionRank(a) - regionRank(b) || a.localeCompare(b, 'ar'));
    const item = w => {
      const c = CATS[w.cat] || CATS.other;
      return `<div class="item">
        <div class="item-top"><span class="item-ico">${c.icon}</span><span class="item-title">${escapeHtml(w.name)}</span>${verifyBadge(w)}</div>
        <div class="item-meta">${c.label}${this.rel(w.lat, w.lon)}<br><span class="ltr">${w.lat.toFixed(6)}, ${w.lon.toFixed(6)}</span>${w.note ? `<br><span class="wp-note">${escapeHtml(w.note)}</span>` : ''}</div>
        <div class="item-actions">
          <button class="btn btn-sm btn-go" data-act="wp-route" data-id="${w.id}">🚗 طريق</button>
          <button class="btn btn-sm btn-primary" data-act="wp-guide" data-id="${w.id}">🧭 مباشر</button>
          <button class="btn btn-sm" data-act="wp-show" data-id="${w.id}">عرض</button>
          ${w.verified !== undefined ? `<button class="btn btn-sm" data-act="wp-verify" data-id="${w.id}">${w.verified ? 'تعيين: غير موثّق' : 'تعيين: موثّق ✓'}</button>` : ''}
          <button class="btn btn-sm btn-danger" data-act="wp-del" data-id="${w.id}">حذف</button>
        </div></div>`;
    };
    $('#tab-wps').innerHTML = S.waypoints.length ? regions.map(r => {
      const list = groups.get(r).sort(S.pos ? near : (a, b) => a.name.localeCompare(b.name, 'ar'));
      const unv = list.filter(w => w.verified === false).length;
      return `<div class="grp-h"><span>${escapeHtml(r)}</span><small>${list.length} نقطة${unv ? ` · ${unv} غير موثّقة` : ''}</small></div>` + list.map(item).join('');
    }).join('') : '<p class="empty">لا توجد نقاط محفوظة بعد.<br>اضغط «حفظ نقطة» لحفظ موقعك الحالي.</p><div class="btn-row"><button class="btn btn-primary" data-act="load-sites">⛺ تحميل مواقع الكشتات</button></div>';

    // Tracks (newest first).
    const trks = [...S.tracks].sort((a, b) => b.created - a.created);
    $('#tab-trks').innerHTML = trks.length ? trks.map(t => {
      const pts = t.segments.reduce((n, s) => n + s.length, 0);
      const st = t.segments[0][0];
      return `<div class="item">
        <div class="item-top"><span class="item-ico">${t.imported ? '📥' : '〰'}</span>
          <span class="item-title">${escapeHtml(t.name)}</span>${t.imported ? '<span class="tag">مستورد</span>' : ''}</div>
        <div class="item-meta"><span class="ltr">${fmtDist(t.distance)}</span> · <span class="ltr">${fmtDuration(t.durationMs)}</span> · ${pts} نقطة · ${fmtDate(t.created)}
          <br>البداية${this.rel(st[0], st[1]) || ': —'}</div>
        <div class="item-actions">
          <button class="btn btn-sm btn-primary" data-act="trk-back" data-id="${t.id}">↩ عودة على الأثر</button>
          <button class="btn btn-sm" data-act="trk-follow" data-id="${t.id}">اتبع المسار</button>
          <button class="btn btn-sm" data-act="trk-start" data-id="${t.id}">إلى البداية</button>
          <button class="btn btn-sm" data-act="trk-place" data-id="${t.id}">📍 حفظ نهايته كموقع</button>
          <button class="btn btn-sm" data-act="trk-fit" data-id="${t.id}">عرض</button>
          <button class="btn btn-sm" data-act="trk-toggle" data-id="${t.id}">${t.visible ? 'إخفاء' : 'إظهار'}</button>
          <button class="btn btn-sm" data-act="trk-export" data-id="${t.id}">GPX ⬇</button>
          <button class="btn btn-sm btn-danger" data-act="trk-del" data-id="${t.id}">حذف</button>
        </div></div>`;
    }).join('') : '<p class="empty">لا توجد مسارات محفوظة.<br>سجّل مساراً أو استورد ملف GPX.</p>';

    // Offline regions.
    $('#tab-regions').innerHTML = S.regions.length ? S.regions.map(r => `<div class="item">
        <div class="item-top"><span class="item-ico">🗺️</span><span class="item-title">${LAYERS[r.layer] ? LAYERS[r.layer].name : r.layer} · تكبير ${r.zmin}–${r.zmax}</span></div>
        <div class="item-meta">${r.tiles} مربع · ${fmtDate(r.created)}</div>
        <div class="item-actions">
          <button class="btn btn-sm" data-act="region-show" data-id="${r.id}">عرض</button>
          <button class="btn btn-sm btn-danger" data-act="region-del" data-id="${r.id}">إزالة الإطار</button>
        </div></div>`).join('')
      : '<p class="empty">لم يتم حفظ أي منطقة.<br>من الإعدادات: «حفظ المنطقة للعمل بدون إنترنت».</p>';
  }
};

/* =====================================================================
 * §17 TELEMETRY BAR
 * ===================================================================== */
const Telemetry = {
  render() {
    const p = S.pos;
    if (p) {
      $('#t-dec').textContent = `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
      $('#t-dms').textContent = `${toDMS(p.lat, true)}  ${toDMS(p.lon, false)}`;
      $('#t-alt').textContent = p.alt != null ? Math.round(p.alt) : '--';
      $('#t-spd').textContent = p.speed != null ? (p.speed * 3.6).toFixed(p.speed * 3.6 < 10 ? 1 : 0) : '--';
      $('#t-acc').textContent = Math.round(p.acc);
      $('#t-acc').style.color = p.acc <= 15 ? 'var(--green)' : p.acc <= 50 ? 'var(--amber)' : 'var(--red)';
    }
    if (S.heading != null) {
      $('#t-hdg').textContent = String(Math.round(S.heading) % 360).padStart(3, '0');
      $('#t-card').textContent = cardinal(S.heading);
      $('#t-hsrc').textContent = S.headingSrc;
    }
  }
};

/* =====================================================================
 * VIEW / FOLLOW / SETTINGS HELPERS
 * ===================================================================== */

/** Switch between the Leaflet map and the radar, keeping zoom & centre. */
function setView(mode, auto = false) {
  if (mode === 'map' && !MapView.map) {
    UI.toast('مكتبة الخرائط غير محمّلة بعد — افتح التطبيق مرة واحدة مع إنترنت');
    mode = 'radar';
  }
  const prev = S.view;
  S.view = mode;
  S.autoSwitched = auto && mode === 'radar';
  document.body.classList.toggle('view-radar', mode === 'radar');
  document.body.classList.toggle('view-map', mode === 'map');
  $('#mode-badge').hidden = mode !== 'radar';
  $('#mode-badge').textContent = MODE_BADGE_TEXT;
  updateLayerCards();

  if (MapView.map && prev !== mode) {
    // Convert Leaflet zoom ↔ metres-per-pixel (Web Mercator ground resolution).
    if (mode === 'radar') {
      const c = MapView.map.getCenter();
      Radar.mpp = 156543.03392 * Math.cos(toRad(c.lat)) / 2 ** MapView.map.getZoom();
      if (!S.follow) Radar.center = { lat: c.lat, lon: c.lng };
    } else {
      const c = Radar.getCenter();
      const z = Math.log2(156543.03392 * Math.cos(toRad(c.lat)) / Radar.mpp);
      MapView.map.invalidateSize();
      MapView.map.setView([c.lat, c.lon], Math.max(3, Math.min(19, Math.round(z))), { animate: false });
      MapView.tileOk = 0; MapView.tileErr = 0;
    }
  }
  if (mode === 'radar') Radar.resize();
}

/** Highlight the active map type in the layers sheet. */
function updateLayerCards() {
  $$('.layer-card').forEach(c => c.classList.toggle('sel',
    S.view === 'radar' ? c.dataset.layer === 'radar' : c.dataset.layer === S.settings.layer));
}

/** Bottom bar: which tab looks active. */
function setTabActive(act) {
  $$('#toolbar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.act === act));
}

function setFollow(on) {
  S.follow = on;
  $('#btn-center').classList.toggle('on', on);
  if (on && S.pos) {
    if (S.view === 'map' && MapView.map) MapView.map.setView([S.pos.lat, S.pos.lon], Math.max(MapView.map.getZoom(), 14));
    Radar.center = null;
  }
  Radar.draw();
}

function saveSettings() { Store.kvSet('settings', S.settings).catch(() => {}); }

/** Save the last point of a track as a place with the same name, so the place
 * appears in search and «الاتجاهات» to it reuses the track for the unpaved part. */
async function saveTrackEndAsPlace(t, silent) {
  const segs = t.segments.filter(sg => sg.length);
  const last = segs[segs.length - 1][segs[segs.length - 1].length - 1];
  const dup = S.waypoints.find(w => w.name === t.name && haversine(w.lat, w.lon, last[0], last[1]) < 80);
  if (dup) { if (!silent) UI.toast('الموقع محفوظ مسبقاً'); return dup; }
  const wp = { id: uid(), name: t.name.slice(0, 40), cat: 'other', lat: last[0], lon: last[1],
               alt: last[2] != null ? Math.round(last[2]) : null, created: Date.now(), note: 'نهاية المسار «' + t.name + '»' };
  await Waypoints.add(wp);
  Lists.render();
  if (!silent) UI.toast(`📍 تم حفظ نهاية المسار كموقع «${wp.name}»`);
  return wp;
}

/** Compass button: the red needle always points to true north on screen. */
function updateCompass() {
  const rot = S.view === 'radar' ? Radar.rotation() : MapView.screenRot();
  const n = $('#cmp-needle');
  if (n) n.style.transform = `rotate(${-rot}deg)`;
}

/** Apply the app language to every screen (static text is translated by lang.js). */
function applyLanguage() {
  LG.setUI(S.settings.uiLang);
  try { Lists.render(); } catch (e) {}
  try { if (S.target) Guide.render(); } catch (e) {}
  try { MapView.renderWaypoints(); } catch (e) {}
  try { if (S.settings.layer === 'vec' && MapView.map) MapView.setLayer('vec', true); } catch (e) {}
  try { Vector.refreshUI(); WakeLock.refreshUI(); Voice.refreshUI(); } catch (e) {}
}

function syncSettingsForm() {
  $('#set-voice').checked = !!S.settings.voiceOn;
  $('#set-vlang').value = S.settings.voiceLang;
  $('#set-vvol').value = S.settings.voiceVol;
  $('#set-ulang').value = S.settings.uiLang;
  $('#set-natkey').value = S.settings.natKey || '';
  Voice.refreshUI();
  $('#set-autoradar').checked = !!S.settings.autoRadar;
  $('#set-mindist').value = S.settings.minDist;
  $('#set-interval').value = S.settings.interval;
  $('#set-maxacc').value = S.settings.maxAcc;
  $('#set-headingup').checked = !!S.settings.headingUp;
  $('#btn-hup').classList.toggle('on', S.settings.headingUp);
  WakeLock.refreshUI();
}

/* =====================================================================
 * §18 ACTIONS — one delegated click handler for every [data-act] element
 * ===================================================================== */
const findTrack = id => S.tracks.find(t => t.id === id);
const findWp = id => S.waypoints.find(w => w.id === id);

const Actions = {
  /* ----- start overlay: one user gesture unlocks GPS, compass, wake lock ----- */
  async start() {
    $('#start-overlay').hidden = true;
    S.started = true;
    GPS.start();
    await Heading.enable();
    if (S.settings.wakeLock) await WakeLock.acquire();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  },

  /* ----- «خروج»: end the session and return the screen to its first state.
   * Saved points, tracks, downloaded areas and settings are NOT touched.
   * (iOS does not let a Home-Screen web app close itself, so we stop the
   * sensors and show the start screen; the user swipes the app away.) ----- */
  async exit() {
    if (S.rec.status !== 'idle' && Recorder.pointCount() >= 2) {
      if (confirm('يوجد تسجيل مسار جارٍ.\nحفظه قبل الخروج؟')) {
        if (S.rec.status === 'recording') S.rec.elapsedMs += Date.now() - S.rec.segStart;
        await Recorder.save();
      } else if (confirm('سيُحذف التسجيل الحالي. متابعة الخروج؟')) {
        Recorder.discard(true);
      } else return;
    } else if (S.rec.status !== 'idle') {
      Recorder.discard(true);
    } else if (!confirm('الخروج وإعادة الشاشة لوضعها الأول؟\n(نقاطك ومساراتك تبقى محفوظة)')) {
      return;
    }
    if (S.target) Guide.stop();
    UI.closeSheet();
    if (typeof Place !== 'undefined') Place.clearPin();
    GPS.stop();
    Heading.disable();
    if (WakeLock.sentinel) { try { await WakeLock.sentinel.release(); } catch (e) {} WakeLock.sentinel = null; }
    S.started = false;
    S.follow = true;
    setFollow(true);
    if (MapView.map) { MapView.map.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], 6, { animate: false }); MapView.firstFix = true; }
    $('#start-overlay').hidden = false;
  },

  /* ----- recording ----- */
  'rec-main'() {
    if (UI._openSheet && UI._openSheet.id === 'sheet-rec' && S.rec.status === 'idle') UI.closeSheet();
    const st = S.rec.status;
    if (st === 'idle') Recorder.start();
    else if (st === 'recording') Recorder.pause();
    else Recorder.resume();
  },
  'rec-stop'() { Recorder.requestStop(); },
  'rec-discard'() {
    if (confirm('حذف التسجيل الحالي نهائياً؟')) { Recorder.discard(); UI.closeSheet(); }
  },
  'rec-backtrack'() {
    if (Recorder.pointCount() < 2) { UI.toast('لا توجد نقاط كافية في التسجيل بعد'); return; }
    Guide.setTrack('العودة على الأثر (التسجيل الحالي)', S.rec.segments, true);
  },

  /* ----- waypoints ----- */
  'wp-open'() { Waypoints.openForm(); },
  'pl-route'() { Place.route(); },
  'pl-direct'() { Place.direct(); },
  'pl-save'() { Place.save(); },
  'pl-copy'() { Place.copy(); },
  'wp-cat'(el) { Waypoints.selectCat(el.dataset.cat); },
  'wp-guide'(el) {
    const w = findWp(el.dataset.id);
    if (w) { Guide.setPoint(`${(CATS[w.cat] || CATS.other).icon} ${w.name}`, w.lat, w.lon, { wpId: w.id }); if (MapView.map) MapView.map.closePopup(); }
  },
  'wp-show'(el) {
    const w = findWp(el.dataset.id);
    if (!w) return;
    UI.closeSheet();
    setFollow(false);
    if (S.view === 'map' && MapView.map) MapView.map.setView([w.lat, w.lon], 16);
    else { Radar.center = { lat: w.lat, lon: w.lon }; Radar.draw(); }
  },
  async 'wp-verify'(el) {
    const w = findWp(el.dataset.id);
    if (!w) return;
    w.verified = !w.verified;
    await Store.put('waypoints', w);
    MapView.renderWaypoints();
    Lists.render();
    UI.toast(w.verified ? `✓ «${w.name}» موثّقة` : `«${w.name}» غير موثّقة`);
  },
  async 'wp-del'(el) {
    const w = findWp(el.dataset.id);
    if (w && confirm(`حذف النقطة «${w.name}»؟`)) { await Waypoints.remove(w.id); Lists.render(); }
  },

  /* ----- tracks ----- */
  'trk-back'(el) { const t = findTrack(el.dataset.id); if (t) { Guide.setTrack('↩ ' + t.name, t.segments, true); MapView.map && MapView.map.closePopup(); } },
  'trk-follow'(el) { const t = findTrack(el.dataset.id); if (t) { Guide.setTrack('〰 ' + t.name, t.segments, false); MapView.map && MapView.map.closePopup(); } },
  'trk-start'(el) {
    const t = findTrack(el.dataset.id);
    if (!t) return;
    const p = t.segments[0][0];
    Guide.setPoint('بداية: ' + t.name, p[0], p[1]);
    MapView.map && MapView.map.closePopup();
  },
  'trk-fit'(el) {
    const t = findTrack(el.dataset.id);
    if (!t) return;
    UI.closeSheet();
    if (!t.visible) { t.visible = true; Store.put('tracks', t); MapView.renderTracks(); }
    const pts = t.segments.flat();
    if (S.view === 'map' && MapView.map) MapView.fitPoints(pts.map(p => [p[0], p[1]]));
    else { setFollow(false); Radar.center = { lat: pts[0][0], lon: pts[0][1] }; Radar.draw(); }
  },
  async 'trk-toggle'(el) {
    const t = findTrack(el.dataset.id);
    if (!t) return;
    t.visible = !t.visible;
    await Store.put('tracks', t);
    MapView.renderTracks();
    Lists.render();
  },
  'trk-place'(el) { const t = findTrack(el.dataset.id); if (t) saveTrackEndAsPlace(t); },
  'trk-export'(el) { const t = findTrack(el.dataset.id); if (t) GPX.exportTrack(t); },
  async 'trk-del'(el) {
    const t = findTrack(el.dataset.id);
    if (!t || !confirm(`حذف المسار «${t.name}»؟`)) return;
    await Store.del('tracks', t.id);
    S.tracks = S.tracks.filter(x => x.id !== t.id);
    MapView.renderTracks();
    Lists.render();
  },

  /* ----- GPX ----- */
  'import-gpx'() { $('#gpx-input').click(); },
  'load-sites'() { GPX.loadBundled(); },
  'export-all'() { GPX.exportAll(); },

  /* ----- guidance & route planning ----- */
  'guide-stop'() { Guide.stop(); },
  'plan-open'() { Search.open(); },
  'plan-full'() { PlanUI.open(); },
  'srch-pick'(el) { Search.pick(+el.dataset.k); },
  'plan-calc'() { PlanUI.calc(); },
  'plan-go'() { PlanUI.go(); },
  'plan-last'() { PlanUI.last(); },
  'wp-route'(el) { if (MapView.map) MapView.map.closePopup(); PlanUI.open('wp:' + el.dataset.id, true); },
  'legend-toggle'(el) {
    el.classList.toggle('mini');
    el.querySelector('.lg-title').textContent = el.classList.contains('mini') ? 'دليل الخطوط ▸' : 'دليل الخطوط ▾';
  },

  /* ----- map / radar controls ----- */
  'view-toggle'() { setView(S.view === 'map' ? 'radar' : 'map'); },
  'layer-cycle'() {
    if (!MapView.map) return;
    const i = LAYER_ORDER.indexOf(S.settings.layer);
    MapView.setLayer(LAYER_ORDER[(i + 1) % LAYER_ORDER.length]);
  },
  'headingup-toggle'() {
    S.settings.headingUp = !S.settings.headingUp;
    saveSettings(); syncSettingsForm(); Radar.draw(); MapView.applyBearing(); updateCompass();
    if (S.settings.headingUp && S.heading == null) UI.toast('اتجاه الحركة للأعلى — يبدأ الدوران عند توفر الاتجاه (تحرّك أو فعّل البوصلة)', 4000);
    else UI.toast(S.settings.headingUp ? '🧭 اتجاه الحركة للأعلى' : '🧭 الشمال للأعلى');
  },
  center() {
    if (!S.pos) { UI.toast('بانتظار إشارة GPS…'); return; }
    setFollow(true);
  },
  'zoom-in'() { if (S.view === 'map' && MapView.map) MapView.map.zoomIn(); else Radar.zoom(1 / 1.5); },
  'zoom-out'() { if (S.view === 'map' && MapView.map) MapView.map.zoomOut(); else Radar.zoom(1.5); },
  'copy-coords'() {
    if (!S.pos) return;
    const txt = `${S.pos.lat.toFixed(6)}, ${S.pos.lon.toFixed(6)}`;
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => UI.toast('تم نسخ الإحداثيات: ' + txt), () => {});
  },

  /* ----- sheets ----- */
  'open-lists'() { Lists.render(); UI.openSheet('sheet-lists'); setTabActive('open-lists'); },
  'open-menu'() { syncSettingsForm(); updateStorageInfo(); UI.openSheet('sheet-menu'); setTabActive('open-menu'); },
  'tab-explore'() { UI.closeSheet(); },
  'open-layers'() { updateLayerCards(); syncSettingsForm(); UI.openSheet('sheet-layers'); },
  'layer-set'(el) {
    const k = el.dataset.layer;
    if (k === 'radar') setView('radar');
    else {
      if (!MapView.map) { UI.toast('مكتبة الخرائط غير محمّلة — افتح التطبيق مرة مع الإنترنت'); return; }
      MapView.setLayer(k, true);
      setView('map');
    }
    updateLayerCards();
    UI.closeSheet();
  },
  'tele-toggle'(el, e) { if (!e.target.closest('[data-act="copy-coords"]') || el.id === 'tele') $('#tele').classList.toggle('open'); },
  'rec-sheet'() { Recorder.refreshUI(); UI.openSheet('sheet-rec'); },
  'rec-backtrack-any'() {
    if (S.rec.status !== 'idle' && Recorder.pointCount() >= 2) return Actions['rec-backtrack']();
    const own = S.tracks.filter(t => !t.imported).sort((a, b) => b.created - a.created)[0];
    const t = own || [...S.tracks].sort((a, b) => b.created - a.created)[0];
    if (!t) { UI.toast('لا يوجد مسار مسجّل للعودة عليه بعد'); return; }
    Guide.setTrack('↩ ' + t.name, t.segments, true);
  },
  'close-sheet'() { UI.closeSheet(); },
  tab(el) { Lists.setTab(el.dataset.tab); },

  /* ----- settings & tools ----- */
  async 'compass-enable'() {
    const ok = await Heading.enable();
    UI.toast(ok ? '🧭 البوصلة مفعّلة — للمعايرة حرّك الجوال على شكل رقم 8' : 'البوصلة غير متاحة على هذا الجهاز', 4000);
  },
  'dl-open'() { Offline.openSheet(); },
  'dl-start'() { Offline.start(); },
  'dl-ksa'() { Offline.presetKSA(); },
  'dl-ksa-sat'() { Offline.presetKSASat(); },
  'vec-dl'() { Vector.download(); },
  'voice-toggle'() { Voice.unlock(); Voice.toggle(); },
  'voice-repeat'() { Voice.repeat(); },
  'voice-test'() { Voice.test(); },
  'app-update'() { forceUpdate(); },
  'vec-rm'() { Vector.remove(); },
  'dl-cancel'() { Offline.abort = true; },
  'tiles-clear'() { Offline.clearAll(); },
  'region-show'(el) {
    const r = S.regions.find(x => x.id === el.dataset.id);
    if (!r) return;
    UI.closeSheet();
    if (S.view === 'map' && MapView.map) MapView.fitPoints([[r.b.s, r.b.w], [r.b.n, r.b.e]]);
    else { setFollow(false); Radar.center = { lat: (r.b.n + r.b.s) / 2, lon: (r.b.e + r.b.w) / 2 }; Radar.draw(); }
  },
  async 'region-del'(el) { await Offline.removeRegion(el.dataset.id); Lists.render(); }
};

function bindUI() {
  let _srchN, _srchT = null;
  $('#srch-q').addEventListener('input', () => { clearTimeout(_srchT); _srchT = setTimeout(() => Search.render(), 150); clearTimeout(_srchN); _srchN = setTimeout(() => Search.fetchOnline($('#srch-q').value), 900); });
  // Delegated click handling (also works for buttons inside Leaflet popups).
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = Actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  $('#wp-form').addEventListener('submit', e => { e.preventDefault(); Waypoints.saveFromForm(); });
  $('#save-form').addEventListener('submit', async e => {
    e.preventDefault();
    await Recorder.save($('#trk-name').value.trim(), $('#trk-also-place').checked);
    UI.closeSheet();
  });

  $('#gpx-input').addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) { UI.closeSheet(); GPX.importFiles(files); }
  });

  $('#set-wakelock').addEventListener('change', e => WakeLock.set(e.target.checked));
  $('#set-natkey').addEventListener('change', e => { S.settings.natKey = e.target.value.trim(); saveSettings(); UI.toast('✓ تم حفظ المفتاح'); });
  $('#set-voice').addEventListener('change', e => { S.settings.voiceOn = e.target.checked; saveSettings(); if (!e.target.checked) { try { speechSynthesis.cancel(); } catch (x) {} } Voice.refreshUI(); });
  $('#set-vlang').addEventListener('change', e => { S.settings.voiceLang = e.target.value; saveSettings(); Voice.warned = false; Voice.refreshUI(); Voice.test(); });
  $('#set-vvol').addEventListener('change', e => { S.settings.voiceVol = +e.target.value; saveSettings(); Voice.test(); });
  $('#set-ulang').addEventListener('change', e => { S.settings.uiLang = e.target.value; saveSettings(); applyLanguage(); });
  $('#set-headingup').addEventListener('change', e => {
    S.settings.headingUp = e.target.checked; saveSettings(); syncSettingsForm(); Radar.draw(); MapView.applyBearing(); updateCompass();
  });
  $('#set-autoradar').addEventListener('change', e => { S.settings.autoRadar = e.target.checked; saveSettings(); });
  const num = (id, key, min, max) => $(id).addEventListener('change', e => {
    const v = Math.min(max, Math.max(min, parseInt(e.target.value, 10) || DEFAULT_SETTINGS[key]));
    S.settings[key] = v; e.target.value = v; saveSettings();
  });
  num('#set-mindist', 'minDist', 2, 500);
  num('#set-interval', 'interval', 2, 600);
  num('#set-maxacc', 'maxAcc', 5, 500);

  ['#plan-from', '#plan-to'].forEach(id => $(id).addEventListener('change', () => {
    PlanUI.syncCoordFields(); PlanUI.result = null; $('#plan-go').disabled = true;
  }));
  // Pasting "lat, lon" / DMS pair / Google Maps link into the latitude field fills both fields.
  $('#wp-lat').addEventListener('change', e => {
    const p = parsePair(e.target.value);
    if (p && /[,،\s°@]/.test(e.target.value.trim())) { $('#wp-lat').value = p.lat.toFixed(6); $('#wp-lon').value = p.lon.toFixed(6); }
  });

  ['#dl-layer', '#dl-zmin', '#dl-zmax'].forEach(id => $(id).addEventListener('change', () => Offline.estimate()));

  // Online / offline badge; return from auto-radar when connectivity is back.
  const net = () => {
    $('#net-badge').hidden = navigator.onLine;
    if (navigator.onLine && S.autoSwitched && MapView.map) {
      setView('map');
      UI.toast('🌐 عاد الاتصال — تم الرجوع للخريطة');
    }
  };
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  net();

  // Coming back to the foreground: re-acquire wake lock, refresh GPS, save state.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (S.settings.wakeLock && S.started) WakeLock.acquire();
      if (S.started && S.pos && Date.now() - S.pos.t > 15000) GPS.restart();
    } else {
      Recorder.persist();       // iOS may kill a hidden page at any time
    }
  });
  window.addEventListener('pagehide', () => Recorder.persist());
}

/* =====================================================================
 * §19 BOOT
 * ===================================================================== */
/** «تحديث التطبيق الآن»: drop the cached copy of the app (NOT the saved
 * places, tracks, downloaded maps or imagery) and reload the newest version. */
async function forceUpdate() {
  if (navigator.onLine === false) { UI.toast('يلزم اتصال بالإنترنت للتحديث'); return; }
  if (S.rec.status !== 'idle' && !confirm('يوجد تسجيل جارٍ (محفوظ تلقائياً). متابعة التحديث؟')) return;
  UI.toast('⏳ جارٍ التحديث…', 6000);
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('desertnav-shell-') || k === 'desertnav-cdn-v1').map(k => caches.delete(k)));
    }
  } catch (e) { /* reload anyway */ }
  location.replace(location.pathname + '?u=' + Date.now());
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    // Look for a new version every time the app comes back to the foreground
    // (iOS keeps Home-Screen apps in memory, so a cold start can be rare).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);

    // When the new version takes over: reload now if nothing is running,
    // otherwise wait until recording/guidance stop (their state is saved anyway).
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }       // first install, not an update
      const busy = () => S.rec.status !== 'idle' || !!S.target;
      if (!busy()) { location.reload(); return; }
      UI.toast('⬆ يوجد تحديث جديد — سيُطبَّق عند انتهاء التسجيل أو الملاحة', 6000);
      const t = setInterval(() => { if (!busy()) { clearInterval(t); location.reload(); } }, 5000);
    });
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

/* Small safety copy of the saved places in localStorage, so they can be
 * restored if the IndexedDB database is ever emptied or unavailable. */
const WP_BACKUP_KEY = 'dn_backup_waypoints';
let _wpBackupT = null;
function scheduleWpBackup() {
  clearTimeout(_wpBackupT);
  _wpBackupT = setTimeout(() => {
    try { localStorage.setItem(WP_BACKUP_KEY, JSON.stringify(S.waypoints)); } catch (e) {}
  }, 300);
}

async function restoreWpBackup() {
  let bak = [];
  try { bak = JSON.parse(localStorage.getItem(WP_BACKUP_KEY) || '[]'); } catch (e) {}
  if (!Array.isArray(bak) || !bak.length) return 0;
  for (const w of bak) { await Store.put('waypoints', w).catch(() => {}); }
  S.waypoints = bak;
  return bak.length;
}

async function boot() {
  await Store.open();

  // Load persisted data.
  const saved = await Store.kvGet('settings', null).catch(() => null);
  if (saved) S.settings = { ...DEFAULT_SETTINGS, ...saved };
  LG.setUI(S.settings.uiLang);
  Voice.init();
  S.tracks = await Store.getAll('tracks').catch(() => []);
  S.waypoints = await Store.getAll('waypoints').catch(() => []);
  if (!S.waypoints.length) {
    const n = await restoreWpBackup();
    if (n) setTimeout(() => UI.toast(`✔ تمت استعادة ${n} موقع من النسخة الاحتياطية`), 1500);
  } else scheduleWpBackup();
  S.regions = (await Store.kvGet('regions', []).catch(() => [])) || [];
  await Recorder.restore();

  Waypoints.initForm();
  Radar.init();
  const mapOk = MapView.init();
  bindUI();
  syncSettingsForm();
  setView(mapOk ? 'map' : 'radar', !mapOk);
  if (!mapOk) UI.toast('وضع الرادار: مكتبة الخرائط غير متوفرة دون اتصال (افتح التطبيق مرة مع الإنترنت)', 5000);
  MapView.renderAll();
  Recorder.refreshUI();
  setFollow(true);

  // Restore the last computed route and any route being navigated (iOS may have killed the page).
  $('#guide').hidden = true;
  S.lastPlan = await Store.kvGet('lastPlan', null).catch(() => null);
  const activePlan = await Store.kvGet('activePlan', null).catch(() => null);
  if (activePlan && activePlan.pts) Guide.setPlan(activePlan, true);

  // 1-second tick for the recording clock.
  setInterval(() => { if (S.rec.status !== 'idle') Recorder.refreshUI(); }, 1000);

  $('#app-version').textContent = `الإصدار ${APP_VERSION} · ${Store.useLS ? 'localStorage' : 'IndexedDB'}`;
  if (!window.isSecureContext) $('#start-hint').textContent = '⚠️ الصفحة ليست عبر HTTPS — لن يعمل GPS ولا العمل دون اتصال.';

  registerSW();
  Vector.refreshUI();

  // First run (or storage was wiped): add the bundled camping sites automatically.
  if (!(await Store.kvGet('sitesLoaded', false).catch(() => false))) {
    if (await GPX.loadBundled(true)) Store.kvSet('sitesLoaded', true).catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
