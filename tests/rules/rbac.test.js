/**
 * RBAC assertions against the real database.rules.json.
 *
 * The question every spec here answers is "what does the DATABASE allow", not "what does
 * the UI offer". src/lib/roles.js is the UI mirror and is tested separately; where the two
 * disagree, the divergence is called out in a comment and in the README.
 */
import { describe, it, expect } from "vitest";
import { ref, get, set } from "firebase/database";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  UID,
  asOwner,
  asBiller,
  asInventory,
  seed,
  readAsAdmin,
  useRulesHarness,
} from "./setup.js";

useRulesHarness();

const SALE_ID = "sale-001";
// The shape database.rules.json validates: id, date, total, lines. Written the way the app
// writes it (src/salon-manager.jsx billing save path), so a spec that changes one field is
// changing a record the rules would actually have accepted.
const BILLERS_SALE = {
  id: SALE_ID,
  date: "2026-02-01",
  total: 500,
  lines: { line1: { name: "Haircut", qty: 1, price: 500, amount: 500 } },
  createdBy: UID.biller,
  at: "2026-02-01T10:00:00.000Z",
};

const CUSTOMER_ID = "9990001111";
const CUSTOMER = { id: CUSTOMER_ID, phone: CUSTOMER_ID, name: "Asha", totalVisits: 0 };

/** The same record minus one field — how a malformed write is built here. */
const without = (rec, key) =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

describe("money slices are owner-only", () => {
  // #1
  it("denies a biller reading shop/expenses", async () => {
    await seed("shop/expenses", { exp1: { amount: 1200, note: "electricity" } });
    await assertFails(get(ref(asBiller(), "shop/expenses")));
  });

  // #2
  it("denies a biller reading shop/vendorBills", async () => {
    await seed("shop/vendorBills", { vb1: { vendor: "Loreal", amount: 8000 } });
    await assertFails(get(ref(asBiller(), "shop/vendorBills")));
  });
});

describe("stock", () => {
  // #3
  it("allows an inventory user to write shop/items/<id>", async () => {
    await assertSucceeds(
      set(ref(asInventory(), "shop/items/itm-1"), { name: "Shampoo", stock: 12, price: 450 }),
    );
  });

  // #4
  it("denies a biller writing shop/items/<id>", async () => {
    await assertFails(
      set(ref(asBiller(), "shop/items/itm-1"), { name: "Shampoo", stock: 12, price: 450 }),
    );
  });
});

