// Billing — extracted from salon-manager.jsx.

import { Empty, Header, Modal } from "../components/primitives.jsx";
import { nowTime } from "../lib/ui/clock.js";
import { SendBillActions, UpiQrPreview, printReceipt, receiptExtras } from "../components/receipt.jsx";
import { findBarcodeClash, findItemByBarcode, itemBarcodes, looksLikeBarcode, parseBarcodeText } from "../lib/barcodes.js";
import { MQ } from "../lib/breakpoints.js";
import { featureOn } from "../lib/features.js";
import { loyaltyRules, maxRedeemablePoints, packageCovering, pointsBalance, pointsForSpend, redeemValueOf } from "../lib/loyalty.js";
import { activeServices, activeStaff, isServiceLine, serviceToCartLine } from "../lib/salon.js";
import { captureCustomer, formatPhone, isValidPhone, normalizePhone, suggestCustomers } from "../lib/customers.js";
import { CATEGORY_FALLBACK, resolveIcon } from "../lib/serviceIcons.js";
import { S } from "../lib/ui/css.js";
import { INR, money, todayStr, uid } from "../lib/ui/format.js";
import { useMediaQuery } from "../lib/ui/hooks.js";
import { addBatch, guessCategory, iconFor, normName, removeStock } from "../lib/ui/inventory.js";
import { STORE } from "../lib/ui/store.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { can } from "../lib/roles.js";
import { ServiceIconChip } from "../components/ServiceIcon.jsx";
import { CustomerPicker } from "../components/CustomerPicker.jsx";

// ---------- Billing / POS ----------
// Note: Billing reads customerPackages but never writes them. Drawing a session down IS
// recording packageRedemptions on the bill; the shell derives usesLeft from that.

