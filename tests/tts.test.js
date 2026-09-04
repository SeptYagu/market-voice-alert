import {
  formatQuoteSpeech,
  getDefaultVoiceOpts,
  isSpeechSupported,
  setSpeechAdapter,
  speak,
  cancel,
  MAX_QUEUE_SIZE,
  _internal
} from '../src/js/tts.js';

QUnit.module('tts.formatQuoteSpeech', () => {
  QUnit.test('formats stock quote with name, price (元) and percent', (t) => {
    t.equal(
      formatQuoteSpeech({
        code: 'sh600519',
        name: '贵州茅台',
        price: 1850,
        changePercent: 2.35,
        type: 'stock'
      }),
      '贵州茅台，现价 1850.00 元，涨 2.35%'
    );
  });

  QUnit.test('uses 跌 for negative changePercent', (t) => {
    t.equal(
      formatQuoteSpeech({
        code: 'sz000001',
        name: '平安银行',
        price: 14.5,
        changePercent: -1.2,
        type: 'stock'
      }),
      '平安银行,现价 14.50 元,跌 1.20%'.replace(/,/g, '，')
    );
  });

  QUnit.test('uses 持平 when changePercent is 0', (t) => {
    t.equal(
      formatQuoteSpeech({
        code: 'sh600036',
        name: '招商银行',
        price: 35,
        changePercent: 0,
        type: 'stock'
      }),
      '招商银行，现价 35.00 元，持平'
    );
  });

  QUnit.test('omits 元 unit for futures', (t) => {
    t.equal(
      formatQuoteSpeech({
        code: 'nf2105',
        name: '螺纹钢',
        price: 5200,
        changePercent: 0.85,
        type: 'future'
      }),
      '螺纹钢，现价 5200.00，涨 0.85%'
    );
  });

  QUnit.test('falls back to code when name missing', (t) => {
    t.equal(
      formatQuoteSpeech({ code: 'sh600519', price: 100, changePercent: 1, type: 'stock' }),
      'sh600519，现价 100.00 元，涨 1.00%'
    );
  });

  QUnit.test('returns empty string for invalid quote', (t) => {
    t.equal(formatQuoteSpeech(null), '');
    t.equal(formatQuoteSpeech(undefined), '');
    t.equal(formatQuoteSpeech({}), '');
    t.equal(formatQuoteSpeech({ code: 'sh600519' }), '');
    t.equal(formatQuoteSpeech({ price: NaN }), '');
  });

  QUnit.test('handles missing changePercent as 持平', (t) => {
    t.equal(
      formatQuoteSpeech({ code: 'sh600519', name: '茅台', price: 100, type: 'stock' }),
      '茅台，现价 100.00 元，持平'
    );
  });

  QUnit.test('fields={name:false} omits the name segment', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '贵州茅台', price: 1850, changePercent: 2.35, type: 'stock' },
        { name: false }
      ),
      '现价 1850.00 元，涨 2.35%'
    );
  });

  QUnit.test('fields={price:false} omits the price segment', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '贵州茅台', price: 1850, changePercent: 2.35, type: 'stock' },
        { price: false }
      ),
      '贵州茅台，涨 2.35%'
    );
  });

  QUnit.test('fields={percent:false} omits the trend segment', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '贵州茅台', price: 1850, changePercent: 2.35, type: 'stock' },
        { percent: false }
      ),
      '贵州茅台，现价 1850.00 元'
    );
  });

  QUnit.test('returns empty string when all fields disabled', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '贵州茅台', price: 1850, changePercent: 2.35, type: 'stock' },
        { name: false, price: false, percent: false }
      ),
      ''
    );
  });

  QUnit.test('only-name field outputs just the name', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '贵州茅台', price: 1850, changePercent: 2.35, type: 'stock' },
        { name: true, price: false, percent: false }
      ),
      '贵州茅台'
    );
  });

  QUnit.test('treats truthy fields values as enabled (coerces to boolean)', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '茅台', price: 100, changePercent: 1, type: 'stock' },
        { name: 1, price: 'yes', percent: false }
      ),
      '茅台，现价 100.00 元'
    );
  });

  QUnit.test('honors fieldsOrder when provided (reorders output)', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '茅台', price: 100, changePercent: 1, type: 'stock' },
        null,
        ['percent', 'name', 'price']
      ),
      '涨 1.00%，茅台，现价 100.00 元'
    );
  });

  QUnit.test('fieldsOrder respects enabled/disabled fields (filter happens after reorder)', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '茅台', price: 100, changePercent: 1, type: 'stock' },
        { name: true, price: false, percent: true },
        ['percent', 'price', 'name']
      ),
      '涨 1.00%，茅台'
    );
  });

  QUnit.test('fieldsOrder falls back to default for invalid input', (t) => {
    t.equal(
      formatQuoteSpeech(
        { name: '茅台', price: 100, changePercent: 1, type: 'stock' },
        null,
        'bad'
      ),
      '茅台，现价 100.00 元，涨 1.00%'
    );
    t.equal(
      formatQuoteSpeech(
        { name: '茅台', price: 100, changePercent: 1, type: 'stock' },
        null,
        []
      ),
      '茅台，现价 100.00 元，涨 1.00%'
    );
    t.equal(
      formatQuoteSpeech(
        { name: '茅台', price: 100, changePercent: 1, type: 'stock' },
        null,
        ['name', 'price']
      ),
      '茅台，现价 100.00 元，涨 1.00%'
    );
  });
});

