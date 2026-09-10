# 2026-09-10 峰值触及（peak touch）改动审查：`b321522`

## 交接结论与范围

- **审查目标**：`git pull` 后新到的提交 `b321522` — *feat(momentum): upgrade 10-day momentum to track peak touch >=45% with pullback monitoring*（8 文件，+224/−12），基线 `c68b6cc`。
- **审查范围**：仅该提交的 diff，及其上下游调用链（服务端扫描 → 缓存 → API 边界 → 客户端合并 → 视图渲染 → 样式）；不重做全量审查。
- **结论**：**⚠️ 修改后可合并**。未发现 Critical；1 项 P1（换规则未随缓存失效，功能上线后可能静默不生效）、5 项 P2。单测 / E2E / lint 全部通过，但**测试全绿不代表该功能在部署后一定生效**，见 P1。
- **本轮不改业务源码**：以下均为待确认口径与待修项，本文只提供证据与改法。

## 验证结果

| 项目 | 结果 |
|------|------|
| `npm test` | **767 / 767 通过**（上一轮 STATUS 记录为 764，本提交新增 3 个用例，数目自洽） |
| `npm run lint` | **0 问题** |
| `npx playwright test` | **63 / 63 通过**（1.3 分钟，与 STATUS 记录一致） |
| 独立复现 | `2026-09-10-momentum-peak-review-repro.mjs` → **9 / 9 条成立** |
| 依赖交叉验证 | 无第三方库行为假设；`chartTimeToDate`（`src/js/services/momentumMath.js:3`）、`priceDirection`/`formatPercent`（`src/js/views/momentumView.js:4-8`）均已导入，不存在未定义引用 |
| 样式变量 | 新增样式引用的 `--text-secondary` / `--hover-bg` 在 warm / light / dark 三个主题块中**均有定义**（`src/style.css:6,16,23,33,40,50`），不会掉色 |

## 已确认问题与修复方案

### P1 · 换口径未随缓存失效，且启动扫描会被跳过 —— 功能可能「推上去了像没生效」

**位置**
- 缓存键只有日期 + 阈值：`server/momentumService.js:172-175`（`cacheParts` → `ten-day-45pct.json`）
- 缓存直接当有效结果返回，不做条目级校验：`server/momentumService.js:453-461`
- API 边界的「纠正」只改 coverage 元数据，不校验条目字段：`server/momentumService.js:19-29`
- **缓存 items 非空即跳过启动扫描**：`server/momentumService.js:504-516`
  `if (cached && cached.data && ...universeComplete !== false && Array.isArray(cached.data.items) && cached.data.items.length) { logger.info('...skipping startup scan'); return null; }`

**问题**
阈值 `45` 的语义从「10 日**收盘**涨幅」变成「10 日**峰值**涨幅」，但缓存键、缓存内字段没有任何版本标识。于是升级后：

1. `getCachedTenDayMomentum` 把旧规则产物原样返回（复现 P3：`hasMaxGain: false`，`status: 'complete'`）；
2. 客户端渲染时旧条目既没有 `maxGainPercent`/`pullbackPercent`，也就**没有峰值/回踩副行**，`anomaly` 还是旧文案「10日涨幅超45%」；
3. `ensureStartupMomentumScan` 认为「今天已有完整缓存」→ 跳过启动扫描，**新口径最长要等到下一个定时扫描（北京时间 08:00 / 15:05）或手动点扫描才会生效**，期间页面不会给出任何提示。

**影响范围（如实说明证据强度）**：代码路径已逐行确认（含 `file:line`）；但**具体是否命中取决于部署时该机器上是否存在完整缓存**。本机当前缓存是降级条目（`data/cache/momentum/20260910/ten-day-45pct.json`：`status: partial` / `universeComplete: false` / `items: 0`），因此**本机复现不到**，需在有完整缓存的机器上确认。VPS 由 Git 自动更新，正是最可能命中的场景。

