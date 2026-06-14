# Phase 4: 涨停看板独立页面 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现独立 Hash 路由的「涨停看板」页面，按连板数分组展示东财涨停股票池。

**Architecture:**
- 新增 4 个 ESM 模块: `router.js`（hash 路由）/ `limitUpApi.js`（东财涨停池 fetch+解析）/ `limitUp.js`（纯函数逻辑）/ `limitUpView.js`（UI 渲染）
- 修改 5 个文件: `index.html`（nav）/ `app.js`（startApp 路由化 + renderMonitorPage 拆分）/ `storage.js`（LIMIT_UP 注册表）/ `vite.config.js`（/api/limit-up 代理）/ `style.css`（.lu-* 样式）
- TDD 流程：先写失败测试 → 实现最小代码 → 测试通过
- 验证：每个任务结束运行 `npm run lint && npm test`，最后运行 `npm run build`

**Tech Stack:** Vanilla JS (ESM) + Vite 5 + QUnit 2 + ESLint 8

**测试框架:** QUnit（项目现有约定，不用 vitest）。`package.json` 中 `vite.config.js` 内的 `test:` 块是历史残留，实际跑测试靠 `qunit "tests/**/*.test.js"`。

**Git 说明:** 项目当前不是 git 仓库（`Is directory a git repo: no`）。本计划不包含 git commit 步骤；如需后续可 `git init`。每任务以"运行测试"作为完成标志。

**设计参考:** `docs/plans/2026-06-05-phase4-limit-up-board-design.md`

---

## Task 1: 扩展 storage.js 添加 LIMIT_UP 注册表与函数

**Files:**
- Modify: `src/js/storage.js:1-7` (STORAGE_KEYS)
- Modify: `src/js/storage.js` (末尾添加新函数)
- Test: `tests/storage.test.js` (末尾添加新 module)

**Step 1: 写失败测试**

在 `tests/storage.test.js` 末尾添加：

```js
import {
  STORAGE_KEYS,
  setStorageAdapter,
  getJSON,
  setJSON,
  getLimitUpSettings,
  setLimitUpSettings,
  patchLimitUpSettings
} from '../src/js/storage.js';

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
    t.equal(getJSON('limit_up_settings'), JSON.stringify({ refreshInterval: 60000 }));
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
```

**Step 2: 运行测试验证失败**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | grep -A2 "limitUpSettings"
```

期望：FAIL（`getLimitUpSettings is not defined`）

**Step 3: 修改 storage.js**

在 `STORAGE_KEYS` 中追加一行（line 7 之后）：

```js
export const STORAGE_KEYS = Object.freeze({
  WATCH_LIST: 'stock_watch_list',
  THEME: 'app_theme',
  SETTINGS: 'app_settings',
  VOICE: 'voice_settings',
  ALERTS: 'price_alerts',
  LIMIT_UP: 'limit_up_settings'
});
```

在 `setSubscribedCodes` 之后（文件末尾）追加：

```js
export const DEFAULT_LIMIT_UP_SETTINGS = Object.freeze({
  refreshInterval: 30000
});

export function normalizeLimitUpSettings(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const raw = Number(src.refreshInterval);
  const allowed = [10000, 30000, 60000];
  const refreshInterval = allowed.includes(raw) ? raw : DEFAULT_LIMIT_UP_SETTINGS.refreshInterval;
  return { refreshInterval };
}

export function getLimitUpSettings() {
  return normalizeLimitUpSettings(getJSON(STORAGE_KEYS.LIMIT_UP, {}));
}

export function setLimitUpSettings(obj) {
  const norm = normalizeLimitUpSettings(obj);
  setJSON(STORAGE_KEYS.LIMIT_UP, norm);
  return norm;
}

export function patchLimitUpSettings(patch) {
  if (!patch || typeof patch !== 'object') return getLimitUpSettings();
  const next = normalizeLimitUpSettings({ ...getLimitUpSettings(), ...patch });
  setJSON(STORAGE_KEYS.LIMIT_UP, next);
  return next;
}
```

**Step 4: 运行测试验证通过**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | tail -20
```

期望：5/5 新 case 通过，0 失败

**Step 5: Lint 检查**

```bash
cd D:\AiPrograms\project1 && npm run lint
```

期望：0 errors / 0 warnings

---

## Task 2: 创建 router.js（hash 路由工厂）

**Files:**
- Create: `src/js/router.js`
- Test: `tests/router.test.js`

**Step 1: 写失败测试**

创建 `tests/router.test.js`：

```js
import { createHashRouter, parseHash, navigate } from '../src/js/router.js';

function setHash(h) {
  // location.hash setter triggers hashchange; in jsdom we set + dispatch
  if (typeof location === 'undefined') return;
  const old = location.hash;
  // Direct assignment in jsdom does NOT always trigger hashchange; dispatch manually
  try { location.hash = h; } catch { /* noop */ }
  if (old !== location.hash) {
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  }
}

QUnit.module('router.parseHash', () => {
  QUnit.test('returns "" for empty hash', (t) => {
    t.equal(parseHash(''), '');
    t.equal(parseHash('#'), '');
  });
  QUnit.test('strips leading #', (t) => {
    t.equal(parseHash('#/'), '/');
    t.equal(parseHash('#/limit-up'), '/limit-up');
  });
  QUnit.test('keeps inner slashes', (t) => {
    t.equal(parseHash('#/foo/bar'), '/foo/bar');
  });
  QUnit.test('handles non-string input', (t) => {
    t.equal(parseHash(null), '');
    t.equal(parseHash(undefined), '');
    t.equal(parseHash(123), '');
  });
});

QUnit.module('router.navigate', (hooks) => {
  let originalHash;
  hooks.beforeEach(() => {
    originalHash = location.hash;
    location.hash = '#/';
  });
  hooks.afterEach(() => {
    location.hash = originalHash;
  });

  QUnit.test('sets location.hash to the path with # prefix', (t) => {
    navigate('/limit-up');
    t.equal(location.hash, '#/limit-up');
  });
  QUnit.test('does not double-prefix when path already starts with /', (t) => {
    navigate('/foo');
    t.equal(location.hash, '#/foo');
  });
});

QUnit.module('router.createHashRouter', (hooks) => {
  let calls;
  let routes;
  let router;
  hooks.beforeEach(() => {
    calls = [];
    routes = {
      '#/': (root) => calls.push(['monitor', root]),
      '#/limit-up': (root) => calls.push(['limit-up', root])
    };
    router = createHashRouter(routes, '#/', 'root-1');
    location.hash = '#/';
  });
  hooks.afterEach(() => {
    if (router && router.stop) router.stop();
  });

  QUnit.test('start() invokes the matching route for the current hash', (t) => {
    location.hash = '#/limit-up';
    router.start();
    t.deepEqual(calls, [['limit-up', 'root-1']]);
  });

  QUnit.test('hashchange event dispatches to the new route', (t) => {
    router.start();
    calls.length = 0;
    setHash('#/limit-up');
    t.deepEqual(calls, [['limit-up', 'root-1']]);
  });

  QUnit.test('back navigation to #/ dispatches monitor route', (t) => {
    router.start();
    setHash('#/limit-up');
    calls.length = 0;
    setHash('#/');
    t.deepEqual(calls, [['monitor', 'root-1']]);
  });

  QUnit.test('unknown hash falls back to default and navigates to it', (t) => {
    router.start();
    calls.length = 0;
    setHash('#/bogus');
    // Should set hash back to default (triggers hashchange) → monitor
    t.equal(location.hash, '#/');
  });

  QUnit.test('stop() removes the hashchange listener', (t) => {
    router.start();
    router.stop();
    calls.length = 0;
    setHash('#/limit-up');
    t.deepEqual(calls, [], 'no dispatch after stop');
  });
});
```

**Step 2: 运行测试验证失败**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | grep -A1 "router\."
```

期望：FAIL（`Cannot find module '../src/js/router.js'`）

**Step 3: 实现 router.js**

创建 `src/js/router.js`：

```js
// Hash 路由：#/ → monitor，#/limit-up → limit-up board
// Usage:
//   const router = createHashRouter({
//     '#/': (root) => renderMonitor(root),
//     '#/limit-up': (root) => renderLimitUp(root)
//   }, '#/', rootEl);
//   router.start();

