// 涨停看板视图。纯渲染：传入 root + state + callbacks，输出 DOM 树。
import {
  formatNumber,
  formatAmount,
  formatPercent,
  LIMIT_UP_REFRESH_OPTIONS
} from './app.js';
import { PERIODS, PERIOD_LABELS } from './kline.js';
import { sortLimitUpGroupItems } from './limitUp.js';
import { getBeijingDate, shiftCalendarDate } from './time.js';

const SORT_LABELS = Object.freeze({
  count: '连板',
  price: '现价',
  pct: '涨幅',
  open: '开盘',
  volumeRatio: '量比',
  amount: '成交额',
  time: '最终封板',
  break: '炸板'
});

function isAutoRefreshEnabled(state) {
  return state && state.autoRefreshEnabled !== undefined ? !!state.autoRefreshEnabled : !!(state && state.timer);
}

function autoRefreshButtonText(state) {
  if (!isAutoRefreshEnabled(state)) return '开始自动刷新';
  return state.autoRefreshPausedBySchedule ? '自动刷新已暂停' : '停止自动刷新';
}

function autoRefreshButtonTitle(state) {
  if (!isAutoRefreshEnabled(state)) return '开始自动刷新';
  return state.autoRefreshPausedBySchedule ? '非交易时段，自动刷新将在开盘后恢复' : '停止自动刷新';
}

function intradaySourceLabel(source) {
  if (source === 'aktools-stock_intraday_em') return 'AKTools成交';
  if (source === 'aktools-stock_zh_a_hist_min_em') return 'AKTools分钟';
  if (source === 'eastmoney-trends2') return '东财备用';
  if (source === 'eastmoney-kline-1m') return '东财K线备用';
  return source ? String(source) : '';
}

function buildIntradayStatusParts(inst) {
  const parts = [];
  if (inst && inst.intradayLoading) parts.push('分时加载中...');
  if (inst && inst.intradayError) parts.push(`错误: ${inst.intradayError}`);
  if (
    inst &&
    inst.intradayData &&
    Array.isArray(inst.intradayData.items) &&
    inst.intradayData.items.length &&
    !inst.intradayLoading &&
    !inst.intradayError
  ) {
    const items = inst.intradayData.items;
    const last = items[items.length - 1] || {};
    const source = intradaySourceLabel(inst.intradayData.source);
    const summary = [`${inst.selectedTradeDate || ''} · ${items.length} 点`];
    if (Number.isFinite(Number(last.close))) summary.push(formatNumber(last.close));
    if (Number.isFinite(Number(last.percent))) summary.push(formatPercent(last.percent));
    if (source) summary.push(source);
    parts.push(summary.join(' · '));
  } else if (!inst || (!inst.intradayLoading && !inst.intradayError)) {
    parts.push(inst && inst.selectedTradeDate ? `${inst.selectedTradeDate} · 暂无分时` : '点击右侧日K查看分时');
  }
  return parts;
}

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

