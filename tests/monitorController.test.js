import { createMonitorController } from '../src/js/controllers/monitorController.js';

QUnit.module('Production monitor controller', () => {
  QUnit.test('stop/restart and removal ignore old response; timers clean up', async assert => {
    const pending = [];
    const timers = new Map(); let id = 0;
    let saved = ['sh600000'];
    const state = { watchList: [...saved], subscribed: new Set(saved), selected: new Set(saved), alertStates: {},
      quotes: new Map(), autoRefreshEnabled: true, refreshInterval: 5000 };
    const controller = createMonitorController({ getState: () => state,
      fetchQuotes: () => new Promise(resolve => pending.push(resolve)),
      storage: { get: () => [...saved], add: code => saved.push(code), remove: codes => { saved = saved.filter(code => !codes.includes(code)); } },
      timers: { setInterval: fn => { timers.set(++id, fn); return id; }, clearInterval: key => timers.delete(key) } });
    const first = controller.refresh(); controller.stop(); const second = controller.refresh();
    pending[0]([{ code: 'sh600000', price: 9 }]); await first;
    assert.true(state.loading);
    assert.equal(state.quotes.size, 0);
    controller.removeCodes(['sh600000']);
    pending[1]([{ code: 'sh600000', price: 10 }]); await second;
    assert.equal(state.quotes.size, 0, 'removed quote cannot be resurrected');
    assert.deepEqual(controller.addCodes(['sh600001', 'sh600001']), ['sh600001']);
    controller.applySchedule(true); controller.applySchedule(true);
    assert.equal(timers.size, 1);
    controller.applySchedule(false);
    assert.equal(timers.size, 0);
    controller.stop();
    assert.equal(controller.inspect().timerCount, 0);
  });
});
