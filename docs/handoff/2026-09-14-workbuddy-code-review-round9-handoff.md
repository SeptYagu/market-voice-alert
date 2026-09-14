# 2026-09-14 WorkBuddy 独立代码审查（round 9）

> **审查日期**：2026-09-14
> **被审 HEAD**：`e2a8f0db0b272ba05b39e8c4d522fd6d9e344f1e`（`e2a8f0d`）— *docs(handoff): 闭合审查遗留项（特化用例5盘前时钟/去除绝对化断言/校正代码行号与迁移链）*
> **基准提交**：`f48e592172be4d5273d9a9b3353eaf6e6db7ab07`（`f48e592`）
> **实际审查范围**：`git diff f48e592..e2a8f0d` — 3 个文件、+279 / −20（`AGENTS.md`、`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`、`docs/handoff/INDEX.md`）
> **工作区**：干净；`git pull --ff-only` → `Already up to date`；实际 HEAD 与待审提交一致。
> **判定**：**未通过**（P1×1、P2×1、P3×4；须修复闭环后复审）。

---

## 一、审查基本信息与通过项简述

1. 已逐文件阅读 `f48e592..e2a8f0d` 全部 3 个文件，并追踪其引用的全部生产调用链（`resolveTradeDate`／`resolveInitialTradeDate`／`applyLiveQuoteToKline`／`loadKline`→`loadIntraday`／`isLiveTradeDate`／`updateChartLastTickMulti`／`getRefreshCodes`）。
2. 需求实现无遗漏：两处行号修正（`intradayService.js:215`+守卫 214、`marketSession.js:132`）、`instrument.js:5`、`32da3ca`→`eae67ae` 迁移链、"100% 完整保障"与"绝不请求历史分时"两处绝对化措辞、用例 5 盘前时钟特化，均已按上轮意见落实（依据：`git show 32da3ca/eae67ae`、`git log -S`）。
3. 全部 17 处代码引用（文件+行号+标识符）、2 处提交溯源、10 处 `file:///` 链接经逐条核对**全部与 HEAD 一致**，无引用漂移（含上轮漂移点 `intradayService.js:216→215`、`marketSession.js:138→132`、`instrument.js:20→5`）；`AGENTS.md` 新增 CLI 契约与 `workbuddy_cli.py:42-143` 实际实现一致（`review` 子命令/`--scope` 由 `git diff --stat` 自动导出/模板硬加载）。
4. 独立设计与执行 6 项边界/负向验证（含 320 根窗口逐时点计数、pre-open 锚定、无报价分支、tick 路径合并、既有 harness 下的用例可执行性），其中 3 项符合预期、3 项成功证伪文档结论（见第二节）。
5. 本地门禁复跑：`node scripts/run-tests.mjs` → **814 pass / 0 fail**（文档"814 例"基线属实）。

---

## 二、审查发现与缺陷清单

### P1-1（高）修复方案未覆盖"看板历史日期 ⇒ 标的报价脱离刷新集合"这一上游依赖，目标场景下"今日蜡烛 + 实时注入"仍不可达

- **文件与行号**：
  - `src/js/controllers/monitorController.js:14-22`（`getRefreshCodes`，第 17 行的 `state.limitUp?.selectedDate === getBeijingDate(clock())` 门禁）
  - `src/js/controllers/limitUpController.js:411`（`applyLiveTicksToLimitUp` 的 `isLimitUpDateToday()` 早退）、`:259`（`enrichLimitUpItemsWithQuotes` 的同一门禁）
  - `src/js/controllers/chartRowController.js:380-382`（`const q = this.getQuote(code); if (q && Number(q.price) > 0) { …合并… }`）
  - `src/js/app.js:1354-1358`（`updateChartLastTickMulti` 涨停页循环 `if (!q) continue;`）、`:1346`/`:1362`（`refreshLiveIntradayForCode` 仅在该循环内被调用）
  - 文档位置：§4.1 第 138、144 行；§4.2 第 174-176、196-198 行；§4.1 第 145 行"主动下钻通道"
