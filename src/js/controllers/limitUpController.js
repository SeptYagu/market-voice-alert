import { createRequestScope } from '../services/requestScope.js';
// 涨停看板控制器（状态、数据抓取、筛选排序与图表交互）
import {
  fetchLimitUpList,
  fetchLimitUpReasons,
  fetchLimitUpMetadataBatch,
  clearLimitUpMetadataCache
} from '../limitUpApi.js';
import { buildLimitUpGroups, mergeLiveTicks, sortLimitUpGroupItems } from '../limitUp.js';
import { renderLimitUpPage, getLimitUpViewGroups } from '../limitUpView.js';
import {
  fetchTradeCalendar,
  getAdjacentTradingDates,
  resolveLatestTradingDate
} from '../tradeCalendar.js';
import { getBeijingDate } from '../time.js';
import { fetchQuotes } from '../api.js';
import {
  createChartState
} from './chartRowController.js';
import {
  setLimitUpPinnedCodes,
  patchLimitUpSettings
} from '../storage.js';

/**
 * 结构校验（R3 回归，纯函数便于测试）：DOM 的分组数量/顺序/每组行序
 * 必须与最新计算的 groups/items 完全一致。行情变化（如炸板）可能把
 * 个股在分组间移动或改变组内排序，只改单元格会把行留在错误分组且
 * 计数过期；任一不匹配返回 false，由调用方走全量重绘。
 *
 * 置顶分组感知（2026-09-09 审查修正）：limitUpView.buildGroups 始终在最前
 * 渲染一个 data-group="pinned" 的置顶分组（空置顶也渲染），且置顶股会从
 * 其原分组中剔除。因此比较时跳过首位置的 pinned 区，并把 expectedGroups
 * 中的置顶股从各组剔除后逐组比对；置顶区按独立排序配置校验代码序列；总行数必须等于
 * items.length。置顶/取消置顶引起的变化会自然导致计数不匹配而触发重绘。
 * @param {Element} groupsSection - 包含 #lu-groups 的容器元素
 * @param {Array<{key: string, items: Array<{code: string}>}>} expectedGroups
 * @param {Array<{code: string}>} items - 全部涨停项（含置顶股）
 * @param {Set<string>|string[]} [pinnedCodes] - 当前置顶代码集合
 * @returns {boolean}
 */
export function limitUpRowsMatchDom(groupsSection, expectedGroups, items, pinnedCodes, pinnedSort = { key: 'amount', direction: 'desc' }) {
  if (!groupsSection) return false;
  const domGroups = Array.from(groupsSection.querySelectorAll('section.lu-group[data-group]'));
  const groups = expectedGroups || [];
  const pins = pinnedCodes instanceof Set ? pinnedCodes : new Set(pinnedCodes || []);

  // 渲染器始终在最前渲染置顶分组；有置顶时普通组已剔除置顶股
  const hasPinnedSection = domGroups.length > 0 && domGroups[0].getAttribute('data-group') === 'pinned';
  const itemByCode = new Map((items || []).map(item => [item.code, item]));
  const pinnedItems = sortLimitUpGroupItems(
    [...pins].map(code => itemByCode.get(code)).filter(Boolean), pinnedSort.key, pinnedSort.direction
  );
  const pinnedRows = hasPinnedSection ? [...domGroups[0].querySelectorAll('tr[data-code]')] : [];
  if (pinnedRows.length !== pinnedItems.length ||
      pinnedRows.some((row, index) => row.getAttribute('data-code') !== pinnedItems[index].code)) return false;
  const dataGroups = hasPinnedSection ? domGroups.slice(1) : domGroups;
  if (dataGroups.length !== groups.length) return false;

  let totalRows = hasPinnedSection ? domGroups[0].querySelectorAll('tr[data-code]').length : 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const sec = dataGroups[i];
    if (sec.getAttribute('data-group') !== g.key) return false;
    const domRows = sec.querySelectorAll('tr[data-code]');
    const gItems = (g.items || []).filter((it) => !pins.has(it.code));
    totalRows += gItems.length;
    if (domRows.length !== gItems.length) return false;
    for (let j = 0; j < gItems.length; j++) {
      if (domRows[j].getAttribute('data-code') !== gItems[j].code) return false;
    }
  }
  return totalRows === (items || []).length;
}

