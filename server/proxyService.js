import { fetchWithTimeout } from './utils.js';
import { resolveProxyTarget } from './proxyRoutes.js';

const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;
const FAST_TIMEOUT_MS = 2500;
const HEALTHY_CACHE_TTL_MS = 60_000;

// Host health cache: routePrefix -> { host: string, expiresAt: number }
const HEALTHY_HOST_CACHE = new Map();

export async function handleProxyRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const target = resolveProxyTarget(requestUrl.pathname, requestUrl.search);
  if (!target) return false;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS',
      'access-control-allow-headers': 'content-type'
    });
    res.end();
    return true;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const abort = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.on('close', onClose);

  try {
    const candidateUrls = target.urls && target.urls.length > 0 ? [...target.urls] : [target.url];
    const cached = HEALTHY_HOST_CACHE.get(target.prefix);
    if (cached && cached.expiresAt > Date.now()) {
      candidateUrls.sort((a, b) => {
        const aMatch = a.includes(cached.host);
        const bMatch = b.includes(cached.host);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
    }

    let upstream = null;
    let lastError = null;

    for (let i = 0; i < candidateUrls.length; i++) {
      if (abort.signal.aborted) break;
      const currentUrl = candidateUrls[i];
      const isLast = i === candidateUrls.length - 1;
      const timeoutMs = isLast ? 15_000 : FAST_TIMEOUT_MS;

      try {
        const response = await fetchWithTimeout(currentUrl, {
          method: req.method,
          headers: target.headers,
          signal: abort.signal,
          timeoutMs,
          redirect: 'follow'
        });
        if (response.status < 500) {
          upstream = response;
          try {
            const host = new URL(currentUrl).host;
            HEALTHY_HOST_CACHE.set(target.prefix, { host, expiresAt: Date.now() + HEALTHY_CACHE_TTL_MS });
          } catch {
            // ignore URL parse errors
          }
          break;
        } else {
          try {
            if (response.body?.cancel) await response.body.cancel();
            else await response.arrayBuffer();
          } catch {
            // ignore drain/cancel errors
          }
          lastError = new Error(`Upstream returned HTTP ${response.status}`);
        }
      } catch (err) {
        if (err && err.name === 'AbortError' && abort.signal.aborted) {
          throw err;
        }
        lastError = err;
      }
    }

    if (!upstream) {
      throw lastError || new Error('All proxy targets failed');
    }

    const headers = {
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff'
    };
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    let body = null;
    if (req.method !== 'HEAD') {
      const cl = Number(upstream.headers.get('content-length'));
      if (Number.isFinite(cl) && cl > MAX_PROXY_BODY_BYTES) {
        throw new Error(`Upstream response exceeded max body size of ${MAX_PROXY_BODY_BYTES} bytes`);
      }
      if (!upstream.body) {
        body = Buffer.alloc(0);
      } else {
        const reader = upstream.body.getReader();
        const chunks = [];
        let total = 0;
        let streamDone = false;
        try {
          while (!streamDone) {
            const chunk = await reader.read();
            if (chunk.done) {
              streamDone = true;
              break;
            }
            total += chunk.value.byteLength;
            if (total > MAX_PROXY_BODY_BYTES) {
              await reader.cancel();
              throw new Error(`Upstream response exceeded max body size of ${MAX_PROXY_BODY_BYTES} bytes`);
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        body = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      }
    }
    if (res.destroyed || res.writableEnded) return true;
    res.writeHead(upstream.status, headers);
    res.end(body);
    return true;
  } finally {
    res.removeListener('close', onClose);
  }
}
