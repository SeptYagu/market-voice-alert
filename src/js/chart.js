import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle
} from 'lightweight-charts';
import { chartSecondsToDate, chartSecondsToTime } from './time.js';

export const CANDLE_UP_COLOR = '#E74C3C';
export const CANDLE_DOWN_COLOR = '#27AE60';

export const MA_COLORS = ['#F39C12', '#3498DB', '#9B59B6', '#16A085'];

const THEME_PALETTE = Object.freeze({
  warm: {
    background: '#FFFFFF',
    text: '#333333',
    grid: '#E8E0D5',
    border: '#E8E0D5',
    crosshair: '#999999'
  },
  light: {
    background: '#FFFFFF',
    text: '#333333',
    grid: '#E8EAED',
    border: '#E0E0E0',
    crosshair: '#999999'
  },
  dark: {
    background: '#2A2A3E',
    text: '#E8E8E8',
    grid: '#3A3A4E',
    border: '#3A3A4E',
    crosshair: '#B0B0B0'
  }
});

export function getChartThemeColors(theme) {
  const palette = THEME_PALETTE[theme] || THEME_PALETTE.warm;
  return {
    ...palette,
    up: CANDLE_UP_COLOR,
    down: CANDLE_DOWN_COLOR
  };
}

function _timeScaleOptions(c, period = '1d') {
  const isMinute = ['1m', '5m', '15m', '30m', '60m'].includes(period);
  return {
    borderColor: c.border,
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: (time) => {
      if (typeof time === 'string') return time;
      return isMinute ? chartSecondsToTime(time) : chartSecondsToDate(time);
    }
  };
}

export function buildChartOptions({ width, height, theme, period } = {}) {
  const c = getChartThemeColors(theme);
  return {
    width: width || 800,
    height: height || 360,
    layout: {
      background: { type: ColorType.Solid, color: c.background },
      textColor: c.text,
      attributionLogo: false
    },
    grid: {
      vertLines: { color: c.grid },
      horzLines: { color: c.grid }
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: c.border },
    timeScale: _timeScaleOptions(c, period)
  };
}

function _candleSeriesOptions() {
  return {
    upColor: CANDLE_UP_COLOR,
    downColor: CANDLE_DOWN_COLOR,
    borderUpColor: CANDLE_UP_COLOR,
    borderDownColor: CANDLE_DOWN_COLOR,
    wickUpColor: CANDLE_UP_COLOR,
    wickDownColor: CANDLE_DOWN_COLOR
  };
}

function _volumeSeriesOptions() {
  return {
    priceScaleId: 'vol',
    priceFormat: { type: 'volume' },
    color: CANDLE_UP_COLOR
  };
}

