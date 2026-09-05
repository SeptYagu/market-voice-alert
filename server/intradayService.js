import { filterKlineItemsByDate } from '../src/js/kline.js';
import { chartSecondsToTime, chartTimeToDate } from '../src/js/time.js';
import { getOrRefresh, readCache } from './cacheStore.js';
import { getCachedKline } from './klineService.js';
import {
  fetchAktoolsHistMinute,
  fetchAktoolsIntradayTicks,
  fetchEastmoneyIntradayTrends
} from './marketData.js';
import { normalizeCodeParam, normalizeDateKey, parsePositiveNumber, sanitizeSegment } from './utils.js';

const INTRADAY_TTL_MS = 10 * 1000;
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
  let cumVolume = 0;
  let cumAmount = 0;
  const items = data.items.map((it) => {
    const pct = percent(it.close, prevClose);
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
      percent: pct,
      changePercent: pct
    };
  });
  return {
    code: opts.code,
    name: opts.name || data.name || opts.code,
    source: opts.source || 'eastmoney-kline-1m',
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
      const trendData = await fetchEastmoneyIntradayTrends(common);
      const filtered = filterIntradaySessions(trendData, common.date);
      if (hasItems(filtered)) return filtered;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      errors.push({ source: 'eastmoney-trends2', error: e });
    }
  }

  // 2026-09-04 note: AKShare stock_intraday_em connects to Eastmoney push2 SSE
  // which is frequently blocked/reset (RemoteDisconnected -> HTTP 500).
  // Disabled by default to avoid slow fallback waterfalls, can be enabled via env.
  const ENABLE_AKTOOLS_INTRADAY_TICKS = process.env.ENABLE_AKTOOLS_INTRADAY_TICKS === '1';
  const aktoolsTasks = [];
  if (allowLatestTickSource && ENABLE_AKTOOLS_INTRADAY_TICKS) {
    aktoolsTasks.push({
      source: 'aktools-stock_intraday_em',
      promise: fetchAktoolsIntradayTicks(common)
    });
  }
  aktoolsTasks.push({
    source: 'aktools-stock_zh_a_hist_min_em',
    promise: fetchAktoolsHistMinute(common)
  });
  const aktoolsResults = await Promise.allSettled(aktoolsTasks.map((task) => task.promise));
  for (let i = 0; i < aktoolsResults.length; i++) {
    const result = aktoolsResults[i];
    const source = aktoolsTasks[i].source;
    if (result.status === 'fulfilled') {
      const filtered = filterIntradaySessions(result.value, common.date);
      if (hasItems(filtered)) return filtered;
    } else {
      if (result.reason && result.reason.name === 'AbortError') throw result.reason;
      errors.push({ source, error: result.reason });
    }
  }

  // A minute cache that is a few minutes old is a better immediate fallback
  // than blocking the UI on another multi-upstream K-line refresh. Live quote
  // ticks update the current point while the next background refresh retries.
  const cachedMinute = await readCache(['kline', common.code, '1m.json']);
  if (cachedMinute && cachedMinute.data) {
    const decorated = decorateKlineIntraday(cachedMinute.data, {
      ...common,
      source: 'eastmoney-kline-1m-cache'
    });
    const filtered = filterIntradaySessions(decorated, common.date);
    if (hasItems(filtered)) return filtered;
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
    errors.push({ source: 'eastmoney-kline-1m', error: e });
  }

  if (errors.length) {
    const details = errors.map(({ source, error }) => `${source}: ${error && error.message ? error.message : error}`).join('; ');
    throw new Error(`分时数据源全部失败: ${details}`);
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
  const safePrevClose = prevCloseKey(prevClose);
  const safeName = sanitizeSegment(name) ? String(name) : code;
  const parts = ['intraday', code, `${dateKey}-${safePrevClose}.json`];

  if (!allowLatest) {
    let historical = await readHistoricalCache(parts, INTRADAY_TTL_MS);
    if (!historical) {
      historical = await readHistoricalCache(['intraday', code, `${dateKey}-historical-${safePrevClose}.json`], INTRADAY_TTL_MS);
    }
    if (!historical) {
      historical = await readHistoricalCache(['intraday', code, `${dateKey}-latest-${safePrevClose}.json`], INTRADAY_TTL_MS);
    }
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
    }, allowLatest),
    { skipPrune: true }
  );
  return {
    ...result,
    data: {
      ...result.data,
      name: name || result.data.name || code
    }
  };
}
