import { ANNOUNCE_INTERVAL_MS, SHARE_STATUS_DURATION_MS, DOT_RADIUS_PX } from '../config';
import {
  anchorY, columnHeight, columnWidth, dateAtIndex, dayIndexOf, dayNumber, dotPosition, firstIndexOfDay,
  livesAtDepth, rowPitch, separatorHeight, weekMarkers, thousandMarkers, visibleIndexRange,
} from './layout';
import { continuousPath, guidedPath } from './journey';
import type { Waypoint } from './journey';
import { loadPageData } from './state';
import type { Declaracao, PageData } from './state';
import { createAutoscroll } from './autoscroll';
import type { Autoscroll } from './autoscroll';
import { startAudio } from './audio';
import { shareDescription, shareLink, statementAnchor, statementUrl } from './sharing';
import type { SharedLink } from './sharing';
import { archiveHeadlines, archiveSources } from './archive';

const DOT_ROW_COLORS = ['#e8e4dc', '#cbc7bf'];
const CARD_GAP_PX = 24;
const MARKER_GAP_PX = 24;
// The rotated, scissor-cut card edge can reveal a few pixels below its layout box.
const CARD_EDGE_PX = 8;
// A thousand separator this close below a news marker gives its slot to the marker.
const NEAR_SEPARATOR_PX = 160;
const SAME_POSITION_PX = 2;
const WEEK_LABEL_ROWS = 4;
const MEMORIAL_TITLE = 'Memorial do Covid';

interface Elements {
  track: HTMLElement;
  canvas: HTMLCanvasElement;
  marks: HTMLElement;
  floating: HTMLElement;
  weeks: HTMLElement;
  separators: HTMLElement;
  newsMarkers: HTMLElement;
  counter: HTMLElement;
  referenceLine: HTMLElement;
  lives: HTMLElement;
  days: HTMLElement;
  announcer: HTMLElement;
  shareStatus: HTMLElement;
  shareDialog: HTMLDialogElement;
  shareMessage: HTMLTextAreaElement;
  shareClose: HTMLButtonElement;
  btnStart: HTMLButtonElement;
  btnPlay: HTMLButtonElement;
  btnShare: HTMLButtonElement;
  btnMode: HTMLButtonElement;
  playLabel: HTMLElement;
  playback: HTMLElement;
  firstIntro: HTMLElement;
  secondIntro: HTMLElement;
  syntheticNotice: HTMLElement;
  closing: HTMLElement;
  closingShare: HTMLButtonElement;
}

interface StatementCard {
  index: number;
  y: number;
  element: HTMLElement;
  marker: HTMLElement;
  markerCount: HTMLElement;
  record: Declaracao;
}

// A label fixed to a position in the column: a thousand separator or a weekly date.
interface ColumnLabel {
  y: number;
  element: HTMLElement;
}

// A milestone where the guided journey stops: an introduction or a news card.
interface Stop {
  element: HTMLElement;
  title: string;
  url: string;
  card?: StatementCard;
}

let data: PageData;
let ui: Elements;
let ctx: CanvasRenderingContext2D;
let height = 0;
let ticking = false;
let lastAnnounceAt = -Infinity;
let pendingAnnounce: ReturnType<typeof setTimeout> | undefined;
let announcement = '';
let statementCards: StatementCard[] = [];
let thousandLabels: ColumnLabel[] = [];
let weekLabels: ColumnLabel[] = [];
let stops: Stop[] = [];
let active = -1;
let plannedStops: number[] = [];
let floatingCard: StatementCard | undefined;
let autoscroll: Autoscroll;
let continuous = false;
let started = false;
let shareStatusTimer: ReturnType<typeof setTimeout> | undefined;

const fmtInt = (value: number): string => value.toLocaleString('pt-BR');
const fmtDays = (value: number): string => `${fmtInt(value)} ${value === 1 ? 'dia' : 'dias'}`;

