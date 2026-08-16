// Appointments — extracted from salon-manager.jsx.

import { Empty, Field, Header, Modal } from "../components/primitives.jsx";
import { DEFAULT_HOURS, SLOT_MIN, STATUS_COLORS as APPT_STATUS_COLORS, STATUS_LABELS as APPT_STATUS_LABELS, addDays, blankAppointment, dayAppointments, dayStats, endMin, findConflicts, layoutDay, parseHM, slotsBetween, summarizeServices, toClock, toHM, validateAppointment, weekStrip } from "../lib/appointments.js";
import { MQ } from "../lib/breakpoints.js";
import { can } from "../lib/roles.js";
import { activeServices, activeStaff, staffName } from "../lib/salon.js";
import { resolveIcon } from "../lib/serviceIcons.js";
import { INR, todayStr, uid } from "../lib/ui/format.js";
import { useMediaQuery } from "../lib/ui/hooks.js";
import { useMemo, useState } from "react";
import { S } from "../lib/ui/css.js";
import { ServiceIcon } from "../components/ServiceIcon.jsx";
import { CustomerPicker, makeCustomer, validateCustomer } from "../components/CustomerPicker.jsx";
import { blankCustomer, formatPhone } from "../lib/customers.js";

// ---------- Appointments ----------
// A hand-rolled CSS-grid day view: one column per working stylist, 15-minute rows down the
// side, absolutely-positioned blocks on top. No calendar library — the grid IS the layout, and
// a dependency would be more code than this, not less.
//
// The vertical scale is one constant: PX_PER_MIN. Every block's top and height derive from it,
// so the grid and the blocks can never disagree about where 3pm is.
const PX_PER_MIN = 1.5; // 15-min slot = 22.5px — thumb-sized on a phone, a full day on a laptop

