import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setSalonTimeZone, salonTimeZone, todayStr, nowTime, daysAgoStr, salonTodayDate } from "./clock.js";
import { dateStr } from "./format.js";
import { deviceTimeZone } from "../timezone.js";

// The bug this module exists for, as a fixture.
//
// A salon in Pune ran its till on a laptop set to America/Indianapolis. At this instant it is
// 03:52 on the 17th at the salon and 18:22 on the 16th on the device — so every date the app
// wrote was a day out, and every time was nine and a half hours out. A ₹3,800 bill taken at
// four in the morning was filed under the previous evening.
const NOW = 1786918935933;
const SALON = "Asia/Kolkata"; // 2026-08-17 03:52
const TILL = "America/Indianapolis"; // 2026-08-16 18:22

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  setSalonTimeZone("");
});

afterEach(() => {
  setSalonTimeZone("");
  vi.restoreAllMocks();
});

describe("whose clock the app reads", () => {
  it("uses the salon's timezone, not the device's", () => {
    setSalonTimeZone(SALON);
    expect(todayStr()).toBe("2026-08-17");
  });

  it("would have said the 16th on the device that caused this", () => {
    // Not a hypothetical: this is the value the app actually recorded on that bill.
    setSalonTimeZone(TILL);
    expect(todayStr()).toBe("2026-08-16");
  });

  it("falls back to the device when the salon has not set one", () => {
    // The behaviour the app has always had — never a crash, and never a confident wrong answer
    // from a zone nobody chose.
    expect(todayStr()).toBe(dateStr(new Date(NOW)));
    expect(salonTimeZone()).toBe(deviceTimeZone());
  });

  it("falls back rather than throwing on a zone that does not exist", () => {
    setSalonTimeZone("Not/AZone");
    expect(() => todayStr()).not.toThrow();
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accepts the legacy alias a salon may already have saved", () => {
    // Asia/Calcutta is what the live shop has stored; it is the same zone as Asia/Kolkata.
    setSalonTimeZone("Asia/Calcutta");
    const calcutta = todayStr();
    setSalonTimeZone("Asia/Kolkata");
    expect(todayStr()).toBe(calcutta);
  });

  it("trims, and treats blank as unset", () => {
    expect(setSalonTimeZone("  Asia/Kolkata  ")).toBe("Asia/Kolkata");
    expect(setSalonTimeZone("   ")).toBe("");
    expect(setSalonTimeZone(null)).toBe("");
    expect(setSalonTimeZone(undefined)).toBe("");
  });
});

describe("the time a bill is stamped with", () => {
  it("is the salon's clock", () => {
    setSalonTimeZone(SALON);
    expect(nowTime()).toBe("03:52 am");
  });

  it("is nine and a half hours out on the mis-set till", () => {
    setSalonTimeZone(TILL);
    expect(nowTime()).toBe("06:22 pm");
  });

  it("adds seconds for the activity log, which records them", () => {
    setSalonTimeZone(SALON);
    expect(nowTime({ seconds: true })).toMatch(/^03:52:15 am$/);
  });

  it("stays lower case, the shape every stored bill already carries", () => {
    setSalonTimeZone(SALON);
    expect(nowTime()).toBe(nowTime().toLowerCase());
  });
});

describe("date arithmetic on top of today", () => {
  it("counts back from the SALON's today", () => {
    setSalonTimeZone(SALON);
    expect(daysAgoStr(0)).toBe("2026-08-17");
    expect(daysAgoStr(6)).toBe("2026-08-11"); // a 7-day window ending today
    expect(daysAgoStr(13)).toBe("2026-08-04");
  });

  it("rolls back over a month boundary", () => {
    setSalonTimeZone(SALON);
    expect(daysAgoStr(29)).toBe("2026-07-19");
    expect(daysAgoStr(365)).toBe("2025-08-17");
  });

  it("never lets the two ends of a range disagree about the day", () => {
    // The failure this replaced: `to` came from the salon's today while `from` was counted off
    // the device's, so on the boundary a report silently dropped or double-counted a day.
    setSalonTimeZone(SALON);
    const from = daysAgoStr(6);
    const to = todayStr();
    const span = (new Date(to + "T12:00") - new Date(from + "T12:00")) / 86400000;
    expect(span).toBe(6);
  });
});

describe("salonTodayDate — the bridge for the existing arithmetic", () => {
  it("carries the salon's date in its LOCAL fields, so dateStr() reads it back unchanged", () => {
    // This is the whole contract: every `new Date(y, m - 3, …)` and `d.setMonth(…)` in the
    // chart range builders keeps working as written, but anchored to the salon.
    setSalonTimeZone(SALON);
    expect(dateStr(salonTodayDate())).toBe("2026-08-17");
    expect(salonTodayDate().getFullYear()).toBe(2026);
    expect(salonTodayDate().getMonth()).toBe(7); // August
    expect(salonTodayDate().getDate()).toBe(17);
  });

  it("sits at noon, so month and day arithmetic cannot be tipped over a boundary", () => {
    setSalonTimeZone(SALON);
    expect(salonTodayDate().getHours()).toBe(12);
    const d = salonTodayDate();
    d.setMonth(d.getMonth() - 3);
    expect(dateStr(d)).toBe("2026-05-17");
  });
});

describe("dateStr did NOT change, and must not", () => {
  it("still formats a constructed calendar date by its own local fields", () => {
    // dateStr is used two ways — `dateStr(new Date())` meant "today", but
    // `dateStr(new Date(y, m, 1))` and `dateStr(new Date(ds + "T00:00"))` are calendar
    // arithmetic. Re-reading those in the salon's zone would shift every chart bucket by a day.
    setSalonTimeZone(SALON);
    expect(dateStr(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(dateStr(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(dateStr(new Date("2026-08-16T00:00"))).toBe("2026-08-16");
  });

  it("round-trips a stored date string whatever the salon's zone is", () => {
    for (const tz of ["Asia/Kolkata", "America/Indianapolis", "Pacific/Auckland", ""]) {
      setSalonTimeZone(tz);
      expect(dateStr(new Date("2026-08-16T00:00"))).toBe("2026-08-16");
    }
  });
});
