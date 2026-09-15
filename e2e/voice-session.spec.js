import { test, expect } from '@playwright/test';
import { clearLocalStorage, setupApiMocks, stubNotification } from './helpers.js';

test('real app checker keeps mixed night voice armed and respects manual stop', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T21:10:00+08:00') });
  await clearLocalStorage(page); await setupApiMocks(page); await stubNotification(page);
  await page.addInitScript(() => { window.Worker = undefined; });
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.locator('#voice-bar')).toBeVisible();
  // Wait for startup requests before replacing state with this scenario's
  // calendar/quotes, otherwise warmup can overwrite the fixture mid-click.
  await expect.poll(() => page.evaluate(async () => {
    const state = (await import('/src/js/app.js'))._internal().state;
    return !state.loading && state.tradingDates.length > 0;
  })).toBe(true);
  await page.evaluate(async () => {
    const app = await import('/src/js/app.js');
    const tts = await import('/src/js/tts.js');
    window.reviewSpoken = [];
    tts.setSpeechAdapter({ speak(utterance) { window.reviewSpoken.push(utterance.text); utterance.onend?.(); }, cancel() {} });
    const state = app._internal().state;
    state.autoRefreshEnabled = false;
    state.tradingDates = [];
    state.subscribed = new Set(['sh600519', 'rb0', 't0']);
    state.quotes = new Map([
      ['sh600519', { code: 'sh600519', name: 'Stock sentinel', price: 10, changePercent: 1 }],
      ['rb0', { code: 'rb0', name: 'Rebar sentinel', price: 3000, changePercent: 1 }],
      ['t0', { code: 't0', name: 'Treasury sentinel', price: 100, changePercent: 1 }]
    ]);
  });
  await page.getByRole('button', { name: '▶ 启用定时语音播报' }).click();
  expect(await page.evaluate(() => window.reviewSpoken)).toEqual([expect.stringContaining('Rebar sentinel')]);
  await page.clock.runFor(31000);
  await expect(page.getByRole('button', { name: '⏸ 停用定时语音播报' })).toBeVisible();
  await page.clock.setSystemTime(new Date('2026-09-09T23:01:00+08:00'));
  await page.clock.runFor(31000);
  expect(await page.evaluate(async () => (await import('/src/js/app.js'))._internal().state.voicePausedBySchedule)).toBe(true);
  // 收盘提示后面紧跟一轮「用户选中字段」的最终快照。整段夜盘 rb0 报价没变过（一直静默），
  // 所以这一条同时证明：确实补播了、且确实绕过了去重（否则这条会缺席）。
  expect(await page.evaluate(() => window.reviewSpoken.slice(-2)))
    .toEqual(['已收盘', expect.stringContaining('Rebar sentinel')]);
  await page.getByRole('button', { name: '⏸ 停用定时语音播报' }).click();
  await page.clock.setSystemTime(new Date('2026-09-10T09:30:00+08:00'));
  await page.clock.runFor(31000);
  await expect(page.getByRole('button', { name: '▶ 启用定时语音播报' })).toBeVisible();
  await page.evaluate(async () => (await import('/src/js/app.js')).stopApp());
  const before = await page.evaluate(() => window.reviewSpoken.length);
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => window.reviewSpoken.length)).toBe(before);
});
