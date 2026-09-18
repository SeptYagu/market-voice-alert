# WorkBuddy 独立代码审查 Round 2 Handoff — 集合竞价日K下影线消除 / 分时图纳入 / 语音时段去重（代码落地修复轮复查）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`b268a38ed6ced86f08c20c66ff047e92c0bf7a5e`（`main` 与 `origin/main` 同步，`git pull --ff-only` → already up to date，工作区干净）；基准 `7c955b0`；任务书范围 `7c955b0..b268a38` = 11 文件 / +784 −27；本轮修复提交自身增量 `d3f415b..b268a38` = 5 文件 / +206 −47（另含 `84dbaf9` 的上一轮报告文档）。
- 门禁实跑复核：`npm test` **892/892 全绿**（较上一轮 890 +2，新增 `5.1(1c)`/`5.1(1d)`）。
- **通过项（极简）**：Round 1 的 4 项缺陷均已落地且**判别力实跑复核成立**——P1-1（09:25 交接重基线，生产入口冻结墙钟 09:18→09:25:03 得 `low=20.50`，不再回落 19.60）、P2-1（判别用例：以 `7c955b0` 基线当"去守卫变异体"回放，5.1(1a) `high` 22≠18、`low` 18≠20.5 转红；5.1(2) `low` 18≠20.5 转红）、P2-2（`1w`/`1M` 09:18 脏 `low=18` 被拒，`low=21` 保持，基线回放 18≠21 转红）、P3-1（`now` 沿 `applyLiveTick`→`applyLiveTickToKlineChart` 下发，用例注入固定时刻）。需求 2/3 相关代码本轮未改动（`chart.js`/`marketSession.js`/`voiceController.js` 均不在本轮 diff），沿用上一轮已核结论。
- 独立验证：新增 7 组探针（生产入口冻结墙钟序列、`[00:00,09:15)` 窗口、分钟周期矩阵、`1w/1M` 越界价矩阵、期货豁免可达性、时钟边界、基线变异回放），其中 3 组成功构造反例 → 本轮发现 **2×P2**，判定**未通过**。
- 命名说明：模板要求的 `docs/handoff/2026-09-18-workbuddy-code-review-round2-handoff.md` 已被同日「集合竞价方案设计 Round 2」占用，为避免覆盖历史结论，沿用上一轮口径采用任务前缀名。

---

## 二、审查发现与缺陷清单

### P2-1 `lastDate === targetDate` 空洞未闭环：09:15 前上一交易日的**已收盘**日K柱被压成四价相等的 `preview` 柱并持久保留

- **严重级别**：P2
- **文件与行号**：
  - 缺陷点：`src/js/kline.js:498-509`——`:498` 只挡 `lastDate > targetDate`，未挡 `lastDate === targetDate`；`:499-509` 随即把末柱写成 `open=high=low=close=price` 并附 `preview: true` / `previewDate`。
  - 关联路径：`src/js/controllers/chartRowController.js:550`（`resolveLiveFallbackDate`）、`src/js/tradeCalendar.js:118-123`（09:15 前锚定上一交易日）、`src/js/app.js:1214-1224`（`futureCodes.length && isFuturesMarketOpen(...) → return true`）、`src/js/app.js:1491`/`:1603`（工具栏与启动期无门禁 `refreshNow()`）、`src/js/controllers/chartRowController.js:354`（官方K仅在挂载/换周期/强刷时重载，全仓无周期刷新）。
