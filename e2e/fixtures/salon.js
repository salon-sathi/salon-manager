/**
 * The shop the specs run against: a fixed menu and a fixed pair of stylists.
 *
 * Ids are literals, not generated, so a spec can name a record without first reading it back.
 *
 * Seeding these two slices also stops the app seeding them itself. `SEEDERS` in the shell
 * writes SEED_SERVICES/SEED_STAFF the first time it sees the slice come back `null`, which
 * would hand the diary ~9 stylists and ~60 services with generated ids and today's date on
 * them — different data on a different day, and nothing a spec could point at.
 *
 * The durations are the load-bearing part. 45 and 15 minutes against the 15-minute grid make
 * "a haircut fills three slots" arithmetic the conflict specs can state exactly.
 */
import { seed, toMap } from "./seed.js";

export const STAFF = {
  asha: {
    id: "e2e-staff-asha",
    name: "Asha",
    role: "Stylist",
    color: "#C2185B",
    phone: "",
    commissionPctDefault: 10,
    active: true,
    createdAt: "2026-01-01",
  },
  ravi: {
    id: "e2e-staff-ravi",
    name: "Ravi",
    role: "Stylist",
    color: "#1565C0",
    phone: "",
    commissionPctDefault: 10,
    active: true,
    createdAt: "2026-01-01",
  },
};

// Names are prefixed so they cannot be confused with the app's own seed menu in a failure
// screenshot, and none is a substring of another — a checkbox picked by name has to be
// unambiguous.
export const SERVICES = {
  haircut: {
    id: "e2e-svc-haircut",
    name: "E2E Haircut",
    category: "Hair",
    durationMin: 45,
    price: 500,
    commissionPct: 10,
    rebookCycleDays: 30,
    active: true,
    icon: "",
    createdAt: "2026-01-01",
  },
  threading: {
    id: "e2e-svc-threading",
    name: "E2E Threading",
    category: "Threading & Waxing",
    durationMin: 15,
    price: 60,
    commissionPct: 10,
    rebookCycleDays: 21,
    active: true,
    icon: "",
    createdAt: "2026-01-01",
  },
  colour: {
    id: "e2e-svc-colour",
    name: "E2E Colour",
    category: "Colour",
    durationMin: 60,
    price: 1200,
    commissionPct: 12,
    rebookCycleDays: 45,
    active: true,
    icon: "",
    createdAt: "2026-01-01",
  },
};

// One retail line, so a bill can mix a service with a product. Seeded for the same reason as
// the menu: leave `items` empty and the shell's SEEDERS fill it with ~60 generated products.
export const ITEMS = {
  shampoo: {
    id: "e2e-item-shampoo",
    name: "E2E Shampoo",
    category: "Hair Care",
    unit: "btl",
    buyPrice: 200,
    sellPrice: 350,
    mrp: 350,
    stock: 10,
    lowAt: 3,
    stockType: "retail",
    batches: [],
    icon: "",
    createdAt: "2026-01-01",
  },
};

// ---- customers and packages ----------------------------------------------------------
// Both are RECONCILED slices: the shell recomputes loyaltyPoints/tier (reconcileLoyalty) and
// usesLeft (reconcilePackages) from the bills on every sync. So the numbers written here are
// only a starting point — a spec asserting them has to assert what the bills imply, not what
// the fixture said. That is the app's central invariant, not an inconvenience.

/** Local YYYY-MM-DD. The app's dates are local, never UTC timestamps. */
export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const CUSTOMERS = {
  meera: {
    id: "9876500001",
    phone: "9876500001",
    name: "E2E Meera",
    gender: "",
    dob: "",
    anniversary: "",
    notes: "",
    tags: [],
    createdAt: "2026-01-01",
    // Denormalized and always recomputed — seeded at zero so a spec that sees a number knows
    // the app put it there.
    totalVisits: 0,
    totalSpend: 0,
    lastVisitAt: "",
    loyaltyPoints: 0,
    tier: "",
  },
};

/** A prepaid course of haircuts for Meera. Dated relative to today so it never lapses. */
export const CUSTOMER_PACKAGES = {
  haircuts: {
    id: "e2e-cp-haircuts",
    packageId: "e2e-pkg-haircuts",
    customerPhone: CUSTOMERS.meera.phone,
    name: "E2E 3 Haircuts",
    serviceIds: [SERVICES.haircut.id],
    totalUses: 3,
    usesLeft: 3,
    pricePaid: 1200,
    purchasedAt: todayISO(-1),
    expiresAt: todayISO(90),
  },
};

/**
 * A bill in the shape the till writes, for seeding history a spec needs but should not spend
 * a minute ringing up. `pointsEarned` is the loyalty ledger — the balance IS the sum of these
 * across a customer's bills, so seeding it directly is seeding the ledger, not faking a total.
 */
export const priorSale = ({ id, phone, total, pointsEarned = 0, date = todayISO() }) => ({
  id,
  date,
  time: "12:00 PM",
  lines: [{ name: "E2E Past Visit", qty: 1, unit: "job", price: total, buyPrice: 0, amount: total, lineType: "service" }],
  total,
  profit: total,
  payment: "Cash",
  customerPhone: phone,
  customer: CUSTOMERS.meera.name,
  mobile: phone,
  ...(pointsEarned > 0 ? { pointsEarned } : {}),
});

/** Write the menu, the roster and the shelf. Called once from global setup. */
export async function seedSalon() {
  await Promise.all([
    seed("shop/staff", toMap(Object.values(STAFF))),
    seed("shop/services", toMap(Object.values(SERVICES))),
    seed("shop/items", toMap(Object.values(ITEMS))),
  ]);
}

/** The reconciled slices, reset per test because the app rewrites them. */
export async function seedCustomers() {
  await seed("shop/customers", toMap(Object.values(CUSTOMERS)));
}

export async function seedCustomerPackages(packages = Object.values(CUSTOMER_PACKAGES)) {
  await seed("shop/customerPackages", toMap(packages));
}

/** The shelf, resettable per test — billing depletes it. Pass overrides to set up a scenario. */
export async function seedItems(items = Object.values(ITEMS)) {
  await seed("shop/items", toMap(items));
}
