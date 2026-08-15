// Firebase init for Salon Manager — Auth (email/password) + Realtime Database + Storage.
//
// These keys are client-side config and are SAFE TO BE PUBLIC — every web Firebase app
// ships its config. They identify the project; they don't grant access. Access is enforced
// by Firebase Auth plus the role-based rules in database.rules.json, which is why deploying
// those rules is part of setup rather than an optional extra:
//
//   firebase deploy --only database
//
// Without them the database sits on whatever the console last had live — which for a
// freshly-created project is locked mode, denying everyone including the owner.
//
// The first account to sign in while shop/users is empty claims ownership; after that the
// node locks down and only an owner can add staff (Settings → Users).
//
// To point this at a DIFFERENT project, replace the block below — and give it its own
// project. This app stores everything under the same `shop/<slice>` paths that
// grocery-store-manager uses, so sharing one project would have the two overwrite each
// other's live data.
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";
import { connectStorageEmulator, getStorage } from "firebase/storage";

// Project: salon-manager-49a88 (Realtime Database in asia-southeast1 / Singapore).
// This is Salon Manager's OWN project — deliberately not the one grocery-store-manager uses,
// since both apps store under the same shop/<slice> paths and would overwrite each other.
//
// measurementId is intentionally omitted: it only feeds Google Analytics, which this app
// doesn't initialise.
const firebaseConfig = {
  apiKey: "AIzaSyD7WR82tq1WItd98fmhcYdiycwPac1cMuI",
  authDomain: "salon-manager-49a88.firebaseapp.com",
  databaseURL: "https://salon-manager-49a88-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "salon-manager-49a88",
  storageBucket: "salon-manager-49a88.firebasestorage.app",
  messagingSenderId: "380134454141",
  appId: "1:380134454141:web:0a7061e369bcd5c86f1214",
};

// True once the config above is a real, usable project config. The sign-in screen uses this
// to show a clear "not connected yet" message instead of letting Firebase fail with an
// opaque auth/invalid-api-key error.
//
// This used to look for the string "PLACEHOLDER", which no longer occurs anywhere in the
// block above — so the check was always true and the sign-in banner was unreachable. It now
// checks the two things a fork actually gets wrong: a blanked-out value, and an apiKey that
// isn't a Firebase browser key. Google mints those as "AIza" + 35 chars of URL-safe base64;
// anything else (an empty string, "YOUR_API_KEY", a service-account key) cannot authenticate,
// so failing early with an explanation beats failing late with an SDK error code.
const FIREBASE_WEB_API_KEY = /^AIza[0-9A-Za-z_-]{35}$/;
export const isFirebaseConfigured =
  Object.values(firebaseConfig).every((v) => typeof v === "string" && v.trim() !== "") &&
  FIREBASE_WEB_API_KEY.test(firebaseConfig.apiKey);

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);

// ---- local emulators ----------------------------------------------------------------
// Set VITE_USE_EMULATORS=1 to point auth, the database and storage at the local Firebase
// emulator suite instead of the live project above. The end-to-end suite (see e2e/) always
// sets it; `npm run dev` does not, so ordinary development still talks to the real project.
//
// This exists because the config above is a REAL salon's data. Without a switch, any test
// that signs in and clicks through the app writes live appointments and live bills. The
// emulator is entirely local — it never contacts the project, whatever id it is run under.
//
// What actually protects a test run is NOT this flag on its own. The flag failing to arrive
// is an invisible failure: the app would quietly use the live project and the suite would
// pass while corrupting real data. The protection is that the e2e accounts exist ONLY in the
// auth emulator (e2e/fixtures/seed.js creates them on a database that is wiped every run).
// Point the suite at production by mistake and sign-in fails on the first spec, loudly.
// Keep it that way: never create these accounts in the live project, however convenient.
//
// The deploy workflow does not set the variable, so a production build cannot reach here.
export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === "1";

if (usingEmulators) {
  // Defaults match firebase.json. Vite only substitutes STATICALLY-written import.meta.env
  // keys, so these cannot be looked up through a helper with a computed name.
  const host = import.meta.env.VITE_EMULATOR_HOST || "127.0.0.1";
  const authPort = Number(import.meta.env.VITE_EMULATOR_AUTH_PORT || 9099);
  const dbPort = Number(import.meta.env.VITE_EMULATOR_DB_PORT || 9000);
  const storagePort = Number(import.meta.env.VITE_EMULATOR_STORAGE_PORT || 9199);

  // disableWarnings silences the emulator's banner, which otherwise overlays the page and
  // sits on top of the sign-in button — Playwright clicks it instead of the button.
  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectDatabaseEmulator(db, host, dbPort);
  connectStorageEmulator(storage, host, storagePort);
  console.info(`[salon-manager] using Firebase emulators at ${host} (auth ${authPort}, db ${dbPort}, storage ${storagePort})`);
}

// Creating a user with the client SDK signs that new user in, which would kick the owner
// out of their own session. The standard workaround is a SECOND, throwaway app instance:
// create the account on it, then sign it out. The owner's session lives on the primary
// `app` above and is never touched.
// Used by Settings → Users (owner only). See src/lib/roles.js for the permission matrix.
export const secondaryApp = () => initializeApp(firebaseConfig, "userCreator");
