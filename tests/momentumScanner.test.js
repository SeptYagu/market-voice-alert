import {
  mergePinnedMomentumItems,
  scanMomentumCandidate,
  MOMENTUM_SCAN_CONCURRENCY
} from '../src/js/services/momentumScanner.js';

QUnit.module('services.momentumScanner', () => {
  QUnit.test('exports expected constants', (t) => {
    t.equal(typeof MOMENTUM_SCAN_CONCURRENCY, 'number');
    t.true(MOMENTUM_SCAN_CONCURRENCY > 0);
  });

  QUnit.test('mergePinnedMomentumItems retains pinned codes when missing in new items', (t) => {
    const pinnedCodes = new Set(['sh600519']);
    const existing = [
      { code: 'sh600519', name: '贵州茅台', gainPercent: 50, amount: 1000 }
    ];
    const incoming = [
      { code: 'sz000001', name: '平安银行', gainPercent: 46, amount: 2000 }
    ];

    const merged = mergePinnedMomentumItems(incoming, pinnedCodes, existing);
    t.equal(merged.length, 2);
    // Pinned should be first
    t.equal(merged[0].code, 'sh600519');
    t.true(merged[0].pinnedOnly);
    t.equal(merged[1].code, 'sz000001');
  });

  QUnit.test('scanMomentumCandidate filters invalid candidate codes', async (t) => {
    const r1 = await scanMomentumCandidate(null);
    t.equal(r1, null);

    const r2 = await scanMomentumCandidate({ code: 'invalid' });
    t.equal(r2, null);
  });

  QUnit.test('mergePinnedMomentumItems sorts by pinned then gainPercent descending', (t) => {
    const pinnedCodes = new Set(['sz000002']);
    const incoming = [
      { code: 'sh600000', gainPercent: 80, amount: 100 },
      { code: 'sz000002', gainPercent: 46, amount: 100 },
      { code: 'sh600519', gainPercent: 90, amount: 200 }
    ];

    const merged = mergePinnedMomentumItems(incoming, pinnedCodes, []);
    t.equal(merged[0].code, 'sz000002', 'pinned item is top');
    t.equal(merged[1].code, 'sh600519', 'highest gain is second');
    t.equal(merged[2].code, 'sh600000', 'second highest gain is third');
  });
});
