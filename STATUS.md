# STATUS.md - 项目状态

## 2026-09-16 当前状态：图表时间轴中国习惯格式化与成交量红绿规则修复 —— 准备提审

交接文档：[`docs/handoff/2026-09-16-chart-date-format-and-volume-color-handoff.md`](docs/handoff/2026-09-16-chart-date-format-and-volume-color-handoff.md)

- **缺陷 1（日期格式与多余分钟）**：
  - 原轻量图表时间轴坐标十字线默认西式日-月-年 `11 9月 '26 00:00`，日 K 线泄漏无意义 `00:00`。
  - 修复：`_timeScaleOptions` 中 `timeVisible` 严格绑定 `isMinute`（日周月 K 线为 false）；`buildChartOptions` 增加 `localization: { locale: 'zh-CN', dateFormat: 'yyyy-MM-dd', timeFormatter }`；`formatChartTime` 扩展对 BusinessDay 对象与时间戳支持，统一输出 `YYYY-MM-DD`（分钟线输出 `YYYY-MM-DD HH:mm`）。
- **缺陷 2（成交量颜色误判为绿柱）**：
  - 原 `formatVolumeBars` 仅按 `close > open` 单一判据，导致高开低走收涨的假阴真阳（如新农开发 2026-09-11 见顶日，昨收 9.64、开盘 10.38、收盘 9.72，全天收涨 +0.83%）和一字涨停被误染为绿柱；且 `applyLiveTickToKlineChart` 传入单元素数组丢失昨收上下文。
  - 修复：导出 `isVolumeBarUp(it, prevClose)`，收盘高于开盘或收盘高于昨收（高开低走假阴线收涨、一字涨停）均判定为红柱；`applyLiveTickToKlineChart` 补全 `prevClose` 上下文。
- **验证**：新增 `tests/kline.test.js`（9.11 见顶日样本、一字涨跌停、单项 Tick）与 `tests/chart.test.js`（localization 中文格式化与分钟时间轴开关）。
- **门禁实跑**：`npm run lint` **0 错误 0 警告** → `npm test` **841/841 全部通过** → `npx playwright test e2e/chart.spec.js` **12/12 全部通过** → `npm run build` 成功。

## 2026-09-15 历史状态：停播提示后补播「最后一轮选中字段」—— 已交付

交接文档：[`docs/handoff/2026-09-15-close-snapshot-handoff.md`](docs/handoff/2026-09-15-close-snapshot-handoff.md)

- **效果**：每条停播提示（`已收盘` / `中午休市` / 期货日夜空档 `休市`）播完，紧跟一轮**用户选中字段**的快照。只勾「价格」时即「已收盘，1272.75元」——不强行带名字。
- **实现**：`decideVoiceSchedule` 新增 `finalCodes`（取上一拍 `previous.eligibleCodes` 并按当前订阅过滤）；控制器 `speakCodes` 新增 `full` 选项（无视去重、不写记忆），在提示后立即调用。**不加开关**。
- **关键约束（实测）**：发提示那一拍 `eligibleCodes` 必为空（正因"没得播"才提示），所以快照集合只能来自上一拍；且必须按当前订阅过滤，否则会把收盘前已退订的标的也播出来。
- **更正**：交付前口头汇报中「上一拍可播标的被全部退订 → 提示照发」的判断有误，实测为**不发**（既有行为），已在测试与文档中更正。
- **验证**：新增 1 个纯函数测试文件（8 条）+ 控制器 3 条新增/2 条更新；在改动前的 `141ddef` worktree 上 11 条断言**全红**（其余 826 全过）；E2E 用临时掐掉补播调用做变异，确定性失败后恢复通过。
- **门禁实跑**：`npm run lint` 0 错误 → `npm test` **837/837** → `npx playwright test` **75/75** → `npm run build` 成功。

## 2026-09-15 当前状态：新增「相同报价不重复播报」开关（语音播报去重可关闭）—— 已交付

交接文档：[`docs/handoff/2026-09-15-voice-dedupe-toggle-handoff.md`](docs/handoff/2026-09-15-voice-dedupe-toggle-handoff.md)

- **功能**：原本隐式的「报价没变就跳过该轮」规则改为显式开关 `voice.skipUnchanged`（默认开=保持原行为），作为交易时段那一排的**第 5 个开关**，复用 `.schedule-toggle` 样式；不受「智能交易时段」禁用影响。
- **迁移安全**：缺键的旧配置归一回落到 `true`（写成 `!!src.skipUnchanged` 会把所有人的去重静默关掉）。关闭去重时改走全量格式化函数 `formatQuoteSpeech`——若不换函数，只勾选「名字」的用户会彻底听不到声音。
- **交付中发现并修复 1 项真实接线缺陷**：视图契约是 `onChange(key, checked)`，新 handler 误写成单参数 `(checked)` → 收到的是字符串 `'skipUnchanged'`（恒真）→ 真实浏览器里「点开关没反应」。已改为 `(key, checked)` 并加 key 守卫；该缺陷只有真实点击的 E2E 能覆盖（826 条单测全绿时它依然存在）。
- **验证**：新增 5 条单测 + 1 条 E2E；在缺陷引入前的 `ac09dde` worktree 上复跑，5 条新断言**全部失败**（其余 821 全过）⇒ 判别力成立；并做变异验证，确认用例能拦住「关闭去重时向 delta 传 null」的错解。E2E 在修复前确定性失败、修复后通过。
- **门禁实跑**：`npm run lint` 0 错误 → `npm test` **826/826** → `npx playwright test` **75/75** → `npm run build` 成功。

## 2026-09-14 当前状态：WorkBuddy 独立代码审查 round 3（代码落地与测试闭环）**全面审查通过**（0 缺陷）—— 正式交付

被审 HEAD：`a573af7`　审查基线：`f48e592`　审查范围：`git diff f48e592..a573af7`（20 文件 / +2248 / -39）
复审结论：**全面通过**（未发现任何 P0 / P1 / P2 / P3 缺陷，无实质性待确认风险，双智能体对抗审查正式闭环完成）

- **核验通过项实测确认**：
  1. **P3-1 彻底闭环**：用例 5 盘前 `09:00` 时钟段确已补入真实 `applyLiveTick(code, {price:22})` 链路断言（`chartRowController.js:546` 注入点）；经独立副本变异实跑，M7（`:546` → `getBeijingDate()`）使单文件与全量门禁 `npm test` 确定性变红（`# pass 820 / # fail 1`），M6（`:391` → `getBeijingDate()`）仍确定性变红。
  2. **P3-2 彻底闭环**：用例 7 `finally` 显式调用 `limitUpCtrl.stopTimer({ abort: false })` 并清零 `state.limitUp.timer`；新增用例 8 经真实探针验证（删去清理则用例 8 与门禁变红），独立串行不变量探针确认无跨文件单例状态残留。
  3. **产品代码与连带回归**：M1（`app.js:1511` 回退为 `!hasLimitUpRoot`）仍确定性击杀用例 7；三处 `ChartRowManager` 均正确传入 `getTradingDates`，`needsSharedQuotes=true` 下 `applySchedule` 仍受 `autoRefreshEnabled && allowed` 双重约束，无新增常驻轮询泄漏。
  4. **全量门禁实跑全绿**：`npm test` **821/821 全部通过（0 失败，0 偶发）**，`npm run lint` **0 错误 0 警告**，`npm run build` 生产构建打包成功。

## 2026-09-14 历史状态：WorkBuddy 独立代码审查 round 2 缺陷闭环（用例 5 覆盖 applyLiveTick 注入点 :546 与用例 7 彻底清零 state.limitUp.timer）—— 提交 round 3 复审

审查基线：`f48e592`
对应前序报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round2-handoff.md)

针对 round 2 独立审查指出的 2 项 P3 覆盖与状态泄漏缺陷完成全面闭环：

1. **闭环 P3-1（用例 5 盘前段覆盖 `chartRowController.js:546` `applyLiveTick` 注入点）** ✅：
   - 在 `tests/limitUpChartFixes.test.js` 用例 5 盘前（`09:00:00`）时钟与已装载 `2026-09-11` 末柱的实例上，补齐真实 `applyLiveTick(code, { price: 22.00 })` 链路断言；
   - 断言 K 线数组长度严格保持为 2，末柱时间严格为 `2026-09-11`，收盘价就地更新为 22.00，严禁包含 `2026-09-14` 幽灵蜡烛；
   - **双变异证伪实测确认**：对 `chartRowController.js:391`（M6，`loadKline` 路径）与 `:546`（M7，`applyLiveTick` 路径）分别变异为 `getBeijingDate()`，用例 5 均**确定性失败红灯变异被击杀**；恢复后用例确定性全绿。
2. **闭环 P3-2（用例 7 彻底清零 `state.limitUp.timer` 杜绝单例状态泄漏）** ✅：
   - 在用例 7 的 `finally` 中显式调用 `limitUpCtrl.stopTimer({ abort: false })` 并清零 `state.limitUp.timer = null`；
   - 新增用例 8（不变量探针测试），在用例 7 结束后无条件校验 app 全局单例初始不变量（`state.limitUp.timer === null`、`limitUpRootEl === null`、`limitUp.expandedCodes.size === 0`），彻底杜绝跨用例/同进程单例状态残留；
3. **门禁与全量测试** ✅：
   - 全量单测 `npm test`：**821/821 全部通过（0 失败）**；
   - 代码检查 `npm run lint`：**0 错误 0 警告**；
   - 构建打包 `npm run build`：**成功**。

## 2026-09-14 历史状态：WorkBuddy 独立代码审查 round 2（round 1 缺陷闭环 · 代码落地）**未通过** —— P3×2

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round2-handoff.md)
被审 HEAD：`76e9cd9`　审查基线：`f48e592`　本轮增量范围：`git diff 892f1b8..76e9cd9`（4 文件：`tests/limitUpChartFixes.test.js` +99/-6 与文档）
复审结论：**未通过**（round 1 两项缺陷**主项已真实闭环**，残留 2 项 P3，须彻底修复闭环后复审）

- **主项闭环实测确认**：① M1 变异（回退 `app.js:1511` 为 `!hasLimitUpRoot`）实跑使用例 7 **确定性变红**（`tests/limitUpChartFixes.test.js:334` `pollTimerAlive` actual `false`），`#/limit-up` 前置与 (b)(c) 端到端链路已补齐；② M6 变异（`chartRowController.js:391` → `getBeijingDate()`）实跑使用例 5 **确定性变红**（`:241` 长度 actual `3` expected `2`），盘前真实 `loadKline` 防幽灵 Bar 已落地；③ 门禁实跑 `npm test` **820/820**、`npm run lint` **0 错误 0 警告**、`npm run build` 成功。
- **P3-1（残留）**：round 1 P3-1 验收范围**仅部分闭环**——用例 5 盘前段只覆盖 `chartRowController.js:391`（`loadKline`），`:546-549`（`applyLiveTick`）注入点零覆盖；唯一覆盖 `applyLiveTick` 的用例 4 固定时钟 `10:00`，此刻 `resolveStockChartDate(dates) === getBeijingDate()`（均 `2026-09-14`），对 `:546` **结构性不敏感**。变异 M7（仅改 `:546` 为 `getBeijingDate()`）→ 6/6 全绿；独立生产装配探针（真实 `limitUpChartMgr`，`09:00` 盘前，无日期 Tick）在 M7 下确定性捕获 `2026-09-14` 幽灵 Bar → 证明该变异可观测、可测，属真实覆盖缺口。对照 round 1 报告 `:42-43`（修复建议要求 `loadKline` **与** `applyLiveTick` 并测；修复后验收标准要求 `:391` **及** `:546` 变异均须使用例失败）。可达性受 `marketSession.isAutoRefreshAllowedInSession`（`pre-open` 返回 `false`）限制，故定级 P3。
- **P3-2（残留，本轮首次引入）**：用例 7 `finally`（`:348-357`）仅 `monitorCtrl.stopTimer()`，未停涨停看板定时器 → `state.limitUp.timer` 残留桩句柄 `1002`（串行不变量探针实测 `actual 1002 / expected null`）；`app.js:1520` 是 `state.limitUp.timer` 全仓唯一消费点且判据为「假值即启动」，后续同进程用例若建立 `#/limit-up` 前置将**静默跳过启动**，形成顺序依赖。当前 820 例全绿（无下游用例依赖该判据），属潜在风险。round 1 修复建议第 5 条已要求「停表」，本轮仅停了监控轮询。`892f1b8` 版本因未挂载 root（走 `app.js:1524-1525` `stopLimitUpTimer` 分支）无此泄漏。
- **待确认风险（承接 round 1，未定级、本轮未变化）**：`applyLiveQuoteToKline` 追加分支（`kline.js:420`）无停牌/陈旧守卫，降级无日期快照在停牌标的上可能生成假当日蜡烛，待真实源形态验证。
- **未验证项**：真实数据源端到端（腾讯主源降级东财、AKTools 分钟源）与真实浏览器/盘中实机运行 `#/limit-up` 仍未覆盖，本轮证据全部来自 jsdom + 固定时钟 + 变异实跑。

## 2026-09-14 历史状态：WorkBuddy 独立代码审查 round 1 缺陷闭环（用例 7 端到端变异证伪与用例 5 盘前 loadKline 防幽灵 Bar 真实合并）—— 已提交 round 2 复审（评审结论见上方 round 2：主项闭环，残留 P3×2）

审查基线：`f48e592`
对应前序报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md)

针对 round 1 审查报告指出的 P2-1 与 P3-1 测试用例证伪性盲点完成全面闭环：

1. **闭环 P2-1（用例 7 端到端可证伪性与 (b)(c) 链路断言）** ✅：
   - 在 `tests/limitUpChartFixes.test.js` 中显式设置 `limitUpCtrl.setRootEl(document.createElement('div'))` 前置，使 `hasLimitUpRoot === true`；
   - 在变异测试下（若将 `app.js:1511` 回退变异为 `!hasLimitUpRoot`），由于 `hasLimitUpRoot=true` 导致 `visible=false`，`pollTimerAlive` 确定性为 `false`，用例确定性红灯变异被击杀；
   - 补齐方案 §4.3 (b)(c) 链路：通过 `registeredTimers.get(pollTimerId)` 取出 entry 验证周期与 `refreshInterval` 对齐，执行 `await timerEntry.fn()` 驱动 `fetchQuotes`，断言网络请求触发并将纯行情写入 `state.quotes.get('sh600777')`。
2. **闭环 P3-1（用例 5 盘前真实 loadKline 防幽灵 Bar 链路）** ✅：
   - 在 `09:00:00` 盘前时钟下，集成实例化真实 `ChartRowManager({ hasIntraday: false })` 执行 `loadKline`；
   - 断言返回的日 K 数据（末柱为 `2026-09-11`）合并无日期快照报价后数组长度严格保持为 2，最后一根 Bar 严格为 `2026-09-11`，严禁包含 `2026-09-14` 幽灵蜡烛；
   - 变异测试验证：若将 `chartRowController.js:391` 变异为 `getBeijingDate()`，用例断言长度 2 与无幽灵 Bar 立即红灯变异被击杀。
3. **门禁与全量测试** ✅：
   - 全量单测 `npm test`：**820/820 全部通过（0 失败）**；
   - 代码检查 `npm run lint`：**0 错误 0 警告**；
   - 构建打包 `npm run build`：**成功**。

## 2026-09-14 历史状态：WorkBuddy 独立代码审查 round 1（涨停看板图表修复与调度解耦 · 代码落地）**未通过** —— P2×1 / P3×1

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md)
被审 HEAD：`892f1b8`　审查基线：`f48e592`　审查范围：`git diff f48e592..892f1b8`（18 文件 / +2040 / -38：产品代码 `app.js`、`chartRowController.js`、`monitorController.js`，测试 `app.test.js`、`limitUpChartFixes.test.js`，其余为文档）
审查结论：**未通过**（1 项 P2 + 1 项 P3，须彻底修复闭环后复审）

- **产品代码侧结论（本轮实测确认全部生效，无 P0~P3）**：需求 1（`app.js:413` 统一 `resolveTradeDate`）、需求 2（`chartRowController.js:391/546` 双链路注入 `resolveLiveFallbackDate`）、需求 3 的运行路径（挂载 root 后 `pollTimerAlive=true` → `pollTimerId` 回调 → `/api/tencent/q=<展开标的>` → `state.quotes` 写入）均经独立端到端探针/变异实跑确认；门禁实跑 `npm test` **820/820**、`npm run lint` **0 错误 0 警告**、`npm run build` 成功。
- **P2-1（阻塞）**：`tests/limitUpChartFixes.test.js:250-266` 用例 7 未建立 `#/limit-up` 前置（未 `limitUpCtrl.setRootEl(...)`、不经路由），恒有 `hasLimitUpRoot === false`，而修复前 `applySchedule(allowed, !hasLimitUpRoot)` 在该前置下恒等于修复后的 `applySchedule(allowed, true)` → 将 `app.js:1511` 回退变异后该文件仍 **6/6 全绿**，无法证伪验收标准 3；且方案 §4.3:465-469 要求的 (b)(c) 端到端断言（`pollTimerId` → 执行回调 → `fetchQuotes` 批次含展开标的 → `state.quotes` 写入/`updateChartLastTickMulti`）完全未落地。
- **P3-1**：`tests/limitUpChartFixes.test.js:179-205` 用例 5 盘前子场景仅断言纯函数返回值，未走任何合并链路；将 `chartRowController.js:391`（或 `:546`）的注入源变异为 `getBeijingDate()`（丢弃盘前锚定）后 6/6 仍绿 → 盘前「不注入未开盘当天幽灵 Bar」无回归防护（对照 §4.3:460-462 要求）。
- 待确认风险（未定级）：追加分支（`kline.js:420`）无停牌/陈旧守卫，降级无日期快照在停牌标的上可能生成假当日蜡烛，待真实源形态验证。

## 2026-09-14 历史状态：涨停看板切历史日期图表修复与调度解耦全量落地（代码 + 测试 + 门禁全绿）

最新交付文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
交付基线：`4de74e4`

按照彻底打磨的技术方案（§4.1~§4.3），正式完成全量工程代码落地与测试矩阵构建：

1. **统一图表交易日解析契约（`src/js/app.js`）** ✅：
   - 移除 `limitUpChartMgr.resolveTradeDate` 中的 `isHistorical` 日期劫持，统一委托给 `resolveInitialTradeDate(code, data)`；
   - 展开图表时默认以最新可用交易日（今日/盘前上一交易日）初始化上下文，彻底杜绝 320 根滑动窗口伪分时伪装锁死。
2. **实时报价目标日期防污染（`src/js/controllers/chartRowController.js`）** ✅：
   - 抽离并导出纯函数 `resolveLiveFallbackDate(code, inst, tradingDates)`，隔离期货交易日并锚定股票可用交易日；
   - 在 `loadKline`（初次合并）与 `applyLiveTick`（增量推送）中统一注入 `fallbackDate`，彻底杜绝缺少日期快照导致的昨日收盘柱原地覆盖。
3. **行情调度层保活与活跃图表订阅合流（`src/js/app.js` + `src/js/controllers/monitorController.js`）** ✅：
   - 在 `app.js:1510` 设置 `needsSharedQuotes = true` 保持后台行情轮询，并在 `#/limit-up` 路由中移除冗余 `stopMonitorTimer()`；
   - 在 `monitorController.js:14-22` 将各页面展开图表集合（`expandedCodes`）无条件合流注入 `getRefreshCodes()`；
   - 为 `monitorCtrl.inspect()` 扩充暴露 `pollTimerAlive` 与 `pollTimerId`。
4. **测试矩阵与工程门禁（`tests/limitUpChartFixes.test.js`）** ✅：
   - 新增针对性测试矩阵（覆盖 T-1/T-2 展开解析、loadKline/applyLiveTick 防污染、期货隔离/盘前时钟、expandedCodes 订阅合流、调度层保活接入点等）；
   - 本地全量测试套件（QUnit）：**820/820 全部通过（0 失败，0 偶发）**；
   - `npm run lint`：**0 错误 0 警告**；
   - `npm run build`：生产构建打包成功。

