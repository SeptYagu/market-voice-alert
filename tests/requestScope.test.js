import { createRequestScope } from '../src/js/services/requestScope.js';

QUnit.module('requestScope', () => {
  QUnit.test('resolved continuation cannot commit after replacement', async assert => {
    const scope = createRequestScope();
    const first = scope.begin();
    let committed = false;
    const continuation = Promise.resolve().then(() => { if (scope.isCurrent(first)) committed = true; });
    const second = scope.begin();
    await continuation;
    assert.false(committed);
    assert.true(first.signal.aborted);
    assert.true(scope.isCurrent(second));
    scope.cancel();
  });
  QUnit.test('cancel invalidates before synchronous abort callbacks run', assert => {
    const scope = createRequestScope();
    const token = scope.begin();
    token.signal.addEventListener('abort', () => assert.false(scope.isCurrent(token)));
    scope.cancel();
    assert.false(scope.isCurrent(token));
  });
});
