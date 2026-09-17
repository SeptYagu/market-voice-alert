import { parseFutureInput } from './futures/contractCatalog.js';
import { isFutureCode } from './futures/instrument.js';
import {
  getGlobalFuture,
  getGlobalFutureByMarketAndSymbol,
  getGlobalFutureBySinaSymbol,
  toEastmoneyGlobalSecId
} from './futures/globalCatalog.js';
import {
  parseBeijingDateTimeToChartSeconds,
  parseTencentMinuteToChartSeconds,
  chartTimeToDate
} from './time.js';
import { computeVwap } from './services/quoteMath.js';

export const ASSET_TYPES = Object.freeze({
  STOCK_CN: 'stock_cn',
  FUTURES_CN: 'futures_cn',
  FUTURES_GLOBAL: 'futures_global',
  STOCK_HK: 'stock_hk',
  STOCK_US: 'stock_us'
});

const VALID_PREFIXES = new Set(['sh', 'sz', 'bj']);

export function inferAssetType(code) {
  if (!code || typeof code !== 'string') return ASSET_TYPES.STOCK_CN;
  const raw = code.trim();
  if (/^gl_[a-z0-9_]+$/i.test(raw) || /^hf_[a-z0-9_]+$/i.test(raw)) {
    return ASSET_TYPES.FUTURES_GLOBAL;
  }
  if (isFutureCode(raw)) {
    return ASSET_TYPES.FUTURES_CN;
  }
  if (/^(?:sh|sz|bj)\d{6}$/i.test(raw) || /^\d{6}$/.test(raw)) {
    return ASSET_TYPES.STOCK_CN;
  }
  if (/^(?:hk|r_hk)\d{5}$/i.test(raw)) {
    return ASSET_TYPES.STOCK_HK;
  }
  if (/^us[a-z0-9._-]+$/i.test(raw)) {
    return ASSET_TYPES.STOCK_US;
  }
  // US Tickers with dot/underscore/hyphen without 'us' prefix (e.g. BRK.A, BRK.B, BF.B)
  if (/^[a-z]{1,5}[._-][a-z0-9]{1,3}$/i.test(raw)) {
    return ASSET_TYPES.STOCK_US;
  }
  return ASSET_TYPES.STOCK_CN;
}

export function normalizeCode(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // 严格拦截 hf_* 内部备源码
  if (/^hf_/i.test(raw)) return null;

  // 外盘期货 GL_*
  if (/^gl_[a-z0-9_]+$/i.test(raw)) {
    return raw.toUpperCase();
  }

  // 港股
  const hkMatch = raw.match(/^(?:hk|r_hk)(\d{5})$/i);
  if (hkMatch) {
    return `hk${hkMatch[1]}`;
  }

  // 美股
  if (/^us[a-z0-9._-]+$/i.test(raw)) {
    return `us${raw.slice(2).toUpperCase()}`;
  }

  const lower = raw.toLowerCase();
  const prefixMatch = lower.match(/^(sh|sz|bj)(\d{6})$/);
  if (prefixMatch) return prefixMatch[1] + prefixMatch[2];

  if (!/^\d{6}$/.test(lower)) return null;
  const first = lower[0];
  if (first === '6' || first === '5') return 'sh' + lower;
  if (first === '0' || first === '3' || first === '1') return 'sz' + lower;
  if (first === '4' || first === '8' || first === '9') return 'bj' + lower;
  return null;
}

export function inferMarket(code) {
  if (!code || typeof code !== 'string') return null;
  const m = code.match(/^(sh|sz|bj)\d{6}$/);
  if (!m) return null;
  return VALID_PREFIXES.has(m[1]) ? m[1] : null;
}

const US_MARKET_MAP = new Map([
  ['AAPL', '105'],
  ['TSLA', '105'],
  ['NVDA', '105'],
  ['MSFT', '105'],
  ['GOOG', '105'],
  ['GOOGL', '105'],
  ['AMZN', '105'],
  ['META', '105'],
  ['BABA', '106'],
  ['SPY', '107'],
  ['IMO', '107'],
  ['RLGT', '107'],
  ['BRK.A', '106'],
  ['BRK.B', '106'],
  ['BRK_A', '106'],
  ['BRK_B', '106'],
  ['BF.B', '106']
]);
const usSecIdCache = new Map();

