import { normalizeCode, toEastmoneySecId } from './parser.js';
import { isFutureCode } from './futures/instrument.js';
import { isFuturesMarketOpen } from './marketSession.js';
import {
  parseBeijingDateTimeToChartSeconds,
  parseTencentMinuteToChartSeconds,
  chartTimeToDate,
  getBeijingClockParts,
  getBeijingMinuteChartSeconds
} from './time.js';

export const PERIODS = Object.freeze({
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '60m': 60,
  '1d': 101,
  '1w': 102,
  '1M': 103
});

export const PERIOD_LABELS = Object.freeze({
  '1m': '1分',
  '5m': '5分',
  '15m': '15分',
  '30m': '30分',
  '60m': '60分',
  '1d': '日K',
  '1w': '周K',
  '1M': '月K'
});

export const DEFAULT_PERIOD = '1d';

export function isValidPeriod(p) {
  return typeof p === 'string' && Object.prototype.hasOwnProperty.call(PERIODS, p);
}

const MINUTE_PERIODS = new Set(['1m', '5m', '15m', '30m', '60m']);
export function isMinutePeriod(p) {
  return typeof p === 'string' && MINUTE_PERIODS.has(p);
}

export function periodToKlt(p) {
  if (!isValidPeriod(p)) return null;
  return PERIODS[p];
}

const KLINE_FIELDS1 = 'f1,f2,f3,f4,f5,f6';
const KLINE_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';

