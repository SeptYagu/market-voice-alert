/**
 * 国内期货品种与合约目录 (Contract Catalog)
 * 覆盖上期所 (SHFE)、上期能源 (INE)、大商所 (DCE)、郑商所 (CZCE)、广期所 (GFEX)、中金所 (CFFEX)
 */

export const EXCHANGES = Object.freeze({
  SHFE: { id: 'shfe', name: '上海期货交易所' },
  INE: { id: 'ine', name: '上海国际能源交易中心' },
  DCE: { id: 'dce', name: '大连商品交易所' },
  CZCE: { id: 'czce', name: '郑州商品交易所' },
  GFEX: { id: 'gfex', name: '广州期货交易所' },
  CFFEX: { id: 'cffex', name: '中国金融期货交易所' }
});

// 品种定义: [exchange, name, nightSessionEnd ('23:00' | '01:00' | '02:30' | null), priceUnit, multiplier]
export const PRODUCT_MAP = Object.freeze({
  // 上期所 SHFE
  RB: { exchange: 'shfe', name: '螺纹钢', night: '23:00', tick: 1, mult: 10 },
  HC: { exchange: 'shfe', name: '热轧卷板', night: '23:00', tick: 1, mult: 10 },
  FU: { exchange: 'shfe', name: '燃料油', night: '23:00', tick: 1, mult: 10 },
  BU: { exchange: 'shfe', name: '石油沥青', night: '23:00', tick: 1, mult: 10 },
  RU: { exchange: 'shfe', name: '天然橡胶', night: '23:00', tick: 5, mult: 10 },
  SP: { exchange: 'shfe', name: '漂白针叶浆', night: '23:00', tick: 2, mult: 10 },
  SS: { exchange: 'shfe', name: '不锈钢', night: '23:00', tick: 5, mult: 5 },
  WR: { exchange: 'shfe', name: '线材', night: null, tick: 1, mult: 10 },
  CU: { exchange: 'shfe', name: '沪铜', night: '01:00', tick: 10, mult: 5 },
  AL: { exchange: 'shfe', name: '沪铝', night: '01:00', tick: 5, mult: 5 },
  ZN: { exchange: 'shfe', name: '沪锌', night: '01:00', tick: 5, mult: 5 },
  PB: { exchange: 'shfe', name: '沪铅', night: '01:00', tick: 5, mult: 5 },
  NI: { exchange: 'shfe', name: '沪镍', night: '01:00', tick: 10, mult: 1 },
  SN: { exchange: 'shfe', name: '沪锡', night: '01:00', tick: 10, mult: 1 },
  AO: { exchange: 'shfe', name: '氧化铝', night: '01:00', tick: 1, mult: 20 },
  AU: { exchange: 'shfe', name: '沪金', night: '02:30', tick: 0.02, mult: 1000 },
  AG: { exchange: 'shfe', name: '沪银', night: '02:30', tick: 1, mult: 15 },

  // 上期能源 INE
  SC: { exchange: 'ine', name: '原油', night: '02:30', tick: 0.1, mult: 1000 },
  LU: { exchange: 'ine', name: '低硫燃料油', night: '23:00', tick: 1, mult: 10 },
  NR: { exchange: 'ine', name: '20号胶', night: '23:00', tick: 5, mult: 10 },
  BC: { exchange: 'ine', name: '国际铜', night: '01:00', tick: 10, mult: 5 },
  EC: { exchange: 'ine', name: '集运欧线', night: null, tick: 0.1, mult: 50 },

  // 大商所 DCE
  M: { exchange: 'dce', name: '豆粕', night: '23:00', tick: 1, mult: 10 },
  Y: { exchange: 'dce', name: '豆油', night: '23:00', tick: 2, mult: 10 },
  A: { exchange: 'dce', name: '豆一', night: '23:00', tick: 1, mult: 10 },
  B: { exchange: 'dce', name: '豆二', night: '23:00', tick: 1, mult: 10 },
  P: { exchange: 'dce', name: '棕榈油', night: '23:00', tick: 2, mult: 10 },
  C: { exchange: 'dce', name: '玉米', night: '23:00', tick: 1, mult: 10 },
  CS: { exchange: 'dce', name: '玉米淀粉', night: '23:00', tick: 1, mult: 10 },
  L: { exchange: 'dce', name: '塑料', night: '23:00', tick: 5, mult: 5 },
  V: { exchange: 'dce', name: 'PVC', night: '23:00', tick: 5, mult: 5 },
  PP: { exchange: 'dce', name: '聚丙烯', night: '23:00', tick: 1, mult: 5 },
  J: { exchange: 'dce', name: '焦炭', night: '23:00', tick: 0.5, mult: 100 },
  JM: { exchange: 'dce', name: '焦煤', night: '23:00', tick: 0.5, mult: 60 },
  I: { exchange: 'dce', name: '铁矿石', night: '23:00', tick: 0.5, mult: 100 },
  EG: { exchange: 'dce', name: '乙二醇', night: '23:00', tick: 1, mult: 10 },
  EB: { exchange: 'dce', name: '苯乙烯', night: '23:00', tick: 1, mult: 5 },
  PG: { exchange: 'dce', name: 'LPG', night: '23:00', tick: 1, mult: 20 },
  JD: { exchange: 'dce', name: '鸡蛋', night: null, tick: 1, mult: 10 },
  LH: { exchange: 'dce', name: '生猪', night: null, tick: 5, mult: 16 },

  // 郑商所 CZCE
  SR: { exchange: 'czce', name: '白糖', night: '23:00', tick: 1, mult: 10 },
  CF: { exchange: 'czce', name: '棉花', night: '23:00', tick: 5, mult: 5 },
  TA: { exchange: 'czce', name: 'PTA', night: '23:00', tick: 2, mult: 5 },
  MA: { exchange: 'czce', name: '甲醇', night: '23:00', tick: 1, mult: 10 },
  FG: { exchange: 'czce', name: '玻璃', night: '23:00', tick: 1, mult: 20 },
  SA: { exchange: 'czce', name: '纯碱', night: '23:00', tick: 1, mult: 20 },
  OI: { exchange: 'czce', name: '菜油', night: '23:00', tick: 1, mult: 10 },
  RM: { exchange: 'czce', name: '菜粕', night: '23:00', tick: 1, mult: 10 },
  SF: { exchange: 'czce', name: '硅铁', night: null, tick: 2, mult: 5 },
  SM: { exchange: 'czce', name: '锰硅', night: null, tick: 2, mult: 5 },
  AP: { exchange: 'czce', name: '苹果', night: null, tick: 1, mult: 10 },
  CJ: { exchange: 'czce', name: '红枣', night: null, tick: 5, mult: 5 },
  UR: { exchange: 'czce', name: '尿素', night: null, tick: 1, mult: 20 },
  PX: { exchange: 'czce', name: '对二甲苯', night: '23:00', tick: 2, mult: 5 },
  SH: { exchange: 'czce', name: '烧碱', night: '23:00', tick: 1, mult: 30 },

  // 广期所 GFEX
  SI: { exchange: 'gfex', name: '工业硅', night: null, tick: 5, mult: 5 },
  LC: { exchange: 'gfex', name: '碳酸锂', night: null, tick: 50, mult: 1 },

  // 中金所 CFFEX
  IF: { exchange: 'cffex', name: '沪深300', night: null, tick: 0.2, mult: 300, isFinancial: true },
  IC: { exchange: 'cffex', name: '中证500', night: null, tick: 0.2, mult: 200, isFinancial: true },
  IH: { exchange: 'cffex', name: '上证50', night: null, tick: 0.2, mult: 300, isFinancial: true },
  IM: { exchange: 'cffex', name: '中证1000', night: null, tick: 0.2, mult: 200, isFinancial: true },
  T: { exchange: 'cffex', name: '10年期国债', night: null, tick: 0.005, mult: 10000, isFinancial: true, isTreasury: true },
  TF: { exchange: 'cffex', name: '5年期国债', night: null, tick: 0.005, mult: 10000, isFinancial: true, isTreasury: true },
  TS: { exchange: 'cffex', name: '2年期国债', night: null, tick: 0.002, mult: 20000, isFinancial: true, isTreasury: true },
  TL: { exchange: 'cffex', name: '30年期国债', night: null, tick: 0.01, mult: 10000, isFinancial: true, isTreasury: true }
});