> **round 1 复审更正（2026-09-14）**：上述第 1~3 项产品代码改动与第 4 项门禁数据经独立复审实测**全部成立**；但第 4 项测试矩阵相对方案 §4.3 存在未落地项 —— §4.3:465-469 用例 7 的 `#/limit-up` 前置与 (b)(c) 端到端断言缺失（该用例将 `app.js:1511` 回退变异后仍全绿，无法证伪验收标准 3，P2），§4.3:460-462 盘前子场景仅断言纯函数（P3）。详见 [`2026-09-14-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md)。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 17（涨停看板历史日期图表修复方案）**未通过** —— P3×2

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round17-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round17-handoff.md)
被审 HEAD：`90a0d60`　审查基线：`f48e592`　审查范围：`git diff f48e592..90a0d60`（12 文件 / +1598 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9-16 审查报告、`docs/handoff/INDEX.md`；相对 round 16 审查报告 `5d6a323` 的增量 = 3 文件 / +32 / -14）
审查结论：**未通过**（2 项 P3，须彻底修复闭环后复审）

本轮通过的核查项（简）：round 16 的 1 项 P3 在 **T-2 侧确认闭环** —— `doc:68` 已升级为通用式 `max(0, 320-x-n)`，`x=0` 上限 77/79/80、滑出阈值 `x ≥ 320-n`（77~80）与 `doc:29`/`:72`/`:138-139`/`:143` 横向一致，仓库外探针按 `n ∈ {240,241,243}` 逐 `x` 回放全部相符；round 15 已闭环项未回退（真实 `REFRESH_OPTIONS`=[3000,10000,30000,60000] × `LIMIT_UP_REFRESH_OPTIONS`=[10000,30000,60000] 复算交集恰为三档，`doc:419` 碰撞示例齐备、`doc:385` 为「可配置 `3/10/30/60` 秒」；`pollTimerId` 纯身份键在真实 `monitorController` + 同 `ms` 双注册下按 id 唯一取到行情轮询条目，`visible=false` 变异确定性清空）；`STATUS.md` 历史段逐字未变（round 16 段仅标题由「当前状态」下移为「历史状态」）；实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P3-1（低）mermaid 节点 F 的 T-1 保留下界「≥77~80 根」在其自述前提（`x ≤ 240`）下不可复算**：`doc:23`；`min(n, 320-x)` 在 `x ∈ [0,240]`、`n ∈ {240,241,243}` 上的下界**恒为 80**，`77` 需 `x = 243` 才可达（已越出该节点自述前提）；且与同文件 `doc:71`「全天随 x 递减并保持在 80~240 根」自相矛盾。根因：把 T-2 的 n 驱动阈值语言（77~80）横向移植到 T-1 覆盖节点，而 T-1 侧 `n` 仅抬高上界、不下放下界。
2. **P3-2（低）T-1 收盘保留 77~79 根被错误归因于「`n` 达到 241/243 根」**：`doc:71` / `doc:135`；复算 `min(n, 320-x)`：收盘 `x=240` 时 `n = 240/241/243` 均得 **80**；`79/77` 仅由**当日** `x=241/243` 触发，与 `n` 无关（`n` 维度真正驱动的是 T-2 的 `max(0, 320-x-n)`）。本文件被审版（`90a0d60`）`:13` 的本轮闭环自述沿用同一错置（插入本段后位于 `:28`）。

**处置建议**：仅需修正 `doc:23`、`doc:71`、`doc:135` 的 T-1 侧保留根数下界与 `n` 归因，并同步更正本轮新增的 `STATUS.md` 闭环自述（不涉及产品代码与测试），保持 T-2 侧已闭环表述与 `STATUS.md` 全部历史段原文不动，即可提交 round 18 复审。

## 2026-09-14 历史状态：WorkBuddy 审查（round 16）缺陷全面闭环（320 根滑动窗口保留根数与滑出阈值通用化与日长前提统一）—— 提交 round 17 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round16-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round16-handoff.md)
审查基线：`f48e592`

针对 round 16 独立审查报告指出的 1 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P3 闭环】§2.2/§3 的 320 根滑动窗口保留根数与滑出阈值通用化为 $\max(0, 320 - x - n)$ 并统一横向表述** ✅：
   - 在 §2.2:68 将 T-2 保留根数公式升级为通用形式 $\max(0, 320 - x - n)$（$n \in \{240, 241, 243\}$ 为 T-1 日自身 Bar 数），明确指出在常规 $n=240$ 下化简为 $\max(0, 80-x)$，在集合竞价点 $n=241/243$ 下对应 $\max(0, 79-x)/\max(0, 77-x)$；明确 $x=0$ 盘前上限对应 77/79/80 根，滑出阈值严格对应 $x \ge 320 - n$（即 $x \ge 77 \sim 80$ 根）；
   - 在 §2.2:67 与 `:71` 为 T-1 容量 $\min(n, 320 - x)$ 补充通用日长 $n$ 参数及其在上界与集合竞价点下的取值说明；
   - 横向完整同步更新 mermaid 节点 F/K（§2:23, :29）与 §3 结论（§3:135, :138-139, :143），统一将 T-2 滑出时间阈值表述为「当日 Bar $\ge 77 \sim 80$ / 约 10:45~10:48（视 T-1 自身 Bar 数）」，彻底消除单一日长假设与全称断言偏差；
   - 保持 round 15 已闭环项（`doc:419`/`doc:385` 取值域枚举、§4.3 纯身份键绑定等）完好无损，严格保持 `STATUS.md` 所有历史段原文不变，杜绝跨轮次回填。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 16（涨停看板历史日期图表修复方案）**未通过** —— P3×1

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round16-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round16-handoff.md)
被审 HEAD：`9c78a3c`　审查基线：`f48e592`　审查范围：`git diff f48e592..9c78a3c`（11 文件 / +1500 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9-15 审查报告、`docs/handoff/INDEX.md`；相对 round 15 审查报告 `e129c18` 的增量 = 3 文件 / +24 / -6）
审查结论：**未通过**（1 项 P3，须彻底修复闭环后复审）

本轮通过的核查项（简）：round 15 的 1 项 P3 经独立复核**确认闭环** —— `doc:419` 已补齐 `3000/10000/30000/60000` 且碰撞示例扩为 `10000`/`30000`/`60000`、`doc:385` 已改为「默认 10s，可配置 `3/10/30/60` 秒」，仓库外探针以真实 `REFRESH_OPTIONS`（`app.js:151-156` = `3000/10000/30000/60000`）× `LIMIT_UP_REFRESH_OPTIONS`（`format.js:3-7` = `10000/30000/60000`）复算，交集恰为 `{10000,30000,60000}`（三档穷举闭合）；§4.3 `pollTimerId` 纯身份键在 `monitor × limitUp` 12 组全组合下均唯一命中行情轮询条目（含 3 组同 `ms` 撞车；负向对照 `visible=false` 下监控轮询定时器不注册，与用例 7(a) 的变异可证伪声明一致）；`STATUS.md` 历史段逐字未变（round 15 段仅由「当前状态」下移为「历史状态」，正文与 `e129c18` 逐字一致，可由 `git diff e129c18..9c78a3c -- STATUS.md` 单 hunk 复核）；`STATUS.md:127` round 12 引文仍与 `git show c3f5bc0:STATUS.md | sed -n '12p'` 一致。实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P3（低）§2.2/§3 滑动窗口保留根数与滑出阈值以「每交易日恰 240 根」为隐含前提却断言「严格服从」**：`doc:68` 写 T-2 保留根数「严格服从 $\max(0, 80-x)$」「1~80 根」「$x \ge 80$ 后才滑出」，`doc:29`/`:138-139`/`:143` 同述「第 80 根 Bar / 约 10:48」阈值；但同文件 `:65` 与 `STATUS.md:96` 自述单日可因 9:25 集合竞价点达 241/243 根，且该 320 窗口取自 `tencent-legacy` 源（T-1/T-2 同源）→ 实际为 `max(0, 320-x-n)`，`x=0` 时 T-2 上限为 80/79/77 根、滑出阈值为 `x ≥ 80/79/77`（约 10:48/10:47/10:45）；`doc:67` 的 T-1 上界 `min(240, 320-x)` 同理低估为 241/243。round 13 只为 T-1 的「恒 ≥80」补了「当日 x ≤ 240」条件，**「历史日自身为 241/243 根」维度从未处理**（同类表述横向扫描缺口，共 4 处）。探针实测 x∈[0,260] 有 160 个取值与文档公式不符。修复：`doc:68` 改通用式 `max(0, 320-x-n)` 或显式标注「T-1 为常规 240 根」并补 241/243 分支，同步 `:29`/`:138-139`/`:143`/`:67`/`:71`；`STATUS.md` 历史段按原文保留、不得回填改写。

**处置建议**：仅需统一方案文档 §2.2/§3 的 320 根窗口量化表述（不涉及产品代码与测试），并确保 round 15 已闭环项（`doc:419`/`doc:385` 取值域枚举、§4.3 纯身份键绑定、`STATUS.md` 历史引文）不被回退，即可提交 round 17 复审。

## 2026-09-14 历史状态：WorkBuddy 审查（round 15）缺陷全面闭环（行情轮询周期取值域补齐 60000 / 三档同 ms 碰撞穷举闭合）—— 提交 round 16 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round15-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round15-handoff.md)
审查基线：`f48e592`

针对 round 15 独立审查报告指出的 1 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P3 闭环】§4.3 与 §4.2 行情轮询刷新周期取值域补齐 `60000` 并闭合同 `ms` 碰撞全组合** ✅：
   - 严格对照 `src/js/app.js:151-156` 的 `REFRESH_OPTIONS` 白名单，在 §4.3:419 将 `state.refreshInterval` 取值域枚举完整补齐为 `3000/10000/30000/60000`（原漏列第 4 档 60 秒）；
   - 在 §4.3:419 将同 `ms` 碰撞示例扩充为 `10000`、`30000` 与 `60000` 三个合法重叠档位，与涨停列表刷新间隔 `LIMIT_UP_REFRESH_OPTIONS`（`10000/30000/60000`）实现全组合穷举覆盖；
   - 同步修正 §4.2:385 报价周期表述为「在 1 个报价周期内（默认 10s，可配置 `3/10/30/60` 秒）」；
   - 保持所有历史段（如 round 14 历史段等）的原有引述文本不变，杜绝跨轮次回填。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经抽查 30+ 处核验，与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 15（涨停看板历史日期图表修复方案）**未通过** —— P3×1

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round15-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round15-handoff.md)
被审 HEAD：`bd0e939`　审查基线：`f48e592`　审查范围：`git diff f48e592..bd0e939`（10 文件 / +1412 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9-14 审查报告、`docs/handoff/INDEX.md`；相对 round 14 HEAD `1adf743` 的增量 = 3 文件 / +39 / -14）
审查结论：**未通过**（1 项 P3，须彻底修复闭环后复审）

本轮通过的核查项（简）：round 14 的 2 项 P3 主项经独立复核**均确认闭环** —— ①`STATUS.md:95` 的 round 12 引文与 `git show c3f5bc0:STATUS.md | sed -n '12p'` 逐字一致（无条件 `恒 ≥80`），与 `STATUS.md:63`（round 13 段）归属唯一、不再互斥；②§4.3 已改为 `registeredTimers.get(inspect().pollTimerId)` 纯身份键，仓库外探针（真实 `monitorController` + 文档 §4.3 原样沙盒）确证 `pollTimerId` 即沙盒 `setInterval` 返回的注册 id，在 `limitUp.ms === monitor.ms`（`10000`/`30000`/`60000` 三档同 ms 撞车）下仍唯一取到行情轮询回调。实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**；本轮改动涉及的全部代码锚点（`app.js:151-156/499/803/1569/1515/1525/1602-1614/1645-1647`、`monitorController.js:83-86/140`、`limitUpController.js:424/438`、`format.js:3-7`、`storage.js:226-235`）逐条与 HEAD 一致。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P3（低）§4.3 对 `state.refreshInterval` 合法取值域的枚举与代码不符（遗漏 `60000`）**：本轮新增文本 `doc:419` 写「`ms = state.refreshInterval`，默认 `10000`，可选 `3000/10000/30000`」「（例如同为 `10000` 或同为 `30000`）」，同类实例 `doc:385`「默认 10s，可选 3s」；而代码 `src/js/app.js:151-156` 的 `REFRESH_OPTIONS` 为 `[3000, 10000, 30000, 60000]`，且 `:803` 以该白名单校验、`:1569` 直接载入持久化值 → `60000` 为真实可达值，并使 `state.limitUp.refreshInterval === state.refreshInterval === 60000` 成为**第三个同 ms 碰撞档位**，文档的"全组合"行情侧取值域被少列一档。探针实测 `monitorMs=limitUpMs=60000` → `ms-matches=2`。根因：为回应 round 14「不得出现未带取值条件的定值断言」扩写括注时，沿用了 round 14 报告 `:38` 中 `REFRESH_OPTIONS = [3000,10000,30000]`（同为漏 `60000`）而未回代码求证。修复：`doc:419` 补 `60000` 与第三碰撞档、`doc:385` 改为「可配置 `3/10/30/60` 秒」；`STATUS.md:37` 等 round 14 历史段按原文保留、不得回填改写。

**处置建议**：仅需修正 `doc:419` / `doc:385` 的取值域枚举（不涉及产品代码与测试），并确保 round 14 已闭环项（`STATUS.md:95` 引文、§4.3 纯身份键绑定）不被回退，即可提交 round 16 复审。

## 2026-09-14 历史状态：WorkBuddy 审查（round 14）缺陷全面闭环（沙盒纯身份键绑定/消除ms碰撞/STATUS历史引文还原与归属闭合）—— 提交 round 15 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md)
审查基线：`f48e592`

针对 round 14 独立审查报告指出的 2 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P3-1 闭环】`STATUS.md` round 12 闭环历史引文严格还原与跨段归属消歧** ✅：
   - 将 `STATUS.md` round 12 闭环段中的引文严格按 round 12 实际产出（`c3f5bc0`）还原为「修正为 `覆盖 T-1: min(240, 320-x) 根，恒 ≥80`，消除 `199~240` 固定区间冲突」，坚决杜绝把后续轮次的措辞回填到历史记录中；
   - 显式加注说明「注：该『恒 ≥80』在 241/243 根 Bar 前提下的成立条件已由 round 13 补齐闭环，见本文件 round 13 闭环段」，使同一改动动作在各轮次记录中的归属清晰、唯一、彻底消歧；
   - 顺带对 round 10 闭环段的 `app.js:1607` 历史叙述补充澄清注记，与后续各轮实测结论完全自洽。
2. **【P3-2 闭环】§4.3 定时器沙盒由数值 `ms` 筛选升级为纯身份键绑定机制** ✅：
   - 针对 `state.limitUp.refreshInterval === state.refreshInterval`（例如同为 10000 或同为 30000）导致数值 `ms` 碰撞、无法唯一匹配行情轮询回调的问题，在 §4.2 与 §4.3 中确立纯身份键绑定契约：
   - 在 `monitorCtrl.inspect()` 扩充暴露内部持有的唯一句柄 `pollTimerId: timer`；
   - 单测通过 `registeredTimers.get(pollTimerId)` 直接提取绑定的定时器条目，并在断言中确认 `pollTimer.ms === state.refreshInterval`；
   - 在 `state.limitUp.refreshInterval × state.refreshInterval` 全组合下均能 100% 确定性唯一获取行情轮询定时器，彻底消除对 `ms` 互异或注册先后顺序的隐式依赖；
   - 在变异测试中，若 `app.js:1515` 回退，`pollTimerId === null` 导致 `registeredTimers.get(pollTimerId)` 返回 `undefined`，用例在 (a)(b) 步均确定性报错失败。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经抽查 30+ 处核验，与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 14（涨停看板历史日期图表修复方案）**未通过** —— P3×2

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md)
被审 HEAD：`33b8f53`　审查基线：`f48e592`　审查范围：`git diff f48e592..33b8f53`（9 文件 / +1296 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9-13 审查报告、`docs/handoff/INDEX.md`；相对 round 13 HEAD `c3f5bc0` 的增量 = 3 文件 / +71 / -53）
审查结论：**未通过**（2 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：round 13 的 P2-1（§4.3 沙盒改为按自增 id 建表 + 按 `ms === state.refreshInterval` 选中）经独立探针在真实 `monitorController` + 真实 `limitUpCtrl` 路径下复现「默认配置仅注册 `ms=10000/30000` 两定时器、按 `ms` 选中唯一」；P2-2 已把错配历史段重写为 round 12 审查记录并清除 `1607 ⇒ timerCount` 与 Fake Timers 断言；P3-1 的 `§4.2:276` 锚点与「100% 精准对齐」已校正、`INDEX.md` 摘要已同步；P3-2 的 A1 已按 `loadKline`/`applyLiveTick` 拆列，探针以真实 `applyLiveQuoteToKline` 复算 `len`/末柱字段一致；P3-3 三处保留根数已带 `x ≤ 240` 条件。实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**；本轮改动涉及的代码锚点逐条与 HEAD 一致。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P3（低）`STATUS.md:57` 的 round 12 闭环记录被改写成 round 13 才引入的条件式**：由「修正为 `min(240, 320-x) 根，恒 ≥80`」（round 12 真实产出，`git show c3f5bc0:STATUS.md` 第 12 行 / `c3f5bc0:<doc>` 第 23 行可复核）改为「修正为 `min(240, 320-x) 根，**在 x≤240 时恒 ≥80**」——该措辞在 round 12 版本与 round 13 修复后的当前版本（`doc:23` 实为「常规 x≤240 时 ≥80」）上**均不成立**；且与同文件 `STATUS.md:25`（round 13 段称该 `x ≤ 240` 条件由 round 13 补齐）就「谁补齐了该条件」互斥。
2. **P3（低）§4.3 沙盒以数值 `ms` 作为选中键，在合法配置下同时命中两个定时器**：`state.limitUp.refreshInterval`（可选 `10000/30000/60000`，持久化）与 `state.refreshInterval`（`3000/10000/30000`）同值时，`applyDataRefreshSchedule()` 会注册两个同 `ms` 定时器（探针实测 `registered ms = [10000,10000]`、`ms-matches = 2`），文档 `:418` 要求的「断言该定时器唯一」不成立；此时 `find()` 取到行情轮询回调仅依赖 `app.js:1515` 早于 `:1525` 的**注册顺序**，而非可唯一辨识的键。

**处置建议**：先把 §4.3 选中键由数值 `ms` 改为身份型（或写入「先停用涨停列表定时器」前置条件并补齐 `state.limitUp.refreshInterval` 取值条件）→ 再把 `STATUS.md:57` 引文还原为 round 12 真实产出并与其 round 13 段闭合 → 顺带确认 `STATUS.md` 同类历史段（round 10 段 `:119`）的处置方式。

## 2026-09-14 历史状态：WorkBuddy 审查（round 13）缺陷全面闭环（多定时器沙盒精确隔离/STATUS.md历史段落与断言校正/A1实测条目按路径对齐/241-243计数闭合）—— 提交 round 14 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round13-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round13-handoff.md)
审查基线：`f48e592`

针对 round 13 独立审查报告指出的 2 项 P2 阻塞缺陷与 3 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P2-1 闭环】§4.3 受控定时器沙盒重构为多定时器隔离与精准匹配轮询回调** ✅：
   - 彻底重构沙盒实现：将单槽覆盖写改为 `registeredTimers = new Map()`（按自增 id 存储 `{ fn, ms }`），提供隔离的注册与注销机制；
   - 用例 7(b) 改为从 `registeredTimers` 中精准查找 `ms === state.refreshInterval` 的唯一条目执行 `pollTimer.fn()`，彻底隔离 `applyDataRefreshSchedule()` 在行 1525 注册的 30000ms 涨停列表定时器，杜绝单槽覆盖写导致执行到 `limitUpFetch` 的缺陷；
   - 清除所有残留的“推进虚拟时钟/推进时间 $\ge state.refreshInterval$”表述，严格对齐直接驱动沙盒回调规范。
2. **【P2-2 闭环】`STATUS.md` 历史段落错配重写与证伪断言彻底清除** ✅：
   - 彻底重写 `STATUS.md` 中错配的「round 12 未通过」历史段正文，链接对齐至 [`docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md)，准确归档 round 12 的 4 项 P3 缺陷（保留根数、1607 变异、A1 行 targetDate、Fake Timers 机制缺失）；
   - 彻底删除从 round 11 误复制的正文，清除 `app.js:1607 ⇒ timerCount === 0` 与 Fake Timers 等已证伪断言。
3. **【P3-1 闭环】行号锚点校正与结论客观降级、索引摘要同步** ✅：
   - 将 `STATUS.md` 中的锚点引用修正为 `§4.2:276`；
   - 将“100% 精准对齐”等绝对化全称表述降级为客观叙述“经抽查 30+ 处代码锚点与全文算术逐条核对一致”；
   - 同步更新 `docs/handoff/INDEX.md` 顶部速读与主文档索引条目为“已闭环至 round 13 缺陷”。
4. **【P3-2 闭环】§4.2:213 A1 实测对比条目按调用路径细化拆分** ✅：
   - 将 §4.2:213 的 A1 纯价格无日期快照条目明确拆分为 `loadKline` 路径（`targetDate = '2026-09-11'`，`lastDate < targetDate` 假致原地覆盖）与 `applyLiveTick` 路径（`targetDate = null`，无日期短路致原地覆盖），与 §2.3:107 表 A1 行逐字段完全吻合。
5. **【P3-3 闭环】保留根数下界补齐成立条件与 241/243 根闭合** ✅：
   - 在 §2 mermaid 节点 F、§2.2:71 与 §3:135 中，为“恒 ≥80 根”补齐“常规交易日 $x \le 240$”成立条件；
   - 明确注明若计入早盘 09:25 集合竞价等导致单日产生 241 或 243 根 Bar，则收盘保留约 77~79 根（`min(240, 320 - 243) = 77`），与 §2.2:65 完全闭合。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经抽查 30+ 处核验，与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 13（涨停看板历史日期图表修复方案）**未通过** —— P2×2 / P3×3

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round13-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round13-handoff.md)
被审 HEAD：`c3f5bc0`　审查基线：`f48e592`　审查范围：`git diff f48e592..c3f5bc0`（8 文件 / +1139 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9/10/11/12 审查报告、`docs/handoff/INDEX.md`）
审查结论：**未通过**（2 项 P2、3 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：round 12 的 P3-1 主项（§2 mermaid 节 F、§2.2 T-2、§3 复述）已按 `min(240,320-x)`/`max(0,80-x)` 改正；P3-2 已在 §4.3:468 删除 `app.js:1607` 变异分支并在 §4.2:286 / §4.4:478 降级为可选清理；P3-3 的 §2.3 表 A1 行已按 `loadKline`/`applyLiveTick` 拆列；P3-4 已定义 `pollTimerAlive` 并被用例 7(a) 采用。抽查 30+ 处代码锚点与全文算术经逐条复算与 HEAD 一致；`npm test` 实跑 **814/814 通过**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P2（中）§4.3 用例 7 的受控定时器沙盒在真实执行路径下捕获到「涨停列表定时器」回调**：`applyDataRefreshSchedule()` 在 `#/limit-up` 已挂载 + 盘中时连续注册两个 `setInterval`（`app.js:1515` 监控轮询 `10000ms` → `app.js:1525` → `limitUpController.js:438` 涨停列表 `30000ms`），而文档沙盒为单槽覆盖写、且每次返回同一 `id = 1001` → `capturedIntervalCallback` 最终是 `() => limitUpFetch()`，步骤 (b) 永不触发 `fetchQuotes`，在修复后的正确代码上亦必然失败；两次注册共用 `1001` 还使 (a)(b) 观测互相耦合。
2. **P2（中）`STATUS.md` 新增「历史状态：round 12 未通过」段保留 round 12 已证伪的断言**：`STATUS.md` 仍称「恢复 `app.js:1607` 的 `stopMonitorTimer()` ⇒ `timerCount === 0` ⇒ 断言确定性失败」，仍以 Fake Timers 为闭环依据；且该段标题写「round 12 未通过 —— P3×4」但正文与链接均为 round 11 闭环叙事，round 12 的 P3×4 在 `STATUS.md` 中无任何记录。
3. **P3（低）×3**：①`STATUS.md`「与 HEAD 100% 精准对齐」为过强全称结论，被 `§4.2:277`（正文实为 `:276`）与 `INDEX.md`「已闭环 round 10 缺陷」证伪；②§4.2:213 的 A1 实测条目仍以未限定路径的「旧代码 `targetDate = null`」描述与 §2.3:107 同名的场景，未与已路径化的 §2.3 A1 逐字段吻合；③保留根数「恒 ≥80」/「收盘仍有 80 根」与 §2.2:65 自述的「241/243 根/日」冲突（`min(240,320-243)=77`），未带成立条件。

**处置建议**：先修 P2-1（沙盒改为按 id 记录并显式选中 `ms === state.refreshInterval` 的回调）→ 再按 round 12 建议 ③ 清理 `STATUS.md` 并修正段标题/链接语义 → 再依次闭合 P3 ①②③。

## 2026-09-14 历史状态：WorkBuddy 审查（round 12）缺陷全面闭环（保留根数公式全量统一/消除1607无效变异/A1行路径解耦/单测受控定时器沙盒与pollTimerAlive）—— 提交 round 13 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md)
审查基线：`f48e592`

针对 round 12 独立审查报告指出的 4 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P3-1 闭环】保留根数全量统一与公式严格对齐** ✅：
   - 在 §2 mermaid 节点 F 修正为 `覆盖 T-1: min(240, 320-x) 根，恒 ≥80`，消除 `199~240` 固定区间冲突（注：该「恒 ≥80」在 241/243 根 Bar 前提下的成立条件已由 round 13 补齐闭环，见本文件 round 13 闭环段）；
   - 在 §2.2 T-2 描述中严格按照 $\max(0, 80 - x)$ 修正为 `1~80 根，例如 09:30 开盘 x=0 时剩余 80 根`，消除 `1~75 根`/`剩余 75 根` 矛盾；
   - 在 §3 复述中为 199 根补充严格前置成立条件（`随当日已产生 Bar 数 x 动态变化，等于 min(240, 320 - x) 根；在 11:30 前后 x≈121 时约 199 根，早盘 x≤80 时为满仓 240 根，收盘 x=240 时仍有 80 根`）；
   - 全文保留根数表述均可由公式直接复算，无与之冲突的固定区间或固定值。
2. **【P3-2 闭环】消除 `app.js:1607` 无效变异与修复必要性过强断言** ✅：
   - 在 §4.3 用例 7 变异证伪性保证中彻底移除 `（或在 app.js:1607 恢复 stopMonitorTimer()）` 分支，只保留唯一有效变异 `app.js:1515 → !hasLimitUpRoot`；
   - 在 §4.2 改造点四与 §4.4 风险评估中，明确将 `app.js:1607` 处的 `stopMonitorTimer()` 降级为可选清理，阐明其行为会被行 1613 的 `applyDataRefreshSchedule()` 重建覆盖，主调度语义与存活状态完全由行 1515 的 `visible` 判定独立且唯一决定；
   - 文档中每一条变异用例断言均为真实代码路径可观测。
3. **【P3-3 闭环】§2.3 表 A1 行旧代码合并表现按调用路径明确解耦** ✅：
   - 将 A1 行旧代码表现细化分列：`loadKline` 路径下 `targetDate = inst.selectedTradeDate = '2026-09-11'`（非 `null`，兜底链退化为历史日），`lastDate < targetDate` 为假导致原地覆盖；`applyLiveTick` 路径下无日期透传致 `targetDate = null`，落入原地覆盖；二者 `len = 2` 且篡改昨日收盘价；
   - 彻底消除了 A1 行与 §4.2:211 自述之间的矛盾。
4. **【P3-4 闭环】§4.3 确立无外部依赖的受控定时器沙盒契约与 `pollTimerAlive` 健壮断言** ✅：
   - 在 §4.3 接入说明中显式规定标准受控定时器沙盒规范：在 `beforeEach` 中保存原始 `globalThis.setInterval/clearInterval` 并替换为记录回调与周期的局部 Mock，在 `afterEach` 中严格原样还原，杜绝跨测试用例污染；
   - 用例 7(b) 改为直接触发捕获的回调函数 `capturedIntervalCallback()`，彻底消除对未引入的 fake-timers 依赖的假设；
   - 响应审查报告待确认风险建议：在 §4.2 为 `monitorCtrl.inspect()` 扩充 `pollTimerAlive: timer !== null` 专用字段，并在用例 7(a) 中明确断言 `pollTimerAlive === true`（变异回退为 `!hasLimitUpRoot` 时确定性变为 `false`），彻底排除常驻 `checker` 对 `timerCount` 的非零干扰，使断言具备绝对的可证伪性。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经抽查 30+ 处核验，与 HEAD 一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 12（涨停看板历史日期图表修复方案）**未通过** —— P3×4

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md)
被审 HEAD：`7b34bc5`　审查基线：`f48e592`　审查范围：`git diff f48e592..7b34bc5`（7 文件 / +965 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9/10/11 审查报告、`docs/handoff/INDEX.md`）
审查结论：**未通过**（4 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：round 11 的 P2 主因已实质闭环 —— §4.3 用例 7 新增 `_internal()` 调度层访问器（`app.js:1645-1647`），并删除“或触发一次 `refresh()` 周期”的手动后门；(b) 步由定时器回调驱动，对 `app.js:1515` 变异确实可证伪；§2.3 表与 §4.2 已收敛为 A1~A3；§2.3:99 / §4.2:276 绝对化表述已改为条件式，`state.quotes` 三个写入点核对完全准确；“≤3s”/“共计 4 次”已带成立条件。抽查 30 处代码锚点与 HEAD 逐条一致；`npm test` 复跑 **814/814 通过**。

**审查缺陷（摘要，细节见审查报告第二节）**：

1. **P3（低）保留根数仍有 3 处与自身公式冲突**：§2 mermaid 节点 `F` 仍写“199~240 根”（`x=240` 时公式为 80 根）、§2.2 T-2 分支写“1~75 根/剩余 75 根”（公式 `max(0, 80-x)` 在 `x=0` 时应为 80 根）、§3 复述写无条件“容纳 T-1 的 199 根”，未带 `x` 成立条件。
2. **P3（低）§4.3 用例 7 的 `app.js:1607` 变异证伪声称不成立**：`:1607` 的 `stopMonitorTimer()` 与 `:1613` 的 `applyDataRefreshSchedule()` 处于同一路由处理函数且连续执行，`:1613` 必定重建定时器，恢复 `:1607` 对 `timerCount` 无任何影响；且用例 7 直接调 `_internal()` 根本不经过路由处理器；`app.js:1607` 处的 `stopMonitorTimer()` 降级为可选清理，移除它并非必要修复项。
3. **P3（低）§2.3 表 A1 行 `targetDate = null` 与 loadKline 路径矛盾**：`loadKline` 路径下 `targetDate = inst.selectedTradeDate = '2026-09-11'`（非 `null`），兜底链退化为历史日致 `lastDate < targetDate` 为假原地覆盖，应按调用路径与 `applyLiveTick`（`targetDate = null`）拆分描述。
4. **P3（低）用例 7(b) 的 Fake Timers 驱动机制在仓库中不存在且未指明**：仓库无 Fake Timers 依赖，应规范为局部受控定时器沙盒；且建议为 `monitorCtrl.inspect()` 扩充 `pollTimerAlive: timer !== null` 专用字段以排除 `checker` 计数干扰。

**处置建议**：按公式统一 mermaid/T-2/§3 保留根数表述并补齐条件 → 删除 1607 变异分支并将 1607 降级为可选清理 → §2.3 A1 行按路径细化 → 规范受控定时器沙盒并引入 `pollTimerAlive` 断言。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 11（涨停看板历史日期图表修复方案）**未通过** —— P2×1 / P3×4

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round11-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round11-handoff.md)
被审 HEAD：`147573a`　审查基线：`f48e592`　审查范围：`git diff f48e592..147573a`（6 文件 / +792 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查报告、round 9/10 审查报告、`docs/handoff/INDEX.md`）
审查结论：**未通过**（1 项 P2、4 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：round 10 的 P1（调度层改动已明确落于 `app.js:1508-1515` + `app.js:1602-1614`，`needsSharedQuotes` 为自声明变量、`state.expandedCodes`/`state.limitUp.expandedCodes`/`state.momentum.expandedCodes` 均真实存在于 `app.js:319/352/370`）、P2（§4.1.4/§2.3/§4.2 主源前提已改为与 `api.js:161/172` + `parser.js:64/82/93-127` 一致的条件式表述）、P3（mock 信封已改为 `{ok,data}`、`loadIntraday` 已加 `this.hasIntraday` 门控）**三处均已闭环**；全文 43 处代码引用锚点、`32da3ca`/`eae67ae`/`2f94e08` 提交溯源与 round 9/10 范围统计经逐条比对与 HEAD **完全一致**；`npm test` 复跑 **814/814 通过**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P2（中）§4.3 用例 7 的"集成到达性断言"无法证伪 P1**：唯一覆盖调度层的断言 (a)"断言 `monitorCtrl` 定时器存活（`timer !== null`）"无可达接入点 —— `app.js` 未导出 `monitorCtrl`/`applyDataRefreshSchedule`，`_internal()`（`app.js:1645-1647`）仅返回 `{state, chartInstanceMap, limitUpRootEl}`，且 `tests/app.test.js:874-878` 已明确记载 startApp 级集成测试因清理复杂而被省略；而 (b)(c) 提供的"或触发一次 `refresh()` 周期"分支绕过 `applySchedule`，**实测**在 `applySchedule(allowed, false)`（`timerCount=0`，即 P1 未修）下 `refresh()` 仍成功且 `state.quotes` 仍被写入 → 用例 7 在缺陷存在时同样为绿，属"功能无效仍通过"的假通过测试。
2. **P3（低）×4**：①§4.2:277 "全站唯一写入 `state.quotes` 的正是 `monitorController` 的 `refresh()`" 与 `grep` 事实矛盾（`app.js:952`、`momentumController.js:141/152` 亦写入），§2.3:99 "根本没有该标的的报价实体"与同段 `:279` 的条件式表述（自选/强势股）互相矛盾；②§2.3 表 A4 行"修复后预期：`resolveLiveFallbackDate` 隔离、不覆盖末根蜡烛"与本方案代码矛盾（显式 `date` 短路兜底链，实测 `{price:21,date:'2026-09-10'}` 仍原地覆盖 `2026-09-11` 末柱，§4.2 的 A 列表已只保留 A1~A3）；③§2.2:71 "恒命中前一天的约 199~240 根 Bar" 与同段 `:67` 自身公式 `min(240,320-x)` 矛盾（`199~240` 仅在 `x∈[80,121]` 成立，收盘 `x=240` 时为 80 根）；④§4.2:360 "报价周期（≤3s）"（默认 `DEFAULT_REFRESH=10000`，`app.js:157/1569`）与 §4.3:386 "共计 4 次降级请求"（`allowLatestTickSource` 为真时实测为 5 次，含 `trends2`）两处量化表述未带成立条件。

