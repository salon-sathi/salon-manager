// Dashboard — extracted from salon-manager.jsx.

import { ChartCard, DASH_PERIODS, barLabel, buildDaily, buildSeries, buildWeekly, inrTick, renderPayMix, renderPayTrend } from "../components/chartkit.jsx";
import { Card, Empty, Header } from "../components/primitives.jsx";
import { STATUS_COLORS as APPT_STATUS_COLORS, STATUS_LABELS as APPT_STATUS_LABELS, dayAppointments, dayStats, summarizeServices, toClock } from "../lib/appointments.js";
import { staffName } from "../lib/salon.js";
import { inventoryValue } from "../lib/stats.js";
import { S } from "../lib/ui/css.js";
import { INR, dateStr, money, todayStr } from "../lib/ui/format.js";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";

// ---------- Today's appointments (shared panel) ----------
// The single most useful thing on any salon screen: who is coming in, when, and to whom.
function TodayAppointments({ appointments, customers, staff, services, date, goAppointments }) {
  const day = useMemo(() => dayAppointments(appointments, date).filter((a) => a.status !== "blocked"), [appointments, date]);
  const byPhone = useMemo(() => new Map(customers.map((c) => [c.phone, c])), [customers]);

  return (
    <section style={S.panel}>
      <div style={{ ...S.panelHead, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{date === todayStr() ? "Today's appointments" : `Appointments · ${date}`}{day.length > 0 && <span style={{ fontWeight: 400, color: "var(--text-mid, #8A9C90)" }}> · {day.length}</span>}</span>
        {goAppointments && <button className="btn ghost" style={{ fontSize: 12 }} onClick={goAppointments}>Open diary</button>}
      </div>
      {day.length === 0 ? (
        <Empty text="Nothing in the diary.">
          {goAppointments && <button className="btn primary" onClick={goAppointments}>Book someone in</button>}
        </Empty>
      ) : (
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {day.map((a) => {
            const cust = a.customerPhone ? byPhone.get(a.customerPhone) : null;
            const names = summarizeServices(a.serviceIds, services).names;
            const done = a.status === "completed";
            const dead = a.status === "cancelled" || a.status === "no-show";
            return (
              <div key={a.id} style={{ ...S.row, opacity: dead ? 0.5 : 1, alignItems: "flex-start" }}>
                <span style={{ display: "flex", gap: 8, minWidth: 0 }}>
                  <b style={{ color: "var(--brand)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{toClock(a.startMin)}</b>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600, textDecoration: a.status === "cancelled" ? "line-through" : "none" }}>
                      {cust?.name || "Walk-in"}
                    </span>
                    <span style={{ color: "var(--text-mid, #8A9C90)", fontSize: 12 }}> · {staffName(staff, a.staffId)}</span>
                    {names.length > 0 && <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)" }}>{names.join(", ")}</div>}
                  </span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: APPT_STATUS_COLORS[a.status], whiteSpace: "nowrap" }}>
                  {done ? "✓ " : ""}{APPT_STATUS_LABELS[a.status]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- Worker dashboard ----------
// What a biller or inventory user sees instead of the owner's dashboard. Deliberately narrow:
// today's diary, and the bills THEY rang up. Not the shop's takings, not the month, not profit.
//
// This is a UI control, not a boundary — workers can read the sales slice because the POS
// cannot work otherwise (see the README). It exists so the counter screen shows a worker their
// own job rather than the owner's books, not because it makes the numbers unreachable.
function WorkerDashboard({ sales, appointments, customers, staff, services, user, goBilling, goAppointments }) {
  const date = todayStr();
  const mine = useMemo(
    () => sales.filter((s) => s.date === date && s.billedByUid && s.billedByUid === user?.uid),
    [sales, date, user?.uid]
  );
  const myTotal = money(mine.reduce((a, s) => a + (s.total || 0), 0));
  const niceDate = new Date(date + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <Header title="Today" sub={niceDate}>
        <button className="btn primary big" onClick={goBilling}>Start billing</button>
      </Header>
      <div className="cards" style={S.cards}>
        <Card label="Your bills today" value={mine.length} sub="rung up on this account" />
        <Card label="You billed" value={INR(myTotal)} sub="total across your bills today" accent />
        <Card label="In the diary" value={dayStats(appointments, date).total} sub="appointments today" />
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <TodayAppointments appointments={appointments} customers={customers} staff={staff} services={services} date={date} goAppointments={goAppointments} />
        <section style={S.panel}>
          <div style={S.panelHead}>Your bills today</div>
          {mine.length === 0 ? (
            <Empty text="You haven't billed anything yet today.">
              <button className="btn primary" onClick={goBilling}>Start billing</button>
            </Empty>
          ) : (
            [...mine].reverse().map((s) => (
              <div key={s.id} style={S.row}>
                <span>{s.time} · {s.customer || "Walk-in"}</span>
                <b>{INR(s.total)}</b>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ items, sales, lowStock, goBilling, appointments = [], customers = [], staff = [], services = [], goAppointments }) {
  const [date, setDate] = useState(todayStr());
  const isToday = date === todayStr();
  const daySales = sales.filter((s) => s.date === date);
  const rev = money(daySales.reduce((a, s) => a + (s.total || 0), 0));
  const profit = money(daySales.reduce((a, s) => a + (s.profit || 0), 0));
  // Value of on-hand stock at cost. Reuse the shared helper (which coerces every
  // item's buyPrice/stock with Number(..)||0) so one item with a missing/blank
  // price can't turn the whole sum into NaN, and this card always matches the
  // Inventory "Stock value by category" total (inv.cost).
  const stockValue = inventoryValue(items).cost;
  const month = date.slice(0, 7);
  const monthSales = sales.filter((s) => s.date.startsWith(month));
  const monthRev = money(monthSales.reduce((a, s) => a + (s.total || 0), 0));
  const monthProfit = money(monthSales.reduce((a, s) => a + (s.profit || 0), 0));
  // Sales/revenue above are amounts BOOKED (they include Udhari/credit bills at full value).
  // These are the still-unpaid (on-credit) portions, shown as a sub-note so the gap is visible.
  const udhariOf = (list) => money(list.reduce((a, s) => a + (s.payment === "Udhari" ? Math.max(0, (s.total || 0) - (s.paid || 0)) : 0), 0));
  const dayUdhari = udhariOf(daySales);
  const monthUdhari = udhariOf(monthSales);
  const monthName = new Date(date + "T00:00").toLocaleDateString("en-IN", { month: "long" });
  const niceDate = new Date(date + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const trend = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 13);
    return buildSeries(sales, [], dateStr(d), todayStr());
  }, [sales]);

  // --- "Over time" charts: user picks a period, we show day-wise & week-wise series. ---
  const [period, setPeriod] = useState("7d");
  const [customFrom, setCustomFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return dateStr(d); });
  const [customTo, setCustomTo] = useState(todayStr());
  const range = useMemo(() => {
    if (period === "custom") return { from: customFrom, to: customTo };
    const opt = DASH_PERIODS.find((p) => p[0] === period);
    const d = new Date(); (opt?.[2] || (() => {}))(d);
    return { from: dateStr(d), to: todayStr() };
  }, [period, customFrom, customTo]);
  const dailySeries = useMemo(() => buildDaily(sales, range.from, range.to), [sales, range.from, range.to]);
  const weeklySeries = useMemo(() => buildWeekly(sales, range.from, range.to), [sales, range.from, range.to]);
  const rangeLabel = useMemo(() => {
    const f = (ds) => new Date(ds + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    return range.from && range.to ? `${f(range.from)} – ${f(range.to)}` : "";
  }, [range]);

  // Fixed monthly overview: one bucket per calendar month from May 2026 through the current
  // month, regardless of the day picker above. Months with no sales show as zero bars.
  const monthly = useMemo(() => {
    const nowKey = todayStr().slice(0, 7);
    const keys = [];
    let y = 2026, m = 5; // start: May 2026
    const [ey, em] = nowKey.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      m++; if (m > 12) { m = 1; y++; }
    }
    const agg = Object.fromEntries(keys.map((k) => [k, { revenue: 0, profit: 0 }]));
    sales.forEach((s) => { const k = (s.date || "").slice(0, 7); if (agg[k]) { agg[k].revenue += s.total || 0; agg[k].profit += s.profit || 0; } });
    return keys.map((k) => ({
      key: k,
      label: new Date(k + "-01T00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
      revenue: money(agg[k].revenue),
      profit: money(agg[k].profit),
    }));
  }, [sales]);

  return (
    <div>
      <Header title="Dashboard" sub={niceDate}>
        <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>
          View day{" "}
          <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
        </label>
      </Header>
      <div className="cards" style={S.cards}>
        <Card label={isToday ? "Today's sales" : "Sales (this day)"} value={INR(rev)} sub={daySales.length + " bills" + (dayUdhari > 0 ? ` · ${INR(dayUdhari)} on udhari` : "")} />
        <Card label={isToday ? "Today's profit" : "Profit (this day)"} value={<>{INR(profit)} <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.85 }}>({rev > 0 ? Math.round((profit / rev) * 100) : 0}%)</span></>} sub="after item cost · % of sales" accent />
        <Card label={monthName + " revenue"} value={INR(monthRev)} sub={"month to date" + (monthUdhari > 0 ? ` · ${INR(monthUdhari)} on udhari` : "")} />
        <Card label={monthName + " profit"} value={<>{INR(monthProfit)} <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.85 }}>({monthRev > 0 ? Math.round((monthProfit / monthRev) * 100) : 0}%)</span></>} sub="month to date · after item cost · % of sales" accent />
        <Card label="Stock value" value={INR(stockValue)} sub={items.length + " items (at cost)"} />
      </div>

      {/* The diary sits directly under the numbers: the day's bookings are what the owner
          actually acts on, and they'd be buried below the charts anywhere else. */}
      <div style={{ marginTop: 16 }}>
        <TodayAppointments
          appointments={appointments} customers={customers} staff={staff} services={services}
          date={date} goAppointments={goAppointments}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartCard title="Sales — last 14 days" height={200}>
          <BarChart data={trend} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} interval={0} minTickGap={0} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} />
            <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", letterSpacing: ".02em", margin: "22px 0 8px" }}>
        Monthly overview <span style={{ fontWeight: 500, color: "var(--text-mid, #8A9C90)" }}>(from May 2026)</span>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Monthly revenue" height={220}>
          <BarChart data={monthly} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} />
            <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Monthly profit" height={220}>
          <BarChart data={monthly} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} />
            <Bar dataKey="profit" name="Profit" fill="#E8A33D" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
      </div>
      <div style={{ marginTop: 16 }}>
        <ChartCard title="Monthly revenue vs profit" height={240}>
          <BarChart data={monthly} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} label={barLabel} />
            <Bar dataKey="profit" name="Profit" fill="#E8A33D" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
      </div>

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "22px 0 8px" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", letterSpacing: ".02em" }}>Revenue &amp; profit over time</span>
        <select className="input" style={{ width: "auto" }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {DASH_PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {period === "custom" && (
          <>
            <input type="date" className="input" style={{ width: "auto" }} value={customFrom} max={customTo || todayStr()} onChange={(e) => setCustomFrom(e.target.value)} />
            <span style={{ color: "var(--text-mid, #8A9C90)" }}>to</span>
            <input type="date" className="input" style={{ width: "auto" }} value={customTo} max={todayStr()} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
        {rangeLabel && <span style={{ fontSize: 12, color: "var(--text-mid, #8A9C90)" }}>{rangeLabel}</span>}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: "#4A5D52", margin: "10px 0 6px" }}>Day wise</div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Day wise revenue" height={220}>
          <BarChart data={dailySeries} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} />
            <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Day wise profit" height={220}>
          <BarChart data={dailySeries} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} />
            <Bar dataKey="profit" name="Profit" fill="#E8A33D" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
      </div>
      <div style={{ marginTop: 16 }}>
        <ChartCard title="Day wise revenue vs profit" height={240}>
          <BarChart data={dailySeries} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} label={barLabel} />
            <Bar dataKey="profit" name="Profit" fill="#E8A33D" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: "#4A5D52", margin: "18px 0 6px" }}>Week wise <span style={{ fontWeight: 500, color: "var(--text-mid, #8A9C90)" }}>(week starting Mon)</span></div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Week wise revenue" height={220}>
          <BarChart data={weeklySeries} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} labelFormatter={(l) => "Week of " + l} />
            <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Week wise profit" height={220}>
          <BarChart data={weeklySeries} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} labelFormatter={(l) => "Week of " + l} />
            <Bar dataKey="profit" name="Profit" fill="#E8A33D" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
      </div>
      <div style={{ marginTop: 16 }}>
        <ChartCard title="Week wise revenue vs profit" height={240}>
          <BarChart data={weeklySeries} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
            <Tooltip formatter={(v) => INR(v)} labelFormatter={(l) => "Week of " + l} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} label={barLabel} />
            <Bar dataKey="profit" name="Profit" fill="#E8A33D" radius={[3, 3, 0, 0]} label={barLabel} />
          </BarChart>
        </ChartCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartCard title={`Payments in ${monthName} — Total vs Cash vs UPI`} height={200}>
          {renderPayMix(monthSales)}
        </ChartCard>
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartCard title="Total vs Cash vs UPI — last 14 days" height={200}>
          {renderPayTrend(trend)}
        </ChartCard>
      </div>

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <section style={S.panel}>
          <div style={S.panelHead}>
            Low stock — reorder soon
            {lowStock.length > 0 && <span style={{ ...S.badge, position: "static", marginLeft: 8 }}>{lowStock.length}</span>}
          </div>
          {lowStock.length === 0 ? (
            <Empty text="All items are well stocked." />
          ) : (
            lowStock.slice(0, 8).map((i) => (
              <div key={i.id} style={S.row}>
                <span>{i.name}</span>
                <span style={{ color: "#C44536", fontWeight: 700 }}>{i.stock} {i.unit} left</span>
              </div>
            ))
          )}
        </section>
        <section style={S.panel}>
          <div style={S.panelHead}>{isToday ? "Recent bills" : "Bills on this day"}</div>
          {daySales.length === 0 ? (
            <Empty text={isToday ? "No bills yet today." : "No bills on this day."}>
              {isToday && <button className="btn primary" onClick={goBilling}>Start billing</button>}
            </Empty>
          ) : (
            [...daySales].reverse().slice(0, 8).map((s) => (
              <div key={s.id} style={S.row}>
                <span>{s.time} · {s.lines.length} items</span>
                <b>{INR(s.total)}</b>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}


export { WorkerDashboard, Dashboard };
export default Dashboard;
