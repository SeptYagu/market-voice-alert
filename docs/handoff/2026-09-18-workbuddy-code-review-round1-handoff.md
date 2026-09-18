# 独立代码审查报告（Round 1 复查）— 集合竞价日K下影线消除 / 分时图集合竞价纳入 / 语音播报时段去重方案

日期：2026-09-18
类型：独立代码审查（技术方案与根因分析审查，纯文档 diff）
结论：**未通过**（2×P1 + 4×P2，最高严重级别 P1）

---

## 一、审查基本信息与通过项简述

- 被审 HEAD：`96873471b549f96157564934f60475d7c230f411`（父提交 `ad0c6095b96b8fe8f11d035748b5e1a5282b1512`，`origin/main` 与本地 HEAD 一致，工作区干净，无历史重写）
- **提交号元数据不一致（须记录）**：任务书给出的待审提交 `9687347a83d7aa39efb972e35a111a43a07a1c0d` 在仓库中**不存在**（`git cat-file` 报 could not get object info）。实际 HEAD 短 SHA `9687347`、提交信息「docs: 交付集合竞价日K下影线消除、分时图纳入与语音时段去重设计方案 (Round 1 审查前)」、父提交等于基准 SHA —— 三项独立证据均指向同一提交，判定任务书全 SHA 为元数据笔误，本轮审查对象即上述实际 HEAD。审查未做任何 checkout/reset/rebase/合并。
- 实际审查范围：`ad0c609..9687347` = 3 文件 / +226 −1（`STATUS.md`、`docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md`、`docs/handoff/INDEX.md`），全为文档，按纯文档专项规则审查。
- 通过项简述：需求 1/2/3 均有对应方案段落，无遗漏项；被引用的代码行号与 HEAD 一致（`kline.js:475-477`、`494-496`、`508-514`；`chart.js:744-754`；`voiceController.js:35`；`chartRowController.js:386-399` 均逐行核对无误）；Bug 1 根因（`Math.min` 单向锁定）与 Bug 2 根因（`_isContinuousTradingMinute` 拦截致增量点被丢弃）经独立运行实测确认成立；设计的三段式时段划分（09:15-09:20 / 09:20-09:25 / ≥09:25）与 A 股集合竞价规则一致，且与既有 `chinaStockStrategy.getIntradaySessionRanges() = [[555,690],[780,900]]`（起点 09:15）自洽。
- 独立验证：已运行 3 组探针共 6 项场景（含真实 `applyLiveQuoteToKline`/`applyLiveQuoteToIntraday`/`decideVoiceSchedule`/`createVoiceController`/`createIntradayChart`），并逐条追读改动涉及的 6 个调用链；其中 4 项成功构造反例（详见缺陷清单），2 项与预期一致（Bug 1/Bug 2 根因成立）。

---

## 二、审查发现与缺陷清单

### P1-1 语音方案遗漏「时段使能门禁」：默认配置下 09:15-09:25 完全不播报，Feature 3 不可达

- **严重级别**：P1
- **文件与行号**：
  - 方案文档 `docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md:94-99`（§2.3 根因）、`:168-178`（§3.3.1）、`:193`（§四 改动清单 voiceController 行）、`:207-210`（§5.1(3)）、`:213`（变异 M1）
  - 未覆盖的真实门禁：`src/js/marketSession.js:43-55`（`isVoiceAllowedInSession` → `isAutoRefreshAllowedInSession`，`opening-auction` 返回 `!!cfg.autoStartAuction`）、`:117-120`（`chinaStockStrategy.isVoiceAllowed`）、`:298-304`（`getVoiceEligibleCodes`）、`:9-14`（`DEFAULT_SMART_SCHEDULE.autoStartAuction = false`）
  - 未覆盖的调度链路：`src/js/services/voiceSchedule.js:10-12`、`:18`、`:38`（`timerShouldRun: !!enabled && allowed`）；`src/js/controllers/voiceController.js:60-63`、`:68-69`
