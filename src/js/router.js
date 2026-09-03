export function parseHash(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') return '';
  const s = raw;
  if (s === '' || s === '#') return '';
  return s.startsWith('#') ? s.slice(1) : s;
}

export function navigate(path) {
  if (typeof location === 'undefined') return;
  const p = String(path || '');
  const target = p.startsWith('#') ? p : '#' + (p.startsWith('/') ? p : '/' + p);
  if (location.hash !== target) {
    location.hash = target;
  }
}

export function createHashRouter(routes, defaultPath, rootArg) {
  const defaultHash = defaultPath && defaultPath.startsWith('#') ? defaultPath : '#' + defaultPath;
  let handlerRef = null;

  function dispatch() {
    if (typeof location === 'undefined') return;
    const current = location.hash || defaultHash;
    const path = current.split('?')[0];
    const handler = Object.prototype.hasOwnProperty.call(routes, path)
      ? routes[path]
      : null;
    if (handler) {
      try {
        handler(rootArg);
      } catch (e) {
        if (typeof console !== 'undefined' && console.error) console.error('router handler error:', e);
      }
      return;
    }
    if (path !== defaultHash) {
      navigate(defaultHash);
    }
  }

  function start() {
    if (typeof window === 'undefined' || handlerRef) return;
    handlerRef = () => dispatch();
    window.addEventListener('hashchange', handlerRef);
    if (!location.hash) {
      navigate(defaultHash);
    } else {
      dispatch();
    }
  }

  function stop() {
    if (typeof window === 'undefined' || !handlerRef) return;
    window.removeEventListener('hashchange', handlerRef);
    handlerRef = null;
  }

  return { start, stop, dispatch };
}