export function setUsMarketId(symbol, marketId) {
  if (!symbol || !marketId) return;
  const clean = String(symbol).trim().toUpperCase();
  const mid = String(marketId);
  usSecIdCache.set(clean, mid);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(`market_us_${clean}`, mid);
    } catch {
      // ignore
    }
  }
}

export function resolveUsMarketId(symbol) {
  const clean = String(symbol).trim().toUpperCase();
  if (usSecIdCache.has(clean)) return usSecIdCache.get(clean);
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(`market_us_${clean}`);
      if (stored) {
        usSecIdCache.set(clean, stored);
        return stored;
      }
    } catch {
      // ignore
    }
  }
  const known = US_MARKET_MAP.get(clean) || US_MARKET_MAP.get(clean.replace(/\./g, '_')) || US_MARKET_MAP.get(clean.replace(/_/g, '.'));
  const marketId = known || null;
  if (marketId) {
    usSecIdCache.set(clean, marketId);
  }
  return marketId;
}

export function toEastmoneySecId(code) {
  if (!code || typeof code !== 'string') return null;
  const raw = code.trim();
  const upper = raw.toUpperCase();
  if (upper.startsWith('GL_')) {
    return toEastmoneyGlobalSecId(upper);
  }
  const lower = raw.toLowerCase();
  if (/^hk\d{5}$/.test(lower)) {
    return `116.${lower.slice(2)}`;
  }
  if (/^us[a-z0-9._-]+$/i.test(raw)) {
    const symbol = raw.slice(2);
    const cleanSym = symbol.replace(/\./g, '_');
    const marketId = resolveUsMarketId(symbol);
    if (!marketId) return null;
    return `${marketId}.${cleanSym.toUpperCase()}`;
  }
  const m = inferMarket(code);
  if (!m) return null;
  const num = code.slice(2);
  const marketId = m === 'sh' ? '1' : '0';
  return `${marketId}.${num}`;
}

const TENCENT_LINE_RE = /v_((?:sh|sz|bj)\d{6}|r_hk\d{5}|us[A-Za-z0-9._-]+)="([^"]*)"/gi;

export function parseTencent(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  let match;
  TENCENT_LINE_RE.lastIndex = 0;
  while ((match = TENCENT_LINE_RE.exec(text)) !== null) {
    const rawCode = match[1];
    let code = rawCode.toLowerCase();
    let type = 'stock';
    if (/^r_hk\d{5}$/i.test(rawCode)) {
      code = 'hk' + rawCode.slice(4);
      type = 'stock_hk';
    } else if (/^us[a-z0-9._-]+$/i.test(rawCode)) {
      code = 'us' + rawCode.slice(2).toUpperCase();
      type = 'stock_us';
    }
    const payload = match[2];
    if (!payload) continue;
    const fields = payload.split('~');
    if (fields.length < 35) continue;
    const price = parseFloat(fields[3]);
    if (!Number.isFinite(price)) continue;
    const amountParts = String(fields[35] || '').split('/');
    const amountFromCompound = parseFloat(amountParts[2]);
    const prevClose = parseFloat(fields[4]) || 0;
    const open = parseFloat(fields[5]) || 0;
    const change = parseFloat(fields[31]) || 0;
    const changePercent = parseFloat(fields[32]) || 0;
    const openChangePercent = (prevClose > 0 && open > 0) ? ((open - prevClose) / prevClose) * 100 : 0;
    const rawTime = String(fields[30] || '').trim();
    let updateTime = '';
    if (/^\d{14}$/.test(rawTime)) {
      updateTime = rawTime;
    } else if (/^\d{4}[/-]\d{2}[/-]\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(rawTime)) {
      updateTime = rawTime.replace(/[-/\s:]/g, '');
    }
    const vr = parseFloat(fields[49]);
    const volumeRatio = Number.isFinite(vr) ? vr : undefined;
    out.push({
      code,
      name: fields[1] || code,
      price,
      prevClose,
      open,
      volume: parseInt(fields[6], 10) || 0,
      amount: Number.isFinite(amountFromCompound) ? amountFromCompound : 0,
      volumeRatio,
      openChangePercent: Number(openChangePercent.toFixed(2)),
      change,
      changePercent,
      high: parseFloat(fields[33]) || 0,
      low: parseFloat(fields[34]) || 0,
      updateTime,
      quoteDate: updateTime ? updateTime.slice(0, 8) : '',
      marketStatus: String(fields[40] || '').trim().toUpperCase(),
      type,
      source: 'tencent'
    });
  }
  return out;
}

