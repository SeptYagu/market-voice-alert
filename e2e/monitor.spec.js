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

  test('10日强势股行点击展开图表并挂载 Canvas (F-P0-1 验证)', async ({ page }) => {
    await page.route('**/api/cache/momentum/ten-day**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          source: 'cache',
          data: {
            status: 'complete',
            date: '20260605',
            threshold: 45,
            lookbackDays: 10,
            universeSize: 1,
            scanned: 1,
            items: [
              {
                code: 'sh600519',
                name: '贵州茅台',
                gainPercent: 48.5,
                price: 2000,
                changePercent: 5.2,
                amount: 8000000000,
                industry: '白酒',
                reason: '消费复苏'
              }
            ]
          }
        })
      });
    });

    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('button', { name: '扫描', exact: true }).click();
    const row = page.locator('tr[data-momentum-code="sh600519"]');
    await expect(row).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await row.click();
    const chartRow = page.locator('tr.momentum-chart-row[data-chart-for="sh600519"]');
    await expect(chartRow).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const host = page.locator('#momentum-chart-host-sh600519');
    await expect(host).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(host.locator('canvas').first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });
});

