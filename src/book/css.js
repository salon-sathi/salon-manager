// The booking page's stylesheet, and all of it.
//
// Deliberately NOT src/lib/ui/css.js. That is the staff app's stylesheet — the sidebar, the
// diary grid, the modal system, the Advanced glass theme — and none of it applies to a
// single-column page a customer opens once. It also carries the app's inline-style/`!important`
// contract, which would be a liability here rather than a help.
//
// What IS shared is the palette: themeVars(profile.theme) is spread onto the root element, so
// --brand and --ink are the salon's own chosen colours. Everything below reads those with a
// fallback, exactly like the app's own tokens do, so a salon that has never picked a theme still
// gets a finished-looking page.
//
// Mobile first. Most customers open this from a link in a bio, on a phone, one-handed.

export const CSS = `
.bk {
  --bk-bg: #F6F8F6;
  --bk-surface: #fff;
  --bk-line: #E2EAE3;
  --bk-text: #25342C;
  --bk-mid: #6B7E74;
  --bk-err: #B23B2E;
  min-height: 100%;
  background: var(--bk-bg);
  color: var(--bk-text);
  font-size: 15px;
  line-height: 1.5;
  padding: 0 0 40px;
  padding-bottom: calc(40px + env(safe-area-inset-bottom));
}

@media (prefers-color-scheme: dark) {
  .bk {
    --bk-bg: #14181A;
    --bk-surface: #1D2426;
    --bk-line: #2E393B;
    --bk-text: #EAF1EC;
    --bk-mid: #9DB0A6;
    --bk-err: #FF9082;
  }
}

.bk-wrap { max-width: 620px; margin: 0 auto; padding: 0 14px; }
.bk * { box-sizing: border-box; }

/* ---- header ---- */
.bk-head {
  background: var(--brand, #1B5E43);
  color: #fff;
  padding: 26px 18px 20px;
  padding-top: calc(26px + env(safe-area-inset-top));
  text-align: center;
  margin: 0 -14px 16px;
}
.bk-head h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.01em; }
.bk-tag { font-size: 13.5px; opacity: .85; margin-top: 2px; }
.bk-addr { font-size: 13.5px; opacity: .9; margin-top: 8px; white-space: pre-line; }
.bk-links { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 14px; }

/* ---- cards ---- */
.bk-card {
  background: var(--bk-surface);
  border: 1px solid var(--bk-line);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 14px;
}
.bk-msg, .bk-ok { text-align: center; padding: 30px 20px; }
.bk-msg h2, .bk-ok h2 { font-size: 19px; margin-bottom: 8px; }
.bk-notice {
  background: var(--bk-surface); border: 1px solid var(--bk-line); border-left: 4px solid var(--brand, #1B5E43);
  border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 13.5px;
}

.bk-step { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 14px; }
.bk-step h2 { font-size: 17px; font-weight: 700; }
.bk-num {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  background: var(--brand, #1B5E43); color: #fff;
  display: grid; place-items: center; font-size: 13px; font-weight: 800;
}

.bk-fine { font-size: 12.5px; color: var(--bk-mid); line-height: 1.55; }
.bk-big { font-size: 20px; font-weight: 800; margin: 6px 0; }
.bk-err { color: var(--bk-err); font-size: 13px; font-weight: 600; margin: 10px 0; }

/* ---- services ---- */
.bk-group { margin-bottom: 12px; }
.bk-group h3 {
  font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em;
  color: var(--bk-mid); margin-bottom: 6px;
}
.bk-svc {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 12px; margin-bottom: 6px;
  border: 1.5px solid var(--bk-line); border-radius: 10px;
  cursor: pointer; min-height: 48px;
}
.bk-svc.on { border-color: var(--brand, #1B5E43); background: color-mix(in srgb, var(--brand, #1B5E43) 7%, transparent); }
.bk-svc input { width: 19px; height: 19px; flex-shrink: 0; accent-color: var(--brand, #1B5E43); }
.bk-svc-name { flex: 1; font-size: 14.5px; }
.bk-svc-min { font-size: 12.5px; color: var(--bk-mid); }
.bk-svc-rs { font-size: 13.5px; font-weight: 700; min-width: 62px; text-align: right; }
.bk-total {
  border-top: 1px solid var(--bk-line); padding-top: 10px; margin-top: 4px; font-size: 14px;
}

/* ---- days & times ---- */
/* The day strip scrolls sideways inside itself; the PAGE must never scroll horizontally. */
.bk-days { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 14px; }
.bk-day {
  flex: 0 0 auto; padding: 9px 14px; min-height: 44px;
  border: 1.5px solid var(--bk-line); border-radius: 10px;
  background: var(--bk-surface); color: inherit;
  font: inherit; font-size: 13.5px; cursor: pointer; white-space: nowrap;
}
.bk-day.on { border-color: var(--brand, #1B5E43); background: var(--brand, #1B5E43); color: #fff; font-weight: 700; }

.bk-times { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
.bk-time {
  padding: 11px 6px; min-height: 46px;
  border: 1.5px solid var(--bk-line); border-radius: 10px;
  background: var(--bk-surface); color: inherit;
  font: inherit; font-size: 13.5px; cursor: pointer;
}
.bk-time.on { border-color: var(--brand, #1B5E43); background: var(--brand, #1B5E43); color: #fff; font-weight: 700; }

/* ---- form ---- */
.bk-field { display: block; margin-bottom: 12px; }
.bk-field span { display: block; font-size: 12.5px; font-weight: 600; color: var(--bk-mid); margin-bottom: 5px; }
.bk-field input {
  width: 100%; padding: 12px; min-height: 48px;
  border: 1.5px solid var(--bk-line); border-radius: 10px;
  background: var(--bk-surface); color: inherit;
  /* 16px exactly: anything smaller and iOS Safari zooms the page on focus. */
  font: inherit; font-size: 16px;
}
.bk-field input:focus-visible, .bk-time:focus-visible, .bk-day:focus-visible, .bk-btn:focus-visible {
  outline: 3px solid var(--focus-ring, #2A6FB0); outline-offset: 2px;
}
.bk-confirm-line {
  background: color-mix(in srgb, var(--brand, #1B5E43) 8%, transparent);
  border-radius: 10px; padding: 10px 12px; margin: 4px 0 10px; font-size: 13.5px;
}

/* ---- buttons ---- */
.bk-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 12px 18px; min-height: 48px;
  border: 1.5px solid var(--bk-line); border-radius: 10px;
  background: var(--bk-surface); color: inherit;
  font: inherit; font-size: 14.5px; font-weight: 600;
  cursor: pointer; text-decoration: none;
}
.bk-primary {
  width: 100%; background: var(--brand, #1B5E43); border-color: var(--brand, #1B5E43);
  color: #fff; font-size: 16px; font-weight: 700; margin-bottom: 10px;
}
.bk-primary:disabled { opacity: .6; cursor: default; }
.bk-ghost { background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.34); color: #fff; }
.bk-card .bk-ghost { background: var(--bk-surface); border-color: var(--bk-line); color: inherit; }

.bk-tick {
  width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 50%;
  background: var(--brand, #1B5E43); color: #fff;
  display: grid; place-items: center; font-size: 30px; font-weight: 900;
}
.bk-ok p { margin-bottom: 8px; }

@media (min-width: 620px) {
  .bk-head { border-radius: 0 0 16px 16px; }
}
`;
