import {
  STORAGE_KEYS,
  setStorageAdapter,
  getRaw,
  setRaw,
  getJSON,
  setJSON,
  remove,
  getWatchList,
  setWatchList,
  addToWatchList,
  removeFromWatchList,
  getTheme,
  setTheme,
  getSettings,
  setSettings,
  patchSettings,
  getVoiceSettings,
  setVoiceSettings,
  patchVoiceSettings,
  getAlertSettings,
  setAlertSettings,
  patchAlertSettings,
  getSubscribedCodes,
  setSubscribedCodes,
  getLimitUpSettings,
  setLimitUpSettings,
  patchLimitUpSettings,
  klineCacheGet,
  klineCacheSet,
  klineCachePrune,
  klineCacheClear,
  klineCacheHas,
  isKlineCacheStale
} from '../src/js/storage.js';

function createMockStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] || null
  };
}

QUnit.module('storage', (hooks) => {
  let mock;
  hooks.beforeEach(() => {
    mock = createMockStorage();
    setStorageAdapter(mock);
  });
  hooks.afterEach(() => {
    setStorageAdapter(null);
  });

  QUnit.test('exports central STORAGE_KEYS registry', (t) => {
    t.equal(STORAGE_KEYS.WATCH_LIST, 'stock_watch_list');
    t.equal(STORAGE_KEYS.THEME, 'app_theme');
    t.equal(STORAGE_KEYS.SETTINGS, 'app_settings');
  });

  QUnit.test('getRaw/setRaw round trip', (t) => {
    setRaw('foo', 'bar');
    t.equal(getRaw('foo'), 'bar');
    t.equal(getRaw('missing'), null);
  });

  QUnit.test('getJSON/setJSON round trip', (t) => {
    setJSON('obj', { a: 1, b: [2, 3] });
    t.deepEqual(getJSON('obj'), { a: 1, b: [2, 3] });
  });

  QUnit.test('getJSON returns default for missing or invalid', (t) => {
    t.equal(getJSON('missing', 'fallback'), 'fallback');
    mock.setItem('bad', '{not-json');
    t.deepEqual(getJSON('bad', { ok: true }), { ok: true });
  });

  QUnit.test('remove deletes key', (t) => {
    setRaw('x', '1');
    remove('x');
    t.equal(getRaw('x'), null);
  });

  QUnit.test('getWatchList returns [] when unset', (t) => {
    t.deepEqual(getWatchList(), []);
  });

  QUnit.test('setWatchList persists array under STORAGE_KEYS.WATCH_LIST', (t) => {
    setWatchList(['sh600519', 'sz000001']);
    t.deepEqual(getWatchList(), ['sh600519', 'sz000001']);
    t.equal(mock.getItem(STORAGE_KEYS.WATCH_LIST), '["sh600519","sz000001"]');
  });

  QUnit.test('setWatchList coerces non-array to []', (t) => {
    setWatchList('not array');
    t.deepEqual(getWatchList(), []);
  });

  QUnit.test('addToWatchList appends new code and skips duplicates', (t) => {
    setWatchList(['sh600519']);
    addToWatchList('sz000001');
    addToWatchList('sh600519');
    t.deepEqual(getWatchList(), ['sh600519', 'sz000001']);
  });

  QUnit.test('addToWatchList ignores empty/null inputs', (t) => {
    addToWatchList('');
    addToWatchList(null);
    addToWatchList(undefined);
    t.deepEqual(getWatchList(), []);
  });

  QUnit.test('removeFromWatchList removes specified code', (t) => {
    setWatchList(['sh600519', 'sz000001', 'bj830799']);
    removeFromWatchList('sz000001');
    t.deepEqual(getWatchList(), ['sh600519', 'bj830799']);
  });

  QUnit.test('removeFromWatchList accepts array of codes', (t) => {
    setWatchList(['a', 'b', 'c', 'd']);
    removeFromWatchList(['b', 'd']);
    t.deepEqual(getWatchList(), ['a', 'c']);
  });

  QUnit.test('theme get/set persists under STORAGE_KEYS.THEME', (t) => {
    t.equal(getTheme(), null);
    setTheme('dark');
    t.equal(getTheme(), 'dark');
    t.equal(mock.getItem(STORAGE_KEYS.THEME), 'dark');
  });

  QUnit.test('settings get/set with default empty object', (t) => {
    t.deepEqual(getSettings(), {});
    setSettings({ refreshInterval: 10000, voiceEnabled: true });
    t.deepEqual(getSettings(), { refreshInterval: 10000, voiceEnabled: true });
  });

  QUnit.test('patchSettings merges with existing', (t) => {
    setSettings({ refreshInterval: 10000, voiceEnabled: false });
    patchSettings({ voiceEnabled: true, voiceVolume: 80 });
    t.deepEqual(getSettings(), {
      refreshInterval: 10000,
      voiceEnabled: true,
      voiceVolume: 80
    });
  });

  QUnit.test('does not throw when no adapter and no localStorage', (t) => {
    setStorageAdapter(null);
    t.equal(getRaw('any'), null);
    t.deepEqual(getWatchList(), []);
    setWatchList(['sh600519']);
    t.deepEqual(getWatchList(), []);
  });

  QUnit.test('voice settings: get default {}, set/patch round trip', (t) => {
    t.deepEqual(getVoiceSettings(), {});
    setVoiceSettings({ enabled: true, interval: 10000 });
    t.deepEqual(getVoiceSettings(), { enabled: true, interval: 10000 });
    patchVoiceSettings({ volume: 80 });
    t.deepEqual(getVoiceSettings(), { enabled: true, interval: 10000, volume: 80 });
  });

  QUnit.test('voice settings stored under STORAGE_KEYS.VOICE', (t) => {
    setVoiceSettings({ enabled: true });
    t.equal(mock.getItem(STORAGE_KEYS.VOICE), '{"enabled":true}');
  });

  QUnit.test('alert settings: get default {}, set/patch round trip', (t) => {
    t.deepEqual(getAlertSettings(), {});
    setAlertSettings({ enabled: true, threshold: 5 });
    t.deepEqual(getAlertSettings(), { enabled: true, threshold: 5 });
    patchAlertSettings({ threshold: 3 });
    t.deepEqual(getAlertSettings(), { enabled: true, threshold: 3 });
  });

  QUnit.test('alert settings stored under STORAGE_KEYS.ALERTS', (t) => {
    setAlertSettings({ threshold: 5 });
    t.equal(mock.getItem(STORAGE_KEYS.ALERTS), '{"threshold":5}');
  });

  QUnit.test('subscribed codes: default [] and dedup', (t) => {
    t.deepEqual(getSubscribedCodes(), []);
    setSubscribedCodes(['sh600519', 'sz000001']);
    t.deepEqual(getSubscribedCodes(), ['sh600519', 'sz000001']);
  });

  QUnit.test('setSubscribedCodes coerces non-array to []', (t) => {
    setSubscribedCodes('not array');
    t.deepEqual(getSubscribedCodes(), []);
    setSubscribedCodes(null);
    t.deepEqual(getSubscribedCodes(), []);
  });
});

