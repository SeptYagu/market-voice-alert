import { applyLiveQuoteToKline, applyLiveQuoteToIntraday } from '../src/js/kline.js';
import { createIntradayChart } from '../src/js/chart.js';
import { parseBeijingDateTimeToChartSeconds } from '../src/js/time.js';
import { decideVoiceSchedule } from '../src/js/services/voiceSchedule.js';
import { createVoiceController } from '../src/js/controllers/voiceController.js';

function makeHost(width = 600, height = 400) {
  const host = document.createElement('div');
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  document.body.appendChild(host);
  return host;
}

QUnit.module('callAuction.verificationMatrix', (hooks) => {
  hooks.afterEach(() => {
    document.body.innerHTML = '';
  });

  // 5.1(1) A 股掌阅科技集合竞价跌停下影线消除与 09:25 交接重基线（双前置覆盖）
  QUnit.test('5.1(1a) A 股盘前跌停下影线消除与 09:25 交接重基线 - 追加路径（items 末柱为昨日）', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:18 传入虚拟跌停价 18.00 且报价携带外部脏 high: 22, low: 18（测试追加分支守卫判别力）
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 18, open: 18, high: 22, low: 18, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(t1.length, 2, 'appends today bar');
    t.equal(t1[1].low, 18, '09:18 temporary bar low is 18.00');
    t.equal(t1[1].high, 18, '09:18 temporary bar high converges to 18.00 (rejects dirty high 22)');
    t.true(t1[1].preview, '09:18 bar is marked preview');

    // 09:20 撤单价格回升至 18.60（原地更新分支，价格收敛于 18.60）
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 18.6, open: 18.6, high: 22, low: 18, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:20:00+08:00')
    );
    t.equal(t2.length, 2);
    t.equal(t2[1].low, 18.6, '09:20 order cancelled, low rebounds to 18.60');
    t.true(t2[1].preview, '09:20 bar retains preview flag');

    // 09:24:50 最后一拍虚拟撮合价 19.60
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 19.6, open: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:50+08:00')
    );
    t.equal(t3[1].low, 19.6, '09:24:50 last pre-open tick low is 19.60');

    // 09:25:03 正式撮合开盘 20.50（重基线：消除 19.60 盘前虚拟值，low === 20.50）
    const t4 = applyLiveQuoteToKline(
      t3,
      { price: 20.5, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:03+08:00')
    );
    t.equal(t4[1].open, 20.5, '09:25 open is 20.50');
    t.equal(t4[1].low, 20.5, '今日 Bar 的 low === 20.50，重基线消除 19.60 虚假下影线（追加路径）');
    t.equal(t4[1].high, 20.5, '09:25 high is 20.50');
    t.false(Boolean(t4[1].preview), '09:25 preview flag is purged');

    // 10:00 盘中上涨至 20.90
    const t5 = applyLiveQuoteToKline(
      t4,
      { price: 20.9, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T10:00:00+08:00')
    );
    t.equal(t5[1].low, 20.5, '10:00 low remains 20.50');
    t.equal(t5[1].high, 20.9, '10:00 high breakout to 20.90');

    // 14:55 尾盘上涨至 21.30
    const t6 = applyLiveQuoteToKline(
      t5,
      { price: 21.3, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t6[1].low, 20.50, '14:55 全天最低成交价依然保持 20.50，绝不保留 19.60/18.00 虚假下影线');
    t.equal(t6[1].high, 21.30, '14:55 high is 21.30');
  });

  QUnit.test('5.1(1b) A 股盘前跌停下影线消除与 09:25 交接重基线 - 原地更新路径（items 已含今日柱）', (t) => {
    const items = [
      { time: '2026-09-18', open: 20, high: 20, low: 20, close: 20, volume: 0 }
    ];
    // 09:18 跌停价 18.00 且带脏 high/low
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 18, open: 18, high: 22, low: 18, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(t1[0].low, 18, '09:18 low is 18.00');
    t.equal(t1[0].high, 18, '09:18 high converges to 18.00');
    t.true(t1[0].preview, 'marked as preview');

    // 09:20 撤单回升至 18.60
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 18.6, open: 18.6, high: 22, low: 18, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:20:00+08:00')
    );
    t.equal(t2[0].low, 18.6, '09:19 low rebounds to 18.60');

    // 09:24:50 最后一拍虚拟价 19.60
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 19.6, open: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:50+08:00')
    );
    t.equal(t3[0].low, 19.6);

    // 09:25:03 正式撮合开盘 20.50
    const t4 = applyLiveQuoteToKline(
      t3,
      { price: 20.5, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:03+08:00')
    );
    t.equal(t4[0].low, 20.50, '今日 Bar 的 low === 20.50，重基线消除 19.60 虚假下影线（原地路径）');
    t.false(Boolean(t4[0].preview), 'preview purged');

    // 14:55 价格突破至 21.30
    const t5 = applyLiveQuoteToKline(
      t4,
      { price: 21.3, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t5[0].low, 20.50, '14:55 low remains 20.50');
    t.equal(t5[0].high, 21.30, '14:55 high breakout to 21.30');
  });

  // 5.1(1c) 周K/月K 集合竞价期间冻结 high/low，不吸纳外部脏报价极值（P2-2）
  QUnit.test('5.1(1c) 周K/月K 集合竞价期间冻结 high/low，不吸纳外部脏报价极值', (t) => {
    const weeklyItems = [
      { time: '2026-09-14', open: 30, high: 32, low: 21, close: 31, volume: 100 }
    ];
    // 09:18 传入外部脏 low = 18
    const w1 = applyLiveQuoteToKline(
      weeklyItems,
      { price: 30.5, high: 30.8, low: 18, tradingDay: '2026-09-18' },
      '1w',
      'sh603533',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(w1[0].low, 21, '周K 09:18 冻结 low，不吸纳外部脏 low 18');
    t.equal(w1[0].high, 32, '周K 09:18 冻结 high，保持历史高点 32');
    t.equal(w1[0].close, 30.5, '周K 09:18 close 更新为现价 30.5');

    // 10:00 盘中真实成交
    const w2 = applyLiveQuoteToKline(
      w1,
      { price: 30.5, high: 30.8, low: 30.4, tradingDay: '2026-09-18' },
      '1w',
      'sh603533',
      new Date('2026-09-18T10:00:00+08:00')
    );
    t.equal(w2[0].low, 21, '周K 10:00 low 依然为官方最低 21，不被污染');
    t.equal(w2[0].high, 32, '周K 10:00 high 为 32');

    // 月K 测试
    const monthlyItems = [
      { time: '2026-09-01', open: 28, high: 35, low: 22, close: 30, volume: 500 }
    ];
    const m1 = applyLiveQuoteToKline(
      monthlyItems,
      { price: 30.5, high: 30.8, low: 18, tradingDay: '2026-09-18' },
      '1M',
      'sh603533',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(m1[0].low, 22, '月K 09:18 冻结 low，不吸纳外部脏 low 18');
    t.equal(m1[0].high, 35, '月K 09:18 冻结 high，保持 35');
    t.equal(m1[0].close, 30.5, '月K 09:18 close 更新为现价 30.5');
  });

  // 5.1(1d) 日线 live tick 时钟参数化注入，避免墙钟依赖（P3-1）
  QUnit.test('5.1(1d) 日线 live tick 时钟参数化注入，避免墙钟依赖', (t) => {
    const items = [
      { time: '2026-09-18', open: 10, high: 11, low: 9, close: 10.5, volume: 1000, amount: 10000 }
    ];
    // 冻结时钟为 09:18（盘前）
    const rPre = applyLiveQuoteToKline(
      items,
      { price: 12, open: 10.2, high: 12.5, low: 8.8, volume: 1800, amount: 20000, tradingDay: '2026-09-18' },
      '1d',
      'sh600519',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(rPre[0].low, 12, '09:18 盘前收敛于 price 12');
    t.true(rPre[0].preview, 'marked as preview');

    // 冻结时钟为 14:00（盘中）
    const rMid = applyLiveQuoteToKline(
      items,
      { price: 12, open: 10.2, high: 12.5, low: 8.8, volume: 1800, amount: 20000, tradingDay: '2026-09-18' },
      '1d',
      'sh600519',
      new Date('2026-09-18T14:00:00+08:00')
    );
    t.equal(rMid[0].open, 10.2);
    t.equal(rMid[0].high, 12);
    t.equal(rMid[0].low, 9);
  });

  // 5.1(2) 外部脏 quote.low 隔离验证（追加分支与原地分支双覆盖）
  QUnit.test('5.1(2) 外部脏 quote.low 隔离验证（追加分支与原地分支双覆盖）', (t) => {
    // 追加分支（官方 Bar 尚未入库）
    const appendItems = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20 }
    ];
    const outAppend = applyLiveQuoteToKline(
      appendItems,
      { price: 20.50, low: 18.00, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    t.equal(outAppend[1].low, 20.50, 'append branch ignores external dirty quote.low 18.00');

    // 原地更新分支（官方 Bar 在库）
    const inPlaceItems = [
      { time: '2026-09-18', open: 20.50, high: 20.50, low: 20.50, close: 20.50 }
    ];
    const outInPlace = applyLiveQuoteToKline(
      inPlaceItems,
      { price: 20.50, low: 18.00, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    t.equal(outInPlace[0].low, 20.50, 'in-place branch ignores external dirty quote.low 18.00');
  });

  // 5.1(3) 非 A 股标的真实影线不失真回归验证（P1-2, P2-2）
  QUnit.test('5.1(3) 非 A 股标的真实影线不失真回归验证（美股与外盘期货）', (t) => {
    // 美股在 02:00（北京）传入价格区间 [98.00, 103.00]
    const usItems = [
      { time: '2026-09-18', open: 100, high: 100, low: 100, close: 100 }
    ];
    const usOut = applyLiveQuoteToKline(
      usItems,
      { price: 100.5, high: 103, low: 98, date: '2026-09-18' },
      '1d',
      'usAAPL',
      new Date('2026-09-18T02:00:00+08:00')
    );
    t.equal(usOut[0].high, 103.00, 'US stock high is preserved at 103.00');
    t.equal(usOut[0].low, 98.00, 'US stock low is preserved at 98.00');

    // CME 国际期货在 06:10（北京）传入价格区间 [98.00, 103.00]
    const cmeItems = [
      { time: '2026-09-18', open: 100, high: 100, low: 100, close: 100 }
    ];
    const cmeOut = applyLiveQuoteToKline(
      cmeItems,
      { price: 100.5, high: 103, low: 98, date: '2026-09-18' },
      '1d',
      'gl_CL0',
      new Date('2026-09-18T06:10:00+08:00')
    );
    t.equal(cmeOut[0].high, 103.00, 'CME futures high is preserved at 103.00');
    t.equal(cmeOut[0].low, 98.00, 'CME futures low is preserved at 98.00');
  });

  // 5.1(4) 分时图固定网格与全资产数据驱动轴可见性验证（P1-1, P2-3, P2-4）
  QUnit.test('5.1(4a) A 股含 09:18 竞价点稳定走 253 固定网格', (t) => {
    const host = makeHost();
    const ctl = createIntradayChart(host, { isFuture: false });
    ctl.setData([
      { time: parseBeijingDateTimeToChartSeconds('2026-09-18 09:18'), close: 20, volume: 100 }
    ]);
    t.equal(ctl._getDisplayTimes().length, 253, 'A stock timeline has 253 standard slots');
    ctl.destroy();
  });

  QUnit.test('5.1(4b) 国内期货 RB0 稳定走数据驱动轴', (t) => {
    const host = makeHost();
    const ctl = createIntradayChart(host, { isFuture: true });
    ctl.setData([
      { time: parseBeijingDateTimeToChartSeconds('2026-09-18 09:01'), close: 3500, volume: 50 },
      { time: parseBeijingDateTimeToChartSeconds('2026-09-18 09:02'), close: 3505, volume: 60 },
      { time: parseBeijingDateTimeToChartSeconds('2026-09-18 09:03'), close: 3510, volume: 70 }
    ]);
    t.equal(ctl._getDisplayTimes().length, 3, 'Futures timeline length equals data point count');
    ctl.destroy();
  });

  QUnit.test('5.1(4c) 港股 hk00700（含 15:30 点）数据点 6/6 全部可见', (t) => {
    const host = makeHost();
    const ctl = createIntradayChart(host, { isFuture: false });
    const items = [
      '2026-09-18 09:30', '2026-09-18 10:00', '2026-09-18 11:30',
      '2026-09-18 13:00', '2026-09-18 15:00', '2026-09-18 15:30'
    ].map((s) => ({ time: parseBeijingDateTimeToChartSeconds(s), close: 300, volume: 100 }));
    ctl.setData(items);
    t.equal(ctl._getDisplayTimes().length, 6, 'HK stock displayTimes.length === 6');
    t.equal(
      ctl._getDisplayVolumeData().filter((d) => Number.isFinite(d.value)).length,
      6,
      '6/6 points visible'
    );
    ctl.destroy();
  });

  QUnit.test('5.1(4d) 美股 usAAPL（21:30-03:00 点）数据点 5/5 全部可见', (t) => {
    const host = makeHost();
    const ctl = createIntradayChart(host, { isFuture: false });
    const items = [
      '2026-09-18 21:30', '2026-09-18 22:00', '2026-09-18 23:00',
      '2026-09-19 01:00', '2026-09-19 03:00'
    ].map((s) => ({ time: parseBeijingDateTimeToChartSeconds(s), close: 150, volume: 100 }));
    ctl.setData(items);
    t.equal(ctl._getDisplayTimes().length, 5, 'US stock displayTimes.length === 5');
    t.equal(
      ctl._getDisplayVolumeData().filter((d) => Number.isFinite(d.value)).length,
      5,
      '5/5 points visible'
    );
    ctl.destroy();
  });

  QUnit.test('5.1(4e) 国际期货 gl_HSI（17:00-05:00 点）数据点 4/4 全部可见', (t) => {
    const host = makeHost();
    const ctl = createIntradayChart(host, { isFuture: false });
    const items = [
      '2026-09-18 17:15', '2026-09-18 20:00', '2026-09-19 01:00', '2026-09-19 03:00'
    ].map((s) => ({ time: parseBeijingDateTimeToChartSeconds(s), close: 17000, volume: 100 }));
    ctl.setData(items);
    t.equal(ctl._getDisplayTimes().length, 4, 'gl_HSI displayTimes.length === 4');
    t.equal(
      ctl._getDisplayVolumeData().filter((d) => Number.isFinite(d.value)).length,
      4,
      '4/4 points visible'
    );
    ctl.destroy();
  });

  // 5.1(5) 09:26-09:29 静默期开盘撮合点保护验证（P3-1）
  QUnit.test('5.1(5) 09:26-09:29 静默期开盘撮合点保护验证', (t) => {
    const matchPoint = {
      time: parseBeijingDateTimeToChartSeconds('2026-09-18 09:25'),
      open: 20,
      high: 20,
      low: 20,
      close: 20,
      price: 20,
      volume: 1000
    };
    const items = [matchPoint];
    const quote = { price: 20.20, volume: 1000, amount: 20200 };
    const now = new Date('2026-09-18T09:27:00+08:00');
    const out = applyLiveQuoteToIntraday(items, quote, now, false);
    t.equal(out[0].close, 20.00, '09:25 match point close remains 20.00 and is not overwritten by 20.20');
  });

  // 5.1(6) 语音播报总开关、时段使能与记忆基线衔接验证（P1-1, P2-1, P2-2, P2-4）
  QUnit.test('5.1(6a) 语音播报智能时段关闭态：09:17 与 09:22 均放行，不被误拦截', (t) => {
    const settings = {
      enabled: true,
      interval: 10000,
      skipUnchanged: true,
      smartSchedule: { enabled: false, autoStartAuction: false }
    };
    const d1 = decideVoiceSchedule({
      codes: ['sh603533'],
      settings,
      now: new Date('2026-09-18T09:17:00+08:00'),
      tradingDates: ['2026-09-18']
    });
    t.true(d1.timerShouldRun, '09:17 timerShouldRun is true when smartSchedule disabled');
    t.deepEqual(d1.eligibleCodes, ['sh603533'], '09:17 eligibleCodes includes sh603533');

    const d2 = decideVoiceSchedule({
      codes: ['sh603533'],
      settings,
      now: new Date('2026-09-18T09:22:00+08:00'),
      tradingDates: ['2026-09-18']
    });
    t.true(d2.timerShouldRun, '09:22 timerShouldRun is true when smartSchedule disabled');
    t.deepEqual(d2.eligibleCodes, ['sh603533'], '09:22 eligibleCodes includes sh603533');
  });

  QUnit.test('5.1(6b) 智能时段开启态 09:20-09:25 放行且全量播报写入记忆基线', (t) => {
    let now = new Date('2026-09-18T09:17:00+08:00');
    let settings = {
      enabled: true,
      interval: 10000,
      volume: 80,
      skipUnchanged: true,
      fields: { name: true, price: true, percent: true },
      smartSchedule: { enabled: true, autoStartAuction: false }
    };
    const codes = ['sh603533'];
    const quotes = new Map([
      ['sh603533', { code: 'sh603533', name: '掌阅科技', price: 20, changePercent: 0 }]
    ]);
    const spoken = [];
    const controller = createVoiceController({
      getCodes: () => codes,
      getQuotes: () => quotes,
      getSettings: () => settings,
      saveSettings: (patch) => { settings = { ...settings, ...patch }; },
      getTradingDates: () => ['2026-09-18'],
      clock: () => now,
      speech: {
        supported: () => true,
        speak: (text, opts) => {
          spoken.push(text);
          if (opts && typeof opts.onSpoken === 'function') opts.onSpoken('end');
        },
        cancel() {}
      },
      createWorker: () => ({ terminate() {}, postMessage() {} }),
      timers: { setInterval: () => 1, clearInterval: () => {} }
    });

    // 09:17: 拦截
    const d1 = controller.applySchedule();
    t.false(d1.timerShouldRun, '09:17 timerShouldRun is false');
    t.deepEqual(d1.eligibleCodes, [], '09:17 eligibleCodes is empty');

    // 09:22: 放行，两轮连续播报
    now = new Date('2026-09-18T09:22:00+08:00');
    const d2 = controller.applySchedule();
    t.true(d2.timerShouldRun, '09:22 timerShouldRun is true');
    t.deepEqual(d2.eligibleCodes, ['sh603533'], '09:22 eligibleCodes has sh603533');

    controller.speakSubscribed();
    controller.speakSubscribed();
    t.equal(spoken.length, 2, 'spoken 2 times despite identical quote (dedup bypassed in 09:20-09:25)');
    t.equal(
      controller.inspect().memory.get('sh603533')?.price,
      '20.00 元',
      'memory baseline recorded price === 20.00 元'
    );
    controller.stop();
  });

  QUnit.test('5.1(6c) 09:25 恢复去重与基线保持（无重复播报）', (t) => {
    let now = new Date('2026-09-18T09:24:00+08:00');
    let settings = {
      enabled: true,
      interval: 10000,
      volume: 80,
      skipUnchanged: true,
      fields: { name: true, price: true, percent: true },
      smartSchedule: { enabled: true, autoStartAuction: false }
    };
    const codes = ['sh603533'];
    const quotes = new Map([
      ['sh603533', { code: 'sh603533', name: '掌阅科技', price: 20, changePercent: 0 }]
    ]);
    const spoken = [];
    const controller = createVoiceController({
      getCodes: () => codes,
      getQuotes: () => quotes,
      getSettings: () => settings,
      saveSettings: (patch) => { settings = { ...settings, ...patch }; },
      getTradingDates: () => ['2026-09-18'],
      clock: () => now,
      speech: {
        supported: () => true,
        speak: (text, opts) => {
          spoken.push(text);
          if (opts && typeof opts.onSpoken === 'function') opts.onSpoken('end');
        },
        cancel() {}
      },
      createWorker: () => ({ terminate() {}, postMessage() {} }),
      timers: { setInterval: () => 1, clearInterval: () => {} }
    });

    // 09:24: 在竞价不可撤单窗口播报，写入基线
    controller.applySchedule();
    controller.speakSubscribed();
    t.equal(spoken.length, 1);
    t.equal(controller.inspect().memory.get('sh603533')?.price, '20.00 元');

    // 09:26: 撮合后，恢复去重约束
    now = new Date('2026-09-18T09:26:00+08:00');
    const d = controller.applySchedule();
    t.true(d.timerShouldRun, '09:26 timer continues running (no stopTimer/startTimer memory.clear)');

    const before = spoken.length;
    controller.speakSubscribed();
    t.equal(spoken.length - before, 0, 'dedup successfully active at 09:26, 0 additional spoken broadcasts');
    controller.stop();
  });

  // 5.1(1e) P2-1 已收盘日K柱在 09:15 前（02:00/09:05）不被压平且不打上 preview 标记
  QUnit.test('5.1(1e) P2-1 已收盘日K柱在 09:15 前（02:00/09:05）不被压平且不打上 preview 标记', (t) => {
    const closedItems = [
      { time: '2026-09-17', open: 20.5, high: 22.5, low: 20.0, close: 21.0 }
    ];
    // 02:00 收到昨日行情（期货夜盘或服务启动刷新）
    const r0200 = applyLiveQuoteToKline(
      closedItems,
      { price: 21.0, date: '2026-09-17' },
      '1d',
      'sh600519',
      new Date('2026-09-18T02:00:00+08:00')
    );
    t.equal(r0200[0].open, 20.5, '02:00 open 保持官方值 20.5');
    t.equal(r0200[0].high, 22.5, '02:00 high 保持官方值 22.5');
    t.equal(r0200[0].low, 20.0, '02:00 low 保持官方值 20.0');
    t.equal(r0200[0].close, 21.0, '02:00 close 保持官方值 21.0');
    t.false(Boolean(r0200[0].preview), '02:00 不打上 preview 标记');

    // 09:05 收到昨日行情（期货早盘开市豁免刷新）
    const r0905 = applyLiveQuoteToKline(
      closedItems,
      { price: 21.0, date: '2026-09-17' },
      '1d',
      'sh600519',
      new Date('2026-09-18T09:05:00+08:00')
    );
    t.equal(r0905[0].low, 20.0, '09:05 low 依然保持官方值 20.0，不被压平');
    t.false(Boolean(r0905[0].preview), '09:05 不打上 preview 标记');

    // 09:18 集合竞价开始，收到今日行情 -> 正常追加今日 preview 柱
    const r0918 = applyLiveQuoteToKline(
      closedItems,
      { price: 21.0, open: 21.0, tradingDay: '2026-09-18' },
      '1d',
      'sh600519',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(r0918.length, 2, '09:18 追加今日柱');
    t.true(r0918[1].preview, '09:18 今日柱带有 preview 标记');

    // 09:25:03 开盘撮合重基线 -> preview 清除
    const r0925 = applyLiveQuoteToKline(
      r0918,
      { price: 20.5, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh600519',
      new Date('2026-09-18T09:25:03+08:00')
    );
    t.equal(r0925[1].low, 20.5, '09:25:03 重基线 low 为 20.5');
    t.false(Boolean(r0925[1].preview), '09:25:03 preview 标记被清除');
  });

  // 5.1(1f) P2-2 分钟周期在 09:18 满足 close ∈ [low, high]，且不覆写前一交易日末根分钟柱
  QUnit.test('5.1(1f) P2-2 分钟周期在 09:18 满足 close ∈ [low, high]，且不覆写前一交易日末根分钟柱', (t) => {
    const minutePeriods = ['1m', '5m', '15m', '30m', '60m'];
    for (const period of minutePeriods) {
      const items = [{ time: '2026-09-18 09:30', open: 10, high: 10.5, low: 9.9, close: 10.4 }];
      const res = applyLiveQuoteToKline(
        items,
        { price: 12, open: 10.2, high: 12.5, low: 8.8 },
        period,
        'sh600519',
        new Date('2026-09-18T09:18:00+08:00')
      );
      const last = res[0];
      t.equal(last.close, 12, `${period} close 为现价 12`);
      t.true(last.close >= last.low && last.close <= last.high, `${period} 满足 close ∈ [low, high] (low=${last.low}, high=${last.high})`);
    }

    // 前一交易日末根分钟柱保护
    const prevDayItems = [{ time: '2026-09-17 15:00', open: 10, high: 10.5, low: 9.9, close: 10.4 }];
    const resPrev = applyLiveQuoteToKline(
      prevDayItems,
      { price: 12, open: 10.2, high: 12.5, low: 8.8, tradingDay: '2026-09-18' },
      '1m',
      'sh600519',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(resPrev[0].close, 10.4, '前一交易日末根分钟柱 close 不被改写');
  });

  // 5.1(1g) 风险1 C2: 09:25:00 首拍滞后快照携带盘前虚拟 open (19.60) 依然保持 preview 并正确重基线
  QUnit.test('5.1(1g) 风险1 C2: 09:25:00 首拍滞后快照携带盘前虚拟 open (19.60) 依然保持 preview 并正确重基线', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:24:50 最后一拍虚拟价 19.60，虚拟 open 19.60
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:50+08:00')
    );
    t.equal(t1[1].low, 19.6);
    t.true(t1[1].preview, 'marked as preview');

    // 09:25:00 收到滞后快照（仍为 19.60，携带虚拟 open 19.60）
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 19.6, open: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:00+08:00')
    );
    t.true(t2[1].preview, '09:25:00 滞后快照携带虚拟 open 保持 preview: true，不提前锁死');

    // 09:25:05 收到真实开盘快照 20.50，open 20.50
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 20.5, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:05+08:00')
    );
    t.equal(t3[1].open, 20.5);
    t.equal(t3[1].low, 20.5, '真实快照到达时重基线 low 为 20.5');
    t.false(Boolean(t3[1].preview), 'preview 标记清除');
    t.equal(t3[1].previewDate, '2026-09-18', 'previewDate 仍保留供对账');

    // 14:55 盘终
    const t4 = applyLiveQuoteToKline(
      t3,
      { price: 21.3, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t4[1].low, 20.5, '全天 low 恒为 20.5，19.60 彻底消除');
    t.equal(t4[1].high, 21.3);
  });

  // 5.1(1h) 风险1 C3b: 09:25:02 首拍滞后快照价格推进 (19.80) 但无 open 时保持 preview
  QUnit.test('5.1(1h) 风险1 C3b: 09:25:02 首拍滞后快照价格推进 (19.80) 但无 open 时保持 preview', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:24:50 最后一拍虚拟价 19.60
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:50+08:00')
    );
    t.equal(t1[1].low, 19.6);
    t.true(t1[1].preview, 'marked as preview');

    // 09:25:02 收到滞后快照（价格推进至 19.80，无 open）
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 19.8, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:02+08:00')
    );
    t.true(t2[1].preview, '09:25:02 无 open 快照保持 preview: true');
    t.equal(t2[1].low, 19.8, '预览柱低点更新为当前预览价 19.8，不锁死 19.60');

    // 09:25:32 收到真实开盘快照 20.50，open 20.50
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 20.5, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:32+08:00')
    );
    t.equal(t3[1].open, 20.5);
    t.equal(t3[1].low, 20.5, '真实快照到达时重基线 low 为 20.5');
    t.false(Boolean(t3[1].preview), 'preview 标记清除');

    // 14:55 盘终
    const t4 = applyLiveQuoteToKline(
      t3,
      { price: 21.3, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t4[1].low, 20.5, '全天 low 恒为 20.5，19.60 与 19.80 彻底消除');
    t.equal(t4[1].high, 21.3);
  });

  // 5.1(1i) 风险1 C4: 滞后快照延续至 09:30:00 以后绝不因硬时钟超时提前清除 preview
  QUnit.test('5.1(1i) 风险1 C4: 滞后快照延续至 09:30:00 以后绝不因硬时钟超时提前清除 preview', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:24:50 - 09:30:00 持续无 open 滞后快照 19.60
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:50+08:00')
    );
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:00+08:00')
    );
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:29:59+08:00')
    );
    const t4 = applyLiveQuoteToKline(
      t3,
      { price: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:30:00+08:00')
    );
    t.true(t4[1].preview, '09:30:00 滞后快照下依然保持 preview: true，不发生硬时钟早退');

    // 09:30:30 收到真实开盘快照 20.50，open 20.50
    const t5 = applyLiveQuoteToKline(
      t4,
      { price: 20.5, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:30:30+08:00')
    );
    t.equal(t5[1].open, 20.5);
    t.equal(t5[1].low, 20.5, '真实快照到达时重基线 low 为 20.5');
    t.false(Boolean(t5[1].preview), 'preview 标记清除');

    // 14:55 盘终
    const t6 = applyLiveQuoteToKline(
      t5,
      { price: 21.3, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t6[1].low, 20.5, '全天 low 恒为 20.5，19.60 彻底消除');
    t.equal(t6[1].high, 21.3);
  });

  // 5.1(1j) 风险1: 快照自带盘前 updateTime 时间戳时即使价格与 open 变动亦保持 preview
  QUnit.test('5.1(1j) 风险1: 快照自带盘前 updateTime 时间戳时即使价格与 open 变动亦保持 preview', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:24:50 虚拟价 19.60
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, updateTime: '20260918092450', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:50+08:00')
    );
    t.true(t1[1].preview, 'marked as preview');

    // 09:25:02 收到快照变动至 19.90 且携带 open 19.90，但其 updateTime 仍为 09:24:55（盘前）
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 19.9, open: 19.9, updateTime: '20260918092455', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:02+08:00')
    );
    t.true(t2[1].preview, '自带盘前 updateTime 判定为滞后快照，保持 preview: true');
    t.equal(t2[1].low, 19.9, '预览低点平移至 19.9，不提前重基线锁死');

    // 09:25:05 真实快照到达（updateTime >= 09:25:00）
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 20.5, open: 20.5, updateTime: '20260918092505', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:05+08:00')
    );
    t.equal(t3[1].open, 20.5);
    t.equal(t3[1].low, 20.5, '真实快照到达时重基线 low 为 20.5');
    t.false(Boolean(t3[1].preview), 'preview 标记清除');

    // 14:55 盘终
    const t4 = applyLiveQuoteToKline(
      t3,
      { price: 21.3, open: 20.5, updateTime: '20260918145500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t4[1].low, 20.5, '全天 low 恒为 20.5');
    t.equal(t4[1].high, 21.3);
  });
});
