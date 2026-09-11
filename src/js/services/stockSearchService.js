// 股票与期货智能联想搜索服务
import { isBatchQuery } from './batchExportService.js';
import { PRODUCT_MAP, EXCHANGES } from '../futures/contractCatalog.js';
import { parseFutureInput } from '../futures/instrument.js';
import { normalizeCode } from '../parser.js';

// 中文多音字及特殊字拼音补全 (针对期货品种等)
const KNOWN_FUTURES_PINYIN = {
  RB: { initials: 'lwg', pinyin: 'luowengang' },
  HC: { initials: 'rzjb', pinyin: 'rezhajuanban' },
  FU: { initials: 'rly', pinyin: 'ranliaoyou' },
  BU: { initials: 'sylq', pinyin: 'shiyouliqing' },
  RU: { initials: 'trxj', pinyin: 'tianranxiangjiao' },
  SP: { initials: 'pbzyj', pinyin: 'piaobaizhenyjiang' },
  SS: { initials: 'bxg', pinyin: 'buxiugang' },
  WR: { initials: 'xc', pinyin: 'xiancai' },
  CU: { initials: 'ht', pinyin: 'hutong' },
  AL: { initials: 'hl', pinyin: 'hulu' },
  ZN: { initials: 'hx', pinyin: 'huxin' },
  PB: { initials: 'hq', pinyin: 'huqian' },
  NI: { initials: 'hn', pinyin: 'hunie' },
  SN: { initials: 'hx', pinyin: 'huxi' },
  AO: { initials: 'yhl', pinyin: 'yanghualv' },
  AU: { initials: 'hj', pinyin: 'hujin' },
  AG: { initials: 'hy', pinyin: 'huyin' },
  SC: { initials: 'yy', pinyin: 'yuanyou' },
  LU: { initials: 'dxrly', pinyin: 'diliuranliaoyou' },
  NR: { initials: '20hj', pinyin: '20haojiao' },
  BC: { initials: 'gjt', pinyin: 'guojitong' },
  EC: { initials: 'jyox', pinyin: 'jiyunouxian' },
  M: { initials: 'dp', pinyin: 'doupo' },
  Y: { initials: 'dy', pinyin: 'douyou' },
  A: { initials: 'dy', pinyin: 'douyi' },
  B: { initials: 'de', pinyin: 'douer' },
  P: { initials: 'zly', pinyin: 'zonglvyou' },
  C: { initials: 'ym', pinyin: 'yumi' },
  CS: { initials: 'ymdf', pinyin: 'yumidianfen' },
  L: { initials: 'sl', pinyin: 'sulia' },
  V: { initials: 'pvc', pinyin: 'pvc' },
  PP: { initials: 'jbx', pinyin: 'jubingxi' },
  J: { initials: 'jt', pinyin: 'jiaotan' },
  JM: { initials: 'jm', pinyin: 'jiaomei' },
  I: { initials: 'tks', pinyin: 'tiekuangshi' },
  EG: { initials: 'yeg', pinyin: 'yierchun' },
  EB: { initials: 'bxy', pinyin: 'benyixi' },
  PG: { initials: 'lpg', pinyin: 'lpg' },
  JD: { initials: 'jd', pinyin: 'jidan' },
  LH: { initials: 'sz', pinyin: 'shengzhu' },
  SR: { initials: 'bt', pinyin: 'baitang' },
  CF: { initials: 'mh', pinyin: 'mianhua' },
  TA: { initials: 'pta', pinyin: 'pta' },
  MA: { initials: 'jc', pinyin: 'jiachun' },
  FG: { initials: 'bl', pinyin: 'boli' },
  SA: { initials: 'cj', pinyin: 'chunjian' },
  OI: { initials: 'cy', pinyin: 'caiyou' },
  RM: { initials: 'cp', pinyin: 'caipo' },
  SF: { initials: 'gt', pinyin: 'guitie' },
  SM: { initials: 'mg', pinyin: 'menggui' },
  AP: { initials: 'pg', pinyin: 'pingguo' },
  CJ: { initials: 'hz', pinyin: 'hongzao' },
  UR: { initials: 'ns', pinyin: 'niaosu' },
  PX: { initials: 'dejb', pinyin: 'duierjiaben' },
  SH: { initials: 'sj', pinyin: 'shaojian' },
  SI: { initials: 'gyg', pinyin: 'gongyegui' },
  LC: { initials: 'tsl', pinyin: 'tansuanli' },
  IF: { initials: 'hs300', pinyin: 'hushen300' },
  IC: { initials: 'zz500', pinyin: 'zhongzheng500' },
  IH: { initials: 'sz50', pinyin: 'shangzheng50' },
  IM: { initials: 'zz1000', pinyin: 'zhongzheng1000' },
  T: { initials: '10ngz', pinyin: '10nianqiguozhai' },
  TF: { initials: '5ngz', pinyin: '5nianqiguozhai' },
  TS: { initials: '2ngz', pinyin: '2nianqiguozhai' },
  TL: { initials: '30ngz', pinyin: '30nianqiguozhai' }
};

