import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import changelog from "./scripts/vite-changelog-plugin.js";
import pwa from "./scripts/vite-pwa-plugin.js";

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
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          charts: ["recharts"],
          firebase: ["firebase/app", "firebase/auth", "firebase/database"],
          xlsx: ["xlsx"],
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
