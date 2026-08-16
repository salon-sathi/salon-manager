// Firebase init for Salon Manager — Auth (email/password) + Realtime Database + Storage.
//
// The project config itself lives in firebaseConfig.js, which has no side effects, so the public
// booking page can build its own database-only app without dragging the auth and storage SDKs
// into a customer's browser. This module is the STAFF app's instance: it initialises all three,
// because the shell signs in on load.
//
// The keys are client-side config and are SAFE TO BE PUBLIC — they identify the project, they
// don't grant access. Access is enforced by Firebase Auth plus the role-based rules in
// database.rules.json, which is why deploying those rules is part of setup rather than an
// optional extra:
//
//   firebase deploy --only database
//
// Without them the database sits on whatever the console last had live — which for a
// freshly-created project is locked mode, denying everyone including the owner.
//
// The first account to sign in while shop/users is empty claims ownership; after that the node
// locks down and only an owner can add staff (Settings → Users).
//
// To point this at a DIFFERENT project, replace the block in firebaseConfig.js — and give it its
// own project. This app stores everything under the same `shop/<slice>` paths that
// grocery-store-manager uses, so sharing one project would have the two overwrite each other's
// live data.
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { EMULATOR, firebaseConfig, usingEmulators } from "./firebaseConfig.js";

export { isFirebaseConfigured, usingEmulators } from "./firebaseConfig.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);

if (usingEmulators) {
  const { host, authPort, dbPort, storagePort } = EMULATOR;
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
