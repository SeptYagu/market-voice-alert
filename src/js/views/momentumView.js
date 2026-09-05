// 10 日强势股视图组件与语义化单元格 Patch

import {
  formatNumber,
  formatPercent,
  formatAmount,
  priceDirection,
  intradaySourceLabel
} from '../format.js';
import { PERIODS, PERIOD_LABELS } from '../kline.js';
import { chartTimeToDate } from '../time.js';

export const MOMENTUM_LOOKBACK_TRADING_DAYS = 10;
export const MOMENTUM_THRESHOLD_PCT = 45;

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'on' && typeof v === 'object') {
      for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
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

export function computeTenDayMomentum(klineData, lookbackDays = MOMENTUM_LOOKBACK_TRADING_DAYS) {
  const items = klineData && Array.isArray(klineData.items) ? klineData.items : [];
  if (items.length < 2) return null;
  const last = items[items.length - 1];
  const startIndex = Math.max(0, items.length - 1 - Math.max(1, Number(lookbackDays) || MOMENTUM_LOOKBACK_TRADING_DAYS));
  const start = items[startIndex];
  const startClose = Number(start && start.close);
  const lastClose = Number(last && last.close);
  if (!Number.isFinite(startClose) || !Number.isFinite(lastClose) || startClose <= 0 || lastClose <= 0) return null;
  return {
    gainPercent: (lastClose / startClose - 1) * 100,
    startClose,
    lastClose,
    startDate: chartTimeToDate(start.time),
    endDate: chartTimeToDate(last.time)
  };
}

export function sortMomentumItems(items, pinnedCodes = new Set()) {
  const pins = pinnedCodes || new Set();
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const ap = pins.has(a.code) ? 1 : 0;
    const bp = pins.has(b.code) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ag = Number(a.gainPercent) || 0;
    const bg = Number(b.gainPercent) || 0;
    if (ag !== bg) return bg - ag;
    const aa = Number(a.amount) || 0;
    const ba = Number(b.amount) || 0;
    if (aa !== ba) return ba - aa;
    return String(a.code || '').localeCompare(String(b.code || ''));
  });
}

export function getMomentumReasonText(item) {
  if (!item) return '-';
  return item.reason || item.limitStats || item.anomaly || `10日涨幅${formatPercent(item.gainPercent)}`;
}

export function buildMomentumHeaderCheckbox(items, selectedCodes, onSelectChange) {
  const codes = (items || []).map((it) => it.code).filter(Boolean);
  const selectedCount = codes.filter((code) => selectedCodes && selectedCodes.has(code)).length;
  const input = el('input', {
    type: 'checkbox',
    id: 'momentum-select-all',
    title: '全选/取消全选强势股',
    checked: codes.length > 0 && selectedCount === codes.length,
    on: {
      click: (e) => e.stopPropagation(),
      change: (e) => {
        if (onSelectChange) onSelectChange(e.target.checked, codes);
      }
    }
  });
  input.indeterminate = selectedCount > 0 && selectedCount < codes.length;
  return input;
}

