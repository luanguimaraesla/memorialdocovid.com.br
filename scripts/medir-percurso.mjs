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
const { anchorY, columnHeight, dayIndexOf, lastIndexOfDay } = await import(layoutUrl);
const { RAMP_SHARE, milestoneSpeeds } = await import(moduleUrl(
  (await read('src/lib/journey.ts')).replaceAll("'../config'", JSON.stringify(configUrl)),
));

const days = JSON.parse(await read('public/data/obitos.json')).dias;
const records = JSON.parse(await read('public/data/declaracoes.json')).declaracoes;
const total = days.at(-1).acumulado;
const milestones = records
  .map(record => ({ data: record.data, y: anchorY(lastIndexOfDay(days, dayIndexOf(days, record.data)), total) }))
  .sort((a, b) => a.y - b.y);
const round = value => Math.round(value);

// Guided legs speed up for RAMP_SHARE of the interval, run at peak = average / (1 - RAMP_SHARE)
// and brake for the same share, with constant acceleration in both ramps.
const ramp = RAMP_SHARE * seconds;
const legs = milestones.slice(1).map((to, index) => {
  const from = milestones[index];
  const average = (to.y - from.y) / seconds;
  const peak = average / (1 - RAMP_SHARE);
  return {
    de: from.data,
    ate: to.data,
    distancia_px: to.y - from.y,
    velocidade_media_px_s: round(average),
    velocidade_maxima_px_s: round(peak),
    aceleracao_e_frenagem_px_s2: round(peak / ramp),
  };
});
const speeds = milestoneSpeeds([...milestones.map(({ y }) => y), columnHeight(total)]);

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
  continuo_velocidade_nos_marcos_px_s: stats(speeds.slice(1, -1).map(round)),
  cauda_ate_o_fim_da_coluna_px: columnHeight(total) - milestones.at(-1).y,
  perfil_guiado: `Acelera em ${ramp.toFixed(2)} s, segue na velocidade máxima e freia em ${ramp.toFixed(2)} s até parar no marco.`,
  perfil_continuo: 'Passa por cada marco sem parar; a velocidade no marco é a média harmônica dos trechos vizinhos.',
  trechos_detalhados: legs,
}, null, 2));
