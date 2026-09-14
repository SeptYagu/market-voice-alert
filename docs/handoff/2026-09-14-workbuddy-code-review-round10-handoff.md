# WorkBuddy 独立代码审查 round 10 交接（涨停看板历史日期图表修复方案）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`0305357`（`docs(handoff): 闭环审查 round 9 缺陷…`）；基准：`f48e592`；实际审查范围：`git diff f48e592..0305357 --stat` = 5 文件 / +542 / -22（`AGENTS.md`、`STATUS.md`、`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`、`docs/handoff/2026-09-14-workbuddy-code-review-round9-handoff.md`、`docs/handoff/INDEX.md`），全为文档类改动；`git pull --ff-only` 结果 `Already up to date`，工作区干净。
- 通过项简述：文档逐行追踪了 `resolveTradeDate → loadKline → applyLiveQuoteToKline → fetchIntradayNetwork → getCachedKline` 全部调用链，其 §2.2 的 320 根滑动窗口算术（T-1 = `min(240, 320-x)`、T-2 = `max(0, 80-x)`，x=80 处 T-2 归零）、§2.4 的 `isLatestKlineDate` 假阳性被 `intradayService.js:261` 中和、§4.3 的盘前 `resolveStockChartDate` 锚定（09:00→`2026-09-11`）经独立脚本逐一复算**全部成立**；全文 17+ 处代码引用、`32da3ca→eae67ae` 迁移链、`tests/_jsdom-setup.cjs:14-21/22-27` 与 `app.js:1645 _internal()` 行号**逐条与 HEAD 一致**；`npm test` 复跑 **814/814 通过**（文档"814 例"属实）。round 9 的 P2（Tick 路径遗漏）与 4 项 P3 在文字层面均已落实。缺陷集中在 §4.2 改造点四的落地层次与 §4.1.4/§4.2 的根因前提表述。

## 二、审查发现与缺陷清单

### P1（高）改造点四只改 `getRefreshCodes()`，但 `#/limit-up` 路由下行情轮询器被整体停摆 —— round 9 的 P1 未闭环

- **文件与行号**：`src/js/app.js:1602-1614`（路由）、`src/js/app.js:1508-1515`、`src/js/controllers/monitorController.js:78-88`、`src/js/controllers/monitorController.js:14-21`、`src/js/app.js:1542-1544`。
- **触发条件**：用户停留在 `#/limit-up`（无论看板日期是今天还是 T-1/T-2），展开任意标的图表（含文档 §4.3 用例 6 设定的历史日期 + `expandedCodes` 场景）。
- **实际行为与期望行为**：
  - 期望（文档 §4.1.5 / §4.2 改造点四 技术效果）：该 code "立即作为活跃图表订阅进入后台轮询，在 1 个报价周期（≤3s）内自动填充 `state.quotes`"，并"驱动 `updateChartLastTickMulti` 持续注入 Tick 并维持 10s 分时定时刷新"。
  - 实际：`state.quotes` **永远不会**新增该 code。改造点四命中的 `getRefreshCodes()` 只有一个消费方 —— 已被停摆的 `refresh()`。
