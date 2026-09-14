# WorkBuddy 独立代码审查 round 1 交接（涨停看板切历史日期图表修复与行情调度层解耦 · 代码落地）

## 一、审查基本信息与通过项简述

- 被审 HEAD SHA：`892f1b8`（`git pull --ff-only` 后 `Already up to date`，工作区干净）；基准 SHA：`f48e592`；实际审查范围：`git diff f48e592..892f1b8`（18 文件 / +2040 / -38：产品代码 3 文件、测试 2 文件、其余为文档）。
- 通过项：需求 1（`app.js:413` 移除 `isHistorical` 劫持，变异 M3 实跑使用例 1&2 变红）、需求 2（`chartRowController.js:391/546` 双链路注入，变异 M4/M5 实跑分别使用例 3/4 变红）、需求 3 的产品代码路径（独立端到端探针：挂载 root 后 `pollTimerAlive=true` → 执行 `pollTimerId` 回调 → 请求 `/api/tencent/q=sh600777` → `state.quotes` 写入 `{price:21, quoteDate:'20260914'}`）、需求 4（实跑 `npm test` 820/820、`npm run lint` 0 错误 0 警告、`npm run build` 成功）均已实际生效，未发现产品代码级 P0~P3 缺陷；关键调用链（`loadKline → resolveTradeDate/loadIntraday`、`onQuotes → updateChartLastTickMulti → limitUpChartMgr.applyLiveTick`、`getRefreshCodes → refresh`）无异常。
- 本轮**未通过**的原因在测试矩阵：新增用例相对方案 §4.3 被降级为「接入点/纯函数」断言，其断言层级与断链/注入层级不一致，已通过变异实跑证明存在 1 项**不可证伪**的假通过用例与 1 项零覆盖的注入点。

## 二、审查发现与缺陷清单

### P2-1 用例 7 在验收标准 3 被破坏时仍然全绿（断言层级未落在调度层同一层），且 §4.3 用例 7 的 (b)(c) 端到端断言完全缺失

- **文件与行号**：`tests/limitUpChartFixes.test.js:250-266`（用例 7 全文；缺前置在 `:251-262`，断言在 `:262-263`）；被保护对象为 `src/js/app.js:1508-1511`；对照要求：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:465-469`（§4.3 用例 7 (a)(b)(c) 与「变异证伪性保证」）。
- **触发条件**：将 `app.js:1511` 的 `monitorCtrl.applySchedule(allowed, needsSharedQuotes)` 回退为修复前的 `monitorCtrl.applySchedule(allowed, !hasLimitUpRoot)`（即验收标准 3「`#/limit-up` 下后台行情轮询保活」失效），其余代码不变。
- **实际行为**：用例 7 及该文件全部 6 个用例**全部通过**（变异 M1 实跑：`# pass 6 / # fail 0`）；而 §4.3:469 要求「变异后用例在第 (a) 步与第 (b) 步均确定性报错失败」。
- **期望行为**：修复被回退时用例必须失败；用例应在 `#/limit-up` 真实前置（`limitUpCtrl.setRootEl(container)`）下断言 `pollTimerAlive === true`。
- **根因**：用例 7 从未建立 `#/limit-up` 的前置状态——既不调用 `limitUpCtrl.setRootEl(...)`（该函数已由 `app.js:433` 导出，可被测试直接使用），也不经路由处理函数，因此测试环境恒有 `hasLimitUpRoot === false`；而修复前的表达式 `applySchedule(allowed, !hasLimitUpRoot)` 在 `hasLimitUpRoot === false` 时取值 **恒为 `true`**，与修复后的 `applySchedule(allowed, true)` 完全等价 → 该前置下两个版本行为一致，断言无法区分。用例第 `:262` 行断言文案「涨停看板挂载后 pollTimerAlive 恒为 true」与真实前置（未挂载任何看板根节点）不符，掩盖了该缺口。此外 §4.3:468 要求的 (b)（经 `pollTimerId` → `registeredTimers` 取得轮询条目并执行其回调，断言自动触发 `fetchQuotes` 且批次含展开标的）与 (c)（断言 `state.quotes` 写入并驱动 `updateChartLastTickMulti`）在本轮测试中**完全未实现**，`STATUS.md` 亦仅自述「覆盖…调度层保活接入点」。
- **影响范围**：验收标准 3 与方案 §4.3「P1 闭环覆盖（变异可证伪）」均无有效证据；后续任何一轮改动若回退 `app.js:1511`（或调整其语义），820 例全绿门禁不会报警，`#/limit-up` 下展开标的将再次失去报价供给（今日蜡烛、Tick 注入、10s 分时刷新全部失效）。
- **复现方法/验证证据**（临时探针置于仓库外 `%TEMP%`，试验性仓库副本 `D:\tmp\mva-mut`，未改动受审仓库）：
  1. M1 变异（仅回退 `app.js:1511`）后实跑 `node node_modules/qunit/bin/qunit.js --require ./tests/_jsdom-setup.cjs tests/limitUpChartFixes.test.js` → `6/6 pass`（用例 7 未失败）。
  2. 同构探针（真实 `app.js` 单例 + `globalThis.setInterval/clearInterval` 沙盒 + 固定时钟 `2026-09-14 10:00+08:00`）：
     - 无 root（= 用例 7 真实环境）：`pollTimerAlive=true`（修复版与回退版**相同**）；
     - 挂载 root（= `#/limit-up` 真实状态）：修复版 `pollTimerAlive=true, pollTimerId=1001, registered=[1001:10000, 1003:30000]`；回退版 `pollTimerAlive=false, pollTimerId=null, registered=[30000]`。
  3. 端到端探针（按 §4.3 (b)(c) 设计）：修复版执行 `pollTimerId` 回调后 `quoteUrls=["/api/tencent/q=sh600777"]`、`state.quotes.get('sh600777')={price:21,quoteDate:'20260914'}`；回退版 `quoteUrls=[]`、`state.quotes` 无该实体 —— 证明 (b)(c) 断言确实可落地且可证伪。
