import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const data = JSON.parse(await read('public/data/declaracoes.json'));
const records = data.declaracoes.filter(({ acervo }) => acervo);
const documents = records.flatMap(({ acervo }) => acervo.documentos);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Fingerprint of the 55 captures, unmodified from the supplied ZIP.
const ORIGINAL_ARCHIVE = '0e6c1a9f90d1e479e6da69ddccf372005d694cf1c163fd8d64aebffe1357f2de';
// The song that accompanies the visit, published exactly as supplied.
const SONG = 'musica/pandemia.mp3';
const SONG_SHA256 = '78e85a0f35274eb1f5f79164012d9165cd00b9bf21109d5d55e4db5c44cdcd35';
const MERGED = [
  'coronavac-2020-10-21', 'cpi-relatorio-2021-10-26', 'e-dai-2020-04-28', 'maricas-2020-11-10',
  'meio-milhao-2021-06-19', 'mimimi-2021-03-04', 'pfizer-cpi-2021-05-13', 'pfizer-primeiro-contrato-2021-03-19',
  'pfizer-primeiro-lote-2021-04-29', 'pronunciamento-2020-03-24', 'vacina-jacare-2020-12-17',
];
const MERGED_EVENTS = [2, 4, 25, 27, 32, 43, 46, 51, 53, 57, 67];
const PUBLIC_FIELDS = ['documentos', 'fonte_primaria', 'manchete', 'publicado_em', 'url', 'veiculo'];
// Editorial notes, checking status and spreadsheet details must never reach the site.
const INTERNAL = new RegExp([
  'planilha', 'timeline-covid\\.xlsx', '(?<!acervo-)COV-\\d{4}', 'Checagem registrada', 'Trecho indicado', 'status de checagem',
  'tipo_fonte', 'nota_data', 'Preservar (?:o|a|esse|fonte)', 'Recuperar (?:o )?vídeo', 'Localizar a live',
  'Conferir (?:a live|o vídeo|vídeo)', 'Necessário pesquisar', 'consultar íntegra', 'Confrontar com',
  'Registrar como', 'não tratar como', 'não apresentar a',
].join('|'), 'i');
const entry = (id) => data.declaracoes.find((record) => record.id === id);

async function files(directory, pattern) {
  return (await readdir(new URL(directory, root), { recursive: true })).filter((path) => pattern.test(path)).sort();
}

test('public archive files are the unmodified originals and the internal spreadsheet is never published', async () => {
  const published = await files('public/acervo-covid/', /\.\w+$/);
  assert.equal(published.length, 55);
  assert.ok(published.every((file) => file.endsWith('.png')), 'only captures belong to the archive folder');
  const fingerprint = createHash('sha256');
  for (const file of published) {
    const bytes = await read(`public/acervo-covid/${file}`);
    fingerprint.update(file).update('\0').update(bytes);
    assert.deepEqual(bytes, await read(`dist/acervo-covid/${file}`), file);
  }
  assert.equal(fingerprint.digest('hex'), ORIGINAL_ARCHIVE);
  assert.deepEqual(await files('public/', /\.xlsx$/), []);
  assert.deepEqual(await files('dist/', /\.xlsx$/), []);
  assert.deepEqual(Object.keys(data.acervo).sort(), ['documentos', 'eventos']);
});

test('the memorial plays the supplied song, unmodified, and no longer publishes the previous one', async () => {
  const song = await read(`public/${SONG}`);
  assert.equal(hash(song), SONG_SHA256);
  assert.deepEqual(await read(`dist/${SONG}`), song);
  assert.deepEqual(await files('dist/', /\.mp3$/), [SONG]);
  const home = (await read('dist/index.html')).toString();
  assert.equal(home.match(/\/musica\/pandemia\.mp3/g)?.length, 3);
  assert.doesNotMatch(home, /audio_covid/);
});

test('all 79 archive events and all 55 screenshots have exactly one timeline owner', async () => {
  assert.equal(data.acervo.eventos, 79);
  assert.equal(data.acervo.documentos, 55);
  assert.equal(records.length, 79);
  const imported = Array.from({ length: 79 }, (_, index) => index + 1)
    .filter((event) => !MERGED_EVENTS.includes(event))
    .map((event) => `acervo-cov-${String(event).padStart(4, '0')}`);
  assert.deepEqual(records.map(({ id }) => id).filter((id) => id.startsWith('acervo-cov-')).sort(), imported);
  assert.deepEqual(records.map(({ id }) => id).filter((id) => !id.startsWith('acervo-cov-')).sort(), MERGED);
  const pngs = (await files('public/acervo-covid/', /\.png$/)).map((path) => `acervo-covid/${path}`);
  assert.equal(documents.length, 55);
  assert.equal(new Set(documents.map(({ arquivo }) => arquivo)).size, 55);
  assert.deepEqual(documents.map(({ arquivo }) => arquivo).sort(), pngs);
  for (const capture of documents) {
    const bytes = await read(`public/${capture.arquivo}`);
    assert.equal(hash(bytes), capture.sha256);
    assert.equal(bytes.readUInt32BE(16), capture.largura);
    assert.equal(bytes.readUInt32BE(20), capture.altura);
  }
  assert.equal(entry('pronunciamento-2020-03-24').acervo.documentos.length, 2);
  assert.equal(entry('acervo-cov-0035').acervo.documentos.length, 0);
});