- **根因**：改造点四作用于错误的层次（订阅集合），而真正断链的是**调度层**：
  1. `src/js/app.js:1602` `'#/limit-up': (r) => {` 处理器在第 1607 行显式 `stopMonitorTimer();`（= `monitorCtrl.stopTimer()`，`app.js:1494`），第 1610 行 `limitUpCtrl.setRootEl(r)`，第 1613 行再调 `applyDataRefreshSchedule()`。
  2. `app.js:1508-1515`：`applyDataRefreshSchedule()` 先取 `const hasLimitUpRoot = Boolean(limitUpCtrl.getRootEl())`（1513），再执行 `monitorCtrl.applySchedule(allowed, !hasLimitUpRoot)`（1515）。在 `#/limit-up` 上 `hasLimitUpRoot === true`，故 `visible === false`。
  3. `monitorController.js:82`：`if (!visible || !state.autoRefreshEnabled || !allowed) stopTimer();` —— `timer` 被清空且 83-87 行的 `else if` 分支不再可达，`timers.setInterval(() => refresh(...))`（86 行）永不建立。
  4. `monitorController.js:14-21` 的 `getRefreshCodes()` 仅被 `refresh()` 使用（25、38 行）；`refresh()` 仅由上述定时器或显式 `refreshNow()` 触发。`grep -rn "getRefreshCodes" src/` 全仓只有 `monitorController.js`（14/25/38/139）与一个单测，无其他调用方。
  5. `app.js:1542-1543` `monitorCtrl.startChecker(warmTradeCalendar, applyDataRefreshSchedule)` 每 30s 重新执行同一调度，`visible=false` 状态被持续刷新（`monitorController.js:104`），不会自愈。`restartTimer()`（`app.js:1493`）只在监控页"刷新间隔/自动刷新"开关（`app.js:798`、`app.js:1499`）被调用，涨停页无此入口。
  6. `state.quotes` 的全部写入点：`monitorController.js:44/50`（即被停摆的 `refresh()`）、`app.js:952`（订阅开关时用 momentum 条目兜底）、`momentumController.js:141/152`（10 日强势股扫描）。三者都不覆盖"涨停看板展开的标的"，`limitUpController.enrichLimitUpItemsWithQuotes`（`limitUpController.js:304-327`）只改写 `lu.items`，**不写 `state.quotes`**。
- **影响范围**：文档"默认展开最新图（具备实时 Tick 注入与定时刷新）"（§4.1.3）、§4.2 改造点四 全部技术效果、§4.4"风险等级：低 / 改动严格受控在 3 处局部点位 / 不影响主监控表格等业务链路"三处结论均不成立；按文档实施方案落地后，用户在主场景（历史看板展开未加自选的涨停标的）仍会看到：日 K 若命中盘前遗留的 1d 缓存则今日蜡烛永不追加（`chartRowController.js:380-382` 因 `q === undefined` 跳过合并），分时仅展开时拉取一次、随后冻结（`app.js:1354-1358` 的 `if (!q) continue` 恒命中，`refreshLiveIntradayForCode` 永不被调用）。
- **复现方法/验证证据**（静态调用链逐行追踪 + 全仓 grep，均为 HEAD 实测）：
  ```
  # 订阅集合的唯一消费方（无第二条通路）
  $ grep -rn "getRefreshCodes" src/ tests/
  src/js/controllers/monitorController.js:14/25/38/139 ；tests/phaseAFixes.test.js:79/86（单测）
  # 调度停摆链
  app.js:1607 stopMonitorTimer();  -> monitorController.js:73-76 clearInterval
  app.js:1513 hasLimitUpRoot=true  -> app.js:1515 applySchedule(allowed, false)
  monitorController.js:82 !visible -> stopTimer()（86 行 setInterval 不建立）
  # quotes 写入点
  $ grep -rn "quotes\.set" src/js/
  app.js:952 / momentumController.js:141,152 / monitorController.js:44,50
  ```
- **修复建议**：把改造点四从"订阅集合层"上移到"调度层"，二者都要做：
  1. `src/js/app.js:1515` 不再用 `!hasLimitUpRoot` 关闭共享行情轮询（涨停页同样依赖 `state.quotes`）。最小改法：`monitorCtrl.applySchedule(allowed, true)`，或引入显式语义 `needsSharedQuotes = hasMonitorRoot || hasLimitUpRoot` 后传 `visible = needsSharedQuotes`；同时删除 `app.js:1607` 路由入口处的无条件 `stopMonitorTimer()`（若确需清理监控页资源，改为只 `closeAllCharts()`，保留轮询）。
  2. 保留改造点四对 `getRefreshCodes()` 的 `expandedCodes` 合流作为订阅集合来源（此改动本身正确、无害）。
  3. 同步修正 §4.1.5/§4.4 的表述：本次改动**必然涉及 `app.js` 调度层**，不再是"3 处前端局部点位 / 风险低"，并说明 `limitUpController` 自身定时器（`limitUpController.js:startLimitUpTimer`）只驱动历史列表拉取，不能替代共享行情轮询。
