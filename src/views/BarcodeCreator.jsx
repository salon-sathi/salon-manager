// BarcodeCreator — extracted from salon-manager.jsx.

import { Field, Header } from "../components/primitives.jsx";
import { findBarcodeClash, itemBarcodes } from "../lib/barcodes.js";
import { S } from "../lib/ui/css.js";
import { dateStr, escapeHtml, todayStr } from "../lib/ui/format.js";
import { STORE } from "../lib/ui/store.js";
import JsBarcode from "jsbarcode";
import { useEffect, useRef, useState } from "react";
import { printHtml } from "../lib/ui/assets.js";

// ---------- Barcode Creator ----------
// Format a YYYY-MM-DD date as MM/YY for compact shelf labels.
const mmYY = (ds) => {
  if (!ds) return "";
  const [y, m] = ds.split("-");
  return m && y ? `${m}/${y.slice(2)}` : "";
};
const LABEL_SIZES = {
  "38x25": { w: 38, h: 25, label: "38 × 25 mm (small)" },
  "50x30": { w: 50, h: 30, label: "50 × 30 mm (medium)" },
  "65x38": { w: 65, h: 38, label: "65 × 38 mm (large)" },
};

// Generate a code valid for the chosen symbology.
function genCode(format) {
  if (format === "EAN13") {
    let base = "890"; // GS1 India prefix
    for (let i = 0; i < 9; i++) base += Math.floor(Math.random() * 10);
    const d = base.split("").map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += d[i] * (i % 2 === 0 ? 1 : 3);
    return base + ((10 - (sum % 10)) % 10);
  }
  let s = "";
  for (let i = 0; i < 9; i++) s += Math.floor(Math.random() * 10);
  return "PSM" + s;
}

function barcodeDataUrl(value, format) {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, { format, width: 2, height: 60, fontSize: 16, margin: 6, displayValue: true });
  return canvas.toDataURL("image/png");
}

