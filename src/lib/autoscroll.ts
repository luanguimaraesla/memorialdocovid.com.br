import { SECONDS_BETWEEN_MILESTONES } from '../config';
import { pathDuration } from './journey';
import type { Path } from './journey';

interface AutoscrollOptions {
  // Plans the motion from the current position. Nothing to plan leaves the page still.
  plan: (from: number) => Path | undefined;
  // Reports each milestone reached after the starting one.
  onWaypoint: (index: number) => void;
  onStateChange: (playing: boolean) => void;
}

export interface Autoscroll {
  play(): void;
  pause(): void;
  isPlaying(): boolean;
}

const MAX_FRAME_SECONDS = 0.1;
const EPSILON = 1e-9;

export function createAutoscroll(options: AutoscrollOptions): Autoscroll {
  let playing = false;
  let rafId = 0;
  let lastTime = 0;
  let path: Path | undefined;
  let elapsed = 0;
  let reached = 0;

  function plan(): boolean {
    const planned = options.plan(window.scrollY);
    if (!planned || planned.legs < 1) return false;
    path = planned;
    elapsed = 0;
    reached = 0;
    return true;
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    options.onStateChange(false);
  }

  // The leg follows its own plan and never reads the page position back: phones apply
  // programmatic scrolls asynchronously, so window.scrollY lags behind the last request.
  // Whole pixels keep text and dots from shimmering between device pixels.
  function frame(now: number): void {
    if (!playing || !path) return;
    const seconds = Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS);
    lastTime = now;
    elapsed += seconds;
    window.scrollTo({ top: Math.round(path.positionAt(elapsed)), behavior: 'instant' });
    const passed = Math.min(path.legs, Math.floor(elapsed / SECONDS_BETWEEN_MILESTONES + EPSILON));
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
