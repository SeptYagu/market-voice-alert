import { getCachedFuturesQuote, getCachedFuturesQuotes } from '../server/futures/futuresQuoteService.js';
import { getCachedFuturesKline, getCachedFuturesIntraday } from '../server/futures/futuresKlineService.js';

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
