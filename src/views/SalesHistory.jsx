// SalesHistory — extracted from salon-manager.jsx.

import { PAY_COLORS } from "../components/chartkit.jsx";
import { Empty, Field, Header, Modal } from "../components/primitives.jsx";
import { findBarcodeClash, findItemByBarcode, itemBarcodes, parseBarcodeText } from "../lib/barcodes.js";
import { can } from "../lib/roles.js";
import { isServiceLine, staffName } from "../lib/salon.js";
import { INR, dateStr, money, todayStr, uid } from "../lib/ui/format.js";
import { addBatch, guessCategory, iconFor, normName, removeStock } from "../lib/ui/inventory.js";
import { STORE } from "../lib/ui/store.js";
import { useMemo, useState } from "react";
import { S } from "../lib/ui/css.js";
import { SendBillActions, printReceipt, receiptExtras } from "../components/receipt.jsx";

// guardOnline is needed for one thing only: sending a bill uploads its image, and an upload
// with no connection must raise the same "not saved — you're offline" modal every other write
// does, rather than failing somewhere inside Firebase Storage.
function SalesHistory({ sales, items, staff, services = [], customerPackages = [], setSales, setItems, store = STORE, notify, log, role, perms, guardOnline = () => true }) {
  const [open, setOpen] = useState(null);
  const [openDates, setOpenDates] = useState(() => new Set()); // expanded past dates (today is always open)
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState(""); // free-text search across bills
  const [editing, setEditing] = useState(null); // { id, date, payment, lines:[...], orig:[...] }
  // "Add item on the go" fields for the Edit-bill modal: catalogue search + quick-catalogue row.
  const [addQ, setAddQ] = useState("");
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const toggleDate = (d) => setOpenDates((s) => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });

  // Search matches a bill when EVERY space-separated term is found somewhere in it —
  // item names, customer, mobile, payment, date/time, bill id, or any amount/quantity.
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const matchSale = (s) => {
    if (!searching) return true;
    const hay = [
      s.date, s.time, s.payment, s.customer, s.mobile, s.id, s.total, s.profit, s.paid,
      ...(s.lines || []).flatMap((l) => [l.name, l.qty, l.amount, l.price]),
    ].filter((v) => v != null).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  };

  const visible = sales.filter((s) => (!from || s.date >= from) && (!to || s.date <= to) && matchSale(s));
  const byDate = useMemo(() => {
    const m = {};
    [...visible].reverse().forEach((s) => { (m[s.date] = m[s.date] || []).push(s); });
    return Object.entries(m).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [visible]);
  const rangeTotal = money(visible.reduce((a, s) => a + s.total, 0));

  // Adjust stock by per-item-name deltas (positive = sell more → remove; negative = add back).
  const applyDeltas = (deltas) => {
    setItems((its) => its.map((i) => {
      const d = deltas[i.name.toLowerCase()];
      if (!d) return i;
      return d > 0 ? removeStock(i, d, todayStr()) : addBatch(i, -d, "", todayStr());
    }));
  };

  const deleteSale = (s) => {
    // Belt and braces: the nav never offers this view's delete to a worker, and the database
    // rules reject the write anyway — but the guard belongs next to the action too.
    if (!can(role, "sales.delete", perms)) return notify("⚠ Only the owner can delete a bill.");
    // Spell out everything that reverses. Points and package sessions come back on their own
    // (both are derived from the bills), but the person deleting it should know that up front
    // rather than discover it at the counter next week.
    const undone = [
      s.lines?.some((l) => !l.misc && !isServiceLine(l)) ? "stock will be added back" : "",
      s.pointsEarned ? `${s.pointsEarned} point(s) earned will be removed` : "",
      s.pointsRedeemed ? `${s.pointsRedeemed} point(s) used will be returned` : "",
      s.packageRedemptions?.length ? `${s.packageRedemptions.length} package session(s) will be returned` : "",
    ].filter(Boolean);
    const detail = undone.length ? `\n\n${undone.map((u) => "• " + u).join("\n")}` : "";
    if (!confirm(`Delete this ${INR(s.total)} bill from ${s.date}?${detail}`)) return;
    const deltas = {};
    // Misc / custom lines have no inventory item, and SERVICE lines have no stock at all, so
    // neither has anything to restore. Without the service guard a service that happens to
    // share a name with a product would silently inflate that product's stock on every delete.
    s.lines.forEach((l) => {
      if (l.misc || isServiceLine(l)) return;
      deltas[l.name.toLowerCase()] = (deltas[l.name.toLowerCase()] || 0) - l.qty;
    });
    applyDeltas(deltas);
    setSales((all) => all.filter((x) => x.id !== s.id));
    // The customer's visit/spend stats reverse themselves: the shell reconciles them from the
    // bills, so removing the bill is the whole of the reversal. See reconcileCustomers.
    log("sale", `Deleted bill ${INR(s.total)} (${s.date}) — stock restored`);
    notify("Bill deleted, stock restored");
  };

  const openEdit = (s) => setEditing({
    id: s.id, date: s.date, payment: s.payment || "UPI", paid: s.paid != null ? String(s.paid) : "", paidMode: s.paidMode || "Cash",
    discount: s.discount != null ? String(s.discount) : "", // editable ₹ discount (a % discount is edited as its ₹ value)
    lines: s.lines.map((l) => ({ ...l })), orig: s.lines.map((l) => ({ ...l })),
  });
  const editLine = (idx, qty) => setEditing((e) => ({ ...e, lines: e.lines.map((l, i) => (i === idx ? { ...l, qty: Math.max(0, qty || 0) } : l)) }));
  const removeLine = (idx) => setEditing((e) => ({ ...e, lines: e.lines.filter((_, i) => i !== idx) }));

  // ----- Add items to a bill while editing it -----
  // Matches Billing's picker + Misc row so the two flows behave identically. Nothing here changes
  // stock directly for existing items — saveEdit reconciles stock by name (orig vs new lines), so a
  // line added here simply depletes that item's stock by its qty when the edit is saved.
  const OPENING_STOCK = 20;     // opening stock for a quick-catalogued item (same as Billing)
  const BUY_PRICE_RATIO = 0.8;  // default cost = 80% of sell price (≈20% margin)
  const resetAddItem = () => { setAddQ(""); setNewName(""); setNewCode(""); setNewPrice(""); };
  const closeEdit = () => { setEditing(null); resetAddItem(); };

  // Catalogue items matching the add-search box (name / barcode / an exact price).
  const addMatches = useMemo(() => {
    const s = addQ.trim().toLowerCase();
    if (!editing || !s) return [];
    const isNum = /^\d+(\.\d+)?$/.test(s);
    const num = isNum ? +s : null;
    return items.filter((i) =>
      i.name.toLowerCase().includes(s) ||
      itemBarcodes(i).some((b) => b.toLowerCase().includes(s)) ||
      (isNum && (+i.sellPrice === num || +i.mrp === num))
    ).slice(0, 8);
  }, [addQ, items, editing]);

  // Add an existing catalogue item to the bill — bump the existing (non-misc) line of the same name
  // if present, else append a fresh line. Prices are coerced to numbers because cloud/imported data
  // can store them as strings (which would corrupt the amount/subtotal math).
  const addExistingLine = (item) => {
    setEditing((e) => {
      if (!e) return e;
      const key = normName(item.name);
      const at = e.lines.findIndex((l) => !l.misc && normName(l.name) === key);
      const price = +item.sellPrice || 0, buy = +item.buyPrice || 0;
      const lines = at >= 0
        ? e.lines.map((l, j) => (j === at ? { ...l, qty: (+l.qty || 0) + 1 } : l))
        : [...e.lines, { name: item.name, qty: 1, unit: item.unit || "pc", price, buyPrice: buy, amount: money(price) }];
      return { ...e, lines };
    });
    setAddQ("");
  };

  // Quick-catalogue a brand-new item and put it on the bill (mirrors Billing's Misc row): registers a
  // real inventory item (opening stock 20, cost 80% of sell, auto category) so the catalogue grows,
  // then adds a bill line whose qty is deducted from that stock on save. If the name/barcode already
  // belongs to a catalogued item, that item is added instead — no duplicate is created.
  const addNewItem = () => {
    if (!editing) return;
    const price = +newPrice;
    if (!(price > 0)) return notify("Enter a price for the item.");
    const name = newName.trim();
    if (!name) return notify("Enter a name for the item.");
    const codes = parseBarcodeText(newCode); // optional; cleaned + de-duped, first token = primary
    const existing = (codes.length ? findItemByBarcode(items, codes[0]) : null)
      || items.find((i) => normName(i.name) === normName(name));
    if (existing) { addExistingLine(existing); resetAddItem(); return; }
    const bcClash = findBarcodeClash(codes, items);
    if (bcClash) return notify(`Barcode “${bcClash.code}” already belongs to “${bcClash.item.name}”.`);
    const category = guessCategory(name, items) || "Other";
    const sell = money(price);
    const batches = [{ id: uid(), qty: OPENING_STOCK, expiry: "", addedOn: todayStr() }];
    const newItem = {
      name, code: codes[0] || "", barcodes: codes.slice(1), category, unit: "pc",
      icon: iconFor(category), buyPrice: money(sell * BUY_PRICE_RATIO), sellPrice: sell, mrp: sell,
      lowAt: 5, id: uid(), stock: OPENING_STOCK, batches, createdAt: todayStr(),
    };
    setItems((list) => [...list, newItem]);
    setEditing((e) => (e ? { ...e, lines: [...e.lines, { name, qty: 1, unit: "pc", price: sell, buyPrice: newItem.buyPrice, amount: sell }] } : e));
    log("inventory", `Added item “${name}” · ${OPENING_STOCK} pc @ ${INR(sell)} (cost ${INR(newItem.buyPrice)}) · ${category} (from bill edit${codes[0] ? `, barcode ${codes[0]}` : ""})`);
    notify(`Added “${name}” to inventory (${category}, stock ${OPENING_STOCK}) & this bill`);
    resetAddItem();
  };

  const editSubtotal = editing ? money(editing.lines.reduce((a, l) => a + l.price * l.qty, 0)) : 0;
  const editDiscount = editing ? Math.min(editSubtotal, Math.max(0, money(+editing.discount || 0))) : 0;
  const editTotal = money(editSubtotal - editDiscount);

  const saveEdit = () => {
    const newLines = editing.lines.filter((l) => l.qty > 0).map((l) => ({ ...l, amount: money(l.price * l.qty) }));
    if (newLines.length === 0) return notify("A bill needs at least one line — use Delete instead");
    const gross = money(newLines.reduce((a, l) => a + l.amount, 0));
    // Re-clamp any existing discount to the new subtotal, then net it off total and profit.
    const discountAmt = Math.min(gross, Math.max(0, money(+editing.discount || 0)));
    const total = money(gross - discountAmt);
    // Prefer the cost snapshotted on the line at sale time; fall back to the current item
    // cost only for legacy bills saved before lines carried buyPrice.
    const buyOf = (l) => (l.buyPrice != null ? +l.buyPrice : (items.find((i) => i.name.toLowerCase() === l.name.toLowerCase())?.buyPrice || 0));
    const profit = money(newLines.reduce((a, l) => a + (l.price - buyOf(l)) * l.qty, 0) - discountAmt);
    const oldQ = {}, newQ = {};
    // Misc / custom lines aren't inventory-backed, and service lines have no stock at all, so
    // neither drives stock reconciliation. Both sides must filter identically — filtering one
    // and not the other would book a phantom delta for every service on the bill.
    const stockBacked = (l) => !l.misc && !isServiceLine(l);
    editing.orig.forEach((l) => { if (!stockBacked(l)) return; const k = l.name.toLowerCase(); oldQ[k] = (oldQ[k] || 0) + l.qty; });
    newLines.forEach((l) => { if (!stockBacked(l)) return; const k = l.name.toLowerCase(); newQ[k] = (newQ[k] || 0) + l.qty; });
    const deltas = {};
    [...new Set([...Object.keys(oldQ), ...Object.keys(newQ)])].forEach((k) => { const d = (newQ[k] || 0) - (oldQ[k] || 0); if (d) deltas[k] = d; });
    applyDeltas(deltas);
    const paid = editing.payment === "Udhari" ? Math.min(total, Math.max(0, money(+editing.paid || 0))) : undefined;
    setSales((all) => all.map((x) => {
      if (x.id !== editing.id) return x;
      const next = { ...x, date: editing.date || x.date, payment: editing.payment, lines: newLines, total, profit };
      // A % discount, once edited, is stored as its plain ₹ value — drop the stale percent tag.
      if (discountAmt > 0) { next.subtotal = gross; next.discount = discountAmt; delete next.discountPct; }
      else { delete next.subtotal; delete next.discount; delete next.discountPct; }
      if (editing.payment === "Udhari") {
        next.paid = paid;
        if (paid > 0) next.paidMode = editing.paidMode; else delete next.paidMode;
      } else { delete next.paid; delete next.paidMode; }
      return next;
    }));
    log("sale", `Edited bill → ${INR(total)} · ${newLines.length} line(s) · ${editing.payment}`);
    setEditing(null);
    resetAddItem();
    notify("Bill updated");
  };

  // ----- Split a bill across multiple dates -----
  // Replaces one bill with several smaller bills whose amounts (and, in the same
  // proportion, profit + line amounts) add up to exactly the original. It is purely a
  // re-dating of money already recorded, so stock is NOT touched. Because the dashboard
  // and finance views aggregate from the sales list by date/total/profit/lines, the split
  // parts flow through everywhere and the cumulative stays equal to the original bill.
  const [splitting, setSplitting] = useState(null);
  // { id, time, payment, customer, total, profit, lines, parts:[{date, amount}] }

  const addDays = (ds, n) => { const d = new Date(ds + "T00:00"); d.setDate(d.getDate() + n); return dateStr(d); };
  // Spread an amount equally across n parts as 2-dp money; the last part absorbs the remainder.
  const equalShares = (amount, n) => {
    const each = money(amount / n);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? money(amount - each * (n - 1)) : each));
  };

  const openSplit = (s) => setSplitting({
    id: s.id, time: s.time, payment: s.payment || "UPI", customer: s.customer || "", mobile: s.mobile || "", paid: s.paid || 0, paidMode: s.paidMode || "Cash",
    total: s.total, profit: s.profit, lines: s.lines,
    parts: equalShares(s.total, 2).map((amount, i) => ({ date: addDays(s.date, -i), amount })),
    rangeFrom: addDays(s.date, -1), rangeTo: s.date,
  });
  // Every calendar day in [from, to] inclusive.
  const datesInRange = (from, to) => {
    if (!from || !to || from > to) return [];
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  const setRangeFrom = (v) => setSplitting((sp) => ({ ...sp, rangeFrom: v }));
  const setRangeTo = (v) => setSplitting((sp) => ({ ...sp, rangeTo: v }));
  // Fill one part per day across the range, divided equally (still editable afterwards).
  const applyRange = () => {
    if (!splitting) return;
    const dates = datesInRange(splitting.rangeFrom, splitting.rangeTo);
    if (!dates.length) return notify("Pick a valid range — From must be on or before To.");
    if (dates.length > 90) return notify("Range too large — keep it within 90 days.");
    const shares = equalShares(splitting.total, dates.length);
    setSplitting((sp) => ({ ...sp, parts: dates.map((date, i) => ({ date, amount: shares[i] })) }));
  };
  const divideEqually = () => setSplitting((sp) => {
    const shares = equalShares(sp.total, sp.parts.length);
    return { ...sp, parts: sp.parts.map((p, i) => ({ ...p, amount: shares[i] })) };
  });
  const addPart = () => setSplitting((sp) => {
    const lastDate = sp.parts[sp.parts.length - 1]?.date || todayStr();
    const parts = [...sp.parts, { date: addDays(lastDate, -1), amount: 0 }];
    const shares = equalShares(sp.total, parts.length);
    return { ...sp, parts: parts.map((p, i) => ({ ...p, amount: shares[i] })) };
  });
  const removePart = (idx) => setSplitting((sp) => {
    if (sp.parts.length <= 2) return sp;
    const parts = sp.parts.filter((_, i) => i !== idx);
    const shares = equalShares(sp.total, parts.length);
    return { ...sp, parts: parts.map((p, i) => ({ ...p, amount: shares[i] })) };
  });
  const setPartDate = (idx, date) => setSplitting((sp) => ({ ...sp, parts: sp.parts.map((p, i) => (i === idx ? { ...p, date } : p)) }));
  const setPartAmount = (idx, amount) => setSplitting((sp) => ({ ...sp, parts: sp.parts.map((p, i) => (i === idx ? { ...p, amount } : p)) }));
  // Put whatever is left over (total − all earlier parts) onto the last part, so the
  // amounts add up to the original in one click after editing the others.
  const balanceSplit = () => setSplitting((sp) => {
    const exceptLast = money(sp.parts.slice(0, -1).reduce((a, p) => a + (+p.amount || 0), 0));
    return { ...sp, parts: sp.parts.map((p, i) => (i === sp.parts.length - 1 ? { ...p, amount: money(sp.total - exceptLast) } : p)) };
  });

  const splitSum = splitting ? money(splitting.parts.reduce((a, p) => a + (+p.amount || 0), 0)) : 0;
  const splitDiff = splitting ? money(splitting.total - splitSum) : 0;
  // Valid when every part has a date and a positive amount, and the amounts add up to the
  // original to the paisa. A sub-paisa float residual is tolerated and snapped exactly on save.
  const splitValid = !!splitting
    && splitting.parts.length >= 2
    && splitting.parts.every((p) => p.date && (+p.amount || 0) > 0)
    && Math.abs(splitDiff) < 0.005;

  const saveSplit = () => {
    if (!splitValid) return;
    const { id, time, payment, customer, mobile, paid, paidMode, total, profit, lines } = splitting;
    // Snap the last part to absorb any sub-paisa residual so the parts sum to EXACTLY total.
    const exceptLast = money(splitting.parts.slice(0, -1).reduce((a, p) => a + (+p.amount || 0), 0));
    const parts = splitting.parts.map((p, i, arr) =>
      ({ ...p, amount: i === arr.length - 1 ? money(total - exceptLast) : money(+p.amount || 0) }));
    let profAcc = 0, paidAcc = 0;
    const newSales = parts.map((p, idx) => {
      const f = (+p.amount) / total;
      const isLast = idx === parts.length - 1;
      const prof = isLast ? money(profit - profAcc) : money(profit * f);
      profAcc = money(profAcc + prof);
      // Distribute any Udhari part-payment proportionally too (remainder on the last part).
      const partPaid = isLast ? money((+paid || 0) - paidAcc) : money((+paid || 0) * f);
      paidAcc = money(paidAcc + partPaid);
      // Scale each line by the same proportion; nudge the last line so the lines sum to
      // this part's amount exactly (keeps the bill detail and top-items totals consistent).
      let amtAcc = 0;
      const sl = lines.map((l) => {
        const amount = money((+l.amount || 0) * f);
        amtAcc = money(amtAcc + amount);
        return { ...l, qty: Math.round((+l.qty || 0) * f * 1000) / 1000, amount };
      });
      if (sl.length) { const d = money((+p.amount) - amtAcc); if (d) sl[sl.length - 1] = { ...sl[sl.length - 1], amount: money(sl[sl.length - 1].amount + d) }; }
      return {
        id: uid(), date: p.date,
        time: `${time || ""} (split ${idx + 1}/${parts.length})`.trim(),
        lines: sl, total: money(+p.amount), profit: prof,
        payment, ...(customer ? { customer } : {}), ...(mobile ? { mobile } : {}),
        ...(payment === "Udhari" ? { paid: partPaid } : {}),
        ...(payment === "Udhari" && partPaid > 0 ? { paidMode } : {}),
        splitOf: id,
      };
    });
    setSales((all) => all.flatMap((x) => (x.id === id ? newSales : [x])));
    log("sale", `Split bill ${INR(total)} into ${parts.length} part(s) across ${new Set(parts.map((p) => p.date)).size} date(s)`);
    setSplitting(null);
    notify(`Bill split into ${parts.length} parts`);
  };

  return (
    <div>
      <Header title="Sales History" sub={`${visible.length} of ${sales.length} bills · ${INR(rangeTotal)}`} />

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="🔍 Search bills — item, customer, mobile, amount, payment…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && <button className="btn ghost small" onClick={() => setQ("")}>Clear search</button>}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>From <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} value={from} max={to || todayStr()} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>To <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} value={to} max={todayStr()} onChange={(e) => setTo(e.target.value)} /></label>
        {(from || to) && <button className="btn ghost small" onClick={() => { setFrom(""); setTo(""); }}>Clear range</button>}
      </div>

      {sales.length === 0 && <section style={S.panel}><Empty text="No sales yet. Bills will appear here after you complete a sale." /></section>}
      {sales.length > 0 && visible.length === 0 && <section style={S.panel}><Empty text={searching ? `No bills match “${q.trim()}”${from || to ? " in this date range" : ""}.` : "No bills in this date range."} /></section>}
      {byDate.map(([date, list]) => {
        const isToday = date === todayStr();
        // Today is always open; every other date collapses (closed by default) so the list scans
        // quickly. While searching, open every matching date so the results are all visible.
        const expanded = isToday || searching || openDates.has(date);
        return (
        <section key={date} style={{ ...S.panel, marginBottom: 14 }}>
          <div
            style={{ ...S.panelHead, ...(isToday ? {} : { cursor: "pointer" }) }}
            onClick={isToday ? undefined : () => toggleDate(date)}
            {...(isToday ? {} : { role: "button", "aria-expanded": expanded })}
          >
            {!isToday && <span style={{ color: "var(--text-mid, #8A9C90)", marginRight: 6 }}>{expanded ? "▾" : "▸"}</span>}
            {new Date(date + "T00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            {isToday && <span style={{ fontWeight: 600, color: "var(--brand)", marginLeft: 8 }}>· Today</span>}
            <span style={{ fontWeight: 500, color: "var(--text-mid, #8A9C90)", marginLeft: 8 }}>· {list.length} bill{list.length > 1 ? "s" : ""}</span>
            <span style={{ marginLeft: "auto", fontWeight: 800 }}>
              {INR(list.reduce((a, s) => a + s.total, 0))}
              <span style={{ color: "var(--brand)", fontWeight: 700, fontSize: 12.5, marginLeft: 6 }}>(+{INR(money(list.reduce((a, s) => a + (s.profit || 0), 0)))})</span>
            </span>
          </div>
          {expanded && list.map((s) => (
            <div key={s.id}>
              <div style={{ ...S.row, cursor: "pointer" }} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span>
                  {s.time} · {s.lines.length} item{s.lines.length > 1 ? "s" : ""}
                  {searching && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-mid, #8A9C90)" }}>{new Date(s.date + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
                  {s.payment && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 800, color: PAY_COLORS[s.payment] || "#789", border: `1px solid ${PAY_COLORS[s.payment] || "#bbb"}`, borderRadius: 6, padding: "0 6px" }}>{s.payment}{s.customer ? " · " + s.customer : ""}{s.mobile ? " · " + s.mobile : ""}</span>}
                </span>
                <span><b>{INR(s.total)}</b> <span style={{ color: "var(--brand)", fontSize: 12 }}>(+{INR(s.profit)})</span>
                  {s.payment === "Udhari" && (s.total - (s.paid || 0)) > 0 && <span style={{ color: "#C44536", fontSize: 11.5, fontWeight: 700, marginLeft: 6 }}>{INR(money(s.total - (s.paid || 0)))} due</span>}
                  {" "}{open === s.id ? "▾" : "▸"}</span>
              </div>
              {(open === s.id || searching) && (
                <div style={{ background: "var(--surface-2, #F4F7F4)", borderRadius: 8, padding: "8px 12px", margin: "0 0 8px" }}>
                  {s.lines.map((l, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                      <span>
                        {l.name} × {l.qty}
                        {/* Who did the work — the first question asked of any past service bill. */}
                        {isServiceLine(l) && l.staffId ? <span style={{ color: "var(--text-mid, #8A9C90)" }}> · {staffName(staff, l.staffId)}</span> : null}
                      </span>
                      <span>{INR(l.amount)}</span>
                    </div>
                  ))}
                  {s.discount > 0 && (
                    <div style={{ borderTop: "1px dashed #D8E0D8", marginTop: 4, paddingTop: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0", color: "var(--text-mid, #6B7E74)" }}>
                        <span>Subtotal</span><span>{INR(s.subtotal != null ? s.subtotal : money(s.total + s.discount))}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0", color: "#C44536", fontWeight: 600 }}>
                        <span>Discount{s.discountPct ? ` (${s.discountPct}%)` : ""}</span><span>−{INR(s.discount)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0", fontWeight: 800 }}>
                        <span>Total</span><span>{INR(s.total)}</span>
                      </div>
                    </div>
                  )}
                  {/* A biller reaches this view to REPRINT a receipt — that's why sales.view is
                      theirs. Changing or erasing a bill that's already been rung up is an owner
                      decision, and the database rules enforce the delete half of that too. */}
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button className="btn small" onClick={() => printReceipt(s, store, staff, receiptExtras(s, { customerPackages, services, sales }))}>🖨 Print</button>
                    <SendBillActions
                      sale={s} store={store} staff={staff}
                      extras={receiptExtras(s, { customerPackages, services, sales })}
                      notify={notify} guardOnline={guardOnline}
                    />
                    {can(role, "sales.edit", perms) && <button className="btn small ghost" onClick={() => openEdit(s)}>✎ Edit bill</button>}
                    {can(role, "sales.edit", perms) && <button className="btn small ghost" onClick={() => openSplit(s)}>✂ Split</button>}
                    {can(role, "sales.delete", perms) && <button className="btn small danger" onClick={() => deleteSale(s)}>🗑 Delete</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
        );
      })}

      {editing && (
        <Modal title="Edit bill" onClose={closeEdit}>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Date"><input type="date" className="input" max={todayStr()} value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></Field>
            <Field label="Payment">
              <select className="input" value={editing.payment} onChange={(e) => setEditing({ ...editing, payment: e.target.value })}>
                {["UPI", "Cash", "Udhari"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <table className="tbl">
            <thead><tr><th>Item</th><th style={{ width: 70 }}>Qty</th><th style={{ textAlign: "right" }}>Amount</th><th style={{ width: 30 }}></th></tr></thead>
            <tbody>
              {editing.lines.map((l, idx) => (
                <tr key={idx}>
                  <td>{l.name}<div style={{ fontSize: 11, color: "#9AA" }}>{INR(l.price)}/{l.unit}</div></td>
                  <td><input className="input" style={{ padding: "6px 8px" }} type="number" inputMode="decimal" min="0" value={l.qty} onChange={(e) => editLine(idx, +e.target.value)} /></td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{INR(money(l.price * l.qty))}</td>
                  <td><button className="btn small danger" aria-label="Remove line" onClick={() => removeLine(idx)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Add items on the go — tap a catalogue match, or quick-catalogue a brand-new item. */}
          <div style={{ marginTop: 4, marginBottom: 6, padding: "8px 10px", background: "var(--surface-2, #F4F7F4)", borderRadius: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#465", marginBottom: 6 }}>Add item to this bill</div>
            <input
              className="input"
              placeholder="Search catalogue — name / barcode / price…"
              value={addQ}
              onChange={(e) => setAddQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && addMatches.length > 0) { addExistingLine(addMatches[0]); } }}
              aria-label="Search catalogue to add an item"
            />
            {addMatches.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 176, overflowY: "auto", border: "1px solid var(--border, #E3EAE3)", borderRadius: 8, background: "var(--surface, #fff)" }}>
                {addMatches.map((i) => {
                  const inStock = (+i.stock || 0) > 0;
                  return (
                    <div key={i.id} role="button" onClick={() => addExistingLine(i)}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid #F0F3F0" }}>
                      <span style={{ fontSize: 13 }}><span style={{ marginRight: 5 }}>{i.icon || "📦"}</span>{i.name}</span>
                      <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        <span style={{ color: "var(--brand)", fontWeight: 700 }}>{INR(i.sellPrice)}</span>
                        <span style={{ marginLeft: 8, color: inStock ? "#789" : "#C44536", fontWeight: inStock ? 400 : 600 }}>{inStock ? `${+i.stock || 0} left` : "Out of stock"}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {addQ.trim() && addMatches.length === 0 && (
              <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: 6 }}>No catalogue match — add it as a new item below.</div>
            )}
            {/* Quick-catalogue a new item (mirrors Billing's Misc row): creates a real inventory item. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#465", whiteSpace: "nowrap" }}>🧾 New</span>
              <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNewItem(); }} aria-label="New item name" />
              <input className="input" style={{ flex: 1, minWidth: 100 }} placeholder="Barcode (optional)" value={newCode} onChange={(e) => setNewCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNewItem(); }} aria-label="New item barcode (optional)" title="Barcode (optional) — scan or type so this item scans at billing next time" />
              <input className="input" style={{ width: 86 }} type="number" inputMode="decimal" min="0" step="0.01" placeholder="₹ sell" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNewItem(); }} aria-label="New item sell price" />
              <button className="btn" onClick={addNewItem}>+ Add</button>
            </div>
            {/* Says out loud what the barcode field's title= used to say. A title is invisible on
                a touchscreen, so on the devices this row is most used on, that guidance did not
                exist at all. */}
            <div style={{ fontSize: 11, color: "var(--text-mid, #8A9C90)", marginTop: 6 }}>New items are catalogued (opening stock {OPENING_STOCK}); the quantity on this bill is deducted from stock when you save. Adding a barcode lets it scan straight into a bill next time.</div>
          </div>

          <Field label="Additional discount (₹)">
            <input className="input" type="number" inputMode="decimal" min="0" step="0.01" max={editSubtotal} placeholder="0" value={editing.discount} onChange={(e) => setEditing({ ...editing, discount: e.target.value })} />
          </Field>
          {editDiscount > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--text-mid, #6B7E74)" }}><span>Subtotal</span><span>{INR(editSubtotal)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#C44536", fontWeight: 600 }}><span>Discount</span><span>−{INR(editDiscount)}</span></div>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, marginTop: 10 }}><span>New total</span><span>{INR(editTotal)}</span></div>
          {editing.payment === "Udhari" && (
            <div style={{ marginTop: 8 }}>
              <Field label="Amount paid (mark repayments here)">
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input className="input" style={{ flex: 1 }} type="number" inputMode="decimal" min="0" step="0.01" max={editTotal} value={editing.paid} onChange={(e) => setEditing({ ...editing, paid: e.target.value })} />
                  <button className="btn small ghost" onClick={() => setEditing({ ...editing, paid: String(editTotal) })}>Mark fully paid</button>
                </div>
              </Field>
              {+editing.paid > 0 && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: -4, marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, color: "var(--text-mid, #6B7E74)", fontWeight: 600 }}>Paid via</span>
                  {["UPI", "Cash"].map((m) => (
                    <button key={m} className={"btn small " + (editing.paidMode === m ? "primary" : "ghost")} onClick={() => setEditing({ ...editing, paidMode: m })}>{m}</button>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, textAlign: "right", color: "#C44536", fontWeight: 600 }}>Outstanding: {INR(Math.max(0, money(editTotal - (+editing.paid || 0))))}</div>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #6B7E74)", marginTop: 4 }}>Stock adjusts automatically for any quantity change.</div>
          <button className="btn primary big" style={{ width: "100%", marginTop: 12 }} onClick={saveEdit}>Save changes</button>
        </Modal>
      )}

      {splitting && (
        <Modal title="Split bill across dates" onClose={() => setSplitting(null)}>
          <div style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)", marginBottom: 10, lineHeight: 1.5 }}>
            Original total <b>{INR(splitting.total)}</b>. Give each part a date and an amount — by default it's divided equally, but you can enter your own amounts. The parts must add up to exactly the original total. Profit and items are split in the same proportion, so the dashboard and finance graphs stay accurate. (Stock isn't affected.)
          </div>
          <div style={{ background: "var(--surface-2, #F4F7F4)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#465", marginBottom: 6 }}>Split over a date range</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>From <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} max={splitting.rangeTo || todayStr()} value={splitting.rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} /></label>
              <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>To <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} max={todayStr()} value={splitting.rangeTo} onChange={(e) => setRangeTo(e.target.value)} /></label>
              <button className="btn small" onClick={applyRange}>Fill range</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-mid, #8A9C90)", marginTop: 6 }}>Creates one part per day in the range, divided equally — then edit any amount below.</div>
          </div>
          <table className="tbl">
            <thead><tr><th>Date</th><th style={{ textAlign: "right" }}>Amount ₹</th><th style={{ width: 30 }}></th></tr></thead>
            <tbody>
              {splitting.parts.map((p, idx) => (
                <tr key={idx}>
                  <td><input type="date" className="input" style={{ padding: "6px 8px" }} max={todayStr()} value={p.date} onChange={(e) => setPartDate(idx, e.target.value)} /></td>
                  <td><input type="number" inputMode="decimal" min="0" step="0.01" className="input" style={{ padding: "6px 8px", textAlign: "right" }} value={p.amount} onChange={(e) => setPartAmount(idx, +e.target.value)} /></td>
                  <td><button className="btn small danger" disabled={splitting.parts.length <= 2} aria-label="Remove part" onClick={() => removePart(idx)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn small ghost" onClick={addPart}>+ Add date</button>
            <button className="btn small ghost" onClick={divideEqually}>Divide equally</button>
            <button className="btn small ghost" onClick={balanceSplit} disabled={Math.abs(splitDiff) < 0.005}>Balance last row</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, marginTop: 12 }}>
            <span>Split total</span>
            <span style={{ color: Math.abs(splitDiff) < 0.005 ? "var(--brand)" : "#C44536" }}>{INR(splitSum)} / {INR(splitting.total)}</span>
          </div>
          {Math.abs(splitDiff) >= 0.005 && (
            <div style={{ fontSize: 12, color: "#C44536", marginTop: 4 }}>
              Amounts must add up to {INR(splitting.total)} — {splitDiff > 0 ? `${INR(splitDiff)} short` : `${INR(-splitDiff)} over`}. Use “Balance last row” to put the rest on the last date.
            </div>
          )}
          <button className="btn primary big" style={{ width: "100%", marginTop: 12 }} disabled={!splitValid} onClick={saveSplit}>
            Save split · {splitting.parts.length} part(s)
          </button>
        </Modal>
      )}
    </div>
  );
}


export { SalesHistory };
export default SalesHistory;
