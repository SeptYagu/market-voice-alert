import {
  initTheme,
  toggleTheme,
  getCurrentTheme,
  THEME_ICONS,
  THEME_LABELS
} from './theme.js';
import {
  getWatchList,
  addToWatchList,
  removeFromWatchList,
  getSettings,
  patchSettings,
  getVoiceSettings,
  patchVoiceSettings,
  getAlertSettings,
  patchAlertSettings,
  getSubscribedCodes,
  setSubscribedCodes,
  getLimitUpSettings,
  getMomentumPinnedCodes,
  getLimitUpPinnedCodes
} from './storage.js';
import { fetchQuotes, fetchKline, onKlineUpdated } from './api.js';
import { isFutureCode } from './futures/instrument.js';
import { getFuturesSession } from './futures/session.js';
import {
  PERIOD_LABELS,
  DEFAULT_PERIOD,
  getLastKlineDate
} from './kline.js';
import {
  ChartRowManager,
  createChartState,
  rememberRange,
  applyKlineDataToChart
} from './controllers/chartRowController.js';
import {
  speak as ttsSpeak,
  cancel as ttsCancel,
  formatQuoteSpeech,
  isSpeechSupported
} from './tts.js';
import {
  evaluateAlerts,
  requestNotificationPermission,
  showNotification,
  isNotificationSupported
} from './alert.js';
import { createHashRouter, navigate } from './router.js';
import {
  createLimitUpController,
  applyLimitUpFetchResult
} from './controllers/limitUpController.js';
import { createMonitorController } from './controllers/monitorController.js';
import { createVoiceController } from './controllers/voiceController.js';
import { createMomentumController } from './controllers/momentumController.js';
import {
  parseBatchInput,
  buildExportText,
  buildExportCsv,
  downloadText
} from './services/batchExportService.js';
import {
  computeTenDayMomentum,
  isMomentumEligible,
  sortMomentumItems,
  getMomentumReasonText,
  MOMENTUM_LOOKBACK_TRADING_DAYS,
  MOMENTUM_THRESHOLD_PCT
} from './services/momentumMath.js';
import {
  fetchTradeCalendar,
  resolveStockChartDate,
  resolveLatestTradingDate
} from './tradeCalendar.js';
import { getBeijingDate, formatDateTime } from './time.js';
import {
  DEFAULT_SMART_SCHEDULE,
  getMarketSession,
  isAutoRefreshAllowedInSession,
  normalizeSmartSchedule,
  isFuturesMarketOpen,
  isLiveTradeDate
} from './marketSession.js';

import {
  LIMIT_UP_REFRESH_OPTIONS,
  formatNumber,
  formatPercent,
  makeExportFilename,
  intradaySourceLabel
} from './format.js';
import { showConfirmModal } from './modal.js';
import { renderVoiceBar as renderVoiceBarView, updateVoiceHint as updateVoiceHintView } from './views/voiceBarView.js';
import { renderAlertBar as renderAlertBarView, updateAlertHint as updateAlertHintView } from './views/alertBarView.js';
import { renderHeaderView, updateMonitorAutoRefreshButton as updateMonitorAutoRefreshButtonView } from './views/headerView.js';
import { renderToolbarView } from './views/toolbarView.js';
import {
  renderTableView,
  renderRow,
  renderInlineChartRow,
  buildWatchHeaderCheckbox as buildWatchHeaderCheckboxView,
  updateWatchHeaderCheckbox as updateWatchHeaderCheckboxView,
  updateRowQuoteCells as updateRowQuoteCellsView
} from './views/monitorTableView.js';
import {
  buildMomentumHeaderCheckbox,
  renderMomentumChartRow
} from './views/momentumView.js';

export {
  LIMIT_UP_REFRESH_OPTIONS,
  formatNumber,
  priceDirection,
  formatChange,
  formatPercent,
  formatAmount,
  formatPriceWithPercent,
  stripPrefix,
  makeExportFilename
} from './format.js';
export {
  computeTenDayMomentum,
  isMomentumEligible,
  sortMomentumItems,
  getMomentumReasonText,
  buildMomentumHeaderCheckbox,
  renderMomentumChartRow,
  MOMENTUM_LOOKBACK_TRADING_DAYS,
  MOMENTUM_THRESHOLD_PCT
};
export {
  parseBatchInput,
  buildExportText,
  buildExportCsv
};
export { applyLimitUpFetchResult };
export {
  renderHeaderView,
  renderToolbarView,
  renderTableView,
  renderRow,
  renderInlineChartRow,
  buildWatchHeaderCheckboxView as buildWatchHeaderCheckbox,
  updateWatchHeaderCheckboxView as updateWatchHeaderCheckbox,
  updateRowQuoteCellsView as updateRowQuoteCells
};

export const REFRESH_OPTIONS = [
  { value: 3000, label: '3 秒' },
  { value: 10000, label: '10 秒' },
  { value: 30000, label: '30 秒' },
  { value: 60000, label: '60 秒' }
];
export const DEFAULT_REFRESH = 10000;

export const DEFAULT_VOICE_SETTINGS = Object.freeze({
  enabled: false,
  manualDisabledDate: null,
  interval: 5000,
  volume: 80,
  fields: Object.freeze({ name: true, price: true, percent: true }),
  fieldsOrder: Object.freeze(['name', 'price', 'percent']),
  smartSchedule: DEFAULT_SMART_SCHEDULE
});

export const FIELD_LABELS = Object.freeze({
  name: '名字',
  price: '现价',
  percent: '涨幅'
});

export const DEFAULT_ALERT_SETTINGS = Object.freeze({
  enabled: false,
  threshold: 5
});

const DATA_REFRESH_SCHEDULE = Object.freeze({
  enabled: true,
  autoStartAuction: false,
  pauseLunchBreak: true,
  autoStopAfterClose: true
});

