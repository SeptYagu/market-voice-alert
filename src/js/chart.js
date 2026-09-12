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

// 分时图右侧百分比网格刻度档位（正负对称生效，0% 由昨收虚线承担）。
// 想增删档位直接改这个数组即可；超出当前对称显示范围的档位自动不画。
export const INTRADAY_PERCENT_TICKS = [3, 7, 10, 13, 17, 20, 23, 27, 30];

// 分时图右轴刻度格式化：只在档位上显示标签，其余原生刻度标签置空。
// 轻量图表库（lightweight-charts v4）不支持自定义价格刻度位置，网格线
// 改由 percent series 上的自定义 price lines 绘制（见 createIntradayChart），
// 原生刻度标签靠这里遮蔽。注意：十字线右轴百分比读数也会走这里（置空），
// 悬停百分比读数由浮层图例的「幅」提供。
export function formatIntradayPercentTick(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const hit = INTRADAY_PERCENT_TICKS.some((t) => Math.abs(Math.abs(n) - t) < 1e-6);
  return hit ? _percentFormatter(n) : '';
}

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

// Intraday (分时) charts: panning/zooming disabled — the full session is always
// visible. NOTE 1: fixLeftEdge/fixRightEdge must stay OFF: lightweight-charts
// anchors those edges to the last bar *with a value* and ignores trailing
// whitespace bars, which shoves the whole curve to the right of the plot.
// The visible range is pinned explicitly via setVisibleLogicalRange in
// setData/fitContent instead.
// NOTE 2: handleScroll/handleScale are CHART-ROOT options — nesting them under
// timeScale is silently ignored by lightweight-charts, so they are applied via
// _intradayChartInteractionOptions() at the root level.
function _intradayTimeScaleOptions(c) {
  return {
    ..._timeScaleOptions(c, '1m'),
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: true,
    leftOffset: 0,
    rightOffset: 0
  };
}