export function parseHash(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw);
  if (s === '' || s === '#') return '';
  return s.startsWith('#') ? s.slice(1) : s;
}

export function navigate(path) {
  if (typeof location === 'undefined') return;
  const p = String(path || '');
  const target = p.startsWith('#') ? p : '#' + (p.startsWith('/') ? p : '/' + p);
  if (location.hash !== target) {
    location.hash = target;
  }
}

export function createHashRouter(routes, defaultPath, rootArg) {
  const defaultHash = defaultPath && defaultPath.startsWith('#') ? defaultPath : '#' + defaultPath;
  let handlerRef = null;

  function dispatch() {
    if (typeof location === 'undefined') return;
    const current = location.hash || defaultHash;
    const handler = Object.prototype.hasOwnProperty.call(routes, current)
      ? routes[current]
      : null;
    if (handler) {
      try {
        handler(rootArg);
      } catch (e) {
        // Surface errors in console but never break hash routing.
        if (typeof console !== 'undefined' && console.error) console.error('router handler error:', e);
      }
      return;
    }
    // Unknown path: navigate to default (triggers hashchange → dispatch)
    if (current !== defaultHash) {
      navigate(defaultHash);
    }
  }

  function start() {
    if (typeof window === 'undefined' || handlerRef) return;
    handlerRef = () => dispatch();
    window.addEventListener('hashchange', handlerRef);
    // Dispatch once for the current hash. If hash is empty, navigate to default.
    if (!location.hash) {
      navigate(defaultHash);
    } else {
      dispatch();
    }
  }

  function stop() {
    if (typeof window === 'undefined' || !handlerRef) return;
    window.removeEventListener('hashchange', handlerRef);
    handlerRef = null;
  }

  return { start, stop, dispatch };
}
```

**Step 4: 运行测试验证通过**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | grep -E "(router|tests,|failed)" | head -20
```

期望：所有 router.* 测试通过

**Step 5: Lint 检查**

```bash
cd D:\AiPrograms\project1 && npm run lint
```

期望：0 errors / 0 warnings

---

## Task 3: 创建 limitUp.js（纯函数逻辑：分类 / 排序 / 合并 / ST）

**Files:**
- Create: `src/js/limitUp.js`
- Test: `tests/limitUp.test.js`

**Step 1: 写失败测试**

创建 `tests/limitUp.test.js`：

```js
import {
  LIMIT_UP_GROUPS,
  classifyByLimitCount,
  sortByLimitCount,
  buildLimitUpGroups,
  mergeLiveTicks,
  isLimitUpName,
  getLimitUpGroupLabel
} from '../src/js/limitUp.js';

function item(over) {
  return Object.assign(
    { code: 'sh600519', name: '茅台', price: 100, changePercent: 10, limitUpCount: 1 },
    over || {}
  );
}

QUnit.module('limitUp.LIMIT_UP_GROUPS', () => {
  QUnit.test('exposes 3 groups in display order: 3+ / 2 / 1', (t) => {
    t.equal(LIMIT_UP_GROUPS.length, 3);
    t.equal(LIMIT_UP_GROUPS[0].key, '3+');
    t.equal(LIMIT_UP_GROUPS[1].key, '2');
    t.equal(LIMIT_UP_GROUPS[2].key, '1');
  });
  QUnit.test('3+ matcher matches count >= 3', (t) => {
    t.true(LIMIT_UP_GROUPS[0].match(3));
    t.true(LIMIT_UP_GROUPS[0].match(10));
    t.false(LIMIT_UP_GROUPS[0].match(2));
  });
  QUnit.test('2 matcher matches count === 2 only', (t) => {
    t.true(LIMIT_UP_GROUPS[1].match(2));
    t.false(LIMIT_UP_GROUPS[1].match(3));
    t.false(LIMIT_UP_GROUPS[1].match(1));
  });
  QUnit.test('1 matcher matches count === 1 or 0 (first-board)', (t) => {
    t.true(LIMIT_UP_GROUPS[2].match(1));
    t.true(LIMIT_UP_GROUPS[2].match(0));
    t.false(LIMIT_UP_GROUPS[2].match(2));
  });
});

QUnit.module('limitUp.isLimitUpName', () => {
  QUnit.test('detects *ST at start of name', (t) => {
    t.true(isLimitUpName('*ST 华微'));
    t.true(isLimitUpName('*ST超讯'));
  });
  QUnit.test('detects ST at start (without *)', (t) => {
    t.true(isLimitUpName('ST康美'));
  });
  QUnit.test('case-insensitive', (t) => {
    t.true(isLimitUpName('st康美'));
    t.true(isLimitUpName('St康美'));
  });
  QUnit.test('non-ST names return false', (t) => {
    t.false(isLimitUpName('贵州茅台'));
    t.false(isLimitUpName('test'));
    t.false(isLimitUpName(''));
    t.false(isLimitUpName(null));
  });
});

QUnit.module('limitUp.classifyByLimitCount', () => {
  QUnit.test('classifies items into 3 buckets', (t) => {
    const items = [
      item({ code: 'a', limitUpCount: 5 }),
      item({ code: 'b', limitUpCount: 2 }),
      item({ code: 'c', limitUpCount: 1 }),
      item({ code: 'd', limitUpCount: 0 })
    ];
    const groups = classifyByLimitCount(items);
    t.equal(groups['3+'].length, 1);
    t.equal(groups['3+'][0].code, 'a');
    t.equal(groups['2'].length, 1);
    t.equal(groups['2'][0].code, 'b');
    t.equal(groups['1'].length, 2);
    t.equal(groups['1'][0].code, 'c');
    t.equal(groups['1'][1].code, 'd');
  });
  QUnit.test('returns empty groups for empty input', (t) => {
    const g = classifyByLimitCount([]);
    t.equal(g['3+'].length, 0);
    t.equal(g['2'].length, 0);
    t.equal(g['1'].length, 0);
  });
});

QUnit.module('limitUp.sortByLimitCount', () => {
  QUnit.test('sorts by count desc, then changePercent desc, then code asc', (t) => {
    const items = [
      item({ code: 'c', limitUpCount: 1, changePercent: 10 }),
      item({ code: 'a', limitUpCount: 3, changePercent: 10 }),
      item({ code: 'b', limitUpCount: 3, changePercent: 5 }),
      item({ code: 'd', limitUpCount: 3, changePercent: 10 })
    ];
    const sorted = sortByLimitCount(items);
    t.equal(sorted[0].code, 'a', 'a: count=3 pct=10 first');
    t.equal(sorted[1].code, 'd', 'd: count=3 pct=10 second (a<d)');
    t.equal(sorted[2].code, 'b', 'b: count=3 pct=5 third');
    t.equal(sorted[3].code, 'c', 'c: count=1 last');
  });
  QUnit.test('does not mutate input', (t) => {
    const items = [item({ code: 'a', limitUpCount: 1 }), item({ code: 'b', limitUpCount: 3 })];
    const snapshot = items.map((x) => x.code);
    sortByLimitCount(items);
    t.deepEqual(items.map((x) => x.code), snapshot);
  });
});

QUnit.module('limitUp.buildLimitUpGroups', () => {
  QUnit.test('returns ordered groups with items sorted', (t) => {
    const items = [
      item({ code: 'a', limitUpCount: 1 }),
      item({ code: 'b', limitUpCount: 5 }),
      item({ code: 'c', limitUpCount: 5 })
    ];
    const out = buildLimitUpGroups(items);
    t.equal(out.length, 3, 'three group entries');
    t.equal(out[0].key, '3+');
    t.equal(out[0].items.length, 2);
    t.equal(out[0].items[0].code, 'b', 'higher count first');
    t.equal(out[1].key, '2');
    t.equal(out[1].items.length, 0);
    t.equal(out[2].key, '1');
    t.equal(out[2].items.length, 1);
  });
  QUnit.test('skips groups that are empty (still keeps order)', (t) => {
    const items = [item({ code: 'a', limitUpCount: 1 })];
    const out = buildLimitUpGroups(items);
    t.equal(out.length, 3);
    t.equal(out[0].items.length, 0, '3+ empty');
    t.equal(out[1].items.length, 0, '2 empty');
    t.equal(out[2].items.length, 1, '1 has the item');
  });
});

QUnit.module('limitUp.mergeLiveTicks', () => {
  QUnit.test('patches price/change/changePercent from live quote', (t) => {
    const items = [item({ code: 'sh600519', price: 100, change: 0, changePercent: 10 })];
    const live = new Map([['sh600519', { code: 'sh600519', price: 105, change: 5, changePercent: 10.5 }]]);
    const out = mergeLiveTicks(items, live);
    t.equal(out[0].price, 105);
    t.equal(out[0].change, 5);
    t.equal(out[0].changePercent, 10.5);
  });
  QUnit.test('keeps item unchanged when code not in live map', (t) => {
    const items = [item({ code: 'sh600519', price: 100 })];
    const live = new Map();
    const out = mergeLiveTicks(items, live);
    t.equal(out[0].price, 100);
  });
  QUnit.test('does not mutate input array or items', (t) => {
    const items = [item({ code: 'sh600519', price: 100 })];
    const live = new Map([['sh600519', { code: 'sh600519', price: 105, change: 0, changePercent: 10 }]]);
    const out = mergeLiveTicks(items, live);
    t.notStrictEqual(out, items);
    t.equal(items[0].price, 100, 'original untouched');
  });
  QUnit.test('handles non-Map liveQuotes (object)', (t) => {
    const items = [item({ code: 'sh600519', price: 100 })];
    const live = { sh600519: { code: 'sh600519', price: 110, change: 0, changePercent: 11 } };
    const out = mergeLiveTicks(items, live);
    t.equal(out[0].price, 110);
  });
  QUnit.test('skips live quote with invalid (non-finite) price', (t) => {
    const items = [item({ code: 'sh600519', price: 100 })];
    const live = new Map([['sh600519', { code: 'sh600519', price: NaN, change: 0, changePercent: 10 }]]);
    const out = mergeLiveTicks(items, live);
    t.equal(out[0].price, 100);
  });
});

QUnit.module('limitUp.getLimitUpGroupLabel', () => {
  QUnit.test('returns Chinese label for known keys', (t) => {
    t.equal(getLimitUpGroupLabel('3+'), '3 连板及以上');
    t.equal(getLimitUpGroupLabel('2'), '2 连板');
    t.equal(getLimitUpGroupLabel('1'), '1 连板 / 首板');
  });
  QUnit.test('returns key for unknown', (t) => {
    t.equal(getLimitUpGroupLabel('?'), '?');
  });
});
```

