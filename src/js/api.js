import {
  parseTencent,
  parseEastmoney,
  parseSinaFuture,
  toEastmoneySecId,
  normalizeCode
} from './parser.js';
import {
  buildKlineUrl,
  buildTencentKlineUrl,
  parseEastmoneyKline,
  parseTencentKline,
  filterKlineItemsByDate
} from './kline.js';
import {
  fetchAktoolsIntradayTicks,
  fetchAktoolsHistMinute
} from './aktoolsApi.js';
import { klineCacheGet, klineCacheSet } from './storage.js';
import { parseBeijingDateTimeToChartSeconds, chartSecondsToTime, chartTimeToDate } from './time.js';
import { isFutureCode } from './futures/instrument.js';
import { fetchFuturesQuotes, fetchFuturesIntraday, fetchFuturesKline } from './futures/futuresApi.js';

const STOCK_RE = /^(sh|sz|bj)\d{6}$/i;
export const FUTURE_RE = /^(?:nf_?)?[a-z]{1,3}\d{1,4}$/i;

export const EASTMONEY_FIELDS = 'f43,f44,f45,f46,f47,f48,f50,f51,f52,f57,f58,f60,f116,f117,f169,f170';
const EASTMONEY_TRENDS_FIELDS1 = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13';
const EASTMONEY_TRENDS_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58';
const INTRADAY_SESSION_RANGES = Object.freeze([
  Object.freeze([9 * 60 + 15, 11 * 60 + 30]),
  Object.freeze([13 * 60, 15 * 60])
]);

export function buildTencentUrl(codes) {
  const list = (Array.isArray(codes) ? codes : [codes])
    .filter((c) => typeof c === 'string' && STOCK_RE.test(c))
    .map((c) => c.toLowerCase());
  if (!list.length) return null;
  return `/api/tencent/q=${list.join(',')}`;
}

export function buildEastmoneyUrl(code) {
  const secid = toEastmoneySecId(code);
  if (!secid) return null;
  return `/api/eastmoney/qt/stock/get?secid=${secid}&fields=${EASTMONEY_FIELDS}`;
}

export function buildEastmoneyTrendsUrl(code) {
  const secid = toEastmoneySecId(code);
  if (!secid) return null;
  const params = [
    `secid=${secid}`,
    `fields1=${EASTMONEY_TRENDS_FIELDS1}`,
    `fields2=${EASTMONEY_TRENDS_FIELDS2}`,
    'ndays=1',
    'iscr=0',
    'iscca=0'
  ];
  return `/api/eastmoney-kline/qt/stock/trends2/get?${params.join('&')}`;
}

export function toSinaFutureSymbol(code) {
  if (!code || typeof code !== 'string') return '';
  const s = code.trim();
  if (/^nf_/i.test(s)) return s;
  if (/^nf[a-z0-9]+$/i.test(s)) return s.toLowerCase();
  return `nf_${s.toUpperCase()}`;
}

export function buildSinaFutureUrl(codes) {
  const list = (Array.isArray(codes) ? codes : [codes])
    .filter((c) => typeof c === 'string' && (FUTURE_RE.test(c) || isFutureCode(c)))
    .map(toSinaFutureSymbol)
    .filter(Boolean);
  if (!list.length) return null;
  return `/api/sina/list=${list.join(',')}`;
}

export function splitCodes(codes) {
  const list = (Array.isArray(codes) ? codes : [codes]).filter(
    (c) => typeof c === 'string' && c.length > 0
  );
  const stocks = list.filter((c) => STOCK_RE.test(c));
  const futures = list.filter((c) => FUTURE_RE.test(c) || isFutureCode(c));
  return { stocks, futures };
}

