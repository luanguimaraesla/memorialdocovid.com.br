import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const configUrl = moduleUrl(await read('src/config.ts'));
const config = await import(configUrl);
const layoutUrl = moduleUrl((await read('src/lib/layout.ts')).replaceAll("'../config'", JSON.stringify(configUrl)));
const layout = await import(layoutUrl);
const stateUrl = moduleUrl((await read('src/lib/state.ts')).replaceAll('import.meta.env.BASE_URL', "'/'"));
const { loadPageData } = await import(stateUrl);
const journeyUrl = moduleUrl((await read('src/lib/journey.ts')).replaceAll("'../config'", JSON.stringify(configUrl)));
const autoscrollUrl = moduleUrl((await read('src/lib/autoscroll.ts'))
  .replaceAll("'../config'", JSON.stringify(configUrl))
  .replaceAll("'./journey'", JSON.stringify(journeyUrl)));
const sharingUrl = moduleUrl(await read('src/lib/sharing.ts'));
const cropsUrl = moduleUrl(await read('src/lib/headline-crops.ts'));
const archiveUrl = moduleUrl((await read('src/lib/archive.ts')).replaceAll('import.meta.env.BASE_URL', "'/'").replaceAll("'./headline-crops'", JSON.stringify(cropsUrl)));
const audioUrl = moduleUrl(await read('src/lib/audio.ts'));
const renderSource = (await read('src/lib/render.ts'))
  .replaceAll("'../config'", JSON.stringify(configUrl))
  .replaceAll("'./layout'", JSON.stringify(layoutUrl))
  .replaceAll("'./state'", JSON.stringify(stateUrl))
  .replaceAll("'./autoscroll'", JSON.stringify(autoscrollUrl))
  .replaceAll("'./sharing'", JSON.stringify(sharingUrl))
  .replaceAll("'./archive'", JSON.stringify(archiveUrl))
  .replaceAll("'./audio'", JSON.stringify(audioUrl))
  .replaceAll("'./journey'", JSON.stringify(journeyUrl))
  .replaceAll('import.meta.env.BASE_URL', "'/'");
const referencesSource = (await read('src/lib/referencias.ts'))
  .replaceAll("'./state'", JSON.stringify(stateUrl))
  .replaceAll("'./archive'", JSON.stringify(archiveUrl));
const { bootReferencias } = await import(moduleUrl(referencesSource));

// render.ts keeps module state, so every boot gets a fresh module instance.
let renderInstances = 0;
const freshRender = () => import(moduleUrl(`${renderSource}\n// instance ${renderInstances++}`));

const SUBTITLE =
  'Não esqueceremos o papel da família Bolsonaro e a negligência negacionista que ampliou inúmeras vezes a magnitude dessa catástrofe no Brasil';

// Test-only fixtures. They are not official counts and never ship.
const obitosFixture = () => ({
  fontes: [{ nome: 'Fonte de teste', url: 'https://fonte.test/painel' }],
  acessado_em: '2026-01-02',
  criterio: 'data de notificação',
  dias: [
    { data: '2020-03-17', acumulado: 1 },
    { data: '2020-03-18', acumulado: 3 },
    { data: '2020-03-19', acumulado: 3 },
    { data: '2020-03-20', acumulado: 7 },
  ],
});

const syntheticFixture = () => ({
  sintetico: true,
  aviso: 'Aviso de teste.',
  declaracoes: [1, 2].map((n) => ({
    id: `teste-${n}`,
    data: n === 1 ? '2020-03-17' : '2020-03-20',
    texto: `[Exemplo sintético ${n}] texto de teste`,
    fontes: [{ nome: 'Exemplo sintético, sem fonte real', url: `https://example.invalid/declaracao-${n}` }],
    acessado_em: '2026-01-02',
  })),
});

const sourcedFixture = () => ({
  sintetico: false,
  declaracoes: [{
    id: 'real-1',
    data: '2020-03-18',
    subtitulo: 'Resumo editorial de teste',
    texto: 'Texto de teste com fonte.',
    autor: 'Autor de teste',
    contexto: 'Contexto de teste separado da citação.',
    fontes: [{ nome: 'Fonte de teste', url: 'https://fonte.test/declaracao-1' }],
    acessado_em: '2026-01-02',
  }],
});

function mockData(context, obitos = obitosFixture(), declaracoes = syntheticFixture()) {
  return context.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/data/obitos.json') return Response.json(obitos);
    if (url === '/data/declaracoes.json') return Response.json(declaracoes);
    throw new Error(`Unexpected data request: ${url}`);
  });
}

// ---- Layout ----

test('larger dots keep a fixed 12 px radius and ten dots per row', () => {
  assert.equal(config.DOT_RADIUS_PX, 12);
  assert.equal(config.DOT_GAP_PX, 2);
  assert.equal(config.DOTS_PER_ROW, 10);
  assert.equal(layout.rowPitch(), 26);
  assert.equal(layout.columnWidth(), 258);
  assert.deepEqual(layout.dotPosition(0), { row: 0, col: 0, x: 0, y: 0 });
  assert.deepEqual(layout.dotPosition(9), { row: 0, col: 9, x: 234, y: 0 });
  assert.deepEqual(layout.dotPosition(10), { row: 1, col: 0, x: 0, y: 26 });
  assert.deepEqual(layout.dotPosition(716_625), { row: 71_662, col: 5, x: 130, y: 1_919_060 });
});

test('the fixed column fills a small smartphone while leaving side margins', () => {
  assert.equal((320 - layout.columnWidth()) / 2, 31);
  assert.equal((390 - layout.columnWidth()) / 2, 66);
});

test('the timeline day number is inclusive and uses UTC through leap years', () => {
  assert.equal(layout.dayNumber('2020-03-17', '2020-03-17'), 1);
  assert.equal(layout.dayNumber('2020-03-17', '2020-03-18'), 2);
  assert.equal(layout.dayNumber('2020-03-17', '2020-03-20'), 4);
  assert.equal(layout.dayNumber('2024-02-28', '2024-03-01'), 3);
  assert.equal(layout.dayNumber('2023-02-28', '2023-03-01'), 2);
  assert.equal(layout.dayNumber('2020-03-17', '2025-08-30'), 1993);
});

test('scroll depth counts whole rows and clamps at both ends', () => {
  assert.equal(layout.livesAtDepth(-1, 25), 0);
  assert.equal(layout.livesAtDepth(0, 25), 10);
  assert.equal(layout.livesAtDepth(25, 25), 10);
  assert.equal(layout.livesAtDepth(26, 25), 20);
  assert.equal(layout.livesAtDepth(52, 25), 25);
  assert.equal(layout.livesAtDepth(1e9, 25), 25);
  assert.equal(layout.livesAtDepth(0, 7), 7);
});

test('each thousand lives gets a separator occupying three row slots', () => {
  assert.equal(config.LIVES_PER_SEPARATOR, 1000);
  assert.equal(config.SEPARATOR_ROWS, 3);
  assert.equal(layout.separatorHeight(), 78);
  assert.deepEqual(layout.thousandMarkers(999), []);
  assert.deepEqual(layout.thousandMarkers(1000), [{ lives: 1000, y: 2600 }]);
  assert.deepEqual(layout.thousandMarkers(2500), [
    { lives: 1000, y: 2600 },
    { lives: 2000, y: 5278 },
  ]);
  assert.deepEqual(layout.dotPosition(999), { row: 99, col: 9, x: 234, y: 2574 });
  assert.deepEqual(layout.dotPosition(1000), { row: 100, col: 0, x: 0, y: 2678 });
  assert.equal(layout.dotPosition(1999).y, 5252);
  assert.equal(layout.dotPosition(2000).y, 5356);
});

test('counts freeze inside separators and advance only when a dot row is reached', () => {
  for (const [depth, count] of [
    [2573.9, 990], [2574, 1000], [2599.9, 1000], [2600, 1000],
    [2626, 1000], [2652, 1000], [2677.9, 1000], [2678, 1010],
    [5278, 2000], [5355.9, 2000], [5356, 2010],
  ]) assert.equal(layout.livesAtDepth(depth, 2500), count, `depth ${depth}`);
  assert.equal(layout.livesAtDepth(2678, 1000), 1000);
  assert.equal(layout.livesAtDepth(2678, 1001), 1001);
  assert.equal(layout.livesAtDepth(1_919_060, 716_626), 716_626);
});

test('weekly anchors and day-end anchors include every preceding separator', () => {
  const dias = [
    { data: '2020-03-29', acumulado: 1000 },
    { data: '2020-03-30', acumulado: 2000 },
    { data: '2020-04-06', acumulado: 2011 },
  ];
  assert.deepEqual(layout.weekMarkers(dias), [
    { data: '2020-03-30', index: 1000, y: 2678 },
    { data: '2020-04-06', index: 2000, y: 5356 },
  ]);
  assert.equal(layout.anchorY(1000, 1000), 2574);
  assert.equal(layout.anchorY(2000, 2011), 5356);
});

test('column height stays within the 16,000,000 px browser limit including separators', () => {
  assert.equal(config.MAX_COLUMN_HEIGHT_PX, 16_000_000);
  assert.equal(layout.columnHeight(0), 0);
  assert.equal(layout.columnHeight(25), 78);
  assert.equal(layout.columnHeight(999), 2600);
  assert.equal(layout.columnHeight(1000), 2678);
  assert.equal(layout.columnHeight(1001), 2704);
  assert.equal(layout.columnHeight(2000), 5356);
  assert.equal(layout.columnHeight(716_626), 1_919_086);
  assert.equal(layout.columnHeight(5_974_620), 15_999_984);
  assert.throws(() => layout.columnHeight(5_974_621), /excede o limite/);
});

test('days map to dot indices across mid-row boundaries and zero-increment days', () => {
  const dias = [
    { data: '2020-03-30', acumulado: 4 },
    { data: '2020-03-31', acumulado: 12 },
    { data: '2020-04-01', acumulado: 12 },
    { data: '2020-04-02', acumulado: 15 },
    { data: '2020-05-01', acumulado: 15 },
    { data: '2020-06-01', acumulado: 15 },
    { data: '2020-06-02', acumulado: 21 },
  ];
  assert.deepEqual([0, 1, 2, 3].map((k) => layout.firstIndexOfDay(dias, k)), [0, 4, 12, 12]);
  assert.deepEqual([0, 1, 2, 3].map((k) => layout.lastIndexOfDay(dias, k)), [3, 11, 11, 14]);
  assert.deepEqual(
    [0, 3, 4, 9, 10, 11, 12, 14, 15, 20].map((index) => layout.dateAtIndex(dias, index)),
    ['2020-03-30', '2020-03-30', '2020-03-31', '2020-03-31', '2020-03-31', '2020-03-31',
      '2020-04-02', '2020-04-02', '2020-06-02', '2020-06-02'],
  );
  for (const index of [-1, 21, 1.5]) assert.throws(() => layout.dateAtIndex(dias, index), RangeError);
  assert.equal(layout.dayIndexOf(dias, '2020-04-01'), 2);
  assert.equal(layout.dayIndexOf(dias, '2020-03-01'), 0);
  assert.equal(layout.anchorY(21, 21), 52);
  assert.deepEqual(layout.weekMarkers(dias), [
    { data: '2020-03-30', index: 0, y: 0 },
    { data: '2020-06-01', index: 15, y: 26 },
  ]);
});

