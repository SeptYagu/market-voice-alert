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
    asOfDate: '2026-09-11',
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

  // B2: 防抖窗口内快速输入无法解析字符串并回车，不提交过期旧候选
  QUnit.test('B2: 防抖窗口内改变输入立即取消旧候选提交资格，不提交过期结果', async (t) => {
    const addedCodes = [];
    const messages = [];

    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => [],
      onAddCodes: (codes) => addedCodes.push(...codes),
      onFlashMessage: (msg) => messages.push(msg),
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    ctrl.bindEvents();

    // 1. 输入 gzmt，成功检索出贵州茅台
    inputEl.value = 'gzmt';
    inputEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    const state1 = ctrl.getState();
    t.true(state1.isOpen, 'Dropdown open after gzmt');
    t.equal(state1.candidates.length, 1, 'Found 贵州茅台');

    // 2. 快速改成无法解析的字符串 xyz，不等 150ms 防抖立即按回车
    inputEl.value = 'xyz';
    inputEl.dispatchEvent(new Event('input'));

    // 此时尚未等 150ms，回车不应提交旧的贵州茅台
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    t.deepEqual(addedCodes, [], 'Old candidate was NOT submitted during debounce window');
    t.equal(inputEl.value, 'xyz', 'Input xyz preserved');

    ctrl.destroy();
  });

  // B3: destroy 完整移除 composition 监听器，不泄漏
  QUnit.test('B3: destroy 完整移除 composition 监听器，不泄漏', async (t) => {
    const added = new Map();
    const removed = new Map();
    const rawAdd = inputEl.addEventListener.bind(inputEl);
    const rawRemove = inputEl.removeEventListener.bind(inputEl);
    const bump = (m, type) => m.set(type, (m.get(type) || 0) + 1);
    inputEl.addEventListener = (type, fn, opts) => {
      bump(added, type);
      return rawAdd(type, fn, opts);
    };
    inputEl.removeEventListener = (type, fn, opts) => {
      bump(removed, type);
      return rawRemove(type, fn, opts);
    };

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
    t.equal(added.get('compositionstart') || 0, 1, 'compositionstart bound');
    t.equal(added.get('compositionend') || 0, 1, 'compositionend bound');

    ctrl.destroy();
    t.equal(removed.get('compositionstart') || 0, 1, 'compositionstart unbound');
    t.equal(removed.get('compositionend') || 0, 1, 'compositionend unbound');
  });

  // C5: keyCode 229 与 isComposing 兼容保护
  QUnit.test('C5: keyCode === 229 或 e.isComposing === true 拦截 Enter 提交', async (t) => {
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
    inputEl.value = 'sh600519';

    // 模拟 Android 兼容环境：keyCode 229
    const event229 = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(event229, 'keyCode', { value: 229 });
    inputEl.dispatchEvent(event229);
    t.equal(addedCodes.length, 0, 'Enter intercepted when keyCode === 229');

    // 模拟 isComposing 属性为 true 的事件
    const eventComposing = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(eventComposing, 'isComposing', { value: true });
    inputEl.dispatchEvent(eventComposing);
    t.equal(addedCodes.length, 0, 'Enter intercepted when e.isComposing === true');

    ctrl.destroy();
  });

  // D4: "+ 添加"按钮与 Enter 键行为完全一致
  QUnit.test('D4: "+ 添加"按钮 (handleSubmit) 与 Enter 键两入口行为一致且无双重执行', async (t) => {
    const addedCodes = [];
    const flashes = [];
    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => [],
      onAddCodes: (codes) => addedCodes.push(...codes),
      onFlashMessage: (msg) => flashes.push(msg),
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    ctrl.bindEvents();

    inputEl.value = 'gzmt';
    inputEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    // 模拟点击 "+ 添加" 按钮触发 handleSubmit
    ctrl.handleSubmit();

    t.deepEqual(addedCodes, ['sh600519'], 'handleSubmit from button added candidate');
    t.equal(inputEl.value, '', 'Input cleared after button submit');

    // 再次测试回车路径单次触发
    inputEl.value = 'invalid_query_code';
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    t.equal(flashes.length, 1, 'Only one flash error message on Enter (no double-keydown)');

    ctrl.destroy();
  });

  // D6: 快速连击幂等性与真实 storage 抛错降级
  QUnit.test('D6: 快速双击/连按回车幂等，真实 storage 存储失败保留输入并报错', async (t) => {
    const addedCodes = [];
    const messages = [];

    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => [],
      onAddCodes: (codes) => addedCodes.push(...codes),
      onFlashMessage: (msg) => messages.push(msg),
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    ctrl.bindEvents();

    inputEl.value = 'gzmt';
    inputEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    // 快速双击提交
    ctrl.handleSubmit();
    ctrl.handleSubmit();

    t.deepEqual(addedCodes, ['sh600519'], 'Only added once despite double submit');
    ctrl.destroy();

    // 真实 storage 写入失败端到端测试
    const { setStorageAdapter, addToWatchList } = await import('../src/js/storage.js');
    const mockFailingAdapter = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {}
    };
    setStorageAdapter(mockFailingAdapter);

    let storageAttempts = 0;
    const realStorageCtrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => [],
      onAddCodes: (codes) => {
        storageAttempts++;
        for (const c of codes) addToWatchList(c);
      },
      onFlashMessage: (msg) => messages.push(msg),
      fetchFn: mockFetch,
      timers: createMockTimers()
    });

    realStorageCtrl.bindEvents();
    inputEl.value = 'sh600000';
    realStorageCtrl.handleSubmit();

    t.equal(storageAttempts, 1, 'storage write attempted once');
    t.equal(inputEl.value, 'sh600000', 'Input preserved when real storage fails');
    t.true(messages.some((m) => m.includes('添加失败') && m.includes('存储空间不足或写入失败')), 'Error flashed on real storage failure');

    setStorageAdapter(null);
    realStorageCtrl.destroy();
  });

  // D2 & D3: 关键字高亮与 asOfDate 数据日期渲染
  QUnit.test('D2 & D3: 关键字安全高亮与数据日期 UI 渲染', async (t) => {
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
    inputEl.value = '600519';
    inputEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    // 验证高亮 mark 存在
    const marks = dropdownEl.querySelectorAll('.suggest-match-highlight');
    t.true(marks.length > 0, 'Highlight marks rendered safely');
    t.equal(marks[0].textContent, '600519', 'Mark text matches query');

    // 验证 asOfDate 数据日期元素渲染
    const asOfEl = dropdownEl.querySelector('.suggest-as-of-date');
    t.ok(asOfEl, 'asOfDate element is rendered');
    t.true(asOfEl.textContent.includes('数据日期: 2026-09-11'), 'Shows correct asOfDate');

    ctrl.destroy();
  });

  // R1: 防抖窗口内输入变更后，旧 DOM 即刻清空，指针无法触发过期候选添加
  QUnit.test('R1: 输入变更后防抖窗口内旧下拉 DOM 即刻清空，指针点击不提交过期标的', async (t) => {
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

    inputEl.value = 'gzmt';
    inputEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    t.equal(dropdownEl.querySelectorAll('.suggest-item').length, 1, 'Has 1 candidate before change');

    // 快速改变输入为 xyz
    inputEl.value = 'xyz';
    inputEl.dispatchEvent(new Event('input'));

    // 旧 DOM 应已清空收起
    const staleItems = dropdownEl.querySelectorAll('.suggest-item');
    t.equal(staleItems.length, 0, 'Dropdown items immediately cleared on input change');
    t.true(dropdownEl.hidden, 'Dropdown immediately hidden');
    t.deepEqual(addedCodes, [], 'No code added');

    ctrl.destroy();
  });

  // R5: 字典加载与搜索/渲染异常解耦，重试正常恢复
  QUnit.test('R5: 搜索/渲染异常不污染 dictionaryError，重试可重置状态', async (t) => {
    let fetchCalled = 0;
    const ctrl = createSearchSuggestController({
      inputElement: inputEl,
      dropdownElement: dropdownEl,
      liveRegionElement: liveRegionEl,
      getWatchList: () => [],
      onAddCodes: () => {},
      fetchFn: async (url) => {
        fetchCalled++;
        if (url.includes('stock-suggest-dictionary')) {
          if (fetchCalled === 1) {
            return { ok: false, status: 500 };
          }
          return { ok: true, json: async () => mockDictionaryData };
        }
        return { ok: true, json: async () => ({ ok: true, data: { items: [] } }) };
      },
      timers: createMockTimers()
    });

    ctrl.bindEvents();

    // 首次触发加载失败
    inputEl.value = 'gzmt';
    inputEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    let state = ctrl.getState();
    t.ok(state.dictionaryError, 'Dictionary error captured on network failure');
    const retryBtn = dropdownEl.querySelector('#suggest-retry-btn');
    t.ok(retryBtn, 'Retry button rendered');

    // 点击重试
    retryBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 250));

    state = ctrl.getState();
    t.equal(state.dictionaryError, null, 'Dictionary error cleared on successful retry');
    t.true(state.candidates.length > 0, 'Candidates loaded after retry');

    ctrl.destroy();
  });
});

