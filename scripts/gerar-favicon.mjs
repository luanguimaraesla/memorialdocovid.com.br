// Draws the favicon: a Latin cross in the site's accent color on its background, both read
// from the :root palette in global.css. Writes an SVG for modern browsers, a multi-size ICO
// for /favicon.ico and a PNG for phone home screens, using only Node's own modules.
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const css = await readFile(new URL('src/styles/global.css', root), 'utf8');
const palette = css.match(/:root\s*\{[^}]+\}/)?.[0] ?? '';
const color = (name) => palette.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
const background = color('fundo');
const accent = color('destaque');
if (!background || !accent) throw new Error('Cores --fundo ou --destaque ausentes em :root');

// The cross on a 32-unit grid. Even coordinates land on whole pixels at 16, 32 and 48 px.
const GRID = 32;
const BARS = [
  { x: 14, y: 6, width: 4, height: 20 },
  { x: 8, y: 10, width: 16, height: 4 },
];
const ICO_SIZES = [16, 32, 48];
const TOUCH_SIZE = 180;
const SAMPLES = 16;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">`
  + `<rect width="${GRID}" height="${GRID}" fill="${background}"/>`
  + BARS.map(({ x, y, width, height }) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${accent}"/>`).join('')
  + '</svg>\n';

const inCross = (x, y) => BARS.some((bar) => x >= bar.x && x < bar.x + bar.width && y >= bar.y && y < bar.y + bar.height);
const rgb = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

// Share of each pixel the cross covers, from SAMPLES × SAMPLES points, blends the two colors.
function pixels(size) {
  const [back, front] = [rgb(background), rgb(accent)];
  const scale = GRID / size;
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    const row = py * (size * 3 + 1);
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inCross((px + (sx + 0.5) / SAMPLES) * scale, (py + (sy + 0.5) / SAMPLES) * scale)) hits++;
        }
      }
      const share = hits / SAMPLES ** 2;
      for (let channel = 0; channel < 3; channel++) {
        rows[row + 1 + px * 3 + channel] = Math.round(back[channel] + (front[channel] - back[channel]) * share);
      }
    }
  }
  return rows;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels(size))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// An ICO file whose entries are PNG images, which every current browser reads.
function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: png(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size;
    entry[1] = size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(24, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

await writeFile(new URL('public/favicon.svg', root), svg);
await writeFile(new URL('public/favicon.ico', root), ico(ICO_SIZES));
await writeFile(new URL('public/apple-touch-icon.png', root), png(TOUCH_SIZE));
console.log(`favicon.svg, favicon.ico (${ICO_SIZES.join(', ')} px) e apple-touch-icon.png (${TOUCH_SIZE} px)`);