- **触发条件**：北京时间 09:15:00–09:29:59（`getMarketSession` 返回 `'opening-auction'`）、标的为 A 股股票、`settings.smartSchedule.autoStartAuction === false`（默认值）、语音已启用（含用户手动开启 `settings.enabled = true`）。
- **实际行为**：`getVoiceEligibleCodes` 返回 `[]` → `decideVoiceSchedule.allowed = false` → `timerShouldRun = false` → `speakSubscribed` 永不被调度（`startTimer` 在 `!d.timerShouldRun` 时直接 `return`）。此时**即使按方案把 `speakCodes` 的 `dedupe` 改为按时段置 `false`，也不会有任何播报发生**。
- **期望行为**：语音启用时，09:15-09:20 受「相同报价不重复播报」约束；09:20-09:25 无条件按设定 interval 全量播报；≥09:25 恢复约束。
- **根因**：方案把 Feature 3 的根因单一归结为 `voiceController.js:35` 的 `dedupe` 开关「缺乏时序感知」，未识别真正的前置门禁是**会话级语音使能**（`opening-auction` 段被 `autoStartAuction` 开关拦截）；§四 改动清单只列 `src/js/controllers/voiceController.js:speakCodes`，未涉及 `marketSession.js` / `services/voiceSchedule.js`。方案隐含假设了 `autoStartAuction = true`，但从未声明该前提，也未说明默认配置下的不可用性。
- **影响范围**：Feature 3 在默认配置（及用户手动开启但未启用自动竞价播报的配置）下 100% 不可用，09:15-09:25 全程静音；§5.1(3) 若按真实调度链路编写将必然失败。
- **复现方法 / 运行证据**（真实模块实跑，非复述方案）：

  ```
  session: opening-auction | eligibleCodes: []
  timerShouldRun: false | pauseReason: closed
  ```
  对照（`autoStartAuction=true`）：`eligibleCodes: ["sh603533"] | timerShouldRun: true`

  调用：`decideVoiceSchedule({ codes:['sh603533'], settings:{enabled:true, interval:10000, skipUnchanged:true, smartSchedule:{enabled:true, autoStartAuction:false, ...}}, now: 2026-09-18T09:22:00+08:00, tradingDates:['2026-09-18'] })`。

- **修复建议**：在方案中显式定义 09:15-09:25 的使能策略与改动点，二选一并写明交互：① 在 `isAutoRefreshAllowedInSession`（marketSession.js:47-55）为 `opening-auction` 增加子时段分支：`09:20-09:25` 无条件使能（不受 `autoStartAuction` 约束）、`09:15-09:20` 依赖既有开关；② 为语音定义与「自动刷新」解耦的独立会话判据，并在 §四 清单中列入 `marketSession.js` / `voiceSchedule.js`。同时明确 `settings.enabled=false`（用户主动关闭）时的优先级。
- **修复后验收标准**：在 `autoStartAuction=false` 且 `settings.enabled=true` 下，09:22 的 `decideVoiceSchedule(...).timerShouldRun === true` 且 `eligibleCodes` 含订阅标的；09:16 同样使能（但受去重约束）；09:31 恢复正常会话判据。

---

### P1-2 日K盘前守卫无品种区分机制：按方案字面实现将令港股/美股/国际期货日K影线失真

- **严重级别**：P1
- **文件与行号**：
  - 方案文档 `:108-122`（§3.1.1「在北京时间 09:25:00 之前（A股股票品种）」）、`:124-128`（§3.1.2 改动点）、`:190`（§四 清单 kline.js 行）
  - 目标函数与调用点：`src/js/kline.js:454`（`applyLiveQuoteToKline(items, quote, period)`）、`:466-488`、`:491-496`；`src/js/controllers/chartRowController.js:123`、`:396`（**均无任何品种分支**）；分发入口 `src/js/app.js:1350-1366`（遍历 `state.expandedCodes`，无 A 股过滤；同函数 `:1334` 显式 `isFutureCode(code)` 分支已证明期货标的在同一 code 集合中）
  - 品种会话定义（证明这些时段为真实交易）：`src/js/marketSession.js:234-283`（globalFutures）、`:160-196`（hk）、`:198-232`（us）
