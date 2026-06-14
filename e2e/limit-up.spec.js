// 涨停看板 e2e
import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification, DEFAULT_TIMEOUT } from './helpers.js';
import { LIMIT_UP_EMPTY_BODY } from './fixtures/limits-up.js';

test.describe('涨停看板', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });

  test('渲染 4 个分组（3+板 / 2板 / 1板 / 炸板）', async ({ page }) => {
    await expect(page.locator('section[data-group="3+"]')).toBeVisible();
    await expect(page.locator('section[data-group="2"]')).toBeVisible();
    await expect(page.locator('section[data-group="1"]')).toBeVisible();
    await expect(page.locator('section[data-group="broken"]')).toBeVisible();
  });

  test('状态栏显示总数 + 更新于时间', async ({ page }) => {
    await expect(page.locator('#lu-status')).toContainText(/\d+ 只涨停/);
    await expect(page.locator('#lu-status')).toContainText('更新于');
  });

  test('ST 股票显示 ST 徽章', async ({ page }) => {
    // ST 测试 (sz000022) 在 1板/首板 桶
    const stRow = page.locator('tr[data-code="sz000022"]');
    await expect(stRow).toBeVisible();
    await expect(stRow.locator('.lu-st-badge')).toContainText('ST');
  });

  test('排序切换：涨幅 → 行按涨跌幅降序', async ({ page }) => {
    // 排序：涨幅。1 板桶的 stock 应按涨跌幅降序排列
    await page.locator('section[data-group="1"] th.lu-pct').click();
    await page.waitForTimeout(200);
    // 1 板桶在 pct 排序下，最高涨幅应该是 10.01% (601012 隆基绿能)
    const firstPct = await page.evaluate(() => {
      const sec = document.querySelector('section[data-group="1"]');
      if (!sec) return null;
      const row = sec.querySelector('tr.lu-row');
      if (!row) return null;
      const pctCell = row.querySelector('.lu-pct');
      return pctCell ? pctCell.textContent.trim() : null;
    });
    // 解析 "10.01%" → 10.01
    const pctNum = firstPct ? parseFloat(firstPct) : NaN;
    expect(pctNum).toBeGreaterThanOrEqual(10.0);
    expect(pctNum).toBeLessThanOrEqual(10.02);
  });

  test('复选框勾选 + 计数更新', async ({ page }) => {
    await page.click('tr[data-code="sh600519"] input[type="checkbox"]');
    await page.click('tr[data-code="sz000858"] input[type="checkbox"]');
    await expect(page.locator('#lu-selected-count')).toContainText('2 已选', { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#lu-add-selected')).toBeEnabled();
  });

  test('全选/取消全选', async ({ page }) => {
    await page.click('#lu-select-all');
    await expect(page.locator('#lu-selected-count')).toContainText(/\d+ 已选/);
    const allCount = await page.locator('.lu-row').count();
    const counterText = await page.locator('#lu-selected-count').textContent();
    expect(counterText).toMatch(new RegExp(`${allCount} 已选`));
    await page.click('#lu-select-none');
    await expect(page.locator('#lu-selected-count')).toContainText('0 已选', { timeout: DEFAULT_TIMEOUT });
  });

  test('刷新频率下拉切换 + localStorage 持久化', async ({ page }) => {
    await page.selectOption('#limit-up-refresh', '60000');
    const stored = await page.evaluate(() => localStorage.getItem('limit_up_settings'));
    expect(JSON.parse(stored).refreshInterval).toBe(60000);
  });

  test('立即刷新按钮存在', async ({ page }) => {
    const btn = page.locator('button:has-text("立即刷新")');
    await expect(btn).toBeVisible();
  });

  test('空响应时锁定显示 + 状态栏显示缓存', async ({ page }) => {
    // 首次已有 10 只数据（来自 beforeEach 的初始 fetch）
    await expect(page.locator('#lu-status')).toContainText(/\d+ 只涨停/);
    // 改为返回空响应 (AKTools 路径，2026-06-05 升级)
    await page.unroute('**/api/aktools/api/public/stock_zt_pool_em**');
    await page.route('**/api/aktools/api/public/stock_zt_pool_em**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(LIMIT_UP_EMPTY_BODY)
      });
    });
    await page.click('button:has-text("立即刷新")');
    // 空响应：状态栏应显示"缓存自... 已空 N 次"，数据保留
    await expect(page.locator('#lu-status')).toContainText(/缓存自.*已空 \d+ 次/, { timeout: DEFAULT_TIMEOUT });
    // 看板仍展示原 10 只
    await expect(page.locator('.lu-row')).toHaveCount(10);
  });

  // ===== 2026-06-05 升级：龙虎榜列 =====
  test('龙虎榜列：有龙虎榜记录的行显示"上榜原因" + tooltip 含"解读"', async ({ page }) => {
    // sh600519 在 lhb fixture 中有上榜原因
    const row600519 = page.locator('tr[data-code="sh600519"]');
    await expect(row600519).toBeVisible();
    const reasonCell = row600519.locator('td.lu-reason');
    await expect(reasonCell).toContainText('日涨幅偏离值达7%');
    // title 属性 = interpretation
    const title = await reasonCell.getAttribute('title');
    expect(title).toContain('3家机构买入');
  });

  test('龙虎榜列：没有龙虎榜记录的行显示 — ', async ({ page }) => {
    // sh601012 不在 lhb fixture 中（normalizeCode 给 60xxxx 加 sh 前缀）
    const row601012 = page.locator('tr[data-code="sh601012"]');
    await expect(row601012).toBeVisible();
    const reasonCell = row601012.locator('td.lu-reason');
    await expect(reasonCell).toHaveText('—');
  });

  // ===== 2026-06-05 升级：日期选择器 =====
  test('日期选择器存在 + 默认值 = 最近交易日', async ({ page }) => {
    const dateInput = page.locator('#lu-date');
    await expect(dateInput).toBeVisible();
    await expect(dateInput).toHaveValue('2026-06-05');
  });

  test('"今天" 按钮存在 + 点击不报错', async ({ page }) => {
    const todayBtn = page.locator('.lu-date-today');
    await expect(todayBtn).toBeVisible();
    await expect(todayBtn).toContainText('今天');
    // 点击应该不抛错（即使 selectedDate 已为 null）
    await todayBtn.click();
    await expect(page.locator('#lu-date')).toBeVisible();
  });

  // ===== 2026-06-05 升级：前一天/后一天按钮 =====
  test('"前一天" / "后一天" 按钮存在', async ({ page }) => {
    await expect(page.locator('#lu-date-prev')).toBeVisible();
    await expect(page.locator('#lu-date-next')).toBeVisible();
  });

  test('"后一天" 按钮在今天被禁用', async ({ page }) => {
    const nextBtn = page.locator('#lu-date-next');
    await expect(nextBtn).toBeDisabled();
  });

  test('点击 "前一天" → 日期输入框 -1 天 + 触发重新拉取', async ({ page }) => {
    // 抓网络请求
    let lastUrl = null;
    page.on('request', (req) => {
      if (req.url().includes('/api/aktools/')) lastUrl = req.url();
    });
    await page.locator('#lu-date-prev').click();
    // 等待新请求发出
    await page.waitForTimeout(500);
    // 验证 URL 含正确格式的 date 参数（YYYYMMDD，无横线）
    t_expectUrlHasUndashedDate(lastUrl);
  });

  test('点击 "后一天" → 日期输入框到下一个交易日（不超出最近交易日）', async ({ page }) => {
    // 先点前一天让 selectedDate 不是今天
    await page.locator('#lu-date-prev').click();
    await page.waitForTimeout(200);
    const beforeNext = await page.locator('#lu-date').inputValue();
    await page.locator('#lu-date-next').click();
    await page.waitForTimeout(200);
    const afterNext = await page.locator('#lu-date').inputValue();
    // mock 日历中 2026-06-04 的后一个交易日是 2026-06-05
    t_expectDayShift(beforeNext, afterNext, 1);
  });

  test('日期 bug 回归：URL 用 YYYYMMDD 格式（非 YYYY-MM-DD）', async ({ page }) => {
    const capturedUrls = [];
    page.on('request', (req) => {
      if (req.url().includes('stock_zt_pool_em')) capturedUrls.push(req.url());
    });
    // 改日期 → 应触发新请求
    await page.locator('#lu-date').fill('2026-06-04');
    await page.locator('#lu-date').dispatchEvent('change');
    await page.waitForTimeout(500);
    t_expectUrlHasUndashedDate(capturedUrls[capturedUrls.length - 1]);
  });

  // ===== Phase 8: 涨停页多 chart 改造 =====
  test('涨停页可同时打开 A+B 两个 chart（关闭 A 不影响 B）', async ({ page }) => {
    // sh600519 (3+板), sz000001 (2板) — 同时展开
    await page.click('tr[data-code="sh600519"]');
    await page.waitForTimeout(200);
    await page.click('tr[data-code="sz000001"]');
    await page.waitForTimeout(300);
    // 两个 chart row 都存在
    await expect(page.locator('tr[data-chart-for="sh600519"]')).toHaveCount(1);
    await expect(page.locator('tr[data-chart-for="sz000001"]')).toHaveCount(1);
    // 两个独立 host
    await expect(page.locator('#lu-chart-host-sh600519')).toHaveCount(1);
    await expect(page.locator('#lu-chart-host-sz000001')).toHaveCount(1);
    // 关闭 sh600519
    await page.click('tr[data-chart-for="sh600519"] button.lu-chart-close');
    await page.waitForTimeout(200);
    // sh600519 消失，sz000001 仍在
    await expect(page.locator('tr[data-chart-for="sh600519"]')).toHaveCount(0);
    await expect(page.locator('tr[data-chart-for="sz000001"]')).toHaveCount(1);
    // sz000001 的 host 仍可见
    await expect(page.locator('#lu-chart-host-sz000001')).toHaveCount(1);
  });

  test('chart row colspan = 13 (表格列同步回归)', async ({ page }) => {
    await page.click('tr[data-code="sh600519"]');
    await page.waitForTimeout(200);
    const td = page.locator('tr[data-chart-for="sh600519"] > td');
    await expect(td).toHaveAttribute('colspan', '13');
  });

  // ===== Phase 8 fix: 涨停页 chart 重新挂载 =====
  test('展开 chart 后 host 创建 + 切排序触发 rerender chart 仍可见', async ({ page }) => {
    await page.click('tr[data-code="sh600519"]');
    await page.waitForTimeout(500);
    // 验证 host 存在
    await expect(page.locator('#lu-chart-host-sh600519')).toBeVisible();
    // 验证 chart ctl 创建 (lightweight-charts 会创建 canvas 元素)
    const canvasCount1 = await page.locator('#lu-chart-host-sh600519 canvas').count();
    expect(canvasCount1).toBeGreaterThan(0, 'chart ctl created canvases');
    // 切排序触发 rerender, chart 应该重新挂载
    await page.locator('section[data-group="3+"] th.lu-pct').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#lu-chart-host-sh600519')).toBeVisible();
    const canvasCount2 = await page.locator('#lu-chart-host-sh600519 canvas').count();
    expect(canvasCount2).toBeGreaterThan(0, 'chart ctl re-created after rerender');
  });

  test('点 A 行 + 点 B 行 → 两个 chart 同时存在 (Phase 8 多 chart 真实场景)', async ({ page }) => {
    await page.click('tr[data-code="sh600519"]');
    await page.waitForTimeout(300);
    await page.click('tr[data-code="sz000001"]');
    await page.waitForTimeout(500);
    // 两个 chart host 都可见
    await expect(page.locator('#lu-chart-host-sh600519')).toBeVisible();
    await expect(page.locator('#lu-chart-host-sz000001')).toBeVisible();
    // 两个 chart ctl 都创建
    const canvasA = await page.locator('#lu-chart-host-sh600519 canvas').count();
    const canvasB = await page.locator('#lu-chart-host-sz000001 canvas').count();
    expect(canvasA).toBeGreaterThan(0, 'chart A ctl created');
    expect(canvasB).toBeGreaterThan(0, 'chart B ctl created');
    // 关闭 A
    await page.click('tr[data-chart-for="sh600519"] button.lu-chart-close');
    await page.waitForTimeout(500);
    await expect(page.locator('#lu-chart-host-sh600519')).toHaveCount(0);
    // B 仍正常
    await expect(page.locator('#lu-chart-host-sz000001')).toBeVisible();
  });
});

function t_expectUrlHasUndashedDate(url) {
  if (!url) throw new Error('no URL captured');
  if (url.includes('date=2026-06-')) {
    throw new Error(`URL should not contain dashed date: ${url}`);
  }
  if (url.includes('start_date=2026-06-') || url.includes('end_date=2026-06-')) {
    throw new Error(`URL should not contain dashed date: ${url}`);
  }
}

function t_expectDayShift(fromStr, toStr, expectedDelta) {
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T00:00:00');
  const diffMs = to.getTime() - from.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays !== expectedDelta) {
    throw new Error(`expected ${expectedDelta} day shift, got ${diffDays} (${fromStr} → ${toStr})`);
  }
}
