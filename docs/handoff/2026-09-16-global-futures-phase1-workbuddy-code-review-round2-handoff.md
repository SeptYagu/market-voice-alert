# WorkBuddy 独立代码审查 Round 2（Phase 1 国际期货落地）— 未通过

## 一、审查基本信息与通过项简述

- 被审 HEAD SHA：`9389bcd5e2b67c3c84a09f64c3e068cd3d54f76e`（= 待审提交 `9389bcd`，已核对一致）
- 基准 SHA：`adf057f3baf27a2e9dd1b6e1bdc6a14cf0cbb4bb`（`adf057f`）；上一轮被审 `4373343`（Round 1 报告 `9dcf1a1`）
- 实际审查范围：`adf057f..9389bcd`（22 文件 / +1985 −179）全文阅读，并以 `4373343..9389bcd`（6 文件 / +309 −46）为「本轮修复增量」逐项复核闭环；工作区干净，`git pull --ff-only` 无变更；仓库无 `docs/review-checklist.md`
- 通过项（极简）：**P1-1 / P1-2 已真闭环** —— 起真实服务端 + 真实 `fetchQuotes(['GL_CL0','GL_GC0','GL_HG0','GL_YM0','GL_A50','GL_HSI','hk00700','usAAPL','sh600519'])` 得 **9/9 报价**（`code`/`type`/`price`/`prevClose`/`priceDecimals`/`currency` 全对），按生产 `EASTMONEY_FIELDS` 直采真源回放 `parseEastmoney` 得 **15/15 PASS**；突变 `splitCodes` 分桶与 `f107` 字段表分别使新增用例转红（19/20）。`proxyRoutes` 主机轮转实测生效（`push2` 恒 502 → 自动落到 `push2delay`）。门禁实跑：`npm run lint` 0 问题、`npm test` **863/863**、`npm run build` 成功。
- 总体判定：**未通过**。**2×P2 + 6×P3**。Round 1 的 P2-1 / P2-2 **未闭环**（历史分时仍按北京日历日截断、交易日归属仍是「旧日历日判据 ∪ 新 `getTradingDay`」的并集），P3-1/P3-2/P3-3/P3-4/P3-5 中 4 项部分或完全未闭环，且对应验收断言缺失（4 组突变实测「缺陷存续时测试仍全绿」）。

---

## 二、审查发现与缺陷清单

### P2-1 服务端「历史日期」分时归档仍按北京日历日截断 —— Round 1 P2-1 的验收标准（差额 0）未达成

- **文件与行号**：`server/intradayService.js:230`（`const items = filterKlineItemsByDate(klineData.items, common.date);`）、`:159/181`（历史日期时 `if (allowLatestTickSource)` 整段跳过 tencent/trends2）、`:217-232`；孪生实现 `src/js/api.js:471`（客户端 kline 兜底）；谓词本体 `src/js/kline.js:600-603`（`filterKlineItemsByDate` 仍为 `chartTimeToDate(it.time) === date`）
- **触发条件**：任一「历史日期」（`date < 今日北京日期`）的外盘分时请求，即 `/api/cache/intraday?code=<GL_*>&date=<已完成交易日>`（客户端 `sharedCache: true` 首选路径）
- **实际行为（全新缓存根 `MARKET_VOICE_CACHE_ROOT` 实测，2026-09-17 05:3x 北京）**：
  ```
  GET /api/cache/intraday?code=GL_CL0&date=2026-09-16
    → source=eastmoney-kline-1m, n=1079, first=2026-09-16 06:01, last=2026-09-16 23:59, archiveComplete=true
  同 secid 102.CL00Y 真源同一交易日：
    trends2 n=1381 (2026-09-16 06:00 → 2026-09-17 05:00)；kline(klt=1) n=1380 (06:01 → 05:00)
  差额 = 1381 − 1079 = 302 根（21.9%）
  ```
  即：CME 交易日 `2026-09-16` 的 06:00 → 次日 05:00 连续窗口，被 `filterKlineItemsByDate` 在北京午夜切断，`2026-09-17 00:00–05:00` 的 301 根全部丢失；结果仍被 `isHistoricalSnapshotComplete`（`intradayService.js:136-145`，只需命中当日 `15:00`）判为 `archiveComplete: true`，客户端据此把它当作完整归档（`archiveCompleted` 语义见 `chartRowController` 的 `intradaySourceLabel`）。
