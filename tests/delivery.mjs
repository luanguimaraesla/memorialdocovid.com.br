// Mandatory delivery gate for the shipped datasets. It lives outside the
// tests/*.test.mjs glob so the offline suite never depends on downloaded data.
// Run it with: node --test tests/delivery.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const { columnHeight, dayIndexOf, lastIndexOfDay, thousandMarkers, dotPosition, livesAtDepth } = await import(moduleUrl(
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
const quotations = declaracoes.declaracoes.filter(({ tipo }) => tipo !== 'noticia');

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
  assert.equal(height, 1_919_086);
  assert.ok(height <= MAX_COLUMN_HEIGHT_PX);
});

test('the shipped series has 716 three-row separators without adding or losing a life', () => {
  const markers = thousandMarkers(FINAL_TOTAL);
  assert.equal(markers.length, 716);
  assert.deepEqual(markers.at(-1), { lives: 716_000, y: 1_917_370 });
  for (const { lives, y } of markers) {
    assert.equal(y - dotPosition(lives - 1).y, 26);
    assert.equal(dotPosition(lives).y - y, 78);
    assert.equal(livesAtDepth(y, FINAL_TOTAL), lives);
    assert.equal(livesAtDepth(y + 77.9, FINAL_TOTAL), lives);
    assert.equal(livesAtDepth(y + 78, FINAL_TOTAL), lives + 10);
  }
  assert.deepEqual(dotPosition(FINAL_TOTAL - 1), { row: 71_662, col: 5, x: 130, y: 1_919_060 });
  assert.equal(livesAtDepth(1_919_060, FINAL_TOTAL), FINAL_TOTAL);
});

// Dates and excerpts were checked in the linked reporting, not inferred from the JSON.
const VERIFIED_STATEMENTS = [
  ['2020-03-24', 'Jair Bolsonaro', 'gripezinha'],
  ['2020-04-28', 'Jair Bolsonaro', 'E daí?'],
  ['2020-05-05', 'Valdemiro Santiago', 'Quanto mais se planta, mais se colhe'],
  ['2020-10-21', 'Jair Bolsonaro', 'não compraremos vacina chinesa'],
  ['2020-10-22', 'Eduardo Pazuello', 'um manda e o outro obedece'],
  ['2020-11-10', 'Jair Bolsonaro', 'maricas'],
  ['2020-12-17', 'Jair Bolsonaro', 'jacaré'],
  ['2021-03-04', 'Jair Bolsonaro', 'mimimi'],
  ['2021-03-10', 'Eduardo Bolsonaro', 'Enfia no rabo, gente, porra!'],
  ['2021-05-04', 'Jorginho Mello', 'resultado foi extraordinariamente positivo'],
  ['2021-06-10', 'Jair Bolsonaro', 'uso de máscara'],
  ['2021-06-18', 'Flávio Bolsonaro', 'Nesse momento, Flávio, não tome'],
  ['2021-12-07', 'Marcelo Queiroga', 'melhor perder a vida do que perder a liberdade'],
  ['2022-02-01', 'Magno Malta', 'a vacina da criança já vem no peito da mãe'],
];

test('the shipped statements have verified dates, attribution, context and real sources', () => {
  assert.equal(declaracoes.sintetico, false);
  assert.equal(declaracoes.aviso, undefined);
  assert.deepEqual(quotations.map((declaracao) => declaracao.data), VERIFIED_STATEMENTS.map(([date]) => date));
  for (const [index, declaracao] of quotations.entries()) {
    assert.equal(declaracao.autor, VERIFIED_STATEMENTS[index][1]);
    assert.ok(declaracao.texto.includes(VERIFIED_STATEMENTS[index][2]), declaracao.id);
    assert.ok(!declaracao.texto.startsWith(SYNTHETIC_PREFIX), declaracao.id);
    assert.ok(declaracao.contexto.trim().length > 0, declaracao.id);
    assert.ok(declaracao.subtitulo.trim().length > 0, declaracao.id);
    assert.notEqual(declaracao.subtitulo, declaracao.texto, declaracao.id);
    assert.ok(declaracao.data >= FIRST_POSITIVE_DATE && declaracao.data <= LATEST_DATE, declaracao.id);
    assert.equal(declaracao.acessado_em, '2026-10-09');
    assert.ok(declaracao.fontes.length > 0);
    for (const fonte of declaracao.fontes) {
      const url = new URL(fonte.url);
      assert.equal(url.protocol, 'https:');
      assert.ok(!url.hostname.endsWith('.invalid'));
      assert.doesNotMatch(fonte.nome, /exemplo sintético/i);
    }
  }
});

