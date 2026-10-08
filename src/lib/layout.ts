import { DOT_RADIUS_PX, DOT_GAP_PX, DOTS_PER_ROW, MAX_COLUMN_HEIGHT_PX } from '../config';

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

export interface IndexRange {
  start: number;
  end: number;
}

export interface MonthMarker {
  data: string;
  index: number;
  y: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function rowPitch(): number {
  return 2 * DOT_RADIUS_PX + DOT_GAP_PX;
}

export function columnWidth(): number {
  return DOTS_PER_ROW * rowPitch() - DOT_GAP_PX;
}

// x and y are the top-left corner of the dot's square; its center is (x + r, y + r).
export function dotPosition(index: number): DotPosition {
  const row = Math.floor(index / DOTS_PER_ROW);
  const col = index % DOTS_PER_ROW;
  return { row, col, x: col * rowPitch(), y: row * rowPitch() };
}

export function columnHeight(total: number): number {
  const height = Math.ceil(total / DOTS_PER_ROW) * rowPitch();
  if (height > MAX_COLUMN_HEIGHT_PX) {
    throw new Error(`Coluna de ${height} px excede o limite de ${MAX_COLUMN_HEIGHT_PX} px`);
  }
  return height;
}

// Lives reached when a reference line sits `depth` pixels below the column top.
// Touching a row counts the whole row.
export function livesAtDepth(depth: number, total: number): number {
  if (depth < 0) return 0;
  return clamp((Math.floor(depth / rowPitch()) + 1) * DOTS_PER_ROW, 0, total);
}

// Dots whose rows intersect [top, top + height). The end index is exclusive.
export function visibleIndexRange(top: number, height: number, total: number): IndexRange {
  const bottom = top + height;
  if (height <= 0 || bottom <= 0) return { start: 0, end: 0 };
  const firstRow = Math.max(0, Math.floor(top / rowPitch()));
  const lastRow = Math.ceil(bottom / rowPitch()) - 1;
  return {
    start: clamp(firstRow * DOTS_PER_ROW, 0, total),
    end: clamp((lastRow + 1) * DOTS_PER_ROW, 0, total),
  };
}

export function firstIndexOfDay(dias: Dia[], k: number): number {
  return k > 0 ? dias[k - 1].acumulado : 0;
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

// The first day with deaths in each month. Months without deaths get no marker.
export function monthMarkers(dias: Dia[]): MonthMarker[] {
  const markers: MonthMarker[] = [];
  let lastMonth = '';
  dias.forEach((dia, k) => {
    const index = firstIndexOfDay(dias, k);
    const month = dia.data.slice(0, 7);
    if (dia.acumulado <= index || month === lastMonth) return;
    lastMonth = month;
    markers.push({ data: dia.data, index, y: dotPosition(index).y });
  });
  return markers;
}
