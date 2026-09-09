import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Explicit opt-in live check; never use the user's cache or start background scans.
const cacheRoot = await mkdtemp(join(tmpdir(), 'market-spot-smoke-'));
if (dirname(resolve(cacheRoot)) !== resolve(tmpdir())) throw new Error('Unexpected smoke cache path');
process.env.MARKET_VOICE_CACHE_ROOT = cacheRoot;
process.env.DISABLE_BACKGROUND_JOBS = '1';
try {
  const { getCachedSpotLatest } = await import('../server/spotService.js');
  const started = Date.now();
  const result = await getCachedSpotLatest({ signal: AbortSignal.timeout(60000) });
  const { data } = result;
  console.log(JSON.stringify({ elapsedMs: Date.now() - started, source: data.source, stale: result.stale,
    universeComplete: data.universeComplete, count: data.count, universeStats: data.universeStats,
    markets: Object.fromEntries(['sh', 'sz', 'bj'].map(prefix => [prefix, data.items.filter(item => item.code.startsWith(prefix)).length]))
  }, null, 2));
  if (result.stale || data.universeComplete !== true) throw new Error('Full market snapshot was not recovered');
} finally {
  await rm(cacheRoot, { recursive: true, force: true });
}
