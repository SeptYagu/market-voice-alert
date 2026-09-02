# 竞争对手 AI 代码审查 Handoff

> **后续状态（2026-09-01）**：本文列出的阻断项已完成修复并通过最终 CI。实施结果见
> [`2026-09-01-competitor-ai-review-fixes-handoff.md`](2026-09-01-competitor-ai-review-fixes-handoff.md)。

- **审查日期**：2026-09-01
- **审查对象**：`D:\AiPrograms\project1` 当前工作树
- **基线提交**：`4b9de69` (`main`, `origin/main`)
- **审查方式**：以未提交的服务端共享缓存改造为重点，同时检查其与现有前端、生产入口和测试体系的集成
- **总体结论**：**当前版本不建议直接合并或部署到生产环境**

## 1. 当前工作树说明

审查开始时工作树已经包含大量未提交修改，主要内容是：

- 新增 `server/` 服务端共享缓存层。
- 前端优先访问 `/api/cache/*`。
- 新增生产静态服务器入口 `npm run server` / `npm start`。
- 新增 10 日涨幅后台扫描和交易时段自动暂停刷新。
- 调整涨停页日期切换、请求竞态和 E2E mock。

本次审查没有修改上述源码，也没有格式化、提交或推送。除本 handoff 文档外，原有工作树内容保持不变。

## 2. 结论摘要

这轮改造的方向是合理的：公共行情迁移到服务端共享缓存，可以减少每个浏览器重复访问 AKTools/东财/腾讯；涨停页新增 `requestSeq + AbortController` 也修正了历史日期被旧请求覆盖的竞态。

但实现仍存在四类阻断问题：

1. 文档宣称可用于生产的 Node 服务器没有承接现有实时行情与旧回退代理，导致生产模式的核心监控链路失效。
2. “今天”和“交易时段”混用了浏览器/服务器本地时区与北京时间；在 America/Indianapolis 等时区，中国交易时段会被当作历史日期处理。
3. 服务端缓存没有并发请求合并，也没有上游超时；多人访问或上游挂起时容易形成缓存击穿或永久卡住后台扫描。
4. 新增的核心 `server/` 实现没有服务级单元测试或生产入口集成测试；现有 E2E 直接 mock 掉了全部 `/api/cache/*`，因此 `npm run ci` 全绿不能证明服务端真实可用。

## 3. 阻断级问题（P1）

### P1-1：生产服务器缺少现有 API 代理，核心行情功能会失效

证据：

- `server/index.js:176-191` 只处理 `/api/cache/*`，其他路径全部按静态文件处理。
- `src/js/api.js:33-66` 仍请求 `/api/tencent`、`/api/eastmoney` 和 `/api/sina`。
- `src/js/api.js:429-442` 的 K 线 SWR 仍绕过共享缓存，直接走旧代理路径。
- `src/js/tradeCalendar.js:85-90` 和 `src/js/api.js:256-326` 的失败回退仍会请求 `/api/aktools`、`/api/eastmoney-kline` 等 Vite 专用代理。

影响：

- `npm run dev` 下 Vite 代理存在，容易造成“开发正常”的假象。
- `npm run server` 下，上述 `/api/*` 请求会落入静态 SPA fallback，可能返回 `index.html` 及 HTTP 200，而不是正确行情或明确的 JSON 404。
- 股票实时行情、期货行情、K 线后台重验证以及缓存失败后的回退均可能静默返回空数据。

建议：

- 首选：将实时股票/期货报价也收口到 Node 服务，前端只调用稳定的业务 API，例如 `/api/cache/quotes` 和 `/api/cache/futures`。
- 次选：生产服务器实现与 `vite.config.js` 完全一致的受控反向代理。
- 对未知 `/api/*` 返回 JSON 404，不允许落入 SPA `index.html` fallback。

验收标准：

- 构建后只启动 `npm run server`，不启动 Vite；监控页股票、期货、K 线、分时、涨停页和交易日历全部能工作。
- 上游失败时返回明确 JSON 错误或 stale cache，不能返回 HTML 200。

### P1-2：北京时间与本地日期混用，当前交易日会被误判为历史日期

证据：

- `src/js/marketSession.js:11-45` 已正确使用 `Asia/Shanghai` 判断交易时段。
- `src/js/app.js:2028-2030` 的 `isLimitUpDateToday()` 却使用 `formatDateForInput(new Date())`，即浏览器本地日期。
- `src/js/app.js:2258-2259` 用本地日期决定是否强制刷新今天数据。
- `src/js/storage.js:259-271` 用浏览器本地小时判断 K 线缓存是否处于盘中。
- `server/utils.js:8-18` 的默认日期也使用服务器本地时区。

