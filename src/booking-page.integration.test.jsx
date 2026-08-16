// @vitest-environment jsdom
//
// The public booking page, mounted for real.
//
// This is the only automated check that a CUSTOMER can get through the flow that `npm test` —
// and therefore CI — actually runs. e2e/booking.spec.js covers the same ground in a real browser
// against the emulator, but it needs Java on PATH and is deliberately kept off the deploy path.
//
// Only src/book/db.js is stubbed. Everything else is the real module graph: the real
// availability arithmetic, the real validation, the real markup. A module-init fault or a
// mis-wired prop fails here rather than in front of a customer.
//
// ── Why this file is at src/ root and not in src/book/ ───────────────────────────────────
// Same reason as every other jsdom suite here: `preloadViews()` globs src/views/*.jsx, and the
// convention of keeping these at the root is what stops a test file ever being loaded as if it
// were a screen. See the note at the top of settings.integration.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Each watchPublic("x", cb) hands its callback here, so a spec can push the projection in.
const listeners = {};
const sent = [];
let sendResult;
let slotsNow;

vi.mock("./book/db.js", () => ({
  watchPublic: (child, onData) => { listeners[child] = onData; return () => {}; },
  readSlots: () => Promise.resolve(slotsNow),
  sendBooking: (entry, stub) => { sent.push({ entry, stub }); return sendResult; },
  stamp: () => "SERVER_TIMESTAMP",
}));

const { default: BookingPage } = await import("./book/BookingPage.jsx");

const PROFILE = {
  name: "Glow Salon", tagline: "Hair · Skin · Nails", address: "12 MG Road, Pune",
  phone: "+91 98765 43210", mapsUrl: "https://maps.app.goo.gl/glow", theme: "emerald",
  timeZone: "Asia/Kolkata", openMin: 600, closeMin: 1260,
  enabled: true, capacity: 3, leadMinutes: 60, horizonDays: 7,
  noticeText: "Please arrive 5 minutes early",
};

const SERVICES = {
  "svc-cut": { name: "Haircut", category: "Hair", durationMin: 30, price: 300 },
  "svc-facial": { name: "Facial", category: "Skin", durationMin: 60, price: 900 },
};

const CHAIRS = { "staff-1": true, "staff-2": true, "staff-3": true };

/** 08:30 in the salon's own zone, so the whole working day is ahead of the notice period. */
const NOW = Date.UTC(2026, 7, 16, 3, 0, 0);
const TODAY = "2026-08-16";

const busyAt = (startMin, durationMin, kind = "appt") =>
  Object.fromEntries(Object.keys(CHAIRS).map((s, i) => [`x${i}`, { staffId: s, startMin, durationMin, kind }]));

let mounted = null;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<BookingPage />));
  mounted = { root, container };
  return container;
}

/** Push the published projection in, as the live subscriptions would. */
function publish({ profile = PROFILE, services = SERVICES, chairs = CHAIRS, slots = {} } = {}) {
  slotsNow = slots;
  act(() => {
    listeners.profile?.(profile);
    listeners.services?.(services);
    listeners.chairs?.(chairs);
    listeners.slots?.(slots);
  });
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  for (const k of Object.keys(listeners)) delete listeners[k];
  sent.length = 0;
  sendResult = Promise.resolve();
  slotsNow = {};
});

afterEach(() => {
  if (mounted) act(() => mounted.root.unmount());
  mounted?.container.remove();
  mounted = null;
  vi.restoreAllMocks();
});

// ---- accessible-route helpers: labels and text, never a testid --------------------------
const text = (c) => c.textContent;
const buttons = (c) => [...c.querySelectorAll("button")];
const btn = (c, re) => buttons(c).find((b) => re.test(b.textContent));
const link = (c, re) => [...c.querySelectorAll("a")].find((a) => re.test(a.textContent));
const group = (c, label) => c.querySelector(`[aria-label="${label}"]`);
const groupButtons = (c, label) => [...(group(c, label)?.querySelectorAll("button") || [])];
const times = (c) => groupButtons(c, "Choose a time").map((b) => b.textContent);
const field = (c, re) => {
  const label = [...c.querySelectorAll("label")].find((l) => re.test(l.textContent));
  return label?.querySelector("input");
};
const alertText = (c) => c.querySelector('[role="alert"]')?.textContent || "";

