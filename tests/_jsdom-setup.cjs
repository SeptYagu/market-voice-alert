const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
// Direct QUnit invocations receive the same disposable cache isolation as npm test.
if (!process.env.MARKET_VOICE_CACHE_ROOT) {
  const testCache = mkdtempSync(join(tmpdir(), 'market-voice-tests-'));
  process.env.MARKET_VOICE_CACHE_ROOT = testCache;
  process.on('exit', () => {
    if (dirname(resolve(testCache)) === resolve(tmpdir())) rmSync(testCache, { recursive: true, force: true });
  });
}
const QUnit = require('qunit');
QUnit.config.testTimeout = process.env.MARKET_VOICE_TEST_NETWORK === 'integration' ? 120000 : 10000;
if (process.env.MARKET_VOICE_TEST_NETWORK !== 'integration') {
  const RealDate = Date;
  const started = RealDate.now();
  const anchor = RealDate.parse('2026-09-09T02:00:00Z');
  globalThis.Date = class TestDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [anchor + RealDate.now() - started])); }
    static now() { return anchor + RealDate.now() - started; }
  };
  globalThis.fetch = async (url) => {
    const message = `Unexpected network request; provide a fixture: ${String(url)}`;
    if (QUnit.config.current) QUnit.config.current.assert.ok(false, message);
    else QUnit.onUncaughtException(new Error(message));
    throw new Error(message);
  };
}
// QUnit test bootstrap: provide a browser-like global environment for
// router.test.js (and any future DOM-dependent tests).
//
// Usage: configured via `qunit --require tests/_jsdom-setup.cjs` in package.json.
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost/'
});

const win = dom.window;

const expose = (name, value) => {
  try {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false
    });
  } catch {
    globalThis[name] = value;
  }
};

expose('window', win);
expose('localStorage', undefined);
expose('document', win.document);
expose('navigator', win.navigator);
expose('HTMLElement', win.HTMLElement);
expose('Node', win.Node);
expose('Event', win.Event);
expose('CustomEvent', win.CustomEvent);
expose('HashChangeEvent', win.HashChangeEvent);

// Stubs for libraries that depend on browser-only APIs not provided by jsdom.
// lightweight-charts v4 requires these. We no-op them; tests verify method
// dispatch, not rendering output.
const raf = (cb) => { return setTimeout(() => cb(Date.now()), 0); };
const caf = (id) => { clearTimeout(id); };
const roStub = class { observe() {} unobserve() {} disconnect() {} };
const matchMediaStub = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
expose('requestAnimationFrame', raf);
expose('cancelAnimationFrame', caf);
expose('ResizeObserver', roStub);
expose('matchMedia', matchMediaStub);
try { win.requestAnimationFrame = raf; } catch { /* ignore */ }
try { win.cancelAnimationFrame = caf; } catch { /* ignore */ }
try { win.ResizeObserver = roStub; } catch { /* ignore */ }
try { win.matchMedia = matchMediaStub; } catch { /* ignore */ }

// `location` is a getter-only accessor on globalThis; mirror it.
try {
  Object.defineProperty(globalThis, 'location', {
    value: win.location,
    writable: true,
    configurable: true,
    enumerable: true
  });
} catch {
  globalThis.location = win.location;
}
