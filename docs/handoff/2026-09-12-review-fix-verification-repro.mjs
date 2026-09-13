#!/usr/bin/env node
/**
 * 独立复现：核实提交 b601d1b「闭环修复独立审查报告缺陷 (BUG-01~04/P0-3/OPT-02)」是否真正生效。
 *
 * 用法：
 *   node docs/handoff/2026-09-12-review-fix-verification-repro.mjs --expect=fixed
 *   node docs/handoff/2026-09-12-review-fix-verification-repro.mjs --expect=broken
 *
 * broken 基线 = 0f134e3（`docs: independent full codebase review and recommendations`，
 *              即修复提交 b601d1b 的父提交）。注意：不要用 3e4486e —— 那是本次审查报告
 *              自称的「当前基线」，但它早于报告提交本身，缺少报告文档。
 *
 * 约定：只 import 仓库真实模块，不 mock 被测逻辑；唯一被替身的是网络层
 *      （globalThis.fetch）与 localStorage（仓库既有的 setStorageAdapter 注入点）。
 *      零第三方依赖（jsdom 是仓库既有 devDependency）。
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODE = process.argv.includes('--expect=broken') ? 'broken' : 'fixed';
process.env.MARKET_VOICE_CACHE_ROOT = await mkdtemp(join(tmpdir(), 'mv-repro-'));
process.env.DISABLE_BACKGROUND_JOBS = '1';

const repoRoot = new URL('../../', import.meta.url);
const mod = (p) => import(new URL(p, repoRoot).href);

// ---------------------------------------------------------------- 结果记账
const rows = [];
let skipped = 0;
function check(id, label, pass, mode = 'fix', detail = '') {
  if (mode === 'skip') { skipped++; rows.push({ id, label, pass: null, mode, detail }); return; }
  rows.push({ id, label, pass: !!pass, mode, detail });
}

// ---------------------------------------------------------------- jsdom 环境
// 与 tests/_jsdom-setup.cjs 保持同一套全局暴露（控制器内部用的是全局 document）。
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
const win = dom.window;
const expose = (name, value) => {
  try { Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false }); }
  catch { globalThis[name] = value; }
};
for (const [n, v] of [
  ['window', win], ['document', win.document], ['navigator', win.navigator],
  ['HTMLElement', win.HTMLElement], ['Node', win.Node], ['Event', win.Event],
  ['CustomEvent', win.CustomEvent], ['HashChangeEvent', win.HashChangeEvent],
  ['localStorage', undefined]
]) expose(n, v);
expose('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
expose('cancelAnimationFrame', (id) => clearTimeout(id));
expose('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
expose('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));

// ---------------------------------------------------------------- BUG-01 MIME
{
  const probes = [['probe.mjs', 'text/javascript; charset=utf-8'], ['probe.txt', 'text/plain; charset=utf-8'], ['probe.wasm', 'application/wasm']];
  const distDir = new URL('dist/', repoRoot).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  let server = null;
  try {
    await mkdir(distDir, { recursive: true });
    for (const [name] of probes) await writeFile(join(distDir, name), name === 'probe.wasm' ? 'x' : 'probe');
    const { createAppServer } = await mod('server/index.js');
    server = createAppServer();
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const port = server.address().port;
    for (const [name, want] of probes) {
      const res = await fetch(`http://127.0.0.1:${port}/${name}`);
      const got = String(res.headers.get('content-type') || '');
      await res.arrayBuffer();
      check(`BUG-01 ${name}`, `静态资源 ${name} 返回 ${want}`, got === want, 'fix', `实际 ${got || '(空)'}`);
    }
  } catch (err) {
    for (const [name] of probes) check(`BUG-01 ${name}`, `静态资源 ${name} 探测`, false, 'fix', `探测异常 ${err.message}`);
  } finally {
    if (server) { try { server.closeAllConnections(); server.close(); } catch { /* ignore */ } }
    for (const [name] of probes) { try { await rm(join(distDir, name), { force: true }); } catch { /* ignore */ } }
  }
}

