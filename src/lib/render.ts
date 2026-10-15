import { ANNOUNCE_INTERVAL_MS, SHARE_STATUS_DURATION_MS, DOT_RADIUS_PX, DOTS_PER_ROW, SPEED_BASE, SPEED_MULTIPLIERS } from '../config';
import {
  columnHeight,
  columnWidth,
  anchorY,
  dateAtIndex,
  dayIndexOf,
  dayNumber,
  dotPosition,
  firstIndexOfDay,
  livesAtDepth,
  weekMarkers,
  thousandMarkers,
  visibleIndexRange,
} from './layout';
import type { ThousandMarker, WeekMarker } from './layout';
import { loadPageData } from './state';
import type { Declaracao, PageData } from './state';
import { createAutoscroll } from './autoscroll';
import type { Autoscroll } from './autoscroll';
import { shareDescription, shareLink, statementAnchor, statementUrl } from './sharing';
import type { SharedLink } from './sharing';

const DOT_ROW_COLORS = ['#e8e4dc', '#cbc7bf'];

interface Elements {
  track: HTMLElement;
  canvas: HTMLCanvasElement;
  marks: HTMLElement;
  weeks: HTMLElement;
  separators: HTMLElement;
  counter: HTMLElement;
  referenceLine: HTMLElement;
  lives: HTMLElement;
  days: HTMLElement;
  total: HTMLElement;
  announcer: HTMLElement;
  btnShare: HTMLButtonElement;
  shareStatus: HTMLElement;
  shareDialog: HTMLDialogElement;
  shareMessage: HTMLTextAreaElement;
  shareClose: HTMLButtonElement;
  btnStart: HTMLButtonElement;
  btnPlay: HTMLButtonElement;
  speedSelect: HTMLSelectElement;
  syntheticNotice: HTMLElement;
}

let data: PageData;
let ui: Elements;
let ctx: CanvasRenderingContext2D;
let height = 0;
let ticking = false;
let lastAnnounceAt = -Infinity;
let pendingAnnounce: ReturnType<typeof setTimeout> | undefined;
let announcement = '';
let statementCards: { index: number; element: HTMLElement }[] = [];
let activeCard: HTMLElement | undefined;
let pinnedCard: { index: number; element: HTMLElement } | undefined;
let autoscroll: Autoscroll;
let speedMultiplier = 1;
let shareStatusTimer: ReturnType<typeof setTimeout> | undefined;

const fmtInt = (value: number): string => value.toLocaleString('pt-BR');
const fmtDays = (value: number): string => `${fmtInt(value)} ${value === 1 ? 'dia' : 'dias'}`;

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

