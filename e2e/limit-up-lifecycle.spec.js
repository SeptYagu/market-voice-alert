import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification } from './helpers.js';

test('expanded limit-up chart survives broken/resealed moves and force reload bypasses cache', async ({ page }) => {
  await clearLocalStorage(page); await stubWebSpeech(page); await stubNotification(page); await setupApiMocks(page);
  await page.goto('http://127.0.0.1:5173/#/limit-up');
  const row = page.locator('tr[data-code="sh600519"]');
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('#lu-chart-host-sh600519 canvas').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const app = await import('/src/js/app.js');
    const { buildLimitUpGroupsForState } = await import('/src/js/controllers/limitUpController.js');
    app.limitUpCtrl.stopTimer();
    const lu = app._internal().state.limitUp;
    const code = 'sh600519';
    const row = document.querySelector(`tr[data-code="${code}"]`);
    const chart = row.nextElementSibling;
    const ctl = app.limitUpChartMgr.klineCtlMap.get(code);
    lu.items = lu.items.map(item => item.code === code ? { ...item, changePercent: 5 } : item);
    lu.groups = buildLimitUpGroupsForState(lu); app.limitUpCtrl.render();
    const broken = row.closest('[data-group]').dataset.group;
    lu.items = lu.items.map(item => item.code === code ? { ...item, changePercent: 10, limitUpCount: 2 } : item);
    lu.groups = buildLimitUpGroupsForState(lu); app.limitUpCtrl.render();
    return { broken, resealed: row.closest('[data-group]').dataset.group,
      rowSame: row === document.querySelector(`tr[data-code="${code}"]`),
      chartSame: chart === row.nextElementSibling, instanceSame: ctl === app.limitUpChartMgr.klineCtlMap.get(code) };
  });
  expect(result).toEqual({ broken: 'broken', resealed: '2', rowSame: true, chartSame: true, instanceSame: true });
  const request = page.waitForRequest(req => req.url().includes('/api/eastmoney-kline/'));
  await page.locator('#lu-chart-reload-sh600519').click();
  await request;
  await expect(page.locator('#lu-chart-host-sh600519 canvas').first()).toBeVisible();
});
