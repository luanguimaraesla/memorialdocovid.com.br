import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { converterPainel, isDataIso, serializarObitos } from '../scripts/obitos-painel.mjs';

// Test-only CSV fixtures. None of these numbers are official counts.
const HEADER = 'regiao;estado;municipio;data;obitosAcumulado;obitosNovos';
const row = (regiao, data, obitos, estado = '') => `${regiao};${estado};;${data};${obitos};0`;
const csv = (...rows) => [HEADER, ...rows].join('\n');
const national = (data, obitos) => row('Brasil', data, obitos);
const series = (dias) => dias.map(({ data, acumulado }) => `${data}=${acumulado}`);

test('keeps only national rows from the first positive date to the latest date', () => {
  const dias = converterPainel([csv(
    national('2020-03-15', 0),
    national('2020-03-16', 0),
    row('Sudeste', '2020-03-16', 900, 'SP'),
    national('2020-03-17', 1),
    row('Sudeste', '2020-03-17', 950, 'SP'),
    national('2020-03-18', 3),
    national('2020-03-19', 3),
  )]);
  assert.deepEqual(series(dias), ['2020-03-17=1', '2020-03-18=3', '2020-03-19=3']);
});

test('reads the official header, BOM, CRLF, and quoted fields', () => {
  const header = 'regiao;estado;municipio;coduf;codmun;codRegiaoSaude;nomeRegiaoSaude;data;semanaEpi;' +
    'populacaoTCU2019;casosAcumulado;casosNovos;obitosAcumulado;obitosNovos;Recuperadosnovos;' +
    'emAcompanhamentoNovos;interior/metropolitana';
  const text = '\uFEFF' + [
    header,
    'Brasil;;;76;;;;2020-03-17;12;210147125;0;0;1;1;0;0;',
    '"Brasil";"";"";76;;;;"2020-03-18";12;210147125;0;0;"4";3;0;0;',
    'Sudeste;SP;"São Paulo; capital ""centro""";35;355030;;;2020-03-18;12;1;0;0;99;0;0;0;1',
    '',
  ].join('\r\n');
  assert.deepEqual(series(converterPainel([text])), ['2020-03-17=1', '2020-03-18=4']);
});

test('text after a closing quote fails instead of joining the field', () => {
  const text = (linha) => `regiao;data;obitosAcumulado\n${linha}`;
  assert.throws(() => converterPainel([text('Brasil;2020-03-17;"1"0')]), /CSV inválido: "0" depois das aspas de fechamento do campo 3/);
  assert.throws(() => converterPainel([text('Brasil;"2020"-03-17;1')]), /CSV inválido: "-" depois das aspas de fechamento do campo 2/);
  assert.throws(() => converterPainel([text('"Brasil" ;2020-03-17;1')]), /CSV inválido: " " depois das aspas/);
  assert.throws(() => converterPainel([text('Brasil;2020-03-17;"1"\r')]), /CSV inválido: "\\r" depois das aspas/);
  assert.deepEqual(series(converterPainel([text('Brasil;"2020-03-17";"1"')])), ['2020-03-17=1']);
});

test('sorts dates across files and collapses identical duplicates', () => {
  const dias = converterPainel([
    csv(national('2020-03-19', 6), national('2020-03-17', 1)),
    csv(national('2020-03-18', 2), national('2020-03-19', 6)),
  ]);
  assert.deepEqual(series(dias), ['2020-03-17=1', '2020-03-18=2', '2020-03-19=6']);
});

test('conflicting counts for the same national date fail in either order', () => {
  assert.throws(
    () => converterPainel([csv(national('2020-03-18', 2)), csv(national('2020-03-18', 3))]),
    /conflitante em 2020-03-18: 2 e 3/,
  );
  assert.throws(
    () => converterPainel([csv(national('2020-03-18', 3)), csv(national('2020-03-18', 2))]),
    /conflitante em 2020-03-18: 3 e 2/,
  );
});

test('malformed national dates fail instead of being dropped', () => {
  for (const data of ['2020-02-30', '2021-02-29', '20/03/2020', '', '2020-3-1']) {
    assert.throws(() => converterPainel([csv(national('2020-03-17', 1), national(data, 2))]), /Data nacional inválida/);
  }
  assert.equal(isDataIso('2020-02-29'), true);
});