- **触发条件**：看板翻到 T-1/T-2（`state.limitUp.selectedDate ≠ 今日`），展开一只**不在自选列表 / 订阅集合 / 强势股（momentum）列表中**的标的（即该股仅出现在历史涨停列表里——正是 §1 用户诉求"回顾过往涨停个股在今天表现"的主场景）。
- **实际行为**：该 code 在 `state.quotes` 中不存在任何报价实体，且**不会再被任何刷新周期写入**（`getRefreshCodes` 第 17 行把涨停列表 code 的纳入条件绑定在"看板日期 == 今天"；`state.quotes` 全部写入点仅 `monitorController.js:44/50`、`momentumController.js:141/152`、`app.js:952`）。于是：
  1. `chartRowController.js:380-382` 的报价合并整段被跳过（`q` 为 `undefined`）→ 改造点一/二均不生效 → 日 K 直接使用共享缓存返回的原始数据；当命中盘前生成的静态日 K 缓存（1h TTL，`server/klineService.js:14`、`:79-81`）时 `lastDate = T-1`，**今日蜡烛仍然缺失**；
  2. `app.js:1355-1356` `if (!q) continue;` → **无任何实时 Tick 注入**；
  3. `refreshLiveIntradayForCode` 仅由上述循环调用（`app.js:1346`、`1362`）→ **分时不再有 10s 定时刷新**，图表自展开即冻结；
  4. `isLimitUpDateToday()` 门禁（`limitUpController.js:259`、`411`）同时关闭了列表侧报价富化与列表级 Tick。
  补充（同一依赖的第二形态）：若该 code 的报价在看板切日之前已存在于 `state.quotes`（用户先看今日看板、再翻到 T-1），报价会被永久冻结在切日瞬间的值（切日后不再进入刷新集合），Tick 仍会以该**陈旧报价**反复覆盖图表最后一点/最后一根 —— 表现为"蜡烛有了但价格不再走动"，同样不满足文档承诺的"实时 Tick 注入与定时刷新"。
- **期望行为**：§4.1 第 138/144 行明确承诺"默认初始态：统一重构为展示最新行情（当下全量日 K 与今日最新分时）"，§4.1 第 144 行"默认呈现：展开即展示当下全量日 K 与今日最新分时（**具备实时 Tick 注入与定时刷新**）"，§4.2 第 196-198 行承诺合并逻辑会"追加今日新蜡烛 Bar"。以上承诺在历史看板、且标的未进入报价刷新集合时**全部不成立**，且失败是静默的（无报错、无提示）。
- **根因**：文档把"历史日期劫持"完全归因于 `limitUpChartMgr.resolveTradeDate` 的实例日期绑定（§2.1/§4.2 改造点一），但同一"看板日期"还被**另外三处上游门禁**用于决定"是否为这些标的拉取行情"（`monitorController.js:17`、`limitUpController.js:259`、`:411`）。改造点一/二只解除了图表侧的日期绑定，未解除行情侧的日期绑定 → 图表被要求"展示今日行情"，而行情管线根本不供给这些 code。
- **复现方法 / 运行证据**（临时脚本位于仓库外 `%TEMP%\mva-verify\v4.mjs`，未污染仓库；使用**未修改**的 `ChartRowManager.loadKline` + 改造点一后的 `resolveTradeDate` + 盘前生成的日 K 桩 + 固定 10:00 时钟）：
  ```
  [Case 1] quote in state.quotes   → selectedTradeDate=2026-09-14, bars=3, lastBar=2026-09-14, 今日蜡烛=true
  [Case 2] no quote in state.quotes→ selectedTradeDate=2026-09-14, bars=2, lastBar=2026-09-11, 今日蜡烛=false
  ```
  Case 2 即主场景（历史涨停列表标的但不在报价刷新集合内）：改造点一已把实例日期修正为今日，`selectedTradeDate` 正确，但今日蜡烛仍未被追加 —— 与用户原始投诉现象一致。
- **修复建议**：
  1. **（首选，正交且最小）把"图表存活所需的行情订阅"从看板筛选中解耦**：在 `getRefreshCodes()`（`monitorController.js:14-22`）中追加"当前已展开图表的 code 集合"（`state.limitUp.expandedCodes ∪ state.expandedCodes ∪ state.momentum.expandedCodes`），使历史看板下展开标的的报价、Tick 与 `refreshLiveIntradayForCode` 恢复供给；该改动与改造点一/二完全正交，且天然覆盖"翻页瞬间展开"的竞态。
  2. 相应放宽 `limitUpController.js:411`（列表级 Tick）与 `:259`（列表富化）——若产品上不希望历史看板列表显示今日实时价，则至少需保证 `:1` 的图表订阅通道独立生效。
  3. 在 §4.1/§4.2 的"技术效果"中显式补入该依赖与本次新增改动点（否则改造点一/二被误读为"已足够"）。
