'use strict';

/**
 * Generates the app icons (PNG) without any dependencies.
 * Draws a violet square with a white circle containing a pie chart
 * (red slice = expenses, green slice = income).
 *
 * Run: npm run icons
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- minimal PNG encoder ---------- */

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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- drawing ---------- */

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const VIOLET_TOP = hex('#8d7bf8');
const VIOLET_BOT = hex('#5543d6');
const WHITE = [255, 255, 255];
const RED = [255, 107, 107];
const GREEN = [0, 184, 148];

/** Returns [r,g,b] for a point in the icon, u/v in [0,1]. */
function pixelColor(u, v) {
  // diagonal violet gradient background
  const t = Math.min(1, Math.max(0, (u + v) / 2));
  const bg = [
    Math.round(VIOLET_TOP[0] + (VIOLET_BOT[0] - VIOLET_TOP[0]) * t),
    Math.round(VIOLET_TOP[1] + (VIOLET_BOT[1] - VIOLET_TOP[1]) * t),
    Math.round(VIOLET_TOP[2] + (VIOLET_BOT[2] - VIOLET_TOP[2]) * t),
  ];
  // pie chart circle (fully inside the maskable safe zone)
  const cx = 0.5, cy = 0.46, r = 0.32;
  const dx = u - cx, dy = v - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > r) return bg;
  // white ring border
  if (dist > r - 0.035) return WHITE;
  // pie: red slice from top (-90°) sweeping ~126° clockwise, green rest
  let ang = Math.atan2(dy, dx) * 180 / Math.PI; // -180..180, 0 = right, y is down
  ang = (ang + 360) % 360; // 0..360, 270 = top
  const inRed = ang >= 270 || ang < 36;
  // small white gap between slices
  if (Math.abs(ang - 270) < 4 || Math.abs(ang - 36) < 4) return WHITE;
  return inRed ? RED : GREEN;
}

function renderIcon(size) {
  const SS = 4; // supersampling factor for antialiasing
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = pixelColor((x * SS + sx + 0.5) / (size * SS), (y * SS + sy + 0.5) / (size * SS));
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

/* ---------- main ---------- */

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['favicon-64.png', 64],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
];

for (const [name, size] of targets) {
  const buf = renderIcon(size);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`✓ ${name} (${size}x${size}, ${(buf.length / 1024).toFixed(1)} KB)`);
}