function buildRefreshSelect(state, onChange) {
  const sel = el('select', { id: 'limit-up-refresh' });
  sel.addEventListener('change', (e) => onChange(Number(e.target.value)));
  for (const opt of LIMIT_UP_REFRESH_OPTIONS) {
    const o = el('option', { value: String(opt.value) }, opt.label);
    if (opt.value === state.refreshInterval) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}

function buildSortHeader(label, sortKey, group, ctx, cls = '') {
  const sort = (ctx.groupSort && ctx.groupSort[group.key]) || { key: ctx.sortKey || 'amount', direction: 'desc' };
  const active = sort && sort.key === sortKey;
  const dir = active ? sort.direction : '';
  const suffix = active ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
  return el(
    'th',
    {
      class: `${cls} lu-sortable${active ? ' active' : ''}`.trim(),
      title: `按${label}排序`,
      on: {
        click: () => {
          if (typeof ctx.cb.sortGroup === 'function') ctx.cb.sortGroup(group.key, sortKey);
        }
      }
    },
    label + suffix
  );
}

function buildRow(item, ctx) {
  const direction = Number(item.changePercent) > 0 ? 'up' : (Number(item.changePercent) < 0 ? 'down' : 'flat');
  const isChecked = ctx.selectedCodes && ctx.selectedCodes.has(item.code);
  const isActive = ctx.expandedCodes && ctx.expandedCodes.has(item.code);
  const isPinned = ctx.pinnedCodes && ctx.pinnedCodes.has(item.code);
  const rowClasses = ['lu-row'];
  if (isActive) rowClasses.push('lu-active');
  if (isPinned) rowClasses.push('lu-pinned-row');

  const cb = el('input', {
    type: 'checkbox',
    'data-row-code': item.code,
    checked: !!isChecked,
    on: {
      click: (e) => { e.stopPropagation(); },
      change: (e) => {
        if (typeof ctx.cb.toggleSelect === 'function') {
          ctx.cb.toggleSelect(item.code, !!e.target.checked);
        }
      }
    }
  });
  const pinBtn = el(
    'button',
    {
      class: 'pin-btn' + (isPinned ? ' active' : ''),
      title: isPinned ? '取消固定' : '固定',
      on: {
        click: (e) => {
          e.stopPropagation();
          if (typeof ctx.cb.togglePin === 'function') ctx.cb.togglePin(item.code);
        }
      }
    },
    isPinned ? '取消固定' : '固定'
  );

  return el(
    'tr',
    {
      class: rowClasses.join(' '),
      'data-code': item.code,
      on: {
        click: (e) => {
          const target = e && e.target;
          if (target && target.tagName === 'INPUT') return;
          if (target && target.tagName === 'BUTTON') return;
          if (typeof ctx.cb.openKline === 'function') ctx.cb.openKline(item.code);
        }
      }
    },
    el('td', { class: 'lu-check' }, cb),
    el('td', { class: 'lu-pin' }, pinBtn),
    el('td', { class: 'lu-code' }, item.code),
    el(
      'td',
      { class: 'lu-name' },
      item.name || '-',
      item.isST ? el('span', { class: 'lu-st-badge', title: 'ST / *ST 股票' }, 'ST') : null
    ),
    el('td', { class: 'lu-count num' }, `${item.limitUpCount || 0} 板`),
    el('td', { class: 'lu-price num' }, formatNumber(item.price)),
    el('td', { class: `lu-pct num ${direction}` }, formatPercent(item.changePercent)),
    el('td', { class: 'lu-open num' }, formatNumber(item.open)),
    el('td', { class: 'lu-ratio num' }, formatNumber(item.volumeRatio)),
    el('td', { class: 'lu-amount num' }, formatAmount(item.amount)),
    el('td', { class: 'lu-final num' }, item.lastLimitTime || '-'),
    el('td', { class: 'lu-break num' }, String(item.breakCount || 0)),
    el('td', { class: 'lu-reason', title: item.interpretation || '无龙虎榜信息' }, item.reason || '—')
  );
}

function buildInlineChartRow(item, ctx) {
  const inst = ctx.chartInstances && ctx.chartInstances.get(item.code);
  const period = (inst && inst.period) || '1d';
  const tabs = el('div', { class: 'period-tabs' });
  for (const p of Object.keys(PERIODS)) {
    tabs.appendChild(el(
      'button',
      {
        class: 'lu-period-tab' + (p === period ? ' active' : ''),
        'data-period': p,
        on: { click: () => { if (typeof ctx.cb.changeKlinePeriod === 'function') ctx.cb.changeKlinePeriod(p, item.code); } }
      },
      PERIOD_LABELS[p]
    ));
  }
  const closeBtn = el(
    'button',
    {
      class: 'lu-chart-close',
      title: '关闭',
      on: { click: () => { if (typeof ctx.cb.closeKline === 'function') ctx.cb.closeKline(item.code); } }
    },
    '× 关闭'
  );
  // Phase 8: 重新加载数据按钮 (跳过 localStorage/in-memory 缓存, 强制从网络拉)
  const reloadBtn = el(
    'button',
    {
      class: 'lu-chart-reload',
      id: `lu-chart-reload-${item.code}`,
      title: '跳过缓存，从网络强制重新拉取',
      on: { click: () => { if (typeof ctx.cb.reloadKline === 'function') ctx.cb.reloadKline(item.code); } }
    },
    '🔄 重新加载'
  );
  const title = el(
    'div',
    { class: 'lu-chart-inline-title' },
    el('strong', {}, item.name || item.code),
    el('span', { class: 'lu-chart-inline-code' }, item.code)
  );
  const header = el(
    'div',
    { class: 'lu-chart-inline-header' },
    title,
    tabs,
    reloadBtn,
    closeBtn
  );
  const status = el('div', { class: 'chart-status', id: `lu-chart-status-${item.code}` });
  const intradayStatus = el('div', { class: 'chart-status', id: `lu-intraday-status-${item.code}` });
  const statusParts = [];
  if (inst && inst.loading) statusParts.push('图表加载中...');
  if (inst && inst.error) statusParts.push(`错误: ${inst.error}`);
  if (inst && inst.klineData && !inst.loading && !inst.error) {
    statusParts.push(`${PERIOD_LABELS[period] || period} · ${inst.klineData.items.length} 根`);
  }
  status.textContent = statusParts.join(' · ');
  if (inst && inst.error) status.className = 'chart-status has-error';
  const intradayParts = buildIntradayStatusParts(inst);
  intradayStatus.textContent = intradayParts.join(' · ');
  if (inst && inst.intradayError) intradayStatus.className = 'chart-status has-error';
  const intradayHost = el('div', { class: 'lu-intraday-chart-host', id: `lu-intraday-chart-host-${item.code}` });
  const host = el('div', { class: 'lu-chart-host', id: `lu-chart-host-${item.code}` });
  const split = el(
    'div',
    { class: 'chart-split lu-chart-split' },
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
  const td = el('td', { colspan: String(LU_TABLE_COLSPAN), class: 'lu-chart-td' }, header, split);
  return el('tr', { class: 'lu-chart-row', 'data-chart-for': item.code }, td);
}

function buildGroup(g, ctx) {
  const section = el('section', { class: 'lu-group', 'data-group': g.key });
  const head = el(
    'header',
    { class: 'lu-group-header' },
    el('span', { class: 'lu-group-title' }, g.label),
    el('span', { class: 'lu-group-count' }, `${g.items.length} 只`)
  );
  section.appendChild(head);
  if (g.items.length) {
    const table = el('table', { class: 'lu-table' });
    const thead = el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { class: 'lu-check' }, ''),
        el('th', { class: 'lu-pin' }, '固定'),
        el('th', { class: 'lu-code' }, '代码'),
        el('th', { class: 'lu-name' }, '名称'),
        buildSortHeader(SORT_LABELS.count, 'count', g, ctx, 'lu-count num'),
        buildSortHeader(SORT_LABELS.price, 'price', g, ctx, 'lu-price num'),
        buildSortHeader(SORT_LABELS.pct, 'pct', g, ctx, 'lu-pct num'),
        buildSortHeader(SORT_LABELS.open, 'open', g, ctx, 'lu-open num'),
        buildSortHeader(SORT_LABELS.volumeRatio, 'volumeRatio', g, ctx, 'lu-ratio num'),
        buildSortHeader(SORT_LABELS.amount, 'amount', g, ctx, 'lu-amount num'),
        buildSortHeader(SORT_LABELS.time, 'time', g, ctx, 'lu-final num'),
        buildSortHeader(SORT_LABELS.break, 'break', g, ctx, 'lu-break num'),
        el('th', { class: 'lu-reason', title: '来源: AKTools stock_lhb_detail_em，龙虎榜上榜原因，不是涨停原因' }, '龙虎榜')
      )
    );
    table.appendChild(thead);
    const tbody = el('tbody', {});
    for (const it of g.items) {
      tbody.appendChild(buildRow(it, ctx));
      if (ctx.expandedCodes && ctx.expandedCodes.has(it.code)) {
        tbody.appendChild(buildInlineChartRow(it, ctx));
      }
    }
    table.appendChild(tbody);
    section.appendChild(el('div', { class: 'lu-group-body' }, table));
  }
  return section;
}