- **修复后验收标准**：在历史看板（T-1、T-2）展开任一标的（不加入自选、不在强势列表），且共享日 K 缓存为盘前陈旧版本时：① `state.quotes` 在该 code 展开后 1 个报价周期内出现实体；② 日 K 渲染项出现 `2026-09-14` 蜡烛；③ 主报价变化后 `applyLiveTick` 能改写该蜡烛的 close（价格随行情走动）；④ `refreshLiveIntradayForCode` 按 ≥10s 周期刷新分时。以上四项须有单测/探针断言。

### P2-1（中）改造点二只修了 `loadKline` 内的合并点，遗漏同类调用点 `applyLiveTickToKlineChart`，故"绝不会错误覆盖昨天的收盘柱"断言不成立

- **文件与行号**：`src/js/controllers/chartRowController.js:114-116`（**未在改造范围内**）与 `:380-390`（改造点二）；`src/js/kline.js:409-412`、`:420`、`:439-453`；`src/js/parser.js:108-126`；`src/js/app.js:1546-1558`；文档位置：§4.2 第 198 行
- **触发条件**：任何一次实时 Tick（`app.js:1344` / `:1360` → `mgr.applyLiveTick` → `chartRowController.js:533-539` → `:114-116`），且传入的报价对象不含 `tradingDay/date/quoteDate`。经核对，**股票报价在真实管线中恒不携带日期字段**（`server`/`src` 全仓 `tradingDay` 写入点仅 `app.js:381-382`（读取）与 `server/futures/*`（期货）及 `server/index.js:278`（期货分时查询），东财/新浪股票快照解析 `parser.js:108-126` 输出 `code/name/price/prevClose/open/high/low/volume/amount/volumeRatio/...`，无日期字段）。
- **实际行为**：`applyLiveQuoteToKline(items, rawQuote, period)` 内 `rawTargetDate` 为空 → `targetDate = null` → `kline.js:420` 的追加分支 `period === '1d' && lastDate && targetDate && lastDate < targetDate` **恒不可达** → 必然走到 `kline.js:439-453` 的"原地覆盖最后一根"，即**每次 Tick 都把最后一根柱子的 close/high/low（日 K 还含 open/volume/amount/changePercent）改写成当前价**。当最后一根是昨日柱时（日 K 缓存陈旧、或加载瞬间无报价、或 `app.js:1546-1558` 的 SWR 再校验 `inst.klineData = data` 把已追加的今日柱整体替换掉之后），昨日收盘柱被污染且今日蜡烛仍缺失。
- **期望行为**：§4.2 第 198 行断言"当今日 Bar 已存在（`lastDate == targetDate`）时原地更新最新价与成交量，**绝不会**因历史日期污染而错误覆盖昨天的收盘柱"。该断言与未修改的 tick 路径直接冲突。
- **根因**：`applyLiveQuoteToKline` 的目标日期只有两个来源 —— 报价自带日期，或调用方注入的 `quote.date`。改造点二只在 `loadKline`（`chartRowController.js:383-384`）注入了它，而 `applyLiveTickToKlineChart`（`:114-116`）与其它经 `applyLiveTick` 进入的路径仍把**原始报价对象**直接透传，未做同样的"缺日期时兜底为当前可用交易日"处理。这是同一根因（无日期报价 → `targetDate=null`）的第二处实例，属典型"只修被点名的那一处"。
- **复现方法 / 运行证据**（`%TEMP%\mva-verify\v2.mjs`，调用真实 `kline.js`）：
  ```
  [A] 现状 loadKline 路径（targetDate=2026-09-11）: len 2 -> 2, lastDate 2026-09-11, 09-11 柱 close=21（被污染）
  [B] 改造点二后 loadKline 路径（targetDate=2026-09-14）: len 2 -> 3, lastDate 2026-09-14（正确）
  [C] tick 路径（raw 无日期报价，代码未改）: len 2 -> 2, lastDate 2026-09-11,
      09-11 柱: {"open":10.5,"high":21,"low":10.4,"close":21,"volume":2000}   ← 昨日柱被今日现价覆盖
  ```
  [C] 即 `chartRowController.js:114-116` 的真实形态。
