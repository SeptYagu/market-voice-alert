import {
  inferAssetType,
  normalizeCode,
  toEastmoneySecId,
  parseEastmoney,
  parseSinaFuture,
  parseSinaGlobalFuture
} from '../src/js/parser.js';
import {
  GLOBAL_FUTURES_CATALOG
} from '../src/js/futures/globalCatalog.js';
import {
  resolveSessionStrategy,
  isUsDaylightSavingTime,
  getVoiceEligibleCodes,
  chinaFuturesStrategy
} from '../src/js/marketSession.js';
import {
  getFuturesSessionRanges
} from '../src/js/futures/session.js';
import { formatQuoteSpeech } from '../src/js/tts.js';
import { formatAlertMessage } from '../src/js/alert.js';
import {
  createStockSearchIndex,
  searchStocks
} from '../src/js/services/stockSearchService.js';
import { decideVoiceSchedule } from '../src/js/services/voiceSchedule.js';

QUnit.module('Phase 1: inferAssetType 全值域覆盖与正交路由断言', () => {
  QUnit.test('严格区分国内期货、外盘期货、港股、美股及 A 股', (t) => {
    t.equal(inferAssetType('SI0'), 'futures_cn', '国内工业硅 SI0');
    t.equal(inferAssetType('RB0'), 'futures_cn', '国内螺纹钢 RB0');
    t.equal(inferAssetType('T0'), 'futures_cn', '国内国债期货 T0');
    t.equal(inferAssetType('IF0'), 'futures_cn', '国内股指期货 IF0');

    t.equal(inferAssetType('GL_SI0'), 'futures_global', '外盘白银 GL_SI0');
    t.equal(inferAssetType('GL_CL0'), 'futures_global', '外盘原油 GL_CL0');
    t.equal(inferAssetType('GL_A50'), 'futures_global', '外盘 A50 GL_A50');
    t.equal(inferAssetType('GL_HSI'), 'futures_global', '外盘恒指 GL_HSI');
    t.equal(inferAssetType('hf_SI'), 'futures_global', '新浪外盘备源 hf_SI');
    t.equal(inferAssetType('hf_HSI'), 'futures_global', '新浪外盘备源 hf_HSI');
    t.equal(inferAssetType('hf_CL'), 'futures_global', '新浪外盘备源 hf_CL');
    t.equal(inferAssetType('hf_CHA50CFD'), 'futures_global', '新浪外盘备源 hf_CHA50CFD');

    t.equal(inferAssetType('sh600519'), 'stock_cn', 'A股 sh600519');
    t.equal(inferAssetType('sz000001'), 'stock_cn', 'A股 sz000001');
    t.equal(inferAssetType('bj830799'), 'stock_cn', '北交所 bj830799');
    t.equal(inferAssetType('600519'), 'stock_cn', '6位纯数字 600519');

    t.equal(inferAssetType('hk00700'), 'stock_hk', '港股 hk00700');
    t.equal(inferAssetType('r_hk00700'), 'stock_hk', '腾讯前缀港股 r_hk00700');

    t.equal(inferAssetType('usAAPL'), 'stock_us', '美股 usAAPL');
    t.equal(inferAssetType('usBRK.A'), 'stock_us', '美股带点 usBRK.A');
    t.equal(inferAssetType('usBRK.B'), 'stock_us', '美股带点 usBRK.B');
    t.equal(inferAssetType('usBF.B'), 'stock_us', '美股带点 usBF.B');
    t.equal(inferAssetType('BRK.A'), 'stock_us', '不带 us 前缀的点号美股 BRK.A');
    t.equal(inferAssetType('BRK_B'), 'stock_us', '下划线美股 BRK_B');

    t.equal(inferAssetType('unknown_foo'), 'stock_cn', '未知代码安全兜底 A 股');
  });
});

