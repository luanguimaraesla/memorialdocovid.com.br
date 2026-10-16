import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/audio.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { bootAudio, startAudio } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function installAudio(context) {
  const audio = new EventTarget();
  Object.assign(audio, { paused: true, ended: false, muted: false, currentTime: 0, plays: 0, controls: true });
  audio.play = async () => {
    audio.plays++;
    audio.paused = false;
    audio.ended = false;
    audio.dispatchEvent(new Event('play'));
  };
  audio.pause = () => { audio.paused = true; audio.dispatchEvent(new Event('pause')); };
  const toggle = new EventTarget();
  toggle.attributes = {};
  toggle.disabled = true;
  toggle.setAttribute = (key,value) => { toggle.attributes[key] = value; };
  toggle.toggleAttribute = (key,value) => { if (value) toggle.attributes[key] = ''; else delete toggle.attributes[key]; };
  const status = { hidden:true };
  const elements = {'#memorial-audio':audio,'[data-audio-status]':status};
  globalThis.document = {
    querySelector: selector => elements[selector] ?? null,
    querySelectorAll: () => [toggle],
  };
  context.after(() => { delete globalThis.document; });
  bootAudio();
  return {audio,toggle,status};
}

async function click(toggle) {
  toggle.dispatchEvent(new Event('click'));
  await new Promise(setImmediate);
}

test('boot never plays music; starting the journey can play within its user gesture', async context => {
  const {audio,toggle} = installAudio(context);
  assert.equal(audio.plays,0);
  assert.equal(audio.controls,false);
  assert.equal(toggle.disabled,false);
  assert.equal(toggle.attributes['aria-label'],'Ouvir música');
  await startAudio();
  assert.equal(audio.plays,1);
  assert.equal(toggle.attributes['aria-label'],'Silenciar música');
});

test('the floating button mutes and unmutes without pausing or resetting the track', async context => {
  const {audio,toggle} = installAudio(context);
  await click(toggle);
  audio.currentTime = 73;
  await click(toggle);
  assert.equal(audio.muted,true);
  assert.equal(audio.paused,false);
  assert.equal(audio.currentTime,73);
  assert.equal(toggle.attributes['aria-pressed'],'true');
  assert.equal(toggle.attributes['aria-label'],'Ativar som');
  await click(toggle);
  assert.equal(audio.muted,false);
  assert.equal(audio.plays,1);
  assert.equal(audio.currentTime,73);
});

test('native playback, volume changes and completion keep the floating state synchronized', async context => {
  const {audio,toggle} = installAudio(context);
  await audio.play();
  audio.muted = true;
  audio.dispatchEvent(new Event('volumechange'));
  assert.equal(toggle.attributes['aria-pressed'],'true');
  audio.pause();
  assert.equal(toggle.attributes['aria-label'],'Ouvir música');
  await audio.play();
  audio.ended = true;
  audio.dispatchEvent(new Event('ended'));
  assert.equal(toggle.attributes['aria-label'],'Ouvir música');
  await click(toggle);
  assert.equal(audio.ended,false);
  assert.equal(audio.muted,false);
});

test('starting playback preserves a previously chosen mute state', async context => {
  const {audio} = installAudio(context);
  audio.muted = true;
  await startAudio();
  assert.equal(audio.muted,true);
});

test('playback failures expose recovery and a later successful play clears the error', async context => {
  const {audio,toggle,status} = installAudio(context);
  const play = audio.play;
  audio.play = async () => { throw new DOMException('blocked','NotAllowedError'); };
  await click(toggle);
  assert.equal(status.hidden,false);
  audio.play = play;
  await click(toggle);
  assert.equal(status.hidden,true);
  audio.error = {code:2};
  audio.dispatchEvent(new Event('error'));
  assert.equal(status.hidden,false);
  assert.equal(toggle.attributes['aria-label'],'Tentar música novamente');
});

test('retrying a failed resource reloads it before playback', async context => {
  const {audio,toggle} = installAudio(context);
  await audio.play();
  audio.error = {code:2};
  let reloaded = false;
  audio.load = () => { audio.error = null; reloaded = true; };
  await click(toggle);
  assert.equal(reloaded,true);
  assert.equal(audio.paused,false);
});

test('audio initialization and start are harmless on pages without a player', async context => {
  globalThis.document = {querySelector:()=>null,querySelectorAll:()=>[]};
  context.after(() => { delete globalThis.document; });
  assert.doesNotThrow(bootAudio);
  await assert.doesNotReject(startAudio());
});

test('the audio keeps native no-JS controls, no preload and a direct recovery link', async () => {
  const component = await readFile(new URL('../src/components/Music.astro',import.meta.url),'utf8');
  assert.match(component,/<audio[\s\S]*?controls[\s\S]*?preload="none"/);
  assert.doesNotMatch(component,/\bautoplay\b/);
  assert.match(component,/class="sound-control"/);
  assert.match(component,/Abrir o áudio original/);
});
