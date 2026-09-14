# WorkBuddy 独立代码审查 round 11 交接（涨停看板历史日期图表修复方案）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`147573a`（`docs(handoff): 彻底闭环 round 10 审查缺陷…`）；基准 `f48e592`；实际审查范围 `git diff f48e592..147573a --stat` = 6 文件 / +792 / -22（`AGENTS.md`、`STATUS.md`、`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`（新）、round 9/10 审查报告（新）、`docs/handoff/INDEX.md`），全为文档类改动；`git pull --ff-only` = `Already up to date`，工作区干净。
- 通过项简述：§4.2 改造点四已明确落在调度层（`app.js:1508-1515` 的 `visible` 语义 + `app.js:1602-1614` 移除 `stopMonitorTimer()`），代码对比中 `needsSharedQuotes` 为自声明变量、`state.expandedCodes`/`state.limitUp.expandedCodes`/`state.momentum.expandedCodes` 均在 `app.js:319/352/370` 真实存在，无虚构变量；§4.1.4/§2.3/§4.2 的股票快照主源前提已改为与 `api.js:161/172` + `parser.js:64/82/93-127` 一致的条件式表述，round 10 的 P2 已闭环；§4.3 mock 信封已修正为 `{ ok: true, data: {...} }`，"无条件调用 `loadIntraday`"已改为 `this.hasIntraday` 门控，时钟 Mock 已要求同时覆写构造与 `static now()`。
- 全文 43 处代码引用锚点、`32da3ca`/`eae67ae`/`2f94e08` 提交溯源、round 9/10 范围统计（5 文件/+542/-22、3 文件）经逐条比对**与 HEAD 完全一致**；`npm test` 复跑 **814/814 通过**（0 失败）。
- 缺陷集中在 §4.3 用例 7 的"集成到达性断言"实际不可证伪 P1，以及若干与本方案代码/自身公式相矛盾的表述。**判定：未通过。**

## 二、审查发现与缺陷清单

### P2（中）§4.3 用例 7 的"集成到达性断言"无法证伪 P1：定时器存活断言无可达接入点，(b)(c) 分支绕过调度层

- **文件与行号**：本文档 §4.3 用例 7 `docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:415-418`；声明的接入点 `:394`（`app.js:1645 _internal()`）；对照代码 `src/js/app.js:1398-1399`（`_forceRefresh`）、`src/js/app.js:1645-1647`（`_internal`）、`src/js/app.js:1476`、`src/js/controllers/monitorController.js:78-90/139-140`、`tests/app.test.js:874-878`。
- **触发条件**：按文档实现用例 7，且在被审方案未实施（`app.js:1515` 仍为 `monitorCtrl.applySchedule(allowed, !hasLimitUpRoot)`、`app.js:1607` 仍 `stopMonitorTimer()`）的状态下运行。
- **实际行为与期望行为**：
  - 期望：用例 7 作为 round 10 P1 的闭环证据 —— 当其断言通过时，即可证明 `#/limit-up` 下共享行情轮询器存活、`state.quotes` 真实获得该 code。
  - 实际：
    1. **(a) 无可达接入点**。`monitorCtrl` 与 `applyDataRefreshSchedule` 均未从 `app.js` 导出；`app.js:1645 _internal()` 仅返回 `{ state, chartInstanceMap, limitUpRootEl }`（`app.js:1646`）。因此"断言后台 `monitorCtrl` 的定时器保持运行（`timer !== null`）"在文档声明的访问机制下无法实现。仓库既有测试已明确记录同类限制：`tests/app.test.js:874-878` —"Integration test that navigates via `startApp` is omitted because it would require complex cleanup of timers/workers/fetches"。
    2. **(b)(c) 的"或触发一次 refresh() 周期"分支绕过调度层**，因此即使 P1 未修也照样通过。实测（真实 `monitorController.js` 模块 + `applySchedule(allowed, false)` 模拟未修的 `app.js:1515`，刷新集合等价包含 `sh600777`）：
       ```
       after applySchedule(allowed, visible=false) -> inspect: {"inFlight":false,"timerCount":0}
       refresh() invoked directly; fetchQuotes batches: [["sh600777"]]
       state.quotes has sh600777: true
       ```
       即 `timerCount === 0`（`setInterval` 从未建立、P1 未修）时，`refresh()` 仍被直接调用成功、仍写入 `state.quotes` —— (b)(c) 在缺陷存在时同样为绿。