export const MAX_QUERY_LENGTH = 64;

export function normalizeQuery(query) {
  if (query === null || query === undefined) return '';
  const s = String(query).normalize('NFKC').trim().toLowerCase();
  return s.replace(/ü/g, 'v');
}

export function detectQueryMode(raw) {
  if (raw === null || raw === undefined) return 'empty';
  const trimmed = String(raw).normalize('NFKC').trim();
  if (!trimmed) return 'empty';
  if (isBatchQuery(raw)) return 'batch';
  if (Array.from(trimmed).length > MAX_QUERY_LENGTH) return 'overlong';
  return 'single';
}

export function beijingDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  return year && month && day ? `${year}${month}${day}` : '';
}

/**
 * 校验 /api/cache/spot/latest 封套有效性与时效 (需求 §4.3)
 */
export function validateSpotSnapshot(json, now = Date.now()) {
  if (!json || typeof json !== 'object') {
    return { valid: false, reason: '非法响应格式' };
  }
  if (json.ok !== true) {
    return { valid: false, reason: json.error || '快照返回错误' };
  }
  if (json.stale === true) {
    return { valid: false, reason: '快照已过期 (stale=true)' };
  }
  if (typeof json.generatedAt !== 'number' || !Number.isFinite(json.generatedAt)) {
    return { valid: false, reason: '缺失有效 generatedAt 时间戳' };
  }
  // 不得在未来 (允许 5 秒时钟漂移)
  if (json.generatedAt > now + 5000) {
    return { valid: false, reason: '时间戳超前 (未来时间)' };
  }
  const ttlMs = Number.isFinite(Number(json.ttlMs)) ? Number(json.ttlMs) : null;
  if (!ttlMs || ttlMs <= 0) {
    return { valid: false, reason: '缺失有效 ttlMs' };
  }
  if (now - json.generatedAt > ttlMs) {
    return { valid: false, reason: '快照已超过 TTL 窗口' };
  }
  // 必须是北京时间同一自然日
  const snapshotDate = beijingDateKey(new Date(json.generatedAt));
  const currentDate = beijingDateKey(new Date(now));
  if (snapshotDate !== currentDate) {
    return { valid: false, reason: '跨日快照失效' };
  }

  const items = json.data && Array.isArray(json.data.items) ? json.data.items : [];
  return {
    valid: true,
    items,
    asOf: json.generatedAt,
    universeComplete: !!json.data?.universeComplete
  };
}

/**
 * 解析股票或期货的展示状态 (ST, *ST, XD, XR, DR, N, C)
 */
export function parseStatusFlag(name) {
  if (!name || typeof name !== 'string') return null;
  const s = name.trim();
  const m = s.match(/^(\*ST|ST|XD|XR|DR)(?=\s*([^\x20-\x7e]|$))/i)
    || s.match(/^([NC])(?=\s*[^\x20-\x7e])/);
  return m ? m[1].toUpperCase() : null;
}


/**
 * 从字典与期货目录构建内存搜索条目集合
 */
