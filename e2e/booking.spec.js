/**
 * The public booking link — a customer booking themselves in, end to end.
 *
 * This is the spec that proves the feature's central claim: a stranger with no account, in a
 * signed-out browser, can take a slot, and it turns up in the salon's diary with nobody typing
 * it in. jsdom cannot prove that half of it — the boundary being tested is
 * database.rules.json's one unauthenticated write, exercised over the same request path a real
 * customer uses.
 *
 * Four things shape how these are written:
 *
 * 1. **The customer must never be signed in.** The whole point is an anonymous visitor, so
 *    these use a fresh `browser.newContext()` rather than the shared page. Auth state lives in
 *    IndexedDB (see CLAUDE.md), so a context that has never signed in is the only honest way
 *    to model one.
 *
 * 2. **`shop/public/profile/enabled` is the switch the RULES read**, not config.onlineBooking.
 *    The salon's own app publishes the projection from the config; seeding the projection
 *    directly is what lets these specs run without first driving Settings. The staff-side spec
 *    at the bottom covers the publishing path itself.
 *
 * 3. **Assertions against the database POLL.** The booking round-trips to the emulator and is
 *    then imported by the staff app on a second round trip. Reading once, immediately, reads
 *    the state from before the write.
 *
 * 4. **The import needs a staff device with the app open.** That is the design (see
 *    lib/booking.js): the customer's write always lands, and any signed-in device materialises
 *    it. The specs that assert the diary therefore sign someone in and leave them there.
 */
import { expect, test } from "@playwright/test";
import { clearPath, readAsAdmin, seed, statusAsPublic } from "./fixtures/seed.js";
import { SERVICES, STAFF, todayISO } from "./fixtures/salon.js";
import { navItem, signIn } from "./fixtures/app.js";

const PROFILE = {
  name: "E2E Salon",
  tagline: "Hair · Skin · Nails",
  address: "12 E2E Road, Pune",
  phone: "+91 98765 43210",
  mapsUrl: "https://maps.app.goo.gl/e2e",
  theme: "emerald",
  // The salon's own zone. The page derives "today" from this, never from the browser's clock.
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  openMin: 600,
  closeMin: 1260,
  enabled: true,
  capacity: 3,
  // No notice period: a spec that had to wait an hour for its first bookable slot would be
  // asserting the clock rather than the feature.
  leadMinutes: 0,
  horizonDays: 7,
  slotMinutes: 30,
  // Every 15 minutes, so the capacity spec can still assert an adjacent slot.
  stepMinutes: 15,
  noticeText: "Please arrive 5 minutes early",
};

const publicChairs = () => Object.fromEntries(Object.values(STAFF).map((s) => [s.id, true]));

async function publishProjection(overrides = {}) {
  await Promise.all([
    seed("shop/public/profile", { ...PROFILE, ...overrides }),
    seed("shop/public/chairs", publicChairs()),
  ]);
}

test.beforeEach(async () => {
  await Promise.all([
    clearPath("shop/appointments"),
    clearPath("shop/publicBookings"),
    clearPath("shop/public"),
  ]);
  await publishProjection();
});

/** A signed-out customer, on the booking page. */
async function customer(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/book/");
  return { context, page };
}

const times = (page) => page.getByRole("group", { name: "Choose a time" }).getByRole("button");

/** Fill the whole form and confirm. Returns the time chosen. */
async function book(page, { name = "E2E Riya", phone = "9876500055", at } = {}) {
  // Details first, then the time — the order the page actually asks for them.
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Mobile number").fill(phone);
  const slot = at ? times(page).filter({ hasText: at }) : times(page).first();
  const label = (await slot.textContent()).trim();
  await slot.click();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  return label;
}

// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe("the page a customer sees", () => {
  test("shows the shop, its address and directions — and never a stylist", async ({ browser }) => {
    const { context, page } = await customer(browser);

    await expect(page.getByRole("heading", { name: PROFILE.name })).toBeVisible();
    await expect(page.getByText(PROFILE.address)).toBeVisible();
    await expect(page.getByRole("link", { name: /Get directions/ })).toHaveAttribute("href", PROFILE.mapsUrl);
    await expect(page.getByRole("link", { name: /Call the salon/ })).toHaveAttribute("href", "tel:+919876543210");

    // The requirement in one assertion: the shop, not the staff.
    const body = await page.locator("body").innerText();
    for (const s of Object.values(STAFF)) expect(body).not.toContain(s.name);
    for (const s of Object.values(STAFF)) expect(body).not.toContain(s.id);

    await context.close();
  });

  test("buys a visitor nothing beyond shop/public", async ({ browser }) => {
    // Asserts the BOUNDARY, not the page: an unauthenticated REST read, which is what anyone
    // holding the link and a browser console actually has. tests/rules/publicBooking.test.js
    // covers the same matrix against the rules directly; this proves it holds in the deployed
    // request path, with the booking page open and the switch on.
    await seed("shop/appointments/leak", {
      id: "leak", date: todayISO(), staffId: STAFF.asha.id, startMin: 600, durationMin: 30,
      customerPhone: "9876500001", customerName: "", status: "booked", note: "private",
      serviceIds: [SERVICES.haircut.id], billId: "", source: "", createdAt: todayISO(),
    });
    await seed("shop/customers/9876500001", { id: "9876500001", name: "E2E Meera" });
    await seed("shop/publicBookings/probe", { id: "probe", customerPhone: "9876500001" });

    const { context, page } = await customer(browser);
    await expect(page.getByRole("heading", { name: PROFILE.name })).toBeVisible();

    for (const node of ["appointments", "customers", "config", "staff", "sales", "logs", "publicBookings"]) {
      expect(await statusAsPublic(`shop/${node}`), `shop/${node} must not be readable by the street`).not.toBe(200);
    }
    // …while the projection the page runs on is, which is what makes the above meaningful.
    expect(await statusAsPublic("shop/public/profile")).toBe(200);
    expect(await statusAsPublic("shop")).not.toBe(200);

    await context.close();
  });

  test("says so when the salon has switched online booking off", async ({ browser }) => {
    await publishProjection({ enabled: false });
    const { context, page } = await customer(browser);
    await expect(page.getByText(/isn't open/i)).toBeVisible();
    await expect(page.getByRole("group", { name: "Choose a day" })).toHaveCount(0);
    await context.close();
  });
});