**注意这与 P1 的「集合不完整」方向有关**：新口径是旧口径的**放宽**（`maxGain >= gain`），所以旧缓存**不会混入脏数据，只会少掉「峰值达标而收盘未达标」的标的**（复现 P3b：旧条件目仍满足新筛选）。也就是说——它不会报错，只会安静地少显示股票，这正是容易被误判为「功能没做出来」的原因（呼应项目里既有的那条注释：*correct pre-metadata cached results at the API boundary after deployment*，本次改的是**判定口径**，同样需要一次失效）。

**修复建议**（推荐第一种，一处改动同时解决读取与启动扫描）

```js
// server/momentumService.js —— 给「判定规则」本身打版本
const MOMENTUM_RULE = 'peak-touch-v1';

// buildMomentum 的返回值里带上（与 threshold/lookbackDays 同级）
return normalizeMomentumCoverage({ ..., rule: MOMENTUM_RULE, items: freshFound });

// 读取时：版本不匹配等同无缓存，交给启动扫描重建
if (cached && cached.data && cached.data.rule === MOMENTUM_RULE) { /* 原逻辑 */ }
```

若不想动结构，最小改法是改缓存键（`cacheParts` 一处）：

```js
return ['momentum', dateKey, `peak-touch-v1-${thresholdKey}pct.json`];
```

### P2 · 排序键与列名/列值不是同一个量，主列在页面上不再单调

**位置**：排序按 `maxGainPercent` 降序 `src/js/services/momentumMath.js:121-123`、`server/momentumService.js:43-45`；表格主数字仍是 `gainPercent`、表头仍写「10日涨幅」`src/js/views/momentumView.js:284,360`。

**问题**：复现 P2 —— `[{涨幅44, 峰值46}, {涨幅20, 峰值52}]` 排完是 `[20, 44]`，即页面上「10日涨幅」列出现 20% 排在 44% 之上。改动前该列是单调的（排序键 == 显示值），所以这是一处**可被用户直接观察到的回归**；只有注意到涨幅下方那行小字「触及 +52.00% · 回踩 −x%」才能理解顺序。另外「异动/原因」列（`getMomentumReasonText`）与涨幅副行现在会**同时**显示回踩信息，信息重复。

**修复建议**（二选一）
1. 把主数字改成峰值涨幅、把当前涨幅降到副行，表头改「10日峰值 / 当前」——顺序与列值就一致了；
2. 保留现状但把表头改为「10日涨幅（按峰值排序）」，并在无 reason/limitStats 时让原因列不再重复回踩文案（与新副行二选一）。

### P2 · 服务端重复实现了一份排序器（两份必须同步改）

**位置**：`server/momentumService.js:42-53`（`compareMomentumOrder`）vs `src/js/services/momentumMath.js:115-132`（`sortMomentumItems`）。

**问题**：比较规则（峰值 → 涨幅 → 成交额 → 代码）写了两遍，本提交就是**同时改两处**才没有出现端序不一致（服务端缓存顺序 vs 客户端渲染顺序）。这是典型的散弹式修改点：下次只改一边，就会出现「刷新前后顺序不一致」。

**修复建议**：服务端已经从同一模块 import 了 `isMomentumEligible`（`server/momentumService.js:9`），直接复用即可删除副本：

```js
import { sortMomentumItems } from '../src/js/services/momentumMath.js';
// :378 与 :392
.sort(compareMomentumOrder)  →  sortMomentumItems(...)
```

`sortMomentumItems` 默认 `pinnedCodes = new Set()`，无置顶时行为等价，可直接替换。

### P2 · 峰值/回踩的口径、阈值与文案散在 4 处，且正负号写法不一致

**位置**
- `server/momentumService.js:330-332`：`pullback < -0.1` → `回踩${Math.abs(pullback)}%`
- `src/js/services/momentumScanner.js:87-89`：同一份逻辑再写一遍
- `src/js/services/momentumMath.js:141-144`：第三遍
- `src/js/views/momentumView.js:163-169`：第四遍，且用 `formatPercent(pullback)` → 显示「回踩 **−3.33%**」

