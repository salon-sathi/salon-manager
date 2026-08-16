// @vitest-environment jsdom
//
// Settings → Branding & receipt: the "Show the stylist's name on the customer's bill" switch,
// asserted against the REAL StoreConfig component.
//
// receipt.test.jsx proves what each value of config.showStaffOnReceipt prints. This file proves
// the WIRING, which is where a settings toggle actually breaks: the draft has to carry the key
// (or the box is permanently unchecked and Save always writes false), the checkbox has to be
// bound to it, and Save has to merge it into the shared shop/config singleton rather than
// rebuild that node from this one form.
//
// It mounts the one panel rather than the whole app — that mount is already covered by
// permissions.integration.test.jsx, and this is a single form's round-trip.
//
// ── Why this file is HERE and not next to the view it tests ──────────────────────────────
// `preloadViews()` in the full-app suites is an import.meta.glob over `src/views/*.jsx`, and a
// test file put in that directory matches the glob. Those suites would then load this file as
// if it were a screen — executing its vi.mock calls outside a test context and failing all four
// suites, with the stack pointing here rather than at them. Every jsdom suite in this repo lives
// at src/ root for that reason; keep it that way.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./lib/firebase.js", () => ({ app: {}, auth: {}, db: {}, storage: {}, isFirebaseConfigured: true, secondaryApp: () => ({}) }));
vi.mock("firebase/app", () => ({ initializeApp: vi.fn(() => ({})), deleteApp: vi.fn() }));
vi.mock("firebase/auth", () => ({ createUserWithEmailAndPassword: vi.fn(), getAuth: vi.fn(), signOut: vi.fn() }));
// The Users panel below this form opens a live roster subscription; this file is not about it.
vi.mock("./lib/sync.js", () => ({ subscribeUsers: () => () => {}, updateUser: vi.fn(), writeUser: vi.fn() }));
vi.mock("qrcode-generator", () => ({ default: () => ({ addData() {}, make() {}, createDataURL: () => "", getModuleCount: () => 0, isDark: () => false }) }));

const { default: StoreConfig } = await import("./views/Settings.jsx");

let mounted = null;

/** Mount the real settings form over `config`, and report what Save hands back. */
function mount(config = {}) {
  const setConfig = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <StoreConfig config={config} setConfig={setConfig} notify={vi.fn()} log={vi.fn()} user={{ uid: "u1" }} role="owner" perms={{}} />,
    );
  });
  mounted = { root, container };
  return { container, setConfig };
}

afterEach(() => {
  if (mounted) act(() => mounted.root.unmount());
  mounted?.container.remove();
  mounted = null;
});

/** The switch itself, found through its label — the accessible route, not a testid. */
const staffToggle = (container) => {
  const label = [...container.querySelectorAll("label")].find((l) => /stylist.s name on the customer/i.test(l.textContent));
  return label?.querySelector('input[type="checkbox"]') || null;
};

const saveButton = (container) => [...container.querySelectorAll("button")].find((b) => b.textContent === "Save settings");

describe("Settings → show the stylist on the customer's bill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the switch, off, for a shop that has never set it", () => {
    // The migration case. An unchecked box is the whole point of the default — a shop that
    // upgrades into this version must not start printing names it wasn't printing before.
    const { container } = mount({ name: "Test Salon" });
    const box = staffToggle(container);
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
  });

  it("renders it on for a shop that turned it on", () => {
    const { container } = mount({ name: "Test Salon", showStaffOnReceipt: true });
    expect(staffToggle(container).checked).toBe(true);
  });

  it("saves the switch without disturbing the rest of shop/config", () => {
    // shop/config is a shared singleton — loyaltyConfig and permissions live in it too. Save
    // spreads the existing config first for exactly this reason; a form that rebuilt the node
    // from its own draft would wipe the loyalty scheme customers hold points under.
    const { container, setConfig } = mount({ name: "Test Salon", loyaltyConfig: { enabled: true }, permissions: { biller: {} } });

    act(() => staffToggle(container).click());
    act(() => saveButton(container).click());

    expect(setConfig).toHaveBeenCalledTimes(1);
    const next = setConfig.mock.calls[0][0];
    expect(next.showStaffOnReceipt).toBe(true);
    expect(next.name).toBe("Test Salon");
    expect(next.loyaltyConfig).toEqual({ enabled: true });
    expect(next.permissions).toEqual({ biller: {} });
  });

  it("saves it back off again", () => {
    // The off direction is the one a truthy-vs-boolean bug hides in: `false` must be WRITTEN,
    // not omitted, or effectiveStore falls back to whatever was stored before.
    const { container, setConfig } = mount({ name: "Test Salon", showStaffOnReceipt: true });

    act(() => staffToggle(container).click());
    act(() => saveButton(container).click());

    expect(setConfig.mock.calls[0][0].showStaffOnReceipt).toBe(false);
  });

  it("counts the switch as an unsaved change", () => {
    // Save is disabled until the draft differs from the last snapshot. If the key were missing
    // from toDraft(), flipping the box would leave the button disabled and the setting
    // unsaveable — with no error to explain it.
    const { container } = mount({ name: "Test Salon" });
    expect(saveButton(container).disabled).toBe(true);

    act(() => staffToggle(container).click());
    expect(saveButton(container).disabled).toBe(false);
  });
});
