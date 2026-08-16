// @vitest-environment jsdom
//
// The customer's copy vs. the internal record.
//
// receiptHtml() is the SINGLE source of receipt markup for both deliveries — printReceipt()
// (paper) and SendBillActions (the WhatsApp JPEG) — so pinning it here covers both. The rule
// being pinned: who did the work does NOT go on the copy that leaves the shop unless the owner
// switched it on (Settings → Branding & receipt), and the default is off.
//
// Every "is absent" assertion below is paired with an "is present" one on the same render. On
// its own, `not.toContain(name)` also passes for a receipt that rendered nothing at all — which
// is exactly the regression it is supposed to catch.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { UpiQrPreview, receiptHtml } from "./receipt.jsx";
import { STORE, effectiveStore } from "../lib/ui/store.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const STAFF = [{ id: "st_asha", name: "Asha", active: true }];

const SALE = {
  id: "sale_abc123",
  date: "2026-08-16",
  time: "11:20",
  total: 500,
  payment: "UPI",
  lines: [
    { lineType: "service", serviceId: "sv_cut", name: "Haircut", qty: 1, price: 500, amount: 500, staffId: "st_asha" },
  ],
};

/** What every render must contain, so an "absent" assertion can never pass vacuously. */
const expectRealReceipt = (html) => {
  expect(html).toContain("Haircut");
  expect(html).toContain("500");
};

describe("receiptHtml — stylist attribution", () => {
  it("leaves the stylist off the customer's bill by default", () => {
    const html = receiptHtml(SALE, effectiveStore({}), STAFF);
    expectRealReceipt(html);
    expect(html).not.toContain("Asha");
    expect(html).not.toContain("by ");
  });

  it("prints the stylist once the owner switches it on", () => {
    const html = receiptHtml(SALE, effectiveStore({ showStaffOnReceipt: true }), STAFF);
    expectRealReceipt(html);
    expect(html).toContain("by Asha");
  });

  it("is off for the built-in STORE default, which is what an unconfigured shop prints", () => {
    // receiptHtml's own `store` default. A shop that never opened Settings must not leak names.
    const html = receiptHtml(SALE, STORE, STAFF);
    expectRealReceipt(html);
    expect(html).not.toContain("Asha");
  });

  it("keeps a product line unattributed either way", () => {
    // Only service lines carry a stylist; a shampoo sold over the counter never has one.
    const sale = { ...SALE, lines: [{ lineType: "product", name: "Shampoo", qty: 1, price: 300, amount: 300, staffId: "st_asha" }] };
    const html = receiptHtml(sale, effectiveStore({ showStaffOnReceipt: true }), STAFF);
    expect(html).toContain("Shampoo");
    expect(html).not.toContain("Asha");
  });

  it("renders the same way for the image export, which is the other delivery", () => {
    // forImage drops the bundled /public assets, not the attribution — the two deliveries are
    // one document, and a name hidden on paper but printed in the customer's JPEG is the bug.
    const on = receiptHtml(SALE, effectiveStore({ showStaffOnReceipt: true }), STAFF, {}, { forImage: true });
    const off = receiptHtml(SALE, effectiveStore({}), STAFF, {}, { forImage: true });
    expect(on).toContain("by Asha");
    expectRealReceipt(off);
    expect(off).not.toContain("Asha");
  });
});

// ── The Scan-to-Pay QR ────────────────────────────────────────────────────────────────────────
//
// Two QRs, one caption. With a UPI ID the QR encodes `am=<total>` and the customer confirms and
// pays; without one the shop falls back to a static image, which CANNOT carry a per-bill amount —
// the figure lives in the encoded URI. What's pinned here is that the amount is on screen and on
// paper either way, because the fallback is precisely the case where a human reads it and types it.

const UPI = { upiId: "salon@okhdfcbank", upiName: "Glow Salon" };

/** Mount a component into a detached container and return its text + HTML. */
let cleanup = null;
const render = (el) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  return { text: host.textContent, html: host.innerHTML };
};
afterEach(() => { cleanup?.(); cleanup = null; });

