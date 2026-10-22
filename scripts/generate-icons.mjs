#!/usr/bin/env node
/**
 * Generates BrowserTrust's extension icons at 16/48/128 px into public/icons/.
 * Pure Node (zlib + raw PNG encoding) so it works on any supported Node version
 * without pulling an image dependency. Re-run after changing the recipe:
 *
 *   npm run icons
 *
 * The icons are intentionally simple — a brand-red tile with a white inner
 * square — so they read as "intentional" at every size without text that would
 * blur at 16px.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'public', 'icons');

// Standard CRC-32 (polynomial 0xEDB88320) lookup table.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let k = 0; k < 8; k += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pixelAt(x, y, size) {
  // Outer: brand red (#E53945). Inner square (centered): white, with a small
  // red dot in the middle so the mark reads as a stylized "B/T" status glyph.
  const BRAND = [0xe5, 0x39, 0x45];
  const WHITE = [0xff, 0xff, 0xff];
  const inset = Math.max(2, Math.round(size * 0.22));
  const dot = Math.max(1, Math.round(size * 0.14));
  const cx = size / 2;
  const cy = size / 2;
  const inInner = x >= inset && y >= inset && x < size - inset && y < size - inset;
  if (!inInner) return BRAND;
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  if (dx * dx + dy * dy <= dot * dot) return BRAND;
  return WHITE;
}

function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none
  const bytesPerPixel = 3;
  const stride = 1 + size * bytesPerPixel; // one filter byte per scanline
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter type: None
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixelAt(x, y, size);
      const base = row + 1 + x * bytesPerPixel;
      raw[base] = r;
      raw[base + 1] = g;
      raw[base + 2] = b;
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log(`wrote ${file}`);
}
