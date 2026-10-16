import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(await read('src/lib/headline-crops.ts'), {
  compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},
});
const {headlineSlices} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const documents = JSON.parse(await read('public/data/declaracoes.json')).declaracoes.flatMap(record => record.acervo?.documentos ?? []);

test('all 55 captures have bounded editorial crops and untouched originals', () => {
  assert.equal(documents.length, 55);
  for (const document of documents) {
    const slices = headlineSlices(document);
    assert.ok(slices.length >= 1, document.arquivo);
    for (const [top,height] of slices) {
      assert.ok(top >= 0 && height > 0 && top + height <= document.altura, document.arquivo);
    }
    assert.ok(slices.reduce((sum,slice)=>sum+slice[1],0) < document.altura, document.arquivo);
  }
});

test('the Exame capture drops navigation and empty space but keeps the subtitle', () => {
  const document = documents.find(document => document.arquivo.endsWith('21052020_20mil_mortes.png'));
  assert.deepEqual(headlineSlices(document), [[615,320]]);
});

test('the BBC headline and subtitle remain visible without the photograph between them', () => {
  const document = documents.find(document => document.arquivo.endsWith('13042021_cpi.png'));
  assert.deepEqual(headlineSlices(document), [[10,278],[758,106]]);
});

test('unknown captures fall back to the original full image', () => {
  assert.deepEqual(headlineSlices({arquivo:'acervo-covid/2020/03_2020/unknown.png',altura:400}), [[0,400]]);
});