- **修复建议**（须同时满足，(a)(b)(c) 三处断言缺一不可）：
  1. 前置：`import { limitUpCtrl } from '../src/js/app.js'`，在用例内 `limitUpCtrl.setRootEl(document.createElement('div'))` 建立 `#/limit-up` 语义（`finally` 中置回 `null`），并保持 `state.autoRefreshEnabled === true`、盘中时钟；
  2. (a) 执行 `_internal().applyDataRefreshSchedule()` 后断言 `pollTimerAlive === true` 且 `pollTimerId !== null`；
  3. (b) 将历史看板标的加入 `state.limitUp.expandedCodes`，由 `registeredTimers.get(pollTimerId)` 取出条目（断言 `entry.ms === state.refreshInterval`），**执行其回调**（不得直接调用 `refresh()`），断言捕获的 `fetchQuotes` 请求 URL 批次（`/api/tencent/q=...`）包含该标的；
  4. (c) 桩返回该标的报价后，断言 `state.quotes.get(code)` 已写入且 `onQuotes → updateChartLastTickMulti` 已执行；
  5. 清零 `state.limitUp.expandedCodes` / 停表，避免跨用例状态泄漏。
- **修复后验收标准**：将 `app.js:1511` 变异为 `!hasLimitUpRoot` 时，用例必须在 (a)(b)(c) 至少一处确定性失败；恢复 `needsSharedQuotes = true` 时全绿（两类变体均已由本轮探针实证可行）。同时 `STATUS.md` 的测试覆盖描述须与实现一致（不得再以「接入点」表述替代端到端断言）。

### P3-1 盘前锚定注入（`loadKline`/`applyLiveTick` 注入 `resolveStockChartDate` 而非 `getBeijingDate()`）无任何用例可证伪

