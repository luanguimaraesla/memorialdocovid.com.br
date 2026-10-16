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
const { anchorY, columnHeight, dayIndexOf, firstIndexOfDay } = await import(layoutUrl);
const { continuousPath, guidedPath, pathDuration, positionAt } = await import(moduleUrl(
  (await read('src/lib/journey.ts')).replaceAll("'../config'", JSON.stringify(configUrl)),
));

const interval = 1.6;

function assertMonotonic(path, step = 0.01) {
  for (let index = 0; index < path.length - 1; index++) {
    let previous = path[index].y;
    for (let seconds = index * interval; seconds <= (index + 1) * interval; seconds += step) {
      const y = positionAt(path, seconds);
      assert.ok(y >= previous - 1e-6, `backwards at ${seconds}s`);
      assert.ok(y <= path[index + 1].y + 1e-6, `overshoot at ${seconds}s`);
      previous = y;
    }
  }
}

test('milestones are exactly 1.6 seconds apart', () => {
  assert.equal(SECONDS_BETWEEN_MILESTONES, interval);
  const path = continuousPath([0, 700, 700, 8448, 129_868]);
  assert.equal(pathDuration(path), 4 * interval);
  path.forEach((waypoint, index) => assert.equal(positionAt(path, index * interval), waypoint.y));
  assert.equal(positionAt(path, -1), 0);
  assert.equal(positionAt(path, 99), 129_868);
});

test('a guided leg leaves at its average speed and comes to rest on the milestone', () => {
  const distance = 7748;
  const average = distance / interval;
  const path = guidedPath(1000, 1000 + distance);
  assert.deepEqual(path, [{ y: 1000, speed: average }, { y: 1000 + distance, speed: 0 }]);
  const step = 1e-4;
  const speed = seconds => (positionAt(path, seconds + step) - positionAt(path, seconds)) / step;
  assert.ok(Math.abs(speed(0) / average - 1) < 0.01);
  assert.ok(Math.abs(speed(interval / 3) / average - 4 / 3) < 0.01);
  assert.ok(speed(interval - step) < 0.01 * average);
  assertMonotonic(path);
});

test('continuous speeds blend neighboring legs and slow to rest at the end', () => {
  const path = continuousPath([0, 1600, 4800]);
  assert.deepEqual(path.map(({ speed }) => Math.round(speed)), [1000, 1333, 0]);
  assertMonotonic(path);
});

test('milestones on the same dot row hold position for one interval without moving back', () => {
  const path = continuousPath([0, 78, 78, 78, 6552, 6552, 128_000]);
  assert.deepEqual(path.slice(1, 6).map(({ speed }) => speed), [0, 0, 0, 0, 0]);
  for (let seconds = interval; seconds <= 3 * interval; seconds += 0.1) assert.equal(positionAt(path, seconds), 78);
  assertMonotonic(path);
});

test('the published milestones form a monotonic 1.6-second journey through the real column', async () => {
  const records = JSON.parse(await read('public/data/declaracoes.json')).declaracoes;
  const days = JSON.parse(await read('public/data/obitos.json')).dias;
  const total = days.at(-1).acumulado;
  const positions = records.map(record => anchorY(firstIndexOfDay(days, dayIndexOf(days, record.data)), total))
    .sort((a, b) => a - b);
  const path = continuousPath([...positions, columnHeight(total)]);
  assert.equal(positions.length, 107);
  assert.equal(pathDuration(path), 107 * interval);
  positions.forEach((y, index) => assert.equal(positionAt(path, index * interval), y));
  assertMonotonic(path, 0.05);
});