- **期望行为**：Round 1 报告 §四.3 的验收标准原文为「`/api/cache/intraday?code=GL_CL0&date=<外盘交易日>` 的条数与直连 `trends2` 条数一致（**差额 0**）」；§5 亦要求「外盘分时无日内断裂」。按 §3.3.2，日期归属应改为 `strategy.getTradingDay(...)`，`filterKlineItemsByDate` 正是被要求「**废除**」的那类北京日历日比对。
- **根因**：Round 1 把 `filterIntradaySessions` / `isTradingSessionTime` 策略化（`intradayService.js:30-62`），但同一条 kline 兜底链上游还有**第三处**同款日历日谓词 `filterKlineItemsByDate` 未纳入改造面；而历史日期分支（`allowLatestTickSource=false`）恰好**只能**走这条 kline 链，故该分支被 100% 命中。属「同一根因的另一处未闭环」（历史反复出现的错层修复）。
- **影响范围**：全部 10 个外盘品种的历史分时图/导出在其交易日尾段（北京 00:00–05:00，约 22% 数据）缺失，图上最后一根停在 23:59 而非结算价；且被标记为「完整归档」，用户无从察觉。
- **复现方法/运行证据**：
  ```
  rm -rf <tmp-cache>; PORT=3199 MARKET_VOICE_CACHE_ROOT=<tmp-cache> node server/index.js
  curl "http://127.0.0.1:3199/api/cache/intraday?code=GL_CL0&date=2026-09-16" | jq '.data.source, .data.items|length'
  # → "eastmoney-kline-1m", 1079
  curl "https://push2delay.eastmoney.com/api/qt/stock/trends2/get?secid=102.CL00Y&fields1=...&fields2=...&ndays=1&iscr=0&iscca=0"
  # → data.trends.length = 1381（06:00 → 次日 05:00）
  ```
  （注：仓库内 `data/cache/intraday/GL_CL0/20260916-0p0000.json` 存在一份 `generatedAt=2026-09-16T21:06:41Z` 的旧缓存，其 `n=257`、`source=eastmoney-kline-1m`、区间 `09:15–15:00`；该文件生成于 `9389bcd`**之前**的工作树，属上一轮残留，**不代表本轮代码行为**，故本轮一律用全新缓存根复核。）
- **修复建议**：把 `filterKlineItemsByDate(klineData.items, common.date)`（`intradayService.js:230` 与 `api.js:471` 两处）替换为按 `resolveSessionStrategy(code).getTradingDay(it.time)` 归并的过滤器（与 `filterIntradaySessions` 共用同一函数），或在 kline 链上先做交易日归并再做会话区间过滤；同时让 `isHistoricalSnapshotComplete` 的「完整性」判据基于交易日窗口而非日历日（例如以会话末根时间而非 `15:00` 判定）。
- **修复后验收标准**：`/api/cache/intraday?code=GL_CL0&date=2026-09-16` 的 `items.length` 与该交易日 `trends2`/`kline(klt=1)` 的条数一致（差额 ≤ 1，允许端点首根差异）；把两处 `filterKlineItemsByDate` 任一改回日历日谓词时，该断言必须确定性转红。

### P2-2 交易日归属实现为「旧日历日判据 ∪ 新 `getTradingDay`」的并集 —— Round 1 P2-2 的「废除…改为」未实现，同一根 K 线归入两个 `date`

- **文件与行号**：`src/js/parser.js:535-536`（`const itemDate = _resolveRowTradingDay(...); if (itemDate !== selectedDate && chartTimeToDate(time) !== selectedDate) return null;`）、`src/js/api.js:350-353`（`_filterIntradaySessions`）、`server/intradayService.js:54-57`（`filterIntradaySessions`）
- **触发条件**：任何带 `date` 的外盘分时请求，请求日期 ≠ 载荷所属交易日，但载荷中存在「日历日 = 请求日期、交易日 = 请求日期 −1」的 K 线（即北京 00:00–结算休市结束 的尾段）
- **实际行为（真实 `102.CL00Y` trends2 载荷 1381 根，`2026-09-16 06:00 → 2026-09-17 05:00`，喂真实模块）**：
  ```
  parseEastmoneyTrends(json, {date:'2026-09-16', code:'GL_CL0'}).items.length = 1381  （全属交易日 09-16，正确）
  parseEastmoneyTrends(json, {date:'2026-09-17', code:'GL_CL0'}).items.length =  301
     其中 strategy.getTradingDay(item.time) === '2026-09-16' 的占比 = 301/301 = 100%
     → 交易日 2026-09-17（06:00 才开始）的正确结果应为 0 根
  客户端同一入口 fetchIntraday('GL_CL0', {date:'2026-09-17', sharedCache:false}) → n=301（source=eastmoney-trends2）
  服务端 GET /api/cache/intraday?code=GL_CL0&date=2026-09-17      → n=301（source=eastmoney-trends2）
  ```
  合成用例同样成立：`2026-09-16` 载荷中的 `01:00 / 05:00` 两根（策略判为交易日 `2026-09-15`）在 `date=2026-09-16` 请求下**被保留**。