**Step 2: 运行测试验证失败**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | grep -A1 "limitUp\." | head -20
```

期望：FAIL（`Cannot find module '../src/js/limitUp.js'`）

**Step 3: 实现 limitUp.js**

创建 `src/js/limitUp.js`：

```js
// 涨停看板纯函数逻辑：分类 / 排序 / 实时合并 / ST 识别
// All exports are pure. No side effects, no I/O.

const ST_RE = /^\s*\*?st\b/i;

export const LIMIT_UP_GROUPS = Object.freeze([
  Object.freeze({ key: '3+', label: '3 连板及以上', match: (n) => Number(n) >= 3 }),
  Object.freeze({ key: '2',  label: '2 连板',        match: (n) => Number(n) === 2 }),
  Object.freeze({ key: '1',  label: '1 连板 / 首板', match: (n) => {
    const v = Number(n);
    return v === 1 || v === 0;
  } })
]);

const _GROUP_BY_KEY = new Map(LIMIT_UP_GROUPS.map((g) => [g.key, g]));

export function getLimitUpGroupLabel(key) {
  const g = _GROUP_BY_KEY.get(key);
  return g ? g.label : String(key);
}

export function isLimitUpName(name) {
  return typeof name === 'string' && ST_RE.test(name);
}

function _bucketOf(count) {
  for (const g of LIMIT_UP_GROUPS) {
    if (g.match(count)) return g.key;
  }
  return '1';
}

export function classifyByLimitCount(items) {
  const buckets = { '3+': [], '2': [], '1': [] };
  if (!Array.isArray(items)) return buckets;
  for (const it of items) {
    if (!it) continue;
    const key = _bucketOf(it.limitUpCount);
    buckets[key].push(it);
  }
  return buckets;
}

function _compareItems(a, b) {
  const ac = Number(a.limitUpCount) || 0;
  const bc = Number(b.limitUpCount) || 0;
  if (ac !== bc) return bc - ac; // count desc
  const ap = Number(a.changePercent) || 0;
  const bp = Number(b.changePercent) || 0;
  if (ap !== bp) return bp - ap; // changePercent desc
  const ac2 = String(a.code || '');
  const bc2 = String(b.code || '');
  return ac2 < bc2 ? -1 : ac2 > bc2 ? 1 : 0; // code asc
}

export function sortByLimitCount(items) {
  if (!Array.isArray(items)) return [];
  return [...items].sort(_compareItems);
}

export function buildLimitUpGroups(items) {
  const sorted = sortByLimitCount(items);
  const buckets = classifyByLimitCount(sorted);
  return LIMIT_UP_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: buckets[g.key]
  }));
}

function _lookupLive(liveQuotes, code) {
  if (!liveQuotes || !code) return null;
  if (typeof liveQuotes.get === 'function') {
    return liveQuotes.get(code) || null;
  }
  return liveQuotes[code] || null;
}

export function mergeLiveTicks(items, liveQuotes) {
  if (!Array.isArray(items) || !items.length) return items;
  let changed = false;
  const out = items.map((it) => {
    if (!it || !it.code) return it;
    const live = _lookupLive(liveQuotes, it.code);
    if (!live) return it;
    const newPrice = Number(live.price);
    if (!Number.isFinite(newPrice) || newPrice <= 0) return it;
    const newChange = Number(live.change);
    const newPct = Number(live.changePercent);
    changed = true;
    return {
      ...it,
      price: newPrice,
      change: Number.isFinite(newChange) ? newChange : it.change,
      changePercent: Number.isFinite(newPct) ? newPct : it.changePercent
    };
  });
  return changed ? out : items;
}
```

**Step 4: 运行测试验证通过**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | grep -E "limitUp" | head -30
```

期望：所有 limitUp.* 测试通过（约 24 cases）

**Step 5: Lint 检查**

```bash
cd D:\AiPrograms\project1 && npm run lint
```

期望：0 errors / 0 warnings

---

## Task 4: 创建 limitUpApi.js（东财涨停池 fetch + 解析）

**Files:**
- Create: `src/js/limitUpApi.js`
- Test: `tests/limitUpApi.test.js`

**Step 1: 写失败测试**

创建 `tests/limitUpApi.test.js`：

