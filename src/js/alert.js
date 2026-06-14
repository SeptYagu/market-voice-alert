let _notif = null;

export function setNotificationAdapter(adapter) {
  _notif = adapter || null;
}

function _notifier() {
  if (_notif) return _notif;
  if (typeof globalThis !== 'undefined' && globalThis.Notification) {
    return globalThis.Notification;
  }
  return null;
}

export function isNotificationSupported() {
  return _notifier() !== null;
}

export async function requestNotificationPermission() {
  const N = _notifier();
  if (!N) return 'unsupported';
  if (N.permission === 'granted') return 'granted';
  if (N.permission === 'denied') return 'denied';
  if (typeof N.requestPermission !== 'function') return N.permission || 'default';
  try {
    const p = await N.requestPermission();
    return p || 'default';
  } catch {
    return 'denied';
  }
}

export function showNotification(title, body) {
  const N = _notifier();
  if (!N) return null;
  if (N.permission !== 'granted') return null;
  try {
    return new N(title, { body });
  } catch {
    return null;
  }
}

export function shouldTriggerAlert(quote, threshold, lastState) {
  const safeState = lastState && typeof lastState === 'object'
    ? { direction: lastState.direction || null }
    : { direction: null };

  const thr = Number(threshold);
  if (!Number.isFinite(thr) || thr <= 0) {
    return { trigger: false, direction: null, state: safeState };
  }

  const pct = quote && Number.isFinite(Number(quote.changePercent))
    ? Number(quote.changePercent)
    : null;
  if (pct === null) {
    return { trigger: false, direction: null, state: safeState };
  }

  let currentDir = null;
  if (pct >= thr) currentDir = 'up';
  else if (pct <= -thr) currentDir = 'down';

  if (currentDir === null) {
    // Below threshold: reset any previous trigger memory.
    return { trigger: false, direction: null, state: { direction: null } };
  }

  if (safeState.direction === currentDir) {
    // Same direction de-dup: already triggered, hold state.
    return { trigger: false, direction: null, state: { direction: currentDir } };
  }

  // Threshold crossed (idle->up/down OR up<->down flip).
  return { trigger: true, direction: currentDir, state: { direction: currentDir } };
}

export function formatAlertMessage(quote, direction) {
  if (!quote || typeof quote !== 'object') return '';
  const price = Number(quote.price);
  const pct = Number(quote.changePercent);
  if (!Number.isFinite(price) || !Number.isFinite(pct)) return '';
  const name = quote.name || quote.code;
  if (!name) return '';
  const label = direction === 'down' ? '跌幅' : '涨幅';
  const unit = quote.type === 'future' ? '' : ' 元';
  return `${name} ${label} ${Math.abs(pct).toFixed(2)}%，现价 ${price.toFixed(2)}${unit}`;
}

export function evaluateAlerts(quotes, subscribedCodes, threshold, statesIn) {
  const states = {};
  // Copy input first to keep prior states for non-subscribed codes intact while
  // never mutating the caller's object.
  if (statesIn && typeof statesIn === 'object') {
    for (const k of Object.keys(statesIn)) {
      const v = statesIn[k];
      states[k] = v && typeof v === 'object' ? { direction: v.direction || null } : { direction: null };
    }
  }
  const triggered = [];
  const codes = Array.isArray(subscribedCodes) ? subscribedCodes : [];
  for (const code of codes) {
    const quote = quotes && typeof quotes.get === 'function' ? quotes.get(code) : null;
    if (!quote) continue;
    const prev = states[code] || { direction: null };
    const r = shouldTriggerAlert(quote, threshold, prev);
    states[code] = r.state;
    if (r.trigger) {
      triggered.push({
        code,
        quote,
        direction: r.direction,
        message: formatAlertMessage(quote, r.direction)
      });
    }
  }
  return { triggered, states };
}

export function _internal() {
  return { notificationAdapter: _notif };
}