- **期望行为**：§3.3.2 原文要求「**废除** `chartTimeToDate(it.time) !== selectedDate` 简单的北京日历日比对；**改为** `strategy.getTradingDay(it.time) !== selectedTradingDay`」。Round 1 §四.4 的验收标准是「外盘分时按交易日归属不切分：**date 语义与 `getTradingDay` 对齐**」。
- **根因**：实现把新判据与旧判据用 `&&` 负条件并集连接（`A !== d && B !== d → 丢弃`，即 `A === d || B === d → 保留`），旧判据既未删除、也未降级为兜底，结果 `date` 不再唯一标识一个交易日；同一根 K 线在 `date=T-1` 与 `date=T` 两次请求中都会出现，且 `date=T` 得到的是**上一个交易日**的尾段而非本交易日。
- **影响范围**：① 日期语义失真（分时/导出的「交易日」标签与实际内容不符）；② 归因错误在跨午夜时段（北京 00:00–06:00）必然出现，Phase 3 美股的 391 根同源受影响；③ §5「外盘分时按交易日归属不切分」不可验证（同一数据被两个交易日重复计入）；④ 与 P2-1 叠加时形成「今天拿到昨天的尾段、历史拿到被截断的半场」的双向错误。
- **复现方法/运行证据**：见上表；探针脚本直接 `import` 真实 `parseEastmoneyTrends` / `fetchIntraday` / `globalFuturesStrategy`，载荷为 `push2delay` 实采 `trends2` 原文。**测试有效性缺陷（同一缺陷的第二面）**：把 `parser.js:535-536` 还原为旧的单判据 `if (chartTimeToDate(time) !== selectedDate) return null;`（即完全撤销本轮的交易日归并），`tests/globalFutures.test.js` **20/20 仍全绿**；全仓 `grep -rn "getTradingDay" tests/` 只命中 `tests/integration/futuresServices.integration.js:18` 的无关字段 → 本轮的跨午夜归并**零测试覆盖**，Round 1 P2-2 的修复不可证伪。
- **修复建议**：三处一并改为**单一**判据（删除 `chartTimeToDate(...) !== selectedDate` 这一支），并新增用例：以「含跨午夜段的合成 trends2 载荷 / 或固化的真实载荷」驱动 `parseEastmoneyTrends` 与 `fetchIntraday`，断言 ① `date=<交易日 T>` 返回根数 = 该交易日按 `getTradingDay` 归并的根数；② `date=<T+1 的日历日>` 返回 **0 根**（或仅返回交易日 T+1 已开始的 K 线）；③ 任一根 K 线不得同时出现在两个 `date` 的结果里。
- **修复后验收标准**：`date='2026-09-17'`（载荷为 `2026-09-16` 交易日）断言 `items.length === 0`；把任一处的并集恢复成 `&&` 单判据时该用例必须转红。

### P3-1 `_resolveRowTradingDay` 与 `globalFuturesStrategy.getTradingDay` 同规则两套实现，结算休市窗口只按夏/冬其一硬编码

- **文件与行号**：`src/js/parser.js:511-526`（`if (min < 360) return shiftCalendarDate(dateStr, -1);` 及注释「CME settlement break ends at 06:00 (DST 360 min) / 07:00 (non-DST 420 min)」）；对照 `src/js/marketSession.js:246-263`（`const breakEnd = dst ? 6 * 60 : 7 * 60;`）
- **触发条件**：外盘 K 线落在北京 `06:00–06:59`（美股冬令时，约每年 11 月–次年 3 月）且请求 `date` 为该 K 线所属交易日
- **实际行为（真实模块 + 固定载荷）**：
  ```
  载荷: 2026-01-07 05:30 / 2026-01-07 06:30 / 2026-01-07 07:30   (code=GL_CL0, date=2026-01-06)
  globalFuturesStrategy.getTradingDay('2026-01-07 06:30') = 2026-01-06   ← 正确（冬令时结算窗 06:00–07:00）
  parseEastmoneyTrends(...).items.length = 1        ← 06:30 那根被丢弃
  期望（与策略一致）= 2
  同载荷 date=2026-01-07 → 3 根（06:30 被错误归入 T+1，且 05:30 的 T 日根也被并入）
  ```