export function createStockSearchIndex(dictionaryData, futuresMap = PRODUCT_MAP) {
  const stockItems = (dictionaryData && Array.isArray(dictionaryData.items))
    ? dictionaryData.items
    : [];

  const list = [];

  for (const s of stockItems) {
    const code = s.c.toLowerCase();
    const name = s.n;
    const baseName = s.b || s.n;
    const initials = (s.i || '').toLowerCase();
    const pinyin = (s.p || '').toLowerCase();
    const baseInitials = (s.bi || s.i || '').toLowerCase();
    const basePinyin = (s.bp || s.p || '').toLowerCase();
    const board = s.m || 'A股';
    const aliases = Array.isArray(s.a) ? s.a.map((a) => ({
      name: a.name,
      type: a.type || 'former',
      initials: (a.initials || '').toLowerCase(),
      pinyin: (a.pinyin || '').toLowerCase()
    })) : [];

    list.push({
      code,
      displayCode: code.toUpperCase(),
      numCode: code.replace(/^(sh|sz|bj)/, ''),
      name,
      baseName,
      initials,
      pinyin,
      baseInitials,
      basePinyin,
      board,
      type: 'stock',
      aliases
    });
  }

  // 合并期货品种连续合约
  for (const [prod, info] of Object.entries(futuresMap || {})) {
    const pLower = prod.toLowerCase();
    const code = `${pLower}0`;
    const displayCode = `${prod}0`;
    const name = `${info.name}连续`;
    const baseName = info.name;
    const meta = KNOWN_FUTURES_PINYIN[prod] || { initials: pLower, pinyin: pLower };
    const exchangeObj = EXCHANGES[info.exchange?.toUpperCase()] || { name: info.exchange || '期货' };
    const board = `${exchangeObj.name} · 连续`;

    list.push({
      code,
      displayCode,
      numCode: code,
      name,
      baseName,
      initials: meta.initials.toLowerCase(),
      pinyin: meta.pinyin.toLowerCase(),
      baseInitials: meta.initials.toLowerCase(),
      basePinyin: meta.pinyin.toLowerCase(),
      product: pLower,
      board,
      type: 'future',
      isContinuous: true,
      aliases: [
        {
          name: info.name,
          type: 'alias',
          initials: meta.initials.toLowerCase(),
          pinyin: meta.pinyin.toLowerCase()
        }
      ]
    });
  }

  return {
    items: list,
    meta: {
      version: dictionaryData?.version || 'unknown',
      asOfDate: dictionaryData?.asOfDate || null,
      generatedAt: dictionaryData?.generatedAt || null,
      count: list.length
    }
  };
}

let cachedDictionaryPromise = null;
let cachedDictionaryResult = null;

export async function loadStockDictionary({
  fetchFn = globalThis.fetch,
  url = '/data/stock-suggest-dictionary.json',
  fallbackData = null
} = {}) {
  if (cachedDictionaryResult) return cachedDictionaryResult;
  if (cachedDictionaryPromise) return cachedDictionaryPromise;

  cachedDictionaryPromise = (async () => {
    try {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      cachedDictionaryResult = createStockSearchIndex(json);
      return cachedDictionaryResult;
    } catch (err) {
      if (fallbackData) {
        cachedDictionaryResult = createStockSearchIndex(fallbackData);
        return cachedDictionaryResult;
      }
      cachedDictionaryPromise = null;
      throw err;
    }
  })();

  return cachedDictionaryPromise;
}

export function resetDictionaryCache() {
  cachedDictionaryPromise = null;
  cachedDictionaryResult = null;
}

/**
 * 核心匹配判定与优先级分配
 * 优先级顺序 (§2.4):
 * 1. 完整规范代码 / 完整期货合约
 * 2. 当前展示名或基础简称完全匹配
 * 3. 曾用名中文完全匹配
 * 4. 代码前缀 (含期货产品代码)
 * 5. 现名/基础名首字母完全，其次首字母前缀
 * 6. 现名/基础名中文子串
 * 7. 现名/基础名全拼完全，其次全拼子串
 * 8. 曾用名首字母完全、首字母前缀、中文子串、全拼完全、全拼子串
 * 9. 仅状态匹配
 */
