import { parseFutureInput } from './futures/contractCatalog.js';
import {
  parseBeijingDateTimeToChartSeconds,
  parseTencentMinuteToChartSeconds,
  chartTimeToDate
} from './time.js';

const VALID_PREFIXES = new Set(['sh', 'sz', 'bj']);

export function normalizeCode(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;

  const prefixMatch = raw.match(/^(sh|sz|bj)(\d{6})$/);
  if (prefixMatch) return prefixMatch[1] + prefixMatch[2];

  if (!/^\d{6}$/.test(raw)) return null;
  const first = raw[0];
  if (first === '6' || first === '5') return 'sh' + raw;
  if (first === '0' || first === '3' || first === '1') return 'sz' + raw;
  if (first === '4' || first === '8' || first === '9') return 'bj' + raw;
  return null;
}

export function inferMarket(code) {
  if (!code || typeof code !== 'string') return null;
  const m = code.match(/^(sh|sz|bj)\d{6}$/);
  if (!m) return null;
  return VALID_PREFIXES.has(m[1]) ? m[1] : null;
}

export function toEastmoneySecId(code) {
  const m = inferMarket(code);
  if (!m) return null;
  const num = code.slice(2);
  const marketId = m === 'sh' ? '1' : '0';
  return `${marketId}.${num}`;
}

const TENCENT_LINE_RE = /v_([a-z]{2}\d{6})="([^"]*)"/gi;

export function parseTencent(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  let match;
  TENCENT_LINE_RE.lastIndex = 0;
  while ((match = TENCENT_LINE_RE.exec(text)) !== null) {
    const code = match[1].toLowerCase();
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
    const updateTime = /^\d{14}$/.test(String(fields[30] || '')) ? String(fields[30]) : '';
    out.push({
      code,
      name: fields[1] || code,
      price,
      prevClose,
      open,
      volume: parseInt(fields[6], 10) || 0,
      amount: Number.isFinite(amountFromCompound) ? amountFromCompound : 0,
      volumeRatio: parseFloat(fields[49]) || 0,
      openChangePercent: Number(openChangePercent.toFixed(2)),
      change,
      changePercent,
      high: parseFloat(fields[33]) || 0,
      low: parseFloat(fields[34]) || 0,
      updateTime,
      quoteDate: updateTime ? updateTime.slice(0, 8) : '',
      marketStatus: String(fields[40] || '').trim().toUpperCase(),
      type: 'stock',
      source: 'tencent'
    });
  }
  return out;
}

const div100 = (v) => (v !== undefined && v !== '-' && v !== null ? Number(v) / 100 : 0);

export function parseEastmoney(json) {
  if (!json || typeof json !== 'object' || !json.data) return null;
  const d = json.data;
  if (d.f43 === undefined || d.f43 === null || !d.f57) return null;
  const price = div100(d.f43);
  const prevClose = div100(d.f60);
  const open = div100(d.f46);
  const change = d.f169 !== undefined && d.f169 !== null && d.f169 !== '-'
    ? div100(d.f169)
    : (price - prevClose);
  const changePercent = d.f170 !== undefined && d.f170 !== null && d.f170 !== '-'
    ? div100(d.f170)
    : (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);
  const rawCode = String(d.f57).toLowerCase();
  const fullCode = normalizeCode(rawCode) || ((d.f107 === 1 ? 'sh' : 'sz') + rawCode);
  return {
    code: fullCode,
    name: d.f58 || fullCode,
    price: Number(price.toFixed(2)),
    prevClose: Number(prevClose.toFixed(2)),
    open: Number(open.toFixed(2)),
    high: div100(d.f44),
    low: div100(d.f45),
    volume: Number(d.f47) || 0,
    amount: Number(d.f48) || 0,
    volumeRatio: div100(d.f50),
    openChangePercent: (prevClose > 0 && open > 0) ? Number((((open - prevClose) / prevClose) * 100).toFixed(2)) : 0,
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    type: 'stock',
    source: 'eastmoney'
  };
}

const SINA_FUTURE_RE = /(?:var\s+)?hq_str_(nf_?[a-z0-9]+)="([^"]*)"/gi;

export function parseSinaFuture(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  let match;
  SINA_FUTURE_RE.lastIndex = 0;
  while ((match = SINA_FUTURE_RE.exec(text)) !== null) {
    const rawCode = match[1].toLowerCase();
    const code = rawCode.startsWith('nf_') ? rawCode.slice(3) : rawCode;
    const payload = match[2];
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

function _parseTrendRow(row, prevClose, selectedDate) {
  if (typeof row !== 'string') return null;
  const parts = row.split(',');
  if (parts.length < 7) return null;
  const time = parseBeijingDateTimeToChartSeconds(parts[0]);
  if (!Number.isFinite(time)) return null;
  if (selectedDate && chartTimeToDate(time) !== selectedDate) return null;
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
  const items = [];
  for (const row of rows) {
    const it = _parseTrendRow(row, preClose, selectedDate);
    if (it) items.push(it);
  }
  return {
    code: _normalizeTrendCode(d),
    name: d.name || _normalizeTrendCode(d),
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
    let avgPrice = 0;
    if (Number.isFinite(cumAmount) && Number.isFinite(cumVolume) && cumVolume > 0) {
      const raw = cumAmount / (cumVolume * 100);
      if (raw >= price * 0.1 && raw <= price * 10) avgPrice = Math.round(raw * 1000) / 1000;
    }
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

