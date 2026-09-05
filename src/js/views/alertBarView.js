// 价格阈值提醒控制条视图组件

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

export function updateAlertHint(subscribedSize = 0) {
  const hint = document.querySelector('#alert-bar .ctl-hint');
  if (hint) {
    hint.textContent = `订阅 ${subscribedSize}（行尾 🔊 列勾选）`;
  }
}

export function renderAlertBar(ctx) {
  const {
    container = document.getElementById('alert-bar'),
    alertState,
    subscribedSize = 0,
    isNotificationSupported = false,
    notifPermission = 'default',
    handlers = {}
  } = ctx;

  if (!container) return;
  container.innerHTML = '';
  const notifOK = isNotificationSupported;

  const enabled = alertState.enabled;
  const toggleBtn = el(
    'button',
    {
      class: enabled ? 'btn-ctl-active' : 'btn-ctl-toggle',
      title: '点击切换价格阈值提醒（达到阈值时语音+通知）',
      on: { click: () => handlers.onToggleEnabled && handlers.onToggleEnabled(!alertState.enabled) }
    },
    enabled ? '⏸ 停用价格提醒' : '🔔 启用价格提醒'
  );

  const thresholdInput = el('input', {
    type: 'text',
    inputmode: 'decimal',
    id: 'alert-threshold',
    value: String(alertState.threshold),
    placeholder: '5',
    title: '0.1 - 50 之间的数字（允许小数）；留空启用时默认 5',
    on: {
      input: (e) => {
        let cleaned = e.target.value.replace(/[^\d.]/g, '');
        const firstDot = cleaned.indexOf('.');
        if (firstDot >= 0) {
          cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
        }
        if (cleaned !== e.target.value) {
          const cursor = e.target.selectionStart;
          e.target.value = cleaned;
          try { e.target.setSelectionRange(cursor - 1, cursor - 1); } catch { /* ignore */ }
        }
      },
      blur: (e) => handlers.onThresholdBlur && handlers.onThresholdBlur(e.target.value),
      keydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (handlers.onThresholdBlur) handlers.onThresholdBlur(e.target.value);
          e.target.blur();
        }
      }
    }
  });

  const testBtn = el(
    'button',
    {
      on: { click: () => handlers.onTestAlert && handlers.onTestAlert() },
      title: '用第一个订阅标的的当前涨跌幅模拟一次提醒'
    },
    '🔔 测试提醒'
  );

  const permBits = [];
  if (notifOK) {
    permBits.push(
      el('span', { class: 'perm-label ctl-push-right' }, `桌面通知权限: ${notifPermission}`)
    );
    if (notifPermission !== 'granted') {
      permBits.push(
        el('button', { on: { click: () => handlers.onRequestNotification && handlers.onRequestNotification() } }, '请求通知权限')
      );
    }
  } else {
    permBits.push(
      el('span', { class: 'perm-label ctl-push-right' }, '浏览器不支持桌面通知（仅使用语音）')
    );
  }

  const row1 = el(
    'div',
    { class: 'ctl-row' },
    toggleBtn,
    el(
      'label',
      { class: 'ctl-inline' },
      el('span', { class: 'ctl-inline-label' }, '阈值: ±'),
      thresholdInput,
      el('span', { class: 'ctl-inline-label' }, '%')
    ),
    testBtn,
    ...permBits
  );

  const row2 = el(
    'div',
    { class: 'ctl-row' },
    el(
      'span',
      { class: 'ctl-hint' },
      `订阅 ${subscribedSize}（行尾 🔊 列勾选）`
    )
  );

  container.appendChild(row1);
  container.appendChild(row2);
}