async function fetchGbkText(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export async function fetchTencent(codes, { signal } = {}) {
  const url = buildTencentUrl(codes);
  if (!url) return [];
  const text = await fetchGbkText(url, signal);
  return parseTencent(text);
}

export async function fetchEastmoneyOne(code, { signal } = {}) {
  const url = buildEastmoneyUrl(code);
  if (!url) return null;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return parseEastmoney(json);
}

export async function fetchEastmoney(codes, opts = {}) {
  const list = Array.isArray(codes) ? codes : [codes];
  const results = await Promise.all(
    list.map((c) => fetchEastmoneyOne(c, opts).catch(() => null))
  );
  return results.filter(Boolean);
}

export async function fetchSinaFuture(codes, { signal } = {}) {
  const url = buildSinaFutureUrl(codes);
  if (!url) return [];
  const text = await fetchGbkText(url, signal);
  return parseSinaFuture(text);
}

export async function fetchQuotes(codes, opts = {}) {
  const { stocks, futures } = splitCodes(codes);
  const tasks = [];

  if (stocks.length) {
    tasks.push(
      fetchTencent(stocks, opts)
        .then((arr) => (arr.length ? arr : fetchEastmoney(stocks, opts)))
        .catch(() => fetchEastmoney(stocks, opts).catch(() => []))
    );
  }
  if (futures.length) {
    tasks.push(
      fetchFuturesQuotes(futures, opts)
        .then((arr) => (arr && arr.length ? arr : fetchSinaFuture(futures, opts)))
        .catch(() => fetchSinaFuture(futures, opts).catch(() => []))
    );
  }

  const results = await Promise.all(tasks);
  return results.flat();
}

function _normalizeTrendCode(data) {
  if (!data || !data.code) return '';
  if (data.market === 1) return `sh${data.code}`;
  return normalizeCode(String(data.code)) || String(data.code);
}

function _calcPercent(close, prevClose) {
  const c = Number(close);
  const pc = Number(prevClose);
  if (!Number.isFinite(c) || !Number.isFinite(pc) || pc <= 0) return 0;
  return (c / pc - 1) * 100;
}

function _isTradingSessionTime(time) {
  const hhmm = chartSecondsToTime(time);
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return INTRADAY_SESSION_RANGES.some(([start, end]) => minutes >= start && minutes <= end);
}

function _filterIntradaySessions(data, selectedDate) {
  if (!data || !Array.isArray(data.items)) return data;
  return {
    ...data,
    items: data.items.filter((it) => {
      if (!it || !Number.isFinite(Number(it.time))) return false;
      if (selectedDate && chartTimeToDate(it.time) !== selectedDate) return false;
      return _isTradingSessionTime(it.time);
    })
  };
}

function _parseTrendRow(row, prevClose, selectedDate) {
  if (typeof row !== 'string') return null;
  const parts = row.split(',');
  if (parts.length < 7) return null;
  const time = parseBeijingDateTimeToChartSeconds(parts[0]);
  if (!Number.isFinite(time)) return null;
  if (selectedDate && chartTimeToDate(time) !== selectedDate) return null;
  const open = parseFloat(parts[1]);
  const close = parseFloat(parts[2]);
  const high = parseFloat(parts[3]);
  const low = parseFloat(parts[4]);
  if (![open, close, high, low].every(Number.isFinite)) return null;
  const volume = parseFloat(parts[5]);
  const amount = parseFloat(parts[6]);
  const avgPrice = parseFloat(parts[7]);
  const percent = _calcPercent(close, prevClose);
  return {
    time,
    open,
    close,
    high,
    low,
    volume: Number.isFinite(volume) ? volume : 0,
    amount: Number.isFinite(amount) ? amount : 0,
    avgPrice: Number.isFinite(avgPrice) ? avgPrice : 0,
    price: close,
    preClose: prevClose,
    percent,
    changePercent: percent
  };
}

export function parseEastmoneyTrends(json, opts = {}) {
  const d = json && json.data;
  if (!d || typeof d !== 'object') return null;
  const preClose = Number.isFinite(Number(d.preClose))
    ? Number(d.preClose)
    : (Number.isFinite(Number(opts.prevClose)) ? Number(opts.prevClose) : 0);
  const rows = Array.isArray(d.trends) ? d.trends : [];
  const selectedDate = opts.date || '';
  const items = [];
  for (const row of rows) {
    const it = _parseTrendRow(row, preClose, selectedDate);
    if (it) items.push(it);
  }
  return {
    code: _normalizeTrendCode(d),
    name: d.name || _normalizeTrendCode(d),
    source: 'eastmoney-trends2',
    preClose,
    items
  };
}

async function fetchEastmoneyTrends(code, opts = {}) {
  const url = buildEastmoneyTrendsUrl(code);
  if (!url) return null;
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return parseEastmoneyTrends(json, opts);
}

function _hasIntradayItems(data) {
  return !!(data && Array.isArray(data.items) && data.items.length);
}

function _decorateKlineIntraday(data, opts = {}) {
  if (!data || !Array.isArray(data.items)) return data;
  const prevClose = Number(opts.prevClose);
  let cumVolume = 0;
  let cumAmount = 0;
  const items = data.items.map((it) => {
    const percent = _calcPercent(it.close, prevClose);
    const vol = Number(it.volume) || 0;
    const amt = Number(it.amount) || 0;
    cumVolume += vol;
    cumAmount += amt;

    let avgPrice = Number(it.avgPrice);
    if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
      if (cumVolume > 0 && cumAmount > 0) {
        const rawRatio = cumAmount / cumVolume;
        const closePrice = Number(it.close);
        if (Number.isFinite(closePrice) && closePrice > 0) {
          if (rawRatio >= closePrice * 0.1 && rawRatio <= closePrice * 10) {
            avgPrice = Math.round(rawRatio * 1000) / 1000;
          } else if ((rawRatio / 100) >= closePrice * 0.1 && (rawRatio / 100) <= closePrice * 10) {
            avgPrice = Math.round((rawRatio / 100) * 1000) / 1000;
          }
        }
      }
    }

    return {
      ...it,
      price: Number(it.close),
      avgPrice: Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice : 0,
      preClose: prevClose || 0,
      percent,
      changePercent: percent
    };
  });
  return { ...data, source: data.source || 'eastmoney-kline-1m', preClose: prevClose || 0, items };
}

