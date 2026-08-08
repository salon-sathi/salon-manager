// Shop identity, themes and the cached config — everything `store` is made of.


// Categories of activity recorded in the global Activity Log.
const LOG_TYPES = ["sale", "inventory", "expense", "import", "backup", "bill", "settings"];

// Salon identity — DEFAULTS only, and deliberately generic: this app is meant to be reusable by
// any salon, so nothing here names a particular business. Every field is overridden by the owner
// from Settings; the saved config lives at shop/config (see effectiveStore()) and syncs across
// devices. `logo`/`paymentQr` blank => the bundled /public asset is used; a custom upload is
// stored inline as a data URL. `pcIp` is the counter PC's LAN address (e.g. for a local print
// server). Fill these in from Settings before the first receipt is printed.
const STORE = {
  name: "Salon Manager",
  tagline: "Hair · Skin · Nails · Spa",
  address: "",
  phone: "",
  pcIp: "",
  logo: "",       // "" => default logo.svg asset; otherwise a data URL
  paymentQr: "",  // "" => default payment-qr.jpg asset; otherwise a data URL
  upiId: "",      // UPI VPA (e.g. salon@okhdfcbank). Set => bills show an amount-encoded QR; "" => static image
  upiName: "",    // payee name shown in the customer's UPI app; "" => fall back to the salon name
  theme: "emerald", // colour theme key (see THEMES); drives the sidebar + accent palette
  iconStyle: "advanced", // "advanced" (dark glass whole-app skin) | "basic" (classic flat) — see ICON_STYLES
};

// The app's APPEARANCE — the [data-theme] axis on the .app root, which the whole stylesheet
// branches on: in "advanced" a dark glass skin (a lit backdrop, frosted panels, gilded icons); in
// "basic" the original bright, flat look. Kept SEPARATE from the colour theme above — a salon picks
// its colour, then decides whether every device shows the glass skin or the flat one that reads
// fastest in daylight. (The config key stays `iconStyle` for backward-compat with saved settings.)
const ICON_STYLES = {
  advanced: { label: "Advanced", hint: "dark glass — a lit backdrop, frosted panels and gilded icons" },
  basic: { label: "Basic", hint: "the classic bright, flat look — fastest to read in daylight" },
};
const ICON_STYLE_KEYS = Object.keys(ICON_STYLES);

// localStorage key + reader for the salon config. Cached separately from the data cache so the
// pre-auth Login screen can brand itself with the owner's saved salon name/logo instantly.
const CONFIG_CACHE_KEY = "slm-config-v1";
const readCachedConfig = () => {
  try { const c = JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) || "null"); return c && typeof c === "object" ? c : {}; }
  catch { return {}; }
};

// Built-in defaults with any owner-set config layered on. A blank/whitespace config field falls
// back to the default so the header and receipt are never left empty. logo/paymentQr keep "" when
// unset (callers fall back to the bundled asset). Used everywhere the store identity is shown.
function effectiveStore(config = {}) {
  const pick = (v, d) => (typeof v === "string" && v.trim() ? v : d);
  return {
    name: pick(config.name, STORE.name),
    tagline: pick(config.tagline, STORE.tagline),
    address: pick(config.address, STORE.address),
    phone: pick(config.phone, STORE.phone),
    pcIp: pick(config.pcIp, STORE.pcIp),
    logo: pick(config.logo, ""),
    paymentQr: pick(config.paymentQr, ""),
    upiId: pick(config.upiId, ""),
    upiName: pick(config.upiName, ""),
    theme: THEMES[config.theme] ? config.theme : STORE.theme,
    iconStyle: ICON_STYLES[config.iconStyle] ? config.iconStyle : STORE.iconStyle,
  };
}

