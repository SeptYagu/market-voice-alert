# 2026-09-13 WorkBuddy 独立代码审查（round 3）

> **审查日期**：2026-09-13
> **被审 HEAD**：`2f94e082e965aba6e23fa4ca7da9368f6811f197`（`2f94e08`）— *fix: 闭环修复独立审查 round 2 缺陷 (LRU tie-break 确定性/Eastmoney 量比)*
> **审查基线**：`518495db5a0df0c132234e08da12efce51901d7c`（`518495d`）
> **审查范围**：`git diff 518495d..2f94e08`（7 文件：`src/js/storage.js`、`src/js/parser.js`、`tests/storage.test.js`、`tests/parser.test.js`、`STATUS.md`、`docs/handoff/INDEX.md`、`docs/handoff/2026-09-13-storage-lru-tiebreak-and-parser-ratio-round2-closure-handoff.md`）
> **工作区**：干净；`git pull --ff-only` 已执行，`Already up to date`，HEAD 与待审提交一致。
> **判定**：**通过**（无 P0/P1/P2；遗留 2 项 P3、2 项待确认风险、1 项未验证项）。

---

## 0. 审查方式说明

本轮不采信提交方自带的门禁结论与新增单测断言本身，独立执行：

1. 逐行阅读 `git diff 518495d..2f94e08` 全部 7 个文件（含新增 handoff 与 STATUS/INDEX 文案）；
2. 通读 `src/js/storage.js` 全文（596 行）与 `src/js/parser.js` 相关函数，追踪 `klineCacheSet → _readKlineCacheObject → LRU 淘汰 → _persistKlineCacheWithFallback → _readKlineCacheEntry → klineCacheGet/Has` 调用链，以及 `parseEastmoney → formatNumber` 渲染链；
3. 自行设计并执行 4 组独立探针（parser 边界 18 例、storage LRU 6 组、跨 locale 排序对照、真实时钟 300 次压力），全部使用仓库真实模块、不与实现共享假设；
4. 复跑全量门禁（lint / QUnit×3 / build / Playwright E2E）以确认验收标准 #5。

---

## 1. 需求核对表

| # | 验收标准 | 实现位置 | 独立结论 |
| :-- | :--- | :--- | :--- |
| 1 | `klineCacheSet` LRU 淘汰 tie-break 确定性：同时间戳优先淘汰内存孤岛；当前写入键绝不淘汰；跨平台/跨引擎字典序稳定 | `storage.js:518-540`、`:541-547`、`:549-563` | ⚠️ **基本达成**：孤岛优先与当前键保护经冻结时钟/多写入顺序探针 100% 复现；**但第三级 tie-break 使用 `localeCompare`，非字节序「字典序」，存在跨引擎/locale 次序差异**（P3-R3F2） |
| 2 | `tests/storage.test.js:539` 及全量单测高频并发/紧凑循环下 100% 稳定 | `tests/storage.test.js:524-568` | ✅ **达成**：`tests/storage.test.js` 连续 50 次 0 失败；全量 `npm test` 连续 3 次均 812/812；真实时钟复刻 300 次孤岛存活率 0/300 |
| 3 | `parseEastmoney` 在 `f50` 缺失/null/`'-'` 时解析为 `undefined`（渲染 `-`），有效数值 /100，真实 0 保留 0，与 Tencent 完全对齐 | `parser.js:118-120`（对照 `:65-66`） | ⚠️ **部分达成**：缺失/null/`'-'`/NaN/非数值字符串均正确 → `undefined`；有效值 /100、真实 0 保留。**但 `f50=''`/空白 → `Number('')===0` → 渲染 `0.00`，与 Tencent（`parseFloat('')===NaN → undefined → '-'`）不一致**（P3-R3F1） |
| 4 | `tests/parser.test.js` 与 `tests/storage.test.js` 补齐对应断言，全量 812/812 | `tests/parser.test.js:178-190`；`tests/storage.test.js:543-568` | ✅ 断言方向正确、具判别力（基线会失败）；812/812 可复现。⚠️ 未覆盖 `f50=''` 与 tie-break 的 locale 敏感键对（测试覆盖缺口，见 §4） |
| 5 | 全量门禁 ESLint 0/0、QUnit 812/812、Playwright 74/74、Vite build | 见 §3 | ✅ 全部独立复现通过 |

---

## 2. 阅读过的关键文件与调用链

