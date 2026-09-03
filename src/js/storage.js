import { getBeijingClockParts } from './time.js';

export const STORAGE_KEYS = Object.freeze({
  WATCH_LIST: 'stock_watch_list',
  THEME: 'app_theme',
  SETTINGS: 'app_settings',
  VOICE: 'voice_settings',
  ALERTS: 'price_alerts',
  LIMIT_UP: 'limit_up_settings',
  MOMENTUM_PINS: 'momentum_pinned_codes',
  LIMIT_UP_PINS: 'limit_up_pinned_codes'
});

let _adapter = null;

export function setStorageAdapter(adapter) {
  _adapter = adapter || null;
}

function _storage() {
  if (_adapter) return _adapter;
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

export function getRaw(key) {
  const s = _storage();
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

export function setRaw(key, value) {
  const s = _storage();
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  const s = _storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getJSON(key, defaultValue = null) {
  const raw = getRaw(key);
  if (raw === null || raw === undefined) return defaultValue;
  try {
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

export function setJSON(key, value) {
  try {
    return setRaw(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

export function getWatchList() {
  const list = getJSON(STORAGE_KEYS.WATCH_LIST, []);
  return Array.isArray(list) ? list : [];
}

export function setWatchList(list) {
  const arr = Array.isArray(list) ? list : [];
  setJSON(STORAGE_KEYS.WATCH_LIST, arr);
}

export function addToWatchList(code) {
  if (!code || typeof code !== 'string') return getWatchList();
  const trimmed = code.trim();
  if (!trimmed) return getWatchList();
  const list = getWatchList();
  if (list.includes(trimmed)) return list;
  list.push(trimmed);
  setWatchList(list);
  return list;
}

export function removeFromWatchList(codeOrArray) {
  const toRemove = new Set(
    Array.isArray(codeOrArray) ? codeOrArray : [codeOrArray]
  );
  const next = getWatchList().filter((c) => !toRemove.has(c));
  setWatchList(next);
  return next;
}

export function getTheme() {
  return getRaw(STORAGE_KEYS.THEME);
}

export function setTheme(theme) {
  if (!theme) return;
  setRaw(STORAGE_KEYS.THEME, String(theme));
}

export function getSettings() {
  const s = getJSON(STORAGE_KEYS.SETTINGS, {});
  return s && typeof s === 'object' ? s : {};
}

export function setSettings(obj) {
  setJSON(STORAGE_KEYS.SETTINGS, obj && typeof obj === 'object' ? obj : {});
}

export function patchSettings(patch) {
  if (!patch || typeof patch !== 'object') return getSettings();
  const next = { ...getSettings(), ...patch };
  setSettings(next);
  return next;
}

export function getVoiceSettings() {
  const v = getJSON(STORAGE_KEYS.VOICE, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function setVoiceSettings(obj) {
  setJSON(STORAGE_KEYS.VOICE, obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {});
}

export function patchVoiceSettings(patch) {
  if (!patch || typeof patch !== 'object') return getVoiceSettings();
  const next = { ...getVoiceSettings(), ...patch };
  setVoiceSettings(next);
  return next;
}

export function getAlertSettings() {
  const v = getJSON(STORAGE_KEYS.ALERTS, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function setAlertSettings(obj) {
  setJSON(STORAGE_KEYS.ALERTS, obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {});
}

export function patchAlertSettings(patch) {
  if (!patch || typeof patch !== 'object') return getAlertSettings();
  const next = { ...getAlertSettings(), ...patch };
  setAlertSettings(next);
  return next;
}

export const STORAGE_KEY_SUBSCRIBED = 'subscribed_codes';

export function getSubscribedCodes() {
  const list = getJSON(STORAGE_KEY_SUBSCRIBED, []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string') : [];
}

export function setSubscribedCodes(list) {
  const arr = Array.isArray(list) ? list.filter((c) => typeof c === 'string') : [];
  setJSON(STORAGE_KEY_SUBSCRIBED, arr);
}

function _getCodeList(key) {
  const list = getJSON(key, []);
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const code of list) {
    if (typeof code !== 'string') continue;
    const s = code.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function _setCodeList(key, list) {
  const seen = new Set();
  const out = [];
  for (const code of Array.isArray(list) ? list : []) {
    if (typeof code !== 'string') continue;
    const s = code.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  setJSON(key, out);
  return out;
}

export function getMomentumPinnedCodes() {
  return _getCodeList(STORAGE_KEYS.MOMENTUM_PINS);
}

export function setMomentumPinnedCodes(list) {
  return _setCodeList(STORAGE_KEYS.MOMENTUM_PINS, list);
}

export function getLimitUpPinnedCodes() {
  return _getCodeList(STORAGE_KEYS.LIMIT_UP_PINS);
}

export function setLimitUpPinnedCodes(list) {
  return _setCodeList(STORAGE_KEYS.LIMIT_UP_PINS, list);
}

export const DEFAULT_LIMIT_UP_SETTINGS = Object.freeze({
  refreshInterval: 30000
});

export function normalizeLimitUpSettings(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const raw = Number(src.refreshInterval);
  const allowed = [10000, 30000, 60000];
  const refreshInterval = allowed.includes(raw) ? raw : DEFAULT_LIMIT_UP_SETTINGS.refreshInterval;
  return { refreshInterval };
}

export function getLimitUpSettings() {
  return normalizeLimitUpSettings(getJSON(STORAGE_KEYS.LIMIT_UP, {}));
}

export function setLimitUpSettings(obj) {
  const norm = normalizeLimitUpSettings(obj);
  setJSON(STORAGE_KEYS.LIMIT_UP, norm);
  return norm;
}

export function patchLimitUpSettings(patch) {
  if (!patch || typeof patch !== 'object') return getLimitUpSettings();
  const next = normalizeLimitUpSettings({ ...getLimitUpSettings(), ...patch });
  setJSON(STORAGE_KEYS.LIMIT_UP, next);
  return next;
}

// =====================================================================
// klineCache — K 线数据持久化 (Phase 8)
// Persists K-line responses (32-320 items each) in localStorage so repeat
// openings + period switches skip the 4-5s Eastmoney fetch. Mirrors the
// luCache pattern from Phase 7 but with period-aware keying and 盘中 TTL.
// =====================================================================

export const KLINE_CACHE_KEY = 'kline-cache-v1';
export const KLINE_TTL_MS = 60 * 60 * 1000;     // 盘中 1h
export const KLINE_MINUTE_TTL_MS = 2 * 60 * 1000;
export const KLINE_MAX_ENTRIES = 100;            // 容量上限 (10 stocks × 10 periods)
const MINUTE_PERIODS = new Set(['1m', '5m', '15m', '30m', '60m']);

function _isMarketOpen(now = Date.now()) {
  const d = new Date(now);
  const parts = getBeijingClockParts(d);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  if (day === 0 || day === 6) return false;
  const t = parts.hour * 60 + parts.minute;
  return (t >= 9 * 60 + 30 && t < 11 * 60 + 30) || (t >= 13 * 60 && t < 15 * 60);
}

export function isKlineCacheStale(code, period, now = Date.now()) {
  const entry = _readKlineCacheEntry(code, period);
  if (!entry) return false;
  if (!_isMarketOpen(now)) return false;
  const ttlMs = MINUTE_PERIODS.has(period) ? KLINE_MINUTE_TTL_MS : KLINE_TTL_MS;
  return now - entry.fetchedAt > ttlMs;
}

function _readKlineCacheEntry(code, period) {
  try {
    const raw = getRaw(KLINE_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.entries) return null;
    return obj.entries[`${code}|${period}`] || null;
  } catch {
    return null;
  }
}

function _writeKlineCacheObject(obj) {
  const ok = setRaw(KLINE_CACHE_KEY, JSON.stringify(obj));
  if (!ok) {
    const err = new Error('QuotaExceeded');
    err.name = 'QuotaExceededError';
    throw err;
  }
}

function _readKlineCacheObject() {
  try {
    const raw = getRaw(KLINE_CACHE_KEY);
    if (!raw) return { version: 1, entries: {} };
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || !obj.entries) return { version: 1, entries: {} };
    return obj;
  } catch {
    return { version: 1, entries: {} };
  }
}

export function klineCacheGet(code, period) {
  if (!code || !period) return null;
  const entry = _readKlineCacheEntry(code, period);
  if (!entry) return null;
  if (entry && isKlineCacheStale(code, period)) return null;
  // Update lastAccessedAt
  try {
    const obj = _readKlineCacheObject();
    if (obj.entries[`${code}|${period}`]) {
      obj.entries[`${code}|${period}`].lastAccessedAt = Date.now();
      _writeKlineCacheObject(obj);
    }
  } catch { /* ignore */ }
  return entry.data;
}

export function klineCacheHas(code, period) {
  if (!code || !period) return false;
  return _readKlineCacheEntry(code, period) !== null;
}

export function klineCacheSet(code, period, data) {
  if (!code || !period) return;
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return;
  const key = `${code}|${period}`;
  const now = Date.now();
  let obj;
  try {
    obj = _readKlineCacheObject();
  } catch {
    obj = { version: 1, entries: {} };
  }
  obj.entries[key] = {
    code,
    period,
    data,
    fetchedAt: now,
    lastAccessedAt: now,
    lastBarTime: data.items.length ? data.items[data.items.length - 1].time : 0
  };
  // LRU 容量
  const entries = Object.entries(obj.entries);
  if (entries.length > KLINE_MAX_ENTRIES) {
    entries.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    const toRemove = entries.slice(0, entries.length - KLINE_MAX_ENTRIES);
    for (const [k] of toRemove) delete obj.entries[k];
  }
  try {
    _writeKlineCacheObject(obj);
  } catch {
    // QuotaExceeded → 删 50% + 重试
    try {
      const retry = Object.entries(obj.entries);
      retry.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
      const removeCount = Math.floor(retry.length / 2);
      for (let i = 0; i < removeCount; i++) delete obj.entries[retry[i][0]];
      _writeKlineCacheObject(obj);
    } catch { /* give up */ }
  }
}

export function klineCachePrune() {
  try {
    const obj = _readKlineCacheObject();
    const now = Date.now();
    let removed = 0;
    for (const [k, e] of Object.entries(obj.entries)) {
      if (e && typeof e.fetchedAt === 'number' && isKlineCacheStale(e.code, e.period, now)) {
        delete obj.entries[k];
        removed++;
      }
    }
    if (removed > 0) _writeKlineCacheObject(obj);
  } catch { /* ignore */ }
}

export function klineCacheClear() {
  try { remove(KLINE_CACHE_KEY); } catch { /* ignore */ }
}
