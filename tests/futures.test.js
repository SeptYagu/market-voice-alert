import { parseFutureInput } from '../server/futures/contractCatalog.js';
import { getFuturesSession } from '../server/futures/futuresSessionService.js';
import { calculateFuturesChange, formatFuturesQuote } from '../src/js/futures/futuresPresenter.js';
import { isFutureCode, normalizeFutureCode, toSinaFutureSymbol, formatFutureDisplayName } from '../src/js/futures/instrument.js';

QUnit.module('futures.contractCatalog & instrument', () => {
  QUnit.test('parses specific commodity contracts', (t) => {
    const inst = parseFutureInput('rb2510');
    t.ok(inst, 'parsed rb2510');
    t.equal(inst.exchange, 'shfe');
    t.equal(inst.product, 'RB');
    t.equal(inst.symbol, 'RB2510');
    t.equal(inst.contractKind, 'specific');
    t.equal(inst.providerSymbols.sina, 'nf_RB2510');
    t.equal(inst.nightSessionEnd, '23:00');
  });

  QUnit.test('parses continuous contract codes (0)', (t) => {
    const inst = parseFutureInput('RB0');
    t.ok(inst, 'parsed RB0');
    t.equal(inst.contractKind, 'continuous');
    t.equal(inst.name, '螺纹钢连续');
  });

  QUnit.test('parses Chinese aliases', (t) => {
    const inst = parseFutureInput('螺纹主连');
    t.ok(inst, 'parsed 螺纹主连');
    t.equal(inst.symbol, 'RB0');
    t.equal(inst.contractKind, 'continuous');
  });

  QUnit.test('parses financial futures (CFFEX)', (t) => {
    const inst = parseFutureInput('if2603');
    t.ok(inst, 'parsed if2603');
    t.equal(inst.exchange, 'cffex');
    t.equal(inst.product, 'IF');
    t.equal(inst.isFinancial, true);
    t.equal(inst.nightSessionEnd, null, 'CFFEX has no night session');
  });

  QUnit.test('parses legacy nf_ prefix', (t) => {
    const inst = parseFutureInput('nf_rb2510');
    t.ok(inst);
    t.equal(inst.symbol, 'RB2510');

    const instNoUnderscore = parseFutureInput('nfrb2410');
    t.ok(instNoUnderscore, 'parsed nfrb2410 without underscore');
    t.equal(instNoUnderscore.symbol, 'RB2410');
  });

  QUnit.test('parses Chinese aliases with ambiguity protection', (t) => {
    // Exact or multi-char prefix matches
    t.equal(parseFutureInput('螺纹主连')?.symbol, 'RB0');
    t.equal(parseFutureInput('白糖主力')?.symbol, 'SR0');
    t.equal(parseFutureInput('豆粕主力')?.symbol, 'M0');
    t.equal(parseFutureInput('沪铜主力')?.symbol, 'CU0');

    // Ambiguous or bare prefixes must return null
    t.equal(parseFutureInput('主连'), null, '"主连" alone must not match');
    t.equal(parseFutureInput('主力'), null, '"主力" alone must not match');
    t.equal(parseFutureInput('豆主力'), null, 'Single-char "豆" is ambiguous (A, B, M, Y)');
    t.equal(parseFutureInput('沪主力'), null, 'Single-char "沪" is ambiguous (CU, AL, ZN, AU, etc.)');
  });

  QUnit.test('normalizes 3-digit CZCE contracts (e.g. sr501 -> sr2501)', (t) => {
    const inst = parseFutureInput('sr501');
    t.ok(inst);
    t.equal(inst.symbol, 'SR2501');
  });

  QUnit.test('returns null for invalid inputs', (t) => {
    t.equal(parseFutureInput(''), null);
    t.equal(parseFutureInput(null), null);
    t.equal(parseFutureInput('600519'), null);
    t.equal(parseFutureInput('sh600519'), null);
    t.equal(parseFutureInput('nf_invalid123'), null);
  });

  QUnit.test('instrument helpers and formatFutureDisplayName', (t) => {
    t.equal(isFutureCode('rb2510'), true);
    t.equal(isFutureCode('600519'), false);
    t.equal(normalizeFutureCode('rb2510'), 'RB2510');
    t.equal(toSinaFutureSymbol('rb2510'), 'nf_RB2510');
    t.equal(formatFutureDisplayName({}), '', 'empty object yields empty string');
    t.equal(formatFutureDisplayName(null), '', 'null yields empty string');
    t.equal(formatFutureDisplayName('rb2510'), '螺纹钢2510');
  });
});

