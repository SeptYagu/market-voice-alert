// 工具栏视图组件（添加、刷新、批量操作与导出）
import { autoRefreshButtonText, autoRefreshButtonTitle } from './headerView.js';

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

export function renderToolbarView(options = {}) {
  const {
    autoRefreshEnabled = false,
    autoRefreshPaused = false,
    handlers = {}
  } = options;

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
              if (handlers.onAdd) handlers.onAdd();
            }
          }
        }
      }),
      el(
        'div',
        { class: 'add-actions' },
        el('button', {
          class: 'btn-primary',
          on: { click: () => handlers.onAdd && handlers.onAdd() }
        }, '+ 添加'),
        el('button', {
          on: { click: () => handlers.onRefreshNow && handlers.onRefreshNow() }
        }, '⟳ 立即刷新'),
        el(
          'button',
          {
            id: 'auto-refresh-toggle',
            class: autoRefreshEnabled ? 'btn-ctl-active' : '',
            title: autoRefreshButtonTitle(autoRefreshEnabled, autoRefreshPaused),
            on: { click: () => handlers.onAutoRefreshToggle && handlers.onAutoRefreshToggle(!autoRefreshEnabled) }
          },
          autoRefreshButtonText(autoRefreshEnabled, autoRefreshPaused)
        )
      )
    ),
    el(
      'div',
      { class: 'list-actions' },
      el('button', { on: { click: () => handlers.onSelectAll && handlers.onSelectAll() } }, '全选'),
      el('button', { on: { click: () => handlers.onSelectNone && handlers.onSelectNone() } }, '清空选择'),
      el('button', {
        class: 'btn-danger',
        on: { click: () => handlers.onDeleteSelected && handlers.onDeleteSelected() }
      }, '删除选中'),
      el('button', { on: { click: () => handlers.onExport && handlers.onExport('selected') } }, '导出选中'),
      el('button', { on: { click: () => handlers.onExport && handlers.onExport('all') } }, '导出全部')
    )
  );
}
