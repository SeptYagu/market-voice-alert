import { filterKlineItemsByDate } from '../src/js/kline.js';
import { chartSecondsToTime, chartTimeToDate } from '../src/js/time.js';
import { getOrRefresh, readCache } from './cacheStore.js';
import { getCachedKline } from './klineService.js';
import { fetchAktoolsHistMinute, fetchAktoolsIntradayTicks } from './marketData.js';
import { normalizeCodeParam, normalizeDateKey, parsePositiveNumber, sanitizeSegment } from './utils.js';

const INTRADAY_TTL_MS = 60 * 1000;
const SESSION_RANGES = Object.freeze([
  Object.freeze([9 * 60 + 15, 11 * 60 + 30]),
  Object.freeze([13 * 60, 15 * 60])
]);

function dateKeyToDash(dateKey) {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

function isHistoricalDate(dateKey) {
  const todayKey = normalizeDateKey(null);
  return /^\d{8}$/.test(dateKey) && dateKey < todayKey;
}

function isTradingSessionTime(time) {
  const hhmm = chartSecondsToTime(time);
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return SESSION_RANGES.some(([start, end]) => minutes >= start && minutes <= end);
}

function filterIntradaySessions(data, selectedDate) {
  if (!data || !Array.isArray(data.items)) return data;
  return {
    ...data,
    items: data.items.filter((it) => {
      if (!it || !Number.isFinite(Number(it.time))) return false;
      if (selectedDate && chartTimeToDate(it.time) !== selectedDate) return false;
      return isTradingSessionTime(it.time);
    })
  };
}

function hasItems(data) {
  return !!(data && Array.isArray(data.items) && data.items.length);
}

function percent(close, prevClose) {
  const c = Number(close);
  const pc = Number(prevClose);
  if (!Number.isFinite(c) || !Number.isFinite(pc) || pc <= 0) return 0;
  return (c / pc - 1) * 100;
}

function decorateKlineIntraday(data, opts = {}) {
  if (!data || !Array.isArray(data.items)) return data;
  const prevClose = Number(opts.prevClose);
  const items = data.items.map((it) => {
    const pct = percent(it.close, prevClose);
    return {
      ...it,
      price: Number(it.close),
      avgPrice: Number.isFinite(Number(it.avgPrice)) ? Number(it.avgPrice) : 0,
      preClose: prevClose || 0,
      percent: pct,
      changePercent: pct
    };
  });
  return {
    code: opts.code,
    name: opts.name || data.name || opts.code,
    source: 'eastmoney-kline-1m',
    preClose: prevClose || 0,
    items
  };
}

function prevCloseKey(prevClose) {
  const value = parsePositiveNumber(prevClose, 0);
  return String(value.toFixed(4)).replace(/\./g, 'p');
}

async function readHistoricalCache(parts, ttlMs) {
  const cached = await readCache(parts);
  if (!cached || !Object.prototype.hasOwnProperty.call(cached, 'data')) return null;
  return {
    source: 'cache',
    stale: false,
    generatedAt: cached.generatedAt,
    ttlMs: cached.ttlMs || ttlMs,
    data: cached.data
  };
}

async function fetchIntradayNetwork(common, allowLatestTickSource) {
  const errors = [];
  if (allowLatestTickSource) {
    try {
      const tickData = await fetchAktoolsIntradayTicks(common);
      const filtered = filterIntradaySessions(tickData, common.date);
      if (hasItems(filtered)) return filtered;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      errors.push(e);
    }
  }

  try {
    const histData = await fetchAktoolsHistMinute(common);
    const filtered = filterIntradaySessions(histData, common.date);
    if (hasItems(filtered)) return filtered;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    errors.push(e);
  }

  try {
    const klineResult = await getCachedKline({
      code: common.code,
      period: '1m',
      signal: common.signal
    });
    const klineData = klineResult && klineResult.data;
    if (klineData) {
      const items = filterKlineItemsByDate(klineData.items, common.date);
      const decorated = decorateKlineIntraday({ ...klineData, items }, common);
      const filtered = filterIntradaySessions(decorated, common.date);
      if (hasItems(filtered)) return filtered;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    errors.push(e);
  }

  if (errors.length) {
    const last = errors[errors.length - 1];
    throw new Error(last && last.message ? last.message : '未能获取分时数据');
  }
  return {
    code: common.code,
    name: common.name || common.code,
    source: 'none',
    preClose: Number(common.prevClose) || 0,
    items: []
  };
}

export async function getCachedIntraday({
  code: rawCode,
  date,
  name,
  prevClose,
  allowLatestTickSource = true,
  signal
} = {}) {
  const code = normalizeCodeParam(rawCode);
  const dateKey = normalizeDateKey(date);
  if (!code || !dateKey) {
    const err = new Error('Invalid code or date');
    err.statusCode = 400;
    throw err;
  }

  const selectedDate = dateKeyToDash(dateKey);
  const allowLatest = allowLatestTickSource && !isHistoricalDate(dateKey);
  const mode = allowLatest ? 'latest' : 'historical';
  const safePrevClose = prevCloseKey(prevClose);
  const safeName = sanitizeSegment(name) ? String(name) : code;
  const parts = ['intraday', code, `${dateKey}-${mode}-${safePrevClose}.json`];

  if (!allowLatest) {
    const historical = await readHistoricalCache(parts, INTRADAY_TTL_MS);
    if (historical) {
      historical.data = { ...historical.data, name: name || historical.data.name || code };
      return historical;
    }
  }

  const result = await getOrRefresh(
    parts,
    INTRADAY_TTL_MS,
    () => fetchIntradayNetwork({
      code,
      name: safeName,
      date: selectedDate,
      prevClose,
      signal
    }, allowLatest)
  );
  return {
    ...result,
    data: {
      ...result.data,
      name: name || result.data.name || code
    }
  };
}
