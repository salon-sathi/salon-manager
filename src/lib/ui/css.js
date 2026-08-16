// The app's inline style objects and its one big stylesheet.

import { BREAKPOINTS, CONTENT_MAX, MAX, RAIL_WIDTH, RAIL_WIDTH_ICONS, TOUCH_TARGET } from "../breakpoints.js";

// ---------- styles ----------
const S = {
  // minHeight/height/maxHeight deliberately live in the CSS block below, not here: they need the
  // `100vh` → `100dvh` two-declaration fallback, and an inline style can only hold one value per
  // property. (On iOS, `vh` is the tallest the viewport ever gets — a vh-sized rail is clipped by
  // Safari's toolbar, and a vh-sized sheet hides its own last row.)
  // backgroundColor, NOT the `background` shorthand — and this is load-bearing, not style.
  // A shorthand whose value contains var() is stored as ONE pending-substitution value covering
  // every longhand it owns; the browser cannot know which part the variable feeds until it is
  // resolved. Setting `backgroundImage` immediately afterwards (as React does, in key order)
  // therefore destroys the rest of that pending shorthand, and background-color comes out EMPTY.
  // The Advanced theme's dark ground never painted: the white page showed through and its light
  // text sat on white. Verified in Chrome's own CSSOM, not just jsdom. Longhands don't interfere.
  app: { display: "flex", backgroundColor: "var(--bg-base, var(--app-bg))", backgroundImage: "var(--bg-gradient, none)", backgroundAttachment: "fixed", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: "var(--text-hi, #1E2421)" },
  nav: { width: RAIL_WIDTH, background: "var(--nav-bg, var(--ink))", color: "var(--nav-hi)", display: "flex", flexDirection: "column", gap: 4, padding: "16px 10px", position: "sticky", top: 0, boxSizing: "border-box", overflowY: "auto", overflowX: "hidden" },
  logo: { display: "flex", gap: 10, alignItems: "center", padding: "4px 8px 18px" },
  logoMark: { width: 38, height: 38, borderRadius: 10, background: "#E8A33D", color: "var(--ink)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 17 },
  // Was 1280, which left a 27" monitor showing a strip with dead margins either side. CONTENT_MAX
  // is wide enough for the calendar and the wide tables while text still wraps at a readable
  // measure; a screen that wants the whole window opts out with `.main.wide` (Appointments).
  main: { flex: 1, padding: "26px 30px", maxWidth: CONTENT_MAX, margin: "0 auto", width: "100%", boxSizing: "border-box" },
  cards: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },
  card: { background: "var(--surface, #fff)", borderRadius: 14, padding: "16px 18px", border: "1px solid var(--border, #E2EAE3)" },
  panel: { background: "var(--surface, #fff)", borderRadius: 14, padding: 16, border: "1px solid var(--border, #E2EAE3)" },
  panelHead: { fontWeight: 800, fontSize: 13.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--panelhead, #3A5547)", fontFamily: "var(--font-display, inherit)", display: "flex", alignItems: "center", marginBottom: 10 },
  row: { display: "flex", justifyContent: "space-between", padding: "8px 2px", borderBottom: "1px dashed var(--row-line, #E5ECE6)", fontSize: 13.5 },
  // backgroundColor for the same reason as S.app above: this entry also sets backgroundImage,
  // and a var()-bearing `background` shorthand would be wiped out by it.
  receipt: { backgroundColor: "var(--receipt-bg, #FFFDF6)", borderRadius: 4, padding: "18px 16px", border: "1px solid var(--receipt-border, #E8E2CF)", boxShadow: "0 2px 10px rgba(40,60,40,.07)", alignSelf: "start", backgroundImage: "var(--receipt-lines, repeating-linear-gradient(transparent, transparent 27px, rgba(180,170,140,.12) 28px))" },
  receiptHead: { textAlign: "center", fontWeight: 800, letterSpacing: "0.25em", fontSize: 12, color: "var(--receipthead-ink, #6B6347)", borderBottom: "2px dashed var(--receipt-rule, #D8D0B8)", paddingBottom: 10, marginBottom: 8 },
  rcptLine: { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px dotted var(--receipt-rule, #E0D9C4)" },
  rcptTotal: { display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 18, paddingTop: 12, marginTop: 6, borderTop: "2px dashed var(--receipt-rule, #C9BF9F)" },
  badge: { background: "#C44536", color: "#fff", fontSize: 10.5, fontWeight: 800, borderRadius: 9, padding: "1px 7px", marginLeft: 8 },
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "var(--ink)", color: "#fff", padding: "10px 20px", borderRadius: 10, fontSize: 13.5, boxShadow: "0 6px 20px rgba(0,0,0,.25)", zIndex: 60 },
  // Offline write-block popup: a loud, unmissable red overlay above everything else.
  blockOverlay: { position: "fixed", inset: 0, background: "rgba(70,8,8,.6)", display: "grid", placeItems: "center", zIndex: 200, padding: 20 },
  blockCard: { background: "#B3261E", border: "3px solid #fff", borderRadius: 18, padding: "26px 24px", width: "min(430px,94vw)", textAlign: "center", boxShadow: "0 22px 60px rgba(0,0,0,.45)" },
  // Always-on connection status pill, fixed bottom-right so it rides along on every screen.
  connBadge: { position: "fixed", bottom: 18, right: 16, zIndex: 90, display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 800, letterSpacing: ".02em", boxShadow: "0 4px 14px rgba(0,0,0,.22)", border: "2px solid", userSelect: "none" },
  connOn: { background: "#DCFCE7", color: "#0F7A43", borderColor: "#7FDDA8" },
  connOff: { background: "#B3261E", color: "#fff", borderColor: "#fff" },
  // "Update ready", pinned directly ABOVE the connection pill so the two stack instead of
  // overlapping, and so the pair reads as one status corner. Opaque, like everything else
  // pinned over scrolling content. `bottom` clears the 44px-ish connection pill.
  updateBadge: { position: "fixed", bottom: 66, right: 16, zIndex: 90, display: "inline-flex", alignItems: "center", gap: 10, padding: "7px 8px 7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 800, background: "#10331f", color: "#fff", border: "2px solid #E8A33D", boxShadow: "0 4px 14px rgba(0,0,0,.22)" },
  overlay: { position: "fixed", inset: 0, background: "var(--overlay-bg, rgba(15,30,20,.45))", backdropFilter: "var(--scrim-blur, none)", WebkitBackdropFilter: "var(--scrim-blur, none)", display: "grid", placeItems: "center", zIndex: 50 },
  modal: { background: "var(--modal-bg, #fff)", borderRadius: 16, padding: 20, width: "min(480px, 92vw)", overflow: "auto", backdropFilter: "var(--modal-blur, none)", WebkitBackdropFilter: "var(--modal-blur, none)", boxShadow: "var(--glass-shadow, none)" },
};

// Height of the phone bottom tab bar. Referenced by the bar itself, by the bottom padding that
// keeps content from hiding underneath it, and by the fixed connection pill and toast that have
// to sit above it — so it lives here rather than being typed into four rules.
const TABBAR_H = 58;

const CSS = `
  /* Theme palette. These are the DEFAULT (Emerald) values; StoreConfig's theme picker overrides
     them per shop by setting the same custom properties inline on the .app root (see themeVars).
     Defined at :root so the pre-login screens — which sit outside .app — are branded too. */
  :root {
    --ink:#10331f; --nav-hover:#1a4a2e; --nav-panel:#173d28; --nav-panel-hover:#1f5237;
    --nav-line:#2f5c44; --nav-text:#bcd2c4; --nav-text-dim:#a8c2b4; --nav-hi:#e9f2ec;
    --brand:#1b5e43; --brand-soft:#e4ece5; --brand-soft-text:#23402f;
    --app-bg:#eff3ee; --focus-ring:rgba(27,94,67,.18);
  }
  /* ── Advanced theme (the "Advanced ✨" appearance) ───────────────────────────────────────
     ONE synced whole-app skin, chosen by the owner (config.iconStyle === "advanced"; the
     attribute sits on the .app root — see the render). A dark glass-morphism layer that lays
     OVER whichever of the six colour palettes is active: it defines only its OWN tokens and
     never --brand/--ink/etc, because themeVars() sets those inline on .app and inline always
     beats a stylesheet — so the colour theme still tints the accents showing through the glass.
     Basic (data-theme="basic") defines none of these, so every var(--token, <original>) across
     the S.* styles and the class rules falls back to the original light value → pixel-identical. */
  [data-theme="advanced"] {
    color-scheme: dark;
    --bg-base:#17111D;
    --bg-gradient:
      radial-gradient(115% 105% at 12% 8%, #2A1B33 0%, rgba(42,27,51,0) 46%),
      radial-gradient(120% 110% at 88% 94%, #102224 0%, rgba(16,34,36,0) 50%);
    --glass-blur:14px;
    --scrim-blur:blur(12px);
    --modal-blur:blur(8px);
    --glass-hi:rgba(255,255,255,.08);
    --glass-fill:rgba(255,255,255,.06);
    --glass-border:rgba(255,255,255,.14);
    --glass-shadow:0 8px 30px rgba(0,0,0,.35), inset 0 1px 0 var(--glass-hi);
    --accent:#D4A85A; --accent-2:#C98A9E; --accent-teal:#8FB9A8; --accent-plum:#B99BD8;
    --text-hi:#F2EDE6; --text-mid:#B9AFA6; --text-low:#968C7E;
    --danger:#E4707A; --success:#7BC49A; --warn:#E0B15E;
    --font-display:'Cormorant Garamond','Hoefler Text',Georgia,'Times New Roman',serif;
    /* Surfaces — consumed by the inline S.* styles and the .btn/.input/.pick/.qty/.tbl rules. */
    --surface:rgba(255,255,255,.06);
    --border:rgba(255,255,255,.14);
    --panelhead:#CDBF9A;
    --nav-bg:rgba(23,17,29,.72);
    --row-line:rgba(255,255,255,.10);
    --overlay-bg:rgba(8,5,12,.62);
    --modal-bg:rgba(34,27,42,.88);
    --input-bg:rgba(255,255,255,.05); --input-border:rgba(255,255,255,.16); --input-focus:var(--accent);
    --focus-ring-width:2px;
    --btn-bg:rgba(255,255,255,.08); --btn-fg:var(--text-hi);
    --btn-primary-bg:var(--accent); --btn-primary-fg:#241B10;
    --btn-ghost-bg:transparent; --btn-ghost-border:rgba(255,255,255,.22);
    --btn-danger-bg:rgba(228,112,122,.16); --btn-danger-fg:#F0A6AC;
    --pick-bg:rgba(255,255,255,.05); --pick-border:rgba(255,255,255,.14);
    --pick-hover-border:var(--accent); --pick-hover-bg:rgba(255,255,255,.09);
    --pick-disabled-bg:rgba(255,255,255,.03);
    --qty-border:rgba(255,255,255,.20); --qty-bg:rgba(255,255,255,.05);
    --tbl-th:#B9AFA6; --tbl-head-line:rgba(255,255,255,.16);
    --tbl-line:rgba(255,255,255,.08); --tbl-row-hover:rgba(255,255,255,.05);
    /* The pinned first column of a sideways-scrolling table. This one has to be OPAQUE — every
       other surface here is a translucent glass fill, and a translucent pin would let the rest
       of the row scroll visibly through it. Matched to the modal's ground, not to --surface. */
    --tbl-sticky-bg:#241D2C;
    /* Opaque ground for the phone's two bars. --nav-bg is only 72% opaque, which works for the
       sidebar because the sidebar is the one surface allowed a backdrop-filter — it frosts what
       sits behind it, and it keeps that treatment as a drawer because a drawer sits STILL. The
       top and bottom bars lie over SCROLLING content and so are barred from blurring (the blur
       budget), which would leave 28% of the page reading through them. Same colour, made solid. */
    --bar-bg:#1B1522;
    --blocked-fill:repeating-linear-gradient(45deg, rgba(255,255,255,.04), rgba(255,255,255,.04) 5px, rgba(255,255,255,.10) 5px, rgba(255,255,255,.10) 10px);
    --blocked-ink:var(--text-mid);
    /* Secondary surfaces: inner cards/rows/boxes that sit ON a panel, and the tinted callouts.
       Every text-bearing surface must go dark here — a light one traps the now-light body text. */
    --surface-2:rgba(255,255,255,.05);
    --tint-warm:rgba(224,177,94,.15); --tint-warm-border:rgba(224,177,94,.34);
    --tint-danger:rgba(228,112,122,.15); --tint-danger-border:rgba(228,112,122,.34);
    --tint-info:rgba(255,255,255,.05); --tint-info-border:var(--glass-border);
    /* The POS "current bill" panel (S.receipt) — glass, not paper, in Advanced. */
    --receipt-bg:rgba(255,255,255,.05); --receipt-border:var(--glass-border);
    --receipt-lines:none; --receipthead-ink:#CDBF9A; --receipt-rule:rgba(255,255,255,.16);
  }
  /* Shell sizing. The plain-vh line is the fallback for browsers without dvh (Safari < 15.4,
     Chrome < 108); the dvh line wins wherever it is understood. This matters on iOS, where vh
     resolves to the viewport at its TALLEST — a 100vh rail is therefore taller than the screen
     whenever Safari's toolbar is expanded, and its last item sits underneath the chrome. */
  .app { min-height:100vh; min-height:100dvh; }
  .nav { height:100vh; height:100dvh; }
  .modal { max-height:86vh; max-height:86dvh; }
  .navbtn { display:flex; align-items:center; gap:6px; width:100%; text-align:left; background:none; border:none; color:var(--nav-text); padding:10px 12px; border-radius:9px; font-size:13.5px; font-weight:600; cursor:pointer; position:relative; }
  .navbtn:hover { background:var(--nav-hover); color:#fff; }
  .navbtn.active { background:var(--brand); color:#fff; }
  .navbtn.sub { padding-left:26px; font-size:13px; color:var(--nav-text-dim); }
  .navbtn.sub::before { content:""; position:absolute; left:14px; top:9px; bottom:9px; width:2px; background:var(--nav-line); border-radius:2px; }
  /* Bottom utility actions (Backup / Restore / Reset / Logout): a filled, bordered variant with
     brighter text, so they read as real buttons instead of ghosted/disabled links. */
  .navbtn.util { background:var(--nav-panel); color:var(--nav-hi); border:1px solid var(--nav-line); justify-content:center; font-weight:700; }
  .navbtn.util:hover { background:var(--nav-panel-hover); color:#fff; border-color:var(--nav-hi); }
  /* Offline status pill pulses so a lost connection is impossible to miss. */
  @keyframes connpulse { 0%,100% { box-shadow:0 4px 14px rgba(0,0,0,.22), 0 0 0 0 rgba(179,38,30,.55); } 50% { box-shadow:0 4px 14px rgba(0,0,0,.22), 0 0 0 9px rgba(179,38,30,0); } }
  .connbadge-off { animation:connpulse 1.4s ease-in-out infinite; }
  .input { width:100%; box-sizing:border-box; padding:10px 12px; border:1.5px solid var(--input-border, #D5E0D6); border-radius:9px; font-size:14px; background:var(--input-bg, #fff); outline:none; font-family:inherit; }
  .input:focus { border-color:var(--input-focus, var(--brand)); box-shadow:0 0 0 var(--focus-ring-width, 3px) var(--focus-ring); }
  .btn { border:none; border-radius:9px; padding:9px 16px; font-size:13.5px; font-weight:700; cursor:pointer; background:var(--btn-bg, var(--brand-soft)); color:var(--btn-fg, var(--brand-soft-text)); font-family:inherit; }
  .btn:hover { filter:brightness(.96); }
  .btn.primary { background:var(--btn-primary-bg, var(--brand)); color:var(--btn-primary-fg, #fff); }
  .btn.big { padding:13px 18px; font-size:15px; }
  .btn.ghost { background:var(--btn-ghost-bg, transparent); border:1.5px solid var(--btn-ghost-border, #CFDCD1); }
  .btn.small { padding:5px 10px; font-size:12px; }
  .btn.danger { background:var(--btn-danger-bg, #FBEAE7); color:var(--btn-danger-fg, #C44536); }
  .pick { text-align:left; background:var(--pick-bg, #F6FAF6); border:1.5px solid var(--pick-border, #DDE8DE); border-radius:11px; padding:10px 12px; cursor:pointer; font-family:inherit; }
  .pick:hover:not(:disabled) { border-color:var(--pick-hover-border, var(--brand)); background:var(--pick-hover-bg, #fff); }
  .pick:disabled { opacity:.7; cursor:not-allowed; background:var(--pick-disabled-bg, #F0F2F0); }
  .qty { width:26px; height:26px; border-radius:7px; border:1.5px solid var(--qty-border, #D0C7AB); background:var(--qty-bg, #fff); font-size:15px; font-weight:700; cursor:pointer; line-height:1; }
  .tbl { width:100%; border-collapse:collapse; font-size:13.5px; }
  .tbl th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--tbl-th, #7A8C81); padding:6px 8px; border-bottom:2px solid var(--tbl-head-line, #E2EAE3); }
  .tbl td { padding:9px 8px; border-bottom:1px solid var(--tbl-line, #EEF3EE); }
  .tbl tr:hover td { background:var(--tbl-row-hover, #F7FAF7); }
  /* ── Advanced theme: surface treatments ─────────────────────────────────────────────────
     What tokens can't express — backdrop-blur, ::placeholder, chart internals, hover accents.
     All scoped to [data-theme="advanced"], so Basic is untouched. Backdrop-blur lives ONLY on
     surfaces that sit still (the sidebar, and the modal scrim via S.overlay) — never on cards,
     which scroll: those tint through --surface instead. See the blur budget in CLAUDE.md. */
  [data-theme="advanced"] .nav { backdrop-filter:blur(var(--glass-blur)); -webkit-backdrop-filter:blur(var(--glass-blur)); border-right:1px solid var(--glass-border); }
  [data-theme="advanced"] .navbtn.util { background:rgba(255,255,255,.06); border-color:var(--glass-border); color:var(--text-hi); }
  [data-theme="advanced"] .navbtn.util:hover { background:rgba(255,255,255,.12); border-color:var(--accent); color:#fff; }
  [data-theme="advanced"] .input { color:var(--text-hi); }
  [data-theme="advanced"] .input::placeholder { color:var(--text-low); }
  [data-theme="advanced"] .btn.ghost:hover, [data-theme="advanced"] .pick:hover:not(:disabled) { border-color:var(--accent); }
  [data-theme="advanced"] .btn.primary:hover { filter:brightness(1.06); }
  [data-theme="advanced"] .qty:hover { border-color:var(--accent); }
  /* Charts: lift only the near-black green series so it reads on the dark ground, calm the grid,
     and make axis ticks / legend / tooltip legible. Series are matched by their literal fill/stroke
     (case-insensitive) so the categorical palette keeps every other distinction intact. */
  [data-theme="advanced"] [fill="#1b5e43" i] { fill:#63B78E; }
  [data-theme="advanced"] [stroke="#1b5e43" i] { stroke:#63B78E; }
  [data-theme="advanced"] [stroke="#10331f" i] { stroke:rgba(255,255,255,.25); }
  [data-theme="advanced"] [stroke="#eef3ee" i] { stroke:rgba(255,255,255,.09); }
  [data-theme="advanced"] .recharts-cartesian-axis-tick-value, [data-theme="advanced"] .recharts-text { fill:var(--text-mid); }
  [data-theme="advanced"] .recharts-cartesian-axis-line, [data-theme="advanced"] .recharts-cartesian-axis-tick-line { stroke:var(--glass-border); }
  [data-theme="advanced"] .recharts-legend-item-text { color:var(--text-mid) !important; }
  [data-theme="advanced"] .recharts-default-tooltip { background:rgba(30,23,38,.95) !important; border:1px solid var(--glass-border) !important; border-radius:10px; }
  [data-theme="advanced"] .recharts-tooltip-item, [data-theme="advanced"] .recharts-tooltip-label { color:var(--text-hi) !important; }
  /* Blur budget fallback: where backdrop-filter is unsupported, fall back to an opaque-enough
     panel so the sidebar never turns into unreadable see-through text. */
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))) {
    [data-theme="advanced"] .nav { background:#1b1522; }
  }
  /* Reduced motion: the offline pill's pulse is the only looping animation — stop it. */
  @media (prefers-reduced-motion: reduce) {
    .connbadge-off { animation:none; }
    * { scroll-behavior:auto; }
  }
  /* Print: a receipt is thermal paper, not a theme. Force plain black-on-white and drop every
     gradient, glass and display face, whichever appearance is active on screen. */
  @media print {
    [data-theme] { --bg-base:#fff; --bg-gradient:none; --surface:#fff; --border:#000; --text-hi:#000;
      --text-mid:#000; --panelhead:#000; --nav-bg:#fff; --modal-bg:#fff; --font-display:inherit; }
    [data-theme] .nav, .topbar, .tabbar, .rail-scrim { display:none !important; }
    [data-theme] .main { padding:0 !important; max-width:none !important; }
    [data-theme] * { backdrop-filter:none !important; -webkit-backdrop-filter:none !important;
      background-image:none !important; box-shadow:none !important; color:#000 !important; }
  }

  /* ══ RESPONSIVE ═══════════════════════════════════════════════════════════════════════════
     Five bands — phone / tablet / laptop / desktop / wide — every width interpolated from
     src/lib/breakpoints.js so no number is typed twice. Plus a SEPARATE axis for pointer type,
     because "narrow" and "touched" are different questions: a 1024px tablet is a wide screen
     driven by a fingertip, and a 900px laptop window is a narrow one driven by a mouse.

     Two rules this block holds to:

     · The inline grid-template-columns on a layout stays the DESKTOP truth. Everything here
       only applies at or below the tablet band, so laptops and desktops render exactly what
       they rendered before — which is also what keeps Basic pixel-identical there.

     · "!important" appears only where a rule must beat an INLINE style (an important author
       declaration outranks a normal inline one — it is the only way to restyle a layout whose
       columns are written in a style={{}}). It is never used to win a fight inside this file.
     ═════════════════════════════════════════════════════════════════════════════════════════ */

  /* ── Responsive grids ────────────────────────────────────────────────────────────────────
     Opt-in BY CLASS, which is the entire point. The previous version of this block collapsed
     every element carrying an inline grid-template-columns via [style*="grid-template-columns"]
     — including the appointments calendar (56px repeat(N, minmax(140px,1fr))), whose time
     gutter and stylist columns therefore stacked on top of each other on every phone. A layout
     is responsive here because it says it is.

       .g2       a pair of equal panes                → 1 column on a phone
       .g3       three across                         → 2 up on a tablet, 1 on a phone
       .g-split  an unequal pair (1.4fr 1fr, …)       → 1 column from the tablet band down,
                                                        since the narrow half is a receipt or a
                                                        form that cannot survive being halved
       .cards    the 4-across stat row                → auto-fit: 2 up on a phone, 1 at 320px */
  @media (max-width: ${MAX.tablet}px) {
    .g3 { grid-template-columns:1fr 1fr !important; }
    .g-split { grid-template-columns:1fr !important; }
    .cards { grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)) !important; }
  }
  @media (max-width: ${MAX.phone}px) {
    .g2, .g3 { grid-template-columns:1fr !important; }
  }

  /* ── Wide screens ────────────────────────────────────────────────────────────────────────
     The content column caps at CONTENT_MAX (see S.main). ".main.wide" opts a screen out of the
     cap entirely — used by Appointments, whose calendar is a canvas that genuinely wants the
     whole monitor rather than a reading-width column. */
  .main.wide { max-width:none !important; }

  /* ── Tables ──────────────────────────────────────────────────────────────────────────────
     Below the laptop band a table scrolls sideways INSIDE itself rather than stretching the
     page — html/body carry overflow-x:hidden, so a table is never able to drag the whole
     screen sideways. The first column pins so the row stays identifiable while the rest
     scrolls under it; that sliding-under is also the affordance that says "there is more".
     The pin needs an OPAQUE backdrop, which is why --tbl-sticky-bg exists: --surface is a
     translucent glass fill under the Advanced theme and would let the text scroll through. */
  @media (max-width: ${MAX.tablet}px) {
    .tbl { display:block; overflow-x:auto; white-space:nowrap; -webkit-overflow-scrolling:touch; }
    .tbl th:first-child, .tbl td:first-child {
      position:sticky; left:0; z-index:1; background:var(--tbl-sticky-bg, #fff);
    }
    .tbl tr:hover td:first-child { background:var(--tbl-sticky-bg, #fff); }
  }

  /* ── Shell: tablet (${BREAKPOINTS.tablet}–${MAX.tablet}px) ───────────────────────────────
     A ${RAIL_WIDTH}px rail is a third of a 768px portrait tablet. It collapses to icons, and the
     ☰ at its head expands it back over the content (position:fixed, not re-flowed) so the page
     underneath never jumps while you navigate. Every nav button keeps its title/aria-label, so
     the label is still reachable by long-press and by a screen reader while collapsed. */
  .railtoggle { display:none; }
  /* The rail's footer blocks (Backup / Restore, Reset / Logout). Their display lives here, not
     inline, so the collapsed tablet rail can hide them — see the tablet band below. */
  .navrow { display:flex; gap:6px; }
  .rail-scrim { position:fixed; inset:0; z-index:125; background:var(--overlay-bg, rgba(15,30,20,.45)); }
  @media (min-width: ${BREAKPOINTS.tablet}px) and (max-width: ${MAX.tablet}px) {
    /* width/padding/position/display below are all !important for one reason: S.nav and S.main
       set them INLINE, and a normal stylesheet declaration loses to an inline one. */
    .nav { width:${RAIL_WIDTH_ICONS}px !important; padding:12px 8px !important; }
    .nav .navbtn { justify-content:center; padding:11px 0; gap:0; }
    .nav .navbtn.sub { padding-left:0; }
    .nav .navbtn.sub::before { display:none; }
    .nav .navlabel, .nav .navfoot, .nav .navshop, .nav .navgrouplabel, .nav .navchev { display:none; }
    /* margin is !important because S.badge sets marginLeft inline for the full rail. */
    .nav .navbtn .badge-n { position:absolute; top:2px; right:2px; margin:0 !important; }
    .nav .railtoggle { display:flex; justify-content:center; font-size:16px; }
    /* "Restore (JSON / XLSX)" cannot be squeezed into a 64px column — abbreviated it reads as
       nothing, and left alone it spills out of the rail. The footer blocks are hidden while the
       rail is collapsed and come back when it is expanded, which is one tap on the ☰ above. */
    .nav .navutil { display:none; }
    /* Expanded: floats over the page rather than re-flowing it, so the content column doesn't
       jump sideways every time the menu is opened. */
    .nav[data-open="1"] { position:fixed !important; z-index:130; width:${RAIL_WIDTH}px !important;
      box-shadow:12px 0 40px rgba(0,0,0,.35); }
    .nav[data-open="1"] .navbtn { justify-content:flex-start; padding:10px 12px; gap:6px; }
    .nav[data-open="1"] .navbtn.sub { padding-left:26px; }
    .nav[data-open="1"] .navbtn.sub::before { display:block; }
    .nav[data-open="1"] .navlabel, .nav[data-open="1"] .navfoot,
    .nav[data-open="1"] .navshop, .nav[data-open="1"] .navgrouplabel,
    .nav[data-open="1"] .navchev { display:revert; }
    .nav[data-open="1"] .navbtn .badge-n { position:static; }
    .nav[data-open="1"] .navutil { display:block; }
    .nav[data-open="1"] .navrow { display:flex; }
    .main { padding:18px 16px !important; }
  }

  /* ── Shell: phone (≤${MAX.phone}px) ──────────────────────────────────────────────────────
     The sidebar becomes a DRAWER: the same full, labelled rail the laptop shows, opened from
     the ☰ in the top bar (or from "More" in the bottom bar) and laid over the page. It cannot
     stay pinned open — a ${RAIL_WIDTH}px rail on a 360px phone leaves 150px of content, which
     the POS tiles, the tables and the diary do not survive. So the page keeps its full width
     and the rail arrives on demand, complete, with every label intact.

     Navigation is therefore TWO things that do different jobs: the bottom bar is the four
     screens used all day, in thumb reach; the drawer is everything, spelled out.

     Both pay back the viewport-fit=cover in index.html with safe-area padding, so nothing lands
     under the notch or the home indicator. */
  @media (max-width: ${MAX.phone}px) {
    /* display/position/padding/max-width are !important because S.nav and S.main declare them
       INLINE. Without it the ${RAIL_WIDTH}px rail simply stays put, shoves the content column
       off the right of a 390px screen, and the bottom bar lands on top of it. */

    /* Closed: display:none, NOT a transform off-screen. A drawer that is merely translated away
       is still in the tab order and still read out by a screen reader, so a keyboard or
       VoiceOver user walks into 22 invisible links before reaching the page. */
    .nav { display:none !important; }
    .nav[data-open="1"] {
      display:flex !important; position:fixed !important; top:0; left:0; z-index:130;
      width:${RAIL_WIDTH}px !important;
      padding:calc(env(safe-area-inset-top) + 14px) 10px calc(env(safe-area-inset-bottom) + 12px) !important;
      box-shadow:12px 0 40px rgba(0,0,0,.4);
    }
    /* The rail's own ☰ becomes the drawer's close button — the scrim closes it too, but a
       visible control is what makes that discoverable and keyboard-reachable. */
    .nav[data-open="1"] .railtoggle { display:flex; justify-content:center; font-size:18px; }
    .app { flex-direction:column; }
    .main { padding:14px 12px !important; max-width:none !important;
      /* clear the fixed tab bar, plus the home indicator below it */
      padding-bottom:calc(${TABBAR_H}px + env(safe-area-inset-bottom) + 16px) !important; }
  }
  .topbar { display:none; }
  .tabbar { display:none; }
  @media (max-width: ${MAX.phone}px) {
    /* --bar-bg, not --nav-bg: these two lie over scrolling content and cannot blur, so their
       ground has to be fully opaque or the page reads straight through them. */
    .topbar { position:sticky; top:0; z-index:80; display:flex; align-items:center; gap:10px;
      padding:calc(env(safe-area-inset-top) + 9px) 14px 9px;
      background:var(--bar-bg, var(--ink)); color:var(--nav-hi);
      border-bottom:1px solid var(--nav-line); }
    .tabbar { position:fixed; left:0; right:0; bottom:0; z-index:100; display:flex;
      background:var(--bar-bg, var(--ink)); border-top:1px solid var(--nav-line);
      padding-bottom:env(safe-area-inset-bottom); }
  }
  .tabbtn { flex:1 1 0; min-width:0; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:3px; min-height:${TABBAR_H}px; padding:7px 2px; position:relative;
    background:none; border:none; color:var(--nav-text); font-family:inherit; font-size:10px;
    font-weight:700; letter-spacing:-.01em; cursor:pointer; }
  .tabbtn .tabico { font-size:18px; line-height:1; }
  .tabbtn .tablabel { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tabbtn.active { color:#fff; }
  .tabbtn.active::before { content:""; position:absolute; top:0; left:50%; transform:translateX(-50%);
    width:26px; height:3px; border-radius:0 0 3px 3px; background:var(--brand); }
  /* Unread/low-stock count on a bottom-bar item, and the aggregate dot on "More" when the
     badged tab is behind "More". */
  .tabbtn .tabbadge { position:absolute; top:4px; left:50%; margin-left:4px; background:#C44536;
    color:#fff; font-size:9.5px; font-weight:800; border-radius:9px; padding:0 5px; line-height:15px;
    min-width:15px; text-align:center; }

  /* The ☰ that opens the drawer, in the phone top bar. Sized to the touch floor so it is a real
     target rather than a decorative glyph. */
  .topbtn { display:flex; align-items:center; justify-content:center; flex-shrink:0;
    min-width:${TOUCH_TARGET}px; min-height:${TOUCH_TARGET}px; margin-left:-8px;
    background:none; border:none; border-radius:10px; color:var(--nav-hi);
    font-family:inherit; font-size:19px; line-height:1; cursor:pointer; }

  /* ── Page headers ────────────────────────────────────────────────────────────────────────
     Once the actions wrap onto their own line, "pushed right by margin-left:auto" is the wrong
     shape — they read as a stray cluster. They go full-width instead, which also makes each
     control a comfortable target. */
  @media (max-width: ${MAX.phone}px) {
    .pagehead { margin-bottom:14px !important; gap:10px !important; }
    .pagehead h1 { font-size:20px !important; }
    .pagehead .pagehead-actions { margin-left:0 !important; width:100%; }
    .pagehead .pagehead-actions > * { width:100%; }
    .pagehead .pagehead-actions .btn { flex:1 1 auto; }
  }

  /* ── Dialogs become bottom sheets on a phone ─────────────────────────────────────────────
     A centred 92vw box is a poor shape on a 390×844 screen: its actions land mid-screen, and
     the on-screen keyboard pushes it half out of view. Anchored to the bottom edge it opens
     where the thumb already is, and the keyboard shortens it from the top instead. */
  @media (max-width: ${MAX.phone}px) {
    .overlay { place-items:end center !important; }
    .modal { width:100% !important; border-radius:18px 18px 0 0; max-height:88dvh;
      padding:16px 14px calc(16px + env(safe-area-inset-bottom)); }
  }

  /* ── POS running total (phone) ───────────────────────────────────────────────────────────
     Sits directly on top of the tab bar and shares its safe-area padding, so the two read as
     one piece of furniture rather than as a banner floating over the page. */
  .cartbar { position:fixed; left:8px; right:8px; z-index:95;
    bottom:calc(${TABBAR_H}px + env(safe-area-inset-bottom) + 8px);
    display:flex; align-items:center; gap:10px; padding:11px 14px;
    min-height:${TOUCH_TARGET}px; border:none; border-radius:12px; cursor:pointer;
    background:var(--brand); color:#fff; font-family:inherit; font-size:13.5px; font-weight:700;
    box-shadow:0 8px 24px rgba(0,0,0,.28); }
  .cartbar-n { background:rgba(255,255,255,.22); border-radius:8px; padding:2px 8px; font-weight:800; }

  /* ── Fixed furniture clears the tab bar ──────────────────────────────────────────────────
     The connection pill and the toast are position:fixed at the bottom of the window, which on
     a phone is exactly where the tab bar now is. */
  @media (max-width: ${MAX.phone}px) {
    .connbadge { bottom:calc(${TABBAR_H}px + env(safe-area-inset-bottom) + 10px) !important;
      right:10px !important; }
    .toast { bottom:calc(${TABBAR_H}px + env(safe-area-inset-bottom) + 12px) !important;
      width:max-content; max-width:calc(100vw - 24px); }
  }

  /* ── Touch ───────────────────────────────────────────────────────────────────────────────
     Keyed on POINTER, not on width, so a 1024px tablet gets touch sizing and a narrow laptop
     window does not — and so a mouse-driven desktop keeps its original density untouched.
     ${TOUCH_TARGET}px is the iOS HIG floor; with the gaps already between these controls it
     also clears Android's 48dp. */
  @media (pointer: coarse) {
    .btn.small { min-height:${TOUCH_TARGET}px; padding:8px 14px; font-size:13px; }
    .qty { width:${TOUCH_TARGET}px; height:${TOUCH_TARGET}px; font-size:18px; }
    .navbtn, .pick { min-height:${TOUCH_TARGET}px; }
    .tabbtn { min-height:max(${TABBAR_H}px, ${TOUCH_TARGET}px); }
    /* 16px is the threshold below which iOS Safari zooms the page on focus. It is set for every
       coarse pointer, not just for narrow ones — an iPad at 1024px zoomed on every field under
       the old width-only rule. */
    .input, select.input, textarea.input { font-size:16px; min-height:${TOUCH_TARGET}px; }
    /* Kill the 300ms double-tap-to-zoom delay on controls, and the grey flash Android paints
       over a tapped button. Pinch-zoom on the page itself is untouched. */
    .btn, .navbtn, .tabbtn, .pick, .qty, button, [role="button"] {
      touch-action:manipulation; -webkit-tap-highlight-color:transparent;
    }
  }
  /* Hover styling only where a pointer can actually hover. On a touchscreen these otherwise
     latch on after a tap and stay lit until something else is tapped. */
  @media (hover: none) {
    .btn:hover, .navbtn:hover, .pick:hover:not(:disabled), .tbl tr:hover td { filter:none; }
    .navbtn:hover { background:none; color:var(--nav-text); }
    .navbtn.active:hover { background:var(--brand); color:#fff; }
    .pick:hover:not(:disabled) { border-color:var(--pick-border, #DDE8DE); background:var(--pick-bg, #F6FAF6); }
    .tbl tr:hover td { background:transparent; }
  }

  /* ── Landscape phone ─────────────────────────────────────────────────────────────────────
     The POS is used at the counter with the phone turned sideways. There is very little height
     there, so the sticky chrome gives some of it back. */
  @media (max-width: ${MAX.tablet}px) and (orientation: landscape) and (max-height: 480px) {
    .topbar { position:static; }
    .tabbtn { min-height:46px; font-size:9.5px; }
    .tabbtn .tabico { font-size:15px; }
  }
`;


export { S, CSS };
