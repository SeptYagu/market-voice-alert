# 代码审查报告（第二轮全量）

## 审查概览
- 审查目标：`D:\AiPrograms\project1\market-voice-alert`（全仓库：server/ 16 文件 + src/ 34 文件，约 13,400 行核心代码）
- 审查范围：全量（非 diff）
- 技术栈：Node.js ≥20 原生 http 服务（无框架）+ Vite 5 原生 JS 前端 + lightweight-charts；QUnit 单测（652 例）+ Playwright e2e
- 总体评分：8 / 10
- 合并建议：✅ 可合并（Major 项建议尽快排期）

## 客观检查结果
- **ESLint**：0 错误 0 警告，全绿。
- **QUnit**：652 例，651 通过，1 失败。
  - 失败用例 `server cache and production routing > eastmoney circuit breaker...` 的报错来自 **WorkBuddy 沙箱的 safe-delete 代理拦截了测试清理 `data/cache/test-runtime` 临时目录**（`trashViaBinary ... Some operations were aborted`），属**环境问题而非产品代码缺陷**，在无沙箱环境下应为通过。建议本机手动 `npm test` 复核一次。
- **静态扫描脚本**：无硬编码密钥、无 SQL/命令注入、无 TODO/FIXME 残留。命中的 12 处 `.exec()` 均为正则匹配（`/^(\d{2}):(\d{2})$/` 等），全部为误报。
- **超大文件**（>500 行，共 8 个）：`app.js` 2786、`chart.js` 717、`limitUpView.js` 632、`api.js` 571、`momentumService.js` 543、`kline.js` 527、`futuresKlineService.js` 524、`aktoolsApi.js` 520。

## 风险摘要
上一轮（commit `0c7e07e`/`92a5e49`）修复的 SSRF、CSRF、路径穿越等问题已确认闭环：代理走固定白名单路由（`proxyRoutes.js`）、缓存路径经 `sanitizeSegment` + 前缀校验（`cacheStore.js:29`）、扫描 POST 有 Host/Origin 双重校验（`index.js:53-73`）。本轮**未发现 Critical 问题**。当前最需要优先处理的是：**前后端两份 `computeTenDayMomentum` 语义不一致**（本地降级扫描与服务端扫描口径不同，结果可能出现分歧），以及 **app.js 仍是 2786 行的上帝对象**（上次"decouple"只拆出了视图渲染，状态与 27+ 个 handler 仍全部集中于此）。

## 关键问题（Critical / Major）

### [M-1] `computeTenDayMomentum` 前后端双实现且口径不一致 — 🟠 Major
- 位置：`server/momentumService.js:94` vs `src/js/views/momentumView.js:38`
- 问题：同名函数两套实现，语义不同：
  - 服务端：要求 `items.length >= lookbackDays + 1`（不足返回 null）、支持 `cutoffDate` 过滤、`gainPercent` 保留两位小数；
  - 前端：只要 `items.length >= 2` 就计算（不足 11 根 K 线也算出涨幅）、startIndex 会向前 clamp、不四舍五入、无 cutoff。
  - 触发条件：服务端 momentum 缓存为空时，`handleMomentumScan`（app.js:782-816）走本地降级扫描，调用前端版本。
  - 后果：**同一只股票在"服务端扫描"和"本地降级扫描"下的 10 日涨幅可能不同**（上市不足 11 个交易日的次新股尤其明显——服务端会排除，前端会算出结果），列表会出现口径漂移。
- 修复建议：抽一个共享模块（项目已有 server 直接 import `src/js/*` 的先例，如 `server/klineService.js` 引用 `src/js/kline.js`），把带 `cutoffDate` 的完整版放进如 `src/js/services/momentumMath.js`，前后端共同引用；`momentumView.js` 只保留渲染。最小改动版：让前端版本对齐服务端的 `items.length < lookbackDays + 1 → null` 规则。

