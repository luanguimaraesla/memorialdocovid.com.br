import {
  DOT_RADIUS_PX, DOT_GAP_PX, DOTS_PER_ROW, LIVES_PER_SEPARATOR, SEPARATOR_ROWS,
  MAX_COLUMN_HEIGHT_PX, WEEK_MARKERS_START,
} from '../config';

export interface Dia {
  data: string;
  acumulado: number;
}

export interface DotPosition {
  row: number;
  col: number;
  x: number;
  y: number;
}

export interface WeekMarker {
  data: string;
  index: number;
  y: number;
}

export interface ThousandMarker {
  lives: number;
  y: number;
}

const ROWS_PER_GROUP = LIVES_PER_SEPARATOR / DOTS_PER_ROW;
const SLOTS_PER_GROUP = ROWS_PER_GROUP + SEPARATOR_ROWS;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function rowPitch(): number {
  return 2 * DOT_RADIUS_PX + DOT_GAP_PX;
}

export function columnWidth(): number {
  return DOTS_PER_ROW * rowPitch() - DOT_GAP_PX;
}

export function separatorHeight(): number {
  return SEPARATOR_ROWS * rowPitch();
}

// x and y are the top-left corner of the dot's square; its center is (x + r, y + r).
export function dotPosition(index: number): DotPosition {
  const row = Math.floor(index / DOTS_PER_ROW);
  const col = index % DOTS_PER_ROW;
  const separators = Math.floor(index / LIVES_PER_SEPARATOR);
  return { row, col, x: col * rowPitch(), y: row * rowPitch() + separators * separatorHeight() };
}

export function columnHeight(total: number): number {
  const height = Math.ceil(total / DOTS_PER_ROW) * rowPitch()
    + Math.floor(total / LIVES_PER_SEPARATOR) * separatorHeight();
  if (height > MAX_COLUMN_HEIGHT_PX) {
    throw new Error(`Coluna de ${height} px excede o limite de ${MAX_COLUMN_HEIGHT_PX} px`);
  }
  return height;
}

export function thousandMarkers(total: number): ThousandMarker[] {
  return Array.from({ length: Math.floor(total / LIVES_PER_SEPARATOR) }, (_, group) => ({
    lives: (group + 1) * LIVES_PER_SEPARATOR,
    y: ((group + 1) * ROWS_PER_GROUP + group * SEPARATOR_ROWS) * rowPitch(),
  }));
}

// Separator slots take up space without adding lives.
function dotRowsBeforeSlot(slot: number): number {
  const group = Math.floor(slot / SLOTS_PER_GROUP);
  return group * ROWS_PER_GROUP + Math.min(slot % SLOTS_PER_GROUP, ROWS_PER_GROUP);
}

// Lives reached when a reference line sits `depth` pixels below the column top.
// Touching a row counts the whole row.
export function livesAtDepth(depth: number, total: number): number {
  if (depth < 0) return 0;
  const reachedSlots = Math.floor(depth / rowPitch()) + 1;
  return clamp(dotRowsBeforeSlot(reachedSlots) * DOTS_PER_ROW, 0, total);
}

export function dayNumber(start: string, date: string): number {
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
}

export function firstIndexOfDay(dias: Dia[], k: number): number {
  return k > 0 ? dias[k - 1].acumulado : 0;
}

// The day's last dot, where the column reaches that day's official total.
export function lastIndexOfDay(dias: Dia[], k: number): number {
  return Math.max(0, dias[k].acumulado - 1);
}

// First day whose date is on or after `data`.
export function dayIndexOf(dias: Dia[], data: string): number {
  let low = 0;
  let high = dias.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (dias[mid].data < data) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function dateAtIndex(dias: Dia[], index: number): string {
  const total = dias.length > 0 ? dias[dias.length - 1].acumulado : 0;
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new RangeError(`Índice fora da série: ${index}`);
  }
  let low = 0;
  let high = dias.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (dias[mid].acumulado > index) high = mid;
    else low = mid + 1;
  }
  return dias[low].data;
}

// Row y of the dot at `index`, clamped to the last dot so day-end anchors stay inside the column.
export function anchorY(index: number, total: number): number {
  return dotPosition(clamp(index, 0, Math.max(0, total - 1))).y;
}

function weekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

// Monday labels anchor to each week's first death. Empty weeks get no marker.
export function weekMarkers(dias: Dia[]): WeekMarker[] {
  const markers: WeekMarker[] = [];
  let lastWeek = '';
  dias.forEach((dia, k) => {
    const index = firstIndexOfDay(dias, k);
    if (dia.acumulado <= index) return;
    const week = weekStart(dia.data);
    if (week < WEEK_MARKERS_START || week === lastWeek) return;
    lastWeek = week;
    markers.push({ data: week, index, y: dotPosition(index).y });
  });
  return markers;
}
