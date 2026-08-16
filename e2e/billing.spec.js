/**
 * Phase 3 — the till.
 *
 * Three things here that no other suite in this repo can test:
 *
 * 1. **The money.** The arithmetic is pure and covered by salon/stats tests, but the till is
 *    where a discount mode, a redemption ceiling and a qty bump all land on the same number.
 *    These specs assert what reached `shop/sales`, not what the totals panel rendered.
 * 2. **Print.** printReceipt() writes into a hidden same-origin iframe and calls print() on
 *    it. jsdom has no iframe document to inspect and no print; a real browser has both.
 * 3. **The receipt JPEG.** SVG <foreignObject> → <img> → canvas → toBlob is the whole reason
 *    receipts are rasterized rather than PDF'd, and it exists only in a browser. The share
 *    spec drives it through the actual button and inspects the File that comes out.
 *
 * Sales are append-only for a non-owner (`(!data.exists() && newData.exists()) || owner` in
 * database.rules.json), so nothing here edits a saved bill — that is not a gap.
 */
import { expect, test } from "@playwright/test";
import { clearPath, readAsAdmin } from "./fixtures/seed.js";
import { ITEMS, SERVICES, STAFF } from "./fixtures/salon.js";
import { navItem, signIn } from "./fixtures/app.js";

const POLL = { timeout: 10_000 };

test.beforeEach(async () => {
  // Bills and the diary both accumulate; every spec starts from an empty till.
  await Promise.all([clearPath("shop/sales"), clearPath("shop/appointments")]);
});

// ---- helpers -------------------------------------------------------------------------

async function openTill(page, role = "owner") {
  await signIn(page, role);
  await navItem(page, "Billing (POS)").click();
  // Not "Complete sale": the whole checkout panel — totals, payment, that button — only
  // exists while the cart has something in it. An empty till shows this instead, which is
  // also where the print and share buttons appear once a bill has been rung up.
  await expect(page.getByText("Bill is empty.")).toBeVisible();
}

/** A catalogue tile. They are plain divs with an onClick, so there is no role to ask for. */
const tile = (page, name) => page.locator(".pick").filter({ hasText: name });

/**
 * Attribute a cart line to a stylist.
 *
 * Done per line rather than through the "Performed by" picker above the catalogue: that one
 * is an unlabelled <select> in a styled div, while every cart line exposes
 * `aria-label="Who performed <name>"`. Same result, a selector that says what it means.
 */
async function assignStaff(page, serviceName, staffName) {
  await page.getByLabel(`Who performed ${serviceName}`).selectOption({ label: staffName });
}

async function addService(page, service, staffName = STAFF.asha.name) {
  await tile(page, service.name).click();
  await assignStaff(page, service.name, staffName);
}

async function savedSales() {
  return Object.values((await readAsAdmin("shop/sales")) || {});
}
const firstSale = async () => (await savedSales())[0];

// ---- the money -----------------------------------------------------------------------