test('weekly dates start on March 30 without removing earlier lives', () => {
  assert.equal(config.WEEK_MARKERS_START, '2020-03-30');
  const dias = [
    { data: '2020-03-17', acumulado: 1 },
    { data: '2020-03-23', acumulado: 4 },
    { data: '2020-03-29', acumulado: 9 },
    { data: '2020-03-30', acumulado: 12 },
    { data: '2020-04-01', acumulado: 18 },
    { data: '2020-04-06', acumulado: 25 },
    { data: '2020-04-13', acumulado: 32 },
  ];
  assert.deepEqual(layout.weekMarkers(dias), [
    { data: '2020-03-30', index: 9, y: 0 },
    { data: '2020-04-06', index: 18, y: 26 },
    { data: '2020-04-13', index: 25, y: 52 },
  ]);
  assert.equal(layout.dateAtIndex(dias, 0), '2020-03-17');
  assert.equal(layout.columnHeight(dias.at(-1).acumulado), 104);
});

test('weekly labels stay on Monday even when deaths start later and skip empty weeks', () => {
  const dias = [
    { data: '2020-03-30', acumulado: 0 },
    { data: '2020-03-31', acumulado: 3 },
    { data: '2020-04-01', acumulado: 3 },
    { data: '2020-04-05', acumulado: 12 },
    { data: '2020-04-06', acumulado: 12 },
    { data: '2020-04-12', acumulado: 12 },
    { data: '2020-04-13', acumulado: 12 },
    { data: '2020-04-14', acumulado: 24 },
  ];
  assert.deepEqual(layout.weekMarkers(dias), [
    { data: '2020-03-30', index: 0, y: 0 },
    { data: '2020-04-13', index: 12, y: 26 },
  ]);
});

test('weekly labels cross month and year boundaries without adding extra markers', () => {
  const dias = [
    { data: '2020-12-28', acumulado: 4 },
    { data: '2020-12-31', acumulado: 12 },
    { data: '2021-01-01', acumulado: 16 },
    { data: '2021-01-03', acumulado: 20 },
    { data: '2021-01-04', acumulado: 21 },
  ];
  assert.deepEqual(layout.weekMarkers(dias), [
    { data: '2020-12-28', index: 0, y: 0 },
    { data: '2021-01-04', index: 20, y: 52 },
  ]);
});

test('empty series and dates before the first weekly marker produce no labels', () => {
  for (const dias of [[], obitosFixture().dias, [{ data: '2020-04-06', acumulado: 0 }]]) {
    assert.deepEqual(layout.weekMarkers(dias), []);
  }
});

test('layout has no DOM access', async () => {
  const source = await read('src/lib/layout.ts');
  assert.doesNotMatch(source, /\b(document|window|HTMLElement|requestAnimationFrame)\b/);
});

// ---- Data validation ----

test('loading reads both datasets without cache and reports the validated coverage', async (context) => {
  const fetch = mockData(context);
  const data = await loadPageData('/');
  assert.deepEqual(fetch.mock.calls.map((call) => call.arguments), [
    ['/data/obitos.json', { cache: 'no-cache' }],
    ['/data/declaracoes.json', { cache: 'no-cache' }],
  ]);
  assert.equal(data.inicio, '2020-03-17');
  assert.equal(data.fim, '2020-03-20');
  assert.equal(data.total, 7);
  assert.equal(data.declaracoes.declaracoes.length, 2);
});

test('invalid death data is rejected rather than repaired', async (context) => {
  const cases = {
    'missing fontes': (o) => { delete o.fontes; },
    'empty fontes': (o) => { o.fontes = []; },
    'source without name': (o) => { o.fontes[0].nome = ''; },
    'non-http source': (o) => { o.fontes[0].url = 'ftp://fonte.test/painel'; },
    'malformed source url': (o) => { o.fontes[0].url = 'fonte de teste'; },
    'impossible access date': (o) => { o.acessado_em = '2026-02-30'; },
    'missing access date': (o) => { delete o.acessado_em; },
    'wrong criterion': (o) => { o.criterio = 'data do óbito'; },
    'synthetic flag': (o) => { o.sintetico = true; },
    'empty series': (o) => { o.dias = []; },
    'invalid day date': (o) => { o.dias[1].data = '2020-03-32'; },
    'fractional total': (o) => { o.dias[1].acumulado = 2.5; },
    'negative total': (o) => { o.dias[0].acumulado = -1; },
    'string total': (o) => { o.dias[1].acumulado = '3'; },
    'decreasing totals': (o) => { o.dias[2].acumulado = 2; },
    'unsorted dates': (o) => { [o.dias[1], o.dias[2]] = [o.dias[2], o.dias[1]]; },
    'duplicate dates': (o) => { o.dias[2].data = o.dias[1].data; },
    'zero final total': (o) => { o.dias = [{ data: '2020-03-17', acumulado: 0 }]; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const obitos = obitosFixture();
    mutate(obitos);
    mockData(context, obitos);
    await assert.rejects(loadPageData('/'), /obitos\.json inválido/, name);
  }
});

test('invalid statements are rejected rather than repaired', async (context) => {
  const cases = {
    'missing synthetic flag': (d) => { delete d.sintetico; },
    'non-boolean synthetic flag': (d) => { d.sintetico = 'sim'; },
    'synthetic without notice': (d) => { delete d.aviso; },
    'synthetic text without prefix': (d) => { d.declaracoes[0].texto = 'Uma frase qualquer.'; },
    'duplicate ids': (d) => { d.declaracoes[1].id = d.declaracoes[0].id; },
    'empty id': (d) => { d.declaracoes[0].id = ''; },
    'empty text': (d) => { d.declaracoes[0].texto = ' '; },
    'date before coverage': (d) => { d.declaracoes[0].data = '2020-03-16'; },
    'date after coverage': (d) => { d.declaracoes[1].data = '2020-03-21'; },
    'impossible date': (d) => { d.declaracoes[0].data = '2020-02-30'; },
    'missing sources': (d) => { d.declaracoes[0].fontes = []; },
    'invalid access date': (d) => { d.declaracoes[0].acessado_em = 'ontem'; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const declaracoes = syntheticFixture();
    mutate(declaracoes);
    mockData(context, obitosFixture(), declaracoes);
    await assert.rejects(loadPageData('/'), /declaracoes\.json inválido/, name);
  }

  for (const [name, mutate] of Object.entries({
    'missing author': (d) => { delete d.declaracoes[0].autor; },
    'empty author': (d) => { d.declaracoes[0].autor = ' '; },
    'invalid author': (d) => { d.declaracoes[0].autor = 1; },
    'missing context': (d) => { delete d.declaracoes[0].contexto; },
    'empty context': (d) => { d.declaracoes[0].contexto = ' '; },
    'invalid context': (d) => { d.declaracoes[0].contexto = {}; },
  })) {
    const declaracoes = sourcedFixture();
    mutate(declaracoes);
    mockData(context, obitosFixture(), declaracoes);
    await assert.rejects(loadPageData('/'), /autor ou contexto/, name);
  }

  for (const value of [undefined, '', ' ', 1, {}]) {
    const declaracoes = sourcedFixture();
    declaracoes.declaracoes[0].subtitulo = value;
    mockData(context, obitosFixture(), declaracoes);
    await assert.rejects(loadPageData('/'), /subtítulo/);
  }

  const placeholderAsReal = sourcedFixture();
  placeholderAsReal.declaracoes[0].fontes[0].url = 'https://example.invalid/declaracao-1';
  mockData(context, obitosFixture(), placeholderAsReal);
  await assert.rejects(loadPageData('/'), /declaracoes\.json inválido: fonte de exemplo/);
});

test('news types are validated without changing legacy quotations', async (context) => {
  for (const kind of [undefined, 'declaracao', 'noticia']) {
    const entries = sourcedFixture();
    entries.declaracoes[0].tipo = kind;
    mockData(context, obitosFixture(), entries);
    const loaded = await loadPageData('/');
    assert.equal(loaded.declaracoes.declaracoes[0].tipo, kind);
  }
  for (const kind of [null, 1, {}, '', 'fala', '<script>']) {
    const entries = sourcedFixture();
    entries.declaracoes[0].tipo = kind;
    mockData(context, obitosFixture(), entries);
    await assert.rejects(loadPageData('/'), /tipo de/);
  }
});

test('missing files and broken JSON reject instead of falling back', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url) => (
    url === '/data/obitos.json' ? new Response('not found', { status: 404 }) : Response.json(syntheticFixture())
  ));
  await assert.rejects(loadPageData('/'), /Falha ao carregar \/data\/obitos\.json: 404/);

  context.mock.method(globalThis, 'fetch', async (url) => (
    url === '/data/declaracoes.json' ? new Response('{ quebrado') : Response.json(obitosFixture())
  ));
  await assert.rejects(loadPageData('/'), SyntaxError);
});

test('news may omit context while quotations still require it', async (context) => {
  const news = sourcedFixture();
  Object.assign(news.declaracoes[0], { tipo: 'noticia', contexto: undefined });
  mockData(context, obitosFixture(), news);
  assert.equal((await loadPageData('/')).declaracoes.declaracoes[0].contexto, undefined);
  for (const [tipo, contexto] of [[undefined, undefined], ['declaracao', undefined], ['noticia', ' ']]) {
    const entries = sourcedFixture();
    Object.assign(entries.declaracoes[0], { tipo, contexto });
    mockData(context, obitosFixture(), entries);
    await assert.rejects(loadPageData('/'), /autor ou contexto de real-1/);
  }
});

function archiveFixture() {
  return {
    manchete: 'Manchete de teste <sem HTML>', veiculo: 'Veículo de teste',
    url: 'https://fonte.test/noticia', publicado_em: '2020-03-19',
    fonte_primaria: 'https://fonte.test/video',
    documentos: [{
      arquivo: 'acervo-covid/2020/03_2020/20032020_gripezinha.png',
      legenda: 'Captura <original>', largura: 600, altura: 300, sha256: 'a'.repeat(64),
    }],
  };
}