- **根因**：断言层级与被审断链层级不匹配。P1 的断链点是 `app.js:1515` 的 `visible` 语义与 `app.js:1607` 的无条件 `stopMonitorTimer()`（调度层），而用例 7 唯一的调度层断言 (a) 需要访问 `monitorCtrl`/`applyDataRefreshSchedule`（未导出、也未给出注入方案）；(b)(c) 只覆盖 `monitorController.getRefreshCodes()` 的输出与 `refresh()` 的写入能力（订阅层），二者均与调度层是否存活解耦。
- **影响范围**：round 10 P1 的闭环证据不足，本轮验收标准"§4.3 … 用例 7 集成到达性断言"未实质满足；按文档原样实现将产生一条"功能无效仍绿"的假通过测试（与"测试是否可能在功能实际无效时仍然通过"的审查要求直接冲突）。方案本身的修复方向（改 `visible` 语义 + 移除 `stopMonitorTimer()`）不受影响。
- **复现方法/验证证据**：见上条实测输出（真实模块 + 等价刷新集合）；另 `grep -n "^export" src/js/app.js` 确认无 `monitorCtrl`/`applyDataRefreshSchedule` 导出，`tests/app.test.js:874-878` 确认 startApp 级集成测试在本仓库被显式省略。
- **修复建议**：为用例 7 明确一个**可达**的接入方式，并删除绕过调度的等价分支：
  1. 在 `app.js:1645 _internal()` 中补出调度层访问器（如新增 `monitorCtrl` 与 `applyDataRefreshSchedule`，或 `_applyDataRefreshSchedule()` 包装），使 (a) 可断言 `monitorCtrl.inspect().timerCount > 0`；
  2. 或让 `app.js` 支持 timers 注入（现 `createMonitorController` 已支持 `timers` 选项，`monitorController.js:5`，但 `app.js:1455` 未传），测试以 fake timers 驱动真实 `setInterval` 回调；
  3. 将 (b) 的"或触发一次 `refresh()` 周期"改为**必须**由定时器回调驱动（断言 `fetchQuotes` 在测试**未**手动调用 `refresh()/_forceRefresh()` 的前提下被调用、且批次含该 code）；
  4. (c) 保留 `state.quotes.get('sh600777')` 写入与 `updateChartLastTickMulti`（`app.js:1335` 已导出、`app.js:1467` 已在 `onQuotes` 中调用）的断言。
- **修复后验收标准**：存在一条**变异可证伪**的测试 —— 将 `app.js:1515` 临时改回 `monitorCtrl.applySchedule(allowed, !hasLimitUpRoot)`（或在 `app.js:1607` 恢复 `stopMonitorTimer()`）后该用例必须失败；恢复方案后必须通过，且 `timerCount > 0`。

### P3（低）绝对化表述残留：§4.2 "全站唯一写入 `state.quotes` 的正是 `monitorController` 的 `refresh()`"

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:277`（§4.2 改造点四 问题现状 1）；同类残留在 `:99`（§2.3"`state.quotes` 中根本没有该标的的报价实体"）；本段自身条件式表述在 `:279`；对照代码 `src/js/app.js:952`、`src/js/controllers/momentumController.js:141/152`、`src/js/controllers/monitorController.js:16/44/50`、`src/js/app.js:1586`。
- **触发条件**：对任一常规会话读取 §4.2 改造点四 问题现状 1 的结论；或标的已被加入自选/订阅时进入 `#/limit-up`。
- **实际行为与期望行为**：
  - 期望（round 10 P2 已确立的口径）：§4.1.4/§2.3/§4.2 的前提表述均为条件式、与代码事实一致。
  - 实际：`grep -rn "quotes\.set" src/js/` 得到 4 处写入点 —— `monitorController.js:44/50`、`app.js:952`（订阅开关用 momentum 条目兜底）、`momentumController.js:141/152`（10 日强势股扫描，`snapshot: true`）。"全站唯一"不成立。同段 `:279` 自身又把订阅排除限定为"若未被加入自选且非强势股"，而 `monitorController.js:16` 对 `state.watchList`/`state.subscribed` 是**无条件**纳入的，且 `app.js:1586` 的 `refreshNow()` 在进入涨停页前即已写入自选报价 —— 故 `:99` 的"根本没有该标的的报价实体"对自选/已订阅标的不成立，与 `:279` 的条件式表述互相矛盾。
