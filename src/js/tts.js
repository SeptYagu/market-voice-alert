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

export function speak(text, userOpts = {}) {
  if (typeof text !== 'string') return;
  const trimmed = text.trim();
  if (!trimmed) return;
  const synth = _synth();
  if (!synth) return;
  const opts = { ...getDefaultVoiceOpts(), ...userOpts };
  const utterance = _createUtterance(trimmed, opts);
  _queue.push(utterance);
  // Drain on each utterance end so queue size mirrors actual pending work.
  if (utterance && typeof utterance === 'object' && 'onend' in utterance) {
    utterance.onend = () => {
      const i = _queue.indexOf(utterance);
      if (i >= 0) _queue.splice(i, 1);
    };
  }
  try {
    synth.speak(utterance);
  } catch {
    /* ignore */
  }
}

export function cancel() {
  const synth = _synth();
  _queue.length = 0;
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

export function formatQuoteSpeech(quote, fields, fieldsOrder) {
  if (!quote || typeof quote !== 'object') return '';
  const price = Number(quote.price);
  if (!Number.isFinite(price)) return '';
  const baseName = quote.name || quote.code;
  if (!baseName) return '';

  const enabled = _normalizeFields(fields);
  const order = _normalizeFieldOrder(fieldsOrder);

  const builders = {
    name: () => baseName,
    price: () => {
      const unit = quote.type === 'future' ? '' : ' 元';
      return `现价 ${price.toFixed(2)}${unit}`;
    },
    percent: () => {
      const pct = Number(quote.changePercent);
      if (!Number.isFinite(pct) || pct === 0) return '持平';
      if (pct > 0) return `涨 ${pct.toFixed(2)}%`;
      return `跌 ${Math.abs(pct).toFixed(2)}%`;
    }
  };

  const parts = [];
  for (const k of order) {
    if (!enabled[k]) continue;
    parts.push(builders[k]());
  }

  if (!parts.length) return '';
  return parts.join('，');
}

export function _internal() {
  return { queue: _queue, adapter: _adapter };
}
