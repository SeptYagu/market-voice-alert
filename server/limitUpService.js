import { getOrRefresh, readCache } from './cacheStore.js';
import { fetchAktoolsLimitPool, fetchAktoolsReasons } from './marketData.js';
import { normalizeDateKey } from './utils.js';

const LIMIT_UP_TTL_MS = 30 * 1000;
const REASON_TTL_MS = 10 * 60 * 1000;

function isHistoricalDate(dateKey) {
  const todayKey = normalizeDateKey(null);
  return /^\d{8}$/.test(dateKey) && dateKey < todayKey;
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

export async function getCachedLimitUp({ date, signal, force = false } = {}) {
  const dateKey = normalizeDateKey(date);
  if (!dateKey) {
    const err = new Error('Invalid date');
    err.statusCode = 400;
    throw err;
  }

  const parts = ['limit-up', dateKey, 'merged.json'];
  if (!force && isHistoricalDate(dateKey)) {
    const historical = await readHistoricalCache(parts, LIMIT_UP_TTL_MS);
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
    const historical = await readHistoricalCache(parts, REASON_TTL_MS);
    if (historical) return historical;
  }

  return await getOrRefresh(
    parts,
    REASON_TTL_MS,
    async () => ({
      date: dateKey,
      reasons: await fetchAktoolsReasons(dateKey, signal)
    }),
    { force, forceMinAgeMs: 5000 }
  );
}
