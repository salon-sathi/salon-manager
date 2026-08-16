// StoreConfig — extracted from salon-manager.jsx.

import { isValidUpiId } from "../components/receipt.jsx";
import { DEFAULT_HOURS, parseHM, toHM } from "../lib/appointments.js";
import { featureOn } from "../lib/features.js";
import { ACTION_LABELS, CONFIGURABLE_ROLES, FEATURE_GROUPS, GRANTABLE, LOCKED_FEATURES, ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, can, roleDefaults, sanitizePermissions, validateUserChange } from "../lib/roles.js";
import { LOGO_SRC, PAYMENT_QR_SRC, imageFileToDataUrl } from "../lib/ui/assets.js";
import { ICON_STYLES, ICON_STYLE_KEYS, STORE, THEMES, THEME_KEYS, authMessage, isValidPcIp } from "../lib/ui/store.js";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { S } from "../lib/ui/css.js";
import { loyaltyRules } from "../lib/loyalty.js";
import { INR, money, todayStr } from "../lib/ui/format.js";
import { OTHER_TABS, TOP_TABS, tabAllowed, tabEnabled } from "../lib/ui/nav.js";
import { subscribeUsers, updateUser, writeUser } from "../lib/sync.js";
import { secondaryApp } from "../lib/firebase.js";
import { createUserWithEmailAndPassword, getAuth, signOut } from "firebase/auth";
import { deleteApp } from "firebase/app";
import { Empty, Field, Header } from "../components/primitives.jsx";
import { ServiceIconChip } from "../components/ServiceIcon.jsx";

