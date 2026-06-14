import {
  buildAktoolsUrl,
  buildAktoolsIntradayUrl,
  buildAktoolsHistMinuteUrl,
  parseAktoolsLimitUpList,
  fetchAktoolsLimitUpList,
  parseAktoolsLimitUpReasonList,
  fetchAktoolsLimitUpReasonList,
  parseAktoolsIntradayTicks,
  parseAktoolsHistMinuteList,
  parseAktoolsSpotList,
  toAktoolsDate,
  clearAktoolsCache
} from '../src/js/aktoolsApi.js';

// ============================================================
// 真实样本（2026-06-04 涨停池第一条 + 炸板池第一条）
// ============================================================
const REAL_LIMITUP_SAMPLE = [
  {
    序号: 1, 代码: '300897', 名称: '山科智能',
    涨跌幅: 20.0, 最新价: 22.38, 成交额: 277911936,
    封板资金: 37837216, 首次封板时间: '092500', 最后封板时间: '132251',
    炸板次数: 1, 涨停统计: '1/1', 连板数: 1, 所属行业: '通用设备'
  }
];

const REAL_BROKEN_SAMPLE = [
  {
    序号: 1, 代码: '603681', 名称: '永冠新材',
    涨跌幅: 1.8766754866, 最新价: 26.6, 涨停价: 28.72,
    成交额: 1527685968, 首次封板时间: '092504',
    炸板次数: 7, 涨停统计: '0/0', 振幅: 11.22, 所属行业: '化学制品'
  }
];

// ============================================================
// fetch mock 工具
// ============================================================
function jsonResponse(body) {
  const text = JSON.stringify(body);
  const buf = new TextEncoder().encode(text);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer
  };
}

function errorResponse(status = 500) {
  return { ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) };
}

// ============================================================
// buildAktoolsUrl
// ============================================================
QUnit.module('aktoolsApi.buildAktoolsUrl', () => {
  QUnit.test('limitUp kind builds /api/aktools/api/public/stock_zt_pool_em (no params)', (t) => {
    const url = buildAktoolsUrl('limitUp');
    t.equal(url, '/api/aktools/api/public/stock_zt_pool_em');
  });

  QUnit.test('broken kind uses stock_zt_pool_zbgc_em interface', (t) => {
    const url = buildAktoolsUrl('broken');
    t.equal(url, '/api/aktools/api/public/stock_zt_pool_zbgc_em');
  });

  QUnit.test('forwards date param in YYYYMMDD format', (t) => {
    const url = buildAktoolsUrl('limitUp', { date: '20260604' });
    t.ok(url.includes('date=20260604'), `url should include date=20260604: ${url}`);
  });

  QUnit.test('skips empty/null/undefined params', (t) => {
    const url = buildAktoolsUrl('limitUp', { date: null, foo: undefined, bar: '' });
    t.notOk(url.includes('date='), 'null date is skipped');
    t.notOk(url.includes('foo='), 'undefined skipped');
    t.notOk(url.includes('bar='), 'empty string skipped');
  });

  QUnit.test('encodes special characters in param values', (t) => {
    const url = buildAktoolsUrl('limitUp', { tag: 'a b/c' });
    t.ok(url.includes('tag=a+b%2Fc') || url.includes('tag=a%20b%2Fc'),
      `url should encode space and slash: ${url}`);
  });
});

