import QUnit from 'qunit';
import { rm } from 'node:fs/promises';
import { fetchSinaSpot, parseSinaSpot } from '../server/sinaSpotService.js';
import { getCachedSpotLatest } from '../server/spotService.js';
import { readCache, writeCache, cachePath } from '../server/cacheStore.js';

const row = index => ({ symbol: index === 0 ? 'bj920001' : `sh${600000 + index}`, name: 'Fixture',
  trade: '10.20', settlement: '10', pricechange: '0.2', changepercent: '2', open: '10', high: '11', low: '9',
  volume: 2000, amount: 20400, ticktime: '15:00:00' });

function mockMarket({ duplicate = false, short = false, changeCount = false, failPage = false } = {}) {
  let countCalls = 0;
  return async raw => {
    const url = new URL(raw);
    if (url.pathname.endsWith('/stock_zh_a_spot_em')) return new Response('Internal Server Error', { status: 500 });
    if (url.pathname.endsWith('getHQNodeStockCount')) return Response.json(String(changeCount && ++countCalls > 1 ? 82 : 81));
    if (!url.pathname.endsWith('getHQNodeData')) throw new Error(`Unexpected request: ${url.pathname}`);
    const page = Number(url.searchParams.get('page'));
    if (page === 2 && failPage) return new Response('unavailable', { status: 503 });
    const data = page === 1 ? Array.from({ length: 80 }, (_, i) => row(i)) : (short ? [] : [row(duplicate ? 0 : 80)]);
    return Response.json(data);
  };
}

QUnit.module('Sina full-market fallback', hooks => {
  let original;
  hooks.beforeEach(() => { original = globalThis.fetch; });
  hooks.afterEach(() => { globalThis.fetch = original; });
  QUnit.test('normalizes units and validates all pages, symbols, and market total', async assert => {
    globalThis.fetch = mockMarket();
    const result = await fetchSinaSpot();
    assert.strictEqual(result.count, 81);
    assert.true(result.universeComplete);
    assert.strictEqual(result.universeStats.receivedCount, 81);
    assert.strictEqual(result.items[0].code, 'bj920001');
    assert.strictEqual(result.items[0].volume, 20, 'shares converted to stock lots');
    assert.strictEqual(result.items[0].amount, 20400, 'amount stays in yuan');
    assert.throws(() => parseSinaSpot({ symbol: 'sh000001' }), /symbol/, 'index is not silently accepted as stock');
  });
  for (const mode of ['duplicate', 'short', 'changeCount', 'failPage']) {
    QUnit.test(`rejects incomplete snapshot: ${mode}`, async assert => {
      globalThis.fetch = mockMarket({ [mode]: true });
      await assert.rejects(fetchSinaSpot(), /Sina/);
    });
  }
  QUnit.test('AKTools HTTP 500 recovers through full Sina pagination in production spot service', async assert => {
    const parts = ['spot', 'latest.json'];
    const previous = await readCache(parts, { skipTouch: true });
    try {
      await rm(cachePath(...parts), { force: true });
      globalThis.fetch = mockMarket();
      const result = await getCachedSpotLatest();
      assert.strictEqual(result.source, 'network');
      assert.strictEqual(result.data.source, 'sina-full-market');
      assert.true(result.data.universeComplete);
      assert.strictEqual(result.data.count, 81);
      const cached = await readCache(parts);
      assert.strictEqual(cached.data.universeStats.seedCount, 81);
    } finally {
      if (previous) await writeCache(parts, previous, { skipPrune: true });
      else await rm(cachePath(...parts), { force: true });
    }
  });
  QUnit.test('caller abort does not start a market request', async assert => {
    const abort = new AbortController(); abort.abort();
    globalThis.fetch = async (_url, options) => { options.signal.throwIfAborted(); assert.ok(false); };
    await assert.rejects(fetchSinaSpot(abort.signal), /abort/i);
  });
});
