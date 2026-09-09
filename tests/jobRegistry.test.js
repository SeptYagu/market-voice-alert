import { createJobRegistry } from '../server/jobRegistry.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

QUnit.module('Production server job commit protocol', () => {
  QUnit.test('ten-minute replacement rejects old progress/success and serializes in-progress disk writes', async assert => {
    let now = 0;
    const registry = createJobRegistry({ clock: () => now });
    const diskStarted = deferred();
    const diskRelease = deferred();
    const oldContinue = deferred();
    const written = [];
    let old;
    const first = registry.start('day', async job => {
      old = job;
      await job.commit(async () => { diskStarted.resolve(); await diskRelease.promise; written.push('old-started'); });
      await oldContinue.promise;
      await job.commit(async () => written.push('old-progress'));
      await job.commit(async () => written.push('old-success'));
    });
    assert.strictEqual(registry.start('day', () => assert.ok(false)), first, 'single flight');
    await diskStarted.promise;
    now = 600001;
    const second = registry.start('day', async job => {
      await job.commit(async () => written.push('new-progress'));
      await job.commit(async () => written.push('new-success'));
    });
    assert.true(old.signal.aborted);
    diskRelease.resolve();
    await second;
    oldContinue.resolve();
    await first;
    assert.deepEqual(written, ['old-started', 'new-progress', 'new-success']);
    assert.equal(registry.jobs.size, 0);
    assert.equal(registry.pendingWrites(), 0);
  });
  QUnit.test('old finally cannot delete replacement job and failed write does not poison queue', async assert => {
    let now = 0;
    const registry = createJobRegistry({ clock: () => now });
    const release = deferred();
    const replacementRelease = deferred();
    const first = registry.start('key', async job => {
      await job.commit(() => Promise.reject(new Error('disk'))).catch(() => {});
      await release.promise;
    });
    await Promise.resolve();
    now = 600001;
    const next = registry.start('key', async job => {
      await job.commit(async () => assert.ok(true, 'new write executes'));
      await replacementRelease.promise;
    });
    release.resolve();
    await first;
    assert.strictEqual(registry.jobs.get('key').promise, next);
    replacementRelease.resolve();
    await next;
  });
});
