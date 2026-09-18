import { getBeijingClockParts, getBeijingDate, chartSecondsToDate, chartSecondsToTime, chartTimeToDate, shiftCalendarDate } from './time.js';
import { isTradingDate } from './tradeCalendar.js';
import { getFuturesSession, isFutureTrading, isAnyFutureTrading, isFuturesMarketOpenFallback, getFuturesSessionRanges } from './futures/session.js';
import { isFutureCode } from './futures/instrument.js';
import { inferAssetType, ASSET_TYPES, setStrategyResolver } from './parser.js';

export { getBeijingDate, isFutureTrading, isAnyFutureTrading };

export const DEFAULT_SMART_SCHEDULE = Object.freeze({
  enabled: true,
  autoStartAuction: false,
  pauseLunchBreak: true,
  autoStopAfterClose: true
});

function _minutesInBeijing(now = new Date()) {
  const parts = getBeijingClockParts(now);
  return parts.hour * 60 + parts.minute;
}

export function getMarketSession(now = new Date(), tradingDates = []) {
  const date = getBeijingDate(now);
  if (!isTradingDate(date, tradingDates)) return 'closed';
  const t = _minutesInBeijing(now);
  if (t >= 9 * 60 + 15 && t < 9 * 60 + 30) return 'opening-auction';
  if (t >= 9 * 60 + 30 && t < 11 * 60 + 30) return 'trading';
  if (t >= 11 * 60 + 30 && t < 13 * 60) return 'lunch';
  if (t >= 13 * 60 && t < 15 * 60) return 'trading';
  if (t >= 15 * 60) return 'after-close';
  return 'pre-open';
}

export function normalizeSmartSchedule(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SMART_SCHEDULE };
  return {
    enabled: raw.enabled !== undefined ? !!raw.enabled : DEFAULT_SMART_SCHEDULE.enabled,
    autoStartAuction: raw.autoStartAuction !== undefined ? !!raw.autoStartAuction : DEFAULT_SMART_SCHEDULE.autoStartAuction,
    pauseLunchBreak: raw.pauseLunchBreak !== undefined ? !!raw.pauseLunchBreak : DEFAULT_SMART_SCHEDULE.pauseLunchBreak,
    autoStopAfterClose: raw.autoStopAfterClose !== undefined ? !!raw.autoStopAfterClose : DEFAULT_SMART_SCHEDULE.autoStopAfterClose
  };
}

export function isVoiceAllowedInSession(session, smartSchedule) {
  return isAutoRefreshAllowedInSession(session, smartSchedule);
}

export function isAutoRefreshAllowedInSession(session, smartSchedule) {
  const cfg = normalizeSmartSchedule(smartSchedule);
  if (!cfg.enabled) return true;
  if (session === 'trading') return true;
  if (session === 'opening-auction') return !!cfg.autoStartAuction;
  if (session === 'lunch') return !cfg.pauseLunchBreak;
  if (session === 'after-close') return !cfg.autoStopAfterClose;
  return false;
}

export function isUsDaylightSavingTime(date = new Date()) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'short'
    });
    const parts = dtf.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (tzPart) return tzPart === 'EDT';
  } catch {
    // fallback
  }
  const year = date.getUTCFullYear();
  const marchFirst = new Date(Date.UTC(year, 2, 1));
  const marchFirstDow = marchFirst.getUTCDay();
  const secondSunMarch = 1 + ((7 - marchFirstDow) % 7) + 7;
  const dstStart = new Date(Date.UTC(year, 2, secondSunMarch, 7, 0, 0));

  const novFirst = new Date(Date.UTC(year, 10, 1));
  const novFirstDow = novFirst.getUTCDay();
  const firstSunNov = 1 + ((7 - novFirstDow) % 7);
  const dstEnd = new Date(Date.UTC(year, 10, firstSunNov, 6, 0, 0));

  return date >= dstStart && date < dstEnd;
}

export function getUsEasternDate(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now);
    const pick = (t) => parts.find((p) => p.type === t)?.value || '';
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
  } catch {
    return getBeijingDate(now);
  }
}

export const chinaStockStrategy = Object.freeze({
  assetType: ASSET_TYPES.STOCK_CN,
  isTradingNow(now = new Date()) {
    const session = getMarketSession(now);
    return session === 'trading';
  },
  getSession(now = new Date()) {
    return getMarketSession(now);
  },
  getIntradaySessionRanges() {
    return [[555, 690], [780, 900]];
  },
  getTradingDay(now = new Date()) {
    if (typeof now === 'number') {
      return chartTimeToDate(now);
    }
    const dateObj = typeof now === 'string' ? new Date(now) : now;
    return getBeijingDate(dateObj);
  },
  isVoiceAllowed(now = new Date(), cfg = DEFAULT_SMART_SCHEDULE, tradingDates = []) {
    if (!cfg.enabled) return true;
    const session = getMarketSession(now, tradingDates);
    if (session === 'opening-auction') {
      const min = _minutesInBeijing(now);
      if (min >= 9 * 60 + 20 && min < 9 * 60 + 30) return true;
      return !!cfg.autoStartAuction;
    }
    return isVoiceAllowedInSession(session, cfg);
  }
});

