import {
  buildTencentUrl,
  buildEastmoneyUrl,
  buildEastmoneyTrendsUrl,
  buildSinaFutureUrl,
  splitCodes,
  fetchKline,
  fetchIntraday,
  parseEastmoneyTrends,
  EASTMONEY_FIELDS,
  onKlineUpdated
} from '../src/js/api.js';
import { klineCacheClear, setStorageAdapter } from '../src/js/storage.js';

function createMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  };
}

function jsonBufferResponse(body, status = 200) {
  const text = JSON.stringify(body);
  const buf = new TextEncoder().encode(text);
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => buf.buffer,
    json: async () => body
  };
}

QUnit.module('api.buildTencentUrl', () => {
  QUnit.test('single code', (t) => {
    t.equal(buildTencentUrl('sh600519'), '/api/tencent/q=sh600519');
  });
  QUnit.test('multiple codes joined with comma', (t) => {
    t.equal(
      buildTencentUrl(['sh600519', 'sz000001', 'bj830799']),
      '/api/tencent/q=sh600519,sz000001,bj830799'
    );
  });
  QUnit.test('filters invalid codes', (t) => {
    t.equal(
      buildTencentUrl(['sh600519', 'invalid', 'nf2105', 'sz000001']),
      '/api/tencent/q=sh600519,sz000001'
    );
  });
  QUnit.test('lowercases', (t) => {
    t.equal(buildTencentUrl('SH600519'), '/api/tencent/q=sh600519');
  });
  QUnit.test('null for empty', (t) => {
    t.equal(buildTencentUrl([]), null);
    t.equal(buildTencentUrl(['invalid']), null);
    t.equal(buildTencentUrl(null), null);
  });
});

QUnit.module('api.buildEastmoneyUrl', () => {
  QUnit.test('sh code maps to market 1', (t) => {
    const url = buildEastmoneyUrl('sh600519');
    t.ok(url.includes('secid=1.600519'), `got: ${url}`);
    t.ok(url.includes(EASTMONEY_FIELDS), 'includes fields');
  });
  QUnit.test('sz code maps to market 0', (t) => {
    const url = buildEastmoneyUrl('sz000001');
    t.ok(url.includes('secid=0.000001'), `got: ${url}`);
  });
  QUnit.test('bj code maps to market 0', (t) => {
    const url = buildEastmoneyUrl('bj830799');
    t.ok(url.includes('secid=0.830799'), `got: ${url}`);
  });
  QUnit.test('null for invalid code', (t) => {
    t.equal(buildEastmoneyUrl('invalid'), null);
    t.equal(buildEastmoneyUrl(''), null);
    t.equal(buildEastmoneyUrl('nf2105'), null);
  });
});

QUnit.module('api.buildEastmoneyTrendsUrl / parseEastmoneyTrends', () => {
  QUnit.test('buildEastmoneyTrendsUrl builds direct Eastmoney fallback URL', (t) => {
    const url = buildEastmoneyTrendsUrl('sh600519');
    t.ok(url.startsWith('/api/eastmoney-kline/qt/stock/trends2/get?'), url);
    t.ok(url.includes('secid=1.600519'), url);
    t.ok(url.includes('ndays=1'), url);
    t.ok(url.includes('fields2=f51,f52,f53,f54,f55,f56,f57,f58'), url);
  });

  QUnit.test('parseEastmoneyTrends maps rows and computes percent from preClose', (t) => {
    const out = parseEastmoneyTrends({
      data: {
        code: '600519',
        market: 1,
        name: '贵州茅台',
        preClose: 100,
        trends: [
          '2026-06-05 09:30,100,101,102,99,10,101000,100.5',
          '2026-06-05 09:31,101,102,103,100,20,204000,101.2'
        ]
      }
    }, { date: '2026-06-05' });
    t.equal(out.source, 'eastmoney-trends2');
    t.equal(out.code, 'sh600519');
    t.equal(out.items.length, 2);
    t.equal(out.items[1].close, 102);
    t.equal(Math.round(out.items[1].percent * 100) / 100, 2);
  });

  QUnit.test('parseEastmoneyTrends filters rows by selected date', (t) => {
    const out = parseEastmoneyTrends({
      data: {
        code: '600519',
        market: 1,
        name: '贵州茅台',
        preClose: 100,
        trends: [
          '2026-06-04 09:30,100,101,102,99,10,101000,100.5',
          '2026-06-05 09:30,100,102,102,99,10,102000,101'
        ]
      }
    }, { date: '2026-06-05' });
    t.equal(out.items.length, 1);
    t.equal(out.items[0].close, 102);
  });
});