- **修复建议**：把改造点二抽成一个可供两处复用的**纯函数**，例如在 `chartRowController.js` 内新增模块级 `resolveLiveFallbackDate(code, inst, tradingDates)`（股票 → `resolveStockChartDate(tradingDates)`；期货 → `inst.selectedTradeDate || getBeijingDate()`），并同时用于：① `loadKline`（`:383`）；② `applyLiveTickToKlineChart`（`:114-116`，对 `quoteOrPrice` 为对象且缺日期字段时注入 `{...quoteOrPrice, date: fallback}`）。若出于"避免重复注入/避免覆盖"考量选择不修 tick 路径，则必须在 §4.2/§4.4 明确写出该路径的残留风险，并删除"绝不会"的断言（二者至少取其一）。
- **修复后验收标准**：新增断言/探针：日 K 最后一根为 `2026-09-11`、注入无日期报价 `{price: 21}` 分别经 `loadKline` 与 `applyLiveTickToKlineChart` 后，两者**均**产出 `2026-09-14` 新蜡烛且 `2026-09-11` 柱的 OHLCV 逐字段不变；`applyLiveQuoteToKline` 单测补充 `targetDate=null` 分支的显式行为断言（现状为静默覆盖）。

### P3-1（低）"T-2 命中 0 根"被表述为机制性事实，未量化当日 Bar 数阈值；且源可用性条件在 T-1 与 T-2 之间标注不对等

- **文件与行号**：文档 §2.2 第 23、29 行（mermaid）、第 64、67 行、§3 第 119-124 行；对照 `src/js/kline.js:200`（`lmt` 默认 320）、`server/intradayService.js:214-215`
- **触发条件**：盘中翻页观察时刻不同（早盘 vs 午后）。
- **实际行为**：以标准 A 股日 240 根 1 分钟 Bar（含 9:25 竞价点为 241/243 计）建模，320 根 tencent-legacy 窗口内 `T-2 命中根数 = max(0, 80 − 当日已生成 Bar 数)`。独立实测（`%TEMP%\mva-verify\v6.mjs`，调用真实 `filterKlineItemsByDate`）：
  ```
  09:30 → 今日2根  , T-1 243, T-2 75
  10:00 → 今日32根 , T-1 243, T-2 45
  10:40 → 今日72根 , T-1 243, T-2 5
  10:48 → 今日80根 , T-1 240, T-2 0   ← 阈值
  11:30 → 今日122根, T-1 198, T-2 0
  15:00 → 今日243根, T-1 77 , T-2 0
  ```
  即：**T-2 变成 0 根发生在当日第 80 根 Bar 形成之后（约 10:48-10:50）**；在此之前 T-2 仍会被部分覆盖（09:30 时高达 75 根）并可被 `intradayService.js:215` 合成出"伪 T-2 分时"，"只有 T-1 会伪装锁死"的结论在早盘不成立。文档仅以上午 11:30 为例，并把阈值表述为"占满窗口后"（第 64 行），与真实阈值（当日 80 根 ≈ 10:48，而非"占满 320"或"11:30"）不符。
  另：第 66 行把 T-1 的伪分时归因于 320 窗口时未复述前置条件，而第 67 行把"AKTools 历史分钟源未就绪"只写在 T-2 分支。按 `intradayService.js:179-194`（AKTools 历史分钟源先于第 203 行的 1m-K 降级）与 `:214` 守卫，该机制对 T-1 与 T-2 是**同源同条件**的：若 AKTools 可用，T-1/T-2 都会得到真实历史分时（此时用户仍看到历史图，但成因是 §2.1 的日期劫持而非"伪分时"）；若 AKTools 不可用，则 T-1/T-2 都落到 320 窗口（T-1 有、T-2 视时刻而定）。
