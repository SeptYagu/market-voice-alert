import { getCachedFuturesQuote, getCachedFuturesQuotes } from '../server/futures/futuresQuoteService.js';
import { getCachedFuturesKline, getCachedFuturesIntraday, _internal } from '../server/futures/futuresKlineService.js';
import { parseFutureInput } from '../server/futures/contractCatalog.js';

QUnit.module('Futures Backend Services');

QUnit.test('getCachedFuturesQuote returns valid real quote for RB0 and IF0', async (assert) => {
  const quoteRb = await getCachedFuturesQuote('RB0');
  assert.ok(quoteRb, 'quote for RB0 exists');
  assert.equal(quoteRb.code, 'rb0', 'code is lowercase canonical rb0');
  assert.equal(quoteRb.symbol, 'RB0', 'symbol is RB0');
  assert.ok(quoteRb.price > 0, `price is positive: ${quoteRb.price}`);
  assert.ok(quoteRb.prevSettlement > 0, `prevSettlement is positive: ${quoteRb.prevSettlement}`);
  assert.ok(quoteRb.openInterest > 0, `openInterest is positive: ${quoteRb.openInterest}`);
  assert.ok(quoteRb.source.includes('aktools') || quoteRb.source.includes('sina'), `source is valid: ${quoteRb.source}`);

  const quoteIf = await getCachedFuturesQuote('IF0');
  assert.ok(quoteIf, 'quote for IF0 exists');
  assert.equal(quoteIf.code, 'if0', 'code is lowercase canonical if0');
  assert.equal(quoteIf.symbol, 'IF0', 'symbol is IF0');
  assert.ok(quoteIf.price > 0, `price is positive: ${quoteIf.price}`);
  assert.ok(quoteIf.openInterest > 0, `openInterest is positive: ${quoteIf.openInterest}`);
});

QUnit.test('getCachedFuturesQuotes batch returns valid array', async (assert) => {
  const quotes = await getCachedFuturesQuotes(['RB0', 'IF0']);
  assert.ok(Array.isArray(quotes), 'returns array');
  assert.equal(quotes.length, 2, 'returns 2 quotes');
  assert.equal(quotes[0].code, 'rb0', 'first is rb0');
  assert.equal(quotes[1].code, 'if0', 'second is if0');
});

QUnit.test('getCachedFuturesKline returns valid non-empty daily items', async (assert) => {
  const kline = await getCachedFuturesKline('RB0', 'day');
  assert.ok(kline, 'kline exists');
  assert.equal(kline.symbol, 'RB0', 'symbol is RB0');
  assert.ok(Array.isArray(kline.items), 'items is array');
  assert.ok(kline.items.length > 100, `contains > 100 bars: ${kline.items.length}`);

  const lastBar = kline.items[kline.items.length - 1];
  assert.ok(Number.isFinite(lastBar.time), 'lastBar.time is finite');
  assert.ok(lastBar.open > 0, 'lastBar.open > 0');
  assert.ok(lastBar.close > 0, 'lastBar.close > 0');
  assert.ok(lastBar.openInterest > 0, 'lastBar.openInterest > 0');
});

QUnit.test('getCachedFuturesIntraday returns filtered intraday bars', async (assert) => {
  const intraday = await getCachedFuturesIntraday('RB0');
  assert.ok(intraday, 'intraday exists');
  assert.equal(intraday.symbol, 'RB0', 'symbol is RB0');
  assert.ok(Array.isArray(intraday.items), 'items is array');
  assert.ok(intraday.items.length > 0, `contains bars: ${intraday.items.length}`);
  // Should not be bloated to 1023 bars if filtered
  assert.ok(intraday.items.length <= 400, `single-day intraday count is reasonable (<= 400): ${intraday.items.length}`);
});

QUnit.test('Sina minute JSONP parsing correctly extracts baseDate and maps volume & openInterest', (assert) => {
  const fixture = `/*<script>location.href='//sina.com';</script>*/\nvar _RB0=([["21:00","3144.000","3144.406","15805","1466859","3142.000","2026-09-04"],["21:01","3138.000","3143.011","12003","1466996"]]);`;
  const match = fixture.match(/var\s+[^=]+=\s*\(?\s*(\[[\s\S]*\])/);
  assert.ok(match, 'regex matches var _RB0=([ ... ])');
  const arr = JSON.parse(match[1]);
  assert.equal(arr.length, 2, 'parsed 2 rows');

  const baseDate = arr[0] && arr[0][6] ? arr[0][6] : null;
  assert.equal(baseDate, '2026-09-04', 'baseDate extracted from row[6]');

  const row0 = arr[0];
  const p = Number(row0[1]);
  const bar0 = {
    open: p,
    high: p,
    low: p,
    close: p,
    volume: Number(row0[3]) || 0,
    openInterest: Number(row0[4]) || 0
  };
  assert.equal(bar0.close, 3144, 'close is 3144 (not openInterest)');
  assert.equal(bar0.low, 3144, 'low is 3144 (not volume)');
  assert.equal(bar0.volume, 15805, 'volume is row[3]');
  assert.equal(bar0.openInterest, 1466859, 'openInterest is row[4]');
});

QUnit.test('Sina daily JSONP parsing correctly matches parentheses and variable names', (assert) => {
  const fixture = `/*<script>location.href='//sina.com';</script>*/\nvar _RB0=([{"d":"2026-09-04","o":"3145.000","h":"3158.000","l":"3137.000","c":"3156.000","v":"245269","p":"1467749","s":"3137.000"}]);`;
  const match = fixture.match(/var\s+[^=]+=\s*\(?\s*(\[[\s\S]*\])/);
  assert.ok(match, 'regex matches daily JSONP with parentheses');
  const arr = JSON.parse(match[1]);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].d, '2026-09-04');
  assert.equal(Number(arr[0].c), 3156);
  assert.equal(Number(arr[0].p), 1467749);
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

QUnit.test('getCachedFuturesKline supports weekly and monthly periods without throwing', async (assert) => {
  const klineW = await getCachedFuturesKline('RB0', '1w');
  assert.ok(klineW, '1w kline exists');
  assert.equal(klineW.period, '1w');
  assert.ok(Array.isArray(klineW.items) && klineW.items.length > 0, '1w has bars');

  const klineM = await getCachedFuturesKline('RB0', '1M');
  assert.ok(klineM, '1M kline exists');
  assert.equal(klineM.period, '1M');
  assert.ok(Array.isArray(klineM.items) && klineM.items.length > 0, '1M has bars');
});

QUnit.test('parseFutureInput validates contract year and month', (assert) => {
  assert.equal(parseFutureInput('rb2613'), null, 'month 13 rejected');
  assert.equal(parseFutureInput('rb2600'), null, 'month 0 rejected');
  assert.equal(parseFutureInput('rb9905'), null, 'year 2099 rejected');
  const valid = parseFutureInput('rb2610');
  assert.ok(valid, 'rb2610 is valid');
  assert.equal(valid.symbol, 'RB2610');
});