- **触发条件**：A 股 + `period === '1d'` + 北京时间 **00:00:00–09:14:59**（此时 `resolveStockChartDate` 锚定上一交易日 ⇒ `targetDate === 末柱日期`）+ 该标的图表处于展开状态且发生一次行情刷新。刷新可达性有三条独立路径：① 30s 轮询的期货豁免门（`app.js:1218`，实测 `isFuturesMarketOpen` 对 `AU0`/`RB0` 在北京 02:00 与 09:05 均为 `true` ⇒ 自选含任一开市期货即放行）；② 工具栏手动刷新（`toolbarView.js:77 → app.js:1491`）；③ 启动期 `refreshNow()`（`app.js:1603`，无门禁，与已展开图表合流）。
- **实际行为**（生产入口 `ChartRowManager.applyLiveTick` + 冻结墙钟实跑，`items` 末柱为上一交易日 `2026-09-17` 官方柱 o/h/l/c=20.5/22.5/20.0/21.0）：

  ```
  clock 02:00: n=2 | last=2026-09-17 o/h/l/c=21/21/21/21 preview=true previewDate=2026-09-17
  clock 09:05: n=2 | last=2026-09-17 o/h/l/c=21/21/21/21 preview=true previewDate=2026-09-17
  clock 09:15: n=3 | prev=2026-09-17 o/h/l/c=20.5/22.5/20/21 preview=undefined | last=2026-09-18 o/h/l/c=21/21/21/21 preview=true
  clock 10:00: n=3 | prev=2026-09-17 o/h/l/c=20.5/22.5/20/21 (正常)
  承接：09:05 压平后 09:30 / 14:55 再 tick → prev 柱仍为 {open:21,high:21,low:21,close:21,preview:true}（不回弹）
  ```
- **期望行为**：`targetDate` 指向已收盘交易日（非当日交易时段）时，末柱只允许 `close` 就地修正，`open/high/low` 必须保持官方值；预览态（四价收敛 + `preview` 标记）只应作用于**当日盘中柱**。
- **根因**：预览态语义隐含假设「末柱 = 当日盘中柱」，而 `targetDate` 由 `quote.tradingDay || quote.date || quote.quoteDate || resolveLiveFallbackDate(...)` 决定，09:15 前必然解析为上一交易日 ⇒ 末柱虽为**已收盘柱**却满足 `=== targetDate`，被无条件当作"今日临时柱"压平。上一轮已把该场景（待确认风险 3）列为"未证实可达、建议补 `lastDate === targetDate` 判定"，本轮只补了 `lastDate > targetDate` 分支，并新增 `preview` 标记，使已收盘柱被标注为预览态（`preview` 在本仓库仅 `kline.js:559` 一个消费者，无法自行清除）。
- **影响范围**：默认周期（`DEFAULT_PERIOD='1d'`）下图表的**上一交易日蜡烛影线全失**（视觉上退化为无影线的窄实体），自 tick 起持续到图表重载（无周期刷新）；`items` 中残留一个永不消费的 `preview` 柱。属跨品种无差别（仅 A 股分支）。
- **复现方法 / 运行证据**：
  1. 纯函数：`applyLiveQuoteToKline([{time:'2026-09-17',open:20.5,high:22.5,low:20,close:21},...], {price:21.0, date:'2026-09-17'}, '1d','sh600519', new Date('2026-09-18T09:05:00+08:00'))` → 末柱 `21/21/21/21 preview=true`（无日期输入走 `targetDate=null` 亦同）。
  2. 生产入口：`ChartRowManager.applyLiveTick('sh600519', {price:21.0})` + `Date` 替身冻结 02:00/09:05 + `getTradingDates()=['2026-09-16','2026-09-17','2026-09-18']` → 见上表。
  3. 对照 `d3f415b` 基线（同一输入）：同样压平为 `21/21/21/21`（**四价压平子行为来自上一轮**，本轮新增的是 `preview` 标记与 `>` 早退），`09:15:00` 起两种实现均转为追加当日柱。
  4. 可达性：`isFuturesMarketOpen(new Date('2026-09-18T02:00:00+08:00'), ['2026-09-16','2026-09-17','2026-09-18'], ['AU0']) === true`；09:05 对 `RB0`/`AU0` 同为 `true`（`app.js:1218` 早退 ⇒ 会话门禁被旁路）。
- **修复建议**：在 `kline.js:499` 前收紧进入条件——`const isTodayInProgress = targetDate && lastDate === targetDate && targetDate === getBeijingDate(now);`，仅当其为真才写预览柱（`open=high=low=close=price` + `preview`），否则 `return items`（保持官方柱）。同时保留 `:498` 的 `>` 早退。若希望最小改动，也可用「报价快照日期是否等于当前北京日期」作为预览态判据。
- **修复后验收标准**：① 冻结 02:00 / 09:05 于生产入口触发 tick 后，上一交易日柱四价恒为 `20.5/22.5/20/21` 且不含 `preview`；② 09:15:00–09:24:59 仍追加当日 `preview` 柱、09:25:03 重基线为 `20.5/20.5/20.5/20.5` 且清除 `preview`；③ 新增该窗口用例，且对「去掉 `lastDate === targetDate && 当日` 校验」做定点变异后确定性转红；④ `npm test` 全绿无回归。

