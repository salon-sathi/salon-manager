/**
 * Phase 2 — the appointment diary.
 *
 * The overlap check is the load-bearing part of this feature: double-booking a stylist means
 * two customers in the doorway at once, and the salon eats it. appointments.test.js proves
 * that arithmetic in isolation; these specs prove the diary actually applies it — on create,
 * on reschedule, and against blocked-out time — through the same modal the front desk uses.
 *
 * Two things shape how these are written:
 *
 * 1. **Blocks sit ON TOP of the slot buttons.** Both are absolutely positioned in the same
 *    column and the blocks render last, so a slot under an existing booking cannot be clicked
 *    — Playwright would hit the block and open it for editing instead. Specs that need a
 *    clashing time therefore open a booking on a FREE slot and type the clashing time into
 *    the modal. Only the create spec clicks the slot it actually wants.
 *
 * 2. **Every test starts with an empty diary.** shop/appointments is cleared before each one
 *    (the slice has no seeder, so nothing refills it), which is what lets them all use the
 *    same stylist at the same o'clock without ordering coupling.
 */
import { expect, test } from "@playwright/test";
import { clearPath, readAsAdmin } from "./fixtures/seed.js";
import { SERVICES, STAFF } from "./fixtures/salon.js";
import { navItem, signIn } from "./fixtures/app.js";

// A quiet corner of the day to open a booking from when the time under test is occupied.
// 8:00 pm + the longest fixture service (60 min) still lands inside the 9:00 pm close.
const FREE_SLOT = "8:00 pm";

test.beforeEach(async () => {
  await clearPath("shop/appointments");
});

// ---- helpers -------------------------------------------------------------------------

async function openDiary(page, role = "owner") {
  await signIn(page, role);
  await navItem(page, "Appointments").click();
  await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
}

/** The empty-slot tap target, by the label the grid gives it. */
const slot = (page, staffName, clock) => page.getByRole("button", { name: `Book ${staffName} at ${clock}` });

/** A saved booking in the grid. Blocks are buttons whose title carries time and status. */
const blocks = (page) => page.locator("button[title*=' · ']");

const dialog = (page, name) => page.getByRole("dialog", { name });

/**
 * Tick a service in the modal's menu.
 *
 * Picking these by accessible name does not work. `Field` wraps its whole child in a <label>,
 * so the services box sits inside one — and the FIRST checkbox in it inherits an accessible
 * name made of the field label plus every service in the list ("Services · … E2E Colour 60m
 * ₹1,200 E2E Haircut 45m ₹500 …"). That breaks matching in both directions: an unanchored
 * regex matches the aggregate as well as the real row, and an anchored one matches nothing
 * for whichever service happens to sort first (RTDB returns the slice key-sorted, so it is
 * "E2E Colour" today and would change if a service were renamed).
 *
 * Locating the row instead is stable: exactly two <label>s contain the name, and the Field
 * wrapper is an ancestor of the other, so it is always first in DOM order.
 */
async function pickService(page, name) {
  const row = page.locator("label").filter({ hasText: name }).last();
  await row.getByRole("checkbox").check();
}

/** Fill the modal's start time. The input is type=time, so it takes 24h "HH:MM". */
async function setStartTime(page, hm) {
  await page.getByLabel("Start time").fill(hm);
}

/** What actually reached the database, so a spec can assert the record rather than the pixels. */
async function savedAppointments() {
  const stored = (await readAsAdmin("shop/appointments")) || {};
  return Object.values(stored);
}

const firstSaved = async () => (await savedAppointments())[0];

/**
 * Database assertions POLL. They have to.
 *
 * Every slice write in the shell is debounced — `setTimeout(() => pushSlice("appointments",
 * …), 300)` in salon-manager.jsx — and then round-trips to the emulator. The UI updates from
 * React state immediately, so reading the database the moment a block appears reads the state
 * from BEFORE the write and fails on stale data. `expect.poll` retries until it lands; a
 * fixed sleep would be both slower and still occasionally wrong.
 */
const POLL = { timeout: 10_000 };

// ---- creating ------------------------------------------------------------------------

test("booking a slot creates an appointment with the service's duration", async ({ page }) => {
  await openDiary(page);

  await slot(page, STAFF.asha.name, "11:00 am").click();
  await expect(dialog(page, "New appointment")).toBeVisible();

  await pickService(page, SERVICES.haircut.name);
  // Duration is derived from the services, never typed — that is what makes a booking reserve
  // as long as the work actually takes.
  await expect(page.getByLabel("Ends")).toHaveValue("11:45 am");

  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect(page.getByText("✓ Booked")).toBeVisible();
  await expect(dialog(page, "New appointment")).toHaveCount(0);
  await expect(blocks(page)).toHaveCount(1);
  await expect(blocks(page).first()).toHaveAttribute("title", "11:00 am–11:45 am · Booked");

  await expect.poll(firstSaved, POLL).toMatchObject({
    staffId: STAFF.asha.id,
    startMin: 11 * 60,
    durationMin: 45,
    serviceIds: [SERVICES.haircut.id],
    status: "booked",
  });
});

