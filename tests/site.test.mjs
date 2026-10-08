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
const renderSource = (await read('src/lib/render.ts'))
  .replaceAll("'../config'", JSON.stringify(configUrl))
  .replaceAll("'./layout'", JSON.stringify(layoutUrl))
  .replaceAll("'./state'", JSON.stringify(stateUrl));

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
    texto: 'Texto de teste com fonte.',
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

test('each dot sits on an 8 px pitch, ten per row', () => {
  assert.equal(config.DOT_RADIUS_PX, 3);
  assert.equal(config.DOTS_PER_ROW, 10);
  assert.equal(layout.rowPitch(), 8);
  assert.equal(layout.columnWidth(), 78);
  assert.deepEqual(layout.dotPosition(0), { row: 0, col: 0, x: 0, y: 0 });
  assert.deepEqual(layout.dotPosition(9), { row: 0, col: 9, x: 72, y: 0 });
  assert.deepEqual(layout.dotPosition(10), { row: 1, col: 0, x: 0, y: 8 });
  assert.deepEqual(layout.dotPosition(716_625), { row: 71_662, col: 5, x: 40, y: 573_296 });
});

test('scroll depth counts whole rows and clamps at both ends', () => {
  assert.equal(layout.livesAtDepth(-1, 25), 0);
  assert.equal(layout.livesAtDepth(0, 25), 10);
  assert.equal(layout.livesAtDepth(7, 25), 10);
  assert.equal(layout.livesAtDepth(8, 25), 20);
  assert.equal(layout.livesAtDepth(16, 25), 25);
  assert.equal(layout.livesAtDepth(1e9, 25), 25);
  assert.equal(layout.livesAtDepth(0, 7), 7);
});

test('visible ranges stay bounded by the viewport, not the national total', () => {
  const total = 716_626;
  assert.deepEqual(layout.visibleIndexRange(0, 800, total), { start: 0, end: 1000 });
  assert.deepEqual(layout.visibleIndexRange(-100, 200, total), { start: 0, end: 130 });
  assert.deepEqual(layout.visibleIndexRange(-500, 200, total), { start: 0, end: 0 });
  assert.deepEqual(layout.visibleIndexRange(layout.columnHeight(25) - 8, 800, 25), { start: 20, end: 25 });
  assert.deepEqual(layout.visibleIndexRange(1e9, 800, 25), { start: 25, end: 25 });
  assert.deepEqual(layout.visibleIndexRange(0.5, 8, 25), { start: 0, end: 20 });
  assert.deepEqual(layout.visibleIndexRange(0, 8, 25), { start: 0, end: 10 });
  assert.deepEqual(layout.visibleIndexRange(0.25, 7.75, 25), { start: 0, end: 10 });
  assert.deepEqual(layout.visibleIndexRange(7.5, 0.6, 25), { start: 0, end: 20 });
  assert.deepEqual(layout.visibleIndexRange(-0.5, 8.4, 25), { start: 0, end: 10 });
  const bound = (Math.ceil(900.5 / layout.rowPitch()) + 1) * config.DOTS_PER_ROW;
  for (const top of [0, 3, 4_001, 287_777.4, layout.columnHeight(total) - 900.5]) {
    const { start, end } = layout.visibleIndexRange(top, 900.5, total);
    assert.ok(end - start <= bound, `range at ${top} has ${end - start} dots`);
    assert.ok(start >= 0 && end <= total);
  }
});

