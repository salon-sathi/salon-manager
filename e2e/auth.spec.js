/**
 * Phase 1 — authentication and the role gate.
 *
 * Signing in proves WHO you are; RoleGate resolves WHAT you may do, and nothing renders
 * until it has. These specs cover both halves in a real browser: the three ways in, the
 * three ways to be refused, and what each role's rail actually offers.
 *
 * Deliberately NOT re-tested here: the per-view `guard()` backstop and the owner's Feature
 * access switches. Those are already covered against the real app module by
 * src/permissions.integration.test.jsx, which can drive state this suite cannot reach
 * through the UI (there are no routes, so a role simply cannot navigate to a tab its rail
 * does not offer). Duplicating them here would buy nothing and cost a minute a run.
 *
 * Each test gets a fresh browser context — the Firebase SDK persists the signed-in user in
 * IndexedDB, so sessions do not leak between tests but also cannot be cleared by wiping
 * cookies or localStorage inside one.
 */
import { expect, test } from "@playwright/test";
import { ACCOUNTS } from "./fixtures/seed.js";
import { navItem, openOtherGroup, signIn, submitSignIn } from "./fixtures/app.js";

// The sign-in card, used to assert we are still on it after a rejection.
const signInButton = (page) => page.getByRole("button", { name: "Sign in", exact: true });

test.describe("signing in", () => {
  for (const role of ["owner", "biller", "inventory"]) {
    test(`${role} signs in and reaches the shell`, async ({ page }) => {
      const account = await signIn(page, role);

      await expect(navItem(page, "Dashboard")).toBeVisible();
      // The rail's status foot names who is signed in and as what — the one place the
      // resolved role is visible to the user, so it is worth asserting rather than
      // inferring the role from which tabs happen to be present.
      await expect(page.getByText(account.email, { exact: false })).toBeVisible();
    });
  }

  test("a wrong password is refused and stays on the sign-in card", async ({ page }) => {
    await submitSignIn(page, ACCOUNTS.owner.email, "not-the-password");

    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
    await expect(navItem(page, "Dashboard")).toHaveCount(0);
  });

  test("an unknown email is refused", async ({ page }) => {
    await submitSignIn(page, "nobody@e2e.salon.test", "whatever");

    // Which message appears depends on whether email-enumeration protection is on: with it
    // off the emulator answers EMAIL_NOT_FOUND ("No account with that email."), with it on
    // it answers INVALID_LOGIN_CREDENTIALS ("Incorrect email or password."). Both are
    // correct app behaviour and the setting is not ours, so accept either rather than
    // pinning the suite to an emulator default that can change under us.
    await expect(page.getByText(/No account with that email\.|Incorrect email or password\./)).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
  });

  test("an empty password is refused before any round trip", async ({ page }) => {
    await submitSignIn(page, ACCOUNTS.owner.email, "");

    await expect(page.getByText("Please enter your password.")).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
  });
});

test.describe("the role gate refuses", () => {
  // Authenticating is not authorisation. Both of these accounts have valid credentials and
  // get a real Firebase session — the gate is what stops them, and it must stop them at a
  // full-screen barrier rather than by rendering the shell and hiding tabs afterwards.
  test("an account with no staff record", async ({ page }) => {
    await submitSignIn(page, ACCOUNTS.stranger.email);

    await expect(page.getByText(/This account isn't set up for this salon yet/)).toBeVisible({ timeout: 30_000 });
    await expect(navItem(page, "Dashboard")).toHaveCount(0);
    // The gate offers a way out, or the user is stuck on a dead screen with a live session.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("a deactivated account", async ({ page }) => {
    await submitSignIn(page, ACCOUNTS.deactivated.email);

    await expect(page.getByText(/This account has been deactivated/)).toBeVisible({ timeout: 30_000 });
    await expect(navItem(page, "Dashboard")).toHaveCount(0);
  });

  test("and sign out from the barrier returns to the sign-in card", async ({ page }) => {
    await submitSignIn(page, ACCOUNTS.stranger.email);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(signInButton(page)).toBeVisible();
  });
});

test.describe("what each role's rail offers", () => {
  // Straight from GRANTS in src/lib/roles.js, restricted to tabs that are not turned off by
  // a FEATURES flag in lib/ui/nav.js. If a grant changes, these lists are meant to fail —
  // they are the UI half of the same matrix roles.test.js checks arithmetically.
  const RAIL = {
    biller: {
      visible: ["Dashboard", "Billing (POS)", "Sales History", "Appointments"],
      hidden: ["Salon Settings", "Stats", "Inventory", "Services", "Udhari (Credit)", "Add Expense", "Staff"],
    },
    inventory: {
      // Inventory is a superset of biller, plus stock. Alerts, Barcode Creator and Data
      // Import are in its grants too but are switched off by FEATURES, so they must NOT
      // appear — that is the flag doing its job, and it is worth pinning.
      visible: ["Dashboard", "Billing (POS)", "Sales History", "Appointments", "Inventory"],
      hidden: ["Salon Settings", "Stats", "Alerts", "Barcode Creator", "Data Import", "Staff"],
    },
    owner: {
      visible: ["Dashboard", "Billing (POS)", "Stats", "Inventory", "Salon Settings", "Staff"],
      // Turned off for everyone by FEATURES, owner included.
      hidden: ["Finance", "Alerts", "Barcode Creator", "Data Import"],
    },
  };

  for (const [role, { visible, hidden }] of Object.entries(RAIL)) {
    test(`${role}`, async ({ page }) => {
      await signIn(page, role);
      // Secondary tabs (Settings, Staff, Activity Log…) are not in the DOM until the group
      // is expanded, so both halves of the assertion have to happen with it open.
      await openOtherGroup(page);

      for (const label of visible) {
        await expect(navItem(page, label), `${role} should see "${label}"`).toBeVisible();
      }
      for (const label of hidden) {
        await expect(navItem(page, label), `${role} should NOT see "${label}"`).toHaveCount(0);
      }
    });
  }
});

test("signing out from the shell returns to the sign-in card", async ({ page }) => {
  await signIn(page, "owner");

  await page.getByRole("button", { name: "Logout" }).click();

  await expect(signInButton(page)).toBeVisible();
  await expect(navItem(page, "Dashboard")).toHaveCount(0);
});
