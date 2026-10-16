import type { Dia } from './layout';

export interface Fonte {
  nome: string;
  url: string;
}

interface ComFontes {
  fontes: Fonte[];
  acessado_em: string;
}

export interface Obitos extends ComFontes {
  criterio: 'data de notificação';
  dias: Dia[];
}

export interface DocumentoAcervo {
  arquivo: string;
  legenda: string;
  largura: number;
  altura: number;
  sha256: string;
}

export interface RegistroAcervo {
  manchete: string;
  veiculo: string;
  url: string;
  publicado_em?: string;
  fonte_primaria?: string;
  documentos: DocumentoAcervo[];
}

export interface Declaracao extends ComFontes {
  id: string;
  tipo?: 'declaracao' | 'noticia';
  data: string;
  texto: string;
  subtitulo?: string;
  autor?: string;
  contexto?: string;
  acervo?: RegistroAcervo;
}

export interface Declaracoes {
  sintetico: boolean;
  aviso?: string;
  declaracoes: Declaracao[];
}

export interface PageData {
  obitos: Obitos;
  declaracoes: Declaracoes;
  inicio: string;
  fim: string;
  total: number;
}

export const SYNTHETIC_PREFIX = '[Exemplo sintético';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Falha ao carregar ${url}: ${response.status}`);
  return (await response.json()) as T;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function hasSources(value: ComFontes): boolean {
  return (
    Array.isArray(value.fontes) && value.fontes.length > 0 &&
    value.fontes.every((fonte) => isText(fonte?.nome) && isHttpUrl(fonte?.url)) &&
    isIsoDate(value.acessado_em)
  );
}

const isPlaceholderUrl = (url: string): boolean => new URL(url).hostname.endsWith('.invalid');

function validateObitos(obitos: Obitos): void {
  const invalid = (reason: string) => new Error(`obitos.json inválido: ${reason}`);
  if (!obitos || typeof obitos !== 'object') throw invalid('formato');
  if ('sintetico' in obitos) throw invalid('dados sintéticos não são aceitos');
  if (!hasSources(obitos)) throw invalid('fontes');
  if (obitos.criterio !== 'data de notificação') throw invalid('critério');
  if (!Array.isArray(obitos.dias) || obitos.dias.length === 0) throw invalid('dias');

  let previous: Dia | undefined;
  for (const dia of obitos.dias) {
    if (!dia || !isIsoDate(dia.data)) throw invalid('data');
    if (!Number.isSafeInteger(dia.acumulado) || dia.acumulado < 0) throw invalid(`acumulado em ${dia.data}`);
    if (previous && dia.data <= previous.data) throw invalid(`datas fora de ordem em ${dia.data}`);
    if (previous && dia.acumulado < previous.acumulado) throw invalid(`acumulado decrescente em ${dia.data}`);
    previous = dia;
  }
  if (previous!.acumulado <= 0) throw invalid('total final');
}

function validArchive(record: RegistroAcervo): boolean {
  return Boolean(record && isText(record.manchete) && isText(record.veiculo)
    && isHttpUrl(record.url)
    && (record.publicado_em === undefined || isIsoDate(record.publicado_em))
    && (record.fonte_primaria === undefined || isHttpUrl(record.fonte_primaria))
    && Array.isArray(record.documentos) && record.documentos.every((document) => (
      document && /^acervo-covid\/\d{4}\/\d{2}_\d{4}\/[a-zA-Z0-9_]+\.png$/.test(document.arquivo)
      && isText(document.legenda) && /^[a-f0-9]{64}$/.test(document.sha256)
      && Number.isSafeInteger(document.largura) && document.largura > 0
      && Number.isSafeInteger(document.altura) && document.altura > 0
    )));
}

function validateDeclaracoes(arquivo: Declaracoes, inicio: string, fim: string): void {
  const invalid = (reason: string) => new Error(`declaracoes.json inválido: ${reason}`);
  if (!arquivo || typeof arquivo.sintetico !== 'boolean') throw invalid('sintetico');
  if (arquivo.sintetico && !isText(arquivo.aviso)) throw invalid('aviso');
  if (!Array.isArray(arquivo.declaracoes)) throw invalid('declaracoes');

  const ids = new Set<string>();
  for (const declaracao of arquivo.declaracoes) {
    if (!declaracao || !isText(declaracao.id) || ids.has(declaracao.id)) throw invalid('id');
    ids.add(declaracao.id);
    if (declaracao.tipo !== undefined && declaracao.tipo !== 'declaracao' && declaracao.tipo !== 'noticia') {
      throw invalid(`tipo de ${declaracao.id}`);
    }
    if (!isText(declaracao.texto)) throw invalid(`texto de ${declaracao.id}`);
    if (!arquivo.sintetico && !isText(declaracao.subtitulo)) throw invalid(`subtítulo de ${declaracao.id}`);
    // News may stand without context; quotations always carry it.
    const needsContext = declaracao.tipo !== 'noticia' || declaracao.contexto !== undefined;
    if (!arquivo.sintetico && (!isText(declaracao.autor) || (needsContext && !isText(declaracao.contexto)))) {
      throw invalid(`autor ou contexto de ${declaracao.id}`);
    }
    if (!isIsoDate(declaracao.data) || declaracao.data < inicio || declaracao.data > fim) {
      throw invalid(`data de ${declaracao.id}`);
    }
    if (!hasSources(declaracao)) throw invalid(`fontes de ${declaracao.id}`);
    if (declaracao.acervo !== undefined && !validArchive(declaracao.acervo)) {
      throw invalid(`acervo de ${declaracao.id}`);
    }
    if (arquivo.sintetico && !declaracao.texto.startsWith(SYNTHETIC_PREFIX)) {
      throw invalid(`${declaracao.id} sem o prefixo sintético`);
    }
    if (!arquivo.sintetico && declaracao.fontes.some((fonte) => isPlaceholderUrl(fonte.url))) {
      throw invalid(`fonte de exemplo em ${declaracao.id}`);
    }
  }
}

export async function loadPageData(baseUrl = import.meta.env.BASE_URL): Promise<PageData> {
  const [obitos, declaracoes] = await Promise.all([
    fetchJson<Obitos>(`${baseUrl}data/obitos.json`),
    fetchJson<Declaracoes>(`${baseUrl}data/declaracoes.json`),
  ]);

  validateObitos(obitos);
  const inicio = obitos.dias[0].data;
  const ultimo = obitos.dias[obitos.dias.length - 1];
  validateDeclaracoes(declaracoes, inicio, ultimo.data);

  return { obitos, declaracoes, inicio, fim: ultimo.data, total: ultimo.acumulado };
}
