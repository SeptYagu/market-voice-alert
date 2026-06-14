import { createTickEngine, bootWorker } from '../src/js/worker.js';

QUnit.module('worker.createTickEngine', (hooks) => {
  let clock;
  hooks.beforeEach(() => {
    clock = createMockClock();
  });

  QUnit.test('start posts tick at given interval', (t) => {
    const engine = createTickEngine(clock);
    engine.handle({ type: 'start', interval: 1000 });
    t.true(engine.isRunning);
    t.equal(engine.currentInterval, 1000);
    clock.advance(3000);
    t.equal(clock.posted.length, 3);
    t.deepEqual(clock.posted[0], { type: 'tick' });
  });

  QUnit.test('stop clears the interval', (t) => {
    const engine = createTickEngine(clock);
    engine.handle({ type: 'start', interval: 500 });
    clock.advance(1500);
    t.equal(clock.posted.length, 3);
    engine.handle({ type: 'stop' });
    t.false(engine.isRunning);
    clock.advance(5000);
    t.equal(clock.posted.length, 3, 'no ticks after stop');
  });

  QUnit.test('start while already running replaces previous timer', (t) => {
    const engine = createTickEngine(clock);
    engine.handle({ type: 'start', interval: 1000 });
    clock.advance(2000);
    t.equal(clock.posted.length, 2);
    engine.handle({ type: 'start', interval: 500 });
    t.equal(engine.currentInterval, 500);
    clock.advance(1000);
    t.equal(clock.posted.length, 4, '2 new ticks at 500ms interval');
  });

  QUnit.test('setInterval message changes the cadence without losing state', (t) => {
    const engine = createTickEngine(clock);
    engine.handle({ type: 'start', interval: 1000 });
    engine.handle({ type: 'setInterval', interval: 200 });
    t.equal(engine.currentInterval, 200);
    t.true(engine.isRunning);
    clock.advance(1000);
    t.equal(clock.posted.length, 5);
  });

  QUnit.test('ignores unknown message types', (t) => {
    const engine = createTickEngine(clock);
    engine.handle({ type: 'whatever' });
    engine.handle(null);
    engine.handle(undefined);
    engine.handle('string');
    t.false(engine.isRunning);
    t.equal(clock.posted.length, 0);
  });

  QUnit.test('falls back to 1000ms when interval invalid', (t) => {
    const engine = createTickEngine(clock);
    engine.handle({ type: 'start' });
    t.equal(engine.currentInterval, 1000);
    engine.handle({ type: 'start', interval: 'abc' });
    t.equal(engine.currentInterval, 1000);
    engine.handle({ type: 'start', interval: -5 });
    t.equal(engine.currentInterval, 1000);
  });
});

QUnit.module('worker.bootWorker', () => {
  QUnit.test('returns null for invalid scope (no postMessage)', (t) => {
    t.equal(bootWorker(null), null);
    t.equal(bootWorker({}), null);
    t.equal(bootWorker({ postMessage: 'not-fn' }), null);
  });

  QUnit.test('wires scope.onmessage to engine.handle and returns engine', (t) => {
    const clock = createMockClock();
    const scope = {
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      postMessage: clock.postMessage,
      onmessage: null
    };
    const engine = bootWorker(scope);
    t.ok(engine);
    t.equal(typeof scope.onmessage, 'function');
    scope.onmessage({ data: { type: 'start', interval: 100 } });
    t.true(engine.isRunning);
    clock.advance(300);
    t.equal(clock.posted.length, 3);
  });
});

function createMockClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const posted = [];
  return {
    posted,
    setInterval(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms, nextFire: now + ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    postMessage(msg) {
      posted.push(msg);
    },
    advance(deltaMs) {
      const target = now + deltaMs;
      for (;;) {
        let nextTimer = null;
        let nextFire = Infinity;
        for (const t of timers.values()) {
          if (t.nextFire < nextFire) {
            nextFire = t.nextFire;
            nextTimer = t;
          }
        }
        if (!nextTimer || nextFire > target) {
          now = target;
          break;
        }
        now = nextFire;
        nextTimer.nextFire += nextTimer.ms;
        nextTimer.fn();
      }
    }
  };
}