test('malformed national counts fail instead of becoming zero', () => {
  for (const count of ['', '-1', '1.5', 'abc', '1e3', ' 2', '9007199254740993']) {
    assert.throws(
      () => converterPainel([csv(national('2020-03-17', 1), national('2020-03-18', count))]),
      /obitosAcumulado nacional inválido em 2020-03-18/,
    );
  }
  assert.throws(() => converterPainel([`${HEADER}\nBrasil;;;2020-03-18`]), /obitosAcumulado nacional inválido/);
});

test('missing required headers fail', () => {
  assert.throws(
    () => converterPainel(['regiao;estado;data;obitosNovos\nBrasil;;2020-03-17;1']),
    /colunas obrigatórias: obitosAcumulado/,
  );
  assert.throws(() => converterPainel(['']), /CSV vazio/);
});

test('an empty national series or a non-positive final total fails', () => {
  assert.throws(() => converterPainel([csv(row('Sudeste', '2020-03-17', 5, 'SP'))]), /Nenhuma linha nacional/);
  assert.throws(() => converterPainel([]), /Nenhuma linha nacional/);
  assert.throws(
    () => converterPainel([csv(national('2020-03-17', 2), national('2020-03-18', 0))]),
    /Total nacional final não positivo: 0/,
  );
});

test('downward revisions take the minimum of later totals and keep the final total', () => {
  const dias = converterPainel([csv(
    national('2020-03-17', 1),
    national('2020-03-18', 5),
    national('2020-03-19', 4),
    national('2020-03-20', 9),
    national('2020-03-21', 8),
  )]);
  assert.deepEqual(series(dias), ['2020-03-17=1', '2020-03-18=4', '2020-03-19=4', '2020-03-20=8', '2020-03-21=8']);
});

test('a starting count adjusted to zero stays inside the coverage', () => {
  const dias = converterPainel([csv(
    national('2020-03-16', 0),
    national('2020-03-17', 2),
    national('2020-03-18', 0),
    national('2020-03-19', 5),
  )]);
  assert.deepEqual(series(dias), ['2020-03-17=0', '2020-03-18=0', '2020-03-19=5']);
});

test('serialized output parses back to the same object', () => {
  const obitos = {
    fontes: [{ nome: 'teste', url: 'https://fonte.test/' }],
    acessado_em: '2026-01-01',
    criterio: 'data de notificação',
    dias: [{ data: '2020-03-17', acumulado: 1 }, { data: '2020-03-18', acumulado: 2 }],
  };
  assert.deepEqual(JSON.parse(serializarObitos(obitos)), obitos);
});

test('the CLI writes the file only after a successful conversion', async (context) => {
  const dir = await mkdtemp(join(tmpdir(), 'obitos-painel-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const run = promisify(execFile);
  const script = new URL('../scripts/obitos-painel.mjs', import.meta.url).pathname;
  const args = (saida, ...csvs) => [
    script, '--arquivo-url', 'https://fonte.test/painel.zip', '--versao', 'painel.zip',
    '--acessado-em', '2026-01-01', '--saida', saida, ...csvs,
  ];

  const good = join(dir, 'bom.csv');
  await writeFile(good, csv(national('2020-03-17', 1), national('2020-03-18', 2)));
  await run(process.execPath, args(join(dir, 'ok.json'), good));
  const written = JSON.parse(await readFile(join(dir, 'ok.json'), 'utf8'));
  assert.equal(written.criterio, 'data de notificação');
  assert.deepEqual(written.fontes.map((fonte) => fonte.url), ['https://covid.saude.gov.br/', 'https://fonte.test/painel.zip']);
  assert.deepEqual(series(written.dias), ['2020-03-17=1', '2020-03-18=2']);

  const bad = join(dir, 'ruim.csv');
  await writeFile(bad, csv(national('2020-03-17', 1), national('2020-03-18', 'x')));
  await assert.rejects(run(process.execPath, args(join(dir, 'falha.json'), good, bad)), /obitosAcumulado nacional inválido/);
  await assert.rejects(access(join(dir, 'falha.json')));

  const badQuotes = join(dir, 'aspas.csv');
  await writeFile(badQuotes, csv(national('2020-03-17', 1), national('2020-03-18', '"2"0')));
  await assert.rejects(
    run(process.execPath, args(join(dir, 'aspas.json'), good, badQuotes)),
    /CSV inválido: "0" depois das aspas de fechamento/,
  );
  await assert.rejects(access(join(dir, 'aspas.json')));
});
