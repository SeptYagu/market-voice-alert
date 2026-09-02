import { readCache, writeCache } from './cacheStore.js';
import { getKlineDataForMomentum } from './klineService.js';
import { getCachedSpotLatest } from './spotService.js';
import { isFresh, normalizeDateKey, nowMs, parsePositiveNumber } from './utils.js';

const MOMENTUM_TTL_MS = 5 * 60 * 1000;
const DEFAULT_THRESHOLD = 45;
const LOOKBACK_DAYS = 10;
const CONCURRENCY = 8;
const SCHEDULED_SCAN_TIMES = Object.freeze([
  Object.freeze({ hour: 8, minute: 0, label: 'pre-open' }),
  Object.freeze({ hour: 15, minute: 1, label: 'after-close' })
]);
const JOBS = new Map();
let schedulerTimer = null;
let schedulerStarted = false;

function computeTenDayMomentum(klineData, lookbackDays = LOOKBACK_DAYS) {
  const items = klineData && Array.isArray(klineData.items) ? klineData.items : [];
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
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function cacheParts(dateKey, threshold) {
  const thresholdKey = String(threshold).replace(/\./g, 'p');
  return ['momentum', dateKey, `ten-day-${thresholdKey}pct.json`];
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
  });
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

async function buildMomentum({ dateKey, threshold, parts, signal }) {
  const spotResult = await getCachedSpotLatest({ signal });
  const universe = spotResult && spotResult.data && Array.isArray(spotResult.data.items)
    ? spotResult.data.items
    : [];
  const found = [];
  const scanned = { count: 0 };
  await writeMomentumProgress(parts, {
    status: 'scanning',
    date: dateKey,
    threshold,
    lookbackDays: LOOKBACK_DAYS,
    universeSize: universe.length,
    scanned: 0,
    items: []
  });
  await mapLimit(universe, CONCURRENCY, async (candidate) => {
    if (!candidate || !/^(sh|sz|bj)\d{6}$/i.test(candidate.code)) return null;
    try {
      const data = await getKlineDataForMomentum(candidate.code, signal);
      const stats = computeTenDayMomentum(data);
      if (!stats || stats.gainPercent < threshold) return null;
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
        ...stats
      };
      found.push(item);
      return item;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      return null;
    } finally {
      scanned.count += 1;
      if (scanned.count > 0 && scanned.count % 100 === 0) {
        await writeMomentumProgress(parts, {
          status: 'scanning',
          date: dateKey,
          threshold,
          lookbackDays: LOOKBACK_DAYS,
          universeSize: universe.length,
          scanned: scanned.count,
          items: found.slice().sort((a, b) => (b.gainPercent || 0) - (a.gainPercent || 0))
        });
      }
    }
  });
  found.sort((a, b) => (b.gainPercent || 0) - (a.gainPercent || 0));
  return {
    status: 'complete',
    date: dateKey,
    threshold,
    lookbackDays: LOOKBACK_DAYS,
    universeSize: universe.length,
    scanned: scanned.count,
    items: found
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
  const cached = await readCache(parts);
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

  const jobKey = `${dateKey}|${threshold}`;
  if (JOBS.has(jobKey)) {
    return {
      source: 'network',
      stale: false,
      generatedAt: nowMs(),
      ttlMs: MOMENTUM_TTL_MS,
      data: {
        status: 'scanning',
        date: dateKey,
        threshold,
        lookbackDays: LOOKBACK_DAYS,
        universeSize: 0,
        scanned: 0,
        items: []
      }
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
    const job = buildMomentum({ dateKey, threshold, parts, signal: controller.signal })
      .then(async (data) => {
        await writeMomentumProgress(parts, { ...data, reason });
        return data;
      })
      .catch(async (err) => {
        const prior = await readCache(parts);
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
    JOBS.set(jobKey, job);
  }
  return JOBS.get(jobKey);
}

async function ensureStartupMomentumScan(logger) {
  const dateKey = beijingDateKey();
  const threshold = DEFAULT_THRESHOLD;
  const cached = await readCache(cacheParts(dateKey, threshold));
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
