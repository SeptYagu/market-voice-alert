// 持久化 e2e
import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification, DEFAULT_TIMEOUT } from './helpers.js';

test.describe('持久化', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
  });

  test('监控页配置 reload 后保留', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    // 添加 2 个 code
    await page.fill('#code-input', 'sh600519,sz000858');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // 改主题
    await page.click('#theme-toggle');
    const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
    // 改刷新
    await page.selectOption('#refresh-select', '60000');
    // reload
    await page.reload();
    // 验证
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sz000858"]')).toBeVisible();
    const themeReload = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(themeReload).toBe(themeAfter);
  });

  test('看板页刷新频率 reload 后保留', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // 改刷新
    await page.selectOption('#limit-up-refresh', '10000');
    // 等 storage 写入
    await page.waitForTimeout(200);
    // reload
    await page.reload();
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const refreshValue = await page.locator('#limit-up-refresh').inputValue();
    expect(refreshValue).toBe('10000');
  });
});
