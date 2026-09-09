import { parseFutureInput } from './contractCatalog.js';
import { getBeijingClockParts, getBeijingDate, shiftCalendarDate } from '../time.js';
import { resolveLatestTradingDate, shiftTradingDate } from '../tradeCalendar.js';

/**
 * 判断特定时间点某个期货品种的交易会话状态
 * @param {string|object} instrument - 品种代码或解析出的合约对象 (如 "RB2510", "T0", "IF2406" 或 instrument 对象)
 * @param {Date} [now] - 判定时间，默认为当前时间
 * @param {string[]} [tradingDates] - 可选的交易日历数组
 * @returns {object} { isTrading: boolean, sessionKind: 'day'|'night'|'none', sessionStatus: 'trading'|'break'|'auction'|'closed', tradingDay: string }
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

  // 1. 中金所金融期货 (CFFEX: 股指期货 IF/IH/IC/IM, 国债期货 T/TF/TS/TL，完全无夜盘)
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
  // 日盘集合竞价: 08:55 - 09:00; 交易: 09:00 - 10:15, 10:30 - 11:30, 13:30 - 15:00
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

  // 3. 夜盘判断 (仅对定义了 nightSessionEnd 的品种有效)
  const nightEnd = inst.nightSessionEnd;
  if (nightEnd) {
    let endMin = 23 * 60;
    if (nightEnd === '01:00') endMin = 25 * 60;
    else if (nightEnd === '02:30') endMin = 26 * 60 + 30;

    // A. 当晚 20:55 - 收盘点(<=24:00): 仅在周一至周五的交易日开市，且次日
    // 必须是相邻的自然日交易日（节前最后一夜不开夜盘）；收盘点以品种
    // 元数据 nightSessionEnd 为准（如 RB0 23:00 之后不再交易）。
    if (isTradingDay && beijingDayOfWeek >= 1 && beijingDayOfWeek <= 5) {
      const nightTradingDay = shiftTradingDate(beijingToday, 1, tradingDates);
      const expectedNextCalendarDay = shiftCalendarDate(beijingToday, beijingDayOfWeek === 5 ? 3 : 1);
      const nightAllowed = nightTradingDay === expectedNextCalendarDay;
      const endMinCapped = Math.min(endMin, 24 * 60);
      if (nightAllowed && timeMin >= 20 * 60 + 55 && timeMin < endMinCapped) {
        if (timeMin < 21 * 60) {
          return { isTrading: false, sessionKind: 'night', sessionStatus: 'auction', tradingDay: nightTradingDay };
        }
        return { isTrading: true, sessionKind: 'night', sessionStatus: 'trading', tradingDay: nightTradingDay };
      }
    }

    // B. 次日凌晨 00:00 - 02:30 (跨午夜续段)
    if (timeMin < 3 * 60) {
      const currentMinAcross = 24 * 60 + timeMin;
      if (currentMinAcross <= endMin) {
        // 续段归属：周二至周五凌晨归属当天；周六凌晨归属下一个交易日（下周一）。
        // 周日、周一凌晨前一晚无夜盘，休市。
        let targetTradingDay = null;
        if (beijingDayOfWeek >= 2 && beijingDayOfWeek <= 5) {
          targetTradingDay = beijingToday;
        } else if (beijingDayOfWeek === 6) {
          targetTradingDay = shiftTradingDate(beijingToday, 1, tradingDates);
        }
        if (targetTradingDay) {
          // 前一自然日必须是交易日，且其夜盘归属目标交易日，否则休市
          // （覆盖节假日前夜、周末凌晨等日历约束）。
          const prevCalendarDay = shiftCalendarDate(beijingToday, -1);
          const prevDateObj = new Date(Date.UTC(clock.year, clock.month - 1, clock.day - 1, 12, 0, 0));
          const prevDow = prevDateObj.getUTCDay();
          const prevIsTradingDay = hasCalendar
            ? tradingDates.includes(prevCalendarDay)
            : (prevDow >= 1 && prevDow <= 5);
          if (prevIsTradingDay && shiftTradingDate(prevCalendarDay, 1, tradingDates) === targetTradingDay) {
            return { isTrading: true, sessionKind: 'night', sessionStatus: 'trading', tradingDay: targetTradingDay };
          }
        }
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

/**
 * 判断特定品种当前是否在交易中
 * @param {string|object} instrument - 品种代码或合约对象
 * @param {Date} [now]
 * @param {string[]} [tradingDates]
 * @returns {boolean}
 */
export function isFutureTrading(instrument, now = new Date(), tradingDates = []) {
  const session = getFuturesSession(instrument, now, tradingDates);
  return !!(session && session.isTrading);
}

/**
 * 给定一批期货代码，判断是否有任意一个标的正处于开市交易中
 * @param {string[]} codes
 * @param {Date} [now]
 * @param {string[]} [tradingDates]
 * @returns {boolean}
 */
export function isAnyFutureTrading(codes, now = new Date(), tradingDates = []) {
  if (!Array.isArray(codes) || !codes.length) return false;
  for (const code of codes) {
    if (isFutureTrading(code, now, tradingDates)) return true;
  }
  return false;
}

/**
 * 当未指定具体品种时，全市场商品与金融期货的最广开市时段兜底判断
 * @param {Date} [now]
 * @param {string[]} [tradingDates]
 * @returns {boolean}
 */
export function isFuturesMarketOpenFallback(now = new Date(), tradingDates = []) {
  // 检查代表性品种：包含最长日盘（国债 15:15）与最长夜盘（沪金 02:30）
  return (
    isFutureTrading('T0', now, tradingDates) ||
    isFutureTrading('AU0', now, tradingDates) ||
    isFutureTrading('RB0', now, tradingDates)
  );
}
