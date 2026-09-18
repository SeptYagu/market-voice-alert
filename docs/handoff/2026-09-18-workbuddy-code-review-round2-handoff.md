# 独立代码审查报告（Round 2 复查）— 集合竞价日K下影线消除 / 分时图集合竞价纳入 / 语音播报时段去重方案 v2

日期：2026-09-18
类型：独立代码审查（技术方案与根因分析审查，纯文档 diff）
结论：**未通过**（1×P1 + 4×P2 + 1×P3，最高严重级别 P1）

---

## 一、审查基本信息与通过项简述

- 被审 HEAD：`c2dc6a202647b5dd5bacef6a13bccab5c2095c25`（提交信息「docs: 集合竞价行情与播报深度优化方案 v2 闭环 Round 1 审查 2xP1 + 4xP2 缺陷」，父提交 `0df97ce`，`origin/main` 与本地 HEAD 一致，工作区干净，无历史重写）。基准 `ad0c6095b96b8fe8f11d035748b5e1a5282b1512`；实际审查范围 `ad0c609..c2dc6a2` = 4 文件 / +481 −1（`STATUS.md`、`docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md`、`docs/handoff/2026-09-18-workbuddy-code-review-round1-handoff.md`、`docs/handoff/INDEX.md`），全为文档，按纯文档专项规则审查；其中本轮增量提交自身为 3 文件 / +177 −109。
- 通过项简述：Round 1 六项缺陷均在 v2 中有对应闭环段落与改动落点（`marketSession.js`/`voiceSchedule.js`/`kline.js`/`chart.js`/`voiceController.js`），文档引用的既有代码行号（`marketSession.js:51`、`voiceSchedule.js:16-17`、`voiceController.js:35`/`41-43`、`kline.js:475-477`/`494-496`/`508-514`、`chart.js:732-741`/`744-754`、`chartRowController.js:386-399`）逐行核对与 HEAD 一致；§3.3.3 提议的 `buildQuoteSpeechSegments`（`tts.js:289`）确实存在且导出，可作为 `spoken` 构造源；§3.2.2 的固定网格扩展与 `chinaStockStrategy.getIntradaySessionRanges()=[[555,690],[780,900]]` 自洽。
- 独立验证：以真实模块（`marketSession.js`/`services/voiceSchedule.js`/`controllers/voiceController.js`/`parser.js`）实跑 4 组探针共 15 项场景，其中 3 项成功证伪方案（详见缺陷清单），其余与预期一致。未修改任何产品代码或正式测试，临时探针文件已删除（`git status` 干净）。

---

## 二、审查发现与缺陷清单

### P1-1 语音使能窗口（09:20-09:25）与会话窗口（09:15-09:30）错配：09:25-09:30 仍被 `autoStartAuction` 拦截，§3.3.3 的记忆基线在 09:30 重启时被 `memory.clear()` 丢弃 → P2-2 闭环实际不生效

- **严重级别**：P1
- **文件与行号**：
  - 方案文档：§3.3.1（`:199-204`，豁免仅限 `09:20 - 09:25`）、§3.3.2 第 3 条（`:212-213`，「`min >= 09:25` 恢复受约束」）、§3.3.3（`:215-226`，「09:25 恢复去重后…彻底消除 09:25 开盘重复播报」）、§5.1(5)（`:259-261`）、§5.2 M5（`:271`）
  - 未覆盖的会话窗口：`src/js/marketSession.js:26-29`（`getMarketSession`：`t >= 9*60+15 && t < 9*60+30 → 'opening-auction'`）
  - 未覆盖的使能分支：`src/js/marketSession.js:47-55`（`isAutoRefreshAllowedInSession`，`:51` `opening-auction → !!cfg.autoStartAuction`）、`:43-44`（`isVoiceAllowedInSession` 仅为转发）、`:298-303`（`getVoiceEligibleCodes`）、`src/js/services/voiceSchedule.js:18`（`allowed = eligibleCodes.length > 0`）、`:38`（`timerShouldRun: !!enabled && allowed`）
  - 记忆基线丢弃点：`src/js/controllers/voiceController.js:65-69`（`startTimer()` 第 3 行即 `memory.clear()`）、`:91-99`（`applySchedule` 在 `!timerShouldRun` 时 `stopTimer()`）、`:126`（`checker = setInterval(applySchedule, 30000)`）