// Chart-root options: disable all user scroll/zoom/scale interaction
// (mouse drag, wheel, pinch, price-axis drag, double-click reset).
function _intradayChartInteractionOptions() {
  return {
    handleScroll: false,
    handleScale: false
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

// The detail legend is inserted as a sibling ABOVE the chart host (normal
// flow), not overlaid inside it — an absolute overlay always covers the
// price action near the top of the plot (e.g. a big-gain chart whose curve
// hugs the top edge).
// Structure: a fixed TWO-line block. Line 1 = main readout (K线) or blank
// (分时), line 2 = MA series (K线) or the readout (分时). Both panes reserve
// the same two lines so the chart-split charts stay vertically aligned.
function _createDetailLegend(container, className) {
  if (typeof document === 'undefined') return null;
  const legend = document.createElement('div');
  legend.className = `chart-crosshair-detail ${className || ''}`.trim();
  const mainLine = document.createElement('div');
  mainLine.className = 'legend-line legend-line-main';
  const subLine = document.createElement('div');
  subLine.className = 'legend-line legend-line-sub';
  legend.appendChild(mainLine);
  legend.appendChild(subLine);
  const parent = container.parentNode || container;
  parent.insertBefore(legend, container);
  return { root: legend, mainLine, subLine };
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
    const mainText = [
      _detailTime(time),
      `开 ${_detailNumber(bar.open)}`,
      `高 ${_detailNumber(bar.high)}`,
      `低 ${_detailNumber(bar.low)}`,
      `收 ${_detailNumber(bar.close)}`,
      Number.isFinite(pct) ? `幅 ${_percentFormatter(pct)}` : '',
      Number.isFinite(volume) ? `量 ${Math.round(volume).toLocaleString('en-US')}` : ''
    ].filter(Boolean).join('  ');
    const maText = maParts.join('  ');
    // Line 1 = OHLC readout, line 2 = MA series. Each line ellipsizes when
    // too long; the title tooltip keeps the full text accessible.
    detailLegend.mainLine.textContent = mainText;
    detailLegend.mainLine.title = mainText;
    detailLegend.subLine.textContent = maText;
    detailLegend.subLine.title = maText;
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
    if (detailLegend) detailLegend.root.remove();
  }

  function subscribeVisibleRange(handler) {
    if (typeof handler !== 'function') return () => {};
    const listener = (newRange) => {
      try {
        handler(newRange || getVisibleRange());
      } catch {
        /* ignore */
      }
    };
    try {
      chart.timeScale().subscribeVisibleTimeRangeChange(listener);
    } catch {
      /* ignore */
    }
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(listener);
      } catch {
        /* ignore */
      }
    };
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
    subscribeBarClick: onClick,
    resize,
    fitContent,
    getVisibleRange,
    setVisibleRange,
    subscribeVisibleRange,
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
  let lastDisplayCount = 0;
  // The display arrays behind each series (including the trailing whitespace
  // bars of the pinned 9:30-15:00 stock grid). updatePoint() merges new
  // values into these and re-sets the series — see updatePoint below.
  let displayPriceData = [];
  let displayAverageData = [];
  let displayPercentData = [];
  let displayVolumeData = [];
  // Keeps the full session visible: fitContent() and the fix* edge options both
  // anchor to the last bar *with a value* and ignore trailing whitespace bars,
  // so we pin the logical range to the generated display timeline instead.
  function pinFullSessionRange() {
    if (lastDisplayCount < 2) return;
    try {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: lastDisplayCount - 1 });
    } catch { /* ignore */ }
  }
  const chart = createChart(container, {
    ...buildChartOptions({ width, height, theme: currentTheme, period: '1m' }),
    ..._intradayChartInteractionOptions()
  });
  chart.applyOptions({ timeScale: _intradayTimeScaleOptions(colors) });
  // 横向网格改用 INTRADAY_PERCENT_TICKS 自定义档位（自定义 price lines），
  // 必须关掉原生水平网格，否则 4/8/12% 的原生网格会和自定义网格并存。
  chart.applyOptions({ grid: { horzLines: { visible: false } } });
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
    priceFormat: { type: 'custom', formatter: formatIntradayPercentTick }
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
  // 分时图百分比网格线（画在 percent series 上，横贯绘图区并带右轴标签）。
  let percentTickLines = [];

  // lightweight-charts v4 无法自定义价格刻度位置，用「隐藏系列 + 自定义
  // price lines」替代原生水平网格：线用网格色、标签画成原生刻度的样子。
  function rebuildPercentTickLines() {
    for (const line of percentTickLines) {
      try { percentSeries.removePriceLine(line); } catch { /* ignore */ }
    }
    percentTickLines = [];
    if (!symmetricPercentRange) return;
    const maxPercent = Math.abs(Number(symmetricPercentRange.maxValue));
    if (!Number.isFinite(maxPercent) || maxPercent <= 0) return;
    for (const level of INTRADAY_PERCENT_TICKS) {
      if (level > maxPercent) continue; // 超出显示范围的档位不画
      for (const value of [level, -level]) {
        try {
          percentTickLines.push(percentSeries.createPriceLine({
            price: value,
            color: colors.grid,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            // 标签底色=图表背景（徽章不可见）、文字=主题文字色，观感与原生刻度一致
            axisLabelColor: colors.background,
            axisLabelTextColor: colors.text,
            title: ''
          }));
        } catch { /* ignore */ }
      }
    }
  }
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
    const text = [
      _detailTime(time),
      `价 ${_detailNumber(close)}`,
      Number.isFinite(pct) ? `幅 ${_percentFormatter(pct)}` : '',
      average > 0 ? `均 ${_detailNumber(average)}` : '均 --',
      Number.isFinite(volume) ? `量 ${Math.round(volume).toLocaleString('en-US')}` : ''
    ].filter(Boolean).join('  ');
    // Line 1 stays blank: the K线 pane renders its MA series there, so the
    // data rows of both panes sit on the same visual line.
    detailLegend.mainLine.textContent = '';
    detailLegend.mainLine.title = '';
    detailLegend.subLine.textContent = text;
    detailLegend.subLine.title = text;
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
    lastDisplayCount = 0;
    if (!arr.length) {
      currentPrevClose = null;
      if (detailLegend) {
        detailLegend.mainLine.textContent = '';
        detailLegend.mainLine.title = '';
        detailLegend.subLine.textContent = '';
        detailLegend.subLine.title = '';
      }
      displayPriceData = [];
      displayAverageData = [];
      displayPercentData = [];
      displayVolumeData = [];
      if (priceSeries) priceSeries.setData([]);
      if (averageSeries) averageSeries.setData([]);
      if (percentSeries) percentSeries.setData([]);
      if (volumeSeries) volumeSeries.setData([]);
      return;
    }
    for (const point of arr) intradayDataMap.set(_timeKey(point.time), point);
    const firstWithPreClose = arr.find((it) => Number.isFinite(Number(it.prevSettlement || it.preClose)) && Number(it.prevSettlement || it.preClose) > 0);
    currentPrevClose = firstWithPreClose
      ? Number(firstWithPreClose.prevSettlement || firstWithPreClose.preClose)
      : (Number.isFinite(Number(arr[0] && (arr[0].prevSettlement || arr[0].prevClose))) ? Number(arr[0].prevSettlement || arr[0].prevClose) : currentPrevClose);
    if (!currentPrevClose) {
      const firstPct = arr.find((it) => Number.isFinite(Number(it.percent)) && Number.isFinite(Number(it.close)));
      if (firstPct && Number(firstPct.percent) !== -100) {
        currentPrevClose = Number(firstPct.close) / (1 + Number(firstPct.percent) / 100);
      }
    }
    const byTime = new Map(arr.filter((it) => Number.isFinite(Number(it && it.time))).map((it) => [Number(it.time), it]));
    const firstTime = arr.find((it) => Number.isFinite(Number(it && it.time)))?.time;
    const date = chartSecondsToDate(firstTime);

    const hasNonStockHours = arr.some((it) => {
      if (!it || !Number.isFinite(Number(it.time))) return false;
      const hhmm = chartSecondsToTime(it.time);
      if (!hhmm) return false;
      const [h, m] = hhmm.split(':').map(Number);
      const min = h * 60 + m;
      return (min < 9 * 60 + 30 && min >= 9 * 60) || min >= 15 * 60 + 5 || min < 9 * 60;
    });

    const isFutureTimeline = opts.isFuture || hasNonStockHours;
    const timeline = [];
    if (date && !isFutureTimeline) {
      for (const [startHour, startMinute, endHour, endMinute] of [[9, 30, 11, 30], [13, 0, 15, 0]]) {
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
    const displayTimes = (!isFutureTimeline && timeline.length) ? timeline : [...byTime.keys()].sort((a, b) => a - b);
    lastDisplayCount = displayTimes.length;
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
          color: close >= open ? colors.up : colors.down
        };
      });

    const validPrices = priceData.map((d) => d.value).filter(Number.isFinite);
    if (currentPrevClose > 0 && validPrices.length) {
      let maxDiff = 0;
      for (const p of validPrices) {
        const diff = Math.abs(p - currentPrevClose);
        if (diff > maxDiff) maxDiff = diff;
      }
      const minPadding = currentPrevClose * 0.005;
      const padded = Math.max(maxDiff * 1.05, minPadding);
      symmetricPriceRange = { minValue: currentPrevClose - padded, maxValue: currentPrevClose + padded };
      const maxPercent = (padded / currentPrevClose) * 100;
      symmetricPercentRange = { minValue: -maxPercent, maxValue: maxPercent };
    } else {
      symmetricPriceRange = null;
      symmetricPercentRange = null;
    }
    rebuildPercentTickLines();
    displayPriceData = priceData;
    displayAverageData = averageData;
    displayPercentData = percentData;
    displayVolumeData = volumeData;
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
        title: isFutureTimeline ? '昨结' : '昨收'
      });
    }
    if (arr.length) renderIntradayDetail(arr[arr.length - 1].time);
    pinFullSessionRange();
  }

  // Merge one point into a display array. The array may already contain a
  // (whitespace) slot for `time` — the pinned stock grid always does — in
  // which case the slot is replaced; a genuinely new time is appended.
  // Returns { data, appended }.
  function _mergeDisplayPoint(arr, time, value, color) {
    const hasValue = Number.isFinite(value);
    const entry = hasValue
      ? (color !== undefined ? { time, value, color } : { time, value })
      : { time };
    const idx = arr.findIndex((d) => Number(d.time) === time);
    if (idx >= 0) {
      const next = arr.slice();
      next[idx] = entry;
      return { data: next, appended: false };
    }
    if (!arr.length || time > Number(arr[arr.length - 1].time)) {
      return { data: [...arr, entry], appended: true };
    }
    return { data: arr, appended: false };
  }

  // NOTE: series.update() cannot be used here. The display grid contains
  // trailing whitespace bars up to the session close (15:00), and
  // lightweight-charts rejects any update whose time is older than the last
  // series item — whitespace included — with "Cannot update oldest data".
  // So a live tick is merged into the stored display arrays and each affected
  // series is re-set. The arrays are at most ~330 points, so this is cheap.
  function updatePoint(point) {
    if (!point || !Number.isFinite(Number(point.time))) return;
    const time = Number(point.time);
    const close = Number(point.close);
    if (!Number.isFinite(close)) return;

    intradayDataMap.set(_timeKey(time), point);
    let appended = false;
    const mergedPrice = _mergeDisplayPoint(displayPriceData, time, close);
    if (mergedPrice.appended) appended = true;
    displayPriceData = mergedPrice.data;
    priceSeries.setData(displayPriceData);
    if (Number.isFinite(Number(point.avgPrice)) && Number(point.avgPrice) > 0) {
      const mergedAverage = _mergeDisplayPoint(displayAverageData, time, Number(point.avgPrice));
      if (mergedAverage.appended) appended = true;
      displayAverageData = mergedAverage.data;
      averageSeries.setData(displayAverageData);
    }
    if (currentPrevClose > 0) {
      const pct = (close / currentPrevClose - 1) * 100;
      const mergedPercent = _mergeDisplayPoint(displayPercentData, time, pct);
      if (mergedPercent.appended) appended = true;
      displayPercentData = mergedPercent.data;
      percentSeries.setData(displayPercentData);
    }
    if (Number.isFinite(Number(point.volume))) {
      const isUp = Number(point.close) >= Number(point.open || point.close);
      const mergedVolume = _mergeDisplayPoint(displayVolumeData, time, Number(point.volume), isUp ? colors.up : colors.down);
      if (mergedVolume.appended) appended = true;
      displayVolumeData = mergedVolume.data;
      volumeSeries.setData(displayVolumeData);
    }
    if (appended) pinFullSessionRange();
    renderIntradayDetail(time);
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
    chart.applyOptions({
      ..._intradayChartInteractionOptions(),
      timeScale: _intradayTimeScaleOptions(c)
    });
    // buildChartOptions 会重置 grid，重关水平网格并按新主题色重建刻度线
    chart.applyOptions({ grid: { horzLines: { visible: false } } });
    rebuildPercentTickLines();
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
    pinFullSessionRange();
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
    if (detailLegend) detailLegend.root.remove();
  }

  return { setData, updatePoint, applyTheme, resize, fitContent, getVisibleRange, setVisibleRange, destroy };
}
