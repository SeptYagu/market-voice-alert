import {
  getChartThemeColors,
  buildChartOptions,
  createKlineChart,
  createIntradayChart,
  CANDLE_UP_COLOR,
  CANDLE_DOWN_COLOR,
  MA_COLORS,
  INTRADAY_PERCENT_TICKS,
  formatIntradayPercentTick,
  calcIntradayVolumeColor
} from '../src/js/chart.js';

QUnit.module('chart.getChartThemeColors', () => {
  QUnit.test('returns A-stock red-up/green-down across all themes', (t) => {
    for (const theme of ['warm', 'light', 'dark']) {
      const c = getChartThemeColors(theme);
      t.equal(c.up, CANDLE_UP_COLOR, `${theme}.up`);
      t.equal(c.down, CANDLE_DOWN_COLOR, `${theme}.down`);
    }
  });
  QUnit.test('provides background/text/grid per theme', (t) => {
    const dark = getChartThemeColors('dark');
    t.ok(dark.background && dark.background.startsWith('#'));
    t.ok(dark.text && dark.text.startsWith('#'));
    t.ok(dark.grid && dark.grid.startsWith('#'));
    const warm = getChartThemeColors('warm');
    t.notEqual(dark.background, warm.background, 'themes differ');
  });
  QUnit.test('falls back to warm for unknown theme', (t) => {
    const c = getChartThemeColors('bogus');
    const warm = getChartThemeColors('warm');
    t.deepEqual(c, warm);
  });
});

QUnit.module('chart.buildChartOptions', () => {
  QUnit.test('returns options object with width/height/layout', (t) => {
    const opts = buildChartOptions({ width: 800, height: 400, theme: 'light' });
    t.equal(opts.width, 800);
    t.equal(opts.height, 400);
    t.ok(opts.layout, 'layout');
    t.ok(opts.layout.background, 'background');
    t.ok(opts.layout.textColor, 'textColor');
    t.ok(opts.grid, 'grid');
    t.ok(opts.timeScale, 'timeScale');
  });
  QUnit.test('uses theme colors for layout.textColor', (t) => {
    const dark = buildChartOptions({ theme: 'dark' });
    const light = buildChartOptions({ theme: 'light' });
    t.notEqual(dark.layout.textColor, light.layout.textColor);
  });
});

QUnit.module('chart.MA_COLORS', () => {
  QUnit.test('exposes 4 distinct MA colors', (t) => {
    t.equal(MA_COLORS.length, 4);
    const set = new Set(MA_COLORS);
    t.equal(set.size, 4, 'all distinct');
  });
});

function makeHost(width = 600, height = 400) {
  const host = document.createElement('div');
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  document.body.appendChild(host);
  return host;
}

