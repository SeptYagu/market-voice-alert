import {
  ChartRowManager,
  createChartState,
  resolveLiveFallbackDate
} from '../src/js/controllers/chartRowController.js';
import { createMonitorController } from '../src/js/controllers/monitorController.js';
import { limitUpChartMgr, limitUpCtrl, _internal } from '../src/js/app.js';
import { getBeijingDate } from '../src/js/time.js';

QUnit.module('limitUpChartFixes - 图表历史日期修复与调度解耦测试矩阵', (hooks) => {
  const RealDate = Date;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let originalFetch;
  const fixedMs = Date.parse('2026-09-14T02:00:00Z'); // 北京时间 2026-09-14 10:00:00

  const registeredTimers = new Map();
  let timerSeq = 1000;

  hooks.beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.Date = class FixedDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedMs])); }
      static now() { return fixedMs; }
    };

    registeredTimers.clear();
    globalThis.setInterval = (fn, ms) => {
      const id = ++timerSeq;
      registeredTimers.set(id, { fn, ms });
      return id;
    };
    globalThis.clearInterval = (id) => {
      registeredTimers.delete(id);
    };
  });

  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.Date = RealDate;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    registeredTimers.clear();
  });

  // 用例 1 & 2: 涨停看板图表初始化交易日解析契约
  QUnit.test('用例 1 & 2: 涨停看板展开标的时，无论看板处于 T-1 还是 T-2 历史日期，默认解析为最新可用交易日', (t) => {
    const { state } = _internal();
    const originalSelectedDate = state.limitUp.selectedDate;
    const originalTradingDates = state.tradingDates;

    state.tradingDates = ['2026-09-10', '2026-09-11', '2026-09-14'];
    const expectedLatestDate = getBeijingDate();

    try {
      // 场景 1: 看板翻到 T-1 历史日期
      state.limitUp.selectedDate = '2026-09-11';
      const resolvedT1 = limitUpChartMgr.resolveTradeDate('sh600519', null);
      t.equal(resolvedT1, expectedLatestDate, 'T-1 历史看板下初始交易日解析为最新可用交易日');

      // 场景 2: 看板翻到 T-2 历史日期
      state.limitUp.selectedDate = '2026-09-10';
      const resolvedT2 = limitUpChartMgr.resolveTradeDate('sh600519', null);
      t.equal(resolvedT2, expectedLatestDate, 'T-2 历史看板下初始交易日解析为最新可用交易日');
    } finally {
      state.limitUp.selectedDate = originalSelectedDate;
      state.tradingDates = originalTradingDates;
    }
  });

  // 用例 3: loadKline 路径实时报价目标日期防污染
  QUnit.test('用例 3: loadKline 遇到缺少日期字段的快照报价时，规范化注入最新交易日追加今日蜡烛，不污染昨日收盘柱', async (t) => {
    const code = 'sh600777';
    const inst = createChartState('1d');
    inst.selectedTradeDate = '2026-09-11'; // 模拟处于历史日期
    inst.klineData = null;

    const instances = new Map([[code, inst]]);
    const tradingDates = ['2026-09-10', '2026-09-11', '2026-09-14'];

    // Mock 静态 K 线返回最后一根为 2026-09-11
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/cache/kline') || String(url).includes('kline')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              code,
              name: '测试股',
              items: [
                { time: '2026-09-10', open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 1000, amount: 10000 },
                { time: '2026-09-11', open: 10.2, high: 11.2, low: 10.1, close: 11.0, volume: 2000, amount: 22000 }
              ]
            }
          })
        };
      }
      if (String(url).includes('/api/cache/intraday') || String(url).includes('intraday')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: { items: [], prevClose: 11.0 }
          })
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const mgr = new ChartRowManager({
      getChartInstances: () => instances,
      getTradingDates: () => tradingDates,
      getQuote: () => ({ price: 21.00 }), // 纯价格无日期快照
      isExpanded: () => true,
      hasIntraday: false
    });

    try {
      await mgr.loadKline(code);

      const items = inst.klineData.items;
      t.equal(items.length, 3, '日 K 数组成功追加今日新蜡烛 (长度由 2 变 3)');
      t.equal(items[1].time, '2026-09-11', '昨日柱日期保持为 2026-09-11');
      t.equal(items[1].close, 11.0, '昨日柱收盘价 11.0 保持原样未被篡改');
      t.equal(items[2].time, '2026-09-14', '追加的今日新蜡烛日期为 2026-09-14');
      t.equal(items[2].close, 21.0, '今日新蜡烛收盘价准确对应最新报价');
    } finally {
      mgr.destroyAll();
    }
  });

  // 用例 4: applyLiveTick 路径增量推送目标日期防污染
  QUnit.test('用例 4: applyLiveTick 接收无日期 Tick 快照时，规范化注入最新交易日追加今日蜡烛，不覆盖昨日收盘柱', (t) => {
    const code = 'sh600777';
    const inst = createChartState('1d');
    inst.selectedTradeDate = '2026-09-11';
    inst.klineData = {
      code,
      name: '测试股',
      items: [
        { time: '2026-09-10', open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 1000, amount: 10000 },
        { time: '2026-09-11', open: 10.2, high: 11.2, low: 10.1, close: 11.0, volume: 2000, amount: 22000 }
      ]
    };

    const instances = new Map([[code, inst]]);
    const tradingDates = ['2026-09-10', '2026-09-11', '2026-09-14'];

    const mgr = new ChartRowManager({
      getChartInstances: () => instances,
      getTradingDates: () => tradingDates,
      isExpanded: () => true,
      hasIntraday: false
    });

    mgr.klineCtlMap.set(code, {
      updateKline() {},
      updateVolume() {},
      updateMA() {},
      destroy() {}
    });

    try {
      // 传入无日期字段的快照对象
      mgr.applyLiveTick(code, { price: 21.00 });

      const items = inst.klineData.items;
      t.equal(items.length, 3, 'applyLiveTick 成功追加今日蜡烛 (长度由 2 变 3)');
      t.equal(items[1].time, '2026-09-11', '昨日柱日期保持 2026-09-11');
      t.equal(items[1].close, 11.0, '昨日柱收盘价 11.0 保持原样未被篡改');
      t.equal(items[2].time, '2026-09-14', '今日柱日期准确设为 2026-09-14');
      t.equal(items[2].close, 21.0, '今日柱收盘价为 21.0');
    } finally {
      mgr.destroyAll();
    }
  });

  // 用例 5: resolveLiveFallbackDate 纯函数多资产隔离与盘前时钟保护
  QUnit.test('用例 5: resolveLiveFallbackDate 隔离保护期货标的交易日，并在盘前正确锚定至前一交易日（集成 loadKline 防幽灵 Bar）', async (t) => {
    const tradingDates = ['2026-09-10', '2026-09-11', '2026-09-14'];

    // 1. 期货标的：AU0 保留其实例交易日
    const futureInst = { selectedTradeDate: '2026-09-15' };
    const futureDate = resolveLiveFallbackDate('AU0', futureInst, tradingDates);
    t.equal(futureDate, '2026-09-15', '期货标的优先使用实例已持有的期货交易日');

    // 2. 股票标的盘中正常可用交易日
    const stockInst = { selectedTradeDate: '2026-09-11' };
    const stockDate = resolveLiveFallbackDate('sh600519', stockInst, tradingDates);
    t.equal(stockDate, '2026-09-14', '股票标的忽略历史 selectedTradeDate，锚定交易日历最新交易日');

    // 3. 盘前时钟测试（09:00 开盘前，应锚定至上一交易日 2026-09-11）
    const fixedPreMarketMs = Date.parse('2026-09-14T01:00:00Z'); // 北京时间 2026-09-14 09:00:00
    globalThis.Date = class PreMarketDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedPreMarketMs])); }
      static now() { return fixedPreMarketMs; }
    };
    try {
      const preMarketStockDate = resolveLiveFallbackDate('sh600519', stockInst, tradingDates);
      t.equal(preMarketStockDate, '2026-09-11', '盘前 09:00:00 股票标的由 resolveStockChartDate 确定性锚定至上一交易日');

      // 4. 集成真实 loadKline 链路验证防幽灵 Bar（对 chartRowController.js:391 的 getBeijingDate 变异敏感）
      const code = 'sh600777';
      const inst = createChartState('1d');
      inst.selectedTradeDate = '2026-09-11';
      inst.klineData = null;

      const instances = new Map([[code, inst]]);
      globalThis.fetch = async (url) => {
        if (String(url).includes('/api/cache/kline') || String(url).includes('kline')) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                code,
                name: '测试股',
                items: [
                  { time: '2026-09-10', open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 1000, amount: 10000 },
                  { time: '2026-09-11', open: 10.2, high: 11.2, low: 10.1, close: 11.0, volume: 2000, amount: 22000 }
                ]
              }
            })
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const mgr = new ChartRowManager({
        getChartInstances: () => instances,
        getTradingDates: () => tradingDates,
        getQuote: () => ({ price: 21.00 }), // 盘前无日期快照报价
        isExpanded: () => true,
        hasIntraday: false
      });

      try {
        await mgr.loadKline(code);
        const items = inst.klineData.items;
        t.equal(items.length, 2, '盘前 loadKline 不追加未开盘当天的幽灵 Bar (数组长度保持为 2)');
        t.equal(items[1].time, '2026-09-11', '最后一根 Bar 仍为上一交易日 2026-09-11');
        t.notOk(items.some((item) => item.time === '2026-09-14'), '严禁包含 2026-09-14 幽灵蜡烛');

        // 5. 集成真实 applyLiveTick 链路验证防幽灵 Bar（对 chartRowController.js:546 的 getBeijingDate 变异敏感）
        const fakeCtl = {
          updateKline() {},
          updateVolume() {},
          updateMA() {},
          destroy() {}
        };
        mgr.klineCtlMap.set(code, fakeCtl);

        // 传入无日期快照报价
        mgr.applyLiveTick(code, { price: 22.00 });
        const itemsAfterTick = inst.klineData.items;
        t.equal(itemsAfterTick.length, 2, '盘前 applyLiveTick 不追加未开盘当天的幽灵 Bar (数组长度保持为 2)');
        t.equal(itemsAfterTick[1].time, '2026-09-11', '最后一根 Bar 保持为上一交易日 2026-09-11');
        t.equal(itemsAfterTick[1].close, 22.00, '最后一根 Bar 收盘价就地更新');
        t.notOk(itemsAfterTick.some((item) => item.time === '2026-09-14'), '严禁包含 2026-09-14 幽灵蜡烛');
      } finally {
        mgr.destroyAll();
      }
    } finally {
      globalThis.Date = RealDate;
    }
  });

  // 用例 6: 活跃图表订阅集合合流 (expandedCodes)
  QUnit.test('用例 6: 历史涨停看板下展开的标的通过 expandedCodes 成功合流进入 getRefreshCodes', (t) => {
    const state = {
      watchList: ['sh600000'],
      subscribed: new Set(['sz000001']),
      limitUp: {
        selectedDate: '2026-09-11', // 历史日期
        items: [{ code: 'sh600888' }],
        expandedCodes: new Set()
      },
      expandedCodes: new Set(),
      momentum: {
        items: [],
        expandedCodes: new Set()
      }
    };

    const ctrl = createMonitorController({
      getState: () => state,
      fetchQuotes: async () => ({ quotes: [] }),
      fetchKline: async () => null,
      storage: { get: () => state.watchList, remove: () => {} },
      clock: () => new Date('2026-09-14T10:00:00+08:00')
    });

    // 初始状态：仅有自选与全局订阅，历史涨停 items 不合流
    const codes1 = ctrl.getRefreshCodes();
    t.ok(codes1.includes('sh600000'), '含自选股');
    t.ok(codes1.includes('sz000001'), '含全局订阅');
    t.notOk(codes1.includes('sh600888'), '历史看板列表项不自动入池');
    t.notOk(codes1.includes('sh600777'), '展开股尚未加入');

    // 用户在历史看板展开 sh600777
    state.limitUp.expandedCodes.add('sh600777');
    const codes2 = ctrl.getRefreshCodes();
    t.ok(codes2.includes('sh600777'), '展开的标的 sh600777 成功合流进入刷新集合');

    // 用户折叠该标的
    state.limitUp.expandedCodes.delete('sh600777');
    const codes3 = ctrl.getRefreshCodes();
    t.notOk(codes3.includes('sh600777'), '折叠后标的从刷新集合中移出');
  });

  // 用例 7: 行情调度层在 #/limit-up 路由下保活与可观测接入点（变异可证伪）
  QUnit.test('用例 7: applyDataRefreshSchedule 在涨停看板下保持行情轮询存活，并驱动 expandedCodes 行情刷新写入 state.quotes', async (t) => {
    const internal = _internal();
    const monitorCtrl = internal.monitorCtrl;
    const applySchedule = internal.applyDataRefreshSchedule;
    const state = internal.state;

    t.ok(typeof applySchedule === 'function', 'applyDataRefreshSchedule 可访问');
    t.ok(typeof monitorCtrl.inspect === 'function', 'monitorCtrl.inspect 可访问');

    const fakeRoot = document.createElement('div');
    limitUpCtrl.setRootEl(fakeRoot);

    const originalTradingDates = state.tradingDates;
    const originalRefreshInterval = state.refreshInterval;
    const originalAutoRefresh = state.autoRefreshEnabled;
    const originalLuAutoRefresh = state.limitUp.autoRefreshEnabled;

    state.tradingDates = ['2026-09-10', '2026-09-11', '2026-09-14'];
    state.refreshInterval = 10000;
    state.autoRefreshEnabled = true;
    state.limitUp.autoRefreshEnabled = true;
    state.limitUp.expandedCodes.add('sh600777');

    let fetchCalled = false;
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.includes('/api/tencent/')) {
        fetchCalled = true;
        const row = 'v_sh600777="1~TEST~600777~21.00~20.00~20.50~200~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260914100000~1.00~5.00~21.50~19.80~0/200/4200~"';
        return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(row).buffer };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    try {
      // (a) 断言调度层保活（在 hasLimitUpRoot=true 前置下对 needsSharedQuotes vs !hasLimitUpRoot 变异敏感）
      applySchedule();
      const info = monitorCtrl.inspect();
      t.equal(info.pollTimerAlive, true, '涨停看板挂载 (hasLimitUpRoot=true) 下 pollTimerAlive 恒为 true');
      t.notEqual(info.pollTimerId, null, 'pollTimerId 句柄有效持有');

      // (b) 经 registeredTimers 驱动回调触发 fetchQuotes
      const timerEntry = registeredTimers.get(info.pollTimerId);
      t.ok(timerEntry, '已在 registeredTimers 中注册对应定时器 entry');
      t.equal(timerEntry.ms, state.refreshInterval, '定时器周期与 state.refreshInterval 对齐');

      await timerEntry.fn();
      t.equal(fetchCalled, true, '定时器回调驱动 fetchQuotes 成功触发网络请求');

      // (c) 断言 state.quotes 写入驱动
      t.ok(state.quotes.has('sh600777'), 'state.quotes 成功写入展开标的');
      t.equal(state.quotes.get('sh600777').price, 21, 'state.quotes 价格准确写入');
    } finally {
      limitUpCtrl.stopTimer({ abort: false });
      limitUpCtrl.setRootEl(null);
      state.limitUp.timer = null;
      state.limitUp.expandedCodes.delete('sh600777');
      state.quotes.delete('sh600777');
      state.tradingDates = originalTradingDates;
      state.refreshInterval = originalRefreshInterval;
      state.autoRefreshEnabled = originalAutoRefresh;
      state.limitUp.autoRefreshEnabled = originalLuAutoRefresh;
      monitorCtrl.stopTimer();
    }
  });

  // 用例 8: 验证跨用例单例状态无残留（不变量探针保护，彻底闭环 P3-2）
  QUnit.test('用例 8: 用例 7 结束后 app 全局单例恢复初始不变量 (state.limitUp.timer === null)', (t) => {
    const { state, limitUpRootEl } = _internal();
    t.equal(state.limitUp.timer, null, 'state.limitUp.timer 已彻底清零，无跨用例残留泄漏');
    t.equal(limitUpRootEl, null, 'limitUpRootEl 已复位为 null');
    t.equal(state.limitUp.expandedCodes.size, 0, 'limitUp.expandedCodes 无残留');
  });
});
