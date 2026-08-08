// Inventory — extracted from salon-manager.jsx.

import { Empty, Field, Header, Modal } from "../components/primitives.jsx";
import { findBarcodeClash, itemBarcodes, parseBarcodeText, withBarcodeSep } from "../lib/barcodes.js";
import { S } from "../lib/ui/css.js";
import { INR, todayStr, uid } from "../lib/ui/format.js";
import { CATEGORIES, UNITS, addBatch, batchSort, daysToExpiry, guessCategory, iconFor, isAutoIcon, normName, removeStock } from "../lib/ui/inventory.js";
import { Fragment, useMemo, useState } from "react";

// ---------- Inventory ----------
const blankItem = { name: "", code: "", barcodes: [], category: CATEGORIES[0], unit: "pc", icon: "", buyPrice: "", sellPrice: "", mrp: "", stock: "", lowAt: 5, expiry: "" };

function Inventory({ items, setItems, notify, log, cats = CATEGORIES, onAddCategory }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [form, setForm] = useState(null); // null | {…item, id?}
  const [restock, setRestock] = useState(null); // {id, name, qty, expiry}
  const [open, setOpen] = useState(null); // expanded item id (batch detail)
  const [rowEdit, setRowEdit] = useState(null); // inline row edit draft {id, …editable fields}
  const [batchEdit, setBatchEdit] = useState(null); // inline batch editor {id, untracked, rows:[{id,qty,expiry,addedOn}]}
  const [quickEdit, setQuickEdit] = useState(false); // edit-all-rows mode (no per-row Edit click)
  const [drafts, setDrafts] = useState(null); // { [id]: {icon,name,code,category,unit,buyPrice,sellPrice,stock,createdAt} }
  const [sort, setSort] = useState({ key: "name", dir: 1 }); // dir: 1 asc, -1 desc

  const filtered = items.filter((i) => {
    const term = q.trim().toLowerCase();
    return (
      (cat === "All" || i.category === cat) &&
      (i.name.toLowerCase().includes(term) || itemBarcodes(i).some((b) => b.toLowerCase().includes(term)))
    );
  });

  // Sortable columns. Click a header to sort by it; click again to flip direction.
  const SORT_VALUE = {
    name: (i) => (i.name || "").toLowerCase(),
    category: (i) => (i.category || "").toLowerCase(),
    createdAt: (i) => i.createdAt || "",
    buyPrice: (i) => +i.buyPrice || 0,
    sellPrice: (i) => +i.sellPrice || 0,
    margin: (i) => (+i.sellPrice || 0) - (+i.buyPrice || 0),
    stock: (i) => +i.stock || 0,
  };
  const sorted = useMemo(() => {
    const val = SORT_VALUE[sort.key] || SORT_VALUE.name;
    return [...filtered].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort]);
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  // Plain element helper (not a nested component) so header cells don't remount each render.
  const sortTh = (k, label, align) => (
    <th key={k} onClick={() => toggleSort(k)} style={{ cursor: "pointer", textAlign: align || "left", userSelect: "none", whiteSpace: "nowrap" }} title="Click to sort">
      {label}{arrow(k)}
    </th>
  );

  const save = () => {
    const f = form;
    if (!f.name.trim()) return notify("Item name is required");
    const buy = +f.buyPrice, sell = +f.sellPrice, lowAt = +f.lowAt || 0;
    if (!(sell > 0)) return notify("Selling price must be more than 0");
    if (buy < 0 || sell < 0) return notify("Prices cannot be negative");
    // Block duplicate names (case-insensitive). On edit, ignore the item being edited.
    const nn = normName(f.name);
    const clash = items.find((i) => normName(i.name) === nn && i.id !== f.id);
    if (clash) {
      return notify(f.id
        ? `Another item is already named “${clash.name}”.`
        : `“${clash.name}” already exists — use Restock or edit it instead.`);
    }
    // Barcodes: parse the ";"-separated field, de-dupe, then check uniqueness across every other
    // product so a scanned barcode can only ever resolve to one item. First token = primary `code`.
    const codes = parseBarcodeText(f.barcodeText ?? f.code);
    const bcClash = findBarcodeClash(codes, items, f.id);
    if (bcClash) return notify(`Barcode “${bcClash.code}” already belongs to “${bcClash.item.name}”.`);
    const base = {
      name: f.name.trim(), code: codes[0] || "", barcodes: codes.slice(1), category: f.category, unit: f.unit,
      icon: (f.icon || "").trim() || iconFor(f.category), buyPrice: buy || 0, sellPrice: sell,
      mrp: +f.mrp || sell, lowAt,
    };
    if (f.id) {
      const newStock = Math.max(0, +f.stock || 0);
      const prevForLog = (items.find((i) => i.id === f.id)?.stock) || 0;
      // Functional updater so a live cloud snapshot landing mid-edit can't drop other items;
      // diff is taken from the LIVE stock so reconciliation is correct even if it just changed.
      setItems((list) => list.map((i) => {
        if (i.id !== f.id) return i;
        const diff = newStock - (i.stock || 0);
        let updated = { ...i, ...base, updatedAt: todayStr() };
        // Reconcile batches with the edited stock: grow → new batch, shrink → FIFO deplete.
        if (diff > 0) updated = addBatch(updated, diff, f.expiry, todayStr());
        else if (diff < 0) updated = removeStock(updated, -diff, todayStr());
        return updated;
      }));
      log("inventory", `Edited item “${base.name}”` + (newStock !== prevForLog ? ` · stock ${prevForLog}→${newStock}` : ""));
      notify("Item updated");
    } else {
      const stock = +f.stock || 0;
      const batches = stock > 0 ? [{ id: uid(), qty: stock, expiry: f.expiry || "", addedOn: todayStr() }] : [];
      const newItem = { ...base, id: uid(), stock, batches, createdAt: todayStr() };
      setItems((list) => [...list, newItem]);
      log("inventory", `Added item “${base.name}” · ${stock} ${base.unit} @ ${INR(sell)}` + (f.expiry ? ` (exp ${f.expiry})` : ""));
      notify("Item added to inventory");
    }
    setForm(null);
  };

  const doRestock = () => {
    const qty = +restock.qty;
    if (!(qty > 0)) return notify("Enter quantity to add");
    setItems((list) => list.map((i) => (i.id === restock.id ? addBatch(i, qty, restock.expiry, todayStr()) : i)));
    log("inventory", `Restocked “${restock.name}” +${qty}` + (restock.expiry ? ` (exp ${restock.expiry})` : ""));
    setRestock(null);
    notify("Stock added");
  };

  const del = (i) => {
    if (!confirm("Delete " + i.name + "?")) return;
    setItems((list) => list.filter((x) => x.id !== i.id));
    if (rowEdit?.id === i.id) setRowEdit(null);
    log("inventory", `Deleted item “${i.name}”`);
  };

  // ----- Inline row editing: make every on-screen field editable in place -----
  const startRowEdit = (i) => setRowEdit({
    id: i.id, icon: i.icon || "", name: i.name || "", barcodeText: itemBarcodes(i).join("; "),
    category: i.category || "Other", unit: i.unit || "pc",
    buyPrice: String(i.buyPrice ?? ""), sellPrice: String(i.sellPrice ?? ""),
    stock: String(i.stock ?? 0), createdAt: i.createdAt || todayStr(),
  });
  const saveRowEdit = () => {
    const f = rowEdit;
    if (!f.name.trim()) return notify("Item name is required");
    const buy = +f.buyPrice || 0, sell = +f.sellPrice;
    if (!(sell > 0)) return notify("Selling price must be more than 0");
    if (buy < 0 || sell < 0) return notify("Prices cannot be negative");
    const nn = normName(f.name);
    const clash = items.find((i) => normName(i.name) === nn && i.id !== f.id);
    if (clash) return notify(`Another item is already named “${clash.name}”.`);
    // Multi-barcode: parse the ";"-separated field, de-dupe, and check uniqueness across products.
    const codes = parseBarcodeText(f.barcodeText);
    const bcClash = findBarcodeClash(codes, items, f.id);
    if (bcClash) return notify(`Barcode “${bcClash.code}” already belongs to “${bcClash.item.name}”.`);
    const newStock = Math.max(0, +f.stock || 0);
    const prevForLog = (items.find((i) => i.id === f.id)?.stock) || 0;
    // Functional updater so a live cloud snapshot mid-edit can't drop other items; the stock
    // diff is taken from the LIVE row and reconciled into batches (grow → batch, shrink → FIFO).
    setItems((list) => list.map((i) => {
      if (i.id !== f.id) return i;
      const diff = newStock - (i.stock || 0);
      let updated = {
        ...i,
        icon: (f.icon || "").trim() || iconFor(f.category),
        name: f.name.trim(), code: codes[0] || "", barcodes: codes.slice(1),
        category: f.category, unit: f.unit,
        buyPrice: buy, sellPrice: sell, mrp: +i.mrp || sell,
        createdAt: f.createdAt || i.createdAt, updatedAt: todayStr(),
      };
      if (diff > 0) updated = addBatch(updated, diff, "", todayStr());
      else if (diff < 0) updated = removeStock(updated, -diff, todayStr());
      return updated;
    }));
    log("inventory", `Edited item “${f.name.trim()}”` + (newStock !== prevForLog ? ` · stock ${prevForLog}→${newStock}` : ""));
    setRowEdit(null);
    notify("Item updated");
  };

  // ----- Inline batch editing (the expanded detail): edit every batch's qty / expiry / date -----
  // The editor is the full definition of the item's stock: stock = Σ batch qty on save. Any
  // undated remainder (older stock that predates batches) is pre-loaded as an editable row so
  // nothing is lost and there's no double-counting.
  const startBatchEdit = (i) => {
    const rows = [...(i.batches || [])].sort(batchSort).map((b) => ({ id: b.id, qty: String(b.qty ?? ""), expiry: b.expiry || "", addedOn: b.addedOn || todayStr() }));
    const undated = (i.stock || 0) - (i.batches || []).reduce((a, b) => a + (+b.qty || 0), 0);
    if (undated > 0) rows.push({ id: uid(), qty: String(undated), expiry: "", addedOn: i.createdAt || todayStr() });
    setBatchEdit({ id: i.id, rows });
  };
  const setBatchField = (bid, k, v) => setBatchEdit((be) => ({ ...be, rows: be.rows.map((b) => (b.id === bid ? { ...b, [k]: v } : b)) }));
  const addBatchRow = () => setBatchEdit((be) => ({ ...be, rows: [...be.rows, { id: uid(), qty: "", expiry: "", addedOn: todayStr() }] }));
  const removeBatchRow = (bid) => setBatchEdit((be) => ({ ...be, rows: be.rows.filter((b) => b.id !== bid) }));
  const batchEditSum = batchEdit ? batchEdit.rows.reduce((a, b) => a + (+b.qty || 0), 0) : 0;
  const saveBatchEdit = () => {
    const f = batchEdit;
    const batches = f.rows
      .map((b) => ({ id: b.id, qty: +b.qty || 0, expiry: b.expiry || "", addedOn: b.addedOn || todayStr() }))
      .filter((b) => b.qty > 0); // drop blank / zero-qty rows
    const stock = batches.reduce((a, b) => a + b.qty, 0);
    setItems((list) => list.map((i) => (i.id === f.id ? { ...i, batches, stock, updatedAt: todayStr() } : i)));
    log("inventory", `Edited batches · stock now ${stock}`);
    setBatchEdit(null);
    notify("Batches updated");
  };

  // ----- Quick edit: make every row directly editable at once, applied on one "Save all" -----
  const draftOf = (i) => ({
    icon: i.icon || "", name: i.name || "", barcodeText: itemBarcodes(i).join("; "),
    category: i.category || "Other", unit: i.unit || "pc",
    buyPrice: String(i.buyPrice ?? ""), sellPrice: String(i.sellPrice ?? ""),
    stock: String(i.stock ?? 0), createdAt: i.createdAt || todayStr(),
  });
  const enterQuick = () => {
    const d = {};
    items.forEach((i) => { d[i.id] = draftOf(i); });
    setDrafts(d); setQuickEdit(true); setRowEdit(null); setBatchEdit(null);
  };
  const exitQuick = () => { setQuickEdit(false); setDrafts(null); };
  const setDraft = (id, k, v) => setDrafts((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));
  const saveAllQuick = () => {
    const seen = new Map();
    for (const id of Object.keys(drafts)) {
      const f = drafts[id];
      if (!f.name.trim()) return notify("Every item needs a name.");
      if (!(+f.sellPrice > 0)) return notify(`“${f.name.trim() || "Item"}” needs a selling price greater than 0.`);
      if (+f.buyPrice < 0 || +f.sellPrice < 0) return notify("Prices cannot be negative.");
      const nn = normName(f.name);
      if (seen.has(nn)) return notify(`Duplicate name: “${f.name.trim()}”.`);
      seen.set(nn, id);
    }
    // Barcode uniqueness across the whole catalogue: each edited row's full parsed barcode list,
    // plus the stored barcodes of items left out of the edit. No barcode may belong to two items.
    const bcOwner = new Map(); // normalized barcode → item id
    for (const it of items) {
      const f = drafts[it.id];
      const codes = f ? parseBarcodeText(f.barcodeText) : itemBarcodes(it);
      for (const b of codes) {
        const k = b.toLowerCase();
        const prev = bcOwner.get(k);
        if (prev && prev !== it.id) return notify(`Barcode “${b}” is used by more than one item.`);
        bcOwner.set(k, it.id);
      }
    }
    setItems((list) => list.map((i) => {
      const f = drafts[i.id];
      if (!f) return i; // items added after entering quick edit are left untouched
      const codes = parseBarcodeText(f.barcodeText);
      const newStock = Math.max(0, +f.stock || 0);
      const diff = newStock - (i.stock || 0);
      let updated = {
        ...i,
        icon: (f.icon || "").trim() || iconFor(f.category),
        name: f.name.trim(), code: codes[0] || "", barcodes: codes.slice(1),
        category: f.category, unit: f.unit,
        buyPrice: +f.buyPrice || 0, sellPrice: +f.sellPrice, mrp: +i.mrp || (+f.sellPrice),
        createdAt: f.createdAt || i.createdAt, updatedAt: todayStr(),
      };
      if (diff > 0) updated = addBatch(updated, diff, "", todayStr());
      else if (diff < 0) updated = removeStock(updated, -diff, todayStr());
      return updated;
    }));
    log("inventory", `Quick-edited ${Object.keys(drafts).length} item(s)`);
    setQuickEdit(false); setDrafts(null);
    notify("All changes saved");
  };

  const stop = (e) => e.stopPropagation();

  // ----- Add/Edit modal: multi-barcode entry (one ";"-separated field; first token = default) -----
  // A scanner ends each barcode with Enter; that must NOT save the form. Instead it appends a "; "
  // separator so the next scan lands after it — letting the cashier scan any number of barcodes
  // (10, 20, …) into the one field in a row. `code` + `barcodes[]` are parsed from it on save.
  const onBarcodeKey = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const cur = e.target.value; // full scanned value straight from the DOM
    setForm((f) => ({ ...f, barcodeText: withBarcodeSep(cur) }));
  };

  // Editable cells (icon/name, barcodes, category, added date, buy, sell, margin, stock+unit) shared
  // by per-row Edit and Quick edit. `d` is the draft, `sf(key,val)` updates it, `actionCell` is
  // the trailing cell (Save/Cancel for one row, empty in quick mode). The barcode cell is a full
  // multi-barcode field: a scanner's Enter appends "; " so several can be scanned into one row.
  const renderEditRow = (d, sf, actionCell) => (
    <tr>
      <td onClick={stop}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input className="input" style={{ padding: "6px 4px", width: 38, textAlign: "center" }} value={d.icon} placeholder={iconFor(d.category)} onChange={(e) => sf("icon", e.target.value)} aria-label="Icon" />
          <input className="input" style={{ padding: "6px 8px", minWidth: 96, flex: 1 }} value={d.name} onChange={(e) => sf("name", e.target.value)} aria-label="Name" />
        </div>
      </td>
      <td onClick={stop}>
        <input
          className="input" style={{ padding: "6px 8px", width: 150 }}
          value={d.barcodeText || ""} placeholder="scan barcode(s)"
          onChange={(e) => sf("barcodeText", e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sf("barcodeText", withBarcodeSep(e.target.value)); } }}
          aria-label="Barcodes, separated by semicolons; first is the default"
          title="Scan or type; Enter adds a “;” so you can scan several. The first is the default." />
      </td>
      <td onClick={stop}>
        <select className="input" style={{ padding: "6px 4px" }} value={d.category} onChange={(e) => { const c = e.target.value; sf("category", c); if (isAutoIcon(d.icon, d.category)) sf("icon", iconFor(c)); }} aria-label="Category">
          {cats.map((c) => <option key={c}>{c}</option>)}
          {d.category && !cats.includes(d.category) && <option key={d.category}>{d.category}</option>}
        </select>
      </td>
      <td onClick={stop}><input className="input" style={{ padding: "6px 4px" }} type="date" max={todayStr()} value={d.createdAt} onChange={(e) => sf("createdAt", e.target.value)} aria-label="Added date" /></td>
      <td onClick={stop}><input className="input" style={{ padding: "6px 8px", width: 76, textAlign: "right" }} type="number" inputMode="decimal" min="0" step="0.01" value={d.buyPrice} onChange={(e) => sf("buyPrice", e.target.value)} aria-label="Buy price" /></td>
      <td onClick={stop}><input className="input" style={{ padding: "6px 8px", width: 76, textAlign: "right" }} type="number" inputMode="decimal" min="0" step="0.01" value={d.sellPrice} onChange={(e) => sf("sellPrice", e.target.value)} aria-label="Sell price" /></td>
      <td style={{ textAlign: "right", color: "var(--brand)" }}>{+d.buyPrice > 0 ? Math.round(((+d.sellPrice - +d.buyPrice) / +d.buyPrice) * 100) + "%" : "—"}</td>
      <td onClick={stop}>
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          <input className="input" style={{ padding: "6px 8px", width: 60, textAlign: "right" }} type="number" inputMode="decimal" min="0" value={d.stock} onChange={(e) => sf("stock", e.target.value)} aria-label="Stock" />
          <select className="input" style={{ padding: "6px 4px" }} value={d.unit} onChange={(e) => sf("unit", e.target.value)} aria-label="Unit">
            {UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
      </td>
      {actionCell}
    </tr>
  );

  return (
    <div>
      <Header title="Inventory" sub={items.length + " items · click a header to sort · a row to see batches · Edit (or Quick edit) to change fields inline"}>
        {quickEdit ? (
          <>
            <button className="btn primary" onClick={saveAllQuick}>✓ Save all</button>{" "}
            <button className="btn ghost" onClick={exitQuick}>Cancel</button>
          </>
        ) : (
          <>
            {onAddCategory && <><button className="btn ghost" onClick={() => onAddCategory()} title="Create a new category you can assign to items">＋ New category</button>{" "}</>}
            <button className="btn ghost" onClick={enterQuick} disabled={items.length === 0} title="Edit every row's fields directly, then save once">✎ Quick edit</button>{" "}
            <button className="btn primary" onClick={() => setForm({ ...blankItem, barcodeText: "" })}>+ Add item</button>
          </>
        )}
      </Header>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <input className="input" placeholder="Find an item…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 220 }}>
          <option>All</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <section style={S.panel}>
        <table className="tbl">
          <thead>
            <tr>
              {sortTh("name", "Item")}
              <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Barcode</th>
              {sortTh("category", "Category")}
              {sortTh("createdAt", "Added")}
              {sortTh("buyPrice", "Buy", "right")}
              {sortTh("sellPrice", "Sell", "right")}
              {sortTh("margin", "Margin", "right")}
              {sortTh("stock", "Stock", "right")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => {
              const dte = daysToExpiry(i);
              const isOpen = open === i.id;
              return (
                <Fragment key={i.id}>
                  {quickEdit && drafts[i.id] ? (
                    renderEditRow(drafts[i.id], (k, v) => setDraft(i.id, k, v), <td />)
                  ) : rowEdit?.id === i.id ? (
                    renderEditRow(rowEdit, (k, v) => setRowEdit((e) => ({ ...e, [k]: v })), (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={stop}>
                        <button className="btn small primary" aria-label="Save item" onClick={saveRowEdit}>✓</button>{" "}
                        <button className="btn small ghost" aria-label="Cancel edit" onClick={() => setRowEdit(null)}>✕</button>
                      </td>
                    ))
                  ) : (
                  <tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : i.id)}>
                    <td style={{ fontWeight: 600 }}>
                      <span style={{ marginRight: 6 }}>{i.icon || "📦"}</span>{i.name}
                      <span style={{ color: "#AAB", marginLeft: 6 }}>{isOpen ? "▾" : "▸"}</span>
                    </td>
                    <td style={{ color: "#677", fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {(() => {
                        const bcs = itemBarcodes(i);
                        if (!bcs.length) return <span style={{ color: "#B7C2BA" }}>—</span>;
                        return <span title={bcs.join(", ")}>{bcs[0]}{bcs.length > 1 ? <span style={{ color: "var(--brand)", fontWeight: 700 }}> +{bcs.length - 1}</span> : null}</span>;
                      })()}
                    </td>
                    <td style={{ color: "#677" }}>{i.category}</td>
                    <td style={{ color: "var(--text-mid, #789)", whiteSpace: "nowrap", fontSize: 12.5 }}>{i.createdAt || "—"}{i.updatedAt && i.updatedAt !== i.createdAt ? <span title={"edited " + i.updatedAt}> ✎</span> : null}</td>
                    <td style={{ textAlign: "right" }}>{INR(i.buyPrice)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{INR(i.sellPrice)}</td>
                    <td style={{ textAlign: "right", color: "var(--brand)" }}>{i.buyPrice ? Math.round(((i.sellPrice - i.buyPrice) / i.buyPrice) * 100) + "%" : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: i.stock <= i.lowAt ? "#C44536" : "#223" }}>
                      {i.stock} {i.unit}{i.stock <= i.lowAt && " ⚠"}
                      {dte != null && dte <= 30 && <div style={{ fontSize: 10.5, fontWeight: 600, color: dte < 0 ? "#C44536" : "#B0762A" }}>{dte < 0 ? "expired" : "exp in " + dte + "d"}</div>}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn small" onClick={(e) => { stop(e); setRestock({ id: i.id, name: i.name, qty: "", expiry: "" }); }}>Restock</button>{" "}
                      <button className="btn small ghost" onClick={(e) => { stop(e); startRowEdit(i); }}>Edit</button>{" "}
                      <button className="btn small ghost" title="More fields (MRP, barcodes, low-stock alert, dated stock)" aria-label={"More fields for " + i.name} onClick={(e) => { stop(e); setForm({ ...i, mrp: i.mrp ?? "", icon: i.icon || "", barcodeText: itemBarcodes(i).join("; "), expiry: "" }); }}>⚙</button>{" "}
                      <button className="btn small danger" aria-label={"Delete " + i.name} onClick={(e) => { stop(e); del(i); }}>✕</button>
                    </td>
                  </tr>
                  )}
                  {!quickEdit && isOpen && (
                    <tr>
                      <td colSpan={9} style={{ background: "var(--surface-2, #F7FAF7)" }}>
                        {batchEdit?.id === i.id ? (
                          <div onClick={stop}>
                            <table className="tbl" style={{ margin: 0 }}>
                              <thead><tr><th style={{ width: 110 }}>Batch qty</th><th style={{ width: 170 }}>Expiry</th><th style={{ width: 170 }}>Date added</th><th style={{ width: 30 }}></th></tr></thead>
                              <tbody>
                                {batchEdit.rows.map((b) => (
                                  <tr key={b.id}>
                                    <td><input className="input" style={{ padding: "6px 8px", width: 80 }} type="number" inputMode="decimal" min="0" value={b.qty} onChange={(e) => setBatchField(b.id, "qty", e.target.value)} aria-label="Batch quantity" /></td>
                                    <td><input className="input" style={{ padding: "6px 8px" }} type="date" value={b.expiry} onChange={(e) => setBatchField(b.id, "expiry", e.target.value)} aria-label="Batch expiry" /></td>
                                    <td><input className="input" style={{ padding: "6px 8px" }} type="date" max={todayStr()} value={b.addedOn} onChange={(e) => setBatchField(b.id, "addedOn", e.target.value)} aria-label="Date added" /></td>
                                    <td><button className="btn small danger" aria-label="Remove batch" onClick={() => removeBatchRow(b.id)}>✕</button></td>
                                  </tr>
                                ))}
                                {batchEdit.rows.length === 0 && <tr><td colSpan={4}><Empty text="No batches — add one below." /></td></tr>}
                              </tbody>
                            </table>
                            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <button className="btn small ghost" onClick={addBatchRow}>+ Add batch</button>
                              <button className="btn small primary" onClick={saveBatchEdit}>✓ Save batches</button>
                              <button className="btn small ghost" onClick={() => setBatchEdit(null)}>Cancel</button>
                              <span style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginLeft: "auto" }}>New stock total: <b>{batchEditSum} {i.unit}</b></span>
                            </div>
                          </div>
                        ) : (
                          <>
                            {i.batches && i.batches.length ? (
                              <table className="tbl" style={{ margin: 0 }}>
                                <thead><tr><th style={{ width: 120 }}>Batch qty</th><th style={{ width: 160 }}>Expiry</th><th>Date added</th></tr></thead>
                                <tbody>
                                  {[...i.batches].sort(batchSort).map((b) => {
                                    const bd = b.expiry ? Math.round((new Date(b.expiry + "T00:00") - new Date(todayStr() + "T00:00")) / 86400000) : null;
                                    const col = bd == null ? "#677" : bd < 0 ? "#C44536" : bd <= 30 ? "#B0762A" : "#677";
                                    return (
                                      <tr key={b.id}>
                                        <td style={{ fontWeight: 700 }}>{b.qty} {i.unit}</td>
                                        <td style={{ color: col, fontWeight: bd != null && bd <= 30 ? 700 : 400 }}>{b.expiry || "— no expiry —"}{bd != null && bd <= 30 ? (bd < 0 ? " (expired)" : ` (${bd}d left)`) : ""}</td>
                                        <td style={{ color: "#677" }}>{b.addedOn}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : (
                              <div style={{ padding: "8px 4px", color: "#8A9", fontSize: 13 }}>No batch / expiry detail yet.</div>
                            )}
                            <div style={{ marginTop: 8 }} onClick={stop}>
                              <button className="btn small ghost" onClick={() => startBatchEdit(i)}>✎ Edit batches</button>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={9}><Empty text="No items found." /></td></tr>}
          </tbody>
        </table>
      </section>

      {form && (
        <Modal title={form.id ? "Edit item" : "Add new item"} onClose={() => setForm(null)}>
          <Field label="Item name"><input className="input" autoFocus value={form.name} onChange={(e) => {
            const name = e.target.value;
            setForm((f) => {
              // For a NEW item, auto-pick the category from the name until the user picks one
              // manually; carry the icon along if it's still auto.
              if (f.id || f.categoryTouched) return { ...f, name };
              const g = guessCategory(name, items);
              if (!g || g === f.category) return { ...f, name };
              return { ...f, name, category: g, icon: isAutoIcon(f.icon, f.category) ? iconFor(g) : f.icon };
            });
          }} placeholder="e.g. Amul Butter 100g" /></Field>
          <Field label="Barcodes (optional)">
            <textarea
              className="input"
              rows={2}
              value={form.barcodeText || ""}
              onChange={(e) => setForm({ ...form, barcodeText: e.target.value })}
              onKeyDown={onBarcodeKey}
              placeholder="Scan or type barcodes — press Enter after each. First one is the default."
              aria-label="Barcodes, separated by semicolons; the first is the default"
              style={{ resize: "vertical", minHeight: 62, lineHeight: 1.5, fontFamily: "inherit" }}
            />
            <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 4 }}>
              Separate multiple barcodes with “<b>;</b>” — scanning auto-adds it. Add as many as you like; the first is the item's default.
            </div>
          </Field>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Category">
              <div style={{ display: "flex", gap: 6 }}>
                <select className="input" style={{ flex: 1 }} value={form.category} onChange={(e) => { const c = e.target.value; setForm((f) => ({ ...f, category: c, categoryTouched: true, icon: isAutoIcon(f.icon, f.category) ? iconFor(c) : f.icon })); }}>
                  {cats.map((c) => <option key={c}>{c}</option>)}
                  {form.category && !cats.includes(form.category) && <option key={form.category}>{form.category}</option>}
                </select>
                {onAddCategory && (
                  <button type="button" className="btn ghost" style={{ padding: "0 10px", whiteSpace: "nowrap" }} title="Add a new category"
                    onClick={() => { const c = onAddCategory(); if (c) setForm((f) => ({ ...f, category: c, categoryTouched: true, icon: isAutoIcon(f.icon, f.category) ? iconFor(c) : f.icon })); }}>
                    ＋ New
                  </button>
                )}
              </div>
            </Field>
            <Field label="Unit">
              <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Icon (emoji)"><input className="input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder={iconFor(form.category)} /></Field>
            <Field label="MRP (₹)"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} /></Field>
            <Field label="Buying price (₹)"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.buyPrice} onChange={(e) => setForm({ ...form, buyPrice: e.target.value })} /></Field>
            <Field label="Selling price (₹)"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} /></Field>
            <Field label={form.id ? "Stock quantity" : "Opening stock"}><input className="input" type="number" inputMode="decimal" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></Field>
            <Field label={form.id ? "Expiry (for added stock)" : "Expiry (optional)"}><input className="input" type="date" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} /></Field>
            <Field label="Alert when stock below"><input className="input" type="number" inputMode="decimal" min="0" value={form.lowAt} onChange={(e) => setForm({ ...form, lowAt: e.target.value })} /></Field>
          </div>
          {form.id && <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", marginTop: 8 }}>Changing stock here adjusts batches automatically (increase adds a batch using the expiry above; decrease removes earliest-expiry stock first). For a specific dated batch, use <b>Restock</b>.</div>}
          <button className="btn primary big" style={{ width: "100%", marginTop: 14 }} onClick={save}>
            {form.id ? "Save changes" : "Add item"}
          </button>
        </Modal>
      )}

      {restock && (
        <Modal title={"Restock — " + restock.name} onClose={() => setRestock(null)}>
          <Field label="Quantity to add">
            <input className="input" type="number" inputMode="decimal" min="0" autoFocus value={restock.qty} onChange={(e) => setRestock({ ...restock, qty: e.target.value })} />
          </Field>
          <Field label="Expiry date (optional)">
            <input className="input" type="date" value={restock.expiry} onChange={(e) => setRestock({ ...restock, expiry: e.target.value })} />
          </Field>
          <button className="btn primary big" style={{ width: "100%", marginTop: 12 }} onClick={doRestock}>Add stock</button>
        </Modal>
      )}
    </div>
  );
}


export { Inventory };
export default Inventory;
