// RawData — extracted from salon-manager.jsx.

import { Empty, Header } from "../components/primitives.jsx";
import { parseFile, parseRawText } from "../lib/parse.js";
import { S } from "../lib/ui/css.js";
import { INR, money, todayStr, uid } from "../lib/ui/format.js";
import { UNITS, addBatch, iconFor, normName, removeStock } from "../lib/ui/inventory.js";
import { useState } from "react";

// ---------- Raw Data Record (file import / paste) ----------
const RAW_ACCEPT = ".txt,.csv,.tsv,.xls,.xlsx,.pdf,.json";
function RawData({ items, setItems, setSales, setExpenses, notify, log }) {
  const [mode, setMode] = useState("inventory"); // "inventory" | "sales" | "expenses"
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [raw, setRaw] = useState("");
  const [source, setSource] = useState("");
  const [saleDate, setSaleDate] = useState(todayStr());

  // Expense rows only need description / amount / date. The shared parser fills the amount
  // into whichever numeric slot it found (often `qty` for "name, amount, date"), and a date
  // token into `date`/`expiry` — so pick the first sensible value for each.
  const toExpenseRow = (r) => ({
    name: r.name || "",
    amount: r.amount || r.sellPrice || r.buyPrice || r.qty || "",
    date: r.date || r.expiry || "",
  });

  const loadRows = (parsed, srcLabel) => {
    if (!parsed || parsed.length === 0) {
      setErr("No rows found. Make sure the data has item names and numbers — or add rows manually below.");
      return;
    }
    setErr(null);
    setRows(mode === "expenses" ? parsed.map(toExpenseRow) : parsed);
    setSource(srcLabel);
    notify(`${parsed.length} row(s) loaded — review, edit, then submit`);
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      loadRows(await parseFile(f), f.name);
    } catch (ex) {
      console.error(ex);
      setErr("Could not read that file. Supported types: txt, csv, tsv, xls, xlsx, pdf, json.");
    }
    setBusy(false);
  };

  const processPaste = () => {
    if (!raw.trim()) return setErr("Paste some data into the box first.");
    try {
      loadRows(parseRawText(raw), "pasted text");
    } catch (ex) {
      console.error(ex);
      setErr("Could not parse that text.");
    }
  };

  const addRow = () => setRows([...(rows || []), mode === "expenses"
    ? { name: "", amount: "", date: todayStr() }
    : { name: "", qty: 1, unit: "pc", buyPrice: "", sellPrice: "", amount: "", expiry: "" }]);
  const edit = (i, k, v) => setRows(rows.map((r, x) => (x === i ? { ...r, [k]: v } : r)));
  const drop = (i) => setRows(rows.filter((_, x) => x !== i));
  const reset = () => { setRows(null); setRaw(""); setSource(""); setErr(null); };
  // Switching what we're importing clears any previewed rows (their shape differs per mode).
  const changeMode = (m) => { if (m === mode) return; setMode(m); setRows(null); setErr(null); };

  // Collapse duplicate rows (same name) into one entry so quantities sum instead
  // of one row clobbering another. Keyed by normName so it matches existing items the
  // same way the rest of the app does (trim + lowercase + collapse inner spaces).
  const aggregateRows = () => {
    const agg = new Map();
    rows.forEach((r) => {
      const key = normName(r.name);
      if (!key) return;
      const buy = +r.buyPrice || 0, sell = +r.sellPrice || 0, qty = +r.qty || 0;
      // Fall back to qty × unit price when no explicit line amount was given.
      const amount = +r.amount || (sell ? sell * qty : 0);
      const prev = agg.get(key);
      if (prev) {
        prev.qty += qty; prev.amount += amount;
        if (buy) prev.buy = buy;
        if (sell) prev.sell = sell;
      } else {
        agg.set(key, { name: r.name.trim(), unit: r.unit, qty, amount, buy, sell });
      }
    });
    return agg;
  };

  // Like aggregateRows, but for inventory it keeps each distinct expiry as its own
  // batch (so the same item imported with two expiry dates becomes two batches), while
  // still summing rows that share both name and expiry. Keyed by normName to match the app.
  const aggregateInventory = () => {
    const agg = new Map(); // normName -> { name, unit, buy, sell, batches: Map(expiry -> qty) }
    rows.forEach((r) => {
      const key = normName(r.name);
      if (!key) return;
      const buy = +r.buyPrice || 0, sell = +r.sellPrice || 0, qty = +r.qty || 0;
      const expiry = r.expiry || "";
      let e = agg.get(key);
      if (!e) { e = { name: r.name.trim(), unit: r.unit, buy, sell, batches: new Map() }; agg.set(key, e); }
      if (buy) e.buy = buy;
      if (sell) e.sell = sell;
      if (r.unit) e.unit = r.unit;
      e.batches.set(expiry, (e.batches.get(expiry) || 0) + qty);
    });
    return agg;
  };

  const commitInventory = () => {
    const counts = aggregateInventory();
    const names = new Set(items.map((i) => normName(i.name)));
    let added = 0, updated = 0;
    counts.forEach((_, key) => (names.has(key) ? updated++ : added++));
    // Functional updater (rebuilds the aggregate per call so it stays correct even if a live
    // cloud snapshot changed `items` since the import was previewed). Always NEW objects.
    setItems((list) => {
      const agg = aggregateInventory();
      const next = list.map((i) => {
        const e = agg.get(normName(i.name));
        if (!e) return i;
        agg.delete(normName(i.name));
        let updatedItem = { ...i, buyPrice: e.buy || i.buyPrice, sellPrice: e.sell || i.sellPrice };
        e.batches.forEach((qty, expiry) => { updatedItem = addBatch(updatedItem, qty, expiry, todayStr()); });
        return updatedItem;
      });
      agg.forEach((e) => {
        const sell = e.sell || (e.buy ? Math.round(e.buy * 1.15) : 0);
        const batches = [];
        let stock = 0;
        e.batches.forEach((qty, expiry) => {
          if (qty > 0) { batches.push({ id: uid(), qty, expiry: expiry || "", addedOn: todayStr() }); stock += qty; }
        });
        next.push({
          id: uid(), name: e.name, code: "", category: "Other", unit: e.unit, icon: iconFor("Other"),
          buyPrice: e.buy, sellPrice: sell, mrp: sell, stock, lowAt: 5, batches, createdAt: todayStr(),
        });
      });
      return next;
    });
    log("import", `Imported to inventory (${source || "manual"}): ${added} new, ${updated} restocked`);
    reset();
    notify(`Inventory updated — ${added} new, ${updated} restocked`);
  };

  const commitSales = () => {
    const agg = aggregateRows();
    let profit = 0, total = 0;
    const lines = [...agg.values()].map((a) => {
      total += a.amount;
      const ex = items.find((i) => normName(i.name) === normName(a.name));
      if (ex) profit += a.amount - ex.buyPrice * a.qty;
      return { name: a.name, qty: a.qty, unit: ex?.unit || "pc", buyPrice: ex?.buyPrice ?? 0, price: a.qty ? money(a.amount / a.qty) : a.amount, amount: money(a.amount) };
    });
    total = money(total); profit = money(profit);
    const now = new Date();
    setSales((s) => [...s, {
      id: uid(), date: saleDate || todayStr(),
      time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) + " (imported)",
      lines, total, profit,
    }]);
    setItems((its) => its.map((i) => {
      const a = agg.get(normName(i.name));
      return a ? removeStock(i, a.qty, todayStr()) : i;
    }));
    log("import", `Imported sale ${INR(total)} · ${lines.length} line(s) (${source || "manual"})`);
    reset();
    notify("Sale recorded — " + INR(total));
  };

  // Bulk-add expenses (description + amount + date). Each valid row becomes one expense
  // entry, exactly like Add Expense, so it flows into Finance totals and the expense charts.
  const commitExpenses = () => {
    const valid = (rows || []).filter((r) => (r.name || "").trim() && +r.amount > 0);
    if (!valid.length) return notify("Each expense needs a description and an amount greater than 0.");
    const newRows = valid.map((r) => ({ id: uid(), date: r.date || todayStr(), desc: r.name.trim(), amount: money(+r.amount) }));
    const sum = money(newRows.reduce((a, e) => a + e.amount, 0));
    setExpenses((list) => [...list, ...newRows]);
    log("import", `Imported ${newRows.length} expense(s) (${source || "manual"}) · ${INR(sum)}`);
    reset();
    notify(`${newRows.length} expense(s) added — ${INR(sum)}`);
  };

  return (
    <div>
      <Header title="Data Import" sub="Import a file or paste data — then review, edit, and submit">
        {rows && <button className="btn ghost small" onClick={reset}>Start over</button>}
      </Header>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button className={"btn " + (mode === "inventory" ? "primary" : "")} onClick={() => changeMode("inventory")}>
          ➕ Add to inventory
        </button>
        <button className={"btn " + (mode === "sales" ? "primary" : "")} onClick={() => changeMode("sales")}>
          🧾 Record a sale
        </button>
        <button className={"btn " + (mode === "expenses" ? "primary" : "")} onClick={() => changeMode("expenses")}>
          💸 Add expenses
        </button>
      </div>

      <div className="g-split" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16 }}>
        <section style={S.panel}>
          <div style={S.panelHead}>1 · Provide data</div>
          <label className="btn primary" style={{ display: "block", textAlign: "center", padding: "14px", cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Reading file…" : "📂 Choose a file"}
            <input type="file" accept={RAW_ACCEPT} onChange={onFile} disabled={busy} style={{ display: "none" }} />
          </label>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", margin: "8px 0 14px", textAlign: "center" }}>
            txt · csv · tsv · xls · xlsx · pdf · json
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#465", marginBottom: 6 }}>…or paste data</div>
          <textarea
            className="input"
            rows={6}
            placeholder={mode === "inventory"
              ? "name, qty, buy, sell, expiry\nParle-G, 24, 8, 10, 2026-12-31\nLay's, 40, 16, 20, 31/12/2026"
              : mode === "expenses"
                ? "expense, amount, date\nElectricity bill, 1800, 2026-06-01\nShop rent, 15000, 01/06/2026"
                : "name, qty, amount\nParle-G, 5, 50\nLay's, 3, 60"}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12.5 }}
          />
          <button className="btn" style={{ width: "100%", marginTop: 8 }} onClick={processPaste}>Process pasted data</button>
          {err && <div style={{ color: "#C44536", fontSize: 13, marginTop: 10 }}>{err}</div>}
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 12, lineHeight: 1.5 }}>
            {mode === "expenses"
              ? "Columns are auto-detected from headers (expense / description, amount, date). No headers? The text is the description, the number is the amount, and a date-looking value (e.g. 2026-06-01 or 01/06/2026) is the expense date. Blank dates default to today."
              : "Columns are auto-detected from headers (name / qty / buy / sell / amount / expiry). No headers? The name is read first, then numbers fill in as qty, buy, sell, amount — so 1 number is qty, 2 are qty + price, 3 are qty + buy + sell. A date-looking column (e.g. 2026-12-31 or 31/12/2026) is treated as the batch expiry."}
          </div>
        </section>

        <section style={S.panel}>
          <div style={S.panelHead}>
            2 · Review &amp; edit{source ? <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--text-mid, #8A9C90)", marginLeft: 8 }}>from {source}</span> : null}
            <button className="btn small ghost" style={{ marginLeft: "auto" }} onClick={addRow}>+ Add row</button>
          </div>
          {!rows ? (
            <Empty text={busy ? "Reading…" : "Imported rows appear here. You can also build a list by hand with “+ Add row”."} />
          ) : (
            <>
              {mode === "sales" && (
                <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", display: "block", marginBottom: 10 }}>
                  Sale date <input type="date" className="input" style={{ width: "auto", marginLeft: 6 }} value={saleDate} max={todayStr()} onChange={(e) => setSaleDate(e.target.value || todayStr())} />
                </label>
              )}
              {mode === "expenses" ? (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Description</th><th style={{ width: 110 }}>Amount ₹</th><th style={{ width: 150 }}>Date</th><th style={{ width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td><input className="input" style={{ padding: "6px 8px" }} value={r.name} placeholder="e.g. Electricity bill" onChange={(e) => edit(i, "name", e.target.value)} /></td>
                        <td><input className="input" style={{ padding: "6px 8px" }} type="number" inputMode="decimal" min="0" step="0.01" value={r.amount} onChange={(e) => edit(i, "amount", e.target.value)} /></td>
                        <td><input className="input" style={{ padding: "6px 8px" }} type="date" max={todayStr()} value={r.date || ""} onChange={(e) => edit(i, "date", e.target.value)} /></td>
                        <td><button className="btn small danger" aria-label="Remove row" onClick={() => drop(i)}>✕</button></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={4}><Empty text="No rows yet — click “+ Add row”." /></td></tr>}
                  </tbody>
                </table>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Item</th><th style={{ width: 58 }}>Qty</th>
                      {mode === "inventory"
                        ? (<><th style={{ width: 72 }}>Unit</th><th style={{ width: 78 }}>Buy ₹</th><th style={{ width: 78 }}>Sell ₹</th><th style={{ width: 140 }}>Expiry</th></>)
                        : (<th style={{ width: 96 }}>Amount ₹</th>)}
                      <th style={{ width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td><input className="input" style={{ padding: "6px 8px" }} value={r.name} onChange={(e) => edit(i, "name", e.target.value)} /></td>
                        <td><input className="input" style={{ padding: "6px 8px" }} type="number" inputMode="decimal" min="0" value={r.qty} onChange={(e) => edit(i, "qty", +e.target.value)} /></td>
                        {mode === "inventory" ? (
                          <>
                            <td>
                              <select className="input" style={{ padding: "6px 4px" }} value={r.unit} onChange={(e) => edit(i, "unit", e.target.value)}>
                                {UNITS.map((u) => <option key={u}>{u}</option>)}
                              </select>
                            </td>
                            <td><input className="input" style={{ padding: "6px 8px" }} type="number" inputMode="decimal" min="0" step="0.01" value={r.buyPrice} onChange={(e) => edit(i, "buyPrice", e.target.value)} /></td>
                            <td><input className="input" style={{ padding: "6px 8px" }} type="number" inputMode="decimal" min="0" step="0.01" value={r.sellPrice} onChange={(e) => edit(i, "sellPrice", e.target.value)} /></td>
                            <td><input className="input" style={{ padding: "6px 8px" }} type="date" value={r.expiry || ""} onChange={(e) => edit(i, "expiry", e.target.value)} /></td>
                          </>
                        ) : (
                          <td><input className="input" style={{ padding: "6px 8px" }} type="number" inputMode="decimal" min="0" step="0.01" value={r.amount} onChange={(e) => edit(i, "amount", e.target.value)} /></td>
                        )}
                        <td><button className="btn small danger" aria-label="Remove row" onClick={() => drop(i)}>✕</button></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={mode === "inventory" ? 7 : 4}><Empty text="No rows yet — click “+ Add row”." /></td></tr>}
                  </tbody>
                </table>
              )}
              <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", margin: "10px 0" }}>
                {mode === "inventory"
                  ? "Existing names get restocked; new names create items (blank sell = buy + 15%). Each row's expiry becomes its own dated batch; leave blank for no expiry."
                  : mode === "expenses"
                    ? "Each row is added as a separate expense and shows up in Finance totals and the expense charts. Rows with no description or an amount of 0 are skipped; a blank date defaults to today."
                    : "Matched item names reduce stock automatically; unmatched lines still record as revenue."}
              </div>
              <button className="btn primary big" style={{ width: "100%" }} disabled={rows.length === 0} onClick={mode === "inventory" ? commitInventory : mode === "expenses" ? commitExpenses : commitSales}>
                {mode === "inventory" ? `Add ${rows.length} item(s) to inventory` : mode === "expenses" ? `Add ${rows.length} expense(s)` : `Record sale · ${rows.length} line(s)`}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}


export { RawData };
export default RawData;
