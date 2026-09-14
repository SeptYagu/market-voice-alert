# WorkBuddy 独立代码审查 round 2 交接（涨停看板图表修复 round 1 缺陷闭环 · 代码落地）

## 一、审查基本信息与通过项简述

- 被审 HEAD SHA：`76e9cd9`（`git pull --ff-only` 后 `Already up to date`，工作区干净）；基准 SHA：`f48e592`；实际审查范围：`git diff f48e592..76e9cd9`（19 文件 / +2221 / -38）；本轮增量范围：`git diff 892f1b8..76e9cd9`（4 文件：`tests/limitUpChartFixes.test.js` +99/-6、`STATUS.md`、round 1 报告、`INDEX.md`）。
- 通过项：round 1 两项缺陷的**主项**均已真实闭环——① P2-1：用例 7 已建立 `#/limit-up` 前置（`limitUpCtrl.setRootEl`），变异 M1（回退 `app.js:1511` 为 `!hasLimitUpRoot`）实跑使用例 7 **确定性变红**（`:334` 断言 `pollTimerAlive` actual `false`），(b)(c) 端到端链路已补齐；② P3-1：用例 5 盘前子场景已走真实 `loadKline` 合并链路，变异 M6（`chartRowController.js:391` → `getBeijingDate()`）实跑使用例 5 **确定性变红**（`:241` 长度 actual `3` expected `2`）；③ 门禁实跑全绿（`npm test` 820/820、`npm run lint` 0 问题、`npm run build` 成功）。
- 本轮**未通过**的原因：round 1 P3-1 的验收范围**仅部分闭环**（`:546` 注入点零覆盖，见 P3-1），且本轮新增的用例 7 前置引入了对 app 单例的**跨文件状态泄漏**（见 P3-2）。已独立设计 5 项生产装配探针 + 3 组变异实跑取证。

## 二、审查发现与缺陷清单

### P3-1 用例 5 盘前子场景未覆盖 `applyLiveTick` 注入点（`chartRowController.js:546`），round 1 P3-1 仅部分闭环

- **文件与行号**：`tests/limitUpChartFixes.test.js:180-250`（用例 5；盘前时钟 `:194-198`，纯函数断言 `:200-201`，集成 `loadKline` 段 `:203-246`）；未覆盖对象：`src/js/controllers/chartRowController.js:546-549`（`applyLiveTick` 内 `resolveLiveFallbackDate` 注入）与其下行 `:550` → `applyLiveTickToKlineChart`（`:116-137`）→ `applyLiveQuoteToKline`（`kline.js:420` 追加分支）。
- **触发条件**：将 `chartRowController.js:546` 的 `resolveLiveFallbackDate(code, inst, this.getTradingDates())` 变异为 `getBeijingDate()`（`:391` 保持不变），其余代码不变。
- **实际行为**：`limitUpChartFixes.test.js` **6/6 全绿**（`# pass 6 / # fail 0`），该实现偏差不被任何用例发现；`STATUS.md` 的 round 2 闭环声明仅引用 `chartRowController.js:391`。
- **期望行为**：round 1 明确要求盘前子场景**同时**执行 `loadKline` 报价合并**与** `applyLiveTick`，并要求「将 `chartRowController.js:391`（及 `:546`）的注入源变异为 `getBeijingDate()` 时，该用例必须失败」。
- **根因**：用例 5 的盘前段只调用 `mgr.loadKline(code)` 覆盖了 `:391`；唯一覆盖 `applyLiveTick` 的用例 4（`:134-177`）固定时钟为 `10:00`（`fixedMs = 2026-09-14T02:00:00Z`），此刻 `resolveStockChartDate(dates)` 与 `getBeijingDate()` 同值 `2026-09-14`（交易日历含当日）→ 该用例对 `:546` **结构性不敏感**，与本轮探针实测一致。
- **影响范围**：盘前（`hour*60+minute < 555`）无日期快照经 `applyLiveTick` 追加未开盘当日幽灵 Bar 的行为失去回归防护；实现本身正确（本轮探针实测基线不追加），但后续重构误用 `getBeijingDate()` 不会被门禁拦截。可达性受限（`marketSession.isAutoRefreshAllowedInSession` 对 `pre-open/closed/lunch` 返回 `false`，盘前正常不触发轮询 → 该路径盘前需手动刷新等旁路才可达），故定级 P3 而非 P2。
- **复现方法/验证证据**（全部在受审仓库外的临时副本 `D:\tmp\mva-r2` 内执行，未改动受审仓库）：
  1. 变异 M7（仅 `sed -i '546s/.../'` 改 `:546` 为 `getBeijingDate()`）→ `node node_modules/qunit/bin/qunit.js --require ./tests/_jsdom-setup.cjs tests/limitUpChartFixes.test.js` → `# pass 6 / # fail 0`。
  2. 独立生产装配探针（真实 `limitUpChartMgr` 单例，`hasIntraday: true`，`klineCtlMap` 注入桩 ctl，固定时钟 `2026-09-14 09:00+08:00`，`tradingDates = ['2026-09-10','2026-09-11','2026-09-14']`，无日期 Tick `{price:22}`）：
     - 基线（`resolveLiveFallbackDate`）：末柱仍为 `2026-09-11`，长度 2，**无** `2026-09-14` 幽灵 Bar（探针 P2 `ok`）；
     - M7（`getBeijingDate()`）：追加 `2026-09-14` 幽灵 Bar，探针 P2 `not ok` —— 证明该变异**可被观测、可被普通用例捕获**，属真实可测的覆盖缺口而非不可测项。
  3. 边界探针：`resolveLiveFallbackDate` 在 `09:14:59` → `2026-09-11`，`09:15:00` → `2026-09-14`（分界与 `tradeCalendar.js:121` 设计一致，无异常）。
