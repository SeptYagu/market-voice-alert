import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getCachedTradeCalendar } from './calendarService.js';
import { getCachedIntraday } from './intradayService.js';
import { getCachedKline } from './klineService.js';
import { getCachedLimitUp, getCachedLimitUpReasons } from './limitUpService.js';
import {
  getCachedTenDayMomentum,
  startMomentumScheduler,
  startTenDayMomentumScan
} from './momentumService.js';
import { getCachedSpotLatest } from './spotService.js';
import { handleProxyRequest } from './proxyService.js';
import { getCachedFuturesQuotes } from './futures/futuresQuoteService.js';
import { getCachedFuturesKline, getCachedFuturesIntraday } from './futures/futuresKlineService.js';
import { getFuturesSession } from './futures/futuresSessionService.js';
import { DEFAULT_PORT, errorEnvelope, jsonResponse, okEnvelope } from './utils.js';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
});

function routeNotFound(res) {
  jsonResponse(res, 404, errorEnvelope('Not found'));
}

export async function handleCacheRequest(req, res) {
  if (req.method === 'OPTIONS') {
    jsonResponse(res, 204, {});
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'POST' && path === '/api/cache/momentum/ten-day/scan') {
    const date = url.searchParams.get('date');
    const threshold = url.searchParams.get('threshold');
    if (date && !/^\d{8}$/.test(date.trim()) && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      jsonResponse(res, 400, errorEnvelope('Invalid date parameter; expected YYYYMMDD or YYYY-MM-DD'));
      return;
    }
    // Register the single-flight job before replying so an immediate GET poll
    // cannot observe the old empty cache between POST and task startup.
    const job = startTenDayMomentumScan({ date, threshold, reason: 'manual' });
    if (job && job.promise && typeof job.promise.catch === 'function') {
      job.promise.catch((err) => {
        if (typeof console !== 'undefined' && console.error) console.error('background momentum scan job error:', err);
      });
    }
    jsonResponse(res, 202, okEnvelope({
      source: 'job',
      stale: false,
      ttlMs: 0,
      data: { status: 'scanning', date, threshold: Number(threshold) || 45 }
    }));
    return;
  }
  if (req.method !== 'GET') {
    jsonResponse(res, 405, errorEnvelope('Method not allowed'));
    return;
  }

  try {
    if (path === '/api/cache/kline') {
      const result = await getCachedKline({
        code: url.searchParams.get('code'),
        period: url.searchParams.get('period') || '1d',
        signal: undefined
      });
      jsonResponse(res, 200, okEnvelope(result));
      return;
    }

    if (path === '/api/cache/intraday') {
      const result = await getCachedIntraday({
        code: url.searchParams.get('code'),
        date: url.searchParams.get('date'),
        name: url.searchParams.get('name'),
        prevClose: url.searchParams.get('prevClose'),
        allowLatestTickSource: url.searchParams.get('allowLatestTickSource') !== '0',
        signal: undefined
      });
      jsonResponse(res, 200, okEnvelope(result));
      return;
    }

    if (path === '/api/cache/limit-up') {
      const result = await getCachedLimitUp({
        date: url.searchParams.get('date'),
        force: url.searchParams.get('force') === '1',
        signal: undefined
      });
      jsonResponse(res, 200, okEnvelope(result));
      return;
    }

    if (path === '/api/cache/limit-up/reasons') {
      const result = await getCachedLimitUpReasons({
        date: url.searchParams.get('date'),
        force: url.searchParams.get('force') === '1',
        signal: undefined
      });
      jsonResponse(res, 200, okEnvelope(result));
      return;
    }

    if (path === '/api/cache/momentum/ten-day') {
      const result = await getCachedTenDayMomentum({
        date: url.searchParams.get('date'),
        threshold: url.searchParams.get('threshold'),
        signal: undefined
      });
      jsonResponse(res, 200, okEnvelope(result));
      return;
    }

    if (path === '/api/cache/calendar/trade-dates') {
      const result = await getCachedTradeCalendar({
        signal: undefined
      });
      jsonResponse(res, 200, okEnvelope(result));
      return;
    }

    if (path === '/api/cache/spot/latest') {
      const result = await getCachedSpotLatest({
        signal: undefined
      });
      jsonResponse(res, 200, okEnvelope(result));
      return;
    }

    if (path === '/api/cache/futures/quote') {
      const idsParam = url.searchParams.get('ids') || url.searchParams.get('id');
      const ids = idsParam ? idsParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const result = await getCachedFuturesQuotes(ids);
      jsonResponse(res, 200, okEnvelope({
        source: 'server-futures-quote',
        stale: false,
        ttlMs: 3000,
        data: result
      }));
      return;
    }

    if (path === '/api/cache/futures/kline') {
      const id = url.searchParams.get('id') || url.searchParams.get('symbol');
      const period = url.searchParams.get('period') || 'day';
      const result = await getCachedFuturesKline(id, period);
      jsonResponse(res, 200, okEnvelope({
        source: 'server-futures-kline',
        stale: false,
        ttlMs: 10000,
        data: result
      }));
      return;
    }

    if (path === '/api/cache/futures/intraday') {
      const id = url.searchParams.get('id') || url.searchParams.get('symbol');
      const result = await getCachedFuturesIntraday(id);
      jsonResponse(res, 200, okEnvelope({
        source: 'server-futures-intraday',
        stale: false,
        ttlMs: 10000,
        data: result
      }));
      return;
    }

    if (path === '/api/cache/futures/session') {
      const id = url.searchParams.get('id') || url.searchParams.get('symbol');
      const result = getFuturesSession(id);
      jsonResponse(res, 200, okEnvelope({
        source: 'server-futures-session',
        stale: false,
        ttlMs: 10000,
        data: result
      }));
      return;
    }

    if (path === '/api/cache/health') {
      jsonResponse(res, 200, okEnvelope({
        source: 'server',
        ttlMs: 0,
        data: { status: 'ok' }
      }));
      return;
    }

    routeNotFound(res);
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : 500;
    jsonResponse(res, status, errorEnvelope(err && err.message ? err.message : String(err)));
  }
}

