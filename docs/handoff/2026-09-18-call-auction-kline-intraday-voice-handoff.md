# 集合竞价行情与播报深度优化方案 — 设计交接文档 (v2 闭环审查版)

日期：2026-09-18  
类型：技术方案设计与根因分析（Round 1 审查 2×P1 + 4×P2 全面闭环）  
分支：`main`  
对应需求：
1. 集合竞价虚拟波动导致日K线生成虚假下影线（如掌阅科技等标的）的彻底消除；
2. 集合竞价分时纳入分时图坐标与实时渲染；
3. 集合竞价语音播报差异化时段去重控制（9:15-9:20 受开关约束，9:20-9:25 强制按间隔播报）。

---

## 一、背景与问题定义

用户在实盘盯盘与使用中指出以下三个与集合竞价（Opening Call Auction）密切相关的缺陷与优化需求：

1. **日K线集合竞价下影线污染（Bug 1）**：
   - **现象**：在开盘集合竞价（09:15-09:25）期间，股票报价的虚拟撮合波动会被直接画成日K线的一部分。例如掌阅科技（`sh603533`），在早盘 09:15-09:20 竞价阶段曾出现极端申报被打到跌停价，随后在 09:19 撤单价格回升，09:25 集中撮合正常开盘；但在系统日K线中，却永久保留了一根直达跌停板的超长下影线。
   - **危害**：日K线严重失真，虚假下影线破坏了技术指标与K线形态识别，误导交易决策。

2. **集合竞价分时未被包括进分时图（Bug 2）**：
   - **现象**：当前分时图的时间轴网格仅固定为连续交易时段（`09:30-11:30` 与 `13:00-15:00`），在 09:15-09:25 集合竞价期间分时图没有任何数据点展现，既无法观察早盘竞价撮合走势，也未呈现 09:25 开盘集合竞价成交点。
   - **诉求**：将集合竞价分时纳入分时图的时间轴与数据流，使得用户在 09:15-09:25 期间能够实时查看竞价价格走势与开盘集中撮合点。

3. **语音播报在集合竞价时段的差异化去重规则（Feature 3）**：
   - **诉求**：
     - `09:15 - 09:20`（开盘集合竞价前半段，可自由申报与撤单）：受「相同报价不重复播报」按钮约束，报价未变不重复播报（去重）；
     - `09:20 - 09:25`（开盘集合竞价后半段，不可撤单，关键博弈定价期）：**无条件不受该按钮约束**，无论报价变与不变，均严格按照用户设定的间隔（如 10s、15s）准时全量播报最新报价；
     - `09:25` 及之后（撮合后与连续交易时段）：恢复受「相同报价不重复播报」按钮约束。

---

## 二、代码级根因分析 (Deep Dive Root Cause)

### 2.1 日K下影线污染根因

追踪代码调用链：
`chartRowController.js:loadKline` / `chartRowController.js:applyLiveTick`  
→ `kline.js:applyLiveQuoteToKline`

1. **金融业务语义违背：未成交的盘前虚拟撮合价充当了日K蜡烛的极值**：
   - 在上交所、深交所、北交所规则中，09:15-09:25 为开盘集合竞价时段。
   - 09:15-09:20 投资者可自由申报与撤单，此时行情源推送的参考价（如腾讯 `fields[3]`、新浪字段 3）仅为**虚拟匹配参考价（Virtual Auction Match Price）**，**没有任何实际成交量（Trade Tick）**！
   - 交易所与权威行情提供商（东方财富、同花顺、通达信）对日K线的严格定义为：**当日产生正式交易撮合的成交价构成的开盘价、最高价、最低价、收盘价（OHLC）**。未成交的虚拟竞价极值绝对不能计入日K线！

2. **`applyLiveQuoteToKline` 全链路单向极值记忆锁定与不可逆性**：
   - 在 `src/js/kline.js:475-477`（追加新Bar分支）与 `494-496`（原地更新末Bar分支）：
     - 追加分支（`:476`）：`lowCandidates = [quoteLow, price, open].filter((v) => v > 0); const low = Math.min(...lowCandidates);`
     - 原地更新分支（`:495-496`）：`const lowCandidates = [lastLow, quoteLow, price].filter((value) => value > 0); updated.low = Math.min(...lowCandidates);`
   - 当 09:15-09:20 掌阅科技因极端申报导致虚拟撮合价跌停时，无论走追加还是原地分支，`low` 均直接采纳外部跌停价。
   - 随后即便在 09:19 申报撤单价格回升，乃至 09:25 正式撮合开盘后，由于 `Math.min(lastLow, ...)` 具有**单调递减不可逆性**，内存中的 `lastLow` 已经记录了跌停价，后续轮询的任何运算都只能在此基础上继续取最小值，导致该虚假下影线被**永久锁死**在今日的日K柱上！

