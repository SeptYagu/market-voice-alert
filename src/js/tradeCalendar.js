import { formatDateForInput, shiftCalendarDate } from './time.js';

const CALENDAR_URL = '/api/aktools/api/public/tool_trade_date_hist_sina';
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

function _fallbackTradingDatesAround(anchor = formatDateForInput(new Date())) {
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
  calendarPromise = fetch(CALENDAR_URL, { signal: opts.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseTradeCalendar(await res.json());
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
  const anchor = _toDateString(date) || formatDateForInput(new Date());
  const dates = Array.isArray(tradingDates) && tradingDates.length ? tradingDates : _fallbackTradingDatesAround(anchor);
  let best = '';
  for (const d of dates) {
    if (d <= anchor) best = d;
    else break;
  }
  return best || dates[0] || anchor;
}

export function shiftTradingDate(date, delta, tradingDates) {
  const dates = Array.isArray(tradingDates) && tradingDates.length ? tradingDates : _fallbackTradingDatesAround(date);
  const current = resolveLatestTradingDate(date, dates);
  const idx = dates.indexOf(current);
  if (idx < 0) return current;
  const nextIdx = Math.max(0, Math.min(dates.length - 1, idx + Number(delta || 0)));
  return dates[nextIdx] || current;
}

export function getAdjacentTradingDates(date, tradingDates, today = formatDateForInput(new Date())) {
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
