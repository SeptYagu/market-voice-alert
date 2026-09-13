# 2026-09-13 WorkBuddy 独立代码审查（round 2）

> **审查日期**：2026-09-13
> **被审 HEAD**：`ffe92b3` — *fix: 闭环修复独立审查 round 1 缺陷 (storage 孤岛副本/量比缺失语义/pinnedSort)*
> **审查基线**：`58f3f64`
> **审查范围**：`git diff 58f3f64..ffe92b3`（8 文件：`src/js/storage.js`、`src/js/parser.js`、`src/js/limitUpView.js`、`tests/storage.test.js`、`tests/parser.test.js`、`STATUS.md`、`docs/handoff/*`）
> **工作区**：干净；`git pull --ff-only` 已执行，HEAD 与待审提交一致。
> **判定**：**未通过**（存在未闭环的 P2）。1 项 P2、1 项 P3。

---

## 0. 审查方式说明

本轮不采信提交方自带的门禁结果与新增单测断言本身，全部以「阅读 diff → 追踪真实执行路径 → 构造反例」独立验证：

1. 逐行阅读 5 个产品/测试文件的完整 diff 与其调用链（`api.js` 缓存消费、`format.js` 渲染、`limitUp/limitUpApi/limitUpController` 数据流）；
2. 使用 `git worktree`（临时，审查后已移除）在**基线 `58f3f64`** 上复跑同一探针，确认判别方向；
3. 自行编写 6 个探针（A–G），其中 P0 修复、P1 单测、P3 死参数均做了新旧对照；P2 分支做了边界与对照。

---

## 1. 需求核对表

| # | 验收标准 | 实现位置 | 独立结论 |
| :-- | :--- | :--- | :--- |
| 1 | storage LRU 合并持久化+内存，压力下陈旧内存条目被正常淘汰，不得作为有效缓存返回 | `storage.js:515-529` | ⚠️ **部分达成**：常规/永久失败场景已闭环（探针 A：内存有界=100）；但**同毫秒时间戳并列时孤岛逃避淘汰**（P2-R2F1） |
| 2 | `tests/storage.test.js` 增加内存条目被 LRU 淘汰的单测 | `tests/storage.test.js:524-541` | ❌ **不达标**：用例**偶发失败（QUnit 下约 27.5%，紧凑循环约 50%）**（P2-R2F1） |
| 3 | `parser.js` 缺失量比 → `undefined` → `formatNumber` 显示 `-`，并加单测 | `parser.js:65-66`；`tests/parser.test.js:91-97` | ⚠️ **部分达成**：Tencent 分支正确；**Eastmoney 分支（`parser.js:118`）缺失量比仍为 `0` → `0.00`**（P3-R2F2） |
| 4 | `limitUpView.js` 用 `(lu.groupSort && lu.groupSort.pinned)` 消除死参数 | `limitUpView.js:665` | ✅ 达成（探针 E 对照：HEAD `patch=true` / 基线 `false`） |
| 5 | 证据脚本 `--expect=fixed` 5/5；门禁 lint 0 / test 810 / build / e2e 74 | 见 §4 | ⚠️ 脚本 5/5 ✅、lint 0 ✅、build ✅；`npm test` 本次 810/810 通过，**但新增用例偶发失败使「810/810」不可复现地成立** |

---

## 2. 阅读过的关键文件与调用链

- `src/js/storage.js`（全文）：`klineCacheSet` → `_readKlineCacheObject` → LRU 容量淘汰（`:515-529`）→ `_persistKlineCacheWithFallback`（`:424-490`，4 级降级）→ `_readKlineCacheEntry`（`:350-371`）→ `klineCacheGet/Has`（`:409-422`）。
- 消费链：`src/js/api.js:473`（SWR 命中即回源）、`api.js:150-185` `fetchQuotes`（**优先 Tencent，缺失码回退 Eastmoney**）。
- `src/js/parser.js`：`parseTencent`（`:44-89`）、`parseEastmoney`（`:93-...`，`volumeRatio: div100(d.f50)` `:118`）、`div100` 默认 0 的语义（`:91`）。
- `src/js/format.js:9-12` `formatNumber`（`undefined → '-'`）。
- `src/js/limitUpView.js`：`getLimitUpViewGroups`（`:568-578`，渲染侧用 `state.groupSort?.pinned`）、`limitUpRowsMatchDom`（`:588`）、`patchLimitUpRows`（`:659-685`）。
- `src/js/limitUp.js`：`_compareByNumberField`（`:125-137`，`Number(undefined)||0` → 排序不受 `undefined` 影响，无回归）。
- `src/js/controllers/limitUpController.js:304-328`（量比来自 `fetchQuotes`）、`limitUpApi.js:42-49`（AKTools 项不含量比）。

---

## 3. 独立验证场景与结果

