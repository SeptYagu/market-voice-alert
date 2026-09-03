import { getPriceLimit } from './kline.js';

const ST_RE = /^\s*\*?st\b/i;

export const LIMIT_UP_GROUPS = Object.freeze([
  Object.freeze({ key: '3+', label: '3 连板及以上', match: (n) => Number(n) >= 3 }),
  Object.freeze({ key: '2',  label: '2 连板',        match: (n) => Number(n) === 2 }),
  Object.freeze({ key: '1',  label: '1 连板 / 首板', match: (n) => {
    const v = Number(n);
    return v === 1 || v === 0;
  } }),
  Object.freeze({ key: 'broken', label: '炸板', match: () => false })
]);

const _GROUP_BY_KEY = new Map(LIMIT_UP_GROUPS.map((g) => [g.key, g]));

export function getLimitUpGroupLabel(key) {
  const g = _GROUP_BY_KEY.get(key);
  return g ? g.label : String(key);
}

export function isLimitUpName(name) {
  return typeof name === 'string' && ST_RE.test(name);
}

function _bucketOf(count) {
  for (const g of LIMIT_UP_GROUPS) {
    if (g.match(count)) return g.key;
  }
  return '1';
}

export function isLimitUpBroken(item) {
  if (!item) return false;
  const pct = Number(item.changePercent);
  if (!Number.isFinite(pct)) return true;
  const limit = getPriceLimit(item.code, item.name);
  return pct < limit - 0.5;
}

export function classifyByLimitCount(items) {
  const buckets = { '3+': [], '2': [], '1': [] };
  if (!Array.isArray(items)) return buckets;
  for (const it of items) {
    if (!it) continue;
    const key = _bucketOf(it.limitUpCount);
    buckets[key].push(it);
  }
  return buckets;
}

export function classifyWithBroken(items) {
  const buckets = { '3+': [], '2': [], '1': [], broken: [] };
  if (!Array.isArray(items)) return buckets;
  for (const it of items) {
    if (!it) continue;
    if (isLimitUpBroken(it)) {
      buckets.broken.push(it);
    } else {
      buckets[_bucketOf(it.limitUpCount)].push(it);
    }
  }
  return buckets;
}

function _compareByCount(a, b) {
  const ac = Number(a.limitUpCount) || 0;
  const bc = Number(b.limitUpCount) || 0;
  if (ac !== bc) return bc - ac;
  const ap = Number(a.changePercent) || 0;
  const bp = Number(b.changePercent) || 0;
  if (ap !== bp) return bp - ap;
  const ac2 = String(a.code || '');
  const bc2 = String(b.code || '');
  return ac2 < bc2 ? -1 : ac2 > bc2 ? 1 : 0;
}

function _compareByPct(a, b) {
  const ap = Number(a.changePercent) || 0;
  const bp = Number(b.changePercent) || 0;
  if (ap !== bp) return bp - ap;
  const ac = Number(a.limitUpCount) || 0;
  const bc = Number(b.limitUpCount) || 0;
  if (ac !== bc) return bc - ac;
  const ac2 = String(a.code || '');
  const bc2 = String(b.code || '');
  return ac2 < bc2 ? -1 : ac2 > bc2 ? 1 : 0;
}

function _compareByTime(a, b) {
  const at = a && a.lastLimitTime;
  const bt = b && b.lastLimitTime;
  if (!at && !bt) {
    const ap = Number(a.changePercent) || 0;
    const bp = Number(b.changePercent) || 0;
    if (ap !== bp) return bp - ap;
    const ac2 = String(a.code || '');
    const bc2 = String(b.code || '');
    return ac2 < bc2 ? -1 : ac2 > bc2 ? 1 : 0;
  }
  if (!at) return 1;
  if (!bt) return -1;
  if (at !== bt) return at < bt ? -1 : 1;
  const ap = Number(a.changePercent) || 0;
  const bp = Number(b.changePercent) || 0;
  if (ap !== bp) return bp - ap;
  const ac2 = String(a.code || '');
  const bc2 = String(b.code || '');
  return ac2 < bc2 ? -1 : ac2 > bc2 ? 1 : 0;
}