// ---------- Store Settings (configurable shop identity + branding) ----------
// The shop name, tagline, address, phone, logo, payment QR and counter-PC IP that used to be
// hard-coded now live in `config` (synced at shop/config across every device). This screen edits
// a local draft and commits it via setConfig on Save; effectiveStore() layers it over the
// built-in defaults everywhere the identity is shown (sidebar, login card, printed receipt).
function StoreConfig({ config, setConfig, notify, log, user, role, perms }) {
  const toDraft = (c = {}) => ({
    name: c.name || "", tagline: c.tagline || "", address: c.address || "",
    phone: c.phone || "", pcIp: c.pcIp || "", logo: c.logo || "", paymentQr: c.paymentQr || "",
    upiId: c.upiId || "", upiName: c.upiName || "",
    // `=== true`, matching effectiveStore(): a config saved before this switch existed has no
    // such key and must read as off. Also keeps the draft a real boolean, so the dirty flag
    // (a JSON compare) doesn't trip on undefined-vs-false.
    showStaffOnReceipt: c.showStaffOnReceipt === true,
    theme: THEMES[c.theme] ? c.theme : "emerald",
    iconStyle: ICON_STYLES[c.iconStyle] ? c.iconStyle : STORE.iconStyle,
    // Working hours bound the appointment grid — a booking outside them renders off-screen.
    openTime: c.openTime || toHM(DEFAULT_HOURS.openMin),
    closeTime: c.closeTime || toHM(DEFAULT_HOURS.closeMin),
  });
  const [draft, setDraft] = useState(() => toDraft(config));
  const [busyKey, setBusyKey] = useState(""); // "logo" | "paymentQr" while an upload is processed
  const savedRef = useRef(JSON.stringify(toDraft(config))); // last-saved snapshot (drives the dirty flag)
  const dirty = JSON.stringify(draft) !== savedRef.current;

  // Adopt an incoming cloud config (edited on another device) — but never clobber unsaved local
  // edits: only reset the draft when it still matches the last snapshot we saved/loaded.
  useEffect(() => {
    setDraft((d) => (JSON.stringify(d) === savedRef.current ? toDraft(config) : d));
    savedRef.current = JSON.stringify(toDraft(config));
  }, [config]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const onImage = async (e, key, maxDim) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a remove
    if (!f) return;
    setBusyKey(key);
    try {
      set(key, await imageFileToDataUrl(f, maxDim));
    } catch (err) {
      console.error("image read failed", err);
      notify("⚠ " + (err.message || "Couldn't read that image"));
    } finally {
      setBusyKey("");
    }
  };

  const save = () => {
    if (draft.pcIp.trim() && !isValidPcIp(draft.pcIp)) {
      return notify("⚠ Enter a valid IP like 192.168.1.50 (or 192.168.1.50:9100), or leave it blank");
    }
    if (draft.upiId.trim() && !isValidUpiId(draft.upiId)) {
      return notify("⚠ Enter a valid UPI ID like mysalon@okhdfcbank, or leave it blank");
    }
    const open = parseHM(draft.openTime);
    const close = parseHM(draft.closeTime);
    if (!Number.isFinite(open) || !Number.isFinite(close)) return notify("⚠ Enter valid opening and closing times");
    // A closing time at or before opening would produce a zero/negative-height diary — no rows,
    // no way to book anything, and no obvious cause.
    if (close <= open) return notify("⚠ Closing time must be after opening time");
    // Spread the existing config first: shop/config is a shared singleton that holds more than
    // this form edits (loyaltyConfig lives here too). Rebuilding it from the draft alone would
    // silently wipe whatever this form doesn't know about.
    const next = {
      ...config,
      name: draft.name.trim(), tagline: draft.tagline.trim(), address: draft.address.trim(),
      phone: draft.phone.trim(), pcIp: draft.pcIp.trim(), logo: draft.logo || "", paymentQr: draft.paymentQr || "",
      upiId: draft.upiId.trim(), upiName: draft.upiName.trim(),
      showStaffOnReceipt: !!draft.showStaffOnReceipt,
      theme: THEMES[draft.theme] ? draft.theme : "emerald",
      iconStyle: ICON_STYLES[draft.iconStyle] ? draft.iconStyle : STORE.iconStyle,
      openTime: toHM(open), closeTime: toHM(close),
    };
    const snap = toDraft(next);
    savedRef.current = JSON.stringify(snap);
    setDraft(snap);
    setConfig(next);
    log?.("settings", "Updated salon settings");
    notify("✓ Salon settings saved");
  };

  const resetDefaults = () => {
    if (!confirm("Reset the salon's identity settings back to the app defaults? A custom logo and payment QR will be removed.")) return;
    const snap = toDraft({});
    savedRef.current = JSON.stringify(snap);
    setDraft(snap);
    // Blank only the identity fields this form owns; anything else in the singleton (loyalty
    // rules, and whatever a later version adds) is untouched. "Reset settings" must not quietly
    // reset the loyalty scheme the salon's customers have points under.
    setConfig((c) => ({ ...c, ...toDraft({}) }));
    log?.("settings", "Reset salon identity settings to defaults");
    notify("Salon settings reset to defaults");
  };

  const kb = (dataUrl) => (dataUrl ? Math.round(dataUrl.length / 1024) : 0);

  // A logo / QR uploader with live preview, size read-out, and a "use default" reset.
  const ImageField = ({ label, keyName, maxDim, fallback, hint }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#465", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <img
          src={draft[keyName] || fallback}
          alt={label}
          style={{ width: 64, height: 64, borderRadius: 10, objectFit: "contain", background: "#fff", border: "1px solid #E2EAE3", padding: 3, flexShrink: 0 }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <label className="btn small ghost" style={{ cursor: "pointer" }}>
              {busyKey === keyName ? "Processing…" : draft[keyName] ? "Replace…" : "Upload…"}
              <input type="file" accept="image/*" onChange={(e) => onImage(e, keyName, maxDim)} style={{ display: "none" }} disabled={busyKey === keyName} />
            </label>
            {draft[keyName] && (
              <button className="btn small ghost" onClick={() => set(keyName, "")}>Use default</button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 5 }}>
            {draft[keyName] ? `Custom image · ~${kb(draft[keyName])} KB` : "Using the built-in default"}
            {hint ? <> · {hint}</> : null}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <Header title="Salon Settings" sub="Salon name, address, logo and other details used across the app and on printed receipts.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dirty && <span style={{ fontSize: 12, color: "#C9803A", fontWeight: 600 }}>Unsaved changes</span>}
          <button className="btn ghost" onClick={resetDefaults}>Reset to defaults</button>
          <button className="btn primary big" onClick={save} disabled={!dirty}>Save settings</button>
        </div>
      </Header>

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <section style={S.panel}>
          <div style={S.panelHead}>Shop identity</div>
          <Field label="Shop name"><input className="input" value={draft.name} placeholder={STORE.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Tagline"><input className="input" value={draft.tagline} placeholder={STORE.tagline} onChange={(e) => set("tagline", e.target.value)} /></Field>
          <Field label="Address"><textarea className="input" rows={3} style={{ resize: "vertical" }} value={draft.address} placeholder={STORE.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Phone"><input className="input" type="tel" value={draft.phone} placeholder="e.g. +91 98765 43210" onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Shop PC IP address">
              <input className="input" value={draft.pcIp} placeholder="e.g. 192.168.1.50" onChange={(e) => set("pcIp", e.target.value)} />
            </Field>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: -2 }}>
            The counter PC's address on the shop's local network — used to reach a local print server / POS on that machine.
            Accepts a plain IPv4, optionally with a port (e.g. <code>192.168.1.50:9100</code>).
          </div>

          <div style={{ ...S.panelHead, marginTop: 16 }}>Working hours</div>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Opens at"><input className="input" type="time" step={900} value={draft.openTime} onChange={(e) => set("openTime", e.target.value)} /></Field>
            <Field label="Closes at"><input className="input" type="time" step={900} value={draft.closeTime} onChange={(e) => set("closeTime", e.target.value)} /></Field>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: -2 }}>
            These bound the appointment grid: it runs from opening to closing in 15-minute rows,
            and a booking outside them is refused rather than rendered off-screen.
          </div>
        </section>

        <section style={S.panel}>
          <div style={S.panelHead}>Branding &amp; receipt</div>
          <ImageField label="Shop logo" keyName="logo" maxDim={240} fallback={LOGO_SRC} hint="shown in the sidebar, on the sign-in card and at the top of receipts" />

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="UPI ID (amount QR)">
              <input className="input" value={draft.upiId} placeholder="e.g. mysalon@okhdfcbank" onChange={(e) => set("upiId", e.target.value)} />
            </Field>
            <Field label="Payee name (UPI)">
              <input className="input" value={draft.upiName} placeholder={draft.name.trim() || STORE.name} onChange={(e) => set("upiName", e.target.value)} />
            </Field>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", margin: "-2px 0 14px", lineHeight: 1.5 }}>
            Set your UPI ID and the billing screen &amp; receipt show a QR that <b>already contains the bill amount</b> — the customer scans and pays without typing. Payee name is optional (defaults to the shop name). Leave the UPI ID blank to use the fixed image below instead.
          </div>

          <ImageField label="Payment QR image (fallback)" keyName="paymentQr" maxDim={480} fallback={PAYMENT_QR_SRC} hint="used on receipts only when no UPI ID is set" />
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 4, lineHeight: 1.5 }}>
            Images are automatically resized and stored with your shop data, so they sync to every signed-in device. Leave a field on “default” to keep the bundled image.
          </div>

          {/* Off by default — the receipt is the only copy that leaves the shop, and who did the
              work is kept internally regardless (Sales history, visit history, payouts). */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 16, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={draft.showStaffOnReceipt}
              onChange={(e) => set("showStaffOnReceipt", e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--accent, var(--brand))" }}
            />
            <span>Show the stylist’s name on the customer’s bill</span>
          </label>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 5, lineHeight: 1.5 }}>
            Prints <b>by &lt;name&gt;</b> under each service on the printed and WhatsApp receipt — turn it on if you want customers to know who to ask for next time. <b>Off by default.</b> Either way the stylist stays on the bill internally: Sales history, the customer’s visit history and staff payouts are unaffected.
          </div>
        </section>
      </div>

      <section style={{ ...S.panel, marginTop: 16 }}>
        <div style={S.panelHead}>Colour theme</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {THEME_KEYS.map((key) => {
            const t = THEMES[key];
            const active = draft.theme === key;
            return (
              <button
                key={key} type="button" onClick={() => set("theme", key)} aria-pressed={active}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12,
                  border: active ? `2px solid ${t.swatch[1]}` : "1.5px solid #DDE8DE",
                  background: "var(--surface, #fff)", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                }}
              >
                <span style={{ display: "flex", borderRadius: 8, overflow: "hidden", flexShrink: 0, border: "1px solid rgba(0,0,0,.1)", boxShadow: "0 1px 3px rgba(0,0,0,.12)" }}>
                  <span style={{ width: 22, height: 30, background: t.swatch[0] }} />
                  <span style={{ width: 14, height: 30, background: t.swatch[1] }} />
                </span>
                <span style={{ fontSize: 13.5, fontWeight: active ? 800 : 600, color: "var(--text-hi, #25342C)" }}>{t.label}</span>
                {active && <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 900, color: t.swatch[1] }}>✓</span>}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 10, lineHeight: 1.5 }}>
          Sets the sidebar and accent colours across the whole app, for every signed-in device. Pick one, then <b>Save settings</b> to apply it. Charts and printed receipts keep their own colours for clarity.
        </div>

        {/* Appearance — the whole-app skin (data-theme). Each option previews itself: the button
            carries its own data-theme, so the "Advanced" tile really is dark glass with gilded
            chips, and "Basic" really is the flat light look, whichever skin the app is wearing. */}
        <div style={{ ...S.panelHead, marginTop: 18 }}>Appearance</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ICON_STYLE_KEYS.map((key) => {
            const active = draft.iconStyle === key;
            return (
              <button
                key={key} type="button" onClick={() => set("iconStyle", key)} aria-pressed={active}
                data-theme={key}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, minHeight: 44,
                  border: active ? "2px solid var(--accent, var(--brand))" : "1.5px solid var(--border, #DDE8DE)",
                  // backgroundColor, not `background` — see the note on S.app. This preview tile
                  // is the appearance picker itself, so it of all things has to show the real
                  // ground colour of the theme it is offering.
                  backgroundColor: "var(--bg-base, #fff)", backgroundImage: "var(--bg-gradient, none)",
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left", flex: "1 1 200px",
                }}
              >
                <span style={{ display: "flex", gap: 5 }}>
                  <ServiceIconChip icon="haircut" size={30} />
                  <ServiceIconChip icon="facial" size={30} />
                  <ServiceIconChip icon="spa" size={30} />
                </span>
                <span>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: active ? 800 : 600, color: "var(--text-hi, #25342C)" }}>
                    {ICON_STYLES[key].label}{key === "advanced" ? " ✨" : ""}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)" }}>{ICON_STYLES[key].hint}</span>
                </span>
                {active && <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 900, color: "var(--accent, var(--brand))" }}>✓</span>}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 8, lineHeight: 1.5 }}>
          Sets the look of the whole app on <b>every</b> signed-in device — the backdrop, panels, buttons and the service icons. <b>Advanced</b> is a dark, glass finish; <b>Basic</b> is the classic bright, flat look. Printed receipts stay plain black-on-white whichever you pick.
        </div>
      </section>

      <section style={{ ...S.panel, marginTop: 16 }}>
        <div style={S.panelHead}>Receipt preview</div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <img src={draft.logo || LOGO_SRC} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "contain", background: "#fff", border: "1px solid #E2EAE3", padding: 3 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{draft.name.trim() || STORE.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)", whiteSpace: "pre-line" }}>{draft.address.trim() || STORE.address}</div>
            {draft.phone.trim() && <div style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)" }}>☎ {draft.phone.trim()}</div>}
          </div>
        </div>
      </section>

      {can(role, "loyalty.configure", perms) && <LoyaltyConfig config={config} setConfig={setConfig} notify={notify} log={log} />}
      {can(role, "users.manage", perms) && <Users user={user} notify={notify} log={log} />}
      {can(role, "users.manage", perms) && <RoleFeatures config={config} setConfig={setConfig} notify={notify} log={log} />}
    </div>
  );
}

