# 独立代码审查报告（Round 3 终审复查）— 集合竞价日K下影线消除 / 分时图集合竞价纳入 / 语音播报时段去重方案 v3 定稿

日期：2026-09-18
类型：独立代码审查（技术方案与根因分析审查，纯文档 diff）
结论：**未通过**（1×P1 + 3×P2 + 1×P3，最高严重级别 P1）

---

## 一、审查基本信息与通过项简述

- 被审 HEAD：`f4b7b9236af2363f1b95c9b0e4d3a3ad12e78cbf`（提交信息「docs: 集合竞价行情与播报深度优化方案 v3 终审定稿全面闭环 Round 2 缺陷」，父提交 `e1c9fd9`，`origin/main` 与本地 HEAD 一致，`git pull --ff-only` 后无更新，工作区干净，无历史重写）。基准 `ad0c6095b96b8fe8f11d035748b5e1a5282b1512`；实际审查范围 `ad0c609..f4b7b92` = 5 文件 / +662 −2（`STATUS.md`、`docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md`、`docs/handoff/2026-09-18-workbuddy-code-review-round1-handoff.md`、`docs/handoff/2026-09-18-workbuddy-code-review-round2-handoff.md`、`docs/handoff/INDEX.md`），全为文档，按纯文档专项规则审查；其中本轮增量提交自身为 3 文件 / +157 −171（`git diff c2dc6a2..f4b7b92`）。仓库内无 `docs/review-checklist.md`。
- 通过项简述（Round 2 六项缺陷的实际闭环情况）：**R2-P1-1 真闭环**（实测 `chinaStockStrategy.isVoiceAllowed` 具备 `now` 入参、`09:20-09:29` 判据恒真，配合 `decideVoiceSchedule` 的 `timerShouldRun=!!enabled&&allowed`，09:20→09:31 持续使能；以注入式时钟 + 真实 controller 实测记忆 `[["sh603533",{price:"20.00 元"}]]` 在 09:26、09:31 均未被 `memory.clear()` 清空）；**R2-P2-1 真闭环**（改动落在语音专属且原生具备 `now` 的方法内，零改动 `isAutoRefreshAllowedInSession`，`app.js:1223` 的数据刷新门禁与 `tests/marketSession.test.js:38-48` 契约不受影响）；**R2-P2-2 基本闭环**（签名升级为显式 `code`、两个调用点显式传参、空值前置判断消除 `inferAssetType(undefined)→stock_cn` 的 fail-open）；**R2-P3-1 闭环**（守卫函数与判据明确，实测该缺陷前提成立：09:27 报价确会把 09:25 点 `close` 由 20 改写为 20.2，且 `chartSecondsToTime(09:25 槽位)==='09:25'` 判定可行）；**R2-P2-4 部分闭环**（M5 已具备杀红力：实测 `buildQuoteSpeechSegments(price=20).price==='20.00 元'`、同价去重返回 `{text:"",spoken:null}`、M5 变异下 `memory.get('sh603533')===undefined`；§5.1(4) 的 253 与 §3.2.2 网格一致）。**R2-P2-3 未闭环且新引入 P1-1 回归**。
- 独立验证：以真实模块（`chart.js`/`kline.js`/`marketSession.js`/`services/voiceSchedule.js`/`controllers/voiceController.js`/`tts.js`/`parser.js`/`time.js`）实跑 4 组探针共 30+ 场景，其中 5 项成功证伪方案（详见缺陷清单；`chart.js` 部分采用「逐字复制 + 仅施加方案 §3.2.1/§3.2.2 三处改动」的定向变异副本）。未修改任何产品代码或正式测试，临时探针文件已删除（`git status --porcelain` 空）。

---

## 二、审查发现与缺陷清单

### P1-1 §3.2.1 的 `opts.isFuture === undefined && hasNonStockHours` 使启发式兜底在生产唯一调用点成为死代码 → 港股/美股/国际期货分时轴塌缩为 A 股 253 固定网格，数据点不可见

