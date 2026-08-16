// One receipt layout, three deliveries: paper, JPEG, and the UPI QR beside it.

import { formatPhone } from "../lib/customers.js";
import { isServiceLine, serviceById, staffById, staffName } from "../lib/salon.js";
import { LOGO_SRC, PAYMENT_QR_SRC, assetUrl, printHtml } from "../lib/ui/assets.js";
import { INR, billRef, escapeHtml, money } from "../lib/ui/format.js";
import { STORE } from "../lib/ui/store.js";
import { SendFailedModal } from "./primitives.jsx";
import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { pointsBalance } from "../lib/loyalty.js";
import { addDays } from "../lib/appointments.js";
import { canShareImages, renderReceiptFile } from "../lib/receiptImage.js";
import { uploadErrorMessage, uploadReceiptImage } from "../lib/receiptStorage.js";
import { receiptMessage, receiptWaLink } from "../lib/receipts.js";

// Build a UPI "pay" deep link (upi://pay?…). Encoding an amount (am=) makes the customer's UPI
// app (PhonePe/GPay/Paytm…) open with the bill total already filled in — they just confirm & pay.
// Returns "" when there's no VPA to pay to (caller then falls back to the static QR image).
// Spaces are %20-encoded via encodeURIComponent (NOT "+") — some UPI apps read a literal "+" in
// the payee name / note instead of treating it as a space.
function upiPayUri({ vpa, name, amount, note } = {}) {
  const pa = (vpa || "").trim();
  if (!pa) return "";
  // pa (the VPA) is left raw — UPI apps expect a literal "@" here, not "%40"; the field is
  // charset-validated (isValidUpiId) before it's ever saved. pn/tn are free text → encoded.
  const parts = [`pa=${pa}`];
  const pn = (name || "").trim();
  if (pn) parts.push(`pn=${encodeURIComponent(pn)}`);
  const am = Number(amount);
  if (Number.isFinite(am) && am > 0) parts.push(`am=${am.toFixed(2)}`);
  parts.push("cu=INR");
  const tn = (note || "").trim();
  if (tn) parts.push(`tn=${encodeURIComponent(tn)}`);
  return "upi://pay?" + parts.join("&");
}

// Render text to a QR as a data-URL image (GIF), generated locally — nothing leaves the device.
// cellSize = pixels per module, margin = quiet-zone modules (min 2 so scanners lock on). Kept
// small; callers upscale the <img> with image-rendering:pixelated so it stays crisp on screen and
// on the 203dpi thermal head. Level "M" tolerates ~15% smudging on cheap receipt paper. typeNumber
// 0 auto-sizes to the smallest version that fits the string.
function qrDataUrl(text, cellSize = 6, margin = 2) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, margin);
}

// A blank string, or a UPI VPA like mysalon@okhdfcbank / 9876543210@ybl: a permissive handle
// (letters, digits, dot, hyphen, underscore) before an alphanumeric bank/PSP suffix that starts
// with a letter. Used to sanity-check the field before saving; blank is allowed (feature is off).
const isValidUpiId = (s) => {
  const v = (s || "").trim();
  if (!v) return true;
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(v);
};