function _compareByAmount(a, b) {
  const aa = Number(a.amount) || 0;
  const ba = Number(b.amount) || 0;
  if (aa !== ba) return ba - aa;
  const ap = Number(a.changePercent) || 0;
  const bp = Number(b.changePercent) || 0;
  if (ap !== bp) return bp - ap;
  const ac2 = String(a.code || '');
  const bc2 = String(b.code || '');
  return ac2 < bc2 ? -1 : ac2 > bc2 ? 1 : 0;
}

function _compareByNumberField(field, fallback = 'changePercent') {
  return (a, b) => {
    const av = Number(a && a[field]) || 0;
    const bv = Number(b && b[field]) || 0;
    if (av !== bv) return bv - av;
    const af = Number(a && a[fallback]) || 0;
    const bf = Number(b && b[fallback]) || 0;
    if (af !== bf) return bf - af;
    const ac = String((a && a.code) || '');
    const bc = String((b && b.code) || '');
    return ac < bc ? -1 : ac > bc ? 1 : 0;
  };
}

export function sortByLimitCount(items) {
  if (!Array.isArray(items)) return [];
  return [...items].sort(_compareByCount);
}

export function sortLimitUpItems(items, sortKey) {
  if (!Array.isArray(items)) return [];
  const arr = [...items];
  switch (sortKey) {
    case 'pct': return arr.sort(_compareByPct);
    case 'time': return arr.sort(_compareByTime);
    case 'price': return arr.sort(_compareByNumberField('price'));
    case 'open': return arr.sort(_compareByNumberField('open'));
    case 'volumeRatio': return arr.sort(_compareByNumberField('volumeRatio'));
    case 'break': return arr.sort(_compareByNumberField('breakCount'));
    case 'amount': return arr.sort(_compareByAmount);
    case 'count':
    default: return arr.sort(_compareByCount);
  }
}

export function buildLimitUpGroups(items, sortKey = 'amount') {
  const sorted = sortLimitUpItems(items, sortKey);
  const buckets = classifyWithBroken(sorted);
  return LIMIT_UP_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: buckets[g.key] || []
  }));
}

export function getLimitUpComparator(sortKey = 'amount') {
  switch (sortKey) {
    case 'count': return _compareByCount;
    case 'pct': return _compareByPct;
    case 'time': return _compareByTime;
    case 'price': return _compareByNumberField('price');
    case 'open': return _compareByNumberField('open');
    case 'volumeRatio': return _compareByNumberField('volumeRatio');
    case 'break': return _compareByNumberField('breakCount');
    case 'amount':
    default: return _compareByAmount;
  }
}

export function sortLimitUpGroupItems(items, sortKey = 'amount', direction = 'desc') {
  if (!Array.isArray(items)) return [];
  const baseCompare = getLimitUpComparator(sortKey);
  const sign = direction === 'asc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const res = baseCompare(a, b);
    return res !== 0 ? res * sign : 0;
  });
}

function _lookupLive(liveQuotes, code) {
  if (!liveQuotes || !code) return null;
  if (typeof liveQuotes.get === 'function') {
    return liveQuotes.get(code) || null;
  }
  return liveQuotes[code] || null;
}

export function mergeLiveTicks(items, liveQuotes) {
  if (!Array.isArray(items) || !items.length) return items;
  let changed = false;
  const out = items.map((it) => {
    if (!it || !it.code) return it;
    const live = _lookupLive(liveQuotes, it.code);
    if (!live) return it;
    const newPrice = Number(live.price);
    if (!Number.isFinite(newPrice) || newPrice <= 0) return it;
    const newChange = Number(live.change);
    const newPct = Number(live.changePercent);
    changed = true;
    return {
      ...it,
      price: newPrice,
      change: Number.isFinite(newChange) ? newChange : it.change,
      changePercent: Number.isFinite(newPct) ? newPct : it.changePercent
    };
  });
  return changed ? out : items;
}

export function mergeLimitUpMetadata(items, metaMap) {
  if (!Array.isArray(items) || !metaMap) return items;
  let changed = false;
  const out = items.map((it) => {
    if (!it || !it.code) return it;
    const m = metaMap.get(it.code);
    if (!m) return it;
    changed = true;
    return {
      ...it,
      limitUpCount: m.limitUpCount,
      firstLimitTime: m.firstLimitTime,
      lastLimitTime: m.lastLimitTime === undefined ? it.lastLimitTime : m.lastLimitTime,
      breakCount: m.breakCount
    };
  });
  return changed ? out : items;
}
