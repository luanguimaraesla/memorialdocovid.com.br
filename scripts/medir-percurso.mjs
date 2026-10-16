// Reports the exact pixel distance between consecutive publications in the column and the
// speed each leg needs to take exactly SECONDS_BETWEEN_MILESTONES.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const configUrl = moduleUrl(await read('src/config.ts'));
const { SECONDS_BETWEEN_MILESTONES: seconds } = await import(configUrl);
const layoutUrl = moduleUrl((await read('src/lib/layout.ts')).replaceAll("'../config'", JSON.stringify(configUrl)));
const { anchorY, columnHeight, dayIndexOf, firstIndexOfDay } = await import(layoutUrl);
const { continuousPath } = await import(moduleUrl(
  (await read('src/lib/journey.ts')).replaceAll("'../config'", JSON.stringify(configUrl)),
));

const days = JSON.parse(await read('public/data/obitos.json')).dias;
const records = JSON.parse(await read('public/data/declaracoes.json')).declaracoes;
const total = days.at(-1).acumulado;
const milestones = records
  .map(record => ({ data: record.data, y: anchorY(firstIndexOfDay(days, dayIndexOf(days, record.data)), total) }))
  .sort((a, b) => a.y - b.y);
const round = value => Math.round(value);

// Guided legs leave at the average speed v, peak at 4v/3 a third of the way and land at
// rest: v(u) = v(1 + 2u - 3u²), with acceleration v/T × (2 - 6u).
const legs = milestones.slice(1).map((to, index) => {
  const from = milestones[index];
  const average = (to.y - from.y) / seconds;
  return {
    de: from.data,
    ate: to.data,
    distancia_px: to.y - from.y,
    velocidade_media_px_s: round(average),
    velocidade_maxima_px_s: round((4 / 3) * average),
    aceleracao_inicial_px_s2: round((2 * average) / seconds),
    desaceleracao_final_px_s2: round((4 * average) / seconds),
  };
});
const continuous = continuousPath([...milestones.map(({ y }) => y), columnHeight(total)]);

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    minimo: sorted[0],
    mediana: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    media: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    maximo: sorted.at(-1),
  };
}

const longest = legs.reduce((max, leg) => (leg.distancia_px > max.distancia_px ? leg : max));
console.log(JSON.stringify({
  segundos_entre_marcos: seconds,
  publicacoes: milestones.length,
  trechos: legs.length,
  trechos_na_mesma_linha: legs.filter(leg => leg.distancia_px === 0).length,
  trechos_mais_curtos_que_o_anterior: legs.slice(1).filter((leg, index) => leg.distancia_px < legs[index].distancia_px).length,
  distancia_px: stats(legs.map(leg => leg.distancia_px)),
  velocidade_media_px_s: stats(legs.map(leg => leg.velocidade_media_px_s)),
  trecho_mais_longo: longest,
  continuo_velocidade_nos_marcos_px_s: stats(continuous.slice(1, -1).map(({ speed }) => round(speed))),
  cauda_ate_o_fim_da_coluna_px: columnHeight(total) - milestones.at(-1).y,
  perfil_guiado: 'Parte à velocidade média do trecho, chega a 4/3 dela em um terço do caminho e para no marco.',
  perfil_continuo: 'Passa por cada marco sem parar; a velocidade no marco é a média harmônica dos trechos vizinhos.',
  trechos_detalhados: legs,
}, null, 2));
