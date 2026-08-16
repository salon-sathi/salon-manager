import { describe, it, expect } from "vitest";
import { FEATURES, featureOn } from "./features.js";
import { OTHER_TABS, TOP_TABS, tabEnabled } from "./ui/nav.js";

// The flag map is one object read from several places, so what is worth pinning is the
// CONTRACT — how a key is interpreted — rather than the individual answers, which are the
// salon's to change. The one literal here is `udhari`, and it is deliberate: turning it
// back on is a decision, not a side effect of an unrelated edit.
describe("feature flags", () => {
  it("treats an unnamed feature as ON", () => {
    // Fail-open by design: a feature has to be NAMED to be parked, so a typo in a call
    // site can never silently hide a live screen. (The role matrix fails closed; this is
    // the opposite question — "does this section exist at all" — and a wrong answer that
    // hides the till is far worse than one that shows a section nobody parked.)
    expect(featureOn("billing")).toBe(true);
    expect(featureOn("nonexistent")).toBe(true);
  });

  it("treats only an explicit false as off", () => {
    for (const [key, value] of Object.entries(FEATURES)) {
      expect(featureOn(key), `${key}`).toBe(value !== false);
    }
  });

  it("has Udhari (credit) parked", () => {
    expect(featureOn("udhari")).toBe(false);
  });

  it("is the same function the nav asks", () => {
    // nav.js re-exports it rather than keeping a second copy: a tab is only one of a
    // parked feature's entry points, and a duplicated map is how the till would keep
    // offering a section the sidebar had already dropped.
    expect(tabEnabled).toBe(featureOn);
  });

  it("names a real tab in every flag that gates one", () => {
    // Substitution is by key, so a renamed tab with a stale flag is a section that
    // silently comes back. Every flag here must still match a tab that exists.
    const keys = [...TOP_TABS, ...OTHER_TABS].map(([k]) => k);
    for (const key of Object.keys(FEATURES)) expect(keys, key).toContain(key);
  });
});