test('archive metadata rejects unsafe files, bad dimensions, dates and source URLs', async (context) => {
  for (const mutate of [
    (record) => { record.documentos[0].arquivo = '../secret.png'; },
    (record) => { record.documentos[0].arquivo = 'https://other.test/image.png'; },
    (record) => { record.documentos[0].largura = 0; },
    (record) => { record.documentos[0].altura = 1.5; },
    (record) => { record.documentos[0].sha256 = 'bad'; },
    (record) => { record.documentos = null; },
    (record) => { record.publicado_em = '2020-02-30'; },
    (record) => { record.fonte_primaria = 'javascript:alert(1)'; },
    (record) => { record.url = 'javascript:alert(1)'; },
    (record) => { record.manchete = ''; },
    (record) => { record.veiculo = undefined; },
  ]) {
    const entries = sourcedFixture();
    entries.declaracoes[0].acervo = archiveFixture();
    mutate(entries.declaracoes[0].acervo);
    mockData(context, obitosFixture(), entries);
    await assert.rejects(loadPageData('/'), /acervo de real-1/);
  }
});

test('archive documents render with original dimensions, source metadata and safe captions', async (context) => {
  const entries = sourcedFixture();
  entries.declaracoes[0].acervo = archiveFixture();
  mockData(context, obitosFixture(), entries);
  const page = installPage(context);
  await (await freshRender()).boot();
  const card = page.$('[data-marks]').children[0];
  const image = [...card.descendants()].find(({ tagName }) => tagName === 'img');
  assert.equal(image.src, '/acervo-covid/2020/03_2020/20032020_gripezinha.png');
  assert.equal(image.alt, 'Captura do acervo: Captura <original>');
  assert.equal(image.loading, 'lazy');
  assert.equal(image.width, 600);
  assert.equal(image.height, 300);
  const sources = [...card.descendants()].find(({ className }) => className === 'acervo__fontes');
  assert.equal(sources.text, 'Veículo de teste — Manchete de teste <sem HTML>. Reportagem publicada em 19/03/2020. Fonte primária');
  assert.deepEqual([...sources.descendants()].map(({ href }) => href), ['https://fonte.test/noticia', 'https://fonte.test/video']);
  assert.doesNotMatch(card.text, /COV-|Checagem|Trecho|planilha/);
  const references = installPage(context, true);
  await bootReferencias();
  const [entry] = references.$('[data-fontes-declaracoes]').children;
  const listed = [...entry.descendants()].find(({ className }) => className === 'acervo__fontes');
  assert.equal(listed.text, 'Veículo de teste — Manchete de teste <sem HTML>. Reportagem publicada em 19/03/2020. Fonte primária');
  assert.ok(![...entry.descendants()].some(({ tagName }) => tagName === 'details'));
});

test('headline images appear outside Leia mais while metadata stays collapsed', async context => {
  const entries = sourcedFixture();
  entries.declaracoes[0].acervo = archiveFixture();
  mockData(context, obitosFixture(), entries);
  const page = installPage(context);
  await (await freshRender()).boot();
  const card = page.$('[data-marks]').children[0];
  const images = card.children.find(element => element.className === 'declaracao__headlines');
  const more = card.children.find(element => element.tagName === 'details');
  assert.ok([...images.descendants()].some(element => element.tagName === 'img'));
  assert.ok(![...more.descendants()].some(element => element.tagName === 'img'));
  assert.equal(more.children[0].textContent, 'Leia mais');
  assert.ok(!more.open);
  assert.equal(card.children[0].tagName, 'header');
  const buttons = [...card.descendants()].filter(node => node.tagName === 'button');
  assert.deepEqual(buttons.map(button => [button.className, button.attributes['aria-label']]),
    [['declaracao__compartilhar', 'Compartilhar: Resumo editorial de teste']]);
  assert.ok([...card.children[0].descendants()].includes(buttons[0]));
});

test('consecutive sourced events only float in the optional continuous mode', async context => {
  const entries = sourcedFixture();
  entries.declaracoes.push({...entries.declaracoes[0],id:'real-2'});
  mockData(context, obitosFixture(), entries);
  const page = installPage(context);
  page.$('[data-track]').top = 90;
  const playback = installPlaybackFrames(context,page);
  await (await freshRender()).boot();
  assert.equal(page.$('[data-marks]').hidden,false);
  page.$('#btn-mode').listeners.click();
  assert.equal(page.$('[data-marks]').hidden,true);
  page.$('#btn-play').listeners.click();
  for(let index=0;index<10;index++) playback.frame();
  assert.equal(page.$('[data-floating]').hidden,false);
  const floating = page.$('[data-floating]').children[0];
  assert.ok(floating.className.includes('compacta'));
  assert.ok(![...floating.descendants()].some(node => node.tagName==='img'));
  for(let index=0;index<10;index++) playback.frame();
  assert.equal(page.$('#btn-play').getAttribute('aria-pressed'),'true');
  assert.ok(window.scrollY>0);
});

test('a page click pauses scrolling while transport controls remain independent', async (context) => {
  mockData(context);
  const page = installPage(context);
  page.$('[data-track]').top = 3300;
  const playback = installPlaybackFrames(context, page);
  await (await freshRender()).boot();
  page.$('#btn-start').listeners.click();
  page.listeners.click({ target: { closest: () => ({}) } });
  assert.equal(page.$('#btn-play').getAttribute('aria-pressed'), 'true');
  playback.frame();
  page.listeners.click({ target: { closest: () => null } });
  assert.equal(page.$('#btn-play').getAttribute('aria-pressed'), 'false');
  const position = window.scrollY;
  playback.frame();
  assert.equal(playback.frames.size, 0);
  assert.equal(window.scrollY, position);
  page.$('#btn-play').listeners.click();
  playback.frame();
  assert.ok(window.scrollY > position);
});

// ---- Static content ----

test('the closing carries the exact message and the official total', async () => {
  const closing = await read('src/components/Closing.astro');
  assert.match(closing, /<h2 class="encerramento__titulo" id="encerramento-titulo">Nunca esqueceremos\.<\/h2>/);
  assert.ok(closing.includes('<span>Essa família não pode voltar ao poder!</span>'));
  assert.ok(closing.includes('<span>A ignorância não pode vencer.</span>'));
  assert.match(closing, /obitos\.dias\[obitos\.dias\.length - 1\]\.acumulado/);
  const page = await read('src/components/MemorialPage.astro');
  assert.ok(page.indexOf('<Memorial />') < page.indexOf('<Closing />') && page.indexOf('<Closing />') < page.indexOf('<Fontes />'));
});

test('the documentary closes the page with its question and a lazy, cookie-free player', async () => {
  const documentary = await read('src/components/Documentary.astro');
  assert.match(documentary, /<h2 class="documentario__titulo" id="documentario-titulo">Quer saber quem são os verdadeiros responsáveis\?<\/h2>/);
  assert.match(documentary, /const video = 'iTDeUmQ3LTI';/);
  assert.match(documentary, /src=\{`https:\/\/www\.youtube-nocookie\.com\/embed\/\$\{video\}`\}/);
  assert.match(documentary, /<iframe[^>]*title="Anatomia do Caos \| Documentário completo"[^>]*loading="lazy"[^>]*allowfullscreen/);
  const page = await read('src/components/MemorialPage.astro');
  assert.ok(page.indexOf('<Closing />') < page.indexOf('<Documentary />') && page.indexOf('<Documentary />') < page.indexOf('<Fontes />'));
});

test('the hero shows the exact title and subtitle', async () => {
  const hero = await read('src/components/Hero.astro');
  assert.match(hero, /<h1 class="hero__title">Memorial <span>do Covid<\/span><\/h1>/);
  assert.ok(!hero.includes(SUBTITLE));
  const narrative = await read('src/components/Narrative.astro');
  assert.ok(narrative.includes(`<p class="hero__subtitle">${SUBTITLE}</p>`));
  assert.ok(narrative.indexOf('A dimensão da tragédia brasileira') < narrative.indexOf(SUBTITLE));
  const base = await read('src/layouts/Base.astro');
  assert.match(base, /title = 'Memorial do Covid'/);
});

test('every element render.ts needs exists in the page components', async () => {
  const page = (await Promise.all([
    'src/components/Hero.astro', 'src/components/Narrative.astro', 'src/components/Memorial.astro',
    'src/components/Counter.astro', 'src/components/Fontes.astro', 'src/components/Closing.astro',
  ].map(read))).join('\n');
  for (const selector of renderSelectors()) {
    const attribute = selector.startsWith('#') ? `id="${selector.slice(1)}"` : selector.slice(1, -1);
    assert.ok(page.includes(attribute), `missing ${selector}`);
  }
  const index = await read('src/pages/index.astro');
  const pageComponent = await read('src/components/MemorialPage.astro');
  assert.match(index, /<MemorialPage/);
  assert.equal(pageComponent.match(/boot\(\)/g)?.length, 1);
});

test('the counter shows only days, with the singular on the first day', async (context) => {
  const counter = await read('src/components/Counter.astro');
  assert.match(counter, /data-counter-days/);
  assert.doesNotMatch(counter, /até|data-counter-date/);
  const obitos = obitosFixture();
  obitos.dias.forEach((dia, index) => { dia.acumulado = [10, 20, 20, 30][index]; });
  mockData(context, obitos, { sintetico: false, declaracoes: [] });
  const { $, listeners } = installPage(context);
  $('[data-track]').top = 450;
  const { boot } = await freshRender();
  await boot();
  assert.equal($('[data-counter-days]').textContent, '1 dia');
  $('[data-track]').top = 424;
  listeners.scroll();
  assert.equal($('[data-counter-days]').textContent, '2 dias');
  $('[data-track]').top = 398;
  listeners.scroll();
  assert.equal($('[data-counter-days]').textContent, '4 dias');
});