- **严重级别**：P1
- **文件与行号**：
  - 方案文档：§3.2.1 第 1/2 条（`2026-09-18-call-auction-kline-intraday-voice-handoff.md:119-132`）、§四 `chart.js` 行（`:206`）、§四 `chartRowController.js` 行（`:204`）、§5.1(4)（`:225-227`）、§5.2 M4（`:243`）
  - 代码：`src/js/chart.js:732-741`（`hasNonStockHours` / `isFutureTimeline`）、`:743-756`（`timeline` 网格与 `displayTimes` 选择）、`:835`（`isFutureTimeline ? '昨结' : '昨收'`）
  - 唯一调用点与传参来源：`src/js/controllers/chartRowController.js:288-291`（`mountIntradayChart`，当前仅传 `{theme,height}`）、`src/js/futures/instrument.js:5-7`（`isFutureCode` 恒返回布尔）、`src/js/parser.js:151-173`（`toEastmoneySecId` 支持 `hk*`/`us*`/`GL_*`，即这三族确有分时数据通路）
- **触发条件**：按 §3.2.1/§四 在 `chartRowController.js:288` 传入 `isFuture: isFutureCode(code)`，并把 `chart.js:741` 改为 `opts.isFuture === true || (opts.isFuture === undefined && hasNonStockHours)`。此改动对任何港股（`hk00700`）、美股（`usAAPL`）、国际期货（`gl_HSI`，`isFutureCode('gl_HSI')===false`）标的立即生效。
- **实际行为（真实 `chart.js` 定向变异实跑，`ctl._getDisplayVolumeData().length` = `displayTimes.length`，`plotted` = 落在轴上的数据点数）**：

  ```
  用例                                   输入点数  HEAD(轴/可见)  v3(轴/可见)
  A股 sh603533 含 09:18 竞价点               7       7/7        253/7     ← 目标达成
  A股 sh603533 仅连续时段                    5      242/5       253/5     ← 目标达成
  国内期货 RB0（日盘 09:00 起）               5       5/5         5/5      ← 无回归
  港股 hk00700（09:30-16:00）                6       6/6        253/3    ← 15:30/16:00/12:00 丢失
  美股 usAAPL（北京 21:30-03:00）            5       5/5        253/0    ← 全部点不可见（空图）
  国际期货 gl_HSI（17:00-05:00）             4       4/4        253/0    ← 全部点不可见（空图）
  ```

  即：改动后 `isFutureTimeline` 退化为 `isFutureCode(code)`——A 股/港股/美股/`gl_*` 全部为 `false` → 走 A 股固定网格；非 A 股、非国内期货（`isFutureCode` 为假）的品种其真实分时点被挤出坐标轴，美股与国际期货分时图变为「有轴无点」。
- **期望行为**：方案自身在 §3.1.1 承诺「港股（`stock_hk`）、美股（`stock_us`）、国内期货（`future`）、国际期货（`futures_global`）……守卫绝对不介入！非 A 股……零跨品种误伤」，Round 1 P2-1 的验收标准亦要求「期货日仍走数据驱动轴（无回归）」；§3.2.1 仅论证了「A 股 vs 国内期货」二进制，未覆盖港股/美股/国际期货，实际造成比 Round 2 P2-3 所指更宽的跨品种回归。
- **根因**：把兜底判据写成 `opts.isFuture === undefined && hasNonStockHours` 的**合取项**。唯一调用点在方案落地后必然传入布尔（`isFutureCode` = `!!parseFutureInput(...)`），故 `opts.isFuture === undefined` 恒为假，第二析取项成为**不可达死代码**，`hasNonStockHours` 这个「非 A 股业务时段」的唯一承载通道被整体摘除。正确写法应保留其为**析取兜底**（配合已收窄的下界，A 股竞价点不再误触发），或由调用点给出覆盖全部非 `STOCK_CN` 资产类的显式判定。
- **影响范围**：港股/美股/国际期货分时图数据不可见（美股、`gl_*` 为全量不可见），`isFutureTimeline` 同时决定 `:835` 的昨结/昨收标签与 `:743` 的网格分支，故坐标轴语义一并错误；§5 全无此类用例，回归在验证矩阵中完全不可见（见 P2-3）。
- **复现方法 / 运行证据**：将 `src/js/chart.js` 逐字复制为临时副本，仅施加 §3.2.1 的 `hasNonStockHours` 收窄、`isFutureTimeline` 合取式替换与 §3.2.2 的三区间网格（三处替换各命中 1 次），在 jsdom + `lightweight-charts` 下对同一份 `setData` 调用当前版与变异版并比对 `_getDisplayVolumeData()`；上表为实跑输出。另实测 `isFutureCode` 取值：`sh603533=false`、`hk00700=false`、`usAAPL=false`、`gl_HSI=false`、`RB0=true`。
- **修复建议**：把 `chart.js:741` 改为 `const isFutureTimeline = opts.isFuture === true || hasNonStockHours;`（保留启发式为析取兜底；因 `hasNonStockHours` 下界已收窄至 09:15，A 股竞价点不会再误触发，方案目标不受影响）；或由 `chartRowController.js:288` 传入覆盖全部资产类的显式轴判定（例如 `isFuture: isFutureCode(code)` 之外再判断 `inferAssetType(code) !== ASSET_TYPES.STOCK_CN`），并在 §3.2.1/§四 明列该入参来源。同时在 §5.1 增补港股/美股/国际期货轴用例（见 P2-3）。
- **修复后验收标准**：含 09:18 竞价点的 A 股分时 `displayTimes.length === 253`；港股/美股/国际期货分时 `displayTimes.length === 数据点数` 且全部点为可见值（实测应为港股 6/6、美股 5/5、`gl_HSI` 4/4）；`isFutureTimeline` 仍决定昨结/昨收标签语义正确；对应变异（把 `hasNonStockHours` 从析取式中摘除）确定性转红。

