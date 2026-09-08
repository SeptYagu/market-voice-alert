# 2026-09-07 WorkBuddy 第四轮代码审查交接文档（最新提交核验 + 整体复审 round-4）

## 1. 概述

本轮审查分两个阶段：

1. **最新提交 `a91927c`（docs(review): add WorkBuddy round-3 code review handoff）的有效性核验**；
2. **整体代码复审 round-4**（server/ 全量重读 + src/js 关键路径 + 静态粗筛 + 质量基线复跑）。

**总体结论：0 Critical，0 Major，2 Minor（均为 round-3 遗留，未修复），3 Nit，2 条新观察记录，1 条流程问题。**
`a91927c` 为纯文档提交，其声称的质量基线与核验结论经本轮独立复跑全部属实，无虚假结论。
round-3 记录的遗留项本轮逐一确认仍处于未修复状态（与 STATUS.md 已知债务清单一致，非回归）。

## 2. 阶段一：最新提交 a91927c 逐项核验（全部 PASS）

| 声称内容 | 核验方式 | 结论 |
| --- | --- | --- |
| 质量基线：`npm run lint` 0 错误 0 警告 | 本轮实测复跑 | ✅ PASS |
| 质量基线：`npm test`（QUnit）660/660 全部 PASS | 本轮实测复跑（pass 660 / fail 0） | ✅ PASS |
| round-2 缺陷闭环（M-1..M-3、m-1..m-6）逐项 PASS | 抽查关键实现：`momentumMath.js` 统一口径（`>= lookback+1`、cutoffDate 截断、2 位小数舍入）、`proxyService.js` 流式累积 + content-length 前置检查 + `finally releaseLock`、`momentumScanner.js` 依赖 `momentumMath.js`、期货 URL `encodeURIComponent` ×4 | ✅ PASS |
| 服务端模块可被 Node 加载 | 本轮全量通读 server/ 16 个文件，导入关系与实现一致 | ✅ PASS |

**⚠️ 流程问题（P-1）**：`a91927c` 提交后**未推送到远端**（`main` 领先 `origin/main` 1 个提交），
违反「每完成一步必须 commit 并 push」的项目规则。本轮已随 round-4 文档提交一并补推。

## 3. 阶段二：整体复审发现

### 3-1 [Minor]（遗留，round-3 #3-1）文档与实现不一致：代理体积上限 15MB vs 10MB

- **位置**：`server/proxyService.js:6`（代码实为 `10 * 1024 * 1024`）vs `STATUS.md:134`（写「超过 15MB」）
- **补充**：`STATUS.md` 文件内部也自相矛盾——`:110` 写「`MAX_PROXY_BODY_BYTES = 10MB`」，`:134` 写「15MB」。
- **建议**：以代码为准，将 `STATUS.md:134` 的「15MB」改为「10MB」。

### 3-2 [Minor]（遗留，round-3 #3-2）app.js 与 limitUpController 双份 root 引用

- **位置**：`src/js/app.js:376`（`let limitUpRootEl = null;`）与 `src/js/controllers/limitUpController.js:96`（内部同名变量）
- **现状**：路由回调中两处同步赋值（`app.js:1713/1727/1730/1743` 等处依赖 app.js 本地副本），当前行为正确，但双源真相后续任一处漏改会出现静默失效。
- **建议**：收敛为 controller 单一来源；app.js 改为经 `limitUpCtrl.getRootEl()` 读取。

### 3-3 [Nit]（遗留，round-3 #3-3）chartRowController 仅为测试兼容 re-export `intradaySourceLabel`

- **位置**：`src/js/controllers/chartRowController.js:22,24`；唯一消费方 `tests/chartRowController.test.js:8`
- **建议**：测试改为直接从 `../src/js/format.js` 导入后删除该 re-export。

### 3-4 [Nit]（遗留，round-3 #3-4）全局 `uncaughtException` 静默吞错、无计数

- **位置**：`server/index.js:410-417`
- **建议**：保留不退出，但增加内存计数与最后一条堆栈的定期日志。

### 3-5 [Nit]（遗留，round-3 #3-5）代理与缓存 API 响应 `access-control-allow-origin: *`

- **位置**：`server/index.js`（缓存 API）、`server/proxyService.js`
- **结论**：个人 LAN 工具可接受，维持现状；若未来暴露公网需纳入与 scan 端点相同的来源校验。

### 3-6 [Nit]（新发现）陈旧动量任务中止竞态：旧任务的 error 写入可能短暂覆盖新任务进度

