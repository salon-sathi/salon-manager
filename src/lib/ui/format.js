// Money, dates and ids — the smallest shared helpers in the app.


// ---------- helpers ----------
const INR = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
// Round money to 2 decimals so bill totals don't drift (e.g. 0.1 + 0.2 = 0.30000004).
// A non-numeric input collapses to 0 rather than poisoning a total with NaN.
const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
};
// Local calendar date as YYYY-MM-DD. MUST be local, not toISOString() (which is UTC)
// — otherwise early-morning sales in IST get filed under the previous day.
const dateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => dateStr(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// A short, human-readable bill reference derived from the (already-unique) sale id: last 6 chars,
// upper-cased. Printed on the receipt AND stamped into the UPI note so a received payment can be
// matched back to its bill. Unique enough for a shop's day-to-day reconciliation.
const billRef = (sale) => String((sale && sale.id) || "").slice(-6).toUpperCase();
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));


export { INR, money, dateStr, todayStr, uid, billRef, escapeHtml };