test('the page is accessible in pt-BR and loads only the approved GA tag', async () => {
  const base = await read('src/layouts/Base.astro');
  const memorial = await read('src/components/Memorial.astro');
  const counter = await read('src/components/Counter.astro');
  const hero = await read('src/components/Hero.astro');
  const css = await read('src/styles/global.css');
  assert.match(base, /<html lang="pt-BR">/);
  assert.match(memorial, /data-dots aria-hidden="true"/);
  assert.doesNotMatch(memorial, /<canvas/);
  assert.match(counter, /data-announcer aria-live="polite"/);
  assert.match(hero, /id="load-error" role="alert" hidden/);
  assert.match(counter, /id="btn-share" type="button"[^>]*disabled/);
  assert.doesNotMatch(counter, /data-counter-total/);
  assert.doesNotMatch(counter, /btn-inicio|btn-fim|Ir ao início|Ir ao fim/);
  assert.match(counter, /data-share-status role="status" hidden/);
  assert.match(counter, /<dialog[^>]*aria-labelledby="share-title"/);
  assert.match(hero, /id="btn-start" type="button"[^>]*disabled/);
  assert.match(counter, /aria-label="Controles de rolagem automática"/);
  assert.match(counter, /id="btn-play"[\s\S]*?aria-pressed="false"[\s\S]*?disabled/);
  assert.match(counter, /id="btn-mode"[^>]*aria-pressed="false"/);
  assert.doesNotMatch(counter, /<select/);
  assert.match(renderSource, /ANNOUNCE_INTERVAL_MS/);
  assert.match(renderSource, /setAttribute\('tabindex', '-1'\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.equal(base.match(/googletagmanager\.com\/gtag\/js\?id=G-4SW9W1M6L0/g)?.length, 1);
  assert.match(base, /gtag\('config', 'G-4SW9W1M6L0'\)/);
  assert.doesNotMatch(base, /G-6MF2B6H28V/);
  for (const source of [memorial, counter, hero, renderSource]) {
    assert.doesNotMatch(source, /gtag|googletagmanager/);
  }
});

test('methodology and sources live on /referencias instead of beside the column', async () => {
  const memorial = await read('src/components/Memorial.astro');
  const footer = await read('src/components/Fontes.astro');
  const references = await read('src/pages/referencias.astro');
  assert.doesNotMatch(memorial + footer, /data-dyn=|data-dyn-link=|data-fontes-/);
  assert.doesNotMatch(memorial, /menor valor|data de notificação|óbitos acumulados/);
  assert.match(footer, /href="\/referencias"/);
  assert.match(references, /href="\/"/);
  assert.match(references, /<h2>Uma vida, um ponto<\/h2>/);
  assert.match(references, /<strong>data de notificação<\/strong>/);
  assert.match(references, /não a\s+data em que cada pessoa morreu/);
  assert.match(references, /menor valor entre ele e os acumulados seguintes/);
  assert.match(references, /preserva o total oficial mais recente/);
  assert.match(references, /marcos semanais mostram as segundas-feiras a partir de 30\/03\/2020/);
  assert.match(references, /não uma contagem de mortes causada por/);
  assert.match(references, /não atribui os óbitos daquela posição à declaração/);
  assert.match(references, /https:\/\/www\.aeaweb\.org\/articles\?id=10\.1257%2Fpol\.20210284/);
  for (const key of ['inicio', 'fim', 'total', 'acessado-em']) {
    assert.match(references, new RegExp(`data-dyn="${key}">…<`));
  }
  assert.match(memorial, /Declarações sintéticas de exemplo/);
});

test('the centered column and sticky markers retain the palette and mobile safe areas', async () => {
  const css = await read('src/styles/global.css');
  const memorial = await read('src/components/Memorial.astro');
  const base = await read('src/layouts/Base.astro');
  assert.match(memorial, /columnWidth\(\)/);
  assert.match(memorial, /separatorHeight\(\)/);
  assert.match(memorial, /data-separators aria-hidden="true"/);
  assert.match(css, /\.memorial__separator\s*\{[^}]*height: var\(--separador-altura\)/);
  assert.match(css, /\.memorial__separator-number\s*\{[^}]*font-size: 2rem/);
  assert.match(css, /\.memorial__pontos\s*\{[^}]*left: calc\(50% - var\(--coluna\) \/ 2\)/);
  assert.match(css, /\.memorial__pontos\s*\{[^}]*background: var\(--pontos\) 0 0 \/ var\(--passo\) calc\(2 \* var\(--passo\)\)/);
  assert.match(css, /\.memorial__pontos--alternada\s*\{\s*background-position: 0 var\(--passo\)/);
  assert.doesNotMatch(css, /radial-gradient/);
  assert.match(memorial, /fill='#e8e4dc'[\s\S]*fill='#cbc7bf'/);
  assert.match(memorial, /--pontos: url\("data:image\/svg\+xml,\$\{encodeURIComponent\(tile\)\}"\)/);
  assert.doesNotMatch(css, /memorial__canvas/);
  assert.match(css, /\.declaracao\s*\{[^}]*position: absolute/);
  assert.doesNotMatch(css, /overflow-y: auto/);
  assert.match(css, /\.declaracao\[hidden\]\s*\{\s*display: none/);
  assert.match(css, /\.declaracao__texto\s*\{[^}]*white-space: pre-line/);
  assert.match(css, /\.declaracao__data\s*\{[^}]*font-size: 0\.8rem/);
  assert.match(css, /\.ref-declaracao__data\s*\{[^}]*font-size: 1\.35rem/);
  assert.match(css, /\.ref-declaracao blockquote\s*\{[^}]*white-space: pre-line/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.marco-semana\s*\{[^}]*white-space: nowrap/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{\s*\.marco-semana\s*\{[^}]*width: max-content/);
  assert.match(css, /\.marco-semana\s*\{[^}]*background: var\(--destaque\);[^}]*color: var\(--fundo\);[^}]*font-weight: 700/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(base, /viewport-fit=cover/);
  for (const [name, value] of Object.entries({
    fundo: '#0b0b0c', texto: '#e8e4dc', 'texto-suave': '#a9a39a', destaque: '#c9a227',
  })) assert.ok(css.includes(`--${name}: ${value}`));
});

test('the controls split Continuar, Compartilhar and Sem pausas without a speed label', async () => {
  assert.equal(config.SECONDS_BETWEEN_MILESTONES,1.6);
  assert.equal(config.SPEED_BASE,undefined);
  const counter = await read('src/components/Counter.astro');
  const css = await read('src/styles/global.css');
  assert.doesNotMatch(counter,/<select|<option|data-speed|Lento/);
  assert.match(counter,/id="btn-play"[\s\S]*id="btn-share"[\s\S]*id="btn-mode"[\s\S]*Sem pausas/);
  assert.match(css,/\.playback__controls\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

// ---- Boot with a minimal DOM ----

function renderSelectors() {
  return [...renderSource.matchAll(/must(?:<[^>]+>)?\('([^']+)'\)/g)].map(([, selector]) => selector);
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = {};
    this.top = 0;
    this.offsetHeight = 400;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  toggleAttribute(name, force) {
    if (force) this.attributes[name] = '';
    else delete this.attributes[name];
  }
  prepend(...nodes) { this.children.unshift(...nodes); }
  scrollIntoView() { this.scrolled = true; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) {
    this.children = [...nodes];
    if (this.track) for (const node of nodes) node.track = this.track;
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  getBoundingClientRect() {
    return {top: this.track ? this.track.top + parseFloat(this.style.top ?? '0') : this.top};
  }
  querySelector(selector) { return [...this.descendants()].find(node => node.tagName === selector) ?? null; }
  *descendants() {
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      yield child;
      yield* child.descendants();
    }
  }
  get text() {
    return this.textContent + this.children.map((child) => (typeof child === 'string' ? child : child.text)).join('');
  }
}

function installPage(context, references = false) {
  const elements = {};
  const selectors = references ? [
    '#load-error', '[data-dyn="inicio"]', '[data-dyn="fim"]', '[data-dyn="acessado-em"]',
    '[data-dyn="total"]', '[data-dyn-link="fonte"]', '[data-fontes-obitos]', '[data-fontes-declaracoes]',
  ] : renderSelectors();
  for (const selector of selectors) {
    elements[selector] = new FakeElement();
    elements[selector].textContent = '…';
  }
  elements['#load-error'].hidden = true;
  if (!references) {
    elements['[data-aviso-sintetico]'].hidden = true;
    for (const selector of ['#btn-start', '#btn-play', '#btn-share', '#btn-mode']) elements[selector].disabled = true;
    elements['#btn-play'].setAttribute('aria-pressed', 'false');
    elements['[data-marks]'].track = elements['[data-track]'];
    // The introductions always sit above the column, like the real narrative.
    for (const [selector,id,title,top] of [
      ['[data-intro-first]','dimensao-da-tragedia','A dimensão da tragédia brasileira',-2200],
      ['[data-intro-second]','memoria-e-responsabilidade','Memória e responsabilidade',-1100],
    ]) {
      elements[selector].id = id;
      elements[selector].track = elements['[data-track]'];
      elements[selector].style.top = String(top);
      elements[selector].append(Object.assign(new FakeElement('h2'), { textContent: title }));
    }
    // The closing follows the column, far below every test fixture.
    elements['[data-closing]'].track = elements['[data-track]'];
    elements['[data-closing]'].style.top = '5000000';
    elements['[data-closing]'].id = 'encerramento';
    elements['[data-counter]'].setAttribute('data-idle', '');
  }

  const listeners = {};
  const scrolls = [];
  globalThis.document = {
    querySelector: (selector) => elements[selector] ?? null,
    querySelectorAll: (selector) => Object.values(elements).flatMap(element => [element,...element.descendants()])
      .filter(node => selector.startsWith('[') && Object.hasOwn(node.attributes,selector.slice(1,-1))),
    createElement: (tag) => new FakeElement(tag),
    documentElement: { scrollHeight: 10_000_000 },
    getElementById: (id) => Object.values(elements)
      .flatMap((element) => [element, ...element.descendants()])
      .find((element) => element.id === id),
  };
  const move = top => {
    const delta = top - window.scrollY;
    window.scrollY = top;
    if(elements['[data-track]']) elements['[data-track]'].top -= delta;
  };
  globalThis.window = {
    location: { hash: '', origin: 'https://memorial.test' },
    innerHeight: 900,
    innerWidth: 1440,
    scrollY: 0,
    devicePixelRatio: 2,
    addEventListener: (type, listener) => { listeners[type] = listener; },
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({ top: '72px' }),
    scrollTo: options => { scrolls.push(options); move(options.top); },
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.cancelAnimationFrame = () => {};
  context.after(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });
  context.mock.method(console, 'error', () => {});
  const $ = (selector) => elements[selector];
  return { $, listeners, scrolls, move };
}

function installPlaybackFrames(context, page) {
  const frames = new Map();
  const steps = [];
  let sequence = 0;
  let time = 0;
  context.mock.method(performance, 'now', () => time);
  context.mock.method(globalThis, 'requestAnimationFrame', (callback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  context.mock.method(globalThis, 'cancelAnimationFrame', (id) => frames.delete(id));
  window.scrollTo = ({ top }) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const next = Math.max(0, Math.min(max, top));
    steps.push(next - window.scrollY);
    page.move(next);
    page.listeners.scroll();
  };
  return {
    frames,
    steps,
    frame(milliseconds = 100) {
      time += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(time));
    },
  };
}

const dotBlocks = ($) => $('[data-dots]').children.map((block) => ({
  top: block.style.top, height: block.style.height, width: block.style.width, shifted: block.className.includes('alternada'),
}));

test('a successful boot lays out the dots and activates the counter at mid-viewport', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  const { $, listeners, scrolls } = installPage(context);
  // The reference line at 450 px touches the first row of the column.
  $('[data-track]').top = 450;

  const { boot } = await freshRender();
  await boot();

  assert.equal($('#load-error').hidden, true);
  assert.equal($('#btn-mode').disabled, false);
  assert.equal($('[data-track]').style.height, '26px');
  assert.deepEqual(dotBlocks($), [{ top: '0px', height: '26px', width: '180px', shifted: false }]);
  assert.equal($('[data-counter-lives]').textContent, '7');
  assert.equal($('[data-counter-days]').textContent, '4 dias');
  assert.equal($('[data-announcer]').textContent, '7 vidas perdidas. 4 dias desde o primeiro registro.');

  assert.equal($('[data-counter]').attributes['data-idle'], undefined);
  assert.equal($('[data-reference-line]').style.top, '450px');
  assert.equal($('[data-reference-line]').classList.contains('reference-line--on'), true);

  // Scrolling above the column hides the counter; the announcement waits for the interval.
  $('[data-track]').top = 1000;
  listeners.scroll();
  assert.equal($('[data-counter-lives]').textContent, '0');
  assert.equal($('[data-counter-days]').textContent, '0 dias');
  assert.equal($('[data-counter]').attributes['data-idle'], '');
  assert.equal($('[data-reference-line]').classList.contains('reference-line--on'), false);
  assert.equal($('[data-announcer]').textContent, '7 vidas perdidas. 4 dias desde o primeiro registro.');
  context.mock.timers.tick(config.ANNOUNCE_INTERVAL_MS - 1);
  assert.equal($('[data-announcer]').textContent, '7 vidas perdidas. 4 dias desde o primeiro registro.');
  context.mock.timers.tick(1);
  assert.equal($('[data-announcer]').textContent, '0 vidas perdidas. 0 dias desde o primeiro registro.');

  assert.deepEqual(scrolls, []);
});

test('each leg reaches the next milestone exactly 1.6 seconds after it starts', async context => {
  mockData(context,obitosFixture(),sourcedFixture());
  const page=installPage(context);
  const {$}=page;
  $('[data-track]').top=3300;
  const {frame,frames,steps}=installPlaybackFrames(context,page);
  await (await freshRender()).boot();
  for(const selector of ['#btn-start','#btn-play','#btn-share','#btn-mode']) assert.equal($(selector).disabled,false);
  assert.equal(frames.size,0);
  $('#btn-start').listeners.click();
  // The two introductions, then the card: 400 px tall, it ends on row 0, so it starts at -399.
  for(const milestone of [1010,2110,2811]) {
    for(let index=0;index<15;index++) frame();
    assert.equal($('#btn-play').getAttribute('aria-pressed'),'true');
    assert.ok(window.scrollY<milestone);
    frame();
    assert.equal(window.scrollY,milestone);
    assert.equal($('#btn-play').getAttribute('aria-pressed'),'false');
    assert.equal($('[data-play-label]').textContent,'Continuar');
    frame();
    assert.equal(window.scrollY,milestone);
    $('#btn-play').listeners.click();
  }
  assert.ok(steps.every(step=>step>=0));
});

test('keyboard activation toggles playback once without a global keydown pause', async (context) => {
  mockData(context);
  const page = installPage(context);
  const { $, listeners } = page;
  $('[data-track]').top = 3300;
  const { frames } = installPlaybackFrames(context, page);
  await (await freshRender()).boot();
  const play = $('#btn-play');
  assert.equal(play.listeners.keydown, undefined);
  assert.equal(listeners.keydown, undefined);
  play.listeners.click();
  assert.equal(play.attributes['aria-pressed'], 'true');
  play.listeners.click();
  assert.equal(play.attributes['aria-pressed'], 'false');
  assert.equal(frames.size, 0);
  play.listeners.click();
  assert.equal(play.attributes['aria-pressed'], 'true');
});

test('dragging the page takes over from the journey in both modes, but not on the controls', async (context) => {
  mockData(context);
  const page = installPage(context);
  const { $, listeners } = page;
  $('[data-track]').top = 3300;
  installPlaybackFrames(context, page);
  await (await freshRender()).boot();
  const onPage = { target: { closest: () => null } };
  const control = { target: { closest: () => ({}) } };
  for (const mode of ['guided', 'continuous']) {
    if (mode === 'continuous') $('#btn-mode').listeners.click();
    for (const type of ['touchmove', 'wheel']) {
      $('#btn-play').listeners.click();
      listeners[type](control);
      assert.equal($('#btn-play').getAttribute('aria-pressed'), 'true', `${mode} ${type} on a control`);
      listeners[type](onPage);
      assert.equal($('#btn-play').getAttribute('aria-pressed'), 'false', `${mode} ${type}`);
    }
  }
});

test('touch activation of a transport control is exempt from the page-click pause', async (context) => {
  mockData(context);
  const page = installPage(context);
  const { $, listeners } = page;
  $('[data-track]').top = 3300;
  installPlaybackFrames(context, page);
  await (await freshRender()).boot();
  const play = $('#btn-play');
  assert.equal(listeners.pointerdown, undefined);
  for (const expected of ['true', 'false']) {
    play.listeners.click();
    listeners.click({ target: { closest: () => play } });
    assert.equal(play.attributes['aria-pressed'], expected);
  }
});

function mockNavigator(context, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
}

test('the share button beside Continuar shares the memorial or the current milestone', async (context) => {
  mockData(context, obitosFixture(), sourcedFixture());
  const shared = [];
  mockNavigator(context, { share: async (link) => { shared.push(link); } });
  const page = installPage(context);
  const { $ } = page;
  $('[data-track]').top = 3300;
  const { frame, frames } = installPlaybackFrames(context, page);
  await (await freshRender()).boot();
  const share = async () => { $('#btn-share').listeners.click(); await new Promise(setImmediate); return shared.at(-1); };
  assert.deepEqual(await share(), {
    title: 'Memorial do Covid',
    text: 'Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra? Memorial do Covid',
    url: 'https://memorial.test/',
  });

  $('#btn-start').listeners.click();
  assert.equal((await share()).url, 'https://memorial.test/');
  assert.equal($('#btn-play').attributes['aria-pressed'], 'false');
  assert.equal(frames.size, 0);

  for (const expected of ['#dimensao-da-tragedia', '#memoria-e-responsabilidade']) {
    $('#btn-play').listeners.click();
    for (let index = 0; index < 16; index++) frame();
    assert.equal((await share()).url, `https://memorial.test/${expected}`);
  }
  assert.equal(shared.at(-1).title, 'Memória e responsabilidade');
  $('#btn-play').listeners.click();
  for (let index = 0; index < 16; index++) frame();
  assert.equal($('#btn-share').attributes['aria-label'], 'Compartilhar: Resumo editorial de teste');
  assert.deepEqual(await share(), {
    title: 'Resumo editorial de teste',
    text: 'Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra? Resumo editorial de teste',
    url: 'https://memorial.test/marcos/real-1/#declaracao-real-1',
  });
});

test('clipboard fallback reports success and manual fallback shows a selectable message', async (context) => {
  mockData(context);
  let copied;
  const browser = { clipboard: { writeText: async (text) => { copied = text; } } };
  mockNavigator(context, browser);
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();
  $('#btn-share').listeners.click();
  await new Promise(setImmediate);
  assert.match(copied, /Você se lembra\? Memorial do Covid\nhttps:\/\/memorial.test\/marcos\/teste-1\/#declaracao-teste-1$/);
  assert.equal($('[data-share-status]').hidden, false);
  assert.equal($('[data-share-status]').textContent, 'Mensagem e link copiados.');
  browser.clipboard.writeText = async () => { throw new Error('denied'); };
  $('#btn-share').listeners.click();
  await new Promise(setImmediate);
  assert.equal($('[data-share-status]').hidden, true);
  assert.equal($('#share-dialog').open, true);
  assert.equal($('#share-message').value, copied);
  assert.equal($('#share-message').focused, true);
  assert.equal($('#share-message').selected, true);
  $('#share-close').listeners.click();
  assert.equal($('#share-dialog').open, false);
});

test('copy confirmation clears itself after three seconds', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  mockNavigator(context, { clipboard: { writeText: async () => {} } });
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();
  assert.equal(config.SHARE_STATUS_DURATION_MS, 3000);
  $('#btn-share').listeners.click();
  await new Promise(setImmediate);
  const status = $('[data-share-status]');
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, 'Mensagem e link copiados.');
  context.mock.timers.tick(config.SHARE_STATUS_DURATION_MS - 1);
  assert.equal(status.hidden, false);
  context.mock.timers.tick(1);
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
});

test('copying another marker resets the confirmation timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context, obitosFixture(), sourcedFixture());
  mockNavigator(context, { clipboard: { writeText: async () => {} } });
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();
  $('#btn-share').listeners.click();
  await new Promise(setImmediate);
  context.mock.timers.tick(2000);
  $('#btn-share').listeners.click();
  await new Promise(setImmediate);
  const status = $('[data-share-status]');
  context.mock.timers.tick(1000);
  assert.equal(status.hidden, false, 'the first copy must not hide the second confirmation');
  context.mock.timers.tick(1999);
  assert.equal(status.hidden, false);
  context.mock.timers.tick(1);
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
});

test('pending copy requests cannot leave an older timeout hiding a newer confirmation', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  const completions = [];
  mockNavigator(context, {
    clipboard: { writeText: () => new Promise((resolve) => completions.push(resolve)) },
  });
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();
  $('#btn-share').listeners.click();
  $('#btn-share').listeners.click();
  completions[0]();
  await new Promise(setImmediate);
  context.mock.timers.tick(2000);
  completions[1]();
  await new Promise(setImmediate);
  const status = $('[data-share-status]');
  context.mock.timers.tick(1000);
  assert.equal(status.hidden, false);
  context.mock.timers.tick(2000);
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
});

test('shared anchors open at the correct dot row after separators and support hash changes', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.forEach((dia, index) => { dia.acumulado = [10, 1000, 1000, 1010][index]; });
  mockData(context, obitos);
  const { $, listeners, scrolls } = installPage(context);
  const absoluteTop = 1000;
  $('[data-track]').top = absoluteTop;
  window.scrollTo = (options) => {
    scrolls.push(options);
    window.scrollY = options.top;
    $('[data-track]').top = absoluteTop - options.top;
  };
  window.location.hash = '#declaracao-teste-2';
  const { boot } = await freshRender();
  await boot();
  // teste-2 ends on row 100, after the 1.000 separator: its marker starts at 2703, the card at 2279.
  assert.deepEqual(scrolls, [{ top: 3189, behavior: 'instant' }]);
  assert.equal($('[data-counter-lives]').textContent, '1.000');
  assert.deepEqual($('[data-marks]').children.map((card) => card.hidden), [false, false]);
  window.location.hash = '#declaracao-teste-1';
  listeners.hashchange();
  assert.equal(scrolls.at(-1).top, 511);
  assert.equal($('[data-counter-lives]').textContent, '0');
  assert.deepEqual($('[data-marks]').children.map((card) => card.hidden), [false, false]);
  for (const hash of ['#unknown', '#%bad%escape']) {
    window.location.hash = hash;
    listeners.hashchange();
    assert.equal(scrolls.length, 2);
  }
});

test('a static milestone route opens at its marker even when the fragment is omitted', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.forEach((dia, index) => { dia.acumulado = [990, 1000, 1000, 1010][index]; });
  mockData(context, obitos);
  const { $, scrolls } = installPage(context);
  $('[data-track]').top = 1000;
  const query = document.querySelector;
  const marker = new FakeElement('span');
  marker.setAttribute('data-initial-statement', 'teste-2');
  document.querySelector = (selector) => selector === '[data-initial-statement]' ? marker : query(selector);
  const { boot } = await freshRender();
  await boot();
  assert.deepEqual(scrolls, [{ top: 3189, behavior: 'instant' }]);
});

test('viewport adjustments and resize events do not stop automatic playback', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  const page = installPage(context);
  const { $, listeners } = page;
  $('[data-track]').top = 3300;
  const viewportListeners = {};
  window.visualViewport = { height: 600, offsetTop: 0, addEventListener: (type, listener) => { viewportListeners[type] = listener; } };
  const { frame } = installPlaybackFrames(context, page);
  const { boot } = await freshRender();
  await boot();
  $('#btn-start').listeners.click();
  window.visualViewport.height = 520;
  window.visualViewport.offsetTop = 30;
  viewportListeners.resize();
  viewportListeners.scroll();
  listeners.resize();
  frame();
  assert.equal($('#btn-play').attributes['aria-pressed'], 'true');
  assert.equal($('[data-reference-line]').style.top, '290px');
});

test('the mobile address bar resizing the viewport moves neither the reading line nor the stops', async (context) => {
  mockData(context, obitosFixture(), sourcedFixture());
  const page = installPage(context);
  const { $, listeners, scrolls } = page;
  $('[data-track]').top = 1000;
  const viewportListeners = {};
  window.visualViewport = { height: 760, offsetTop: 0, addEventListener: (type, listener) => { viewportListeners[type] = listener; } };
  await (await freshRender()).boot();
  const card = $('[data-marks]').children[0];
  let measured = 0;
  Object.defineProperty(card, 'offsetHeight', { get: () => { measured++; return 400; } });
  window.location.hash = '#declaracao-real-1';
  listeners.hashchange();
  const stop = scrolls.at(-1).top;
  assert.equal($('[data-floating]').style.top, '90px');
  measured = 0;
  for (const height of [844, 700, 844]) {
    window.visualViewport.height = height;
    window.innerHeight = height;
    viewportListeners.resize();
    listeners.resize();
  }
  assert.equal(measured, 0, 'a height-only resize must not lay the column out again');
  assert.equal($('[data-floating]').style.top, '90px');
  listeners.hashchange();
  assert.equal(scrolls.at(-1).top, stop);
  window.innerWidth = 390;
  listeners.resize();
  assert.ok(measured > 0, 'a width change lays the column out again');
});

test('dots are page blocks in the column layer, with alternating rows and blank separators', async (context) => {
  // 2056 lives: two full thousands, then 5 rows and a partial row of 6 dots. Row 205 is odd,
  // so the partial row starts with the gray color.
  const obitos = obitosFixture();
  obitos.dias.at(-1).acumulado = 2056;
  mockData(context, obitos, { sintetico: false, declaracoes: [] });
  const { $, listeners } = installPage(context);
  await (await freshRender()).boot();
  const blocks = [
    { top: '0px', height: '2600px', width: undefined, shifted: false },
    { top: '2678px', height: '2600px', width: undefined, shifted: false },
    { top: '5356px', height: '130px', width: undefined, shifted: false },
    { top: '5486px', height: '26px', width: '154px', shifted: true },
  ];
  assert.deepEqual(dotBlocks($), blocks);
  const separators = $('[data-separators]').children.map((label) => parseFloat(label.style.top));
  assert.deepEqual(separators, [2600, 5278]);
  for (const block of dotBlocks($)) {
    const top = parseFloat(block.top);
    const bottom = top + parseFloat(block.height);
    assert.ok(separators.every((slot) => bottom <= slot || top >= slot + layout.separatorHeight()), block.top);
  }
  // Scrolling moves the page, not the dots: nothing is redrawn or repositioned.
  for (const top of [-26, -2600.5, 0]) {
    $('[data-track]').top = top;
    listeners.scroll();
    assert.deepEqual(dotBlocks($), blocks);
  }
});

test('separator labels and counter dates preserve the empty three-row space', async context => {
  const obitos=obitosFixture();
  obitos.dias.forEach((dia,index)=>{dia.acumulado=[990,1000,1990,2010][index];});
  mockData(context,obitos,{ sintetico: false, declaracoes: [] });
  const {$,listeners}=installPage(context);
  await (await freshRender()).boot();
  const labels=$('[data-separators]').children;
  assert.deepEqual(labels.map(label=>label.attributes['data-lives']),['1000','2000']);
  assert.deepEqual(labels.map(label=>label.style.top),['2600px','5278px']);
  assert.deepEqual(labels.map(label=>label.text),['1.000vidas','2.000vidas']);
  assert.equal($('[data-track]').style.height,'5382px');
  for(const [depth,lives,days] of [
    [2574,'1.000','2 dias'],[2600,'1.000','2 dias'],[2677.9,'1.000','2 dias'],
    [2678,'1.010','3 dias'],[5278,'2.000','4 dias'],[5356,'2.010','4 dias'],
  ]) {
    $('[data-track]').top=450-depth;
    listeners.scroll();
    assert.equal($('[data-counter-lives]').textContent,lives);
    assert.equal($('[data-counter-days]').textContent,days);
  }
});

test('each card ends where the column reaches its day\'s official total, shown by its marker', async context => {
  // Day totals 1, 3, 3 and 7: both days end on row 0, so both markers start in the gap after
  // it. The 400 px cards end one gap above, and the column leaves room above itself for them.
  mockData(context);
  const {$}=installPage(context);
  await (await freshRender()).boot();
  assert.deepEqual($('[data-marks]').children.map(card=>card.style.top),['-399px','-399px']);
  const markers=$('[data-news-markers]').children;
  // Sharing a position, only the first card and its marker show until Continuar.
  assert.equal(markers[0].style.top,'25px');
  assert.deepEqual(markers.map(marker=>marker.classes.has('memorial__separator--oculto')),[false,true]);
  assert.deepEqual(markers.map(marker=>marker.text),['1vida até 17/03/2020','7vidas até 20/03/2020']);
  assert.equal($('[data-track]').style.marginTop,'423px');
});

test('a taller card further down never makes the journey scroll back', async context => {
  // 17/03 ends on row 0 and 20/03 on row 2. The second card is 600 px tall, so it would start
  // above the first; the first starts with it instead, and both stops share one position.
  const obitos=obitosFixture();
  obitos.dias.at(-1).acumulado=30;
  const entries=sourcedFixture();
  entries.declaracoes=[{...entries.declaracoes[0],id:'first',data:'2020-03-17'},{...entries.declaracoes[0],id:'second',data:'2020-03-20'}];
  mockData(context,obitos,entries);
  const {$,listeners,scrolls}=installPage(context);
  $('[data-track]').top=1000;
  await (await freshRender()).boot();
  const [first,second]=$('[data-marks]').children;
  second.offsetHeight=600;
  window.innerWidth=390;
  listeners.resize();
  assert.deepEqual([first.style.top,second.style.top],['-547px','-547px']);
  assert.deepEqual($('[data-news-markers]').children[0].style.top,'25px');
  for (const id of ['first','second']) {
    window.location.hash=`#declaracao-${id}`;
    listeners.hashchange();
  }
  assert.deepEqual(scrolls.slice(-2).map(({top})=>top),[363,363]);
});

test('a lives marker shows the day total where the column reaches it, taking a nearby separator slot', async context => {
  // The marker starts in the gap after the row of the day's last life, and the 400 px card
  // ends 24 px above it. At row 50 nothing is near. At rows 98 and 99 the 1.000 slot (y 2600)
  // lies just below, so the marker takes it. At row 100 the slot sits behind the card instead.
  for (const [dayTotal,cardTop,top,skipped] of [
    [510,'901px','1325px',false],
    [990,'2176px','2600px',true],
    [1000,'2176px','2600px',true],
    [1003,'2279px','2703px',true],
  ]) {
    const obitos=obitosFixture();
    obitos.dias.forEach((dia,index)=>{dia.acumulado=[10,dayTotal,dayTotal,2010][index];});
    mockData(context,obitos,sourcedFixture());
    const {$}=installPage(context);
    await (await freshRender()).boot();
    const [marker]=$('[data-news-markers]').children;
    assert.equal(marker.text,`${dayTotal.toLocaleString('pt-BR')}vidas até 18/03/2020`);
    assert.equal($('[data-marks]').children[0].style.top,cardTop);
    assert.deepEqual([marker.style.top,marker.style.height],[top,'78px']);
    assert.equal(marker.classes.has('memorial__separator--oculto'),false);
    const separators=$('[data-separators]').children;
    assert.deepEqual(separators.map(label=>label.attributes['data-lives']),['1000','2000']);
    assert.deepEqual(separators.map(label=>label.classes.has('memorial__separator--oculto')),[skipped,false]);
  }
});

test('continuous mode hides the lives markers and restores every thousand separator', async context => {
  const obitos=obitosFixture();
  obitos.dias.forEach((dia,index)=>{dia.acumulado=[10,990,990,2010][index];});
  mockData(context,obitos,sourcedFixture());
  const {$}=installPage(context);
  await (await freshRender()).boot();
  const separators=$('[data-separators]').children;
  assert.deepEqual(separators.map(label=>label.classes.has('memorial__separator--oculto')),[true,false]);
  $('#btn-mode').listeners.click();
  assert.equal($('[data-news-markers]').hidden,true);
  assert.deepEqual(separators.map(label=>label.classes.has('memorial__separator--oculto')),[false,false]);
  $('#btn-mode').listeners.click();
  assert.equal($('[data-news-markers]').hidden,false);
  assert.deepEqual(separators.map(label=>label.classes.has('memorial__separator--oculto')),[true,false]);
});

test('mobile cards use the page scroll, share from the controls and collapse supplementary text', async context => {
  mockData(context,obitosFixture(),sourcedFixture());
  const {$}=installPage(context);
  window.innerWidth=320; window.innerHeight=740;
  await (await freshRender()).boot();
  const card=$('[data-marks]').children[0];
  const header=card.children[0];
  const buttons=[...card.descendants()].filter(node=>node.tagName==='button');
  assert.deepEqual(buttons.map(button=>button.className),['declaracao__compartilhar']);
  assert.equal(header.children[0].children[1],buttons[0]);
  assert.equal($('#btn-share').disabled,false);
  const more=card.children.find(node=>node.tagName==='details');
  assert.ok(!more.open);
  assert.match(more.text,/Contexto de teste/);
  const css=await read('src/styles/global.css');
  assert.doesNotMatch(css,/overflow-y:\s*auto|--card-space/);
  assert.match(css,/\.declaracao\s*\{[^}]*position: absolute/);
});

test('the memorial renders weekly dates starting on March 30', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.push(
    { data: '2020-03-23', acumulado: 15 },
    { data: '2020-03-30', acumulado: 100 },
    { data: '2020-04-06', acumulado: 150 },
    { data: '2020-04-13', acumulado: 250 },
  );
  mockData(context, obitos, { sintetico: false, declaracoes: [] });
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();

  const labels = $('[data-weeks]').children;
  assert.deepEqual(labels.map((label) => label.text), ['30/03/2020', '06/04/2020', '13/04/2020']);
  assert.deepEqual(labels.map((label) => label.style.top), ['26px', '260px', '390px']);
  assert.ok(labels.every((label) => label.className === 'marco-semana'));
  assert.deepEqual(labels.map((label) => label.children[0].dateTime), [
    '2020-03-30', '2020-04-06', '2020-04-13',
  ]);
});

