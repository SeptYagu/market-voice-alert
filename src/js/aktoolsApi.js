import { normalizeCode, inferMarket } from './parser.js';
import { isLimitUpName } from './limitUp.js';
import { parseBeijingDateTimeToChartSeconds, chartTimeToDate } from './time.js';

const KIND_TO_INTERFACE = Object.freeze({
  limitUp: 'stock_zt_pool_em',
  broken: 'stock_zt_pool_zbgc_em'
});

const SOURCE_FOR_KIND = Object.freeze({
  limitUp: 'aktools-limitUp',
  broken: 'aktools-broken'
});

const CACHE = new Map();
const CACHE_TTL_MS = 30000;
const AKTOOLS_PUBLIC_BASE = '/api/aktools/api/public';

// 2026-06-05 fix: HTML5 <input type="date"> returns YYYY-MM-DD but AKTools
// wants YYYYMMDD in the URL. Without this conversion the upstream returns
// an empty list (silently), so the UI shows no data. See bug report:
// "选中某一天后无显示".
export function toAktoolsDate(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '');
  return s;
}

export function buildAktoolsUrl(kind, params = {}) {
  const interfaceName = KIND_TO_INTERFACE[kind] || KIND_TO_INTERFACE.limitUp;
  return buildAktoolsPublicUrl(interfaceName, params);
}

export function buildAktoolsPublicUrl(interfaceName, params = {}) {
  if (!interfaceName || typeof interfaceName !== 'string') return null;
  const base = `${AKTOOLS_PUBLIC_BASE}/${interfaceName}`;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue;
    if (k === 'date') {
      const normalized = toAktoolsDate(v);
      if (!normalized) continue;
      usp.set(k, normalized);
      continue;
    }
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}

function _safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _formatHHMM(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  if (/^\d{4}$/.test(s)) return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  return null;
}

function _parseItem(row, kind) {
  if (!row || typeof row !== 'object') return null;
  const code6 = String(row.代码 || '').trim();
  if (!/^\d{6}$/.test(code6)) return null;
  const code = normalizeCode(code6);
  if (!code) return null;
  const name = (typeof row.名称 === 'string' && row.名称) ? row.名称 : code;
  const price = _safeNum(row.最新价, NaN);
  if (!Number.isFinite(price) || price <= 0) return null;
  const changePercent = _safeNum(row.涨跌幅, 0);
  const change = (price * changePercent) / 100;
  const source = SOURCE_FOR_KIND[kind] || SOURCE_FOR_KIND.limitUp;
  const limitUpCount = kind === 'broken' ? 0 : Math.max(0, Math.floor(_safeNum(row.连板数, 0)));

  return {
    code,
    name,
    market: inferMarket(code),
    price,
    change,
    changePercent,
    amount: _safeNum(row.成交额, 0),
    limitUpCount,
    firstLimitTime: _formatHHMM(row.首次封板时间),
    breakCount: Math.max(0, Math.floor(_safeNum(row.炸板次数, 0))),
    isST: isLimitUpName(name),
    open: 0,
    high: 0,
    low: 0,
    source,
    lastLimitTime: _formatHHMM(row.最后封板时间),
    industry: typeof row.所属行业 === 'string' ? row.所属行业 : '',
    limitStats: typeof row.涨停统计 === 'string' ? row.涨停统计 : ''
  };
}

export function parseAktoolsLimitUpList(json, kind = 'limitUp') {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const row of json) {
    const it = _parseItem(row, kind);
    if (it) out.push(it);
  }
  return out;
}

function _cacheKey(kind, date) {
  return `${kind}|${date || ''}`;
}

export async function fetchAktoolsLimitUpList(opts = {}) {
  const kind = opts.kind || 'limitUp';
  const date = opts.date || null;
  const key = _cacheKey(kind, date);
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const url = buildAktoolsUrl(kind, { date });
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = await res.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buf);
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  const data = parseAktoolsLimitUpList(json, kind);
  CACHE.set(key, { at: Date.now(), data });
  return data;
}