影响：

以 America/Indianapolis 为例，中国 09:30 开盘时当地通常还是前一天晚上。此时：

- 涨停页最新交易日不被视为“今天”。
- 不执行实时行情补全与 live tick 合并。
- 切回最新交易日时不会触发预期的 `force=1`。
- K 线浏览器缓存的盘中失效窗口与中国市场实际交易时段错位。

建议：

- 新建唯一的北京时间日期工具，例如 `getBeijingDate()` / `getBeijingDateKey()`，前后端共享同一语义。
- 所有“今天、历史日期、盘中、盘后、缓存 TTL”判断统一使用 `Asia/Shanghai`。
- 单元测试覆盖北京日期与宿主机日期跨日的场景。

验收标准：

- 固定时间为“北京 09:30、Indiana 前一天 21:30”时，最新交易日必须被识别为今天并允许实时补全。
- 北京收盘后，前端和服务端都停止盘中 TTL/自动刷新逻辑。

### P1-3：共享缓存没有合并并发刷新，违背多人共享缓存的核心目标

证据：

- `server/cacheStore.js:71-112` 的 `getOrRefresh()` 在缓存失效后直接执行 `refreshFn()`。
- 当前没有按缓存 key 保存 in-flight Promise。
- `/api/cache/limit-up?force=1` 可公开绕过 TTL，也没有限流或刷新合并。

影响：

- 多个用户同时命中冷缓存或过期缓存时，每个请求都会独立访问上游。
- AKTools、东财和腾讯会承受成倍请求；文件也会发生并发写入。
- “多人请求同一数据不会重复打上游”这一计划验收项实际上没有实现。

建议：

- 在缓存层增加 `Map<cacheKey, Promise>`，同一 key 的刷新只允许一个生产者。
- 普通请求等待同一个 Promise；可接受旧数据时优先 stale-while-revalidate。
- `force=1` 也必须受 single-flight、最短刷新间隔和服务器端限流约束。

验收标准：

- 20 个并发请求命中同一冷缓存时，上游只调用 1 次。
- 刷新失败时所有等待者获得同一份 stale cache，而不是形成 20 次失败。

### P1-4：所有 K 线周期统一使用 1 小时 TTL，分钟 K 线会严重滞后

证据：

- `server/klineService.js:11` 定义唯一的 `KLINE_TTL_MS = 1h`。
- `server/klineService.js:85-89` 对日、周、月和所有分钟周期都使用该 TTL。
- 设计计划原本要求分钟 K 盘中使用 1-5 分钟 TTL。

影响：

- 1m/5m/15m/30m/60m 图可能拿到最长约 1 小时前的共享缓存。
- 前端 live tick 只修改最后一根已有 K 线，并不会可靠补齐缓存期间缺失的新分钟柱。
- 在生产代理缺失的情况下，浏览器 SWR 又无法从旧直连路径修正数据。

建议：

- 按周期和市场状态计算 TTL：分钟 K 盘中 1-5 分钟，日 K 盘中约 1 小时，盘后可长期保存。
- 返回数据中暴露 `generatedAt`、最后一根 bar 时间和 stale 状态，前端对明显过旧数据给出提示。

验收标准：

- 交易时段连续请求 1m K，超过配置 TTL 后会刷新并出现新的分钟柱。
- 盘后重复请求不会无意义地持续访问上游。

## 4. 次级问题（P2）

### P2-1：涨停原因 TTL 被 30 秒 merged 刷新绕过

`server/limitUpService.js:47-55` 每次刷新 30 秒涨停池时，都会同时调用 `fetchAktoolsReasons()`；与此同时，`/api/cache/limit-up/reasons` 又维护独立的 10 分钟缓存。前端在列表返回后还会再次请求 reasons。

结果是本应 10 分钟更新一次的龙虎榜原因，可能每 30 秒被拉取一次，并在冷缓存/强制刷新时重复请求。

建议将涨停池、炸板池和原因分别缓存，合并结果时读取原因缓存；不要在 30 秒列表刷新中直接访问原因上游。

### P2-2：上游请求没有服务器端超时

`server/marketData.js:19-27` 和 `server/klineService.js:42-45` 只使用调用方传入的 AbortSignal，没有服务器自身的 deadline。后台 10 日涨幅扫描创建的 AbortController 也没有定时 abort。

一旦 AKTools 或公网连接半开，8 个扫描 worker 可能逐步全部挂住，`JOBS` 一直保留，定时任务无法完成。

建议统一实现 `fetchWithTimeout()`，按数据源设置 5-15 秒超时，并记录结构化错误、重试次数和最后成功时间。

