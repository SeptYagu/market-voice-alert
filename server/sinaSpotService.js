import { fetchWithTimeout, mapLimit } from './utils.js';
import { isAStockCode } from './marketData.js';

const BASE = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/';
const PAGE_SIZE = 80;

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function parseSinaSpot(row) {
  if (!row || !isAStockCode(row.symbol)) throw new Error('Invalid Sina A-share symbol');
  return {
    code: row.symbol.toLowerCase(), name: String(row.name || row.symbol),
    price: numeric(row.trade), prevClose: numeric(row.settlement),
    open: numeric(row.open), high: numeric(row.high), low: numeric(row.low),
    change: numeric(row.pricechange), changePercent: numeric(row.changepercent),
    // Sina uses shares; the project stock quote contract uses lots of 100 shares.
    volume: Math.max(0, numeric(row.volume)) / 100,
    amount: Math.max(0, numeric(row.amount)),
    updateTime: String(row.ticktime || ''), type: 'stock', source: 'sina-full-market'
  };
}

export async function fetchSinaSpot(signal) {
  const timeout = AbortSignal.timeout(45000);
  const stop = new AbortController();
  const combined = AbortSignal.any([timeout, stop.signal, ...(signal ? [signal] : [])]);
  const request = async (method, params) => {
    const url = new URL(`Market_Center.${method}`, BASE);
    url.search = new URLSearchParams(params).toString();
    const response = await fetchWithTimeout(url, { signal: combined, timeoutMs: 12000,
      headers: { referer: 'https://vip.stock.finance.sina.com.cn/mkt/', 'user-agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`Sina market snapshot HTTP ${response.status}`);
    return response.json();
  };
  const count = async () => {
    const total = Number(await request('getHQNodeStockCount', { node: 'hs_a' }));
    if (!Number.isInteger(total) || total < 1 || total > 20000) throw new Error('Invalid Sina market total');
    return total;
  };
  const expectedCount = await count();
  const pages = Array.from({ length: Math.ceil(expectedCount / PAGE_SIZE) }, (_, i) => i + 1);
  // Stable symbol ordering prevents moving price ranks from duplicating/missing stocks.
  // Abort sibling workers when a page fails; never cache a truncated snapshot as full.
  const workSignal = combined;
  try {
    const batches = await mapLimit(pages, 4, async page => {
      workSignal.throwIfAborted();
      const rows = await request('getHQNodeData', { page: String(page), num: String(PAGE_SIZE),
        sort: 'symbol', asc: '1', node: 'hs_a', symbol: '', _s_r_a: 'page' });
      workSignal.throwIfAborted();
      const expectedSize = Math.min(PAGE_SIZE, expectedCount - (page - 1) * PAGE_SIZE);
      if (!Array.isArray(rows) || rows.length !== expectedSize) throw new Error('Incomplete Sina snapshot page');
      return rows.map(parseSinaSpot);
    });
    const rows = batches.flat();
    if (new Set(rows.map(row => row.code)).size !== expectedCount || await count() !== expectedCount) {
      throw new Error('Sina market universe changed or contains duplicate symbols');
    }
    const items = rows.filter(row => row.price > 0 && (row.open > 0 || row.volume > 0));
    if (!items.length) throw new Error('Empty Sina market snapshot');
    return { items, count: items.length, source: 'sina-full-market', universeComplete: true,
      universeSource: 'sina-paginated-market', universeStats: {
        seedCount: expectedCount, receivedCount: rows.length, eligibleCount: items.length,
        suspendedCount: rows.length - items.length, missingCount: 0, failedBatches: []
      } };
  } finally { stop.abort(); }
}
