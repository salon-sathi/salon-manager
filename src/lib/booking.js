// Online booking — the arithmetic behind the public link.
//
// A customer opening /book/ is not signed in and never will be. They must never see a stylist's
// name, and they must never read the diary: `shop/appointments` holds phone numbers and notes.
// So the salon publishes a PII-free mirror of what a booking page actually needs, and the
// customer writes into a node the diary does not depend on. This module is all three parts of
// that: the builders that produce the mirror, the availability maths the public page runs, and
// the importer that turns a customer's booking into a real appointment.
//
// Pure: no React, no Firebase. `publicSync.js` is the thin adapter that writes what this returns.
//
// ── The shape of it ───────────────────────────────────────────────────────────────────────────
//   shop/public/{profile,services,chairs,slots}   world-readable projection, owner/staff-written
//   shop/publicBookings/<id>                      the customer's inbox: create-only, unauth
//   shop/appointments/<id>                        unchanged, and unreachable from the public page
//
// The customer writes the inbox entry AND its occupancy stub in one atomic fan-out. Any staff
// device with the app open then imports the entry into the diary — appointment written, inbox
// entry nulled, in a single atomic update, so an entry that is gone has been imported.
//
// WHY AN INBOX, and not a create-only rule on shop/appointments: RTDB `.write` rules CASCADE and
// only ever grant. The appointments slice already grants write to every active user, so a $id
// rule could not restrict staff — it could only add the public branch, leaving `.validate` as the
// only constraint. But `.validate` applies to every writer, so each field rule would need an
// `auth != null ||` escape hatch: a dozen dual-purpose expressions guarding the app's busiest
// node, where forgetting one hatch breaks the counter and forgetting one `auth == null` hands a
// signed-in stranger an unvalidated write into the live diary. The inbox needs none of that.
//
// ── Two rules decide whether a slot is offered, and they are not the same rule ────────────────
// 1. CAPACITY — how many customers the salon can have in the building at once. Owner-set,
//    default 3. This is PEAK CONCURRENCY, not a count of overlapping records: see
//    peakConcurrency below for why the difference is not academic.
// 2. A FREE CHAIR — some active stylist with nothing else booked across the whole slot. The
//    customer never picks one and never sees one; the importer assigns it, against the real
//    diary rather than against the published projection.
//
// A salon with two stylists and a capacity of 3 is limited by its chairs; one with six stylists
// and a capacity of 3 is limited by the cap. Both checks run, always.
//
// ── What the cap counts ───────────────────────────────────────────────────────────────────────
// A `blocked` record is a stylist's lunch or leave. It takes that chair out of service but it is
// NOT a customer in the salon, so it does not consume capacity. That distinction is the whole
// reason a stub carries `kind`. It is also how a salon closes a whole day without a closed-dates
// feature: block every stylist, and the link finds no free chair all day.

import { SLOT_MIN, DEFAULT_HOURS, parseHM, rangesOverlap, occupiesChair, addDays } from "./appointments.js";
import { normalizePhone, isValidPhone } from "./customers.js";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** The furthest ahead the owner may set the booking horizon. A year of empty slot grids is not a
 *  feature, and the slots projection is written for every day in the window. */
export const MAX_HORIZON_DAYS = 60;

export const BOOKING_DEFAULTS = {
  enabled: false, // off until the owner turns it on — a link nobody asked for takes no bookings
  capacity: 3,
  leadMinutes: 60,
  horizonDays: 14,
  noticeText: "",
};

/**
 * The online-booking rules in force, with every field defaulted.
 *
 * Same contract as loyaltyRules(): this reads the shop/config singleton, which is owner-edited
 * and can be partial, stale or absent entirely. A missing config must mean "online booking is
 * off", never a crash — and never, ever "on".
 */
export function bookingSettings(config) {
  const c = (config && typeof config === "object" && config.onlineBooking) || {};
  return {
    enabled: c.enabled === true, // opt IN, unlike loyalty: this one is visible to the public
    capacity: Math.min(20, Math.max(1, Math.round(num(c.capacity ?? BOOKING_DEFAULTS.capacity)))),
    leadMinutes: Math.max(0, Math.round(num(c.leadMinutes ?? BOOKING_DEFAULTS.leadMinutes))),
    horizonDays: Math.min(MAX_HORIZON_DAYS, Math.max(1, Math.round(num(c.horizonDays ?? BOOKING_DEFAULTS.horizonDays)))),
    noticeText: str(c.noticeText).slice(0, 200),
  };
}