- **修复建议**：在用例 5 盘前段（`:203-246`）之后，于同一 `09:00` 时钟与同一 `tradingDates` 下，用真实 `ChartRowManager`（或生产 `limitUpChartMgr`）对已装载 `…2026-09-11` 末柱的实例调用 `applyLiveTick(code, { price: 21.00 })`，断言 `items.length` 保持 2、末柱 `time === '2026-09-11'`、`items.some(i => i.time === '2026-09-14') === false`。
- **修复后的验收标准**：`chartRowController.js:546` 变异为 `getBeijingDate()` 时该断言必须失败；恢复 `resolveLiveFallbackDate` 时全绿；`:391` 的 M6 敏感性不得退化。

### P3-2 用例 7 建立 `#/limit-up` 前置后未停涨停看板定时器，泄漏 `state.limitUp.timer` 至 app 单例并在测试文件间残留

- **文件与行号**：`tests/limitUpChartFixes.test.js:305-306`（`limitUpCtrl.setRootEl(fakeRoot)`）、`:313-317`（`state.limitUp.autoRefreshEnabled = true`、`refreshInterval = 10000`）、`:348-357`（`finally`：`:349` 复位 root、`:356` 仅 `monitorCtrl.stopTimer()`）；被泄漏状态：`src/js/app.js:1513`（`state.limitUp.autoRefreshEnabled && hasLimitUpRoot`）→ `:1520-1522`（`if (!state.limitUp.timer) startLimitUpTimer(...)` → `limitUpController.js:438` `lu.timer = setInterval(...)`）。
- **触发条件**：在测试文件内（`hooks.beforeEach` 已把 `globalThis.setInterval` 换为登记桩）运行该文件至用例 7 结束。
- **实际行为**：用例 7 的 `finally` 只停掉监控轮询定时器，`state.limitUp.timer` 保留桩返回的句柄 `1002`（独立探针实测 `actual: 1002, expected: null`）。
- **期望行为**：用例结束后 app 单例恢复至进入前状态——`state.limitUp.timer === null`、`limitUpRootEl === null`、暂停标志与集合无残留（round 1 修复建议第 5 条即要求「清零 `state.limitUp.expandedCodes` / 停表，避免跨用例状态泄漏」）。
- **根因**：`applyDataRefreshSchedule()` 在 `hasLimitUpRoot === true` 且涨停看板 autoRefresh 开启、时段允许时经 `startLimitUpTimer` 启动定时器并把句柄写入 `state.limitUp.timer`；该写入发生在被测函数内部，而 `finally` 仅调用 `monitorCtrl.stopTimer()`，未走涨停看板停表路径。`app.js:1520` 是 `state.limitUp.timer` 全仓**唯一**消费点，其判据是「句柄为假值即启动」。
- **影响范围**：同一测试进程内（`scripts/run-tests.mjs` 以 `tests/**/*.test.js` 一次性喂给 QUnit）任何后续用例若建立 `#/limit-up` 前置并期望涨停定时器被启动，将因 `!state.limitUp.timer === false` 而**静默跳过启动**，形成顺序依赖的假通过/假失败。当前 820 例全绿（`phaseCFixes.test.js`/`tts.test.js` 等后续触达 app 单例的文件均未依赖该判据），故属潜在风险而非现行失败。本轮为该缺陷的**首次引入**：`892f1b8` 版本用例 7 未挂载 root，`hasLimitUpRoot === false` 走 `app.js:1524-1525` 的 `stopLimitUpTimer` 分支，无泄漏。
- **复现方法/验证证据**（临时副本 `D:\tmp\mva-r2`，未改动受审仓库）：
  - 临时探针文件 `tests/probeLeak.test.js`（仅断言 app 单例不变量）与受审用例同进程串行执行：
    `node node_modules/qunit/bin/qunit.js --require ./tests/_jsdom-setup.cjs tests/limitUpChartFixes.test.js tests/probeLeak.test.js`
    → `not ok 7 probeLeak … message: state.limitUp.timer 已清零 / actual: 1002 / expected: null`；同一探针的 `limitUpRootEl`、`autoRefreshPausedBySchedule`、`loading`、`quotes`、`limitUp.expandedCodes` 断言均通过（泄漏点唯一）。