QUnit.module('Phase 1: normalizeCode 安全准入与 hf_* 拦截', () => {
  QUnit.test('严格拦截 hf_* 内部备源码，规范化 GL_* 及港美 A 股', (t) => {
    t.equal(normalizeCode('hf_CL'), null, '拦截 hf_CL');
    t.equal(normalizeCode('hf_SI'), null, '拦截 hf_SI');
    t.equal(normalizeCode('hf_CHA50CFD'), null, '拦截 hf_CHA50CFD');

    t.equal(normalizeCode('GL_CL0'), 'GL_CL0');
    t.equal(normalizeCode('gl_cl0'), 'GL_CL0');
    t.equal(normalizeCode('gl_a50'), 'GL_A50');
    t.equal(normalizeCode('gl_hsi'), 'GL_HSI');

    t.equal(normalizeCode('hk00700'), 'hk00700');
    t.equal(normalizeCode('r_hk00700'), 'hk00700');
    t.equal(normalizeCode('usaapl'), 'usAAPL');
    t.equal(normalizeCode('usBRK.A'), 'usBRK.A');

    t.equal(normalizeCode('600519'), 'sh600519');
    t.equal(normalizeCode('000001'), 'sz000001');
    t.equal(normalizeCode('830799'), 'bj830799');
  });
});

QUnit.module('Phase 1: toEastmoneySecId 映射与市场注册表', () => {
  QUnit.test('东财市场 secid 规范映射 10 大外盘期货与港美标的', (t) => {
    t.equal(toEastmoneySecId('GL_CL0'), '102.CL00Y', 'NYMEX 原油');
    t.equal(toEastmoneySecId('GL_GC0'), '101.GC00Y', 'COMEX 黄金');
    t.equal(toEastmoneySecId('GL_SI0'), '101.SI00Y', 'COMEX 白银');
    t.equal(toEastmoneySecId('GL_HG0'), '101.HG00Y', 'COMEX 美铜');
    t.equal(toEastmoneySecId('GL_NG0'), '102.NG00Y', 'NYMEX 天然气');
    t.equal(toEastmoneySecId('GL_NQ0'), '103.NQ00Y', 'CME 纳指');
    t.equal(toEastmoneySecId('GL_ES0'), '103.ES00Y', 'CME 标普');
    t.equal(toEastmoneySecId('GL_YM0'), '103.YM00Y', 'CME 道指');
    t.equal(toEastmoneySecId('GL_A50'), '104.CN00Y', 'SGX 富时 A50');
    t.equal(toEastmoneySecId('GL_HSI'), '134.HSI_M', 'HKFE 恒指主力');

    t.equal(toEastmoneySecId('hk00700'), '116.00700', '港股 116 市场');
    t.equal(toEastmoneySecId('usAAPL'), '105.AAPL', '美股 NASDAQ 105');
    t.equal(toEastmoneySecId('usBABA'), '106.BABA', '美股 NYSE 106');
    t.equal(toEastmoneySecId('usSPY'), '107.SPY', '美股 AMEX 107');
    t.equal(toEastmoneySecId('usBRK.A'), '106.BRK_A', '美股带点点号转下划线');
  });
});

