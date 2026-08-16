// Udhari — extracted from salon-manager.jsx.

import { INR, money, todayStr, uid } from "../lib/ui/format.js";
import { nowTime } from "../lib/ui/clock.js";
import { Fragment, useMemo, useState } from "react";
import { S } from "../lib/ui/css.js";
import { Card, Empty, Field, Header } from "../components/primitives.jsx";

// ---------- Udhari / Credit (outstanding by customer) ----------
// Standalone top-level view. Outstanding is tracked across ALL time — a debt isn't
// period-bound — so this reads the full sales list rather than a date-filtered slice.
const billOut = (s) => Math.max(0, money((s.total || 0) - (s.paid || 0)));
// Minutes since midnight from a stored time like "02:15 pm" / "10:05 am (back-dated)"; -1 if unknown.
const timeToMin = (t) => {
  const m = String(t || "").match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return -1;
  let h = +m[1]; const ap = (m[3] || "").toLowerCase();
  if (ap) { h = h % 12; if (ap === "pm") h += 12; }
  return h * 60 + (+m[2]);
};
// Newest-first comparator for {date,time} records: date descending, then time descending.
const byDateTimeDesc = (a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : timeToMin(b.time) - timeToMin(a.time));

function Udhari({ sales, setSales, notify, log }) {
  const [openCust, setOpenCust] = useState(() => new Set()); // expanded customer names
  const [openBills, setOpenBills] = useState(() => new Set()); // expanded bills (showing order details)
  const [paying, setPaying] = useState(null); // the sale (bill) a repayment is being recorded against
  const [payAmt, setPayAmt] = useState("");
  const [payMode, setPayMode] = useState("Cash");

  const udhari = useMemo(() => {
    const u = sales.filter((s) => s.payment === "Udhari");
    const byCust = {};
    u.forEach((s) => {
      const out = billOut(s);
      const name = (s.customer || "").trim() || "(no name)";
      const c = byCust[name] || (byCust[name] = { name, mobile: "", outstanding: 0, total: 0, bills: 0, billList: [] });
      c.outstanding += out; c.total += (s.total || 0); c.bills += 1;
      c.billList.push(s);
      if (s.mobile) c.mobile = s.mobile;
    });
    const customers = Object.values(byCust).map((c) => ({
      ...c, outstanding: money(c.outstanding), total: money(c.total),
      // Newest bills first (date then time descending).
      billList: [...c.billList].sort(byDateTimeDesc),
    })).sort((a, b) => b.outstanding - a.outstanding);
    return { customers, count: u.length, totalOutstanding: money(u.reduce((a, s) => a + billOut(s), 0)), withDue: customers.filter((c) => c.outstanding > 0) };
  }, [sales]);

  // A chronological ledger of every udhari event: credit given (bill date) and each repayment
  // (from the payments ledger; legacy/uncaptured paid amounts reconcile to the bill date).
  const history = useMemo(() => {
    const events = [];
    sales.filter((s) => s.payment === "Udhari").forEach((s) => {
      const who = (s.customer || "").trim() || "(no name)";
      events.push({ id: s.id + "-c", date: s.date, time: s.time || "", kind: "credit", who, amount: money(s.total || 0) });
      const ledger = Array.isArray(s.payments) ? s.payments : [];
      let ledgerSum = 0;
      ledger.forEach((p, i) => {
        const amt = money(p.amount || 0);
        ledgerSum += amt;
        events.push({ id: `${s.id}-p${p.id || i}`, date: p.date || s.date, time: p.time || "", kind: "paid", who, amount: amt, mode: p.mode || "—" });
      });
      const rem = money((s.paid || 0) - ledgerSum);
      if (rem > 0.005) events.push({ id: s.id + "-p0", date: s.date, time: s.time || "", kind: "paid", who, amount: rem, mode: s.paidMode || "—", atStart: true });
    });
    // Strictly newest-first: date descending, then time descending. On an exact tie the
    // repayment (the later action) sorts above the credit.
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      const tm = timeToMin(b.time) - timeToMin(a.time);
      if (tm) return tm;
      return a.kind === b.kind ? 0 : a.kind === "paid" ? -1 : 1;
    });
    const totalCredit = money(events.filter((e) => e.kind === "credit").reduce((a, e) => a + e.amount, 0));
    const totalPaid = money(events.filter((e) => e.kind === "paid").reduce((a, e) => a + e.amount, 0));
    return { events, totalCredit, totalPaid };
  }, [sales]);

  const toggle = (name) => setOpenCust((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleBill = (id) => setOpenBills((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // A repayment targets EITHER one bill ({type:"bill", id}) or a customer's whole balance
  // ({type:"customer", name}). Customer payments are split across their due bills.
  const openPay = (sale) => { setPaying({ type: "bill", id: sale.id }); setPayAmt(String(billOut(sale))); setPayMode(sale.paidMode || "Cash"); };
  // Pay against a customer's WHOLE outstanding — the lump sum is applied to their due bills
  // oldest-first (FIFO), so it settles the longest-standing debts before the newer ones.
  const openPayCustomer = (c) => { setPaying({ type: "customer", name: c.name }); setPayAmt(String(c.outstanding)); setPayMode("Cash"); };

  // Split a lump sum across bills (already oldest-first), returning [{bill, amount}] per bill touched.
  const allocateFIFO = (bills, amount) => {
    let remaining = money(amount);
    const parts = [];
    for (const b of bills) {
      if (remaining <= 0.005) break;
      const a = Math.min(billOut(b), remaining);
      if (a > 0.005) { parts.push({ bill: b, amount: money(a) }); remaining = money(remaining - a); }
    }
    return parts;
  };

  // Figures for whatever is being paid, read live from `sales` so the modal stays correct
  // even if the underlying records changed (e.g. edited elsewhere while it's open).
  const payingBill = paying?.type === "bill" ? sales.find((s) => s.id === paying.id) : null;
  // The customer's still-due bills, oldest-first for FIFO allocation.
  const payingCustBills = paying?.type === "customer"
    ? sales.filter((s) => s.payment === "Udhari" && ((((s.customer || "").trim() || "(no name)") === paying.name)) && billOut(s) > 0).sort((a, b) => byDateTimeDesc(b, a))
    : null;
  const payOut = paying?.type === "bill"
    ? (payingBill ? billOut(payingBill) : 0)
    : (paying?.type === "customer" ? money((payingCustBills || []).reduce((a, s) => a + billOut(s), 0)) : 0);
  const payWho = paying?.type === "bill" ? ((payingBill?.customer || "").trim() || "(no name)") : (paying?.name || "");
  const payAmtNum = Math.min(payOut, Math.max(0, money(+payAmt || 0)));
  const payRemaining = money(payOut - payAmtNum);
  // How a customer lump sum lands across their bills — preview and save use the same split.
  const payAlloc = paying?.type === "customer" ? allocateFIFO(payingCustBills || [], payAmtNum) : null;
  const payClears = payAlloc ? payAlloc.filter((p) => p.amount >= billOut(p.bill) - 0.005).length : 0;
  // Something concrete to pay against (a live bill, or a customer with ≥1 due bill).
  const payShow = !!paying && !!(payingBill || (payingCustBills && payingCustBills.length));

  const savePayment = () => {
    if (!paying) return setPaying(null);
    if (payAmtNum <= 0) return notify("Enter an amount greater than ₹0");
    const paidAtTime = nowTime();
    if (paying.type === "bill") {
      if (!payingBill) return setPaying(null);
      const newPaid = money((payingBill.paid || 0) + payAmtNum);
      const rem = money((payingBill.total || 0) - newPaid);
      // Single setSales → Sales History, dashboard and cloud sync all pick up the new paid/outstanding.
      // Also append a dated entry to the payments ledger so the History panel can show when it was paid.
      setSales((all) => all.map((x) => {
        if (x.id !== payingBill.id) return x;
        const payments = [...(x.payments || []), { id: uid(), date: todayStr(), time: paidAtTime, amount: payAmtNum, mode: payMode }];
        return { ...x, paid: newPaid, paidMode: payMode, payments };
      }));
      log("sale", `Udhari repayment ${INR(payAmtNum)} (${payMode}) from ${payWho}${rem > 0 ? ` — ${INR(rem)} still due` : " — bill cleared"}`);
      notify(`Recorded ${INR(payAmtNum)} (${payMode})${rem > 0 ? ` · ${INR(rem)} still due` : " · bill cleared 🎉"}`);
    } else {
      // Customer-level: apply the lump sum across their due bills oldest-first, stamping a dated
      // ledger entry on each bill it touches. One setSales updates every affected bill at once.
      const alloc = payAlloc || [];
      if (!alloc.length) return setPaying(null);
      const byId = {};
      alloc.forEach((p) => { byId[p.bill.id] = p.amount; });
      setSales((all) => all.map((x) => {
        const amt = byId[x.id];
        if (amt == null) return x;
        const payments = [...(x.payments || []), { id: uid(), date: todayStr(), time: paidAtTime, amount: amt, mode: payMode }];
        return { ...x, paid: money((x.paid || 0) + amt), paidMode: payMode, payments };
      }));
      const rem = money(payOut - payAmtNum);
      const nb = alloc.length;
      log("sale", `Udhari repayment ${INR(payAmtNum)} (${payMode}) from ${payWho} across ${nb} bill${nb === 1 ? "" : "s"}${rem > 0 ? ` — ${INR(rem)} still due` : " — all cleared"}`);
      notify(`Recorded ${INR(payAmtNum)} (${payMode}) across ${nb} bill${nb === 1 ? "" : "s"}${rem > 0 ? ` · ${INR(rem)} still due` : " · all cleared 🎉"}`);
    }
    setPaying(null);
  };

  return (
    <div>
      <Header title="Udhari / Credit" sub="Outstanding credit by customer, across all time." />
      <div className="cards" style={S.cards}>
        <Card label="Outstanding credit" value={INR(udhari.totalOutstanding)} sub={udhari.withDue.length + " customer(s) owe"} accent />
        <Card label="Udhari bills" value={udhari.count} sub="total credit bills" />
        <Card label="Top debtor" value={udhari.withDue[0] ? udhari.withDue[0].name : "—"} sub={udhari.withDue[0] ? INR(udhari.withDue[0].outstanding) : "—"} />
      </div>
      <section style={{ ...S.panel, marginBottom: 4 }}>
        <div style={S.panelHead}>Who owes you <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--text-mid, #8A9C90)", marginLeft: 8 }}>{udhari.withDue.length}</span></div>
        {udhari.withDue.length === 0 ? (
          <Empty text="No outstanding credit — all udhari settled. 🎉" />
        ) : (
          <table className="tbl">
            <thead><tr><th style={{ width: 18 }}></th><th>Customer</th><th>Mobile</th><th style={{ textAlign: "right" }}>Bills</th><th style={{ textAlign: "right" }}>Outstanding</th><th></th></tr></thead>
            <tbody>
              {udhari.withDue.map((c) => {
                const isOpen = openCust.has(c.name);
                const dueBills = c.billList.filter((b) => billOut(b) > 0);
                // One bill → pay it directly; several → pay the whole balance in one go (split
                // oldest-first). Either way the row itself still expands to pay a single bill.
                const payRow = () => (dueBills.length === 1 ? openPay(dueBills[0]) : openPayCustomer(c));
                return (
                  <Fragment key={c.name}>
                    <tr onClick={() => toggle(c.name)} style={{ cursor: "pointer" }}>
                      <td style={{ color: "var(--text-mid, #8A9C90)" }}>{isOpen ? "▾" : "▸"}</td>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td style={{ color: "#677" }}>{c.mobile || "—"}</td>
                      <td style={{ textAlign: "right" }}>{c.bills}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#C44536" }}>{INR(c.outstanding)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn small primary" onClick={(e) => { e.stopPropagation(); payRow(); }}>
                          {dueBills.length === 1 ? "Pay" : "Pay total"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && dueBills.map((b) => {
                      const billOpen = openBills.has(b.id);
                      const nLines = (b.lines || []).length;
                      return (
                        <Fragment key={b.id}>
                          <tr onClick={() => toggleBill(b.id)} style={{ background: "var(--surface-2, #FAFBF8)", cursor: "pointer" }}>
                            <td></td>
                            <td colSpan={3} style={{ fontSize: 12.5, color: "#566" }}>
                              <span style={{ color: "var(--text-mid, #8A9C90)", marginRight: 4 }}>{billOpen ? "▾" : "▸"}</span>
                              {b.date}{b.time ? " · " + b.time : ""} · {nLines} item{nLines === 1 ? "" : "s"} · bill {INR(b.total)}{(b.paid || 0) > 0 ? ` · paid ${INR(b.paid)}${b.paidMode ? " (" + b.paidMode + ")" : ""}` : ""}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 700, color: "#C44536" }}>{INR(billOut(b))}</td>
                            <td style={{ textAlign: "right" }}>
                              <button className="btn small" onClick={(e) => { e.stopPropagation(); openPay(b); }}>Pay</button>
                            </td>
                          </tr>
                          {billOpen && (
                            <tr style={{ background: "var(--surface-2, #FAFBF8)" }}>
                              <td></td>
                              <td colSpan={5} style={{ paddingTop: 0 }}>
                                <div style={{ background: "var(--surface-2, #fff)", border: "1px solid var(--border, #EEF3EE)", borderRadius: 8, padding: "8px 12px" }}>
                                  {nLines === 0 ? (
                                    <div style={{ fontSize: 12.5, color: "var(--text-mid, #8A9C90)" }}>No line items on this bill.</div>
                                  ) : (b.lines).map((l, i) => (
                                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                                      <span>{l.name} × {l.qty}</span><span>{INR(l.amount)}</span>
                                    </div>
                                  ))}
                                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, borderTop: "1px dashed #DDE8DE", marginTop: 4, paddingTop: 4 }}>
                                    <span>Total</span><span>{INR(b.total)}</span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 8 }}>“Pay total” settles a customer's whole balance in one go (oldest bills first). Or tap a customer to expand and pay a single bill — full or part, Cash / UPI. Sales History updates automatically.</div>
      </section>

      <section style={{ ...S.panel, marginTop: 16 }}>
        <div style={S.panelHead}>
          History
          <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--text-mid, #8A9C90)", marginLeft: 8 }}>{history.events.length} event{history.events.length === 1 ? "" : "s"}</span>
          <span style={{ marginLeft: "auto", fontWeight: 500, fontSize: 12, color: "var(--text-mid, #8A9C90)", textTransform: "none", letterSpacing: 0 }}>
            Credit given <b style={{ color: "#C44536" }}>{INR(history.totalCredit)}</b> · Repaid <b style={{ color: "var(--brand)" }}>{INR(history.totalPaid)}</b>
          </span>
        </div>
        {history.events.length === 0 ? (
          <Empty text="No udhari/credit activity yet." />
        ) : (
          <table className="tbl">
            <thead><tr><th>Date &amp; time</th><th>Customer</th><th>Type</th><th style={{ textAlign: "right" }}>Amount</th><th>Mode</th></tr></thead>
            <tbody>
              {history.events.slice(0, 150).map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap", color: "#677" }}>{e.date}{e.time ? <span style={{ color: "#9AA" }}> {e.time}</span> : null}</td>
                  <td style={{ fontWeight: 600 }}>{e.who}</td>
                  <td>
                    {e.kind === "credit"
                      ? <span style={{ fontSize: 10.5, fontWeight: 800, color: "#C44536", border: "1px solid #C44536", borderRadius: 6, padding: "1px 6px" }}>CREDIT</span>
                      : <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--brand)", border: "1px solid var(--brand)", borderRadius: 6, padding: "1px 6px" }}>PAID</span>}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: e.kind === "credit" ? "#C44536" : "var(--brand)" }}>{e.kind === "credit" ? INR(e.amount) : "− " + INR(e.amount)}</td>
                  <td style={{ color: "#677", fontSize: 12 }}>{e.kind === "paid" ? (e.mode || "—") + (e.atStart ? " · at billing" : "") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {history.events.length > 150 && <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 8 }}>Showing the most recent 150 of {history.events.length} events.</div>}
      </section>

      {payShow && (
        // Close only when the press STARTS on the backdrop itself. Using onClick here would
        // also fire when a drag/tap that began inside the input releases over the backdrop,
        // closing the modal mid-payment.
        <div className="overlay" style={S.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setPaying(null); }}>
          <div className="modal" style={S.modal}>
            <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>{paying.type === "customer" ? "Pay total" : "Pay"}</h2>
            <div style={{ fontSize: 13, color: "#566", marginBottom: 14 }}>
              {paying.type === "customer" ? (
                <>
                  <b>{payWho}</b> · {payingCustBills.length} unpaid bill{payingCustBills.length === 1 ? "" : "s"} · <span style={{ color: "#C44536", fontWeight: 600 }}>outstanding {INR(payOut)}</span>
                </>
              ) : (
                <>
                  <b>{payWho}</b> · {payingBill.date} · bill {INR(payingBill.total)}
                  {(payingBill.paid || 0) > 0 ? ` · already paid ${INR(payingBill.paid)}` : ""} · <span style={{ color: "#C44536", fontWeight: 600 }}>outstanding {INR(payOut)}</span>
                </>
              )}
            </div>
            <Field label="Amount received">
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input className="input" style={{ flex: 1 }} type="number" inputMode="decimal" min="0" step="0.01" max={payOut} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} autoFocus aria-label="Amount received" />
                <button className="btn small ghost" onClick={() => setPayAmt(String(payOut))}>Full</button>
              </div>
            </Field>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", fontWeight: 600 }}>Paid via</span>
              {["Cash", "UPI"].map((m) => (
                <button key={m} className={"btn small " + (payMode === m ? "primary" : "ghost")} onClick={() => setPayMode(m)}>{m}</button>
              ))}
            </div>
            <div style={{ fontSize: 13, textAlign: "right", marginBottom: paying.type === "customer" && payAmtNum > 0 ? 4 : 14, fontWeight: 600 }}>
              Paying {INR(payAmtNum)} ({payMode})
              {payRemaining > 0
                ? <span style={{ color: "#C44536" }}> · remaining {INR(payRemaining)}</span>
                : <span style={{ color: "var(--brand)" }}> · {paying.type === "customer" ? "clears all bills 🎉" : "clears this bill 🎉"}</span>}
            </div>
            {paying.type === "customer" && payAmtNum > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", textAlign: "right", marginBottom: 14 }}>
                Applied oldest bills first{payClears > 0 ? ` · clears ${payClears} bill${payClears === 1 ? "" : "s"}` : ""}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setPaying(null)}>Cancel</button>
              <button className="btn primary" onClick={savePayment} disabled={payAmtNum <= 0}>Pay</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export { Udhari };
export default Udhari;