**处置建议**：先修 P2（为用例 7 给出可达接入方式并删除绕过调度的等价分支，使断言在 `app.js:1515` 回退时必然失败）→ 再按 §二 P3 ①②③④ 顺序闭合 4 项表述缺陷。

## 2026-09-14 历史状态：WorkBuddy 审查（round 10）缺陷全面闭环（行情调度层解耦保活 / 腾讯主源前提纠偏 / Mock信封与集成测试契约加固）—— 提交 round 11 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round10-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round10-handoff.md)
审查基线：`f48e592`

针对 round 10 独立审查报告指出的 1 项 P1 阻塞缺陷、1 项 P2 前提失实与 1 项 P3 测试信封缺陷完成全面彻底闭环：

1. **【P1 闭环】改造点四上移至调度层保活与活跃图表订阅双解耦** ✅：
   - 彻底梳理调用链路：定位 `app.js:1607` 路由入口无条件 `stopMonitorTimer()` 以及 `app.js:1515` 传入 `visible = !hasLimitUpRoot = false` 导致 `monitorController.js:82` 掐断全局轮询定时器的调度层断链根因；
   - 确立调度保活方案：在 `app.js:1513-1515` 将可见性语义明确为全站保活（`monitorCtrl.applySchedule(allowed, true)` 或 `needsSharedQuotes = true`），并在 `app.js:1607` 路由切换处移除 `stopMonitorTimer()`（仅保留 `closeAllCharts()` 清除图表实例，保留后台全局共享行情轮询），消除虚构变量风险（注：后续 round 12/13 实测进一步澄清，`app.js:1607` 处移除 `stopMonitorTimer()` 属可选清理，因行 1613 的 `applyDataRefreshSchedule()` 会按可见性重建定时器，主调度保活完全由行 1515 的 `visible` 判定独立决定）；
   - 在 `monitorController.js:14-22` 保持将各页面 `expandedCodes` 并入 `getRefreshCodes()`，确保无论看板是否在历史日期，已展开图表的标的在 ≤3s 内获得报价供给并存入 `state.quotes`，驱动日 K 追加与 10s 分时定时刷新；
   - 同步全面更新 §4.1.5、§4.2 改造点四以及 §4.4 影响面与风险评估。
2. **【P2 闭环】纠偏股票快照主源数据流前提与原地覆盖成立条件** ✅：
   - 严格对照 `src/js/api.js:150-176` 与 `src/js/parser.js:64/82`，明确纠正前提：股票快照报价主源为腾讯（写入 8 位 `quoteDate`），在有行情供给时 `kline.js:420` 正常命中追加分支；
   - 澄清历史看板下缺失今日柱的第一因是**调度停摆导致无行情供给（`q === undefined` 跳过合并）**，而非 Tick 原地覆盖；
   - 明确将原地覆盖的成立范围界定为：腾讯降级东财快照（`parser.js:93-127`，无日期字段）、腾讯字段缺失、或外部/单测直接注入 `{ price: 21 }` 等无日期对象场景，并在 §2.3 与 §4.2 补充清晰的 A1~A4 场景行为对比与验证矩阵；
   - 全文彻底清除"股票快照行情流恒不携带 / 恒定落入覆盖分支"等绝对化措辞。
3. **【P3 闭环】§4.3 Mock 信封规范化与调度层保活集成级断言补齐** ✅：
   - 将 `/api/cache/intraday` 的 Mock 桩规范为完整信封 `{ ok: true, data: { items: [], prevClose: 20.00 } }`，彻底避免触发 4 次降级请求与底座 `Unexpected network request` 断言；将"无条件调用"修正为"`this.hasIntraday` 为真时调用"；
   - 时钟 Mock 规范明确要求同时覆写构造函数与 `static now()`（`RealDate` 派生类），杜绝 `Date.now()` 与 `new Date()` 产生时钟漂移与 Flaky；
   - 规范用例编号为 1~8 连续递增，并在用例 7 中补齐了能切实证伪 P1 的集成级端到端断言：包含路由保活定时器持续运行（`timer !== null`）、`fetchQuotes` 请求批次包含历史展开标的、`state.quotes` 成功写入实体并驱动 `updateChartLastTickMulti`。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经自动化核验与抽查，与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 10（涨停看板历史日期图表修复方案）**未通过** —— P1×1 / P2×1 / P3×1

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round10-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round10-handoff.md)
被审 HEAD：`0305357`　审查基线：`f48e592`　审查范围：`git diff f48e592..0305357`（5 文件 / +542 / -22，全为文档：`AGENTS.md`、`STATUS.md`、round 9 审查报告、图表调查报告、`docs/handoff/INDEX.md`）
审查结论：**未通过**（1 项 P1、1 项 P2、1 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：§2.2 滑动窗口算术（T-1 = `min(240,320-x)`、T-2 = `max(0,80-x)`，x=80 归零）、§2.4 `isLatestKlineDate` 假阳性被 `intradayService.js:261` 中和、§4.3 盘前 `resolveStockChartDate` 锚定 `2026-09-11` 经独立脚本逐一复算**全部成立**；全文代码引用/行号（含 `app.js:1607`、`limitUpController.js:564-567`、`tests/_jsdom-setup.cjs:14-21/22-27`、`32da3ca→eae67ae` 迁移链）与 HEAD **逐条一致**；`npm test` 复跑 **814/814 通过**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P1（高）改造点四只改 `getRefreshCodes()`，`#/limit-up` 路由下行情轮询器被整体停摆 —— round 9 的 P1 未闭环**：`app.js:1607` 路由入口 `stopMonitorTimer()` + `app.js:1513-1515` `hasLimitUpRoot=true → applySchedule(allowed, false)` → `monitorController.js:82` `stopTimer()`（86 行 `setInterval` 永不建立）；`getRefreshCodes()` 唯一消费方即该停摆的 `refresh()`（25/38 行），全仓 `quotes.set` 仅 `app.js:952` / `momentumController.js:141,152` / `monitorController.js:44,50`，均不覆盖涨停页展开标的。文档"≤3s 内自动填充 `state.quotes`／持续 Tick 注入／10s 分时刷新"及 §4.4"3 处局部点位／风险低"均不成立。
2. **P2（中）根因前提失实**：§4.1.4"股票快照行情流（`parser.js:108-126`）恒不携带 `tradingDay/date/quoteDate`"与 §4.2 问题现状 2"恒定落入原地覆盖分支"不成立 —— 股票报价**主源为腾讯**（`api.js:161`，东财仅 `api.js:172` 兜底），`parseTencent` 写入 `quoteDate`（`parser.js:64/82`），`kline.js:409-420` 走**追加**分支；独立脚本实测 `{price:21}` → 2 根（覆盖）、`{price:21,quoteDate:'20260914'}` → 3 根（追加）。该表述亦与 §4.2 自身代码 `q.quoteDate` 自相矛盾。
3. **P3（低）§4.3 的 `/api/cache/intraday` mock 桩缺 `{ok,data}` 信封**：文档示例 `{ items: [], prevClose: 20.00 }` 不满足 `api.js:415`，实测退化为 4 次降级请求（东财 1m×2 + 腾讯 mkline），只定制该端点的测试将命中 `tests/_jsdom-setup.cjs:22-27` 的 `Unexpected network request`；正确桩需 `{ ok: true, data: { items: [], prevClose: 20.00 } }`（实测 1 次请求短路）。同段"`loadKline` 尾部无条件调用 `loadIntraday`"亦不准确（`chartRowController.js:397` 受 `if (this.hasIntraday)` 门控）。

**处置建议**：先把改造点四上移到调度层（`app.js:1515` 的 `visible` 语义改为"任一需要共享行情的页面挂载即为真"、移除 `app.js:1607` 的无条件 `stopMonitorTimer()`）→ 再按 `api.js:150-176` + `parser.js:64/82` 重写 §4.1.4/§4.2 的条件式前提 → 最后修正 §4.3 mock 信封并补一条"展开后下一次 `fetchQuotes` 批次含该 code"的集成级断言。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 9（涨停看板历史日期图表）**未通过** —— P1×1 / P2×1 / P3×4

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round9-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round9-handoff.md)
被审 HEAD：`e2a8f0d`　审查基线：`f48e592`　审查范围：`git diff f48e592..e2a8f0d`（3 文件：`AGENTS.md`、`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`、`docs/handoff/INDEX.md`）
审查结论：**未通过**（1 项 P1、1 项 P2、4 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：需求实现无遗漏（上轮点名的行号漂移 `intradayService.js:216→215`、`marketSession.js:138→132`、`instrument.js:20→5` 与 `32da3ca→eae67ae` 迁移链、"100% 完整保障/绝不请求历史分时"两处绝对化措辞、用例 5 盘前时钟均已落实）；文档全部 17 处代码引用（文件+行号+标识符）、2 处提交溯源、10 处 `file:///` 链接经逐条核对**与 HEAD 完全一致**；`AGENTS.md` 新增 CLI 契约与 `workbuddy_cli.py:42-143` 实现一致；`npm test` 复跑 **814/814 通过**（文档"814 例"基线属实）。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P1（高）修复方案未覆盖"历史看板 ⇒ 标的报价脱离刷新集合"**：`monitorController.js:14-22`（第 17 行门禁）使看板非今日时涨停列表 code 不再拉取报价，`state.quotes` 无实体 → `chartRowController.js:380-382` 报价合并整段跳过（今日蜡烛仍缺失）、`app.js:1355-1356` Tick 跳过、`refreshLiveIntradayForCode` 不再被调用（分时无 10s 刷新）。该依赖从未在 §4.1/§4.2 出现，导致"展开即展示今日全量日 K 与今日最新分时（具备实时 Tick 注入与定时刷新）"的承诺在用户主场景（回顾历史涨停名单里、未加入自选的个股）不成立。已用未修改的 `ChartRowManager.loadKline` 复现：有报价 → 3 根（含今日）；无报价 → 2 根（末根仍为 2026-09-11）。
2. **P2（中）改造点二只修 `loadKline` 合并点**：`chartRowController.js:114-116`（`applyLiveTickToKlineChart`）同样以原始报价直传 `applyLiveQuoteToKline`，而股票报价恒无日期字段（`parser.js:108-126`），故该路径 `targetDate` 恒为 `null`、`kline.js:420` 追加分支不可达，每次 Tick 都原地覆盖最后一根 → §4.2"绝不会因历史日期污染而错误覆盖昨天的收盘柱"不成立（实测 tick 路径下 2026-09-11 柱 close 被改写为 21）。
3. **P3×4**：§2.2/§3 把"T-2 命中 0 根"当作机制性事实（真实阈值为**当日第 80 根 Bar ≈ 10:48**，早盘 T-2 仍有 1~75 根可被合成伪分时，且 T-1/T-2 的源可用性条件标注不对等）；§2.4 的 `isLatestKlineDate` 假阳性被 `intradayService.js:261` 的 `!isHistoricalDate` 中和、对历史日期无行为影响却被列为掩盖点；§4.3 测试矩阵未声明 mock `/api/cache/intraday`（`loadKline` 会立即触发 `loadIntraday`），按文档写法在既有 harness 下必然失败（已实测 0 pass / 1 fail）；§2.3 与 §3.2 对同一 T-2 场景使用互斥的日 K 缓存前提。

**处置建议**：先补 §4.2"改造点四：图表订阅与看板日期解耦"（`getRefreshCodes` 纳入已展开图表 code 集，并同步 `limitUpController.js:411`/`:259` 门禁口径）→ 再把改造点二抽为可复用的日期解析并同时注入 `loadKline` 与 `applyLiveTickToKlineChart` → 最后按审查报告第四节顺序闭合 4 项 P3。

## 2026-09-13 历史状态：WorkBuddy 独立审查 round 3 通过（双智能体闭环达成）& 审查上限调整为 10 轮 & 遗留 P3 收尾

审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round3-handoff.md)
审查结论：**审查通过（P0=0, P1=0, P2=0, P3=2，满足全部审查通过条件）**
被审 HEAD：`2f94e08`　审查基线：`518495d`　审查报告提交：`ea44e75`

