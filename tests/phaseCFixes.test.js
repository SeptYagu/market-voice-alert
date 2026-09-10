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
});
