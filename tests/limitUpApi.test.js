import {
  buildLimitUpUrl,
  parseLimitUpList,
  fetchLimitUpList,
  fetchLimitUpAndBrokenList,
  fetchLimitUpMetadata,
  fetchLimitUpMetadataBatch,
  clearLimitUpMetadataCache
} from '../src/js/limitUpApi.js';

// =====================================================================
// 2026-06-05 upgrade: limitUpApi now delegates to AKTools (aktoolsApi.js).
// Eastmoney clist/get + per-stock metadata URL builders/parsers are
// preserved as back-compat helpers but not used by the live app.
// =====================================================================

const EASTMONEY_FIELDS = 'f1,f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f100,f102,f103';

function jsonResponse(body) {
  const text = JSON.stringify(body);
  const buf = new TextEncoder().encode(text);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer };
}

function errorResponse(status = 500) {
  return { ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) };
}

const AKTOOLS_LIMITUP_SAMPLE = [
  { 代码: '300897', 名称: '山科智能', 最新价: 22.38, 涨跌幅: 20.0,
    成交额: 277911936, 连板数: 1, 炸板次数: 1, 首次封板时间: '092500',
    最后封板时间: '132251', 涨停统计: '1/1', 所属行业: '通用设备' }
];
const AKTOOLS_BROKEN_SAMPLE = [
  { 代码: '603681', 名称: '永冠新材', 最新价: 26.6, 涨跌幅: 1.88,
    成交额: 1527685968, 炸板次数: 7, 首次封板时间: '092504',
    涨停统计: '0/0', 所属行业: '化学制品' }
];

// =====================================================================
// buildLimitUpUrl (legacy Eastmoney URL builder — kept for back-compat)
// =====================================================================
QUnit.module('limitUpApi.buildLimitUpUrl', () => {
  QUnit.test('produces /api/limit-up/qt/clist/get with default opts', (t) => {
    const url = buildLimitUpUrl();
    t.ok(url.startsWith('/api/limit-up/qt/clist/get?'), `prefix: ${url}`);
    t.ok(url.includes('fs=m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2'), 'includes fs');
    t.ok(url.includes('pn=1'), 'default pn=1');
    t.ok(url.includes('pz=100'), 'default pz=100');
    t.ok(url.includes(EASTMONEY_FIELDS.split(',').slice(0, 5).join(',')), 'includes fields');
    t.ok(url.includes('f12'), 'includes code field f12');
    t.ok(url.includes('f14'), 'includes name field f14');
  });
  QUnit.test('respects custom page and pageSize', (t) => {
    const url = buildLimitUpUrl({ page: 2, pageSize: 50 });
    t.ok(url.includes('pn=2'));
    t.ok(url.includes('pz=50'));
  });
  QUnit.test('caps pageSize at 100 (eastmoney max)', (t) => {
    const url = buildLimitUpUrl({ pageSize: 200 });
    t.ok(url.includes('pz=100'), 'caps to 100');
  });
});

// =====================================================================
// parseLimitUpList (legacy Eastmoney JSON parser — kept for back-compat)
// =====================================================================
QUnit.module('limitUpApi.parseLimitUpList', () => {
  QUnit.test('parses a list of items into normalized objects', (t) => {
    const json = {
      data: {
        total: 2,
        diff: [
          { f2: 1100.00, f12: '600519', f14: '贵州茅台', f3: 10.01, f6: 100 },
          { f2: 16.50, f12: '000001', f14: '平安银行', f3: 9.98, f6: 50 }
        ]
      }
    };
    const items = parseLimitUpList(json);
    t.equal(items.length, 2);
    t.equal(items[0].code, '600519');
    t.equal(items[0].name, '贵州茅台');
    t.equal(items[0].price, 1100.00);
    t.equal(items[1].code, '000001');
  });
  QUnit.test('returns [] for empty diff / null / missing data', (t) => {
    t.deepEqual(parseLimitUpList({ data: { total: 0, diff: [] } }), []);
    t.deepEqual(parseLimitUpList({ data: null }), []);
    t.deepEqual(parseLimitUpList(null), []);
  });
  QUnit.test('skips items missing code or price', (t) => {
    const items = parseLimitUpList({
      data: { diff: [
        { f2: 100, f12: '600519', f14: 'OK' },
        { f2: 100, f14: 'NoCode' },
        { f12: '000001' }
      ] }
    });
    t.equal(items.length, 1);
    t.equal(items[0].code, '600519');
  });
});