- **根因**：沿用 round 10 报告结论时，把"`limitUpController` 自身定时器不写 `state.quotes`"这一**成立**的命题（`limitUpController.js:304-327` 仅改写 `lu.items`）扩大表述为"全站唯一写入"，并把"订阅集合排除"的作用域（非自选、非强势股）省略为无条件的"根本没有"。
- **影响范围**：不影响 P1 修复方向与结论，但属于 round 10 P2 同类的绝对化表述残留，会误导实现者忽略 momentum 快照写入路径与"自选标的报价存在时报价合并不会跳过"这一分支（后者直接关系到 `chartRowController.js:380-382` 的 `q === undefined` 前提）。
- **复现方法/验证证据**：`grep -rn "quotes\.set\|quotes\.delete\|\.quotes =" src/js/` → `app.js:952`、`momentumController.js:141/152`、`monitorController.js:44/50/132`。
- **修复建议**：`:277` 改写为"`limitUpController` 自身定时器仅拉取涨停列表、改写 `lu.items`，不写 `state.quotes`；`state.quotes` 的写入点为 `monitorController.js:44/50`、`app.js:952`（订阅开关兜底）、`momentumController.js:141/152`（强势股扫描），三者均不覆盖涨停页展开标的"；`:99` 补"若该标的已加入自选或订阅，`state.quotes` 中可能存在其报价实体，此时报价合并不会跳过（第一主因仅适用于未加自选的标的）"。
- **修复后验收标准**：全文中不存在"全站唯一写入 `state.quotes`"、"根本没有该标的的报价实体"一类无条件的绝对化表述；§2.3 与 §4.2 的"无报价供给"前提均带自选/强势股条件限定。

### P3（低）§2.3 表 A4 行"修复后预期表现"与本方案代码矛盾：显式历史日期报价仍会原地覆盖

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:110`（A4 行）；对照本方案代码 `:233-237`（改造点二 `loadKline` 修改后）、`:254-256`（`applyLiveTick` 修改后）；对照实现 `src/js/kline.js:409-412/420/439-453`。
- **触发条件**：`items` 末柱为 `2026-09-11`，注入携带显式历史日期的报价 `{ price: 21.00, date: '2026-09-10' }`。
- **实际行为与期望行为**：
  - 期望（A4 行"修复后预期表现"）："严格日期保护：`resolveLiveFallbackDate` 隔离，不覆盖末根蜡烛"。
  - 实际：`resolveLiveFallbackDate` 仅在报价**缺少全部日期字段**时被采用（`:236` `q.tradingDay || q.date || q.quoteDate || fallbackDate`；`:254` 亦以 `!quoteOrPrice.date` 为前提）。`date: '2026-09-10'` 命中短路链，`targetDate = '2026-09-10'`，`kline.js:420` 的 `lastDate < targetDate`（`'2026-09-11' < '2026-09-10'`）为假 → 落入 `kline.js:439-453` 原地覆盖。实测（真实 `applyLiveQuoteToKline`）：
    ```
    A4 len: 2 | last: 2026-09-11 close 21
    2026-09-11 bar close now: 21
    ```
- **根因**：§2.3 表把"无日期报价的兜底规范化"错误外推为"显式历史日期报价的隔离保护"，而方案的日期兜底治不了"报价自带历史日期"这一形态；§4.2 改造点二的 A 列表已只保留 A1~A3（丢弃 A4），说明该方案确实不覆盖 A4 —— 两处自相矛盾。
- **影响范围**：§2.3 表格结论与 §4.2 一致性受损；实现者/后继测试若按 A4 行断言"末根不被覆盖"必然失败，削弱文档作为验收依据的可靠性。属低频输入（生产主源腾讯自带 `quoteDate`，非历史日），不影响 T-1/T-2 主场景结论。
- **复现方法/验证证据**：见上条实测输出（真实模块直调）。
- **修复建议**：删除 A4 行的"修复后预期"或改为"仍原地覆盖 —— 显式携带历史日期字段的报价不在本方案覆盖范围"；如需覆盖，需在方案中显式追加保护（如 `targetDate < lastDate` 时丢弃该报价或归一为当前可用交易日），并同步 §4.2 改造点二的 A 列表。
- **修复后验收标准**：§2.3 表与 §4.2 的 A 场景集合一致（同为 A1~A3，或同时含 A4 并给出与之匹配的代码）；表内每一"修复后预期表现"均可由方案给出的代码直接推出。

### P3（低）§2.2 "恒命中前一天的约 199~240 根 Bar" 与本段自身公式互相矛盾

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:71`（§2.2 第 3 条 T-1 分支）；对照同段 `:67`（自身公式 `min(240, 320 - x)`）；对照上游 `src/js/kline.js:200`（腾讯 `lmt=320`）、`src/js/kline.js:409-412`。
- **触发条件**：当日盘中已生成 Bar 数 `x > 121`（约 11:31 之后）。
- **实际行为与期望行为**：
  - 期望：与自身公式一致地给出 T-1 保留根数范围。
  - 实际：按 `:67` 的 `min(240, 320 - x)`，T-1 保留根数随 `x` 从 240（`x=0`）单调降到 80（`x=240`，即 15:00 收盘）；`199~240` 仅在 `x ∈ [80, 121]` 区间成立。`:71` 以"**恒**命中前一天的约 199~240 根 Bar"表述，与 `x > 121` 时的实际值（如 `x=240` → 80 根）矛盾。
