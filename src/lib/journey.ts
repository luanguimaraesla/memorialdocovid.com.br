import { SECONDS_BETWEEN_MILESTONES } from '../config';

// A scroll position and the speed, in px/s, at which the journey passes it.
// Consecutive waypoints are exactly one milestone interval apart.
export interface Waypoint {
  y: number;
  speed: number;
}

// Leaves `from` at the segment's average speed and comes to rest on `to`.
export function guidedPath(from: number, to: number): Waypoint[] {
  return [{ y: from, speed: (to - from) / SECONDS_BETWEEN_MILESTONES }, { y: to, speed: 0 }];
}

// Passes every position without stopping and comes to rest on the last one. The speed at
// each milestone is the harmonic mean of the neighboring segment averages, which keeps the
// motion monotonic: it never overshoots a milestone or scrolls back.
export function continuousPath(positions: number[]): Waypoint[] {
  const averages = positions.slice(1).map((y, index) => (y - positions[index]) / SECONDS_BETWEEN_MILESTONES);
  return positions.map((y, index) => {
    const before = averages[index - 1];
    const after = averages[index];
    if (after === undefined) return { y, speed: 0 };
    if (before === undefined) return { y, speed: after };
    return { y, speed: before > 0 && after > 0 ? (2 * before * after) / (before + after) : 0 };
  });
}

export function pathDuration(path: Waypoint[]): number {
  return Math.max(0, path.length - 1) * SECONDS_BETWEEN_MILESTONES;
}

// Cubic Hermite interpolation between the waypoints around `seconds`. Every multiple of the
// interval lands exactly on its waypoint, despite floating-point drift in `seconds`.
export function positionAt(path: Waypoint[], seconds: number): number {
  const interval = SECONDS_BETWEEN_MILESTONES;
  const last = path.length - 1;
  const legs = Math.min(last, Math.max(0, seconds / interval));
  const nearest = Math.round(legs);
  if (Math.abs(legs - nearest) < 1e-9) return path[nearest].y;
  const index = Math.floor(legs);
  const u = legs - index;
  const [a, b] = [path[index], path[index + 1]];
  return (2 * u ** 3 - 3 * u ** 2 + 1) * a.y
    + (u ** 3 - 2 * u ** 2 + u) * a.speed * interval
    + (3 * u ** 2 - 2 * u ** 3) * b.y
    + (u ** 3 - u ** 2) * b.speed * interval;
}
