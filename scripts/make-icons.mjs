// Rasterize public/logo.svg into the PNG pair a manifest needs:
//
//   node scripts/make-icons.mjs
//
// Run it BY HAND, only when the logo changes, and commit the result — it is not part of the
// build. Chromium's install criteria ask for a 192px and a 512px icon, and while Chrome will
// take an SVG, Android's splash screen and iOS's home-screen icon are both happier with a
// bitmap; shipping PNGs costs 2 files and removes the question.
//
// Rasterizing needs a renderer. Rather than add a dependency (sharp/resvg pull a native binary
// each) this drives the Chrome that is already on the machine, headless, one screenshot per
// size. --hide-scrollbars matters: without it the shot is 2px short on the right.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SIZES = [192, 512];
const SVG = path.resolve("public/logo.svg");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA + "/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));

if (!CHROME) {
  console.error("No Chrome found. Install one, or rasterize public/logo.svg to");
  console.error("public/icon-192.png and public/icon-512.png with any tool you like.");
  process.exit(1);
}
if (!existsSync(SVG)) {
  console.error("public/logo.svg is missing.");
  process.exit(1);
}

// The SVG markup is INLINED into the page rather than referenced with <img src="file://...">:
// a data: URL has an opaque origin and cannot load a file:// image, so the referenced version
// screenshots a broken-image glyph in the corner — and looks like it worked.
//
// Its own width/height are dropped so the viewBox scales to fill the window. The logo is a
// rounded square on a dark ground with no padding of its own, so it is drawn edge to edge and
// the manifest declares purpose "any maskable" — a platform that masks it crops into the
// rounding, which is what the rounding is for.
// Screenshot the SVG as its OWN document, with the root width/height rewritten to the target
// size — the viewBox does the scaling. Two dead ends worth not repeating: an <img src="file://">
// inside a data: page never loads (opaque origin, so the shot is a broken-image glyph), and
// resizing an inlined SVG with `width:100vw` gives a cropped, off-centre giant, because the
// viewport those units resolve against is not the window --window-size asks for.
//
// Only the ROOT tag's width/height are touched. A global strip also hits the background <rect>,
// which then draws nothing — the scissors come out on a transparent square and it reads as a
// design choice rather than a bug.
const raw = readFileSync(SVG, "utf8");
const sized = (size) =>
  raw.replace(/<svg\b[^>]*>/, (tag) =>
    tag.replace(/\s(width|height)="[^"]*"/g, "") + ""
  ).replace("<svg", `<svg width="${size}" height="${size}"`);

for (const size of SIZES) {
  const dir = mkdtempSync(path.join(tmpdir(), "slm-icon-"));
  const src = path.join(dir, "icon.svg");
  writeFileSync(src, sized(size));
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--default-background-color=00000000",
    `--screenshot=${path.join(dir, "out.png")}`,
    `--window-size=${size},${size}`,
    "file:///" + src.replace(/\\/g, "/"),
  ], { stdio: "ignore" });
  const out = path.resolve(`public/icon-${size}.png`);
  renameSync(path.join(dir, "out.png"), out);
  rmSync(dir, { recursive: true, force: true });
  console.log("wrote", out);
}
