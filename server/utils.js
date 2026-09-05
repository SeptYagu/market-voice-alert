export const DEFAULT_PORT = 3001;
export const CACHE_ROOT = new URL('../data/cache/', import.meta.url);
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 12_000;

export function nowMs() {
  return Date.now();
}

export function beijingDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  return year && month && day ? `${year}${month}${day}` : '';
}

export function normalizeDateKey(raw, fallbackDate = new Date()) {
  if (raw === null || raw === undefined || raw === '') {
    return beijingDateKey(fallbackDate);
  }
  const s = String(raw).trim();
  if (/^\d{8}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '');
  return '';
}

export async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Number(options.timeoutMs))
    : DEFAULT_UPSTREAM_TIMEOUT_MS;
  const upstreamSignal = options.signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals = [timeoutSignal];
  if (upstreamSignal) signals.push(upstreamSignal);
  let signal;
  if (typeof AbortSignal.any === 'function') {
    signal = AbortSignal.any(signals);
  } else if (upstreamSignal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    timeoutSignal.addEventListener('abort', onAbort, { once: true });
    upstreamSignal.addEventListener('abort', onAbort, { once: true });
    signal = controller.signal;
  } else {
    signal = timeoutSignal;
  }

  const { timeoutMs: _timeoutMs, signal: _signal, ...fetchOptions } = options;
  try {
    return await fetch(url, { ...fetchOptions, signal });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || (signal && signal.reason && signal.reason.name === 'TimeoutError'))) {
      const timeoutError = new Error(`Upstream timeout after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw err;
  }
}

export function normalizeCodeParam(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(s)) return s;
  if (/^\d{6}$/.test(s)) {
    const first = s[0];
    if (first === '6' || first === '5') return `sh${s}`;
    if (first === '0' || first === '3' || first === '1') return `sz${s}`;
    if (first === '4' || first === '8' || first === '9') return `bj${s}`;
  }
  return '';
}

export function sanitizeSegment(raw) {
  const s = String(raw || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return '';
  return s;
}

export function jsonResponse(res, status, body) {
  if (!res || res.headersSent || res.destroyed) return;
  try {
    const isHead = Boolean(res.req && res.req.method === 'HEAD');
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    });
    res.end(isHead ? undefined : text);
  } catch {
    // Ignore socket write errors when client disconnects
  }
}

export function okEnvelope({ source, stale = false, generatedAt, ttlMs, data }) {
  return {
    ok: true,
    source,
    stale,
    generatedAt: generatedAt || nowMs(),
    ttlMs,
    data
  };
}

export function errorEnvelope(message, extra = {}) {
  return {
    ok: false,
    error: message || 'Unknown error',
    ...extra
  };
}

export function isFresh(entry, ttlMs, now = nowMs()) {
  if (!entry || !entry.generatedAt || !Number.isFinite(Number(ttlMs))) return false;
  return now - Number(entry.generatedAt) <= Number(ttlMs);
}

export function parsePositiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
