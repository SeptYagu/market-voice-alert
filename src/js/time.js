const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})(?::(\d{2}))?$/;

function _pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatDateForInput(d = new Date()) {
  const y = d.getFullYear();
  const m = _pad2(d.getMonth() + 1);
  const day = _pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

export function getBeijingClockParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number(pick('hour')),
    minute: Number(pick('minute'))
  };
}

export function getBeijingDate(now = new Date()) {
  const parts = getBeijingClockParts(now);
  if (!parts.year || !parts.month || !parts.day) return formatDateForInput(now);
  return `${parts.year}-${_pad2(parts.month)}-${_pad2(parts.day)}`;
}

export function parseDateInput(date) {
  if (typeof date !== 'string') return null;
  const m = DATE_RE.exec(date.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function shiftCalendarDate(date, deltaDays) {
  const base = parseDateInput(date);
  if (!base) return date;
  base.setDate(base.getDate() + Number(deltaDays || 0));
  return formatDateForInput(base);
}

// Lightweight Charts has no first-class timezone support. Passing these
// "wall-clock UTC" seconds makes a Beijing 09:30 bar render as 09:30 instead
// of being shifted by the user's local timezone.
export function parseBeijingDateTimeToChartSeconds(raw) {
  if (typeof raw !== 'string') return null;
  const m = DATETIME_RE.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] || 0);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function parseTencentMinuteToChartSeconds(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  return parseBeijingDateTimeToChartSeconds(`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`);
}

export function chartSecondsToDate(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  const d = new Date(n * 1000);
  return `${d.getUTCFullYear()}-${_pad2(d.getUTCMonth() + 1)}-${_pad2(d.getUTCDate())}`;
}

export function chartSecondsToTime(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  const d = new Date(n * 1000);
  return `${_pad2(d.getUTCHours())}:${_pad2(d.getUTCMinutes())}`;
}

export function formatChartTime(time, period = '1d') {
  if (typeof time === 'string') return time;
  const date = chartSecondsToDate(time);
  if (!date) return '';
  if (['1m', '5m', '15m', '30m', '60m'].includes(period)) {
    return `${date} ${chartSecondsToTime(time)}`;
  }
  return date;
}

export function chartTimeToDate(time) {
  if (typeof time === 'string') return time.slice(0, 10);
  return chartSecondsToDate(time);
}
