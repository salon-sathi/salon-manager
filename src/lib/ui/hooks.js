// Shared React hooks.

import { useEffect, useState } from "react";
import { onUpdateReady } from "./swUpdate.js";

// ---------- viewport ----------
// Most responsive behaviour is plain CSS (see the media queries at the bottom of this file):
// a rule that only re-flows a layout should never cost a React render. This hook is for the
// few places where the phone needs DIFFERENT MARKUP, not restyled markup — the bottom tab bar
// versus the sidebar, and the calendar's one-stylist mode. Rendering both and hiding one with
// CSS would put two copies of every nav button in the accessibility tree.
//
// Defensive about matchMedia: jsdom's implementation always reports `matches: false`, which is
// exactly the right answer for a test (it renders the original desktop shell, so the existing
// suites keep asserting what they always did), and older WebKit only has the deprecated
// addListener/removeListener pair.
function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches); // re-sync: the width can change between first render and effect
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if (mql.addListener) mql.addListener(onChange); // Safari < 14
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else if (mql.removeListener) mql.removeListener(onChange);
    };
  }, [query]);
  return matches;
}


// True once a newer build has been downloaded and is waiting to take over. Always false in
// dev and in the jsdom suites — nothing registers a worker there, so nothing ever announces.
function useUpdateReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => onUpdateReady(setReady), []);
  return ready;
}

export { useMediaQuery, useUpdateReady };
