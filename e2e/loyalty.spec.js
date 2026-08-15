/**
 * Phase 4 — loyalty points, tiers and prepaid packages.
 *
 * The single thing worth proving here: **nothing is a running total.** A customer's points
 * balance, their tier and a package's remaining sessions are all DERIVED from the bills and
 * recomputed on every sync (`reconcileLoyalty`, `reconcilePackages` in the shell) — there is
 * no counter to nudge and no reversal to forget. loyalty.test.js proves that arithmetic; what
 * these specs prove is that the app actually recomputes, end to end, against a real database.
 *
 * So the assertions are deliberately shaped as "seed the BILLS, then read the derived field":
 * a spec that seeded `loyaltyPoints` directly and read it back would pass on an app that had
 * quietly gone back to incrementing a stored counter, which is exactly the regression the
 * design exists to prevent.
 *
 * The defaults these numbers come from (loyaltyRules): 1 point per ₹100, ₹1 a point, a
 * 50-point minimum, and no more than 20% of a bill paid in points.
 */
import { expect, test } from "@playwright/test";
import { clearPath, readAsAdmin, seed, toMap } from "./fixtures/seed.js";
import { CUSTOMERS, CUSTOMER_PACKAGES, SERVICES, STAFF, priorSale, seedCustomerPackages, seedCustomers, todayISO } from "./fixtures/salon.js";
import { navItem, signIn } from "./fixtures/app.js";

const POLL = { timeout: 15_000 };
const MEERA = CUSTOMERS.meera;

test.beforeEach(async () => {
  // customers and customerPackages are rewritten by the app's reconcilers, so they go back to
  // a known state before every test rather than once for the run.
  await clearPath("shop/sales");
  await Promise.all([seedCustomers(), seedCustomerPackages()]);
});

// ---- helpers -------------------------------------------------------------------------

async function openTill(page, role = "owner") {
  await signIn(page, role);
  await navItem(page, "Billing (POS)").click();
  await expect(page.getByText("Bill is empty.")).toBeVisible();
}

/** Put the bill on a named customer — loyalty and packages only exist once one is picked. */
async function pickCustomer(page, customer = MEERA) {
  await page.getByPlaceholder("Search name or phone").fill(customer.name);
  await page.getByRole("button", { name: new RegExp(customer.name) }).click();
  await expect(page.getByRole("button", { name: "Change" })).toBeVisible();
}

const tile = (page, name) => page.locator(".pick").filter({ hasText: name });

async function addService(page, service, staffName = STAFF.asha.name) {
  await tile(page, service.name).click();
  await page.getByLabel(`Who performed ${service.name}`).selectOption({ label: staffName });
}

const completeSale = (page) => page.getByRole("button", { name: /Complete sale/ }).click();

const savedSales = async () => Object.values((await readAsAdmin("shop/sales")) || {});
/** The bill the till just wrote — the seeded history has fixed ids, so exclude those. */
const newSale = async () => (await savedSales()).find((s) => !String(s.id).startsWith("e2e-past-"));
const storedCustomer = async () => (await readAsAdmin(`shop/customers/${MEERA.phone}`)) || {};
const storedPackage = async () => (await readAsAdmin(`shop/customerPackages/${CUSTOMER_PACKAGES.haircuts.id}`)) || {};

/** Seed past bills for Meera. `points` is what those bills put in the ledger. */
async function seedHistory(bills) {
  await seed("shop/sales", toMap(bills.map((b, i) => priorSale({ id: `e2e-past-${i}`, phone: MEERA.phone, ...b }))));
}

// ---- earning -------------------------------------------------------------------------

test("a bill for a named customer earns points", async ({ page }) => {
  await openTill(page);
  await pickCustomer(page);
  await addService(page, SERVICES.colour); // ₹1200 → 12 points at 1 per ₹100

  await completeSale(page);

  await expect.poll(newSale, POLL).toMatchObject({ total: 1200, customerPhone: MEERA.phone, pointsEarned: 12 });
  // The balance is not stored by the till — the shell recomputes it from the bills and writes
  // it back onto the customer. That round trip is the thing being tested.
  await expect.poll(async () => (await storedCustomer()).loyaltyPoints, POLL).toBe(12);
});

test("a walk-in bill earns nothing", async ({ page }) => {
  // No customer, no ledger entry: pointsEarned is only written when non-zero, so a walk-in
  // bill keeps its plain shape.
  await openTill(page);
  await addService(page, SERVICES.colour);

  await completeSale(page);

  const sale = await (async () => {
    await expect.poll(savedSales, POLL).toHaveLength(1);
    return newSale();
  })();
  expect(sale.pointsEarned).toBeUndefined();
  expect(sale.customerPhone).toBeUndefined();
});

test("the balance is the sum of the bills, not a stored counter", async ({ page }) => {
  // Seeded as two past bills carrying 30 and 20 points. Nothing writes 50 anywhere — if the
  // app is deriving, it arrives at 50 on its own.
  await seedHistory([
    { total: 3000, pointsEarned: 30 },
    { total: 2000, pointsEarned: 20 },
  ]);

  await openTill(page);

  await expect.poll(async () => (await storedCustomer()).loyaltyPoints, POLL).toBe(50);
});

test("a 12-month spend of ₹10,000 reaches Silver", async ({ page }) => {
  // Tiers are rolling-window spend, recomputed the same way. The threshold is the default.
  await seedHistory([
    { total: 6000, pointsEarned: 60 },
    { total: 6000, pointsEarned: 60, date: todayISO(-30) },
  ]);

  await openTill(page);

  await expect.poll(async () => (await storedCustomer()).tier, POLL).toBe("Silver");
});

