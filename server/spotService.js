import { readdir } from 'node:fs/promises';
import { getOrRefresh, cachePath } from './cacheStore.js';
import { fetchAktoolsSpot } from './marketData.js';

const SPOT_TTL_MS = 30 * 1000;

async function getKlineCacheUniverse() {
  let entries = [];
  try {
    entries = await readdir(cachePath('kline'), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^(sh|sz|bj)\d{6}$/i.test(entry.name))
    .map((entry) => ({ code: entry.name.toLowerCase(), name: '' }));
}

export async function getCachedSpotLatest({ signal } = {}) {
  let result;
  try {
    result = await getOrRefresh(
      ['spot', 'latest.json'],
      SPOT_TTL_MS,
      async () => {
        const items = await fetchAktoolsSpot(signal);
        if (!Array.isArray(items) || items.length === 0) {
          throw new Error('Empty A-share spot snapshot');
        }
        return {
          items,
          count: items.length,
          source: 'aktools-stock_zh_a_spot_em'
        };
      },
      { skipPrune: true }
    );
  } catch (error) {
    const items = await getKlineCacheUniverse();
    if (!items.length) throw error;
    return {
      source: 'kline-universe-cache',
      stale: true,
      generatedAt: Date.now(),
      ttlMs: SPOT_TTL_MS,
      upstreamError: error && error.message ? error.message : String(error),
      data: { items, count: items.length, source: 'kline-universe-cache' }
    };
  }
  if (!result.data || !Array.isArray(result.data.items) || result.data.items.length === 0) {
    throw new Error('Empty A-share spot snapshot');
  }
  return result;
}
