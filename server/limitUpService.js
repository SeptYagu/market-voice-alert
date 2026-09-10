import { getOrRefresh, readCache } from './cacheStore.js';
import { fetchAktoolsLimitPool, fetchAktoolsReasons, AKTOOLS_REASONS_SOURCE } from './marketData.js';
import { normalizeDateKey } from './utils.js';

const LIMIT_UP_TTL_MS = 30 * 1000;
const REASON_TTL_MS = 10 * 60 * 1000;

function isHistoricalDate(dateKey) {
  const todayKey = normalizeDateKey(null);
  return /^\d{8}$/.test(dateKey) && dateKey < todayKey;
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
    dateKey: `${pick('year')}${String(pick('month')).padStart(2, '0')}${String(pick('day')).padStart(2, '0')}`,
    minutes: pick('hour') * 60 + pick('minute')
  };
}

export function isHistoricalLimitUpComplete(generatedAtMs, dateKey, data) {
  if (!data || (!Array.isArray(data.items) && !Array.isArray(data.limitUpItems))) return false;
  const n = Number(generatedAtMs);
  if (!Number.isFinite(n) || n <= 0) return false;
  const stamp = beijingStamp(n);
  if (stamp.dateKey > dateKey) return true;
  if (stamp.dateKey < dateKey) return false;
  return stamp.minutes >= 15 * 60 + 5;
}

export function isHistoricalReasonsComplete(generatedAtMs, dateKey, data) {
  if (!data || !Array.isArray(data.reasons)) return false;
  const n = Number(generatedAtMs);
  if (!Number.isFinite(n) || n <= 0) return false;
  const stamp = beijingStamp(n);
  if (data.reasons.length > 0) {
    if (stamp.dateKey > dateKey) return true;
    // The dragon-tiger board is published in the evening, so a same-day non-empty
    // result before 20:30 may still be a partial release and must keep retrying.
    if (stamp.dateKey === dateKey && stamp.minutes >= 20 * 60 + 30) return true;
  }
  // Give-up rule: a snapshot taken on a later day is final even when it is empty.
  // Without this, a session that genuinely had no dragon-tiger entries would re-fetch
  // on every single request forever.
  if (stamp.dateKey > dateKey) return true;
  return false;
}

async function readHistoricalCache(parts, ttlMs, isCompleteFn, dateKey) {
  const cached = await readCache(parts);
  if (!cached || !Object.prototype.hasOwnProperty.call(cached, 'data')) return null;
  if (typeof isCompleteFn === 'function' && !isCompleteFn(cached.generatedAt, dateKey, cached.data)) {
    return null;
  }
  return {
    source: 'cache',
    stale: false,
    generatedAt: cached.generatedAt,
    ttlMs: cached.ttlMs || ttlMs,
    data: cached.data
  };
}

export async function getCachedLimitUp({ date, signal, force = false } = {}) {
  const dateKey = normalizeDateKey(date);
  if (!dateKey) {
    const err = new Error('Invalid date');
    err.statusCode = 400;
    throw err;
  }

  const parts = ['limit-up', dateKey, 'merged.json'];
  if (!force && isHistoricalDate(dateKey)) {
    const historical = await readHistoricalCache(parts, LIMIT_UP_TTL_MS, isHistoricalLimitUpComplete, dateKey);
    if (historical) return historical;
  }

  return await getOrRefresh(
    parts,
    LIMIT_UP_TTL_MS,
    async () => {
      const [limitUpItems, brokenItems] = await Promise.all([
        fetchAktoolsLimitPool('limitUp', dateKey, signal),
        fetchAktoolsLimitPool('broken', dateKey, signal)
      ]);
      return {
        date: dateKey,
        limitUpItems,
        brokenItems,
        items: [...limitUpItems, ...brokenItems]
      };
    },
    { force, forceMinAgeMs: 5000 }
  );
}

export async function getCachedLimitUpReasons({ date, signal, force = false } = {}) {
  const dateKey = normalizeDateKey(date);
  if (!dateKey) {
    const err = new Error('Invalid date');
    err.statusCode = 400;
    throw err;
  }

  const parts = ['limit-up', dateKey, 'reasons.json'];
  if (!force && isHistoricalDate(dateKey)) {
    const historical = await readHistoricalCache(parts, REASON_TTL_MS, isHistoricalReasonsComplete, dateKey);
    if (historical) return historical;
  }

  return await getOrRefresh(
    parts,
    REASON_TTL_MS,
    async () => ({
      date: dateKey,
      // Provenance is archived next to the payload: these are dragon-tiger seat
      // details, not the reason the stock rose.
      reasonSource: AKTOOLS_REASONS_SOURCE,
      reasons: await fetchAktoolsReasons(dateKey, signal)
    }),
    { force, forceMinAgeMs: 5000 }
  );
}
