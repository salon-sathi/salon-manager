// Salon Manager's service worker. Hand-rolled, and small on purpose — its whole job is to make
// the app SHELL open with no network. Data offline is unchanged: the localStorage cache in
// salon-manager.jsx still holds the last snapshot, and a write attempted offline is still
// refused with the hard-stop modal. Nothing here caches, queues or replays salon data.
//
// This file is a TEMPLATE. scripts/vite-pwa-plugin.js copies it into the build and fills in the
// three placeholders below with the real, content-hashed file list — which is why that list
// cannot be hand-written: every asset name changes on every build. (Don't write a placeholder's
// name anywhere else in this file, comments included: substitution is textual.)

const PRECACHE = __PRECACHE__;
const VERSION = __VERSION__;
const CACHE = `salon-shell-${VERSION}`;

// The document. Everything else in PRECACHE is content-hashed, so it can be cached forever;
// index.html is the one file whose NAME stays the same while its contents change.
const INDEX = __INDEX__;

// ---------------------------------------------------------------------------
// NEVER CACHED, EVER: anything that talks to Firebase.
//
// A cached read is a WRONG read here. The whole app is built on live snapshots — an
// appointment book that serves yesterday's bookings from a cache is worse than one that says
// "offline", because the salon acts on what it sees. Auth and Storage are the same story.
// These requests are not merely "network-first"; they never touch the cache at all.
// ---------------------------------------------------------------------------
const FIREBASE_HOSTS =
  /(^|\.)(firebasedatabase\.app|firebaseio\.com|googleapis\.com|firebasestorage\.app|firebaseapp\.com|gstatic\.com)$/i;

self.addEventListener("install", (event) => {
  // No skipWaiting() here: a new worker waits until the app asks. Swapping the shell out from
  // under a half-finished bill is exactly the sort of thing that loses one.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks for the update when the user accepts it (see src/lib/ui/swUpdate.js).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (FIREBASE_HOSTS.test(url.hostname)) return; // straight to the network, every time
  if (url.origin !== self.location.origin) return; // and anything else off-origin

  // Navigations: network-first, so a deployed change is picked up on the next load and the
  // cached shell is only ever a fallback for "there is no network".
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(INDEX, copy));
          return res;
        })
        .catch(() => caches.match(INDEX).then((hit) => hit || Response.error()))
    );
    return;
  }

  // Hashed assets: cache-first. The name IS the version — if the content changed, the URL
  // changed, so a hit can never be stale. A miss (a lazy view chunk opened for the first time
  // offline) falls through to the network and is kept for next time.
  event.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
    )
  );
});