// ---------------------------------------------------------------- BUG-02 storage LRU
{
  const storage = await mod('src/js/storage.js');
  const mockStorage = () => {
    const map = new Map();
    return {
      map,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); }
    };
  };
  const bar = (i) => ({ items: [{ time: i, close: i }], code: `c${i}`, period: '1d' });

  // B-1 持久化彻底失败时必须降级为会话内存缓存，且能被读回
  try {
    storage.setStorageAdapter(null);
    storage.klineCacheClear();
    const mock = mockStorage();
    mock.setItem = () => { throw new Error('QuotaExceededError(always)'); };
    storage.setStorageAdapter(mock);
    storage.klineCacheSet('sh600519', '1d', bar(1));
    const has = storage.klineCacheHas('sh600519', '1d');
    const data = storage.klineCacheGet('sh600519', '1d');
    check('BUG-02a', '写入永久失败后仍可从会话内存缓存读回', has && !!data && data.items.length === 1, 'fix',
      `has=${has} data=${data ? 'ok' : 'null'}`);
  } catch (err) {
    check('BUG-02a', '写入永久失败后仍可从会话内存缓存读回', false, 'fix', `异常 ${err.message}`);
  }

  // B-2 50% 淘汰仍超限时必须继续裁剪至 3 条
  try {
    storage.setStorageAdapter(null);
    storage.klineCacheClear();
    const mock = mockStorage();
    storage.setStorageAdapter(mock);
    for (let i = 1; i <= 6; i++) storage.klineCacheSet(`c${i}`, '1d', bar(i));
    const raw = JSON.parse(mock.map.get('kline-cache-v1'));
    for (let i = 1; i <= 6; i++) raw.entries[`c${i}|1d`].lastAccessedAt = i * 1000;
    mock.map.set('kline-cache-v1', JSON.stringify(raw));
    let attempts = 0;
    const origSet = mock.setItem.bind(mock);
    mock.setItem = (k, v) => { attempts++; if (attempts <= 2) throw new Error('QuotaExceededError(first two writes)'); origSet(k, v); };
    storage.klineCacheSet('c7', '1d', bar(7));
    const has = (i) => storage.klineCacheHas(`c${i}`, '1d');
    const kept = [1, 2, 3, 4, 5, 6, 7].filter(has);
    check('BUG-02b', '二次超限后继续裁剪至仅保留最新 3 条', JSON.stringify(kept) === JSON.stringify([5, 6, 7]), 'fix',
      `保留=${JSON.stringify(kept)} attempts=${attempts}`);
  } catch (err) {
    check('BUG-02b', '二次超限后继续裁剪至仅保留最新 3 条', false, 'fix', `异常 ${err.message}`);
  } finally {
    storage.setStorageAdapter(null);
    storage.klineCacheClear();
  }
}

// ---------------------------------------------------------------- BUG-04 图表视口
{
  const { applyKlineDataToChart } = await mod('src/js/controllers/chartRowController.js');
  const calls = [];
  const ctl = {
    setPeriod() {}, setKline() {}, setVolume() {}, setMA() {}, clearMA() {}, setMarker() {},
    getVisibleRange: () => ({ from: 111, to: 222 }),
    setVisibleRange: (r) => { calls.push({ fn: 'setVisibleRange', r }); return true; },
    fitContent: () => { calls.push({ fn: 'fitContent' }); }
  };
  const items = [
    { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 10 },
    { time: 2, open: 2, high: 3, low: 2, close: 3, volume: 20 }
  ];
  const inst = { period: '1d', _visibleRange: null };
  try {
    applyKlineDataToChart(ctl, inst, { code: 'sh600519', name: '贵州茅台', items });
    const fitCalled = calls.some((c) => c.fn === 'fitContent');
    const restored = calls.find((c) => c.fn === 'setVisibleRange');
    check('BUG-04a', 'SWR 回填时保留用户实时视口、不再强制 fitContent()',
      !fitCalled && !!restored && restored.r.from === 111, 'fix',
      `调用序列=${JSON.stringify(calls)}`);
  } catch (err) {
    check('BUG-04a', 'SWR 回填时保留用户实时视口、不再强制 fitContent()', false, 'fix', `异常 ${err.message}`);
  }

  // 订阅接口必须真的挂在 timeScale 的可见时间范围事件上（lightweight-charts 4.2.3）
  try {
    const { readFile } = await import('node:fs/promises');
    const chartSrc = await readFile(new URL('src/js/chart.js', repoRoot), 'utf8');
    const pkg = JSON.parse(await readFile(new URL('node_modules/lightweight-charts/package.json', repoRoot), 'utf8'));
    const distSrc = await readFile(new URL('node_modules/lightweight-charts/dist/lightweight-charts.production.mjs', repoRoot), 'utf8');
    const wired = chartSrc.includes('subscribeVisibleTimeRangeChange') && chartSrc.includes('subscribeVisibleRange');
    const apiExists = distSrc.includes('subscribeVisibleTimeRangeChange');
    check('BUG-04b', `视口订阅接线成立（lightweight-charts ${pkg.version} 确有该 API）`,
      wired && apiExists, 'fix', `wired=${wired} apiExists=${apiExists} version=${pkg.version}`);
  } catch (err) {
    check('BUG-04b', '视口订阅接线成立', false, 'fix', `异常 ${err.message}`);
  }
}