export function clampVolume(v) {
  if (v === null || v === undefined) return DEFAULT_VOICE_SETTINGS.volume;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_VOICE_SETTINGS.volume;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

// Parses a user-entered interval in seconds.
// Returns a positive integer (seconds) on success, or null for both
// "empty" and "invalid" cases - callers distinguish (empty → use default;
// invalid → reject + flash error).
export function parseIntervalSeconds(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  // Strictly positive integer in decimal notation (rejects "1e3", "1.5", "-1", "abc").
  if (!/^[1-9]\d*$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

// Parses a user-entered alert threshold (percent, 0.1 - 50, decimals allowed).
// Returns the number on success, or null for both empty and invalid input.
export function parseAlertThreshold(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  // Decimal: digits + optional .digits (rejects scientific notation, signs).
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0.1 || n > 50) return null;
  return n;
}

export function parseLimitUpIntervalSeconds(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (!/^[1-9]\d*$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return LIMIT_UP_REFRESH_OPTIONS.some((o) => o.value === n * 1000) ? n : null;
}

export function normalizeVoiceSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const intervalMs = Number(src.interval);
  const interval = Number.isInteger(intervalMs) && intervalMs >= 1000
    ? intervalMs
    : DEFAULT_VOICE_SETTINGS.interval;
  const volume =
    src.volume === undefined || src.volume === null
      ? DEFAULT_VOICE_SETTINGS.volume
      : clampVolume(src.volume);
  return {
    enabled: !!src.enabled,
    manualDisabledDate: src.manualDisabledDate || null,
    interval,
    volume,
    fields: normalizeVoiceFields(src.fields),
    fieldsOrder: normalizeVoiceFieldsOrder(src.fieldsOrder),
    smartSchedule: normalizeSmartSchedule(src.smartSchedule)
  };
}

export function normalizeVoiceFields(input) {
  const valid = input && typeof input === 'object' && !Array.isArray(input);
  if (!valid) return { ...DEFAULT_VOICE_SETTINGS.fields };
  return {
    name: input.name === undefined ? true : !!input.name,
    price: input.price === undefined ? true : !!input.price,
    percent: input.percent === undefined ? true : !!input.percent
  };
}

export function normalizeVoiceFieldsOrder(input) {
  const KNOWN = ['name', 'price', 'percent'];
  if (!Array.isArray(input)) return [...DEFAULT_VOICE_SETTINGS.fieldsOrder];
  const seen = new Set();
  const out = [];
  for (const k of input) {
    if (KNOWN.includes(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  for (const k of KNOWN) {
    if (!seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  return out;
}

export function normalizeAlertSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  let threshold;
  if (src.threshold === undefined || src.threshold === null) {
    threshold = DEFAULT_ALERT_SETTINGS.threshold;
  } else {
    const n = Number(src.threshold);
    if (!Number.isFinite(n)) threshold = DEFAULT_ALERT_SETTINGS.threshold;
    else if (n < 0.1) threshold = 0.1;
    else if (n > 50) threshold = 50;
    else threshold = n;
  }
  return {
    enabled: !!src.enabled,
    threshold
  };
}


const state = {
  watchList: [],
  quotes: new Map(),
  selected: new Set(),
  subscribed: new Set(),
  refreshInterval: DEFAULT_REFRESH,
  unsubKlineUpdated: null,
  autoRefreshEnabled: true,
  autoRefreshPausedBySchedule: false,
  dataLastSession: null,
  loading: false,
  lastUpdate: null,
  error: null,
  info: null,
  expandedCodes: new Set(),
  chartInstances: new Map(),
  voice: { ...DEFAULT_VOICE_SETTINGS },
  alert: { ...DEFAULT_ALERT_SETTINGS },
  alertStates: {},
  notifPermission: 'default',
  voicePausedBySchedule: false,
  tradingDates: [],
  limitUp: {
    items: [],
    groups: [],
    tradingDates: [],
    latestTradingDate: null,
    previousTradingDate: null,
    nextTradingDate: null,
    calendarLoading: false,
    lastUpdate: null,
    loading: false,
    error: null,
    refreshInterval: 30000,
    timer: null,
    autoRefreshEnabled: true,
    autoRefreshPausedBySchedule: false,
    abort: null,
    requestSeq: 0,
    lastNonEmptyItems: [],
    lastNonEmptyAt: null,
    consecutiveEmptyFetches: 0,
    forceRefreshOnce: false,
    sortKey: 'amount',
    groupSort: {},
    selectedCodes: new Set(),
    // Phase 8: 涨停页多 chart 架构 (与监控页对齐)
    expandedCodes: new Set(),
    chartInstances: new Map(),
    selectedDate: null,
    reasonMap: new Map(),
    pinnedCodes: new Set()
  },
  momentum: {
    items: [],
    loading: false,
    serverScanning: false,
    message: null,
    error: null,
    abort: null,
    lastUpdate: null,
    scanned: 0,
    total: 0,
    pinnedCodes: new Set(),
    selectedCodes: new Set(),
    expandedCodes: new Set(),
    chartInstances: new Map()
  }
};


function resolveInitialTradeDate(code, data) {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  const today = getBeijingDate();
  const latestTrading = resolveStockChartDate(dates);
  const q = state.quotes.get(code);
  if (isFutureCode(code)) return getFuturesSession(code, new Date(), dates).tradingDay;
  if (q && q.tradingDay && q.tradingDay <= latestTrading) return q.tradingDay;
  const lastBarDate = data && data.items ? getLastKlineDate(data.items) : '';
  return latestTrading || lastBarDate || today;
}

export const monitorChartMgr = new ChartRowManager({
  prefix: '',
  hasIntraday: true,
  klineHeight: 360,
  intradayHeight: 360,
  getTheme: getCurrentTheme,
  getTradingDates: () => state.tradingDates || [],
  getChartInstances: () => state.chartInstances,
  getQuote: (code) => state.quotes.get(code),
  isExpanded: (code) => state.expandedCodes.has(code),
  resolveTradeDate: (code, data) => resolveInitialTradeDate(code, data),
  isLatestKlineDate: (inst, date) => isLatestKlineDate(inst, date),
  onStateChange: () => renderData()
});
export const chartInstanceMap = monitorChartMgr.klineCtlMap;
export const intradayChartCtlMap = monitorChartMgr.intradayCtlMap;

export const limitUpChartMgr = new ChartRowManager({
  prefix: 'lu-',
  hasIntraday: true,
  klineHeight: 360,
  intradayHeight: 360,
  getTheme: getCurrentTheme,
  getTradingDates: () => state.tradingDates || [],
  getChartInstances: () => state.limitUp.chartInstances,
  getQuote: (code) => state.quotes.get(code),
  isExpanded: (code) => state.limitUp.expandedCodes.has(code),
  resolveTradeDate: (code, data) => {
    const dates = state.tradingDates || state.limitUp.tradingDates || [];
    const latestTradeDate = resolveLatestTradingDate(getBeijingDate(), dates);
    const isHistorical = state.limitUp.selectedDate && latestTradeDate && state.limitUp.selectedDate < latestTradeDate;
    return isHistorical ? state.limitUp.selectedDate : resolveInitialTradeDate(code, data);
  },
  isLatestKlineDate: (inst, date) => isLatestKlineDate(inst, date),
  onStateChange: () => rerenderLimitUpPage()
});
export const limitUpChartCtlMap = limitUpChartMgr.klineCtlMap;
export const limitUpIntradayChartCtlMap = limitUpChartMgr.intradayCtlMap;

export const momentumChartMgr = new ChartRowManager({
  prefix: 'momentum-',
  hasIntraday: false,
  klineHeight: 320,
  getTheme: getCurrentTheme,
  getTradingDates: () => state.tradingDates || [],
  getChartInstances: () => state.momentum.chartInstances,
  getQuote: (code) => state.quotes.get(code),
  isExpanded: (code) => state.momentum.expandedCodes.has(code),
  onStateChange: () => renderMomentumSection()
});
export const momentumChartCtlMap = momentumChartMgr.klineCtlMap;

export const limitUpCtrl = createLimitUpController({
  getState: () => state,
  limitUpChartMgr,
  onNavigate: (path) => navigate(path),
  onAddToWatchList: (code, opts = {}) => {
    const wasInList = state.watchList.includes(code);
    addToWatchList(code);
    state.watchList = getWatchList();
    if (!opts.silent) {
      flashInfo(wasInList ? `已在监控列表：${code}` : `已加入监控：${code}`);
      navigate('#/');
      refreshNow();
      renderData();
    }
  },
  flashInfo: (msg) => flashInfo(msg),
  refreshNow: () => refreshNow(),
  renderData: () => renderData(),
  isDataAutoRefreshAllowedNow: () => isDataAutoRefreshAllowedNow(),
  preloadKlineForCodes: (codes) => preloadKlineForCodes(codes)
});

export const momentumCtrl = createMomentumController({
  getState: () => state,
  momentumChartMgr,
  onToggleSubscribe: (code, checked) => handleToggleSubscribe(code, checked)
});

let appRouter = null;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'on' && typeof v === 'object') {
      for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    } else if (k.startsWith('data-') || k === 'type' || k === 'value' || k === 'placeholder' || k === 'title' || k === 'id') {
      node.setAttribute(k, v);
    } else if (k === 'checked' && v) {
      node.checked = true;
    } else if (k === 'disabled' && v) {
      node.disabled = true;
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function renderMonitorPage(root) {
  if (!root) return;
  root.innerHTML = '';
  root.appendChild(renderHeaderView({
    currentTheme: getCurrentTheme(),
    refreshInterval: state.refreshInterval,
    refreshOptions: REFRESH_OPTIONS,
    onRefreshChange: handleRefreshChange,
    onToggleTheme: handleToggleTheme
  }));
  root.appendChild(renderToolbarView({
    autoRefreshEnabled: state.autoRefreshEnabled,
    autoRefreshPaused: state.autoRefreshPausedBySchedule,
    handlers: {
      onAdd: handleAdd,
      onRefreshNow: handleRefreshNow,
      onAutoRefreshToggle: handleMonitorAutoRefreshToggle,
      onSelectAll: handleSelectAll,
      onSelectNone: handleSelectNone,
      onDeleteSelected: handleDeleteSelected,
      onExport: handleExport
    }
  }));
  root.appendChild(el('section', { class: 'ctl-bar', id: 'voice-bar' }));
  root.appendChild(el('section', { class: 'ctl-bar', id: 'alert-bar' }));
  root.appendChild(el('section', { class: 'table-wrap', id: 'table-wrap' }));
  root.appendChild(el('section', { class: 'momentum-section', id: 'momentum-section' }));
  root.appendChild(el('footer', { class: 'status-bar', id: 'status-bar' }));
  renderVoiceBar();
  renderAlertBar();
  renderTable();
  renderMomentumSection();
  renderStatus();
}

function updateMonitorAutoRefreshButton() {
  updateMonitorAutoRefreshButtonView(state.autoRefreshEnabled, state.autoRefreshPausedBySchedule);
}

function renderVoiceBar() {
  renderVoiceBarView({
    container: document.getElementById('voice-bar'),
    voiceState: state.voice,
    subscribedSize: state.subscribed.size,
    isSpeechSupported: isSpeechSupported(),
    fieldLabels: FIELD_LABELS,
    defaultSmartSchedule: DEFAULT_SMART_SCHEDULE,
    handlers: {
      onToggleEnabled: handleVoiceEnabledChange,
      onIntervalBlur: handleVoiceIntervalBlur,
      onVolumeChange: handleVoiceVolumeChange,
      onTestSpeech: handleTestSpeech,
      onFieldChange: handleVoiceFieldChange,
      onMoveField: handleMoveField,
      onScheduleChange: handleVoiceScheduleChange
    }
  });
}

function updateVoiceHint() {
  updateVoiceHintView(state.subscribed.size);
}

function renderAlertBar() {
  renderAlertBarView({
    container: document.getElementById('alert-bar'),
    alertState: state.alert,
    subscribedSize: state.subscribed.size,
    isNotificationSupported: isNotificationSupported(),
    notifPermission: state.notifPermission,
    handlers: {
      onToggleEnabled: handleAlertEnabledChange,
      onThresholdBlur: handleAlertThresholdBlur,
      onTestAlert: handleTestAlert,
      onRequestNotification: handleRequestNotification
    }
  });
}

function updateAlertHint() {
  updateAlertHintView(state.subscribed.size);
}

export function renderMomentumSection() {
  momentumCtrl.render();
}

export function closeAllMomentumCharts() {
  momentumCtrl.closeAllCharts();
}

export function stopMomentumScan() {
  momentumCtrl.stopScan();
}


function updateWatchHeaderCheckbox() {
  updateWatchHeaderCheckboxView(state.watchList, state.selected);
}

function renderTable() {
  const wrap = document.getElementById('table-wrap');
  if (!wrap) return;
  renderTableView(wrap, {
    watchList: state.watchList,
    quotesMap: state.quotes,
    selectedSet: state.selected,
    subscribedSet: state.subscribed,
    expandedCodes: state.expandedCodes,
    chartInstances: state.chartInstances,
    beforeRerenderClean: () => {
      for (const code of [...state.expandedCodes]) {
        const inst = state.chartInstances.get(code);
        const ctl = chartInstanceMap.get(code);
        if (ctl) {
          rememberRange(inst, ctl, '_visibleRange');
          try { ctl.destroy(); } catch { /* ignore */ }
          chartInstanceMap.delete(code);
        }
        const intradayCtl = intradayChartCtlMap.get(code);
        if (intradayCtl) {
          rememberRange(inst, intradayCtl, '_intradayVisibleRange');
          try { intradayCtl.destroy(); } catch { /* ignore */ }
          intradayChartCtlMap.delete(code);
        }
      }
    },
    callbacks: {
      onSelectAll: handleSelectAll,
      onSelectNone: handleSelectNone,
      onToggleSelect: handleToggleSelect,
      onToggleSubscribe: handleToggleSubscribe,
      onRemove: handleRemove,
      onRowClick: handleRowClick,
      onPeriodChange: handlePeriodChange,
      onForceReload: handleForceReloadChart,
      onCloseChart: closeChart,
      onUpdateChartStatus: updateChartStatusForCode,
      onUpdateIntradayStatus: updateIntradayStatusForCode,
      onAfterMountCharts: () => {
        for (const code of state.expandedCodes) {
          mountChartForCode(code);
        }
      }
    }
  });
}

function renderStatus() {
  const bar = document.getElementById('status-bar');
  if (!bar) return;
  const parts = [];
  parts.push(`共 ${state.watchList.length} 项`);
  if (state.selected.size) parts.push(`已选 ${state.selected.size}`);
  if (state.subscribed.size) parts.push(`订阅 ${state.subscribed.size}`);
  if (state.voice.enabled) parts.push(state.voicePausedBySchedule ? '🔇 智能暂停' : '🔊');
  if (state.autoRefreshEnabled && state.autoRefreshPausedBySchedule) parts.push('行情自动刷新暂停');
  if (state.alert.enabled) parts.push(`🔔 ±${state.alert.threshold}%`);
  if (state.loading) parts.push('加载中...');
  if (state.lastUpdate) {
    parts.push(`更新于 ${formatDateTime(state.lastUpdate)}`);
  }
  // Codes whose last refresh failed keep their old price on screen; say so instead of
  // letting the timestamp imply everything is current.
  if (Array.isArray(state.failedCodes) && state.failedCodes.length) {
    parts.push(`⚠️ ${state.failedCodes.length} 项行情未更新`);
  }
  if (state.info) parts.push(state.info);
  if (state.error) parts.push(`错误: ${state.error}`);
  bar.textContent = parts.join(' · ');
}

// Per-code chart status text update. Pass the statusEl to update a fresh node
// (used during inline-row construction), or look it up by id.
function updateChartStatusForCode(code, statusEl) {
  const inst = state.chartInstances.get(code);
  if (!inst) return;
  const el2 = statusEl || document.getElementById(`chart-status-${code}`);
  if (!el2) return;
  const parts = [];
  if (inst.loading) parts.push('图表加载中...');
  if (inst.error) parts.push('错误: ' + inst.error);
  if (inst.klineData && !inst.loading && !inst.error) {
    parts.push(`${PERIOD_LABELS[inst.period]} · ${inst.klineData.items.length} 根`);
  }
  el2.textContent = parts.join(' · ');
  el2.className = 'chart-status' + (inst.error ? ' has-error' : '');
}

function isLatestKlineDate(inst, date) {
  if (!date) return false;
  if (isLimitUpDateToday(date)) return true;
  if (!inst || !inst.klineData || !Array.isArray(inst.klineData.items)) return false;
  return getLastKlineDate(inst.klineData.items) === date;
}

function intradayStatusParts(inst) {
  const parts = [];
  if (inst.intradayLoading) parts.push('分时加载中...');
  if (inst.intradayError) parts.push('错误: ' + inst.intradayError);
  if (
    inst.intradayData &&
    Array.isArray(inst.intradayData.items) &&
    inst.intradayData.items.length &&
    !inst.intradayLoading &&
    !inst.intradayError
  ) {
    const items = inst.intradayData.items || [];
    const last = items[items.length - 1] || {};
    const source = intradaySourceLabel(inst.intradayData.source);
    const summary = [`${inst.selectedTradeDate || ''} · ${items.length} 点`];
    if (Number.isFinite(Number(last.close))) summary.push(formatNumber(last.close));
    if (Number.isFinite(Number(last.percent))) summary.push(formatPercent(last.percent));
    if (!items.some((item) => Number(item && item.avgPrice) > 0)) summary.push('均价不可用');
    if (source) summary.push(source);
    parts.push(summary.join(' · '));
  } else if (!inst.intradayLoading && !inst.intradayError) {
    parts.push(inst.selectedTradeDate ? `${inst.selectedTradeDate} · 暂无分时` : '点击右侧日K查看分时');
  }
  return parts;
}

function updateIntradayStatusForCode(code, statusEl) {
  const inst = state.chartInstances.get(code);
  if (!inst) return;
  const el2 = statusEl || document.getElementById(`intraday-status-${code}`);
  if (!el2) return;
  el2.textContent = intradayStatusParts(inst).join(' · ');
  el2.className = 'chart-status' + (inst.intradayError ? ' has-error' : '');
}

function updateThemeButton() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const theme = getCurrentTheme();
  btn.textContent = THEME_ICONS[theme] + ' ' + THEME_LABELS[theme];
  btn.title = `当前: ${THEME_LABELS[theme]} (点击切换)`;
}

function renderData() {
  renderTable();
  renderMomentumSection();
  updateVoiceHint();
  updateAlertHint();
  renderStatus();
}

function handleToggleTheme() {
  toggleTheme();
  updateThemeButton();
  for (const ctl of chartInstanceMap.values()) {
    if (!ctl) continue;
    try {
      ctl.applyTheme(getCurrentTheme());
    } catch {
      /* ignore */
    }
  }
  for (const ctl of intradayChartCtlMap.values()) {
    if (!ctl) continue;
    try { ctl.applyTheme(getCurrentTheme()); } catch { /* ignore */ }
  }
  for (const ctl of limitUpChartCtlMap.values()) {
    if (!ctl) continue;
    try { ctl.applyTheme(getCurrentTheme()); } catch { /* ignore */ }
  }
  for (const ctl of limitUpIntradayChartCtlMap.values()) {
    if (!ctl) continue;
    try { ctl.applyTheme(getCurrentTheme()); } catch { /* ignore */ }
  }
  for (const ctl of momentumChartCtlMap.values()) {
    if (!ctl) continue;
    try { ctl.applyTheme(getCurrentTheme()); } catch { /* ignore */ }
  }
}

function handleRefreshChange(e) {
  const v = Number(e.target.value);
  if (!REFRESH_OPTIONS.some((o) => o.value === v)) return;
  state.refreshInterval = v;
  patchSettings({ refreshInterval: v });
  restartTimer();
}

function handleAdd() {
  const input = document.getElementById('code-input');
  if (!input) return;
  const codes = parseBatchInput(input.value);
  if (!codes.length) {
    flashError('未识别到有效代码');
    return;
  }
  const newCodes = monitorCtrl.addCodes(codes);
  input.value = '';
  input.focus();
  renderData();
  refreshNow();
  // Phase 8: 添加即预热 K 线缓存
  if (newCodes.length) {
    preloadKlineForCodes(newCodes);
  }
}

// Phase 8: 后台预拉 N 只股票的 1d K 线 (限流: 每批 3 + 间隔 200ms)
function preloadKlineForCodes(codes) { monitorCtrl.preload(codes); }

async function handleRemove(code) {
  const quote = state.quotes.get(code);
  const name = quote && quote.name ? `${quote.name} (${code})` : code;
  const ok = await showConfirmModal(`确定从监控列表中删除 ${name} 吗？`, {
    title: '删除标的',
    confirmText: '确定删除',
    cancelText: '取消',
    danger: true
  });
  if (!ok) return;
  monitorCtrl.removeCodes([code]);
  persistSubscribed();
  renderData();
}

function handleToggleSelect(code, checked) {
  if (checked) state.selected.add(code);
  else state.selected.delete(code);
  updateWatchHeaderCheckbox();
  renderStatus();
}

function handleSelectAll() {
  state.selected = new Set(state.watchList);
  renderData();
}

function handleSelectNone() {
  state.selected.clear();
  renderData();
}

async function handleDeleteSelected() {
  if (!state.selected.size) return;
  const count = state.selected.size;
  const ok = await showConfirmModal(`确定删除选中的 ${count} 个标的？`, {
    title: '删除确认',
    confirmText: '确定删除',
    cancelText: '取消',
    danger: true
  });
  if (!ok) return;
  const codes = [...state.selected];
  monitorCtrl.removeCodes(codes);
  persistSubscribed();
  renderData();
}

function handleExport(scope) {
  const codes = scope === 'selected' ? [...state.selected] : state.watchList;
  if (!codes.length) {
    flashError(scope === 'selected' ? '请先选中标的' : '列表为空');
    return;
  }
  const csv = buildExportCsv(codes, state.quotes);
  downloadText(csv, makeExportFilename('stocks', new Date(), 'csv'));
}

function handleRefreshNow() {
  refreshNow();
}

function isLimitUpDateToday(date = state.limitUp.selectedDate) {
  return limitUpCtrl.isDateToday(date);
}


function rerenderLimitUpPage() {
  limitUpCtrl.render();
}

function limitUpFetch() {
  return limitUpCtrl.fetch();
}

function applyLiveTicksToLimitUp() {
  limitUpCtrl.applyLiveTicks();
}

function startLimitUpTimer(opts) {
  limitUpCtrl.startTimer(opts);
}

function stopLimitUpTimer(opts) {
  limitUpCtrl.stopTimer(opts);
}

function closeAllLimitUpCharts() {
  limitUpCtrl.closeAllCharts();
}

function applyLimitUpLiveTickToChart(code, quoteOrPrice) {
  limitUpCtrl.applyLiveTickToChart(code, quoteOrPrice);
}

function handleToggleSubscribe(code, checked) {
  if (checked) {
    state.subscribed.add(code);
    if (!state.quotes.has(code)) {
      const item = (state.momentum.items || []).find((it) => it && it.code === code);
      if (item) state.quotes.set(code, { ...item, type: 'stock' });
    }
  } else {
    state.subscribed.delete(code);
    if (state.alertStates && state.alertStates[code]) delete state.alertStates[code];
  }
  persistSubscribed();
  if (checked) refreshNow();
  renderStatus();
  updateVoiceHint();
  updateAlertHint();
}

function handleTestSpeech() {
  if (!isSpeechSupported()) {
    flashError('当前浏览器不支持语音合成');
    return;
  }
  const volume = clampVolume(state.voice.volume) / 100;
  ttsSpeak('语音测试', { volume });
}

function handleVoiceEnabledChange(checked) {
  // When the user enables broadcasting, snapshot the interval input.
  // Empty input → fall back to DEFAULT (5s) so the toggle never silently fails.
  // Invalid input → flash error and refuse to enable.
  if (checked) {
    const input = document.getElementById('voice-interval');
    if (input) {
      const raw = String(input.value).trim();
      if (raw === '') {
        const defaultMs = DEFAULT_VOICE_SETTINGS.interval;
        state.voice = { ...state.voice, interval: defaultMs };
        patchVoiceSettings({ interval: defaultMs });
        input.value = String(defaultMs / 1000);
      } else {
        const sec = parseIntervalSeconds(raw);
        if (sec === null) {
          flashError('间隔必须是正整数（秒），最少 1 秒');
          input.value = String(state.voice.interval / 1000);
          // Do NOT enable - user must fix the value first.
          renderVoiceBar();
          return;
        }
        const ms = sec * 1000;
        if (ms !== state.voice.interval) {
          state.voice = { ...state.voice, interval: ms };
          patchVoiceSettings({ interval: ms });
        }
      }
    }
  }

  voiceCtrl.setEnabled(checked);
  renderVoiceBar();
  renderStatus();
}

function handleVoiceIntervalBlur(rawSeconds) {
  const raw = String(rawSeconds ?? '').trim();
  // Empty: leave UI empty, keep current state. Toggle button will use default
  // if the user enables while empty.
  if (raw === '') return;
  const sec = parseIntervalSeconds(raw);
  if (sec === null) {
    flashError('间隔必须是正整数（秒），最少 1 秒');
    const input = document.getElementById('voice-interval');
    if (input) input.value = String(state.voice.interval / 1000);
    return;
  }
  const intervalMs = sec * 1000;
  if (intervalMs === state.voice.interval) return;
  state.voice = { ...state.voice, interval: intervalMs };
  patchVoiceSettings({ interval: intervalMs });
  if (state.voice.enabled) restartVoiceTimer();
}

function handleVoiceVolumeChange(value) {
  const v = clampVolume(value);
  state.voice = { ...state.voice, volume: v };
  patchVoiceSettings({ volume: v });
  // Update only the label (avoid re-rendering during slider drag).
  const label = document.getElementById('voice-volume-label');
  if (label) label.textContent = `${v}%`;
}

function handleVoiceFieldChange(key, checked) {
  const nextFields = { ...state.voice.fields, [key]: !!checked };
  // Always keep at least one field on - else nothing would be spoken.
  if (!nextFields.name && !nextFields.price && !nextFields.percent) {
    flashError('至少需要保留一个播报字段');
    renderVoiceBar();
    return;
  }
  state.voice = { ...state.voice, fields: nextFields };
  patchVoiceSettings({ fields: nextFields });
  voiceCtrl.resetFields();
  renderVoiceBar();
}

function handleMoveField(key, direction) {
  const order = [...state.voice.fieldsOrder];
  const i = order.indexOf(key);
  if (i < 0) return;
  const swap = direction === 'up' ? i - 1 : i + 1;
  if (swap < 0 || swap >= order.length) return;
  const tmp = order[i];
  order[i] = order[swap];
  order[swap] = tmp;
  state.voice = { ...state.voice, fieldsOrder: order };
  patchVoiceSettings({ fieldsOrder: order });
  renderVoiceBar();
}

function handleVoiceScheduleChange(key, checked) {
  const next = normalizeSmartSchedule({
    ...(state.voice.smartSchedule || DEFAULT_SMART_SCHEDULE),
    [key]: !!checked
  });
  state.voice = { ...state.voice, smartSchedule: next };
  patchVoiceSettings({ smartSchedule: next });
  if (state.voice.enabled) restartVoiceTimer();
  renderVoiceBar();
  renderStatus();
}

function handleAlertEnabledChange(checked) {
  // When enabling, snapshot the threshold input. Empty → DEFAULT. Invalid → reject.
  if (checked) {
    const input = document.getElementById('alert-threshold');
    if (input) {
      const raw = String(input.value).trim();
      if (raw === '') {
        const def = DEFAULT_ALERT_SETTINGS.threshold;
        state.alert = { ...state.alert, threshold: def };
        patchAlertSettings({ threshold: def });
        input.value = String(def);
      } else {
        const v = parseAlertThreshold(raw);
        if (v === null) {
          flashError('阈值必须是 0.1 - 50 之间的数字');
          input.value = String(state.alert.threshold);
          renderAlertBar();
          return;
        }
        if (v !== state.alert.threshold) {
          state.alert = { ...state.alert, threshold: v };
          patchAlertSettings({ threshold: v });
          state.alertStates = {};
        }
      }
    }
  }

  state.alert = { ...state.alert, enabled: !!checked };
  patchAlertSettings({ enabled: state.alert.enabled });
  if (!state.alert.enabled) state.alertStates = {};
  // When just enabled, immediately evaluate against current quotes so any
  // already-over-threshold subscribed code fires right away.
  if (state.alert.enabled) processAlerts();
  renderAlertBar();
  renderStatus();
}

function handleAlertThresholdBlur(rawValue) {
  const raw = String(rawValue ?? '').trim();
  if (raw === '') return;
  const v = parseAlertThreshold(raw);
  if (v === null) {
    flashError('阈值必须是 0.1 - 50 之间的数字');
    const input = document.getElementById('alert-threshold');
    if (input) input.value = String(state.alert.threshold);
    return;
  }
  if (v === state.alert.threshold) return;
  state.alert = { ...state.alert, threshold: v };
  patchAlertSettings({ threshold: v });
  // Reset trigger memory so the new threshold takes effect cleanly on next tick.
  state.alertStates = {};
}

function handleTestAlert() {
  if (!state.subscribed.size) {
    flashError('请先在表格行尾 🔊 列勾选至少一个订阅标的');
    return;
  }
  // Pick the first subscribed code that has a loaded quote.
  let target = null;
  let targetCode = null;
  for (const code of state.subscribed) {
    const q = state.quotes.get(code);
    if (q && Number.isFinite(Number(q.changePercent))) { target = q; targetCode = code; break; }
  }
  if (!target) {
    flashError('订阅的标的暂无报价，请稍后再试');
    return;
  }
  const direction = Number(target.changePercent) >= 0 ? 'up' : 'down';
  const message = formatQuoteSpeech(target, state.voice.fields) ||
    `${target.name || target.code} ${direction === 'up' ? '涨' : '跌'} ${Math.abs(Number(target.changePercent)).toFixed(2)}`;
  if (isSpeechSupported()) {
    const volume = clampVolume(state.voice.volume) / 100;
    if (targetCode) voiceCtrl.speakManual(targetCode);
    else ttsSpeak(message, { volume });
  }
  if (isNotificationSupported() && state.notifPermission === 'granted') {
    showNotification('价格提醒（测试）', message);
  } else if (!isNotificationSupported() || state.notifPermission !== 'granted') {
    flashInfo('已模拟语音提醒；如需桌面通知请先在下方授权');
  }
}

async function handleRequestNotification() {
  const result = await requestNotificationPermission();
  state.notifPermission = result;
  renderAlertBar();
}

function persistSubscribed() {
  setSubscribedCodes([...state.subscribed]);
  voiceCtrl.prune();
}

async function warmTradeCalendar() {
  try {
    const dates = await fetchTradeCalendar();
    state.tradingDates = dates;
    state.limitUp.tradingDates = dates;
    limitUpCtrl.refreshDateMeta();
    return dates;
  } catch {
    return state.tradingDates || state.limitUp.tradingDates || [];
  }
}

function getDataRefreshSession() {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  return getMarketSession(new Date(), dates);
}

function isDataAutoRefreshAllowedNow() {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  const expandedAnywhere = [
    ...(state.expandedCodes || []),
    ...(state.limitUp?.expandedCodes || []),
    ...(state.momentum?.expandedCodes || [])
  ];
  const futureCodes = [
    ...(state.watchList || []).filter(isFutureCode),
    ...expandedAnywhere.filter(isFutureCode)
  ];
  if (futureCodes.length && isFuturesMarketOpen(new Date(), dates, futureCodes)) {
    return true;
  }
  const session = getDataRefreshSession();
  state.dataLastSession = session;
  return isAutoRefreshAllowedInSession(session, DATA_REFRESH_SCHEDULE);
}

function processAlerts() {
  if (!state.alert.enabled) return;
  if (!state.subscribed.size) return;
  const codes = [...state.subscribed];
  const result = evaluateAlerts(state.quotes, codes, state.alert.threshold, state.alertStates);
  state.alertStates = result.states;
  if (!result.triggered.length) return;
  const volume = clampVolume(state.voice.volume) / 100;
  for (const item of result.triggered) {
    if (isSpeechSupported()) ttsSpeak(item.message, { volume, priority: 'high', code: item.code, ttlMs: 30000 });
    if (isNotificationSupported() && state.notifPermission === 'granted') {
      showNotification('价格提醒', item.message);
    }
  }
}

const voiceCtrl = createVoiceController({
  getSettings: () => state.voice,
  saveSettings: patch => { state.voice = { ...state.voice, ...patch }; patchVoiceSettings(patch); },
  getCodes: () => state.subscribed,
  getQuotes: () => state.quotes,
  getTradingDates: () => state.tradingDates || [],
  speech: { supported: isSpeechSupported, speak: ttsSpeak, cancel: ttsCancel },
  onChange: ({ paused, settingsChanged }) => {
    state.voicePausedBySchedule = paused;
    if (settingsChanged) renderVoiceBar();
    renderStatus();
  }
});
function startVoiceTimer() { voiceCtrl.startTimer(); }
function restartVoiceTimer() { voiceCtrl.startTimer(); voiceCtrl.applySchedule(); }
function startVoiceScheduleChecker() { voiceCtrl.start(warmTradeCalendar); }

function handleRowClick(code, e) {
  const target = e && e.target;
  if (target && target.tagName === 'INPUT') return;
  if (target && target.tagName === 'BUTTON') return;
  if (target && target.closest && (target.closest('.col-check') || target.closest('.col-sub') || target.closest('.col-op'))) {
    return;
  }
  if (target && target.closest && target.closest('.chart-row')) return;
  if (state.expandedCodes.has(code)) {
    closeChart(code);
  } else {
    openChart(code);
  }
}

// ===== Multi-chart (per-code) state and functions =====
// Each expanded code owns its own chart instance, period, kline data, and
// abort controller. Charts are rendered as inline <tr> directly below the
// corresponding watch-list row, so multiple can be open at once.

export function openChart(code) {
  if (!code) return;
  if (state.expandedCodes.has(code)) return;
  state.expandedCodes.add(code);
  state.chartInstances.set(code, createChartState(DEFAULT_PERIOD));
  loadKlineForCode(code);
  renderData();
}

export function closeChart(code) {
  if (!code || !state.expandedCodes.has(code)) return;
  state.expandedCodes.delete(code);
  const inst = state.chartInstances.get(code);
  if (inst) {
    if (inst.abort) try { inst.abort.abort(); } catch { /* ignore */ }
    if (inst.intradayAbort) try { inst.intradayAbort.abort(); } catch { /* ignore */ }
    state.chartInstances.delete(code);
  }
  monitorChartMgr.destroyCharts(code);
  renderData();
}

export function closeAllCharts() {
  for (const code of [...state.expandedCodes]) closeChart(code);
}

// Phase 8: 强制从网络重新拉取 (跳过 klineCache + 30s in-memory)
export function handleForceReloadChart(code) {
  monitorChartMgr.loadKline(code, { force: true });
}

export function handlePeriodChange(p, code) {
  monitorChartMgr.handlePeriodChange(p, code);
}

export async function loadKlineForCode(code) {
  return monitorChartMgr.loadKline(code);
}

// Live-tick update: only mutates the LAST bar via series.update(bar), which
// preserves the user's zoom/pan on the time scale. No setData, no fitContent.
export function applyLiveTickToChartForCode(code, quoteOrPrice) {
  monitorChartMgr.applyLiveTick(code, quoteOrPrice);
}

export function applyLiveQuoteToIntradayForCode(code, quote, isLimitUp = false, now = new Date()) {
  if (isLimitUp) return limitUpChartMgr.applyLiveQuoteToIntraday(code, quote, now);
  return monitorChartMgr.applyLiveQuoteToIntraday(code, quote, now);
}

async function refreshLiveIntradayForCode(code, isLimitUp = false) {
  const mgr = isLimitUp ? limitUpChartMgr : monitorChartMgr;
  const inst = mgr.getInst(code);
  // A chart opened before auction follows the new session unless the user
  // explicitly selected a historical bar. Limit-up dates belong to its page.
  const targetDate = inst && !isLimitUp && !isFutureCode(code) && !inst.manualTradeDate
    ? resolveStockChartDate(state.tradingDates) : inst?.selectedTradeDate;
  if (
    !inst ||
    inst.intradayRefreshing ||
    !isLiveTradeDate(targetDate, code, new Date(), state.tradingDates) ||
    Date.now() - inst.intradayLastFetchAt < 10000
  ) return;
  inst.intradayRefreshing = true;
  try {
    await mgr.loadIntraday(code, targetDate);
  } finally {
    inst.intradayRefreshing = false;
  }
}

export function updateChartLastTickMulti() {
  // 监控页
  if (state.expandedCodes.size) {
    for (const code of state.expandedCodes) {
      const q = state.quotes.get(code);
      if (!q) continue;
      const livePrice = Number(q.price);
      if (!Number.isFinite(livePrice) || livePrice <= 0) continue;
      try {
        applyLiveTickToChartForCode(code, q);
        applyLiveQuoteToIntradayForCode(code, q);
        void refreshLiveIntradayForCode(code);
      } catch (e) {
        if (console && console.warn) console.warn('live tick failed (monitor) for', code, e);
      }
    }
  }
  // 涨停页 (Phase 8: 多 chart)
  if (state.limitUp.expandedCodes.size) {
    for (const code of state.limitUp.expandedCodes) {
      const q = state.quotes.get(code);
      if (!q) continue;
      const livePrice = Number(q.price);
      if (!Number.isFinite(livePrice) || livePrice <= 0) continue;
      try {
        applyLimitUpLiveTickToChart(code, q);
        applyLiveQuoteToIntradayForCode(code, q, true);
        void refreshLiveIntradayForCode(code, true);
      } catch (e) {
        if (console && console.warn) console.warn('live tick failed (limitUp) for', code, e);
      }
    }
  }
}

// Mount a chart instance for a code if its DOM host exists and no instance
// has been mounted yet. Called from renderTable() after the table is appended.
export function mountChartForCode(code) {
  monitorChartMgr.mountCharts(code);
}

// Test helper: inject a fake chart ctl into the per-code map. Pass null to
// clear (used by afterEach hooks to avoid leaking fake ctls across tests).
export function _setChartInstance(code, ctl) {
  if (!code) return;
  if (ctl === null || ctl === undefined) chartInstanceMap.delete(code);
  else chartInstanceMap.set(code, ctl);
}

export function _setIntradayChartInstance(code, ctl) {
  if (!code) return;
  if (ctl === null || ctl === undefined) intradayChartCtlMap.delete(code);
  else intradayChartCtlMap.set(code, ctl);
}

// Test helper: get the live chart ctl for a code. Returns undefined if not
// mounted. Used to assert zoom-preservation: if ctl is the same object before
// and after a refresh, no destroy+recreate happened.
export function _getChartInstance(code) {
  return chartInstanceMap.get(code);
}

// Test helper: trigger an immediate refresh. Bypasses the 10s timer.
export function _forceRefresh() {
  return refreshNow();
}

function showToast(msg, type = 'error') {
  if (typeof document === 'undefined' || !document.body) return;
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.className = `app-toast app-toast-${type}`;
  toast.textContent = msg;
  toast.style.display = 'block';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function flashError(msg, targetInputId = null) {
  state.error = msg;
  renderStatus();
  showToast(msg, 'error');
  if (typeof document !== 'undefined') {
    const targetId = targetInputId || (msg && msg.includes('代码') ? 'code-input' : null);
    if (targetId) {
      const input = document.getElementById(targetId);
      if (input) {
        input.classList.add('input-shake');
        setTimeout(() => input.classList.remove('input-shake'), 600);
      }
    }
  }
  setTimeout(() => {
    if (state.error === msg) {
      state.error = null;
      renderStatus();
    }
  }, 3000);
}

function flashInfo(msg) {
  state.info = msg;
  renderStatus();
  showToast(msg, 'info');
  setTimeout(() => {
    if (state.info === msg) {
      state.info = null;
      renderStatus();
    }
  }, 3000);
}

const monitorCtrl = createMonitorController({
  getState: () => state,
  fetchQuotes, fetchKline,
  storage: { get: getWatchList, add: addToWatchList, remove: removeFromWatchList },
  onRemove: code => {
    monitorChartMgr.destroyCharts(code);
    state.chartInstances.delete(code);
    state.expandedCodes.delete(code);
  },
  onQuotes: () => {
    mergeQuotesIntoMomentumItems();
    try { processAlerts(); } catch (error) { console.warn('processAlerts failed:', error); }
    try { updateChartLastTickMulti(); } catch (error) { console.warn('updateChartLastTickMulti failed:', error); }
  },
  onRefresh: () => {
    for (const code of state.watchList) if (state.quotes.has(code)) updateRowQuoteCells(code);
    for (const item of state.momentum.items || []) if (state.quotes.has(item.code)) updateMomentumQuoteCells(item.code);
    applyLiveTicksToLimitUp();
  },
  onStatus: renderStatus
});
function refreshNow() { return monitorCtrl.refresh(); }

// Patch the data cells of an existing
// <tr data-code="..."> in place. The row's <td> order is fixed by renderRow():
// [check, sub, code, name, price, percent, openPct, volumeRatio, amount, op].
function updateRowQuoteCells(code) {
  updateRowQuoteCellsView(code, state.quotes.get(code));
}

function mergeQuotesIntoMomentumItems() {
  return momentumCtrl.mergeQuotesIntoItems();
}

function updateMomentumQuoteCells(code) {
  momentumCtrl.updateQuoteCells(code);
}

function restartTimer() { monitorCtrl.applySchedule(isDataAutoRefreshAllowedNow()); }
function stopMonitorTimer() { monitorCtrl.stopTimer(); }

function handleMonitorAutoRefreshToggle(enabled) {
  state.autoRefreshEnabled = !!enabled;
  if (enabled) {
    restartTimer();
    if (!state.autoRefreshPausedBySchedule) refreshNow();
  } else {
    stopMonitorTimer();
    state.autoRefreshPausedBySchedule = false;
  }
  renderData();
}

function applyDataRefreshSchedule() {
  const allowed = isDataAutoRefreshAllowedNow();
  const prevMonitorPaused = state.autoRefreshPausedBySchedule;
  const prevLimitUpPaused = state.limitUp.autoRefreshPausedBySchedule;

  const hasLimitUpRoot = Boolean(limitUpCtrl.getRootEl());

  monitorCtrl.applySchedule(allowed, !hasLimitUpRoot);

  if (state.limitUp.autoRefreshEnabled && hasLimitUpRoot) {
    if (!allowed) {
      stopLimitUpTimer({ abort: false });
      state.limitUp.autoRefreshPausedBySchedule = true;
    } else {
      const wasPaused = state.limitUp.autoRefreshPausedBySchedule;
      state.limitUp.autoRefreshPausedBySchedule = false;
      if (!state.limitUp.timer) {
        startLimitUpTimer({ immediate: wasPaused });
      }
    }
  } else {
    stopLimitUpTimer({ abort: false });
    if (hasLimitUpRoot) state.limitUp.autoRefreshPausedBySchedule = false;
  }

  if (prevMonitorPaused !== state.autoRefreshPausedBySchedule) {
    updateMonitorAutoRefreshButton();
    renderStatus();
  }
  if (prevLimitUpPaused !== state.limitUp.autoRefreshPausedBySchedule) {
    rerenderLimitUpPage();
  }
}

function startDataRefreshScheduleChecker() {
  monitorCtrl.startChecker(warmTradeCalendar, applyDataRefreshSchedule);
}

function _onKlineUpdated(code, period, data) {
  // Phase 8: SWR revalidate 之后 同步更新展开的 chart (涵盖监控、涨停、10日强势股)
  for (const mgr of [monitorChartMgr, limitUpChartMgr, momentumChartMgr]) {
    const inst = mgr.getInst(code);
    if (inst && inst.klineData && inst.period === period && mgr.isExpanded(code)) {
      inst.klineData = data;
      const ctl = mgr.klineCtlMap.get(code);
      if (ctl) {
        applyKlineDataToChart(ctl, inst, data);
        mgr.updateKlineStatus(code);
      }
    }
  }
}

export function startApp(root) {
  initTheme();
  // Phase 8: subscribe to kline cache updates (SWR revalidate)
  if (typeof state.unsubKlineUpdated === 'function') {
    state.unsubKlineUpdated();
  }
  state.unsubKlineUpdated = onKlineUpdated(_onKlineUpdated);
  const settings = getSettings();
  state.refreshInterval = settings.refreshInterval || DEFAULT_REFRESH;
  state.watchList = getWatchList();
  state.voice = normalizeVoiceSettings(getVoiceSettings());
  state.alert = normalizeAlertSettings(getAlertSettings());
  state.subscribed = new Set(getSubscribedCodes());
  if (isNotificationSupported()) {
    try {
      state.notifPermission = (globalThis.Notification && globalThis.Notification.permission) || 'default';
    } catch {
      state.notifPermission = 'default';
    }
  }
  const luSettings = getLimitUpSettings();
  state.limitUp.refreshInterval = luSettings.refreshInterval;
  state.limitUp.pinnedCodes = new Set(getLimitUpPinnedCodes());
  state.momentum.pinnedCodes = new Set(getMomentumPinnedCodes());
  renderMonitorPage(root);
  refreshNow();
  startDataRefreshScheduleChecker();
  startVoiceScheduleChecker();
  if (state.voice.enabled) startVoiceTimer();
  appRouter = createHashRouter(
    {
      '#/': (r) => {
        stopLimitUpTimer();
        closeAllLimitUpCharts();
        // Race fix: an in-flight limitUpFetch() may resolve after this handler
        // returns. Clear limitUpCtrl root BEFORE renderMonitorPage so the
        // fetch's finally-block rerender is a no-op.
        limitUpCtrl.setRootEl(null);
        renderMonitorPage(r);
        applyDataRefreshSchedule();
      },
      '#/limit-up': (r) => {
        stopMonitorTimer();
        closeAllCharts();
        closeAllMomentumCharts();
        limitUpCtrl.setRootEl(r);
        limitUpCtrl.render();
        limitUpFetch();
        applyDataRefreshSchedule();
      }
    },
    '#/',
    root
  );
  appRouter.start();
}

export function stopApp() {
  if (typeof state.unsubKlineUpdated === 'function') {
    state.unsubKlineUpdated();
    state.unsubKlineUpdated = null;
  }
  if (appRouter && typeof appRouter.stop === 'function') {
    appRouter.stop();
    appRouter = null;
  }
  monitorCtrl.stop();
  stopMomentumScan();
  stopMonitorTimer();
  stopLimitUpTimer();
  voiceCtrl.stop();
  closeAllCharts();
  closeAllLimitUpCharts();
  closeAllMomentumCharts();
}

export function _internal() {
  return { state, chartInstanceMap, get limitUpRootEl() { return limitUpCtrl.getRootEl(); } };
}