export function parseEastmoney(json) {
  if (!json || typeof json !== 'object' || !json.data) return null;
  const d = json.data;
  if (d.f43 === undefined || d.f43 === null || !d.f57) return null;

  const rawSymbol = String(d.f57).trim();
  // 市场号回显字段为 f107（f116 为总市值，切勿混淆）
  const marketId = (d.f107 !== undefined && d.f107 !== null && d.f107 !== '-') ? Number(d.f107) : null;
  const globalFuture = getGlobalFutureByMarketAndSymbol(marketId, rawSymbol);

  let qtDivisor = 100;
  let fullCode = '';
  let name = d.f58 || '';
  let type = 'stock';
  let decimals = 2;

  if (globalFuture) {
    qtDivisor = globalFuture.qtDivisor;
    fullCode = globalFuture.code;
    name = d.f58 || globalFuture.name;
    type = 'futures_global';
    decimals = globalFuture.priceDecimals !== undefined ? globalFuture.priceDecimals : 2;
  } else if (marketId === 116) {
    qtDivisor = 1000;
    fullCode = 'hk' + rawSymbol.toLowerCase().padStart(5, '0');
    name = d.f58 || fullCode;
    type = 'stock_hk';
    decimals = 2;
  } else if (marketId === 105 || marketId === 106 || marketId === 107) {
    qtDivisor = 1000;
    fullCode = 'us' + rawSymbol.toUpperCase().replace(/_/g, '.');
    name = d.f58 || fullCode;
    type = 'stock_us';
    decimals = 2;
    setUsMarketId(rawSymbol, marketId);
  } else {
    qtDivisor = 100;
    const rawLower = rawSymbol.toLowerCase();
    fullCode = normalizeCode(rawLower) || ((marketId === 1 ? 'sh' : 'sz') + rawLower);
    name = d.f58 || fullCode;
    type = 'stock';
    decimals = 2;
  }

  const div = (v) => (v !== undefined && v !== '-' && v !== null ? Number(v) / qtDivisor : 0);

  const price = div(d.f43);
  const prevClose = div(d.f60);
  const open = div(d.f46);
  const high = div(d.f44);
  const low = div(d.f45);
  const change = (d.f169 !== undefined && d.f169 !== null && d.f169 !== '-')
    ? div(d.f169)
    : (price - prevClose);
  const changePercent = (d.f170 !== undefined && d.f170 !== null && d.f170 !== '-')
    ? Number(d.f170) / 100
    : (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);
  const openChangePercent = (prevClose > 0 && open > 0) ? ((open - prevClose) / prevClose) * 100 : 0;

  return {
    code: fullCode,
    name,
    price: Number(price.toFixed(decimals)),
    prevClose: Number(prevClose.toFixed(decimals)),
    open: Number(open.toFixed(decimals)),
    high: Number(high.toFixed(decimals)),
    low: Number(low.toFixed(decimals)),
    volume: Number(d.f47) || 0,
    amount: Number(d.f48) || 0,
    volumeRatio: (d.f50 !== undefined && d.f50 !== null && d.f50 !== '-' && (typeof d.f50 !== 'string' || d.f50.trim() !== '') && Number.isFinite(Number(d.f50)))
      ? Number((Number(d.f50) / 100).toFixed(2))
      : undefined,
    openChangePercent: Number(openChangePercent.toFixed(2)),
    change: Number(change.toFixed(decimals)),
    changePercent: Number(changePercent.toFixed(2)),
    priceDecimals: decimals,
    currency: globalFuture?.currency || (type === 'stock_hk' ? 'HKD' : (type === 'stock_us' ? 'USD' : 'CNY')),
    type,
    source: 'eastmoney'
  };
}