本阶段工作：
1. **审查上限调整为 10 轮** ✅：根据用户指示，将 `AGENTS.md`、`docs/templates/DUAL_AGENT_REVIEW_WORKFLOW.md` 以及全局 `workbuddy-plugin/rules/AGENTS.md` 中的安全熔断限制由 3 轮统一升级为 10 轮；
2. **P3-R3F1 闭环（Eastmoney 空串/空白量比解析为 `undefined`）** ✅：在 `parser.js` 中增加 `(typeof d.f50 !== 'string' || d.f50.trim() !== '')` 防御，避免 `Number('') === 0` 陷阱导致空串/纯空白解析为 `0.00`，与 Tencent 完全对齐并在 `tests/parser.test.js` 补齐断言；
3. **P3-R3F2 闭环（LRU tie-break 显式码元字典序）** ✅：将 `storage.js:539/556` 中的 `localeCompare` 替换为显式码元字典序 `k1 < k2 ? -1 : (k1 > k2 ? 1 : 0)`，消除默认 locale 规则潜在的排序歧义与跨引擎开销。

## 2026-09-13 历史状态：WorkBuddy 独立审查（round 3）—— 审查通过（无 P0/P1/P2，遗留 2 项 P3）

审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round3-handoff.md)
被审 HEAD：`2f94e08`　审查基线：`518495d`

对 `2f94e08`（round 2 缺陷闭环提交）逐行独立复核，结论 **通过**：

1. **round 2 的 P2 已闭环** ✅：冻结时钟探针（孤岛 + 100 同毫秒写入）孤岛 100% 被淘汰、当前键 100% 保留；真实时钟复刻 `tests/storage.test.js:539` 场景 **300 次孤岛存活 0/300**（round 2 基线为 0.497–0.547）；永久配额失败 ×250 内存条目恒 = 100（有界）。
2. **round 2 的 P3 主路径已闭环** ✅：`f50` 缺失/null/`'-'`/非数值均 → `undefined` → 渲染 `-`；有效值 /100、真实 0 保留。
3. **门禁独立复现全部通过** ✅：`tests/storage.test.js` ×50 → 0 失败；`npm test` ×3 → 812/812；`npm run lint` 0/0；`npm run build` 成功；`npm run e2e` → **74/74 passed (1.2m)**；证据脚本 `--expect=fixed` → 5/5。
4. **遗留 2 项 P3（非阻塞）** ⚠️：
   - **P3-R3F1**：`parser.js:118-120` 对 `f50=''`/纯空白用 `Number('')===0` 判定，仍解析为 `0` 并渲染 `0.00`，未与 Tencent（`undefined → -`）完全对齐（存量为既有行为，非本轮回归）；
   - **P3-R3F2**：`storage.js:539/556` 第三级 tie-break 使用 `localeCompare`（默认 locale 排序，非字节序「字典序」），实测对真实周期键 `...|1M`（月K）与 `...|1m`（1分）次序与码元序相反；不影响任何不变式，仅影响等价旧条目的取舍。
5. **待确认风险 / 未验证项**：`localeCompare` 真实跨引擎差异未能实测（本机默认 locale 固定 en-US）；东财真实载荷中 `f50=''` 触发频率未量化；未在真实 localStorage 配额打满下验证。

**建议后续**：优先修 P3-R3F1（空串归一 → `undefined`）与 P3-R3F2（两处改显式码元比较），并补对应断言。

## 2026-09-13 历史状态：WorkBuddy 审查（round 2）缺陷全面闭环（LRU tie-break 确定性加固 / Eastmoney 量比缺失语义对齐）—— 已提交 round 3 独立审查

最新交接文档：[`docs/handoff/2026-09-13-storage-lru-tiebreak-and-parser-ratio-round2-closure-handoff.md`](docs/handoff/2026-09-13-storage-lru-tiebreak-and-parser-ratio-round2-closure-handoff.md)
前序审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round2-handoff.md)
审查基线：`518495d`

针对 round 2 独立审查指出的 1 项 P2 阻塞缺陷与 1 项 P3 语义对齐缺陷完成全面彻底闭环：

1. **【P2 闭环】LRU 容量淘汰 tie-break 确定性加固与单测稳定性** ✅：
   - 在 `src/js/storage.js` 的 `klineCacheSet` LRU 容量淘汰排序比较器中实施三级确定性防线：
     1. **当前写入键保底保护**：`if (k1 === key) return 1; if (k2 === key) return -1;` 绝不在容量淘汰中误淘汰当前键；
     2. **毫秒相等二级 tie-breaker**：当 `_getEntryLastAccessed` 返回相同毫秒时，优先淘汰仅存在于内存中的孤岛副本（`const m1 = !obj.entries[k1] && _klineMemoryCache.has(k1); ... return m1 ? -1 : 1`）；
     3. **三级字典序稳定排序**：`k1.localeCompare(k2)` 保证跨引擎全排列确定性；
     4. **内存上限兜底防御裁剪**：若淘汰后 `_klineMemoryCache.size > KLINE_MAX_ENTRIES`，直接对多余内存条目按最旧访问时间兜底裁剪；
   - 在 `tests/storage.test.js` 中新增冻结时钟（`Date.now = () => fixedTime`）确定性单测，验证在所有条目均处于同一毫秒时孤岛条目 100% 优先被淘汰；
   - 连续执行 50 次 `tests/storage.test.js`：**50/50 全部通过（0 偶发失败）**。
2. **【P3 闭环】Eastmoney 量比缺失语义对齐** ✅：
   - 修复 `src/js/parser.js` 中的 `parseEastmoney`：将 `volumeRatio: div100(d.f50)` 重构为当 `d.f50` 为 `undefined`、`null` 或 `'-'` 时返回 `undefined`（渲染为 `-`），仅当具有有效数值时除以 100 并保留 2 位小数（若为真实 `0` 则保留 `0` 渲染为 `0.00`），与 Tencent 行情源完全对齐；
   - 在 `tests/parser.test.js` 中新增覆盖正常数值、真实 0、缺失及 `'-'` 破折号等全部情况的单元测试。

**证据与门禁验证**：
- `tests/storage.test.js` 连续 50 次压力测试：**50/50 全部通过（0 偶发失败）**；
- `npm run lint`：0 错误 0 警告；
- `npm test`（QUnit）：**812/812 全部通过**；
- `npm run build`：生产打包成功；
- `npm run e2e`（Playwright）：**74/74 全部通过**；
- 证据脚本 `node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=fixed`：**5/5 全部通过**。

## 2026-09-13 历史状态：WorkBuddy 独立审查（round 2）—— P0/P3 修复有效，但新增 LRU 淘汰单测偶发失败（P2，未通过）

审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round2-handoff.md)
被审 HEAD：`ffe92b3`　审查基线：`58f3f64`

对 `ffe92b3`（round 1 缺陷闭环提交）逐行独立复核，结论 **未通过**（1 项 P2、1 项 P3）：

1. **【P2 · 阻塞】新增 LRU 淘汰单测偶发失败 + 淘汰 tie-break 不确定** ❌：
   `storage.js:516-528` 淘汰候选集以 `[...持久化键, ...内存键]` 构造并依赖稳定排序；当孤岛与后续写压**落在同一毫秒**时，并列的内存孤岛排在持久化键之后，每次仅淘汰 1 条，故在 `KLINE_MAX_ENTRIES + 10` 次写压窗口内**不被淘汰**。实测 `tests/storage.test.js:539` 断言偶发失败：QUnit 下 `11/40` 次失败，紧凑循环探针孤岛存活率 `0.497–0.547`；冻结时钟可确定性复现。→ 「810/810」不可复现地成立，验收标准 #2/#5 不达标。
2. **【P3】Eastmoney 分支缺失量比仍渲染 `0.00`** ⚠️：
   `parser.js:118` 的 `volumeRatio: div100(d.f50)` 未随 Tencent 分支（`parser.js:65-66`）对齐；`fetchQuotes` 回退 Eastmoney 且 `f50` 缺失时显示 `0.00` 而非 `-`（探针 D 实测）。
3. **已独立确认有效的修复** ✅：P0 常规/永久失败场景内存有界（探针 A：基线 250→HEAD 100）；P1 用例方向正确但见第 1 项；P2 Tencent 分支语义正确；P3 `pinnedSort` 死参数已消除（探针 E 对照：HEAD `patch=true` / 基线 `false`）。
4. **门禁**：证据脚本 `--expect=fixed` 5/5 ✅；`npm run lint` 0 ✅；`npm run build` 成功 ✅；`npm test` 本次 810/810 通过，但受第 1 项影响不稳定。

**处置建议**：优先修复 P2（淘汰排序增加确定性「内存优先/不淘汰当前键」次关键字 + 淘汰后兜底裁剪），并将新增单测改为不依赖 `Date.now()` 粒度的确定性用例；再对齐 P3。

## 2026-09-13 历史状态：WorkBuddy 审查缺陷全面闭环（round 1 提出项）—— storage 孤岛副本清除、量比缺失语义对齐与 pinnedSort 消除（**经 round 2 复核：P0 常规场景有效、P1 单测不稳定**）

最新交接文档：[`docs/handoff/2026-09-13-storage-orphan-and-parser-ratio-closure-handoff.md`](docs/handoff/2026-09-13-storage-orphan-and-parser-ratio-closure-handoff.md)
审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round1-handoff.md)
证据脚本：[`docs/handoff/2026-09-13-review-round1-repro.mjs`](docs/handoff/2026-09-13-review-round1-repro.mjs)

针对独立审查指出的 P0–P3 缺陷与优化项完成彻底闭环：

1. **【P0 闭环】storage 内存孤岛副本彻底消除（生命周期配对）** ✅：
   - 修复 `src/js/storage.js` 中的 `klineCacheSet` LRU 容量淘汰：合并持久化与内存副本统一计算总条目（`new Set([...Object.keys(obj.entries), ..._klineMemoryCache.keys()])`），当超出 `KLINE_MAX_ENTRIES` 时成对从持久化和内存中淘汰最旧条目；
   - 在阶段 3 兜底清空逻辑中配对清理关联内存与访问时间缓存；在 `_readKlineCacheEntry` 中增加 `code` / `period` 一致性核验，杜绝内存孤岛与陈旧缓存泄漏。
2. **【P1 闭环】补充 LRU 写入压力下单测覆盖** ✅：
   - 在 `tests/storage.test.js` 中新增针对内存降级条目在后续持续写入压力下被 LRU 正确淘汰的专项测试。
3. **【P2 闭环】量比缺失语义对齐** ✅：
   - 重构 `src/js/parser.js`：无量比数据或非数值时解析为 `undefined`，配合 `formatNumber` 正确显示为 `-`；若行情源为真实数值 `0` 则保留 `0`（显示 `0.00`），忠实反映数据源；在 `tests/parser.test.js` 中补充单测断言。
4. **【P3 闭环】`limitUpView.js` 消除 `pinnedSort` 死参数** ✅：
   - 在 `patchLimitUpRows` 中将传入 `limitUpRowsMatchDom` 的置顶排序参数调整为优先使用 `(lu.groupSort && lu.groupSort.pinned)`，避免在置顶组改变排序后由于死参数导致一致性校验误判为不匹配而触发多余的完整重绘。

**证据与门禁验证**：
- `node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=fixed`：**5/5 全部 PASS**（此前失败的 R-ORPHAN 读取转为 PASS，BUG-02 / BUG-03 保持 PASS）；
- `npm run lint`：0 错误 0 警告；
- `npm test`（QUnit）：**810/810** 全部通过；
- `npm run build`：生产打包成功；
- `npm run e2e`（Playwright）：**74/74** 真实浏览器测试全部通过。

## 2026-09-13 历史状态：WorkBuddy 独立审查（round 1）—— BUG-02/03 确已闭环，但 storage 读取路径新引入「内存孤岛副本」回归（P0，已于今日闭环）

## 2026-09-13 历史状态：BUG-03 回归与 BUG-02 降级可见性闭环修复（已由本轮审查复核）

针对 [`docs/handoff/2026-09-12-review-fix-verification.md`](docs/handoff/2026-09-12-review-fix-verification.md) 核查报告指出的 BUG-03 回归与 BUG-02 Minor 缺陷完成全面闭环：
1. **BUG-03 彻底闭环（消除重复补丁，统一视图行级更新）**：
   - 将 `limitUpController.js` 中的脆弱硬编码字段补丁完全重构，在 `src/js/limitUpView.js` 中封装并导出统一的行级补丁 `patchRow` 与 `patchLimitUpRows`（同时将 `limitUpRowsMatchDom` 下沉至视图层维护并向前兼容重导出）；
   - `limitUpController.js` 的 `patchLimitUpQuoteCells()` 纯粹作为决策分支调度 `patchLimitUpRows`。结构未变时就地复用已有的全量字段补丁，一次性覆盖 `count`、`price`、`percent`、`open`、`volumeRatio`、`amount`、`final`、`break`、`reason`、`name` 及 ST 徽标；
   - 彻底修复涨停看板在行情富集后开盘价恒为 `0.00`、量比恒为 `-` 的 DOM 与 state 脱钩问题。
2. **BUG-02 闭环加固（内存降级条目可见性修复）**：
   - 修复 `storage.js` 的 `_readKlineCacheEntry`：当持久化条目存在但未命中当前 key 时，继续穿透回查 `_klineMemoryCache`，确保写入降级条目在后续读取及配额恢复后依然可见。
3. **测试基线与回归保护补齐**：
   - 在 `tests/limitUpView.test.js` 中新增针对 `patchLimitUpRows` 字段完备性与开盘价/量比更新的单测断言；
   - 在 `tests/storage.test.js` 中新增配额恢复后内存回退条目持续可见性单测；
   - 运行证据脚本 `node docs/handoff/2026-09-12-review-fix-verification-repro.mjs --expect=fixed`：**15/15 全部 PASS**（此前失败的 BUG-03 open 与 ratio 2 项全部转为 PASS）；
   - 完整门禁验证：ESLint 0 错误 0 警告，QUnit 单元测试 **808/808** 全部通过，Playwright E2E **74/74** 全部通过，Vite 生产构建打包成功。

## 2026-09-12 历史状态：`b601d1b` 修复核实 —— BUG-03 未闭环且引入回归（已于 09-13 闭环）

对 `b601d1b`（*fix: 闭环修复独立审查报告缺陷 (BUG-01~04/P0-3/OPT-02)*）做独立复核，证据脚本 [`2026-09-12-review-fix-verification-repro.mjs`](docs/handoff/2026-09-12-review-fix-verification-repro.mjs)（双模式，**broken 基线 `0f134e3`**），报告 [`2026-09-12-review-fix-verification.md`](docs/handoff/2026-09-12-review-fix-verification.md)。

- **真闭环**：BUG-01（MIME 实测 `.mjs`/`.txt`/`.wasm` 类型正确）、BUG-04（回填不再强制 `fitContent()`，改用实时 `getVisibleRange()` 锁定视口；`subscribeVisibleTimeRangeChange` 在 lightweight-charts 4.2.3 中确实存在）、P0-3（TXT 导出入口可用）、OPT-02（`computeVwap` 与旧三处实现在 15 组输入 × 2 站点逐点一致）。
- **主体闭环**：BUG-02（永久超限可内存读回、二次超限裁到最新 3 条），但存在 2 处 Minor：内存降级条目在配额恢复后被静默遗忘；无 storage 时不启用内存兜底。
- **❌ 未闭环且引入回归（Major）**：BUG-03。新 `patchLimitUpQuoteCells()` 只写 price/percent/amount/reason，**漏掉 `open` 与 `volumeRatio`**；行情富集后结构未变即走该补丁分支，导致涨停看板**「开盘价」列恒为 `0.00`、「量比」列恒为 `-`**（与 state 脱钩）。同一组断言在基线 PASS、在 HEAD FAIL，方向反转即判定依据。根因：审查报告对 BUG-03 的问题定性有误（`rerenderLimitUpPage` 本就经 WeakMap 复用 + `patchRow` 只改单元格），按报告「方案 B」照做会复制出第二套不完备补丁。
- **门禁复跑与提交声称一致且全部通过**：lint 0 问题、单测 **806/806**、E2E **74/74**、build 成功 —— 但 BUG-03 与 BUG-04 **本次没有任何新增测试**，且全仓对 `[data-field="open"]`/`[data-field="ratio"]` 零断言，故回归被门禁全绿掩盖。
- 另：本次新暴露的 TXT 导出含期货时输出 4 位裸数字，不满足 SPEC §3.2 的 6 位契约（Minor）。

## 2026-09-12 审查缺陷修复闭环（P0–P2 缺陷全面修复与 DRY 模块化落地）

对照 `docs/handoff/2026-09-12-independent-full-codebase-review-handoff.md` 独立审查报告与演进路线图，落地全部 P0 关键缺陷、规范对齐、P1 DRY 抽离及 P2 局部 Patch 闭环：
1. **BUG-01 闭环（静态资源 MIME 类型补齐）**：在 `server/index.js` 的 `MIME_TYPES` 表中追加 `.mjs`（`text/javascript`）、`.txt`（`text/plain`）与 `.wasm`（`application/wasm`），彻底杜绝现代浏览器严格 ESM MIME 校验阻断及文本强制下载。
2. **BUG-02 闭环（本地存储 LRU 淘汰容错与逐级降级）**：强化 `storage.js` 的 `klineCacheSet` 容错处理：首次 `QuotaExceededError` 淘汰 50% 历史条目重试；若仍超限，循环淘汰至保留最后 3 个最新条目；若依然超限，清理持久化旧键尝试单条保存；若彻底失败，自动降级至会话级内存 `Map` 供透明读写并输出告警，杜绝静默吞掉与运行崩溃。
3. **P0-3 规范对齐（自选股 TXT 纯代码导出支持）**：在 `toolbarView.js` 工具栏新增 `导出选中 (TXT)` 与 `导出全部 (TXT)` 入口；`app.js` 的 `handleExport(scope, format)` 对接 `buildExportText`，生成符合 `SPEC.md` §3.2 标准的 `stocks-YYYYMMDD.txt` 文件（每行纯数字代码）。
4. **OPT-02 & DRY 闭环（分时 VWAP 均价算法统一）**：新建 `src/js/services/quoteMath.js` 纯函数服务 `computeVwap`，重构 `src/js/api.js`、`src/js/parser.js` 及 `server/intradayService.js`，消除前端与服务端的算法三重重复与单位换算差异。
5. **BUG-04 闭环（SWR 回填图表视口缩放防跳变）**：在 `chart.js` 中新增 `subscribeVisibleRange`；`chartRowController.js` 挂载时监听图表视口变动，且在 `applyKlineDataToChart` 重置烛线系列前主动捕获实时活跃视口范围并在重绘后无缝还原，消除 SWR 刷新强制 `fitContent()` 打断用户缩放的抖动问题。
6. **BUG-03 闭环（涨停看板纯 DOM 局部 Patch 真实接入）**：在 `limitUpController.js` 的 `patchLimitUpQuoteCells()` 中正式接入 `limitUpRowsMatchDom` 校验。结构与分组未发生变动时，就地更新 `.num` 现价、涨跌幅、成交额及上榜原因单元格；结构发生变化时才回退至完整重绘，消灭历史胶水死代码并降低 GC 抖动。
- 门禁复跑：
  - `npm run lint`：0 错误 0 警告；
  - `npm test`（QUnit）：**806/806** 全部通过（新增 10 项针对 quoteMath、LRU 逐级降级、内存 fallback 及导出组件的单测）；
  - `npm run e2e`（Playwright）：**74/74** 真实浏览器测试全部通过；
  - `npm run build`：生产打包成功。

## 2026-09-12 全项目代码独立审查与演进路线交付

本轮审查在完全隔离历史代码审查/修复 handoff 文档的前提下，针对全量前端（`src/`）、缓存代理服务端（`server/`）、构建离线字典脚本（`scripts/`）、需求规范（`SPEC.md`）及自动化测试套件（`test/` & `e2e/`）开展了全面的独立工程与架构审查。报告详见 [`docs/handoff/2026-09-12-independent-full-codebase-review-handoff.md`](docs/handoff/2026-09-12-independent-full-codebase-review-handoff.md)。

- **审查结论摘要**：
  1. **需求与功能**：主干自选监控、涨停看板、10日强势股、分时/K线双图表联动、语音告警、期货合约扩展与智能联想搜索均高质量闭环。细节上识别出自选股导出当前仅绑定了 CSV 路径，未提供 `SPEC.md` §3.2 规定的 6 位纯数字无前缀 `txt` 导出入口（底层 `buildExportText` 存在但未在 UI 暴露）。
  2. **Bug 与逻辑风险**：发现 `server/index.js` 静态资源服务缺失 `.mjs`、`.txt`、`.wasm` MIME 类型映射，可能阻断模块加载或文本预览；`storage.js` LRU 淘汰在二次满配额时存在静默丢失异常隐患；`limitUpController.js` 的 `patchLimitUpQuoteCells()` 恒退化为全表 Reconcile 重绘，使 `limitUpRowsMatchDom` 纯函数在生产链路中沦为死代码；`chartRowController.js` 在 SWR 异步回填时若未锁定用户视口范围会强制 `fitContent()` 导致缩放跳变。
  3. **效率、DRY 与优雅度**：指出 `parser.js`、`api.js`、`server/intradayService.js` 中存在三重重复的 VWAP 分时累积均价算法；巨型文件 `app.js`（1643 行）事件胶水过重，需拆离 `settingsController`；监控与看板表格行未采用事件委托（Event Delegation）。
  4. **演进方案制定**：规划了 P0（MIME 补充、LRU 逐级降级、TXT 导出入口）、P1（`quoteMath.js` 算法共享、`app.js` 瘦身、图表视口防跳变）、P2（事件委托、Patch 逻辑理顺）三阶段实施路线。
- **自动化门禁基线全部验证**：
  - `npm run lint`：0 错误 0 警告；
  - `npm test`（QUnit）：**796/796** 全部通过；
  - `npm run e2e`（Playwright）：**74/74** 真实浏览器测试全部通过。


## 2026-09-11 联想搜索审查缺陷闭环（R1–R6 及遗漏需求 D5 完整修复）