- **修复后的验收标准**：在 `#/limit-up` 且 `state.limitUp.selectedDate` 为历史日期、`state.autoRefreshEnabled` 为真、交易时段内：展开标的并等待 ≥1 个 `state.refreshInterval` 后，(a) 下一次 `fetchQuotes` 批次包含该 code；(b) `state.quotes` 存在该 code 实体；(c) `updateChartLastTickMulti()` 被触发且图表日 K 追加当日蜡烛（当日 1d 缓存缺当日柱时）；(d) `refreshLiveIntradayForCode` 按 10s 节流持续被调用。测试需断言 (a)~(b) 的实际请求/状态，而非仅断言 `getRefreshCodes()` 返回值（见 P2-b）。

### P2（中）根因前提失实：股票快照报价的**主源**（腾讯）携带 `quoteDate`，"恒不携带日期字段 / 恒定原地覆盖"与生产数据通路及文档自身代码相矛盾

- **文件与行号**：文档 §4.1.4（`在股票快照行情流（parser.js:108-126）恒不携带 tradingDay/date/quoteDate 字段的现实管线下`）、§4.2 改造点二 问题现状 2（`恒定落入 kline.js:439-453 的原地覆盖分支`）；对应代码 `src/js/api.js:150-176`、`src/js/parser.js:64/82`、`src/js/kline.js:409-420`。
- **触发条件**：任何一次常规股票报价（`state.quotes` 中的十/沪股实体）。
- **实际行为与期望行为**：
  - 期望：文档所述"股票快照行情流恒不携带日期字段"成立，故 Tick 路径"恒定"原地覆盖昨日收盘柱。
  - 实际：`fetchQuotes`（`api.js:150`）对股票**先请求腾讯**（`api.js:161 tencentQuotes = await fetchTencent(stocks, opts)`），仅对腾讯未返回的 code 才回退东财（`api.js:172 fetchEastmoney(missingStocks)`）；`parseTencent` 会写入 `quoteDate`（`parser.js:64` 取 14 位 `fields[30]`，`parser.js:82 quoteDate: updateTime ? updateTime.slice(0,8) : ''`）；`kline.js:409` 对 8 位 `quoteDate` 做日期归一，`targetDate` 非空 → 命中 `kline.js:420` 的**追加**分支而非覆盖分支。
- **根因**：文档把"东财快照解析器（`parser.js:93-127`，确无日期字段）"误表述为"整个股票快照行情流"，并把该情形下的条件性缺陷（§2.3 已用"例如东财"作了限定）在 §4.1.4/§4.2 中绝对化为"恒不携带 / 恒定落入"；这同时与 §4.2 自己给出的代码 `q.tradingDay || q.date || q.quoteDate` 自相矛盾。
- **影响范围**：主场景下"缺少今日日 K"的真正第一因是**无报价供给**（P1，`q === undefined`）与 1d 缓存未含当日柱，而非 Tick 原地覆盖；按文档叙述排优先级会把实现者引向"先修 Tick 覆盖"（而该路径在主源下本就追加正确），延误 P1 的调度层修复。§2.3"共性缺陷"的成立条件也比文档给出的更窄。
- **复现方法/验证证据**：独立脚本（`applyLiveQuoteToKline` 真实模块）：
  ```
  items 末柱 = 2026-09-11
  A1 quote {price:21}                    -> len 2 | last 2026-09-11 close 21   （原地覆盖，文档情形）
  A2 quote {price:21, quoteDate:'20260914'} -> len 3 | last 2026-09-14 close 21 （追加，腾讯主源情形）
  A3 quote {price:21, date:'2026-09-11'} -> len 2 | last 2026-09-11 close 21   （§2.3 T-1）
  A4 quote {price:21, date:'2026-09-10'} -> len 2 | last 2026-09-11 close 21   （§2.3 T-2）
  ```
  A2 即 `parseTencent` 产出的报价形态，证明 §4.2 问题现状 2 的"恒定落入覆盖分支"不成立。