// How a bill can be settled at the counter. "Udhari" is the credit option and rides
// FEATURES.udhari (lib/features.js) — parked, it is simply not offered, which is what
// stops NEW credit bills being written while the section is off. The `pay === "Udhari"`
// branches further down (the part-payment box, the "owes" placeholder, the sale's `paid`
// fields) then become unreachable and are left exactly as they are: flipping the flag
// back has to restore a working till, not a half-wired one.
const PAY_MODES = ["UPI", "Cash", ...(featureOn("udhari") ? ["Udhari"] : [])];
function Billing({ items, sales, services, staff, customers, customerPackages, config, setItems, setSales, setCustomers, store = STORE, notify, log, role, perms, user, guardOnline = () => true, prefill, onPrefillUsed, onBilled }) {
  const [q, setQ] = useState("");
  // Phone-only running-total bar. The receipt pane is a screen further down once the two panes
  // stack, and `receiptVisible` is what stops the bar duplicating a total that is already on
  // screen. IntersectionObserver is guarded: jsdom has none, and without it the bar simply stays
  // put — visible-but-redundant is a far better failure than a crashed till.
  const isPhone = useMediaQuery(MQ.phone);
  const receiptRef = useRef(null);
  const [receiptVisible, setReceiptVisible] = useState(false);
  useEffect(() => {
    const node = receiptRef.current;
    if (!node || typeof IntersectionObserver !== "function") return undefined;
    const io = new IntersectionObserver(([e]) => setReceiptVisible(e.isIntersecting), { threshold: 0.12 });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  const [cart, setCart] = useState([]); // {id, lineType, name, icon, unit, sellPrice, buyPrice, qty, staffId?}
  const [lastSale, setLastSale] = useState(null);
  const [saleDate, setSaleDate] = useState(todayStr()); // back-date a bill if needed
  const [pay, setPay] = useState("UPI"); // one of PAY_MODES above
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  // The picked customer's phone — the durable link from a bill to a customer record. "" is a
  // legitimate walk-in: someone who won't leave a number must never be a blocker at the till.
  const [customerPhone, setCustomerPhone] = useState("");
  // Which half of the catalogue the search pane is showing. A salon bill is mostly services,
  // so that's the default.
  const [mode, setMode] = useState("service"); // "service" | "product"
  // Who gets attributed (and paid commission for) the next service added. Sticky across adds:
  // one stylist usually does the whole sitting, and re-picking per line would be tedious.
  const [lineStaff, setLineStaff] = useState("");
  // The appointment this bill closes, when we arrived here via "Complete → Bill".
  const [fromAppointment, setFromAppointment] = useState("");
  // Points the customer is spending on this bill. Kept as a string so the field can be
  // cleared; coerced and re-clamped against the live ceiling on every use.
  const [redeemPts, setRedeemPts] = useState("");
  const [paidNow, setPaidNow] = useState(""); // Udhari part-payment taken at billing time
  const [paidMode, setPaidMode] = useState("Cash"); // how that part-payment was received (UPI/Cash)
  const [discount, setDiscount] = useState(""); // optional extra discount on the whole bill
  const [discMode, setDiscMode] = useState("₹"); // "₹" = flat amount, "%" = percent of subtotal
  const [miscName, setMiscName] = useState("");
  const [miscPrice, setMiscPrice] = useState("");
  const [miscCode, setMiscCode] = useState(""); // optional barcode → item is catalogued so it scans next time
  const miscNameRef = useRef(null);             // focused when the "not found" modal hands a scan over
  const [stockFor, setStockFor] = useState(null); // item id whose quick "add stock" box is open
  const [stockQty, setStockQty] = useState("");
  const [custFocus, setCustFocus] = useState(false); // customer-name field focused → show suggestions
  const [notFound, setNotFound] = useState(null); // a scanned barcode that matched no product → modal
  const searchRef = useRef(null);
  const notFoundAt = useRef(0); // when the not-found modal opened — used to swallow a scanner's trailing Enter
  useEffect(() => searchRef.current?.focus(), []);
  const showNotFound = (code) => { notFoundAt.current = Date.now(); setNotFound(code); };

  // Suggestions for the currently-typed name. The customer DATABASE answers first and past-bill
  // names fill in behind it (see suggestCustomers), so a regular is offered as the profile they
  // already are rather than as a string that happens to match — and the desk can put the bill on
  // them without leaving the box it is already typing in.
  const custSuggestions = useMemo(
    () => suggestCustomers(customers, sales, customer, 6),
    [customers, sales, customer]
  );

  // Choosing one. A profile LINKS the bill: the picker at the top of the cart takes over and
  // these two boxes go away, exactly as if the customer had been picked up there. That is the
  // point of surfacing the database here — points, packages and visit history all key off
  // customerPhone, and a matching string does none of it. A loose past-bill name only fills the
  // boxes; there is no record behind it to link to.
  const pickSuggestion = (s) => {
    setCustFocus(false);
    if (s.customer) {
      setCustomerPhone(s.customer.phone);
      setCustomer("");
      setMobile("");
      return;
    }
    setCustomer(s.name);
    if (s.phone) setMobile(s.phone);
  };

  // Seed the bill from an appointment ("Complete → Bill"), exactly once.
  //
  // The handover is consumed immediately (onPrefillUsed) so the cart belongs to the biller from
  // this point on: they can add a retail product or drop a service without the diary reaching
  // back in and overwriting their work. Re-running this on every render would fight the user.
  useEffect(() => {
    if (!prefill) return;
    setCart(prefill.lines);
    setCustomerPhone(prefill.customerPhone || "");
    setFromAppointment(prefill.appointmentId || "");
    setMode("service");
    // Sticky staff picks up whoever the appointment was with, so an added service attributes
    // to the same person by default.
    setLineStaff(prefill.lines.find(isServiceLine)?.staffId || "");
    onPrefillUsed?.();
  }, [prefill, onPrefillUsed]);

  // The customer this bill is for, if one has been picked. null = walk-in.
  const picked = useMemo(
    () => (customerPhone ? customers.find((c) => c.phone === customerPhone) || null : null),
    [customerPhone, customers]
  );

  // The number typed into the free-text fields, when it is enough to file a customer on.
  //
  // The picker is the deliberate way to put a bill on a customer; this is the way it actually
  // happens when the counter is busy — a name and a number straight into the two boxes below the
  // cart. Historically that went onto the bill as loose text and nowhere else, so the customer
  // list stayed empty while the sales history filled up with names. Requiring BOTH halves is what
  // captureCustomer requires and why: phone is the key, and the rules refuse a nameless record.
  const typedPhone = useMemo(
    () => (!picked && customer.trim() && isValidPhone(mobile) ? normalizePhone(mobile) : ""),
    [picked, customer, mobile]
  );
  // Who this bill will be attributed to, however they were identified. "" is a true walk-in.
  const billPhone = picked?.phone || typedPhone;

  // Is the typed number already on the list? Then nothing is being ADDED, and saying so would be
  // wrong twice over: phone is the key, so captureCustomer folds this bill into the record that
  // exists rather than creating a second one.
  const typedExisting = useMemo(
    () => (typedPhone ? customers.find((c) => normalizePhone(c.phone) === typedPhone) || null : null),
    [typedPhone, customers]
  );

  const bookableStaff = useMemo(() => activeStaff(staff), [staff]);

  // The service menu, filtered by the same search box the products use. Only active services:
  // the menu is what the salon sells today, not what it used to.
  const serviceResults = useMemo(() => {
    const query = q.trim().toLowerCase();
    const live = activeServices(services);
    const matches = query
      ? live.filter((s) => String(s.name || "").toLowerCase().includes(query) || String(s.category || "").toLowerCase().includes(query))
      : live;
    // Group by category so the pane reads like a menu rather than a flat list.
    const m = new Map();
    matches.slice(0, 60).forEach((s) => {
      const k = s.category || "Other";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    });
    return [...m.entries()];
  }, [q, services]);

  // Icon key per service, resolved once per menu change rather than once per render. Every tile
  // then hands a plain string to a memoised <ServiceIcon>, so typing in the search box or adding
  // a line to the cart re-renders the list without re-rendering 80 SVGs.
  const serviceIcons = useMemo(
    () => new Map((services || []).map((s) => [s.id, resolveIcon(s)])),
    [services]
  );

  // Units sold per item name — used for the best-seller ★ and as a tie-breaker.
  const soldQty = useMemo(() => {
    const m = {};
    (sales || []).forEach((s) => (s.lines || []).forEach((l) => { m[l.name] = (m[l.name] || 0) + l.qty; }));
    return m;
  }, [sales]);

  // Most recent sale date per item name — used to surface recently-sold items first.
  const lastSold = useMemo(() => {
    const m = {};
    (sales || []).forEach((s) => (s.lines || []).forEach((l) => {
      if (!m[l.name] || s.date > m[l.name]) m[l.name] = s.date;
    }));
    return m;
  }, [sales]);

  // Only in-stock items are sellable, but sold-out ones stay visible in the picker (greyed,
  // not tappable) so they're one tap from a quick restock — nothing has to be re-created.
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const inStock = items.filter((i) => (i.stock || 0) > 0);
    if (s) {
      // A purely numeric query also matches items priced at that amount (sell price or MRP).
      const isNum = /^\d+(\.\d+)?$/.test(s);
      const num = isNum ? +s : null;
      // While searching, also surface out-of-stock items (for reference) — but always last,
      // and on their own budget so a long list of in-stock matches can't crowd them out.
      const matches = items.filter((i) =>
        i.name.toLowerCase().includes(s) ||
        itemBarcodes(i).some((b) => b.toLowerCase().includes(s)) ||
        (isNum && (+i.sellPrice === num || +i.mrp === num)));
      const inStockMatches = matches.filter((i) => (i.stock || 0) > 0);
      const outMatches = matches.filter((i) => (i.stock || 0) <= 0);
      return [...inStockMatches.slice(0, 12), ...outMatches.slice(0, 8)];
    }
    // No search: most recently sold first, then by units sold, then the rest.
    const byActivity = (a, b) => {
      const la = lastSold[a.name] || "", lb = lastSold[b.name] || "";
      if (la !== lb) return la < lb ? 1 : -1; // newer sale date first
      return (soldQty[b.name] || 0) - (soldQty[a.name] || 0);
    };
    // In-stock (sellable) lines lead; sold-out ones follow on their own budget so they stay
    // visible for a quick restock without ever crowding out what can actually be sold.
    const out = items.filter((i) => (i.stock || 0) <= 0).sort(byActivity);
    return [...[...inStock].sort(byActivity).slice(0, 12), ...out.slice(0, 8)];
  }, [q, items, soldQty, lastSold]);

  // Put an item on the bill (or bump its qty if already there). Functional update so rapid
  // clicks / scanner input never read a stale cart.
  const pushToCart = (item) => setCart((cart) => {
    const ex = cart.find((c) => c.id === item.id);
    return ex
      ? cart.map((c) => (c.id === item.id ? { ...c, qty: c.qty + 1 } : c))
      : [...cart, { id: item.id, lineType: "product", name: item.name, icon: item.icon, unit: item.unit, sellPrice: item.sellPrice, buyPrice: item.buyPrice, qty: 1 }];
  });

  const add = (item) => {
    if (item.stock <= 0) return notify("Out of stock: " + item.name);
    const ex = cart.find((c) => c.id === item.id);
    if (ex && ex.qty + 1 > item.stock) return notify("Only " + item.stock + " " + item.unit + " in stock");
    pushToCart(item);
  };

  // Put a service on the bill, attributed to whoever is currently selected. Unlike a product
  // there is no stock to check — labour doesn't run out — and repeating a service (a second
  // threading, say) just bumps the quantity.
  //
  // If the customer has a package covering this service, the line goes on at ZERO price and
  // draws a session down. They already paid for it when they bought the package; charging
  // again would be charging twice for the same work.
  const addService = (service) => {
    const covering = picked ? packageCovering(customerPackages, picked.phone, service.id, saleDate) : null;
    setCart((cart) => {
      const ex = cart.find((c) => c.id === service.id);
      if (ex) return cart.map((c) => (c.id === service.id ? { ...c, qty: c.qty + 1 } : c));
      const line = serviceToCartLine(service, lineStaff);
      if (!covering) return [...cart, line];
      // Only one session per line: a package draw-down is qty 1 by definition. If they want a
      // second of the same service on one bill, the qty bump above leaves it at the package
      // price — which is a knowing simplification, noted in the README.
      return [...cart, { ...line, sellPrice: 0, fromPackageId: covering.id, packageName: covering.name }];
    });
    if (covering) {
      notify(`Covered by “${covering.name}” — ${covering.usesLeft - 1} session(s) will be left`);
    }
  };

  // Re-attribute one service line. Sittings do get split — a colour by one stylist, the
  // blow-dry by another — and commission has to follow the person who actually did the work.
  const setLineStaffFor = (id, staffId) =>
    setCart((cart) => cart.map((c) => (c.id === id ? { ...c, staffId } : c)));

  // Scanning a barcode always adds the item to the bill — even at zero stock. A sold-out item is
  // auto-restocked to SCAN_RESTOCK_QTY (5) so the till isn't blocked; the restock is guarded by a
  // functional updater so a rapid second scan of the same item can't stack another +5.
  const SCAN_RESTOCK_QTY = 5;
  const addScannedItem = (item) => {
    if ((item.stock || 0) <= 0) {
      setItems((list) => list.map((i) => (i.id === item.id && (i.stock || 0) <= 0 ? addBatch(i, SCAN_RESTOCK_QTY, "", todayStr()) : i)));
      log("inventory", `Auto-restocked “${item.name}” to ${SCAN_RESTOCK_QTY} (scanned at billing while out of stock)`);
      notify(`“${item.name}” was out of stock — restocked to ${SCAN_RESTOCK_QTY} and added.`);
      pushToCart(item);
      return;
    }
    add(item);
  };
  const setQty = (id, qty) => {
    const line = cart.find((c) => c.id === id);
    // Misc / custom lines have no inventory item, and a SERVICE has no stock at all — labour
    // doesn't run out. Stock-limiting either would clamp them to 0 and silently drop the line.
    if (line && !line.misc && !isServiceLine(line)) {
      const stock = items.find((i) => i.id === id)?.stock ?? 0;
      if (qty > stock) { notify("Only " + stock + " in stock"); qty = stock; }
    }
    const q = qty;
    setCart((cart) => (q <= 0 ? cart.filter((c) => c.id !== id) : cart.map((c) => (c.id === id ? { ...c, qty: q } : c))));
  };

  // A misc / custom item: only a sell price is required (name optional). It sells like any line but
  // has no catalogue item, so it never touches inventory stock. An optional buy price can be given
  // so the line still contributes an accurate profit; it defaults to 0 (no tracked cost) if blank.
  // Quick restock straight from the billing picker (so a 0-stock item becomes sellable here).
  const quickRestock = (item) => {
    const qty = +stockQty;
    if (!(qty > 0)) return notify("Enter a quantity to add.");
    setItems((list) => list.map((i) => (i.id === item.id ? addBatch(i, qty, "", todayStr()) : i)));
    log("inventory", `Restocked “${item.name}” +${qty} (from billing)`);
    notify(`Added ${qty} ${item.unit} to ${item.name}`);
    setStockFor(null); setStockQty("");
  };

  // Add an item to the bill from the Misc row — and catalogue it. A name + sell price is required;
  // the barcode is optional (given → the item scans directly next time). Rather than a throwaway
  // misc line, this registers a REAL inventory item with an opening stock of 20 and a category
  // auto-guessed from the name, so the shop's catalogue grows as it bills. The cart line is
  // inventory-backed (real id), so completing the sale depletes that stock (20 → 19 …) like any item.
  // Cost/buy price defaults to 80% of the sell price (≈20% margin), since this row has no buy field.
  // If the name/barcode already belongs to a catalogued item, that item is billed instead — no
  // duplicate is created and no extra stock is added.
  const OPENING_STOCK = 20;     // opening stock for a quick-catalogued item
  const BUY_PRICE_RATIO = 0.8;  // default cost = 80% of sell price (≈20% margin)
  const addMisc = () => {
    const price = +miscPrice;
    if (!(price > 0)) return notify("Enter a price for the item.");
    const name = miscName.trim();
    if (!name) return notify("Enter a name for the item.");
    const codes = parseBarcodeText(miscCode); // optional; cleaned + de-duped, first token = primary
    // Already in the catalogue (by barcode, else by name)? Bill that item instead of duplicating it.
    const existing = (codes.length ? findItemByBarcode(items, codes[0]) : null)
      || items.find((i) => normName(i.name) === normName(name));
    if (existing) {
      if ((existing.stock || 0) <= 0) return notify(`“${existing.name}” already exists but is out of stock — restock it from the picker.`);
      add(existing);
      setMiscName(""); setMiscPrice(""); setMiscCode("");
      return;
    }
    // New item: a typed barcode must not already belong to another product.
    const bcClash = findBarcodeClash(codes, items);
    if (bcClash) return notify(`Barcode “${bcClash.code}” already belongs to “${bcClash.item.name}”.`);
    const category = guessCategory(name, items) || "Other"; // auto-corrected from the name
    const sell = money(price);
    const batches = [{ id: uid(), qty: OPENING_STOCK, expiry: "", addedOn: todayStr() }];
    const newItem = {
      name, code: codes[0] || "", barcodes: codes.slice(1), category, unit: "pc",
      icon: iconFor(category), buyPrice: money(sell * BUY_PRICE_RATIO), sellPrice: sell, mrp: sell,
      lowAt: 5, id: uid(), stock: OPENING_STOCK, batches, createdAt: todayStr(),
    };
    setItems((list) => [...list, newItem]);
    pushToCart(newItem); // inventory-backed cart line (real id) → stock depletes on sale
    log("inventory", `Added item “${name}” · ${OPENING_STOCK} pc @ ${INR(sell)} (cost ${INR(newItem.buyPrice)}) · ${category} (from billing${codes[0] ? `, barcode ${codes[0]}` : ""})`);
    notify(`Added “${name}” to inventory (${category}, stock ${OPENING_STOCK}) & this bill`);
    setMiscName(""); setMiscPrice(""); setMiscCode("");
  };

  // Enter fires from a barcode scanner (types the value then sends Enter) or a manual search.
  // 1) Exact barcode match across ALL items → add/increment (the scan path).
  // 2) A barcode-shaped value with no exact match → "No item found" modal (don't guess).
  // 3) A typed search that matched something → add the top result (manual flow, unchanged).
  // 4) Anything else that matched nothing → "No item found" modal too.
  // The value is read from the input's DOM node (not the `q` state) so a fast keyboard-wedge
  // burst is captured in full even if React hasn't re-rendered for the final characters yet.
  // A hit clears the input and keeps it focused for the next scan; a miss opens the modal (which
  // takes focus) and returns focus to the input when dismissed.
  const onSearchKey = (e) => {
    if (e.key !== "Enter") return;
    if (notFound != null) { setQ(""); return; }                                 // modal already open → swallow trailing Enter(s)
    const raw = String(e.target.value ?? q).trim();
    if (!raw) return;
    const hit = findItemByBarcode(items, raw);
    if (hit) { addScannedItem(hit); setQ(""); searchRef.current?.focus(); return; } // known barcode → add (auto-restock if sold out)
    if (looksLikeBarcode(raw)) { setQ(""); showNotFound(raw); return; }         // unmatched scan → not-found modal
    if (results.length > 0) { add(results[0]); setQ(""); searchRef.current?.focus(); return; } // manual search → top match
    setQ(""); showNotFound(raw);                                                // typed query, nothing matched → modal
  };

  const subtotal = money(cart.reduce((a, c) => a + c.sellPrice * c.qty, 0));
  const grossProfit = money(cart.reduce((a, c) => a + (c.sellPrice - c.buyPrice) * c.qty, 0));
  // Optional whole-bill discount, entered as a flat ₹ amount or a % of the subtotal. Clamped to
  // [0, subtotal] so a bill can never go negative; it comes straight off profit (cost is unchanged).
  // `total`/`profit` stay the NET (post-discount) figures so revenue, udhari, stats and history all
  // book the amount actually charged without any downstream change.
  const discNum = Math.max(0, +discount || 0);
  const discountAmt = discMode === "%" ? money(subtotal * Math.min(100, discNum) / 100) : Math.min(subtotal, money(discNum));
  const afterDiscount = money(subtotal - discountAmt);

  // ---- loyalty redemption ----
  // Points come off AFTER the manual discount, against what's actually left owing. Applying
  // them to the pre-discount subtotal would let a discounted bill be over-paid with points.
  const rules = useMemo(() => loyaltyRules(config), [config]);
  // Read off billPhone so the balance shown is the customer's real one even when the desk typed
  // their number instead of picking them. REDEEMING still needs a deliberate pick (maxPts below
  // stays on `picked`, as do package draws): spending someone's points because a number was
  // typed into a text box is not a decision the till should make on the salon's behalf.
  const ptsBalance = useMemo(() => (billPhone ? pointsBalance(billPhone, sales) : 0), [billPhone, sales]);
  const maxPts = useMemo(
    () => (picked ? maxRedeemablePoints(ptsBalance, afterDiscount, rules) : 0),
    [picked, ptsBalance, afterDiscount, rules]
  );
  // Re-clamp on every render: the ceiling moves as lines are added or removed, and a number
  // typed when the bill was ₹3000 must not survive the bill dropping to ₹300.
  const redeemedPts = Math.max(0, Math.min(maxPts, Math.floor(+redeemPts || 0)));
  const redeemAmt = redeemValueOf(redeemedPts, rules);

  const total = money(afterDiscount - redeemAmt);
  // Points are a discount the salon funds, so like any discount they come straight off profit.
  const profit = money(grossProfit - discountAmt - redeemAmt);
  // What this bill will earn. Earned on what the customer actually PAYS: earning points on the
  // part settled with points would be paying interest on its own currency.
  //
  // Keyed on billPhone, not on `picked`: a customer captured from the typed name/mobile is on the
  // list by the time this bill is saved, and their first visit has to earn like anybody else's.
  // Gating this on `picked` would have made the ledger disagree with itself — the bill counts
  // towards their visits and spend (both derived from customerPhone) but silently earns nothing.
  const willEarn = useMemo(() => (billPhone ? pointsForSpend(total, rules) : 0), [billPhone, total, rules]);

  const completeSale = () => {
    if (cart.length === 0) return;
    // No sale without a connection: refuse up-front, before any receipt prints or the cart clears,
    // so an offline tap can't leave a printed bill that was never recorded. Raises the offline modal.
    if (!guardOnline()) return;
    // Every service line must say who performed it, or its commission has nowhere to go and
    // the stylist quietly loses the money. Cheaper to catch here than to reconcile at payout.
    const unassigned = cart.filter((c) => isServiceLine(c) && !c.staffId);
    if (unassigned.length) return notify(`Who did “${unassigned[0].name}”? Pick a staff member for every service.`);
    // Re-check against the latest stock: another device (or a just-synced change) may have
    // reduced it since these lines were added to the cart. Block rather than oversell.
    // Services are exempt — they consume no stock.
    const short = cart
      .filter((c) => !c.misc && !isServiceLine(c))
      .map((c) => ({ c, stock: items.find((i) => i.id === c.id)?.stock ?? 0 }))
      .filter(({ c, stock }) => c.qty > stock);
    if (short.length) {
      const { c, stock } = short[0];
      return notify(`Only ${stock} ${c.unit} of ${c.name} left — adjust the bill.`);
    }
    // Package sessions this bill draws down — one per covered line, recorded on the bill so a
    // delete can hand them back. Re-checked here rather than trusted from the cart: the cart may
    // have been sitting open while the same package was spent on another device.
    const packageDraws = [];
    for (const c of cart) {
      if (!c.fromPackageId) continue;
      const cp = customerPackages.find((x) => x.id === c.fromPackageId);
      const drawnSoFar = packageDraws.filter((d) => d.customerPackageId === c.fromPackageId).length;
      if (!cp || cp.usesLeft - drawnSoFar <= 0) {
        return notify(`“${c.packageName || "That package"}” has no sessions left — remove ${c.name} or re-add it at full price.`);
      }
      packageDraws.push({ customerPackageId: c.fromPackageId, serviceId: c.id, serviceName: c.name });
    }

    const backDated = saleDate !== todayStr();
    const sale = {
      id: uid(),
      date: saleDate,
      time: nowTime() + (backDated ? " (back-dated)" : ""),
      // Snapshot buyPrice onto each line so historical profit stays anchored to the cost at
      // sale time, even if the item's cost is changed (or the item deleted) later.
      //
      // Service lines additionally snapshot staffId and commissionPct: a payout report must
      // reflect the rate that was in force when the work was done, not whatever the owner has
      // set by the time the report is run. Same reasoning as buyPrice.
      lines: cart.map((c) => ({
        name: c.name, qty: c.qty, unit: c.unit, price: c.sellPrice, buyPrice: c.buyPrice,
        amount: money(c.sellPrice * c.qty),
        lineType: isServiceLine(c) ? "service" : "product",
        ...(isServiceLine(c) ? { staffId: c.staffId, commissionPct: c.commissionPct ?? 0, serviceId: c.id } : {}),
        ...(c.fromPackageId ? { fromPackageId: c.fromPackageId, packageName: c.packageName } : {}),
        ...(c.misc ? { misc: true } : {}),
      })),
      total, profit,
      // Only recorded when a discount was actually given, so plain bills keep their exact old shape.
      // `subtotal` is the pre-discount amount; `total` above is what the customer paid.
      ...(discountAmt > 0 ? { subtotal, discount: discountAmt, ...(discMode === "%" ? { discountPct: money(discNum) } : {}) } : {}),
      payment: pay,
      // The durable link to the customer record. Legacy `customer`/`mobile` free text is still
      // written alongside it: Udhari groups bills by name, and old bills only have that.
      //
      // A typed name+number is linked exactly like a picked one, because it is about to become a
      // customer record (below) and a bill that didn't point at it would leave that customer
      // showing 0 visits and ₹0 spend — both are derived from customerPhone. The phone is stored
      // NORMALISED here for the same reason the picked branch stores picked.phone: it is a key,
      // and "98765 43210" would not match the record it names.
      ...(picked ? { customerPhone: picked.phone, customer: picked.name, mobile: picked.phone } : {}),
      ...(typedPhone ? { customerPhone: typedPhone, customer: customer.trim(), mobile: typedPhone } : {}),
      ...(!picked && !typedPhone && customer.trim() ? { customer: customer.trim() } : {}),
      ...(!picked && !typedPhone && mobile.trim() ? { mobile: mobile.trim() } : {}),
      // Links the bill back to the appointment it closed, so the diary can show "✓ Billed"
      // and a second Complete → Bill can't charge the customer twice.
      ...(fromAppointment ? { appointmentId: fromAppointment } : {}),
      // Who rang it up. Distinct from staffId on a service line — the person at the till isn't
      // necessarily the person who did the work. This is what lets a biller's dashboard show
      // "your bills today" without showing them the whole shop's takings.
      ...(user?.uid ? { billedByUid: user.uid } : {}),
      // The points ledger IS the bills: the balance is the sum of these across a customer's
      // bills, never a stored running total. Deleting this bill reverses both automatically.
      // Only written when non-zero, so a walk-in bill keeps its plain shape.
      ...(willEarn > 0 ? { pointsEarned: willEarn } : {}),
      ...(redeemedPts > 0 ? { pointsRedeemed: redeemedPts, pointsValue: redeemAmt } : {}),
      // Which package sessions this bill drew down, so a delete can hand them back.
      ...(packageDraws.length ? { packageRedemptions: packageDraws } : {}),
      // For Udhari (credit), record how much was paid now (and via UPI/Cash); rest stays outstanding.
      ...(pay === "Udhari" ? { paid: Math.min(total, Math.max(0, money(+paidNow || 0))) } : {}),
      ...(pay === "Udhari" && +paidNow > 0 ? { paidMode } : {}),
    };
    setSales((s) => [...s, sale]);
    // File the customer the moment the bill is saved. This is the counter's real capture path:
    // the picker's quick-create needs somebody to notice the "+ Add" row, while a name and a
    // number in the two boxes is what a busy front desk actually types.
    //
    // Functional update, and captureCustomer is given the CURRENT list rather than the `customers`
    // prop closed over by this handler: a sync snapshot can land between render and save, and
    // rebuilding the array from a stale copy would drop whatever arrived in between. It is a
    // no-op (same array reference) when the customer is already on the list, so a regular's bill
    // costs nothing and never re-writes their profile.
    if (typedPhone) {
      setCustomers((list) => captureCustomer(list, { name: customer, phone: mobile, createdAt: saleDate }).customers);
    }
    // Deplete stock for PRODUCT lines only. A service id can't collide with an item id, but
    // filtering by line type says the intent out loud rather than relying on that.
    setItems((its) => its.map((i) => {
      const c = cart.find((x) => x.id === i.id && !isServiceLine(x));
      return c ? removeStock(i, c.qty, saleDate) : i; // FIFO deplete batches by expiry
    }));
    // No decrement here on purpose: usesLeft is DERIVED from the packageRedemptions recorded on
    // the bills (see reconcilePackages, run by the shell). Saving the bill IS the draw-down, and
    // deleting it IS the restore — there's no counter to nudge and no reversal to forget.
    //
    // Close the appointment this bill came from and link the two. Done after the sale is in
    // state, so the appointment is never marked completed against a bill that didn't save.
    if (fromAppointment) onBilled?.(fromAppointment, sale.id);
    setLastSale(sale);
    const nServices = cart.filter(isServiceLine).length;
    const nProducts = cart.length - nServices;
    const what = [nServices ? `${nServices} service(s)` : "", nProducts ? `${nProducts} product(s)` : ""].filter(Boolean).join(" + ");
    log("sale", `Bill ${INR(total)} · ${what} · ${pay}` + (discountAmt > 0 ? ` · disc ${INR(discountAmt)}` : "") + (picked ? ` (${picked.name})` : customer.trim() ? ` (${customer.trim()})` : "") + (backDated ? ` · back-dated to ${saleDate}` : ""));
    setCart([]);
    setQ("");
    setCustomer("");
    setMobile("");
    setCustomerPhone("");
    setFromAppointment("");
    setRedeemPts("");
    setPaidNow("");
    setPaidMode("Cash");
    setDiscount("");
    searchRef.current?.focus();
    notify(`Bill saved (${pay}) — ` + INR(total));
  };

  return (
    <div>
      {/* Phone: a running total pinned above the tab bar. The two panes are side by side on a
          desktop, so the bill is always in view while you tap the catalogue; stacked on a phone
          it is a screen further down, and a till you have to scroll to check is a till that gets
          rung up wrong. Tapping it jumps to the bill. It hides itself once the bill is actually
          on screen, so the total is never shown twice. */}
      {isPhone && cart.length > 0 && !receiptVisible && (
        <button
          className="cartbar"
          onClick={() => receiptRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          <span className="cartbar-n">{cart.reduce((n, l) => n + (l.qty || 1), 0)}</span>
          <span style={{ flex: 1, textAlign: "left" }}>Current bill</span>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{INR(total)}</span>
          <span aria-hidden="true">↓</span>
        </button>
      )}
      <Header title="Billing" sub={mode === "service" ? "Tap a service to add it to the bill" : "Tap a product to add it to the bill"}>
        {can(role, "billing.backdate", perms) ? (
          <label style={{ fontSize: 12, color: saleDate === todayStr() ? "var(--text-mid, #6B7E74)" : "#C44536", fontWeight: 600 }}>
            Bill date{" "}
            <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} value={saleDate} max={todayStr()} onChange={(e) => setSaleDate(e.target.value || todayStr())} />
          </label>
        ) : (
          // A worker bills today. Back-dating moves revenue between days and is an owner call.
          <span style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>Bill date · {saleDate}</span>
        )}
      </Header>
      <div className="g-split" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        {/* service / item picker */}
        <section style={S.panel}>
          {/* A salon bill is mostly services with the odd retail add-on, so the two halves of
              the catalogue get their own pane rather than being mixed into one list. */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[["service", "✂ Services"], ["product", "🧴 Products"]].map(([m, label]) => (
              <button
                key={m} className={"btn" + (mode === m ? " primary" : "")} style={{ flex: 1 }}
                onClick={() => { setMode(m); setQ(""); searchRef.current?.focus(); }}
              >{label}</button>
            ))}
          </div>
          <input
            ref={searchRef}
            className="input"
            placeholder={mode === "service" ? "Search services…" : "Search name / barcode / price… (Enter adds top match)"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={mode === "product" ? onSearchKey : undefined}
            aria-label={mode === "service" ? "Search services" : "Search items or scan barcode"}
            style={{ marginBottom: 12 }}
          />

          {mode === "service" ? (
            <>
              {/* Who's doing the work. Sticky across adds — one stylist usually does the whole
                  sitting — but each line can be re-attributed in the cart. */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, padding: "8px 10px", background: "var(--surface-2, #F4F7F4)", borderRadius: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#465", whiteSpace: "nowrap" }}>Performed by</span>
                <select className="input" style={{ flex: 1, minWidth: 130 }} value={lineStaff} onChange={(e) => setLineStaff(e.target.value)}>
                  <option value="">Choose staff…</option>
                  {bookableStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {bookableStaff.length === 0 && (
                <div style={{ fontSize: 12.5, color: "#B23B2E", marginBottom: 10 }}>
                  No active staff yet — add someone under Staff before billing a service.
                </div>
              )}
              {serviceResults.length === 0 ? (
                <Empty text={services.length ? "No services match." : "No services on the menu yet."} />
              ) : serviceResults.map(([category, list]) => (
                <div key={category} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "var(--text-mid, #8A9C90)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                    <ServiceIconChip icon={CATEGORY_FALLBACK[category] || "defaultService"} size={32} />
                    {category}
                  </div>
                  <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {list.map((s) => (
                      <div key={s.id} className="pick" style={{ cursor: "pointer" }} onClick={() => addService(s)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <ServiceIconChip icon={serviceIcons.get(s.id) || "defaultService"} size={26} />
                          <div style={{ fontWeight: 700, fontSize: 13.5, minWidth: 0 }}>{s.name}</div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12.5 }}>
                          <span style={{ color: "var(--brand)", fontWeight: 800 }}>{INR(s.price)}</span>
                          <span style={{ color: "var(--text-mid, #789)" }}>{s.durationMin} min</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : (
          <>
          {/* Misc row → quick "add & catalogue": bills the item AND registers it in inventory
              (opening stock 20, auto category). Barcode is optional; given → it scans next time. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 12, padding: "8px 10px", background: "var(--surface-2, #F4F7F4)", borderRadius: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#465", whiteSpace: "nowrap" }}>🧾 Misc</span>
            <input ref={miscNameRef} className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Name" value={miscName} onChange={(e) => setMiscName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMisc(); }} aria-label="Item name" />
            <input className="input" style={{ flex: 1, minWidth: 100 }} placeholder="Barcode (optional)" value={miscCode} onChange={(e) => setMiscCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMisc(); }} aria-label="Item barcode (optional)" title="Barcode (optional) — scan or type so this item scans next time" />
            <input className="input" style={{ width: 86 }} type="number" inputMode="decimal" min="0" step="0.01" placeholder="₹ sell" value={miscPrice} onChange={(e) => setMiscPrice(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMisc(); }} aria-label="Item sell price" />
            <button className="btn" onClick={addMisc}>+ Add</button>
            {/* The barcode field's title= said this, and a title is invisible on a touchscreen —
                which is most of where this row gets used. */}
            <div style={{ flexBasis: "100%", fontSize: 11, color: "var(--text-mid, #8A9C90)" }}>
              Adding a barcode catalogues the item so it scans straight into a bill next time.
            </div>
          </div>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {results.map((i) => {
              const inStock = (i.stock || 0) > 0;
              const editing = stockFor === i.id;
              return (
                <div key={i.id} className="pick" style={{ position: "relative", cursor: inStock ? "pointer" : "default", background: inStock ? undefined : "#F0F2F0" }} onClick={inStock ? () => add(i) : undefined}>
                  <button title="Add stock" aria-label={"Add stock to " + i.name} onClick={(e) => { e.stopPropagation(); setStockFor(editing ? null : i.id); setStockQty(""); }}
                    style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 6, border: "1px solid var(--border, #BBD3C2)", background: "var(--surface, #fff)", color: "var(--brand)", fontWeight: 800, cursor: "pointer", lineHeight: 1, padding: 0 }}>＋</button>
                  <div style={{ fontWeight: 700, fontSize: 13.5, paddingRight: 26 }}><span style={{ marginRight: 5 }}>{i.icon || "📦"}</span>{i.name}{soldQty[i.name] ? <span style={{ color: "#E8A33D", fontSize: 11, marginLeft: 4 }} title="best-seller">★</span> : null}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12.5 }}>
                    <span style={{ color: "var(--brand)", fontWeight: 800 }}>{INR(i.sellPrice)}<span style={{ color: "var(--text-mid, #8AA)", fontWeight: 500 }}>/{i.unit}</span></span>
                    <span style={{ color: !inStock || i.stock <= i.lowAt ? "#C44536" : "#789", fontWeight: !inStock ? 600 : 400 }}>{!inStock ? "Out of stock" : i.stock + " left"}</span>
                  </div>
                  {editing && (
                    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                      <input className="input" style={{ padding: "5px 7px", width: 64 }} type="number" inputMode="decimal" min="1" autoFocus placeholder="Qty" value={stockQty}
                        onChange={(e) => setStockQty(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") quickRestock(i); }} />
                      <button className="btn small primary" onClick={() => quickRestock(i)}>Add</button>
                      <button className="btn small ghost" aria-label="Cancel" onClick={() => { setStockFor(null); setStockQty(""); }}>✕</button>
                    </div>
                  )}
                </div>
              );
            })}
            {results.length === 0 && <Empty text="No items match. Add it from Inventory first." />}
          </div>
          </>
          )}
        </section>

        {/* receipt cart */}
        <section ref={receiptRef} style={S.receipt}>
          <div style={S.receiptHead}>CURRENT BILL</div>

          {/* Who the bill is for. Optional — a walk-in who won't leave a number must never be
              a blocker at the till — but capturing it here is what makes every returning-
              customer feature downstream possible. */}
          <div style={{ marginBottom: 10 }}>
            <CustomerPicker
              customers={customers} value={customerPhone} onPick={setCustomerPhone}
              onCreate={(rec) => setCustomers((list) => [...list, rec])}
              notify={notify}
            />
          </div>

          {cart.length === 0 ? (
            <Empty text="Bill is empty. Tap services or products on the left to add.">
              {lastSale && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <button className="btn" onClick={() => printReceipt(lastSale, store, staff, receiptExtras(lastSale, { customerPackages, services, sales }))}>🖨 Print last bill · {INR(lastSale.total)}</button>
                  <SendBillActions
                    sale={lastSale} store={store} staff={staff}
                    extras={receiptExtras(lastSale, { customerPackages, services, sales })}
                    notify={notify} guardOnline={guardOnline} size="normal"
                  />
                </div>
              )}
            </Empty>
          ) : (
            <>
              {cart.map((c) => (
                <div key={c.id} style={{ ...S.rcptLine, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><span style={{ marginRight: 4 }}>{c.icon || "📦"}</span>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-mid, #777)" }}>{INR(c.sellPrice)} × {c.qty} {c.unit}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button className="qty" aria-label={"Decrease " + c.name} onClick={() => setQty(c.id, c.qty - 1)}>−</button>
                    <span style={{ minWidth: 22, textAlign: "center", fontWeight: 700 }}>{c.qty}</span>
                    <button className="qty" aria-label={"Increase " + c.name} onClick={() => setQty(c.id, c.qty + 1)}>+</button>
                  </div>
                  <b style={{ width: 76, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{INR(c.sellPrice * c.qty)}</b>
                  {/* Per-line attribution: a sitting can be split across stylists, and the
                      commission has to follow whoever actually did each piece. */}
                  {isServiceLine(c) && (
                    <select
                      className="input"
                      style={{ flexBasis: "100%", padding: "3px 6px", fontSize: 11.5, marginTop: 4, borderColor: c.staffId ? undefined : "#E0A96D" }}
                      value={c.staffId || ""} onChange={(e) => setLineStaffFor(c.id, e.target.value)}
                      aria-label={"Who performed " + c.name}
                    >
                      <option value="">⚠ Who did this?</option>
                      {bookableStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </div>
              ))}
              {/* Optional additional discount on the whole bill (₹ off, or a % of the subtotal). */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 10, borderTop: "1px dashed var(--receipt-rule, #E0D9C4)" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-mid, #6B7E74)" }}>Additional discount</span>
                <div style={{ display: "flex", gap: 4, marginLeft: "auto", alignItems: "center" }}>
                  {["₹", "%"].map((m) => (
                    <button key={m} className={"btn small " + (discMode === m ? "primary" : "ghost")} style={{ minWidth: 30 }} onClick={() => setDiscMode(m)} aria-label={m === "₹" ? "Discount in rupees" : "Discount in percent"}>{m}</button>
                  ))}
                  <input className="input" style={{ width: 74 }} type="number" inputMode="decimal" min="0" step="0.01" max={discMode === "%" ? 100 : subtotal} placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="Additional discount amount" />
                </div>
              </div>
              {discountAmt > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--text-mid, #6B7E74)", marginTop: 8 }}>
                    <span>Subtotal</span><span>{INR(subtotal)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#C44536", fontWeight: 600, marginTop: 2 }}>
                    <span>Discount{discMode === "%" && discNum > 0 ? ` (${money(discNum)}%)` : ""}</span><span>−{INR(discountAmt)}</span>
                  </div>
                </>
              )}

              {/* Loyalty redemption. Only offered when there's a customer AND they're actually
                  able to redeem — an always-visible "0 points available" row is clutter at a
                  till that's trying to be fast. */}
              {picked && rules.enabled && maxPts > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 10, borderTop: "1px dashed var(--receipt-rule, #E0D9C4)" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-mid, #6B7E74)" }}>
                    Use points <span style={{ fontWeight: 400 }}>({ptsBalance} available)</span>
                  </span>
                  <div style={{ display: "flex", gap: 4, marginLeft: "auto", alignItems: "center" }}>
                    <button className="btn small ghost" onClick={() => setRedeemPts(String(maxPts))} title={`Use the most allowed (${maxPts})`}>Max</button>
                    <input
                      className="input" style={{ width: 74 }} type="number" inputMode="decimal" min="0" max={maxPts} step="1"
                      placeholder="0" value={redeemPts} onChange={(e) => setRedeemPts(e.target.value)}
                      aria-label="Points to redeem"
                    />
                  </div>
                </div>
              )}
              {redeemedPts > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--brand)", fontWeight: 600, marginTop: 4 }}>
                  <span>Points redeemed ({redeemedPts})</span><span>−{INR(redeemAmt)}</span>
                </div>
              )}
              {/* Say when the typed number was trimmed, rather than silently ignoring it. */}
              {picked && Math.floor(+redeemPts || 0) > maxPts && maxPts > 0 && (
                <div style={{ fontSize: 11.5, color: "var(--warn, #8A5A14)", marginTop: 2 }}>
                  Capped at {maxPts} points on this bill ({rules.maxRedeemPctOfBill}% limit).
                </div>
              )}

              <div style={S.rcptTotal}>
                <span>TOTAL</span>
                <span>{INR(total)}</span>
              </div>
              {billPhone && willEarn > 0 && (
                <div style={{ fontSize: 11.5, color: "var(--brand)", textAlign: "right", marginTop: 2 }}>
                  Earns {willEarn} point{willEarn > 1 ? "s" : ""} · balance {ptsBalance - redeemedPts + willEarn}
                </div>
              )}
              {/* Profit is hidden during billing; only surfaced as a warning when the bill would
                  run at a loss (e.g. a discount deeper than the margin), so it can't slip by. */}
              {profit < 0 && (
                <div style={{ fontSize: 12, color: "#C44536", fontWeight: 700, textAlign: "right", marginTop: 2 }}>
                  ⚠ This bill is at a loss: {INR(-profit)}
                </div>
              )}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-mid, #6B7E74)", textTransform: "uppercase", letterSpacing: ".05em", margin: "12px 0 4px" }}>Payment</div>
              <div style={{ display: "flex", gap: 6 }}>
                {PAY_MODES.map((p) => (
                  <button key={p} className={"btn small " + (pay === p ? "primary" : "")} style={{ flex: 1 }} onClick={() => setPay(p)}>
                    {p}
                  </button>
                ))}
              </div>
              {/* The free-text name/mobile fields are the pre-customer-database way of putting a
                  name on a bill. They stay for the walk-in who isn't worth a profile — and for
                  Udhari, which groups debts by name and needs SOMETHING to group by. Once a
                  customer is picked they're redundant, and showing both invites two versions of
                  the same person on one bill. */}
              {!picked && (
                <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                  <div style={{ position: "relative" }}>
                    <input className="input" autoComplete="off" placeholder={pay === "Udhari" ? "Customer name (owes)" : "Name (optional)"} value={customer}
                      onChange={(e) => setCustomer(e.target.value)}
                      onFocus={() => setCustFocus(true)}
                      onBlur={() => setTimeout(() => setCustFocus(false), 120)}
                      aria-label="Customer name" />
                    {custFocus && custSuggestions.length > 0 && (
                      <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, background: "var(--surface, #fff)", border: "1px solid var(--border, #DDE8DE)", borderRadius: 9, marginTop: 2, boxShadow: "0 8px 24px rgba(0,0,0,.14)", overflow: "hidden" }}>
                        {custSuggestions.map((c) => (
                          // onMouseDown (not onClick) so selection fires before the input's blur closes the list.
                          <button key={(c.customer ? "c:" : "t:") + (c.phone || c.name)} type="button"
                            onMouseDown={(e) => { e.preventDefault(); pickSuggestion(c); }}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid var(--border, #F0F4F0)", padding: "8px 10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
                            <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.name}
                              {/* Says which of the two rows this is — a profile the bill can be put
                                  ON, or a name that has only ever been text on a bill. */}
                              {c.customer && (
                                <span style={{ background: "var(--surface-2, #EEF6F1)", color: "var(--brand)", fontWeight: 700, fontSize: 9.5, padding: "1px 5px", borderRadius: 999, marginLeft: 5, letterSpacing: ".03em" }}>
                                  ON FILE
                                </span>
                              )}
                            </span>
                            <span style={{ color: "var(--text-mid, #8A9C90)", fontSize: 11.5, whiteSpace: "nowrap" }}>
                              {c.phone ? formatPhone(c.phone) : "—"}
                              {c.customer?.totalVisits ? ` · ${c.customer.totalVisits} visit${c.customer.totalVisits > 1 ? "s" : ""}` : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input className="input" type="tel" inputMode="numeric" maxLength={15} placeholder="Mobile (optional)" value={mobile} onChange={(e) => setMobile(e.target.value)} aria-label="Customer mobile" />
                </div>
              )}
              {/* Say what saving this bill is about to do. The capture is a side effect of
                  completing the sale, and a side effect nobody was told about is indistinguishable
                  from a bug the first time somebody notices the customer list growing. It also
                  teaches the front desk the rule — a name AND a full number — at the moment they
                  are one digit short of it. */}
              {!picked && typedPhone && (
                <div style={{ fontSize: 11.5, color: "var(--brand)", marginTop: 4 }}>
                  {typedExisting
                    ? `✓ Already on your customer list — this bill goes to ${typedExisting.name || formatPhone(typedPhone)}.`
                    : `✓ ${customer.trim()} will be added to your customer list.`}
                </div>
              )}
              {pay === "Udhari" && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input className="input" style={{ flex: 1 }} type="number" inputMode="decimal" min="0" step="0.01" max={total} placeholder="Paid now (optional)" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} aria-label="Amount paid now" />
                    <button className="btn small ghost" onClick={() => setPaidNow(String(total))}>Full</button>
                  </div>
                  {+paidNow > 0 && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                      <span style={{ fontSize: 11.5, color: "var(--text-mid, #6B7E74)", fontWeight: 600 }}>Paid via</span>
                      {["UPI", "Cash"].map((m) => (
                        <button key={m} className={"btn small " + (paidMode === m ? "primary" : "ghost")} onClick={() => setPaidMode(m)}>{m}</button>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 12, textAlign: "right", marginTop: 4, color: "#C44536", fontWeight: 600 }}>
                    On credit (udhari): {INR(Math.max(0, money(total - (+paidNow || 0))))}
                    {+paidNow > 0 && <span style={{ color: "var(--brand)", fontWeight: 500 }}> · paid {INR(Math.min(total, money(+paidNow)))} ({paidMode})</span>}
                  </div>
                </div>
              )}
              {pay === "UPI" && <UpiQrPreview store={store} amount={total} />}
              <button className="btn primary big" onClick={completeSale} style={{ marginTop: 12, width: "100%" }}>
                Complete sale · {INR(total)} · {pay}
              </button>
              <button className="btn ghost" onClick={() => { setCart([]); setDiscount(""); }} style={{ marginTop: 8, width: "100%" }}>
                Clear bill
              </button>
            </>
          )}
        </section>
      </div>

      {notFound != null && (
        <Modal title="No item found" onClose={() => { setNotFound(null); searchRef.current?.focus(); }}>
          <div style={{ fontSize: 14, color: "#465", lineHeight: 1.6 }}>
            No item in your inventory matches:
            <div style={{ margin: "10px 0", fontFamily: "monospace", fontSize: 16, fontWeight: 800, textAlign: "center", background: "var(--surface-2, #F4F7F4)", padding: "10px 12px", borderRadius: 8, wordBreak: "break-all" }}>{notFound}</div>
            Add it in the <b>🧾 Misc</b> row (with this barcode) so it scans here next time.
          </div>
          <button
            className="btn primary big" style={{ width: "100%", marginTop: 14 }}
            onClick={() => {
              // Hand the scanned barcode to the Misc row and focus its name field, so an unknown
              // scan becomes a catalogued product (in inventory + on the bill) in one flow.
              const code = notFound;
              setNotFound(null); setMiscCode(code); setMiscName(""); setMiscPrice("");
              setTimeout(() => miscNameRef.current?.focus(), 0);
            }}>＋ Add as new item</button>
          <button
            className="btn big" style={{ width: "100%", marginTop: 8 }}
            onClick={(e) => {
              // A scanner's trailing Enter (CR/LF suffix) lands on a focused button and would dismiss
              // the modal instantly. Ignore a keyboard-triggered click (e.detail === 0) in the first
              // moment after it opens; a real mouse/touch tap (detail ≥ 1) always closes.
              if (e.detail === 0 && Date.now() - notFoundAt.current < 600) return;
              setNotFound(null); searchRef.current?.focus();
            }}>Cancel</button>
        </Modal>
      )}
    </div>
  );
}


// PAY_MODES is exported for the parked-feature test only: the payment row renders behind a
// non-empty cart, so a jsdom suite would have to ring up a bill to see it, and the thing
// worth pinning is the list itself — that it is DERIVED from the flag and not hardcoded again.
export { Billing, PAY_MODES };
export default Billing;