export async function fetchIntraday(code, opts = {}) {
  if (isFutureCode(code)) {
    return fetchFuturesIntraday(code, opts);
  }
  let sharedCacheError = null;
  if (opts.sharedCache === true) {
    try {
      const cached = await _fetchIntradayFromSharedCache(code, opts);
      if (cached) return cached;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      sharedCacheError = e;
    }
  }

  const common = {
    code,
    name: opts.name || code,
    date: opts.date,
    prevClose: opts.prevClose,
    signal: opts.signal
  };
  const networkErrors = [];

  // 2026-09-04 note: AKShare stock_intraday_em connects to Eastmoney push2 SSE
  // which is frequently blocked/reset (RemoteDisconnected -> HTTP 500).
  // Can be controlled via opts.enableAktoolsIntradayTicks when direct client fetch is performed.
  const allowTick = opts.enableAktoolsIntradayTicks !== undefined
    ? opts.enableAktoolsIntradayTicks
    : (opts.allowLatestTickSource !== false);
  if (allowTick && opts.sharedCache !== true) {
    try {
      const tickData = await fetchAktoolsIntradayTicks(common);
      const filtered = _filterIntradaySessions(tickData, opts.date);
      if (_hasIntradayItems(filtered)) return filtered;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      networkErrors.push({ source: 'aktools-stock_intraday_em', error: e });
    }
  }

  if (opts.sharedCache !== true) {
    try {
      const histData = await fetchAktoolsHistMinute(common);
      const filtered = _filterIntradaySessions(histData, opts.date);
      if (_hasIntradayItems(filtered)) return filtered;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      networkErrors.push({ source: 'aktools-stock_zh_a_hist_min_em', error: e });
    }
  }

  if (opts.allowLatestTickSource !== false) {
    try {
      const trendData = await fetchEastmoneyTrends(code, common);
      const filtered = _filterIntradaySessions(trendData, opts.date);
      if (_hasIntradayItems(filtered)) return filtered;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      networkErrors.push({ source: 'eastmoney-trends2', error: e });
    }
  }

  try {
    const klineData = await fetchKline(code, {
      period: '1m',
      signal: opts.signal
    });
    if (klineData) {
      const items = filterKlineItemsByDate(klineData.items, opts.date);
      const decorated = _decorateKlineIntraday({ ...klineData, items }, common);
      const filtered = _filterIntradaySessions(decorated, opts.date);
      if (_hasIntradayItems(filtered)) return filtered;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    networkErrors.push({ source: 'eastmoney-kline-1m', error: e });
  }

  if (networkErrors.length) {
    const allErrors = sharedCacheError
      ? [{ source: 'shared-cache', error: sharedCacheError }, ...networkErrors]
      : networkErrors;
    const details = allErrors
      .map(({ source, error }) => `${source}: ${error && error.message ? error.message : error}`)
      .join('; ');
    throw new Error(`分时数据源全部失败: ${details}`);
  }
  return { code, name: opts.name || code, source: 'none', preClose: Number(opts.prevClose) || 0, items: [] };
}

async function _fetchIntradayFromSharedCache(code, opts = {}) {
  const usp = new URLSearchParams();
  usp.set('code', code);
  if (opts.date) usp.set('date', opts.date);
  if (opts.name) usp.set('name', opts.name);
  if (opts.prevClose !== undefined && opts.prevClose !== null) usp.set('prevClose', String(opts.prevClose));
  if (opts.allowLatestTickSource === false) usp.set('allowLatestTickSource', '0');
  const res = await fetch(`/api/cache/intraday?${usp.toString()}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json || json.ok !== true || !json.data) {
    throw new Error((json && json.error) || 'shared intraday cache failed');
  }
  return json.data;
}

function _attachCallerSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    };
    signal.addEventListener('abort', onAbort);
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export function fetchKline(code, opts = {}) {
  if (!code) return Promise.reject(new Error('code is required'));
  const period = opts.period || '1d';
  if (isFutureCode(code)) {
    return fetchFuturesKline(code, period, opts);
  }
  const key = `${code}|${period}`;

  // 1. In-flight dedup: same (code, period) concurrent calls share one promise decoupled from caller signal
  if (inflightKline.has(key)) {
    return _attachCallerSignal(inflightKline.get(key), opts.signal);
  }

  // 2. klineCache hit (SWR): return immediately, revalidate in background
  if (!opts.noCache) {
    const cached = klineCacheGet(code, period);
    if (cached) {
      _scheduleKlineRevalidate(code, period, opts);
      return Promise.resolve(cached);
    }
  }

  // 3. Cache miss: create shared promise with independent lifecycle
  const p = (async () => {
    try {
      const data = opts.sharedCache === true && !opts.noCache
        ? await _fetchKlineFromSharedCache(code, period, undefined).catch((e) => {
          if (e && e.name === 'AbortError') throw e;
          return _fetchKlineFromNetwork(code, period, undefined);
        })
        : await _fetchKlineFromNetwork(code, period, undefined);
      if (data && !opts.noCache) {
        klineCacheSet(code, period, data);
        emitKlineUpdated(code, period, data);
      }
      return data;
    } finally {
      inflightKline.delete(key);
    }
  })();
  inflightKline.set(key, p);
  return _attachCallerSignal(p, opts.signal);
}

async function _fetchKlineFromSharedCache(code, period, signal) {
  const usp = new URLSearchParams();
  usp.set('code', code);
  usp.set('period', period);
  const res = await fetch(`/api/cache/kline?${usp.toString()}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json || json.ok !== true || !json.data) {
    throw new Error((json && json.error) || 'shared kline cache failed');
  }
  return json.data;
}

async function _fetchKlineFromNetwork(code, period, signal) {
  // Primary: Eastmoney (richer fields/longer history); with 1 retry on transient errors.
  const opts = { period, signal };
  const emUrl = buildKlineUrl(code, opts);
  if (emUrl) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(emUrl, { signal });
        if (res.ok) {
          const json = await res.json();
          const parsed = parseEastmoneyKline(json);
          if (parsed && parsed.items && parsed.items.length) return parsed;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
      }
    }
  }
  // Fallback: Tencent kline
  const txUrl = buildTencentKlineUrl(code, opts);
  if (!txUrl) {
    if (!emUrl) return null;
    throw new Error('K 线请求失败：东财不可用且无可用备用源');
  }
  const res = await fetch(txUrl, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return parseTencentKline(json, period);
}

