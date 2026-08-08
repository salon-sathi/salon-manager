// First-run catalogues, built once at module load.

import { buildProducts, buildServices, buildStaff, buildTemplates } from "../seed.js";
import { todayStr, uid } from "./format.js";
import { iconFor } from "./inventory.js";

// The opening product shelf: retail lines a salon actually resells, plus the backbar stock it
// consumes while working. Built in src/lib/seed.js so the data stays pure and testable.
// Every item starts at 0 stock — the salon counts its real opening stock in.
const SEED_ITEMS = buildProducts({ uid, today: todayStr(), iconFor });

// The opening service menu, sample stylists and reminder templates. Same first-run-only
// discipline as the product shelf: written once when the slice is empty, never on top of a
// salon that has already edited its own menu.
const SEED_SERVICES = buildServices({ uid, today: todayStr() });
const SEED_STAFF = buildStaff({ uid, today: todayStr() });
const SEED_TEMPLATES = buildTemplates({ uid, today: todayStr() });


export { SEED_ITEMS, SEED_SERVICES, SEED_STAFF, SEED_TEMPLATES };
