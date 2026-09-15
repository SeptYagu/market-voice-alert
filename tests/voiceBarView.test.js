import { renderVoiceBar } from '../src/js/views/voiceBarView.js';

// 交易时段那一排的回调契约是 (key, checked)。历史上这里踩过一次坑：
// handler 只声明一个形参时，收到的其实是 key 字符串（非空 → 恒真），
// 表现为"点开关没反应"。这条用例把契约显式钉住。
QUnit.module('views.voiceBarView', (hooks) => {
  let root;
  let calls;

  hooks.beforeEach(() => {
    root = document.createElement('div');
    root.id = 'voice-bar';
    document.body.appendChild(root);
    calls = [];
  });

  hooks.afterEach(() => {
    if (root && root.parentNode) root.parentNode.removeChild(root);
  });

  function render(voiceState = {}) {
    renderVoiceBar({
      container: root,
      voiceState: {
        enabled: false,
        interval: 5000,
        volume: 80,
        skipUnchanged: true,
        fields: { name: true, price: true, percent: true },
        fieldsOrder: ['name', 'price', 'percent'],
        smartSchedule: { enabled: true, pauseLunchBreak: true, autoStopAfterClose: true, autoStartAuction: false },
        ...voiceState
      },
      isSpeechSupported: true,
      fieldLabels: { name: '名字', price: '现价', percent: '涨幅' },
      handlers: {
        onScheduleChange: (key, checked) => calls.push([key, checked]),
        onSkipUnchangedChange: (key, checked) => calls.push([key, checked])
      }
    });
  }

  const scheduleToggles = () => [...root.querySelectorAll('.voice-schedule-row .schedule-toggle')];
  const dedupeToggle = () => scheduleToggles().at(-1);

  QUnit.test('the dedup switch is the 5th of the row and reports (key, checked)', (t) => {
    render();
    const toggles = scheduleToggles();
    t.equal(toggles.length, 5, 'four schedule switches plus 相同报价不重复播报');
    const dedupe = dedupeToggle();
    t.true(dedupe.textContent.includes('相同报价不重复播报'));
    t.true(dedupe.classList.contains('schedule-toggle'), 'reuses the schedule switch styling');
    t.true(dedupe.classList.contains('active'), 'on by default');
    t.true(dedupe.querySelector('input').checked, 'dedup is on by default');
    t.false(dedupe.querySelector('input').disabled, 'operable without 智能交易时段');

    const input = dedupe.querySelector('input');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    t.deepEqual(calls, [['skipUnchanged', false]],
      'handler gets the key plus the live checkbox value');
  });

  QUnit.test('legacy state renders checked, an explicit off renders unchecked', (t) => {
    render({ skipUnchanged: undefined });
    t.true(dedupeToggle().querySelector('input').checked,
      'state written before the key existed must render as on');
    render({ skipUnchanged: false });
    t.false(dedupeToggle().querySelector('input').checked);
    t.false(dedupeToggle().classList.contains('active'));
    render({ skipUnchanged: false, smartSchedule: { enabled: false } });
    t.false(dedupeToggle().querySelector('input').disabled,
      'still enabled while the smart schedule is off');
  });
});
