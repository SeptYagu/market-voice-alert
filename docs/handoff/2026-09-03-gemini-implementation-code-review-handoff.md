# Gemini 三份方案实施后的代码审查交接

> 审查日期：2026-09-03
>
> 审查基线：`a9a3a89`（`main`）
>
> 审查性质：只读审查；本轮未修改业务代码
>
> 审查对象：两份代码审查 handoff、期货需求技术方案，以及 Gemini 声称完成这些文档后的实现

## 1. 结论先行

当前版本**不能验收为“国内期货 F0-F5 全链路完成”**，也不应以这一口径发布。

虽然静态模块、路由、缓存接口、双图容器和自动化测试框架已经搭建，且现有 lint、单测、E2E、构建分别通过，但真实 AKTools 数据契约与前端/服务端契约存在多处 P0 级错配。实际浏览器中添加 `RB0` 后，报价全为空，展开后日 K 报“数据为空”，分时图没有绘制。因此，自动化通过不能证明真实功能可用。

保守评估：

| 范围 | 当前状态 | 评估 |
|---|---|---|
| 原两份审查文档 | 部分问题已修，仍有多项 HIGH 未关闭，并出现新的正确性回归 | 未完成 |
| F0 基础标的识别 | 有输入和 `nf_` 基础支持，但真实报价解析及代码归一化失败 | 部分完成 |
| F1 合约与交易时段 | 有静态目录和会话骨架，但交易日、夜盘、跨日逻辑错误或未接入 | 部分完成 |
| F2 服务端数据层 | 接口存在，但报价字段、日 K 日期、周期、缓存语义均有关键错误 | 未通过 |
| F3 前端双图 | DOM 容器存在，但真实报价和图表不可用，时间轴仍是股票时段 | 未通过 |
| F4 实时刷新与播报 | 仍由股票交易时段控制，夜盘和部分日盘不会更新 | 未通过 |
| F5 验收与回归 | Mock 自动化通过，但缺少真实契约和真实运行验收 | 未通过 |

按“用户可实际使用”的标准，期货能力完成度目前不足 30%。

## 2. 审查范围

### 2.1 需求与交接文档

- `docs/handoff/2026-09-03-code-review-bugs-architecture-handoff.md`
- `docs/handoff/2026-09-03-code-review-bugs-architecture-handoff-02.md`
- `docs/plans/2026-09-03-futures-requirements-technical-plan.md`
- `docs/handoff/2026-09-03-phase4-futures-full-pipeline-handoff.md`

### 2.2 实现与验证

- 对比 `36d3553..a9a3a89`，共涉及 44 个文件，约 `+2867/-804`。
- 检查了前后端数据契约、缓存、交易时段、图表、路由、刷新、TTS、测试和模块边界。
- 使用本机 AKTools、Vite 开发服务器和真实浏览器进行无 Mock 验证。
- 审查时 AKTools 位于 `127.0.0.1:8888`，Vite 位于 `127.0.0.1:5173`。

## 3. 自动化验证结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm test` | 590 项通过 | stderr 有 jsdom canvas `Not implemented` 噪声，但进程退出码为 0 |
| `npm run lint` | 通过 | 无 ESLint 错误 |
| `npm run build` | 通过 | Vite 构建 32 个模块；JS 约 302.44 kB，CSS 约 21.76 kB |
| `npm run e2e` | 53 项通过 | 约 115.3 秒 |
| `npm run ci` | 未在 120 秒内结束 | 是组合任务总时长超过本轮命令超时，不应表述为 CI 失败；各组成项已分别通过 |

重要判断：现有 E2E 使用了与真实服务端不同的期货响应结构，并只验证双图宿主元素存在，所以无法发现本次真实运行失败。

## 4. 真实运行证据

### 4.1 AKTools 返回的真实契约

`futures_zh_daily_sina?symbol=RB0`：

- HTTP 200，约 530,954 字节。
- 行结构为 `date/open/high/low/close/volume/hold/settle`。
- `date` 是 `YYYY-MM-DD`，例如 `2009-03-27`，不是带时分秒的字符串。

`futures_zh_spot?symbol=RB0&market=CF&adjust=0`：

