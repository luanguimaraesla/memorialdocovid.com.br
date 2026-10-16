import { SECONDS_BETWEEN_MILESTONES } from '../config';
import { pathDuration, positionAt } from './journey';
import type { Waypoint } from './journey';

interface AutoscrollOptions {
  // Plans the motion from the current position. Nothing to plan leaves the page still.
  plan: (from: number) => Waypoint[] | undefined;
  // Reports each waypoint reached after the starting one.
  onWaypoint: (index: number) => void;
  onStateChange: (playing: boolean) => void;
}

export interface Autoscroll {
  play(): void;
  pause(): void;
  isPlaying(): boolean;
}

const MAX_FRAME_SECONDS = 0.1;
const DRIFT_TOLERANCE_PX = 2;
const EPSILON = 1e-9;

export function createAutoscroll(options: AutoscrollOptions): Autoscroll {
  let playing = false;
  let rafId = 0;
  let lastTime = 0;
  let path: Waypoint[] = [];
  let elapsed = 0;
  let reached = 0;
  let expectedY = 0;

  function plan(): boolean {
    const planned = options.plan(window.scrollY);
    if (!planned || planned.length < 2) return false;
    path = planned;
    elapsed = 0;
    reached = 0;
    expectedY = window.scrollY;
    return true;
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    options.onStateChange(false);
  }

  function frame(now: number): void {
    if (!playing) return;
    const seconds = Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS);
    lastTime = now;
    // Someone else moved the page: follow a new plan from where it is now.
    if (Math.abs(window.scrollY - expectedY) > DRIFT_TOLERANCE_PX && !plan()) {
      pause();
      return;
    }
    elapsed += seconds;
    window.scrollTo({ top: positionAt(path, elapsed), behavior: 'instant' });
    expectedY = window.scrollY;
    const passed = Math.min(path.length - 1, Math.floor(elapsed / SECONDS_BETWEEN_MILESTONES + EPSILON));
    while (reached < passed) options.onWaypoint(++reached);
    if (elapsed + EPSILON >= pathDuration(path)) {
      pause();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function play(): void {
    if (playing || !plan()) return;
    playing = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
    options.onStateChange(true);
  }

  return { play, pause, isPlaying: () => playing };
}