QUnit.module('Phase 1: parseEastmoney 缩放系数与多市场行情解析', () => {
  QUnit.test('10 大外盘期货 qtDivisor 精确缩放', (t) => {
    const catalog = GLOBAL_FUTURES_CATALOG;

    // GL_CL0 (divisor: 100)
    const clJson = { data: { f116: catalog.GL_CL0.marketId, f57: catalog.GL_CL0.eastmoneySymbol, f43: 10372, f60: 10000, f58: '纽约原油', f170: 372 } };
    const cl = parseEastmoney(clJson);
    t.equal(cl.code, 'GL_CL0');
    t.equal(cl.type, 'futures_global');
    t.equal(cl.price, 103.72);
    t.equal(cl.prevClose, 100);
    t.equal(cl.change, 3.72);
    t.equal(cl.changePercent, 3.72);

    // GL_GC0 (divisor: 10)
    const gcJson = { data: { f116: catalog.GL_GC0.marketId, f57: catalog.GL_GC0.eastmoneySymbol, f43: 27000, f60: 26500, f58: '纽约黄金' } };
    const gc = parseEastmoney(gcJson);
    t.equal(gc.code, 'GL_GC0');
    t.equal(gc.price, 2700.0);
    t.equal(gc.prevClose, 2650.0);

    // GL_SI0 (divisor: 1000)
    const siJson = { data: { f116: catalog.GL_SI0.marketId, f57: catalog.GL_SI0.eastmoneySymbol, f43: 31500, f60: 30000, f58: '纽约白银' } };
    const si = parseEastmoney(siJson);
    t.equal(si.code, 'GL_SI0');
    t.equal(si.price, 31.5);
    t.equal(si.prevClose, 30.0);

    // GL_HG0 (divisor: 10000)
    const hgJson = { data: { f116: catalog.GL_HG0.marketId, f57: catalog.GL_HG0.eastmoneySymbol, f43: 45678, f60: 45000, f58: '纽约美铜' } };
    const hg = parseEastmoney(hgJson);
    t.equal(hg.code, 'GL_HG0');
    t.equal(hg.price, 4.5678);
    t.equal(hg.prevClose, 4.5);

    // GL_NG0 (divisor: 1000)
    const ngJson = { data: { f116: catalog.GL_NG0.marketId, f57: catalog.GL_NG0.eastmoneySymbol, f43: 2345, f60: 2000, f58: '天然气' } };
    const ng = parseEastmoney(ngJson);
    t.equal(ng.code, 'GL_NG0');
    t.equal(ng.price, 2.345);
    t.equal(ng.prevClose, 2.0);

    // GL_NQ0 (divisor: 100)
    const nqJson = { data: { f116: catalog.GL_NQ0.marketId, f57: catalog.GL_NQ0.eastmoneySymbol, f43: 1987650, f60: 1950000, f58: '纳斯达克期货' } };
    const nq = parseEastmoney(nqJson);
    t.equal(nq.code, 'GL_NQ0');
    t.equal(nq.price, 19876.5);
    t.equal(nq.prevClose, 19500);

    // GL_ES0 (divisor: 100)
    const esJson = { data: { f116: catalog.GL_ES0.marketId, f57: catalog.GL_ES0.eastmoneySymbol, f43: 567850, f60: 560000, f58: '标普500期货' } };
    const es = parseEastmoney(esJson);
    t.equal(es.code, 'GL_ES0');
    t.equal(es.price, 5678.5);
    t.equal(es.prevClose, 5600);

    // GL_YM0 (divisor: 1)
    const ymJson = { data: { f116: catalog.GL_YM0.marketId, f57: catalog.GL_YM0.eastmoneySymbol, f43: 41234, f60: 41000, f58: '道琼斯期货' } };
    const ym = parseEastmoney(ymJson);
    t.equal(ym.code, 'GL_YM0');
    t.equal(ym.price, 41234);
    t.equal(ym.prevClose, 41000);

    // GL_A50 (divisor: 10, SGX 0.1 点报价)
    const a50Json = { data: { f116: catalog.GL_A50.marketId, f57: catalog.GL_A50.eastmoneySymbol, f43: 143900, f60: 142710, f58: '富时中国A50' } };
    const a50 = parseEastmoney(a50Json);
    t.equal(a50.code, 'GL_A50');
    t.equal(a50.price, 14390.0);
    t.equal(a50.prevClose, 14271.0);

    // GL_HSI (divisor: 1)
    const hsiJson = { data: { f116: catalog.GL_HSI.marketId, f57: catalog.GL_HSI.eastmoneySymbol, f43: 24701, f60: 24676, f58: '恒生指数期货' } };
    const hsi = parseEastmoney(hsiJson);
    t.equal(hsi.code, 'GL_HSI');
    t.equal(hsi.price, 24701);
    t.equal(hsi.prevClose, 24676);
  });

  QUnit.test('港美股 parseEastmoney div1000 规范化', (t) => {
    // 港股市场 116
    const hkJson = { data: { f116: 116, f57: '00700', f43: 380000, f60: 375000, f58: '腾讯控股' } };
    const hk = parseEastmoney(hkJson);
    t.equal(hk.code, 'hk00700');
    t.equal(hk.type, 'stock_hk');
    t.equal(hk.price, 380.0);
    t.equal(hk.prevClose, 375.0);

    // 美股市场 105
    const usJson = { data: { f116: 105, f57: 'AAPL', f43: 225000, f60: 220000, f58: '苹果' } };
    const us = parseEastmoney(usJson);
    t.equal(us.code, 'usAAPL');
    t.equal(us.type, 'stock_us');
    t.equal(us.price, 225.0);
    t.equal(us.prevClose, 220.0);
  });
});