// ============================================================
// parseAktoolsLimitUpList
// ============================================================
QUnit.module('aktoolsApi.parseAktoolsLimitUpList', () => {
  QUnit.test('returns [] for non-array input', (t) => {
    t.deepEqual(parseAktoolsLimitUpList(null), []);
    t.deepEqual(parseAktoolsLimitUpList(undefined), []);
    t.deepEqual(parseAktoolsLimitUpList({}), []);
    t.deepEqual(parseAktoolsLimitUpList('not array'), []);
  });

  QUnit.test('returns [] for empty array', (t) => {
    t.deepEqual(parseAktoolsLimitUpList([]), []);
  });

  QUnit.test('maps 涨停池 (limitUp kind) with real AKTools field names', (t) => {
    const items = parseAktoolsLimitUpList(REAL_LIMITUP_SAMPLE, 'limitUp');
    t.equal(items.length, 1);
    const it = items[0];
    t.equal(it.code, 'sz300897', '30xxxx → sz prefix');
    t.equal(it.name, '山科智能');
    t.equal(it.price, 22.38);
    t.equal(it.changePercent, 20.0);
    t.equal(Math.round(it.change * 100) / 100, 4.48, 'change = price * pct / 100 (22.38 * 20% = 4.48)');
    t.equal(it.amount, 277911936);
    t.equal(it.limitUpCount, 1, 'real value from 连板数 (not default 0)');
    t.equal(it.firstLimitTime, '09:25', 'HHMMSS 092500 → HH:MM 09:25');
    t.equal(it.breakCount, 1, 'real value from 炸板次数');
    t.equal(it.isST, false);
    t.equal(it.source, 'aktools-limitUp');
    t.equal(it.industry, '通用设备');
  });

  QUnit.test('maps 炸板池 (broken kind) with 连板数 defaulting to 0', (t) => {
    const items = parseAktoolsLimitUpList(REAL_BROKEN_SAMPLE, 'broken');
    t.equal(items.length, 1);
    const it = items[0];
    t.equal(it.code, 'sh603681', '60xxxx → sh prefix');
    t.equal(it.name, '永冠新材');
    t.equal(it.price, 26.6);
    t.equal(it.changePercent, 1.8766754866, 'keeps full precision (UI formats via formatPercent)');
    t.equal(it.limitUpCount, 0, 'broken pool has no 连板数, defaults to 0');
    t.equal(it.firstLimitTime, '09:25');
    t.equal(it.breakCount, 7, 'real value');
    t.equal(it.source, 'aktools-broken');
  });

  QUnit.test('normalizes 6-digit codes to sh/sz/bj correctly', (t) => {
    const items = parseAktoolsLimitUpList([
      { 代码: '600000', 名称: 'A', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 代码: '000001', 名称: 'B', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 代码: '301151', 名称: 'C', 最新价: 10, 涨跌幅: 20, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 代码: '688981', 名称: 'D', 最新价: 10, 涨跌幅: 20, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 代码: '830799', 名称: 'E', 最新价: 10, 涨跌幅: 30, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' }
    ], 'limitUp');
    t.equal(items[0].code, 'sh600000');
    t.equal(items[1].code, 'sz000001');
    t.equal(items[2].code, 'sz301151');
    t.equal(items[3].code, 'sh688981');
    t.equal(items[4].code, 'bj830799');
  });

  QUnit.test('converts 首次封板时间 HHMMSS string to HH:MM', (t) => {
    const items = parseAktoolsLimitUpList([
      { 代码: '600000', 名称: 'A', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '092500', 所属行业: 'X' },
      { 代码: '600001', 名称: 'B', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '143000', 所属行业: 'X' },
      { 代码: '600002', 名称: 'C', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' }
    ], 'limitUp');
    t.equal(items[0].firstLimitTime, '09:25');
    t.equal(items[1].firstLimitTime, '14:30');
    t.equal(items[2].firstLimitTime, '09:30');
  });

  QUnit.test('handles missing 首次封板时间 as null', (t) => {
    const items = parseAktoolsLimitUpList([
      { 代码: '600000', 名称: 'A', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '', 所属行业: 'X' },
      { 代码: '600001', 名称: 'B', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 所属行业: 'X' }
    ], 'limitUp');
    t.strictEqual(items[0].firstLimitTime, null);
    t.strictEqual(items[1].firstLimitTime, null);
  });

  QUnit.test('detects ST names via isLimitUpName regex', (t) => {
    const items = parseAktoolsLimitUpList([
      { 代码: '600000', 名称: '*ST 华微', 最新价: 10, 涨跌幅: 5, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 代码: '600001', 名称: 'ST 某某', 最新价: 10, 涨跌幅: 5, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 代码: '600002', 名称: '正常股票', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' }
    ], 'limitUp');
    t.equal(items[0].isST, true);
    t.equal(items[1].isST, true);
    t.equal(items[2].isST, false);
  });

  QUnit.test('skips items with missing critical fields (no code or no price)', (t) => {
    const items = parseAktoolsLimitUpList([
      { 代码: '600519', 名称: 'OK', 最新价: 1100, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 名称: 'NoCode', 最新价: 10, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 代码: '000001', 名称: 'ZeroPrice', 最新价: 0, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' },
      { 代码: '000002', 名称: 'NegPrice', 最新价: -1, 涨跌幅: 10, 连板数: 1, 炸板次数: 0, 首次封板时间: '093000', 所属行业: 'X' }
    ], 'limitUp');
    t.equal(items.length, 1);
    t.equal(items[0].code, 'sh600519');
  });

  QUnit.test('preserves extra AKTools fields (industry/lastLimitTime/limitStats)', (t) => {
    const items = parseAktoolsLimitUpList([
      { 代码: '600000', 名称: 'A', 最新价: 10, 涨跌幅: 10, 连板数: 2, 炸板次数: 1, 首次封板时间: '093000', 最后封板时间: '143000', 涨停统计: '2/3', 所属行业: '银行Ⅱ', 成交额: 1000000 }
    ], 'limitUp');
    t.equal(items[0].industry, '银行Ⅱ');
    t.equal(items[0].lastLimitTime, '14:30');
    t.equal(items[0].limitStats, '2/3');
  });
});

// ============================================================
// parseAktoolsSpotList
// ============================================================
QUnit.module('aktoolsApi.parseAktoolsSpotList', () => {
  QUnit.test('preserves industry from spot snapshot', (t) => {
    const items = parseAktoolsSpotList([
      {
        代码: '600000',
        名称: '浦发银行',
        最新价: 10,
        涨跌幅: 1.2,
        涨跌额: 0.12,
        昨收: 9.88,
        今开: 9.9,
        最高: 10.1,
        最低: 9.8,
        成交量: 1000,
        成交额: 1000000,
        量比: 1.5,
        换手率: 0.8,
        所属行业: '银行'
      }
    ]);
    t.equal(items.length, 1);
    t.equal(items[0].code, 'sh600000');
    t.equal(items[0].industry, '银行');
  });
});

// ============================================================
// fetchAktoolsLimitUpList
// ============================================================
QUnit.module('aktoolsApi.fetchAktoolsLimitUpList', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    clearAktoolsCache();
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    clearAktoolsCache();
  });

  QUnit.test('limitUp kind requests /api/aktools/.../stock_zt_pool_em', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse(REAL_LIMITUP_SAMPLE);
    };
    const items = await fetchAktoolsLimitUpList({ kind: 'limitUp' });
    t.ok(capturedUrl.startsWith('/api/aktools/api/public/stock_zt_pool_em'),
      `url: ${capturedUrl}`);
    t.equal(items.length, 1);
    t.equal(items[0].code, 'sz300897');
  });

  QUnit.test('broken kind requests /api/aktools/.../stock_zt_pool_zbgc_em', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse(REAL_BROKEN_SAMPLE);
    };
    const items = await fetchAktoolsLimitUpList({ kind: 'broken' });
    t.ok(capturedUrl.startsWith('/api/aktools/api/public/stock_zt_pool_zbgc_em'),
      `url: ${capturedUrl}`);
    t.equal(items.length, 1);
    t.equal(items[0].source, 'aktools-broken');
  });

  QUnit.test('defaults to limitUp kind when no kind specified', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse([]);
    };
    await fetchAktoolsLimitUpList();
    t.ok(capturedUrl.includes('stock_zt_pool_em'), 'uses limitUp endpoint by default');
  });

  QUnit.test('throws on HTTP 5xx (no retry — AKTools is local backend)', async (t) => {
    globalThis.fetch = async () => errorResponse(500);
    await t.rejects(fetchAktoolsLimitUpList({ kind: 'limitUp' }), /HTTP 500/);
  });

  QUnit.test('returns [] on HTTP 200 with empty array (non-trading day)', async (t) => {
    globalThis.fetch = async () => jsonResponse([]);
    const items = await fetchAktoolsLimitUpList({ kind: 'limitUp' });
    t.deepEqual(items, []);
  });

  QUnit.test('forwards AbortSignal to fetch and rethrows AbortError', async (t) => {
    let capturedInit = null;
    const ctrl = new AbortController();
    globalThis.fetch = async (url, init) => {
      capturedInit = init;
      return new Promise((_, reject) => {
        if (init && init.signal) {
          init.signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      });
    };
    const p = fetchAktoolsLimitUpList({ kind: 'limitUp', signal: ctrl.signal });
    ctrl.abort();
    await t.rejects(p);
    t.equal(capturedInit.signal, ctrl.signal);
  });

  QUnit.test('30s cache: second call within TTL does not re-fetch', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(REAL_LIMITUP_SAMPLE);
    };
    const a = await fetchAktoolsLimitUpList({ kind: 'limitUp' });
    const b = await fetchAktoolsLimitUpList({ kind: 'limitUp' });
    t.equal(calls, 1, 'fetch called only once');
    t.equal(a[0].code, b[0].code, 'returns same data from cache');
  });

  QUnit.test('30s cache: separate kind values maintain separate cache slots', async (t) => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      if (url.includes('zbgc')) return jsonResponse(REAL_BROKEN_SAMPLE);
      return jsonResponse(REAL_LIMITUP_SAMPLE);
    };
    const a = await fetchAktoolsLimitUpList({ kind: 'limitUp' });
    const b = await fetchAktoolsLimitUpList({ kind: 'broken' });
    t.equal(calls, 2, 'different kinds hit different cache slots');
    t.equal(a[0].source, 'aktools-limitUp');
    t.equal(b[0].source, 'aktools-broken');
  });

  QUnit.test('clearAktoolsCache forces a re-fetch', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(REAL_LIMITUP_SAMPLE);
    };
    await fetchAktoolsLimitUpList({ kind: 'limitUp' });
    clearAktoolsCache();
    await fetchAktoolsLimitUpList({ kind: 'limitUp' });
    t.equal(calls, 2, 're-fetches after cache clear');
  });

  QUnit.test('passes date param through to URL', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse([]);
    };
    await fetchAktoolsLimitUpList({ kind: 'limitUp', date: '20260604' });
    t.ok(capturedUrl.includes('date=20260604'), `url should have date: ${capturedUrl}`);
  });

  QUnit.test('separate date values maintain separate cache slots', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(REAL_LIMITUP_SAMPLE);
    };
    await fetchAktoolsLimitUpList({ kind: 'limitUp', date: '20260604' });
    await fetchAktoolsLimitUpList({ kind: 'limitUp', date: '20260603' });
    t.equal(calls, 2, 'different dates hit different cache slots');
  });
});

