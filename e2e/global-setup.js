/**
 * Runs once before the suite: check the emulators are up, then put the roster in place.
 *
 * The reachability check is here rather than left to a connection error inside the first
 * spec because the usual cause is environmental (no JVM, or the emulator not started) and
 * that reads as a mystifying auth timeout three layers down.
 */
import { DB_NAMESPACE, DB_PORT, HOST, PROJECT_ID, emulatorsReachable, seedRoster } from "./fixtures/seed.js";
import { seedSalon } from "./fixtures/salon.js";

export default async function globalSetup() {
  if (!(await emulatorsReachable())) {
    throw new Error(
      [
        `Firebase emulators are not answering on ${HOST} (auth 9099, database ${DB_PORT}).`,
        "",
        "Run the suite through `npm run test:e2e`, which starts them via `firebase emulators:exec`.",
        "If that command stops at \"Could not spawn 'java -version'\", or says firebase-tools no",
        "longer supports Java before 21, put a JRE 21+ on PATH — the Realtime Database emulator",
        "is a JAR. (The auth emulator is Node and starts without one, which is why sign-in can",
        "appear to work while every database read hangs at \"Checking your access…\".)",
      ].join("\n")
    );
  }

  // Order matters: seedRoster() wipes the database, so the shop has to go in after it.
  const roster = await seedRoster();
  await seedSalon();
  console.log(`[e2e] seeded ${Object.keys(roster).length} accounts into project "${PROJECT_ID}", namespace "${DB_NAMESPACE}"`);
}
