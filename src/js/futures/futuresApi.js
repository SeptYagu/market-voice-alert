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
    const url = `/api/cache/futures/quote?ids=${validCodes.join(',')}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data && Array.isArray(json.data.data)) {
        return json.data.data.map(formatFuturesQuote);
      }
    }
  } catch (_e) {
    // fallback to sina
  }

  // Direct Sina fallback via /api/sina
  try {
    const sinaSymbols = validCodes.map((c) => {
      const inst = parseFutureInput(c);
      return inst ? inst.providerSymbols.sina : `nf_${c}`;
    });
    const url = `/api/sina/list=${sinaSymbols.join(',')}`;
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
      return parsed.map(formatFuturesQuote);
    }
  } catch (_e) {
    // fallback failed
  }

  return [];
}

export async function fetchFuturesIntraday(code, { signal } = {}) {
  const inst = parseFutureInput(code);
  if (!inst) return { source: 'invalid', items: [] };

  try {
    const url = `/api/cache/futures/intraday?id=${inst.symbol}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data && json.data.data) {
        return json.data.data;
      }
    }
  } catch (_e) {
    // empty fallback
  }

  return { source: 'empty', items: [] };
}

export async function fetchFuturesKline(code, period = 'day', { signal } = {}) {
  const inst = parseFutureInput(code);
  if (!inst) return { source: 'invalid', items: [] };

  try {
    const url = `/api/cache/futures/kline?id=${inst.symbol}&period=${period}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data && json.data.data) {
        return json.data.data;
      }
    }
  } catch (_e) {
    // empty fallback
  }

  return { source: 'empty', items: [] };
}