- **触发条件**：`settings.enabled = true`、`settings.smartSchedule.autoStartAuction = false`（默认值，`marketSession.js:11`）、标的为 A 股、北京时间 09:25:00–09:29:59（按 v2 方案的使能窗口，该区间无任何豁免）。
- **实际行为（真实模块实跑）**：

  ```
  09:19 session=opening-auction eligible=[] timerShouldRun=false
  09:20 session=opening-auction eligible=[] timerShouldRun=false   ← v2 方案在此处才开始豁免
  09:22 session=opening-auction eligible=[] timerShouldRun=false
  09:25 session=opening-auction eligible=[] timerShouldRun=false   ← 方案要求「恢复受约束播报」
  09:26 session=opening-auction eligible=[] timerShouldRun=false   ← 仍受 autoStartAuction 拦截
  09:29 session=opening-auction eligible=[] timerShouldRun=false
  09:30 session=trading        eligible=["sh603533"] timerShouldRun=true
  09:31 session=trading        eligible=["sh603533"] timerShouldRun=true
  ```

  即在 v2 方案下：09:25:00–09:29:59 的 `eligibleCodes` 仍为空数组，`timerShouldRun=false` —— 该 5 分钟窗口内 `speakCodes([])` 恒为空循环，**不会产生任何播报**；`applySchedule`（每 30s 由 `checker` 驱动）随即 `stopTimer()`；到 09:30 会话切回 `trading` 时 `runningInterval === null`，`applySchedule` 判定 `null !== interval` 而调用 `startTimer()`，而 `startTimer()` 首行即 `memory.clear()`。实跑证实该清空行为：

  ```
  memory after a dedupe broadcast  = [["sh603533",{"price":"20.00 元","percent":"持平"}]]
  memory after stopTimer/startTimer  = []
  ```

- **期望行为**：需求 3 明确「`09:25` 及之后（撮合后与连续交易时段）：恢复受『相同报价不重复播报』按钮约束」——即 09:25 起应继续播报、只是恢复去重；§3.3.3 亦以「09:25 恢复去重后以 09:25 刚播出的最新价格为基线」为前提。
- **根因**：v2 方案按**分钟**划分使能豁免（`09:20 <= min < 09:25`），而门禁是按**会话**判定的，`opening-auction` 会话一直延续到 09:30（`marketSession.js:27`）。方案只把豁免放在「不可撤单博弈期」这 5 分钟，未处理同一会话的尾段（09:25-09:30），因此该尾段既无使能豁免、又已按 §3.3.2 恢复 `dedupe=true`，形成「要求播报却无码可播」的空洞；同时因尾段空转导致定时器停摆、09:30 会话切换触发 `startTimer() → memory.clear()`，把 §3.3.3 刚写入的记忆基线整体丢弃，使 P2-2 的修复成为**无观测效应**的死改动（09:20-09:25 期间 `dedupe=false` 从不读取 memory；09:25-09:30 静音；09:30 起 memory 已被清空）。
- **影响范围**：Feature 3 在默认配置下 09:25-09:30 全程静音（与需求及 §3.3.2/§3.3.3 自相矛盾）；Round 1 的 P2-2（09:25 恢复去重时的记忆基线）在真实控制流下未被闭环；§5.2 M5 的「确定性转红」断言不成立（见 P2-4）。
- **复现方法 / 运行证据**：见上文实跑输出。调用方式（真实模块）：
  `getMarketSession(new Date('2026-09-18T09:26:00+08:00'), ['2026-09-18'])` → `'opening-auction'`；
  `getVoiceEligibleCodes(['sh603533'], {enabled:true, autoStartAuction:false, pauseLunchBreak:true, autoStopAfterClose:true}, now, ['2026-09-18'])` → `[]`；
  `decideVoiceSchedule({codes:['sh603533'], settings:{enabled:true, interval:10000, skipUnchanged:true, smartSchedule:{enabled:true, autoStartAuction:false}}, now, tradingDates:['2026-09-18']}).timerShouldRun` → `false`；
  记忆清空：`createVoiceController(...).startTimer(); speakSubscribed(); inspect().memory` → `[["sh603533",{...}]]`，随后 `stopTimer(); startTimer(); inspect().memory` → `[]`。
- **修复建议**：把使能豁免的边界从「分钟窗口」改为「会话/需求的时段语义」并对齐 §3.3.2：
  1. 使能判据改为「A 股且 `09:20 <= min < 09:30` 无条件使能」（即覆盖 `opening-auction` 会话后段至会话结束），使 09:25-09:30 与 §3.3.2 的「恢复去重播报」一致；或
  2. 若产品确需 09:25-09:30 静音，则必须同步改写 §3.3.2 第 3 条、§3.3.3 与 §5.1(5)，并说明「09:25 恢复去重」的真实语义（并在 §5.2 删除或重写 M5）。
  同时明确：记忆基线的生命周期不得与 09:30 的 `startTimer()` 冲突——若要走「09:25 恢复去重」路径，需说明 `memory.clear()` 在会话切换时是否应保留（当前实现必清空）。
