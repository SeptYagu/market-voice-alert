// 路由切换 e2e
import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification, DEFAULT_TIMEOUT } from './helpers.js';

test.describe('路由切换', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
  });

  test('默认进入监控页（#/）', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('#code-input')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // nav 链接可见，监控页有 #code-input 输入框
    await expect(page.locator('header.app-header nav.app-nav')).toBeVisible();
  });

  test('点 nav 切到涨停看板', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.click('a[href="#/limit-up"]');
    await expect(page).toHaveURL(/#\/limit-up$/);
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });

  test('直接访问 #/limit-up 也进入看板', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });

  test('未知路径回退到 #/', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/some-unknown-path');
    await expect(page).toHaveURL(/#\/$/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#code-input')).toBeVisible();
  });

  test('在看板页刷新不丢失路由', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.reload();
    await expect(page).toHaveURL(/#\/limit-up$/);
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });
});
