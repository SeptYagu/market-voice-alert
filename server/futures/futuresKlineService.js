import { parseFutureInput } from './contractCatalog.js';
import { getFuturesSession } from './futuresSessionService.js';
import { getCachedFuturesQuote } from './futuresQuoteService.js';
import { getOrRefresh } from '../cacheStore.js';
import { getCachedTradeCalendar } from '../calendarService.js';
import { parseBeijingDateTimeToChartSeconds, chartTimeToDate, shiftCalendarDate } from '../../src/js/time.js';
import { shiftTradingDate } from '../../src/js/tradeCalendar.js';

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
const AKTOOLS_BASE = (process.env.AKTOOLS_BASE || 'http://127.0.0.1:8888').replace(/\/+$/, '');

/**
 * 从 AKTools 或新浪抓取期货分钟线
 */
async function fetchFuturesMinute(inst, period = '1') {
  // AKTools: futures_zh_minute_sina
  try {
    const url = `${AKTOOLS_BASE}/api/public/futures_zh_minute_sina?symbol=${inst.symbol}&period=${period}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        const items = data.map((row) => {
          const p = Number(row.close);
          const avg = Number(row.avg_price ?? row.average ?? row.avgPrice ?? row.均价);
          return {
            time: parseBeijingDateTimeToChartSeconds(row.datetime || row.time),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: p,
            avgPrice: Number.isFinite(avg) && avg > 0 ? avg : null,
            volume: Number(row.volume) || 0,
            openInterest: Number(row.hold ?? row.position ?? row.open_interest) || 0
          };
        }).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));

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
            const avg = Number(row[2]);
            return {
              time,
              open: p,
              high: p,
              low: p,
              close: p,
              avgPrice: Number.isFinite(avg) && avg > 0 ? avg : null,
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
    const url = `${AKTOOLS_BASE}/api/public/futures_zh_daily_sina?symbol=${inst.symbol}`;
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

export function aggregateDailyBarsToWeekly(dailyBars) {
  if (!Array.isArray(dailyBars) || !dailyBars.length) return [];
  const groups = new Map();

  for (const bar of dailyBars) {
    if (!bar || (typeof bar.time !== 'string' && !Number.isFinite(bar.time))) continue;
    const dateStr = chartTimeToDate(bar.time);
    if (!dateStr) continue;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const dow = dt.getUTCDay(); // 0 Sun, 1 Mon ... 6 Sat
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    dt.setUTCDate(dt.getUTCDate() + diffToMonday);
    const weekKey = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    if (!groups.has(weekKey)) groups.set(weekKey, []);
    groups.get(weekKey).push(bar);
  }

  const result = [];
  for (const group of groups.values()) {
    if (!group.length) continue;
    const first = group[0];
    const last = group[group.length - 1];
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const b of group) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += Number(b.volume) || 0;
    }
    result.push({
      time: last.time,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      openInterest: last.openInterest,
      settle: last.settle
    });
  }
  return result;
}

export function aggregateDailyBarsToMonthly(dailyBars) {
  if (!Array.isArray(dailyBars) || !dailyBars.length) return [];
  const groups = new Map();

  for (const bar of dailyBars) {
    if (!bar || (typeof bar.time !== 'string' && !Number.isFinite(bar.time))) continue;
    const dateStr = chartTimeToDate(bar.time);
    if (!dateStr) continue;
    const monthKey = dateStr.slice(0, 7);
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey).push(bar);
  }

  const result = [];
  for (const group of groups.values()) {
    if (!group.length) continue;
    const first = group[0];
    const last = group[group.length - 1];
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const b of group) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += Number(b.volume) || 0;
    }
    result.push({
      time: last.time,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      openInterest: last.openInterest,
      settle: last.settle
    });
  }
  return result;
}

export async function getCachedFuturesKline(symbolOrId, period = 'day', opts = {}) {
  const rawPeriod = String(period || 'day').trim();
  const isMonth = rawPeriod === '1M' || rawPeriod.toLowerCase() === 'month' || rawPeriod.toLowerCase() === 'monthly';
  const isWeek = rawPeriod.toLowerCase() === '1w' || rawPeriod.toLowerCase() === 'week' || rawPeriod.toLowerCase() === 'weekly';
  const isDay = rawPeriod.toLowerCase() === 'day' || rawPeriod.toLowerCase() === '1d' || rawPeriod.toLowerCase() === 'daily';
  const isIntradayPeriod = !isMonth && ['1', '5', '15', '30', '60', '1m', '5m', '15m', '30m', '60m'].includes(rawPeriod.toLowerCase());

  if (!isMonth && !isWeek && !isDay && !isIntradayPeriod) {
    throw new Error(`Invalid futures kline period: ${period}`);
  }

  const inst = typeof symbolOrId === 'object' && symbolOrId !== null
    ? symbolOrId
    : parseFutureInput(symbolOrId);

  if (!inst) return null;

  const tradingDates = await _loadTradingDates(opts.signal);
  const session = getFuturesSession(inst, opts.now || new Date(), tradingDates);
  const ttlMs = session.isTrading ? (isIntradayPeriod ? INTRADAY_TTL_MS : KLINE_LIVE_TTL_MS) : KLINE_HISTORICAL_TTL_MS;
  const canonicalPeriod = isMonth ? '1M' : (isWeek ? '1w' : (isDay ? '1d' : rawPeriod.toLowerCase()));
  const cacheKey = ['futures', 'kline', `${inst.symbol}-${canonicalPeriod}.json`];

  const result = await getOrRefresh(
    cacheKey,
    ttlMs,
    async () => {
      let raw;
      let items;
      if (isIntradayPeriod) {
        const p = rawPeriod.replace(/m/i, '');
        raw = await fetchFuturesMinute(inst, p);
        items = raw.items;
      } else {
        raw = await fetchFuturesDaily(inst);
        const dailyItems = raw.items ? [...raw.items] : [];
        try {
          const q = await getCachedFuturesQuote(inst, { signal: opts.signal });
          if (q && q.tradingDay && Number(q.price) > 0) {
            const targetSec = parseBeijingDateTimeToChartSeconds(q.tradingDay);
            const lastBar = dailyItems[dailyItems.length - 1];
            if (lastBar && lastBar.time < targetSec) {
              const liveBar = {
                time: targetSec,
                open: q.open > 0 ? q.open : q.price,
                high: Math.max(q.high || 0, q.price, q.open || 0),
                low: Math.min(...[q.low, q.price, q.open].filter((v) => Number(v) > 0)),
                close: q.price,
                volume: q.volume || 0,
                openInterest: q.openInterest || 0,
                settle: q.prevSettlement || null
              };
              dailyItems.push(liveBar);
            } else if (lastBar && lastBar.time === targetSec) {
              dailyItems[dailyItems.length - 1] = {
                ...lastBar,
                close: q.price,
                high: Math.max(lastBar.high || 0, q.high || 0, q.price),
                low: Math.min(...[lastBar.low, q.low, q.price].filter((v) => Number(v) > 0)),
                volume: q.volume || lastBar.volume,
                openInterest: q.openInterest || lastBar.openInterest
              };
            }
          }
        } catch (_e) {
          // ignore quote merge error
        }

        if (isWeek) {
          items = aggregateDailyBarsToWeekly(dailyItems);
        } else if (isMonth) {
          items = aggregateDailyBarsToMonthly(dailyItems);
        } else {
          items = dailyItems;
        }
      }
      return {
        instrumentId: inst.id,
        symbol: inst.symbol,
        period,
        source: raw.source,
        tradingDay: session.tradingDay,
        items,
        fetchedAt: Date.now()
      };
    },
    opts
  );

  if (result && result.data) {
    result.data.stale = !!result.stale;
  }
  return result ? result.data : null;
}

function filterMinuteBarsForTradingDay(bars, targetTradingDay, inst, tradingDates = []) {
  if (!Array.isArray(bars) || !bars.length) return [];
  const prevDay = shiftTradingDate(targetTradingDay, -1, tradingDates);

  let nightStart = null;
  let nightEnd = null;

  if (inst.nightSessionEnd) {
    nightStart = parseBeijingDateTimeToChartSeconds(`${prevDay} 20:59:00`);
    if (inst.nightSessionEnd === '23:00') {
      nightEnd = parseBeijingDateTimeToChartSeconds(`${prevDay} 23:01:00`);
    } else {
      const nextCalDay = shiftCalendarDate(prevDay, 1);
      if (inst.nightSessionEnd === '01:00') {
        nightEnd = parseBeijingDateTimeToChartSeconds(`${nextCalDay} 01:01:00`);
      } else if (inst.nightSessionEnd === '02:30') {
        nightEnd = parseBeijingDateTimeToChartSeconds(`${nextCalDay} 02:31:00`);
      }
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
      const dayBars = filterMinuteBarsForTradingDay(raw.items, targetTradingDay, inst, tradingDates);
      const itemsToUse = dayBars;

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

      let cumVol = 0;
      let cumAmount = 0;
      const decimals = inst.priceTick && inst.priceTick < 0.01 ? 3 : 2;

      const intradayItems = itemsToUse.map((it) => {
        const pc = prevSettlement || it.close;
        const percent = pc > 0 ? ((it.close - pc) / pc) * 100 : 0;

        let avgPrice = null;
        if (Number.isFinite(it.avgPrice) && it.avgPrice > 0) {
          avgPrice = Number(it.avgPrice.toFixed(decimals));
        } else {
          const vol = Number(it.volume) || 0;
          cumVol += vol;
          cumAmount += (it.close * vol);
          if (cumVol > 0) {
            avgPrice = Number((cumAmount / cumVol).toFixed(decimals));
          } else {
            avgPrice = Number(it.close.toFixed(decimals));
          }
        }

        return {
          time: it.time,
          price: it.close,
          open: it.open,
          high: it.high,
          low: it.low,
          close: it.close,
          avgPrice,
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

  if (result && result.data) {
    result.data.stale = !!result.stale;
    if (Array.isArray(result.data.items)) {
      let cumV = 0;
      let cumA = 0;
      const dec = inst.priceTick && inst.priceTick < 0.01 ? 3 : 2;
      for (const it of result.data.items) {
        if (!Number.isFinite(it.avgPrice) || it.avgPrice <= 0) {
          const v = Number(it.volume) || 0;
          cumV += v;
          cumA += (it.close * v);
          it.avgPrice = cumV > 0 ? Number((cumA / cumV).toFixed(dec)) : Number(it.close.toFixed(dec));
        }
      }
    }
  }
  return result ? result.data : null;
}

export const _internal = {
  fetchFuturesMinute,
  fetchFuturesDaily,
  filterMinuteBarsForTradingDay,
  _loadTradingDates,
  aggregateDailyBarsToWeekly,
  aggregateDailyBarsToMonthly
};