- **期望行为**：验收标准 #1 要求"准确解释为什么只有前一天(T-1)展示错误而前两天(T-2)未产生伪装锁死(腾讯320根滑动窗口深度与A股交易日分时Bar数…)"，应给出**带时间边界与源可用性条件**的量化结论。
- **根因**：以单一时刻（11:30）的窗口快照外推为不随时间变化的机制描述，且对 T-1/T-2 采取不对称的条件标注。
- **修复建议**：改写 §2.2.2 第 64 行与 §3 第 119-124 行为："320 根窗口内 T-1 恒被部分覆盖（当日 Bar 数 x 时命中 320−x 根），T-2 命中 `max(0, 80 − x)` 根，即**当日第 80 根 Bar（约 10:48）之前 T-2 同样会被合成伪分时**；用户观察到 T-2 显示'暂无分时'意味着其观察时刻在 10:48 之后（或该时刻窗口内 T-2 已滑出）"；并在第 66/67 行统一补写"（前置条件：§2.2.1 的东财 1m 冷却 → 回退腾讯 320；且 AKTools 历史分钟源不可用）"。第 64 行的"完整容纳…大部分/全部 Bar"建议改为量化表述（当日 121 根时 T-1 命中 199 根，即 82% 而非"完整"）。
- **修复后验收标准**：文档给出 `max(0, 80 − 当日Bar数)` 公式与"约 10:48"阈值，并明确 T-1/T-2 的同一前置条件；若作者认为 9:25 竞价点不应计入，须给出该 JSON 源的真实 Bar 计数证据（见第三节未验证项）。

### P3-2（低）§2.4 把 `isLatestKlineDate` 的"假阳性"列为掩盖点/闭环一环，但该值对历史日期无任何行为影响

- **文件与行号**：文档 §2.4 第 96-107 行；`src/js/app.js:714-719`；`src/js/controllers/chartRowController.js:445`；`src/js/api.js:405-417`；`server/index.js:152-163`；`server/intradayService.js:24-27`、`:261`
- **实际行为**：`isLatestKlineDate` 的唯一消费点是 `chartRowController.js:445` 的 `allowLatestTickSource`，它经 `api.js:411`（仅当为 `false` 时才置 `allowLatestTickSource=0`）传到 `server/intradayService.js:261`：`const allowLatest = allowLatestTickSource && !isHistoricalDate(dateKey)`。对任何历史日期 `isHistoricalDate` 恒为 `true`（`:24-27`，`dateKey < todayKey`），故服务端 `allowLatest` 恒为 `false`，与客户端传 `true` 还是 `false` 无关；请求"今天"时 `app.js:716` 的 `isLimitUpDateToday(date)` 分支已先返回 `true`。即：该"假阳性"对 T-1/T-2 的行为**无任何影响**。
- **期望行为**：§2.4 以"掩盖点"为标题、以"形成了闭环假象"作结，读者会据此认为它是 T-1 伪装锁死链条的一环；实际它不是成因也不是掩盖点，属于不可达/无影响的观察。
- **根因**：只核对了 `isLatestKlineDate` 的返回值语义（确为 `true`），未继续追踪其消费链是否会把该值用于历史日期分支。
- **修复建议**：二选一 —— ① 删除 §2.4，或降级为脚注并改写为"该返回值在历史日期下会被服务端 `!isHistoricalDate` 中和，虽语义上存在假阳性但不参与本缺陷因果链"；② 若作者认为它会影响"今天"分支的取源选择，须补充可复现证据（当前无）。
- **修复后验收标准**：§2.4 不再把该函数列为成因/掩盖点，或附带注明"经 `intradayService.js:261` 中和，对历史日期无行为影响"。

### P3-3（低）§4.3 测试矩阵的 mock 清单不完整，按文档写法用例 1/2/3 在既有 harness 下必然失败

