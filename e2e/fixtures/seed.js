/**
 * Fixtures for the end-to-end suite: the staff roster, and the emulator plumbing to put it
 * there.
 *
 * Everything here talks to the Firebase emulator over its REST API rather than through the
 * client SDK. That is deliberate — seeding through the SDK would go through
 * database.rules.json, which means the fixture could only create state the rules already
 * allow, and a rule change would surface as a confusing setup failure rather than a test
 * failure. `Authorization: Bearer owner` is the emulator's documented admin escape hatch and
 * is the REST equivalent of the `withSecurityRulesDisabled` that tests/rules/setup.js uses.
 *
 * NEVER point this at a real project. Every run wipes the whole database namespace and every
 * account in the auth emulator.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const FIREBASE_MODULE = path.join(REPO_ROOT, "src", "lib", "firebase.js");

// ---- where the emulator is -----------------------------------------------------------
// Defaults match firebase.json, which stays the source of truth for the ports (see
// CLAUDE.md, "Emulator ports"). The overrides exist so CI can move them if 9000/9099 are
// taken on a runner.
export const HOST = process.env.E2E_EMULATOR_HOST || "127.0.0.1";
export const AUTH_PORT = Number(process.env.E2E_AUTH_PORT || 9099);
export const DB_PORT = Number(process.env.E2E_DB_PORT || 9000);

/**
 * The project id and database namespace, read out of src/lib/firebase.js at run time.
 *
 * These are NOT copied here, on purpose. The emulator serves whatever namespace it is asked
 * for and creates it on demand, so a stale copy would not error — it would seed an empty
 * namespace next to the one the app is actually reading. The app would then find shop/users
 * missing and BOOTSTRAP the first account that signs in as an owner (see RoleGate in
 * salon-manager.jsx), so a "sign in as biller" spec would quietly get owner rights and its
 * assertions about what a biller cannot reach would pass for the wrong reason.
 *
 * Parsing the real module means a changed databaseURL fails loudly here instead.
 */
function appConfig() {
  const src = fs.readFileSync(FIREBASE_MODULE, "utf8");
  const field = (name) => {
    const m = src.match(new RegExp(`\\b${name}:\\s*"([^"]+)"`));
    if (!m) throw new Error(`e2e/fixtures/seed.js: could not find \`${name}\` in ${FIREBASE_MODULE}. If the Firebase config moved or changed shape, update this parser.`);
    return m[1];
  };
  const databaseURL = field("databaseURL");
  // https://<namespace>.<region>.firebasedatabase.app → the first label is the namespace,
  // which is what connectDatabaseEmulator keeps when it swaps in the emulator's host:port.
  const namespace = new URL(databaseURL).hostname.split(".")[0];
  return { projectId: field("projectId"), databaseURL, namespace };
}

export const { projectId: PROJECT_ID, namespace: DB_NAMESPACE } = appConfig();

// ---- the roster ----------------------------------------------------------------------
// One account per role. The shape matches what the app itself writes (RoleGate's bootstrap
// write and Settings → Users) and what database.rules.json validates: email/role/active are
// required, and `$other: false` means no key outside this set is allowed.
//
// These accounts exist ONLY in the auth emulator, and that is the suite's real safety net —
// see the emulator block in src/lib/firebase.js. Do not create them in the live project.
export const PASSWORD = "e2e-password-not-a-secret";

// An account with no `role` is created in the auth emulator but deliberately left OUT of
// shop/users — that is the only way to reach the "not invited" branch of RoleGate, which is
// what a real ex-employee or a stranger with a Google account actually hits.
export const ACCOUNTS = {
  owner: { email: "owner@e2e.salon.test", name: "E2E Owner", role: "owner", active: true },
  biller: { email: "biller@e2e.salon.test", name: "E2E Biller", role: "biller", active: true },
  inventory: { email: "stock@e2e.salon.test", name: "E2E Stock", role: "inventory", active: true },
  stranger: { email: "stranger@e2e.salon.test" },
  deactivated: { email: "gone@e2e.salon.test", name: "E2E Former Staff", role: "biller", active: false },
};

// ---- emulator REST -------------------------------------------------------------------

