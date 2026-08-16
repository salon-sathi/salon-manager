// @vitest-environment jsdom
//
// The responsive contract, asserted against the REAL app module.
//
// Why a CSS-contract test rather than a screenshot test: jsdom does not lay anything out — it
// has no viewport, no cascade and no media-query evaluation — so nothing here can prove a
// layout LOOKS right. What it CAN prove is that the rules which produce that layout are still
// present and still say what they were written to say. Every assertion below corresponds to a
// specific way the app was broken on a real device before this suite existed, so a regression
// names the device it breaks rather than showing a diff of pixels.
//
// The one thing this file cannot cover is whether 44px is comfortable or whether the bottom bar
// looks right on an iPhone — that is the manual device matrix, not this.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MAX, BREAKPOINTS, TOUCH_TARGET, CONTENT_MAX } from "./lib/breakpoints.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OWNER = { email: "owner@test", name: "Owner", role: "owner", active: true, createdAt: "2026-08-02" };

const dataFor = (path) => {
  if (path.includes(".info/connected")) return true;
  if (path.includes("shop/users/")) return OWNER;
  if (path.endsWith("shop/users")) return { u1: OWNER };
  return null;
};
const snap = (v) => ({ val: () => v });

vi.mock("./lib/firebase.js", () => ({ app: {}, auth: {}, db: {}, storage: {}, isFirebaseConfigured: true, secondaryApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth, cb) => { cb({ uid: "u1", email: "owner@test" }); return () => {}; },
  signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(), sendPasswordResetEmail: vi.fn(), getAuth: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() }, reauthenticateWithCredential: vi.fn(),
}));
vi.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: String(path) }),
  onValue: (refObj, cb) => { cb(snap(dataFor(refObj.path))); return () => {}; },
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  get: (refObj) => Promise.resolve(snap(dataFor(refObj.path))),
}));
vi.mock("firebase/storage", () => ({ ref: vi.fn(), uploadBytes: vi.fn(), uploadBytesResumable: vi.fn(), getDownloadURL: vi.fn(), deleteObject: vi.fn() }));
vi.mock("firebase/app", () => ({ initializeApp: vi.fn(() => ({})), deleteApp: vi.fn() }));
vi.mock("recharts", () => {
  const S = () => null;
  return { ResponsiveContainer: S, AreaChart: S, Area: S, BarChart: S, Bar: S, LineChart: S, Line: S, ComposedChart: S, Treemap: S, ReferenceLine: S, XAxis: S, YAxis: S, Tooltip: S, CartesianGrid: S, PieChart: S, Pie: S, Cell: S, Legend: S };
});
vi.mock("jsbarcode", () => ({ default: vi.fn() }));
vi.mock("qrcode-generator", () => ({ default: () => ({ addData() {}, make() {}, createDataURL: () => "", getModuleCount: () => 0, isDark: () => false }) }));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

// Every screen is a React.lazy chunk. Warm them all first: React.lazy then resolves from the
// module cache in a microtask, instead of racing a real dynamic import inside act() — which no
// number of ticks reliably covers, because loading a module is file I/O, not a queued task.
const preloadViews = () => Promise.all(Object.values(import.meta.glob("./views/*.jsx")).map((load) => load()));
// Views are React.lazy chunks now, so a render can be waiting on a dynamic import — which
// settles on the MACROTASK queue, not the microtask queue a bare `await` drains. The
// setTimeout is what lets the imported view mount before the assertions read the DOM.
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

/**
 * Point window.matchMedia at a fixed viewport width so the app renders the shell that width
 * would get. jsdom's own matchMedia always answers false, which is what makes the OTHER suites
 * render the desktop shell; here we answer honestly for the width queries this app asks.
 */