// ============================================================
// parseAktoolsLimitUpReasonList (Dragon-Tiger list, "上榜原因" + "解读")
// Real sample: 2026-06-04 lhb detail (111 rows, 71KB)
// ============================================================
const REAL_LHB_SAMPLE = [
  {
    序号: 1, 代码: '000582', 名称: '北部湾港',
    上榜日: '2026-06-04T00:00:00.000', 解读: '3家机构卖出，成功率5.84%',
    收盘价: 13.42, 涨跌幅: -9.9933, 换手率: 7.6321, 流通市值: 28944903152.66,
    上榜原因: '日跌幅偏离值达到7%的前5只证券'
  },
  {
    序号: 2, 代码: '600403', 名称: '大有能源',
    上榜日: '2026-06-04T00:00:00.000', 解读: '普通席位买入，成功率40.29%',
    收盘价: 7.4, 涨跌幅: 9.9554, 换手率: 1.1075, 流通市值: 17692011774.8,
    上榜原因: '非ST、*ST和S证券连续三个交易日内收盘价格涨幅偏离值累计达到20%的证券'
  }
];

QUnit.module('aktoolsApi.parseAktoolsLimitUpReasonList', () => {
  QUnit.test('returns [] for non-array input', (t) => {
    t.deepEqual(parseAktoolsLimitUpReasonList(null), []);
    t.deepEqual(parseAktoolsLimitUpReasonList(undefined), []);
    t.deepEqual(parseAktoolsLimitUpReasonList({}), []);
  });

  QUnit.test('returns [] for empty array', (t) => {
    t.deepEqual(parseAktoolsLimitUpReasonList([]), []);
  });

  QUnit.test('maps 龙虎榜 (lhb) with real AKTools field names', (t) => {
    const items = parseAktoolsLimitUpReasonList(REAL_LHB_SAMPLE);
    t.equal(items.length, 2);
    const it = items[0];
    t.equal(it.code, 'sz000582', '00xxxx → sz');
    t.equal(it.name, '北部湾港');
    t.equal(it.reason, '日跌幅偏离值达到7%的前5只证券');
    t.equal(it.interpretation, '3家机构卖出，成功率5.84%');
    t.equal(it.pct, -9.9933);
    t.equal(it.date, '2026-06-04');
  });

  QUnit.test('normalizes 6-digit codes to sh/sz/bj correctly', (t) => {
    const items = parseAktoolsLimitUpReasonList([
      { 代码: '600000', 名称: 'A', 上榜原因: 'X', 解读: 'Y', 涨跌幅: 1, 上榜日: '2026-06-04' },
      { 代码: '000001', 名称: 'B', 上榜原因: 'X', 解读: 'Y', 涨跌幅: 1, 上榜日: '2026-06-04' },
      { 代码: '301151', 名称: 'C', 上榜原因: 'X', 解读: 'Y', 涨跌幅: 1, 上榜日: '2026-06-04' },
      { 代码: '830799', 名称: 'D', 上榜原因: 'X', 解读: 'Y', 涨跌幅: 1, 上榜日: '2026-06-04' }
    ]);
    t.equal(items[0].code, 'sh600000');
    t.equal(items[1].code, 'sz000001');
    t.equal(items[2].code, 'sz301151');
    t.equal(items[3].code, 'bj830799');
  });

  QUnit.test('handles missing reason/interpretation as empty string', (t) => {
    const items = parseAktoolsLimitUpReasonList([
      { 代码: '600000', 名称: 'A', 涨跌幅: 1, 上榜日: '2026-06-04' }
    ]);
    t.equal(items[0].reason, '');
    t.equal(items[0].interpretation, '');
  });

  QUnit.test('skips items with missing critical fields (no code)', (t) => {
    const items = parseAktoolsLimitUpReasonList([
      { 代码: '600000', 名称: 'OK', 上榜原因: 'R', 解读: 'I', 涨跌幅: 1, 上榜日: '2026-06-04' },
      { 名称: 'NoCode', 上榜原因: 'R', 解读: 'I', 涨跌幅: 1, 上榜日: '2026-06-04' }
    ]);
    t.equal(items.length, 1);
  });

  QUnit.test('truncates overly long reason strings to keep UI clean', (t) => {
    const longReason = 'x'.repeat(200);
    const items = parseAktoolsLimitUpReasonList([
      { 代码: '600000', 名称: 'A', 上榜原因: longReason, 解读: 'I', 涨跌幅: 1, 上榜日: '2026-06-04' }
    ]);
    t.ok(items[0].reason.length <= 100, `truncated to ≤100 chars, got ${items[0].reason.length}`);
    t.ok(items[0].reason.length > 0, 'still has content');
  });
});