- **触发条件**：对港股/美股/国际期货的日K执行实时报价合并，且当前北京时间落在 `00:00:00–09:24:59`。
- **实际行为**：方案给出的守卫判据是**纯时间判据**「北京时间 09:25:00 之前」，而 `applyLiveQuoteToKline` 的签名中不含 code / 资产类型，调用点亦无品种分发。实测该判据在下列**真实交易时段**判定为真（即会被误当作 A 股盘前集合竞价）：美股夜盘 00:00–04:00（北京）；CME 国际期货 06:10（北京）；SGX A50 日盘 09:05（北京）；HKFE 恒指日盘 09:20（北京）。
- **期望行为**：盘前守卫**仅**作用于 A 股 09:15-09:25 集合竞价；港股、美股、国际期货的真实成交极值累计不受影响。
- **根因**：方案仅以括注声明「（A股股票品种）」的意图，既未给出获取资产类型的途径（现有函数无入参、调用点无分支），§3.1.2 改动点与 §四 清单也未包含新增入参或品种分发；§3.1.2 的「全类型 A 股标的均受到同等保护」只覆盖 A 股子类，未声明对非 A 股类别的排除。
- **影响范围**：若字面实现，港股/美股/国际期货日K的 `high/low` 将退化为「仅最新价」，影线逐 tick 归零；影响项目已落地的 10 个国际期货品种（`GL_CL0`/`GL_GC0`/`GL_SI0`/`GL_HG0`/`GL_NG0`/`GL_NQ0`/`GL_ES0`/`GL_YM0`/`GL_A50`/`GL_HSI`）及港股/美股标的。
- **复现方法 / 运行证据**：
  1. 判据分类实测：`beijingMin=120 (北京 02:00) → true`、`370 (06:10) → true`、`545 (09:05) → true`、`560 (09:20) → true`；对照 A 股连续竞价 `600 (10:00) → false`。
  2. 函数上下文实测：`applyLiveQuoteToKline.length = 3`（`items, quote, period`）——无品种信息可用。
  3. 后果实测（美股标的、北京 21:31–21:34 四个真实 tick，真实区间 98.00–103.00）：现行实现 `high=103, low=98`（正确）；按方案字面守卫实现 `high=100.5, low=100.5`（上下影线全失）。
- **修复建议**：在方案中显式定义守卫的适用范围与实现途径（择一）：① 为 `applyLiveQuoteToKline` 增加 `code` / `assetType` 入参，由 `chartRowController.js:123`、`:396` 传入，守卫仅对 `ASSET_TYPES.STOCK_CN` 生效；② 复用 `resolveSessionStrategy(code)` 的会话判据（如 `getMarketSession` / `isTradingNow` / `getIntradaySessionRanges`）替代硬编码 09:25。并在 §5 增补非 A 股回归用例。
- **修复后验收标准**：以 `GL_HSI`/`GL_A50`/美股/港股标的为输入的日K合并用例中，盘前守卫不介入，当日 bar 的 `high/low` 等于实际 tick 区间；A 股 `sh603533` 09:18 跌停反例仍被守卫拦截。

---

### P2-1 分时图时间轴扩展方案不生效：`hasNonStockHours` 会旁路固定网格分支

