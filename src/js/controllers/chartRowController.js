import { createRequestScope } from '../services/requestScope.js';
import {
  calcMA,
  formatCandleColors,
  formatVolumeBars,
  applyLiveTickToKline,
  applyLiveQuoteToKline,
  applyLiveQuoteToIntraday,
  getLastKlineDate,
  PERIOD_LABELS,
  DEFAULT_PERIOD,
  isValidPeriod
} from '../kline.js';
import {
  createKlineChart,
  createIntradayChart,
  MA_COLORS
} from '../chart.js';
import { fetchKline, fetchIntraday } from '../api.js';
import { chartTimeToDate, getBeijingDate } from '../time.js';
import { isFutureCode } from '../futures/instrument.js';
import { isLiveTradeDate } from '../marketSession.js';
import { intradaySourceLabel } from '../format.js';

export const MA_PERIODS = [5, 10, 20, 60];

export function getPrevCloseForDate(items, date) {
  if (!Array.isArray(items) || !date) return null;
  let lastPriorBar = null;
  for (let i = 0; i < items.length; i++) {
    const bar = items[i];
    if (!bar) continue;
    const barDate = chartTimeToDate(bar.time);
    if (!barDate) continue;
    if (barDate < date) {
      lastPriorBar = bar;
    } else if (barDate >= date) {
      break;
    }
  }
  if (lastPriorBar) {
    const val = Number(lastPriorBar.settle || lastPriorBar.close);
    return Number.isFinite(val) && val > 0 ? val : null;
  }
  return null;
}

export function rememberRange(inst, ctl, field = '_visibleRange') {
  if (!inst || !ctl || typeof ctl.getVisibleRange !== 'function') return;
  const range = ctl.getVisibleRange();
  if (range) inst[field] = range;
}

export function restoreRangeOrFit(ctl, range) {
  if (!ctl) return;
  if (range && typeof ctl.setVisibleRange === 'function' && ctl.setVisibleRange(range)) return;
  if (typeof ctl.fitContent === 'function') ctl.fitContent();
}

export function createChartState(period = DEFAULT_PERIOD) {
  return {
    ctl: null,
    period,
    klineData: null,
    loading: true,
    error: null,
    abort: null,
    selectedTradeDate: '',
    manualTradeDate: false,
    intradayData: null,
    intradayLoading: false,
    intradayError: null,
    intradayAbort: null,
    intradayRefreshing: false,
    intradayLastFetchAt: 0,
    _visibleRange: null,
    _intradayVisibleRange: null
  };
}

export function applyKlineDataToChart(ctl, inst, data) {
  if (!ctl || !inst || !data) return;
  if (typeof ctl.setPeriod === 'function') ctl.setPeriod(inst.period);
  const candles = formatCandleColors(data.items, data.code, data.name);
  ctl.setKline(candles);
  ctl.setVolume(formatVolumeBars(data.items));
  ctl.clearMA();
  for (let i = 0; i < MA_PERIODS.length; i++) {
    const n = MA_PERIODS[i];
    const series = calcMA(data.items, n);
    if (series.length) ctl.setMA(n, series, MA_COLORS[i] || '#888');
  }
  restoreRangeOrFit(ctl, inst._visibleRange);
}

export function applyIntradayDataToChart(ctl, inst, data) {
  if (!ctl || !inst || !data || !Array.isArray(data.items)) return;
  ctl.setData(data.items);
  // The intraday time scale pins both edges to the session bounds and
  // disables panning, so every load just refits the full 9:30-15:00 session.
  if (typeof ctl.fitContent === 'function') ctl.fitContent();
}