export function parseSinaGlobalFuture(arg1, arg2, arg3) {
  if (!arg1) return null;
  let sinaSymbol = '';
  let payload = '';
  let opts = {};

  if (typeof arg1 === 'string' && typeof arg2 === 'string') {
    sinaSymbol = arg1.trim();
    payload = arg2.trim();
    opts = (typeof arg3 === 'object' && arg3 !== null) ? arg3 : {};
  } else if (typeof arg1 === 'string') {
    const raw = arg1.trim();
    opts = (typeof arg2 === 'object' && arg2 !== null) ? arg2 : {};
    const match = raw.match(/(?:var\s+)?hq_str_(hf_[A-Za-z0-9_]+)="([^"]*)"/i);
    if (match) {
      sinaSymbol = match[1];
      payload = match[2];
    } else if (raw.includes(',')) {
      payload = raw;
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (payload.includes('=')) {
    const m = payload.match(/(?:var\s+)?hq_str_(hf_[A-Za-z0-9_]+)="([^"]*)"/i);
    if (m) {
      if (!sinaSymbol) sinaSymbol = m[1];
      payload = m[2];
    }
  }

  const f = payload.split(',');
  if (f.length < 13) return null;

  const globalInfo = (opts.code && getGlobalFuture(opts.code)) || getGlobalFutureBySinaSymbol(sinaSymbol);
  const code = opts.code || (globalInfo ? globalInfo.code : sinaSymbol);
  const scale = Number.isFinite(opts.scale) ? opts.scale : (globalInfo ? globalInfo.sinaScale : 1.0);
  const decimals = globalInfo?.priceDecimals !== undefined ? globalInfo.priceDecimals : 2;

  const rawPrice = parseFloat(f[0]);
  if (!Number.isFinite(rawPrice)) return null;

  const price = rawPrice * scale;
  const high = (parseFloat(f[4]) || 0) * scale;
  const low = (parseFloat(f[5]) || 0) * scale;
  const prevClose = (parseFloat(f[7]) || 0) * scale;
  const open = (parseFloat(f[8]) || 0) * scale;
  const time = f[6] || '';
  const date = f[12] || '';
  const name = f[13] || globalInfo?.name || code;

  const rawFieldChange = parseFloat(f[1]);
  const change = Number.isFinite(rawFieldChange) ? rawFieldChange * scale : (prevClose > 0 ? price - prevClose : 0);
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const openChangePercent = (prevClose > 0 && open > 0) ? ((open - prevClose) / prevClose) * 100 : 0;

  return {
    code,
    name,
    price: Number(price.toFixed(decimals)),
    prevClose: Number(prevClose.toFixed(decimals)),
    open: Number(open.toFixed(decimals)),
    high: Number(high.toFixed(decimals)),
    low: Number(low.toFixed(decimals)),
    change: Number(change.toFixed(decimals)),
    changePercent: Number(changePercent.toFixed(2)),
    openChangePercent: Number(openChangePercent.toFixed(2)),
    priceDecimals: decimals,
    currency: globalInfo?.currency || 'USD',
    time,
    updateTime: (date && time) ? `${date.replace(/-/g, '')}${time.replace(/:/g, '')}` : '',
    quoteDate: date ? date.replace(/-/g, '') : '',
    type: 'futures_global',
    source: 'sina'
  };
}

const SINA_FUTURE_RE = /(?:var\s+)?hq_str_(?:(nf_?[a-z0-9]+)|(hf_[a-z0-9_]+))="([^"]*)"/gi;