```js
import {
  buildLimitUpUrl,
  parseLimitUpList,
  fetchLimitUpList
} from '../src/js/limitUpApi.js';

const EASTMONEY_FIELDS = 'f1,f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f100,f102,f103';

function jsonResponse(body, init = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function errorResponse(status = 500) {
  return { ok: false, status, json: async () => ({}), text: async () => '' };
}

QUnit.module('limitUpApi.buildLimitUpUrl', () => {
  QUnit.test('produces /api/limit-up/qt/clist/get with default opts', (t) => {
    const url = buildLimitUpUrl();
    t.ok(url.startsWith('/api/limit-up/qt/clist/get?'), `prefix: ${url}`);
    t.ok(url.includes('fs=m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2'), 'includes fs (full market)');
    t.ok(url.includes('pn=1'), 'default pn=1');
    t.ok(url.includes('pz=200'), 'default pz=200');
    t.ok(url.includes(EASTMONEY_FIELDS.split(',').slice(0, 5).join(',')), 'includes fields');
    t.ok(url.includes('f103'), 'includes 连板数 field');
    t.ok(url.includes('f100'), 'includes 首次封板时间 field');
  });
  QUnit.test('respects custom page and pageSize', (t) => {
    const url = buildLimitUpUrl({ page: 2, pageSize: 50 });
    t.ok(url.includes('pn=2'));
    t.ok(url.includes('pz=50'));
  });
});

QUnit.module('limitUpApi.parseLimitUpList', () => {
  QUnit.test('parses a list of items into normalized objects', (t) => {
    const json = {
      data: {
        total: 2,
        diff: [
          {
            f2: '1.600519', f12: '600519', f14: '贵州茅台',
            f3: 10.01, f4: 100, f6: 1100.00,
            f15: 1100.00, f16: 1000.00, f17: 1000.00, f18: 1000.00,
            f100: '093500', f102: 0, f103: 3
          },
          {
            f2: '0.000001', f12: '000001', f14: '平安银行',
            f3: 9.98, f4: 1.5, f6: 16.50,
            f15: 16.50, f16: 15.00, f17: 15.00, f18: 15.00,
            f100: '093501', f102: 1, f103: 1
          }
        ]
      }
    };
    const items = parseLimitUpList(json);
    t.equal(items.length, 2);
    t.equal(items[0].code, 'sh600519');
    t.equal(items[0].name, '贵州茅台');
    t.equal(items[0].price, 1100.00);
    t.equal(items[0].changePercent, 10.01);
    t.equal(items[0].limitUpCount, 3);
    t.equal(items[0].firstLimitTime, '09:35');
    t.equal(items[0].breakCount, 0);
    t.equal(items[0].isST, false);
    t.equal(items[1].code, 'sz000001');
    t.equal(items[1].limitUpCount, 1);
    t.equal(items[1].breakCount, 1);
  });
  QUnit.test('detects ST names', (t) => {
    const json = {
      data: {
        total: 1,
        diff: [{
          f2: '0.000666', f12: '000666', f14: '*ST 华微',
          f3: 5.01, f6: 10, f15: 10, f16: 9.5, f17: 9.5, f18: 9.5,
          f100: null, f102: 0, f103: 1
        }]
      }
    };
    const items = parseLimitUpList(json);
    t.equal(items[0].isST, true);
  });
  QUnit.test('handles f103 = null (treats as 0 = first-board)', (t) => {
    const json = {
      data: { total: 1, diff: [{
        f2: '1.600000', f12: '600000', f14: '浦发银行',
        f3: 10, f6: 10, f15: 10, f16: 9, f17: 9, f18: 9,
        f100: null, f102: 0, f103: null
      }] }
    };
    const items = parseLimitUpList(json);
    t.equal(items[0].limitUpCount, 0);
    t.equal(items[0].firstLimitTime, null);
  });
  QUnit.test('formats f100 HHMMSS to HH:MM', (t) => {
    const json = {
      data: { total: 1, diff: [{
        f2: '1.600000', f12: '600000', f14: 'X',
        f3: 10, f6: 10, f15: 10, f16: 9, f17: 9, f18: 9,
        f100: '145630', f102: 0, f103: 1
      }] }
    };
    const items = parseLimitUpList(json);
    t.equal(items[0].firstLimitTime, '14:56');
  });
  QUnit.test('returns [] for empty diff', (t) => {
    t.deepEqual(parseLimitUpList({ data: { total: 0, diff: [] } }), []);
    t.deepEqual(parseLimitUpList({ data: null }), []);
    t.deepEqual(parseLimitUpList(null), []);
  });
  QUnit.test('skips items with missing critical fields', (t) => {
    const json = {
      data: { total: 2, diff: [
        { f2: '1.600519', f12: '600519', f14: 'OK', f3: 10, f6: 100, f15: 100, f16: 90, f17: 90, f18: 90, f100: null, f102: 0, f103: 1 },
        { f2: '1.600000', f12: '600000' /* missing name/price */ }
      ] }
    };
    const items = parseLimitUpList(json);
    t.equal(items.length, 1);
  });
});

QUnit.module('limitUpApi.fetchLimitUpList', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  QUnit.test('calls fetch with the built URL and returns parsed items', async (t) => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return jsonResponse({
        data: { total: 1, diff: [{
          f2: '1.600519', f12: '600519', f14: '茅台',
          f3: 10, f6: 100, f15: 100, f16: 90, f17: 90, f18: 90,
          f100: null, f102: 0, f103: 1
        }] }
      });
    };
    const items = await fetchLimitUpList();
    t.ok(captured.url.startsWith('/api/limit-up/'));
    t.equal(items.length, 1);
    t.equal(items[0].code, 'sh600519');
  });

  QUnit.test('forwards AbortSignal to fetch', async (t) => {
    let captured;
    const ctrl = new AbortController();
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return jsonResponse({ data: { total: 0, diff: [] } });
    };
    await fetchLimitUpList({ signal: ctrl.signal });
    t.equal(captured.init.signal, ctrl.signal);
  });

  QUnit.test('throws on HTTP error', async (t) => {
    globalThis.fetch = async () => errorResponse(500);
    await t.rejects(fetchLimitUpList(), /HTTP 500/);
  });

  QUnit.test('returns [] on empty diff (normal: no limit-up today)', async (t) => {
    globalThis.fetch = async () => jsonResponse({ data: { total: 0, diff: [] } });
    const items = await fetchLimitUpList();
    t.deepEqual(items, []);
  });
});
```

**Step 2: 运行测试验证失败**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | grep -A1 "limitUpApi" | head -20
```

期望：FAIL（`Cannot find module`）

**Step 3: 实现 limitUpApi.js**

创建 `src/js/limitUpApi.js`：

```js
// 东财涨停池接口：/api/limit-up → https://push2.eastmoney.com/api/qt/clist/get
import { inferMarket } from './parser.js';
import { isLimitUpName } from './limitUp.js';

const LIMIT_UP_FS = 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2';
const LIMIT_UP_FIELDS = 'f1,f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f100,f102,f103';

export function buildLimitUpUrl(opts = {}) {
  const pn = Number(opts.page) > 0 ? Math.floor(Number(opts.page)) : 1;
  const pzRaw = Number(opts.pageSize);
  const pz = Number.isFinite(pzRaw) && pzRaw > 0 && pzRaw <= 200
    ? Math.floor(pzRaw)
    : 200;
  const params = [
    `pn=${pn}`,
    `pz=${pz}`,
    `po=1`,
    `np=1`,
    `fltt=2`,
    `invt=2`,
    `fid=f3`,
    `fs=${LIMIT_UP_FS}`,
    `fields=${LIMIT_UP_FIELDS}`
  ];
  return `/api/limit-up/qt/clist/get?${params.join('&')}`;
}

function _safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _formatHHMM(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw);
  // Accept HHmmss (6 digits) or HH:mm or HH:mm:ss
  if (/^\d{6}$/.test(s)) return s.slice(0, 2) + ':' + s.slice(2, 4);
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  return null;
}

function _parseItem(row) {
  if (!row || typeof row !== 'object') return null;
  // f2 like "1.600519" or "0.000001"
  const f2 = String(row.f2 || '');
  const dotIdx = f2.indexOf('.');
  if (dotIdx < 0) return null;
  const marketId = f2.slice(0, dotIdx);
  const numeric = f2.slice(dotIdx + 1);
  let market = null;
  if (marketId === '1') market = 'sh';
  else if (marketId === '0') {
    // 东财 sz 与 bj 都用 market=0；按 numeric 前缀推断
    if (/^8|^4|^9/.test(numeric)) market = 'bj';
    else market = 'sz';
  } else return null;

  const code = market + numeric;
  const name = typeof row.f14 === 'string' && row.f14 ? row.f14 : code;
  const price = _safeNum(row.f6, NaN);
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    code,
    name,
    market,
    price,
    change: _safeNum(row.f4, 0),
    changePercent: _safeNum(row.f3, 0),
    limitUpCount: row.f103 === null || row.f103 === undefined ? 0 : _safeNum(row.f103, 0),
    firstLimitTime: _formatHHMM(row.f100),
    breakCount: _safeNum(row.f102, 0),
    isST: isLimitUpName(name),
    open: _safeNum(row.f17, 0),
    high: _safeNum(row.f15, 0),
    low: _safeNum(row.f16, 0)
  };
}

export function parseLimitUpList(json) {
  if (!json || typeof json !== 'object') return [];
  const data = json.data;
  if (!data || typeof data !== 'object') return [];
  const diff = Array.isArray(data.diff) ? data.diff : [];
  const out = [];
  for (const row of diff) {
    const it = _parseItem(row);
    if (it) out.push(it);
  }
  return out;
}