- **修复建议**：把 §4.1.4 的"股票快照行情流恒不携带日期字段"改写为准确的取源事实：股票报价主源为腾讯（`api.js:150-176`），`parseTencent` 在 `fields[30]` 为 14 位时给出 `quoteDate`（`parser.js:64/82`）；缺日期字段的情形仅出现在腾讯回退东财（`parser.js:93-127`）或腾讯字段缺失（`quoteDate: ''`）时。§2.3 / §4.1.4 / §4.2 三处前提统一为同一条件式表述，并把"日 K 缺今日柱"的第一因改为"无报价供给 + 1d 缓存未含当日"。
- **修复后的验收标准**：全文中不再出现"股票快照行情流恒不携带 / 恒定落入覆盖分支"一类绝对化表述；文档给出的触发条件可用 `api.js:161/172` + `parser.js:82` 直接复核；§2.3 与 §4.2 的缺陷复现步骤对"腾讯主源报价"与"东财回退报价"两种输入分别给出预期结果。

### P3（低）§4.3 建议的 `/api/cache/intraday` mock 桩缺少响应信封，照抄会导致测试走完降级瀑布并触发 harness 断言

- **文件与行号**：文档 §4.3 测试约定第 3 条（`必须同步提供 /api/cache/intraday 的 Mock 桩（例如响应 { items: [], prevClose: 20.00 }）`）；对应代码 `src/js/api.js:405-425`（信封校验 `api.js:415`、返回 `api.js:419`）、`tests/_jsdom-setup.cjs:22-27`。
- **触发条件**：按文档写法为 `/api/cache/intraday` 提供 `{ items: [], prevClose: 20.00 }` 作为响应体。
- **实际行为与期望行为**：
  - 期望：一次请求即短路返回，`loadKline` 尾部链路"畅通无报错"。
  - 实际：`_fetchIntradayFromSharedCache` 要求 `json.ok === true && json.data`（`api.js:415`），该桩不满足 → 抛 `shared intraday cache failed`；`fetchIntraday`（`api.js:314-402`）随即继续走东财 1m K（2 次尝试）、腾讯 mkline 等降级请求。若测试只对 `/api/cache/intraday` 定制响应、其余 URL 委托给底座默认 `fetch`，则这些额外请求会命中 `tests/_jsdom-setup.cjs:22-27` 的 `Unexpected network request` 断言。
- **根因**：共享缓存端点使用 `{ok, data}` 信封（`api.js:415/419`），文档示例给了内层 data 的形态；同类契约在第 515/519 行也存在（另一个缓存端点）。
- **影响范围**：仅影响 §4.3 测试矩阵的可落地性（实现方案本身不受影响）；有明确规避方案。
- **复现方法/验证证据**：独立脚本调用真实 `fetchIntraday(code, { sharedCache: true, date, prevClose, allowLatestTickSource: false })`：
  ```
  mock {items:[],prevClose:20}              -> OK, source=none, items=0；实际发起 4 次请求
       ['/api/cache/intraday?...', '/api/eastmoney-kline/...klt=1', '/api/eastmoney-kline/...klt=1', '/api/qq-kline-min/...mkline...']
  mock {ok:true,data:{items:[],prevClose:20}} -> OK, items=0；仅发起 1 次请求（正常短路）
  ```
  另：文档同段"生产代码中 `loadKline` 尾部**无条件**调用 `this.loadIntraday(...)`"亦不准确 —— `chartRowController.js:397` 为 `if (this.hasIntraday) {`，`momentumChartMgr`（`hasIntraday: false`）不会发起该请求。