QUnit.module('api.buildSinaFutureUrl', () => {
  QUnit.test('single future code', (t) => {
    t.equal(buildSinaFutureUrl('nf2105'), '/api/sina/list=nf2105');
  });
  QUnit.test('multiple futures', (t) => {
    t.equal(
      buildSinaFutureUrl(['nf2105', 'nfrb2410']),
      '/api/sina/list=nf2105,nfrb2410'
    );
  });
  QUnit.test('filters non-future codes', (t) => {
    t.equal(buildSinaFutureUrl(['sh600519', 'nf2105']), '/api/sina/list=nf2105');
  });
  QUnit.test('null for empty', (t) => {
    t.equal(buildSinaFutureUrl([]), null);
    t.equal(buildSinaFutureUrl(null), null);
  });
});

QUnit.module('api.splitCodes', () => {
  QUnit.test('separates stocks and futures', (t) => {
    const r = splitCodes(['sh600519', 'nf2105', 'sz000001', 'bj830799']);
    t.deepEqual(r.stocks, ['sh600519', 'sz000001', 'bj830799']);
    t.deepEqual(r.futures, ['nf2105']);
  });
  QUnit.test('ignores invalid codes', (t) => {
    const r = splitCodes(['garbage', '', null, 'sh600519']);
    t.deepEqual(r.stocks, ['sh600519']);
    t.deepEqual(r.futures, []);
  });
  QUnit.test('accepts single string', (t) => {
    t.deepEqual(splitCodes('sh600519').stocks, ['sh600519']);
  });
});

QUnit.module('api.fetchIntraday', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  QUnit.test('prefers AKTools stock_intraday_em when latest tick source is allowed', async (t) => {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(url);
      if (url.includes('stock_intraday_em')) {
        return jsonBufferResponse([
          { 时间: '09:15:00', 成交价: 10.00, 手数: 10 },
          { 时间: '09:30:00', 成交价: 10.20, 手数: 20 }
        ]);
      }
      throw new Error('unexpected fallback: ' + url);
    };

    const out = await fetchIntraday('sh600000', {
      date: '2026-06-05',
      prevClose: 10,
      allowLatestTickSource: true
    });

    t.equal(out.source, 'aktools-stock_intraday_em');
    t.equal(out.items.length, 2);
    t.equal(out.items[0].close, 10);
    t.equal(seen.length, 1, 'no fallback needed');
  });

  QUnit.test('skips latest-only tick source for historical selected dates', async (t) => {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(url);
      if (url.includes('stock_intraday_em')) {
        throw new Error('stock_intraday_em should be skipped');
      }
      if (url.includes('stock_zh_a_hist_min_em')) {
        return jsonBufferResponse([
          {
            时间: '2026-06-04 09:30:00',
            开盘: 10,
            收盘: 10.1,
            最高: 10.2,
            最低: 9.9,
            成交量: 100,
            成交额: 101000,
            均价: 10.1
          }
        ]);
      }
      throw new Error('unexpected URL: ' + url);
    };

    const out = await fetchIntraday('sh600000', {
      date: '2026-06-04',
      prevClose: 10,
      allowLatestTickSource: false
    });

    t.equal(out.source, 'aktools-stock_zh_a_hist_min_em');
    t.equal(out.items.length, 1);
    t.false(seen.some((u) => u.includes('stock_intraday_em')), 'latest tick endpoint skipped');
  });

  QUnit.test('falls back from AKTools tick to AKTools historical minute', async (t) => {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(url);
      if (url.includes('stock_intraday_em')) return jsonBufferResponse([], 500);
      if (url.includes('stock_zh_a_hist_min_em')) {
        return jsonBufferResponse([
          {
            时间: '2026-06-05 09:30:00',
            开盘: 10,
            收盘: 10.3,
            最高: 10.3,
            最低: 10,
            成交量: 100,
            成交额: 103000,
            均价: 10.3
          }
        ]);
      }
      throw new Error('unexpected URL: ' + url);
    };

    const out = await fetchIntraday('sh600000', {
      date: '2026-06-05',
      prevClose: 10,
      allowLatestTickSource: true
    });

    t.equal(out.source, 'aktools-stock_zh_a_hist_min_em');
    t.ok(seen.some((u) => u.includes('stock_intraday_em')), 'tried tick source');
    t.ok(seen.some((u) => u.includes('stock_zh_a_hist_min_em')), 'then tried AKTools minute source');
  });
});

