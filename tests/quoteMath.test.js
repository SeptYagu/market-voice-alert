import { computeVwap } from '../src/js/services/quoteMath.js';

QUnit.module('services.quoteMath', () => {
  QUnit.test('computeVwap returns 0 for non-positive or invalid inputs', (t) => {
    t.equal(computeVwap(0, 100, 10), 0);
    t.equal(computeVwap(100, 0, 10), 0);
    t.equal(computeVwap(100, 100, 0), 0);
    t.equal(computeVwap(-100, 100, 10), 0);
    t.equal(computeVwap(100, -100, 10), 0);
    t.equal(computeVwap(NaN, 100, 10), 0);
    t.equal(computeVwap(100, NaN, 10), 0);
    t.equal(computeVwap(100, 100, NaN), 0);
  });

  QUnit.test('computeVwap calculates standard ratio when within 0.1x to 10x range', (t) => {
    // 1000 shares for 10500 yuan -> 10.5 yuan/share, close is 10
    const vwap = computeVwap(10500, 1000, 10);
    t.equal(vwap, 10.5);
  });

  QUnit.test('computeVwap supports isLotUnit = true (1 lot = 100 shares)', (t) => {
    // 10 lots (1000 shares) for 10500 yuan -> 10.5 yuan/share
    const vwap = computeVwap(10500, 10, 10, true);
    t.equal(vwap, 10.5);
  });

  QUnit.test('computeVwap auto-detects 100x unit discrepancy when isLotUnit is false', (t) => {
    // If volume was passed in lots (10) but isLotUnit is false:
    // rawRatio = 10500 / 10 = 1050 (105x of price 10, out of range [1, 100])
    // but ratio / 100 = 10.5 (within [1, 100]) -> 10.5
    const vwap = computeVwap(10500, 10, 10, false);
    t.equal(vwap, 10.5);
  });

  QUnit.test('computeVwap returns 0 when price deviates beyond 0.1x to 10x', (t) => {
    // Price is 10, both ratio and ratio/100 deviate:
    // ratio is 0.05 (< 1.0) and ratio/100 is 0.0005 (< 1.0) -> 0
    t.equal(computeVwap(50, 1000, 10), 0);
    // ratio is 20000 (> 100) and ratio/100 is 200 (> 100) -> 0
    t.equal(computeVwap(20000000, 1000, 10), 0);
  });
});