test('column height stays within the 16,000,000 px browser limit', () => {
  assert.equal(config.MAX_COLUMN_HEIGHT_PX, 16_000_000);
  assert.equal(layout.columnHeight(25), 24);
  assert.equal(layout.columnHeight(716_626), 573_304);
  assert.equal(layout.columnHeight(20_000_000), 16_000_000);
  assert.throws(() => layout.columnHeight(20_000_001), /excede o limite/);
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
  assert.equal(layout.anchorY(21, 21), 16);
  assert.deepEqual(layout.monthMarkers(dias), [
    { data: '2020-03-30', index: 0, y: 0 },
    { data: '2020-04-02', index: 12, y: 8 },
    { data: '2020-06-02', index: 15, y: 8 },
  ]);
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

  const placeholderAsReal = sourcedFixture();
  placeholderAsReal.declaracoes[0].fontes[0].url = 'https://example.invalid/declaracao-1';
  mockData(context, obitosFixture(), placeholderAsReal);
  await assert.rejects(loadPageData('/'), /declaracoes\.json inválido: fonte de exemplo/);
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
  assert.equal(index.match(/boot\(\)/g)?.length, 1);
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
  for (const id of ['btn-inicio', 'btn-fim']) {
    assert.match(counter, new RegExp(`<button[^>]*id="${id}" type="button" disabled>`));
  }
  assert.match(renderSource, /ANNOUNCE_INTERVAL_MS/);
  assert.match(renderSource, /setAttribute\('tabindex', '0'\)/);
  assert.match(renderSource, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const source of [base, memorial, counter, hero, renderSource]) {
    assert.doesNotMatch(source, /G-6MF2B6H28V|gtag|googletagmanager/);
  }
});

test('the notification-date basis and backward adjustment are explained on the page', async () => {
  const memorial = await read('src/components/Memorial.astro');
  const note = memorial.match(/<div class="nota-dados">([\s\S]*?)<\/div>/)?.[1] ?? '';
  assert.doesNotMatch(memorial, /class="nota-dados"[^>]*hidden/);
  assert.match(note, /<strong>data de notificação<\/strong>/);
  assert.match(note, /não a\s+data em que cada pessoa morreu/);
  assert.match(note, /menor valor entre ele e os acumulados seguintes/);
  assert.match(note, /preserva o total oficial mais recente/);
  for (const key of ['inicio', 'fim', 'total', 'acessado-em']) assert.match(note, new RegExp(`data-dyn="${key}">…<`));
  assert.match(memorial, /Declarações sintéticas de exemplo/);
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
    this.style = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = {};
    this.top = 0;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
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
  for (const name of ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'arc', 'fill']) context[name] = record(name);
  canvas.getContext = () => context;
  return canvas;
}

function installPage(context) {
  const elements = {};
  for (const selector of renderSelectors()) {
    elements[selector] = selector === '[data-canvas]' ? fakeCanvas() : new FakeElement();
    elements[selector].textContent = '…';
  }
  elements['#load-error'].hidden = true;
  elements['[data-aviso-sintetico]'].hidden = true;
  elements['#btn-inicio'].disabled = true;
  elements['#btn-fim'].disabled = true;

  const listeners = {};
  const scrolls = [];
  globalThis.document = {
    querySelector: (selector) => elements[selector] ?? null,
    createElement: (tag) => new FakeElement(tag),
  };
  globalThis.window = {
    innerHeight: 900,
    scrollY: 0,
    devicePixelRatio: 2,
    addEventListener: (type, listener) => { listeners[type] = listener; },
    matchMedia: () => ({ matches: true }),
    scrollTo: (options) => scrolls.push(options),
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  context.after(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
  });
  context.mock.method(console, 'error', () => {});
  const $ = (selector) => elements[selector];
  return { $, listeners, scrolls };
}

const arcs = (canvas) => canvas.calls.filter(([name]) => name === 'arc');

