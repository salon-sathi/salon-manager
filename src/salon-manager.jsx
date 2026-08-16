// Salon Manager — the app shell.
//
// This file is the SHELL only: sign-in, the role gate, the sync wiring, the seeders, the
// navigation and the view switch. Every screen lives in src/views/ and is loaded on demand;
// the pieces they share live in src/components/ and src/lib/ui/. See CLAUDE.md ("Where things
// live") before moving anything between them.

import { SERVICE_ICON_CSS, ServiceIconDefs } from "./components/ServiceIcon.jsx";
import { ConnBadge, Field, NavButton, NoAccess, OfflineBlockModal, Splash, UpdateBadge } from "./components/primitives.jsx";
import { MQ } from "./lib/breakpoints.js";
import { reconcileCustomers } from "./lib/customers.js";
import { auth, isFirebaseConfigured } from "./lib/firebase.js";
import { reconcileLoyalty, reconcilePackages } from "./lib/loyalty.js";
import { ROLE_LABELS, can, isBootstrap, resolveRole, sanitizePermissions } from "./lib/roles.js";
import { serviceToCartLine } from "./lib/salon.js";
import { SLICES, buildSliceUpdate, isLegacyShape, mapToArray, mergeRemote, overwriteSlice, readUsersOnce, readableSlices, subscribeConfig, subscribeConnection, subscribeOwnUser, subscribeSlice, toMap, writeConfig, writeSlice, writeUser } from "./lib/sync.js";
import { LOGO_SRC } from "./lib/ui/assets.js";
import { CSS, S } from "./lib/ui/css.js";
import { todayStr, uid } from "./lib/ui/format.js";
import { useMediaQuery, useUpdateReady } from "./lib/ui/hooks.js";
import { applyUpdate } from "./lib/ui/swUpdate.js";
import { CUSTOM_CATS_KEY, catList, daysToExpiry, normalizeItems } from "./lib/ui/inventory.js";
import { OTHER_TABS, PHONE_BAR_TABS, PHONE_TAB_LABELS, TOP_TABS, tabAllowed, tabEnabled } from "./lib/ui/nav.js";
import { SEED_ITEMS, SEED_SERVICES, SEED_STAFF, SEED_TEMPLATES } from "./lib/ui/seeds.js";
import { CONFIG_CACHE_KEY, authMessage, effectiveStore, readCachedConfig, themeVars } from "./lib/ui/store.js";
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------- the views ----------
// One chunk per screen, fetched the first time that tab is opened. The salon's counter
// tablet loads the till and the diary; it never pays for the stats charts or the barcode
// generator unless somebody opens them. Suspense's fallback is the same one-line loading
// affordance the shell already shows while the first snapshot lands.
const Admin = lazy(() => import("./views/Admin.jsx"));
const Alerts = lazy(() => import("./views/Alerts.jsx"));
const Appointments = lazy(() => import("./views/Appointments.jsx"));
const BarcodeCreator = lazy(() => import("./views/BarcodeCreator.jsx"));
const Billing = lazy(() => import("./views/Billing.jsx"));
const Changelog = lazy(() => import("./views/Changelog.jsx"));
const Customers = lazy(() => import("./views/Customers.jsx"));
const Dashboard = lazy(() => import("./views/Dashboard.jsx"));
const WorkerDashboard = lazy(() => import("./views/Dashboard.jsx").then((m) => ({ default: m.WorkerDashboard })));
const Expenses = lazy(() => import("./views/Expenses.jsx"));
const Finance = lazy(() => import("./views/Finance.jsx"));
const Inventory = lazy(() => import("./views/Inventory.jsx"));
const Logs = lazy(() => import("./views/Logs.jsx"));
const Packages = lazy(() => import("./views/Packages.jsx"));
const RawData = lazy(() => import("./views/RawData.jsx"));
const Reminders = lazy(() => import("./views/Reminders.jsx"));
const SalesHistory = lazy(() => import("./views/SalesHistory.jsx"));
const Services = lazy(() => import("./views/Services.jsx"));
const StoreConfig = lazy(() => import("./views/Settings.jsx"));
const Staff = lazy(() => import("./views/Staff.jsx"));
const Stats = lazy(() => import("./views/Stats.jsx"));
const Udhari = lazy(() => import("./views/Udhari.jsx"));
const VendorBills = lazy(() => import("./views/VendorBills.jsx"));

function Login() {
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  // Brand the sign-in card with the owner's saved settings (from the local cache — the cloud
  // config lives behind auth, so this is the best we have pre-login). Falls back to defaults.
  const store = effectiveStore(readCachedConfig());
  const loginLogo = store.logo || LOGO_SRC;

  const submit = async (e) => {
    e?.preventDefault();
    // Without this the SDK throws auth/invalid-api-key, which reads like a bug rather than
    // "nobody has connected this app to a Firebase project yet".
    if (!isFirebaseConfigured) return setErr("This app isn't connected to a Firebase project yet — see src/lib/firebase.js.");
    setBusy(true); setErr(""); setInfo("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pwd);
      // App's auth listener swaps to the dashboard on success.
    } catch (ex) {
      setErr(authMessage(ex.code));
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) return setErr("Enter your email above first, then tap reset.");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setErr(""); setInfo("Password reset link sent to " + email.trim());
    } catch (ex) { setErr(authMessage(ex.code)); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--ink)", padding: 16 }}>
      <style>{CSS}</style>
      <form onSubmit={submit} style={{ background: "#fff", borderRadius: 16, padding: "26px 24px", width: "min(380px, 94vw)", boxShadow: "0 12px 40px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <img src={loginLogo} alt={store.name} style={{ width: 52, height: 52, borderRadius: 12, objectFit: "contain", flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>{store.name}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)" }}>{store.address}</div>
          </div>
        </div>
        <h2 style={{ fontSize: 16, margin: "18px 0 12px" }}>Sign in</h2>
        {!isFirebaseConfigured && (
          <div style={{ background: "var(--tint-warm, #FFF6E5)", border: "1px solid var(--tint-warm-border, #F0D9A8)", borderRadius: 9, padding: "10px 12px", marginBottom: 12, fontSize: 12.5, color: "#7A5B14", lineHeight: 1.6 }}>
            <b>Not connected yet.</b> The Firebase config in this build isn't usable (a blank
            value, or an apiKey that isn't a Firebase browser key), so sign-in and sync are
            inactive. Create your own Firebase project and fill in
            {" "}<code>src/lib/firebase.js</code> — the setup steps are in that file and in the README.
          </div>
        )}
        <Field label="Email"><input className="input" type="email" value={email} autoComplete="username" autoFocus onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="input" type="password" value={pwd} autoComplete="current-password" onChange={(e) => setPwd(e.target.value)} /></Field>
        {err && <div style={{ color: "#C44536", fontSize: 13, marginBottom: 8 }}>{err}</div>}
        {info && <div style={{ color: "var(--brand)", fontSize: 13, marginBottom: 8 }}>{info}</div>}
        <button className="btn primary big" type="submit" style={{ width: "100%" }} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <button type="button" onClick={reset} style={{ display: "block", background: "none", border: "none", color: "var(--brand)", fontSize: 12, marginTop: 10, cursor: "pointer", padding: 0 }}>Forgot password? Email me a reset link</button>
        <div style={{ fontSize: 11, color: "var(--text-mid, #8A9C90)", marginTop: 12, lineHeight: 1.5 }}>
          Sign in with your shop account. Your data syncs live across every device that signs in.
        </div>
      </form>
    </div>
  );
}

