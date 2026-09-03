import { formatDateForInput, getBeijingDate, shiftCalendarDate } from './time.js';

const CALENDAR_URL = '/api/aktools/api/public/tool_trade_date_hist_sina';
const CACHE_CALENDAR_URL = '/api/cache/calendar/trade-dates';
let calendarPromise = null;
let cachedDates = null;

function _toDateString(raw) {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return formatDateForInput(raw);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return '';
}

export function parseTradeCalendar(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const row of json) {
    if (!row || typeof row !== 'object') continue;
    const date = _toDateString(
      row.trade_date ||
      row.tradeDate ||
      row['交易日'] ||
      row['日期'] ||
      row.date
    );
    if (date) out.push(date);
  }
  return [...new Set(out)].sort();
}

function _isWeekend(date) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!parts) return false;
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const day = d.getDay();
  return day === 0 || day === 6;
}

function _fallbackTradingDatesAround(anchor = getBeijingDate()) {
  const out = [];
  let cur = shiftCalendarDate(anchor, -370);
  for (let i = 0; i < 740; i++) {
    if (!_isWeekend(cur)) out.push(cur);
    cur = shiftCalendarDate(cur, 1);
  }
  return out;
}

export async function fetchTradeCalendar(opts = {}) {
  if (cachedDates) return cachedDates;
  if (calendarPromise) return calendarPromise;
  calendarPromise = fetchCachedTradeCalendar(opts.signal)
    .catch((e) => {
      if (e && e.name === 'AbortError') throw e;
      return fetchAktoolsTradeCalendar(opts.signal);
    })
    .then((dates) => {
      cachedDates = dates.length ? dates : _fallbackTradingDatesAround();
      return cachedDates;
    })
    .catch(() => {
      cachedDates = _fallbackTradingDatesAround();
      return cachedDates;
    })
    .finally(() => {
      calendarPromise = null;
    });
  return calendarPromise;
}

async function fetchCachedTradeCalendar(signal) {
  const res = await fetch(CACHE_CALENDAR_URL, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const dates = json && json.ok === true && json.data && Array.isArray(json.data.dates)
    ? json.data.dates
    : [];
  if (!dates.length) throw new Error('shared trade calendar cache failed');
  return dates;
}

async function fetchAktoolsTradeCalendar(signal) {
  return await fetch(CALENDAR_URL, { signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseTradeCalendar(await res.json());
    });
}

export function clearTradeCalendarCache() {
  cachedDates = null;
  calendarPromise = null;
}

export function isTradingDate(date, tradingDates) {
  const d = _toDateString(date);
  if (!d) return false;
  const dates = Array.isArray(tradingDates) && tradingDates.length ? tradingDates : _fallbackTradingDatesAround(d);
  return dates.includes(d);
}

export function resolveLatestTradingDate(date, tradingDates) {
  const anchor = _toDateString(date) || getBeijingDate();
  const dates = Array.isArray(tradingDates) && tradingDates.length ? tradingDates : _fallbackTradingDatesAround(anchor);
  let best = '';
  for (const d of dates) {
    if (d <= anchor) best = d;
    else break;
  }
  return best || dates[0] || anchor;
}

export function shiftTradingDate(date, delta, tradingDates) {
  const target = _toDateString(date) || getBeijingDate();
  const dates = Array.isArray(tradingDates) && tradingDates.length ? tradingDates : _fallbackTradingDatesAround(target);
  const isExactTradingDay = dates.includes(target);
  const latestBefore = resolveLatestTradingDate(target, dates);
  const numDelta = Number(delta || 0);

  if (!isExactTradingDay && numDelta === -1) {
    return latestBefore;
  }

  const idx = dates.indexOf(latestBefore);
  if (idx < 0) return latestBefore;
  const step = (!isExactTradingDay && numDelta < -1) ? (numDelta + 1) : numDelta;
  const nextIdx = Math.max(0, Math.min(dates.length - 1, idx + step));
  return dates[nextIdx] || latestBefore;
}

export function getAdjacentTradingDates(date, tradingDates, today = getBeijingDate()) {
  const dates = Array.isArray(tradingDates) && tradingDates.length ? tradingDates : _fallbackTradingDatesAround(date || today);
  const latest = resolveLatestTradingDate(today, dates);
  const current = resolveLatestTradingDate(date || latest, dates);
  const idx = dates.indexOf(current);
  return {
    current,
    latest,
    previous: idx > 0 ? dates[idx - 1] : null,
    next: idx >= 0 && idx < dates.length - 1 && dates[idx + 1] <= latest ? dates[idx + 1] : null
  };
}
