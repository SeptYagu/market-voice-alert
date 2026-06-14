import {
  THEMES,
  DEFAULT_THEME,
  isValidTheme,
  nextTheme,
  applyTheme,
  initTheme,
  toggleTheme,
  getCurrentTheme
} from '../src/js/theme.js';
import { setStorageAdapter } from '../src/js/storage.js';

function createMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  };
}

function createMockDoc() {
  const attrs = {};
  return {
    documentElement: {
      setAttribute(k, v) {
        attrs[k] = v;
      },
      getAttribute(k) {
        return attrs[k];
      },
      _attrs: attrs
    }
  };
}

QUnit.module('theme', (hooks) => {
  let doc;
  hooks.beforeEach(() => {
    setStorageAdapter(createMockStorage());
    doc = createMockDoc();
  });
  hooks.afterEach(() => {
    setStorageAdapter(null);
  });

  QUnit.test('THEMES lists warm/light/dark in order', (t) => {
    t.deepEqual([...THEMES], ['warm', 'light', 'dark']);
    t.equal(DEFAULT_THEME, 'warm');
  });

  QUnit.test('isValidTheme accepts only known themes', (t) => {
    t.true(isValidTheme('warm'));
    t.true(isValidTheme('light'));
    t.true(isValidTheme('dark'));
    t.false(isValidTheme('blue'));
    t.false(isValidTheme(''));
    t.false(isValidTheme(null));
    t.false(isValidTheme(undefined));
  });

  QUnit.test('nextTheme cycles warm -> light -> dark -> warm', (t) => {
    t.equal(nextTheme('warm'), 'light');
    t.equal(nextTheme('light'), 'dark');
    t.equal(nextTheme('dark'), 'warm');
    t.equal(nextTheme('unknown'), 'warm');
  });

  QUnit.test('applyTheme sets data-theme attribute and persists', (t) => {
    const result = applyTheme('dark', doc);
    t.equal(result, 'dark');
    t.equal(doc.documentElement._attrs['data-theme'], 'dark');
    t.equal(getCurrentTheme(), 'dark');
  });

  QUnit.test('applyTheme falls back to DEFAULT_THEME for invalid', (t) => {
    const result = applyTheme('invalid', doc);
    t.equal(result, DEFAULT_THEME);
    t.equal(doc.documentElement._attrs['data-theme'], DEFAULT_THEME);
  });

  QUnit.test('initTheme uses saved theme', (t) => {
    applyTheme('dark', doc);
    const result = initTheme(doc);
    t.equal(result, 'dark');
  });

  QUnit.test('initTheme uses default when nothing saved', (t) => {
    const result = initTheme(doc);
    t.equal(result, DEFAULT_THEME);
  });

  QUnit.test('toggleTheme advances current saved theme', (t) => {
    applyTheme('warm', doc);
    t.equal(toggleTheme(doc), 'light');
    t.equal(toggleTheme(doc), 'dark');
    t.equal(toggleTheme(doc), 'warm');
  });

  QUnit.test('works without document (no throw)', (t) => {
    const result = applyTheme('dark', null);
    t.equal(result, 'dark');
    t.equal(getCurrentTheme(), 'dark');
  });
});
