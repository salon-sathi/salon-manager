// Product categories, icons and stock-batch arithmetic.

import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_ICONS } from "../seed.js";
import { todayStr, uid } from "./format.js";

const UNITS = ["pc", "kg", "g", "L", "ml", "packet", "dozen", "box"];
// Product categories for salon RETAIL + BACKBAR stock. The salon's SERVICE menu is a separate
// slice with its own categories (Hair/Skin/Nails/Spa/Makeup) — see src/lib/seed.js. These are
// only for things that sit on a shelf and get counted.
const CATEGORIES = PRODUCT_CATEGORIES;
// A small emoji icon per category (used in place of product photos).
const CATEGORY_ICONS = PRODUCT_CATEGORY_ICONS;
const iconFor = (category) => CATEGORY_ICONS[category] || "📦";

// localStorage key for shop-owner-added categories (custom categories with no item yet).
const CUSTOM_CATS_KEY = "slm-custom-cats-v1";

// The full category list shown in every dropdown = the built-in CATEGORIES, plus any category
// already present on an item, plus custom categories the owner added. De-duped case-insensitively,
// built-in order preserved, extras appended, and "Other" kept last. Passing items + custom here is
// what makes a newly added category show up everywhere (add/edit item, filters) at once — and lets
// a category created on one device appear on others as soon as an item using it syncs in.
function catList(items = [], custom = []) {
  const seen = new Set();
  const out = [];
  const add = (c) => {
    const t = (c == null ? "" : String(c)).trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  CATEGORIES.filter((c) => c !== "Other").forEach(add);
  items.forEach((i) => add(i.category));
  custom.forEach(add);
  add("Other"); // always last
  return out;
}

// An icon is "auto" (safe to swap when the category changes) when it's blank or still equals
// the category's default emoji. A hand-typed custom emoji differs from the default → preserved.
const isAutoIcon = (icon, category) => {
  const t = (icon || "").trim();
  return !t || t === iconFor(category);
};

// Keyword → category guesses for the Add-item form. Ordered: more specific entries first so the
// right one wins ("nail polish remover" before "polish", "hair colour" before "colour"). Single-word
// keys match on word boundaries; multi-word / punctuated keys match as substrings.
const CATEGORY_KEYWORDS = [
  ["nail polish", "Nail Care"], ["nail paint", "Nail Care"], ["nail art", "Nail Care"], ["cuticle", "Nail Care"], ["acetone", "Nail Care"], ["nail", "Nail Care"], ["manicure", "Nail Care"], ["pedicure", "Nail Care"],
  ["hair colour", "Colour & Chemicals"], ["hair color", "Colour & Chemicals"], ["developer", "Colour & Chemicals"], ["peroxide", "Colour & Chemicals"], ["ammonia", "Colour & Chemicals"], ["bleach", "Colour & Chemicals"], ["keratin", "Colour & Chemicals"], ["smoothening", "Colour & Chemicals"], ["rebonding", "Colour & Chemicals"], ["botox", "Colour & Chemicals"], ["majirel", "Colour & Chemicals"], ["toner", "Colour & Chemicals"], ["highlight", "Colour & Chemicals"],
  ["shampoo", "Hair Care"], ["conditioner", "Hair Care"], ["hair mask", "Hair Care"], ["hair spa", "Hair Care"], ["hair oil", "Hair Care"], ["hair serum", "Hair Care"], ["serum", "Hair Care"], ["argan", "Hair Care"], ["dandruff", "Hair Care"], ["scalp", "Hair Care"], ["hair", "Hair Care"],
  ["sunscreen", "Skin Care"], ["spf", "Skin Care"], ["face wash", "Skin Care"], ["facewash", "Skin Care"], ["facial", "Skin Care"], ["cleanser", "Skin Care"], ["moisturiser", "Skin Care"], ["moisturizer", "Skin Care"], ["cream", "Skin Care"], ["lotion", "Skin Care"], ["scrub", "Skin Care"], ["face pack", "Skin Care"], ["de-tan", "Skin Care"], ["detan", "Skin Care"], ["vitamin c", "Skin Care"], ["salicylic", "Skin Care"], ["skin", "Skin Care"],
  ["rica", "Waxing & Threading"], ["wax", "Waxing & Threading"], ["waxing", "Waxing & Threading"], ["thread", "Waxing & Threading"], ["strip", "Waxing & Threading"], ["razor", "Waxing & Threading"],
  ["massage oil", "Spa & Massage"], ["aroma", "Spa & Massage"], ["essential oil", "Spa & Massage"], ["massage", "Spa & Massage"], ["spa", "Spa & Massage"],
  ["cotton", "Consumables"], ["tissue", "Consumables"], ["towel", "Consumables"], ["glove", "Consumables"], ["apron", "Consumables"], ["cape", "Consumables"], ["disposable", "Consumables"], ["sanitizer", "Consumables"], ["foil", "Consumables"],
  ["scissor", "Tools & Styling"], ["trimmer", "Tools & Styling"], ["clipper", "Tools & Styling"], ["dryer", "Tools & Styling"], ["straightener", "Tools & Styling"], ["tong", "Tools & Styling"], ["curler", "Tools & Styling"], ["comb", "Tools & Styling"], ["brush", "Tools & Styling"], ["roller", "Tools & Styling"], ["clip", "Tools & Styling"], ["gel", "Tools & Styling"], ["hair spray", "Tools & Styling"], ["styling", "Tools & Styling"], ["pomade", "Tools & Styling"],
];

// Guess a category from a typed item name: keyword map first, then a shared-token match against
// the store's existing items. Returns null when nothing is confident enough (caller keeps the
// current default). Used only for NEW items in the Add form.
function guessCategory(name, items = []) {
  const n = (name || "").toLowerCase().trim();
  if (n.length < 2) return null;
  for (const [kw, cat] of CATEGORY_KEYWORDS) {
    const hit = /[^a-z0-9]/.test(kw) ? n.includes(kw) : new RegExp(`\\b${kw}\\b`).test(n);
    if (hit) return cat;
  }
  // Fallback: an existing item that shares a 4+ char word with the typed name.
  const tokens = n.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  if (tokens.length) {
    const hit = items.find((i) => { const itn = (i.name || "").toLowerCase(); return tokens.some((t) => itn.includes(t)); });
    if (hit) return hit.category || null;
  }
  return null;
}

// ---------- stock / expiry batch helpers ----------
// Each item tracks stock as dated batches { id, qty, expiry, addedOn }; `stock` is the
// cached sum. Adding stock appends a batch; selling depletes batches FIFO by expiry.
const batchSort = (a, b) => (String(a.expiry || "9999-99-99") < String(b.expiry || "9999-99-99") ? -1 : 1);

// Coerce an item's money/quantity fields to real numbers. Firebase, legacy data and
// spreadsheet imports can store stock/prices as STRINGS; left untouched they silently
// corrupt every downstream calculation (stock value, profit, sorting) and can concatenate
// in addBatch. Applied at each point raw item data enters React state so the rest of the
// app can trust these fields are numbers. A blank/garbage value collapses to 0.
const numify = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function normalizeItem(i) {
  if (!i || typeof i !== "object") return i;
  const out = { ...i, buyPrice: numify(i.buyPrice), sellPrice: numify(i.sellPrice), stock: numify(i.stock) };
  if (i.mrp !== undefined) out.mrp = numify(i.mrp);
  if (Array.isArray(i.batches)) out.batches = i.batches.map((b) => ({ ...b, qty: numify(b.qty) }));
  return out;
}
const normalizeItems = (arr) => (Array.isArray(arr) ? arr.map(normalizeItem) : arr);

function addBatch(item, qty, expiry, date) {
  const q = +qty || 0;
  if (q <= 0) return item;
  const batches = [...(item.batches || []), { id: uid(), qty: q, expiry: expiry || "", addedOn: date || todayStr() }];
  // (+item.stock || 0), NOT (item.stock || 0): if stock is a STRING (legacy/imported/cloud
  // data), a bare `+` concatenates ("5" + 5 → "55") and snowballs a stock into a nonsense
  // multi-billion figure over repeated restocks/scans. Coerce to a real number first.
  return { ...item, batches, stock: (+item.stock || 0) + q, updatedAt: date || todayStr() };
}

function removeStock(item, qty, date) {
  let need = +qty || 0;
  const out = [];
  [...(item.batches || [])].sort(batchSort).forEach((b) => {
    if (need <= 0) return out.push(b);
    if (b.qty <= need) { need -= b.qty; } // consume whole batch
    else { out.push({ ...b, qty: b.qty - need }); need = 0; }
  });
  // `stock` is the authoritative count; batches track only the dated portion (addBatch can
  // raise stock without a matching batch), so decrement stock directly rather than from the
  // batch sum — otherwise legacy stock that predates any batch would be lost on a sale.
  return { ...item, batches: out, stock: Math.max(0, (item.stock || 0) - (+qty || 0)), updatedAt: date || todayStr() };
}

// Days until the earliest batch expiry (null if no dated batches; negative = expired).
function daysToExpiry(item) {
  const dates = (item.batches || []).filter((b) => b.expiry).map((b) => b.expiry).sort();
  if (!dates.length) return null;
  return Math.round((new Date(dates[0] + "T00:00") - new Date(todayStr() + "T00:00")) / 86400000);
}

// Normalised item name for duplicate detection (trim, lowercase, collapse inner spaces).
const normName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");


export { UNITS, CATEGORIES, iconFor, CUSTOM_CATS_KEY, catList, isAutoIcon, guessCategory, batchSort, normalizeItems, addBatch, removeStock, daysToExpiry, normName };