function buildStatusLine(state) {
  const parts = [];
  const total = state.groups.reduce((s, g) => s + g.items.length, 0);
  parts.push(`共 ${total} 只涨停`);
  if (state.loading) parts.push('加载中...');
  if (state.error) parts.push(`错误: ${state.error}`);
  if (state.consecutiveEmptyFetches > 0 && state.lastNonEmptyAt) {
    const ts = state.lastNonEmptyAt.toLocaleTimeString();
    parts.push(`缓存自 ${ts} · 已空 ${state.consecutiveEmptyFetches} 次`);
  } else if (state.lastUpdate) {
    parts.push(`更新于 ${state.lastUpdate.toLocaleTimeString()}`);
  }
  return el('footer', { class: 'status-bar', id: 'lu-status' }, parts.join(' · '));
}

function totalCount(state) {
  return state.groups.reduce((s, g) => s + g.items.length, 0);
}

function buildSelectControls(state, cb) {
  const hasSel = state.selectedCodes && state.selectedCodes.size > 0;
  const counter = el('span', {
    class: 'lu-selected-count',
    id: 'lu-selected-count'
  }, `${state.selectedCodes ? state.selectedCodes.size : 0} 已选`);

  const addBtn = el(
    'button',
    {
      id: 'lu-add-selected',
      disabled: !hasSel,
      on: {
        click: () => {
          if (typeof cb.addSelectedAndNavigate === 'function') {
            cb.addSelectedAndNavigate([...(state.selectedCodes || [])]);
          }
        }
      }
    },
    '➕ 添加选中'
  );

  const selectAll = el(
    'a',
    {
      href: '#',
      class: 'lu-select-link',
      id: 'lu-select-all',
      on: {
        click: (e) => {
          e.preventDefault();
          if (typeof cb.selectAll === 'function') cb.selectAll();
        }
      }
    },
    '全选'
  );

  const selectNone = el(
    'a',
    {
      href: '#',
      class: 'lu-select-link',
      id: 'lu-select-none',
      on: {
        click: (e) => {
          e.preventDefault();
          if (typeof cb.selectNone === 'function') cb.selectNone();
        }
      }
    },
    '取消全选'
  );

  return el(
    'div',
    { class: 'lu-select-wrap' },
    selectAll,
    el('span', { class: 'lu-sep' }, '/'),
    selectNone,
    counter,
    addBtn
  );
}

