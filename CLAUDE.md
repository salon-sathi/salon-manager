# CLAUDE.md

Salon Manager — React + Vite SPA on Firebase Realtime Database. See the
[README](README.md) for the product-level picture; this file covers what's easy to get
wrong when working in the repo.

## Commands

| Command | What it runs |
|---|---|
| `npm run dev` | Vite dev server on 5173 |
| `npm test` | the pure-lib + jsdom suites (`src/**`). No emulator, no Java. This is what CI runs. |
| `npm run test:rules` | the security-rules suite (`tests/rules/**`) against the Firebase emulator |
| `npm run test:e2e` | the Playwright end-to-end suite (`e2e/**`) — real Chromium, real app, emulator data. CI runs it in its own workflow ([`e2e.yml`](.github/workflows/e2e.yml)), never on the deploy path. |
| `npm run build` | production build (Pages base path `/salon-manager/`) |
| `npm run lint` / `npm run format` | ESLint / Prettier |

`npm test` and `npm run test:rules` are **separate on purpose** — see below.

## Where things live

`salon-manager.jsx` used to be the whole app — 10,111 lines, every screen in one file. It is
now the **shell only** (~920 lines): sign-in, the role gate, the sync wiring, the seeders, the
nav and the view switch.

| Where | What |
|---|---|
| `src/salon-manager.jsx` | the shell. Keep it under ~1,500 lines. |
| `src/views/<Name>.jsx` | one screen per file, `export default` the component the switch renders. |
| `src/components/*.jsx` | UI shared by more than one view. |
| `src/lib/ui/*.js` | shared non-React UI logic: formatting, the theme/store config, the nav map, stock arithmetic, the stylesheet. |
| `src/lib/*.js` | unchanged — pure domain logic, no React. |

**Every view is `React.lazy`.** The switch in the shell holds a `lazy(() => import(...))` per
screen and one `<Suspense>` around the rendered view, so the counter tablet downloads the till
and the diary and never pays for the stats charts or the barcode generator. `vite build` should
print one chunk per view; if a view's code turns up in `index-*.js` instead, something imported
it eagerly.

**Three rules that keep it that way:**

1. **No view imports another view.** Anything two screens need moves to `components/` or
   `lib/ui/` — that is what those directories are for. A view→view import silently merges two
   chunks and can make a cycle the build won't always warn about.
2. **Nothing under `views/`, `components/` or `lib/` imports `salon-manager.jsx`.** The shell
   is the top of the graph.
3. **`eslint` cannot see a missing component.** `no-undef` works on identifiers, and `<Header/>`
   is a JSXIdentifier — a component used only in JSX and never imported passes lint and throws
   at render. If you move a component between files, the check that catches it is running the
   app (or a jsdom suite that mounts the view), not the linter.

The four full-app jsdom suites call `preloadViews()` — an `import.meta.glob` over `src/views/`
— before mounting. Without it `React.lazy` races a real dynamic import inside `act()`, which no
number of ticks reliably wins: loading a module is file I/O, not a queued task. It also means
every view module is *evaluated* in those suites, so a module-init error in any screen fails
the suite the same way `app.smoke.test.jsx` catches one in the shell.

## The service worker

Hand-rolled, ~90 lines, no Workbox and no `vite-plugin-pwa`. Its whole job is to make the app
**shell** open with no network; data offline is unchanged (the `localStorage` snapshot, and a
write attempted offline still hits the hard-stop modal).

| Where | What |
|---|---|
| [`scripts/sw.js`](scripts/sw.js) | the worker — a **template**, with three placeholders |
| [`scripts/vite-pwa-plugin.js`](scripts/vite-pwa-plugin.js) | fills them in at build time and emits `dist/sw.js` |
| [`src/lib/ui/swUpdate.js`](src/lib/ui/swUpdate.js) | registration (production only) + the update signal |
| [`public/manifest.webmanifest`](public/manifest.webmanifest) | install metadata; **relative** paths, so it works at `/` and at `/salon-manager/` |
| [`scripts/make-icons.mjs`](scripts/make-icons.mjs) | run by hand when the logo changes; drives headless Chrome, commits `public/icon-{192,512}.png` |