- **根因**：`199~240` 取自 `:67` 的上午 11:30 示例点（`x=121` → 199）并向上取到 `x≤80` 的满仓 240，未覆盖 `x ∈ (121, 240]` 的下午区间。
- **影响范围**：不改动结论（T-1 在任何 `x` 下均有 ≥80 根可合成伪分时，"T-1 恒处于覆盖带内"仍成立），但量化范围失准，且与同段公式自相矛盾。
- **复现方法/验证证据**：按 `:67` 公式直接算术 —— `x=121→199`、`x=200→120`、`x=240→80`。
- **修复建议**：改为"在 320 根窗口内命中前一天的 `min(240, 320 - x)` 根（`x≤80` 时 240 根，`x=121` 约 199 根，收盘 `x=240` 时 80 根），恒 ≥80 根，足以拼装出伪分时"，或在下方补一句"下午随 `x` 增长而递减"。
- **修复后验收标准**：§2.2 中所有 T-1/T-2 保留根数表述均可由 `min(240, 320-x)` / `max(0, 80-x)` 直接算出，无与之冲突的固定区间。

### P3（低）两处说明性数值与本仓库代码事实不符（§4.2 "≤3s"、§4.3 "共计 4 次"）

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:360`（"在 1 个报价周期（≤3s）内自动填充进 `state.quotes`"）、`:386`（"共计 4 次降级网络请求"）；对照代码 `src/js/app.js:151-157`（`REFRESH_OPTIONS`/`DEFAULT_REFRESH = 10000`）、`src/js/app.js:1569`、`src/js/controllers/monitorController.js:83-86`、`src/js/api.js:314-391`、`src/js/storage.js:226-235`。
- **触发条件**：读取上述两处结论；或按 §4.3 用例 3 的场景（`inst.selectedTradeDate = '2026-09-11'` 且日 K 末柱为 `2026-09-11`）构造缺信封的 `{ items: [], prevClose: 20.00 }` 桩。
- **实际行为与期望行为**：
  - (a) "≤3s"：监控页报价刷新区间 `state.refreshInterval` 默认 `DEFAULT_REFRESH = 10000`（`app.js:157/1569`，限涨停页自身为 `30000`，`storage.js:227`）；`3000` 仅为监控页可选档位（`app.js:151-156`）。默认情况下填充时延上界为 **10s** 而非 3s。
  - (b) "共计 4 次"：以真实 `fetchIntraday(code, { sharedCache: true, … })` 实测（缺信封桩，其余端点 500）——
    `allowLatestTickSource=false` → **4 次**（`/api/cache/intraday` + 2× `/api/eastmoney-kline` `klt=1` + 1× `/api/qq-kline-min … mkline`）；
    `allowLatestTickSource=true` → **5 次**（额外 1× `/api/eastmoney-kline/qt/stock/trends2/get`）。
    而 §4.3 用例 3 场景下 `chartRowController.js:445` 传入的 `isLatestKlineDate(inst,'2026-09-11')` 为 `true`（`app.js:717-718`，末柱日期相等），故实际为 **5 次**，"4 次"在文档自身用例前提下不成立。经核 round 10 的 4 次观测对应 `allowLatestTickSource=false` 探针。
- **根因**：两处均为"取最乐观/单一探针值"的量化表述，未绑定其成立条件（默认刷新区间档位、`allowLatestTickSource` 取值）。
- **影响范围**：仅说明性数值；§4.3 的核心结论（mock 必须包裹 `{ok,data}` 信封，否则触发降级瀑布并撞 `tests/_jsdom-setup.cjs:22-27` 的 `Unexpected network request`）经实测**成立**，不受影响。
- **复现方法/验证证据**：见上条实测 URL 列表与请求计数；(a) 由 `app.js:151-157/1569` 直接读出。
- **修复建议**：`:360` 改为"在 1 个报价周期内（默认 10s，可选 3s）"；`:386` 改为"至少 4 次降级网络请求（`allowLatestTickSource` 为真时另加 1 次 `trends2`，共 5 次）"。
- **修复后验收标准**：两处数值均带成立条件且与代码/探针实测一致。

## 三、待确认风险与未验证项

1. **待确认风险（调度保活后的连带行为）**：方案要求移除 `app.js:1607` 的无条件 `stopMonitorTimer()`，使监控页轮询在 `#/limit-up` 期间持续运行，从而每个周期触发 `onQuotes`（`app.js:1464-1468`：`mergeQuotesIntoMomentumItems` + `processAlerts` + `updateChartLastTickMulti`）与 `onRefresh`（`app.js:1469-1473`：逐个 `updateRowQuoteCells` + `applyLiveTicksToLimitUp`）。已核查这些回调对不存在 DOM 的场景是安全的（`views/monitorTableView.js:331-335` `if (!row) return;`；`limitUpController.js:411` `if (!isLimitUpDateToday()) return;`），**但语音告警（`processAlerts`）在涨停页期间被更频繁触发的用户可见行为未做端到端验证**。验证方法：在真实浏览器下于 `#/limit-up` 停留 ≥3 个刷新周期，确认不产生重复/异常播报。当前无法验证（需浏览器 + 真实行情）。
2. **未验证项**：§4.3 的 8 个用例均未实现，其可行性仅经静态契约核对（本轮已就 §4.3 的请求数、mock 信封、用例 7 可达性给出实证/证伪）；`resolveLiveFallbackDate` 与 `getRefreshCodes` 合流均未落地，端到端"展开→追加今日蜡烛"未在真实 DOM/定时器环境下执行。
3. **残余风险**：§2.2 的 320 根窗口结论仍以"东财 1m 冷却回退腾讯 320 源 + AKTools 历史分钟源不可用"为前提（文档已显式声明，`server/intradayService.js:170-182` 显示 AKTools 历史源默认启用）；本机离线，未对冷却态真实上游响应做在线验证，该前提的真实分布未测。
4. **未验证（环境限制）**：本轮未复跑 `npm run lint` / `npm run build` / Playwright E2E（74 例），仅复跑 QUnit `814/814`。

