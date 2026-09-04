import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_ROOT, isFresh, nowMs, sanitizeSegment } from './utils.js';

const rootPath = fileURLToPath(CACHE_ROOT);
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;
const inflightRefreshes = new Map();

async function renameWithRetry(source, target) {
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY']);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!retryable.has(error && error.code) || attempt >= 6) throw error;
      // Windows can briefly lock the destination while a poll request or
      // antivirus scanner is reading it. Preserve atomic replacement and retry.
      await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
    }
  }
}

function resolveCachePath(parts) {
  const clean = [];
  for (const part of parts) {
    const s = sanitizeSegment(part);
    if (!s) throw new Error(`Invalid cache path segment: ${part}`);
    clean.push(s);
  }
  const target = normalize(join(rootPath, ...clean));
  if (!target.startsWith(rootPath)) throw new Error('Cache path escaped cache root');
  return target;
}

export function cachePath(...parts) {
  return resolveCachePath(parts);
}

export async function readCache(parts) {
  const path = resolveCachePath(parts);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCache(parts, payload, opts = {}) {
  const path = resolveCachePath(parts);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
  const out = {
    ...payload,
    generatedAt: payload && payload.generatedAt ? payload.generatedAt : nowMs(),
    lastAccessedAt: payload && payload.lastAccessedAt ? payload.lastAccessedAt : nowMs()
  };
  try {
    await writeFile(tmp, JSON.stringify(out, null, 2), 'utf8');
    await renameWithRetry(tmp, path);
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
  if (!opts.skipPrune) pruneCacheIfNeeded().catch(() => {});
  return out;
}

export async function getOrRefresh(parts, ttlMs, refreshFn, opts = {}) {
  const cached = await readCache(parts);
  if (!opts.force && isFresh(cached, ttlMs)) {
    return {
      source: 'cache',
      stale: false,
      generatedAt: cached.generatedAt,
      ttlMs: cached.ttlMs || ttlMs,
      data: cached.data
    };
  }

  const forceMinAgeMs = Math.max(0, Number(opts.forceMinAgeMs) || 0);
  if (
    opts.force &&
    forceMinAgeMs > 0 &&
    cached &&
    Number(cached.generatedAt) > 0 &&
    nowMs() - Number(cached.generatedAt) < forceMinAgeMs
  ) {
    return {
      source: 'cache',
      stale: false,
      generatedAt: cached.generatedAt,
      ttlMs: cached.ttlMs || ttlMs,
      data: cached.data
    };
  }

  try {
    const refreshKey = JSON.stringify(parts);
    let refreshPromise = inflightRefreshes.get(refreshKey);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const data = await refreshFn();
        const payload = {
          generatedAt: nowMs(),
          lastAccessedAt: nowMs(),
          ttlMs,
          data
        };
        await writeCache(parts, payload, { skipPrune: !!opts.skipPrune });
        return payload;
      })();
      inflightRefreshes.set(refreshKey, refreshPromise);
      refreshPromise.finally(() => {
        if (inflightRefreshes.get(refreshKey) === refreshPromise) {
          inflightRefreshes.delete(refreshKey);
        }
      }).catch(() => {});
    }
    const payload = await refreshPromise;
    return {
      source: 'network',
      stale: false,
      generatedAt: payload.generatedAt,
      ttlMs,
      data: payload.data
    };
  } catch (err) {
    if (cached && Object.prototype.hasOwnProperty.call(cached, 'data')) {
      return {
        source: 'stale',
        stale: true,
        generatedAt: cached.generatedAt,
        ttlMs: cached.ttlMs || ttlMs,
        data: cached.data,
        upstreamError: err && err.message ? err.message : String(err)
      };
    }
    throw err;
  }
}

export function getInflightRefreshCount() {
  return inflightRefreshes.size;
}

async function walkJsonFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walkJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

async function shouldDeleteCacheFile(path, now) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    const generatedAt = Number(parsed && parsed.generatedAt) || 0;
    const lastAccessedAt = Number(parsed && parsed.lastAccessedAt) || generatedAt || 0;
    if (generatedAt && now - generatedAt <= SIXTY_DAYS_MS) return false;
    if (lastAccessedAt && now - lastAccessedAt <= THIRTY_DAYS_MS) return false;
    return true;
  } catch {
    return false;
  }
}

export async function pruneCacheIfNeeded({ force = false } = {}) {
  const now = nowMs();
  if (!force && now - lastPruneAt < PRUNE_INTERVAL_MS) return { checked: 0, deleted: 0 };
  lastPruneAt = now;
  const files = await walkJsonFiles(rootPath);
  let deleted = 0;
  for (const file of files) {
    if (await shouldDeleteCacheFile(file, now)) {
      try {
        await rm(file, { force: true });
        deleted += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return { checked: files.length, deleted };
}
