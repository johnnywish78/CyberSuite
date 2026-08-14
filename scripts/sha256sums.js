/* Writes release/SHA256SUMS for every distributable artifact in the
 * release/ directory, excluding lockfiles and checksum files. */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const releaseDir = path.join(__dirname, "..", "release");
const outFile = path.join(releaseDir, "SHA256SUMS");

if (!fs.existsSync(releaseDir)) {
  console.error("release/ directory not found");
  process.exit(1);
}

const excluded = new Set(["SHA256SUMS"]);
const artifacts = fs
  .readdirSync(releaseDir)
  .filter((name) => !excluded.has(name))
  .filter((name) => !name.endsWith(".yml") && !name.endsWith(".blockmap"));

const lines = artifacts
  .map((name) => {
    const file = path.join(releaseDir, name);
    if (!fs.statSync(file).isFile()) return null;
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(file));
    return `${hash.digest("hex")}  ${name}`;
  })
  .filter(Boolean)
  .sort();

if (lines.length === 0) {
  console.error("no release artifacts found to checksum");
  process.exit(1);
}

fs.writeFileSync(outFile, lines.join("\n") + "\n");
console.log(`wrote ${outFile} (${lines.length} artifacts)`);