QUnit.module('tts.getDefaultVoiceOpts', () => {
  QUnit.test('returns sensible defaults', (t) => {
    const o = getDefaultVoiceOpts();
    t.equal(o.lang, 'zh-CN');
    t.equal(o.rate, 1);
    t.equal(o.pitch, 1);
    t.equal(o.volume, 1);
  });

  QUnit.test('returns a fresh object each call (not frozen reference)', (t) => {
    const a = getDefaultVoiceOpts();
    const b = getDefaultVoiceOpts();
    t.notStrictEqual(a, b);
    a.volume = 0.5;
    t.equal(b.volume, 1);
  });
});

QUnit.module('tts.isSpeechSupported', (hooks) => {
  hooks.afterEach(() => setSpeechAdapter(null));

  QUnit.test('returns true when adapter provided', (t) => {
    setSpeechAdapter({ speak() {}, cancel() {} });
    t.true(isSpeechSupported());
  });

  QUnit.test('returns false when no adapter and no global speechSynthesis', (t) => {
    setSpeechAdapter(null);
    // jsdom usually lacks speechSynthesis; this assertion holds for our test env.
    if (typeof globalThis !== 'undefined' && globalThis.speechSynthesis) {
      t.true(isSpeechSupported(), 'env exposes speechSynthesis');
    } else {
      t.false(isSpeechSupported());
    }
  });
});

QUnit.module('tts.speak/cancel', (hooks) => {
  let adapter;
  hooks.beforeEach(() => {
    adapter = createMockSynth();
    setSpeechAdapter(adapter);
  });
  hooks.afterEach(() => {
    cancel();
    setSpeechAdapter(null);
  });

  QUnit.test('speak forwards text to adapter as SpeechSynthesisUtterance-like object', (t) => {
    speak('你好');
    t.equal(adapter.calls.length, 1);
    t.equal(adapter.calls[0].text, '你好');
    t.equal(adapter.calls[0].lang, 'zh-CN');
  });

  QUnit.test('speak applies user opts (rate/pitch/volume/lang)', (t) => {
    speak('hi', { rate: 1.5, pitch: 0.8, volume: 0.5, lang: 'en-US' });
    const u = adapter.calls[0];
    t.equal(u.rate, 1.5);
    t.equal(u.pitch, 0.8);
    t.equal(u.volume, 0.5);
    t.equal(u.lang, 'en-US');
  });

  QUnit.test('speak ignores empty/whitespace text silently', (t) => {
    speak('');
    speak('   ');
    speak(null);
    speak(undefined);
    t.equal(adapter.calls.length, 0);
  });

  QUnit.test('cancel calls adapter.cancel and clears internal queue', (t) => {
    speak('a');
    speak('b');
    cancel();
    t.equal(adapter.cancelCount, 1);
    t.deepEqual(_internal().queue, []);
  });

  QUnit.test('speak no-op when no adapter and no global speechSynthesis', (t) => {
    setSpeechAdapter(null);
    speak('hello');
    t.equal(adapter.calls.length, 0);
  });

  QUnit.test('queue tracks pending utterances', (t) => {
    speak('first');
    speak('second');
    t.equal(_internal().queue.length, 2);
  });

  QUnit.test('queue does not exceed MAX_QUEUE_SIZE under heavy load', (t) => {
    cancel();
    for (let i = 0; i < 70; i++) {
      speak(`utterance-${i}`);
    }
    t.equal(_internal().queue.length, MAX_QUEUE_SIZE);
    t.equal(_internal().queue[_internal().queue.length - 1].text, 'utterance-69');
  });
});

function createMockSynth() {
  const m = {
    calls: [],
    cancelCount: 0,
    speak(u) {
      m.calls.push(u);
    },
    cancel() {
      m.cancelCount++;
    }
  };
  return m;
}