// =====================================================================
// fetchLimitUpList (live path: delegates to AKTools)
// =====================================================================
QUnit.module('limitUpApi.fetchLimitUpList (aktools)', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    clearLimitUpMetadataCache();
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    clearLimitUpMetadataCache();
  });

  QUnit.test('routes to /api/aktools/api/public/stock_zt_pool_em', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    };
    const items = await fetchLimitUpList();
    t.ok(capturedUrl.startsWith('/api/aktools/api/public/stock_zt_pool_em'),
      `url: ${capturedUrl}`);
    t.equal(items.length, 1);
    t.equal(items[0].code, 'sz300897', '30xxxx → sz');
    t.equal(items[0].name, '山科智能');
  });

  QUnit.test('returns real 连板数/炸板次数/封板时间 from AKTools payload', async (t) => {
    globalThis.fetch = async () => jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    const items = await fetchLimitUpList();
    t.equal(items[0].limitUpCount, 1, 'real value (was hardcoded 0 in legacy)');
    t.equal(items[0].breakCount, 1, 'real value (was hardcoded 0 in legacy)');
    t.equal(items[0].firstLimitTime, '09:25', 'HHMMSS → HH:MM');
    t.equal(items[0].lastLimitTime, '13:22', '最后封板时间 → HH:MM');
  });

  QUnit.test('forwards AbortSignal to underlying fetch', async (t) => {
    let capturedInit = null;
    const ctrl = new AbortController();
    globalThis.fetch = async (url, init) => {
      capturedInit = init;
      return jsonResponse([]);
    };
    await fetchLimitUpList({ signal: ctrl.signal });
    t.equal(capturedInit.signal, ctrl.signal);
  });

  QUnit.test('returns [] on HTTP 200 with empty array (non-trading day)', async (t) => {
    globalThis.fetch = async () => jsonResponse([]);
    const items = await fetchLimitUpList();
    t.deepEqual(items, []);
  });

  QUnit.test('throws on HTTP 5xx (no retry — AKTools is local backend)', async (t) => {
    globalThis.fetch = async () => errorResponse(500);
    await t.rejects(fetchLimitUpList(), /HTTP 500/);
  });

  QUnit.test('passes date param through to URL', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse([]);
    };
    await fetchLimitUpList({ date: '20260604' });
    t.ok(capturedUrl.includes('date=20260604'), `url: ${capturedUrl}`);
  });

  QUnit.test('30s cache: second call within TTL does not re-fetch', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    };
    const a = await fetchLimitUpList();
    const b = await fetchLimitUpList();
    t.equal(calls, 1, 'cache hit on second call');
    t.equal(a[0].code, b[0].code);
  });
});

// =====================================================================
// fetchLimitUpAndBrokenList
// =====================================================================
QUnit.module('limitUpApi.fetchLimitUpAndBrokenList (aktools)', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    clearLimitUpMetadataCache();
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    clearLimitUpMetadataCache();
  });

  QUnit.test('fetches both limitUp + broken pools in parallel', async (t) => {
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(url);
      if (url.includes('zbgc')) return jsonResponse(AKTOOLS_BROKEN_SAMPLE);
      return jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    };
    const { limitUpItems, brokenItems } = await fetchLimitUpAndBrokenList();
    t.equal(limitUpItems.length, 1);
    t.equal(brokenItems.length, 1);
    t.equal(limitUpItems[0].source, 'aktools-limitUp');
    t.equal(brokenItems[0].source, 'aktools-broken');
  });
});