QUnit.module('Phase 1: parseSinaGlobalFuture 备源解析与基准重绑', () => {
  QUnit.test('解析 15 字段新浪外盘期货，昨结基准重绑且涨跌幅差值 < 0.6pp', (t) => {
    // 新浪真实外盘数据格式：
    // field 0: 当前价, 1: 涨跌额, 2: 买价, 3: 卖价, 4: 最高, 5: 最低, 6: 时间, 7: 昨结, 8: 开盘, 9: 持仓量, 10: 买量, 11: 卖量, 12: 日期, 13: 品种名
    const sample = '103.72,3.72,103.70,103.74,105.00,101.50,22:30:00,100.00,101.00,123456,10,20,2026-09-16,原油连续';
    const quote = parseSinaGlobalFuture('hf_CL', sample);
    t.ok(quote, '解析成功');
    t.equal(quote.code, 'GL_CL0', '规范化为 GL_CL0 代码');
    t.equal(quote.type, 'futures_global');
    t.equal(quote.price, 103.72);
    t.equal(quote.prevClose, 100.0);
    t.equal(quote.change, 3.72);
    t.equal(quote.changePercent, 3.72);

    // 涨跌幅与理论值差异 < 0.6pp
    const expectedPct = ((103.72 - 100.0) / 100.0) * 100;
    t.true(Math.abs(quote.changePercent - expectedPct) < 0.6, 'changePercent 误差小于 0.6pp');

    // 验证 parseSinaFuture 分发到 parseSinaGlobalFuture
    const line = `var hq_str_hf_CL="${sample}";`;
    const fromDispatch = parseSinaFuture('hf_CL', line);
    t.equal(fromDispatch.code, 'GL_CL0');
    t.equal(fromDispatch.price, 103.72);
  });
});

QUnit.module('Phase 1: 国内期货时段等价性回归 (RB0/AU0/T0/IF0)', () => {
  QUnit.test('金融期货 T0/IF0 与商品期货 RB0/AU0 关键时间点会话判定', (t) => {
    // 21:30 (夜盘开盘后): RB/AU 交易中, T/IF 闭市无夜盘
    const time2130 = new Date('2026-06-05T21:30:00+08:00');
    t.equal(chinaFuturesStrategy.getSession(time2130, 'RB0'), 'trading', '21:30 RB0 交易中');
    t.equal(chinaFuturesStrategy.getSession(time2130, 'AU0'), 'trading', '21:30 AU0 交易中');
    t.equal(chinaFuturesStrategy.getSession(time2130, 'T0'), 'after-close', '21:30 T0 已收盘');
    t.equal(chinaFuturesStrategy.getSession(time2130, 'IF0'), 'after-close', '21:30 IF0 已收盘');

    // 23:30: RB 23:00 收盘(after-close), AU 交易至 02:30(trading)
    const time2330 = new Date('2026-06-05T23:30:00+08:00');
    t.equal(chinaFuturesStrategy.getSession(time2330, 'RB0'), 'after-close', '23:30 RB0 夜盘已收盘');
    t.equal(chinaFuturesStrategy.getSession(time2330, 'AU0'), 'trading', '23:30 AU0 夜盘交易中');

    // 02:40: AU 02:30 已收盘
    const time0240 = new Date('2026-06-05T02:40:00+08:00');
    t.equal(chinaFuturesStrategy.getSession(time0240, 'AU0'), 'after-close', '02:40 AU0 已收盘');

    // 15:08: RB 15:00 收盘, T 国债期货 15:15 收盘(仍在交易中)
    const time1508 = new Date('2026-06-05T15:08:00+08:00');
    t.equal(chinaFuturesStrategy.getSession(time1508, 'RB0'), 'after-close', '15:08 RB0 已收盘');
    t.equal(chinaFuturesStrategy.getSession(time1508, 'T0'), 'trading', '15:08 T0 仍在交易中');

    // Session ranges export
    t.true(getFuturesSessionRanges('RB0', time2130).length > 0, 'RB0 session ranges');
    t.true(getFuturesSessionRanges('T0', time2130).length > 0, 'T0 session ranges');
  });
});