- **修复后验收标准**：在 `autoStartAuction=false`、`settings.enabled=true` 下，09:20、09:25、09:29 三个时点的 `decideVoiceSchedule(...).eligibleCodes` 均含订阅标的且 `timerShouldRun === true`；播报在 09:20-09:25 严格按 interval 全量发声、09:25-09:30 对未变价静默、对变价发声；若 09:26-09:29 仍静音，则文档必须在 §3.3.2/§3.3.3/§5 中同步声明为设计决策而非「恢复约束」。

---

### P2-1 §3.3.1 指定的改动点不可按字面落地且未声明副作用：`isAutoRefreshAllowedInSession`/`isVoiceAllowedInSession` 无时钟入参，且被数据刷新门禁复用

- **严重级别**：P2
- **文件与行号**：方案文档 §3.3.1（`:200-204`）、§四 清单第 1 行（`:234`）；目标函数 `src/js/marketSession.js:43-44`、`:47-55`；共享调用方 `src/js/app.js:180-185`（`DATA_REFRESH_SCHEDULE`）、`:1221-1223`（`return isAutoRefreshAllowedInSession(session, DATA_REFRESH_SCHEDULE)`）；既有契约测试 `tests/marketSession.test.js:38-48`（用例名即「data auto refresh can reuse session rules without voice state」）、`:27-36`
- **触发条件**：按 §3.3.1 在 `isAutoRefreshAllowedInSession(session, smartSchedule)` 内实现「若当前北京时间处于 09:20-09:25 则无条件返回 true」。
- **实际行为**：该函数签名只有 `(session, smartSchedule)`，**作用域内没有当前时间**，无法判断「是否处于 09:20-09:25」；计划中亦未说明新增 `now`/`min` 入参、未列出需同步改造的调用点。且该函数并非语音专用：`app.js:1223` 用同一个函数为**数据自动刷新**做门禁（`DATA_REFRESH_SCHEDULE` 同样是 `autoStartAuction: false`）。按其字面在函数内放开 09:20-09:25，将同时改变数据刷新在集合竞价后段的行为，而方案通篇未声明这一连带影响。此外 `tests/marketSession.test.js:35` 与 `:48` 现断言 `isVoiceAllowedInSession('opening-auction', cfg) === false` / `isAutoRefreshAllowedInSession('opening-auction', cfg) === false`，该契约在方案下必然需要改写。
- **期望行为**：方案应把语音使能豁免落在**具备时钟入参且语音专属**的判据上（例如 `chinaStockStrategy.isVoiceAllowed(now, cfg, tradingDates)`，`marketSession.js:117-120`，该处 `now` 已在作用域内），或显式声明为 `isAutoRefreshAllowedInSession(session, smartSchedule, now)` 的签名变更并列出全部调用点（`marketSession.js:44`、`:119`、`app.js:1223`）与既有测试的同步改造；对「数据刷新是否同步豁免」给出明确决策。
- **根因**：v2 在闭环 P1-1 时选用了 Round 1 建议中的位置选项，但未核验该函数的入参契约与调用面；Round 1 建议中并列的「为语音定义与自动刷新解耦的独立会话判据」这一更安全选项未被采用也未说明理由。
- **影响范围**：方案改动点不可直接实现；若实现者擅自补参数，会连带改变 09:20-09:25 的数据刷新行为并使既有门禁测试失效（界面/轮询节奏连带变化）。
- **复现方法 / 运行证据**：函数签名与调用面由源码直接确认——`sed -n '43,55p' src/js/marketSession.js` 显示两个函数均无时间入参；`grep -rn "isAutoRefreshAllowedInSession" src/ tests/` 命中 `app.js:1223`（数据刷新）与 `tests/marketSession.test.js:45-48`（其用例名明确点出该复用契约）。实测同一调用在 09:20-09:25 与 09:25-09:30 不可区分：`isAutoRefreshAllowedInSession('opening-auction', {autoStartAuction:false}) === false`（返回 `false`，与时刻无关）。
- **修复建议**：改写 §3.3.1 与 §四 清单第 1 行：把豁免落点改为 `chinaStockStrategy.isVoiceAllowed`（或新增语音专属判据），并在 §四 明列「新增/变更的函数签名 + 受影响调用点清单」；如确需复用 `isAutoRefreshAllowedInSession`，则明确给出 `now` 入参、`app.js:1223` 的传参方式、以及数据刷新在 09:20-09:25 的目标行为与既有测试的更新清单。
- **修复后验收标准**：方案中每个改动点的函数签名、入参来源与调用方逐一列明；按方案实现后 `tests/marketSession.test.js` 的门禁语义变化有明确预期（新增/改写的断言逐条列出），且语音与数据刷新两者在 09:20-09:30 的行为分别可判定。