function buildToolbar(state, cb) {
  return el(
    'section',
    { class: 'toolbar lu-toolbar' },
    el(
      'div',
      { class: 'lu-toolbar-row' },
      el(
        'label',
        { class: 'lu-inline' },
        el('span', { class: 'lu-inline-label' }, '日期:'),
        buildDateInput(state, (newDate) => {
          if (typeof cb.onDateChange === 'function') cb.onDateChange(newDate);
        })
      ),
      el(
        'label',
        { class: 'lu-inline' },
        el('span', { class: 'lu-inline-label' }, '刷新:'),
        buildRefreshSelect(state, (ms) => {
          if (typeof cb.onRefreshChange === 'function') cb.onRefreshChange(ms);
        })
      ),
      buildSelectControls(state, cb),
      el(
        'button',
        {
          on: {
            click: () => { if (typeof cb.fetchList === 'function') cb.fetchList(); }
          }
        },
        '⟳ 立即刷新'
      ),
      el(
        'button',
          {
            id: 'lu-auto-refresh-toggle',
          class: isAutoRefreshEnabled(state) ? 'btn-ctl-active' : '',
          title: autoRefreshButtonTitle(state),
          on: {
            click: () => {
              if (typeof cb.toggleAutoRefresh === 'function') cb.toggleAutoRefresh(!isAutoRefreshEnabled(state));
            }
          }
        },
        autoRefreshButtonText(state)
      ),
      el('span', { class: 'lu-hint' }, `共 ${totalCount(state)} 只涨停${state.selectedDate ? `（${state.selectedDate}）` : ''}`)
    )
  );
}

function buildDateInput(state, onChange) {
  const todayStr = state.latestTradingDate || getBeijingDate();
  const current = state.selectedDate || todayStr;
  const input = el('input', {
    type: 'date',
    id: 'lu-date',
    class: 'lu-date-input',
    value: current,
    max: todayStr,
    title: '非交易日会自动跳到最近一个交易日',
    on: {
      change: (e) => {
        const v = e && e.target ? e.target.value : '';
        if (typeof onChange === 'function') onChange(v || null);
      }
    }
  });
  const prevDate = state.previousTradingDate || null;
  const nextDate = state.nextTradingDate || null;
  const nextDisabled = !nextDate || current >= todayStr;
  return el('div', { class: 'lu-date-wrap' },
    el('button', {
      class: 'lu-date-shift',
      id: 'lu-date-prev',
      title: '前一个交易日',
      disabled: !prevDate,
      on: {
        click: () => {
          const shifted = prevDate || shiftDateString(current, -1);
          if (typeof onChange === 'function') onChange(shifted);
        }
      }
    }, '‹ 前一天'),
    input,
    el('button', {
      class: 'lu-date-shift',
      id: 'lu-date-next',
      title: '后一个交易日',
      disabled: nextDisabled,
      on: {
        click: () => {
          if (nextDisabled) return;
          const shifted = nextDate || shiftDateString(current, 1);
          if (typeof onChange === 'function') onChange(shifted);
        }
      }
    }, '后一天 ›'),
    el('button', {
      class: 'lu-date-today',
      id: 'lu-date-today',
      title: '回到今天',
      on: {
        click: () => {
          if (typeof onChange === 'function') onChange(todayStr);
        }
      }
    }, '今天')
  );
}

