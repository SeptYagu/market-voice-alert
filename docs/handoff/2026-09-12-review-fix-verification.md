# 提交 `b601d1b` 对独立审查报告缺陷的修复核实

> **核实日期**：2026-09-12
> **核实对象**：`b601d1b` — *fix: 闭环修复独立审查报告缺陷 (BUG-01~04/P0-3/OPT-02)*
> **审查对象**：`docs/handoff/2026-09-12-independent-full-codebase-review-handoff.md`（提交于 `0f134e3`）
> **broken 基线**：`0f134e3`（即 `b601d1b` 的父提交）
> **复现脚本**：[`2026-09-12-review-fix-verification-repro.mjs`](2026-09-12-review-fix-verification-repro.mjs)（双模式 `--expect=fixed|broken`，零依赖，只 import 真实模块）
> **验收标准**：实现的需求与功能本身。测试通过不等于修复生效。

---

## 1. 结论总表

| 项 | 提交声称 | 实测结论 | 关键证据 |
| :--- | :--- | :--- | :--- |
| **BUG-01** MIME 类型 | 已修 | ✅ **真闭环** | 对真实 `createAppServer()` 发 HTTP：`.mjs`→`text/javascript; charset=utf-8`、`.txt`→`text/plain`、`.wasm`→`application/wasm`；基线三者均为 `application/octet-stream` |
| **BUG-02** LRU 逐级降级 | 已修 | ⚠️ **主体闭环，降级可见性不完整**（Minor ×2） | 永久超限后可内存读回；二次超限裁剪到 `[5,6,7]`；基线为「全部 6 条仍在、新条目丢失」。但降级条目在配额恢复后被静默遗忘（见 §3.2） |
| **BUG-03** 看板局部补丁 | 已修 | ❌ **引入回归（Major）** | 同一组断言在基线 PASS、在 HEAD FAIL：行情富集后「开盘价」DOM 恒为 `0.00`（state=1808）、「量比」DOM 恒为 `-`（state=1.85）。见 §3.1 |
| **BUG-04** 图表视口防跳变 | 已修 | ✅ **闭环（单元级证据）** | 基线：`restoreRangeOrFit(ctl, null)` → `fitContent()`；HEAD：先捕获 `getVisibleRange()={111,222}` → `setVisibleRange`，不再 `fitContent()`。订阅 API `subscribeVisibleTimeRangeChange` 在 lightweight-charts **4.2.3** 中确实存在（非静默空转） |
| **P0-3** TXT 导出入口 | 已修 | ✅ **闭环**（附带 1 项 Minor 语义缺口） | `#btn-export-selected-txt` 存在且派发 `onExport('selected','txt')`；基线无该按钮。缺口：含期货时输出 4 位裸数字，不满足 SPEC §3.2 的 6 位契约 |
| **OPT-02** VWAP 抽离 | 已修 | ✅ **行为保持** | `computeVwap` 与内联的旧三处实现，在 **15 组输入 × 2 站点**上逐点 `Object.is` 一致 |
| OPT-01 / OPT-03 / P1-6 / P2-7 | 未声称 | ⏳ 未处理 | 属 P1/P2，本次未纳入，可接受 |

**门禁复跑（与提交声称一致，且全部通过）**：`npm run lint` 0 问题；`npm test` **806/806**；`npm run e2e` **74/74**（1.3 分钟）；`npm run build` 成功。
→ 即 **测试全绿的同时存在真实回归**：BUG-03 的回归没有任何测试覆盖（见 §4）。

---

## 2. 复现方式

```bash
# HEAD（应只剩 BUG-03 两条 FAIL）
node docs/handoff/2026-09-12-review-fix-verification-repro.mjs --expect=fixed

# 修复前基线（应全部 FAIL）
git worktree add --detach "D:/AiPrograms/.tmp_wt_review" 0f134e3
# 用 PowerShell 建 node_modules junction（非递归删除，勿用 rm -rf）
node docs/handoff/2026-09-12-review-fix-verification-repro.mjs --expect=broken
```

实测对比（同一脚本、同一组断言）：

| 断言 | 基线 `0f134e3` | HEAD `b601d1b` |
| :--- | :--- | :--- |
| `BUG-01 probe.mjs/txt/wasm` | F（`application/octet-stream` ×3） | **P** |
| `BUG-02a` 永久失败后可内存读回 | F（`has=false`） | **P** |
| `BUG-02b` 二次超限裁到 3 条 | F（`保留=[1..6]`，`attempts=2`） | **P**（`[5,6,7]`，`attempts=3`） |
| `BUG-04a` 不再强制 `fitContent()` | F（调用序列 `[fitContent]`） | **P**（`[setVisibleRange {111,222}]`） |
| `BUG-04b` 订阅接线 | F（`wired=false`） | **P** |
| `P0-3` TXT 导出入口 | F（`button=false`） | **P** |
| `OPT-02` VWAP 等价 | SKIP（模块不存在） | **P** |
| **`BUG-03 open` 开盘价与 state 一致** | **P** ✅ | **F** ❌ |
| **`BUG-03 ratio` 量比与 state 一致** | **P** ✅ | **F** ❌ |