export function applyLiveTickToKlineChart(ctl, inst, quoteOrPrice) {
  if (!ctl || !inst || !inst.klineData) return;
  const livePrice = Number(
    quoteOrPrice && typeof quoteOrPrice === 'object' ? quoteOrPrice.price : quoteOrPrice
  );
  if (!Number.isFinite(livePrice) || livePrice <= 0) return;
  const updated = quoteOrPrice && typeof quoteOrPrice === 'object'
    ? applyLiveQuoteToKline(inst.klineData.items, quoteOrPrice, inst.period)
    : applyLiveTickToKline(inst.klineData.items, livePrice, inst.period);
  if (updated === inst.klineData.items) return;
  inst.klineData = { ...inst.klineData, items: updated };
  const last = updated[updated.length - 1];
  const formatted = formatCandleColors([last], inst.klineData.code, inst.klineData.name)[0];
  if (formatted) ctl.updateKline(formatted);
  const volBar = formatVolumeBars([last])[0];
  if (volBar) ctl.updateVolume(volBar);
  for (let i = 0; i < MA_PERIODS.length; i++) {
    const n = MA_PERIODS[i];
    const maSeries = calcMA(updated, n);
    if (maSeries.length) ctl.updateMA(n, maSeries[maSeries.length - 1]);
  }
}

export function applyLiveQuoteToIntradayChart(ctl, inst, quote, now = new Date(), tradingDates = []) {
  if (!inst || !ctl || !inst.intradayData) return false;
  const code = inst.code || quote.code;
  const isFuture = isFutureCode(code);
  if (!isLiveTradeDate(inst.selectedTradeDate, code, now, tradingDates)) return false;
  const updated = applyLiveQuoteToIntraday(inst.intradayData.items, quote, now, isFuture, tradingDates);
  if (updated === inst.intradayData.items) return false;
  inst.intradayData = { ...inst.intradayData, items: updated };
  if (typeof ctl.updatePoint === 'function' && updated.length > 0) {
    ctl.updatePoint(updated[updated.length - 1]);
  } else {
    ctl.setData(updated);
  }
  return true;
}

export function formatKlineStatus(inst) {
  if (!inst) return '';
  const parts = [];
  if (inst.loading) parts.push('图表加载中...');
  if (inst.error) parts.push('错误: ' + inst.error);
  if (inst.klineData && !inst.loading && !inst.error) {
    const label = PERIOD_LABELS[inst.period] || inst.period;
    parts.push(`${label} · ${inst.klineData.items.length} 根`);
  }
  return parts.join(' · ');
}

export function formatIntradayStatus(inst) {
  if (!inst) return '';
  const parts = [];
  if (inst.intradayLoading) parts.push('分时加载中...');
  if (inst.intradayError) parts.push('分时错误: ' + inst.intradayError);
  if (inst.intradayData && Array.isArray(inst.intradayData.items) && inst.intradayData.items.length) {
    const items = inst.intradayData.items;
    const last = items[items.length - 1];
    const summary = [`${inst.selectedTradeDate || ''} · ${items.length} 点`];
    if (last && Number.isFinite(last.avgPrice) && last.avgPrice > 0) {
      summary.push(`均价 ${last.avgPrice.toFixed(2)}`);
    }
    if (last && Number.isFinite(last.percent)) {
      const sign = last.percent > 0 ? '+' : '';
      summary.push(`${sign}${last.percent.toFixed(2)}%`);
    }
    const label = intradaySourceLabel(inst.intradayData.source);
    if (label) summary.push(`(${label})`);
    parts.push(summary.join(' · '));
  } else if (!inst.intradayLoading && !inst.intradayError) {
    parts.push(inst.selectedTradeDate ? `${inst.selectedTradeDate} · 暂无分时` : '点击右侧日K查看分时');
  }
  return parts.join(' · ');
}

export class ChartRowManager {
  constructor(options = {}) {
    this.prefix = options.prefix || '';
    this.hasIntraday = options.hasIntraday !== false;
    this.klineHeight = options.klineHeight || (this.hasIntraday ? 360 : 320);
    this.intradayHeight = options.intradayHeight || 360;
    this.getTheme = options.getTheme || (() => 'warm');
    this.getChartInstances = options.getChartInstances;
    this.isExpanded = options.isExpanded || (() => false);
    this.resolveTradeDate = options.resolveTradeDate || ((code, data) => getLastKlineDate(data.items));
    this.isLatestKlineDate = options.isLatestKlineDate || ((inst, date) => !date || (inst && inst.klineData && getLastKlineDate(inst.klineData.items) === date));
    this.onStateChange = options.onStateChange || (() => {});
    this.onKlineBarClick = options.onKlineBarClick || null;
    this.getQuote = options.getQuote || null;
    this.getTradingDates = options.getTradingDates || (() => []);

    this.klineCtlMap = new Map();
    this.intradayCtlMap = new Map();
  }