---

### P2-1 §3.3.1 的 `opening-auction` 分支缺失 `if (!cfg.enabled) return true` → 「智能交易时段」关闭时 09:15-09:20 由放行变为拦截（既有契约回归）

- **严重级别**：P2
- **文件与行号**：
  - 方案文档：§3.3.1 第 1 条片段（`...call-auction-kline-intraday-voice-handoff.md:160-170`，`return !!cfg.autoStartAuction;` 直接兜底）、§3.3.1 第 2 条「完全不修改 `isAutoRefreshAllowedInSession` 的签名与逻辑」（`:173`）、§四 `marketSession.js` 行（`:203`）、§5.1(6)（`:231-234`）、§5.2 M1（`:240`）
  - 代码：`src/js/marketSession.js:47-55`（`isAutoRefreshAllowedInSession` 首行 `if (!cfg.enabled) return true;`）、`:43-44`、`:117-120`（现有 `chinaStockStrategy.isVoiceAllowed`）、兄弟策略的既有约定 `:153-156`（`chinaFuturesStrategy`）、`:192-195`（`hkStockStrategy`）、`:228-231`（`usStockStrategy`）均以 `if (!cfg.enabled) return true;` 开头
  - UI 可达性：`src/js/views/voiceBarView.js:210`（`enabled` = 「智能交易时段」开关，`disabled=false` 恒可点）、`:213`（`autoStartAuction` 为「集合竞价自动开始」，其 `disabled = !smart.enabled`）、`:223-224`（既有注释「Independent of the smart schedule: dedup stays operable even when the schedule is off.」）、`src/js/app.js:1067-1075`
- **触发条件**：用户在语音条关闭「智能交易时段」（`smartSchedule.enabled = false`，此时「集合竞价自动开始」被 UI 置灰，`autoStartAuction` 停留在默认 `false`），北京时间 09:15:00–09:19:59。
- **实际行为（真实模块实跑）**：

  ```
  cfg={enabled:false, autoStartAuction:false}  09:17  HEAD=true   v3=false   ← 回归
  cfg={enabled:false, autoStartAuction:false}  09:22  HEAD=true   v3=true
  cfg={enabled:true,  autoStartAuction:false}  09:17  HEAD=false  v3=false
  cfg={enabled:true,  autoStartAuction:false}  09:22  HEAD=false  v3=true   ← 目标达成
  decideVoiceSchedule(09:17, 智能时段关闭) → HEAD: eligible=["sh603533"], timerShouldRun=true
                                          → v3  : eligible=[], timerShouldRun=false（由真值推得）
  ```

  `isAutoRefreshAllowedInSession`（`:49`）以 `!cfg.enabled → true` 表达「智能时段关闭即不再按时段拦截」；方案片段把这一层语义整体绕过，用 `!!cfg.autoStartAuction` 兜底 09:15-09:20，使该配置下 09:15-09:20 的语音由「运行」变为「被拦截（并触发 `stopTimer()`）」。