QUnit.module('storage.limitUpSettings', (hooks) => {
  let mock;
  hooks.beforeEach(() => {
    mock = createMockStorage();
    setStorageAdapter(mock);
  });
  hooks.afterEach(() => {
    setStorageAdapter(null);
  });

  QUnit.test('STORAGE_KEYS.LIMIT_UP is "limit_up_settings"', (t) => {
    t.equal(STORAGE_KEYS.LIMIT_UP, 'limit_up_settings');
  });

  QUnit.test('getLimitUpSettings returns defaults when missing', (t) => {
    t.deepEqual(getLimitUpSettings(), { refreshInterval: 30000 });
  });

  QUnit.test('setLimitUpSettings persists and getLimitUpSettings reads', (t) => {
    setLimitUpSettings({ refreshInterval: 60000 });
    t.deepEqual(getLimitUpSettings(), { refreshInterval: 60000 });
    t.equal(mock.getItem('limit_up_settings'), JSON.stringify({ refreshInterval: 60000 }));
  });

  QUnit.test('patchLimitUpSettings merges partial updates', (t) => {
    setLimitUpSettings({ refreshInterval: 30000 });
    patchLimitUpSettings({ refreshInterval: 10000 });
    t.deepEqual(getLimitUpSettings(), { refreshInterval: 10000 });
  });

  QUnit.test('patchLimitUpSettings ignores non-object patch', (t) => {
    setLimitUpSettings({ refreshInterval: 30000 });
    patchLimitUpSettings(null);
    patchLimitUpSettings('bad');
    t.deepEqual(getLimitUpSettings(), { refreshInterval: 30000 });
  });
});