// =====================================================================
// fetchLimitUpMetadata (back-compat: derived from aktools cache)
// =====================================================================
QUnit.module('limitUpApi.fetchLimitUpMetadata (aktools cache)', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    clearLimitUpMetadataCache();
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    clearLimitUpMetadataCache();
  });

  QUnit.test('returns null for empty / non-string code', async (t) => {
    t.strictEqual(await fetchLimitUpMetadata(null), null);
    t.strictEqual(await fetchLimitUpMetadata(''), null);
    t.strictEqual(await fetchLimitUpMetadata(123), null);
  });

  QUnit.test('extracts metadata from aktools cache (no second fetch)', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    };
    const r1 = await fetchLimitUpMetadata('sz300897');
    const r2 = await fetchLimitUpMetadata('sz300897');
    t.equal(calls, 1, 'cache hit on second call (no new HTTP request)');
    t.equal(r1.limitUpCount, 1);
    t.equal(r1.breakCount, 1);
    t.equal(r1.firstLimitTime, '09:25');
    t.equal(r1.lastLimitTime, '13:22');
    t.deepEqual(r1, r2, 'identical result from cache');
  });

  QUnit.test('returns defaults for code not in current pool', async (t) => {
    globalThis.fetch = async () => jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    const r = await fetchLimitUpMetadata('sh999999');
    t.deepEqual(r, { limitUpCount: 0, firstLimitTime: null, lastLimitTime: null, breakCount: 0 });
  });

  QUnit.test('passes date option through for metadata lookup', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    };
    await fetchLimitUpMetadata('sz300897', { date: '2026-06-05' });
    t.ok(capturedUrl.includes('date=20260605'), `url: ${capturedUrl}`);
  });
});

// =====================================================================
// fetchLimitUpMetadataBatch (back-compat: derived from aktools cache)
// =====================================================================
QUnit.module('limitUpApi.fetchLimitUpMetadataBatch (aktools cache)', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    clearLimitUpMetadataCache();
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    clearLimitUpMetadataCache();
  });

  QUnit.test('returns empty Map for empty/null input', async (t) => {
    const m1 = await fetchLimitUpMetadataBatch([]);
    const m2 = await fetchLimitUpMetadataBatch(null);
    t.ok(m1 instanceof Map);
    t.equal(m1.size, 0);
    t.equal(m2.size, 0);
  });

  QUnit.test('returns Map of metadata for codes in current pool', async (t) => {
    globalThis.fetch = async () => jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    const m = await fetchLimitUpMetadataBatch(['sz300897']);
    t.equal(m.size, 1);
    t.equal(m.get('sz300897').limitUpCount, 1);
    t.equal(m.get('sz300897').firstLimitTime, '09:25');
    t.equal(m.get('sz300897').lastLimitTime, '13:22');
  });

  QUnit.test('skips codes not in current pool', async (t) => {
    globalThis.fetch = async () => jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    const m = await fetchLimitUpMetadataBatch(['sz300897', 'sh999999']);
    t.equal(m.size, 1, 'only the in-pool code is in the Map');
  });

  QUnit.test('single underlying fetch serves many batch calls (cache)', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    };
    await fetchLimitUpMetadataBatch(['sz300897']);
    await fetchLimitUpMetadataBatch(['sz300897']);
    t.equal(calls, 1, 'no extra fetch on second batch call');
  });

  QUnit.test('passes date option through for batch metadata lookup', async (t) => {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    };
    await fetchLimitUpMetadataBatch(['sz300897'], { date: '2026-06-05' });
    t.ok(capturedUrl.includes('date=20260605'), `url: ${capturedUrl}`);
  });
});

// =====================================================================
// clearLimitUpMetadataCache
// =====================================================================
QUnit.module('limitUpApi.clearLimitUpMetadataCache', (hooks) => {
  let originalFetch;
  hooks.beforeEach(() => {
    clearLimitUpMetadataCache();
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
    clearLimitUpMetadataCache();
  });

  QUnit.test('forces a re-fetch after clear', async (t) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(AKTOOLS_LIMITUP_SAMPLE);
    };
    await fetchLimitUpList();
    clearLimitUpMetadataCache();
    await fetchLimitUpList();
    t.equal(calls, 2, 're-fetches after cache clear');
  });
});
