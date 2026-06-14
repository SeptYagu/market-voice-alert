// 涨停看板 - 行点击 / 添加选中
import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification, DEFAULT_TIMEOUT } from './helpers.js';

test.describe('涨停看板 - 行点击与添加', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
  });

  test('行点击 → 行内 K 线展开（不跳转）', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // 点击行（非 checkbox）
    await page.locator('tr[data-code="sh600519"] td.lu-code').click();
    // 行内 K 线容器出现
    await expect(page.locator('tr[data-chart-for="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // URL 不变
    await expect(page).toHaveURL(/#\/limit-up$/);
  });

  test('行点击再次 → 关闭 K 线', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('tr[data-code="sh600519"] td.lu-code').click();
    await expect(page.locator('tr[data-chart-for="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('tr[data-code="sh600519"] td.lu-code').click();
    await expect(page.locator('tr[data-chart-for="sh600519"]')).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
  });

  test('勾选 + 添加选中 → 跳转到 #/ + 监控页有这些 code', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.click('tr[data-code="sh600519"] input[type="checkbox"]');
    await page.click('tr[data-code="sz000858"] input[type="checkbox"]');
    await page.click('#lu-add-selected');
    // 跳转到 #/
    await expect(page).toHaveURL(/#\/$/, { timeout: DEFAULT_TIMEOUT });
    // 监控页有这 2 个 code
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sz000858"]')).toBeVisible();
    // 持久化
    const stored = await page.evaluate(() => localStorage.getItem('stock_watch_list'));
    expect(JSON.parse(stored)).toEqual(expect.arrayContaining(['sh600519', 'sz000858']));
  });
});
