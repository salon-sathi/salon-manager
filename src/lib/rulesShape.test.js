// Structural assertions about database.rules.json, runnable with NO emulator and NO Java.
//
// tests/rules/** is the real proof: it runs the rules inside the emulator and asserts what each
// actor can actually do. But it needs Java 21+ on PATH, so it is NOT part of `npm test` and
// therefore not part of CI — which means the deploy path has never had anything at all to say
// about the access boundary. On a machine without a JVM, a change to this file ships unexamined.
//
// This file is the cheap half of that: it parses the rules as data and pins the handful of
// properties whose failure would be a breach rather than a bug. It cannot tell you a rule
// EVALUATES correctly — only tests/rules/** can — but it can tell you that the public booking
// surface has not quietly grown, which is the failure mode with the worst blast radius and the
// one most likely to arrive as a careless edit months from now.
//
// If this file and tests/rules/** ever disagree, tests/rules/** is right.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const RAW = readFileSync(path.join(REPO_ROOT, "database.rules.json"), "utf8");

// RTDB allows // comments and strips them on deploy; JSON.parse does not. Only whole-line
// comments are stripped, which is how they are written in that file — a mid-line strip would
// cut through the `https://` in any URL a rule ever gains.
const RULES = JSON.parse(RAW.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")).rules;
const SHOP = RULES.shop;

/** The three role shapes the file spells out inline, because RTDB rules have no functions. */
const ACTIVE = "auth != null && root.child('shop/users').child(auth.uid).child('active').val() === true";
const OWNER =
  "auth != null && root.child('shop/users').child(auth.uid).child('role').val() === 'owner' && root.child('shop/users').child(auth.uid).child('active').val() === true";

/** Every `.read` / `.write` string anywhere in the tree, with the path it sits at. */
function* accessRules(node = RULES, at = "/") {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === ".read" || key === ".write") yield { at, key, value };
    else if (typeof value === "object") yield* accessRules(value, at === "/" ? `/${key}` : `${at}/${key}`);
  }
}

/**
 * Split a rule expression on TOP-LEVEL `||`, respecting parentheses and quotes.
 *
 * A rule is not one condition: `shop/publicBookings/$id` grants staff and the street in a single
 * expression, while `shop/sales/$id` has an inner `||` that is entirely inside an `auth != null`
 * guard. Searching the whole string for "auth" cannot tell those apart — the first has a genuinely
 * unauthenticated branch and the second does not — so each branch has to be looked at on its own.
 */
function orBranches(expr) {
  const out = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "|" && expr[i + 1] === "|" && depth === 0) {
      out.push(expr.slice(start, i));
      i++;
      start = i + 1;
    }
  }
  out.push(expr.slice(start));
  return out.map((s) => s.trim().replace(/^\(([\s\S]*)\)$/, "$1").trim());
}

/** Every write path with at least one branch that does NOT require a signed-in user. */
const streetWritable = () =>
  [...accessRules()]
    .filter((r) => r.key === ".write" && typeof r.value === "string")
    .flatMap((r) => orBranches(r.value).filter((b) => !b.includes("auth")).map((branch) => ({ at: r.at, branch })));

