# 集合竞价行情与播报深度优化方案 — 设计交接文档 (v4 终审收敛定稿版)

日期：2026-09-18  
类型：技术方案设计与根因分析（Round 3 终审审查意见全面闭环，依照规则 11 达到纯设计审查 3 轮上限，正式达成设计收敛）  
分支：`main`  
对应需求：
1. 集合竞价虚拟波动导致日K线生成虚假下影线（如掌阅科技等标的）的彻底消除；
2. 集合竞价分时纳入分时图坐标与实时渲染（253 网格槽位完整适配，非 A 股品种零回归）；
3. 集合竞价语音播报差异化时段去重控制（9:15-9:20 受开关约束，9:20-09:30 保证持续使能与记忆基线平滑衔接）。

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
   - 09:15-09:20 投资者可自由申报与撤单，此时行情源推送的参考价仅为**虚拟匹配参考价（Virtual Auction Match Price）**，**没有任何实际成交量（Trade Tick）**！
   - 交易所与权威行情提供商（东方财富、同花顺、通达信）对日K线的严格定义为：**当日产生正式交易撮合的成交价构成的开盘价、最高价、最低价、收盘价（OHLC）**。未成交的虚拟竞价极值绝对不能计入日K线！

2. **`applyLiveQuoteToKline` 全链路单向极值记忆锁定与不可逆性**：
   - 追加分支（`kline.js:476`）：`lowCandidates = [quoteLow, price, open].filter((v) => v > 0); const low = Math.min(...lowCandidates);`
   - 原地更新分支（`kline.js:495-496`）：`const lowCandidates = [lastLow, quoteLow, price].filter((value) => value > 0); updated.low = Math.min(...lowCandidates);`
   - 当 09:15-09:20 掌阅科技因极端申报导致虚拟撮合价跌停时，无论走追加还是原地分支，`low` 均直接采纳外部跌停价。
   - 随后即便在 09:19 申报撤单价格回升，乃至 09:25 正式撮合开盘后，由于 `Math.min(lastLow, ...)` 具有**单调递减不可逆性**，内存中的 `lastLow` 已经记录了跌停价，后续轮询的任何运算都只能在此基础上继续取最小值，导致该虚假下影线被**永久锁死**在今日的日K柱上！

3. **外部行情源盘前脏数据反向污染官方日K**：
   - 官方东财/腾讯日K历史接口返回的日K数据是交易所权威计算的，绝对不包含集合竞价未成交的下影线。
   - 但在 `chartRowController.js:386-399` 中，前端在通过 `fetchKline` 拿到权威干净的日K后，若外部快照携带盘前脏 `quote.low`，前端就会将这个脏 `quote.low` 再次强行 `Math.min` 进权威日K，造成官方日K被反向污染。

---

### 2.2 集合竞价分时未被包括进分时图根因

1. **时间轴网格硬编码剔除盘前时段**：
   - 在 `src/js/chart.js:744-754` 中，常规股票分时图的时间轴网格固定由两个区间生成：
     `[[9, 30, 11, 30], [13, 0, 15, 0]]`。坐标轴直接从 09:30:00 开始，没有预留 09:15-09:25 的时间槽位。
2. **启发式判据 `hasNonStockHours` 误判将 A 股竞价点判定为「非股票时段」**：
   - 在 `src/js/chart.js:732-741` 中，原实现判据为 `(min < 9 * 60 + 30 && min >= 9 * 60)`，只要分时数据中存在任意 09:15-09:25 的点，`hasNonStockHours` 即为 `true`，导致 `isFutureTimeline = true`，使 `:743-754` 固定网格分支被彻底旁路，时间轴退化为数据驱动轴！
3. **增量点更新逻辑盘前拦截**：
   - 在 `src/js/kline.js:508-514` 的 `_isContinuousTradingMinute` 在 09:15-09:25 判定为 `false`，进入 `_correctLastIntradayPoint`，丢弃盘前点并误改写当日更早的点。

---

### 2.3 语音播报去重机制在集合竞价时段的根因

