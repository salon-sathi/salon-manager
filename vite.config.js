import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import changelog from "./scripts/vite-changelog-plugin.js";
import pwa from "./scripts/vite-pwa-plugin.js";

// package.json sets "type": "module", so there is no __dirname here.
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Served at the repo sub-path on GitHub Pages in production; at root during local dev.
//
// `isPreview` matters and is easy to miss: `vite preview` runs with command === "serve", so
// keying only on "build" served the built app at "/" while its own index.html asked for
// /salon-manager/… — every asset fell through to the SPA fallback and came back as index.html
// with a text/html content-type. That makes the service worker untestable locally (a manifest
// and a worker script both served as HTML) and looks like a PWA bug rather than a base-path one.
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/salon-manager/" : "/",
  plugins: [react(), changelog(), pwa()],
  server: { port: 5173, open: true },
  build: {
    // Split heavy vendors into their own chunks so the browser caches them across
    // deploys and loads them in parallel instead of in one ~1.5 MB blob.
    rollupOptions: {
      // Two documents: the staff app, and the public booking page at <base>book/.
      //
      // The KEY names the entry chunk (assets/<key>-<hash>.js), and `index` is load-bearing:
      // scripts/vite-pwa-plugin.js precaches ^assets/(index|react|firebase)-, so naming this
      // entry anything else would silently drop the app's own entry chunk out of the offline
      // shell. The default single-string input is named from the file's basename, which is how
      // it came to be `index` in the first place.
      //
      // `book` deliberately does NOT match that pattern: the booking page reads live
      // availability, so an offline copy of it would be worse than useless.
      input: { index: here("index.html"), book: here("book/index.html") },
      output: {
        // Left alone on purpose. Splitting firebase/auth out so the booking page skips it looks
        // like a win and is a trap: the chunk would be named `firebaseAuth-<hash>.js`, which
        // does not match the precache pattern above, and the staff shell imports firebase/auth
        // eagerly — so the app would stop booting offline. The booking page avoids auth and
        // storage by building its own Firebase app from firebaseConfig.js instead (src/book/db.js).
        // A FUNCTION, not the `{ name: [packages] }` map this used to be. That map named the
        // entry points of each package but not their internals, so recharts' copy of the React
        // tree won: react-dom ended up inside `charts`, and `react-<hash>.js` was emitted as a
        // 30-byte stub that did nothing but `import "./charts-<hash>.js"`. The service worker
        // precaches index + react + firebase and NOT charts, so the offline shell was caching a
        // stub whose real code was never there — the app could not boot with the network off,
        // which is the one thing the worker exists for. It also meant the public booking page
        // pulled 591 kB of charting library to get React.
        //
        // Routing by module path fixes both: `react` is genuinely React, and `charts` is
        // genuinely recharts and its d3 dependencies, loaded only when Stats is opened.
        //
        // The chunk NAMES are load-bearing — scripts/vite-pwa-plugin.js precaches
        // ^assets/(index|react|firebase)- — so renaming one silently drops it out of the
        // offline shell. `firebase` stays a single chunk holding auth as well: splitting it
        // would emit a name outside that pattern and stop the shell booting offline, and the
        // booking page carrying the unused auth SDK is the cheaper of the two problems.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const path = id.replace(/\\/g, "/");
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return "react";
          if (/\/node_modules\/(recharts|victory-vendor|d3-[^/]+|internmap|delaunator|robust-predicates)\//.test(path)) return "charts";
          if (/\/node_modules\/(firebase|@firebase)\//.test(path)) return "firebase";
          if (/\/node_modules\/xlsx\//.test(path)) return "xlsx";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  test: {
    // tests/rules/** talks to the Firebase emulator, so it cannot run under a plain
    // `npm test` — it lives behind `npm run test:rules` (vitest.rules.config.js) and is
    // excluded here to keep the pure-lib suites dependency-free.
    //
    // e2e/** is excluded for the same reason and one more: those specs are written for the
    // Playwright runner, and Vitest's default include (**/*.spec.js) would otherwise pick
    // them up and fail on `import { test } from "@playwright/test"`. They run under
    // `npm run test:e2e`, which brings up the emulator and a dev server first.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/rules/**", "e2e/**"],
  },
}));