function viewport(): { top: number; height: number } {
  return {
    top: window.visualViewport?.offsetTop ?? 0,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

function referenceDepth(): number {
  const { top, height } = viewport();
  return top + height / 2;
}

function populate(): void {
  ui.total.textContent = fmtInt(data.total);
  ui.syntheticNotice.hidden = !data.declaracoes.sintetico;
}

function weekLabel(marker: WeekMarker): HTMLElement {
  const label = create('p', 'marco-semana');
  label.style.top = `${marker.y}px`;
  label.append(dateElement(marker.data, 'marco-semana__data'));
  return label;
}

function thousandLabel(marker: ThousandMarker): HTMLElement {
  const label = create('p', 'memorial__separator');
  label.style.top = `${marker.y}px`;
  label.setAttribute('data-lives', String(marker.lives));
  label.append(
    create('strong', 'memorial__separator-number', fmtInt(marker.lives)),
    create('span', 'memorial__separator-caption', 'vidas'),
  );
  return label;
}

function statementCard(declaracao: Declaracao, synthetic: boolean): { index: number; element: HTMLElement } {
  const { dias } = data.obitos;
  const index = firstIndexOfDay(dias, dayIndexOf(dias, declaracao.data));
  const card = create('article', synthetic ? 'declaracao declaracao--sintetica' : 'declaracao');
  card.setAttribute('tabindex', '0');
  card.id = statementAnchor(declaracao.id);
  card.hidden = true;
  card.setAttribute('data-tipo', declaracao.tipo ?? 'declaracao');
  const header = create('header', 'declaracao__cabecalho');
  if (synthetic) header.append(create('p', 'declaracao__selo', 'exemplo sintético'));
  header.append(dateElement(declaracao.data, 'declaracao__data'));
  if (declaracao.subtitulo) header.append(create('h3', 'declaracao__subtitulo', declaracao.subtitulo));
  if (declaracao.autor) header.append(create('p', 'declaracao__autor', declaracao.autor));
  if (declaracao.tipo === 'noticia') header.append(create('p', 'declaracao__selo', 'marco histórico'));
  card.append(header, create(declaracao.tipo === 'noticia' ? 'p' : 'blockquote', 'declaracao__texto', declaracao.texto));
  const references = create('a', 'declaracao__fontes', 'fontes e contexto');
  references.href = `${import.meta.env.BASE_URL}referencias#declaracao-${encodeURIComponent(declaracao.id)}`;
  const shareButton = create('button', 'page-button declaracao__compartilhar', 'Compartilhar');
  shareButton.type = 'button';
  shareButton.setAttribute('aria-label', 'Compartilhar este marco');
  shareButton.addEventListener('click', () => {
    const title = declaracao.subtitulo ?? 'Memorial do Covid';
    void requestShare({
      title,
      text: shareDescription(title),
      url: statementUrl(declaracao.id, siteBase()),
    });
  });
  const actions = create('div', 'declaracao__acoes');
  actions.append(references, shareButton);
  card.append(actions);
  return { index, element: card };
}

function markerNavigation(card: typeof statementCards[number], group: typeof statementCards): void {
  const position = group.indexOf(card);
  const navigation = create('nav', 'declaracao__nav');
  navigation.setAttribute('aria-label', 'Marcos na mesma posição da coluna');
  navigation.append(create('span', 'declaracao__nav-count', `${position + 1} de ${group.length} marcos neste ponto`));
  for (const [label, offset] of [['Anterior', -1], ['Próximo', 1]] as const) {
    const button = create('button', 'page-button', label);
    button.type = 'button';
    button.disabled = !group[position + offset];
    button.setAttribute('aria-label', `${label} marco nesta posição`);
    button.addEventListener('click', () => {
      autoscroll.pause();
      pinnedCard = group[position + offset];
      pinnedCard.element.scrollTop = 0;
      update();
      pinnedCard.element.focus({ preventScroll: true });
    });
    navigation.append(button);
  }
  card.element.append(navigation);
}

function buildMarks(): void {
  ui.weeks.replaceChildren(...weekMarkers(data.obitos.dias).map(weekLabel));
  ui.separators.replaceChildren(...thousandMarkers(data.total).map(thousandLabel));
  statementCards = data.declaracoes.declaracoes
    .map((declaracao) => statementCard(declaracao, data.declaracoes.sintetico))
    .sort((a, b) => a.index - b.index);
  activeCard = undefined;
  pinnedCard = undefined;
  for (const card of statementCards) {
    const row = Math.floor(card.index / DOTS_PER_ROW);
    const group = statementCards.filter((other) => Math.floor(other.index / DOTS_PER_ROW) === row);
    if (group.length > 1) markerNavigation(card, group);
  }
  ui.marks.replaceChildren(...statementCards.map(({ element }) => element));
}

function updateStatement(lives: number, active: boolean): void {
  const selected = active
    ? statementCards.reduce<typeof pinnedCard>((latest, card) => card.index < lives ? card : latest, undefined)
    : undefined;
  if (!selected || (pinnedCard && Math.floor(pinnedCard.index / DOTS_PER_ROW) !== Math.floor(selected.index / DOTS_PER_ROW))) {
    pinnedCard = undefined;
  }
  const current = (pinnedCard ?? selected)?.element;
  if (current === activeCard) return;
  if (activeCard) activeCard.hidden = true;
  if (current) current.hidden = false;
  activeCard = current;
}

function resizeCanvas(): void {
  const ratio = window.devicePixelRatio || 1;
  const width = columnWidth();
  const visible = viewport();
  ui.canvas.style.top = `${visible.top}px`;
  ui.canvas.style.width = `${width}px`;
  ui.canvas.style.height = `${visible.height}px`;
  ui.canvas.width = Math.round(width * ratio);
  ui.canvas.height = Math.round(visible.height * ratio);
  ui.referenceLine.style.top = `${referenceDepth()}px`;
  ui.counter.style.setProperty('--linha-y', `${referenceDepth()}px`);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

// Draws only the dots behind the sticky canvas. `offset` is the canvas top inside the track.
function draw(offset: number): void {
  const visibleHeight = viewport().height;
  const { start, end } = visibleIndexRange(offset, visibleHeight, data.total);
  ctx.clearRect(0, 0, columnWidth(), visibleHeight);
  DOT_ROW_COLORS.forEach((color, colorIndex) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let index = start; index < end; index += 1) {
      const { row, x, y } = dotPosition(index);
      if (row % DOT_ROW_COLORS.length !== colorIndex) continue;
      const cx = x + DOT_RADIUS_PX;
      const cy = y + DOT_RADIUS_PX - offset;
      ctx.moveTo(cx + DOT_RADIUS_PX, cy);
      ctx.arc(cx, cy, DOT_RADIUS_PX, 0, 2 * Math.PI);
    }
    ctx.fill();
  });
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

function fitStatement(trackTop: number): void {
  if (!activeCard) return;
  const visible = viewport();
  const stickyTop = parseFloat(window.getComputedStyle(activeCard).top);
  const cardTop = Math.max(ui.marks.getBoundingClientRect().top, stickyTop);
  const viewportBottom = window.innerWidth <= 640
    ? ui.counter.getBoundingClientRect().top
    : visible.top + visible.height;
  const bottom = Math.min(trackTop + height, viewportBottom);
  activeCard.style.setProperty('--card-space', `${Math.max(0, bottom - cardTop - 16)}px`);
}

// The counter follows the middle of the visible viewport, including mobile browser chrome.
function updateCounter(trackTop: number): void {
  const depth = referenceDepth() - trackTop;
  const active = depth >= 0 && depth <= height;
  ui.counter.toggleAttribute('data-idle', !active);
  ui.referenceLine.classList.toggle('reference-line--on', active);
  const lives = livesAtDepth(depth, data.total);
  updateStatement(lives, active);
  const days = lives > 0 ? dayNumber(data.inicio, dateAtIndex(data.obitos.dias, lives - 1)) : 0;
  ui.lives.textContent = fmtInt(lives);
  ui.days.textContent = fmtDays(days);
  fitStatement(trackTop);
  announce(
    lives > 0
      ? `${fmtInt(lives)} vidas em ${fmtDays(days)}, de ${fmtInt(data.total)}.`
      : `0 vidas, de ${fmtInt(data.total)}.`,
  );
}

function update(): void {
  const trackTop = ui.track.getBoundingClientRect().top;
  const canvasTop = ui.canvas.getBoundingClientRect().top;
  draw(canvasTop - trackTop);
  updateCounter(trackTop);
}

function siteBase(): URL {
  return new URL(import.meta.env.BASE_URL, window.location.origin);
}

function hideShareStatus(): void {
  clearTimeout(shareStatusTimer);
  shareStatusTimer = undefined;
  ui.shareStatus.hidden = true;
  ui.shareStatus.textContent = '';
}

async function requestShare(link: SharedLink): Promise<void> {
  autoscroll.pause();
  hideShareStatus();
  const result = await shareLink(link);
  if (result === 'copied') {
    hideShareStatus();
    ui.shareStatus.textContent = 'Mensagem e link copiados.';
    ui.shareStatus.hidden = false;
    shareStatusTimer = setTimeout(hideShareStatus, SHARE_STATUS_DURATION_MS);
  } else if (result === 'manual') {
    ui.shareMessage.value = `${link.text}\n${link.url}`;
    ui.shareDialog.showModal();
    ui.shareMessage.focus();
    ui.shareMessage.select();
  }
}

function followAnchor(): void {
  let anchor: string;
  try {
    anchor = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return;
  }
  if (!anchor) {
    const id = document.querySelector('[data-initial-statement]')?.getAttribute('data-initial-statement');
    if (id) anchor = statementAnchor(id);
  }
  const card = statementCards.find(({ element }) => element.id === anchor);
  if (!card) return;
  autoscroll.pause();
  pinnedCard = card;
  const trackTop = ui.track.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({
    top: trackTop + anchorY(card.index, data.total) + DOT_RADIUS_PX - referenceDepth(),
    behavior: 'instant',
  });
  update();
}

function updatePlayback(playing: boolean): void {
  ui.btnPlay.setAttribute('aria-pressed', String(playing));
  ui.btnPlay.setAttribute('aria-label', playing ? 'pausar rolagem' : 'rolar automaticamente');
}

function wirePlayback(): void {
  ui.speedSelect.addEventListener('change', () => {
    const multiplier = Number(ui.speedSelect.value);
    if (SPEED_MULTIPLIERS.some((speed) => speed === multiplier)) speedMultiplier = multiplier;
  });

  // Space pauses on keydown before the button click; preserve the intended toggle.
  let playIntent: { wasPlaying: boolean; at: number } | undefined;
  const captureIntent = (): void => {
    playIntent = { wasPlaying: autoscroll.isPlaying(), at: performance.now() };
  };
  ui.btnPlay.addEventListener('pointerdown', captureIntent);
  ui.btnPlay.addEventListener('keydown', (event) => {
    if (!event.repeat) captureIntent();
  });
  ui.btnPlay.addEventListener('click', () => {
    const wasPlaying = playIntent && performance.now() - playIntent.at < 1000
      ? playIntent.wasPlaying
      : autoscroll.isPlaying();
    playIntent = undefined;
    if (wasPlaying) autoscroll.pause();
    else autoscroll.play();
  });
  ui.btnStart.addEventListener('click', () => autoscroll.play());
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
  const resize = () => {
    resizeCanvas();
    update();
  };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', resize);
  window.addEventListener('hashchange', followAnchor);
  ui.btnShare.addEventListener('click', () => {
    const title = 'Memorial do Covid';
    void requestShare({ title, text: shareDescription(title), url: siteBase().href });
  });
  ui.shareClose.addEventListener('click', () => ui.shareDialog.close());
}

function elements(): Elements {
  return {
    track: must('[data-track]'),
    canvas: must('[data-canvas]'),
    marks: must('[data-marks]'),
    weeks: must('[data-weeks]'),
    separators: must('[data-separators]'),
    counter: must('[data-counter]'),
    referenceLine: must('[data-reference-line]'),
    lives: must('[data-counter-lives]'),
    days: must('[data-counter-days]'),
    total: must('[data-counter-total]'),
    announcer: must('[data-announcer]'),
    btnShare: must('#btn-share'),
    shareStatus: must('[data-share-status]'),
    shareDialog: must('#share-dialog'),
    shareMessage: must('#share-message'),
    shareClose: must('#share-close'),
    btnStart: must('#btn-start'),
    btnPlay: must('#btn-play'),
    speedSelect: must('#speed-select'),
    syntheticNotice: must('[data-aviso-sintetico]'),
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
    autoscroll = createAutoscroll({
      getSpeed: () => SPEED_BASE * speedMultiplier,
      onStateChange: updatePlayback,
    });
    wirePlayback();
    wire();
    update();
    followAnchor();
    for (const control of [ui.btnShare, ui.btnStart, ui.btnPlay, ui.speedSelect]) {
      control.disabled = false;
    }
  } catch (error) {
    console.error('Falha ao carregar os dados:', error);
    errorEl.hidden = false;
  }
}
