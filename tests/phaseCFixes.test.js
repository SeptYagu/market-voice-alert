import { speak, cancel, setSpeechAdapter, MAX_QUEUE_SIZE, _internal } from '../src/js/tts.js';

QUnit.module('Phase C Defect Fixes (R6 - Voice Queue & Backpressure)', (hooks) => {
  let adapter;
  hooks.beforeEach(() => {
    cancel();
    adapter = {
      calls: [],
      cancelCount: 0,
      speak(u) {
        adapter.calls.push(u);
      },
      cancel() {
        adapter.cancelCount++;
      }
    };
    setSpeechAdapter(adapter);
  });
  hooks.afterEach(() => {
    cancel();
    setSpeechAdapter(null);
  });

  QUnit.test('R6: Native adapter receives at most 1 utterance while speaking; queue bounded at MAX_QUEUE_SIZE', assert => {
    // 80 utterances submitted rapidly while adapter does not finish
    for (let i = 0; i < 80; i++) {
      speak(`quote ${i}`);
    }

    assert.equal(adapter.calls.length, 1, 'native adapter receives only 1 utterance initially');
    assert.equal(adapter.calls[0].text, 'quote 0');
    assert.equal(_internal().queue.length, MAX_QUEUE_SIZE, 'application queue capped at MAX_QUEUE_SIZE');
    assert.equal(_internal().queue[_internal().queue.length - 1].text, 'quote 79');
  });

  QUnit.test('R6: Queue pumps next utterance when previous finishes', assert => {
    speak('first');
    speak('second');
    assert.equal(adapter.calls.length, 1);
    assert.equal(adapter.calls[0].text, 'first');

    // Simulate native utterance completion
    adapter.calls[0].onend();

    assert.equal(adapter.calls.length, 2);
    assert.equal(adapter.calls[1].text, 'second');
  });

  QUnit.test('R6: Same-code quote coalesces in queue', assert => {
    speak('busy playing'); // becomes currently speaking
    speak('茅台 1800', { code: 'sh600519' });
    speak('平安 14', { code: 'sz000001' });
    speak('茅台 1820 (最新)', { code: 'sh600519' }); // should replace earlier 茅台

    assert.equal(_internal().queue.length, 3, 'currently speaking + 2 pending items');
    const pendingMoutai = _internal().queue.find(u => u.code === 'sh600519');
    assert.ok(pendingMoutai);
    assert.equal(pendingMoutai.text, '茅台 1820 (最新)', 'coalesced to the newest price');
  });

  QUnit.test('R6: High priority alert jumps to the head of the pending queue', assert => {
    speak('current playing');
    speak('routine 1');
    speak('routine 2');
    speak('🔔 茅台涨幅超5%', { priority: 'high' });

    assert.equal(_internal().queue[1].text, '🔔 茅台涨幅超5%', 'alert jumped to the head of pending queue');
  });

  QUnit.test('M3: Safety timeout triggers synth.cancel() and advances queue', assert => {
    let spokenResult = null;
    speak('stalled speech', {
      onSpoken: (reason) => { spokenResult = reason; }
    });
    speak('next queued item');

    assert.equal(adapter.calls.length, 1);
    assert.equal(adapter.calls[0].text, 'stalled speech');
    assert.equal(adapter.cancelCount, 0);

    // Simulate safety timeout firing on the stalled utterance
    _internal().triggerTimeout();

    assert.equal(adapter.cancelCount, 1, 'adapter cancel() was invoked on safety timeout');
    assert.equal(spokenResult, 'timeout', 'onSpoken callback was notified of timeout');
    assert.equal(adapter.calls.length, 2, 'queue advanced to next item');
    assert.equal(adapter.calls[1].text, 'next queued item');
  });

  QUnit.test('M5: Queue overflow preferentially evicts routine items, protecting high priority alerts', assert => {
    speak('speaking'); // currently speaking
    speak('🔔 关键报警 1', { priority: 'high', code: 'sh600519' });
    speak('🔔 关键报警 2', { priority: 'high', code: 'sz000001' });

    // Rapidly submit routine items until MAX_QUEUE_SIZE is exceeded
    for (let i = 0; i < 60; i++) {
      speak(`routine quote ${i}`);
    }

    assert.equal(_internal().queue.length, MAX_QUEUE_SIZE);
    const alert1 = _internal().queue.find(u => u.text === '🔔 关键报警 1');
    const alert2 = _internal().queue.find(u => u.text === '🔔 关键报警 2');
    assert.ok(alert1, 'first high priority alert was not evicted by routine burst');
    assert.ok(alert2, 'second high priority alert was not evicted by routine burst');
  });

  QUnit.test('M5: Expired items in queue are skipped before dispatching to synthesizer', assert => {
    speak('speaking'); // currently speaking
    speak('expired alert', { expiresAt: Date.now() - 1000 });
    speak('fresh alert');

    assert.equal(adapter.calls.length, 1);

    // Finish current speech
    adapter.calls[0].onend();

    // Next speech should be 'fresh alert', skipping 'expired alert'
    assert.equal(adapter.calls.length, 2);
    assert.equal(adapter.calls[1].text, 'fresh alert');
  });

  QUnit.test('M3: a late callback from the cancelled utterance cannot strand the queue', assert => {
    const seen = [];
    const lateCallbacks = [];
    // Native cancel() makes the browser dispatch onerror for the cancelled utterance later.
    adapter.cancel = () => {
      adapter.cancelCount++;
      const stale = adapter.calls.at(-1);
      lateCallbacks.push(() => { if (typeof stale.onerror === 'function') stale.onerror(); });
    };

    speak('A'.repeat(40), { onSpoken: reason => seen.push(`A:${reason}`) });
    speak('B short', { onSpoken: reason => seen.push(`B:${reason}`) });
    speak('C behind B', { onSpoken: reason => seen.push(`C:${reason}`) });
    assert.equal(adapter.calls.length, 1);

    _internal().triggerTimeout(); // A times out -> cancel() -> B starts
    assert.equal(adapter.cancelCount, 1);
    assert.equal(adapter.calls.length, 2, 'queue advanced to B');
    assert.equal(_internal().getCurrentUtterance().text, 'B short');

    // Now the stale callback from A lands, after B already owns the safety timer.
    for (const fire of lateCallbacks) fire();

    assert.deepEqual(seen, ['A:timeout'], 'only A was reported once');
    assert.equal(_internal().getCurrentUtterance().text, 'B short', 'B is still the active utterance');
    assert.true(_internal().hasSafetyTimer(), 'B still owns a live safety timer');

    _internal().triggerTimeout(); // B's own timeout must still be wired
    assert.deepEqual(seen, ['A:timeout', 'B:timeout'], 'B could still time out');
    assert.equal(adapter.calls.length, 3, 'queue advanced to C');
    assert.equal(adapter.calls[2].text, 'C behind B', 'the queue is not stranded');
  });

  QUnit.test('M3: synth.cancel() invoking onerror re-entrantly still reports exactly once', assert => {
    const seen = [];
    adapter.cancel = () => {
      adapter.cancelCount++;
      // Worst case: the browser calls back synchronously inside cancel().
      const stale = adapter.calls.at(-1);
      if (typeof stale.onerror === 'function') stale.onerror();
    };

    speak('stalled one', { onSpoken: reason => seen.push(`1:${reason}`) });
    speak('stalled two', { onSpoken: reason => seen.push(`2:${reason}`) });

    _internal().triggerTimeout(); // re-entrant onerror during cancel()

    assert.deepEqual(seen, ['1:timeout'], 'one notification only, and it is the timeout');
    assert.equal(adapter.calls.length, 2, 'queue advanced to the second item');
    assert.equal(_internal().getCurrentUtterance().text, 'stalled two');
    assert.true(_internal().hasSafetyTimer(), 'second item kept its own safety timer');
  });

  QUnit.test('M3: every terminal path notifies onSpoken exactly once', assert => {
    const seen = [];
    const adapter2 = { calls: [], cancel() {}, speak(u) { adapter2.calls.push(u); } };
    setSpeechAdapter(adapter2);

    speak('played', { onSpoken: reason => seen.push(`played:${reason}`) });
    adapter2.calls[0].onend();
    adapter2.calls[0].onend(); // duplicate events must not double-report
    assert.deepEqual(seen, ['played:end']);

    speak('expired before speaking', { expiresAt: Date.now() - 1, onSpoken: reason => seen.push(`expired:${reason}`) });
    speak('after expired', { onSpoken: reason => seen.push(`after:${reason}`) });
    assert.deepEqual(seen, ['played:end', 'expired:expired'], 'expired item is reported');
    assert.equal(adapter2.calls[1].text, 'after expired');

    speak('coalesced old', { code: 'sh600519', onSpoken: reason => seen.push(`old:${reason}`) });
    speak('coalesced new', { code: 'sh600519', onSpoken: reason => seen.push(`new:${reason}`) });
    assert.ok(seen.includes('old:replaced'), 'coalesced-away item is reported as replaced');

    setSpeechAdapter(adapter);
  });
});