test("a booking survives a reload", async ({ page }) => {
  // The diary is React state fed by a live snapshot. Asserting a block appeared proves the
  // state changed; only coming back to it proves the write reached the database.
  await openDiary(page);
  await slot(page, STAFF.asha.name, "11:00 am").click();
  await pickService(page, SERVICES.haircut.name);
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await expect(blocks(page)).toHaveCount(1);
  // Wait for the write to actually land, or the reload throws away a booking that only ever
  // existed in React state and this test asserts nothing.
  await expect.poll(savedAppointments, POLL).toHaveLength(1);

  await page.reload();
  await navItem(page, "Appointments").click();

  await expect(blocks(page)).toHaveCount(1);
  await expect(blocks(page).first()).toHaveAttribute("title", "11:00 am–11:45 am · Booked");
});

test("two services on one booking reserve their combined length", async ({ page }) => {
  await openDiary(page);

  await slot(page, STAFF.asha.name, "11:00 am").click();
  await pickService(page, SERVICES.haircut.name); // 45
  await pickService(page, SERVICES.threading.name); // 15
  await expect(page.getByLabel("Ends")).toHaveValue("12:00 pm");

  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect.poll(async () => (await firstSaved())?.durationMin, POLL).toBe(60);
});

// ---- double-booking ------------------------------------------------------------------

test.describe("double-booking", () => {
  /** Put a 45-minute haircut in Asha's chair at 11:00, the fixed obstacle these specs test against. */
  async function bookAshaEleven(page) {
    await slot(page, STAFF.asha.name, "11:00 am").click();
    await pickService(page, SERVICES.haircut.name);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(blocks(page)).toHaveCount(1);
  }

  test("a clashing time is warned about before saving and refused on save", async ({ page }) => {
    await openDiary(page);
    await bookAshaEleven(page);

    // Opened on a free slot, then moved onto the obstacle — the slot under a block cannot be
    // clicked, and this is the same edit the front desk would make anyway.
    await slot(page, STAFF.asha.name, FREE_SLOT).click();
    await pickService(page, SERVICES.threading.name);
    await setStartTime(page, "11:30");

    // The warning is live, while the time is being chosen: "3:15 is free" beats a rejection
    // after the customer has been told a time.
    await expect(page.getByText(/Asha is already busy 11:00 am–11:45 am/)).toBeVisible();

    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByText("Clashes with another booking at 11:00 am–11:45 am.")).toBeVisible();
    await expect(dialog(page, "New appointment")).toBeVisible(); // refused, not saved and closed
    await expect(blocks(page)).toHaveCount(1);
    await expect.poll(savedAppointments, POLL).toHaveLength(1);
  });

  test("the same time in another stylist's chair is fine", async ({ page }) => {
    await openDiary(page);
    await bookAshaEleven(page);

    // Ravi's column is empty, so this slot is clickable and must be bookable.
    await slot(page, STAFF.ravi.name, "11:00 am").click();
    await pickService(page, SERVICES.haircut.name);
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(blocks(page)).toHaveCount(2);
    await expect
      .poll(async () => (await savedAppointments()).map((a) => a.staffId).sort(), POLL)
      .toEqual([STAFF.asha.id, STAFF.ravi.id].sort());
  });

  test("a cancelled booking frees the chair again", async ({ page }) => {
    // The whole point of marking a booking cancelled rather than deleting it: the slot comes
    // back, but the record stays on the day's history.
    await openDiary(page);
    await bookAshaEleven(page);

    await blocks(page).first().click();
    await page.getByRole("button", { name: "Cancelled" }).click();
    await expect(page.getByText("Marked cancelled")).toBeVisible();

    await slot(page, STAFF.asha.name, FREE_SLOT).click();
    await pickService(page, SERVICES.threading.name);
    await setStartTime(page, "11:30");

    await expect(page.getByText(/is already busy/)).toHaveCount(0);
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(dialog(page, "New appointment")).toHaveCount(0);
    await expect.poll(savedAppointments, POLL).toHaveLength(2);
  });

  test("blocked-out time keeps the chair occupied", async ({ page }) => {
    // A cancelled slot frees up; blocked time is the opposite and must not. It is how a
    // stylist's lunch or leave is carved out of the day.
    await openDiary(page);

    await slot(page, STAFF.asha.name, "1:00 pm").click();
    await page.getByRole("button", { name: "Block out time" }).click();
    await page.getByLabel("Length (minutes)").fill("60");
    await page.getByLabel("Note").fill("lunch");
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByText("⛔ Blocked")).toBeVisible();

    await slot(page, STAFF.asha.name, FREE_SLOT).click();
    await pickService(page, SERVICES.threading.name);
    await setStartTime(page, "13:30");

    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByText("Clashes with blocked time at 1:00 pm–2:00 pm.")).toBeVisible();
    await expect.poll(savedAppointments, POLL).toHaveLength(1);
  });
});

