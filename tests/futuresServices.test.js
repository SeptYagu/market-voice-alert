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
