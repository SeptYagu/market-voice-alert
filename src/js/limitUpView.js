// 涨停看板视图。纯渲染：传入 root + state + callbacks，输出 DOM 树。
import {
  formatNumber,
  formatAmount,
  formatPercent,
  LIMIT_UP_REFRESH_OPTIONS,
  intradaySourceLabel
} from './format.js';
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
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return el(
    'th',
    {
      class: `${cls} lu-sortable${active ? ' active' : ''}`.trim(),
      title: `按${label}排序`,
      role: 'button',
      tabindex: '0',
      'aria-sort': ariaSort,
      on: {
        click: () => {
          if (typeof ctx.cb.sortGroup === 'function') ctx.cb.sortGroup(group.key, sortKey);
        },
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (typeof ctx.cb.sortGroup === 'function') ctx.cb.sortGroup(group.key, sortKey);
          }
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
      'aria-label': isPinned ? `取消固定 ${item.name || item.code}` : `固定 ${item.name || item.code}`,
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
      role: 'button',
      tabindex: '0',
      'aria-expanded': isActive ? 'true' : 'false',
      on: {
        click: (e) => {
          const target = e && e.target;
          if (target && target.tagName === 'INPUT') return;
          if (target && target.tagName === 'BUTTON') return;
          if (target && target.closest && (target.closest('.lu-check') || target.closest('.lu-pin'))) return;
          if (typeof ctx.cb.openKline === 'function') ctx.cb.openKline(item.code);
        },
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            const target = e && e.target;
            if (target && target.tagName === 'INPUT') return;
            if (target && target.tagName === 'BUTTON') return;
            if (target && target.closest && (target.closest('.lu-check') || target.closest('.lu-pin'))) return;
            e.preventDefault();
            if (typeof ctx.cb.openKline === 'function') ctx.cb.openKline(item.code);
          }
        }
      }
    },
    el('td', { class: 'lu-check', 'data-field': 'check' }, cb),
    el('td', { class: 'lu-pin', 'data-field': 'pin' }, pinBtn),
    el('td', { class: 'lu-code', 'data-field': 'code' }, item.code),
    el(
      'td',
      { class: 'lu-name', 'data-field': 'name' },
      item.name || '-',
      item.isST ? el('span', { class: 'lu-st-badge', title: 'ST / *ST 股票' }, 'ST') : null
    ),
    el('td', { class: 'lu-count num', 'data-field': 'count' }, `${item.limitUpCount || 0} 板`),
    el('td', { class: 'lu-price num', 'data-field': 'price' }, formatNumber(item.price)),
    el('td', { class: `lu-pct num ${direction}`, 'data-field': 'percent' }, formatPercent(item.changePercent)),
    el('td', { class: 'lu-open num', 'data-field': 'open' }, formatNumber(item.open)),
    el('td', { class: 'lu-ratio num', 'data-field': 'ratio' }, formatNumber(item.volumeRatio)),
    el('td', { class: 'lu-amount num', 'data-field': 'amount' }, formatAmount(item.amount)),
    el('td', { class: 'lu-final num', 'data-field': 'final' }, item.lastLimitTime || '-'),
    el('td', { class: 'lu-break num', 'data-field': 'break' }, String(item.breakCount || 0)),
    el('td', { class: 'lu-reason', 'data-field': 'reason', title: item.interpretation || '无龙虎榜信息' }, item.reason || '—')
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

