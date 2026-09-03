import {
  getMarketSession,
  isAutoRefreshAllowedInSession,
  isVoiceAllowedInSession,
  normalizeSmartSchedule
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
});