  getInst(code) {
    const instances = typeof this.getChartInstances === 'function' ? this.getChartInstances() : null;
    return instances ? instances.get(code) : null;
  }

  setInst(code, inst) {
    const instances = typeof this.getChartInstances === 'function' ? this.getChartInstances() : null;
    if (instances) instances.set(code, inst);
  }

  updateKlineStatus(code) {
    const inst = this.getInst(code);
    const el = document.getElementById(`${this.prefix}chart-status-${code}`);
    if (!el || !inst) return;
    el.textContent = formatKlineStatus(inst);
    el.className = 'chart-status' + (inst.error ? ' has-error' : '');
  }

  updateIntradayStatus(code) {
    if (!this.hasIntraday) return;
    const inst = this.getInst(code);
    const el = document.getElementById(`${this.prefix}intraday-status-${code}`);
    if (!el || !inst) return;
    el.textContent = formatIntradayStatus(inst);
    el.className = 'chart-status' + (inst.intradayError ? ' has-error' : '');
  }

  mountKlineChart(code) {
    if (this.klineCtlMap.has(code)) return;
    const host = document.getElementById(`${this.prefix}chart-host-${code}`);
    if (!host) return;
    const inst = this.getInst(code);
    try {
      const ctl = createKlineChart(host, {
        theme: this.getTheme(),
        height: this.klineHeight,
        period: inst ? inst.period : DEFAULT_PERIOD
      });
      if (this.hasIntraday && typeof ctl.subscribeBarClick === 'function') {
        ctl.subscribeBarClick((time) => {
          this.handleKlineBarClick(code, time);
        });
      }
      this.klineCtlMap.set(code, ctl);
      if (inst && inst.klineData) {
        applyKlineDataToChart(ctl, inst, inst.klineData);
        this.updateKlineStatus(code);
      }
    } catch (e) {
      if (inst) inst.error = e.message || String(e);
      this.updateKlineStatus(code);
    }
  }

  mountIntradayChart(code) {
    if (!this.hasIntraday || this.intradayCtlMap.has(code)) return;
    const host = document.getElementById(`${this.prefix}intraday-chart-host-${code}`);
    if (!host) return;
    try {
      const ctl = createIntradayChart(host, {
        theme: this.getTheme(),
        height: this.intradayHeight
      });
      this.intradayCtlMap.set(code, ctl);
      const inst = this.getInst(code);
      if (inst && inst.intradayData) {
        applyIntradayDataToChart(ctl, inst, inst.intradayData);
        this.updateIntradayStatus(code);
      }
    } catch (e) {
      const inst = this.getInst(code);
      if (inst) inst.intradayError = e.message || String(e);
      this.updateIntradayStatus(code);
    }
  }

  mountCharts(code) {
    this.mountKlineChart(code);
    if (this.hasIntraday) this.mountIntradayChart(code);
  }

  destroyCharts(code, { abort = true } = {}) {
    if (abort) {
      const inst = this.getInst(code);
      if (inst) {
        inst.klineScope?.cancel();
        inst.intradayScope?.cancel();
        if (inst.abort) {
          try { inst.abort.abort(); } catch { /* ignore */ }
          inst.abort = null;
        }
        if (inst.intradayAbort) {
          try { inst.intradayAbort.abort(); } catch { /* ignore */ }
          inst.intradayAbort = null;
        }
      }
    }
    const klineCtl = this.klineCtlMap.get(code);
    if (klineCtl) {
      try { klineCtl.destroy(); } catch { /* ignore */ }
      this.klineCtlMap.delete(code);
    }
    const intradayCtl = this.intradayCtlMap.get(code);
    if (intradayCtl) {
      try { intradayCtl.destroy(); } catch { /* ignore */ }
      this.intradayCtlMap.delete(code);
    }
  }

