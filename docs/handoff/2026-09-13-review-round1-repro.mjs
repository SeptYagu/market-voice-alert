// 独立审查复现脚本（round 1）—— 零依赖，只 import 仓库真实模块，不 mock 被测逻辑。
//
// 用法：
//   node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=broken   # 基线 ad69e35^（缺陷不存在）
//   node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=fixed    # HEAD（缺陷已引入）
//
// 说明：
//   · 本脚本只攻击 ad69e35 实际改动过的两处（storage.js 读取语义 / limitUpView 行补丁）。
//   · 环境照抄 tests/_jsdom-setup.cjs：控制器与视图内部使用「全局」document，
//     必须把 jsdom 的 window 暴露到 globalThis，否则异常会被上层 try/catch 吞成 UI 假象。
//
// 关键约定：
//   --expect=broken 必须用「缺陷尚未引入」的那次提交，即 ad69e35 的父提交 ad69e35^（a566c46）。
//   误用中间提交会导致首条断言即崩（历史已发生过）。

import { JSDOM } from 'jsdom';

const MODE = (process.argv.find((a) => a.startsWith('--expect=')) || '--expect=fixed').split('=')[1];
if (MODE !== 'broken' && MODE !== 'fixed') {
  console.error(`未知模式：${MODE}（只支持 broken | fixed）`);
  process.exit(2);
}

// ---------------------------------------------------------------- 环境
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
const win = dom.window;
for (const k of ['window', 'document', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node', 'HTMLElement', 'CustomEvent']) {
  globalThis[k] = win[k];
}
try { Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true }); } catch { /* node22 getter-only */ }

// 可控 localStorage：mode 切换 ok / quota
const _store = new Map();
let _mode = 'ok';
const fakeStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => {
    if (_mode !== 'ok') { const e = new Error('Quota exceeded'); e.name = 'QuotaExceededError'; throw e; }
    _store.set(k, String(v));
  },
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear()
};
globalThis.localStorage = fakeStorage;
try { Object.defineProperty(win, 'localStorage', { value: fakeStorage, configurable: true }); } catch { /* ignore */ }

const rows = [];
let skipped = 0;
function check(id, label, pass, mode, detail) {
  rows.push({ id, label, pass: !!pass, mode, detail });
}

async function mod(p) {
  return import(new URL(`../../${p}`, import.meta.url).href);
}

// ---------------------------------------------------------------- R-ORPHAN：内存孤岛副本
// ad69e35 把 _readKlineCacheEntry 改成「持久化未命中则继续查内存」。
// 但 _klineMemoryCache 只在「降级写」时被写入，且 LRU 容量淘汰只遍历持久化 entries
// （storage.js:497 Object.entries(obj.entries)）→ 只在内存里的 key 永远不会被淘汰，
// 变成「孤岛副本」；持久化被挤出后，读取路径仍把它当新鲜缓存返回。
{
  const code = 'R-ORPHAN';
  try {
    const S = await mod('src/js/storage.js');
    const { klineCacheSet, klineCacheGet, isKlineCacheStale, KLINE_CACHE_KEY, KLINE_MAX_ENTRIES } = S;
    const mkK = (c, n, tag) => ({ code: c, items: Array.from({ length: n }, (_, i) => ({ time: i, close: i, tag })) });

    _store.clear();
    _mode = 'quota';
    klineCacheSet('A', '1d', mkK('A', 2, 'A-OLD'));   // 配额失败 → 只进内存（降级）
    _mode = 'ok';
    // 正常写入压力：把持久化写满（A 不在持久化 entries 中，故不参与 LRU、不会被清理）
    for (let i = 0; i < KLINE_MAX_ENTRIES + 10; i++) klineCacheSet(`k${i}`, '1d', mkK(`k${i}`, 2, 'K'));

    const raw = _store.get(KLINE_CACHE_KEY);
    const aInPersist = raw ? !!JSON.parse(raw).entries['A|1d'] : false;
    const got = klineCacheGet('A', '1d');
    const stale = isKlineCacheStale('A', '1d');
    const orphan = !!got && !aInPersist;

    check(code, '前置条件：该 key 已不在持久化中（被容量压力挤出）',
      aInPersist === false, 'both',
      `aInPersist=${aInPersist}；持久化条目数=${raw ? Object.keys(JSON.parse(raw).entries).length : 0}（上限 ${KLINE_MAX_ENTRIES}）`);

    check(`${code} 读取`, '持久化无此 key 时，不应把内存孤岛副本当作有效缓存返回',
      orphan === false, 'fixed',
      orphan
        ? `返回旧数据 tag=${got.items[0].tag}（${got.items.length} 根），且 isKlineCacheStale=${stale} ⇒ 旧数据被当作新鲜缓存命中，直接进入 K 线图（api.js:473）`
        : `未暴露孤岛副本（读=${got ? got.items[0].tag : 'null'}）`);
  } catch (err) {
    check(`${code} 读取`, '存储孤岛副本读取', false, 'fixed', `异常 ${err.message}`);
  }
}

