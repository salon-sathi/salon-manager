// Changelog — extracted from salon-manager.jsx.

import { Empty, Header } from "../components/primitives.jsx";
import { S } from "../lib/ui/css.js";
import CHANGELOG_DATA from "virtual:changelog";

// ---------- App Change Log ----------
// Data comes from git history at build time (scripts/vite-changelog-plugin.js) — CI/deploy noise is
// filtered out there, so nothing here is hand-maintained. The fallback URL only matters if the build
// had no git remote; entries are simply empty in that case and the section shows an empty state.
const REPO_URL = CHANGELOG_DATA.repoUrl || "https://github.com/salon-sathi/salon-manager";
const CHANGELOG = CHANGELOG_DATA.entries || [];

function Changelog() {
  // Group entries by date so the list reads as dated releases, newest first.
  const groups = [];
  CHANGELOG.forEach(([date, summary, commit]) => {
    let g = groups.find((x) => x.date === date);
    if (!g) { g = { date, items: [] }; groups.push(g); }
    g.items.push({ summary, commit });
  });
  const fmt = (d) => new Date(d + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div>
      <Header title="App Change Log" sub={`What’s new — newest first · ${CHANGELOG.length} updates`}>
        <a className="btn ghost small" href={`${REPO_URL}/commits/main`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Full history on GitHub ↗</a>
      </Header>

      <section style={S.panel}>
        {groups.length === 0 ? (
          <Empty text="No change log available — this build was made without git history.">
            <a className="btn ghost small" href={`${REPO_URL}/commits/main`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Browse commits on GitHub ↗</a>
          </Empty>
        ) : groups.map((g) => (
          <div key={g.date} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "#7A8C81", margin: "2px 0 8px" }}>{fmt(g.date)}</div>
            {g.items.map((it) => (
              <div key={it.commit} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 2px", borderBottom: "1px dashed #E5ECE6" }}>
                <span style={{ color: "var(--brand)" }}>•</span>
                <span style={{ flex: 1, fontSize: 13.5 }}>{it.summary}</span>
                <a href={`${REPO_URL}/commit/${it.commit}`} target="_blank" rel="noreferrer"
                   title="View this change on GitHub"
                   style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "monospace", color: "#2A6FB0", textDecoration: "none", whiteSpace: "nowrap" }}>{it.commit} ↗</a>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}


export { Changelog };
export default Changelog;
