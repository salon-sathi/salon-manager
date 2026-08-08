// The small shared UI pieces every screen is built from.

import { ROLE_LABELS } from "../lib/roles.js";
import { S } from "../lib/ui/css.js";
import { useEffect, useRef } from "react";

const Splash = ({ children }) => (
  <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--ink)", color: "#BCD2C4", fontFamily: "system-ui, sans-serif", padding: 24, textAlign: "center" }}>
    {children}
  </div>
);

// Shown when a role reaches a view it may not have. In practice the nav never offers the tab,
// so this is the backstop for a stale tab, a live demotion, or a deep link — not a normal path.
const NoAccess = ({ role }) => (
  <div style={{ padding: "48px 24px", textAlign: "center", color: "#667" }}>
    <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
    <div style={{ fontWeight: 700, fontSize: 16, color: "#334", marginBottom: 6 }}>Not available for your role</div>
    <p style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 380, margin: "0 auto" }}>
      You're signed in as <strong>{ROLE_LABELS[role] || "an unknown role"}</strong>. Ask the owner if you need access to this section.
    </p>
  </div>
);

// A loud, blocking popup shown whenever a write is attempted with no connection. The app saves
// only while online (owner's choice), so this is a hard stop — not a passing toast.
function OfflineBlockModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={S.blockOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="alertdialog" aria-modal="true" aria-label="You are offline — change not saved">
      <div style={S.blockCard}>
        <div style={{ fontSize: 46, lineHeight: 1 }}>📴</div>
        <div style={{ fontSize: 21, fontWeight: 900, color: "#fff", marginTop: 10 }}>You're offline</div>
        <div style={{ fontSize: 14, color: "#FFE3DE", marginTop: 8, lineHeight: 1.55 }}>
          Your change was <b style={{ color: "#fff" }}>NOT saved</b>. Salon Manager only saves while you're
          connected to the internet — nothing is stored on this device. Reconnect and try again.
        </div>
        <button className="btn" style={{ marginTop: 18, background: "#fff", color: "#B3261E", fontWeight: 800 }} onClick={onClose} autoFocus>Got it</button>
      </div>
    </div>
  );
}

/**
 * "The bill did not reach the customer" — the same loud red hard-stop as a blocked offline write.
 *
 * Deliberately a modal and not a toast. A send failure is not an FYI: the salon believes the
 * customer has their bill, and nobody is watching the corner of the screen for three seconds
 * while they hand back a card. It also carries the fix (enable Storage, deploy the rules), and a
 * toast is the wrong place to put an instruction someone has to act on. It waits to be dismissed.
 */
