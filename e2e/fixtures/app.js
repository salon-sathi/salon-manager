/**
 * Helpers for driving the app itself.
 *
 * The app has no router — navigation is a `tab` state variable in the shell driving a lazy
 * view switch (see salon-manager.jsx), so nothing can be deep-linked. Every spec starts at
 * "/" and signs in, and every spec pays that cost.
 */
import { expect } from "@playwright/test";
import { ACCOUNTS, PASSWORD } from "./seed.js";

/**
 * Fill the sign-in form and submit it. Does NOT wait for the result — use it for the paths
 * that never reach the shell (a bad password, an account with no staff record).
 */
export async function submitSignIn(page, email, password = PASSWORD) {
  await page.goto("/");
  // The fields are wrapped in their <label>, so the accessible name comes from the label
  // text with no htmlFor to maintain.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * Sign in as one of the seeded accounts and wait for the app shell.
 *
 * @param {import('@playwright/test').Page} page
 * @param {keyof typeof ACCOUNTS} role
 */
export async function signIn(page, role) {
  const account = ACCOUNTS[role];
  if (!account) throw new Error(`signIn: unknown account "${role}". Known: ${Object.keys(ACCOUNTS).join(", ")}`);

  await submitSignIn(page, account.email);

  // Sign-in is a real auth round trip, then RoleGate's own subscription to shop/users<uid>
  // ("Checking your access…"), then the first snapshot of every readable slice. The shell's
  // <main> renders only once all three have landed, which is what makes it the signal.
  //
  // Deliberately NOT a nav button: the sidebar is a drawer on a phone, so waiting on one
  // would make this helper silently desktop-only and hang every narrow-viewport spec.
  await expect(page.locator("main.main")).toBeVisible({ timeout: 30_000 });

  return account;
}

/**
 * A sidebar destination, by its visible name. NavButton carries title + aria-label with the
 * same text, so this keeps working on the tablet rail where the label itself is hidden.
 */
export function navItem(page, label) {
  return page.getByRole("button", { name: label, exact: true });
}

/**
 * Expand the sidebar's "Other" group.
 *
 * Its tabs are NOT in the DOM until it is opened (`showOther && myOtherTabs.map(...)` in the
 * shell) and the group itself is hidden outright when the role has nothing in it. So an
 * assertion that a role cannot see "Salon Settings" is worthless without this: the tab would
 * be absent for every role, including the owner, just because the group is collapsed.
 *
 * The button has no aria-label — its accessible name comes from its content ("⋯ Other ▸") —
 * hence the substring match rather than an exact one.
 */
export async function openOtherGroup(page) {
  const other = page.getByRole("button", { name: "Other" });
  if ((await other.count()) === 0) return false; // this role has no secondary tabs at all
  if ((await other.getAttribute("aria-expanded")) !== "true") await other.click();
  return true;
}

/**
 * Console noise that is not a defect, matched against console.error text.
 *
 * Keep this list short and justify every entry — it is the thing standing between "no
 * console errors" being a real assertion and being decoration.
 */
const IGNORED_CONSOLE_ERRORS = [
  // Vite serves no favicon in dev; the browser logs the 404 as an error.
  /favicon\.ico/i,
  // The auth emulator answers a signed-out getAccountInfo with 400 before the first sign-in.
  /identitytoolkit.*400/i,
];

/**
 * Watch for console errors and uncaught exceptions for the life of a test.
 *
 * Split on purpose. An uncaught exception is always a defect, so specs assert it empty.
 * Console errors are noisier — third-party SDKs log them for recoverable conditions — so
 * they are filtered through the list above.
 *
 * Returns getters rather than arrays so a spec reads them at the point it asserts, after
 * the actions that would produce them.
 */
export function watchConsole(page) {
  const consoleErrors = [];
  const exceptions = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!IGNORED_CONSOLE_ERRORS.some((re) => re.test(text))) consoleErrors.push(text);
  });
  page.on("pageerror", (err) => exceptions.push(String(err)));
  return { errors: () => consoleErrors, exceptions: () => exceptions };
}