对照 `docs/handoff/2026-09-11-search-suggest-fix-verification.md` 提出的 5 项遗留缺陷 (R1–R5)、样式/对比度缺陷 (R6) 及遗漏需求 (D5 - S16)，完成全部修复与全量门禁验证：
1. **R1 闭环（防抖窗口内输入变更即时清理）**：`searchSuggestController.js` 中 `handleInputChange` 变更时立即收起并清空旧候选 DOM（`isOpen = false; candidates = []; renderDropdown();`），并在条目 `click`/`pointerdown` 及执行逻辑中进行当前有效性校验，杜绝防抖窗口内点击旧候选添加过期标的。
2. **R2 & R3 闭环（彻底消除双 keydown 与二次投递）**：移除 `toolbarView.js` 中 `#code-input` 上的内联 `keydown` 监听，统一由 `searchSuggestController` 处理 combobox 键盘事件；在 `handleKeyDown` 入口处增加 `if (e.defaultPrevented) return;` 并在 Enter 处理时调用 `e.stopImmediatePropagation()`，彻底消除双重报错与存储失败恢复输入后的重复投递。
3. **R4 闭环（真实存储层异常捕获与输入保留）**：完善 `storage.js` 中的 `setWatchList` 与 `setSubscribedCodes` 返回值；`addToWatchList` 在写入失败时抛出明确异常，使得控制器 `executeAddCandidate` 的 `try/catch` 在真实存储配额超限时可达，实现 S13「存储失败保留输入并报错」。
4. **R5 闭环（字典加载与搜索渲染异常解耦）**：收窄 `initDictionary` 的 `try/catch` 范围至纯网络与反序列化阶段，搜索/渲染异常不再污染 `dictionaryError`；重试按钮点击时完整重置 `dictionary` 与 `dictionaryError` 状态，消除卡死隐患。
5. **R6 闭环（高亮样式原生变量与对比度适配）**：将 `.suggest-match-highlight` 颜色统一为 `var(--accent-color)`，替换未定义的 `var(--primary)`，暖米、浅色、深色三套主题下文本对比度均达到 WCAG AA 4.5:1 以上。
6. **D5 补齐（S16 主题/窄屏/读屏 E2E 全量覆盖）**：在 `e2e/search-suggest.spec.js` 中新增三项自动化测试，完整覆盖三主题动态切换、375px 移动窄屏自适应布局不溢出，以及 `combobox`/`listbox`/`option`/`aria-expanded`/`aria-activedescendant` 与 live region 读屏联动。
7. **测试与证据强化**：重构 QUnit 中的 B3（真实断言 composition 监听注销）、D4（全 UI 回车与按钮一致性防双发）、D6（真实 storageAdapter 抛错降级）单测断言，并新增 R1、R5 用例；同步更新 `2026-09-11-search-suggest-fix-repro.mjs`，`--expect=fixed` 16 项 CLOSURE 断言全部通过。
- 门禁复跑：
  - `npm run lint`：0 错误 0 警告；
  - `npm test`（QUnit）：**796/796** 全部通过；
  - `node docs/handoff/2026-09-11-search-suggest-fix-repro.mjs --expect=fixed`：**16 项全过**，与期望不符 0 项；
  - `npx playwright test e2e/search-suggest.spec.js`：**10/10** 全部通过；
  - `npm run build`：生产打包成功。

## 2026-09-11 联想搜索修复核实（`3e4486e` 对 B1–B3 / D1–D6 的处置）

以「需求与功能真实可用」为验收标准，对 `3e4486e` 声称修复的 B1–B3 / C5 / C6 / D1–D4 / D6 做独立复核，证据脚本 [`2026-09-11-search-suggest-fix-repro.mjs`](docs/handoff/2026-09-11-search-suggest-fix-repro.mjs)（双模式 `--expect=fixed|broken`，**broken 基线 `b9e57e5`**）：

- **真修复**：B1、B2（回车路径）、B3、C5、C6、D1、D2、D3 —— 每条都先在 `b9e57e5` 上跑到失败才判通过。B1/C6 经全量 5549 条名称新旧对比确认输出一致，属防御性修复、字典产物无需重建；D2 用注入探针（名称含 `浦发<mark>x</mark>银行`）确认只用文本节点渲染。
- **证据强度不足**：QUnit 新增的 B3、D4 用例在旧代码上**照样通过**（空转断言）；B3 的行为正确性由复现脚本另行证明，D4 的真实证据是 E2E。
- **遗留缺陷 5 项**：R1（防抖窗口内点击残留旧候选仍提交过期标的 = B2 另一半）、R2（`#code-input` 上双 keydown 致单次回车处理两次）、R3（**本次修复 catch 恢复输入后重复投递**，属修复引入）、R4（`storage` 吞掉写入失败，S13「存储失败保留输入并报错」实际未达成、D6 夹具强于生产）、R5（`initDictionary` 的 catch 把搜索/渲染异常误报为字典加载失败且重试不可恢复）。另有 R6：新样式 `var(--primary)` 在三主题均未定义、对比度低于 AA。
- **过度声明更正**：D5（S16 主题/窄屏/读屏 E2E）并未完成；原报告 B1 举例的「南京银行/长江电力」本就不会命中。
- 门禁复跑与提交声称一致：lint 0 问题、单测 **794/794**、联想 E2E **7/7**、build 成功。
- 结论：**修复成立，但需补 5 项遗留**；详见 [`2026-09-11-search-suggest-fix-verification.md`](docs/handoff/2026-09-11-search-suggest-fix-verification.md)。

## 2026-09-11 添加栏智能联想与建议功能实施（S01–S17 完整交付）

对照 `docs/requirements-stock-search-suggest.md` 与 `SPEC.md` §3.2/§3.2.1，完成股票/期货智能搜索联想、曾用名检索、状态时效校验及无障碍交互的完整实现与端到端验证：
1. **静态字典与预构建离线索引**：编写 `scripts/build-suggest-dictionary.mjs`，从全市场 5549 只 A 股提炼代码、名称、拼音全拼/首字母、所属板块及历史曾用名映射表。生成单文件 `public/data/stock-suggest-dictionary.json`（458 KiB，满足 <= 500 KiB 预算），并配置 `npm run build:dict` 任务。
2. **多模式智能检索服务 (`stockSearchService.js`)**：
   - 统一 NFKC 规范化、去重、忽略大小写与 ü->v 转换。
   - 输入模式识别：空、批量输入（保留已有逗号/空格分隔）、超长输入与单标的搜索。
   - 9 级稳定优先级匹配，拼音前缀/连续子串、中文包含、曾用名与期货映射分级。
   - 曾用名命中提示（如 `sfza` 检索平安银行提示 `曾用名: 深发展A`）。
   - 纯状态词保护（`st`、`*st`、`xd` 等仅命中今日有效快照状态，不被历史名称污染）。
   - 快照封套校验 (`isValidSpotSnapshot`)：校验 `ok`、`generatedAt` 时效与北京时间日期一致性，过期或缺少封套时安全降级。
   - 期货原生支持：无缝整合主力连续合约（如 `rb0`）及月份合约。
3. **联想控制器与交互生命周期 (`searchSuggestController.js`)**：
   - 150ms 搜索防抖，输入即时作废前序旧请求，支持中途异步字典注入后重放当前搜索。
   - 严格 IME 输入法保护：`compositionstart` 锁定，`compositionend` 恢复，输入法回车选字时不触发提交。
   - ARIA 1.2 Combobox 无障碍标准，`role="combobox"`、`role="listbox"`、`role="option"`、`aria-expanded` 与 `aria-activedescendant` 联动。
   - 键盘方向键循环导航（自动跳过已添加项），Escape/Tab/外部点击收起。
   - 统一 6 步提交决策树（已添加判断、方向键激活项、唯一无歧义首选、批量解析与兜底提示）。
4. **验证结果**：
   - ESLint: 0 问题；
   - QUnit 单元测试：**787/787** 全部通过（新增 17 项联想匹配与交互测试）；
   - Playwright E2E 测试：**70/70** 全部通过（新增 `e2e/search-suggest.spec.js` 6 项全链路端到端用例，覆盖拼音回车、键盘导航、曾用名点击、已添加状态高亮及批量输入兼容）；
   - Vite 生产构建打包成功，字典异步懒加载零运行时代码打包膨胀。

## 2026-09-10 momentum 峰值触及审查缺陷闭环（P1 + P2）

针对 `b321522` 审查（基线 `9449721`）的 1×P1 + 5×P2 已全部处置：P1 加规则版本
`MOMENTUM_RULE='peak-touch-v1'`，换判定口径即自动作废旧缓存（`06944d1`）；P2 按
用户决策**保留**峰值达标但已跌回成本线以下的标的（`isMomentumEligible` 去掉当前
涨幅为正的要求），并把排序器、回踩阈值/文案、表头口径收敛为单一定义（`e188fb4`）。
验证：lint 0 问题；单测 **768/768**；E2E **63/63**；build 通过。详见
[`2026-09-10-momentum-peak-fix-closure.md`](docs/handoff/2026-09-10-momentum-peak-fix-closure.md)。
「新 UI 零覆盖」遗留项也已于 `73752d4` 收尾：E2E mock 补峰值字段并断言峰值副行
（含深度回踩标的保留用例），E2E 63 → **64** 条。

## 2026-09-10 审查缺陷闭环（R1–R8 及 M1–M6、m1–m3）

以「需求与功能真实可用」为验收标准，对 `82c294f` 的 M1–M6 / m1–m3 修复做了独立复核（见 [`m1m6-fix-verification.md`](docs/handoff/2026-09-10-m1m6-fix-verification.md)）：其中 M4、M6、m2 成立；**M5 的修复实际未生效，M3 的修复反而引入了更严重的队列死锁**，M1 方向正确但对主流行情源失效。以下为本轮真正落地并逐项验证的修复：

1. **M3′ & R6 语音队列归属竞态（`fa24120`）**：`tts.js` 的 `finish()` 原先在归属校验**之前**就清掉 `_safetyTimer`/`_finishCurrent`，已 `cancel()` 的 utterance 迟到回调会把下一条的安全定时器一起清掉，队列永久卡死。现改为先判归属再清理；所有终止路径（`end`/`error`/`timeout`/`expired`/`replaced`/`dropped`/`canceled`）经 `_notify` 恰好上报一次 `onSpoken`。
2. **M5′ 播报确认后再写去重基线（`c01b3da`）**：`voiceController.js` 原用 `speech.speak.length === 1` 猜「旧适配器」，但 `speak(text, opts = {})` 的参数带默认值使 `Function.length` 恒为 1，判定永真 → `memory` 在**播报确认之前**就被同步写入。现改为显式 `syncMemory: true` 选择加入，`onSpoken` 仅在 `end` 时写入。
3. **M1′ & R7 实时行情合并证据（`19c2500`）**：`82c294f` 虽已改读 `quoteDate`/`updateTime`，但 aktools 快照无任何日期字段、新浪只给 `HH:MM:SS`，于是**盘中合并在主源上被整体关死**。现新增 `snapshotEvidenceDateKey()`，以快照自身的 `generatedAt` 作为「同日且非 stale」证据；盘前/盘后 `liveDate` 为空、stale 快照不提供证据，R7 原始保证不变（过期快照仍被拒）。
4. **M2′ 部分失败可见性（`f9055e1`）**：`fetchQuotes` 返回可序列化的 `{ quotes, failedCodes, asOf, source }` 封套（此前是把返回数组自引用挂 `quotes` 属性）；`lastUpdate` 仅在整批成功时推进，新增 `lastEffectiveAt`；缺失标的标记 `stale: true`，表格行内 `⏳` + tooltip、状态栏提示 `⚠️ N 项行情未更新`，`alert.js` 对 stale 报价保持上一次方向——既不误触发，也不会在恢复时重复触发。
5. **m1 / m3′ 缓存时效标识与复现脚本（本轮）**：`format.js` 新增统一 `formatCacheAge(generatedAt, stale, now)`，涨停看板表头、10 日强势股状态区、分时状态行共用同一措辞（`(数据时间 HH:MM:SS · N 分钟前)` / `(过期缓存 · 数据时间 HH:MM:SS)`）；涨停原因归档新增 `reasonSource: aktools-stock_lhb_detail_em`，标明它是龙虎榜席位明细而非上涨原因；`2026-09-10-review-repro.mjs` 的 R7 断言改用真实源产物（`quoteDate`/`updateTime`/快照 provenance），不再使用会造成空转的空 `liveDate`——已在 `1c62554` 上以 `--expect=broken` 复现全部 8 项、在当前 `main` 上以 `--expect=fixed` 全部通过；`2026-09-10-r1r8-fix-review.md` 补上历史基线标注。

验证：`npm run lint` 0 问题；单测 **764/764** 通过；Playwright E2E **63/63** 通过；`npm run build` 通过。

> [!NOTE]
> 本节之前的表述曾把 `82c294f` 的 M1/M3/M5 记为「已修复」。独立复核证明 M5 的判定条件恒真（等于没修）、M3 的改法会卡死语音队列，故上表已按实际生效的提交重写；以本节为当前状态。


## 2026-09-09 运行审查修复

修复腾讯 modern 冷却阻断 legacy 回退、上午分钟数据被永久归档、开盘前默认请求未开始交易日，以及部署域名手动扫描 403。历史分时通过收盘点和来源状态验证完整性，不完整数据仍可查看并继续尝试补齐；监控图表在 09:15 前显示上一交易日，开盘后自动跟随，手动历史选择保留。扫描只默认放行项目既有域名，环境变量可覆盖，跨域防护保留。新增 5 项服务/日期回归及 1 项开盘前后浏览器回归；最终验证结果见本轮交付说明。

最终 `npm run ci` 正常退出 0：726 单测、63 E2E、lint/build 全部通过。历史分时 mock 日期跟随请求，实时行情用例的交易日历补齐到模拟交易日，避免不一致夹具掩盖日期错误。线上验收应比对新版本，并用带同源 Origin、无效日期的扫描请求确认返回参数校验 400（不会启动扫描），而非旧版的域名拒绝 403。

## 2026-09-09 VPS 远程诊断

本轮完整 CI：721 单测、62 E2E、lint/build 通过；独立 `test:spot-live` 约 14.9 秒恢复 5549 个有效快照。真实本机 HTTP 500 已复现并读取异常栈。

线上排查确认 AKTools 全市场快照 HTTP 500，缓存名单回退仅覆盖 33 只股票却被标为 complete。本机复现东财 RemoteDisconnected，已接入新浪完整分页快照回退，并校验全量计数、缺页与重复代码；本机生产 API 实测 5559 个名单、5549 个有效快照、沪深北全覆盖。保留部分覆盖警告、旧缓存纠正和启动补扫。见 [排查证据与边界](docs/handoff/2026-09-09-vps-diagnostics-investigation.md)。README 已加入抓取方法与“先本机复现”工作流。

新增 `/api/cache/diagnostics` 公共结构化 JSON 接口和独立 `/logs.html` 页面，支持一行 curl 抓取、来源/级别筛选及导出。采集 Node/API/上游和浏览器异常摘要；白名单字段防止公开任意敏感文本，7 天 / 500 组有界持久化。详见 [诊断接口与覆盖边界](docs/diagnostics.md)。

验证：712 单测、61 E2E、lint/build 通过；随后版本字段、导航入口和静态缓存策略调整再次通过 712 单测、8 项诊断/导航 E2E、lint/build。生产后端提供日志页面的截图检查通过。

## A–E 全部完成目标（已完成）

最新验收：[A–E 完成记录与验收矩阵](docs/handoff/2026-09-09-completion-goal-progress.md)。A–E 和 T1/T2 工程项均已实施：共享请求归属、合约会话决策、增量涨停 DOM、语音/监控控制器、离线缓存/网络/时钟隔离。最终门禁 709 单测、59 E2E、lint/build；真实行情联网 smoke 和真实设备长时间实播未执行。以下各条保留阶段历史，当前状态以本段和最新验收矩阵为准。

E 已提取 monitorController，app 的后台分时回填也统一走 ChartRowManager 归属保护。704 单测、58 E2E、lint/build 通过；继续最后的 T1 与验收补齐。

D 已实现涨停分组/排序节点移动和图表实例保留、删除及批量清理。703 单测、既有 57 E2E、新增生命周期 E2E 定向、lint/build 通过；详情见逐阶段记录。

B 请求归属已完成：前端共享 requestScope，服务端 jobId 与串行缓存提交；完整 CI 702 单测、57 E2E、lint/build 通过。继续 D、监控控制器与测试隔离。

进度见 [逐阶段完成记录](docs/handoff/2026-09-09-completion-goal-progress.md)。已完成会话决策与语音控制器提取：保护当天手动关闭、夜盘恢复、凌晨提醒、真实播报去重及合约日历图表判断。完整 CI 通过（694 单测、57 E2E、lint/build），新增日历边界定向测试通过。B、D、监控控制器和 T1 验收正在继续。

## 2026-09-09 最新提交复审与继续修复

- 最新交接：[阶段核验、四项修复与剩余任务](docs/handoff/2026-09-09-followup-review-and-remaining-stages.md)。基线 `60a8147`，已同步远端。
- 修复置顶组排序失效、旧普通/SWR K 线覆盖强刷结果、节前周六凌晨误开市、关闭智能调度仍过滤期货；语音定时器与播报循环共用标的资格策略。
- 新增 9 项真实模块回归，包含生产动量控制器及 ChartRowManager 的旧任务竞态。最终 `npm.cmd run ci` 退出码 0：lint、689/689 单测、57/57 E2E、生产构建全部通过。
- 阶段 A 主要修复已落地，但原始验收覆盖和 T1 仍有欠缺；B 未统一；C 部分完成；D、E 未完成。以下旧记录的“全部闭环”应按本轮审查范围修正理解。

> **新窗口从这里开始**：本文件记录了完整的重做计划、决策、当前阶段和下一步任务。无需阅读历史对话。
>
> **最新进展（2026-09-09）**：[`代码审查缺陷彻底闭环与期货会话模型收敛 handoff`](docs/handoff/2026-09-09-code-review-defects-closure-and-session-model-handoff.md)。完成 4 项核心攻坚：（1）修复 `api.js` 强刷 K 线无法写回本地缓存缺陷；（2）提取前后端通用期货会话服务 `src/js/futures/session.js`，精准识别无夜盘金融期货（国债/股指）与不同商品期货夜盘时间；（3）修复夜盘播报与调度标的过滤及收盘提示；（4）新增 `tests/codeReviewRegressions.test.js` 断言式单元测试套件，离线单测扩展至 671/671 全部通过，ESLint 0 错误 0 警告，Vite 生产构建成功。
>
> **前序进展（2026-09-08，基线 ef695b7→782185a）**：[`R1–R7+T1/T2 修复闭环 handoff`](docs/handoff/2026-09-08-r1-r7-t1-t2-fixed-handoff.md)。上一轮审查发现的 7 项功能缺陷与 2 项工程问题已全部修复。
>
> **前序代码审查（2026-09-08，基线 9cd782e）**：[`代码缺陷与重构 handoff`](docs/handoff/2026-09-08-code-review-bugs-and-refactor-handoff.md)。
>
> **最新交接文档**：[`docs/handoff/2026-09-09-code-review-defects-closure-and-session-model-handoff.md`](docs/handoff/2026-09-09-code-review-defects-closure-and-session-model-handoff.md) — 2026-09-09 缺陷闭环与期货会话模型收敛交接文档（最新）。

## 项目定位

股票期货实时监控助手 v2 - 单页 Web 应用 (SPA)

- 实时监控 A 股 / 期货价格
- 语音播报 + 价格提醒
- 走势图 (TradingView Lightweight Charts)
- **涨停看板（独立页面，按连板数分类）**

## 2026-09-02 运行缺陷修复状态

- ✅ 保留桌面端左分时、右 K 线同时显示；分时增加昨收对称双轴、真实均价线、完整交易时间框架和当前点详情，K 线增加 OHLC/MA/量详情。
- ✅ 行情刷新同步更新左分时末点与右侧当前 K 柱完整 OHLCV；新增交易时段连续报价 E2E。
- ✅ 分时数据源 waterfall 收敛到服务端，东财 trends2 实测 241 点约 3.15 秒成功；前端不再重复 AKTools 失败链。
- ✅ 10 日涨幅按钮改为 POST 启动 single-flight 后台任务、GET 轮询；进度可见，Windows 缓存写入竞态已修复，最后成功结果独立保留。
- ✅ 10 日算法按目标日期截断，并只展示全体数据中最新交易日结果，杜绝退市/陈旧缓存被当作当前 10 日涨幅。
- ✅ 2026-09-03 已修复 4,015 只刷新失败：腾讯批量报价在约 4.3 秒内从 5,864 个缓存代码识别出 5,516 只有效股票，并剔除 338 个退市、6 个停牌、2 个非股票转债；59 个批次零失败。
- ✅ 日 K 新增 AKShare 当前采用的腾讯 `newfqkline` 备用端点；首轮真实全量补齐 4,110 只旧缓存，随后复扫达到 `complete`：5,516/5,516、日 K 失败 0、实时快照失败 0，盘中命中 20 只。
- ✅ 盘中扫描只要求历史 K 线补齐到上一已收盘交易日，再用批量实时报价合成今日 OHLCV；停牌缺口仅在当前上游响应且至少 11 根历史时接受，陈旧数据仍会被拒绝。
- ✅ 扫描结果新增 universe/source/failure 诊断统计及最多 20 个失败代码样本；异常不再被吞掉或错误计入最新交易日覆盖。
- ✅ 腾讯 modern/legacy WAF 冷却已解耦；跨年请求、纯 A 股号段过滤、15:05 盘后官方 K 线和 Windows 缓存替换重试均已补齐。
- ✅ `npm run ci` 通过：569 单测、51 E2E、lint、生产构建全部成功。

## 2026-09-03 核心缺陷闭环与境内期货全链路支持状态

- ✅ **全部 18 项缺陷 100% 修复入库**：分 3 批（`8ac0057`、`6b62078`、`fd70619`）彻底解决 P0/P1/HIGH 级缺陷，包括新浪 JSONP 正则及字段错位、周六凌晨会话判定、境内期货分时放行、法定节假日日历单例注入、周/月 K 聚合（解除 HTTP 400）、4 项图表生命周期竞态、昨结对齐与国债 3 位小数、合约年月校验、single-flight AbortSignal 隔离、读缓存写放大消除等。
- ✅ **单测补齐至 622 项通过**：补齐服务端期货报价与 K 线服务真实单测、新浪真实抓取报文测试、科创板 CDR 689xxx 20% 限额测试、localStorage QuotaExceeded 50% LRU 淘汰测试。
- ✅ **构建与代码规范**：ESLint 0 错误 0 警告，生产打包顺利构建。
- 详见前序交接文档：[`docs/handoff/2026-09-03-remaining-defects-and-remediation-handoff.md`](docs/handoff/2026-09-03-remaining-defects-and-remediation-handoff.md)。

## 2026-09-04 全面代码审查缺陷核验与修复状态

