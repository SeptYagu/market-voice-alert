import { toEastmoneySecId } from '../src/js/parser.js';
import {
  buildTencentKlineUrl,
  parseEastmoneyKline,
  parseTencentKline,
  periodToKlt
} from '../src/js/kline.js';
import { getOrRefresh } from './cacheStore.js';
import { fetchWithTimeout, normalizeCodeParam, sanitizeSegment } from './utils.js';

const MINUTE_KLINE_TTL_MS = 2 * 60 * 1000;
const LONG_KLINE_TTL_MS = 60 * 60 * 1000;
const MINUTE_PERIODS = new Set(['1m', '5m', '15m', '30m', '60m']);
const KLINE_FIELDS1 = 'f1,f2,f3,f4,f5,f6';
const KLINE_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';

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
  if (emUrl) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await fetchJson(emUrl, signal, {
          referer: 'https://quote.eastmoney.com/',
          'user-agent': 'Mozilla/5.0'
        });
        const parsed = parseEastmoneyKline(json);
        if (parsed && parsed.items && parsed.items.length) return parsed;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
      }
    }
  }

  const txUrl = toAbsoluteTencentUrl(buildTencentKlineUrl(code, { period }));
  if (!txUrl) throw new Error('No available kline upstream');
  const json = await fetchJson(txUrl, signal, {
    referer: 'https://gu.qq.com/',
    'user-agent': 'Mozilla/5.0'
  });
  const parsed = parseTencentKline(json, period);
  if (!parsed || !parsed.items || !parsed.items.length) throw new Error('Empty kline response');
  return parsed;
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

export async function getKlineDataForMomentum(code, signal) {
  const result = await getCachedKline({ code, period: '1d', signal });
  return result.data;
}