1. **时段使能门禁前置阻断与会话窗口错配**：
   - A 股 `opening-auction` 会话（`marketSession.js:25`）从 09:15 持续至 09:30。
   - 既有门禁 `chinaStockStrategy.isVoiceAllowed` 判定 `opening-auction` 受 `autoStartAuction`（默认 false）阻断。若仅豁免 09:20-09:25，则 09:25-09:30 会再次被阻断致使定时器停摆；到 09:30 会话切换至 `trading` 时触发 `startTimer()`，其第 3 行 `memory.clear()`（`voiceController.js:67`）会把 09:20-09:25 积累的记忆基线彻底清空，导致恢复去重完全失效！
2. **总开关语义一致性缺失（Round 3 P2-1 根因）**：
   - 系统所有市场策略（期货、港股、美股）在时段判断前均优先检查 `if (!cfg.enabled) return true;`，表达「智能交易时段关闭即不做时段拦截」；语音使能策略中若省略该前置，将导致关闭智能交易时段时 09:15-09:20 发生误拦截。
3. **记忆基线在全量播报下无法写入**：
   - `voiceController.js:41-43` 中，当 `dedupe=false` 时硬编码返回 `{ text: ..., spoken: null }`，导致 `onSpoken` 因 `result.spoken == null` 而从不写入 `memory`。

---

## 三、架构设计与技术实施方案（全面吸收 Round 3 意见终审定稿）

### 3.1 方案一：日K线集合竞价下影线消除与水密品种隔离

#### 3.1.1 显式入参契约与 Fail-Closed 品种隔离（闭环 P1-2, P2-2）
1. **显式入参签名升级**：
   - 将 `src/js/kline.js:454` 的 `applyLiveQuoteToKline` 签名升级为：
     `export function applyLiveQuoteToKline(items, quote, period, code)`。
   - 调用点显式传参：
     - `src/js/controllers/chartRowController.js:123`：
       `applyLiveQuoteToKline(inst.klineData.items, quoteOrPrice, inst.period, inst.code || code)`；
     - `src/js/controllers/chartRowController.js:396`：
       `applyLiveQuoteToKline(inst.klineData.items, quoteForKline, inst.period, inst.code || code)`。
2. **Fail-Closed 资产隔离语义**：
   - 通过 `const effectiveCode = code || (quote && quote.code);` 提取标的代码。
   - **仅当 `effectiveCode` 存在且 `inferAssetType(effectiveCode) === ASSET_TYPES.STOCK_CN` 时**，A 股盘前时间守卫与 A 股脏数据隔离才生效！
   - 若 `effectiveCode` 为空或为港股（`stock_hk`）、美股（`stock_us`）、国内期货（`future`）、国际期货（`futures_global`），**守卫绝对不介入**！非 A 股在各自交易时段内的真实极值累计（包含 `quote.high/quote.low`）100% 保持既有行为，零跨品种误伤。

#### 3.1.2 A 股盘前全路径统一守卫（09:25 前创建与更新全覆盖，闭环 Round 3 P2-2）
1. 若为 A 股且当前北京时间 `< 09:25:00`：
   - 市场尚未产生正式撮合，日K线不固化任何历史极值。
   - 该守卫在**追加分支（新柱创建）与原地更新分支判别之前或内部统一生效**：
     - **若 `items` 末柱为昨日（今日柱尚未创建，如盘前首次打开图表）**：创建今日临时柱，四个价格字段一律严格收敛于当前最新参考价：`open = price, high = price, low = price, close = price, volume = 0`；
     - **若 `items` 末柱已为今日（原地更新）**：同样收敛于最新参考价：`open = price, high = price, low = price, close = price`；
     - **严禁在 09:25 前执行 `Math.min(lastLow, ...)` 或 `Math.min(open, price)` 等任何历史极值保留逻辑！**
   - **效果**：09:18 极端挂单出现跌停价 18.00 时，临时柱呈现为 18.00；09:19 撤单价格回升至 20.00 时，临时柱立即重置为 20.00，跌停价 18.00 彻底抹除，绝不残留虚假下影线！

