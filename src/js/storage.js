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
  if (!entry || typeof entry.fetchedAt !== 'number') return false;

  const fetchedAt = entry.fetchedAt;
  const ageMs = now - fetchedAt;
  if (ageMs < 0) return false;

  const isMinute = MINUTE_PERIODS.has(period);
  const marketOpen = _isMarketOpen(now);

  // 1. 盘中交易时段：严格依据 TTL 判定
  if (marketOpen) {
    const ttlMs = isMinute ? KLINE_MINUTE_TTL_MS : KLINE_TTL_MS;
    return ageMs > ttlMs;
  }

  const nowParts = getBeijingClockParts(new Date(now));
  const fetchParts = getBeijingClockParts(new Date(fetchedAt));
  const isSameDay = nowParts.year === fetchParts.year &&
                    nowParts.month === fetchParts.month &&
                    nowParts.day === fetchParts.day;
  const fetchMinute = fetchParts.hour * 60 + fetchParts.minute;
  const nowMinute = nowParts.hour * 60 + nowParts.minute;

  // 2. 分钟级 K 线在非交易时段
  if (isMinute) {
    // 跨日、超过30分钟、或拉取于收盘前而当前已收盘（缺失尾盘数据）均视为过期
    if (!isSameDay || ageMs > 30 * 60 * 1000) return true;
    if (fetchMinute < 15 * 60 && nowMinute >= 15 * 60) return true;
    return false;
  }

  // 3. 日/周/月 K 线在非交易时段
  // 超过 7 天无条件过期
  if (ageMs > 7 * 24 * 60 * 60 * 1000) return true;

  if (isSameDay) {
    // 同一天：若抓取时处于 15:00 盘中前，而当前已收盘（>=15:00），盘中未收盘日K已过时，需要抓取最终收盘K线
    if (fetchMinute < 15 * 60 && nowMinute >= 15 * 60) {
      return true;
    }
    // 同在上午/午盘前抓取（如午间休市）：遵循 1 小时 TTL
    if (fetchMinute < 15 * 60 && nowMinute < 15 * 60) {
      return ageMs > KLINE_TTL_MS;
    }
    // 15:00 盘后抓取的数据包含当日终盘数据，当晚一直有效
    return false;
  }

  // 跨日情况：
  // 若前一日抓取于 15:00 之前（属于盘中未完成日K），必须重新抓取
  if (fetchMinute < 15 * 60) return true;

  const nowDay = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)).getUTCDay();
  const fetchDay = new Date(Date.UTC(fetchParts.year, fetchParts.month - 1, fetchParts.day)).getUTCDay();

  // 周五盘后（>=15:00）拉取的数据在周六、周日以及周一早盘 09:30 开盘前均保持有效
  if (fetchDay === 5 && (nowDay === 6 || nowDay === 0 || (nowDay === 1 && nowMinute < 9 * 60 + 30)) && ageMs <= 4 * 24 * 60 * 60 * 1000) {
    return false;
  }

  // 工作日盘后（>=15:00）抓取的数据在次日早盘 09:30 开盘前保持有效
  if (nowDay >= 1 && nowDay <= 5 && nowMinute < 9 * 60 + 30 && ageMs < 24 * 60 * 60 * 1000) {
    return false;
  }

  // 工作日一旦已开盘（>=09:30），前日K线视为过期（需要合成或拉取新一日实时日K）
  return true;
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

const _klineAccessTimes = new Map();

export function klineCacheGetAccessTime(code, period) {
  if (!code || !period) return 0;
  const key = `${code}|${period}`;
  if (_klineAccessTimes.has(key)) return _klineAccessTimes.get(key);
  const entry = _readKlineCacheEntry(code, period);
  return entry ? (entry.lastAccessedAt || entry.fetchedAt || 0) : 0;
}

function _getEntryLastAccessed(entry, key) {
  if (_klineAccessTimes.has(key)) return _klineAccessTimes.get(key);
  return (entry && (entry.lastAccessedAt || entry.fetchedAt)) || 0;
}

export function klineCacheGet(code, period) {
  if (!code || !period) return null;
  const entry = _readKlineCacheEntry(code, period);
  if (!entry) return null;
  if (entry && isKlineCacheStale(code, period)) return null;
  // Update in-memory LRU timestamp without synchronously serializing and writing to localStorage
  _klineAccessTimes.set(`${code}|${period}`, Date.now());
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
  _klineAccessTimes.set(key, now);
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
    entries.sort((a, b) => _getEntryLastAccessed(a[1], a[0]) - _getEntryLastAccessed(b[1], b[0]));
    const toRemove = entries.slice(0, entries.length - KLINE_MAX_ENTRIES);
    for (const [k] of toRemove) {
      delete obj.entries[k];
      _klineAccessTimes.delete(k);
    }
  }
  try {
    _writeKlineCacheObject(obj);
  } catch {
    // QuotaExceeded → 删 50% + 重试
    try {
      const retry = Object.entries(obj.entries);
      retry.sort((a, b) => _getEntryLastAccessed(a[1], a[0]) - _getEntryLastAccessed(b[1], b[0]));
      const removeCount = Math.floor(retry.length / 2);
      for (let i = 0; i < removeCount; i++) {
        const k = retry[i][0];
        delete obj.entries[k];
        _klineAccessTimes.delete(k);
      }
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
        _klineAccessTimes.delete(k);
        removed++;
      }
    }
    if (removed > 0) _writeKlineCacheObject(obj);
  } catch { /* ignore */ }
}

export function klineCacheClear() {
  _klineAccessTimes.clear();
  try { remove(KLINE_CACHE_KEY); } catch { /* ignore */ }
}