// Build a thermal-style receipt as a standalone HTML fragment.
// PRESENTATION ONLY — this function computes no bill data. Every value below (l.name, l.qty,
// l.price, l.amount, sale.total, discount, payment …) is read straight off the sale and merely
// laid out for a 72mm (80mm paper) ESC/POS thermal printer.
// `extras` carries the salon bits a receipt needs but a bill doesn't store: the customer's
// points balance AFTER this bill, and when they're next due. Both are derived at print time
// from live data (the ledger is the bills), so a reprint months later shows today's truth —
// which is the right answer for a balance and a suggestion, and would be the wrong answer for
// money. The money on this receipt all comes off the sale record itself.
//
// This is the SINGLE SOURCE of receipt layout, deliberately separated from delivery. Two
// callers render it: printReceipt() (hidden iframe → paper) and the WhatsApp share path
// (offscreen node → JPEG, src/lib/receiptImage.js). Anything that only makes sense on paper
// would silently disappear from the customer's copy, so keep them one document.
//
// `forImage` drops the two /public asset URLs the rasterizer cannot inline (see
// receiptImage.js): an <img src="http://…"> taints the canvas and the export throws. A custom
// logo/QR uploaded in Settings is already a data URL, and a UPI QR is generated locally as one,
// so both survive either way.
//
// The one place paper and image legitimately differ: a shop that has configured NEITHER a UPI
// ID nor its own payment QR gets the bundled placeholder QR on paper and no QR at all in the
// customer's copy. That is the better failure — the bundled image is a demo placeholder that
// pays a stranger, and a receipt is proof of a payment already made, not a request for one.
export function receiptHtml(sale, store = STORE, staff = [], extras = {}, { forImage = false } = {}) {
  // Custom logo/QR are stored as data URLs (already absolute); the bundled fallbacks are
  // relative /public assets that must be made absolute for the print iframe (about:blank).
  // For an image export the bundled fallbacks are dropped instead — see the header note.
  const logoUrl = store.logo ? store.logo : forImage ? "" : assetUrl(LOGO_SRC);
  const ref = billRef(sale);
  // Dynamic UPI QR: when a VPA is configured, encode this bill's exact total so the customer's app
  // opens with the amount pre-filled. The bill ref rides along as the payment note (tn) so an
  // incoming UPI payment can be reconciled against this printed receipt. Otherwise fall back to the
  // fixed payment-QR image. `dynQr` also drives the caption + pixelated rendering below.
  const upiUri = upiPayUri({ vpa: store.upiId, name: store.upiName || store.name, amount: sale.total, note: ref ? "Bill " + ref : store.name });
  const dynQr = !!upiUri;
  // A generated QR is a data URL and is always safe to inline; only the bundled fallback image
  // is dropped for an image export.
  const qrUrl = dynQr ? qrDataUrl(upiUri) : store.paymentQr ? store.paymentQr : forImage ? "" : assetUrl(PAYMENT_QR_SRC);
  const rows = sale.lines
    .map((l) => {
      // Unit-price subline under the name: preserves the "unit price" field without a 4th column.
      // Skipped for misc/custom-amount lines where a per-unit price isn't meaningful.
      const unit = l.unit ? `/${escapeHtml(String(l.unit))}` : "";
      const sub =
        !l.misc && l.price != null && l.price !== ""
          ? `<span class="sub">@ ${INR(l.price)}${unit}</span>`
          : "";
      // Who did the work, and ONLY if the owner asked for it (Settings → Branding & receipt;
      // config.showStaffOnReceipt, default off). Attribution is an internal record — it drives
      // commissions and payouts, and it is on the line in Sales history and the customer's visit
      // history either way. This is the one copy that leaves the shop, so it is opt-in: a salon
      // turns it on when it wants the customer to know who to ask for next time.
      const by =
        store.showStaffOnReceipt && isServiceLine(l) && l.staffId && staffById(staff, l.staffId)
          ? `<span class="sub">by ${escapeHtml(staffName(staff, l.staffId))}</span>`
          : "";
      return `<tr><td class="col-name"><span class="nm">${escapeHtml(l.name)}</span>${sub}${by}</td><td class="col-qty">${escapeHtml(String(l.qty))}</td><td class="col-amt">${INR(l.amount)}</td></tr>`;
    })
    .join("");
  return (
    `<style>
    /* Dedicated 72mm thermal receipt. size:_auto_ height => no blank paper feed; margin:0 =>
       no scaling. Everything is pure #000; print-color-adjust:exact keeps black solid + QR crisp. */
    @page { size: 72mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 72mm; background: #fff; }
    /* font-weight 600 (renders bold on Courier New) fires more dots per glyph => darker on a
       203dpi thermal head. This is the main lever left for faintness; true density still comes
       from the driver's darkness/speed setting. */
    /* 4mm side padding (not 2mm): the printable area is 72mm but the print head's right/left
       non-printable margins vary, and right-aligned amounts were clipping at the paper edge.
       4mm each side keeps the last digit safely inside the printable window on 80mm rolls. */
    /* The paper box is .rcpt, NOT body: an SVG foreignObject (the image export) has no body
       element for a body rule to land on, so a receipt styled through body would rasterize
       unpadded and full-bleed. Styling a plain element keeps print and image identical.
       The html/body rule above stays for the print document, where both match at 72mm. */
    .rcpt { width: 72mm; padding: 3mm 4mm 8mm; color: #000; background: #fff;
      font-family: 'Courier New', Courier, monospace; font-size: 12px; font-weight: 600; line-height: 1.35;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .logo { display:block; margin:0 auto 1mm; height:12mm; object-fit:contain; }
    /* Header/address use a Devanagari-capable stack so a Marathi/Hindi shop name renders. */
    .shop { text-align:center; font-weight:700; font-size:15px; line-height:1.2;
      font-family:'Nirmala UI','Segoe UI','Courier New',monospace; }
    .addr { text-align:center; font-size:11px; line-height:1.3; margin-top:1px;
      font-family:'Nirmala UI','Segoe UI','Courier New',monospace; }
    .meta { text-align:center; font-size:11px; line-height:1.3; margin-top:1px; }
    .rule { border-top:1px dashed #000; margin:2mm 0; }
    /* Fixed columns => name/qty/amount stay aligned no matter how names wrap. */
    table.items { width:100%; border-collapse:collapse; table-layout:fixed; }
    table.items td { vertical-align:top; padding:1px 0; font-size:12px; }
    .col-name { padding-right:1.5mm; overflow-wrap:break-word; }
    .col-name .nm { display:block; padding-left:2.5mm; text-indent:-2.5mm; overflow-wrap:anywhere; } /* hanging indent on wrap, never truncated */
    .col-name .sub { display:block; padding-left:2.5mm; font-size:11px; }
    .col-qty { width:8mm; text-align:right; white-space:nowrap; padding-right:1.5mm; }
    .col-amt { width:18mm; text-align:right; white-space:nowrap; } /* ₹ stays attached to the number */
    tr.tot td { border-top:1px dashed #000; font-weight:700; font-size:14px; padding-top:2px; }
    .ft { text-align:center; font-size:12px; margin-top:2mm; }
    .qr { text-align:center; margin-top:3mm; }
    .qr img { width:40mm; height:40mm; object-fit:contain; }
    /* A locally-generated QR is a tiny raster upscaled to 40mm — nearest-neighbour keeps the
       modules square and sharp on the thermal head. Not applied to a photo/uploaded QR image. */
    .qr img.gen { image-rendering: pixelated; image-rendering: crisp-edges; }
    .qr .cap { font-size:11px; font-weight:700; margin-top:1mm; }
    </style>
    <div class="rcpt">
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="" onerror="this.style.display='none'" />` : ""}
    <div class="shop">${escapeHtml(store.name)}</div>
    <div class="addr">${escapeHtml(store.address)}</div>
    ${store.phone ? `<div class="addr">☎ ${escapeHtml(store.phone)}</div>` : ""}
    <div class="meta">${ref ? `Bill #${escapeHtml(ref)} &nbsp; ` : ""}${escapeHtml(sale.date)} &nbsp; ${escapeHtml(sale.time)}</div>
    <div class="rule"></div>
    <table class="items">${rows}
    ${sale.discount > 0 ? `<tr><td class="col-name">Subtotal</td><td class="col-qty"></td><td class="col-amt">${INR(sale.subtotal != null ? sale.subtotal : money((sale.total || 0) + sale.discount))}</td></tr>
    <tr><td class="col-name">Discount${sale.discountPct ? " (" + sale.discountPct + "%)" : ""}</td><td class="col-qty"></td><td class="col-amt">−${INR(sale.discount)}</td></tr>` : ""}
    ${sale.pointsRedeemed > 0 ? `<tr><td class="col-name">Points used (${escapeHtml(String(sale.pointsRedeemed))})</td><td class="col-qty"></td><td class="col-amt">−${INR(sale.pointsValue || 0)}</td></tr>` : ""}
    <tr class="tot"><td class="col-name">TOTAL</td><td class="col-qty"></td><td class="col-amt">${INR(sale.total)}</td></tr>
    </table>
    ${sale.payment ? `<div class="meta">Paid via ${escapeHtml(sale.payment)}${sale.customer ? " — " + escapeHtml(sale.customer) : ""}</div>` : ""}
    ${sale.customer || sale.mobile ? `<div class="meta">Customer: ${escapeHtml(sale.customer || "—")}${sale.mobile ? " · " + escapeHtml(sale.mobile) : ""}</div>` : ""}
    ${sale.payment === "Udhari" ? `<div class="meta">Paid now: ${INR(sale.paid || 0)}${sale.paidMode ? " (" + escapeHtml(sale.paidMode) + ")" : ""} &nbsp; Balance due: ${INR(Math.max(0, (sale.total || 0) - (sale.paid || 0)))}</div>` : ""}
    ${sale.pointsEarned > 0 || extras.pointsBalance > 0 ? `<div class="rule"></div>
    <div class="meta">${sale.pointsEarned > 0 ? "Points earned: " + escapeHtml(String(sale.pointsEarned)) : ""}${sale.pointsEarned > 0 && extras.pointsBalance != null ? " &nbsp;·&nbsp; " : ""}${extras.pointsBalance != null ? "Balance: " + escapeHtml(String(extras.pointsBalance)) + " pts" : ""}</div>` : ""}
    ${extras.packageNote ? `<div class="meta">${escapeHtml(extras.packageNote)}</div>` : ""}
    <div class="rule"></div>
    ${extras.nextVisit ? `<div class="ft">${escapeHtml(extras.nextVisit)}</div>` : ""}
    <div class="ft">Thank you! Please visit again.</div>
    ${qrUrl ? `<div class="qr">
      <img class="${dynQr ? "gen" : ""}" src="${qrUrl}" alt="Scan to pay" onerror="this.style.display='none'" />
      <div class="cap">Scan to Pay${dynQr ? " " + INR(sale.total) : ""} · PhonePe / UPI</div>
    </div>` : ""}
    </div>`
  );
}

// Build a thermal-style receipt and send it to the printer. See printHtml() for the print
// mechanism (isolated iframe document → no app-UI leakage) and receiptHtml() for the layout.
function printReceipt(sale, store = STORE, staff = [], extras = {}) {
  printHtml(receiptHtml(sale, store, staff, extras), "Receipt");
}

/**
 * The salon extras a receipt shows but a bill doesn't store: the points balance after this
 * bill, a note about any package used, and a next-visit suggestion.
 *
 * The suggestion is the SOONEST rebooking cycle among the services on this bill — a customer
 * who had a cut (45d) and a colour (60d) is due back in 45 days, not 60. Suggesting the later
 * date would quietly cost the salon a visit.
 *
 * Returns {} for a walk-in: there is nobody to hold a balance or be due back.
 */
function receiptExtras(sale, { customerPackages = [], services = [], sales = [] } = {}) {
  if (!sale?.customerPhone) return {};
  const extras = { pointsBalance: pointsBalance(sale.customerPhone, sales) };

  if (sale.packageRedemptions?.length) {
    const id = sale.packageRedemptions[0].customerPackageId;
    const cp = customerPackages.find((x) => x.id === id);
    if (cp) extras.packageNote = `${cp.name}: ${cp.usesLeft} session(s) left · valid to ${cp.expiresAt}`;
  }

  let soonest = 0;
  for (const l of sale.lines || []) {
    if (!isServiceLine(l) || !l.serviceId) continue;
    const svc = serviceById(services, l.serviceId);
    const cycle = Number(svc?.rebookCycleDays) || 0;
    if (cycle > 0 && (soonest === 0 || cycle < soonest)) soonest = cycle;
  }
  if (soonest > 0) {
    const due = addDays(sale.date, soonest);
    const nice = new Date(due + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    extras.nextVisit = `See you around ${nice} — book ahead to keep your slot.`;
  }
  return extras;
}

/**
 * "Send the customer their bill on WhatsApp" — the two deliveries, side by side.
 *
 * Both render the SAME receipt the printer gets (receiptHtml → JPEG), so a customer's copy can
 * never drift from the paper one. Neither sends anything by itself: each hands a filled-in
 * message to WhatsApp and a human presses send, matching the reminder queue. See
 * src/lib/receipts.js for why the two exist rather than one.
 *
 * WhatsApp (link)  — needs a saved phone and a connection; opens the right customer's chat.
 * Share…           — needs neither, attaches the image inline, but the user picks the contact.
 *                    Hidden entirely where the OS can't take a file (most desktops).
 *
 * Deliberately does NOT write the uploaded URL back onto the sale. Re-sending re-uploads to the
 * same deterministic path, which costs one small PUT and is always current; caching the URL on
 * the bill would add a second, staler copy of something the bill can already regenerate — the
 * same reason nothing in this app keeps a running total.
 */
function SendBillActions({ sale, store = STORE, staff = [], extras = {}, notify, guardOnline = () => true, size = "small" }) {
  const [busy, setBusy] = useState(""); // "" | "link" | "share"
  // Which step is running, shown on the button. Not decoration: the two steps fail for
  // completely different reasons (markup vs. Firebase Storage setup), and "Preparing…" for
  // both makes a stalled upload indistinguishable from a stalled render.
  const [step, setStep] = useState("");
  // A failure to send is a hard stop, not a toast — see SendFailedModal.
  const [failed, setFailed] = useState("");
  // Probed once per mount: the answer is a property of the device, not of this bill.
  const shareable = useMemo(() => canShareImages(), []);
  const phone = sale?.customerPhone || sale?.mobile || "";
  const cls = "btn" + (size === "small" ? " small" : "");

  const buildFile = () =>
    renderReceiptFile(receiptHtml(sale, store, staff, extras, { forImage: true }), sale);

  // LINK: upload, then open the customer's chat with the URL in the message.
  const sendLink = async () => {
    if (!guardOnline()) return; // uploading needs the network; the shell raises the offline modal
    setBusy("link");
    setFailed(""); // clear the previous failure's red outline before retrying
    try {
      setStep("Rendering…");
      const file = await buildFile();
      setStep("Uploading…");
      const { receiptURL } = await uploadReceiptImage(sale.id, file, (p) =>
        setStep(p > 0 && p < 1 ? `Uploading ${Math.round(p * 100)}%` : "Uploading…"),
      );
      // Opened synchronously after an await, so some browsers treat it as a non-gesture popup.
      // A blocked window is the one failure the user can't see, hence the explicit fallback.
      const win = window.open(receiptWaLink(sale, store, receiptURL), "_blank", "noopener");
      // A blocked pop-up is a silent non-delivery — the salon would never know — so it gets the
      // same hard stop as a failed upload rather than a toast.
      if (win) notify(`WhatsApp opened for ${formatPhone(phone)} — press send there`);
      else setFailed("Your browser blocked the WhatsApp window. Allow pop-ups for this site, then try again — or use Share bill instead.");
    } catch (e) {
      console.error("send bill failed", e);
      // The upload half fails for setup reasons the owner can actually fix, so name them.
      // Share bill needs no bucket at all, which makes it the useful thing to suggest.
      setFailed(uploadErrorMessage(e));
    } finally {
      setBusy("");
      setStep("");
    }
  };

  // SHARE: hand the JPEG to the OS share sheet. Works offline — WhatsApp queues it.
  const sendShare = async () => {
    setBusy("share");
    setFailed("");
    try {
      setStep("Rendering…");
      const file = await buildFile();
      setStep("Sharing…");
      await navigator.share({ files: [file], text: receiptMessage(sale, store) });
      notify("Bill shared — press send in WhatsApp");
    } catch (e) {
      // Dismissing the share sheet is an AbortError, not a failure worth a toast.
      if (e?.name !== "AbortError") {
        console.error("share bill failed", e);
        setFailed(e?.message || "The share sheet could not open. Try again, or print the bill instead.");
      }
    } finally {
      setBusy("");
      setStep("");
    }
  };

  // Left on the button after a failure, so the row still reads "this one didn't go" once the
  // dialog is dismissed. Cleared as soon as the next attempt starts.
  const alertStyle = failed ? { borderColor: "#B3261E", color: "#B3261E", boxShadow: "0 0 0 2px rgba(179,38,30,.18)" } : undefined;

  return (
    <>
      <button
        className={cls}
        style={alertStyle}
        onClick={sendLink}
        disabled={!!busy || !phone}
        title={phone ? `Opens WhatsApp for ${formatPhone(phone)} with the bill attached as a link` : "No mobile number saved on this bill"}
      >
        {busy === "link" ? step || "Preparing…" : "💬 WhatsApp bill"}
      </button>
      {shareable && (
        <button className={cls} style={alertStyle} onClick={sendShare} disabled={!!busy} title="Share the bill image to WhatsApp (you pick the chat)">
          {busy === "share" ? step || "Preparing…" : "📎 Share bill"}
        </button>
      )}
      {failed && <SendFailedModal message={failed} onClose={() => setFailed("")} />}
    </>
  );
}

// The Scan-to-Pay QR shown live in the billing panel while payment = UPI. When a UPI ID is set it
// renders an amount-encoded QR (regenerated as the cart total changes) so the customer's app opens
// pre-filled; otherwise it shows the fixed payment-QR image, exactly as before. `amount` is the
// live bill total — 0 (empty cart) drops the `am` param, showing a plain pay-to-shop QR.
function UpiQrPreview({ store, amount }) {
  // No note here: the sale isn't created until "Complete sale", so there's no bill ref yet. The
  // printed receipt (printReceipt) is where the bill ref gets stamped into the UPI note.
  const uri = upiPayUri({ vpa: store.upiId, name: store.upiName || store.name, amount });
  const src = useMemo(
    () => (uri ? qrDataUrl(uri) : store.paymentQr || PAYMENT_QR_SRC),
    [uri, store.paymentQr],
  );
  const amt = uri && Number(amount) > 0 ? " " + INR(amount) : "";
  return (
    <div style={{ textAlign: "center", marginTop: 10, padding: 8, background: "#fff", border: "1px solid #E2EAE3", borderRadius: 10 }}>
      <img src={src} alt="Scan to pay" style={{ width: 150, height: 150, objectFit: "contain", imageRendering: uri ? "pixelated" : "auto" }} />
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--panelhead, #3A5547)" }}>Scan to Pay{amt} · PhonePe / UPI</div>
    </div>
  );
}

export { isValidUpiId, printReceipt, receiptExtras, SendBillActions, UpiQrPreview };