---

### P2-2 P1-2 的品种隔离契约不水密：`quote.type === 'stock'` 不是有效资产来源、`inferAssetType(quote.code || code)` 引用了未定义标识符，且 §3.1.3/§四 的隔离作用域与 §3.1.1 的承诺相互矛盾

- **严重级别**：P2
- **文件与行号**：方案文档 §3.1.1（`:124-128`）、§3.1.3 第 2 条（`:148-155`）、§四 清单 `kline.js` 行（`:236`）；代码 `src/js/kline.js:454`（`applyLiveQuoteToKline(items, quote, period)`，无 `code`/资产类型参数）、`:491-496`（原地分支）、`src/js/controllers/chartRowController.js:123`、`:396`（两个调用点均不传 code/资产类型）；资产类型来源 `src/js/parser.js:26-48`（`inferAssetType`）、`:397`/`:490`（解析器仅对期货写入 `type`）、`src/js/app.js:953`（`state.quotes.set(code, { ...item, type: 'stock' })`）
- **触发条件**：实现者按 §3.1.1 首选项 `quote.type === 'stock'` 判定 A 股；或按 `inferAssetType(quote.code || code)` 字面转写。
- **实际行为**：
  1. `quote.type === 'stock'` 作为「是 A 股」的判据**两个方向都不成立**：`parser.js` 对 A 股/港股/美股行情不写 `type`（仅 `:397` 写 `'futures_global'`、`:490` 写 `'future'`），故普通 A 股行情 `quote.type` 为 `undefined` → 判据恒假，盘前守卫对 A 股反而不生效；而 `app.js:953` 在订阅动量条目时对**任意 code**（含期货）强制 `type: 'stock'` → 判据对非 A 股恒真（与 §3.1.1「港股/美股/期货盘前守卫完全不介入」直接冲突）。
  2. `applyLiveQuoteToKline` 的作用域内**不存在 `code` 标识符**（签名 arity=3，两个调用点 `chartRowController.js:123`/`:396` 均未传入），`inferAssetType(quote.code || code)` 字面转写会在 `quote.code` 为空值时抛 `ReferenceError`。
  3. `inferAssetType` 对空/非字符串入参默认回退 `STOCK_CN`（`parser.js:27`、`:48`），即「取不到 code」时的**失效方向是让守卫生效**，与本缺陷要防的跨品种误伤方向相反（实测 `inferAssetType(undefined) === 'stock_cn'`）。
  4. 作用域自相矛盾：§3.1.1 承诺非 A 股「盘前守卫完全不介入」，但 §3.1.3 第 2 条以无条件口径改写原地更新分支（`if (price > last.high) updated.high = price;`，取代原 `Math.max(lastHigh, quoteHigh, price)`），§四 清单又把「严格限定 STOCK_CN」与「追加分支与原地分支全面废除外部脏 quote.low/high」并列写在同一格——实现者据 §3.1.3/§四 做全局改写时，非 A 股在**官方 Bar 未含当日极值**时的 `quote.high/quote.low` 扩展会一并被删除，形成与 Round 1 P1-2 同类的跨品种回归；而 §5.1(3) 的断言（非 A 股 `high===103/low===98`）又隐式要求该改写仅作用于 A 股——即用例与正文作用域不一致。