// ---------- root: Firebase auth gate ----------
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (user === undefined) {
    return <Splash>Loading…</Splash>;
  }
  if (!user) return <Login />;
  return <RoleGate user={user} onLogout={() => signOut(auth)} />;
}

// Why the signed-in user can't get in. Being authenticated is not the same as being staff.
const DENIED_MESSAGES = {
  "not-invited":
    "This account isn't set up for this salon yet. Ask the owner to add you under Settings → Users.",
  deactivated:
    "This account has been deactivated. Ask the owner to re-activate it under Settings → Users.",
  error:
    "Couldn't check your access — the salon database may be unreachable, or the security rules may not be deployed yet.",
};

// ---------- role gate ----------
// Signing in proves WHO you are; this resolves WHAT you may do, and nothing renders until it
// has. Rendering the shell first and hiding tabs afterwards would flash owner-only views at a
// worker on a slow connection, so the gate is a hard barrier rather than a filter.
//
// Bootstrap: the very first user to sign in while shop/users is empty claims owner. That is how
// a fresh deployment gets its first owner with no Firebase console visit, and it mirrors the
// bootstrap rule in database.rules.json. Once anyone is registered, the node locks down.
function RoleGate({ user, onLogout }) {
  const [state, setState] = useState({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    let claiming = false;

    // Claim ownership of an un-claimed salon. Only reached when this user has no record.
    const tryBootstrap = async () => {
      if (claiming) return; // the listener re-fires on our own write; claim once
      claiming = true;
      try {
        const usersMap = await readUsersOnce();
        if (cancelled) return;
        if (!isBootstrap(usersMap)) return setState({ phase: "denied", reason: "not-invited" });
        await writeUser(user.uid, {
          email: user.email || "",
          name: "",
          role: "owner",
          active: true,
          createdAt: todayStr(),
        });
        // The subscription below re-fires with the new record and lets us in — no setState here.
      } catch {
        // A rejected read IS the answer: the rules only allow reading shop/users while it is
        // empty, so being refused means the salon already has an owner and we aren't on the list.
        if (!cancelled) setState({ phase: "denied", reason: "not-invited" });
      }
    };

    // Every authenticated user may read their OWN record even before they have one (see the
    // $uid .read rule), which is what makes "you aren't set up yet" distinguishable from
    // "the network is down". Staying subscribed also means a live demotion or deactivation
    // takes effect immediately, without waiting for a reload.
    const unsub = subscribeOwnUser(
      user.uid,
      (record) => {
        if (cancelled) return;
        if (!record) return void tryBootstrap();
        const role = resolveRole(record);
        setState(role ? { phase: "ready", role, record } : { phase: "denied", reason: "deactivated" });
      },
      () => { if (!cancelled) setState({ phase: "denied", reason: "error" }); }
    );

    return () => { cancelled = true; unsub(); };
  }, [user.uid, user.email]);

  if (state.phase === "loading") return <Splash>Checking your access…</Splash>;

  if (state.phase === "denied") {
    return (
      <Splash>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🔒</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#fff", marginBottom: 8 }}>No access</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 6 }}>{DENIED_MESSAGES[state.reason]}</p>
          <p style={{ fontSize: 12, opacity: 0.75, marginBottom: 18 }}>Signed in as {user.email}</p>
          <button className="btn" onClick={onLogout} style={{ cursor: "pointer" }}>Sign out</button>
        </div>
        <style>{CSS}</style>
      </Splash>
    );
  }

  return <StoreManager user={user} role={state.role} onLogout={onLogout} />;
}

// Slices that get seeded on first run, and the permission required to write that seed. A role
// without the permission simply doesn't seed — it waits for an owner to sign in and do it —
// rather than firing a write the rules will bounce.
const SEEDERS = {
  items: { build: () => SEED_ITEMS, action: "inventory.edit" },
  services: { build: () => SEED_SERVICES, action: "services.manage" },
  staff: { build: () => SEED_STAFF, action: "staff.manage" },
  // reminders.templates, not reminders.use: shop/messageTemplates is owner-write-only, and
  // an owner may now hand Reminders to a worker. Seeding on `reminders.use` would fire a
  // write the rules bounce the moment they did.
  messageTemplates: { build: () => SEED_TEMPLATES, action: "reminders.templates" },
};

