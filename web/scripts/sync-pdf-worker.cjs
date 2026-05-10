/**
 * Keeps public/pdf.worker.min.mjs in sync with the installed pdfjs-dist version.
 * Run automatically via package.json postinstall.
 */
const fs = require("fs");
const path = require("path");

const src = path.join(
  __dirname,
  "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
);
const dest = path.join(__dirname, "../public/pdf.worker.min.mjs");

if (!fs.existsSync(src)) {
  console.warn("[vaultprint] pdfjs-dist worker not found; skip sync:", src);
  process.exit(0);
}
fs.copyFileSync(src, dest);
console.log("[vaultprint] synced pdf.worker.min.mjs → public/");
