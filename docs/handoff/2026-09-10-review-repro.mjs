// Run from repository root: node docs/handoff/2026-09-10-review-repro.mjs
// These assertions reproduce existing defects, not the desired fixed behavior.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const scratch = await mkdtemp(join(tmpdir(), 'mva-review-0910-'));
process.env.MARKET_VOICE_CACHE_ROOT = scratch;
const originalFetch = globalThis.fetch;
globalThis.document = { getElementById: () => null };
globalThis.fetch = async () => { throw new Error('offline fixture'); };
const { createMonitorController } = await import('../../src/js/controllers/monitorController.js');
const { createMomentumController } = await import('../../src/js/controllers/momentumController.js');
const { fetchQuotes, fetchIntraday } = await import('../../src/js/api.js');
const { formatIntradayStatus } = await import('../../src/js/controllers/chartRowController.js');
const { writeCache } = await import('../../server/cacheStore.js');
const { getCachedLimitUp, getCachedLimitUpReasons } = await import('../../server/limitUpService.js');
const { resolveMomentumScanDates, mergeLiveQuoteIntoDailyKline } = await import('../../server/momentumService.js');
const { computeTenDayMomentum } = await import('../../src/js/services/momentumMath.js');
const tts = await import('../../src/js/tts.js');
const makeState = () => ({ watchList: ['sh600000'], subscribed: new Set(), quotes: new Map(),
  autoRefreshEnabled: true, refreshInterval: 3000, limitUp: { items: [] },
  momentum: { items: [], pinnedCodes: new Set(), expandedCodes: new Set(), chartInstances: new Map() } });
