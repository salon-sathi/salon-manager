// The Firebase adapter for the public booking link.
//
// Everything this module writes is DERIVED — see lib/booking.js for the builders and the
// reasoning. This file is only the plumbing: which paths, and the one non-obvious write shape.
//
// It is deliberately separate from sync.js. `shop/publicBookings` must NOT become a slice:
// SLICES gets a debounced pusher, a 3-way merge and a localStorage entry, and the inbox holds a
// customer's name and phone number. The counter tablet is a shared device, which is exactly why
// the cache is filtered by role in the first place — putting an unimported booking in
// localStorage would walk straight around that.

import { ref, set, update, onValue, serverTimestamp } from "firebase/database";
import { db } from "./firebase.js";

const PROFILE = "shop/public/profile";
const SERVICES = "shop/public/services";
const CHAIRS = "shop/public/chairs";
const SLOTS = "shop/public/slots";
const INBOX = "shop/publicBookings";

/** The server's clock. The rules pin every createdAtMs to `=== now`, so this sentinel is the
 *  only value that will be accepted — and the customer's device clock never comes into it. */
export const stamp = () => serverTimestamp();

// ---- the projection (owner-written) --------------------------------------------------------
// One `set` each: these are whole-object singletons, like shop/config, not keyed slices.

export const writePublicProfile = (profile) => set(ref(db, PROFILE), profile);
export const writePublicServices = (map) => set(ref(db, SERVICES), map);
export const writePublicChairs = (map) => set(ref(db, CHAIRS), map);

// ---- occupancy (any active user) -----------------------------------------------------------

export const subscribePublicSlots = (onData, onError) =>
  onValue(ref(db, SLOTS), (snap) => onData(snap.val() || {}), onError);

/**
 * Apply the reconcile's deltas.
 *
 * `update`, never `set`. A whole-node set would race a customer's in-flight booking — their
 * inbox entry lands, their stub is wiped by a device that had not seen it yet, and the slot
 * reads free while it is taken. slotStubDiff builds these keys; it never emits one that clears
 * a live day.
 */
export const writeSlotUpdates = (updates) => update(ref(db, SLOTS), updates);

// ---- the inbox (any active user reads and drains) -------------------------------------------

export const subscribeInbox = (onData, onError) =>
  onValue(ref(db, INBOX), (snap) => onData(snap.val() || {}), onError);

/**
 * Import one booking: the appointment written and the inbox entry removed, atomically.
 *
 * A fan-out from the ROOT, so both paths land or neither does. That is the whole safety
 * property — an entry that is gone has been imported, and an appointment the salon later
 * deletes can never be resurrected, because the entry that would resurrect it went in the same
 * update. Two devices draining the same entry at once write byte-identical records
 * (importedAppointment derives every field from the entry), so the loser of that race is a
 * no-op rather than a duplicate.
 *
 * It cannot go through setAppointments: the debounced slice pusher would send the appointment
 * as a SEPARATE write from the inbox delete, and a failure between the two loses the booking.
 */
export const importBooking = (appointment) =>
  update(ref(db), {
    [`shop/appointments/${appointment.id}`]: appointment,
    [`${INBOX}/${appointment.id}`]: null,
  });

/** Drop entries whose appointment already exists — the tail of an import that half-landed. */
export const clearInboxEntries = (ids) =>
  update(ref(db, INBOX), Object.fromEntries(ids.map((id) => [id, null])));