// 表头 + 图表行 colspan 必须同步
const LU_TABLE_COLSPAN = 13;

export function shiftDateString(yyyymmdd, deltaDays) {
  const base = yyyymmdd || getBeijingDate();
  return shiftCalendarDate(base, deltaDays);
}

function buildHeader() {
  return el(
    'header',
    { class: 'app-header' },
    el('h1', {}, '股票期货监控助手 v2'),
    el(
      'nav',
      { class: 'app-nav', id: 'app-nav' },
      el('a', { href: '#/', class: 'nav-link' }, '监控'),
      el('a', { href: '#/limit-up', class: 'nav-link active' }, '涨停看板')
    )
  );
}

function buildGroups(state, cb) {
  const wrap = el('section', { class: 'lu-groups', id: 'lu-groups' });
  const pinnedCodes = state.pinnedCodes || new Set();
  const ctx = {
    selectedCodes: state.selectedCodes || new Set(),
    // Phase 8: 多 chart 架构
    expandedCodes: state.expandedCodes || new Set(),
    chartInstances: state.chartInstances || new Map(),
    groupSort: state.groupSort || {},
    sortKey: state.sortKey || 'amount',
    pinnedCodes,
    cb
  };
  const itemByCode = new Map();
  for (const it of state.items || []) {
    if (it && it.code) itemByCode.set(it.code, it);
  }
  for (const g of state.groups || []) {
    for (const it of g.items || []) {
      if (it && it.code && !itemByCode.has(it.code)) itemByCode.set(it.code, it);
    }
  }
  const pinnedSort = ctx.groupSort.pinned || { key: ctx.sortKey || 'amount', direction: 'desc' };
  const pinnedItems = sortLimitUpGroupItems(
    [...pinnedCodes].map((code) => itemByCode.get(code)).filter(Boolean),
    pinnedSort.key,
    pinnedSort.direction
  );
  wrap.appendChild(buildGroup({ key: 'pinned', label: '置顶股票', items: pinnedItems }, ctx));
  for (const g of state.groups || []) {
    const items = pinnedCodes.size ? (g.items || []).filter((it) => !pinnedCodes.has(it.code)) : (g.items || []);
    wrap.appendChild(buildGroup({ ...g, items }, ctx));
  }
  return wrap;
}

// Public API: renderLimitUpPage(root, state, callbacks)
//
// The kline panel is rendered INLINE inside the matching stock row's tbody
// (one tr with colspan=8 immediately after the clicked row), NOT as a
// separate panel at the page bottom. To re-attach the chart instance, callers
// (app.js) find `#lu-chart-host` and call createKlineChart on it.
//
// callbacks: {
//   navigateTo(path)
//   addToWatchListAndNavigate(code)   — legacy / unused by row click now
//   onRefreshChange(ms)
//   fetchList()
//   onSortChange(key)
//   selectAll() / selectNone() / toggleSelect(code, checked)
//   addSelectedAndNavigate(codes)
//   openKline(code) / closeKline() / changeKlinePeriod(period)
//   onLiveTickUpdate()
// }
export function renderLimitUpPage(root, state, callbacks) {
  if (!root) return;
  const cb = callbacks || {};
  const s = state || { groups: [], refreshInterval: 30000, sortKey: 'amount', selectedCodes: new Set() };

  root.innerHTML = '';
  root.appendChild(buildHeader());
  root.appendChild(buildToolbar(s, cb));
  root.appendChild(buildGroups(s, cb));
  root.appendChild(buildStatusLine(s));
}
