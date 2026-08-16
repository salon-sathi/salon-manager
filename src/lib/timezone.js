// Reading a clock in a named timezone. Pure, and deliberately dependency-free.
//
// Two very different consumers import this, which is why it is its own module rather than
// living in either of them:
//
//   lib/booking.js   — takes an EXPLICIT zone (the one published to the booking page)
//   lib/ui/clock.js  — holds the salon's AMBIENT zone for the whole app
//
// It has no imports at all so that clock.js — which format.js pulls in, and which therefore
// ends up in the entry chunk of every screen — cannot drag the domain modules along with it.

/** A timestamp as YYYY-MM-DD in `timeZone`. en-CA formats exactly that way. */
export function dateInZone(ms, timeZone) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  const opts = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: timeZone || undefined }).format(d);
  } catch {
    // An unknown or mistyped zone must never take a screen down; the device's own is a safe
    // fallback, and is exactly what the app did before it knew about zones at all.
    return new Intl.DateTimeFormat("en-CA", opts).format(d);
  }
}

/** A timestamp as minutes since midnight in `timeZone`. */
export function minutesInZone(ms, timeZone) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return 0;
  // hourCycle h23, so midnight is 0 and not 24.
  const opts = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: timeZone || undefined }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", opts).formatToParts(d);
  }
  const at = (type) => Number(parts.find((p) => p.type === type)?.value) || 0;
  return at("hour") * 60 + at("minute");
}

/** A timestamp as a 12-hour clock string in `timeZone` — "05:30 pm", the shape bills carry. */
export function clockInZone(ms, timeZone, { seconds = false } = {}) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  const opts = {
    hour: "2-digit", minute: "2-digit", hour12: true,
    ...(seconds ? { second: "2-digit" } : {}),
  };
  const fmt = (o) => new Intl.DateTimeFormat("en-IN", o).format(d);
  // en-IN renders "05:30 pm" on some engines and "05:30 PM" on others; the app has always
  // shown lower case, and receipts and bill history are full of the old shape.
  try {
    return fmt({ ...opts, timeZone: timeZone || undefined }).toLowerCase();
  } catch {
    return fmt(opts).toLowerCase();
  }
}

/** The zone this device is in — the fallback, and what Settings offers as a default. */
export function deviceTimeZone() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}
