// What time is it AT THE SALON.
//
// Every date this app stores — a bill's `date`, an appointment's `date`, a log entry, the day
// the diary opens on — used to come from the device clock. That is right when the device is on
// the counter and wrong the moment it is not: a till set to another country files the evening's
// takings under yesterday, stamps them with that country's time, and nothing in the app
// disagrees with it. It happened, on a real salon, and the bills are still in the data.
//
// So the salon's timezone is a SETTING (Settings → Online booking), and this module is where
// the rest of the app reads it from. It is ambient rather than threaded through because
// `todayStr()` alone has ~136 call sites across 26 files: passing a zone to each would be a
// bigger change, a riskier one, and would still leave every one of them able to forget.
//
// ── What this module does NOT change ────────────────────────────────────────────────────────
// `dateStr(d)` in format.js stays exactly as it was: "format this Date's own calendar fields".
// It is used two incompatible ways — `dateStr(new Date())` means "today", but
// `dateStr(new Date(y, m, 1))` and `dateStr(new Date(ds + "T00:00"))` are calendar arithmetic
// on a constructed local date, and re-reading those in another zone would shift every chart
// bucket and every date range by a day. Only "now" moved; construction did not.
//
// Date arithmetic on top of today is done as STRING arithmetic (see daysAgoStr) for the same
// reason: it stays correct whatever zone either end is in.

import { clockInZone, dateInZone, deviceTimeZone } from "../timezone.js";

// Module-level, deliberately. There is exactly one salon, and its timezone is a property of the
// salon rather than of any screen — the alternative is 136 call sites that each have to be
// handed the same value and each able to be given the wrong one.
let salonZone = "";

/**
 * Point the whole app at the salon's timezone. Called once from the entry point with the
 * cached config (so the first render is already right on any device that has run the app
 * before), and again whenever shop/config arrives or changes.
 *
 * An empty or unknown value falls back to the device, which is what the app did before this
 * existed — never a crash, never a wrong-but-confident answer.
 */
export function setSalonTimeZone(tz) {
  salonZone = typeof tz === "string" ? tz.trim() : "";
  return salonZone;
}

/** The salon's zone, or the device's when the salon has not set one. */
export const salonTimeZone = () => salonZone || deviceTimeZone();

/** Today at the salon, YYYY-MM-DD. The one every screen means when it says "today". */
export const todayStr = () => dateInZone(Date.now(), salonZone);

/** The time at the salon, as the bills and the activity log write it. */
export const nowTime = ({ seconds = false } = {}) => clockInZone(Date.now(), salonZone, { seconds });

/**
 * `n` days before today at the salon, YYYY-MM-DD.
 *
 * String arithmetic on top of a zone-correct today, not `new Date(); d.setDate(d.getDate()-n)`.
 * That idiom shifts an instant by n days in the DEVICE's calendar and then reads it back in the
 * device's calendar — fine on its own, but paired with a salon-zone "today" it produces ranges
 * whose two ends disagree about what day it is, and a report that quietly drops today's takings.
 */
export function daysAgoStr(n) {
  const at = salonTodayDate();
  at.setDate(at.getDate() - Math.round(Number(n) || 0));
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/**
 * Today at the salon, as a Date whose LOCAL calendar fields are the salon's date.
 *
 * The bridge for every bit of date arithmetic the app already had: `new Date(y, m - 3, …)`,
 * `d.setMonth(d.getMonth() - 1)`, `dateStr(d)`. Hand those a Date built this way and they keep
 * working exactly as written, but anchored to the salon's today instead of the device's — which
 * is the whole fix, applied in one place per range builder rather than rewritten per case.
 *
 * Noon, not midnight: whole-day and whole-month arithmetic then cannot be tipped across a
 * boundary by a DST shift in the device's own zone on the way past.
 */
export function salonTodayDate() {
  const [y, m, d] = todayStr().split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