### P2-3：空的全市场快照会覆盖有效缓存并生成“成功但 0 股票”的扫描

`server/spotService.js:6-17` 将 AKTools 返回的空数组视为成功并写入缓存。`server/momentumService.js:131-196` 随后可能把空 universe 写成 `status: complete`；启动检查看到 complete 后不会重试。

建议对预期非空的数据源做业务校验。上游返回异常空数组时应保留 stale cache，并把扫描标记为 error/partial，而不是 complete。

### P2-4：“立即刷新”并没有保证强制刷新服务端缓存

`src/js/app.js:1982-1986` 的注释写明用户手动刷新必须直达网络，但函数只清理浏览器 AKTools cache，未设置 `state.limitUp.forceRefreshOnce`。随后 `limitUpFetch()` 仍可能命中 30 秒服务端缓存。

建议明确产品语义：若按钮叫“立即刷新”，则在受限流保护的前提下传 `force=1`；否则将文案改为“重新读取”。

### P2-5：测试全绿并未覆盖新服务端实现

- `npm test` 只匹配 `tests/**/*.test.js`，没有 `server/` 测试。
- `e2e/helpers.js:29` 起直接 mock 全部 `/api/cache/*`，测试只验证前端消费预制响应。
- E2E 使用 Vite dev server，没有验证 `npm run server` 的生产路由。
- `playwright.config.js:22` 允许复用已有 dev server；此时命令中的 `DISABLE_BACKGROUND_JOBS=1` 不一定生效，本地 E2E 仍可能触发真实后台扫描。

建议新增：

1. `server/` 单元测试：临时缓存目录、TTL、stale fallback、single-flight、空响应校验、清理策略。
2. Node HTTP 集成测试：mock `globalThis.fetch`，真实启动 `createAppServer()`。
3. 生产 smoke：构建后只启动 `npm run server`，验证所有前端会调用的 API 路径。
4. E2E 单独配置一个禁止 `reuseExistingServer` 的生产项目。

## 5. 结构与可维护性建议

`src/js/app.js` 当前约 3744 行、123 KB，同时负责：

- 监控页状态与渲染。
- 涨停页协调。
- 10 日涨幅池。
- K 线与分时图生命周期。
- 语音、提醒和自动刷新调度。

这使竞态修复、定时器生命周期和路由切换很难局部验证。建议在不引入 React/Vue 的前提下拆成 ESM 控制器：

```text
src/js/controllers/
├── monitorController.js
├── limitUpController.js
├── momentumController.js
├── chartController.js
└── refreshScheduler.js
```

每个控制器拥有自己的 state、abort、timer 和 destroy 生命周期；`app.js` 只负责启动、路由和跨模块事件。

## 6. 推荐修复顺序

1. **先修生产 API 链路**：保证 `npm run server` 下核心行情真实可用。
2. **统一北京时间工具**：修复今天/历史/盘中判断。
3. **重构缓存核心**：single-flight、timeout、stale-while-revalidate、空响应校验。
4. **按数据类型拆 TTL**：优先修分钟 K 与涨停原因。
5. **补服务端测试和生产 smoke**：让 CI 能发现上述回归。
6. **最后拆分 `app.js`**：在行为测试建立后再做结构重构。

## 7. 本次验证证据

已执行：

```text
npm run lint
  exit code 0

npm test
  546 tests
  546 pass
  0 fail
```

单元测试仍会打印 jsdom 未实现 `HTMLCanvasElement.getContext` 的既有噪声，但测试进程退出码为 0。

未执行：

- `npm run build`：会写入 `dist/`，不属于本次只读审查范围。
- `npm run e2e` / `npm run ci`：会写入测试产物，并且当前配置可能复用已启动服务器或触发真实后台扫描。
- 真实 AKTools/东财/腾讯联网验收：本次结论基于源码、差异、配置和现有测试边界，不将未执行的运行时验证表述为已完成。

## 8. 可保留的实现

以下设计值得保留并继续完善：

- `server/` 按 cache store、market data、各业务 service 分层，方向正确。
- 缓存写入采用临时文件再 rename，具备基础原子写思路。
- `getOrRefresh()` 在上游异常时返回旧缓存，符合行情系统的可用性需求。
- 涨停页使用 `requestSeq + selectedDate + AbortController` 防止旧请求覆盖新日期，思路正确。
- 自动刷新与语音调度分离，并复用交易时段纯函数，职责边界比旧实现清晰。

这些优点不足以抵消当前生产链路和数据时效风险，但适合作为下一轮修复的基础，无需推倒重写。