- HTTP 200。
- 字段包括 `open`、`high`、`low`、`current_price`、`bid_price`、`ask_price`、`hold`、`volume`、`last_close`、`last_settle_price`。
- 审查时示例值：螺纹钢连续，开 3136，高 3152，低 3124，现价 3145，持仓约 147 万，成交量约 76 万，昨结 3158。

`futures_zh_minute_sina?symbol=RB0&period=1`：

- HTTP 200，约 122,458 字节，共 1023 行。
- 行结构为 `datetime/open/high/low/close/volume/hold`。

CFFEX 的 `IF0`：

- 带 `market=FF` 时请求成功，返回沪深 300 指数期货连续报价。
- 不带 `market=FF` 时返回 HTTP 500。
- 当前服务没有为中金所品种传递该参数，因此金融期货的 AKTools 主源必然失败。

### 4.2 项目 API 的真实结果

- `/api/cache/futures/quote?ids=RB0` 返回顶层 `data` 数组，而不是前端所读的 `data.data`。
- 该接口虽然能返回记录，但 `open/high/low/openInterest` 均为 0，原因是服务端读取了不存在的 AKTools 字段。
- `/api/cache/futures/kline?id=RB0&period=1d` 返回 HTTP 200、`source=aktools`，但 `items=0`。
- `/api/cache/futures/kline?id=RB0&period=1w` 审查时同样为 `items=0`。
- `/api/cache/futures/intraday?id=RB0` 返回 HTTP 200、`source=aktools`，并有 1023 条记录。

### 4.3 浏览器真实表现

在未注入 Mock 的页面中添加 `RB0` 后：

- 行内仍显示 `RB0`，报价、涨跌、成交等字段全部为 `-`。
- 手动刷新后仍无报价。
- 展开后确实创建了左右两个图表宿主，但日 K 区显示 `错误: K 线数据为空`。
- 分时区仍显示“点击右侧日K查看分时”，没有绘制真实分时数据。

同时可见以下产品问题：

- 输入提示仍是股票和旧示例：`600519, 000001 nf2105`。
- 表头继续复用股票的“量比/成交额”，期货单元格实际却尝试展示成交量/持仓量。
- 缺少合约类别、连续/主力/指定合约、不可交易、数据陈旧、降级源、交易时段和更新时间等状态。

## 5. P0：阻断真实期货功能的问题

### P0-1 前端与服务端响应包络不一致

证据：

- `src/js/futures/futuresApi.js:14-20`、`:57-64`、`:77-84` 读取 `json.data.data`。
- `server/index.js:145-179` 通过 `server/utils.js:96-104` 的 `okEnvelope`，把业务数组或对象直接放在 `json.data`。
- `e2e/helpers.js:233-303` 为期货接口伪造了 `data.data`，恰好迎合前端错误读取方式，掩盖真实失败。

影响：真实报价、K 线和分时响应都无法被前端正确消费。

修复原则：确定唯一 API 包络规范，前后端及测试夹具必须共享同一契约；增加实际 Node API 集成测试，禁止只凭页面路由 Mock 验证。

### P0-2 日 K 日期解析器拒绝 AKTools 的合法日期

证据：

- `server/futures/futuresKlineService.js:86-94` 对 `row.date` 调用 `parseBeijingDateTimeToChartSeconds`。
- `src/js/time.js:82-85` 只接受包含时分秒的 datetime 正则，不接受 `YYYY-MM-DD`。

影响：AKTools 返回的所有日 K 行都被过滤，接口最终得到空数组。

修复原则：日线日期与分钟时间使用不同、明确的解析函数；加入真实 `YYYY-MM-DD` fixture。

### P0-3 AKTools 报价字段和参数映射错误

证据：

- `server/futures/futuresQuoteService.js:34-51` 读取 `open_price/high_price/low_price/position`。
- 真实字段是 `open/high/low/hold`。
- 金融期货没有传 `market=FF`。
- 必需的买一、卖一、昨结、源时间等字段也未完整输出。

影响：商品期货部分字段被写成 0，金融期货主源直接报错。

修复原则：按供应商分别建立适配器和捕获夹具，不能用猜测字段名的通用映射。

### P0-4 新浪商品与金融期货解析索引错误