function SendFailedModal({ message, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={S.blockOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="alertdialog" aria-modal="true" aria-label="Bill not sent">
      <div style={S.blockCard}>
        <div style={{ fontSize: 46, lineHeight: 1 }}>⚠️</div>
        <div style={{ fontSize: 21, fontWeight: 900, color: "#fff", marginTop: 10 }}>Bill not sent</div>
        <div style={{ fontSize: 14, color: "#FFE3DE", marginTop: 8, lineHeight: 1.55 }}>
          The customer has <b style={{ color: "#fff" }}>NOT</b> received this bill. The sale itself is
          saved — only sending failed, so you can print it or try again.
        </div>
        {/* The reason sits in its own inset panel: it can be a shell command, and it must be
            readable and selectable rather than run together with the sentence above. */}
        <div style={{ fontSize: 13, color: "#fff", marginTop: 12, lineHeight: 1.5, background: "rgba(0,0,0,.24)", border: "1px solid rgba(255,255,255,.38)", borderRadius: 10, padding: "10px 12px", textAlign: "left", wordBreak: "break-word", userSelect: "text" }}>
          {message}
        </div>
        <button className="btn" style={{ marginTop: 18, background: "#fff", color: "#B3261E", fontWeight: 800 }} onClick={onClose} autoFocus>Got it</button>
      </div>
    </div>
  );
}

// Always-on connection status. Fixed to the viewport so it shows on every screen; turns red and
// pulses the moment the connection drops, since that now blocks every save.
const ConnBadge = ({ online }) => (
  <div
    className={"connbadge" + (online ? "" : " connbadge-off")}
    style={{ ...S.connBadge, ...(online ? S.connOn : S.connOff) }}
    role="status" aria-live="polite"
    title={online ? "Connected — changes save live" : "No internet — changes are blocked until you reconnect"}
  >
    <span style={{ width: 9, height: 9, borderRadius: "50%", background: online ? "#12B76A" : "#fff", display: "inline-block" }} />
    {online ? "Online" : "OFFLINE"}
  </div>
);

// One entry in the sidebar, the collapsed tablet rail, or the phone's "More" sheet.
//
// The label is wrapped in a span rather than left as a bare text node for one reason: the
// tablet's icon-only rail hides it with CSS, and CSS cannot address a bare text node. The
// title/aria-label carry the same text, so while the label is hidden the name is still there
// for a long-press, a screen reader, and a keyboard user.
const NavButton = ({ icon, label, active, badge = 0, sub = false, onClick }) => (
  <button
    className={"navbtn" + (sub ? " sub" : "") + (active ? " active" : "")}
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-current={active ? "page" : undefined}
  >
    <span className="navico" aria-hidden="true" style={{ width: 22, display: "inline-block", textAlign: "center" }}>{icon}</span>
    <span className="navlabel">{label}</span>
    {badge > 0 && <span className="badge-n" style={S.badge}>{badge}</span>}
  </button>
);

// Page title plus that screen's actions. flexWrap is the load-bearing bit: several headers carry
// four controls including a date field (Appointments), which on a 360px phone would otherwise
// crush the title into two characters. Wrapped, the actions drop to their own full-width row.
const Header = ({ title, sub, children }) => (
  <div className="pagehead" style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap", marginBottom: 18, gap: 12 }}>
    <div style={{ minWidth: 0 }}>
      <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-0.03em" }}>{title}</h1>
      {sub && <div style={{ color: "var(--text-mid, #6B7E74)", fontSize: 13, marginTop: 2 }}>{sub}</div>}
    </div>
    <div className="pagehead-actions" style={{ marginLeft: "auto" }}>{children}</div>
  </div>
);

const Card = ({ label, value, sub, accent }) => (
  <div style={{ ...S.card, ...(accent ? { background: "var(--brand)", color: "#fff" } : {}) }}>
    <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.07em", color: accent ? "#A8CDBA" : "#7A8C81" }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 800, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    <div style={{ fontSize: 12, color: accent ? "#C8E2D4" : "var(--text-mid, #8A9C90)" }}>{sub}</div>
  </div>
);

const Field = ({ label, children }) => (
  <label style={{ display: "block", marginBottom: 10 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "#465", marginBottom: 4 }}>{label}</div>
    {children}
  </label>
);

const Empty = ({ text, children }) => (
  <div style={{ padding: "22px 10px", textAlign: "center", color: "#8A9", fontSize: 13 }}>
    {text}
    {children && <div style={{ marginTop: 10 }}>{children}</div>}
  </div>
);

function Modal({ title, children, onClose }) {
  // Only close when the *press* started on the backdrop itself. Relying on the
  // click target alone closed the dialog whenever a drag (e.g. selecting digits
  // in a number field) began inside an input but released on the overlay.
  const downOnOverlay = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="overlay"
      style={S.overlay}
      onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnOverlay.current) onClose(); }}
      role="dialog" aria-modal="true" aria-label={title}
    >
      <div className="modal" style={S.modal}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          <button className="btn ghost small" style={{ marginLeft: "auto" }} aria-label="Close dialog" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}


export { Splash, NoAccess, OfflineBlockModal, SendFailedModal, ConnBadge, NavButton, Header, Card, Field, Empty, Modal };
