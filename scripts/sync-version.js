"use strict";

/* ============================================================
   Version synchronization.
   package.json is the single authoritative source of the release
   version (electron-builder and npm both read it). This script
   derives the runtime version artifacts from it:

     VERSION         plain text  -> VERSION
     version.json    JSON        -> version.json (read by the backend)

   Run after bumping package.json#version:
     npm run version:sync
   ============================================================ */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const version = pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version in package.json: "${version}"`);
  process.exit(1);
}

fs.writeFileSync(path.join(root, "VERSION"), version + "\n");
fs.writeFileSync(
  path.join(root, "version.json"),
  JSON.stringify({ version }, null, 2) + "\n"
);

console.log(`Synced version ${version} -> VERSION, version.json`);