QUnit.module('futures.sessionService', () => {
  QUnit.test('identifies commodity day session', (t) => {
    // 2026-09-04 10:00 (Friday)
    const d = new Date('2026-09-04T10:00:00+08:00');
    const s = getFuturesSession('RB2510', d);
    t.equal(s.isTrading, true);
    t.equal(s.sessionKind, 'day');
    t.equal(s.sessionStatus, 'trading');
    t.equal(s.tradingDay, '2026-09-04');
  });

  QUnit.test('identifies commodity 10:15 - 10:30 intermission', (t) => {
    // 2026-09-04 10:20
    const d = new Date('2026-09-04T10:20:00+08:00');
    const s = getFuturesSession('RB2510', d);
    t.equal(s.isTrading, false);
    t.equal(s.sessionStatus, 'break');
  });

  QUnit.test('identifies commodity night session and attributes to next trading day', (t) => {
    // 2026-09-03 21:30 (Thursday night) -> belongs to 2026-09-04 trading day
    const d = new Date('2026-09-03T21:30:00+08:00');
    const s = getFuturesSession('RB2510', d, ['2026-09-03', '2026-09-04', '2026-09-07']);
    t.equal(s.isTrading, true);
    t.equal(s.sessionKind, 'night');
    t.equal(s.tradingDay, '2026-09-04');
  });

  QUnit.test('identifies CFFEX financial session without night session', (t) => {
    // 2026-09-03 21:30 (Thursday night) -> CFFEX is closed
    const d = new Date('2026-09-03T21:30:00+08:00');
    const s = getFuturesSession('IF2603', d);
    t.equal(s.isTrading, false);
    t.equal(s.sessionStatus, 'closed');
  });

  QUnit.test('Friday night session attributes to Monday', (t) => {
    // 2026-09-04 21:30 (Friday night) -> belongs to Monday 2026-09-07
    const d = new Date('2026-09-04T21:30:00+08:00');
    const s = getFuturesSession('RB2510', d, ['2026-09-04', '2026-09-07']);
    t.equal(s.isTrading, true);
    t.equal(s.sessionKind, 'night');
    t.equal(s.tradingDay, '2026-09-07');
  });

  QUnit.test('Saturday 01:30 night continuation attributes to Monday', (t) => {
    // 2026-09-05 01:30 (Saturday morning for AU) -> belongs to Monday 2026-09-07
    const d = new Date('2026-09-05T01:30:00+08:00');
    const s = getFuturesSession('AU0', d, ['2026-09-04', '2026-09-07']);
    t.equal(s.isTrading, true);
    t.equal(s.sessionKind, 'night');
    t.equal(s.tradingDay, '2026-09-07');
  });

  QUnit.test('Sunday & Monday early morning have no night session (closed)', (t) => {
    // Sunday 01:30
    const sun = new Date('2026-09-06T01:30:00+08:00');
    const sSun = getFuturesSession('AU0', sun, ['2026-09-04', '2026-09-07']);
    t.equal(sSun.isTrading, false);
    t.equal(sSun.sessionStatus, 'closed');

    // Monday 01:30
    const mon = new Date('2026-09-07T01:30:00+08:00');
    const sMon = getFuturesSession('AU0', mon, ['2026-09-04', '2026-09-07']);
    t.equal(sMon.isTrading, false);
    t.equal(sMon.sessionStatus, 'closed');
  });

  QUnit.test('Statutory holiday is closed even on weekdays', (t) => {
    // 2026-10-01 10:00 (National Day Thursday)
    const d = new Date('2026-10-01T10:00:00+08:00');
    const s = getFuturesSession('RB2510', d, ['2026-09-30', '2026-10-08']);
    t.equal(s.isTrading, false);
    t.equal(s.sessionStatus, 'closed');
    t.equal(s.tradingDay, '2026-09-30');
  });
});

QUnit.module('futures.presenter', () => {
  QUnit.test('calculates change relative to previousSettlement', (t) => {
    const res = calculateFuturesChange(3280, 3268, 3272);
    t.equal(res.baseline, 3268);
    t.equal(res.change, 12);
    t.equal(res.changePercent, 0.37);
  });

  QUnit.test('falls back to prevClose if previousSettlement missing', (t) => {
    const res = calculateFuturesChange(3280, null, 3270);
    t.equal(res.baseline, 3270);
    t.equal(res.change, 10);
  });

  QUnit.test('supports 3-decimal precision for Treasury futures', (t) => {
    // 10-year Treasury tick is 0.005
    const res = calculateFuturesChange(106.425, 106.310, 106.300, 0.005);
    t.equal(res.baseline, 106.310);
    t.equal(res.change, 0.115);
  });

  QUnit.test('formats futures quote preserving fields, completing name and canonical code', (t) => {
    const q = formatFuturesQuote({
      code: 'nf_rb2510',
      price: 3300,
      prevSettlement: 3200,
      prevClose: 3210,
      openInterest: 1500000,
      volume: 45000
    });
    t.equal(q.code, 'rb2510', 'code stripped of nf_');
    t.equal(q.name, '螺纹钢2510', 'name auto-completed from catalog');
    t.equal(q.type, 'future');
    t.equal(q.change, 100);
    t.equal(q.changePercent, 3.13);
    t.equal(q.openInterest, 1500000);
  });
});