function StoreManager({ user, role, onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [otherOpen, setOtherOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [logs, setLogs] = useState([]);
  const [bills, setBills] = useState([]); // vendor purchase bills (vendorBills slice)
  const [dailyBills, setDailyBills] = useState([]); // legacy daily-need bills; mirrors into vendorBills
  // ---- salon slices ----
  const [customers, setCustomers] = useState([]);
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [packages, setPackages] = useState([]);
  const [customerPackages, setCustomerPackages] = useState([]);
  const [messageTemplates, setMessageTemplates] = useState([]);
  // Owner-added categories that have no item yet (device-local; once an item uses one it also
  // rides along in the synced items data). Merged with the built-ins + item categories below.
  const [customCats, setCustomCats] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem(CUSTOM_CATS_KEY) || "[]"); return Array.isArray(c) ? c.filter((x) => typeof x === "string") : []; }
    catch { return []; }
  });
  // Store identity/branding (shop name, address, logo, PC IP …). A singleton synced at
  // shop/config — see the dedicated effect below. Seeded from the local cache for instant paint.
  const [config, setConfig] = useState(() => readCachedConfig());
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);

  // ---- what this person may actually do ----
  // The role's built-in matrix, plus the owner's per-role feature switches from the shared
  // config — so switching Billing off for the Billers reaches their tablet the moment it
  // saves, with no reload. Declared up here because the seeding effect below needs it.
  //
  // `allow` is the ONLY permission check this component makes: a stray can(role, …) would
  // apply the switches in some places and not others, which is exactly how a hidden tab ends
  // up with a reachable view behind it. Sub-components that check for themselves are handed
  // `perms` alongside `role`.
  const perms = useMemo(() => sanitizePermissions(config.permissions), [config.permissions]);
  const allow = useCallback((action) => can(role, action, perms), [role, perms]);
  // The seeding branch inside the sync subscription needs this too, but re-subscribing every
  // slice each time the owner saves a switch would be pointless churn — a ref keeps the check
  // current without putting `allow` in that effect's dependency list.
  const allowRef = useRef(allow);
  allowRef.current = allow;

  // ---- Realtime Database sync (live across every signed-in device) ----
  // Every record (item/sale/expense/log) lives at its own keyed node — shop/<slice>/<id> —
  // so concurrent edits from different devices to different records merge instead of
  // clobbering. Writes are field-level deltas; incoming snapshots are 3-way merged with any
  // un-pushed local edits. A localStorage cache gives instant first paint and offline reads.
  // See src/lib/sync.js for the array↔map bridge.
  const CACHE_KEY = "slm-cache-v1";
  // Last cloud map / first-snapshot flag, per slice. Built from SLICES so adding a slice can't
  // leave a hole here that silently disables its delta pushes.
  const lastRemote = useRef(Object.fromEntries(SLICES.map((s) => [s, {}])));
  const synced = useRef(Object.fromEntries(SLICES.map((s) => [s, false])));
  const seeded = useRef({}); // slice → true once this device has written that slice's seed
  const configSynced = useRef(false);        // have we read shop/config from the cloud at least once?
  const lastConfig = useRef(JSON.stringify(readCachedConfig())); // last config JSON reconciled with the cloud (blocks echo writes)
  // Seed from the browser's network status so the badge is right on the first paint; the RTDB
  // .info/connected signal (subscribeConnection, below) then takes over as the authoritative
  // "can I actually reach the cloud" answer that gates every write.
  const [online, setOnline] = useState(navigator.onLine);
  // The device blocks EVERY data write while offline (owner's choice): a change attempted with no
  // connection is refused and this raises the loud "not saved — you're offline" modal, rather than
  // being saved locally to sync later. See guardOnline / the guarded writers below.
  const [offlineBlock, setOfflineBlock] = useState(false);

  // The one place that maps a slice name → its React setter. Everything below (cache, sync,
  // push) drives off this, so a new slice is wired in exactly one place.
  const SETTERS = useMemo(() => ({
    items: setItems, sales: setSales, expenses: setExpenses, logs: setLogs,
    vendorBills: setBills, dailyBills: setDailyBills,
    customers: setCustomers, services: setServices, staff: setStaff,
    appointments: setAppointments, packages: setPackages,
    customerPackages: setCustomerPackages, messageTemplates: setMessageTemplates,
  }), []);

  // Slices this role may READ, and therefore subscribe to. Subscribing to a slice the rules
  // deny would spam permission-denied and pop a sync-error toast at the counter, so a worker
  // simply never asks for the money slices. Mirrors database.rules.json.
  const mySlices = useMemo(() => readableSlices(role), [role]);

  // Always-current local state, readable from inside async listeners (for the merge).
  const dataRef = useRef({});
  dataRef.current = { items, sales, expenses, logs, vendorBills: bills, dailyBills, customers, services, staff, appointments, packages, customerPackages, messageTemplates };
  const notifyRef = useRef(null);

  // ---- offline write-guard ----
  // Mirror `online`/`offlineBlock` into refs so the guard and the toast can read them
  // synchronously, before React re-renders. `online` is the RTDB .info/connected signal.
  const onlineRef = useRef(true);
  onlineRef.current = online;
  const offlineBlockRef = useRef(false);
  offlineBlockRef.current = offlineBlock;
  // Refuse a write when offline: raise the modal and return false. Cloud reads and the local-cache
  // restore keep using the RAW setters (SETTERS), so incoming data still applies — only the
  // setters handed to the UI (the `writers` below) and the few direct callers go through this.
  const guardOnline = useCallback(() => {
    if (onlineRef.current) return true;
    offlineBlockRef.current = true;
    setOfflineBlock(true);
    return false;
  }, []);
  const withOnline = useCallback((fn) => (arg) => { if (guardOnline()) fn(arg); }, [guardOnline]);
  // Online-guarded versions of every data setter, handed to the views in place of the raw ones.
  const writers = useMemo(() => ({
    items: withOnline(setItems), sales: withOnline(setSales), expenses: withOnline(setExpenses),
    logs: withOnline(setLogs), bills: withOnline(setBills), dailyBills: withOnline(setDailyBills),
    customers: withOnline(setCustomers), services: withOnline(setServices), staff: withOnline(setStaff),
    appointments: withOnline(setAppointments), packages: withOnline(setPackages),
    customerPackages: withOnline(setCustomerPackages), messageTemplates: withOnline(setMessageTemplates),
    config: withOnline(setConfig),
  }), [withOnline]);

  // 1) Instant paint from the local cache. Only restores slices this role may read — otherwise
  //    a cache left behind by an owner on a shared counter device would show a worker the
  //    expense book. The cache is written with the same filter (see the write effect below).
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c) {
        for (const slice of mySlices) {
          const cached = c[slice];
          if (!Array.isArray(cached)) continue;
          SETTERS[slice](slice === "items" ? normalizeItems(cached) : cached);
        }
      }
    } catch (e) { console.error("cache read failed", e); }
    setLoaded(true);
  }, [mySlices, SETTERS]);

  // 2) Subscribe to the cloud; changes from any device flow in live.
  useEffect(() => {
    const unsubs = mySlices.map((slice) =>
      subscribeSlice(
        slice,
        (val) => {
          // First run anywhere: seed this slice once, then write it to the cloud. Seeding is a
          // privileged write (the catalogue is owner/inventory territory), so a role without
          // the permission just marks itself synced and waits — an unprivileged seed attempt
          // would be rejected and would leave the local list out of step with the cloud.
          const seeder = SEEDERS[slice];
          if (seeder && val === null) {
            if (seeded.current[slice] || !allowRef.current(seeder.action)) {
              synced.current[slice] = true;
              return;
            }
            seeded.current[slice] = true;
            const map = toMap(seeder.build());
            lastRemote.current[slice] = map;
            synced.current[slice] = true;
            const next = mapToArray(slice, map);
            SETTERS[slice](slice === "items" ? normalizeItems(next) : next);
            overwriteSlice(slice, map).catch((e) => console.error("seed write failed", slice, e));
            return;
          }
          const theirs = toMap(val);
          // One-time migration of legacy array / numeric-keyed data → keyed-by-id map.
          if (isLegacyShape(val, theirs)) {
            overwriteSlice(slice, theirs).catch((e) => console.error("migrate failed", slice, e));
          }
          const base = lastRemote.current[slice];
          const wasSynced = synced.current[slice];
          lastRemote.current[slice] = theirs;
          synced.current[slice] = true;
          // Merge against the TRUE current state via the functional updater — NOT a ref that
          // may lag a just-dispatched local edit by a render. This is what stops an incoming
          // snapshot from silently reverting an edit/restock/delete made a moment earlier.
          SETTERS[slice]((curr) => {
            const next = mapToArray(slice, wasSynced ? mergeRemote(base, theirs, toMap(curr)) : theirs);
            return slice === "items" ? normalizeItems(next) : next;
          });
        },
        (err) => {
          console.error("sync read failed", slice, err);
          notifyRef.current?.("⚠ Cloud sync error — check your connection or account access.");
        }
      )
    );
    const unsubConn = subscribeConnection(setOnline);
    return () => { unsubs.forEach((u) => u()); unsubConn(); };
  }, [mySlices, role, SETTERS]);

  // 3) Push field-level deltas to the cloud when a slice changes locally (after the first
  //    cloud snapshot). buildSliceUpdate skips no-op echoes, so this is loop-safe.
  const pushSlice = useCallback((slice, value) => {
    if (!synced.current[slice]) return; // don't write before we've read the cloud once
    const { updates, nextMap, changed } = buildSliceUpdate(lastRemote.current[slice], value);
    if (!changed) return;
    lastRemote.current[slice] = nextMap; // optimistic; the echo snapshot confirms it
    writeSlice(slice, updates).catch((e) => {
      console.error("sync write failed", slice, e);
      notify("⚠ Couldn't sync to cloud — saved on this device, will retry when back online.");
    });
  }, []);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("items", items), 300); return () => clearTimeout(t); }, [items, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("sales", sales), 300); return () => clearTimeout(t); }, [sales, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("expenses", expenses), 300); return () => clearTimeout(t); }, [expenses, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("logs", logs), 300); return () => clearTimeout(t); }, [logs, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("vendorBills", bills), 300); return () => clearTimeout(t); }, [bills, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("dailyBills", dailyBills), 300); return () => clearTimeout(t); }, [dailyBills, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("customers", customers), 300); return () => clearTimeout(t); }, [customers, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("services", services), 300); return () => clearTimeout(t); }, [services, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("staff", staff), 300); return () => clearTimeout(t); }, [staff, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("appointments", appointments), 300); return () => clearTimeout(t); }, [appointments, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("packages", packages), 300); return () => clearTimeout(t); }, [packages, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("customerPackages", customerPackages), 300); return () => clearTimeout(t); }, [customerPackages, loaded, pushSlice]);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => pushSlice("messageTemplates", messageTemplates), 300); return () => clearTimeout(t); }, [messageTemplates, loaded, pushSlice]);

  // 3b) Store config is a singleton, not a keyed slice — subscribe/write it whole. Incoming
  //     cloud values update state and the pre-auth cache; local edits push back (the lastConfig
  //     guard skips the echo write when the change we're seeing is the one we just received).
  useEffect(() => {
    const unsub = subscribeConfig(
      (val) => {
        configSynced.current = true;
        const next = val && typeof val === "object" ? val : {};
        lastConfig.current = JSON.stringify(next);
        setConfig(next);
        try { localStorage.setItem(CONFIG_CACHE_KEY, lastConfig.current); } catch (e) { console.error("config cache write failed", e); }
      },
      (err) => { console.error("config sync read failed", err); }
    );
    return () => unsub();
  }, []);
  useEffect(() => {
    if (!loaded || !configSynced.current) return;
    const s = JSON.stringify(config ?? {});
    try { localStorage.setItem(CONFIG_CACHE_KEY, s); } catch (e) { console.error("config cache write failed", e); }
    if (s === lastConfig.current) return; // echo of a value we already have in the cloud
    const t = setTimeout(() => {
      lastConfig.current = s;
      writeConfig(config).catch((e) => {
        console.error("config sync write failed", e);
        notify("⚠ Couldn't sync settings — saved on this device, will retry when back online.");
      });
    }, 300);
    return () => clearTimeout(t);
  }, [config, loaded]);

  // 4) Mirror to a local cache (instant next paint + offline reads + no data loss on close).
  //    Only the slices this role may read are cached: the counter tablet is a shared device, so
  //    an owner's session must not leave the expense book sitting in localStorage for whoever
  //    signs in next. The read effect applies the same filter on the way back in.
  useEffect(() => {
    if (!loaded) return;
    const writeCache = () => {
      try {
        const snapshot = {};
        for (const slice of mySlices) snapshot[slice] = dataRef.current[slice];
        localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
      } catch (e) { console.error("cache write failed", e); }
    };
    const t = setTimeout(writeCache, 400);
    const onHide = () => { if (document.visibilityState === "hidden") writeCache(); };
    window.addEventListener("beforeunload", writeCache);
    window.addEventListener("pagehide", writeCache);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeunload", writeCache);
      window.removeEventListener("pagehide", writeCache);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [items, sales, expenses, logs, bills, dailyBills, customers, services, staff, appointments, packages, customerPackages, messageTemplates, loaded, mySlices]);

  const toastTimer = useRef(null);
  const notify = (msg) => {
    // While the offline-block modal is up, it IS the message — don't stack a toast (e.g. a
    // handler's trailing "saved" line) behind it, which would contradict the "not saved" popup.
    if (offlineBlockRef.current) return;
    if (toastTimer.current) clearTimeout(toastTimer.current); // don't let an old timer cut a new toast short
    setToast(msg);
    toastTimer.current = setTimeout(() => { setToast(null); toastTimer.current = null; }, 2200);
  };
  notifyRef.current = notify; // let the cloud listener surface errors via the same toast

  // Persist owner-added categories locally; the full list shown everywhere merges these with the
  // built-ins and any category already on an item.
  useEffect(() => { try { localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(customCats)); } catch (e) { console.error("custom cats write failed", e); } }, [customCats]);
  const cats = useMemo(() => catList(items, customCats), [items, customCats]);

  // Effective store identity (defaults + owner config). Drives the sidebar brand, the receipt,
  // and anywhere the shop name/logo/address appears.
  const store = useMemo(() => effectiveStore(config), [config]);

  // Prompt for and add a new category. Returns the canonical name to select (existing match if it's
  // a duplicate, the new name otherwise), or null if cancelled/blank. Used by the Add/Edit forms.
  const addCategory = useCallback(() => {
    if (!guardOnline()) return null;
    const raw = window.prompt("New category name:");
    if (raw == null) return null;
    const name = raw.trim();
    if (!name) return null;
    const existing = catList(dataRef.current.items, customCats).find((c) => c.toLowerCase() === name.toLowerCase());
    if (existing) { notifyRef.current?.(`“${existing}” already exists.`); return existing; }
    setCustomCats((cs) => [...cs, name]);
    notifyRef.current?.(`Category “${name}” added.`);
    return name;
  }, [customCats, guardOnline]);

  const resetMyPassword = async () => {
    if (!user?.email) return;
    if (!confirm(`Send a password reset link to ${user.email}?`)) return;
    try { await sendPasswordResetEmail(auth, user.email); notify("Reset link sent to " + user.email); }
    catch (e) { console.error("reset failed", e); notify("⚠ Could not send reset email."); }
  };

  // Append an entry to the global activity log (newest first; capped to protect storage).
  // No-ops while offline: the log is a synced slice, and nothing is written on this device when
  // there's no connection. A blocked action never reached its work, so it has nothing to log.
  const addLog = (type, message) => {
    if (!onlineRef.current) return;
    const now = new Date();
    setLogs((l) =>
      [
        {
          id: uid(),
          at: now.getTime(),
          date: todayStr(),
          time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          type,
          message,
        },
        ...l,
      ].slice(0, 2000)
    );
  };

  const exportData = async (fmt) => {
    const data = { items, sales, expenses, logs, vendorBills: bills, dailyBills, customCats };
    const slug = (store.name || "salon").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "salon";
    const fname = `${slug}-${todayStr()}.${fmt === "xlsx" ? "xlsx" : "json"}`;
    try {
      const { exportJson, exportXlsx } = await import("./lib/backup.js");
      if (fmt === "xlsx") exportXlsx(data, fname);
      else exportJson(data, fname);
      addLog("backup", `Backup downloaded (${fmt.toUpperCase()})`);
      notify(`Backup downloaded (${fmt.toUpperCase()})`);
    } catch (err) {
      console.error("backup failed", err);
      notify("⚠ Could not create the backup file.");
    }
  };

  const importData = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file later
    if (!f) return;
    if (!guardOnline()) return; // a restore rewrites the whole tree — never while offline
    try {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const { importXlsx } = await import("./lib/backup.js");
      const d = ext === "xlsx" || ext === "xls" ? await importXlsx(f) : JSON.parse(await f.text());
      if (!d || !Array.isArray(d.items)) throw new Error("bad file");
      if (!confirm("Restore this backup? It will REPLACE all current data on this device.")) return;
      setItems(normalizeItems(d.items));
      setSales(Array.isArray(d.sales) ? d.sales : []);
      setExpenses(Array.isArray(d.expenses) ? d.expenses : []);
      setLogs(Array.isArray(d.logs) ? d.logs : []);
      setBills(Array.isArray(d.vendorBills) ? d.vendorBills : []);
      setDailyBills(Array.isArray(d.dailyBills) ? d.dailyBills : []);
      // Owner-added categories with no item yet — only overwrite when the backup carries them,
      // so restoring an older backup (which predates this field) doesn't wipe current categories.
      if (Array.isArray(d.customCats)) setCustomCats(d.customCats.filter((x) => typeof x === "string"));
      addLog("backup", `Backup restored (${ext.toUpperCase()})`);
      notify("Backup restored");
    } catch (err) {
      console.error("restore failed", err);
      notify("⚠ That file is not a valid backup.");
    }
  };

  // Keep every customer's denormalized visit/spend stats in step with the bills.
  //
  // This lives HERE, at the shell, rather than at each call site that touches a bill — billing,
  // a Sales History edit, a delete, a split, a restore, an incoming sync from another device.
  // Any of those can change what a customer has spent, and a reversal bolted onto each one is
  // a reversal waiting to be forgotten. Reconciling from the bills themselves means there is
  // no reversal to forget: delete a bill and the stats simply recompute without it.
  //
  // reconcileCustomers returns the same array reference when nothing changed, so this settles
  // after one pass instead of pushing a write to the cloud on every render.
  // Both reconcilers return the SAME array reference when nothing changed, so this settles
  // after one pass instead of looping. Loyalty is folded in here rather than in its own effect
  // because points and spend are both functions of the same bills — running them apart would
  // mean two renders and two cloud writes for one change.
  useEffect(() => {
    if (!loaded || !synced.current.customers || !synced.current.sales) return;
    setCustomers((cs) => reconcileLoyalty(reconcileCustomers(cs, sales), sales, config, todayStr()));
  }, [sales, customers, config, loaded]);

  // Package sessions are derived from the bills too, for exactly the same reason: a stored
  // counter drifts, and a drifted package balance means either turning away a customer with
  // sessions left or giving away work they already used.
  useEffect(() => {
    if (!loaded || !synced.current.customerPackages || !synced.current.sales) return;
    setCustomerPackages((cps) => reconcilePackages(cps, sales));
  }, [sales, customerPackages, loaded]);

  // "Complete → Bill": hand an appointment to the POS pre-filled with its customer, its
  // services and who performed them, then link the two together once the bill is saved.
  //
  // The prefill is a one-shot handover rather than shared state: Billing owns its cart from
  // the moment it's seeded, so the biller can add a retail product or drop a service without
  // the diary reaching back in and overwriting their work mid-bill.
  const [billPrefill, setBillPrefill] = useState(null);

  const completeToBill = useCallback((appt) => {
    const chosen = (appt.serviceIds || [])
      .map((id) => services.find((s) => s.id === id))
      .filter(Boolean);
    if (!chosen.length) {
      notifyRef.current?.("⚠ This appointment has no services on it — nothing to bill.");
      return;
    }
    setBillPrefill({
      appointmentId: appt.id,
      customerPhone: appt.customerPhone || "",
      // Attribute every line to the stylist whose column the appointment sits in — that's who
      // did the work. Any line can still be re-attributed in the cart.
      lines: chosen.map((s) => serviceToCartLine(s, appt.staffId)),
    });
    setTab("billing");
  }, [services]);

  // Once the bill is saved, stamp the link both ways: the appointment closes as completed and
  // remembers its bill, and the bill remembers the appointment. Without the back-link a
  // "Complete → Bill" could be run twice and bill the customer twice.
  const linkBillToAppointment = useCallback((appointmentId, billId) => {
    setAppointments((list) => list.map((a) => (a.id === appointmentId ? { ...a, status: "completed", billId } : a)));
  }, []);

  const lowStock = items.filter((i) => i.stock <= i.lowAt);
  const alertCount = lowStock.length + items.filter((i) => { const d = daysToExpiry(i); return d != null && d <= 30; }).length;

  // The rails this role actually sees. Hiding a tab is a convenience, not the control — the
  // render switch below re-checks every gated view with can(), because `tab` is just state and
  // could be set to anything.
  const myTopTabs = useMemo(() => TOP_TABS.filter((t) => tabAllowed(role, perms, t)), [role, perms]);
  const myOtherTabs = useMemo(() => OTHER_TABS.filter((t) => tabAllowed(role, perms, t)), [role, perms]);

  // If the active tab isn't allowed (a live demotion, an owner switching a feature off under
  // them, or a stale tab from a previous session), fall back to the dashboard rather than
  // rendering a blank main pane.
  useEffect(() => {
    const all = [...TOP_TABS, ...OTHER_TABS];
    const current = all.find(([k]) => k === tab);
    if (current && !tabAllowed(role, perms, current)) setTab("dashboard");
  }, [role, perms, tab]);

  // Show the "Other" sub-list when the user toggled it open, or whenever an active tab
  // lives inside it (so the current page is never hidden behind a collapsed group).
  const showOther = otherOpen || myOtherTabs.some(([k]) => k === tab);

  // ---- shell shape ----
  // The ONE place the app needs different markup rather than restyled markup: a phone swaps the
  // sidebar for a bottom bar. Everything else responsive is CSS — a tablet now gets the same
  // full, labelled rail as a laptop. (In jsdom matchMedia always reports false, so tests keep
  // rendering the original desktop shell.)
  const isPhone = useMediaQuery(MQ.phone);
  const updateReady = useUpdateReady();
  // The sidebar-as-drawer, on a phone only: it slides the whole labelled rail in over the page
  // and cannot stay pinned, because 210px of a 360px screen leaves the till 150px to work in.
  const [railOpen, setRailOpen] = useState(false);
  const drawerBand = isPhone;

  // A count that rides on a nav entry. Centralised because the same number has to appear in
  // three places — the rail, the bottom bar, and (aggregated) on "More" when the badged tab
  // isn't one of the four the bar could fit — and three copies of this ternary would drift.
  const tabBadge = useCallback(
    (k) => (k === "inventory" ? lowStock.length : k === "alerts" && tabEnabled("alerts") ? alertCount : 0),
    [lowStock.length, alertCount]
  );

  // The four slots on the bottom bar, in front-of-house order. A role that lacks one of these
  // (a biller has no Customers) gets its next rail entry promoted instead of a dead slot, so the
  // bar is always four wide and never offers something the role can't open.
  const phoneTabs = useMemo(() => {
    const byKey = new Map(myTopTabs.map((t) => [t[0], t]));
    const picked = PHONE_BAR_TABS.map((k) => byKey.get(k)).filter(Boolean);
    for (const t of myTopTabs) {
      if (picked.length >= 4) break;
      if (!picked.includes(t)) picked.push(t);
    }
    return picked.slice(0, 4);
  }, [myTopTabs]);
  const onBar = new Set(phoneTabs.map(([k]) => k));
  // What the bottom bar couldn't fit. Only used for the aggregate badge and for lighting "More"
  // when the current screen is one of them — the drawer itself always lists the full sidebar,
  // because a drawer that showed a subset would be a second, competing navigation.
  const offBarTabs = [...myTopTabs.filter(([k]) => !onBar.has(k)), ...myOtherTabs];
  const moreBadge = offBarTabs.reduce((n, [k]) => n + tabBadge(k), 0);

  // Close the drawer when the viewport grows past both bands that have one — otherwise rotating
  // a phone to landscape leaves an expanded rail stranded over a desktop layout, covering the
  // content with no visible way back.
  useEffect(() => { if (!drawerBand) setRailOpen(false); }, [drawerBand]);

  // While the drawer is open the page behind it must not scroll: on iOS a swipe that starts on
  // the drawer otherwise scrolls the document underneath and the drawer appears to drift away.
  // Escape closes it, which is also what makes it dismissable without a pointer.
  useEffect(() => {
    if (!railOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setRailOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [railOpen]);

  // Opening the drawer on a phone expands the "Other" group. The rail collapses it on a desktop
  // to keep the sidebar short, but a full-height drawer has the room — and leaving it shut would
  // put a secondary screen three taps away (More → Other → Vendor Bills), which is further than
  // it was before the sidebar came back. Setting the state rather than forcing it in the render
  // keeps the group's own chevron working.
  useEffect(() => { if (railOpen && isPhone) setOtherOpen(true); }, [railOpen, isPhone]);

  // Picking a tab closes the drawer — a nav that stays open over the page it just navigated to
  // reads as a stuck menu.
  const goTab = useCallback((k) => { setTab(k); setRailOpen(false); }, []);

  // ---- the render switch, with a permission guard on every gated view ----
  // `guard` is the second enforcement layer. The nav already hides what a role can't reach, but
  // `tab` is ordinary state: hiding a button is not a control. Each branch names the SAME action
  // its nav entry declares, so a tab and its view can never drift out of step.
  const guard = (action, node) => (allow(action) ? node : <NoAccess role={role} />);
  // The owner's dashboard is the shop's books — revenue, profit, margins, stock value. A worker
  // gets a different screen entirely (their diary + their own bills), rather than the same one
  // with pieces blanked out: an emptied-out books page reads as broken, not as "not for you".
  const dashboard = allow("stats.view") ? (
    <Dashboard
      items={items} sales={sales} lowStock={lowStock} goBilling={() => setTab("billing")}
      appointments={appointments} customers={customers} staff={staff} services={services}
      goAppointments={() => setTab("appointments")}
    />
  ) : (
    <WorkerDashboard
      sales={sales} appointments={appointments} customers={customers} staff={staff}
      services={services} user={user}
      goBilling={() => setTab("billing")} goAppointments={() => setTab("appointments")}
    />
  );
  // Every setter handed to a view is the ONLINE-GUARDED version (writers.*), so any write the UI
  // attempts while offline is refused and raises the offline modal. Reads stay live. Billing also
  // gets guardOnline directly so it can refuse a sale up-front, before printing or clearing the cart.
  const VIEWS = {
    dashboard: () => dashboard,
    appointments: () => guard("appointments.view", <Appointments appointments={appointments} setAppointments={writers.appointments} customers={customers} setCustomers={writers.customers} services={services} staff={staff} config={config} notify={notify} log={addLog} role={role} perms={perms} onCompleteToBill={completeToBill} />),
    billing: () => guard("billing.use", <Billing items={items} sales={sales} services={services} staff={staff} customers={customers} customerPackages={customerPackages} config={config} setItems={writers.items} setSales={writers.sales} setCustomers={writers.customers} store={store} notify={notify} log={addLog} role={role} perms={perms} user={user} guardOnline={guardOnline} prefill={billPrefill} onPrefillUsed={() => setBillPrefill(null)} onBilled={linkBillToAppointment} />),
    customers: () => guard("customers.browse", <Customers customers={customers} sales={sales} services={services} staff={staff} customerPackages={customerPackages} config={config} store={store} setCustomers={writers.customers} notify={notify} log={addLog} />),
    reminders: () => guard("reminders.use", <Reminders customers={customers} setCustomers={writers.customers} sales={sales} services={services} customerPackages={customerPackages} messageTemplates={messageTemplates} setMessageTemplates={writers.messageTemplates} store={store} notify={notify} log={addLog} role={role} perms={perms} />),
    services: () => guard("services.manage", <Services services={services} setServices={writers.services} items={items} notify={notify} log={addLog} />),
    packages: () => guard("packages.manage", <Packages packages={packages} setPackages={writers.packages} customerPackages={customerPackages} setCustomerPackages={writers.customerPackages} services={services} customers={customers} setCustomers={writers.customers} setSales={writers.sales} notify={notify} log={addLog} />),
    staff: () => guard("staff.manage", <Staff staff={staff} setStaff={writers.staff} sales={sales} appointments={appointments} store={store} notify={notify} log={addLog} />),
    raw: () => guard("import.use", <RawData items={items} setItems={writers.items} setSales={writers.sales} setExpenses={writers.expenses} notify={notify} log={addLog} />),
    inventory: () => guard("inventory.view", <Inventory items={items} setItems={writers.items} notify={notify} log={addLog} cats={cats} onAddCategory={addCategory} role={role} />),
    alerts: () => guard("alerts.view", <Alerts items={items} goInventory={() => setTab("inventory")} cats={cats} />),
    barcode: () => guard("barcode.use", <BarcodeCreator items={items} setItems={writers.items} store={store} notify={notify} log={addLog} />),
    sales: () => guard("sales.view", <SalesHistory sales={sales} items={items} staff={staff} services={services} customerPackages={customerPackages} setSales={writers.sales} setItems={writers.items} store={store} notify={notify} log={addLog} role={role} perms={perms} guardOnline={guardOnline} />),
    finance: () => (tabEnabled("finance") ? guard("finance.view", <Finance sales={sales} expenses={expenses} />) : dashboard),
    stats: () => guard("stats.view", <Stats sales={sales} expenses={expenses} items={items} customers={customers} appointments={appointments} />),
    udhari: () => guard("udhari.manage", <Udhari sales={sales} setSales={writers.sales} notify={notify} log={addLog} />),
    expense: () => guard("expenses.manage", <Expenses expenses={expenses} setExpenses={writers.expenses} notify={notify} log={addLog} />),
    vendorbills: () => guard("vendorBills.manage", <VendorBills bills={bills} setBills={writers.bills} setDailyBills={writers.dailyBills} online={online} notify={notify} log={addLog} />),
    logs: () => guard("logs.view", <Logs logs={logs} setLogs={writers.logs} notify={notify} />),
    changelog: () => <Changelog />,
    settings: () => guard("settings.manage", <StoreConfig config={config} setConfig={writers.config} notify={notify} log={addLog} user={user} role={role} perms={perms} />),
    admin: () => guard("settings.manage", <Admin setItems={writers.items} setSales={writers.sales} setExpenses={writers.expenses} setLogs={writers.logs} sales={sales} customers={customers} setCustomers={writers.customers} customerPackages={customerPackages} setCustomerPackages={writers.customerPackages} config={config} user={user} notify={notify} log={addLog} />),
  };
  const view = (VIEWS[tab] || VIEWS.dashboard)();

  // The foot of the sidebar, written once and rendered in two places — at the bottom of the rail
  // on a desktop, and inside the "More" sheet on a phone. Duplicating this markup is how the two
  // would quietly drift apart (a new backup format added to one and not the other).
  const backupBlock = ({ first }) => (
    // `marginTop:auto` pushes the block to the foot of the rail; inside the sheet there is no
    // free space to push into, and doing it there would leave a gap above the actions.
    <div className="navutil" style={{ marginTop: first ? "auto" : 4, padding: "8px 8px 4px" }}>
      <div className="navgrouplabel" style={{ fontSize: 10.5, color: "#6E8A7C", textTransform: "uppercase", letterSpacing: ".06em", padding: "0 6px 4px" }}>Backup</div>
      <div className="navrow">
        <button className="navbtn util" onClick={() => exportData("json")}>⬇ JSON</button>
        <button className="navbtn util" onClick={() => exportData("xlsx")}>⬇ XLSX</button>
      </div>
      <label className="navbtn util" style={{ cursor: "pointer", marginTop: 6 }}>
        ⬆ Restore (JSON / XLSX)
        <input type="file" accept=".json,.xlsx,.xls,application/json" onChange={importData} style={{ display: "none" }} />
      </label>
    </div>
  );
  // display/gap come from the .navrow class rather than from an inline style, so the collapsed
  // tablet rail can hide the whole block with CSS. An inline `display:flex` would outrank it.
  const accountBlock = ({ pushDown }) => (
    <div className="navutil navrow" style={{ padding: "8px 8px 4px", marginTop: pushDown ? "auto" : 0 }}>
      <button className="navbtn util" onClick={resetMyPassword}>🔑 Reset</button>
      <button className="navbtn util" onClick={onLogout}>⎋ Logout</button>
    </div>
  );
  const statusFoot = (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: online ? "#3FB873" : "#C9803A", display: "inline-block" }} />
        {online ? "Online · syncing live" : "Offline · saved on this device"}
      </span>
      <br />
      {user?.email ? <>Signed in as {user.email} · {ROLE_LABELS[role]}.<br /></> : null}
      {allow("backup.use") ? "Back up regularly." : null}
    </>
  );

  return (
    <div className="app" data-theme={store.iconStyle} style={{ ...S.app, ...themeVars(store.theme) }}>
      <style>{CSS + SERVICE_ICON_CSS}</style>
      {/* The service-icon gradients, mounted once for the whole app. Only under the glass theme:
          the flat theme strokes in the current text colour and never references them. */}
      {store.iconStyle === "advanced" && <ServiceIconDefs />}
      {/* ── sidebar ──
          ONE element across every band, so a nav entry is written once and only its presentation
          changes. Tablet and up: the full labelled rail, identical everywhere. Phone: hidden
          until data-open, then that same rail as a drawer — it can't stay pinned open, because
          ${RAIL_WIDTH}px of a 360px screen leaves the till 150px to work in. */}
      <nav className="nav" style={S.nav} data-open={railOpen ? "1" : "0"}>
        {/* Shown by CSS on the phone drawer only, which needs a visible close. (The scrim closes
            it too, but a scrim is not keyboard-reachable and not obvious.) */}
        <button
          className="navbtn railtoggle"
          onClick={() => setRailOpen((o) => !o)}
          aria-expanded={railOpen}
          aria-label={railOpen ? "Close menu" : "Expand menu"}
          title={railOpen ? "Close menu" : "Expand menu"}
        >{railOpen ? "✕" : "☰"}</button>
        <div style={S.logo}>
          <img src={store.logo || LOGO_SRC} alt={store.name} style={{ width: 42, height: 42, borderRadius: 10, objectFit: "contain", background: "#fff", padding: 2, flexShrink: 0 }} />
          <div className="navshop">
            <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-0.02em" }}>{store.name}</div>
            <div style={{ fontSize: 10.5, color: "#9DB5A8", lineHeight: 1.3 }}>{store.address}</div>
          </div>
        </div>
        {myTopTabs.map(([k, ic, label]) => (
          <NavButton key={k} icon={ic} label={label} active={tab === k} badge={tabBadge(k)} onClick={() => goTab(k)} />
        ))}
        {/* "Other" group — collapses the secondary sections. Auto-opens when one of its
            tabs is active so the current page is always visible in the rail. Hidden outright
            when this role has nothing in it, rather than left as an empty dead-end. */}
        {myOtherTabs.length > 0 && (
          <button
            className={"navbtn" + (showOther ? " active" : "")}
            onClick={() => setOtherOpen((o) => !o)}
            aria-expanded={showOther}
            title="Other"
          >
            <span className="navico" style={{ width: 22, display: "inline-block", textAlign: "center" }}>⋯</span>
            <span className="navlabel">Other</span>
            <span className="navchev" style={{ marginLeft: "auto", fontSize: 11, opacity: 0.8 }}>{showOther ? "▾" : "▸"}</span>
            {!showOther && tabEnabled("alerts") && alertCount > 0 && <span className="badge-n" style={S.badge}>{alertCount}</span>}
          </button>
        )}
        {showOther && myOtherTabs.map(([k, ic, label]) => (
          <NavButton key={k} icon={ic} label={label} active={tab === k} badge={tabBadge(k)} sub onClick={() => goTab(k)} />
        ))}
        {/* Backup/Restore is owner-only: a restore rewrites the whole tree, and an export
            hands the entire salon's books to whoever is holding the phone. */}
        {allow("backup.use") && backupBlock({ first: true })}
        {/* Pushes the footer down when the Backup block above (which normally carries the
            margin-top:auto) is hidden for this role. */}
        {accountBlock({ pushDown: !allow("backup.use") })}
        <div className="navfoot" style={{ fontSize: 11, color: "#6E8A7C", padding: "6px 14px 8px" }}>{statusFoot}</div>
      </nav>
      {/* Scrim behind the open drawer, on a phone: the rail overlays the page, so a tap
          anywhere else has to put it away again. */}
      {railOpen && drawerBand && (
        <div className="rail-scrim" onClick={() => setRailOpen(false)} aria-hidden="true" />
      )}

      {/* ── phone top bar ──
          Carries the ☰ that opens the sidebar, the shop's identity (which the bottom bar has no
          room for), and the at-a-glance sync light so the pill at the bottom isn't the only
          place it lives. */}
      {isPhone && (
        <header className="topbar">
          <button
            className="topbtn"
            onClick={() => setRailOpen((o) => !o)}
            aria-expanded={railOpen}
            aria-label={railOpen ? "Close menu" : "Open menu"}
          >☰</button>
          <img src={store.logo || LOGO_SRC} alt="" aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 8, objectFit: "contain", background: "#fff", padding: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{store.name}</div>
          </div>
          <span
            title={online ? "Online · syncing live" : "Offline · saved on this device"}
            style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: online ? "#3FB873" : "#C9803A" }}
          />
        </header>
      )}

      {/* main */}
      <main className={"main" + (tab === "appointments" ? " wide" : "")} style={S.main}>
        {/* Two different waits, told apart on purpose: "Loading salon data…" is the first
            snapshot arriving, the Suspense fallback is this screen's chunk arriving. Both use
            the same one-line affordance, so a slow tablet shows one steady message either way. */}
        {!loaded ? <div style={{ padding: 40, color: "#667" }}>Loading salon data…</div> : (
          <Suspense fallback={<div style={{ padding: 40, color: "#667" }}>Loading…</div>}>{view}</Suspense>
        )}
      </main>

      {/* ── phone bottom bar ──
          Four tabs plus "More", pinned within thumb reach. "More" opens the SAME drawer the ☰
          does, rather than a second list of its own: two overlays showing overlapping sets of
          the same tabs is how they drift apart, and the sidebar is already the complete answer.
          Its badge aggregates the counts of every tab the bar couldn't fit, so a low-stock
          warning is never invisible just because Inventory didn't make the four. */}
      {isPhone && (
        <nav className="tabbar" aria-label="Main">
          {phoneTabs.map(([k, ic, label]) => (
            <button
              key={k}
              className={"tabbtn" + (tab === k ? " active" : "")}
              onClick={() => goTab(k)}
              aria-current={tab === k ? "page" : undefined}
            >
              <span className="tabico" aria-hidden="true">{ic}</span>
              <span className="tablabel">{PHONE_TAB_LABELS[k] || label}</span>
              {tabBadge(k) > 0 && <span className="tabbadge">{tabBadge(k)}</span>}
            </button>
          ))}
          <button
            className={"tabbtn" + (railOpen || offBarTabs.some(([k]) => k === tab) ? " active" : "")}
            onClick={() => setRailOpen((o) => !o)}
            aria-expanded={railOpen}
            aria-label={railOpen ? "Close menu" : "Open menu"}
          >
            <span className="tabico" aria-hidden="true">⋯</span>
            <span className="tablabel">More</span>
            {!railOpen && moreBadge > 0 && <span className="tabbadge">{moreBadge}</span>}
          </button>
        </nav>
      )}

      {toast && <div className="toast" style={S.toast}>{toast}</div>}

      {/* Connection status on every screen, and the hard-stop popup when a write is tried offline. */}
      <ConnBadge online={online} />
      {/* A newer build has finished downloading in the background. Deliberately an offer, not
          an interruption: the salon takes it between customers. Never shown on a first install
          or in dev — nothing registers a worker there. */}
      {updateReady && <UpdateBadge onReload={applyUpdate} />}
      {offlineBlock && <OfflineBlockModal onClose={() => setOfflineBlock(false)} />}
    </div>
  );
}