export function clearAktoolsCache() {
  CACHE.clear();
}

// =====================================================================
// Dragon-Tiger Board (龙虎榜) "上榜原因" + "解读".
// stock_lhb_detail_em?start_date=YYYYMMDD&end_date=YYYYMMDD returns ~100
// rows per trading day with 上榜原因 (e.g. "日涨幅偏离值达7%的证券") and
// 解读 (e.g. "3家机构买入"). Used to enrich limit-up rows with context.
// =====================================================================

const REASON_INTERFACE = 'stock_lhb_detail_em';
const REASON_MAX_LEN = 100;

function _buildReasonUrl(date) {
  const base = `/api/aktools/api/public/${REASON_INTERFACE}`;
  const normalized = toAktoolsDate(date);
  if (!normalized) return base;
  const usp = new URLSearchParams();
  usp.set('start_date', normalized);
  usp.set('end_date', normalized);
  return `${base}?${usp.toString()}`;
}

function _formatDate(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return '';
}

function _truncate(s, max) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

function _parseReasonItem(row) {
  if (!row || typeof row !== 'object') return null;
  const code6 = String(row.代码 || '').trim();
  if (!/^\d{6}$/.test(code6)) return null;
  const code = normalizeCode(code6);
  if (!code) return null;
  return {
    code,
    name: (typeof row.名称 === 'string' && row.名称) ? row.名称 : code,
    reason: _truncate(row.上榜原因, REASON_MAX_LEN),
    interpretation: _truncate(row.解读, REASON_MAX_LEN),
    pct: _safeNum(row.涨跌幅, 0),
    date: _formatDate(row.上榜日)
  };
}

export function parseAktoolsLimitUpReasonList(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const row of json) {
    const it = _parseReasonItem(row);
    if (it) out.push(it);
  }
  return out;
}