3. **外部行情源盘前脏数据反向污染官方日K**：
   - 官方东财/腾讯日K历史接口（`/api/eastmoney-kline/qt/stock/kline/get`）返回的日K数据是交易所权威计算的，绝对不包含集合竞价未成交的下影线。
   - 但在 `chartRowController.js:386-399` 中，前端在通过 `fetchKline` 拿到权威干净的日K后，紧接着执行了：
     ```javascript
     const merged = applyLiveQuoteToKline(inst.klineData.items, quoteForKline, inst.period);
     ```
     如果此时外部行情源（如腾讯快照）在早盘阶段未能及时重置其内部记录的 `quote.low`，前端就会将这个脏 `quote.low` 再次强行 `Math.min` 进权威日K，造成官方日K被反向污染。

---

### 2.2 集合竞价分时未被包括进分时图根因

1. **时间轴网格硬编码剔除盘前时段**：
   - 在 `src/js/chart.js:744-754` 中，常规股票分时图的时间轴网格由以下固定区间生成：
     ```javascript
     for (const [startHour, startMinute, endHour, endMinute] of [[9, 30, 11, 30], [13, 0, 15, 0]]) {
     ```
   - 坐标轴直接从 09:30:00 开始，没有为 09:15-09:25 预留任何分钟采样点槽位。

2. **启发式判据 `hasNonStockHours` 误判将 A 股竞价点判定为「非股票时段」**：
   - 在 `src/js/chart.js:732-741` 中：
     ```javascript
     const hasNonStockHours = arr.some((it) => {
       ...
       return (min < 9 * 60 + 30 && min >= 9 * 60) || min >= 15 * 60 + 5 || min < 9 * 60;
     });
     const isFutureTimeline = opts.isFuture || hasNonStockHours;
     ```
   - 只要分时数据中存在任意 09:15-09:25 的点，`hasNonStockHours` 立即为 `true`，导致 `isFutureTimeline = true`，使 `if (date && !isFutureTimeline)` 固定网格分支被彻底旁路，时间轴退化为数据驱动轴！

3. **增量点更新逻辑盘前拦截**：
   - 在 `src/js/kline.js:508-514` 的 `_isContinuousTradingMinute`：
     ```javascript
     function _isContinuousTradingMinute(parts) {
       const minutes = parts.hour * 60 + parts.minute;
       return (
         (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) ||
         (minutes >= 13 * 60 && minutes < 15 * 60)
       );
     }
     ```
   - 在 09:15-09:25 期间，`_isContinuousTradingMinute` 判定为 `false`，直接进入 `_correctLastIntradayPoint`，丢弃了盘前增量分时点，甚至还会误改写当日更早的点。

---

### 2.3 语音播报去重机制在集合竞价时段的根因

1. **时段使能门禁前置阻断（P1-1 核心根因）**：
   - `src/js/marketSession.js:51`：`if (session === 'opening-auction') return !!cfg.autoStartAuction;`
   - `DEFAULT_SMART_SCHEDULE.autoStartAuction = false;`
   - 当用户开启语音（`settings.enabled = true`）但未勾选高级选项「集合竞价自动开始」（默认关闭）时，09:15-09:30 的 `getVoiceEligibleCodes` 返回空数组，`timerShouldRun = false`，调度定时器根本不会启动！
   - 仅在 `voiceController.js` 内修改去重判据是**死代码**，因为调度器在会话层已被拦截！

2. **单一开关全局生效，缺乏时序感知**：
   - 在 `src/js/controllers/voiceController.js:35`：
     ```javascript
     const dedupe = !manual && !full && settings.skipUnchanged !== false;
     ```
   - 当调度器运行时，未区分 09:15-09:20 与 09:20-09:25 子阶段。

