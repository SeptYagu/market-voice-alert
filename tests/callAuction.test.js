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

  // 5.1(1) A 股掌阅科技集合竞价跌停下影线消除（双前置覆盖）
  QUnit.test('5.1(1a) A 股盘前跌停下影线消除 - 追加路径（items 末柱为昨日）', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:18 传入跌停价 18.00（追加分支，创建今日临时柱，价格收敛于 18.00）
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 18, open: 18, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(t1.length, 2, 'appends today bar');
    t.equal(t1[1].low, 18, '09:18 temporary bar low is 18.00');

    // 09:19 撤单价格回升至 20.00（原地更新分支，价格收敛于 20.00，抹除 18.00）
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 20, open: 20, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:19:00+08:00')
    );
    t.equal(t2.length, 2);
    t.equal(t2[1].low, 20, '09:19 order cancelled, low rebounds to 20.00');

    // 09:25 正式开盘 20.00
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 20, open: 20, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:00+08:00')
    );
    t.equal(t3[1].low, 20.00, '今日 Bar 的 low === 20.00，绝不保留 18.00（追加路径）');
  });

  QUnit.test('5.1(1b) A 股盘前跌停下影线消除 - 原地更新路径（items 已含今日柱）', (t) => {
    const items = [
      { time: '2026-09-18', open: 20, high: 20, low: 20, close: 20, volume: 0 }
    ];
    // 09:18 跌停价 18.00
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 18, open: 18, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.equal(t1[0].low, 18, '09:18 low is 18.00');

    // 09:19 撤单回升至 20.00
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 20, open: 20, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:19:00+08:00')
    );
    t.equal(t2[0].low, 20, '09:19 low rebounds to 20.00');

    // 09:25 正式开盘 20.00
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 20, open: 20, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:00+08:00')
    );
    t.equal(t3[0].low, 20.00, '今日 Bar 的 low === 20.00，绝不保留 18.00（原地路径）');
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
});