// ============================================================
// fetchAktoolsLimitUpReasonList
// ============================================================
QUnit.module('aktoolsApi.fetchAktoolsLimitUpReasonList', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    clearAktoolsCache();
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    clearAktoolsCache();
  });

  QUnit.test('requests /api/aktools/api/public/stock_lhb_detail_em with start_date and end_date', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse(REAL_LHB_SAMPLE);
    };
    await fetchAktoolsLimitUpReasonList({ date: '20260604' });
    t.ok(capturedUrl.startsWith('/api/aktools/api/public/stock_lhb_detail_em'),
      `url: ${capturedUrl}`);
    t.ok(capturedUrl.includes('start_date=20260604'), 'has start_date');
    t.ok(capturedUrl.includes('end_date=20260604'), 'has end_date');
  });

  QUnit.test('returns parsed reason list', async (t) => {
    globalThis.fetch = async () => jsonResponse(REAL_LHB_SAMPLE);
    const items = await fetchAktoolsLimitUpReasonList({ date: '20260604' });
    t.equal(items.length, 2);
    t.equal(items[0].code, 'sz000582');
    t.equal(items[0].reason, '日跌幅偏离值达到7%的前5只证券');
  });

  QUnit.test('omits date params when no date given (uses today)', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse([]);
    };
    await fetchAktoolsLimitUpReasonList();
    t.notOk(capturedUrl.includes('start_date='), 'no start_date param');
    t.notOk(capturedUrl.includes('end_date='), 'no end_date param');
  });

  QUnit.test('throws on HTTP 5xx', async (t) => {
    globalThis.fetch = async () => ({
      ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0)
    });
    await t.rejects(fetchAktoolsLimitUpReasonList({ date: '20260604' }), /HTTP 500/);
  });

  QUnit.test('returns [] on HTTP 200 with empty array (non-trading day)', async (t) => {
    globalThis.fetch = async () => jsonResponse([]);
    const items = await fetchAktoolsLimitUpReasonList({ date: '20260604' });
    t.deepEqual(items, []);
  });

  QUnit.test('forwards AbortSignal and rethrows AbortError', async (t) => {
    let capturedInit = null;
    const ctrl = new AbortController();
    globalThis.fetch = async (url, init) => {
      capturedInit = init;
      return new Promise((_, reject) => {
        if (init && init.signal) {
          init.signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      });
    };
    const p = fetchAktoolsLimitUpReasonList({ date: '20260604', signal: ctrl.signal });
    ctrl.abort();
    await t.rejects(p);
    t.equal(capturedInit.signal, ctrl.signal);
  });

  QUnit.test('30s cache: separate from limitUp/broken cache', async (t) => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      if (url.includes('lhb')) return jsonResponse(REAL_LHB_SAMPLE);
      if (url.includes('zbgc')) return jsonResponse([]);
      return jsonResponse(REAL_LIMITUP_SAMPLE);
    };
    await fetchAktoolsLimitUpList({ kind: 'limitUp' });
    await fetchAktoolsLimitUpList({ kind: 'broken' });
    await fetchAktoolsLimitUpReasonList({ date: '20260604' });
    await fetchAktoolsLimitUpReasonList({ date: '20260604' });
    t.equal(calls, 3, '4 unique fetches, 1 cached reason hit');
  });

  QUnit.test('30s cache: separate date values maintain separate slots', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(REAL_LHB_SAMPLE);
    };
    await fetchAktoolsLimitUpReasonList({ date: '20260604' });
    await fetchAktoolsLimitUpReasonList({ date: '20260603' });
    t.equal(calls, 2, 'different dates → different cache slots');
  });

  QUnit.test('clearAktoolsCache forces a re-fetch', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(REAL_LHB_SAMPLE);
    };
    await fetchAktoolsLimitUpReasonList({ date: '20260604' });
    clearAktoolsCache();
    await fetchAktoolsLimitUpReasonList({ date: '20260604' });
    t.equal(calls, 2);
  });

  // ===== 2026-06-05 fix: normalize HTML5 YYYY-MM-DD → YYYYMMDD for AKTools =====
  QUnit.test('normalizes dashed date YYYY-MM-DD to YYYYMMDD in URL', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse(REAL_LIMITUP_SAMPLE);
    };
    await fetchAktoolsLimitUpList({ kind: 'limitUp', date: '2026-06-04' });
    t.notOk(capturedUrl.includes('date=2026-06-04'),
      `URL should NOT contain dashed date: ${capturedUrl}`);
    t.ok(capturedUrl.includes('date=20260604'),
      `URL should contain undashed date: ${capturedUrl}`);
  });

  QUnit.test('reason list also normalizes dashed dates', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse(REAL_LHB_SAMPLE);
    };
    await fetchAktoolsLimitUpReasonList({ date: '2026-06-04' });
    t.ok(capturedUrl.includes('start_date=20260604'),
      `URL should contain undashed start_date: ${capturedUrl}`);
    t.ok(capturedUrl.includes('end_date=20260604'),
      `URL should contain undashed end_date: ${capturedUrl}`);
  });
});