describe("the shape of the access boundary", () => {
  it("parses — comments and all", () => {
    expect(RULES).toBeTruthy();
    expect(SHOP).toBeTruthy();
  });

  it("denies the root outright, and anything under shop/ that is not named", () => {
    expect(RULES[".read"]).toBe(false);
    expect(RULES[".write"]).toBe(false);
    expect(SHOP.$other[".read"]).toBe(false);
    expect(SHOP.$other[".write"]).toBe(false);
  });

  it("has exactly ONE world-readable subtree, and it is shop/public", () => {
    // `.read: true` anywhere else is a data leak. This is the assertion that would have caught
    // it if the booking projection had been hung off a node that also carries a phone number.
    const worldReadable = [...accessRules()].filter((r) => r.key === ".read" && r.value === true);
    expect(worldReadable.map((r) => r.at)).toEqual(["/shop/public"]);
  });

  it("keeps the customer inbox readable by staff only — it holds a name and a phone", () => {
    expect(SHOP.publicBookings[".read"]).toBe(ACTIVE);
    expect(SHOP.publicBookings[".write"]).toBeUndefined(); // create-only, per record
  });

  it("gives the street exactly two write paths, both create-only and both kill-switched", () => {
    const KILL = "root.child('shop/public/profile/enabled').val() === true";
    const street = streetWritable();

    // Adding a third is not necessarily wrong — but it is never an accident, and it should not
    // be possible to do it without this line turning red.
    expect(street.map((r) => r.at).sort()).toEqual([
      "/shop/public/slots/$date/$id",
      "/shop/publicBookings/$id",
    ]);

    for (const { at, branch } of street) {
      // Not create-only means anyone can rewrite or delete somebody else's booking.
      expect(branch, `${at} must be create-only`).toContain("!data.exists()");
      expect(branch, `${at} must be create-only`).toContain("newData.exists()");
      // …and the owner must be able to stop all of it from Settings, at the DATABASE — not
      // merely have the button disappear from a page that is already open.
      expect(branch, `${at} must honour the kill switch`).toContain(KILL);
    }
  });

  it("does not mistake an inner `||` for an unauthenticated branch", () => {
    // Guards the guard. shop/sales/$id is `auth != null && active && (create || owner)` — the
    // whole thing is behind auth, and a checker that searched the raw string would say so too.
    // shop/publicBookings/$id really does have a public branch beside its staff one, and a
    // checker that only looked for a missing "auth" anywhere would miss it.
    expect(orBranches(SHOP.sales.$id[".write"]).filter((b) => !b.includes("auth"))).toEqual([]);
    expect(orBranches(SHOP.users.$uid[".write"]).filter((b) => !b.includes("auth"))).toEqual([]);
    expect(orBranches(SHOP.publicBookings.$id[".write"]).filter((b) => !b.includes("auth"))).toHaveLength(1);
  });

  it("locks the shape of everything the street can write", () => {
    // Without $other: false a booking is an unbounded write into a node anyone can reach.
    expect(SHOP.publicBookings.$id.$other[".validate"]).toBe(false);
    expect(SHOP.public.slots.$date.$id.$other[".validate"]).toBe(false);
    // The server's clock, not the customer's — and not a tolerance window either.
    expect(SHOP.publicBookings.$id.createdAtMs[".validate"]).toContain("newData.val() === now");
    expect(SHOP.public.slots.$date.$id.createdAtMs[".validate"]).toContain("newData.val() === now");
    // A delete writes null and .validate never runs on a node being removed.
    expect(SHOP.publicBookings.$id[".validate"]).toContain("!newData.exists() ||");
  });

  it("leaves shop/appointments exactly as it was — no public branch anywhere near the diary", () => {
    // The whole reason the customer's write went to a separate node. .write rules cascade and
    // only ever GRANT, so a $id rule here could not restrict staff, only add a public branch.
    expect(SHOP.appointments).toEqual({ ".read": ACTIVE, ".write": ACTIVE });
  });

  it("keeps the projection owner-written, matching the nodes it is derived from", () => {
    for (const child of ["profile", "services", "chairs"]) {
      expect(SHOP.public[child][".write"], `shop/public/${child}`).toBe(OWNER);
    }
    // Occupancy comes from the diary, which every active role writes.
    expect(SHOP.public.slots[".write"]).toBe(ACTIVE);
  });

  it("still gates every money node on the owner, and the diary on an active user", () => {
    // A regression here would not be about booking at all — which is exactly why it is pinned
    // alongside it, in the one rules check that runs on the deploy path.
    for (const slice of ["expenses", "vendorBills", "dailyBills"]) {
      expect(SHOP[slice][".read"], slice).toBe(OWNER);
      expect(SHOP[slice][".write"], slice).toBe(OWNER);
    }
    for (const slice of ["config", "services", "staff", "packages", "messageTemplates"]) {
      expect(SHOP[slice][".write"], slice).toBe(OWNER);
      expect(SHOP[slice][".read"], slice).toBe(ACTIVE);
    }
    expect(SHOP.sales.$id[".write"]).toContain("!data.exists() && newData.exists()");
  });

  it("never lets an unauthenticated reader at anything with a customer in it", () => {
    for (const slice of ["appointments", "customers", "sales", "logs", "customerPackages", "publicBookings", "users", "config"]) {
      const read = SHOP[slice]?.[".read"];
      expect(read, `shop/${slice} must not be world-readable`).not.toBe(true);
      expect(String(read), `shop/${slice} must require auth`).toContain("auth != null");
    }
  });
});