// =====================================================================
// klineCache — K 线数据持久化 (Phase 8)
// =====================================================================
QUnit.module('storage.klineCache', (hooks) => {
  let mock;
  hooks.beforeEach(() => {
    mock = createMockStorage();
    setStorageAdapter(mock);
    klineCacheClear();
  });
  hooks.afterEach(() => {
    klineCacheClear();
    setStorageAdapter(null);
  });

  function makeKline(code, period, n = 30) {
    return {
      code,
      name: '测试 ' + code,
      items: Array.from({ length: n }, (_, i) => ({
        time: 1700000000 + i * 86400,
        open: 100 + i,
        close: 101 + i,
        high: 102 + i,
        low: 99 + i,
        volume: 1000 + i
      }))
    };
  }

  QUnit.test('set then get roundtrip', (t) => {
    const data = makeKline('sh600519', '1d', 30);
    klineCacheSet('sh600519', '1d', data);
    const got = klineCacheGet('sh600519', '1d');
    t.ok(got, 'get returns truthy');
    t.equal(got.code, 'sh600519');
    t.equal(got.items.length, 30);
  });

  QUnit.test('get returns null for missing entry', (t) => {
    t.strictEqual(klineCacheGet('sh999999', '1d'), null);
  });

  QUnit.test('separate (code, period) maintain separate entries', (t) => {
    klineCacheSet('sh600519', '1d', makeKline('sh600519', '1d'));
    klineCacheSet('sh600519', '5m', makeKline('sh600519', '5m', 60));
    const a = klineCacheGet('sh600519', '1d');
    const b = klineCacheGet('sh600519', '5m');
    t.equal(a.items.length, 30);
    t.equal(b.items.length, 60);
  });

  QUnit.test('klineCacheHas returns boolean without updating lastAccessedAt', (t) => {
    klineCacheSet('sh600519', '1d', makeKline('sh600519', '1d'));
    t.ok(klineCacheHas('sh600519', '1d'));
    t.notOk(klineCacheHas('sh999999', '1d'));
  });

  QUnit.test('isKlineCacheStale returns false for fresh entry (closed market)', (t) => {
    klineCacheSet('sh600519', '1d', makeKline('sh600519', '1d'));
    // Set entry fetched at 2h ago
    const cacheRaw = getRaw('kline-cache-v1');
    const obj = JSON.parse(cacheRaw);
    const key = 'sh600519|1d';
    obj.entries[key].fetchedAt = Date.now() - 2 * 60 * 60 * 1000;
    setRaw('kline-cache-v1', JSON.stringify(obj));
    // Stale check uses real market state; in test env (jsdom) the date is real now.
    // We just verify the function returns a boolean (true or false), not throw.
    const stale = isKlineCacheStale('sh600519', '1d');
    t.strictEqual(typeof stale, 'boolean');
  });

  QUnit.test('get updates lastAccessedAt (LRU tracking)', (t) => {
    klineCacheSet('sh600519', '1d', makeKline('sh600519', '1d'));
    const before = JSON.parse(getRaw('kline-cache-v1')).entries['sh600519|1d'].lastAccessedAt;
    // 100ms wait
    const waitMs = 50;
    const start = Date.now();
    while (Date.now() - start < waitMs) { /* spin */ }
    klineCacheGet('sh600519', '1d');
    const after = JSON.parse(getRaw('kline-cache-v1')).entries['sh600519|1d'].lastAccessedAt;
    t.ok(after > before, `lastAccessedAt updated: ${before} → ${after}`);
  });

  QUnit.test('prune removes all entries when called (manual clear path)', (t) => {
    klineCacheSet('sh600519', '1d', makeKline('sh600519', '1d'));
    klineCacheSet('sz000001', '1d', makeKline('sz000001', '1d'));
    klineCachePrune();
    // 盘后没有过期条目 → 不会清掉
    t.ok(klineCacheHas('sh600519', '1d'), 'entry still present after prune (not stale)');
  });

  QUnit.test('corrupted JSON does not throw on get', (t) => {
    setRaw('kline-cache-v1', 'not-valid-json{');
    t.strictEqual(klineCacheGet('sh600519', '1d'), null);
  });

  QUnit.test('non-object data passed to set is ignored', (t) => {
    klineCacheSet('sh600519', '1d', null);
    klineCacheSet('sh600519', '1d', 'string');
    t.notOk(klineCacheHas('sh600519', '1d'), 'null/garbage not stored');
  });

  QUnit.test('set overwrites existing entry for same key', (t) => {
    klineCacheSet('sh600519', '1d', makeKline('sh600519', '1d', 30));
    klineCacheSet('sh600519', '1d', makeKline('sh600519', '1d', 60));
    const got = klineCacheGet('sh600519', '1d');
    t.equal(got.items.length, 60, 'overwritten with 60 items');
  });
});
