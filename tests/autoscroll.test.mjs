import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/autoscroll.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { createAutoscroll } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function installScroller(context, { speed = 1920, top = 0, max = 10_000 } = {}) {
  const listeners = {};
  const states = [];
  const steps = [];
  const frames = new Map();
  let time = 0;
  let sequence = 0;
  globalThis.document = { documentElement: { scrollHeight: max + 800 } };
  globalThis.window = {
    scrollY: top,
    innerHeight: 800,
    innerWidth: 1200,
    matchMedia: () => ({ matches: true }),
    addEventListener: (type, listener) => { listeners[type] = listener; },
    scrollBy: (_x, amount) => {
      window.scrollY = Math.min(max, window.scrollY + amount);
      steps.push(amount);
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++sequence, callback);
    return sequence;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  context.mock.method(performance, 'now', () => time);
  context.after(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });
  const scroller = createAutoscroll({
    getSpeed: () => speed,
    onStateChange: (playing) => states.push(playing),
  });
  return {
    scroller, listeners, frames, states, steps,
    setSpeed: (value) => { speed = value; },
    frame(milliseconds = 100) {
      time += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(time));
    },
  };
}

test('autoscroll stays paused until explicitly started, including with reduced motion', (context) => {
  const { scroller, frames, states, frame } = installScroller(context);
  frame();
  assert.equal(scroller.isPlaying(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(states, []);
  assert.equal(window.scrollY, 0);
  scroller.play();
  frame();
  assert.equal(window.scrollY, 192);
});

test('autoscroll advances 1920 pixels over one second', (context) => {
  const { scroller, frame, states } = installScroller(context);
  scroller.play();
  scroller.play();
  for (let i = 0; i < 10; i++) frame();
  assert.equal(window.scrollY, 1920);
  assert.deepEqual(states, [true]);
});

test('speed changes apply on the next frame without restarting playback', (context) => {
  const { scroller, setSpeed, frame, steps, states } = installScroller(context);
  scroller.play();
  frame();
  setSpeed(3840);
  frame();
  setSpeed(5760);
  frame();
  assert.deepEqual(steps, [192, 384, 576]);
  assert.deepEqual(states, [true]);
});

test('subpixel movement accumulates instead of stalling at low speeds', (context) => {
  const { scroller, frame } = installScroller(context, { speed: 0.25 });
  scroller.play();
  for (let i = 0; i < 50; i++) frame();
  assert.equal(window.scrollY, 1);
});

test('a delayed animation frame is capped at 100 milliseconds', (context) => {
  const { scroller, frame } = installScroller(context);
  scroller.play();
  frame(10_000);
  assert.equal(window.scrollY, 192);
});

test('pausing cancels the loop and resuming resets its time baseline', (context) => {
  const { scroller, frame, frames, states } = installScroller(context);
  scroller.play();
  frame();
  scroller.pause();
  scroller.pause();
  assert.equal(frames.size, 0);
  frame(10_000);
  assert.equal(window.scrollY, 192);
  scroller.play();
  frame();
  assert.equal(window.scrollY, 384);
  assert.deepEqual(states, [true, false, true]);
});

test('wheel and touch pan pause playback, but taps and unrelated keys do not', (context) => {
  const { scroller, listeners, frames } = installScroller(context);
  scroller.play();
  assert.equal(listeners.touchstart, undefined);
  listeners.pointerdown({ pointerType: 'touch', button: 0, clientX: 1199 });
  listeners.pointerdown({ pointerType: 'pen', button: 0, clientX: 1199 });
  listeners.pointerdown({ pointerType: 'mouse', button: 0, clientX: 300 });
  listeners.keydown({ key: 'Tab' });
  assert.equal(scroller.isPlaying(), true);
  listeners.wheel();
  assert.equal(scroller.isPlaying(), false);
  assert.equal(frames.size, 0);
  scroller.play();
  listeners.touchmove();
  assert.equal(scroller.isPlaying(), false);
});

test('scroll navigation keys pause playback', (context) => {
  const { scroller, listeners } = installScroller(context);
  for (const key of [' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
    scroller.play();
    listeners.keydown({ key });
    assert.equal(scroller.isPlaying(), false, key);
  }
});

test('mouse scrollbar grabs and middle clicks pause playback', (context) => {
  const { scroller, listeners } = installScroller(context);
  scroller.play();
  listeners.pointerdown({ pointerType: 'mouse', button: 0, clientX: 1190 });
  assert.equal(scroller.isPlaying(), false);
  scroller.play();
  listeners.pointerdown({ pointerType: 'mouse', button: 1, clientX: 300 });
  assert.equal(scroller.isPlaying(), false);
});

test('one upward jump or small viewport adjustments do not pause playback', (context) => {
  const { scroller, frame } = installScroller(context, { top: 3000 });
  scroller.play();
  window.scrollY -= 400;
  frame();
  assert.equal(scroller.isPlaying(), true);
  for (let i = 0; i < 5; i++) {
    window.scrollY -= 50;
    frame();
    assert.equal(scroller.isPlaying(), true);
  }
});

test('two consecutive large upward jumps pause playback', (context) => {
  const { scroller, frame, states, frames } = installScroller(context, { top: 3000 });
  scroller.play();
  window.scrollY -= 400;
  frame();
  window.scrollY -= 400;
  frame();
  assert.equal(scroller.isPlaying(), false);
  assert.deepEqual(states, [true, false]);
  assert.equal(frames.size, 0);
});

test('the scroller stops at the bottom and does not restart there', (context) => {
  const { scroller, frame, states, frames } = installScroller(context, { top: 9950 });
  scroller.play();
  frame();
  frame();
  assert.equal(window.scrollY, 10_000);
  assert.equal(scroller.isPlaying(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(states, [true, false]);
  scroller.play();
  assert.equal(frames.size, 0);
  assert.deepEqual(states, [true, false]);
});

test('starting at the bottom leaves the scroller paused', (context) => {
  const { scroller, states, frames } = installScroller(context, { top: 10_000 });
  scroller.play();
  assert.equal(scroller.isPlaying(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(states, []);
});
