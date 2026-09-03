import { parseFutureInput } from './contractCatalog.js';
import { getFuturesSession } from './futuresSessionService.js';
import { getOrRefresh } from '../cacheStore.js';
import { parseBeijingDateTimeToChartSeconds } from '../../src/js/time.js';

const INTRADAY_TTL_MS = 10 * 1000;
const KLINE_LIVE_TTL_MS = 30 * 1000;
const KLINE_HISTORICAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 从 AKTools 或新浪抓取期货分钟线
 */
async function fetchFuturesMinute(inst, period = '1') {
  // AKTools: futures_zh_minute_sina
  try {
    const url = `http://127.0.0.1:8888/api/public/futures_zh_minute_sina?symbol=${inst.symbol}&period=${period}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        return {
          source: 'aktools-futures_zh_minute_sina',
          items: data.map((row) => ({
            time: parseBeijingDateTimeToChartSeconds(row.datetime || row.time),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume) || 0,
            openInterest: Number(row.hold || row.position || row.open_interest) || 0
          })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close))
        };
      }
    }
  } catch (_e) {
    // fallback to sina
  }

  // Sina Fallback for futures minute
  try {
    const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_data=/InnerFuturesNewService.getMinLine?symbol=${inst.symbol}`;
    const res = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/var\s+_data\s*=\s*(\[[\s\S]*\])/);
      if (match) {
        const arr = JSON.parse(match[1]);
        if (Array.isArray(arr) && arr.length) {
          return {
            source: 'sina-futures-minline',
            items: arr.map((row) => ({
              time: parseBeijingDateTimeToChartSeconds(row[0]),
              open: Number(row[1]),
              high: Number(row[2]),
              low: Number(row[3]),
              close: Number(row[4]),
              volume: Number(row[5]) || 0,
              openInterest: Number(row[6]) || 0
            })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close))
          };
        }
      }
    }
  } catch (_e) {
    // ignore
  }

  return { source: 'empty', items: [] };
}

/**
 * 从 AKTools 或新浪抓取期货日线
 */
async function fetchFuturesDaily(inst) {
  try {
    const url = `http://127.0.0.1:8888/api/public/futures_zh_daily_sina?symbol=${inst.symbol}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        return {
          source: 'aktools-futures_zh_daily_sina',
          items: data.map((row) => ({
            time: parseBeijingDateTimeToChartSeconds(row.date || row.datetime),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume) || 0,
            openInterest: Number(row.hold || row.position || row.open_interest) || 0
          })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close))
        };
      }
    }
  } catch (_e) {
    // fallback to sina
  }

  // Sina Fallback for futures daily
  try {
    const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_data=/InnerFuturesNewService.getDailyKLine?symbol=${inst.symbol}`;
    const res = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/var\s+_data\s*=\s*(\[[\s\S]*\])/);
      if (match) {
        const arr = JSON.parse(match[1]);
        if (Array.isArray(arr) && arr.length) {
          return {
            source: 'sina-futures-dailykline',
            items: arr.map((row) => ({
              time: parseBeijingDateTimeToChartSeconds(row[0]),
              open: Number(row[1]),
              high: Number(row[2]),
              low: Number(row[3]),
              close: Number(row[4]),
              volume: Number(row[5]) || 0,
              openInterest: Number(row[6]) || 0
            })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close))
          };
        }
      }
    }
  } catch (_e) {
    // ignore
  }

  return { source: 'empty', items: [] };
}

export async function getCachedFuturesKline(symbolOrId, period = 'day', opts = {}) {
  const inst = typeof symbolOrId === 'object' && symbolOrId !== null
    ? symbolOrId
    : parseFutureInput(symbolOrId);

  if (!inst) return null;

  const session = getFuturesSession(inst);
  const isIntradayPeriod = ['1', '5', '15', '30', '60', '1m', '5m', '15m', '30m', '60m'].includes(String(period));
  const ttlMs = session.isTrading ? (isIntradayPeriod ? INTRADAY_TTL_MS : KLINE_LIVE_TTL_MS) : KLINE_HISTORICAL_TTL_MS;
  const cacheKey = ['futures', 'kline', `${inst.symbol}-${period}.json`];

  const result = await getOrRefresh(
    cacheKey,
    ttlMs,
    async () => {
      let raw;
      if (isIntradayPeriod) {
        const p = String(period).replace('m', '');
        raw = await fetchFuturesMinute(inst, p);
      } else {
        raw = await fetchFuturesDaily(inst);
      }
      return {
        instrumentId: inst.id,
        symbol: inst.symbol,
        period,
        source: raw.source,
        tradingDay: session.tradingDay,
        items: raw.items,
        fetchedAt: Date.now()
      };
    },
    opts
  );

  return result ? result.data : null;
}

export async function getCachedFuturesIntraday(symbolOrId, opts = {}) {
  const inst = typeof symbolOrId === 'object' && symbolOrId !== null
    ? symbolOrId
    : parseFutureInput(symbolOrId);

  if (!inst) return null;

  const session = getFuturesSession(inst);
  const cacheKey = ['futures', 'intraday', `${inst.symbol}-${session.tradingDay}.json`];

  const result = await getOrRefresh(
    cacheKey,
    session.isTrading ? INTRADAY_TTL_MS : KLINE_HISTORICAL_TTL_MS,
    async () => {
      const raw = await fetchFuturesMinute(inst, '1');
      let prevClose = null;
      if (raw.items && raw.items.length) {
        prevClose = raw.items[0].open;
      }
      const intradayItems = raw.items.map((it) => {
        const pc = prevClose || it.close;
        const percent = pc > 0 ? ((it.close - pc) / pc) * 100 : 0;
        return {
          time: it.time,
          price: it.close,
          open: it.open,
          high: it.high,
          low: it.low,
          close: it.close,
          volume: it.volume,
          openInterest: it.openInterest,
          percent: Number(percent.toFixed(2))
        };
      });

      return {
        instrumentId: inst.id,
        symbol: inst.symbol,
        tradingDay: session.tradingDay,
        source: raw.source,
        items: intradayItems,
        fetchedAt: Date.now()
      };
    },
    opts
  );

  return result ? result.data : null;
}