export function parseSinaFuture(textOrSymbol, maybeText) {
  if (maybeText !== undefined && typeof textOrSymbol === 'string') {
    if (textOrSymbol.startsWith('hf_')) {
      return parseSinaGlobalFuture(textOrSymbol, maybeText);
    }
    const list = parseSinaFuture(maybeText);
    return list.find(q => q.code === textOrSymbol || q.symbol === textOrSymbol) || list[0] || null;
  }
  if (!textOrSymbol || typeof textOrSymbol !== 'string') return [];
  const text = textOrSymbol;
  const out = [];
  let match;
  SINA_FUTURE_RE.lastIndex = 0;
  while ((match = SINA_FUTURE_RE.exec(text)) !== null) {
    if (match[2]) {
      // hf_* global futures
      const parsedGlobal = parseSinaGlobalFuture(match[2], match[3]);
      if (parsedGlobal) out.push(parsedGlobal);
      continue;
    }
    const rawCode = match[1].toLowerCase();
    const code = rawCode.startsWith('nf_') ? rawCode.slice(3) : rawCode;
    const payload = match[3];
    if (!payload) continue;
    const f = payload.split(',');
    if (f.length < 10) continue;

    const isFinancial = Number.isFinite(parseFloat(f[0])) && !isNaN(Number(f[0]));
    let name = code;
    let open = 0;
    let high = 0;
    let low = 0;
    let prevClose = 0;
    let prevSettlement = 0;
    let price = 0;
    let volume = 0;
    let openInterest = 0;

    if (isFinancial) {
      open = parseFloat(f[0]) || 0;
      high = parseFloat(f[1]) || 0;
      low = parseFloat(f[2]) || 0;
      price = parseFloat(f[3]) || 0;
      volume = parseInt(f[4], 10) || 0;
      openInterest = parseInt(f[6], 10) || 0;
      prevClose = parseFloat(f[14]) || 0;
      prevSettlement = parseFloat(f[15]) || prevClose;
      const foundName = f.slice(35).find((x) => /[\u4e00-\u9fa5]/.test(x));
      name = foundName ? foundName.trim() : (f[f.length - 1] ? f[f.length - 1].trim() : code);
    } else {
      name = (f[0] || code).trim();
      open = parseFloat(f[2]) || 0;
      high = parseFloat(f[3]) || 0;
      low = parseFloat(f[4]) || 0;
      prevClose = parseFloat(f[5]) || 0;
      price = parseFloat(f[8]) || parseFloat(f[6]) || 0;
      prevSettlement = parseFloat(f[10]) || 0;
      openInterest = parseInt(f[13], 10) || 0;
      volume = parseInt(f[14], 10) || 0;
    }

    if (!Number.isFinite(price) || price === 0) continue;

    const inst = parseFutureInput(code);
    const basePrice = prevSettlement > 0 ? prevSettlement : (prevClose > 0 ? prevClose : price);
    const decimals = inst && inst.priceTick && inst.priceTick < 0.01 ? 3 : 2;
    const change = price - basePrice;
    const changePercent = basePrice > 0 ? ((change / basePrice) * 100) : 0;

    out.push({
      code,
      name,
      price,
      prevClose,
      prevSettlement: prevSettlement > 0 ? prevSettlement : null,
      priceTick: inst ? inst.priceTick : null,
      open,
      high,
      low,
      volume,
      openInterest,
      amount: 0,
      volumeRatio: 0,
      openChangePercent: basePrice > 0 ? Number((((open - basePrice) / basePrice) * 100).toFixed(2)) : 0,
      change: Number(change.toFixed(decimals)),
      changePercent: Number(changePercent.toFixed(2)),
      type: 'future',
      source: 'sina'
    });
  }
  return out;
}

function _normalizeTrendCode(data) {
  if (!data || !data.code) return '';
  if (data.market === 1) return `sh${data.code}`;
  return normalizeCode(String(data.code)) || String(data.code);
}

export function calcPercent(close, prevClose) {
  const c = Number(close);
  const pc = Number(prevClose);
  if (!Number.isFinite(c) || !Number.isFinite(pc) || pc <= 0) return 0;
  return (c / pc - 1) * 100;
}
const _calcPercent = calcPercent;

let _strategyResolver = null;
export function setStrategyResolver(resolver) {
  _strategyResolver = resolver;
}

export function _resolveRowTradingDay(time, code, customGetTradingDay) {
  if (typeof customGetTradingDay === 'function') {
    return customGetTradingDay(time);
  }
  if (code && typeof _strategyResolver === 'function') {
    try {
      const strategy = _strategyResolver(code);
      if (strategy && typeof strategy.getTradingDay === 'function') {
        return strategy.getTradingDay(time);
      }
    } catch {
      // ignore
    }
  }
  return chartTimeToDate(time);
}

