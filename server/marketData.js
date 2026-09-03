import {
  parseAktoolsHistMinuteList,
  parseAktoolsIntradayTicks,
  parseAktoolsLimitUpList,
  parseAktoolsLimitUpReasonList,
  parseAktoolsSpotList,
  toAktoolsDate
} from '../src/js/aktoolsApi.js';
import { parseTradeCalendar } from '../src/js/tradeCalendar.js';
import { parseEastmoneyTrends } from '../src/js/api.js';
import { parseTencent, toEastmoneySecId } from '../src/js/parser.js';
import { fetchWithTimeout, normalizeCodeParam } from './utils.js';

const AKTOOLS_BASE = process.env.AKTOOLS_BASE || 'http://127.0.0.1:8888';
const EASTMONEY_TRENDS_BASE = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get';
const EASTMONEY_TRENDS_FIELDS1 = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13';
const EASTMONEY_TRENDS_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58';
const TENCENT_QUOTE_BASE = 'https://qt.gtimg.cn/q=';
const TENCENT_QUOTE_BATCH_SIZE = 100;
const TENCENT_QUOTE_CONCURRENCY = 4;

const KIND_TO_INTERFACE = Object.freeze({
  limitUp: 'stock_zt_pool_em',
  broken: 'stock_zt_pool_zbgc_em'
});

async function fetchJson(url, signal, timeoutMs) {
  const res = await fetchWithTimeout(url, { signal, timeoutMs });
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
  const json = await fetchJson(publicUrl('stock_zh_a_spot_em'), signal, 5000);
  return parseAktoolsSpotList(json);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchTencentQuoteBatch(codes, signal) {
  const res = await fetchWithTimeout(`${TENCENT_QUOTE_BASE}${codes.join(',')}`, {
    signal,
    timeoutMs: 10_000,
    headers: {
      referer: 'https://gu.qq.com/',
      'user-agent': 'Mozilla/5.0'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
  return parseTencent(text);
}

export function isAStockCode(code) {
  return /^(?:sh(?:600|601|603|605|688|689)\d{3}|sz(?:000|001|002|003|300|301|302)\d{3}|bj(?:43|83|87|88|92)\d{4})$/.test(String(code || '').toLowerCase());
}

export async function fetchTencentSpot(codes, signal) {
  const allNormalized = [...new Set((Array.isArray(codes) ? codes : [])
    .map((code) => normalizeCodeParam(code))
    .filter(Boolean))];
  const normalized = allNormalized.filter(isAStockCode);
  const batches = [];
  for (let i = 0; i < normalized.length; i += TENCENT_QUOTE_BATCH_SIZE) {
    batches.push(normalized.slice(i, i + TENCENT_QUOTE_BATCH_SIZE));
  }
  const failures = [];
  const results = await mapLimit(batches, TENCENT_QUOTE_CONCURRENCY, async (batch) => {
    try {
      return await fetchTencentQuoteBatch(batch, signal);
    } catch (firstError) {
      if (firstError && firstError.name === 'AbortError') throw firstError;
      try {
        return await fetchTencentQuoteBatch(batch, signal);
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        failures.push({
          firstCode: batch[0],
          count: batch.length,
          error: error && error.message ? error.message : String(error)
        });
        return [];
      }
    }
  });
  const allQuotes = results.flat();
  const items = allQuotes.filter((item) => (
    item &&
    item.marketStatus !== 'D' &&
    item.marketStatus !== 'S' &&
    Number(item.price) > 0 &&
    !/^bj81/.test(item.code)
  ));
  return {
    items,
    stats: {
      seedCount: normalized.length,
      inputCount: allNormalized.length,
      receivedCount: allQuotes.length,
      eligibleCount: items.length,
      deletedCount: allQuotes.filter((item) => item.marketStatus === 'D').length,
      suspendedCount: allQuotes.filter((item) => item.marketStatus === 'S').length,
      excludedNonStockCount: allNormalized.length - normalized.length,
      missingCount: Math.max(0, normalized.length - allQuotes.length),
      failedBatches: failures
    }
  };
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
  const json = await fetchJson(publicUrl('stock_intraday_em', { symbol }), opts.signal, 3500);
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
  }), opts.signal, 3500);
  return parseAktoolsHistMinuteList(json, opts);
}

export async function fetchEastmoneyIntradayTrends(opts = {}) {
  const code = normalizeCodeParam(opts.code);
  const secid = code ? toEastmoneySecId(code) : '';
  if (!secid) return parseEastmoneyTrends({}, opts);
  const url = new URL(EASTMONEY_TRENDS_BASE);
  url.searchParams.set('secid', secid);
  url.searchParams.set('fields1', EASTMONEY_TRENDS_FIELDS1);
  url.searchParams.set('fields2', EASTMONEY_TRENDS_FIELDS2);
  url.searchParams.set('ndays', '1');
  url.searchParams.set('iscr', '0');
  url.searchParams.set('iscca', '0');
  const json = await fetchJson(url.toString(), opts.signal, 3500);
  return parseEastmoneyTrends(json, opts);
}
