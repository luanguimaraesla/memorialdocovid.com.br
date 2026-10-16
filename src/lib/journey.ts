import { SECONDS_BETWEEN_MILESTONES } from '../config';

// Share of a guided leg spent speeding up, and again braking; the rest runs at full speed.
// A short, firm brake lands each milestone instead of letting it creep into place.
export const RAMP_SHARE = 0.15;

// A planned motion that reaches one milestone every interval.
export interface Path {
  legs: number;
  positionAt(seconds: number): number;
}

export function pathDuration(path: Path): number {
  return path.legs * SECONDS_BETWEEN_MILESTONES;
}

// Speeds up from rest, runs at full speed and brakes to rest on `to`, all within one interval.
export function guidedPath(from: number, to: number): Path {
  const peak = 1 / (1 - RAMP_SHARE);
  return {
    legs: 1,
    positionAt(seconds) {
      const u = seconds / SECONDS_BETWEEN_MILESTONES;
      if (u <= 0) return from;
      if (u >= 1) return to;
      const share = u < RAMP_SHARE ? (peak * u * u) / (2 * RAMP_SHARE)
        : u > 1 - RAMP_SHARE ? 1 - (peak * (1 - u) ** 2) / (2 * RAMP_SHARE)
        : peak * (u - RAMP_SHARE / 2);
      return from + (to - from) * share;
    },
  };
}

// Speed, in px/s, at which the continuous journey passes each position. It is the harmonic
// mean of the neighboring leg averages, which keeps the motion monotonic: it never overshoots
// a milestone or scrolls back. The journey leaves at the first leg's average and ends at rest.
export function milestoneSpeeds(positions: number[]): number[] {
  const averages = positions.slice(1).map((y, index) => (y - positions[index]) / SECONDS_BETWEEN_MILESTONES);
  return positions.map((_, index) => {
    const before = averages[index - 1];
    const after = averages[index];
    if (after === undefined) return 0;
    if (before === undefined) return after;
    return before > 0 && after > 0 ? (2 * before * after) / (before + after) : 0;
  });
}

// Passes every position without stopping, one per interval, and comes to rest on the last.
export function continuousPath(positions: number[]): Path {
  const interval = SECONDS_BETWEEN_MILESTONES;
  const speeds = milestoneSpeeds(positions);
  const last = positions.length - 1;
  return {
    legs: last,
    // Cubic Hermite interpolation between the positions around `seconds`. Every multiple of
    // the interval lands exactly on its position, despite floating-point drift in `seconds`.
    positionAt(seconds) {
      const legs = Math.min(last, Math.max(0, seconds / interval));
      const nearest = Math.round(legs);
      if (Math.abs(legs - nearest) < 1e-9) return positions[nearest];
      const index = Math.floor(legs);
      const u = legs - index;
      return (2 * u ** 3 - 3 * u ** 2 + 1) * positions[index]
        + (u ** 3 - 2 * u ** 2 + u) * speeds[index] * interval
        + (3 * u ** 2 - 2 * u ** 3) * positions[index + 1]
        + (u ** 3 - u ** 2) * speeds[index + 1] * interval;
    },
  };
}
