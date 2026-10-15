interface AutoscrollOptions {
  getSpeed: () => number;
  onStateChange: (playing: boolean) => void;
}

export interface Autoscroll {
  play(): void;
  pause(): void;
  isPlaying(): boolean;
}

const TAKEOVER_UP_PX = 200;
const PAUSE_KEYS = new Set([
  ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
]);

// Playback starts only on request. Manual scroll input pauses it; taps do not.
export function createAutoscroll(options: AutoscrollOptions): Autoscroll {
  let playing = false;
  let rafId = 0;
  let lastTime = 0;
  let carry = 0;
  let previousY = 0;
  let upwardJump = false;

  function atBottom(): boolean {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return window.scrollY >= max - 1;
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    options.onStateChange(false);
  }

  function frame(now: number): void {
    if (!playing) return;
    // Mobile browser chrome can shift the page once; only sustained upward jumps
    // indicate a takeover, since this engine always moves downward.
    const drop = previousY - window.scrollY;
    if (drop > TAKEOVER_UP_PX) {
      if (upwardJump) {
        pause();
        return;
      }
      upwardJump = true;
      previousY = window.scrollY;
    } else {
      upwardJump = false;
    }

    const seconds = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    carry += options.getSpeed() * seconds;
    const step = Math.floor(carry);
    if (step > 0) {
      carry -= step;
      window.scrollBy(0, step);
      previousY = window.scrollY;
      if (atBottom()) {
        pause();
        return;
      }
    }
    rafId = requestAnimationFrame(frame);
  }

  function play(): void {
    if (playing || atBottom()) return;
    playing = true;
    carry = 0;
    previousY = window.scrollY;
    upwardJump = false;
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
    options.onStateChange(true);
  }

  window.addEventListener('wheel', pause, { passive: true });
  window.addEventListener('touchmove', pause, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (PAUSE_KEYS.has(event.key)) pause();
  }, { passive: true });
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && (event.button === 1 || event.clientX > window.innerWidth - 24)) {
      pause();
    }
  }, { passive: true });

  return { play, pause, isPlaying: () => playing };
}