test('weekly dates hidden behind a news card or its lives marker return in continuous mode', async context => {
  const obitos = obitosFixture();
  obitos.dias.push(
    { data: '2020-03-23', acumulado: 15 },
    { data: '2020-03-30', acumulado: 100 },
    { data: '2020-04-06', acumulado: 150 },
    { data: '2020-04-13', acumulado: 250 },
    { data: '2020-04-20', acumulado: 400 },
  );
  // The card of 06/04 ends on row 14 and starts at -35; with its marker it spans up to 467.
  const entries = sourcedFixture();
  entries.declaracoes[0].data = '2020-04-06';
  mockData(context, obitos, entries);
  const { $, listeners } = installPage(context);
  await (await freshRender()).boot();
  const labels = $('[data-weeks]').children;
  for (const label of labels) label.offsetHeight = 30;
  listeners.resize();
  assert.deepEqual(labels.map(label => label.style.top), ['26px', '260px', '390px', '650px']);
  const hidden = () => labels.map(label => label.classes.has('marco-semana--oculto'));
  assert.deepEqual(hidden(), [true, true, true, false]);
  $('#btn-mode').listeners.click();
  assert.deepEqual(hidden(), [false, false, false, false]);
});

test('synthetic statements are labeled and never become source links', async (context) => {
  mockData(context);
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();

  assert.equal($('[data-aviso-sintetico]').hidden, false);
  const cards = $('[data-marks]').children.filter((node) => node.tagName === 'article');
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.equal(card.attributes.tabindex, '-1');
    const [header] = card.children;
    assert.equal(header.tagName, 'header');
    assert.equal(header.children[0].className, 'declaracao__selo');
    assert.equal(header.children[0].textContent, 'exemplo sintético');
    assert.match(card.text, /\[Exemplo sintético \d\]/);
  }
  const links = [...$('[data-marks]').descendants()].filter((node) => node.tagName === 'a');
  assert.deepEqual(links.map((link) => link.href), [
    '/referencias#declaracao-teste-1', '/referencias#declaracao-teste-2',
  ]);
  assert.ok(links.every((link) => !link.href.includes('example.invalid')));
});

