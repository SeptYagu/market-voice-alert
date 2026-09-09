/* Early, dependency-free reporting survives application boot failures. */
(() => {
  const send = window.fetch.bind(window);
  let count = 0;
  let since = Date.now();
  function report(event) {
    if (Date.now() - since > 60000) { count = 0; since = Date.now(); }
    if (++count > 20) return;
    event.version = document.querySelector('.app-version')?.textContent.match(/Version:\s*([a-f0-9]{7,40})\b/)?.[1] || 'unknown';
    // Never send error messages, stack text, request bodies or user identifiers.
    void send('/api/cache/diagnostics', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event), keepalive: true
    }).catch(() => {});
  }
  addEventListener('error', event => report({
    kind: event.target === window ? 'runtime' : 'resource',
    location: 'application', line: event.lineno || 0,
    errorName: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(event.error?.name) ? event.error.name : ''
  }), true);
  addEventListener('unhandledrejection', event => report({ kind: 'rejection', errorName: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(event.reason?.name) ? event.reason.name : '' }));
  for (const method of ['error', 'warn']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      report({ kind: 'console', level: method === 'warn' ? 'warning' : 'error' });
      original(...args);
    };
  }
  window.fetch = async (...args) => {
    let path = '';
    try {
      const url = new URL(args[0] instanceof Request ? args[0].url : args[0], location.href);
      // Report known API paths only; strip query values before transmission.
      if (url.origin === location.origin && url.pathname.startsWith('/api/') && url.pathname !== '/api/cache/diagnostics') path = url.pathname;
    } catch { /* native fetch handles invalid URLs */ }
    try {
      const response = await send(...args);
      if (path && !response.ok) report({ kind: 'http', location: path, status: response.status });
      return response;
    } catch (error) {
      if (path && error.name !== 'AbortError') report({ kind: 'network', location: path });
      throw error;
    }
  };
})();
