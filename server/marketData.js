import {
  parseAktoolsHistMinuteList,
  parseAktoolsIntradayTicks,
  parseAktoolsLimitUpList,
  parseAktoolsLimitUpReasonList,
  parseAktoolsSpotList,
  toAktoolsDate
} from '../src/js/aktoolsApi.js';
import { parseTradeCalendar } from '../src/js/tradeCalendar.js';
import { fetchWithTimeout, normalizeCodeParam } from './utils.js';

const AKTOOLS_BASE = process.env.AKTOOLS_BASE || 'http://127.0.0.1:8888';

const KIND_TO_INTERFACE = Object.freeze({
  limitUp: 'stock_zt_pool_em',
  broken: 'stock_zt_pool_zbgc_em'
});

async function fetchJson(url, signal) {
  const res = await fetchWithTimeout(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
}

function publicUrl(interfaceName, params = {}) {
  const url = new URL(`/api/public/${interfaceName}`, AKTOOLS_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function fetchAktoolsLimitPool(kind, date, signal) {
  const interfaceName = KIND_TO_INTERFACE[kind] || KIND_TO_INTERFACE.limitUp;
  const params = {};
  const normalizedDate = toAktoolsDate(date);
  if (normalizedDate) params.date = normalizedDate;
  const json = await fetchJson(publicUrl(interfaceName, params), signal);
  return parseAktoolsLimitUpList(json, kind);
}

export async function fetchAktoolsReasons(date, signal) {
  const normalized = toAktoolsDate(date);
  const params = {};
  if (normalized) {
    params.start_date = normalized;
    params.end_date = normalized;
  }
  const json = await fetchJson(publicUrl('stock_lhb_detail_em', params), signal);
  return parseAktoolsLimitUpReasonList(json);
}

export async function fetchAktoolsSpot(signal) {
  const json = await fetchJson(publicUrl('stock_zh_a_spot_em'), signal);
  return parseAktoolsSpotList(json);
}

export async function fetchAktoolsTradeCalendar(signal) {
  const json = await fetchJson(publicUrl('tool_trade_date_hist_sina'), signal);
  return parseTradeCalendar(json);
}

function stripMarketPrefix(code) {
  const normalized = normalizeCodeParam(code);
  return normalized ? normalized.slice(2) : '';
}

function normalizeDateDash(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return '';
}

export async function fetchAktoolsIntradayTicks(opts = {}) {
  const symbol = stripMarketPrefix(opts.code);
  if (!symbol) return parseAktoolsIntradayTicks([], opts);
  const json = await fetchJson(publicUrl('stock_intraday_em', { symbol }), opts.signal);
  return parseAktoolsIntradayTicks(json, opts);
}

export async function fetchAktoolsHistMinute(opts = {}) {
  const symbol = stripMarketPrefix(opts.code);
  const date = normalizeDateDash(opts.date);
  if (!symbol || !date) return parseAktoolsHistMinuteList([], opts);
  const json = await fetchJson(publicUrl('stock_zh_a_hist_min_em', {
    symbol,
    start_date: `${date} 09:15:00`,
    end_date: `${date} 15:00:00`,
    period: '1',
    adjust: ''
  }), opts.signal);
  return parseAktoolsHistMinuteList(json, opts);
}
