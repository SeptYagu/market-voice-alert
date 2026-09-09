import { getBeijingDate } from '../time.js';
import { createRequestScope } from '../services/requestScope.js';

export function createMonitorController({ getState, fetchQuotes, storage, onRemove = () => {},
  onQuotes = () => {}, onRefresh = () => {}, onStatus = () => {}, clock = () => new Date(), timers = globalThis }) {
  const scope = createRequestScope();
  let timer = null;
  let interval = null;
  let checker = null;
  let lifecycle = 0;
  function getRefreshCodes() {
    const state = getState();
    const codes = new Set([...state.watchList, ...state.subscribed]);
    if (state.limitUp?.selectedDate === getBeijingDate(clock())) {
      for (const item of state.limitUp.items || []) if (item.code) codes.add(item.code);
    }
    return [...codes];
  }
  async function refresh() {
    const codes = getRefreshCodes();
    if (!codes.length) return;
    const token = scope.begin();
    const state = getState();
    state.loading = true;
    state.error = null;
    onStatus();
    try {
      const quotes = await fetchQuotes(codes, { signal: token.signal });
      if (!scope.isCurrent(token)) return;
      const currentCodes = new Set(getRefreshCodes());
      for (const quote of quotes) if (currentCodes.has(quote.code)) state.quotes.set(quote.code, quote);
      state.lastUpdate = clock();
      onQuotes();
    } catch (error) {
      if (scope.isCurrent(token) && error.name !== 'AbortError') state.error = error.message || String(error);
    } finally {
      if (scope.isCurrent(token)) { state.loading = false; onRefresh(); onStatus(); }
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
      timer = timers.setInterval(refresh, interval);
      if (wasPaused || immediate) refresh();
    }
    onStatus();
  }
  function stop() {
    lifecycle++;
    stopTimer(); scope.cancel(); getState().loading = false;
    if (checker !== null) timers.clearInterval(checker);
    checker = null;
  }
  function startChecker(warm, apply) {
    if (checker !== null) timers.clearInterval(checker);
    const owner = ++lifecycle;
    Promise.resolve().then(warm).catch(() => {}).finally(() => { if (owner === lifecycle) apply(); });
    checker = timers.setInterval(apply, 30000);
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
  return { refresh, getRefreshCodes, startChecker, stop, stopTimer, applySchedule, addCodes, removeCodes,
    inspect: () => ({ timerCount: Number(timer !== null) + Number(checker !== null) }) };
}