test.describe("booking", () => {
  test("a signed-out customer's booking reaches the diary with nobody typing it in", async ({ browser, page }) => {
    // A staff device sitting on the diary, as the counter tablet would be all day.
    await signIn(page, "owner");
    await navItem(page, "Appointments").click();
    await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();

    const { context, page: cust } = await customer(browser);
    const at = await book(cust, { name: "E2E Riya", phone: "9876500055" });
    await expect(cust.getByRole("heading", { name: /You're booked/i })).toBeVisible();
    await expect(cust.getByText(at)).toBeVisible();
    // The salon's own line lands on the confirmation, where the customer will screenshot it.
    await expect(cust.getByText(PROFILE.noticeText)).toBeVisible();

    // Poll: the customer's write round-trips, then a staff device imports it on a second one.
    await expect
      .poll(async () => Object.values((await readAsAdmin("shop/appointments")) || {}).length, { timeout: 15_000 })
      .toBe(1);

    const [appt] = Object.values(await readAsAdmin("shop/appointments"));
    expect(appt).toMatchObject({
      date: todayISO(),
      status: "booked",
      source: "online",
      customerName: "E2E Riya",
      customerPhone: "9876500055",
      durationMin: PROFILE.slotMinutes,
      billId: "",
    });
    // A chair the salon actually has — chosen by the app, never by the customer.
    expect(Object.values(STAFF).map((s) => s.id)).toContain(appt.staffId);

    // The inbox entry is gone: it went in the same atomic update as the appointment.
    await expect.poll(async () => await readAsAdmin("shop/publicBookings"), { timeout: 15_000 }).toBeNull();

    // And it is on screen, under a real stylist, with the customer's name on the block.
    await expect(page.getByRole("button", { name: /E2E Riya/ })).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test("refuses the booking that would put one more than capacity in the salon", async ({ browser }) => {
    // Three overlapping appointments at 10:00 with a capacity of three: 10:00 must disappear
    // from the grid, and the slot after they finish must still be offered.
    const date = todayISO();
    await seed(
      `shop/public/slots/${date}`,
      Object.fromEntries(
        ["a", "b", "c"].map((k, i) => [`seeded-${k}`, { staffId: `chair-${i}`, startMin: 600, durationMin: 45, kind: "appt", createdAtMs: Date.now() }])
      )
    );
    await seed("shop/public/chairs", { "chair-0": true, "chair-1": true, "chair-2": true });

    const { context, page } = await customer(browser);

    const labels = await times(page).allTextContents();
    expect(labels).not.toContain("10:00 am");
    expect(labels).toContain("10:45 am"); // back-to-back is free again

    await context.close();
  });

  test("a customer cannot book when the salon has switched the link off, even mid-session", async ({ browser }) => {
    const { context, page } = await customer(browser);
    await page.getByLabel("Your name").fill("E2E Latecomer");
    await page.getByLabel("Mobile number").fill("9876500077");
    await times(page).first().click();

    // The owner switches it off while this page sits open with a slot chosen.
    await seed("shop/public/profile", { ...PROFILE, enabled: false });

    await page.getByRole("button", { name: "Confirm booking" }).click();
    // Refused by the RULES, not by the page — which is the whole point of the kill switch.
    await expect(page.getByRole("alert")).toContainText(/isn't taking online bookings/i);
    expect(await readAsAdmin("shop/publicBookings")).toBeNull();

    await context.close();
  });
});

test.describe("the salon's side", () => {
  test("the owner's device publishes the projection from Settings", async ({ page }) => {
    // The other direction: shop/public is DERIVED, and this is what derives it. Wipe it and
    // confirm a signed-in owner puts it back from the config it already holds.
    await clearPath("shop/public");
    await seed("shop/config/onlineBooking", { enabled: true, capacity: 3, leadMinutes: 0, horizonDays: 7, noticeText: "" });

    await signIn(page, "owner");

    await expect.poll(async () => (await readAsAdmin("shop/public/profile"))?.enabled, { timeout: 15_000 }).toBe(true);
    const profile = await readAsAdmin("shop/public/profile");
    expect(profile).toMatchObject({ capacity: 3, horizonDays: 7 });
    expect(profile.openMin).toBeLessThan(profile.closeMin);

    // The menu and the chairs, stripped of everything a customer has no business seeing.
    const services = await readAsAdmin("shop/public/services");
    expect(Object.keys(services)).toEqual(expect.arrayContaining(Object.values(SERVICES).map((s) => s.id)));
    expect(JSON.stringify(services)).not.toContain("commissionPct");

    const chairs = await readAsAdmin("shop/public/chairs");
    expect(Object.keys(chairs)).toEqual(expect.arrayContaining(Object.values(STAFF).map((s) => s.id)));
    for (const s of Object.values(STAFF)) expect(JSON.stringify(chairs)).not.toContain(s.name);
  });

  test("publishes occupancy for the diary, carrying no customer detail", async ({ page }) => {
    const date = todayISO();
    await seed("shop/appointments/e2e-a1", {
      id: "e2e-a1", date, staffId: STAFF.asha.id, startMin: 600, durationMin: 45,
      serviceIds: [SERVICES.haircut.id], customerPhone: "9876500001", customerName: "",
      status: "booked", note: "private note", billId: "", source: "", createdAt: date,
    });
    await seed("shop/config/onlineBooking", { enabled: true, capacity: 3, leadMinutes: 0, horizonDays: 7, noticeText: "" });

    await signIn(page, "owner");

    await expect.poll(async () => (await readAsAdmin(`shop/public/slots/${date}/e2e-a1`))?.startMin, { timeout: 15_000 }).toBe(600);
    const stub = await readAsAdmin(`shop/public/slots/${date}/e2e-a1`);
    expect(stub).toMatchObject({ staffId: STAFF.asha.id, startMin: 600, durationMin: 45, kind: "appt" });
    // The stub says a chair is busy and nothing else.
    const asText = JSON.stringify(stub);
    expect(asText).not.toContain("9876500001");
    expect(asText).not.toContain("private note");
    expect(asText).not.toContain(SERVICES.haircut.id);
  });
});
