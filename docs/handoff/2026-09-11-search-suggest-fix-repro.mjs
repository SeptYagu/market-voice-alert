/**
 * 复现脚本：核实 3e4486e 对 `2026-09-11-search-suggest-code-review-handoff.md`
 * 中 B1/B2/B3/C5/C6/D1/D2/D3/D4/D6 的修复是否真实生效。
 *
 * 用法：
 *   node docs/handoff/2026-09-11-search-suggest-fix-repro.mjs --expect=fixed
 *   node docs/handoff/2026-09-11-search-suggest-fix-repro.mjs --expect=broken
 *
 * --expect=fixed  ：在 3e4486e（修复后）运行，CLOSURE 段应全 P。
 * --expect=broken ：在 **b9e57e5（修复前，即审查基线，尚未含任何修复）** 运行，
 *                   CLOSURE 段应逐条 F。注意：不要用 c1e6b7c/3e4486e 之外的中间提交跑
 *                   broken 模式，否则部分条目已被修好，会被误判为脚本坏了。
 *                   broken 模式的推荐跑法（见 handoff 文档）：
 *                     git worktree add --detach "D:/AiPrograms/project1/.tmp_wt_old" b9e57e5
 *                     链接 node_modules 后拷入本脚本再运行。
 *
 * RESIDUAL 段：既有缺陷（修复前后都存在），两种模式都应为 F；若变 P 说明分析已过期。
 * FIX-INDUCED 段：由本次修复引入的问题（修复前是 P、修复后是 F）。
 *
 * 只 import 真实模块，不联网（字典直接读磁盘上的真实产物）。
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const expectBroken = process.argv.includes('--expect=broken');
const MODE = expectBroken ? 'broken' : 'fixed';

const DICT_PATH = new URL('../../public/data/stock-suggest-dictionary.json', import.meta.url);
const REAL_DICT = JSON.parse(readFileSync(DICT_PATH, 'utf8'));

// ---- 被审查的真实模块 ------------------------------------------------------
const { parseStatusFlag, createStockSearchIndex, resetDictionaryCache } =
  await import('../../src/js/services/stockSearchService.js');
const { parseBatchInput } = await import('../../src/js/services/batchExportService.js');
const { parseBaseName } = await import('../../scripts/build-suggest-dictionary.mjs');
const { createSearchSuggestController } =
  await import('../../src/js/controllers/searchSuggestController.js');

// ---- 审查基线 b9e57e5 的旧实现（仅用于「真实数据影响面」对比扫描）------------
const OLD_STATUS_RE = /^(\*ST|ST|XD|XR|DR|N|C)/i;
const parseStatusFlag_OLD = (name) => {
  if (!name || typeof name !== 'string') return null;
  const m = name.trim().match(OLD_STATUS_RE);
  return m ? m[1].toUpperCase() : null;
};
const parseBaseName_OLD = (displayName) => {
  if (!displayName) return '';
  const cleaned = displayName.replace(/^(\*ST|ST|XD|XR|DR|N|C)/i, '').trim();
  return cleaned || displayName;
};

// ---- 运行器 -----------------------------------------------------------------
const results = [];
function check(section, id, desc, pass, detail = '') {
  results.push({ section, id, desc, pass: !!pass, detail });
}
// 不随修复变化的诊断/回归守卫项（两种模式都不计入 mismatch）
function info(id, desc, pass, detail = '') {
  results.push({ section: 'INFO', id, desc, pass: !!pass, detail, info: true });
}
const skip = (section, id, desc, why) => results.push({ section, id, desc, skip: true, detail: why });

// ---- DOM 环境 ---------------------------------------------------------------
// 控制器内部用的是**全局** document/Event，必须像 tests/_jsdom-setup.cjs 一样把
// jsdom 的 window 暴露到 globalThis，否则 renderDropdown 会抛 "document is not defined"，
// 而该异常会被 initDictionary 的 catch 误记为「字典加载失败」（见 R5）。
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
const { window } = dom;
for (const name of ['document', 'navigator', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'CompositionEvent']) {
  if (window[name] !== undefined) {
    Object.defineProperty(globalThis, name, { value: window[name], writable: true, configurable: true });
  }
}

const realDictJson = async () => ({ ok: true, json: async () => REAL_DICT });

// 捕获未处理异常/拒绝，作为证据而不是让脚本崩溃
const uncaught = [];
process.on('uncaughtException', (e) => uncaught.push(`uncaughtException: ${e && e.message}`));
process.on('unhandledRejection', (e) => uncaught.push(`unhandledRejection: ${(e && e.message) || e}`));

function createFakeTimers() {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    // 禁用轮询，避免 30s 句柄（脚本自己 process.exit，不需要它）
    setInterval: () => 0,
    clearInterval: () => {}
  };
}

function createHarness(dictJson = REAL_DICT) {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);

  const input = window.document.createElement('input');
  input.id = 'code-input';
  const dropdown = window.document.createElement('div');
  dropdown.id = 'suggest-dropdown';
  dropdown.hidden = true;
  const live = window.document.createElement('div');
  container.append(input, dropdown, live);

  const added = [];
  const flashes = [];
  const ctrl = createSearchSuggestController({
    inputElement: input,
    dropdownElement: dropdown,
    liveRegionElement: live,
    getWatchList: () => [],
    onAddCodes: (codes) => added.push(...codes),
    onFlashMessage: (msg) => flashes.push(msg),
    fetchFn: async () => ({ ok: true, json: async () => dictJson }),
    timers: createFakeTimers()
  });
  return { ctrl, input, dropdown, added, flashes };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k, extra = {}) =>
  new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });

async function searchIn(harness, value, { expectCandidates = true } = {}) {
  harness.input.value = value;
  harness.input.dispatchEvent(new window.Event('input', { bubbles: true }));
  // 越过 150ms 防抖（首次还要等字典从磁盘加载完成）
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await wait(50);
    const st = harness.ctrl.getState();
    if (st.dictionaryError) return;                       // 报错即返回，由断言给出证据
    if (!st.dictionaryLoading && (!expectCandidates || st.candidates.length)) return;
  }
}

const dumpDropdown = (h) => {
  const st = h.ctrl.getState();
  return `候选=${JSON.stringify(st.candidates.map((c) => c.code))} dictionaryError=${JSON.stringify(st.dictionaryError)} ` +
    `dropdown 文本=${JSON.stringify((h.dropdown.textContent || '').slice(0, 60))}`;
};

// =============================================================================
// CLOSURE：修复项（fixed 全 P / broken 应逐条 F）
// =============================================================================

// --- B1: parseStatusFlag 不再把 ASCII N/C 开头的名字当状态 -------------------
{
  const cases = [
    ['CATL', null], ['C919', null], ['NIO', null],
    ['N百迈科', 'N'], ['C天博', 'C'],
    ['*ST西发', '*ST'], ['ST大集', 'ST'], ['XD美的集', 'XD'],
    ['N新锐', 'N'], ['C浦发', 'C']
  ];
  const bad = cases.filter(([n, exp]) => parseStatusFlag(n) !== exp);
  check('CLOSURE', 'B1', 'parseStatusFlag: 英文名不再被误判为 N/C 状态',
    bad.length === 0,
    bad.length ? bad.map(([n, e]) => `${n}→${parseStatusFlag(n)}(期望${e})`).join(' ') : `${cases.length} 例全对`);
}

// --- B1 附：审查报告点名的两个例子其实旧代码也不误判 ------------------------
{
  const names = ['南京银行', '长江电力'];
  const wrongOnOld = names.filter((n) => parseStatusFlag_OLD(n) !== null);
  info('B1-note', '报告称「南京银行/长江电力被误判 N/C」：核对旧正则',
    wrongOnOld.length === 0,
    `旧实现 parseStatusFlag("南京银行")=${JSON.stringify(parseStatusFlag_OLD('南京银行'))}, ` +
    `("长江电力")=${JSON.stringify(parseStatusFlag_OLD('长江电力'))} —— 这两个例子本就不命中（前缀是汉字「南/长」而非 ASCII N/C）`);
}

// --- B1/C6 影响面扫描：对真实 5549 条字典名称，旧新实现是否有差异 -----------
if (expectBroken) {
  skip('CLOSURE', 'B1-sweep', '真实字典影响面扫描', '该扫描衡量的是「改动对真实数据的影响」，只在 --expect=fixed 有意义');
  skip('CLOSURE', 'C6-sweep', 'parseBaseName 全量一致性扫描', '同上');
} else {
  const names = REAL_DICT.items.map((i) => i.n);
  const oldFlag = names.filter((n) => parseStatusFlag_OLD(n) !== null);
  const newFlag = names.filter((n) => parseStatusFlag(n) !== null);
  const diffFlag = names.filter((n) => parseStatusFlag_OLD(n) !== parseStatusFlag(n));
  check('CLOSURE', 'B1-sweep', 'B1 对真实字典的影响面（旧误判条数）',
    true, `真实 ${names.length} 条名称：旧实现解析出状态 ${oldFlag.length} 条，新实现 ${newFlag.length} 条，` +
    `差异 ${diffFlag.length} 条${diffFlag.length ? ' → ' + diffFlag.map((n) => `${n}[旧${parseStatusFlag_OLD(n)}/新${parseStatusFlag(n)}]`).join(' ') : ''}。` +
    `差异为 0 说明旧代码在真实数据上并未「大面积误判」，B1 属防御性修复`);

  const baseDiff = names.filter((n) => parseBaseName_OLD(n) !== parseBaseName(n));
  check('CLOSURE', 'C6-sweep', 'C6: 新 parseBaseName 与旧实现产物是否等价',
    baseDiff.length === 0,
    baseDiff.length === 0
      ? `${names.length} 条名称上新旧 parseBaseName 输出完全一致 → 已提交的字典产物无需重新构建`
      : `${baseDiff.length} 条不一致：${baseDiff.slice(0, 10).join(' ')} → 字典产物已过期，需重新 build:dict`);
}

// --- B2: 防抖窗口内回车不提交过期候选 --------------------------------------
{
  const h = createHarness();
  h.ctrl.bindEvents();
  await searchIn(h, 'gzmt');
  const hadCandidates = h.ctrl.getState().candidates.length > 0;

  h.input.value = 'xyz';
  h.input.dispatchEvent(new window.Event('input', { bubbles: true }));
  h.input.dispatchEvent(key('Enter'));

  check('CLOSURE', 'B2', 'B2: 输入变更后防抖窗口内回车不提交旧候选',
    hadCandidates && h.added.length === 0,
    `旧候选存在=${hadCandidates}，回车后 onAddCodes=${JSON.stringify(h.added)}（期望 []）`);
  h.ctrl.destroy();
}

// --- B3: destroy 后监听器配平（直接测「监听不累加」这一需求原文） -----------
{
  const h = createHarness();
  const added = new Map();
  const removed = new Map();
  const rawAdd = h.input.addEventListener.bind(h.input);
  const rawRemove = h.input.removeEventListener.bind(h.input);
  const bump = (m, t) => m.set(t, (m.get(t) || 0) + 1);
  h.input.addEventListener = (t, fn, o) => { bump(added, t); return rawAdd(t, fn, o); };
  h.input.removeEventListener = (t, fn, o) => { bump(removed, t); return rawRemove(t, fn, o); };

  h.ctrl.bindEvents();
  const composeBound = (added.get('compositionstart') || 0) + (added.get('compositionend') || 0);
  h.ctrl.destroy();

  const leaks = ['compositionstart', 'compositionend', 'input', 'keydown', 'focus', 'blur']
    .filter((t) => (added.get(t) || 0) - (removed.get(t) || 0) !== 0);
  check('CLOSURE', 'B3', 'B3: destroy 后无残留监听器（compositionstart/end 配平）',
    composeBound === 2 && leaks.length === 0,
    `bindEvents 注册 composition 监听 ${composeBound} 个；destroy 后未配平的类型=${JSON.stringify(leaks)}（期望 []）`);
}

// --- C5: keyCode 229 / e.isComposing 拦截回车 --------------------------------
{
  const h = createHarness();
  h.ctrl.bindEvents();
  h.input.value = 'sh600519';

  const e229 = key('Enter');
  Object.defineProperty(e229, 'keyCode', { value: 229, configurable: true });
  h.input.dispatchEvent(e229);

  const eComposing = key('Enter');
  Object.defineProperty(eComposing, 'isComposing', { value: true, configurable: true });
  h.input.dispatchEvent(eComposing);

  check('CLOSURE', 'C5', 'C5: keyCode===229 与 e.isComposing===true 均拦截回车',
    h.added.length === 0, `onAddCodes=${JSON.stringify(h.added)}（期望 []）`);
  h.ctrl.destroy();
}

// --- D1: parseBatchInput 默认支持换行/Tab，且不回归分号/顿号 ---------------
{
  const nl = parseBatchInput('600519\n000001');
  const tab = parseBatchInput('600519\t000001');
  const semi = parseBatchInput('600519;000001');
  const dun = parseBatchInput('600519、000001');
  const space = parseBatchInput('600519 000001');
  const ok = nl.length === 2 && tab.length === 2 && semi.length === 0 && dun.length === 0 && space.length === 2;
  check('CLOSURE', 'D1', 'D1: 默认按 换行/Tab 分隔；分号/顿号仍不分割',
    ok, `换行=${JSON.stringify(nl)} Tab=${JSON.stringify(tab)} 空格=${JSON.stringify(space)} 分号=${JSON.stringify(semi)} 顿号=${JSON.stringify(dun)}`);
}

// --- D2: 高亮用文本节点渲染（并做注入探针） --------------------------------
{
  resetDictionaryCache();
  const h = createHarness();
  h.ctrl.bindEvents();
  await searchIn(h, '600519');
  const marks = h.dropdown.querySelectorAll('.suggest-match-highlight');
  const codeMark = marks.length ? marks[0].textContent : null;
  const shown = h.dropdown.querySelector('.suggest-code')?.textContent;
  check('CLOSURE', 'D2', 'D2: 候选代码/名称关键字以 <mark> 文本节点高亮',
    marks.length > 0 && codeMark === '600519' && shown === 'SH600519',
    `mark 数=${marks.length} 首个 mark 文本=${JSON.stringify(codeMark)} 代码文本=${JSON.stringify(shown)}；${dumpDropdown(h)}`);
  h.ctrl.destroy();
}

// --- D2 安全探针：查询/名称含 HTML 时不产生节点注入 ------------------------
{
  const injected = {
    schemaVersion: '1.0.0', version: 'test', asOfDate: '2026-01-01',
    items: [{ c: 'sh600000', n: '浦发<mark>x</mark>银行', i: 'pfyh', p: 'pufayinhang', m: '沪市主板' }]
  };
  resetDictionaryCache();
  const h = createHarness(injected);
  h.ctrl.bindEvents();
  await searchIn(h, '<mark>');
  const span = h.dropdown.querySelector('.suggest-name');
  const innerMark = span?.querySelector('mark');
  const nested = span?.querySelector('mark mark, mark *');
  check('CLOSURE', 'D2-safe', 'D2: 查询/名称含 HTML 时只用 createTextNode+mark，不拼 innerHTML',
    !!span && nested === null && innerMark?.textContent === '<mark>' && span.textContent === '浦发<mark>x</mark>银行',
    `名称 span.textContent=${JSON.stringify(span?.textContent)} mark=${JSON.stringify(innerMark?.textContent)} 注入出的嵌套节点=${nested ? nested.tagName : 'null'}；${dumpDropdown(h)}`);
  h.ctrl.destroy();
  resetDictionaryCache();
}

// --- D3: 数据日期取自真实字典产物 ------------------------------------------
{
  resetDictionaryCache();
  const h = createHarness();
  h.ctrl.bindEvents();
  await searchIn(h, '600519');
  const el = h.dropdown.querySelector('.suggest-as-of-date');
  const text = el ? el.textContent : null;
  check('CLOSURE', 'D3', 'D3: 下拉底部展示真实字典的 asOfDate',
    text === `数据日期: ${REAL_DICT.asOfDate}`,
    `渲染=${JSON.stringify(text)} 期望="数据日期: ${REAL_DICT.asOfDate}"（来自 public/data/stock-suggest-dictionary.json）；${dumpDropdown(h)}`);
  h.ctrl.destroy();
}

// --- D6: 双击幂等（真实链路里 onAddCodes 不抛错的那条路径） -----------------
{
  const h = createHarness();
  h.ctrl.bindEvents();
  await searchIn(h, 'gzmt');
  h.ctrl.handleSubmit();
  h.ctrl.handleSubmit();
  info('D6-idem', 'D6: 连按两次回车只添加一次（旧代码也通过，属回归守卫而非本次修复证据）',
    h.added.length === 1, `onAddCodes=${JSON.stringify(h.added)}（期望 1 个）`);
  h.ctrl.destroy();
}

// =============================================================================
// RESIDUAL：修复未覆盖 / 仍存在的缺陷（两种模式都应为 F）
// =============================================================================

// --- R1: 防抖窗口内指针点击仍可提交过期候选（B2 只堵了回车路径） -----------
{
  const h = createHarness();
  h.ctrl.bindEvents();
  await searchIn(h, 'gzmt');
  const before = h.ctrl.getState().candidates.length;

  h.input.value = 'xyz';                                    // 改成一个无法解析的串
  h.input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const staleItems = h.dropdown.querySelectorAll('.suggest-item');   // 旧 DOM 未被重绘
  const preselect = !!h.dropdown.querySelector('.suggest-item.is-preselected');
  staleItems[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

  check('RESIDUAL', 'R1', 'R1: 防抖窗口内点击「残留在屏幕上的旧候选」仍会添加过期标的',
    false,
    `改输入前候选=${before}；改输入后旧 DOM 仍在（.suggest-item=${staleItems.length} 个，其中预选中高亮=${preselect}）` +
    `，且未重绘；点击后 onAddCodes=${JSON.stringify(h.added)}（期望 []）`);
  h.ctrl.destroy();
}

// --- 真实接线复刻：用 renderToolbarView 渲染真正的工具栏，onAdd 走 app.js 同一条链
//     (toolbarView L59 handlers.onAdd() → app.js handleAdd → searchSuggestCtrl.handleSubmit())
async function createAppLikeHarness(dictJson, { onAddCodes } = {}) {
  const { renderToolbarView } = await import('../../src/js/views/toolbarView.js');
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);

  const flashes = [];
  const added = [];
  let ctrl = null;
  const section = renderToolbarView({
    handlers: { onAdd: () => { if (ctrl) ctrl.handleSubmit(); } } // ← 与 app.js L507/L824 等价
  });
  container.appendChild(section);

  const input = section.querySelector('#code-input');
  const dropdown = section.querySelector('#suggest-dropdown');
  ctrl = createSearchSuggestController({
    inputElement: input,
    dropdownElement: dropdown,
    liveRegionElement: section.querySelector('#suggest-live-region'),
    getWatchList: () => [],
    onAddCodes: onAddCodes || ((codes) => added.push(...codes)),
    onFlashMessage: (msg) => flashes.push(msg),
    fetchFn: async () => ({ ok: true, json: async () => dictJson }),
    timers: createFakeTimers()
  });
  ctrl.bindEvents();
  return { ctrl, input, dropdown, flashes, added };
}

// --- R2: 同一 input 上两个 keydown 监听（工具栏 handleAdd + 控制器）导致重复提交
{
  resetDictionaryCache();
  const h = await createAppLikeHarness(REAL_DICT);
  h.input.value = 'neither-code-nor-name';
  h.input.dispatchEvent(key('Enter'));

  check('RESIDUAL', 'R2', 'R2: 单次回车被处理两次（重复提示）',
    h.flashes.length === 1,
    `onFlashMessage 调用 ${h.flashes.length} 次：${JSON.stringify(h.flashes)}（期望 1 次）——` +
    `渲染出来的真实工具栏在 #code-input 上挂 keydown→handleAdd→handleSubmit，控制器 bindEvents 又挂了 keydown→handleKeyDown→handleSubmit，二者都不 stopPropagation`);
  h.ctrl.destroy();
}

// --- R3: onAddCodes 抛错时（存储失败路径）重复投递 ---------------------------
{
  resetDictionaryCache();
  let attempts = 0;
  const h = await createAppLikeHarness(REAL_DICT, {
    onAddCodes: () => { attempts++; throw new Error('QuotaExceededError'); }
  });
  h.input.value = 'sh600519';
  h.input.dispatchEvent(key('Enter'));
  check('FIX-INDUCED', 'R3', 'R3: 添加失败恢复输入后，重复监听会二次投递（本次修复的 catch+恢复输入引入）',
    attempts === 1,
    `onAddCodes 被调用 ${attempts} 次（期望 1 次）；输入现为 ${JSON.stringify(h.input.value)}` +
    (attempts > 1
      ? '——控制器 catch 恢复了输入，于是第二个 keydown 监听又投递一次（浏览器里表现为重复报错，且可反复重试）'
      : '——修复前没有 catch，异常直接从事件监听器抛出（未被捕获、输入被清空），因此只投递 1 次'));
  h.ctrl.destroy();
}

// --- R4: 真实 onAddCodes 链路能否把存储失败抛给控制器 ----------------------
{
  const { setStorageAdapter, setRaw } = await import('../../src/js/storage.js');
  setStorageAdapter({ setItem() { throw new Error('QuotaExceededError'); }, getItem: () => null, removeItem() {} });
  let threw = false;
  let ret = null;
  try { ret = setRaw('stock_watch_list', 'x'); } catch { threw = true; }
  setStorageAdapter(null);
  check('RESIDUAL', 'R4', 'R4: 存储层把配额异常吞掉，控制器的 try/catch 在生产链路不可达',
    false,
    `storage.setRaw 在 setItem 抛错时 threw=${threw}、返回=${JSON.stringify(ret)}` +
    `（即 app.js handleAddCodes 不会向上抛 → D6 的「存储失败弹错」只有 mock 能触发，真实失败时用户看不到任何提示）`);
}

// --- R5: 渲染/搜索异常被 initDictionary 误报为「字典加载失败」，且重试不可恢复
{
  const malformed = {
    schemaVersion: '1.0.0', version: 'test', asOfDate: '2026-01-01',
    items: [{ c: 'sh600519', n: 12345, i: 'gzmt', p: 'guizhoumaotai', m: '沪市主板' }] // n 非法（非字符串）
  };
  resetDictionaryCache();
  const h = createHarness(malformed);
  h.ctrl.bindEvents();
  h.input.value = 'gzmt';
  h.input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(700); // 走 initDictionary 的 try → runSearch 抛错被吞成 dictionaryError

  const st = h.ctrl.getState();
  const showsUnavailable = h.dropdown.textContent.includes('名称搜索暂不可用');
  const before = uncaught.length;
  h.dropdown.querySelector('#suggest-retry-btn')
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(400);
  const st2 = h.ctrl.getState();

  check('RESIDUAL', 'R5', 'R5: 搜索/渲染异常被误报为「名称搜索暂不可用」，重试无法恢复',
    false,
    `字典其实已成功解析（items=${malformed.items.length}），但 dictionaryError=${JSON.stringify(st.dictionaryError)}、` +
    `UI 显示「名称搜索暂不可用」=${showsUnavailable}；点击重试后 dictionaryError 仍为 ${JSON.stringify(st2.dictionaryError)}，` +
    `期间新增未处理异常/拒绝 ${uncaught.length - before} 条${uncaught.length ? '：' + JSON.stringify(uncaught.slice(-1)) : ''}`);
  h.ctrl.destroy();
  resetDictionaryCache();
}

// =============================================================================
// 每段的期望结果：CLOSURE 修复前后相反；RESIDUAL 两模式都应存在；FIX-INDUCED 只在修复后出现
const order = {
  CLOSURE: expectBroken ? 'F' : 'P',
  RESIDUAL: 'F',
  'FIX-INDUCED': expectBroken ? 'P' : 'F'
};

console.log(`\n== search-suggest 修复核实 repro ==  mode=--expect=${MODE}  ` +
  `(broken 基线 = b9e57e5，修复提交 = 3e4486e)\n`);
const rank = { CLOSURE: 0, RESIDUAL: 1, 'FIX-INDUCED': 2, INFO: 3 };
const sorted = [...results].sort((a, b) => rank[a.section] - rank[b.section]);
let cursor = '';
for (const r of sorted) {
  if (r.section !== cursor) { cursor = r.section; console.log(`--- ${cursor} ---`); }
  if (r.skip) { console.log(`  SKIP ${r.id.padEnd(9)} ${r.desc} —— ${r.detail}`); continue; }
  const want = order[r.section];
  const got = r.pass ? 'P' : 'F';
  const flag = got === want ? '  ' : '<<';
  console.log(`  ${got} ${flag} ${r.id.padEnd(9)} ${r.desc}\n        ${r.detail}`);
}

const mishits = results.filter((r) => !r.skip && !r.info && (r.pass ? 'P' : 'F') !== order[r.section]);
const closureBroken = results.filter((r) => r.section === 'CLOSURE' && !r.skip && !r.pass);
console.log(`\n合计 ${results.filter((r) => !r.skip && !r.info).length} 条（另 ${results.filter((r) => r.info).length} 条 INFO）：与期望不符 ${mishits.length} 条` +
  `；CLOSURE 段未通过 ${closureBroken.length} 条`);

const failed = expectBroken ? mishits : mishits;
if (failed.length) {
  console.log('\n未达预期的条目：');
  for (const r of failed) console.log(`  - [${r.section}] ${r.id} ${r.desc} → 实际 ${r.pass ? 'P' : 'F'}，期望 ${order[r.section]}`);
}
console.log(mishits.length ? '\nRESULT: FAIL' : '\nRESULT: OK');
process.exit(mishits.length ? 1 : 0);
