// Converte o HIST_PAINEL_COVIDBR do Ministério da Saúde em public/data/obitos.json.
//
// Uso:
//   node scripts/obitos-painel.mjs --arquivo-url <url do .zip> --versao <nome do .zip> \
//     --acessado-em AAAA-MM-DD --saida public/data/obitos.json <csv>...
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const COLUNAS_OBRIGATORIAS = ['regiao', 'data', 'obitosAcumulado'];
const PAINEL_URL = 'https://covid.saude.gov.br/';

export function isDataIso(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function contagem(valor) {
  if (typeof valor !== 'string' || !/^\d+$/.test(valor)) return undefined;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) ? numero : undefined;
}

// Lê um registro que contém aspas, campo a campo, a partir de `inicio`.
// Depois das aspas de fechamento, só aceita `;`, fim de linha ou fim do arquivo.
function registroComAspas(texto, inicio) {
  const campos = [];
  let campo = '';
  let entreAspas = false;
  let aspasFechadas = false;
  let i = inicio;
  while (i < texto.length) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        entreAspas = false;
        aspasFechadas = true;
      } else campo += c;
      i += 1;
      continue;
    }
    const fimDeLinha = c === '\n' || (c === '\r' && texto[i + 1] === '\n');
    if (aspasFechadas && c !== ';' && !fimDeLinha) {
      throw new Error(
        `CSV inválido: ${JSON.stringify(c)} depois das aspas de fechamento do campo ${campos.length + 1}`,
      );
    }
    if (c === '"' && campo === '') entreAspas = true;
    else if (c === ';') {
      campos.push(campo);
      campo = '';
      aspasFechadas = false;
    } else if (fimDeLinha) {
      break;
    } else campo += c;
    i += 1;
  }
  if (entreAspas) throw new Error('CSV inválido: aspas sem fechamento');
  campos.push(campo);
  if (texto[i] === '\r') i += 1;
  return { campos, proximo: i + 1 };
}

function* registros(texto) {
  let posicao = texto.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (posicao < texto.length) {
    const quebra = texto.indexOf('\n', posicao);
    const fim = quebra === -1 ? texto.length : quebra;
    let linha = texto.slice(posicao, fim);
    if (linha.includes('"')) {
      const { campos, proximo } = registroComAspas(texto, posicao);
      posicao = proximo;
      yield campos;
      continue;
    }
    posicao = fim + 1;
    if (linha.endsWith('\r')) linha = linha.slice(0, -1);
    if (linha !== '') yield linha.split(';');
  }
}

function linhasNacionais(texto, acumulados) {
  let colunas;
  for (const campos of registros(texto)) {
    if (!colunas) {
      colunas = Object.fromEntries(campos.map((nome, indice) => [nome, indice]));
      const ausentes = COLUNAS_OBRIGATORIAS.filter((nome) => colunas[nome] === undefined);
      if (ausentes.length > 0) throw new Error(`CSV sem as colunas obrigatórias: ${ausentes.join(', ')}`);
      continue;
    }
    if (campos[colunas.regiao] !== 'Brasil') continue;

    const data = campos[colunas.data];
    const bruto = campos[colunas.obitosAcumulado];
    if (!isDataIso(data)) throw new Error(`Data nacional inválida: ${JSON.stringify(data)}`);
    const acumulado = contagem(bruto);
    if (acumulado === undefined) {
      throw new Error(`obitosAcumulado nacional inválido em ${data}: ${JSON.stringify(bruto)}`);
    }
    const anterior = acumulados.get(data);
    if (anterior !== undefined && anterior !== acumulado) {
      throw new Error(`obitosAcumulado conflitante em ${data}: ${anterior} e ${acumulado}`);
    }
    acumulados.set(data, acumulado);
  }
  if (!colunas) throw new Error('CSV vazio');
}

// Converte os CSVs do painel na série nacional diária de óbitos acumulados.
// A série começa na primeira data com óbito e termina na última data do painel.
// Revisões para baixo são conciliadas com acumulado[d] = min(acumulado[d..fim]),
// o que preserva o total oficial mais recente.
export function converterPainel(csvTexts) {
  const acumulados = new Map();
  for (const texto of csvTexts) linhasNacionais(texto, acumulados);

  const serie = [...acumulados].sort(([a], [b]) => (a < b ? -1 : 1));
  if (serie.length === 0) throw new Error('Nenhuma linha nacional (regiao Brasil) encontrada');
  const totalOficial = serie[serie.length - 1][1];
  if (totalOficial <= 0) throw new Error(`Total nacional final não positivo: ${totalOficial}`);

  const inicio = serie.findIndex(([, acumulado]) => acumulado > 0);
  const dias = serie.slice(inicio).map(([data, acumulado]) => ({ data, acumulado }));
  let minimo = Infinity;
  for (let k = dias.length - 1; k >= 0; k -= 1) {
    minimo = Math.min(minimo, dias[k].acumulado);
    dias[k].acumulado = minimo;
  }
  return dias;
}

export function serializarObitos(obitos) {
  const dias = obitos.dias.map((dia) => `    ${JSON.stringify(dia)}`).join(',\n');
  const cabecalho = JSON.stringify({ ...obitos, dias: [] }, null, 2).replace(/"dias": \[\]\n\}$/, '');
  return `${cabecalho}"dias": [\n${dias}\n  ]\n}\n`;
}

function principal() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'arquivo-url': { type: 'string' },
      versao: { type: 'string' },
      'acessado-em': { type: 'string' },
      saida: { type: 'string' },
    },
  });
  const arquivoUrl = values['arquivo-url'];
  const acessadoEm = values['acessado-em'];
  if (!arquivoUrl || !values.versao || !isDataIso(acessadoEm) || !values.saida || positionals.length === 0) {
    throw new Error(
      'Uso: node scripts/obitos-painel.mjs --arquivo-url <url> --versao <nome> ' +
      '--acessado-em AAAA-MM-DD --saida <arquivo.json> <csv>...',
    );
  }

  function* textos() {
    for (const caminho of positionals) yield readFileSync(caminho, 'utf8');
  }
  const dias = converterPainel(textos());
  const obitos = {
    fontes: [
      { nome: 'Ministério da Saúde, Painel Coronavírus', url: PAINEL_URL },
      { nome: `Ministério da Saúde, ${values.versao}`, url: arquivoUrl },
    ],
    acessado_em: acessadoEm,
    criterio: 'data de notificação',
    dias,
  };
  writeFileSync(values.saida, serializarObitos(obitos));
  const ultimo = dias[dias.length - 1];
  console.log(`${dias.length} dias, de ${dias[0].data} a ${ultimo.data}, total ${ultimo.acumulado}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