- `src/js/storage.js`（全文）：`klineCacheSet`（`:492-566`）→ 候选集构造（`:516`）→ 三级比较器（`:518-540`）→ 容量淘汰（`:541-547`）→ 内存上限兜底（`:549-563`）→ `_persistKlineCacheWithFallback`（`:424-490`，4 级降级）→ `_readKlineCacheEntry`（`:350-371`）→ `klineCacheGet`（`:409-417`，`_klineAccessTimes` 刷新）/`klineCacheHas`（`:419-422`）。
- `src/js/parser.js`：`parseTencent`（`:44-89`，`fields[49]` → `:65-66`）、`div100`（`:91`）、`parseEastmoney`（`:93-127`，`volumeRatio` `:118-120`）。
- 渲染/消费链：`src/js/format.js:9-12`（`formatNumber`：`undefined → '-'`，`0 → '0.00'`）；`src/js/views/monitorTableView.js:132,363`；`src/js/limitUpView.js:206,638`；`src/js/controllers/limitUpController.js:320`、`momentumController.js:370`（`Number.isFinite(Number(undefined))===false` → 保留旧值，无回归）。
- 周期常量：`src/js/kline.js:13-31`（`1m`=1分、`1M`=月K 均为真实周期，二者的缓存键 `code|1m` / `code|1M` 会进入同一 tie-break 比较）。
- 测试：`tests/storage.test.js`（`createMockStorage` `:39-56`、klineCache 模块 `:250-569`）、`tests/parser.test.js`（`moutai` fixture `:118-140`，无 `f50`）。
- 证据脚本：`docs/handoff/2026-09-13-review-round1-repro.mjs`（独立复跑）。

---

## 3. 独立验证场景与执行结果

