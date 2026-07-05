/**
 * Monecraft service worker: offline app shell for single-player.
 *
 * Strategy (docs/architecture.md "Offline / PWA"):
 * - Navigations to "/" are network-first with cache fallback — deploys land
 *   normally while online, the cached shell boots the game offline. When the
 *   HTML changes, its /_next/static references are re-precached.
 * - /_next/static/* is cache-first: content-hashed, immutable, trimmed to a
 *   bounded count in insertion order.
 * - The manifest and icon routes are stale-while-revalidate.
 * - Everything else — /api/*, cross-origin (the game server), non-GET, RSC
 *   payloads, /join/* navigations — is never touched: the classifier's
 *   default is bypass, so online features can't be broken by a stale cache.
 *
 * Bump SW_VERSION only when the cache shape changes (old caches are dropped
 * on activate). HTML freshness never depends on it, so skipWaiting is safe.
 */

const SW_VERSION = "v1";
const SHELL_CACHE = `monecraft-shell-${SW_VERSION}`;
const ASSET_CACHE = `monecraft-assets-${SW_VERSION}`;
const SHELL_URL = "/";
/** Precached beside the shell so an offline install prompt has its icons. */
const SHELL_EXTRAS = ["/manifest.webmanifest", "/icons/192", "/icons/512", "/icons/maskable"];
/** Paths served stale-while-revalidate (pathname match; queries vary). */
const SHELL_EXTRA_PATHS = new Set([...SHELL_EXTRAS, "/icon", "/apple-icon"]);
/** Insertion-order cap on cached immutable assets (~a few builds' worth). */
const MAX_ASSETS = 100;

/**
 * Decides what the fetch handler does with a request. Pure — unit-tested via
 * the self.__sw hook (tests/sw.test.ts). The default is "bypass": anything
 * not positively identified as app shell goes straight to the network.
 *
 * @param {{ method: string, mode: string, url: string, headers: { get(name: string): string | null } }} request
 * @param {string} origin
 * @returns {"bypass" | "navigation" | "asset" | "shell-extra"}
 */
function classify(request, origin) {
  if (request.method !== "GET") return "bypass";
  const url = new URL(request.url);
  if (url.origin !== origin) return "bypass";
  if (url.pathname.startsWith("/api/")) return "bypass";
  if (url.pathname === "/sw.js") return "bypass";
  // RSC/prefetch payloads share the page URL but carry a header or _rsc query
  // — caching one as HTML (or vice versa) is the classic App Router pitfall.
  if (url.searchParams.has("_rsc")) return "bypass";
  if (request.headers.get("RSC") === "1" || request.headers.get("Next-Router-Prefetch") === "1") return "bypass";
  if (request.mode === "navigate") return url.pathname === SHELL_URL ? "navigation" : "bypass";
  if (url.pathname.startsWith("/_next/static/")) return "asset";
  if (SHELL_EXTRA_PATHS.has(url.pathname)) return "shell-extra";
  return "bypass";
}

/**
 * Pulls every /_next/static reference (scripts, CSS, font preloads) out of
 * the shell HTML. All play-critical JS is statically imported from "/", so
 * the HTML references the whole offline bundle — except the lazily imported
 * zzfx chunk, which cache-first picks up on the first online audio unlock
 * (missing it degrades to a silent game, never a broken one).
 *
 * @param {string} html
 * @returns {string[]}
 */
function extractShellAssets(html) {
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
    urls.add(match[1].replace(/&amp;/g, "&"));
  }
  return [...urls];
}

/** Cache.put that treats failure (quota, shutdown) as a skipped optimization. */
async function safePut(cache, key, response) {
  try {
    await cache.put(key, response);
  } catch {
    // Never let a cache write break the page; the entry heals next fetch.
  }
}

/** @param {Response} response */
function cacheable(response) {
  return response.ok && response.type === "basic";
}

/** Oldest-first trim; Cache keys() preserve insertion order. */
async function trimAssets(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) {
    await cache.delete(key);
  }
}

/** @param {string} html */
async function precacheAssets(html) {
  const cache = await caches.open(ASSET_CACHE);
  await Promise.all(
    extractShellAssets(html).map(async (url) => {
      if (await cache.match(url)) return;
      try {
        const response = await fetch(url);
        if (cacheable(response)) await safePut(cache, url, response);
      } catch {
        // Offline mid-precache: bounded gap, re-parsed on the next online load.
      }
    })
  );
  await trimAssets(cache);
}

/**
 * Caches a fresh copy of the shell HTML and, if it changed, re-precaches the
 * assets it references. @param {Response} fresh — dedicated clone.
 */
async function refreshShell(fresh) {
  const cache = await caches.open(SHELL_CACHE);
  const previous = await cache.match(SHELL_URL);
  const html = await fresh.clone().text();
  if (previous && (await previous.text()) === html) return;
  await safePut(cache, SHELL_URL, fresh);
  await precacheAssets(html);
}

async function precacheExtras() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    SHELL_EXTRAS.map(async (url) => {
      try {
        const response = await fetch(url);
        if (cacheable(response)) await safePut(cache, url, response);
      } catch {
        // Stale-while-revalidate refills these on use.
      }
    })
  );
}

async function installShell() {
  try {
    const fresh = await fetch(SHELL_URL, { cache: "no-cache" });
    if (cacheable(fresh)) await refreshShell(fresh);
  } catch {
    // Installed while offline: the first online navigation fills the caches.
  }
  try {
    await precacheExtras();
  } catch {
    // Best-effort like every other cache write: a storage failure here must
    // not reject waitUntil and abort the whole installation.
  }
}

/** Network-first navigation; the cached shell is the offline fallback. */
async function handleNavigation(event) {
  try {
    const fresh = await fetch(event.request);
    if (cacheable(fresh)) event.waitUntil(refreshShell(fresh.clone()));
    return fresh;
  } catch (error) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (cacheable(response)) {
    await safePut(cache, event.request, response.clone());
    event.waitUntil(trimAssets(cache));
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request);
  const revalidate = fetch(event.request).then(async (response) => {
    if (cacheable(response)) await safePut(cache, event.request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(revalidate.catch(() => {}));
    return cached;
  }
  return revalidate;
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith("monecraft-") && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const kind = classify(event.request, self.location.origin);
  if (kind === "bypass") return;
  if (kind === "navigation") event.respondWith(handleNavigation(event));
  else if (kind === "asset") event.respondWith(cacheFirst(event));
  else event.respondWith(staleWhileRevalidate(event));
});

// Test hook: pure helpers, asserted in tests/sw.test.ts without a browser.
self.__sw = { classify, extractShellAssets, SHELL_EXTRA_PATHS, MAX_ASSETS };
