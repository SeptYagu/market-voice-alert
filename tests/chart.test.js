import {
  getChartThemeColors,
  buildChartOptions,
  createKlineChart,
  createIntradayChart,
  CANDLE_UP_COLOR,
  CANDLE_DOWN_COLOR,
  MA_COLORS
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
});
