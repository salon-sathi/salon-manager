// The booking page's own Firebase app: Realtime Database only.
//
// NOT src/lib/firebase.js. That module calls getAuth() and getStorage() at import time, so any
// bundle touching it ships both SDKs — and this page signs nobody in and uploads nothing. It
// reads a world-readable projection and writes one record, and a customer on a phone should not
// download an auth stack to do it.
//
// The project config is shared (firebaseConfig.js) so the two apps cannot drift onto different
// projects. Two initializeApp calls with the same default name would clash inside one bundle;
// these are separate entry points, so only ever one of them runs.

import { initializeApp } from "firebase/app";
import { connectDatabaseEmulator, get, getDatabase, onValue, ref, serverTimestamp, update } from "firebase/database";
import { EMULATOR, firebaseConfig, usingEmulators } from "../lib/firebaseConfig.js";

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

if (usingEmulators) {
  connectDatabaseEmulator(db, EMULATOR.host, EMULATOR.dbPort);
  console.info(`[salon-manager/book] using the Firebase database emulator at ${EMULATOR.host}:${EMULATOR.dbPort}`);
}

/** Live subscription to a node under shop/public — the only subtree this page may read. */
export const watchPublic = (child, onData, onError) =>
  onValue(ref(db, `shop/public/${child}`), (snap) => onData(snap.val()), onError);

/** A one-shot read of the published occupancy, for re-checking a slot at the moment of booking. */
export const readSlots = async () => (await get(ref(db, "shop/public/slots"))).val() || {};

/**
 * Send the booking.
 *
 * ONE atomic fan-out from the root: the inbox entry the salon will import, and the occupancy
 * stub that makes the slot unavailable to the next customer immediately. Both land or neither
 * does — a booking that took a slot without recording it, or recorded one without the booking,
 * would be worse than a failure the customer can see and retry.
 *
 * The stub is what makes this work with no staff device online at all: the next visitor reads
 * the occupancy this one wrote, rather than waiting for the salon to open the app.
 */
export const sendBooking = (entry, stub) =>
  update(ref(db), {
    [`shop/publicBookings/${entry.id}`]: entry,
    [`shop/public/slots/${entry.date}/${entry.id}`]: stub,
  });

/** The server's clock. The rules pin createdAtMs to `=== now`, so nothing else is accepted —
 *  which is exactly why a customer's phone being ten minutes out never costs them a booking. */
export const stamp = () => serverTimestamp();