const VERIFIED_NEWS = [
  ['primeiro-obito-divulgado-2020-03-17', '2020-03-17'],
  ['transmissao-comunitaria-2020-03-20', '2020-03-20'],
  ['sepultamentos-manaus-2020-04-21', '2020-04-21'],
  ['dados-retirados-2020-06-06', '2020-06-06'],
  ['stf-restaura-dados-2020-06-08', '2020-06-08'],
  ['coronavac-fase-tres-2020-07-21', '2020-07-21'],
  ['pfizer-primeira-oferta-2020-08-14', '2020-08-14'],
  ['gamma-2021-01-11', '2021-01-11'],
  ['oxigenio-manaus-2021-01-14', '2021-01-14'],
  ['brasil-primeira-dose-2021-01-17', '2021-01-17'],
  ['campanha-nacional-2021-01-18', '2021-01-18'],
  ['colapso-utis-2021-03-16', '2021-03-16'],
  ['pfizer-primeiro-contrato-2021-03-19', '2021-03-19'],
  ['recorde-notificacoes-2021-04-08', '2021-04-08'],
  ['pfizer-primeiro-lote-2021-04-29', '2021-04-29'],
  ['pfizer-cpi-2021-05-13', '2021-05-13'],
  ['meio-milhao-2021-06-19', '2021-06-19'],
  ['orfandade-estudo-2021-07-20', '2021-07-20'],
  ['cpi-relatorio-2021-10-26', '2021-10-26'],
  ['anvisa-pfizer-infantil-2021-12-16', '2021-12-16'],
  ['vacinacao-infantil-2022-01-14', '2022-01-14'],
  ['fim-emergencia-nacional-2022-04-22', '2022-04-22'],
  ['reforco-bivalente-2023-02-27', '2023-02-27'],
  ['oms-fim-emergencia-2023-05-05', '2023-05-05'],
];

test('the fourteen original quotation records remain intact', () => {
  const originals = quotations.map(({ acervo, ...record }) => record);
  const digest = createHash('sha256').update(JSON.stringify(originals)).digest('hex');
  assert.equal(digest, '471041f36534ed889293c091f6b3dc5b4c24fc278b779c03051db0206f83d585');
});

test('the historical panorama retains independently checked event dates and editorial context', () => {
  const news = declaracoes.declaracoes.filter(({ tipo, id }) => tipo === 'noticia' && !id.startsWith('acervo-'));
  assert.deepEqual(news.map(({ id, data }) => [id, data]), VERIFIED_NEWS);
  assert.equal(declaracoes.declaracoes.length, 106);
  assert.equal(new Set(declaracoes.declaracoes.map(({ id }) => id)).size, 106);
  for (const entry of news) {
    assert.equal(entry.acessado_em, '2026-10-10');
    for (const key of ['subtitulo', 'autor', 'texto', 'contexto']) assert.ok(entry[key].trim(), entry.id);
    assert.ok(entry.fontes.length > 0, entry.id);
    assert.ok(entry.fontes.every(({ url }) => url.startsWith('https://') && !url.includes('.invalid')), entry.id);
  }
  for (let index = 1; index < declaracoes.declaracoes.length; index++) {
    assert.ok(declaracoes.declaracoes[index].data >= declaracoes.declaracoes[index - 1].data);
  }
});

test('Brazilian variant records preserve preliminary findings and scientific qualifications', () => {
  const entry = (id) => declaracoes.declaracoes.find((entry) => entry.id === id);
  assert.match(entry('acervo-cov-0068').texto, /preliminar/);
  assert.match(entry('acervo-cov-0055').contexto, /não comprova transmissão comunitária/);
  assert.match(entry('acervo-cov-0072').contexto, /sobrecarga hospitalar/);
  assert.match(entry('oms-fim-emergencia-2023-05-05').texto, /continua circulando/);
  assert.match(entry('fim-emergencia-nacional-2022-04-22').contexto, /22\/05/);
});

