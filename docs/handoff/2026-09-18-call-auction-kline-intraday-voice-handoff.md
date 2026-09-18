# 集合竞价行情与播报深度优化方案 — 设计交接文档

日期：2026-09-18  
类型：技术方案设计与根因分析（Technical Design & Root Cause Analysis）  
分支：`main`  
对应需求：
1. 集合竞价虚拟波动导致日K线生成虚假下影线（如掌阅科技等标的）的消除方案；
2. 集合竞价分时纳入分时图坐标与实时渲染方案；
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

2. **`applyLiveQuoteToKline` 单向极值记忆锁定与不可逆性**：
   - 在 `src/js/kline.js:475-477`（追加新Bar分支）与 `494-496`（原地更新末Bar分支）：
     ```javascript
     const lastHigh = _positiveNumber(last.high);
     const lastLow = _positiveNumber(last.low);
     updated.high = Math.max(lastHigh, quoteHigh, price);
     const lowCandidates = [lastLow, quoteLow, price].filter((value) => value > 0);
     updated.low = lowCandidates.length ? Math.min(...lowCandidates) : price;
     ```
   - 当 09:15-09:20 掌阅科技因极端申报导致虚拟撮合价跌停（`quote.price` 跌停，或外部 quote 的 `low` 包含跌停价）时，`updated.low` 被置为跌停价。
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

2. **增量点更新逻辑盘前拦截**：
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
   - 在 09:15-09:25 期间，`_isContinuousTradingMinute` 判定为 `false`，直接进入 `_correctLastIntradayPoint`（试图修正最后一个点，而开盘前根本没有今天的点，结果甚至去错误修改了昨天收盘的分时点），导致盘前增量分时点被完全丢弃。

---

### 2.3 语音播报去重机制在集合竞价时段的根因

1. **单一开关全局生效，缺乏时序感知**：
   - 在 `src/js/controllers/voiceController.js:35`：
     ```javascript
     const dedupe = !manual && !full && settings.skipUnchanged !== false;
     ```
   - `voiceController` 在 `speakCodes` 时未结合北京时间时钟判断当前子交易时段。当用户开启「相同报价不重复播报」时，09:20-09:25 即使处于关键的不可撤单博弈定价期，若报价连续几次保持不变，喇叭就会处于静音状态，用户无法通过听觉确认倒计时进度与标的当前的价格维持状态。

---

## 三、架构设计与技术实施方案

### 3.1 方案一：日K线集合竞价下影线彻底消除与权威保护

#### 3.1.1 核心机制设计
1. **时段成交确认守卫（Pre-Open Auction Guard）**：
   - 在北京时间 09:25:00 之前（A股股票品种）：
     - 市场尚未产生正式成交，严禁向日K线追加不可逆的极值 Bar。
     - 若当前用户打开日K，如果需要渲染今日临时柱，今日临时柱的 `high` 与 `low` 仅反映当前最新参考价 `price`（即 `open = price, high = price, low = price, close = price`），**严禁在 09:25 之前执行单向极值记忆 `Math.min(lastLow, ...)`**。
     - 一旦参考价从跌停回升，预览柱的高低影线即时同步回弹，彻底阻断下影线的生成。
2. **官方权威数据优先与外部脏 `quote.low` 隔离**：
   - 09:25 正式集中撮合开盘后，当官方日K数据（`items` 最后一根已经是今日交易日，由 `fetchKline` 获得）已包含官方 Bar 时：
     - 今日 Bar 的 `open`, `high`, `low` 以官方数据为权威基准。
     - 盘中实时 Tick 合并时，**禁止使用外部未经清洗的 `quote.low` / `quote.high` 执行覆盖或 `Math.min/max`**！
     - 盘中极值扩展必须且只能由**实时成交价格的突破（Intraday Price Breakout）**驱动：
       ```javascript
       if (livePrice > last.high) updated.high = livePrice;
       if (livePrice < last.low) updated.low = livePrice;
       ```
     - 这样，无论行情源在盘前是否产生过脏数据，都绝无可能反向污染日K线。

#### 3.1.2 涉及代码修改点
- `src/js/kline.js` 中的 `applyLiveQuoteToKline`：
  - 增加对 A 股开盘前时间（`< 09:25:00`）的检测；
  - 针对今日已存在 Bar 的场景，将 `updated.low = Math.min(lastLow, quoteLow, price)` 改为权威基准保护下的真实成交价突破扩展；
  - 确保北交所、科创板、创业板、主板全类型 A 股标的均受到同等保护。

---

### 3.2 方案二：集合竞价分时纳入分时图

#### 3.2.1 时间轴坐标扩展（`src/js/chart.js`）
1. **扩展 A 股股票分时时间轴结构**：
   - 将股票分时的时间轴网格调整为包含集合竞价段：
     ```javascript
     const stockSessions = [
       [9, 15, 9, 25],  // 早盘集合竞价 (11分钟点)
       [9, 30, 11, 30], // 早盘连续竞价
       [13, 0, 15, 0]   // 午盘连续竞价
     ];
     ```
   - 底部刻度格式化：标记关键节点 `09:15`, `09:25`, `09:30`, `11:30/13:00`, `15:00`。
   - 在 09:15-09:25 之间即可平滑绘制集合竞价走势点；09:25 呈现开盘集合竞价集中撮合点。

