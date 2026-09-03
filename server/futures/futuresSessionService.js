import { parseFutureInput } from './contractCatalog.js';
import { getBeijingClockParts, getBeijingDate } from '../../src/js/time.js';
import { resolveLatestTradingDate, shiftTradingDate } from '../../src/js/tradeCalendar.js';

/**
 * 判断特定时间点该期货品种的交易会话状态
 * @param {string|object} instrument - 品种代码或解析出的合约对象 (如 "RB2510" 或 instrument 对象)
 * @param {Date} [now] - 判定时间，默认为当前时间
 * @param {string[]} [tradingDates] - 可选的交易日历数组
 * @returns {object} { isTrading, sessionKind: 'day'|'night'|'none', sessionStatus: 'trading'|'break'|'auction'|'closed', tradingDay }
 */
export function getFuturesSession(instrument, now = new Date(), tradingDates = []) {
  const inst = typeof instrument === 'object' && instrument !== null
    ? instrument
    : parseFutureInput(instrument);

  const clock = getBeijingClockParts(now);
  const timeMin = clock.hour * 60 + clock.minute;
  const beijingToday = getBeijingDate(now);
  const beijingDate = new Date(Date.UTC(clock.year, clock.month - 1, clock.day, 12, 0, 0));
  const beijingDayOfWeek = beijingDate.getUTCDay(); // 0: Sun, 1: Mon, ..., 5: Fri, 6: Sat
  const hasCalendar = Array.isArray(tradingDates) && tradingDates.length > 0;
  const isWeekend = beijingDayOfWeek === 0 || beijingDayOfWeek === 6;
  const isTradingDay = hasCalendar ? tradingDates.includes(beijingToday) : !isWeekend;
  const latestTradingDay = resolveLatestTradingDate(beijingToday, tradingDates);

  if (!inst) {
    return {
      isTrading: false,
      sessionKind: 'none',
      sessionStatus: 'closed',
      tradingDay: latestTradingDay
    };
  }

  // 1. 中金所金融期货 (CFFEX)
  if (inst.isFinancial) {
    if (!isTradingDay) {
      return { isTrading: false, sessionKind: 'none', sessionStatus: 'closed', tradingDay: latestTradingDay };
    }
    const isTreasury = !!inst.isTreasury;
    const morningStart = isTreasury ? 9 * 60 + 15 : 9 * 60 + 30;
    const afternoonEnd = isTreasury ? 15 * 60 + 15 : 15 * 60;
    const auctionStart = isTreasury ? 9 * 60 + 10 : 9 * 60 + 25;

    if (timeMin >= auctionStart && timeMin < morningStart) {
      return { isTrading: false, sessionKind: 'day', sessionStatus: 'auction', tradingDay: beijingToday };
    }
    if ((timeMin >= morningStart && timeMin <= 11 * 60 + 30) || (timeMin >= 13 * 60 && timeMin <= afternoonEnd)) {
      return { isTrading: true, sessionKind: 'day', sessionStatus: 'trading', tradingDay: beijingToday };
    }
    if (timeMin > 11 * 60 + 30 && timeMin < 13 * 60) {
      return { isTrading: false, sessionKind: 'day', sessionStatus: 'break', tradingDay: beijingToday };
    }
    return { isTrading: false, sessionKind: 'none', sessionStatus: 'closed', tradingDay: latestTradingDay };
  }

  // 2. 商品期货日盘 (SHFE, INE, DCE, CZCE, GFEX)
  // 日盘: 09:00 - 10:15, 10:30 - 11:30, 13:30 - 15:00
  if (isTradingDay) {
    if (timeMin >= 8 * 60 + 55 && timeMin < 9 * 60) {
      return { isTrading: false, sessionKind: 'day', sessionStatus: 'auction', tradingDay: beijingToday };
    }
    if (
      (timeMin >= 9 * 60 && timeMin <= 10 * 60 + 15) ||
      (timeMin >= 10 * 60 + 30 && timeMin <= 11 * 60 + 30) ||
      (timeMin >= 13 * 60 + 30 && timeMin <= 15 * 60)
    ) {
      return { isTrading: true, sessionKind: 'day', sessionStatus: 'trading', tradingDay: beijingToday };
    }
    if ((timeMin > 10 * 60 + 15 && timeMin < 10 * 60 + 30) || (timeMin > 11 * 60 + 30 && timeMin < 13 * 60 + 30)) {
      return { isTrading: false, sessionKind: 'day', sessionStatus: 'break', tradingDay: beijingToday };
    }
  }

  // 3. 夜盘判断
  const nightEnd = inst.nightSessionEnd;
  if (nightEnd) {
    let endMin = 23 * 60;
    if (nightEnd === '01:00') endMin = 25 * 60;
    else if (nightEnd === '02:30') endMin = 26 * 60 + 30;

    // A. 当晚 20:55 - 24:00: 仅在周一至周五的交易日开市
    if (isTradingDay && beijingDayOfWeek >= 1 && beijingDayOfWeek <= 5) {
      const nightTradingDay = shiftTradingDate(beijingToday, 1, tradingDates);
      if (timeMin >= 20 * 60 + 55 && timeMin < 21 * 60) {
        return { isTrading: false, sessionKind: 'night', sessionStatus: 'auction', tradingDay: nightTradingDay };
      }
      if (timeMin >= 21 * 60 && timeMin < 24 * 60) {
        return { isTrading: true, sessionKind: 'night', sessionStatus: 'trading', tradingDay: nightTradingDay };
      }
    }

    // B. 次日凌晨 00:00 - 02:30 (跨午夜续段)
    if (timeMin < 3 * 60) {
      const currentMinAcross = 24 * 60 + timeMin;
      if (currentMinAcross <= endMin) {
        // 周二至周五凌晨：周一至周四夜盘续段，归属当天
        if (beijingDayOfWeek >= 2 && beijingDayOfWeek <= 5) {
          return { isTrading: true, sessionKind: 'night', sessionStatus: 'trading', tradingDay: beijingToday };
        }
        // 周六凌晨：周五夜盘续段，归属下周一（下一个交易日）
        if (beijingDayOfWeek === 6) {
          const satNextTradingDay = shiftTradingDate(beijingToday, 1, tradingDates);
          return { isTrading: true, sessionKind: 'night', sessionStatus: 'trading', tradingDay: satNextTradingDay };
        }
        // 周日、周一凌晨：前一晚无夜盘，均为休市
      }
    }
  }

  return {
    isTrading: false,
    sessionKind: 'none',
    sessionStatus: 'closed',
    tradingDay: latestTradingDay
  };
}
