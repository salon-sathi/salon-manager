import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Emits the service worker at the root of the build, with its precache list filled in.
//
// The list HAS to be generated: every asset is content-hashed, so a hand-written one is wrong
// the moment anything changes — and wrong in the worst way, silently serving a shell whose
// chunks 404. scripts/sw.js is the template; this replaces __PRECACHE__, __INDEX__ and
// __VERSION__ in it and writes the result to dist/sw.js.
//
// Build-only: the dev server has no service worker at all (see src/lib/ui/swUpdate.js), because
// a worker holding a cached shell in front of Vite's HMR is a debugging session nobody enjoys.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "sw.js");

// What the shell needs to paint. NOT every emitted file: the lazy view chunks, the pdf worker
// and the xlsx writer are fetched on demand and cached then (the fetch handler keeps what it
// sees), so precaching them would make a first visit download the whole app to open the till.
// `firebase` is in the list because the app calls initializeApp on import — without it the
// shell cannot boot at all, offline or on.
const SHELL = /^assets\/(index|react|firebase)-[^/]+\.(js|css)$/;

// Copied verbatim from public/ by Vite, so they never appear in the rollup bundle and have to
// be named. The logo is the one image the shell itself paints (sidebar, sign-in card).
const STATIC = ["logo.svg", "manifest.webmanifest"];

export default function pwaPlugin() {
  let base = "/";
  return {
    name: "vite-plugin-pwa-shell",
    apply: "build",
    configResolved(config) {
      base = config.base || "/";
    },
    generateBundle(_options, bundle) {
      const urls = [base, ...STATIC.map((f) => base + f)];
      for (const file of Object.keys(bundle).sort()) {
        if (SHELL.test(file)) urls.push(base + file);
      }
      // index.html is listed as the base URL, not as ".../index.html": that is the URL a
      // navigation actually requests, and the one caches.match() has to find.
      const precache = [...new Set(urls.filter((u) => !u.endsWith("index.html")))];

      // replaceAll, not replace: a single-occurrence swap silently patched the first mention of
      // the placeholder — which was in a comment — and left the actual `const PRECACHE = ...`
      // holding a name that no longer existed. The build still succeeded.
      const source = readFileSync(TEMPLATE, "utf8")
        .replaceAll("__PRECACHE__", JSON.stringify(precache, null, 2))
        .replaceAll("__INDEX__", JSON.stringify(base))
        .replaceAll("__VERSION__", JSON.stringify(createHash("sha256").update(precache.join("|")).digest("hex").slice(0, 12)));

      this.emitFile({ type: "asset", fileName: "sw.js", source });
      this.warn?.(`[pwa] precaching ${precache.length} files`);
    },
  };
}