export function renderMomentumChartRow(item, colCount, ctx) {
  const {
    momentumState,
    defaultPeriod = '1d',
    onPeriodChange,
    onForceReload,
    onCloseChart
  } = ctx;

  const inst = momentumState.chartInstances && momentumState.chartInstances.get(item.code);
  const period = (inst && inst.period) || defaultPeriod;
  const tabs = el('div', { class: 'period-tabs' });
  for (const [p, label] of Object.entries(PERIOD_LABELS)) {
    if (!PERIODS[p]) continue;
    const btn = el(
      'button',
      {
        class: p === period ? 'active' : '',
        on: { click: () => onPeriodChange && onPeriodChange(item.code, p) }
      },
      label
    );
    tabs.appendChild(btn);
  }

  const reloadBtn = el(
    'button',
    {
      class: 'btn-reload-chart',
      title: '从网络强制重新拉取',
      on: { click: () => onForceReload && onForceReload(item.code) }
    },
    '⟳ 刷新'
  );

  const closeBtn = el(
    'button',
    {
      class: 'btn-close-chart',
      title: '关闭图表',
      'aria-label': `关闭 ${item.name || item.code} 图表`,
      on: { click: () => onCloseChart && onCloseChart(item.code) }
    },
    '✕'
  );

  const title = el(
    'span',
    { class: 'chart-inline-title' },
    el('strong', {}, item.name || item.code),
    el('span', { class: 'chart-inline-code' }, item.code),
    el('span', { class: 'momentum-reason-pill' }, getMomentumReasonText(item))
  );

  const header = el(
    'div',
    { class: 'chart-inline-header' },
    title,
    tabs,
    reloadBtn,
    closeBtn
  );

  const status = el('div', { class: 'chart-status', id: `chart-status-momentum-${item.code}` });
  const intradayStatus = el('div', { class: 'chart-status', id: `chart-status-momentum-intraday-${item.code}` });
  const statusParts = [];
  if (inst && inst.loading) statusParts.push('图表加载中...');
  if (inst && inst.error) statusParts.push(`错误: ${inst.error}`);
  if (inst && inst.klineData && !inst.loading && !inst.error) {
    statusParts.push(`${PERIOD_LABELS[period] || period} · ${inst.klineData.items.length} 根`);
  }
  status.textContent = statusParts.join(' · ');
  if (inst && inst.error) status.className = 'chart-status has-error';

  const intradayParts = [];
  if (inst && inst.intradayLoading) intradayParts.push('分时加载中...');
  if (inst && inst.intradayError) intradayParts.push(`分时错误: ${inst.intradayError}`);
  if (inst && inst.intradayData && Array.isArray(inst.intradayData.items) && inst.intradayData.items.length) {
    const items = inst.intradayData.items;
    const last = items[items.length - 1] || {};
    const source = intradaySourceLabel(inst.intradayData.source);
    const summary = [`${inst.selectedTradeDate || ''} · ${items.length} 点`];
    if (Number.isFinite(Number(last.close))) summary.push(formatNumber(last.close));
    if (Number.isFinite(Number(last.percent))) summary.push(formatPercent(last.percent));
    if (source) summary.push(source);
    intradayParts.push(summary.join(' · '));
  } else if (!inst || (!inst.intradayLoading && !inst.intradayError)) {
    intradayParts.push(inst && inst.selectedTradeDate ? `${inst.selectedTradeDate} · 暂无分时` : '点击右侧日K查看分时');
  }
  intradayStatus.textContent = intradayParts.join(' · ');
  if (inst && inst.intradayError) intradayStatus.className = 'chart-status has-error';

  const intradayHost = el('div', { class: 'chart-host', id: `chart-host-momentum-intraday-${item.code}` });
  const host = el('div', { class: 'chart-host', id: `chart-host-momentum-${item.code}` });
  const split = el(
    'div',
    { class: 'chart-split' },
    el('section', { class: 'chart-pane chart-pane-intraday' },
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
    el('section', { class: 'chart-pane chart-pane-kline' },
      el('div', { class: 'chart-pane-title' }, 'K线图'),
      status,
      host
    )
  );

  const td = el('td', { colspan: String(colCount), class: 'chart-td' }, header, split);
  return el('tr', { class: 'chart-row momentum-chart-row', 'data-chart-for': item.code }, td);
}

export function updateMomentumQuoteCells(code, momentumItems = []) {
  const row = document.querySelector(`tr[data-momentum-code="${code}"]`);
  if (!row) return;
  const item = (momentumItems || []).find((it) => it && it.code === code);
  if (!item) return;
  const allCells = row.querySelectorAll('td');
  if (allCells.length < 11) return;
  const dir = priceDirection(Number(item.changePercent));

  const getCell = (field, fallbackIndex) =>
    row.querySelector(`td[data-field="${field}"]`) || allCells[fallbackIndex];

  const nameCell = getCell('name', 4);
  if (nameCell) nameCell.textContent = item.name || '-';

  const gainCell = getCell('gain', 5);
  if (gainCell) gainCell.textContent = formatPercent(item.gainPercent);

  const priceCell = getCell('price', 6);
  if (priceCell) priceCell.textContent = formatNumber(item.price);

  const percentCell = getCell('percent', 7);
  if (percentCell) {
    percentCell.textContent = formatPercent(item.changePercent);
    percentCell.className = `num ${dir}`;
  }

  const amountCell = getCell('amount', 8);
  if (amountCell) amountCell.textContent = formatAmount(item.amount);

  const industryCell = getCell('industry', 9);
  if (industryCell) industryCell.textContent = item.industry || '-';
}
