import { defineConfig, devices } from "@playwright/test";

// Deliberately NOT 5173. `npm run dev` on the default port talks to the LIVE project, and a
// config that reused an already-running server would silently run the whole suite against a
// real salon's data. A separate port plus reuseExistingServer:false means the suite always
// starts its own server, with VITE_USE_EMULATORS set.
const PORT = Number(process.env.E2E_PORT || 5174);
const HOST = "127.0.0.1";

// Dev mode serves at "/" (vite.config.js keys the /salon-manager/ base path off `build` and
// `isPreview`), so no base path here. A preview-mode project would need one.
const BASE_URL = `http://${HOST}:${PORT}/`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.js",

  // The emulator is ONE shared, stateful process and the fixtures wipe the whole database,
  // so parallel spec files would delete each other's data mid-assertion. This is the same
  // constraint the rules suite documents in CLAUDE.md, for the same reason.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    // The app registers its service worker in production builds only, so in dev there is
    // nothing to block. Kept explicit because a preview-mode project WOULD have one, and a
    // worker serving a precached shell across runs is a stale-asset flake waiting to happen.
    serviceWorkers: "block",
  },

  // Sign-in is a real Firebase auth round trip followed by the first RTDB snapshot, and
  // every spec pays it because the app has no routes to deep-link past it.
  expect: { timeout: 10_000 },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // --host 127.0.0.1 is load-bearing. Left to itself Vite binds "localhost", which on this
    // machine resolves to [::1] ONLY — so a baseURL of 127.0.0.1 gets ECONNREFUSED and the
    // run dies in webServer's readiness check, before a single spec. Pinning the interface
    // here (rather than writing "localhost" in the URL) keeps the two sides in step whichever
    // way the host resolves. It is still loopback: nothing is exposed off the machine.
    command: `npm run dev -- --port ${PORT} --strictPort --no-open --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
    env: { VITE_USE_EMULATORS: "1" },
  },
});