---

### P2-2 非 1d 盘前分支把分钟周期一并纳入：分钟柱出现 `close ∉ [low, high]`，且上一交易日末根分钟柱被次日盘前虚拟价覆写

- **严重级别**：P2
- **文件与行号**：`src/js/kline.js:511-519`（`// Non-1d periods (1w, 1M etc.) of A-shares during pre-open` 注释下的 `const updated = { ...last, close: price }` 分支，条件实际为 `isAStock && min < 09:25 && period !== '1d'`）；契约对照 `src/js/kline.js:425-431`（模块注释：分钟周期须扩展 `high/low` 以涵盖现价）与 `:440-445`（`isMinutePeriod` 扩展极值）；周期取值域 `src/js/kline.js:13-22`（`1m/5m/15m/30m/60m`）、UI 入口 `src/js/views/monitorTableView.js:200` + `chartRowController.js:518-544`。
- **触发条件**：A 股 + `period ∈ {1m,5m,15m,30m,60m}` + 北京时间 09:15:00–09:24:59 + 一次对象形态的行情刷新（工具栏手动刷新任意时刻可达；自动路径见 P2-1 的期货豁免门）。此时 `items` 末柱通常为**上一交易日**的分钟柱（当日尚无分钟数据）。
- **实际行为**（真实模块实跑，输入末柱 o/h/l/c=10/10.5/9.9/10.4，`quote={price:12,open:10.2,high:12.5,low:8.8}`，09:18）：

  ```
  1m : close=12 high=10.5 low=9.9  closeInRange=false
  5m : close=12 high=10.5 low=9.9  closeInRange=false
  15m: close=12 high=10.5 low=9.9  closeInRange=false
  30m: close=12 high=10.5 low=9.9  closeInRange=false
  60m: close=12 high=10.5 low=9.9  closeInRange=false
  ```
  即 `close(12) > high(10.5)`：本轮改动把上一轮"脏极值被吸纳"（基线 `high=12.5,low=8.8`，至少在区间内）换成了**非法 OHLC**（`chart.js:296-298 setKline` 原样送入 `candleSeries.setData`，无归一化）。
- **期望行为**：分钟柱的 `high/low` 必须涵盖现价（模块注释契约）；盘前虚拟价不得写进上一交易日的分钟柱。盘前冻结语义按上一轮要求仅适用于 `1w`/`1M` 聚合周期。
- **根因**：本轮 P2-2 修复把上一轮"聚合周期冻结"的措辞落成了 `period !== '1d'` 这一枚举补集，未排除分钟周期；而冻结式更新（只改 `close`、不 min/max）本身对"需要涵盖现价"的分钟柱不成立。
- **影响范围**：A 股分钟图（UI 提供全部 8 个周期）在盘前窗口出现非法蜡烛（渲染层会画出实体越出影线的柱），并且该非法状态写在**上一交易日**的最后一根分钟柱上（直到官方分钟数据重载）。
- **复现方法 / 运行证据**：见上表（`applyLiveQuoteToKline(items, quote, period, 'sh600519', new Date('2026-09-18T09:18:00+08:00'))`，`period` 取 5m 等）；同输入在非 A 股代码（走默认分支）得 `10/12.5/8.8/12`（区间内），可对照证明差异由本轮新增分支引入。
- **修复建议**：把 `kline.js:511-519` 的适用范围由 `period !== '1d'` 收窄为**聚合周期**（`period === '1w' || period === '1M'`），分钟周期回落到默认合并分支（或显式复用 `isMinutePeriod(period)` 的扩展语义）；若确需盘前屏蔽脏极值，应对分钟周期采用「`high = Math.max(lastHigh, ...)`/`low = Math.min(...)` 但只消费 `price`」而非完全冻结。
- **修复后验收标准**：① 上述 5 个周期在 09:18 实测 `close ∈ [low, high]`；② 上一交易日末根分钟柱的 `close` 不被改写（或明确设计为准许并给出说明）；③ 新增 1m/5m 盘前用例，`1w`/`1M` 冻结与 `1d` 四价收敛用例不回归；④ 对「把条件放回 `period !== '1d'`」做定点变异后必定转红；⑤ `npm test` 全绿。