`BUG-03` 两条断言的**方向反转**即本次回归的判定依据：它们在旧代码上通过、在修复后失败。

---

## 3. 缺陷详情

### 3.1 【Major · 新引入回归】`patchLimitUpQuoteCells()` 的补丁字段集不足，DOM 与 state 脱钩

**位置**：`src/js/controllers/limitUpController.js:175-212`（新补丁） vs `src/js/limitUpView.js:588-607`（既有 `patchRow`）

新补丁只写 4 个字段，而同一次状态变更实际改写、且视图具备渲染能力的字段更多：

| 触发路径 | 被改写的 state 字段 | 新补丁是否覆盖 | 后果 |
| :--- | :--- | :--- | :--- |
| `enrichLimitUpItemsWithQuotes()`（`limitUpController.js:355-372`，**当前活跃**） | `open`、`openChangePercent`、`volumeRatio`、price/change/changePercent/amount | ❌ `open`（开盘价）、`volumeRatio`（量比）**未覆盖** | **开盘列恒为 `0.00`、量比列恒为 `-`** |
| `kickoffLimitUpMetadataFetch()`（:404-433） | `limitUpCount`、`firstLimitTime`、`lastLimitTime`、`breakCount` | ❌ 全部未覆盖 | 潜在：N 板/最后封板/炸板次数不刷新 |
| `kickoffLimitUpReasonsFetch()`（:434-461） | `reason`、`interpretation` | ✅ | 正常 |
| `applyLiveTicksToLimitUp()`（:489-499） | price/change/changePercent | ✅ | 正常 |

**为什么这条路径一定被走到**：新补丁只在 `limitUpRowsMatchDom(...)` 为真时执行（结构=代码序列/分组未变）。行情富集刻意保持分组与排序不变时该判定即为真——复现脚本实测 `结构一致=true`，因此走补丁分支，DOM 不再更新。

**为什么开盘价必然是可见的坏值**：`src/js/aktoolsApi.js:82` 的 `_parseItem` 把 `open` 硬编码为 `0`（`open: 0`），服务端不补全（`server/limitUpService.js` 无 open 相关逻辑），所以行情富集是开盘列的唯一数据来源；补丁跳过它 → 该列永远停在 `formatNumber(0) === '0.00'`。量比同理：`_parseItem` 根本不产出 `volumeRatio`，初值 `undefined` → `'-'`。

**根因（比表面更重要）**：审查报告对 BUG-03 的前提描述与实现不符。报告称 `patchLimitUpQuoteCells()` 是「无条件全表 `rerenderLimitUpPage()` → 退化/虚拟 Diff」，但 `rerenderLimitUpPage()` → `renderLimitUpPage()` → `reconcileGroups()` 走的是 WeakMap 节点复用，对已有行调用 `patchRow()` **本就只改单元格**（`limitUpView.js:653`）。真正的缺陷只是「`limitUpRowsMatchDom` 从未被调用」，并不存在性能问题。

因此本次修复是在**已有一个完备局部补丁（`patchRow`）的前提下，又写了第二个不完备的局部补丁**，并把原来完备的那条路径让位给了它。报告给出的「方案 B：就地更新 `.col-price`/`.col-pct`/`.col-amount`」若照字面执行，就会精确地复制出这个坑——本次提交正是这么做的。

**建议修法（待确认）**：
1. 不要在控制器里维护第二份字段清单。让 `patchLimitUpQuoteCells()` 在结构一致时调用视图侧既有行级补丁——把 `limitUpView.js` 的 `patchRow` 导出（或新增 `patchVisibleRows(root, state)`），控制器只负责「结构一致 → 原地补丁 / 不一致 → reconcile」这一个分支决策。
2. 补两条断言到既有测试里（可直接搬复现脚本的写法）：行情富集后 `[data-field="open"]` / `[data-field="ratio"]` 的 `textContent` 必须等于 `formatNumber(state 值)`。

### 3.2 【Minor ×2】`storage.js` 内存降级的可见性缺口