export function evaluateItemMatch(item, query, { activeStatus = null } = {}) {
  if (!query) return null;
  const q = query;
  const isPureStatus = ['st', '*st', 'xd', 'xr', 'dr', 'n', 'c'].includes(q);

  // 1. 完整规范代码或完整期货合约
  if (item.code === q || item.numCode === q || (item.type === 'future' && item.displayCode.toLowerCase() === q)) {
    return {
      priority: 1,
      matchIndex: 0,
      matchKeyLength: item.code.length,
      matchedReason: null
    };
  }
  const normInput = normalizeCode(q);
  if (normInput && normInput === item.code) {
    return {
      priority: 1,
      matchIndex: 0,
      matchKeyLength: item.code.length,
      matchedReason: null
    };
  }

  // 纯状态查询不能把历史名 ST 当今日警示 (§2.3/S06)
  // 如果是纯状态查询，跳过股票的静态名称/曾用名/拼音匹配，仅走期货或有效当日状态
  if (isPureStatus && item.type === 'stock') {
    if (!activeStatus) return null;
    const statusLower = activeStatus.toLowerCase();
    let statusHit = false;
    if (q === 'st' && (statusLower === 'st' || statusLower === '*st')) statusHit = true;
    else if (q === '*st' && statusLower === '*st') statusHit = true;
    else if (q === statusLower) statusHit = true;

    if (statusHit) {
      return {
        priority: 9,
        matchIndex: 0,
        matchKeyLength: activeStatus.length,
        matchedReason: null
      };
    }
    return null;
  }

  // 2. 当前展示名或基础简称完全匹配
  const cleanName = item.name.replace(/\s+/g, '').toLowerCase();
  const cleanBase = item.baseName.replace(/\s+/g, '').toLowerCase();
  const cleanQ = q.replace(/\s+/g, '').toLowerCase();

  if (cleanName === cleanQ || cleanBase === cleanQ) {
    return {
      priority: 2,
      matchIndex: 0,
      matchKeyLength: cleanBase.length,
      matchedReason: null
    };
  }

  // 3. 曾用名中文完全匹配
  for (const alias of item.aliases) {
    const aClean = alias.name.replace(/\s+/g, '').toLowerCase();
    if (aClean === cleanQ) {
      return {
        priority: 3,
        matchIndex: 0,
        matchKeyLength: aClean.length,
        matchedReason: `曾用名: ${alias.name}`
      };
    }
  }

  // 4. 代码前缀 (含期货产品代码)
  if (item.code.startsWith(q)) {
    const numMatchIdx = item.numCode.indexOf(q.replace(/^(sh|sz|bj)/, ''));
    return {
      priority: 4,
      matchIndex: numMatchIdx >= 0 ? numMatchIdx : 0,
      matchKeyLength: item.code.length,
      matchedReason: null
    };
  }
  if (item.numCode.startsWith(q)) {
    return {
      priority: 4,
      matchIndex: 0,
      matchKeyLength: item.numCode.length,
      matchedReason: null
    };
  }
  if (item.type === 'future' && item.product && (item.product === q || item.product.startsWith(q))) {
    return {
      priority: 4,
      matchIndex: 0,
      matchKeyLength: item.product.length,
      matchedReason: null
    };
  }

  // 5. 现名/基础名首字母完全，其次首字母前缀
  if (item.initials === q || item.baseInitials === q) {
    return {
      priority: 5.1,
      matchIndex: 0,
      matchKeyLength: item.baseInitials.length,
      matchedReason: null
    };
  }
  if (item.initials.startsWith(q) || item.baseInitials.startsWith(q)) {
    return {
      priority: 5.2,
      matchIndex: 0,
      matchKeyLength: item.baseInitials.length,
      matchedReason: null
    };
  }

  // 6. 现名/基础名中文连续子串
  const idxCleanName = cleanName.indexOf(cleanQ);
  const idxCleanBase = cleanBase.indexOf(cleanQ);
  if (idxCleanName >= 0 || idxCleanBase >= 0) {
    const bestIdx = idxCleanBase >= 0 ? idxCleanBase : idxCleanName;
    return {
      priority: 6,
      matchIndex: bestIdx,
      matchKeyLength: cleanBase.length,
      matchedReason: null
    };
  }

  // 7. 现名/基础名全拼完全，其次全拼子串
  if (item.pinyin === q || item.basePinyin === q) {
    return {
      priority: 7.1,
      matchIndex: 0,
      matchKeyLength: item.basePinyin.length,
      matchedReason: null
    };
  }
  const idxPy = item.pinyin.indexOf(q);
  const idxBasePy = item.basePinyin.indexOf(q);
  if (idxPy >= 0 || idxBasePy >= 0) {
    const bestIdx = idxBasePy >= 0 ? idxBasePy : idxPy;
    return {
      priority: 7.2,
      matchIndex: bestIdx,
      matchKeyLength: item.basePinyin.length,
      matchedReason: null
    };
  }

  // 8. 曾用名匹配 (首字母完全、首字母前缀、中文子串、全拼完全、全拼子串)
  let bestAliasMatch = null;
  for (const alias of item.aliases) {
    const aClean = alias.name.replace(/\s+/g, '').toLowerCase();
    const aInitials = alias.initials.toLowerCase();
    const aPinyin = alias.pinyin.toLowerCase();

    let subPriority = null;
    let matchIdx = 0;

    if (aInitials === q) {
      subPriority = 8.1;
      matchIdx = 0;
    } else if (aInitials.startsWith(q)) {
      subPriority = 8.2;
      matchIdx = 0;
    } else {
      const cIdx = aClean.indexOf(cleanQ);
      if (cIdx >= 0) {
        subPriority = 8.3;
        matchIdx = cIdx;
      } else if (aPinyin === q) {
        subPriority = 8.4;
        matchIdx = 0;
      } else {
        const pIdx = aPinyin.indexOf(q);
        if (pIdx >= 0) {
          subPriority = 8.5;
          matchIdx = pIdx;
        }
      }
    }

    if (subPriority !== null) {
      if (!bestAliasMatch || subPriority < bestAliasMatch.priority) {
        bestAliasMatch = {
          priority: subPriority,
          matchIndex: matchIdx,
          matchKeyLength: aClean.length,
          matchedReason: `曾用名: ${alias.name}`
        };
      }
    }
  }
  if (bestAliasMatch) return bestAliasMatch;

  // 9. 状态匹配 (仅有效当日状态)
  if (activeStatus && item.type === 'stock') {
    const statusLower = activeStatus.toLowerCase();
    let statusHit = false;
    if (q === 'st' && (statusLower === 'st' || statusLower === '*st')) statusHit = true;
    else if (q === '*st' && statusLower === '*st') statusHit = true;
    else if (q === statusLower) statusHit = true;

    if (statusHit) {
      return {
        priority: 9,
        matchIndex: 0,
        matchKeyLength: activeStatus.length,
        matchedReason: null
      };
    }

    // 组合状态查询 (如 *st西发, st西发, xd美的)
    let prefixStatus = null;
    let remainQuery = null;
    if (q.startsWith('*st')) { prefixStatus = '*st'; remainQuery = q.slice(3); }
    else if (q.startsWith('st')) { prefixStatus = 'st'; remainQuery = q.slice(2); }
    else if (q.startsWith('xd')) { prefixStatus = 'xd'; remainQuery = q.slice(2); }
    else if (q.startsWith('xr')) { prefixStatus = 'xr'; remainQuery = q.slice(2); }
    else if (q.startsWith('dr')) { prefixStatus = 'dr'; remainQuery = q.slice(2); }
    else if (q.startsWith('n')) { prefixStatus = 'n'; remainQuery = q.slice(1); }
    else if (q.startsWith('c')) { prefixStatus = 'c'; remainQuery = q.slice(1); }

    if (prefixStatus && remainQuery) {
      const matchPrefix = prefixStatus === 'st'
        ? (statusLower === 'st' || statusLower === '*st')
        : (statusLower === prefixStatus);

      if (matchPrefix) {
        const sub = evaluateItemMatch(item, remainQuery, { activeStatus: null });
        if (sub && sub.priority <= 8.5) {
          return {
            priority: sub.priority,
            matchIndex: sub.matchIndex,
            matchKeyLength: sub.matchKeyLength,
            matchedReason: sub.matchedReason
          };
        }
      }
    }
  }

  return null;
}

