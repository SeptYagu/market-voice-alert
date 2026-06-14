// Tick worker: keeps a precise interval even when the page is backgrounded
// (main-thread setInterval is throttled to >=1s in most browsers).
// Messages:
//   { type: 'start', interval }   - (re)start ticking at `interval` ms
//   { type: 'stop' }              - stop ticking
//   { type: 'setInterval', interval } - change cadence (start if idle)
// Emits: { type: 'tick' }

const DEFAULT_INTERVAL = 1000;

function _coerceInterval(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL;
}

export function createTickEngine(deps) {
  const { setInterval, clearInterval, postMessage } = deps || {};
  if (typeof setInterval !== 'function' || typeof clearInterval !== 'function' || typeof postMessage !== 'function') {
    throw new Error('createTickEngine: deps must provide setInterval/clearInterval/postMessage');
  }

  let timerId = null;
  let currentInterval = 0;

  function _stop() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function _restart(intervalMs) {
    _stop();
    currentInterval = _coerceInterval(intervalMs);
    timerId = setInterval(() => postMessage({ type: 'tick' }), currentInterval);
  }

  return {
    handle(msg) {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'start':
          _restart(msg.interval);
          break;
        case 'stop':
          _stop();
          break;
        case 'setInterval':
          _restart(msg.interval);
          break;
        default:
          /* ignore unknown */
      }
    },
    get isRunning() {
      return timerId !== null;
    },
    get currentInterval() {
      return currentInterval;
    }
  };
}

export function bootWorker(scope) {
  if (!scope || typeof scope.postMessage !== 'function') return null;
  const engine = createTickEngine({
    setInterval: scope.setInterval.bind(scope),
    clearInterval: scope.clearInterval.bind(scope),
    postMessage: scope.postMessage.bind(scope)
  });
  scope.onmessage = (event) => engine.handle(event && event.data);
  return engine;
}

// Auto-boot only when loaded as a real Web Worker (has self.postMessage and no window).
if (
  typeof self !== 'undefined' &&
  typeof self.postMessage === 'function' &&
  typeof window === 'undefined'
) {
  bootWorker(self);
}
