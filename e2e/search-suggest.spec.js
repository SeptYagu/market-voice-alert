// 搜索联想与建议端到端 E2E 测试
import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification, DEFAULT_TIMEOUT } from './helpers.js';

test.describe('添加栏智能联想全链路', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
  });

  test('输入拼音缩写 (gzmt) → 下拉联想显示贵州茅台 → Enter 提交添加', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    const input = page.locator('#code-input');
    const dropdown = page.locator('#suggest-dropdown');

    // 聚焦并输入 gzmt
    await input.click();
    await input.fill('gzmt');

    // 下拉框应当展开并展示贵州茅台
    await expect(dropdown).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    const firstItem = dropdown.locator('.suggest-item').first();
    await expect(firstItem).toBeVisible();
    await expect(firstItem.locator('.suggest-name')).toContainText('贵州茅台');
    await expect(firstItem.locator('.suggest-code')).toHaveText('SH600519');

    // 回车直接添加首选
    await input.press('Enter');

    // 下拉列表应当收起
    await expect(dropdown).toBeHidden();

    // 自选股表格中应当成功出现贵州茅台 (sh600519)
    const row = page.locator('tr[data-code="sh600519"]');
    await expect(row).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(row.locator('.code')).toHaveText('sh600519');
    await expect(row.locator('.name')).toContainText('贵州茅台');
  });

  test('键盘方向键导航与 Escape 关闭', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    const input = page.locator('#code-input');
    const dropdown = page.locator('#suggest-dropdown');

    await input.click();
    await input.fill('shiyou');

    await expect(dropdown).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const items = dropdown.locator('.suggest-item');
    await expect(items.first()).toBeVisible();

    // 按下方向键下选择第一项
    await input.press('ArrowDown');
    await expect(items.first()).toHaveAttribute('aria-selected', 'true');

    // 按下方向键下选择第二项
    if (await items.count() > 1) {
      await input.press('ArrowDown');
      await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
    }

    // 按 Escape 键应关闭下拉框，且输入框保留
    await input.press('Escape');
    await expect(dropdown).toBeHidden();
  });

  test('历史曾用名检索与命中说明 (sfza / 深发展 → 平安银行)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    const input = page.locator('#code-input');
    const dropdown = page.locator('#suggest-dropdown');

    await input.click();
    await input.fill('sfza');

    await expect(dropdown).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const firstItem = dropdown.locator('.suggest-item').first();
    await expect(firstItem.locator('.suggest-name')).toContainText('平安银行');
    await expect(firstItem.locator('.suggest-former-name')).toContainText('曾用名: 深发展A');

    // 鼠标点击候选行添加
    await firstItem.click();
    await expect(dropdown).toBeHidden();

    const row = page.locator('tr[data-code="sz000001"]');
    await expect(row).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });

  test('已添加股票在联想中高亮已添加标识且不可重复添加', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    const input = page.locator('#code-input');
    const dropdown = page.locator('#suggest-dropdown');

    // 先添加 600519
    await input.click();
    await input.fill('sh600519');
    await page.keyboard.press('Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // 再次输入 gzmt 搜索
    await input.fill('gzmt');
    await expect(dropdown).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const item = dropdown.locator('.suggest-item').first();
    await expect(item).toHaveClass(/is-added/);
    await expect(item.locator('.suggest-added-tag')).toContainText('已添加');

    // 回车不应报错或重复添加
    await input.press('Enter');
    const count = await page.locator('tr[data-code="sh600519"]').count();
    expect(count).toBe(1);
  });

  test('期货品种与连续合约支持 (rb / 螺纹)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    const input = page.locator('#code-input');
    const dropdown = page.locator('#suggest-dropdown');

    await input.click();
    await input.fill('rb');

    await expect(dropdown).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const rbItem = dropdown.locator('.suggest-item').first();
    await expect(rbItem.locator('.suggest-name')).toContainText('螺纹钢连续');

    await rbItem.click();
    const row = page.locator('tr[data-code="rb0"]');
    await expect(row).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });

  test('批量输入识别并绕过下拉框 (逗号分隔多个代码)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');

    const input = page.locator('#code-input');
    const dropdown = page.locator('#suggest-dropdown');

    await input.click();
    await input.fill('600519, 000001');

    // 批量模式下下拉列表应当不显示 (或显示批量提示，但不阻碍回车批量添加)
    await input.press('Enter');

    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sz000001"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(dropdown).toBeHidden();
  });
});
