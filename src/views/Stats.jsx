// Stats — extracted from salon-manager.jsx.

import { CAPEX_START, ChartCard, Heatmap, PAY_COLORS, STATS_PERIODS, TRADING_START, TreemapTile, breakEvenCard, compactLabel, compactLabelRight, exactLabel, exactLabelGold, periodRange, qtyLabelRight, sectionHead } from "../components/chartkit.jsx";
import { Card, Empty, Header } from "../components/primitives.jsx";
import { avgBillTrend, breakEvenEstimate, breakEvenSeries, dailyRevenueSeries, deadStock, dormantTrend, expenseBreakdown, expenseByMonth, expenseTotal, formatINR, inrCompact, inventoryByCategory, inventoryValue, ltvDistribution, monthlyRevenueProfit, newVsReturning, noShowPct, paymentBreakdown, rebookConversion, repeatRatio, salesHeatmap, serviceVsProductRevenue, summarize, topItems as topItemsBy, topServices, udhariOutstandingSeries } from "../lib/stats.js";
import { S } from "../lib/ui/css.js";
import { INR, money, todayStr } from "../lib/ui/format.js";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis } from "recharts";

function Stats({ sales, expenses, items, customers = [], appointments = [] }) {
  const [preset, setPreset] = useState("allTime"); // default to the full history
  const [cfrom, setCfrom] = useState("");
  const [cto, setCto] = useState("");
  const [metric, setMetric] = useState("revenue");      // top-items sort: revenue | qty | profit
  const [includeMisc, setIncludeMisc] = useState(false); // keep Misc/SwadSutra/Sold rows in item charts?
  const [treeMetric, setTreeMetric] = useState("cost");  // treemap sizing: cost | retail
  // "All time" for the sales charts is pinned to when trading began (TRADING_START).
  const { from, to, label } = periodRange(preset, cfrom, cto, TRADING_START);
  // Expenses (capital / setup cost) started before trading, so their "All time"
  // reaches back to CAPEX_START; every other preset shares the sales window.
  const expFrom = preset === "allTime" ? CAPEX_START : from;

  // Period slice drives most charts; a few (inventory, break-even, Udhari-now) are
  // "as of now" snapshots and deliberately read the full data — noted on each card.
  const pSales = useMemo(() => sales.filter((s) => s.date >= from && s.date <= to), [sales, from, to]);
  const pExp = useMemo(() => expenses.filter((e) => e.date >= expFrom && e.date <= to), [expenses, expFrom, to]);
  const sum = useMemo(() => summarize(pSales), [pSales]);
  const expMonthly = useMemo(() => expenseByMonth(pExp, expFrom, to), [pExp, expFrom, to]);
  const expBreak = useMemo(() => expenseBreakdown(pExp, { limit: 10 }), [pExp]);
  const expSum = useMemo(() => expenseTotal(pExp), [pExp]);

  // ---- salon analytics ----
  const svcSplit = useMemo(() => serviceVsProductRevenue(pSales, from, to), [pSales, from, to]);
  const topSvc = useMemo(() => topServices(pSales, { metric: metric === "qty" ? "count" : "revenue", limit: 12, from, to }), [pSales, from, to, metric]);
  const repeat = useMemo(() => repeatRatio(pSales, from, to), [pSales, from, to]);
  const avgBills = useMemo(() => avgBillTrend(pSales, from, to), [pSales, from, to]);
  // LTV is a lifetime measure by definition — it reads the FULL history regardless of the
  // period picker, like the inventory and break-even cards above.
  const ltv = useMemo(() => ltvDistribution(sales), [sales]);
  const newRet = useMemo(() => newVsReturning(sales, from, to), [sales, from, to]);
  const noShow = useMemo(() => noShowPct(appointments, from, to), [appointments, from, to]);
  const dormant = useMemo(() => dormantTrend(sales, from.slice(0, 7), to.slice(0, 7)), [sales, from, to]);
  const rebook = useMemo(() => rebookConversion(customers, sales, todayStr()), [customers, sales]);
  const svcMix = useMemo(
    () => [{ name: "Services", value: svcSplit.service }, { name: "Products", value: svcSplit.product }].filter((x) => x.value > 0),
    [svcSplit]
  );

  const daily = useMemo(() => dailyRevenueSeries(pSales, from, to), [pSales, from, to]);
  const monthly = useMemo(() => monthlyRevenueProfit(pSales, from, to), [pSales, from, to]);
  const heat = useMemo(() => salesHeatmap(pSales), [pSales]);
  const topProducts = useMemo(() => topItemsBy(pSales, { metric, limit: 15, includeConsolidated: includeMisc }), [pSales, metric, includeMisc]);
  const pay = useMemo(() => paymentBreakdown(pSales), [pSales]);
  const udhariSeries = useMemo(() => udhariOutstandingSeries(sales, from, to), [sales, from, to]);
  const udhariNow = useMemo(() => money(sales.filter((s) => s.payment === "Udhari").reduce((a, s) => a + Math.max(0, (s.total || 0) - (s.paid || 0)), 0)), [sales]);
  const inv = useMemo(() => inventoryValue(items), [items]);
  const invCats = useMemo(() => inventoryByCategory(items), [items]);
  const dead = useMemo(() => deadStock(items, pSales), [items, pSales]);
  const be = useMemo(() => breakEvenSeries(sales, expenses), [sales, expenses]);       // all-time
  const est = useMemo(() => breakEvenEstimate(be), [be]);
  const beCard = breakEvenCard(be, est);

  const treeData = useMemo(() => invCats.map((c) => ({ ...c, size: treeMetric === "retail" ? c.retail : c.cost })).filter((c) => c.size > 0), [invCats, treeMetric]);
  const metricLabel = { revenue: "Revenue", qty: "Quantity", profit: "Profit" };

  return (
    <div>
      <Header title="Stats" sub={label}>
        <select className="input" style={{ width: "auto" }} value={preset} onChange={(e) => setPreset(e.target.value)}>
          {STATS_PERIODS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
        </select>
      </Header>

      {preset === "custom" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>From <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} value={cfrom} max={cto || todayStr()} onChange={(e) => setCfrom(e.target.value)} /></label>
          <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>To <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} value={cto} max={todayStr()} onChange={(e) => setCto(e.target.value)} /></label>
        </div>
      )}

      {/* ---- KPI row (first four follow the date range; last four are "as of now") ---- */}
      <div className="cards" style={S.cards}>
        <Card label="Revenue" value={formatINR(sum.revenue)} sub={sum.bills + " bills"} />
        <Card label="Trading profit" value={formatINR(sum.profit)} sub={`${sum.margin}% margin`} accent />
        <Card label="Margin" value={sum.margin + "%"} sub="profit ÷ revenue" />
        <Card label="Avg ticket" value={formatINR(sum.avgTicket)} sub="per bill" />
        <Card label="Udhari outstanding" value={formatINR(udhariNow)} sub="unpaid credit · now" />
        <Card label="Inventory at cost" value={formatINR(inv.cost)} sub={`${inv.count} items · now`} />
        <Card label="Out of stock" value={inv.outOfStock} sub="items at zero · now" />
        <Card label="Break-even" value={beCard.value} sub={beCard.sub} />
      </div>

      {pSales.length === 0 ? (
        <section style={{ ...S.panel, marginTop: 16 }}><Empty text="No sales in this period — pick a wider range to see the charts." /></section>
      ) : (
        <>
          <div style={sectionHead}>Revenue over time</div>
          <ChartCard title="Daily revenue & 7-day average" height={260}>
            <LineChart data={daily} margin={{ top: 12, right: 10, left: -6, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
              <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#678" }} interval="preserveStartEnd" minTickGap={26} />
              <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrCompact} width={48} />
              <Tooltip formatter={(v, n) => [formatINR(v), n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="revenue" name="Daily revenue" stroke="#9BC0AC" strokeWidth={1.5} dot={false} label={exactLabel} />
              <Line type="monotone" dataKey="ma7" name="7-day average" stroke="#1b5e43" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ChartCard>

          <div style={{ marginTop: 16 }}>
            <ChartCard title="Monthly revenue & profit" height={250}>
              <ComposedChart data={monthly} margin={{ top: 16, right: 10, left: -6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} />
                <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrCompact} width={48} />
                <Tooltip formatter={(v, n) => [formatINR(v), n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Revenue" fill="#1b5e43" radius={[3, 3, 0, 0]} maxBarSize={54} label={exactLabel} />
                <Line type="monotone" dataKey="profit" name="Profit" stroke="#E8A33D" strokeWidth={2.5} dot={{ r: 2.5, fill: "#E8A33D" }} label={exactLabelGold} />
              </ComposedChart>
            </ChartCard>
          </div>

          {/* ---- Salon analytics ----
              Placed above the generic product charts because for a salon these ARE the
              business: the labour/retail split, whether customers come back, and whether the
              reminders are earning their keep. */}
          <div style={sectionHead}>The salon</div>
          <div className="cards" style={S.cards}>
            <Card label="Service revenue" value={INR(svcSplit.service)} sub={`${svcSplit.servicePct}% of takings`} accent />
            <Card label="Retail revenue" value={INR(svcSplit.product)} sub={`${money(100 - svcSplit.servicePct)}% of takings`} />
            <Card label="Customers who came back" value={`${repeat.pct}%`} sub={`${repeat.repeat} of ${repeat.identified} identified · walk-ins excluded`} />
            <Card label="No-shows" value={`${noShow.pct}%`} sub={noShow.resolved ? `${noShow.noShow} of ${noShow.resolved} resolved appointments` : "no appointments yet"} />
            <Card
              label="Reminders → visits"
              value={rebook.sent ? `${rebook.pct}%` : "—"}
              sub={rebook.sent ? `${rebook.converted} of ${rebook.sent} came back within 14 days` : "none sent long enough ago to judge"}
            />
          </div>

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <ChartCard title="Where the money comes from" height={240}>
              {svcMix.length === 0 ? <Empty text="No sales in this period." /> : (
                <PieChart>
                  <Pie data={svcMix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2}>
                    {svcMix.map((s) => <Cell key={s.name} fill={s.name === "Services" ? "#1b5e43" : "#E8A33D"} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatINR(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              )}
            </ChartCard>

            <ChartCard title={`Top services by ${metric === "qty" ? "how often" : "revenue"}`} height={240}>
              {topSvc.length === 0 ? <Empty text="No services billed in this period." /> : (
                <BarChart data={topSvc} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" horizontal={false} />
                  <XAxis type="number" inputMode="decimal" tick={{ fontSize: 11, fill: "#678" }} tickFormatter={metric === "qty" ? undefined : inrCompact} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10.5, fill: "#465" }} width={110} />
                  <Tooltip formatter={(v, n, p) => (metric === "qty" ? [`${v} done`, p.payload.name] : [formatINR(v), p.payload.name])} />
                  <Bar dataKey={metric === "qty" ? "count" : "revenue"} fill="#2A6FB0" radius={[0, 3, 3, 0]}
                    label={{ position: "right", fontSize: 10, fill: "#465", formatter: (v) => (metric === "qty" ? v : inrCompact(v)) }} />
                </BarChart>
              )}
            </ChartCard>
          </div>

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <ChartCard title="New vs returning customers" height={240}>
              {newRet.length === 0 ? <Empty text="No identified customers yet." /> : (
                <BarChart data={newRet} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#678" }} width={32} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="new" name="New" stackId="c" fill="#7C3AED" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="returning" name="Returning" stackId="c" fill="#1b5e43" radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ChartCard>

            <ChartCard title="Average bill value" height={240}>
              {avgBills.length === 0 ? <Empty text="No bills in this period." /> : (
                <LineChart data={avgBills} margin={{ top: 16, right: 10, left: -6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrCompact} width={48} />
                  <Tooltip formatter={(v, n, p) => [`${formatINR(v)} across ${p.payload.bills} bill(s)`, "Average bill"]} />
                  <Line type="monotone" dataKey="avg" name="Average bill" stroke="#1b5e43" strokeWidth={2.5} dot={{ r: 2.5 }} label={exactLabel} />
                </LineChart>
              )}
            </ChartCard>
          </div>

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <ChartCard title="Customer lifetime value (all time)" height={240}>
              <BarChart data={ltv} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
                <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#678" }} />
                <YAxis tick={{ fontSize: 11, fill: "#678" }} width={32} allowDecimals={false} />
                <Tooltip formatter={(v) => [`${v} customer(s)`, "Count"]} />
                <Bar dataKey="count" name="Customers" fill="#7C3AED" radius={[3, 3, 0, 0]}
                  label={{ position: "top", fontSize: 10, fill: "#667", formatter: (v) => v || "" }} />
              </BarChart>
            </ChartCard>

            <ChartCard title="Customers gone quiet (60+ days)" height={240}>
              {dormant.length === 0 ? <Empty text="Not enough history yet." /> : (
                <LineChart data={dormant} margin={{ top: 16, right: 10, left: -6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#678" }} width={32} allowDecimals={false} />
                  <Tooltip formatter={(v, n, p) => [`${v} of ${p.payload.known} known customers`, "Dormant"]} />
                  <Line type="monotone" dataKey="dormant" name="Dormant" stroke="#C44536" strokeWidth={2.5} dot={{ r: 2.5 }} />
                </LineChart>
              )}
            </ChartCard>
          </div>

          <div style={sectionHead}>When customers shop</div>
          <section style={S.panel}>
            <div style={S.panelHead}>Sales heatmap — weekday × time of day</div>
            <Heatmap data={heat} />
          </section>

          <div style={sectionHead}>Products & payment</div>
          <div className="g-split" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
            <section style={S.panel}>
              <div style={{ ...S.panelHead, flexWrap: "wrap", gap: 6 }}>
                Top 15 items
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {["revenue", "qty", "profit"].map((m) => (
                    <button key={m} className={"btn small " + (metric === m ? "primary" : "ghost")} onClick={() => setMetric(m)}>{metricLabel[m]}</button>
                  ))}
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-mid, #6B7E74)", marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={includeMisc} onChange={(e) => setIncludeMisc(e.target.checked)} />
                Include Misc / consolidated rows (they distort real top-sellers)
              </label>
              {topProducts.length === 0 ? (
                <Empty text="No individual items sold in this period." />
              ) : (
                <div style={{ width: "100%", height: Math.max(220, topProducts.length * 26 + 24) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProducts} layout="vertical" margin={{ top: 4, right: 54, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" horizontal={false} />
                      <XAxis type="number" inputMode="decimal" tick={{ fontSize: 10.5, fill: "#678" }} tickFormatter={metric === "qty" ? undefined : inrCompact} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#465" }} width={116} interval={0} />
                      <Tooltip formatter={(v) => (metric === "qty" ? v : formatINR(v))} />
                      <Bar dataKey={metric} name={metricLabel[metric]} fill="#3DA17A" radius={[0, 3, 3, 0]} label={metric === "qty" ? qtyLabelRight : compactLabelRight} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section style={S.panel}>
              <div style={S.panelHead}>How customers pay</div>
              {pay.rows.length === 0 ? (
                <Empty text="No sales to split." />
              ) : (
                <>
                  <div style={{ position: "relative", width: "100%", height: 190 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pay.rows} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
                          {pay.rows.map((r) => <Cell key={r.name} fill={PAY_COLORS[r.name] || "var(--text-mid, #8A9C90)"} />)}
                        </Pie>
                        <Tooltip formatter={(v, n) => [formatINR(v), n]} />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center total — a positioned overlay renders reliably across Recharts versions. */}
                    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--text-mid, #8A9C90)" }}>Total</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{inrCompact(pay.total)}</div>
                      </div>
                    </div>
                  </div>
                  <div>
                    {pay.rows.map((r) => (
                      <div key={r.name} style={S.row}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: PAY_COLORS[r.name] || "var(--text-mid, #8A9C90)" }} />{r.name}
                        </span>
                        <b>{formatINR(r.value)} <span style={{ color: "var(--text-mid, #8A9C90)", fontWeight: 500 }}>· {r.pct}%</span></b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          <div style={sectionHead}>Credit & recovery</div>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <ChartCard title="Udhari outstanding over time">
              <AreaChart data={udhariSeries} margin={{ top: 8, right: 10, left: -6, bottom: 0 }}>
                <defs>
                  <linearGradient id="gUdhari" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8A33D" stopOpacity={0.4} /><stop offset="100%" stopColor="#E8A33D" stopOpacity={0.04} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
                <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#678" }} interval="preserveStartEnd" minTickGap={26} />
                <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrCompact} width={48} />
                <Tooltip formatter={(v) => [formatINR(v), "Outstanding"]} />
                <Area type="monotone" dataKey="outstanding" name="Outstanding" stroke="#B0762A" strokeWidth={2} fill="url(#gUdhari)" />
              </AreaChart>
            </ChartCard>

            <ChartCard title="Break-even — profit vs capital (all-time)">
              {be.series.length === 0 ? (
                <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Empty text="No sales yet to track break-even." /></div>
              ) : (
                <ComposedChart data={be.series} margin={{ top: 16, right: 12, left: -6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gBreak" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1b5e43" stopOpacity={0.35} /><stop offset="100%" stopColor="#1b5e43" stopOpacity={0.03} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#678" }} interval="preserveStartEnd" minTickGap={26} />
                  <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrCompact} width={48} />
                  <Tooltip formatter={(v) => [formatINR(v), "Cumulative profit"]} />
                  <Area type="monotone" dataKey="cumProfit" name="Cumulative profit" stroke="#1b5e43" strokeWidth={2} fill="url(#gBreak)" />
                  {be.capex > 0 && <ReferenceLine y={be.capex} stroke="#C44536" strokeDasharray="5 4" label={{ value: `Capital ${inrCompact(be.capex)}`, position: "insideTopRight", fontSize: 10, fill: "#C44536" }} />}
                </ComposedChart>
              )}
            </ChartCard>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", marginTop: 8 }}>
            <b>Capital / Setup Cost</b> (one-time): {formatINR(be.capex)} — this is investment, never subtracted from trading profit.
            {est.status === "reached" && <> You’ve recovered it (took {est.days} day(s)).</>}
            {est.status === "projected" && <> At about {formatINR(est.perDay)}/day of profit, roughly {est.daysLeft} day(s) to go.</>}
          </div>

          <div style={sectionHead}>
            Capital / setup spending
            {preset === "allTime" && <span style={{ fontWeight: 500, color: "var(--text-mid, #8A9C90)" }}> · since {new Date(CAPEX_START + "T00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</span>}
          </div>
          {pExp.length === 0 ? (
            <section style={S.panel}><Empty text="No capital / setup spending recorded in this period." /></section>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: "var(--panelhead, #3A5547)", marginBottom: 8 }}>
                One-time setup / capital of <b>{formatINR(expSum)}</b> across {pExp.length} {pExp.length === 1 ? "entry" : "entries"} — investment, not an operating cost, so it never reduces trading profit.
              </div>
              <div className="g-split" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
                <ChartCard title="Capital deployed by month">
                  <BarChart data={expMonthly} margin={{ top: 16, right: 10, left: -6, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#678" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#678" }} tickFormatter={inrCompact} width={48} />
                    <Tooltip formatter={(v) => [formatINR(v), "Spent"]} />
                    <Bar dataKey="amount" name="Spent" fill="#C44536" radius={[3, 3, 0, 0]} maxBarSize={56} label={compactLabel} />
                  </BarChart>
                </ChartCard>
                <section style={S.panel}>
                  <div style={S.panelHead}>Where it went</div>
                  <div style={{ width: "100%", height: Math.max(200, expBreak.rows.length * 26 + 24) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={expBreak.rows} layout="vertical" margin={{ top: 4, right: 54, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EEF3EE" horizontal={false} />
                        <XAxis type="number" inputMode="decimal" tick={{ fontSize: 10.5, fill: "#678" }} tickFormatter={inrCompact} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#465" }} width={112} interval={0} />
                        <Tooltip formatter={(v) => formatINR(v)} />
                        <Bar dataKey="value" name="Spent" fill="#B0762A" radius={[0, 3, 3, 0]} label={compactLabelRight} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>
            </>
          )}

          <div style={sectionHead}>Inventory</div>
          <div className="g-split" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
            <section style={S.panel}>
              <div style={{ ...S.panelHead, flexWrap: "wrap", gap: 6 }}>
                Stock value by category
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className={"btn small " + (treeMetric === "cost" ? "primary" : "ghost")} onClick={() => setTreeMetric("cost")}>At cost {inrCompact(inv.cost)}</button>
                  <button className={"btn small " + (treeMetric === "retail" ? "primary" : "ghost")} onClick={() => setTreeMetric("retail")}>At retail {inrCompact(inv.retail)}</button>
                </div>
              </div>
              {treeData.length === 0 ? (
                <Empty text="No stock on hand to value." />
              ) : (
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <Treemap data={treeData} dataKey="size" nameKey="name" stroke="#fff" isAnimationActive={false} content={<TreemapTile />} />
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            <section style={S.panel}>
              <div style={S.panelHead}>Slow movers — in stock, no sales this period <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--text-mid, #8A9C90)", marginLeft: 8 }}>{dead.length}</span></div>
              {dead.length === 0 ? (
                <Empty text="Everything in stock sold at least once. 👍" />
              ) : (
                <>
                  {dead.slice(0, 10).map((i) => (
                    <div key={i.name} style={S.row}><span>{i.name} <span style={{ color: "#9AA", fontSize: 11 }}>· {i.stock} {i.unit}</span></span><b>{formatINR(i.value)}</b></div>
                  ))}
                  {dead.length > 10 && <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 6 }}>+ {dead.length - 10} more…</div>}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}


export { Stats };
export default Stats;