- **严重级别**：P2
- **文件与行号**：`src/js/chart.js:732-741`（`hasNonStockHours` / `isFutureTimeline`）、`:743-754`（固定网格分支）、`:755`（`displayTimes` 取值）；方案文档 `:70-75`（§2.2.1）、`:134-145`（§3.2.1）、`:192`（§四 清单 chart.js 行）
- **触发条件**：A 股标的当日分时数据中存在任意 09:15-09:25 点（即方案实施后的正常态）。
- **实际行为**：`hasNonStockHours` 判据为 `(min < 9*60+30 && min >= 9*60)`，覆盖 09:00:00–09:29:59，因此**任意一个 09:15-09:25 点即置 `true`** → `isFutureTimeline = true` → `:743` 的 `if (date && !isFutureTimeline)` 不成立 → `timeline` 保持空数组 → `:755` 的 `displayTimes` 退化为 `byTime` 数据驱动时间轴。结果是 §3.2.1 对 `:744` 数组的改动**成为死代码**，「时间轴网格调整为包含集合竞价段 / 底部刻度标记 09:15、09:25」的目标不成立。
- **期望行为**：09:15-09:25 纳入固定网格时间轴（与 `chinaStockStrategy.getIntradaySessionRanges()` 的 `[[555,690],[780,900]]` 一致），09:25→09:30 的 5 分钟空档保留为格位。
- **根因**：方案只考虑了「网格数组 + 采集放行」两处改动，未识别 `hasNonStockHours` / `isFutureTimeline` 这一既有耦合——该启发式把「存在 09:00-09:30 数据」等同于「非股票时间轴」。
- **影响范围**：时间轴退化为数据驱动后，无成交分钟被省略（格位缺失）、09:25→09:30 的 5 分钟间隙与 1 分钟同宽（轴非线性）、缺数区段被压缩；与 §3.2.1 声明的刻度目标不符。
- **复现方法 / 运行证据**（jsdom + 真实 `createIntradayChart`，以 `_getDisplayVolumeData().length` 观测 `displayTimes`）：
  ```
  axis slots WITHOUT auction point: 242  (fixed 09:30-11:30 + 13:00-15:00 grid)
  axis slots WITH    auction point: 3    (collapses to data-driven timeline)
  => fixed grid branch bypassed once a 09:15-09:25 point exists: true
  ```
- **修复建议**：§3.2.1 补充对 `chart.js:732-739` 的同步改造：将 09:00-09:30 从「非股票时段」判据中排除（例如把下界放到开盘集合竞价之后，或直接以 `resolveSessionStrategy(code).getIntradaySessionRanges()` 判定），使 A 股日仍走 `:743-754` 固定网格。
- **修复后验收标准**：含竞价点的 A 股分时 `displayTimes` 长度等于固定网格分钟数（09:15–11:30 与 13:00–15:00），且 09:25 与 09:30 之间存在空档格位；期货日仍走数据驱动轴（无回归）。

---

### P2-2 「记忆基线平滑衔接」在当前契约下不可实现，09:25 会出现重复播报

- **严重级别**：P2
- **文件与行号**：`src/js/tts.js:239-254`（`formatQuoteSpeech` **返回字符串**）、`:262-285`（`formatQuoteSpeechDelta` 返回 `{text, spoken}`）；`src/js/controllers/voiceController.js:41-43`（`dedupe=false` 分支硬编码 `spoken: null`）、`:48-52`（`onSpoken` 守卫 `reason === 'end' && result.spoken`）、`:54-56`；方案文档 `:180-182`（§3.3.2）、`:193`（§四 清单 voiceController 行）
- **触发条件**：09:20-09:25 按方案强制 `dedupe=false` 播报后进入 ≥09:25 恢复去重模式，且期间价格相对「上一次去重播报」发生变化。
- **实际行为**：`dedupe=false` 分支产出 `{ text: formatQuoteSpeech(...), spoken: null }`，`onSpoken` 的守卫恒假 → `memory` **不会被写入**。09:25 后首轮去重播报以 09:20 之前的陈旧基线做差量比对。
- **期望行为**：§3.3.2 要求「每次播报完成后将当前播出的最新价格同步记录至 memory」，使 09:25 恢复去重时以刚播报过的价格为基准，既不重复也不静默。
- **根因**：方案把「记忆基线衔接」当作行为约定写入 §3.3.2，但现有 `formatQuoteSpeech` 只返回文本、`dedupe=false` 分支的 `spoken` 被硬编码为 `null`，且 §四 改动清单既未列入 `tts.js`，也未给出任何显式的 memory 写入；该约定在当前接口契约下无法实现。
- **影响范围**：09:25 开盘瞬间可能对同一价格重复播报（实测），与「平滑恢复约束」的需求相悖；若 09:20-09:25 价格未变则侥幸不显。
- **复现方法 / 运行证据**（真实 `createVoiceController` + 假 speech 适配器，`onSpoken('end')` 正常回调）：
  ```
  after forced full broadcast at 09:22 -> spoken: ["掌阅科技，20.00 元，持平"]
  memory size after forced full broadcast: 0 | memory: []
  at 09:31 same price -> spoken again: ["掌阅科技，20.00 元，持平"] (duplicate because baseline was never seeded)
  ```
