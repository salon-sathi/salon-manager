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
  await expect(receipt.getByText(STAFF.asha.name)).toBeVisible();
  await expect(receipt.getByText("₹500", { exact: false }).first()).toBeVisible();
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