## 四、推荐修复顺序与复审验收标准

1. **先修 P2（测试有效性，关系到 round 10 P1 的闭环证据）**：按 §二 P2 的 4 条建议给出用例 7 的可达接入方式（`_internal()` 补调度层访问器，或 `app.js:1455` 注入 timers），并删除"或触发一次 `refresh()` 周期"这一绕过调度的等价分支。
2. **再修 P3**：按顺序 ①":277/:99 绝对化表述" → ②"§2.3 A4 行与 §4.2 一致" → ③"§2.2 `199~240` 与公式对齐" → ④"§4.2 `≤3s` / §4.3 `4 次` 带条件"。四项互不依赖。
3. **复审验收标准（全部须满足）**：
   - §4.3 用例 7 存在**可变异证伪**的断言：将 `app.js:1515` 改回 `!hasLimitUpRoot`（或 `app.js:1607` 恢复 `stopMonitorTimer()`）时该用例必须失败；
   - 全文不再出现"全站唯一写入 `state.quotes`"、"根本没有该标的的报价实体"等无条件绝对化表述；"无报价供给"前提均带自选/订阅条件限定；
   - §2.3 表与 §4.2 改造点二的 A 场景集合一致，且每条"修复后预期表现"可由方案代码直接推出；
   - §2.2 的 T-1/T-2 保留根数表述均可由 `min(240,320-x)`/`max(0,80-x)` 复算得出；
   - §4.2/§4.3 的量化数值（报价周期上界、降级请求次数）均带成立条件且与代码/探针一致；
   - 全文代码引用与行号再次逐条对齐 HEAD，`npm test` 复跑仍为 **814/814**。
