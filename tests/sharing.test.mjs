import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/sharing.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { shareDescription, statementAnchor, statementUrl, shareLink } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const link = {
  title: 'Título do marco',
  text: shareDescription('Título do marco'),
  url: statementUrl('um-marco', new URL('https://memorial.test/')),
};

function browser(context, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
}

test('share text preserves the requested phrase and URLs encode marker IDs safely', () => {
  assert.equal(link.text, 'Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra? Título do marco');
  assert.equal(link.url, 'https://memorial.test/marcos/um-marco/#declaracao-um-marco');
  const id = 'um / <marco> á';
  const url = new URL(statementUrl(id, new URL('https://memorial.test/sub/')));
  assert.equal(url.pathname, '/sub/marcos/um%20%2F%20%3Cmarco%3E%20%C3%A1/');
  assert.equal(decodeURIComponent(url.hash.slice(1)), statementAnchor(id));
});

test('native sharing receives the text and anchored URL without copying anything', async (context) => {
  const shared = [];
  browser(context, {
    share: async (data) => { shared.push(data); },
    clipboard: { writeText: () => assert.fail('native sharing must not copy') },
  });
  assert.equal(await shareLink(link), 'shared');
  assert.deepEqual(shared, [link]);
});

test('canceling native sharing does not copy the message or report success', async (context) => {
  browser(context, {
    share: async () => { throw new DOMException('cancelled', 'AbortError'); },
    clipboard: { writeText: () => assert.fail('cancellation must not copy') },
  });
  assert.equal(await shareLink(link), 'cancelled');
});

test('native failures and missing native sharing fall back to copying the message and URL', async (context) => {
  let copied;
  const value = { clipboard: { writeText: async (text) => { copied = text; } } };
  browser(context, value);
  assert.equal(await shareLink(link), 'copied');
  assert.equal(copied, `${link.text}\n${link.url}`);
  value.share = async () => { throw new DOMException('blocked', 'NotAllowedError'); };
  assert.equal(await shareLink(link), 'copied');
  assert.equal(copied, `${link.text}\n${link.url}`);
});

test('unavailable or denied clipboard access leaves a manual-copy option', async (context) => {
  const value = {};
  browser(context, value);
  assert.equal(await shareLink(link), 'manual');
  value.clipboard = { writeText: async () => { throw new DOMException('blocked', 'NotAllowedError'); } };
  assert.equal(await shareLink(link), 'manual');
});
