import { readCache, writeCache } from './cacheStore.js';
import { getKlineDataForMomentum } from './klineService.js';
import { getCachedSpotLatest } from './spotService.js';
import { getCachedTradeCalendar } from './calendarService.js';
import { isFresh, normalizeDateKey, nowMs, parsePositiveNumber } from './utils.js';

const MOMENTUM_TTL_MS = 5 * 60 * 1000;
const DEFAULT_THRESHOLD = 45;
const LOOKBACK_DAYS = 10;
const CONCURRENCY = 32;
const SCHEDULED_SCAN_TIMES = Object.freeze([
  Object.freeze({ hour: 8, minute: 0, label: 'pre-open' }),
  Object.freeze({ hour: 15, minute: 5, label: 'after-close' })
]);
const JOBS = new Map();
let schedulerTimer = null;
let schedulerStarted = false;

function klineDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}${match[2]}${match[3]}` : '';
}

function dashDate(dateKey) {
  return /^\d{8}$/.test(String(dateKey || ''))
    ? `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`
    : '';
}

function previousWeekday(dateKey) {
  if (!/^\d{8}$/.test(String(dateKey || ''))) return '';
  const date = new Date(Date.UTC(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(4, 6)) - 1,
    Number(dateKey.slice(6, 8))
  ));
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function beijingMinuteOfDay(now = new Date()) {
  const parts = beijingParts(now);
  return parts.hour * 60 + parts.minute;
}

export function resolveMomentumScanDates(dateKey, tradeDates, todayKey = beijingDateKey(), now = new Date()) {
  const normalizedDates = (Array.isArray(tradeDates) ? tradeDates : [])
    .map((date) => normalizeDateKey(date))
    .filter(Boolean)
    .sort();
  const eligible = normalizedDates.filter((date) => date <= dateKey);
  const marketDate = eligible[eligible.length - 1] || dateKey;
  const isLiveTradingDay = dateKey === todayKey && marketDate === todayKey;
  if (!isLiveTradingDay) {
    return { marketDate, historyTargetDate: marketDate, liveDate: '' };
  }
  if (beijingMinuteOfDay(now) >= 15 * 60 + 5) {
    return { marketDate, historyTargetDate: marketDate, liveDate: '' };
  }
  const prior = normalizedDates.filter((date) => date < marketDate).at(-1) || previousWeekday(marketDate);
  return { marketDate, historyTargetDate: prior, liveDate: marketDate };
}

export function mergeLiveQuoteIntoDailyKline(data, quote, liveDateKey) {
  const sourceItems = data && Array.isArray(data.items) ? data.items : [];
  const price = Number(quote && quote.price);
  const open = Number(quote && quote.open);
  const volume = Number(quote && quote.volume);
  if (!liveDateKey || !Number.isFinite(price) || price <= 0 || (!(open > 0) && !(volume > 0))) return data;
  const time = dashDate(liveDateKey);
  if (!time) return data;
  const high = Math.max(price, Number(quote.high) || 0, open || 0);
  const positiveLows = [price, Number(quote.low), open].filter((value) => Number.isFinite(value) && value > 0);
  const bar = {
    time,
    open: open > 0 ? open : price,
    close: price,
    high,
    low: positiveLows.length ? Math.min(...positiveLows) : price,
    volume: volume > 0 ? volume : 0,
    amount: Math.max(0, Number(quote.amount) || 0),
    changePercent: Number(quote.changePercent) || 0
  };
  const items = sourceItems.slice();
  const lastDate = klineDateKey(items.at(-1) && items.at(-1).time);
  if (lastDate === liveDateKey) items[items.length - 1] = { ...items.at(-1), ...bar };
  else if (!lastDate || lastDate < liveDateKey) items.push(bar);
  else return data;
  return { ...(data || {}), items };
}

export function computeTenDayMomentum(klineData, lookbackDays = LOOKBACK_DAYS, cutoffDate = '') {
  const cutoffKey = normalizeDateKey(cutoffDate) || '';
  const sourceItems = klineData && Array.isArray(klineData.items) ? klineData.items : [];
  const items = cutoffKey
    ? sourceItems.filter((item) => {
      const itemDate = klineDateKey(item && item.time);
      return itemDate && itemDate <= cutoffKey;
    })
    : sourceItems;
  if (items.length < lookbackDays + 1) return null;
  const end = items[items.length - 1];
  const start = items[items.length - 1 - lookbackDays];
  const startClose = Number(start.close);
  const lastClose = Number(end.close);
  if (!Number.isFinite(startClose) || !Number.isFinite(lastClose) || startClose <= 0) return null;
  const gainPercent = (lastClose / startClose - 1) * 100;
  return {
    lookbackDays,
    startTime: start.time,
    endTime: end.time,
    endDateKey: klineDateKey(end.time),
    startClose,
    lastClose,
    gainPercent: Number(gainPercent.toFixed(2))
  };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await fn(items[idx], idx);
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function cacheParts(dateKey, threshold) {
  const thresholdKey = String(threshold).replace(/\./g, 'p');
  return ['momentum', dateKey, `ten-day-${thresholdKey}pct.json`];
}

function successCacheParts(dateKey, threshold) {
  const thresholdKey = String(threshold).replace(/\./g, 'p');
  return ['momentum', dateKey, `ten-day-${thresholdKey}pct-success.json`];
}

function beijingParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(now);
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute')
  };
}

function beijingDateKey(now = new Date()) {
  const p = beijingParts(now);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

function normalizeMomentumDate(raw) {
  if (raw === null || raw === undefined || raw === '') return beijingDateKey();
  return normalizeDateKey(raw);
}

function beijingLocalDate(parts, hour, minute) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 8, minute, 0, 0));
}

function nextScheduledScan(now = new Date()) {
  const current = beijingParts(now);
  let best = null;
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const base = new Date(Date.UTC(current.year, current.month - 1, current.day + dayOffset, 0, 0, 0, 0));
    const parts = {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate()
    };
    for (const slot of SCHEDULED_SCAN_TIMES) {
      const at = beijingLocalDate(parts, slot.hour, slot.minute);
      const delayMs = at.getTime() - now.getTime();
      if (delayMs <= 0) continue;
      if (!best || delayMs < best.delayMs) best = { ...slot, delayMs };
    }
  }
  return best || { ...SCHEDULED_SCAN_TIMES[0], delayMs: 60 * 60 * 1000 };
}

async function writeMomentumProgress(parts, data) {
  await writeCache(parts, {
    generatedAt: nowMs(),
    ttlMs: MOMENTUM_TTL_MS,
    data
  }, { skipPrune: true });
}

function emptyMomentumData(dateKey, threshold, message) {
  return {
    status: 'empty',
    date: dateKey,
    threshold,
    lookbackDays: LOOKBACK_DAYS,
    universeSize: 0,
    scanned: 0,
    items: [],
    message
  };
}

async function buildMomentum({ dateKey, threshold, parts, signal, jobStartedAt }) {
  const spotResult = await getCachedSpotLatest({ signal });
  const universe = spotResult && spotResult.data && Array.isArray(spotResult.data.items)
    ? spotResult.data.items
    : [];
  const found = [];
  const endDateCounts = new Map();
  let latestMarketDate = '';
  let refreshFailures = 0;
  const sourceStats = {};
  const failureReasons = {};
  const failureSamples = [];
  let tradeDates = [];
  try {
    const calendar = await getCachedTradeCalendar({ signal });
    tradeDates = calendar && calendar.data && Array.isArray(calendar.data.dates) ? calendar.data.dates : [];
  } catch {
    // Weekday fallback in resolveMomentumScanDates keeps scans usable if the calendar source is down.
  }
  const scanDates = resolveMomentumScanDates(dateKey, tradeDates);
  const universeStats = spotResult && spotResult.data && spotResult.data.universeStats
    ? spotResult.data.universeStats
    : {};
  const batchUniverseFailures = Array.isArray(universeStats.failedBatches)
    ? universeStats.failedBatches.reduce((sum, batch) => sum + (Number(batch.count) || 0), 0)
    : 0;
  const universeRefreshFailures = batchUniverseFailures + (spotResult && spotResult.stale ? universe.length : 0);
  const liveDate = spotResult && spotResult.stale ? '' : scanDates.liveDate;
  const scanned = { count: 0 };
  let progressWrite = Promise.resolve();
  await writeMomentumProgress(parts, {
    status: 'scanning',
    date: dateKey,
    threshold,
    lookbackDays: LOOKBACK_DAYS,
    jobStartedAt,
    universeSize: universe.length,
    scanned: 0,
    items: []
  });
  await mapLimit(universe, CONCURRENCY, async (candidate) => {
    if (!candidate || !/^(sh|sz|bj)\d{6}$/i.test(candidate.code)) return null;
    try {
      const klineResult = await getKlineDataForMomentum(candidate.code, signal, scanDates.historyTargetDate);
      const source = klineResult && klineResult.upstreamSource ? klineResult.upstreamSource : 'unknown';
      sourceStats[source] = (sourceStats[source] || 0) + 1;
      if (!klineResult || !klineResult.fresh) {
        refreshFailures += 1;
        const reason = klineResult && klineResult.upstreamError ? klineResult.upstreamError : 'stale-kline';
        failureReasons[reason] = (failureReasons[reason] || 0) + 1;
        if (failureSamples.length < 20) failureSamples.push({ code: candidate.code, reason });
        return null;
      }
      const data = mergeLiveQuoteIntoDailyKline(klineResult && klineResult.data, candidate, liveDate);
      const stats = computeTenDayMomentum(data, LOOKBACK_DAYS, dateKey);
      if (stats && stats.endDateKey) {
        latestMarketDate = latestMarketDate > stats.endDateKey ? latestMarketDate : stats.endDateKey;
        endDateCounts.set(stats.endDateKey, (endDateCounts.get(stats.endDateKey) || 0) + 1);
      }
      if (!stats || stats.gainPercent < threshold) return null;
      const { endDateKey: _endDateKey, ...publicStats } = stats;
      const item = {
        code: candidate.code,
        name: candidate.name || (data && data.name) || candidate.code,
        price: Number(candidate.price) || stats.lastClose,
        changePercent: Number(candidate.changePercent) || 0,
        amount: Number(candidate.amount) || 0,
        volumeRatio: Number(candidate.volumeRatio) || 0,
        industry: candidate.industry || '',
        reason: candidate.reason || '',
        interpretation: candidate.interpretation || '',
        limitStats: candidate.limitStats || '',
        anomaly: `10日涨幅超${threshold}%`,
        ...publicStats,
        marketDate: stats.endDateKey
      };
      found.push(item);
      return item;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      refreshFailures += 1;
      const reason = e && e.message ? e.message : String(e);
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
      if (failureSamples.length < 20) failureSamples.push({ code: candidate && candidate.code, reason });
      return null;
    } finally {
      scanned.count += 1;
      if (scanned.count > 0 && scanned.count % 100 === 0) {
        const progress = {
          status: 'scanning',
          date: dateKey,
          threshold,
          lookbackDays: LOOKBACK_DAYS,
          jobStartedAt,
          universeSize: universe.length,
          scanned: scanned.count,
          latestMarketDate,
          freshUniverseSize: endDateCounts.get(latestMarketDate) || 0,
          refreshFailures,
          sourceStats,
          failureReasons,
          failureSamples,
          items: found
            .filter((item) => item.marketDate === latestMarketDate)
            .slice()
            .sort((a, b) => (b.gainPercent || 0) - (a.gainPercent || 0))
        };
        progressWrite = progressWrite.then(() => writeMomentumProgress(parts, progress));
        await progressWrite;
      }
    }
  });
  await progressWrite;
  const freshFound = found
    .filter((item) => item.marketDate === latestMarketDate)
    .sort((a, b) => (b.gainPercent || 0) - (a.gainPercent || 0));
  return {
    status: refreshFailures > 0 || universeRefreshFailures > 0 ? 'partial' : 'complete',
    date: dateKey,
    threshold,
    lookbackDays: LOOKBACK_DAYS,
    jobStartedAt,
    universeSize: universe.length,
    scanned: scanned.count,
    latestMarketDate,
    freshUniverseSize: endDateCounts.get(latestMarketDate) || 0,
    refreshFailures,
    universeRefreshFailures,
    spotSource: spotResult && spotResult.data ? spotResult.data.source : '',
    universeStats,
    sourceStats,
    failureReasons,
    failureSamples,
    historyTargetDate: scanDates.historyTargetDate,
    message: refreshFailures > 0 || universeRefreshFailures > 0
      ? `${refreshFailures} 只股票的日 K 刷新失败，${universeRefreshFailures} 只股票的实时快照缺失；最新交易日覆盖 ${endDateCounts.get(latestMarketDate) || 0}/${universe.length}，仅展示有效结果`
      : '',
    items: freshFound
  };
}

export async function getCachedTenDayMomentum({ date, threshold: rawThreshold, signal: _signal } = {}) {
  const dateKey = normalizeMomentumDate(date);
  const threshold = parsePositiveNumber(rawThreshold, DEFAULT_THRESHOLD);
  if (!dateKey) {
    const err = new Error('Invalid date');
    err.statusCode = 400;
    throw err;
  }
  const parts = cacheParts(dateKey, threshold);
  const cached = await readCache(parts, { skipTouch: true });
  const jobKey = `${dateKey}|${threshold}`;
  if (JOBS.has(jobKey)) {
    const jobState = JOBS.get(jobKey);
    const priorData = cached && cached.data ? cached.data : {};
    const sameJob = Number(priorData.jobStartedAt) === Number(jobState.startedAt);
    return {
      source: 'job',
      stale: false,
      generatedAt: nowMs(),
      ttlMs: MOMENTUM_TTL_MS,
      data: {
        ...priorData,
        status: 'scanning',
        date: dateKey,
        threshold,
        lookbackDays: LOOKBACK_DAYS,
        jobStartedAt: jobState.startedAt,
        universeSize: sameJob ? Number(priorData.universeSize) || 0 : 0,
        scanned: sameJob ? Number(priorData.scanned) || 0 : 0,
        items: Array.isArray(priorData.items) ? priorData.items : []
      }
    };
  }
  if (cached && cached.data) {
    const fresh = isFresh(cached, MOMENTUM_TTL_MS);
    return {
      source: fresh ? 'cache' : 'stale',
      stale: !fresh,
      generatedAt: cached.generatedAt,
      ttlMs: cached.ttlMs || MOMENTUM_TTL_MS,
      data: cached.data
    };
  }

  return {
    source: 'empty',
    stale: false,
    generatedAt: nowMs(),
    ttlMs: MOMENTUM_TTL_MS,
    data: emptyMomentumData(dateKey, threshold, '等待服务端定时扫描生成结果')
  };
}

export function startTenDayMomentumScan({ date, threshold: rawThreshold, reason = 'manual' } = {}) {
  const dateKey = normalizeMomentumDate(date);
  const threshold = parsePositiveNumber(rawThreshold, DEFAULT_THRESHOLD);
  const parts = cacheParts(dateKey, threshold);
  const jobKey = `${dateKey}|${threshold}`;
  if (!JOBS.has(jobKey)) {
    const controller = new AbortController();
    const startedAt = nowMs();
    const job = buildMomentum({
      dateKey,
      threshold,
      parts,
      signal: controller.signal,
      jobStartedAt: startedAt
    })
      .then(async (data) => {
        const completed = { ...data, reason };
        await writeMomentumProgress(parts, completed);
        if (completed.status === 'complete') {
          await writeMomentumProgress(successCacheParts(dateKey, threshold), completed);
        }
        return data;
      })
      .catch(async (err) => {
        const lastSuccess = await readCache(successCacheParts(dateKey, threshold), { skipTouch: true });
        const prior = lastSuccess && lastSuccess.data
          ? lastSuccess
          : await readCache(parts, { skipTouch: true });
        const data = {
          status: 'error',
          date: dateKey,
          threshold,
          lookbackDays: LOOKBACK_DAYS,
          universeSize: prior && prior.data ? Number(prior.data.universeSize) || 0 : 0,
          scanned: prior && prior.data ? Number(prior.data.scanned) || 0 : 0,
          items: prior && prior.data && Array.isArray(prior.data.items) ? prior.data.items : [],
          error: err && err.message ? err.message : String(err),
          reason
        };
        await writeMomentumProgress(parts, data);
        return data;
      })
      .finally(() => {
        JOBS.delete(jobKey);
      });
    JOBS.set(jobKey, { promise: job, startedAt });
  }
  return JOBS.get(jobKey).promise;
}

async function ensureStartupMomentumScan(logger) {
  const dateKey = beijingDateKey();
  const threshold = DEFAULT_THRESHOLD;
  const cached = await readCache(cacheParts(dateKey, threshold), { skipTouch: true });
  if (
    cached &&
    cached.data &&
    cached.data.status === 'complete' &&
    Number(cached.data.universeSize) > 0
  ) return;
  startTenDayMomentumScan({ date: dateKey, threshold, reason: 'startup' })
    .catch((err) => {
      if (logger && logger.warn) logger.warn(`momentum startup scan failed: ${err && err.message ? err.message : err}`);
    });
}

export function startMomentumScheduler({ logger = console } = {}) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const scheduleNext = () => {
    const next = nextScheduledScan();
    schedulerTimer = setTimeout(() => {
      startTenDayMomentumScan({ date: beijingDateKey(), threshold: DEFAULT_THRESHOLD, reason: next.label })
        .catch((err) => {
          if (logger && logger.warn) logger.warn(`momentum scheduled scan failed: ${err && err.message ? err.message : err}`);
        })
        .finally(scheduleNext);
    }, Math.max(1000, next.delayMs));
  };

  ensureStartupMomentumScan(logger).catch((err) => {
    if (logger && logger.warn) logger.warn(`momentum startup scan setup failed: ${err && err.message ? err.message : err}`);
  });
  scheduleNext();
}

export function stopMomentumScheduler() {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  schedulerStarted = false;
}
