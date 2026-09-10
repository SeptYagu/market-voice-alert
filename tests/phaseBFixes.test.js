import { resolveMomentumScanDates, mergeLiveQuoteIntoDailyKline } from '../server/momentumService.js';
import { computeTenDayMomentum } from '../src/js/services/momentumMath.js';
import { isHistoricalLimitUpComplete, isHistoricalReasonsComplete, getCachedLimitUp } from '../server/limitUpService.js';
import { writeCache } from '../server/cacheStore.js';

QUnit.module('Phase B Defect Fixes (R7, R5)', () => {
  QUnit.test('R7: Pre-open 08:00 does not synthesize yesterday quote into today bar', assert => {
    const dates = [
      '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01',
      '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'
    ];
    // 00:00:00 UTC = 08:00:00 Beijing
    const plan = resolveMomentumScanDates('20260910', dates, '20260910', new Date('2026-09-10T00:00:00Z'));
    assert.equal(plan.liveDate, '', 'liveDate is empty pre-open');
    assert.equal(plan.marketDate, '20260909', 'marketDate is prior close pre-open');
    assert.equal(plan.historyTargetDate, '20260909');

    const history = { items: dates.slice(0, -1).map((time, i) => ({ time, close: 10 + i })) };
    const merged = mergeLiveQuoteIntoDailyKline(
      history,
      { price: 20, open: 19, volume: 100, time: '2026-09-09 15:00:00' },
      plan.liveDate
    );
    assert.equal(merged.items.at(-1).time, '2026-09-09', 'yesterday is not duplicated into today');
    assert.equal(computeTenDayMomentum(history).gainPercent, 100);
    assert.equal(computeTenDayMomentum(merged).gainPercent, 100, 'ten-day gain window remains accurate');
  });

  QUnit.test('R5: Historical morning-only pool and empty reasons are treated as incomplete', async assert => {
    const dateKey = '20260908';
    const morningGeneratedAt = Date.parse('2026-09-08T02:00:00Z'); // 10:00 AM Beijing

    const poolData = { limitUpItems: [{ code: 'sh600000' }], brokenItems: [], items: [{ code: 'sh600000' }] };
    const reasonsData = { reasons: [] };

    assert.equal(
      isHistoricalLimitUpComplete(morningGeneratedAt, dateKey, poolData),
      false,
      'morning pool is incomplete for historical date'
    );
    assert.equal(
      isHistoricalReasonsComplete(morningGeneratedAt, dateKey, reasonsData),
      false,
      'empty reasons are incomplete for historical date'
    );

    // Complete afternoon pool test: 15:10 Beijing (07:10 UTC)
    const afterCloseGeneratedAt = Date.parse('2026-09-08T07:10:00Z');
    assert.equal(
      isHistoricalLimitUpComplete(afterCloseGeneratedAt, dateKey, poolData),
      true,
      'post-close pool is complete'
    );

    // Write incomplete morning cache into cacheStore and verify getCachedLimitUp calls network
    let networkCalls = 0;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        networkCalls++;
        throw new Error('upstream offline');
      };
      await writeCache(['limit-up', dateKey, 'merged.json'], {
        generatedAt: morningGeneratedAt,
        data: poolData
      }, { skipPrune: true });
      await writeCache(['limit-up', dateKey, 'reasons.json'], {
        generatedAt: morningGeneratedAt,
        data: reasonsData
      }, { skipPrune: true });

      // Because historical morning cache is incomplete, getCachedLimitUp attempts refresh
      const pool = await getCachedLimitUp({ date: dateKey });
      assert.ok(networkCalls > 0, 'network was attempted for incomplete historical cache');
      assert.equal(pool.stale, true, 'fell back to stale copy when upstream failed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