- **修复建议**：在方案中给出可实现的记忆写入途径（择一并计入改动清单）：① 让 `formatQuoteSpeech` 一并返回 `{ text, spoken }`（复用内部 `_buildSegments`，改动 `tts.js`）；② 在 `speakCodes` 的 `dedupe=false` 分支用 `buildQuoteSpeechSegments(quote)` 构造 `spoken` 并赋给 `result.spoken`；③ 在 09:25 切换点显式 `memory.set`。同时说明与 `seedsMemoryWithoutPlayback`（voiceController.js:20）及 legacy 适配器的关系。
- **修复后验收标准**：09:22 强制播报（`onSpoken('end')`）后 `memory.get(code).price` 等于该次播出价格；09:31 同价在 `skipUnchanged=true` 下不发声，变价则发声。

---

### P2-3 日K「追加分支」在 ≥09:25 且官方 Bar 未入库时仍消费外部脏 `quote.low`

- **严重级别**：P2
- **文件与行号**：`src/js/kline.js:472-489`（`lastDate < targetDate` 追加分支，`:476` `lowCandidates = [quoteLow, price, open]`）、`:491-496`；方案文档 `:46-56`（§2.1.2 引用 `475-477`）、`:113-122`（§3.1.1 item 2 以「官方日K数据已包含官方 Bar 时」为前提）、`:124-128`（§3.1.2 只描述「针对今日已存在 Bar 的场景」）、`:190`
- **触发条件**：北京时间 ≥09:25，且 `fetchKline` 返回的日K最后一根仍非今日（`lastDate < targetDate`，官方当日 Bar 尚未入库或命中滞后缓存），同时外部快照 `quote.low` 仍携带集合竞价虚拟极值。
- **实际行为**：落入追加分支后，新 Bar 的 `low = Math.min(quoteLow, price, open)` 直接采纳外部脏 `quote.low`；随后原地分支（按方案改为仅由 `price` 驱动）无法回退，脏 low 被永久固化。
- **期望行为**：§3.1.1 item 2 的「禁止使用外部未经清洗的 `quote.low` / `quote.high` 执行覆盖或 `Math.min/max`」应对**所有会写入今日 Bar 的路径**生效，包含追加分支。
- **根因**：方案的守卫被拆成「<09:25 时间守卫」与「官方 Bar 已存在时的原地更新保护」两段，两段之外（≥09:25 且官方 Bar 未入库）无任何规则；§2.1.2 已把 `475-477` 列为根因引用，但 §3.1.2 与 §四 清单均未把追加分支纳入改动。
- **影响范围**：Bug 1 的目标缺陷在该路径下仍可复现；且由于方案后原地分支不再读取 `quote.low`，污染一旦落入即不可逆（对比现行实现同样不可逆，但方案的「彻底消除」承诺不成立）。
- **复现方法 / 运行证据**（真实 `applyLiveQuoteToKline`）：
  ```
  after 09:18 dirty low=18 bar.low = 18                 # 追加分支直接采纳 quoteLow=18.00
  after 09:19 recovery price=20 bar.low = 18 (locked)   # Math.min 不可逆
  after official in-place merge bar.low = 18            # 官方 low=20.1 亦无法回退
  ```
- **修复建议**：把脏 `quote.low/high` 的隔离规则同时施加于追加分支：A 股今日临时柱按 §3.1.1 item 1 的「仅反映最新参考价」构造（不做跨源取极值）；或在官方 Bar 缺席时禁止由外部 `quote.low/high` 驱动极值。并在 §5 增补「官方 Bar 未入库 + 脏 `quote.low`」用例与对应变异。
- **修复后验收标准**：在官方 Bar 缺席、外部 `quote.low` 为虚拟跌停价的场景下，今日 Bar 的 `low` 不等于该脏值；且用户打开图表后 a 股临时柱在价格回升时影线即时回弹。

---

### P2-4 验证矩阵判别力/变异杀伤力缺口：无法分别证伪三条修复路径