const pickService = (c, name) => {
  const label = [...c.querySelectorAll("label")].find((l) => l.textContent.includes(name));
  act(() => label.querySelector('input[type="checkbox"]').click());
};
const pickTime = (c, label) => act(() => groupButtons(c, "Choose a time").find((b) => b.textContent === label).click());
const type = (c, re, value) => {
  const input = field(c, re);
  act(() => {
    // React tracks the last value it wrote; set through the prototype so it sees a real change.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const confirm = async (c) => { await act(async () => { btn(c, /Confirm booking/).click(); }); };

// ─────────────────────────────────────────────────────────────────────────────────────────

describe("before anything is published", () => {
  it("shows a loading state rather than an empty page", () => {
    expect(text(mount())).toMatch(/loading/i);
  });

  it("says booking is closed when the salon has never switched it on", () => {
    const c = mount();
    publish({ profile: null });
    expect(text(c)).toMatch(/isn't open/i);
  });

  it("says so when the owner has switched it off, and still offers the phone", () => {
    const c = mount();
    publish({ profile: { ...PROFILE, enabled: false } });
    expect(text(c)).toMatch(/isn't open/i);
    expect(link(c, /Call the salon/)).toBeTruthy();
    expect(group(c, "Choose a day")).toBeNull();
  });
});

describe("the shop, and only the shop", () => {
  it("shows the name, address, directions and phone", () => {
    const c = mount();
    publish();
    expect(text(c)).toContain("Glow Salon");
    expect(text(c)).toContain("12 MG Road, Pune");
    const maps = link(c, /Get directions/);
    expect(maps.getAttribute("href")).toBe("https://maps.app.goo.gl/glow");
    expect(maps.getAttribute("rel")).toContain("noopener");
    expect(link(c, /Call the salon/).getAttribute("href")).toBe("tel:+919876543210");
  });

  it("NEVER names a stylist — the whole reason chairs are published as bare ids", () => {
    const c = mount();
    publish();
    for (const id of Object.keys(CHAIRS)) expect(text(c)).not.toContain(id);
    expect(text(c)).not.toMatch(/stylist/i);
  });

  it("refuses to render an unsafe map link, wherever it came from", () => {
    // Settings validates this on save; a value written into config by hand would otherwise
    // become script on a page anyone can open.
    const c = mount();
    publish({ profile: { ...PROFILE, mapsUrl: "javascript:alert(1)" } });
    expect(link(c, /Get directions/)).toBeUndefined();
  });

  it("shows the salon's own notice", () => {
    const c = mount();
    publish();
    expect(text(c)).toMatch(/arrive 5 minutes early/i);
  });
});

describe("choosing services and a time", () => {
  it("offers no times until a service is chosen — the duration decides the grid", () => {
    const c = mount();
    publish();
    expect(group(c, "Choose a time")).toBeNull();
    expect(text(c)).toMatch(/choose a service above/i);
  });

  it("totals the basket and opens the time grid", () => {
    const c = mount();
    publish();
    pickService(c, "Haircut");
    expect(text(c)).toMatch(/1 selected/);
    expect(times(c).length).toBeGreaterThan(0);
  });

  it("adds the durations and prices of several services together", () => {
    const c = mount();
    publish();
    pickService(c, "Haircut");
    pickService(c, "Facial");
    expect(text(c)).toMatch(/2 selected/);
    expect(text(c)).toContain("90 min");
    expect(text(c)).toContain("1,200");
  });

  it("never offers a slot that would run past closing time", () => {
    const c = mount();
    publish();
    pickService(c, "Facial"); // 60 minutes; the salon closes at 21:00
    expect(times(c).at(-1)).toBe("8:00 pm");
  });

  it("honours the notice period on today", () => {
    Date.now.mockReturnValue(Date.UTC(2026, 7, 16, 6, 10, 0)); // 11:40 in the salon's zone
    const c = mount();
    publish();
    pickService(c, "Haircut");
    // 11:40 + an hour's notice = 12:40, and the grid steps on the quarter hour.
    expect(times(c)[0]).toBe("12:45 pm");
  });

  it("does not apply the notice period to a later day", () => {
    Date.now.mockReturnValue(Date.UTC(2026, 7, 16, 6, 10, 0));
    const c = mount();
    publish();
    pickService(c, "Haircut");
    act(() => groupButtons(c, "Choose a day")[1].click());
    expect(times(c)[0]).toBe("10:00 am"); // opening time, not 12:45
  });

  it("hides a slot the salon is already full for, and keeps the ones around it", () => {
    const c = mount();
    publish({ slots: { [TODAY]: busyAt(720, 30) } }); // three in the chair at noon, capacity 3
    pickService(c, "Haircut");
    expect(times(c)).not.toContain("12:00 pm");
    expect(times(c)).toContain("12:30 pm"); // back-to-back is free again
  });

  it("counts blocked time against the chairs but not against capacity", () => {
    const c = mount();
    // Two stylists at lunch is not two customers in the salon — the third chair can take it.
    const lunch = { b1: { staffId: "staff-1", startMin: 720, durationMin: 60, kind: "block" }, b2: { staffId: "staff-2", startMin: 720, durationMin: 60, kind: "block" } };
    publish({ slots: { [TODAY]: lunch } });
    pickService(c, "Haircut");
    expect(times(c)).toContain("12:00 pm");
  });

  it("says so plainly when a day has nothing left", () => {
    const busy = {};
    for (let t = 600; t < 1260; t += 15) Object.assign(busy, Object.fromEntries(Object.entries(busyAt(t, 15)).map(([k, v]) => [`${k}-${t}`, v])));
    const c = mount();
    publish({ slots: { [TODAY]: busy } });
    pickService(c, "Haircut");
    expect(text(c)).toMatch(/nothing free/i);
  });

  it("lets go of a chosen time that somebody else takes while the page is open", () => {
    const c = mount();
    publish();
    pickService(c, "Haircut");
    pickTime(c, "12:00 pm");
    expect(text(c)).toMatch(/12:00 pm/);

    act(() => listeners.slots({ [TODAY]: busyAt(720, 30) }));
    // Confirm must not be able to send a time the page has stopped showing.
    expect(times(c)).not.toContain("12:00 pm");
  });
});

describe("confirming", () => {
  const fill = (c) => {
    pickService(c, "Haircut");
    pickTime(c, "12:00 pm");
    type(c, /Your name/, "  Riya Sharma  ");
    type(c, /Mobile number/, "+91 98765 00001");
  };

  it("asks for what is missing instead of failing at the database", async () => {
    const c = mount();
    publish();
    await confirm(c);
    expect(alertText(c)).toMatch(/service/i);

    pickService(c, "Haircut");
    pickTime(c, "12:00 pm");
    await confirm(c);
    expect(alertText(c)).toMatch(/name/i);

    type(c, /Your name/, "Riya");
    type(c, /Mobile number/, "12345");
    await confirm(c);
    expect(alertText(c)).toMatch(/mobile/i);
    expect(sent).toHaveLength(0);
  });

  it("sends the booking and its occupancy stub together, normalised", async () => {
    const c = mount();
    publish();
    fill(c);
    await confirm(c);

    expect(sent).toHaveLength(1);
    const { entry, stub } = sent[0];
    // `date` is the assertion that matters most here and is the easiest to get wrong: it must
    // be the SALON's today, not the device's. This suite runs on a machine several hours behind
    // Asia/Kolkata, so a page that seeded its day strip from the device clock — as this one did
    // until the profile-gated `today` went in — books the salon's yesterday and this fails.
    expect(entry).toMatchObject({
      date: TODAY, startMin: 720, durationMin: 30, serviceIds: ["svc-cut"],
      customerName: "Riya Sharma", customerPhone: "9876500001", createdAtMs: "SERVER_TIMESTAMP",
    });
    // The chair is the salon's decision, made at import against the real diary.
    expect(entry.staffId).toBeUndefined();
    expect(stub).toEqual({ startMin: 720, durationMin: 30, kind: "appt", createdAtMs: "SERVER_TIMESTAMP" });
  });

  it("confirms to the customer in words they can act on", async () => {
    const c = mount();
    publish();
    fill(c);
    await confirm(c);
    expect(text(c)).toMatch(/you're booked/i);
    expect(text(c)).toContain("12:00 pm");
    expect(text(c)).toContain("9876500001");
  });

  it("re-checks availability at the last moment and backs off if the slot went", async () => {
    const c = mount();
    publish();
    fill(c);
    // Between choosing and confirming, three bookings land on that slot.
    slotsNow = { [TODAY]: busyAt(720, 30) };
    await confirm(c);
    expect(alertText(c)).toMatch(/just been taken/i);
    expect(sent).toHaveLength(0); // nothing was written
  });

  it("explains a refused write as the salon being closed, not as an error code", async () => {
    const c = mount();
    publish();
    fill(c);
    sendResult = Promise.reject(Object.assign(new Error("permission_denied"), { code: "PERMISSION_DENIED" }));
    await confirm(c);
    expect(alertText(c)).toMatch(/isn't taking online bookings/i);
  });

  it("tells the customer to try again when the network drops", async () => {
    const c = mount();
    publish();
    fill(c);
    sendResult = Promise.reject(new Error("network request failed"));
    await confirm(c);
    expect(alertText(c)).toMatch(/connection/i);
  });
});
