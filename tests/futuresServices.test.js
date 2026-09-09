import { readFile } from 'node:fs/promises';
import { chartTimeToDate } from '../src/js/time.js';
import { _internal, getCachedFuturesIntraday, getCachedFuturesKline } from '../server/futures/futuresKlineService.js';
import { parseFutureInput } from '../server/futures/contractCatalog.js';

// Offline unit tests only. Tests that hit the live AKTools/upstream data
// source (and depend on the current date and local cache) live in
// tests/integration/futuresServices.integration.js and run via
// `npm run test:integration`.

QUnit.module('Futures Backend Services (offline)');

QUnit.test('production Sina minute fallback parses recorded JSONP and field positions', async assert => {
  const original = globalThis.fetch;
  const fixture = await readFile(new URL('./fixtures/futures/sina_minute_rb0.txt', import.meta.url), 'utf8');
  globalThis.fetch = async url => String(url).includes('getMinLine')
    ? { ok: true, text: async () => fixture } : { ok: false, status: 503 };
  try {
    const result = await _internal.fetchFuturesMinute(parseFutureInput('RB0'));
    assert.equal(result.source, 'sina-futures-minline');
    assert.equal(result.items[0].close, 3144);
    assert.equal(result.items[0].avgPrice, 3144.406);
    assert.equal(result.items[0].volume, 15805);
    assert.equal(result.items[0].openInterest, 1466859);
    assert.equal(chartTimeToDate(result.items[0].time), '2026-09-04');
  } finally { globalThis.fetch = original; }
});

QUnit.test('production Sina daily fallback parses recorded JSONP', async assert => {
  const original = globalThis.fetch;
  const fixture = await readFile(new URL('./fixtures/futures/sina_daily_rb0.txt', import.meta.url), 'utf8');
  globalThis.fetch = async url => String(url).includes('getDailyKLine')
    ? { ok: true, text: async () => fixture } : { ok: false, status: 503 };
  try {
    const result = await _internal.fetchFuturesDaily(parseFutureInput('RB0'));
    assert.equal(result.source, 'sina-futures-dailykline');
    const last = result.items.at(-1);
    assert.equal(chartTimeToDate(last.time), '2026-09-03');
    assert.equal(last.close, 3142);
    assert.equal(last.openInterest, 1466483);
  } finally { globalThis.fetch = original; }
});