- **期望行为**：同一「结算休市结束时刻」规则在整仓只应有一处权威实现；`date` 归属应与 `getTradingDay` 一致（Round 1 §四.4）。
- **根因**：Round 2 新增 `_resolveRowTradingDay` 时把 DST 分档写成固定 `min < 360`，而**同一次提交**新增的 `globalFuturesStrategy.getTradingDay` 已实现 `dst ? 360 : 420`；两套实现在冬令时相差 1 小时，且注释已自述应为 420 却未落码。
- **影响范围**：冬令时外盘分时在交易日尾段丢 1 小时（约 60 根）；同时把该 1 小时错误并入次日 `date`（与 P2-2 的并集叠加）。`parseEastmoneyTrends` 的 `opts.getTradingDay` 在生产调用链（`api.js:363` `{...opts, code}`、`server/marketData.js:209`）**从未传入**，故启发式分支是实际生效路径。
- **复现方法/运行证据**：见上（探针 `import` 真实 `parser.js`/`marketSession.js`，`TZ=Asia/Shanghai`）。
- **修复建议**：删除 `_resolveRowTradingDay` 的启发式，改为调用 `resolveSessionStrategy(code).getTradingDay(time)`（或在 `fetchEastmoneyTrends` 传入 `getTradingDay`），使全仓只有 `marketSession.js` 一处维护该规则。
- **修复后验收标准**：冬/夏两个固定时钟（如 `2026-01-07 06:30+08:00` 与 `2026-07-08 05:30+08:00`）下，`parseEastmoneyTrends` 的归属结果与 `globalFuturesStrategy.getTradingDay` **逐根一致**；把 `breakEnd` 固定为 360 或用例时钟切到另一季时断言必须转红。

### P3-2 Round 1 P3-1 只闭环了生产者：4 个品种的小数位仍与注册表不符，且验收断言缺失

- **文件与行号**：消费者 `src/js/tts.js:226-227`、`src/js/alert.js:96-97`、`src/js/views/monitorTableView.js:97/340`、`src/js/services/batchExportService.js:107`（均为 `priceDecimals === 3 || priceDecimals === 4 ? (priceDecimals || 3) : 2`）；生产者已闭环：`src/js/parser.js:314-315`、`:418-419`
- **触发条件**：任意外盘报价的播报 / 表格 / 导出
- **实际行为（真实 `formatQuoteSpeech` 实测，价格取各品种典型档位）**：
  ```
  GL_CL0 (dec=2) → "纽约原油，102.02，跌 0.70"        OK
  GL_SI0 (dec=3) → 3 位                              OK
  GL_HG0 (dec=4) → "纽约美铜，6.4415"                 OK
  GL_GC0 (dec=1) → "纽约黄金，4302.50"                MISMATCH（注册表 1 位）
  GL_A50 (dec=1) → 1 位分支被 `: 2` 吃掉              MISMATCH
  GL_YM0 (dec=0) → "道琼斯期货，51904.00"             MISMATCH
  GL_HSI (dec=0) → "恒生指数期货，51904.00"           MISMATCH
  ```
- **期望行为**：Round 1 报告 §四.5：「`formatQuoteSpeech`/`formatAlertMessage`/表格/导出对小数列按注册表输出（**`GL_GC0` 1 位**、`GL_SI0` 3 位、`GL_HG0` 4 位）」。
- **根因**：消费者只把 `priceDecimals ∈ {3,4}` 映射进分支，`0/1/2` 一律回落 `2`（`priceDecimals || 3` 的对象身份判别式选错了值域）；生产者写入的元数据因此仍有 4/10 品种被忽略。
- **影响范围**：播报/表格/导出的小数位与注册表不一致（数值不错误，属精度元数据未被消费；`GL_GC0` 白名单外的 `priceDecimals` 无任何消费路径）。**测试有效性**：删除 `parser.js:314-315` 与 `:418-419` 两处生产者字段后，`tests/globalFutures.test.js` **20/20 仍全绿** → 新增用例 `:398-428` 只断言「含 `103.72`」「含/不含 元/港币/美元」，对小数位零判别力。
- **复现方法/运行证据**：探针调用真实 `formatQuoteSpeech`/`formatAlertMessage`，逐品种打印实际小数位与 `GLOBAL_FUTURES_CATALOG[*].priceDecimals` 比对（输出见上）；变异 M3 见「测试有效性」。`GL_GC0` 的告警文本实测为 `纽约黄金 涨幅 1.20，现价 4302.50`。
- **修复建议**：把消费者改为直接使用元数据（`Number.isInteger(quote.priceDecimals) && quote.priceDecimals >= 0 ? quote.priceDecimals : 2`），保留 `priceTick < 0.01 → 3` 的既有兜底；并新增断言：`GL_HG0` 4 位、`GL_GC0` 1 位、`GL_YM0`/`GL_HSI` 0 位，同时断言表格/导出同口径。
- **修复后验收标准**：上述 4 类断言全绿；移除 `parseEastmoney`/`parseSinaGlobalFuture` 的 `priceDecimals` 生产字段、或把消费分支改回 `{3,4}` 白名单时，用例必须确定性转红。

### P3-3 Round 1 P3-2 只闭环一半：未收录美股符号仍静默使用错误 marketId（无探测、无显式降级）