#### 3.2.2 实时数据流与点生成（`src/js/kline.js`）
1. **放行集合竞价分时点采集**：
   - 修改 `_isContinuousTradingMinute` 为支持集合竞价：
     ```javascript
     function _isTradingMinute(parts) {
       const minutes = parts.hour * 60 + parts.minute;
       return (
         (minutes >= 9 * 60 + 15 && minutes <= 9 * 60 + 25) || // 集合竞价时段
         (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) ||  // 早盘
         (minutes >= 13 * 60 && minutes < 15 * 60)              // 午盘
       );
     }
     ```
2. **集合竞价指标特殊处理**：
   - 在 09:15-09:24 期间，由于尚未产生累计成交金额，均价线 `avgPrice` 在 09:25 之前不绘制或设为 NaN（避免分母为 0）；
   - 在 09:25 集中撮合完成后，记录 09:25 点的开盘成交量与均价。

---

### 3.3 方案三：语音播报集合竞价时段差异化去重策略

#### 3.3.1 规则精确仲裁（`src/js/controllers/voiceController.js`）
在 `speakCodes` 中获取当前时钟 `now = clock()`，计算北京时间分钟数 `min = parts.hour * 60 + parts.minute`：
1. **`09:15 <= min < 09:20`（可撤单阶段）**：
   - **规则**：受「相同报价不重复播报」开关约束。
   - `dedupe = !manual && !full && settings.skipUnchanged !== false`。
2. **`09:20 <= min < 09:25`（不可撤单阶段，核心决战期）**：
   - **规则**：**无条件豁免去重约束！**
   - 无论 `settings.skipUnchanged` 为何值，`dedupe = false`。
   - 每轮均采用全量格式化（`formatQuoteSpeech`），严格按照设定的 `interval` 准时播报！
3. **`min >= 09:25`（撮合后与连续交易时段）**：
   - **规则**：恢复受 `settings.skipUnchanged` 开关约束。

#### 3.3.2 记忆基线（`memory`）平滑衔接
- 在 09:20-09:25 期间，每次播报完成后，将当前播出的最新价格同步记录至 `memory`；
- 当 09:25 恢复去重模式时，系统以 09:25 刚刚播报的价格作为基准，避免开盘瞬间产生重复播报或被静默吞掉。

---

## 四、改动清单与接口契约表

| 模块 / 文件 | 拟修改函数 / 位置 | 职责与变更内容 |
|---|---|---|
| `src/js/kline.js` | `applyLiveQuoteToKline` | 增加盘前时间守卫，09:25 前不固化日K极值；盘中有官方柱时禁止外部脏 `quote.low/high` 覆盖，改由实时成交价突破驱动。 |
| `src/js/kline.js` | `_isContinuousTradingMinute` | 扩展为识别 09:15-09:25 集合竞价时段，允许向分时图追加盘前点。 |
| `src/js/chart.js` | `createIntradayChart` | 分时时间轴扩展：容纳 `09:15-09:25` 集合竞价网格，对齐 X 轴时间刻度。 |
| `src/js/controllers/voiceController.js` | `speakCodes` | 引入时钟时段判断：09:15-09:20 受 `skipUnchanged` 约束，09:20-09:25 强制 `dedupe = false`（按 interval 全量播报），09:25 恢复约束。 |
| `tests/kline.test.js` | 新增测试模块 | 1. 掌阅科技跌停反例验证：09:18 跌停、09:19 撤单回升，09:25 开盘日K无下影线；<br>2. 分时图 09:15-09:25 集合竞价点成功生成验证。 |
| `tests/voiceController.test.js` | 新增测试用例 | 1. 09:16 去重验证（相同报价只播报 1 次）；<br>2. 09:22 强制播报验证（相同报价持续按 interval 播报）；<br>3. 09:31 恢复去重验证。 |

---

## 五、验证矩阵与证伪设计 (Verification & Mutation Plan)

### 5.1 判别力测试 (Discrimination Tests)
1. **掌阅科技集合竞价跌停下影线消除用例**：
   - 模拟时钟 09:18，传入跌停价 18.00；推进至 09:19，撤单回升至 20.00；推进至 09:25 正式开盘。
   - **严格断言**：今日 Bar 的 `low === 20.00`，绝不等于 `18.00`。
2. **分时图集合竞价时段渲染用例**：
   - 断言时间轴生成包含 09:15-09:25 槽位；输入 09:18 报价成功追加分时点。
3. **语音播报分段去重用例**：
   - 09:16（`skipUnchanged=true`）：连续两次相同报价只播报 1 次；
   - 09:22（`skipUnchanged=true`）：连续两次相同报价强制播报 2 次；
   - 09:31（`skipUnchanged=true`）：恢复去重，相同报价不重复播报。

### 5.2 变异测试 (Mutation Matrix)
- **变异 M1**：撤销 09:20-09:25 豁免规则，断言用例 5.1(3) 必定变红；
- **变异 M2**：还原 `Math.min(lastLow, quoteLow)`，断言掌阅科技跌停反例用例 5.1(1) 必定变红。
- **门禁要求**：全仓 `npm test` 877+ 用例全绿，`npm run lint` 0 警告，`npm run build` 成功。
