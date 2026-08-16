/**
 * The shell's layout at each width, in a browser that actually lays it out.
 *
 * responsive.integration.test.jsx asserts the CSS *rules* are present and say what they were
 * written to say — it cannot say whether a label is on screen, because jsdom has no cascade,
 * no viewport and no media-query evaluation. These are the assertions that need a real engine:
 * a computed width, a visible label, and whether the page overflows sideways.
 *
 * Horizontal overflow is the one that actually ruins a device — a rail that does not fit
 * pushes the content column off the edge and every screen scrolls sideways — so every band
 * checks for it.
 */
import { expect, test } from "@playwright/test";
import { navItem, signIn } from "./fixtures/app.js";

/** True when the document is wider than its own viewport. */
const overflowsSideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const railWidth = (page) => page.locator(".nav").evaluate((el) => el.getBoundingClientRect().width);

test.describe("tablet — iPad portrait", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("shows the full labelled rail, the same as a laptop", async ({ page }) => {
    // This band used to collapse to a 64px icon strip. The nav's glyphs ("⊟", "∑", "▦") do not
    // read on their own, so a collapsed rail meant tapping ☰ and guessing on every navigation.
    await signIn(page, "owner");

    await expect(navItem(page, "Billing (POS)")).toBeVisible();
    await expect(page.locator(".nav .navlabel").first()).toBeVisible();
    expect(await railWidth(page)).toBeGreaterThan(180);

    // The reason the rail was collapsed in the first place. It has to fit at this width.
    expect(await overflowsSideways(page), "a tablet must not scroll sideways").toBe(false);
  });

  test("has no expand control, because nothing is collapsed", async ({ page }) => {
    await signIn(page, "owner");

    // The button is always in the DOM — it is CSS that decides where it appears — so this is a
    // visibility assertion, not a presence one.
    await expect(page.getByRole("button", { name: "Expand menu" })).toBeHidden();
  });
});

test.describe("laptop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("is unchanged", async ({ page }) => {
    await signIn(page, "owner");

    await expect(page.locator(".nav .navlabel").first()).toBeVisible();
    expect(await railWidth(page)).toBeGreaterThan(180);
    expect(await overflowsSideways(page)).toBe(false);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the rail as a drawer, not pinned open", async ({ page }) => {
    // 210px of a 390px screen would leave the till 180px, so here the rail is hidden until
    // asked for. Guards the drawer behaviour as much as the tablet change above.
    await signIn(page, "owner");

    await expect(navItem(page, "Billing (POS)")).toBeHidden();
    expect(await overflowsSideways(page), "a phone must not scroll sideways").toBe(false);

    await page.getByRole("button", { name: "Open menu" }).or(page.getByRole("button", { name: "Expand menu" })).first().click();

    await expect(navItem(page, "Billing (POS)")).toBeVisible();
    await expect(page.locator(".nav .navlabel").first()).toBeVisible();
  });
});