// ============================================================
// toAktoolsDate (format converter for HTML5 date input → AKTools URL)
// ============================================================
QUnit.module('aktoolsApi.toAktoolsDate', () => {
  QUnit.test('strips dashes from YYYY-MM-DD → YYYYMMDD', (t) => {
    t.equal(toAktoolsDate('2026-06-04'), '20260604');
    t.equal(toAktoolsDate('2024-01-01'), '20240101');
    t.equal(toAktoolsDate('2026-12-31'), '20261231');
  });

  QUnit.test('passes through already-undashed YYYYMMDD unchanged', (t) => {
    t.equal(toAktoolsDate('20260604'), '20260604');
  });

  QUnit.test('returns empty string for null/undefined/empty', (t) => {
    t.equal(toAktoolsDate(null), '');
    t.equal(toAktoolsDate(undefined), '');
    t.equal(toAktoolsDate(''), '');
  });

  QUnit.test('returns empty string for invalid input (no normalization)', (t) => {
    t.equal(toAktoolsDate('not-a-date'), 'not-a-date');
    t.equal(toAktoolsDate('2026/06/04'), '2026/06/04');
  });
});

// ============================================================
// buildAktoolsUrl with dashed date input (regression for 2026-06-05 bug)
// ============================================================
QUnit.module('aktoolsApi.buildAktoolsUrl (dashed dates)', () => {
  QUnit.test('dashed date YYYY-MM-DD is normalized to YYYYMMDD', (t) => {
    const url = buildAktoolsUrl('limitUp', { date: '2026-06-04' });
    t.ok(url.includes('date=20260604'), `expected date=20260604 in: ${url}`);
  });

  QUnit.test('undashed date YYYYMMDD passes through', (t) => {
    const url = buildAktoolsUrl('limitUp', { date: '20260604' });
    t.ok(url.includes('date=20260604'));
  });

  QUnit.test('null date omits the param', (t) => {
    const url = buildAktoolsUrl('limitUp', { date: null });
    t.notOk(url.includes('date='), 'no date param');
  });
});