- **严重级别**：P2
- **文件与行号**：方案文档 `:201-210`（§5.1 判别力用例）、`:212-215`（§5.2 变异矩阵）、`:207-210` 与 `:213`（用例 5.1(3) 与变异 M1）
- **触发条件**：按 §5 实施验证。
- **实际行为（缺口）**：
  1. §5.1(1) 的断言「今日 Bar 的 `low === 20.00`」在「09:18 跌停 → 09:19 回升至 20.00」场景下，**仅靠盘前时间守卫（§3.1.1 item 1）即可通过**，对 §3.1.1 item 2（官方 Bar 存在时禁止外部 `quote.low/high` 覆盖）零判别力——方案缺「官方 Bar 已入库 + 脏 `quote.low/high`」的用例。
  2. §5 无任何用例覆盖分时轴路径（`hasNonStockHours` / `isFutureTimeline`，见 P2-1），而该路径恰是 §3.2.1 改动的实际生效前提。
  3. 变异 M1「撤销 09:20-09:25 豁免规则，断言用例 5.1(3) 必定变红」不成立：若 5.1(3) 走 `speakSubscribed` 调度链路，默认 `autoStartAuction=false` 下调度器根本不运行（P1-1）；若改走 `speakManual`（`manual=true` 本身即 `dedupe=false`），则无论豁免规则是否存在都不会转红。即 M1 在当前方案下不可执行的杀红断言。
  4. 变异 M2「还原 `Math.min(lastLow, quoteLow)`」的杀红能力不可判定：其依赖 5.1(1) 在「推进至 09:25 正式开盘」一步是否注入脏 `quote.low` 与官方 Bar，方案未给出该步输入。
- **期望行为**：验证矩阵应能**分别**杀死三条修复路径（盘前守卫、权威数据保护、分时轴/调度使能）。
- **根因**：用例场景与改动点未一一对应；变异与「必定变红」的断言缺少「走哪条分支、输入什么」级别的描述。
- **影响范围**：核心修复缺少可证伪的验收证据，存在「实现缺失仍然全绿」的风险（与历史轮次同类盲区一致）。
- **复现方法 / 运行证据**：由 P1-1 的运行证据（`timerShouldRun=false`）确定 5.1(3) 在默认配置下不可执行；由 P2-1 的运行证据（显示轴长度 242→3）确定分时轴无判别覆盖；P2-2/P2-3 的运行证据确定相应路径无用例。
- **修复建议**：为每条修复路径补一条判别力用例并给出对应变异，且在方案中写明用例的输入与断言对象：
  1. ≥09:25、官方 Bar 在库 + 脏 `quote.low/high` → 断言取官方值；变异：放开 `quote.low/high` 覆盖须转红。
  2. 含 09:15-09:25 点的 A 股分时 `displayTimes` 长度 == 固定网格长度；变异：还原 `hasNonStockHours` 判据须转红。
  3. 调度链路级 09:22 连续两轮强制播报（`skipUnchanged=true`）；变异：撤销 09:20-09:25 使能/豁免须转红。
  4. 追加分支（官方 Bar 缺席）脏 low 隔离；变异：还原 `kline.js:476` 的 `quoteLow` 须转红。
- **修复后验收标准**：上述 4 条用例在正确实现下全绿、在对应变异下**确定性转红**，并提供变异前后实测对照。

---

## 三、待确认风险与未验证项

