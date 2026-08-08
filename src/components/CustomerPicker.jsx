// Find-or-create a customer. Mounted at the till, in the diary and when selling a package.

import { blankCustomer, formatPhone, fromDayMonth, isValidDayMonth, isValidPhone, normalizePhone, searchCustomers, toDayMonth } from "../lib/customers.js";
import { TIER_COLORS } from "../lib/loyalty.js";
import { INR, todayStr } from "../lib/ui/format.js";
import { Field, Modal } from "./primitives.jsx";
import { useEffect, useMemo, useRef, useState } from "react";

// ---------- Customer picker ----------
// The front desk's entry point to the customer database, and deliberately the ONLY one a
// biller gets: search and quick-create, never a browsable list. Typing a full unknown number
// offers to create it on the spot, because the moment to capture a customer is while they're
// standing at the counter — not later, never.
//
// A bill with no customer is still valid: a walk-in who won't give a number must not be a
// blocker at the till.
function CustomerPicker({ customers, value, onPick, onCreate, notify }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(null); // a draft customer, when quick-creating
  const [err, setErr] = useState("");
  const boxRef = useRef(null);

  const picked = value ? customers.find((c) => c.phone === value) : null;
  const results = useMemo(() => searchCustomers(customers, q, 6), [customers, q]);

  // A fully-typed number that matches nobody → offer to create it.
  const unknownNumber = useMemo(() => {
    const p = normalizePhone(q);
    return isValidPhone(p) && !customers.some((c) => c.phone === p) ? p : "";
  }, [q, customers]);

  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (c) => { onPick(c.phone); setQ(""); setOpen(false); };

  const startCreate = (phone) => { setCreating(blankCustomer(phone, todayStr())); setErr(""); setOpen(false); };

  const saveCreate = () => {
    const problem = validateCustomer(creating, customers, true);
    if (problem) return setErr(problem);
    const rec = makeCustomer(creating, { createdAt: todayStr() });
    onCreate(rec);
    onPick(rec.phone);
    notify?.(`✓ ${rec.name} added`);
    setCreating(null);
    setQ("");
  };

  if (picked) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2, #EEF6F1)", border: "1px solid var(--tint-info-border, #CFE3D7)", borderRadius: 9, padding: "7px 10px" }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
          {String(picked.name || "?").trim().charAt(0).toUpperCase()}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {picked.name}
            {picked.tier && (
              <span style={{ background: TIER_COLORS[picked.tier], color: "#fff", fontWeight: 800, fontSize: 9, padding: "1px 5px", borderRadius: 999, marginLeft: 5, letterSpacing: ".04em" }}>
                {picked.tier.toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #6B7E74)" }}>
            {formatPhone(picked.phone)}
            {picked.totalVisits ? ` · ${picked.totalVisits} visit${picked.totalVisits > 1 ? "s" : ""}` : " · first visit"}
            {picked.loyaltyPoints > 0 ? ` · ${picked.loyaltyPoints} pts` : ""}
          </div>
        </div>
        <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => onPick("")}>Change</button>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        className="input" type="search" placeholder="Search name or phone… (optional)"
        value={q} onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (results.length === 1) pick(results[0]);
            else if (unknownNumber) startCreate(unknownNumber);
          }
        }}
      />
      {open && (q.trim() || results.length > 0) && (
        <div style={{ position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, background: "var(--surface, #fff)", border: "1px solid var(--border, #DDE5DF)", borderRadius: 9, marginTop: 4, boxShadow: "0 10px 26px rgba(0,0,0,.13)", overflow: "hidden" }}>
          {results.map((c) => (
            <button
              key={c.phone} onClick={() => pick(c)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: "none", background: "none", cursor: "pointer", borderBottom: "1px solid var(--border, #F0F4F1)" }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name || "(no name)"}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-mid, #6B7E74)" }}>
                {formatPhone(c.phone)}
                {c.totalVisits ? ` · ${c.totalVisits} visit${c.totalVisits > 1 ? "s" : ""} · ${INR(c.totalSpend || 0)}` : ""}
              </div>
            </button>
          ))}
          {unknownNumber && (
            <button
              onClick={() => startCreate(unknownNumber)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 10px", border: "none", background: "var(--surface-2, #F4FAF6)", cursor: "pointer", color: "var(--brand)", fontWeight: 600, fontSize: 13 }}
            >
              + Add {formatPhone(unknownNumber)} as a new customer
            </button>
          )}
          {!results.length && !unknownNumber && (
            <div style={{ padding: "9px 10px", fontSize: 12.5, color: "var(--text-mid, #8A9C90)" }}>
              {normalizePhone(q).length >= 4 && !isValidPhone(q) ? "Keep typing the full 10-digit number to add them…" : "No match."}
            </div>
          )}
        </div>
      )}

      {creating && (
        <Modal title="New customer" onClose={() => setCreating(null)}>
          <CustomerForm value={creating} onChange={setCreating} isNew err={err} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={() => setCreating(null)}>Cancel</button>
            <button className="btn primary" onClick={saveCreate}>Add & select</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Customer editor (shared) ----------
// Used by the Customers view and by the billing picker's quick-create, so a customer created
// mid-bill is the same shape as one created deliberately — one form, one validation path.
//
// Phone is the key (shop/customers/<phone>), so it is only editable when creating. Changing it
// later would mean re-keying the record and re-pointing every bill at the new key; the honest
// answer is to create a new customer.
function CustomerForm({ value, onChange, isNew, err }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const year = todayStr().slice(0, 4);
  return (
    <>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Phone">
          {isNew ? (
            <input className="input" type="tel" inputMode="numeric" autoFocus value={value.phone} onChange={(e) => set("phone", e.target.value)} />
          ) : (
            <>
              <input className="input" value={formatPhone(value.phone)} disabled title="Phone is the customer's key and can't be changed" />
              {/* Visible, not just a title: on a touchscreen there is no hover, so tapping a
                  greyed-out field otherwise gives no reason why it won't take input. */}
              <div style={{ fontSize: 11, color: "var(--text-mid, #8A9C90)", marginTop: 3 }}>
                The phone number is this customer's key and can't be changed.
              </div>
            </>
          )}
        </Field>
        <Field label="Name"><input className="input" autoFocus={!isNew} value={value.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Gender">
          <select className="input" value={value.gender || ""} onChange={(e) => set("gender", e.target.value)}>
            <option value="">—</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="O">Other</option>
          </select>
        </Field>
        <div />
        <Field label="Birthday">
          <input
            className="input" type="date"
            value={fromDayMonth(value.dob, year)}
            onChange={(e) => set("dob", toDayMonth(e.target.value))}
          />
        </Field>
        <Field label="Anniversary">
          <input
            className="input" type="date"
            value={fromDayMonth(value.anniversary, year)}
            onChange={(e) => set("anniversary", toDayMonth(e.target.value))}
          />
        </Field>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: -4, marginBottom: 8 }}>
        Only the day and month are kept — the year isn't stored, and isn't needed to send a wish.
      </div>
      <Field label="Notes">
        <textarea className="input" rows={2} style={{ resize: "vertical" }} placeholder="e.g. prefers Priya · allergic to ammonia" value={value.notes || ""} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {err && <div style={{ color: "#B23B2E", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    </>
  );
}

// Validate a customer form. Phone is only checked on create — an existing record's key is
// already normalised and locked.
function validateCustomer(form, customers, isNew) {
  if (isNew) {
    if (!isValidPhone(form.phone)) return "Enter a valid 10-digit mobile number.";
    const key = normalizePhone(form.phone);
    if ((customers || []).some((c) => c.phone === key)) return "That number is already on the customer list.";
  }
  if (!String(form.name || "").trim()) return "Give the customer a name.";
  if (form.dob && !isValidDayMonth(form.dob)) return "That birthday isn't a real date.";
  if (form.anniversary && !isValidDayMonth(form.anniversary)) return "That anniversary isn't a real date.";
  return null;
}

// Build a saveable customer record from a form.
const makeCustomer = (form, { createdAt = "" } = {}) => {
  const phone = normalizePhone(form.phone);
  return {
    ...blankCustomer(phone, form.createdAt || createdAt),
    ...form,
    id: phone,
    phone,
    name: String(form.name || "").trim(),
    notes: String(form.notes || "").trim(),
  };
};


export { CustomerPicker, CustomerForm, validateCustomer, makeCustomer };