// ---------- Settings → Loyalty (owner only) ----------
// The rules behind every point the salon hands out. Edited rarely, but the numbers here are
// live: change the earn rate and the next bill earns at the new rate. Past bills keep the
// points they were actually given — the ledger is the bills, so history can't be rewritten
// from this screen.
function LoyaltyConfig({ config, setConfig, notify, log }) {
  const current = useMemo(() => loyaltyRules(config), [config]);
  const [draft, setDraft] = useState(() => ({
    enabled: current.enabled,
    earnRate: String(current.earnRate),
    redeemValue: String(current.redeemValue),
    minRedeemPoints: String(current.minRedeemPoints),
    maxRedeemPctOfBill: String(current.maxRedeemPctOfBill),
    silver: String(current.tiers.silver),
    gold: String(current.tiers.gold),
    platinum: String(current.tiers.platinum),
  }));
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const n = (v) => Number(v);

  const save = () => {
    const earnRate = n(draft.earnRate), redeemValue = n(draft.redeemValue);
    const minRedeemPoints = n(draft.minRedeemPoints), maxRedeemPctOfBill = n(draft.maxRedeemPctOfBill);
    const silver = n(draft.silver), gold = n(draft.gold), platinum = n(draft.platinum);
    if ([earnRate, redeemValue, minRedeemPoints, maxRedeemPctOfBill, silver, gold, platinum].some((x) => !Number.isFinite(x) || x < 0)) {
      return notify("⚠ Every field must be a number, and none can be negative.");
    }
    if (maxRedeemPctOfBill > 100) return notify("⚠ The redemption cap can't be more than 100% of a bill.");
    // Out-of-order thresholds would make a tier unreachable: nobody can be Gold if Gold needs
    // more spend than Platinum.
    if (!(silver <= gold && gold <= platinum)) return notify("⚠ Tier thresholds must go up: Silver ≤ Gold ≤ Platinum.");
    setConfig((c) => ({
      ...c,
      loyaltyConfig: {
        enabled: draft.enabled, earnRate, redeemValue, minRedeemPoints, maxRedeemPctOfBill,
        tiers: { silver, gold, platinum },
      },
    }));
    log?.("settings", `Updated loyalty rules — ${earnRate} pt/₹100, ₹${redeemValue}/pt, cap ${maxRedeemPctOfBill}%`);
    notify("✓ Loyalty rules saved");
  };

  // Spell the rule out in plain money, because "1 point per ₹100 at ₹1 a point" is not
  // something anyone should have to do arithmetic on to understand what they're giving away.
  const pctBack = n(draft.earnRate) * n(draft.redeemValue);
  const example = money(2000 * (pctBack / 100) / 100 * 100) || 0;

  return (
    <section style={{ ...S.panel, marginTop: 16 }}>
      <div style={S.panelHead}>Loyalty points</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>Give customers points on their bills</span>
      </label>

      {draft.enabled && (
        <>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Points earned per ₹100 spent"><input className="input" inputMode="decimal" value={draft.earnRate} onChange={(e) => set("earnRate", e.target.value)} /></Field>
            <Field label="A point is worth (₹)"><input className="input" inputMode="decimal" value={draft.redeemValue} onChange={(e) => set("redeemValue", e.target.value)} /></Field>
            <Field label="Minimum points to redeem"><input className="input" inputMode="numeric" value={draft.minRedeemPoints} onChange={(e) => set("minRedeemPoints", e.target.value)} /></Field>
            <Field label="Most a bill can be paid with points (%)"><input className="input" inputMode="decimal" value={draft.maxRedeemPctOfBill} onChange={(e) => set("maxRedeemPctOfBill", e.target.value)} /></Field>
          </div>
          <div style={{ background: "var(--surface-2, #F4FAF6)", border: "1px solid var(--tint-info-border, #CFE3D7)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: "var(--brand)", marginBottom: 12 }}>
            That's <b>{pctBack ? (pctBack / 100).toFixed(2) : "0"}%</b> back. A ₹2,000 bill earns{" "}
            <b>{Math.floor((2000 / 100) * n(draft.earnRate) || 0)} points</b> — worth <b>{INR(example)}</b> off a future visit.
          </div>

          <div style={S.panelHead}>Tiers <span style={{ fontWeight: 400, color: "var(--text-mid, #8A9C90)" }}>· by spend over the last 12 months</span></div>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Field label="Silver from (₹)"><input className="input" inputMode="numeric" value={draft.silver} onChange={(e) => set("silver", e.target.value)} /></Field>
            <Field label="Gold from (₹)"><input className="input" inputMode="numeric" value={draft.gold} onChange={(e) => set("gold", e.target.value)} /></Field>
            <Field label="Platinum from (₹)"><input className="input" inputMode="numeric" value={draft.platinum} onChange={(e) => set("platinum", e.target.value)} /></Field>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: -4, marginBottom: 10 }}>
            Rolling 12 months, not lifetime — a tier should say a customer is valuable <i>now</i>.
            Set a threshold to 0 to turn that tier off.
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn primary" onClick={save}>Save loyalty rules</button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 8, lineHeight: 1.6 }}>
        Changing these affects future bills only. Points already given stay as they were —
        the ledger is the bills themselves, so history can't be rewritten from here.
      </div>
    </section>
  );
}

// ---------- Settings → Feature access (owner only) ----------
// Which features each WORKER ROLE gets, on top of the built-in defaults. The owner's choices
// live at config.permissions and sync like every other setting, so switching Billing off for
// the Billers reaches their tablet without a reload.
//
// What this panel can and cannot offer is decided by roles.js GRANTABLE, not by taste:
// database.rules.json hard-codes `role === 'owner'` on the sensitive nodes, so a toggle for
// (say) Expenses would open a screen whose every read comes back permission-denied. Those
// features are listed under "Always the owner's" below WITH the reason, so the panel explains
// its own gaps rather than just looking short. See roles.js for the full argument.
//
// The owner is deliberately absent from the matrix: an owner is never restricted, which is what
// stops a setting from locking the last owner out of their own shop.
const ALL_TABS = [...TOP_TABS, ...OTHER_TABS];

// A feature whose only screen is switched off in FEATURES has nothing to grant right now —
// show no row rather than a toggle that changes nothing. Actions with no tab of their own
// (inventory.edit lives INSIDE the Inventory screen) are always live.
const actionLive = (action) => {
  const homes = ALL_TABS.filter(([, , , a]) => a === action);
  return homes.length === 0 || homes.some(([k]) => tabEnabled(k));
};

// Drop any switch that merely restates the default, so config.permissions stays a record of
// what the owner actually CHANGED. Same reason an icon is never baked into a service: a shop
// that left a feature alone keeps following the default if a later version improves it.
// Iterating GRANTABLE rather than the object's own keys puts the result in a CANONICAL key
// order. The panel's dirty check compares JSON, and a map built by ticking boxes carries its
// keys in click order while one loaded from the cloud carries them in envelope order — same
// content, different string. Ordering here makes that comparison mean what it says instead of
// happening to work because the draft is re-seeded from the sanitised value.
const pruneToChanges = (map) => {
  const out = {};
  for (const role of CONFIGURABLE_ROLES) {
    const defaults = new Set(roleDefaults(role));
    const kept = {};
    for (const action of GRANTABLE[role]) {
      const on = map?.[role]?.[action];
      if (typeof on === "boolean" && on !== defaults.has(action)) kept[action] = on;
    }
    if (Object.keys(kept).length) out[role] = kept;
  }
  return out;
};

function RoleFeatures({ config, setConfig, notify, log }) {
  const saved = useMemo(() => sanitizePermissions(config.permissions), [config.permissions]);
  const savedJson = useMemo(() => JSON.stringify(pruneToChanges(saved)), [saved]);
  const [draft, setDraft] = useState(saved);
  // Re-seed when the stored value changes — our own save echoing back, or another device.
  useEffect(() => { setDraft(saved); }, [savedJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const changes = useMemo(() => pruneToChanges(draft), [draft]);
  const dirty = JSON.stringify(changes) !== savedJson;

  const isOn = (role, action) => can(role, action, draft);
  const grantable = (role, action) => GRANTABLE[role].includes(action);
  const changed = (role, action) => Object.prototype.hasOwnProperty.call(changes[role] || {}, action);

  const toggle = (role, action) => setDraft((d) => ({
    ...d,
    [role]: { ...(d[role] || {}), [action]: !can(role, action, d) },
  }));

  const resetRole = (role) => setDraft((d) => { const next = { ...d }; delete next[role]; return next; });

  // The rows worth showing: every grantable action whose screen is actually in the app.
  const groups = useMemo(
    () => FEATURE_GROUPS
      .map((g) => ({ ...g, actions: g.actions.filter((a) => actionLive(a) && CONFIGURABLE_ROLES.some((r) => grantable(r, a))) }))
      .filter((g) => g.actions.length),
    []
  );

  // What each role would actually see once saved. Spelling the consequence out beats making the
  // owner tick sixteen boxes and then go and sign in as a biller to find out what they did.
  const preview = (role) => ALL_TABS.filter((t) => tabAllowed(role, draft, t)).map(([, , label]) => label);

  const save = () => {
    setConfig((c) => ({ ...c, permissions: changes }));
    const summary = CONFIGURABLE_ROLES
      .map((r) => `${ROLE_LABELS[r]}: ${Object.keys(changes[r] || {}).length} change(s) from default`)
      .join(", ");
    log?.("settings", `Updated worker feature access — ${summary}`);
    notify("✓ Feature access saved");
  };

  return (
    <section style={{ ...S.panel, marginTop: 16 }}>
      <div style={{ ...S.panelHead, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span>Feature access</span>
        <button className="btn primary" onClick={save} disabled={!dirty}>
          {dirty ? "Save feature access" : "Saved"}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", lineHeight: 1.6, marginBottom: 12 }}>
        Choose exactly what a <b>Biller</b> and an <b>Inventory</b> user can reach. This applies to
        everyone with that role, on every device, as soon as you save. An <b>Owner</b> always has
        everything, so there is nothing to set here for them.
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ width: "100%", minWidth: 420 }}>
          <thead>
            <tr>
              <th>Feature</th>
              {CONFIGURABLE_ROLES.map((r) => (
                <th key={r} style={{ textAlign: "center", width: 110 }}>{ROLE_LABELS[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.title}>
                <tr>
                  <td colSpan={1 + CONFIGURABLE_ROLES.length} style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-mid, #8A9C90)", background: "var(--surface-2, #F8FBF9)" }}>
                    {g.title}
                  </td>
                </tr>
                {g.actions.map((action) => {
                  const meta = ACTION_LABELS[action] || { label: action, hint: "" };
                  return (
                    <tr key={action}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)" }}>{meta.hint}</div>
                      </td>
                      {CONFIGURABLE_ROLES.map((r) => (
                        <td key={r} style={{ textAlign: "center" }}>
                          {grantable(r, action) ? (
                            <label
                              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 40, minWidth: 44, cursor: "pointer" }}
                              title={`${meta.label} — ${ROLE_LABELS[r]}`}
                            >
                              <input
                                type="checkbox" checked={isOn(r, action)} onChange={() => toggle(r, action)}
                                aria-label={`${meta.label} for ${ROLE_LABELS[r]}`}
                                style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--accent, var(--brand))" }}
                              />
                              {/* A quiet dot, not a colour change: "different from the built-in
                                  default" is useful to see but is not a warning. */}
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: changed(r, action) ? "var(--accent, var(--brand))" : "transparent" }} />
                            </label>
                          ) : (
                            <span style={{ color: "var(--text-mid, #A8B8AE)", fontSize: 13 }} title="Only an Inventory user may change stock — the database enforces that, so it can't be given to a Biller.">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
        {CONFIGURABLE_ROLES.map((r) => {
          const seen = preview(r);
          const n = Object.keys(changes[r] || {}).length;
          return (
            <div key={r} style={{ border: "1px solid var(--border, #E2EAE3)", borderRadius: 10, padding: 12, background: "var(--surface-2, #F8FBF9)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <b style={{ fontSize: 13, color: "var(--text-hi, #25342C)" }}>A {ROLE_LABELS[r]} will see</b>
                {n > 0 && (
                  <button className="btn ghost" style={{ fontSize: 11.5 }} onClick={() => resetRole(r)}>Reset to default</button>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", lineHeight: 1.6 }}>
                {seen.join(" · ")}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 6 }}>
                {n === 0 ? "Built-in default." : `${n} change${n === 1 ? "" : "s"} from the default.`}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, border: "1px solid var(--border, #E2EAE3)", borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-hi, #25342C)", marginBottom: 6 }}>
          Always the owner's — these can't be switched on for anyone
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: "var(--text-mid, #6B7E74)", lineHeight: 1.7 }}>
          {/* A line tied to a parked feature (lib/features.js) is dropped: explaining who
              may not reach a screen nobody can reach is noise, and it would be the one
              place "Udhari" survived the parking. */}
          {LOCKED_FEATURES.filter((f) => !f.feature || featureOn(f.feature)).map((f) => (
            <li key={f.what}><b>{f.what}</b> — {f.why}.</li>
          ))}
        </ul>
        <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 8, lineHeight: 1.6 }}>
          These aren't hidden by the app alone — the salon's database refuses them for anyone who
          isn't an owner. A switch here would look like it worked and then fail at the counter, so
          there isn't one.
        </div>
      </div>
    </section>
  );
}

// ---------- Settings → Users (owner only) ----------
// Day-to-day staff access is managed from here, not from the Firebase console.
//
// Adding a user has to create a real Firebase Auth account, and the client SDK signs newly
// created users straight in — which would boot the owner out of their own session mid-task. The
// standard workaround is a SECOND, throwaway app instance: create the account on that, sign it
// out, delete it. The owner's session lives on the primary app and is never touched. See
// secondaryApp() in src/lib/firebase.js.
//
// The role each user gets is written to shop/users/<uid>, which is exactly what
// database.rules.json reads back to authorise every request. This screen IS the access control.
function Users({ user, notify, log }) {
  const [users, setUsers] = useState(null); // null = still loading
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", pwd: "", role: "biller" });

  useEffect(() => subscribeUsers(
    (val) => { setUsers(val || {}); setErr(""); },
    (e) => { console.error("users read failed", e); setErr("Couldn't load the user list."); setUsers({}); }
  ), []);

  const rows = useMemo(
    () => Object.entries(users || {}).sort((a, b) =>
      // Owners first, then alphabetically — the list reads as a hierarchy.
      (a[1].role === "owner" ? 0 : 1) - (b[1].role === "owner" ? 0 : 1) ||
      String(a[1].email || "").localeCompare(String(b[1].email || ""))
    ),
    [users]
  );

  const addUser = async () => {
    const email = form.email.trim().toLowerCase();
    const name = form.name.trim();
    if (!email || !form.pwd) return setErr("Email and password are both required.");
    if (form.pwd.length < 6) return setErr("Firebase requires a password of at least 6 characters.");
    if (rows.some(([, u]) => String(u.email || "").toLowerCase() === email)) {
      return setErr("That email is already on the team.");
    }
    setBusy(true); setErr("");
    let secondary = null;
    try {
      // Create the account on a throwaway app so the owner's session survives.
      secondary = secondaryApp();
      const cred = await createUserWithEmailAndPassword(getAuth(secondary), email, form.pwd);
      await writeUser(cred.user.uid, {
        email, name, role: form.role, active: true, createdAt: todayStr(),
      });
      await signOut(getAuth(secondary));
      log?.("settings", `Added user ${email} (${ROLE_LABELS[form.role]})`);
      notify(`✓ ${email} can now sign in as ${ROLE_LABELS[form.role]}`);
      setForm({ email: "", name: "", pwd: "", role: "biller" });
      setAdding(false);
    } catch (e) {
      console.error("add user failed", e);
      setErr(
        e?.code === "auth/email-already-in-use"
          ? "That email already has an account. If they used to work here, ask them to sign in — you can then set their role."
          : e?.code === "auth/weak-password" ? "Password is too weak — use at least 6 characters."
            : e?.code === "auth/invalid-email" ? "That doesn't look like a valid email address."
              : authMessage(e?.code)
      );
    } finally {
      // Always tear the throwaway instance down, or a later add would collide on the app name.
      if (secondary) { try { await deleteApp(secondary); } catch { /* already gone */ } }
      setBusy(false);
    }
  };

  // Guarded by validateUserChange: the owner must not be able to demote or deactivate the last
  // active owner, because nobody would be left who can manage users and there is no way back
  // without a console visit.
  const applyChange = async (uid, next, label) => {
    const problem = validateUserChange(users, uid, next);
    if (problem) return notify("⚠ " + problem);
    try {
      await updateUser(uid, next);
      log?.("settings", `${label} — ${users[uid]?.email || uid}`);
      notify("✓ " + label);
    } catch (e) {
      console.error("user update failed", e);
      notify("⚠ Couldn't save that change.");
    }
  };

  const changeRole = (uid, role) => {
    const u = users[uid];
    if (!u || u.role === role) return;
    applyChange(uid, { role, active: u.active !== false }, `Role changed to ${ROLE_LABELS[role]}`);
  };

  const toggleActive = (uid) => {
    const u = users[uid];
    if (!u) return;
    const active = u.active === false;
    if (!active && !confirm(`Deactivate ${u.email}? They'll be signed out and won't be able to sign back in.`)) return;
    applyChange(uid, { role: u.role, active }, active ? "User re-activated" : "User deactivated");
  };

  return (
    <section style={{ ...S.panel, marginTop: 16 }}>
      <div style={{ ...S.panelHead, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Users &amp; roles</span>
        {!adding && <button className="btn primary" onClick={() => { setAdding(true); setErr(""); }}>+ Add user</button>}
      </div>

      <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", lineHeight: 1.6, marginBottom: 12 }}>
        {ROLES.map((r) => (
          <div key={r}>
            <b style={{ color: "#334" }}>{ROLE_LABELS[r]}</b> — {ROLE_DESCRIPTIONS[r]}
          </div>
        ))}
        <div style={{ marginTop: 6 }}>
          That's the starting point. Change what a Biller or an Inventory user can reach under
          <b> Feature access</b>, just below.
        </div>
      </div>

      {adding && (
        <div style={{ border: "1px solid #E2EAE3", borderRadius: 10, padding: 12, marginBottom: 14, background: "var(--surface-2, #F8FBF9)" }}>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Email"><input className="input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Name (optional)"><input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Temporary password">
              <input className="input" type="text" autoComplete="off" value={form.pwd} onChange={(e) => setForm((f) => ({ ...f, pwd: e.target.value }))} />
            </Field>
            <Field label="Role">
              <select className="input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginBottom: 8 }}>
            Share the password with them and ask them to change it from the sign-in screen's “Forgot password” link.
          </div>
          {err && <div style={{ color: "#B23B2E", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => { setAdding(false); setErr(""); }} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={addUser} disabled={busy}>{busy ? "Creating…" : "Create user"}</button>
          </div>
        </div>
      )}

      {!adding && err && <div style={{ color: "#B23B2E", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}

      {users === null ? (
        <div style={{ color: "var(--text-mid, #8A9C90)", fontSize: 13 }}>Loading users…</div>
      ) : rows.length === 0 ? (
        <Empty text="No users yet." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <thead>
              <tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(([uid, u]) => {
                const isMe = uid === user?.uid;
                const inactive = u.active === false;
                return (
                  <tr key={uid} style={inactive ? { opacity: 0.55 } : undefined}>
                    <td>
                      {u.email}
                      {isMe && <span style={{ fontSize: 11, color: "var(--text-mid, #8A9C90)" }}> (you)</span>}
                    </td>
                    <td>{u.name || <span style={{ color: "#A8B8AE" }}>—</span>}</td>
                    <td>
                      <select
                        className="input" style={{ padding: "4px 6px", fontSize: 12.5 }}
                        value={u.role} onChange={(e) => changeRole(uid, e.target.value)}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td style={{ color: inactive ? "#C44536" : "var(--brand)", fontWeight: 600, fontSize: 12.5 }}>
                      {inactive ? "Deactivated" : "Active"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => toggleActive(uid)}>
                        {inactive ? "Re-activate" : "Deactivate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 10, lineHeight: 1.6 }}>
        Deactivating keeps the person's history intact and blocks them at the database, not just in
        the app. Removing an account entirely is a Firebase console job — deactivating is almost
        always what you want.
      </div>
    </section>
  );
}


export { StoreConfig, Users };
export default StoreConfig;