QUnit.test('cached production futures services use fixed time, fixtures and disposable cache', async assert => {
  const original = globalThis.fetch;
  const minute = JSON.parse(await readFile(new URL('./fixtures/futures/aktools_minute_rb0.json', import.meta.url), 'utf8'));
  const daily = JSON.parse(await readFile(new URL('./fixtures/futures/aktools_daily_rb0.json', import.meta.url), 'utf8'));
  const requests = [];
  globalThis.fetch = async url => {
    const u = String(url); requests.push(u);
    if (u.includes('tool_trade_date_hist_sina')) return { ok: true, json: async () =>
      ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07'].map(trade_date => ({ trade_date })) };
    if (u.includes('futures_zh_minute_sina')) return { ok: true, json: async () => minute };
    if (u.includes('futures_zh_daily_sina')) return { ok: true, json: async () => daily };
    // Explicit fixture outage for optional live quote synthesis; historical bars remain usable.
    if (u.includes('hq.sinajs.cn') || u.includes('futures_zh_spot')) return { ok: false, status: 503 };
    assert.ok(false, `Unexpected service fixture URL: ${u}`);
    throw new Error('Unexpected fixture request');
  };
  const opts = { now: new Date('2026-09-04T10:00:00+08:00'), date: '2026-09-04', force: true };
  try {
    const intraday = await getCachedFuturesIntraday('RB0', opts);
    assert.equal(intraday.tradingDay, '2026-09-04');
    assert.ok(intraday.items.length > 0 && intraday.items.length <= 400);
    assert.ok(intraday.items.every(item => item.avgPrice > 0));
    for (const period of ['1w', '1M']) {
      const kline = await getCachedFuturesKline('RB0', period, opts);
      assert.equal(kline.period, period);
      assert.ok(kline.items.length > 0);
    }
    assert.ok(requests.some(url => url.includes('futures_zh_minute_sina')));
  } finally { globalThis.fetch = original; }
});

QUnit.test('aggregateDailyBarsToWeekly correctly aggregates daily bars into weekly bars', (assert) => {
  const daily = [
    { time: '2026-08-31', open: 100, high: 105, low: 98, close: 102, volume: 1000, openInterest: 5000 },
    { time: '2026-09-01', open: 102, high: 110, low: 101, close: 108, volume: 1200, openInterest: 5200 },
    { time: '2026-09-02', open: 108, high: 109, low: 104, close: 105, volume: 800, openInterest: 5100 },
    { time: '2026-09-03', open: 105, high: 107, low: 103, close: 106, volume: 900, openInterest: 5300 },
    { time: '2026-09-04', open: 106, high: 112, low: 105, close: 111, volume: 1500, openInterest: 5500 },
    // Next week
    { time: '2026-09-07', open: 111, high: 115, low: 109, close: 113, volume: 1100, openInterest: 5600 }
  ];

  const weekly = _internal.aggregateDailyBarsToWeekly(daily);
  assert.equal(weekly.length, 2, 'grouped into 2 weeks');

  const w1 = weekly[0];
  assert.equal(w1.time, '2026-09-04', 'week 1 bar time is Friday (last trading day)');
  assert.equal(w1.open, 100, 'open is Monday open');
  assert.equal(w1.high, 112, 'high is week max high');
  assert.equal(w1.low, 98, 'low is week min low');
  assert.equal(w1.close, 111, 'close is Friday close');
  assert.equal(w1.volume, 5400, 'volume is sum of all daily volumes');
  assert.equal(w1.openInterest, 5500, 'openInterest is Friday openInterest');

  const w2 = weekly[1];
  assert.equal(w2.time, '2026-09-07', 'week 2 bar time is Monday');
  assert.equal(w2.open, 111);
  assert.equal(w2.close, 113);
});

QUnit.test('aggregateDailyBarsToMonthly correctly aggregates daily bars into monthly bars', (assert) => {
  const daily = [
    { time: '2026-08-28', open: 90, high: 95, low: 88, close: 92, volume: 500 },
    { time: '2026-08-31', open: 92, high: 96, low: 91, close: 95, volume: 600 },
    { time: '2026-09-01', open: 95, high: 100, low: 94, close: 98, volume: 700 },
    { time: '2026-09-02', open: 98, high: 105, low: 97, close: 102, volume: 800 }
  ];

  const monthly = _internal.aggregateDailyBarsToMonthly(daily);
  assert.equal(monthly.length, 2, 'grouped into 2 months');

  const mAug = monthly[0];
  assert.equal(mAug.time, '2026-08-31', 'August ends on 2026-08-31');
  assert.equal(mAug.open, 90, 'August open is first bar open');
  assert.equal(mAug.high, 96, 'August high');
  assert.equal(mAug.low, 88, 'August low');
  assert.equal(mAug.close, 95, 'August close');
  assert.equal(mAug.volume, 1100, 'August volume sum');

  const mSep = monthly[1];
  assert.equal(mSep.time, '2026-09-02');
  assert.equal(mSep.open, 95);
  assert.equal(mSep.close, 102);
});

QUnit.test('parseFutureInput validates contract year and month', (assert) => {
  assert.equal(parseFutureInput('rb2613'), null, 'month 13 rejected');
  assert.equal(parseFutureInput('rb2600'), null, 'month 0 rejected');
  assert.equal(parseFutureInput('rb9905'), null, 'year 2099 rejected');
  const valid = parseFutureInput('rb2610');
  assert.ok(valid, 'rb2610 is valid');
  assert.equal(valid.symbol, 'RB2610');
});