- **位置**：`server/momentumService.js:387-391`（陈旧任务 abort+delete）与 `:414-441`（job.catch 写 `status:'error'` 到同一 `parts` 缓存）
- **问题**：超过 10 分钟的陈旧任务被 abort 后，其 `.catch` 分支会把 `{status:'error',...}` 写进与**新任务共用**的进度缓存键 `['momentum', dateKey, 'ten-day-{threshold}pct.json']`，可能覆盖新任务刚写入的 `scanning` 进度，直到新任务下一次每 100 只的进度写入才自愈。GET 侧因 `JOBS.has(jobKey)` 会强制把响应 status 改回 `'scanning'`，用户可见影响仅限进度数字短暂回跳。
- **建议**：旧任务 catch 写缓存前检查 `JOBS.get(jobKey)` 是否仍属于本次任务（对比 promise 引用或 startedAt），非则跳过写入（一行守卫即可）。

### 3-7 [观察] `/api/cache/futures/quote` 的 `ids` 参数数量无上限

- **位置**：`server/index.js:202-218`、`server/futures/futuresQuoteService.js:182-197`
- **现状**：`ids` 以逗号切分后逐个 `getCachedFuturesQuote`（5 并发分批）。因合法期货合约集合有限、无效 id 经 `parseFutureInput` 返回 null 零成本短路，实际风险可忽略。
- **建议**：若未来暴露公网，加 `ids.length <= 50` 之类的上限。

### 3-8 [观察]（行为确认，非缺陷）本地兜底扫描过滤次新股

`computeTenDayMomentum` 统一要求 `>= lookback+1`（11 根）后，前端本地扫描不再产出上市不足 11 个交易日的次新股——round-3 已确认这是有意行为（前后端口径一致），本轮抽查 `momentumScanner.js:69-91` 与单测固化一致，无回归。

## 4. 本轮新增覆盖面（round-3 未逐行覆盖的部分）

- `server/cacheStore.js`：原子写（tmp+rename 重试覆盖 EPERM/EACCES/EBUSY）、`resolveCachePath` 双重防穿越、`getOrRefresh` inflight 去重与 stale 回退、60/30 天 prune 阈值 —— 质量良好。
- `server/proxyRoutes.js`：路由前缀排序正确（`/api/eastmoney-kline` 先于 `/api/eastmoney`、`/api/limit-up-stock` 先于 `/api/limit-up`、`/api/qq-kline-min` 先于 `/api/qq-kline`），无前缀遮蔽。
- `server/futures/futuresKlineService.js` 与 `futuresQuoteService.js`：夜盘归属交易日过滤、周/月聚合（周一起始）、新浪 GBK 解码容错、报价 sina→aktools 回退链，逻辑正确。
- `src/js/services/batchExportService.js`：CSV 注入防护（`=+-@\t\r` 前缀加 `'`、双引号转义、BOM+CRLF）已到位。
- `src/js/controllers/momentumController.js`：轮询守卫（`!mState.loading`）、abort 生命周期（`finally` 中 `mState.abort === abort` 才清空）、置顶合并 `pinnedOnly` 语义均正确。
- 静态粗筛（analyze.sh）：无硬编码密钥、无 SQL/命令注入模式（命中项均为正则 `.exec()` 误报）、无 eval/new Function/innerHTML 注入面。

## 5. 质量基线（本轮实测）

- `npm run lint`：0 错误 0 警告
- `npm test`（QUnit）：**660 / 660 全部 PASS**
- 静态扫描：server 16 文件 / src/js 36 文件，无安全模式命中
- E2E 未在本轮重跑（沿用上轮 57/57 记录）

## 6. 整体架构评价

- 服务端分层清晰：路由（index.js）→ 服务（*Service.js）→ 数据源（marketData.js / futures/*），缓存统一走 `cacheStore.getOrRefresh`，超时统一走 `fetchWithTimeout`（TimeoutError→504 映射）。
- 断路器与限速：东财失败计数冷却、腾讯 WAF 冷却（modern/legacy 解耦）、腾讯批量报价 175ms 最小间隔 + 4 并发，设计合理。
- 前端控制器化拆分（70f65eb）后，momentum/limitUp 控制器与视图职责边界良好；遗留债务集中在 `app.js`（1869 行，监控页主逻辑），可作下一轮拆分对象。

## 7. 建议的下一步

1. **立即推送**（本轮已随 round-4 文档提交补推 `a91927c`，勿再积压未推送提交）；
2. 一行改动修 `STATUS.md:134`「15MB」→「10MB」（#3-1）；
3. 收敛 app.js 双份 root 引用（#3-2）；
4. （可选）#3-3 / #3-4 两个 Nit 与 #3-6 一行守卫；
5. 关注 C 盘空间（round-3 #3-7，本轮未复测）。