/**
 * 智能联想搜索入口
 */
export function searchStocks(rawQuery, options = {}) {
  const {
    index,
    watchList = [],
    spotSnapshot = null,
    now = Date.now(),
    maxResults = 12
  } = options;

  const mode = detectQueryMode(rawQuery);
  if (mode === 'empty') {
    return { mode: 'empty', items: [], total: 0, hasMore: false };
  }
  if (mode === 'batch') {
    return { mode: 'batch', items: [], total: 0, hasMore: false };
  }
  if (mode === 'overlong') {
    return { mode: 'overlong', items: [], total: 0, hasMore: false, message: '查询过长，请缩短输入' };
  }

  const query = normalizeQuery(rawQuery);
  const items = index?.items || [];
  const currentWatchSet = new Set((watchList || []).map((c) => String(c).toLowerCase()));

  // 状态快照时效校验
  let snapshotValid = false;
  let statusReason = null;
  const activeStatusMap = new Map();

  if (spotSnapshot) {
    const val = validateSpotSnapshot(spotSnapshot, now);
    if (val.valid) {
      snapshotValid = true;
      for (const it of val.items) {
        if (!it || !it.code) continue;
        const code = String(it.code).toLowerCase();
        const flag = parseStatusFlag(it.name);
        if (flag) activeStatusMap.set(code, flag);
      }
    } else {
      statusReason = val.reason;
    }
  }

  // 检查是否输入完整月份期货合约代码 (如 RB2610, nf2105)
  const futureInst = parseFutureInput(rawQuery);
  if (futureInst) {
    const code = futureInst.symbol.toLowerCase();
    const isAlreadyAdded = currentWatchSet.has(code);
    const candidate = {
      code,
      displayCode: futureInst.symbol.toUpperCase(),
      numCode: code,
      name: `${futureInst.name || futureInst.product}${futureInst.term}`,
      baseName: futureInst.name || futureInst.product,
      type: 'future',
      board: `${EXCHANGES[futureInst.exchange?.toUpperCase()]?.name || futureInst.exchange}`,
      status: null,
      matchedFormerName: null,
      alreadyAdded: isAlreadyAdded,
      matchPriority: 1
    };
    return {
      mode: 'single',
      items: [candidate],
      total: 1,
      hasMore: false,
      query,
      snapshotValid
    };
  }

  const matched = [];

  for (const item of items) {
    const activeStatus = snapshotValid ? (activeStatusMap.get(item.code) || null) : null;
    const matchResult = evaluateItemMatch(item, query, { activeStatus });
    if (!matchResult) continue;

    matched.push({
      item,
      activeStatus,
      priority: matchResult.priority,
      matchIndex: matchResult.matchIndex,
      matchKeyLength: matchResult.matchKeyLength,
      matchedReason: matchResult.matchedReason
    });
  }

  // 排序规则 (§2.4):
  // 1. 优先级升序
  // 2. 命中位置靠前
  // 3. 命中键较短
  // 4. 规范代码字典序
  // 5. 名称字典序
  matched.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.matchIndex !== b.matchIndex) return a.matchIndex - b.matchIndex;
    if (a.matchKeyLength !== b.matchKeyLength) return a.matchKeyLength - b.matchKeyLength;
    const cComp = a.item.code.localeCompare(b.item.code);
    if (cComp !== 0) return cComp;
    return a.item.name.localeCompare(b.item.name);
  });

  const total = matched.length;
  const sliced = matched.slice(0, maxResults);
  const resultCandidates = sliced.map(({ item, activeStatus, priority, matchedReason }) => ({
    code: item.code,
    displayCode: item.displayCode,
    numCode: item.numCode,
    name: item.name,
    baseName: item.baseName,
    type: item.type,
    board: item.board,
    status: activeStatus,
    matchedFormerName: matchedReason,
    alreadyAdded: currentWatchSet.has(item.code),
    matchPriority: priority
  }));

  return {
    mode: 'single',
    items: resultCandidates,
    total,
    hasMore: total > maxResults,
    query,
    snapshotValid,
    statusNotice: (!snapshotValid && statusReason) ? '当日状态未更新' : null
  };
}
