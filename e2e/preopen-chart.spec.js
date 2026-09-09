import { test, expect } from '@playwright/test';
import { clearLocalStorage, setupApiMocks, stubWebSpeech, stubNotification } from './helpers.js';

test('preopen stock chart shows previous session and follows opening unless history is pinned', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-05T06:00:00+08:00') });
  await clearLocalStorage(page); await setupApiMocks(page); await stubWebSpeech(page); await stubNotification(page);
  await page.addInitScript(() => { window.Worker = undefined; });
  await page.goto('/');
  await page.fill('#code-input', 'sh600519');
  await page.press('#code-input', 'Enter');
  await expect(page.locator('tr[data-code="sh600519"] .name')).toContainText('贵州茅台');
  await page.evaluate(async () => {
    const state = (await import('/src/js/app.js'))._internal().state;
    state.autoRefreshEnabled = false;
  });
  await page.locator('tr[data-code="sh600519"] td.code').click();
  const selectedDate = () => page.evaluate(async () =>
    (await import('/src/js/app.js'))._internal().state.chartInstances.get('sh600519')?.selectedTradeDate);
  await expect.poll(selectedDate).toBe('2026-06-04');
  await page.clock.setSystemTime(new Date('2026-06-05T09:30:00+08:00'));
  await page.evaluate(async () => (await import('/src/js/app.js')).updateChartLastTickMulti());
  await expect.poll(selectedDate).toBe('2026-06-05');
  await page.evaluate(async () => {
    const app = await import('/src/js/app.js');
    const inst = app._internal().state.chartInstances.get('sh600519');
    inst.selectedTradeDate = '2026-06-04'; inst.manualTradeDate = true;
    inst.intradayLastFetchAt = 0;
    app.updateChartLastTickMulti();
  });
  expect(await selectedDate()).toBe('2026-06-04');
});
