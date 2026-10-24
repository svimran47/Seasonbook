// Seasonbook icon generator — emits PNGs (no image libs; raw zlib + CRC32).
// Draws the brand logo: ink rounded square, paper TV case, 3 lines, ember bookmark ribbon.
// Supersampled 2× and box-filtered down for soft edges.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngFile(width, height, rgba /* Buffer length w*h*4 */) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// shape-test in 0..512 coordinate space; returns color or null
const INK = [10, 13, 19], PAPER = [30, 37, 50], LINE = [46, 56, 72], EMBER = [245, 169, 63];

function colorAt(u, v, { square = false, scale = 1 } = {}) {
  // optional maskable-safe scaling about the center
  let x = u, y = v;
  if (scale !== 1) {
    x = 256 + (u - 256) / scale;
    y = 256 + (v - 256) / scale;
  }
  // background: rounded square (or full bleed for maskable)
  const inBg = square
    ? true
    : roundedSimple(x, y, 0, 0, 512, 512, 96);
  if (!inBg) return null;
  let c = INK;
  // TV case with three guide lines kept inside it
  if (roundedSimple(x, y, 56, 108, 456, 428, 44)) {
    c = PAPER;
    for (const ly of [200, 264, 328]) {
      if (x >= 132 && x <= 380 && Math.abs(y - ly) <= 9) c = LINE;
    }
  }
  // ember bookmark ribbon over the case top edge (centered on the case)
  if (x >= 224 && x <= 288 && y >= 20 && y <= 180 && !inNotch(x, y)) c = EMBER;
  return c;
}

function roundedSimple(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const nx = Math.max(x0 + r, Math.min(x, x1 - r));
  const ny = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - nx, dy = y - ny;
  return dx * dx + dy * dy <= r * r;
}

function inNotch(x, y) {
  // V cut into the bookmark bottom: tips (224,180) and (288,180), apex (256,144)
  if (y <= 144 || y > 180) return false;
  const t = (180 - y) / 36; // 0 at bottom tips, 1 at apex
  const lo = 224 + 32 * t;
  const hi = 288 - 32 * t;
  return x >= lo && x <= hi;
}

function renderIcon(size, { maskable = false } = {}) {
  const S = size * 2; // supersample 2x
  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = colorAt((x + 0.5) / (S / 512), (y + 0.5) / (S / 512), { square: maskable, scale: maskable ? 0.86 : 1 });
      const o = (y * S + x) * 4;
      if (!c) { buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 0; }
      else { buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255; }
    }
  }
  // box-filter downscale 2x
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let i = 0; i < 4; i++) {
        const a = buf[((y * 2) * S + x * 2) * 4 + i];
        const b = buf[((y * 2 + 1) * S + x * 2) * 4 + i];
        const d = buf[((y * 2) * S + x * 2 + 1) * 4 + i];
        const e = buf[((y * 2 + 1) * S + x * 2 + 1) * 4 + i];
        out[(y * size + x) * 4 + i] = Math.round((a + b + d + e) / 4);
      }
    }
  }
  return out;
}

writeFileSync("public/icon-192.png", pngFile(192, 192, renderIcon(192)));
writeFileSync("public/icon-512.png", pngFile(512, 512, renderIcon(512)));
writeFileSync("public/icon-maskable-512.png", pngFile(512, 512, renderIcon(512, { maskable: true })));
console.log("icons written: icon-192.png, icon-512.png, icon-maskable-512.png");
