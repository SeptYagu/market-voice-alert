import {
  computeTenDayMomentum,
  isMomentumEligible,
  sortMomentumItems,
  getMomentumReasonText,
  klineDateKey,
  normalizeDateKey,
  MOMENTUM_LOOKBACK_TRADING_DAYS,
  MOMENTUM_THRESHOLD_PCT
} from '../src/js/services/momentumMath.js';

QUnit.module('services.momentumMath', () => {
  QUnit.test('exports expected constants', (t) => {
    t.equal(MOMENTUM_LOOKBACK_TRADING_DAYS, 10);
    t.equal(MOMENTUM_THRESHOLD_PCT, 45);
  });

  QUnit.test('normalizeDateKey parses various date formats', (t) => {
    t.equal(normalizeDateKey('20260905'), '20260905');
    t.equal(normalizeDateKey('2026-09-05'), '20260905');
    t.equal(normalizeDateKey(''), '');
    t.equal(normalizeDateKey(null), '');
  });

  QUnit.test('klineDateKey parses strings and timestamps', (t) => {
    t.equal(klineDateKey('2026-09-05'), '20260905');
    t.equal(klineDateKey('20260905'), '20260905');
    // UTC 2026-09-05 00:00:00 -> 1788566400
    const sec = Math.floor(Date.UTC(2026, 8, 5, 0, 0, 0) / 1000);
    t.equal(klineDateKey(sec), '20260905');
  });

  QUnit.test('computeTenDayMomentum requires at least lookbackDays + 1 bars (rejects new IPOs)', (t) => {
    const fewBars = Array.from({ length: 10 }, (_, i) => ({
      time: `2026-08-${String(i + 1).padStart(2, '0')}`,
      close: 10 + i
    }));
    t.strictEqual(computeTenDayMomentum({ items: fewBars }), null, '10 bars is not enough for 10-day lookback');

    const exactBars = Array.from({ length: 11 }, (_, i) => ({
      time: `2026-08-${String(i + 1).padStart(2, '0')}`,
      close: 10 + i
    }));
    const res = computeTenDayMomentum({ items: exactBars });
    t.ok(res, '11 bars is sufficient');
    t.equal(res.lookbackDays, 10);
    t.equal(res.startClose, 10);
    t.equal(res.lastClose, 20);
    t.equal(res.gainPercent, 100);
    t.equal(res.startDate, '2026-08-01');
    t.equal(res.endDate, '2026-08-11');
    t.equal(res.endDateKey, '20260811');
  });

  QUnit.test('computeTenDayMomentum filters by cutoffDate correctly', (t) => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      time: `2026-08-${String(i + 1).padStart(2, '0')}`,
      close: 10 + i
    }));
    // cutoff at 2026-08-11 has 11 bars (idx 0 to 10)
    const res = computeTenDayMomentum({ items }, 10, '2026-08-11');
    t.ok(res);
    t.equal(res.endDate, '2026-08-11');
    t.equal(res.lastClose, 20);

    // cutoff at 2026-08-10 has only 10 bars -> should return null
    t.strictEqual(computeTenDayMomentum({ items }, 10, '2026-08-10'), null);
  });

  QUnit.test('computeTenDayMomentum rejects non-positive or invalid close prices', (t) => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      time: `2026-08-${String(i + 1).padStart(2, '0')}`,
      close: 10 + i
    }));
    items[0].close = 0;
    t.strictEqual(computeTenDayMomentum({ items }), null);

    items[0].close = -5;
    t.strictEqual(computeTenDayMomentum({ items }), null);

    items[0].close = 'abc';
    t.strictEqual(computeTenDayMomentum({ items }), null);
  });

  QUnit.test('sortMomentumItems prioritizes pinned codes, then gainPercent, then amount', (t) => {
    const pinned = new Set(['sh600001']);
    const list = [
      { code: 'sz000002', gainPercent: 50, amount: 200 },
      { code: 'sz000001', gainPercent: 80, amount: 100 },
      { code: 'sh600001', gainPercent: 10, amount: 50 },
      { code: 'sz000003', gainPercent: 50, amount: 500 }
    ];
    const sorted = sortMomentumItems(list, pinned);
    t.equal(sorted[0].code, 'sh600001', 'pinned is first');
    t.equal(sorted[1].code, 'sz000001', 'highest gain is second');
    t.equal(sorted[2].code, 'sz000003', 'higher amount is third when gain is equal');
    t.equal(sorted[3].code, 'sz000002', 'lower amount is fourth');
  });

  QUnit.test('getMomentumReasonText formats reason, stats, anomaly or gain fallback', (t) => {
    t.equal(getMomentumReasonText(null), '-');
    t.equal(getMomentumReasonText({ reason: '新能源车概念' }), '新能源车概念');
    t.equal(getMomentumReasonText({ limitStats: '5天3板' }), '5天3板');
    t.equal(getMomentumReasonText({ anomaly: '异动' }), '异动');
    t.equal(getMomentumReasonText({ gainPercent: 52.34 }), '10日涨幅+52.34%');
    t.equal(
      getMomentumReasonText({ maxGainPercent: 50.0, gainPercent: 35.0, pullbackPercent: -10.0 }),
      '10日触及+50.00%(回踩-10.00%)'
    );
  });

  QUnit.test('computeTenDayMomentum computes peak touch (maxHigh), pullback and amplitude', (t) => {
    // 11 bars: index 0 (10 days ago close = 10.00)
    // bar 5 touches high 15.00 (+50%)
    // bar 10 finishes at close 13.50 (+35%)
    // lowest price in interval is 9.50
    const items = Array.from({ length: 11 }, (_, i) => ({
      time: `2026-08-${String(i + 1).padStart(2, '0')}`,
      open: 10 + i * 0.3,
      close: i === 0 ? 10.0 : (i === 10 ? 13.5 : 10 + i * 0.4),
      high: i === 5 ? 15.0 : 10 + i * 0.5,
      low: i === 2 ? 9.5 : 10
    }));

    const res = computeTenDayMomentum({ items });
    t.ok(res, 'computed stats');
    t.equal(res.startClose, 10.0);
    t.equal(res.lastClose, 13.5);
    t.equal(res.gainPercent, 35.0, 'current close gain is 35%');
    t.equal(res.maxHigh, 15.0, 'max high is 15.0');
    t.equal(res.maxGainPercent, 50.0, 'peak touch gain is 50%');
    t.equal(res.pullbackPercent, -10.0, 'pullback from peak is -10%');
    t.equal(res.amplitudePercent, 55.0, 'amplitude is (15 - 9.5) / 10 = 55%');
    t.equal(res.maxHighDate, '2026-08-06', 'max high date matched bar 5');
  });

  QUnit.test('isMomentumEligible accepts stocks touching >= 45% with positive net gain', (t) => {
    // Touched 48%, current gain 32% -> should be eligible
    t.true(isMomentumEligible({ maxGainPercent: 48, gainPercent: 32 }, 45));

    // Current gain >= 45% (at peak) -> eligible
    t.true(isMomentumEligible({ maxGainPercent: 46, gainPercent: 46 }, 45));

    // Touched only 40%, current gain 30% -> not eligible
    t.false(isMomentumEligible({ maxGainPercent: 40, gainPercent: 30 }, 45));

    // Touched 50% early, but plummeted below start price (gainPercent <= 0) -> not eligible
    t.false(isMomentumEligible({ maxGainPercent: 50, gainPercent: -5 }, 45));
    t.false(isMomentumEligible({ maxGainPercent: 50, gainPercent: 0 }, 45));

    // Null/empty input
    t.false(isMomentumEligible(null, 45));
  });

  QUnit.test('sortMomentumItems prioritizes maxGainPercent then gainPercent', (t) => {
    const list = [
      { code: 'sz000001', maxGainPercent: 48, gainPercent: 30, amount: 100 },
      { code: 'sz000002', maxGainPercent: 55, gainPercent: 20, amount: 200 },
      { code: 'sz000003', maxGainPercent: 48, gainPercent: 35, amount: 300 }
    ];
    const sorted = sortMomentumItems(list);
    // Highest peak touch first: sz000002 (55%)
    t.equal(sorted[0].code, 'sz000002');
    // For same maxGainPercent (48%), higher gainPercent (35%) wins
    t.equal(sorted[1].code, 'sz000003');
    t.equal(sorted[2].code, 'sz000001');
  });
});
