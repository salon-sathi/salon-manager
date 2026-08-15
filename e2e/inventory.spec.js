/**
 * Phase 5 — stock.
 *
 * Selling is the only thing in this app that moves stock without anyone typing a number, so
 * that is where the specs concentrate: a bill has to deplete the shelf, and the shelf has to
 * be able to say no. `stock` is the authoritative count and batches track only the dated
 * portion (see removeStock), which is why these assert the count rather than the batches.
 *
 * The shelf is reset before every test because billing consumes it — without that, whether
 * "only 1 left" is true depends on which specs ran first.
 */
import { expect, test } from "@playwright/test";
import { clearPath, readAsAdmin, seed } from "./fixtures/seed.js";
import { ITEMS, SERVICES, STAFF, seedItems } from "./fixtures/salon.js";
import { navItem, signIn } from "./fixtures/app.js";

const POLL = { timeout: 15_000 };
const SHAMPOO = ITEMS.shampoo;

test.beforeEach(async () => {
  await clearPath("shop/sales");
  await seedItems();
});

// ---- helpers -------------------------------------------------------------------------

async function openTill(page, role = "owner") {
  await signIn(page, role);
  await navItem(page, "Billing (POS)").click();
  await expect(page.getByText("Bill is empty.")).toBeVisible();
}

async function openStockRoom(page, role = "owner") {
  await signIn(page, role);
  await navItem(page, "Inventory").click();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
}

const tile = (page, name) => page.locator(".pick").filter({ hasText: name });

async function addProduct(page, item = SHAMPOO) {
  await page.getByRole("button", { name: /Products/ }).click();
  await tile(page, item.name).click();
}

const completeSale = (page) => page.getByRole("button", { name: /Complete sale/ }).click();

const storedItems = async () => Object.values((await readAsAdmin("shop/items")) || {});
const storedShampoo = async () => (await readAsAdmin(`shop/items/${SHAMPOO.id}`)) || {};

// ---- selling moves stock -------------------------------------------------------------

test("billing a product deducts it from stock", async ({ page }) => {
  await openTill(page);
  await addProduct(page); // 1 of 10

  await completeSale(page);

  await expect.poll(async () => (await storedShampoo()).stock, POLL).toBe(9);
});

test("the quantity billed is the quantity deducted", async ({ page }) => {
  await openTill(page);
  await addProduct(page);
  await page.getByLabel(`Increase ${SHAMPOO.name}`).click();
  await page.getByLabel(`Increase ${SHAMPOO.name}`).click(); // qty 3

  await expect(page.getByRole("button", { name: "Complete sale · ₹1,050 · UPI" })).toBeVisible();
  await completeSale(page);

  await expect.poll(async () => (await storedShampoo()).stock, POLL).toBe(7);
});

test("a service on the same bill moves no stock", async ({ page }) => {
  // Services consume nothing sellable — the deduction is filtered by line type, and a service
  // id colliding with an item id must not quietly decrement the shelf.
  await openTill(page);
  await tile(page, SERVICES.haircut.name).click();
  await page.getByLabel(`Who performed ${SERVICES.haircut.name}`).selectOption({ label: STAFF.asha.name });
  await addProduct(page);

  await completeSale(page);

  await expect.poll(async () => (await storedShampoo()).stock, POLL).toBe(9);
  // Nothing else on the shelf moved either.
  expect((await storedItems()).filter((i) => i.id !== SHAMPOO.id).every((i) => i.stock === 0)).toBe(true);
});

test("the cart cannot be filled past the shelf", async ({ page }) => {
  // The first of two defences, and the one a user actually meets: the qty control clamps to
  // what is on the shelf as the line is built.
  await seedItems([{ ...SHAMPOO, stock: 2 }]);

  await openTill(page);
  await addProduct(page);
  await page.getByLabel(`Increase ${SHAMPOO.name}`).click(); // qty 2 — the whole shelf
  await page.getByLabel(`Increase ${SHAMPOO.name}`).click(); // refused

  await expect(page.getByText("Only 2 in stock")).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete sale · ₹700 · UPI" })).toBeVisible();
});

