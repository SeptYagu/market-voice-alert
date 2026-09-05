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
import { PRODUCT_MAP } from './futures/contractCatalog.js';
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
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS,HEAD',
      'access-control-allow-headers': 'content-type'
    });
    res.end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'POST' && path === '/api/cache/momentum/ten-day/scan') {
    // Guard against CSRF and DNS rebinding (review item B1). The scan endpoint
    // triggers thousands of upstream requests, so only trusted origins may
    // start it: loopback hosts, private-network (LAN) addresses reached
    // same-origin (e.g. http://192.168.x.x:3001 from another home device),
    // plus an optional env allowlist for domain-based access.
    // A DNS-rebinding page keeps its public Host/Origin hostname, which is
    // neither a private IP nor same-host-with-private-IP, so it stays blocked.
    const allowedHosts = (process.env.MOMENTUM_SCAN_ALLOWED_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const hostHeader = (req.headers.host || '').toLowerCase().trim();
    const hostHostname = hostHeader.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '');
    const isLoopbackHost = ['127.0.0.1', 'localhost', '::1'].includes(hostHostname);
    const isPrivateIpHost = (() => {
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostHostname);
      if (!m) return false;
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a === 127 || a === 10) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
      return false;
    })();
    const hostAllowed = isLoopbackHost || isPrivateIpHost || allowedHosts.includes(hostHostname);
    if (!hostAllowed) {
      jsonResponse(res, 403, errorEnvelope(
        `Forbidden: Scan requests are only allowed from localhost or a private-network host (got Host "${hostHeader || '(missing)'}"). ` +
        'For domain-based access, add the hostname to the MOMENTUM_SCAN_ALLOWED_HOSTS env var.'
      ));
      return;
    }
    const origin = req.headers.origin || req.headers.referer;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const originHost = originUrl.hostname.toLowerCase();
        const originIsLoopback = ['127.0.0.1', 'localhost', '::1'].includes(originHost);
        const sameHost = originHost === hostHostname;
        const loopbackPair = isLoopbackHost && originIsLoopback;
        if (!sameHost && !loopbackPair) {
          jsonResponse(res, 403, errorEnvelope('Forbidden: Cross-origin scan request rejected'));
          return;
        }
      } catch {
        jsonResponse(res, 400, errorEnvelope('Invalid Origin or Referer header'));
        return;
      }
    }
    const date = url.searchParams.get('date');
    const threshold = url.searchParams.get('threshold');
    if (date && !/^\d{8}$/.test(date.trim()) && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      jsonResponse(res, 400, errorEnvelope('Invalid date parameter; expected YYYYMMDD or YYYY-MM-DD'));
      return;
    }
    // Register the single-flight job before replying so an immediate GET poll
    // cannot observe the old empty cache between POST and task startup.
    const job = startTenDayMomentumScan({ date, threshold, reason: 'manual' });
    const jobPromise = job && typeof job.then === 'function' ? job : (job && job.promise);
    if (jobPromise && typeof jobPromise.catch === 'function') {
      jobPromise.catch((err) => {
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
  if (req.method !== 'GET' && req.method !== 'HEAD') {
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
      if (!ids.length) {
        jsonResponse(res, 400, errorEnvelope('Missing ids parameter'));
        return;
      }
      const result = await getCachedFuturesQuotes(ids);
      const isStale = Array.isArray(result) && result.length > 0 && result.some((q) => q && q.stale);
      jsonResponse(res, 200, okEnvelope({
        source: 'server-futures-quote',
        stale: isStale,
        ttlMs: 3000,
        data: result
      }));
      return;
    }

    if (path === '/api/cache/futures/contracts') {
      const contracts = Object.entries(PRODUCT_MAP).map(([prod, info]) => ({
        product: prod,
        symbol: `${prod}0`,
        code: `${prod.toLowerCase()}0`,
        name: info.name,
        exchange: info.exchange,
        isFinancial: !!info.isFinancial,
        isTreasury: !!info.isTreasury,
        priceTick: info.tick,
        contractMultiplier: info.mult,
        nightSessionEnd: info.night
      }));
      jsonResponse(res, 200, okEnvelope({
        source: 'server-futures-catalog',
        stale: false,
        ttlMs: 86400000,
        data: contracts
      }));
      return;
    }

    if (path === '/api/cache/futures/kline') {
      const id = url.searchParams.get('id') || url.searchParams.get('symbol');
      if (!id) {
        jsonResponse(res, 400, errorEnvelope('Missing id parameter'));
        return;
      }
      const period = url.searchParams.get('period') || 'day';
      try {
        const result = await getCachedFuturesKline(id, period);
        jsonResponse(res, 200, okEnvelope({
          source: (result && result.source) || 'server-futures-kline',
          stale: !!(result && result.stale),
          ttlMs: (result && result.ttlMs) || 10000,
          data: result
        }));
      } catch (err) {
        jsonResponse(res, 400, errorEnvelope(err.message));
      }
      return;
    }

    if (path === '/api/cache/futures/intraday') {
      const id = url.searchParams.get('id') || url.searchParams.get('symbol');
      if (!id) {
        jsonResponse(res, 400, errorEnvelope('Missing id parameter'));
        return;
      }
      const date = url.searchParams.get('date') || url.searchParams.get('tradingDay');
      const result = await getCachedFuturesIntraday(id, { date });
      jsonResponse(res, 200, okEnvelope({
        source: (result && result.source) || 'server-futures-intraday',
        stale: !!(result && result.stale),
        ttlMs: (result && result.ttlMs) || 10000,
        data: result
      }));
      return;
    }

    if (path === '/api/cache/futures/session') {
      const id = url.searchParams.get('id') || url.searchParams.get('symbol');
      if (!id) {
        jsonResponse(res, 400, errorEnvelope('Missing id parameter'));
        return;
      }
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
      if (res && !res.headersSent && !res.destroyed) {
        try {
          jsonResponse(res, 500, errorEnvelope(err && err.message ? err.message : String(err)));
        } catch {
          // ignore error writing to destroyed socket
        }
      }
    });
  });
}

export function startBackgroundJobs() {
  if (process.env.DISABLE_BACKGROUND_JOBS === '1') return;
  startMomentumScheduler();
}

export function startServer({
  port = Number(process.env.PORT || process.env.CACHE_SERVER_PORT || DEFAULT_PORT),
  host = process.env.HOST || '127.0.0.1'
} = {}) {
  if (!process.__server_uncaught_registered) {
    process.__server_uncaught_registered = true;
    process.on('uncaughtException', (err) => {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[Server] Uncaught exception guarded:', err);
      }
    });
  }
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