/**
 * Opening hours from the config, in minutes.
 *
 * Written out rather than reusing the `parseHM(x) || default` idiom in Appointments.jsx: that
 * idiom turns a legitimate "00:00" into the default, because 0 is falsy. Nobody opens at
 * midnight, but a helper that silently rewrites its input is the kind of thing that gets copied.
 */
export function hoursFromConfig(config) {
  const open = parseHM(config?.openTime);
  const close = parseHM(config?.closeTime);
  const openMin = Number.isFinite(open) ? open : DEFAULT_HOURS.openMin;
  const closeMin = Number.isFinite(close) ? close : DEFAULT_HOURS.closeMin;
  return closeMin > openMin ? { openMin, closeMin } : { ...DEFAULT_HOURS };
}

// ── the salon's clock, not the customer's ─────────────────────────────────────────────────────
//
// Every date in this app is a local YYYY-MM-DD and every time is minutes-since-local-midnight
// (see the header of appointments.js). That is exactly right when the only devices are behind
// the counter. It stops being right the moment a customer's own phone decides what "today" is:
// somebody booking from another timezone would be offered — and would book — the salon's
// yesterday. So the profile publishes the salon's IANA zone and the public page derives the day
// and the lead-time cutoff from THAT, never from the device.

/** A timestamp as YYYY-MM-DD in `timeZone`. en-CA formats exactly that way. */
export function dateInZone(ms, timeZone) {
  const d = new Date(num(ms));
  if (Number.isNaN(d.getTime())) return "";
  const opts = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: timeZone || undefined }).format(d);
  } catch {
    // An unknown zone must not take the booking page down; the device's own is a safe fallback.
    return new Intl.DateTimeFormat("en-CA", opts).format(d);
  }
}

/** A timestamp as minutes since midnight in `timeZone`. */
export function minutesInZone(ms, timeZone) {
  const d = new Date(num(ms));
  if (Number.isNaN(d.getTime())) return 0;
  const opts = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: timeZone || undefined }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", opts).formatToParts(d);
  }
  const at = (type) => num(parts.find((p) => p.type === type)?.value);
  return at("hour") * 60 + at("minute");
}

/** The zone this device is in — what the owner's browser publishes for the salon. */
export function deviceTimeZone() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

// ── availability ──────────────────────────────────────────────────────────────────────────────

/**
 * The most appointments running at any single instant.
 *
 * This is NOT "how many records overlap the proposed slot", and the difference decides real
 * bookings. Take a salon with a capacity of 3 and a day holding
 *
 *     A 10:00–10:45     B 10:45–11:30     C 10:15–11:00
 *
 * and a customer asking for D 10:00–11:00. D overlaps all three records, so an overlap count
 * says "3 already, refuse the 4th". But A has left before B arrives: the busiest single minute
 * with D added holds only 3 people. Counting overlaps would turn away a customer the salon has
 * room for, every time bookings are staggered — which is what a salon's day looks like.
 *
 * Swept as events. A range ending at 10:45 and one starting at 10:45 are not concurrent, which
 * is the same half-open [start, end) convention rangesOverlap uses, and is why the sort puts
 * ends before starts at equal times.
 */