function _parseTrendRow(row, prevClose, selectedDate, code, customGetTradingDay) {
  if (typeof row !== 'string') return null;
  const parts = row.split(',');
  if (parts.length < 7) return null;
  const time = parseBeijingDateTimeToChartSeconds(parts[0]);
  if (!Number.isFinite(time)) return null;
  if (selectedDate) {
    const itemDate = _resolveRowTradingDay(time, code, customGetTradingDay);
    if (itemDate !== selectedDate) return null;
  }
  const open = parseFloat(parts[1]);
  const close = parseFloat(parts[2]);
  const high = parseFloat(parts[3]);
  const low = parseFloat(parts[4]);
  if (![open, close, high, low].every(Number.isFinite)) return null;
  const volume = parseFloat(parts[5]);
  const amount = parseFloat(parts[6]);
  const avgPrice = parseFloat(parts[7]);
  const percent = _calcPercent(close, prevClose);
  return {
    time,
    open,
    close,
    high,
    low,
    volume: Number.isFinite(volume) ? volume : 0,
    amount: Number.isFinite(amount) ? amount : 0,
    avgPrice: Number.isFinite(avgPrice) ? avgPrice : 0,
    price: close,
    preClose: prevClose,
    percent,
    changePercent: percent
  };
}

export function parseEastmoneyTrends(json, opts = {}) {
  const d = json && json.data;
  if (!d || typeof d !== 'object') return null;
  const preClose = Number.isFinite(Number(d.preClose))
    ? Number(d.preClose)
    : (Number.isFinite(Number(opts.prevClose)) ? Number(opts.prevClose) : 0);
  const rows = Array.isArray(d.trends) ? d.trends : [];
  const selectedDate = opts.date || '';
  const code = opts.code || (d && d.code ? _normalizeTrendCode(d) : '');
  const items = [];
  for (const row of rows) {
    const it = _parseTrendRow(row, preClose, selectedDate, code, opts.getTradingDay);
    if (it) items.push(it);
  }
  return {
    code: code || _normalizeTrendCode(d),
    name: d.name || code || _normalizeTrendCode(d),
    source: 'eastmoney-trends2',
    preClose,
    items
  };
}

// Tencent minute/query rows: "HHmm price cumVolume(手) cumAmount(元)".
// Volume/amount are day-cumulative — diff them into per-minute values.
// avgPrice = cumAmount / (cumVolume * 100) (手 -> 股), sanity-banded against
// the close price to absorb any upstream unit surprises (e.g. an ETF day).
export function parseTencentMinute(json, opts = {}) {
  const code = typeof opts.code === 'string' ? opts.code.toLowerCase() : '';
  const payload = json && json.data && code ? json.data[code] : null;
  const day = payload && payload.data;
  if (!day || !Array.isArray(day.data) || !day.data.length) return null;
  const dataDate = typeof day.date === 'string' ? day.date : '';
  if (!/^\d{8}$/.test(dataDate)) return null;
  const selectedDate = opts.date ? String(opts.date).replace(/-/g, '') : '';
  if (selectedDate && dataDate !== selectedDate) return null;

  const qt = payload.qt && payload.qt[code];
  const prevClose = Number.isFinite(Number(qt && qt[4]))
    ? Number(qt[4])
    : (Number.isFinite(Number(opts.prevClose)) ? Number(opts.prevClose) : 0);

  const items = [];
  let prevCumVolume = 0;
  let prevCumAmount = 0;
  for (const row of day.data) {
    if (typeof row !== 'string') continue;
    const parts = row.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const time = parseTencentMinuteToChartSeconds(`${dataDate}${parts[0]}`);
    if (!Number.isFinite(time)) continue;
    const price = parseFloat(parts[1]);
    if (!Number.isFinite(price) || price <= 0) continue;
    const cumVolume = parts.length > 2 ? parseFloat(parts[2]) : NaN;
    const cumAmount = parts.length > 3 ? parseFloat(parts[3]) : NaN;
    let volume = 0;
    if (Number.isFinite(cumVolume)) {
      volume = Math.max(0, cumVolume - prevCumVolume);
      prevCumVolume = cumVolume;
    }
    let amount = 0;
    if (Number.isFinite(cumAmount)) {
      amount = Math.max(0, cumAmount - prevCumAmount);
      prevCumAmount = cumAmount;
    }
    const avgPrice = computeVwap(cumAmount, cumVolume, price, true);
    const percent = _calcPercent(price, prevClose);
    items.push({
      time,
      open: price,
      close: price,
      high: price,
      low: price,
      volume,
      amount,
      avgPrice,
      price,
      preClose: prevClose,
      percent,
      changePercent: percent
    });
  }
  return {
    code,
    name: (qt && qt[1]) || code,
    source: 'tencent-minute',
    preClose: prevClose,
    items
  };
}