test('sourced statements link to their references without the synthetic label', async (context) => {
  mockData(context, obitosFixture(), sourcedFixture());
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();

  assert.equal($('[data-aviso-sintetico]').hidden, true);
  const [card] = $('[data-marks]').children.filter((node) => node.tagName === 'article');
  assert.doesNotMatch(card.text, /exemplo sintético/);
  assert.match(card.text, /Autor de teste/);
  assert.ok(!card.children.find(node => node.tagName === 'details').open);
  assert.match(card.text, /Contexto de teste/);
  const [header] = card.children;
  assert.equal(header.tagName, 'header');
  const [date] = header.children[0].children;
  assert.equal(date.tagName, 'time');
  assert.equal(date.dateTime, '2020-03-18');
  assert.equal(date.textContent, '18/03/2020');
  assert.equal(header.children[1].tagName, 'h3');
  assert.equal(header.children[1].textContent, 'Resumo editorial de teste');
  assert.equal(card.children.find((node) => node.tagName === 'blockquote').textContent, 'Texto de teste com fonte.');
  assert.equal(card.style.top, '-399px');
  const links = [...card.descendants()].filter((node) => node.tagName === 'a');
  assert.deepEqual(links.map((link) => link.href), ['/referencias#declaracao-real-1']);
});

test('real statements retain each author, quote and reference when the active card changes', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.forEach((dia, index) => { dia.acumulado = [10, 20, 20, 30][index]; });
  const statements = sourcedFixture();
  const [original] = statements.declaracoes;
  statements.declaracoes = [1, 2].map((number) => ({
    ...original,
    id: `autor-${number}`,
    data: number === 1 ? '2020-03-17' : '2020-03-20',
    autor: `Autor ${number}`,
    subtitulo: `Resumo ${number}`,
    texto: `Citação ${number}`,
    contexto: `Contexto ${number}`,
  }));
  mockData(context, obitos, statements);
  const { $, listeners } = installPage(context);
  $('[data-track]').top = 450;
  const { boot } = await freshRender();
  await boot();

  const cards = $('[data-marks]').children;
  assert.deepEqual(cards.map((card) => card.hidden), [false, false]);
  for (const [index, card] of cards.entries()) {
    const [header] = card.children;
    assert.equal(header.children[1].textContent, `Resumo ${index + 1}`);
    assert.equal(header.children[2].textContent, `Autor ${index + 1}`);
    assert.equal(card.children.find((node) => node.tagName === 'blockquote').textContent, `Citação ${index + 1}`);
    assert.equal([...card.descendants()].find((node) => node.tagName === 'a').href, `/referencias#declaracao-autor-${index + 1}`);
    assert.match(card.text, /Contexto/);
    assert.ok(!card.children.find(node => node.tagName === 'details').open);
  }
  $('[data-track]').top = 398;
  listeners.scroll();
  assert.deepEqual(cards.map((card) => card.hidden), [false, false]);
  $('[data-track]').top = 450;
  listeners.scroll();
  assert.deepEqual(cards.map((card) => card.hidden), [false, false]);

  const references = installPage(context, true);
  await bootReferencias();
  const entries = references.$('[data-fontes-declaracoes]').children;
  assert.equal(entries.length, 2);
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.id, `declaracao-autor-${index + 1}`);
    assert.equal(entry.children[0].dateTime, statements.declaracoes[index].data);
    assert.equal(entry.children[1].textContent, `Resumo ${index + 1}`);
    assert.equal(entry.children[2].textContent, `Autor ${index + 1}`);
    assert.equal(entry.children[3].textContent, `Citação ${index + 1}`);
    assert.equal(entry.children[4].textContent, `Contexto ${index + 1}`);
  }
});

