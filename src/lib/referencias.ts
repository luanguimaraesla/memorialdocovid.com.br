import { loadPageData } from './state';
import { archiveContent, archiveSources } from './archive';
import type { Declaracoes, Fonte, Obitos } from './state';

function fmtDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function must<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Elemento ausente: ${selector}`);
  return element as T;
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function sourceLink(fonte: Fonte): HTMLAnchorElement {
  const link = create('a', fonte.nome);
  link.href = fonte.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function mountSources(obitos: Obitos): void {
  const list = document.createElement('ul');
  list.className = 'fontes__lista';
  for (const fonte of obitos.fontes) {
    const item = document.createElement('li');
    item.append(sourceLink(fonte));
    list.append(item);
  }
  must('[data-fontes-obitos]').replaceChildren(list);
}

function mountStatements(arquivo: Declaracoes): void {
  const entries = arquivo.declaracoes.map((declaracao) => {
    const entry = document.createElement('article');
    entry.id = `declaracao-${declaracao.id}`;
    entry.className = 'ref-declaracao';
    const date = create('time', fmtDate(declaracao.data));
    date.dateTime = declaracao.data;
    date.className = 'ref-declaracao__data';
    entry.append(date);
    if (declaracao.subtitulo) entry.append(create('h3', declaracao.subtitulo));
    if (declaracao.autor) entry.append(create('p', declaracao.autor));
    entry.setAttribute('data-tipo', declaracao.tipo ?? 'declaracao');
    entry.append(create(declaracao.tipo === 'noticia' ? 'p' : 'blockquote', declaracao.texto));
    if (declaracao.tipo === 'noticia') entry.append(create('p', 'Resumo editorial de um marco histórico, não uma citação literal.'));
    if (declaracao.contexto) entry.append(create('p', declaracao.contexto));
    if (declaracao.acervo) entry.append(archiveContent(declaracao.acervo), archiveSources(declaracao.acervo, declaracao.fontes));
    if (arquivo.sintetico) {
      entry.append(create('p', `Exemplo sintético, sem fonte real. Data de acesso fictícia: ${fmtDate(declaracao.acessado_em)}.`));
    } else {
      const sources = document.createElement('p');
      for (const fonte of declaracao.fontes) sources.append(sourceLink(fonte), ' ');
      sources.append(`· acesso em ${fmtDate(declaracao.acessado_em)}`);
      entry.append(sources);
    }
    return entry;
  });
  const target = must('[data-fontes-declaracoes]');
  target.replaceChildren(...entries);
  if (arquivo.sintetico) {
    target.prepend(create('p', `Declarações sintéticas de exemplo, sem fonte real. ${arquivo.aviso ?? ''}`));
  }
}

function scrollToStatement(): void {
  if (!window.location.hash.startsWith('#declaracao-')) return;
  let id: string;
  try {
    id = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return;
  }
  document.getElementById(id)?.scrollIntoView();
}

export async function bootReferencias(): Promise<void> {
  const errorEl = must<HTMLElement>('#load-error');
  try {
    const data = await loadPageData();
    const dates = { inicio: data.inicio, fim: data.fim, 'acessado-em': data.obitos.acessado_em };
    for (const [key, iso] of Object.entries(dates)) {
      const time = must<HTMLTimeElement>(`[data-dyn="${key}"]`);
      time.textContent = fmtDate(iso);
      time.dateTime = iso;
    }
    must('[data-dyn="total"]').textContent = data.total.toLocaleString('pt-BR');
    const link = must<HTMLAnchorElement>('[data-dyn-link="fonte"]');
    link.href = data.obitos.fontes[0].url;
    link.textContent = data.obitos.fontes[0].nome;
    mountSources(data.obitos);
    mountStatements(data.declaracoes);
    scrollToStatement();
  } catch (error) {
    console.error('Falha ao carregar os dados:', error);
    errorEl.hidden = false;
  }
}