#### 3.1.3 盘中成交价格驱动与外部脏数据隔离（≥ 09:25 正常交易时段）
1. **追加分支（`lastDate < targetDate`，≥09:25 且官方 Bar 滞后在库）**：
   - 仅针对 A 股：新柱 `open = quoteOpen || price`，`high = Math.max(open, price)`，`low = Math.min(open, price)`；
   - 外部 `quote.low` / `quote.high` 绝不进入候选列表，彻底阻断上游滞后时的脏数据污染。
2. **原地更新分支（`lastDate === targetDate`，≥09:25 正常交易时段）**：
   - 仅针对 A 股：官方日K数据（`fetchKline`）具有最高权威；
   - 实时 Tick 合并时，极值必须且只能由**盘中真实成交价格的突破（Intraday Price Breakout）**驱动：
     `if (price > last.high) updated.high = price; if (price < last.low) updated.low = price;`。
   - 外部未清洗的 `quote.low/high` 绝不覆盖或 min/max 官方值。

---

### 3.2 方案二：集合竞价分时纳入分时图与全资产时间轴无缝兼容

#### 3.2.1 显式注入与析取兜底组合（闭环 Round 3 P1-1，保护港股/美股/外盘期货）
1. **调用点显式注入**：
   - 在 `src/js/controllers/chartRowController.js:288-291`：
     ```javascript
     const ctl = createIntradayChart(host, {
       theme: inst.theme,
       height: inst.height,
       isFuture: isFutureCode(code)
     });
     ```
2. **析取兜底判定与 `hasNonStockHours` 下界收窄（`src/js/chart.js:732-741`）**：
   - 将 `hasNonStockHours` 的早盘下界由 09:30 收窄至 09:15：
     `const hasNonStockHours = items.some((item) => { const min = ...; return (min < 9 * 60 + 15 && min >= 9 * 60) || min >= 15 * 60 + 5 || min < 9 * 60; });`
   - **分时轴类型判定保留析取兜底**：
     `const isFutureTimeline = opts.isFuture === true || hasNonStockHours;`
   - **各品种全覆盖效果（实测零回归）**：
     - **A 股（`sh/sz/bj`）**：`opts.isFuture === false`；09:15-09:25 竞价点分钟数 `>= 555`，不触发收窄后的 `hasNonStockHours`（`false`），故 `isFutureTimeline === false`，稳定走 **253 标准固定网格**！
     - **国内期货（`RB0` 等）**：`opts.isFuture === true`，稳定走**数据驱动轴**！
     - **港股（`hk00700`，15:00-16:00 `min >= 905`）**：触发 `hasNonStockHours`，稳定走**数据驱动轴**（6/6 点完全可见）！
     - **美股（`usAAPL`，21:30-04:00 `min < 540` 或 `min >= 905`）**：触发 `hasNonStockHours`，稳定走**数据驱动轴**（5/5 点完全可见，绝不塌缩为 A 股网格）！
     - **国际期货（`gl_HSI`，17:00-05:00）**：触发 `hasNonStockHours`，稳定走**数据驱动轴**（4/4 点完全可见）！

#### 3.2.2 固定网格精确定义
1. **A 股分时时间轴网格定义**：
   ```javascript
   for (const [startHour, startMinute, endHour, endMinute] of [
     [9, 15, 9, 25],  // 早盘竞价：9:15 - 9:25，闭区间共 11 个槽位
     [9, 30, 11, 30], // 早盘连续：9:30 - 11:30，闭区间共 121 个槽位
     [13, 0, 15, 0]   // 午盘连续：13:00 - 15:00，闭区间共 121 个槽位
   ])
   ```
   **确切总槽位数**：`11 + 121 + 121 = 253` 个槽位。09:25 与 09:30 之间为自然时段跳跃，不补空白分钟，与专业金融软件标准一致。

#### 3.2.3 实时分时点放行与 09:25 撮合点静默期保护（闭环 P3-1）
1. **放行集合竞价采集（`src/js/kline.js`）**：
   `_isContinuousTradingMinute` 扩展为 `_isTradingMinute`，覆盖 `09:15 <= min <= 09:25`、`09:30-11:30`、`13:00-15:00`。