1. **降级条目在配额恢复后被静默遗忘。** `_readKlineCacheEntry`（`storage.js:348-361`）在 localStorage 里存在 `kline-cache-v1` 但缺少该 key 时直接 `return obj.entries[key] || null`，**不再回查 `_klineMemoryCache`**。实测（`.tmp_review/storage-memfallback-probe.mjs`）：
   ```
   阶段1 持久化永久失败写入 c1 → memOnlyReadable=true, lsKeys=[]
   阶段2 配额恢复写入 c2      → lsHasC1=false, c1Readable=false, c2Readable=true
   ```
   即 c1 仍在 `_klineMemoryCache` 里，却已读不出来。非回归（旧代码 c1 本来就存不下），但新能力不完整。修法：把 `return obj.entries[key] || null` 改为命中即返回、未命中则继续走内存兜底。
2. **完全无 storage 时内存降级不生效。** 新增的 `if (!_storage()) return;`（`storage.js:470`）使 `localStorage` 与 adapter 都缺失时直接返回，连内存兜底也不会写入。浏览器里 `localStorage` 恒存在，仅影响无存储宿主/测试环境，属已知边界。

**另：曾怀疑 stage-3 的 `remaining.length > 3` 守卫会误清缓存，已实测否定。** 6 条→`[5,6,7]`、5 条→`[6]`、4 条→`[5]`（`.tmp_review/storage-stage3-probe.mjs`）。≤3 条时既然重写同样会超限，直接走「清键 + 单条写入」是合理选择，**不是缺陷**——记录在此以免后人重复怀疑。

### 3.3 【Minor】TXT 导出未约束代码位数（SPEC §3.2 语义缺口）

新暴露的 TXT 入口直接复用 `buildExportText`（`src/js/services/batchExportService.js:79`），只做 `stripPrefix`。自选里含期货时会输出非 6 位行：

```
buildExportText(['sh600519','sz000858','nf2510']) === "600519\n000858\n2510"
```

SPEC §3.2 要求「每行一个股票代码，6 位纯数字，无前缀」，4 位期货代码在同花顺/通达信无法识别。建议：TXT 导出只输出 6 位股票代码，或在 UI 上明确提示期货不参与导出。

### 3.4 对审查报告本身的两处更正

1. **BUG-03 的问题定性**：报告称存在「全表 Reconcile 重绘 / 虚拟 Diff」性能问题——与实现不符（详见 §3.1 根因）。按报告建议照做会引入本次回归。
2. **报告自称的基线 `3e4486e` 与提交位置不符**：报告文件由 `0f134e3` 提交，`3e4486e` 早于它 4 个提交且不含报告本身。复现时须用 `0f134e3` 作为 broken 基线，否则首条断言即对不上。（该提示已写入复现脚本文件头。）
   附：报告建议的导出文件名 `stocks-YYYYMMDD.txt` 与实际 `makeExportFilename()` 产出的 `stocks_YYYYMMDD_HHMMSS.txt` 不一致；因 SPEC 未规定文件名，**不计为缺陷**。

---

## 4. 为什么 806 单测 + 74 E2E 全绿仍然漏掉了回归

- 本次提交的测试改动只有 4 处：`tests/app.test.js`（toolbarView TXT 按钮 + `handleExport` 空选）、`tests/quoteMath.test.js`（新增）、`tests/server.test.js`（MIME 常量）、`tests/storage.test.js`（LRU 逐级降级 + 内存降级）。**BUG-03 与 BUG-04 没有任何新增测试**——恰恰是这两个点最需要保护，而回归就发生在这里。
- 全仓 `grep 'data-field="open"' / 'data-field="ratio"'` 在 `e2e/` 与 `tests/` 下**零命中**：开盘价与量比两列从未被断言过，与门禁全绿不矛盾。
- 既有 `limitUpRowsMatchDom` 单测（`tests/codeReviewRegressions.test.js`、`tests/reviewFollowup.test.js`）只校验该纯函数本身，**不校验接入后补丁的字段完备性**，因此对本次回归天然无感。
- 新补充的断言质量是合格的：`BUG-02a/b`、`BUG-01`、`P0-3` 的用例都经旧代码验证会失败（见 §2 对比表），不是空转断言。

---

## 5. 处置建议

| 优先级 | 项 | 说明 |
| :--- | :--- | :--- |
| **P0** | BUG-03 回归 | 开盘价/量比列不刷新，属可见功能缺陷，应尽快修（§3.1 建议修法） |
| P1 | 补测试 | BUG-03/04 的回归保护（BUG-04 目前只有单元级证据、无真实浏览器覆盖） |
| P2 | storage 降级可见性 | §3.2 两处 Minor |
| P2 | TXT 期货语义 | §3.3 |
| — | OPT-01/OPT-03/P1-6/P2-7 | 审查报告中的 P1/P2 项，本次未纳入 |

`STATUS.md` 中本轮「缺陷全面修复」的描述应按本报告更正为：**BUG-01/04、P0-3、OPT-02 闭环；BUG-02 主体闭环；BUG-03 未闭环且引入回归。**
