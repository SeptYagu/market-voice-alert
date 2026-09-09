import { getBeijingClockParts, getBeijingDate } from './time.js';
import { isTradingDate } from './tradeCalendar.js';

export { getBeijingDate };

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

export function isAutoRefreshAllowedInSession(session, smartSchedule) {
  const cfg = normalizeSmartSchedule(smartSchedule);
  if (!cfg.enabled) return true;
  if (session === 'trading') return true;
  if (session === 'opening-auction') return !!cfg.autoStartAuction;
  if (session === 'lunch') return !cfg.pauseLunchBreak;
  if (session === 'after-close') return !cfg.autoStopAfterClose;
  return false;
}

import {
  isFutureTrading,
  isAnyFutureTrading,
  isFuturesMarketOpenFallback
} from './futures/session.js';

export { isFutureTrading, isAnyFutureTrading };

export function isFuturesMarketOpen(now = new Date(), tradingDates = [], codes = []) {
  if (Array.isArray(codes) && codes.length > 0) {
    return isAnyFutureTrading(codes, now, tradingDates);
  }
  return isFuturesMarketOpenFallback(now, tradingDates);
}

export function isLiveTradeDate(selectedDate, isFuture = false, now = new Date(), _tradingDates = []) {
  const clock = getBeijingClockParts(now);
  const beijingToday = getBeijingDate(now);
  const timeMin = clock.hour * 60 + clock.minute;
  const dt = new Date(Date.UTC(clock.year, clock.month - 1, clock.day, 12, 0, 0));
  const dow = dt.getUTCDay();

  if (!selectedDate) return true;

  if (isFuture) {
    // 1. 周六凌晨 (00:00 - 02:30) 为周五夜盘续段，归属下周一交易日
    if (dow === 6) {
      if (timeMin <= 2 * 60 + 30) {
        dt.setUTCDate(dt.getUTCDate() + 2);
        const mondayStr = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
        return selectedDate === mondayStr;
      }
      return false;
    }

    // 2. 如果在夜盘时段 (20:55以后)，选中的日期等于下一个交易日，亦属于 live 会话
    if (timeMin >= 20 * 60 + 50) {
      const delta = dow === 5 ? 3 : 1;
      dt.setUTCDate(dt.getUTCDate() + delta);
      const nextDayStr = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      if (selectedDate === nextDayStr) return true;
    }
  }

  return selectedDate === beijingToday;
}