- **修复建议**：在用例 7 的 `finally` 中补停涨停看板定时器并在桩环境下同步清零句柄——最小改动为 `state.limitUp.timer = null;`（`clearInterval` 由 `afterEach` 的桩清理兜底）；更一致的方案是经 `_internal()` 暴露 `stopLimitUpTimer`（本轮已把 `monitorCtrl`/`applyDataRefreshSchedule` 挂到 `_internal()`，语义一致）并在 `finally` 调用。
- **修复后的验收标准**：在 `limitUpChartFixes.test.js` 之后串行执行不变量探针，`state.limitUp.timer` 必须为 `null`；全量门禁仍全绿。

## 三、待确认风险与未验证项

- **待确认风险（承接 round 1，本轮未变化、仍未定级）**：`applyLiveQuoteToKline` 追加分支（`kline.js:420`）无停牌/陈旧守卫，降级无日期快照在停牌标的上可能生成「假当日蜡烛」。缺少证据：真实停牌标的在腾讯/东财两源下的返回形态（离线环境不可得）。验证方法：离线桩分别构造 `stale=true` 与停牌（非交易态 `marketStatus`）快照走 `applyLiveTick`，观察是否新增 Bar。
- **未验证项（承接 round 1）**：① 真实数据源端到端（腾讯主源降级东财、AKTools 分钟源可用性）未在真实网络下验证，报价形态均由离线桩构造；② 未在真实浏览器/真实盘中时段实机运行 `#/limit-up` 展开链路，本轮证据全部来自 jsdom + 固定时钟 + 变异实跑。
- **已核验不构成缺陷（仅记录，不展开）**：用例 7 的 (b) 断言仅检查「发生过 `/api/tencent/` 请求」而非请求批次内容，但经「`refresh()` 批次丢弃 expandedCodes」变异在单文件与全量两种跑法下实测**均能变红**（单文件 `:343` `fetchCalled` 失败；全量跑法 `state.quotes` 缺失该标的而失败），故不另立缺陷。

## 四、推荐修复顺序与复审验收标准

1. **先修 P3-1**：补 `applyLiveTick` 盘前合并断言，以「`:546` 变异 ⇒ 用例失败、`:391` 变异仍失败、恢复 ⇒ 全绿」为自检。
2. **再修 P3-2**：`finally` 补停涨停看板定时器并清零 `state.limitUp.timer`，以串行不变量探针为自检。
3. **文档同步**：`STATUS.md` 的 round 2 闭环声明须覆盖 `:546` 与实际断言范围，不得只引用 `:391`。
4. **复审验收标准（须同时满足）**：① 用例 5 盘前子场景对 `chartRowController.js:391` 与 `:546` 两处 `getBeijingDate()` 变异均确定性失败；② 用例 7 结束后 `state.limitUp.timer === null`（串行不变量探针可验证），且 M1 变异仍确定性失败、(b)(c) 断言不退化；③ 全量门禁（lint / 820+ 例 / build）全绿；④ 无任何级别未闭环缺陷。