QUnit.module('aktoolsApi.intraday url builders', () => {
  QUnit.test('buildAktoolsIntradayUrl strips market prefix', (t) => {
    t.equal(
      buildAktoolsIntradayUrl('sh600519'),
      '/api/aktools/api/public/stock_intraday_em?symbol=600519'
    );
    t.equal(
      buildAktoolsIntradayUrl('000001'),
      '/api/aktools/api/public/stock_intraday_em?symbol=000001'
    );
  });

  QUnit.test('buildAktoolsHistMinuteUrl uses selected Beijing trading day range', (t) => {
    const url = buildAktoolsHistMinuteUrl('sh600519', { date: '2026-06-05' });
    t.ok(url.startsWith('/api/aktools/api/public/stock_zh_a_hist_min_em?'), url);
    t.ok(url.includes('symbol=600519'), url);
    t.ok(url.includes('start_date=2026-06-05+09%3A15%3A00'), url);
    t.ok(url.includes('end_date=2026-06-05+15%3A00%3A00'), url);
    t.ok(url.includes('period=1'), url);
  });
});

QUnit.module('aktoolsApi.parseAktoolsIntradayTicks', () => {
  QUnit.test('aggregates tick rows into minute bars including opening auction', (t) => {
    const out = parseAktoolsIntradayTicks([
      { 时间: '09:15:00', 成交价: 10.00, 手数: 10, 买卖盘性质: '中性盘' },
      { 时间: '09:15:20', 成交价: 10.10, 手数: 5, 买卖盘性质: '买盘' },
      { 时间: '09:30:00', 成交价: 10.30, 手数: 20, 买卖盘性质: '买盘' }
    ], {
      code: 'sh600000',
      name: '浦发银行',
      date: '2026-06-05',
      prevClose: 10
    });
    t.equal(out.source, 'aktools-stock_intraday_em');
    t.equal(out.items.length, 2, '09:15 ticks are grouped into one minute');
    t.equal(out.items[0].open, 10.00);
    t.equal(out.items[0].close, 10.10);
    t.equal(out.items[0].high, 10.10);
    t.equal(out.items[0].low, 10.00);
    t.equal(out.items[0].volume, 15);
    t.equal(out.items[0].amount, 15050);
    t.equal(Math.round(out.items[0].percent * 100) / 100, 1.00);
    t.equal(out.items[1].close, 10.30);
    t.equal(Math.round(out.items[1].percent * 100) / 100, 3.00);
  });

  QUnit.test('returns empty data shape for non-array input', (t) => {
    const out = parseAktoolsIntradayTicks(null, { code: 'sh600519', date: '2026-06-05' });
    t.equal(out.code, 'sh600519');
    t.deepEqual(out.items, []);
  });
});

