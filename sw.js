/* Oregon OHV Map service worker.
   Caches the app shell + glyphs. Map pack files under packs/ are managed by
   the app itself (OPFS) and are NEVER intercepted here. */
const VERSION = "ohv-v2";
const SHELL = [
  "./",
  "index.html",
  "app.js",
  "style.css",
  "manifest.webmanifest",
  "packs.json",
  "vendor/maplibre-gl.js",
  "vendor/maplibre-gl.css",
  "vendor/pmtiles.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "glyphs-v1").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Pack archives: the app streams/downloads these itself; stay out of the way.
  if (url.pathname.includes("/packs/")) return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/glyphs/")) {
    e.respondWith(
      caches.open("glyphs-v1").then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    })
  );
});
