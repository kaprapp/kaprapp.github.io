// Kapr: jednoduchá offline záloha. Vždy zkouší síť, při výpadku použije poslední uloženou verzi.
const CACHE = "kapr-v18";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (/tile\.openstreetmap\.org|nominatim|goatcounter|zgo\.at/.test(u.hostname)) return;
  e.respondWith(
    fetch(u.origin === self.location.origin ? new Request(req, { cache: "no-cache" }) : req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req))
  );
});
