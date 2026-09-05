import { readdir, readFile } from 'node:fs/promises';
import { getOrRefresh, cachePath } from './cacheStore.js';
import { fetchAktoolsSpot, fetchTencentSpot, isAStockCode } from './marketData.js';

const SPOT_TTL_MS = 30 * 1000;

async function getKlineCacheUniverse() {
  const codeSet = new Set();

  // 1. Check optional explicit universe seed files if provided
  for (const p of [cachePath('universe.json'), cachePath('..', 'universe.json')]) {
    try {
      const raw = await readFile(p, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.codes) ? parsed.codes : []);
      for (const item of list) {
        const code = typeof item === 'string' ? item.toLowerCase() : (item && item.code ? item.code.toLowerCase() : '');
        if (isAStockCode(code)) codeSet.add(code);
      }
    } catch {
      // optional seed file not present
    }
  }

  // 2. Scan existing local kline cache directories
  try {
    const entries = await readdir(cachePath('kline'), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && isAStockCode(entry.name)) {
        codeSet.add(entry.name.toLowerCase());
      }
    }
  } catch {
    // ignore
  }

  return Array.from(codeSet).map((code) => ({ code, name: '' }));
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