- **文件与行号**：`src/js/parser.js:146`（`const marketId = known || '105';`）、`:131-148`（`resolveUsMarketId`）、`:117-129`（新增的 `setUsMarketId`）、`:273`（`parseEastmoney` 成功时回写）
- **触发条件**：任何不在 `US_MARKET_MAP`（`parser.js:96-114`，17 条）内的美股符号走东财兜底
- **实际行为（真源实测）**：
  ```
  resolveUsMarketId('BA') = '105';  toEastmoneySecId('usBA') = '105.BA'
  105.BA → rc=100  data=null      （错误市场：parseEastmoney 返回 null，报价永久缺失）
  106.BA → rc=0    f58='波音' f107=106 → parseEastmoney = {code:'usBA', price:201.96}   （正确市场）
  ```
  因错误 secid 恒返回 `data=null`，`parseEastmoney` 在 `:243` 早退 → `:273` 的 `setUsMarketId` 永不执行 → 新增的双层缓存在此路径上**不会被写入**，缺陷形态与 Round 1 完全一致（`usBA → 105.BA → rc:100`）。
- **期望行为**：Round 1 报告 P3-2 的两种闭环方式之一 —— ① §3.1.1.1「未收录时对 `105/106/107` 三大市场号依次探测，首个 `rc=0` 者为准，并立即写入内存与本地持久化缓存」；或 ② 「明确收敛为登记表并把未登记符号显式降级为『暂不支持』而非静默用错的 secid」。本轮两者皆未实现。
- **根因**：只补了「成功时写缓存」，未补「失败时先探测/再降级」，`known || '105'` 的默认值仍是无依据的错误市场号。
- **影响范围**：Phase 3 未收录美股标的在腾讯源失败时恒无报价，且用户侧呈现为「有代码、无行情」而非「暂不支持」；不得用于判定 Phase 1 结论，但属 Round 1 明确点名的未闭环项。
- **复现方法/运行证据**：见上（`push2delay` 双 secid 对照，含正确/错误对照组，排除网络抖动）。
- **修复建议**：实现 `105/106/107` 顺序探测（首个 `rc=0` 即写 `setUsMarketId` 并返回），或删掉 `|| '105'` 兜底、把未收录符号显式标记为不支持（返回 `null` 并在报价层标记 `unsupported`）。
- **修复后验收标准**：`toEastmoneySecId('usBA')` 解析出 `106.BA`（探测路径）或返回 `null`（降级路径），二者之一且有用例覆盖；把 `known || '105'` 还原时用例必须转红。

### P3-4 Round 1 P3-3 行为已修但零断言：备源 `quoteDate` 的 8 位契约不可验证

- **文件与行号**：`src/js/parser.js:396`（已修为 `quoteDate: date ? date.replace(/-/g, '') : ''`）、消费方 `src/js/kline.js:461-462`（`quote.quoteDate.length === 8` 守卫）
- **触发条件**：新浪备源（`parseSinaGlobalFuture`）报价回灌 `applyLiveQuoteToKline`
- **实际行为**：生产代码已输出 8 位（`'20260917'`），消费方的「按日追加新 Bar」分支（`kline.js:467` 附近）由死代码恢复为可达；但**没有任何断言**。把 `parser.js:396` 还原为 `quoteDate: date`（10 位）后，`tests/globalFutures.test.js` **20/20 仍全绿**；该文件 `:211-243` 的两个用例只断言 `price/prevClose/change/changePercent`，`quoteDate` 从未被断言。
- **期望行为**：Round 1 P3-3 的修复后验收标准原文为「备源报价的 `quoteDate.length === 8`，且复用 `applyLiveQuoteToKline` 时原本的日期分支可达」。
- **根因**：修复只改生产代码，未把「契约 + 分支可达性」写成断言（Round 1 的 §四 未单列该条，本轮的验收清单也把它略过）。
- **影响范围**：本轮唯一位于「已修但完全不可证伪」状态的修复项；后续任何把 `quoteDate` 改回 10 位（或引入其他格式）的回归都不会被告警。
- **复现方法/运行证据**：变异 M5（`quoteDate: date ? date.replace(/-/g,'') : ''` → `quoteDate: date`）→ `tests/globalFutures.test.js` 20 pass / 0 fail。
- **修复建议**：在 `parseSinaGlobalFuture` 用例中补 `t.equal(quote.quoteDate.length, 8)` 与 `t.equal(quote.quoteDate, '20260916')`；再补一条以该报价调用真实 `applyLiveQuoteToKline` 的断言，要求命中追加分支（条数 +1）而非原地覆盖。
- **修复后验收标准**：上述两条断言在 8 位实现下全绿、在 10 位变异下必红。

### P3-5 Round 1 P3-4 完全未处理：`getFuturesSessionRanges` 对国内期货仍不可达，唯一消费方仍是恒真断言

