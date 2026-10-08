import { ANNOUNCE_INTERVAL_MS, DOT_RADIUS_PX } from '../config';
import {
  anchorY,
  columnHeight,
  columnWidth,
  dateAtIndex,
  dayIndexOf,
  dotPosition,
  firstIndexOfDay,
  livesAtDepth,
  monthMarkers,
  visibleIndexRange,
} from './layout';
import type { MonthMarker } from './layout';
import { loadPageData } from './state';
import type { Declaracao, Fonte, PageData } from './state';

const DOT_COLOR = '#e8e4dc';

interface Elements {
  track: HTMLElement;
  canvas: HTMLCanvasElement;
  marks: HTMLElement;
  lives: HTMLElement;
  date: HTMLElement;
  total: HTMLElement;
  announcer: HTMLElement;
  btnInicio: HTMLButtonElement;
  btnFim: HTMLButtonElement;
  inicio: HTMLTimeElement;
  fim: HTMLTimeElement;
  acessadoEm: HTMLTimeElement;
  seriesTotal: HTMLElement;
  sourceLink: HTMLAnchorElement;
  syntheticNotice: HTMLElement;
  syntheticText: HTMLElement;
  officialSources: HTMLElement;
  statementSources: HTMLElement;
}

let data: PageData;
let ui: Elements;
let ctx: CanvasRenderingContext2D;
let height = 0;
let ticking = false;
let lastAnnounceAt = -Infinity;
let pendingAnnounce: ReturnType<typeof setTimeout> | undefined;
let announcement = '';

const fmtInt = (value: number): string => value.toLocaleString('pt-BR');

function fmtDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function must<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Elemento ausente: ${selector}`);
  return element as T;
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function dateElement(iso: string, className: string): HTMLTimeElement {
  const time = create('time', className, fmtDate(iso));
  time.dateTime = iso;
  return time;
}

function sourceLink(fonte: Fonte): HTMLAnchorElement {
  const link = create('a', 'fonte__link', fonte.nome);
  link.href = fonte.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function setDate(time: HTMLTimeElement, iso: string): void {
  time.textContent = fmtDate(iso);
  time.dateTime = iso;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function populate(): void {
  const { obitos, declaracoes, inicio, fim, total } = data;
  setDate(ui.inicio, inicio);
  setDate(ui.fim, fim);
  setDate(ui.acessadoEm, obitos.acessado_em);
  ui.seriesTotal.textContent = fmtInt(total);
  ui.sourceLink.href = obitos.fontes[0].url;
  ui.sourceLink.textContent = obitos.fontes[0].nome;
  ui.total.textContent = fmtInt(total);

  if (declaracoes.sintetico) {
    ui.syntheticText.textContent = declaracoes.aviso ?? '';
    ui.syntheticNotice.hidden = false;
  }
  mountSources();
}

function mountSources(): void {
  const { obitos, declaracoes } = data;
  const official = create('p', 'fontes__grupo');
  official.append(create('strong', '', 'Óbitos'), ` · acesso em ${fmtDate(obitos.acessado_em)}`);
  const list = create('ul', 'fontes__lista');
  for (const fonte of obitos.fontes) {
    const item = create('li', '');
    item.append(sourceLink(fonte));
    list.append(item);
  }
  ui.officialSources.replaceChildren(official, list);

  const target = ui.statementSources;
  if (declaracoes.sintetico) {
    const accessDates = [...new Set(declaracoes.declaracoes.map((declaracao) => fmtDate(declaracao.acessado_em)))];
    const notice = create('p', 'fontes__grupo');
    notice.append(
      create('strong', '', 'Declarações: exemplos sintéticos, sem fonte real.'),
      ` ${declaracoes.aviso ?? ''} Datas de acesso fictícias: ${accessDates.join(', ')}.`,
    );
    target.replaceChildren(notice);
    return;
  }
  const heading = create('p', 'fontes__grupo');
  heading.append(create('strong', '', 'Declarações'));
  const statements = create('ul', 'fontes__lista');
  for (const declaracao of declaracoes.declaracoes) {
    for (const fonte of declaracao.fontes) {
      const item = create('li', '');
      item.append(`${fmtDate(declaracao.data)}: `, sourceLink(fonte), ` · acesso em ${fmtDate(declaracao.acessado_em)}`);
      statements.append(item);
    }
  }
  target.replaceChildren(heading, statements);
}

function monthLabel(marker: MonthMarker): HTMLElement {
  const label = create('p', 'marco-mes');
  label.style.top = `${marker.y}px`;
  label.append(dateElement(marker.data, 'marco-mes__data'));
  return label;
}

function statementCard(declaracao: Declaracao, synthetic: boolean): HTMLElement {
  const { dias } = data.obitos;
  const index = firstIndexOfDay(dias, dayIndexOf(dias, declaracao.data));
  const card = create('article', synthetic ? 'declaracao declaracao--sintetica' : 'declaracao');
  card.setAttribute('tabindex', '0');
  card.style.top = `${anchorY(index, data.total)}px`;
  if (synthetic) card.append(create('p', 'declaracao__selo', 'exemplo sintético'));
  card.append(dateElement(declaracao.data, 'declaracao__data'), create('p', 'declaracao__texto', declaracao.texto));
  if (!synthetic) {
    const sources = create('p', 'declaracao__fontes');
    for (const fonte of declaracao.fontes) sources.append(sourceLink(fonte), ' ');
    card.append(sources);
  }
  return card;
}

function buildMarks(): void {
  const labels = monthMarkers(data.obitos.dias).map(monthLabel);
  const cards = data.declaracoes.declaracoes.map((declaracao) => statementCard(declaracao, data.declaracoes.sintetico));
  ui.marks.replaceChildren(...labels, ...cards);
}

function resizeCanvas(): void {
  const ratio = window.devicePixelRatio || 1;
  const width = columnWidth();
  const viewport = window.innerHeight;
  ui.canvas.style.width = `${width}px`;
  ui.canvas.style.height = `${viewport}px`;
  ui.canvas.width = Math.round(width * ratio);
  ui.canvas.height = Math.round(viewport * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

// Draws only the dots behind the sticky canvas. `offset` is the canvas top inside the track.
function draw(offset: number): void {
  const viewport = window.innerHeight;
  const { start, end } = visibleIndexRange(offset, viewport, data.total);
  ctx.clearRect(0, 0, columnWidth(), viewport);
  ctx.fillStyle = DOT_COLOR;
  ctx.beginPath();
  for (let index = start; index < end; index += 1) {
    const { x, y } = dotPosition(index);
    const cx = x + DOT_RADIUS_PX;
    const cy = y + DOT_RADIUS_PX - offset;
    ctx.moveTo(cx + DOT_RADIUS_PX, cy);
    ctx.arc(cx, cy, DOT_RADIUS_PX, 0, 2 * Math.PI);
  }
  ctx.fill();
}

function flushAnnouncement(): void {
  pendingAnnounce = undefined;
  if (ui.announcer.textContent === announcement) return;
  ui.announcer.textContent = announcement;
  lastAnnounceAt = Date.now();
}

function announce(text: string): void {
  announcement = text;
  if (pendingAnnounce !== undefined) return;
  const wait = lastAnnounceAt + ANNOUNCE_INTERVAL_MS - Date.now();
  if (wait <= 0) flushAnnouncement();
  else pendingAnnounce = setTimeout(flushAnnouncement, wait);
}

// The counter reads the column at a reference line one third down the viewport.
function updateCounter(trackTop: number): void {
  const lives = livesAtDepth(window.innerHeight / 3 - trackTop, data.total);
  const date = lives > 0 ? fmtDate(dateAtIndex(data.obitos.dias, lives - 1)) : '—';
  ui.lives.textContent = fmtInt(lives);
  ui.date.textContent = date;
  announce(
    lives > 0
      ? `${fmtInt(lives)} vidas até ${date}, de ${fmtInt(data.total)}.`
      : `0 vidas, de ${fmtInt(data.total)}.`,
  );
}

function update(): void {
  const trackTop = ui.track.getBoundingClientRect().top;
  const canvasTop = ui.canvas.getBoundingClientRect().top;
  draw(canvasTop - trackTop);
  updateCounter(trackTop);
}

function scrollToDepth(depth: number): void {
  const trackTop = ui.track.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({
    top: trackTop + depth - window.innerHeight / 3,
    behavior: reducedMotion() ? 'auto' : 'smooth',
  });
}

function wire(): void {
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  }, { passive: true });
  window.addEventListener('resize', () => {
    resizeCanvas();
    update();
  });
  ui.btnInicio.addEventListener('click', () => scrollToDepth(0));
  ui.btnFim.addEventListener('click', () => scrollToDepth(height - 1));
}

function elements(): Elements {
  return {
    track: must('[data-track]'),
    canvas: must('[data-canvas]'),
    marks: must('[data-marks]'),
    lives: must('[data-counter-lives]'),
    date: must('[data-counter-date]'),
    total: must('[data-counter-total]'),
    announcer: must('[data-announcer]'),
    btnInicio: must('#btn-inicio'),
    btnFim: must('#btn-fim'),
    inicio: must('[data-dyn="inicio"]'),
    fim: must('[data-dyn="fim"]'),
    acessadoEm: must('[data-dyn="acessado-em"]'),
    seriesTotal: must('[data-dyn="total"]'),
    sourceLink: must('[data-dyn-link="fonte"]'),
    syntheticNotice: must('[data-aviso-sintetico]'),
    syntheticText: must('[data-aviso-texto]'),
    officialSources: must('[data-fontes-obitos]'),
    statementSources: must('[data-fontes-declaracoes]'),
  };
}

// Loads and validates the data, then enables the memorial. On any failure it
// shows #load-error and leaves the counter empty and the controls disabled.
export async function boot(): Promise<void> {
  const errorEl = must<HTMLElement>('#load-error');
  try {
    ui = elements();
    const loaded = await loadPageData();
    const columnPx = columnHeight(loaded.total);
    const context = ui.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D indisponível');

    data = loaded;
    height = columnPx;
    ctx = context;
    ui.track.style.height = `${height}px`;
    populate();
    buildMarks();
    resizeCanvas();
    wire();
    update();
    ui.btnInicio.disabled = false;
    ui.btnFim.disabled = false;
  } catch (error) {
    console.error('Falha ao carregar os dados:', error);
    errorEl.hidden = false;
  }
}