export async function fetchLimitUpList(opts = {}) {
  const url = buildLimitUpUrl(opts);
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return parseLimitUpList(json);
}
```

**Step 4: 运行测试验证通过**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | grep -E "limitUpApi" | head -30
```

期望：所有 limitUpApi.* 测试通过（约 16 cases）

**Step 5: Lint 检查**

```bash
cd D:\AiPrograms\project1 && npm run lint
```

期望：0 errors / 0 warnings

---

## Task 5: vite.config.js 加 /api/limit-up 代理

**Files:**
- Modify: `vite.config.js:33-44` (在 /api/eastmoney 之后插入新代理块)

**Step 1: 修改 vite.config.js**

在 `/api/eastmoney` 代理块结束（line 44 `}`）之后、`/api/sina` 之前插入：

```js
      // '/api/limit-up' MUST be declared AFTER '/api/eastmoney' but before '/api/sina'
      // (longer prefixes must come first per vite key-insertion-order match).
      '/api/limit-up': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/limit-up/, '/api'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'https://quote.eastmoney.com/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            proxyReq.setHeader('Accept', '*/*');
          });
        }
      },
```

**Step 2: 验证配置**

```bash
cd D:\AiPrograms\project1 && npm run build 2>&1 | tail -5
```

期望：build 成功（不需要 lint/test，因为这是配置改动）

**Step 3: 检查键顺序正确性**

打开 `vite.config.js` 确认顺序：`/api/tencent → /api/eastmoney-kline → /api/eastmoney → /api/limit-up → /api/sina → /api/qq-kline-min → /api/qq-kline`

---

## Task 6: 修改 index.html 添加顶部 nav 链接

**Files:**
- Modify: `index.html`

**Step 1: 替换 body 内容**

将整个 `index.html` 替换为：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>股票期货监控助手</title>
  <link rel="stylesheet" href="/src/style.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

（实际上 `index.html` 本身不需要改 — nav 由 `app.js` 的 `renderHeader()` 渲染在 `#app` 内部。验证后再决定。）

**Step 2: 验证：直接进入 Task 7 在 app.js 内部添加 nav**

确认 `index.html` 不需要修改，nav 由 JS 注入。

---

## Task 7: 修改 app.js — 拆分 renderMonitorPage + startApp 路由化 + nav + state.limitUp

**Files:**
- Modify: `src/js/app.js` （多处）
- Test: `tests/app.test.js` 末尾添加新 module

**Step 1: 在 storage imports 末尾添加新导入**

找到 app.js 第 1-46 行（import 块），在末尾追加：

```js
import { getLimitUpSettings, patchLimitUpSettings, DEFAULT_LIMIT_UP_SETTINGS } from './storage.js';
import { createHashRouter, navigate } from './router.js';
import { fetchLimitUpList } from './limitUpApi.js';
import {
  buildLimitUpGroups,
  mergeLiveTicks
} from './limitUp.js';
import { renderLimitUpPage } from './limitUpView.js';
```

**Step 2: 添加 LIMIT_UP_REFRESH_OPTIONS 常量**

在 `REFRESH_OPTIONS`（line 47-52）之后、`DEFAULT_REFRESH`（line 53）之后添加：

```js
export const LIMIT_UP_REFRESH_OPTIONS = [
  { value: 10000, label: '10 秒' },
  { value: 30000, label: '30 秒' },
  { value: 60000, label: '60 秒' }
];
```

**Step 3: 添加 parseLimitUpIntervalSeconds 纯函数**

在 `parseAlertThreshold`（line 110 结束）之后追加：

```js
// Parses a user-entered limit-up refresh interval in seconds.
// Returns a positive integer (seconds) on success, or null for both
// "empty" and "invalid" cases. Validates against LIMIT_UP_REFRESH_OPTIONS.
export function parseLimitUpIntervalSeconds(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (!/^[1-9]\d*$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return LIMIT_UP_REFRESH_OPTIONS.some((o) => o.value === n * 1000) ? n : null;
}
```

**Step 4: 扩展 state 对象**

找到 `const state = { ... }`（line 261-282）。在 `tickFallback: null` 之后添加：

```js
  limitUp: {
    items: [],
    groups: [],
    lastUpdate: null,
    loading: false,
    error: null,
    refreshInterval: 30000,
    timer: null,
    abort: null,
    // 2026-06-05 用户增补：非交易时段空响应处理
    lastNonEmptyItems: [],   // 最近一次非空的拉取结果；用于"空响应锁定显示"
    lastNonEmptyAt: null,    // 该次拉取的时间戳
    consecutiveEmptyFetches: 0  // 连续空响应次数
  }
};
```

**Step 5: 添加模块级变量**

在 `let rootEl = null;` 之后追加：

```js
let limitUpRootRef = null;  // 看板视图内部 root 引用（用于状态获取）
```

**Step 6: 拆分 renderApp → renderMonitorPage**

将现有的 `function renderApp()`（line 315-330）重命名为 `export function renderMonitorPage(root)`。函数体内将 `if (!rootEl) return;` 改为 `if (!root) return;`，并把所有 `rootEl` 替换为 `root`。

具体地：
- `function renderApp() {` → `export function renderMonitorPage(root) {`
- `if (!rootEl) return;` → `if (!root) return;`
- `rootEl.innerHTML = '';` → `root.innerHTML = '';`
- `rootEl.appendChild(...)` → `root.appendChild(...)` （共 7 处）

**Step 7: 在 renderHeader 中添加 nav**

找到 `function renderHeader()`（line 332-353）。在返回的 `header` 元素中，在 `<h1>` 之后、`<div class="header-actions">` 之前插入 nav：

修改 `el('h1', {}, '股票期货监控助手 v2'),` 之后插入：

```js
    el(
      'nav',
      { class: 'app-nav', id: 'app-nav' },
      el('a', { href: '#/', class: 'nav-link', 'data-route': '#/' }, '监控'),
      el('a', { href: '#/limit-up', class: 'nav-link', 'data-route': '#/limit-up' }, '涨停看板')
    ),
```

**Step 8: 改造 startApp 启动路由**

将 `export function startApp(root)` 函数体（line 1476-1497）替换为：

```js
export function startApp(root) {
  rootEl = root;
  initTheme();
  // Monitor state
  const settings = getSettings();
  state.refreshInterval = settings.refreshInterval || DEFAULT_REFRESH;
  state.watchList = getWatchList();
  state.voice = normalizeVoiceSettings(getVoiceSettings());
  state.alert = normalizeAlertSettings(getAlertSettings());
  state.subscribed = new Set(getSubscribedCodes().filter((c) => state.watchList.includes(c)));
  if (isNotificationSupported()) {
    try {
      state.notifPermission = (globalThis.Notification && globalThis.Notification.permission) || 'default';
    } catch {
      state.notifPermission = 'default';
    }
  }
  // Limit-up state
  const luSettings = getLimitUpSettings();
  state.limitUp.refreshInterval = luSettings.refreshInterval;
  // Initial monitor render + data fetch
  renderMonitorPage(root);
  refreshNow();
  restartTimer();
  if (state.voice.enabled) startVoiceTimer();
  // Start hash router: switch between monitor and limit-up pages
  const router = createHashRouter(
    {
      '#/': (r) => {
        stopLimitUpTimer();
        renderMonitorPage(r);
      },
      '#/limit-up': (r) => {
        stopLimitUpTimer();
        limitUpRootRef = r;
        renderLimitUpPage(r, state.limitUp, {
          navigateTo: (path) => navigate(path),
          addToWatchListAndNavigate: handleLimitUpAddAndNavigate,
          onRefreshChange: handleLimitUpRefreshChange,
          fetchList: fetchLimitUpListNow,
          onLiveTickUpdate: applyLiveTicksToLimitUp
        });
        startLimitUpTimer();
      }
    },
    '#/',
    root
  );
  router.start();
}
```

**Step 9: 添加 limit-up 相关的 handler / timer 函数**

在 `startApp` 函数之前（或文件末尾）添加以下函数：

