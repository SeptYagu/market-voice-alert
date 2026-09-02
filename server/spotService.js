import { getOrRefresh } from './cacheStore.js';
import { fetchAktoolsSpot } from './marketData.js';

const SPOT_TTL_MS = 30 * 1000;

export async function getCachedSpotLatest({ signal } = {}) {
  const result = await getOrRefresh(
    ['spot', 'latest.json'],
    SPOT_TTL_MS,
    async () => {
      const items = await fetchAktoolsSpot(signal);
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Empty A-share spot snapshot');
      }
      return {
        items,
        count: items.length
      };
    }
  );
  if (!result.data || !Array.isArray(result.data.items) || result.data.items.length === 0) {
    throw new Error('Empty A-share spot snapshot');
  }
  return result;
}
