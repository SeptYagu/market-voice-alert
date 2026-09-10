import { getBeijingDate } from '../time.js';
import { createRequestScope } from '../services/requestScope.js';

export function createMonitorController({ getState, fetchQuotes, fetchKline, storage, onRemove = () => {},
  onQuotes = () => {}, onRefresh = () => {}, onStatus = () => {}, clock = () => new Date(), timers = globalThis }) {
  const scope = createRequestScope();
  const preloadScope = createRequestScope();
  let preloadTimer = null;
  let timer = null;
  let interval = null;
  let checker = null;
  let lifecycle = 0;
  let inFlight = false;
  function getRefreshCodes() {
    const state = getState();
    const codes = new Set([...(state.watchList || []), ...(state.subscribed || [])]);
    if (state.limitUp?.selectedDate === getBeijingDate(clock())) {
      for (const item of state.limitUp.items || []) if (item?.code) codes.add(item.code);
    }
    for (const item of state.momentum?.items || []) if (item?.code) codes.add(item.code);
    return [...codes];
  }
  async function refresh({ forced = true } = {}) {
    if (inFlight && !forced) return;
    const codes = getRefreshCodes();
    if (!codes.length) return;
    inFlight = true;
    const token = scope.begin();
    const state = getState();
    state.loading = true;
    state.error = null;
    onStatus();
    try {
      const res = await fetchQuotes(codes, { signal: token.signal });
      if (!scope.isCurrent(token)) return;
      const quotes = Array.isArray(res) ? res : (res && res.quotes) || [];
      const failedCodes = (res && res.failedCodes) || [];
      if (Array.isArray(quotes) && quotes.length > 0) {
        const currentCodes = new Set(getRefreshCodes());
        for (const quote of quotes) {
          if (currentCodes.has(quote.code)) {
            quote.stale = false;
            quote.lastEffectiveTime = clock();
            state.quotes.set(quote.code, quote);
          }
        }
        for (const failCode of failedCodes) {
          if (state.quotes.has(failCode)) {
            const old = state.quotes.get(failCode);
            state.quotes.set(failCode, { ...old, stale: true });
          }
        }
        state.lastUpdate = clock();
        state.failedCodes = failedCodes;
        onQuotes();
      }
    } catch (error) {
      if (scope.isCurrent(token) && error.name !== 'AbortError') state.error = error.message || String(error);
    } finally {
      if (scope.isCurrent(token)) {
        inFlight = false;
        state.loading = false;
        onRefresh();
        onStatus();
      }
    }
  }
  function stopTimer() {
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
    interval = null;
  }
  function applySchedule(allowed, visible = true, { immediate = false } = {}) {
    const state = getState();
    const wasPaused = state.autoRefreshPausedBySchedule;
    state.autoRefreshPausedBySchedule = !!state.autoRefreshEnabled && !allowed;
    if (!visible || !state.autoRefreshEnabled || !allowed) stopTimer();
    else if (interval !== state.refreshInterval) {
      stopTimer();
      interval = state.refreshInterval;
      timer = timers.setInterval(() => refresh({ forced: false }), interval);
      if (wasPaused || immediate) refresh({ forced: true });
    }
    onStatus();
  }
  function stop() {
    lifecycle++;
    inFlight = false;
    stopTimer(); scope.cancel(); preloadScope.cancel(); getState().loading = false;
    if (preloadTimer !== null) timers.clearTimeout(preloadTimer);
    preloadTimer = null;
    if (checker !== null) timers.clearInterval(checker);
    checker = null;
  }
  function startChecker(warm, apply) {
    if (checker !== null) timers.clearInterval(checker);
    const owner = ++lifecycle;
    Promise.resolve().then(warm).catch(() => {}).finally(() => { if (owner === lifecycle) apply(); });
    checker = timers.setInterval(apply, 30000);
  }
  function preload(codes) {
    if (!fetchKline || !codes?.length) return;
    if (preloadTimer !== null) timers.clearTimeout(preloadTimer);
    const token = preloadScope.begin();
    let cursor = 0;
    const next = async () => {
      preloadTimer = null;
      if (!preloadScope.isCurrent(token)) return;
      const batch = codes.slice(cursor, cursor += 3);
      await Promise.allSettled(batch.map(code => fetchKline(code, { period: '1d', sharedCache: true, signal: token.signal })));
      if (preloadScope.isCurrent(token) && cursor < codes.length) preloadTimer = timers.setTimeout(next, 200);
    };
    preloadTimer = timers.setTimeout(next, 0);
  }
  function addCodes(codes) {
    const state = getState();
    const added = [...new Set(codes)].filter(code => !state.watchList.includes(code));
    for (const code of added) storage.add(code);
    state.watchList = storage.get();
    return added;
  }
  function removeCodes(codes) {
    const state = getState();
    storage.remove(codes);
    for (const code of codes) {
      state.selected.delete(code);
      state.quotes.delete(code);
      state.subscribed.delete(code);
      delete state.alertStates[code];
      onRemove(code);
    }
    state.watchList = storage.get();
  }
  return { refresh, preload, getRefreshCodes, startChecker, stop, stopTimer, applySchedule, addCodes, removeCodes,
    inspect: () => ({ inFlight: !!inFlight, timerCount: Number(timer !== null) + Number(checker !== null) + Number(preloadTimer !== null) }) };
}
