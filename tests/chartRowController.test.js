import {
  rememberRange,
  restoreRangeOrFit,
  createChartState,
  applyLiveTickToKlineChart,
  formatKlineStatus,
  formatIntradayStatus,
  ChartRowManager
} from '../src/js/controllers/chartRowController.js';

QUnit.module('chartRowController.helpers', () => {
  QUnit.test('createChartState initializes default structure', (t) => {
    const s = createChartState('1d');
    t.equal(s.period, '1d');
    t.equal(s.loading, true);
    t.equal(s.error, null);
    t.equal(s.klineData, null);
    t.equal(s.selectedTradeDate, '');
    t.equal(s.intradayData, null);
  });

  QUnit.test('rememberRange and restoreRangeOrFit manage visible range', (t) => {
    const inst = { _visibleRange: null };
    const savedRange = { from: 10, to: 20 };
    let fitCalled = false;
    let setRangeCalledWith = null;

    const mockCtl = {
      getVisibleRange: () => savedRange,
      setVisibleRange: (r) => { setRangeCalledWith = r; return true; },
      fitContent: () => { fitCalled = true; }
    };

    rememberRange(inst, mockCtl, '_visibleRange');
    t.deepEqual(inst._visibleRange, { from: 10, to: 20 });

    restoreRangeOrFit(mockCtl, inst._visibleRange);
    t.deepEqual(setRangeCalledWith, { from: 10, to: 20 });
    t.notOk(fitCalled);

    restoreRangeOrFit(mockCtl, null);
    t.ok(fitCalled);
  });

  QUnit.test('formatKlineStatus and formatIntradayStatus produce human-readable strings', (t) => {
    const klineInst = {
      loading: false,
      error: null,
      period: '1d',
      klineData: { items: [1, 2, 3] }
    };
    t.equal(formatKlineStatus(klineInst), '日K · 3 根');

    const intradayInst = {
      intradayLoading: false,
      intradayError: null,
      selectedTradeDate: '2026-06-05',
      intradayData: {
        source: 'aktools-stock_intraday_em',
        items: [
          { time: '09:30', price: 10, avgPrice: 10, percent: 1.5 }
        ]
      }
    };
    const s = formatIntradayStatus(intradayInst);
    t.ok(s.includes('2026-06-05'));
    t.ok(s.includes('1 点'));
    t.ok(s.includes('+1.50%'));
    t.ok(s.includes('AKTools成交'));
  });

  QUnit.test('applyLiveTickToKlineChart updates live bar and MAs', (t) => {
    let updatedKline = null;
    let updatedMA = null;
    const mockCtl = {
      updateKline: (b) => { updatedKline = b; },
      updateVolume: () => {},
      updateMA: (n, val) => { updatedMA = { n, val }; }
    };
    const inst = {
      period: '1d',
      klineData: {
        code: 'sh600519',
        name: '贵州茅台',
        items: [
          { time: '2026-06-01', open: 100, high: 105, low: 99, close: 100, volume: 1000 },
          { time: '2026-06-02', open: 100, high: 105, low: 99, close: 100, volume: 1000 },
          { time: '2026-06-03', open: 100, high: 105, low: 99, close: 100, volume: 1000 },
          { time: '2026-06-04', open: 100, high: 105, low: 99, close: 100, volume: 1000 },
          { time: '2026-06-05', open: 100, high: 105, low: 99, close: 102, volume: 1000 }
        ]
      }
    };

    applyLiveTickToKlineChart(mockCtl, inst, { price: 108, volume: 1200, amount: 200000 });
    t.ok(updatedKline);
    t.ok(updatedMA);
    t.equal(inst.klineData.items[4].close, 108);
    t.equal(inst.klineData.items[4].high, 108);
  });
});

QUnit.module('ChartRowManager', () => {
  QUnit.test('initializes and manages instance states', (t) => {
    const instances = new Map();
    const mgr = new ChartRowManager({
      prefix: 'test-',
      hasIntraday: true,
      getChartInstances: () => instances,
      isExpanded: (code) => instances.has(code)
    });

    const inst = createChartState('1d');
    instances.set('sh600519', inst);

    t.equal(mgr.getInst('sh600519'), inst);
    t.equal(mgr.isExpanded('sh600519'), true);
    t.equal(mgr.isExpanded('sh600000'), false);
  });

  QUnit.test('destroyCharts aborts in-flight kline and intraday requests and cleans up ctls', (t) => {
    const instances = new Map();
    const mgr = new ChartRowManager({
      prefix: 'test-',
      hasIntraday: true,
      getChartInstances: () => instances,
      isExpanded: (code) => instances.has(code)
    });

    let klineAborted = false;
    let intradayAborted = false;
    let klineDestroyed = false;
    let intradayDestroyed = false;

    const inst = createChartState('1d');
    inst.abort = {
      abort: () => { klineAborted = true; }
    };
    inst.intradayAbort = {
      abort: () => { intradayAborted = true; }
    };
    instances.set('sh600519', inst);

    mgr.klineCtlMap.set('sh600519', {
      destroy: () => { klineDestroyed = true; }
    });
    mgr.intradayCtlMap.set('sh600519', {
      destroy: () => { intradayDestroyed = true; }
    });

    mgr.destroyCharts('sh600519');

    t.ok(klineAborted, 'inst.abort.abort() was called');
    t.ok(intradayAborted, 'inst.intradayAbort.abort() was called');
    t.equal(inst.abort, null, 'inst.abort cleared');
    t.equal(inst.intradayAbort, null, 'inst.intradayAbort cleared');
    t.ok(klineDestroyed, 'klineCtl destroyed');
    t.ok(intradayDestroyed, 'intradayCtl destroyed');
    t.notOk(mgr.klineCtlMap.has('sh600519'), 'klineCtl deleted from map');
    t.notOk(mgr.intradayCtlMap.has('sh600519'), 'intradayCtl deleted from map');
  });
});
