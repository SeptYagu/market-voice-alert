import { readdir } from 'node:fs/promises';
import { getOrRefresh, cachePath } from './cacheStore.js';
import { fetchAktoolsSpot, fetchTencentSpot, isAStockCode } from './marketData.js';

const SPOT_TTL_MS = 30 * 1000;

async function getKlineCacheUniverse() {
  let entries = [];
  try {
    entries = await readdir(cachePath('kline'), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && isAStockCode(entry.name))
    .map((entry) => ({ code: entry.name.toLowerCase(), name: '' }));
}

export async function getCachedSpotLatest({ signal } = {}) {
  const result = await getOrRefresh(
      ['spot', 'latest.json'],
      SPOT_TTL_MS,
      async () => {
        try {
          const items = await fetchAktoolsSpot(signal);
          if (!Array.isArray(items) || items.length === 0) throw new Error('Empty A-share spot snapshot');
          return {
            items,
            count: items.length,
            source: 'aktools-stock_zh_a_spot_em'
          };
        } catch (aktoolsError) {
          if (aktoolsError && aktoolsError.name === 'AbortError') throw aktoolsError;
          const seeds = await getKlineCacheUniverse();
          if (!seeds.length) throw aktoolsError;
          const snapshot = await fetchTencentSpot(seeds.map((item) => item.code), signal);
          if (!snapshot.items.length) throw aktoolsError;
          return {
            items: snapshot.items,
            count: snapshot.items.length,
            source: 'tencent-batch-quotes',
            universeStats: snapshot.stats,
            upstreamError: aktoolsError && aktoolsError.message ? aktoolsError.message : String(aktoolsError)
          };
        }
      },
      { skipPrune: true }
    );
  if (!result.data || !Array.isArray(result.data.items) || result.data.items.length === 0) {
    throw new Error('Empty A-share spot snapshot');
  }
  return result;
}
