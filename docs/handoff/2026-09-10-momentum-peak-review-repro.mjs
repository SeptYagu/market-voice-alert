// 2026-09-10 峰值触及（peak touch）改动的独立复现证据
//
// 目的：不复现 UI，只用真实模块证明 b321522 引入的四处可验证行为。
// 零依赖，纯标准库；不联网。
//
//   node docs/handoff/2026-09-10-momentum-peak-review-repro.mjs
//
// 期望输出：5 条 P（复现成功）或 F（复现失败）。全部 P 表示审查结论成立。

import {
  computeTenDayMomentum,
  isMomentumEligible,
  sortMomentumItems,
  getMomentumReasonText
} from '../../src/js/services/momentumMath.js';
import { normalizeMomentumCoverage } from '../../server/momentumService.js';

const results = [];
function check(id, desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ id, desc, ok, actual, expected });
  console.log(`${ok ? 'P' : 'F'}  ${id}  ${desc}`);
  if (!ok) console.log(`     actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------- P1
// 「触及 >=45% 但当前回落到成本线以下」的标的被整体丢弃。
// 表格标题却是「10日强势股 (触及超45%)」——标题承诺的口径与筛选条件不一致。
check(
  'P1',
  '峰值 +50% / 当前 -1% 的标的被 isMomentumEligible 拒绝（标题「触及超45%」承诺了它）',
  isMomentumEligible({ maxGainPercent: 50, gainPercent: -1 }, 45),
  false
);
check(
  'P1b',
  '同一口径下 峰值 +50% / 当前 +0.5% 的标的被接受（说明差别只在正负号，不在峰值）',
  isMomentumEligible({ maxGainPercent: 50, gainPercent: 0.5 }, 45),
  true
);

// ---------------------------------------------------------------- P2
// 排序键（maxGainPercent）与列显示值（gainPercent）不是同一个量，
// 于是「10日涨幅」这一列在页面上不再单调递减。
const sorted = sortMomentumItems([
  { code: 'sz000001', gainPercent: 44, maxGainPercent: 46, amount: 1 },
  { code: 'sz000002', gainPercent: 20, maxGainPercent: 52, amount: 1 }
]);
check(
  'P2',
  '「10日涨幅」列出现 20% 排在 44% 之上（表头仍写 10日涨幅）',
  sorted.map((it) => it.gainPercent),
  [20, 44]
);

// ---------------------------------------------------------------- P3
// 旧缓存（无 maxGainPercent）经 API 边界原样返回，没有任何规则版本校验；
// 而 ensureStartupMomentumScan 见到 items 非空就跳过启动扫描 → 新规则最长要等到
// 下一个定时扫描（北京时间 08:00 / 15:05）才会生效。
const legacyItem = {
  code: 'sh600519',
  name: '贵州茅台',
  gainPercent: 52.3,
  anomaly: '10日涨幅超45%',
  marketDate: '20260910'
};
const legacyCache = {
  status: 'complete',
  threshold: 45,
  universeComplete: true,
  scanned: 5400,
  latestMarketDate: '20260910',
  items: [legacyItem]
};
const served = normalizeMomentumCoverage(legacyCache);
check('P3', '旧规则缓存被 API 边界原样当作有效结果返回（无 rule/version 字段）', {
  servedItems: served.items.length,
  hasMaxGain: Object.prototype.hasOwnProperty.call(served.items[0], 'maxGainPercent'),
  status: served.status
}, { servedItems: 1, hasMaxGain: false, status: 'complete' });

// 反向确认：旧条目本身仍能通过新筛选（新口径是旧口径的放宽，所以不会「多出错的」，
// 只会「少掉该有的」——即缺少峰值达标但收盘未达标的标的）。
check(
  'P3b',
  '旧条款目仍满足新筛选（向后兼容 OK，问题是集合不完整而非含脏数据）',
  isMomentumEligible(legacyItem, 45),
  true
);

// ---------------------------------------------------------------- P4
// getMomentumReasonText 新增的 maxGainPercent 分支，在两条生产路径上都不可达：
// 服务端总写 anomaly，momentumScanner 在无 reason 时也总写 anomaly。
check(
  'P4',
  '服务端形状的条目走 anomaly 分支，永远到不了新的 maxGainPercent 文案',
  getMomentumReasonText({ anomaly: '10日冲高超45%(回踩3.33%)', maxGainPercent: 48, gainPercent: 32, pullbackPercent: -3.33 }),
  '10日冲高超45%(回踩3.33%)'
);
check(
  'P4b',
  'maxGainPercent 分支只能被测试自造对象触发（无 anomaly/reason/limitStats）',
  getMomentumReasonText({ maxGainPercent: 50, gainPercent: 35, pullbackPercent: -10 }),
  '10日触及+50.00%(回踩-10.00%)'
);

// ---------------------------------------------------------------- P5（已排除的怀疑）
// 复核「峰值窗口少算一根 K 线」的怀疑：基线是 items[len-1-lookback]，
// 扫描区间是 items[len-lookback .. len-1]，正好是基线之后的 lookback 根 —— 口径自洽。
const items = Array.from({ length: 11 }, (_, i) => ({
  time: `2026-08-${String(i + 1).padStart(2, '0')}`,
  open: 10,
  close: i === 0 ? 10.0 : (i === 10 ? 13.5 : 12),
  high: i === 0 ? 20.0 : 13.6, // 基线日人为给一个最高价
  low: 9.5
}));
const peak = computeTenDayMomentum({ items });
check('P5', '基线日（窗口外）的 20.00 高点不被计入窗口峰值', peak.maxHigh, 13.6);
check('P5b', '窗口峰值口径与 10 日涨幅口径一致（同一段区间）', {
  startClose: peak.startClose,
  maxGainPercent: peak.maxGainPercent,
  amplitudeUnused: peak.amplitudePercent
}, { startClose: 10, maxGainPercent: 36, amplitudeUnused: 41 });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 条复现成立（P=成立，F=不成立）`);
process.exit(failed.length ? 1 : 0);