export async function fetchAktoolsLimitUpReasonList(opts = {}) {
  const date = opts.date || null;
  const key = `reason|${date || ''}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const url = _buildReasonUrl(date);
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = await res.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buf);
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  const data = parseAktoolsLimitUpReasonList(json);
  CACHE.set(key, { at: Date.now(), data });
  return data;
}

// =====================================================================
// Intraday data via AKTools / AKShare.
//
// Primary: stock_intraday_em (tick-level latest trading day; includes
// opening auction/pre-market ticks according to AKShare docs).
// Fallback: stock_zh_a_hist_min_em (recent historical 1-minute bars).
// =====================================================================

const INTRADAY_TICK_INTERFACE = 'stock_intraday_em';
const HIST_MIN_INTERFACE = 'stock_zh_a_hist_min_em';
const SPOT_INTERFACE = 'stock_zh_a_spot_em';

function _stripMarketPrefix(code) {
  if (!code || typeof code !== 'string') return '';
  const s = code.trim();
  const m = /^(?:sh|sz|bj)?(\d{6})$/i.exec(s);
  return m ? m[1] : '';
}

function _normalizeDateDash(date) {
  if (!date) return '';
  const s = String(date).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return '';
}

function _parseAktoolsTime(date, raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    return parseBeijingDateTimeToChartSeconds(s);
  }
  const d = _normalizeDateDash(date);
  if (!d) return null;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    const parts = s.split(':');
    const hh = parts[0].padStart(2, '0');
    const mm = parts[1].padStart(2, '0');
    const ss = (parts[2] || '00').padStart(2, '0');
    return parseBeijingDateTimeToChartSeconds(`${d} ${hh}:${mm}:${ss}`);
  }
  return null;
}

function _minuteKeyFromChartSeconds(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const d = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate())
  ].join('-') + ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function _percent(close, prevClose) {
  const c = Number(close);
  const pc = Number(prevClose);
  if (!Number.isFinite(c) || !Number.isFinite(pc) || pc <= 0) return 0;
  return (c / pc - 1) * 100;
}

function _openPercent(open, prevClose) {
  const o = Number(open);
  const pc = Number(prevClose);
  if (!Number.isFinite(o) || !Number.isFinite(pc) || pc <= 0 || o <= 0) return NaN;
  return (o / pc - 1) * 100;
}

function _withIntradayDerivedFields(items, prevClose) {
  if (!Array.isArray(items) || !items.length) return [];
  let cumAmount = 0;
  let cumVolume = 0;
  return items
    .slice()
    .sort((a, b) => Number(a.time) - Number(b.time))
    .map((it) => {
      const volume = Number(it.volume) || 0;
      const amount = Number(it.amount) || 0;
      cumVolume += volume;
      cumAmount += amount;
      const avgPrice = Number.isFinite(Number(it.avgPrice)) && Number(it.avgPrice) > 0
        ? Number(it.avgPrice)
        : (cumVolume > 0 ? cumAmount / (cumVolume * 100) : 0);
      const pct = Number.isFinite(Number(it.percent))
        ? Number(it.percent)
        : _percent(it.close, prevClose);
      return {
        ...it,
        volume,
        amount,
        avgPrice,
        price: Number(it.close),
        preClose: Number.isFinite(Number(prevClose)) ? Number(prevClose) : 0,
        percent: pct,
        changePercent: pct
      };
    });
}

function _dataShape(code, name, items, source, prevClose) {
  const normalized = normalizeCode(_stripMarketPrefix(code)) || normalizeCode(code) || code || '';
  return {
    code: normalized,
    name: name || normalized,
    source,
    preClose: Number.isFinite(Number(prevClose)) ? Number(prevClose) : 0,
    items: Array.isArray(items) ? items : []
  };
}

export function buildAktoolsIntradayUrl(code) {
  const symbol = _stripMarketPrefix(code);
  if (!symbol) return null;
  return buildAktoolsPublicUrl(INTRADAY_TICK_INTERFACE, { symbol });
}

export function buildAktoolsHistMinuteUrl(code, opts = {}) {
  const symbol = _stripMarketPrefix(code);
  const date = _normalizeDateDash(opts.date);
  if (!symbol || !date) return null;
  return buildAktoolsPublicUrl(HIST_MIN_INTERFACE, {
    symbol,
    start_date: `${date} 09:15:00`,
    end_date: `${date} 15:00:00`,
    period: '1',
    adjust: ''
  });
}

export function parseAktoolsIntradayTicks(json, opts = {}) {
  const code = opts.code || '';
  const name = opts.name || code;
  const prevClose = Number(opts.prevClose);
  if (!Array.isArray(json)) {
    return _dataShape(code, name, [], 'aktools-stock_intraday_em', prevClose);
  }

  const buckets = new Map();
  for (const row of json) {
    if (!row || typeof row !== 'object') continue;
    const time = _parseAktoolsTime(opts.date, row.时间);
    const price = _safeNum(row.成交价, NaN);
    if (!Number.isFinite(time) || !Number.isFinite(price) || price <= 0) continue;
    const key = _minuteKeyFromChartSeconds(time);
    if (!key) continue;
    const volume = Math.max(0, _safeNum(row.手数, 0));
    const amount = price * volume * 100;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        time: parseBeijingDateTimeToChartSeconds(key),
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
        amount
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume += volume;
      existing.amount += amount;
    }
  }

  const items = _withIntradayDerivedFields([...buckets.values()], prevClose);
  return _dataShape(code, name, items, 'aktools-stock_intraday_em', prevClose);
}

export function parseAktoolsHistMinuteList(json, opts = {}) {
  const code = opts.code || '';
  const name = opts.name || code;
  const prevClose = Number(opts.prevClose);
  if (!Array.isArray(json)) {
    return _dataShape(code, name, [], 'aktools-stock_zh_a_hist_min_em', prevClose);
  }

  const date = _normalizeDateDash(opts.date);
  const items = [];
  for (const row of json) {
    if (!row || typeof row !== 'object') continue;
    const time = _parseAktoolsTime(date, row.时间);
    if (!Number.isFinite(time)) continue;
    if (date && chartTimeToDate(time) !== date) continue;
    const open = _safeNum(row.开盘, NaN);
    const close = _safeNum(row.收盘, NaN);
    const high = _safeNum(row.最高, NaN);
    const low = _safeNum(row.最低, NaN);
    if (![open, close, high, low].every(Number.isFinite)) continue;
    const volume = Math.max(0, _safeNum(row.成交量, 0));
    const amount = Math.max(0, _safeNum(row.成交额, 0));
    const avgPrice = _safeNum(row.均价, 0);
    items.push({
      time,
      open,
      close,
      high,
      low,
      volume,
      amount,
      avgPrice,
      percent: _percent(close, prevClose)
    });
  }

  return _dataShape(
    code,
    name,
    _withIntradayDerivedFields(items, prevClose),
    'aktools-stock_zh_a_hist_min_em',
    prevClose
  );
}

function _parseAktoolsSpotItem(row) {
  if (!row || typeof row !== 'object') return null;
  const code6 = String(row.代码 || '').trim();
  if (!/^\d{6}$/.test(code6)) return null;
  const code = normalizeCode(code6);
  if (!code) return null;
  const price = _safeNum(row.最新价, NaN);
  const prevClose = _safeNum(row.昨收, NaN);
  const open = _safeNum(row.今开, NaN);
  const changePercent = _safeNum(row.涨跌幅, 0);
  const change = _safeNum(row.涨跌额, price * changePercent / 100);
  return {
    code,
    name: (typeof row.名称 === 'string' && row.名称) ? row.名称 : code,
    market: inferMarket(code),
    price: Number.isFinite(price) ? price : 0,
    change,
    changePercent,
    prevClose: Number.isFinite(prevClose) ? prevClose : 0,
    open: Number.isFinite(open) ? open : 0,
    openChangePercent: _openPercent(open, prevClose),
    high: _safeNum(row.最高, 0),
    low: _safeNum(row.最低, 0),
    volume: _safeNum(row.成交量, 0),
    amount: _safeNum(row.成交额, 0),
    volumeRatio: _safeNum(row.量比, 0),
    turnoverRate: _safeNum(row.换手率, 0),
    industry: typeof row.所属行业 === 'string'
      ? row.所属行业
      : (typeof row.行业 === 'string' ? row.行业 : ''),
    source: 'aktools-stock_zh_a_spot_em'
  };
}

export function parseAktoolsSpotList(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const row of json) {
    const it = _parseAktoolsSpotItem(row);
    if (it) out.push(it);
  }
  return out;
}

async function _fetchAktoolsJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buf);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
}

export async function fetchAktoolsIntradayTicks(opts = {}) {
  const url = buildAktoolsIntradayUrl(opts.code);
  if (!url) return _dataShape(opts.code || '', opts.name || opts.code || '', [], 'aktools-stock_intraday_em', opts.prevClose);
  const json = await _fetchAktoolsJson(url, opts.signal);
  return parseAktoolsIntradayTicks(json, opts);
}

export async function fetchAktoolsHistMinute(opts = {}) {
  const url = buildAktoolsHistMinuteUrl(opts.code, { date: opts.date });
  if (!url) return _dataShape(opts.code || '', opts.name || opts.code || '', [], 'aktools-stock_zh_a_hist_min_em', opts.prevClose);
  const json = await _fetchAktoolsJson(url, opts.signal);
  return parseAktoolsHistMinuteList(json, opts);
}

export async function fetchAktoolsSpotList(opts = {}) {
  const url = buildAktoolsPublicUrl(SPOT_INTERFACE);
  const json = await _fetchAktoolsJson(url, opts.signal);
  return parseAktoolsSpotList(json);
}