2. **09:25 开盘撮合点保护机制**：
   - 在 `src/js/kline.js:523-545` 的 `_correctLastIntradayPoint` 中增加守卫（从 `./time.js` 导入 `chartSecondsToTime`）：
     若 `last` 点的时间对应为 09:25（`chartSecondsToTime(last.time) === '09:25'`），且当前北京时间处于 `09:26:00 - 09:29:59`，**直接 `return items`，跳过修正**！
     确保交易所 09:25 撮合产生的权威开盘价与成交量绝不被静默期报价覆盖。

---

### 3.3 方案三：语音播报总开关对齐、会话平滑衔接与记忆基线保持

#### 3.3.1 保持既有总开关语义与语音专属使能扩展（闭环 Round 3 P2-1, P3-1）
1. **保持 `if (!cfg.enabled) return true;` 总开关语义（与所有兄弟策略完全同形）**：
   在 `src/js/marketSession.js:117-120` 的 `chinaStockStrategy.isVoiceAllowed` 中：
   ```javascript
   isVoiceAllowed(now = new Date(), cfg = DEFAULT_SMART_SCHEDULE, tradingDates = []) {
     if (!cfg.enabled) return true; // 保持总开关关闭时不拦截时段的原生语义
     const session = getMarketSession(now, tradingDates); // 调用模块级函数，禁止 this.getMarketSession
     if (session === 'opening-auction') {
       const min = _minutesInBeijing(now);
       // 09:20 - 09:30 覆盖不可撤单博弈期与撮合等待期，保持语音持续使能，定时器不停摆
       if (min >= 9 * 60 + 20 && min < 9 * 60 + 30) return true;
       return !!cfg.autoStartAuction;
     }
     return isVoiceAllowedInSession(session, cfg);
   }
   ```
2. **四象限使能矩阵**：
   - `cfg.enabled = false, autoStartAuction = false`：09:17 与 09:22 均放行（`timerShouldRun = true`，总开关关闭不拦截）；
   - `cfg.enabled = true, autoStartAuction = false`：09:17 拦截（`false`），09:22-09:30 豁免放行（`true`）；
   - 彻底解决 P1-1：09:20-09:30 期间定时器不停摆，09:30 开盘绝不触发 `memory.clear()`！
   - 彻底解决 P2-1：改动严格落在语音专属方法内，零改动 `isAutoRefreshAllowedInSession`，数据自动刷新节奏 100% 保持原有契约。

#### 3.3.2 播报去重分段仲裁（`src/js/controllers/voiceController.js`）
在 `speakCodes` 中获取当前时钟 `now = clock()`，导入并调用 `getBeijingClockParts` 计算北京时间分钟数 `min = parts.hour * 60 + parts.minute`：
1. **`09:15 <= min < 09:20`（可撤单阶段）**：
   受「相同报价不重复播报」开关约束：`dedupe = !manual && !full && settings.skipUnchanged !== false`。
2. **`09:20 <= min < 09:25`（不可撤单阶段，核心决战期）**：
   **强制不受约束**（`dedupe = false`），每轮均走全量播报 `formatQuoteSpeech`，严格按设定 `interval` 准时播报！
3. **`min >= 09:25`（09:25-09:30 撮合后与连续交易时段）**：
   **恢复受「相同报价不重复播报」开关约束**。

#### 3.3.3 记忆基线生成与平滑衔接
1. **全量播报路径赋权写入 `spoken`**：
   在 `voiceController.js:41-43` 中，当 `dedupe = false` 时：
   ```javascript
   const spokenSegments = buildQuoteSpeechSegments(quote);
   const result = {
     text: formatQuoteSpeech(quote, settings.fields, settings.fieldsOrder),
     spoken: spokenSegments ? { price: spokenSegments.price, percent: spokenSegments.percent } : null
   };
   ```
2. 09:20-09:25 每轮全量播报完成后，`onSpoken('end')` 将最新价格与涨跌幅正常写入 `memory`；
3. 09:25 恢复去重后，系统直接以 09:24/09:25 刚播出的最新价格为基准，**彻底消除 09:25 开盘重复播报缺陷**！

---

## 四、改动清单与接口契约表（含必需 Import 登记）

