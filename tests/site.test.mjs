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
const autoscrollUrl = moduleUrl(await read('src/lib/autoscroll.ts'));
const sharingUrl = moduleUrl(await read('src/lib/sharing.ts'));
const renderSource = (await read('src/lib/render.ts'))
  .replaceAll("'../config'", JSON.stringify(configUrl))
  .replaceAll("'./layout'", JSON.stringify(layoutUrl))
  .replaceAll("'./state'", JSON.stringify(stateUrl))
  .replaceAll("'./autoscroll'", JSON.stringify(autoscrollUrl))
  .replaceAll("'./sharing'", JSON.stringify(sharingUrl))
  .replaceAll('import.meta.env.BASE_URL', "'/'");
const referencesSource = (await read('src/lib/referencias.ts'))
  .replaceAll("'./state'", JSON.stringify(stateUrl));
const { bootReferencias } = await import(moduleUrl(referencesSource));

// render.ts keeps module state, so every boot gets a fresh module instance.
let renderInstances = 0;
const freshRender = () => import(moduleUrl(`${renderSource}\n// instance ${renderInstances++}`));

const SUBTITLE =
  'Não esqueceremos o papel da família bolsonaro e a negligência negacionista que ampliou inúmeras vezes a magnitude dessa catástrofe no Brasil';

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