const inflightKline = new Map();
const _revalidatingKline = new Set();  // dedup SWR revalidations

function _scheduleKlineRevalidate(code, period, opts = {}) {
  const key = `${code}|${period}`;
  if (_revalidatingKline.has(key)) return;
  _revalidatingKline.add(key);
  setTimeout(() => {
    const refresh = opts.sharedCache === true
      ? _fetchKlineFromSharedCache(code, period, null).catch(() => _fetchKlineFromNetwork(code, period, null))
      : _fetchKlineFromNetwork(code, period, null);
    refresh
      .then((data) => {
        if (data) {
          klineCacheSet(code, period, data);
          emitKlineUpdated(code, period, data);
        }
      })
      .catch(() => { /* best-effort */ })
      .finally(() => {
        _revalidatingKline.delete(key);
      });
  }, 0);
}

// =====================================================================
// klineUpdated event bus (Phase 8 SWR notifications)
// =====================================================================
const _klineUpdatedListeners = new Set();

export function onKlineUpdated(fn) {
  if (typeof fn !== 'function') return () => {};
  _klineUpdatedListeners.add(fn);
  return () => _klineUpdatedListeners.delete(fn);
}

function emitKlineUpdated(code, period, data) {
  for (const fn of _klineUpdatedListeners) {
    try { fn(code, period, data); } catch { /* ignore listener errors */ }
  }
}
