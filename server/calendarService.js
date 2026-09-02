import { getOrRefresh } from './cacheStore.js';
import { fetchAktoolsTradeCalendar } from './marketData.js';

const TRADE_CALENDAR_TTL_MS = 24 * 60 * 60 * 1000;

export async function getCachedTradeCalendar({ signal } = {}) {
  return await getOrRefresh(
    ['calendar', 'trade-dates.json'],
    TRADE_CALENDAR_TTL_MS,
    async () => ({
      dates: await fetchAktoolsTradeCalendar(signal)
    })
  );
}
