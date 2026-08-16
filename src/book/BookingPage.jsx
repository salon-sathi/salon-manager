// The public booking page. One screen, no sign-in, no routes.
//
// It reads `shop/public` — a PII-free projection the salon's own devices publish — and writes a
// single record into `shop/publicBookings`. It cannot read the diary, the customer list or the
// config, and it does not know a stylist's name: a chair is an opaque id here, and which one
// takes the booking is decided by the salon's app when it imports it.
//
// Imports only from src/lib/* and src/book/*. Never the shell, never a view: this bundle is
// downloaded by customers on phones, and dragging the till in would cost them the whole app.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bookableSlots, buildInboxEntry, buildInboxStub, canBook, dateInZone, isSafeHttpUrl,
  minutesInZone, occupancyForDate, publicServiceList, slotWindow, summarizePublic,
  validateBookingForm,
} from "../lib/booking.js";
import { toClock } from "../lib/appointments.js";
import { INR, uid } from "../lib/ui/format.js";
import { themeVars } from "../lib/ui/store.js";
import { readSlots, sendBooking, stamp, watchPublic } from "./db.js";
import { CSS } from "./css.js";

/** "2026-08-16" → "Sat 16 Aug". Built from the parts so the string is never re-parsed as UTC. */
function dayLabel(date) {
  const d = new Date(`${date}T00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const groupByCategory = (list) => {
  const out = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && last.category === s.category) last.items.push(s);
    else out.push({ category: s.category || "Services", items: [s] });
  }
  return out;
};

export default function BookingPage() {
  // undefined = still reading, null = nothing published (the salon has never switched this on)
  const [profile, setProfile] = useState(undefined);
  const [services, setServices] = useState({});
  const [chairs, setChairs] = useState({});
  const [slots, setSlots] = useState({});
  const [loadError, setLoadError] = useState("");

  const [serviceIds, setServiceIds] = useState([]);
  const [date, setDate] = useState("");
  const [startMin, setStartMin] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);

  // The lead-time cutoff has to keep moving while the page sits open, or a slot that has just
  // fallen inside "we need an hour's notice" stays clickable.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fail = (what) => (e) => {
      console.error("public read failed", what, e);
      setLoadError("Couldn't reach the salon just now. Please check your connection and try again.");
      setProfile((p) => (p === undefined ? null : p));
    };
    const unsubs = [
      watchPublic("profile", (v) => setProfile(v || null), fail("profile")),
      watchPublic("services", (v) => setServices(v || {}), fail("services")),
      watchPublic("chairs", (v) => setChairs(v || {}), fail("chairs")),
      watchPublic("slots", (v) => setSlots(v || {}), fail("slots")),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const open = !!profile?.enabled;
  const timeZone = profile?.timeZone || "";
  // Not until the profile lands. dateInZone falls back to the DEVICE's zone when it has no
  // salon zone to work with, so computing this early hands back the customer's own today —
  // which for anyone east or west of the salon is the wrong day, and west of it is a day in
  // the salon's past.
  const today = useMemo(() => (profile ? dateInZone(nowMs, timeZone) : ""), [profile, nowMs, timeZone]);
  const days = useMemo(
    () => (today ? slotWindow(today, profile?.horizonDays || 14) : []),
    [today, profile?.horizonDays]
  );
  const chairIds = useMemo(() => Object.keys(chairs || {}), [chairs]);
  const menu = useMemo(() => publicServiceList(services), [services]);
  const summary = useMemo(() => summarizePublic(serviceIds, services), [serviceIds, services]);

  // Keep the chosen day inside the window the salon actually offers. This is a re-seed, not
  // just a default: a page left open past midnight would otherwise still be pointing at
  // yesterday, and the salon would get a booking for a day that has already gone.
  useEffect(() => {
    if (days.length && (!date || !days.includes(date))) setDate(days[0]);
  }, [days, date]);

  const options = useMemo(() => {
    if (!open || !date || !summary.durationMin) return [];
    return bookableSlots(occupancyForDate(slots, date), chairIds, {
      openMin: profile.openMin,
      closeMin: profile.closeMin,
      durationMin: summary.durationMin,
      capacity: profile.capacity,
      // Only today is bounded by the notice period; a later day is open from opening time.
      minStartMin: date === today ? minutesInZone(nowMs, timeZone) + (profile.leadMinutes || 0) : -Infinity,
    });
  }, [open, date, today, nowMs, timeZone, slots, chairIds, summary.durationMin, profile]);

  // A chosen time that stops being available — because somebody else booked it, or because the
  // notice window rolled past it — has to let go of itself, or Confirm would send a slot the
  // page is no longer showing.
  useEffect(() => {
    if (startMin != null && !options.some((o) => o.startMin === startMin)) setStartMin(null);
  }, [options, startMin]);

  const toggleService = useCallback((id) => {
    setErr("");
    setStartMin(null); // a different basket is a different length, so the grid changes under it
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }, []);

  const submit = async () => {
    setErr("");
    const form = { serviceIds, date, startMin, name, phone, note };
    const problem = validateBookingForm(form);
    if (problem) return setErr(problem);

    setSending(true);
    const id = uid();
    try {
      // Re-read the occupancy immediately before writing. This does not close the race — nothing
      // without a server can, and two people can still confirm the same second — but it shrinks
      // the window from "however long this page has been open" to a single round trip.
      const fresh = await readSlots();
      setSlots(fresh);
      const verdict = canBook(
        occupancyForDate(fresh, date), chairIds,
        { startMin, durationMin: summary.durationMin }, profile.capacity, id
      );
      if (!verdict.ok) {
        setStartMin(null);
        setErr("Sorry — that time has just been taken. Please pick another.");
        return;
      }
      const entry = buildInboxEntry(form, { id, durationMin: summary.durationMin, stamp: stamp() });
      await sendBooking(entry, buildInboxStub(entry, stamp()));
      setDone(entry);
    } catch (e) {
      console.error("booking failed", e);
      // PERMISSION_DENIED here means the salon switched online booking off while this page was
      // open — the rules check the same flag the page does, so the page can be stale and the
      // database cannot.
      const denied = String(e?.code || e?.message || "").toUpperCase().includes("PERMISSION");
      setErr(
        denied
          ? "The salon isn't taking online bookings at the moment. Please give them a call."
          : "That didn't go through. Please check your connection and try again."
      );
    } finally {
      setSending(false);
    }
  };

  const style = themeVars(profile?.theme);
  const shell = (children) => (
    <div className="bk" style={style}>
      <style>{CSS}</style>
      {children}
    </div>
  );

  if (profile === undefined) {
    return shell(<div className="bk-card bk-msg"><p>Loading…</p></div>);
  }

  const mapsUrl = isSafeHttpUrl(profile?.mapsUrl) ? profile.mapsUrl : "";
  const header = (
    <header className="bk-head">
      <h1>{profile?.name || "Book an appointment"}</h1>
      {profile?.tagline && <p className="bk-tag">{profile.tagline}</p>}
      {profile?.address && <p className="bk-addr">{profile.address}</p>}
      <div className="bk-links">
        {/* noopener/noreferrer on a link whose target comes from stored config: it is validated
            on save and again here, and this is the last line of that defence. */}
        {mapsUrl && <a className="bk-btn bk-ghost" href={mapsUrl} target="_blank" rel="noopener noreferrer">📍 Get directions</a>}
        {profile?.phone && <a className="bk-btn bk-ghost" href={`tel:${profile.phone.replace(/\s+/g, "")}`}>📞 Call the salon</a>}
      </div>
    </header>
  );

  if (done) {
    return shell(
      <main className="bk-wrap">
        {header}
        <div className="bk-card bk-ok">
          <div className="bk-tick" aria-hidden="true">✓</div>
          <h2>You're booked</h2>
          <p className="bk-big">{dayLabel(done.date)} at {toClock(done.startMin)}</p>
          <p>{summary.names.join(", ")} · {summary.durationMin} min</p>
          <p className="bk-fine">
            Booked for <b>{done.customerName}</b> on {done.customerPhone}. The salon can see it
            already — they'll call if anything needs changing. To cancel or move it, give them a ring.
          </p>
          {mapsUrl && <a className="bk-btn bk-ghost" href={mapsUrl} target="_blank" rel="noopener noreferrer">📍 Get directions</a>}
        </div>
      </main>
    );
  }

  if (!open) {
    return shell(
      <main className="bk-wrap">
        {header}
        <div className="bk-card bk-msg">
          <h2>Online booking isn't open</h2>
          <p>{loadError || "This salon isn't taking bookings through this page at the moment. Please give them a call to book."}</p>
        </div>
      </main>
    );
  }

  const step = (n, title, sub) => (
    <div className="bk-step">
      <span className="bk-num" aria-hidden="true">{n}</span>
      <div><h2>{title}</h2>{sub && <p className="bk-fine">{sub}</p>}</div>
    </div>
  );

  return shell(
    <main className="bk-wrap">
      {header}
      {profile.noticeText && <p className="bk-notice">{profile.noticeText}</p>}

      <section className="bk-card">
        {step(1, "What would you like?", "Pick one or more — we'll work out how long it takes.")}
        {menu.length === 0 ? (
          <p className="bk-fine">The salon hasn't published its menu yet. Please give them a call.</p>
        ) : (
          groupByCategory(menu).map((group) => (
            <div key={group.category} className="bk-group">
              <h3>{group.category}</h3>
              {group.items.map((s) => (
                <label key={s.id} className={"bk-svc" + (serviceIds.includes(s.id) ? " on" : "")}>
                  <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                  <span className="bk-svc-name">{s.name}</span>
                  <span className="bk-svc-min">{s.durationMin} min</span>
                  <span className="bk-svc-rs">{INR(s.price)}</span>
                </label>
              ))}
            </div>
          ))
        )}
        {summary.durationMin > 0 && (
          <p className="bk-total">
            {summary.names.length} selected · <b>{summary.durationMin} min</b> · <b>{INR(summary.price)}</b>
          </p>
        )}
      </section>

      <section className="bk-card">
        {step(2, "When suits you?")}
        <div className="bk-days" role="group" aria-label="Choose a day">
          {days.map((d) => (
            <button
              key={d} type="button" className={"bk-day" + (d === date ? " on" : "")} aria-pressed={d === date}
              onClick={() => { setDate(d); setStartMin(null); setErr(""); }}
            >
              {d === today ? "Today" : dayLabel(d)}
            </button>
          ))}
        </div>

        {!summary.durationMin ? (
          <p className="bk-fine">Choose a service above and the available times will appear here.</p>
        ) : options.length === 0 ? (
          <p className="bk-fine">
            Nothing free on {date === today ? "today" : dayLabel(date)} for {summary.durationMin} minutes.
            Try another day, or fewer services.
          </p>
        ) : (
          <div className="bk-times" role="group" aria-label="Choose a time">
            {options.map((o) => (
              <button
                key={o.startMin} type="button" className={"bk-time" + (o.startMin === startMin ? " on" : "")}
                aria-pressed={o.startMin === startMin}
                onClick={() => { setStartMin(o.startMin); setErr(""); }}
              >
                {toClock(o.startMin)}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="bk-card">
        {step(3, "Who shall we book it for?")}
        <label className="bk-field">
          <span>Your name</span>
          <input value={name} maxLength={60} autoComplete="name" onChange={(e) => { setName(e.target.value); setErr(""); }} />
        </label>
        <label className="bk-field">
          <span>Mobile number</span>
          <input value={phone} type="tel" inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile" onChange={(e) => { setPhone(e.target.value); setErr(""); }} />
        </label>
        <label className="bk-field">
          <span>Anything we should know? (optional)</span>
          <input value={note} maxLength={200} onChange={(e) => { setNote(e.target.value); setErr(""); }} />
        </label>

        {startMin != null && summary.durationMin > 0 && (
          <p className="bk-confirm-line">
            {summary.names.join(", ")} · <b>{dayLabel(date)}</b> at <b>{toClock(startMin)}</b>
          </p>
        )}
        {err && <p className="bk-err" role="alert">{err}</p>}
        <button className="bk-btn bk-primary" type="button" onClick={submit} disabled={sending}>
          {sending ? "Booking…" : "Confirm booking"}
        </button>
        <p className="bk-fine">
          We'll hold this slot for you straight away. The salon will call you on the number above
          if anything needs changing.
        </p>
      </section>
    </main>
  );
}