export function buildKlineUrl(code, opts = {}) {
  const secid = toEastmoneySecId(code);
  if (!secid) return null;
  const period = opts.period === undefined ? DEFAULT_PERIOD : opts.period;
  const klt = periodToKlt(period);
  if (klt === null) return null;
  const fqt = opts.fqt === undefined ? 1 : Number(opts.fqt);
  const lmt = opts.lmt === undefined ? 1000 : Number(opts.lmt);
  const beg = opts.beg === undefined ? 0 : Number(opts.beg);
  const end = opts.end === undefined ? 20500000 : Number(opts.end);
  const params = [
    `secid=${secid}`,
    `klt=${klt}`,
    `fqt=${fqt}`,
    `lmt=${lmt}`,
    `beg=${beg}`,
    `end=${end}`,
    `fields1=${KLINE_FIELDS1}`,
    `fields2=${KLINE_FIELDS2}`
  ];
  return `/api/eastmoney-kline/qt/stock/kline/get?${params.join('&')}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/;

function _parseKlineTime(str) {
  if (typeof str !== 'string') return null;
  if (DATE_RE.test(str)) return str;
  if (DATETIME_RE.test(str)) {
    return parseBeijingDateTimeToChartSeconds(str);
  }
  return null;
}

function _parseKlineRow(row) {
  if (typeof row !== 'string') return null;
  const parts = row.split(',');
  if (parts.length < 6) return null;
  const time = _parseKlineTime(parts[0]);
  if (time === null) return null;
  const open = parseFloat(parts[1]);
  const close = parseFloat(parts[2]);
  const high = parseFloat(parts[3]);
  const low = parseFloat(parts[4]);
  if (![open, close, high, low].every(Number.isFinite)) return null;
  const volume = parseInt(parts[5], 10);
  const amount = parseFloat(parts[6]) || 0;
  const changePercent = parseFloat(parts[8]) || 0;
  return {
    time,
    open,
    close,
    high,
    low,
    volume: Number.isFinite(volume) ? volume : 0,
    amount,
    changePercent
  };
}

function _resolveCode(data) {
  if (!data || !data.code) return '';
  const numeric = String(data.code);
  if (data.market === 1) return 'sh' + numeric;
  if (data.market === 0) return normalizeCode(numeric) || numeric;
  return normalizeCode(numeric) || numeric;
}

export function parseEastmoneyKline(json) {
  if (!json || typeof json !== 'object') return null;
  const d = json.data;
  if (!d || typeof d !== 'object') return null;
  const code = _resolveCode(d);
  const name = d.name || code;
  const klines = Array.isArray(d.klines) ? d.klines : [];
  const items = [];
  for (const row of klines) {
    const it = _parseKlineRow(row);
    if (it) items.push(it);
  }
  return { code, name, items };
}

function _round4(n) {
  return Math.round(n * 10000) / 10000;
}

export function calcMA(items, n) {
  if (!Array.isArray(items)) return [];
  if (!Number.isInteger(n) || n <= 0 || n > items.length) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const c = Number(items[i] && items[i].close);
    if (!Number.isFinite(c)) return [];
    sum += c;
  }
  out.push({ time: items[n - 1].time, value: _round4(sum / n) });
  for (let i = n; i < items.length; i++) {
    const cIn = Number(items[i] && items[i].close);
    const cOut = Number(items[i - n] && items[i - n].close);
    if (!Number.isFinite(cIn) || !Number.isFinite(cOut)) return [];
    sum += cIn - cOut;
    out.push({ time: items[i].time, value: _round4(sum / n) });
  }
  return out;
}

const DEFAULT_UP_COLOR = '#E74C3C';
const DEFAULT_DOWN_COLOR = '#27AE60';

export function formatVolumeBars(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const up = opts.up || DEFAULT_UP_COLOR;
  const down = opts.down || DEFAULT_DOWN_COLOR;
  return items.map((it) => ({
    time: it.time,
    value: Number(it.volume) || 0,
    color: it.close > it.open ? up : down
  }));
}

const TENCENT_PERIOD_TYPE = Object.freeze({
  '1m': 'm1',
  '5m': 'm5',
  '15m': 'm15',
  '30m': 'm30',
  '60m': 'm60',
  '1d': 'day',
  '1w': 'week',
  '1M': 'month'
});

const STOCK_CODE_RE = /^(sh|sz|bj)\d{6}$/i;

function _isTencentMinutePeriod(period) {
  const t = TENCENT_PERIOD_TYPE[period];
  return typeof t === 'string' && /^m\d/.test(t);
}

export function buildTencentKlineUrl(code, opts = {}) {
  if (!code || typeof code !== 'string' || !STOCK_CODE_RE.test(code)) return null;
  const period = opts.period === undefined ? DEFAULT_PERIOD : opts.period;
  const type = TENCENT_PERIOD_TYPE[period];
  if (!type) return null;
  const norm = code.toLowerCase();
  const lmtRaw = opts.lmt === undefined ? 320 : Number(opts.lmt);
  const lmt = Number.isFinite(lmtRaw) && lmtRaw > 0 ? Math.floor(lmtRaw) : 320;
  if (_isTencentMinutePeriod(period)) {
    return `/api/qq-kline-min/appstock/app/kline/mkline?param=${norm},${type},,${lmt}`;
  }
  return `/api/qq-kline/appstock/app/fqkline/get?param=${norm},${type},,,${lmt},qfq`;
}

export function buildTencentYearKlineUrl(code, year = new Date().getFullYear()) {
  if (!code || typeof code !== 'string' || !STOCK_CODE_RE.test(code)) return null;
  const safeYear = Number(year);
  if (!Number.isInteger(safeYear) || safeYear < 1990 || safeYear > 2100) return null;
  const norm = code.toLowerCase();
  const variable = `kline_dayqfq${safeYear}`;
  const url = new URL('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get');
  url.searchParams.set('_var', variable);
  url.searchParams.set('param', `${norm},day,${safeYear - 1}-01-01,${safeYear}-12-31,640,qfq`);
  return url.toString();
}

export function parseTencentKlineAssignment(text, period = '1d') {
  if (typeof text !== 'string') return null;
  const equalsAt = text.indexOf('=');
  if (equalsAt < 0) return null;
  try {
    const payload = text.slice(equalsAt + 1).trim().replace(/;$/, '');
    return parseTencentKline(JSON.parse(payload), period);
  } catch {
    return null;
  }
}

const TENCENT_MINUTE_TIME_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

function _parseTencentMinuteTime(raw) {
  if (!TENCENT_MINUTE_TIME_RE.test(String(raw))) return null;
  return parseTencentMinuteToChartSeconds(raw);
}

function _parseTencentRow(row, isMinute) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = isMinute ? _parseTencentMinuteTime(row[0]) : (DATE_RE.test(String(row[0])) ? String(row[0]) : null);
  if (time === null) return null;
  const open = parseFloat(row[1]);
  const close = parseFloat(row[2]);
  const high = parseFloat(row[3]);
  const low = parseFloat(row[4]);
  if (![open, close, high, low].every(Number.isFinite)) return null;
  const volume = parseFloat(row[5]);
  return {
    time,
    open,
    close,
    high,
    low,
    volume: Number.isFinite(volume) ? volume : 0,
    amount: 0,
    changePercent: 0
  };
}

export function parseTencentKline(json, period) {
  if (!json || typeof json !== 'object') return null;
  const data = json.data;
  if (!data || typeof data !== 'object') return null;
  const codes = Object.keys(data);
  if (!codes.length) return null;
  const code = codes[0].toLowerCase();
  const obj = data[codes[0]];
  if (!obj || typeof obj !== 'object') return { code, name: code, items: [] };

  const type = TENCENT_PERIOD_TYPE[period] || 'day';
  const isMinute = /^m\d/.test(type);

  let rows;
  if (isMinute) {
    rows = obj[type];
  } else {
    rows = obj['qfq' + type] || obj[type];
  }
  if (!Array.isArray(rows)) rows = [];

  let name = code;
  if (obj.qt && typeof obj.qt === 'object') {
    const qtRow = obj.qt[codes[0]];
    if (Array.isArray(qtRow) && qtRow.length > 1 && qtRow[1]) {
      name = String(qtRow[1]);
    }
  }

  const items = [];
  for (const row of rows) {
    const it = _parseTencentRow(row, isMinute);
    if (it) items.push(it);
  }
  return { code, name, items };
}

export const LIMIT_UP_COLOR = '#FFD700';
export const LIMIT_BROKEN_COLOR = '#E040FB';

const ST_RE = /^\s*\*?st\b/i;

export function getPriceLimit(code, name) {
  if (typeof code !== 'string' || code.length === 0) return 10;
  // 北交所涨跌停 30%（北交所不适用 5% ST 规则）
  if (/^bj/i.test(code)) return 30;
  // 去掉 sh/sz 前缀后看前缀号
  const numeric = code.replace(/^(sh|sz)/i, '');
  // 创业板 300xxx / 301xxx 涨跌停 20%（注册制规则：ST 股票亦为 20%）
  if (numeric.startsWith('30')) return 20;
  // 科创板 688xxx / 689xxx (CDR) 涨跌停 20%（注册制规则：ST 股票亦为 20%）
  if (numeric.startsWith('688') || numeric.startsWith('689')) return 20;
  // 仅沪深主板 ST / *ST 股票涨跌停为 5%
  if (typeof name === 'string' && ST_RE.test(name)) return 5;
  return 10;
}

export function classifyKlineBar(item, prevClose, limit) {
  if (!item) return 'normal';
  const pc = Number(prevClose);
  if (!Number.isFinite(pc) || pc <= 0) return 'normal';
  const lim = Number(limit) || 10;
  // 与同花顺指标一致：close 阈值 (limit - 0.2)，high 阈值 (limit - 0.9)
  const closeThreshold = lim - 0.2;
  const highThreshold = lim - 0.9;
  const closePct = (item.close / pc - 1) * 100;
  const highPct = (item.high / pc - 1) * 100;
  // 涨停：收盘 == 最高 且 close 涨幅达标
  if (closePct >= closeThreshold && item.close >= item.high - 1e-6) return 'limit-up';
  // 炸板：最高触及涨停区 但 收盘 < 最高
  if (highPct >= highThreshold && item.close < item.high) return 'limit-up-failed';
  return 'normal';
}

export function formatCandleColors(items, code, name) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const limit = getPriceLimit(code, name);
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const prevClose = i > 0 ? items[i - 1].close : null;
    const cls = classifyKlineBar(it, prevClose, limit);
    let color = null;
    if (cls === 'limit-up') color = LIMIT_UP_COLOR;
    else if (cls === 'limit-up-failed') color = LIMIT_BROKEN_COLOR;
    if (color) {
      out[i] = {
        time: it.time,
        open: it.open,
        high: it.high,
        low: it.low,
        close: it.close,
        color,
        borderColor: color,
        wickColor: color
      };
    } else {
      out[i] = {
        time: it.time,
        open: it.open,
        high: it.high,
        low: it.low,
        close: it.close
      };
    }
  }
  return out;
}

// Apply a live tick (current price) to a K-line array's last bar.
// - Day / week / month: only `close` is updated; high/low/open untouched.
// - Minute (m1/m5/m15/m30/m60): `close` updated and `high`/`low` are expanded
//   to encompass the new price so the in-progress bar reflects the current
//   price's wick extremes.
// Returns a new array; input is not mutated. Returns the input unchanged
// when invalid (empty / non-finite price / non-positive price).
export function applyLiveTickToKline(items, livePrice, period) {
  if (!Array.isArray(items) || !items.length) return items;
  const price = Number(livePrice);
  if (!Number.isFinite(price) || price <= 0) return items;

  const last = items[items.length - 1];
  const updated = { ...last, close: price };

  if (isMinutePeriod(period)) {
    const prevHigh = Number(last.high);
    const prevLow = Number(last.low);
    updated.high = Number.isFinite(prevHigh) ? Math.max(prevHigh, price) : price;
    updated.low = Number.isFinite(prevLow) ? Math.min(prevLow, price) : price;
  }

  return [...items.slice(0, -1), updated];
}

function _positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function applyLiveQuoteToKline(items, quote, period) {
  if (!Array.isArray(items) || !items.length || !quote || typeof quote !== 'object') return items;
  const price = _positiveNumber(quote.price);
  if (!price) return items;

  const last = items[items.length - 1];
  const lastDate = chartTimeToDate(last && last.time);
  const rawTargetDate = quote.tradingDay || quote.date || (quote.quoteDate && typeof quote.quoteDate === 'string' && quote.quoteDate.length === 8
    ? `${quote.quoteDate.slice(0, 4)}-${quote.quoteDate.slice(4, 6)}-${quote.quoteDate.slice(6, 8)}`
    : null);
  const targetDate = rawTargetDate ? (chartTimeToDate(rawTargetDate) || rawTargetDate) : null;

  const quoteHigh = _positiveNumber(quote.high);
  const quoteLow = _positiveNumber(quote.low);
  const quoteOpen = _positiveNumber(quote.open);
  const quoteVolume = _positiveNumber(quote.volume);
  const quoteAmount = _positiveNumber(quote.amount);

  if (period === '1d' && lastDate && targetDate && lastDate < targetDate) {
    const newTime = typeof last.time === 'number' ? parseBeijingDateTimeToChartSeconds(targetDate) : targetDate;
    const open = quoteOpen || price;
    const high = Math.max(price, quoteHigh || 0, open);
    const lowCandidates = [quoteLow, price, open].filter((v) => v > 0);
    const low = lowCandidates.length ? Math.min(...lowCandidates) : price;
    const newBar = {
      time: newTime,
      open,
      high,
      low,
      close: price,
      volume: quoteVolume || 0,
      amount: quoteAmount || 0,
      changePercent: Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : 0
    };
    return [...items, newBar];
  }

  const updated = { ...last, close: price };
  const lastHigh = _positiveNumber(last.high);
  const lastLow = _positiveNumber(last.low);
  updated.high = Math.max(lastHigh, quoteHigh, price);
  const lowCandidates = [lastLow, quoteLow, price].filter((value) => value > 0);
  updated.low = lowCandidates.length ? Math.min(...lowCandidates) : price;

  if (period === '1d') {
    if (quoteOpen) updated.open = quoteOpen;
    if (quoteVolume) updated.volume = quoteVolume;
    if (quoteAmount) updated.amount = quoteAmount;
    if (Number.isFinite(Number(quote.changePercent))) updated.changePercent = Number(quote.changePercent);
  }

  return [...items.slice(0, -1), updated];
}

function _isContinuousTradingMinute(parts) {
  const minutes = parts.hour * 60 + parts.minute;
  return (
    (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) ||
    (minutes >= 13 * 60 && minutes < 15 * 60)
  );
}

export function applyLiveQuoteToIntraday(items, quote, now = new Date(), isFuture = false) {
  if (!Array.isArray(items) || !items.length || !quote || typeof quote !== 'object') return items;
  const price = _positiveNumber(quote.price);
  if (!price) return items;
  const isFut = isFuture || quote.type === 'future' || quote.isFuture || (quote.code && isFutureCode(quote.code));
  if (isFut) {
    if (!isFuturesMarketOpen(now)) return items;
  } else {
    const parts = getBeijingClockParts(now);
    if (!_isContinuousTradingMinute(parts)) return items;
  }
  const time = getBeijingMinuteChartSeconds(now);
  if (!Number.isFinite(time)) return items;

  const last = items[items.length - 1];
  const lastTime = Number(last && last.time);
  if (Number.isFinite(lastTime) && time < lastTime) return items;
  const sameMinute = lastTime === time;
  const priorItems = sameMinute ? items.slice(0, -1) : items;
  const priorVolume = priorItems.reduce((sum, item) => sum + Math.max(0, Number(item && item.volume) || 0), 0);
  const cumulativeVolume = _positiveNumber(quote.volume);
  const minuteVolume = cumulativeVolume > 0
    ? Math.max(0, cumulativeVolume - priorVolume)
    : Math.max(0, Number(sameMinute && last ? last.volume : 0) || 0);
  const cumulativeAmount = _positiveNumber(quote.amount);
  const avgPrice = cumulativeAmount > 0 && cumulativeVolume > 0
    ? cumulativeAmount / (cumulativeVolume * 100)
    : _positiveNumber(last && last.avgPrice);
  const prevClose = _positiveNumber(quote.prevClose) || _positiveNumber(last && (last.preClose || last.prevClose));
  const base = sameMinute ? last : null;
  const baseOpen = _positiveNumber(base && base.open) || price;
  const baseHigh = _positiveNumber(base && base.high) || price;
  const baseLow = _positiveNumber(base && base.low) || price;
  const point = {
    ...(base || {}),
    time,
    open: baseOpen,
    high: Math.max(baseHigh, price),
    low: Math.min(baseLow, price),
    close: price,
    price,
    volume: minuteVolume,
    amount: Math.max(0, Number(base && base.amount) || 0),
    avgPrice,
    preClose: prevClose,
    percent: prevClose > 0 ? (price / prevClose - 1) * 100 : 0,
    changePercent: prevClose > 0 ? (price / prevClose - 1) * 100 : 0
  };
  return sameMinute ? [...priorItems, point] : [...items, point];
}

export function filterKlineItemsByDate(items, date) {
  if (!Array.isArray(items) || !date) return [];
  return items.filter((it) => chartTimeToDate(it && it.time) === date);
}

export function getLastKlineDate(items) {
  if (!Array.isArray(items) || !items.length) return '';
  for (let i = items.length - 1; i >= 0; i--) {
    const date = chartTimeToDate(items[i] && items[i].time);
    if (date) return date;
  }
  return '';
}