function _percentFormatter(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function createKlineChart(container, opts = {}) {
  if (!container) throw new Error('container required');
  const width = container.clientWidth || 800;
  const height = opts.height || 360;
  let currentTheme = opts.theme || 'warm';
  let currentPeriod = opts.period || '1d';
  const chart = createChart(container, buildChartOptions({ width, height, theme: currentTheme, period: currentPeriod }));

  const candleSeries = chart.addCandlestickSeries(_candleSeriesOptions());
  const volumeSeries = chart.addHistogramSeries(_volumeSeriesOptions());
  chart.priceScale('vol').applyOptions({
    scaleMargins: { top: 0.78, bottom: 0 }
  });

  const maSeriesMap = new Map();
  let lastCrosshairTime = null;

  if (typeof chart.subscribeCrosshairMove === 'function') {
    chart.subscribeCrosshairMove((param) => {
      if (param && param.time !== undefined && param.time !== null) {
        lastCrosshairTime = param.time;
      }
    });
  }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w > 0) chart.applyOptions({ width: w });
    });
    ro.observe(container);
  }

  function setKline(items) {
    candleSeries.setData(Array.isArray(items) ? items : []);
  }

  function setVolume(bars) {
    volumeSeries.setData(Array.isArray(bars) ? bars : []);
  }

  // Live-tick update API: mutates the LAST bar only, preserving the user's
  // zoom/pan state on the time scale. Call on every refresh tick.
  // Falls back to setData when the supplied bar's time isn't the last bar's
  // (lightweight-charts throws in that case so a new bar must be added via
  // setData — callers should re-fetch the full series in that scenario).
  function updateKline(bar) {
    if (!bar) return;
    try {
      candleSeries.update(bar);
    } catch {
      candleSeries.setData([bar]);
    }
  }

  function updateVolume(bar) {
    if (!bar) return;
    try {
      volumeSeries.update(bar);
    } catch {
      volumeSeries.setData([bar]);
    }
  }

  function updateMA(period, lastPoint) {
    const series = maSeriesMap.get(period);
    if (!series || !lastPoint) return;
    try {
      series.update(lastPoint);
    } catch {
      /* ignore */
    }
  }

  function setMA(period, data, color) {
    let series = maSeriesMap.get(period);
    if (!series) {
      series = chart.addLineSeries({
        color: color || '#888',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      maSeriesMap.set(period, series);
    } else if (color) {
      series.applyOptions({ color });
    }
    series.setData(Array.isArray(data) ? data : []);
  }

  function clearMA() {
    for (const series of maSeriesMap.values()) {
      try {
        chart.removeSeries(series);
      } catch {
        /* ignore */
      }
    }
    maSeriesMap.clear();
  }

  function applyTheme(nextTheme) {
    currentTheme = nextTheme || currentTheme;
    chart.applyOptions(buildChartOptions({
      width: container.clientWidth || width,
      height,
      theme: currentTheme,
      period: currentPeriod
    }));
  }

  function setPeriod(period) {
    currentPeriod = period || currentPeriod;
    chart.applyOptions({ timeScale: _timeScaleOptions(getChartThemeColors(currentTheme), currentPeriod) });
  }

  function onClick(fn) {
    if (typeof fn !== 'function' || typeof chart.subscribeClick !== 'function') return () => {};
    const handler = (param) => {
      const time = param && param.time !== undefined && param.time !== null ? param.time : lastCrosshairTime;
      if (time !== undefined && time !== null) fn(time, param);
    };
    chart.subscribeClick(handler);
    return () => {
      try { chart.unsubscribeClick(handler); } catch { /* ignore */ }
    };
  }

  function resize() {
    const w = container.clientWidth;
    if (w > 0) chart.applyOptions({ width: w });
  }

  function fitContent() {
    try {
      chart.timeScale().fitContent();
    } catch {
      /* ignore */
    }
  }

  function getVisibleRange() {
    try {
      return chart.timeScale().getVisibleRange();
    } catch {
      return null;
    }
  }

  function setVisibleRange(range) {
    if (!range || range.from === undefined || range.to === undefined) return false;
    try {
      chart.timeScale().setVisibleRange(range);
      return true;
    } catch {
      return false;
    }
  }

  function destroy() {
    if (ro) {
      try {
        ro.disconnect();
      } catch {
        /* ignore */
      }
      ro = null;
    }
    try {
      chart.remove();
    } catch {
      /* ignore */
    }
    maSeriesMap.clear();
  }

  return {
    setKline,
    setVolume,
    setMA,
    updateKline,
    updateVolume,
    updateMA,
    clearMA,
    applyTheme,
    setPeriod,
    onClick,
    resize,
    fitContent,
    getVisibleRange,
    setVisibleRange,
    destroy
  };
}

export function createIntradayChart(container, opts = {}) {
  if (!container) throw new Error('container required');
  const width = container.clientWidth || 400;
  const height = opts.height || 360;
  let currentTheme = opts.theme || 'warm';
  let colors = getChartThemeColors(currentTheme);
  let currentPrevClose = 0;
  let zeroLine = null;
  const chart = createChart(container, buildChartOptions({ width, height, theme: currentTheme, period: '1m' }));
  const priceSeries = chart.addLineSeries({
    color: colors.up,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: {
      type: 'custom',
      formatter: (value) => {
        const price = Number(value);
        if (!Number.isFinite(price)) return '';
        const pct = currentPrevClose > 0 ? (price / currentPrevClose - 1) * 100 : null;
        return pct === null ? price.toFixed(2) : `${price.toFixed(2)} (${_percentFormatter(pct)})`;
      }
    }
  });
  const volumeSeries = chart.addHistogramSeries({
    priceScaleId: 'vol',
    priceFormat: { type: 'volume' },
    color: colors.up
  });
  chart.priceScale('vol').applyOptions({
    scaleMargins: { top: 0.78, bottom: 0 }
  });

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w > 0) chart.applyOptions({ width: w });
    });
    ro.observe(container);
  }

  function setData(items) {
    const arr = Array.isArray(items) ? items : [];
    const firstWithPreClose = arr.find((it) => Number.isFinite(Number(it.preClose)) && Number(it.preClose) > 0);
    currentPrevClose = firstWithPreClose
      ? Number(firstWithPreClose.preClose)
      : (Number.isFinite(Number(arr[0] && arr[0].prevClose)) ? Number(arr[0].prevClose) : currentPrevClose);
    if (!currentPrevClose) {
      const firstPct = arr.find((it) => Number.isFinite(Number(it.percent)) && Number.isFinite(Number(it.close)));
      if (firstPct && Number(firstPct.percent) !== -100) {
        currentPrevClose = Number(firstPct.close) / (1 + Number(firstPct.percent) / 100);
      }
    }
    const priceData = Array.isArray(items)
      ? items.map((it) => ({ time: it.time, value: Number(it.close) })).filter((it) => Number.isFinite(it.value))
      : [];
    const volumeData = arr
      .map((it) => {
        const value = Number(it.volume);
        if (!Number.isFinite(value)) return null;
        const close = Number(it.close);
        const open = Number(it.open);
        return {
          time: it.time,
          value,
          color: Number.isFinite(close) && Number.isFinite(open) && close < open ? colors.down : colors.up
        };
      })
      .filter(Boolean);
    priceSeries.setData(priceData);
    volumeSeries.setData(volumeData);
    if (zeroLine) {
      try { priceSeries.removePriceLine(zeroLine); } catch { /* ignore */ }
      zeroLine = null;
    }
    if (currentPrevClose > 0) {
      zeroLine = priceSeries.createPriceLine({
        price: currentPrevClose,
        color: colors.text,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '0%'
      });
    }
  }

  function applyTheme(nextTheme) {
    currentTheme = nextTheme || currentTheme;
    const c = getChartThemeColors(currentTheme);
    colors = c;
    chart.applyOptions(buildChartOptions({
      width: container.clientWidth || width,
      height,
      theme: currentTheme,
      period: '1m'
    }));
    priceSeries.applyOptions({ color: c.up });
    volumeSeries.applyOptions({ color: c.up });
    if (zeroLine) {
      zeroLine.applyOptions({ color: c.text });
    }
  }

  function resize() {
    const w = container.clientWidth;
    if (w > 0) chart.applyOptions({ width: w });
  }

  function fitContent() {
    try { chart.timeScale().fitContent(); } catch { /* ignore */ }
  }

  function getVisibleRange() {
    try {
      return chart.timeScale().getVisibleRange();
    } catch {
      return null;
    }
  }

  function setVisibleRange(range) {
    if (!range || range.from === undefined || range.to === undefined) return false;
    try {
      chart.timeScale().setVisibleRange(range);
      return true;
    } catch {
      return false;
    }
  }

  function destroy() {
    if (ro) {
      try { ro.disconnect(); } catch { /* ignore */ }
      ro = null;
    }
    try { chart.remove(); } catch { /* ignore */ }
  }

  return { setData, applyTheme, resize, fitContent, getVisibleRange, setVisibleRange, destroy };
}
