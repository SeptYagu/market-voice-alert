// e2e helper: 启动 dev server + 拦截 mock + 清理 localStorage
import iconv from 'iconv-lite';
import { TENCENT_QUOTES_BODY_3 } from './fixtures/tencent-quotes.js';
import { EASTMONEY_KLINE_BODY_SH600519 } from './fixtures/eastmoney-kline.js';
import {
  AKTOOLS_INTRADAY_TICKS_SH600519,
  AKTOOLS_HIST_MINUTE_SH600519,
  EASTMONEY_TRENDS_BODY_SH600519
} from './fixtures/intraday.js';
import {
  LIMIT_UP_BODY,
  LIMIT_UP_BROKEN_BODY,
  LIMIT_UP_REASONS_BODY
} from './fixtures/limits-up.js';
import {
  parseAktoolsIntradayTicks,
  parseAktoolsHistMinuteList,
  parseAktoolsLimitUpList,
  parseAktoolsLimitUpReasonList
} from '../src/js/aktoolsApi.js';

const TRADE_DATES = [
  '2026-06-03',
  '2026-06-04',
  '2026-06-05',
  '2026-06-08'
];

export async function setupApiMocks(page) {
  // 服务端共享缓存接口：前端现在优先访问这些路径。
  // e2e 里直接返回解析后的前端数据结构，避免测试受本机真实缓存/后端状态影响。
  await page.route('**/api/cache/calendar/trade-dates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { dates: TRADE_DATES }
      })
    });
  });

  await page.route('**/api/cache/intraday**', async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get('date') || '2026-06-05';
    const common = {
      code: url.searchParams.get('code') || 'sh600519',
      name: url.searchParams.get('name') || '贵州茅台',
      date,
      prevClose: Number(url.searchParams.get('prevClose')) || 1975
    };
    const allowLatest = url.searchParams.get('allowLatestTickSource') !== '0';
    const data = allowLatest
      ? parseAktoolsIntradayTicks(AKTOOLS_INTRADAY_TICKS_SH600519, common)
      : parseAktoolsHistMinuteList(AKTOOLS_HIST_MINUTE_SH600519, common);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data
      })
    });
  });

  await page.route('**/api/cache/spot/latest**', async (route) => {
    const items = parseAktoolsLimitUpList(LIMIT_UP_BODY, 'limitUp');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { items, count: items.length }
      })
    });
  });

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
          universeSize: 3,
          scanned: 3,
          items: []
        }
      })
    });
  });

  await page.route('**/api/cache/limit-up/reasons**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { reasons: parseAktoolsLimitUpReasonList(LIMIT_UP_REASONS_BODY) }
      })
    });
  });

  await page.route('**/api/cache/limit-up**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          limitUpItems: parseAktoolsLimitUpList(LIMIT_UP_BODY, 'limitUp'),
          brokenItems: parseAktoolsLimitUpList(LIMIT_UP_BROKEN_BODY, 'broken')
        }
      })
    });
  });

  // K 线共享缓存在 e2e 中关闭，快速走下方已有 Eastmoney fixture。
  await page.route('**/api/cache/kline**', async (route) => {
    await route.fulfill({ status: 404, body: 'mock shared kline disabled' });
  });

  // 实时行情 (Tencent) - 真实 API 返回 GBK 编码的 JS
  await page.route('**/api/tencent**', async (route) => {
    const gbkBytes = iconv.encode(TENCENT_QUOTES_BODY_3, 'gbk');
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=GBK',
      body: gbkBytes
    });
  });

  // 东财 direct 分时备用源；必须放在 generic eastmoney-kline route 前面
  await page.route('**/api/eastmoney-kline/qt/stock/trends2/get**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EASTMONEY_TRENDS_BODY_SH600519)
    });
  });

  // K 线 (Eastmoney)
  await page.route('**/api/eastmoney-kline**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EASTMONEY_KLINE_BODY_SH600519)
    });
  });

  // 实时行情备 (Eastmoney) - 返回 404 强制走 Tencent
  await page.route('**/api/eastmoney/qt/**', async (route) => {
    await route.fulfill({ status: 404, body: 'mocked fallback disabled' });
  });

  // AKTools 涨停池 (stock_zt_pool_em)
  await page.route('**/api/aktools/api/public/stock_zt_pool_em**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(LIMIT_UP_BODY)
    });
  });

  // AKTools 交易日历
  await page.route('**/api/aktools/api/public/tool_trade_date_hist_sina**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        ...TRADE_DATES.map((trade_date) => ({ trade_date }))
      ])
    });
  });

  // AKTools 炸板池 (stock_zt_pool_zbgc_em)
  await page.route('**/api/aktools/api/public/stock_zt_pool_zbgc_em**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(LIMIT_UP_BROKEN_BODY)
    });
  });

  // AKTools 龙虎榜 (stock_lhb_detail_em) — "上榜原因" + "解读"
  await page.route('**/api/aktools/api/public/stock_lhb_detail_em**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(LIMIT_UP_REASONS_BODY)
    });
  });

  // AKTools 分时成交明细：包含 09:15 集合竞价点
  await page.route('**/api/aktools/api/public/stock_intraday_em**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(AKTOOLS_INTRADAY_TICKS_SH600519)
    });
  });

  // AKTools 历史 1 分钟备用源
  await page.route('**/api/aktools/api/public/stock_zh_a_hist_min_em**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(AKTOOLS_HIST_MINUTE_SH600519)
    });
  });

  // 旧路径兜底 - 防止任何漏改的代码打到东财
  await page.route('**/api/limit-up/qt/clist/get**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 0, diff: [] } })
    });
  });
  await page.route('**/api/limit-up-stock**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} })
    });
  });

  // Sina 期货 (返回空 var)
  await page.route('**/api/sina**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    });
  });
}

export async function clearLocalStorage(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__test_cleared__')) return;
    sessionStorage.setItem('__test_cleared__', '1');
    try { localStorage.clear(); } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
    sessionStorage.setItem('__test_cleared__', '1');
  });
}

export async function stubWebSpeech(page) {
  await page.addInitScript(() => {
    if (typeof window !== 'undefined' && !window.speechSynthesis) {
      Object.defineProperty(window, 'speechSynthesis', { value: undefined, writable: true });
    }
  });
}

export async function stubNotification(page) {
  await page.addInitScript(() => {
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'Notification', { value: undefined, writable: true });
    }
  });
}

export const DEFAULT_TIMEOUT = 15_000;