function fmtDate(iso: string): string {
  return iso.split('-').reverse().join('/');
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
  const visible = viewport();
  return visible.top + visible.height / 2;
}

function readingTop(): number {
  const visible = viewport();
  return visible.top + Math.max(72, Math.min(96, visible.height * 0.1));
}

function maxScroll(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

// Scroll position that brings a milestone to the reading line. Cards use the column
// geometry, so the positions hold while continuous mode hides them.
function stopPositions(): number[] {
  const trackTop = ui.track.getBoundingClientRect().top + window.scrollY;
  return stops.map(stop => {
    if (stop.card) return trackTop + stop.card.y - readingTop();
    const top = stop.element.getBoundingClientRect().top + window.scrollY;
    // The closing fills the screen, so it stops at the top instead of the reading line.
    return stop.element === ui.closing ? top : top - readingTop();
  });
}

function shareButton(title: string, url: string): HTMLButtonElement {
  const button = create('button', 'declaracao__compartilhar');
  button.type = 'button';
  button.setAttribute('aria-label', `Compartilhar: ${title}`);
  button.addEventListener('click', () => { void requestShare({ title, text: shareDescription(title), url }); });
  return button;
}

function statementHeader(record: Declaracao): HTMLElement {
  const header = create('header', 'declaracao__cabecalho');
  const dateline = create('div', 'declaracao__linha');
  const title = record.subtitulo ?? MEMORIAL_TITLE;
  dateline.append(dateElement(record.data, 'declaracao__data'), shareButton(title, statementUrl(record.id, siteBase())));
  header.append(dateline);
  if (record.subtitulo) header.append(create('h3', 'declaracao__subtitulo', record.subtitulo));
  const credit = record.acervo?.veiculo ?? record.autor;
  if (credit) header.append(create('p', 'declaracao__autor', credit));
  return header;
}

function livesLabel(lives: number, caption: string, className: string): HTMLElement {
  const label = create('p', className);
  label.append(create('strong', 'memorial__separator-number', fmtInt(lives)), create('span', 'memorial__separator-caption', caption));
  return label;
}

function statementCard(record: Declaracao): StatementCard {
  const index = firstIndexOfDay(data.obitos.dias, dayIndexOf(data.obitos.dias, record.data));
  const marker = livesLabel(0, 'vidas', 'memorial__separator memorial__separator--noticia');
  const markerCount = marker.querySelector<HTMLElement>('strong')!;
  const element = create('article', 'declaracao');
  element.id = statementAnchor(record.id);
  element.setAttribute('tabindex', '-1');
  element.setAttribute('data-tipo', record.tipo ?? 'declaracao');
  const header = statementHeader(record);
  if (data.declaracoes.sintetico) header.prepend(create('p', 'declaracao__selo', 'exemplo sintético'));
  element.append(header);
  const hasImage = Boolean(record.acervo?.documentos.length);
  if (hasImage) element.append(archiveHeadlines(record.acervo!));
  else element.append(create(record.tipo === 'noticia' ? 'p' : 'blockquote', 'declaracao__texto', record.texto));
  const more = create('details', 'declaracao__more');
  more.append(create('summary', '', 'Leia mais'));
  if (hasImage) more.append(create(record.tipo === 'noticia' ? 'p' : 'blockquote', 'declaracao__texto', record.texto));
  if (record.contexto) more.append(create('p', 'declaracao__contexto', record.contexto));
  if (record.tipo === 'noticia') more.append(create('p', 'declaracao__contexto', 'Resumo editorial de um marco histórico, não uma citação literal.'));
  if (record.acervo) more.append(archiveSources(record.acervo));
  const references = create('a', 'declaracao__fontes', 'Fontes e contexto completos');
  references.href = `${import.meta.env.BASE_URL}referencias#${encodeURIComponent(statementAnchor(record.id))}`;
  more.append(references);
  element.append(more);
  return { index, y: anchorY(index, data.total), element, marker, markerCount, record };
}

function introStop(element: HTMLElement): Stop {
  const title = element.querySelector('h2')?.textContent ?? MEMORIAL_TITLE;
  return { element, title, url: `${siteBase().href}#${element.id}` };
}

function buildMarks(): void {
  height = columnHeight(data.total);
  ui.track.style.height = `${height}px`;
  statementCards = data.declaracoes.declaracoes.map(statementCard).sort((a, b) => a.index - b.index);
  for (const card of statementCards) card.element.style.top = `${card.y}px`;
  ui.marks.replaceChildren(...statementCards.map(card => card.element));
  ui.newsMarkers.replaceChildren(...statementCards.map(card => card.marker));
  stops = [
    introStop(ui.firstIntro),
    introStop(ui.secondIntro),
    ...statementCards.map(card => ({
      element: card.element,
      title: card.record.subtitulo ?? MEMORIAL_TITLE,
      url: statementUrl(card.record.id, siteBase()),
      card,
    })),
    { element: ui.closing, title: MEMORIAL_TITLE, url: siteBase().href },
  ];
  // Weeks with few deaths sit a row or two apart; labels closer than that would overlap.
  let lastWeek = -Infinity;
  const spaced = weekMarkers(data.obitos.dias).filter(marker => {
    if (marker.y - lastWeek < WEEK_LABEL_ROWS * rowPitch()) return false;
    lastWeek = marker.y;
    return true;
  });
  weekLabels = spaced.map(marker => {
    const element = create('p', 'marco-semana');
    element.style.top = `${marker.y}px`;
    element.append(dateElement(marker.data, 'marco-semana__data'));
    return { y: marker.y, element };
  });
  ui.weeks.replaceChildren(...weekLabels.map(label => label.element));
  thousandLabels = thousandMarkers(data.total).map(marker => {
    const element = livesLabel(marker.lives, 'vidas', 'memorial__separator');
    element.style.top = `${marker.y}px`;
    element.setAttribute('data-lives', String(marker.lives));
    return { y: marker.y, element };
  });
  ui.separators.replaceChildren(...thousandLabels.map(label => label.element));
}

interface MarkerPlacement {
  top: number;
  height: number;
  replaces?: ColumnLabel;
}

// Puts the lives marker MARKER_GAP_PX below the card, in the gap between two dot rows, so it
// covers whole rows. A nearby thousand separator gives its reserved slot to the marker, so
// the slot never shows as an empty band: the marker takes the slot, starts inside it and
// grows to the next row gap, or starts right after it when the slot ends close to the card.
function placeMarker(card: StatementCard): MarkerPlacement {
  const pitch = rowPitch();
  const band = separatorHeight();
  const cardBottom = card.y + card.element.offsetHeight;
  const minimum = cardBottom + MARKER_GAP_PX;
  const aligned = Math.ceil(minimum / pitch) * pitch - 1;
  const slot = thousandLabels.find(label => (
    label.y + band > cardBottom - CARD_EDGE_PX && label.y < aligned + NEAR_SEPARATOR_PX
  ));
  if (!slot) return { top: aligned, height: band };
  const slotEnd = slot.y + band;
  if (slot.y >= minimum) return { top: slot.y, height: band, replaces: slot };
  if (slotEnd > minimum) {
    const rowsAfter = Math.ceil((minimum - slot.y + 1) / pitch);
    return { top: minimum, height: slotEnd + rowsAfter * pitch - 1 - minimum, replaces: slot };
  }
  const top = slotEnd - cardBottom >= MARKER_GAP_PX / 2 ? slotEnd - 1 : aligned;
  return { top, height: band, replaces: slot };
}

// Cards keep their own dot rows. When neighbors would overlap the current card and its
// lives marker, only the current one shows; the others appear once they no longer collide.
function visibleCards(): Set<StatementCard> {
  const shown = new Set<StatementCard>();
  const bottom = (card: StatementCard) => {
    const marker = placeMarker(card);
    return marker.top + marker.height;
  };
  const current = stops[active]?.card;
  const pivot = current ? statementCards.indexOf(current) : 0;
  let floor = -Infinity;
  for (const card of statementCards.slice(pivot)) {
    if (card !== current && card.y < floor) continue;
    shown.add(card);
    floor = bottom(card) + CARD_GAP_PX;
  }
  let ceiling = current ? current.y - CARD_GAP_PX : Infinity;
  for (const card of statementCards.slice(0, pivot).reverse()) {
    if (bottom(card) > ceiling) continue;
    shown.add(card);
    ceiling = card.y - CARD_GAP_PX;
  }
  return shown;
}

// Places a lives marker under each visible card, skips the thousand separator it replaces
// and hides weekly dates the card would cover. Continuous mode shows neither cards nor
// markers, so every label returns.
function layoutCards(): void {
  ui.newsMarkers.hidden = continuous;
  const shown = continuous ? new Set<StatementCard>() : visibleCards();
  const replaced = new Set<ColumnLabel>();
  const covered: [number, number][] = [];
  for (const card of statementCards) {
    const visible = shown.has(card);
    if (!continuous) card.element.classList.toggle('declaracao--oculta', !visible);
    card.marker.classList.toggle('memorial__separator--oculto', !visible);
    if (!visible) continue;
    const marker = placeMarker(card);
    card.marker.style.top = `${marker.top}px`;
    card.marker.style.height = `${marker.height}px`;
    // Like a thousand separator, the marker counts the lives above it, so it always follows
    // the column order; in a separator slot that is exactly the separator's own total.
    card.markerCount.textContent = fmtInt(livesAtDepth(marker.top, data.total));
    if (marker.replaces) replaced.add(marker.replaces);
    covered.push([card.y - CARD_GAP_PX / 2, marker.top + marker.height + CARD_GAP_PX / 2]);
  }
  for (const label of thousandLabels) {
    label.element.classList.toggle('memorial__separator--oculto', replaced.has(label));
  }
  for (const label of weekLabels) {
    const bottom = label.y + label.element.offsetHeight;
    label.element.classList.toggle('marco-semana--oculto', covered.some(([top, end]) => label.y < end && bottom > top));
  }
}

function setActive(index: number): void {
  if (index === active) return;
  active = index;
  const stop = stops[active];
  ui.btnShare.setAttribute('aria-label', stop ? `Compartilhar: ${stop.title}` : 'Compartilhar o memorial');
  layoutCards();
}

// Follows the milestone reached by position. Milestones sharing a position keep the one
// already selected, so Continuar can step through them without moving the page.
function syncActive(): void {
  const positions = stopPositions();
  let reached = -1;
  positions.forEach((y, index) => { if (y <= window.scrollY + SAME_POSITION_PX) reached = index; });
  if (reached < 0) return setActive(-1);
  const samePosition = (index: number) => Math.abs(positions[index] - positions[reached]) <= SAME_POSITION_PX;
  if (active >= 0 && samePosition(active)) return;
  setActive(positions.findIndex((_, index) => samePosition(index)));
}

function compactCard(card: StatementCard): HTMLElement {
  const element = create('article', 'declaracao declaracao--compacta');
  element.append(statementHeader(card.record));
  const read = create('button', 'declaracao__read', 'Leia mais');
  read.type = 'button';
  read.addEventListener('click', () => {
    autoscroll.pause();
    setMode(false);
    goTo(stops.findIndex(stop => stop.card === card));
    const more = card.element.querySelector<HTMLDetailsElement>('details');
    if (more) more.open = true;
  });
  element.append(read);
  return element;
}

function updateFloating(trackTop: number): void {
  const inTrack = readingTop() - trackTop <= height;
  const current = continuous && inTrack ? stops[active]?.card : undefined;
  ui.floating.hidden = !current;
  if (current === floatingCard) return;
  floatingCard = current;
  ui.floating.replaceChildren(...(current ? [compactCard(current)] : []));
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
  ui.floating.style.top = `${readingTop()}px`;
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
    for (let index = start; index < end; index++) {
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

// The counter follows the middle of the visible viewport, including mobile browser chrome.
function updateCounter(trackTop: number): void {
  const depth = referenceDepth() - trackTop;
  const inTrack = depth >= 0 && depth <= height;
  ui.counter.toggleAttribute('data-idle', !inTrack);
  ui.referenceLine.classList.toggle('reference-line--on', inTrack);
  const lives = livesAtDepth(depth, data.total);
  const days = lives > 0 ? dayNumber(data.inicio, dateAtIndex(data.obitos.dias, lives - 1)) : 0;
  ui.lives.textContent = fmtInt(lives);
  ui.days.textContent = fmtDays(days);
  announce(`${fmtInt(lives)} vidas perdidas. ${fmtDays(days)} desde o primeiro registro.`);
}

function update(): void {
  const trackTop = ui.track.getBoundingClientRect().top;
  draw(ui.canvas.getBoundingClientRect().top - trackTop);
  updateCounter(trackTop);
  updateFloating(trackTop);
  const closingReached = ui.closing.getBoundingClientRect().top <= viewport().height / 2;
  ui.playback.hidden = closingReached || (!started && window.scrollY < 120);
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

function shareCurrent(): void {
  const stop = stops[active];
  const title = stop?.title ?? MEMORIAL_TITLE;
  void requestShare({ title, text: shareDescription(title), url: stop?.url ?? siteBase().href });
}

function goTo(index: number): void {
  window.scrollTo({ top: stopPositions()[index], behavior: 'instant' });
  setActive(index);
  update();
  stops[index].element.focus({ preventScroll: true });
}

function followAnchor(): void {
  let anchor: string;
  try { anchor = decodeURIComponent(window.location.hash.slice(1)); }
  catch { return; }
  if (!anchor) {
    const id = document.querySelector('[data-initial-statement]')?.getAttribute('data-initial-statement');
    if (id) anchor = statementAnchor(id);
  }
  const index = stops.findIndex(stop => stop.element.id === anchor);
  if (index < 0) return;
  autoscroll.pause();
  setMode(false);
  goTo(index);
}

function updatePlayback(playing: boolean): void {
  ui.btnPlay.setAttribute('aria-pressed', String(playing));
  ui.btnPlay.setAttribute('aria-label', playing ? 'Pausar o percurso' : 'Continuar o percurso');
  ui.playLabel.textContent = playing ? 'Pausar' : 'Continuar';
}

// Every milestone is exactly one interval after the previous one. Guided mode travels to
// the next milestone and rests there; continuous mode passes all of them and rests on the
// closing message.
function plan(from: number): Waypoint[] | undefined {
  syncActive();
  const positions = stopPositions();
  const bottom = maxScroll();
  const ahead = stops.map((_, index) => index).slice(active + 1);
  plannedStops = continuous ? [active, ...(ahead.length ? ahead : [-1])] : [active, ahead[0] ?? -1];
  const targets = plannedStops.slice(1).map(index => (index < 0 ? bottom : positions[index]));
  if (targets.at(-1)! <= from + 1) return undefined;
  return continuous ? continuousPath([from, ...targets]) : guidedPath(from, targets[0]);
}

function reachWaypoint(index: number): void {
  const stop = plannedStops[index];
  if (stop < 0) return;
  setActive(stop);
  update();
}

function setMode(value: boolean): void {
  continuous = value;
  ui.btnMode.setAttribute('aria-pressed', String(value));
  ui.btnMode.setAttribute('aria-label', value ? 'Voltar às pausas em cada marco' : 'Ativar modo contínuo, sem pausas nos marcos');
  ui.marks.hidden = value;
  floatingCard = undefined;
  layoutCards();
  update();
  if (autoscroll.isPlaying()) {
    autoscroll.pause();
    autoscroll.play();
  }
}

function resume(): void {
  if (!started) void startAudio();
  started = true;
  ui.playback.hidden = false;
  if (!continuous) {
    syncActive();
    const next = active + 1;
    // A milestone on the same dot row needs no travel: show it in place.
    if (next < stops.length && stopPositions()[next] <= window.scrollY + SAME_POSITION_PX) {
      setActive(next);
      return;
    }
  }
  autoscroll.play();
}

function wirePlayback(): void {
  ui.btnPlay.addEventListener('click', () => {
    if (autoscroll.isPlaying()) autoscroll.pause();
    else resume();
  });
  ui.btnStart.addEventListener('click', resume);
  ui.btnShare.addEventListener('click', shareCurrent);
  ui.btnMode.addEventListener('click', () => setMode(!continuous));
}

function wire(): void {
  window.addEventListener('click', event => {
    if ((event.target as Element | null)?.closest?.('[data-scroll-control]')) return;
    autoscroll.pause();
  });
  for (const type of ['wheel', 'touchmove']) window.addEventListener(type, () => {
    if (!continuous) autoscroll.pause();
  }, { passive: true });
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      if (!autoscroll.isPlaying()) syncActive();
      update();
      ticking = false;
    });
  }, { passive: true });
  const resize = () => { resizeCanvas(); layoutCards(); update(); };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', resize);
  window.addEventListener('hashchange', followAnchor);
  // Opening Leia mais or loading a capture changes card heights.
  ui.marks.addEventListener('toggle', layoutCards, true);
  ui.marks.addEventListener('load', layoutCards, true);
  ui.shareClose.addEventListener('click', () => ui.shareDialog.close());
  ui.closingShare.addEventListener('click', () => {
    void requestShare({ title: MEMORIAL_TITLE, text: shareDescription(MEMORIAL_TITLE), url: siteBase().href });
  });
}

