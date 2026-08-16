// Feature flags — parking a section of the app WITHOUT deleting its code.
//
// A feature listed here as `false` disappears from the live UI: its nav tab is dropped,
// its render branch falls back to the dashboard, and every entry point that would create
// NEW data for it is withdrawn. The view, its logic, its tests and its stored data all
// stay intact. Reviving a feature is flipping its flag to `true` (or deleting the line) —
// that is the whole revival, and it is the reason a flag exists rather than a `git revert`.
//
// ── What a flag deliberately does NOT hide ───────────────────────────────────────────
// The rendering of data the feature already produced. An old udhari bill still shows its
// outstanding balance in Sales History, on its receipt and in the Dashboard sub-note,
// because those branches are conditional on the bill's own `payment` field: on a shop
// that never sold on credit they never render at all, and on one that did, the money
// stays visible instead of quietly vanishing from the books. Gating them too would make
// a real unsettled debt invisible rather than merely unsettleable.
//
// ── Where a flag is read ─────────────────────────────────────────────────────────────
// `lib/ui/nav.js` (which tabs exist) and the view that owns each feature's entry point.
// Both halves must answer the SAME question, which is why the map lives here — in pure
// lib, importable from a view — rather than inside the nav map it started in.
//
// Pure: no React, no Firebase, no imports.
const FEATURES = {
  finance: false, // deprecated 2026 — kept for a possible future revival
  // Disabled by default — the code behind each of these stays intact so any can be
  // revived instantly by flipping its flag to `true` (or deleting the line).
  raw: false, // "Data Import"
  barcode: false, // "Barcode Creator"
  alerts: false, // "Alerts"
  // "Udhari (Credit)". Reaches further than the others: it is a tab AND a payment mode on
  // a bill, so the flag is also read by Billing (the third payment button), Sales History
  // (the edit modal's payment select), Stats (the outstanding card and chart) and the
  // Feature access panel. See "Reviving a parked feature" in CLAUDE.md.
  udhari: false,
};

/** True unless a flag explicitly turns the feature off. An unknown key is ON — a feature
 *  has to be named here to be parked, so a typo can never silently hide a live screen. */
const featureOn = (k) => FEATURES[k] !== false;

export { FEATURES, featureOn };