export const chinaFuturesStrategy = Object.freeze({
  assetType: ASSET_TYPES.FUTURES_CN,
  isTradingNow(now = new Date(), code) {
    if (!code) return isFuturesMarketOpenFallback(now);
    return isFutureTrading(code, now);
  },
  getSession(now = new Date(), code) {
    if (!code) return 'closed';
    const sess = getFuturesSession(code, now);
    if (sess.sessionStatus === 'trading') return 'trading';
    if (sess.sessionStatus === 'break') return 'lunch';
    if (sess.sessionStatus === 'auction') return 'pre-open';
    return 'after-close';
  },
  getIntradaySessionRanges(now = new Date(), code) {
    if (!code) return [];
    return getFuturesSessionRanges(code, now);
  },
  getTradingDay(now = new Date(), code) {
    if (typeof now === 'number') {
      if (!code) return chartTimeToDate(now);
      const dateObj = new Date(now * 1000);
      const sess = getFuturesSession(code, dateObj);
      return sess.tradingDay || chartTimeToDate(now);
    }
    const dateObj = typeof now === 'string' ? new Date(now) : now;
    if (!code) return getBeijingDate(dateObj);
    const sess = getFuturesSession(code, dateObj);
    return sess.tradingDay || getBeijingDate(dateObj);
  },
  isVoiceAllowed(now = new Date(), cfg, tradingDates = [], code) {
    if (!cfg.enabled) return true;
    if (!code) return isFuturesMarketOpenFallback(now, tradingDates);
    return isFutureTrading(code, now, tradingDates);
  }
});

export const hkStockStrategy = Object.freeze({
  assetType: ASSET_TYPES.STOCK_HK,
  isTradingNow(now = new Date()) {
    const parts = getBeijingClockParts(now);
    const dateObj = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
    const dow = dateObj.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const min = parts.hour * 60 + parts.minute;
    return (min >= 9 * 60 + 30 && min < 12 * 60) || (min >= 13 * 60 && min < 16 * 60);
  },
  getSession(now = new Date(), _code) {
    const parts = getBeijingClockParts(now);
    const dateObj = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
    const dow = dateObj.getUTCDay();
    if (dow === 0 || dow === 6) return 'closed';
    const min = parts.hour * 60 + parts.minute;
    if (min < 9 * 60 + 30) return 'pre-open';
    if (min < 12 * 60) return 'trading';
    if (min < 13 * 60) return 'lunch';
    if (min < 16 * 60) return 'trading';
    return 'after-close';
  },
  getIntradaySessionRanges() {
    return [[570, 720], [781, 960]];
  },
  getTradingDay(now = new Date()) {
    if (typeof now === 'number') {
      return chartTimeToDate(now);
    }
    const dateObj = typeof now === 'string' ? new Date(now) : now;
    return getBeijingDate(dateObj);
  },
  isVoiceAllowed(now = new Date(), cfg) {
    if (!cfg.enabled) return true;
    return this.isTradingNow(now);
  }
});

export const usStockStrategy = Object.freeze({
  assetType: ASSET_TYPES.STOCK_US,
  isTradingNow(now = new Date()) {
    const dst = isUsDaylightSavingTime(now);
    const parts = getBeijingClockParts(now);
    const min = parts.hour * 60 + parts.minute;
    const isTradingMin = dst
      ? (min >= 21 * 60 + 30 || min < 4 * 60)
      : (min >= 22 * 60 + 30 || min < 5 * 60);
    if (!isTradingMin) return false;

    const usDate = getUsEasternDate(now);
    const [y, m, d] = usDate.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
    return dow >= 1 && dow <= 5;
  },
  getSession(now = new Date()) {
    return this.isTradingNow(now) ? 'trading' : 'closed';
  },
  getIntradaySessionRanges(now = new Date()) {
    const dst = isUsDaylightSavingTime(now);
    return dst ? [[1290, 1440], [0, 240]] : [[1350, 1440], [0, 300]];
  },
  getTradingDay(now = new Date()) {
    if (typeof now === 'number') {
      return getUsEasternDate(new Date(now * 1000));
    }
    const dateObj = (typeof now === 'string') ? new Date(now) : now;
    return getUsEasternDate(dateObj);
  },
  isVoiceAllowed(now = new Date(), cfg) {
    if (!cfg.enabled) return true;
    return this.isTradingNow(now);
  }
});