- **文件与行号**：`src/js/futures/session.js:187-221`（导出）、`src/js/marketSession.js:133-136`（唯一调用点 `chinaFuturesStrategy.getIntradaySessionRanges`）、`src/js/api.js:265-274`（`_isTradingSessionTime`）、`src/js/api.js:403-405`（`fetchIntraday` 首行 `if (isFutureCode(code)) return fetchFuturesIntraday(code, opts);`）；用例 `tests/globalFutures.test.js:270-271`
- **触发条件**：对 `RB0/AU0/T0/IF0` 请求分时
- **实际行为**：`_isTradingSessionTime` 仅由 `_filterIntradaySessions`（`api.js:435/446/457/473`）调用，而后者只存在于 `fetchIntraday` 的**非期货分支**；国内期货在首行即提前返回走 `fetchFuturesIntraday`（服务端 `/api/cache/futures/intraday`）。故该导出对国内期货仍**不可达**，唯一消费者是测试自身的 `t.true(getFuturesSessionRanges('RB0', time2130).length > 0)`（`:270-271`，任何实现下都恒真）。本轮 `4373343..9389bcd` 增量对 `src/js/futures/session.js` **零改动**。
- **期望行为**：Round 1 P3-4 的修复建议原文给出了两条可接受出路 —— 「要么让国内期货分时的窗口判定也接入该导出（服务端 `futures` 分时链路），要么在报告中如实收敛该盲点结论；并补充一条『断言该函数在真实 `fetchIntraday('RB0')` 路径上被调用』的用例」。
- **根因**：验收断言与真实执行路径错层（Round 1 已指出），本轮未处理。
- **影响范围**：Phase 1 验收中「国内期货分时区间导出补齐」这一条仍无实际效果；对 Phase 1 外盘结论无影响。
- **复现方法/运行证据**：`grep -rn "_isTradingSessionTime\|getFuturesSessionRanges" src/` 仅得 `api.js:265/274` 与 `marketSession.js:135`（`chinaFuturesStrategy` 分支），且 `api.js:403-405` 表明该分支对 `isFutureCode` 不可达；`grep -rn "getFuturesSessionRanges" tests/` 仅 `globalFutures.test.js:270-271`。
- **修复建议**：在服务端 `/api/cache/futures/intraday` 链路的窗口判定中接入该导出，或删除该导出并在 `STATUS.md`/方案中如实收敛「国内期货分时区间不通过该导出实现」；同时把 `:270-271` 换成可证伪断言（例如断言 `fetchIntraday('RB0')` 路径上窗口函数被调用、或断言服务端 futures 分时返回的根数与窗口一致）。
- **修复后验收标准**：该断言在所声称的真实链路上可被变异证伪（撤销接线后必红）。

### P3-6 Round 1 P3-5 未闭环：`hf_` 不相交断言仍恒真，§5 缺项断言仍有 3 项完全缺失 / 2 项弱化

- **文件与行号**：`tests/globalFutures.test.js:455-464`（`全局搜索候选项与内部 hf_* 集合完全不相交 (∩ ^hf_ = ∅)`）、`:330-354`（新增的 16:00 用例用 `GL_CL0`）、`:235-243`（新增 15 字段用例）、`:437-453`
- **实际行为（探针实测）**：`createStockSearchIndex({items: []})` 产出 **75** 条索引，其中 `^hf_` 命中 **0** 条（构造来源只有 `PRODUCT_MAP` + `GLOBAL_FUTURES_CATALOG`，另加股票字典与既有期货表）→ `:460-461` 两条 `t.false(/^hf_/i.test(...))` 在任何实现下都不可能为假（同义反复）。Round 1 已明确指出该点并要求「删除/替换恒真断言为可证伪形式（如…注入一个 `hf_` 条目验证过滤生效）」；本轮该用例文字未变。**§5 七项缺项断言的本轮落实情况**：① `transitionNotice === null`（22:00）已补（`:327`）；③ 冬夏结算窗口已补（`:289-301`，断言成立：夏 `05:30` false / `06:30` true，冬 `05:30` true / `06:30` false）；② 16:00 用例已补但标的用 `GL_CL0` 而非验收原文的 `GL_HSI`（`:331`）；⑥ `parseSinaGlobalFuture` 仍只断言 4 个字段（`:239-242`），非「15 字段逐位」；**④ 代理出网兜底与 `push2delay` 轮转断言、⑤ 主备源涨跌幅跳变 `< 0.6pp` 守卫、⑦ `resolveSessionStrategy('hf_CL') === globalFuturesStrategy` 等对象同一性断言 —— 三项完全缺失**（`grep -rn "resolveSessionStrategy" tests/globalFutures.test.js` 仅见 `.assetType` 断言，无对象同一性）。
- **期望行为**：Round 1 P3-5 的修复建议：删除/替换恒真断言为可证伪形式；补齐 §5 的 7 项验收断言，并对每一项标注变异方式与「变异后必红」的实测结果。
- **根因**：本轮把精力集中在 P1/P2 的主项，验收清单的尾部项只部分落实，且沿用「集合取交为空」这种依赖构造来源的写法。
- **影响范围**：`hf_*` 准入契约（`normalizeCode('hf_*') === null` 已在 `parser.js:66-67` 且有用例）仍有既有防线，但搜索侧过滤 `stockSearchService.js:776-777` 的 `.filter(...)` 是死代码；代理轮转与跨源跳变两项**没有任何用例**，本轮新增的 `HEALTHY_HOST_CACHE` / 轮转逻辑与 P3-2 的 `sinaScale` 跨源差异都不会被门禁发现。
- **复现方法/运行证据**：探针统计 `createStockSearchIndex({items: []}).items` 共 75 条、`^hf_` 0 条、12 个查询候选共 32 条且无一条匹配 `^hf_`；`grep` 结果见上。
- **修复建议**：把 `:455-464` 改为「向索引注入一条 `hf_*` 条目 → 断言 `searchStocks` 结果中仍无该条目」（证伪 `stockSearchService.js:776` 的过滤真的生效）；补齐 ④⑤⑦ 三项断言（⑦ 可直接 `t.equal(resolveSessionStrategy('hf_CL'), globalFuturesStrategy)`，对象同一性在 `marketSession.js:270-281` 下成立）；② 改用 `GL_HSI`。
- **修复后验收标准**：注入 `hf_` 条目后过滤用例转红（未注入时绿）；④⑤⑦ 断言全部存在且在对应变异下必红。

