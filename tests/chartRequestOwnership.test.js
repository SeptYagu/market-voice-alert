import { ChartRowManager, createChartState } from '../src/js/controllers/chartRowController.js';

QUnit.module('Chart request ownership', () => {
  for (const kind of ['period', 'date', 'destroy']) {
    QUnit.test(`late response after ${kind} change cannot publish`, async assert => {
      const originalFetch = globalThis.fetch;
      const pending = [];
      globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
      const code = 'sh600777';
      const inst = createChartState();
      const instances = new Map([[code, inst]]);
      const writes = [];
      const manager = new ChartRowManager({ getChartInstances: () => instances,
        isExpanded: () => true, hasIntraday: kind === 'date' });
      manager.intradayCtlMap.set(code, { setData: data => writes.push(data[0].price), destroy() {} });
      manager.klineCtlMap.set(code, { setKline: data => writes.push(data[0].close),
        setVolume() {}, clearMA() {}, destroy() {} });
      const response = value => ({ ok: true, json: async () => ({ ok: true, data: { code,
        name: 'A', items: [{ time: '2026-09-08', price: value, open: value, close: value, high: value, low: value, volume: 1 }] } }) });
      try {
        const first = kind === 'date' ? manager.loadIntraday(code, '2026-09-08') : manager.loadKline(code);
        // Responses deliberately ignore abort, modelling an already-delivered result.
        if (kind === 'destroy') {
          manager.destroyAll();
          pending[0](response(10));
          await first;
          assert.deepEqual(writes, []);
          assert.strictEqual(inst.klineData, null);
        } else {
          if (kind === 'period') inst.period = '1w';
          const second = kind === 'date' ? manager.loadIntraday(code, '2026-09-09') : manager.loadKline(code);
          pending[1](response(12));
          await second;
          pending[0](response(10));
          await first;
          assert.deepEqual(writes, [12]);
          assert.equal(kind === 'date' ? inst.intradayData.items[0].price : inst.klineData.items[0].close, 12);
        }
      } finally {
        manager.destroyAll();
        globalThis.fetch = originalFetch;
      }
    });
  }
});