export const globalFuturesStrategy = Object.freeze({
  assetType: ASSET_TYPES.FUTURES_GLOBAL,
  isTradingNow(now = new Date()) {
    const dst = isUsDaylightSavingTime(now);
    const parts = getBeijingClockParts(now);
    const min = parts.hour * 60 + parts.minute;
    const dow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0)).getUTCDay();

    const breakStart = dst ? 5 * 60 : 6 * 60;
    const breakEnd = dst ? 6 * 60 : 7 * 60;

    if (dow === 0) return false; // Sunday closed
    if (dow === 6 && min >= breakStart) return false; // Saturday after close
    if (dow === 1 && min < breakEnd) return false; // Monday before open

    // Daily settlement window:
    if (min >= breakStart && min < breakEnd) return false;

    return true;
  },
  getSession(now = new Date()) {
    return this.isTradingNow(now) ? 'trading' : 'closed';
  },
  getIntradaySessionRanges(now = new Date()) {
    const dst = isUsDaylightSavingTime(now);
    return dst ? [[360, 1440], [0, 300]] : [[420, 1440], [0, 360]];
  },
  getTradingDay(now = new Date()) {
    if (typeof now === 'number') {
      const dateStr = chartSecondsToDate(now);
      const timeStr = chartSecondsToTime(now);
      const [h, mi] = timeStr.split(':').map(Number);
      const min = h * 60 + mi;
      const dst = isUsDaylightSavingTime(new Date(now * 1000));
      const breakEnd = dst ? 6 * 60 : 7 * 60;
      return min < breakEnd ? shiftCalendarDate(dateStr, -1) : dateStr;
    }
    const dateObj = (typeof now === 'string') ? new Date(now) : now;
    const parts = getBeijingClockParts(dateObj);
    const min = parts.hour * 60 + parts.minute;
    const baseDate = getBeijingDate(dateObj);
    const dst = isUsDaylightSavingTime(dateObj);
    const breakEnd = dst ? 6 * 60 : 7 * 60;
    return min < breakEnd ? shiftCalendarDate(baseDate, -1) : baseDate;
  },
  isVoiceAllowed(now = new Date(), cfg) {
    if (!cfg.enabled) return true;
    return this.isTradingNow(now);
  }
});

export function resolveSessionStrategy(code) {
  const asset = inferAssetType(code);
  switch (asset) {
    case ASSET_TYPES.STOCK_CN: return chinaStockStrategy;
    case ASSET_TYPES.FUTURES_CN: return chinaFuturesStrategy;
    case ASSET_TYPES.STOCK_HK: return hkStockStrategy;
    case ASSET_TYPES.STOCK_US: return usStockStrategy;
    case ASSET_TYPES.FUTURES_GLOBAL: return globalFuturesStrategy;
    default:
      return chinaStockStrategy;
  }
}

export function getVoiceEligibleCodes(codes, smartSchedule, now = new Date(), tradingDates = []) {
  const cfg = normalizeSmartSchedule(smartSchedule);
  return [...codes].filter(code => {
    const strategy = resolveSessionStrategy(code);
    return strategy.isVoiceAllowed(now, cfg, tradingDates, code);
  });
}

// Returns the spoken reminder for a session transition, or null.
// Only fires when the matching auto-pause option is on (the reminder
// accompanies the pause/stop that the smart schedule performs).
export function getSessionTransitionNotice(prevSession, nextSession, smartSchedule) {
  if (!prevSession || prevSession === nextSession) return null;
  if (prevSession !== 'trading') return null;
  const cfg = normalizeSmartSchedule(smartSchedule);
  if (!cfg.enabled) return null;
  if (nextSession === 'lunch' && cfg.pauseLunchBreak) return '中午休市';
  if (nextSession === 'after-close' && cfg.autoStopAfterClose) return '已收盘';
  return null;
}

/**
 * 语音调度「停用分支」的统一决策（纯函数，便于回归测试）。
 */
export function resolveVoiceScheduleAction({ prevSession, session, allowed, prevAllowed, smartSchedule }) {
  const cfg = normalizeSmartSchedule(smartSchedule);
  const idle = { pause: false, autoStop: false, notice: null, pausedBySchedule: false };
  if (!cfg.enabled || allowed) return idle;

  const autoStop = !!cfg.autoStopAfterClose && session === 'after-close';
  let notice = getSessionTransitionNotice(prevSession, session, cfg);
  if (!notice && autoStop && prevAllowed) notice = '已收盘';
  return {
    pause: true,
    autoStop,
    notice,
    pausedBySchedule: session === 'lunch' || session === 'pre-open' || session === 'closed'
  };
}

export function isFuturesMarketOpen(now = new Date(), tradingDates = [], codes = []) {
  if (Array.isArray(codes) && codes.length > 0) {
    return isAnyFutureTrading(codes, now, tradingDates);
  }
  return isFuturesMarketOpenFallback(now, tradingDates);
}

export function isLiveTradeDate(selectedDate, instrument = false, now = new Date(), tradingDates = []) {
  const future = instrument === true ? 'AU0' : instrument;
  if (future && (typeof future === 'object' || isFutureCode(future))) {
    const session = getFuturesSession(future, now, tradingDates);
    return session.isTrading && (!selectedDate || selectedDate === session.tradingDay);
  }
  return !selectedDate || selectedDate === getBeijingDate(now);
}

setStrategyResolver(resolveSessionStrategy);
