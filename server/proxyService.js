import { fetchWithTimeout } from './utils.js';
import { resolveProxyTarget } from './proxyRoutes.js';

const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

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
  req.on('aborted', () => abort.abort());
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
  const body = req.method === 'HEAD' ? null : Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, headers);
  res.end(body);
  return true;
}
