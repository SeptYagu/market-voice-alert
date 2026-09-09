import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const integration = process.argv.includes('--integration');
const cacheRoot = await mkdtemp(join(tmpdir(), 'market-voice-tests-'));
if (dirname(resolve(cacheRoot)) !== resolve(tmpdir())) throw new Error('Unexpected test cache path');
try {
  const child = spawn(process.execPath, ['node_modules/qunit/bin/qunit.js', '--require', './tests/_jsdom-setup.cjs',
    integration ? 'tests/integration/*.js' : 'tests/**/*.test.js'], {
    stdio: 'inherit', env: { ...process.env, MARKET_VOICE_CACHE_ROOT: cacheRoot,
      MARKET_VOICE_TEST_NETWORK: integration ? 'integration' : 'offline', DISABLE_BACKGROUND_JOBS: '1' }
  });
  process.exitCode = await new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolveExit(code ?? 1));
  });
} finally {
  // Only the unique directory created by this run may be recursively removed.
  await rm(cacheRoot, { recursive: true, force: true });
}