**问题**：同一个 `-0.1` 魔法阈值和「回踩」措辞出现 4 次；并且**同一笔数据两种写法**——服务端/扫描端用 `Math.abs()` 输出「回踩 3.33%」，视图输出「回踩 −3.33%」，tooltip 又写「自高点回落 −3.33%」。

**修复建议**：收回领域层，一处定义、多处使用：

```js
// src/js/services/momentumMath.js
export const MOMENTUM_PULLBACK_EPSILON = 0.1;
export function isPulledBack(item) {
  return (Number(item && item.pullbackPercent) || 0) < -MOMENTUM_PULLBACK_EPSILON;
}
```
再让服务端/扫描端/原因列/视图都调 `isPulledBack()`，文案统一由 `formatPercent` 负责（全项目一致）。视图单独调 `formatPercent(item.maxGainPercent)`。

### P2 · 筛选条件与标题口径不一致（需求符合度）

**位置**：`isMomentumEligible` 要求 `gainPercent > 0`（`src/js/services/momentumMath.js:112`，测试明确锁定：`tests/momentumMath.test.js:148-149` 断言 `gainPercent: -5` 与 `0` 均不入选）vs 表头「10日强势股 (触及超45%)」（`src/js/views/momentumView.js:241`）。

**问题**：复现 P1 —— 峰值 +50%、当前 −1% 的标的被拒绝；当前 +0.5% 则被接受（P1b），差别只在正负号。也就是说标题承诺的「10日**触及**超 45%」这一档里，**深度回踩到成本线以下的标的既不入选、也看不到回踩**，与提交信息里的 *pullback monitoring* 只覆盖了「回踩但尚未破位」的一半。

**这是一个口径选择，不是代码错误**，需要你定夺：
- 若确实只想要「仍为正」的强势股 → 建议标题改为「10日冲高超45%（当前仍为正）」，避免以后自己以为漏股；
- 若想真监控深度回踩（例如「冲高 45% 后跌破起点」这类破位信号）→ 需要另开一档或放宽 `gainPercent > 0`，并相应调整标题。

## 需求是否满足、实现是否合理

- **峰值计算本身是正确且自洽的**：扫描区间 `items.length - lookback .. items.length - 1`（`src/js/services/momentumMath.js:61`）正好是基线 K 线（`items.length - 1 - lookback`）之后的 `lookback` 根，与「10 日涨幅」量的是同一段区间——我在初查时怀疑过这里少算一根 K 线，**推导后确认不成立**（复现 P5/P5b：基线日的人为高点 20.00 被正确排除在窗口峰值之外）。不要把它当 bug 改。
- **向后兼容处理得当**：`stats.maxGainPercent ?? stats.gainPercent`（`:110`）让缺字段的旧数据仍可判定；客户端实时合并的 NaN 路径也闭合（`src/js/controllers/momentumController.js:342-359`，全部分支都有 `it.*` 兜底），`formatPercent` 对非有限值返回 `-`（`src/js/format.js:43-47`），不会把 NaN 写进 DOM。
- **服务端峰值不会被盘中低估**：`mergeLiveQuoteIntoDailyKline` 用 `high = Math.max(price, quote.high, open)`（`server/momentumService.js:152`），盘中合并不会漏掉当日最高价。
- **「回踩监控」目前只是展示**：没有任何提醒/播报/高亮接入新字段，`pullbackPercent` 的消费点只有视图副行与 anomaly 文案（全仓库检索 `maxGainPercent|pullbackPercent` 的命中点已逐一确认）。若「监控」的本意是「回踩到某个程度要提示我」，那这部分**尚未实现**，需要明确为后续需求。

## 模块化与精简

