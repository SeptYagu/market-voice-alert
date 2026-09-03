import { getFuturesSession } from '../../../server/futures/futuresSessionService.js';

export { getFuturesSession };

export function isFuturesTrading(instrument, now = new Date(), tradingDates = []) {
  const s = getFuturesSession(instrument, now, tradingDates);
  return !!s.isTrading;
}

export function formatFuturesSessionLabel(sessionInfo) {
  if (!sessionInfo) return '已闭市';
  switch (sessionInfo.sessionStatus) {
    case 'trading':
      return sessionInfo.sessionKind === 'night' ? '🌙 夜盘交易中' : '🟢 交易中';
    case 'auction':
      return '🟡 集合竞价';
    case 'break':
      return '☕ 节间休息';
    case 'closed':
    default:
      return '🔴 已闭市';
  }
}