- **期望行为**：§3.1.1 应给出**唯一、可解析**的资产来源（建议直接采纳 Round 1 建议①：为 `applyLiveQuoteToKline` 显式增加 `code`/`assetType` 入参，由 `chartRowController.js:123`/`:396` 传入 `inst.klineData.code` 或调用方已有值），并说明空值时的失效方向（应 fail-closed：无法判定品种时不启用守卫，或按调用方显式传入的类型）；§3.1.3 第 2 条与 §四 清单必须写明该改写的品种作用域（仅 A 股 / 全品种）。
- **根因**：v2 用「行情对象上的启发式字段」替代了显式契约；未核验 `quote.type` 的实际写入方与 `inferAssetType` 的默认回退语义，也未把 Round 1 已点名的入参契约落到函数签名上。
- **影响范围**：P1-2 的跨品种隔离可能在动量订阅路径反向失效，或在实现 §3.1.3 时对港股/美股/国际期货日K造成新的极值失真；`ReferenceError` 将使 A 股盘前合并直接抛错（被 `app.js:1359-1364` 的 try/catch 吞掉后静默丢失实时 tick）。
- **复现方法 / 运行证据**（真实模块实跑）：
  ```
  inferAssetType(undefined) = stock_cn     ← 取不到 code 时 fail-open 到「A 股」
  inferAssetType("gl_HSI")  = futures_global
  inferAssetType("nf_RB0")  = futures_cn
  inferAssetType("sh603533")= stock_cn
  ```
  另：`grep -n "type:" src/js/parser.js` → 仅 `397:type: 'futures_global'`、`490:type: 'future'`（股票无 `type`）；`grep -n "state.quotes.set" src/js/` → `app.js:953 ... { ...item, type: 'stock' }` 与 `monitorController.js:47 state.quotes.set(quote.code, quote)`；`applyLiveQuoteToKline.length === 3`。
- **修复建议**：§3.1.1 改为显式入参契约（`applyLiveQuoteToKline(items, quote, period, code)` 或 `opts.assetType`），列明 `chartRowController.js:123`/`:396` 的传参表达式，并声明「无法判定资产类型时守卫是否生效」；删除或降级 `quote.type === 'stock'` 作为判据（若保留，须先说明 `app.js:953` 的强制写入使该字段不可信）；在 §3.1.3 第 2 条与 §四 清单中标注作用域（A 股专属），使 §5.1(3) 的断言与正文一致。
- **修复后验收标准**：文档给出唯一资产来源与调用点传参；按方案实现后，以 `gl_HSI`/`nf_RB0`/`hk00700` 及「无 `code` 字段」的 quote 为输入的日K合并用例中守卫均不生效（或按声明的 fail-closed 语义生效），A 股 `sh603533` 09:18 跌停仍被拦截。

---

### P2-3 §3.2.1 的两个选项均未给出可落地前提：选项 B 引用的 `inst` 在 `chart.js` 中不存在（`opts.isFuture` 全仓从未传入），选项 A 会改变非 A 股品种的「非股票轴」判定

- **严重级别**：P2
- **文件与行号**：方案文档 §3.2.1（`:161-164`）、§5.1(4)（`:256-258`）、§5.2 M4（`:270`）；代码 `src/js/chart.js:732-741`（`hasNonStockHours`/`isFutureTimeline`）、`:743-755`（固定网格与 `displayTimes`）、`:531-535`（`createIntradayChart(container, opts)`）、`src/js/controllers/chartRowController.js:283-291`（唯一调用点，opts 仅 `{theme, height}`）、`:144`（调用方本可提供的 `isFutureCode(code)`）
- **触发条件**：实现者按 §3.2.1 的第二种选项直接书写 `const isFutureTimeline = opts.isFuture || isFutureCode(inst.code);`；或按第一种选项删除 `(min < 9*60+30 && min >= 9*60)` 判据。
- **实际行为**：
  1. `chart.js` 的 `createIntradayChart(container, opts)` 作用域内**没有 `inst`**，也没有 `code`；`chart.js` 未导入 `isFutureCode`；全仓唯一调用点 `chartRowController.js:288-291` 只传 `{ theme: ..., height: ... }`，`grep -rn "isFuture" src/ tests/` 显示 `opts.isFuture` **从未被任何调用方传入**（`chart.js:741` 是它唯一的读取处）。因此选项 B 若按字面实现会抛 `ReferenceError`；即便改写成 `opts.isFuture`，也需先改造调用点传参——方案 §四 清单的 `chart.js` 行（`:237`）未列该调用点改造。
  2. 选项 A（剔除 `(min < 9*60+30 && min >= 9*60)` 判据）在当前 `isFutureTimeline = opts.isFuture || hasNonStockHours` 结构下会**削弱**非 A 股品种的轴判定：由于 `opts.isFuture` 恒为假，`hasNonStockHours` 是唯一通道；剔除后，对「当日数据仅落在 09:00–15:05 之外无点」的品种（如国内期货日盘段 09:00–11:30 / 13:30–15:00 的日盘序列），`hasNonStockHours` 将由真转假，`isFutureTimeline` 退为假 → 落到 `:743-754` 的 **A 股固定网格**（09:30-11:30 + 13:00-15:00），导致 09:00-09:29 的真实分时点被挤出坐标轴、并凭空产生 13:00-13:30 空槽。Round 1 对 P2-1 的验收标准明确要求「期货日仍走数据驱动轴（无回归）」，v2 未给出保障该无回归的判据与用例。
