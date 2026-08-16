import { describe, it, expect } from "vitest";
import {
  BOOKING_DEFAULTS, MAX_HORIZON_DAYS,
  bookingSettings, hoursFromConfig,
  dateInZone, minutesInZone,
  peakConcurrency, overlapping, chairLoad, freeChairs, assignChair, canBook, bookableSlots,
  isSafeHttpUrl, mapsUrlFor,
  buildProfile, buildPublicServices, buildChairs, slotWindow, buildSlotStubs, slotStubDiff,
  occupancyForDate, publicServiceList, summarizePublic,
  validateBookingForm, buildInboxEntry, buildInboxStub,
  splitInbox, assignForImport, importedAppointment,
} from "./booking.js";
import { DEFAULT_HOURS, SLOT_MIN } from "./appointments.js";

const appt = (startMin, durationMin, staffId = "a", extra = {}) => ({
  staffId, startMin, durationMin, kind: "appt", ...extra,
});

describe("bookingSettings — fails closed", () => {
  it("is OFF when there is no config at all", () => {
    for (const v of [undefined, null, {}, { onlineBooking: null }, "nonsense"]) {
      expect(bookingSettings(v).enabled).toBe(false);
    }
  });

  it("only `true` turns it on — not a truthy string, not 1", () => {
    expect(bookingSettings({ onlineBooking: { enabled: "yes" } }).enabled).toBe(false);
    expect(bookingSettings({ onlineBooking: { enabled: 1 } }).enabled).toBe(false);
    expect(bookingSettings({ onlineBooking: { enabled: true } }).enabled).toBe(true);
  });

  it("defaults every other field", () => {
    const s = bookingSettings({});
    expect(s.capacity).toBe(BOOKING_DEFAULTS.capacity);
    expect(s.leadMinutes).toBe(BOOKING_DEFAULTS.leadMinutes);
    expect(s.horizonDays).toBe(BOOKING_DEFAULTS.horizonDays);
    expect(s.noticeText).toBe("");
  });

  it("clamps nonsense the owner (or a hand-edited config) could supply", () => {
    const s = bookingSettings({ onlineBooking: { capacity: 0, leadMinutes: -5, horizonDays: 9999 } });
    expect(s.capacity).toBe(1); // a capacity of 0 would be a link that never books
    expect(s.leadMinutes).toBe(0);
    expect(s.horizonDays).toBe(MAX_HORIZON_DAYS);
    expect(bookingSettings({ onlineBooking: { capacity: "abc" } }).capacity).toBe(1);
  });
});

describe("hoursFromConfig", () => {
  it("reads the owner's hours", () => {
    expect(hoursFromConfig({ openTime: "09:00", closeTime: "20:30" })).toEqual({ openMin: 540, closeMin: 1230 });
  });

  it("falls back when either time is missing or unparseable", () => {
    expect(hoursFromConfig({})).toEqual(DEFAULT_HOURS);
    expect(hoursFromConfig({ openTime: "nope", closeTime: "20:00" }).openMin).toBe(DEFAULT_HOURS.openMin);
  });

  it("keeps 00:00 as midnight instead of treating 0 as absent", () => {
    // `parseHM(x) || default` is the idiom this helper exists to avoid: 0 is falsy.
    expect(hoursFromConfig({ openTime: "00:00", closeTime: "06:00" })).toEqual({ openMin: 0, closeMin: 360 });
  });

  it("refuses a closing time at or before opening", () => {
    expect(hoursFromConfig({ openTime: "20:00", closeTime: "09:00" })).toEqual(DEFAULT_HOURS);
    expect(hoursFromConfig({ openTime: "10:00", closeTime: "10:00" })).toEqual(DEFAULT_HOURS);
  });
});

