// 顶部导航栏视图组件
import { THEME_ICONS, THEME_LABELS } from '../theme.js';

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

export function autoRefreshButtonText(enabled, paused) {
  if (!enabled) return '开始自动刷新';
  return paused ? '自动刷新已暂停' : '停止自动刷新';
}

export function autoRefreshButtonTitle(enabled, paused) {
  if (!enabled) return '开始自动刷新';
  return paused ? '非交易时段，自动刷新将在开盘后恢复' : '停止自动刷新';
}

export function updateMonitorAutoRefreshButton(enabled, paused) {
  const btn = document.getElementById('auto-refresh-toggle');
  if (!btn) return;
  btn.className = enabled ? 'btn-ctl-active' : '';
  btn.title = autoRefreshButtonTitle(enabled, paused);
  btn.textContent = autoRefreshButtonText(enabled, paused);
}

export function renderRefreshSelect(refreshInterval, refreshOptions = [], onRefreshChange) {
  const select = el('select', {
    id: 'refresh-select',
    on: { change: onRefreshChange }
  });
  for (const opt of refreshOptions) {
    const option = el('option', { value: opt.value }, opt.label);
    if (Number(opt.value) === refreshInterval) option.selected = true;
    select.appendChild(option);
  }
  return el('label', { class: 'refresh-label' }, '刷新: ', select);
}

export function renderHeaderView(options = {}) {
  const {
    currentTheme = 'light',
    refreshInterval = 3000,
    refreshOptions = [],
    onRefreshChange,
    onToggleTheme
  } = options;

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
      renderRefreshSelect(refreshInterval, refreshOptions, onRefreshChange),
      el(
        'button',
        {
          id: 'theme-toggle',
          title: `当前: ${THEME_LABELS[currentTheme] || currentTheme} (点击切换)`,
          on: { click: onToggleTheme }
        },
        `${THEME_ICONS[currentTheme] || '🌓'} ${THEME_LABELS[currentTheme] || currentTheme}`
      )
    )
  );
}
