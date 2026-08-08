// Bundled /public assets, image handling and the print window.
import { escapeHtml } from "./format.js";


// Brand + payment assets (served from /public). BASE_URL is "/" in dev and the repo
// sub-path on GitHub Pages, so these resolve correctly in both. assetUrl() makes them
// absolute for the print window (about:blank, which can't resolve relative paths).
const BASE = import.meta.env.BASE_URL;
const LOGO_SRC = BASE + "logo.svg";
const PAYMENT_QR_SRC = BASE + "payment-qr.jpg";
const assetUrl = (p) => (typeof location !== "undefined" ? location.origin : "") + p;

// Read an <input type=file> image and return a downscaled JPEG data URL (fit within maxDim, white
// background so transparency doesn't print black on the thermal receipt). Downscaling keeps the
// stored logo/QR at a few KB — small enough to live inline in RTDB config + localStorage, instead
// of shipping the full-resolution file to every device.
function imageFileToDataUrl(file, maxDim, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) return reject(new Error("Not an image file"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Print an HTML document via a hidden iframe. Mobile browsers block window.open popups,
// so the old "open a new window and print" approach silently failed on phones — an iframe
// prints from within the current page (the click is a user gesture) and works everywhere.
function printHtml(html, title) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });

  let cleaned = false;
  const cleanup = () => { if (cleaned) return; cleaned = true; try { document.body.removeChild(iframe); } catch { /* already gone */ } };

  iframe.onload = () => {
    // Small delay so logo/QR images finish painting before the print dialog opens.
    setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        win.focus();
        win.onafterprint = cleanup;
        win.print();
        setTimeout(cleanup, 60000); // safety net: afterprint doesn't fire on every mobile browser
      } catch (err) {
        console.error("print failed", err);
        cleanup();
        const w = window.open("", "_blank"); // last-ditch fallback
        if (w) { w.document.write(html); w.document.close(); }
      }
    }, 250);
  };

  document.body.appendChild(iframe);
  // srcdoc gives a single load event after content + images, and works on mobile Safari/Chrome.
  iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title || "Print")}</title></head><body>${html}</body></html>`;
}


export { LOGO_SRC, PAYMENT_QR_SRC, assetUrl, imageFileToDataUrl, printHtml };