QUnit.module('chart.createKlineChart (instance API)', (hooks) => {
  hooks.afterEach(() => {
    document.body.innerHTML = '';
  });

  QUnit.test('exposes setKline/setVolume/setMA/updateKline/updateVolume/updateMA', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    t.equal(typeof ctl.setKline, 'function');
    t.equal(typeof ctl.setVolume, 'function');
    t.equal(typeof ctl.setMA, 'function');
    t.equal(typeof ctl.updateKline, 'function');
    t.equal(typeof ctl.updateVolume, 'function');
    t.equal(typeof ctl.updateMA, 'function');
    ctl.destroy();
  });

  QUnit.test('setKline + updateKline accept bar data and do not throw', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    const bar = { time: '2024-01-02', open: 10, high: 11, low: 9, close: 10.5 };
    t.ok(ctl, 'instance created');
    ctl.setKline([bar]);
    t.ok(true, 'setKline did not throw');
    ctl.updateKline(bar);
    t.ok(true, 'updateKline did not throw');
    ctl.destroy();
  });

  QUnit.test('updateKline with null no-ops (no throw)', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    ctl.updateKline(null);
    ctl.updateKline(undefined);
    t.ok(true, 'did not throw');
    ctl.destroy();
  });

  QUnit.test('updateVolume with null no-ops (no throw)', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    ctl.updateVolume(null);
    ctl.updateVolume(undefined);
    t.ok(true, 'did not throw');
    ctl.destroy();
  });

  QUnit.test('updateMA on unknown period no-ops (no throw)', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    ctl.updateMA(99, { time: '2024-01-02', value: 10 });
    t.ok(true, 'did not throw');
    ctl.destroy();
  });

  QUnit.test('updateMA with null point no-ops (no throw)', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    ctl.setMA(5, [{ time: '2024-01-02', value: 10 }], '#888');
    ctl.updateMA(5, null);
    ctl.updateMA(5, undefined);
    t.ok(true, 'did not throw');
    ctl.destroy();
  });

  QUnit.test('ctl exposes subscribeBarClick and onClick functions', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    t.equal(typeof ctl.subscribeBarClick, 'function', 'subscribeBarClick is a function');
    t.equal(typeof ctl.onClick, 'function', 'onClick is a function');
    const unsub = ctl.subscribeBarClick(() => {});
    t.equal(typeof unsub, 'function', 'returns unsubscribe function');
    unsub();
    ctl.destroy();
  });

  QUnit.test('setVolume + updateVolume accept bar data and do not throw', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    const bar = { time: '2024-01-02', value: 1000, color: '#E74C3C' };
    ctl.setVolume([bar]);
    ctl.updateVolume(bar);
    t.ok(true, 'did not throw');
    ctl.destroy();
  });

  QUnit.test('setMA + updateMA accept line data and do not throw', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    const points = [
      { time: '2024-01-02', value: 10 },
      { time: '2024-01-03', value: 11 }
    ];
    ctl.setMA(5, points, '#888');
    ctl.updateMA(5, points[1]);
    t.ok(true, 'did not throw');
    ctl.destroy();
  });

  QUnit.test('updateKline called after setKline with a later bar does not throw', (t) => {
    const host = makeHost();
    const ctl = createKlineChart(host, { theme: 'warm', height: 360 });
    ctl.setKline([
      { time: '2024-01-02', open: 10, high: 11, low: 9, close: 10.5 },
      { time: '2024-01-03', open: 10.5, high: 12, low: 10, close: 11.5 }
    ]);
    ctl.updateKline({ time: '2024-01-03', open: 10.5, high: 12, low: 10, close: 12 });
    t.ok(true, 'did not throw');
    ctl.destroy();
  });
});