// ---- redeeming -----------------------------------------------------------------------

test("points redeemed come off the bill and are recorded", async ({ page }) => {
  await seedHistory([{ total: 20000, pointsEarned: 200 }]);

  await openTill(page);
  await pickCustomer(page);
  await addService(page, SERVICES.colour); // ₹1200; 20% ceiling = 240 points

  await page.getByLabel("Points to redeem").fill("100");
  await expect(page.getByRole("button", { name: "Complete sale · ₹1,100 · UPI" })).toBeVisible();

  await completeSale(page);

  await expect.poll(newSale, POLL).toMatchObject({ total: 1100, pointsRedeemed: 100, pointsValue: 100 });
  // 200 seeded − 100 spent + what this bill earned on ₹1,100 = 11.
  await expect.poll(async () => (await storedCustomer()).loyaltyPoints, POLL).toBe(111);
});

test("redemption is capped at a fifth of the bill", async ({ page }) => {
  // A big balance must not clear a bill outright: the owner's cap is 20%, so ₹1,200 of colour
  // takes 240 points however many thousand the customer is holding.
  //
  // Colour, not the haircut: Meera's seeded package covers haircuts, which would make the
  // line ₹0 — and a zero bill offers no redemption at all, so the field under test would not
  // even render.
  await seedHistory([{ total: 500000, pointsEarned: 5000 }]);

  await openTill(page);
  await pickCustomer(page);
  await addService(page, SERVICES.colour); // ₹1200

  await page.getByLabel("Points to redeem").fill("9999");

  await expect(page.getByRole("button", { name: "Complete sale · ₹960 · UPI" })).toBeVisible();
  await completeSale(page);

  await expect.poll(newSale, POLL).toMatchObject({ total: 960, pointsRedeemed: 240 });
});

test("points are earned on what is actually paid, not on the pre-redemption total", async ({ page }) => {
  // Earning on the part settled with points would be paying interest on the salon's own
  // currency. ₹1200 bill − 200 points = ₹1000 paid → 10 points, not 12.
  await seedHistory([{ total: 20000, pointsEarned: 200 }]);

  await openTill(page);
  await pickCustomer(page);
  await addService(page, SERVICES.colour);

  await page.getByLabel("Points to redeem").fill("200");
  await expect(page.getByRole("button", { name: "Complete sale · ₹1,000 · UPI" })).toBeVisible();

  await completeSale(page);

  await expect.poll(newSale, POLL).toMatchObject({ total: 1000, pointsRedeemed: 200, pointsEarned: 10 });
});

test("a balance below the minimum offers no redemption at all", async ({ page }) => {
  // 40 points is under the 50-point floor, so the redeem row is not offered — a 3-point
  // redemption is till clutter, not a perk.
  await seedHistory([{ total: 4000, pointsEarned: 40 }]);

  await openTill(page);
  await pickCustomer(page);
  await addService(page, SERVICES.colour);

  await expect(page.getByLabel("Points to redeem")).toHaveCount(0);
});

// ---- prepaid packages ----------------------------------------------------------------

test("a package covers the service at zero and draws a session down", async ({ page }) => {
  await openTill(page);
  await pickCustomer(page); // must come first: coverage is looked up per customer

  await tile(page, SERVICES.haircut.name).click();

  await expect(page.getByText(/Covered by .E2E 3 Haircuts./)).toBeVisible();
  await page.getByLabel(`Who performed ${SERVICES.haircut.name}`).selectOption({ label: STAFF.asha.name });
  // Prepaid work is a zero-price line — the money was taken when the package was sold, and
  // charging again would charge twice for the same session.
  await expect(page.getByRole("button", { name: "Complete sale · ₹0 · UPI" })).toBeVisible();

  await completeSale(page);

  await expect.poll(newSale, POLL).toMatchObject({
    total: 0,
    packageRedemptions: [{ customerPackageId: CUSTOMER_PACKAGES.haircuts.id, serviceId: SERVICES.haircut.id }],
  });
  // usesLeft is DERIVED from the packageRedemptions on the bills. Saving the bill IS the
  // draw-down; nothing decremented a counter.
  await expect.poll(async () => (await storedPackage()).usesLeft, POLL).toBe(2);
});

test("an exhausted package stops covering", async ({ page }) => {
  // Seeded with its sessions already spent on past bills, which is the only honest way to
  // exhaust it: usesLeft is recomputed from exactly these records.
  const draws = [1, 2, 3].map((n) => ({
    ...priorSale({ id: `e2e-past-${n}`, phone: MEERA.phone, total: 0 }),
    packageRedemptions: [{ customerPackageId: CUSTOMER_PACKAGES.haircuts.id, serviceId: SERVICES.haircut.id, serviceName: SERVICES.haircut.name }],
  }));
  await seed("shop/sales", toMap(draws));

  await openTill(page);
  await expect.poll(async () => (await storedPackage()).usesLeft, POLL).toBe(0);

  await pickCustomer(page);
  await tile(page, SERVICES.haircut.name).click();

  // Full price, no coverage note.
  await expect(page.getByText(/Covered by/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete sale · ₹500 · UPI" })).toBeVisible();
});

test("an expired package stops covering", async ({ page }) => {
  // Sessions left but the validity has lapsed — the other half of isRedeemable.
  await seedCustomerPackages([{ ...CUSTOMER_PACKAGES.haircuts, expiresAt: todayISO(-1) }]);

  await openTill(page);
  await pickCustomer(page);
  await tile(page, SERVICES.haircut.name).click();

  await expect(page.getByText(/Covered by/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete sale · ₹500 · UPI" })).toBeVisible();
});