// ---------------------------------------------------------------- BUG-02：声称的修复确实生效
{
  const code = 'BUG-02';
  try {
    const S = await mod('src/js/storage.js');
    const { klineCacheSet, klineCacheHas } = S;
    const mkK = (c, n) => ({ code: c, items: Array.from({ length: n }, (_, i) => ({ time: i, close: i })) });

    _store.clear();
    _mode = 'quota';
    klineCacheSet('mem1', '1d', mkK('mem1', 7));   // 永久失败 → 内存
    _mode = 'ok';
    klineCacheSet('disk2', '1d', mkK('disk2', 9)); // 配额恢复 → 持久化

    check(code, '配额恢复后，先前降级到内存的条目仍可见（本次修复的目标行为）',
      klineCacheHas('mem1', '1d') === true, 'fixed',
      `has(mem1)=${klineCacheHas('mem1', '1d')}`);
  } catch (err) {
    check(code, 'BUG-02 降级可见性', false, 'fixed', `异常 ${err.message}`);
  }
}

// ---------------------------------------------------------------- BUG-03：open/ratio 行补丁
{
  const code = 'BUG-03';
  try {
    const V = await mod('src/js/limitUpView.js');
    const F = await mod('src/js/format.js');
    const { renderLimitUpPage, patchLimitUpRows } = V;

    const item = {
      code: 'sh600519', name: '贵州茅台', price: 1800, change: 100, changePercent: 10,
      open: 0, volumeRatio: undefined, limitUpCount: 1, lastLimitTime: '09:35', breakCount: 0,
      isST: false, amount: 1000000000, reason: '白酒'
    };
    const state = {
      items: [item],
      groups: [
        { key: '3+', label: '3+', items: [] }, { key: '2', label: '2', items: [] },
        { key: '1', label: '1', items: [item] }, { key: 'broken', label: 'broken', items: [] }
      ],
      groupSort: {}, sortKey: 'amount', selectedCodes: new Set(), expandedCodes: new Set(),
      chartInstances: new Map(), pinnedCodes: new Set(), lastUpdate: null, loading: false,
      error: null, refreshInterval: 30000, autoRefreshEnabled: true
    };
    const root = win.document.createElement('div');
    win.document.body.appendChild(root);
    renderLimitUpPage(root, state, {});

    item.open = 1808.5; item.volumeRatio = 1.85;
    let ok = false;
    try { ok = patchLimitUpRows(root, state); } catch { ok = false; }
    const row = root.querySelector('tr[data-code="sh600519"]');
    const openTxt = row ? row.querySelector('[data-field="open"]').textContent : '(无行)';
    const ratioTxt = row ? row.querySelector('[data-field="ratio"]').textContent : '(无行)';

    check(`${code} open`, '行情富集后「开盘价」就地补丁与 state 一致',
      ok === true && openTxt === F.formatNumber(1808.5), 'fixed',
      `patch返回=${ok} DOM=${openTxt} 期望=${F.formatNumber(1808.5)}`);
    check(`${code} ratio`, '行情富集后「量比」就地补丁与 state 一致',
      ok === true && ratioTxt === F.formatNumber(1.85), 'fixed',
      `patch返回=${ok} DOM=${ratioTxt} 期望=${F.formatNumber(1.85)}`);
  } catch (err) {
    check(`${code} open`, 'open 行补丁', false, 'fixed', `异常 ${err.message}`);
    check(`${code} ratio`, 'ratio 行补丁', false, 'fixed', `异常 ${err.message}`);
  }
}

// ---------------------------------------------------------------- 输出
const want = (r) => (r.mode === 'both' ? true : MODE === 'fixed');
const judged = rows.filter((r) => r.mode !== 'skip');
const failed = judged.filter((r) => r.pass !== want(r));

console.log(`\n=== 独立审查复现（round 1，--expect=${MODE}）===\n`);
for (const r of rows) {
  const tag = r.mode === 'skip' ? 'SKIP' : r.pass ? '  P ' : '  F ';
  console.log(`${tag} [${r.id}] ${r.label}`);
  if (r.detail) console.log(`        ${r.detail}`);
}
console.log(`\n判定：${judged.length - failed.length}/${judged.length} 条符合 --expect=${MODE} 的预期` +
  (skipped ? `（另有 ${skipped} 条跳过）` : ''));
if (failed.length) {
  console.log('\n与预期不符：');
  for (const r of failed) console.log(`  - [${r.id}] ${r.label} → 实际 ${r.pass ? 'PASS' : 'FAIL'}`);
}
process.exit(failed.length ? 1 : 0);
