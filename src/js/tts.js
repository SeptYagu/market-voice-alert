let _adapter = null;
const _queue = [];

export function setSpeechAdapter(adapter) {
  _adapter = adapter || null;
}

function _synth() {
  if (_adapter) return _adapter;
  if (typeof globalThis !== 'undefined' && globalThis.speechSynthesis) {
    return globalThis.speechSynthesis;
  }
  return null;
}

export function isSpeechSupported() {
  return _synth() !== null;
}

export function getDefaultVoiceOpts() {
  return { lang: 'zh-CN', rate: 1, pitch: 1, volume: 1 };
}

function _createUtterance(text, opts) {
  // Prefer native SpeechSynthesisUtterance; fall back to plain object (tests / no-DOM env).
  if (typeof globalThis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance === 'function') {
    const u = new globalThis.SpeechSynthesisUtterance(text);
    u.lang = opts.lang;
    u.rate = opts.rate;
    u.pitch = opts.pitch;
    u.volume = opts.volume;
    return u;
  }
  return { text, lang: opts.lang, rate: opts.rate, pitch: opts.pitch, volume: opts.volume };
}

export const MAX_QUEUE_SIZE = 50;

let _currentUtterance = null;
let _safetyTimer = null;

function _pump() {
  if (_currentUtterance !== null) return;
  const synth = _synth();
  if (!synth || !_queue.length) return;

  const item = _queue[0];
  _currentUtterance = item;

  const cleanup = () => {
    if (_safetyTimer) {
      clearTimeout(_safetyTimer);
      _safetyTimer = null;
    }
    if (_currentUtterance === item) {
      _currentUtterance = null;
      const i = _queue.indexOf(item);
      if (i >= 0) _queue.splice(i, 1);
      _pump();
    }
  };

  if (item && typeof item === 'object') {
    item.onend = cleanup;
    item.onerror = cleanup;
  }

  _safetyTimer = setTimeout(cleanup, 10000);

  try {
    synth.speak(item);
  } catch {
    cleanup();
  }
}

export function speak(text, userOpts = {}) {
  if (typeof text !== 'string') return;
  const trimmed = text.trim();
  if (!trimmed) return;
  const synth = _synth();
  if (!synth) return;

  const opts = { ...getDefaultVoiceOpts(), ...userOpts };
  const utterance = _createUtterance(trimmed, opts);
  if (userOpts.code) utterance.code = userOpts.code;

  if (userOpts.code) {
    const existingIndex = _queue.findIndex((u, idx) => idx > 0 && u.code === userOpts.code);
    if (existingIndex > 0) {
      _queue[existingIndex] = utterance;
      return;
    }
  }

  while (_queue.length >= MAX_QUEUE_SIZE) {
    if (_queue.length > 1) {
      _queue.splice(1, 1);
    } else {
      _queue.shift();
    }
  }

  if (userOpts.priority === 'high' && _queue.length > 1) {
    _queue.splice(1, 0, utterance);
  } else {
    _queue.push(utterance);
  }

  _pump();
}

export function cancel() {
  if (_safetyTimer) {
    clearTimeout(_safetyTimer);
    _safetyTimer = null;
  }
  _currentUtterance = null;
  _queue.length = 0;
  const synth = _synth();
  if (!synth) return;
  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
}

const DEFAULT_FIELD_ORDER = Object.freeze(['name', 'price', 'percent']);

function _normalizeFields(fields) {
  const f = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : null;
  if (!f) return { name: true, price: true, percent: true };
  return {
    name: f.name === undefined ? true : !!f.name,
    price: f.price === undefined ? true : !!f.price,
    percent: f.percent === undefined ? true : !!f.percent
  };
}

function _normalizeFieldOrder(order) {
  if (!Array.isArray(order) || !order.length) return [...DEFAULT_FIELD_ORDER];
  const known = ['name', 'price', 'percent'];
  const seen = new Set();
  const out = [];
  for (const k of order) {
    if (known.includes(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  // Fill in any missing known keys at the end.
  for (const k of known) {
    if (!seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  return out;
}

function _buildSegments(quote) {
  // Returns the formatted { name, price, percent } strings, or null when the
  // quote lacks a usable price/name (keeps formatQuoteSpeech semantics).
  const price = Number(quote.price);
  if (!Number.isFinite(price)) return null;
  const baseName = quote.name || quote.code;
  if (!baseName) return null;

  // No 「现价」 prefix and no 「%」 suffix: TTS reads % as 「百分之」.
  const unit = quote.type === 'future' ? '' : ' 元';
  const decimals = quote.type === 'future' && ((quote.priceTick && quote.priceTick < 0.01) || quote.priceDecimals === 3) ? 3 : 2;
  const priceSeg = `${price.toFixed(decimals)}${unit}`;

  const pct = Number(quote.changePercent);
  const percentSeg = !Number.isFinite(pct) || pct === 0
    ? '持平'
    : pct > 0 ? `涨 ${pct.toFixed(2)}` : `跌 ${Math.abs(pct).toFixed(2)}`;

  return { name: baseName, price: priceSeg, percent: percentSeg };
}

export function formatQuoteSpeech(quote, fields, fieldsOrder) {
  if (!quote || typeof quote !== 'object') return '';
  const enabled = _normalizeFields(fields);
  const order = _normalizeFieldOrder(fieldsOrder);
  const segs = _buildSegments(quote);
  if (!segs) return '';

  const parts = [];
  for (const k of order) {
    if (!enabled[k]) continue;
    parts.push(segs[k]);
  }

  if (!parts.length) return '';
  return parts.join('，');
}

// Dedup-aware variant used by the periodic broadcast: only the fields whose
// formatted value changed since the last spoken broadcast are included (the
// name is always kept so listeners can tell which code is being announced).
// `lastSpoken` is the previous { price, percent } map for this code, or null.
// Returns { text, spoken } — text is '' when nothing changed (skip entirely);
// spoken holds only the values actually included in this broadcast.
export function formatQuoteSpeechDelta(quote, lastSpoken, fields, fieldsOrder) {
  if (!quote || typeof quote !== 'object') return { text: '', spoken: null };
  const enabled = _normalizeFields(fields);
  const order = _normalizeFieldOrder(fieldsOrder);
  const segs = _buildSegments(quote);
  if (!segs) return { text: '', spoken: null };

  const changedPrice = enabled.price && (!lastSpoken || lastSpoken.price !== segs.price);
  const changedPercent = enabled.percent && (!lastSpoken || lastSpoken.percent !== segs.percent);
  if (!changedPrice && !changedPercent) return { text: '', spoken: null };

  const include = { name: enabled.name, price: changedPrice, percent: changedPercent };
  const parts = [];
  for (const k of order) {
    if (!include[k]) continue;
    parts.push(segs[k]);
  }
  if (!parts.length) return { text: '', spoken: null };

  const spoken = {};
  if (changedPrice) spoken.price = segs.price;
  if (changedPercent) spoken.percent = segs.percent;
  return { text: parts.join('，'), spoken };
}

// Exposes the raw formatted segments so callers (e.g. the manual test
// broadcast) can seed the dedup memory with what was just spoken.
export function buildQuoteSpeechSegments(quote) {
  if (!quote || typeof quote !== 'object') return null;
  return _buildSegments(quote);
}

export function _internal() {
  return { queue: _queue, adapter: _adapter };
}
