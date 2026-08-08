// Logs — extracted from salon-manager.jsx.

import { Empty, Header } from "../components/primitives.jsx";
import { S } from "../lib/ui/css.js";
import { todayStr } from "../lib/ui/format.js";
import { LOG_TYPES } from "../lib/ui/store.js";
import { useState } from "react";

// ---------- Activity Log ----------
const LOG_COLORS = { sale: "#1b5e43", inventory: "#2A6FB0", expense: "#C44536", import: "#7A5AB0", backup: "#7A6A1E", bill: "#0E7C86" };

function Logs({ logs, setLogs, notify }) {
  const [date, setDate] = useState(""); // "" = all dates
  const [type, setType] = useState("all");

  const filtered = logs.filter((l) => (!date || l.date === date) && (type === "all" || l.type === type));

  const clear = () => {
    if (confirm("Clear the entire activity log? This cannot be undone (it does not affect sales or stock).")) {
      setLogs([]);
      notify("Activity log cleared");
    }
  };

  return (
    <div>
      <Header title="Activity Log" sub={logs.length + " events recorded — every change is logged here"}>
        {logs.length > 0 && <button className="btn ghost small" onClick={clear}>Clear log</button>}
      </Header>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--text-mid, #6B7E74)" }}>Day <input type="date" className="input" style={{ width: "auto", marginLeft: 4 }} value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} /></label>
        <select className="input" style={{ width: 180 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All activity</option>
          {LOG_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </select>
        {(date || type !== "all") && <button className="btn ghost small" onClick={() => { setDate(""); setType("all"); }}>Show all</button>}
      </div>

      <section style={S.panel}>
        {filtered.length === 0 ? (
          <Empty text={logs.length === 0 ? "No activity yet. Actions you take in the app will appear here." : "No activity matches this filter."} />
        ) : (
          <table className="tbl">
            <thead><tr><th style={{ width: 168 }}>When</th><th style={{ width: 96 }}>Type</th><th>Activity</th></tr></thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: "nowrap", color: "#677" }}>{l.date} <span style={{ color: "#9AA" }}>{l.time}</span></td>
                  <td><span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: LOG_COLORS[l.type] || "#555" }}>{l.type}</span></td>
                  <td>{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}


export { Logs };
export default Logs;