- **期望行为**：§3.2.1 应给出**唯一**、可直接落地且不改变非 A 股行为的方案：推荐把资产类型由调用方显式传入（`chartRowController.js:288` 已具备 `isFutureCode(code)`，见 `:144`），在 `chart.js` 内以 `opts.isFuture`（或 `opts.assetType`）判定，并同步把该调用点改造写入 §四 清单；若坚持选项 A，必须说明被剔除判据的替代来源，并给出期货/港股/美股分时轴的无回归判据。
- **根因**：方案只锁定「判据怎么改」，未核验判据所在函数的入参可获得性（`inst`/`code`/`opts.isFuture` 均不可得）与既有启发式在非 A 股路径上的承载作用。
- **影响范围**：选项 B 不可实现；选项 A 可能使国内期货（及任何日盘段不外溢 15:05 的品种）分时图退化为 A 股固定网格（丢点、错位空槽）；而 §5 无任何非 A 股分时轴用例，M4 仅覆盖 A 股，故该回归在验证矩阵中不可见。
- **复现方法 / 运行证据**：`grep -rn "isFuture" src/ tests/` 输出中，`chart.js` 仅 `:741`、`:835` 使用，其余均为期货业务代码，**无任何调用点构造该 opts**；`chartRowController.js:288-291` 的 opts 字面量为 `{ theme, height }`；`chart.js` 顶部 import 仅有 `lightweight-charts` 与 `./time.js`（无 `isFutureCode`）。
- **修复建议**：§3.2.1 收敛为单一方案：`chartRowController.js:288` 传入 `isFuture: isFutureCode(code)`（该函数已在 `:144` 求值），`chart.js:741` 改为 `const isFutureTimeline = opts.isFuture === true || hasNonStockHours;`，并把调用点改造写入 §四 清单；同时明确 `hasNonStockHours` 是否继续保留为兜底（若保留，须说明其与 A 股竞价点共存时的取值）。
- **修复后验收标准**：文档中每个改动点均有明确的数据来源；实现后含 09:18 点的 A 股分时走固定网格（`displayTimes` 为网格长度），且期货/港股/美股分时仍走数据驱动轴（`displayTimes` 为数据点数），并有对应断言与变异。

---

### P2-4 验证矩阵判别力缺口：§5.1(5) 的「0 次播报」由空 `eligibleCodes` 平凡满足，无法杀死 M5；缺非 A 股分时轴回归用例；§5.1(4) 的期望长度与 §3.2.2 网格不一致

- **严重级别**：P2
- **文件与行号**：方案文档 §5.1(4)（`:256-258`）、§5.1(5)（`:259-261`）、§5.2 M4（`:270`）、§5.2 M5（`:271`）、§3.2.2（`:166-175`）、§3.3.3（`:215-226`）
- **触发条件**：按 §5 实施验证。
- **实际行为（缺口）**：
  1. **M5 无判别力**。§5.1(5) 的断言为「09:25 之后再传入相同报价，断言恢复去重（只播报 0 次），绝不发生重复播报」。但按 v2 方案，09:25-09:30 的 `eligibleCodes` 为空（P1-1 实跑证据），`speakCodes([])` 恒不发声——**正确实现与 M5 变异（`spoken: null`）都得到「0 次播报」**；到 09:30 `startTimer()` 又 `memory.clear()`，记忆基线内容同样不影响输出。因此 M5 声称的「09:25 重复播报相同价格，确定性转红」在两个窗口内均无观测效应，**不具备确定性杀红能力**。要杀死 M5 必须把断言对象改为记忆内容本身（如广播后 `controller.inspect().memory`），而方案未如此规定。
  2. **无非 A 股分时轴回归用例**。§5.1(4) 只覆盖 A 股含竞价点的场景，M4 亦只「还原 `hasNonStockHours`」；P2-3 指出的期货/港股/美股分时轴退化（`opts.isFuture` 恒假 + 判据剔除）无任何用例或变异覆盖，无法在下一轮证伪「无回归」。
  3. **§5.1(4) 期望长度不可判定**。§5.1(4) 断言「`displayTimes` 长度保持为固定网格（09:15-11:30 + 13:00-15:00）」，而 §3.2.2 给出的网格是 `[9,15,9,25] + [9,30,11,30] + [13,0,15,0]`（即 09:15-09:25 与 09:30-11:30、13:00-15:00，09:26-09:29 为空档），两者相差 4 个槽位（253 vs 257），§3.2.2 第 2 条「保留静态空档格位」也未给出该空档是否计入 `displayTimes`。断言未给确切期望值，实现者无法据以判定通过/失败。