- **期望行为**：需求 3 明确「`09:15 - 09:20`……受『相同报价不重复播报』按钮约束」，即该窗口应可播报、只是受去重开关约束；「智能交易时段」关闭的既有语义（见 `voiceBarView.js:223-224` 注释及 `:49` 的实现）是**不做时段拦截**，本方案的豁免分支不应改变它。兄弟策略（`:154`/`:193`/`:229`）均先判断 `!cfg.enabled`，本方案成为唯一例外。
- **根因**：把豁免分支从 `isAutoRefreshAllowedInSession`/`isVoiceAllowedInSession`（其结果受 `!cfg.enabled` 保护）迁到 `chinaStockStrategy.isVoiceAllowed`（无此保护）时，只移植了 `opening-auction → autoStartAuction` 这条口径，漏掉了总开关口径。
- **影响范围**：智能时段关闭 + 默认 `autoStartAuction=false` 时，09:15-09:20 五钟窗口语音静音（与需求 3 及既有主开关语义冲突）；09:20 起恢复使能时会再次 `startTimer()`（`voiceController.js:65-67` 首行 `memory.clear()`），此时记忆本为空，无额外危害。该配置在验证矩阵中无用例（§5.1(6) 只覆盖 `enabled=true` 默认组合）。
- **复现方法 / 运行证据**：以真实模块调用 `chinaStockStrategy.isVoiceAllowed(new Date('2026-09-18T09:17:00+08:00'), {enabled:false,autoStartAuction:false}, ['2026-09-18'])` → `true`；`decideVoiceSchedule({codes:['sh603533'], settings:{enabled:true,interval:10000,skipUnchanged:true,smartSchedule:{enabled:false,autoStartAuction:false}}, now: 09:17, tradingDates:['2026-09-18']})` → `eligibleCodes=["sh603533"], timerShouldRun=true`；对同一输入套用方案片段的分支逻辑 → `min=557 ∉ [560,570)` → `return !!cfg.autoStartAuction` → `false`。
- **修复建议**：豁免分支保留总开关前置判断（与兄弟策略同形）：
  ```javascript
  isVoiceAllowed(now = new Date(), cfg, tradingDates = []) {
    const session = getMarketSession(now, tradingDates);
    if (!cfg.enabled) return true;                       // 保持既有总开关语义
    if (session === 'opening-auction') {
      const min = _minutesInBeijing(now);
      if (min >= 9 * 60 + 20 && min < 9 * 60 + 30) return true;
      return !!cfg.autoStartAuction;                     // 等价 isVoiceAllowedInSession(session, cfg)
    }
    return isVoiceAllowedInSession(session, cfg);
  }
  ```
  并在 §3.3.1 说明「总开关口径与原实现一致」，§5.1 增补「智能时段关闭 + 09:17/09:29」用例与对应变异。
- **修复后验收标准**：`smartSchedule.enabled=false, autoStartAuction=false` 下，09:17 与 09:22 的 `eligibleCodes` 均含订阅标的且 `timerShouldRun===true`；`smartSchedule.enabled=true, autoStartAuction=false` 下 09:17 仍为 `[]/false`、09:22 为 `[标的]/true`；对应变异（删除 `!cfg.enabled` 前置）在 09:17 用例上确定性转红。

---

### P2-2 §3.1.2 的「09:25 前预览柱收敛于参考价」未落到追加分支（§3.1.3(1)/§四 落点缺失）→ items 不含今日柱时 Bug 1 仍无法消除，§5.1(1) 断言不可判定

- **严重级别**：P2
- **文件与行号**：
  - 方案文档：§3.1.2（`...call-auction-kline-intraday-voice-handoff.md:98-102`，「若用户在此期间打开日K，今日临时柱收敛于最新参考价」）、§3.1.3 第 1 条（`:105-107`，头部限定「≥09:25」，公式 `open = quoteOpen || price; high = Math.max(open, price); low = Math.min(open, price)`）、§四 `kline.js` 行第 2 项（`:205`，仅写「09:25 前 A 股预览柱不执行 `Math.min`」）、§5.1(1)（`:216-218`）
  - 代码：`src/js/kline.js:454`（签名）、`:470-489`（追加分支，`:476-477` 的 `lowCandidates`/`Math.min`）、`:491-496`（原地更新分支）、`:508-514`
