const VALID_PREFIXES = new Set(['sh', 'sz', 'bj']);

export function normalizeCode(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;

  const prefixMatch = raw.match(/^(sh|sz|bj)(\d{6})$/);
  if (prefixMatch) return prefixMatch[1] + prefixMatch[2];

  if (!/^\d{6}$/.test(raw)) return null;
  const first = raw[0];
  if (first === '6' || first === '5') return 'sh' + raw;
  if (first === '0' || first === '3') return 'sz' + raw;
  if (first === '4' || first === '8' || first === '9') return 'bj' + raw;
  return null;
}

export function inferMarket(code) {
  if (!code || typeof code !== 'string') return null;
  const m = code.match(/^(sh|sz|bj)\d{6}$/);
  if (!m) return null;
  return VALID_PREFIXES.has(m[1]) ? m[1] : null;
}

export function toEastmoneySecId(code) {
  const m = inferMarket(code);
  if (!m) return null;
  const num = code.slice(2);
  const marketId = m === 'sh' ? '1' : '0';
  return `${marketId}.${num}`;
}

const TENCENT_LINE_RE = /v_([a-z]{2}\d{6})="([^"]*)"/gi;

export function parseTencent(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  let match;
  TENCENT_LINE_RE.lastIndex = 0;
  while ((match = TENCENT_LINE_RE.exec(text)) !== null) {
    const code = match[1].toLowerCase();
    const payload = match[2];
    if (!payload) continue;
    const fields = payload.split('~');
    if (fields.length < 35) continue;
    const price = parseFloat(fields[3]);
    if (!Number.isFinite(price)) continue;
    const amountParts = String(fields[35] || '').split('/');
    const amountFromCompound = parseFloat(amountParts[2]);
    const prevClose = parseFloat(fields[4]) || 0;
    const open = parseFloat(fields[5]) || 0;
    const change = parseFloat(fields[31]) || 0;
    const changePercent = parseFloat(fields[32]) || 0;
    const openChangePercent = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
    const updateTime = /^\d{14}$/.test(String(fields[30] || '')) ? String(fields[30]) : '';
    out.push({
      code,
      name: fields[1] || code,
      price,
      prevClose,
      open,
      volume: parseInt(fields[6], 10) || 0,
      amount: Number.isFinite(amountFromCompound) ? amountFromCompound : 0,
      volumeRatio: parseFloat(fields[78]) || 0,
      openChangePercent: Number(openChangePercent.toFixed(2)),
      change,
      changePercent,
      high: parseFloat(fields[33]) || 0,
      low: parseFloat(fields[34]) || 0,
      updateTime,
      quoteDate: updateTime ? updateTime.slice(0, 8) : '',
      marketStatus: String(fields[40] || '').trim().toUpperCase(),
      type: 'stock',
      source: 'tencent'
    });
  }
  return out;
}

function div100(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v / 100 : 0;
}

export function parseEastmoney(json) {
  if (!json || typeof json !== 'object') return null;
  const d = json.data;
  if (!d || typeof d !== 'object') return null;
  if (d.f43 === undefined || d.f43 === null) return null;
  if (!d.f57) return null;

  const price = div100(d.f43);
  const prevClose = div100(d.f60);
  const change = d.f169 !== undefined && d.f169 !== null && d.f169 !== '-'
    ? div100(d.f169)
    : (price - prevClose);
  const changePercent = d.f170 !== undefined && d.f170 !== null && d.f170 !== '-'
    ? div100(d.f170)
    : (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);

  const code = normalizeCode(String(d.f57)) || String(d.f57);

  return {
    code,
    name: d.f58 || code,
    price,
    prevClose,
    open: div100(d.f46),
    high: div100(d.f44),
    low: div100(d.f45),
      volume: Number(d.f47) || 0,
      amount: Number(d.f48) || 0,
      volumeRatio: div100(d.f50),
      openChangePercent: prevClose > 0 ? Number((((div100(d.f46) - prevClose) / prevClose) * 100).toFixed(2)) : 0,
      change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    type: 'stock',
    source: 'eastmoney'
  };
}

const SINA_FUTURE_RE = /var\s+hq_str_(nf[a-z0-9]+)="([^"]*)"/gi;

export function parseSinaFuture(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  let match;
  SINA_FUTURE_RE.lastIndex = 0;
  while ((match = SINA_FUTURE_RE.exec(text)) !== null) {
    const code = match[1].toLowerCase();
    const payload = match[2];
    if (!payload) continue;
    const f = payload.split(',');
    if (f.length < 10) continue;

    const open = parseFloat(f[2]) || 0;
    const high = parseFloat(f[3]) || 0;
    const low = parseFloat(f[4]) || 0;
    const prevClose = parseFloat(f[5]) || 0;
    const price = parseFloat(f[8]) || parseFloat(f[6]) || 0;
    if (!Number.isFinite(price) || price === 0) continue;

    const change = price - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

    out.push({
      code,
      name: f[0] || code,
      price,
      prevClose,
      open,
      high,
      low,
      volume: parseInt(f[14], 10) || 0,
      amount: 0,
      volumeRatio: 0,
      openChangePercent: prevClose > 0 ? Number((((open - prevClose) / prevClose) * 100).toFixed(2)) : 0,
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      type: 'future',
      source: 'sina'
    });
  }
  return out;
}
