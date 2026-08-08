// Alerts — extracted from salon-manager.jsx.

import { Empty, Header } from "../components/primitives.jsx";
import { S } from "../lib/ui/css.js";
import { todayStr } from "../lib/ui/format.js";
import { CATEGORIES } from "../lib/ui/inventory.js";
import { useState } from "react";

// ---------- Alerts ----------
function Alerts({ items, goInventory, cats = CATEGORIES }) {
  const [view, setView] = useState("low"); // low | out | expiring | expired
  const [cat, setCat] = useState("All");
  const byCat = (i) => cat === "All" || i.category === cat;

  const low = items.filter((i) => byCat(i) && i.stock <= i.lowAt).sort((a, b) => a.stock - b.stock);
  const out = low.filter((i) => i.stock <= 0);

  const expRows = [];
  items.filter(byCat).forEach((i) => (i.batches || []).forEach((b) => {
    if (!b.expiry) return;
    const d = Math.round((new Date(b.expiry + "T00:00") - new Date(todayStr() + "T00:00")) / 86400000);
    expRows.push({ item: i, b, d });
  }));
  const expiring = expRows.filter((r) => r.d >= 0 && r.d <= 30).sort((a, b) => a.d - b.d);
  const expired = expRows.filter((r) => r.d < 0).sort((a, b) => a.d - b.d);

  const tabs = [["low", "Low stock", low.length], ["out", "Out of stock", out.length], ["expiring", "Expiring ≤30d", expiring.length], ["expired", "Expired", expired.length]];
  const isStockView = view === "low" || view === "out";
  const stockList = view === "out" ? out : low;
  const expList = view === "expired" ? expired : expiring;

  return (
    <div>
      <Header title="Alerts" sub="Items running low (lowest stock first) and batches nearing or past expiry">
        <button className="btn ghost small" onClick={goInventory}>Go to inventory</button>
      </Header>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {tabs.map(([k, lbl, n]) => (
          <button key={k} className={"btn small " + (view === k ? "primary" : "")} onClick={() => setView(k)}>
            {lbl} <b>({n})</b>
          </button>
        ))}
        <select className="input" style={{ width: "auto", marginLeft: "auto" }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option>All</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <section style={S.panel}>
        {isStockView ? (
          stockList.length === 0 ? (
            <Empty text="Nothing here — stock looks healthy." />
          ) : (
            <table className="tbl">
              <thead><tr><th>Item</th><th>Category</th><th style={{ textAlign: "right" }}>Stock</th><th style={{ textAlign: "right" }}>Alert below</th></tr></thead>
              <tbody>
                {stockList.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontWeight: 600 }}><span style={{ marginRight: 6 }}>{i.icon || "📦"}</span>{i.name}</td>
                    <td style={{ color: "#677" }}>{i.category}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, color: i.stock <= 0 ? "#C44536" : "#B0762A" }}>{i.stock} {i.unit}</td>
                    <td style={{ textAlign: "right", color: "var(--text-mid, #789)" }}>{i.lowAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          expList.length === 0 ? (
            <Empty text="No batches in this window." />
          ) : (
            <table className="tbl">
              <thead><tr><th>Item</th><th>Category</th><th style={{ textAlign: "right" }}>Batch qty</th><th>Expiry</th><th style={{ textAlign: "right" }}>Status</th></tr></thead>
              <tbody>
                {expList.map((r, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600 }}><span style={{ marginRight: 6 }}>{r.item.icon || "📦"}</span>{r.item.name}</td>
                    <td style={{ color: "#677" }}>{r.item.category}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{r.b.qty} {r.item.unit}</td>
                    <td>{r.b.expiry}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: r.d < 0 ? "#C44536" : "#B0762A" }}>{r.d < 0 ? `${-r.d}d ago` : `in ${r.d}d`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </section>
    </div>
  );
}


export { Alerts };
export default Alerts;