  destroyAll() {
    for (const code of new Set([...this.klineCtlMap.keys(), ...this.intradayCtlMap.keys(), ...(this.getChartInstances?.()?.keys() || [])])) {
      this.destroyCharts(code);
    }
  }

  rememberRanges(code) {
    const inst = this.getInst(code);
    if (!inst) return;
    // Only the kline chart restores a remembered range; the intraday chart
    // is edge-pinned and always refits, so its range is not remembered.
    rememberRange(inst, this.klineCtlMap.get(code), '_visibleRange');
  }

  async loadKline(code, { force = false } = {}) {
    const inst = this.getInst(code);
    if (!inst) return;
    if (inst.abort) {
      try { inst.abort.abort(); } catch { /* ignore */ }
    }
    inst.klineScope ||= createRequestScope();
    const token = inst.klineScope.begin();
    inst.abort = token.controller;
    // Task identity: an in-flight response may still complete after this code
    // was collapsed, re-expanded (new inst), switched to another period, or
    // superseded by a newer request on the same inst. Every commit below is
    // guarded so a stale response can never write into the current chart.
    const myAbort = inst.abort;
    const startedPeriod = inst.period;
    const isCurrentTask = () =>
      this.isExpanded(code) &&
      this.getInst(code) === inst &&
      inst.klineScope.isCurrent(token) && inst.abort === myAbort &&
      inst.period === startedPeriod;
    inst.loading = true;
    inst.error = null;
    this.updateKlineStatus(code);
    try {
      const data = await fetchKline(code, {
        period: inst.period,
        sharedCache: true,
        noCache: !!force,
        forceRefresh: !!force,
        signal: inst.abort.signal
      });
      if (!isCurrentTask()) return;
      if (!data) throw new Error('未能获取 K 线数据');
      if (!data.items.length) throw new Error('K 线数据为空');
      inst.klineData = data;
      if (this.hasIntraday && !inst.selectedTradeDate) {
        inst.selectedTradeDate = this.resolveTradeDate(code, inst.klineData);
      }
      if (typeof this.getQuote === 'function') {
        const q = this.getQuote(code);
        if (q && Number(q.price) > 0) {
          const targetDate = q.tradingDay || q.date || q.quoteDate || inst.selectedTradeDate || getBeijingDate();
          const quoteForKline = (q.tradingDay || q.quoteDate || q.date) ? q : { ...q, date: targetDate };
          const merged = applyLiveQuoteToKline(inst.klineData.items, quoteForKline, inst.period);
          if (merged !== inst.klineData.items) {
            inst.klineData = { ...inst.klineData, items: merged };
          }
        }
      }
      inst.loading = false;
      const ctl = this.klineCtlMap.get(code);
      if (ctl) {
        applyKlineDataToChart(ctl, inst, inst.klineData);
      }
      this.updateKlineStatus(code);
      if (this.hasIntraday) {
        this.loadIntraday(code, inst.selectedTradeDate);
      }
    } catch (e) {
      // A stale task must not clear the new request's loading flag or write
      // an error into state it no longer owns.
      if (!isCurrentTask()) return;
      if (e && e.name !== 'AbortError') {
        inst.error = e.message || String(e);
      }
      inst.loading = false;
      this.updateKlineStatus(code);
    } finally {
      if (isCurrentTask()) {
        this.setInst(code, inst);
        this.onStateChange(code);
      }
    }
  }