function elements(): Elements {
  return {
    track: must('[data-track]'), canvas: must('[data-canvas]'), marks: must('[data-marks]'),
    floating: must('[data-floating]'), weeks: must('[data-weeks]'), separators: must('[data-separators]'),
    newsMarkers: must('[data-news-markers]'),
    counter: must('[data-counter]'), referenceLine: must('[data-reference-line]'),
    lives: must('[data-counter-lives]'), days: must('[data-counter-days]'), announcer: must('[data-announcer]'),
    shareStatus: must('[data-share-status]'), shareDialog: must('#share-dialog'),
    shareMessage: must('#share-message'), shareClose: must('#share-close'),
    btnStart: must('#btn-start'), btnPlay: must('#btn-play'), btnShare: must('#btn-share'), btnMode: must('#btn-mode'),
    playLabel: must('[data-play-label]'), playback: must('[data-playback]'),
    firstIntro: must('[data-intro-first]'), secondIntro: must('[data-intro-second]'),
    syntheticNotice: must('[data-aviso-sintetico]'),
    closing: must('[data-closing]'), closingShare: must('[data-share-closing]'),
  };
}

export async function boot(): Promise<void> {
  const errorEl = must<HTMLElement>('#load-error');
  try {
    ui = elements();
    data = await loadPageData();
    const context = ui.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D indisponível');
    ctx = context;
    ui.syntheticNotice.hidden = !data.declaracoes.sintetico;
    buildMarks();
    resizeCanvas();
    autoscroll = createAutoscroll({ plan, onWaypoint: reachWaypoint, onStateChange: updatePlayback });
    wirePlayback();
    wire();
    layoutCards();
    syncActive();
    update();
    followAnchor();
    for (const control of [ui.btnStart, ui.btnPlay, ui.btnShare, ui.btnMode]) control.disabled = false;
  } catch (error) {
    console.error('Falha ao carregar os dados:', error);
    errorEl.hidden = false;
  }
}
