import { createVoiceController } from '../src/js/controllers/voiceController.js';
import { isLiveTradeDate } from '../src/js/marketSession.js';

function harness(codes = ['sh600000']) {
  let now = new Date('2026-09-09T10:00:00+08:00');
  let settings = { enabled: true, interval: 5000, volume: 60,
    fields: { name: true, price: true, percent: true }, smartSchedule: { enabled: true } };
  const quotes = new Map(codes.map(code => [code, { code, name: code, price: 10, changePercent: 1 }]));
  const spoken = [];
  const timers = new Map();
  let nextId = 0;
  const controller = createVoiceController({ getCodes: () => codes, getQuotes: () => quotes,
    getSettings: () => settings, saveSettings: patch => { settings = { ...settings, ...patch }; },
    getTradingDates: () => [], clock: () => now,
    speech: { supported: () => true, speak: text => spoken.push(text), cancel() {} },
    createWorker: () => { throw new Error('use deterministic timer'); },
    timers: { setInterval: fn => { timers.set(++nextId, fn); return nextId; }, clearInterval: id => timers.delete(id) } });
  return { controller, quotes, spoken, timers, codes, settings: () => settings,
    configure: patch => { settings = { ...settings, ...patch }; },
    at: date => { now = new Date(date); return controller.applySchedule(); } };
}

QUnit.module('Production voice controller', () => {
  QUnit.test('failed Worker postMessage terminates worker before fallback and stop clears queue', assert => {
    let terminated = 0, cancelled = 0;
    const scheduled = new Set();
    const controller = createVoiceController({
      getSettings: () => ({ enabled: true, interval: 1000, volume: 80, smartSchedule: { enabled: false } }),
      saveSettings() {}, getCodes: () => ['sh600000'], getQuotes: () => new Map(), getTradingDates: () => [],
      speech: { supported: () => true, speak() {}, cancel() { cancelled++; } },
      createWorker: () => ({ terminate() { terminated++; }, postMessage() { throw new Error('bootstrap failed'); } }),
      timers: { setInterval: fn => { scheduled.add(fn); return fn; }, clearInterval: fn => scheduled.delete(fn) }
    });
    controller.startTimer();
    assert.equal(terminated, 1);
    assert.equal(scheduled.size, 1);
    controller.stop();
    assert.equal(scheduled.size, 0);
    assert.equal(cancelled, 1);
  });
  QUnit.test('live chart date uses contract and injected holiday calendar', assert => {
    const now = new Date('2026-09-09T23:30:00+08:00');
    const dates = ['2026-09-09', '2026-09-10'];
    assert.false(isLiveTradeDate('2026-09-10', 'RB0', now, dates));
    assert.true(isLiveTradeDate('2026-09-10', 'AU0', now, dates));
    assert.false(isLiveTradeDate('2026-09-10', 'T0', now, dates));
    assert.false(isLiveTradeDate('2026-09-11', 'AU0', now, ['2026-09-09', '2026-09-11']));
  });
  QUnit.test('stock lunch resumes, stock close disables, same-day manual off overrides auction', assert => {
    const h = harness();
    h.controller.applySchedule();
    assert.true(h.at('2026-09-09T11:30:00+08:00').enabled);
    assert.deepEqual(h.spoken, ['中午休市']);
    assert.true(h.at('2026-09-09T13:00:00+08:00').timerShouldRun);
    assert.false(h.at('2026-09-09T15:00:00+08:00').enabled);
    assert.deepEqual(h.spoken, ['中午休市', '已收盘']);
    h.configure({ smartSchedule: { enabled: true, autoStartAuction: true } });
    h.at('2026-09-10T09:20:00+08:00');
    h.controller.setEnabled(false);
    assert.false(h.at('2026-09-10T09:21:00+08:00').enabled);
    assert.true(h.at('2026-09-11T09:20:00+08:00').enabled, 'next-day configured auction remains available');
    h.controller.stop();
    assert.equal(h.timers.size, 0);
  });

  QUnit.test('mixed futures pause across day/night gaps and announce midnight close once', assert => {
    const h = harness(['sh600000', 'nf_RB0', 'nf_AU0', 'nf_T0']);
    h.controller.applySchedule();
    assert.deepEqual(h.at('2026-09-09T15:10:00+08:00').eligibleCodes, ['nf_T0']);
    assert.true(h.at('2026-09-09T15:16:00+08:00').enabled);
    assert.false(h.at('2026-09-09T20:00:00+08:00').timerShouldRun);
    assert.deepEqual(h.at('2026-09-09T21:10:00+08:00').eligibleCodes, ['nf_RB0', 'nf_AU0']);
    assert.deepEqual(h.at('2026-09-09T23:01:00+08:00').eligibleCodes, ['nf_AU0']);
    h.at('2026-09-10T02:31:00+08:00');
    h.at('2026-09-10T02:32:00+08:00');
    assert.deepEqual(h.spoken, ['已收盘', '已收盘'], 'one day-close and one actual final night-close');
    h.controller.setEnabled(false);
    assert.false(h.at('2026-09-10T09:00:00+08:00').timerShouldRun);
    h.controller.stop();
  });

  for (const field of ['price', 'changePercent']) {
    QUnit.test(`real caller merges ${field} deltas and remembers manual speech`, assert => {
      const h = harness();
      h.controller.setEnabled(true);
      h.quotes.get('sh600000')[field] = 11;
      h.controller.speakSubscribed();
      h.controller.speakSubscribed();
      h.controller.speakSubscribed();
      assert.equal(h.spoken.length, 2, 'unchanged rounds are silent');
      h.controller.speakManual('sh600000');
      h.controller.speakSubscribed();
      assert.equal(h.spoken.length, 3, 'manual speech seeds the same dedup memory');
      h.configure({ fields: { name: true, price: false, percent: true } });
      h.controller.resetFields();
      h.controller.speakSubscribed();
      h.configure({ fields: { name: true, price: true, percent: true } });
      h.controller.resetFields();
      h.controller.speakSubscribed();
      assert.true(h.spoken.at(-1).includes('元'), 're-enabled field is announced');
      h.codes.length = 0;
      const spokenBeforeUnsubscribe = h.spoken.length;
      h.controller.applySchedule();
      assert.equal(h.spoken.length, spokenBeforeUnsubscribe, "unsubscribing is not a market close");
      h.controller.prune();
      assert.equal(h.controller.inspect().memory.size, 0);
      h.controller.stop();
    });
  }

  QUnit.test('calendar completion after stop cannot revive timers', async assert => {
    const h = harness();
    let resolve;
    h.controller.start(() => new Promise(r => { resolve = r; }));
    await Promise.resolve();
    h.controller.stop();
    resolve();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(h.timers.size, 0);
    assert.equal(h.controller.inspect().timerCount, 0);
  });
});