- **触发条件**：A 股、`period='1d'`、北京时间 < 09:25，且 `items` 末柱为昨日（今日柱尚未入库）——这正是 §3.1.2 自述的「若用户在此期间打开日K」场景（`chartRowController.js:386-399` 在 `fetchKline` 后用 `applyLiveQuoteToKline` 合并快照）。此后 09:19 报价回升、09:25 正式撮合。
- **实际行为（真实 `applyLiveQuoteToKline` 实跑；因 A 股盘前 `quote.low` 为 0 被 `_positiveNumber` 过滤，方案 §3.1.3(1) 的公式在此路径上与现有实现等价）**：

  ```
  09:18 追加分支 -> {time:1789689600, open:18, high:18, low:18, close:18, volume:0}
  09:19 原地分支 -> low=18 high=20         // if (price < last.low) 不成立，虚假低点被固化
  09:25 开盘撮合 -> {open:20, high:20, low:18, close:20}
  §5.1(1) 断言 low === 20 -> FAIL (low=18)   // 正是方案要消除的「跌停虚假下影线」
  ```

  即：方案只把「09:25 前不执行 `Math.min(lastLow, ...)`」落到原地分支（§四 的一条自然读法），追加分支的 `Math.min(open, price)` 仍会在 09:18 写死 18.00；其后原地分支的「只由价格突破驱动」规则单调单向，无法回弹，Bug 1 在该路径上原样重现。
- **期望行为**：§3.1.2 要求 09:25 前「今日临时柱收敛于最新参考价：`open = price, high = price, low = price, close = price`」，该规则必须对**创建（追加）与更新（原地）两条路径**同时成立，并在分支分派之前生效；§四 的落地条目应写成「09:25 前 A 股今日柱（含尚未创建时的创建）四个价格字段一律取 `price`，覆盖追加与原地两个分支」，而非仅「不执行 `Math.min`」。同时 §5.1(1) 必须给出 `items` 前置状态（今日柱是否存在），否则同一用例在两种前置下分别通过/失败，用例不可判定。
- **根因**：§3.1.3(1) 用「≥09:25」限定了追加分支公式，§3.1.2 用散文给出 09:25 前规则，§四 的变更清单只摘录了「不执行 `Math.min`」这一半，三者对 09:25 前追加分支的规定不一致/缺失；实现者若以变更清单为准即会写出上述失败序列。
- **影响范围**：用户在 09:25 前打开日K（含切页、切换标的、强制刷新）后，当日日K 会在 09:18 前后固化虚假极值并保留至收盘与后续历史查询，即需求 1「彻底消除」在该路径不成立；§5.1(1) 因未规定前置状态，无法作为判别用例。
- **复现方法 / 运行证据**：真实模块序列——`items=[{time: 2026-09-17 日柱}]`；`applyLiveQuoteToKline(items, {price:18, open:0, low:0, high:0, tradingDay:'2026-09-18', volume:0}, '1d')` → 今日柱 `low=18`；再以 `{price:20, tradingDay:'2026-09-18'}`（09:19）与 `{price:20, open:20, tradingDay:'2026-09-18'}`（09:25）各调用一次 → 末柱 `low=18`（期望 20）。另一组对照证明单向锁死：今日柱存在时 09:18 写入 `low=18` 后，09:19 以 20 更新仍为 `low=18`。
- **修复建议**：§3.1.2 明确「A 股且 `<09:25`：今日柱（不存在则创建）`open=high=low=close=price`，该守卫位于追加/原地分支判别之前，两者均服从」；§3.1.3(1) 与 §四 同步补该条；§5.1(1) 拆成两条用例：① `items` 末柱为昨日（追加路径）② `items` 已含今日柱（原地路径），断言同为 `low === 20.00`。
- **修复后验收标准**：两条用例在真实 `applyLiveQuoteToKline` 下均得末柱 `low === 20.00`（且 09:18 途中任一时刻的临时柱 `low === price`）；对应变异（仅在原地分支实现该守卫、追加分支维持 `Math.min(open, price)`）在追加用例上确定性转红。

---

### P2-3 验证矩阵对分时轴路径零判别力：M4 两个变体各自执行均不转红，且仍无港股/美股/国际期货轴用例 → Round 2 P2-4 第 2 条未闭环