3. **记忆基线在全量播报下无法写入（P2-2 核心根因）**：
   - `src/js/controllers/voiceController.js:41-43` 中，当 `dedupe=false` 时硬编码返回 `{ text: formatQuoteSpeech(...), spoken: null }`；
   - `onSpoken` 回调有守卫 `if (reason === 'end' && result.spoken)`，由于 `spoken` 为 `null`，`memory` 永远不会被更新；
   - 导致 09:25 恢复去重时，`memory` 仍为 09:20 之前的陈旧数据，同一价格在 09:25 会被错误重复播报！

---

## 三、架构设计与技术实施方案（全面闭环 2×P1 + 4×P2）

### 3.1 方案一：日K线集合竞价下影线彻底消除与品种隔离保护

#### 3.1.1 资产类型感知与品种分发（闭环 P1-2）
1. **明确资产类型分发契约**：
   - 日K盘前守卫**严格限定且仅对 A 股（`STOCK_CN`）生效**！
   - 资产类型通过 `quote.type === 'stock'` 或 `inferAssetType(quote.code || code) === ASSET_TYPES.STOCK_CN` 判断；
   - 对港股（`stock_hk`）、美股（`stock_us`）、国内期货（`future`）、国际期货（`futures_global`），**盘前守卫完全不介入**！其在各自交易时段（如美股夜盘 00:00-04:00、CME 06:10、A50 09:05、恒指 09:20）内的真实成交极值（high/low）保持 100% 正常累计，上下影线绝不失真。

#### 3.1.2 A 股盘前时间守卫与临时预览柱解耦（闭环 Bug 1）
1. **09:25:00 前（A 股盘前竞价）**：
   - 市场尚未产生成交，日K线不固化任何历史极值。
   - 若展示今日预览柱，其实时 OHLC 均收敛于当前最新虚拟参考价：
     `open = price, high = price, low = price, close = price`。
   - **严禁在 09:25 前执行 `Math.min(lastLow, ...)` 或 `Math.max(lastHigh, ...)`**！
   - 当 09:18 跌停申报撤回后，09:19 报价回升，预览柱的高低影线即时同步回弹，彻底阻断跌停下影线。

#### 3.1.3 全链路隔离外部脏 `quote.low/high`（闭环 P2-3）
1. **追加分支（`lastDate < targetDate`）**：
   - 彻底废除原 `:476` 中的 `lowCandidates = [quoteLow, price, open]`；
   - A 股追加今日新 Bar 时，仅由开盘撮合与盘中价格构造：
     ```javascript
     const open = quoteOpen || price;
     const high = Math.max(open, price);
     const low = Math.min(open, price);
     ```
   - 外部 `quote.low` / `quote.high` 绝不进入候选，彻底阻断官方 Bar 滞后入库时的脏数据倒灌！
2. **原地更新分支（`lastDate === targetDate`）**：
   - 官方日K（通过 `fetchKline` 获得）的 `high` 和 `low` 具有绝对权威；
   - 实时合并时，极值必须且只能由**盘中真实成交价格的突破（Intraday Price Breakout）**驱动：
     ```javascript
     if (price > last.high) updated.high = price;
     if (price < last.low) updated.low = price;
     ```
   - 彻底切断外部行情源盘前残留脏 `quote.low` 的污染。

---

### 3.2 方案二：集合竞价分时纳入分时图与时间轴修复

#### 3.2.1 解耦 `hasNonStockHours`，确保固定网格生效（闭环 P2-1）
1. **重构分时图时间轴启发式判据（`src/js/chart.js:732-741`）**：
   - 将 `(min < 9 * 60 + 30 && min >= 9 * 60)` 从「非股票时段」判据中剔除，或直接依据资产类型判断：`const isFutureTimeline = opts.isFuture || isFutureCode(inst.code)`；
   - 使得包含 09:15-09:25 竞价点的 A 股股票分时稳固走 `:743-754` 固定网格分支，绝不退化为数据驱动轴。

#### 3.2.2 扩展股票分时时间轴结构（`src/js/chart.js:744-754`）
1. **固定网格包含集合竞价段**：
   ```javascript
   for (const [startHour, startMinute, endHour, endMinute] of [
     [9, 15, 9, 25],  // 早盘集合竞价 (11 个分钟点槽位)
     [9, 30, 11, 30], // 早盘连续竞价
     [13, 0, 15, 0]   // 午盘连续竞价
   ])
   ```
