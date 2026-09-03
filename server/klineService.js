import { toEastmoneySecId } from '../src/js/parser.js';
import {
  buildTencentKlineUrl,
  parseEastmoneyKline,
  parseTencentKline,
  periodToKlt
} from '../src/js/kline.js';
import { getOrRefresh, readCache } from './cacheStore.js';
import { fetchWithTimeout, normalizeCodeParam, normalizeDateKey, sanitizeSegment } from './utils.js';

const MINUTE_KLINE_TTL_MS = 2 * 60 * 1000;
const LONG_KLINE_TTL_MS = 60 * 60 * 1000;
const MINUTE_PERIODS = new Set(['1m', '5m', '15m', '30m', '60m']);
const KLINE_FIELDS1 = 'f1,f2,f3,f4,f5,f6';
const KLINE_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';
const EASTMONEY_FAILURE_LIMIT = 3;
const EASTMONEY_COOLDOWN_MS = 60 * 1000;
const TENCENT_MIN_REQUEST_INTERVAL_MS = 175;
const TENCENT_WAF_COOLDOWN_MS = 30 * 1000;
let eastmoneyFailures = 0;
let eastmoneyDisabledUntil = 0;
let nextTencentRequestAt = 0;
let tencentDisabledUntil = 0;

async function waitForTencentSlot() {
  const now = Date.now();
  if (now < tencentDisabledUntil) {
    throw new Error('Tencent kline temporarily blocked by WAF');
  }
  const startAt = Math.max(now, nextTencentRequestAt);
  nextTencentRequestAt = startAt + TENCENT_MIN_REQUEST_INTERVAL_MS;
  const delayMs = startAt - now;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildEastmoneyKlineUrl(code, period) {
  const secid = toEastmoneySecId(code);
  const klt = periodToKlt(period);
  if (!secid || klt === null) return null;
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', secid);
  url.searchParams.set('klt', String(klt));
  url.searchParams.set('fqt', '1');
  url.searchParams.set('lmt', '1000');
  url.searchParams.set('beg', '0');
  url.searchParams.set('end', '20500000');
  url.searchParams.set('fields1', KLINE_FIELDS1);
  url.searchParams.set('fields2', KLINE_FIELDS2);
  return url.toString();
}

function toAbsoluteTencentUrl(relativeUrl) {
  if (!relativeUrl) return null;
  if (relativeUrl.startsWith('/api/qq-kline-min')) {
    return `https://ifzq.gtimg.cn${relativeUrl.replace(/^\/api\/qq-kline-min/, '')}`;
  }
  if (relativeUrl.startsWith('/api/qq-kline')) {
    return `https://web.ifzq.gtimg.cn${relativeUrl.replace(/^\/api\/qq-kline/, '')}`;
  }
  return null;
}

async function fetchJson(url, signal, headers = {}) {
  const res = await fetchWithTimeout(url, { signal, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export function getKlineTtlMs(period) {
  return MINUTE_PERIODS.has(period) ? MINUTE_KLINE_TTL_MS : LONG_KLINE_TTL_MS;
}

async function fetchKlineNetwork(code, period, signal) {
  const emUrl = buildEastmoneyKlineUrl(code, period);
  if (emUrl && Date.now() >= eastmoneyDisabledUntil) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await fetchJson(emUrl, signal, {
          referer: 'https://quote.eastmoney.com/',
          'user-agent': 'Mozilla/5.0'
        });
        const parsed = parseEastmoneyKline(json);
        if (parsed && parsed.items && parsed.items.length) {
          eastmoneyFailures = 0;
          return parsed;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        eastmoneyFailures += 1;
        if (eastmoneyFailures >= EASTMONEY_FAILURE_LIMIT) {
          eastmoneyDisabledUntil = Date.now() + EASTMONEY_COOLDOWN_MS;
          break;
        }
      }
    }
  }

  const txUrl = toAbsoluteTencentUrl(buildTencentKlineUrl(code, { period }));
  if (!txUrl) throw new Error('No available kline upstream');
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForTencentSlot();
    try {
      const json = await fetchJson(txUrl, signal, {
        referer: 'https://gu.qq.com/',
        'user-agent': 'Mozilla/5.0'
      });
      const parsed = parseTencentKline(json, period);
      if (!parsed || !parsed.items || !parsed.items.length) throw new Error('Empty kline response');
      return parsed;
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      lastError = error;
      if (/HTTP 501/.test(error && error.message || '')) {
        tencentDisabledUntil = Math.max(tencentDisabledUntil, Date.now() + TENCENT_WAF_COOLDOWN_MS);
        break;
      }
    }
  }
  throw lastError || new Error('Empty kline response');
}

export async function getCachedKline({ code: rawCode, period = '1d', signal } = {}) {
  const code = normalizeCodeParam(rawCode);
  const safePeriod = sanitizeSegment(period);
  if (!code || !safePeriod || periodToKlt(safePeriod) === null) {
    const err = new Error('Invalid code or period');
    err.statusCode = 400;
    throw err;
  }

  const result = await getOrRefresh(
    ['kline', code, `${safePeriod}.json`],
    getKlineTtlMs(safePeriod),
    () => fetchKlineNetwork(code, safePeriod, signal)
  );
  return result;
}

function hasKlineOnOrAfter(data, targetDate) {
  const targetKey = normalizeDateKey(targetDate);
  const items = data && Array.isArray(data.items) ? data.items : [];
  if (!targetKey) return items.length > 0;
  return items.some((item) => String(item && item.time || '').replace(/-/g, '').slice(0, 8) >= targetKey);
}

export async function getKlineDataForMomentum(code, signal, targetDate) {
  const normalizedCode = normalizeCodeParam(code);
  const parts = ['kline', normalizedCode, '1d.json'];
  const cached = await readCache(parts, { skipTouch: true });
  if (cached && hasKlineOnOrAfter(cached.data, targetDate)) {
    return { data: cached.data, fresh: true, source: 'cache', upstreamError: '' };
  }
  const result = await getOrRefresh(
    parts,
    LONG_KLINE_TTL_MS,
    () => fetchKlineNetwork(normalizedCode, '1d', signal),
    {
      force: true,
      forceMinAgeMs: LONG_KLINE_TTL_MS,
      skipPrune: true,
      skipTouch: true
    }
  );
  return {
    data: result.data,
    fresh: hasKlineOnOrAfter(result.data, targetDate),
    source: result.source,
    upstreamError: result.upstreamError || ''
  };
}
