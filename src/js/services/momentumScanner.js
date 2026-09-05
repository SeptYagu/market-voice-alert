// 10 日强势股扫描与数据服务
import { fetchAktoolsSpotList } from '../aktoolsApi.js';
import { fetchQuotes, fetchKline } from '../api.js';
import {
  computeTenDayMomentum,
  sortMomentumItems,
  MOMENTUM_THRESHOLD_PCT
} from '../views/momentumView.js';

export const MOMENTUM_SCAN_CONCURRENCY = 6;

export async function fetchSharedSpot(signal) {
  const res = await fetch('/api/cache/spot/latest', { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const items = json && json.ok === true && json.data && Array.isArray(json.data.items)
    ? json.data.items
    : [];
  if (!items.length) throw new Error('shared spot cache failed');
  return items;
}

export async function fetchSharedMomentum(signal, threshold = MOMENTUM_THRESHOLD_PCT) {
  const usp = new URLSearchParams();
  usp.set('threshold', String(threshold));
  const res = await fetch(`/api/cache/momentum/ten-day?${usp.toString()}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json || json.ok !== true || !json.data) {
    throw new Error((json && json.error) || 'shared momentum cache failed');
  }
  return json.data;
}

export async function startSharedMomentumScan(signal, threshold = MOMENTUM_THRESHOLD_PCT) {
  const usp = new URLSearchParams();
  usp.set('threshold', String(threshold));
  const res = await fetch(`/api/cache/momentum/ten-day/scan?${usp.toString()}`, {
    method: 'POST',
    signal
  });
  if (!res.ok) throw new Error(`启动扫描失败: HTTP ${res.status}`);
  const json = await res.json();
  if (!json || json.ok !== true) throw new Error((json && json.error) || '启动扫描失败');
  return json.data;
}

export async function fetchMomentumUniverse({ signal, watchList = [], limitUpItems = [] } = {}) {
  try {
    const sharedSpot = await fetchSharedSpot(signal);
    if (Array.isArray(sharedSpot) && sharedSpot.length) return sharedSpot;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
  }
  try {
    const spot = await fetchAktoolsSpotList({ signal });
    if (Array.isArray(spot) && spot.length) return spot;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
  }
  const fallbackCodes = [...new Set([
    ...(watchList || []),
    ...((limitUpItems || []).map((it) => it && it.code).filter(Boolean))
  ])].filter((code) => /^(sh|sz|bj)\d{6}$/i.test(code));
  if (!fallbackCodes.length) return [];
  return fetchQuotes(fallbackCodes, { signal });
}

export async function scanMomentumCandidate(candidate, { signal, limitUpItems = [] } = {}) {
  if (!candidate || !/^(sh|sz|bj)\d{6}$/i.test(candidate.code)) return null;
  const data = await fetchKline(candidate.code, { period: '1d', signal, sharedCache: true });
  const stats = computeTenDayMomentum(data);
  if (!stats || stats.gainPercent < MOMENTUM_THRESHOLD_PCT) return null;
  const limitUpItem = (limitUpItems || []).find((it) => it && it.code === candidate.code);
  const reason = candidate.reason || (limitUpItem && (limitUpItem.reason || limitUpItem.limitStats)) || '';
  const interpretation = candidate.interpretation || (limitUpItem && limitUpItem.interpretation) || '';
  return {
    code: candidate.code,
    name: candidate.name || (data && data.name) || candidate.code,
    price: Number(candidate.price) || stats.lastClose,
    changePercent: Number(candidate.changePercent) || 0,
    amount: Number(candidate.amount) || 0,
    volumeRatio: Number(candidate.volumeRatio) || 0,
    industry: candidate.industry || (limitUpItem && limitUpItem.industry) || '',
    reason,
    interpretation,
    limitStats: candidate.limitStats || (limitUpItem && limitUpItem.limitStats) || '',
    anomaly: reason ? '' : `10日涨幅超${MOMENTUM_THRESHOLD_PCT}%`,
    ...stats
  };
}

export function mergePinnedMomentumItems(nextItems, pinnedCodes = new Set(), currentItems = []) {
  const pins = pinnedCodes || new Set();
  const byCode = new Map((Array.isArray(nextItems) ? nextItems : []).map((it) => [it.code, it]));
  const oldByCode = new Map((currentItems || []).map((it) => [it.code, it]));
  for (const code of pins) {
    if (byCode.has(code)) continue;
    const old = oldByCode.get(code);
    if (old) byCode.set(code, { ...old, pinnedOnly: true });
  }
  return sortMomentumItems([...byCode.values()], pins);
}
