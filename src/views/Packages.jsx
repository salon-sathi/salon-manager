// Packages — extracted from salon-manager.jsx.

import { CustomerPicker } from "../components/CustomerPicker.jsx";
import { Card, Empty, Field, Header, Modal } from "../components/primitives.jsx";
import { formatPhone } from "../lib/customers.js";
import { activePackages, blankPackage, daysBetweenISO, makePackage, sellPackage, validatePackage } from "../lib/loyalty.js";
import { activeServices, serviceById } from "../lib/salon.js";
import { S } from "../lib/ui/css.js";
import { INR, money, todayStr, uid } from "../lib/ui/format.js";
import { useMemo, useState } from "react";

// ---------- Packages (owner only) ----------
// Prepaid work: the customer buys N sessions up front and draws them down. The money is taken
// on day one, which is why a redemption at the till is a zero-price line.
function Packages({ packages, setPackages, customerPackages, setCustomerPackages, services, customers, setCustomers, setSales, notify, log }) {
  const [editing, setEditing] = useState(null); // package id | "new"
  const [form, setForm] = useState(blankPackage());
  const [err, setErr] = useState("");
  const [selling, setSelling] = useState(null); // the package being sold
  const [sellTo, setSellTo] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const listed = useMemo(() => packages.filter((p) => showInactive || p.active !== false), [packages, showInactive]);
  const byPhone = useMemo(() => new Map(customers.map((c) => [c.phone, c])), [customers]);
  const today = todayStr();

  // Sold packages that still have life in them — what the salon actually owes work against.
  const outstanding = useMemo(
    () => customerPackages
      .filter((cp) => cp.usesLeft > 0 && cp.expiresAt >= today)
      .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt))),
    [customerPackages, today]
  );
  const liability = money(outstanding.reduce((a, cp) => a + (cp.pricePaid / Math.max(1, cp.totalUses)) * cp.usesLeft, 0));

  const startNew = () => { setForm(blankPackage(today)); setEditing("new"); setErr(""); };
  const startEdit = (p) => { setForm({ ...p }); setEditing(p.id); setErr(""); };
  const close = () => { setEditing(null); setErr(""); };

  const save = () => {
    const problem = validatePackage(form);
    if (problem) return setErr(problem);
    const isNew = editing === "new";
    const rec = makePackage(form, { id: isNew ? uid() : editing, createdAt: form.createdAt || today });
    setPackages((list) => (isNew ? [...list, rec] : list.map((p) => (p.id === editing ? rec : p))));
    log("settings", `${isNew ? "Added" : "Updated"} package — ${rec.name} · ${rec.totalUses} sessions · ${INR(rec.price)}`);
    notify(`✓ ${rec.name} saved`);
    close();
  };

  const toggleActive = (p) => {
    const next = p.active === false;
    if (!next && !confirm(`Stop selling “${p.name}”? Packages customers have already bought are unaffected.`)) return;
    setPackages((list) => list.map((x) => (x.id === p.id ? { ...x, active: next } : x)));
    log("settings", `${next ? "Re-activated" : "Deactivated"} package — ${p.name}`);
    notify(next ? `${p.name} is on sale again` : `${p.name} taken off sale`);
  };

  // Selling a package takes money, so it creates a real bill alongside the entitlement — it
  // must show up in revenue like any other sale, not appear as free work later.
  const sell = () => {
    const cust = byPhone.get(sellTo);
    if (!cust) return notify("⚠ Pick a customer first.");
    const pkg = selling;
    const cp = sellPackage(pkg, cust.phone, { id: uid(), today });
    const now = new Date();
    const bill = {
      id: uid(),
      date: today,
      time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      lines: [{
        name: `${pkg.name} (package · ${pkg.totalUses} sessions)`,
        qty: 1, unit: "package", price: money(pkg.price), buyPrice: 0, amount: money(pkg.price),
        lineType: "product", // it's a sale of an entitlement, not labour: no staff, no commission
        packageId: pkg.id,
      }],
      total: money(pkg.price),
      profit: money(pkg.price),
      payment: "Cash",
      customerPhone: cust.phone, customer: cust.name, mobile: cust.phone,
      soldPackageId: cp.id,
    };
    setCustomerPackages((list) => [...list, cp]);
    setSales((list) => [...list, bill]);
    log("sale", `Sold package — ${pkg.name} to ${cust.name} · ${INR(pkg.price)}`);
    notify(`✓ ${pkg.name} sold to ${cust.name} — expires ${cp.expiresAt}`);
    setSelling(null); setSellTo("");
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleService = (id) => setForm((f) => ({
    ...f,
    serviceIds: f.serviceIds.includes(id) ? f.serviceIds.filter((x) => x !== id) : [...f.serviceIds, id],
  }));

  return (
    <div>
      <Header title="Packages" sub={`${activePackages(packages).length} on sale · ${outstanding.length} live with customers`}>
        <button className="btn primary big" onClick={startNew}>+ New package</button>
      </Header>

      <div className="cards" style={S.cards}>
        <Card label="Live packages" value={outstanding.length} sub="sold, with sessions left" />
        <Card label="Sessions owed" value={outstanding.reduce((a, cp) => a + cp.usesLeft, 0)} sub="work already paid for" />
        {/* The money already taken for work not yet done. Worth seeing: it's revenue that's
            already been booked but still has a cost to come. */}
        <Card label="Unearned value" value={INR(liability)} sub="paid for, not yet delivered" accent />
      </div>

      <section style={{ ...S.panel, marginTop: 14, marginBottom: 14 }}>
        <label style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show packages no longer on sale
        </label>
      </section>

      {listed.length === 0 ? (
        <Empty text="No packages yet.">
          <button className="btn primary" onClick={startNew}>Create the first one</button>
        </Empty>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {listed.map((p) => {
            const covered = p.serviceIds.map((id) => serviceById(services, id)?.name).filter(Boolean);
            const each = p.totalUses ? money(p.price / p.totalUses) : 0;
            return (
              <section key={p.id} style={{ ...S.panel, opacity: p.active === false ? 0.55 : 1 }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-mid, #5E7468)", marginTop: 6, lineHeight: 1.7 }}>
                  <div><b>{p.totalUses}</b> sessions · <b>{INR(p.price)}</b> <span style={{ color: "var(--text-mid, #8A9C90)" }}>({INR(each)} each)</span></div>
                  <div>Valid {p.validityDays} days from purchase</div>
                  <div style={{ color: "var(--text-mid, #8A9C90)" }}>{covered.length ? covered.join(", ") : "⚠ no services attached"}</div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {p.active !== false && <button className="btn primary" style={{ fontSize: 12 }} onClick={() => { setSelling(p); setSellTo(""); }}>Sell</button>}
                  <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => startEdit(p)}>Edit</button>
                  <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => toggleActive(p)}>
                    {p.active === false ? "Put on sale" : "Stop selling"}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {outstanding.length > 0 && (
        <section style={{ ...S.panel, marginTop: 16 }}>
          <div style={S.panelHead}>Live customer packages</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead><tr><th>Customer</th><th>Package</th><th style={{ textAlign: "right" }}>Left</th><th>Expires</th></tr></thead>
              <tbody>
                {outstanding.map((cp) => {
                  const daysLeft = daysBetweenISO(today, cp.expiresAt);
                  const soon = daysLeft <= 14;
                  return (
                    <tr key={cp.id}>
                      <td>{byPhone.get(cp.customerPhone)?.name || formatPhone(cp.customerPhone)}</td>
                      <td>{cp.name}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{cp.usesLeft} / {cp.totalUses}</td>
                      <td style={{ color: soon ? "#C44536" : "#334", fontWeight: soon ? 700 : 400, whiteSpace: "nowrap" }}>
                        {cp.expiresAt}{soon ? ` · ${daysLeft}d left` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing && (
        <Modal title={editing === "new" ? "New package" : "Edit package"} onClose={close}>
          <Field label="Name"><input className="input" autoFocus placeholder="e.g. 6 Facials" value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Field label="Sessions"><input className="input" type="number" min="1" value={form.totalUses} onChange={(e) => set("totalUses", e.target.value)} /></Field>
            <Field label="Price (₹)"><input className="input" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} /></Field>
            <Field label="Valid (days)"><input className="input" type="number" min="1" value={form.validityDays} onChange={(e) => set("validityDays", e.target.value)} /></Field>
          </div>
          <Field label="Services this package covers">
            <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #DDE5DF", borderRadius: 9, padding: 6 }}>
              {activeServices(services).map((s) => (
                <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <span style={{ color: "var(--text-mid, #8A9C90)", fontSize: 12 }}>{INR(s.price)}</span>
                </label>
              ))}
            </div>
          </Field>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: -4 }}>
            At billing, any of these services goes on the customer's bill at ₹0 and uses one session.
          </div>
          {err && <div style={{ color: "#B23B2E", fontSize: 12.5, marginTop: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" onClick={save}>Save package</button>
          </div>
        </Modal>
      )}

      {selling && (
        <Modal title={`Sell “${selling.name}”`} onClose={() => setSelling(null)}>
          <div style={{ fontSize: 13, color: "var(--text-mid, #5E7468)", marginBottom: 10, lineHeight: 1.6 }}>
            {selling.totalUses} sessions · <b>{INR(selling.price)}</b> · valid {selling.validityDays} days.
            This records a <b>{INR(selling.price)}</b> bill today and gives the customer their sessions.
          </div>
          <Field label="Customer">
            <CustomerPicker
              customers={customers} value={sellTo} onPick={setSellTo}
              onCreate={(rec) => setCustomers((list) => [...list, rec])} notify={notify}
            />
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={() => setSelling(null)}>Cancel</button>
            <button className="btn primary" onClick={sell} disabled={!sellTo}>Sell &amp; bill {INR(selling.price)}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}


export { Packages };
export default Packages;