const CONTRACT_REGEX = /^([A-Za-z]{1,2})(\d{3,4}|0)$/;

function createInstrument(product, term, info) {
  const isContinuous = term === '0';
  const symbol = `${product}${term}`;
  const exchange = info.exchange;
  const contractKind = isContinuous ? 'continuous' : 'specific';
  const name = isContinuous ? `${info.name}连续` : `${info.name}${term}`;

  return {
    id: `future:${exchange}:${symbol}`,
    type: 'future',
    exchange,
    product,
    term,
    symbol,
    name,
    contractKind,
    isFinancial: !!info.isFinancial,
    isTreasury: !!info.isTreasury,
    nightSessionEnd: info.night,
    priceTick: info.tick,
    contractMultiplier: info.mult,
    providerSymbols: {
      sina: `nf_${symbol}`,
      aktools: symbol
    }
  };
}

/**
 * 解析用户输入的期货代码或名称
 * @param {string} input - 如 "rb2510", "RB0", "IF2603", "nf_rb2510", "螺纹主连"
 * @returns {object|null}
 */
export function parseFutureInput(input) {
  if (!input || typeof input !== 'string') return null;
  let clean = input.trim().toUpperCase();

  // 1. 中文别名检测，如 "螺纹主连", "白糖主力", "沪铜主连"
  if (clean.endsWith('主连') || clean.endsWith('主力')) {
    const namePrefix = clean.slice(0, -2).trim();
    if (!namePrefix) return null;

    // 精确匹配优先
    for (const [prod, info] of Object.entries(PRODUCT_MAP)) {
      if (info.name === namePrefix || prod === namePrefix) {
        return createInstrument(prod, '0', info);
      }
    }
    // 至少2字前缀才允许模糊匹配，杜绝“豆主力”、“沪主力”歧义误判
    if (namePrefix.length >= 2) {
      for (const [prod, info] of Object.entries(PRODUCT_MAP)) {
        if (info.name.startsWith(namePrefix) || namePrefix.startsWith(info.name)) {
          return createInstrument(prod, '0', info);
        }
      }
    }
    return null;
  }

  // 2. 移除旧格式前缀 nf_ 或 NF_ 或 nf (如 nf_rb2510, nfrb2510, nf_RB0)
  clean = clean.replace(/^NF_?/, '');

  const match = clean.match(CONTRACT_REGEX);
  if (!match) return null;

  const product = match[1];
  let term = match[2];

  // 郑商所早期 3 位月份补齐规范 (例如 SR501 -> SR2501)
  if (term.length === 3 && term !== '0') {
    term = '2' + term;
  }

  const info = PRODUCT_MAP[product];
  if (!info) return null;

  return createInstrument(product, term, info);
}