- **严重级别**：P2
- **文件与行号**：方案文档 §5.1(4)（`...call-auction-kline-intraday-voice-handoff.md:225-227`）、§5.2 M4（`:243`）、§3.2.1（`:119-132`）；代码 `src/js/chart.js:741`/`:743-756`、`src/js/controllers/chartRowController.js:288-291`
- **触发条件**：按 §5.2 实施 M4 变异（「还原 `chartRowController.js` 不传 `isFuture`」**或**「还原 `hasNonStockHours` 包含 09:00-09:30」），并以 §5.1(4A/4B) 判定。
- **实际行为（真实 `chart.js` 定向变异实跑）**：
  1. **变体一（不传 `isFuture`）不转红**：`opts.isFuture` 变为 `undefined` → 走合取式第二项，而收窄后的 `hasNonStockHours` 对 A 股（09:18 → `min=558`，`558 < 555` 为假；`≥905` 为假；`<540` 为假）恒为 `false` → 仍走 253 固定网格。实测 A 股 253/7、国内期货 5/5，与 §5.1(4A)「`=== 253`」、§5.1(4B)「`=== 数据点数`」**期望值完全一致 → 全绿**，并非文档所称「A 股轴长度坍缩为点数」。
  2. **变体二（还原 `hasNonStockHours` 上下界）零效果**：`opts.isFuture === undefined` 在调用点恒为假，该表达式**短路**，`hasNonStockHours` 不再被求值（实测同一变异版在「声明 `isFuture`」与「不声明」两种入参下结论相反：港股 253/3 vs 6/6，证明该变量只经 `undefined` 分支起作用）→ 单独执行变体二不产生任何行为差异 → 不转红。
  3. 因此 M4 只有「两项变异同时执行」才可能转红，与 §5.2 的「**确定性转红**」表述不符；而 §5.1(4B) 只覆盖国内期货（`isFutureCode=true` 的正常路径），**港股/美股/国际期货轴无任何用例或变异**——P1-1 的回归（美股/`gl_*` 可见点 0/5、0/4）在整张验证矩阵中完全不可观测。
- **期望行为**：Round 2 P2-4 要求「§5.1 增补非 A 股分时轴用例（期货日盘序列 + 港股/美股），并配对应变异（如把 `opts.isFuture` 改回恒假）」「每条变异提供变异前后实测对照，且『必定变红』可在实跑中确定性复现」。方案本轮只改了 M4 的措辞，未补用例、未使其具备判别力。
- **根因**：M4 的变异对象选在了「修改后不再被求值的变量」上，且未对「合取式短路」这一新结构设计变异；用例集合仍以 A 股 + 国内期货为全集，遗漏了本次判据改写真正会波及的港股/美股/国际期货。
- **影响范围**：即使按 P1-1 所述回归真实发生，§5 仍会全绿；同时「实现缺失仍全绿」的盲区在 v3 中由 M5 的修补（已生效）之外仍残留于分时轴一路。
- **复现方法 / 运行证据**：见 P1-1 的实跑表格（同一探针同时给出 HEAD / 变异 / 未声明三态对照），以及 §5.2 M4 文本与 `chart.js:741` 短路语义的直接对照。
- **修复建议**：① §5.1(4) 增补用例 C（`hk00700` 全时段）、用例 D（`usAAPL` 21:30-03:00）、用例 E（`gl_HSI` 17:00-05:00），断言 `displayTimes.length === 数据点数` 且 `_getDisplayVolumeData()` 中带值条目数 === 数据点数；② M4 重写为「把 `hasNonStockHours` 从析取式中摘除（或令 `isFutureTimeline = opts.isFuture === true`）」，其杀红依据改为用例 C/D/E；③ 每条变异补「变异前后实跑对照」（轴长 + 可见点数）。
- **修复后验收标准**：M1~M6 每项在正确实现下用例全绿、在执行其指定变异后**确定性转红且给出实测对照值**；§5.1 每条断言的期望值可由文档给出的网格/契约唯一推出，且覆盖 A 股、国内期货、港股、美股、国际期货五类轴路径。

---

### P3-1 §四 变更清单未登记落地所必需的 import 新增（`kline.js` 的 `chartSecondsToTime`、`voiceController.js` 的 `getBeijingClockParts`）；§3.3.1 片段误用不存在的 `this.getMarketSession`

