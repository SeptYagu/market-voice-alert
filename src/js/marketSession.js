import { getBeijingClockParts, getBeijingDate, shiftCalendarDate } from './time.js';
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

export function isAutoRefreshAllowedInSession(session, smartSchedule) {
  const cfg = normalizeSmartSchedule(smartSchedule);
  if (!cfg.enabled) return true;
  if (session === 'trading') return true;
  if (session === 'opening-auction') return !!cfg.autoStartAuction;
  if (session === 'lunch') return !cfg.pauseLunchBreak;
  if (session === 'after-close') return !cfg.autoStopAfterClose;
  return false;
}

export function isFuturesMarketOpen(now = new Date(), tradingDates = []) {
  const clock = getBeijingClockParts(now);
  const timeMin = clock.hour * 60 + clock.minute;
  const beijingToday = getBeijingDate(now);
  const beijingDate = new Date(Date.UTC(clock.year, clock.month - 1, clock.day, 12, 0, 0));
  const beijingDayOfWeek = beijingDate.getUTCDay();
  const isWeekend = beijingDayOfWeek === 0 || beijingDayOfWeek === 6;
  const hasCalendar = Array.isArray(tradingDates) && tradingDates.length > 0;
  const isTradingDay = hasCalendar ? tradingDates.includes(beijingToday) : !isWeekend;

  // 1. 日盘：08:55 - 11:30, 13:00 - 15:15
  if (isTradingDay && ((timeMin >= 8 * 60 + 55 && timeMin <= 11 * 60 + 30) || (timeMin >= 13 * 60 && timeMin <= 15 * 60 + 15))) {
    return true;
  }

  // 2. 当晚夜盘：20:55 - 24:00 (周一至周五工作日)
  if (isTradingDay && beijingDayOfWeek >= 1 && beijingDayOfWeek <= 5 && timeMin >= 20 * 60 + 55 && timeMin < 24 * 60) {
    if (hasCalendar) {
      const idx = tradingDates.indexOf(beijingToday);
      if (idx !== -1 && idx < tradingDates.length - 1) {
        const nextTradeDate = tradingDates[idx + 1];
        const nextDayOffset = beijingDayOfWeek === 5 ? 3 : 1;
        const expectedNextDate = shiftCalendarDate(beijingToday, nextDayOffset);
        if (nextTradeDate !== expectedNextDate) {
          // 节前最后一个交易日夜盘不交易
          return false;
        }
      }
    }
    return true;
  }

  // 3. 次日凌晨跨午夜夜盘：00:00 - 02:30 (周二至周六凌晨)
  if (beijingDayOfWeek >= 2 && beijingDayOfWeek <= 6 && timeMin <= 2 * 60 + 30) {
    if (hasCalendar) {
      const prevCalendarDay = shiftCalendarDate(beijingToday, -1);
      if (!tradingDates.includes(prevCalendarDay)) {
        return false;
      }
      const prevDateObj = new Date(Date.UTC(clock.year, clock.month - 1, clock.day - 1, 12, 0, 0));
      const prevDow = prevDateObj.getUTCDay();
      const prevIdx = tradingDates.indexOf(prevCalendarDay);
      if (prevIdx !== -1 && prevIdx < tradingDates.length - 1) {
        const nextOfPrev = tradingDates[prevIdx + 1];
        const expectedNextOfPrev = shiftCalendarDate(prevCalendarDay, prevDow === 5 ? 3 : 1);
        if (nextOfPrev !== expectedNextOfPrev) {
          return false;
        }
      }
    }
    return true;
  }

  return false;
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
