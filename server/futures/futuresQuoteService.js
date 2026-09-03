import { parseFutureInput } from './contractCatalog.js';
import { getFuturesSession } from './futuresSessionService.js';
import { getOrRefresh } from '../cacheStore.js';
import { parseSinaFuture } from '../../src/js/parser.js';

const LIVE_TTL_MS = 3 * 1000;
const CLOSED_TTL_MS = 30 * 1000;

async function fetchFromSina(inst) {
  const sinaCode = inst.providerSymbols.sina;
  const url = `https://hq.sinajs.cn/list=${sinaCode}`;
  const res = await fetch(url, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) throw new Error(`Sina HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  let text = '';
  try {
    text = new TextDecoder('gbk').decode(buf);
  } catch {
    text = new TextDecoder('utf-8').decode(buf);
  }
  const quotes = parseSinaFuture(text);
  if (!quotes || !quotes.length) {
    throw new Error(`Sina returned no quote for ${sinaCode}`);
  }
  const q = quotes[0];
  if (!q.price || q.price <= 0) {
    throw new Error(`Sina returned zero or invalid price for ${sinaCode}`);
  }
  return {
    ...q,
    source: 'sina-direct'
  };
}

async function fetchFromAktools(inst) {
  // AKTools futures_zh_spot: CFFEX requires market=FF, commodity requires market=CF
  const market = inst.exchange === 'cffex' ? 'FF' : 'CF';
  const url = `http://127.0.0.1:8888/api/public/futures_zh_spot?symbol=${encodeURIComponent(inst.symbol)}&market=${market}&adjust=0`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`AKTools HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    throw new Error(`AKTools empty spot for ${inst.symbol}`);
  }
  const item = data[0];
  const price = Number(item.current_price ?? item.price ?? item['最新价']) || 0;
  if (price <= 0) {
    throw new Error(`AKTools returned zero price for ${inst.symbol}`);
  }
  const prevSettlement = Number(item.last_settle_price ?? item.settle ?? item['昨结']) || 0;
  const prevClose = Number(item.last_close ?? item['昨收']) || 0;
  const open = Number(item.open ?? item.open_price ?? item['今开']) || 0;
  const high = Number(item.high ?? item.high_price ?? item['最高']) || 0;
  const low = Number(item.low ?? item.low_price ?? item['最低']) || 0;
  const volume = Number(item.volume ?? item['成交量']) || 0;
  const openInterest = Number(item.hold ?? item.position ?? item['持仓量']) || 0;
  const bidPrice = Number(item.bid_price ?? item['买价']) || 0;
  const askPrice = Number(item.ask_price ?? item['卖价']) || 0;
  const bidVol = Number(item.buy_vol ?? item['买量']) || 0;
  const askVol = Number(item.sell_vol ?? item['卖量']) || 0;

  const basePrice = prevSettlement > 0 ? prevSettlement : (prevClose > 0 ? prevClose : price);
  const change = price - basePrice;
  const changePercent = basePrice > 0 ? ((change / basePrice) * 100) : 0;
  const openChangePercent = open > 0 && basePrice > 0 ? (((open - basePrice) / basePrice) * 100) : 0;

  return {
    code: inst.symbol.toLowerCase(),
    name: inst.name || item.symbol || inst.symbol,
    price,
    prevClose: prevClose > 0 ? prevClose : null,
    prevSettlement: prevSettlement > 0 ? prevSettlement : null,
    open: open > 0 ? open : null,
    high: high > 0 ? high : null,
    low: low > 0 ? low : null,
    volume,
    openInterest,
    bidPrice: bidPrice > 0 ? bidPrice : null,
    askPrice: askPrice > 0 ? askPrice : null,
    bidVol: bidVol > 0 ? bidVol : null,
    askVol: askVol > 0 ? askVol : null,
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    openChangePercent: Number(openChangePercent.toFixed(2)),
    type: 'future',
    source: `aktools-futures_zh_spot(${market})`
  };
}

export async function fetchFuturesQuoteRaw(inst) {
  try {
    return await fetchFromAktools(inst);
  } catch (_e) {
    return await fetchFromSina(inst);
  }
}

export async function getCachedFuturesQuote(symbolOrId, opts = {}) {
  const inst = typeof symbolOrId === 'object' && symbolOrId !== null
    ? symbolOrId
    : parseFutureInput(symbolOrId);

  if (!inst) return null;

  const session = getFuturesSession(inst);
  const ttlMs = session.isTrading ? LIVE_TTL_MS : CLOSED_TTL_MS;
  const cacheKey = ['futures', 'quote', `${inst.symbol}.json`];

  const result = await getOrRefresh(
    cacheKey,
    ttlMs,
    async () => {
      const raw = await fetchFuturesQuoteRaw(inst);
      if (!raw || !raw.price || raw.price <= 0) {
        throw new Error(`Invalid futures quote for ${inst.symbol}`);
      }
      return {
        code: inst.symbol.toLowerCase(),
        instrumentId: inst.id,
        type: 'future',
        exchange: inst.exchange,
        product: inst.product,
        symbol: inst.symbol,
        name: raw.name || inst.name,
        contractKind: inst.contractKind,
        tradingDay: session.tradingDay,
        timestamp: Date.now(),
        price: raw.price,
        prevSettlement: raw.prevSettlement,
        prevClose: raw.prevClose,
        open: raw.open,
        high: raw.high,
        low: raw.low,
        volume: raw.volume,
        openInterest: raw.openInterest,
        bidPrice: raw.bidPrice || null,
        askPrice: raw.askPrice || null,
        bidVol: raw.bidVol || null,
        askVol: raw.askVol || null,
        change: raw.change,
        changePercent: raw.changePercent,
        openChangePercent: raw.openChangePercent || 0,
        source: raw.source,
        fetchedAt: Date.now()
      };
    },
    opts
  );

  return result ? result.data : null;
}

export async function getCachedFuturesQuotes(symbolsOrIds, opts = {}) {
  const list = Array.isArray(symbolsOrIds) ? symbolsOrIds : [symbolsOrIds];
  if (!list.length) return [];

  // Limit concurrency to 5 requests per batch
  const results = [];
  const chunkSize = 5;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map((s) => getCachedFuturesQuote(s, opts).catch(() => null))
    );
    results.push(...chunkResults.filter(Boolean));
  }
  return results;
}