| 探针 | 场景 | 结果 |
| :-- | :--- | :--- |
| A | **永久配额失败**下连续写 250 个 key，检查内存是否被 LRU 约束 | HEAD：`alive=100=max`、最新可读、最旧被驱逐 → **有界**；基线：`alive=250`、最旧仍可读 → **无界**（判别力成立） |
| B | 复刻新增单测的精确场景（永久失败→恢复配额→110 次写压） | HEAD 单次 `testWouldPass=true`；基线 `false`；**但 HEAD 重复运行不稳定**（见 G） |
| C | 量比边界：字段缺失/空串/`-`/非数值/真 0/真值 | `undefined`/`undefined`/`undefined`/`undefined`/`0`/`1.85`；`formatNumber` 分别 `-`/`-`/`-`/`-`/`0.00`/`1.85`（Tencent 语义正确） |
| D | **Eastmoney 分支**缺失 `f50` | `volumeRatio=0` → 渲染 `0.00`（与 Tencent 不一致） |
| E | P3：置顶组按 `price asc`（≠ 默认 `amount desc`）渲染后做一致性校验 | HEAD `patch=true`；基线 `false`（死参数误判→多余重绘）。修复有效 |
| F | 冻结 `Date.now`（所有访问时间相同）复刻单测场景 | 孤岛**确定性地逃避淘汰**（`orphanAfter=true`）→ 证明 **tie-break 根因** |
| G | 真实时钟重复 300 次量化单测场景失败率 | **孤岛存活率 50%–55%**（两次 0.497 / 0.547） |

**QUnit 实跑**：`tests/storage.test.js` 单独重复 40 次 → **11/40 运行出现 1 条失败**，失败断言恒为新增用例 `stock_orphan evicted by LRU capacity`（`tests/storage.test.js:539`）。
`tests/parser.test.js` 重复 20 次 → 0 失败（该用例稳定）。
`npm run lint` → 0；`npm run build` → 成功；`npm test` → 本次 810/810 通过。

---

## 4. 缺陷清单（按严重级别）

### P2-R2F1 · 新增 LRU 淘汰单测偶发失败 + LRU 淘汰 tie-break 不确定

- **文件与行号**：`tests/storage.test.js:524-541`（断言在 `:539`）；根因位于 `src/js/storage.js:516-528`。
- **触发条件**：孤岛（永久配额失败写入）与紧随其后的若干次成功写压落在**同一毫秒**内（批量预加载 10 只股票 × 多周期时会自然发生）。
- **实际行为**：`allKeys` 以 `[...持久化键, ...内存键]` 构造；`Array.prototype.sort` 稳定排序，在访问时间并列时**持久化键排在内存孤岛之前**，`slice(0, allKeys.size - MAX)` 每次只淘汰 1 条，于是并列的持久化键先被淘汰，孤岛排在其后、在 `KLINE_MAX_ENTRIES + 10` 次写压窗口内**始终不被选中**，最终断言 `klineCacheHas('stock_orphan','1d')===false` 失败（实测返回 `true`，并仍能 `klineCacheGet` 读到数据）。
- **期望行为**：并列时内存孤岛（尤其最旧的降级条目）应优先被淘汰；测试应确定性地验证淘汰。
- **根因**：淘汰排序缺少确定性/孤岛优先的次关键字，且依赖 `Date.now()` 毫秒精度；新增用例本身也依赖 wall-clock 粒度。
- **影响范围**：
  1. **门禁不可复现**：`npm test` 的「810/810」实际约 1/4 概率出现 1 条 fail（`tests/storage.test.js` 11/40），与验收标准 #2、#5 的「测试通过」冲突；
  2. **验收标准 #1「压力下陈旧内存条目必须被正常淘汰」在同毫秒场景未严格成立**（生产为「延迟淘汰」，非永久泄漏，故非 P0）。
- **复现证据**：
  - `node <probeG>` 重复 300 次 → 孤岛存活率 0.497 / 0.547；
  - QUnit `tests/storage.test.js` × 40 → 11 次 `# fail 1`，失败用例恒为该新增用例；
  - 冻结时钟探针 F → 确定性复现孤岛存活。
- **修复建议**：
  1. 在 `storage.js:518-522` 的排序比较器中加入确定性次关键字：时间戳相等时**内存副本条目优先**（例如先比较 `isMemoryOnly`，再比较是否为当前 `key`，最后按 key 字典序），确保孤岛在并列时被优先淘汰；
  2. 可在淘汰后追加不变式断言/兜底：若 `_klineMemoryCache.size + Object.keys(obj.entries).length > KLINE_MAX_ENTRIES` 则继续裁剪内存，杜绝并列导致的溢出；
  3. 将新增单测改为**确定性**：注入受控时钟（或直接构造差异化的 `lastAccessedAt`），不依赖 `Date.now()` 毫秒粒度；断言应表达「内存孤岛被淘汰」而非「恰好 110 次写压后必然淘汰」。
