import { test, expect } from '@playwright/test';

test('diagnostics page loads real API, filters and exports', async ({ page }) => {
  await page.goto('/logs.html');
  await expect(page.locator('#status')).toContainText('服务器版本');
  await page.evaluate(async () => {
    await fetch('/api/cache/diagnostics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'http', status: 503, location: '/api/cache/kline?token=SHOULD_NOT_LEAK' }) });
  });
  await page.locator('#refresh').click();
  await page.locator('#source').selectOption('browser');
  await page.locator('#search').fill('503');
  await expect(page.locator('#entries')).toContainText('/api/cache/kline');
  await expect(page.locator('#entries')).not.toContainText('SHOULD_NOT_LEAK');
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await download).suggestedFilename()).toBe('market-diagnostics.json');
});

test('early reporter captures runtime errors without sending raw text', async ({ page }) => {
  await page.goto('/logs.html');
  await page.addScriptTag({ url: '/diagnostics-client.js' });
  const report = page.waitForRequest(req => req.url().endsWith('/api/cache/diagnostics') && req.method() === 'POST');
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'SECRET', error: new TypeError('SECRET'), lineno: 27 })));
  const body = (await report).postDataJSON();
  expect(body.kind).toBe('runtime');
  expect(body.errorName).toBe('TypeError');
  expect(JSON.stringify(body)).not.toContain('SECRET');
});