QUnit.module('Phase 1: 多市场策略派发与语音调度隔离', () => {
  const tradingDates = ['2026-06-05'];

  QUnit.test('resolveSessionStrategy 返回对应市场策略与夏令时判定', (t) => {
    t.equal(resolveSessionStrategy('sh600519').assetType, 'stock_cn');
    t.equal(resolveSessionStrategy('RB0').assetType, 'futures_cn');
    t.equal(resolveSessionStrategy('GL_CL0').assetType, 'futures_global');
    t.equal(resolveSessionStrategy('hk00700').assetType, 'stock_hk');
    t.equal(resolveSessionStrategy('usAAPL').assetType, 'stock_us');

    t.true(isUsDaylightSavingTime(new Date('2026-07-01T12:00:00Z')), '7月为美股夏令时');
    t.false(isUsDaylightSavingTime(new Date('2026-01-01T12:00:00Z')), '1月为美股冬令时');
  });

  QUnit.test('混合资产时段隔离：22:00 A 股收盘不触发全局 autoStop，外盘正常播报', (t) => {
    const list = ['sh600519', 'GL_CL0'];
    const time2200 = new Date('2026-06-05T22:00:00+08:00');
    const settings = {
      enabled: true,
      smartSchedule: { enabled: true, autoStopAfterClose: true, pauseLunchBreak: true }
    };
    const previous = { timerShouldRun: true, eligibleCodes: ['sh600519', 'GL_CL0'] };
    const eligible = getVoiceEligibleCodes(list, settings.smartSchedule, time2200, tradingDates);
    t.true(eligible.includes('GL_CL0'), '22:00 GL_CL0 处于交易时段');
    t.false(eligible.includes('sh600519'), '22:00 A 股已收盘');

    const next = decideVoiceSchedule({
      codes: list,
      settings,
      now: time2200,
      tradingDates,
      previous
    });

    // 含有外盘标的时，绝不得因 A 股收盘而停播
    t.equal(next.enabled, true, '含有外盘标的时 22:00 保持 enabled');
    t.true(next.eligibleCodes.includes('GL_CL0'), 'GL_CL0 保持播报资格');
    t.true(next.timerShouldRun, '定时器继续保持运行');
  });

  QUnit.test('纯 A 股标的 16:00 正常触发收盘停播', (t) => {
    const list = ['sh600519'];
    const time1600 = new Date('2026-06-05T16:00:00+08:00');
    const settings = {
      enabled: true,
      smartSchedule: { enabled: true, autoStopAfterClose: true, pauseLunchBreak: true }
    };
    const previous = { timerShouldRun: true, eligibleCodes: ['sh600519'] };
    const next = decideVoiceSchedule({
      codes: list,
      settings,
      now: time1600,
      tradingDates,
      previous
    });

    t.equal(next.enabled, false, '纯 A 股标的 16:00 触发停播 enabled=false');
    t.equal(next.transitionNotice, '已收盘');
  });

  QUnit.test('午休防误关：12:00 A 股午休暂停但不永久停播', (t) => {
    const list = ['sh600519'];
    const time1200 = new Date('2026-06-05T12:00:00+08:00');
    const settings = {
      enabled: true,
      smartSchedule: { enabled: true, autoStopAfterClose: true, pauseLunchBreak: true }
    };
    const previous = { timerShouldRun: true, eligibleCodes: ['sh600519'] };
    const next = decideVoiceSchedule({
      codes: list,
      settings,
      now: time1200,
      tradingDates,
      previous
    });

    t.equal(next.enabled, true, '12:00 午休不得永久停播 (enabled 保持 true)');
    t.equal(next.transitionNotice, '中午休市');
    t.equal(next.pauseReason, 'break');
  });
});

