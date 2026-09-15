import { test, expect } from '@playwright/test';
import { clearLocalStorage, setupApiMocks, stubNotification } from './helpers.js';

// 「相同报价不重复播报」开关：必须是交易时段那一排的第 5 个（沿用同样的样式）、
// 关掉后每轮都播、且选择要能跨刷新保留。
// 每条"没有新增播报"的断言前面都先证明定时器真实在跑（报价变化会被播），
// 否则它可能只是因为根本没 tick 而空转通过。
test('skip-unchanged toggle sits in the schedule row, controls repeats and persists', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T21:10:00+08:00') });
  await clearLocalStorage(page); await setupApiMocks(page); await stubNotification(page);
  // 用假时钟驱动的 setInterval 代替 Worker，tick 才可确定。
  await page.addInitScript(() => { window.Worker = undefined; });
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.locator('#voice-bar')).toBeVisible();
  // 等启动请求结束，否则 warmup 会在断言中途覆盖夹具。
  await expect.poll(() => page.evaluate(async () => {
    const state = (await import('/src/js/app.js'))._internal().state;
    return !state.loading && state.tradingDates.length > 0;
  })).toBe(true);
  await page.evaluate(async () => {
    const app = await import('/src/js/app.js');
    const tts = await import('/src/js/tts.js');
    window.reviewSpoken = [];
    tts.setSpeechAdapter({
      speak(utterance) { window.reviewSpoken.push(utterance.text); utterance.onend?.(); },
      cancel() {}
    });
    const state = app._internal().state;
    state.autoRefreshEnabled = false;
    state.tradingDates = [];
    state.subscribed = new Set(['rb0']);
    state.quotes = new Map([['rb0', { code: 'rb0', name: 'Rebar sentinel', price: 3000, changePercent: 1 }]]);
  });

  // 1) 位置与样式：与那 4 个时段开关同排、同类名，且不受「智能交易时段」禁用影响。
  const toggles = page.locator('#voice-bar .voice-schedule-row .schedule-toggle');
  await expect(toggles).toHaveCount(5);
  const dedupe = toggles.filter({ hasText: '相同报价不重复播报' });
  await expect(dedupe).toHaveCount(1);
  await expect(dedupe.locator('input')).toBeChecked();
  await expect(dedupe.locator('input')).toBeEnabled();

  await page.getByRole('button', { name: '▶ 启用定时语音播报' }).click();
  const first = await page.evaluate(() => window.reviewSpoken.length);
  expect(first).toBeGreaterThan(0);

  // 2) 默认（去重开）：报价不变 → 多轮 tick 都不出声。
  await page.clock.runFor(30500);
  expect(await page.evaluate(() => window.reviewSpoken.length)).toBe(first);

  // 3) 证明定时器确实在跑：改一次现价，下一轮必须播出来。
  await page.evaluate(async () => {
    (await import('/src/js/app.js'))._internal().state.quotes.get('rb0').price = 3010;
  });
  await page.clock.runFor(6000);
  const afterChange = await page.evaluate(() => window.reviewSpoken);
  expect(afterChange.length).toBe(first + 1);
  expect(afterChange.at(-1)).toContain('3010');

  // 4) 关掉去重：同一报价每轮都要播。
  await dedupe.click();
  await expect(dedupe.locator('input')).not.toBeChecked();
  const beforeOff = await page.evaluate(() => window.reviewSpoken.length);
  await page.clock.runFor(30500);
  const offRounds = await page.evaluate(() => window.reviewSpoken.length) - beforeOff;
  expect(offRounds).toBeGreaterThanOrEqual(5);

  // 5) 持久化：关掉的状态落进 localStorage，刷新后仍保持。
  expect(await page.evaluate(
    () => JSON.parse(localStorage.getItem('voice_settings') || '{}').skipUnchanged
  )).toBe(false);
  await page.reload();
  await expect(page.locator('#voice-bar')).toBeVisible();
  const afterReload = page.locator('#voice-bar .voice-schedule-row .schedule-toggle')
    .filter({ hasText: '相同报价不重复播报' });
  await expect(afterReload.locator('input')).not.toBeChecked();
});
