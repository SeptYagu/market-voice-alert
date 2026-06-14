import { getTheme, setTheme } from './storage.js';

export const THEMES = Object.freeze(['warm', 'light', 'dark']);
export const DEFAULT_THEME = 'warm';

export const THEME_LABELS = Object.freeze({
  warm: '暖米',
  light: '浅色',
  dark: '深色'
});

export const THEME_ICONS = Object.freeze({
  warm: '🟡',
  light: '☀️',
  dark: '🌙'
});

export function isValidTheme(theme) {
  return typeof theme === 'string' && THEMES.includes(theme);
}

export function nextTheme(current) {
  const idx = THEMES.indexOf(current);
  if (idx < 0) return THEMES[0];
  return THEMES[(idx + 1) % THEMES.length];
}

export function applyTheme(theme, doc = (typeof document !== 'undefined' ? document : null)) {
  const t = isValidTheme(theme) ? theme : DEFAULT_THEME;
  if (doc && doc.documentElement) {
    doc.documentElement.setAttribute('data-theme', t);
  }
  setTheme(t);
  return t;
}

export function initTheme(doc = (typeof document !== 'undefined' ? document : null)) {
  const saved = getTheme();
  return applyTheme(isValidTheme(saved) ? saved : DEFAULT_THEME, doc);
}

export function toggleTheme(doc = (typeof document !== 'undefined' ? document : null)) {
  const current = getTheme() || DEFAULT_THEME;
  const next = nextTheme(current);
  return applyTheme(next, doc);
}

export function getCurrentTheme() {
  return getTheme() || DEFAULT_THEME;
}
