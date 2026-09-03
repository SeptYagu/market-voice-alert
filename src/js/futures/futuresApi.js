import { parseFutureInput } from './instrument.js';
import { formatFuturesQuote } from './futuresPresenter.js';
import { parseSinaFuture } from '../parser.js';

export async function fetchFuturesQuotes(codes, { signal } = {}) {
  const list = Array.isArray(codes) ? codes : [codes];
  const validCodes = list.map((c) => {
    const inst = parseFutureInput(c);
    return inst ? inst.symbol : null;
  }).filter(Boolean);

  if (!validCodes.length) return [];

  try {
    const url = `/api/cache/futures/quote?ids=${encodeURIComponent(validCodes.join(','))}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      const rawList = Array.isArray(json.data)
        ? json.data
        : (json && json.data && Array.isArray(json.data.data) ? json.data.data : []);
      if (rawList.length) {
        return rawList.map(formatFuturesQuote).filter(Boolean);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // fallback to sina
  }

  // Direct Sina fallback via /api/sina
  try {
    const sinaSymbols = validCodes.map((c) => {
      const inst = parseFutureInput(c);
      return inst ? inst.providerSymbols.sina : `nf_${c.toUpperCase()}`;
    });
    const url = `/api/sina/list=${encodeURIComponent(sinaSymbols.join(','))}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      let text = '';
      try {
        text = new TextDecoder('gbk').decode(buf);
      } catch {
        text = new TextDecoder('utf-8').decode(buf);
      }
      const parsed = parseSinaFuture(text);
      return parsed.map(formatFuturesQuote).filter(Boolean);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // fallback failed
  }

  return [];
}

export async function fetchFuturesIntraday(code, { signal, date, tradingDay } = {}) {
  const inst = parseFutureInput(code);
  if (!inst) return { source: 'invalid', items: [] };

  try {
    const params = new URLSearchParams({ id: inst.symbol });
    if (date) params.set('date', date);
    else if (tradingDay) params.set('tradingDay', tradingDay);
    const url = `/api/cache/futures/intraday?${params.toString()}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      const data = (json && json.data && Array.isArray(json.data.items))
        ? json.data
        : (json && json.data && json.data.data && Array.isArray(json.data.data.items) ? json.data.data : null);
      if (data) {
        return data;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }

  return { source: 'empty', items: [] };
}

export async function fetchFuturesKline(code, period = 'day', { signal } = {}) {
  const inst = parseFutureInput(code);
  if (!inst) return { source: 'invalid', items: [] };

  try {
    const url = `/api/cache/futures/kline?id=${encodeURIComponent(inst.symbol)}&period=${encodeURIComponent(period)}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      const data = (json && json.data && Array.isArray(json.data.items))
        ? json.data
        : (json && json.data && json.data.data && Array.isArray(json.data.data.items) ? json.data.data : null);
      if (data) {
        return data;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }

  return { source: 'empty', items: [] };
}
