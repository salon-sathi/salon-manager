import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pwa from "./vite-pwa-plugin.js";

// The service worker is the one piece of this app that can serve a WRONG answer long after the
// code that produced it has been fixed — a bad precache entry breaks install for everyone on
// that build, and a cached Firebase response shows a salon yesterday's diary. Neither shows up
// in a normal test run, so both are pinned here.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(path.join(HERE, "sw.js"), "utf8");
// Comments explain what the worker deliberately does NOT do ("No skipWaiting() here"), so a
// behaviour assertion has to read the code alone or it matches the prose denying it.
const CODE = TEMPLATE.replace(/^\s*\/\/.*$/gm, "");

/** Run the plugin's generateBundle over a bundle shaped like a real build's. */
function emit(base = "/salon-manager/") {
  const plugin = pwa();
  plugin.configResolved({ base });
  const emitted = [];
  plugin.generateBundle.call(
    { emitFile: (f) => emitted.push(f), warn: () => {} },
    {},
    {
      "index.html": {},
      "assets/index-AAA111.js": {},
      "assets/react-BBB222.js": {},
      "assets/firebase-CCC333.js": {},
      "assets/charts-DDD444.js": {},
      "assets/xlsx-EEE555.js": {},
      "assets/Billing-FFF666.js": {},
      "assets/Stats-GGG777.js": {},
      "assets/pdf.worker.min-HHH888.mjs": {},
      // The public booking page: a second HTML entry, with its own entry chunk.
      "book/index.html": {},
      "assets/book-III999.js": {},
    }
  );
  const sw = emitted.find((f) => f.fileName === "sw.js").source;
  return { sw, precache: JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]) };
}

describe("the emitted service worker", () => {
  it("precaches the shell, and only the shell", () => {
    const { precache } = emit();
    expect(precache).toEqual([
      "/salon-manager/",
      "/salon-manager/logo.svg",
      "/salon-manager/manifest.webmanifest",
      "/salon-manager/assets/firebase-CCC333.js",
      "/salon-manager/assets/index-AAA111.js",
      "/salon-manager/assets/react-BBB222.js",
    ]);
  });

  it("leaves the lazy views and the heavy vendors to be fetched on demand", () => {
    // Precaching these would make a first visit download the whole app — including the PDF
    // parser and the spreadsheet writer — before the till could open.
    const { precache } = emit();
    ["Billing", "Stats", "charts", "xlsx", "pdf.worker"].forEach((name) =>
      expect(precache.some((u) => u.includes(name)), `${name} must not be precached`).toBe(false)
    );
  });

  it("lists index.html as the base URL, which is what a navigation asks for", () => {
    const { precache } = emit();
    expect(precache.some((u) => u.endsWith("index.html"))).toBe(false);
    expect(precache).toContain("/salon-manager/");
  });

  it("follows the base path, so a fork served from the domain root still works", () => {
    const { precache } = emit("/");
    expect(precache).toContain("/");
    expect(precache).toContain("/assets/index-AAA111.js");
  });

  it("substitutes every placeholder — none survive into the build", () => {
    const { sw } = emit();
    expect(sw).not.toMatch(/__(PRECACHE|INDEX|VERSION)__/);
    expect(sw).toMatch(/const INDEX = "\/salon-manager\/";/);
    expect(sw).toMatch(/const VERSION = "[0-9a-f]{12}";/);
  });

  it("changes its cache version when the shell changes", () => {
    // Same input, same version — otherwise every deploy would evict a cache that is still valid.
    expect(emit().sw.match(/const VERSION = "([^"]+)"/)[1])
      .toBe(emit().sw.match(/const VERSION = "([^"]+)"/)[1]);
    expect(emit("/").sw.match(/const VERSION = "([^"]+)"/)[1])
      .not.toBe(emit().sw.match(/const VERSION = "([^"]+)"/)[1]);
  });
});

describe("the service worker's own rules", () => {
  it("never touches the cache for a Firebase host", () => {
    // The load-bearing one. A cached read here is a WRONG read: the app is built on live
    // snapshots, and a diary that serves yesterday's bookings is worse than one that says
    // "offline", because the salon acts on what it sees.
    const hosts = TEMPLATE.match(/const FIREBASE_HOSTS =\s*([^;]+);/)[1];
    const re = new RegExp(hosts.trim().replace(/^\/|\/i$/g, ""), "i");
    [
      "salon-manager-49a88-default-rtdb.asia-southeast1.firebasedatabase.app",
      "salon-manager-49a88.firebaseio.com",
      "identitytoolkit.googleapis.com",
      "firebasestorage.googleapis.com",
      "salon-manager-49a88.firebasestorage.app",
      "salon-manager-49a88.firebaseapp.com",
      "www.gstatic.com",
    ].forEach((h) => expect(re.test(h), `${h} must bypass the cache`).toBe(true));

    // …and does not accidentally swallow the app's own origin.
    ["localhost", "salon-sathi.github.io"].forEach((h) =>
      expect(re.test(h), `${h} is the app itself`).toBe(false)
    );
  });

  it("waits to be told before replacing a running app", () => {
    // No skipWaiting() on install: swapping the shell out from under a half-finished bill is
    // exactly how one gets lost. It only happens on the message the Reload button sends.
    expect(CODE).not.toMatch(/"install"[\s\S]{0,400}skipWaiting/);
    expect(CODE).toMatch(/"message"[\s\S]{0,200}SKIP_WAITING[\s\S]{0,80}skipWaiting/);
  });

  it("is network-first for the document and cache-first for hashed assets", () => {
    expect(CODE).toMatch(/req\.mode === "navigate"[\s\S]{0,300}fetch\(req\)/);
    expect(CODE).toMatch(/caches\.match\(req\)\.then\(\(hit\) =>\s*\n?\s*hit \|\|/);
  });

  it("caches each document under its OWN url, not all of them under the shell's", () => {
    // This worker's scope is the whole base path, so it controls the public booking page at
    // <base>book/ as well as the app. Storing every navigation under the single INDEX key let
    // the last document visited win: a customer booking on the counter tablet would replace the
    // app shell in the cache, and the salon's next offline start would open the booking form.
    //
    // playwright.config.js sets serviceWorkers: "block", so no e2e spec can ever catch this —
    // this assertion is the only guard there is.
    expect(CODE).not.toMatch(/navigate[\s\S]{0,400}c\.put\(INDEX/);
    expect(CODE).toMatch(/navigate[\s\S]{0,200}c\.put\(key/);
    // …and INDEX survives as the fallback for a url nobody has visited yet.
    expect(CODE).toMatch(/caches\.match\(INDEX\)/);
  });
});
