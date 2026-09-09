import { getMarketSession, getVoiceEligibleCodes, normalizeSmartSchedule } from '../marketSession.js';
import { isFutureCode } from '../futures/instrument.js';
import { getFuturesSession } from '../futures/session.js';
import { getBeijingDate } from '../time.js';

export function decideVoiceSchedule({ codes, settings, now, tradingDates = [], previous = null }) {
  const list = [...codes];
  const cfg = normalizeSmartSchedule(settings.smartSchedule);
  const session = getMarketSession(now, tradingDates);
  const date = getBeijingDate(now);
  const eligibleCodes = getVoiceEligibleCodes(list, cfg, now, tradingDates);
  const futures = list.filter(isFutureCode);
  let enabled = settings.enabled;
  if (cfg.enabled && !enabled && cfg.autoStartAuction && session === 'opening-auction' &&
      settings.manualDisabledDate !== date) enabled = true;
  const allowed = eligibleCodes.length > 0;
  const futureBreak = futures.some(code => getFuturesSession(code, now, tradingDates).sessionStatus === 'break');
  const pauseReason = allowed || !cfg.enabled ? null
    : session === 'lunch' || futureBreak ? 'break' : 'closed';
  let transitionNotice = null;
  if (enabled && previous?.timerShouldRun && !allowed && cfg.enabled) {
    if (pauseReason === 'break') transitionNotice = session === 'lunch' ? '中午休市' : '休市';
    else if (cfg.autoStopAfterClose) transitionNotice = '已收盘';
  }
  // Stock-only automatic close remains a persisted off switch. Futures retain
  // the user's armed preference across the gap between day and night sessions.
  if (cfg.enabled && enabled && !futures.length && session === 'after-close' && cfg.autoStopAfterClose) enabled = false;
  return { enabled, eligibleCodes, timerShouldRun: !!enabled && allowed,
    pauseReason, transitionNotice, session, date };
}
