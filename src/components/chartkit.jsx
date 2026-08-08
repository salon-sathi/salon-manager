// Chart scaffolding shared by the dashboard, Finance, Stats and the staff reports.

import { DOW, DOW_ORDER, formatINR, hourLabel, inrCompact } from "../lib/stats.js";
import { S } from "../lib/ui/css.js";
import { INR, dateStr, money } from "../lib/ui/format.js";
import { Empty } from "./primitives.jsx";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// ---------- Finance analytics helpers ----------
const PIE_COLORS = ["#1b5e43", "#E8A33D", "#2A6FB0", "#C44536", "#7A5AB0", "#3DA17A", "#B0762A", "var(--text-mid, #8A9C90)"];
const inrTick = (v) => "₹" + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "k" : v);
// Value labels sitting on top of vertical bars (compact ₹). Zeros are hidden so
// sparse charts stay uncluttered.
const barLabel = { position: "top", formatter: (v) => (v ? inrTick(v) : ""), fontSize: 9.5, fill: "#465" };

// Resolve a period preset (+ optional custom range) to { from, to, label }.
// `earliest` (a YYYY-MM-DD) is only consulted for the "allTime" preset — the caller
// passes the oldest record date so "All time" spans exactly the real data.
function periodRange(preset, cfrom, cto, earliest) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const som = (yy, mm) => dateStr(new Date(yy, mm, 1));
  const eom = (yy, mm) => dateStr(new Date(yy, mm + 1, 0));
  switch (preset) {
    case "lastMonth": { const d = new Date(y, m - 1, 1); return { from: som(d.getFullYear(), d.getMonth()), to: eom(d.getFullYear(), d.getMonth()), label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) }; }
    case "thisYear": return { from: dateStr(new Date(y, 0, 1)), to: dateStr(now), label: "Year " + y };
    case "last7": { const d = new Date(); d.setDate(d.getDate() - 6); return { from: dateStr(d), to: dateStr(now), label: "Last 7 days" }; }
    case "last14": { const d = new Date(); d.setDate(d.getDate() - 13); return { from: dateStr(d), to: dateStr(now), label: "Last 14 days" }; }
    case "last30": { const d = new Date(); d.setDate(d.getDate() - 29); return { from: dateStr(d), to: dateStr(now), label: "Last 30 days" }; }
    case "last45": { const d = new Date(); d.setDate(d.getDate() - 44); return { from: dateStr(d), to: dateStr(now), label: "Last 45 days" }; }
    // Month-based windows: new Date(y, m-N, day) rolls the year correctly and clamps overflow days.
    case "last2m": { const d = new Date(y, m - 2, now.getDate()); return { from: dateStr(d), to: dateStr(now), label: "Last 2 months" }; }
    case "lastQuarter": { const d = new Date(y, m - 3, now.getDate()); return { from: dateStr(d), to: dateStr(now), label: "Last 3 months" }; }
    case "last6m": { const d = new Date(y, m - 6, now.getDate()); return { from: dateStr(d), to: dateStr(now), label: "Last 6 months" }; }
    // All data on record: from the oldest entry — i.e. when the shop's books begin —
    // up to today. The label surfaces that start date so it's clear where "all time" begins.
    case "allTime": {
      const start = earliest || dateStr(new Date(y - 5, 0, 1));
      const since = earliest ? new Date(earliest + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
      return { from: start, to: dateStr(now), label: since ? `All time · since ${since}` : "All time" };
    }
    case "custom": return { from: cfrom || dateStr(now), to: cto || dateStr(now), label: `${cfrom || "…"} → ${cto || "…"}` };
    default: return { from: som(y, m), to: dateStr(now), label: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
  }
}

