import {
  getMarketSession,
  isAutoRefreshAllowedInSession,
  isVoiceAllowedInSession,
  normalizeSmartSchedule,
  isFuturesMarketOpen,
  isLiveTradeDate
} from '../src/js/marketSession.js';

QUnit.module('marketSession', () => {
  const tradingDates = ['2026-06-05'];

  QUnit.test('detects A-share sessions in Beijing time', (t) => {
    t.equal(getMarketSession(new Date('2026-06-05T01:15:00Z'), tradingDates), 'opening-auction');
    t.equal(getMarketSession(new Date('2026-06-05T01:26:00Z'), tradingDates), 'opening-auction', '09:26 is opening auction');
    t.equal(getMarketSession(new Date('2026-06-05T01:30:00Z'), tradingDates), 'trading');
    t.equal(getMarketSession(new Date('2026-06-05T03:30:00Z'), tradingDates), 'lunch');
    t.equal(getMarketSession(new Date('2026-06-05T05:00:00Z'), tradingDates), 'trading');
    t.equal(getMarketSession(new Date('2026-06-05T07:00:00Z'), tradingDates), 'after-close');
  });

  QUnit.test('non-trading date is closed', (t) => {
    t.equal(getMarketSession(new Date('2026-06-06T02:00:00Z'), tradingDates), 'closed');
  });

  QUnit.test('default smart schedule pauses lunch/stops after close, auction off', (t) => {
    const cfg = normalizeSmartSchedule({});
    t.equal(cfg.pauseLunchBreak, true);
    t.equal(cfg.autoStopAfterClose, true);
    t.equal(cfg.autoStartAuction, false);
    t.equal(isVoiceAllowedInSession('trading', cfg), true);
    t.equal(isVoiceAllowedInSession('lunch', cfg), false);
    t.equal(isVoiceAllowedInSession('after-close', cfg), false);
    t.equal(isVoiceAllowedInSession('opening-auction', cfg), false);
  });

  QUnit.test('data auto refresh can reuse session rules without voice state', (t) => {
    const cfg = normalizeSmartSchedule({
      enabled: true,
      pauseLunchBreak: true,
      autoStopAfterClose: true,
      autoStartAuction: false
    });
    t.equal(isAutoRefreshAllowedInSession('trading', cfg), true);
    t.equal(isAutoRefreshAllowedInSession('lunch', cfg), false);
    t.equal(isAutoRefreshAllowedInSession('after-close', cfg), false);
    t.equal(isAutoRefreshAllowedInSession('opening-auction', cfg), false);
  });

  QUnit.test('isFuturesMarketOpen accurately identifies commodity sessions', (t) => {
    // 2026-09-04 is Friday. 09:10 Beijing time is 01:10 UTC
    t.equal(isFuturesMarketOpen(new Date('2026-09-04T01:10:00Z')), true, 'Friday morning 09:10 is open');
    // 21:30 Beijing time on Friday is 13:30 UTC
    t.equal(isFuturesMarketOpen(new Date('2026-09-04T13:30:00Z')), true, 'Friday night 21:30 is open');
    // 01:30 Beijing time on Saturday 2026-09-05 is 17:30 UTC Friday
    t.equal(isFuturesMarketOpen(new Date('2026-09-04T17:30:00Z')), true, 'Saturday 01:30 midnight continuation is open');
    // Saturday 10:00 Beijing time is 02:00 UTC Saturday
    t.equal(isFuturesMarketOpen(new Date('2026-09-05T02:00:00Z')), false, 'Saturday daytime 10:00 is closed');
    // Sunday 21:00 Beijing time is 13:00 UTC Sunday
    t.equal(isFuturesMarketOpen(new Date('2026-09-06T13:00:00Z')), false, 'Sunday night is closed');
  });

  QUnit.test('isLiveTradeDate accurately handles Saturday midnight night session continuation', (t) => {
    // Saturday 01:00 Beijing time (2026-09-05 01:00 -> 2026-09-04T17:00:00Z)
    const satMidnight = new Date('2026-09-04T17:00:00Z');
    // Next trading day is Monday 2026-09-07
    t.equal(isLiveTradeDate('2026-09-07', true, satMidnight), true, 'Saturday midnight matches Monday as live session');
    t.equal(isLiveTradeDate('2026-09-05', true, satMidnight), false, 'Saturday calendar date is not the futures trading day');
    // After 02:30 on Saturday (03:00 Beijing time -> 2026-09-04T19:00:00Z)
    const satClosed = new Date('2026-09-04T19:00:00Z');
    t.equal(isLiveTradeDate('2026-09-07', true, satClosed), false, 'Saturday 03:00 is after session end, not live');
  });
});