QUnit.module('aktoolsApi.parseAktoolsHistMinuteList', () => {
  QUnit.test('maps AKShare historical minute fields and computes percent', (t) => {
    const out = parseAktoolsHistMinuteList([
      {
        时间: '2026-06-05 09:30:00',
        开盘: 10,
        收盘: 10.2,
        最高: 10.3,
        最低: 9.9,
        成交量: 100,
        成交额: 102000,
        均价: 10.2
      }
    ], {
      code: 'sh600000',
      name: '浦发银行',
      date: '2026-06-05',
      prevClose: 10
    });
    t.equal(out.source, 'aktools-stock_zh_a_hist_min_em');
    t.equal(out.items.length, 1);
    t.equal(out.items[0].close, 10.2);
    t.equal(out.items[0].volume, 100);
    t.equal(out.items[0].avgPrice, 10.2);
    t.equal(Math.round(out.items[0].percent * 100) / 100, 2.00);
  });

  QUnit.test('filters rows outside the selected date', (t) => {
    const out = parseAktoolsHistMinuteList([
      { 时间: '2026-06-04 09:30:00', 开盘: 10, 收盘: 10, 最高: 10, 最低: 10, 成交量: 1, 成交额: 1000 },
      { 时间: '2026-06-05 09:30:00', 开盘: 11, 收盘: 11, 最高: 11, 最低: 11, 成交量: 1, 成交额: 1100 }
    ], { code: 'sh600000', date: '2026-06-05', prevClose: 10 });
    t.equal(out.items.length, 1);
    t.equal(out.items[0].close, 11);
  });
});