1. **领域算式落回了控制器**（建议收敛）：`src/js/controllers/momentumController.js:347-359` 自行实现了「把实时报价并入窗口峰值」的算法（`Math.max(q.high, price, it.maxHigh)` + 现算 `maxGainPercent`/`pullbackPercent`），而 `momentumMath.js` 的定位是「前后端统一」的领域层。这份口径目前靠人工与 `computeTenDayMomentum` 保持一致（例如将来若让窗口包含基线日，控制器这份不会同步）。建议抽 `applyLiveQuoteToMomentumStats(item, quote)` 放回 `momentumMath.js`，控制器只负责取值与写回。**这也是本次唯一新增的重复算式。**
2. **峰值/回踩已现成的可复用件没被用上**：`maxHighDate`、`maxHighTime`、`amplitudePercent`、`minLow` 都算了但生产代码未使用（只有 `tests/momentumMath.test.js:134` 断言 `maxHighDate`）。其中 `maxHighDate` 正好可以放进副行 tooltip（「08-06 触及 +50.00%，其后回落 −3.33%」），比现在 tooltip 逐字重复可见文本更有信息量；不需要的话建议连同 `amplitudePercent` 一起删掉，避免又攒一批「算了没人用」的字段。
3. **`getMomentumReasonText` 新增分支在生产路径不可达**：服务端总写 `anomaly`（`server/momentumService.js:330-344`），`momentumScanner` 在无 reason 时也总写 `anomaly`（`src/js/services/momentumScanner.js:101`），而该函数先判 `item.anomaly` 直接 return，所以新加的 `maxGainPercent` 文案只有测试自造对象能走到（复现 P4/P4b）。要么让生产路径改用新文案（同时消掉 P2 的重复显示），要么删掉这段分支。

## 测试与覆盖（可选的补强，不影响合并）

- **新 UI 零覆盖**：`renderGainCellContent` 与副行样式在 `tests/` 与 `e2e/` 中检索 `momentum-gain` **零命中**；`e2e/monitor.spec.js:67-98` 的 10 日强势股用例使用固定 mock，**不含 `maxGainPercent`**，因此新副行在 E2E 里从未被渲染过——这也是 63/63 全绿却覆盖不到新功能的原因（与项目既往「测试全绿 ≠ 修复生效」的教训一致）。建议补 1 个 view 单测（有/无 `maxGainPercent` 两种输入）+ 让 mock 带上 `maxGainPercent` 断言副行存在。
- **文案与用例名已过期**：`tests/momentumScanner.test.js:38` 用例名仍写「sorts by pinned then gainPercent descending」（实际已含峰值优先，因数据无 `maxGainPercent` 而恰好仍通过）；建议改名并补一条带 `maxGainPercent` 的置顶+排序用例。
- **冗余导出**：`src/js/app.js:66,125` 引入 `isMomentumEligible` 仅为再导出，app 内部未使用、也无测试从 app.js 取它；可写成 `export { isMomentumEligible } from './services/momentumMath.js'` 或直接删掉。
- **顺手可改**：`src/js/views/momentumView.js:195` 用 `gainCell.innerHTML = ''` 清空单元格，改成 `gainCell.replaceChildren()` 更准确（不经过 HTML 解析）。

## 建议处理顺序

1. **P1**（缓存版本 / 键）——决定这次改动推上去后是否可见，建议与本次功能一起推；
2. **P2 口径**（`gainPercent > 0` 与标题文案）——需要你一句话确认，其余都可按建议直接改；
3. P2 排序-列名对齐、排序器去重、`-0.1` 与文案收敛；
4. 测试补强（新副行 view 单测 + mock 带字段）。

## 文件及交付

- 本文：`docs/handoff/2026-09-10-momentum-peak-touch-review.md`
- 可重复证据（零依赖，`node docs/handoff/2026-09-10-momentum-peak-review-repro.mjs`）：`docs/handoff/2026-09-10-momentum-peak-review-repro.mjs`（9/9 成立）
- 本轮**未改动任何业务源码**，`main` 上的功能代码保持 `b321522` 基线；请勿把本文当作「已修复」验收。