- **修复后验收标准**：`tests/storage.test.js` 连续运行 ≥ 50 次 0 失败；孤岛在时间戳并列与不并列两种情况下均被淘汰；`_klineMemoryCache` 条目数在任何情况下 ≤ `KLINE_MAX_ENTRIES`。

### P3-R2F2 · Eastmoney 分支缺失量比仍渲染为 `0.00`（仅修复了 Tencent 分支）

- **文件与行号**：`src/js/parser.js:118` → `volumeRatio: div100(d.f50)`（`div100` 见 `:91`，非数值返回 `0`）。
- **触发条件**：某股票代码不在 Tencent 返回集合中，`fetchQuotes`（`api.js:150-185`）回退到 Eastmoney，且 `f50` 缺失/为 `-`。
- **实际行为**：`volumeRatio=0` → `formatNumber(0)` = `"0.00"`。
- **期望行为**：与验收标准 #3 一致，缺失量比应解析为 `undefined` → 显示 `-`。
- **根因**：本轮仅改了 `parseTencent` 的 `fields[49]` 语义，未同步 `parseEastmoney` 的 `f50` 语义。
- **影响范围**：仅 Eastmoney 回退路径的展示语义，主数据源 Tencent 已正确；无法区分「量比恰为 0」与「无该数据」的问题在回退路径仍然存在。
- **复现证据**：探针 D — `missingF50 → {vr:0, rendered:"0.00"}`；`dashF50 → {vr:0, rendered:"0.00"}`。
- **修复建议**：`parseEastmoney` 中改为 `const vr = Number(d.f50); volumeRatio: Number.isFinite(vr) && d.f50 !== '-' && d.f50 !== null && d.f50 !== undefined ? vr / 100 : undefined`（保留真实 0），并在 `tests/parser.test.js` 补充 Eastmoney 缺量比断言。
- **修复后验收标准**：`parseEastmoney` 在 `f50` 缺失/`-` 时返回 `undefined`，`formatNumber` 渲染 `-`；真实 `f50=0` 保留 `0`。

> 严重级别说明：R2F2 若严格按「验收标准 #3 覆盖 `parser.js` 全部数据源」解读可上调为 P2；考虑到 Tencent 为主路径、Eastmoney 仅回退且修复成本低，本报告定级 **P3** 并如实标注。

---

## 5. 待确认风险

1. **淘汰可能误删刚写入的当前键**：在极端同毫秒并列下，若当前键在 `obj.entries` 中位置靠前，稳定排序可能使其与最旧键并列而进入淘汰集。生产概率极低（当前键访问时间刚刷新为最新），但与 R2F1 同源，建议在修复 tie-break 时一并加「不淘汰当前 key」的显式保护。
2. **`_klineAccessTimes` 与 `_klineMemoryCache` 的集合一致性**：本轮未新增「内存键 ⊆ 持久化键 ∪ 合法降级键」的不变式断言；R2F1 修复后建议补一条集合不变式测试以固化防回归。

---

## 6. 未验证项与残余风险

- **未重跑 `npm run e2e`（Playwright 74/74）**：需真实浏览器环境，本次未执行；E2E 亦不覆盖 localStorage 配额打满场景，对 R2F1 无判别力。
- **未在真实浏览器 localStorage 配额打满下验证**：以可控 fake storage 等价模拟（探针 A/G），行为已覆盖分支逻辑。
- 残余风险：若 R2F1 不在本轮闭环，CI/门禁将间歇性红灯（`npm test` 非确定性失败），并可能掩盖后续真实回归。

---

## 7. 推荐修复顺序

1. **P2-R2F1**（阻塞项）：先修 `storage.js` 淘汰 tie-break（内存优先 + 不淘汰当前键 + 淘汰后兜底裁剪），再改 `tests/storage.test.js` 用例为确定性，最后重复运行 ≥50 次确认稳定。
2. **P3-R2F2**：对齐 `parseEastmoney` 量比语义并补断言。
3. 补 §5 的不变式测试。

---

## 8. 下一轮复审验收标准

1. `git diff` 复核 tie-break 比较器包含确定性次关键字且逻辑正确；
2. `tests/storage.test.js` 连续运行 ≥50 次 0 失败，且新增用例不依赖 `Date.now()` 粒度；
3. 探针 A/G/F 三类场景（永久失败有界、真实时钟重压、冻结时钟并列）下孤岛均被淘汰，内存条目数恒 ≤ `KLINE_MAX_ENTRIES`；
4. 冻结时钟下**当前键**不被淘汰；
5. `parseEastmoney` 缺失量比 → `undefined` → 渲染 `-`，且真实 0 保留；
6. `npm run lint` 0、`npm test` 多轮全绿（≥3 轮）、`npm run build` 成功。