const authBase = `http://${HOST}:${AUTH_PORT}`;
// `p` is a path with NO leading slash; the slash belongs to the template so that the root
// (p = "") comes out as "/.json" rather than gluing ".json" onto the port number.
const dbUrl = (p = "") => `http://${HOST}:${DB_PORT}/${p}.json?ns=${DB_NAMESPACE}`;
// The emulator accepts this literal string in place of an admin credential; it bypasses the
// rules exactly as the Admin SDK would.
const ADMIN = { Authorization: "Bearer owner" };

async function ok(res, what) {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  return res;
}

/** True once the emulators answer. Used by the Playwright config to fail with advice. */
export async function emulatorsReachable() {
  try {
    // The database side probes the ROOT. `.info/serverTimeOffset` looks like the natural
    // health check but it is a client-SDK virtual node with no REST representation — the
    // emulator answers it 400, which reads as "emulator down" when it is up and fine.
    const [a, d] = await Promise.all([
      fetch(`${authBase}/emulator/v1/projects/${PROJECT_ID}/config`),
      fetch(dbUrl(), { headers: ADMIN }),
    ]);
    return a.ok && d.ok;
  } catch {
    return false;
  }
}

/** Delete every account in the auth emulator for this project. */
export async function resetAuth() {
  await ok(
    await fetch(`${authBase}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" }),
    "clearing the auth emulator"
  );
}

/** Delete the whole database namespace. */
export async function resetDatabase() {
  await ok(await fetch(dbUrl(), { method: "DELETE", headers: ADMIN }), "clearing the database emulator");
}

/** Create one account and return its uid. */
async function createAccount(email, password) {
  // The emulator ignores the api key but the endpoint still requires the parameter.
  const res = await ok(
    await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }),
    `creating ${email}`
  );
  const { localId } = await res.json();
  return localId;
}

/** Write arbitrary fixture data, bypassing the rules. */
export async function seed(dbPath, value) {
  await ok(
    await fetch(dbUrl(dbPath), { method: "PUT", headers: { ...ADMIN, "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    `seeding ${dbPath}`
  );
}

/** Delete one path, bypassing the rules. Used to reset a single slice between tests. */
export async function clearPath(dbPath) {
  await ok(await fetch(dbUrl(dbPath), { method: "DELETE", headers: ADMIN }), `clearing ${dbPath}`);
}

/** Records → the `{ id: record }` map shape every slice is stored as (see sync.js toMap). */
export const toMap = (records) => Object.fromEntries(records.map((r) => [r.id, r]));

/** Read back through the admin credential, to check what a write actually did. */
export async function readAsAdmin(dbPath) {
  const res = await ok(await fetch(dbUrl(dbPath), { headers: ADMIN }), `reading ${dbPath}`);
  return res.json();
}

/**
 * Wipe both emulators and put the roster back.
 *
 * @returns {Promise<Record<string, {uid: string, email: string, password: string, role: string}>>}
 *   the roster keyed by role, with the uid the auth emulator assigned.
 */
export async function seedRoster() {
  await Promise.all([resetAuth(), resetDatabase()]);

  const entries = await Promise.all(
    Object.entries(ACCOUNTS).map(async ([key, account]) => {
      const uid = await createAccount(account.email, PASSWORD);
      return [key, { ...account, uid }];
    })
  );
  const roster = Object.fromEntries(entries);

  const staff = Object.values(roster).filter((r) => r.role);

  const users = {};
  for (const { uid, email, name, role, active } of staff) {
    users[uid] = { email, name, role, active, createdAt: "2026-01-01" };
  }
  await seed("shop/users", users);

  // Read it back through the SAME namespace the app will use. A namespace mismatch is the
  // one failure mode that would otherwise stay silent — the app would see no roster at all
  // and hand owner rights to whoever signed in first.
  const stored = await readAsAdmin("shop/users");
  const missing = staff.filter((r) => stored?.[r.uid]?.role !== r.role);
  if (missing.length) {
    throw new Error(`seedRoster: wrote shop/users to namespace "${DB_NAMESPACE}" but read back ${JSON.stringify(stored)}. Expected roles for ${missing.map((m) => m.uid).join(", ")}.`);
  }

  return roster;
}