describe("UpiQrPreview — the amount on the till", () => {
  it("encodes the bill total in the QR when a UPI ID is set", () => {
    const { html, text } = render(<UpiQrPreview store={effectiveStore(UPI)} amount={450} />);
    // A generated QR is a locally-built data URL; the static fallback is a /public .jpg path.
    expect(html).toContain("data:image/gif;base64");
    expect(text).toContain("Scan to Pay ₹450");
    expect(text).not.toContain("has to enter");
  });

  it("still shows the amount on the static QR, and says the customer must type it", () => {
    // The regression this exists for: the caption used to go silent on this branch, so the one
    // case where somebody has to read the figure was the case with no figure on screen.
    const { text } = render(<UpiQrPreview store={effectiveStore({})} amount={450} />);
    expect(text).toContain("Scan to Pay ₹450");
    expect(text).toContain("has to enter ₹450");
    expect(text).toContain("Settings");
  });

  it("says nothing about typing when the shop has a UPI ID — that bill is already encoded", () => {
    const { text } = render(<UpiQrPreview store={effectiveStore({ ...UPI, paymentQr: "" })} amount={1} />);
    expect(text).toContain("Scan to Pay ₹1");
    expect(text).not.toContain("Settings");
  });

  it("stays quiet on an empty cart, which is a plain pay-to-shop QR", () => {
    // Zero is not a bill. Neither the amount nor the nudge belongs on screen before anything
    // has been rung up — the note would then be permanent furniture on an idle till.
    const { text } = render(<UpiQrPreview store={effectiveStore({})} amount={0} />);
    expect(text).toContain("Scan to Pay ·");
    expect(text).not.toContain("₹0");
    expect(text).not.toContain("has to enter");
  });
});

describe("receiptHtml — the QR caption", () => {
  it("prints the amount under the encoded QR", () => {
    const html = receiptHtml(SALE, effectiveStore(UPI), STAFF);
    expectRealReceipt(html);
    expect(html).toContain("Scan to Pay ₹500");
  });

  it("prints the amount under the static QR too", () => {
    const html = receiptHtml(SALE, effectiveStore({}), STAFF);
    expectRealReceipt(html);
    expect(html).toContain("Scan to Pay ₹500");
  });

  it("never invites a scan for ₹0", () => {
    // A bill settled entirely by a prepaid package or points. The encoded QR drops `am` at zero,
    // so a caption that printed it regardless would be asking for a payment that isn't owed.
    const free = { ...SALE, total: 0, lines: [{ ...SALE.lines[0], price: 0, amount: 0 }] };
    for (const store of [effectiveStore(UPI), effectiveStore({})]) {
      const html = receiptHtml(free, store, STAFF);
      expect(html).toContain("Haircut");
      expect(html).toContain("Scan to Pay ·");
      expect(html).not.toContain("Scan to Pay ₹0");
    }
  });
});

describe("effectiveStore — showStaffOnReceipt", () => {
  it("defaults to off for a config saved before the switch existed", () => {
    // The migration case: no key at all. It must not read as "unset => show", which is what the
    // receipt did before this setting was added.
    expect(effectiveStore({}).showStaffOnReceipt).toBe(false);
    expect(STORE.showStaffOnReceipt).toBe(false);
  });

  it("is a real boolean, never whatever was stored", () => {
    // `=== true`, not a truthy read: RTDB hands back exactly what was written, and a stray
    // string would otherwise switch the salon's receipts on by accident.
    expect(effectiveStore({ showStaffOnReceipt: true }).showStaffOnReceipt).toBe(true);
    expect(effectiveStore({ showStaffOnReceipt: false }).showStaffOnReceipt).toBe(false);
    expect(effectiveStore({ showStaffOnReceipt: "yes" }).showStaffOnReceipt).toBe(false);
    expect(effectiveStore({ showStaffOnReceipt: 1 }).showStaffOnReceipt).toBe(false);
  });
});
