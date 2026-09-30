import { ChartRowManager, createChartState, applyLiveTickToKlineChart } from '../src/js/controllers/chartRowController.js';
import { applyLiveQuoteToKline } from '../src/js/kline.js';

QUnit.module('chart period isolation regressions', () => {
  QUnit.test('failed first minute load automatically retries after recovery and respects pause/dispose', async t => {
    const originalFetch = globalThis.fetch;
    const originalInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const timers = new Set();
    let recovered = false, allowed = false, expanded = true, calls = 0, rendered = null;
    globalThis.setInterval = (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.add(timer);
      return timer;
    };
    globalThis.clearInterval = timer => { timers.delete(timer); };
    globalThis.fetch = async () => {
      calls++;
      if (!recovered) throw new Error('temporary fixture outage');
      return { ok: true, json: async () => ({ rc: 0, data: { code: '600524', market: 1,
        name: 'fixture', klines: ['2026-09-30 10:00,100,101,102,99,200,20100,0,1'] } }) };
    };
    const inst = createChartState('5m'); inst.selectedTradeDate = '2026-09-29';
    const map = new Map([['sh600524', inst]]);
    const mgr = new ChartRowManager({ getChartInstances: () => map, isExpanded: () => expanded,
      canRefreshKline: () => allowed });
    mgr.klineCtlMap.set('sh600524', { setPeriod() {}, setKline(items) { rendered = items; },
      setVolume() {}, clearMA() {}, fitContent() {}, destroy() {} });
    try {
      await mgr.loadKline('sh600524', { force: true, reloadIntraday: false });
      t.ok(inst.error, 'first request fails visibly');
      t.notOk(inst.loading);
      t.equal(timers.size, 1, 'failure still installs exactly one scheduler');
      const timer = mgr.minuteRefreshTimers.get('sh600524');
      t.ok(timer, 'retry driver exists even without first-load data');
      if (!timer) return;
      t.equal(timer.delay, 15000, 'retry occurs on the next 15-second interval');
      const failedCalls = calls;
      recovered = true;
      timer.callback();
      await new Promise(resolve => setTimeout(resolve, 0));
      t.equal(calls, failedCalls, 'paused scheduler sends no network requests');
      allowed = true;
      timer.callback();
      await new Promise(resolve => setTimeout(resolve, 0));
      t.equal(inst.error, null, 'automatic retry clears the error without user action');
      t.equal(inst.klineData?.items[0].high, 102, 'period high recovers');
      t.equal(inst.klineData?.items[0].low, 99, 'period low recovers');
      t.equal(rendered?.[0].close, 101, 'recovered data renders');
      t.equal(timers.size, 1, 'successful retry does not duplicate the scheduler');
      expanded = false;
      const recoveredCalls = calls;
      mgr.destroyAll();
      t.equal(timers.size, 0, 'closing disposes scheduler');
      timer.callback();
      await new Promise(resolve => setTimeout(resolve, 0));
      t.equal(calls, recoveredCalls, 'an already queued tick cannot request a closed chart');
    } finally {
      mgr.destroyAll();
      globalThis.fetch = originalFetch;
      globalThis.setInterval = originalInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  QUnit.test('in-flight intraday response survives a period change', async t => {
    const originalFetch = globalThis.fetch;
    let finishIntraday;
    globalThis.fetch = async url => {
      if (String(url).includes('/api/cache/intraday')) {
        return new Promise(resolve => { finishIntraday = () => resolve({ ok: true,
          json: async () => ({ ok: true, data: { items: [{ time: 1, close: 77 }] } }) }); });
      }
      return { ok: true, json: async () => ({ ok: true, data: { code: 'sh600522',
        items: [{ time: '2026-09-30 10:00', open: 100, high: 102, low: 99, close: 101 }] } }) };
    };
    const inst = createChartState('1d');
    inst.manualTradeDate = true;
    const map = new Map([['sh600522', inst]]);
    const mgr = new ChartRowManager({ getChartInstances: () => map, isExpanded: () => true });
    try {
      const pending = mgr.loadIntraday('sh600522', '2026-09-29');
      const abort = inst.intradayAbort;
      await mgr.handlePeriodChange('5m', 'sh600522');
      t.strictEqual(inst.intradayAbort, abort);
      t.notOk(abort.signal.aborted);
      finishIntraday();
      await pending;
      t.equal(inst.intradayData.items[0].close, 77, 'original response can still commit');
      t.equal(inst.selectedTradeDate, '2026-09-29');
      t.notOk(inst.intradayLoading);
    } finally {
      finishIntraday?.(); mgr.destroyAll(); globalThis.fetch = originalFetch;
    }
  });

  QUnit.test('rapid period changes reject the old K-line response without resetting a new intraday date', async t => {
    const originalFetch = globalThis.fetch;
    const responses = new Map();
    globalThis.fetch = async url => {
      const period = new URL(String(url), 'http://localhost').searchParams.get('period');
      return new Promise(resolve => { responses.set(period, close => resolve({ ok: true,
        json: async () => ({ ok: true, data: { code: 'sh600523', items: [
          { time: '2026-09-30 10:00', open: close, high: close, low: close, close }
        ] } }) })); });
    };
    const inst = createChartState('1d'); inst.selectedTradeDate = '2026-09-29';
    const map = new Map([['sh600523', inst]]);
    const mgr = new ChartRowManager({ getChartInstances: () => map, isExpanded: () => true });
    try {
      const old = mgr.handlePeriodChange('5m', 'sh600523');
      const fresh = mgr.handlePeriodChange('15m', 'sh600523');
      inst.selectedTradeDate = '2026-09-28'; inst.manualTradeDate = true;
      responses.get('15m')(15);
      await fresh;
      responses.get('5m')(5);
      await old;
      t.equal(inst.period, '15m');
      t.equal(inst.klineData.items[0].close, 15, 'old response cannot replace active period');
      t.equal(inst.selectedTradeDate, '2026-09-28', 'new intraday selection survives both responses');
      t.ok(inst.manualTradeDate);
    } finally {
      for (const resolve of responses.values()) resolve(1);
      mgr.destroyAll(); globalThis.fetch = originalFetch;
    }
  });

  QUnit.test('all minute periods retain authoritative OHLCV for all snapshot times and assets', t => {
    const bar = { time: '2026-09-30 10:00', open: 100, high: 102, low: 99, close: 101, volume: 200, amount: 20100 };
    const items = [bar];
    for (const code of ['sh600519', 'RB0', 'GL_CL0', 'hk00700', 'usAAPL']) {
      for (const period of ['1m', '5m', '15m', '30m', '60m']) {
        for (const updateTime of ['20260930100030', '20260930110000', '20260929100000', undefined]) {
          const out = applyLiveQuoteToKline(items, { code, price: 101.5, open: 95, high: 120, low: 80,
            volume: 100000, amount: 10000000, updateTime }, period, code, new Date('2026-09-30T02:00:30Z'));
          t.strictEqual(out, items, `${code}/${period}/${updateTime}: snapshot cannot modify a period candle`);
        }
      }
    }
    const inst = { period: '5m', klineData: { items } };
    applyLiveTickToKlineChart({}, inst, 150);
    t.strictEqual(inst.klineData.items, items, 'numeric controller entry cannot bypass isolation');
    t.deepEqual(bar, { time: '2026-09-30 10:00', open: 100, high: 102, low: 99, close: 101, volume: 200, amount: 20100 });
  });

  QUnit.test('K-line-only load and force minute reload preserve intraday and throttle network', async t => {
    const originalFetch = globalThis.fetch;
    let network = 0, fullRender = 0, intradayLoads = 0, allowed = true;
    globalThis.fetch = async () => {
      network++;
      return { ok: true, json: async () => ({ rc: 0, data: { code: '600521', market: 1, name: 'fixture',
        klines: ['2026-09-30 10:00,100,101,102,99,200,20100,0,1'] } }) };
    };
    const inst = createChartState('5m');
    inst.selectedTradeDate = '2026-09-29'; inst.manualTradeDate = true;
    inst.intradayData = { items: [{ time: 1, close: 100 }] };
    inst.intradayAbort = new AbortController();
    const intradayData = inst.intradayData, abort = inst.intradayAbort;
    const map = new Map([['sh600521', inst]]);
    const mgr = new ChartRowManager({ getChartInstances: () => map, isExpanded: () => true,
      canRefreshKline: () => allowed,
      getQuote: () => ({ price: 101.5, high: 120, low: 80 }), onStateChange: () => { fullRender++; } });
    mgr.loadIntraday = () => { intradayLoads++; };
    try {
      await mgr.loadKline('sh600521', { force: true, reloadIntraday: false });
      t.equal(inst.klineData.items[0].high, 102, 'load-time snapshot cannot pollute high');
      t.equal(inst.klineData.items[0].low, 99, 'load-time snapshot cannot pollute low');
      t.strictEqual(inst.intradayData, intradayData);
      t.strictEqual(inst.intradayAbort, abort);
      t.equal(inst.selectedTradeDate, '2026-09-29');
      t.ok(inst.manualTradeDate);
      t.equal(fullRender, 0, 'no full table rerender');
      t.equal(intradayLoads, 0, 'no intraday request');
      t.ok(mgr.minuteRefreshTimers.has('sh600521'), 'minute reload scheduler exists');
      inst.loading = false;
      t.ok(await mgr.refreshMinuteKline('sh600521'), 'period endpoint reload succeeds');
      const count = network;
      t.notOk(await mgr.refreshMinuteKline('sh600521'), 'throttles a second reload');
      t.equal(network, count);
      t.equal(intradayLoads, 0, 'background reload remains independent');
      allowed = false;
      inst.klineLastReloadAt = 0;
      t.notOk(await mgr.refreshMinuteKline('sh600521'), 'automatic refresh policy pauses minute reload');
      t.equal(network, count, 'paused refresh sends no requests');
    } finally {
      mgr.destroyAll(); globalThis.fetch = originalFetch;
    }
    t.equal(mgr.minuteRefreshTimers.size, 0, 'dispose stops scheduler');
  });
});
