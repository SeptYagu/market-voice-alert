import {
  fetchAktoolsLimitUpList,
  fetchAktoolsLimitUpReasonList,
  clearAktoolsCache
} from './aktoolsApi.js';

// =====================================================================
// Backward-compat shims for the old Eastmoney clist/get direct URL.
// Kept so any future consumer (or tests) can still build/parse the old
// format. Not used by the live app since 2026-06-05 (AKTools upgrade).
// =====================================================================

const LIMIT_UP_FS = 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2';
const LIMIT_UP_FIELDS = 'f1,f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f100,f102,f103';
const MAX_PAGE_SIZE = 100;

export function buildLimitUpUrl(opts = {}) {
  const pn = Number(opts.page) > 0 ? Math.floor(Number(opts.page)) : 1;
  const pzRaw = Number(opts.pageSize);
  const pz = Number.isFinite(pzRaw) && pzRaw > 0 && pzRaw <= MAX_PAGE_SIZE
    ? Math.floor(pzRaw)
    : MAX_PAGE_SIZE;
  const params = [
    `pn=${pn}`,
    `pz=${pz}`,
    `po=1`,
    `np=1`,
    `fltt=2`,
    `invt=2`,
    `fid=f3`,
    `fs=${LIMIT_UP_FS}`,
    `fields=${LIMIT_UP_FIELDS}`
  ];
  return `/api/limit-up/qt/clist/get?${params.join('&')}`;
}

function _safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _parseEastmoneyItem(row) {
  if (!row || typeof row !== 'object') return null;
  const code6 = String(row.f12 || '').trim();
  if (!/^\d{6}$/.test(code6)) return null;
  const price = _safeNum(row.f2, NaN);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { code: code6, name: row.f14 || code6, price };
}

export function parseLimitUpList(json) {
  if (!json || typeof json !== 'object') return [];
  const data = json.data;
  if (!data || typeof data !== 'object') return [];
  const diff = Array.isArray(data.diff) ? data.diff : [];
  const out = [];
  for (const row of diff) {
    const it = _parseEastmoneyItem(row);
    if (it) out.push(it);
  }
  return out;
}

// =====================================================================
// Live data path: AKTools (AKShare HTTP proxy on local port 8888).
// 2026-06-05 upgrade — replaces direct Eastmoney clist/get + per-stock
// metadata fetch. Returns enriched items with real 连板数/炸板次数/封板时间.
// =====================================================================

export async function fetchLimitUpList(opts = {}) {
  return await fetchAktoolsLimitUpList({
    signal: opts.signal,
    kind: 'limitUp',
    date: opts.date
  });
}

export async function fetchLimitUpAndBrokenList(opts = {}) {
  const signal = opts.signal;
  const date = opts.date;
  const [limitUpItems, brokenItems] = await Promise.all([
    fetchAktoolsLimitUpList({ signal, kind: 'limitUp', date }),
    fetchAktoolsLimitUpList({ signal, kind: 'broken', date })
  ]);
  return { limitUpItems, brokenItems };
}

// =====================================================================
// Dragon-Tiger Board enrichment for limit-up rows.
// Returns Map<code, {reason, interpretation}> for join into limit-up items.
// Note: `reason` here is 龙虎榜上榜原因, not a true limit-up cause.
// =====================================================================

export async function fetchLimitUpReasons(opts = {}) {
  const items = await fetchAktoolsLimitUpReasonList({
    signal: opts.signal,
    date: opts.date
  });
  const out = new Map();
  for (const it of items) {
    out.set(it.code, { reason: it.reason, interpretation: it.interpretation });
  }
  return out;
}

// =====================================================================
// Backward-compat metadata API. Since 2026-06-05, the main list already
// carries limitUpCount/firstLimitTime/breakCount, so this is a no-op
// pass-through that re-uses the 30s aktools cache (no extra HTTP calls).
// =====================================================================

function _extractMetadata(it) {
  return {
    limitUpCount: it ? it.limitUpCount || 0 : 0,
    firstLimitTime: it ? (it.firstLimitTime || null) : null,
    lastLimitTime: it ? (it.lastLimitTime || null) : null,
    breakCount: it ? (it.breakCount || 0) : 0
  };
}

export async function fetchLimitUpMetadata(code, opts = {}) {
  if (!code || typeof code !== 'string') return null;
  const items = await fetchAktoolsLimitUpList({ kind: 'limitUp', date: opts.date });
  const it = items.find((x) => x.code === code);
  return _extractMetadata(it);
}

export async function fetchLimitUpMetadataBatch(codes, options = {}) {
  if (!Array.isArray(codes) || !codes.length) return new Map();
  const items = await fetchAktoolsLimitUpList({ kind: 'limitUp', date: options.date });
  const out = new Map();
  for (const it of items) {
    if (codes.includes(it.code)) {
      out.set(it.code, _extractMetadata(it));
    }
  }
  return out;
}

export function clearLimitUpMetadataCache() {
  clearAktoolsCache();
}