test('historical news renders as editorial text rather than a literal quotation', async (context) => {
  const entries = sourcedFixture();
  Object.assign(entries.declaracoes[0], {
    tipo: 'noticia', texto: '<img src=x onerror=alert(1)> Um marco histórico.',
  });
  mockData(context, obitosFixture(), entries);
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();
  const [card] = $('[data-marks]').children;
  assert.equal(card.attributes['data-tipo'], 'noticia');
  assert.equal(card.children[1].tagName, 'p');
  assert.equal(card.children[1].textContent, entries.declaracoes[0].texto);
  assert.ok([...card.descendants()].every((node) => node.tagName !== 'blockquote' && node.tagName !== 'img'));
  assert.match(card.children.find(node => node.tagName === 'details').text, /não uma citação literal/);
  const refs = installPage(context, true);
  await bootReferencias();
  const [reference] = refs.$('[data-fontes-declaracoes]').children;
  assert.equal(reference.attributes['data-tipo'], 'noticia');
  assert.equal(reference.children[3].tagName, 'p');
  assert.equal(reference.children[3].textContent, entries.declaracoes[0].texto);
  assert.match(reference.text, /não uma citação literal/);
});

test('each card has its own small share button, also on the floating header', async context => {
  const entries=sourcedFixture();
  entries.declaracoes=[{...entries.declaracoes[0],id:'first',subtitulo:'Primeiro'},{...entries.declaracoes[0],id:'second',subtitulo:'Segundo'}];
  mockData(context,obitosFixture(),entries);
  const shared=[];
  mockNavigator(context,{share:async link=>{shared.push(link);}});
  const page=installPage(context);
  page.$('[data-track]').top=90;
  installPlaybackFrames(context,page);
  await (await freshRender()).boot();
  const share=card=>[...card.descendants()].find(node=>node.className==='declaracao__compartilhar');
  share(page.$('[data-marks]').children[1]).listeners.click();
  await new Promise(setImmediate);
  assert.deepEqual(shared[0],{
    title:'Segundo',
    text:'Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra? Segundo',
    url:'https://memorial.test/marcos/second/#declaracao-second',
  });
  page.$('#btn-mode').listeners.click();
  share(page.$('[data-floating]').children[0]).listeners.click();
  await new Promise(setImmediate);
  assert.equal(shared[1].url,'https://memorial.test/marcos/first/#declaracao-first');
});

test('the journey ends on the closing message, which hides the controls and shares the memorial', async context => {
  mockData(context,obitosFixture(),sourcedFixture());
  const shared=[];
  mockNavigator(context,{share:async link=>{shared.push(link);}});
  const page=installPage(context);
  const {$}=page;
  $('[data-track]').top=1000;
  $('[data-closing]').style.top='3000';
  const {frame}=installPlaybackFrames(context,page);
  await (await freshRender()).boot();
  $('#btn-start').listeners.click();
  for(let index=0;index<16;index++) frame();
  assert.equal(window.scrollY,511);
  assert.equal($('[data-playback]').hidden,false);
  $('#btn-play').listeners.click();
  for(let index=0;index<16;index++) frame();
  assert.equal(window.scrollY,4000);
  assert.equal($('#btn-play').getAttribute('aria-pressed'),'false');
  frame();
  assert.equal($('[data-playback]').hidden,true);
  $('[data-share-closing]').listeners.click();
  await new Promise(setImmediate);
  assert.deepEqual(shared.at(-1),{
    title:'Memorial do Covid',
    text:'Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra? Memorial do Covid',
    url:'https://memorial.test/',
  });
});

test('continuous mode rests on the closing message instead of the page bottom', async context => {
  mockData(context,obitosFixture(),sourcedFixture());
  const page=installPage(context);
  const {$}=page;
  $('[data-track]').top=1000;
  $('[data-closing]').style.top='3000';
  const {frame}=installPlaybackFrames(context,page);
  await (await freshRender()).boot();
  $('#btn-mode').listeners.click();
  $('#btn-play').listeners.click();
  for(let index=0;index<200 && $('#btn-play').getAttribute('aria-pressed')==='true';index++) frame();
  assert.equal(window.scrollY,4000);
});