// ---------------------------------------------------------------- P0-3 TXT 导出
{
  const { renderToolbarView } = await mod('src/js/views/toolbarView.js');
  const { makeExportFilename, stripPrefix } = await mod('src/js/format.js');
  const { buildExportText } = await mod('src/js/services/batchExportService.js');
  let got = null;
  let btn = null;
  try {
    const view = renderToolbarView({ handlers: { onExport: (scope, format) => { got = { scope, format }; } } });
    btn = view.querySelector('#btn-export-selected-txt');
    if (btn) btn.click();
  } catch (err) {
    check('P0-3', '工具栏提供 TXT 纯代码导出入口', false, 'fix', `异常 ${err.message}`);
  }
  check('P0-3', '工具栏提供 TXT 纯代码导出入口（导出选中 TXT → onExport(selected, txt)）',
    !!btn && !!got && got.scope === 'selected' && got.format === 'txt', 'fix',
    `button=${!!btn} dispatched=${JSON.stringify(got)}`);

  // 内容契约（SPEC.md §3.2）：每行 6 位纯数字、无前缀；文件名 stocks-YYYYMMDD.txt
  const text = buildExportText(['sh600519', 'sz000858', 'nf2510']);
  const lines = text.split('\n');
  const contentOk = lines[0] === stripPrefix('sh600519') && lines[1] === '000858' && /^\d{6}$/.test(lines[0]);
  check('P0-3 内容契约', 'buildExportText 输出每行 6 位纯数字无前缀', contentOk, 'both', JSON.stringify(text));
  check('P0-3 文件名', "TXT 导出走同一文件名助手，扩展名为 .txt",
    /^stocks_\d{8}_\d{6}\.txt$/.test(makeExportFilename('stocks', new Date(2026, 8, 12, 10, 30, 0), 'txt')), 'both',
    makeExportFilename('stocks', new Date(2026, 8, 12, 10, 30, 0), 'txt'));
  // 已知边界（本次新暴露的 UI 入口带来）：自选里的期货代码会被 stripPrefix 成 4 位裸数字，
  // 与 SPEC.md §3.2「每行一个 6 位纯数字股票代码」的导入语义不符，第三方看盘软件无法识别。
  check('P0-3 期货边界', 'TXT 导出对期货代码的行为（6 位数字契约并不成立）',
    buildExportText(['nf2510']) === '2510', 'both', `buildExportText(['nf2510']) = ${JSON.stringify(buildExportText(['nf2510']))}`);
}

// ---------------------------------------------------------------- OPT-02 VWAP 行为保持
{
  // 内联「修复前」的三处原始实现（逐字抄自 0f134e3 的 src/js/api.js:296-308、
  // src/js/parser.js:313-320、server/intradayService.js:71-84），用于差分比对。
  const oldDecorate = (cumAmount, cumVolume, close) => {
    if (cumVolume > 0 && cumAmount > 0) {
      const rawRatio = cumAmount / cumVolume;
      const closePrice = Number(close);
      if (Number.isFinite(closePrice) && closePrice > 0) {
        if (rawRatio >= closePrice * 0.1 && rawRatio <= closePrice * 10) return Math.round(rawRatio * 1000) / 1000;
        if ((rawRatio / 100) >= closePrice * 0.1 && (rawRatio / 100) <= closePrice * 10) return Math.round((rawRatio / 100) * 1000) / 1000;
      }
    }
    return 0;
  };
  const oldParser = (cumAmount, cumVolume, price) => {
    if (Number.isFinite(cumAmount) && Number.isFinite(cumVolume) && cumVolume > 0) {
      const raw = cumAmount / (cumVolume * 100);
      if (raw >= price * 0.1 && raw <= price * 10) return Math.round(raw * 1000) / 1000;
    }
    return 0;
  };
  let qm = null;
  try { qm = await mod('src/js/services/quoteMath.js'); } catch { qm = null; }
  if (!qm || typeof qm.computeVwap !== 'function') {
    check('OPT-02', 'computeVwap 与三处旧实现输出一致', null, 'skip', '模块不存在（broken 基线预期）');
  } else {
    // 每行 [累计成交额, 累计成交量, 现价]；两处旧实现用同一个现价参数调用，避免脚本自身
    // 用不同价格比较两个站点造成假差异。
    const matrix = [
      [2310000000, 1250000, 1850],
      [10500, 1000, 10],
      [10500, 10, 10],
      [105000, 1000, 10],
      [0, 1000, 10],
      [100, 0, 10],
      [100, 100, 0],
      [-100, 100, 10],
      [50, 1000, 10],
      [20000000, 1000, 10],
      [NaN, 100, 10],
      [100, NaN, 10],
      [100, 100, NaN],
      [86400000, 300000, 2.88],
      [1e12, 1e6, 100]
    ];
    const diffs = [];
    for (const [amt, vol, price] of matrix) {
      const a = qm.computeVwap(amt, vol, price);
      const b = qm.computeVwap(amt, vol, price, true);
      const oa = oldDecorate(amt, vol, price);
      const ob = oldParser(amt, vol, price);
      if (!Object.is(a, oa)) diffs.push(`decorate(amt=${amt},vol=${vol},price=${price}): new=${a} old=${oa}`);
      if (!Object.is(b, ob)) diffs.push(`parser(amt=${amt},vol=${vol},price=${price}): new=${b} old=${ob}`);
    }
    check('OPT-02', 'computeVwap 与三处旧实现输出逐点一致', diffs.length === 0, 'both',
      diffs.length ? diffs.join(' | ') : `${matrix.length} 组输入 × 2 站点全部一致`);
  }
}