2. **09:25 与 09:30 之间保留静态空档格位**，保持 X 轴线性与 A 股专业看盘终端体验一致。

#### 3.2.3 实时分时点放行与指标处理（`src/js/kline.js`）
1. **放行集合竞价分时采集**：
   修改 `_isContinuousTradingMinute` 为支持集合竞价时段：
   ```javascript
   function _isTradingMinute(parts) {
     const minutes = parts.hour * 60 + parts.minute;
     return (
       (minutes >= 9 * 60 + 15 && minutes <= 9 * 60 + 25) || // 集合竞价
       (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) ||  // 早盘连续竞价
       (minutes >= 13 * 60 && minutes < 15 * 60)              // 午盘连续竞价
     );
   }
   ```
2. **集合竞价指标处理**：
   - 09:15-09:24 期间均价线 `avgPrice` 设为当前价格或 NaN，避免除零；
   - 09:25 开盘撮合点记录开盘价与集合竞价总成交量；
   - 09:26-09:29 静默期内不改写 09:25 开盘撮合点。

---

### 3.3 方案三：语音播报集合竞价时段使能与差异化去重

#### 3.3.1 会话级语音使能重构（闭环 P1-1）
1. **解除 09:20-09:25 的 `autoStartAuction` 门禁**：
   - 在 `src/js/marketSession.js:47-55`（`isAutoRefreshAllowedInSession` / `isVoiceAllowedInSession`）中：
     当 `session === 'opening-auction'` 时，若当前北京时间处于 `09:20 - 09:25`（不可撤单关键博弈期），**无条件返回 `true`**（只要用户全局启用了语音 `settings.enabled = true`，无需额外勾选 `autoStartAuction`）；
     若处于 `09:15 - 09:20`，则遵从既有 `!!cfg.autoStartAuction` 选项。
   - 在 `src/js/services/voiceSchedule.js:16-17` 中同步放行 09:20-09:25 自动使能。

#### 3.3.2 规则精准分段仲裁（`src/js/controllers/voiceController.js`）
在 `speakCodes` 中获取当前时钟 `now = clock()`，计算北京时间分钟数 `min = parts.hour * 60 + parts.minute`：
1. **`09:15 <= min < 09:20`（可撤单阶段）**：
   - 受「相同报价不重复播报」开关约束：`dedupe = !manual && !full && settings.skipUnchanged !== false`。
2. **`09:20 <= min < 09:25`（不可撤单阶段，核心决战期）**：
   - **强制不受约束**（`dedupe = false`），每轮均走全量播报 `formatQuoteSpeech`，严格按设定 `interval` 准时播报！
3. **`min >= 09:25`（撮合后与连续交易时段）**：
   - 恢复受「相同报价不重复播报」开关约束。

#### 3.3.3 记忆基线生成与平滑衔接（闭环 P2-2）
1. **全量播报路径赋权写入 `spoken`**：
   - 在 `voiceController.js:41-43` 中，当 `dedupe = false` 时：
     ```javascript
     const spokenSegments = buildQuoteSpeechSegments(quote);
     const result = {
       text: formatQuoteSpeech(quote, settings.fields, settings.fieldsOrder),
       spoken: spokenSegments ? { price: spokenSegments.price, percent: spokenSegments.percent } : null
     };
     ```
   - 这样 `onSpoken('end')` 会将 09:20-09:25 播出的真实报价与涨跌幅正常写入 `memory`；
   - 09:25 恢复去重后，系统以 09:25 刚播出的最新价格为基线，**彻底消除 09:25 开盘重复播报缺陷**！

---

## 四、改动清单与接口契约表