QUnit.module('chart.createIntradayChart (instance API)', (hooks) => {
  hooks.afterEach(() => {
    document.body.innerHTML = '';
  });

  QUnit.test('percent grid ticks use custom levels', (t) => {
    t.deepEqual(
      INTRADAY_PERCENT_TICKS,
      [3, 7, 10, 13, 17, 20, 23, 27, 30],
      'intraday percent grid levels'
    );
  });

  QUnit.test('formatIntradayPercentTick labels only tick levels', (t) => {
    t.equal(formatIntradayPercentTick(3), '+3.00%', 'level 3 labeled');
    t.equal(formatIntradayPercentTick(-10), '-10.00%', 'negative level labeled');
    t.equal(formatIntradayPercentTick(30), '+30.00%', 'top level labeled');
    t.equal(formatIntradayPercentTick(4), '', 'native tick 4 blanked');
    t.equal(formatIntradayPercentTick(12), '', 'native tick 12 blanked');
    t.equal(formatIntradayPercentTick(0), '', 'zero blanked (昨收虚线承担)');
    t.equal(formatIntradayPercentTick(NaN), '', 'non-finite blanked');
  });

  QUnit.test('setData accepts price, percent, average price, and volume fields', (t) => {
    const host = makeHost();
    const ctl = createIntradayChart(host, { theme: 'warm', height: 360 });
    ctl.setData([
      {
        time: 1780622100,
        open: 10,
        high: 10.2,
        low: 9.9,
        close: 10.1,
        avgPrice: 10.05,
        percent: 1,
        volume: 100
      },
      {
        time: 1780622160,
        open: 10.1,
        high: 10.3,
        low: 10.1,
        close: 10.3,
        avgPrice: 10.15,
        percent: 3,
        volume: 120
      }
    ]);
    t.ok(true, 'setData did not throw');
    ctl.applyTheme('dark');
    ctl.destroy();
  });

  QUnit.test('calcIntradayVolumeColor adheres to standard red-up / green-down rules', (t) => {
    // 价格较上一分钟上涨 -> 红色
    t.equal(calcIntradayVolumeColor(10.5, 10.2), CANDLE_UP_COLOR, 'close > prevPrice is red');
    // 价格较上一分钟下跌 -> 绿色
    t.equal(calcIntradayVolumeColor(9.8, 10.0), CANDLE_DOWN_COLOR, 'close < prevPrice is green');
    // 价格与上一分钟持平 -> 延续 fallbackColor
    t.equal(calcIntradayVolumeColor(10.0, 10.0, CANDLE_DOWN_COLOR), CANDLE_DOWN_COLOR, 'close === prevPrice maintains fallback green');
    t.equal(calcIntradayVolumeColor(10.0, 10.0, CANDLE_UP_COLOR), CANDLE_UP_COLOR, 'close === prevPrice maintains fallback red');
    // 首根无昨收时回退 open
    t.equal(calcIntradayVolumeColor(10.5, NaN, CANDLE_UP_COLOR, undefined, 10.2), CANDLE_UP_COLOR, 'fallback to open > close');
    t.equal(calcIntradayVolumeColor(9.8, NaN, CANDLE_UP_COLOR, undefined, 10.0), CANDLE_DOWN_COLOR, 'fallback to open < close');
    // 无效输入回退 fallbackColor
    t.equal(calcIntradayVolumeColor(NaN, 10.0, CANDLE_UP_COLOR), CANDLE_UP_COLOR, 'invalid close falls back');
  });

  QUnit.test('intraday chart assigns red/green volume bar colors correctly across rising and falling minutes', (t) => {
    const host = makeHost();
    const ctl = createIntradayChart(host, { theme: 'warm', height: 360 });
    // 首根比对 preClose(10.0):
    // 1780622100: close 10.5 > 10.0 -> 红
    // 1780622160: close 10.2 < 10.5 -> 绿
    // 1780622220: close 10.2 === 10.2 -> 绿（持平延续）
    // 1780622280: close 10.6 > 10.2 -> 红
    ctl.setData([
      { time: 1780622100, close: 10.5, volume: 100, preClose: 10.0, percent: 5 },
      { time: 1780622160, close: 10.2, volume: 150, preClose: 10.0, percent: 2 },
      { time: 1780622220, close: 10.2, volume: 80, preClose: 10.0, percent: 2 },
      { time: 1780622280, close: 10.6, volume: 200, preClose: 10.0, percent: 6 }
    ]);

    const volData = ctl._getDisplayVolumeData();
    const barsWithVol = volData.filter((d) => Number.isFinite(d.value));
    t.equal(barsWithVol.length, 4, '4 volume bars present');
    t.equal(barsWithVol[0].color, CANDLE_UP_COLOR, 'bar 1 (10.5 > 10.0 preClose) is red');
    t.equal(barsWithVol[1].color, CANDLE_DOWN_COLOR, 'bar 2 (10.2 < 10.5) is green');
    t.equal(barsWithVol[2].color, CANDLE_DOWN_COLOR, 'bar 3 (10.2 === 10.2) keeps green');
    t.equal(barsWithVol[3].color, CANDLE_UP_COLOR, 'bar 4 (10.6 > 10.2) is red');

    // 测试 updatePoint 动态更新量柱颜色：
    // 第 5 根：初始报价 10.1 < 10.6 -> 绿
    ctl.updatePoint({ time: 1780622340, close: 10.1, volume: 90 });
    let updatedVol = ctl._getDisplayVolumeData().filter((d) => Number.isFinite(d.value));
    t.equal(updatedVol[4].color, CANDLE_DOWN_COLOR, 'live tick (10.1 < 10.6) is green');

    // 第 5 根追加更高报价：10.9 > 10.6 -> 翻红
    ctl.updatePoint({ time: 1780622340, close: 10.9, volume: 120 });
    updatedVol = ctl._getDisplayVolumeData().filter((d) => Number.isFinite(d.value));
    t.equal(updatedVol[4].color, CANDLE_UP_COLOR, 'live tick update (10.9 > 10.6) turns red');

    ctl.destroy();
  });
});

