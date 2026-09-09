import { createLimitUpController } from '../src/js/controllers/limitUpController.js';
import { clearTradeCalendarCache } from '../src/js/tradeCalendar.js';

QUnit.test('limit-up stop invalidates old calendar and list continuations without clearing restart loading', async assert => {
  clearTradeCalendarCache();
  const original = globalThis.fetch;
  let calendarComplete, listComplete;
  globalThis.fetch = url => new Promise(resolve => {
    if (String(url).includes('/calendar/')) calendarComplete = resolve;
    else listComplete = resolve;
  });
  const lu = { selectedDate: '2026-09-07', requestSeq: 0, loading: false, items: [],
    groups: [], selectedCodes: new Set(), expandedCodes: new Set(), chartInstances: new Map() };
  const controller = createLimitUpController({ getState: () => ({ limitUp: lu }), limitUpChartMgr: {} });
  try {
    const old = controller.fetch();
    controller.stopTimer();
    lu.selectedDate = '2026-09-08';
    const current = controller.fetch();
    calendarComplete({ ok: true, json: async () => ({ ok: true, data: { dates: ['2026-09-07', '2026-09-08'] } }) });
    await old;
    assert.equal(lu.selectedDate, '2026-09-08');
    assert.true(lu.loading);
    assert.ok(listComplete, 'only current date reaches list request');
    controller.stopTimer();
    listComplete({ ok: true, json: async () => ({ ok: true, data: { limitUpItems: [], brokenItems: [] } }) });
    await current;
    assert.false(lu.loading);
    assert.false(lu.calendarLoading);
    assert.strictEqual(lu.abort, null);
    assert.deepEqual(lu.items, []);
  } finally { controller.stopTimer(); globalThis.fetch = original; clearTradeCalendarCache(); }
});