function safeStaticPath(urlPath) {
  let decoded = '/';
  try {
    decoded = decodeURIComponent(urlPath || '/');
  } catch {
    return null;
  }
  const withoutQueryPath = decoded.split(/[?#]/)[0] || '/';
  const normalized = normalize(withoutQueryPath).replace(/^([/\\])+/, '');
  const target = normalize(join(distRoot, normalized || 'index.html'));
  if (!target.startsWith(distRoot)) return null;
  return target;
}

async function sendStaticFile(req, res, filePath, { fallbackToIndex = true } = {}) {
  let target = filePath;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
  } catch {
    if (!fallbackToIndex) {
      routeNotFound(res);
      return;
    }
    target = join(distRoot, 'index.html');
  }

  try {
    const body = await readFile(target);
    const ext = extname(target).toLowerCase();
    const isIndex = ext === '.html';
    res.writeHead(200, {
      'content-type': MIME_TYPES[ext] || 'application/octet-stream',
      'cache-control': isIndex ? 'no-store' : 'public, max-age=31536000, immutable'
    });
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  } catch (err) {
    const status = err && err.code === 'ENOENT' ? 404 : 500;
    jsonResponse(res, status, errorEnvelope(err && err.message ? err.message : String(err)));
  }
}

async function handleAppRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname.startsWith('/api/cache')) {
    await handleCacheRequest(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      if (await handleProxyRequest(req, res)) return;
      routeNotFound(res);
    } catch (err) {
      const status = err && err.name === 'TimeoutError' ? 504 : 502;
      jsonResponse(res, status, errorEnvelope(err && err.message ? err.message : String(err)));
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    jsonResponse(res, 405, errorEnvelope('Method not allowed'));
    return;
  }
  const filePath = safeStaticPath(url.pathname);
  if (!filePath) {
    routeNotFound(res);
    return;
  }
  await sendStaticFile(req, res, filePath, { fallbackToIndex: !extname(filePath) });
}

export function createAppServer() {
  return http.createServer((req, res) => {
    handleAppRequest(req, res).catch((err) => {
      jsonResponse(res, 500, errorEnvelope(err && err.message ? err.message : String(err)));
    });
  });
}

export function startBackgroundJobs() {
  if (process.env.DISABLE_BACKGROUND_JOBS === '1') return;
  startMomentumScheduler();
}

export function startServer({
  port = Number(process.env.PORT || process.env.CACHE_SERVER_PORT || DEFAULT_PORT),
  host = process.env.HOST || '0.0.0.0'
} = {}) {
  startBackgroundJobs();
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`app server listening on http://${host}:${port}`);
  });
  return server;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  startServer();
}
