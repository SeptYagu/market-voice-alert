import { resolveMomentumScanDates, mergeLiveQuoteIntoDailyKline, snapshotEvidenceDateKey } from '../server/momentumService.js';
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

    // Afternoon pool test: 15:10 Beijing (07:10 UTC)
    const afterCloseGeneratedAt = Date.parse('2026-09-08T07:10:00Z');
    assert.equal(
      isHistoricalLimitUpComplete(afterCloseGeneratedAt, dateKey, poolData),
      true,
      'post-close pool is complete'
    );

    // M4: Same-day 15:10 reasons are NOT complete because dragon-tiger list is published in the evening
    assert.equal(
      isHistoricalReasonsComplete(afterCloseGeneratedAt, dateKey, { reasons: [{ code: 'sh600000', reason: '测试' }] }),
      false,
      '15:10 same-day non-empty reasons are incomplete'
    );

    // M4: Same-day evening (20:35 Beijing = 12:35 UTC) reasons ARE complete
    const eveningGeneratedAt = Date.parse('2026-09-08T12:35:00Z');
    assert.equal(
      isHistoricalReasonsComplete(eveningGeneratedAt, dateKey, { reasons: [{ code: 'sh600000', reason: '测试' }] }),
      true,
      '20:35 same-day non-empty reasons are complete'
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

  QUnit.test('M1: Real quote sources without positive date evidence do not synthesize today bar', async assert => {
    const { parseAktoolsSpotList } = await import('../src/js/aktoolsApi.js');
    const { parseSinaSpot } = await import('../server/sinaSpotService.js');
    const { parseTencent } = await import('../src/js/parser.js');

    const history = {
      items: [
        { time: '2026-09-08', close: 18, open: 18, high: 19, low: 17, volume: 100 },
        { time: '2026-09-09', close: 19, open: 18, high: 20, low: 18, volume: 120 }
      ]
    };
    const liveDateKey = '20260910';

    // 1. aktools spot row: has no date evidence
    const aktoolsQuotes = parseAktoolsSpotList([
      { 代码: '600000', 名称: '浦发银行', 最新价: 20, 昨收: 19, 今开: 19.5, 成交量: 200, 成交额: 4000 }
    ]);
    assert.equal(aktoolsQuotes.length, 1);
    const afterAktools = mergeLiveQuoteIntoDailyKline(history, aktoolsQuotes[0], liveDateKey);
    assert.equal(afterAktools.items.length, 2, 'aktools candidate without date evidence is not synthesized');

    // 2. Sina spot row: only has HH:MM:SS, no date evidence
    const sinaQuote = parseSinaSpot({
      symbol: 'sh600000', name: '浦发银行', trade: '20', settlement: '19', open: '19.5',
      high: '20.2', low: '19.4', pricechange: '1', changepercent: '5.26', volume: 20000,
      amount: 400000, ticktime: '15:00:00'
    });
    const afterSina = mergeLiveQuoteIntoDailyKline(history, sinaQuote, liveDateKey);
    assert.equal(afterSina.items.length, 2, 'sina candidate with ticktime-only is not synthesized');

    // 3. Tencent quote dated yesterday: rejected
    const tencentTextYesterday = 'v_sh600000="1~浦发银行~sh600000~20.00~19.00~19.50~200~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260909150000~1.00~5.26~20.20~19.40~0/200/4000~"';
    const tencentYesterday = parseTencent(tencentTextYesterday);
    assert.equal(tencentYesterday.length, 1);
    const afterTencentYesterday = mergeLiveQuoteIntoDailyKline(history, tencentYesterday[0], liveDateKey);
    assert.equal(afterTencentYesterday.items.length, 2, 'tencent quote dated yesterday is not synthesized into today bar');

    // 4. Tencent quote dated today: accepted and synthesized
    const tencentTextToday = 'v_sh600000="1~浦发银行~sh600000~20.00~19.00~19.50~200~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260910150000~1.00~5.26~20.20~19.40~0/200/4000~"';
    const tencentToday = parseTencent(tencentTextToday);
    assert.equal(tencentToday.length, 1);
    const afterTencentToday = mergeLiveQuoteIntoDailyKline(history, tencentToday[0], liveDateKey);
    assert.equal(afterTencentToday.items.length, 3, 'tencent quote dated today is successfully synthesized');
    assert.equal(afterTencentToday.items.at(-1).time, '2026-09-10');
    assert.equal(afterTencentToday.items.at(-1).close, 20);

    // 5. The two leading sources cannot state a date themselves, so the scan hands
    //    over the snapshot's own provenance date. The live day then merges again.
    const akMerged = mergeLiveQuoteIntoDailyKline(history, aktoolsQuotes[0], liveDateKey, { snapshotDateKey: liveDateKey });
    assert.equal(akMerged.items.length, 3, 'aktools row merges when the snapshot proves the trading day');
    assert.equal(akMerged.items.at(-1).time, '2026-09-10');
    assert.equal(akMerged.items.at(-1).close, 20);

    const sinaMerged = mergeLiveQuoteIntoDailyKline(history, sinaQuote, liveDateKey, { snapshotDateKey: liveDateKey });
    assert.equal(sinaMerged.items.length, 3, 'sina row merges when the snapshot proves the trading day');

    // 6. R7 must stay fixed: a snapshot from another day, or no evidence at all,
    //    still refuses to manufacture a today bar.
    const otherDay = mergeLiveQuoteIntoDailyKline(history, aktoolsQuotes[0], liveDateKey, { snapshotDateKey: '20260909' });
    assert.equal(otherDay.items.length, 2, 'snapshot dated yesterday never synthesizes today');
    assert.strictEqual(
      mergeLiveQuoteIntoDailyKline(history, aktoolsQuotes[0], liveDateKey, { snapshotDateKey: '' }),
      history,
      'no provenance at all keeps the strict no-evidence-no-synthesis rule'
    );

    // 7. A seconds timestamp must not be mistaken for a date and silently block the merge
    const garbage = mergeLiveQuoteIntoDailyKline(history, { ...aktoolsQuotes[0], time: 1789000000 },
      liveDateKey, { snapshotDateKey: liveDateKey });
    assert.equal(garbage.items.length, 3, 'unparseable quote time falls back to the snapshot evidence');
  });

  QUnit.test('M1: snapshot provenance is evidence only for a fresh snapshot on the live day', assert => {
    const live = '20260910';
    const freshToday = { stale: false, generatedAt: Date.parse('2026-09-10T02:00:00Z') }; // 10:00 Beijing
    const freshOtherDay = { stale: false, generatedAt: Date.parse('2026-09-09T02:00:00Z') };
    const staleSnapshot = { stale: true, generatedAt: Date.parse('2026-09-10T02:00:00Z') };

    assert.equal(snapshotEvidenceDateKey(freshToday, live), '20260910', 'fresh snapshot vouches for its own day');
    assert.equal(snapshotEvidenceDateKey(freshToday, ''), '', 'no live day means no merge at all');
    assert.equal(snapshotEvidenceDateKey(staleSnapshot, live), '', 'a stale snapshot can never vouch for a day');
    assert.equal(snapshotEvidenceDateKey({ stale: false }, live), '', 'a snapshot without a timestamp has no provenance');
    assert.equal(snapshotEvidenceDateKey(null, live), '');
    assert.equal(snapshotEvidenceDateKey(freshOtherDay, live), '20260909',
      'another day is reported as-is, which then fails the live-day match');
  });
});