**The precache list is generated, and has to be.** Every asset is content-hashed, so a
hand-written list is wrong the moment anything changes — and wrong in the worst way, because
`cache.addAll` rejects on a single 404 and the install fails silently for everyone on that
build. Substitution is **textual**, so don't write `__PRECACHE__` / `__INDEX__` / `__VERSION__`
anywhere else in `sw.js`, comments included (a single-occurrence `.replace` already patched a
comment once and left the real constant undefined).

**Never cache a Firebase response.** `FIREBASE_HOSTS` bypasses the cache entirely for RTDB,
auth, Storage and gstatic. A cached read here is a *wrong* read — the app is built on live
snapshots, and a diary serving yesterday's bookings is worse than one that says "offline".
Pinned by `scripts/vite-pwa-plugin.test.js`, along with "no `skipWaiting()` on install".

**Only the shell is precached** (index, the entry chunk, react, firebase, the logo, the
manifest). The lazy view chunks, pdfjs and xlsx are cached when first fetched — precaching them
would make a first visit download the whole app before the till could open.

`vite preview` needs `isPreview` in `vite.config.js` to serve at `/salon-manager/`. Without it
the built app is served at `/` while its own HTML asks for `/salon-manager/…`, every asset falls
through to the SPA fallback, and the manifest and worker both arrive as `text/html` — which
reads as a broken PWA rather than a base-path mistake.

## The vendored xlsx tarball

`xlsx` (SheetJS) is **not on the npm registry**. It used to be installed straight from the
publisher's CDN — `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` — which meant
`npm ci` reached a host that isn't the registry, with whatever that host served at the time.
The tarball is now committed at [`vendor/xlsx-0.20.3.tgz`](vendor/xlsx-0.20.3.tgz) and the
dependency reads `file:vendor/xlsx-0.20.3.tgz`.

The committed file is **byte-identical** to what the CDN served: its sha512 matches the
`integrity` the old lockfile had already pinned, and that same hash is what the new lockfile
carries — so `npm ci` still verifies it, it just verifies a file that's in the repo.

**Upgrading it** (SheetJS publishes versions, never a range):

```bash
curl -fsSLO https://cdn.sheetjs.com/xlsx-<new>/xlsx-<new>.tgz   # into vendor/
git rm vendor/xlsx-<old>.tgz
# package.json → "xlsx": "file:vendor/xlsx-<new>.tgz"
npm install --package-lock-only && npm ci && npm test && npm run build
```

Keep the version in the **filename** — `file:vendor/xlsx.tgz` would make a version bump an
invisible content change to a binary blob. `*.tgz` is marked `binary` in `.gitattributes`;
this repo is checked out with `core.autocrlf=true`, and a mangled archive would only surface
as an integrity failure in CI.

## Security-rules tests

[`database.rules.json`](database.rules.json) is the real access boundary; `src/lib/roles.js`
is only the UI mirror of it. The rules are exercised by:

- [`tests/rules/setup.js`](tests/rules/setup.js) — harness: emulator wiring, the
  `asOwner()` / `asBiller()` / `asInventory()` / `asUnauth()` actors, `withSecurityRulesDisabled`
  seeding, and `useRulesHarness()` (clear + reseed per test, cleanup at the end).
- [`tests/rules/rbac.test.js`](tests/rules/rbac.test.js) — the role matrix.
- [`tests/rules/bootstrap.test.js`](tests/rules/bootstrap.test.js) — first-owner
  self-registration, lockdown once claimed, unauthenticated access, last-owner lockout.

Config lives in [`vitest.rules.config.js`](vitest.rules.config.js), not `vite.config.js`.

**Java 21+ must be on `PATH`** — the RTDB emulator is a JAR. Without it the command stops at
`Could not spawn 'java -version'`; with a JDK older than 21, `firebase-tools` (15.x) refuses
outright: *"firebase-tools no longer supports Java version before 21."* A JRE is enough, and
it only has to be on `PATH` for the emulator process — nothing in the app or the build needs
one.

### Emulator ports

Declared in [`firebase.json`](firebase.json). Change them there; the harness reads the
address `emulators:exec` exports and only falls back to these literals.

| Emulator | Port |
|---|---|
| Realtime Database | 9000 |
| Authentication | 9099 |
| Storage | 9199 |
| Emulator UI | 4000 |
| Emulator hub (CLI-assigned) | 4400 |

The test project id is `salon-manager-rules-test` and must match the `--project` flag in the
`test:rules` script — `singleProjectMode` is on, so a mismatch warns and reads the wrong
namespace. It is a throwaway id; never point these tests at a real project, because every
spec wipes the database in `beforeEach`.

