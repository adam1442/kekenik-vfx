/* Kekenik VFX service worker: optional offline support for the hosted / local build.
 *
 * - Same-origin GET requests only; nothing is ever fetched from a third party.
 * - `__BUILD_ID__` is replaced at build time, so every deployment gets its own cache and the previous one is deleted on activation.
 * - Page navigations are network-first (a fresh deployment is picked up on the next load, the cache is the offline fallback);
 *   hashed assets are cache-first. The new worker waits until the old tabs are closed (no skipWaiting), so a running session never
 *   mixes files from two builds.
 * - Scope is the folder that contains this file (for example /kekenik-vfx/ on GitHub Pages).
 */
const CACHE = 'kekenik-vfx-__BUILD_ID__';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      let files = SHELL;
      try {
        const r = await fetch('./precache.json', { cache: 'no-cache' });
        if (r.ok) files = files.concat(await r.json());
      } catch {
        /* no manifest: cache the shell only */
      }
      await Promise.all(files.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => undefined)));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('kekenik-vfx-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        try {
          const res = await fetch(req);
          if (res.ok) void cache.put('./index.html', res.clone());
          return res;
        } catch {
          return (await cache.match('./index.html')) || new Response('Offline', { status: 503 });
        }
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) void cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('Offline', { status: 503 });
      }
    })(),
  );
});
