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
import { describe, expect, it } from "vitest";
import { receiptHtml } from "./receipt.jsx";
import { STORE, effectiveStore } from "../lib/ui/store.js";

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
