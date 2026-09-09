// Integration tests: require a reachable AKTools backend / upstream market
// data source. The runner provides a fresh temporary cache. These are NOT part of `npm test`
// (which must stay offline and date-independent); run them explicitly with:
//
//   npm run test:integration
//
// Prerequisites: AKTools HTTP service at AKTOOLS_BASE (default port 8888), network access,
// and data for the current trading session already produced. A failure here
// may mean upstream data is unavailable or the session's data has not been
// generated yet — it does not necessarily indicate a parser bug.
import { chartTimeToDate } from '../../src/js/time.js';
import { getCachedFuturesQuote, getCachedFuturesQuotes } from '../../server/futures/futuresQuoteService.js';
import { getCachedFuturesKline, getCachedFuturesIntraday } from '../../server/futures/futuresKlineService.js';

const integrationOptions = process.env.FUTURES_INTEGRATION_DATE ? { date: process.env.FUTURES_INTEGRATION_DATE } : {};
function diagnose(label, data) {
  console.log(JSON.stringify({ label, source: data?.source, stale: data?.stale,
    targetTradingDay: data?.tradingDay || integrationOptions.date,
    count: data?.items?.length, first: chartTimeToDate(data?.items?.[0]?.time),
    last: chartTimeToDate(data?.items?.at(-1)?.time) }));
}

QUnit.module('Futures Backend Services (integration, live data)');

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
  const intraday = await getCachedFuturesIntraday('RB0', integrationOptions);
  diagnose('RB0 intraday', intraday);
  assert.ok(intraday, 'intraday exists');
  assert.equal(intraday.symbol, 'RB0', 'symbol is RB0');
  assert.ok(Array.isArray(intraday.items), 'items is array');
  assert.ok(intraday.items.length > 0, `contains bars: ${intraday.items.length}`);
  // Should not be bloated to 1023 bars if filtered
  assert.ok(intraday.items.length <= 400, `single-day intraday count is reasonable (<= 400): ${intraday.items.length}`);
  assert.ok(intraday.items.some((it) => Number.isFinite(it.avgPrice) && it.avgPrice > 0), 'intraday bars contain valid positive avgPrice');
});

QUnit.test('getCachedFuturesKline supports weekly and monthly periods without throwing', async (assert) => {
  const klineW = await getCachedFuturesKline('RB0', '1w');
  diagnose('RB0 weekly', klineW);
  assert.ok(klineW, '1w kline exists');
  assert.equal(klineW.period, '1w');
  assert.ok(Array.isArray(klineW.items) && klineW.items.length > 0, '1w has bars');

  const klineM = await getCachedFuturesKline('RB0', '1M');
  diagnose('RB0 monthly', klineM);
  assert.ok(klineM, '1M kline exists');
  assert.equal(klineM.period, '1M');
  assert.ok(Array.isArray(klineM.items) && klineM.items.length > 0, '1M has bars');
});
