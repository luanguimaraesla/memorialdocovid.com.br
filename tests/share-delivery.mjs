import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const dataBytes = await read('public/data/declaracoes.json');
const { declaracoes } = JSON.parse(dataBytes);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const decode = (text) => text.replace(/&(quot|apos|#39|#x27|amp|lt|gt);/g, (_, entity) => ({
  quot: '"', apos: "'", '#39': "'", '#x27': "'", amp: '&', lt: '<', gt: '>',
})[entity]);

function meta(html, name) {
  const tag = [...html.matchAll(/<meta\b[^>]+>/g)]
    .map(([tag]) => tag).find((tag) => tag.includes(`property="${name}"`) || tag.includes(`name="${name}"`));
  assert.ok(tag, `missing metadata ${name}`);
  const content = tag.match(/content="([^"]*)"/)?.[1];
  assert.notEqual(content, undefined);
  return decode(content);
}

test('all preview PNGs match their sources and have the required 1200×630 size', async () => {
  const manifest = JSON.parse(await read('scripts/previas-manifest.json'));
  await assert.rejects(read('dist/previas/manifest.json'));
  assert.equal(manifest.declaracoesSha256, hash(dataBytes));
  const css = (await read('src/styles/global.css')).toString();
  const narrative = (await read('src/components/Narrative.astro')).toString();
  assert.equal(manifest.paletteSha256, hash(css.match(/:root\s*\{[^}]+\}/)[0]));
  assert.equal(manifest.subtitleSha256, hash(narrative.match(/<p class="hero__subtitle">([^<]+)<\/p>/)[1]));
  assert.deepEqual(manifest.images.map(({ id }) => id), ['memorial', ...declaracoes.map(({ id }) => id)]);
  // Every published preview belongs to a current milestone; removed milestones leave none behind.
  const files = manifest.images.map(({ file }) => file).sort();
  assert.deepEqual((await readdir(new URL('public/previas/', root))).sort(), files);
  assert.deepEqual((await readdir(new URL('dist/previas/', root))).sort(), files);
  assert.equal(new Set(manifest.images.map(({ sha256 }) => sha256)).size, declaracoes.length + 1);
  for (const image of manifest.images) {
    const bytes = await read(`public/previas/${image.file}`);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
    assert.equal(hash(bytes), image.sha256);
    assert.ok(image.fontSize >= 16);
    assert.deepEqual(bytes, await read(`dist/previas/${image.file}`));
  }
});

for (const statement of declaracoes) {
  test(`static preview for ${statement.id} has its own message, image and anchored entry point`, async () => {
    const html = (await read(`dist/marcos/${statement.id}/index.html`)).toString();
    const expectedDescription = `Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra lembra? ${statement.subtitulo}`;
    assert.equal(meta(html, 'og:title'), statement.subtitulo);
    assert.equal(meta(html, 'og:description'), expectedDescription);
    assert.equal(meta(html, 'description'), expectedDescription);
    assert.equal(meta(html, 'og:url'), `https://memorialdocovid.com.br/marcos/${statement.id}/`);
    assert.equal(meta(html, 'og:image'), `https://memorialdocovid.com.br/previas/${statement.id}.png`);
    assert.equal(meta(html, 'og:image:type'), 'image/png');
    assert.equal(meta(html, 'og:image:width'), '1200');
    assert.equal(meta(html, 'og:image:height'), '630');
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
    assert.equal(meta(html, 'twitter:description'), expectedDescription);
    assert.ok(html.includes(`data-initial-statement="${statement.id}"`));
    assert.ok(html.includes('id="btn-share"'));
    assert.ok(!html.includes('id="btn-inicio"') && !html.includes('id="btn-fim"'));
  });
}

test('the favicon is a cross in the palette, as SVG, ICO and a home-screen PNG', async () => {
  const css = (await read('src/styles/global.css')).toString();
  const palette = css.match(/:root\s*\{[^}]+\}/)[0];
  const [background, accent] = ['fundo', 'destaque'].map((name) => palette.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))[1]);
  const svg = (await read('public/favicon.svg')).toString();
  assert.match(svg, new RegExp(`<rect width="32" height="32" fill="${background}"/>`));
  assert.equal(svg.match(new RegExp(`fill="${accent}"`, 'g')).length, 2);
  const ico = await read('public/favicon.ico');
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 3]);
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + 16 * index;
    assert.deepEqual([ico[entry], ico[entry + 1]], [size, size]);
    const image = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [size, size]);
  }
  const touch = await read('public/apple-touch-icon.png');
  assert.deepEqual([touch.readUInt32BE(16), touch.readUInt32BE(20)], [180, 180]);
  const home = (await read('dist/index.html')).toString();
  for (const file of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
    assert.ok(home.includes(`href="/${file}"`), file);
    assert.deepEqual(await read(`dist/${file}`), await read(`public/${file}`));
  }
});

test('the main memorial retains its title and has a general sharing image', async () => {
  const html = (await read('dist/index.html')).toString();
  assert.equal(meta(html, 'og:title'), 'Memorial do Covid');
  assert.equal(meta(html, 'og:url'), 'https://memorialdocovid.com.br/');
  assert.equal(meta(html, 'og:image'), 'https://memorialdocovid.com.br/previas/memorial.png');
});
