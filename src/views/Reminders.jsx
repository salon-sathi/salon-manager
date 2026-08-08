// Reminders — extracted from salon-manager.jsx.

import { Empty, Field, Header, Modal } from "../components/primitives.jsx";
import { formatPhone } from "../lib/customers.js";
import { KIND_ICONS, KIND_LABELS, buildQueue, fillTemplate, reminderKey, templateVars, waLink, wasSentRecently } from "../lib/reminders.js";
import { can } from "../lib/roles.js";
import { S } from "../lib/ui/css.js";
import { todayStr } from "../lib/ui/format.js";
import { useMemo, useState } from "react";

// ---------- Reminders (owner only) ----------
// The queue of people worth contacting today, and nothing else. Every row is a fact derived
// from the bills — a service whose cycle has landed, a birthday, a package about to lapse.
//
// Sending is a WhatsApp deep link that a human taps. There is no API and no automation here:
// the salon decides, message by message. That is a deliberate constraint — it keeps them on
// the right side of both WhatsApp's terms and their customers' patience.
// `reminders.use` (sending) is something an owner can hand to a worker; editing the templates
// is not — shop/messageTemplates is owner-write-only, so a worker's save would be bounced by
// the rules. Hence the separate reminders.templates check on the ✎ Templates button.
function Reminders({ customers, setCustomers, sales, services, customerPackages, messageTemplates, setMessageTemplates, store, notify, log, role, perms }) {
  const today = todayStr();
  const [kindFilter, setKindFilter] = useState("all");
  const [hideSent, setHideSent] = useState(true);
  const [composing, setComposing] = useState(null); // { row, templateId, text }
  const [editingTemplates, setEditingTemplates] = useState(false);

  // The "already contacted" record, read off the customer records.
  const sentLog = useMemo(() => {
    const m = {};
    for (const c of customers) {
      for (const [kind, at] of Object.entries(c.remindersSentAt || {})) {
        m[reminderKey(c.phone, kind)] = at;
      }
    }
    return m;
  }, [customers]);

  const queue = useMemo(
    () => buildQueue({ customers, sales, services, customerPackages, today, sentLog }),
    [customers, sales, services, customerPackages, today, sentLog]
  );

  const counts = useMemo(() => {
    const m = { all: queue.length };
    for (const r of queue) m[r.kind] = (m[r.kind] || 0) + 1;
    return m;
  }, [queue]);

  const visible = useMemo(
    () => queue.filter((r) =>
      (kindFilter === "all" || r.kind === kindFilter) &&
      // Hide anyone contacted in the last 30 days for this same reason. Sending the same nudge
      // weekly is the fastest way for a salon to get blocked.
      !(hideSent && wasSentRecently(r.sentAt, today))
    ),
    [queue, kindFilter, hideSent, today]
  );

  const templatesFor = (kind) => messageTemplates.filter((t) => t.kind === kind && t.active !== false);

  const openCompose = (row) => {
    const options = templatesFor(row.kind);
    const t = options[0];
    const vars = templateVars(row, store.name);
    setComposing({ row, templateId: t?.id || "", text: t ? fillTemplate(t.body, vars) : "" });
  };

  const pickTemplate = (id) => setComposing((c) => {
    const t = messageTemplates.find((x) => x.id === id);
    return { ...c, templateId: id, text: t ? fillTemplate(t.body, templateVars(c.row, store.name)) : c.text };
  });

  // Mark sent. Recorded on the customer (so the queue can dedupe across devices and sessions)
  // AND in the activity log (so there's an audit trail of who contacted whom).
  const markSent = (row, { silent } = {}) => {
    setCustomers((list) => list.map((c) =>
      c.phone === row.phone ? { ...c, remindersSentAt: { ...(c.remindersSentAt || {}), [row.kind]: today } } : c
    ));
    log("settings", `Reminder sent — ${KIND_LABELS[row.kind]} to ${row.name || formatPhone(row.phone)}`);
    if (!silent) notify(`Marked as sent to ${row.name || formatPhone(row.phone)}`);
  };

  const send = (row, text) => {
    window.open(waLink(row.phone, text), "_blank", "noopener");
    markSent(row, { silent: true });
    setComposing(null);
    notify(`WhatsApp opened for ${row.name || formatPhone(row.phone)} — press send there`);
  };

  // Bulk: open each chat in turn. Sequential and manual by design — every message still needs a
  // human to press send in WhatsApp, which is the point.
  const sendAll = () => {
    if (!visible.length) return;
    if (!confirm(
      `Open a WhatsApp chat for each of these ${visible.length} customer(s), one at a time?\n\n` +
      `Each opens with the message filled in — you still press send in WhatsApp. ` +
      `They'll all be marked as contacted.\n\n` +
      `Your browser may ask to allow pop-ups.`
    )) return;
    visible.forEach((row, i) => {
      const t = templatesFor(row.kind)[0];
      if (!t) return;
      const text = fillTemplate(t.body, templateVars(row, store.name));
      // Stagger the opens: a burst of window.open() calls trips every pop-up blocker there is.
      setTimeout(() => window.open(waLink(row.phone, text), "_blank", "noopener"), i * 700);
      markSent(row, { silent: true });
    });
    notify(`Opening ${visible.length} chat(s) — press send in each`);
  };

  const KIND_TABS = [["all", "Everyone"], ...Object.entries(KIND_LABELS)];

  return (
    <div>
      <Header title="Reminders" sub={`${queue.length} customer(s) worth a message today`}>
        <div style={{ display: "flex", gap: 8 }}>
          {can(role, "reminders.templates", perms) && (
            <button className="btn" onClick={() => setEditingTemplates(true)}>✎ Templates</button>
          )}
          {visible.length > 0 && <button className="btn primary big" onClick={sendAll}>Open all {visible.length} chats</button>}
        </div>
      </Header>

      <section style={{ ...S.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {KIND_TABS.map(([k, label]) => (
            <button
              key={k} className={"btn small " + (kindFilter === k ? "primary" : "ghost")}
              onClick={() => setKindFilter(k)}
            >
              {k === "all" ? "" : KIND_ICONS[k] + " "}{label}
              {counts[k] ? ` (${counts[k]})` : ""}
            </button>
          ))}
        </div>
        <label style={{ fontSize: 12.5, color: "var(--text-mid, #6B7E74)", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={hideSent} onChange={(e) => setHideSent(e.target.checked)} />
          Hide anyone already contacted in the last 30 days
        </label>
      </section>

      {visible.length === 0 ? (
        <Empty text={queue.length ? "Everyone here has been contacted recently." : "Nobody's due a message today."} />
      ) : (
        <section style={S.panel}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead><tr><th>Customer</th><th>Why</th><th>Last contacted</th><th /></tr></thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.phone}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name || "(no name)"}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)" }}>{formatPhone(r.phone)}</div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>{KIND_ICONS[r.kind]} {KIND_LABELS[r.kind]}</span>
                      <div style={{ color: "var(--text-mid, #6B7E74)" }}>{reasonText(r)}</div>
                      {r.alsoKinds.length > 0 && (
                        <div style={{ color: "#A8B8AE", fontSize: 11 }}>
                          also: {r.alsoKinds.map((k) => KIND_LABELS[k]).join(", ")}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: r.sentAt ? "var(--text-mid, #6B7E74)" : "#C3CFC7", whiteSpace: "nowrap" }}>
                      {r.sentAt || "never"}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn small primary" onClick={() => openCompose(r)} disabled={!templatesFor(r.kind).length}>
                        💬 Message
                      </button>{" "}
                      <button className="btn small ghost" onClick={() => markSent(r)}>Mark done</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editingTemplates && (
        <MessageTemplates
          templates={messageTemplates} setTemplates={setMessageTemplates}
          store={store} notify={notify} log={log} onClose={() => setEditingTemplates(false)}
        />
      )}

      {composing && (
        <Modal title={`Message ${composing.row.name || formatPhone(composing.row.phone)}`} onClose={() => setComposing(null)}>
          <Field label="Template">
            <select className="input" value={composing.templateId} onChange={(e) => pickTemplate(e.target.value)}>
              {templatesFor(composing.row.kind).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Message">
            <textarea
              className="input" rows={5} style={{ resize: "vertical" }}
              value={composing.text} onChange={(e) => setComposing((c) => ({ ...c, text: e.target.value }))}
            />
          </Field>
          <div style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", marginTop: -4, lineHeight: 1.6 }}>
            Edit freely — this is what gets pre-filled in WhatsApp. You still press send there.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={() => setComposing(null)}>Cancel</button>
            <button className="btn primary" onClick={() => send(composing.row, composing.text)} disabled={!composing.text.trim()}>
              Open WhatsApp
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Message templates (owner only) ----------
// The seeded Hindi/English templates are a starting point, not fixtures — every salon has its
// own voice, and a message that sounds like the app wrote it gets ignored.
function MessageTemplates({ templates, setTemplates, store, notify, log, onClose }) {
  const [draft, setDraft] = useState(() => templates.map((t) => ({ ...t })));
  const dirty = JSON.stringify(draft) !== JSON.stringify(templates);

  const set = (id, k, v) => setDraft((list) => list.map((t) => (t.id === id ? { ...t, [k]: v } : t)));

  const save = () => {
    // A template with no {name} isn't a bug, but an empty body is: it would open WhatsApp with
    // nothing in it, which is worse than not offering the button.
    const empty = draft.find((t) => t.active !== false && !String(t.body || "").trim());
    if (empty) return notify(`⚠ “${empty.name}” has no message text.`);
    setTemplates(draft);
    log?.("settings", "Updated message templates");
    notify("✓ Templates saved");
    onClose();
  };

  const byKind = useMemo(() => {
    const m = new Map();
    for (const t of draft) {
      if (!m.has(t.kind)) m.set(t.kind, []);
      m.get(t.kind).push(t);
    }
    return [...m.entries()];
  }, [draft]);

  // A live preview against a plausible customer, so the owner sees the real message rather
  // than a string full of braces.
  const preview = (body) =>
    fillTemplate(body, templateVars({ name: "Asha Patil", days: 32, serviceName: "Haircut" }, store?.name));

  return (
    <Modal title="Message templates" onClose={onClose}>
      <div style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)", lineHeight: 1.7, marginBottom: 12 }}>
        Placeholders: <code>{"{name}"}</code> first name · <code>{"{service}"}</code> the service ·{" "}
        <code>{"{days}"}</code> days overdue / until expiry · <code>{"{shopName}"}</code> your salon.
        Anything else stays as literal text.
      </div>
      <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {byKind.map(([kind, list]) => (
          <div key={kind} style={{ marginBottom: 14 }}>
            <div style={S.panelHead}>{KIND_ICONS[kind]} {KIND_LABELS[kind]}</div>
            {list.map((t) => (
              <div key={t.id} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#465", flex: 1 }}>{t.name}</span>
                  <label style={{ fontSize: 11.5, color: "var(--text-mid, #8A9C90)", display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="checkbox" checked={t.active !== false} onChange={(e) => set(t.id, "active", e.target.checked)} />
                    Use this one
                  </label>
                </div>
                <textarea
                  className="input" rows={3} style={{ resize: "vertical", width: "100%", boxSizing: "border-box" }}
                  value={t.body} onChange={(e) => set(t.id, "body", e.target.value)}
                />
                <div style={{ fontSize: 11.5, color: "var(--brand)", background: "var(--surface-2, #F4FAF6)", borderRadius: 6, padding: "5px 8px", marginTop: 3 }}>
                  {preview(t.body)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!dirty}>Save templates</button>
      </div>
    </Modal>
  );
}

// Plain-English "why this person is in the queue". The owner should never have to work out
// what a row means before deciding whether to send it.
function reasonText(r) {
  switch (r.kind) {
    case "rebook":
      return r.overdueBy > 0
        ? `${r.serviceName} — ${r.overdueBy} day(s) overdue (last: ${r.days} days ago)`
        : `${r.serviceName} — due today`;
    case "birthday":
      return r.days === 0 ? "Today 🎂" : `In ${r.days} day(s)`;
    case "anniversary":
      return r.days === 0 ? "Today 💐" : `In ${r.days} day(s)`;
    case "dormant":
      return `Last visit ${r.days} days ago`;
    case "package":
      return `${r.serviceName} — ${r.usesLeft} session(s) left, expires in ${r.days} day(s)`;
    default:
      return "";
  }
}


export { Reminders };
export default Reminders;