- **期望行为**：每条修复路径都有**可分别证伪**的用例与变异，且断言的输入、观测对象与期望值唯一确定；变异「必定变红」的断言在实跑中可确定性复现。
- **根因**：v2 补齐了用例数量（5 条）与变异数量（M1~M5），但用例 5 的观测对象选在了「因门禁而恒空」的输出面（可观测性缺口），用例 4 未覆盖本方案新引入判据的既有承载路径，期望值亦未与 §3.2.2 的网格定义对齐。
- **影响范围**：P2-2 的记忆基线修复即使完全未实现（`spoken: null` 原样保留），§5 仍会全绿；§3.2.1 的非 A 股回归同样可逃逸——即「实现缺失仍全绿」的盲区在 v2 中依然存在（与 Round 1 P2-4 同类）。
- **复现方法 / 运行证据**：P1-1 的实跑输出（09:25-09:29 `eligibleCodes=[]`、`timerShouldRun=false`）直接决定 5.1(5) 在正确实现与 M5 下同为 0 次播报；`startTimer()` 的 `memory.clear()`（`voiceController.js:67`）经实跑确认会把基线清空（见 P1-1 证据）；§3.2.2 网格与 §5.1(4) 期望值的槽位差由 `chart.js:744-753` 的闭区间循环 `for (let minute = start; minute <= end; minute++)` 直接推算。
- **修复建议**：
  1. 5.1(5) 增补**记忆内容断言**（广播后 `memory.get(code).price/percent` 等于该次播出值）作为 M5 的杀红依据，并在 §5.2 M5 的「证伪判定标准」中改写为「memory 未被写入，断言 `memory` 期望值失败」；
  2. §5.1 增补非 A 股分时轴用例（期货日盘序列 + 港股/美股），并配对应变异（如把 `opts.isFuture` 改回恒假）；
  3. §5.1(4) 给出确切期望长度与空档是否计入 `displayTimes`，与 §3.2.2 的网格定义逐项对齐（或统一网格边界）。
- **修复后验收标准**：M1~M5 每项均给出「变异后实跑输出」对照（含 memory/`displayTimes` 的具体值），且正确实现下全部用例绿、对应变异下确定性红；§5.1 的每条期望值均可由文档给出的网格/契约唯一推出。

---

### P3-1 §3.2.3 第 2 条只声明「09:26-09:29 不改写 09:25 撮合点」的期望，未给出判定机制，按其现状该点仍会被覆写

- **严重级别**：P3
- **文件与行号**：方案文档 §3.2.3 第 2 条（`:190-193`）、§四 清单 `kline.js`/`_isContinuousTradingMinute` 行（`:238`）；代码 `src/js/kline.js:508-514`（`_isContinuousTradingMinute`）、`:523-545`（`_correctLastIntradayPoint`）、`:554-558`（调用点：非交易分钟一律走 `_correctLastIntradayPoint`）
- **触发条件**：按 §3.2.3 第 1 条把 `_isTradingMinute` 扩展为含 `09:15-09:25`（`minutes <= 9*60+25`）后，北京时间 09:26:00-09:29:59 有实时报价到达。
- **实际行为**：09:26-09:29 时 `_isTradingMinute` 为假 → 走 `_correctLastIntradayPoint(items, quote, nowMinute)`；此时 `nowMinute(≥1566) >= lastTime(09:25=1565)` 且 `quote.price` 与末点不同 → 该函数会把 09:25 点的 `close/price/percent/avgPrice` 覆写为 09:26-09:29 的报价。方案第 2 条只写了期望（「静默期内不改写 09:25 开盘撮合点」），未给出判定机制（例如「末点为 09:25 撮合点时跳过修正」或为 `_correctLastIntradayPoint` 增加竞价点保护），§四 清单亦仅把该职责挂在 `_isContinuousTradingMinute` 一行上，未落到 `_correctLastIntradayPoint` 的改动。
- **期望行为**：文档明确「09:25 撮合点是否允许被静默期报价覆写」的机制落点（改哪个函数、判据是什么），使实现与验收可判定。
- **根因**：v2 回应了 Round 1 的「方案未就 09:25 撮合点是否允许被覆写表态」，但只补了结论、未补落点。
- **影响范围**：09:25 开盘集合竞价撮合价在 09:26-09:29 被后续报价覆盖（用户看到的开盘撮合点失真）；该项无对应判别用例。
- **复现方法 / 运行证据**：源码路径直接可读（`kline.js:554-558` → `:523-545`），末点时间与 `nowMinute` 的比较条件 `nowMinute < lastTime`（`:526`）在 09:26-09:29 不成立，故修正分支必然执行。
- **修复建议**：§3.2.3 第 2 条补充机制落点（目标函数 + 判据），并同步 §四 清单对应行；在 §5 增补「09:26-09:29 传入不同报价后 09:25 点不变」用例与变异。
- **修复后验收标准**：实现后 09:25 撮合点的 `close` 在 09:26-09:29 的报价下保持不变，并有断言与变异覆盖。

