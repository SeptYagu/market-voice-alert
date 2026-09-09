import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Public diagnostics deliberately use an allowlist, never free-form error text.
const kinds = new Set(['http', 'network', 'timeout', 'runtime', 'rejection', 'resource', 'console', 'startup']);
const sources = new Set(['server', 'upstream', 'browser']);
const errorNames = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'TimeoutError', 'AbortError', 'QuotaExceededError']);
const errorCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EACCES', 'ENOSPC', 'ENOENT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
export function errorDetails(error) {
  return { errorName: error?.name, errorCode: error?.code || error?.cause?.code };
}
const providers = ['tencent', 'eastmoney-kline', 'eastmoney', 'aktools', 'sina', 'qq-kline-min', 'qq-kline'];
const cacheRoutes = ['health', 'kline', 'intraday', 'limit-up', 'limit-up/reasons', 'momentum/ten-day', 'momentum/ten-day/scan', 'calendar/trade-dates', 'spot/latest', 'futures/quote', 'futures/contracts', 'futures/kline', 'futures/intraday', 'futures/session'];
export function safeLocation(value) {
  if (['eastmoney', 'tencent', 'sina', 'aktools'].includes(value)) return value;
  try {
    const url = new URL(String(value), 'http://local');
    if (url.hostname.endsWith('.eastmoney.com')) return 'eastmoney';
    if (url.hostname.endsWith('.gtimg.cn')) return 'tencent';
    if (url.hostname.endsWith('.sinajs.cn')) return 'sina';
    if (url.hostname === 'vip.stock.finance.sina.com.cn') return 'sina';
    if (url.port === '8888') return 'aktools';
    const path = url.pathname;
    if (cacheRoutes.some(route => path === `/api/cache/${route}`)) return path;
    const provider = providers.find(name => path === `/api/${name}` || path.startsWith(`/api/${name}/`));
    if (provider) return `/api/${provider}`;
    if (path === '/src/main.js' || path === '/logs.html') return path;
    return 'application';
  } catch { return 'application'; }
}

export function normalizeEvent(input = {}) {
  return {
    source: sources.has(input.source) ? input.source : 'browser',
    kind: kinds.has(input.kind) ? input.kind : 'runtime',
    level: input.level === 'warning' ? 'warning' : input.kind === 'startup' ? 'info' : 'error',
    location: safeLocation(input.location),
    errorName: errorNames.has(input.errorName) ? input.errorName : '',
    errorCode: errorCodes.has(input.errorCode) ? input.errorCode : '',
    version: /^[a-f0-9]{7,40}$/.test(input.version) ? input.version : 'unknown',
    status: Number.isInteger(input.status) && input.status >= 100 && input.status <= 599 ? input.status : 0,
    line: Number.isInteger(input.line) && input.line > 0 && input.line < 1000000 ? input.line : 0
  };
}

export function createDiagnosticStore({ file, limit = 500, now = Date.now } = {}) {
  let entries = [];
  let persistenceError = false;
  let pending = Promise.resolve();
  let revision = 0;
  let savedRevision = 0;
  const ready = file ? readFile(file, 'utf8').then(text => {
    const saved = JSON.parse(text);
    if (Array.isArray(saved)) entries = saved.slice(-limit).filter(e => Number.isFinite(e.time)).map(e => ({
      ...normalizeEvent(e), time: e.time, count: Math.min(1000000, Math.max(1, Number(e.count) || 1))
    }));
  }).catch(err => { persistenceError = err.code !== 'ENOENT'; }) : Promise.resolve();
  function add(input) {
    pending = pending.then(async () => {
      await ready;
      const event = normalizeEvent(input);
      const time = now();
      entries = entries.filter(e => time - e.time < 7 * 86400000);
      const previous = entries.at(-1);
      if (previous && time - previous.time < 60000 && Object.keys(event).every(k => previous[k] === event[k])) {
        previous.count = Math.min(1000000, previous.count + 1);
        previous.time = time;
      } else entries.push({ ...event, time, count: 1 });
      entries = entries.slice(-limit);
      revision++;
    });
    return pending;
  }
  async function snapshot() {
    await ready;
    await pending;
    return { entries: entries.filter(e => now() - e.time < 7 * 86400000).slice().reverse().map(e => ({ ...e })), persistenceError };
  }
  let writing = Promise.resolve();
  function flush() {
    writing = writing.then(async () => {
      await pending;
      if (revision === savedRevision) return;
      const currentRevision = revision;
      const data = await snapshot();
      if (!file) return;
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(data.entries.slice().reverse()), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        persistenceError = false;
        savedRevision = currentRevision;
      } catch { persistenceError = true; }
    });
    return writing;
  }
  return { add, snapshot, flush };
}

const file = resolve(process.env.MARKET_VOICE_CACHE_ROOT || fileURLToPath(new URL('../data/cache/', import.meta.url)), 'diagnostics.json');
export const diagnostics = createDiagnosticStore({ file });
export function recordDiagnostic(event) { void diagnostics.add({ ...event, version }); }
let installed = false;
let version = 'unknown';
export function startDiagnostics() {
  if (installed) return;
  installed = true;
  try { version = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* deployment may omit Git */ }
  for (const [method, level] of [['error', 'error'], ['warn', 'warning']]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      recordDiagnostic({ source: 'server', kind: 'console', level, ...errorDetails(args.find(arg => arg instanceof Error)) });
      original(...args);
    };
  }
  process.on('uncaughtExceptionMonitor', error => recordDiagnostic({ source: 'server', kind: 'runtime', ...errorDetails(error) }));
  recordDiagnostic({ source: 'server', kind: 'startup' });
  setInterval(() => { void diagnostics.flush(); }, 5000).unref();
}

let budgetStart = 0;
let reports = 0;
export async function handleDiagnostics(req, res) {
  const reply = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'GET') {
    reply(200, { schemaVersion: 1, generatedAt: new Date().toISOString(), ...(await diagnostics.snapshot()), version, uptimeSeconds: Math.floor(process.uptime()), retentionDays: 7, limit: 500 });
    return;
  }
  if (req.method !== 'POST') { reply(405, { error: 'Method not allowed' }); return; }
  const origin = req.headers.origin;
  try {
    if (!origin || new URL(origin).host !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') {
      reply(403, { error: 'Same-origin reports only' }); return;
    }
  } catch { reply(403, { error: 'Invalid origin' }); return; }
  if (!String(req.headers['content-type']).startsWith('application/json')) { reply(415, { error: 'JSON required' }); return; }
  if (Date.now() - budgetStart >= 60000) { budgetStart = Date.now(); reports = 0; }
  if (++reports > 120) { reply(429, { error: 'Report rate exceeded' }); return; }
  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) { reply(413, { error: 'Report too large' }); return; }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid report');
    await diagnostics.add({ ...body, source: 'browser' });
    reply(202, { ok: true });
  } catch { if (!res.headersSent) reply(400, { error: 'Invalid report' }); }
}
