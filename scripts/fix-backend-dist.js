/* Moves the PyInstaller one-folder bundle from `dist/cloudpilot-backend`
 * to `dist/backend`, the location electron-builder copies into the app
 * resources. Cross-platform (works in Linux and Windows CI). */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "dist", "cloudpilot-backend");
const dst = path.join(root, "dist", "backend");

if (!fs.existsSync(src)) {
  console.error(`backend bundle not found at ${src} — run pyinstaller first`);
  process.exit(1);
}

fs.rmSync(dst, { recursive: true, force: true });
fs.renameSync(src, dst);
console.log("backend bundle moved to dist/backend");