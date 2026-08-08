// Service-worker registration, and the "an update is ready" signal the shell shows.
//
// PRODUCTION ONLY. In dev there is no worker at all: a cached shell sitting in front of Vite's
// HMR is a debugging session nobody enjoys, and `npm run dev` would start serving yesterday's
// bundle out of a cache the moment anything went wrong.
//
// The worker itself deliberately does NOT skipWaiting on install (scripts/sw.js). A new version
// waits until the user accepts it, because swapping the app out from under a half-finished bill
// is exactly how one gets lost. This module is the accept button's other half.

const listeners = new Set();
let waitingWorker = null;

/** Subscribe to "a new version is installed and waiting". Returns an unsubscribe. */
export function onUpdateReady(cb) {
  listeners.add(cb);
  if (waitingWorker) cb(true);
  return () => listeners.delete(cb);
}

function announce(worker) {
  waitingWorker = worker;
  listeners.forEach((cb) => cb(true));
}

/** Take the update: tell the waiting worker to activate, then reload once it has. */
export function applyUpdate() {
  if (!waitingWorker) { window.location.reload(); return; }
  // controllerchange fires once the new worker is in charge; reloading before that would just
  // re-run the old shell. `reloaded` guards the double-fire Chrome does on a hard refresh.
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  waitingWorker.postMessage("SKIP_WAITING");
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  // Scope and URL both come from BASE_URL: on GitHub Pages the app lives at /salon-manager/,
  // and a worker cannot control a path above its own directory. Registering "/sw.js" there
  // would 404, and registering with a wider scope would be refused.
  const base = import.meta.env.BASE_URL;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then((reg) => {
      // Already waiting when the page loaded (the user closed the tab mid-update last time).
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // `controller` is null on the very first install — that is not an update, it is the
          // app being cached for the first time, and telling the user to reload for it would
          // be nonsense.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            announce(installing);
          }
        });
      });
    }).catch((err) => {
      // A failed registration must never break the app — it only means no offline shell.
      console.error("service worker registration failed", err);
    });
  });
}
