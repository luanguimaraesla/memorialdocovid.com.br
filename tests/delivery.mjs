// Mandatory delivery gate for the shipped datasets. It lives outside the
// tests/*.test.mjs glob so the offline suite never depends on downloaded data.
// Run it with: node --test tests/delivery.mjs
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
const { MAX_COLUMN_HEIGHT_PX } = await import(configUrl);
const { columnHeight } = await import(moduleUrl(
  (await read('src/lib/layout.ts')).replaceAll("'../config'", JSON.stringify(configUrl)),
));
const { loadPageData, SYNTHETIC_PREFIX } = await import(moduleUrl(
  (await read('src/lib/state.ts')).replaceAll('import.meta.env.BASE_URL', "'/'"),
));

// Checked against the raw HIST_PAINEL_COVIDBR_05set2025.zip national rows
// (regiao "Brasil"), independently of the converter.
const RELEASE = 'HIST_PAINEL_COVIDBR_05set2025.zip';
const FIRST_POSITIVE_DATE = '2020-03-17';
const LATEST_DATE = '2025-09-05';
const FINAL_TOTAL = 716_626;
const DAYS_IN_COVERAGE = 1999;

const obitosBytes = await readFile(new URL('public/data/obitos.json', root));
const declaracoesBytes = await readFile(new URL('public/data/declaracoes.json', root));
const obitos = JSON.parse(obitosBytes);
const declaracoes = JSON.parse(declaracoesBytes);

function serveShippedFiles(context) {
  context.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/data/obitos.json') return new Response(obitosBytes);
    if (url === '/data/declaracoes.json') return new Response(declaracoesBytes);
    throw new Error(`Unexpected data request: ${url}`);
  });
}

test('the shipped files pass the production validator with the official coverage and total', async (context) => {
  serveShippedFiles(context);
  const data = await loadPageData('/');
  assert.equal(data.inicio, FIRST_POSITIVE_DATE);
  assert.equal(data.fim, LATEST_DATE);
  assert.equal(data.total, FINAL_TOTAL);
  assert.equal(data.obitos.dias.length, DAYS_IN_COVERAGE);
});

test('death counts come from the Ministério da Saúde Painel Coronavírus release', () => {
  assert.equal(obitos.criterio, 'data de notificação');
  assert.equal(obitos.sintetico, undefined);
  assert.match(obitos.acessado_em, /^\d{4}-\d{2}-\d{2}$/);
  const urls = obitos.fontes.map((fonte) => new URL(fonte.url));
  assert.ok(urls.some((url) => url.hostname === 'covid.saude.gov.br'));
  const release = obitos.fontes.find((fonte) => fonte.url.endsWith(RELEASE));
  assert.ok(release, `missing ${RELEASE} source`);
  assert.equal(new URL(release.url).hostname, 'mobileapps-prd.saude.gov.br');
  assert.match(release.nome, /Ministério da Saúde/);
});

test('the shipped column fits within the browser height limit at the fixed dot size', () => {
  const height = columnHeight(FINAL_TOTAL);
  assert.equal(height, 573_304);
  assert.ok(height <= MAX_COLUMN_HEIGHT_PX);
});

test('the shipped statements are clearly labeled synthetic placeholders', () => {
  assert.equal(declaracoes.sintetico, true);
  assert.equal(declaracoes.aviso, 'Declarações fictícias de exemplo; serão substituídas por citações verificadas.');
  assert.ok(declaracoes.declaracoes.length >= 4 && declaracoes.declaracoes.length <= 6);
  for (const declaracao of declaracoes.declaracoes) {
    assert.ok(declaracao.texto.startsWith(SYNTHETIC_PREFIX), declaracao.id);
    assert.ok(declaracao.data >= FIRST_POSITIVE_DATE && declaracao.data <= LATEST_DATE, declaracao.id);
    for (const fonte of declaracao.fontes) {
      assert.equal(fonte.nome, 'Exemplo sintético, sem fonte real');
      assert.equal(new URL(fonte.url).hostname, 'example.invalid');
    }
  }
});
