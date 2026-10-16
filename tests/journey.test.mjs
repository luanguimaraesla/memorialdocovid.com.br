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
const { SECONDS_BETWEEN_MILESTONES } = await import(configUrl);
const layoutUrl = moduleUrl((await read('src/lib/layout.ts')).replaceAll("'../config'", JSON.stringify(configUrl)));
const { anchorY, columnHeight, dayIndexOf, lastIndexOfDay } = await import(layoutUrl);
const { RAMP_SHARE, continuousPath, guidedPath, milestoneSpeeds, pathDuration } = await import(moduleUrl(
  (await read('src/lib/journey.ts')).replaceAll("'../config'", JSON.stringify(configUrl)),
));

const interval = 1.6;
const speedAt = (path, seconds, step = 1e-4) => (path.positionAt(seconds + step) - path.positionAt(seconds)) / step;

function assertMonotonic(path, positions, step = 0.01) {
  for (let index = 0; index < path.legs; index++) {
    let previous = positions[index];
    for (let seconds = index * interval; seconds <= (index + 1) * interval; seconds += step) {
      const y = path.positionAt(seconds);
      assert.ok(y >= previous - 1e-6, `backwards at ${seconds}s`);
      assert.ok(y <= positions[index + 1] + 1e-6, `overshoot at ${seconds}s`);
      previous = y;
    }
  }
}

test('milestones are exactly 1.6 seconds apart', () => {
  assert.equal(SECONDS_BETWEEN_MILESTONES, interval);
  const positions = [0, 700, 700, 8448, 129_868];
  const path = continuousPath(positions);
  assert.equal(path.legs, 4);
  assert.equal(pathDuration(path), 4 * interval);
  positions.forEach((y, index) => assert.equal(path.positionAt(index * interval), y));
  assert.equal(path.positionAt(-1), 0);
  assert.equal(path.positionAt(99), 129_868);
  const leg = guidedPath(1000, 8748);
  assert.equal(pathDuration(leg), interval);
  assert.equal(leg.positionAt(0), 1000);
  assert.equal(leg.positionAt(interval), 8748);
});

test('a guided leg speeds up, runs at full speed and brakes briefly onto the milestone', () => {
  const distance = 7748;
  const average = distance / interval;
  const peak = average / (1 - RAMP_SHARE);
  const path = guidedPath(1000, 1000 + distance);
  assert.equal(RAMP_SHARE, 0.15);
  assert.ok(speedAt(path, 0) < 0.01 * peak);
  for (const seconds of [0.3, 0.8, 1.3]) assert.ok(Math.abs(speedAt(path, seconds) / peak - 1) < 1e-3, `${seconds}s`);
  // The brake takes the last 0.24 s: no long, slow creep into place.
  const brake = RAMP_SHARE * interval;
  assert.ok(Math.abs(speedAt(path, interval - brake - 0.01) / peak - 1) < 1e-3);
  assert.ok(Math.abs(path.positionAt(interval - brake) - (1000 + distance * (1 - (1 - RAMP_SHARE) ** -1 * RAMP_SHARE / 2))) < 1e-6);
  assert.ok(speedAt(path, interval - 1e-3) < 0.01 * peak);
  // Ninety percent of the way is covered before 85 percent of the time.
  assert.ok(path.positionAt(0.85 * interval) - 1000 > 0.9 * distance);
  assertMonotonic(path, [1000, 1000 + distance]);
});

test('continuous speeds blend neighboring legs and slow to rest at the end', () => {
  assert.deepEqual(milestoneSpeeds([0, 1600, 4800]).map(Math.round), [1000, 1333, 0]);
  const positions = [0, 1600, 4800];
  assertMonotonic(continuousPath(positions), positions);
});

test('milestones on the same dot row hold position for one interval without moving back', () => {
  const positions = [0, 78, 78, 78, 6552, 6552, 128_000];
  assert.deepEqual(milestoneSpeeds(positions).slice(1, 6), [0, 0, 0, 0, 0]);
  const path = continuousPath(positions);
  for (let seconds = interval; seconds <= 3 * interval; seconds += 0.1) assert.equal(path.positionAt(seconds), 78);
  assertMonotonic(path, positions);
});

test('the published milestones form a monotonic 1.6-second journey through the real column', async () => {
  const records = JSON.parse(await read('public/data/declaracoes.json')).declaracoes;
  const days = JSON.parse(await read('public/data/obitos.json')).dias;
  const total = days.at(-1).acumulado;
  const positions = records.map(record => anchorY(lastIndexOfDay(days, dayIndexOf(days, record.data)), total))
    .sort((a, b) => a - b);
  const all = [...positions, columnHeight(total)];
  const path = continuousPath(all);
  assert.equal(positions.length, records.length);
  assert.equal(pathDuration(path), records.length * interval);
  positions.forEach((y, index) => assert.equal(path.positionAt(index * interval), y));
  assertMonotonic(path, all, 0.05);
});
