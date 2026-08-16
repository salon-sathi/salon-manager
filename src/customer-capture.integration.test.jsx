// @vitest-environment jsdom
//
// "A name on a bill becomes a customer" — asserted against the REAL app module.
//
// customers.test.js proves captureCustomer's rules in isolation. This file proves the WIRING:
// that typing a name and a number at the till actually reaches shop/customers, that the bill is
// linked to the record by customerPhone, and that the customer then shows up on the Customers
// screen. Those are four different modules (Billing, the shell's debounced pusher, sync's
// buildSliceUpdate, the Customers view) and a unit test cannot tell you they agree.
//
// It reads the writes off the mocked `update()`, which is the same call the real sync layer
// makes — so what is asserted here is what would land in RTDB, keyed the way the rules require.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SERVICE = { id: "svc-cut", name: "Haircut Women — Trim", category: "Hair", durationMin: 30, price: 400, commissionPct: 10, rebookCycleDays: 45, active: true, icon: "💇", createdAt: "2026-01-01" };
const STAFF = { id: "stf-priya", name: "Priya Sharma", role: "Hair Stylist", color: "#7C3AED", phone: "", commissionPctDefault: 10, active: true, createdAt: "2026-01-01" };

// Mutable fixture the mocked database reads from. `vi.hoisted` because vi.mock factories are
// lifted above every other statement in the file and cannot see ordinary module scope.
const fx = vi.hoisted(() => ({ customers: null, sales: null }));

vi.mock("./lib/firebase.js", () => ({ app: {}, auth: {}, db: {}, storage: {}, isFirebaseConfigured: true, secondaryApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth, cb) => { cb({ uid: "u1", email: "owner@test" }); return () => {}; },
  signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(), sendPasswordResetEmail: vi.fn(), getAuth: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() }, reauthenticateWithCredential: vi.fn(),
}));
vi.mock("firebase/database", () => {
  const me = () => ({ email: "owner@test", name: "Owner", role: "owner", active: true, createdAt: "2026-01-01" });
  const dataFor = (path) => {
    if (path.includes(".info/connected")) return true;
    if (path.endsWith("shop/config")) return {};
    if (path.includes("shop/users/")) return me();
    if (path.endsWith("shop/users")) return { u1: me() };
    // Seeded, so the seeders don't fire and the till has exactly one thing to sell.
    if (path.endsWith("shop/services")) return { [SERVICE.id]: SERVICE };
    if (path.endsWith("shop/staff")) return { [STAFF.id]: STAFF };
    if (path.endsWith("shop/customers")) return fx.customers;
    if (path.endsWith("shop/sales")) return fx.sales;
    // Every other slice reads as already-empty rather than null: a null slice makes the shell
    // run its seeder and write a default catalogue, which is noise this file doesn't want.
    if (path.startsWith("shop/")) return {};
    return null;
  };
  return {
    ref: (_db, path) => ({ path: String(path ?? "") }),
    onValue: (refObj, cb) => { cb({ val: () => dataFor(refObj.path) }); return () => {}; },
    set: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
    get: (refObj) => Promise.resolve({ val: () => dataFor(refObj.path) }),
  };
});
vi.mock("firebase/storage", () => ({ ref: vi.fn(), uploadBytes: vi.fn(), uploadBytesResumable: vi.fn(), getDownloadURL: vi.fn(), deleteObject: vi.fn() }));
vi.mock("firebase/app", () => ({ initializeApp: vi.fn(() => ({})), deleteApp: vi.fn() }));
vi.mock("recharts", () => {
  const S = () => null;
  return { ResponsiveContainer: S, AreaChart: S, Area: S, BarChart: S, Bar: S, LineChart: S, Line: S, ComposedChart: S, Treemap: S, ReferenceLine: S, XAxis: S, YAxis: S, Tooltip: S, CartesianGrid: S, PieChart: S, Pie: S, Cell: S, Legend: S };
});
vi.mock("jsbarcode", () => ({ default: vi.fn() }));
vi.mock("qrcode-generator", () => ({ default: () => ({ addData() {}, make() {}, createDataURL: () => "", getModuleCount: () => 0, isDark: () => false }) }));

beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });

// Every screen is a React.lazy chunk — warm them so lazy resolves from the module cache instead
// of racing a real dynamic import inside act(). See CLAUDE.md.
const preloadViews = () => Promise.all(Object.values(import.meta.glob("./views/*.jsx")).map((load) => load()));

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

// Slice writes are debounced by 300ms in the shell, so nothing reaches `update` until that
// timer fires. Real time, not fake: the debounce is chased through React effects and lazy
// imports, and swapping the clock out from under those is how this suite would go flaky.
const settle = async () => {
  await flush();
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  await flush();
};

async function mountApp() {
  await preloadViews();
  const App = (await import("./salon-manager.jsx")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await settle();
  return { container, cleanup: () => { root.unmount(); container.remove(); } };
}

const { update } = await import("firebase/database");

/** Everything written to one slice, newest call last. */
const writesTo = (slice) =>
  update.mock.calls.filter(([refObj]) => refObj?.path === `shop/${slice}`).map(([, updates]) => updates);

/** The merged view of a slice as RTDB would hold it after every write this test produced. */
const slice = (name) => Object.assign({}, ...writesTo(name));

async function clickRail(container, label) {
  const btn = [...container.querySelectorAll(".nav .navbtn[aria-label]")].find((b) => b.getAttribute("aria-label") === label);
  expect(btn, `no rail entry called "${label}"`).toBeTruthy();
  await act(async () => { btn.click(); });
  await flush();
}

const byLabel = (container, label) => container.querySelector(`[aria-label="${label}"]`);

/** Type into a controlled React input the way a user would. */
async function type(el, value) {
  expect(el, "field not found").toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

/** Put one ₹400 haircut in the cart, performed by Priya. */
async function addService(container) {
  const tile = [...container.querySelectorAll(".pick")].find((n) => n.textContent.includes(SERVICE.name));
  expect(tile, "no service tile on the till").toBeTruthy();
  await act(async () => { tile.click(); });
  await flush();
  const who = byLabel(container, `Who performed ${SERVICE.name}`);
  expect(who, "no staff selector on the cart line").toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(who, STAFF.id);
    who.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

async function completeSale(container) {
  const btn = [...container.querySelectorAll("button")].find((b) => /Complete sale/.test(b.textContent));
  expect(btn, "no Complete sale button").toBeTruthy();
  await act(async () => { btn.click(); });
  await settle();
}

let live = null;
beforeEach(() => { fx.customers = null; fx.sales = null; update.mockClear(); });
afterEach(() => { live?.cleanup(); live = null; });

describe("a name and a number typed at the till", () => {
  it("files the customer, keyed by phone, the moment the bill is saved", async () => {
    live = await mountApp();
    await clickRail(live.container, "Billing (POS)");
    await addService(live.container);
    await type(byLabel(live.container, "Customer name"), "Riya");
    await type(byLabel(live.container, "Customer mobile"), "98765 43210");

    await completeSale(live.container);

    // Keyed on the NORMALISED number: that is the RTDB key, and "98765 43210" would not match
    // the record it names. id must equal it too, or sync loses the record on the next push.
    const customers = slice("customers");
    expect(Object.keys(customers)).toEqual(["9876543210"]);
    expect(customers["9876543210"]).toMatchObject({ id: "9876543210", phone: "9876543210", name: "Riya" });
  });

  it("links the bill to the record it just created", async () => {
    // Without this the customer lands on the list showing 0 visits and ₹0 spend — both are
    // derived from the bill's customerPhone, so an unlinked bill is an invisible one.
    live = await mountApp();
    await clickRail(live.container, "Billing (POS)");
    await addService(live.container);
    await type(byLabel(live.container, "Customer name"), "Riya");
    await type(byLabel(live.container, "Customer mobile"), "9876543210");

    await completeSale(live.container);

    const sale = Object.values(slice("sales"))[0];
    expect(sale).toMatchObject({ total: 400, customer: "Riya", customerPhone: "9876543210", mobile: "9876543210" });
  });

  it("shows them on the Customers screen, with the visit already counted", async () => {
    // The end the salon actually sees. totalVisits/totalSpend are never written by the till —
    // the shell's reconcilers derive them from the bill and push them back.
    live = await mountApp();
    await clickRail(live.container, "Billing (POS)");
    await addService(live.container);
    await type(byLabel(live.container, "Customer name"), "Riya");
    await type(byLabel(live.container, "Customer mobile"), "9876543210");
    await completeSale(live.container);

    await clickRail(live.container, "Customers");

    expect(live.container.textContent).toContain("Riya");
    expect(live.container.textContent).toContain("98765 43210");
    expect(slice("customers")["9876543210"]).toMatchObject({ totalVisits: 1, totalSpend: 400 });
  });

  it("warns the desk before the sale that the customer is about to be filed", async () => {
    live = await mountApp();
    await clickRail(live.container, "Billing (POS)");
    await addService(live.container);
    await type(byLabel(live.container, "Customer name"), "Riya");
    await type(byLabel(live.container, "Customer mobile"), "9876543210");

    expect(live.container.textContent).toContain("Riya will be added to your customer list");
  });
});

describe("what must NOT become a customer", () => {
  it("leaves a true walk-in alone, and keeps the bill's old shape", async () => {
    live = await mountApp();
    await clickRail(live.container, "Billing (POS)");
    await addService(live.container);

    await completeSale(live.container);

    expect(writesTo("customers")).toEqual([]);
    const sale = Object.values(slice("sales"))[0];
    expect(sale.customerPhone).toBeUndefined();
    expect(sale.customer).toBeUndefined();
  });

  it("does not file a name with no number — there would be no key to file it under", async () => {
    // The bill still records the name as free text, exactly as it always did. Udhari groups
    // debts by that name and must keep working for someone who won't leave a number.
    live = await mountApp();
    await clickRail(live.container, "Billing (POS)");
    await addService(live.container);
    await type(byLabel(live.container, "Customer name"), "Riya");

    await completeSale(live.container);

    expect(writesTo("customers")).toEqual([]);
    expect(Object.values(slice("sales"))[0]).toMatchObject({ customer: "Riya" });
    expect(Object.values(slice("sales"))[0].customerPhone).toBeUndefined();
  });

  it("does not file a half-typed number", async () => {
    // A record whose name or key is wrong is worse than no record: phone is the key, so a
    // half-typed one is a customer nobody can ever find again.
    live = await mountApp();
    await clickRail(live.container, "Billing (POS)");
    await addService(live.container);
    await type(byLabel(live.container, "Customer name"), "Riya");
    await type(byLabel(live.container, "Customer mobile"), "98765");

    await completeSale(live.container);

    expect(writesTo("customers")).toEqual([]);
    expect(Object.values(slice("sales"))[0]).toMatchObject({ customer: "Riya", mobile: "98765" });
  });

  it("never renames a customer the salon already has", async () => {
    // The profile is the curated copy. A name typed in a hurry must not clobber it.
    fx.customers = { 9876543210: { id: "9876543210", phone: "9876543210", name: "Riya Sharma", createdAt: "2020-01-01", totalVisits: 0, totalSpend: 0, lastVisitAt: "", loyaltyPoints: 0, tier: "" } };
    live = await mountApp();
    await clickRail(live.container, "Billing (POS)");
    await addService(live.container);
    await type(byLabel(live.container, "Customer name"), "riya");
    await type(byLabel(live.container, "Customer mobile"), "9876543210");

    await completeSale(live.container);

    // Their stats still get reconciled from the new bill — but the name is untouched.
    const written = slice("customers");
    expect(written["9876543210/name"]).toBeUndefined();
    expect(written["9876543210"]).toBeUndefined();
  });
});
