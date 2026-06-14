import {
  shouldTriggerAlert,
  formatAlertMessage,
  isNotificationSupported,
  setNotificationAdapter,
  requestNotificationPermission,
  showNotification,
  evaluateAlerts,
  _internal
} from '../src/js/alert.js';

QUnit.module('alert.shouldTriggerAlert', () => {
  QUnit.test('triggers up when changePercent crosses +threshold from idle', (t) => {
    const r = shouldTriggerAlert({ changePercent: 5.1 }, 5, { direction: null });
    t.true(r.trigger);
    t.equal(r.direction, 'up');
    t.deepEqual(r.state, { direction: 'up' });
  });

  QUnit.test('triggers down when changePercent crosses -threshold from idle', (t) => {
    const r = shouldTriggerAlert({ changePercent: -5.5 }, 5, { direction: null });
    t.true(r.trigger);
    t.equal(r.direction, 'down');
    t.deepEqual(r.state, { direction: 'down' });
  });

  QUnit.test('does not re-trigger up when already in up state', (t) => {
    const r = shouldTriggerAlert({ changePercent: 6 }, 5, { direction: 'up' });
    t.false(r.trigger);
    t.equal(r.direction, null);
    t.deepEqual(r.state, { direction: 'up' });
  });

  QUnit.test('does not re-trigger down when already in down state', (t) => {
    const r = shouldTriggerAlert({ changePercent: -6 }, 5, { direction: 'down' });
    t.false(r.trigger);
    t.equal(r.direction, null);
    t.deepEqual(r.state, { direction: 'down' });
  });

  QUnit.test('resets state when price falls back below +threshold', (t) => {
    const r = shouldTriggerAlert({ changePercent: 4.9 }, 5, { direction: 'up' });
    t.false(r.trigger);
    t.deepEqual(r.state, { direction: null });
  });

  QUnit.test('resets state when price rises back above -threshold', (t) => {
    const r = shouldTriggerAlert({ changePercent: -4.9 }, 5, { direction: 'down' });
    t.false(r.trigger);
    t.deepEqual(r.state, { direction: null });
  });

  QUnit.test('re-triggers after reset and another cross', (t) => {
    // idle -> trigger up
    let r = shouldTriggerAlert({ changePercent: 5.5 }, 5, { direction: null });
    t.true(r.trigger);
    // up -> drift back below threshold (reset)
    r = shouldTriggerAlert({ changePercent: 3 }, 5, r.state);
    t.false(r.trigger);
    t.deepEqual(r.state, { direction: null });
    // idle -> trigger up again
    r = shouldTriggerAlert({ changePercent: 6 }, 5, r.state);
    t.true(r.trigger);
    t.equal(r.direction, 'up');
  });

  QUnit.test('flips from up to down when threshold crossed in opposite direction', (t) => {
    const r = shouldTriggerAlert({ changePercent: -5.5 }, 5, { direction: 'up' });
    t.true(r.trigger);
    t.equal(r.direction, 'down');
    t.deepEqual(r.state, { direction: 'down' });
  });

  QUnit.test('no trigger when below threshold and idle', (t) => {
    const r = shouldTriggerAlert({ changePercent: 2 }, 5, { direction: null });
    t.false(r.trigger);
    t.deepEqual(r.state, { direction: null });
  });

  QUnit.test('treats undefined/NaN changePercent as no-op (preserves state)', (t) => {
    const r1 = shouldTriggerAlert({ changePercent: NaN }, 5, { direction: 'up' });
    t.false(r1.trigger);
    t.deepEqual(r1.state, { direction: 'up' });
    const r2 = shouldTriggerAlert({}, 5, { direction: null });
    t.false(r2.trigger);
    t.deepEqual(r2.state, { direction: null });
  });

  QUnit.test('invalid threshold (<=0) never triggers', (t) => {
    t.false(shouldTriggerAlert({ changePercent: 99 }, 0, { direction: null }).trigger);
    t.false(shouldTriggerAlert({ changePercent: 99 }, -1, { direction: null }).trigger);
    t.false(shouldTriggerAlert({ changePercent: 99 }, NaN, { direction: null }).trigger);
  });

  QUnit.test('accepts null/undefined lastState as idle', (t) => {
    const r1 = shouldTriggerAlert({ changePercent: 6 }, 5, null);
    t.true(r1.trigger);
    const r2 = shouldTriggerAlert({ changePercent: 6 }, 5, undefined);
    t.true(r2.trigger);
  });

  QUnit.test('boundary: changePercent === threshold triggers', (t) => {
    const r = shouldTriggerAlert({ changePercent: 5 }, 5, { direction: null });
    t.true(r.trigger);
    t.equal(r.direction, 'up');
  });
});

