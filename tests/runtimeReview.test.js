import { request } from 'node:http';
import { writeCache } from '../server/cacheStore.js';
import { getCachedIntraday } from '../server/intradayService.js';
import { createAppServer } from '../server/index.js';
import { resolveStockChartDate } from '../src/js/tradeCalendar.js';
import { parseBeijingDateTimeToChartSeconds } from '../src/js/time.js';

QUnit.module('runtime review regressions', hooks => {
  let original;
  hooks.beforeEach(() => { original = globalThis.fetch; });
  hooks.afterEach(() => { globalThis.fetch = original; });

  QUnit.test('modern WAF cooldown still permits legacy for the next stock', async assert => {
    const { getCachedKline } = await import('../server/klineService.js?runtime-review');
    const legacy = [];
    globalThis.fetch = async raw => {
      const url = new URL(raw);
      if (url.hostname.includes('eastmoney')) throw new Error('connection reset');
      if (url.pathname.includes('newfqkline')) return new Response('', { status: 501 });
      const code = url.searchParams.get('param').split(',')[0];
      legacy.push(code);
      return Response.json({ code: 0, data: { [code]: { day: [['2026-09-08', '10', '11', '12', '9', '100']] } } });
    };
    for (const code of ['sh603981', 'sh603982']) {
      assert.equal((await getCachedKline({ code, period: '1d' })).data.upstreamSource, 'tencent-legacy');
    }
    assert.deepEqual(legacy, ['sh603981', 'sh603982']);
  });

  QUnit.test('morning minute fallback stays stale and later recovers a closing archive', async assert => {
    const code = 'sh603983';
    globalThis.fetch = async () => { throw new Error('upstream offline'); };
    const morning = { time: parseBeijingDateTimeToChartSeconds('2026-09-08 10:30'), close: 10, volume: 100 };
    const minuteKey = ['kline', code, '1m.json'];
    const archiveKey = ['intraday', code, '20260908-0p0000.json'];
    await writeCache(minuteKey, { generatedAt: Date.parse('2026-09-08T02:30:00Z'), data: { items: [morning] } });
    const partial = await getCachedIntraday({ code, date: '20260908' });
    assert.true(partial.stale, 'old minute data is explicitly stale');
    assert.false(partial.data.archiveComplete, 'new cache write is not a complete archive');
    assert.equal(partial.data.items.length, 1, 'partial data remains available');
    // Expire the short-lived partial response, then make a complete minute source available.
    await writeCache(archiveKey, { generatedAt: 1, data: partial.data });
    await writeCache(minuteKey, { generatedAt: Date.parse('2026-09-08T07:10:00Z'), data: {
      items: [morning, { ...morning, time: parseBeijingDateTimeToChartSeconds('2026-09-08 15:00') }]
    } });
    const complete = await getCachedIntraday({ code, date: '20260908' });
    assert.false(complete.stale);
    assert.equal(complete.data.items.length, 2, 'closing point is recovered');
    const archived = await getCachedIntraday({ code, date: '20260908' });
    assert.equal(archived.source, 'cache');
  });

  QUnit.test('legacy morning archive with recent write time is refreshed', async assert => {
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('offline'); };
    const code = 'sh603984';
    await writeCache(['intraday', code, '20260908-0p0000.json'], { generatedAt: Date.now() - 20000,
      data: { items: [{ time: parseBeijingDateTimeToChartSeconds('2026-09-08 10:30'), close: 10 }] } });
    const result = await getCachedIntraday({ code, date: '20260908' });
    assert.ok(requests > 0, 'legacy archive is no longer frozen');
    assert.true(result.stale, 'failed recovery preserves stale history');
  });

  QUnit.test('stock chart uses previous trading day before auction and current day at auction', assert => {
    const dates = ['2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09'];
    assert.equal(resolveStockChartDate(dates, new Date('2026-09-09T01:14:59Z')), '2026-09-08');
    assert.equal(resolveStockChartDate(dates, new Date('2026-09-09T01:15:00Z')), '2026-09-09');
    assert.equal(resolveStockChartDate(dates, new Date('2026-09-06T22:00:00Z')), '2026-09-04');
    assert.equal(resolveStockChartDate(dates, new Date('2026-09-06T04:00:00Z')), '2026-09-04');
  });

  QUnit.test('deployment hostname passes host guard, foreign origins and hosts remain blocked', async assert => {
    const previous = process.env.MOMENTUM_SCAN_ALLOWED_HOSTS;
    delete process.env.MOMENTUM_SCAN_ALLOWED_HOSTS;
    const server = createAppServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const status = (host, origin) => new Promise((resolve, reject) => {
      // Invalid date prevents starting any real scan after the origin guard.
      const req = request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST',
        path: '/api/cache/momentum/ten-day/scan?date=invalid', headers: { host, origin } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      }); req.on('error', reject); req.end();
    });
    try {
      assert.equal(await status('market.yagu.ddns-ip.net', 'https://market.yagu.ddns-ip.net'), 400);
      assert.equal(await status('market.yagu.ddns-ip.net', 'https://evil.example'), 403);
      assert.equal(await status('evil.example', 'https://evil.example'), 403);
      process.env.MOMENTUM_SCAN_ALLOWED_HOSTS = '';
      assert.equal(await status('market.yagu.ddns-ip.net', 'https://market.yagu.ddns-ip.net'), 403, 'explicit empty override disables default');
    } finally {
      if (previous === undefined) delete process.env.MOMENTUM_SCAN_ALLOWED_HOSTS;
      else process.env.MOMENTUM_SCAN_ALLOWED_HOSTS = previous;
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