---

## 三、待确认风险与未验证项

1. **未验证项：上游 09:15-09:25 分时数据可得性（Round 1 未验证项 4，v2 未补前提说明）**。§3.2.3 放行竞价分钟的前提是 `applyLiveQuoteToIntraday` 能产生首点，但该函数在 `items` 为空时于 `kline.js:548` 提前返回；若上游不提供竞价分钟点且用户此时刚打开图表，Feature 2 的竞价曲线仍不可见。本轮无网络样本，无法验证。**残余风险**：竞价段可见性依赖上游数据，方案未声明该前提。
2. **未验证项：TTS 队列按 code 合并对「严格按 interval 全量播报」的削弱（Round 1 待确认风险 3，v2 未表态）**。`src/js/tts.js:123-130` 对同 code 的非队首排队项做替换并以 `'replaced'` 终结；多标的或 interval 短于单条播报时长时实际节奏低于设定 interval。§3.3.1 仍使用「严格按照设定的 interval 准时全量播报」的绝对表述。是否为已知限制需方案表态。
3. **未验证项：真实浏览器/TTS 设备下的 09:30 `startTimer()` 时机**。本轮以注入式假定时器与假 speech 适配器复现控制流，未验证真实 Web Worker tick 与 `checker`（30s）在跨会话切点的实际触发顺序；P1-1 的「09:25-09:30 静音 + 09:30 清空记忆」结论在定时器被驱动的前提下成立（`applySchedule` 至迟 30s 内触发一次）。**残余风险**：若产品侧存在其他调用 `startTimer`/`resetMemory` 的入口，需以真机复核。

---

## 四、推荐修复顺序与复审验收标准

**推荐修复顺序**：

1. **P1-1**（使能窗口与会话窗口对齐）→ 决定 Feature 3 在 09:25-09:30 是否可用，并决定 P2-2 的记忆基线是否有观测面。
2. **P2-1**（使能豁免的改动点与调用面）→ 与 P1-1 同源，必须一并定稿（含数据刷新是否同步豁免）。
3. **P2-2**（品种隔离契约）→ 决定 P1-2 的跨品种隔离是否真正水密；同时明确 §3.1.3 的品种作用域。
4. **P2-3**（分时轴判据的可落地性）→ 决定 §3.2.1 是否能不改动非 A 股行为地实现。
5. **P3-1**（09:25 撮合点保护机制）。
6. **P2-4**（验证矩阵）→ 在上述各项定稿后重写，确保每条修复路径均有可分别证伪的用例与确定性杀红变异。

**复审验收标准**：

- 语音使能方案给出**唯一的时段边界**，与 `getMarketSession` 的会话边界（09:15-09:30）对齐；09:20、09:25、09:29 的 `eligibleCodes`/`timerShouldRun` 在 `autoStartAuction=false` 下均有明确期望值，并与 §3.3.2/§3.3.3 的表述一致。
- 每处改动点均落在具备所需数据的函数上，并列出**函数签名变更与受影响调用点清单**（`marketSession.js`、`kline.js`、`chart.js`、`chartRowController.js`、`tts.js`），说明与既有门禁/契约（数据刷新复用、`applyLiveQuoteToKline` 入参、`formatQuoteSpeech` 返回契约、`hasNonStockHours`/`opts.isFuture` 判据）的交互。
- 品种隔离给出**显式资产来源与 fail-closed 语义**，并保证港股/美股/国内/国际期货日K极值不受影响；§3.1.3 与 §四 清单的作用域标注与 §5.1(3) 断言一致。
- 记忆基线的生命周期与 `startTimer()` 的 `memory.clear()` 的交互被显式说明；P2-2 的修复具有可观测断言。
- §5 的每条用例给出输入、观测对象与**唯一期望值**；每条变异提供变异前后实测对照，且「必定变红」可在实跑中确定性复现（尤其 M4/M5 与非 A 股分时轴回归）。
- 上述 P1/P2/P3 全部闭环，且不引入新的连带回归（非 A 股日K与期货分时轴、数据刷新节奏）。