真实 `RB0` 响应片段显示：昨结位于 `f[10]`，持仓位于 `f[13]`，成交量位于 `f[14]`。当前 `src/js/parser.js:142-161` 使用了错误索引。

真实 `IF0` 响应是另一套结构；当前解析器把时间字段当名称，并把盘口价位当昨收/基准。

影响：AKTools 降级后，新浪备源仍会产生错误名称、涨跌幅、持仓和成交量，不能作为可靠 fallback。

### P0-5 归一化代码与 watchlist 键不一致

证据：

- `src/js/futures/futuresPresenter.js:31-35` 保留 `nf_rb0`。
- `src/js/app.js:3098-3101` 用接口返回代码作为 Map 键。
- watchlist 内的代码是 `rb0`。

影响：即使服务端返回报价，UI 仍可能查不到对应记录，表现为整行 `-`。

修复原则：定义唯一 canonical instrument id；`nf_` 只能作为供应商协议前缀，不应进入领域主键。

### P0-6 刷新和播报仍由股票交易时段控制

证据：

- `src/js/app.js:2736-2749` 及 3220 行附近使用全局股票 `getMarketSession` 控制刷新和播报。
- `src/js/kline.js:424-437` 的实时分时更新同样只识别股票时段。

影响：商品期货 09:00-09:30 及整个夜盘不会刷新；跨午夜品种更无法正确更新。

### P0-7 分时图时间轴硬编码为 A 股时段

证据：`src/js/chart.js:533-549` 只构造 09:31-11:30、13:01-15:00。

影响：夜盘、09:00-09:30、不同品种的收盘时间和跨日数据无法正确显示。即使分时接口有 1023 条真实数据，图表也无法按期货会话绘制。

## 6. P1：严重正确性和产品完整性问题

### P1-1 北京时间与本地星期混用

`server/futures/futuresSessionService.js:17-20` 取得北京时间日期，却用本地 `now.getDay()` 判断星期。本机时区为 America/Indianapolis 时，测试“北京时间 2026-09-07 周一 10:00”被错误判为休市。

### P1-2 夜盘交易日归属错误

`server/futures/futuresSessionService.js:84-103` 按自然日生成 tradingDay。周五夜盘过午夜后会得到自然周六，而期货业务日应归属下一交易日；节前无夜盘规则也未接入交易日历。

### P1-3 周线和月线未聚合

`server/futures/futuresKlineService.js:145-159` 只区分分钟与日线。`1w`、`1M` 实际仍请求并返回日线，没有周/月 OHLCV/OI 聚合。

### P1-4 历史分时日期丢失

`src/js/futures/futuresApi.js:53-63` 没有传递选中日期，服务端 endpoint 和 service 也没有完整接收/应用日期。点击历史日 K 后加载的仍是当前或最近全部分钟数据。

### P1-5 分时涨跌基准错误

`server/futures/futuresKlineService.js:191-207` 用第一根分钟 K 的开盘价作为 `prevClose` 和百分比基准，而期货分时通常应使用昨结算价。

### P1-6 空响应可被当作成功缓存

`server/futures/futuresKlineService.js:71`、`:134` 返回 `{source:'empty', items:[]}`，随后 `getOrRefresh` 会把它作为成功结果写入缓存；非交易时段 TTL 可达 24 小时。API 又固定报告 `stale=false`。

影响：供应商瞬时空响应、错误合约或解析 bug 都可能被长时间固化，并向前端伪装为新鲜数据。

### P1-7 合约目录不具备生产语义

- `PRODUCT_MAP` 是不完整静态表，没有生效日期、上市/到期和退市校验。
- 2026 年 9 月仍接受 `RB2510`、`IF2603` 等已过期合约作为实时标的。
- `server/futures/contractCatalog.js:159-162` 对郑商所三位合约一律补前缀 `2`，跨年代会产生歧义。
- 缺少方案要求的 `/api/cache/futures/contracts` 动态目录。
- “主力”与“连续”没有真正区分，也没有通过 `match_main_contract` 动态解析。

### P1-8 实时图表更新方式不正确