try {
  // R1: simulate each request completing after the following scheduled tick.
  const state = makeState();
  let tick;
  const pending = [];
  const ctl = createMonitorController({ getState: () => state,
    timers: { setInterval: fn => { tick = fn; return 1; }, clearInterval() {} },
    fetchQuotes: (_, { signal }) => new Promise(resolve => pending.push({ resolve, signal })) });
  ctl.applySchedule(true);
  let previous = tick();
  for (let i = 0; i < 4; i++) {
    const next = tick();
    assert.equal(pending[i].signal.aborted, true);
    pending[i].resolve([{ code: 'sh600000', price: 10 + i }]);
    await previous;
    previous = next;
  }
  assert.equal(state.quotes.size, 0);
  ctl.stop(); pending.at(-1).resolve([]); await previous;
  console.log('R1 reproduced: four completed slow responses, zero committed quotes');

  // R2: the real API facade swallows every upstream error.
  const failureState = makeState();
  failureState.quotes.set('sh600000', { code: 'sh600000', price: 9 });
  let processed = 0;
  const failureCtl = createMonitorController({ getState: () => failureState, fetchQuotes,
    clock: () => new Date('2026-09-10T06:00:00Z'), onQuotes: () => processed++ });
  await failureCtl.refresh();
  assert.equal(failureState.error, null);
  assert.equal(failureState.lastUpdate.toISOString(), '2026-09-10T06:00:00.000Z');
  assert.equal(processed, 1);
  assert.equal(failureState.quotes.get('sh600000').price, 9);
  console.log('R2 reproduced: all providers offline, old quote retained and success time advanced');

  // R3: a momentum-only row is absent from the quote subscription union.
  failureState.momentum.items = [{ code: 'sz000001', price: 20 }];
  assert.equal(failureCtl.getRefreshCodes().includes('sz000001'), false);
  console.log('R3 reproduced: momentum-only symbol is never requested by monitor refresh');

  // R4: an older scan overwrites fields of an already newer live quote.
  const scanState = makeState();
  scanState.quotes.set('sh600000', { code: 'sh600000', price: 20, changePercent: 10,
    amount: 200, time: '2026-09-10 14:00:00', open: 18 });
  globalThis.fetch = async url => ({ ok: true, json: async () => ({ ok: true,
    stale: true, generatedAt: 1,
    data: String(url).includes('/scan?') ? {} : { status: 'complete', items: [
      { code: 'sh600000', price: 10, changePercent: 1, amount: 100, startClose: 5 }
    ] } }) });
  const scanCtl = createMomentumController({ getState: () => scanState, momentumChartMgr: {} });
  await scanCtl.handleScan({ poll: true });
  assert.equal(scanState.quotes.get('sh600000').price, 10);
  assert.equal(scanState.quotes.get('sh600000').time, '2026-09-10 14:00:00');
  console.log('R4 reproduced: stale scan price 10 paired with live quote timestamp 14:00 (was 20)');

  // R5: yesterday's morning-only pool and empty reason archive bypass refresh.
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('unexpected network'); };
  const generatedAt = Date.parse('2026-09-09T02:00:00Z');
  await writeCache(['limit-up', '20260909', 'merged.json'], { generatedAt,
    data: { limitUpItems: [{ code: 'sh600000' }], brokenItems: [], items: [{ code: 'sh600000' }] } }, { skipPrune: true });
  await writeCache(['limit-up', '20260909', 'reasons.json'], { generatedAt,
    data: { reasons: [] } }, { skipPrune: true });
  const pool = await getCachedLimitUp({ date: '20260909' });
  const reasons = await getCachedLimitUpReasons({ date: '20260909' });
  assert.equal(pool.stale, false); assert.equal(reasons.stale, false);
  assert.equal(pool.generatedAt, generatedAt); assert.equal(networkCalls, 0);
  console.log('R5 reproduced: historical morning pool and empty reasons considered fresh without request');

  // R6: local reference array limit does not bound native synth submissions.
  const nativeQueue = [];
  tts.setSpeechAdapter({ speak: u => nativeQueue.push(u), cancel: () => { nativeQueue.length = 0; } });
  for (let i = 0; i < 80; i++) tts.speak(`quote ${i}`);
  assert.equal(nativeQueue.length, 80);
  console.log(`R6 reproduced: native adapter received 80 pending utterances, advertised limit ${tts.MAX_QUEUE_SIZE}`);
  tts.cancel(); tts.setSpeechAdapter(null);

  // R7: pre-open fresh HTTP snapshot can still contain yesterday's OHLCV.
  const dates = ['2026-08-26','2026-08-27','2026-08-28','2026-08-31','2026-09-01',
    '2026-09-02','2026-09-03','2026-09-04','2026-09-07','2026-09-08','2026-09-09','2026-09-10'];
  const plan = resolveMomentumScanDates('20260910', dates, '20260910', new Date('2026-09-10T00:00:00Z'));
  const history = { items: dates.slice(0, -1).map((time, i) => ({ time, close: 10 + i })) };
  const merged = mergeLiveQuoteIntoDailyKline(history, { price: 20, open: 19, volume: 100,
    time: '2026-09-09 15:00:00' }, plan.liveDate);
  assert.equal(merged.items.at(-1).time, '2026-09-10');
  assert.equal(computeTenDayMomentum(history).gainPercent, 100);
  assert.equal(computeTenDayMomentum(merged).gainPercent, 81.82);
  console.log('R7 reproduced: 08:00 duplicates yesterday into today; ten-day gain changes 100 -> 81.82');
  // R8: envelope quality disappears between cache API and chart status.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true,
    stale: true, generatedAt: 1, source: 'stale', data: { code: 'sh600000', source: 'tencent-minute',
      items: [{ time: 1789032600, price: 10, avgPrice: 10, percent: 0 }] } }) });
  const intraday = await fetchIntraday('sh600000', { sharedCache: true, date: '2026-09-10' });
  assert.equal(intraday.stale, undefined);
  assert.equal(intraday.generatedAt, undefined);
  const label = formatIntradayStatus({ intradayData: intraday, selectedTradeDate: '2026-09-10' });
  assert.doesNotMatch(label, /过期|缓存|延迟/);
  console.log('R8 reproduced: stale envelope and generation time discarded; chart shows normal status');
  console.log('All 8 defect reproductions confirmed; no production source files changed.');
} finally {
  globalThis.fetch = originalFetch;
  if (dirname(resolve(scratch)) !== resolve(tmpdir())) throw new Error('Unexpected temporary path');
  await rm(scratch, { recursive: true, force: true });
}