import { DEFAULT_PERIOD, isValidPeriod } from '../kline.js';

export function applyLimitUpFetchResult(luState, items) {
  const prev = luState || {};
  const now = new Date();
  const sortKey = prev.sortKey || 'amount';
  if (Array.isArray(items) && items.length > 0) {
    const next = {
      ...prev,
      sortKey,
      items,
      lastNonEmptyItems: items,
      lastNonEmptyAt: now,
      consecutiveEmptyFetches: 0
    };
    return { ...next, groups: buildLimitUpGroupsForState(next) };
  }
  const cached = Array.isArray(prev.lastNonEmptyItems) ? prev.lastNonEmptyItems : [];
  const displayItems = cached.length ? cached : [];
  const next = {
    ...prev,
    sortKey,
    items: displayItems,
    consecutiveEmptyFetches: (Number(prev.consecutiveEmptyFetches) || 0) + 1
  };
  return { ...next, groups: buildLimitUpGroupsForState(next) };
}

export function buildLimitUpGroupsForState(luState) {
  const s = luState || {};
  const baseSort = s.sortKey || 'amount';
  const groups = buildLimitUpGroups(s.items || [], baseSort);
  const groupSort = s.groupSort || {};
  return groups.map((g) => {
    const sort = groupSort[g.key] || { key: baseSort, direction: 'desc' };
    return {
      ...g,
      items: sortLimitUpGroupItems(g.items, sort.key || baseSort, sort.direction || 'desc')
    };
  });
}

export function hasLimitUpMetadata(item) {
  if (!item) return false;
  return (
    item.limitUpCount !== undefined &&
    item.firstLimitTime !== undefined &&
    item.lastLimitTime !== undefined &&
    item.breakCount !== undefined
  );
}

