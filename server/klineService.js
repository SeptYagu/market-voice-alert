import { toEastmoneySecId } from '../src/js/parser.js';
import {
  buildTencentKlineUrl,
  buildTencentYearKlineUrl,
  parseEastmoneyKline,
  parseTencentKlineAssignment,
  parseTencentKline,
  periodToKlt
} from '../src/js/kline.js';
import { getOrRefresh, readCache } from './cacheStore.js';
import { beijingDateKey, fetchWithTimeout, normalizeCodeParam, normalizeDateKey, sanitizeSegment } from './utils.js';

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
let tencentModernDisabledUntil = 0;
let tencentLegacyDisabledUntil = 0;

async function waitForTencentSlot(kind) {
  const now = Date.now();
  const disabledUntil = kind === 'modern' ? tencentModernDisabledUntil : tencentLegacyDisabledUntil;
  if (now < disabledUntil) {
    throw new Error(`Tencent ${kind} kline temporarily blocked by WAF`);
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

async function fetchText(url, signal, headers = {}) {
  const res = await fetchWithTimeout(url, { signal, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export function getKlineTtlMs(period) {
  return MINUTE_PERIODS.has(period) ? MINUTE_KLINE_TTL_MS : LONG_KLINE_TTL_MS;
}

async function fetchKlineNetwork(code, period, signal) {
  const emUrl = buildEastmoneyKlineUrl(code, period);
  if (emUrl) {
    if (eastmoneyDisabledUntil > 0 && Date.now() >= eastmoneyDisabledUntil) {
      eastmoneyDisabledUntil = 0;
      eastmoneyFailures = 0;
    }
    if (eastmoneyFailures < EASTMONEY_FAILURE_LIMIT) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const json = await fetchJson(emUrl, signal, {
            referer: 'https://quote.eastmoney.com/',
            'user-agent': 'Mozilla/5.0'
          });
          const parsed = parseEastmoneyKline(json);
          if (parsed && parsed.items && parsed.items.length) {
            eastmoneyFailures = 0;
            eastmoneyDisabledUntil = 0;
            return { ...parsed, upstreamSource: 'eastmoney' };
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
  }

  if (period === '1d') {
    const currentYear = Number(beijingDateKey().slice(0, 4));
    const modernUrl = buildTencentYearKlineUrl(code, currentYear);
    let modernError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      await waitForTencentSlot('modern');
      try {
        const text = await fetchText(modernUrl, signal, {
          referer: 'https://gu.qq.com/',
          'user-agent': 'Mozilla/5.0'
        });
        const parsed = parseTencentKlineAssignment(text, period);
        if (!parsed || !parsed.items || !parsed.items.length) throw new Error('Empty Tencent modern kline response');
        if (parsed.items.length < 60) {
          try {
            const prevYearUrl = buildTencentYearKlineUrl(code, currentYear - 1);
            const prevText = await fetchText(prevYearUrl, signal, {
              referer: 'https://gu.qq.com/',
              'user-agent': 'Mozilla/5.0'
            });
            const prevParsed = parseTencentKlineAssignment(prevText, period);
            if (prevParsed && Array.isArray(prevParsed.items) && prevParsed.items.length) {
              const currentTimes = new Set(parsed.items.map((it) => it.time));
              const olderItems = prevParsed.items.filter((it) => !currentTimes.has(it.time));
              parsed.items = [...olderItems, ...parsed.items].sort((a, b) => (a.time < b.time ? -1 : 1));
            }
          } catch {
            // Keep current year items if previous year cannot be reached
          }
        }
        return { ...parsed, upstreamSource: 'tencent-modern' };
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        modernError = error;
      }
    }
    if (modernError && /HTTP 501/.test(modernError.message || '')) {
      tencentModernDisabledUntil = Math.max(tencentModernDisabledUntil, Date.now() + TENCENT_WAF_COOLDOWN_MS);
    }
  }

  const txUrl = toAbsoluteTencentUrl(buildTencentKlineUrl(code, { period }));
  if (!txUrl) throw new Error('No available kline upstream');
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForTencentSlot('legacy');
    try {
      const json = await fetchJson(txUrl, signal, {
        referer: 'https://gu.qq.com/',
        'user-agent': 'Mozilla/5.0'
      });
      const parsed = parseTencentKline(json, period);
      if (!parsed || !parsed.items || !parsed.items.length) throw new Error('Empty kline response');
      return { ...parsed, upstreamSource: 'tencent-legacy' };
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      lastError = error;
      if (/HTTP 501/.test(error && error.message || '')) {
        tencentLegacyDisabledUntil = Math.max(tencentLegacyDisabledUntil, Date.now() + TENCENT_WAF_COOLDOWN_MS);
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

export function hasMomentumKlineCoverage(data, targetDate, { allowNoTradeGap = false } = {}) {
  const targetKey = normalizeDateKey(targetDate);
  const items = data && Array.isArray(data.items) ? data.items : [];
  if (!targetKey) return items.length >= 11;
  const usable = items.filter((item) => {
    const itemKey = String(item && item.time || '').replace(/-/g, '').slice(0, 8);
    return itemKey && itemKey <= targetKey;
  });
  if (usable.length < 11) return false;
  if (allowNoTradeGap) return true;
  const lastKey = String(usable.at(-1) && usable.at(-1).time || '').replace(/-/g, '').slice(0, 8);
  return lastKey >= targetKey;
}

export async function getKlineDataForMomentum(code, signal, targetDate) {
  const normalizedCode = normalizeCodeParam(code);
  const parts = ['kline', normalizedCode, '1d.json'];
  const cached = await readCache(parts, { skipTouch: true });
  const authoritativeCache = !!(
    cached &&
    cached.data &&
    cached.data.upstreamSource &&
    Date.now() - Number(cached.generatedAt || 0) < LONG_KLINE_TTL_MS
  );
  if (cached && hasMomentumKlineCoverage(cached.data, targetDate, { allowNoTradeGap: authoritativeCache })) {
    return {
      data: cached.data,
      fresh: true,
      source: 'cache',
      upstreamError: '',
      upstreamSource: cached.data && cached.data.upstreamSource ? cached.data.upstreamSource : 'cache'
    };
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
    // A successful current upstream response can legitimately end before the
    // target date when an otherwise-listed stock was individually suspended.
    fresh: hasMomentumKlineCoverage(result.data, targetDate, {
      allowNoTradeGap: result.source === 'network'
    }),
    source: result.source,
    upstreamError: result.upstreamError || '',
    upstreamSource: result.data && result.data.upstreamSource
      ? result.data.upstreamSource
      : (result.source === 'stale' ? 'stale-cache' : 'cache')
  };
}

export const _internal = {
  getEastmoneyBreakerState: () => ({ failures: eastmoneyFailures, disabledUntil: eastmoneyDisabledUntil }),
  recordEastmoneyFailure: () => {
    eastmoneyFailures += 1;
    if (eastmoneyFailures >= EASTMONEY_FAILURE_LIMIT) {
      eastmoneyDisabledUntil = Date.now() + EASTMONEY_COOLDOWN_MS;
    }
  },
  resetEastmoneyBreaker: () => {
    eastmoneyFailures = 0;
    eastmoneyDisabledUntil = 0;
  }
};