### [M-2] app.js 上帝对象（2786 行，超阈值 5.5 倍） — 🟠 Major
- 位置：`src/js/app.js`（全文件）
- 问题：`4aa5c94 refactor(views)` 拆走了渲染层，但 `state`（监控/涨停/动量三页状态 + 5 个计时器 + 4 个 chart manager 的注入配置）、27+ 个 handler、路由装配、语音调度仍全部在一个文件里。改一个涨停页的交互要在 2786 行里定位上下文，且 `state.limitUp`/`state.momentum` 嵌套结构已经是"文件里的文件"。
- 修复建议：按页拆控制器——`app.js` 只留启动/路由/共享 state（目标 <500 行）；`controllers/limitUpPageController.js`、`controllers/momentumPageController.js` 各自持有本页 state 与 handler（`chartRowController.js` 已是现成范式）。不必一步到位，优先把 `limitUp*` 的 30+ 个函数整体搬出。

### [M-3] services 层反向依赖 views 层 — 🟠 Major（架构）
- 位置：`src/js/services/momentumScanner.js:4-8`（`import { computeTenDayMomentum, ... } from '../views/momentumView.js'`）
- 问题：领域算法（动量计算、排序、阈值常量）住在 `views/momentumView.js`，服务层从视图层 import。依赖方向 view→service 才健康，现在是 service→view，后续任何视图改动都可能波及数据逻辑；这也是 M-1 双实现的温床。
- 修复建议：与 M-1 一并处理——领域逻辑下沉到 `src/js/services/momentumMath.js`（或 domain/），`momentumView.js` 与 `momentumScanner.js` 都从那里 import。

## 一般问题（Minor）

### [m-1] 代理先全量下载再检查体积上限 — 🟡 Minor
- 位置：`server/proxyService.js:48-52`
- 问题：`await upstream.arrayBuffer()` 把响应体整个读进内存后才比对 `MAX_PROXY_BODY_BYTES`。上游若返回超大 body，内存峰值先失控、检查后置。
- 修复建议：先看 `content-length` 头超限直接 502；再流式读取累计：
  ```js
  const reader = upstream.body.getReader();
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROXY_BODY_BYTES) throw new Error('Upstream response too large');
    chunks.push(value);
  }
  body = Buffer.concat(chunks.map(Buffer.from));
  ```

### [m-2] 期货 URL 拼接未编码 symbol（防御性） — 🟡 Minor
- 位置：`server/futures/futuresKlineService.js:33,67,122,152`
- 问题：`${inst.symbol}` 直接拼进 URL。当前 `parseFutureInput` 用 `PRODUCT_MAP` 白名单 + `^([A-Za-z]{1,2})(\d{3,4}|0)$` 严格校验，**无实际注入风险**，但同文件 `futuresQuoteService.js:57` 已经用了 `encodeURIComponent`，风格不一致。
- 修复建议：统一 `symbol=${encodeURIComponent(inst.symbol)}`，把防线从"上游解析器恰好严格"变成"不需要它严格"。

### [m-3] `state.chartRowManager` 未定义，条件永假 — 🟡 Minor
- 位置：`src/js/app.js:2078`
- 问题：`isDataAutoRefreshAllowedNow()` 里引用 `state.chartRowManager && [...state.chartRowManager.rows.values()]...`，但 `state` 上从未定义该字段（实际图表行管理器是 `monitorChartMgr` 等局部实例）。该分支是死代码；期货持仓判断实际只依赖 watchList。当前监控页展开行 ⊆ watchList，所以**暂无功能影响**，但意图（覆盖非 watchList 来源的展开图表行）未实现。
- 修复建议：改为检查三个 manager 的展开集合：
  ```js
  const expandedAnywhere = [...state.expandedCodes, ...state.limitUp.expandedCodes, ...state.momentum.expandedCodes];
  const hasFutures = (state.watchList || []).some(isFutureCode) || expandedAnywhere.some(isFutureCode);
  ```
  或直接删除该死分支。

### [m-4] 期货分时每 10 秒额外全量拉一次日线 — 🟡 Minor（性能）
- 位置：`server/futures/futuresKlineService.js:432-443`（`getCachedFuturesIntraday` 的 refreshFn 内 `await fetchFuturesDaily(inst)`）
- 问题：`prevSettlement` 需要日线数据，但 `fetchFuturesDaily` 是裸 fetch 不走缓存。交易时段 intraday TTL 10s → 每个合约每 10 秒产生 minute + daily 两次上游请求，而日线数据一天只变一次。
- 修复建议：用 `getOrRefresh(['futures','kline', inst.symbol + '-1d.json'], KLINE_HISTORICAL_TTL_MS, () => fetchFuturesDaily(inst))` 包一层（该缓存键已在 `getCachedFuturesKline` 存在，可直接 `readCache` 或复用 getOrRefresh），或把 prevSettlement 的日线查询放到 24h TTL 缓存后面。

