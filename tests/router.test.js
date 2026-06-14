import { createHashRouter, parseHash, navigate } from '../src/js/router.js';

function setHash(h) {
  if (typeof location === 'undefined') return;
  const old = location.hash;
  try { location.hash = h; } catch { /* noop */ }
  if (old !== location.hash) {
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  }
}

QUnit.module('router.parseHash', () => {
  QUnit.test('returns "" for empty hash', (t) => {
    t.equal(parseHash(''), '');
    t.equal(parseHash('#'), '');
  });
  QUnit.test('strips leading #', (t) => {
    t.equal(parseHash('#/'), '/');
    t.equal(parseHash('#/limit-up'), '/limit-up');
  });
  QUnit.test('keeps inner slashes', (t) => {
    t.equal(parseHash('#/foo/bar'), '/foo/bar');
  });
  QUnit.test('handles non-string input', (t) => {
    t.equal(parseHash(null), '');
    t.equal(parseHash(undefined), '');
    t.equal(parseHash(123), '');
  });
});

QUnit.module('router.navigate', (hooks) => {
  let originalHash;
  hooks.beforeEach(() => {
    originalHash = location.hash;
    location.hash = '#/';
  });
  hooks.afterEach(() => {
    location.hash = originalHash;
  });

  QUnit.test('sets location.hash to the path with # prefix', (t) => {
    navigate('/limit-up');
    t.equal(location.hash, '#/limit-up');
  });
  QUnit.test('does not double-prefix when path already starts with /', (t) => {
    navigate('/foo');
    t.equal(location.hash, '#/foo');
  });
});

QUnit.module('router.createHashRouter', (hooks) => {
  let calls;
  let routes;
  let router;
  hooks.beforeEach(() => {
    calls = [];
    routes = {
      '#/': (root) => calls.push(['monitor', root]),
      '#/limit-up': (root) => calls.push(['limit-up', root])
    };
    router = createHashRouter(routes, '#/', 'root-1');
    location.hash = '#/';
  });
  hooks.afterEach(() => {
    if (router && router.stop) router.stop();
  });

  QUnit.test('start() invokes the matching route for the current hash', (t) => {
    location.hash = '#/limit-up';
    router.start();
    t.deepEqual(calls, [['limit-up', 'root-1']]);
  });

  QUnit.test('hashchange event dispatches to the new route', (t) => {
    router.start();
    calls.length = 0;
    setHash('#/limit-up');
    t.deepEqual(calls, [['limit-up', 'root-1']]);
  });

  QUnit.test('back navigation to #/ dispatches monitor route', (t) => {
    router.start();
    setHash('#/limit-up');
    calls.length = 0;
    setHash('#/');
    t.deepEqual(calls, [['monitor', 'root-1']]);
  });

  QUnit.test('unknown hash falls back to default and navigates to it', (t) => {
    router.start();
    calls.length = 0;
    setHash('#/bogus');
    t.equal(location.hash, '#/');
  });

  QUnit.test('stop() removes the hashchange listener', (t) => {
    router.start();
    router.stop();
    calls.length = 0;
    setHash('#/limit-up');
    t.deepEqual(calls, [], 'no dispatch after stop');
  });
});
