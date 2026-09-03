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

  const beijingToday = getBeijingDate(now);
  const latestTradingDay = resolveLatestTradingDate(beijingToday, tradingDates);
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  if (!inst) {
    return {
      isTrading: false,
      sessionKind: 'none',
      sessionStatus: 'closed',
      tradingDay: latestTradingDay
    };
  }

  const clock = getBeijingClockParts(now);
  const timeMin = clock.hour * 60 + clock.minute;

  // 1. 中金所金融期货 (CFFEX)
  if (inst.isFinancial) {
    if (isWeekend) {
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

  // 2. 商品期货 (SHFE, INE, DCE, CZCE, GFEX)
  // 日盘: 09:00 - 10:15, 10:30 - 11:30, 13:30 - 15:00
  if (!isWeekend) {
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
    // 夜盘归属下一个交易日 (例如周四晚 21:00 属于周五交易日)
    const nextTradingDay = shiftTradingDate(beijingToday, 1, tradingDates);

    // 解析 nightEnd 分钟数 (23:00 -> 23*60, 01:00 -> 25*60, 02:30 -> 26*60 + 30)
    let endMin = 23 * 60;
    if (nightEnd === '01:00') endMin = 25 * 60;
    else if (nightEnd === '02:30') endMin = 26 * 60 + 30;

    // A. 当晚 20:55 - 24:00 (通常周五晚不休夜盘，但节假日前无夜盘；一般工作日一至五均有夜盘)
    // 周五晚通常也有夜盘（属于下周一交易日）
    const isFridayNight = now.getDay() === 5;
    const isSaturdayOrSunday = now.getDay() === 0 || (now.getDay() === 6 && timeMin >= 3 * 60);

    if (!isSaturdayOrSunday) {
      if (timeMin >= 20 * 60 + 55 && timeMin < 21 * 60) {
        return { isTrading: false, sessionKind: 'night', sessionStatus: 'auction', tradingDay: isFridayNight ? shiftTradingDate(beijingToday, 1, tradingDates) : nextTradingDay };
      }
      if (timeMin >= 21 * 60 && timeMin < 24 * 60) {
        return { isTrading: true, sessionKind: 'night', sessionStatus: 'trading', tradingDay: isFridayNight ? shiftTradingDate(beijingToday, 1, tradingDates) : nextTradingDay };
      }
    }

    // B. 次日凌晨 00:00 - 02:30 (跨午夜夜盘续段，属于当前自然日作为交易日)
    if (timeMin < 3 * 60) {
      const currentMinAcross = 24 * 60 + timeMin;
      if (currentMinAcross <= endMin) {
        return { isTrading: true, sessionKind: 'night', sessionStatus: 'trading', tradingDay: beijingToday };
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