test("a bottle sold on another till is caught at checkout", async ({ page }) => {
  // The second defence, and the reason it exists: the cart clamp above only knew the stock at
  // the moment the line was built. This is the case the comment in completeSale describes —
  // another device sells the same bottles while this bill sits open — and it is only
  // reachable with a real database behind a live subscription, which is to say only here.
  await seedItems([{ ...SHAMPOO, stock: 3 }]);

  await openTill(page);
  await addProduct(page);
  await page.getByLabel(`Increase ${SHAMPOO.name}`).click();
  await page.getByLabel(`Increase ${SHAMPOO.name}`).click(); // qty 3, legal at the time
  await expect(page.getByRole("button", { name: "Complete sale · ₹1,050 · UPI" })).toBeVisible();

  // The other till sells two. Waiting for the tile to show the new count is what makes this
  // deterministic — clicking before the snapshot lands would test the old stock.
  await seed(`shop/items/${SHAMPOO.id}/stock`, 1);
  await expect(tile(page, SHAMPOO.name)).toContainText("1 left");

  await completeSale(page);

  await expect(page.getByText(`Only 1 ${SHAMPOO.unit} of ${SHAMPOO.name} left — adjust the bill.`)).toBeVisible();
  await expect.poll(async () => Object.values((await readAsAdmin("shop/sales")) || {}), POLL).toHaveLength(0);
  await expect.poll(async () => (await storedShampoo()).stock, POLL).toBe(1);
});

test("stock never goes negative", async ({ page }) => {
  // The guard above is the real protection; this pins the arithmetic underneath it, since a
  // negative count would flow into valuation and the low-stock alert.
  await seedItems([{ ...SHAMPOO, stock: 1 }]);

  await openTill(page);
  await addProduct(page);
  await completeSale(page);

  await expect.poll(async () => (await storedShampoo()).stock, POLL).toBe(0);
});

// ---- the shelf itself ----------------------------------------------------------------

test("an owner can add a product to the shelf", async ({ page }) => {
  await openStockRoom(page);

  await page.getByRole("button", { name: "+ Add item" }).click();
  await page.getByLabel("Item name").fill("E2E Serum");
  await page.getByLabel("Buying price (₹)").fill("150");
  await page.getByLabel("Selling price (₹)").fill("400");
  await page.getByLabel("Opening stock").fill("6");
  await page.getByLabel("Alert when stock below").fill("2");
  await page.getByRole("button", { name: "Add item", exact: true }).click();

  await expect
    .poll(async () => (await storedItems()).find((i) => i.name === "E2E Serum"), POLL)
    .toMatchObject({ name: "E2E Serum", buyPrice: 150, sellPrice: 400, stock: 6, lowAt: 2 });
});

test("a low shelf is flagged in the stock list", async ({ page }) => {
  // lowAt is 3. Selling down to it is what a salon actually does — the warning has to appear
  // off the back of a bill, not only when someone types a number into the stock room.
  await seedItems([{ ...SHAMPOO, stock: 4 }]);

  await openTill(page);
  await addProduct(page);
  await page.getByLabel(`Increase ${SHAMPOO.name}`).click(); // qty 2 → 4 - 2 = 2, at or below lowAt 3
  await completeSale(page);
  await expect.poll(async () => (await storedShampoo()).stock, POLL).toBe(2);

  await navItem(page, "Inventory").click();

  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  // The row renders the count with a ⚠ once stock <= lowAt.
  await expect(page.getByRole("row").filter({ hasText: SHAMPOO.name })).toContainText("⚠");
});

test("a healthy shelf is not flagged", async ({ page }) => {
  // The other half — without this, a spec asserting "⚠ appears" would pass on an app that
  // showed it always.
  await openStockRoom(page);

  await expect(page.getByRole("row").filter({ hasText: SHAMPOO.name })).toContainText("10");
  await expect(page.getByRole("row").filter({ hasText: SHAMPOO.name })).not.toContainText("⚠");
});

test("an inventory worker can reach the stock room", async ({ page }) => {
  // inventory.view/edit are that role's whole reason to exist.
  await openStockRoom(page, "inventory");

  await expect(page.getByRole("button", { name: "+ Add item" })).toBeVisible();
});