test('a successful boot draws the visible dots and fills the counter and disclosure', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mockData(context);
  const { $, listeners, scrolls } = installPage(context);
  // The reference line (900 / 3 = 300 px) touches the first row of the column.
  $('[data-track]').top = 300;
  $('[data-canvas]').top = 300;

  const { boot } = await freshRender();
  await boot();

  assert.equal($('#load-error').hidden, true);
  assert.equal($('#btn-inicio').disabled, false);
  assert.equal($('#btn-fim').disabled, false);
  assert.equal($('[data-track]').style.height, '8px');
  assert.equal(arcs($('[data-canvas]')).length, 7);
  assert.equal($('[data-counter-lives]').textContent, '7');
  assert.equal($('[data-counter-date]').textContent, '20/03/2020');
  assert.equal($('[data-counter-total]').textContent, '7');
  assert.equal($('[data-announcer]').textContent, '7 vidas até 20/03/2020, de 7.');

  assert.equal($('[data-dyn="inicio"]').textContent, '17/03/2020');
  assert.equal($('[data-dyn="inicio"]').dateTime, '2020-03-17');
  assert.equal($('[data-dyn="fim"]').textContent, '20/03/2020');
  assert.equal($('[data-dyn="acessado-em"]').textContent, '02/01/2026');
  assert.equal($('[data-dyn="total"]').textContent, '7');
  assert.equal($('[data-dyn-link="fonte"]').href, 'https://fonte.test/painel');

  // Scrolling above the column empties the counter; the announcement waits for the interval.
  $('[data-track]').top = 1000;
  $('[data-canvas]').top = 1000;
  listeners.scroll();
  assert.equal($('[data-counter-lives]').textContent, '0');
  assert.equal($('[data-counter-date]').textContent, '—');
  assert.equal($('[data-announcer]').textContent, '7 vidas até 20/03/2020, de 7.');
  context.mock.timers.tick(config.ANNOUNCE_INTERVAL_MS - 1);
  assert.equal($('[data-announcer]').textContent, '7 vidas até 20/03/2020, de 7.');
  context.mock.timers.tick(1);
  assert.equal($('[data-announcer]').textContent, '0 vidas, de 7.');

  $('#btn-fim').listeners.click();
  assert.deepEqual(scrolls, [{ top: 1000 + 7 - 300, behavior: 'auto' }]);
});

test('synthetic statements are labeled and never become source links', async (context) => {
  mockData(context);
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();

  assert.equal($('[data-aviso-sintetico]').hidden, false);
  assert.equal($('[data-aviso-texto]').textContent, 'Aviso de teste.');
  const cards = $('[data-marks]').children.filter((node) => node.tagName === 'article');
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.equal(card.attributes.tabindex, '0');
    assert.equal(card.children[0].textContent, 'exemplo sintético');
    assert.match(card.text, /\[Exemplo sintético \d\]/);
  }
  const page = Object.values({
    marks: $('[data-marks]'), official: $('[data-fontes-obitos]'), statements: $('[data-fontes-declaracoes]'),
  });
  const links = page.flatMap((node) => [...node.descendants()]).filter((node) => node.tagName === 'a');
  assert.deepEqual(links.map((link) => link.href), ['https://fonte.test/painel']);
  assert.match($('[data-fontes-declaracoes]').text, /exemplos sintéticos, sem fonte real/);
  assert.match($('[data-fontes-declaracoes]').text, /Datas de acesso fictícias: 02\/01\/2026/);
});

test('sourced statements show their source links without the synthetic label', async (context) => {
  mockData(context, obitosFixture(), sourcedFixture());
  const { $ } = installPage(context);
  const { boot } = await freshRender();
  await boot();

  assert.equal($('[data-aviso-sintetico]').hidden, true);
  const [card] = $('[data-marks]').children.filter((node) => node.tagName === 'article');
  assert.doesNotMatch(card.text, /exemplo sintético/);
  assert.equal(card.style.top, '0px');
  const links = [...card.descendants()].filter((node) => node.tagName === 'a');
  assert.deepEqual(links.map((link) => link.href), ['https://fonte.test/declaracao-1']);
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
      assert.equal($('#btn-inicio').disabled, true);
      assert.equal($('#btn-fim').disabled, true);
      assert.equal($('[data-canvas]').calls.length, 0);
      assert.equal($('[data-track]').style.height, undefined);
      assert.deepEqual($('[data-marks]').children, []);
      for (const selector of ['[data-counter-lives]', '[data-counter-total]', '[data-dyn="total"]', '[data-dyn="inicio"]']) {
        assert.equal($(selector).textContent, '…', selector);
      }
      assert.equal($('[data-announcer]').textContent, '…');
      assert.equal(listeners.scroll, undefined);
    });
  }
});
