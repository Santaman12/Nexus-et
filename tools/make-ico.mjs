// Builds a multi-size Windows .ico from PNG files (PNG-compressed icon entries,
// supported by Windows Vista and later).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'apps', 'web', 'public', 'icons');
const outDir = join(root, 'assets', 'brand', 'windows');
mkdirSync(outDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({
  size,
  data: readFileSync(join(srcDir, `icon-${size}.png`)),
}));

const headerSize = 6;
const entrySize = 16;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let cursor = headerSize + entrySize * images.length;
const entries = images.map(({ size, data }) => {
  const entry = Buffer.alloc(entrySize);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 means 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(cursor, 12);
  cursor += data.length;
  return entry;
});

const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
const out = join(outDir, 'nexus.ico');
writeFileSync(out, ico);
console.log(`wrote ${out} (${ico.length} bytes, sizes: ${sizes.join(', ')})`);