```js
function fetchLimitUpListNow() {
  return limitUpFetch();
}

// Pure: given current limit-up state slice + new fetch result, returns the next slice.
// (Exported for testing; 2026-06-05 增补"非交易时段空响应锁定显示"语义)
export function applyLimitUpFetchResult(luState, items) {
  const prev = luState || {};
  const now = new Date();
  if (Array.isArray(items) && items.length > 0) {
    return {
      ...prev,
      items,
      groups: buildLimitUpGroups(items),
      lastNonEmptyItems: items,
      lastNonEmptyAt: now,
      consecutiveEmptyFetches: 0
    };
  }
  // Empty response
  const cached = Array.isArray(prev.lastNonEmptyItems) ? prev.lastNonEmptyItems : [];
  const displayItems = cached.length ? cached : [];
  return {
    ...prev,
    items: displayItems,
    groups: buildLimitUpGroups(displayItems),
    consecutiveEmptyFetches: (Number(prev.consecutiveEmptyFetches) || 0) + 1
  };
}

async function limitUpFetch() {
  if (state.limitUp.loading) return;
  if (state.limitUp.abort) {
    try { state.limitUp.abort.abort(); } catch { /* ignore */ }
  }
  state.limitUp.abort = new AbortController();
  state.limitUp.loading = true;
  state.limitUp.error = null;
  if (typeof limitUpRootRef === 'function') limitUpRootRef('status');
  try {
    const items = await fetchLimitUpList({ signal: state.limitUp.abort.signal });
    state.limitUp.lastUpdate = new Date();
    state.limitUp = applyLimitUpFetchResult(state.limitUp, items);
  } catch (e) {
    if (e && e.name !== 'AbortError') {
      state.limitUp.error = e.message || String(e);
    }
  } finally {
    state.limitUp.loading = false;
    if (typeof limitUpRootRef === 'function') limitUpRootRef('data');
  }
}

function applyLiveTicksToLimitUp() {
  if (!state.limitUp.items.length) return;
  const merged = mergeLiveTicks(state.limitUp.items, state.quotes);
  if (merged === state.limitUp.items) return;
  state.limitUp.items = merged;
  state.limitUp.groups = buildLimitUpGroups(merged);
  if (typeof limitUpRootRef === 'function') limitUpRootRef('data');
}

function startLimitUpTimer() {
  stopLimitUpTimer();
  const interval = state.limitUp.refreshInterval;
  if (!interval || interval < 1000) return;
  limitUpFetch();
  state.limitUp.timer = setInterval(() => {
    limitUpFetch();
  }, interval);
}

function stopLimitUpTimer() {
  if (state.limitUp.timer) {
    clearInterval(state.limitUp.timer);
    state.limitUp.timer = null;
  }
  if (state.limitUp.abort) {
    try { state.limitUp.abort.abort(); } catch { /* ignore */ }
    state.limitUp.abort = null;
  }
}

function handleLimitUpRefreshChange(newIntervalMs) {
  state.limitUp.refreshInterval = newIntervalMs;
  patchLimitUpSettings({ refreshInterval: newIntervalMs });
  if (state.limitUp.timer) startLimitUpTimer();
}

function handleLimitUpAddAndNavigate(code) {
  if (!code) return;
  const wasInList = state.watchList.includes(code);
  addToWatchList(code);
  state.watchList = getWatchList();
  flashError(wasInList ? `已在监控列表：` : `已加入监控：${code}`);
  navigate('#/');
  // Trigger immediate refresh so the new code shows up at the top.
  refreshNow();
  // Re-render monitor immediately so the new row appears.
  renderData();
}
```

**Step 10: 写 app.test.js 集成测试**

在 `tests/app.test.js` 末尾添加（前面 import 块中追加新 import）：

修改顶部 import 块（line 1-19）追加：

```js
  parseIntervalSeconds,
  parseAlertThreshold,
  parseLimitUpIntervalSeconds,
  LIMIT_UP_REFRESH_OPTIONS
} from '../src/js/app.js';
```

末尾添加 module：

```js
QUnit.module('app.parseLimitUpIntervalSeconds', () => {
  QUnit.test('accepts values matching LIMIT_UP_REFRESH_OPTIONS', (t) => {
    t.equal(parseLimitUpIntervalSeconds('10'), 10);
    t.equal(parseLimitUpIntervalSeconds('30'), 30);
    t.equal(parseLimitUpIntervalSeconds('60'), 60);
  });
  QUnit.test('rejects values not in options', (t) => {
    t.equal(parseLimitUpIntervalSeconds('5'), null);
    t.equal(parseLimitUpIntervalSeconds('15'), null);
    t.equal(parseLimitUpIntervalSeconds('120'), null);
  });
  QUnit.test('rejects empty/invalid/non-integer', (t) => {
    t.equal(parseLimitUpIntervalSeconds(''), null);
    t.equal(parseLimitUpIntervalSeconds('0'), null);
    t.equal(parseLimitUpIntervalSeconds('-1'), null);
    t.equal(parseLimitUpIntervalSeconds('abc'), null);
    t.equal(parseLimitUpIntervalSeconds('5.5'), null);
    t.equal(parseLimitUpIntervalSeconds(null), null);
  });
  QUnit.test('trims whitespace', (t) => {
    t.equal(parseLimitUpIntervalSeconds('  30  '), 30);
  });
});

QUnit.module('app.LIMIT_UP_REFRESH_OPTIONS', () => {
  QUnit.test('has 3 ascending options 10/30/60 seconds', (t) => {
    t.deepEqual(
      LIMIT_UP_REFRESH_OPTIONS.map((o) => o.value),
      [10000, 30000, 60000]
    );
  });
});

// ===== 2026-06-05 增补：非交易时段空响应锁定显示 =====
import { applyLimitUpFetchResult } from '../src/js/app.js';

QUnit.module('app.applyLimitUpFetchResult', () => {
  const item = (code) => ({ code, name: 'X', price: 10, changePercent: 10, limitUpCount: 1 });

  QUnit.test('non-empty items: updates items/groups and refreshes cache', (t) => {
    const prev = {
      items: [],
      groups: [],
      lastNonEmptyItems: [],
      lastNonEmptyAt: null,
      consecutiveEmptyFetches: 3
    };
    const next = applyLimitUpFetchResult(prev, [item('sh600519')]);
    t.equal(next.items.length, 1);
    t.equal(next.lastNonEmptyItems.length, 1);
    t.equal(next.consecutiveEmptyFetches, 0, 'resets empty counter');
    t.ok(next.lastNonEmptyAt instanceof Date, 'updates timestamp');
    t.equal(next.groups.length, 3, 'all three groups present');
  });

  QUnit.test('empty items + no cache: shows empty + increments counter', (t) => {
    const prev = { items: [], groups: [], lastNonEmptyItems: [], lastNonEmptyAt: null, consecutiveEmptyFetches: 0 };
    const next = applyLimitUpFetchResult(prev, []);
    t.equal(next.items.length, 0);
    t.equal(next.groups.length, 3, 'groups still rendered (empty)');
    t.equal(next.consecutiveEmptyFetches, 1);
  });

  QUnit.test('empty items + existing cache: keeps cached items, increments counter', (t) => {
    const cached = [item('sh600519'), item('sh600000')];
    const prev = {
      items: cached,
      groups: [],
      lastNonEmptyItems: cached,
      lastNonEmptyAt: new Date('2024-03-15T10:00:00Z'),
      consecutiveEmptyFetches: 0
    };
    const next = applyLimitUpFetchResult(prev, []);
    t.equal(next.items.length, 2, 'still shows cached items');
    t.equal(next.lastNonEmptyItems.length, 2, 'cache preserved');
    t.equal(next.consecutiveEmptyFetches, 1, 'increments counter');
    t.equal(next.lastNonEmptyAt, prev.lastNonEmptyAt, 'cache timestamp unchanged');
  });

  QUnit.test('multiple consecutive empties: counter accumulates', (t) => {
    const cached = [item('sh600519')];
    let state = { items: cached, groups: [], lastNonEmptyItems: cached, lastNonEmptyAt: null, consecutiveEmptyFetches: 0 };
    state = applyLimitUpFetchResult(state, []);
    t.equal(state.consecutiveEmptyFetches, 1);
    state = applyLimitUpFetchResult(state, []);
    t.equal(state.consecutiveEmptyFetches, 2);
    state = applyLimitUpFetchResult(state, []);
    t.equal(state.consecutiveEmptyFetches, 3);
    t.equal(state.items.length, 1, 'still cached');
  });

  QUnit.test('non-empty after empties: counter resets to 0', (t) => {
    const old = [item('sh600519')];
    const fresh = [item('sh600519'), item('sh600000'), item('sh600001')];
    let state = { items: old, groups: [], lastNonEmptyItems: old, lastNonEmptyAt: null, consecutiveEmptyFetches: 5 };
    state = applyLimitUpFetchResult(state, []);
    state = applyLimitUpFetchResult(state, []);
    t.equal(state.consecutiveEmptyFetches, 2);
    state = applyLimitUpFetchResult(state, fresh);
    t.equal(state.items.length, 3, 'updated to fresh data');
    t.equal(state.consecutiveEmptyFetches, 0);
  });

  QUnit.test('handles null/undefined state input', (t) => {
    const next = applyLimitUpFetchResult(null, [item('sh600519')]);
    t.equal(next.items.length, 1);
    t.equal(next.consecutiveEmptyFetches, 0);
  });

  QUnit.test('handles non-array items input as empty', (t) => {
    const next = applyLimitUpFetchResult({}, null);
    t.equal(next.items.length, 0);
    t.equal(next.consecutiveEmptyFetches, 1);
  });
});
```

