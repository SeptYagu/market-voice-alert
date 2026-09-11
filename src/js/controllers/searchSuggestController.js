// 搜索联想控制器
import {
  loadStockDictionary,
  searchStocks,
  detectQueryMode,
  normalizeQuery
} from '../services/stockSearchService.js';
import {
  isBatchQuery,
  parseBatchInputDetails,
  normalizeFuture
} from '../services/batchExportService.js';
import { normalizeCode } from '../parser.js';

export function createSearchSuggestController(options = {}) {
  const {
    inputElement,
    dropdownElement,
    liveRegionElement,
    onAddCodes = () => {},
    onFlashMessage = () => {},
    getWatchList = () => [],
    fetchFn = globalThis.fetch,
    timers = globalThis
  } = options;

  let dictionary = null;
  let dictionaryLoading = false;
  let dictionaryError = null;

  let queryId = 0;
  let debounceTimer = null;
  let spotRefreshTimer = null;
  let isComposing = false;

  let isOpen = false;
  let currentQuery = '';
  let candidates = [];
  let activeIndex = null; // 用户通过上下键主动选中的项
  let defaultSelectedIndex = -1; // 默认首个可添加项
  let hasMore = false;
  let statusNotice = null;
  let spotSnapshot = null;
  let pendingPointerCandidate = null;
  let blurTimer = null;

  async function initDictionary() {
    if (dictionary || dictionaryLoading) return;
    dictionaryLoading = true;
    dictionaryError = null;
    try {
      dictionary = await loadStockDictionary({ fetchFn });
      dictionaryLoading = false;
      if (currentQuery && isOpen) {
        runSearch(currentQuery);
      }
    } catch (err) {
      dictionaryLoading = false;
      dictionaryError = err && err.message ? err.message : String(err);
      renderDropdown();
    }
  }

  async function fetchSpotSnapshot() {
    try {
      const res = await fetchFn('/api/cache/spot/latest');
      if (res.ok) {
        spotSnapshot = await res.json();
      }
    } catch {
      // 保留旧快照或置空
    }
  }

  function startSpotRefreshLoop() {
    if (spotRefreshTimer) timers.clearInterval(spotRefreshTimer);
    fetchSpotSnapshot();
    spotRefreshTimer = timers.setInterval(fetchSpotSnapshot, 30000);
  }

  function stopSpotRefreshLoop() {
    if (spotRefreshTimer) timers.clearInterval(spotRefreshTimer);
    spotRefreshTimer = null;
  }

  function announce(text) {
    if (!liveRegionElement || !text) return;
    liveRegionElement.textContent = text;
  }

  function renderHighlightedText(container, text, query) {
    if (!text) return;
    const q = (query || '').trim();
    if (!q) {
      container.textContent = text;
      return;
    }
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) {
      container.textContent = text;
      return;
    }
    container.innerHTML = '';
    const before = text.slice(0, idx);
    const matched = text.slice(idx, idx + q.length);
    const after = text.slice(idx + q.length);
    if (before) container.appendChild(document.createTextNode(before));
    const mark = document.createElement('mark');
    mark.className = 'suggest-match-highlight';
    mark.textContent = matched;
    container.appendChild(mark);
    if (after) container.appendChild(document.createTextNode(after));
  }

  function renderDropdown() {
    if (!dropdownElement) return;

    if (!isOpen) {
      dropdownElement.hidden = true;
      dropdownElement.innerHTML = '';
      if (inputElement) {
        inputElement.setAttribute('aria-expanded', 'false');
        inputElement.removeAttribute('aria-activedescendant');
      }
      return;
    }

    dropdownElement.hidden = false;
    if (inputElement) {
      inputElement.setAttribute('aria-expanded', 'true');
    }

    if (dictionaryLoading) {
      dropdownElement.innerHTML = '<div class="suggest-state-row">加载中...</div>';
      return;
    }

    if (dictionaryError) {
      dropdownElement.innerHTML = `
        <div class="suggest-state-row suggest-error">
          名称搜索暂不可用，仍可输入完整代码添加
          <button type="button" class="btn-suggest-retry" id="suggest-retry-btn">重试</button>
        </div>`;
      const retryBtn = dropdownElement.querySelector('#suggest-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          initDictionary().then(() => runSearch(inputElement ? inputElement.value : ''));
        });
      }
      return;
    }

    if (!candidates.length) {
      dropdownElement.innerHTML = '<div class="suggest-state-row">未找到匹配标的，可尝试代码或其他名称</div>';
      if (inputElement) inputElement.removeAttribute('aria-activedescendant');
      return;
    }

    const listEl = document.createElement('ul');
    listEl.className = 'suggest-list';
    listEl.setAttribute('role', 'listbox');

    candidates.forEach((cand, idx) => {
      const itemEl = document.createElement('li');
      itemEl.className = 'suggest-item';
      itemEl.id = `suggest-opt-${idx}`;
      itemEl.setAttribute('role', 'option');

      const isActive = activeIndex === idx;
      const isPreselected = activeIndex === null && defaultSelectedIndex === idx;

      if (isActive) itemEl.classList.add('is-active');
      if (isPreselected) itemEl.classList.add('is-preselected');
      if (cand.alreadyAdded) itemEl.classList.add('is-disabled', 'is-added');

      itemEl.setAttribute('aria-selected', isActive || isPreselected ? 'true' : 'false');
      itemEl.setAttribute('aria-disabled', cand.alreadyAdded ? 'true' : 'false');

      // 规范代码
      const codeSpan = document.createElement('span');
      codeSpan.className = 'suggest-code';
      renderHighlightedText(codeSpan, cand.displayCode, currentQuery);
      itemEl.appendChild(codeSpan);

      // 名称
      const nameSpan = document.createElement('span');
      nameSpan.className = 'suggest-name';
      renderHighlightedText(nameSpan, cand.name, currentQuery);
      itemEl.appendChild(nameSpan);

      // 板块/市场/期货标签
      const boardSpan = document.createElement('span');
      boardSpan.className = 'suggest-board-badge';
      boardSpan.textContent = cand.board;
      itemEl.appendChild(boardSpan);

      // 当日状态
      if (cand.status) {
        const statusSpan = document.createElement('span');
        statusSpan.className = 'suggest-status-badge';
        statusSpan.textContent = cand.status;
        itemEl.appendChild(statusSpan);
      }

      // 曾用名原因
      if (cand.matchedFormerName) {
        const formerSpan = document.createElement('span');
        formerSpan.className = 'suggest-former-name';
        formerSpan.textContent = cand.matchedFormerName;
        itemEl.appendChild(formerSpan);
      }

      // 已添加状态
      if (cand.alreadyAdded) {
        const addedSpan = document.createElement('span');
        addedSpan.className = 'suggest-added-tag';
        addedSpan.textContent = '已添加';
        itemEl.appendChild(addedSpan);
      }

      // 鼠标与触摸支持: 使用 pointerdown 优先于 blur 触发
      itemEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pendingPointerCandidate = cand;
      });

      itemEl.addEventListener('click', (e) => {
        e.preventDefault();
        if (!cand.alreadyAdded) {
          executeAddCandidate(cand);
        }
      });

      listEl.appendChild(itemEl);
    });

    dropdownElement.innerHTML = '';
    dropdownElement.appendChild(listEl);

    if (hasMore) {
      const footerEl = document.createElement('div');
      footerEl.className = 'suggest-footer-row';
      footerEl.textContent = '还有更多结果，请继续输入';
      dropdownElement.appendChild(footerEl);
    }

    if (statusNotice) {
      const noticeEl = document.createElement('div');
      noticeEl.className = 'suggest-status-notice';
      noticeEl.textContent = statusNotice;
      dropdownElement.appendChild(noticeEl);
    }

    if (dictionary?.meta?.asOfDate) {
      const asOfEl = document.createElement('div');
      asOfEl.className = 'suggest-as-of-date';
      asOfEl.textContent = `数据日期: ${dictionary.meta.asOfDate}`;
      dropdownElement.appendChild(asOfEl);
    }

    if (inputElement) {
      const activeOptId = activeIndex !== null
        ? `suggest-opt-${activeIndex}`
        : (defaultSelectedIndex >= 0 ? `suggest-opt-${defaultSelectedIndex}` : null);
      if (activeOptId) {
        inputElement.setAttribute('aria-activedescendant', activeOptId);
      } else {
        inputElement.removeAttribute('aria-activedescendant');
      }
    }
  }

  function runSearch(rawVal) {
    const currentId = ++queryId;
    currentQuery = rawVal;
    activeIndex = null;

    const mode = detectQueryMode(rawVal);
    if (mode === 'empty' || mode === 'batch') {
      isOpen = false;
      candidates = [];
      renderDropdown();
      return;
    }

    if (mode === 'overlong') {
      isOpen = true;
      candidates = [];
      statusNotice = '查询过长，请缩短输入';
      renderDropdown();
      announce(statusNotice);
      return;
    }

    if (!dictionary && !dictionaryLoading && !dictionaryError) {
      initDictionary();
    }

    if (dictionaryLoading || !dictionary) {
      isOpen = true;
      renderDropdown();
      return;
    }

    const watchList = getWatchList();
    const res = searchStocks(rawVal, {
      index: dictionary,
      watchList,
      spotSnapshot,
      maxResults: 12
    });

    if (currentId !== queryId) return;

    candidates = res.items;
    hasMore = res.hasMore;
    statusNotice = res.statusNotice;
    isOpen = true;

    // 默认预选首个可添加候选
    defaultSelectedIndex = candidates.findIndex((c) => !c.alreadyAdded);
    activeIndex = null;

    renderDropdown();

    if (candidates.length) {
      announce(`找到 ${candidates.length} 个建议项`);
    } else {
      announce('未找到匹配标的');
    }
  }

  function handleInputChange() {
    if (!inputElement) return;
    const val = inputElement.value;

    // 输入改变立即取消旧查询的提交资格和活动项 (§3.1)
    ++queryId;
    activeIndex = null;
    pendingPointerCandidate = null;
    candidates = [];
    defaultSelectedIndex = -1;

    if (isBatchQuery(val)) {
      if (debounceTimer) timers.clearTimeout(debounceTimer);
      debounceTimer = null;
      isOpen = false;
      candidates = [];
      defaultSelectedIndex = -1;
      renderDropdown();
      return;
    }

    const trimmed = val.trim();
    if (!trimmed) {
      if (debounceTimer) timers.clearTimeout(debounceTimer);
      debounceTimer = null;
      isOpen = false;
      candidates = [];
      defaultSelectedIndex = -1;
      renderDropdown();
      return;
    }

    if (debounceTimer) timers.clearTimeout(debounceTimer);
    debounceTimer = timers.setTimeout(() => {
      runSearch(inputElement.value);
    }, 150);
  }

  function executeAddCandidate(cand) {
    if (!cand || cand.alreadyAdded) return;
    if (blurTimer) timers.clearTimeout(blurTimer);
    blurTimer = null;
    const prevVal = inputElement ? inputElement.value : '';
    isOpen = false;
    candidates = [];
    activeIndex = null;
    defaultSelectedIndex = -1;
    pendingPointerCandidate = null;
    if (inputElement) {
      inputElement.value = '';
      inputElement.focus();
    }
    renderDropdown();
    try {
      onAddCodes([cand.code]);
    } catch (err) {
      if (inputElement) {
        inputElement.value = prevVal;
      }
      onFlashMessage(`添加失败: ${err.message || err}`, 'error');
    }
  }

  function executeBatchAdd(inputVal) {
    const watchList = getWatchList();
    const details = parseBatchInputDetails(inputVal, watchList);

    if (details.validCodes.length === 0) {
      onFlashMessage('未识别到有效代码', 'error');
      return;
    }

    if (details.newCodes.length === 0) {
      onFlashMessage('所输标的已全在监控列表中', 'warning');
      return;
    }

    let feedback = `成功添加 ${details.newCodes.length} 个标的`;
    if (details.duplicateCodes.length > 0) {
      feedback += `，已忽略 ${details.duplicateCodes.length} 个重复项`;
    }
    if (details.invalidTokens.length > 0) {
      feedback += `，已忽略 ${details.invalidTokens.length} 个无效项`;
    }

    isOpen = false;
    candidates = [];
    activeIndex = null;
    defaultSelectedIndex = -1;
    pendingPointerCandidate = null;
    if (inputElement) {
      inputElement.value = '';
      inputElement.focus();
    }
    renderDropdown();
    try {
      onAddCodes(details.newCodes, { message: feedback });
    } catch (err) {
      if (inputElement) {
        inputElement.value = inputVal;
      }
      onFlashMessage(`批量添加失败: ${err.message || err}`, 'error');
    }
  }

  /**
   * 决策入口：统一 Enter 与「+ 添加」按钮提交 (§3.1)
   */
  function handleSubmit() {
    if (isComposing) return;

    if (pendingPointerCandidate) {
      const cand = pendingPointerCandidate;
      pendingPointerCandidate = null;
      if (!cand.alreadyAdded) {
        executeAddCandidate(cand);
        return;
      }
    }

    const inputVal = inputElement ? inputElement.value : '';
    const trimmed = inputVal.trim();
    if (!trimmed) return;

    // 2. 批量模式优先
    if (isBatchQuery(inputVal)) {
      executeBatchAdd(inputVal);
      return;
    }

    // 3. 方向键主动选中了当前有效候选
    if (activeIndex !== null && candidates[activeIndex]) {
      const cand = candidates[activeIndex];
      if (!cand.alreadyAdded) {
        executeAddCandidate(cand);
        return;
      }
    }

    // 4. 输入是完整可解析代码或期货别名
    const directCode = normalizeFuture(trimmed) || normalizeCode(trimmed);
    if (directCode) {
      const watchList = getWatchList();
      if (watchList.includes(directCode)) {
        onFlashMessage('该标的已在监控列表中', 'warning');
        return;
      }
      if (inputElement) {
        inputElement.value = '';
        inputElement.focus();
      }
      isOpen = false;
      candidates = [];
      defaultSelectedIndex = -1;
      activeIndex = null;
      pendingPointerCandidate = null;
      renderDropdown();
      try {
        onAddCodes([directCode]);
      } catch (err) {
        if (inputElement) {
          inputElement.value = trimmed;
        }
        onFlashMessage(`添加失败: ${err.message || err}`, 'error');
      }
      return;
    }

    // 5. 下拉打开、查询与输入一致、有默认可添加候选
    const normInput = normalizeQuery(inputVal);
    const normCurrent = normalizeQuery(currentQuery);
    if (isOpen && normInput === normCurrent && defaultSelectedIndex >= 0 && candidates[defaultSelectedIndex]) {
      const cand = candidates[defaultSelectedIndex];
      if (!cand.alreadyAdded) {
        executeAddCandidate(cand);
        return;
      }
    }

    // 6. 其他情况：保留输入，明确提示
    if (isOpen && candidates.length && candidates.every((c) => c.alreadyAdded)) {
      onFlashMessage('匹配标的均已在监控列表中', 'warning');
      return;
    }

    if (dictionaryError) {
      onFlashMessage('名称搜索暂不可用，仍可输入完整代码添加', 'warning');
      return;
    }

    onFlashMessage('未识别到匹配标的，可尝试代码或其他名称', 'error');
  }

  function handleKeyDown(e) {
    if (isComposing || e.isComposing === true || e.keyCode === 229) {
      if (e.key === 'Enter') {
        // IME 组合中回车仅确认输入法
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        isOpen = false;
        activeIndex = null;
        renderDropdown();
      }
      return;
    }

    if (e.key === 'Tab') {
      // Tab 移焦不添加，关闭下拉
      if (isOpen) {
        isOpen = false;
        activeIndex = null;
        renderDropdown();
      }
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        if (candidates.length) {
          isOpen = true;
          renderDropdown();
        } else if (inputElement && inputElement.value.trim()) {
          runSearch(inputElement.value);
        }
        return;
      }

      if (!candidates.length) return;

      const addableIndices = [];
      candidates.forEach((c, idx) => {
        if (!c.alreadyAdded) addableIndices.push(idx);
      });

      if (!addableIndices.length) return;

      let currentPos = addableIndices.indexOf(activeIndex);
      if (e.key === 'ArrowDown') {
        currentPos = currentPos < addableIndices.length - 1 ? currentPos + 1 : 0;
      } else {
        currentPos = currentPos > 0 ? currentPos - 1 : addableIndices.length - 1;
      }

      activeIndex = addableIndices[currentPos];
      renderDropdown();

      // 滚动到当前项
      const optEl = dropdownElement?.querySelector(`#suggest-opt-${activeIndex}`);
      if (optEl && typeof optEl.scrollIntoView === 'function') {
        optEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function handleFocus() {
    initDictionary();
    if (inputElement && inputElement.value.trim() && !isBatchQuery(inputElement.value)) {
      runSearch(inputElement.value);
    }
  }

  function handleBlur(e) {
    // 如果焦点移向同一组件内的按钮 (如 + 添加按钮)，不立即丢弃目标
    if (e.relatedTarget && e.relatedTarget.closest('.add-row')) {
      return;
    }
    if (blurTimer) timers.clearTimeout(blurTimer);
    // 延迟关闭以便点击事件触发
    blurTimer = timers.setTimeout(() => {
      blurTimer = null;
      if (isOpen) {
        isOpen = false;
        activeIndex = null;
        renderDropdown();
      }
    }, 150);
  }

  const handleCompositionStart = () => {
    isComposing = true;
  };
  const handleCompositionEnd = () => {
    isComposing = false;
    handleInputChange();
  };

  function bindEvents() {
    if (!inputElement) return;

    inputElement.addEventListener('input', handleInputChange);
    inputElement.addEventListener('keydown', handleKeyDown);
    inputElement.addEventListener('focus', handleFocus);
    inputElement.addEventListener('blur', handleBlur);
    inputElement.addEventListener('compositionstart', handleCompositionStart);
    inputElement.addEventListener('compositionend', handleCompositionEnd);

    startSpotRefreshLoop();
  }

  function destroy() {
    if (debounceTimer) timers.clearTimeout(debounceTimer);
    if (blurTimer) timers.clearTimeout(blurTimer);
    blurTimer = null;
    stopSpotRefreshLoop();
    if (inputElement) {
      inputElement.removeEventListener('input', handleInputChange);
      inputElement.removeEventListener('keydown', handleKeyDown);
      inputElement.removeEventListener('focus', handleFocus);
      inputElement.removeEventListener('blur', handleBlur);
      inputElement.removeEventListener('compositionstart', handleCompositionStart);
      inputElement.removeEventListener('compositionend', handleCompositionEnd);
    }
  }

  return {
    bindEvents,
    handleSubmit,
    runSearch,
    destroy,
    getState: () => ({
      isOpen,
      currentQuery,
      candidates,
      activeIndex,
      defaultSelectedIndex,
      hasMore,
      statusNotice,
      dictionaryLoading,
      dictionaryError
    })
  };
}