- **严重级别**：P3
- **文件与行号**：方案文档 §3.2.3 第 2 条（`...call-auction-kline-intraday-voice-handoff.md:149-151`）、§3.3.2（`:176`）、§3.3.1 片段（`:162`）、§四 清单（`:203-208`）；代码 `src/js/kline.js:1-13`（现有 import：`parseBeijingDateTimeToChartSeconds`/`parseTencentMinuteToChartSeconds`/`chartTimeToDate`/`getBeijingClockParts`/`getBeijingMinuteChartSeconds`，**无 `chartSecondsToTime`**）、`src/js/controllers/voiceController.js:1-3`（仅导入 `getBeijingDate`）、`src/js/marketSession.js:105-120`（`chinaStockStrategy` 成员清单中无 `getMarketSession`，仅模块级 `getMarketSession`）
- **触发条件**：实现者按 §四 变更清单逐条落地，直接书写 §3.2.3 的 `chartSecondsToTime(last.time) === '09:25'`、§3.3.2 的 `parts.hour * 60 + parts.minute` 与 §3.3.1 的 `this.getMarketSession(now, tradingDates)`。
- **实际行为**：`chartSecondsToTime` 未在 `kline.js` 导入（该函数存在于 `src/js/time.js:130` 且判定本身可行——实测 `chartSecondsToTime(2026-09-18 09:25 槽位) === '09:25'` 为 `true`）；`getBeijingClockParts` 未在 `voiceController.js` 导入（`clock()` 已在闭包内，可直接使用）；`chinaStockStrategy.getMarketSession` 实测为 `undefined`，按 §3.3.1 片段字面调用抛 `TypeError: chinaStockStrategy.getMarketSession is not a function`（同文件的既有实现 `marketSession.js:119` 用的是模块级 `getMarketSession(now, tradingDates)`）。
- **期望行为**：§四 作为实现清单，应列出函数签名/入参/调用点之外的必要改动面（新增 import、可用的等价模块级函数），使改动点可按字面落地且不抛错。
- **根因**：v3 重写方案时以行内片段替代了 v2 的完整代码块，片段省略了所属模块的 import 现状与作用域内可调用符号的核实。
- **影响范围**：不改变设计逻辑，但会令实现阶段出现一次性语法/引用错误，属落地精度问题（`this.` 写法若被照抄会直接抛错并被 `chartRowController` 的 try/catch 静默吞掉）。
- **复现方法 / 运行证据**：`typeof chinaStockStrategy.getMarketSession === 'undefined'`（真实模块实跑，调用抛 `TypeError`）；`grep -n "chartSecondsToTime" src/js/kline.js` 无命中（仅 `src/js/time.js:130` 与 `chart.js` 导入）；`grep -n "getBeijingClockParts" src/js/controllers/voiceController.js` 无命中。
- **修复建议**：§四 清单补「`kline.js` 新增 `chartSecondsToTime` 导入」「`voiceController.js` 新增 `getBeijingClockParts` 导入」；§3.3.1 片段把 `this.getMarketSession(now, tradingDates)` 改为模块级 `getMarketSession(now, tradingDates)`（与 `:119` 既有实现一致）。
- **修复后验收标准**：§3.3.1 片段可在 `marketSession.js` 内按字面编译执行且 09:20/09:22/09:29 返回 `true`、09:17 返回 `false`（`autoStartAuction=false`）；§3.2.3 与 §3.3.2 的判据在加入所列 import 后可直接运行。

---

## 三、待确认风险与未验证项

