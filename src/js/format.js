// 纯格式化与展示辅助工具函数，下沉以消除模块间循环依赖

export const LIMIT_UP_REFRESH_OPTIONS = Object.freeze([
  Object.freeze({ value: 10000, label: '10 秒' }),
  Object.freeze({ value: 30000, label: '30 秒' }),
  Object.freeze({ value: 60000, label: '60 秒' })
]);

export function formatNumber(n, decimals = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
  return Number(n).toFixed(decimals);
}

export function priceDirection(change) {
  if (!Number.isFinite(change)) return 'flat';
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}

export function formatChange(change) {
  if (!Number.isFinite(change)) return '-';
  const sign = change > 0 ? '+' : '';
  return `${sign}${formatNumber(change)}`;
}

export function formatPercent(p) {
  if (!Number.isFinite(p)) return '-';
  const sign = p > 0 ? '+' : '';
  return `${sign}${formatNumber(p)}%`;
}

export function formatAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '-';
  if (v >= 100000000) return `${(v / 100000000).toFixed(2)}亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(2)}万`;
  return v.toFixed(0);
}

export function formatPriceWithPercent(price, pct) {
  const priceText = formatNumber(price);
  const pctNum = Number(pct);
  if (!Number.isFinite(pctNum)) return priceText;
  return `${priceText} (${formatPercent(pctNum)})`;
}

export function stripPrefix(code) {
  if (!code) return '';
  const m = /^(?:sh|sz|bj|nf_?)?(.+)$/i.exec(String(code).trim());
  return m ? m[1] : '';
}

export function makeExportFilename(prefix = 'stocks', now = new Date(), ext = 'txt') {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '_' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  return `${prefix}_${stamp}.${ext}`;
}
