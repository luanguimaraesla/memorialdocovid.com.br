import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const output = new URL('public/previas/', root);
// Build metadata stays out of public/: only the images are published.
const manifest = new URL('scripts/previas-manifest.json', root);
const dataBytes = await readFile(new URL('public/data/declaracoes.json', root));
const statements = JSON.parse(dataBytes).declaracoes;
const narrative = await readFile(new URL('src/components/Narrative.astro', root), 'utf8');
const css = await readFile(new URL('src/styles/global.css', root), 'utf8');
const palette = css.match(/:root\s*\{[^}]+\}/)?.[0];
const subtitle = narrative.match(/<p class="hero__subtitle">([^<]+)<\/p>/)?.[1];
if (!palette || !subtitle) throw new Error('Paleta ou subtítulo do memorial ausente');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const escape = (text) => text.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function page(card) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>
    ${palette}
    * { box-sizing: border-box; }
    body { margin: 0; width: 1200px; height: 630px; padding: 36px 44px;
      display: grid; grid-template-rows: auto 1fr auto; gap: 20px;
      background: var(--fundo); color: var(--texto); font-family: system-ui, sans-serif; }
    header, footer { display: flex; justify-content: space-between; align-items: center; }
    header { border-bottom: 2px solid var(--destaque); padding-bottom: 16px; }
    .brand { font-size: 24px; font-weight: 600; }
    time { color: var(--destaque); font-size: 28px; font-weight: 700; }
    main { min-height: 0; display: flex; flex-direction: column; }
    h1 { font-size: 44px; font-weight: 700; line-height: 1.13; margin: 0 0 12px; }
    .author { color: var(--destaque); font-size: 22px; margin: 0 0 14px; }
    .message { flex: 1; min-height: 0; overflow: hidden; margin: 0; padding-left: 22px;
      border-left: 5px solid var(--destaque); font-size: 34px; line-height: 1.28; white-space: pre-line; }
    .message--news { border-left: 0; padding-left: 0; }
    footer { color: var(--texto-suave); font-size: 19px; }
  </style><body>
    <header><span class="brand">Memorial do Covid</span><time>${escape(card.date)}</time></header>
    <main><h1>${escape(card.title)}</h1><p class="author">${card.news ? 'Marco histórico · ' : ''}${escape(card.author)}</p>
      <${card.news ? 'p' : 'blockquote'} class="message${card.news ? ' message--news' : ''}">${escape(card.text)}</${card.news ? 'p' : 'blockquote'}></main>
    <footer><span>Uma vida, um ponto. Não esqueceremos.</span><span>memorialdocovid.com.br</span></footer>
  </body></html>`;
}

const cards = [
  { id: 'memorial', title: 'Memorial do Covid', date: '', author: 'Uma vida, um ponto', text: subtitle },
  ...statements.map((statement) => {
    if (!/^[a-z0-9-]+$/.test(statement.id)) throw new Error(`ID inválido: ${statement.id}`);
    for (const field of ['subtitulo', 'autor', 'texto', 'data']) {
      if (typeof statement[field] !== 'string' || !statement[field].trim()) {
        throw new Error(`${field} ausente em ${statement.id}`);
      }
    }
    return {
      id: statement.id, title: statement.subtitulo, author: statement.autor, text: statement.texto,
      date: statement.data.split('-').reverse().join('/'), news: statement.tipo === 'noticia',
    };
  }),
];

const profile = await mkdtemp(join(tmpdir(), 'memorial-previas-'));
const executable = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const chrome = spawn(executable, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let launchError;
let stderr = '';
chrome.on('error', (error) => { launchError = error; });
chrome.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
const closed = new Promise((resolve) => chrome.once('close', resolve));
let socket;
let sequence = 0;
const pending = new Map();

async function connect() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw new Error('Defina CHROME_PATH para um Chrome/Chromium instalado', { cause: launchError });
    if (chrome.exitCode !== null) throw new Error(`Chrome encerrou: ${stderr}`);
    try {
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const target = pages.find((target) => target.type === 'page');
      if (target) return new WebSocket(target.webSocketDebuggerUrl);
    } catch (error) {
      if (attempt === 99) throw new Error(`Chrome não iniciou: ${stderr}`, { cause: error });
    }
    await delay(50);
  }
  throw new Error('Chrome não publicou uma página');
}

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Tempo esgotado: ${method}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  socket = await connect();
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await mkdir(output, { recursive: true });
  const images = [];
  for (const card of cards) {
    await command('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(page(card))}` });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await command('Runtime.evaluate', { expression: `document.readyState === "complete" && document.querySelector('.message')?.textContent === ${JSON.stringify(card.text)}`, returnByValue: true });
      if (response.result.value) { ready = true; break; }
      await delay(20);
    }
    if (!ready) throw new Error(`Prévia não carregou: ${card.id}`);
    const fitted = await command('Runtime.evaluate', {
      expression: `(async () => {
        await document.fonts.ready;
        const quote = document.querySelector('.message');
        let size = 34;
        while (quote.scrollHeight > quote.clientHeight && size > 16) quote.style.fontSize = --size + 'px';
        await new Promise(requestAnimationFrame);
        return { fits: quote.scrollHeight <= quote.clientHeight, fontSize: size, text: quote.textContent,
          overflow: document.documentElement.scrollWidth > 1200 || document.documentElement.scrollHeight > 630 };
      })()`, returnByValue: true, awaitPromise: true,
    });
    const metrics = fitted.result.value;
    if (fitted.exceptionDetails || !metrics?.fits || metrics.overflow || metrics.text !== card.text) {
      throw new Error(`Conteúdo cortado na prévia ${card.id}: ${JSON.stringify(metrics)}`);
    }
    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const bytes = Buffer.from(shot.data, 'base64');
    if (bytes.readUInt32BE(16) !== 1200 || bytes.readUInt32BE(20) !== 630) throw new Error(`Dimensão inválida: ${card.id}`);
    const file = `${card.id}.png`;
    await writeFile(new URL(file, output), bytes);
    images.push({ id: card.id, file, sha256: hash(bytes), fontSize: metrics.fontSize });
    console.log(`${file}: 1200×630, texto ${metrics.fontSize}px`);
  }
  await writeFile(manifest, JSON.stringify({
    declaracoesSha256: hash(dataBytes), paletteSha256: hash(palette), subtitleSha256: hash(subtitle), images,
  }, null, 2) + '\n');
} finally {
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (chrome.pid && chrome.exitCode === null) {
    chrome.kill();
    await Promise.race([closed, delay(3000)]);
    if (chrome.exitCode === null) { chrome.kill('SIGKILL'); await closed; }
  }
}
