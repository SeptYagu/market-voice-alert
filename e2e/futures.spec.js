// 境内期货端到端 E2E 测试
import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification, DEFAULT_TIMEOUT } from './helpers.js';

test.describe('期货监控全链路', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
  });

  test('输入期货代码 (rb2510) → 正确显示期货行与动态表头', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    // 初始空列表时表头不含斜杠
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('thead th:has-text("量比")')).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // 添加期货代码
    await page.fill('#code-input', 'rb2510');
    await page.press('#code-input', 'Enter');

    const row = page.locator('tr[data-code="rb2510"]');
    await expect(row).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(row.locator('.code')).toHaveText('RB2510');
    await expect(row.locator('.name')).toContainText('螺纹钢');
    await expect(row.locator('.num.up').first()).toContainText('3350');
    await expect(row.locator('td:nth-child(8)')).toContainText('120,000');
    await expect(row.locator('td:nth-child(9)')).toContainText('持仓 1,800,000');

    // 表头自适应
    await expect(page.locator('thead th:has-text("量比 / 量")')).toBeVisible();
    await expect(page.locator('thead th:has-text("成交额 / 持仓")')).toBeVisible();
  });

  test('支持中文别名与股指期货连续合约输入 (螺纹主连, IF0)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    await page.fill('#code-input', '螺纹主连, IF0');
    await page.press('#code-input', 'Enter');

    const rbRow = page.locator('tr[data-code="rb0"]');
    await expect(rbRow).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(rbRow.locator('.code')).toHaveText('RB0');
    await expect(rbRow.locator('.name')).toContainText('螺纹钢连续');

    const ifRow = page.locator('tr[data-code="if0"]');
    await expect(ifRow).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(ifRow.locator('.code')).toHaveText('IF0');
    await expect(ifRow.locator('.name')).toContainText('沪深300连续');
  });

  test('点击期货行展开内嵌图表并支持周期切换', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    await page.fill('#code-input', 'rb2510');
    await page.press('#code-input', 'Enter');

    const row = page.locator('tr[data-code="rb2510"]');
    await expect(row).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // 点击代码单元格展开图表
    await row.locator('td.code').click();
    const chartRow = page.locator('tr.chart-row[data-chart-for="rb2510"]');
    await expect(chartRow).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#chart-host-rb2510')).toBeVisible();

    // 检查周期切换按钮
    const periodBar = chartRow.locator('.period-tabs');
    await expect(periodBar).toBeVisible();
    await expect(periodBar.locator('.period-tab[data-period="1d"]')).toBeVisible();
    await expect(periodBar.locator('.period-tab[data-period="1m"]')).toBeVisible();

    // 切换到 1分周期
    await periodBar.locator('.period-tab[data-period="1m"]').click();
    await expect(periodBar.locator('.period-tab[data-period="1m"]')).toHaveClass(/active/);

    // 再次点击折叠
    await row.locator('td.code').click();
    await expect(chartRow).toHaveCount(0);
  });
});