**Step 11: 运行测试**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | tail -10
```

期望：所有测试通过

**Step 12: Lint**

```bash
cd D:\AiPrograms\project1 && npm run lint
```

期望：0 errors / 0 warnings

---

## Task 8: 创建 limitUpView.js（视图渲染）

**Files:**
- Create: `src/js/limitUpView.js`

**Step 1: 创建文件**

```js
// 涨停看板视图。纯渲染：传入 root + state + callbacks，输出 DOM 树。
import {
  formatNumber,
  formatChange,
  formatPercent
} from './app.js';
import { LIMIT_UP_REFRESH_OPTIONS, DEFAULT_LIMIT_UP_SETTINGS } from './app.js';
import { LIMIT_UP_GROUPS, getLimitUpGroupLabel } from './limitUp.js';
import { addToWatchList } from './storage.js';

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'on' && typeof v === 'object') {
      for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    } else if (k === 'checked' && v) {
      node.checked = true;
    } else if (k === 'disabled' && v) {
      node.disabled = true;
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function buildRefreshSelect(state, onChange) {
  const sel = el('select', { id: 'limit-up-refresh', on: { change: (e) => onChange(Number(e.target.value)) } });
  for (const opt of LIMIT_UP_REFRESH_OPTIONS) {
    const o = el('option', { value: opt.value }, opt.label);
    if (opt.value === state.refreshInterval) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}

function buildRow(item, onClick) {
  const tr = el(
    'tr',
    {
      class: 'lu-row',
      'data-code': item.code,
      on: { click: () => onClick(item.code) }
    },
    el('td', { class: 'lu-code' }, item.code),
    el(
      'td',
      { class: 'lu-name' },
      item.name || '-',
      item.isST ? el('span', { class: 'lu-st-badge', title: 'ST / *ST 股票' }, 'ST') : null
    ),
    el('td', { class: 'lu-count num' }, `${item.limitUpCount || 0} 板`),
    el('td', { class: 'lu-price num' }, formatNumber(item.price)),
    el('td', { class: 'lu-pct num' }, formatPercent(item.changePercent)),
    el('td', { class: 'lu-first num' }, item.firstLimitTime || '-'),
    el('td', { class: 'lu-break num' }, String(item.breakCount || 0))
  );
  return tr;
}

function buildGroup(group) {
  if (!group.items.length) {
    return el(
      'section',
      { class: 'lu-group empty', 'data-group': group.key },
      el(
        'header',
        { class: 'lu-group-header' },
        el('span', { class: 'lu-group-title' }, group.label),
        el('span', { class: 'lu-group-count' }, '0 只')
      )
    );
  }
  const table = el('table', { class: 'lu-table' });
  const thead = el(
    'thead',
    {},
    el(
      'tr',
      {},
      el('th', { class: 'lu-code' }, '代码'),
      el('th', { class: 'lu-name' }, '名称'),
      el('th', { class: 'lu-count num' }, '连板'),
      el('th', { class: 'lu-price num' }, '现价'),
      el('th', { class: 'lu-pct num' }, '涨幅'),
      el('th', { class: 'lu-first num' }, '封板时间'),
      el('th', { class: 'lu-break num' }, '炸板')
    )
  );
  table.appendChild(thead);
  const tbody = el('tbody', {});
  for (const it of group.items) {
    tbody.appendChild(buildRow(it, () => {}));
  }
  table.appendChild(tbody);
  return el(
    'section',
    { class: 'lu-group', 'data-group': group.key },
    el(
      'header',
      { class: 'lu-group-header' },
      el('span', { class: 'lu-group-title' }, group.label),
      el('span', { class: 'lu-group-count' }, `${group.items.length} 只`)
    ),
    el('div', { class: 'lu-group-body' }, table)
  );
}

function buildStatusLine(state) {
  const parts = [];
  const total = state.groups.reduce((s, g) => s + g.items.length, 0);
  parts.push(`共 ${total} 只涨停`);
  if (state.loading) parts.push('加载中...');
  if (state.error) parts.push(`错误: ${state.error}`);
  // 2026-06-05 增补：非交易时段空响应时显示"缓存自"提示
  if (state.consecutiveEmptyFetches > 0 && state.lastNonEmptyAt) {
    const ts = state.lastNonEmptyAt.toLocaleTimeString();
    parts.push(`缓存自 ${ts} · 已空 ${state.consecutiveEmptyFetches} 次`);
  } else if (state.lastUpdate) {
    parts.push(`更新于 ${state.lastUpdate.toLocaleTimeString()}`);
  }
  return el('footer', { class: 'status-bar', id: 'lu-status' }, parts.join(' · '));
}

function updateStatusLine(state) {
  const f = document.getElementById('lu-status');
  if (!f) return;
  f.textContent = '';
  f.appendChild(buildStatusLine(state));
}

function updateGroupsOnly(state, onRowClick) {
  const wrap = document.getElementById('lu-groups');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const g of state.groups) {
    const section = el('section', { class: 'lu-group', 'data-group': g.key });
    const header = el(
      'header',
      { class: 'lu-group-header' },
      el('span', { class: 'lu-group-title' }, g.label),
      el('span', { class: 'lu-group-count' }, `${g.items.length} 只`)
    );
    section.appendChild(header);
    if (g.items.length) {
      const table = el('table', { class: 'lu-table' });
      const thead = el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'lu-code' }, '代码'),
          el('th', { class: 'lu-name' }, '名称'),
          el('th', { class: 'lu-count num' }, '连板'),
          el('th', { class: 'lu-price num' }, '现价'),
          el('th', { class: 'lu-pct num' }, '涨幅'),
          el('th', { class: 'lu-first num' }, '封板时间'),
          el('th', { class: 'lu-break num' }, '炸板')
        )
      );
      table.appendChild(thead);
      const tbody = el('tbody', {});
      for (const it of g.items) {
        tbody.appendChild(buildRow(it, onRowClick));
      }
      table.appendChild(tbody);
      section.appendChild(el('div', { class: 'lu-group-body' }, table));
    }
    wrap.appendChild(section);
  }
}

