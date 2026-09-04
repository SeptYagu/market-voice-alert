import {
  parseTradeCalendar,
  resolveLatestTradingDate,
  shiftTradingDate,
  getAdjacentTradingDates,
  fetchTradeCalendar,
  clearTradeCalendarCache
} from '../src/js/tradeCalendar.js';

QUnit.module('tradeCalendar', () => {
  const dates = ['2026-06-03', '2026-06-04', '2026-06-05', '2026-06-08'];

  QUnit.test('parseTradeCalendar accepts common AKTools field names', (t) => {
    const parsed = parseTradeCalendar([
      { trade_date: '2026-06-03' },
      { 日期: '20260604' },
      { 交易日: '2026-06-05 00:00:00' },
      { nope: 'x' }
    ]);
    t.deepEqual(parsed, ['2026-06-03', '2026-06-04', '2026-06-05']);
  });

  QUnit.test('weekend resolves to latest previous trading date', (t) => {
    t.equal(resolveLatestTradingDate('2026-06-06', dates), '2026-06-05');
    t.equal(resolveLatestTradingDate('2026-06-07', dates), '2026-06-05');
  });

  QUnit.test('shiftTradingDate skips non-trading days', (t) => {
    t.equal(shiftTradingDate('2026-06-05', 1, dates), '2026-06-08');
    t.equal(shiftTradingDate('2026-06-08', -1, dates), '2026-06-05');
  });

  QUnit.test('getAdjacentTradingDates caps next at latest trading date', (t) => {
    const adj = getAdjacentTradingDates('2026-06-05', dates, '2026-06-07');
    t.equal(adj.current, '2026-06-05');
    t.equal(adj.latest, '2026-06-05');
    t.equal(adj.previous, '2026-06-04');
    t.equal(adj.next, null);
  });

  QUnit.test('fetchTradeCalendar rethrows AbortError without poisoning cache with fallback', async (t) => {
    clearTradeCalendarCache();
    const origFetch = globalThis.fetch;
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };

    let caught = null;
    try {
      await fetchTradeCalendar({ signal: controller.signal });
    } catch (e) {
      caught = e;
    } finally {
      globalThis.fetch = origFetch;
      clearTradeCalendarCache();
    }

    t.ok(caught && caught.name === 'AbortError', 'rethrows AbortError cleanly');
  });
});
