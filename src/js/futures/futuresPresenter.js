import { parseFutureInput } from './instrument.js';

export function calculateFuturesChange(price, prevSettlement, prevClose, priceTick = null) {
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

  const decimals = priceTick && priceTick < 0.01 ? 3 : 2;
  const change = Number((p - base).toFixed(decimals));
  const changePercent = Number((((p - base) / base) * 100).toFixed(2));
  return { change, changePercent, baseline: base };
}

export function formatFuturesQuote(rawQuote) {
  if (!rawQuote || typeof rawQuote !== 'object') return null;

  const rawCode = String(rawQuote.code || rawQuote.symbol || '').toLowerCase();
  const inst = parseFutureInput(rawCode);
  const code = inst ? inst.symbol.toLowerCase() : rawCode.replace(/^nf_?/, '');
  const price = Number(rawQuote.price ?? rawQuote.lastPrice);
  const prevSettlement = Number(rawQuote.previousSettlement ?? rawQuote.prevSettlement);
  const prevClose = Number(rawQuote.prevClose ?? rawQuote.previousClose);
  const priceTick = inst ? inst.priceTick : (rawQuote.priceTick || null);
  const { change, changePercent, baseline } = calculateFuturesChange(price, prevSettlement, prevClose, priceTick);

  const fallbackName = inst ? inst.name : code.toUpperCase();
  const name = (rawQuote.name && rawQuote.name !== code) ? rawQuote.name : fallbackName;

  return {
    ...rawQuote,
    code,
    name,
    type: 'future',
    price: Number.isFinite(price) ? price : null,
    prevSettlement: Number.isFinite(prevSettlement) ? prevSettlement : null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    baseline,
    change: change !== null ? change : (Number(rawQuote.change) || 0),
    changePercent: changePercent !== null ? changePercent : (Number(rawQuote.changePercent) || 0),
    openInterest: Number(rawQuote.openInterest ?? rawQuote.hold ?? rawQuote.holding) || 0,
    volume: Number(rawQuote.volume) || 0,
    open: Number(rawQuote.open) || null,
    high: Number(rawQuote.high) || null,
    low: Number(rawQuote.low) || null
  };
}
