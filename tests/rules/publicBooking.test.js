/**
 * The public booking boundary, against the real database.rules.json.
 *
 * This file is the whole safety argument for the /book/ link. Before it existed, every rule in
 * database.rules.json opened with `auth != null` and nothing in the database was reachable
 * without a staff account. These specs pin exactly how much of that changed, and — just as
 * importantly — how much did not: the diary, the customer list and the config must stay as shut
 * to the street as they were.
 *
 * Two things worth knowing before reading:
 *
 * 1. The kill switch is `shop/public/profile/enabled`, and it fails CLOSED. A rule reads the
 *    datastore with full privileges regardless of .read, so the rules and the booking page read
 *    the same value and can never disagree about whether the salon is taking bookings.
 * 2. `createdAtMs` must be the SERVER's clock (serverTimestamp()), pinned by the rules as
 *    `=== now`. A client-supplied millisecond value is rejected outright — see the specs at the
 *    bottom for why that is a feature and not a hurdle.
 */
import { describe, it, expect } from "vitest";
import { ref, get, set, update, remove, serverTimestamp } from "firebase/database";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  UID, asOwner, asBiller, asUnauth, asUser, seed, readAsAdmin, useRulesHarness,
} from "./setup.js";

useRulesHarness();

const DATE = "2026-08-16";
const BOOKING_ID = "bk-0001";

/** A booking exactly as src/book/ writes it. A spec that bends one field bends a record the
 *  rules would genuinely have accepted. */
const booking = (over = {}) => ({
  id: BOOKING_ID,
  date: DATE,
  startMin: 600,
  durationMin: 45,
  customerName: "Riya Sharma",
  customerPhone: "9876500001",
  createdAtMs: serverTimestamp(),
  ...over,
});

const stub = (over = {}) => ({
  startMin: 600,
  durationMin: 45,
  kind: "appt",
  createdAtMs: serverTimestamp(),
  ...over,
});

const without = (rec, key) => Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