describe("sales: create-only for workers", () => {
  // The rule on shop/sales/$id is:
  //   active user && ((!data.exists() && newData.exists()) || role === 'owner')
  // A worker rings a bill up and can never touch it again. Everything below is one half
  // of that sentence.

  // #5
  it("allows a biller to create a new bill — that is the POS", async () => {
    await assertSucceeds(set(ref(asBiller(), `shop/sales/${SALE_ID}`), BILLERS_SALE));
    expect(await readAsAdmin(`shop/sales/${SALE_ID}`)).toMatchObject({ total: 500 });
  });

  it("allows an inventory user to create a new bill too", async () => {
    await assertSucceeds(
      set(ref(asInventory(), "shop/sales/sale-inv"), { ...BILLERS_SALE, id: "sale-inv" }),
    );
  });

  // #6
  it("denies a biller deleting a bill", async () => {
    await seed(`shop/sales/${SALE_ID}`, BILLERS_SALE);
    await assertFails(set(ref(asBiller(), `shop/sales/${SALE_ID}`), null));
    // The bill is still there — the rule refused, it did not silently no-op.
    expect(await readAsAdmin(`shop/sales/${SALE_ID}`)).not.toBeNull();
  });

  // #7
  it("allows an owner deleting a bill", async () => {
    await seed(`shop/sales/${SALE_ID}`, BILLERS_SALE);
    await assertSucceeds(set(ref(asOwner(), `shop/sales/${SALE_ID}`), null));
    expect(await readAsAdmin(`shop/sales/${SALE_ID}`)).toBeNull();
  });

  // #8 — this assertion used to read ALLOW, and was documented in the README as a
  // divergence: the old rule said `newData.exists() || owner`, which gates deletes only.
  // Closing it is the whole point of the `!data.exists()` clause.
  it("denies a biller overwriting an existing bill", async () => {
    await seed(`shop/sales/${SALE_ID}`, BILLERS_SALE);
    await assertFails(
      set(ref(asBiller(), `shop/sales/${SALE_ID}`), { ...BILLERS_SALE, total: 50 }),
    );
    expect(await readAsAdmin(`shop/sales/${SALE_ID}/total`)).toBe(500);
  });

  it("denies a biller re-pricing one field of an existing bill", async () => {
    // The delta form the sync layer actually writes (buildSliceUpdate → `<id>/<field>`),
    // not just a whole-record overwrite. Both are edits and both are refused.
    await seed(`shop/sales/${SALE_ID}`, BILLERS_SALE);
    await assertFails(set(ref(asBiller(), `shop/sales/${SALE_ID}/total`), 50));
    expect(await readAsAdmin(`shop/sales/${SALE_ID}/total`)).toBe(500);
  });

  it("denies a biller overwriting a bill somebody else rang up", async () => {
    await seed(`shop/sales/${SALE_ID}`, { ...BILLERS_SALE, createdBy: UID.owner });
    await assertFails(
      set(ref(asBiller(), `shop/sales/${SALE_ID}`), { ...BILLERS_SALE, total: 1 }),
    );
  });

  it("allows an owner to edit an existing bill", async () => {
    await seed(`shop/sales/${SALE_ID}`, BILLERS_SALE);
    await assertSucceeds(
      set(ref(asOwner(), `shop/sales/${SALE_ID}`), { ...BILLERS_SALE, total: 450 }),
    );
    expect(await readAsAdmin(`shop/sales/${SALE_ID}/total`)).toBe(450);
  });

  it("allows an owner to update a single field of an existing bill", async () => {
    // Udhari settlement is exactly this shape: one field pushed onto a saved bill. It has
    // to keep working through the hasChildren validate, which sees the MERGED record.
    await seed(`shop/sales/${SALE_ID}`, BILLERS_SALE);
    await assertSucceeds(set(ref(asOwner(), `shop/sales/${SALE_ID}/paid`), 200));
    expect(await readAsAdmin(`shop/sales/${SALE_ID}`)).toMatchObject({ total: 500, paid: 200 });
  });
});

describe("sales: the record's shape is validated", () => {
  // .validate is not a permission check — it applies to the owner too, which is the point:
  // a malformed bill breaks every derived figure in the app (revenue, commission, points),
  // and the app has no running totals to repair it from.
  it("rejects a bill with no total, even from an owner", async () => {
    const noTotal = without(BILLERS_SALE, "total");
    await assertFails(set(ref(asOwner(), "shop/sales/sale-bad"), { ...noTotal, id: "sale-bad" }));
  });

  it("rejects a bill with no lines", async () => {
    const noLines = without(BILLERS_SALE, "lines");
    await assertFails(set(ref(asOwner(), "shop/sales/sale-bad"), { ...noLines, id: "sale-bad" }));
  });

  it("rejects a total that arrived as a string", async () => {
    await assertFails(
      set(ref(asOwner(), "shop/sales/sale-bad"), { ...BILLERS_SALE, id: "sale-bad", total: "500" }),
    );
  });

  it("rejects a date that isn't YYYY-MM-DD", async () => {
    for (const date of ["01-02-2026", "2026-2-1", "yesterday", ""]) {
      await assertFails(
        set(ref(asOwner(), "shop/sales/sale-bad"), { ...BILLERS_SALE, id: "sale-bad", date }),
      );
    }
  });

  it("rejects a bill created by a biller with a bad shape (validate outranks the create gate)", async () => {
    await assertFails(set(ref(asBiller(), "shop/sales/sale-bad"), { id: "sale-bad", total: 500 }));
  });

  it("accepts the shape the app actually writes", async () => {
    await assertSucceeds(
      set(ref(asBiller(), "shop/sales/sale-ok"), {
        ...BILLERS_SALE,
        id: "sale-ok",
        time: "10:04 AM",
        profit: 320,
        payment: "UPI",
        customerPhone: CUSTOMER_ID,
        pointsEarned: 5,
      }),
    );
  });
});

