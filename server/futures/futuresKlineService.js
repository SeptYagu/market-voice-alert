import { parseFutureInput } from './contractCatalog.js';
import { getFuturesSession } from './futuresSessionService.js';
import { getOrRefresh } from '../cacheStore.js';
import { getCachedTradeCalendar } from '../calendarService.js';
import { parseBeijingDateTimeToChartSeconds } from '../../src/js/time.js';

async function _loadTradingDates(signal) {
  try {
    const cal = await getCachedTradeCalendar({ signal });
    if (cal && cal.data && Array.isArray(cal.data.dates)) {
      return cal.data.dates;
    }
  } catch (_e) {
    // ignore
  }
  return [];
}

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
        const items = data.map((row) => ({
          time: parseBeijingDateTimeToChartSeconds(row.datetime || row.time),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume) || 0,
          openInterest: Number(row.hold ?? row.position ?? row.open_interest) || 0
        })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));

        if (items.length) {
          return {
            source: 'aktools-futures_zh_minute_sina',
            items
          };
        }
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
      const match = text.match(/var\s+[^=]+=\s*\(?\s*(\[[\s\S]*\])/);
      if (match) {
        const arr = JSON.parse(match[1]);
        if (Array.isArray(arr) && arr.length) {
          const baseDate = arr[0] && arr[0][6] ? arr[0][6] : null;
          const items = arr.map((row) => {
            let time = null;
            if (row[0] && row[0].length >= 10) {
              time = parseBeijingDateTimeToChartSeconds(row[0]);
            } else if (row[0] && baseDate) {
              const timeStr = row[0].length === 5 ? `${row[0]}:00` : row[0];
              time = parseBeijingDateTimeToChartSeconds(`${baseDate} ${timeStr}`);
            }
            const p = Number(row[1]);
            return {
              time,
              open: p,
              high: p,
              low: p,
              close: p,
              volume: Number(row[3]) || 0,
              openInterest: Number(row[4]) || 0
            };
          }).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));

          if (items.length) {
            return {
              source: 'sina-futures-minline',
              items
            };
          }
        }
      }
    }
  } catch (_e) {
    // ignore
  }

  throw new Error(`Failed to fetch futures minute kline for ${inst.symbol}`);
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
        const items = data.map((row) => ({
          time: parseBeijingDateTimeToChartSeconds(row.date || row.datetime),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume) || 0,
          openInterest: Number(row.hold ?? row.position ?? row.open_interest) || 0,
          settle: Number(row.settle) || null
        })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));

        if (items.length) {
          return {
            source: 'aktools-futures_zh_daily_sina',
            items
          };
        }
      }
    }
  } catch (_e) {
    // fallback to sina
  }

  // Sina Fallback for futures daily: Sina returns [{ d: "2026-09-03", o, h, l, c, v, p, s }]
  try {
    const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_data=/InnerFuturesNewService.getDailyKLine?symbol=${inst.symbol}`;
    const res = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/var\s+[^=]+=\s*\(?\s*(\[[\s\S]*\])/);
      if (match) {
        const arr = JSON.parse(match[1]);
        if (Array.isArray(arr) && arr.length) {
          const items = arr.map((row) => ({
            time: parseBeijingDateTimeToChartSeconds(row.d || row.date || row[0]),
            open: Number(row.o ?? row.open ?? row[1]),
            high: Number(row.h ?? row.high ?? row[2]),
            low: Number(row.l ?? row.low ?? row[3]),
            close: Number(row.c ?? row.close ?? row[4]),
            volume: Number(row.v ?? row.volume ?? row[5]) || 0,
            openInterest: Number(row.p ?? row.hold ?? row.position ?? row[6]) || 0,
            settle: Number(row.s ?? row.settle) || null
          })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));

          if (items.length) {
            return {
              source: 'sina-futures-dailykline',
              items
            };
          }
        }
      }
    }
  } catch (_e) {
    // ignore
  }

  throw new Error(`Failed to fetch futures daily kline for ${inst.symbol}`);
}

const VALID_PERIODS = new Set(['day', '1d', 'daily', '1', '5', '15', '30', '60', '1m', '5m', '15m', '30m', '60m']);

export async function getCachedFuturesKline(symbolOrId, period = 'day', opts = {}) {
  const normPeriod = String(period || 'day').toLowerCase();
  if (!VALID_PERIODS.has(normPeriod)) {
    throw new Error(`Invalid futures kline period: ${period}`);
  }

  const inst = typeof symbolOrId === 'object' && symbolOrId !== null
    ? symbolOrId
    : parseFutureInput(symbolOrId);

  if (!inst) return null;

  const tradingDates = await _loadTradingDates(opts.signal);
  const session = getFuturesSession(inst, opts.now || new Date(), tradingDates);
  const isIntradayPeriod = ['1', '5', '15', '30', '60', '1m', '5m', '15m', '30m', '60m'].includes(normPeriod);
  const ttlMs = session.isTrading ? (isIntradayPeriod ? INTRADAY_TTL_MS : KLINE_LIVE_TTL_MS) : KLINE_HISTORICAL_TTL_MS;
  const cacheKey = ['futures', 'kline', `${inst.symbol}-${normPeriod}.json`];

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

function getPreviousTradeDayStr(dayStr) {
  const [y, m, d] = String(dayStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = dt.getUTCDay(); // 0 is Sun, 1 is Mon
  const delta = dayOfWeek === 1 ? 3 : (dayOfWeek === 0 ? 2 : 1);
  dt.setUTCDate(dt.getUTCDate() - delta);
  const ry = dt.getUTCFullYear();
  const rm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const rd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

function filterMinuteBarsForTradingDay(bars, targetTradingDay, inst) {
  if (!Array.isArray(bars) || !bars.length) return [];
  const prevDay = getPreviousTradeDayStr(targetTradingDay);

  let nightStart = null;
  let nightEnd = null;

  if (inst.nightSessionEnd) {
    nightStart = parseBeijingDateTimeToChartSeconds(`${prevDay} 21:00:00`);
    if (inst.nightSessionEnd === '23:00') {
      nightEnd = parseBeijingDateTimeToChartSeconds(`${prevDay} 23:00:00`);
    } else if (inst.nightSessionEnd === '01:00') {
      nightEnd = parseBeijingDateTimeToChartSeconds(`${targetTradingDay} 01:00:00`);
    } else if (inst.nightSessionEnd === '02:30') {
      nightEnd = parseBeijingDateTimeToChartSeconds(`${targetTradingDay} 02:30:00`);
    }
  }

  const dayStart = parseBeijingDateTimeToChartSeconds(`${targetTradingDay} 08:59:00`);
  const dayEnd = parseBeijingDateTimeToChartSeconds(`${targetTradingDay} 15:16:00`);

  return bars.filter((b) => {
    if (!Number.isFinite(b.time)) return false;
    if (nightStart !== null && nightEnd !== null && b.time >= nightStart && b.time <= nightEnd) {
      return true;
    }
    if (b.time >= dayStart && b.time <= dayEnd) {
      return true;
    }
    return false;
  });
}

export async function getCachedFuturesIntraday(symbolOrId, opts = {}) {
  const inst = typeof symbolOrId === 'object' && symbolOrId !== null
    ? symbolOrId
    : parseFutureInput(symbolOrId);

  if (!inst) return null;

  const tradingDates = await _loadTradingDates(opts.signal);
  const session = getFuturesSession(inst, opts.now || new Date(), tradingDates);
  const targetTradingDay = opts.date || opts.tradingDay || session.tradingDay;
  const cacheKey = ['futures', 'intraday', `${inst.symbol}-${targetTradingDay}.json`];

  const result = await getOrRefresh(
    cacheKey,
    session.isTrading ? INTRADAY_TTL_MS : KLINE_HISTORICAL_TTL_MS,
    async () => {
      const raw = await fetchFuturesMinute(inst, '1');
      if (!raw || !raw.items || !raw.items.length) {
        throw new Error(`Failed to fetch minute data for ${inst.symbol}`);
      }

      // Filter 5-day rolling items (~1023 bars) to only the target tradingDay
      const dayBars = filterMinuteBarsForTradingDay(raw.items, targetTradingDay, inst);
      const itemsToUse = dayBars.length ? dayBars : raw.items;

      let prevSettlement = null;
      try {
        const daily = await fetchFuturesDaily(inst);
        if (daily && daily.items && daily.items.length) {
          const targetSec = parseBeijingDateTimeToChartSeconds(targetTradingDay);
          const prevDayBar = daily.items.filter((b) => b.time < targetSec).pop();
          if (prevDayBar) {
            prevSettlement = prevDayBar.settle || prevDayBar.close;
          }
        }
      } catch (_e) {
        // ignore fallback to first bar
      }

      if (!prevSettlement && itemsToUse.length) {
        prevSettlement = itemsToUse[0].open;
      }

      const intradayItems = itemsToUse.map((it) => {
        const pc = prevSettlement || it.close;
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
        tradingDay: targetTradingDay,
        prevSettlement,
        source: raw.source,
        items: intradayItems,
        fetchedAt: Date.now()
      };
    },
    opts
  );

  return result ? result.data : null;
}

export const _internal = {
  fetchFuturesMinute,
  fetchFuturesDaily,
  filterMinuteBarsForTradingDay,
  _loadTradingDates
};
