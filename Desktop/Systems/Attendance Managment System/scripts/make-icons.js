// Generates the app icons in public/icons (run once: node scripts/make-icons.js).
// Pure Node: draws the gradient "A" brand mark and writes PNGs with zlib, no image library needed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// One sample at (x, y) in the unit square -> [r, g, b, a] (0-255, a in 0-1).
function sample(x, y, { rounded, letterScale }) {
  if (rounded) {
    // rounded-square mask, corner radius 0.22
    const r = 0.22;
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    if (Math.hypot(x - cx, y - cy) > r) return [0, 0, 0, 0];
  }
  // brand gradient, top-left #4f46e5 -> bottom-right #7c3aed
  const t = (x + y) / 2;
  let color = [79 + (124 - 79) * t, 70 + (58 - 70) * t, 229 + (237 - 229) * t];

  // the "A": two legs and a crossbar
  const s = letterScale;
  const at = (u, v) => [0.5 + (u - 0.5) * s, 0.5 + (v - 0.5) * s];
  const [ax, ay] = at(0.5, 0.22);
  const [lx, ly] = at(0.29, 0.78);
  const [rx, ry] = at(0.71, 0.78);
  const [b1x, b1y] = at(0.375, 0.6);
  const [b2x, b2y] = at(0.625, 0.6);
  const half = (0.09 * s) / 2 + 0.0001;
  const d = Math.min(
    distToSegment(x, y, ax, ay, lx, ly),
    distToSegment(x, y, ax, ay, rx, ry),
    distToSegment(x, y, b1x, b1y, b2x, b2y),
  );
  if (d <= half) color = [255, 255, 255];
  return [color[0], color[1], color[2], 1];
}

function render(size, options) {
  const out = Buffer.alloc(size * size * 4);
  const grid = 3; // 3x3 supersampling for smooth edges
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < grid; sy += 1) {
        for (let sx = 0; sx < grid; sx += 1) {
          const [cr, cg, cb, ca] = sample((px + (sx + 0.5) / grid) / size, (py + (sy + 0.5) / grid) / size, options);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / (grid * grid)) * 255);
    }
  }
  return encodePng(size, out);
}

const dir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
const icons = [
  ['icon-192.png', 192, { rounded: true, letterScale: 1 }],
  ['icon-512.png', 512, { rounded: true, letterScale: 1 }],
  // "maskable": full-bleed with the letter inside the safe zone, the OS applies its own shape
  ['icon-maskable-512.png', 512, { rounded: false, letterScale: 0.7 }],
  // iOS applies its own rounded corners
  ['apple-touch-icon.png', 180, { rounded: false, letterScale: 0.85 }],
];
for (const [name, size, options] of icons) {
  fs.writeFileSync(path.join(dir, name), render(size, options));
  console.log(`wrote public/icons/${name}`);
}