---

## 三、待确认风险与未验证项

**待确认风险**

1. **`GL_A50` 会话尾段窗口偏窄（单日证据，不足以定级）**：`globalFuturesStrategy.getIntradaySessionRanges`（`src/js/marketSession.js:242-245`）对 10 个品种返回**同一个**静态窗口（DST `[[360,1440],[0,300]]`），而真源 `104.CN00Y` 实测该交易日（`2026-09-16 16:45 → 2026-09-17 05:15`，751 根）最后一根落在 **05:15**，超出 `[0,300]` 15 分钟 → 按窗口过滤后为 **736** 根，`05:01–05:15` 的 15 根被丢弃。本轮修复使该静态窗口首次成为外盘分时的**唯一**绑定过滤器（此前被 A 股窗口提前覆盖），属本轮**新暴露**而非新引入。**未定级原因**：`ndays=2/3/5`、`klt=1` 带 `beg/end` 三种取法在该 secid 上均只返回最近一个交易日（东财忽略历史区间），**无法做多日重复采样**；按本仓历史教训（不得以单样本外推为机制性事实），暂列待确认。**验证方法**：具备多日 `104.CN00Y` 分钟线（如 AKTools/`trends2` 历史接口）后，逐交易日统计末根时刻；若稳定为 `05:15`，则应把窗口 per-product 化（A50 `[0,315]`）并补断言。
2. **`isTradingSessionTime` / `getTradingDay` 的 DST 与时钟来源耦合**：`src/js/api.js:349` 与 `server/intradayService.js:40` 用**当前时刻**的 `new Date()` 决定请求窗口的夏/冬档；对**历史日期**的请求会用「今天的 DST 状态」去裁「历史那天」的窗口（冬夏令时跨界 ±1 小时）。本机无法构造跨界历史分时（上游不回历史分钟），未量化。验证方法：固定时钟跑 `2026-01-07`（冬）与 `2026-07-08`（夏）两个历史日期的 `fetchIntraday`/`getCachedIntraday`，比对同一载荷的保留根数差异。
3. **`globalFuturesStrategy.getTradingDay(number)` 的 DST 判定用 `new Date(now * 1000)`**（`src/js/marketSession.js:252`）：`chartSeconds` 是「北京墙钟当 UTC 编码」的伪时间戳，与真实瞬时相差 8 小时，在春秋换季前后约 8 小时内可能误判 DST 档（进而差 1 小时归属）。未构造用例；影响面为每年两次的换季窗口。
4. `HEALTHY_HOST_CACHE`（`server/proxyService.js:11/37-46/67-72`）对 `status < 500`（含 403/404）一律记为「健康主机」。本机 `push2` 恒 502 → 轮转正确落到 `push2delay`（实测三端点 `rc=0`）；若某主机会以 200 + HTML 错误页响应，健康缓存会把该主机优先 60s。本机未复现该形态，未量化。

**未验证项（受环境限制）**