// ---------------------------------------------------------------- BUG-03 涨停看板局部补丁
{
  const code = 'BUG-03';
  const labelOpen = '行情富集后「开盘价」单元格必须与 state 一致';
  const labelRatio = '行情富集后「量比」单元格必须与 state 一致';
  try {
    const { createLimitUpController, limitUpRowsMatchDom } = await mod('src/js/controllers/limitUpController.js');
    const { parseAktoolsLimitUpList } = await mod('src/js/aktoolsApi.js');
    const { formatNumber } = await mod('src/js/format.js');
    const { getBeijingDate, shiftCalendarDate } = await mod('src/js/time.js');

    const SPECS = [
      { 代码: '600519', 名称: '贵州茅台', 最新价: 1850, 涨跌幅: 10.01, 成交额: 3000000000, 连板数: 5, 首次封板时间: '092500', 最后封板时间: '092500', 炸板次数: 0, 所属行业: '白酒', 涨停统计: '5/5' },
      { 代码: '000858', 名称: '五粮液', 最新价: 165.5, 涨跌幅: 10.02, 成交额: 2000000000, 连板数: 2, 首次封板时间: '094000', 最后封板时间: '094000', 炸板次数: 0, 所属行业: '白酒', 涨停统计: '2/2' },
      { 代码: '600036', 名称: '招商银行', 最新价: 38.5, 涨跌幅: 10.01, 成交额: 1000000000, 连板数: 1, 首次封板时间: '101500', 最后封板时间: '101500', 炸板次数: 0, 所属行业: '银行', 涨停统计: '1/1' }
    ];
    const serverItems = parseAktoolsLimitUpList(SPECS, 'limitUp');
    const today = getBeijingDate();
    const dates = [shiftCalendarDate(today, -2), shiftCalendarDate(today, -1), today];

    // 腾讯行情行：字段序号照 parser.parseTencent（0-based 5=open，32=涨跌幅，35=price/volume/amount，49=量比）。
    // 涨跌幅与金额刻意与 items 保持一致，确保分组与排序不变（即结构不变，走局部补丁分支）。
    const quoteLine = (it, open, ratio) => {
      const f = new Array(60).fill('0');
      f[0] = '1'; f[1] = it.code; f[2] = it.code.slice(2);
      f[3] = String(it.price); f[4] = String(it.price / (1 + it.changePercent / 100)); f[5] = String(open);
      f[6] = '100000'; f[30] = `${today.replace(/-/g, '')}103500`;
      f[31] = String(it.change); f[32] = String(it.changePercent); f[33] = String(it.price); f[34] = String(open);
      f[35] = `${it.price}/100000/${it.amount}`;
      f[49] = String(ratio);
      return `v_${it.code}="${f.join('~')}";`;
    };
    const OPEN = { sh600519: 1808, sz000858: 165, sh600036: 38.2 };
    const RATIO = { sh600519: 1.85, sz000858: 2.4, sh600036: 3.1 };
    const quoteBody = serverItems.map((it) => quoteLine(it, OPEN[it.code], RATIO[it.code])).join('\n');

    const routes = [
      ['/api/cache/calendar/trade-dates', { ok: true, data: { dates } }],
      ['/api/cache/limit-up/reasons', { ok: true, data: { reasons: [] } }],
      ['/api/cache/limit-up', { ok: true, data: { limitUpItems: serverItems, brokenItems: [] } }]
    ];
    globalThis.fetch = async (url) => {
      const target = String(url);
      const hit = routes.find(([p]) => target.includes(p));
      if (hit) return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json' } });
      if (target.includes('/api/tencent')) {
        return new Response(new TextEncoder().encode(quoteBody), { status: 200, headers: { 'content-type': 'text/html; charset=GBK' } });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    };

    const appState = {
      quotes: new Map(),
      limitUp: {
        items: [], groups: [], tradingDates: [], latestTradingDate: null, previousTradingDate: null,
        nextTradingDate: null, calendarLoading: false, lastUpdate: null, loading: false, error: null,
        refreshInterval: 30000, timer: null, autoRefreshEnabled: true, autoRefreshPausedBySchedule: false,
        abort: null, requestSeq: 0, lastNonEmptyItems: [], lastNonEmptyAt: null, consecutiveEmptyFetches: 0,
        forceRefreshOnce: false, sortKey: 'amount', groupSort: {}, selectedCodes: new Set(),
        expandedCodes: new Set(), chartInstances: new Map(), selectedDate: null, reasonMap: new Map(),
        pinnedCodes: new Set()
      }
    };
    const controller = createLimitUpController({
      getState: () => appState,
      limitUpChartMgr: { destroyCharts() {}, mountCharts() {}, applyLiveTick() {}, loadKline() {} },
      onNavigate() {}, onAddToWatchList() {}, flashInfo() {}, refreshNow() {}, renderData() {},
      isDataAutoRefreshAllowedNow: () => false,
      preloadKlineForCodes() {}
    });
    const root = win.document.createElement('div');
    win.document.body.appendChild(root);
    controller.setRootEl(root);
    controller.render();
    await controller.fetch();
    for (let i = 0; i < 60; i++) {
      const anyOpen = appState.limitUp.items.some((it) => Number(it.open) > 0);
      if (anyOpen) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const lu = appState.limitUp;
    const enriched = lu.items.some((it) => Number(it.open) > 0);
    check(`${code} 前置`, '行情富集确实执行（state.open 由 0 变为真实开盘价）', enriched, 'both',
      `open=${JSON.stringify(lu.items.map((it) => it.open))}`);

    const groupsSection = root.querySelector('#lu-groups');
    const structuralMatch = limitUpRowsMatchDom(groupsSection, lu.groups, lu.items, lu.pinnedCodes, lu.pinnedSort);
    const domRows = [...groupsSection.querySelectorAll('tr[data-code]')];

    // 断言对象：state 里已更新的字段，DOM 必须同步
    for (const [field, fieldLabel, table] of [['open', labelOpen, OPEN], ['ratio', labelRatio, RATIO]]) {
      const mismatches = [];
      for (const it of lu.items) {
        const row = domRows.find((r) => r.getAttribute('data-code') === it.code);
        if (!row) { mismatches.push(`${it.code}: 无对应行`); continue; }
        const cell = row.querySelector(`[data-field="${field}"]`);
        const want = formatNumber(it[field === 'ratio' ? 'volumeRatio' : 'open']);
        const gotText = cell ? cell.textContent : '(无单元格)';
        if (gotText !== want) mismatches.push(`${it.code}: DOM=${gotText} state=${want}(源值${it[field === 'ratio' ? 'volumeRatio' : 'open']})`);
      }
      check(`${code} ${field}`, `${fieldLabel}（结构一致=${structuralMatch}，即走局部补丁分支）`,
        mismatches.length === 0, 'fix', mismatches.length ? mismatches.join(' | ') : '全部一致');
    }
  } catch (err) {
    check(`${code} open`, labelOpen, false, 'fix', `异常 ${err.message}`);
    check(`${code} ratio`, labelRatio, false, 'fix', `异常 ${err.message}`);
  }
}

// ---------------------------------------------------------------- 输出
const want = (row) => (row.mode === 'both' ? true : MODE === 'fixed');
const judged = rows.filter((r) => r.mode !== 'skip');
const failed = judged.filter((r) => r.pass !== want(r));

console.log(`\n=== b601d1b 审查缺陷修复核实（--expect=${MODE}）===\n`);
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