QUnit.module('api.fetchKline', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  QUnit.test('returns null without calling fetch when code is invalid', async (t) => {
    let called = false;
    globalThis.fetch = () => {
      called = true;
      return Promise.reject(new Error('should not be called'));
    };
    const result = await fetchKline('invalid');
    t.equal(result, null);
    t.false(called);
  });

  QUnit.test('returns null without calling fetch when period is invalid', async (t) => {
    let called = false;
    globalThis.fetch = () => {
      called = true;
      return Promise.reject(new Error('should not be called'));
    };
    const result = await fetchKline('sh600519', { period: 'bogus' });
    t.equal(result, null);
    t.false(called);
  });

  QUnit.test('fetches and parses Eastmoney kline JSON', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = (url) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              code: '600519',
              market: 1,
              name: '贵州茅台',
              klines: [
                '2024-03-15,1808.00,1850.00,1860.00,1800.00,12500,2310000000,3.31,2.21,40.00,0.62'
              ]
            }
          })
      });
    };
    const out = await fetchKline('sh600519', { period: '1d' });
    t.ok(capturedUrl && capturedUrl.includes('secid=1.600519'));
    t.ok(capturedUrl.includes('klt=101'));
    t.equal(out.code, 'sh600519');
    t.equal(out.items.length, 1);
    t.equal(out.items[0].close, 1850.00);
  });

  QUnit.test('falls back to Tencent kline when Eastmoney returns HTTP 500', async (t) => {
    const seen = [];
    globalThis.fetch = (url) => {
      seen.push(url);
      if (url.includes('/api/eastmoney-kline')) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      if (url.includes('/api/qq-kline')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              code: 0,
              data: {
                sh600519: {
                  qfqday: [['2024-03-15', '1800', '1850', '1860', '1790', '50000']],
                  qt: { sh600519: ['1', '贵州茅台'] }
                }
              }
            })
        });
      }
      return Promise.reject(new Error('unexpected ' + url));
    };
    const out = await fetchKline('sh600519', { period: '1d' });
    t.ok(seen.some((u) => u.includes('/api/eastmoney-kline')), 'tried Eastmoney');
    t.ok(seen.some((u) => u.includes('/api/qq-kline')), 'tried Tencent');
    t.equal(out.code, 'sh600519');
    t.equal(out.items.length, 1);
    t.equal(out.items[0].close, 1850);
  });

  QUnit.test('falls back to Tencent when Eastmoney returns empty kline', async (t) => {
    const seen = [];
    globalThis.fetch = (url) => {
      seen.push(url);
      if (url.includes('/api/eastmoney-kline')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { code: '600519', market: 1, klines: [] } })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              sh600519: {
                qfqday: [['2024-03-15', '100', '105', '106', '99', '1000']],
                qt: { sh600519: ['1', 'X'] }
              }
            }
          })
      });
    };
    const out = await fetchKline('sh600519', { period: '1d' });
    t.equal(out.items.length, 1);
  });

  QUnit.test('throws when both Eastmoney and Tencent fail', async (t) => {
    globalThis.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    try {
      await fetchKline('sh600519', { period: '1d' });
      t.ok(false, 'should have thrown');
    } catch (e) {
      t.ok(/HTTP/.test(e.message) || /K 线/.test(e.message), `got: ${e.message}`);
    }
  });
});