### Two constraints that will bite

1. **`tests/rules/**` is excluded from `npm test`** (in `vite.config.js`). The pure-lib
   suites must stay runnable with no emulator and no Java — CI only runs `npm test`, and
   including the rules suite there would break the Pages deploy on any machine without a JVM.

2. **The rules suite must stay single-threaded.** The emulator is one shared, stateful
   process and every spec clears the whole database, so parallel spec files delete each
   other's fixtures mid-assertion. `vitest.rules.config.js` sets `fileParallelism: false` and
   `maxWorkers: 1`; both are required. (Vitest 4 removed `poolOptions.forks.singleFork` —
   these top-level options replace it. A stale `poolOptions` block is silently ignored, so
   the suite would still pass while running in parallel.)

Failures from breaking either look like flaky rules, not like a config problem — which is
what makes them expensive.

### Feature access (the owner's per-role switches)

Settings → Users & roles → **Feature access** lets the owner turn individual features on and off
for the `biller` and `inventory` roles. The choices live at `config.permissions` (a sparse map of
*what changed from the default*) and arrive as `can()`'s **third argument**.

**`GRANTABLE` in `roles.js` is derived from `database.rules.json`, not from taste.** The rules
hard-code `role === 'owner'` on the sensitive nodes, so a switch for anything outside that
envelope would open a screen whose every read comes back permission-denied — a toggle that looks
like it worked and fails at the counter. `can()` **intersects overrides with the envelope**, so
even a hand-edited `permissions` blob can't grant past the rules, and the owner is answered
before overrides are read at all. Adding a switch = check the rule in `database.rules.json`
first, then add the action to `GRANTABLE[role]`.

Three things that will bite:

1. **`can(role, action)` with no third argument silently ignores the owner's switches.** Inside
   `StoreManager` use `allow(action)`; elsewhere the component is handed `perms` next to `role`
   and calls `can(role, action, perms)`. A stray two-arg call is how a hidden tab ends up with a
   reachable view behind it — `permissions.integration.test.jsx` mounts the real app and checks
   the nav and the view guard *agree*.
2. **`sync.js` `readableSlices(role)` deliberately takes no overrides.** It only gates the money
   slices, and no money action is grantable — a test pins that. Put a money action in `GRANTABLE`
   and the subscription list quietly stops matching the permission matrix.
3. **A grantable action must not need an owner-only WRITE.** This is why `reminders.use`
   (sending) and `reminders.templates` (editing the templates, which writes an owner-only node)
   are separate actions, and why `SEEDERS.messageTemplates` gates on the latter.

### sales & customers: create-only, and shape-checked

`shop/sales/$id` is **create-only for a non-owner**:
`(!data.exists() && newData.exists()) || role === 'owner'`. It used to be
`newData.exists() || owner`, which gates deletes only — any active user could rewrite a saved
bill. Both slices also carry a `.validate` (sales: `id`/`date`/`total`/`lines`, with `total` a
number and `date` `YYYY-MM-DD`; customers: `id` + a non-empty `name`).

Three things this rests on:

1. **Field-level deltas still pass the `hasChildren` validate.** `buildSliceUpdate` writes
   `<id>/<field>` paths, and RTDB validates the *resulting* node — `newData` at `$id` is the
   merge of the delta with what is stored. Ancestor `.validate` rules ARE evaluated on a child
   write, which is what makes a one-field update of a well-formed record legal. A partial write
   that would *create* a record from a single field is not, which is fine: `buildSliceUpdate`
   writes new records whole.
2. **`.validate` never runs on a delete**, hence the `!newData.exists() ||` guard on both.
3. **`GRANTABLE` shrank with the rule.** `sales.edit` and `udhari.manage` were delegable
   *because* of the old hole (settling credit rewrites the bill the debt sits on). They are in
   `LOCKED_FEATURES` now. This is the envelope rule in action — a switch outside what the rules
   allow is a screen that fails at the counter.

### Known rule-vs-README divergence

Asserted as-is by the suite, so it documents real behaviour. Don't "fix" the test to match the
README:

- **The rules let the last active owner demote/deactivate/delete themselves.** The app
  refuses this; the rules cannot express it (RTDB has no way to count siblings matching a
  predicate). Closing it server-side needs a maintained counter node or a Cloud Function.

