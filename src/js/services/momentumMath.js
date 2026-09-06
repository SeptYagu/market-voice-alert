// 10 日强势股数学与领域算法（前后端统一）
import { formatPercent } from '../format.js';
import { chartTimeToDate } from '../time.js';

export const MOMENTUM_LOOKBACK_TRADING_DAYS = 10;
export const MOMENTUM_THRESHOLD_PCT = 45;

export function klineDateKey(timeVal) {
  if (!timeVal) return '';
  if (typeof timeVal === 'string') {
    const compact = timeVal.replace(/[-/ :]/g, '').slice(0, 8);
    if (/^\d{8}$/.test(compact)) return compact;
  }
  if (typeof timeVal === 'number') {
    const dateStr = chartTimeToDate(timeVal);
    return dateStr ? dateStr.replace(/-/g, '') : '';
  }
  return '';
}

export function normalizeDateKey(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{8}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '');
  return '';
}

export function computeTenDayMomentum(
  klineData,
  lookbackDays = MOMENTUM_LOOKBACK_TRADING_DAYS,
  cutoffDate = ''
) {
  const cutoffKey = normalizeDateKey(cutoffDate);
  const sourceItems = klineData && Array.isArray(klineData.items) ? klineData.items : [];
  const items = cutoffKey
    ? sourceItems.filter((item) => {
      const itemDate = klineDateKey(item && item.time);
      return itemDate && itemDate <= cutoffKey;
    })
    : sourceItems;

  const lookback = Math.max(1, Number(lookbackDays) || MOMENTUM_LOOKBACK_TRADING_DAYS);
  if (items.length < lookback + 1) return null;

  const end = items[items.length - 1];
  const start = items[items.length - 1 - lookback];
  const startClose = Number(start && start.close);
  const lastClose = Number(end && end.close);

  if (!Number.isFinite(startClose) || !Number.isFinite(lastClose) || startClose <= 0 || lastClose <= 0) {
    return null;
  }

  const gainPercent = Number(((lastClose / startClose - 1) * 100).toFixed(2));
  return {
    lookbackDays: lookback,
    startTime: start.time,
    endTime: end.time,
    startDate: chartTimeToDate(start.time),
    endDate: chartTimeToDate(end.time),
    endDateKey: klineDateKey(end.time),
    startClose,
    lastClose,
    gainPercent
  };
}

export function sortMomentumItems(items, pinnedCodes = new Set()) {
  const pins = pinnedCodes || new Set();
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const ap = pins.has(a.code) ? 1 : 0;
    const bp = pins.has(b.code) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ag = Number(a.gainPercent) || 0;
    const bg = Number(b.gainPercent) || 0;
    if (ag !== bg) return bg - ag;
    const aa = Number(a.amount) || 0;
    const ba = Number(b.amount) || 0;
    if (aa !== ba) return ba - aa;
    return String(a.code || '').localeCompare(String(b.code || ''));
  });
}

export function getMomentumReasonText(item) {
  if (!item) return '-';
  return item.reason || item.limitStats || item.anomaly || `10日涨幅${formatPercent(item.gainPercent)}`;
}
