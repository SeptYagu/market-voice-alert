// 10 日强势股控制器（状态管理、扫描、图表与行情合并）
import {
  renderMomentumSectionView,
  updateMomentumQuoteCells as updateMomentumQuoteCellsView
} from '../views/momentumView.js';
import {
  fetchSharedMomentum,
  startSharedMomentumScan,
  fetchMomentumUniverse,
  scanMomentumCandidate,
  mergePinnedMomentumItems as mergePinnedMomentumItemsService,
  MOMENTUM_SCAN_CONCURRENCY
} from '../services/momentumScanner.js';
import {
  createChartState,
  rememberRange
} from './chartRowController.js';
import {
  setMomentumPinnedCodes
} from '../storage.js';
import { DEFAULT_PERIOD } from '../kline.js';

export function createMomentumController(appContext) {
  const {
    getState,
    momentumChartMgr,
    onToggleSubscribe
  } = appContext;

  let momentumPollTimer = null;

  function getMomentumState() {
    return getState().momentum;
  }

  function renderMomentumSection() {
    const wrap = document.getElementById('momentum-section');
    if (!wrap) return;
    const mState = getMomentumState();
    const appState = getState();
    renderMomentumSectionView(wrap, {
      momentumState: mState,
      subscribedCodes: appState.subscribed,
      defaultPeriod: DEFAULT_PERIOD,
      beforeRerenderClean: () => {
        for (const code of mState.expandedCodes || []) {
          const inst = mState.chartInstances.get(code);
          const ctl = momentumChartMgr.klineCtlMap.get(code);
          rememberRange(inst, ctl, '_visibleRange');
          if (ctl) {
            try { ctl.destroy(); } catch { /* ignore */ }
            momentumChartMgr.klineCtlMap.delete(code);
          }
        }
      },
      callbacks: {
        onScan: handleMomentumScan,
        onStop: stopMomentumScan,
        onSelectAllChange: handleMomentumSelectAllChange,
        onToggleSelect: handleMomentumToggleSelect,
        onToggleSubscribe: onToggleSubscribe,
        onPinToggle: handleMomentumPinToggle,
        onRowClick: handleMomentumRowClick,
        onPeriodChange: handleMomentumKlinePeriodChange,
        onForceReload: handleMomentumForceReloadChart,
        onCloseChart: closeMomentumChart,
        onAfterMountCharts: () => {
          for (const code of mState.expandedCodes || []) {
            mountMomentumChart(code);
          }
        }
      }
    });
  }

  function handleMomentumSelectAllChange(checked, codes) {
    const mState = getMomentumState();
    if (checked) {
      mState.selectedCodes = new Set(codes);
    } else {
      for (const code of codes) mState.selectedCodes.delete(code);
    }
    renderMomentumSection();
  }

  function handleMomentumToggleSelect(code, checked) {
    if (!code) return;
    const mState = getMomentumState();
    if (checked) mState.selectedCodes.add(code);
    else mState.selectedCodes.delete(code);
    renderMomentumSection();
  }

  function handleMomentumRowClick(code, e) {
    const target = e && e.target;
    if (target && target.tagName === 'INPUT') return;
    if (target && target.tagName === 'BUTTON') return;
    if (target && target.closest && target.closest('.momentum-chart-row')) return;
    const mState = getMomentumState();
    if (mState.expandedCodes.has(code)) closeMomentumChart(code);
    else openMomentumChart(code);
  }

  function stopMomentumScan() {
    if (momentumPollTimer) {
      clearTimeout(momentumPollTimer);
      momentumPollTimer = null;
    }
    const mState = getMomentumState();
    if (mState.abort) {
      try { mState.abort.abort(); } catch { /* ignore */ }
    }
    mState.abort = null;
    mState.loading = false;
    mState.serverScanning = false;
    mState.message = '已停止页面轮询；服务端任务可继续在后台完成';
    renderMomentumSection();
  }

  function mergePinnedMomentumItems(nextItems) {
    const mState = getMomentumState();
    return mergePinnedMomentumItemsService(nextItems, mState.pinnedCodes, mState.items);
  }

  function _mergeMomentumQuotesSafely(items) {
    const appState = getState();
    for (const item of items || []) {
      if (!item || !item.code) continue;
      const existing = appState.quotes.get(item.code);
      if (existing) {
        appState.quotes.set(item.code, {
          ...item,
          ...existing,
          price: Number.isFinite(Number(item.price)) ? Number(item.price) : existing.price,
          changePercent: Number.isFinite(Number(item.changePercent)) ? Number(item.changePercent) : existing.changePercent,
          amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : existing.amount,
          type: 'stock'
        });
      } else {
        appState.quotes.set(item.code, { ...item, type: 'stock' });
      }
    }
  }

  async function handleMomentumScan(options = {}) {
    const mState = getMomentumState();
    const appState = getState();
    if (mState.loading) return;
    if (mState.abort) {
      try { mState.abort.abort(); } catch { /* ignore */ }
    }
    const abort = new AbortController();
    mState.abort = abort;
    mState.loading = true;
    if (!options || options.poll !== true) mState.serverScanning = false;
    mState.message = null;
    mState.error = null;
    mState.scanned = 0;
    mState.total = 0;
    renderMomentumSection();
    try {
      if (!options || options.poll !== true) {
        await startSharedMomentumScan(abort.signal);
        mState.serverScanning = true;
      }
      let cached = null;
      try {
        cached = await fetchSharedMomentum(abort.signal);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        cached = null;
      }
      if (cached && Array.isArray(cached.items)) {
        mState.total = cached.universeSize || cached.items.length;
        mState.scanned = cached.scanned || mState.total;
        mState.items = mergePinnedMomentumItems(cached.items);
        if (cached.status === 'scanning') {
          mState.serverScanning = true;
          mState.message = '服务端扫描中，稍后自动刷新';
          if (momentumPollTimer) clearTimeout(momentumPollTimer);
          momentumPollTimer = setTimeout(() => {
            momentumPollTimer = null;
            if (mState.serverScanning && !mState.loading) handleMomentumScan({ poll: true });
          }, 5000);
          return;
        }
        mState.serverScanning = false;
        if (cached.status === 'empty') {
          mState.error = cached.message || '等待服务端定时扫描生成结果';
          return;
        }
        if (cached.status === 'error') {
          mState.error = cached.error || '后端全市场扫描失败，已保留部分结果';
          return;
        }
        if (cached.status === 'partial') {
          mState.message = cached.message || '部分股票数据源刷新失败；当前仅展示有效结果';
        }
        _mergeMomentumQuotesSafely(mState.items);
        mState.lastUpdate = new Date();
        return;
      }

      const universe = await fetchMomentumUniverse({
        signal: abort.signal,
        watchList: appState.watchList,
        limitUpItems: appState.limitUp ? appState.limitUp.items : []
      });
      if (!universe.length) throw new Error('没有可扫描的股票池');
      mState.total = universe.length;
      renderMomentumSection();
      const found = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < universe.length) {
          const idx = cursor;
          cursor += 1;
          if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const candidate = universe[idx];
          try {
            const item = await scanMomentumCandidate(candidate, {
              signal: abort.signal,
              limitUpItems: appState.limitUp ? appState.limitUp.items : []
            });
            if (item) found.push(item);
          } catch (e) {
            if (e && e.name === 'AbortError') throw e;
          } finally {
            mState.scanned += 1;
            if (mState.scanned % 25 === 0 || mState.scanned === mState.total) {
              renderMomentumSection();
            }
          }
        }
      };
      const workerCount = Math.min(MOMENTUM_SCAN_CONCURRENCY, universe.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
      mState.items = mergePinnedMomentumItems(found);
      _mergeMomentumQuotesSafely(mState.items);
      mState.lastUpdate = new Date();
    } catch (e) {
      mState.serverScanning = false;
      if (e && e.name !== 'AbortError') mState.error = e.message || String(e);
    } finally {
      if (mState.abort === abort) mState.abort = null;
      mState.loading = false;
      renderMomentumSection();
    }
  }

  function handleMomentumPinToggle(code) {
    if (!code) return;
    const mState = getMomentumState();
    const pins = new Set(mState.pinnedCodes);
    if (pins.has(code)) pins.delete(code);
    else pins.add(code);
    mState.pinnedCodes = pins;
    setMomentumPinnedCodes([...pins]);
    mState.items = pins.has(code)
      ? mergePinnedMomentumItems(mState.items)
      : mState.items.filter((it) => it.code !== code || !it.pinnedOnly);
    renderMomentumSection();
  }

  function openMomentumChart(code) {
    const mState = getMomentumState();
    if (!code || mState.expandedCodes.has(code)) return;
    mState.expandedCodes.add(code);
    mState.chartInstances.set(code, createChartState(DEFAULT_PERIOD));
    renderMomentumSection();
    momentumChartMgr.loadKline(code);
  }

  function closeMomentumChart(code) {
    const mState = getMomentumState();
    if (!code || !mState.expandedCodes.has(code)) return;
    mState.expandedCodes.delete(code);
    momentumChartMgr.destroyCharts(code);
    const inst = mState.chartInstances.get(code);
    if (inst && inst.abort) {
      try { inst.abort.abort(); } catch { /* ignore */ }
    }
    mState.chartInstances.delete(code);
    renderMomentumSection();
  }

  function closeAllMomentumCharts() {
    const mState = getMomentumState();
    for (const code of [...mState.expandedCodes]) {
      closeMomentumChart(code);
    }
  }

  function handleMomentumKlinePeriodChange(code, period) {
    momentumChartMgr.handlePeriodChange(period, code);
  }

  function handleMomentumForceReloadChart(code) {
    momentumChartMgr.loadKline(code, { force: true });
  }

  function mountMomentumChart(code) {
    momentumChartMgr.mountCharts(code);
  }

  function mergeQuotesIntoMomentumItems() {
    const mState = getMomentumState();
    if (!Array.isArray(mState.items) || !mState.items.length) return false;
    const appState = getState();
    let changed = false;
    mState.items = mState.items.map((it) => {
      if (!it || !it.code) return it;
      const q = appState.quotes.get(it.code);
      if (!q) return it;
      changed = true;
      const price = Number.isFinite(Number(q.price)) ? Number(q.price) : it.price;
      const startClose = Number(it.startClose);
      const gainPercent = (Number.isFinite(price) && Number.isFinite(startClose) && startClose > 0)
        ? Number((((price - startClose) / startClose) * 100).toFixed(2))
        : it.gainPercent;
      return {
        ...it,
        name: q.name || it.name,
        price,
        gainPercent,
        changePercent: Number.isFinite(Number(q.changePercent)) ? Number(q.changePercent) : it.changePercent,
        amount: Number.isFinite(Number(q.amount)) ? Number(q.amount) : it.amount,
        volumeRatio: Number.isFinite(Number(q.volumeRatio)) ? Number(q.volumeRatio) : it.volumeRatio,
        industry: it.industry || q.industry || ''
      };
    });
    return changed;
  }

  function updateMomentumQuoteCells(code) {
    updateMomentumQuoteCellsView(code, getMomentumState().items || []);
  }

  return {
    render: renderMomentumSection,
    stopScan: stopMomentumScan,
    handleScan: handleMomentumScan,
    handleSelectAllChange: handleMomentumSelectAllChange,
    handleToggleSelect: handleMomentumToggleSelect,
    handleRowClick: handleMomentumRowClick,
    handlePinToggle: handleMomentumPinToggle,
    openChart: openMomentumChart,
    closeChart: closeMomentumChart,
    closeAllCharts: closeAllMomentumCharts,
    handleKlinePeriodChange: handleMomentumKlinePeriodChange,
    handleForceReloadChart: handleMomentumForceReloadChart,
    mountChart: mountMomentumChart,
    mergeQuotesIntoItems: mergeQuotesIntoMomentumItems,
    updateQuoteCells: updateMomentumQuoteCells,
    mergePinnedItems: mergePinnedMomentumItems
  };
}