### [m-5] `el()` 助手保留无调用者的 `html` 注入通道 — 🟡 Minor（安全从严）
- 位置：`app.js:519`、`limitUpView.js:69`、`headerView.js:9`、`alertBarView.js:8`、`momentumView.js:20`、`monitorTableView.js:17`、`voiceBarView.js:8`、`toolbarView.js:9`
- 问题：8 个视图文件的 `el()` 都实现了 `k === 'html' → node.innerHTML = v`，但全仓库**没有任何调用者传 `html`**（已 grep 验证）。当前无 XSS 暴露面（股票名等外部数据全部走 text node），但这个快捷通道一旦将来被顺手用于渲染接口返回的股票名/涨停原因，就是存储型 XSS 入口。
- 修复建议：删除所有 `el()` 里的 `html` 分支；确需富文本时再显式引入带转义的 helper。

### [m-6] `mapLimit` 重复实现 — 🟡 Minor
- 位置：`server/marketData.js:72-83` 与 `server/momentumService.js:121-134`
- 问题：同名同职责的并发限制器两份实现（细节还略有差异：后者每步 `setImmediate` 让出）。
- 修复建议：提取到 `server/utils.js` 统一导出。

## 优化建议（Nit）
- `chartRowController.js:149` 文件中部出现 `import { intradaySourceLabel }`，建议移到文件顶部与其他 import 合并。
- `intradayService.js:224` `safeName = sanitizeSegment(name) ? String(name) : code`——`sanitizeSegment` 只放行 `[a-zA-Z0-9._-]`，中文名必然被拒，`safeName` 恒等于 code；而 name 又不进缓存路径，这行基本失效（外层 236/256 行已用原始 name 兜底，无功能 bug），可简化为直接 `code`。
- `server/index.js:315` 对所有非 HTML 静态资源发 `immutable` 一年缓存——Vite 构建产物带 hash 没问题，但若以后往 dist 放不带 hash 的文件（favicon 更名等）会被缓存咬住，可在发布清单里留意。
- `momentumView.js` 中 `MOMENTUM_THRESHOLD_PCT = 45` 与 `server/momentumService.js` `DEFAULT_THRESHOLD = 45` 各写一份，建议随 M-1 的共享模块一并收敛。

## 架构评估

- **模块边界**：server 端分层清晰（`index.js` 路由 → 各 service → `cacheStore`/`marketData` 数据层），单一职责执行得好；**前后端共享解析器**（server 直接 import `src/js/parser.js`/`kline.js` 等）是本项目亮点，保证了同一份数据在两端解析口径一致——正因如此，`computeTenDayMomentum` 的双实现（M-1）才显得突兀。
- **依赖方向**：前端 `app.js → views/services → api/storage` 主干健康；例外是 `momentumScanner → momentumView` 的反向依赖（M-3）。
- **健壮性设计**（值得肯定）：Eastmoney 熔断（3 次失败冷却 60s）、腾讯 WAF 冷却 + 175ms 请求间隔限速、缓存原子写 + Windows rename 重试、single-flight 去重、LRU + 配额降级、多级数据源 fallback（东财→腾讯→AKTools→缓存）、stale-while-revalidate。对一个自用工具来说工程质量显著高于预期。
- **可测试性**：652 个单测覆盖解析/存储/调度/服务各层，依赖注入（storage adapter、notification adapter、worker deps）做得规范。
- **主要风险**：集中在前端 `app.js` 的持续膨胀——每加一个页面级功能它都是第一改动点，建议在下一个功能迭代前先完成 M-2 的拆分，避免重蹈"拆了还是 2786 行"的覆辙。

## 结论
- 🔴 Critical：0；🟠 Major：3（M-1 口径不一致、M-2 上帝对象、M-3 反向依赖，其中 M-1/M-3 可一次重构解决）；🟡 Minor：6。
- 上一轮审查（2026-09-05 第一轮）的修复已验证闭环，本轮未发现回归。
- 建议：可合并/可继续迭代；优先排期 M-1+M-3（一次小重构），M-2 拆分随下个功能迭代进行。