export function peakConcurrency(intervals) {
  const events = [];
  for (const it of intervals || []) {
    const start = num(it?.startMin);
    const end = start + num(it?.durationMin);
    if (end <= start) continue; // a zero-length booking occupies nobody
    events.push([start, 1], [end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0;
  let peak = 0;
  for (const [, delta] of events) {
    running += delta;
    if (running > peak) peak = running;
  }
  return peak;
}

/** Everything in `occupancy` that shares a minute with the proposed slot. */
export function overlapping(occupancy, { startMin, durationMin }) {
  const start = num(startMin);
  const end = start + num(durationMin);
  return (occupancy || []).filter((o) =>
    rangesOverlap(start, end, num(o?.startMin), num(o?.startMin) + num(o?.durationMin))
  );
}

/** Minutes already committed per chair, for picking the quietest one. */
export function chairLoad(occupancy) {
  const load = new Map();
  for (const o of occupancy || []) {
    const id = str(o?.staffId);
    if (!id) continue;
    load.set(id, (load.get(id) || 0) + Math.max(0, num(o?.durationMin)));
  }
  return load;
}

/** The chairs with nothing booked across the whole of the proposed slot. */
export function freeChairs(occupancy, chairIds, slot) {
  const busy = new Set(overlapping(occupancy, slot).map((o) => str(o?.staffId)));
  return (chairIds || []).map(String).filter((id) => id && !busy.has(id));
}

/** A tiny deterministic string hash. Not security, not distribution — just a stable number. */
function hashSeed(seed) {
  let h = 5381;
  const s = str(seed);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Pick the chair for a booking: free across the slot, then quietest so far today.
 *
 * Ties break on a hash of `seed` (the booking id, which is random per booking) rather than
 * alphabetically. That is deliberate. Two customers booking the same slot seconds apart are
 * imported from the same diary snapshot, and a deterministic tie-break would send BOTH to the
 * same stylist and double-book them. Hashing the id spreads them across chairs the salon
 * actually has, so nobody has to be rung back.
 *
 * `fallback: true` returns the quietest chair even when none is free — see assignForImport.
 * Returns "" when there are no chairs at all.
 */
export function assignChair(occupancy, chairIds, slot, seed = "", { fallback = false } = {}) {
  const ids = (chairIds || []).map(String).filter(Boolean);
  if (!ids.length) return "";
  const free = freeChairs(occupancy, ids, slot);
  const pool = free.length ? free : fallback ? ids : [];
  if (!pool.length) return "";
  const load = chairLoad(occupancy);
  const quietest = Math.min(...pool.map((id) => load.get(id) || 0));
  const ties = pool.filter((id) => (load.get(id) || 0) === quietest).sort();
  return ties[hashSeed(seed) % ties.length];
}

/**
 * May this slot be booked, and by which chair?
 *
 * Returns `{ ok, reason, staffId }` — `reason` is "duration" | "full" | "no-chair" | "".
 *
 * Only the records that overlap the proposed slot are swept. Sweeping the whole day would let a
 * pre-existing overbooking at 9am refuse an 8pm booking, which is nonsense; and it cannot miss
 * anything, because two records that are concurrent with each other outside the slot but both
 * reach into it are necessarily concurrent inside it too.
 */
export function canBook(occupancy, chairIds, slot, capacity, seed = "") {
  const startMin = num(slot?.startMin);
  const durationMin = num(slot?.durationMin);
  if (durationMin <= 0) return { ok: false, reason: "duration", staffId: "" };

  const nearby = overlapping(occupancy, { startMin, durationMin });
  // Blocked time takes a chair out of service without putting a customer in the building.
  const customers = nearby.filter((o) => o?.kind !== "block");
  const peak = peakConcurrency([...customers, { startMin, durationMin }]);
  if (peak > Math.max(1, num(capacity))) return { ok: false, reason: "full", staffId: "" };

  const staffId = assignChair(nearby, chairIds, { startMin, durationMin }, seed);
  if (!staffId) return { ok: false, reason: "no-chair", staffId: "" };
  return { ok: true, reason: "", staffId };
}

/**
 * Every start time the salon can actually take, for one day and one basket of services.
 *
 * `minStartMin` is how "we need an hour's notice" arrives: on today it is the salon's current
 * minute plus the lead time, on any later day it is irrelevant and should be left out.
 */
export function bookableSlots(occupancy, chairIds, opts = {}) {
  const {
    openMin, closeMin, durationMin, capacity,
    minStartMin = -Infinity, step = SLOT_MIN, seed = "",
  } = opts;
  const duration = num(durationMin);
  const out = [];
  if (duration <= 0) return out;
  const last = num(closeMin) - duration; // a booking must FINISH by closing time
  const stride = Math.max(1, num(step) || SLOT_MIN);
  for (let t = num(openMin); t <= last; t += stride) {
    if (t < minStartMin) continue;
    const verdict = canBook(occupancy, chairIds, { startMin: t, durationMin: duration }, capacity, seed);
    if (verdict.ok) out.push({ startMin: t, staffId: verdict.staffId });
  }
  return out;
}

// ── the public projection: builders ───────────────────────────────────────────────────────────

/** True for a URL it is safe to put in an href on a page anyone can open. */
export function isSafeHttpUrl(raw) {
  const s = str(raw).trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The map link for the shop.
 *
 * Derived from the address by default, so the owner gets a working "Get directions" without
 * hunting for a share link; the Settings field is an OVERRIDE for when the derived search lands
 * on the wrong side of the road.
 *
 * Checked with isSafeHttpUrl on the way in AND again on the way out. A `javascript:` URL saved
 * into config would otherwise become script on a page served to the public, and a stored value
 * that only the writer validated is a value nobody validated.
 */
export function mapsUrlFor(address, override) {
  if (isSafeHttpUrl(override)) return str(override).trim();
  const query = str(address).trim();
  if (!query) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * What the booking page is allowed to know about the salon.
 *
 * `store` is the output of effectiveStore(config) — the caller already has it, and importing
 * lib/ui from lib would point the dependency the wrong way round. `config` is passed as well
 * because openTime/closeTime are NOT part of effectiveStore.
 *
 * Nothing here is a secret, and that is the point: this object is world-readable, so anything
 * added to it is published. No staff names, no customer phones, no takings.
 */
export function buildProfile(store, config, { updatedAt = "", timeZone = "" } = {}) {
  const rules = bookingSettings(config);
  const hours = hoursFromConfig(config);
  return {
    name: str(store?.name),
    tagline: str(store?.tagline),
    address: str(store?.address),
    phone: str(store?.phone),
    mapsUrl: mapsUrlFor(store?.address, store?.mapsUrl),
    theme: str(store?.theme) || "emerald",
    timeZone: str(timeZone),
    openMin: hours.openMin,
    closeMin: hours.closeMin,
    enabled: rules.enabled,
    capacity: rules.capacity,
    leadMinutes: rules.leadMinutes,
    horizonDays: rules.horizonDays,
    noticeText: rules.noticeText,
    updatedAt: str(updatedAt),
  };
}

/** The menu, stripped to what a customer chooses from. No commission, no consumables, no cost. */
export function buildPublicServices(services) {
  const out = {};
  for (const s of services || []) {
    if (!s?.id || s.active === false) continue;
    if (num(s.durationMin) <= 0) continue; // unbookable: it would never fill a slot
    out[str(s.id)] = {
      name: str(s.name),
      category: str(s.category),
      durationMin: num(s.durationMin),
      price: num(s.price),
    };
  }
  return out;
}

/**
 * The chairs, as opaque ids and nothing else.
 *
 * The customer's page needs to know how many chairs there are and which are free, and it must
 * not learn whose they are. An id from uid() carries no name, so this is the whole record.
 */
export function buildChairs(staff) {
  const out = {};
  for (const s of staff || []) {
    if (!s?.id || s.active === false) continue;
    out[str(s.id)] = true;
  }
  return out;
}

/** The window the slots projection covers: `days` dates starting at `from`, inclusive. */
export const slotWindow = (from, days) =>
  Array.from({ length: Math.max(1, Math.round(num(days))) }, (_, i) => addDays(from, i));

/**
 * The occupancy stubs the salon's day implies, keyed "<date>/<id>".
 *
 * Derived every time from the diary plus anything still sitting in the inbox — never
 * incremented, never trusted from what is already published, exactly like the loyalty and
 * package reconcilers. Cancelled and no-show records free the chair, so they produce no stub and
 * their old one is removed.
 *
 * Un-imported inbox entries MUST be included. They are real bookings that simply have not been
 * materialised yet, and leaving them out would make the reconcile prune the customer's own stub
 * and re-offer a slot that is taken.
 */
export function buildSlotStubs(appointments, pending, { from, days }) {
  const window = new Set(slotWindow(from, days));
  const out = {};
  for (const a of appointments || []) {
    if (!a?.id || !window.has(a.date) || !occupiesChair(a)) continue;
    out[`${a.date}/${a.id}`] = {
      staffId: str(a.staffId),
      startMin: num(a.startMin),
      durationMin: num(a.durationMin),
      kind: a.status === "blocked" ? "block" : "appt",
    };
  }
  for (const e of pending || []) {
    if (!e?.id || !window.has(e.date)) continue;
    const key = `${e.date}/${e.id}`;
    if (out[key]) continue;
    out[key] = { staffId: "", startMin: num(e.startMin), durationMin: num(e.durationMin), kind: "appt" };
  }
  return out;
}

/**
 * The multi-path update that moves the published slots to `desired`.
 *
 * Deltas, never a whole-node set(). A set() would race a customer's in-flight booking: their
 * inbox entry lands, their stub is wiped by a staff device that had not seen it yet, and the
 * slot reads FREE while it is taken. That is the one failure this projection exists to prevent,
 * so it is worth the diff.
 *
 * For the same reason an orphan stub — one with no matching appointment and no inbox entry — is
 * only removed once it is older than `graceMs`. A booking a second old has simply not reached
 * this device yet. Days that have fallen out of the back of the window are dropped whole; days
 * past the horizon are left alone, since they are nobody's business here.
 */
export function slotStubDiff(remote, desired, { from, nowMs, stamp, graceMs = 60000 } = {}) {
  const updates = {};
  const horizon = new Set(slotWindow(from, MAX_HORIZON_DAYS));

  for (const [date, day] of Object.entries(remote || {})) {
    if (date < from) {
      updates[date] = null; // yesterday cannot be booked; stop publishing it
      continue;
    }
    if (!horizon.has(date)) continue;
    for (const [id, stub] of Object.entries(day || {})) {
      const key = `${date}/${id}`;
      const want = desired[key];
      if (!want) {
        if (num(nowMs) - num(stub?.createdAtMs) > graceMs) updates[key] = null;
        continue;
      }
      for (const field of ["staffId", "startMin", "durationMin", "kind"]) {
        if (stub?.[field] !== want[field]) updates[`${key}/${field}`] = want[field];
      }
    }
  }

  for (const [key, want] of Object.entries(desired)) {
    const [date, id] = key.split("/");
    if (remote?.[date]?.[id]) continue;
    updates[key] = { ...want, createdAtMs: stamp };
  }

  return { updates, changed: Object.keys(updates).length > 0 };
}

// ── the public projection: the read side ──────────────────────────────────────────────────────

/** One day of the published slots node, flattened for the availability maths. */
export function occupancyForDate(slots, date) {
  const day = (slots || {})[date] || {};
  return Object.entries(day).map(([id, s]) => ({
    id,
    staffId: str(s?.staffId),
    startMin: num(s?.startMin),
    durationMin: num(s?.durationMin),
    kind: s?.kind === "block" ? "block" : "appt",
  }));
}

/** The published menu as a sorted array, for rendering. */
export function publicServiceList(services) {
  return Object.entries(services || {})
    .map(([id, s]) => ({
      id,
      name: str(s?.name),
      category: str(s?.category),
      durationMin: num(s?.durationMin),
      price: num(s?.price),
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** Total duration and price of a basket, from the PUBLISHED menu. */
export function summarizePublic(serviceIds, services) {
  let durationMin = 0;
  let price = 0;
  const names = [];
  for (const id of serviceIds || []) {
    const s = (services || {})[String(id)];
    if (!s) continue;
    durationMin += num(s.durationMin);
    price += num(s.price);
    names.push(str(s.name));
  }
  return { durationMin, price: Math.round(price * 100) / 100, names };
}

// ── what the customer submits ─────────────────────────────────────────────────────────────────

/** Validate the customer's own details. Returns an error string, or null when it's bookable. */
export function validateBookingForm(form) {
  if (!(form?.serviceIds || []).length) return "Pick at least one service.";
  if (!str(form?.date)) return "Pick a day.";
  if (!Number.isFinite(Number(form?.startMin))) return "Pick a time.";
  if (!str(form?.name).trim()) return "Please enter your name.";
  if (str(form?.name).trim().length > 60) return "That name is too long.";
  if (!isValidPhone(normalizePhone(form?.phone))) return "Enter a valid 10-digit mobile number.";
  if (str(form?.note).length > 200) return "Please keep the note under 200 characters.";
  return null;
}

/**
 * The inbox entry a customer's booking becomes.
 *
 * No staffId: the chair is chosen at import time against the real diary, not against a
 * projection the customer could be reading a stale copy of. `durationMin` is STORED rather than
 * re-derived from serviceIds, because a service deleted between the booking and the import would
 * otherwise silently turn a 45-minute appointment into a zero-minute one.
 *
 * `createdAtMs` is the server's clock (ServerValue.TIMESTAMP), pinned by the rules as
 * `=== now`. Not Date.now(): a budget phone ten minutes out of step would fail any tolerance
 * window and lose the booking, and a far-future value would make the stub un-prunable.
 */
export function buildInboxEntry(form, { id, durationMin, stamp }) {
  return {
    id: str(id),
    date: str(form.date),
    startMin: num(form.startMin),
    durationMin: num(durationMin),
    serviceIds: [...(form.serviceIds || [])].map(String),
    customerName: str(form.name).trim().slice(0, 60),
    customerPhone: normalizePhone(form.phone),
    note: str(form.note).slice(0, 200),
    createdAtMs: stamp,
  };
}

/** The occupancy stub that must land atomically alongside it. */
export function buildInboxStub(entry, stamp) {
  return {
    startMin: num(entry.startMin),
    durationMin: num(entry.durationMin),
    kind: "appt",
    createdAtMs: stamp,
  };
}

// ── the import ────────────────────────────────────────────────────────────────────────────────

/**
 * Split the inbox into what still needs importing and what is already in the diary.
 *
 * The appointment takes the INBOX ID, which is what makes the import idempotent: two staff
 * devices draining the same entry at the same moment derive byte-identical records, and a
 * booking the salon later deletes can never be resurrected, because the entry that would
 * resurrect it went in the same atomic update as the appointment.
 */
export function splitInbox(inbox, appointments) {
  const known = new Set((appointments || []).map((a) => str(a?.id)));
  const toImport = [];
  const toClear = [];
  for (const [id, entry] of Object.entries(inbox || {})) {
    if (!entry || typeof entry !== "object") {
      toClear.push(String(id));
      continue;
    }
    if (known.has(String(id))) toClear.push(String(id));
    else toImport.push({ ...entry, id: String(id) });
  }
  toImport.sort((a, b) => num(a.createdAtMs) - num(b.createdAtMs) || a.id.localeCompare(b.id));
  return { toImport, toClear };
}

/**
 * Choose the chair for an entry being imported.
 *
 * Unlike the public page, this runs against the real diary, and it never refuses: a booking the
 * salon has already accepted must reach the diary even if the slot filled up in between. When no
 * chair is free it falls back to the quietest one, so the clash lands somewhere VISIBLE —
 * layoutDay renders overlapping blocks side by side precisely so a problem like this is looked
 * at rather than hidden. An appointment with no staffId would render in no column at all.
 */
export function assignForImport(appointments, chairIds, entry) {
  const sameDay = (appointments || [])
    .filter((a) => a.date === entry.date && occupiesChair(a))
    .map((a) => ({
      staffId: str(a.staffId),
      startMin: num(a.startMin),
      durationMin: num(a.durationMin),
      kind: a.status === "blocked" ? "block" : "appt",
    }));
  return assignChair(sameDay, chairIds, entry, entry.id, { fallback: true });
}

/**
 * The appointment an inbox entry becomes. Every field is derived from the entry — no uid(), no
 * Date.now() — so concurrent importers agree exactly.
 *
 * `startMin` is clamped into opening hours. A booking that starts before the salon opens renders
 * at a negative offset in the diary and disappears off the top of the grid, which is how an
 * appointment gets silently lost; if the owner narrows the hours after a booking is taken, the
 * booking must still be visible.
 */
export function importedAppointment(entry, { staffId, hours = DEFAULT_HOURS, timeZone = "" }) {
  const duration = Math.max(SLOT_MIN, num(entry.durationMin));
  const latest = Math.max(hours.openMin, hours.closeMin - duration);
  const startMin = Math.min(Math.max(num(entry.startMin), hours.openMin), latest);
  return {
    id: str(entry.id),
    date: str(entry.date),
    staffId: str(staffId),
    startMin,
    durationMin: duration,
    serviceIds: [...(entry.serviceIds || [])].map(String),
    customerPhone: str(entry.customerPhone),
    customerName: str(entry.customerName),
    status: "booked",
    note: str(entry.note),
    billId: "",
    source: "online",
    createdAt: dateInZone(entry.createdAtMs, timeZone),
  };
}