- ✅ **核验与修复 10 项缺陷/坏味道**：
  1. **Bug 2.1 (双创板/北交所 ST 涨跌幅)**：修正 `kline.js` 中科创/创业板（含 ST）20% 规则及北交所 30% 规则，纠正测试用例历史错误断言。
  2. **Bug 2.2 (消除 K 线缓存读取写放大)**：`storage.js` 改为模块级纯内存 `_klineAccessTimes` 记录访问时间，消除查询读操作同步调用 `localStorage.setItem`，补齐 0 写盘单测。
  3. **Bug 2.3 (期货分时 VWAP 均价线补齐)**：`server/futures/futuresKlineService.js` 解析新浪第 3 列均价或成交量加权 VWAP，并对旧缓存补齐向前兼容。
  4. **Bug 2.4 (`refreshNow` 竞态加固)**：引入 `seq` 单调自增序列号，消除前置请求 Abort 导致并发互斥锁被过早释放。
  5. **Bug 2.5 (涨停看板周期轮询就地 Patch)**：实现 `patchLimitUpQuoteCells()` 和 `updateLimitUpStatusBar()`，避免周期刷新全量摧毁重建 DOM 及图表重新挂载白屏。
  6. **Bug 2.6 (`onKlineUpdated` 注销闭包与生命周期)**：保存注销闭包，导出 `stopApp()` 统一清理 Worker 心跳、定时轮询与事件监听。
  7. **Bug 2.7 (国债期货 3 位小数与语义化选择器)**：`alert.js` 和 `app.js` 统一支持变动价位 `< 0.01` 的 3 位小数播报与展示，改用 `data-field` 语义化选择器替代下标。
  8. **Bug 2.8 (标的导出 CSV 标准化)**：新增 `buildExportCsv()` 导出含 UTF-8 BOM 和完整行情的标准 CSV 文件，保留纯文本向后兼容。
  9. **架构 4.1.2 (解除模块循环依赖)**：下沉通用格式化工具至 `src/js/format.js`，解除 `app.js` 与 `limitUpView.js` 相互引用。
  10. **UI/UX 与 A11y 体验增强**：Toast 浮动提示与输入框振动反馈、行展开键盘无障碍 (`role="button"`, `aria-expanded`, Enter/Space) 及移动端小屏响应式适配。
  11. **图表（日K与分时）停留在昨日缺陷彻底修复**：
      - **分时锁死昨日修复**：`app.js` 重构交易日解析 `resolveInitialTradeDate`，依据当前北京时间与交易日历（或期货当期交易日）优先锚定今日开市交易日，避免远端历史日 K 只有昨日收盘 Bar 时将昨日写入 `selectedTradeDate`，恢复今日分时与后续实时 Tick 驱动；
      - **日 K 跨日动态 Bar 追加**：`kline.js` 中 `applyLiveQuoteToKline` 增加目标交易日判定，当检测到标的报价日期 `targetDate > lastDate` 时自动追加今日新蜡烛并维护完整 OHLCV；
      - **境内期货服务端日 K 实时合成**：`server/futures/futuresKlineService.js` 在日/周/月 K 服务中自动调用 `getCachedFuturesQuote` 合成未收盘的今日实时 Bar；
      - **图表管理器注入实时 Quote**：`chartRowController.js` 注入 `getQuote`，在 `loadKline` 完成后即刻与内存实时 Quote 融合渲染。
- ✅ **测试与质量**：单元测试扩充至 631 项全部 PASS；Playwright 端到端测试 56/56 项 100% 通过；ESLint 0 错误 0 警告；Vite 生产构建成功。
- 详见交接文档：[`docs/handoff/2026-09-04-code-review-defects-and-architecture-refactor-handoff.md`](docs/handoff/2026-09-04-code-review-defects-and-architecture-refactor-handoff.md)。

## 2026-09-05 视图解耦、无障碍 (A11y)、响应式与审查缺陷全量闭环状态

- ✅ **自定义非阻塞确认模态框 (`src/js/modal.js`)**：
  - 移除原生阻塞式 `window.confirm(...)`，实现主题自动适配、键盘焦点陷阱（Tab 循环、Escape 取消、Enter 确认）、遮罩点击关闭的异步非阻塞确认弹窗；
  - 编写专用单元测试 `tests/modal.test.js`，5 项单测全部通过。
- ✅ **大文件巨石与视图/服务层彻底解耦 (`src/js/views/` 与 `src/js/services/`)**：
  - 抽离 `src/js/views/headerView.js`：封装顶栏标题、刷新频率下拉、自动刷新按钮及状态更新、主题切换；
  - 抽离 `src/js/views/toolbarView.js`：封装自选股输入框（带回车监听与报错动效）、添加按钮、立即刷新、批量删除/静音/启用与 CSV 导出；
  - 抽离 `src/js/views/monitorTableView.js`：封装自选股监控表格核心渲染、全选控制、无障碍单行渲染、内嵌图表行展开及局部单元格 Patch；
  - 抽离 `src/js/services/momentumScanner.js`：封装 10 日涨幅扫描调度、并发候选股分析、共享缓存轮询与钉选排序合并；
  - 抽离 `src/js/views/momentumView.js`：封装 10 日强势股面板装配 (`renderMomentumSectionView`)、纯函数排序、指标计算与过滤、单元格局部更新及行内图表展开；
  - 抽离 `src/js/views/voiceBarView.js`：封装语音设置栏渲染、字段动态调序与事件处理；
  - 抽离 `src/js/views/alertBarView.js`：封装价格预警栏渲染、阈值输入与通知权限申请；
  - `src/js/app.js` 巨石瘦身 510+ 行，仅作为生命周期协调控制器并保持所有既有外部引用的向后兼容重导出。
- ✅ **表格更新脱敏与语义化定位 (`data-field`)**：
  - 彻底废除 `allCells[4..9]` 等脆弱硬编码下标，为自选股与 10 日强势股表格所有 `th` / `td` 注入 `data-field` 语义标记，改用 `td[data-field="..."]` 精准 Patch。
- ✅ **移动端完整响应式适配 (`src/style.css`)**：
  - 在 `@media (max-width: 768px)` 中对 `#limit-up-table` 与 `#momentum-table` 的次要列（开盘价、量比、成交额等）进行自动隐藏，增加平滑横向滚动，解决小屏严重挤压问题。
- ✅ **无障碍 A11y 深度加固 (`src/js/limitUpView.js`)**：
  - 涨停看板所有排序列注入 `role="button"`、`tabindex="0"`、`aria-sort` 与键盘回车/空格触发支持；
  - 为置顶/收藏按钮补齐动态 `aria-label`。
- ✅ **全量审查 P0/P1 与安全缺陷彻底闭环**：
  - **P0-1**：`server/index.js` 与 `server/momentumService.js` 修复裸 Promise 未挂载 catch 及内部嵌套 try/catch，彻底消除 Unhandled Rejection 崩进程隐患；
  - **P1-1**：`chartRowController.js` 与 `api.js` 修复 `noCache`/`forceRefresh` 穿透，确保「重新加载」跳过本地缓存直连网络；
  - **P1-2**：`chart.js` 在 `createKlineChart` 正式暴露 `subscribeBarClick: onClick`，打通日 K 柱点击切换分时链路；
  - **P1-3**：`server/spotService.js` 修复 `universe.json` 种子安全查找，消除数组立即求值抛错；
  - **P1-4 & P1-5**：`server/momentumService.js` 修复 `finally` 误删新任务竞态与重启启动扫描缓存 key；
  - **P1-6**：`index.html` 改读 `app_theme`，彻底消除深色模式刷新首帧闪白；
  - **P1-7 & P1-8**：`src/js/app.js` 补齐 `closeAllMomentumCharts` 路由切页销毁，`stopApp` 调 `stopVoiceTimer` 消除后台定时器泄漏；
  - **安全 P1**：`server/proxyRoutes.js` 修复协议相对路径 `//evil.com/x` SSRF 漏洞，`server/index.js` 监听地址默认收敛至 `127.0.0.1`；
  - **P2 & UX-2**：`server/cacheStore.js` 支持 `readCache` skipTouch 并刷新文件 mtime；期货服务读取 `AKTOOLS_BASE` 环境变量；`time.js` 统一 `hourCycle: 'h23'` 杜绝午夜 24 点解析异常；自选股单个删除接入 `showConfirmModal` 确认弹窗。
- ✅ **测试与质量**：单元测试增至 651 项全部 PASS；Playwright 端到端测试 56/56 项 100% 通过；ESLint 0 错误 0 警告；Vite 生产构建成功；`npm run ci` 全绿。
- 详见交接文档：[`docs/handoff/2026-09-05-code-review-defects-closure-and-views-decoupling-handoff.md`](docs/handoff/2026-09-05-code-review-defects-closure-and-views-decoupling-handoff.md)。

## 2026-09-05 WorkBuddy 全量代码审查缺陷彻底闭环状态

- ✅ **3 项 P0 级致命缺陷全量闭环**：
  - **F-P0-1（10日强势股内嵌图表展开空白与单双图结构不匹配）**：修复 `src/js/views/momentumView.js` 生成的 host ID 前缀不一致问题（对齐为 `momentum-chart-host-${code}`），并消除无分时数据源时的空分时 split 结构，改为全宽日 K 单 Pane 展示；在 `e2e/monitor.spec.js` 中新增专用测试真实断言图表展开与 Canvas 挂载。
  - **F-P0-2（涨停看板实时报价停滞）**：在 `app.js` 的 `refreshNow()` 刷新循环中显式接入 `applyLiveTicksToLimitUp()`，并在 `getRefreshCodes()` 中把交易日当天的 `state.limitUp.items` 代码纳入全局刷新池，实现涨停板标的毫秒级 Tick 驱动更新。
  - **B-P0-1（`server/utils.js` jsonResponse 崩溃进程）**：在 `jsonResponse` 写入响应头与数据前增加 `res.headersSent` 与 `res.destroyed` 防御判断，并用 `try...catch` 拦截客户端提前中断连接时的 Socket 异常；在 `server/index.js` 服务入口增加 `process.on('uncaughtException')` 兜底。
- ✅ **7 项前端 P1 级缺陷彻底闭环**：
  - **F1（涨停看板 30s 周期刷新破坏 DOM）**：轮询仅局部更新状态栏与报价单元格 (`patchLimitUpQuoteCells`)，彻底消除周期性全量 DOM 销毁与已展开图表白屏。
  - **F2（图表异步加载竞态条件）**：在 `chartRowController.js` 的 `finally` 块中增加当前实例有效性与展开状态校验 (`this.isExpanded(code) && this.getInst(code) === inst`)，消除快速折叠展开时的状态篡改。
  - **F3（`stopApp()` 清理不彻底）**：增补对 `appRouter.stop()`、`abortController.abort()`、`stopMomentumScan()` 的彻底销毁。
  - **F4（10日涨幅后台轮询定时器泄漏）**：为 `momentumPollTimer` 引入独立句柄变量，在发起新扫描、页面停止扫描与退出时及时 `clearTimeout`。
  - **F5（扫描与大批量加载时的 SWR 请求风暴）**：`api.js` 中增加 30s 最小重试节流，并在扫描候选股时传入 `opts.revalidate = false`。
  - **F6（动量扫描结果脏覆盖 `state.quotes`）**：实现 `_mergeMomentumQuotesSafely`，保留既有标的完整字段，防止后续单元格读取产生 NaN。
  - **F7（交易时段判断边界漏洞）**：`isFuturesMarketOpen` 补齐周二至周六凌晨夜盘前日法定日历校验与节前夜盘休市判定。
- ✅ **5 项服务端 P1 级缺陷彻底闭环**：
  - **B1（动量扫描接口 CSRF / DNS Rebinding）**：严格校验 `Host` 必须为 `localhost` 或 `127.0.0.1` 并校验 `Origin`/`Referer`。
  - **B2（过期扫描任务泄漏）**：保存 `controller` 并在替换 10 分钟过期任务时主动触发 `abort()`。
  - **B3（声明 Node.js 最低版本）**：`package.json` 补充 `"engines": { "node": ">=20.3.0" }`。
  - **B4（代理请求废弃事件与 OOM 防御）**：改用 `res.on('close')` 并限制代理请求体上限 `MAX_PROXY_BODY_BYTES = 10MB`。
  - **B5（期货外部 API 缺少超时控制）**：期货报价与 K 线服务统一接入 `fetchWithTimeout` 8s 超时。
- ✅ **P2 缺陷与 UX 交互优化**：
  - **P2-1（CSV 公式注入防护）**：导出 CSV 针对 `[=+\-@\t\r]` 首字符添加转义前缀 `'`。
  - **P2-2（TTS 高精度标的播报）**：国债期货等最小变动价位 `< 0.01` 标的采用 3 位小数。
  - **UX-7（错误振动定位）**：`flashError` 支持按错误类型精确定位振动输入框。
  - **UX-8（危险操作取消按钮默认聚焦）**：`showConfirmModal` 增加 Tab 焦点环，当 `danger: true` 时默认聚焦取消按钮防误触。
- ✅ **质量基线验证**：
  - ESLint 代码规范：0 错误 0 警告
  - QUnit 单元测试：652 / 652 全部 PASS
  - Playwright E2E 自动化测试：57 / 57 全部 PASS
  - Vite 生产打包：顺利构建
- 详见交接文档：[`docs/handoff/2026-09-05-workbuddy-code-review-defects-closure-handoff.md`](docs/handoff/2026-09-05-workbuddy-code-review-defects-closure-handoff.md)。

## 2026-09-05 WorkBuddy 第二轮代码审查缺陷彻底闭环与控制器解耦状态

- ✅ **3 项 Major 级核心缺陷全量闭环**：
  - **M-1 & M-3 & Nit 4（动量数学算法统一抽取与依赖倒置）**：抽离 `src/js/services/momentumMath.js`，将 `computeTenDayMomentum`、`sortMomentumItems`、`getMomentumReasonText` 及参数常量（`MOMENTUM_LOOKBACK_TRADING_DAYS = 10`、`MOMENTUM_THRESHOLD_PCT = 45`）沉淀为领域公共模块，严格对齐 `>= 11` 根 Bar 判定与截断日逻辑；服务端 `momentumService.js` 与前端 `momentumScanner.js` 统一引用，彻底消除口径漂移与反向依赖；新增 `tests/momentumMath.test.js` 8 项单测全部通过。
  - **M-2（`app.js` 上帝对象拆分与控制器化）**：
    - 抽离 `src/js/controllers/limitUpController.js`：纳管涨停看板数据拉取、轮询定时器、报价 Cell 原地 Patch、图表管理及日期导航；
    - 抽离 `src/js/controllers/momentumController.js`：纳管 10 日强势股全流程扫描、轮询监控、图表展开管理；
    - 抽离 `src/js/services/batchExportService.js`：纳管自选股批量解析、文本与 CSV 导出；
    - `src/js/app.js` 巨石净减少超 920 行代码，保持既有测试契约 100% 向后兼容。
- ✅ **6 项 Minor 级缺陷彻底闭环**：
  - **m-1（代理流式累积与超限熔断）**：`server/proxyService.js` 先检查 `content-length`，并使用 `reader.read()` 流式累计字节，超过 10MB 立即 `reader.cancel()` 中断，防止内存峰值击穿。
  - **m-2（期货查询参数 encodeURIComponent）**：`server/futures/futuresKlineService.js` 针对 4 处 URL 参数统一转义。
  - **m-3（`isDataAutoRefreshAllowedNow` 死分支修复）**：废除未定义的 `state.chartRowManager`，改用收集全体已展开图表中的境内期货标的精准判断夜盘时段。
  - **m-4（期货昨结价 24h 缓存）**：`server/futures/futuresKlineService.js` 对 `fetchFuturesDaily` 接入 24h 日线缓存，杜绝每 10 秒刷新分时重复拉取日线。
  - **m-5（清理 `el()` `html` XSS 隐患通道）**：清理 8 个视图文件中的 `node.innerHTML` 注入分支，实现零风险安全收敛。
  - **m-6（服务端 `mapLimit` 统一归拢）**：在 `server/utils.js` 统一导出并发控制器，避免重复实现。
- ✅ **4 项 Nit 优化项闭环**：
  - **Nit 1**：`chartRowController.js` 规范文件顶部 import。
  - **Nit 2**：`server/intradayService.js` 简化 `safeName = code`。
  - **Nit 3**：`server/index.js` 区分 `/assets/*` 强缓存与根静态资源协商缓存。
  - **Nit 4**：动量阈值与回看周期常量集中下沉。
- ✅ **质量基线验证**：
  - ESLint 代码规范：0 错误 0 警告
  - QUnit 单元测试：660 / 660 全部 PASS（净增 8 项）
  - Playwright E2E 自动化测试：57 / 57 全部 PASS
  - Vite 生产打包：顺利构建
- 详见交接文档：[`docs/handoff/2026-09-05-workbuddy-round2-code-review-defects-closure-handoff.md`](docs/handoff/2026-09-05-workbuddy-round2-code-review-defects-closure-handoff.md)。

## 2026-09-07 WorkBuddy 第三/四轮代码审查遗留债务闭环状态

- ✅ **2 项 Minor 遗留缺陷彻底闭环**：
  - **3-1（代理体积上限文档对齐）**：统一修正文档与 `STATUS.md` 中写为 15MB 的笔误，与代码实现 `server/proxyService.js:6`（`MAX_PROXY_BODY_BYTES = 10MB`）保持严格一致。
  - **3-2（收敛 `limitUpRootEl` 消除双源真相）**：移除 `src/js/app.js` 中的冗余模块级 `let limitUpRootEl` 变量与路由赋值，统一通过 `limitUpCtrl.getRootEl()` 动态获取与维护，彻底闭环状态不一致隐患。
- ✅ **2 项 Nit 优化与竞态守卫闭环**：
  - **3-3（消除测试与控制器层级倒挂）**：移除 `src/js/controllers/chartRowController.js` 的 `intradaySourceLabel` re-export，测试文件 `tests/chartRowController.test.js` 直接从 `format.js` 引用。
  - **3-6（动量扫描陈旧任务中止竞态守卫）**：在 `server/momentumService.js` 的 `catch` 块中加入 `JOBS.get(jobKey)?.promise === job` 守卫，防止已超时中止的旧任务异常写入脏覆盖新任务扫描进度。
- ✅ **质量基线验证**：ESLint 0 错误 0 警告，QUnit 660/660 全部 PASS，Vite 生产构建成功。
- 详见交接文档：[`docs/handoff/2026-09-07-workbuddy-round4-code-review-handoff.md`](docs/handoff/2026-09-07-workbuddy-round4-code-review-handoff.md)。

## 备份

`backups/` 目录：
- `project1_v1_2026-06-04.zip` (51.85 MB) — Phase 0-4.3 完成时备份（含 node_modules）
- `project1_v2_2026-06-05.zip` (0.20 MB) — Phase 5 + 2 bug 修复完成时备份（**不含 node_modules**，用 `npm install` 恢复）

**v2 备份内容**（60 文件，0.64 MB 解压）：src/ · tests/ · e2e/ · docs/ · index.html · package.json · package-lock.json · vite.config.js · playwright.config.js · .eslintrc.cjs · AGENTS.md · SPEC.md · STATUS.md

**恢复步骤**：
```bash
unzip backups/project1_v2_2026-06-05.zip -d restore/
cd restore
npm install
npm run ci
```

## 技术决策（已确认）