QUnit.module('Phase 1: TTS 与 Alert 格式化防元单位断言', () => {
  QUnit.test('国际期货与港美股 TTS 播报货币单位准确', (t) => {
    // 国际期货：不带“元”
    const glQuote = { code: 'GL_CL0', name: '纽约原油', price: 103.72, changePercent: 3.72, type: 'futures_global' };
    const glSpeech = formatQuoteSpeech(glQuote);
    t.true(glSpeech.includes('103.72'), '含价格数值');
    t.false(glSpeech.includes('元'), '期货价格严格不带“元”');

    // 港股：带“港币”
    const hkQuote = { code: 'hk00700', name: '腾讯控股', price: 380.0, changePercent: 1.5, type: 'stock_hk' };
    const hkSpeech = formatQuoteSpeech(hkQuote);
    t.true(hkSpeech.includes('港币'), '港股带港币单位');

    // 美股：带“美元”
    const usQuote = { code: 'usAAPL', name: '苹果', price: 225.0, changePercent: -0.8, type: 'stock_us' };
    const usSpeech = formatQuoteSpeech(usQuote);
    t.true(usSpeech.includes('美元'), '美股带美元单位');

    // A 股：带“元”
    const cnQuote = { code: 'sh600519', name: '贵州茅台', price: 1600.0, changePercent: 0.5, type: 'stock' };
    const cnSpeech = formatQuoteSpeech(cnQuote);
    t.true(cnSpeech.includes('元'), 'A股带元单位');
  });

  QUnit.test('Alert 弹窗/TTS 无元单位格式化', (t) => {
    const glQuote = { code: 'GL_CL0', name: '纽约原油', price: 103.72, changePercent: 3.72, type: 'futures_global' };
    const alertMsg = formatAlertMessage(glQuote, 'up', 3.0);
    t.true(alertMsg.includes('103.72'), '含价格数值');
    t.false(alertMsg.includes('元'), 'Alert 国际期货严格不带“元”');
  });
});

QUnit.module('Phase 1: 智能搜索联想与 hf_* 彻底隔离', (hooks) => {
  let index;

  hooks.before(() => {
    index = createStockSearchIndex({ items: [] });
  });

  QUnit.test('国际期货按代码、品种、中文、拼音联想命中', (t) => {
    const resCl0 = searchStocks('CL0', { index });
    t.true(resCl0.items.length > 0, 'CL0 命中');
    t.equal(resCl0.items[0].code, 'GL_CL0');

    const resGlCl = searchStocks('GL_CL0', { index });
    t.equal(resGlCl.items[0].code, 'GL_CL0');

    const resYuanyou = searchStocks('美原油', { index });
    t.ok(resYuanyou.items.find((it) => it.code === 'GL_CL0'), '美原油 命中 GL_CL0');

    const resA50 = searchStocks('A50', { index });
    t.ok(resA50.items.find((it) => it.code === 'GL_A50'), 'A50 命中 GL_A50');

    const resHsi = searchStocks('恒指', { index });
    t.ok(resHsi.items.find((it) => it.code === 'GL_HSI'), '恒指 命中 GL_HSI');
  });

  QUnit.test('全局搜索候选项与内部 hf_* 集合完全不相交 (∩ ^hf_ = ∅)', (t) => {
    const queries = ['cl', 'si', 'gc', 'hg', 'ng', 'nq', 'es', 'ym', 'a50', 'hsi', 'hf_cl', 'hf_si'];
    for (const q of queries) {
      const res = searchStocks(q, { index });
      for (const item of res.items) {
        t.false(/^hf_/i.test(item.code), `候选项代码 "${item.code}" 不得以 hf_ 开头`);
        t.false(/^hf_/i.test(item.displayCode), `候选项展示代码 "${item.displayCode}" 不得以 hf_ 开头`);
      }
    }
  });
});
