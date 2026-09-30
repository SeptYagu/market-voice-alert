import { test, expect } from '@playwright/test';
import { setupApiMocks, clearLocalStorage, stubWebSpeech, stubNotification } from './helpers.js';

for (const surface of ['monitor', 'limit-up']) {
  test(`${surface}: period changes preserve intraday DOM, instance, history and requests`, async ({ page }) => {
    await clearLocalStorage(page);
    await stubWebSpeech(page);
    await stubNotification(page);
    await setupApiMocks(page);
    await page.route('**/api/eastmoney-kline/qt/stock/kline/get**', route => {
      const minute = Number(new URL(route.request().url()).searchParams.get('klt')) < 100;
      return route.fulfill({ json: { rc: 0, data: { code: '600519', market: 1, name: 'fixture',
        klines: [minute ? '2026-06-05 10:00,100,101,102,99,200,20100,0,1' : '2026-06-05,100,101,102,99,200,20100,0,1'] } } });
    });
    await page.goto(surface === 'monitor' ? '/' : '/#/limit-up');
    if (surface === 'monitor') {
      await page.fill('#code-input', 'sh600519,sz000858');
      await page.press('#code-input', 'Enter');
    }
    const prefix = surface === 'monitor' ? '' : 'lu-';
    await expect(page.locator('tr[data-code="sh600519"]')).toBeVisible();
    await page.locator(surface === 'monitor' ? 'tr[data-code="sh600519"] td.code' : 'tr[data-code="sh600519"]').click();
    await expect(page.locator(`#${prefix}chart-status-sh600519`)).toContainText('根');
    await expect(page.locator(`#${prefix}intraday-status-sh600519`)).toContainText('点');
    if (surface === 'monitor') {
      await page.locator('tr[data-code="sz000858"] td.code').click();
      await expect(page.locator('#chart-status-sz000858')).toContainText('根');
      await expect(page.locator('#intraday-status-sz000858')).toContainText('点');
    }
    await page.evaluate(async ({ surface, prefix }) => {
      const app = await import('/src/js/app.js');
      const state = app._internal().state;
      state.autoRefreshEnabled = false;
      state.limitUp.autoRefreshEnabled = false;
      app._internal().monitorCtrl.stopTimer(); app.limitUpCtrl.stopTimer();
      const mgr = surface === 'monitor' ? app.monitorChartMgr : app.limitUpChartMgr;
      const inst = mgr.getInst('sh600519');
      inst.manualTradeDate = true;
      await mgr.loadIntraday('sh600519', '2026-06-04');
      const original = mgr.loadIntraday.bind(mgr);
      const saved = { mgr, inst, intraday: inst.intradayData, abort: inst.intradayAbort, loads: 0,
        host: document.getElementById(`${prefix}intraday-chart-host-sh600519`),
        root: document.getElementById(`${prefix}intraday-chart-host-sh600519`).firstElementChild,
        ctl: mgr.intradayCtlMap.get('sh600519'), otherCtl: mgr.klineCtlMap.get('sz000858'),
        otherHost: document.getElementById('chart-host-sz000858') };
      mgr.loadIntraday = (...args) => { saved.loads++; return original(...args); };
      window.periodIsolation = saved;
    }, { surface, prefix });

    const chartRow = page.locator(`tr[data-chart-for="sh600519"]`);
    await chartRow.locator('[data-period="5m"]').click();
    await expect(page.locator(`#${prefix}chart-status-sh600519`)).toContainText('5分');
    await chartRow.locator('[data-period="15m"]').click();
    await expect(page.locator(`#${prefix}chart-status-sh600519`)).toContainText('15分');
    expect(await page.evaluate(({ prefix }) => {
      const s = window.periodIsolation;
      const inst = s.mgr.getInst('sh600519');
      return { sameState: s.inst === inst, date: inst.selectedTradeDate, manual: inst.manualTradeDate,
        sameData: inst.intradayData === s.intraday, sameAbort: inst.intradayAbort === s.abort,
        sameHost: document.getElementById(`${prefix}intraday-chart-host-sh600519`) === s.host,
        sameRoot: s.host.firstElementChild === s.root, sameCtl: s.mgr.intradayCtlMap.get('sh600519') === s.ctl,
        otherSame: s.mgr.klineCtlMap.get('sz000858') === s.otherCtl && document.getElementById('chart-host-sz000858') === s.otherHost,
        loads: s.loads, high: inst.klineData.items.at(-1).high, low: inst.klineData.items.at(-1).low };
    }, { prefix })).toEqual({ sameState: true, date: '2026-06-04', manual: true, sameData: true,
      sameAbort: true, sameHost: true, sameRoot: true, sameCtl: true, otherSame: true, loads: 0, high: 102, low: 99 });
  });
}
