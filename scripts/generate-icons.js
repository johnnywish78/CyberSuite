/* CloudPilot icon generator — pure Node, no native deps.
 *
 * Renders the "CP" monogram over a rounded gradient tile and writes:
 *   - icons/icon-1024.png   (source + macOS largest size)
 *   - icons/icon-512.png    (Linux)
 *   - icons/icon-256.png
 *   - icons/icon.ico        (Windows, embeds the 256x256 PNG)
 *
 * Run: node scripts/generate-icons.js
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "icons");

/* 5x7 block font for the "CP" monogram. */
const GLYPHS = {
  C: [" .##. ", "#.... ", "#.... ", "#.... ", "#.... ", "#.... ", " .##. "],
  P: ["####. ", "#...# ", "#...# ", "####. ", "#.... ", "#.... ", "#.... "],
};

function renderGlyphLines(letter) {
  return GLYPHS[letter];
}

function roundedRect(px, x, y, w, h, r, fn) {
  const rr = Math.min(r, w / 2, h / 2);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      let inside = true;
      if (xx < x + rr && yy < y + rr) {
        inside =
          (xx - (x + rr)) ** 2 + (yy - (y + rr)) ** 2 <= rr * rr;
      } else if (xx >= x + w - rr && yy < y + rr) {
        inside =
          (xx - (x + w - rr)) ** 2 + (yy - (y + rr)) ** 2 <= rr * rr;
      } else if (xx < x + rr && yy >= y + h - rr) {
        inside =
          (xx - (x + rr)) ** 2 + (yy - (y + h - rr)) ** 2 <= rr * rr;
      } else if (xx >= x + w - rr && yy >= y + h - rr) {
        inside =
          (xx - (x + w - rr)) ** 2 + (yy - (y + h - rr)) ** 2 <= rr * rr;
      } else {
        inside = true;
      }
      if (inside) fn(xx, yy);
    }
  }
}

/* Blend two hex colors by t (0..1) toward the second. */
function blend(c1, c2, t) {
  const a = [parseInt(c1.slice(1, 3), 16), parseInt(c1.slice(3, 5), 16), parseInt(c1.slice(5, 7), 16)];
  const b = [parseInt(c2.slice(1, 3), 16), parseInt(c2.slice(3, 5), 16), parseInt(c2.slice(5, 7), 16)];
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

const TOP = "#1b2337";
const BOTTOM = "#0a0e17";
const ACCENT = "#3b82f6";
const FG = "#f4f7ff";

function makePixels(size) {
  const px = Buffer.alloc(size * size * 4);

  const corner = Math.round(size * 0.16);
  const pad = Math.max(4, Math.round(size * 0.045));

  roundedRect(px, 0, 0, size, size, corner, (x, y) => {
    const t = y / (size - 1);
    const [r, g, b] = blend(TOP, BOTTOM, t);
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  });

  /* Accent underline bar. */
  const barH = Math.max(6, Math.round(size * 0.045));
  const barY = Math.round(size * 0.72);
  const barX = Math.round(size * 0.24);
  const barW = size - barX * 2;
  roundedRect(px, barX, barY, barW, barH, Math.round(barH / 2), (x, y) => {
    const i = (y * size + x) * 4;
    px[i] = parseInt(ACCENT.slice(1, 3), 16);
    px[i + 1] = parseInt(ACCENT.slice(3, 5), 16);
    px[i + 2] = parseInt(ACCENT.slice(5, 7), 16);
    px[i + 3] = 255;
  });

  /* "CP" monogram above the accent bar. */
  const cell = Math.round(size * 0.11);
  const textH = cell * 7;
  const gap = Math.round(cell * 0.5);
  const textW = cell * 6 * 2 + gap;
  let ox = Math.round((size - textW) / 2);
  const oy = Math.round((barY - textH) / 2);

  for (const letter of ["C", "P"]) {
    const lines = renderGlyphLines(letter);
    for (let ly = 0; ly < 7; ly++) {
      for (let lx = 0; lx < 6; lx++) {
        if (lines[ly][lx] !== "#") continue;
        for (let dy = 0; dy < cell; dy++) {
          for (let dx = 0; dx < cell; dx++) {
            const x = ox + lx * cell + dx;
            const y = oy + ly * cell + dy;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const i = (y * size + x) * 4;
            px[i] = parseInt(FG.slice(1, 3), 16);
            px[i + 1] = parseInt(FG.slice(3, 5), 16);
            px[i + 2] = parseInt(FG.slice(5, 7), 16);
            px[i + 3] = 255;
          }
        }
      }
    }
    ox += cell * 6 + gap;
  }

  return px;
}

/* --- PNG encoding ----------------------------------------------------- */

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256 (0 means 256)
  entry[1] = 0; // height 256
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12); // offset after header+entry

  return Buffer.concat([header, entry, png256]);
}

/* --- main ------------------------------------------------------------- */

fs.mkdirSync(OUT_DIR, { recursive: true });

const sizes = [1024, 512, 256];
for (const size of sizes) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, makePixels(size)));
  console.log(`wrote ${file}`);
}

const icoFile = path.join(OUT_DIR, "icon.ico");
fs.writeFileSync(icoFile, encodeIco(encodePng(256, makePixels(256))));
console.log(`wrote ${icoFile}`);