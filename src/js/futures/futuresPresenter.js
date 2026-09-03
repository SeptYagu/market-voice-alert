/**
 * 期货行情数据呈现与计算 (Futures Presenter)
 * 核心规则：优先按昨结算价 (previousSettlement) 计算涨跌与涨跌幅
 */

export function calculateFuturesChange(price, prevSettlement, prevClose) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) {
    return { change: null, changePercent: null, baseline: null };
  }
  const base = Number.isFinite(Number(prevSettlement)) && Number(prevSettlement) > 0
    ? Number(prevSettlement)
    : (Number.isFinite(Number(prevClose)) && Number(prevClose) > 0 ? Number(prevClose) : null);

  if (!base) {
    return { change: null, changePercent: null, baseline: null };
  }

  const change = Number((p - base).toFixed(2));
  const changePercent = Number((((p - base) / base) * 100).toFixed(2));
  return { change, changePercent, baseline: base };
}

export function formatFuturesQuote(rawQuote) {
  if (!rawQuote || typeof rawQuote !== 'object') return null;

  const price = Number(rawQuote.price || rawQuote.lastPrice);
  const prevSettlement = Number(rawQuote.previousSettlement || rawQuote.prevSettlement);
  const prevClose = Number(rawQuote.prevClose || rawQuote.previousClose);
  const { change, changePercent, baseline } = calculateFuturesChange(price, prevSettlement, prevClose);
  const code = String(rawQuote.code || rawQuote.symbol || '').toLowerCase();

  return {
    ...rawQuote,
    code,
    type: 'future',
    price: Number.isFinite(price) ? price : null,
    prevSettlement: Number.isFinite(prevSettlement) ? prevSettlement : null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    baseline,
    change: change !== null ? change : (Number(rawQuote.change) || 0),
    changePercent: changePercent !== null ? changePercent : (Number(rawQuote.changePercent) || 0),
    openInterest: Number(rawQuote.openInterest || rawQuote.hold || rawQuote.holding) || 0,
    volume: Number(rawQuote.volume) || 0,
    open: Number(rawQuote.open) || null,
    high: Number(rawQuote.high) || null,
    low: Number(rawQuote.low) || null
  };
}