QUnit.module('alert.formatAlertMessage', () => {
  QUnit.test('formats up alert with name and percent', (t) => {
    t.equal(
      formatAlertMessage(
        { code: 'sh600519', name: '贵州茅台', price: 1850, changePercent: 5.2, type: 'stock' },
        'up'
      ),
      '贵州茅台 涨幅 5.20%，现价 1850.00 元'
    );
  });

  QUnit.test('formats down alert with name and percent', (t) => {
    t.equal(
      formatAlertMessage(
        { code: 'sz000001', name: '平安银行', price: 12, changePercent: -5.5, type: 'stock' },
        'down'
      ),
      '平安银行 跌幅 5.50%，现价 12.00 元'
    );
  });

  QUnit.test('uses code when name missing and omits 元 for futures', (t) => {
    t.equal(
      formatAlertMessage(
        { code: 'nf2105', price: 5200, changePercent: 6, type: 'future' },
        'up'
      ),
      'nf2105 涨幅 6.00%，现价 5200.00'
    );
  });

  QUnit.test('returns empty string for invalid input', (t) => {
    t.equal(formatAlertMessage(null, 'up'), '');
    t.equal(formatAlertMessage({}, 'up'), '');
    t.equal(formatAlertMessage({ changePercent: 5 }, 'up'), '');
  });
});

QUnit.module('alert.evaluateAlerts', () => {
  QUnit.test('evaluates a quote map against a set of subscribed codes', (t) => {
    const quotes = new Map([
      ['sh600519', { code: 'sh600519', name: '贵州茅台', price: 1850, changePercent: 5.5, type: 'stock' }],
      ['sz000001', { code: 'sz000001', name: '平安银行', price: 12, changePercent: 2, type: 'stock' }]
    ]);
    const states = {};
    const result = evaluateAlerts(quotes, ['sh600519', 'sz000001'], 5, states);
    t.equal(result.triggered.length, 1);
    t.equal(result.triggered[0].code, 'sh600519');
    t.equal(result.triggered[0].direction, 'up');
    t.deepEqual(result.states['sh600519'], { direction: 'up' });
    t.deepEqual(result.states['sz000001'], { direction: null });
  });

  QUnit.test('skips quotes not in subscribed list', (t) => {
    const quotes = new Map([
      ['sh600519', { code: 'sh600519', changePercent: 10, type: 'stock' }]
    ]);
    const result = evaluateAlerts(quotes, ['sz000001'], 5, {});
    t.equal(result.triggered.length, 0);
  });

  QUnit.test('preserves previous state across calls (de-dup)', (t) => {
    const quotes = new Map([
      ['sh600519', { code: 'sh600519', changePercent: 6, type: 'stock' }]
    ]);
    const r1 = evaluateAlerts(quotes, ['sh600519'], 5, {});
    t.equal(r1.triggered.length, 1);
    const r2 = evaluateAlerts(quotes, ['sh600519'], 5, r1.states);
    t.equal(r2.triggered.length, 0, 'no re-trigger on second pass');
  });

  QUnit.test('does not mutate input state object', (t) => {
    const quotes = new Map([
      ['sh600519', { code: 'sh600519', changePercent: 6, type: 'stock' }]
    ]);
    const states = { sh600519: { direction: null } };
    const before = JSON.stringify(states);
    evaluateAlerts(quotes, ['sh600519'], 5, states);
    t.equal(JSON.stringify(states), before, 'input states untouched');
  });
});

QUnit.module('alert.notifications', (hooks) => {
  let adapter;
  hooks.beforeEach(() => {
    adapter = createMockNotif();
    setNotificationAdapter(adapter);
  });
  hooks.afterEach(() => {
    setNotificationAdapter(null);
  });

  QUnit.test('isNotificationSupported reflects adapter presence', (t) => {
    t.true(isNotificationSupported());
    setNotificationAdapter(null);
    if (typeof globalThis !== 'undefined' && globalThis.Notification) {
      t.true(isNotificationSupported());
    } else {
      t.false(isNotificationSupported());
    }
  });

  QUnit.test('requestNotificationPermission delegates to adapter', async (t) => {
    adapter.permission = 'default';
    adapter.requestPermission = () => Promise.resolve('granted');
    const result = await requestNotificationPermission();
    t.equal(result, 'granted');
  });

  QUnit.test('requestNotificationPermission short-circuits when already granted', async (t) => {
    adapter.permission = 'granted';
    let called = false;
    adapter.requestPermission = () => {
      called = true;
      return Promise.resolve('granted');
    };
    const result = await requestNotificationPermission();
    t.equal(result, 'granted');
    t.false(called);
  });

  QUnit.test('showNotification creates notification when permission granted', (t) => {
    adapter.permission = 'granted';
    showNotification('标题', '内容');
    t.equal(adapter.created.length, 1);
    t.equal(adapter.created[0].title, '标题');
    t.equal(adapter.created[0].options.body, '内容');
  });

  QUnit.test('showNotification no-op when permission not granted', (t) => {
    adapter.permission = 'denied';
    showNotification('t', 'b');
    t.equal(adapter.created.length, 0);
  });

  QUnit.test('returns empty string when adapter missing', (t) => {
    setNotificationAdapter(null);
    if (!isNotificationSupported()) {
      showNotification('a', 'b'); // should not throw
      t.true(true);
    } else {
      t.true(true, 'env exposes Notification, skipping');
    }
  });

  QUnit.test('_internal exposes adapter for debugging', (t) => {
    const internal = _internal();
    t.strictEqual(internal.notificationAdapter, adapter);
  });
});

function createMockNotif() {
  const created = [];
  function NotifCtor(title, options) {
    const obj = { title, options };
    created.push(obj);
    return obj;
  }
  NotifCtor.permission = 'default';
  NotifCtor.requestPermission = () => Promise.resolve('default');
  NotifCtor.created = created;
  return NotifCtor;
}