describe("customers: the record's shape is validated", () => {
  it("allows a biller to quick-create a customer at the till", async () => {
    await assertSucceeds(set(ref(asBiller(), `shop/customers/${CUSTOMER_ID}`), CUSTOMER));
  });

  it("rejects a customer with no name", async () => {
    await assertFails(
      set(ref(asBiller(), `shop/customers/${CUSTOMER_ID}`), without(CUSTOMER, "name")),
    );
  });

  it("rejects a blank name — the customer list would render an empty row", async () => {
    await assertFails(
      set(ref(asBiller(), `shop/customers/${CUSTOMER_ID}`), { ...CUSTOMER, name: "" }),
    );
  });

  it("rejects a customer with no id — nothing could find them again", async () => {
    await assertFails(
      set(ref(asBiller(), `shop/customers/${CUSTOMER_ID}`), without(CUSTOMER, "id")),
    );
  });

  it("still lets the reconcilers push a single derived field onto an existing customer", async () => {
    // recomputeStats writes totalVisits/totalSpend/lastVisitAt as deltas. The hasChildren
    // validate on the parent sees the merged record, so this must not trip it.
    await seed(`shop/customers/${CUSTOMER_ID}`, CUSTOMER);
    await assertSucceeds(set(ref(asBiller(), `shop/customers/${CUSTOMER_ID}/totalVisits`), 3));
  });

  it("still lets any active role delete a customer", async () => {
    await seed(`shop/customers/${CUSTOMER_ID}`, CUSTOMER);
    await assertSucceeds(set(ref(asBiller(), `shop/customers/${CUSTOMER_ID}`), null));
    expect(await readAsAdmin(`shop/customers/${CUSTOMER_ID}`)).toBeNull();
  });
});

describe("owner-only configuration", () => {
  // #8
  it("denies a biller writing shop/config", async () => {
    await assertFails(set(ref(asBiller(), "shop/config"), { name: "Pwned Salon" }));
  });

  // #9
  it("denies a biller writing another user's record", async () => {
    await assertFails(
      set(ref(asBiller(), `shop/users/${UID.stranger}`), {
        email: "mole@salon.test",
        role: "owner",
        active: true,
      }),
    );
    expect(await readAsAdmin(`shop/users/${UID.stranger}`)).toBeNull();
  });

  it("denies a biller promoting themselves to owner", async () => {
    await assertFails(
      set(ref(asBiller(), `shop/users/${UID.biller}`), {
        email: "biller@salon.test",
        role: "owner",
        active: true,
      }),
    );
    expect(await readAsAdmin(`shop/users/${UID.biller}/role`)).toBe("biller");
  });
});

describe("POS read dependencies", () => {
  // #10
  it("allows a biller to read shop/services and shop/customers", async () => {
    await seed("shop/services", { svc1: { name: "Haircut", price: 500 } });
    await seed("shop/customers", { cus1: { name: "Asha", phone: "9990001111" } });

    await assertSucceeds(get(ref(asBiller(), "shop/services")));
    await assertSucceeds(get(ref(asBiller(), "shop/customers")));
  });

  it("still denies a biller WRITING shop/services (read-only catalogue)", async () => {
    await assertFails(set(ref(asBiller(), "shop/services/svc1"), { name: "Free", price: 0 }));
  });
});