- **文件与行号**：`tests/limitUpChartFixes.test.js:179-205`（用例 5，尤其 `:193-204` 盘前段）；被保护对象：`src/js/controllers/chartRowController.js:391-392`、`:546-550`；对照要求：`docs/handoff/2026-09-14-...-resolution-handoff.md:460-462`（§4.3 用例 5 盘前子场景要求由 `momentumChartMgr`（无分时模式）**合并报价**时锚定上一交易日）。
- **触发条件**：把 `chartRowController.js:391` 的 `resolveLiveFallbackDate(code, inst, this.getTradingDates())` 替换为 `getBeijingDate()`（即丢弃盘前锚定；`resolveLiveFallbackDate` 本身保持正确）。
- **实际行为**：新增测试矩阵 6/6 全绿（变异 M6 实跑 `# pass 6 / # fail 0`），该实现偏差不会被任何现有用例发现。
- **期望行为**：盘前（09:00~09:15）出现无日期快照时，日 K 不得追加当天（尚未开盘）的幽灵 Bar；应有用例在盘前时刻执行真实合并链路并断言末柱仍为上一交易日。
- **根因**：用例 5 只断言纯函数 `resolveLiveFallbackDate(...)` 的返回值，未经过任何 `loadKline`/`applyLiveTick` 合并链路，因此「注入的是盘前锚定值」这一实现细节不被覆盖；而用例 3（唯一覆盖 `loadKline` 注入的用例）使用盘中 10:00 时钟，此刻 `getBeijingDate()` 与 `resolveStockChartDate()` 取值相同，无法区分二者。
- **影响范围**：`§4.1.4`/`§4.4` 声称的「盘前不再向日 K 注入未开盘当天的幽灵 Bar」缺少回归防护；若后续重构误用 `getBeijingDate()`，盘前 09:00~09:15 会对所有展开图表追加一根当日假蜡烛（开盘前该日无成交），且不会被门禁拦截。
- **复现方法/验证证据**：M6 变异（仅改 `chartRowController.js:391` 为 `getBeijingDate()`）→ 实跑新增测试文件 → `# pass 6 / # fail 0`；同时仓库既有 820 例门禁（`npm test`）在该变异下亦无相关断言。
- **修复建议**：新增（或扩展用例 5）盘前子场景，在固定时钟 `2026-09-14 09:00+08:00` 下用真实 `ChartRowManager`（`hasIntraday: false`，对应 momentum 语义）执行 `loadKline` 报价合并与 `applyLiveTick`，日 K 末柱为 `2026-09-11`、报价为无日期 `{price: 21}`，断言**不追加** `2026-09-14` 的 Bar（末柱日期与收盘价保持 `2026-09-11`/原值）。
- **修复后验收标准**：将 `chartRowController.js:391`（及 `:546`）的注入源变异为 `getBeijingDate()` 时，该用例必须失败；恢复 `resolveLiveFallbackDate` 时全绿。

## 三、待确认风险与未验证项

- **待确认风险（未定级，证据不足）**：新增的「无日期快照 → 追加今日 Bar」路径（`chartRowController.js:391-392`、`:546-550`）在追加分支上没有停牌/陈旧守卫 —— `applyLiveQuoteToKline`（`kline.js:420`）只比较 `lastDate < targetDate`，不检查 `quote.stale`、`marketStatus` 或该标的当日是否有成交。怀疑依据：当日停牌标的的实时快照仍带 `price > 0`，若腾讯主源未返回该 code 而由东财降级（无日期字段）供给，则会按 `fallbackDate = 今日`追加一根以停牌前价格填充的「假当日蜡烛」。缺少的证据：真实停牌标的在腾讯/东财两源下的返回形态（离线环境无法取得）。建议验证方法：在离线桩下分别构造 `stale=true` 与停牌快照（`marketStatus` 非交易态）走 `applyLiveTick`，观察是否新增 Bar；若确认，建议在追加分支增加 `quote.stale`/当日可交易性守卫。注：该形态在修复前的 `loadKline` 路径中已存在同类行为（旧代码 `targetDate = inst.selectedTradeDate` 为最新交易日时同样会追加），本轮并非全新引入。
- **未验证项**：① 真实数据源端到端（腾讯主源降级东财、AKTools 分钟源可用性）未在真实网络下验证，报价形态均由离线桩构造；② 未在真实浏览器/真实盘中时段实机运行 `#/limit-up` 展开链路（本轮证据全部来自 jsdom + 固定/真实时钟的离线探针）；③ 委托外部提醒——§4.3 用例 4（历史 Bar 点击下钻 → `isLiveTradeDate` 由 `false` 回到 `true` 的闭环）本轮未实现，且仓库内 0 处测试引用 `handleKlineBarClick`/`manualTradeDate`（该交互代码本轮未被修改，故未定级，仅作建议）。

## 四、推荐修复顺序与复审验收标准

1. **先修 P2-1**（阻塞项）：按上文 1~5 步补全用例 7 的 (a)(b)(c) 断言，并以「变异回退 `app.js:1511` ⇒ 用例失败」为自检。
2. **再修 P3-1**：新增盘前 09:00 合并链路用例，并以「变异 `chartRowController.js:391`/`:546` 为 `getBeijingDate()` ⇒ 用例失败」为自检。
3. **文档同步**：`STATUS.md` 的测试覆盖表述与实现一致；不得以「接入点」措辞替代端到端断言。
4. **复审验收标准**（同时满足）：① 用例 7 在挂载 root 前置下断言 `pollTimerAlive`/`pollTimerId`，且在 M1 变异下确定性失败；② (b) 断言由定时器回调自动触发的 `fetchQuotes` 批次含展开标的、(c) 断言 `state.quotes` 写入并驱动 `updateChartLastTickMulti`；③ 盘前锚定注入有用例覆盖且对 M6 类变异敏感；④ 全量门禁（lint / 820+ 例 / build）全绿；⑤ 无任何级别未闭环缺陷。
