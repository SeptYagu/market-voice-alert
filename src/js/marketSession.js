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
  if (t >= 9 * 60 + 15 && t < 9 * 60 + 25) return 'opening-auction';
  if (t >= 9 * 60 + 30 && t < 11 * 60 + 30) return 'trading';
  if (t >= 11 * 60 + 30 && t < 13 * 60) return 'lunch';
  if (t >= 13 * 60 && t < 15 * 60) return 'trading';
  if (t >= 15 * 60) return 'after-close';
  return 'pre-open';
}

export function normalizeSmartSchedule(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    enabled: src.enabled === undefined ? DEFAULT_SMART_SCHEDULE.enabled : !!src.enabled,
    autoStartAuction: src.autoStartAuction === undefined ? DEFAULT_SMART_SCHEDULE.autoStartAuction : !!src.autoStartAuction,
    pauseLunchBreak: src.pauseLunchBreak === undefined ? DEFAULT_SMART_SCHEDULE.pauseLunchBreak : !!src.pauseLunchBreak,
    autoStopAfterClose: src.autoStopAfterClose === undefined ? DEFAULT_SMART_SCHEDULE.autoStopAfterClose : !!src.autoStopAfterClose
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