export function createLimitUpController(appContext) {
  const {
    getState,
    limitUpChartMgr,
    onNavigate,
    onAddToWatchList,
    flashInfo,
    refreshNow,
    renderData,
    isDataAutoRefreshAllowedNow,
    preloadKlineForCodes
  } = appContext;

  let limitUpRootEl = null;
  const listScope = createRequestScope();

  function getLimitUpState() {
    return getState().limitUp;
  }

  function isLimitUpDateToday(date = getLimitUpState().selectedDate) {
    return date === getBeijingDate();
  }

  function updateLimitUpStatusBar() {
    if (!limitUpRootEl) return;
    const statusEl = limitUpRootEl.querySelector('#lu-status');
    if (!statusEl) return;
    const lu = getLimitUpState();
    const parts = [];
    const total = (lu.groups || []).reduce((s, g) => s + (g.items ? g.items.length : 0), 0);
    parts.push(`共 ${total} 只涨停`);
    if (lu.loading) parts.push('加载中...');
    if (lu.error) parts.push(`错误: ${lu.error}`);
    if (lu.consecutiveEmptyFetches > 0 && lu.lastNonEmptyAt) {
      const ts = lu.lastNonEmptyAt.toLocaleTimeString();
      parts.push(`缓存自 ${ts} · 已空 ${lu.consecutiveEmptyFetches} 次`);
    } else if (lu.lastUpdate) {
      parts.push(`更新于 ${lu.lastUpdate.toLocaleTimeString()}`);
    }
    statusEl.textContent = parts.join(' · ');
  }

  function patchLimitUpQuoteCells() {
    if (!limitUpRootEl) return false;
    const groupsSection = limitUpRootEl.querySelector('#lu-groups');
    if (!groupsSection) return false;

    rerenderLimitUpPage();
    updateLimitUpStatusBar();
    return true;
  }

  function rerenderLimitUpPage() {
    if (!limitUpRootEl) return;
    const lu = getLimitUpState();
    const visible = new Set(getLimitUpViewGroups(lu).flatMap(g => g.items.map(item => item.code)));
    for (const code of [...lu.selectedCodes]) if (!visible.has(code)) lu.selectedCodes.delete(code);
    for (const code of [...lu.expandedCodes]) if (!visible.has(code)) closeLimitUpChart(code, { render: false });
    renderLimitUpPage(limitUpRootEl, lu, {
      navigateTo: (path) => onNavigate(path),
      addToWatchListAndNavigate: handleLimitUpAddAndNavigate,
      onRefreshChange: handleLimitUpRefreshChange,
      fetchList: fetchLimitUpListNow,
      onLiveTickUpdate: applyLiveTicksToLimitUp,
      onSortChange: handleLimitUpSortChange,
      sortGroup: handleLimitUpGroupSort,
      toggleAutoRefresh: handleLimitUpAutoRefreshToggle,
      togglePin: handleLimitUpPinToggle,
      toggleSelect: handleLimitUpToggleSelect,
      selectAll: handleLimitUpSelectAll,
      selectNone: handleLimitUpSelectNone,
      addSelectedAndNavigate: handleLimitUpAddSelectedAndNavigate,
      openKline: handleLimitUpOpenKline,
      closeKline: handleLimitUpCloseKline,
      changeKlinePeriod: handleLimitUpKlinePeriodChange,
      onDateChange: handleLimitUpDateChange,
      reloadKline: _handleLimitUpForceReloadChart
    });
    for (const code of lu.expandedCodes) {
      if (lu.expandedCodes.has(code)) {
        mountLimitUpChart(code);
      }
    }
  }

  async function ensureLimitUpTradingDate(
    rawDate = getLimitUpState().selectedDate || getBeijingDate(),
    requestSeq = null
  ) {
    const lu = getLimitUpState();
    lu.calendarLoading = true;
    try {
      const dates = await fetchTradeCalendar();
      const target = rawDate || getBeijingDate();
      const resolved = resolveLatestTradingDate(target, dates);
      const adj = getAdjacentTradingDates(resolved, dates);
      if (requestSeq !== null && requestSeq !== lu.requestSeq) {
        return resolved;
      }
      getState().tradingDates = dates;
      lu.tradingDates = dates;
      lu.selectedDate = resolved;
      lu.latestTradingDate = adj.latest;
      lu.previousTradingDate = adj.previous;
      lu.nextTradingDate = adj.next;
      return resolved;
    } finally {
      if (requestSeq === null || requestSeq === lu.requestSeq) {
        lu.calendarLoading = false;
      }
    }
  }

  function refreshLimitUpDateMeta() {
    const lu = getLimitUpState();
    const dates = lu.tradingDates;
    const adj = getAdjacentTradingDates(
      lu.selectedDate || getBeijingDate(),
      dates,
      getBeijingDate()
    );
    lu.selectedDate = adj.current;
    lu.latestTradingDate = adj.latest;
    lu.previousTradingDate = adj.previous;
    lu.nextTradingDate = adj.next;
  }

  function fetchLimitUpListNow() {
    clearLimitUpMetadataCache();
    const lu = getLimitUpState();
    lu.forceRefreshOnce = isLimitUpDateToday();
    return limitUpFetch();
  }

  async function limitUpFetch() {
    const lu = getLimitUpState();
    if (lu.loading) return;
    if (lu.abort) {
      try { lu.abort.abort(); } catch { /* ignore */ }
    }
    const requestSeq = lu.requestSeq + 1;
    lu.requestSeq = requestSeq;
    const token = listScope.begin();
    const controller = token.controller;
    lu.abort = controller;
    lu.loading = true;
    lu.error = null;
    if (!lu.items.length || !limitUpRootEl || !limitUpRootEl.firstElementChild) {
      rerenderLimitUpPage();
    } else {
      updateLimitUpStatusBar();
    }
    try {
      const date = await ensureLimitUpTradingDate(
        lu.selectedDate || getBeijingDate(),
        requestSeq
      );
      if (!listScope.isCurrent(token) || requestSeq !== lu.requestSeq || lu.selectedDate !== date) return;
      const forceRefresh = !!lu.forceRefreshOnce;
      lu.forceRefreshOnce = false;
      const rawItems = await fetchLimitUpList({
        signal: controller.signal,
        date,
        sharedCache: true,
        includeBroken: true,
        forceRefresh
      });
      if (!listScope.isCurrent(token) || requestSeq !== lu.requestSeq || lu.selectedDate !== date) return;
      lu.lastUpdate = new Date();
      const updated = applyLimitUpFetchResult(lu, rawItems);
      Object.assign(lu, updated);
      if (!patchLimitUpQuoteCells()) {
        rerenderLimitUpPage();
      }
      if (isLimitUpDateToday(date)) {
        enrichLimitUpItemsWithQuotes(rawItems, controller.signal)
          .then((quoteEnriched) => {
            const currentLu = getLimitUpState();
            if (!listScope.isCurrent(token) || requestSeq !== currentLu.requestSeq || currentLu.selectedDate !== date) return;
            const quoteMap = new Map(quoteEnriched.map((it) => [it.code, it]));
            currentLu.items = currentLu.items.map((it) => {
              const q = quoteMap.get(it.code);
              return q ? {
                ...it,
                price: q.price,
                change: q.change,
                changePercent: q.changePercent,
                amount: q.amount,
                open: q.open,
                openChangePercent: q.openChangePercent,
                volumeRatio: q.volumeRatio
              } : it;
            });
            currentLu.groups = buildLimitUpGroupsForState(currentLu);
            if (!patchLimitUpQuoteCells()) {
              rerenderLimitUpPage();
            }
          })
          .catch(() => { /* best-effort live quote enrichment */ });
      }
      kickoffLimitUpMetadataFetch(rawItems, date, requestSeq, controller.signal);
      kickoffLimitUpReasonsFetch(date, forceRefresh, requestSeq, controller.signal);
      if (rawItems.length && typeof preloadKlineForCodes === 'function') {
        preloadKlineForCodes(rawItems.slice(0, 10).map((it) => it.code));
      }
    } catch (e) {
      if (listScope.isCurrent(token) && requestSeq === lu.requestSeq && e && e.name !== 'AbortError') {
        lu.error = e.message || String(e);
      }
    } finally {
      if (listScope.isCurrent(token) && requestSeq === lu.requestSeq) {
        if (lu.abort === controller) lu.abort = null;
        lu.loading = false;
        updateLimitUpStatusBar();
      }
    }
  }


  async function enrichLimitUpItemsWithQuotes(items, signal) {
    if (!Array.isArray(items) || !items.length) return [];
    try {
      const quotes = await fetchQuotes(items.map((it) => it.code), { signal });
      const quoteMap = new Map(quotes.map((q) => [q.code, q]));
      return items.map((it) => {
        const q = quoteMap.get(it.code);
        if (!q) return it;
        return {
          ...it,
          price: Number.isFinite(Number(q.price)) && Number(q.price) > 0 ? Number(q.price) : it.price,
          change: Number.isFinite(Number(q.change)) ? Number(q.change) : it.change,
          changePercent: Number.isFinite(Number(q.changePercent)) ? Number(q.changePercent) : it.changePercent,
          prevClose: Number.isFinite(Number(q.prevClose)) ? Number(q.prevClose) : it.prevClose,
          open: Number.isFinite(Number(q.open)) ? Number(q.open) : it.open,
          openChangePercent: Number.isFinite(Number(q.openChangePercent)) ? Number(q.openChangePercent) : it.openChangePercent,
          volumeRatio: Number.isFinite(Number(q.volumeRatio)) ? Number(q.volumeRatio) : it.volumeRatio,
          amount: Number.isFinite(Number(q.amount)) && Number(q.amount) > 0 ? Number(q.amount) : it.amount
        };
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      return items;
    }
  }

  function kickoffLimitUpMetadataFetch(items, date, requestSeq = getLimitUpState().requestSeq, signal) {
    if (!Array.isArray(items) || !items.length) return;
    const codes = items.filter((it) => !hasLimitUpMetadata(it)).map((it) => it.code).filter(Boolean);
    if (!codes.length) return;
    fetchLimitUpMetadataBatch(codes, { date, signal })
      .then((metaMap) => {
        const lu = getLimitUpState();
        if (requestSeq !== lu.requestSeq || lu.selectedDate !== date) return;
        if (!metaMap || !metaMap.size) return;
        if (!lu.items.length) return;
        let changed = false;
        const merged = lu.items.map((it) => {
          const m = metaMap.get(it.code);
          if (!m) return it;
          changed = true;
          return { ...it, ...m };
        });
        if (!changed) return;
        lu.items = merged;
        lu.groups = buildLimitUpGroupsForState(lu);
        if (!patchLimitUpQuoteCells()) {
          rerenderLimitUpPage();
        }
      })
      .catch(() => { /* best-effort; ignore */ });
  }

  function kickoffLimitUpReasonsFetch(date, forceRefresh = false, requestSeq = getLimitUpState().requestSeq, signal) {
    fetchLimitUpReasons({ date, sharedCache: true, forceRefresh, signal })
      .then((reasonMap) => {
        const lu = getLimitUpState();
        if (requestSeq !== lu.requestSeq || lu.selectedDate !== date) return;
        if (!reasonMap) return;
        lu.reasonMap = reasonMap;
        if (!lu.items.length) return;
        let changed = false;
        const merged = lu.items.map((it) => {
          const r = reasonMap.get(it.code);
          if (!r) return it;
          if (it.reason === r.reason && it.interpretation === r.interpretation) return it;
          changed = true;
          return { ...it, reason: r.reason, interpretation: r.interpretation };
        });
        if (!changed) return;
        lu.items = merged;
        lu.groups = buildLimitUpGroupsForState(lu);
        if (!patchLimitUpQuoteCells()) {
          rerenderLimitUpPage();
        }
      })
      .catch(() => { /* best-effort; ignore */ });
  }

  function handleLimitUpDateChange(newDate) {
    closeAllLimitUpCharts();
    clearLimitUpMetadataCache();
    const lu = getLimitUpState();
    listScope.cancel();
    lu.requestSeq += 1;
    if (lu.abort) {
      try { lu.abort.abort(); } catch { /* ignore */ }
      lu.abort = null;
    }
    lu.selectedDate = newDate || getBeijingDate();
    lu.forceRefreshOnce = lu.selectedDate === getBeijingDate();
    lu.items = [];
    lu.groups = buildLimitUpGroupsForState(lu);
    lu.lastNonEmptyItems = [];
    lu.lastNonEmptyAt = null;
    lu.consecutiveEmptyFetches = 0;
    lu.reasonMap = new Map();
    lu.error = null;
    lu.loading = true;
    rerenderLimitUpPage();
    lu.loading = false;
    limitUpFetch();
  }

  function applyLiveTicksToLimitUp() {
    const lu = getLimitUpState();
    if (!lu.items.length) return;
    if (!isLimitUpDateToday()) return;
    const merged = mergeLiveTicks(lu.items, getState().quotes);
    if (merged === lu.items) return;
    lu.items = merged;
    lu.groups = buildLimitUpGroupsForState(lu);
    if (!patchLimitUpQuoteCells()) {
      rerenderLimitUpPage();
    }
  }

  function startLimitUpTimer({ immediate = true } = {}) {
    stopLimitUpTimer({ abort: false });
    const lu = getLimitUpState();
    if (!lu.autoRefreshEnabled) {
      lu.autoRefreshPausedBySchedule = false;
      rerenderLimitUpPage();
      return;
    }
    if (!isDataAutoRefreshAllowedNow()) {
      lu.autoRefreshPausedBySchedule = true;
      rerenderLimitUpPage();
      return;
    }
    const interval = lu.refreshInterval;
    if (!interval || interval < 1000) return;
    lu.autoRefreshPausedBySchedule = false;
    if (immediate) limitUpFetch();
    lu.timer = setInterval(() => {
      limitUpFetch();
    }, interval);
  }

  function stopLimitUpTimer({ abort = true } = {}) {
    const lu = getLimitUpState();
    if (lu.timer) {
      clearInterval(lu.timer);
      lu.timer = null;
    }
    if (abort) {
      listScope.cancel();
      lu.requestSeq += 1;
      lu.loading = false;
      lu.calendarLoading = false;
    }
    if (abort && lu.abort) {
      try { lu.abort.abort(); } catch { /* ignore */ }
      lu.abort = null;
    }
  }

  function handleLimitUpRefreshChange(newIntervalMs) {
    const lu = getLimitUpState();
    lu.refreshInterval = newIntervalMs;
    patchLimitUpSettings({ refreshInterval: newIntervalMs });
    if (lu.autoRefreshEnabled) startLimitUpTimer({ immediate: false });
  }

  function handleLimitUpAutoRefreshToggle(enabled) {
    const lu = getLimitUpState();
    lu.autoRefreshEnabled = !!enabled;
    if (enabled) startLimitUpTimer();
    else {
      stopLimitUpTimer();
      lu.autoRefreshPausedBySchedule = false;
    }
    rerenderLimitUpPage();
  }

  function handleLimitUpAddAndNavigate(code) {
    if (!code) return;
    onAddToWatchList(code);
  }

  function handleLimitUpSortChange(key) {
    const allowed = ['count', 'pct', 'time', 'amount', 'price', 'open', 'volumeRatio', 'break'];
    if (!allowed.includes(key)) return;
    const lu = getLimitUpState();
    lu.sortKey = key;
    lu.groups = buildLimitUpGroupsForState(lu);
    rerenderLimitUpPage();
  }

  function handleLimitUpGroupSort(groupKey, key) {
    const allowed = ['count', 'pct', 'time', 'amount', 'price', 'open', 'volumeRatio', 'break'];
    if (!groupKey || !allowed.includes(key)) return;
    const lu = getLimitUpState();
    const current = (lu.groupSort && lu.groupSort[groupKey]) || null;
    const direction = current && current.key === key && current.direction === 'desc' ? 'asc' : 'desc';
    lu.groupSort = {
      ...(lu.groupSort || {}),
      [groupKey]: { key, direction }
    };
    lu.groups = buildLimitUpGroupsForState(lu);
    rerenderLimitUpPage();
  }

  function handleLimitUpPinToggle(code) {
    if (!code) return;
    const lu = getLimitUpState();
    const pins = new Set(lu.pinnedCodes || []);
    if (pins.has(code)) pins.delete(code);
    else pins.add(code);
    lu.pinnedCodes = pins;
    setLimitUpPinnedCodes([...pins]);
    rerenderLimitUpPage();
  }

  function handleLimitUpToggleSelect(code, checked) {
    if (!code) return;
    const lu = getLimitUpState();
    if (checked) lu.selectedCodes.add(code);
    else lu.selectedCodes.delete(code);
    rerenderLimitUpPage();
  }

  function handleLimitUpSelectAll() {
    const lu = getLimitUpState();
    lu.selectedCodes = new Set(lu.items.map((it) => it.code));
    rerenderLimitUpPage();
  }

  function handleLimitUpSelectNone() {
    const lu = getLimitUpState();
    lu.selectedCodes = new Set();
    rerenderLimitUpPage();
  }

  function handleLimitUpAddSelectedAndNavigate() {
    const lu = getLimitUpState();
    const codes = lu.selectedCodes;
    if (!codes || !codes.size) return;
    let added = 0;
    const state = getState();
    for (const code of codes) {
      if (!state.watchList.includes(code)) {
        onAddToWatchList(code, { silent: true });
        added++;
      }
    }
    lu.selectedCodes = new Set();
    flashInfo(added > 0 ? `已加入监控 ${added} 只` : '已选标的已在监控列表');
    onNavigate('#/');
    refreshNow();
    renderData();
  }

  function handleLimitUpOpenKline(code) {
    if (!code) return;
    const lu = getLimitUpState();
    if (lu.expandedCodes.has(code)) {
      closeLimitUpChart(code);
      return;
    }
    lu.expandedCodes.add(code);
    lu.chartInstances.set(code, createChartState(DEFAULT_PERIOD));
    rerenderLimitUpPage();
    loadLimitUpKline(code);
  }

  function closeLimitUpChart(code, { render = true } = {}) {
    const lu = getLimitUpState();
    if (!code || !lu.expandedCodes.has(code)) return;
    lu.expandedCodes.delete(code);
    limitUpChartMgr.destroyCharts(code);
    lu.chartInstances.delete(code);
    if (render) rerenderLimitUpPage();
  }

  function closeAllLimitUpCharts() {
    const lu = getLimitUpState();
    for (const code of [...lu.expandedCodes]) closeLimitUpChart(code, { render: false });
    rerenderLimitUpPage();
  }

  function handleLimitUpCloseKline(code) {
    if (code) closeLimitUpChart(code);
    else closeAllLimitUpCharts();
  }

  function handleLimitUpKlinePeriodChange(p, code) {
    if (!isValidPeriod(p)) return;
    const lu = getLimitUpState();
    const inst = lu.chartInstances.get(code);
    if (!inst || inst.period === p) return;
    inst.period = p;
    inst.klineData = null;
    inst.loading = true;
    inst.error = null;
    inst.intradayData = null;
    inst.intradayError = null;
    inst._visibleRange = null;
    inst._intradayVisibleRange = null;
    if (inst.abort) try { inst.abort.abort(); } catch { /* ignore */ }
    rerenderLimitUpPage();
    loadLimitUpKline(code);
  }

  function _handleLimitUpForceReloadChart(code) {
    if (!code) return;
    const lu = getLimitUpState();
    const inst = lu.chartInstances.get(code);
    if (!inst) return;
    inst.klineData = null;
    inst.loading = true;
    inst.error = null;
    inst._visibleRange = null;
    inst._intradayVisibleRange = null;
    if (inst.abort) try { inst.abort.abort(); } catch { /* ignore */ }
    rerenderLimitUpPage();
    // Force reload must bypass the kline cache, otherwise the "重新加载"
    // button can serve the stale cached data it was meant to replace.
    loadLimitUpKline(code, { force: true });
  }

  function _destroyLimitUpChart(code) {
    limitUpChartMgr.destroyCharts(code, { abort: false });
  }

  function mountLimitUpChart(code) {
    limitUpChartMgr.mountCharts(code);
  }

  function applyLimitUpLiveTickToChart(code, quoteOrPrice) {
    limitUpChartMgr.applyLiveTick(code, quoteOrPrice);
  }

  function loadLimitUpKline(code, options) {
    // Pass through options (e.g. { force: true }) so callers can bypass caches.
    limitUpChartMgr.loadKline(code, options);
  }

  return {
    setRootEl: (el) => { limitUpRootEl = el; },
    getRootEl: () => limitUpRootEl,
    render: rerenderLimitUpPage,
    fetch: limitUpFetch,
    fetchListNow: fetchLimitUpListNow,
    applyLiveTicks: applyLiveTicksToLimitUp,
    startTimer: startLimitUpTimer,
    stopTimer: stopLimitUpTimer,
    closeChart: closeLimitUpChart,
    closeAllCharts: closeAllLimitUpCharts,
    mountChart: mountLimitUpChart,
    loadKline: loadLimitUpKline,
    applyLiveTickToChart: applyLimitUpLiveTickToChart,
    ensureTradingDate: ensureLimitUpTradingDate,
    refreshDateMeta: refreshLimitUpDateMeta,
    isDateToday: isLimitUpDateToday,
    handleRefreshChange: handleLimitUpRefreshChange,
    handleAutoRefreshToggle: handleLimitUpAutoRefreshToggle,
    handleDateChange: handleLimitUpDateChange,
    handleSortChange: handleLimitUpSortChange,
    handleGroupSort: handleLimitUpGroupSort,
    handlePinToggle: handleLimitUpPinToggle,
    handleToggleSelect: handleLimitUpToggleSelect,
    handleSelectAll: handleLimitUpSelectAll,
    handleSelectNone: handleLimitUpSelectNone,
    handleAddAndNavigate: handleLimitUpAddAndNavigate,
    handleAddSelectedAndNavigate: handleLimitUpAddSelectedAndNavigate,
    handleOpenKline: handleLimitUpOpenKline,
    handleCloseKline: handleLimitUpCloseKline,
    handleKlinePeriodChange: handleLimitUpKlinePeriodChange,
    handleForceReloadChart: _handleLimitUpForceReloadChart,
    destroyChart: _destroyLimitUpChart
  };
}
