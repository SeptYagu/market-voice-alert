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
      { price: 20.5, open: 20.5, updateTime: '20260918092500', tradingDay: '2026-09-18' },
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
      { price: 20.5, open: 20.5, updateTime: '20260918092500', tradingDay: '2026-09-18' },
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
    t.equal(rMid[0].high, 12.5);
    t.equal(rMid[0].low, 8.8);
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

  // 5.1(4f) 需求2分时实时追加：09:15-09:25 竞价窗口追加分钟点判别力（杀 M10）
  QUnit.test('5.1(4f) 需求2分时实时追加：09:15-09:25 竞价窗口追加分钟点判别力', (t) => {
    const items = [
      {
        time: parseBeijingDateTimeToChartSeconds('2026-09-18 09:14'),
        open: 20,
        high: 20,
        low: 20,
        close: 20,
        price: 20,
        volume: 100
      }
    ];
    // 09:15 竞价开始（端点包含）
    const p15 = applyLiveQuoteToIntraday(
      items,
      { price: 20.1, volume: 120, prevClose: 20 },
      new Date('2026-09-18T09:15:00+08:00'),
      false
    );
    t.equal(p15.length, 2, '09:15 竞价起始点成功追加');
    t.equal(p15[1].close, 20.1);

    // 09:18 竞价进行中
    const p18 = applyLiveQuoteToIntraday(
      p15,
      { price: 20.2, volume: 150, prevClose: 20 },
      new Date('2026-09-18T09:18:00+08:00'),
      false
    );
    t.equal(p18.length, 3, '09:18 竞价中间点成功追加');
    t.equal(p18[2].close, 20.2);

    // 09:25 竞价撮合（端点包含）
    const p25 = applyLiveQuoteToIntraday(
      p18,
      { price: 20.3, volume: 200, prevClose: 20 },
      new Date('2026-09-18T09:25:00+08:00'),
      false
    );
    t.equal(p25.length, 4, '09:25 竞价撮合点成功追加');
    t.equal(p25[3].close, 20.3);

    // 09:26-09:29 静默期不追加新分钟点（修正已有末点）
    const p26 = applyLiveQuoteToIntraday(
      p25,
      { price: 20.4, volume: 200, prevClose: 20 },
      new Date('2026-09-18T09:26:00+08:00'),
      false
    );
    t.equal(p26.length, 4, '09:26 静默期不追加新分钟点');
  });

  // 5.1(4g) 资产类型隔离：09:15-09:25 竞价窗口仅对 A 股追加分钟点，港股/美股严格不追加竞价点
  // 5.1(4g) 资产类型隔离：09:15-09:25 竞价窗口对 A 股全部形态（股票/ETF/可转债）追加分钟点，港股/美股严格不追加竞价点
  QUnit.test('5.1(4g) 资产类型隔离：09:15-09:25 竞价窗口对 A 股全部形态追加分钟点，港股/美股严格不追加竞价点', (t) => {
    const baseItems = [
      { time: parseBeijingDateTimeToChartSeconds('2026-09-17 16:00'), close: 20, price: 20, volume: 100 }
    ];

    // A 股主板 09:18: 追加新分钟点
    const aStock = applyLiveQuoteToIntraday(
      baseItems,
      { code: 'sh603533', price: 20.2, volume: 150, prevClose: 20 },
      new Date('2026-09-18T09:18:00+08:00'),
      false
    );
    t.equal(aStock.length, 2, 'A 股股票 09:18 正常追加集合竞价分钟点');

    // A 股 ETF (sh510300) 09:18: 追加新分钟点
    const etfStock = applyLiveQuoteToIntraday(
      baseItems,
      { code: 'sh510300', price: 3.5, volume: 1000, prevClose: 3.4 },
      new Date('2026-09-18T09:18:00+08:00'),
      false
    );
    t.equal(etfStock.length, 2, 'A 股 ETF 09:18 正常追加集合竞价分钟点');

    // A 股可转债 (sh113050) 09:18: 追加新分钟点
    const bondStock = applyLiveQuoteToIntraday(
      baseItems,
      { code: 'sh113050', price: 120, volume: 50, prevClose: 119 },
      new Date('2026-09-18T09:18:00+08:00'),
      false
    );
    t.equal(bondStock.length, 2, 'A 股可转债 09:18 正常追加集合竞价分钟点');

    // 港股 hk00700 09:18: 严格不追加新分钟点
    const hkStock = applyLiveQuoteToIntraday(
      baseItems,
      { code: 'hk00700', type: 'stock_hk', price: 380, volume: 500, prevClose: 375 },
      new Date('2026-09-18T09:18:00+08:00'),
      false
    );
    t.equal(hkStock.length, 1, '港股 09:18 严格不追加竞价点（点数保持不变）');

    // 美股 usAAPL 09:18: 严格不追加新分钟点
    const usStock = applyLiveQuoteToIntraday(
      baseItems,
      { code: 'usAAPL', type: 'stock_us', price: 220, volume: 800, prevClose: 218 },
      new Date('2026-09-18T09:18:00+08:00'),
      false
    );
    t.equal(usStock.length, 1, '美股 09:18 严格不追加竞价点（点数保持不变）');
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

    // 端点 ① 09:20:00: 窗口起点放行，且两次相同报价连续播报（去重绕过，杀 M19c/M20b）
    now = new Date('2026-09-18T09:20:00+08:00');
    const dStart = controller.applySchedule();
    t.true(dStart.timerShouldRun, '09:20:00 端点 timerShouldRun is true (杀 M20b)');
    t.deepEqual(dStart.eligibleCodes, ['sh603533'], '09:20:00 eligibleCodes has sh603533');
    controller.speakSubscribed();
    controller.speakSubscribed();
    t.equal(spoken.length, 2, '09:20:00 端点两次播报均放行（杀 M19c）');

    // 09:22: 区间内部放行
    now = new Date('2026-09-18T09:22:00+08:00');
    const d2 = controller.applySchedule();
    t.true(d2.timerShouldRun, '09:22 timerShouldRun is true');
    t.deepEqual(d2.eligibleCodes, ['sh603533'], '09:22 eligibleCodes has sh603533');

    // 端点 ② 09:24:59: 窗口上界内侧，重复相同报价依然全量播报
    now = new Date('2026-09-18T09:24:59+08:00');
    controller.applySchedule();
    const before2459 = spoken.length;
    controller.speakSubscribed();
    t.equal(spoken.length - before2459, 1, '09:24:59 窗口上界内侧仍全量播报');

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

    // 端点 ③ 09:25:00: 窗口终点，去重即刻恢复生效，重复相同报价播报数 +0（杀 M19b）
    now = new Date('2026-09-18T09:25:00+08:00');
    const d2500 = controller.applySchedule();
    t.true(d2500.timerShouldRun, '09:25:00 定时器保持运行');
    const before2500 = spoken.length;
    controller.speakSubscribed();
    t.equal(spoken.length - before2500, 0, '09:25:00 端点即刻恢复去重（播报增量为 0，杀 M19b）');

    // 09:26: 撮合后，恢复去重约束
    now = new Date('2026-09-18T09:26:00+08:00');
    const d = controller.applySchedule();
    t.true(d.timerShouldRun, '09:26 timer continues running (no stopTimer/startTimer memory.clear)');

    const before = spoken.length;
    controller.speakSubscribed();
    t.equal(spoken.length - before, 0, 'dedup successfully active at 09:26, 0 additional spoken broadcasts');

    // 端点 ④ 09:29:00: 静默期末尾在 autoStartAuction:false 下 eligibleCodes 依然有效（杀 M20c）
    now = new Date('2026-09-18T09:29:00+08:00');
    const d29 = controller.applySchedule();
    t.true(d29.timerShouldRun, '09:29:00 定时器保持运行（杀 M20c）');
    t.deepEqual(d29.eligibleCodes, ['sh603533'], '09:29:00 eligibleCodes 依然有效非空（杀 M20c）');

    // 端点 ⑤ 09:30:00: 正式进入连续竞价 trading 时段
    now = new Date('2026-09-18T09:30:00+08:00');
    const d30 = controller.applySchedule();
    t.true(d30.timerShouldRun, '09:30:00 连续交易时段保持运行');
    t.deepEqual(d30.eligibleCodes, ['sh603533'], '09:30:00 eligibleCodes 包含标的');

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
      { price: 20.5, open: 20.5, updateTime: '20260918092500', tradingDay: '2026-09-18' },
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
      { price: 20.5, open: 20.5, updateTime: '20260918092505', tradingDay: '2026-09-18' },
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
      { price: 20.5, open: 20.5, updateTime: '20260918092532', tradingDay: '2026-09-18' },
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

    // 09:30:30 未知时效报价（无 updateTime）到达，即便有成交量与新价格，因时效无法自证依然严格保持 preview: true
    const t5_unknown = applyLiveQuoteToKline(
      t4,
      { price: 20.5, open: 20.5, volume: 5000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:30:30+08:00')
    );
    t.true(t5_unknown[1].preview, '连续交易时段未知时效报价严格保持 preview: true，防止无时戳虚拟价锁死');
    t.equal(t5_unknown[1].volume, 0);

    // 09:30:30 携带官方交易所时间戳（updateTime >= 09:25:00）的真实开盘快照到达，清除 preview
    const t5 = applyLiveQuoteToKline(
      t4,
      { price: 20.5, open: 20.5, volume: 5000, updateTime: '20260918093030', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:30:30+08:00')
    );
    t.equal(t5[1].open, 20.5);
    t.equal(t5[1].low, 20.5, '真实快照到达时重基线 low 为 20.5');
    t.false(Boolean(t5[1].preview), 'preview 标记清除');

    // 14:55 盘终携带官方时间戳
    const t6 = applyLiveQuoteToKline(
      t5,
      { price: 21.3, open: 20.5, volume: 800000, updateTime: '20260918145500', tradingDay: '2026-09-18' },
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

  // 5.1(1k) 风险1 D: 追加分支在报价无时间戳时不得落成官方柱（P2-1 形态 D）
  QUnit.test('5.1(1k) 风险1 D: 追加分支在报价无时间戳时不得落成官方柱，后续真实快照到达后全天 low 保持真实值', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:25:05 收到无时间戳滞后快照（open: 0, volume: 0）
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 0, volume: 0, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:05+08:00')
    );
    t.equal(t1.length, 2);
    t.true(t1[1].preview, '时效未知且无成交证据的滞后快照落成 preview 柱，绝不落成无标记官方柱');
    t.equal(t1[1].low, 19.6);

    // 09:25:35 真实首拍快照到达（20.50，open 20.50，带成交量与官方时间戳）
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 20.5, open: 20.5, volume: 8000, updateTime: '20260918092535', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:35+08:00')
    );
    t.false(Boolean(t2[1].preview), '真实快照到达，preview 标志清除');
    t.equal(t2[1].open, 20.5);
    t.equal(t2[1].low, 20.5, '重基线 low 为真实成交价 20.5');

    // 14:55:00 盘终
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 21.3, open: 20.5, volume: 900000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t3[1].low, 20.5, '全天 low 恒为 20.5，19.60 彻底消除，不锁死当日最低');
    t.equal(t3[1].high, 21.3);
  });

  // 5.1(1l) 风险1 A: 滞后快照价格与虚拟 open 同步推进但无 volume 时保持 preview（P2-2 形态 A，杀 M3/M4）
  QUnit.test('5.1(1l) 风险1 A: 滞后快照价格与虚拟 open 同步推进但无 volume 时保持 preview', (t) => {
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
    t.true(t1[1].preview, 'marked as preview');
    t.equal(t1[1].low, 19.6);

    // 09:25:02 收到无时间戳滞后快照（价格推进至 19.90，open 推进至 19.90，无 volume 字段）
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 19.9, open: 19.9, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:02+08:00')
    );
    t.true(t2[1].preview, '形态 A 同步推进且无 volume 字段时保持 preview: true，不被误判为官方成交');
    t.equal(t2[1].low, 19.9, '预览低点更新为当前预览价 19.9');

    // 探针 A2: 09:25:02 带 volume: 300（无 updateTime）在 09:30 前亦保持 preview: true
    const t2_vol = applyLiveQuoteToKline(
      t1,
      { price: 19.9, open: 19.9, volume: 300, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:02+08:00')
    );
    t.true(t2_vol[1].preview, '形态 A 滞后快照带 volume: 300（无 updateTime）在 09:30 前保持 preview: true');

    // M3 判别力：open 变化 (20.5) 但 price 不变 (19.9) 时保持 preview（杀 M3）
    const t2_m3 = applyLiveQuoteToKline(
      t2,
      { price: 19.9, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:03+08:00')
    );
    t.true(t2_m3[1].preview, 'M3: price 缺失换挡时保持 preview');

    // M4 判别力：price 变化 (20.1) 但 open 不变 (19.9) 时保持 preview（杀 M4）
    const t2_m4 = applyLiveQuoteToKline(
      t2,
      { price: 20.1, open: 19.9, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:04+08:00')
    );
    t.true(t2_m4[1].preview, 'M4: open 缺失换挡时保持 preview');

    // 09:25:32 真实快照到达 20.50，open 20.50，volume 8000，自带官方时间戳
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 20.5, open: 20.5, volume: 8000, updateTime: '20260918092532', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:32+08:00')
    );
    t.equal(t3[1].open, 20.5);
    t.equal(t3[1].low, 20.5, '真实快照到达时重基线 low 为 20.5');
    t.false(Boolean(t3[1].preview), 'preview 标记清除');

    // 14:55:00 盘终
    const t4 = applyLiveQuoteToKline(
      t3,
      { price: 21.3, open: 20.5, volume: 900000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t4[1].low, 20.5, '全天 low 恒为 20.5，19.90 彻底消除');
    t.equal(t4[1].high, 21.3);
  });

  // 5.1(1m) 风险1 C: 真实开盘价与盘前虚拟价相同但有成交量时立即清除 preview 并保留真实极值包络（P2-2 形态 C）
  QUnit.test('5.1(1m) 风险1 C: 真实开盘价与盘前虚拟价相同但有成交量时立即清除 preview 并保留真实极值包络', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:24:50 虚拟价 20.50
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 20.5, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:50+08:00')
    );
    t.true(t1[1].preview, 'marked as preview');

    // 09:25:05 真实首拍 20.50，open 20.50，带成交量 6000 与官方时间戳（同价掩盖场景）
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 20.5, open: 20.5, volume: 6000, updateTime: '20260918092505', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:05+08:00')
    );
    t.false(Boolean(t2[1].preview), '有成交量证据且时效确认，preview 立即清除');
    t.equal(t2[1].volume, 6000, '成交量 6000 被记录保留');
    t.equal(t2[1].low, 20.5);

    // 09:26:00 真实盘中下探至 20.30，volume 20000
    const t3 = applyLiveQuoteToKline(
      t2,
      { price: 20.3, open: 20.5, volume: 20000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    t.equal(t3[1].low, 20.3, '记录真实低点 20.30');
    t.equal(t3[1].volume, 20000);

    // 09:27:00 价格回升至 20.60，volume 40000
    const t4 = applyLiveQuoteToKline(
      t3,
      { price: 20.6, open: 20.5, volume: 40000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:27:00+08:00')
    );
    t.equal(t4[1].low, 20.3, '真实低点 20.30 完整保留，不被重基线丢弃');
    t.equal(t4[1].high, 20.6);
    t.equal(t4[1].volume, 40000);

    // 14:55:00 盘终
    const t5 = applyLiveQuoteToKline(
      t4,
      { price: 21.3, open: 20.5, volume: 900000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(t5[1].low, 20.3, '全天 low 恒为 20.30');
    t.equal(t5[1].high, 21.3);
  });

  // 5.1(1n) 风险1: 追加分支在 09:26:00 携带有效 updateTime 快照落成官方非 preview 柱（杀 M11）
  QUnit.test('5.1(1n) 风险1: 追加分支在 09:26:00 携带有效 updateTime 快照落成官方非 preview 柱', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:26:00 收到带 updateTime: '20260918092600' 的快照
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 20.5, open: 20.5, updateTime: '20260918092600', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    t.equal(t1.length, 2);
    t.false(Boolean(t1[1].preview), '09:26:00 跨过 09:25 门限，落成官方非 preview 柱');
    t.equal(t1[1].open, 20.5);
    t.equal(t1[1].low, 20.5);
  });

  // 5.1(1o) 盘前滞留分支 volume/amount 归零契约（杀 M8/M8b）
  QUnit.test('5.1(1o) 盘前滞留分支 volume/amount 归零契约（杀 M8/M8b）', (t) => {
    // 步骤 1：构造已含今日 preview 柱但携带非零 volume/amount 的前置（模拟先前残留或带量标记状态）
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 },
      { time: '2026-09-18', open: 20.0, high: 20.0, low: 20.0, close: 20.0, volume: 5000, amount: 60000, preview: true }
    ];

    // 步骤 2：09:26:00 收到盘前时间戳快照更新，触发原地滞留坍缩分支
    const t2 = applyLiveQuoteToKline(
      items,
      { price: 20.1, open: 20.1, volume: 1000, amount: 20000, updateTime: '20260918092450', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    t.true(t2[1].preview, '步骤 2: 盘前快照更新保持 preview 柱');
    t.equal(t2[1].volume, 0, '原地滞留 preview 柱 volume 严格归零（杀 M8/M8b，变异时残留 5000）');
    t.equal(t2[1].amount, 0, '原地滞留 preview 柱 amount 严格归零（杀 M8/M8b，变异时残留 60000）');
    t.equal(t2[1].low, 20.1, '价格坍缩至现价 20.1');
    t.equal(t2[1].high, 20.1);
  });

  // 5.1(1p) 追加分支 Probe B/B2: 09:25:05 无时间戳快照保持 preview: true，14:55 全天 low === 20.50
  QUnit.test('5.1(1p) 追加分支 Probe B/B2: 09:25:05 无时间戳快照保持 preview: true，14:55 全天 low === 20.50', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // Probe B: 09:25:05 无时间戳快照，open 20.50，price 19.60，无 volume 字段
    const b1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 20.5, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:05+08:00')
    );
    t.true(b1[1].preview, 'Probe B: 09:25:05 无时间戳且无 volume 字段保持 preview: true');

    // Probe B2: 09:25:05 无时间戳快照，open 20.50，price 19.60，volume 100
    const b2 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 20.5, volume: 100, amount: 2000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:05+08:00')
    );
    t.true(b2[1].preview, 'Probe B2: 09:25:05 无时间戳但有 volume 保持 preview: true，不提前锁死');

    // 14:55:00 若无时间戳快照到达，原地分支保持 preview: true 且 volume 归零
    const bEndNoTime = applyLiveQuoteToKline(
      b1,
      { price: 21.3, open: 20.5, volume: 900000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.true(bEndNoTime[1].preview, '14:55 无时间戳快照原地保持 preview: true，不误落官方柱');
    t.equal(bEndNoTime[1].volume, 0);

    // 14:55:00 真实盘终带官方交易所时间戳到达（21.30，open 20.50，volume 900000）
    const bEnd = applyLiveQuoteToKline(
      b1,
      { price: 21.3, open: 20.5, volume: 900000, updateTime: '20260918145500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(bEnd[1].low, 20.50, '14:55 全天 low 恒为 20.50，19.60 彻底消除');
    t.false(Boolean(bEnd[1].preview), '14:55 连续交易时段正式清除 preview');
  });

  // 5.1(1q) M16/M17: 09:26:00 集合竞价交接期隔离外部极端 high/low，09:31:00 连续竞价吸收官方权威极值
  QUnit.test('5.1(1q) M16/M17: 09:26:00 集合竞价交接期隔离外部极端 high/low，09:31:00 连续竞价吸收官方权威极值', (t) => {
    // M16: 原地分支清除 preview 时，09:26:00 vs 09:31:00
    const prevItems = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 },
      { time: '2026-09-18', open: 20.5, high: 20.5, low: 20.5, close: 20.5, volume: 0, amount: 0, preview: true }
    ];
    // 09:26:00 携官方 updateTime 清除 preview，但外部报价带有脏极值 high: 25.0, low: 15.0
    const m16_early = applyLiveQuoteToKline(
      prevItems,
      { price: 20.5, open: 20.5, high: 25.0, low: 15.0, updateTime: '20260918092500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    t.equal(m16_early[1].low, 20.5, '09:26:00 原地清 preview 不吸收脏 low 15.0');
    t.equal(m16_early[1].high, 20.5, '09:26:00 原地清 preview 不吸收脏 high 25.0');

    // 09:31:00 连续竞价时段清除 preview，应吸收官方 high: 25.0, low: 15.0
    const m16_continuous = applyLiveQuoteToKline(
      prevItems,
      { price: 20.5, open: 20.5, high: 25.0, low: 15.0, updateTime: '20260918093100', volume: 50000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:31:00+08:00')
    );
    t.equal(m16_continuous[1].low, 15.0, '09:31:00 连续竞价吸收权威 low 15.0');
    t.equal(m16_continuous[1].high, 25.0, '09:31:00 连续竞价吸收权威 high 25.0');

    // M17: 追加分支，09:26:00 携官方 updateTime 追加，但外部报价带有脏极值 high: 25.0, low: 15.0
    const appendItems = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    const m17_early = applyLiveQuoteToKline(
      appendItems,
      { price: 20.5, open: 20.5, high: 25.0, low: 15.0, updateTime: '20260918092600', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    t.equal(m17_early[1].low, 20.5, '09:26:00 追加分支不吸收脏 low 15.0');
    t.equal(m17_early[1].high, 20.5, '09:26:00 追加分支不吸收脏 high 25.0');
  });

  // 5.1(1r) M19: 清除 preview 时重基线必须包含 open，防止 open 低于 price 时丢失真实开盘低点
  QUnit.test('5.1(1r) M19: 清除 preview 时重基线必须包含 open', (t) => {
    const prevItems = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 },
      { time: '2026-09-18', open: 20.2, high: 20.2, low: 20.2, close: 20.2, volume: 0, preview: true }
    ];
    // open 为 20.20，现价为 20.80（无 quoteLow）
    const res = applyLiveQuoteToKline(
      prevItems,
      { price: 20.8, open: 20.2, updateTime: '20260918092500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:05+08:00')
    );
    t.false(Boolean(res[1].preview), 'preview 标记清除');
    t.equal(res[1].open, 20.2);
    t.equal(res[1].low, 20.2, '重基线 low 必须取 open 与 price 之最小值 20.2，不可漏掉 open');
  });

  // 5.1(1s) P2-1/P3-2 原地分支未知时效在 ≥09:30 价格未变或虚拟价漂移均保持 preview，防止虚拟价锁死全天 low
  QUnit.test('5.1(1s) P2-1/P3-2 原地分支未知时效在 ≥09:30 价格未变或虚拟价漂移均保持 preview，防止虚拟价锁死全天 low', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:24:50 盘前虚拟报价 19.60，落成 preview 柱
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:50+08:00')
    );
    t.true(t1[1].preview, '09:24:50 落成 preview 柱');
    t.equal(t1[1].low, 19.6);

    // 09:31:00 未知时效报价滞留（无 updateTime，如东财数据源），价格仍为 19.60，但带盘前撮合量
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 19.6, open: 19.6, volume: 12000, amount: 235200, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:31:00+08:00')
    );
    t.true(t2[1].preview, '09:31:00 价格未发生偏移（price === last.close）且时效未知，保持 preview: true');
    t.equal(t2[1].volume, 0, '保持 preview 柱 volume 为 0');

    // 09:31:30 未知时效报价发生虚拟价漂移（19.60 -> 19.65，带量，open 19.65，无 updateTime）：
    // 严格保持 preview: true，绝不误落官方柱将 19.65 锁死为全天 low！（闭环 P2-1 / 杀 P3-2 漂移变异）
    const t2_drift = applyLiveQuoteToKline(
      t2,
      { price: 19.65, open: 19.65, volume: 12000, amount: 235800, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:31:30+08:00')
    );
    t.true(t2_drift[1].preview, '09:31:30 虚拟价漂移但时效未知，严格保持 preview: true（杀 P3-2 漂移变异）');
    t.equal(t2_drift[1].volume, 0, '漂移保持 preview 柱 volume 严格为 0');
    t.equal(t2_drift[1].low, 19.65, 'preview 模式下 low 坍缩至当前现价 19.65，未被单向锁定');

    // 14:55:00 真实成交到达（20.50，open 20.50，volume 90000，带官方交易所时间戳）
    const t3 = applyLiveQuoteToKline(
      t2_drift,
      { price: 20.5, open: 20.5, volume: 90000, updateTime: '20260918145500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.false(Boolean(t3[1].preview), '14:55:00 携带官方交易所时间戳，正式清除 preview');
    t.equal(t3[1].low, 20.50, '全天 low 恒为真实最低 20.50，19.60 与 19.65 彻底消除不锁死');
    t.equal(t3[1].open, 20.50);
  });

  // 5.1(1t) 追加分支时效未知保守降级为 preview 柱与官方时戳落柱验证（杀 R7-A / 追加分支未知时效保护）
  QUnit.test('5.1(1t) 追加分支时效未知保守降级为 preview 柱与官方时戳落柱验证', (t) => {
    const yesterdayItems = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];

    // 正例：09:35 携带有效官方 updateTime (09:35:00) 且 open 有效，落成官方非 preview 柱
    const normal = applyLiveQuoteToKline(
      yesterdayItems,
      { price: 20.5, open: 20.5, volume: 5000, amount: 100000, updateTime: '20260918093500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:35:00+08:00')
    );
    t.false(Boolean(normal[1].preview), '09:35 官方时戳报价落成官方柱');
    t.equal(normal[1].open, 20.5);
    t.equal(normal[1].volume, 5000);

    // 反例 1（杀 R7-A）：时效未知（无 updateTime）时追加分支绝不落官方柱，保守降级为 preview: true
    const unknownTime = applyLiveQuoteToKline(
      yesterdayItems,
      { price: 20.5, open: 20.5, volume: 5000, amount: 100000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:35:00+08:00')
    );
    t.true(unknownTime[1].preview, '未知时效报价追加分支保持 preview: true，防止虚拟价写死全天');
    t.equal(unknownTime[1].volume, 0, '降级 preview 柱 volume 严格归零');

    // 反例 2：带盘前 updateTime (09:24:50) 的陈旧 payload，绝不落成官方柱
    const stalePreOpen = applyLiveQuoteToKline(
      yesterdayItems,
      { price: 20.5, open: 20.5, volume: 5000, amount: 100000, updateTime: '20260918092450', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T10:00:00+08:00')
    );
    t.true(stalePreOpen[1].preview, '已知盘前时间戳 payload 保持 preview: true');
    t.equal(stalePreOpen[1].volume, 0, '陈旧 payload 柱 volume 归零');

    // 反例 3：09:35 虽带官方 updateTime 但 open 无效 (open: 0)，绝不落成官方柱
    const invalidOpen = applyLiveQuoteToKline(
      yesterdayItems,
      { price: 20.5, open: 0, volume: 5000, amount: 100000, updateTime: '20260918093500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:35:00+08:00')
    );
    t.true(invalidOpen[1].preview, 'open 无效时保持 preview: true');
  });

  // 5.1(1u) 原地分支未知时效/盘前时效 ≥09:30 守护验证（杀 N8/N9/漂移变异）
  QUnit.test('5.1(1u) 原地分支未知时效/盘前时效 ≥09:30 守护验证（杀 N8/N9/漂移变异）', (t) => {
    const prevItems = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 },
      { time: '2026-09-18', open: 19.6, high: 19.6, low: 19.6, close: 19.6, volume: 0, preview: true }
    ];

    // 反例 1（杀 N8）：10:00 收到带有已知盘前 updateTime (09:24:50) 的陈旧 payload，即便有成交量与新价格，亦绝不清除 preview
    const staleInPlace = applyLiveQuoteToKline(
      prevItems,
      { price: 20.5, open: 20.5, volume: 5000, amount: 100000, updateTime: '20260918092450', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T10:00:00+08:00')
    );
    t.true(staleInPlace[1].preview, '原地分支已知盘前时间戳 payload 保持 preview: true（杀 N8）');

    // 反例 2（杀 N9）：09:35 未知时效报价虽有新价格 (20.5 !== 19.6) 与 valid open，但无成交量，绝不清除 preview
    const noVolInPlace = applyLiveQuoteToKline(
      prevItems,
      { price: 20.5, open: 20.5, volume: 0, amount: 0, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:35:00+08:00')
    );
    t.true(noVolInPlace[1].preview, '原地分支未知时效无成交量保持 preview: true（杀 N9）');

    // 反例 3（未知时效即便有成交量与新价格亦保持 preview）：
    const unknownWithVol = applyLiveQuoteToKline(
      prevItems,
      { price: 20.5, open: 20.5, volume: 5000, amount: 100000, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:35:00+08:00')
    );
    t.true(unknownWithVol[1].preview, '原地分支未知时效即便带量与新价格亦严格保持 preview: true');
    t.equal(unknownWithVol[1].volume, 0);

    // 正例对照：携带官方交易所时间戳 (updateTime >= 09:25:00) 与有效 open，清除 preview 成为官方柱
    const officialTrade = applyLiveQuoteToKline(
      prevItems,
      { price: 20.5, open: 20.5, volume: 5000, amount: 100000, updateTime: '20260918093500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:35:00+08:00')
    );
    t.false(Boolean(officialTrade[1].preview), '携带官方时间戳落成官方柱');
    t.equal(officialTrade[1].volume, 5000);
  });

  // 5.1(1v) 探针 P2 端到端：末柱为昨日 + 09:24:59/09:30:00 无时间戳快照保持 preview，14:55 全天 low === 20.50
  QUnit.test('5.1(1v) 探针 P2 端到端：末柱为昨日 + 09:24:59/09:30:00 无时间戳快照保持 preview，14:55 全天 low === 20.50', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:24:59 盘前虚拟报价 19.60（偏离昨收 20.00，带量），追加 preview: true 柱
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, volume: 12000, amount: 235200, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:24:59+08:00')
    );
    t.true(t1[1].preview, '09:24:59 追加分支落成 preview: true 柱');
    t.equal(t1[1].volume, 0);

    // 09:30:00 同上无时间戳报价（仍为虚拟价 19.60），原地分支因 price === last.close 严格保持 preview: true
    const t2 = applyLiveQuoteToKline(
      t1,
      { price: 19.6, open: 19.6, volume: 12000, amount: 235200, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:30:00+08:00')
    );
    t.true(t2[1].preview, '09:30:00 无时间戳且价格未变严格保持 preview: true，绝不误落官方柱');
    t.equal(t2[1].volume, 0);

    // 09:31:30 同上通道漂移到 19.65（无时间戳，带量），原地分支因无官方时戳严格保持 preview: true
    const t2_drift = applyLiveQuoteToKline(
      t2,
      { price: 19.65, open: 19.65, volume: 12000, amount: 235800, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:31:30+08:00')
    );
    t.true(t2_drift[1].preview, '09:31:30 虚拟价漂移时效未知严格保持 preview: true，绝不误落官方柱');
    t.equal(t2_drift[1].volume, 0);

    // 14:55:00 真实成交到达（20.50，open 20.50，volume 90000，自带官方时间戳）
    const t3 = applyLiveQuoteToKline(
      t2_drift,
      { price: 20.5, open: 20.5, volume: 90000, updateTime: '20260918145500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.false(Boolean(t3[1].preview), '14:55 真实成交清除 preview');
    t.equal(t3[1].low, 20.50, '全天 low 恒为真实最低 20.50，19.60 与 19.65 彻底消除');
    t.equal(t3[1].open, 20.50);
  });

  // 5.1(1w) 09:30:00 冷启动无时间戳报价：追加分支保持 preview: true，14:55 全天 low === 20.50
  QUnit.test('5.1(1w) 09:30:00 冷启动无时间戳报价：追加分支保持 preview: true，14:55 全天 low === 20.50', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:30:00 应用冷启动打开，收到无时间戳快照 19.60（即便偏离昨收 20.00 且有量）
    const t1 = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, volume: 12000, amount: 235200, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:30:00+08:00')
    );
    t.true(t1[1].preview, '09:30:00 冷启动追加分支保持 preview: true，绝不落官方柱');
    t.equal(t1[1].volume, 0);

    // 09:31:30 同上通道漂移到 19.65（无时间戳，带量），原地分支因无官方时戳严格保持 preview: true
    const t1_drift = applyLiveQuoteToKline(
      t1,
      { price: 19.65, open: 19.65, volume: 12000, amount: 235800, tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:31:30+08:00')
    );
    t.true(t1_drift[1].preview, '09:31:30 虚拟价漂移时效未知严格保持 preview: true');
    t.equal(t1_drift[1].volume, 0);

    // 14:55:00 真实成交到达（20.50，open 20.50，volume 90000，自带官方时间戳）
    const t2 = applyLiveQuoteToKline(
      t1_drift,
      { price: 20.5, open: 20.5, volume: 90000, updateTime: '20260918145500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.false(Boolean(t2[1].preview), '14:55 真实成交清除 preview');
    t.equal(t2[1].low, 20.50, '全天 low 恒为真实最低 20.50，19.60 与 19.65 彻底消除');
    t.equal(t2[1].open, 20.50);
  });

  // 5.1(1x) 往日陈旧时间戳校验：updateTime 为昨日 15:00:00 时在今日绝不被误判为 postOpenTime 官方柱（闭环待确认风险 1）
  QUnit.test('5.1(1x) 往日陈旧时间戳校验：updateTime 为昨日 15:00:00 时在今日绝不被误判为 postOpenTime 官方柱', (t) => {
    const items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // updateTime: '20260917150000'（前一日收盘时间戳），但 tradingDay 为 '2026-09-18'
    const staleDateQuote = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, volume: 5000, amount: 100000, updateTime: '20260917150000', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:35:00+08:00')
    );
    t.true(staleDateQuote[1].preview, '跨日陈旧时间戳严格判定为时效未知，保持 preview: true');
    t.equal(staleDateQuote[1].volume, 0);
  });

  // 5.1(1y) 官方柱前置 + 盘前时效快照（updateTime < 09:25）@09:26/09:27/09:29 交接期三拍：跳过写入，open/low/high/close 严格保真
  QUnit.test('5.1(1y) 官方柱前置 + 盘前时效快照（updateTime < 09:25）@09:26/09:27/09:29 交接期三拍：跳过写入，open/low/high/close 严格保真', (t) => {
    // 09:25:00 官方开盘柱确立（非 preview 柱）
    let items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 },
      { time: '2026-09-18', open: 20.5, high: 20.5, low: 20.5, close: 20.5, volume: 90000, amount: 1845000 }
    ];

    // 拍 1: 09:26:00 收到盘前 09:18:00 滞后快照（虚拟价 19.60）
    items = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, updateTime: '20260918091800', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    let last = items[items.length - 1];
    t.equal(last.open, 20.5, '09:26:00 官方 open 不受盘前虚拟价 19.60 污染');
    t.equal(last.low, 20.5, '09:26:00 官方 low 不受盘前虚拟价 19.60 污染');
    t.equal(last.high, 20.5, '09:26:00 官方 high 保持 20.50');
    t.equal(last.close, 20.5, '09:26:00 官方 close 保持 20.50');
    t.equal(last.volume, 90000, '09:26:00 官方 volume 保持 90000');

    // 拍 2: 09:27:00 收到盘前 09:24:50 滞后快照（虚拟价 19.70）
    items = applyLiveQuoteToKline(
      items,
      { price: 19.7, open: 19.7, updateTime: '20260918092450', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:27:00+08:00')
    );
    last = items[items.length - 1];
    t.equal(last.open, 20.5, '09:27:00 官方 open 保持 20.50');
    t.equal(last.low, 20.5, '09:27:00 官方 low 保持 20.50');
    t.equal(last.close, 20.5, '09:27:00 官方 close 保持 20.50');

    // 拍 3: 09:29:00 收到盘前 09:24:59 滞后快照（虚拟价 19.50）
    items = applyLiveQuoteToKline(
      items,
      { price: 19.5, open: 19.5, updateTime: '20260918092459', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:29:00+08:00')
    );
    last = items[items.length - 1];
    t.equal(last.open, 20.5, '09:29:00 官方 open 保持 20.50');
    t.equal(last.low, 20.5, '09:29:00 官方 low 保持 20.50');
    t.equal(last.close, 20.5, '09:29:00 官方 close 保持 20.50');

    // 盘中推进: 14:55:00 真实成交（21.00，真实低点 20.30，高点 21.50）
    items = applyLiveQuoteToKline(
      items,
      { price: 21.0, open: 20.5, high: 21.5, low: 20.3, volume: 150000, updateTime: '20260918145500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    last = items[items.length - 1];
    t.equal(last.open, 20.5, '14:55 官方 open 恒为真实 20.50');
    t.equal(last.low, 20.3, '14:55 官方 low 为真实最低 20.30，绝不被 19.50/19.60/19.70 虚假锁死');
    t.equal(last.high, 21.5, '14:55 官方 high 为真实最高 21.50');
    t.equal(last.close, 21.0, '14:55 官方 close 为现价 21.00');
  });

  // 5.1(1z) 独立探针 S1 序列复现与验证：preview 升级官方柱后，滞后快照不污染 open/low，全天 low 恒为真实低点
  QUnit.test('5.1(1z) 独立探针 S1 序列复现与验证：preview 升级官方柱后，滞后快照不污染 open/low', (t) => {
    let items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:18:00 preview 追加柱
    items = applyLiveQuoteToKline(
      items,
      { price: 18.0, open: 18.0, updateTime: '20260918091800', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:18:00+08:00')
    );
    t.true(items[1].preview, '09:18 为 preview 柱');

    // 09:25:03 官方快照升级（o=20.5, l=20.5, v=90000）
    items = applyLiveQuoteToKline(
      items,
      { price: 20.5, open: 20.5, volume: 90000, updateTime: '20260918092500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:03+08:00')
    );
    t.equal(items[1].preview, undefined, '09:25:03 preview 成功清除');
    t.equal(items[1].open, 20.5, '09:25:03 open=20.5');
    t.equal(items[1].low, 20.5, '09:25:03 low=20.5');

    // 09:26:00 到达滞后快照（price=19.6, open=19.6, updateTime=09:18:00）
    items = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, updateTime: '20260918091800', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:26:00+08:00')
    );
    t.equal(items[1].open, 20.5, '09:26:00 S1 滞后快照到达，open 保持 20.50 不被污染');
    t.equal(items[1].low, 20.5, '09:26:00 S1 滞后快照到达，low 保持 20.50 不被污染');
    t.equal(items[1].close, 20.5, '09:26:00 S1 滞后快照到达，close 保持 20.50');

    // 14:55:00 真实成交
    items = applyLiveQuoteToKline(
      items,
      { price: 21.0, open: 20.5, high: 21.5, low: 20.3, volume: 150000, updateTime: '20260918145500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(items[1].open, 20.5, 'S1 序列全天 open 恒为 20.50');
    t.equal(items[1].low, 20.3, 'S1 序列全天 low 恒为真实最低 20.30，下影线彻底消除');
  });

  // 5.1(1za) 独立探针 S2 序列复现与验证：冷启动官方柱追加后，滞后快照不污染 open/low
  QUnit.test('5.1(1za) 独立探针 S2 序列复现与验证：冷启动官方柱追加后，滞后快照不污染 open/low', (t) => {
    let items = [
      { time: '2026-09-17', open: 20, high: 20, low: 20, close: 20, volume: 1000 }
    ];
    // 09:25:00 冷启动官方追加（o=20.5, l=20.5, v=90000）
    items = applyLiveQuoteToKline(
      items,
      { price: 20.5, open: 20.5, volume: 90000, updateTime: '20260918092500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:25:00+08:00')
    );
    t.equal(items[1].preview, undefined, '09:25:00 冷启动落官方柱');
    t.equal(items[1].open, 20.5);
    t.equal(items[1].low, 20.5);

    // 09:27:00 到达滞后快照（updateTime=09:24:50）
    items = applyLiveQuoteToKline(
      items,
      { price: 19.6, open: 19.6, updateTime: '20260918092450', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T09:27:00+08:00')
    );
    t.equal(items[1].open, 20.5, '09:27:00 S2 滞后快照到达，open 保持 20.50 不被污染');
    t.equal(items[1].low, 20.5, '09:27:00 S2 滞后快照到达，low 保持 20.50 不被污染');
    t.equal(items[1].close, 20.5, '09:27:00 S2 滞后快照到达，close 保持 20.50');

    // 14:55:00 真实成交
    items = applyLiveQuoteToKline(
      items,
      { price: 21.0, open: 20.5, high: 21.5, low: 20.3, volume: 150000, updateTime: '20260918145500', tradingDay: '2026-09-18' },
      '1d',
      'sh603533',
      new Date('2026-09-18T14:55:00+08:00')
    );
    t.equal(items[1].open, 20.5, 'S2 序列全天 open 恒为 20.50');
    t.equal(items[1].low, 20.3, 'S2 序列全天 low 恒为真实最低 20.30');
  });
});