test('weekly dates closer than four rows are skipped instead of overlapping', async context => {
  const obitos=obitosFixture();
  obitos.dias.push(
    {data:'2020-03-23',acumulado:15},{data:'2020-03-30',acumulado:30},{data:'2020-04-06',acumulado:40},
    {data:'2020-04-13',acumulado:130},{data:'2020-04-20',acumulado:200},
  );
  mockData(context,obitos,{sintetico:false,declaracoes:[]});
  const {$}=installPage(context);
  await (await freshRender()).boot();
  assert.deepEqual($('[data-weeks]').children.map(label=>label.text),['30/03/2020','20/04/2020']);
});

test('same-row markers keep their dot row and Continuar steps through them in place', async context => {
  const entries=sourcedFixture();
  const first=entries.declaracoes[0];
  entries.declaracoes=[{...first,id:'first'},{...first,id:'second'},{...first,id:'third'}];
  mockData(context,obitosFixture(),entries);
  const shared=[];
  mockNavigator(context,{share:async link=>{shared.push(link);}});
  const page=installPage(context);
  const {$,listeners}=page;
  $('[data-track]').top=1000;
  installPlaybackFrames(context,page);
  await (await freshRender()).boot();
  const cards=$('[data-marks]').children;
  const shown=()=>cards.map(card=>!card.classes.has('declaracao--oculta'));
  assert.deepEqual(cards.map(card=>card.style.top),['-399px','-399px','-399px']);
  assert.deepEqual(shown(),[true,false,false]);
  window.location.hash='#declaracao-second';
  listeners.hashchange();
  assert.equal(window.scrollY,511);
  assert.deepEqual(shown(),[false,true,false]);
  $('#btn-play').listeners.click();
  assert.equal(window.scrollY,511);
  assert.equal($('#btn-play').getAttribute('aria-pressed'),'false');
  assert.deepEqual(shown(),[false,false,true]);
  $('#btn-share').listeners.click();
  await new Promise(setImmediate);
  assert.equal(shared[0].url,'https://memorial.test/marcos/third/#declaracao-third');
  $('#btn-play').listeners.click();
  assert.equal($('#btn-play').getAttribute('aria-pressed'),'true');
});

test('milestone subtitles are separate headings and never interpreted as HTML', async (context) => {
  const statements = sourcedFixture();
  const subtitle = 'Resumo <img src=x onerror=alert(1)>';
  statements.declaracoes[0].subtitulo = subtitle;
  mockData(context, obitosFixture(), statements);
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();

  const [card] = $('[data-marks]').children;
  const nodes = [...card.descendants()];
  assert.equal(nodes.find((node) => node.tagName === 'h3').textContent, subtitle);
  assert.equal(nodes.find((node) => node.tagName === 'blockquote').textContent, 'Texto de teste com fonte.');
  assert.ok(nodes.every((node) => !['script', 'img'].includes(node.tagName)));
});

test('continuous mode floats only the latest header and supports backwards scrolling', async context => {
  const entries=sourcedFixture();
  entries.declaracoes=[{...entries.declaracoes[0],id:'first',data:'2020-03-17'},{...entries.declaracoes[0],id:'second',data:'2020-03-20'}];
  const obitos=obitosFixture();
  obitos.dias.forEach((dia,index)=>{dia.acumulado=[10,20,20,30][index];});
  mockData(context,obitos,entries);
  const {$,listeners}=installPage(context);
  $('[data-track]').top=1000;
  await (await freshRender()).boot();
  $('#btn-mode').listeners.click();
  const floatingDate=()=>[...$('[data-floating]').descendants()].find(node=>node.tagName==='time')?.dateTime;
  // Brings a card to the reading line, 90 px from the top.
  const readAt=card=>{
    $('[data-track]').top=90-parseInt(card.style.top);
    listeners.scroll();
  };
  const [first,second]=$('[data-marks]').children;
  readAt(first);
  assert.equal(floatingDate(),'2020-03-17');
  readAt(second);
  assert.equal(floatingDate(),'2020-03-20');
  readAt(first);
  assert.equal(floatingDate(),'2020-03-17');
  $('[data-track]').top=1000;
  listeners.scroll();
  assert.equal($('[data-floating]').hidden,true);
});

test('mobile viewport resizing keeps the counter on the visible midpoint', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.forEach((dia, index) => { dia.acumulado = [10, 20, 20, 300][index]; });
  mockData(context, obitos, { sintetico: false, declaracoes: [] });
  const { $, scrolls } = installPage(context);
  const viewportListeners = {};
  window.visualViewport = {
    height: 600,
    offsetTop: 20,
    addEventListener: (event, listener) => { viewportListeners[event] = listener; },
  };
  $('[data-track]').top = 294;
  const { boot } = await freshRender();
  await boot();

  assert.equal($('[data-reference-line]').style.top, '320px');
  assert.equal($('[data-counter-lives]').textContent, '20');
  assert.equal($('[data-counter]').attributes['data-idle'], undefined);

  window.visualViewport.height = 500;
  window.visualViewport.offsetTop = 30;
  viewportListeners.resize();
  assert.equal($('[data-reference-line]').style.top, '280px');
  assert.equal($('[data-counter-lives]').textContent, '0');
  assert.equal($('[data-counter]').attributes['data-idle'], '');

  window.visualViewport.offsetTop = 70;
  viewportListeners.scroll();
  assert.equal($('[data-reference-line]').style.top, '320px');
  assert.equal($('[data-counter-lives]').textContent, '20');
  assert.deepEqual(scrolls, []);
});

test('references load coverage and sources without the column or counter', async (context) => {
  mockData(context);
  const { $ } = installPage(context, true);
  await bootReferencias();

  assert.equal($('#load-error').hidden, true);
  assert.equal($('[data-dyn="inicio"]').textContent, '17/03/2020');
  assert.equal($('[data-dyn="inicio"]').dateTime, '2020-03-17');
  assert.equal($('[data-dyn="fim"]').textContent, '20/03/2020');
  assert.equal($('[data-dyn="acessado-em"]').textContent, '02/01/2026');
  assert.equal($('[data-dyn="total"]').textContent, '7');
  assert.equal($('[data-dyn-link="fonte"]').href, 'https://fonte.test/painel');
  const sources = [...$('[data-fontes-obitos]').descendants()].filter((node) => node.tagName === 'a');
  assert.deepEqual(sources.map((link) => link.href), ['https://fonte.test/painel']);
  const statements = $('[data-fontes-declaracoes]');
  assert.match(statements.text, /Declarações sintéticas de exemplo, sem fonte real/);
  assert.match(statements.text, /Data de acesso fictícia: 02\/01\/2026/);
  assert.ok([...statements.descendants()].every((node) => node.tagName !== 'a'));
});

test('references show genuine sources and resolve encoded statement anchors', async (context) => {
  const statements = sourcedFixture();
  statements.declaracoes[0].id = 'fala de teste';
  mockData(context, obitosFixture(), statements);
  const { $ } = installPage(context, true);
  window.location.hash = '#declaracao-fala%20de%20teste';
  await bootReferencias();

  assert.equal($('#load-error').hidden, true);
  const [entry] = $('[data-fontes-declaracoes]').children;
  assert.equal(entry.id, 'declaracao-fala de teste');
  assert.equal(entry.scrolled, true);
  assert.doesNotMatch(entry.text, /sintético|fictícia/);
  assert.match(entry.text, /Autor de teste/);
  assert.match(entry.text, /Contexto de teste separado da citação/);
  assert.equal(entry.children.find((node) => node.tagName === 'blockquote').textContent, 'Texto de teste com fonte.');
  const links = [...entry.descendants()].filter((node) => node.tagName === 'a');
  assert.deepEqual(links.map((link) => link.href), ['https://fonte.test/declaracao-1']);
});

test('references keep quote fragments, author and context as text rather than HTML', async (context) => {
  const statements = sourcedFixture();
  const quote = 'Primeiro trecho.\n\nSegundo trecho <script>alert(1)</script>.';
  const author = 'Autor <img src=x onerror=alert(1)>';
  const subtitle = 'Resumo <script>alert(1)</script>';
  const contextText = 'Contexto <a href="javascript:alert(1)">separado</a>.';
  Object.assign(statements.declaracoes[0], { texto: quote, autor: author, subtitulo: subtitle, contexto: contextText });
  mockData(context, obitosFixture(), statements);
  const { $ } = installPage(context, true);
  await bootReferencias();

  const [entry] = $('[data-fontes-declaracoes]').children;
  assert.equal(entry.children[0].tagName, 'time');
  assert.equal(entry.children[0].dateTime, statements.declaracoes[0].data);
  assert.equal(entry.children[1].textContent, subtitle);
  assert.equal(entry.children[2].textContent, author);
  assert.equal(entry.children[3].tagName, 'blockquote');
  assert.equal(entry.children[3].textContent, quote);
  assert.equal(entry.children[4].textContent, contextText);
  assert.ok([...entry.descendants()].every((node) => !['script', 'img'].includes(node.tagName)));
});

test('references report failed or invalid data without inventing coverage', async (context) => {
  for (const response of [
    () => new Response('not found', { status: 404 }),
    () => Response.json({ ...obitosFixture(), criterio: 'outro' }),
  ]) {
    context.mock.method(globalThis, 'fetch', async (url) => (
      url === '/data/obitos.json' ? response() : Response.json(syntheticFixture())
    ));
    const { $ } = installPage(context, true);
    await bootReferencias();
    assert.equal($('#load-error').hidden, false);
    assert.equal($('[data-dyn="total"]').textContent, '…');
    assert.equal($('[data-dyn="inicio"]').textContent, '…');
    assert.deepEqual($('[data-fontes-obitos]').children, []);
  }
});

test('missing, invalid, or oversized data shows the error and draws nothing', async (context) => {
  const tooLarge = obitosFixture();
  tooLarge.dias.push({ data: '2020-03-21', acumulado: 20_000_001 });
  const failures = {
    missing: async () => new Response('not found', { status: 404 }),
    invalid: async () => Response.json({ ...obitosFixture(), criterio: 'outro' }),
    oversized: async () => Response.json(tooLarge),
  };
  for (const [name, respond] of Object.entries(failures)) {
    await context.test(name, async (t) => {
      t.mock.method(globalThis, 'fetch', async (url) => (
        url === '/data/obitos.json' ? respond() : Response.json(syntheticFixture())
      ));
      const { $, listeners } = installPage(t);
      const { boot } = await freshRender();
      await boot();

      assert.equal($('#load-error').hidden, false);
      for (const selector of ['#btn-start', '#btn-play', '#btn-mode']) {
        assert.equal($(selector).disabled, true, selector);
      }
      assert.equal(listeners.wheel, undefined);
      assert.deepEqual($('[data-dots]').children, []);
      assert.equal($('[data-track]').style.height, undefined);
      assert.deepEqual($('[data-marks]').children, []);
      for (const selector of ['[data-counter-lives]', '[data-counter-days]']) {
        assert.equal($(selector).textContent, '…', selector);
      }
      assert.equal($('[data-announcer]').textContent, '…');
      assert.equal(listeners.scroll, undefined);
    });
  }
});