function BarcodeCreator({ items, setItems, store = STORE, notify, log }) {
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(genCode("CODE128"));
  const [format, setFormat] = useState("CODE128");
  const [mrp, setMrp] = useState("");
  const [sell, setSell] = useState("");
  const [pkd, setPkd] = useState(todayStr());
  const [exp, setExp] = useState("");
  const [qty, setQty] = useState(12);
  const [size, setSize] = useState("38x25");
  const [cw, setCw] = useState(40);
  const [ch, setCh] = useState(28);
  const [err, setErr] = useState(null);
  const svgRef = useRef(null);

  // Resolve the chosen label size (preset or custom width/height in mm).
  const sz = size === "custom"
    ? (() => { const w = Math.max(15, +cw || 40), h = Math.max(10, +ch || 28); return { w, h, label: `${w} × ${h} mm` }; })()
    : LABEL_SIZES[size];

  // Live barcode preview (re-rendered whenever the code or symbology changes).
  useEffect(() => {
    if (!svgRef.current) return;
    if (!code.trim()) { svgRef.current.innerHTML = ""; setErr(null); return; }
    try {
      JsBarcode(svgRef.current, code.trim(), { format, width: 2, height: 50, fontSize: 14, margin: 4, displayValue: true });
      setErr(null);
    } catch {
      setErr("This value isn't valid for " + format + (format === "EAN13" ? " — EAN-13 needs 12–13 digits." : "."));
    }
  }, [code, format]);

  const pickItem = (id) => {
    setItemId(id);
    const it = items.find((i) => i.id === id);
    if (!it) return;
    setName(it.name);
    setMrp(it.mrp || it.sellPrice || "");
    setSell(it.sellPrice || "");
    setCode(it.code ? it.code : genCode(format));
  };

  const saveToItem = () => {
    if (!itemId) return notify("Pick an inventory item first to save its barcode");
    const val = code.trim();
    if (!val) return notify("Nothing to save");
    const target = items.find((i) => i.id === itemId);
    if (!target) return notify("That item no longer exists");
    // Must be unique across every other product so a scan resolves to exactly one item.
    const clash = findBarcodeClash([val], items, itemId);
    if (clash) return notify(`Barcode “${val}” already belongs to “${clash.item.name}”.`);
    if (itemBarcodes(target).some((b) => b.toLowerCase() === val.toLowerCase()))
      return notify(`“${target.name}” already has that barcode.`);
    // Empty product → this becomes the default; otherwise it's an additional barcode.
    setItems((list) => list.map((i) => {
      if (i.id !== itemId) return i;
      return (i.code || "").trim()
        ? { ...i, barcodes: [...(Array.isArray(i.barcodes) ? i.barcodes : []), val], updatedAt: todayStr() }
        : { ...i, code: val, updatedAt: todayStr() };
    }));
    log("inventory", `Added barcode for “${name}” → ${val}`);
    notify("Barcode saved to item — it can now be scanned at billing");
  };

  const printLabels = () => {
    if (!code.trim()) return notify("Enter or generate a barcode first");
    let url;
    try { url = barcodeDataUrl(code.trim(), format); }
    catch { return notify("Invalid barcode value for " + format); }
    const n = Math.max(1, Math.min(300, +qty || 1));
    const priceLine = [mrp ? "MRP ₹" + escapeHtml(String(mrp)) : "", sell ? "Sell ₹" + escapeHtml(String(sell)) : ""].filter(Boolean).join("&nbsp;&nbsp;");
    const dateLine = [pkd ? "PKD " + mmYY(pkd) : "", exp ? "EXP " + mmYY(exp) : ""].filter(Boolean).join("&nbsp;&nbsp;");
    const one = `<div class="lbl">
      <div class="store">${escapeHtml(store.name)}</div>
      <div class="pname">${escapeHtml(name || "")}</div>
      <img src="${url}" />
      ${priceLine ? `<div class="price">${priceLine}</div>` : ""}
      <div class="dates">${dateLine}</div>
    </div>`;
    printHtml(`
      <style>
        @page { margin: 6mm; }
        body { margin:0; font-family: Arial, Helvetica, sans-serif; }
        .sheet { display:flex; flex-wrap:wrap; gap:2mm; }
        .lbl { width:${sz.w}mm; height:${sz.h}mm; box-sizing:border-box; border:1px dashed #c8c8c8;
               padding:1mm 1.5mm; display:flex; flex-direction:column; align-items:center;
               justify-content:space-between; overflow:hidden; text-align:center; }
        .store { font-size:6pt; font-weight:bold; color:#10331f; line-height:1; }
        .pname { font-size:7.5pt; font-weight:bold; line-height:1.05; max-height:2.3em; overflow:hidden; }
        .lbl img { max-width:100%; height:auto; flex:0 0 auto; }
        .price { font-size:8pt; font-weight:bold; line-height:1; }
        .dates { font-size:5.5pt; color:#333; line-height:1; }
        @media print { .lbl { border-color:#e5e5e5; } }
      </style>
      <div class="sheet">${one.repeat(n)}</div>`, "Barcode labels");
    log("inventory", `Printed ${n} barcode label(s) for “${name || code.trim()}”`);
    notify(`Sent ${n} label(s) to the printer`);
  };

  const addExpiry = (days) => {
    const d = new Date((pkd || todayStr()) + "T00:00");
    d.setDate(d.getDate() + days);
    setExp(dateStr(d));
  };

  return (
    <div>
      <Header title="Barcode Creator" sub="Generate scannable barcode labels to paste on shelf items" />
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section style={S.panel}>
          <div style={S.panelHead}>Label details</div>

          <Field label="From inventory (optional)">
            <select className="input" value={itemId} onChange={(e) => pickItem(e.target.value)}>
              <option value="">— manual entry —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </Field>

          <Field label="Product name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amul Butter 100g" /></Field>

          <div className="g-split" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
            <Field label="Barcode value"><input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan, type, or generate" /></Field>
            <button className="btn" style={{ marginBottom: 10 }} onClick={() => setCode(genCode(format))}>Generate</button>
          </div>

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Symbology">
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="CODE128">Code 128 (any text)</option>
                <option value="EAN13">EAN-13 (13 digits)</option>
              </select>
            </Field>
            <Field label="MRP (₹)"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={mrp} onChange={(e) => setMrp(e.target.value)} /></Field>
            <Field label="Selling price (₹)"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={sell} onChange={(e) => setSell(e.target.value)} /></Field>
            <Field label="Packaged date"><input className="input" type="date" max={todayStr()} value={pkd} onChange={(e) => setPkd(e.target.value)} /></Field>
            <Field label="Expiry date"><input className="input" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></Field>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: -2, marginBottom: 12 }}>
            <span style={{ fontSize: 11.5, color: "var(--text-mid, #6B7E74)", alignSelf: "center" }}>Expiry quick-set:</span>
            {[["1w", 7], ["1m", 30], ["3m", 90], ["6m", 180], ["1y", 365]].map(([lbl, d]) => (
              <button key={lbl} className="btn small ghost" onClick={() => addExpiry(d)}>+{lbl}</button>
            ))}
          </div>

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Label size">
              <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>
                {Object.entries(LABEL_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                <option value="custom">Custom…</option>
              </select>
            </Field>
            <Field label="How many labels"><input className="input" type="number" inputMode="decimal" min="1" max="300" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          </div>
          {size === "custom" && (
            <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Width (mm)"><input className="input" type="number" inputMode="decimal" min="15" max="200" value={cw} onChange={(e) => setCw(e.target.value)} /></Field>
              <Field label="Height (mm)"><input className="input" type="number" inputMode="decimal" min="10" max="200" value={ch} onChange={(e) => setCh(e.target.value)} /></Field>
            </div>
          )}

          {err && <div style={{ color: "#C44536", fontSize: 13, marginTop: 4 }}>{err}</div>}
          {itemId && <button className="btn ghost" style={{ width: "100%", marginTop: 8 }} onClick={saveToItem}>Save this barcode to the inventory item</button>}
        </section>

        <section style={S.panel}>
          <div style={S.panelHead}>Label preview</div>
          <div style={{ display: "grid", placeItems: "center", padding: "10px 0 16px" }}>
            <div style={{
              width: 230, minHeight: 130, border: "1px dashed #cfcfcf", borderRadius: 6, padding: "8px 10px",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", textAlign: "center", background: "var(--surface, #fff)",
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--ink)" }}>{store.name}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.1 }}>{name || <span style={{ color: "#AAB" }}>Product name</span>}</div>
              <svg ref={svgRef} style={{ maxWidth: "100%" }} />
              {(mrp || sell) ? (
                <div style={{ fontSize: 12, fontWeight: 800 }}>
                  {mrp ? "MRP ₹" + mrp : ""}{mrp && sell ? " · " : ""}{sell ? "Sell ₹" + sell : ""}
                </div>
              ) : null}
              <div style={{ fontSize: 9, color: "#445" }}>{pkd ? "PKD " + mmYY(pkd) : ""}{exp ? "  EXP " + mmYY(exp) : ""}</div>
            </div>
          </div>
          <button className="btn primary big" style={{ width: "100%" }} disabled={!code.trim() || !!err} onClick={printLabels}>
            🖨 Print {Math.max(1, Math.min(300, +qty || 1))} label(s) · {sz.label.split(" (")[0]}
          </button>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 10, lineHeight: 1.5 }}>
            Labels print as a tiled sheet at true millimetre size with dashed cut guides — set your printer to 100% / “Actual size” (not “Fit”). Saving the barcode to an item lets the cashier scan it on the Billing screen.
          </div>
        </section>
      </div>
    </div>
  );
}


export { BarcodeCreator };
export default BarcodeCreator;