---

## 三、待确认风险与未验证项

1. **09:25 后首拍若仍携带盘前虚拟价**：重基线（`kline.js:559-566`）由「≥09:25 的第一拍」触发并**立即清除 `preview`**；若该拍快照仍为盘前状态（上游发布延迟/服务端无引用缓存，实测报价链路无 TTL），虚拟价会被写成当日 `open/high/low` 并被其后 `Math.min` 单调锁死，等价于 P1-1 复发。本环境无活体快照无法证实，建议实现层加固（要求 `price !== 上一拍预览价` 或按快照时间戳判定后才清除 `preview`），并补一条「09:25:00 首拍＝盘前价、09:25:20 次拍＝真实开盘价」的用例固化该前提。
2. **`now` 参数化（P3-1 修复）的变异矩阵判别力**：新增用例 `5.1(1d)` 直接调用 `applyLiveQuoteToKline`，未覆盖 `app.js:1320 → ChartRowManager.applyLiveTick:546 → applyLiveTickToKlineChart:116` 的 `now` 转发链；且默认门禁 `npm test` 已在 `tests/_jsdom-setup.cjs:14-20` 把 `Date` 锚定在北京 2026-09-09 10:00，故「去掉 `now` 转发」的变异在全绿门禁下不转红（仅 `--integration` 真实墙钟跑法下于 09:15–09:24:59 十分钟窗口可见）。属可接受的残余，但"变异矩阵全覆盖"在项上并未真正建立判别力。
3. **`1w`/`1M` 盘前 `close` 可越出官方 `[low, high]`**（实测：`price=18 → 1w close=18 < low=21`；`price=33 → close=33 > high=32`；`1M` 同）。该现象是上一轮 P2-2 指定实现（保留官方极值 + 用现价更新 `close`）的直接后果，非本轮实现偏差；因 `chart.js:296-298` 不做 OHLC 归一化，若渲染或形态识别链路依赖 `low ≤ close ≤ high` 不变量，需在设计层决策（本轮未列为缺陷）。
4. **继承未验证项（本轮未改动，沿用上一轮登记）**：① 上游是否在 09:26–09:29 返回分时点而 253 固定网格无对应槽位（离线无样本）；② 港美/外盘分时零回归依赖客户端 `_isTradingSessionTime` 与服务端 `intradayService.js:44-46` 双侧过滤完整这一前提。

---

## 四、推荐修复顺序与复审验收标准

**推荐修复顺序**：

1. **P2-1**（`lastDate === targetDate` 空洞 + 已收盘柱压平）——影响默认周期 1d 的历史蜡烛，先修；与 P2-2 同属 `kline.js` 盘前守卫，宜同批设计。
2. **P2-2**（分钟周期越界纳入）——同一分支的适用范围收窄，一并交付并补 1m/5m 用例。
3. 风险 1（09:25 首拍快照时效）——在实现层加防抖判据并用例固化前提。

**复审验收标准**（下一轮需逐条提供可复现证据）：

- P2-1：冻结 02:00/09:05 于生产入口 tick 后，上一交易日柱四价保持官方值且无 `preview`；09:15 起仍追加当日预览柱、09:25:03 重基线正确；对应定点变异确定性转红。
- P2-2：5 个分钟周期在 09:18 的 `close ∈ [low, high]`；上一交易日末根分钟柱不再被次日盘前价改写；`1w`/`1M`/`1d` 既有断言（含 253 轴、非 A 股回归）不转红。
- 需求 1–3 的全部既有断言与 `npm test`（当前 892 项）全绿；`git diff` 范围仅含修复与用例，不夹带无关改动。