// =====================================================================
// Phase 8: klineCache integration + in-flight dedup + SWR (api.fetchKline)
// =====================================================================
QUnit.module('api.fetchKline (Phase 8 cache + dedup + SWR)', (hooks) => {
  let originalFetch;
  let mock;
  hooks.beforeEach(() => {
    mock = createMockStorage();
    setStorageAdapter(mock);
    klineCacheClear();
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    klineCacheClear();
    setStorageAdapter(null);
  });

  function makeKlineResponse(n = 30) {
    return {
      data: {
        code: '600519',
        market: 1,
        name: '贵州茅台',
        klines: Array.from({ length: n }, (_, i) => {
          // kline.js _parseKlineTime requires YYYY-MM-DD or YYYY-MM-DD HH:MM
          const day = String((i % 28) + 1).padStart(2, '0');
          const month = String(Math.floor(i / 28) + 1).padStart(2, '0');
          return `2024-${month}-${day},100,101,102,99,1000,1000000,1,1.0,1.0,1.0`;
        })
      }
    };
  }

  QUnit.test('in-flight dedup: same code+period called concurrently → 1 fetch', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await new Promise(r => setTimeout(r, 50));
      return {
        ok: true,
        status: 200,
        json: async () => makeKlineResponse(30)
      };
    };
    const [a, b, c] = await Promise.all([
      fetchKline('sh600519', { period: '1d' }),
      fetchKline('sh600519', { period: '1d' }),
      fetchKline('sh600519', { period: '1d' })
    ]);
    t.equal(calls, 1, 'only 1 fetch was made');
    t.equal(a.items.length, 30);
    t.equal(b.items.length, 30);
    t.equal(c.items.length, 30);
  });

  QUnit.test('separate code+period maintain separate dedup slots', async (t) => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      if (url.includes('sh600519') && url.includes('klt=101')) {
        return { ok: true, status: 200, json: async () => makeKlineResponse(30) };
      }
      if (url.includes('sh600519') && url.includes('m5')) {
        return { ok: true, status: 200, json: async () => makeKlineResponse(60) };
      }
      if (url.includes('sz000001')) {
        return { ok: true, status: 200, json: async () => makeKlineResponse(40) };
      }
      return { ok: true, status: 200, json: async () => makeKlineResponse(30) };
    };
    await Promise.all([
      fetchKline('sh600519', { period: '1d' }),
      fetchKline('sh600519', { period: '1d' }),
      fetchKline('sh600519', { period: '5m' }),
      fetchKline('sz000001', { period: '1d' })
    ]);
    t.equal(calls, 3, '3 unique fetches (same code+period deduped)');
  });

  QUnit.test('cache hit: second call uses cache, no new fetch', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => makeKlineResponse(30) };
    };
    const a = await fetchKline('sh600519', { period: '1d' });
    const b = await fetchKline('sh600519', { period: '1d' });
    t.equal(calls, 1, 'only first call fetched');
    t.equal(a.items.length, b.items.length, 'same data from cache');
  });

  QUnit.test('noCache option: skips klineCache', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => makeKlineResponse(30) };
    };
    await fetchKline('sh600519', { period: '1d' });
    await fetchKline('sh600519', { period: '1d', noCache: true });
    t.equal(calls, 2, 'noCache forces a new fetch');
  });

  QUnit.test('SWR: cache hit triggers background revalidate', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => makeKlineResponse(30) };
    };
    // First call: cache miss → fetch + cache
    const first = await fetchKline('sh600519', { period: '1d' });
    t.equal(calls, 1);
    // Second call: cache hit → returns immediately + revalidates in background
    const startCalls = calls;
    const second = await fetchKline('sh600519', { period: '1d' });
    t.equal(calls, startCalls, 'second call did not block-fetch');
    t.equal(first.items.length, second.items.length, 'same data');
    // Wait for background revalidate
    await new Promise(r => setTimeout(r, 50));
    t.ok(calls > startCalls, `background revalidate happened: calls=${calls}`);
  });

  QUnit.test('onKlineUpdated fires when cache is updated', async (t) => {
    const events = [];
    const off = onKlineUpdated((code, period, data) => {
      events.push({ code, period, items: data.items.length });
    });
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => makeKlineResponse(45)
    });
    await fetchKline('sh600519', { period: '1d' });
    // emitKlineUpdated is called after cache write
    await new Promise(r => setTimeout(r, 30));
    t.ok(events.length >= 1, `events fired: ${events.length}`);
    t.equal(events[0].code, 'sh600519');
    t.equal(events[0].items, 45);
    off();
  });

  QUnit.test('onKlineUpdated unsubscribe stops further events', async (t) => {
    const events = [];
    const off = onKlineUpdated((code) => events.push(code));
    off();
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => makeKlineResponse(30) });
    await fetchKline('sh999999', { period: '1d' });
    await new Promise(r => setTimeout(r, 30));
    t.equal(events.length, 0, 'no events after unsubscribe');
  });
});