// ---- editing -------------------------------------------------------------------------

test.describe("editing a booking", () => {
  async function bookAndReopen(page) {
    await slot(page, STAFF.asha.name, "11:00 am").click();
    await pickService(page, SERVICES.haircut.name);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(blocks(page)).toHaveCount(1);
    await blocks(page).first().click();
    await expect(dialog(page, "Appointment")).toBeVisible();
  }

  test("rescheduling moves it without clashing with its own old time", async ({ page }) => {
    // The overlap check has to skip the appointment being edited, or every reschedule that
    // overlaps its own previous slot would be refused as a clash with itself.
    await openDiary(page);
    await bookAndReopen(page);

    await setStartTime(page, "11:15");
    await expect(page.getByText(/is already busy/)).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("✓ Appointment updated")).toBeVisible();
    await expect(blocks(page).first()).toHaveAttribute("title", "11:15 am–12:00 pm · Booked");
    await expect.poll(async () => (await firstSaved())?.startMin, POLL).toBe(11 * 60 + 15);
  });

  test("reassigning it to another stylist moves the chair, not the time", async ({ page }) => {
    await openDiary(page);
    await bookAndReopen(page);

    await page.getByLabel("Staff").selectOption({ label: STAFF.ravi.name });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("✓ Appointment updated")).toBeVisible();

    await expect.poll(firstSaved, POLL).toMatchObject({ staffId: STAFF.ravi.id, startMin: 11 * 60 });

    // Reopen to prove the modal reflects the move rather than only the database.
    await blocks(page).first().click();
    await expect(page.getByLabel("Staff")).toHaveValue(STAFF.ravi.id);
  });

  test("marking it completed keeps it on the day", async ({ page }) => {
    await openDiary(page);
    await bookAndReopen(page);

    await page.getByRole("button", { name: "Completed" }).click();

    await expect(page.getByText("Marked completed")).toBeVisible();
    await expect(blocks(page).first()).toHaveAttribute("title", "11:00 am–11:45 am · Completed");
    await expect.poll(async () => (await firstSaved())?.status, POLL).toBe("completed");
  });

  test("deleting it removes it from the diary", async ({ page }) => {
    // remove() asks for confirmation with window.confirm; Playwright dismisses dialogs by
    // default, which would silently cancel the delete and leave this passing on the wrong
    // outcome — hence the explicit accept.
    page.on("dialog", (d) => d.accept());

    await openDiary(page);
    await bookAndReopen(page);

    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Deleted")).toBeVisible();
    await expect(blocks(page)).toHaveCount(0);
    await expect.poll(savedAppointments, POLL).toHaveLength(0);
  });
});

// ---- validation and roles ------------------------------------------------------------

test("a booking that runs past closing time is refused", async ({ page }) => {
  await openDiary(page);

  await slot(page, STAFF.asha.name, FREE_SLOT).click();
  await pickService(page, SERVICES.colour.name); // 60 min
  await setStartTime(page, "20:30"); // 8:30 pm + 60 = 9:30 pm, past the 9:00 pm close

  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect(page.getByText("That runs past closing time (9:00 pm).")).toBeVisible();
  await expect.poll(savedAppointments, POLL).toHaveLength(0);
});

test("a booking with no service picked is refused", async ({ page }) => {
  await openDiary(page);

  await slot(page, STAFF.asha.name, "11:00 am").click();
  await page.getByRole("button", { name: "Book", exact: true }).click();

  // Asserted as-is because it is what the front desk actually sees, not because it is the
  // clearest wording. validateAppointment checks duration BEFORE services, and a non-blocked
  // booking derives its duration from the services picked — so "no services" always arrives
  // at the check as "duration 0" and reports the duration message. The "Pick at least one
  // service." branch below it is unreachable from this modal. Worth tidying in the app one
  // day; changing the assertion to the nicer message would just make this spec lie.
  await expect(page.getByText("The appointment needs a duration.")).toBeVisible();
  await expect.poll(savedAppointments, POLL).toHaveLength(0);
});

test("a biller can work the diary", async ({ page }) => {
  // appointments.edit is a biller grant — the front desk books, not the owner.
  await openDiary(page, "biller");

  await slot(page, STAFF.asha.name, "11:00 am").click();
  await pickService(page, SERVICES.haircut.name);
  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect(blocks(page)).toHaveCount(1);
  await expect.poll(savedAppointments, POLL).toHaveLength(1);
});