function buildGroup(g, ctx, emptyRows = false) {
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
    for (const it of emptyRows ? [] : g.items) {
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

export function getLimitUpViewGroups(state) {
  const pins = state.pinnedCodes || new Set();
  const itemByCode = new Map();
  for (const item of [...(state.items || []), ...(state.groups || []).flatMap(g => g.items || [])]) {
    if (item?.code && !itemByCode.has(item.code)) itemByCode.set(item.code, item);
  }
  const sort = state.groupSort?.pinned || { key: state.sortKey || 'amount', direction: 'desc' };
  return [{ key: 'pinned', label: '置顶股票', items: sortLimitUpGroupItems(
    [...pins].map(code => itemByCode.get(code)).filter(Boolean), sort.key, sort.direction
  ) }, ...(state.groups || []).map(g => ({ ...g, items: (g.items || []).filter(item => !pins.has(item.code)) }))];
}

function viewContext(state, cb) {
  return { selectedCodes: state.selectedCodes || new Set(), expandedCodes: state.expandedCodes || new Set(),
    chartInstances: state.chartInstances || new Map(), groupSort: state.groupSort || {},
    sortKey: state.sortKey || 'amount', pinnedCodes: state.pinnedCodes || new Set(), cb };
}

const pageIndexes = new WeakMap();

function patchRow(row, item, ctx) {
  const active = ctx.expandedCodes.has(item.code);
  const pinned = ctx.pinnedCodes.has(item.code);
  row.classList.toggle('lu-active', active);
  row.classList.toggle('lu-pinned-row', pinned);
  row.setAttribute('aria-expanded', String(active));
  row.querySelector('input[data-row-code]').checked = ctx.selectedCodes.has(item.code);
  const pin = row.querySelector('.pin-btn');
  pin.classList.toggle('active', pinned);
  pin.textContent = pinned ? '取消固定' : '固定';
  pin.title = pin.textContent;
  pin.setAttribute('aria-label', `${pin.textContent} ${item.name || item.code}`);
  const values = { count: `${item.limitUpCount || 0} 板`, price: formatNumber(item.price),
    percent: formatPercent(item.changePercent), open: formatNumber(item.open), ratio: formatNumber(item.volumeRatio),
    amount: formatAmount(item.amount), final: item.lastLimitTime || '-', break: String(item.breakCount || 0), reason: item.reason || '—' };
  for (const [field, value] of Object.entries(values)) row.querySelector(`[data-field="${field}"]`).textContent = value;
  row.querySelector('[data-field="percent"]').className = `lu-pct num ${Number(item.changePercent) > 0 ? 'up' : Number(item.changePercent) < 0 ? 'down' : 'flat'}`;
  row.querySelector('[data-field="reason"]').title = item.interpretation || '无龙虎榜信息';
  const name = row.querySelector('[data-field="name"]');
  name.textContent = item.name || '-';
  if (item.isST) name.appendChild(el('span', { class: 'lu-st-badge', title: 'ST / *ST 股票' }, 'ST'));
}

function reconcileGroups(index, state) {
  const ctx = index.ctx;
  const groups = getLimitUpViewGroups(state);
  const wanted = new Set(groups.flatMap(g => g.items.map(item => item.code)));
  for (const [code, row] of index.rows) {
    if (!wanted.has(code)) { row.remove(); index.rows.delete(code); }
  }
  for (const [code, row] of index.charts) {
    if (!wanted.has(code) || !ctx.expandedCodes.has(code)) { row.remove(); index.charts.delete(code); }
  }
  for (const [key, group] of index.groups) {
    if (!groups.some(g => g.key === key)) { group.remove(); index.groups.delete(key); }
  }
  let groupCursor = index.wrap.firstElementChild;
  for (const g of groups) {
    let section = index.groups.get(g.key);
    const sort = ctx.groupSort[g.key] || { key: ctx.sortKey, direction: 'desc' };
    const sortKey = JSON.stringify(sort);
    if (!section) {
      section = buildGroup(g, ctx, true);
      index.groups.set(g.key, section);
    } else if (g.items.length && !section.querySelector('tbody')) {
      section.appendChild(buildGroup(g, ctx, true).querySelector('.lu-group-body'));
    } else if (g.items.length && section.dataset.sort !== sortKey) {
      const header = buildGroup(g, ctx, true).querySelector('thead');
      section.querySelector('thead').replaceWith(header);
    }
    section.dataset.sort = sortKey;
    section.querySelector('.lu-group-title').textContent = g.label;
    section.querySelector('.lu-group-count').textContent = `${g.items.length} 只`;
    if (section === groupCursor) groupCursor = groupCursor.nextElementSibling;
    else index.wrap.insertBefore(section, groupCursor);
    const body = section.querySelector('tbody');
    if (!g.items.length) continue;
    let cursor = body.firstElementChild;
    const place = node => {
      if (node === cursor) cursor = cursor.nextElementSibling;
      else body.insertBefore(node, cursor);
    };
    for (const item of g.items) {
      let row = index.rows.get(item.code);
      if (!row) { row = buildRow(item, ctx); index.rows.set(item.code, row); }
      else patchRow(row, item, ctx);
      place(row);
      if (ctx.expandedCodes.has(item.code)) {
        let chart = index.charts.get(item.code);
        if (!chart) { chart = buildInlineChartRow(item, ctx); index.charts.set(item.code, chart); }
        for (const tab of chart.querySelectorAll('[data-period]')) {
          tab.classList.toggle('active', tab.dataset.period === ctx.chartInstances.get(item.code)?.period);
        }
        place(chart);
      }
    }
  }
  for (const g of groups) if (!g.items.length) index.groups.get(g.key).querySelector('.lu-group-body')?.remove();
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

  let index = pageIndexes.get(root);
  if (!index || index.wrap.parentNode !== root) {
    root.replaceChildren(buildHeader(), buildToolbar(s, cb));
    const wrap = el('section', { class: 'lu-groups', id: 'lu-groups' });
    root.append(wrap, buildStatusLine(s));
    index = { wrap, ctx: viewContext(s, cb), rows: new Map(), charts: new Map(), groups: new Map() };
    pageIndexes.set(root, index);
  } else {
    Object.assign(index.ctx, viewContext(s, cb));
    root.children[1].replaceWith(buildToolbar(s, cb));
    root.querySelector('#lu-status').replaceWith(buildStatusLine(s));
  }
  reconcileGroups(index, s);
}
