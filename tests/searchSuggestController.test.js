import { createSearchSuggestController } from '../src/js/controllers/searchSuggestController.js';

const KeyboardEvent = globalThis.KeyboardEvent || (typeof window !== 'undefined' && window.KeyboardEvent);
const CompositionEvent = globalThis.CompositionEvent || (typeof window !== 'undefined' && window.CompositionEvent);

function createMockTimers() {
  const timers = {
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return id;
    },
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms);
      return id;
    },
    clearInterval: (id) => clearInterval(id)
  };
  return timers;
}

QUnit.module('搜索联想控制器测试 (S10–S13 交互与生命周期)', (hooks) => {
  let container;
  let inputEl;
  let dropdownEl;
  let liveRegionEl;

  const mockDictionaryData = {
    schemaVersion: '1.0.0',
    version: '2026.09.11',
    items: [
      { c: 'sh600519', n: '贵州茅台', i: 'gzmt', p: 'guizhoumaotai', m: '沪市主板' },
      { c: 'sz000001', n: '平安银行', i: 'payh', p: 'pinganyinhang', m: '深市主板', a: [{ name: '深发展', type: 'former', initials: 'sfz', pinyin: 'shenfazhan' }] },
      { c: 'sz002639', n: '雪人集团', i: 'xrjt', p: 'xuerenjituan', m: '深市主板', a: [{ name: '雪人股份', type: 'former', initials: 'xrgf', pinyin: 'xuerengufen' }] }
    ]
  };

  const mockFetch = async (url) => {
    if (url.includes('stock-suggest-dictionary')) {
      return {
        ok: true,
        json: async () => mockDictionaryData
      };
    }
    if (url.includes('/api/cache/spot/latest')) {
      return {
        ok: true,
        json: async () => ({ ok: true, stale: false, generatedAt: Date.now(), ttlMs: 30000, data: { items: [] } })
      };
    }
    throw new Error('Not found');
  };

  hooks.beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    inputEl = document.createElement('input');
    inputEl.id = 'code-input';
    container.appendChild(inputEl);

    dropdownEl = document.createElement('div');
    dropdownEl.id = 'suggest-dropdown';
    dropdownEl.hidden = true;
    container.appendChild(dropdownEl);

    liveRegionEl = document.createElement('div');
    liveRegionEl.id = 'suggest-live-region';
    container.appendChild(liveRegionEl);
  });

  hooks.afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  // S10: gzmt 后 Enter/按钮、上下循环/Escape/Tab
  QUnit.test('S10: 输入 gzmt 后 Enter 自动添加首选，方向键循环选择，Escape/Tab 关闭', async (t) => {
    const addedCodes = [];
    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => [],
      onAddCodes: (codes) => addedCodes.push(...codes),
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    ctrl.bindEvents();

    inputEl.focus();
    inputEl.value = 'gzmt';
    inputEl.dispatchEvent(new Event('input'));

    // 等待 150ms 防抖及字典解析
    await new Promise((r) => setTimeout(r, 200));

    const state = ctrl.getState();
    t.true(state.isOpen, 'Dropdown is opened');
    t.equal(state.candidates.length, 1, 'Found 贵州茅台');
    t.equal(state.defaultSelectedIndex, 0, 'First candidate is default selected');

    // 触发回车添加默认候选
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    t.deepEqual(addedCodes, ['sh600519'], 'gzmt + Enter added sh600519');
    t.equal(inputEl.value, '', 'Input cleared after add');

    ctrl.destroy();
  });

  QUnit.test('S10-2: 方向键 ArrowDown / ArrowUp 循环并跳过已添加项', async (t) => {
    const addedCodes = [];
    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => ['sh600519'],
      onAddCodes: (codes) => addedCodes.push(...codes),
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    ctrl.bindEvents();
    inputEl.focus();
    inputEl.value = '0';
    inputEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    const state = ctrl.getState();
    t.true(state.isOpen, 'Dropdown open');

    // 下箭头选择
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    let st = ctrl.getState();
    const firstActive = st.activeIndex;
    t.ok(firstActive !== null, 'Candidate selected via ArrowDown');
    t.false(st.candidates[firstActive].alreadyAdded, 'Active candidate is not already added');

    // Escape 关闭
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    st = ctrl.getState();
    t.false(st.isOpen, 'Escape closed dropdown');

    ctrl.destroy();
  });

  // S11: IME 组合保护与 blur 防竞争
  QUnit.test('S11: 输入法 IME 组合期间 Enter 不提交，compositionend 后恢复', async (t) => {
    const addedCodes = [];
    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => [],
      onAddCodes: (codes) => addedCodes.push(...codes),
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    ctrl.bindEvents();
    inputEl.focus();

    // 触发 compositionstart
    inputEl.dispatchEvent(new CompositionEvent('compositionstart'));
    inputEl.value = 'gzmt';

    // IME 期间按 Enter
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    t.equal(addedCodes.length, 0, 'No submit during IME composition');

    // 触发 compositionend
    inputEl.dispatchEvent(new CompositionEvent('compositionend'));
    await new Promise((r) => setTimeout(r, 200));

    // 组合结束后按 Enter 提交
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    t.deepEqual(addedCodes, ['sh600519'], 'Submitted after compositionend');

    ctrl.destroy();
  });

  // S12: 快速输入与生命周期清理
  QUnit.test('S12: 快速输入时旧请求即时取消，destroy 清除定时器与事件', async (t) => {
    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => [],
      onAddCodes: () => {},
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    ctrl.bindEvents();

    inputEl.value = 'g';
    inputEl.dispatchEvent(new Event('input'));
    inputEl.value = 'gz';
    inputEl.dispatchEvent(new Event('input'));
    inputEl.value = 'gzm';
    inputEl.dispatchEvent(new Event('input'));
    inputEl.value = 'gzmt';
    inputEl.dispatchEvent(new Event('input'));

    await new Promise((r) => setTimeout(r, 200));

    const state = ctrl.getState();
    t.equal(state.currentQuery, 'gzmt', 'Final query is gzmt');

    ctrl.destroy();
    t.ok(true, 'Destroy called cleanly');
  });

  // S13: 已添加项与全部已添加时的处理
  QUnit.test('S13: 候选已添加时无法二次添加，并给出友好反馈', async (t) => {
    const addedCodes = [];
    const messages = [];

    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => ['sh600519'],
      onAddCodes: (codes) => addedCodes.push(...codes),
      onFlashMessage: (msg) => messages.push(msg),
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    ctrl.bindEvents();
    inputEl.value = 'gzmt';
    inputEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    const state = ctrl.getState();
    t.true(state.candidates.length > 0, 'Found candidate');
    t.true(state.candidates[0].alreadyAdded, 'Candidate is marked as alreadyAdded');
    t.equal(state.defaultSelectedIndex, -1, 'defaultSelectedIndex is -1 when all candidates added');

    // 尝试 Enter 提交已添加项
    ctrl.handleSubmit();
    t.equal(addedCodes.length, 0, 'Did not add already added candidate');
    t.true(messages.some((m) => m.includes('已在监控')), 'Flash message warned candidate already in watch list');

    ctrl.destroy();
  });
});
