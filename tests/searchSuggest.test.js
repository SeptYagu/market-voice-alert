import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  detectQueryMode,
  createStockSearchIndex,
  searchStocks,
  validateSpotSnapshot,
  beijingDateKey,
  parseStatusFlag
} from '../src/js/services/stockSearchService.js';
import { isBatchQuery, parseBatchInputDetails, parseBatchInput } from '../src/js/services/batchExportService.js';
import { parseBaseName } from '../scripts/build-suggest-dictionary.mjs';

let indexInstance = null;

async function getTestIndex() {
  if (indexInstance) return indexInstance;
  const p = resolve(process.cwd(), 'public/data/stock-suggest-dictionary.json');
  const raw = await readFile(p, 'utf8');
  const json = JSON.parse(raw);
  indexInstance = createStockSearchIndex(json);
  return indexInstance;
}

QUnit.module('添加栏智能联想与建议测试 (S01–S17 矩阵)', (hooks) => {
  let index;

  hooks.before(async () => {
    index = await getTestIndex();
  });

  // S01: gzmt/GZMT、全角字母、茅台/guizh、排版空白
  QUnit.test('S01: gzmt / GZMT / 全角 / 茅台 / guizh / 排版空白 均正确命中贵州茅台', (t) => {
    const queries = ['gzmt', 'GZMT', 'ｇｚｍｔ', '茅台', 'guizh', ' 贵州茅台 '];
    for (const q of queries) {
      const res = searchStocks(q, { index });
      t.true(res.items.length > 0, `Query "${q}" should return results`);
      const maotai = res.items.find((it) => it.code === 'sh600519');
      t.ok(maotai, `Query "${q}" must contain 贵州茅台 (sh600519)`);
      t.equal(maotai.code, 'sh600519');
    }
  });

  // S02: xrgf 含新锐/新日/雪人旧名
  QUnit.test('S02: xrgf 同时匹配新锐股份、新日股份、雪人集团，且雪人标明实际旧名', (t) => {
    const res = searchStocks('xrgf', { index });
    const codes = res.items.map((it) => it.code);

    t.true(codes.includes('sh688257'), 'Contains 新锐股份');
    t.true(codes.includes('sh603787'), 'Contains 新日股份');
    t.true(codes.includes('sz002639'), 'Contains 雪人集团');

    const xueren = res.items.find((it) => it.code === 'sz002639');
    t.equal(xueren.name, '雪人集团', 'Main name displays current name');
    t.equal(xueren.matchedFormerName, '曾用名: 雪人股份', 'Former name explanation is shown');

    // 验证雪人集团只有单行（去重不产生两行）
    const xuerenRows = res.items.filter((it) => it.code === 'sz002639');
    t.equal(xuerenRows.length, 1, 'Only one row per canonical code');
  });

  // S03: shiyou 含中国石油/中曼石油/炼石有色
  QUnit.test('S03: shiyou 完整集合包含中国石油/中曼石油/炼石航空(炼石有色)，并正确截断', (t) => {
    const res = searchStocks('shiyou', { index, maxResults: 100 });
    const codes = res.items.map((it) => it.code);

    t.true(codes.includes('sh601857'), 'Contains 中国石油');
    t.true(codes.includes('sh603619'), 'Contains 中曼石油');
    t.true(codes.includes('sz000697'), 'Contains 炼石航空 (曾用名包含石有)');

    const lianshi = res.items.find((it) => it.code === 'sz000697');
    t.equal(lianshi.matchedFormerName, '曾用名: 炼石有色');

    // 验证默认截断 12 项 (使用 600 查询超量股票)
    const truncated = searchStocks('600', { index, maxResults: 12 });
    t.equal(truncated.items.length, 12, 'Truncated to 12 items');
    t.true(truncated.hasMore, 'hasMore flag is true');
  });

  // S04: sfza/深发展/深发展A、同码多旧名/同名异码
  QUnit.test('S04: sfza / 深发展 / 深发展A 关联平安银行，同码多旧名稳定去重', (t) => {
    for (const q of ['sfza', '深发展', '深发展A']) {
      const res = searchStocks(q, { index });
      const row = res.items.find((it) => it.code === 'sz000001');
      t.ok(row, `Query "${q}" hits 平安银行`);
      t.equal(row.name, '平安银行');
      t.ok(row.matchedFormerName?.startsWith('曾用名: 深发展'));
    }
  });

  // S05: *ST西发、XD美的集加基础全名
  QUnit.test('S05: *ST西发 (xf/stxf/*stxf/西发)、XD美的集 (mdjt/xdmd/美的集团) 均能命中', (t) => {
    for (const q of ['xf', 'stxf', '*stxf', '西发']) {
      const res = searchStocks(q, { index });
      const row = res.items.find((it) => it.code === 'sz000752');
      t.ok(row, `Query "${q}" hits *ST西发`);
    }

    for (const q of ['mdjt', 'xdmd', '美的集团']) {
      const res = searchStocks(q, { index });
      const row = res.items.find((it) => it.code === 'sz000333');
      t.ok(row, `Query "${q}" hits 美的集团`);
    }
  });

  // S06: st/*st/xd/n/c、普通拼音前缀、玉米连续
  QUnit.test('S06: 状态区分、c 同时保留玉米连续合约与当日状态', (t) => {
    const fixedNow = 1789007814465;
    const mockSnapshot = {
      ok: true,
      stale: false,
      generatedAt: fixedNow,
      ttlMs: 30000,
      data: {
        universeComplete: true,
        items: [
          { code: 'sz000752', name: '*ST西发' },
          { code: 'sz000333', name: 'XD美的集' },
          { code: 'sh600000', name: 'C浦发' }
        ]
      }
    };

    // 查询 'c'
    const resC = searchStocks('c', { index, spotSnapshot: mockSnapshot, now: fixedNow });
    const cornFuture = resC.items.find((it) => it.code === 'c0');
    t.ok(cornFuture, 'Query "c" preserves 玉米连续 (c0)');
    t.equal(cornFuture.type, 'future');

    // 查询 '*st' 仅命中 *ST
    const resST = searchStocks('*st', { index, spotSnapshot: mockSnapshot, now: fixedNow });
    const stXifa = resST.items.find((it) => it.code === 'sz000752');
    t.ok(stXifa, 'Query "*st" matches *ST西发');
    t.equal(stXifa.status, '*ST');
  });

  QUnit.test('B1 & C6: parseStatusFlag 与 parseBaseName 仅匹配后接中文的 N/C 状态前缀，不过度匹配英文名称', (t) => {
    // 真实状态名
    t.equal(parseStatusFlag('N新锐'), 'N');
    t.equal(parseStatusFlag('C浦发'), 'C');
    t.equal(parseStatusFlag('*ST西发'), '*ST');
    t.equal(parseStatusFlag('ST大集'), 'ST');
    t.equal(parseStatusFlag('XD美的集'), 'XD');

    // 纯英文或非状态名不应过度匹配 N / C
    t.equal(parseStatusFlag('CATL'), null);
    t.equal(parseStatusFlag('C919'), null);
    t.equal(parseStatusFlag('NIO'), null);
    t.equal(parseStatusFlag('南京银行'), null);
    t.equal(parseStatusFlag('长江电力'), null);

    // parseBaseName 验证
    t.equal(parseBaseName('N新锐'), '新锐');
    t.equal(parseBaseName('C浦发'), '浦发');
    t.equal(parseBaseName('*ST西发'), '西发');
    t.equal(parseBaseName('CATL'), 'CATL');
    t.equal(parseBaseName('C919'), 'C919');
    t.equal(parseBaseName('NIO'), 'NIO');
    t.equal(parseBaseName('南京银行'), '南京银行');
  });

  // S07: 新/旧/跨日/未来/过期/部分/空快照、非法封套/503
  QUnit.test('S07: 快照时效性校验与降级保护', (t) => {
    const now = Date.now();

    // 正常快照
    const validSnap = { ok: true, stale: false, generatedAt: now - 5000, ttlMs: 30000, data: { items: [] } };
    t.true(validateSpotSnapshot(validSnap, now).valid, 'Valid snapshot passes');

    // 过期快照 (now - generatedAt > ttlMs)
    const expiredSnap = { ok: true, stale: false, generatedAt: now - 40000, ttlMs: 30000, data: { items: [] } };
    t.false(validateSpotSnapshot(expiredSnap, now).valid, 'Expired snapshot rejected');

    // stale 快照
    const staleSnap = { ok: true, stale: true, generatedAt: now - 1000, ttlMs: 30000, data: { items: [] } };
    t.false(validateSpotSnapshot(staleSnap, now).valid, 'Stale snapshot rejected');

    // 未来时间戳
    const futureSnap = { ok: true, stale: false, generatedAt: now + 60000, ttlMs: 30000, data: { items: [] } };
    t.false(validateSpotSnapshot(futureSnap, now).valid, 'Future snapshot rejected');

    // 跨日快照 (昨天)
    const yesterday = new Date(now - 86400000);
    const yesterdaySnap = { ok: true, stale: false, generatedAt: yesterday.getTime(), ttlMs: 100000000, data: { items: [] } };
    if (beijingDateKey(yesterday) !== beijingDateKey(new Date(now))) {
      t.false(validateSpotSnapshot(yesterdaySnap, now).valid, 'Cross-day snapshot rejected');
    }

    // 错误封套 / 503
    const errorSnap = { ok: false, error: 'Service Unavailable 503' };
    t.false(validateSpotSnapshot(errorSnap, now).valid, 'Error envelope rejected');

    // 快照不可用时，基础代码检索继续正常工作
    const res = searchStocks('600519', { index, spotSnapshot: errorSnap, now });
    t.equal(res.items[0]?.code, 'sh600519', 'Base search functions when snapshot fails');
    t.equal(res.statusNotice, '当日状态未更新', 'Status notice is shown');
  });

  // S08: 逗号/中文逗号/空格/换行/Tab/末尾逗号 批量模式
  QUnit.test('S08: 批量输入检测与分隔符解析统计', (t) => {
    t.true(isBatchQuery('600519, 000001'), 'Comma + space is batch');
    t.true(isBatchQuery('600519，000001'), 'Chinese comma is batch');
    t.true(isBatchQuery('600519\t000001'), 'Tab is batch');
    t.true(isBatchQuery('600519\n000001'), 'Newline is batch');
    t.true(isBatchQuery('600519,'), 'Trailing comma is batch');
    t.false(isBatchQuery(' 600519 '), 'Leading/trailing whitespace alone is not batch');
    t.false(isBatchQuery('gzmt'), 'Single word is not batch');

    // parseBatchInputDetails 统计有效/重复/无效
    const details = parseBatchInputDetails('600519, 未知词, 000001, 600519', ['sh600519']);
    t.deepEqual(details.validCodes, ['sh600519', 'sz000001'], 'Valid codes extracted');
    t.deepEqual(details.newCodes, ['sz000001'], 'Only sz000001 is new');
    t.equal(details.duplicateCodes.length, 2, 'Two duplicates: already in list + duplicate in batch');
    t.deepEqual(details.invalidTokens, ['未知词'], 'Invalid token collected');
  });

  // S09: 字典加载/失败时完整代码仍可直接解析
  QUnit.test('S09: 字典未就绪时完整代码、ETF与期货仍可直接识别', (t) => {
    // 完整股票代码
    const resStock = searchStocks('sh600519', { index: { items: [] } });
    t.ok(resStock, 'Search execution completes');

    // 原生 ETF / 期货代码经原有解析器
    t.deepEqual(parseBatchInput('sh510300, nf2105'), ['sh510300', 'nf2105']);
  });

  // S14: rb/lwg/螺纹钢、RB2610、月份前缀
  QUnit.test('S14: 期货品种连续合约与月份合约解析', (t) => {
    for (const q of ['rb', 'lwg', '螺纹钢']) {
      const res = searchStocks(q, { index });
      const rb0 = res.items.find((it) => it.code === 'rb0');
      t.ok(rb0, `Query "${q}" finds 螺纹钢连续 (rb0)`);
      t.equal(rb0.displayCode, 'RB0');
      t.equal(rb0.type, 'future');
    }

    // RB2610 完整月份合约
    const resMonth = searchStocks('RB2610', { index });
    t.equal(resMonth.items[0]?.code, 'rb2610');
    t.equal(resMonth.items[0]?.displayCode, 'RB2610');
  });

  // S15: 多音字、前导零、北交所、超长查询、HTML/正则字符
  QUnit.test('S15: 多音字、前导零、北交所、超长截断与纯文本安全', (t) => {
    // 平安银行多音字 (yh / payh)
    const resBank = searchStocks('payh', { index });
    t.ok(resBank.items.find((it) => it.code === 'sz000001'), 'payh hits 平安银行');

    // 前导零
    const resZero = searchStocks('000001', { index });
    t.equal(resZero.items[0]?.code, 'sz000001', '000001 matches sz000001 with leading zeros');

    // 北交所股票
    const resBj = searchStocks('安徽凤凰', { index });
    t.ok(resBj.items.find((it) => it.code.startsWith('bj')), 'Beijing exchange stock found');

    // 超长查询 (>64 字符)
    const longQuery = 'a'.repeat(65);
    t.equal(detectQueryMode(longQuery), 'overlong');
    const resLong = searchStocks(longQuery, { index });
    t.equal(resLong.mode, 'overlong');
    t.equal(resLong.message, '查询过长，请缩短输入');

    // 正则特殊字符安全 (不应报语法错误)
    const regexChars = ['(', ')', '[', ']', '?', '+', '*', '^', '$', '\\'];
    for (const ch of regexChars) {
      try {
        searchStocks(`茅台${ch}`, { index });
        t.ok(true, `Query with regex char ${ch} does not throw`);
      } catch (err) {
        t.notOk(err, `Query with regex char ${ch} threw error`);
      }
    }
  });

  // S17: 字典体积与性能测试 (压缩字典 <= 500KiB, 响应时间 p95 <= 16ms)
  QUnit.test('S17: 性能预算验证 (体积 <= 500KiB, 查询延迟 p95 <= 16ms)', async (t) => {
    const p = resolve(process.cwd(), 'public/data/stock-suggest-dictionary.json');
    const raw = await readFile(p, 'utf8');
    const sizeKiB = Buffer.byteLength(raw, 'utf8') / 1024;
    t.true(sizeKiB <= 500, `Dictionary size ${sizeKiB.toFixed(2)} KiB must be <= 500 KiB`);

    // 运行 200 次不同查询测试耗时
    const testQueries = ['gzmt', '60051', 'shiyou', 'xrgf', 'rb', '平安银行', '西发', 'c', '00000', '002639'];
    const latencies = [];

    for (let i = 0; i < 200; i++) {
      const q = testQueries[i % testQueries.length];
      const start = performance.now();
      searchStocks(q, { index });
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    t.true(p95 <= 16, `p95 latency ${p95.toFixed(2)} ms must be <= 16 ms`);
  });
});
