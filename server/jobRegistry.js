import { randomUUID } from 'node:crypto';

// A key owns both a current job and a write queue. Replacement invalidates the
// old job before aborting, but queued writes remain ordered across generations.
export function createJobRegistry({ clock = Date.now, maxAgeMs = 600000 } = {}) {
  const jobs = new Map();
  const writes = new Map();
  function start(key, execute) {
    const existing = jobs.get(key);
    if (existing && clock() - existing.startedAt <= maxAgeMs) return existing.promise;
    if (existing) {
      jobs.delete(key);
      existing.controller.abort();
    }
    const controller = new AbortController();
    const job = { id: randomUUID(), startedAt: clock(), controller, signal: controller.signal };
    job.isCurrent = () => jobs.get(key) === job && !job.signal.aborted;
    job.commit = operation => {
      const next = (writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        if (!job.isCurrent()) return false;
        await operation();
        return true;
      });
      writes.set(key, next);
      const cleanup = () => { if (writes.get(key) === next) writes.delete(key); };
      next.then(cleanup, cleanup);
      return next;
    };
    jobs.set(key, job);
    job.promise = Promise.resolve().then(() => execute(job)).finally(() => {
      if (jobs.get(key) === job) jobs.delete(key);
    });
    return job.promise;
  }
  return { jobs, start, pendingWrites: () => writes.size };
}