- `applyLiveQuoteToKline` 只改最后一根 bar，没有按分钟桶推进新 bar，也未处理跨夜交易日。
- `applyLiveQuoteToIntradayChart` 每个 tick 都调用 `setData(updated)` 全量重绘，而不是增量 update。

### P1-9 需求中的关键信息缺失

当前尚未完整实现：持仓量副图、买卖盘口、动态昨结算价、连续/主力/指定合约标记、换月标记、不可交易提示、stale/degraded 状态、数据来源时间戳。

## 7. 原两份审查 handoff 尚未关闭的问题

Gemini 修复了若干问题，包括 UUID 临时文件、量比字段、集合竞价边界、部分损坏条目隔离、实时动量增益、调度器防重、momentum chart 定位、Safari 电话识别标签、移动端样式、localStorage 配额处理和 router query 等。但以下高风险项仍未解决：

| 原问题 | 当前证据 | 状态 |
|---|---|---|
| S-HIGH-6 缓存读取放大写 | `server/cacheStore.js:45-70` 每次读取都调度 `touchCacheAccess`，重新读写整个 JSON | 未修复 |
| F-HIGH-4 K 线 single-flight 与首个 AbortSignal 绑定 | `src/js/api.js:370-403` | 未修复 |
| F-HIGH-5 交易日历 Abort 被兜底缓存吞掉 | `src/js/tradeCalendar.js:52-70` 最终 catch 仍缓存 weekday fallback | 未修复 |
| F-HIGH-6 非交易时段永不判 stale | `src/js/storage.js:272-277` 直接返回 false | 未修复 |
| A-HIGH-4 TTS 队列无上限 | `src/js/tts.js:37-58` 仍持续 push，onerror 不能阻止积压 | 未修复 |
| C-HIGH-1 Vite 代理错误处理 | `vite.config.js:61-171` 没有 `proxy.on('error')` | 未修复，崩溃表现仍需专项实测 |
| fetch body 超时 | `server/utils.js:33-62` 收到响应头后即清除 timeout，body 读取不受限 | 未修复 |
| 通用前端 API 超时 | `src/js/api.js` 多处 fetch 只有调用者 signal，没有统一 timeout | 未修复 |
| 损坏 JSON/临时文件清理 | 新写入采用 UUID，但历史损坏项和遗留临时文件治理不完整 | 部分修复 |

## 8. 新引入或“修复不成立”的问题

### 8.1 动量扫描把“不完整”重新定义成“完整”

`server/momentumService.js:341-345` 允许失败比例不超过 3% 时标记 complete。全市场约 5500 只股票时，最多约 165 只失败仍可宣称完整。

这会掩盖扫描缺口。正确设计应同时保留：本次扫描的真实完成状态、失败清单，以及可供用户继续使用的最近一次成功快照，不能修改“完整”的含义。

### 8.2 东财熔断计数跨请求失效

`server/klineService.js:83-89` 在 `eastmoneyDisabledUntil` 为 0 时也满足 `Date.now() >= eastmoneyDisabledUntil`，每次新请求都会重置失败计数。因此跨请求熔断很难达到阈值。

只有在 `disabledUntil > 0` 且确实过期时才应重置计数并清除禁用时间。

### 8.3 日期只校验形状，不校验语义

`server/index.js:50` 只用正则检查 `YYYY-MM-DD` 外形；`2026-99-99` 仍会通过，后续 `normalizeDateKey` 也接受它。

## 9. 架构与可维护性审查

### 9.1 已有改进

提取 `ChartRowManager` 是正确方向，减少了多个页面完全重复的图表行生命周期代码。

### 9.2 仍然存在的结构问题

- `src/js/app.js` 仍约 3400 行，继续承担启动、路由、行情、定时器、列表、语音、图表和业务状态。
- `chartRowController.js` 约 451 行，同时处理数据获取、DOM、状态、图表生命周期和业务转换，职责仍过多。
- 前端 `src/js/futures/instrument.js:1`、`src/js/futures/futuresSession.js:1` 直接导入 `server/` 模块，形成前端依赖服务端实现的倒置关系，并把服务端领域代码打进浏览器 bundle。
- `src/js/app.js:1712-1775` 仍保留重复的状态格式化逻辑。
- `src/js/app.js:2389-2485` 附近仍有涨停页手工包装和生命周期分支，没有真正统一到 feature controller。
- 期货浏览器端仍可直接走新浪 fallback，违反技术方案中“浏览器只调用项目标准化 API”的边界。

