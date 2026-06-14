// K 线图展开 e2e
// 注意：lightweight-charts 在 Playwright headless 中可能不创建 canvas 元素，
// 但 chart instance 会正确创建并接受数据。我们只断言 host + status，
// 不强求 canvas。
import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification, DEFAULT_TIMEOUT } from './helpers.js';

test.describe('K 线图展开', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
  });

  test('监控页点行 → K 线在该行下方展开', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sh600519"] .name')).toContainText('贵州茅台', { timeout: DEFAULT_TIMEOUT });
    // 点行
    await page.locator('tr[data-code="sh600519"] td.code').click();
    // chart-row 出现
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // chart-host 出现
    await expect(page.locator('#chart-host-sh600519')).toBeVisible();
    // 状态显示已加载
    await expect(page.locator('#chart-status-sh600519')).toContainText(/\d+ 根/, { timeout: DEFAULT_TIMEOUT });
  });

  test('K 线数据加载后 chart-host 不应被清空（回归测试）', async ({ page }) => {
    // 场景：点行 → 图表 ctl 创建 → K线异步加载完成 → renderTable 重建表 → ?
    // bug: renderTable 的 wrap.innerHTML='' 销毁了旧 chart-host，但 chartInstanceMap
    //      里的 ctl 引用还是旧的 detached element。新 host 因 ctl 仍在 map 而被跳过。
    // 修复后：等 K线加载完成时，chart-host 应有 children（chart 实际 DOM）。
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sh600519"] .name')).toContainText('贵州茅台', { timeout: DEFAULT_TIMEOUT });

    // 点行
    await page.locator('tr[data-code="sh600519"] td.code').click();
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // 等 K线数据真的加载完成（status 显示 N 根）
    await expect(page.locator('#chart-status-sh600519')).toContainText(/\d+ 根/, { timeout: DEFAULT_TIMEOUT });

    // 等一小段时间让 renderData 的 finally 跑完
    await page.waitForTimeout(500);

    // 关键断言：chart-host 必须有 children（chart 实际创建了 DOM）
    const hostInfo = await page.evaluate(() => {
      const host = document.getElementById('chart-host-sh600519');
      if (!host) return { error: 'no host' };
      return {
        childrenCount: host.children.length,
        canvasCount: host.querySelectorAll('canvas').length,
        innerHTMLLength: host.innerHTML.length
      };
    });
    console.log('hostInfo after data load:', JSON.stringify(hostInfo));
    // chart-host 必须有 chart 实际的 DOM 节点（不依赖 canvas 在 headless 中是否渲染）
    // 真实浏览器：children > 0, canvas > 0
    // headless：children > 0（可能有 table 元素等），canvas = 0
    expect(hostInfo.childrenCount).toBeGreaterThan(0);
  });

  test('定时刷新不应重建 chart ctl（保留缩放/拖动）', async ({ page }) => {
    // bug: refreshNow finally 调 renderData → renderTable → 销毁所有 chart ctl。
    //      即使 updateChartLastTickMulti 用 series.update 保留缩放，下一步
    //      renderTable 直接销毁重建，缩放丢失。
    // 修复后：refresh 期间 ctl 容器内容应保持稳定（ctl 未重建）。
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sh600519"] .name')).toContainText('贵州茅台', { timeout: DEFAULT_TIMEOUT });

    // 点行展开 K线
    await page.locator('tr[data-code="sh600519"] td.code').click();
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#chart-status-sh600519')).toContainText(/\d+ 根/, { timeout: DEFAULT_TIMEOUT });

    // 等 K线 chart 真正创建（host 有 children）
    await page.waitForFunction(() => {
      const h = document.getElementById('chart-host-sh600519');
      return h && h.children.length > 0;
    }, { timeout: 5000 });

    // 等 kline 异步加载的 renderData 跑完（500ms 后 ctl 才是稳定的初始态）
    await page.waitForTimeout(500);

    // 拿 chart 容器的 outerHTML 标识（chart 根 DIV 是 lightweight-charts 创建的）
    const before = await page.evaluate(() => {
      const h = document.getElementById('chart-host-sh600519');
      if (!h) return null;
      const root = h.firstElementChild;
      // 标记 chart 根 DIV（给一个随机属性便于后续比对）
      if (root && !root.dataset.testMarker) {
        root.dataset.testMarker = 'before-' + Date.now();
      }
      return root ? root.dataset.testMarker : null;
    });
    expect(before).toBeTruthy();

    // 触发一次 refresh（用自然 10s 周期太慢，这里直接调内部 API）
    // 访问 _forceRefresh via window（需要 expose，简化方案：等 status bar 时间戳变化）
    // 简化：把刷新间隔改成 1s 然后等 1.5s
    await page.selectOption('#refresh-select', '3000');
    await page.waitForTimeout(3500);  // 至少一次 refresh

    const after = await page.evaluate(() => {
      const h = document.getElementById('chart-host-sh600519');
      if (!h) return null;
      const root = h.firstElementChild;
      return root ? root.dataset.testMarker : null;
    });

    // chart 根 DIV 应该是同一个（data-testMarker 保留），证明 ctl 未重建
    expect(after).toBe(before);
  });

  test('监控页展开 2 只股票 → 2 个 K 线图同时存在', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519,sz000858');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sz000858"]')).toBeVisible();
    await page.locator('tr[data-code="sh600519"] td.code').click();
    await page.locator('tr[data-code="sz000858"] td.code').click();
    await expect(page.locator('#chart-host-sh600519')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#chart-host-sz000858')).toBeVisible();
    // 2 个独立的 chart-row
    await expect(page.locator('tr.chart-row[data-chart-for]')).toHaveCount(2);
  });

  test('监控页展开后显示左分时 + 右K线', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('tr[data-code="sh600519"] td.code').click();
    await expect(page.locator('#intraday-chart-host-sh600519')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#chart-host-sh600519')).toBeVisible();
    await expect(page.locator('#intraday-status-sh600519')).toContainText(/分时|点/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#intraday-status-sh600519')).toContainText(/%/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#intraday-status-sh600519')).toContainText(/AKTools/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#chart-status-sh600519')).toContainText(/\d+ 根/, { timeout: DEFAULT_TIMEOUT });
  });

  test('监控页多图周期互不影响', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519,sz000858');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-code="sz000858"]')).toBeVisible();
    await page.locator('tr[data-code="sh600519"] td.code').click();
    await page.locator('tr[data-code="sz000858"] td.code').click();
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"] .period-tab[data-period="1d"]')).toHaveClass(/active/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr.chart-row[data-chart-for="sz000858"] .period-tab[data-period="1d"]')).toHaveClass(/active/);
    await page.locator('tr.chart-row[data-chart-for="sh600519"] .period-tab[data-period="1m"]').click();
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"] .period-tab[data-period="1m"]')).toHaveClass(/active/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr.chart-row[data-chart-for="sz000858"] .period-tab[data-period="1d"]')).toHaveClass(/active/);
  });

  test('监控页关闭按钮 → K 线消失', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('tr[data-code="sh600519"] td.code').click();
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.click('tr.chart-row[data-chart-for="sh600519"] .chart-close');
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"]')).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
  });

  test('K 线周期 tab 切换', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/');
    await page.fill('#code-input', 'sh600519');
    await page.press('#code-input', 'Enter');
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('tr[data-code="sh600519"] td.code').click();
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // 默认日 K 应该是 active
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"] .period-tab[data-period="1d"]')).toHaveClass(/active/);
    // 点 1m tab
    await page.locator('tr.chart-row[data-chart-for="sh600519"] .period-tab[data-period="1m"]').click();
    await expect(page.locator('tr.chart-row[data-chart-for="sh600519"] .period-tab[data-period="1m"]')).toHaveClass(/active/, { timeout: DEFAULT_TIMEOUT });
  });

  test('涨停看板点行 → 行内 K 线展开 + 周期 tab', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('tr[data-code="sh600519"] td.lu-code').click();
    await expect(page.locator('tr[data-chart-for="sh600519"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // 8 个周期 tab
    await expect(page.locator('tr[data-chart-for="sh600519"] .lu-period-tab')).toHaveCount(8);
    // 状态显示已加载
    await expect(page.locator('tr[data-chart-for="sh600519"] #lu-chart-status-sh600519')).toContainText(/\d+ 根/, { timeout: DEFAULT_TIMEOUT });
  });

  test('涨停页多图周期互不影响', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/limit-up');
    await expect(page.locator('#lu-groups')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('tr[data-code="sh600519"] td.lu-code').click();
    await page.locator('tr[data-code="sz000858"] td.lu-code').click();
    await expect(page.locator('tr[data-chart-for="sh600519"] .lu-period-tab[data-period="1d"]')).toHaveClass(/active/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-chart-for="sz000858"] .lu-period-tab[data-period="1d"]')).toHaveClass(/active/);
    await page.locator('tr[data-chart-for="sh600519"] .lu-period-tab[data-period="1m"]').click();
    await expect(page.locator('tr[data-chart-for="sh600519"] .lu-period-tab[data-period="1m"]')).toHaveClass(/active/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('tr[data-chart-for="sz000858"] .lu-period-tab[data-period="1d"]')).toHaveClass(/active/);
    await expect(page.locator('#lu-intraday-chart-host-sh600519')).toBeVisible();
    await expect(page.locator('#lu-intraday-status-sh600519')).toContainText(/%/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#lu-intraday-status-sh600519')).toContainText(/AKTools/, { timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#lu-chart-host-sh600519')).toBeVisible();
  });
});
