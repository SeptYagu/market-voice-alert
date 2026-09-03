import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle
} from 'lightweight-charts';
import {
  chartSecondsToDate,
  chartSecondsToTime,
  chartTimeToDate,
  parseBeijingDateTimeToChartSeconds
} from './time.js';

export const CANDLE_UP_COLOR = '#E74C3C';
export const CANDLE_DOWN_COLOR = '#27AE60';

export const MA_COLORS = ['#F39C12', '#3498DB', '#9B59B6', '#16A085'];
export const INTRADAY_PRICE_COLOR = '#2980B9';
export const INTRADAY_AVG_COLOR = '#F39C12';

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
    color: CANDLE_UP_COLOR,
    priceLineVisible: false,
    lastValueVisible: false
  };
}

function _percentFormatter(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function _timeKey(time) {
  return time === null || time === undefined ? '' : String(time);
}

function _detailTime(time) {
  if (typeof time === 'string') return time;
  const date = chartTimeToDate(time);
  const hhmm = chartSecondsToTime(time);
  return [date, hhmm].filter(Boolean).join(' ');
}

function _detailNumber(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '--';
}

function _createDetailLegend(container, className) {
  if (typeof document === 'undefined') return null;
  const legend = document.createElement('div');
  legend.className = `chart-crosshair-detail ${className || ''}`.trim();
  container.appendChild(legend);
  return legend;
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
  const maDataMap = new Map();
  const klineDataMap = new Map();
  const volumeDataMap = new Map();
  const detailLegend = _createDetailLegend(container, 'kline-crosshair-detail');
  let lastCrosshairTime = null;

  function renderDetail(time) {
    if (!detailLegend) return;
    const key = _timeKey(time);
    const entry = klineDataMap.get(key);
    if (!entry) return;
    const { bar, prevClose } = entry;
    const pct = Number(prevClose) > 0 ? (Number(bar.close) / Number(prevClose) - 1) * 100 : NaN;
    const volume = volumeDataMap.get(key);
    const maParts = [];
    for (const [period, data] of maDataMap) {
      const value = data.get(key);
      if (Number.isFinite(value)) maParts.push(`MA${period} ${_detailNumber(value)}`);
    }
    detailLegend.textContent = [
      _detailTime(time),
      `开 ${_detailNumber(bar.open)}`,
      `高 ${_detailNumber(bar.high)}`,
      `低 ${_detailNumber(bar.low)}`,
      `收 ${_detailNumber(bar.close)}`,
      Number.isFinite(pct) ? `幅 ${_percentFormatter(pct)}` : '',
      Number.isFinite(volume) ? `量 ${Math.round(volume).toLocaleString('en-US')}` : '',
      ...maParts
    ].filter(Boolean).join('  ');
  }

  if (typeof chart.subscribeCrosshairMove === 'function') {
    chart.subscribeCrosshairMove((param) => {
      if (param && param.time !== undefined && param.time !== null) {
        lastCrosshairTime = param.time;
        renderDetail(param.time);
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
    const arr = Array.isArray(items) ? items : [];
    candleSeries.setData(arr);
    klineDataMap.clear();
    for (let i = 0; i < arr.length; i++) {
      klineDataMap.set(_timeKey(arr[i].time), {
        bar: arr[i],
        prevClose: i > 0 ? arr[i - 1].close : null
      });
    }
    if (arr.length) renderDetail(arr[arr.length - 1].time);
  }

  function setVolume(bars) {
    const arr = Array.isArray(bars) ? bars : [];
    volumeSeries.setData(arr);
    volumeDataMap.clear();
    for (const bar of arr) volumeDataMap.set(_timeKey(bar.time), Number(bar.value));
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
      // Ignore malformed tick to avoid wiping out full historical series
      return;
    }
    const previous = klineDataMap.get(_timeKey(bar.time));
    let prevClose = previous ? previous.prevClose : null;
    if (prevClose === null || prevClose === undefined) {
      const values = Array.from(klineDataMap.values());
      for (let i = values.length - 1; i >= 0; i--) {
        const entry = values[i];
        if (entry && entry.bar && _timeKey(entry.bar.time) !== _timeKey(bar.time) && Number.isFinite(entry.bar.close)) {
          prevClose = entry.bar.close;
          break;
        }
      }
    }
    klineDataMap.set(_timeKey(bar.time), { bar, prevClose });
    renderDetail(bar.time);
  }

  function updateVolume(bar) {
    if (!bar) return;
    try {
      volumeSeries.update(bar);
    } catch {
      // Ignore malformed tick to avoid wiping out full historical series
      return;
    }
    volumeDataMap.set(_timeKey(bar.time), Number(bar.value));
  }

  function updateMA(period, lastPoint) {
    const series = maSeriesMap.get(period);
    if (!series || !lastPoint) return;
    try {
      series.update(lastPoint);
    } catch {
      /* ignore */
    }
    if (!maDataMap.has(period)) maDataMap.set(period, new Map());
    maDataMap.get(period).set(_timeKey(lastPoint.time), Number(lastPoint.value));
    renderDetail(lastPoint.time);
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
    maDataMap.set(period, new Map(
      (Array.isArray(data) ? data : []).map((point) => [_timeKey(point.time), Number(point.value)])
    ));
    series.setData(Array.isArray(data) ? data : []);
    if (Array.isArray(data) && data.length) renderDetail(data[data.length - 1].time);
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
    maDataMap.clear();
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
    maDataMap.clear();
    klineDataMap.clear();
    volumeDataMap.clear();
    if (detailLegend) detailLegend.remove();
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
  let symmetricPriceRange = null;
  let symmetricPercentRange = null;
  const chart = createChart(container, buildChartOptions({ width, height, theme: currentTheme, period: '1m' }));
  const priceSeries = chart.addLineSeries({
    priceScaleId: 'left',
    color: INTRADAY_PRICE_COLOR,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    autoscaleInfoProvider: () => symmetricPriceRange ? { priceRange: symmetricPriceRange } : null,
    priceFormat: {
      type: 'custom',
      formatter: (value) => {
        const price = Number(value);
        return Number.isFinite(price) ? price.toFixed(2) : '';
      }
    }
  });
  const averageSeries = chart.addLineSeries({
    priceScaleId: 'left',
    color: INTRADAY_AVG_COLOR,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false
  });
  const percentSeries = chart.addLineSeries({
    priceScaleId: 'right',
    color: 'rgba(0,0,0,0)',
    lineWidth: 1,
    lineVisible: false,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    autoscaleInfoProvider: () => symmetricPercentRange ? { priceRange: symmetricPercentRange } : null,
    priceFormat: { type: 'custom', formatter: _percentFormatter }
  });
  const volumeSeries = chart.addHistogramSeries({
    priceScaleId: 'vol',
    priceFormat: { type: 'volume' },
    color: colors.up,
    priceLineVisible: false,
    lastValueVisible: false
  });
  chart.priceScale('vol').applyOptions({
    scaleMargins: { top: 0.78, bottom: 0 }
  });
  chart.priceScale('left').applyOptions({
    visible: true,
    borderColor: colors.border,
    scaleMargins: { top: 0.08, bottom: 0.24 }
  });
  chart.priceScale('right').applyOptions({
    visible: true,
    borderColor: colors.border,
    scaleMargins: { top: 0.08, bottom: 0.24 }
  });
  const intradayDataMap = new Map();
  const detailLegend = _createDetailLegend(container, 'intraday-crosshair-detail');

  function renderIntradayDetail(time) {
    if (!detailLegend) return;
    const point = intradayDataMap.get(_timeKey(time));
    if (!point) return;
    const close = Number(point.close);
    const pct = currentPrevClose > 0 && Number.isFinite(close)
      ? (close / currentPrevClose - 1) * 100
      : Number(point.percent);
    const average = Number(point.avgPrice);
    const volume = Number(point.volume);
    detailLegend.textContent = [
      _detailTime(time),
      `价 ${_detailNumber(close)}`,
      Number.isFinite(pct) ? `幅 ${_percentFormatter(pct)}` : '',
      average > 0 ? `均 ${_detailNumber(average)}` : '均 --',
      Number.isFinite(volume) ? `量 ${Math.round(volume).toLocaleString('en-US')}` : ''
    ].filter(Boolean).join('  ');
  }

  if (typeof chart.subscribeCrosshairMove === 'function') {
    chart.subscribeCrosshairMove((param) => {
      if (param && param.time !== undefined && param.time !== null) renderIntradayDetail(param.time);
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

  function setData(items) {
    const arr = Array.isArray(items) ? items : [];
    intradayDataMap.clear();
    if (!arr.length) {
      currentPrevClose = null;
      if (detailLegend) detailLegend.textContent = '';
      if (priceSeries) priceSeries.setData([]);
      if (averageSeries) averageSeries.setData([]);
      if (percentSeries) percentSeries.setData([]);
      if (volumeSeries) volumeSeries.setData([]);
      return;
    }
    for (const point of arr) intradayDataMap.set(_timeKey(point.time), point);
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
    const byTime = new Map(arr.filter((it) => Number.isFinite(Number(it && it.time))).map((it) => [Number(it.time), it]));
    const firstTime = arr.find((it) => Number.isFinite(Number(it && it.time)))?.time;
    const date = chartSecondsToDate(firstTime);
    const timeline = [];
    if (date) {
      for (const [startHour, startMinute, endHour, endMinute] of [[9, 31, 11, 30], [13, 1, 15, 0]]) {
        const start = startHour * 60 + startMinute;
        const end = endHour * 60 + endMinute;
        for (let minute = start; minute <= end; minute++) {
          const hh = String(Math.floor(minute / 60)).padStart(2, '0');
          const mm = String(minute % 60).padStart(2, '0');
          const time = parseBeijingDateTimeToChartSeconds(`${date} ${hh}:${mm}`);
          if (Number.isFinite(time)) timeline.push(time);
        }
      }
    }
    const displayTimes = timeline.length ? timeline : [...byTime.keys()].sort((a, b) => a - b);
    const averageByTime = new Map();
    for (const it of arr) {
      const explicitAverage = Number(it && it.avgPrice);
      if (Number.isFinite(Number(it && it.time)) && explicitAverage > 0) {
        averageByTime.set(Number(it.time), explicitAverage);
      }
    }
    const priceData = displayTimes.map((time) => {
      const it = byTime.get(time);
      const value = Number(it && it.close);
      return Number.isFinite(value) ? { time, value } : { time };
    });
    const averageData = displayTimes.map((time) => {
      const value = averageByTime.get(time);
      return Number.isFinite(value) ? { time, value } : { time };
    });
    const percentData = displayTimes.map((time) => {
      const it = byTime.get(time);
      const close = Number(it && it.close);
      const value = currentPrevClose > 0 && Number.isFinite(close) ? (close / currentPrevClose - 1) * 100 : NaN;
      return Number.isFinite(value) ? { time, value } : { time };
    });
    const volumeData = displayTimes.map((time) => {
        const it = byTime.get(time);
        if (!it) return { time };
        const value = Number(it.volume);
        if (!Number.isFinite(value)) return { time };
        const close = Number(it.close);
        const open = Number(it.open);
        return {
          time,
          value,
          color: Number.isFinite(close) && Number.isFinite(open) && close < open ? colors.down : colors.up
        };
      });
    if (currentPrevClose > 0) {
      const prices = arr.map((it) => Number(it && it.close)).filter(Number.isFinite);
      const maxDeviation = prices.reduce((max, price) => Math.max(max, Math.abs(price - currentPrevClose)), currentPrevClose * 0.002);
      const padded = maxDeviation * 1.08;
      symmetricPriceRange = { minValue: currentPrevClose - padded, maxValue: currentPrevClose + padded };
      const maxPercent = (padded / currentPrevClose) * 100;
      symmetricPercentRange = { minValue: -maxPercent, maxValue: maxPercent };
    } else {
      symmetricPriceRange = null;
      symmetricPercentRange = null;
    }
    priceSeries.setData(priceData);
    averageSeries.setData(averageData);
    percentSeries.setData(percentData);
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
        axisLabelVisible: false,
        title: '昨收'
      });
    }
    if (arr.length) renderIntradayDetail(arr[arr.length - 1].time);
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
    priceSeries.applyOptions({ color: INTRADAY_PRICE_COLOR });
    averageSeries.applyOptions({ color: INTRADAY_AVG_COLOR });
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
    intradayDataMap.clear();
    if (detailLegend) detailLegend.remove();
  }

  return { setData, applyTheme, resize, fitContent, getVisibleRange, setVisibleRange, destroy };
}
