import { createVoiceController } from '../src/js/controllers/voiceController.js';
import { isLiveTradeDate } from '../src/js/marketSession.js';

function harness(codes = ['sh600000'], overrides = {}) {
  let now = new Date('2026-09-09T10:00:00+08:00');
  let settings = { enabled: true, interval: 5000, volume: 60,
    fields: { name: true, price: true, percent: true }, smartSchedule: { enabled: true } };
  const quotes = new Map(codes.map(code => [code, { code, name: code, price: 10, changePercent: 1 }]));
  const spoken = [];
  const timers = new Map();
  let nextId = 0;
  // Models the real device contract: the text is played and completion is reported
  // back through onSpoken('end'), which is what the dedup memory keys off.
  const defaultSpeak = (text, opts) => {
    spoken.push(text);
    if (opts && typeof opts.onSpoken === 'function') opts.onSpoken('end');
  };
  const controller = createVoiceController({ getCodes: () => codes, getQuotes: () => quotes,
    getSettings: () => settings, saveSettings: patch => { settings = { ...settings, ...patch }; },
    getTradingDates: () => [], clock: () => now,
    speech: { supported: () => true, speak: defaultSpeak, cancel() {}, ...(overrides.speech || {}) },
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

  QUnit.test('M5: dedup memory stays empty while playback is not confirmed', assert => {
    const stalled = [];
    const h = harness(['sh600000'], { speech: { speak: text => stalled.push(text) } });
    h.controller.setEnabled(true);
    h.quotes.get('sh600000').price = 11;

    const before = stalled.length;
    h.controller.speakSubscribed();
    const perRound = stalled.length - before;
    assert.true(perRound > 0, 'the level was handed to the device');
    assert.equal(h.controller.inspect().memory.size, 0,
      'nothing was heard yet, so no dedup baseline may be recorded');

    // Because nothing was remembered, the same level must be offered again rather
    // than silently swallowed as "already announced".
    h.controller.speakSubscribed();
    assert.equal(stalled.length - before, perRound * 2, 'the unconfirmed level is retried, not dropped');
    assert.equal(h.controller.inspect().memory.size, 0);

    // Once the device confirms playback, the baseline advances and repeats go quiet.
    h.controller.stop();
    const confirmed = harness(['sh600000']);
    confirmed.controller.setEnabled(true);
    confirmed.quotes.get('sh600000').price = 11;
    confirmed.controller.speakSubscribed();
    assert.equal(confirmed.controller.inspect().memory.size, 1, 'confirmed playback seeds the baseline');
    const beforeRepeat = confirmed.spoken.length;
    confirmed.controller.speakSubscribed();
    assert.equal(confirmed.spoken.length, beforeRepeat, 'unchanged level is silent once remembered');
    confirmed.controller.stop();
  });

  QUnit.test('M5: only a real playback report advances the baseline, not a queue handoff', assert => {
    const handoffs = [];
    let report = null;
    const h = harness(['sh600000'], {
      speech: { speak: (text, opts) => { handoffs.push(text); report = opts && opts.onSpoken; } }
    });
    h.controller.setEnabled(true);
    h.quotes.get('sh600000').price = 11;

    const before = handoffs.length;
    h.controller.speakSubscribed();
    assert.equal(handoffs.length - before, 1, 'one announcement was handed to the device');
    assert.equal(typeof report, 'function', 'the controller passes a completion callback');
    assert.equal(h.controller.inspect().memory.size, 0, 'handoff alone is not playback');

    report('timeout'); // watchdog fired: the listener never heard it
    assert.equal(h.controller.inspect().memory.size, 0, 'a timed-out announcement must not be remembered');

    report('end');
    assert.equal(h.controller.inspect().memory.size, 1, 'a completed announcement is remembered');
    h.controller.stop();
  });

  QUnit.test('M5: legacy adapter opts in explicitly before seeding memory synchronously', assert => {
    const spoken = [];
    const h = harness(['sh600000'], {
      speech: { syncMemory: true, speak: text => spoken.push(text) }
    });
    h.controller.setEnabled(true);
    h.quotes.get('sh600000').price = 11;
    h.controller.speakSubscribed();
    assert.equal(h.controller.inspect().memory.size, 1, 'the explicit opt-in still seeds the baseline');
    h.controller.stop();
  });

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
