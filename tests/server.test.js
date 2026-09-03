import { rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import {
  cachePath,
  getInflightRefreshCount,
  getOrRefresh,
  readCache,
  writeCache
} from '../server/cacheStore.js';
import { createAppServer } from '../server/index.js';
import { getKlineTtlMs, hasMomentumKlineCoverage } from '../server/klineService.js';
import {
  computeTenDayMomentum,
  mergeLiveQuoteIntoDailyKline,
  resolveMomentumScanDates
} from '../server/momentumService.js';
import { resolveProxyTarget } from '../server/proxyRoutes.js';
import { isAStockCode } from '../server/marketData.js';
import { beijingDateKey, normalizeDateKey } from '../server/utils.js';
import { getAppVersionMetadata } from '../vite.config.js';

function requestJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

QUnit.module('server cache and production routing', (hooks) => {
  hooks.after(async () => {
    await rm(cachePath('test-runtime'), { recursive: true, force: true });
  });

  QUnit.test('cold concurrent cache requests share one upstream refresh', async (t) => {
    const key = `single-flight-${Date.now()}.json`;
    let calls = 0;
    const refresh = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { value: 42 };
    };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => getOrRefresh(['test-runtime', key], 1000, refresh, { skipPrune: true }))
    );
    t.equal(calls, 1, 'only one refresh reached the upstream function');
    t.ok(results.every((result) => result.data.value === 42));
    t.equal(getInflightRefreshCount(), 0, 'in-flight entry is cleaned up');
  });

  QUnit.test('serialized progress-style writes can repeatedly replace one cache file', async (t) => {
    const parts = ['test-runtime', `replace-${Date.now()}.json`];
    for (let value = 0; value < 20; value++) {
      await writeCache(parts, { data: { value } }, { skipPrune: true });
    }
    const final = await readCache(parts, { skipTouch: true });
    t.equal(final.data.value, 19);
  });

  QUnit.test('K-line TTL is period-aware', (t) => {
    t.equal(getKlineTtlMs('1m'), 2 * 60 * 1000);
    t.equal(getKlineTtlMs('60m'), 2 * 60 * 1000);
    t.equal(getKlineTtlMs('1d'), 60 * 60 * 1000);
  });

  QUnit.test('momentum history accepts an authoritative suspension gap but rejects stale gaps', (t) => {
    const data = {
      items: Array.from({ length: 11 }, (_, index) => ({
        time: `2026-08-${String(18 + index).padStart(2, '0')}`,
        close: 10 + index
      }))
    };
    t.false(hasMomentumKlineCoverage(data, '20260902'));
    t.true(hasMomentumKlineCoverage(data, '20260902', { allowNoTradeGap: true }));
    t.false(hasMomentumKlineCoverage({ items: data.items.slice(0, 10) }, '20260902', { allowNoTradeGap: true }));
  });

  QUnit.test('10-day momentum ignores bars after the requested scan date', (t) => {
    const items = Array.from({ length: 13 }, (_, index) => ({
      time: `2026-09-${String(index + 1).padStart(2, '0')}`,
      close: 100 + index
    }));
    const result = computeTenDayMomentum({ items }, 10, '2026-09-11');
    t.equal(result.startTime, '2026-09-01');
    t.equal(result.endTime, '2026-09-11');
    t.equal(result.endDateKey, '20260911');
  });

  QUnit.test('10-day momentum rejects a stale series with too few bars by the scan date', (t) => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      time: `2014-11-${String(index + 1).padStart(2, '0')}`,
      close: 10 + index
    }));
    items.push({ time: '2026-09-03', close: 100 });
    t.strictEqual(computeTenDayMomentum({ items }, 10, '2026-09-02'), null);
  });

  QUnit.test('live trading-day scan refreshes history through prior close and synthesizes today', (t) => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03'];
    t.deepEqual(
      resolveMomentumScanDates('20260903', dates, '20260903', new Date('2026-09-03T04:00:00Z')),
      { marketDate: '20260903', historyTargetDate: '20260902', liveDate: '20260903' }
    );
    t.deepEqual(
      resolveMomentumScanDates('20260902', dates, '20260903'),
      { marketDate: '20260902', historyTargetDate: '20260902', liveDate: '' }
    );
    t.deepEqual(
      resolveMomentumScanDates('20260903', dates, '20260903', new Date('2026-09-03T07:05:00Z')),
      { marketDate: '20260903', historyTargetDate: '20260903', liveDate: '' },
      'after 15:05 Beijing uses the official closing bar'
    );
  });

  QUnit.test('A-share universe filter excludes indexes, ETFs and convertible bonds', (t) => {
    for (const code of ['sh600519', 'sh688981', 'sz000001', 'sz301591', 'sz302132', 'bj920001', 'bj830799']) {
      t.true(isAStockCode(code), code);
    }
    for (const code of ['sh000001', 'sz399001', 'sh510300', 'sz159919', 'bj810011']) {
      t.false(isAStockCode(code), code);
    }
  });

  QUnit.test('live quote creates or replaces the unfinished daily bar', (t) => {
    const base = { code: 'sh603533', items: [{ time: '2026-09-02', open: 25, close: 24.15, high: 26, low: 24 }] };
    const quote = { price: 23.43, open: 24.44, high: 24.58, low: 23.20, volume: 517381, amount: 123456, changePercent: -2.98 };
    const appended = mergeLiveQuoteIntoDailyKline(base, quote, '20260903');
    t.equal(appended.items.length, 2);
    t.deepEqual(appended.items[1], {
      time: '2026-09-03', open: 24.44, close: 23.43, high: 24.58, low: 23.2,
      volume: 517381, amount: 123456, changePercent: -2.98
    });
    const replaced = mergeLiveQuoteIntoDailyKline(appended, { ...quote, price: 23.88 }, '20260903');
    t.equal(replaced.items.length, 2);
    t.equal(replaced.items[1].close, 23.88);
    t.strictEqual(mergeLiveQuoteIntoDailyKline(base, { price: 24, open: 0, volume: 0 }, '20260903'), base);
  });

  QUnit.test('default server dates use Beijing calendar date', (t) => {
    const instant = new Date('2026-06-01T16:30:00.000Z');
    t.equal(beijingDateKey(instant), '20260602');
    t.equal(normalizeDateKey(null, instant), '20260602');
  });

  QUnit.test('production proxy resolver preserves path and query', (t) => {
    const target = resolveProxyTarget('/api/tencent/q=sh600519', '?foo=bar');
    t.equal(target.url, 'https://qt.gtimg.cn/q=sh600519?foo=bar');
    const aktools = resolveProxyTarget(
      '/api/aktools/api/public/stock_zt_pool_em',
      '?date=20260605',
      { AKTOOLS_BASE: 'http://127.0.0.1:9999' }
    );
    t.equal(aktools.url, 'http://127.0.0.1:9999/api/public/stock_zt_pool_em?date=20260605');
  });

  QUnit.test('app version metadata supports deterministic build overrides', (t) => {
    t.deepEqual(
      getAppVersionMetadata({ APP_VERSION: 'abc1234', APP_UPDATED_DATE: '2026-09-01' }),
      { version: 'abc1234', updated: '2026-09-01' }
    );
  });

  QUnit.test('unknown production API returns JSON 404 instead of index.html', async (t) => {
    const server = createAppServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const response = await requestJson(address.port, '/api/not-a-real-route');
      t.equal(response.status, 404);
      t.strictEqual(response.body.ok, false);
      t.equal(response.body.error, 'Not found');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