- **修复建议**：将示例桩改为 `{ ok: true, data: { items: [], prevClose: 20.00 } }`；把"无条件调用"改为"`this.hasIntraday` 为真时调用"。
- **修复后的验收标准**：按文档桩形态实现的单测，在只定制 `/api/cache/intraday` 的前提下恰好产生 1 次该端点请求、无 `Unexpected network request` 断言，且 `loadIntraday` 结束时不置 `inst.intradayError`。

> 说明：§4.3 用例 6（`getRefreshCodes()` 断言含 `sh600777`）在改造点四实施后**会通过**，但无法证伪 P1 —— 它只验证订阅集合输出，不验证"报价是否真的到达 `state.quotes` / 定时器是否在跑"。该用例作为 P1 的闭环证据不足，需按 P1 验收标准补集成级断言（见 §四）。

## 三、待确认风险与未验证项

1. **待确认风险（时钟）**：§4.3 只声明"在 `beforeEach` 中将全局 `Date` 显式重设为目标盘中固定时刻"，未规定该重设是否同时覆写 `static now()`。底座 `TestDate` 的 `now()` 与无参构造共享 `anchor + RealDate.now() - started`（`tests/_jsdom-setup.cjs:14-21`）；若实现为"只覆写构造函数、不覆写 `now()`"，`new Date()` 与 `Date.now()` 将返回不同时刻，`resolveStockChartDate`/`getBeijingDate` 与基于 `Date.now()` 的节流（如 `refreshLiveIntradayForCode` 的 `Date.now() - inst.intradayLastFetchAt < 10000`，`app.js:1325`）会分裂，仍有 Flaky 余量。**验证方法**：实现测试后连续运行该模块 ≥20 次并交叉复算；或直接在重设处同时固定 `now()`。当前无法验证（测试代码尚不存在）。
2. **未验证项**：文档 §4.3 的 7 个用例均未实现，故其"可执行性"仅经静态契约核对（本报告已就 mock 契约给出 P3）与有针对性的探针（P1/P2/P3 证据脚本）；`getRefreshCodes()` 的真实轮询到达性无法在无实现状态下端到端复现，P1 的证据为调用链 + 全仓写入点穷举。
3. **残余风险**：§2.2 的 320 根窗口结论以"东财 1m 冷却回退腾讯 320 源且 AKTools 历史分钟源不可用"为前提（文档已显式声明）；本机无外网，未对冷却态下的真实上游响应做在线验证，该前提的真实分布未测。

## 四、推荐修复顺序与复审验收标准

1. **先修 P1（调度层）**：`app.js:1515` 的 `visible` 语义改为"任一需要共享行情的页面挂载即为真"，并移除 `app.js:1607` 的 `stopMonitorTimer()`；保留改造点四的 `getRefreshCodes()` 合流。同步改写 §4.1.5/§4.2 改造点四/§4.4 的涉及文件、改动点数与风险等级。
2. **再修 P2（前提表述）**：按 `api.js:150-176` + `parser.js:64/82` 重写 §4.1.4 与 §4.2 改造点二 问题现状 2，统一 §2.3/§4.1.4/§4.2 的条件式口径。
3. **最后修 P3（测试契约）**：修正 mock 信封与"无条件调用"表述；补一条能证伪 P1 的集成级断言。
4. **复审验收标准**（全部须满足）：
   - §4.2 改造点四明确列出 `src/js/app.js` 调度层改动，并说明 `#/limit-up` 下共享行情轮询保持运行的机制；
   - 文档中不存在与 `api.js` / `parser.js` 相冲突的"恒不携带 / 恒定覆盖"绝对化表述，§2.3、§4.1.4、§4.2 前提一致；
   - §4.3 mock 桩符合 `{ok,data}` 信封，且用例 6 之外新增"展开→下一次 `fetchQuotes` 批次含该 code→`state.quotes` 有实体"的断言；
   - 时钟重设契约明确同时固定 `new Date()` 与 `Date.now()`；
   - 全文代码引用与行号再次逐条对齐 HEAD，`npm test` 复跑仍为 814/814。