test('purchase and crisis reporting retain attribution, delivery limits and causal qualifications', () => {
  const entry = (id) => declaracoes.declaracoes.find((entry) => entry.id === id);
  assert.match(entry('pfizer-primeira-oferta-2020-08-14').texto, /500 mil/);
  assert.match(entry('pfizer-primeira-oferta-2020-08-14').texto, /segundo o depoimento/);
  assert.match(entry('pfizer-primeira-oferta-2020-08-14').contexto, /oferta não significa doses imediatamente disponíveis/);
  assert.match(entry('oxigenio-manaus-2021-01-14').contexto, /MPF sustenta omissão/);
  assert.match(entry('oxigenio-manaus-2021-01-14').contexto, /não é apresentada como condenação criminal/);
  assert.match(entry('recorde-notificacoes-2021-04-08').contexto, /não necessariamente mortes ocorridas/);
  assert.match(entry('orfandade-estudo-2021-07-20').contexto, /Não é um registro nominal/);
  assert.match(entry('cpi-relatorio-2021-10-26').contexto, /não são condenação judicial/);
});

test('both excerpts from the March 24 speech appear in the same milestone', () => {
  const speech = declaracoes.declaracoes.find(({ id }) => id === 'pronunciamento-2020-03-24');
  assert.match(speech.texto, /gripezinha/);
  assert.match(speech.texto, /confinamento em massa/);
  assert.equal(speech.texto.split('\n\n').length, 2);
  assert.equal(declaracoes.declaracoes.filter((declaracao) => declaracao.data === '2020-03-24').length, 1);
});

test('the vaccine milestone summarizes the conditional jacaré remark without asserting a real effect', () => {
  const statement = declaracoes.declaracoes.find(({ id }) => id === 'vacina-jacare-2020-12-17');
  assert.equal(statement.data, '2020-12-17');
  assert.equal(statement.subtitulo, 'Bolsonaro fala em ‘virar um jacaré’ ao questionar a vacina da Pfizer');
  assert.match(statement.texto, /Se você virar um jacaré/);
  assert.match(statement.contexto, /não descreve um efeito real/);
});

test('every shipped statement has a distinct reachable row in chronological order', () => {
  const rows = quotations.map(({ data }) => (
    Math.floor(lastIndexOfDay(obitos.dias, dayIndexOf(obitos.dias, data)) / 10)
  ));
  for (let index = 1; index < rows.length; index++) {
    assert.ok(rows[index] > rows[index - 1], quotations[index].id);
  }
});

test('the expanded contexts retain historical roles and documented qualifications', () => {
  const contextOf = (id) => declaracoes.declaracoes.find((statement) => statement.id === id).contexto;
  assert.match(contextOf('jorginho-kit-covid-2021-05-04'), /senador pelo PL-SC/);
  assert.match(contextOf('jorginho-kit-covid-2021-05-04'), /assessoria.*negou/);
  assert.match(contextOf('magno-vacinacao-infantil-2022-02-01'), /ex-senador pelo PL-ES/);
  assert.match(contextOf('magno-vacinacao-infantil-2022-02-01'), /não substitui a vacinação/);
  assert.match(contextOf('eduardo-mascaras-2021-03-10'), /deputado federal pelo PSL-SP/);
  assert.match(contextOf('flavio-vacinacao-2021-06-18'), /senador pelo Patriota-RJ/);
  assert.match(contextOf('flavio-vacinacao-2021-06-18'), /recebeu a primeira dose e incentivou a vacinação/);
  assert.match(contextOf('valdemiro-sementes-2020-05-05'), /Ministério da Saúde desmentiu/);
  assert.match(contextOf('pazuello-obedece-2020-10-22'), /não um contrato definitivo/);
  assert.match(contextOf('pazuello-obedece-2020-10-22'), /negou ter recebido ordem/);
  assert.match(contextOf('queiroga-liberdade-2021-12-07'), /quarentena de cinco dias/);
});
