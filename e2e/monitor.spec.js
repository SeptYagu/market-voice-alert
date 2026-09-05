// 监控页基本功能 e2e
import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification, DEFAULT_TIMEOUT } from './helpers.js';

test.describe('监控页', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
  });

  test('输入代码 + 回车 → 表格出现一行', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sh600519"] .name')).toContainText('贵州茅台', { timeout: DEFAULT_TIMEOUT });
  });

  test('多个代码逗号分隔 → 多行', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519,sz000858,sh688981');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sz000858"]')).toBeVisible();
    await expect(page.locator('tr[data-code="sh688981"]')).toBeVisible();
  });

  test('删除按钮移除一行', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.click('tr[data-code="sh600519"] .btn-link');
    const confirmBtn = page.locator('.app-modal-confirm-btn');
    await expect(confirmBtn).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await confirmBtn.click();
    await expect(page.locator('tr[data-code="sh600519"]')).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
  });

  test('主题切换 + localStorage 持久化', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    const initial = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('#theme-toggle');
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(initial);
    const stored = await page.evaluate(() => localStorage.getItem('app_theme'));
    expect(stored).toBe(after);
  });

  test('刷新频率下拉切换', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.selectOption('#refresh-select', '60000');
    const stored = await page.evaluate(() => localStorage.getItem('app_settings'));
    expect(stored).toContain('60000');
  });

  test('状态栏在添加后更新', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await expect(page.locator('#status-bar')).toContainText('共 0 项');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('#status-bar')).toContainText('共 1 项', { timeout: DEFAULT_TIMEOUT });
  });

  test('10日涨幅扫描按钮会 POST 启动任务且不把正常状态显示成错误', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    const requestPromise = page.waitForRequest((request) => (
      request.method() === 'POST' && request.url().includes('/api/cache/momentum/ten-day/scan')
    ));
    await page.getByRole('button', { name: '扫描', exact: true }).click();
    await requestPromise;
    await expect(page.locator('.momentum-actions')).not.toContainText('错误:', { timeout: DEFAULT_TIMEOUT });
  });

  test('输入期货代码（如 rb2510）→ 表格出现期货行并显示持仓量', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'rb2510');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="rb2510"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="rb2510"] .name')).toContainText('螺纹钢2510', { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="rb2510"]')).toContainText('持仓', { timeout: DEFAULT_TIMEOUT });
  });
});
