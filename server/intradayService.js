import { filterKlineItemsByDate } from '../src/js/kline.js';
import { chartSecondsToTime, chartTimeToDate } from '../src/js/time.js';
import { computeVwap } from '../src/js/services/quoteMath.js';
import { getOrRefresh, readCache } from './cacheStore.js';
import { getCachedKline } from './klineService.js';
import {
  fetchAktoolsHistMinute,
  fetchAktoolsIntradayTicks,
  fetchEastmoneyIntradayTrends,
  fetchTencentIntradayMinutes
} from './marketData.js';
import { normalizeCodeParam, normalizeDateKey, parsePositiveNumber } from './utils.js';

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
      avgPrice = computeVwap(cumAmount, cumVolume, it.close);
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

function beijingStamp(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date(Number(ms)));
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    date: `${pick('year')}-${String(pick('month')).padStart(2, '0')}-${String(pick('day')).padStart(2, '0')}`,
    minutes: pick('hour') * 60 + pick('minute')
  };
}

// A snapshot captured while the session was still running only contains part
// of the day (e.g. fetched at 10:30 -> chart shows "morning only" forever,
// and its last close never matches the daily K-line). Snapshots generated on
// a later day, or after 15:05 Beijing, are treated as complete archives.
function isHistoricalSnapshotComplete(generatedAtMs, dateDash, data) {
  // A new write time does not make an old morning-only fallback complete.
  if (data?.archiveComplete === false || !data?.items?.some((item) =>
    chartTimeToDate(item.time) === dateDash && chartSecondsToTime(item.time) === '15:00')) return false;
  const n = Number(generatedAtMs);
  if (!Number.isFinite(n) || n <= 0) return false;
  const stamp = beijingStamp(n);
  if (stamp.date !== dateDash) return true;
  return stamp.minutes >= 15 * 60 + 5;
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
    // 2026-09-10: Tencent minute/query is the primary intraday source —
    // independent of Eastmoney infra, 10/10 stable in live probes while the
    // push2his main host failed 0/10 with socket resets.
    try {
      const tencentData = await fetchTencentIntradayMinutes(common);
      const filtered = filterIntradaySessions(tencentData, common.date);
      if (hasItems(filtered)) return filtered;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      errors.push({ source: 'tencent-minute', error: e });
    }
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

  // The intraday snapshot cache (intraday/{code}/{date}.json) is rewritten on
  // every successful poll (~10s TTL), so when every network source fails the
  // FRESHEST fallback is simply to throw here: getOrRefresh then serves the
  // last good intraday snapshot with its original generatedAt. A raw read of
  // the kline/1m.json cache used to intercept this path with a much older
  // snapshot (the "straight-line gap" regression), so it was removed.
  try {
    const klineResult = await getCachedKline({
      code: common.code,
      period: '1m',
      signal: common.signal
    });
    const klineData = klineResult && klineResult.data;
    // Today: only trust a freshly fetched 1-minute source. A stale kline
    // cache (network failed, getOrRefresh served its own old copy) is older
    // than the intraday snapshot and must not shadow it. Historical dates
    // still accept stale kline data — that is how closing archives recover
    // when AKTools is down.
    if (klineData && (!allowLatestTickSource || klineResult.source === 'network')) {
      const items = filterKlineItemsByDate(klineData.items, common.date);
      const decorated = decorateKlineIntraday({ ...klineData, items }, common);
      const filtered = filterIntradaySessions(decorated, common.date);
      if (hasItems(filtered)) {
        // A stale-served kline cache whose generatedAt is same-day after the
        // close is still a complete, trustworthy archive — completeness is
        // decided by isHistoricalSnapshotComplete, not by the envelope.
        const archiveComplete = isHistoricalSnapshotComplete(klineResult.generatedAt, common.date, filtered);
        return { ...filtered, upstreamStale: !archiveComplete && !!klineResult.stale, archiveComplete };
      }
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
  const safeName = code;
  const parts = ['intraday', code, `${dateKey}-${safePrevClose}.json`];

  if (!allowLatest) {
    let historical = await readHistoricalCache(parts, INTRADAY_TTL_MS);
    if (!historical) {
      historical = await readHistoricalCache(['intraday', code, `${dateKey}-historical-${safePrevClose}.json`], INTRADAY_TTL_MS);
    }
    if (!historical) {
      historical = await readHistoricalCache(['intraday', code, `${dateKey}-latest-${safePrevClose}.json`], INTRADAY_TTL_MS);
    }
    if (historical && isHistoricalSnapshotComplete(historical.generatedAt, selectedDate, historical.data)) {
      historical.data = { ...historical.data, name: name || historical.data.name || code };
      return historical;
    }
    if (historical) {
      // Mid-session snapshot frozen in cache: re-archive the complete session
      // from the historical network sources. getOrRefresh falls back to the
      // stale snapshot when every upstream fails, so the chart stays usable.
      const refreshed = await getOrRefresh(
        parts,
        INTRADAY_TTL_MS,
        () => fetchIntradayNetwork({
          code,
          name: safeName,
          date: selectedDate,
          prevClose,
          signal
        }, false),
        { skipPrune: true }
      );
      return {
        ...refreshed,
        stale: refreshed.stale || !!refreshed.data?.upstreamStale ||
          (isHistoricalDate(dateKey) && refreshed.data?.archiveComplete === false),
        data: {
          ...refreshed.data,
          name: name || refreshed.data.name || code
        }
      };
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
    stale: result.stale || !!result.data?.upstreamStale ||
      (isHistoricalDate(dateKey) && result.data?.archiveComplete === false),
    data: {
      ...result.data,
      name: name || result.data.name || code
    }
  };
}