function Appointments({
  appointments, setAppointments, customers, setCustomers, services, staff, config,
  notify, log, role, perms, onCompleteToBill,
}) {
  const [date, setDate] = useState(todayStr());
  const [editing, setEditing] = useState(null); // an appointment draft, or null
  const [err, setErr] = useState("");

  // Working hours come from Settings; the defaults are a normal Indian salon day.
  const hours = useMemo(() => ({
    openMin: parseHM(config?.openTime) || DEFAULT_HOURS.openMin,
    closeMin: parseHM(config?.closeTime) || DEFAULT_HOURS.closeMin,
  }), [config?.openTime, config?.closeTime]);

  const allColumns = useMemo(() => activeStaff(staff), [staff]);
  // On a phone the diary shows ONE stylist at a time. Five 140px columns behind a 56px time
  // gutter is 756px of grid on a 360px screen: everything worth reading is off to the right, and
  // finding a free slot means scrolling sideways through columns you weren't asking about. The
  // grid itself is unchanged — it just gets handed one column — so the sideways scroll is still
  // there for a tablet, where several stylists do fit.
  const isPhone = useMediaQuery(MQ.phone);
  const [soloStaff, setSoloStaff] = useState("");
  // Falls back to the first stylist whenever the chosen one is deactivated or not yet picked, so
  // the diary can never render zero columns while staff exist.
  const solo = allColumns.find((s) => s.id === soloStaff) || allColumns[0];
  // Memoised, not computed inline: `columns` feeds the useMemo that lays out the day's blocks,
  // and a fresh array identity on every render would recompute that layout on every keystroke.
  const columns = useMemo(() => (isPhone && solo ? [solo] : allColumns), [isPhone, solo, allColumns]);
  const slots = useMemo(() => slotsBetween(hours.openMin, hours.closeMin, SLOT_MIN), [hours]);
  const gridHeight = (hours.closeMin - hours.openMin) * PX_PER_MIN;
  const stats = useMemo(() => dayStats(appointments, date), [appointments, date]);
  const strip = useMemo(() => weekStrip(date), [date]);
  const byId = useMemo(() => new Map(customers.map((c) => [c.phone, c])), [customers]);
  // Icon key per service id, for the blocks. Resolved once per menu change, not per block.
  const iconByService = useMemo(
    () => new Map((services || []).map((s) => [s.id, resolveIcon(s)])),
    [services]
  );

  // Lay each stylist's day out independently: a clash in one chair must not shove another
  // stylist's column around.
  const laidByStaff = useMemo(() => {
    const m = {};
    for (const s of columns) m[s.id] = layoutDay(dayAppointments(appointments, date, s.id));
    return m;
  }, [appointments, date, columns]);

  const openNew = (staffId, startMin) => {
    setErr("");
    setEditing({ ...blankAppointment(date, staffId, startMin, todayStr()), id: "" });
  };
  const openEdit = (a) => { setErr(""); setEditing({ ...a }); };
  const close = () => { setEditing(null); setErr(""); };

  const save = () => {
    const draft = editing;
    // Duration is derived from the chosen services, so a booking always reserves as long as
    // the work actually takes. Blocked time is hand-set — it isn't services.
    const summary = summarizeServices(draft.serviceIds, services);
    const durationMin = draft.status === "blocked" ? Number(draft.durationMin) || SLOT_MIN : summary.durationMin;
    const form = { ...draft, durationMin };
    const problem = validateAppointment(form, appointments, hours);
    if (problem) return setErr(problem);
    const isNew = !form.id;
    const rec = { ...form, id: isNew ? uid() : form.id };
    setAppointments((list) => (isNew ? [...list, rec] : list.map((a) => (a.id === rec.id ? rec : a))));
    const who = rec.customerPhone ? byId.get(rec.customerPhone)?.name || rec.customerPhone : "blocked time";
    log("sale", `${isNew ? "Booked" : "Updated"} ${rec.status === "blocked" ? "blocked time" : "appointment"} — ${who} · ${date} ${toClock(rec.startMin)} · ${staffName(staff, rec.staffId)}`);
    notify(isNew ? "✓ Booked" : "✓ Appointment updated");
    close();
  };

  const setStatus = (a, status) => {
    setAppointments((list) => list.map((x) => (x.id === a.id ? { ...x, status } : x)));
    log("sale", `Appointment marked ${APPT_STATUS_LABELS[status]} — ${a.date} ${toClock(a.startMin)} · ${staffName(staff, a.staffId)}`);
    notify(`Marked ${APPT_STATUS_LABELS[status].toLowerCase()}`);
    close();
  };

  const remove = (a) => {
    if (!confirm(`Delete this ${a.status === "blocked" ? "blocked time" : "appointment"}? To keep it on the record instead, mark it cancelled.`)) return;
    setAppointments((list) => list.filter((x) => x.id !== a.id));
    log("sale", `Deleted appointment — ${a.date} ${toClock(a.startMin)} · ${staffName(staff, a.staffId)}`);
    notify("Deleted");
    close();
  };

  if (columns.length === 0) {
    return (
      <div>
        <Header title="Appointments" />
        <Empty text="No active staff — the diary needs at least one stylist to have a column." />
      </div>
    );
  }

  return (
    <div>
      <Header title="Appointments" sub={`${stats.total} booked · ${stats.completed} done${stats.noShow ? ` · ${stats.noShow} no-show` : ""}`}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <input type="date" className="input" style={{ width: "auto" }} value={date} onChange={(e) => setDate(e.target.value || todayStr())} />
          <button className="btn" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
          <button className="btn" onClick={() => setDate(todayStr())} disabled={date === todayStr()}>Today</button>
        </div>
      </Header>

      {/* Compact week strip — the fastest way to hop a few days without opening a date picker. */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, overflowX: "auto" }}>
        {strip.map((d) => {
          const n = dayStats(appointments, d).total;
          const active = d === date;
          return (
            <button
              key={d} onClick={() => setDate(d)}
              style={{
                flex: 1, minWidth: 54, padding: "6px 4px", borderRadius: 8, cursor: "pointer",
                border: d === todayStr() ? "1.5px solid var(--brand)" : "1px solid #DDE5DF",
                background: active ? "var(--brand)" : "#fff", color: active ? "#fff" : "#334",
              }}
            >
              <div style={{ fontSize: 10.5, opacity: 0.8 }}>{new Date(d + "T00:00").toLocaleDateString("en-IN", { weekday: "short" })}</div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{new Date(d + "T00:00").getDate()}</div>
              <div style={{ fontSize: 10, opacity: 0.85 }}>{n ? `${n} appt` : "—"}</div>
            </button>
          );
        })}
      </div>

      {/* Phone only: which stylist's day is on screen. A scrolling chip row rather than a
          <select>, so switching between two stylists is one tap and the colour dot that keys
          the diary is visible in the switcher too. */}
      {isPhone && allColumns.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }} role="tablist" aria-label="Stylist">
          {allColumns.map((s) => {
            const on = s.id === solo?.id;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                onClick={() => setSoloStaff(s.id)}
                className="btn small"
                style={{
                  flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6,
                  background: on ? "var(--brand)" : "var(--btn-bg, var(--brand-soft))",
                  color: on ? "#fff" : "var(--btn-fg, var(--brand-soft-text))",
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, display: "inline-block", flexShrink: 0 }} />
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      <section style={{ ...S.panel, padding: 0, overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: `56px repeat(${columns.length}, minmax(140px, 1fr))`, minWidth: 56 + columns.length * 140 }}>
          {/* header row */}
          <div style={{ position: "sticky", left: 0, background: "var(--surface, #fff)", zIndex: 2, borderBottom: "1px solid var(--border, #E2EAE3)" }} />
          {columns.map((s) => (
            <div key={s.id} style={{ padding: "8px 6px", textAlign: "center", borderBottom: "1px solid #E2EAE3", borderLeft: "1px solid #EEF3EE" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, display: "inline-block" }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</span>
              </div>
            </div>
          ))}

          {/* Time gutter. `sticky` (not `relative`) so the times stay visible while the staff
              columns scroll sideways on a phone — and sticky is itself a non-static position,
              so it still anchors the absolutely-placed labels below. */}
          <div style={{ position: "sticky", left: 0, background: "var(--surface, #fff)", zIndex: 2, height: gridHeight }}>
            {slots.map((t) => (
              <div
                key={t}
                style={{
                  position: "absolute", top: (t - hours.openMin) * PX_PER_MIN, right: 6,
                  fontSize: 10.5, color: t % 60 === 0 ? "var(--text-mid, #5E7468)" : "#C3CFC7",
                  fontWeight: t % 60 === 0 ? 700 : 400, transform: "translateY(-50%)",
                }}
              >
                {t % 60 === 0 ? toClock(t) : ""}
              </div>
            ))}
          </div>

          {/* one column per stylist */}
          {columns.map((s) => (
            <div key={s.id} style={{ position: "relative", height: gridHeight, borderLeft: "1px solid #EEF3EE" }}>
              {/* Empty slots: the tap target for a new booking. Rendering one button per slot
                  (rather than one click handler with maths) means the tap target is the slot
                  itself — which is what makes this usable with a thumb at the counter. */}
              {slots.map((t) => (
                <button
                  key={t}
                  onClick={() => can(role, "appointments.edit", perms) && openNew(s.id, t)}
                  aria-label={`Book ${s.name} at ${toClock(t)}`}
                  style={{
                    position: "absolute", top: (t - hours.openMin) * PX_PER_MIN, left: 0, right: 0,
                    height: SLOT_MIN * PX_PER_MIN, border: "none", background: "none",
                    borderTop: t % 60 === 0 ? "1px solid #E2EAE3" : "1px dotted #F0F4F1",
                    cursor: can(role, "appointments.edit", perms) ? "pointer" : "default", padding: 0,
                  }}
                />
              ))}
              {(laidByStaff[s.id] || []).map(({ appt, col, cols }) => {
                const top = (appt.startMin - hours.openMin) * PX_PER_MIN;
                const h = Math.max(18, (Number(appt.durationMin) || 0) * PX_PER_MIN);
                const cust = appt.customerPhone ? byId.get(appt.customerPhone) : null;
                const dim = appt.status === "cancelled" || appt.status === "no-show";
                const color = APPT_STATUS_COLORS[appt.status] || s.color;
                // The icon rides along only on blocks with room for it: two slots (30 min) or
                // more. On a 15-minute threading slot the name is all that fits, and a glyph
                // crowding it out would cost more than it tells anyone.
                const roomy = (Number(appt.durationMin) || 0) >= SLOT_MIN * 2;
                const firstService = roomy && appt.status !== "blocked" ? (appt.serviceIds || [])[0] : null;
                const blockIcon = firstService ? iconByService.get(firstService) : null;
                return (
                  <button
                    key={appt.id}
                    className="svc-on-color"
                    onClick={() => openEdit(appt)}
                    title={`${toClock(appt.startMin)}–${toClock(endMin(appt))} · ${APPT_STATUS_LABELS[appt.status]}`}
                    style={{
                      position: "absolute", top, height: h,
                      left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`,
                      background: appt.status === "blocked" ? "var(--blocked-fill, repeating-linear-gradient(45deg, #E7EBE8, #E7EBE8 5px, #DDE3DF 5px, #DDE3DF 10px))" : color,
                      color: appt.status === "blocked" ? "var(--blocked-ink, #5B6B62)" : "#fff",
                      border: "none", borderRadius: 6, padding: "3px 5px", cursor: "pointer",
                      textAlign: "left", overflow: "hidden", opacity: dim ? 0.5 : 1,
                      textDecoration: appt.status === "cancelled" ? "line-through" : "none",
                      fontSize: 11.5, lineHeight: 1.25,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden" }}>
                      {blockIcon && <ServiceIcon icon={blockIcon} size={14} />}
                      {/* Booked on the public link. The desk hasn't spoken to this person and
                          the number isn't verified, so the block says where it came from. */}
                      {appt.source === "online" && <span aria-hidden="true" title="Booked online">🌐</span>}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {/* An online booking has no shop/customers record yet — the customer's
                            page cannot create one — so the name it carries is the only name
                            there is. Without this fallback the desk would read "Walk-in" for
                            somebody who told the salon exactly who they were. */}
                        {appt.status === "blocked" ? "⛔ Blocked" : cust?.name || appt.customerName || "Walk-in"}
                      </span>
                    </div>
                    {h > 30 && (
                      <div style={{ opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {toClock(appt.startMin)} · {summarizeServices(appt.serviceIds, services).names.join(", ") || appt.note || ""}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <AppointmentModal
          draft={editing} setDraft={setEditing} err={err}
          services={services} staff={staff} customers={customers} setCustomers={setCustomers}
          appointments={appointments} notify={notify} role={role} perms={perms}
          onSave={save} onClose={close} onStatus={setStatus} onDelete={remove}
          onCompleteToBill={onCompleteToBill}
        />
      )}
    </div>
  );
}

// The booking editor. One modal for create, edit, block-out and status changes — a booking is
// a small enough thing that splitting those into separate screens would be more clicks, not
// more clarity.
function AppointmentModal({
  draft, setDraft, err, services, staff, customers, setCustomers, appointments,
  notify, role, perms, onSave, onClose, onStatus, onDelete, onCompleteToBill,
}) {
  const isNew = !draft.id;
  const isBlock = draft.status === "blocked";
  const summary = useMemo(() => summarizeServices(draft.serviceIds, services), [draft.serviceIds, services]);
  const live = useMemo(() => activeServices(services), [services]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const toggleService = (id) =>
    setDraft((d) => ({
      ...d,
      serviceIds: d.serviceIds.includes(id) ? d.serviceIds.filter((x) => x !== id) : [...d.serviceIds, id],
    }));

  // File an online booking's customer onto the real customer list, with the name and number
  // they gave. Goes through the same validate/make pair the picker's quick-create uses, so a
  // customer created this way is indistinguishable from one typed in at the counter.
  const saveOnlineCustomer = () => {
    const rec = makeCustomer(
      { ...blankCustomer(draft.customerPhone, todayStr()), name: draft.customerName },
      { createdAt: todayStr() }
    );
    const problem = validateCustomer(rec, customers, true);
    if (problem) return notify(`⚠ ${problem}`);
    setCustomers((list) => [...list, rec]);
    notify(`✓ ${rec.name} added`);
  };

  // Free/busy feedback while the time is being chosen, rather than only on save. The front desk
  // is talking to a customer — "3:15 is free" beats a rejection after the fact.
  const clash = useMemo(() => {
    const durationMin = isBlock ? Number(draft.durationMin) || SLOT_MIN : summary.durationMin;
    if (!durationMin || !draft.staffId) return null;
    return findConflicts(appointments, { ...draft, durationMin, exceptId: draft.id })[0] || null;
  }, [draft, appointments, summary.durationMin, isBlock]);

  return (
    <Modal title={isNew ? (isBlock ? "Block out time" : "New appointment") : isBlock ? "Blocked time" : "Appointment"} onClose={onClose}>
      {/* Blocked time is a different kind of thing — no customer, no services, just a chunk of
          the day that isn't bookable. Toggling here rather than in a separate flow keeps the
          "carve out lunch" case one tap away. */}
      {isNew && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[["booked", "Appointment"], ["blocked", "Block out time"]].map(([s, label]) => (
            <button key={s} className={"btn" + (draft.status === s ? " primary" : "")} style={{ flex: 1 }} onClick={() => set("status", s)}>{label}</button>
          ))}
        </div>
      )}

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Date"><input type="date" className="input" value={draft.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Staff">
          <select className="input" value={draft.staffId} onChange={(e) => set("staffId", e.target.value)}>
            <option value="">Choose…</option>
            {activeStaff(staff).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Start time">
          <input type="time" className="input" step={SLOT_MIN * 60} value={toHM(draft.startMin)} onChange={(e) => { const v = parseHM(e.target.value); if (Number.isFinite(v)) set("startMin", v); }} />
        </Field>
        {isBlock ? (
          <Field label="Length (minutes)">
            <input className="input" type="number" inputMode="decimal" min={SLOT_MIN} step={SLOT_MIN} value={draft.durationMin} onChange={(e) => set("durationMin", +e.target.value || SLOT_MIN)} />
          </Field>
        ) : (
          <Field label="Ends">
            <input className="input" value={summary.durationMin ? toClock(draft.startMin + summary.durationMin) : "—"} disabled title="Worked out from the services chosen" />
          </Field>
        )}
      </div>

      {!isBlock && (
        <>
          {/* A booking that came in on the public link. The customer gave their name and number
              but has no shop/customers record — the booking page cannot write one, deliberately,
              because that node's rules would let an unauthenticated write RENAME an existing
              customer. So the details ride on the appointment until somebody here files them,
              and until then the picker below has nothing to show. */}
          {draft.source === "online" && !customers.some((c) => c.phone === draft.customerPhone) && (
            <div style={{ background: "var(--surface-2, #F4FAF6)", border: "1px solid var(--tint-info-border, #CFE3D7)", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 12.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>🌐 Booked online</div>
              <div style={{ color: "var(--text-mid, #6B7E74)", marginBottom: 6 }}>
                {draft.customerName || "No name given"} · {formatPhone(draft.customerPhone) || "no number"}
                {" — not on the customer list yet. The number hasn't been verified; ring to confirm."}
              </div>
              {draft.customerName && draft.customerPhone && (
                <button className="btn small" onClick={saveOnlineCustomer}>Add to customer list</button>
              )}
            </div>
          )}

          <Field label="Customer">
            <CustomerPicker
              customers={customers} value={draft.customerPhone} onPick={(p) => set("customerPhone", p)}
              onCreate={(rec) => setCustomers((list) => [...list, rec])} notify={notify}
            />
          </Field>

          <Field label={`Services${summary.durationMin ? ` · ${summary.durationMin} min · ${INR(summary.price)}` : ""}`}>
            <div style={{ maxHeight: 170, overflowY: "auto", border: "1px solid #DDE5DF", borderRadius: 9, padding: 6 }}>
              {live.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-mid, #8A9C90)", padding: 4 }}>No services on the menu yet.</div>
              ) : live.map((s) => (
                <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={draft.serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <span style={{ color: "var(--text-mid, #8A9C90)", fontSize: 12 }}>{s.durationMin}m</span>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{INR(s.price)}</span>
                </label>
              ))}
            </div>
          </Field>
        </>
      )}

      <Field label="Note">
        <input className="input" placeholder={isBlock ? "e.g. lunch, training" : "e.g. wants the same colour as last time"} value={draft.note || ""} onChange={(e) => set("note", e.target.value)} />
      </Field>

      {clash && (
        <div style={{ background: "var(--tint-warm, #FFF4E5)", border: "1px solid var(--tint-warm-border, #F0D0A0)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, color: "#8A5A14", marginBottom: 8 }}>
          ⚠ {staffName(staff, draft.staffId)} is already busy {toClock(clash.startMin)}–{toClock(endMin(clash))}.
        </div>
      )}
      {err && <div style={{ color: "#B23B2E", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}

      {/* Status changes only make sense on a saved booking. */}
      {!isNew && !isBlock && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {["booked", "completed", "no-show", "cancelled"].map((s) => (
            <button
              key={s} className={"btn small" + (draft.status === s ? " primary" : " ghost")}
              onClick={() => onStatus(draft, s)}
            >{APPT_STATUS_LABELS[s]}</button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 6, flexWrap: "wrap" }}>
        <div>
          {!isNew && can(role, "appointments.edit", perms) && (
            <button className="btn ghost" style={{ color: "#C44536" }} onClick={() => onDelete(draft)}>Delete</button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={onClose}>Close</button>
          {/* The whole point of the diary: turn a finished appointment into a bill, pre-filled,
              without re-typing the customer, the services or who did them. */}
          {!isNew && !isBlock && draft.status !== "cancelled" && can(role, "billing.use", perms) && (
            draft.billId ? (
              <span style={{ alignSelf: "center", fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>✓ Billed</span>
            ) : (
              <button className="btn primary" onClick={() => onCompleteToBill(draft)}>Complete → Bill</button>
            )
          )}
          {can(role, "appointments.edit", perms) && <button className="btn primary" onClick={onSave}>{isNew ? "Book" : "Save"}</button>}
        </div>
      </div>
    </Modal>
  );
}


export { Appointments };
export default Appointments;
