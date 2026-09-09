import { createLimitUpController, buildLimitUpGroupsForState } from '../src/js/controllers/limitUpController.js';
import { ChartRowManager, createChartState } from '../src/js/controllers/chartRowController.js';

QUnit.module('Incremental limit-up lifecycle', () => {
  QUnit.test('reorder, regroup, pin and remove retain surviving chart and row identities', assert => {
    const a = { code: 'sh600000', name: 'A', amount: 200, price: 11, changePercent: 10, limitUpCount: 1 };
    const b = { ...a, code: 'sh600001', name: 'B', amount: 100 };
    const lu = { items: [a, b], groups: [], pinnedCodes: new Set(), selectedCodes: new Set([a.code, b.code]),
      expandedCodes: new Set([a.code, b.code]), chartInstances: new Map([[a.code, createChartState()], [b.code, createChartState()]]) };
    lu.groups = buildLimitUpGroupsForState(lu);
    const root = document.createElement('div'); document.body.append(root);
    const manager = new ChartRowManager({ getChartInstances: () => lu.chartInstances, isExpanded: code => lu.expandedCodes.has(code) });
    let destroyed = 0;
    for (const code of lu.expandedCodes) {
      manager.klineCtlMap.set(code, { destroy() { destroyed++; } });
      manager.intradayCtlMap.set(code, { destroy() { destroyed++; } });
    }
    const controller = createLimitUpController({ getState: () => ({ limitUp: lu }), limitUpChartMgr: manager });
    controller.setRootEl(root);
    try {
      controller.render();
      const row = root.querySelector(`[data-code="${a.code}"]`);
      const chart = root.querySelector(`[data-chart-for="${a.code}"]`);
      const ctl = manager.klineCtlMap.get(a.code);
      b.amount = 300;
      lu.groups = buildLimitUpGroupsForState(lu); controller.render();
      assert.deepEqual([...root.querySelectorAll('[data-group="1"] tr[data-code]')].map(el => el.dataset.code), [b.code, a.code]);
      a.changePercent = 5;
      lu.groups = buildLimitUpGroupsForState(lu); controller.render();
      assert.strictEqual(root.querySelector(`[data-code="${a.code}"]`), row);
      assert.equal(row.closest('[data-group]').dataset.group, 'broken');
      assert.strictEqual(row.nextElementSibling, chart);
      a.changePercent = 10; a.limitUpCount = 2;
      lu.groups = buildLimitUpGroupsForState(lu); controller.render();
      assert.equal(row.closest('[data-group]').dataset.group, '2');
      lu.pinnedCodes.add(a.code); controller.render();
      assert.equal(row.closest('[data-group]').dataset.group, 'pinned');
      assert.strictEqual(manager.klineCtlMap.get(a.code), ctl);
      assert.equal(destroyed, 0);
      lu.items = [a]; lu.groups = buildLimitUpGroupsForState(lu); controller.render();
      assert.equal(destroyed, 2, 'only disappeared code destroys its two charts');
      assert.false(lu.selectedCodes.has(b.code));
      assert.false(lu.expandedCodes.has(b.code));
      assert.false(lu.chartInstances.has(b.code));
      controller.closeAllCharts();
      assert.equal(destroyed, 4);
      assert.equal(root.querySelectorAll('[data-chart-for]').length, 0);
      assert.equal(lu.chartInstances.size + manager.klineCtlMap.size + manager.intradayCtlMap.size, 0);
    } finally { controller.closeAllCharts(); root.remove(); }
  });
});
