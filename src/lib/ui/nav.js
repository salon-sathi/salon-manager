// The navigation map: which tabs exist, where they sit, and who may see them.

import { FEATURES, featureOn } from "../features.js";
import { can } from "../roles.js";

// ---------- main app ----------
// The feature flags themselves live in lib/features.js: a tab is only ONE of a parked
// feature's entry points (Udhari is also a payment mode at the till), and every entry
// point has to answer the same question. Re-exported here so the nav's own callers —
// and the tests that pin the rail — keep their single import.
//
// A tab whose flag is `false` is dropped from the sidebar and its render branch falls
// back to the dashboard; the component and all its logic stay intact.
const tabEnabled = featureOn;

// Top-level sidebar destinations, plus the secondary group tucked under "Other".
// Both feed the same `tab` switch below — grouping is purely a nav-rendering concern.
//
// The 4th element is the permission required to reach the tab (null = everyone). It is the
// SAME action the view's own guard checks, so hiding a tab and blocking the view can't drift
// apart. Hiding alone is not enough: `tab` is state, so every gated branch in the render
// switch re-checks with can() — see viewFor() below.
const TOP_TABS = [
  // Order is the salon owner's front-of-house flow: overview → take money → what's sold →
  // history → analytics, then the day-to-day rails, then the money tools.
  ["dashboard", "⌂", "Dashboard", null],
  ["billing", "₹", "Billing (POS)", "billing.use"],
  ["services", "✂", "Services", "services.manage"],
  ["sales", "⊟", "Sales History", "sales.view"],
  ["stats", "📊", "Stats", "stats.view"],
  ["appointments", "📅", "Appointments", "appointments.view"],
  ["customers", "👤", "Customers", "customers.browse"],
  ["reminders", "🔔", "Reminders", "reminders.use"],
  ["inventory", "▦", "Inventory", "inventory.view"],
  ["udhari", "💳", "Udhari (Credit)", "udhari.manage"], // hidden via FEATURES.udhari; kept for a future revival
  ["expense", "⊝", "Add Expense", "expenses.manage"],
  ["finance", "∑", "Finance", "finance.view"], // hidden via FEATURES.finance; kept for a future revival
];
const OTHER_TABS = [
  ["packages", "🎁", "Packages", "packages.manage"],
  ["staff", "👥", "Staff", "staff.manage"],
  ["alerts", "⚠", "Alerts", "alerts.view"],
  ["vendorbills", "🧾", "Vendor Bills", "vendorBills.manage"],
  ["raw", "⇪", "Data Import", "import.use"],
  ["barcode", "▥", "Barcode Creator", "barcode.use"],
  ["logs", "❑", "Activity Log", "logs.view"],
  ["changelog", "🗒", "App Change Log", null],
  ["settings", "🏪", "Salon Settings", "settings.manage"],
  ["admin", "⚙", "Admin", "settings.manage"],
];

// The four tabs a phone gets on its bottom bar, in the order they appear there. This is the
// PREFERENCE list, not the guarantee: the bar is filled from whatever the signed-in role can
// actually reach (see phoneTabs), so a role without one of these never gets a dead slot.
// Everything else lives one tap away behind "More". Deliberately short — five targets across a
// 360px screen is 72px each, and a sixth would put them below a thumb's accuracy.
const PHONE_BAR_TABS = ["dashboard", "billing", "appointments", "customers"];

// A tab is reachable when its feature flag is on AND the signed-in role holds its permission.
// `perms` is config.permissions — the owner's per-role feature switches (see roles.js).
const tabAllowed = (role, perms, [k, , , action]) => tabEnabled(k) && (!action || can(role, action, perms));

// Bottom-bar labels have roughly 68px on a 360px phone, so the rail's full names ("Billing
// (POS)", "Sales History") would ellipsis into nonsense. These are the short forms; anything
// not listed keeps its rail label, which is what the aria-label uses either way.
const PHONE_TAB_LABELS = {
  dashboard: "Home",
  billing: "Bill",
  appointments: "Diary",
  customers: "Clients",
  sales: "Sales",
  services: "Menu",
  inventory: "Stock",
  reminders: "Remind",
  udhari: "Credit", // parked with FEATURES.udhari — the label waits here for the revival
  expense: "Expense",
  stats: "Stats",
};


export { FEATURES, tabEnabled, TOP_TABS, OTHER_TABS, PHONE_BAR_TABS, tabAllowed, PHONE_TAB_LABELS };