test('only public archive fields and public context reach the published data', () => {
  for (const record of records) {
    const fields = Object.keys(record.acervo);
    assert.ok(fields.every((field) => PUBLIC_FIELDS.includes(field)), `${record.id}: ${fields}`);
    for (const field of ['manchete', 'veiculo', 'url']) assert.ok(record.acervo[field].trim(), `${record.id}: ${field}`);
    if (record.id.startsWith('acervo-cov-')) {
      assert.equal(record.tipo, 'noticia');
      assert.equal(record.acessado_em, '2026-10-09');
    }
  }
  assert.doesNotMatch(JSON.stringify(data), INTERNAL);
  assert.deepEqual(records.filter((record) => record.contexto === undefined).map(({ id }) => id),
    ['acervo-cov-0003', 'acervo-cov-0012', 'acervo-cov-0029', 'acervo-cov-0042', 'acervo-cov-0052']);
  assert.match(entry('acervo-cov-0066').contexto, /associação divulgada é falsa/);
  assert.match(entry('acervo-cov-0064').contexto, /negou as acusações/);
  assert.match(entry('acervo-cov-0060').contexto, /não uma condenação/);
  for (const [id, url] of [
    ['acervo-cov-0037', 'https://www.hrw.org/sites/default/files/media_2021/01/2021_hrw_world_report.pdf'],
    ['acervo-cov-0042', 'https://fiocruz.br/documento/2021/12/boletim-do-observatorio-covid-19-retrospectiva-2021'],
    ['acervo-cov-0077', 'https://noticias.uol.com.br/confere/ultimas-noticias/2022/09/20/bolsonaro-mentiras-onu-assembleia-geral-2022.htm'],
  ]) assert.ok(entry(id).fontes.some((fonte) => fonte.url === url), id);
});

test('the built site carries no internal archive information', async () => {
  for (const file of await files('dist/', /\.(html|js|json|md|txt)$/)) {
    assert.doesNotMatch((await read(`dist/${file}`)).toString(), INTERNAL, file);
  }
});

test('date corrections follow visible document dates rather than misleading filenames', () => {
  for (const [id, date] of [
    ['acervo-cov-0005', '2020-05-07'], ['acervo-cov-0006', '2020-05-09'], ['acervo-cov-0012', '2020-06-11'],
    ['acervo-cov-0026', '2020-10-26'], ['vacina-jacare-2020-12-17', '2020-12-17'], ['acervo-cov-0066', '2021-10-21'],
    ['acervo-cov-0074', '2022-03-16'], ['acervo-cov-0075', '2022-06-30'],
  ]) assert.equal(entry(id).data, date);
  assert.equal(entry('acervo-cov-0006').acervo.publicado_em, '2020-05-09');
  assert.equal(entry('vacina-jacare-2020-12-17').acervo.publicado_em, '2020-12-18');
  assert.equal(entry('acervo-cov-0066').acervo.publicado_em, '2021-10-25');
});

test('the chronology focuses on Brazil instead of the former country-by-country campaigns', async () => {
  for (const prefix of ['moscou-', 'reino-unido-', 'estados-unidos-', 'canada-', 'mexico-chile-',
    'uniao-europeia-', 'india-', 'covax-ghana-', 'ghana-costa-marfim-']) {
    assert.ok(data.declaracoes.every(({ id }) => !id.startsWith(prefix)), prefix);
  }
  const home = (await read('dist/index.html')).toString();
  const references = (await read('dist/referencias/index.html')).toString();
  assert.match(home, /id="memorial-audio"[^>]*controls[^>]*preload="none"/);
  assert.match(home, /data-audio-toggle/);
  assert.doesNotMatch(home, /data-reading-status/);
  assert.match(home, /Começar o percurso/);
  assert.match(home, /data-intro-first/);
  assert.match(home, /data-intro-second/);
  assert.match(home, /Sem pausas/);
  assert.doesNotMatch(home, /id="speed-select"|data-speed|data-share-intro/);
  assert.match(home, /id="btn-play"[\s\S]*id="btn-share"[\s\S]*id="btn-mode"/);
  const hero = home.match(/<header class="hero">([\s\S]*?)<\/header>/)[1];
  assert.doesNotMatch(hero, /Cada ponto representa|Não esqueceremos/);
  assert.ok(home.indexOf('id="dimensao-da-tragedia"') < home.indexOf('id="memoria-e-responsabilidade"'));
  assert.match(home, /data-scroll-control/);
  assert.match(references, /55 capturas/);
  assert.match(references, /musica\/pandemia\.mp3/);
});