## End-to-end tests (Playwright)

`e2e/**` drives the **real app in a real Chromium** against the Firebase emulator. It covers
what jsdom structurally cannot: layout, the service worker, canvas/`foreignObject`
rasterization, print, and the actual `database.rules.json` boundary in the same request path
the salon uses.

| Where | What |
|---|---|
| [`playwright.config.js`](playwright.config.js) | runner config + the `webServer` that starts the dev server |
| [`e2e/global-setup.js`](e2e/global-setup.js) | reachability check, then seeds the roster once |
| [`e2e/fixtures/seed.js`](e2e/fixtures/seed.js) | emulator REST: wipe, create accounts, seed `shop/users` |
| [`e2e/fixtures/salon.js`](e2e/fixtures/salon.js) | the shop under test — two stylists, three services, fixed ids |
| [`e2e/fixtures/app.js`](e2e/fixtures/app.js) | `signIn()`, `navItem()`, console/exception watching |

The specs: `smoke` (the rig), `auth` (sign-in + the role gate), `appointments` (the diary and
its overlap check), `billing` (the money, print, and the receipt JPEG), `loyalty` (points,
tiers, prepaid packages), `inventory` (stock movement).

**Reconciled slices are reset per test, not per run.** `customers`, `customerPackages` and
`items` are all rewritten by the app — `reconcileLoyalty` and `reconcilePackages` recompute
loyalty points, tier and `usesLeft` from the bills on every sync, and billing depletes stock.
A spec that wants a known starting point has to reseed in `beforeEach`. It also means a
loyalty assertion must seed the **bills** and read the derived field: seeding `loyaltyPoints`
directly and reading it back would pass on an app that had quietly gone back to incrementing a
stored counter, which is the one regression this design exists to prevent.

```bash
npm run test:e2e          # headless, brings up the emulator itself
npm run test:e2e:ui       # time-travel UI — DOM snapshot per action
npm run test:e2e:headed   # visible browser
npm run test:e2e:report   # last HTML report
```

**Java 21+ must be on `PATH`**, same as the rules suite — the RTDB emulator is a JAR. The
*auth* emulator is Node and starts without one, which is the confusing part: sign-in appears
to work while every database read hangs at "Checking your access…". `global-setup.js` checks
both emulators up front and says so, rather than letting it surface as an auth timeout.

**The app has to be pointed at the emulator, and that is a code path, not a config file.**
`VITE_USE_EMULATORS=1` makes [`src/lib/firebase.js`](src/lib/firebase.js) call
`connectAuthEmulator`/`connectDatabaseEmulator`/`connectStorageEmulator`; without it the app
talks to the **live salon's project**. The flag is dead-code-eliminated from a production
build (the deploy workflow never sets it), but the flag is *not* what protects a test run —
the flag silently failing to arrive is the dangerous case. What protects it is that the e2e
accounts exist **only in the auth emulator**: point the suite at production and sign-in fails
on the first spec. Never create those accounts in the live project.

### Six things that will bite

1. **The suite runs on port 5174, and never reuses a running server.** `npm run dev` on 5173
   talks to production. `reuseExistingServer: true` plus a dev server someone left open is
   how a suite ends up writing real bills; the separate port removes the collision entirely.
2. **`--host 127.0.0.1` on the dev command is load-bearing.** Vite otherwise binds
   `localhost`, which resolves to `[::1]` **only** — a `127.0.0.1` baseURL then gets
   ECONNREFUSED inside `webServer`'s readiness check and the run dies before the first spec.
3. **`e2e/**` is excluded from `npm test`** (in `vite.config.js`). Vitest's default include
   matches `*.spec.js`, so without the exclusion it picks these up and fails on
   `import { test } from "@playwright/test"`. CI's deploy job runs `npm test`, so this
   exclusion is what keeps a browser suite off the Pages deploy path.
4. **One worker, and it has to stay that way.** The emulator is a single shared, stateful
   process and the fixtures wipe the whole database — parallel spec files delete each other's
   data mid-assertion. Same constraint as the rules suite, same reason.