function stubViewport(width) {
  window.matchMedia = (query) => {
    const max = /\(max-width:\s*(\d+)px\)/.exec(query);
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
    return {
      matches, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  };
}

/**
 * The body of one `@media` block, by its condition.
 *
 * Asserting against the whole stylesheet cannot tell "the tablet band does not shrink the
 * rail" from "no band anywhere shrinks the rail" — the phone band legitimately hides labels,
 * so a document-wide `not.toContain(".navlabel")` would be answering a different question.
 * Brace-matched rather than regexed to the next `}`, since these blocks contain nested rules.
 */
function bandBlock(css, condition) {
  const at = css.indexOf(`@media ${condition}`);
  if (at === -1) return "";
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return "";
}

/** Mount the real app and hand back the container plus its shipped stylesheet. */
async function mountApp() {
  await preloadViews();
  const App = (await import("./salon-manager.jsx")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await flush();
  const css = [...container.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  return { container, root, css, cleanup: () => { root.unmount(); container.remove(); } };
}

let live = null;
afterEach(() => { live?.cleanup(); live = null; delete window.matchMedia; });

describe("responsive — the shell each device gets", () => {
  const drawer = (container) => container.querySelector('.nav[data-open="1"]');
  const openers = (container) =>
    [...container.querySelectorAll("button")].filter((b) => /^(Open|Close) menu$/.test(b.getAttribute("aria-label") || ""));

  it("gives a phone BOTH the sidebar and a bottom tab bar", async () => {
    // Two regressions in one. The sidebar used to become a wrapped row of all 22 tabs, costing
    // ~300px above every screen (40% of an iPhone SE); the fix for that then removed it from
    // phones entirely, which left the salon with no sidebar at all. It is present now — as a
    // drawer, so it costs no width until it is asked for.
    stubViewport(390); // iPhone 14/15/16
    live = await mountApp();
    const { container } = live;

    expect(container.querySelector(".nav"), "the sidebar must exist on a phone").toBeTruthy();
    const bar = container.querySelector(".tabbar");
    expect(bar, "and the bottom tab bar rides alongside it").toBeTruthy();
    // Four tabs + More. More than five targets across 360px is below thumb accuracy.
    expect(bar.querySelectorAll(".tabbtn").length).toBe(5);
    expect(container.querySelector(".topbar"), "a phone gets the shop-name top bar").toBeTruthy();
    // Closed by default, and closed means data-open="0" — which the CSS turns into display:none,
    // so the 22 links are out of the tab order rather than merely pushed off-screen.
    expect(drawer(container), "the drawer starts closed").toBeFalsy();
  });

  it("opens the full labelled sidebar from the ☰ and from More, and closes it again", async () => {
    stubViewport(390);
    live = await mountApp();
    const { container } = live;

    // Both controls exist: the ☰ in the top bar and "More" in the bottom bar.
    expect(openers(container).length, "☰ in the top bar and More in the bottom bar").toBe(2);

    for (const opener of openers(container)) {
      await act(async () => { opener.click(); });
      await flush();
      const open = drawer(container);
      expect(open, "each control opens the drawer").toBeTruthy();

      const labels = [...open.querySelectorAll("button, label")].map((b) => (b.textContent || "").trim());
      // The whole sidebar, spelled out — not a subset. A tab on the bottom bar appears here too,
      // because this IS the sidebar; a drawer showing a subset would be a rival navigation.
      expect(labels.some((t) => /Billing \(POS\)/.test(t)), "the bar's own tabs are in the sidebar too").toBe(true);
      expect(labels.some((t) => /Salon Settings/.test(t)), "and the Other-group tabs").toBe(true);
      // Nothing may be stranded: these live at the foot of the sidebar on a desktop and would
      // otherwise be unreachable on a phone entirely.
      expect(labels.some((t) => /Logout/.test(t)), "Logout must be reachable on a phone").toBe(true);
      expect(labels.some((t) => /Restore/.test(t)), "so must Restore").toBe(true);

      // Same control closes it (it is a toggle, and its label flips to say so).
      const closer = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Close menu");
      await act(async () => { closer.click(); });
      await flush();
      expect(drawer(container), "and closes it again").toBeFalsy();
    }
  });

  it("closes the drawer when a destination is picked", async () => {
    // A nav left open over the page it just navigated to reads as a stuck menu.
    stubViewport(390);
    live = await mountApp();
    const { container } = live;

    await act(async () => { openers(container)[0].click(); });
    await flush();
    const settings = [...drawer(container).querySelectorAll("button")]
      .find((b) => /Salon Settings/.test(b.textContent || ""));
    await act(async () => { settings.click(); });
    await flush();
    expect(drawer(container), "picking a tab puts the drawer away").toBeFalsy();
  });

  it("keeps the desktop shell exactly as it was on a laptop", async () => {
    // The whole point of the band system: laptops and desktops must render what they always did.
    stubViewport(1366);
    live = await mountApp();
    const { container } = live;

    expect(container.querySelector(".nav"), "the sidebar is still the laptop navigation").toBeTruthy();
    expect(container.querySelector(".tabbar"), "no bottom bar on a laptop").toBeFalsy();
    expect(container.querySelector(".topbar"), "no phone top bar on a laptop").toBeFalsy();
  });

  it("gives a tablet the same full, labelled rail as a laptop", async () => {
    stubViewport(768); // iPad portrait
    live = await mountApp();
    const { container } = live;

    expect(container.querySelector(".nav"), "a tablet keeps the rail").toBeTruthy();
    expect(container.querySelector(".tabbar"), "a tablet is not a phone").toBeFalsy();

    // The rail used to collapse to a 64px icon strip across this band, with a ☰ to get the
    // labels back. jsdom lays nothing out, so the assertion has to be on the rules: nothing
    // in the tablet band may shrink the rail or hide a label.
    const tabletBand = bandBlock(live.css, `(min-width: ${BREAKPOINTS.tablet}px) and (max-width: ${MAX.tablet}px)`);
    expect(tabletBand, "the tablet band still exists — it tightens the content gutters").toBeTruthy();
    expect(tabletBand).not.toContain("width:64px");
    expect(tabletBand, "a hidden .navlabel is the icon rail coming back").not.toContain(".navlabel");
  });
});

describe("responsive — the CSS contract", () => {
  it("no longer collapses every inline grid, which is what broke the calendar", async () => {
    stubViewport(1366);
    live = await mountApp();
    // THE regression. `[style*="grid-template-columns"] { …:1fr !important }` matched the
    // appointments calendar too, stacking its time gutter on top of its stylist columns on
    // every phone. Responsive grids are opt-in by class now.
    // Matched as a SELECTOR (followed by its block), not as a mention — the replacement rules
    // name the old one in a comment so the reason it went away travels with the code.
    expect(live.css).not.toMatch(/\[style\*="grid-template-columns"\]\s*\{/);
    for (const cls of [".g2", ".g3", ".g-split", ".cards"]) {
      expect(live.css, `${cls} is how a layout opts in to collapsing`).toContain(cls);
    }
  });

  it("declares all five bands off the shared breakpoint table", async () => {
    stubViewport(1366);
    live = await mountApp();
    expect(live.css).toContain(`(max-width: ${MAX.phone}px)`);
    expect(live.css).toContain(`(max-width: ${MAX.tablet}px)`);
    expect(live.css).toContain(`(min-width: ${BREAKPOINTS.tablet}px)`);
    // The old single breakpoint. If this comes back, the bands have been flattened again.
    expect(live.css).not.toContain("max-width: 820px");
  });

  it("sizes touch targets by pointer type, not by screen width", async () => {
    stubViewport(1366);
    live = await mountApp();
    // A 1024px tablet is a wide screen driven by a fingertip; a narrow laptop window is not.
    // Keying this on width is how the old build let an iPad zoom on every input.
    expect(live.css).toContain("(pointer: coarse)");
    expect(live.css).toContain(`${TOUCH_TARGET}px`);
    expect(live.css).toContain("touch-action:manipulation");
    // Below 16px, iOS Safari zooms the page whenever a field takes focus.
    expect(live.css).toMatch(/\(pointer: coarse\)[\s\S]*font-size:16px/);
    // Hover styling must be fenced off, or it latches on after a tap on a touchscreen.
    expect(live.css).toContain("(hover: none)");
  });

  it("pays back viewport-fit=cover with safe-area padding on everything pinned to an edge", async () => {
    stubViewport(1366);
    live = await mountApp();
    // index.html opts into drawing under the notch and the home indicator; without these the
    // bottom bar and the connection pill sit underneath the home bar on an iPhone.
    for (const rule of [".tabbar", ".cartbar"]) {
      const block = new RegExp(`\\${rule}\\s*\\{[^}]*safe-area-inset-bottom`);
      expect(live.css, `${rule} must clear the home indicator`).toMatch(block);
    }
    // The drawer runs the full height of the screen, so it pays BOTH insets — its first nav item
    // would otherwise sit under the notch and its Logout button under the home bar.
    expect(live.css).toMatch(/\.nav\[data-open="1"\][\s\S]{0,400}safe-area-inset-bottom/);
    expect(live.css).toContain("env(safe-area-inset-top)");
  });

  it("uses dvh wherever a full-height surface would otherwise be clipped by mobile chrome", async () => {
    stubViewport(1366);
    live = await mountApp();
    // vh on iOS is the viewport at its TALLEST, so a 100vh rail is taller than the screen while
    // Safari's toolbar is expanded. Each of these keeps a plain-vh line first as the fallback.
    expect(live.css).toMatch(/\.app\s*\{[^}]*min-height:100vh;\s*min-height:100dvh/);
    expect(live.css).toMatch(/\.nav\s*\{[^}]*height:100vh;\s*height:100dvh/);
    expect(live.css).toMatch(/\.modal\s*\{[^}]*max-height:86vh;\s*max-height:86dvh/);
  });

  it("lets a wide table scroll inside itself with its first column pinned", async () => {
    stubViewport(1366);
    live = await mountApp();
    expect(live.css).toMatch(/\.tbl\s*\{[^}]*overflow-x:auto/);
    expect(live.css).toMatch(/\.tbl th:first-child[^}]*position:sticky/);
    // The pin needs an OPAQUE backdrop: --surface is a translucent glass fill under the Advanced
    // theme, and a translucent pin lets the rest of the row scroll visibly through it.
    expect(live.css).toContain("--tbl-sticky-bg");
    expect(live.css).toMatch(/\[data-theme="advanced"\][\s\S]*--tbl-sticky-bg:#[0-9A-Fa-f]{6}/);
  });

  it("gives the app root a real background-color, not a var() inside the shorthand", async () => {
    // Found during the device pass, and it predated this work: S.app set the `background`
    // SHORTHAND to a var(), then set `backgroundImage` right after. A shorthand carrying a var()
    // is stored as one pending-substitution value spanning every longhand it owns, so setting
    // any one of those longhands afterwards discards the rest — background-color came out EMPTY
    // in Chrome's own CSSOM. The Advanced theme's dark ground never painted: the white page
    // showed through and Advanced's light text sat on white, on every device.
    stubViewport(1366);
    live = await mountApp();
    const app = live.container.querySelector(".app");
    expect(app.style.backgroundColor, "the app root must carry a background-color").toBeTruthy();
    expect(app.style.backgroundColor).toContain("--bg-base");
    expect(app.style.backgroundImage, "and still keep its gradient").toContain("--bg-gradient");
    // Nothing may reintroduce the shorthand+longhand pairing anywhere.
    expect(app.getAttribute("style")).not.toMatch(/(^|;)\s*background\s*:/);
  });

  it("gives the phone bars an opaque ground, since they may not blur", async () => {
    // Also found during the device pass. --nav-bg is 72% opaque under Advanced, which only works
    // for the sidebar because the sidebar is allowed a backdrop-filter to frost what is behind
    // it — and it keeps that as a drawer, because a drawer sits still. The two BARS lie over
    // scrolling content and are barred from blurring, so at 72% the page read through them.
    stubViewport(1366);
    live = await mountApp();
    expect(live.css).toMatch(/\.topbar\s*\{[^}]*background:var\(--bar-bg/);
    expect(live.css).toMatch(/\.tabbar\s*\{[^}]*background:var\(--bar-bg/);
    // Fully opaque hex under Advanced — an rgba() here is the bug coming back.
    expect(live.css).toMatch(/--bar-bg:#[0-9A-Fa-f]{6};/);
  });

  it("keeps the blur budget: no backdrop-filter added to anything that scrolls", async () => {
    stubViewport(1366);
    live = await mountApp();
    // The budget predates this work (sidebar + modal scrim only). The mobile furniture — tab bar,
    // cart bar, top bar — all appear over scrolling content, so none of them may blur.
    for (const rule of [".tabbar", ".cartbar", ".topbar", ".tabbtn"]) {
      const block = new RegExp(`\\${rule}\\s*\\{[^}]*backdrop-filter`);
      expect(live.css, `${rule} must not blur`).not.toMatch(block);
    }
  });

  it("still flattens the whole shell for print, including the new mobile furniture", async () => {
    stubViewport(1366);
    live = await mountApp();
    const print = live.css.slice(live.css.indexOf("@media print"));
    for (const rule of [".topbar", ".tabbar", ".rail-scrim"]) {
      expect(print.slice(0, 600), `${rule} must not print`).toContain(rule);
    }
  });
});

describe("responsive — the content column", () => {
  it("caps wider than the old 1280 so a large monitor is not a strip", async () => {
    stubViewport(1920);
    live = await mountApp();
    const main = live.container.querySelector("main.main");
    expect(main, "the content column should render").toBeTruthy();
    expect(main.style.maxWidth).toBe(`${CONTENT_MAX}px`);
    expect(CONTENT_MAX).toBeGreaterThan(1280);
    // A canvas screen opts out of the cap entirely rather than every screen going full width.
    expect(live.css).toContain(".main.wide");
  });
});