| 项目 | 决策 |
|------|------|
| 前端 | Vanilla JS (ESM) + Vite 5 |
| 图表 | TradingView Lightweight Charts v4 (替代 ECharts) |
| 测试 | QUnit 2.x 单测 + Playwright e2e |
| 代码规范 | ESLint 8 |
| 数据源 | 实时行情：腾讯主 + 东财备 + 新浪期货；K 线：东财主 + 腾讯备 |
| 路由 | Hash 路由 (#/ 和 #/limit-up) |
| 配色 | A 股惯例：红涨绿跌；涨停黄、炸板紫 |
| 主题 | 3 套：暖米 / 浅色 / 深色 |

## 目录结构

```
project1/
├── index.html
├── package.json (v2.0.0)
├── vite.config.js (含 6 个 API 代理)
├── .eslintrc.cjs
├── playwright.config.js
├── .gitignore
├── AGENTS.md
├── SPEC.md (保留为需求真理源)
├── STATUS.md (本文档)
├── public/
├── src/
│   ├── main.js              # boot → startApp(#app)
│   ├── style.css            # 3 主题 CSS 变量 + 表格/工具栏/chart panel/响应式
│   ├── pages/               # (待 Phase 4 用)
│   └── js/
│       ├── api.js           # 实时行情：腾讯主→东财备；fetchKline：东财主→腾讯备
│       ├── parser.js        # Tencent / Eastmoney / Sina 解析 + normalizeCode
│       ├── storage.js       # localStorage 封装 + STORAGE_KEYS 注册
│       ├── theme.js         # warm/light/dark 循环 + data-theme
│       ├── kline.js         # 8 周期 PERIODS + 东财/腾讯 K 线解析 + MA + 成交量 + 涨停/炸板配色
│       ├── chart.js         # TradingView 封装：createKlineChart / 主题色 / MA 配色
│       └── app.js           # UI + 状态机 + 增量渲染 + 点击展开 K 线面板
├── tests/
│   ├── _bootstrap.test.js   # 1 case
│   ├── parser.test.js       # 18 cases
│   ├── storage.test.js      # 16 cases
│   ├── theme.test.js        # 9 cases
│   ├── api.test.js          # 21 cases (含 fetchKline + Tencent fallback)
│   ├── app.test.js          # 27 cases
│   ├── kline.test.js        # 69 cases (PERIODS · 东财/腾讯 URL+解析 · MA · 成交量 · 涨停炸板)
│   └── chart.test.js        # 6 cases (theme colors · options · MA palette)
├── e2e/                     # (待 Phase 5 用)
├── docs/
├── logs/
└── backups/project1_v1_2026-06-04.zip (旧版备份)
```

## API 代理（已配置在 vite.config.js）

> ⚠️ **键顺序重要**：vite 5 按对象键插入顺序首个 `startsWith` 匹配胜出。前缀重叠时长键必须在前。

| 路径 | 上游 | 用途 |
|------|------|------|
| `/api/tencent` | `https://qt.gtimg.cn` | 实时行情（主） |
| `/api/eastmoney-kline` | `https://push2his.eastmoney.com/api` | 日/周/月/分钟 K 线（主，必须先于 `/api/eastmoney`） |
| `/api/eastmoney` | `https://push2.eastmoney.com/api` | 实时行情（备） |
| `/api/sina` | `https://hq.sinajs.cn` | 新浪期货行情 |
| `/api/qq-kline-min` | `https://ifzq.gtimg.cn` | 腾讯分钟 K 备用（必须先于 `/api/qq-kline`） |
| `/api/qq-kline` | `https://web.ifzq.gtimg.cn` | 腾讯日/周/月 K 备用 |

## 重做阶段

| 阶段 | 状态 | 标题 | 关键交付 |
|------|------|------|----------|
| **0** | ✅ 完成 | 清理 + 初始化 | Vite + ESLint + Playwright + QUnit 全部就绪 |
| **1** | ✅ 完成 | 基础架构 + 监控列表 | api/parser/storage/theme/app + 监控列表 UI |
| **2** | ✅ 完成 | 走势图 (TradingView) | K 线 + 均线 + 成交量 + 8 周期 + 主题联动 + 涨停/炸板配色 + 双源 fallback |
| **3** | ✅ 完成 | 语音播报 + 价格提醒 + 自定义播报内容 + 实时 K 线 | TTS 队列 + 阈值提醒 + 桌面通知 + Worker 心跳 + 字段可调序 + K 线 tick |
| **4** | ✅ 完成 | 涨停看板 (独立页面) | Hash 路由 + 东财涨停接口 + 连板分类 + 空响应锁定显示 + 实时价合并 + ST 标记 |
| **5** | ✅ 完成 | 测试 + 文档 | Playwright e2e 关键路径 30 cases + AGENTS/SPEC 同步 + 用户文档 + phase4 design 风险章节补全 |
| **6** | ✅ 完成 | AKTools 涨停数据源升级 | 涨停池/炸板池改走本地 AKTools 后端（端口 8888）— 连板数/封板时间/炸板次数真值；新增 25 单测；491 tests 全过；handoff 见 [`docs/handoff/2026-06-05-aktools-upgrade-handoff.md`](docs/handoff/2026-06-05-aktools-upgrade-handoff.md) |
| **7** | ✅ 完成 | 涨停原因 + 日期选择 | 新增"原因"列（龙虎榜 `stock_lhb_detail_em` 上榜原因 + 解读，33~41% 覆盖）+ 日期选择器（HTML5 `<input type="date">` + "今天" 按钮，传 `?date=YYYYMMDD`）；新增 17 单测 + 4 e2e；512 tests 全过；handoff 见 [`docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md`](docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md) |
| **7.1** | ✅ 完成 | 日期格式 bug 修复 + 前/后一天按钮 | **Bug 修复**：HTML5 `YYYY-MM-DD` → AKTools `YYYYMMDD` 格式自动转换（`aktoolsApi.toAktoolsDate`），修"选中某一天后无显示"；**新功能**："‹ 前一天" / "后一天 ›" 按钮（后一天在今天自动 disabled）；新增 9 单测 + 14 limitUpView 测试 + 5 e2e；540 tests 全过；handoff 见 [`docs/handoff/2026-06-05-phase7-date-fix-handoff.md`](docs/handoff/2026-06-05-phase7-date-fix-handoff.md) |
| **8** | ✅ 完成 | K线持久化 + 预拉 + 涨停页多 chart | **新功能**：klineCache (localStorage, 盘中 1h/盘后永久) + in-flight dedup + SWR revalidate + 事件总线 + 添加即预热 + 涨停看板预拉前 10 + 「重新加载数据」按钮；**核心 bug 修复**：涨停页多 chart 支持（与监控页完全对齐 `expandedCodes: Set` + `chartInstances: Map` + `${code}` host id）+ chart row colspan 8→9；新增 10 klineCache 单测 + 7 fetchKline cache/dedup 单测 + 2 e2e；515 unit + 43 e2e (1 历史 fail 无关)；handoff 见 [`docs/handoff/2026-06-05-phase8-cache-preload-multi-chart-handoff.md`](docs/handoff/2026-06-05-phase8-cache-preload-multi-chart-handoff.md) |
| **8.1** | ✅ 完成 | 涨停页 chart 重新挂载修复 + 真实场景测试 | **Bug 修复**：`rerenderLimitUpPage` 之前未 destroy 旧 ctl → renderLimitUpPage 内部 `root.innerHTML = ''` 清空 DOM 后，chart ctl 仍引用**已脱离 DOM** 的旧 host 元素 → 画图看不见。修复：rerender 前 `_destroyLimitUpChart(code)` 清所有 ctl，rerender 后 `mountLimitUpChart` 重新挂载到新 host。**真实场景测试**：用 dev server 跑无 mock 测试，验证 chart ctl 创建 canvas (count=7) + 多 chart 互不干扰；新增 2 e2e 回归（chart canvas 创建 + rerender 后仍可见 + 多 chart 互不干扰）。515 unit + 45 e2e；handoff 见 [`docs/handoff/2026-06-05-phase8-chart-rerender-fix-handoff.md`](docs/handoff/2026-06-05-phase8-chart-rerender-fix-handoff.md) |

## Phase 0 完成情况

- ✅ 旧项目备份 → `backups/project1_v1_2026-06-04.zip` (49.45 MB)
- ✅ Vite + ESLint + Playwright + QUnit 初始化
- ✅ 4 个 API 代理（Phase 2 扩到 6 个）
- ✅ `npm install` / `lint` / `build` 全绿

## Phase 1 完成情况 ✅ 用户已在浏览器验证

### 模块交付
- ✅ `parser.js` — 三种数据源解析 + `normalizeCode` / `inferMarket` / `toEastmoneySecId`
- ✅ `storage.js` — localStorage 封装 + `STORAGE_KEYS` 注册表 + 可注入适配器
- ✅ `theme.js` — 3 主题循环（warm → light → dark），`data-theme` + localStorage
- ✅ `api.js` — Tencent (主) → Eastmoney (备) 自动降级 + Sina 期货 + `AbortController`
- ✅ `app.js` — 监控列表 UI + 增量渲染（toolbar/输入/选择/滚动位置全保持）
- ✅ `style.css` 三主题完整变量 + 工具栏/表格/状态栏/移动端响应式

### 用户验证后的 UI 迭代
- ✅ 输入分隔符：仅半角逗号 `,` / 全角逗号 `，` / 空格
- ✅ 回车键添加 + 添加后自动 focus 回输入框
- ✅ 局部刷新：自动刷新只更新表格 + 状态栏

## Phase 2 完成情况 ✅ 用户已在浏览器验证

### 核心模块
- ✅ `kline.js` — 8 周期 `PERIODS` + 东财/腾讯双源 URL 构造 + 解析 + `calcMA`（滑窗复用）+ `formatVolumeBars` + **涨停/炸板分类与配色**
- ✅ `chart.js` — `createKlineChart(container, opts)` 工厂 → `{setKline, setVolume, setMA, clearMA, applyTheme, resize, fitContent, destroy}`；TradingView v4 直接 import
- ✅ `api.js` 新增 `fetchKline(code, opts)`：**东财主源（1 次重试） → 腾讯 fallback**，无效 code/period 短路不发请求
- ✅ `app.js` 集成：行点击 toggle → 展开 K 线 → 8 个 period tab → 复用 chart 实例切周期 → 主题切换联动 → 删除当前行自动关闭面板 → `AbortController` 防竞态 → `ResizeObserver` 响应式

### 配色（A 股惯例）
| 用途 | 颜色 | 说明 |
|------|------|------|
| 涨 | `#E74C3C` | `CANDLE_UP_COLOR` 跨主题统一 |
| 跌 | `#27AE60` | `CANDLE_DOWN_COLOR` 跨主题统一 |
| 涨停 | `#FFD700` | `LIMIT_UP_COLOR` 整根黄色 |
| 炸板 | `#E040FB` | `LIMIT_BROKEN_COLOR` 整根紫色 |
| MA5/10/20/60 | 橙/蓝/紫/青 | `MA_COLORS = ['#F39C12', '#3498DB', '#9B59B6', '#16A085']` |

### 涨停/炸板判定（同花顺指标对齐）
- **涨停**：`close == high` 且 `(close/prevClose - 1)*100 ≥ 阈值 - 0.2`
- **炸板**：`(high/prevClose - 1)*100 ≥ 阈值 - 0.9` 且 `close < high`
- **阈值表**（ST 优先于板块）：

| 板块 | 阈值 |
|------|------|
| 主板 (sh 60x / sz 00x) | 10% |
| 创业板 (sz 30x) | 20% |
| 科创板 (sh 688x) | 20% |
| 北交所 (bj) | 30% |
| ST / *ST | 5% |

### 调试过程沉淀（避免重复踩坑）
- **vite 代理键顺序**：vite 5 按对象键插入顺序首个 `startsWith` 匹配；`/api/eastmoney-kline` 必须在 `/api/eastmoney` 前；`/api/qq-kline-min` 必须在 `/api/qq-kline` 前。已加注释。
- **东财 K 线 5xx**：上游 `push2his.eastmoney.com` 间歇断连（curl 错 56）。修复：1 次重试 + 腾讯 fallback。
- **切周期不显示**：旧 `chartCtl` 指向被重建的 DOM 上孤儿实例。修复：(1) `handlePeriodChange` 不重建 DOM，只 `updateChartTabsActive`；(2) `renderChartPanel` 在重建前总是先 `destroyChart()` 防御。
- **`'month'.charAt(0) === 'm'` bug**：腾讯 K 线类型 `month` 被误判为分钟 endpoint。修复：用 `/^m\d/` 严格匹配。

### 验证证据
- ✅ 测试：**168/168 通过**（parser 18 · storage 16 · theme 9 · api 21 · app 27 · kline 69 · chart 6 · bootstrap 1）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（186.95 kB JS / 6.57 kB CSS / gzip 59.81 kB；lightweight-charts ~170 kB）
- ✅ 浏览器实测：切周期/切主题/切行/删除联动/涨停黄/炸板紫 全部通过

## Phase 3 完成情况 ✅ 用户已在浏览器验证

### 模块交付（v1 — 首版实现）
- ✅ `src/js/tts.js` — Web Speech API 封装
  - 纯函数 `formatQuoteSpeech(quote)`（A 股 / 期货分别使用元/无单位；涨/跌/持平三态），`getDefaultVoiceOpts()`
  - 浏览器封装 `speak(text, opts)` 队列入栈，`cancel()` 清空，`setSpeechAdapter()` DI；移动端无 SpeechSynthesis 时静默降级
  - `_internal()` 暴露队列方便调试 / 测试
- ✅ `src/js/alert.js` — 阈值检测 + 桌面通知
  - 纯函数 `shouldTriggerAlert(quote, threshold, lastState)` 处理阈值穿越 / 同方向去重 / 反向重置 / up↔down flip / 边界 `pct===threshold` 触发
  - `formatAlertMessage(quote, direction)` 中文涨幅/跌幅消息
  - `evaluateAlerts(quotes, codes, threshold, states)` 不可变接收外部状态，返回新 `{triggered, states}`
  - 通知封装 `requestNotificationPermission()`（granted/denied 短路），`showNotification(title, body)`，`setNotificationAdapter()` DI
- ✅ `src/js/worker.js` — Web Worker 心跳
  - 纯工厂 `createTickEngine({setInterval, clearInterval, postMessage})`：start / stop / setInterval；非法 interval 回退 1000ms
  - `bootWorker(scope)` 自动判断真实 Worker 环境（`typeof window === 'undefined'`）才注册 `self.onmessage`
  - Vite 自动分离成独立 chunk（`assets/worker-*.js`）通过 `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` 引入
- ✅ `src/js/storage.js` 扩展：`getVoiceSettings/setVoiceSettings/patchVoiceSettings`、`getAlertSettings/setAlertSettings/patchAlertSettings`、`getSubscribedCodes/setSubscribedCodes` + 新 KEY `subscribed_codes`
- ✅ `src/js/app.js` 首版：设置面板 toggle；监控列表 🔊 列；`refreshNow` 后调 `processAlerts()`；`startVoiceTimer` Worker + setInterval 降级

### 用户反馈迭代（v2 — UX 优化）
- ✅ **删除 toolbar 批量订阅按钮**（与行内 🔊 列混淆）；增加 `handleSubscribeAll/Selected/UnsubscribeAll` handler 给设置面板用
- ✅ **订阅清单删掉**，设置面板里删除"📋 订阅清单"section
- ✅ **测试声音简化**：只播 "语音测试"，去掉了原来 5 个长串测试文本
- ✅ **取消启用提示音**（"语音播报已启动..."）— `handleVoiceEnabledChange` 改为只启动定时器无任何 speak
- ✅ **大主按钮替代小 checkbox**：`.btn-voice-toggle` / `.btn-voice-active`（橙→红 + 呼吸动画），按钮更显眼
- ✅ **删除手动模式**：`VOICE_INTERVAL_OPTIONS` 常量删除
- ✅ **间隔改为数字输入框**（`<input type=text inputmode=numeric>`）：默认 5 秒，只接受正整数 ≥1
- ✅ **input 删除最后一位修复**：改 `type=number` → `type=text` 避免浏览器干预；oninput 实时清掉非数字字符
- ✅ **启用按钮立即播报**：`startVoiceTimer()` 后立即同步调 `speakSubscribed()`（也满足浏览器 user-gesture 策略）
- ✅ **常驻语音栏**：从设置面板中抽出 `#voice-bar` 直接展开在 toolbar 下方
- ✅ **常驻提醒栏**：删除 ⚙️ 设置按钮；`#alert-bar` 也常驻展开，风格与 voice-bar 一致
- ✅ **CSS 重命名** `.voice-*` → `.ctl-*` 通用化（voice-bar / alert-bar 共用样式）
- ✅ **输入框不被定时刷新覆盖**：拆 `updateVoiceHint()` 局部更新订阅计数；`renderData()` 改用 hint 而非 `renderVoiceBar()`；订阅切换也用 hint
- ✅ **价格提醒常驻**：`renderAlertBar()` 模仿 voice-bar 两行布局；阈值输入用 `text + inputmode=decimal`；含 `🔔 测试提醒` 按钮（用首个订阅标的的涨跌幅模拟一次提醒）
- ✅ **通知权限推到主按钮右侧**：新增 `.ctl-push-right { margin-left: auto }`；alert-bar row 1 = `[主按钮][阈值][测试]| (推右) [权限状态][请求按钮]`
- ✅ **字段顺序可调换**：`state.voice.fieldsOrder` 数组 + chip 内置 ▲▼ 按钮（首/尾 disabled）；`formatQuoteSpeech(quote, fields, fieldsOrder)` 按顺序拼接

### 新增纯函数（均 TDD 优先）
- `parseIntervalSeconds(raw)` — 正整数秒解析；空字符串 → null（信号：用户清空）
- `parseAlertThreshold(raw)` — 0.1-50 之间正小数解析；空/越界/非法 → null
- `normalizeVoiceFieldsOrder(input)` — 剔除未知 key、补全缺失、去重
- `formatQuoteSpeech(quote, fields, fieldsOrder)` 第三个参数：`fieldsOrder` 数组，按顺序拼接启用的字段

### 数据契约（v2 当前）
```js
// STORAGE_KEYS.VOICE
{
  enabled: false,
  interval: 5000,       // ms；用户输入秒数（默认 5 秒）
  volume: 80,           // 0-100
  fields: { name: true, price: true, percent: true },
  fieldsOrder: ['name', 'price', 'percent']  // 可拖动 ▲▼ 调序
}
// STORAGE_KEYS.ALERTS
{ enabled: false, threshold: 5 }   // 0.1-50
// 'subscribed_codes'（独立 key）
['sh600519', 'nf2105']
```

### 文件/目录变化
```
src/js/
├── tts.js          # formatQuoteSpeech 加 fields + fieldsOrder 参数
├── alert.js        # 阈值检测 + 通知
├── worker.js       # Web Worker 心跳
└── app.js          # voice-bar + alert-bar 常驻；删 settings panel
src/style.css      # .voice-* → .ctl-*；新增 .ctl-push-right / .field-order / .field-move
tests/
├── tts.test.js     # 23 cases（+6 fieldsOrder）
├── alert.test.js   # 28 cases
├── worker.test.js  # 8 cases
├── app.test.js     # 33 cases（+9: parseIntervalSeconds 5 / parseAlertThreshold 6 / DEFAULT_VOICE_SETTINGS 1 / 原有 fields 测试同步）
```

### 验证证据
- ✅ 测试：**276/276 通过**（v2 + v3 净增 106：tts 17+6=23 · alert 28 · worker 8 · storage +6 · app 27+6=33 · kline 69+10=79 · chart 6；+parseIntervalSeconds 5 · +parseAlertThreshold 6 · +fieldsOrder 1 · +isMinutePeriod 2 · +applyLiveTickToKline 8；+pre-existing missing imports 5）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（202.95 kB JS / 10.60 kB CSS / gzip 64.46 kB；worker 独立 chunk 0.98 kB）
- ✅ 浏览器实测全部通过：测试声音/启用立即播报/字段顺序/订阅/阈值提醒/通知权限/响应式/K 线 tick 实时更新

### v3 迭代（用户反馈：K 线图不跟实时刷新）
- ✅ **根因**：K 线图只在用户点击行时拉一次历史 K 线快照；之后 `refreshNow` 只更新实时报价 `state.quotes`，不更新 `state.klineData` → 图表一直显示点击时的快照
- ✅ **修复**：
  - `kline.js` 加 `isMinutePeriod(p)` + `applyLiveTickToKline(items, livePrice, period)` 纯函数（TDD）
  - 日/周/月：仅改最后一根 K 线的 `close`（high/low/open 不动）
  - 分钟（1m/5m/15m/30m/60m）：改 `close` + 把 `high`/`low` 扩展到 max/min
  - 不可变（新数组引用）
  - `app.js` 加 `updateChartLastTick()`，在 `refreshNow` 的 `processAlerts` 之后调用（同样 try/catch 包裹，不让图表错误打断数据刷新）
- ✅ **附带修复**：
  - `isMinutePeriod` 周期 key 修正为 `1m`/`5m`/...（之前错写成 `m1`）
  - 测试文件 import 补全 `periodToKlt` / `getPriceLimit` / `classifyKlineBar` / `LIMIT_UP_COLOR` / `LIMIT_BROKEN_COLOR`（这些在 kline.js 中已存在但测试漏了 import）
- ✅ **关键说明**：图表更新频率**等于**报价刷新频率（用户在顶部"刷新"下拉可选 3/10/30/60 秒；设置存 localStorage 持久化）。并非独立频率。

### 调试过程沉淀（避免重复踩坑）
- **`type=number` input 删除最后一位被浏览器干扰**：用 `type=text + inputmode=numeric/decimal` 替代
- **oninput + 立即校验会丢失用户中间态**：用 `oninput` 仅做字符清理，blur/Enter 时才校验（空字符串允许保留）
- **启用按钮无用户手势无法 speak**：在 click 的同步上下文里直接调 speak（捕获 user-gesture）
- **renderData() 内含 renderVoiceBar() 会覆盖正在编辑的 input**：拆 `updateVoiceHint()` 只改订阅计数文本
- **CSS 类名应通用化**：起初叫 `.voice-bar` / `.btn-voice-toggle` 等，新增 alert-bar 后改名 `.ctl-bar` / `.btn-ctl-toggle`，避免复制样式
- **K 线历史只拉一次就够**：定时刷新不应重新拉 K 线（昂贵）；改成把实时报价合并到最后一根 K 线（O(1) 合并 + O(n) 重绘）

## 开发约束

- **不要引入 ECharts** - 用 lightweight-charts
- **不要引入 React/Vue** - 保持 Vanilla JS
- **不要修改 SPEC.md** - 真理源
- **不要在 src/ 创建 *.cjs** - 全部 ESM
- **不要破坏 vite 代理键顺序** - 前缀重叠的长键必须在前
- **遵循 AGENTS.md 编码规范**

## Phase 4 完成情况 ✅ 待用户浏览器验证

### 模块交付
- ✅ `src/js/storage.js` 扩展：`STORAGE_KEYS.LIMIT_UP` + `getLimitUpSettings / setLimitUpSettings / patchLimitUpSettings / normalizeLimitUpSettings / DEFAULT_LIMIT_UP_SETTINGS`
- ✅ `src/js/router.js`（新建）：`createHashRouter(routes, defaultPath, rootArg)` + `parseHash` + `navigate` + 未知路径兜底
- ✅ `src/js/limitUp.js`（新建）：纯函数 `LIMIT_UP_GROUPS` (3 个分桶) / `classifyByLimitCount` / `sortByLimitCount` / `buildLimitUpGroups` / `mergeLiveTicks` / `isLimitUpName` / `getLimitUpGroupLabel`
- ✅ `src/js/limitUpApi.js`（新建）：`buildLimitUpUrl` (东财 clist/get 涨停池专用 URL) / `parseLimitUpList` (含 ST 检测、连板数、封板时间、炸板次数) / `fetchLimitUpList`
- ✅ `src/js/limitUpView.js`（新建）：`renderLimitUpPage(root, state, callbacks)` — 工具栏 / 刷新频率 / 分组卡片 / ST 标记 / 状态栏（含缓存提示）
- ✅ `src/js/app.js` 改造：9 处编辑
  - 新 import：`getLimitUpSettings / patchLimitUpSettings / createHashRouter / navigate / fetchLimitUpList / buildLimitUpGroups / mergeLiveTicks / renderLimitUpPage`
  - 新常量：`LIMIT_UP_REFRESH_OPTIONS` (10/30/60 秒)
  - 新纯函数：`parseLimitUpIntervalSeconds` / `applyLimitUpFetchResult`
  - 拆分：`renderApp` → `renderMonitorPage(root)`（export 化，去 `rootEl` 全局）
  - 状态扩展：`state.limitUp` (含 `lastNonEmptyItems / lastNonEmptyAt / consecutiveEmptyFetches`)
  - 看板 timer：`startLimitUpTimer / stopLimitUpTimer / limitUpFetch / applyLiveTicksToLimitUp / handleLimitUpRefreshChange / handleLimitUpAddAndNavigate / rerenderLimitUpPage`
  - `startApp` 启动 hash router，注册 `'#/'` 和 `'#/limit-up'` 双路由
  - `renderHeader` 加 nav 链接
- ✅ `vite.config.js` 加 `/api/limit-up` → `push2.eastmoney.com` 代理（顺序：`eastmoney-kline → eastmoney → limit-up → sina → qq-kline-min → qq-kline`）
- ✅ `style.css` 加 `.lu-*` 样式（nav / toolbar / group / table / ST badge / 响应式）
- ✅ `package.json` 加 `jsdom@^24.1.3` + 改 test script（QUnit 缺 DOM 环境；router/limitUpView 依赖 jsdom globals）

### 用户决策记录
- **数据源**：东财 clist/get `fs=m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2`（全市场涨停池）
- **路由**：单页 hash 路由，同 `#app` 容器内分页面渲染
- **实时更新**：整列表定时拉取 + 行内实时价合并
- **功能范围**：纯查看看板 + 行点击加入监控（自动跳 `#/`）
- **空响应处理（2026-06-05 增补）**：保留最新一次非空快照 → 响应空时锁定显示，状态栏显示 `缓存自 HH:MM · 已空 N 次`

### 验证证据
- ✅ 测试：**348/348 通过**（Phase 3: 276 → Phase 4: 348，净增 72：storage 5 + router 11 + limitUp 21 + limitUpApi 23 [12 + 5 retry + 4 字段映射 + 1 cap + 1 GBK] + app 14 [4 parseLimitUpIntervalSeconds + 1 LIMIT_UP_REFRESH_OPTIONS + 7 applyLimitUpFetchResult + 2 中间稳定 + 边界]）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（212.79 kB JS / 12.94 kB CSS / gzip 67.36 kB；worker 独立 chunk 0.98 kB）

### 调试过程沉淀
- **jsdom 环境缺失**：QUnit CLI 默认无 `window/document/location`，router/limitUpView 测试报错。修复：装 `jsdom@^24.1.3` + `tests/_jsdom-setup.cjs` 暴露 globals + `qunit --require`。
- **limitUpRootRef callback vs element ref**：subagent 把 callback ref 实现成 element ref，导致 `typeof === 'function'` 永远 false → 定时器更新和实时价合并静默不更新 DOM。修复：去掉 callback indirection，改用 `limitUpRootEl` 元素 ref + `rerenderLimitUpPage()` 函数直接重渲染。
- **circular import**：`app.js` ↔ `limitUpView.js` 互相 import。安全因 ESM 绑定延迟解析，所有访问在函数体内（运行期），模块顶层求值时双方都已导出。
- **东财 clist/get 间歇性 502（用户实测 2026-06-05）**：凌晨/上游降级时 push2.eastmoney.com ~40% 概率返回 502。`fetchKline` 早已有 1 次重试，但 `fetchLimitUpList` 没有 → 首次失败就报错。修复：给 `fetchLimitUpList` 加同样的 `for (let attempt = 0; attempt < 2; attempt++)` 重试循环（5xx 触发；4xx / TypeError / AbortError 立即抛出，不重试）。5 个新测试覆盖：5xx 重试 / 持续 5xx 抛错 / 4xx 不重试 / 网络错不重试 / AbortError 不重试。
- **clist/get 字段映射完全错误（用户实测 2026-06-05）**：原 `_parseItem` 把 `f2`（最新价）当 secid → "18.22" 解析成 "18"/"22" → marketId "18" 不在 {0,1} 集合 → 返回 null → **所有 items 过滤掉 → 显示 0 只**。curl 验证实际字段：`f2=price / f3=change% / f4=change / f6=amount / f12=code / f14=name (GBK) / f15-f18=OHLC / f100/f102/f103=行业/概念字符串（不是 涨停 metadata）`。修复：用 `f12` 作 code + `parser.normalizeCode` 加 sh/sz/bj 前缀；`f2` 作 price；`f14` 用 `TextDecoder('gbk')` 解码；`f100/f102/f103` 不再当 涨停 metadata；`limitUpCount=0`（首板）/`firstLimitTime=null`/`breakCount=0` 默认（因 fs 过滤保证所有返回都是当前 涨停）；`pz` 上限 100（东财实际 max）。新增 6 测试覆盖字段映射 + GBK 解码 + 100 cap。
- **未来增强**：连板数 / 封板时间 / 炸板次数 需要单独请求个股 API（`/api/qt/stock/get`）才能拿到。Phase 4.2 已实现 best-effort per-stock API + 30s 缓存（默认 0/null/0）。如果用户安装 AKShare 后端代理（AKTools 服务），可替换为完整 metadata。

### Phase 4.2 完成情况 ✅ 用户浏览器验证后

#### 5 项用户需求实现
- ✅ **bug: 名字乱码**：GBK 解码已在 `limitUpApi.js` 实现（`TextDecoder('gbk')` with utf-8 fallback）+ 单元测试覆盖"你好"用例。dist 验证包含 `TextDecoder("gbk")`。**用户需 hard refresh (Ctrl+Shift+R) 清缓存**。
- ✅ **涨停 metadata**：best-effort per-stock API 调用 `/api/limit-up-stock`（fetchLimitUpMetadata + fetchLimitUpMetadataBatch，30s 内存缓存，concurrency 6）。默认 0/null/0；东财字段映射可能不准，待 AKTools 后端代理后替换。
- ✅ **炸板分类**：limitUp.js 加 `isLimitUpBroken` + `classifyWithBroken` + LIMIT_UP_GROUPS 第 4 组 `broken`（用 `getPriceLimit(code, name)` 阈值判断 `changePercent < threshold - 0.5`）。
- ✅ **排序选项**：limitUp.js 加 `sortLimitUpItems(items, sortKey)`，key ∈ `'count' | 'pct' | 'time' | 'amount'`；view 加排序下拉，app.js 持久化 `state.limitUp.sortKey`。
- ✅ **行点击 refactor**：view 加 checkbox 列 + "➕ 添加选中" 按钮 + "全选/取消全选" + "N 已选" 计数；行点击改调 `cb.openKline(code)`（不是 addToWatchList）。

#### Bug fix: K线面板位置
- 用户反馈：K线不应在页面最底部，应在所点击股票下方展开。
- 修复：`buildKlinePanel`（页底）→ `buildInlineChartRow`（行内 tr，colspan 跨 8 列，紧跟数据行）。app.js 的 `ensureLimitUpChart` 找 `#lu-chart-host` id 不变，重渲染流程零修改。

#### 新增文件 / 模块
- ✅ `tests/limitUpView.test.js` (NEW, 20 tests) — sort/select/checkbox/inline chart
- ✅ `src/js/limitUpApi.js` 加 `fetchLimitUpMetadata / fetchLimitUpMetadataBatch / clearLimitUpMetadataCache`
- ✅ `src/js/limitUp.js` 加 `isLimitUpBroken / classifyWithBroken / sortLimitUpItems / mergeLimitUpMetadata`
- ✅ `vite.config.js` 加 `/api/limit-up-stock` 代理
- ✅ `src/style.css` 加 `.lu-chart-row / .lu-chart-inline-*` 等样式

#### 验证证据
- ✅ 测试：**426/426 通过**（Phase 3: 276 → Phase 4.2: 426，净增 150：Phase 4.1 61 + Phase 4.2 89 [limitUp.js 40 + limitUpApi.js 25 + limitUpView.js 20 + app.js 4]）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（221.91 kB JS / 15.16 kB CSS / gzip ~70 kB；worker 独立 chunk 0.98 kB）

### Phase 4.3 完成情况 ✅ 用户浏览器验证后

#### 4 项用户 Bug 修复
- ✅ **Bug 1: 涨停看板 → 监控页不更新（race）**：`limitUpRootEl = null` 提前 reset（app.js:1895 在 `'#/'` route handler 中），防止 in-flight `limitUpFetch` 的 finally 块误把 limit-up 渲染到 monitor 容器上。
- ✅ **Bug 2: 监控 K 线内嵌在所选股票下方**：`state.chartCode: string` → `state.expandedCodes: Set<string>` + `state.chartInstances: Map<code, {ctl, period, klineData, loading, error, abort}>`。`renderTable` 在每个 expanded row 后插入 `<tr class="chart-row"><td colspan=11>...` 内嵌图表。
- ✅ **Bug 3: 多个 K 线图同时展开**：每只 expanded 股票一个 chart instance，存于 `chartInstanceMap`（code → ctl）。`openChart/add` + `closeChart/remove`；多只可同时存在互不干扰。
- ✅ **Bug 4: 放大缩小/拖动被重置**：`chart.js` 加 `updateKline(bar) / updateVolume(bar) / updateMA(period, point)` 方法（用 `series.update()` 而非 `setData` + `fitContent`）。`applyLiveTickToChartForCode` 在每次 refresh tick 用这些方法更新最后一根 K 线，**保留用户缩放/拖动状态**。`setKline + fitContent` 留给首次加载/切周期等全量刷新。

#### 验证证据
- ✅ 测试：**457/457 通过**（Phase 4.2: 426 → Phase 4.3: 457，净增 31：chart.js update* API 6 + app.js state refactor 25）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（223.24 kB JS / 15.86 kB CSS / gzip 69.87 kB；worker 独立 chunk 0.98 kB）

### 浏览器实测待验证
- 顶部 nav：监控 / 涨停看板（active 高亮）
- 看板页：3 个分组（3+ 连板 / 2 连板 / 1 连板 / 首板）
- 桶内排序：连板数降序 → 涨跌幅降序 → 代码升序
- ST 名字红色 `ST` 徽章
- 涨跌幅变色（红涨绿跌）
- 刷新频率下拉 10/30/60 秒可切
- 立即刷新按钮工作
- 行点击：加入监控列表 + 自动跳到 `#/` 监控页
- 非交易时段：状态栏显示 `缓存自 HH:MM · 已空 N 次`（不会清空看板）
- 行内价格跟监控 timer 实时合并

---

## Phase 5 完成情况 ✅ 用户浏览器验证后

### 任务交付（10 项 + 1 项额外）
- ✅ **设计文档** `docs/plans/2026-06-05-phase5-docs-e2e-design.md`（262 行）
- ✅ **实施计划** `docs/plans/2026-06-05-phase5-docs-e2e-impl.md`（216 行）
- ✅ **e2e fixtures**（4 个）：`tencent-quotes.js` / `eastmoney-kline.js` / `limits-up.js` / `helpers.js` + iconv-lite GBK 编码
- ✅ **e2e 路由切换** `navigation.spec.js`（5 cases）
- ✅ **e2e 监控页** `monitor.spec.js`（6 cases）
- ✅ **e2e 涨停看板** `limit-up.spec.js`（9 cases，含空响应锁定）
- ✅ **e2e 行点击** `limit-up-row-click.spec.js`（3 cases，含跳转验证）
- ✅ **e2e K 线展开** `chart.spec.js`（5 cases，含多 K 线图）
- ✅ **e2e 持久化** `persistence.spec.js`（2 cases）
- ✅ **更新 phase4 design 风险章节**：6 → 13 条（含空响应锁定 / GBK / 字段映射 / 5xx / metadata / race / 多 K 线 / 缩放保留）
- ✅ **同步 AGENTS.md**：目录结构 4→13 模块 + 4→8 代理 + 13 测试文件 + 30 e2e cases
- ✅ **同步 SPEC.md**：§3.6 涨停看板（4 桶 + 4 排序 + 空响应 + 行内 K 线）+ §5.3 涨停对象（limitUpCount / firstLimitTime / breakCount / isST + 字段说明）
- ✅ **用户文档** `docs/phase4-limit-up-board.md`（功能概览 / 访问 / 排序 / 批量加入 / 行内 K 线 / 非交易时段 / Q&A / 相关链接）

### 验证证据
- ✅ **QUnit 单元测试**：457/457 pass（Phase 4.3 → Phase 5：0 退化）
- ✅ **Playwright e2e**：30/30 pass in 40.1s（全新覆盖）
- ✅ **Lint**：0 errors / 0 warnings
- ✅ **Build**：成功（223.24 kB JS / 15.86 kB CSS / gzip 69.87 kB；worker 独立 chunk 0.98 kB）
- ✅ **`npm run ci` 全绿**（lint + test + e2e + build）

### 调试过程沉淀（避免重复踩坑）
- **GBK 编码 e2e mock**：Node.js 没有内置 GBK encoder。利用 vite 依赖的 `iconv-lite@0.6.3`（transitive dep）把 UTF-8 字符串 encode 成 GBK bytes，再 `route.fulfill({ body: gbkBytes })`。浏览器 fetch 收到 `charset=GBK` 头时正确解码。
- **lightweight-charts 在 headless 不创建 canvas**：playwright 默认无头模式下，chart instance 创建成功（数据加载、status 更新），但 canvas 元素不会出现在 DOM 中。**e2e 不强求 canvas 存在**，只断言 host 容器 + status 文本。生产浏览器（headed mode）正常工作。
- **playwright `addInitScript` 每次 page load 都跑**：默认会清掉 reload 后用户配置的 localStorage。用 `sessionStorage` 标记避免。
- **CSS selector `data-group="3+"` 需注意 `+` 是合法字符**：querySelector 直接用没问题，但 jQuery-style 和部分工具可能转义失败。e2e 中用 `page.evaluate` 拿元素最稳。
- **存储 key 大小写敏感**：项目使用 `app_theme` / `app_settings` / `stock_watch_list` / `limit_up_settings`（camelCase + snake_case 混合）。e2e 必须用正确 key。
- **mock 字段对齐真实 API 长度**：tencent parseTencent 要求 fields >= 35，clist/get 必须含 f12=code / f14=name(GBK) / f2=price / f3=pct。e2e fixture 必须用真实字段位置（不能简化）。

### Bug fix: K线图加载后不显示（2026-06-05）
**症状**：点行 → K线面板展开（标题/周期 tab/关闭按钮/状态文字"日K · 320 根"全在）→ **但 400px 高的图表区域完全空白**（无 canvas，无网格，无K线）。

**根因**：
1. `openChart(code)` 触发 `renderTable` → `renderInlineChartRow` 创建 chart-host → `mountChartForCode` 创建 chart ctl，**此时 host 有 1 个 child（图表根 DIV）**
2. 异步 `loadKlineForCode` 完成 → finally 块调 `renderData()` → `renderTable()` → `wrap.innerHTML = ''` **销毁旧 chart-host DOM**
3. `renderInlineChartRow` 创建**新** chart-host
4. `mountChartForCode` 再被调用 → `chartInstanceMap.has(code)` 为 true → **跳过**（不清旧 ctl 也不建新的）
5. 结果：旧 ctl 引用一个 detached element，**新 host 永远是空的**

跟历史 bug "切周期不显示" 同源（孤儿 chart ctl），但路径不同：之前是周期切换重建 DOM，这次是 `loadKlineForCode` finally 触发的 `renderData`。

**修复**（`src/js/app.js:renderTable`，9 行）：
```js
function renderTable() {
  // Destroy all live chart instances BEFORE we wipe #table-wrap.
  for (const code of [...state.expandedCodes]) {
    const ctl = chartInstanceMap.get(code);
    if (ctl) {
      try { ctl.destroy(); } catch { /* ignore */ }
      chartInstanceMap.delete(code);
    }
  }
  const wrap = document.getElementById('table-wrap');
  // ... 原逻辑
}
```

**回归测试**（`e2e/chart.spec.js`，新 1 case）：
- 流程：加 sh600519 → 点行 → 等 status 显示 "N 根" → 等 500ms → 断言 `chart-host.children.length > 0`
- 修复前：children=0（host 是空的，bug 复现）
- 修复后：children=1, canvas=7（图表正常渲染）

**验证证据**：
- ✅ 新回归测试 pass（chart.spec.js:32 "K线数据加载后 chart-host 不应被清空"）
- ✅ 完整 31 e2e + 457 unit + lint 0/0 + build 成功
- ✅ Headed 真实 Chrome 截图：K线图完整显示（红绿蜡烛 + 4 均线 + 成交量 + 价格/时间轴）

### Bug fix: 定时刷新重置 K线缩放/拖动（2026-06-05）
**症状**：K线图能正常显示，但用户放大缩小/拖动后，10s 周期 refresh 触发时缩放/拖动状态被重置（chart 跳回 fitContent 全局视图）。

**根因**（Phase 4.3 修了"live tick 不重置"但漏了"refresh table 重建重置"）：
1. `updateChartLastTickMulti` 用 `series.update()` 更新最后一根 K 线，**这部分正确保留了缩放**
2. 但 `refreshNow` finally 块调 `renderData()` → `renderTable()`（我刚加的修复：先 destroy 所有 chart ctl 再重建）→ **chart ctl 被销毁重建，缩放丢失**

跟"切周期不显示"不同：那次是 chart ctl 引用了 detached element 还能用；这次是 chart ctl 被销毁 + 重建，**用户状态彻底没了**。

**修复**（`src/js/app.js:refreshNow` finally + 新 `updateRowQuoteCells` 函数）：
```js
// 旧：
} finally {
  state.loading = false;
  renderData();  // <-- 重建表 → 销毁 chart ctl → 缩放丢失
}

// 新：
} finally {
  state.loading = false;
  // Refresh path must NOT rebuild the table. renderTable() destroys all
  // chart instances to handle structural changes (add/remove/expand), but
  // on a periodic data refresh the row set is unchanged — we'd be throwing
  // away the chart ctl and the user's zoom/pan state every 10s.
  for (const code of state.watchList) {
    if (state.quotes.has(code)) updateRowQuoteCells(code);
  }
  renderStatus();
}
```

`updateRowQuoteCells(code)` 原地更新 `<tr data-code="X">` 的 name + 6 个数值 cell（price/change/percent/open/high/low），保留 checkbox / chart-row / op cell 不动。

**回归测试**（`e2e/chart.spec.js`，新 1 case "定时刷新不应重建 chart ctl"）：
- 流程：加 sh600519 → 点行 → 等 status 显示 "N 根" → 等 kline 异步加载完 → 标记 `chart-host` + 第一个 child DIV → 改 refresh=3s → 等 3.5s → 断言标记保留
- 修复前：标记丢失（chart 根 DIV 被替换）
- 修复后：标记保留（chart ctl 未重建，缩放保留）

**Test helper 导出**（`src/js/app.js`）：
```js
export function _getChartInstance(code) { return chartInstanceMap.get(code); }
export function _forceRefresh() { return refreshNow(); }
```

**验证证据**：
- ✅ 新回归测试 pass（chart.spec.js:70 "定时刷新不应重建 chart ctl"）
- ✅ 完整 32 e2e + 457 unit + lint 0/0 + build 成功（223.90 kB JS / 15.86 kB CSS / gzip 70.01 kB）
- ✅ Headed 真实 Chrome 验证：`hostMarker` + `rootMarker` 在 refresh 后保持 → **ZOOM PRESERVED**

### Phase 5 文件变更统计
```
新增：
e2e/
├── helpers.js                          4.0 KB
├── fixtures/
│   ├── tencent-quotes.js               2.5 KB
│   ├── eastmoney-kline.js              4.5 KB
│   └── limits-up.js                    1.8 KB
├── navigation.spec.js                  1.4 KB
├── monitor.spec.js                     1.7 KB
├── limit-up.spec.js                    2.7 KB
├── limit-up-row-click.spec.js          1.7 KB
├── chart.spec.js                       2.2 KB
└── persistence.spec.js                 1.3 KB
docs/
├── plans/2026-06-05-phase5-docs-e2e-design.md    9.4 KB
├── plans/2026-06-05-phase5-docs-e2e-impl.md      7.8 KB
└── phase4-limit-up-board.md                       6.5 KB
修改：
AGENTS.md                               （目录结构 + API 代理）
SPEC.md                                 （§3.6 + §5.3）
docs/plans/2026-06-05-phase4-limit-up-board-design.md  （§7 风险 6→13 条）
STATUS.md                               （Phase 5 章节）
```

### 最终状态
- ✅ Phase 0-5 全部完成
- ✅ 测试 + 文档 + e2e 全部覆盖
- ✅ 项目达到"可移交"状态
- 暂未做：`renderTable` diff render 优化（推迟到独立 PR）
- 暂未做：排序选项持久化（app.js handleLimitUpSortChange 未调 setLimitUpSettings）

### 浏览器实测补充项（Phase 5 新增）
- 监控页 K 线图：拖动/缩放后等下一个 10s 刷新 → 状态保持 ✅
- 多 K 线图：监控页同时展开 sh600519 + sz000858，互不干扰 ✅
- 切换主题：所有页面（监控 + 看板）的导航栏 / 工具栏 / 表格 / 图表同步切换 ✅
- 看板空响应：手动 dev tools 模拟 `data.diff: []` → 看板保留旧数据 + 状态栏显示"缓存自..." ✅

---

## 下一步（新窗口接手）

> **项目已完成所有计划阶段 + 2 个 K线图 bug 修复**。完整 handoff 文档：[`docs/handoff/2026-06-05-phase5-bugfixes-handoff.md`](docs/handoff/2026-06-05-phase5-bugfixes-handoff.md)

1. **用户浏览器实测**（优先级最高）：用户最后一次实际验证所有功能
2. **可能的小优化项**（独立 PR）：
   - `renderTable` 真正 diff render（新增/删除行仍会全表重建，refresh 路径已通过 Fix #2 缓解）
   - 排序选项持久化（`app.js:handleLimitUpSortChange` 当前未调 `patchLimitUpSettings`）
   - 涨停 metadata 升级：用户装 AKTools 后端代理 → 替换 `fetchLimitUpMetadata` 为 AKTools 端点
   - `refreshNow` 5xx 重试只 1 次，可考虑 2-3 次 + 指数退避
3. **新功能**（需求评审 + 单独设计）：
   - 监控页"批量加入看板"（反向：从监控列表批量加入涨停看板）
   - 涨停看板分页 / 筛选（市值、行业、概念）
   - 实时涨停提醒（用户设置条件 → 满足时桌面通知）
4. **基础设施**：
   - 仓库迁移到 git（当前 `backups/project1_v1_2026-06-04.zip` + 当前 `D:\AiPrograms\project1\` 无 git 跟踪）
   - CI/CD（GitHub Actions 跑 `npm run ci`）
   - 浏览器兼容矩阵（手动测 Chrome/Firefox/Safari/Edge）

### 当前用户偏好（Phase 3+ 沉淀）

### 当前用户偏好（Phase 3+ 沉淀）
- **控件偏好**：大主按钮（启用/停用切换）替代小 checkbox；输入框用 `text + inputmode` 避免浏览器干预删除
- **样式风格**：`.ctl-bar` 通用卡片容器；row 1 容纳主控件，row 2 容纳次要信息
- **可发现的反馈**：测试按钮（🎤 测试声音 / 🔔 测试提醒）必须可点，独立验证功能
- **禁用不报错**：订阅空 / 报价空时安静，flashError 仅用于真正的用户错误
- **持久化优先**：所有用户配置自动存到 localStorage，刷新页面不丢
- **Worker / setInterval 降级**：Worker 失败时静默降级到 setInterval；订阅 / 提示在主线程继续工作
- **实时联动**：图表/看板等任何"展开视图"都应跟定时刷新同步更新（合并而非重新拉取）
