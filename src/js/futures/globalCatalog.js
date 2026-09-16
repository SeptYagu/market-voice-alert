/**
 * 国际/外盘期货元数据注册表与反查工具
 */

export const GLOBAL_FUTURES_CATALOG = Object.freeze({
  GL_CL0: Object.freeze({
    code: 'GL_CL0',
    symbol: 'CL0',
    name: '纽约原油',
    currency: 'USD',
    exchange: 'NYMEX',
    marketId: 102,
    secid: '102.CL00Y',
    eastmoneySymbol: 'CL00Y',
    sinaSymbol: 'hf_CL',
    qtDivisor: 100,
    sinaScale: 1.0,
    priceDecimals: 2,
    baseFromOwnField7: true
  }),
  GL_GC0: Object.freeze({
    code: 'GL_GC0',
    symbol: 'GC0',
    name: '纽约黄金',
    currency: 'USD',
    exchange: 'COMEX',
    marketId: 101,
    secid: '101.GC00Y',
    eastmoneySymbol: 'GC00Y',
    sinaSymbol: 'hf_GC',
    qtDivisor: 10,
    sinaScale: 1.0,
    priceDecimals: 1
  }),
  GL_SI0: Object.freeze({
    code: 'GL_SI0',
    symbol: 'SI0',
    name: '纽约白银',
    currency: 'USD',
    exchange: 'COMEX',
    marketId: 101,
    secid: '101.SI00Y',
    eastmoneySymbol: 'SI00Y',
    sinaSymbol: 'hf_SI',
    qtDivisor: 1000,
    sinaScale: 1.0,
    priceDecimals: 3
  }),
  GL_HG0: Object.freeze({
    code: 'GL_HG0',
    symbol: 'HG0',
    name: '纽约美铜',
    currency: 'USD',
    exchange: 'COMEX',
    marketId: 101,
    secid: '101.HG00Y',
    eastmoneySymbol: 'HG00Y',
    sinaSymbol: 'hf_HG',
    qtDivisor: 10000,
    sinaScale: 0.01,
    priceDecimals: 4
  }),
  GL_NG0: Object.freeze({
    code: 'GL_NG0',
    symbol: 'NG0',
    name: '天然气',
    currency: 'USD',
    exchange: 'NYMEX',
    marketId: 102,
    secid: '102.NG00Y',
    eastmoneySymbol: 'NG00Y',
    sinaSymbol: 'hf_NG',
    qtDivisor: 1000,
    sinaScale: 1.0,
    priceDecimals: 3,
    baseFromOwnField7: true
  }),
  GL_NQ0: Object.freeze({
    code: 'GL_NQ0',
    symbol: 'NQ0',
    name: '纳斯达克期货',
    currency: 'USD',
    exchange: 'CME',
    marketId: 103,
    secid: '103.NQ00Y',
    eastmoneySymbol: 'NQ00Y',
    sinaSymbol: 'hf_NQ',
    qtDivisor: 100,
    sinaScale: 1.0,
    priceDecimals: 2
  }),
  GL_ES0: Object.freeze({
    code: 'GL_ES0',
    symbol: 'ES0',
    name: '标普500期货',
    currency: 'USD',
    exchange: 'CME',
    marketId: 103,
    secid: '103.ES00Y',
    eastmoneySymbol: 'ES00Y',
    sinaSymbol: 'hf_ES',
    qtDivisor: 100,
    sinaScale: 1.0,
    priceDecimals: 2
  }),
  GL_YM0: Object.freeze({
    code: 'GL_YM0',
    symbol: 'YM0',
    name: '道琼斯期货',
    currency: 'USD',
    exchange: 'CME',
    marketId: 103,
    secid: '103.YM00Y',
    eastmoneySymbol: 'YM00Y',
    sinaSymbol: 'hf_YM',
    qtDivisor: 1,
    sinaScale: 1.0,
    priceDecimals: 0
  }),
  GL_A50: Object.freeze({
    code: 'GL_A50',
    symbol: 'A50',
    name: '富时中国A50',
    currency: 'USD',
    exchange: 'SGX',
    marketId: 104,
    secid: '104.CN00Y',
    eastmoneySymbol: 'CN00Y',
    sinaSymbol: 'hf_CHA50CFD',
    qtDivisor: 10,
    sinaScale: 1.0,
    priceDecimals: 1
  }),
  GL_HSI: Object.freeze({
    code: 'GL_HSI',
    symbol: 'HSI',
    name: '恒生指数期货',
    currency: 'HKD',
    exchange: 'HKFE',
    marketId: 134,
    secid: '134.HSI_M',
    eastmoneySymbol: 'HSI_M',
    sinaSymbol: 'hf_HSI',
    qtDivisor: 1,
    sinaScale: 1.0,
    priceDecimals: 0
  })
});

const SECID_MAP = new Map();
const MARKET_SYMBOL_MAP = new Map();
const SINA_MAP = new Map();

for (const item of Object.values(GLOBAL_FUTURES_CATALOG)) {
  SECID_MAP.set(item.secid.toLowerCase(), item);
  MARKET_SYMBOL_MAP.set(`${item.marketId}:${item.eastmoneySymbol.toLowerCase()}`, item);
  SINA_MAP.set(item.sinaSymbol.toLowerCase(), item);
}

export function isGlobalFutureCode(code) {
  if (!code || typeof code !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(GLOBAL_FUTURES_CATALOG, code.toUpperCase());
}

export function getGlobalFuture(code) {
  if (!code || typeof code !== 'string') return null;
  return GLOBAL_FUTURES_CATALOG[code.toUpperCase()] || null;
}

export function getGlobalFutureBySecId(secid) {
  if (!secid || typeof secid !== 'string') return null;
  return SECID_MAP.get(secid.toLowerCase()) || null;
}

export function getGlobalFutureByMarketAndSymbol(marketId, symbol) {
  if (marketId === undefined || marketId === null || !symbol) return null;
  const key = `${marketId}:${String(symbol).trim().toLowerCase()}`;
  return MARKET_SYMBOL_MAP.get(key) || null;
}

export function getGlobalFutureBySinaSymbol(sinaSymbol) {
  if (!sinaSymbol || typeof sinaSymbol !== 'string') return null;
  return SINA_MAP.get(sinaSymbol.toLowerCase()) || null;
}

export function toEastmoneyGlobalSecId(code) {
  const item = getGlobalFuture(code);
  return item ? item.secid : null;
}

export function toSinaGlobalSymbol(code) {
  const item = getGlobalFuture(code);
  return item ? item.sinaSymbol : null;
}