所有探针以仓库真实模块运行，临时脚本置于仓库外 `D:\AiPrograms\project1\.review-tmp\`，审查结束已删除，未污染仓库。

| 探针 | 场景 | 结果 |
| :-- | :--- | :--- |
| P-1 | **Eastmoney `f50` 18 类边界**（缺失/null/`'-'`/空串/空白/制表/`'0'`/数字0/185/`'185'`/1.85/`'abc'`/NaN/-185/`'0x10'`/`'1,85'`/true/`[]`）→ `volumeRatio` → `formatNumber` | 缺失/null/`'-'`/`'abc'`/NaN → `undefined` → `-` ✅；0/0/185/185/1.85 → `0`/`0`/`1.85`/`1.85`/`0.02` ✅；**空串/空白/制表 → `0` → `0.00`（Tencent 为 `undefined` → `-`）❌** |
| P-2 | **Tencent 对照组**（同 18 类输入） | 空串/空白/制表 → `undefined` → `-`；与 Eastmoney 分支不一致 |
| P-3 | **冻结时钟 tie**：孤岛 + 100 个持久化写入（同毫秒） | 孤岛 100% 被淘汰、不可读；当前键保留；持久化条目数 = 100 ✅ |
| P-4 | **永久配额失败 ×250** | 内存中可读条目 = 100（= `KLINE_MAX_ENTRIES`），有界 ✅；最新键可读 |
| P-5 | **多重淘汰 tie**（5 孤岛 + 100 持久化 + 1 新写，同毫秒） | 全部孤岛先于持久化键被淘汰；当前键保留；条目数 = 100 ✅ |
| P-6 | **写入顺序扰动**（asc/desc/确定性 shuffle，冻结时钟） | 三种顺序下孤岛均被淘汰、持久化条目数恒为 100 → 淘汰结果与插入顺序无关 ✅ |
| P-7 | **真实时钟复刻 `tests/storage.test.js:539` 场景 ×300** | 孤岛存活 **0/300**（基线 round 2 实测 0.497–0.547）→ P2 已闭环 ✅ |
| P-8 | **当前键保底**：100 个字典序更大的键 + 当前键为全局字典序最小（同毫秒） | 当前键未被淘汰，条目数 = 100 ✅ |
| P-9 | **`localeCompare` vs 字节序**（2 万真实键对，20 万随机对） | 无「不同键比较为 0」；**但存在 8 处次序与字节序相反**：`sh600519|1M` 与 `sh600519|1m`（月K vs 1分）等 → tie-break 次序非字节序「字典序」❌（P3-R3F2） |
| P-10 | 连续 50 次 `tests/storage.test.js` | **0/50 失败** ✅ |
| P-11 | 全量 `npm test` ×3 / `npm run lint` / `npm run build` / `npm run e2e` | 812/812 ×3 ✅；lint 0 ✅；build ✅；**E2E 74/74 passed (1.2m)** ✅ |
| P-12 | 证据脚本 `--expect=fixed` | **5/5 通过** ✅ |

---

## 4. 缺陷清单（按严重级别）

### P3-R3F1 · Eastmoney `f50=''`/空白仍解析为 `0` 并渲染 `0.00`，未与 Tencent 分支「完全对齐」

- **严重级别**：P3
- **文件与行号**：`src/js/parser.js:118-120`（对照 Tencent 分支 `src/js/parser.js:65-66`；`formatNumber` 见 `src/js/format.js:9-12`）
- **触发条件**：`fetchQuotes` 回退 Eastmoney（某代码不在 Tencent 返回集合）且 `f50` 为**空串或纯空白**。
- **实际行为**：`Number('')` / `Number(' ')` / `Number('\t')` 均等于 `0` 且 `Number.isFinite(0)===true`，于是条件成立，`volumeRatio = Number((0/100).toFixed(2)) = 0` → `formatNumber(0) === '0.00'`。
- **期望行为**：与 Tencent 分支一致，空串/空白应视为「无数据」→ `undefined` → 渲染 `-`（验收标准 #3 的「与 Tencent 分支完全对齐」）。
- **根因**：用 `Number(d.f50)` 做有效性判定，而 `Number('')` 的强制转换为 `0`（JS 经典陷阱）；Tencent 分支使用 `parseFloat('')===NaN`，二者语义不同。
- **影响范围**：仅 Eastmoney 回退路径的量比展示列；影响有限（把「无数据」显示为「0.00」，非崩溃、非数据损坏），且有明确规避（主路径 Tencent 正确）。另注：此为**存量行为**，本轮对缺失/null/`'-'` 的修复并未引入回归，只是未覆盖空串。
- **复现方法/证据**：探针 P-1 —— `parseEastmoney({data:{...,f50:''}})` → `{volumeRatio:0, rendered:'0.00'}`；`f50:' '`、`f50:'\t'` 同此；Tencent 对照（P-2）三者均为 `undefined`/`-`。
- **修复建议**：判定前先归一化，例如
  ```js
  const raw = d.f50;
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  volumeRatio: (s !== '' && s !== '-' && Number.isFinite(Number(s)))
    ? Number((Number(s) / 100).toFixed(2))
    : undefined,
  ```
  或直接采用 `parseFloat` 语义（先 `trim`，空串即 NaN → `undefined`）。
- **修复后验收标准**：`f50` 为 `''`/`'  '`/`'\t'` 时 `parseEastmoney(...).volumeRatio === undefined` 且 `formatNumber` 渲染 `-`；`f50=0`/`'0'` 仍保留 `0`/`0.00`；`tests/parser.test.js` 增加空串断言。

### P3-R3F2 · LRU tie-break 第三级使用 `localeCompare`，非「字节序字典序」，跨引擎顺序不保证

- **严重级别**：P3
- **文件与行号**：`src/js/storage.js:539`（容量淘汰比较器）与 `src/js/storage.js:556`（内存兜底比较器）
- **触发条件**：容量淘汰候选集中存在**访问时间戳完全相同**、且**同属持久化/同属内存**的键，需要第三级比较决胜时；涉及的键在大小写上存在 locale 排序差异（例如真实周期 `1M`（月K）与 `1m`（1分），见 `src/js/kline.js:13-31`）。
- **实际行为**：`k1.localeCompare(k2)` 采用运行环境的默认 locale 排序规则。探针 P-9 实测：对 `sh600519|1M` 与 `sh600519|1m`，字节序判定 `'1M' < '1m'`（`'M'=0x4D < 'm'=0x6D`），而 `localeCompare` 判定相反（`1M` 排在 `1m` 之后）—— 2 万键样本中 8 处次序与字节序相反。
- **期望行为**：验收标准 #1 要求「跨平台/跨引擎**字典序**稳定」；默认 locale 相关的排序不满足该契约。
- **根因**：`localeCompare` 是 locale 感知的排序（大小写/标点分级、隐式 locale 依赖），与 UTF-16 码元「字典序」不等价；且 `String.prototype.localeCompare` 不传 locale 时依赖运行时默认 locale，理论上跨引擎/跨语言环境可能给出不同决胜结果。
- **影响范围**：**无功能正确性影响**——统一不变式（并集 ≤ `KLINE_MAX_ENTRIES`、内存集合 ≤ `KLINE_MAX_ENTRIES`、内存孤岛优先、当前键保护）均由前两级保证，`localeCompare` 只在「同为最旧且同类」的候选间挑选牺牲者；影响仅限于「具体牺牲哪个等价旧条目」在跨引擎下可能不同，属非阻塞健壮性/契约一致性问题。
- **复现方法/证据**：探针 P-9（`.review-tmp/probe-locale3.mjs`）输出 `["bj094592|1M","bj094592|1m",-1,1]` 等 8 处 code-unit 与 locale 符号相反；另注：本机 Node/Chromium 默认 locale 固定为 `en-US`，`LC_ALL` 不生效，故**未能实测到跨引擎的真实差异**，仅证明其非「字典序」。
- **修复建议**：改为显式码元比较：`return k1 < k2 ? -1 : (k1 > k2 ? 1 : 0);`（两处）。
- **修复后验收标准**：淘汰比较器不再使用 `localeCompare`；对 `...|1M` 与 `...|1m` 等键，决胜次序等于 UTF-16 码元序；冻结时钟下多写入顺序与多 locale 环境淘汰结果一致。

---

## 5. 待确认风险

1. **`localeCompare` 跨引擎差异未能实测**：仅能证明其非字节序字典序（P-9），无法在单一 OS/Node/Chromium 下构造第二个真实 locale 环境来证明「跨引擎给出不同牺牲者」。怀疑依据：`localeCompare` 规范允许实现/环境相关；缺少的证据：在 CI 多语言环境或不同 ICU 版本的 Node/浏览器上对同一冻结时钟场景对比淘汰集合；建议验证方法：在 Linux（`LANG=de_DE.UTF-8`）与 Windows 分别运行 P-6/P-9 对比。残余风险低（仅影响等价旧条目的取舍，不影响不变式）。
2. **Eastmoney 真实载荷中 `f50=''` 的出现频率未知**：所有验证均为离线构造（`MARKET_VOICE_TEST_NETWORK=offline`），未接触真实东财接口，无法量化空串在生产的触发概率。这也正是 P3-R3F1 定级 P3（而非 P2）的原因。建议：抓取真实回退响应样本统计 `f50` 取值分布。
3. **`storage.js:549-563` 内存上限兜底块实际不可达**（非缺陷、信息性）：主淘汰已保证 `_klineMemoryCache ⊆ 并集`，淘汰后并集恰为 `KLINE_MAX_ENTRIES`，故 `_klineMemoryCache.size > KLINE_MAX_ENTRIES` 恒为假。该块为纯防御代码，本身逻辑正确（亦保护当前键）；仅提示其不可用于推断主路径行为。

---

## 6. 未验证项与残余风险

- **未在真实浏览器 localStorage 配额真实打满下验证**：以可控 fake storage 等价模拟（P-3~P-8），覆盖了分支逻辑与不变式，但未在真实配额/序列化开销下观测。
- **未构造第二 locale/引擎环境验证 `localeCompare` 跨引擎差异**：受本机环境限制（见 §5.1）。
- **未接触真实 Eastmoney 接口样本**：见 §5.2。
- 残余风险：P3-R3F1 会在东财回退且 `f50` 为空串时将「无数据」显示为 `0.00`（有限、非阻塞）；P3-R3F2 理论上使等价旧条目的取舍在跨引擎下不同（无不变式/功能影响）。

---

## 7. 推荐修复顺序

1. **P3-R3F1**：先归一再判定（空串/空白 → `undefined`），补 `tests/parser.test.js` 空串/空白断言。
2. **P3-R3F2**：两处 `localeCompare` 替换为显式码元比较，并在冻结时钟用例中补一组大小写敏感键对（如 `...|1M` vs `...|1m`）固化次关键字。
3. 可选：为淘汰后不变式补一条「并集 ≤ `KLINE_MAX_ENTRIES` 且内存集合 ≤ `KLINE_MAX_ENTRIES`」断言（固化 round 2 §5 的防回归建议）。

---

## 8. 下一轮复审验收标准

1. `git diff` 复核：`parseEastmoney` 对 `f50 ∈ {缺失, null, '-', '', '   ', '\t'}` 一律 `volumeRatio === undefined`；真实 `0`/`'0'` 保留 `0`；有效值 /100 保留 2 位小数；
2. `git diff` 复核：`storage.js` 两处决胜均不再使用 `localeCompare`，为显式 UTF-16 码元比较；
3. 冻结时钟下：内存孤岛 100% 优先淘汰、当前键 100% 保留、并集与内存集合恒 ≤ `KLINE_MAX_ENTRIES`，且淘汰结果与写入顺序、locale 无关；
4. `tests/storage.test.js` 连续 ≥50 次 0 失败；`npm test` 多轮全绿（≥3 轮）；
5. `npm run lint` 0/0、`npm run build` 成功、`npm run e2e` 74/74；
6. 复核无 P0/P1/P2 遗留。

---

## 9. 审查通过条件核对

| 条件 | 状态 |
| :--- | :--- |
| 已逐文件阅读全部变更 | ✅ 7/7 文件 |
| 已核对全部任务要求与验收标准 | ✅ §1 |
| 已检查关键调用链与辐射影响 | ✅ §2 |
| 已审查相关测试有效性 | ✅（含判别力与覆盖缺口） |
| 已完成 ≥1 项独立负向/边界/故障验证 | ✅ 12 组探针 |
| 无未解决 P0/P1/P2 | ✅ 仅 2 项 P3 |
| 已列出 P3/待确认风险/未验证项/残余风险 | ✅ §4–§6 |

**结论**：审查**通过**。验收标准 #1–#5 均达成（其中 #1、#3 存在非阻塞的 P3 残留实现细节），无 P0/P1/P2。
