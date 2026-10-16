import type { DocumentoAcervo, Fonte, RegistroAcervo } from './state';
import { headlineSlices } from './headline-crops';

const fmtDate = (iso: string): string => iso.split('-').reverse().join('/');

function link(text: string, url: string): HTMLAnchorElement {
  const element = document.createElement('a');
  element.textContent = text;
  element.href = url;
  element.target = '_blank';
  element.rel = 'noopener noreferrer';
  return element;
}

function image(capture: DocumentoAcervo): HTMLImageElement {
  const element = document.createElement('img');
  element.src = `${import.meta.env.BASE_URL}${capture.arquivo}`;
  element.alt = `Captura do acervo: ${capture.legenda}`;
  element.width = capture.largura;
  element.height = capture.altura;
  element.loading = 'lazy';
  element.decoding = 'async';
  return element;
}

// Links the archived report and its primary source, skipping links already in `shown`.
export function archiveSources(record: RegistroAcervo, shown: Fonte[] = []): HTMLElement {
  const content = document.createElement('p');
  content.className = 'acervo__fontes';
  const urls = new Set(shown.map(({ url }) => url));
  if (!urls.has(record.url)) content.append(link(`${record.veiculo} — ${record.manchete}`, record.url), '. ');
  if (record.publicado_em) content.append(`Reportagem publicada em ${fmtDate(record.publicado_em)}. `);
  if (record.fonte_primaria && !urls.has(record.fonte_primaria)) content.append(link('Fonte primária', record.fonte_primaria));
  return content;
}

export function archiveHeadlines(record: RegistroAcervo): HTMLElement {
  const content = document.createElement('div');
  content.className = 'declaracao__headlines';
  const aspect = record.documentos.reduce((sum, capture) => sum
    + headlineSlices(capture).reduce((height, slice) => height + slice[1], 0) / capture.largura, 0);
  content.style.setProperty('--headline-width', `min(100%, calc(41svh * ${1 / aspect}))`);
  for (const capture of record.documentos) {
    const figure = document.createElement('figure');
    const original = link('Abrir captura original', `${import.meta.env.BASE_URL}${capture.arquivo}`);
    original.setAttribute('aria-label', `Abrir captura original: ${capture.legenda}`);
    original.replaceChildren();
    headlineSlices(capture).forEach(([top, height], index) => {
      const slice = document.createElement('span');
      slice.className = 'headline-crop';
      slice.style.aspectRatio = `${capture.largura} / ${height}`;
      const preview = image(capture);
      preview.style.top = `${-100 * top / height}%`;
      if (index > 0) preview.alt = '';
      slice.append(preview);
      original.append(slice);
    });
    figure.append(original);
    content.append(figure);
  }
  return content;
}

export function archiveContent(record: RegistroAcervo): HTMLElement {
  const content = document.createElement('div');
  content.className = 'acervo';
  for (const capture of record.documentos) {
    const figure = document.createElement('figure');
    const preview = image(capture);
    const original = link('Abrir captura original', preview.src);
    const caption = document.createElement('figcaption');
    caption.textContent = capture.legenda;
    original.replaceChildren(preview);
    figure.append(original, caption);
    content.append(figure);
  }
  return content;
}
