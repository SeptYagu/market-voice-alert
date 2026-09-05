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
  patchLimitUpSettings,
  getMomentumPinnedCodes,
  setMomentumPinnedCodes,
  getLimitUpPinnedCodes,
  setLimitUpPinnedCodes
} from './storage.js';
import { fetchQuotes, fetchKline, fetchIntraday, onKlineUpdated } from './api.js';
import { fetchAktoolsSpotList } from './aktoolsApi.js';
import { normalizeCode } from './parser.js';
import { parseFutureInput, isFutureCode } from './futures/instrument.js';
import {
  PERIODS,
  PERIOD_LABELS,
  DEFAULT_PERIOD,
  isValidPeriod,
  getLastKlineDate
} from './kline.js';
import {
  ChartRowManager,
  createChartState,
  rememberRange,
  restoreRangeOrFit,
  getPrevCloseForDate,
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
import { fetchLimitUpList, fetchLimitUpReasons, fetchLimitUpMetadataBatch, clearLimitUpMetadataCache } from './limitUpApi.js';
import { buildLimitUpGroups, mergeLiveTicks, sortLimitUpGroupItems } from './limitUp.js';
import { renderLimitUpPage } from './limitUpView.js';
import {
  fetchTradeCalendar,
  getAdjacentTradingDates,
  resolveLatestTradingDate
} from './tradeCalendar.js';
import { getBeijingDate, formatDateTime } from './time.js';
import {
  DEFAULT_SMART_SCHEDULE,
  getMarketSession,
  isAutoRefreshAllowedInSession,
  isVoiceAllowedInSession,
  normalizeSmartSchedule,
  isFuturesMarketOpen,
  isLiveTradeDate
} from './marketSession.js';

import {
  LIMIT_UP_REFRESH_OPTIONS,
  formatNumber,
  priceDirection,
  formatPercent,
  formatAmount,
  formatPriceWithPercent,
  stripPrefix,
  makeExportFilename,
  intradaySourceLabel
} from './format.js';
import { showConfirmModal } from './modal.js';
import { renderVoiceBar as renderVoiceBarView, updateVoiceHint as updateVoiceHintView } from './views/voiceBarView.js';
import { renderAlertBar as renderAlertBarView, updateAlertHint as updateAlertHintView } from './views/alertBarView.js';
import {
  computeTenDayMomentum,
  sortMomentumItems,
  getMomentumReasonText,
  buildMomentumHeaderCheckbox,
  renderMomentumChartRow,
  updateMomentumQuoteCells as updateMomentumQuoteCellsView,
  MOMENTUM_LOOKBACK_TRADING_DAYS,
  MOMENTUM_THRESHOLD_PCT
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
  sortMomentumItems,
  getMomentumReasonText,
  buildMomentumHeaderCheckbox,
  renderMomentumChartRow,
  MOMENTUM_LOOKBACK_TRADING_DAYS,
  MOMENTUM_THRESHOLD_PCT
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

export function parseBatchInput(input) {
  if (!input || typeof input !== 'string') return [];
  const tokens = input.split(/[,， ]+/);
  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    const norm = normalizeFuture(tok) || normalizeCode(tok);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

function normalizeFuture(input) {
  if (!input || typeof input !== 'string') return null;
  const inst = parseFutureInput(input);
  if (inst) return inst.symbol.toLowerCase();
  const raw = input.trim().toLowerCase();
  if (/^nf\d{4}$/.test(raw)) return raw;
  return null;
}



export function buildExportText(codes) {
  return codes.map(stripPrefix).filter(Boolean).join('\n');
}

export function buildExportCsv(codes, quotesMap) {
  const header = ['代码', '名称', '现价', '涨跌幅(%)', '开盘价', '成交量', '成交额/持仓量', '类型'];
  const rows = [header.join(',')];
  for (const code of codes || []) {
    if (!code) continue;
    const q = quotesMap && typeof quotesMap.get === 'function' ? quotesMap.get(code) : null;
    const isFuture = q ? (q.type === 'future' || isFutureCode(code)) : isFutureCode(code);
    const displayCode = isFuture ? code.toUpperCase() : stripPrefix(code);
    const name = (q && q.name) ? `"${String(q.name).replace(/"/g, '""')}"` : `"${displayCode}"`;
    const decimals = isFuture && q && q.priceTick && q.priceTick < 0.01 ? 3 : 2;
    const price = q && Number.isFinite(Number(q.price)) ? Number(q.price).toFixed(decimals) : '';
    const pct = q && Number.isFinite(Number(q.changePercent)) ? Number(q.changePercent).toFixed(2) : '';
    const open = q && Number.isFinite(Number(q.open)) ? Number(q.open).toFixed(decimals) : '';
    const vol = q && Number.isFinite(Number(q.volume)) ? Math.round(Number(q.volume)) : '';
    const amount = q && Number.isFinite(Number(q.amount)) ? Number(q.amount) : '';
    const type = isFuture ? '期货' : '股票';
    rows.push([displayCode, name, price, pct, open, vol, amount, type].join(','));
  }
  return '\uFEFF' + rows.join('\r\n');
}

function downloadText(text, filename) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const mime = filename.endsWith('.csv') ? 'text/csv;charset=utf-8;' : 'text/plain;charset=utf-8';
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const state = {
  watchList: [],
  quotes: new Map(),
  selected: new Set(),
  subscribed: new Set(),
  refreshInterval: DEFAULT_REFRESH,
  refreshSeq: 0,
  unsubKlineUpdated: null,
  timer: null,
  autoRefreshEnabled: true,
  autoRefreshPausedBySchedule: false,
  dataScheduleTimer: null,
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
  tickWorker: null,
  tickFallback: null,
  voiceScheduleTimer: null,
  voiceLastSession: null,
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

let limitUpRootEl = null;
let abortController = null;

const MOMENTUM_SCAN_CONCURRENCY = 8;

function resolveInitialTradeDate(code, data) {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  const today = getBeijingDate();
  const latestTrading = resolveLatestTradingDate(today, dates);
  const q = state.quotes.get(code);
  if (q && q.tradingDay) return q.tradingDay;
  if (isFutureCode(code)) {
    return (q && q.tradingDay) || latestTrading || today;
  }
  const lastBarDate = data && data.items ? getLastKlineDate(data.items) : '';
  if (latestTrading && (!lastBarDate || lastBarDate <= latestTrading)) {
    return latestTrading;
  }
  return lastBarDate || latestTrading || today;
}

export const monitorChartMgr = new ChartRowManager({
  prefix: '',
  hasIntraday: true,
  klineHeight: 360,
  intradayHeight: 360,
  getTheme: getCurrentTheme,
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
  getChartInstances: () => state.momentum.chartInstances,
  getQuote: (code) => state.quotes.get(code),
  isExpanded: (code) => state.momentum.expandedCodes.has(code),
  onStateChange: () => renderMomentumSection()
});
export const momentumChartCtlMap = momentumChartMgr.klineCtlMap;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
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
  root.appendChild(renderHeader());
  root.appendChild(renderToolbar());
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

function renderHeader() {
  const theme = getCurrentTheme();
  return el(
    'header',
    { class: 'app-header' },
    el('h1', {}, '股票期货监控助手 v2'),
    el(
      'nav',
      { class: 'app-nav', id: 'app-nav' },
      el('a', { href: '#/', class: 'nav-link', 'data-route': '#/' }, '监控'),
      el('a', { href: '#/limit-up', class: 'nav-link', 'data-route': '#/limit-up' }, '涨停看板')
    ),
    el(
      'div',
      { class: 'header-actions' },
      renderRefreshSelect(),
      el(
        'button',
        {
          id: 'theme-toggle',
          title: `当前: ${THEME_LABELS[theme]} (点击切换)`,
          on: { click: handleToggleTheme }
        },
        THEME_ICONS[theme] + ' ' + THEME_LABELS[theme]
      )
    )
  );
}

function renderRefreshSelect() {
  const select = el('select', { id: 'refresh-select', on: { change: handleRefreshChange } });
  for (const opt of REFRESH_OPTIONS) {
    const option = el('option', { value: opt.value }, opt.label);
    if (Number(opt.value) === state.refreshInterval) option.selected = true;
    select.appendChild(option);
  }
  return el('label', { class: 'refresh-label' }, '刷新: ', select);
}

function autoRefreshButtonText(enabled, paused) {
  if (!enabled) return '开始自动刷新';
  return paused ? '自动刷新已暂停' : '停止自动刷新';
}

function autoRefreshButtonTitle(enabled, paused) {
  if (!enabled) return '开始自动刷新';
  return paused ? '非交易时段，自动刷新将在开盘后恢复' : '停止自动刷新';
}

function updateMonitorAutoRefreshButton() {
  const btn = document.getElementById('auto-refresh-toggle');
  if (!btn) return;
  btn.className = state.autoRefreshEnabled ? 'btn-ctl-active' : '';
  btn.title = autoRefreshButtonTitle(state.autoRefreshEnabled, state.autoRefreshPausedBySchedule);
  btn.textContent = autoRefreshButtonText(state.autoRefreshEnabled, state.autoRefreshPausedBySchedule);
}

function renderToolbar() {
  return el(
    'section',
    { class: 'toolbar' },
    el(
      'div',
      { class: 'add-row' },
      el('input', {
        type: 'text',
        id: 'code-input',
        placeholder: '输入代码（用逗号或空格分隔，回车添加）：600519, 000001 nf2105',
        on: {
          keydown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }
        }
      }),
      el(
        'div',
        { class: 'add-actions' },
        el('button', { class: 'btn-primary', on: { click: handleAdd } }, '+ 添加'),
        el('button', { on: { click: handleRefreshNow } }, '⟳ 立即刷新'),
        el(
          'button',
          {
            id: 'auto-refresh-toggle',
            class: state.autoRefreshEnabled ? 'btn-ctl-active' : '',
            title: autoRefreshButtonTitle(state.autoRefreshEnabled, state.autoRefreshPausedBySchedule),
            on: { click: () => handleMonitorAutoRefreshToggle(!state.autoRefreshEnabled) }
          },
          autoRefreshButtonText(state.autoRefreshEnabled, state.autoRefreshPausedBySchedule)
        )
      )
    ),
    el(
      'div',
      { class: 'list-actions' },
      el('button', { on: { click: handleSelectAll } }, '全选'),
      el('button', { on: { click: handleSelectNone } }, '清空选择'),
      el('button', { class: 'btn-danger', on: { click: handleDeleteSelected } }, '删除选中'),
      el('button', { on: { click: () => handleExport('selected') } }, '导出选中'),
      el('button', { on: { click: () => handleExport('all') } }, '导出全部')
    )
  );
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

function renderMomentumSection() {
  const wrap = document.getElementById('momentum-section');
  if (!wrap) return;
  const s = state.momentum;
  for (const code of s.expandedCodes || []) {
    const inst = s.chartInstances.get(code);
    const ctl = momentumChartCtlMap.get(code);
    rememberRange(inst, ctl, '_visibleRange');
    if (ctl) {
      try { ctl.destroy(); } catch { /* ignore */ }
      momentumChartCtlMap.delete(code);
    }
  }
  wrap.innerHTML = '';
  const statusBits = [];
  if (s.loading || s.serverScanning) statusBits.push(`扫描中 ${s.scanned}/${s.total || '?'}`);
  else if (s.lastUpdate) statusBits.push(`更新于 ${s.lastUpdate.toLocaleTimeString()}`);
  if (s.message) statusBits.push(s.message);
  if (s.error) statusBits.push(`错误: ${s.error}`);
  const head = el(
    'header',
    { class: 'momentum-header' },
    el('div', { class: 'momentum-title' }, `10日涨幅超${MOMENTUM_THRESHOLD_PCT}%`),
    el('div', { class: 'momentum-actions' },
      el(
        'button',
        {
          disabled: s.loading || s.serverScanning,
          on: { click: handleMomentumScan }
        },
        '扫描'
      ),
      el(
        'button',
        {
          disabled: !s.loading && !s.serverScanning,
          on: { click: stopMomentumScan }
        },
        '停止'
      ),
      s.selectedCodes && s.selectedCodes.size
        ? el('span', { class: 'momentum-status' }, `${s.selectedCodes.size} 已选`)
        : null,
      el('span', { class: 'momentum-status' }, statusBits.join(' · '))
    )
  );
  wrap.appendChild(head);

  const items = sortMomentumItems(s.items, s.pinnedCodes);
  if (!items.length) {
    wrap.appendChild(el('div', { class: 'momentum-empty' }, (s.loading || s.serverScanning) ? '扫描中...' : '暂无结果'));
    return;
  }

  const table = el('table', { class: 'momentum-table' });
  const colCount = 11;
  table.appendChild(el(
    'thead',
    {},
    el('tr', {},
      el('th', { class: 'col-check', 'data-field': 'check' }, buildMomentumHeaderCheckbox(items, s.selectedCodes, handleMomentumSelectAllChange)),
      el('th', { class: 'col-sub', 'data-field': 'sub', title: '勾选订阅语音播报与价格提醒' }, '播报'),
      el('th', { class: 'col-pin', 'data-field': 'pin' }, '固定'),
      el('th', { class: 'code', 'data-field': 'code' }, '代码'),
      el('th', { class: 'name', 'data-field': 'name' }, '名称'),
      el('th', { class: 'num', 'data-field': 'gain' }, '10日涨幅'),
      el('th', { class: 'num', 'data-field': 'price' }, '现价'),
      el('th', { class: 'num', 'data-field': 'percent' }, '当日涨幅'),
      el('th', { class: 'num', 'data-field': 'amount' }, '成交额'),
      el('th', { class: 'col-industry', 'data-field': 'industry' }, '行业'),
      el('th', { class: 'col-reason', 'data-field': 'reason' }, '异动/原因')
    )
  ));
  const tbody = el('tbody', {});
  for (const item of items) {
    const pinned = s.pinnedCodes.has(item.code);
    const selected = s.selectedCodes && s.selectedCodes.has(item.code);
    const subscribed = state.subscribed.has(item.code);
    const active = s.expandedCodes && s.expandedCodes.has(item.code);
    const dir = priceDirection(Number(item.changePercent));
    tbody.appendChild(el(
      'tr',
      {
        class: [
          pinned ? 'momentum-pinned' : '',
          active ? 'active' : ''
        ].filter(Boolean).join(' '),
        'data-momentum-code': item.code,
        title: active ? '点击关闭 K 线' : '点击查看 K 线',
        role: 'button',
        tabindex: '0',
        'aria-expanded': active ? 'true' : 'false',
        on: {
          click: (e) => handleMomentumRowClick(item.code, e),
          keydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return;
              e.preventDefault();
              handleMomentumRowClick(item.code, e);
            }
          }
        }
      },
      el('td', { class: 'col-check', 'data-field': 'check' },
        el('input', {
          type: 'checkbox',
          'data-momentum-select': item.code,
          checked: !!selected,
          on: {
            click: (e) => e.stopPropagation(),
            change: (e) => handleMomentumToggleSelect(item.code, e.target.checked)
          }
        })
      ),
      el('td', { class: 'col-sub', 'data-field': 'sub' },
        el('input', {
          type: 'checkbox',
          'data-momentum-sub': item.code,
          title: '订阅播报/提醒',
          checked: !!subscribed,
          on: {
            click: (e) => e.stopPropagation(),
            change: (e) => handleToggleSubscribe(item.code, e.target.checked)
          }
        })
      ),
      el('td', { class: 'col-pin', 'data-field': 'pin' },
        el('button', {
          class: 'pin-btn' + (pinned ? ' active' : ''),
          title: pinned ? '取消固定' : '固定',
          'aria-label': pinned ? `取消固定 ${item.name || item.code}` : `固定 ${item.name || item.code}`,
          on: {
            click: (e) => {
              e.stopPropagation();
              handleMomentumPinToggle(item.code);
            }
          }
        }, pinned ? '取消固定' : '固定')
      ),
      el('td', { class: 'code', 'data-field': 'code' }, item.code),
      el('td', { class: 'name', 'data-field': 'name' }, item.name || '-'),
      el('td', { class: 'num up', 'data-field': 'gain' }, formatPercent(item.gainPercent)),
      el('td', { class: 'num', 'data-field': 'price' }, formatNumber(item.price)),
      el('td', { class: `num ${dir}`, 'data-field': 'percent' }, formatPercent(item.changePercent)),
      el('td', { class: 'num', 'data-field': 'amount' }, formatAmount(item.amount)),
      el('td', { class: 'momentum-industry', 'data-field': 'industry' }, item.industry || '-'),
      el('td', { class: 'momentum-reason', 'data-field': 'reason', title: item.interpretation || item.reason || '' }, getMomentumReasonText(item))
    ));
    if (active) {
      tbody.appendChild(renderMomentumChartRow(item, colCount, {
        momentumState: s,
        defaultPeriod: DEFAULT_PERIOD,
        onPeriodChange: handleMomentumKlinePeriodChange,
        onForceReload: handleMomentumForceReloadChart,
        onCloseChart: closeMomentumChart
      }));
    }
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  for (const code of s.expandedCodes || []) {
    mountMomentumChart(code);
  }
}

function handleMomentumSelectAllChange(checked, codes) {
  if (checked) {
    state.momentum.selectedCodes = new Set(codes);
  } else {
    for (const code of codes) state.momentum.selectedCodes.delete(code);
  }
  renderMomentumSection();
}

function handleMomentumToggleSelect(code, checked) {
  if (!code) return;
  if (checked) state.momentum.selectedCodes.add(code);
  else state.momentum.selectedCodes.delete(code);
  renderMomentumSection();
}

function handleMomentumRowClick(code, e) {
  const target = e && e.target;
  if (target && target.tagName === 'INPUT') return;
  if (target && target.tagName === 'BUTTON') return;
  if (target && target.closest && target.closest('.momentum-chart-row')) return;
  if (state.momentum.expandedCodes.has(code)) closeMomentumChart(code);
  else openMomentumChart(code);
}

function stopMomentumScan() {
  if (state.momentum.abort) {
    try { state.momentum.abort.abort(); } catch { /* ignore */ }
  }
  state.momentum.abort = null;
  state.momentum.loading = false;
  state.momentum.serverScanning = false;
  state.momentum.message = '已停止页面轮询；服务端任务可继续在后台完成';
  renderMomentumSection();
}

function mergePinnedMomentumItems(nextItems) {
  const byCode = new Map((Array.isArray(nextItems) ? nextItems : []).map((it) => [it.code, it]));
  const oldByCode = new Map((state.momentum.items || []).map((it) => [it.code, it]));
  for (const code of state.momentum.pinnedCodes) {
    if (byCode.has(code)) continue;
    const old = oldByCode.get(code);
    if (old) byCode.set(code, { ...old, pinnedOnly: true });
  }
  return sortMomentumItems([...byCode.values()], state.momentum.pinnedCodes);
}

async function fetchMomentumUniverse(signal) {
  try {
    const sharedSpot = await fetchSharedSpot(signal);
    if (Array.isArray(sharedSpot) && sharedSpot.length) return sharedSpot;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
  }
  try {
    const spot = await fetchAktoolsSpotList({ signal });
    if (Array.isArray(spot) && spot.length) return spot;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
  }
  const fallbackCodes = [...new Set([
    ...state.watchList,
    ...state.limitUp.items.map((it) => it.code)
  ])].filter((code) => /^(sh|sz|bj)\d{6}$/i.test(code));
  if (!fallbackCodes.length) return [];
  const quotes = await fetchQuotes(fallbackCodes, { signal });
  return quotes;
}

async function fetchSharedSpot(signal) {
  const res = await fetch('/api/cache/spot/latest', { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const items = json && json.ok === true && json.data && Array.isArray(json.data.items)
    ? json.data.items
    : [];
  if (!items.length) throw new Error('shared spot cache failed');
  return items;
}

async function scanMomentumCandidate(candidate, signal) {
  if (!candidate || !/^(sh|sz|bj)\d{6}$/i.test(candidate.code)) return null;
  const data = await fetchKline(candidate.code, { period: '1d', signal, sharedCache: true });
  const stats = computeTenDayMomentum(data);
  if (!stats || stats.gainPercent < MOMENTUM_THRESHOLD_PCT) return null;
  const limitUpItem = (state.limitUp.items || []).find((it) => it && it.code === candidate.code);
  const reason = candidate.reason || (limitUpItem && (limitUpItem.reason || limitUpItem.limitStats)) || '';
  const interpretation = candidate.interpretation || (limitUpItem && limitUpItem.interpretation) || '';
  return {
    code: candidate.code,
    name: candidate.name || (data && data.name) || candidate.code,
    price: Number(candidate.price) || stats.lastClose,
    changePercent: Number(candidate.changePercent) || 0,
    amount: Number(candidate.amount) || 0,
    volumeRatio: Number(candidate.volumeRatio) || 0,
    industry: candidate.industry || (limitUpItem && limitUpItem.industry) || '',
    reason,
    interpretation,
    limitStats: candidate.limitStats || (limitUpItem && limitUpItem.limitStats) || '',
    anomaly: reason ? '' : `10日涨幅超${MOMENTUM_THRESHOLD_PCT}%`,
    ...stats
  };
}

async function handleMomentumScan(options = {}) {
  if (state.momentum.loading) return;
  if (state.momentum.abort) {
    try { state.momentum.abort.abort(); } catch { /* ignore */ }
  }
  const abort = new AbortController();
  state.momentum.abort = abort;
  state.momentum.loading = true;
  if (!options || options.poll !== true) state.momentum.serverScanning = false;
  state.momentum.message = null;
  state.momentum.error = null;
  state.momentum.scanned = 0;
  state.momentum.total = 0;
  renderMomentumSection();
  try {
    if (!options || options.poll !== true) {
      await startSharedMomentumScan(abort.signal);
      state.momentum.serverScanning = true;
    }
    let cached = null;
    try {
      cached = await fetchSharedMomentum(abort.signal);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      cached = null;
    }
    if (cached && Array.isArray(cached.items)) {
      state.momentum.total = cached.universeSize || cached.items.length;
      state.momentum.scanned = cached.scanned || state.momentum.total;
      state.momentum.items = mergePinnedMomentumItems(cached.items);
      if (cached.status === 'scanning') {
        state.momentum.serverScanning = true;
        state.momentum.message = '服务端扫描中，稍后自动刷新';
        setTimeout(() => {
          if (state.momentum.serverScanning && !state.momentum.loading) handleMomentumScan({ poll: true });
        }, 5000);
        return;
      }
      state.momentum.serverScanning = false;
      if (cached.status === 'empty') {
        state.momentum.error = cached.message || '等待服务端定时扫描生成结果';
        return;
      }
      if (cached.status === 'error') {
        state.momentum.error = cached.error || '后端全市场扫描失败，已保留部分结果';
        return;
      }
      if (cached.status === 'partial') {
        state.momentum.message = cached.message || '部分股票数据源刷新失败；当前仅展示有效结果';
      }
      for (const item of state.momentum.items) {
        if (item && item.code) state.quotes.set(item.code, { ...item, type: 'stock' });
      }
      state.momentum.lastUpdate = new Date();
      return;
    }

    const universe = await fetchMomentumUniverse(abort.signal);
    if (!universe.length) throw new Error('没有可扫描的股票池');
    state.momentum.total = universe.length;
    renderMomentumSection();
    const found = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < universe.length) {
        const idx = cursor;
        cursor += 1;
        if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const candidate = universe[idx];
        try {
          const item = await scanMomentumCandidate(candidate, abort.signal);
          if (item) found.push(item);
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
        } finally {
          state.momentum.scanned += 1;
          if (state.momentum.scanned % 25 === 0 || state.momentum.scanned === state.momentum.total) {
            renderMomentumSection();
          }
        }
      }
    };
    const workerCount = Math.min(MOMENTUM_SCAN_CONCURRENCY, universe.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    state.momentum.items = mergePinnedMomentumItems(found);
    for (const item of state.momentum.items) {
      if (item && item.code) state.quotes.set(item.code, { ...item, type: 'stock' });
    }
    state.momentum.lastUpdate = new Date();
  } catch (e) {
    state.momentum.serverScanning = false;
    if (e && e.name !== 'AbortError') state.momentum.error = e.message || String(e);
  } finally {
    if (state.momentum.abort === abort) state.momentum.abort = null;
    state.momentum.loading = false;
    renderMomentumSection();
  }
}

async function fetchSharedMomentum(signal) {
  const usp = new URLSearchParams();
  usp.set('threshold', String(MOMENTUM_THRESHOLD_PCT));
  const res = await fetch(`/api/cache/momentum/ten-day?${usp.toString()}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json || json.ok !== true || !json.data) {
    throw new Error((json && json.error) || 'shared momentum cache failed');
  }
  return json.data;
}

async function startSharedMomentumScan(signal) {
  const usp = new URLSearchParams();
  usp.set('threshold', String(MOMENTUM_THRESHOLD_PCT));
  const res = await fetch(`/api/cache/momentum/ten-day/scan?${usp.toString()}`, {
    method: 'POST',
    signal
  });
  if (!res.ok) throw new Error(`启动扫描失败: HTTP ${res.status}`);
  const json = await res.json();
  if (!json || json.ok !== true) throw new Error((json && json.error) || '启动扫描失败');
  return json.data;
}

function handleMomentumPinToggle(code) {
  if (!code) return;
  const pins = new Set(state.momentum.pinnedCodes);
  if (pins.has(code)) pins.delete(code);
  else pins.add(code);
  state.momentum.pinnedCodes = pins;
  setMomentumPinnedCodes([...pins]);
  state.momentum.items = pins.has(code)
    ? mergePinnedMomentumItems(state.momentum.items)
    : state.momentum.items.filter((it) => it.code !== code || !it.pinnedOnly);
  renderMomentumSection();
}

function openMomentumChart(code) {
  if (!code || state.momentum.expandedCodes.has(code)) return;
  state.momentum.expandedCodes.add(code);
  state.momentum.chartInstances.set(code, createChartState(DEFAULT_PERIOD));
  renderMomentumSection();
  momentumChartMgr.loadKline(code);
}

function closeMomentumChart(code) {
  if (!code || !state.momentum.expandedCodes.has(code)) return;
  state.momentum.expandedCodes.delete(code);
  momentumChartMgr.destroyCharts(code);
  const inst = state.momentum.chartInstances.get(code);
  if (inst && inst.abort) {
    try { inst.abort.abort(); } catch { /* ignore */ }
  }
  state.momentum.chartInstances.delete(code);
  renderMomentumSection();
}

function handleMomentumKlinePeriodChange(code, period) {
  momentumChartMgr.handlePeriodChange(period, code);
}

function handleMomentumForceReloadChart(code) {
  momentumChartMgr.loadKline(code, { force: true });
}

function mountMomentumChart(code) {
  momentumChartMgr.mountCharts(code);
}

function buildWatchHeaderCheckbox() {
  const total = state.watchList.length;
  const checkedCount = [...state.selected].filter((code) => state.watchList.includes(code)).length;
  const input = el('input', {
    type: 'checkbox',
    id: 'watch-select-all',
    title: '全选/取消全选',
    checked: total > 0 && checkedCount === total,
    on: {
      click: (e) => e.stopPropagation(),
      change: (e) => {
        if (e.target.checked) handleSelectAll();
        else handleSelectNone();
      }
    }
  });
  input.indeterminate = checkedCount > 0 && checkedCount < total;
  return input;
}

function updateWatchHeaderCheckbox() {
  const input = document.getElementById('watch-select-all');
  if (!input) return;
  const total = state.watchList.length;
  const checkedCount = [...state.selected].filter((code) => state.watchList.includes(code)).length;
  input.checked = total > 0 && checkedCount === total;
  input.indeterminate = checkedCount > 0 && checkedCount < total;
}

function renderTable() {
  // Destroy all live chart instances BEFORE we wipe #table-wrap. Each chart
  // ctl is attached to a <div class="chart-host"> inside the current chart-row;
  // clearing wrap.innerHTML detaches the host but leaves the ctl alive in
  // chartInstanceMap. The next renderInlineChartRow creates a fresh host, but
  // mountChartForCode sees chartInstanceMap.has(code) and skips re-creating
  // the ctl — leaving the new host empty. Destroy up front so the loop after
  // table-build can recreate cleanly.
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

  const wrap = document.getElementById('table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!state.watchList.length) {
    wrap.appendChild(el('div', { class: 'empty' }, '空空如也。先在上方输入代码添加吧～'));
    return;
  }

  const table = el('table', { class: 'watch-table' });
  const hasFuturesInList = (state.watchList || []).some(isFutureCode);
  const thead = el(
    'thead',
    {},
    el(
      'tr',
      {},
      el('th', { class: 'col-check', 'data-field': 'check', title: '勾选用于批量删除/导出' }, buildWatchHeaderCheckbox()),
      el('th', { class: 'col-sub', 'data-field': 'sub', title: '勾选订阅语音播报与价格提醒' }, '🔊 订阅'),
      el('th', { class: 'code', 'data-field': 'code' }, '代码'),
      el('th', { class: 'name', 'data-field': 'name' }, '名称'),
      el('th', { class: 'num', 'data-field': 'price' }, '现价'),
      el('th', { class: 'num', 'data-field': 'percent' }, '涨跌幅'),
      el('th', { class: 'num', 'data-field': 'open' }, '开盘(涨幅)'),
      el('th', { class: 'num', 'data-field': 'volume', title: hasFuturesInList ? '股票显示量比，期货显示成交量' : '量比' }, hasFuturesInList ? '量比 / 量' : '量比'),
      el('th', { class: 'num', 'data-field': 'amount', title: hasFuturesInList ? '股票显示成交额，期货显示持仓量' : '成交额' }, hasFuturesInList ? '成交额 / 持仓' : '成交额'),
      el('th', { class: 'col-op', 'data-field': 'op' }, '操作')
    )
  );
  table.appendChild(thead);

  const tbody = el('tbody', { id: 'watch-tbody' });
  for (const code of state.watchList) {
    const isActive = state.expandedCodes.has(code);
    tbody.appendChild(renderRow(code, isActive));
    if (isActive) {
      tbody.appendChild(renderInlineChartRow(code));
    }
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  for (const code of state.expandedCodes) {
    mountChartForCode(code);
  }
}

function renderRow(code, isActive) {
  const q = state.quotes.get(code) || { code };
  const dir = priceDirection(Number(q.changePercent));
  const checkbox = el('input', {
    type: 'checkbox',
    'data-code': code,
    checked: state.selected.has(code),
    on: {
      change: (e) => handleToggleSelect(code, e.target.checked),
      click: (e) => e.stopPropagation()
    }
  });
  const subCheckbox = el('input', {
    type: 'checkbox',
    'data-code-sub': code,
    title: '订阅播报/提醒',
    checked: state.subscribed.has(code),
    on: {
      change: (e) => handleToggleSubscribe(code, e.target.checked),
      click: (e) => e.stopPropagation()
    }
  });
  const isFuture = q.type === 'future' || isFutureCode(code);
  const displayCode = isFuture ? code.toUpperCase() : code;
  const priceDecimals = isFuture && q.priceTick && q.priceTick < 0.01 ? 3 : 2;
  return el(
    'tr',
    {
      'data-code': code,
      class: isActive ? 'active' : null,
      title: isActive ? '点击关闭 K 线' : '点击查看 K 线',
      role: 'button',
      tabindex: '0',
      'aria-expanded': isActive ? 'true' : 'false',
      on: {
        click: (e) => handleRowClick(code, e),
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return;
            e.preventDefault();
            handleRowClick(code, e);
          }
        }
      }
    },
    el('td', { class: 'col-check', 'data-field': 'check' }, checkbox),
    el('td', { class: 'col-sub', 'data-field': 'sub' }, subCheckbox),
    el('td', { class: 'code', 'data-field': 'code' }, displayCode),
    el('td', { class: 'name', 'data-field': 'name' }, q.name || '...'),
    el('td', { class: `num ${dir}`, 'data-field': 'price' }, formatNumber(q.price, priceDecimals)),
    el('td', { class: `num ${dir}`, 'data-field': 'percent' }, formatPercent(q.changePercent)),
    el('td', { class: 'num', 'data-field': 'open' }, formatPriceWithPercent(q.open, q.openChangePercent)),
    el('td', { class: 'num', 'data-field': 'volume', title: isFuture ? '成交量' : '量比' }, isFuture ? (q.volume ? `${Math.round(q.volume).toLocaleString('en-US')}` : '-') : formatNumber(q.volumeRatio)),
    el('td', { class: 'num', 'data-field': 'amount', title: isFuture ? '持仓量' : '成交额' }, isFuture ? (q.openInterest ? `持仓 ${Math.round(q.openInterest).toLocaleString('en-US')}` : '-') : formatAmount(q.amount)),
    el(
      'td',
      { class: 'col-op', 'data-field': 'op' },
      el(
        'button',
        {
          class: 'btn-link',
          on: {
            click: (e) => {
              e.stopPropagation();
              handleRemove(code);
            }
          }
        },
        '删除'
      )
    )
  );
}

function renderInlineChartRow(code) {
  const inst = state.chartInstances.get(code);
  if (!inst) {
    return el('tr', { 'data-empty-for': code, class: 'chart-row' });
  }
  const q = state.quotes.get(code) || {};
  const tr = el('tr', { class: 'chart-row', 'data-chart-for': code });
  const td = el('td', { colspan: '10', class: 'chart-td' });

  const title = el(
    'div',
    { class: 'chart-inline-header' },
    el('strong', {}, q.name || code),
    el('span', { class: 'chart-inline-code' }, code),
    el('button', {
      class: 'chart-reload',
      id: `chart-reload-${code}`,
      title: '跳过缓存，从网络强制重新拉取',
      on: { click: (e) => { e.stopPropagation(); handleForceReloadChart(code); } }
    }, '🔄 重新加载'),
    el('button', {
      class: 'chart-close',
      title: '关闭',
      on: { click: (e) => { e.stopPropagation(); closeChart(code); } }
    }, '× 关闭')
  );

  const tabs = el('div', { class: 'period-tabs' });
  for (const p of Object.keys(PERIODS)) {
    tabs.appendChild(el('button', {
      class: 'period-tab' + (p === inst.period ? ' active' : ''),
      'data-period': p,
      on: { click: (e) => { e.stopPropagation(); handlePeriodChange(p, code); } }
    }, PERIOD_LABELS[p]));
  }

  const status = el('div', { class: 'chart-status', id: `chart-status-${code}` });
  updateChartStatusForCode(code, status);

  const intradayStatus = el('div', { class: 'chart-status', id: `intraday-status-${code}` });
  updateIntradayStatusForCode(code, intradayStatus);

  const intradayHost = el('div', {
    class: 'intraday-chart-host',
    id: `intraday-chart-host-${code}`
  });

  const host = el('div', {
    class: 'chart-host',
    id: `chart-host-${code}`
  });

  const split = el(
    'div',
    { class: 'chart-split' },
    el(
      'section',
      { class: 'chart-pane chart-pane-intraday' },
      el(
        'div',
        { class: 'chart-pane-title' },
        el('span', {}, '分时图'),
        el('span', { class: 'intraday-legend intraday-legend-price' }, '价格'),
        el('span', { class: 'intraday-legend intraday-legend-average' }, '均价')
      ),
      intradayStatus,
      intradayHost
    ),
    el(
      'section',
      { class: 'chart-pane chart-pane-kline' },
      el('div', { class: 'chart-pane-title' }, 'K线图'),
      status,
      host
    )
  );

  td.appendChild(title);
  td.appendChild(tabs);
  td.appendChild(split);
  tr.appendChild(td);
  return tr;
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
  const newCodes = [];
  for (const code of codes) {
    if (!state.watchList.includes(code)) {
      addToWatchList(code);
      newCodes.push(code);
    }
  }
  state.watchList = getWatchList();
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
function preloadKlineForCodes(codes) {
  if (!Array.isArray(codes) || !codes.length) return;
  const period = DEFAULT_PERIOD;  // '1d'
  const batches = [];
  for (let i = 0; i < codes.length; i += 3) {
    batches.push(codes.slice(i, i + 3));
  }
  let idx = 0;
  function runNextBatch() {
    if (idx >= batches.length) return;
    const batch = batches[idx++];
    Promise.allSettled(batch.map(code => fetchKline(code, { period, sharedCache: true }).catch(() => null)))
      .then(() => {
        if (idx < batches.length) setTimeout(runNextBatch, 200);
      });
  }
  setTimeout(runNextBatch, 0);
}

// Phase 8: 预拉涨停看板前 N 个涨停股的 1d K 线
function preloadLimitUpTopCharts(n = 10) {
  if (!Array.isArray(state.limitUp.items) || !state.limitUp.items.length) return;
  const top = state.limitUp.items.slice(0, n);
  preloadKlineForCodes(top.map(it => it.code));
}

function handleRemove(code) {
  removeFromWatchList(code);
  state.watchList = getWatchList();
  state.selected.delete(code);
  state.quotes.delete(code);
  if (state.subscribed.delete(code)) persistSubscribed();
  delete state.alertStates[code];
  if (state.expandedCodes.has(code)) closeChart(code);
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
  removeFromWatchList(codes);
  let subChanged = false;
  for (const c of codes) {
    state.quotes.delete(c);
    if (state.subscribed.delete(c)) subChanged = true;
    delete state.alertStates[c];
  }
  if (subChanged) persistSubscribed();
  for (const c of codes) {
    if (state.expandedCodes.has(c)) closeChart(c);
  }
  state.selected.clear();
  state.watchList = getWatchList();
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

function fetchLimitUpListNow() {
  // User-initiated refresh should always hit the network, never the 30s
  // aktools cache. Periodic timer-driven fetches still use the cache.
  clearLimitUpMetadataCache();
  state.limitUp.forceRefreshOnce = isLimitUpDateToday();
  return limitUpFetch();
}

async function ensureLimitUpTradingDate(
  rawDate = state.limitUp.selectedDate || getBeijingDate(),
  requestSeq = null
) {
  state.limitUp.calendarLoading = true;
  try {
    const dates = await fetchTradeCalendar();
    const target = rawDate || getBeijingDate();
    const resolved = resolveLatestTradingDate(target, dates);
    const adj = getAdjacentTradingDates(resolved, dates);
    if (requestSeq !== null && requestSeq !== state.limitUp.requestSeq) {
      return resolved;
    }
    state.tradingDates = dates;
    state.limitUp.tradingDates = dates;
    state.limitUp.selectedDate = resolved;
    state.limitUp.latestTradingDate = adj.latest;
    state.limitUp.previousTradingDate = adj.previous;
    state.limitUp.nextTradingDate = adj.next;
    return resolved;
  } finally {
    if (requestSeq === null || requestSeq === state.limitUp.requestSeq) {
      state.limitUp.calendarLoading = false;
    }
  }
}

function refreshLimitUpDateMeta() {
  const dates = state.limitUp.tradingDates;
  const adj = getAdjacentTradingDates(
    state.limitUp.selectedDate || getBeijingDate(),
    dates,
    getBeijingDate()
  );
  state.limitUp.selectedDate = adj.current;
  state.limitUp.latestTradingDate = adj.latest;
  state.limitUp.previousTradingDate = adj.previous;
  state.limitUp.nextTradingDate = adj.next;
}

function isLimitUpDateToday(date = state.limitUp.selectedDate) {
  return date === getBeijingDate();
}

function updateLimitUpStatusBar() {
  if (!limitUpRootEl) return;
  const statusEl = limitUpRootEl.querySelector('#lu-status');
  if (!statusEl) return;
  const parts = [];
  const total = (state.limitUp.groups || []).reduce((s, g) => s + (g.items ? g.items.length : 0), 0);
  parts.push(`共 ${total} 只涨停`);
  if (state.limitUp.loading) parts.push('加载中...');
  if (state.limitUp.error) parts.push(`错误: ${state.limitUp.error}`);
  if (state.limitUp.consecutiveEmptyFetches > 0 && state.limitUp.lastNonEmptyAt) {
    const ts = state.limitUp.lastNonEmptyAt.toLocaleTimeString();
    parts.push(`缓存自 ${ts} · 已空 ${state.limitUp.consecutiveEmptyFetches} 次`);
  } else if (state.limitUp.lastUpdate) {
    parts.push(`更新于 ${state.limitUp.lastUpdate.toLocaleTimeString()}`);
  }
  statusEl.textContent = parts.join(' · ');
}

function patchLimitUpQuoteCells() {
  if (!limitUpRootEl) return false;
  const groupsSection = limitUpRootEl.querySelector('#lu-groups');
  if (!groupsSection) return false;

  const items = state.limitUp.items || [];
  const existingRows = groupsSection.querySelectorAll('tr[data-code]');
  if (existingRows.length !== items.length) {
    return false;
  }
  if (!items.length) {
    updateLimitUpStatusBar();
    return true;
  }

  const itemMap = new Map(items.map((it) => [it.code, it]));
  for (const [code, item] of itemMap) {
    const row = groupsSection.querySelector(`tr[data-code="${code}"]`);
    if (!row) return false;
    const dir = priceDirection(Number(item.changePercent));
    const pCell = row.querySelector('.lu-price');
    if (pCell) pCell.textContent = formatNumber(item.price);
    const pctCell = row.querySelector('.lu-pct');
    if (pctCell) {
      pctCell.textContent = formatPercent(item.changePercent);
      pctCell.className = `lu-pct num ${dir}`;
    }
    const openCell = row.querySelector('.lu-open');
    if (openCell) openCell.textContent = formatNumber(item.open);
    const ratioCell = row.querySelector('.lu-ratio');
    if (ratioCell) ratioCell.textContent = formatNumber(item.volumeRatio);
    const amtCell = row.querySelector('.lu-amount');
    if (amtCell) amtCell.textContent = formatAmount(item.amount);
    const countCell = row.querySelector('.lu-count');
    if (countCell && item.limitUpCount !== undefined) countCell.textContent = `${item.limitUpCount} 板`;
    const finalCell = row.querySelector('.lu-final');
    if (finalCell && item.lastLimitTime) finalCell.textContent = item.lastLimitTime;
    const breakCell = row.querySelector('.lu-break');
    if (breakCell && item.breakCount !== undefined) breakCell.textContent = String(item.breakCount);
    const reasonCell = row.querySelector('.lu-reason');
    if (reasonCell && item.reason) {
      reasonCell.textContent = item.reason;
      if (item.interpretation) reasonCell.title = item.interpretation;
    }
  }
  updateLimitUpStatusBar();
  return true;
}

function rerenderLimitUpPage() {
  if (!limitUpRootEl) return;
  // Phase 8 fix: renderLimitUpPage 会 root.innerHTML='' 清空所有 DOM 节点,
  // 但 limitUpChartCtlMap 中的 ctl 仍引用旧 host 节点 — 在脱离 DOM 的元素上画图看不见。
  // 必须在 rerender 之前 destroy 所有 ctl, 然后 mount 到新 host。
  const wasExpandedCodes = new Set(state.limitUp.expandedCodes);
  for (const code of wasExpandedCodes) {
    const inst = state.limitUp.chartInstances.get(code);
    rememberRange(inst, limitUpChartCtlMap.get(code), '_visibleRange');
    rememberRange(inst, limitUpIntradayChartCtlMap.get(code), '_intradayVisibleRange');
    _destroyLimitUpChart(code);
  }
  renderLimitUpPage(limitUpRootEl, state.limitUp, {
    navigateTo: (path) => navigate(path),
    addToWatchListAndNavigate: handleLimitUpAddAndNavigate,
    onRefreshChange: handleLimitUpRefreshChange,
    fetchList: fetchLimitUpListNow,
    onLiveTickUpdate: applyLiveTicksToLimitUp,
    onSortChange: handleLimitUpSortChange,
    sortGroup: handleLimitUpGroupSort,
    toggleAutoRefresh: handleLimitUpAutoRefreshToggle,
    togglePin: handleLimitUpPinToggle,
    toggleSelect: handleLimitUpToggleSelect,
    selectAll: handleLimitUpSelectAll,
    selectNone: handleLimitUpSelectNone,
    addSelectedAndNavigate: handleLimitUpAddSelectedAndNavigate,
    openKline: handleLimitUpOpenKline,
    closeKline: handleLimitUpCloseKline,
    changeKlinePeriod: handleLimitUpKlinePeriodChange,
    onDateChange: handleLimitUpDateChange,
    reloadKline: _handleLimitUpForceReloadChart
  });
  // Re-mount chart instances for any newly-rendered (or re-rendered) chart rows.
  // buildInlineChartRow creates a fresh host; mountLimitUpChart attaches
  // the chart ctl to that host using the cached klineData.
  for (const code of wasExpandedCodes) {
    if (state.limitUp.expandedCodes.has(code)) {
      mountLimitUpChart(code);
    }
  }
}

export function applyLimitUpFetchResult(luState, items) {
  const prev = luState || {};
  const now = new Date();
  const sortKey = prev.sortKey || 'amount';
  if (Array.isArray(items) && items.length > 0) {
    const next = {
      ...prev,
      sortKey,
      items,
      lastNonEmptyItems: items,
      lastNonEmptyAt: now,
      consecutiveEmptyFetches: 0
    };
    return { ...next, groups: buildLimitUpGroupsForState(next) };
  }
  const cached = Array.isArray(prev.lastNonEmptyItems) ? prev.lastNonEmptyItems : [];
  const displayItems = cached.length ? cached : [];
  const next = {
    ...prev,
    sortKey,
    items: displayItems,
    consecutiveEmptyFetches: (Number(prev.consecutiveEmptyFetches) || 0) + 1
  };
  return { ...next, groups: buildLimitUpGroupsForState(next) };
}

function buildLimitUpGroupsForState(luState = state.limitUp) {
  const s = luState || {};
  const baseSort = s.sortKey || 'amount';
  const groups = buildLimitUpGroups(s.items || [], baseSort);
  const groupSort = s.groupSort || {};
  return groups.map((g) => {
    const sort = groupSort[g.key] || { key: baseSort, direction: 'desc' };
    return {
      ...g,
      items: sortLimitUpGroupItems(g.items, sort.key || baseSort, sort.direction || 'desc')
    };
  });
}

async function limitUpFetch() {
  if (state.limitUp.loading) return;
  if (state.limitUp.abort) {
    try { state.limitUp.abort.abort(); } catch { /* ignore */ }
  }
  const requestSeq = state.limitUp.requestSeq + 1;
  state.limitUp.requestSeq = requestSeq;
  const controller = new AbortController();
  state.limitUp.abort = controller;
  state.limitUp.loading = true;
  state.limitUp.error = null;
  rerenderLimitUpPage();
  try {
    const date = await ensureLimitUpTradingDate(
      state.limitUp.selectedDate || getBeijingDate(),
      requestSeq
    );
    if (requestSeq !== state.limitUp.requestSeq || state.limitUp.selectedDate !== date) return;
    const forceRefresh = !!state.limitUp.forceRefreshOnce;
    state.limitUp.forceRefreshOnce = false;
    const rawItems = await fetchLimitUpList({ signal: controller.signal, date, sharedCache: true, includeBroken: true, forceRefresh });
    if (requestSeq !== state.limitUp.requestSeq || state.limitUp.selectedDate !== date) return;
    state.limitUp.lastUpdate = new Date();
    state.limitUp = applyLimitUpFetchResult(state.limitUp, rawItems);
    if (!patchLimitUpQuoteCells()) {
      rerenderLimitUpPage();
    }
    if (isLimitUpDateToday(date)) {
      enrichLimitUpItemsWithQuotes(rawItems, controller.signal)
        .then((quoteEnriched) => {
          if (requestSeq !== state.limitUp.requestSeq || state.limitUp.selectedDate !== date) return;
          const quoteMap = new Map(quoteEnriched.map((it) => [it.code, it]));
          state.limitUp.items = state.limitUp.items.map((it) => {
            const q = quoteMap.get(it.code);
            return q ? {
              ...it,
              price: q.price,
              change: q.change,
              changePercent: q.changePercent,
              amount: q.amount,
              open: q.open,
              openChangePercent: q.openChangePercent,
              volumeRatio: q.volumeRatio
            } : it;
          });
          state.limitUp.groups = buildLimitUpGroupsForState();
          if (!patchLimitUpQuoteCells()) {
            rerenderLimitUpPage();
          }
        })
        .catch(() => { /* best-effort live quote enrichment */ });
    }
    kickoffLimitUpMetadataFetch(rawItems, date, requestSeq);
    kickoffLimitUpReasonsFetch(date, forceRefresh, requestSeq);
    // Phase 8: 涨停看板首次拉取后预拉前 10 个 K 线
    if (rawItems.length) {
      preloadLimitUpTopCharts(10);
    }
  } catch (e) {
    if (requestSeq === state.limitUp.requestSeq && e && e.name !== 'AbortError') {
      state.limitUp.error = e.message || String(e);
    }
  } finally {
    if (requestSeq === state.limitUp.requestSeq) {
      if (state.limitUp.abort === controller) state.limitUp.abort = null;
      state.limitUp.loading = false;
      updateLimitUpStatusBar();
    }
  }
}

async function enrichLimitUpItemsWithQuotes(items, signal) {
  if (!Array.isArray(items) || !items.length) return [];
  try {
    const quotes = await fetchQuotes(items.map((it) => it.code), { signal });
    const quoteMap = new Map(quotes.map((q) => [q.code, q]));
    return items.map((it) => {
      const q = quoteMap.get(it.code);
      if (!q) return it;
      return {
        ...it,
        price: Number.isFinite(Number(q.price)) && Number(q.price) > 0 ? Number(q.price) : it.price,
        change: Number.isFinite(Number(q.change)) ? Number(q.change) : it.change,
        changePercent: Number.isFinite(Number(q.changePercent)) ? Number(q.changePercent) : it.changePercent,
        prevClose: Number.isFinite(Number(q.prevClose)) ? Number(q.prevClose) : it.prevClose,
        open: Number.isFinite(Number(q.open)) ? Number(q.open) : it.open,
        openChangePercent: Number.isFinite(Number(q.openChangePercent)) ? Number(q.openChangePercent) : it.openChangePercent,
        volumeRatio: Number.isFinite(Number(q.volumeRatio)) ? Number(q.volumeRatio) : it.volumeRatio,
        amount: Number.isFinite(Number(q.amount)) && Number(q.amount) > 0 ? Number(q.amount) : it.amount
      };
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return items;
  }
}

function hasLimitUpMetadata(item) {
  if (!item) return false;
  return (
    item.limitUpCount !== undefined &&
    item.firstLimitTime !== undefined &&
    item.lastLimitTime !== undefined &&
    item.breakCount !== undefined
  );
}

function kickoffLimitUpMetadataFetch(items, date, requestSeq = state.limitUp.requestSeq) {
  if (!Array.isArray(items) || !items.length) return;
  const codes = items.filter((it) => !hasLimitUpMetadata(it)).map((it) => it.code).filter(Boolean);
  if (!codes.length) return;
  fetchLimitUpMetadataBatch(codes, { date })
    .then((metaMap) => {
      if (requestSeq !== state.limitUp.requestSeq || state.limitUp.selectedDate !== date) return;
      if (!metaMap || !metaMap.size) return;
      if (!state.limitUp.items.length) return;
      let changed = false;
      const merged = state.limitUp.items.map((it) => {
        const m = metaMap.get(it.code);
        if (!m) return it;
        changed = true;
        return { ...it, ...m };
      });
      if (!changed) return;
      state.limitUp.items = merged;
      state.limitUp.groups = buildLimitUpGroupsForState();
      if (!patchLimitUpQuoteCells()) {
        rerenderLimitUpPage();
      }
    })
    .catch(() => { /* best-effort; ignore */ });
}

function kickoffLimitUpReasonsFetch(date, forceRefresh = false, requestSeq = state.limitUp.requestSeq) {
  fetchLimitUpReasons({ date, sharedCache: true, forceRefresh })
    .then((reasonMap) => {
      if (requestSeq !== state.limitUp.requestSeq || state.limitUp.selectedDate !== date) return;
      if (!reasonMap) return;
      state.limitUp.reasonMap = reasonMap;
      if (!state.limitUp.items.length) return;
      let changed = false;
      const merged = state.limitUp.items.map((it) => {
        const r = reasonMap.get(it.code);
        if (!r) return it;
        if (it.reason === r.reason && it.interpretation === r.interpretation) return it;
        changed = true;
        return { ...it, reason: r.reason, interpretation: r.interpretation };
      });
      if (!changed) return;
      state.limitUp.items = merged;
      state.limitUp.groups = buildLimitUpGroupsForState();
      if (!patchLimitUpQuoteCells()) {
        rerenderLimitUpPage();
      }
    })
    .catch(() => { /* best-effort; ignore */ });
}

function handleLimitUpDateChange(newDate) {
  // YYYY-MM-DD string (HTML5 <input type="date">) or null = today
  closeAllLimitUpCharts();
  clearLimitUpMetadataCache();
  state.limitUp.requestSeq += 1;
  if (state.limitUp.abort) {
    try { state.limitUp.abort.abort(); } catch { /* ignore */ }
    state.limitUp.abort = null;
  }
  state.limitUp.selectedDate = newDate || getBeijingDate();
  state.limitUp.forceRefreshOnce = state.limitUp.selectedDate === getBeijingDate();
  state.limitUp.items = [];
  state.limitUp.groups = buildLimitUpGroupsForState();
  state.limitUp.lastNonEmptyItems = [];
  state.limitUp.lastNonEmptyAt = null;
  state.limitUp.consecutiveEmptyFetches = 0;
  state.limitUp.reasonMap = new Map();
  state.limitUp.error = null;
  state.limitUp.loading = true;
  rerenderLimitUpPage();
  state.limitUp.loading = false;
  limitUpFetch();
}

function applyLiveTicksToLimitUp() {
  if (!state.limitUp.items.length) return;
  if (!isLimitUpDateToday()) return;
  const merged = mergeLiveTicks(state.limitUp.items, state.quotes);
  if (merged === state.limitUp.items) return;
  state.limitUp.items = merged;
  state.limitUp.groups = buildLimitUpGroupsForState();
  if (!patchLimitUpQuoteCells()) {
    rerenderLimitUpPage();
  }
}

function startLimitUpTimer({ immediate = true } = {}) {
  stopLimitUpTimer({ abort: false });
  if (!state.limitUp.autoRefreshEnabled) {
    state.limitUp.autoRefreshPausedBySchedule = false;
    rerenderLimitUpPage();
    return;
  }
  if (!isDataAutoRefreshAllowedNow()) {
    state.limitUp.autoRefreshPausedBySchedule = true;
    rerenderLimitUpPage();
    return;
  }
  const interval = state.limitUp.refreshInterval;
  if (!interval || interval < 1000) return;
  state.limitUp.autoRefreshPausedBySchedule = false;
  if (immediate) limitUpFetch();
  state.limitUp.timer = setInterval(() => {
    limitUpFetch();
  }, interval);
}

function stopLimitUpTimer({ abort = true } = {}) {
  if (state.limitUp.timer) {
    clearInterval(state.limitUp.timer);
    state.limitUp.timer = null;
  }
  if (abort && state.limitUp.abort) {
    try { state.limitUp.abort.abort(); } catch { /* ignore */ }
    state.limitUp.abort = null;
  }
}

function handleLimitUpRefreshChange(newIntervalMs) {
  state.limitUp.refreshInterval = newIntervalMs;
  patchLimitUpSettings({ refreshInterval: newIntervalMs });
  if (state.limitUp.autoRefreshEnabled) startLimitUpTimer({ immediate: false });
}

function handleLimitUpAutoRefreshToggle(enabled) {
  state.limitUp.autoRefreshEnabled = !!enabled;
  if (enabled) startLimitUpTimer();
  else {
    stopLimitUpTimer();
    state.limitUp.autoRefreshPausedBySchedule = false;
  }
  rerenderLimitUpPage();
}

function handleLimitUpAddAndNavigate(code) {
  if (!code) return;
  const wasInList = state.watchList.includes(code);
  addToWatchList(code);
  state.watchList = getWatchList();
  flashInfo(wasInList ? `已在监控列表：${code}` : `已加入监控：${code}`);
  navigate('#/');
  refreshNow();
  renderData();
}

function handleLimitUpSortChange(key) {
  const allowed = ['count', 'pct', 'time', 'amount', 'price', 'open', 'volumeRatio', 'break'];
  if (!allowed.includes(key)) return;
  state.limitUp.sortKey = key;
  state.limitUp.groups = buildLimitUpGroupsForState();
  rerenderLimitUpPage();
}

function handleLimitUpGroupSort(groupKey, key) {
  const allowed = ['count', 'pct', 'time', 'amount', 'price', 'open', 'volumeRatio', 'break'];
  if (!groupKey || !allowed.includes(key)) return;
  const current = (state.limitUp.groupSort && state.limitUp.groupSort[groupKey]) || null;
  const direction = current && current.key === key && current.direction === 'desc' ? 'asc' : 'desc';
  state.limitUp.groupSort = {
    ...(state.limitUp.groupSort || {}),
    [groupKey]: { key, direction }
  };
  state.limitUp.groups = buildLimitUpGroupsForState();
  rerenderLimitUpPage();
}

function handleLimitUpPinToggle(code) {
  if (!code) return;
  const pins = new Set(state.limitUp.pinnedCodes || []);
  if (pins.has(code)) pins.delete(code);
  else pins.add(code);
  state.limitUp.pinnedCodes = pins;
  setLimitUpPinnedCodes([...pins]);
  rerenderLimitUpPage();
}

function handleLimitUpToggleSelect(code, checked) {
  if (!code) return;
  if (checked) state.limitUp.selectedCodes.add(code);
  else state.limitUp.selectedCodes.delete(code);
  rerenderLimitUpPage();
}

function handleLimitUpSelectAll() {
  state.limitUp.selectedCodes = new Set(state.limitUp.items.map((it) => it.code));
  rerenderLimitUpPage();
}

function handleLimitUpSelectNone() {
  state.limitUp.selectedCodes = new Set();
  rerenderLimitUpPage();
}

function handleLimitUpAddSelectedAndNavigate() {
  const codes = state.limitUp.selectedCodes;
  if (!codes || !codes.size) return;
  let added = 0;
  for (const code of codes) {
    if (!state.watchList.includes(code)) {
      addToWatchList(code);
      added++;
    }
  }
  state.watchList = getWatchList();
  state.limitUp.selectedCodes = new Set();
  flashInfo(added > 0 ? `已加入监控 ${added} 只` : `已选标的已在监控列表`);
  navigate('#/');
  refreshNow();
  renderData();
}

function handleLimitUpOpenKline(code) {
  if (!code) return;
  if (state.limitUp.expandedCodes.has(code)) {
    // 关闭该 chart
    closeLimitUpChart(code);
    return;
  }
  state.limitUp.expandedCodes.add(code);
  state.limitUp.chartInstances.set(code, createChartState(DEFAULT_PERIOD));
  rerenderLimitUpPage();
  loadLimitUpKline(code);
}

function closeLimitUpChart(code) {
  if (!code || !state.limitUp.expandedCodes.has(code)) return;
  state.limitUp.expandedCodes.delete(code);
  const inst = state.limitUp.chartInstances.get(code);
  if (inst) {
    if (inst.abort) try { inst.abort.abort(); } catch { /* ignore */ }
    if (inst.intradayAbort) try { inst.intradayAbort.abort(); } catch { /* ignore */ }
    const ctl = limitUpChartCtlMap.get(code);
    if (ctl) {
      try { ctl.destroy(); } catch { /* ignore */ }
    }
    limitUpChartCtlMap.delete(code);
    const intradayCtl = limitUpIntradayChartCtlMap.get(code);
    if (intradayCtl) {
      try { intradayCtl.destroy(); } catch { /* ignore */ }
    }
    limitUpIntradayChartCtlMap.delete(code);
  }
  state.limitUp.chartInstances.delete(code);
  rerenderLimitUpPage();
}

function closeAllLimitUpCharts() {
  for (const code of [...state.limitUp.expandedCodes]) {
    closeLimitUpChart(code);
  }
}

// cb 兼容入口: 接受 (code) 或 () 关闭所有
function handleLimitUpCloseKline(code) {
  if (code) {
    closeLimitUpChart(code);
  } else {
    closeAllLimitUpCharts();
  }
}

function handleLimitUpKlinePeriodChange(p, code) {
  if (!isValidPeriod(p)) return;
  const inst = state.limitUp.chartInstances.get(code);
  if (!inst || inst.period === p) return;
  inst.period = p;
  inst.klineData = null;
  inst.loading = true;
  inst.error = null;
  inst.intradayData = null;
  inst.intradayError = null;
  inst._visibleRange = null;
  inst._intradayVisibleRange = null;
  if (inst.abort) try { inst.abort.abort(); } catch { /* ignore */ }
  rerenderLimitUpPage();
  loadLimitUpKline(code);
}

// Phase 8: 强制重新加载（涨停页）— 跳过 cache 直接 fetch
function _handleLimitUpForceReloadChart(code) {
  if (!code) return;
  const inst = state.limitUp.chartInstances.get(code);
  if (!inst) return;
  inst.klineData = null;
  inst.loading = true;
  inst.error = null;
  inst._visibleRange = null;
  inst._intradayVisibleRange = null;
  if (inst.abort) try { inst.abort.abort(); } catch { /* ignore */ }
  rerenderLimitUpPage();
  loadLimitUpKline(code);
}

function _destroyLimitUpChart(code) {
  limitUpChartMgr.destroyCharts(code, { abort: false });
}

function mountLimitUpChart(code) {
  limitUpChartMgr.mountCharts(code);
}


function applyLimitUpLiveTickToChart(code, quoteOrPrice) {
  limitUpChartMgr.applyLiveTick(code, quoteOrPrice);
}

function loadLimitUpKline(code) {
  limitUpChartMgr.loadKline(code);
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

  state.voice = { ...state.voice, enabled: !!checked };
  patchVoiceSettings({ enabled: state.voice.enabled });
  if (state.voice.enabled) {
    startVoiceTimer();
    // Immediate first broadcast so the user gets instant feedback (the worker's
    // setInterval would otherwise delay first tick by `interval` ms). Also
    // captures this click as a user gesture for browsers that gate speech on
    // gesture activation.
    speakSubscribed();
  } else {
    stopVoiceTimer();
    ttsCancel();
  }
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
  for (const code of state.subscribed) {
    const q = state.quotes.get(code);
    if (q && Number.isFinite(Number(q.changePercent))) { target = q; break; }
  }
  if (!target) {
    flashError('订阅的标的暂无报价，请稍后再试');
    return;
  }
  const direction = Number(target.changePercent) >= 0 ? 'up' : 'down';
  const message = formatQuoteSpeech(target, state.voice.fields) ||
    `${target.name || target.code} ${direction === 'up' ? '涨' : '跌'} ${Math.abs(Number(target.changePercent)).toFixed(2)}%`;
  if (isSpeechSupported()) {
    const volume = clampVolume(state.voice.volume) / 100;
    ttsSpeak(message, { volume });
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
}

async function warmTradeCalendar() {
  try {
    const dates = await fetchTradeCalendar();
    state.tradingDates = dates;
    state.limitUp.tradingDates = dates;
    refreshLimitUpDateMeta();
    return dates;
  } catch {
    return state.tradingDates || state.limitUp.tradingDates || [];
  }
}

function getVoiceSession() {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  return getMarketSession(new Date(), dates);
}

function getDataRefreshSession() {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  return getMarketSession(new Date(), dates);
}

function isDataAutoRefreshAllowedNow() {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  const hasFutures = (state.watchList || []).some(isFutureCode) ||
    (state.chartRowManager && [...state.chartRowManager.rows.values()].some((r) => isFutureCode(r.code)));
  if (hasFutures && isFuturesMarketOpen(new Date(), dates)) {
    return true;
  }
  const session = getDataRefreshSession();
  state.dataLastSession = session;
  return isAutoRefreshAllowedInSession(session, DATA_REFRESH_SCHEDULE);
}

function isVoiceAllowedNow() {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  const hasSubscribedFutures = [...(state.subscribed || [])].some(isFutureCode);
  if (hasSubscribedFutures && isFuturesMarketOpen(new Date(), dates)) {
    return true;
  }
  const smart = state.voice.smartSchedule || DEFAULT_SMART_SCHEDULE;
  const session = getVoiceSession();
  return isVoiceAllowedInSession(session, smart);
}

function speakSubscribed() {
  if (!isSpeechSupported()) return;
  if (!isVoiceAllowedNow()) {
    state.voicePausedBySchedule = !!(state.voice.smartSchedule && state.voice.smartSchedule.enabled);
    renderStatus();
    return;
  }
  state.voicePausedBySchedule = false;
  if (!state.subscribed.size) return;
  const volume = clampVolume(state.voice.volume) / 100;
  const fields = state.voice.fields;
  const fieldsOrder = state.voice.fieldsOrder;
  for (const code of state.subscribed) {
    const q = state.quotes.get(code);
    if (!q) continue;
    const text = formatQuoteSpeech(q, fields, fieldsOrder);
    if (text) ttsSpeak(text, { volume });
  }
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
    if (isSpeechSupported()) ttsSpeak(item.message, { volume });
    if (isNotificationSupported() && state.notifPermission === 'granted') {
      showNotification('价格提醒', item.message);
    }
  }
}

function startVoiceTimer() {
  stopVoiceTimer();
  if (!state.voice.enabled || !state.voice.interval) return;
  if (!isVoiceAllowedNow()) {
    state.voicePausedBySchedule = !!(state.voice.smartSchedule && state.voice.smartSchedule.enabled);
    renderStatus();
    return;
  }
  state.voicePausedBySchedule = false;
  const interval = state.voice.interval;
  // Try Web Worker for accurate background ticking (main-thread setInterval is
  // throttled to >=1s when the tab is backgrounded).
  try {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data && e.data.type === 'tick') speakSubscribed();
    };
    worker.onerror = () => {
      // Worker bootstrap failed at runtime; degrade silently to main-thread interval.
      stopVoiceTimer();
      state.tickFallback = setInterval(speakSubscribed, interval);
    };
    worker.postMessage({ type: 'start', interval });
    state.tickWorker = worker;
  } catch {
    state.tickFallback = setInterval(speakSubscribed, interval);
  }
}

function stopVoiceTimer() {
  if (state.tickWorker) {
    try {
      state.tickWorker.postMessage({ type: 'stop' });
      state.tickWorker.terminate();
    } catch {
      /* ignore */
    }
    state.tickWorker = null;
  }
  if (state.tickFallback) {
    clearInterval(state.tickFallback);
    state.tickFallback = null;
  }
}

function restartVoiceTimer() {
  stopVoiceTimer();
  startVoiceTimer();
}

function applyVoiceSchedule() {
  const smart = state.voice.smartSchedule || DEFAULT_SMART_SCHEDULE;
  if (!smart.enabled) {
    state.voicePausedBySchedule = false;
    if (state.voice.enabled && !state.tickWorker && !state.tickFallback) startVoiceTimer();
    renderStatus();
    return;
  }
  const session = getVoiceSession();
  state.voiceLastSession = session;
  const allowed = isVoiceAllowedInSession(session, smart);

  if (state.voice.enabled && !allowed) {
    stopVoiceTimer();
    ttsCancel();
    state.voicePausedBySchedule = session === 'lunch' || session === 'pre-open' || session === 'closed';
    if (session === 'after-close' && smart.autoStopAfterClose) {
      state.voice = { ...state.voice, enabled: false };
      patchVoiceSettings({ enabled: false });
      state.voicePausedBySchedule = false;
      renderVoiceBar();
    }
    renderStatus();
    return;
  }

  if (!state.voice.enabled && smart.autoStartAuction && session === 'opening-auction') {
    state.voice = { ...state.voice, enabled: true };
    patchVoiceSettings({ enabled: true });
    state.voicePausedBySchedule = false;
    renderVoiceBar();
    startVoiceTimer();
    renderStatus();
    return;
  }

  if (state.voice.enabled && allowed) {
    state.voicePausedBySchedule = false;
    if (!state.tickWorker && !state.tickFallback) startVoiceTimer();
  }
  renderStatus();
}

function startVoiceScheduleChecker() {
  if (state.voiceScheduleTimer) clearInterval(state.voiceScheduleTimer);
  warmTradeCalendar().finally(() => applyVoiceSchedule());
  state.voiceScheduleTimer = setInterval(() => {
    applyVoiceSchedule();
  }, 30000);
}

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
  if (
    !inst ||
    inst.intradayRefreshing ||
    !isLiveTradeDate(inst.selectedTradeDate, isFutureCode(code)) ||
    Date.now() - inst.intradayLastFetchAt < 10000
  ) return;
  inst.intradayRefreshing = true;
  try {
    const data = await fetchIntraday(code, {
      date: inst.selectedTradeDate,
      name: inst.klineData ? inst.klineData.name : code,
      prevClose: getPrevCloseForDate(inst.klineData && inst.klineData.items, inst.selectedTradeDate),
      allowLatestTickSource: true,
      sharedCache: true
    });
    if (!data || !mgr.isExpanded(code)) return;
    inst.intradayData = data;
    inst.intradayLastFetchAt = Date.now();
    const intradayCtl = mgr.intradayCtlMap.get(code);
    if (intradayCtl) {
      intradayCtl.setData(data.items);
      restoreRangeOrFit(intradayCtl, inst._intradayVisibleRange);
      mgr.updateIntradayStatus(code);
    }
  } catch (e) {
    // Keep the latest live-quote point visible when a background backfill fails.
    if (console && console.warn) console.warn('intraday background refresh failed for', code, e);
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

function flashError(msg) {
  state.error = msg;
  renderStatus();
  showToast(msg, 'error');
  if (typeof document !== 'undefined') {
    const input = document.getElementById('code-input');
    if (input) {
      input.classList.add('input-shake');
      setTimeout(() => input.classList.remove('input-shake'), 600);
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

async function refreshNow() {
  const refreshCodes = getRefreshCodes();
  if (!refreshCodes.length) return;
  if (abortController) {
    try { abortController.abort(); } catch { /* ignore */ }
  }
  const seq = (state.refreshSeq || 0) + 1;
  state.refreshSeq = seq;
  abortController = new AbortController();
  state.loading = true;
  state.error = null;
  renderStatus();
  try {
    const quotes = await fetchQuotes(refreshCodes, { signal: abortController.signal });
    if (seq !== state.refreshSeq) return;
    for (const q of quotes) {
      state.quotes.set(q.code, q);
    }
    mergeQuotesIntoMomentumItems();
    state.lastUpdate = new Date();
    // Fire alert pipeline AFTER quotes are updated so triggers see fresh data.
    try {
      processAlerts();
    } catch (e) {
      // Never let alert errors break the data refresh cycle.
      console && console.warn && console.warn('processAlerts failed:', e);
    }
    // Advance all open K-line charts to the latest tick so the in-progress
    // bar moves in real time. Wrapped in try/catch like processAlerts so it
    // never breaks the data refresh cycle.
    try {
      updateChartLastTickMulti();
    } catch (e) {
      console && console.warn && console.warn('updateChartLastTickMulti failed:', e);
    }
  } catch (err) {
    if (seq === state.refreshSeq && err.name !== 'AbortError') {
      state.error = err.message || String(err);
    }
  } finally {
    if (seq === state.refreshSeq) {
      state.loading = false;
      // Refresh path must NOT rebuild the table. renderTable() destroys all
      // chart instances to handle structural changes (add/remove/expand), but
      // on a periodic data refresh the row set is unchanged — we'd be throwing
      // away the chart ctl and the user's zoom/pan state every 10s. Instead
      // patch the price/change/percent cells in place and refresh the status
      // bar. The chart's last bar is already updated by
      // updateChartLastTickMulti above via series.update() (preserves zoom).
      for (const code of state.watchList) {
        if (state.quotes.has(code)) updateRowQuoteCells(code);
      }
      for (const item of state.momentum.items || []) {
        if (item && state.quotes.has(item.code)) updateMomentumQuoteCells(item.code);
      }
      renderStatus();
    }
  }
}

function getRefreshCodes() {
  const out = new Set(state.watchList);
  for (const code of state.subscribed || []) {
    if (code) out.add(code);
  }
  return [...out];
}

// Patch the data cells of an existing
// <tr data-code="..."> in place. The row's <td> order is fixed by renderRow():
// [check, sub, code, name, price, percent, openPct, volumeRatio, amount, op].
// We update cells 3..8 (0-indexed). The checkbox/sub-checkbox/op cells and
// the chart-row below are left untouched — those only need rebuilding on
// structural changes (add/remove/expand/period-change).
function updateRowQuoteCells(code) {
  const row = document.querySelector(`#watch-tbody tr[data-code="${code}"]`);
  if (!row) return;
  const q = state.quotes.get(code);
  if (!q) return;
  const allCells = row.querySelectorAll('td');
  if (allCells.length < 9) return;
  const dir = priceDirection(Number(q.changePercent));
  const isFuture = q.type === 'future' || isFutureCode(code);
  const priceDecimals = isFuture && q.priceTick && q.priceTick < 0.01 ? 3 : 2;

  const getCell = (field, fallbackIndex) => row.querySelector(`td[data-field="${field}"]`) || allCells[fallbackIndex];

  const nameCell = getCell('name', 3);
  if (nameCell) nameCell.textContent = q.name || '...';

  const priceCell = getCell('price', 4);
  if (priceCell) {
    priceCell.textContent = formatNumber(q.price, priceDecimals);
    priceCell.className = `num ${dir}`;
  }

  const percentCell = getCell('percent', 5);
  if (percentCell) {
    percentCell.textContent = formatPercent(q.changePercent);
    percentCell.className = `num ${dir}`;
  }

  const openCell = getCell('open', 6);
  if (openCell) openCell.textContent = formatPriceWithPercent(q.open, q.openChangePercent);

  const volCell = getCell('volume', 7);
  if (volCell) volCell.textContent = isFuture ? (q.volume ? `${Math.round(q.volume).toLocaleString('en-US')}` : '-') : formatNumber(q.volumeRatio);

  const amtCell = getCell('amount', 8);
  if (amtCell) amtCell.textContent = isFuture ? (q.openInterest ? `持仓 ${Math.round(q.openInterest).toLocaleString('en-US')}` : '-') : formatAmount(q.amount);
}

function mergeQuotesIntoMomentumItems() {
  if (!Array.isArray(state.momentum.items) || !state.momentum.items.length) return false;
  let changed = false;
  state.momentum.items = state.momentum.items.map((it) => {
    if (!it || !it.code) return it;
    const q = state.quotes.get(it.code);
    if (!q) return it;
    changed = true;
    const price = Number.isFinite(Number(q.price)) ? Number(q.price) : it.price;
    const startClose = Number(it.startClose);
    const gainPercent = (Number.isFinite(price) && Number.isFinite(startClose) && startClose > 0)
      ? Number((((price - startClose) / startClose) * 100).toFixed(2))
      : it.gainPercent;
    return {
      ...it,
      name: q.name || it.name,
      price,
      gainPercent,
      changePercent: Number.isFinite(Number(q.changePercent)) ? Number(q.changePercent) : it.changePercent,
      amount: Number.isFinite(Number(q.amount)) ? Number(q.amount) : it.amount,
      volumeRatio: Number.isFinite(Number(q.volumeRatio)) ? Number(q.volumeRatio) : it.volumeRatio,
      industry: it.industry || q.industry || ''
    };
  });
  return changed;
}

function updateMomentumQuoteCells(code) {
  updateMomentumQuoteCellsView(code, state.momentum.items || []);
}

function restartTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (!state.autoRefreshEnabled) {
    state.autoRefreshPausedBySchedule = false;
    renderStatus();
    return;
  }
  if (!isDataAutoRefreshAllowedNow()) {
    state.autoRefreshPausedBySchedule = true;
    renderStatus();
    return;
  }
  state.autoRefreshPausedBySchedule = false;
  state.timer = setInterval(refreshNow, state.refreshInterval);
}

function stopMonitorTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

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

  if (state.autoRefreshEnabled && !limitUpRootEl) {
    if (!allowed) {
      stopMonitorTimer();
      state.autoRefreshPausedBySchedule = true;
    } else {
      const wasPaused = state.autoRefreshPausedBySchedule;
      state.autoRefreshPausedBySchedule = false;
      if (!state.timer) {
        state.timer = setInterval(refreshNow, state.refreshInterval);
        if (wasPaused) refreshNow();
      }
    }
  } else {
    stopMonitorTimer();
    if (!limitUpRootEl) state.autoRefreshPausedBySchedule = false;
  }

  if (state.limitUp.autoRefreshEnabled && limitUpRootEl) {
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
    if (limitUpRootEl) state.limitUp.autoRefreshPausedBySchedule = false;
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
  if (state.dataScheduleTimer) clearInterval(state.dataScheduleTimer);
  warmTradeCalendar().finally(() => applyDataRefreshSchedule());
  state.dataScheduleTimer = setInterval(() => {
    applyDataRefreshSchedule();
  }, 30000);
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
  const router = createHashRouter(
    {
      '#/': (r) => {
        stopLimitUpTimer();
        closeAllLimitUpCharts();
        // Race fix: an in-flight limitUpFetch() may resolve after this handler
        // returns. Clear limitUpRootEl BEFORE renderMonitorPage so the
        // fetch's finally-block rerender is a no-op.
        limitUpRootEl = null;
        renderMonitorPage(r);
        applyDataRefreshSchedule();
      },
      '#/limit-up': (r) => {
        stopMonitorTimer();
        closeAllCharts();
        limitUpRootEl = r;
        renderLimitUpPage(r, state.limitUp, {
          navigateTo: (path) => navigate(path),
          addToWatchListAndNavigate: handleLimitUpAddAndNavigate,
          onRefreshChange: handleLimitUpRefreshChange,
          fetchList: fetchLimitUpListNow,
          onLiveTickUpdate: applyLiveTicksToLimitUp,
          onSortChange: handleLimitUpSortChange,
          sortGroup: handleLimitUpGroupSort,
          toggleAutoRefresh: handleLimitUpAutoRefreshToggle,
          togglePin: handleLimitUpPinToggle,
          toggleSelect: handleLimitUpToggleSelect,
          selectAll: handleLimitUpSelectAll,
          selectNone: handleLimitUpSelectNone,
          addSelectedAndNavigate: handleLimitUpAddSelectedAndNavigate,
          openKline: handleLimitUpOpenKline,
          closeKline: handleLimitUpCloseKline,
          changeKlinePeriod: handleLimitUpKlinePeriodChange,
          onDateChange: handleLimitUpDateChange,
          reloadKline: _handleLimitUpForceReloadChart
        });
        limitUpFetch();
        applyDataRefreshSchedule();
      }
    },
    '#/',
    root
  );
  router.start();
}

export function stopApp() {
  if (typeof state.unsubKlineUpdated === 'function') {
    state.unsubKlineUpdated();
    state.unsubKlineUpdated = null;
  }
  stopMonitorTimer();
  stopLimitUpTimer();
  if (state.voiceTimer) {
    clearInterval(state.voiceTimer);
    state.voiceTimer = null;
  }
  if (state.voiceScheduleTimer) {
    clearInterval(state.voiceScheduleTimer);
    state.voiceScheduleTimer = null;
  }
  if (state.dataScheduleTimer) {
    clearInterval(state.dataScheduleTimer);
    state.dataScheduleTimer = null;
  }
  if (state.tickWorker) {
    try { state.tickWorker.terminate(); } catch { /* ignore */ }
    state.tickWorker = null;
  }
  closeAllCharts();
  closeAllLimitUpCharts();
}

export function _internal() {
  return { state, chartInstanceMap, get limitUpRootEl() { return limitUpRootEl; } };
}