/** Online booking switched on, the way the owner's device publishes it. */
const enableOnlineBooking = (enabled = true) =>
  seed("shop/public/profile", { name: "Glow Salon", address: "12 MG Road", enabled, openMin: 600, closeMin: 1260, capacity: 3 });

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("what the street can read — and what it still cannot", () => {
  it("lets an unauthenticated visitor read the public profile", async () => {
    await enableOnlineBooking();
    await assertSucceeds(get(ref(asUnauth(), "shop/public/profile")));
  });

  it("lets them read the published menu, chairs and occupancy", async () => {
    await seed("shop/public/services", { "svc-cut": { name: "Haircut", durationMin: 30, price: 300 } });
    await seed("shop/public/chairs", { "staff-1": true });
    await seed(`shop/public/slots/${DATE}`, { a1: { startMin: 600, durationMin: 45, kind: "appt", createdAtMs: 1 } });
    await assertSucceeds(get(ref(asUnauth(), "shop/public/services")));
    await assertSucceeds(get(ref(asUnauth(), "shop/public/chairs")));
    await assertSucceeds(get(ref(asUnauth(), `shop/public/slots/${DATE}`)));
  });

  // These five are the point of the whole projection. If any starts passing, the booking page
  // has stopped being a booking page and become a data leak.
  it("still denies them the diary", async () => {
    await seed("shop/appointments", { a1: { id: "a1", date: DATE, customerPhone: "9876500001", note: "private" } });
    await assertFails(get(ref(asUnauth(), "shop/appointments")));
    await assertFails(get(ref(asUnauth(), "shop/appointments/a1")));
  });

  it("still denies them the customer list", async () => {
    await seed("shop/customers", { 9876500001: { id: "9876500001", name: "Riya" } });
    await assertFails(get(ref(asUnauth(), "shop/customers")));
  });

  it("still denies them the config, the staff records and the takings", async () => {
    await seed("shop/config", { name: "Glow", upiId: "glow@okhdfc" });
    await seed("shop/staff", { "staff-1": { id: "staff-1", name: "Asha", phone: "9876511111" } });
    await seed("shop/sales", { s1: { id: "s1", date: DATE, total: 500, lines: {} } });
    await assertFails(get(ref(asUnauth(), "shop/config")));
    await assertFails(get(ref(asUnauth(), "shop/staff")));
    await assertFails(get(ref(asUnauth(), "shop/sales")));
  });

  it("still denies them the inbox they can write to — it holds a name and a phone", async () => {
    await enableOnlineBooking();
    await seed("shop/publicBookings", { [BOOKING_ID]: { id: BOOKING_ID, customerPhone: "9876500001" } });
    await assertFails(get(ref(asUnauth(), "shop/publicBookings")));
    await assertFails(get(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`)));
  });

  it("still denies them shop/ itself and the root", async () => {
    // A child grant never makes its parent readable.
    await enableOnlineBooking();
    await assertFails(get(ref(asUnauth(), "shop")));
    await assertFails(get(ref(asUnauth(), "/")));
  });
});

describe("taking a booking", () => {
  it("accepts a well-formed booking from a signed-out customer", async () => {
    await enableOnlineBooking();
    await assertSucceeds(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), booking()));
    expect(await readAsAdmin(`shop/publicBookings/${BOOKING_ID}/customerName`)).toBe("Riya Sharma");
  });

  it("accepts the booking and its occupancy stub as ONE atomic fan-out", async () => {
    // This is how the page actually writes: the stub is what stops the next customer being
    // offered a slot that no staff device has seen taken yet.
    await enableOnlineBooking();
    await assertSucceeds(
      update(ref(asUnauth()), {
        [`shop/publicBookings/${BOOKING_ID}`]: booking(),
        [`shop/public/slots/${DATE}/${BOOKING_ID}`]: stub(),
      })
    );
    expect(await readAsAdmin(`shop/public/slots/${DATE}/${BOOKING_ID}/durationMin`)).toBe(45);
  });

  it("fails the WHOLE fan-out when either leg is malformed", async () => {
    await enableOnlineBooking();
    await assertFails(
      update(ref(asUnauth()), {
        [`shop/publicBookings/${BOOKING_ID}`]: booking(),
        [`shop/public/slots/${DATE}/${BOOKING_ID}`]: stub({ durationMin: 0 }),
      })
    );
    expect(await readAsAdmin(`shop/publicBookings/${BOOKING_ID}`)).toBeNull();
  });
});

describe("the kill switch", () => {
  it("refuses a booking when the owner has turned online booking off", async () => {
    await enableOnlineBooking(false);
    await assertFails(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), booking()));
  });

  it("refuses a booking when the profile was never published at all", async () => {
    // `null === true` is false. The default state of a salon that has never heard of this
    // feature is "not taking online bookings", enforced by the database and not just the UI.
    await assertFails(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), booking()));
  });

  it("refuses the occupancy stub too, so a disabled link cannot block out the diary", async () => {
    await enableOnlineBooking(false);
    await assertFails(set(ref(asUnauth(), `shop/public/slots/${DATE}/${BOOKING_ID}`), stub()));
  });

  it("cannot be flipped by the customer", async () => {
    await enableOnlineBooking(false);
    await assertFails(set(ref(asUnauth(), "shop/public/profile/enabled"), true));
    await assertFails(set(ref(asUnauth(), "shop/public/profile"), { name: "Glow", enabled: true }));
  });
});

describe("create-only: a customer gets exactly one write", () => {
  it("refuses an edit to a booking that already exists", async () => {
    await enableOnlineBooking();
    await seed(`shop/publicBookings/${BOOKING_ID}`, { ...booking(), createdAtMs: 1 });
    await assertFails(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), booking({ startMin: 900 })));
    await assertFails(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}/startMin`), 900));
  });

  it("refuses a delete", async () => {
    await enableOnlineBooking();
    await seed(`shop/publicBookings/${BOOKING_ID}`, { ...booking(), createdAtMs: 1 });
    await assertFails(remove(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`)));
    await assertFails(remove(ref(asUnauth(), "shop/publicBookings")));
  });

  it("refuses overwriting somebody else's occupancy stub", async () => {
    // Otherwise anyone with the link could free up a slot that is genuinely taken.
    await enableOnlineBooking();
    await seed(`shop/public/slots/${DATE}/a1`, { startMin: 600, durationMin: 45, kind: "appt", createdAtMs: 1 });
    await assertFails(set(ref(asUnauth(), `shop/public/slots/${DATE}/a1`), stub({ durationMin: 15 })));
    await assertFails(remove(ref(asUnauth(), `shop/public/slots/${DATE}/a1`)));
    await assertFails(remove(ref(asUnauth(), `shop/public/slots/${DATE}`)));
  });

  it("refuses writing the whole inbox in one go", async () => {
    await enableOnlineBooking();
    await assertFails(set(ref(asUnauth(), "shop/publicBookings"), { [BOOKING_ID]: booking() }));
  });
});

describe("the shape of a booking is not negotiable", () => {
  const rejects = async (over, label) => {
    await assertFails(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), booking(over)), label);
  };

  it("requires every field it validates", async () => {
    await enableOnlineBooking();
    for (const key of ["id", "date", "startMin", "durationMin", "customerName", "customerPhone", "createdAtMs"]) {
      await assertFails(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), without(booking(), key)));
    }
  });

  it("pins the id to the key, so a record cannot lie about where it lives", async () => {
    await enableOnlineBooking();
    await rejects({ id: "somewhere-else" });
  });

  it("insists on a real local date", async () => {
    await enableOnlineBooking();
    await rejects({ date: "16-08-2026" });
    await rejects({ date: "2026-08-16T10:00:00Z" });
    await rejects({ date: 20260816 });
  });

  it("keeps the time inside a day and the duration inside a shift", async () => {
    await enableOnlineBooking();
    await rejects({ startMin: -1 });
    await rejects({ startMin: 1440 });
    await rejects({ startMin: "600" });
    await rejects({ durationMin: 0 });
    await rejects({ durationMin: 481 });
  });

  it("insists on the same mobile shape the counter does", async () => {
    await enableOnlineBooking();
    await rejects({ customerPhone: "1234567890" }); // must start 6-9, same as isValidPhone
    await rejects({ customerPhone: "98765" });
    await rejects({ customerPhone: "+919876500001" }); // normalised before it is sent
    await rejects({ customerPhone: 9876500001 });
  });

  it("insists on a name, and caps it", async () => {
    await enableOnlineBooking();
    await rejects({ customerName: "" });
    await rejects({ customerName: "x".repeat(61) });
  });

  it("refuses a services list — the customer is never asked, so one is not theirs to send", async () => {
    await enableOnlineBooking();
    await rejects({ serviceIds: ["svc-cut"] });
    await rejects({ note: "anything at all" });
  });

  it("refuses any field it does not know about", async () => {
    // Without this a booking is an unbounded write into a node anyone can reach.
    await enableOnlineBooking();
    await rejects({ role: "owner" });
    await rejects({ payload: "x".repeat(5000) });
    await rejects({ staffId: "staff-1" }); // the chair is the salon's decision, not the caller's
  });

  it("refuses an unknown field on the occupancy stub too", async () => {
    await enableOnlineBooking();
    await assertFails(set(ref(asUnauth(), `shop/public/slots/${DATE}/${BOOKING_ID}`), stub({ customerPhone: "9876500001" })));
    await assertFails(set(ref(asUnauth(), `shop/public/slots/${DATE}/${BOOKING_ID}`), stub({ kind: "whatever" })));
  });

  it("refuses a stub filed under something that is not a date", async () => {
    await enableOnlineBooking();
    await assertFails(set(ref(asUnauth(), `shop/public/slots/not-a-date/${BOOKING_ID}`), stub()));
  });
});

describe("createdAtMs is the server's clock", () => {
  it("refuses a client-supplied timestamp, however plausible", async () => {
    await enableOnlineBooking();
    await assertFails(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), booking({ createdAtMs: Date.now() })));
  });

  it("refuses a far-future timestamp, which would make the slot stub unprunable", async () => {
    await enableOnlineBooking();
    await assertFails(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), booking({ createdAtMs: Date.now() + 86_400_000 })));
  });

  it("accepts the sentinel, so a phone with a wrong clock can still book", async () => {
    // The reason this is `=== now` and not a tolerance window: a budget handset ten minutes out
    // of step is common, and losing that customer's booking would look like the site being
    // broken. The server stamps it, so the handset's clock never enters into it.
    await enableOnlineBooking();
    await assertSucceeds(set(ref(asUnauth(), `shop/publicBookings/${BOOKING_ID}`), booking()));
    expect(await readAsAdmin(`shop/publicBookings/${BOOKING_ID}/createdAtMs`)).toBeGreaterThan(0);
  });
});

describe("staff still own the inbox and the projection", () => {
  it("lets an active biller read and drain the inbox", async () => {
    await enableOnlineBooking();
    await seed(`shop/publicBookings/${BOOKING_ID}`, { ...booking(), createdAtMs: 1 });
    await assertSucceeds(get(ref(asBiller(), "shop/publicBookings")));
    await assertSucceeds(remove(ref(asBiller(), `shop/publicBookings/${BOOKING_ID}`)));
  });

  it("lets a biller import in one atomic fan-out: appointment written, entry nulled", async () => {
    await enableOnlineBooking();
    await seed(`shop/publicBookings/${BOOKING_ID}`, { ...booking(), createdAtMs: 1 });
    await assertSucceeds(
      update(ref(asBiller()), {
        [`shop/appointments/${BOOKING_ID}`]: {
          id: BOOKING_ID, date: DATE, staffId: "staff-1", startMin: 600, durationMin: 45,
          serviceIds: [], customerPhone: "9876500001", customerName: "Riya Sharma",
          status: "booked", note: "", billId: "", source: "online", createdAt: DATE,
        },
        [`shop/publicBookings/${BOOKING_ID}`]: null,
      })
    );
    expect(await readAsAdmin(`shop/publicBookings/${BOOKING_ID}`)).toBeNull();
    expect(await readAsAdmin(`shop/appointments/${BOOKING_ID}/source`)).toBe("online");
  });

  it("lets a biller reconcile the occupancy, including dropping a whole past day", async () => {
    await seed("shop/public/slots/2026-08-15", { old: { startMin: 600, durationMin: 30, kind: "appt", createdAtMs: 1 } });
    await assertSucceeds(
      update(ref(asBiller(), "shop/public/slots"), {
        "2026-08-15": null,
        [`${DATE}/a1`]: { staffId: "staff-1", startMin: 600, durationMin: 45, kind: "appt", createdAtMs: serverTimestamp() },
      })
    );
    expect(await readAsAdmin("shop/public/slots/2026-08-15")).toBeNull();
  });

  it("holds a staff-written stub to the SAME shape as a customer-written one", async () => {
    // .validate applies to every writer. One shape for the salon and the street is the whole
    // reason the public branch could be written without an escape hatch in it.
    await assertFails(set(ref(asBiller(), `shop/public/slots/${DATE}/a1`), { startMin: 600, durationMin: 45, junk: true, createdAtMs: serverTimestamp() }));
  });

  it("keeps the profile, menu and chairs owner-only", async () => {
    const profile = { name: "Glow", enabled: true };
    await assertFails(set(ref(asBiller(), "shop/public/profile"), profile));
    await assertFails(set(ref(asBiller(), "shop/public/services"), { s1: { name: "Cut" } }));
    await assertFails(set(ref(asBiller(), "shop/public/chairs"), { "staff-1": true }));
    await assertSucceeds(set(ref(asOwner(), "shop/public/profile"), profile));
    await assertSucceeds(set(ref(asOwner(), "shop/public/services"), { s1: { name: "Cut" } }));
    await assertSucceeds(set(ref(asOwner(), "shop/public/chairs"), { "staff-1": true }));
  });

  it("denies a deactivated user and a stranger, exactly as everywhere else", async () => {
    await enableOnlineBooking();
    await seed("shop/users/uid-gone", { email: "gone@salon.test", role: "biller", active: false });
    await assertFails(get(ref(asUser("uid-gone"), "shop/publicBookings")));
    await assertFails(get(ref(asUser(UID.stranger), "shop/publicBookings")));
    // …and neither of them gets a free pass into the diary through the new node either.
    await assertFails(set(ref(asUser(UID.stranger), `shop/appointments/${BOOKING_ID}`), { id: BOOKING_ID }));
  });
});

describe("the diary is exactly as it was", () => {
  // The whole reason the public write went to a separate node. If any of these regressed, the
  // counter would have started failing mid-shift.
  const APPT = {
    id: "a1", date: DATE, staffId: "staff-1", startMin: 600, durationMin: 45,
    serviceIds: ["svc-cut"], customerPhone: "9876500001", customerName: "",
    status: "booked", note: "", billId: "", source: "", createdAt: DATE,
  };

  it("lets a biller create a whole appointment", async () => {
    await assertSucceeds(set(ref(asBiller(), "shop/appointments/a1"), APPT));
  });

  it("lets a biller push a single-field delta, the way buildSliceUpdate does", async () => {
    await seed("shop/appointments/a1", APPT);
    await assertSucceeds(update(ref(asBiller(), "shop/appointments"), { "a1/status": "completed" }));
    expect(await readAsAdmin("shop/appointments/a1/status")).toBe("completed");
  });

  it("lets a biller delete one", async () => {
    await seed("shop/appointments/a1", APPT);
    await assertSucceeds(update(ref(asBiller(), "shop/appointments"), { a1: null }));
  });

  it("accepts an appointment carrying the two new fields", async () => {
    await assertSucceeds(set(ref(asBiller(), "shop/appointments/a2"), { ...APPT, id: "a2", source: "online", customerName: "Riya" }));
  });

  it("gives the street no write into it, switch on or off", async () => {
    await enableOnlineBooking();
    await assertFails(set(ref(asUnauth(), "shop/appointments/a1"), APPT));
    await assertFails(update(ref(asUnauth(), "shop/appointments"), { "a1/status": "cancelled" }));
    await assertFails(set(ref(asUnauth(), "shop/appointments"), {}));
  });
});
