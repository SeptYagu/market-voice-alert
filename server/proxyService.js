import { fetchWithTimeout } from './utils.js';
import { resolveProxyTarget } from './proxyRoutes.js';

const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

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
    const upstream = await fetchWithTimeout(target.url, {
      method: req.method,
      headers: target.headers,
      signal: abort.signal,
      timeoutMs: 15_000,
      redirect: 'follow'
    });
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
      const ab = await upstream.arrayBuffer();
      if (ab.byteLength > MAX_PROXY_BODY_BYTES) {
        throw new Error(`Upstream response exceeded max body size of ${MAX_PROXY_BODY_BYTES} bytes`);
      }
      body = Buffer.from(ab);
    }
    if (res.destroyed || res.writableEnded) return true;
    res.writeHead(upstream.status, headers);
    res.end(body);
    return true;
  } finally {
    res.removeListener('close', onClose);
  }
}