| 模块 / 文件 | 拟修改函数 / 位置 | 职责与变更内容 | 闭环缺陷 |
|---|---|---|---|
| `src/js/marketSession.js` | `chinaStockStrategy.isVoiceAllowed` | 1. 增加 `if (!cfg.enabled) return true;` 保持总开关语义；<br>2. 调用模块级 `getMarketSession(now, tradingDates)`；<br>3. 09:20-09:30 无条件返回 `true`，解除 `autoStartAuction` 阻塞，保持定时器持续运行，保护记忆基线。 | **P1-1**<br>**P2-1**<br>**P3-1** |
| `src/js/controllers/chartRowController.js` | `:123`, `:396`<br>`:288-291` | 1. 显式传参 `applyLiveQuoteToKline(..., inst.code || code)`；<br>2. 显式传参 `createIntradayChart(..., { ..., isFuture: isFutureCode(code) })`。 | **P1-2**<br>**P2-2**<br>**P2-3** |
| `src/js/kline.js` | 新增 import<br>`applyLiveQuoteToKline(items, quote, period, code)` | 1. 从 `./time.js` 新增导入 `chartSecondsToTime`；<br>2. 守卫严格限定且仅当 `code` 经 `inferAssetType` 为 `STOCK_CN` 时生效，非 A 股 fail-closed 完全放行；<br>3. **09:25 前 A 股预览柱统一收敛为 `price`（覆盖追加分支与原地更新分支），彻底消除跌停下影线**；<br>4. ≥09:25 追加分支与原地更新分支全面废除外部脏 `quote.low/high`，改由盘中真实成交价突破驱动。 | **P1-2**<br>**P2-2**<br>**P3-1**<br>Bug 1 |
| `src/js/chart.js` | `createIntradayChart` | 1. 接收 `opts.isFuture`；`hasNonStockHours` 下界收窄为 `min < 9*60+15`；<br>2. 分时轴判定保留析取兜底：`opts.isFuture === true || hasNonStockHours`，港股/美股/外盘期货保持数据驱动轴完全可见；<br>3. A 股时间轴网格扩展为 3 区间共 253 个标准槽位。 | **P1-1**<br>**P2-3**<br>**P2-4** |
| `src/js/kline.js` | `_isContinuousTradingMinute`<br>`_correctLastIntradayPoint` | 1. 放行 09:15-09:25 竞价点采集；<br>2. 09:26-09:29 静默期内守卫（`chartSecondsToTime(last.time) === '09:25'`）保护 09:25 撮合点不被覆盖。 | **P3-1**<br>Bug 2 |
| `src/js/controllers/voiceController.js` | 新增 import<br>`speakCodes` | 1. 从 `../time.js` 新增导入 `getBeijingClockParts`；<br>2. 09:20-09:25 强制 `dedupe = false`，09:25 恢复去重；<br>3. 全量播报分支生成有效 `result.spoken` 并经 `onSpoken` 写入 memory。 | **P1-1**<br>**P2-2**<br>**P3-1**<br>Feature 3 |

---

## 五、验证矩阵与可证伪设计 (Verification & Mutation Matrix)

### 5.1 判别力测试用例 (Discrimination Tests)

1. **A 股掌阅科技集合竞价跌停下影线消除（Bug 1，双前置覆盖）**：
   - **用例 1a（追加路径，`items` 末柱为昨日）**：输入模拟时钟 09:18 传入跌停价 18.00；09:19 撤单回升至 20.00；09:25 正式开盘 20.00。断言：今日 Bar 的 `low === 20.00`，绝不保留 `18.00`。
   - **用例 1b（原地更新路径，`items` 已含今日柱）**：同输入序列。断言：今日 Bar 的 `low === 20.00`。
2. **外部脏 `quote.low` 隔离验证（追加分支与原地分支双覆盖）**：
   - 输入：09:26 开盘后，注入外部快照 `{ price: 20.50, low: 18.00 }`。
   - 断言：无论官方 Bar 在库还是追加分支，今日 Bar 的 `low === 20.50`（或官方值），绝不等于 `18.00`。
