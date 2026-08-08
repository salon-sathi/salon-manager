// Staff — extracted from salon-manager.jsx.

import { Card, Empty, Field, Header, Modal } from "../components/primitives.jsx";
import { allPayouts, monthRange, noShowRates, peakHours, revenuePerStaff, servicesPerDay } from "../lib/commissions.js";
import { STAFF_COLORS, activeStaff, blankStaff, makeStaff, validateStaff } from "../lib/salon.js";
import { printHtml } from "../lib/ui/assets.js";
import { S } from "../lib/ui/css.js";
import { INR, escapeHtml, money, todayStr, uid } from "../lib/ui/format.js";
import { Fragment, useMemo, useState } from "react";
import { shiftMonths } from "../lib/loyalty.js";
import { dayLabel, hourLabel } from "../lib/stats.js";
import { ChartCard, barLabel, inrTick } from "../components/chartkit.jsx";
import { formatPhone } from "../lib/customers.js";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";

// ---------- Staff → Commission & payouts (owner only) ----------
// The monthly "what do I owe everyone" report. Printable, because this is what gets handed
// over (or argued about) on payday.
//
// Every figure comes from the rate SNAPSHOTTED on each bill line at the time of sale, so
// re-opening last month's report next year shows the same numbers. See commissions.js.
function StaffPayouts({ staff, sales, store }) {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [open, setOpen] = useState(null); // staffId whose line-by-line detail is expanded
  const { from, to } = useMemo(() => monthRange(month), [month]);
  const payouts = useMemo(() => allPayouts(staff, sales, from, to), [staff, sales, from, to]);
  const totals = useMemo(() => ({
    services: payouts.reduce((a, p) => a + p.services, 0),
    revenue: money(payouts.reduce((a, p) => a + p.revenue, 0)),
    commission: money(payouts.reduce((a, p) => a + p.commission, 0)),
  }), [payouts]);
  const monthLabel = new Date(month + "-01T00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const print = () => {
    const rows = payouts.filter((p) => p.services > 0).map((p) => `
      <tr><td>${escapeHtml(p.name)}</td><td class="n">${p.services}</td>
      <td class="n">${INR(p.revenue)}</td><td class="n"><b>${INR(p.commission)}</b></td></tr>`).join("");
    printHtml(`
      <style>
        body { font-family: system-ui, sans-serif; padding: 24px; color: #111; }
        h1 { font-size: 19px; margin: 0; }
        .sub { color: #555; font-size: 13px; margin: 2px 0 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid #ddd; }
        th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #666; }
        .n { text-align: right; }
        tfoot td { border-top: 2px solid #333; border-bottom: none; font-weight: 800; }
        .sign { margin-top: 40px; display: flex; gap: 40px; font-size: 12px; color: #555; }
        .sign div { flex: 1; border-top: 1px solid #999; padding-top: 5px; }
      </style>
      <h1>${escapeHtml(store?.name || "Salon")} — Commission payouts</h1>
      <div class="sub">${escapeHtml(monthLabel)} · ${escapeHtml(from)} to ${escapeHtml(to)}</div>
      <table>
        <thead><tr><th>Staff</th><th class="n">Services</th><th class="n">Revenue</th><th class="n">Commission</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">No services this month.</td></tr>'}</tbody>
        <tfoot><tr><td>Total</td><td class="n">${totals.services}</td><td class="n">${INR(totals.revenue)}</td><td class="n">${INR(totals.commission)}</td></tr></tfoot>
      </table>
      <div class="sign"><div>Prepared by</div><div>Received by</div></div>
    `, `Payouts ${month}`);
  };

  return (
    <div>
      <section style={{ ...S.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)" }}>
            Month{" "}
            <input type="month" className="input" style={{ width: "auto", marginLeft: 4 }} value={month} max={todayStr().slice(0, 7)} onChange={(e) => setMonth(e.target.value || todayStr().slice(0, 7))} />
          </label>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={print}>🖨 Print payout sheet</button>
        </div>
      </section>

      <div className="cards" style={S.cards}>
        <Card label="Services done" value={totals.services} sub={monthLabel} />
        <Card label="Service revenue" value={INR(totals.revenue)} sub="what their work billed" />
        <Card label="Commission owed" value={INR(totals.commission)} sub={totals.revenue > 0 ? `${Math.round((totals.commission / totals.revenue) * 100)}% of service revenue` : "—"} accent />
      </div>

      {payouts.length === 0 ? (
        <Empty text="No staff yet." />
      ) : (
        <section style={{ ...S.panel, marginTop: 14 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr><th>Staff</th><th style={{ textAlign: "right" }}>Services</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Commission</th><th /></tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <Fragment key={p.staffId}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td style={{ textAlign: "right" }}>{p.services}</td>
                      <td style={{ textAlign: "right" }}>{INR(p.revenue)}</td>
                      <td style={{ textAlign: "right", fontWeight: 800, color: "var(--brand)" }}>{INR(p.commission)}</td>
                      <td style={{ textAlign: "right" }}>
                        {p.services > 0 && (
                          <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => setOpen(open === p.staffId ? null : p.staffId)}>
                            {open === p.staffId ? "Hide" : "Detail"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === p.staffId && (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--surface-2, #F7FAF7)", padding: 0 }}>
                          {/* Line by line, because "why is my commission this number" is the
                              question this screen exists to answer. */}
                          <table className="tbl" style={{ width: "100%" }}>
                            <thead><tr><th>Date</th><th>Service</th><th>Customer</th><th style={{ textAlign: "right" }}>Amount</th><th style={{ textAlign: "right" }}>Rate</th><th style={{ textAlign: "right" }}>Commission</th></tr></thead>
                            <tbody>
                              {p.rows.map((r, i) => (
                                <tr key={r.billId + i}>
                                  <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                                  <td>
                                    {r.service}{r.qty > 1 ? ` ×${r.qty}` : ""}
                                    {/* A ₹0 line looks like a mistake unless it says why. */}
                                    {r.fromPackage && <span style={{ color: "var(--text-mid, #8A9C90)", fontSize: 11 }}> · package</span>}
                                  </td>
                                  <td style={{ color: "var(--text-mid, #6B7E74)" }}>{r.customer || "Walk-in"}</td>
                                  <td style={{ textAlign: "right" }}>{INR(r.amount)}</td>
                                  <td style={{ textAlign: "right", color: "var(--text-mid, #6B7E74)" }}>{r.rate}%</td>
                                  <td style={{ textAlign: "right", fontWeight: 600 }}>{INR(r.commission)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 10, lineHeight: 1.6 }}>
            Commission is worked out at the rate that applied <b>when each service was done</b>, so
            re-opening an old month always shows the same figures. It's calculated on the service
            amount before any whole-bill discount — a discount is the salon's decision, not the
            stylist's. Package sessions bill at ₹0 here; their commission was earned when the
            package was sold.
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- Staff → Performance (owner only) ----------
function StaffPerformance({ staff, sales, appointments }) {
  const [months, setMonths] = useState(3);
  const to = todayStr();
  const from = useMemo(() => shiftMonths(to, -months), [to, months]);

  const perStaff = useMemo(() => revenuePerStaff(activeStaff(staff), sales, from, to), [staff, sales, from, to]);
  const noShows = useMemo(() => noShowRates(activeStaff(staff), appointments, from, to), [staff, appointments, from, to]);
  const heat = useMemo(() => peakHours(appointments, from, to), [appointments, from, to]);
  const perDay = useMemo(
    () => servicesPerDay(sales, "", from, to).map((r) => ({ ...r, label: dayLabel(r.date) })),
    [sales, from, to]
  );

  const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // Only render hours that actually saw work — a grid from midnight to midnight is mostly
  // empty cells, and the point of a heatmap is to be readable at a glance.
  const hours = useMemo(() => {
    const used = [];
    for (let h = 0; h < 24; h++) if (heat.grid.some((row) => row[h] > 0)) used.push(h);
    return used.length ? used : [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  }, [heat]);

  return (
    <div>
      <section style={{ ...S.panel, marginBottom: 14 }}>
        <label style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)" }}>
          Period{" "}
          <select className="input" style={{ width: "auto", marginLeft: 4 }} value={months} onChange={(e) => setMonths(+e.target.value)}>
            <option value={1}>Last month</option>
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
          </select>
          <span style={{ marginLeft: 8, color: "var(--text-mid, #8A9C90)" }}>{from} → {to}</span>
        </label>
      </section>

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Revenue &amp; commission per stylist" height={260}>
          <BarChart data={perStaff} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#678" }} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} label={barLabel} />
            <Bar dataKey="commission" name="Commission" fill="#E8A33D" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>

        <ChartCard title="No-show rate per stylist" height={260}>
          <BarChart data={noShows} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#678" }} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} unit="%" width={40} />
            <Tooltip formatter={(v, k, p) => [`${v}% (${p.payload.noShow} of ${p.payload.resolved})`, "No-shows"]} />
            <Bar dataKey="rate" name="No-show %" fill="#C44536" radius={[3, 3, 0, 0]} label={{ position: "top", fontSize: 10, fill: "#667", formatter: (v) => (v ? v + "%" : "") }} />
          </BarChart>
        </ChartCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartCard title="Services performed per day" height={220}>
          <BarChart data={perDay} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#678" }} interval="preserveStartEnd" minTickGap={20} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} width={32} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" name="Services" fill="#2A6FB0" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartCard>
      </div>

      <section style={{ ...S.panel, marginTop: 16 }}>
        <div style={S.panelHead}>
          Busiest hours
          <span style={{ fontWeight: 400, color: "var(--text-mid, #8A9C90)" }}> · from the diary, not the till — when people were in the chair</span>
        </div>
        {heat.max === 0 ? (
          <Empty text="No appointments in this period yet." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr>
                  <th />
                  {hours.map((h) => <th key={h} style={{ padding: "2px 4px", color: "var(--text-mid, #8A9C90)", fontWeight: 600 }}>{hourLabel(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {DOW_LABELS.map((d, i) => (
                  <tr key={d}>
                    <td style={{ padding: "2px 6px 2px 0", color: "var(--text-mid, #5E7468)", fontWeight: 700, whiteSpace: "nowrap" }}>{d}</td>
                    {hours.map((h) => {
                      const v = heat.grid[i][h];
                      // Opacity by intensity: a busy cell reads as busy without needing a legend.
                      const a = v ? 0.15 + 0.85 * (v / heat.max) : 0;
                      return (
                        <td key={h} title={`${d} ${hourLabel(h)} — ${v} appointment(s)`}
                          style={{ padding: 0, width: 26, height: 22, background: v ? `rgba(27,94,67,${a})` : "#F4F7F4", border: "1px solid #fff", textAlign: "center", color: a > 0.55 ? "#fff" : "var(--text-mid, #5E7468)", fontWeight: 600 }}>
                          {v || ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Staff (owner only) ----------
// Who works here, what colour they are on the appointment grid, and what they earn by default.
// Phase 5 builds payout reports and performance charts on top of this.
function Staff({ staff, setStaff, sales, appointments, store, notify, log }) {
  const [tab, setTab] = useState("team"); // team | payouts | performance
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // staff id | "new"
  const [form, setForm] = useState(blankStaff());
  const [err, setErr] = useState("");

  const listed = useMemo(
    () => staff.filter((s) => showInactive || s.active !== false),
    [staff, showInactive]
  );

  const startNew = () => { setForm(blankStaff(staff, todayStr())); setEditing("new"); setErr(""); };
  const startEdit = (s) => { setForm({ ...s }); setEditing(s.id); setErr(""); };
  const close = () => { setEditing(null); setErr(""); };

  const save = () => {
    const problem = validateStaff(form);
    if (problem) return setErr(problem);
    const isNew = editing === "new";
    const rec = makeStaff(form, { id: isNew ? uid() : editing, createdAt: form.createdAt || todayStr() });
    setStaff((list) => (isNew ? [...list, rec] : list.map((s) => (s.id === editing ? rec : s))));
    log("settings", `${isNew ? "Added" : "Updated"} staff — ${rec.name}`);
    notify(`✓ ${rec.name} saved`);
    close();
  };

  // Deactivate, never delete: past bills and appointments carry a staffId, and deleting the
  // record would leave every one of them attributed to nobody.
  const toggleActive = (s) => {
    const next = s.active === false;
    if (!next && !confirm(`Mark ${s.name} as no longer working here? Their past bills and commission history stay intact.`)) return;
    setStaff((list) => list.map((x) => (x.id === s.id ? { ...x, active: next } : x)));
    log("settings", `${next ? "Re-activated" : "Deactivated"} staff — ${s.name}`);
    notify(next ? `${s.name} re-activated` : `${s.name} deactivated`);
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <Header title="Staff" sub={`${activeStaff(staff).length} working`}>
        {tab === "team" && <button className="btn primary big" onClick={startNew}>+ Add staff</button>}
      </Header>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["team", "Team"], ["payouts", "Commission & payouts"], ["performance", "Performance"]].map(([k, label]) => (
          <button key={k} className={"btn" + (tab === k ? " primary" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "payouts" && <StaffPayouts staff={staff} sales={sales} store={store} />}
      {tab === "performance" && <StaffPerformance staff={staff} sales={sales} appointments={appointments} />}

      {tab === "team" && <>
      <section style={{ ...S.panel, marginBottom: 14 }}>
        <label style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show people who no longer work here
        </label>
      </section>

      {listed.length === 0 ? (
        <Empty text="No staff yet.">
          <button className="btn primary" onClick={startNew}>Add the first stylist</button>
        </Empty>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {listed.map((s) => (
            <section key={s.id} style={{ ...S.panel, opacity: s.active === false ? 0.55 : 1, borderTop: `3px solid ${s.color}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: s.color, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, flexShrink: 0 }}>
                  {String(s.name || "?").trim().charAt(0).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>{s.role || "—"}</div>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-mid, #5E7468)", marginTop: 10, lineHeight: 1.7 }}>
                <div>Default commission · <b>{s.commissionPctDefault}%</b></div>
                {s.phone && <div>☎ {formatPhone(s.phone)}</div>}
                {s.active === false && <div style={{ color: "#C44536", fontWeight: 600 }}>No longer working here</div>}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => startEdit(s)}>Edit</button>
                <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => toggleActive(s)}>
                  {s.active === false ? "Re-activate" : "Deactivate"}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      </>}

      {editing && (
        <Modal title={editing === "new" ? "Add staff" : "Edit staff"} onClose={close}>
          <Field label="Name"><input className="input" autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Role"><input className="input" placeholder="e.g. Hair Stylist" value={form.role} onChange={(e) => set("role", e.target.value)} /></Field>
            <Field label="Phone"><input className="input" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          </div>
          <Field label="Default commission %">
            <input className="input" inputMode="decimal" value={form.commissionPctDefault} onChange={(e) => set("commissionPctDefault", e.target.value)} />
          </Field>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: -6, marginBottom: 10 }}>
            Used when a service doesn't set its own commission rate.
          </div>
          <Field label="Colour on the appointment grid">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STAFF_COLORS.map((c) => (
                <button
                  key={c} type="button" onClick={() => set("color", c)}
                  aria-label={`Colour ${c}`}
                  style={{
                    width: 28, height: 28, borderRadius: "50%", background: c, cursor: "pointer",
                    border: String(form.color).toLowerCase() === c.toLowerCase() ? "3px solid #334" : "1px solid #DDE5DF",
                  }}
                />
              ))}
            </div>
          </Field>
          {err && <div style={{ color: "#B23B2E", fontSize: 12.5, marginTop: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}


export { Staff };
export default Staff;
