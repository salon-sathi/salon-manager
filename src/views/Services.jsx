// Services — extracted from salon-manager.jsx.

import { ServiceIconChip } from "../components/ServiceIcon.jsx";
import { Empty, Field, Header, Modal } from "../components/primitives.jsx";
import { activeServices, blankService, makeService, serviceConsumables, validateService } from "../lib/salon.js";
import { SERVICE_CATEGORIES, serviceIconFor } from "../lib/seed.js";
import { CATEGORY_FALLBACK, ICON_KEYS, ICON_LABELS, isIconKey, resolveIcon } from "../lib/serviceIcons.js";
import { INR, todayStr, uid } from "../lib/ui/format.js";
import { useMemo, useState } from "react";
import { S } from "../lib/ui/css.js";

// ---------- Services (owner only) ----------
// The salon's menu: what it sells, how long each thing takes, what it pays the person doing
// it, and how soon the customer is due back. Those last two are why this can't just be the
// Inventory screen with different labels — a service has no stock, but it does have a
// commission rate and a rebooking cycle that the Reminders queue reads.
function Services({ services, setServices, items = [], notify, log }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // service id | "new"
  const [form, setForm] = useState(blankService());
  const [err, setErr] = useState("");

  // Inventory, sorted for the "products used" picker, plus a fast id → item lookup for rendering
  // each chosen row's name and unit. A service references products by id only; the catalogue owns
  // their names, so a renamed product stays correctly linked.
  const itemsSorted = useMemo(
    () => [...items].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    [items]
  );
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return services.filter((s) =>
      (showInactive || s.active !== false) &&
      (cat === "All" || s.category === cat) &&
      (!query || String(s.name || "").toLowerCase().includes(query))
    );
  }, [services, q, cat, showInactive]);

  const grouped = useMemo(() => {
    const m = new Map();
    filtered.forEach((s) => {
      const k = s.category || "Other";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    });
    return [...m.entries()];
  }, [filtered]);

  const startNew = () => { setForm(blankService(todayStr())); setEditing("new"); setErr(""); };
  const startEdit = (s) => { setForm({ ...s }); setEditing(s.id); setErr(""); };
  const close = () => { setEditing(null); setErr(""); };

  const save = () => {
    const problem = validateService(form);
    if (problem) return setErr(problem);
    const isNew = editing === "new";
    const rec = makeService(form, { id: isNew ? uid() : editing, createdAt: form.createdAt || todayStr() });
    setServices((list) => (isNew ? [...list, rec] : list.map((s) => (s.id === editing ? rec : s))));
    log("settings", `${isNew ? "Added" : "Updated"} service — ${rec.name} · ${INR(rec.price)}`);
    notify(`✓ ${rec.name} saved`);
    close();
  };

  // Deactivate rather than delete: a deleted service would orphan every past bill line and
  // commission report that references it. Deactivating takes it off the billing screen while
  // leaving history readable.
  const toggleActive = (s) => {
    const next = s.active === false;
    if (!next && !confirm(`Take “${s.name}” off the menu? Past bills keep it; it just stops appearing when billing.`)) return;
    setServices((list) => list.map((x) => (x.id === s.id ? { ...x, active: next } : x)));
    log("settings", `${next ? "Re-activated" : "Deactivated"} service — ${s.name}`);
    notify(next ? `${s.name} is back on the menu` : `${s.name} taken off the menu`);
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // "Products used" rows on the service being edited. Each row is { itemId, qty }; qty accepts a
  // fraction so a service can record partial ("sub") use of a product — a quarter tube of colour.
  const consumables = form.consumables || [];
  const addConsumable = () => {
    const used = new Set(consumables.map((c) => c.itemId));
    const next = itemsSorted.find((i) => !used.has(i.id)); // first product not already listed
    if (!next) return notify(itemsSorted.length ? "Every product is already on this service." : "Add products in Inventory first, then link them here.");
    set("consumables", [...consumables, { itemId: next.id, qty: 1 }]);
  };
  const setConsumable = (idx, patch) => set("consumables", consumables.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const removeConsumable = (idx) => set("consumables", consumables.filter((_, i) => i !== idx));

  return (
    <div>
      <Header title="Services" sub={`${activeServices(services).length} on the menu · prices, durations, commission and rebooking cycles`}>
        <button className="btn primary big" onClick={startNew}>+ New service</button>
      </Header>

      <section style={{ ...S.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" style={{ flex: "1 1 200px" }} placeholder="Search services…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" style={{ width: "auto" }} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="All">All categories</option>
            {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
      </section>

      {grouped.length === 0 ? (
        <Empty text="No services match." />
      ) : grouped.map(([category, list]) => (
        <section key={category} style={{ ...S.panel, marginBottom: 14 }}>
          <div style={{ ...S.panelHead, gap: 8 }}>
            <ServiceIconChip icon={CATEGORY_FALLBACK[category] || "defaultService"} size={26} />
            {category} <span style={{ fontWeight: 400, color: "var(--text-mid, #8A9C90)", marginLeft: 6 }}>· {list.length}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr><th>Service</th><th style={{ textAlign: "right" }}>Price</th><th style={{ textAlign: "right" }}>Time</th><th style={{ textAlign: "right" }}>Commission</th><th style={{ textAlign: "right" }}>Rebook</th><th /></tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} style={s.active === false ? { opacity: 0.5 } : undefined}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <ServiceIconChip icon={resolveIcon(s)} size={24} />
                        <span>
                          {s.name}
                          {s.active === false && <span style={{ fontSize: 11, color: "#C44536" }}> · off menu</span>}
                          {serviceConsumables(s).length > 0 && (
                            <span style={{ fontSize: 11, color: "var(--text-mid, #8A9C90)" }}> · uses {serviceConsumables(s).length} product{serviceConsumables(s).length > 1 ? "s" : ""}</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{INR(s.price)}</td>
                    <td style={{ textAlign: "right" }}>{s.durationMin} min</td>
                    <td style={{ textAlign: "right" }}>{s.commissionPct}%</td>
                    <td style={{ textAlign: "right", color: s.rebookCycleDays ? "#334" : "#A8B8AE" }}>
                      {s.rebookCycleDays ? `${s.rebookCycleDays} d` : "—"}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => startEdit(s)}>Edit</button>{" "}
                      <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => toggleActive(s)}>
                        {s.active === false ? "Restore" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {editing && (
        <Modal title={editing === "new" ? "New service" : "Edit service"} onClose={close}>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Name"><input className="input" autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
            </div>
            <Field label="Category">
              {/* Changing the category refreshes the legacy emoji this record has always carried
                  — but never touches a deliberate icon override (which lives in the same field;
                  isIconKey tells the two apart). */}
              <select
                className="input" value={form.category}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  category: e.target.value,
                  icon: isIconKey(f.icon) ? f.icon : serviceIconFor(e.target.value),
                }))}
              >
                {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Price (₹)"><input className="input" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} /></Field>
            <Field label="Duration (minutes)">
              <input className="input" inputMode="numeric" step={5} type="number" value={form.durationMin} onChange={(e) => set("durationMin", e.target.value)} />
            </Field>
            <Field label="Commission %"><input className="input" inputMode="decimal" value={form.commissionPct} onChange={(e) => set("commissionPct", e.target.value)} /></Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Rebooking cycle (days)">
                <input className="input" inputMode="numeric" value={form.rebookCycleDays} onChange={(e) => set("rebookCycleDays", e.target.value)} />
              </Field>
              <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: -4 }}>
                How long until the customer is typically due again — this drives the Reminders queue.
                Use <b>0</b> for one-off work like bridal makeup, which should never prompt a reminder.
              </div>
            </div>
          </div>

          {/* Icon — automatic by default, overridable per service.
              The icon is normally worked out from the name every time it is drawn, so a menu
              that gets renamed or reorganised keeps sensible icons for free. This picker is the
              escape hatch for the one service the keywords read wrong ("Signature Ritual No. 4"),
              and it is the ONLY thing that writes an icon into the data. */}
          <div style={{ marginTop: 16, borderTop: "1px solid #E7EFEA", paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: "#334" }}>
                <ServiceIconChip icon={resolveIcon(form)} size={30} />
                Icon{" "}
                <span style={{ fontWeight: 400, color: "var(--text-mid, #8A9C90)" }}>
                  {isIconKey(form.icon) ? `· ${ICON_LABELS[form.icon]}, chosen by you` : "· automatic, from the name"}
                </span>
              </div>
              {isIconKey(form.icon) && (
                <button type="button" className="btn ghost" style={{ fontSize: 12 }} onClick={() => set("icon", serviceIconFor(form.category))}>
                  Back to automatic
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))", gap: 6 }}>
              {ICON_KEYS.map((key) => {
                const chosen = form.icon === key;
                return (
                  <button
                    key={key} type="button" title={ICON_LABELS[key]} aria-label={ICON_LABELS[key]} aria-pressed={chosen}
                    onClick={() => set("icon", key)}
                    style={{
                      display: "grid", placeItems: "center", padding: 5, cursor: "pointer", borderRadius: 10,
                      border: chosen ? "2px solid var(--brand)" : "1.5px solid #DDE8DE",
                      background: chosen ? "var(--brand-soft)" : "#fff",
                    }}
                  >
                    <ServiceIconChip icon={key} size={26} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Products used — the inventory this service consumes. Each row is a product plus how
              much of it one service uses; the quantity may be a fraction (0.25 of a bottle) to
              capture partial ("sub") use. Products already listed drop out of the other pickers so
              the same one can't be added twice. Optional — a labour-only service lists nothing. */}
          <div style={{ marginTop: 16, borderTop: "1px solid #E7EFEA", paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#334" }}>
                Products used <span style={{ fontWeight: 400, color: "var(--text-mid, #8A9C90)" }}>· from inventory (optional)</span>
              </div>
              <button type="button" className="btn ghost" style={{ fontSize: 12 }} onClick={addConsumable} disabled={itemsSorted.length === 0}>+ Add product</button>
            </div>
            {itemsSorted.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-mid, #8A9C90)" }}>No products in inventory yet — add them under Inventory, then link them here.</div>
            ) : consumables.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-mid, #8A9C90)" }}>None yet. Add the products this service consumes and set how much of each it uses — fractions are fine (e.g. <b>0.25</b> of a bottle).</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {consumables.map((c, idx) => {
                  const item = itemById.get(c.itemId);
                  const usedElsewhere = new Set(consumables.filter((_, i) => i !== idx).map((x) => x.itemId));
                  const options = itemsSorted.filter((i) => i.id === c.itemId || !usedElsewhere.has(i.id));
                  return (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select className="input" style={{ flex: "1 1 auto", minWidth: 120 }} value={c.itemId} onChange={(e) => setConsumable(idx, { itemId: e.target.value })} aria-label="Product">
                        {!item && <option value={c.itemId}>⚠ product no longer in inventory</option>}
                        {options.map((i) => <option key={i.id} value={i.id}>{i.name}{i.unit ? ` (${i.unit})` : ""}</option>)}
                      </select>
                      <input className="input" inputMode="decimal" style={{ width: 84, textAlign: "right" }} value={c.qty} onChange={(e) => setConsumable(idx, { qty: e.target.value })} aria-label="Quantity used per service" title="How much of this product one service uses" />
                      <span style={{ fontSize: 12, color: "var(--text-mid, #8A9C90)", minWidth: 30 }}>{item?.unit || ""}</span>
                      <button type="button" className="btn ghost" style={{ fontSize: 12, color: "#B23B2E" }} onClick={() => removeConsumable(idx)} aria-label="Remove product">✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {err && <div style={{ color: "#B23B2E", fontSize: 12.5, marginTop: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" onClick={save}>Save service</button>
          </div>
        </Modal>
      )}
    </div>
  );
}


export { Services };
export default Services;
