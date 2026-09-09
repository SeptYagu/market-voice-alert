import { fetchKline, onKlineUpdated, clearKlineRevalidateThrottle } from '../src/js/api.js';
import { klineCacheGet, klineCacheSet, klineCacheClear, setStorageAdapter } from '../src/js/storage.js';
import { getFuturesSession } from '../src/js/futures/session.js';
import { limitUpRowsMatchDom } from '../src/js/controllers/limitUpController.js';
import { renderLimitUpPage } from '../src/js/limitUpView.js';
import { getVoiceEligibleCodes } from '../src/js/marketSession.js';
import { createMomentumController } from '../src/js/controllers/momentumController.js';
import { ChartRowManager, createChartState } from '../src/js/controllers/chartRowController.js';

QUnit.module('September 9 follow-up review', (hooks) => {
  hooks.beforeEach(() => {
    const map = new Map();
    setStorageAdapter({ getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v),
      removeItem: k => map.delete(k), key: i => [...map.keys()][i], get length() { return map.size; } });
    clearKlineRevalidateThrottle();
  });
  hooks.afterEach(() => { klineCacheClear(); setStorageAdapter(null); });
  QUnit.test('Voice eligibility respects disabled schedule and mixed night subscriptions', (assert) => {
    const codes = ['sh600000', 'nf_RB0', 'nf_T0'];
    const now = new Date('2026-09-09T21:30:00+08:00');
    assert.deepEqual(getVoiceEligibleCodes(codes, { enabled: false }, now), codes);
    assert.deepEqual(getVoiceEligibleCodes(codes, { enabled: true }, now), ['nf_RB0']);
  });

  for (const outcome of ['success', 'failure', 'abort']) {
    QUnit.test(`Production momentum controller ignores old ${outcome} after restart`, async (assert) => {
      const oldFetch = globalThis.fetch;
      const pending = [];
      globalThis.fetch = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
      const momentum = { items: [], pinnedCodes: new Set(), loading: false };
      const controller = createMomentumController({ getState: () => ({ momentum }), momentumChartMgr: {} });
      try {
        const first = controller.handleScan();
        controller.stopScan();
        const second = controller.handleScan();
        const owner = momentum.abort;
        const snapshot = { ...momentum };
        if (outcome === 'success') pending[0].resolve({ ok: true, json: async () => ({ ok: true }) });
        else pending[0].reject(outcome === 'abort' ? new DOMException('Aborted', 'AbortError') : new Error('old error'));
        await first;
        assert.deepEqual(momentum, snapshot, 'Old task cannot mutate any new scan state');
        assert.strictEqual(momentum.abort, owner);
        assert.true(momentum.loading);
        controller.stopScan();
        pending[1].reject(new DOMException('Aborted', 'AbortError'));
        await second;
      } finally {
        controller.stopScan();
        globalThis.fetch = oldFetch;
      }
    });
  }

  QUnit.test('Production chart manager cannot write into a reopened chart', async (assert) => {
    const oldFetch = globalThis.fetch;
    let complete;
    globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
    const code = 'sh600099';
    const instances = new Map([[code, createChartState()]]);
    let writes = 0;
    const manager = new ChartRowManager({ hasIntraday: false, getChartInstances: () => instances, isExpanded: () => true });
    manager.klineCtlMap.set(code, { setKline() { writes++; }, setVolume() {}, clearMA() {}, destroy() {} });
    try {
      const loading = manager.loadKline(code, { force: true });
      const replacement = createChartState();
      instances.set(code, replacement);
      complete({ ok: true, json: async () => ({ data: { code: '600099', name: 'A',
        klines: ['2026-09-08,10,10,11,9,100,1000,0'] } }) });
      await loading;
      assert.equal(writes, 0, 'No data is sent to the current chart controller');
      assert.strictEqual(replacement.klineData, null);
      assert.true(replacement.loading, 'Old completion leaves the new loading state intact');
    } finally {
      manager.destroyAll();
      globalThis.fetch = oldFetch;
    }
  });

  QUnit.test('Friday holiday night and Saturday continuation share permission', (assert) => {
    const dates = ['2026-09-10', '2026-09-11', '2026-09-15'];
    assert.false(getFuturesSession('AU0', new Date('2026-09-11T21:30:00+08:00'), dates).isTrading);
    assert.false(getFuturesSession('AU0', new Date('2026-09-12T01:00:00+08:00'), dates).isTrading,
      'No Saturday continuation when Friday night was closed');
    assert.true(getFuturesSession('AU0', new Date('2026-09-12T01:00:00+08:00'),
      ['2026-09-11', '2026-09-14']).isTrading, 'Ordinary weekend retains Friday night');
  });

  QUnit.test('Pinned rows must follow the current pinned sort', (assert) => {
    const a = { code: 'sh600000', name: 'A', amount: 200, price: 10, changePercent: 10 };
    const b = { ...a, code: 'sh600001', name: 'B', amount: 100 };
    const state = { items: [a, b], groups: [{ key: '1', items: [a, b] }],
      pinnedCodes: new Set([a.code, b.code]), selectedCodes: new Set(),
      expandedCodes: new Set(), chartInstances: new Map(), sortKey: 'amount' };
    const root = document.createElement('div');
    renderLimitUpPage(root, state, { navigateTo() {}, addToWatchListAndNavigate() {},
      onRefreshChange() {}, fetchList() {}, sortGroup() {}, onLiveTickUpdate() {} });
    const section = root.querySelector('#lu-groups');
    assert.true(limitUpRowsMatchDom(section, state.groups, state.items, state.pinnedCodes));
    b.amount = 300;
    assert.false(limitUpRowsMatchDom(section, state.groups, state.items, state.pinnedCodes),
      'A quote changing pinned order must trigger structural refresh');
  });

  for (const source of ['ordinary', 'SWR']) {
  QUnit.test(`Older ${source} response cannot overwrite a completed force refresh`, async (assert) => {
    const oldFetch = globalThis.fetch;
    const pending = [];
    const emitted = [];
    const unsubscribe = onKlineUpdated((code, period, data) => emitted.push(data.items[0].close));
    globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
    const reply = (close) => ({ ok: true, json: async () => ({ data: { code: '600000', name: 'A',
      klines: [`2026-09-08,10,${close},12,9,100,1000,0`] } }) });
    try {
      if (source === 'SWR') klineCacheSet('sh600000', '1d', { code: 'sh600000', items: [{ close: 9 }] });
      const ordinary = fetchKline('sh600000');
      if (source === 'SWR') await new Promise(resolve => setTimeout(resolve, 0));
      const forced = fetchKline('sh600000', { force: true });
      assert.equal(pending.length, 2, 'Force starts its own network request');
      pending[1](reply(12));
      await forced;
      pending[0](reply(10));
      await ordinary;
      if (source === 'SWR') await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(klineCacheGet('sh600000', '1d').items[0].close, 12);
      assert.deepEqual(emitted, [12], 'Stale response must not broadcast into current charts');
    } finally {
      unsubscribe();
      globalThis.fetch = oldFetch;
      klineCacheClear();
      setStorageAdapter(null);
    }
  });
  }
});
