import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const configUrl = moduleUrl(await read('src/config.ts'));
const journeyUrl = moduleUrl((await read('src/lib/journey.ts')).replaceAll("'../config'", JSON.stringify(configUrl)));
const journey = await import(journeyUrl);
const { createAutoscroll } = await import(moduleUrl((await read('src/lib/autoscroll.ts'))
  .replaceAll("'../config'", JSON.stringify(configUrl))
  .replaceAll("'./journey'", JSON.stringify(journeyUrl))));

const nextMilestone = from => journey.guidedPath(from, from + 1600);

function installScroller(context, { top = 0, max = 10_000, plan = nextMilestone } = {}) {
  const listeners = {};
  const states = [];
  const waypoints = [];
  const plans = [];
  const frames = new Map();
  let time = 0;
  let sequence = 0;
  globalThis.window = {
    scrollY: top,
    innerHeight: 800,
    addEventListener: (type, listener) => { listeners[type] = listener; },
    scrollTo: ({ top: y }) => { window.scrollY = Math.max(0, Math.min(max, y)); },
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++sequence, callback);
    return sequence;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  context.mock.method(performance, 'now', () => time);
  context.after(() => {
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });
  const scroller = createAutoscroll({
    plan: from => { plans.push(from); return from < max ? plan(from) : undefined; },
    onWaypoint: index => waypoints.push([index, window.scrollY, Math.round(time)]),
    onStateChange: (playing) => states.push(playing),
  });
  return {
    scroller, listeners, frames, states, waypoints, plans,
    frame(milliseconds = 100) {
      time += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(time));
    },
    frames16() { for (let index = 0; index < 16; index++) this.frame(); },
  };
}

test('autoscroll stays paused until explicitly started', (context) => {
  const { scroller, frames, states, frame } = installScroller(context);
  frame();
  assert.equal(scroller.isPlaying(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(states, []);
  assert.equal(window.scrollY, 0);
});

test('a guided leg reaches its milestone exactly 1.6 seconds after it starts', (context) => {
  const { scroller, frame, states, waypoints } = installScroller(context, { top: 400 });
  scroller.play();
  scroller.play();
  for (let index = 0; index < 15; index++) frame();
  assert.equal(scroller.isPlaying(), true);
  assert.ok(window.scrollY > 400 && window.scrollY < 2000);
  frame();
  assert.equal(window.scrollY, 2000);
  assert.deepEqual(waypoints, [[1, 2000, 1600]]);
  assert.equal(scroller.isPlaying(), false);
  assert.deepEqual(states, [true, false]);
});

test('continuous paths report every milestone at 1.6-second intervals and stop at the end', (context) => {
  const plan = from => journey.continuousPath([from, 1000, 1000, 5000]);
  const { scroller, frame, waypoints, states } = installScroller(context, { plan });
  scroller.play();
  for (let index = 0; index < 47; index++) frame();
  assert.equal(scroller.isPlaying(), true);
  frame();
  assert.deepEqual(waypoints, [[1, 1000, 1600], [2, 1000, 3200], [3, 5000, 4800]]);
  assert.deepEqual(states, [true, false]);
});

test('a delayed animation frame is capped at 100 milliseconds', (context) => {
  const { scroller, frame } = installScroller(context);
  scroller.play();
  frame(10_000);
  assert.equal(window.scrollY, journey.positionAt(nextMilestone(0), 0.1));
});

test('pausing freezes the page and resuming plans again from where it stopped', (context) => {
  const { scroller, frame, frames, states, plans, waypoints } = installScroller(context);
  scroller.play();
  for (let index = 0; index < 5; index++) frame();
  scroller.pause();
  scroller.pause();
  assert.equal(frames.size, 0);
  const position = window.scrollY;
  frame(10_000);
  assert.equal(window.scrollY, position);
  scroller.play();
  for (let index = 0; index < 16; index++) frame();
  assert.deepEqual(plans, [0, position]);
  assert.equal(window.scrollY, position + 1600);
  assert.deepEqual(waypoints.map(([index]) => index), [1]);
  assert.deepEqual(states, [true, false, true, false]);
});

test('manual scrolling during playback continues from the new position without pausing', (context) => {
  const { scroller, frame, plans, states } = installScroller(context, { top: 3000 });
  scroller.play();
  frame();
  for (const jump of [-400, 900]) {
    window.scrollY += jump;
    const moved = window.scrollY;
    frame();
    assert.equal(plans.at(-1), moved);
    assert.equal(scroller.isPlaying(), true);
  }
  assert.deepEqual(states, [true]);
});

test('manual input does not install any automatic pause handlers', (context) => {
  const { scroller, listeners, frame } = installScroller(context);
  scroller.play();
  for (const type of ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown']) {
    assert.equal(listeners[type], undefined, type);
  }
  frame();
  assert.equal(scroller.isPlaying(), true);
});

test('a leg past the page bottom stops there and does not restart', (context) => {
  const { scroller, frame, states, frames } = installScroller(context, { top: 9950 });
  scroller.play();
  for (let index = 0; index < 16; index++) frame();
  assert.equal(window.scrollY, 10_000);
  assert.equal(scroller.isPlaying(), false);
  assert.equal(frames.size, 0);
  scroller.play();
  assert.equal(frames.size, 0);
  assert.deepEqual(states, [true, false]);
});

test('nothing left to plan leaves the scroller paused', (context) => {
  const { scroller, states, frames } = installScroller(context, { top: 10_000 });
  scroller.play();
  assert.equal(scroller.isPlaying(), false);
  assert.equal(frames.size, 0);
  assert.deepEqual(states, []);
});