// Build a daily (or monthly, for long ranges) revenue/profit/expense series.
function buildSeries(sales, expenses, from, to) {
  const start = new Date(from + "T00:00"), end = new Date(to + "T00:00");
  if (isNaN(start) || isNaN(end) || end < start) return [];
  const monthly = (end - start) / 86400000 > 62;
  const keyOf = (ds) => (monthly ? ds.slice(0, 7) : ds);
  const labelOf = (k) => (monthly
    ? new Date(k + "-01T00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
    : new Date(k + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
  const buckets = new Map();
  if (monthly) { let d = new Date(start.getFullYear(), start.getMonth(), 1); while (d <= end) { const k = dateStr(d).slice(0, 7); buckets.set(k, { key: k, label: labelOf(k), revenue: 0, profit: 0, expenses: 0, cash: 0, upi: 0 }); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); } }
  else { const d = new Date(start); while (d <= end) { const k = dateStr(d); buckets.set(k, { key: k, label: labelOf(k), revenue: 0, profit: 0, expenses: 0, cash: 0, upi: 0 }); d.setDate(d.getDate() + 1); } }
  sales.forEach((s) => { const b = buckets.get(keyOf(s.date)); if (b) { b.revenue += s.total; b.profit += s.profit; if (s.payment === "Cash") b.cash += s.total; else if (s.payment === "UPI") b.upi += s.total; } });
  expenses.forEach((e) => { const b = buckets.get(keyOf(e.date)); if (b) b.expenses += e.amount; });
  return [...buckets.values()].map((b) => ({ ...b, revenue: money(b.revenue), profit: money(b.profit), expenses: money(b.expenses), cash: money(b.cash), upi: money(b.upi) }));
}

// Day-wise revenue/profit buckets across [from, to] inclusive. One bucket per calendar
// day; days with no sales show as zero. Used by the Dashboard "period" charts.
function buildDaily(sales, from, to) {
  const start = new Date(from + "T00:00"), end = new Date(to + "T00:00");
  if (isNaN(start) || isNaN(end) || end < start) return [];
  const buckets = new Map();
  const d = new Date(start);
  while (d <= end) {
    const k = dateStr(d);
    buckets.set(k, { key: k, label: new Date(k + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }), revenue: 0, profit: 0 });
    d.setDate(d.getDate() + 1);
  }
  sales.forEach((s) => { const b = buckets.get(s.date); if (b) { b.revenue += s.total || 0; b.profit += s.profit || 0; } });
  return [...buckets.values()].map((b) => ({ ...b, revenue: money(b.revenue), profit: money(b.profit) }));
}

// Monday that begins the week containing d.
const weekStartOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; };

// Week-wise revenue/profit buckets across [from, to] inclusive. One bucket per calendar
// week (Mon–Sun); weeks with no sales show as zero. Labels mark the week-start date.
function buildWeekly(sales, from, to) {
  const start = new Date(from + "T00:00"), end = new Date(to + "T00:00");
  if (isNaN(start) || isNaN(end) || end < start) return [];
  const buckets = new Map();
  const d = weekStartOf(start);
  while (d <= end) {
    const k = dateStr(d);
    buckets.set(k, { key: k, label: new Date(k + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }), revenue: 0, profit: 0 });
    d.setDate(d.getDate() + 7);
  }
  sales.forEach((s) => { if (!s.date) return; const b = buckets.get(dateStr(weekStartOf(new Date(s.date + "T00:00")))); if (b) { b.revenue += s.total || 0; b.profit += s.profit || 0; } });
  return [...buckets.values()].map((b) => ({ ...b, revenue: money(b.revenue), profit: money(b.profit) }));
}

// Period options for the Dashboard "over time" charts. Each computes the from-date
// relative to today; the range end is always today.
const DASH_PERIODS = [
  ["7d", "Last 7 days", (d) => d.setDate(d.getDate() - 6)],
  ["14d", "Last 14 days", (d) => d.setDate(d.getDate() - 13)],
  ["1m", "Last 1 month", (d) => d.setMonth(d.getMonth() - 1)],
  ["2m", "Last 2 months", (d) => d.setMonth(d.getMonth() - 2)],
  ["quarter", "Last quarter", (d) => d.setMonth(d.getMonth() - 3)],
  ["6m", "Last 6 months", (d) => d.setMonth(d.getMonth() - 6)],
  ["1y", "Last year", (d) => d.setFullYear(d.getFullYear() - 1)],
  ["custom", "Custom date period", null],
];

const ChartCard = ({ title, children, height = 240 }) => (
  <section style={S.panel}>
    <div style={S.panelHead}>{title}</div>
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  </section>
);

