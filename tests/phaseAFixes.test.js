import { createMonitorController } from '../src/js/controllers/monitorController.js';
import { createMomentumController } from '../src/js/controllers/momentumController.js';
import { fetchQuotes, fetchIntraday } from '../src/js/api.js';
import { formatIntradayStatus } from '../src/js/controllers/chartRowController.js';

QUnit.module('Phase A Defect Fixes (R1, R2, R3, R4, R8)', () => {
  QUnit.test('R1: Slow response is not aborted by scheduled tick and commits quotes', async assert => {
    const state = {
      watchList: ['sh600000'],
      subscribed: new Set(),
      quotes: new Map(),
      autoRefreshEnabled: true,
      refreshInterval: 3000
    };
    let tick;
    const pending = [];
    const controller = createMonitorController({
      getState: () => state,
      timers: {
        setInterval: fn => { tick = fn; return 1; },
        clearInterval() {}
      },
      fetchQuotes: (_, { signal }) => new Promise(resolve => pending.push({ resolve, signal }))
    });

    controller.applySchedule(true);
    // Trigger initial tick
    const p1 = tick();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].signal.aborted, false);

    // Scheduled tick while in-flight should NOT abort in-flight request
    const p2 = tick();
    assert.equal(pending[0].signal.aborted, false, 'in-flight slow request is preserved');

    // Resolve the slow response
    pending[0].resolve([{ code: 'sh600000', price: 15.5 }]);
    await p1;
    await p2;

    assert.equal(state.quotes.size, 1, 'quote was committed');
    assert.equal(state.quotes.get('sh600000').price, 15.5);
    controller.stop();
  });

  QUnit.test('R2: All providers offline throws and records error without advancing lastUpdate', async assert => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error('network down'); };
      const failureState = {
        watchList: ['sh600000'],
        subscribed: new Set(),
        quotes: new Map([['sh600000', { code: 'sh600000', price: 9.0 }]]),
        autoRefreshEnabled: true,
        refreshInterval: 3000,
        lastUpdate: null,
        error: null
      };
      let processed = 0;
      const failureCtl = createMonitorController({
        getState: () => failureState,
        fetchQuotes,
        clock: () => new Date('2026-09-10T06:00:00Z'),
        onQuotes: () => processed++
      });

      await failureCtl.refresh();

      assert.ok(failureState.error, 'error should be recorded');
      assert.ok(failureState.error.includes('行情数据源全部失败'));
      assert.equal(failureState.lastUpdate, null, 'lastUpdate is not falsely advanced');
      assert.equal(processed, 0, 'onQuotes is not invoked on failed refresh');
      assert.equal(failureState.quotes.get('sh600000').price, 9.0, 'old quote is retained');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  QUnit.test('R3: Momentum-only items are included in getRefreshCodes', assert => {
    const state = {
      watchList: ['sh600000'],
      subscribed: new Set(['sz000002']),
      momentum: { items: [{ code: 'bj920071' }, { code: 'sh600000' }] }
    };
    const ctl = createMonitorController({ getState: () => state });
    const codes = ctl.getRefreshCodes();
    assert.ok(codes.includes('sh600000'));
    assert.ok(codes.includes('sz000002'));
    assert.ok(codes.includes('bj920071'), 'momentum item is included');
  });

  QUnit.test('R4: Stale scan quote does not overwrite newer live quote', async assert => {
    const state = {
      quotes: new Map([
        ['sh600000', {
          code: 'sh600000',
          price: 20,
          changePercent: 10,
          amount: 200,
          time: '2026-09-10 14:00:00',
          open: 18
        }]
      ]),
      momentum: { items: [], pinnedCodes: new Set(), expandedCodes: new Set(), chartInstances: new Map() }
    };

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async url => ({
        ok: true,
        json: async () => ({
          ok: true,
          stale: true,
          generatedAt: 1,
          data: String(url).includes('/scan?') ? {} : {
            status: 'complete',
            items: [
              { code: 'sh600000', price: 10, changePercent: 1, amount: 100, startClose: 5 }
            ]
          }
        })
      });

      const scanCtl = createMomentumController({ getState: () => state, momentumChartMgr: {} });
      await scanCtl.handleScan({ poll: true });

      const quote = state.quotes.get('sh600000');
      assert.equal(quote.price, 20, 'live price 20 is not overwritten by scan price 10');
      assert.equal(quote.time, '2026-09-10 14:00:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  QUnit.test('R8: Shared cache stale metadata is preserved and surfaced in formatIntradayStatus', async assert => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          stale: true,
          generatedAt: 1789000000000,
          source: 'stale',
          data: {
            code: 'sh600000',
            source: 'tencent-minute',
            items: [{ time: 1789032600, price: 10, avgPrice: 10, percent: 0 }]
          }
        })
      });

      const intraday = await fetchIntraday('sh600000', { sharedCache: true, date: '2026-09-10' });
      assert.equal(intraday.stale, true, 'stale flag is preserved');
      assert.equal(intraday.generatedAt, 1789000000000, 'generatedAt is preserved');

      const label = formatIntradayStatus({ intradayData: intraday, selectedTradeDate: '2026-09-10' });
      assert.true(/过期|缓存|延迟/.test(label), 'status label contains stale/cache warning');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  QUnit.test('M2: Partial quote failure returns failedCodes and flags missing quotes as stale', async assert => {
    const state = {
      watchList: ['sh600000', 'sh600001'],
      subscribed: new Set(),
      quotes: new Map([
        ['sh600000', { code: 'sh600000', price: 10, stale: false }],
        ['sh600001', { code: 'sh600001', price: 20, stale: false }]
      ]),
      autoRefreshEnabled: true,
      refreshInterval: 3000
    };

    const mockFetchQuotes = async (_codes) => {
      // Only sh600000 succeeds; sh600001 fails/missing
      const fulfilled = [{ code: 'sh600000', price: 10.5 }];
      fulfilled.quotes = fulfilled;
      fulfilled.failedCodes = ['sh600001'];
      fulfilled.asOf = Date.now();
      fulfilled.source = 'aggregated';
      return fulfilled;
    };

    const ctl = createMonitorController({
      getState: () => state,
      fetchQuotes: mockFetchQuotes
    });

    await ctl.refresh();

    assert.equal(state.quotes.get('sh600000').price, 10.5);
    assert.equal(state.quotes.get('sh600000').stale, false);
    assert.equal(state.quotes.get('sh600001').price, 20, 'old price retained for failed code');
    assert.equal(state.quotes.get('sh600001').stale, true, 'missing code is flagged stale');
    assert.deepEqual(state.failedCodes, ['sh600001']);
  });

  QUnit.test('M6: In-flight ownership is scoped to current token; older request completion does not clear inFlight prematurely', async assert => {
    const state = {
      watchList: ['sh600000'],
      subscribed: new Set(),
      quotes: new Map(),
      autoRefreshEnabled: true
    };
    const pending = [];
    const ctl = createMonitorController({
      getState: () => state,
      fetchQuotes: (_, { signal }) => new Promise((resolve) => pending.push({ resolve, signal }))
    });

    // 1. Start first request
    const p1 = ctl.refresh({ forced: true });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].signal.aborted, false);
    assert.equal(ctl.inspect().inFlight, true);

    // 2. Start second forced request while first is pending (first gets aborted by scope.begin)
    const p2 = ctl.refresh({ forced: true });
    assert.equal(pending.length, 2);
    assert.equal(pending[0].signal.aborted, true, 'first request aborted');
    assert.equal(pending[1].signal.aborted, false);
    assert.equal(ctl.inspect().inFlight, true);

    // 3. Resolve first (aborted) request. Its finally block executes.
    pending[0].resolve([{ code: 'sh600000', price: 10 }]);
    await p1;

    // inFlight MUST remain true because second request is still in-flight!
    assert.equal(ctl.inspect().inFlight, true, 'inFlight remains true while second request is active');

    // 4. Non-forced refresh should be blocked because inFlight is still true
    const p3 = ctl.refresh({ forced: false });
    assert.equal(pending.length, 2, 'non-forced refresh was blocked');
    await p3;

    // 5. Complete second request
    pending[1].resolve([{ code: 'sh600000', price: 11 }]);
    await p2;

    assert.equal(ctl.inspect().inFlight, false, 'inFlight released after current request completes');
    assert.equal(state.quotes.get('sh600000').price, 11);
  });
});