- **文件与行号**：文档 §4.3 第 220 行（"Mock 基础 `fetchKline` 桩数据…保证调用链路畅通执行"）与用例 1/2/3（第 223、230、232 行）；`src/js/controllers/chartRowController.js:397-399`；`src/js/api.js:405-412`；`tests/_jsdom-setup.cjs:22-27`
- **触发条件**：按文档描述实现用例 1（`limitUpChartMgr.loadKline(code)`，`hasIntraday: true`）或用例 3（`inst.selectedTradeDate = '2026-09-11'`）。
- **实际行为**：`loadKline` 末尾无条件调用 `this.loadIntraday(code, inst.selectedTradeDate)`（`chartRowController.js:397-399`），`loadIntraday` → `fetchIntraday(..., {sharedCache: true})` → `_fetchIntradayFromSharedCache` → `fetch('/api/cache/intraday?…')`（`api.js:405-412`）。该请求未被文档声明的 mock 覆盖，会落到 `tests/_jsdom-setup.cjs:22-27` 的兜底 fetch 桩，该桩在收到未预期请求时执行 `QUnit.config.current.assert.ok(false, …)` 或 `QUnit.onUncaughtException`（且因 `loadIntraday` 未被 await，失败可能被记到下一条用例）。
- **期望行为**：§4.3 声称该 mock 方案"保证调用链路畅通执行"，应确保用例按文档即可稳定通过。
- **根因**：只考虑了 K 线拉取链，未沿 `loadKline` 的尾部调用追踪到分时链（历史看板/历史 selectedTradeDate 场景下该链必被触发），未对齐仓库既有测试基建的 fetch 桩契约。
- **复现方法 / 运行证据**：在仓库内以 `node_modules/qunit/bin/qunit.js --require ./tests/_jsdom-setup.cjs <仓库外临时用例>` 运行"仅 mock `/api/cache/kline`"版本的用例 1：
  ```
  message: "Unexpected network request; provide a fixture: /api/eastmoney-kline/qt/stock/kline/get?secid=1.600777&klt=1&…
  message: "Unexpected network request; provide a fixture: /api/qq-kline-min/appstock/app/kline/mkline?param=sh600777,m1,,320
  # pass 0 / # fail 1
  ```
  （顺带佐证了 §2.2.1 关于 1m 双源与 `lmt=320` 的描述。）参考既有实现：`tests/chartRequestOwnership.test.js:6-8` 采用"接管 `globalThis.fetch` 并响应全部端点"的方式，可直接复用该模式。
- **修复建议**：在 §4.3 第 220 行的 mock 清单中显式加入"`/api/cache/intraday` 分时桩（含 `items` 或显式空数据）"，并说明"`loadKline` 会触发 `loadIntraday`，需 await 或注入可控桩"；或改为直接对 `ChartRowManager` 注入桩（参照 `tests/chartRequestOwnership.test.js`），避免走 `api.js` 的网络层。
- **修复后验收标准**：按 §4.3 文字复刻的用例 1/2/3 在 `node scripts/run-tests.mjs` 下 100% 通过，且不产生"Unexpected network request"。

### P3-4（低）§2.3 与 §3.2 对同一 T-2 场景使用了互斥的日 K 缓存前提而未作统一

- **文件与行号**：文档 §2.3 第 89-94 行（前置条件"日 K 缓存处于未含当天状态…`lastDate = 'T-1'`"，结论"T-1 与 T-2 对称"）与 §3.2 第 122 行（"在网络日 K 包含当天柱（`lastDate = Today`）时，日 K 正常显示今日柱"）；对照 `src/js/kline.js:420`
- **实际行为**：§2.3 在 `lastDate='T-1'` 前提下断言缺陷对 T-1/T-2 对称；§3.2 解释 T-2 反差时改用 `lastDate=Today` 前提并称"日 K 正常显示今日柱"。两处对同一 T-2 场景给出互斥前提，且 §3 的结论句（"导致用户体验出现巨大反差的真正元凶，是分时图的'伪装占领'机制"，第 113 行）以 §3.2 的"日 K 正常"为论据之一 —— 若日 K 前提为 `lastDate=T-1`（§2.3 的对称前提），T-2 的日 K 也应当缺今日柱，该论据不成立。
- **期望行为**：验收标准 #4 要求"handoff 无技术自相矛盾"，同一现象在不同小节须共享一致前提。
- **根因**：§3 写作时以"用户当时看到的现象"为叙述主线，未回调 §2.3 的缓存前提并声明"§3.2 讨论的是缓存已含今日柱的情形；缓存未含今日柱时 T-2 与 T-1 同缺今日柱"。
- **修复建议**：在 §3.2 该条首句补写前提并交叉引用，例如"（在日 K 缓存已含今日柱的前提下；若缓存停留在 T-1，则 T-2 与 T-1 同样缺今日柱 —— 见 §2.3 共性缺陷）"；同时把第 113 行"真正元凶"限定为"分时侧对比差异"。
- **修复后验收标准**：§2.3 与 §3.2 的日 K 缓存前提显式一致（或明确区分两种前提），§3 结论不再依赖互斥前提。

---

## 三、待确认风险与未验证项