5. **There are no routes.** Navigation is `tab` state in the shell, so nothing is
   deep-linkable: every spec signs in and clicks, and pays that cost. Sign-in state lives in
   **IndexedDB** (the Firebase SDK's default persistence), so switching role means a fresh
   browser context — clearing cookies and `localStorage` does *not* sign the previous user out.

6. **Assertions against the database must POLL.** Every slice write is debounced by 300ms
   (`setTimeout(() => pushSlice(…), 300)` in the shell) and then round-trips to the emulator,
   while the UI updates from React state at once. Reading `shop/<slice>` the moment a change
   appears on screen reads the state from *before* the write — which fails as stale data, or
   worse passes for a delete that had not happened yet. Use `expect.poll`, never a sleep. The
   same 300ms is why a spec that reloads the page has to wait for the write first, or it
   discards a record that only ever existed in React state.

**The receipt specs stub two browser APIs, and both stubs are load-bearing.**
`billing.spec.js` overrides `window.print` via `addInitScript` — which runs in *every* frame,
including the `srcdoc` print frame where `print()` is actually called — so the suite never
waits on headless Chromium's print implementation. It also stubs `navigator.share` /
`canShare`, which are absent in headless: without them `canShareImages()` is false and the
Share button never renders, so there is nothing to click. The stub captures the `File`'s first
bytes rather than just its existence, because a *tainted* canvas (any remote `<img>` inside
the SVG) makes `toBlob` throw and a blank render still encodes to a valid, tiny JPEG — the
`FF D8 FF` check plus a size floor is what separates "a Blob arrived" from "a receipt
arrived". Pinned by mutation: neutering `toXhtml` makes that spec fail.

**The database namespace is derived, not typed.** `seed.js` parses `databaseURL` out of
`src/lib/firebase.js` and takes its first hostname label — `salon-manager-49a88-default-rtdb`,
which is what `connectDatabaseEmulator` keeps when it swaps in the emulator's host:port
(verified against the SDK's actual `ns=` parameter). A hardcoded copy would not error if it
drifted: the emulator creates any namespace on demand, so the roster would land beside the one
the app reads, the app would find `shop/users` empty, and **whoever signed in first would be
bootstrapped as owner** — every role spec passing for the wrong reason. `seedRoster()` reads
back what it wrote, and `smoke.spec.js` asserts a biller *cannot* see the owner-only Settings
tab, which is the assertion that actually catches it.

**Selectors: roles and text first, `data-testid` only where text is ambiguous.** The nav
already exposes `aria-label` on every destination and the login fields are wrapped in their
`<label>`, so `getByRole`/`getByLabel` work without touching components. Adding testids
wholesale would mean editing all 22 views for no gain; add one only where a name genuinely
repeats (the calendar grid, duplicate "Save" buttons, the POS service tiles).

## Sending a bill on WhatsApp

One receipt layout, two deliveries. `receiptHtml()` in
[`src/components/receipt.jsx`](src/components/receipt.jsx) is the **single source** of receipt
markup; `printReceipt()` sends it to paper and `SendBillActions` rasterizes it to a JPEG. Anything added to one is in the other for free — that is the whole point of the
split, so don't inline receipt markup into a caller.

| Where | What |
|---|---|
| [`src/lib/receiptImage.js`](src/lib/receiptImage.js) | HTML → JPEG. SVG `<foreignObject>` → `<img>` → canvas. No dependency. |
| [`src/lib/receipts.js`](src/lib/receipts.js) | pure: the message, the `wa.me` link, the storage path |
| [`src/lib/receiptStorage.js`](src/lib/receiptStorage.js) | thin Storage adapter (upload/delete) |

**It's a JPEG, not a PDF, and that's load-bearing.** Every built-in PDF font encodes WinAnsi,
which has no `₹` (U+20B9) — and a Devanagari shop name needs Indic shaping on top. A PDF would
mean bundling font subsets, and the app has to work with the Wi-Fi off. Rasterizing hands text
shaping to the browser, which already has those fonts.

**Two rules the rasterizer cannot bend:**

1. **`<foreignObject>` content is parsed as XML, not HTML.** `&nbsp;` is a *fatal parse error*
   there and every void element must be self-closed. `toXhtml()` repairs both. A receipt that
   renders blank is almost always this.
2. **An SVG loaded through `<img>` fetches nothing external.** A remote `<img src>` inside it
   renders blank and taints the canvas, so `toBlob()` throws. This is why
   `receiptHtml(..., { forImage: true })` drops the two bundled `/public` assets — every image
   in the rasterized markup must be a `data:` URL.

Styling therefore hangs off **`.rcpt`, never `body`** — a foreignObject has no `body` element
for a `body {}` rule to land on, and a receipt styled through `body` rasterizes unpadded.

**Delivery is still a human pressing send**, exactly as in the reminder queue — no WhatsApp
Business API. A `wa.me` link cannot carry a file, which is why there are two buttons: *WhatsApp
bill* uploads the JPEG and sends its URL to the right customer's chat, and *Share bill* hands
the file to `navigator.share` (real inline image, works offline, but the user picks the chat).
The share button is hidden where `canShare({files})` is false — most desktops.

**A send failure is a modal, not a toast** (`SendFailedModal`, the same red hard-stop as a blocked
offline write). The salon otherwise walks away believing the customer has their bill, and the
message carries the fix — usually a shell command — which a toast that fades in three seconds is
the wrong place for. The upload is capped at 20s and, on failure, probes the bucket so "Storage
was never enabled" doesn't present as a generic timeout.

`shop/receipts/**` is **public-read** in [`storage.rules`](storage.rules): the customer opening
the link is not signed in and never will be. What protects a receipt is an unguessable URL —
Firebase's random download token, on a path keyed by **sale id, never the phone number**.
Nothing writes the uploaded URL back onto the sale; re-sending re-uploads to the same
deterministic path, for the same reason nothing in this app keeps a running total.

## Service icons

Split in two, on purpose:

| Where | What |
|---|---|
| [`src/lib/serviceIcons.js`](src/lib/serviceIcons.js) | the registry — `ICON_KEYS`, `KEYWORD_RULES`, `CATEGORY_FALLBACK`, `resolveIcon()`. Pure; no React. |
| [`src/components/ServiceIcon.jsx`](src/components/ServiceIcon.jsx) | the drawing — `<ServiceIcon>`, `<ServiceIconChip>`, `<ServiceIconDefs>`, `SERVICE_ICON_CSS`. Inline SVG only: no icon package, no image files, nothing fetched. |

**Resolve at render; never bake into the data.** An icon is worked out from the service's
*name* every time it is drawn. Nothing writes an icon on save, and `seed.js` must never gain an
icon-key field — that is what lets the keyword table be improved later and have every screen,
including a three-year-old restored backup, pick it up with no migration.

The one exception is the owner's override: **`service.icon`**, set in Settings → Services →
Edit, and an ordinary synced field (no special case in `mergeRemote`). `resolveIcon` honours it
first, but **only when it is a real icon key** — that same field has always held a decorative
*emoji* on seeded services (`"💇"`), and receipts still print that emoji. `isIconKey()` tells
the two apart; `serviceEmoji()` in `src/lib/salon.js` keeps bill lines on the emoji side.

Rule ORDER in `KEYWORD_RULES` is the whole design — "Hair Spa" is a hair treatment, not a spa;
"Nail Cut & File" is not a haircut; "Beard Colour" is not a hair colour. Every one of those is
pinned by a test, so reordering the table tells you immediately what it broke.

Mount points: POS picker (chip per service, 32px per category heading), appointment blocks
(14px, first service, only on blocks of ≥2 slots), Settings → Services, customer visit history.
**Not the thermal receipt** — print markup stays emoji and text. Icons are decorative
everywhere: `aria-hidden`, never a label; the service NAME is the accessible label.

### Theming

Two independent axes, both synced (shop-wide, owner-set in Settings) and both applied on the
`.app` root:

- **Colour** — `config.theme`, one of six palettes in `THEMES`, spread **inline** as CSS variables
  via `themeVars(store.theme)`.
- **Appearance** — `config.iconStyle` → `data-theme="advanced" | "basic"`. This is the **whole-app
  skin**, not just the icons: `advanced` is a dark glass-morphism theme (lit gradient backdrop,
  frosted panels, gilded service chips); `basic` is the original bright, flat look. (The config key
  is still `iconStyle` for backward-compat with saved settings; the UI calls it "Appearance".)

**The two layer, they don't fight.** `themeVars` sets `--brand`/`--ink`/`--nav-*`/`--app-bg`/
`--focus-ring` **inline**, and inline always beats a stylesheet rule — so the Advanced block can
**never** override those, and deliberately doesn't. Advanced defines only its *own* tokens
(`--bg-base`, `--glass-*`, `--accent`, `--surface`, `--text-*`, …) in the `[data-theme="advanced"]`
block in [`src/lib/ui/css.js`](src/lib/ui/css.js) (`themeVars` and `THEMES` live next door in
[`src/lib/ui/store.js`](src/lib/ui/store.js)). Result: the chosen colour palette still tints the accents showing
through the dark glass.

**Pixel-identical Basic is by construction.** Every themeable surface reads a token with its
*original* value as the fallback — `var(--surface, #fff)`, `var(--input-border, #D5E0D6)`, etc. In
`basic` those tokens are undefined, so every `var()` resolves to the original light value. Adding a
new advanced surface = tokenize the hardcoded value here with its original as the fallback, then
give the token a dark value in the `[data-theme="advanced"]` block. Never define these tokens at
`:root` (that would change Basic).

**Glass tokens are owned by the app, consumed by the icons.** `SERVICE_ICON_CSS`
(`components/ServiceIcon.jsx`) loads *after* the app CSS, so it must not redefine
`--accent`/`--glass-*` — it just consumes them (and keeps its own flat values under
`[data-theme="basic"]`). The four gradient defs are still mounted once, only under `advanced`.

**Blur budget.** `backdrop-filter` lives on exactly two still surfaces — the sidebar (`.nav`) and
the modal scrim (`S.overlay`). **Never** on cards, panels or chips: those appear in scrolling lists
and only *tint* (via `--surface`/`--glass-fill`). `@supports not (backdrop-filter)` falls the
sidebar back to an opaque panel. `icons.integration.test.jsx` pins that `SERVICE_ICON_CSS` contains
no `backdrop-filter`.

**Print & offline.** Receipts print from a separate `about:blank` iframe with its own black-on-white
stylesheet — the theme cannot reach them; a defensive `@media print` block also flattens the app
window if it's printed directly. The Advanced display face (`--font-display`) is a **serif system
stack** (`Cormorant Garamond → Georgia → serif`), never a web font — the app must run on a counter
tablet with the Wi-Fi off, so nothing is fetched.

## Responsive layout

Five bands, all defined once in [`src/lib/breakpoints.js`](src/lib/breakpoints.js) and interpolated
into the CSS block — **no width is typed twice**. `deviceClass()` is pure and pinned by
[`breakpoints.test.js`](src/lib/breakpoints.test.js) against the widths the salon actually holds.

| Band | Width | Shell |
|---|---|---|
| phone | ≤ 599 | sidebar as a **drawer** (`☰`, or "More"); bottom tab bar of 4 alongside it |
| tablet | 600–1023 | the full labelled rail, same as a laptop; only the gutters tighten |
| laptop | 1024–1439 | the original layout, untouched |
| desktop / wide | ≥ 1440 | same, content to `CONTENT_MAX` (1600, was 1280) |

Pointer type is a **separate axis** from width: touch sizing hangs off `(pointer: coarse)`, hover
styling off `(hover: hover)`. A 1024px tablet is a wide screen driven by a fingertip; a 900px laptop
window is a narrow one driven by a mouse. Keying touch sizing on width is what used to make an iPad
zoom on every input.

**The sidebar is ONE element in every band** — `.nav`, with `data-open` on it — so a nav entry is
written once and only its presentation changes. `railOpen` is the single piece of state behind it,
and it now belongs to the **phone alone**: the drawer slides the whole labelled rail in, and closes
on Escape, on the scrim, and on picking a destination.

**The tablet band does not collapse the rail, and shouldn't be made to again.** It used to shrink
to a 64px icon strip with `☰` to expand it, on the arithmetic that `RAIL_WIDTH` is a third of a
768px screen. The arithmetic was right and the conclusion was wrong: this nav's marks are `⊟`, `∑`,
`▦`, `⊝` — decorative glyphs, not icons anyone reads cold — so every navigation became tap-`☰`,
read, tap again. Reported from a real device. The space comes out of the content gutters instead
(`.main { padding:18px 16px }`), which costs nobody a decision. A phone is a genuinely different
problem and keeps its drawer.

Two things about the phone drawer specifically:

- **Closed is `display:none`, never a transform off-screen.** A drawer that is merely translated
  away is still in the tab order and still announced, so a keyboard or VoiceOver user walks through
  22 invisible links before reaching the page.
- **It does not stay pinned open, and shouldn't be made to.** `RAIL_WIDTH` of a 360px screen leaves
  the till 150px — the POS tiles, the tables and the diary don't survive it. That is the whole
  reason it is a drawer rather than a permanent rail.

The bottom bar and the drawer are not two navigations: the bar is the four screens used all day in
thumb reach, the drawer is *the sidebar*, complete. **"More" opens the same drawer the `☰` does** —
an earlier version gave it a bottom sheet of its own listing the leftover tabs, which is two
overlapping lists to keep in step. Opening the drawer on a phone also expands the "Other" group
(`setOtherOpen(true)`), or a secondary screen would sit three taps deep.

### Four things that will bite

1. **A media query loses to an inline style.** Most layout is inline — `S` in
   [`src/lib/ui/css.js`](src/lib/ui/css.js) (`S.nav`, `S.main`, `S.app`) plus the ~54 grids
   written inline in the views — and a normal stylesheet declaration cannot
   beat one. Every responsive rule that restyles an inline-styled element therefore carries
   `!important` — that is the *only* thing it is used for here, never to win a fight inside the CSS
   block. Miss it and the change silently does nothing: the 210px rail just stays put on a phone.

2. **Responsive grids are opt-in by class.** `.g2` / `.g3` / `.g-split` / `.cards`. The previous
   version of this block collapsed *every* element with an inline `grid-template-columns` via
   `[style*="grid-template-columns"]`, which also matched the appointments calendar
   (`56px repeat(N, minmax(140px,1fr))`) and stacked its time gutter on top of its stylist columns
   on every phone. The calendar, the barcode keypad and the `auto-fill` grids deliberately carry no
   class. Adding a new two-pane layout = add the class; don't widen a selector.

3. **Anything pinned over scrolling content must be OPAQUE.** The blur budget above allows
   `backdrop-filter` on the sidebar and the modal scrim only — so the tab bar, top bar and More
   sheet can't have it, and Advanced's `--nav-bg` (72%) / `--modal-bg` (88%) let the page read
   straight through them. They use `--bar-bg` / `--sheet-bg` instead, which are solid; the pinned
   first column of a scrolling table uses `--tbl-sticky-bg` for the same reason.

4. **`background:` is banned where `backgroundImage` is also set.** Use `backgroundColor`. A
   shorthand whose value contains `var()` is stored as one *pending-substitution* value covering
   every longhand it owns, so setting `backgroundImage` immediately after (React writes style keys
   in order) discards the rest and **background-color comes out empty**. This is real Chrome CSSOM
   behaviour, not a jsdom quirk. It is why Advanced's dark ground never painted — its light text sat
   on the white page — and it is pinned by `responsive.integration.test.jsx`.

`100vh` → always paired with a `100dvh` line after it (`.app`, `.nav`, `.modal`). On iOS `vh` is the
viewport at its *tallest*, so a 100vh rail is taller than the screen whenever Safari's toolbar is
expanded. `index.html` opts into `viewport-fit=cover`, so everything pinned to an edge pays it back
with `env(safe-area-inset-*)` padding.

### Verifying it

`responsive.integration.test.jsx` mounts the **real** app with `window.matchMedia` stubbed per
width, asserts which shell each band gets, and pins the CSS contract. jsdom lays nothing out, so it
proves the rules are present and say what they were written to say — never that a layout *looks*
right. That part is a browser.

**Headless Chrome will lie to you about phones.** It clamps its window to ~500 CSS px, so
`--window-size=390` renders at 500 and merely *crops* the screenshot — which reads as "the content
overflows" when it does not. Load the page in an `<iframe width="390">` instead: a frame gets
exactly the viewport it is given and its media queries evaluate against it. Check
`document.documentElement.scrollWidth === clientWidth` inside the frame; that inequality is the
horizontal-overflow bug that actually ruins a phone.

## Conventions

- `src/lib/*.js` is pure logic — no React, no Firebase (except the thin `firebase.js` /
  `sync.js` / `bills.js` adapters). Keep it that way; it's why those suites are fast.
- Screens live in `src/views/`, shared UI in `src/components/`, shared non-React UI logic in
  `src/lib/ui/` — see "Where things live" above, including why a moved component can pass lint
  and still throw.
- Money is paise-rounded rupees; dates are local-timezone.
- **Nothing that matters is a running total.** Visit counts, spend, loyalty points, tier and
  package sessions are derived from the bills and recomputed, never incremented. The README
  explains why at length — this is the app's central invariant.
- jsdom specs opt in per-file with a `// @vitest-environment jsdom` docblock; the default
  environment is node.
