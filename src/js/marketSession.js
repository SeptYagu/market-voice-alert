import { getBeijingClockParts, getBeijingDate } from './time.js';
import { isTradingDate } from './tradeCalendar.js';
import { getFuturesSession } from './futures/session.js';
import { isFutureCode } from './futures/instrument.js';

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

export function getVoiceEligibleCodes(codes, smartSchedule, now = new Date(), tradingDates = []) {
  const cfg = normalizeSmartSchedule(smartSchedule);
  const stockAllowed = isVoiceAllowedInSession(getMarketSession(now, tradingDates), cfg);
  return [...codes].filter(code => !cfg.enabled || (isFutureCode(code)
    ? isFutureTrading(code, now, tradingDates)
    : stockAllowed));
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
 *
 * 在 allowed=false（智能调度判定当前不允许播报）时决定本轮动作：
 * - lunch / pre-open / closed：仅暂停（voicePausedBySchedule），依赖会话
 *   恢复路径在下一个交易时段自动重启计时器；
 * - after-close：执行自动关闭（enabled=false），这是唯一的永久关闭入口。
 *
 * 回归背景（2026-09-09 审查 M1）：曾用 `(session === 'after-close' ||
 * prevAllowed)` 作为关闭条件，导致午休第一拍 prevAllowed=true 就把语音
 * 永久关闭、13:00 无法自动恢复；且午休期间新开页面会误播「已收盘」。
 * @param {object} p
 * @param {string|null} p.prevSession - 上一拍的会话（首次为 null）
 * @param {string} p.session - 当前会话
 * @param {boolean} p.allowed - isVoiceAllowedNow() 的判定结果（已含期货夜盘放行）
 * @param {boolean} p.prevAllowed - 上一拍的允许状态（首次回退为 voice.enabled）
 * @param {object} p.smartSchedule - 智能调度配置
 * @returns {{ pause: boolean, autoStop: boolean, notice: string|null, pausedBySchedule: boolean }}
 */
export function resolveVoiceScheduleAction({ prevSession, session, allowed, prevAllowed, smartSchedule }) {
  const cfg = normalizeSmartSchedule(smartSchedule);
  const idle = { pause: false, autoStop: false, notice: null, pausedBySchedule: false };
  if (!cfg.enabled || allowed) return idle;

  // 收盘自动关闭仅发生在股票 after-close 会话；期货夜盘在 after-close
  // 会话内收盘时同样命中本分支（RB 23:00 等），并补播「已收盘」。
  // 凌晨续段收盘（如沪金 02:30）落在 closed 会话，只暂停、次日自动恢复。
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

// Boolean true is retained for older callers as the widest night contract;
// production callers pass the actual instrument so dates and close times agree.
export function isLiveTradeDate(selectedDate, instrument = false, now = new Date(), tradingDates = []) {
  const future = instrument === true ? 'AU0' : instrument;
  if (future && (typeof future === 'object' || isFutureCode(future))) {
    const session = getFuturesSession(future, now, tradingDates);
    return session.isTrading && (!selectedDate || selectedDate === session.tradingDay);
  }
  return !selectedDate || selectedDate === getBeijingDate(now);
}