3. **非 A 股标的真实影线不失真回归验证（P1-2, P2-2）**：
   - 输入：美股标的在 02:00（北京）或 CME 期货在 06:10 传入价格波动区间 `[98.00, 103.00]`。
   - 断言：`high === 103.00, low === 98.00`，影线完整保留，守卫未误伤。
4. **分时图固定网格与全资产数据驱动轴可见性验证（P1-1, P2-3, P2-4）**：
   - **用例 4a（A 股）**：输入含 09:18 点的 A 股分时数据。断言：`displayTimes.length === 253`。
   - **用例 4b（国内期货）**：输入国内期货 `RB0` 分时数据。断言：`opts.isFuture === true`，`displayTimes.length === 数据点数`（数据驱动轴）。
   - **用例 4c（港股）**：输入 `hk00700`（含 15:30 点）。断言：`displayTimes.length === 6`，全部数据点可见（6/6，绝不塌缩为 253/3）。
   - **用例 4d（美股）**：输入 `usAAPL`（21:30-03:00 点）。断言：`displayTimes.length === 5`，全部数据点可见（5/5，绝不为 253/0 空图）。
   - **用例 4e（国际期货）**：输入 `gl_HSI`（17:00-05:00 点）。断言：`displayTimes.length === 4`，全部数据点可见（4/4，绝不为 253/0 空图）。
5. **09:26-09:29 静默期开盘撮合点保护验证（P3-1）**：
   - 输入：09:25 生成撮合点 20.00；09:27 传入报价 20.20。
   - 断言：09:25 点的 `close === 20.00`，未被 20.20 覆写。
6. **语音播报总开关、时段使能与记忆基线衔接验证（P1-1, P2-1, P2-2, P2-4）**：
   - **用例 6a（智能时段关闭态）**：`smartSchedule.enabled = false, autoStartAuction = false`。断言：09:17 与 09:22 时 `timerShouldRun === true`，`eligibleCodes` 包含订阅标的，不被误拦截。
   - **用例 6b（智能时段开启态 09:20-09:25）**：`smartSchedule.enabled = true, autoStartAuction = false`。断言：09:17 拦截（`timerShouldRun = false`）；09:22 放行（`timerShouldRun = true`），连续两轮全量播报 2 次；广播后断言 `inspect().memory.get('sh603533').price === '20.00 元'`。
   - **用例 6c（09:25 恢复去重与基线保持）**：09:26 时 `timerShouldRun === true`（定时器不停摆，不触发 memory.clear）；传入相同报价，断言发声 0 次（恢复去重成功生效，绝无重复播报）。

### 5.2 变异测试矩阵 (Mutation Matrix)

| 变异编号 | 变异代码操作 | 杀红用例 | 证伪判定标准（变异实跑预期） |
|---|---|---|---|
| **M1** | 还原 `chinaStockStrategy.isVoiceAllowed` 移除 `if (!cfg.enabled) return true;` 前置 | 用例 5.1(6a) | 智能时段关闭态下 09:17 `timerShouldRun` 变为 `false`（期望 `true`），**确定性转红** |
| **M2** | 09:25 前守卫仅写在原地分支，追加分支保留 `Math.min(open, price)` | 用例 5.1(1a) | 追加路径下 Bar.low 锁定为 18.00（期望 20.00），**确定性转红** |
| **M3** | 移除 `STOCK_CN` 判定，实行无差别时间拦截 | 用例 5.1(3) | 美股/期货影线归零，`high=100.5, low=100.5`（期望 103/98），**确定性转红** |
| **M4** | 把 `chart.js:741` 的 `isFutureTimeline` 改为 `opts.isFuture === true`（剔除 `hasNonStockHours` 析取兜底） | 用例 5.1(4c/4d/4e) | 港股/美股/外盘期货轴塌缩为 253 固定网格，可见点数变为 3/6、0/5、0/4，**确定性转红** |
| **M5** | 还原 `voiceController.js` 全量播报分支 `spoken: null` | 用例 5.1(6b) | `memory.get('sh603533') === undefined`，断言失败，**确定性转红** |
| **M6** | 还原 `_correctLastIntradayPoint` 无 09:25 守卫 | 用例 5.1(5) | 09:25 点的 close 被改写为 20.20（期望 20.00），**确定性转红** |