建议把跨端纯领域定义移动到 `src/shared/` 或顶层 `shared/`，服务端和前端都依赖 shared；按 feature 拆分 store/actions/controller/view，逐步让 `app.js` 只负责应用编排。

## 10. 测试为何没有发现真实失败

- `tests/futures.test.js` 只有约 15 个解析/会话/presenter 纯函数测试，没有服务端 quote、kline、intraday 和 HTTP API 集成测试。
- 旧解析测试使用虚构的 `nf2105` 数据格式，并以昨收计算涨跌，与期货需求的昨结算基准不一致。
- `e2e/chart.spec.js:273-282` 只断言左右两个 host div 可见，没有断言 canvas、数据点、报价、状态或后续更新。
- `e2e/helpers.js` 的 Mock 包络与真实服务端不同。
- Mock 使用已过期的 `RB2510`，并直接提供理想化数据，绕过真实合约目录和供应商适配。
- 没有覆盖六类代表品种、两个交易日、23:00/01:00/02:30 夜盘、节假日、跨午夜、供应商失败和恢复。

## 11. 建议修复顺序

### Batch A：先恢复真实数据契约（P0）

1. 统一 API 包络，让实现、前端和测试夹具共享契约。
2. 用本轮捕获的真实商品/金融期货响应建立 provider fixture 和独立 parser。
3. 修正 AKTools 参数、字段、日期解析和 canonical code。
4. 空数据不得作为成功新鲜缓存；保留失败原因和旧成功缓存。
5. 增加 Node 服务集成测试。

验收：真实 `RB0`、`IF0` 报价行有正确名称、现价、涨跌、成交量和持仓；真实日 K `items > 0`。

### Batch B：交易时段、周期和双图

1. 全部星期判断基于北京时间，并接入交易日历、节前无夜盘和跨日 tradingDay。
2. 把合约专属 session 接入刷新、语音、K 线和分时实时更新。
3. 实现真正周/月聚合并传递历史选中日期。
4. 按期货 session 动态构造分时时间轴。
5. 使用昨结算价作为涨跌基准，并实现持仓量展示。

验收：09:00-09:30 和夜盘持续更新；周五夜盘跨午夜正确归属下周一交易日；真实左右双图均有数据。

### Batch C：合约目录和界面语义

1. 建立动态合约目录和到期校验。
2. 明确区分指定合约、动态主力和连续合约。
3. 修正表头和输入提示。
4. 补齐不可交易、换月、来源、stale、degraded、session、更新时间状态。

### Batch D：关闭旧 HIGH 缺陷

集中处理缓存访问写放大、Abort 隔离、交易日历 fallback、stale、TTS 队列、代理错误、fetch body timeout 和通用 API timeout。

### Batch E：模块化重构

1. 建立 shared domain 层，禁止前端导入 `server/`。
2. 拆分 futures/stock/limit-up/momentum 的 store、actions、controller、view。
3. 继续缩减 `app.js` 和 `chartRowController.js` 的职责。

### Batch F：真实验收

1. 供应商捕获 fixture + service integration + browser no-mock smoke 三层测试。
2. 覆盖至少六个代表品种、两个交易日和三种夜盘收盘时刻。
3. 覆盖节假日、跨午夜、空响应、错误响应、降级与恢复。
4. 确认真实报价变化会更新列表、K 线最后一根和分时图。
5. 最后执行完整 `npm run ci` 与真实浏览器截图验收。

按当前协作约定，每个完成并验收的批次均应独立提交并推送 Git。

## 12. 最终发布判断

`a9a3a89` 可以作为继续修复的开发基线，但**不能标记为期货全链路完成，也不建议按该功能口径交付用户**。

在 Batch A 和 Batch B 完成前，真实期货主流程处于阻断状态；在 Batch C 和真实 F5 验收完成前，不应宣称符合既定期货需求。现有自动化通过记录应保留，但必须同时明确它验证的是 Mock 场景，而非真实供应商和真实浏览器数据链路。
