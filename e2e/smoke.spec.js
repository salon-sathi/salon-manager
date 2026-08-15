/**
 * Phase 0 smoke: proves the rig, not the product.
 *
 * What has to be true before any real spec is worth writing:
 *   1. the dev server is running against the EMULATOR, not the live project;
 *   2. the seeded accounts can sign in and reach the shell;
 *   3. the seeded ROLES are the ones the app actually applies.
 *
 * (3) is the one that would otherwise rot silently. If the fixture wrote shop/users to a
 * different database namespace than the app reads, the app would find the node empty and
 * bootstrap whoever signed in first as an owner (RoleGate in salon-manager.jsx). Every spec
 * would then run with owner rights and the role-based ones would pass for the wrong reason.
 * Asserting that a biller CANNOT see an owner-only tab is what catches that.
 *
 * Each test gets its own browser context, which is what actually separates the sessions:
 * the Firebase SDK persists a signed-in user in IndexedDB, so clearing cookies and
 * localStorage inside one context would NOT sign the previous role out.
 */
import { expect, test } from "@playwright/test";
import { navItem, openOtherGroup, signIn, watchConsole } from "./fixtures/app.js";

test("owner signs in and reaches the dashboard", async ({ page }) => {
  const { errors, exceptions } = watchConsole(page);

  await signIn(page, "owner");

  await expect(navItem(page, "Dashboard")).toBeVisible();
  await expect(navItem(page, "Billing (POS)")).toBeVisible();
  // The sign-in card is gone rather than merely covered.
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);

  expect(exceptions(), "uncaught exceptions while opening the dashboard").toEqual([]);
  expect(errors(), "console errors while opening the dashboard").toEqual([]);
});

// Settings is owner-only: "settings.manage" is not in GRANTABLE for any role (roles.js), so
// no owner switch can hand it to a biller. These two tests are a pair — the second is only
// meaningful because the first shows the tab exists, is named exactly this, and is reachable
// once the "Other" group is open.
test("an owner sees the owner-only Settings tab", async ({ page }) => {
  await signIn(page, "owner");
  expect(await openOtherGroup(page), "the owner has secondary tabs").toBe(true);
  await expect(navItem(page, "Salon Settings")).toBeVisible();
});

test("a biller does not see the owner-only Settings tab", async ({ page }) => {
  await signIn(page, "biller");
  await expect(navItem(page, "Dashboard")).toBeVisible();
  // Open the group first, or this asserts nothing — a collapsed group hides the tab from
  // the owner too.
  await openOtherGroup(page);
  await expect(navItem(page, "Salon Settings")).toHaveCount(0);
});
