// Customers — extracted from salon-manager.jsx.

import { CustomerForm, makeCustomer, validateCustomer } from "../components/CustomerPicker.jsx";
import { ServiceIconChip } from "../components/ServiceIcon.jsx";
import { Card, Empty, Header, Modal } from "../components/primitives.jsx";
import { addDays } from "../lib/appointments.js";
import { billsForCustomer, blankCustomer, formatPhone } from "../lib/customers.js";
import { TIER_COLORS, daysBetweenISO, loyaltyRules, nextTierGap, pointsBalance, pointsLedger, redeemValueOf, redeemablePackages, rollingSpend, tierFor } from "../lib/loyalty.js";
import { SEGMENTS, SEGMENT_COLORS, SEGMENT_HINTS, fillTemplate, segmentAll, templateVars, waLink } from "../lib/reminders.js";
import { isServiceLine, serviceById, staffName } from "../lib/salon.js";
import { resolveIcon } from "../lib/serviceIcons.js";
import { S } from "../lib/ui/css.js";
import { INR, money, todayStr } from "../lib/ui/format.js";
import { useMemo, useState } from "react";

// ---------- Customers (owner only) ----------
// The customer database, and each customer's profile. A biller can look someone up to bill
// them (the picker) but cannot browse this list — see roles.js: customers.pick vs
// customers.browse. RTDB can't enforce that split, so it's a UI control; the README says so.
function Customers({ customers, sales, services, staff, customerPackages, config, store, setCustomers, notify, log }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  const [segment, setSegment] = useState("All");
  const [editing, setEditing] = useState(null); // phone | "new"
  const [form, setForm] = useState(blankCustomer());
  const [err, setErr] = useState("");
  const [profile, setProfile] = useState(null); // phone whose profile is open

  // RFM segmentation. Rule-based rather than quintile-scored: a 30-customer salon has no
  // meaningful quintiles, and "hasn't been in for 90 days" is something an owner can act on
  // in a way that "RFM score 3-4-2" is not.
  const { rows: segmented, counts: segCounts } = useMemo(
    () => segmentAll(customers, todayStr()),
    [customers]
  );

  const listed = useMemo(() => {
    const query = q.trim().toLowerCase();
    const digits = query.replace(/\D+/g, "");
    const rows = segmented.filter((c) =>
      (segment === "All" || c.segment === segment) &&
      (!query ||
        String(c.name || "").toLowerCase().includes(query) ||
        (digits && String(c.phone || "").includes(digits)))
    );
    const cmp = {
      recent: (a, b) => String(b.lastVisitAt || "").localeCompare(String(a.lastVisitAt || "")),
      spend: (a, b) => (b.totalSpend || 0) - (a.totalSpend || 0),
      visits: (a, b) => (b.totalVisits || 0) - (a.totalVisits || 0),
      name: (a, b) => String(a.name || "").localeCompare(String(b.name || "")),
    }[sort];
    return [...rows].sort(cmp);
  }, [segmented, q, sort, segment]);

  // Bulk WhatsApp for the filtered set: sequential deep links, each still sent by a human.
  const messageAll = () => {
    const withPhone = listed.filter((c) => c.phone);
    if (!withPhone.length) return;
    const body = window.prompt(
      `Message to send to ${withPhone.length} customer(s) in "${segment}".\n\n` +
      `{name} is replaced with each customer's first name.`,
      `Hi {name}! A little something from ${store?.name || "us"} — reply to book your next visit. 💇`
    );
    if (body == null || !body.trim()) return;
    if (!confirm(
      `Open a WhatsApp chat for each of ${withPhone.length} customer(s), one at a time?\n\n` +
      `You still press send in each. Your browser may ask to allow pop-ups.`
    )) return;
    withPhone.forEach((c, i) => {
      const text = fillTemplate(body, templateVars({ name: c.name, days: 0 }, store?.name));
      // Staggered: a burst of window.open() calls trips every pop-up blocker there is.
      setTimeout(() => window.open(waLink(c.phone, text), "_blank", "noopener"), i * 700);
    });
    log("settings", `Bulk message opened for ${withPhone.length} customer(s) — segment ${segment}`);
    notify(`Opening ${withPhone.length} chat(s) — press send in each`);
  };

  const startNew = () => { setForm(blankCustomer("", todayStr())); setEditing("new"); setErr(""); };
  const startEdit = (c) => { setForm({ ...c }); setEditing(c.phone); setErr(""); };
  const close = () => { setEditing(null); setErr(""); };

  const save = () => {
    const isNew = editing === "new";
    const problem = validateCustomer(form, customers, isNew);
    if (problem) return setErr(problem);
    const rec = makeCustomer(form, { createdAt: todayStr() });
    setCustomers((list) => (isNew ? [...list, rec] : list.map((c) => (c.phone === editing ? { ...c, ...rec } : c))));
    log("settings", `${isNew ? "Added" : "Updated"} customer — ${rec.name} · ${formatPhone(rec.phone)}`);
    notify(`✓ ${rec.name} saved`);
    close();
  };

  // Deleting a customer does NOT touch their bills — the money stays on the books. It only
  // drops the profile, so the bills become walk-ins that still reference a phone nobody has a
  // record for. That's why this asks so explicitly.
  const remove = (c) => {
    const bills = billsForCustomer(sales, c.phone).length;
    const msg = bills
      ? `Delete ${c.name}'s profile? Their ${bills} bill(s) stay on the books and keep counting towards revenue — only the customer record, notes and occasion dates are removed.`
      : `Delete ${c.name}'s profile?`;
    if (!confirm(msg)) return;
    setCustomers((list) => list.filter((x) => x.phone !== c.phone));
    log("settings", `Deleted customer — ${c.name} · ${formatPhone(c.phone)}`);
    notify(`${c.name} removed`);
    if (profile === c.phone) setProfile(null);
  };

  const openProfile = customers.find((c) => c.phone === profile);

  return (
    <div>
      <Header title="Customers" sub={`${customers.length} on the books`}>
        <button className="btn primary big" onClick={startNew}>+ New customer</button>
      </Header>

      <section style={{ ...S.panel, marginBottom: 14 }}>
        {/* Segments first: "who should I be worrying about" comes before "find this person". */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <button className={"btn small " + (segment === "All" ? "primary" : "ghost")} onClick={() => setSegment("All")}>
            All ({customers.length})
          </button>
          {SEGMENTS.map((s) => (
            <button
              key={s} className={"btn small " + (segment === s ? "primary" : "ghost")}
              onClick={() => setSegment(s)} title={SEGMENT_HINTS[s]}
              style={segment === s ? { background: SEGMENT_COLORS[s], borderColor: SEGMENT_COLORS[s] } : { color: SEGMENT_COLORS[s] }}
            >
              {s} ({segCounts[s]})
            </button>
          ))}
        </div>
        {segment !== "All" && (
          <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", marginBottom: 10 }}>{SEGMENT_HINTS[segment]}</div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: "1 1 220px" }} placeholder="Search by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" style={{ width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Most recent visit</option>
            <option value="spend">Highest spend</option>
            <option value="visits">Most visits</option>
            <option value="name">Name (A–Z)</option>
          </select>
          {listed.length > 0 && (
            <button className="btn" onClick={messageAll} title="Opens a WhatsApp chat per customer, one at a time — you press send in each">
              💬 Message these {listed.length}
            </button>
          )}
        </div>
      </section>

      {listed.length === 0 ? (
        <Empty text={customers.length ? "No customers match." : "No customers yet — they're created as you bill them."} />
      ) : (
        <section style={S.panel}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Name</th><th>Phone</th><th>Segment</th>
                  <th style={{ textAlign: "right" }}>Visits</th>
                  <th style={{ textAlign: "right" }}>Spend</th>
                  <th>Last visit</th><th />
                </tr>
              </thead>
              <tbody>
                {listed.map((c) => (
                  <tr key={c.phone}>
                    <td>
                      <button
                        onClick={() => setProfile(c.phone)}
                        style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--brand)", cursor: "pointer", textAlign: "left" }}
                      >
                        {c.name || "(no name)"}
                      </button>
                      {/* The tier is the first thing worth knowing about a customer, so it
                          rides on the name rather than hiding in the profile. */}
                      {c.tier && (
                        <span style={{ background: TIER_COLORS[c.tier], color: "#fff", fontWeight: 800, fontSize: 9.5, padding: "1px 6px", borderRadius: 999, marginLeft: 6, letterSpacing: ".04em" }}>
                          {c.tier.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatPhone(c.phone)}</td>
                    <td>
                      <span style={{ color: SEGMENT_COLORS[c.segment], fontWeight: 700, fontSize: 12 }}>{c.segment}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>{c.totalVisits || 0}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{INR(c.totalSpend || 0)}</td>
                    <td style={{ whiteSpace: "nowrap", color: c.lastVisitAt ? "#334" : "#A8B8AE" }}>{c.lastVisitAt || "never"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => startEdit(c)}>Edit</button>{" "}
                      <button className="btn ghost" style={{ fontSize: 12, color: "#C44536" }} onClick={() => remove(c)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing && (
        <Modal title={editing === "new" ? "New customer" : "Edit customer"} onClose={close}>
          <CustomerForm value={form} onChange={setForm} isNew={editing === "new"} err={err} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" onClick={save}>Save customer</button>
          </div>
        </Modal>
      )}

      {openProfile && (
        <CustomerProfile
          customer={openProfile} sales={sales} services={services} staff={staff}
          customerPackages={customerPackages} config={config}
          onClose={() => setProfile(null)} onEdit={() => { setProfile(null); startEdit(openProfile); }}
        />
      )}
    </div>
  );
}

// ---------- Customer profile ----------
// Phase 1 shows who they are and every bill they've had. Phase 3 adds the points ledger,
// packages and next-due services; Phase 4 adds their segment.
function CustomerProfile({ customer, sales, staff, services, customerPackages = [], config, onClose, onEdit }) {
  const bills = useMemo(() => billsForCustomer(sales, customer.phone).slice().reverse(), [sales, customer.phone]);
  const avg = customer.totalVisits ? money(customer.totalSpend / customer.totalVisits) : 0;
  const today = todayStr();
  const rules = useMemo(() => loyaltyRules(config), [config]);
  const ledger = useMemo(() => pointsLedger(customer.phone, sales), [customer.phone, sales]);
  const balance = useMemo(() => pointsBalance(customer.phone, sales), [customer.phone, sales]);
  const spend12 = useMemo(() => rollingSpend(customer.phone, sales, today), [customer.phone, sales, today]);
  const tier = useMemo(() => tierFor(customer.phone, sales, rules, today), [customer.phone, sales, rules, today]);
  const gap = useMemo(() => nextTierGap(spend12, rules), [spend12, rules]);
  const myPackages = useMemo(
    () => redeemablePackages(customerPackages, customer.phone, today),
    [customerPackages, customer.phone, today]
  );

  // Visit history draws an icon per service line. A bill line points at a service by id, but the
  // service may since have been renamed or taken off the menu — so fall back to resolving from
  // the name snapshotted on the line itself, which is what the customer actually had.
  const svcById = useMemo(() => new Map((services || []).map((s) => [s.id, s])), [services]);
  const lineIcon = (line) => resolveIcon(svcById.get(line.serviceId) || { name: line.name });

  // What they're due for next: for each service they've had, when its rebooking cycle lands.
  // Overdue first — that's the list worth acting on.
  const nextDue = useMemo(() => {
    const lastByService = new Map();
    for (const b of billsForCustomer(sales, customer.phone)) {
      for (const l of b.lines || []) {
        if (!isServiceLine(l) || !l.serviceId) continue;
        const prev = lastByService.get(l.serviceId);
        if (!prev || b.date > prev) lastByService.set(l.serviceId, b.date);
      }
    }
    const rows = [];
    for (const [serviceId, lastDate] of lastByService) {
      const svc = serviceById(services, serviceId);
      if (!svc || !svc.rebookCycleDays) continue; // 0 = one-off work, never due
      const due = addDays(lastDate, svc.rebookCycleDays);
      rows.push({ name: svc.name, lastDate, due, overdueBy: daysBetweenISO(due, today) });
    }
    return rows.sort((a, b) => b.overdueBy - a.overdueBy);
  }, [sales, customer.phone, services, today]);

  return (
    <Modal title={customer.name || formatPhone(customer.phone)} onClose={onClose}>
      {tier && (
        <div style={{ display: "inline-block", background: TIER_COLORS[tier], color: "#fff", fontWeight: 800, fontSize: 11.5, padding: "3px 10px", borderRadius: 999, marginBottom: 10, letterSpacing: ".04em" }}>
          {tier.toUpperCase()}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Card label="Visits" value={customer.totalVisits || 0} />
        <Card label="Total spend" value={INR(customer.totalSpend || 0)} accent />
        <Card label="Average bill" value={INR(avg)} />
        <Card label="Last visit" value={customer.lastVisitAt || "never"} />
        {rules.enabled && <Card label="Points" value={balance} sub={balance > 0 ? `worth ${INR(redeemValueOf(balance, rules))}` : "none yet"} />}
      </div>

      {rules.enabled && gap && (
        <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", marginBottom: 10 }}>
          {INR(spend12)} spent in the last 12 months · <b>{INR(gap.need)}</b> more to reach {gap.tier}.
        </div>
      )}

      <div style={{ fontSize: 12.5, color: "var(--text-mid, #5E7468)", lineHeight: 1.8, marginBottom: 12 }}>
        <div>☎ {formatPhone(customer.phone)}</div>
        {customer.dob && <div>🎂 Birthday · {customer.dob.replace("-", " / ")}</div>}
        {customer.anniversary && <div>💐 Anniversary · {customer.anniversary.replace("-", " / ")}</div>}
        {customer.notes && <div style={{ marginTop: 6, whiteSpace: "pre-line", color: "#334" }}>📝 {customer.notes}</div>}
      </div>

      {myPackages.length > 0 && (
        <>
          <div style={S.panelHead}>Packages</div>
          {myPackages.map((cp) => {
            const left = daysBetweenISO(today, cp.expiresAt);
            return (
              <div key={cp.id} style={S.row}>
                <span>🎁 {cp.name}</span>
                <span style={{ fontSize: 12.5 }}>
                  <b>{cp.usesLeft}</b> of {cp.totalUses} left ·{" "}
                  <span style={{ color: left <= 14 ? "#C44536" : "var(--text-mid, #8A9C90)", fontWeight: left <= 14 ? 700 : 400 }}>
                    {left <= 14 ? `expires in ${left}d` : `until ${cp.expiresAt}`}
                  </span>
                </span>
              </div>
            );
          })}
        </>
      )}

      {nextDue.length > 0 && (
        <>
          <div style={{ ...S.panelHead, marginTop: 12 }}>Next due</div>
          {nextDue.slice(0, 5).map((d) => (
            <div key={d.name} style={S.row}>
              <span>{d.name}</span>
              <span style={{ fontSize: 12.5, color: d.overdueBy > 0 ? "#C44536" : "var(--text-mid, #8A9C90)", fontWeight: d.overdueBy > 0 ? 700 : 400 }}>
                {d.overdueBy > 0 ? `${d.overdueBy}d overdue` : d.overdueBy === 0 ? "due today" : `due ${d.due}`}
              </span>
            </div>
          ))}
        </>
      )}

      {rules.enabled && ledger.length > 0 && (
        <>
          <div style={{ ...S.panelHead, marginTop: 12 }}>Points ledger</div>
          <div style={{ maxHeight: 140, overflowY: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead><tr><th>Date</th><th style={{ textAlign: "right" }}>Earned</th><th style={{ textAlign: "right" }}>Used</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                    <td style={{ textAlign: "right", color: r.earned ? "var(--brand)" : "#C3CFC7" }}>{r.earned ? `+${r.earned}` : "—"}</td>
                    <td style={{ textAlign: "right", color: r.redeemed ? "#C44536" : "#C3CFC7" }}>{r.redeemed ? `−${r.redeemed}` : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{r.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={{ ...S.panelHead, marginTop: 4 }}>Visit history</div>
      {bills.length === 0 ? (
        <Empty text="No bills yet." />
      ) : (
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <thead><tr><th>Date</th><th>What they had</th><th style={{ textAlign: "right" }}>Paid</th></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{b.date}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {(b.lines || []).map((l, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, color: isServiceLine(l) ? "#334" : "var(--text-mid, #6B7E74)" }}>
                        {isServiceLine(l) && <ServiceIconChip icon={lineIcon(l)} size={20} />}
                        <span>
                          {l.name}
                          {l.qty > 1 ? ` ×${l.qty}` : ""}
                          {isServiceLine(l) && l.staffId ? <span style={{ color: "var(--text-mid, #8A9C90)" }}> · {staffName(staff, l.staffId)}</span> : null}
                        </span>
                      </div>
                    ))}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{INR(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={onEdit}>Edit customer</button>
      </div>
    </Modal>
  );
}


export { Customers };
export default Customers;