test("a service bill totals and saves", async ({ page }) => {
  await openTill(page);

  await addService(page, SERVICES.haircut); // ₹500
  await expect(page.getByRole("button", { name: "Complete sale · ₹500 · UPI" })).toBeVisible();

  await page.getByRole("button", { name: /Complete sale/ }).click();

  await expect.poll(firstSale, POLL).toMatchObject({
    total: 500,
    payment: "UPI",
    lines: [
      {
        name: SERVICES.haircut.name,
        qty: 1,
        price: 500,
        amount: 500,
        lineType: "service",
        staffId: STAFF.asha.id,
        serviceId: SERVICES.haircut.id,
      },
    ],
  });

  // The cart clears, so the next customer cannot be charged for the last one's bill. With
  // nothing in it the checkout panel goes away entirely and the empty state comes back.
  await expect(page.getByText("Bill is empty.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Complete sale/ })).toHaveCount(0);
});

test("the counter offers two payment modes — Udhari is parked", async ({ page }) => {
  // The payment row lives behind a non-empty cart, which is why the jsdom suite pins the
  // exported PAY_MODES list instead and this is the assertion against the rendered thing.
  // FEATURES.udhari in src/lib/features.js is what makes it two; flip that flag and this
  // test is meant to fail, because a third button is exactly what the flip is for.
  await openTill(page);
  await addService(page, SERVICES.haircut);

  await expect(page.getByRole("button", { name: "UPI", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cash", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Udhari/i })).toHaveCount(0);
  // Nothing else on the till names it either — no "on credit" read-out, no "owes" placeholder.
  await expect(page.getByText(/udhari/i)).toHaveCount(0);
});

test("a quantity bump multiplies the line", async ({ page }) => {
  await openTill(page);
  await addService(page, SERVICES.haircut);

  await page.getByLabel(`Increase ${SERVICES.haircut.name}`).click();

  await expect(page.getByRole("button", { name: "Complete sale · ₹1,000 · UPI" })).toBeVisible();
  await page.getByRole("button", { name: /Complete sale/ }).click();

  await expect.poll(firstSale, POLL).toMatchObject({ total: 1000, lines: [{ qty: 2, amount: 1000 }] });
});

test("a service and a product bill together", async ({ page }) => {
  await openTill(page);
  await addService(page, SERVICES.haircut); // ₹500

  await page.getByRole("button", { name: /Products/ }).click();
  await tile(page, ITEMS.shampoo.name).click(); // ₹350

  await expect(page.getByRole("button", { name: "Complete sale · ₹850 · UPI" })).toBeVisible();
  await page.getByRole("button", { name: /Complete sale/ }).click();

  const sale = await (async () => {
    await expect.poll(savedSales, POLL).toHaveLength(1);
    return firstSale();
  })();
  expect(sale.total).toBe(850);
  expect(sale.lines.map((l) => l.lineType).sort()).toEqual(["product", "service"]);
});

test("a flat ₹ discount comes off the total and is recorded", async ({ page }) => {
  await openTill(page);
  await addService(page, SERVICES.colour); // ₹1200

  await page.getByRole("button", { name: "Discount in rupees" }).click();
  await page.getByLabel("Additional discount amount").fill("200");

  await expect(page.getByRole("button", { name: "Complete sale · ₹1,000 · UPI" })).toBeVisible();
  await page.getByRole("button", { name: /Complete sale/ }).click();

  // subtotal/discount are only written when a discount was actually given, so a plain bill
  // keeps its original shape — asserting all three pins that rule.
  await expect.poll(firstSale, POLL).toMatchObject({ subtotal: 1200, discount: 200, total: 1000 });
});

test("a % discount is worked out against the subtotal", async ({ page }) => {
  await openTill(page);
  await addService(page, SERVICES.colour); // ₹1200

  await page.getByRole("button", { name: "Discount in percent" }).click();
  await page.getByLabel("Additional discount amount").fill("10");

  await expect(page.getByRole("button", { name: "Complete sale · ₹1,080 · UPI" })).toBeVisible();
  await page.getByRole("button", { name: /Complete sale/ }).click();

  await expect.poll(firstSale, POLL).toMatchObject({ subtotal: 1200, discount: 120, discountPct: 10, total: 1080 });
});

test("a discount cannot push a bill below zero", async ({ page }) => {
  // Clamped to [0, subtotal] in the view. A negative bill would flow into revenue, udhari and
  // every stat downstream, so it is worth pinning at the till rather than trusting the input.
  await openTill(page);
  await addService(page, SERVICES.threading); // ₹60

  await page.getByRole("button", { name: "Discount in rupees" }).click();
  await page.getByLabel("Additional discount amount").fill("999");

  await expect(page.getByRole("button", { name: "Complete sale · ₹0 · UPI" })).toBeVisible();
  await page.getByRole("button", { name: /Complete sale/ }).click();

  await expect.poll(firstSale, POLL).toMatchObject({ total: 0, discount: 60 });
});

test("a service with nobody assigned is refused", async ({ page }) => {
  // Every service line must say who performed it or its commission has nowhere to go and the
  // stylist quietly loses the money.
  await openTill(page);
  await tile(page, SERVICES.haircut.name).click(); // added, deliberately unassigned

  await page.getByRole("button", { name: /Complete sale/ }).click();

  await expect(page.getByText(new RegExp(`Who did .${SERVICES.haircut.name}.\\?`))).toBeVisible();
  await expect.poll(savedSales, POLL).toHaveLength(0);
});

// ---- from the diary ------------------------------------------------------------------

test("Complete → Bill carries an appointment into the till and closes it", async ({ page }) => {
  // The whole point of the diary: a finished appointment becomes a bill without re-typing the
  // customer, the services or who did them.
  await openTill(page);

  await navItem(page, "Appointments").click();
  await page.getByRole("button", { name: `Book ${STAFF.asha.name} at 11:00 am` }).click();
  await page.locator("label").filter({ hasText: SERVICES.haircut.name }).last().getByRole("checkbox").check();
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.locator("button[title*=' · ']")).toHaveCount(1);

  await page.locator("button[title*=' · ']").first().click();
  await page.getByRole("button", { name: "Complete → Bill" }).click();

  // Landed at the till with the appointment's line already in the cart and its stylist kept.
  await expect(page.getByRole("button", { name: "Complete sale · ₹500 · UPI" })).toBeVisible();
  await expect(page.getByLabel(`Who performed ${SERVICES.haircut.name}`)).toHaveValue(STAFF.asha.id);

  await page.getByRole("button", { name: /Complete sale/ }).click();

  const sale = await (async () => {
    await expect.poll(savedSales, POLL).toHaveLength(1);
    return firstSale();
  })();
  expect(sale.total).toBe(500);
  expect(sale.appointmentId).toBeTruthy();

  // The diary side of the handover: the appointment is closed and linked, so a second
  // Complete → Bill cannot charge the same customer twice.
  await expect
    .poll(async () => Object.values((await readAsAdmin("shop/appointments")) || {})[0], POLL)
    .toMatchObject({ status: "completed", billId: sale.id });
});

// ---- the receipt ---------------------------------------------------------------------

test("printing the last bill renders the receipt into the print frame", async ({ page }) => {
  // window.print() is stubbed before anything loads. addInitScript runs in EVERY frame,
  // including the srcdoc print frame, which is where print() is actually called — headless
  // Chromium's implementation is not something to leave a suite waiting on.
  await page.addInitScript(() => {
    window.print = () => {};
  });

  await openTill(page);
  await addService(page, SERVICES.haircut);
  await page.getByRole("button", { name: /Complete sale/ }).click();

  await page.getByRole("button", { name: /Print last bill/ }).click();

  // printHtml appends a hidden iframe and fills it via srcdoc. Same-origin, so its document
  // is readable — this asserts the real receipt markup, not a mock of it.
  const receipt = page.frameLocator('iframe[aria-hidden="true"]');
  await expect(receipt.locator(".rcpt")).toBeVisible();
  await expect(receipt.getByText(SERVICES.haircut.name)).toBeVisible();
  await expect(receipt.getByText("₹500", { exact: false }).first()).toBeVisible();

  // The stylist is NOT on the customer's copy: config.showStaffOnReceipt is off by default and
  // no spec here turns it on. toHaveCount(0) rather than not.toBeVisible() — the latter also
  // passes when the locator resolves to nothing for an unrelated reason. The service name and
  // total above are what stop this from passing on a receipt that rendered nothing at all.
  await expect(receipt.getByText(STAFF.asha.name)).toHaveCount(0);
});

test("the stylist stays on the bill internally, off the customer's copy", async ({ page }) => {
  // The other half of the assertion above. Hiding the name on the receipt is a presentation
  // change: staffId is still snapshotted onto the line, and Sales History is where the salon
  // reads it back. A regression that dropped the attribution from the DATA would leave the
  // receipt spec passing and this one failing, which is exactly the split that's wanted.
  await openTill(page);
  await addService(page, SERVICES.haircut);
  await page.getByRole("button", { name: /Complete sale/ }).click();

  // The saved record carries the attribution regardless of what the receipt prints.
  await expect.poll(firstSale, POLL).toMatchObject({
    lines: [{ name: SERVICES.haircut.name, staffId: STAFF.asha.id }],
  });

  await navItem(page, "Sales History").click();
  // Today's group is always expanded; the bill row itself collapses, so open it to reach the
  // per-line detail. The row is a plain div with an onClick, hence the text locator.
  await page.getByText(/· 1 item/).first().click();
  await expect(page.getByText(STAFF.asha.name).first()).toBeVisible();
});

test("Share bill rasterizes the receipt to a real JPEG", async ({ page }) => {
  // The rasterizer is the reason receipts are images and not PDFs: every built-in PDF font is
  // WinAnsi and has no ₹, and a Devanagari shop name needs Indic shaping on top. Handing the
  // text to the browser is the whole design, so this has to run in one.
  //
  // navigator.share/canShare are absent in headless Chromium — and canShareImages() gates
  // whether the button renders at all — so both are stubbed. The stub captures the File's
  // first bytes, because "a Blob arrived" is not the same claim as "a JPEG arrived": a
  // tainted canvas (any remote <img> inside the SVG) makes toBlob throw instead.
  await page.addInitScript(() => {
    window.__shared = null;
    navigator.canShare = (data) => !!data?.files?.length;
    navigator.share = async (data) => {
      const f = data.files[0];
      const head = new Uint8Array(await f.slice(0, 3).arrayBuffer());
      window.__shared = { name: f.name, type: f.type, size: f.size, magic: Array.from(head) };
    };
  });

  await openTill(page);
  await addService(page, SERVICES.haircut);
  await page.getByRole("button", { name: /Complete sale/ }).click();

  await page.getByRole("button", { name: /Share bill/ }).click();

  const shared = await page.waitForFunction(() => window.__shared, null, { timeout: 30_000 }).then((h) => h.jsonValue());

  expect(shared.type).toBe("image/jpeg");
  expect(shared.name).toMatch(/\.jpg$/);
  // SOI marker. A blank or failed render would still produce a Blob; this would not survive it.
  expect(shared.magic).toEqual([0xff, 0xd8, 0xff]);
  // A receipt that rendered nothing still encodes to a valid but tiny JPEG, so size is the
  // check that catches the <foreignObject> parse failures the rasterizer exists to avoid.
  expect(shared.size).toBeGreaterThan(5000);
});

// ---- capturing the customer ----------------------------------------------------------
//
// The till's second customer field. The picker is the deliberate way to put a bill on a
// customer; a name and a number straight into the two boxes under the cart is what the front
// desk actually types when there is somebody waiting. Both must end up filing a customer.
//
// Only the emulator can prove this one: shop/customers/$id validates
// `hasChildren(['id','name'])` with a non-empty name, so a record built wrong is accepted by
// every jsdom test in the repo and rejected at the counter.

test.describe("a name typed on a bill becomes a customer", () => {
  const PHONE = "9876500077";

  test.beforeEach(async () => {
    // customers is rewritten by the app (reconcileLoyalty/reconcileCustomers recompute it from
    // the bills on every sync), so a known starting point has to be re-established per test.
    await clearPath("shop/customers");
  });

  const storedCustomer = async () => await readAsAdmin(`shop/customers/${PHONE}`);

  test("files them under their phone, and links the bill to the record", async ({ page }) => {
    await openTill(page);
    await addService(page, SERVICES.haircut); // ₹500
    // Typed with a space, exactly as a human writes a number down. The key must be normalised.
    await page.getByLabel("Customer name").fill("E2E Kavita");
    await page.getByLabel("Customer mobile").fill("98765 00077");

    await page.getByRole("button", { name: /Complete sale/ }).click();

    // The record the rules accepted: keyed by the bare 10 digits, id equal to it, name present.
    await expect.poll(storedCustomer, POLL).toMatchObject({ id: PHONE, phone: PHONE, name: "E2E Kavita" });
    // Linked, so the visit is theirs. Unlinked, they would sit on the list at 0 visits / ₹0.
    await expect.poll(firstSale, POLL).toMatchObject({ customerPhone: PHONE, customer: "E2E Kavita", total: 500 });
    // And the stats the shell derives from that bill come back onto the record.
    await expect.poll(async () => (await storedCustomer())?.totalVisits, POLL).toBe(1);
    await expect.poll(async () => (await storedCustomer())?.totalSpend, POLL).toBe(500);
  });

  test("shows up on the Customers screen without anybody adding them", async ({ page }) => {
    await openTill(page);
    await addService(page, SERVICES.haircut);
    await page.getByLabel("Customer name").fill("E2E Kavita");
    await page.getByLabel("Customer mobile").fill(PHONE);
    await page.getByRole("button", { name: /Complete sale/ }).click();
    await expect.poll(storedCustomer, POLL).toBeTruthy();

    await navItem(page, "Customers").click();

    // .first(): the name renders in the table row and again in the profile drawer's heading
    // once opened — strict mode would fail on the ambiguity rather than on the behaviour.
    await expect(page.getByText("E2E Kavita").first()).toBeVisible();
    await expect(page.getByText("98765 00077").first()).toBeVisible();
  });

  test("leaves a walk-in who gave no number alone", async ({ page }) => {
    // Phone is the key, so there is nothing to file this under. The bill still carries the
    // name as free text — Udhari groups debts by it — and the customer list stays clean.
    await openTill(page);
    await addService(page, SERVICES.haircut);
    await page.getByLabel("Customer name").fill("E2E Nobody");

    await page.getByRole("button", { name: /Complete sale/ }).click();

    await expect.poll(firstSale, POLL).toMatchObject({ customer: "E2E Nobody" });
    expect((await firstSale()).customerPhone).toBeUndefined();
    expect(await readAsAdmin("shop/customers")).toBeNull();
  });
});
