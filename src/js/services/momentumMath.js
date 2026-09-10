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

  let maxHigh = -Infinity;
  let minLow = Infinity;
  let maxHighTime = null;

  for (let i = items.length - lookback; i < items.length; i++) {
    const bar = items[i];
    if (!bar) continue;
    const barHigh = Number.isFinite(Number(bar.high)) ? Number(bar.high) : Number(bar.close);
    const barLow = Number.isFinite(Number(bar.low)) && Number(bar.low) > 0 ? Number(bar.low) : Number(bar.close);
    if (Number.isFinite(barHigh) && barHigh > maxHigh) {
      maxHigh = barHigh;
      maxHighTime = bar.time;
    }
    if (Number.isFinite(barLow) && barLow < minLow) {
      minLow = barLow;
    }
  }

  if (!Number.isFinite(maxHigh) || maxHigh <= 0) {
    maxHigh = Math.max(lastClose, startClose);
    maxHighTime = end.time;
  }
  if (!Number.isFinite(minLow) || minLow <= 0) {
    minLow = Math.min(startClose, lastClose);
  }

  const maxGainPercent = Number(((maxHigh / startClose - 1) * 100).toFixed(2));
  const pullbackPercent = Number(((lastClose / maxHigh - 1) * 100).toFixed(2));
  const amplitudePercent = Number((((maxHigh - minLow) / startClose) * 100).toFixed(2));

  return {
    lookbackDays: lookback,
    startTime: start.time,
    endTime: end.time,
    startDate: chartTimeToDate(start.time),
    endDate: chartTimeToDate(end.time),
    endDateKey: klineDateKey(end.time),
    startClose,
    lastClose,
    gainPercent,
    maxHigh,
    minLow,
    maxHighTime,
    maxHighDate: chartTimeToDate(maxHighTime),
    maxGainPercent,
    pullbackPercent,
    amplitudePercent
  };
}

export function isMomentumEligible(stats, threshold = MOMENTUM_THRESHOLD_PCT) {
  if (!stats) return false;
  const targetThreshold = Number.isFinite(Number(threshold)) ? Number(threshold) : MOMENTUM_THRESHOLD_PCT;
  const maxGain = Number(stats.maxGainPercent ?? stats.gainPercent);
  const currentGain = Number(stats.gainPercent);
  return Number.isFinite(maxGain) && maxGain >= targetThreshold && Number.isFinite(currentGain) && currentGain > 0;
}

export function sortMomentumItems(items, pinnedCodes = new Set()) {
  const pins = pinnedCodes || new Set();
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const ap = pins.has(a.code) ? 1 : 0;
    const bp = pins.has(b.code) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const aMax = Number(a.maxGainPercent ?? a.gainPercent) || 0;
    const bMax = Number(b.maxGainPercent ?? b.gainPercent) || 0;
    if (aMax !== bMax) return bMax - aMax;
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
  if (item.reason) return item.reason;
  if (item.limitStats) return item.limitStats;
  if (item.anomaly) return item.anomaly;
  if (Number.isFinite(item.maxGainPercent)) {
    const pullback = Number(item.pullbackPercent) || 0;
    if (pullback < -0.1) {
      return `10日触及${formatPercent(item.maxGainPercent)}(回踩${formatPercent(pullback)})`;
    }
    return `10日冲高${formatPercent(item.maxGainPercent)}`;
  }
  return `10日涨幅${formatPercent(item.gainPercent)}`;
}
