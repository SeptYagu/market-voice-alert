// 监控列表表格视图组件与语义化单元格 Patch
import {
  formatNumber,
  formatPercent,
  formatAmount,
  formatPriceWithPercent,
  priceDirection
} from '../format.js';
import { PERIODS, PERIOD_LABELS } from '../kline.js';
import { isFutureCode } from '../futures/instrument.js';

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

export function buildWatchHeaderCheckbox(watchList = [], selectedSet = new Set(), onSelectAll, onSelectNone) {
  const total = (watchList || []).length;
  const checkedCount = [...(selectedSet || [])].filter((code) => watchList.includes(code)).length;
  const input = el('input', {
    type: 'checkbox',
    id: 'watch-select-all',
    title: '全选/取消全选',
    checked: total > 0 && checkedCount === total,
    on: {
      click: (e) => e.stopPropagation(),
      change: (e) => {
        if (e.target.checked) {
          if (onSelectAll) onSelectAll();
        } else {
          if (onSelectNone) onSelectNone();
        }
      }
    }
  });
  input.indeterminate = checkedCount > 0 && checkedCount < total;
  return input;
}

export function updateWatchHeaderCheckbox(watchList = [], selectedSet = new Set()) {
  const input = document.getElementById('watch-select-all');
  if (!input) return;
  const total = (watchList || []).length;
  const checkedCount = [...(selectedSet || [])].filter((code) => watchList.includes(code)).length;
  input.checked = total > 0 && checkedCount === total;
  input.indeterminate = checkedCount > 0 && checkedCount < total;
}

export function renderRow(code, isActive, options = {}) {
  const {
    quotesMap,
    selectedSet = new Set(),
    subscribedSet = new Set(),
    callbacks = {}
  } = options;

  const q = (quotesMap && typeof quotesMap.get === 'function' ? quotesMap.get(code) : null) || { code };
  const dir = priceDirection(Number(q.changePercent));
  const checkbox = el('input', {
    type: 'checkbox',
    'data-code': code,
    checked: selectedSet.has(code),
    on: {
      change: (e) => callbacks.onToggleSelect && callbacks.onToggleSelect(code, e.target.checked),
      click: (e) => e.stopPropagation()
    }
  });
  const subCheckbox = el('input', {
    type: 'checkbox',
    'data-code-sub': code,
    title: '订阅播报/提醒',
    checked: subscribedSet.has(code),
    on: {
      change: (e) => callbacks.onToggleSubscribe && callbacks.onToggleSubscribe(code, e.target.checked),
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
        click: (e) => callbacks.onRowClick && callbacks.onRowClick(code, e),
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return;
            e.preventDefault();
            if (callbacks.onRowClick) callbacks.onRowClick(code, e);
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
              if (callbacks.onRemove) callbacks.onRemove(code);
            }
          }
        },
        '删除'
      )
    )
  );
}

export function renderInlineChartRow(code, options = {}) {
  const {
    chartInstances,
    quotesMap,
    callbacks = {}
  } = options;

  const inst = chartInstances && chartInstances.get(code);
  if (!inst) {
    return el('tr', { 'data-empty-for': code, class: 'chart-row' });
  }
  const q = (quotesMap && typeof quotesMap.get === 'function' ? quotesMap.get(code) : null) || {};
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
      on: {
        click: (e) => {
          e.stopPropagation();
          if (callbacks.onForceReload) callbacks.onForceReload(code);
        }
      }
    }, '🔄 重新加载'),
    el('button', {
      class: 'chart-close',
      title: '关闭',
      on: {
        click: (e) => {
          e.stopPropagation();
          if (callbacks.onCloseChart) callbacks.onCloseChart(code);
        }
      }
    }, '× 关闭')
  );

  const tabs = el('div', { class: 'period-tabs' });
  for (const p of Object.keys(PERIODS)) {
    tabs.appendChild(el('button', {
      class: 'period-tab' + (p === inst.period ? ' active' : ''),
      'data-period': p,
      on: {
        click: (e) => {
          e.stopPropagation();
          if (callbacks.onPeriodChange) callbacks.onPeriodChange(p, code);
        }
      }
    }, PERIOD_LABELS[p]));
  }

  const status = el('div', { class: 'chart-status', id: `chart-status-${code}` });
  if (callbacks.onUpdateChartStatus) callbacks.onUpdateChartStatus(code, status);

  const intradayStatus = el('div', { class: 'chart-status', id: `intraday-status-${code}` });
  if (callbacks.onUpdateIntradayStatus) callbacks.onUpdateIntradayStatus(code, intradayStatus);

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

export function renderTableView(wrap, options = {}) {
  if (!wrap) return;
  const {
    watchList = [],
    quotesMap,
    selectedSet = new Set(),
    subscribedSet = new Set(),
    expandedCodes = new Set(),
    chartInstances,
    beforeRerenderClean,
    callbacks = {}
  } = options;

  if (typeof beforeRerenderClean === 'function') {
    beforeRerenderClean();
  }

  wrap.innerHTML = '';
  if (!watchList.length) {
    wrap.appendChild(el('div', { class: 'empty' }, '空空如也。先在上方输入代码添加吧～'));
    return;
  }

  const table = el('table', { class: 'watch-table' });
  const hasFuturesInList = (watchList || []).some(isFutureCode);
  const thead = el(
    'thead',
    {},
    el(
      'tr',
      {},
      el('th', { class: 'col-check', 'data-field': 'check', title: '勾选用于批量删除/导出' },
        buildWatchHeaderCheckbox(watchList, selectedSet, callbacks.onSelectAll, callbacks.onSelectNone)
      ),
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
  for (const code of watchList) {
    const isActive = expandedCodes && expandedCodes.has(code);
    tbody.appendChild(renderRow(code, isActive, {
      quotesMap,
      selectedSet,
      subscribedSet,
      callbacks
    }));
    if (isActive) {
      tbody.appendChild(renderInlineChartRow(code, {
        chartInstances,
        quotesMap,
        callbacks
      }));
    }
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  if (typeof callbacks.onAfterMountCharts === 'function') {
    callbacks.onAfterMountCharts();
  }
}

export function updateRowQuoteCells(code, quote) {
  const row = document.querySelector(`#watch-tbody tr[data-code="${code}"]`);
  if (!row) return;
  const q = quote;
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