  async loadIntraday(code, date) {
    if (!this.hasIntraday) return;
    const inst = this.getInst(code);
    if (!inst || !date) return;
    if (inst.intradayAbort) {
      try { inst.intradayAbort.abort(); } catch { /* ignore */ }
    }
    inst.selectedTradeDate = date;
    inst.intradayScope ||= createRequestScope();
    const token = inst.intradayScope.begin();
    inst.intradayAbort = token.controller;
    // Same task-identity guard as loadKline, but keyed on the intraday
    // request (abort controller + requested date) so switching dates or
    // reloading the kline invalidates the older intraday response.
    const myAbort = inst.intradayAbort;
    const isCurrentTask = () =>
      this.isExpanded(code) &&
      this.getInst(code) === inst &&
      inst.intradayScope.isCurrent(token) && inst.intradayAbort === myAbort &&
      inst.selectedTradeDate === date;
    inst.intradayLoading = true;
    inst.intradayError = null;
    this.updateIntradayStatus(code);
    try {
      const data = await fetchIntraday(code, {
        date,
        name: inst.klineData ? inst.klineData.name : code,
        prevClose: getPrevCloseForDate(inst.klineData && inst.klineData.items, date),
        allowLatestTickSource: this.isLatestKlineDate(inst, date),
        sharedCache: true,
        signal: inst.intradayAbort.signal
      });
      if (!isCurrentTask()) return;
      if (!data) throw new Error('未能获取分时数据');
      inst.intradayData = data;
      inst.intradayLastFetchAt = Date.now();
      inst.intradayLoading = false;
      const ctl = this.intradayCtlMap.get(code);
      if (ctl) {
        applyIntradayDataToChart(ctl, inst, data);
      }
      this.updateIntradayStatus(code);
      // The cached intraday source can lag (or truncate) the live quote by up
      // to its cache TTL, and this setData just overwrote whatever live tick
      // was applied earlier. Re-apply the latest quote on top so the chart's
      // last point matches the table/kline immediately instead of staying
      // stale until the next refresh tick. Best-effort: a merge failure must
      // not mark the successful intraday load as errored.
      if (typeof this.getQuote === 'function') {
        const q = this.getQuote(code);
        if (q && Number(q.price) > 0) {
          try {
            inst.code = code;
            applyLiveQuoteToIntradayChart(ctl, inst, q, new Date(), this.getTradingDates());
          } catch (mergeError) {
            if (console && console.warn) console.warn('intraday quote merge failed for', code, mergeError);
          }
        }
      }
    } catch (e) {
      if (!isCurrentTask()) return;
      if (e && e.name !== 'AbortError') {
        inst.intradayError = e.message || String(e);
      }
      inst.intradayLoading = false;
      this.updateIntradayStatus(code);
    } finally {
      if (isCurrentTask()) {
        this.setInst(code, inst);
        this.updateIntradayStatus(code);
      }
    }
  }

  handleKlineBarClick(code, time) {
    if (!this.hasIntraday) return;
    const inst = this.getInst(code);
    if (!inst) return;
    const date = chartTimeToDate(time);
    if (date) inst.manualTradeDate = true;
    if (!date || inst.selectedTradeDate === date) return;
    if (typeof this.onKlineBarClick === 'function') {
      this.onKlineBarClick(code, date);
    } else {
      this.loadIntraday(code, date);
    }
  }

  handlePeriodChange(p, code) {
    if (!isValidPeriod(p)) return;
    const inst = this.getInst(code);
    if (!inst || inst.period === p) return;
    inst.period = p;
    inst.klineData = null;
    inst.loading = true;
    inst.error = null;
    if (this.hasIntraday) {
      inst.selectedTradeDate = null;
      inst.manualTradeDate = false;
      inst.intradayData = null;
      inst.intradayError = null;
      inst._intradayVisibleRange = null;
      if (inst.intradayAbort) {
        try { inst.intradayAbort.abort(); } catch { /* ignore */ }
        inst.intradayAbort = null;
      }
    }
    inst._visibleRange = null;
    if (inst.abort) {
      try { inst.abort.abort(); } catch { /* ignore */ }
      inst.abort = null;
    }
    this.onStateChange(code);
    this.loadKline(code);
  }

  applyLiveTick(code, quoteOrPrice) {
    const ctl = this.klineCtlMap.get(code);
    const inst = this.getInst(code);
    if (!ctl || !inst) return;
    applyLiveTickToKlineChart(ctl, inst, quoteOrPrice);
    this.updateKlineStatus(code);
  }

  applyLiveQuoteToIntraday(code, quote, now = new Date()) {
    if (!this.hasIntraday) return false;
    const ctl = this.intradayCtlMap.get(code);
    const inst = this.getInst(code);
    if (!ctl || !inst) return false;
    inst.code = code;
    const applied = applyLiveQuoteToIntradayChart(ctl, inst, quote, now, this.getTradingDates());
    if (applied) this.updateIntradayStatus(code);
    return applied;
  }
}
