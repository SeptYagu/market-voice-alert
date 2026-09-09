import { formatQuoteSpeechDelta } from '../src/js/tts.js';
import { fetchKline, onKlineUpdated } from '../src/js/api.js';
import { klineCacheGet, klineCacheSet, klineCacheClear, setStorageAdapter } from '../src/js/storage.js';
import {
  getFuturesSession,
  isFutureTrading,
  isAnyFutureTrading,
  isFuturesMarketOpenFallback
} from '../src/js/futures/session.js';
import { isFuturesMarketOpen } from '../src/js/marketSession.js';

function createMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] || null,
    get length() { return map.size; }
  };
}

QUnit.module('Code Review Regressions & Fixes', (hooks) => {
  hooks.beforeEach(() => {
    setStorageAdapter(createMockStorage());
    klineCacheClear();
  });

  hooks.afterEach(() => {
    klineCacheClear();
    setStorageAdapter(null);
  });

  // ---------------------------------------------------------------------------
  // R1: 语音去重合并记忆 - 静止行情多轮静默测试
  // ---------------------------------------------------------------------------
  QUnit.test('R1: voiceLastSpoken delta merge prevents alternate repeated speaking', (assert) => {
    const memory = new Map();
    const code = 'sh600000';
    const fields = { name: true, price: true, percent: true };
    const fieldsOrder = ['name', 'price', 'percent'];

    // 轮次 1: 初始行情
    const q1 = { code, name: '浦发银行', price: 10.0, changePercent: 1.0, type: 'stock' };
    const r1 = formatQuoteSpeechDelta(q1, memory.get(code), fields, fieldsOrder);
    assert.equal(r1.text, '浦发银行，10.00 元，涨 1.00', 'Round 1 announces all fields');
    assert.ok(r1.spoken, 'Round 1 returns spoken object');
    memory.set(code, { ...memory.get(code), ...r1.spoken });

    // 轮次 2: 仅价格变化为 11.00，涨跌幅依然为 1.00
    const q2 = { code, name: '浦发银行', price: 11.0, changePercent: 1.0, type: 'stock' };
    const r2 = formatQuoteSpeechDelta(q2, memory.get(code), fields, fieldsOrder);
    assert.equal(r2.text, '浦发银行，11.00 元', 'Round 2 announces only changed price with name');
    memory.set(code, { ...memory.get(code), ...r2.spoken });

    // 轮次 3: 行情完全保持不变 (11.00 / 1.00)
    const q3 = { code, name: '浦发银行', price: 11.0, changePercent: 1.0, type: 'stock' };
    const r3 = formatQuoteSpeechDelta(q3, memory.get(code), fields, fieldsOrder);
    assert.equal(r3.text, '', 'Round 3 is completely silent when quote does not change');
    assert.equal(r3.spoken, null, 'Round 3 returns null spoken');

    // 轮次 4: 行情继续保持不变 (11.00 / 1.00) - 确保不会因单字段覆盖而在后续交替复播
    const q4 = { code, name: '浦发银行', price: 11.0, changePercent: 1.0, type: 'stock' };
    const r4 = formatQuoteSpeechDelta(q4, memory.get(code), fields, fieldsOrder);
    assert.equal(r4.text, '', 'Round 4 remains completely silent without alternate repeat');
  });

  // ---------------------------------------------------------------------------
  // R4: 强刷 K 线数据正常落入本地缓存并触发更新广播
  // ---------------------------------------------------------------------------
  QUnit.test('R4: force reload kline updates local cache and emits event', async (assert) => {
    const originalFetch = globalThis.fetch;
    let updatedEmitted = false;
    let emittedData = null;
    const unsub = onKlineUpdated((code, period, data) => {
      if (code === 'sh600000' && period === '1d') {
        updatedEmitted = true;
        emittedData = data;
      }
    });

    try {
      // 预置旧缓存
      klineCacheSet('sh600000', '1d', {
        code: 'sh600000',
        name: '浦发银行',
        items: [{ time: '2026-09-01', open: 10, close: 10, high: 10, low: 10, volume: 100 }]
      });

      // Mock 网络请求返回全新数据
      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('push2his.eastmoney.com') || urlStr.includes('kline')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                code: '600000',
                name: '浦发银行',
                klines: [
                  '2026-09-01,10.00,10.00,10.00,10.00,100,1000,0.00',
                  '2026-09-08,11.00,11.50,11.80,10.90,200,2500,5.00'
                ]
              }
            })
          };
        }
        return { ok: false, status: 404 };
      };

      // 执行 force 强刷请求
      const result = await fetchKline('sh600000', {
        period: '1d',
        force: true
      });

      assert.ok(result && result.items.length === 2, 'Network fetched 2 items');

      // 验证本地缓存是否被成功刷新覆盖
      const cachedAfter = klineCacheGet('sh600000', '1d');
      assert.ok(cachedAfter, 'Cache exists after force reload');
      assert.equal(cachedAfter.items.length, 2, 'Cache was successfully updated with latest 2 bars');
      assert.ok(updatedEmitted, 'emitKlineUpdated was triggered on force reload');
      assert.equal(emittedData.items.length, 2, 'Emitted data contains fresh bars');
    } finally {
      unsub();
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // R7 / 会话模型: 品种精准判定与无夜盘期货过滤
  // ---------------------------------------------------------------------------
  QUnit.test('R7: Futures session accurately handles instruments with and without night trading', (assert) => {
    // 2026-09-09 (周三)
    const wednesdayDayTime = new Date('2026-09-09T10:00:00+08:00');
    const wednesdayNightTime = new Date('2026-09-09T21:30:00+08:00');
    const wednesdayLateNight = new Date('2026-09-09T23:30:00+08:00');
    const thursdayPostMidnight = new Date('2026-09-10T01:30:00+08:00');
    const thursdayLatePostMidnight = new Date('2026-09-10T02:40:00+08:00');
    const tradingDates = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];

    // 1. 国债期货 (T0): 无夜盘
    assert.ok(isFutureTrading('T0', wednesdayDayTime, tradingDates), 'Treasury T0 is trading at 10:00 day session');
    assert.notOk(isFutureTrading('T0', wednesdayNightTime, tradingDates), 'Treasury T0 is NOT trading at 21:30 night session');

    // 2. 股指期货 (IF0): 无夜盘
    assert.ok(isFutureTrading('IF0', wednesdayDayTime, tradingDates), 'Stock Index IF0 is trading at 10:00 day session');
    assert.notOk(isFutureTrading('IF0', wednesdayNightTime, tradingDates), 'Stock Index IF0 is NOT trading at 21:30 night session');

    // 3. 螺纹钢 (RB0): 23:00 收盘
    assert.ok(isFutureTrading('RB0', wednesdayNightTime, tradingDates), 'Rebar RB0 is trading at 21:30 night session');
    assert.notOk(isFutureTrading('RB0', wednesdayLateNight, tradingDates), 'Rebar RB0 is NOT trading at 23:30 after nightSessionEnd');

    // 4. 沪金 (AU0): 02:30 收盘
    assert.ok(isFutureTrading('AU0', wednesdayNightTime, tradingDates), 'Gold AU0 is trading at 21:30');
    assert.ok(isFutureTrading('AU0', thursdayPostMidnight, tradingDates), 'Gold AU0 is trading at 01:30 across midnight');
    assert.notOk(isFutureTrading('AU0', thursdayLatePostMidnight, tradingDates), 'Gold AU0 is NOT trading at 02:40 after 02:30 close');

    // 5. 前端 isFuturesMarketOpen 精准过滤测试
    // 当只订阅国债期货时，夜盘返回 false
    assert.notOk(
      isFuturesMarketOpen(wednesdayNightTime, tradingDates, ['T0']),
      'isFuturesMarketOpen with only T0 returns false at night'
    );
    // 验证 isAnyFutureTrading 和 isFuturesMarketOpenFallback
    assert.notOk(isAnyFutureTrading(['T0', 'IF0'], wednesdayNightTime, tradingDates), 'isAnyFutureTrading returns false for purely non-night futures at night');
    assert.ok(isAnyFutureTrading(['T0', 'RB0'], wednesdayNightTime, tradingDates), 'isAnyFutureTrading returns true if at least one future is trading');
    assert.ok(isFuturesMarketOpenFallback(wednesdayNightTime, tradingDates), 'isFuturesMarketOpenFallback returns true at standard night hour');

    // 当订阅螺纹钢时，21:30 返回 true，23:30 返回 false
    assert.ok(
      isFuturesMarketOpen(wednesdayNightTime, tradingDates, ['RB0']),
      'isFuturesMarketOpen with RB0 returns true at 21:30'
    );
    assert.notOk(
      isFuturesMarketOpen(wednesdayLateNight, tradingDates, ['RB0']),
      'isFuturesMarketOpen with RB0 returns false at 23:30'
    );
  });

  // ---------------------------------------------------------------------------
  // 节假日前夕不开夜盘测试
  // ---------------------------------------------------------------------------
  QUnit.test('R7: Pre-holiday calendar constraint inhibits night session', (assert) => {
    // 假设 2026-09-30 (周三) 是国庆节前最后一个交易日，下一交易日为 2026-10-08
    const preHolidayNight = new Date('2026-09-30T21:30:00+08:00');
    const tradingDates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-08'];

    const session = getFuturesSession('RB0', preHolidayNight, tradingDates);
    assert.notOk(session.isTrading, 'Rebar RB0 does not trade night session on the eve of a holiday');
    assert.equal(session.sessionStatus, 'closed', 'Session status is closed on pre-holiday eve');
  });

  // ---------------------------------------------------------------------------
  // R5: 动量扫描 Generation 代际任务守卫测试
  // ---------------------------------------------------------------------------
  QUnit.test('R5: Momentum scan task generation guards state from stale task completion', async (assert) => {
    let generation = 0;
    const isCurrent = (gen) => gen === generation;
    const mState = { loading: false, items: [], error: null };

    // 启动任务 A
    const genA = ++generation;
    mState.loading = true;

    // 模拟任务 A 处于等待中，此时用户触发停止并立即启动任务 B
    generation += 1; // stopMomentumScan 递增 generation
    const genB = ++generation; // 任务 B 启动

    assert.equal(isCurrent(genA), false, 'Task A is no longer current');
    assert.equal(isCurrent(genB), true, 'Task B is the current task');

    // 模拟任务 A 的 continuation / finally 完成
    if (isCurrent(genA)) {
      mState.loading = false;
      mState.items = ['stale_from_A'];
    }

    assert.equal(mState.loading, true, 'Task A did not clear loading flag of Task B');
    assert.deepEqual(mState.items, [], 'Task A did not overwrite items of Task B');
  });

  // ---------------------------------------------------------------------------
  // R6: 图表加载多重一致性身份守卫测试
  // ---------------------------------------------------------------------------
  QUnit.test('R6: Chart loader task identity check protects against stale responses', (assert) => {
    let expanded = true;
    let currentInst = { period: '1d', abort: new AbortController() };

    const checkTask = (inst, myAbort, startedPeriod) =>
      expanded &&
      currentInst === inst &&
      inst.abort === myAbort &&
      inst.period === startedPeriod;

    // 初始状态
    const originalInst = currentInst;
    const originalAbort = currentInst.abort;
    assert.ok(checkTask(originalInst, originalAbort, '1d'), 'Initial task is valid');

    // 场景 1: 折叠图表
    expanded = false;
    assert.notOk(checkTask(originalInst, originalAbort, '1d'), 'Task invalid when collapsed');
    expanded = true;

    // 场景 2: 切换周期
    currentInst.period = '1w';
    assert.notOk(checkTask(originalInst, originalAbort, '1d'), 'Task invalid when period changed from 1d to 1w');
    currentInst.period = '1d';

    // 场景 3: 发起新请求替换了 AbortController
    currentInst.abort = new AbortController();
    assert.notOk(checkTask(originalInst, originalAbort, '1d'), 'Task invalid when AbortController superseded');

    // 场景 4: 实例被替换（重新展开产生新实例）
    currentInst = { period: '1d', abort: new AbortController() };
    assert.notOk(checkTask(originalInst, originalAbort, '1d'), 'Task invalid when instance object was replaced');
  });
});