1. Playwright E2E（`e2e/`，75 项）：本机未运行（需浏览器与运行中的服务端 + AKTools）。已运行门禁为 `lint`（0 问题）、`npm test`（**863/863**）、`npm run build`（成功）。E2E 对本轮缺陷的判别力未知。
2. 真实浏览器端到端（`state.quotes` → 盯盘表格 → 语音 → 分时图渲染）：本轮以「真实服务端 + 真实 `fetchQuotes`」完成报价链路的端到端（9/9），但未在浏览器内观察分时图对 P2-1/P2-2 产物的渲染形态（图上是否出现上一交易日尾段）。
3. 多日外盘分钟线：用于 A50 会话尾段与冬令时归属的重复采样（见待确认风险 1、2、3）。本机东财对该 secid 忽略 `beg/end` 与 `ndays>1`。
4. AKTools 相关分支：本机未启动 `127.0.0.1:8888`，`fetchAktoolsHistMinute` 等分支未复现。

---

## 四、推荐修复顺序与复审验收标准

**修复顺序**

1. **P2-1**（`filterKlineItemsByDate` → 交易日归并，`server/intradayService.js:230` + `src/js/api.js:471`）：历史分时归档的数据完整性，且是「差额 0」验收的直接承载项；同时修 `isHistoricalSnapshotComplete` 的完整性判据。
2. **P2-2**（三处并集 → 单一 `getTradingDay` 判据，`parser.js:535-536` / `api.js:350-353` / `intradayService.js:54-57`）+ 同步补跨午夜归属用例：修完 P2-1 后，同一组用例可同时覆盖两条链路。
3. **P3-1**（删除 `_resolveRowTradingDay` 启发式，统一委托 `resolveSessionStrategy(code).getTradingDay`）：与 P2-2 落在同一函数，建议一次改净，避免第三套规则。
4. **P3-4 / P3-2**（补 `quoteDate` 8 位与小数位断言、把消费者改为直接读 `priceDecimals`）：纯断言 + 值域修正，风险低。
5. **P3-3**（美股 105/106/107 探测或显式降级）→ **P3-5**（`getFuturesSessionRanges` 落点或如实收敛）→ **P3-6**（替换恒真断言、补齐 ④⑤⑦ 与 ②）。

**复审验收标准（缺一不可）**

1. `/api/cache/intraday?code=GL_CL0&date=2026-09-16` 条数与该交易日 `trends2`/`kline(klt=1)` 一致（差额 ≤ 1）；把 `intradayService.js:230` 或 `api.js:471` 的过滤器还原为日历日版本时用例必红。
2. 以真实（或固化真实）跨午夜载荷断言：`date=<交易日 T>` 根数 = 按 `getTradingDay` 归并的根数；`date=<T+1 日历日>` 为 **0 根**；任一根 K 线不得同时出现在两个 `date` 的结果中；把并集还原为单判据时必红。
3. 冬/夏两个固定时钟下 `parseEastmoneyTrends` 的逐根归属与 `globalFuturesStrategy.getTradingDay` 完全一致；`breakEnd` 固定为 360 时必红。
4. `formatQuoteSpeech`/`formatAlertMessage`/表格/导出：`GL_HG0` 4 位、`GL_GC0` 1 位、`GL_YM0`/`GL_HSI` 0 位；删除生产者 `priceDecimals` 字段或把消费白名单改回 `{3,4}` 时必红。
5. 备源报价 `quoteDate.length === 8` 且复用 `applyLiveQuoteToKline` 时命中追加分支；改回 10 位时必红。
6. 未收录美股符号：`toEastmoneySecId('usBA')` 得 `106.BA`（探测）或 `null`（降级），二者之一且有用例；还原 `known || '105'` 时必红。
7. `getFuturesSessionRanges` 在其所声称的真实链路上可被变异证伪，或在 `STATUS.md`/方案中如实收敛该盲点并同步删除恒真断言。
8. `tests/globalFutures.test.js` 的 `^hf_` 断言改为「注入 `hf_` 条目 → 过滤生效」形式；④（代理轮转）、⑤（主备跨源跳变守卫）、⑦（`resolveSessionStrategy('hf_CL')` 对象同一性）三项断言补齐，② 改用 `GL_HSI`。
9. `npm run lint` 0 问题、`npm test` 全绿（含新增用例）、`npm run build` gzip ≤125.10 KB；本轮所有新增断言均须给出「变异后必红」的实测记录。

---

**审查范围声明**：本报告全部结论对应 `9389bcd5e2b67c3c84a09f64c3e068cd3d54f76e`（基准 `adf057f3baf27a2e9dd1b6e1bdc6a14cf0cbb4bb`）。未修改任何产品代码或正式测试；探针脚本均置于仓库外（`%TEMP%\mva-r2`、`%TEMP%\mva-mut`），仓库工作区保持干净。