// ── Colour themes ────────────────────────────────────────────────────────────────────────────
// Each theme is a full set of CSS-variable values for the sidebar + accent palette. The picker in
// Salon Settings stores the key on config.theme; StoreManager spreads themeVars(key) onto the .app
// root, which overrides the :root defaults in CSS for everything inside the app. Charts and printed
// receipts deliberately keep their own fixed palettes (categorical clarity / neutral print ink).
const THEMES = {
  emerald: {
    label: "Emerald", swatch: ["#10331f", "#1b5e43"],
    vars: { "--ink": "#10331f", "--nav-hover": "#1a4a2e", "--nav-panel": "#173d28", "--nav-panel-hover": "#1f5237", "--nav-line": "#2f5c44", "--nav-text": "#bcd2c4", "--nav-text-dim": "#a8c2b4", "--nav-hi": "#e9f2ec", "--brand": "#1b5e43", "--brand-soft": "#e4ece5", "--brand-soft-text": "#23402f", "--app-bg": "#eff3ee", "--focus-ring": "rgba(27,94,67,.18)" },
  },
  midnight: {
    label: "Midnight", swatch: ["#0f1729", "#4f46e5"],
    vars: { "--ink": "#0f1729", "--nav-hover": "#1e293b", "--nav-panel": "#1a2337", "--nav-panel-hover": "#29344a", "--nav-line": "#38445f", "--nav-text": "#c4ccdc", "--nav-text-dim": "#aeb8cc", "--nav-hi": "#e8ecf6", "--brand": "#4f46e5", "--brand-soft": "#e7e7fb", "--brand-soft-text": "#2a2170", "--app-bg": "#eef0f5", "--focus-ring": "rgba(79,70,229,.20)" },
  },
  plum: {
    label: "Plum", swatch: ["#241436", "#7c3aed"],
    vars: { "--ink": "#241436", "--nav-hover": "#35204f", "--nav-panel": "#2e1a45", "--nav-panel-hover": "#40275c", "--nav-line": "#4b3168", "--nav-text": "#d4c4e8", "--nav-text-dim": "#c1aedc", "--nav-hi": "#f0e9fa", "--brand": "#7c3aed", "--brand-soft": "#ece4fb", "--brand-soft-text": "#3c2568", "--app-bg": "#f2eff7", "--focus-ring": "rgba(124,58,237,.20)" },
  },
  rose: {
    label: "Rose", swatch: ["#34101f", "#d81e5b"],
    vars: { "--ink": "#34101f", "--nav-hover": "#4e1a30", "--nav-panel": "#431627", "--nav-panel-hover": "#5a2038", "--nav-line": "#6b2f49", "--nav-text": "#eec6d4", "--nav-text-dim": "#e3b1c4", "--nav-hi": "#fbe7ee", "--brand": "#d81e5b", "--brand-soft": "#fbe3ec", "--brand-soft-text": "#6b1231", "--app-bg": "#f8eef2", "--focus-ring": "rgba(216,30,91,.20)" },
  },
  ocean: {
    label: "Ocean", swatch: ["#082a33", "#0e7490"],
    vars: { "--ink": "#082a33", "--nav-hover": "#103f4b", "--nav-panel": "#0d3540", "--nav-panel-hover": "#144a58", "--nav-line": "#23616f", "--nav-text": "#b6d6de", "--nav-text-dim": "#a0c8d1", "--nav-hi": "#e4f2f5", "--brand": "#0e7490", "--brand-soft": "#def0f4", "--brand-soft-text": "#0a4553", "--app-bg": "#ecf4f5", "--focus-ring": "rgba(14,116,144,.20)" },
  },
  espresso: {
    label: "Espresso", swatch: ["#2a1b12", "#b45309"],
    vars: { "--ink": "#2a1b12", "--nav-hover": "#40291b", "--nav-panel": "#37241a", "--nav-panel-hover": "#4c3626", "--nav-line": "#5e4230", "--nav-text": "#e5d3c3", "--nav-text-dim": "#d8c1ad", "--nav-hi": "#f6ece1", "--brand": "#b45309", "--brand-soft": "#f5e8db", "--brand-soft-text": "#5a3410", "--app-bg": "#f4efe9", "--focus-ring": "rgba(180,83,9,.20)" },
  },
};
const THEME_KEYS = Object.keys(THEMES);
// The CSS-variable overrides for a theme key, safe to spread onto an element's style. Falls back to
// Emerald for an unknown/blank key so a bad value can never leave the app unstyled.
const themeVars = (key) => (THEMES[key] || THEMES.emerald).vars;

// A blank string, or a dotted IPv4 (each octet 0-255), optionally with a :port. Used to keep the
// shop PC IP field sane before saving. Hostnames aren't accepted — the field is labelled "IP".
const isValidPcIp = (s) => {
  const v = (s || "").trim();
  if (!v) return true;
  const [host, port, ...rest] = v.split(":");
  if (rest.length) return false;
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return false;
  const oct = host.split(".");
  return oct.length === 4 && oct.every((o) => /^\d{1,3}$/.test(o) && +o >= 0 && +o <= 255);
};

// ---------- authentication (Firebase email/password) ----------
// Real server-side auth via Firebase. Data is gated by the database security rules
// (locked to the shop owner's email), so it is genuinely private — not just a UI gate.
const AUTH_ERRORS = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "No account with that email.",
  "auth/invalid-email": "That email address looks invalid.",
  "auth/missing-password": "Please enter your password.",
  "auth/too-many-requests": "Too many attempts — please wait a minute and retry.",
  "auth/network-request-failed": "Network error — check your internet connection.",
  "auth/unauthorized-domain": "This web address isn't authorised in Firebase Auth settings.",
};
const authMessage = (code) => AUTH_ERRORS[code] || "Could not sign in. Please try again.";


export { LOG_TYPES, STORE, ICON_STYLES, ICON_STYLE_KEYS, CONFIG_CACHE_KEY, readCachedConfig, effectiveStore, THEMES, THEME_KEYS, themeVars, isValidPcIp, authMessage };