describe("the salon's clock, not the customer's", () => {
  it("derives the salon's day from a timestamp, across the date line", () => {
    // 20:00 UTC on the 16th is already 01:30 on the 17th in Kolkata. A customer's own device
    // would offer the salon's yesterday.
    const ms = Date.UTC(2026, 7, 16, 20, 0, 0);
    expect(dateInZone(ms, "Asia/Kolkata")).toBe("2026-08-17");
    expect(dateInZone(ms, "UTC")).toBe("2026-08-16");
  });

  it("derives minutes-since-midnight in the salon's zone", () => {
    expect(minutesInZone(Date.UTC(2026, 7, 16, 20, 0, 0), "Asia/Kolkata")).toBe(90); // 01:30
    expect(minutesInZone(Date.UTC(2026, 7, 16, 18, 30, 0), "UTC")).toBe(1110); // 18:30
  });

  it("uses h23, so midnight is 0 and not 1440", () => {
    expect(minutesInZone(Date.UTC(2026, 7, 16, 0, 0, 0), "UTC")).toBe(0);
  });

  it("survives an unknown zone rather than taking the page down", () => {
    expect(() => dateInZone(Date.now(), "Not/AZone")).not.toThrow();
    expect(dateInZone(Date.now(), "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("peakConcurrency — the headline arithmetic", () => {
  it("counts people in the building, NOT records that overlap", () => {
    // A leaves before B arrives, so the busiest minute holds 2 — even though a proposed
    // 10:00–11:00 booking would overlap all three records. An overlap count would refuse a
    // customer the salon has room for.
    const day = [appt(600, 45), appt(645, 45), appt(615, 45)]; // 10:00, 10:45, 10:15
    expect(peakConcurrency(day)).toBe(2);
    expect(peakConcurrency([...day, appt(600, 60)])).toBe(3); // and 3 with the newcomer
  });

  it("treats back-to-back as not concurrent, matching rangesOverlap", () => {
    expect(peakConcurrency([appt(600, 60), appt(660, 60)])).toBe(1);
  });

  it("counts genuine stacking", () => {
    expect(peakConcurrency([appt(600, 60), appt(600, 60), appt(600, 60)])).toBe(3);
    expect(peakConcurrency([appt(600, 60), appt(630, 60), appt(645, 15)])).toBe(3);
  });

  it("ignores zero and negative durations, and empty input", () => {
    expect(peakConcurrency([])).toBe(0);
    expect(peakConcurrency(null)).toBe(0);
    expect(peakConcurrency([appt(600, 0), appt(600, -30)])).toBe(0);
  });
});

describe("chairs", () => {
  const chairs = ["asha", "bina", "cara"];

  it("finds what overlaps a proposed slot", () => {
    const day = [appt(600, 30), appt(660, 30)]; // 10:00–10:30 and 11:00–11:30
    expect(overlapping(day, { startMin: 615, durationMin: 30 })).toHaveLength(1);
    expect(overlapping(day, { startMin: 645, durationMin: 30 })).toHaveLength(1);
    expect(overlapping(day, { startMin: 720, durationMin: 30 })).toHaveLength(0);
    // 10:30–11:00 drops exactly into the gap: back-to-back on both sides, clashing with neither.
    expect(overlapping(day, { startMin: 630, durationMin: 30 })).toHaveLength(0);
  });

  it("sums committed minutes per chair", () => {
    const load = chairLoad([appt(600, 30, "asha"), appt(700, 45, "asha"), appt(600, 30, "bina")]);
    expect(load.get("asha")).toBe(75);
    expect(load.get("bina")).toBe(30);
  });

  it("frees only the chairs with nothing across the whole slot", () => {
    const day = [appt(600, 60, "asha")];
    expect(freeChairs(day, chairs, { startMin: 630, durationMin: 30 })).toEqual(["bina", "cara"]);
    expect(freeChairs(day, chairs, { startMin: 660, durationMin: 30 })).toEqual(chairs); // back-to-back
  });

  it("assigns the quietest free chair", () => {
    const day = [appt(540, 120, "asha"), appt(540, 30, "bina")];
    expect(assignChair(day, chairs, { startMin: 700, durationMin: 30 }, "seed")).toBe("cara");
  });

  it("spreads ties across chairs instead of always picking the first", () => {
    // The one thing standing between the salon and the worst case of the accepted race: two
    // customers booking the same empty slot must not both be sent to the same stylist.
    const picks = new Set(
      ["b1", "b2", "b3", "b4", "b5", "b6"].map((seed) => assignChair([], chairs, { startMin: 600, durationMin: 30 }, seed))
    );
    expect(picks.size).toBeGreaterThan(1);
    for (const p of picks) expect(chairs).toContain(p);
  });

  it("is stable for the same seed", () => {
    const slot = { startMin: 600, durationMin: 30 };
    expect(assignChair([], chairs, slot, "same")).toBe(assignChair([], chairs, slot, "same"));
  });

  it("returns nothing when every chair is busy, unless a fallback is asked for", () => {
    const full = chairs.map((id) => appt(600, 60, id));
    const slot = { startMin: 600, durationMin: 30 };
    expect(assignChair(full, chairs, slot, "x")).toBe("");
    expect(chairs).toContain(assignChair(full, chairs, slot, "x", { fallback: true }));
    expect(assignChair([], [], slot, "x", { fallback: true })).toBe("");
  });
});

describe("canBook", () => {
  const chairs = ["a", "b", "c", "d"];

  it("allows a booking that keeps the salon inside its capacity", () => {
    const day = [appt(600, 60, "a"), appt(600, 60, "b")];
    expect(canBook(day, chairs, { startMin: 600, durationMin: 60 }, 3, "s")).toMatchObject({ ok: true });
  });

  it("refuses the one that would put a 4th customer in the building", () => {
    const day = [appt(600, 60, "a"), appt(600, 60, "b"), appt(600, 60, "c")];
    expect(canBook(day, chairs, { startMin: 600, durationMin: 60 }, 3, "s")).toMatchObject({ ok: false, reason: "full" });
  });

  it("does not let a busy morning refuse an evening slot", () => {
    // Only the records overlapping the proposed slot are swept. Sweeping the whole day would
    // let a pre-existing 9am overbooking close the salon for the rest of it.
    const day = [appt(540, 60, "a"), appt(540, 60, "b"), appt(540, 60, "c"), appt(540, 60, "d")];
    expect(canBook(day, chairs, { startMin: 1080, durationMin: 60 }, 3, "s")).toMatchObject({ ok: true });
  });

  it("does not count blocked time toward capacity, but does take the chair", () => {
    const lunch = [
      appt(600, 60, "a", { kind: "block" }),
      appt(600, 60, "b", { kind: "block" }),
      appt(600, 60, "c", { kind: "block" }),
    ];
    // Three stylists at lunch is not three customers in the salon…
    const ok = canBook(lunch, chairs, { startMin: 600, durationMin: 60 }, 3, "s");
    expect(ok).toMatchObject({ ok: true, staffId: "d" }); // …but only chair d is free
    // …and with every chair blocked there is nobody to do it.
    const allOut = [...lunch, appt(600, 60, "d", { kind: "block" })];
    expect(canBook(allOut, chairs, { startMin: 600, durationMin: 60 }, 3, "s")).toMatchObject({ ok: false, reason: "no-chair" });
  });

  it("is bounded by chairs when the salon has fewer of them than its capacity", () => {
    const two = ["a", "b"];
    const day = [appt(600, 60, "a"), appt(600, 60, "b")];
    expect(canBook(day, two, { startMin: 600, durationMin: 60 }, 3, "s")).toMatchObject({ ok: false, reason: "no-chair" });
  });

  it("refuses a zero-length booking", () => {
    expect(canBook([], ["a"], { startMin: 600, durationMin: 0 }, 3)).toMatchObject({ ok: false, reason: "duration" });
  });
});

describe("bookableSlots", () => {
  const chairs = ["a", "b", "c"];
  const base = { openMin: 600, closeMin: 720, capacity: 3, durationMin: 30 };

  it("offers every slot that finishes by closing time", () => {
    const slots = bookableSlots([], chairs, base).map((s) => s.startMin);
    expect(slots).toEqual([600, 615, 630, 645, 660, 675, 690]); // 690+30 = 720 = close
  });

  it("never offers one that runs past closing", () => {
    const slots = bookableSlots([], chairs, { ...base, durationMin: 45 }).map((s) => s.startMin);
    expect(Math.max(...slots) + 45).toBeLessThanOrEqual(720);
  });

  it("honours the notice period", () => {
    const slots = bookableSlots([], chairs, { ...base, minStartMin: 660 }).map((s) => s.startMin);
    expect(slots[0]).toBe(660);
  });

  it("drops the slots the salon is full for", () => {
    const day = [appt(600, 30, "a"), appt(600, 30, "b"), appt(600, 30, "c")];
    const slots = bookableSlots(day, chairs, base).map((s) => s.startMin);
    expect(slots).not.toContain(600);
    expect(slots).not.toContain(615);
    expect(slots).toContain(630); // back-to-back is free again
  });

  it("returns nothing for a basket with no duration", () => {
    expect(bookableSlots([], chairs, { ...base, durationMin: 0 })).toEqual([]);
  });

  it("steps on the diary grid", () => {
    const slots = bookableSlots([], chairs, base).map((s) => s.startMin);
    for (const t of slots) expect(t % SLOT_MIN).toBe(0);
  });
});

describe("the map link", () => {
  it("accepts only http(s)", () => {
    expect(isSafeHttpUrl("https://maps.app.goo.gl/abc")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl("maps.google.com")).toBe(false);
  });

  it("rejects a javascript: URL — this one ends up in an href on a public page", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl(" JavaScript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("derives a search link from the address when there is no override", () => {
    expect(mapsUrlFor("12 MG Road, Pune", "")).toBe(
      "https://www.google.com/maps/search/?api=1&query=12%20MG%20Road%2C%20Pune"
    );
  });

  it("prefers a valid override, and ignores an unsafe one", () => {
    expect(mapsUrlFor("12 MG Road", "https://maps.app.goo.gl/xyz")).toBe("https://maps.app.goo.gl/xyz");
    expect(mapsUrlFor("12 MG Road", "javascript:alert(1)")).toContain("google.com/maps");
  });

  it("is empty when there is nothing to point at", () => {
    expect(mapsUrlFor("", "")).toBe("");
  });
});

describe("the published projection", () => {
  const store = { name: "Glow", tagline: "Hair", address: "12 MG Road", phone: "9876500000", theme: "plum" };

  it("publishes the shop, the hours and the rules — and no staff", () => {
    const p = buildProfile(store, { openTime: "09:00", closeTime: "20:00", onlineBooking: { enabled: true } }, { timeZone: "Asia/Kolkata", updatedAt: "2026-08-16" });
    expect(p).toMatchObject({ name: "Glow", address: "12 MG Road", openMin: 540, closeMin: 1200, enabled: true, capacity: 3, timeZone: "Asia/Kolkata" });
    expect(p.mapsUrl).toContain("google.com/maps");
    expect(JSON.stringify(p)).not.toContain("staff");
  });

  it("reads hours from the config, which effectiveStore does not carry", () => {
    expect(buildProfile(store, { openTime: "11:00", closeTime: "19:00" }).openMin).toBe(660);
  });

  it("strips services down to the menu — no commission, no consumables", () => {
    const svc = buildPublicServices([
      { id: "s1", name: "Cut", category: "Hair", durationMin: 30, price: 300, commissionPct: 12, consumables: [{ itemId: "i1", qty: 2 }], active: true },
      { id: "s2", name: "Old", active: false, durationMin: 30 },
      { id: "s3", name: "Broken", durationMin: 0, active: true },
    ]);
    expect(svc).toEqual({ s1: { name: "Cut", category: "Hair", durationMin: 30, price: 300 } });
    expect(JSON.stringify(svc)).not.toContain("commission");
  });

  it("publishes chairs as bare ids, with no names", () => {
    const chairs = buildChairs([
      { id: "st1", name: "Asha", phone: "9876500001", color: "#123456", active: true },
      { id: "st2", name: "Gone", active: false },
    ]);
    expect(chairs).toEqual({ st1: true });
    expect(JSON.stringify(chairs)).not.toContain("Asha");
    expect(JSON.stringify(chairs)).not.toContain("9876500001");
  });

  it("covers a contiguous window of days", () => {
    expect(slotWindow("2026-08-16", 3)).toEqual(["2026-08-16", "2026-08-17", "2026-08-18"]);
  });
});

describe("slot stubs", () => {
  const win = { from: "2026-08-16", days: 3 };
  const diary = [
    { id: "a1", date: "2026-08-16", staffId: "s1", startMin: 600, durationMin: 45, status: "booked" },
    { id: "a2", date: "2026-08-16", staffId: "s1", startMin: 700, durationMin: 30, status: "cancelled" },
    { id: "a3", date: "2026-08-16", staffId: "s2", startMin: 780, durationMin: 60, status: "blocked" },
    { id: "a4", date: "2026-09-30", staffId: "s1", startMin: 600, durationMin: 30, status: "booked" },
  ];

  it("derives stubs from the diary and carries no PII", () => {
    const stubs = buildSlotStubs(diary, [], win);
    expect(Object.keys(stubs)).toEqual(["2026-08-16/a1", "2026-08-16/a3"]);
    expect(stubs["2026-08-16/a1"]).toEqual({ staffId: "s1", startMin: 600, durationMin: 45, kind: "appt" });
    expect(stubs["2026-08-16/a3"].kind).toBe("block");
    expect(JSON.stringify(stubs)).not.toContain("customer");
  });

  it("drops a cancelled booking's stub — the chair is free again", () => {
    expect(buildSlotStubs(diary, [], win)["2026-08-16/a2"]).toBeUndefined();
  });

  it("includes bookings still sitting in the inbox", () => {
    // They are real bookings that have not been materialised yet. Leaving them out would make
    // the reconcile prune the customer's own stub and re-offer a slot that is taken.
    const pending = [{ id: "p1", date: "2026-08-16", startMin: 900, durationMin: 30 }];
    expect(buildSlotStubs(diary, pending, win)["2026-08-16/p1"]).toEqual({ staffId: "", startMin: 900, durationMin: 30, kind: "appt" });
  });

  it("stays inside the window", () => {
    expect(buildSlotStubs(diary, [], win)["2026-09-30/a4"]).toBeUndefined();
  });
});

describe("slotStubDiff — deltas, never a whole-node set", () => {
  const from = "2026-08-16";
  const now = 1_800_000_000_000;
  const opts = { from, nowMs: now, stamp: "STAMP" };

  it("writes a new stub whole, with the server stamp", () => {
    const { updates, changed } = slotStubDiff({}, { "2026-08-16/a1": { staffId: "s1", startMin: 600, durationMin: 45, kind: "appt" } }, opts);
    expect(changed).toBe(true);
    expect(updates["2026-08-16/a1"]).toEqual({ staffId: "s1", startMin: 600, durationMin: 45, kind: "appt", createdAtMs: "STAMP" });
  });

  it("writes only the fields that moved", () => {
    const remote = { "2026-08-16": { a1: { staffId: "s1", startMin: 600, durationMin: 45, kind: "appt", createdAtMs: now - 999_999 } } };
    const { updates } = slotStubDiff(remote, { "2026-08-16/a1": { staffId: "s2", startMin: 600, durationMin: 45, kind: "appt" } }, opts);
    expect(updates).toEqual({ "2026-08-16/a1/staffId": "s2" });
  });

  it("does nothing at all when the projection already matches", () => {
    const stub = { staffId: "s1", startMin: 600, durationMin: 45, kind: "appt" };
    const remote = { "2026-08-16": { a1: { ...stub, createdAtMs: now - 999_999 } } };
    expect(slotStubDiff(remote, { "2026-08-16/a1": stub }, opts).changed).toBe(false);
  });

  it("will NOT prune a stub younger than the grace period", () => {
    // A booking a second old has simply not reached this device yet. Pruning it would re-offer
    // a slot that is taken — the exact failure this projection exists to prevent.
    const remote = { "2026-08-16": { fresh: { staffId: "", startMin: 600, durationMin: 30, kind: "appt", createdAtMs: now - 2_000 } } };
    expect(slotStubDiff(remote, {}, opts).changed).toBe(false);
  });

  it("prunes a genuinely orphaned stub once it is old enough", () => {
    const remote = { "2026-08-16": { gone: { staffId: "", startMin: 600, durationMin: 30, kind: "appt", createdAtMs: now - 120_000 } } };
    expect(slotStubDiff(remote, {}, opts).updates).toEqual({ "2026-08-16/gone": null });
  });

  it("drops days that have fallen behind the window", () => {
    const remote = { "2026-08-15": { old: { startMin: 600, durationMin: 30, createdAtMs: now } } };
    expect(slotStubDiff(remote, {}, opts).updates).toEqual({ "2026-08-15": null });
  });

  it("never emits an update that clears a whole live day", () => {
    const remote = { "2026-08-16": { a1: { staffId: "s1", startMin: 600, durationMin: 45, kind: "appt", createdAtMs: now - 999_999 } } };
    const { updates } = slotStubDiff(remote, {}, opts);
    expect(updates["2026-08-16"]).toBeUndefined();
  });
});

describe("reading the projection back", () => {
  it("flattens one day for the availability maths", () => {
    const slots = { "2026-08-16": { a1: { staffId: "s1", startMin: 600, durationMin: 45, kind: "appt" }, a2: { startMin: 700, durationMin: 30, kind: "block" } } };
    const day = occupancyForDate(slots, "2026-08-16");
    expect(day).toHaveLength(2);
    expect(day.find((d) => d.id === "a2")).toMatchObject({ staffId: "", kind: "block" });
    expect(occupancyForDate(slots, "2026-08-17")).toEqual([]);
    expect(occupancyForDate(null, "2026-08-16")).toEqual([]);
  });

  it("sorts the menu by category then name", () => {
    const list = publicServiceList({ s1: { name: "Wash", category: "Hair" }, s2: { name: "Cut", category: "Hair" }, s3: { name: "Facial", category: "Skin" } });
    expect(list.map((s) => s.name)).toEqual(["Cut", "Wash", "Facial"]);
  });

  it("totals a basket from the published menu, skipping anything deleted since", () => {
    const menu = { s1: { name: "Cut", durationMin: 30, price: 300 }, s2: { name: "Beard", durationMin: 15, price: 150 } };
    expect(summarizePublic(["s1", "s2", "gone"], menu)).toEqual({ durationMin: 45, price: 450, names: ["Cut", "Beard"] });
    expect(summarizePublic([], menu)).toEqual({ durationMin: 0, price: 0, names: [] });
  });
});

describe("what the customer submits", () => {
  const good = { date: "2026-08-16", startMin: 600, name: "Riya", phone: "9876500001" };

  it("accepts a complete booking", () => {
    expect(validateBookingForm(good)).toBeNull();
  });

  it("insists on a day, a time, a name and a real mobile — and nothing else", () => {
    expect(validateBookingForm({ ...good, date: "" })).toMatch(/day/i);
    expect(validateBookingForm({ ...good, startMin: NaN })).toMatch(/time/i);
    // Number(null) is 0, which is finite — so a null slot once slipped straight through and
    // the booking went in at midnight.
    expect(validateBookingForm({ ...good, startMin: null })).toMatch(/time/i);
    expect(validateBookingForm({ ...good, startMin: undefined })).toMatch(/time/i);
    // Services are deliberately not asked for; a form without them is complete.
    expect(validateBookingForm({ ...good, serviceIds: undefined })).toBeNull();
    expect(validateBookingForm({ ...good, name: "  " })).toMatch(/name/i);
    expect(validateBookingForm({ ...good, phone: "12345" })).toMatch(/mobile/i);
    expect(validateBookingForm({ ...good, phone: "1234567890" })).toMatch(/mobile/i); // must start 6-9
  });

  it("accepts a mobile the way a customer actually types it", () => {
    expect(validateBookingForm({ ...good, phone: "+91 98765 00001" })).toBeNull();
  });

  it("caps the free-text fields", () => {
    expect(validateBookingForm({ ...good, name: "x".repeat(61) })).toMatch(/too long/i);
    expect(validateBookingForm({ ...good, note: "x".repeat(201) })).toMatch(/200/);
  });

  it("normalises and truncates on the way into the inbox entry", () => {
    const entry = buildInboxEntry({ ...good, phone: "+91 98765 00001", name: "  Riya  " }, { id: "b1", durationMin: 45, stamp: "STAMP" });
    expect(entry).toMatchObject({ id: "b1", customerPhone: "9876500001", customerName: "Riya", durationMin: 45, createdAtMs: "STAMP" });
    expect(entry.staffId).toBeUndefined(); // the chair is chosen at import, against the real diary
    // Four fields and a stamp. Anything else here is a field the rules would refuse.
    expect(Object.keys(entry).sort()).toEqual(
      ["createdAtMs", "customerName", "customerPhone", "date", "durationMin", "id", "startMin"]
    );
  });

  it("builds the stub that must land atomically alongside it", () => {
    const entry = buildInboxEntry(good, { id: "b1", durationMin: 45, stamp: "S" });
    expect(buildInboxStub(entry, "S")).toEqual({ startMin: 600, durationMin: 45, kind: "appt", createdAtMs: "S" });
  });
});

describe("the import", () => {
  const entry = { id: "b1", date: "2026-08-16", startMin: 600, durationMin: 45, serviceIds: ["s1"], customerName: "Riya", customerPhone: "9876500001", note: "hi", createdAtMs: Date.UTC(2026, 7, 16, 4, 0, 0) };

  it("splits the inbox into what needs importing and what is already in the diary", () => {
    const inbox = { b1: entry, b2: { ...entry, id: "b2" }, b3: null };
    const { toImport, toClear } = splitInbox(inbox, [{ id: "b2" }]);
    expect(toImport.map((e) => e.id)).toEqual(["b1"]);
    expect(toClear.sort()).toEqual(["b2", "b3"]);
  });

  it("orders the inbox oldest first, so a queue drains fairly", () => {
    const inbox = { late: { ...entry, id: "late", createdAtMs: 200 }, early: { ...entry, id: "early", createdAtMs: 100 } };
    expect(splitInbox(inbox, []).toImport.map((e) => e.id)).toEqual(["early", "late"]);
  });

  it("assigns the quietest free chair from the REAL diary", () => {
    const diary = [
      { id: "x", date: "2026-08-16", staffId: "s1", startMin: 540, durationMin: 180, status: "booked" },
      { id: "y", date: "2026-08-16", staffId: "s2", startMin: 540, durationMin: 30, status: "booked" },
    ];
    expect(assignForImport(diary, ["s1", "s2", "s3"], entry)).toBe("s3");
  });

  it("still assigns a chair when the slot filled up in between", () => {
    // A booking the salon has already accepted must reach the diary. layoutDay renders the
    // clash side by side, which is how the desk gets to see it at all.
    const full = ["s1", "s2"].map((staffId) => ({ id: staffId, date: "2026-08-16", staffId, startMin: 600, durationMin: 60, status: "booked" }));
    expect(["s1", "s2"]).toContain(assignForImport(full, ["s1", "s2"], entry));
  });

  it("derives every field, so two devices importing at once agree exactly", () => {
    const args = { staffId: "s1", hours: DEFAULT_HOURS, timeZone: "Asia/Kolkata" };
    const a = importedAppointment(entry, args);
    const b = importedAppointment(entry, args);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      id: "b1", date: "2026-08-16", staffId: "s1", startMin: 600, durationMin: 45,
      customerName: "Riya", customerPhone: "9876500001", status: "booked", billId: "", source: "online",
    });
    expect(a.createdAt).toBe("2026-08-16"); // 04:00 UTC is 09:30 in Kolkata, still the 16th
  });

  it("takes the id from the inbox entry, which is what makes the import idempotent", () => {
    expect(importedAppointment(entry, { staffId: "s1" }).id).toBe("b1");
  });

  it("keeps the stored duration rather than re-deriving it from a deleted service", () => {
    expect(importedAppointment({ ...entry, serviceIds: ["deleted"] }, { staffId: "s1" }).durationMin).toBe(45);
  });

  it("clamps a booking into opening hours instead of losing it off the grid", () => {
    // A negative offset renders above the top of the diary, where nobody ever sees it.
    const hours = { openMin: 660, closeMin: 1200 };
    expect(importedAppointment(entry, { staffId: "s1", hours }).startMin).toBe(660);
    const late = { ...entry, startMin: 1190, durationMin: 60 };
    expect(importedAppointment(late, { staffId: "s1", hours }).startMin).toBe(1140); // finishes at close
  });
});
