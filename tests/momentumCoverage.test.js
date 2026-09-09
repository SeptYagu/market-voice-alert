import QUnit from 'qunit';
import { rm } from 'node:fs/promises';
import { cachePath, readCache, writeCache } from '../server/cacheStore.js';
import { getCachedTenDayMomentum, startTenDayMomentumScan } from '../server/momentumService.js';

QUnit.module('Momentum market coverage');
QUnit.test('legacy cached subset is returned as partial without rescanning or mutating disk', async assert => {
  const parts = ['momentum', '20260907', 'ten-day-46pct.json'];
  const data = { status: 'complete', spotSource: 'tencent-batch-quotes', universeSize: 33, items: [{ code: 'sh600519' }] };
  await writeCache(parts, { data }, { skipPrune: true });
  const result = await getCachedTenDayMomentum({ date: '20260907', threshold: 46 });
  assert.strictEqual(result.data.status, 'partial');
  assert.false(result.data.universeComplete);
  assert.true(result.data.message.includes('33 只股票'));
  assert.deepEqual(result.data.items, data.items, 'valid partial results retained');
  assert.strictEqual((await readCache(parts)).data.status, 'complete', 'read-only correction of legacy file');
});

QUnit.test('actual scan cannot report whole-market completion when every cached candidate succeeds', async assert => {
  const spot = ['spot', 'latest.json'];
  const calendar = ['calendar', 'trade-dates.json'];
  const kline = ['kline', 'sh600519', '1d.json'];
  const backups = await Promise.all([spot, calendar, kline].map(parts => readCache(parts, { skipTouch: true })));
  try {
    await writeCache(calendar, { data: { dates: ['2026-09-01'] } }, { skipPrune: true });
    await writeCache(kline, { data: { code: 'sh600519', items: Array.from({ length: 11 }, (_, i) => ({
      time: i === 10 ? '2026-09-01' : `2026-08-${String(18 + i).padStart(2, '0')}`, close: 10 + i
    })) } }, { skipPrune: true });
    const data = { source: 'tencent-batch-quotes', universeComplete: false, universeSource: 'local-cache-seeds',
      universeStats: { missingCount: 0, failedBatches: [] }, items: [{ code: 'sh600519', price: 20 }] };
    await writeCache(spot, { data }, { skipPrune: true });
    const limited = await startTenDayMomentumScan({ date: '20260901', threshold: 47 });
    assert.strictEqual(limited.scanned, 1);
    assert.strictEqual(limited.refreshFailures, 0);
    assert.strictEqual(limited.universeRefreshFailures, 0);
    assert.strictEqual(limited.status, 'partial', 'zero request failures does not imply full universe');
    assert.strictEqual(limited.items.length, 1);
    assert.strictEqual(await readCache(['momentum', '20260901', 'ten-day-47pct-success.json']), null);
    await writeCache(spot, { data: { ...data, source: 'aktools-stock_zh_a_spot_em', universeComplete: true, universeSource: 'full-market-snapshot' } }, { skipPrune: true });
    const full = await startTenDayMomentumScan({ date: '20260901', threshold: 48 });
    assert.strictEqual(full.status, 'complete', 'authoritative full snapshot may complete');
    assert.ok(await readCache(['momentum', '20260901', 'ten-day-48pct-success.json']));
    await writeCache(spot, { data: { ...data, source: 'aktools-stock_zh_a_spot_em', universeComplete: true,
      universeStats: { missingCount: 2, failedBatches: [{ count: 1 }] } } }, { skipPrune: true });
    const missing = await startTenDayMomentumScan({ date: '20260901', threshold: 49 });
    assert.strictEqual(missing.universeRefreshFailures, 2, 'missing quotes counted without double counting failed batches');
    assert.strictEqual(missing.status, 'partial');
  } finally {
    for (const [index, parts] of [spot, calendar, kline].entries()) {
      if (backups[index]) await writeCache(parts, backups[index], { skipPrune: true });
      else await rm(cachePath(...parts), { force: true });
    }
  }
});