1. **§3.2.2 网格空档与数据侧放行窗口不一致（未验证，需上游样本）**：`chinaStockStrategy.getIntradaySessionRanges()` 返回 `[[555,690],[780,900]]`（含 09:26-09:29），`api.js:330-358` 的 `_isTradingSessionTime`/`_filterIntradaySessions` 仅按该区间过滤；而 §3.2.2 的新网格为 `09:15-09:25 + 09:30-11:30 + 13:00-15:00`，无 09:26-09:29 槽位。若某次刷新（用户在静默期打开分时图）时上游返回 09:26-09:29 点，这些点会进入 `arr`/`byTime` 却不落在 `displayTimes` 上（不可见），且 `chart.js:838` 的 `renderIntradayDetail(arr[arr.length-1].time)` 会展示一个轴上不存在的时间。本轮无网络样本，无法验证上游是否会返回该窗口点。**残余风险**：静默期分时点的可见性与明细图例一致性。建议方案明确「09:26-09:29 的上游点丢弃（by design）」或将其并入 09:25 槽位。
2. **上游 09:15-09:25 分时数据可得性（Round 1/2 遗留，v3 仍未声明前提）**：`kline.js:547-548` 在 `items` 为空时提前返回，故 Feature 2 的竞价曲线可见性依赖上游提供竞价分钟点，方案未声明该前提。无法在无网络样本条件下验证。**残余风险**：竞价段可能「有轴无点」。
3. **TTS 队列按 code 合并削弱「严格按 interval 全量播报」（Round 1/2 遗留，v3 未表态）**：`src/js/tts.js:123-130` 对同 code 非队首排队项做替换并以 `'replaced'` 终结，多标的或 `interval` 短于单条播报时长时实际节奏低于设定值，与 §3.3.2「严格按照设定的 interval 准时播报」的绝对表述存在差距。属既有实现限制，需方案表态。
4. **品种判定残留 fail-open 面（低风险）**：`inferAssetType` 对「非空但无法识别的字符串」仍回退 `STOCK_CN`（`parser.js:48`）；方案的 `effectiveCode` 前置判断已关闭空值分支，现实 code 域（`sh/sz/bj`、`hk*`/`r_hk*`、`us*`、`nf_*`、`gl_*`）亦均被正确分类，故本轮未定为缺陷；若存在不带前缀的美股裸符号入口，日K 守卫会误介入。建议 §3.1.1 补一句「无法识别时的失效方向」。
5. **真实浏览器 Worker/`checker` 跨会话切点触发顺序（未在真机复核）**：本轮以注入式 `clock`/`timers`/`speech` + 真实 controller 验证了「09:20→09:31 持续使能时 `memory` 不被清空」的机制；另确认 `startTimer`/`resetMemory` 的其它入口仅为用户改动设置（`app.js:1027/1074/1089`、`interval` 变更）与 `stop()`，无周期性调用。**残余风险**：真机上 30s `checker` 与 Worker tick 的实际交错顺序未复测。

---

## 四、推荐修复顺序与复审验收标准

**推荐修复顺序**：

1. **P1-1**（分时轴兜底死代码）→ 决定港股/美股/国际期货分时图是否可用，且是 P2-3 用例的判据来源。
2. **P2-1**（`!cfg.enabled` 总开关口径）→ 与 P1-1 同源（均为「迁移改动点丢失原有语义」），必须与 §3.3.1 定稿一并修。
3. **P2-2**（09:25 前守卫覆盖追加分支 + §5.1(1) 前置状态）→ 决定需求 1 的「彻底消除」是否成立。
4. **P3-1**（§四 清单补 import 与 `getMarketSession` 写法）。
5. **P2-3**（在上述各项定稿后重写 §5.1(4)/M4，补齐五类轴路径用例与可确定性转红的变异）。

**复审验收标准**：

- §3.2.1 的分时轴判据在**唯一调用点**传参下对 A 股走 253 固定网格，对国内期货、港股、美股、国际期货均走数据驱动轴；给出 `displayTimes` 的实测对照（A 股 253；其余 === 数据点数且全部为可见值）。
- §3.3.1 的豁免分支保留 `if (!cfg.enabled) return true` 的总开关语义（与 `chinaFuturesStrategy`/`hkStockStrategy`/`usStockStrategy` 同形）；给出 `enabled=false` 与 `enabled=true` × 09:17/09:22 的四象限期望值。
- §3.1.2 的 09:25 前规则显式覆盖追加与原地两条路径并在分支分派前生效；§5.1(1) 拆为「今日柱不存在」「今日柱已存在」两条用例且期望值唯一（`low === 20.00`）。
- §四 变更清单逐条列明函数签名、入参来源、调用点与**新增 import**，全部改动点可按字面落地且不抛错。
- §5 的每条变异给出变异前后实测对照，且「必定变红」可在实跑中确定性复现（尤其 M4 与分时轴三族用例）；M1~M6 全部具备判别力。
- 上述 P1/P2/P3 全部闭环，且不引入新的连带回归（非 A 股分时轴、日K 各品种极值、数据刷新节奏、`smartSchedule` 关闭态语音行为）。