test('visible ranges stay bounded by the viewport, not the national total', () => {
  const total = 716_626;
  assert.deepEqual(layout.visibleIndexRange(0, 800, total), { start: 0, end: 310 });
  assert.deepEqual(layout.visibleIndexRange(-100, 200, total), { start: 0, end: 40 });
  assert.deepEqual(layout.visibleIndexRange(-500, 200, total), { start: 0, end: 0 });
  assert.deepEqual(layout.visibleIndexRange(layout.columnHeight(25) - 26, 800, 25), { start: 20, end: 25 });
  assert.deepEqual(layout.visibleIndexRange(1e9, 800, 25), { start: 25, end: 25 });
  assert.deepEqual(layout.visibleIndexRange(0.5, 26, 25), { start: 0, end: 20 });
  assert.deepEqual(layout.visibleIndexRange(0, 26, 25), { start: 0, end: 10 });
  assert.deepEqual(layout.visibleIndexRange(0.25, 25.75, 25), { start: 0, end: 10 });
  assert.deepEqual(layout.visibleIndexRange(25.5, 0.6, 25), { start: 0, end: 20 });
  assert.deepEqual(layout.visibleIndexRange(-0.5, 26.4, 25), { start: 0, end: 10 });
  const bound = (Math.ceil(900.5 / layout.rowPitch()) + 1) * config.DOTS_PER_ROW;
  for (const top of [0, 3, 4_001, 287_777.4, layout.columnHeight(total) - 900.5]) {
    const { start, end } = layout.visibleIndexRange(top, 900.5, total);
    assert.ok(end - start <= bound, `range at ${top} has ${end - start} dots`);
    assert.ok(start >= 0 && end <= total);
  }
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

test('visible ranges exclude separators at exact and fractional boundaries', () => {
  for (const [top, height, start, end] of [
    [2574, 26, 990, 1000],
    [2600, 78, 1000, 1000],
    [2600.1, 77.8, 1000, 1000],
    [2599.9, 0.2, 990, 1000],
    [2677.9, 0.2, 1000, 1010],
    [2678, 26, 1000, 1010],
    [2574, 130, 990, 1010],
    [5278, 78, 2000, 2000],
    [5356, 26, 2000, 2010],
  ]) assert.deepEqual(layout.visibleIndexRange(top, height, 2500), { start, end });
});

test('viewport ranges agree with independently positioned rows across thousands', () => {
  for (const total of [1, 9, 10, 999, 1000, 1001, 1010, 1999, 2000, 2001, 2056]) {
    const rows = Array.from({ length: Math.ceil(total / 10) }, (_, row) => ({
      start: row * 10, end: Math.min((row + 1) * 10, total),
      y: row * 26 + Math.floor(row / 100) * 78,
    }));
    for (const top of [-100, -0.5, 0, 0.25, 25.5, 2573.9, 2574, 2599.5, 2600, 2677.9, 2678, 5278, 5356, 6000]) {
      for (const height of [0.5, 26, 78, 120, 900.5]) {
        const visible = rows.filter(({ y }) => y < top + height && y + 26 > top);
        const start = top + height <= 0 ? 0 : rows.find(({ y }) => y + 26 > top)?.start ?? total;
        const end = visible.at(-1)?.end ?? start;
        assert.deepEqual(layout.visibleIndexRange(top, height, total), { start, end },
          `total ${total}, top ${top}, height ${height}`);
      }
    }
  }
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

// ---- Static content ----

test('the hero shows the exact title and subtitle', async () => {
  const hero = await read('src/components/Hero.astro');
  assert.match(hero, /<h1 class="hero__title">Memorial do Covid<\/h1>/);
  assert.ok(hero.includes(`<p class="hero__subtitle">${SUBTITLE}</p>`));
  const base = await read('src/layouts/Base.astro');
  assert.match(base, /title = 'Memorial do Covid'/);
});

test('every element render.ts needs exists in the page components', async () => {
  const page = (await Promise.all([
    'src/components/Hero.astro', 'src/components/Memorial.astro',
    'src/components/Counter.astro', 'src/components/Fontes.astro',
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
  mockData(context, obitos);
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

test('the page is accessible in pt-BR and carries no analytics', async () => {
  const base = await read('src/layouts/Base.astro');
  const memorial = await read('src/components/Memorial.astro');
  const counter = await read('src/components/Counter.astro');
  const hero = await read('src/components/Hero.astro');
  const css = await read('src/styles/global.css');
  assert.match(base, /<html lang="pt-BR">/);
  assert.match(memorial, /<canvas[^>]*aria-hidden="true"/);
  assert.match(counter, /data-announcer aria-live="polite"/);
  assert.match(hero, /id="load-error" role="alert" hidden/);
  assert.match(counter, /id="btn-share" type="button" disabled/);
  assert.doesNotMatch(counter, /btn-inicio|btn-fim|Ir ao início|Ir ao fim/);
  assert.match(counter, /data-share-status role="status" hidden/);
  assert.match(counter, /<dialog[^>]*aria-labelledby="share-title"/);
  assert.match(hero, /id="btn-start" type="button" disabled/);
  assert.match(counter, /aria-label="Controles de rolagem automática"/);
  assert.match(counter, /id="btn-play"[\s\S]*?aria-pressed="false"[\s\S]*?disabled/);
  assert.match(counter, /id="speed-select" aria-label="Velocidade da rolagem" disabled/);
  assert.match(renderSource, /ANNOUNCE_INTERVAL_MS/);
  assert.match(renderSource, /setAttribute\('tabindex', '0'\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const source of [base, memorial, counter, hero, renderSource]) {
    assert.doesNotMatch(source, /G-6MF2B6H28V|gtag|googletagmanager/);
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
  assert.match(css, /\.memorial__canvas\s*\{[^}]*margin-inline: auto/);
  assert.match(css, /\.declaracao\s*\{[^}]*position: sticky/);
  assert.match(css, /\.declaracao\[hidden\]\s*\{\s*display: none/);
  assert.match(css, /\.declaracao__texto\s*\{[^}]*white-space: pre-line/);
  assert.match(css, /\.declaracao__cabecalho\s*\{[^}]*position: sticky/);
  assert.match(css, /\.declaracao__data,\s*\.ref-declaracao__data\s*\{[^}]*font-size: 1\.35rem/);
  assert.match(css, /\.declaracao__data,\s*\.ref-declaracao__data\s*\{[^}]*font-weight: 700/);
  assert.match(css, /\.ref-declaracao blockquote\s*\{[^}]*white-space: pre-line/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.marco-semana\s*\{[^}]*white-space: nowrap/);
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.marco-semana\s*\{[^}]*width: max-content/);
  assert.match(css, /\.marco-semana\s*\{[^}]*background: var\(--destaque\);[^}]*color: var\(--fundo\);[^}]*font-weight: 700/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(base, /viewport-fit=cover/);
  for (const [name, value] of Object.entries({
    fundo: '#0b0b0c', texto: '#e8e4dc', 'texto-suave': '#a9a39a', destaque: '#c9a227',
  })) assert.ok(css.includes(`--${name}: ${value}`));
});

test('the automatic scroller uses the former 4x as its new 1x base', async () => {
  assert.equal(config.SPEED_BASE, 1920);
  assert.deepEqual(config.SPEED_MULTIPLIERS.map((speed) => config.SPEED_BASE * speed), [1920, 3840, 5760]);
  assert.deepEqual(config.SPEED_MULTIPLIERS, [1, 2, 3]);
  const counter = await read('src/components/Counter.astro');
  const options = [...counter.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)<\/option>/g)]
    .map(([, value, selected, label]) => ({ value: Number(value), selected: Boolean(selected), label }));
  assert.deepEqual(options, [
    { value: 1, selected: true, label: '1×' },
    { value: 2, selected: false, label: '2×' },
    { value: 3, selected: false, label: '3×' },
  ]);
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
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  getBoundingClientRect() { return { top: this.top }; }
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

function fakeCanvas() {
  const canvas = new FakeElement('canvas');
  canvas.calls = [];
  const record = (name) => (...args) => canvas.calls.push([name, ...args]);
  const context = {};
  Object.defineProperty(context, 'fillStyle', { set: record('fillStyle') });
  for (const name of ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'arc', 'fill']) context[name] = record(name);
  canvas.getContext = () => context;
  return canvas;
}

function installPage(context, references = false) {
  const elements = {};
  const selectors = references ? [
    '#load-error', '[data-dyn="inicio"]', '[data-dyn="fim"]', '[data-dyn="acessado-em"]',
    '[data-dyn="total"]', '[data-dyn-link="fonte"]', '[data-fontes-obitos]', '[data-fontes-declaracoes]',
  ] : renderSelectors();
  for (const selector of selectors) {
    elements[selector] = selector === '[data-canvas]' ? fakeCanvas() : new FakeElement();
    elements[selector].textContent = '…';
  }
  elements['#load-error'].hidden = true;
  if (!references) {
    elements['[data-aviso-sintetico]'].hidden = true;
    for (const selector of ['#btn-share', '#btn-start', '#btn-play', '#speed-select']) {
      elements[selector].disabled = true;
    }
    elements['#btn-play'].setAttribute('aria-pressed', 'false');
    elements['#speed-select'].value = '1';
    elements['[data-counter]'].setAttribute('data-idle', '');
  }

  const listeners = {};
  const scrolls = [];
  globalThis.document = {
    querySelector: (selector) => elements[selector] ?? null,
    createElement: (tag) => new FakeElement(tag),
    documentElement: { scrollHeight: 5000 },
    getElementById: (id) => Object.values(elements)
      .flatMap((element) => [element, ...element.descendants()])
      .find((element) => element.id === id),
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
    scrollTo: (options) => scrolls.push(options),
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
  return { $, listeners, scrolls };
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
  window.scrollBy = (_x, amount) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const next = Math.min(max, window.scrollY + amount);
    const step = next - window.scrollY;
    window.scrollY = next;
    page.$('[data-track]').top -= step;
    page.$('[data-canvas]').top = Math.max(0, page.$('[data-track]').top);
    steps.push(step);
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

const arcs = (canvas) => canvas.calls.filter(([name]) => name === 'arc');

function coloredArcs(canvas) {
  const dots = [];
  let color;
  for (const [name, ...args] of canvas.calls) {
    if (name === 'fillStyle') color = args[0];
    if (name === 'arc') dots.push({ color, y: args[1] });
  }
  return dots;
}

test('a successful boot draws visible dots and activates the counter at mid-viewport', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  const { $, listeners, scrolls } = installPage(context);
  // The reference line at 450 px touches the first row of the column.
  $('[data-track]').top = 450;
  $('[data-canvas]').top = 450;

  const { boot } = await freshRender();
  await boot();

  assert.equal($('#load-error').hidden, true);
  assert.equal($('#btn-share').disabled, false);
  assert.equal($('[data-track]').style.height, '26px');
  assert.equal(arcs($('[data-canvas]')).length, 7);
  assert.ok(arcs($('[data-canvas]')).every((call) => call[3] === 12));
  assert.equal($('[data-counter-lives]').textContent, '7');
  assert.equal($('[data-counter-days]').textContent, '4 dias');
  assert.equal($('[data-counter-total]').textContent, '7');
  assert.equal($('[data-announcer]').textContent, '7 vidas em 4 dias, de 7.');

  assert.equal($('[data-counter]').attributes['data-idle'], undefined);
  assert.equal($('[data-reference-line]').style.top, '450px');
  assert.equal($('[data-reference-line]').classList.contains('reference-line--on'), true);

  // Scrolling above the column hides the counter; the announcement waits for the interval.
  $('[data-track]').top = 1000;
  $('[data-canvas]').top = 1000;
  listeners.scroll();
  assert.equal($('[data-counter-lives]').textContent, '0');
  assert.equal($('[data-counter-days]').textContent, '0 dias');
  assert.equal($('[data-counter]').attributes['data-idle'], '');
  assert.equal($('[data-reference-line]').classList.contains('reference-line--on'), false);
  assert.equal($('[data-announcer]').textContent, '7 vidas em 4 dias, de 7.');
  context.mock.timers.tick(config.ANNOUNCE_INTERVAL_MS - 1);
  assert.equal($('[data-announcer]').textContent, '7 vidas em 4 dias, de 7.');
  context.mock.timers.tick(1);
  assert.equal($('[data-announcer]').textContent, '0 vidas, de 7.');

  assert.deepEqual(scrolls, []);
});

test('playback starts on request, updates its button and reads the selected speed every frame', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const obitos = obitosFixture();
  obitos.dias.at(-1).acumulado = 1000;
  mockData(context, obitos);
  const page = installPage(context);
  const { $, listeners } = page;
  $('[data-track]').top = 450;
  const { frame, frames, steps } = installPlaybackFrames(context, page);
  const { boot } = await freshRender();
  await boot();

  for (const selector of ['#btn-start', '#btn-play', '#speed-select']) assert.equal($(selector).disabled, false);
  assert.equal($('#btn-play').attributes['aria-pressed'], 'false');
  assert.equal(frames.size, 0);
  $('#btn-start').listeners.click();
  assert.equal($('#btn-play').attributes['aria-pressed'], 'true');
  assert.equal($('#btn-play').attributes['aria-label'], 'pausar rolagem');
  frame();
  frame();
  assert.equal($('[data-counter-lives]').textContent, '80');
  $('#speed-select').value = '2';
  $('#speed-select').listeners.change();
  frame();
  $('#speed-select').value = '3';
  $('#speed-select').listeners.change();
  frame();
  $('#speed-select').value = '99';
  $('#speed-select').listeners.change();
  frame();
  assert.deepEqual(steps, [192, 192, 384, 576, 576]);
  listeners.wheel();
  assert.equal($('#btn-play').attributes['aria-pressed'], 'false');
  assert.equal($('#btn-play').attributes['aria-label'], 'rolar automaticamente');
  frame();
  assert.equal(steps.length, 5);
});

test('Space on the play button pauses once instead of restarting through its click', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  const page = installPage(context);
  const { $, listeners } = page;
  const { frames } = installPlaybackFrames(context, page);
  const { boot } = await freshRender();
  await boot();
  const play = $('#btn-play');
  play.listeners.click();
  assert.equal(play.attributes['aria-pressed'], 'true');
  play.listeners.keydown({ key: ' ', repeat: false });
  listeners.keydown({ key: ' ' });
  play.listeners.click();
  assert.equal(play.attributes['aria-pressed'], 'false');
  assert.equal(frames.size, 0);
  play.listeners.keydown({ key: ' ', repeat: false });
  listeners.keydown({ key: ' ' });
  play.listeners.click();
  assert.equal(play.attributes['aria-pressed'], 'true');
});

test('touch taps toggle playback without the global pointer handler pre-empting them', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  const page = installPage(context);
  const { $, listeners } = page;
  installPlaybackFrames(context, page);
  const { boot } = await freshRender();
  await boot();
  const play = $('#btn-play');
  for (const expected of ['true', 'false']) {
    play.listeners.pointerdown();
    listeners.pointerdown({ pointerType: 'touch', button: 0, clientX: window.innerWidth - 1 });
    play.listeners.click();
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

test('sharing pauses playback and provides the memorial or the card-specific URL', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context, obitosFixture(), sourcedFixture());
  const shared = [];
  mockNavigator(context, { share: async (link) => { shared.push(link); } });
  const page = installPage(context);
  const { $ } = page;
  const { frames } = installPlaybackFrames(context, page);
  const { boot } = await freshRender();
  await boot();
  $('#btn-start').listeners.click();
  $('#btn-share').listeners.click();
  await new Promise(setImmediate);
  assert.equal($('#btn-play').attributes['aria-pressed'], 'false');
  assert.equal(frames.size, 0);
  assert.equal(shared[0].url, 'https://memorial.test/');

  const [card] = $('[data-marks]').children;
  const button = [...card.descendants()].find((node) => node.tagName === 'button');
  assert.equal(button.textContent, 'Compartilhar');
  assert.equal(card.id, 'declaracao-real-1');
  button.listeners.click();
  await new Promise(setImmediate);
  assert.deepEqual(shared[1], {
    title: 'Resumo editorial de teste',
    text: 'Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra lembra? Resumo editorial de teste',
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
  assert.match(copied, /Você se lembra lembra\? Memorial do Covid\nhttps:\/\/memorial.test\/$/);
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
  const [card] = $('[data-marks]').children;
  [...card.descendants()].find((node) => node.tagName === 'button').listeners.click();
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
  obitos.dias.forEach((dia, index) => { dia.acumulado = [990, 1000, 1000, 1010][index]; });
  mockData(context, obitos);
  const { $, listeners, scrolls } = installPage(context);
  const absoluteTop = 1000;
  $('[data-track]').top = absoluteTop;
  window.scrollTo = (options) => {
    scrolls.push(options);
    window.scrollY = options.top;
    $('[data-track]').top = absoluteTop - options.top;
    $('[data-canvas]').top = Math.max(0, $('[data-track]').top);
  };
  window.location.hash = '#declaracao-teste-2';
  const { boot } = await freshRender();
  await boot();
  assert.deepEqual(scrolls, [{ top: 3240, behavior: 'instant' }]);
  assert.equal($('[data-counter-lives]').textContent, '1.010');
  assert.deepEqual($('[data-marks]').children.map((card) => card.hidden), [true, false]);
  window.location.hash = '#declaracao-teste-1';
  listeners.hashchange();
  assert.equal(scrolls.at(-1).top, 562);
  assert.equal($('[data-counter-lives]').textContent, '10');
  assert.deepEqual($('[data-marks]').children.map((card) => card.hidden), [false, true]);
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
  assert.deepEqual(scrolls, [{ top: 3240, behavior: 'instant' }]);
});

test('viewport adjustments and resize events do not stop automatic playback', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  const page = installPage(context);
  const { $, listeners } = page;
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
  assert.equal($('[data-canvas]').style.height, '520px');
  assert.equal($('[data-reference-line]').style.top, '290px');
});

test('white and light gray rows keep their colors through partial and backwards scrolling', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const obitos = obitosFixture();
  obitos.dias.at(-1).acumulado = 26;
  mockData(context, obitos);
  const { $, listeners } = installPage(context);
  window.innerHeight = 78;
  const { boot } = await freshRender();
  await boot();
  const canvas = $('[data-canvas]');

  for (const [top, rows] of [
    [0, [[12, '#e8e4dc', 10], [38, '#cbc7bf', 10], [64, '#e8e4dc', 6]]],
    [-26, [[12, '#cbc7bf', 10], [38, '#e8e4dc', 6]]],
    [-26.5, [[11.5, '#cbc7bf', 10], [37.5, '#e8e4dc', 6]]],
    [0, [[12, '#e8e4dc', 10], [38, '#cbc7bf', 10], [64, '#e8e4dc', 6]]],
  ]) {
    canvas.calls = [];
    $('[data-track]').top = top;
    listeners.scroll();
    const dots = coloredArcs(canvas);
    assert.equal(dots.length, rows.reduce((total, [, , count]) => total + count, 0));
    for (const [y, color, count] of rows) {
      assert.deepEqual(dots.filter((dot) => dot.y === y).map((dot) => dot.color), Array(count).fill(color));
    }
    assert.ok(arcs(canvas).every((call) => call[3] === 12));
  }
});

test('separator labels, counter dates and cards respect the empty three-row space', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const obitos = obitosFixture();
  obitos.dias.forEach((dia, index) => { dia.acumulado = [990, 1000, 1990, 2010][index]; });
  const statements = syntheticFixture();
  statements.declaracoes[1].data = '2020-03-19';
  mockData(context, obitos, statements);
  const { $, listeners } = installPage(context);
  const { boot } = await freshRender();
  await boot();
  const labels = $('[data-separators]').children;
  assert.deepEqual(labels.map((label) => label.attributes['data-lives']), ['1000', '2000']);
  assert.deepEqual(labels.map((label) => label.style.top), ['2600px', '5278px']);
  assert.deepEqual(labels.map((label) => label.text), ['1.000vidas', '2.000vidas']);
  assert.ok(labels.every((label) => label.children[0].tagName === 'strong'));
  assert.equal($('[data-track]').style.height, '5382px');

  for (const [depth, lives, days, activeCards] of [
    [2574, '1.000', '2 dias', [false, true]],
    [2600, '1.000', '2 dias', [false, true]],
    [2639, '1.000', '2 dias', [false, true]],
    [2677.9, '1.000', '2 dias', [false, true]],
    [2678, '1.010', '3 dias', [true, false]],
    [5278, '2.000', '4 dias', [true, false]],
    [5356, '2.010', '4 dias', [true, false]],
    [2639, '1.000', '2 dias', [false, true]],
  ]) {
    $('[data-track]').top = 450 - depth;
    listeners.scroll();
    assert.equal($('[data-counter-lives]').textContent, lives);
    assert.equal($('[data-counter-days]').textContent, days);
    assert.deepEqual($('[data-marks]').children.map((card) => card.hidden), activeCards);
  }
});

test('the canvas leaves separators blank and preserves the colors of surrounding rows', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const obitos = obitosFixture();
  obitos.dias.at(-1).acumulado = 1010;
  mockData(context, obitos);
  const { $, listeners } = installPage(context);
  window.innerHeight = 78;
  const { boot } = await freshRender();
  await boot();
  const canvas = $('[data-canvas]');
  for (const [offset, rows] of [
    [2574, [[12, '#cbc7bf', 10]]],
    [2600, []],
    [2600.1, [[89.9, '#e8e4dc', 10]]],
    [2678, [[12, '#e8e4dc', 10]]],
    [2600, []],
    [2574, [[12, '#cbc7bf', 10]]],
  ]) {
    canvas.calls = [];
    $('[data-track]').top = -offset;
    listeners.scroll();
    const dots = coloredArcs(canvas);
    assert.equal(dots.length, rows.reduce((total, [, , count]) => total + count, 0));
    for (const [y, color, count] of rows) {
      assert.equal(dots.filter((dot) => Math.abs(dot.y - y) < 0.001 && dot.color === color).length, count);
    }
  }
});

test('cards fit above the mobile share bar at the first and last anchors', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.at(-1).acumulado = 2001;
  mockData(context, obitos);
  const { $, listeners } = installPage(context);
  window.innerWidth = 320;
  window.innerHeight = 740;
  $('[data-counter]').top = 612;
  $('[data-track]').top = 358;
  $('[data-marks]').top = 358 - window.innerHeight / 2;
  const { boot } = await freshRender();
  await boot();
  const cards = $('[data-marks]').children;
  assert.equal(cards.find((card) => !card.hidden).style['--card-space'], '524px');
  assert.match(await read('src/styles/global.css'), /\.memorial__marks\s*\{[^}]*top: -50svh/);
  const height = parseInt($('[data-track]').style.height);
  $('[data-track]').top = 371 - height;
  listeners.scroll();
  assert.equal(cards.find((card) => !card.hidden).style['--card-space'], '283px');
});

test('the memorial renders weekly dates starting on March 30', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.push(
    { data: '2020-03-23', acumulado: 15 },
    { data: '2020-03-30', acumulado: 100 },
    { data: '2020-04-06', acumulado: 150 },
    { data: '2020-04-13', acumulado: 250 },
  );
  mockData(context, obitos);
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

test('synthetic statements are labeled and never become source links', async (context) => {
  mockData(context);
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();

  assert.equal($('[data-aviso-sintetico]').hidden, false);
  const cards = $('[data-marks]').children.filter((node) => node.tagName === 'article');
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.equal(card.attributes.tabindex, '0');
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
  assert.doesNotMatch(card.text, /Contexto de teste/);
  const [header] = card.children;
  assert.equal(header.tagName, 'header');
  assert.equal(header.children[0].tagName, 'time');
  assert.equal(header.children[0].dateTime, '2020-03-18');
  assert.equal(header.children[0].textContent, '18/03/2020');
  assert.equal(header.children[1].tagName, 'h3');
  assert.equal(header.children[1].textContent, 'Resumo editorial de teste');
  assert.equal(card.children.find((node) => node.tagName === 'blockquote').textContent, 'Texto de teste com fonte.');
  assert.equal(card.style.top, undefined);
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
  assert.deepEqual(cards.map((card) => card.hidden), [false, true]);
  for (const [index, card] of cards.entries()) {
    const [header] = card.children;
    assert.equal(header.children[1].textContent, `Resumo ${index + 1}`);
    assert.equal(header.children[2].textContent, `Autor ${index + 1}`);
    assert.equal(card.children.find((node) => node.tagName === 'blockquote').textContent, `Citação ${index + 1}`);
    assert.equal([...card.descendants()].find((node) => node.tagName === 'a').href, `/referencias#declaracao-autor-${index + 1}`);
    assert.doesNotMatch(card.text, /Contexto/);
  }
  $('[data-track]').top = 398;
  listeners.scroll();
  assert.deepEqual(cards.map((card) => card.hidden), [true, false]);
  $('[data-track]').top = 450;
  listeners.scroll();
  assert.deepEqual(cards.map((card) => card.hidden), [false, true]);

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
  assert.match(card.children[0].text, /marco histórico/);
  const refs = installPage(context, true);
  await bootReferencias();
  const [reference] = refs.$('[data-fontes-declaracoes]').children;
  assert.equal(reference.attributes['data-tipo'], 'noticia');
  assert.equal(reference.children[3].tagName, 'p');
  assert.equal(reference.children[3].textContent, entries.declaracoes[0].texto);
  assert.match(reference.text, /não uma citação literal/);
});

test('all markers sharing a dot row remain individually reachable and shareable', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const entries = sourcedFixture();
  const first = entries.declaracoes[0];
  entries.declaracoes = [
    { ...first, id: 'first', data: '2020-03-17' },
    { ...first, id: 'second', tipo: 'noticia', data: '2020-03-18' },
    { ...first, id: 'third', tipo: 'noticia', data: '2020-03-18' },
    { ...first, id: 'later', tipo: 'noticia', data: '2020-03-20' },
  ];
  const deaths = obitosFixture();
  deaths.dias.forEach((dia, index) => { dia.acumulado = [1, 7, 10, 20][index]; });
  mockData(context, deaths, entries);
  const shared = [];
  mockNavigator(context, { share: async (link) => { shared.push(link); } });
  const { $, listeners } = installPage(context);
  $('[data-track]').top = 450;
  const { boot } = await freshRender();
  await boot();
  const cards = $('[data-marks]').children;
  const visible = () => cards.filter((card) => !card.hidden).map((card) => card.id);
  const nav = (card, text) => [...card.descendants()].find((node) => node.tagName === 'button' && node.textContent === text);
  assert.deepEqual(visible(), ['declaracao-third']);
  nav(cards[2], 'Anterior').listeners.click();
  assert.deepEqual(visible(), ['declaracao-second']);
  assert.equal(cards[1].focused, true);
  nav(cards[1], 'Anterior').listeners.click();
  assert.deepEqual(visible(), ['declaracao-first']);
  assert.equal(nav(cards[0], 'Anterior').disabled, true);
  nav(cards[0], 'Próximo').listeners.click();
  assert.deepEqual(visible(), ['declaracao-second']);
  [...cards[1].descendants()].find((node) => node.textContent === 'Compartilhar').listeners.click();
  await new Promise(setImmediate);
  assert.equal(shared[0].url, 'https://memorial.test/marcos/second/#declaracao-second');
  window.location.hash = '#declaracao-first';
  listeners.hashchange();
  assert.deepEqual(visible(), ['declaracao-first']);
  assert.equal($('#btn-play').attributes['aria-pressed'], 'false');
  $('[data-track]').top = 424;
  listeners.scroll();
  assert.deepEqual(visible(), ['declaracao-later']);
  $('[data-track]').top = 450;
  listeners.scroll();
  assert.deepEqual(visible(), ['declaracao-third'], 'leaving the group releases the pinned selection');
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

test('only the latest reached statement floats, including when scrolling backwards', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.forEach((dia, index) => { dia.acumulado = [10, 20, 20, 30][index]; });
  const statements = syntheticFixture();
  statements.declaracoes.reverse();
  mockData(context, obitos, statements);
  const { $, listeners } = installPage(context);
  $('[data-track]').top = 450;
  const { boot } = await freshRender();
  await boot();

  const cards = $('[data-marks]').children;
  assert.match(cards[0].text, /Exemplo sintético 1/);
  assert.deepEqual(cards.map((card) => card.hidden), [false, true]);
  $('[data-track]').top = 398;
  listeners.scroll();
  assert.deepEqual(cards.map((card) => card.hidden), [true, false]);
  $('[data-track]').top = 424;
  listeners.scroll();
  assert.deepEqual(cards.map((card) => card.hidden), [false, true]);
  $('[data-track]').top = 1000;
  listeners.scroll();
  assert.ok(cards.every((card) => card.hidden));
});

test('mobile viewport resizing keeps the canvas and counter on the visible midpoint', async (context) => {
  const obitos = obitosFixture();
  obitos.dias.forEach((dia, index) => { dia.acumulado = [10, 20, 20, 300][index]; });
  mockData(context, obitos);
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

  assert.equal($('[data-canvas]').style.height, '600px');
  assert.equal($('[data-canvas]').height, 1200);
  assert.equal($('[data-canvas]').style.width, '258px');
  assert.ok(arcs($('[data-canvas]')).every((call) => call[3] === 12));
  assert.equal($('[data-canvas]').style.top, '20px');
  assert.equal($('[data-reference-line]').style.top, '320px');
  assert.equal($('[data-counter]').style['--linha-y'], '320px');
  assert.equal($('[data-counter-lives]').textContent, '20');
  assert.equal($('[data-counter]').attributes['data-idle'], undefined);

  window.visualViewport.height = 500;
  window.visualViewport.offsetTop = 30;
  viewportListeners.resize();
  assert.equal($('[data-canvas]').style.height, '500px');
  assert.equal($('[data-reference-line]').style.top, '280px');
  assert.equal($('[data-counter-lives]').textContent, '0');
  assert.equal($('[data-counter]').attributes['data-idle'], '');

  window.visualViewport.offsetTop = 70;
  viewportListeners.scroll();
  assert.equal($('[data-reference-line]').style.top, '320px');
  assert.equal($('[data-counter-lives]').textContent, '20');
  assert.deepEqual(scrolls, []);
});

test('references load coverage and sources without a canvas or counter', async (context) => {
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
      for (const selector of ['#btn-share', '#btn-start', '#btn-play', '#speed-select']) {
        assert.equal($(selector).disabled, true, selector);
      }
      assert.equal(listeners.wheel, undefined);
      assert.equal($('[data-canvas]').calls.length, 0);
      assert.equal($('[data-track]').style.height, undefined);
      assert.deepEqual($('[data-marks]').children, []);
      for (const selector of ['[data-counter-lives]', '[data-counter-total]']) {
        assert.equal($(selector).textContent, '…', selector);
      }
      assert.equal($('[data-announcer]').textContent, '…');
      assert.equal(listeners.scroll, undefined);
    });
  }
});