1. **（附带核实，不单独立级）§2.2.2 括注与实现不符**：方案称盘前会「错误修改了昨天收盘的分时点」。实测 `fetchIntraday` 的四条取数路径均经 `_filterIntradaySessions(data, opts.date, code)`（`src/js/api.js:341-357`，调用点 `:435`/`:446`/`:457`/`:473`）按 `selectedDate` 过滤，`applyLiveQuoteToIntraday` 收到的是当日点；独立复现显示被改写的是**当日更早的点**（09:17 点的 close 被 09:18 报价覆写为 22），而非「昨天」收盘点。该括注不影响修复方向，故不单独立级，但建议在下一版方案中更正以免误导实现者。
2. **（附带核实，不单独立级）§2.1.2 代码片段与所标行号不匹配**：方案引用的三行片段（`const lastHigh/const lastLow/updated.high = Math.max(lastHigh, quoteHigh, price)`）实际位于 `kline.js:492-496`（原地更新分支），而所标注的 `475-477` 是追加分支（内容为 `const high = Math.max(price, quoteHigh || 0, open)` 等）。两处**行号本身与 HEAD 一致**，仅片段归属表述有误。
3. **待确认风险：TTS 队列按 code 合并会削弱「严格按间隔播报」**。`src/js/tts.js:123-130` 对同 code 的非队首排队项执行替换并以 `'replaced'` 终结。当 interval 短于单条播报时长（尤其多标的场景），实际播报节奏会低于设定 interval，方案 §3.3.1 的「严格按照设定的 interval 准时全量播报」不可严格保证。此为既有行为、非本方案引入，需确认是否纳入方案目标或显式列为已知限制。
4. **未验证项：上游 09:15-09:25 分时数据可得性**。本轮无网络样本，未验证东财/腾讯分时源是否在 09:15-09:25 提供竞价分钟点。若上游不提供，§3.2 的「09:15-09:25 平滑绘制竞价走势」只能依赖本端实时报价逐分钟生成（而 `applyLiveQuoteToIntraday` 在 `items` 为空时于 `kline.js:548` 提前返回，无法凭空建首点）。需在方案中补该前提说明。**残余风险**：竞价段数据可得性直接决定 Feature 2 的可见效果。
5. **待确认风险：09:26-09:29 是否会覆写 09:25 撮合点**。`applyLiveQuoteToIntraday` 在非 `_isTradingMinute` 时段仍走 `_correctLastIntradayPoint`（`kline.js:556-558`）；方案将 09:25 纳入交易分钟后，该函数会把 09:25 点的 `close` 改写为后续报价。实测已确认该函数会改写最后一点。方案未就「09:25 集中撮合点是否允许被静默窗口报价覆写」表态。需方案明确该行为决策。**残余风险**：撮合点数值被后续报价覆盖。
6. **未验证项：`_isTradingMinute` 边界（`minutes <= 9*60+25`）下一分钟即 09:26-09:29 无点**，用户将看到 09:25 点后至 09:30 之间无点。若属预期可忽略；若期望显示空档格位，需与 P2-1 的网格改造一并说明。

---

## 四、推荐修复顺序与复审验收标准

**推荐修复顺序**（先补齐「方案不可达」与「跨品种回归」，再补机制与验证）：

1. **P1-1**（语音时段使能门禁）→ 决定 Feature 3 是否可达，并直接影响 P2-4 中 M1 的可执行性。
2. **P1-2**（盘前守卫品种区分）→ 决定 Bug 1 修复是否会引入跨品种回归。
3. **P2-3**（追加分支脏 low 隔离）→ 与 P1-2 同属 `applyLiveQuoteToKline` 改动，宜一并设计。
4. **P2-1**（`hasNonStockHours` 耦合）→ 决定 Feature 2 的时间轴目标是否真正生效。
5. **P2-2**（记忆基线写入途径）→ 补齐 §3.3.2 的可实现性。
6. **P2-4**（验证矩阵）→ 最后定稿，确保上文每条修复均有对应判别力用例与变异杀红。

**复审验收标准**（下一轮需逐条提供可复现证据）：

- 方案文档给出的每处改动点均落在**具体文件与函数**上，并说明其与既有门禁/契约（`marketSession.js` 会话使能、`applyLiveQuoteToKline` 入参、`formatQuoteSpeech` 返回契约、`hasNonStockHours` 判据）的交互关系。
- 各缺陷对应的修复项均给出：触发条件、改动位置、旧行为→新行为对照。
- 验证矩阵对三条修复路径分别具备判别力用例，且每条用例配套的变异「必定变红」断言可在实跑中确定性复现（提供变异前后对照数据）。
- 上述 4 条缺陷（2×P1 + 2×P2，含 P2-1/P2-2）全部闭环，且不引入新的连带回归（尤其非 A 股日K与期货分时轴）。