| 模块 / 文件 | 拟修改函数 / 位置 | 职责与变更内容 | 闭环缺陷 |
|---|---|---|---|
| `src/js/marketSession.js` | `isAutoRefreshAllowedInSession` / `isVoiceAllowedInSession` | 为 `opening-auction` 增加 09:20-09:25 无条件使能分支，解除 `autoStartAuction` 阻塞。 | **P1-1** |
| `src/js/services/voiceSchedule.js` | `decideVoiceSchedule` | 在 09:20-09:25 确保 `timerShouldRun = true`，支持调度器正常唤醒。 | **P1-1** |
| `src/js/kline.js` | `applyLiveQuoteToKline` | 1. 守卫严格限定 `inferAssetType(code) === STOCK_CN`，放行港股/美股/期货；<br>2. 09:25 前 A 股预览柱极值等于 price，不执行 `Math.min`；<br>3. 追加分支与原地分支全面废除外部脏 `quote.low/high`，改由真实成交价驱动。 | **P1-2**<br>**P2-3**<br>Bug 1 |
| `src/js/chart.js` | `createIntradayChart` | 1. 解耦 `hasNonStockHours`，避免 A 股竞价点将固定网格误判为期货轴；<br>2. 时间轴网格扩展支持 `09:15-09:25` 集合竞价槽位与刻度。 | **P2-1**<br>Bug 2 |
| `src/js/kline.js` | `_isContinuousTradingMinute` | 放行 09:15-09:25 集合竞价分时点采集，保护 09:25 撮合点不被静默期覆盖。 | Bug 2 |
| `src/js/controllers/voiceController.js` | `speakCodes` | 1. 09:20-09:25 强制 `dedupe = false`；<br>2. 全量播报分支生成有效 `result.spoken` 并经 `onSpoken` 写入 memory，闭环 09:25 重复播报。 | **P2-2**<br>Feature 3 |

---

## 五、验证矩阵与可证伪设计 (Verification & Mutation Matrix)

### 5.1 判别力测试用例 (Discrimination Tests)

1. **A 股掌阅科技集合竞价跌停下影线消除**：
   - 场景：09:18 传入跌停价 18.00，09:19 撤单回升至 20.00，09:25 正式开盘 20.00。
   - 断言：今日 Bar 的 `low === 20.00`，绝不为 `18.00`。
2. **外部脏 `quote.low` 隔离验证（追加分支与原地分支双覆盖）**：
   - 场景：09:26 开盘后，注入外部快照 `{ price: 20.50, low: 18.00 }`。
   - 断言：无论官方 Bar 滞后还是在库，今日 Bar 的 `low` 均为当前真实区间，绝不被脏 `18.00` 污染。
3. **非 A 股标的真实影线不失真回归验证**：
   - 场景：美股标的在 02:00（北京）或 CME 期货在 06:10 传入价格波动区间 `[98.00, 103.00]`。
   - 断言：`high === 103.00, low === 98.00`，影线完整保留，证明盘前守卫未跨品种误伤。
4. **分时图固定网格与竞价槽位验证**：
   - 场景：传入含 09:18 点的 A 股分时数据。
   - 断言：`displayTimes` 长度保持为固定网格（09:15-11:30 + 13:00-15:00），未被 `hasNonStockHours` 旁路。
5. **语音播报时段使能与平滑去重衔接验证**：
   - 场景：在 `autoStartAuction = false` 下，09:22 连续两轮相同报价。
   - 断言：调度器正常运行且连续播报 2 次；09:25 之后再传入相同报价，断言恢复去重（只播报 0 次），绝不发生重复播报。

### 5.2 变异测试矩阵 (Mutation Matrix)

| 变异项编号 | 变异代码动作 | 预期被杀死的测试用例 | 证伪判定标准 |
|---|---|---|---|
| **M1** | 还原 `marketSession.js` 09:20-09:25 使能门禁（强制受 `autoStartAuction` 拦截） | 用例 5.1(5) | 调度器不运行，09:22 播报次数为 0（期望 2），**确定性转红** |
| **M2** | 还原 `kline.js:476` 追加分支的 `quoteLow` 采纳 | 用例 5.1(2) | Bar.low 变为 18.00（期望 20.50），**确定性转红** |
| **M3** | 移除 `inferAssetType(code) === STOCK_CN` 守卫，实行全局时间拦截 | 用例 5.1(3) | 美股/期货影线归零，`high=100.5, low=100.5`（期望 103/98），**确定性转红** |
| **M4** | 还原 `chart.js` 中 `hasNonStockHours` 包含 09:00-09:30 判定 | 用例 5.1(4) | `displayTimes` 长度从固定网格坍缩为数据点数，**确定性转红** |
| **M5** | 还原 `voiceController.js` 全量播报分支 `spoken: null` | 用例 5.1(5) | 09:25 重复播报相同价格，**确定性转红** |