// Revenue split by how the bill was paid. Total includes everything (Udhari/credit too);
// Cash and UPI are the by-mode buckets. Shared by the Dashboard and Finance bar charts.
const PAYMIX_COLORS = ["#10331f", "#1b5e43", "#2A6FB0"]; // Total · Cash · UPI
const payMix = (sales) => {
  let total = 0, cash = 0, upi = 0;
  sales.forEach((s) => {
    const v = s.total || 0;
    total += v;
    if (s.payment === "Cash") cash += v;
    else if (s.payment === "UPI") upi += v;
  });
  return [
    { name: "Total", value: money(total) },
    { name: "Cash", value: money(cash) },
    { name: "UPI", value: money(upi) },
  ];
};
// Returns a BarChart ELEMENT (not a component) so it can be the direct child of ChartCard's
// ResponsiveContainer, which clones its child to inject width/height.
const renderPayMix = (sales) => {
  const data = payMix(sales);
  return (
    <BarChart data={data} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#678" }} />
      <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
      <Tooltip formatter={(v) => INR(v)} />
      <Bar dataKey="value" name="Amount" radius={[3, 3, 0, 0]} label={barLabel}>
        {data.map((d, i) => <Cell key={d.name} fill={PAYMIX_COLORS[i]} />)}
      </Bar>
    </BarChart>
  );
};
// Trend lines for Total / Cash / UPI over a buildSeries() result. Returns a LineChart element
// so it can be ChartCard's direct child (ResponsiveContainer clones it for sizing).
const renderPayTrend = (series) => (
  <LineChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} interval="preserveStartEnd" minTickGap={20} />
    <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrTick} width={48} />
    <Tooltip formatter={(v) => INR(v)} />
    <Legend wrapperStyle={{ fontSize: 12 }} />
    <Line type="monotone" dataKey="revenue" name="Total" stroke="#10331f" strokeWidth={2} dot={false} />
    <Line type="monotone" dataKey="cash" name="Cash" stroke="#1b5e43" strokeWidth={2} dot={false} />
    <Line type="monotone" dataKey="upi" name="UPI" stroke="#2A6FB0" strokeWidth={2} dot={false} />
  </LineChart>
);

// ---------- Finance (analytics) ----------
// Period presets for the analytics views. Finance and Stats each offer their own
// windows; the keys are resolved to concrete date ranges by periodRange().
const FINANCE_PERIODS = [["thisMonth", "This month"], ["lastMonth", "Last month"], ["last7", "Last 7 days"], ["last14", "Last 14 days"], ["last30", "Last 30 days"], ["last45", "Last 45 days"], ["last2m", "Last 2 months"], ["lastQuarter", "Last quarter"], ["thisYear", "This year"], ["custom", "Custom"]];
// Stats spans short windows through the full history. "All time" is anchored to
// fixed business milestones rather than the oldest data row: trading (sales) began
// May 2026, but capital / setup spending started earlier, in Jan 2026 — so the
// expense charts reach back further than the sales charts under "All time".
const TRADING_START = "2026-05-01"; // sales history begins — "All time" floor for revenue/profit charts
const CAPEX_START = "2026-01-01";   // capital/setup spending begins — "All time" floor for expense charts
const STATS_PERIODS = [["last7", "Last 7 days"], ["last30", "Last 30 days"], ["thisMonth", "This month"], ["lastMonth", "Last month"], ["lastQuarter", "Last 3 months"], ["last6m", "Last 6 months"], ["thisYear", "This year"], ["allTime", "All time"], ["custom", "Custom"]];

// ---------- Sales history ----------
const PAY_COLORS = { UPI: "#2A6FB0", Cash: "#1b5e43", Udhari: "#C44536" };

// ---------- Stats (insights / analytics) ----------
// All the number-crunching lives in ./lib/stats.js (pure + unit-tested). This
// component only wires those transforms to a mobile-first, date-range-driven
// dashboard. Every inline `grid-template-columns` collapses to a single column
// under 820px via the CSS at the bottom of this file, so the phone view stacks
// automatically.
const sectionHead = { fontSize: 13, fontWeight: 800, color: "var(--ink)", letterSpacing: ".02em", margin: "24px 0 8px" };
// (payment-method colours reuse the shared PAY_COLORS defined near Sales History)
// Bar value labels (compact ₹ / plain qty) that skip zeros to keep charts clean.
// `compactLabel` sits on top of vertical bars; the `…Right` variants end horizontal bars.
const compactLabel = { position: "top", formatter: (v) => (v ? inrCompact(v) : ""), fontSize: 9.5, fill: "#465" };
const compactLabelRight = { position: "right", formatter: (v) => (v ? inrCompact(v) : ""), fontSize: 9.5, fill: "#465" };
const qtyLabelRight = { position: "right", formatter: (v) => (v ? v : ""), fontSize: 9.5, fill: "#465" };
// Exact full-₹ value printed on top of bars / line points (zeros hidden). Two
// tints so a bar and its overlaid line stay distinguishable in the combo chart.
const exactLabel = { position: "top", formatter: (v) => (v ? formatINR(v) : ""), fontSize: 9, fill: "#14432E" };
const exactLabelGold = { position: "top", formatter: (v) => (v ? formatINR(v) : ""), fontSize: 9, fill: "#9A6410" };