// Public API: renderLimitUpPage(root, state, callbacks)
//
// callbacks: {
//   navigateTo(path)         — 切换路由
//   addToWatchListAndNavigate(code) — 行点击：加入监控 + 切到 #/
//   onRefreshChange(ms)     — 刷新频率变更
//   fetchList()              — 立即拉取（手动刷新）
//   onLiveTickUpdate()       — 触发行内实时价合并（可选）
// }
export function renderLimitUpPage(root, state, callbacks) {
  if (!root) return;
  const cb = callbacks || {};

  // Top header (reuse same nav shape as monitor for consistency)
  const header = el(
    'header',
    { class: 'app-header' },
    el('h1', {}, '股票期货监控助手 v2'),
    el(
      'nav',
      { class: 'app-nav', id: 'app-nav' },
      el('a', { href: '#/', class: 'nav-link' }, '监控'),
      el('a', { href: '#/limit-up', class: 'nav-link active' }, '涨停看板')
    )
  );

  // Toolbar
  const toolbar = el(
    'section',
    { class: 'toolbar lu-toolbar' },
    el(
      'div',
      { class: 'lu-toolbar-row' },
      el(
        'label',
        { class: 'lu-inline' },
        el('span', { class: 'lu-inline-label' }, '刷新:'),
        buildRefreshSelect(state, (ms) => {
          if (typeof cb.onRefreshChange === 'function') cb.onRefreshChange(ms);
        })
      ),
      el(
        'button',
        { on: { click: () => { if (typeof cb.fetchList === 'function') cb.fetchList(); } } },
        '⟳ 立即刷新'
      ),
      el('span', { class: 'lu-hint' }, `共 ${state.groups.reduce((s, g) => s + g.items.length, 0)} 只涨停`)
    )
  );

  // Groups container (will be incrementally updated)
  const groupsWrap = el('section', { class: 'lu-groups', id: 'lu-groups' });
  for (const g of state.groups) {
    const section = el('section', { class: 'lu-group', 'data-group': g.key });
    const head = el(
      'header',
      { class: 'lu-group-header' },
      el('span', { class: 'lu-group-title' }, g.label),
      el('span', { class: 'lu-group-count' }, `${g.items.length} 只`)
    );
    section.appendChild(head);
    if (g.items.length) {
      const table = el('table', { class: 'lu-table' });
      const thead = el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'lu-code' }, '代码'),
          el('th', { class: 'lu-name' }, '名称'),
          el('th', { class: 'lu-count num' }, '连板'),
          el('th', { class: 'lu-price num' }, '现价'),
          el('th', { class: 'lu-pct num' }, '涨幅'),
          el('th', { class: 'lu-first num' }, '封板时间'),
          el('th', { class: 'lu-break num' }, '炸板')
        )
      );
      table.appendChild(thead);
      const tbody = el('tbody', {});
      const onClick = (code) => {
        if (typeof cb.addToWatchListAndNavigate === 'function') {
          cb.addToWatchListAndNavigate(code);
        }
      };
      for (const it of g.items) {
        tbody.appendChild(buildRow(it, onClick));
      }
      table.appendChild(tbody);
      section.appendChild(el('div', { class: 'lu-group-body' }, table));
    }
    groupsWrap.appendChild(section);
  }

  // Status
  const status = buildStatusLine(state);

  // Compose
  root.innerHTML = '';
  root.appendChild(header);
  root.appendChild(toolbar);
  root.appendChild(groupsWrap);
  root.appendChild(status);
}
```

**Step 2: 运行测试 + Lint**

```bash
cd D:\AiPrograms\project1 && npm test 2>&1 | tail -5 && npm run lint
```

期望：测试全过，0 lint

---

## Task 9: 修改 style.css 添加 .lu-* 样式

**Files:**
- Modify: `src/style.css` 末尾追加

**Step 1: 追加样式**

在 style.css 文件末尾追加：

```css
/* === 涨停看板 === */
.app-nav {
  display: inline-flex;
  gap: 0.5rem;
  margin-right: auto;
  align-items: center;
}
.app-nav .nav-link {
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  color: var(--text-color, #333);
  text-decoration: none;
  font-size: 0.95rem;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}
.app-nav .nav-link:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}
.app-nav .nav-link.active {
  background: var(--accent-color, #3498DB);
  color: #fff;
  border-color: var(--accent-color, #3498DB);
}

.lu-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  background: var(--card-bg, #fff);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
  margin-bottom: 0.75rem;
}
.lu-toolbar-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.lu-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.lu-inline-label {
  color: var(--text-muted, #666);
  font-size: 0.9rem;
}
.lu-hint {
  color: var(--text-muted, #666);
  font-size: 0.9rem;
  margin-left: auto;
}

.lu-groups {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.lu-group {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
}
.lu-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 1rem;
  background: var(--group-header-bg, rgba(0, 0, 0, 0.03));
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  font-weight: 600;
}
.lu-group-title {
  font-size: 1rem;
}
.lu-group-count {
  color: var(--text-muted, #666);
  font-size: 0.9rem;
}
.lu-group.empty .lu-group-count {
  font-style: italic;
}

.lu-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.lu-table th,
.lu-table td {
  padding: 0.45rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color-soft, #f0f0f0);
}
.lu-table th {
  color: var(--text-muted, #666);
  font-weight: 500;
  background: var(--table-head-bg, rgba(0, 0, 0, 0.02));
}
.lu-table td.num,
.lu-table th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: 'Roboto Mono', monospace, sans-serif;
}
.lu-table tbody tr {
  cursor: pointer;
  transition: background 0.1s;
}
.lu-table tbody tr:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}
.lu-pct.up {
  color: var(--up-color, #E74C3C);
}
.lu-pct.down {
  color: var(--down-color, #27AE60);
}
.lu-st-badge {
  display: inline-block;
  background: #E74C3C;
  color: #fff;
  font-size: 0.7rem;
  padding: 0 0.4rem;
  margin-left: 0.3rem;
  border-radius: 3px;
  vertical-align: middle;
  font-weight: 600;
}

@media (max-width: 768px) {
  .lu-table {
    font-size: 0.8rem;
  }
  .lu-table th,
  .lu-table td {
    padding: 0.35rem 0.4rem;
  }
  .lu-toolbar-row {
    gap: 0.5rem;
  }
}
```

**Step 2: 构建验证**

```bash
cd D:\AiPrograms\project1 && npm run build 2>&1 | tail -5
```

期望：build 成功

---

## Task 10: 整体验收

**Step 1: 完整 lint + test + build**

```bash
cd D:\AiPrograms\project1 && npm run lint && npm test && npm run build 2>&1 | tail -30
```

期望：
- 0 errors / 0 warnings
- 测试 300+ cases 全部通过（应净增约 60 cases：storage 5 + router 12 + limitUp 24 + limitUpApi 16 + app 6）
- build 成功

**Step 2: 启动 dev server 烟测**

```bash
cd D:\AiPrograms\project1 && npm run dev
```

打开 http://127.0.0.1:5173/ 验证：
- 默认显示监控页
- 顶部有 "监控 / 涨停看板" nav
- 点击 "涨停看板" 切到 `#/limit-up` URL 并显示分组看板
- 看板显示 3 个分组（3+/2/1）
- 频率下拉可切（10/30/60）
- 立即刷新按钮工作
- 行点击 → 切回监控页 + 标的已加入列表
- ST 名字旁有红色 ST 标记

**Step 3: 浏览器控制台检查**

无 console.error / warning

---

## 验收清单

- [ ] `npm run lint` 0/0
- [ ] `npm test` 全过（净增 ~60 cases，累计 ~336）
- [ ] `npm run build` 成功
- [ ] 监控页 → 涨停看板 切换正常
- [ ] 看板按连板数分组 + 桶内排序
- [ ] 频率切换 10/30/60s 持久化
- [ ] 立即刷新可用
- [ ] 行内实时价（监控 timer 拉到的最新价）合并到看板
- [ ] ST 标记显示
- [ ] 行点击加入监控 + 自动切回 #/

---

## 已知风险与后续

1. **东财 clist/get 非交易时段返回空 diff** — 看板显示 0 只（不报错）
2. **pz=200 上限** — 极端牛市可能截断（未来分页）
3. **页面切换没 destroy 监控 chart** — 已设计：切到 #/limit-up 时监控页 DOM 整个 innerHTML 替换，旧 chart 实例成为孤儿（依赖 GC）；不立即 leak 但长期建议在 renderMonitorPage 前 destroyChart()
4. **.lu-st-badge 暗色主题对比度** — 若实测差，调 `--st-badge-bg` CSS 变量
5. **Phase 5 测试 + e2e + 文档同步** — 留待用户确认 Phase 4 后开展
