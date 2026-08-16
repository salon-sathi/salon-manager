// The Firebase project config, and nothing else.
//
// Split out of firebase.js so a second entry point can reach it WITHOUT importing that module.
// firebase.js calls getAuth() and getStorage() at module scope, so importing it pulls both SDKs
// into whatever bundle touches it — and the public booking page (src/book/) needs neither. It
// signs nobody in and uploads nothing; it reads a world-readable projection and writes one
// record. Handing it firebase.js would have shipped the auth and storage SDKs to every customer
// who opened the link.
//
// There is deliberately no side effect in this file: no initializeApp, no getDatabase. Both
// entry points build their own app from this one literal, which is what stops the two from
// drifting apart.
//
// ⚠ e2e/fixtures/seed.js PARSES THIS FILE as text to derive the emulator's database namespace.
// It does that rather than keeping a copy, because the emulator creates any namespace on demand:
// a drifted copy would not error, it would seed the roster beside the one the app reads, the app
// would find shop/users empty, and whoever signed in first would be bootstrapped as owner —
// every role spec passing for the wrong reason. If this block moves or changes shape, update the
// parser there (it names this file in its own error message) and the CLAUDE.md paragraph that
// documents it.

// These keys are client-side config and are SAFE TO BE PUBLIC — every web Firebase app ships
// its config. They identify the project; they don't grant access. Access is enforced by Firebase
// Auth plus the role-based rules in database.rules.json.
//
// Project: salon-manager-49a88 (Realtime Database in asia-southeast1 / Singapore).
// This is Salon Manager's OWN project — deliberately not the one grocery-store-manager uses,
// since both apps store under the same shop/<slice> paths and would overwrite each other.
//
// measurementId is intentionally omitted: it only feeds Google Analytics, which this app
// doesn't initialise.
export const firebaseConfig = {
  apiKey: "AIzaSyD7WR82tq1WItd98fmhcYdiycwPac1cMuI",
  authDomain: "salon-manager-49a88.firebaseapp.com",
  databaseURL: "https://salon-manager-49a88-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "salon-manager-49a88",
  storageBucket: "salon-manager-49a88.firebasestorage.app",
  messagingSenderId: "380134454141",
  appId: "1:380134454141:web:0a7061e369bcd5c86f1214",
};

// True once the config above is a real, usable project config. The sign-in screen uses this to
// show a clear "not connected yet" message instead of letting Firebase fail with an opaque
// auth/invalid-api-key error.
//
// This used to look for the string "PLACEHOLDER", which no longer occurs anywhere in the block
// above — so the check was always true and the sign-in banner was unreachable. It now checks the
// two things a fork actually gets wrong: a blanked-out value, and an apiKey that isn't a
// Firebase browser key. Google mints those as "AIza" + 35 chars of URL-safe base64; anything
// else (an empty string, "YOUR_API_KEY", a service-account key) cannot authenticate, so failing
// early with an explanation beats failing late with an SDK error code.
const FIREBASE_WEB_API_KEY = /^AIza[0-9A-Za-z_-]{35}$/;
export const isFirebaseConfigured =
  Object.values(firebaseConfig).every((v) => typeof v === "string" && v.trim() !== "") &&
  FIREBASE_WEB_API_KEY.test(firebaseConfig.apiKey);

// ---- local emulators ------------------------------------------------------------------
// Set VITE_USE_EMULATORS=1 to point at the local Firebase emulator suite instead of the live
// project above. The end-to-end suite (see e2e/) always sets it; `npm run dev` does not, so
// ordinary development still talks to the real project.
//
// This exists because the config above is a REAL salon's data. Without a switch, any test that
// signs in and clicks through the app writes live appointments and live bills. The emulator is
// entirely local — it never contacts the project, whatever id it is run under.
//
// What actually protects a test run is NOT this flag on its own. The flag failing to arrive is
// an invisible failure: the app would quietly use the live project and the suite would pass
// while corrupting real data. The protection is that the e2e accounts exist ONLY in the auth
// emulator (e2e/fixtures/seed.js creates them on a database that is wiped every run). Point the
// suite at production by mistake and sign-in fails on the first spec, loudly. Keep it that way:
// never create these accounts in the live project, however convenient.
//
// The deploy workflow does not set the variable, so a production build cannot reach here.
export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === "1";

// Defaults match firebase.json. Vite only substitutes STATICALLY-written import.meta.env keys,
// so these cannot be looked up through a helper with a computed name.
export const EMULATOR = {
  host: import.meta.env.VITE_EMULATOR_HOST || "127.0.0.1",
  authPort: Number(import.meta.env.VITE_EMULATOR_AUTH_PORT || 9099),
  dbPort: Number(import.meta.env.VITE_EMULATOR_DB_PORT || 9000),
  storagePort: Number(import.meta.env.VITE_EMULATOR_STORAGE_PORT || 9199),
};