// Green ramp for the heatmap: pale mint (quiet) → deep brand green (busiest).
const heatColor = (v, max) => {
  if (!v || !max) return "#F4F7F4";
  const t = Math.sqrt(Math.min(1, v / max)); // sqrt lifts the low end so small sales still register
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${lerp(224, 16)},${lerp(240, 51)},${lerp(230, 31)})`;
};

// One weekday × hour heatmap of revenue. Custom CSS grid (not Recharts) so it
// stays tiny and scrolls horizontally on a phone instead of squashing.
function Heatmap({ data }) {
  if (!data || data.placed === 0 || data.minHour == null) {
    return <Empty text="No clock-timed bills in this period to map." />;
  }
  const hours = [];
  for (let h = data.minHour; h <= data.maxHour; h++) hours.push(h);
  const cell = { width: 30, minWidth: 30, height: 26, borderRadius: 4 };
  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ display: "inline-block", minWidth: "100%" }}>
        <div style={{ display: "flex", gap: 3, marginLeft: 38, marginBottom: 3 }}>
          {hours.map((h) => (
            <div key={h} style={{ ...cell, height: "auto", textAlign: "center", fontSize: 9.5, color: "var(--text-mid, #8A9C90)", fontWeight: 600 }}>{hourLabel(h)}</div>
          ))}
        </div>
        {DOW_ORDER.map((d) => (
          <div key={d} style={{ display: "flex", gap: 3, marginBottom: 3, alignItems: "center" }}>
            <div style={{ width: 35, minWidth: 35, fontSize: 11, color: "#465", fontWeight: 700 }}>{DOW[d]}</div>
            {hours.map((h) => {
              const v = data.grid[d][h];
              return (
                <div key={h} title={`${DOW[d]} ${hourLabel(h).replace("a", " AM").replace("p", " PM")} · ${formatINR(v)}`}
                  style={{ ...cell, background: heatColor(v, data.max), border: "1px solid #EDF2ED", cursor: "default" }} />
              );
            })}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, marginLeft: 38, fontSize: 10.5, color: "var(--text-mid, #8A9C90)" }}>
          <span>Quieter</span>
          <div style={{ display: "flex", gap: 2 }}>
            {[0.05, 0.25, 0.5, 0.75, 1].map((t) => <div key={t} style={{ width: 16, height: 10, borderRadius: 2, background: heatColor(t, 1) }} />)}
          </div>
          <span>Busier — colour = revenue taken</span>
        </div>
      </div>
    </div>
  );
}

// Treemap tile: category rectangle labelled with its stock value. Recharts feeds
// x/y/width/height/index plus the datum fields (name, cost, retail, size).
function TreemapTile(props) {
  const { x, y, width, height, name, size, index } = props;
  if (!(width > 0) || !(height > 0)) return null;
  const fill = PIE_COLORS[(index ?? 0) % PIE_COLORS.length];
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} style={{ fill, stroke: "#fff", strokeWidth: 2 }} />
      {width > 54 && height > 22 && <text x={x + 7} y={y + 16} fill="#fff" fontSize={11} fontWeight={700}>{name}</text>}
      {width > 54 && height > 38 && <text x={x + 7} y={y + 31} fill="rgba(255,255,255,.85)" fontSize={10}>{inrCompact(size)}</text>}
    </g>
  );
}

// Turn a breakEvenEstimate() result into the big number + caption for its KPI card.
function breakEvenCard(be, est) {
  switch (est.status) {
    case "reached": return { value: "Recovered ✓", sub: `took ${est.days} day(s) · ${be.recovered}% of capital` };
    case "projected": return { value: "~" + est.daysLeft + " days", sub: `${be.recovered}% recovered · ${formatINR(est.perDay)}/day` };
    case "stalled": return { value: "—", sub: "no profit trend yet" };
    case "no-capex": return { value: "—", sub: "no setup cost logged" };
    default: return { value: "—", sub: "need more sales data" };
  }
}


export { PIE_COLORS, inrTick, barLabel, periodRange, buildSeries, buildDaily, buildWeekly, DASH_PERIODS, ChartCard, renderPayMix, renderPayTrend, FINANCE_PERIODS, TRADING_START, CAPEX_START, STATS_PERIODS, PAY_COLORS, sectionHead, compactLabel, compactLabelRight, qtyLabelRight, exactLabel, exactLabelGold, Heatmap, TreemapTile, breakEvenCard };
