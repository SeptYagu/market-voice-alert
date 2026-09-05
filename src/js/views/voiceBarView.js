// 语音播报控制条视图组件

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

export function renderVoiceScheduleToggle(key, label, checked, disabled = false, onChange) {
  return el(
    'label',
    { class: 'schedule-toggle' + (checked ? ' active' : '') },
    el('input', {
      type: 'checkbox',
      checked: !!checked,
      disabled: !!disabled,
      on: { change: (e) => onChange && onChange(key, e.target.checked) }
    }),
    label
  );
}

export function renderFieldToggle(key, label, index, fields, fieldsOrder, handlers = {}) {
  const checked = !!(fields && fields[key]);
  const order = fieldsOrder || [];
  const isFirst = index === 0;
  const isLast = index === order.length - 1;
  return el(
    'div',
    { class: 'field-toggle' + (checked ? ' active' : '') },
    el(
      'label',
      { class: 'field-toggle-inner', title: '点击切换启用/禁用' },
      el('input', {
        type: 'checkbox',
        checked,
        'data-field': key,
        on: { change: (e) => handlers.onFieldChange && handlers.onFieldChange(key, e.target.checked) }
      }),
      label
    ),
    el(
      'div',
      { class: 'field-order' },
      el(
        'button',
        {
          class: 'field-move',
          type: 'button',
          disabled: isFirst,
          title: '上移',
          'aria-label': `上移 ${label}`,
          on: { click: () => handlers.onMoveField && handlers.onMoveField(key, 'up') }
        },
        '▲'
      ),
      el(
        'button',
        {
          class: 'field-move',
          type: 'button',
          disabled: isLast,
          title: '下移',
          'aria-label': `下移 ${label}`,
          on: { click: () => handlers.onMoveField && handlers.onMoveField(key, 'down') }
        },
        '▼'
      )
    )
  );
}

export function updateVoiceHint(subscribedSize = 0) {
  const hint = document.querySelector('#voice-bar .ctl-hint');
  if (hint) {
    hint.textContent = `订阅 ${subscribedSize}（行尾 🔊 列勾选）`;
  }
}

export function renderVoiceBar(ctx) {
  const {
    container = document.getElementById('voice-bar'),
    voiceState,
    subscribedSize = 0,
    isSpeechSupported = false,
    fieldLabels = {},
    defaultSmartSchedule = {},
    handlers = {}
  } = ctx;

  if (!container) return;
  container.innerHTML = '';
  const speechOK = isSpeechSupported;

  const enabled = voiceState.enabled;
  const toggleBtn = el(
    'button',
    {
      class: enabled ? 'btn-ctl-active' : 'btn-ctl-toggle',
      disabled: !speechOK,
      title: speechOK ? '点击切换定时语音播报' : '当前浏览器不支持语音合成',
      on: { click: () => handlers.onToggleEnabled && handlers.onToggleEnabled(!voiceState.enabled) }
    },
    enabled ? '⏸ 停用定时语音播报' : '▶ 启用定时语音播报'
  );

  const intervalInput = el('input', {
    type: 'text',
    inputmode: 'numeric',
    id: 'voice-interval',
    value: String(voiceState.interval / 1000),
    disabled: !speechOK,
    placeholder: '5',
    title: '正整数秒；留空启用时默认 5 秒',
    on: {
      input: (e) => {
        const cleaned = e.target.value.replace(/\D+/g, '');
        if (cleaned !== e.target.value) {
          const cursor = e.target.selectionStart;
          e.target.value = cleaned;
          try { e.target.setSelectionRange(cursor - 1, cursor - 1); } catch { /* ignore */ }
        }
      },
      blur: (e) => handlers.onIntervalBlur && handlers.onIntervalBlur(e.target.value),
      keydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (handlers.onIntervalBlur) handlers.onIntervalBlur(e.target.value);
          e.target.blur();
        }
      }
    }
  });

  const volSlider = el('input', {
    type: 'range',
    id: 'voice-volume',
    value: String(voiceState.volume),
    disabled: !speechOK,
    on: { input: (e) => handlers.onVolumeChange && handlers.onVolumeChange(Number(e.target.value)) }
  });
  volSlider.min = '0';
  volSlider.max = '100';
  volSlider.step = '5';

  const testBtn = el(
    'button',
    { on: { click: () => handlers.onTestSpeech && handlers.onTestSpeech() }, disabled: !speechOK },
    '🎤 测试声音'
  );

  const row1 = el(
    'div',
    { class: 'ctl-row' },
    toggleBtn,
    el(
      'label',
      { class: 'ctl-inline' },
      el('span', { class: 'ctl-inline-label' }, '间隔:'),
      intervalInput,
      el('span', { class: 'ctl-inline-label' }, '秒')
    ),
    el(
      'label',
      { class: 'ctl-inline ctl-volume-wrap' },
      el('span', { class: 'ctl-inline-label' }, '音量:'),
      volSlider,
      el('span', { class: 'volume-label', id: 'voice-volume-label' }, `${voiceState.volume}%`)
    ),
    testBtn
  );

  const row2 = el(
    'div',
    { class: 'ctl-row' },
    el('span', { class: 'ctl-inline-label' }, '播报内容:'),
    ...voiceState.fieldsOrder.map((k, i) =>
      renderFieldToggle(k, fieldLabels[k] || k, i, voiceState.fields, voiceState.fieldsOrder, handlers)
    ),
    el(
      'span',
      { class: 'ctl-hint' },
      `订阅 ${subscribedSize}（行尾 🔊 列勾选）`
    )
  );

  const smart = voiceState.smartSchedule || defaultSmartSchedule;
  const row3 = el(
    'div',
    { class: 'ctl-row voice-schedule-row' },
    el('span', { class: 'ctl-inline-label' }, '交易时段:'),
    renderVoiceScheduleToggle('enabled', '智能交易时段', smart.enabled, false, handlers.onScheduleChange),
    renderVoiceScheduleToggle('pauseLunchBreak', '午休暂停/下午恢复', smart.pauseLunchBreak, !smart.enabled, handlers.onScheduleChange),
    renderVoiceScheduleToggle('autoStopAfterClose', '收盘自动停止', smart.autoStopAfterClose, !smart.enabled, handlers.onScheduleChange),
    renderVoiceScheduleToggle('autoStartAuction', '集合竞价自动开始', smart.autoStartAuction, !smart.enabled, handlers.onScheduleChange)
  );

  if (!speechOK) {
    container.appendChild(el('div', { class: 'ctl-warn' }, '⚠ 当前浏览器不支持语音合成 (Web Speech API)，相关功能不可用。'));
  }
  container.appendChild(row1);
  container.appendChild(row2);
  container.appendChild(row3);
}