1. **未验证（环境限制）**：本轮为离线单测环境（`MARKET_VOICE_TEST_NETWORK=offline`），未发起任何真实行情请求。§2.2 的 320 根窗口分布为**合成 1 分钟 Bar 序列**的算术验证（已按 A 股 240 根/日、含 9:25 竞价点 243 根/日建模），腾讯 `mkline` 是否真实计入 9:25 集合竞价点未在真实网络下核实（该点影响 P3-1 的阈值 ±1 根与"约 10:48"表述）；需条件：可联网环境 + `npm run test:spot-live` 或手工抓取 `lmt=320` 的原始返回。
2. **未验证**：东财 1m 接口（`server/klineService.js:83-123`）进入冷却的频率未量化。§2.2 的"回退腾讯 320 窗口"是**条件性机制**；若东财 1m 长期可用（`lmt=1000`，≈4 个交易日深度），则 320 窗口不成立、T-2 也会被合成伪分时，§3 的 T-1/T-2 差异解释随之失效。建议在文档中标注该条件并给出实测比例。
3. **未验证**：`AKTools` 历史分钟源（`server/intradayService.js:179-182`）在用户环境是否可用未实测，故 T-1 当时究竟是"伪分时（320 窗口）"还是"真实历史分时"无法判定；这直接决定 §2.2/§3 的"伪装锁死"叙事在用户实际经历中是否成立。需条件：真实服务环境 + 抓取 `/api/cache/intraday?code=…&date=T-1` 的 `source` 字段（`eastmoney-kline-1m` vs `aktools-stock_zh_a_hist_min_em`）。
4. **未验证（残余风险）**：本轮未复跑 Playwright E2E（74 例）与 `npm run lint` / `npm run build`；仅复跑 QUnit（814/814）。因此"历史看板展开图表"的真实浏览器渲染结论未覆盖 —— P1-1 的修复在真实 DOM/定时器环境下是否与 `rerenderLimitUpPage` 的挂载时序冲突（`limitUpController.js:557-568` 每次展开都会重建实例）需在修复后以 e2e 或手工验证确认。

---

## 四、推荐修复顺序与复审验收标准

**修复顺序（先文档、后方案，P1 → P3）：**

1. **P1-1（先做）**：在 §4.2 新增"改造点四：图表订阅与看板日期解耦"，给出 `getRefreshCodes()`（`monitorController.js:14-22`）纳入已展开图表 code 集的具体 diff，并同步 `limitUpController.js:411`/`:259` 的门禁口径；在 §4.1/§4.4 补写"行情供给"这一被遗漏的上游依赖与影响面（含"切日后报价冻结"的第二形态）。
2. **P2-1**：把改造点二抽为可复用日期解析（`loadKline` + `applyLiveTickToKlineChart` 双点注入），或删除"绝不会错误覆盖昨天的收盘柱"断言并显式记录 tick 路径残余风险；补充 `targetDate=null` 分支的断言。
3. **P3-1**：按 `max(0, 80 − 当日Bar数)` 与"约 10:48 阈值"重写 §2.2.2/§3，统一 T-1/T-2 的前置条件（东财冷却 + AKTools 不可用）。
4. **P3-2**：删除或降级 §2.4，注明该值被 `intradayService.js:261` 中和。
5. **P3-3**：补全 §4.3 的 mock 清单（`/api/cache/intraday`）+ 说明 `loadKline` 会触发 `loadIntraday`。
6. **P3-4**：统一 §2.3 与 §3.2 的日 K 缓存前提并交叉引用。

**复审验收标准（下一轮须全部满足）：**

1. §4.2 存在覆盖"历史看板 + 标的未进入报价刷新集合"的明确改动点与代码 diff，且 §4.1/§4.4 不再宣称无条件"具备实时 Tick 注入与定时刷新"（除非该项落地）。
2. 全文不再出现与已实现调用链冲突的绝对化断言；任一"绝不/始终/恒为"均可在代码中逐点验证。
3. §2.2/§3 的窗口结论带时间阈值与源可用性条件，且 T-1/T-2 的条件标注对称。
4. §2.3 与 §3.2 的日 K 缓存前提一致；§2.4 完成删除/降级或补齐证据。
5. §4.3 的每个用例均可按文档在 `node scripts/run-tests.mjs` 下稳定通过（无"Unexpected network request"），且含至少一条覆盖 P1-1（无报价场景）与 P2-1（tick 路径）的断言。
6. 新增/修改的文档仍须满足本轮已通过的全部引用准确性检查（17 处引用 + 2 处提交溯源不得回退）。
