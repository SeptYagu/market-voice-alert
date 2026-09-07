# 2026-09-07 WorkBuddy 第三轮代码审查交接文档（最新提交核验 + 整体复审）

## 1. 概述

本轮审查分两个阶段：

1. **最新提交 `70f65eb`（fix(core): close WorkBuddy round-2 review defects…）的有效性与 bug 核验**；
2. **整体代码复审**（server/ 全量 + src/js 重点抽查 + 安全粗筛）。

**总体结论：0 Critical，0 Major，2 Minor，3 Nit，2 条观察记录。**
上一轮（round-2）声称闭环的全部缺陷经逐项核验均真实落地，无虚假闭环、无回归。

## 2. 阶段一：最新提交 70f65eb 逐项核验（全部 PASS）

| 编号 | 声称内容 | 核验方式 | 结论 |
| --- | --- | --- | --- |
| M-1/M-3/Nit4 | 动量算法统一下沉 `src/js/services/momentumMath.js`，前后端同口径 | 读 diff + 读实现 + 单测 8 项 | ✅ PASS：`momentumScanner.js` 已改为依赖 `momentumMath.js`（依赖倒置修复）；`momentumView.js` 仅保留向后兼容 re-export；`>= lookback+1` 根 Bar 判定、cutoffDate 截断、2 位小数舍入一致 |
| M-2 | app.js 上帝对象拆分（limitUpController 722 行 / momentumController 357 行 / batchExportService 69 行），净减 917 行（2786→1869） | 读 diff + 接线核验 | ✅ PASS：`setRootEl`/回调上下文注入完整；`ChartRowManager.klineCtlMap`/`intradayCtlMap` 真实存在（chartRowController.js:194-195）；测试契约 re-export 齐全 |
| m-1 | 代理流式累积 + content-length 前置检查 | 读 proxyService.js 全文 | ✅ PASS：`reader.read()` 分块累计、超限 `reader.cancel()`、`finally releaseLock` 均正确（上限数值见发现 3-1） |
| m-2 | 期货 URL 参数 encodeURIComponent ×4 | grep 核验 | ✅ PASS：4 处全部转义 |
| m-3 | `isDataAutoRefreshAllowedNow` 死分支修复 | 读 diff | ✅ PASS：`state.chartRowManager` 死引用全仓 grep 为 0；改为 `expandedCodes` 三处合集判断 |
| m-4 | 期货昨结价 24h 缓存 | 读 futuresKlineService.js:430-445 | ✅ PASS：`getOrRefresh` 返回 `{...,data}` 包装，`dailyCached.data` 解包正确；`fetchFuturesDaily` 返回 `{source,items}` 与后续 `daily.items` 消费匹配；路由层只传 `{date}` 不会 force 击穿缓存 |
| m-5 | `el()` html 分支清理 ×8 文件 | grep 核验 | ✅ PASS：8 个文件分支全删，且全仓无任何 `html:` 调用方残留（无静默丢内容风险） |
| m-6 | mapLimit 归拢 server/utils.js | 读 diff | ✅ PASS：marketData/momentumService 统一引用；momentumService 传 `{yieldTick:true}` 保持原 yield 语义 |
| Nit1-4 | import 位置 / safeName / 缓存头分流 / 常量集中 | 读 diff | ✅ PASS |

**质量基线复跑（本轮实测，非引用提交声明）**：

- `npm run lint`：0 错误 0 警告
- `npm test`（QUnit）：**660 / 660 全部 PASS**
- 服务端模块导入冒烟：`server/momentumService.js`、`server/index.js` 均可被 Node 正常加载（前端 `momentumMath.js→format.js/time.js` 为纯函数，服务端引用安全）
- E2E 未在本轮重跑（上轮声明 57/57，本轮环境受限）

## 3. 阶段二：整体复审发现

### 3-1 [Minor] 文档与实现不一致：代理体积上限 15MB vs 10MB

- **位置**：`server/proxyService.js:6` vs `docs/handoff/2026-09-05-workbuddy-round2-...handoff.md:58`、`STATUS.md:134`
- **问题**：代码实际 `MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024`（10MB），但交接文档与 STATUS.md 均写「15MB」。
- **建议**：以代码为准修正两处文档为 10MB（或确认意图后把常量改为 15MB，二选一，保持一致即可）。

### 3-2 [Minor] app.js 与 limitUpController 双份 root 引用（双源真相）

- **位置**：`src/js/app.js`（路由回调内 `limitUpRootEl = r; limitUpCtrl.setRootEl(r);`）、`src/js/controllers/limitUpController.js`（内部 `limitUpRootEl`）
- **问题**：拆分后 app.js 仍保留同名模块级变量 `limitUpRootEl` 并与 controller 内部引用并行维护，两处必须同步赋值（当前路由回调确实同步了），后续任一处漏改会出现「状态栏查不到 #lu-status」类静默失效。
- **建议**：收敛为 controller 单一来源；app.js 删除本地 `limitUpRootEl` 变量（或保留一个仅由 `limitUpCtrl.getRootEl()` 代理的 getter）。

### 3-3 [Nit] chartRowController.js 仅为测试兼容 re-export `intradaySourceLabel`

- **位置**：`src/js/controllers/chartRowController.js:24`
- **问题**：controller 重导出 `format.js` 的展示函数，唯一消费方是 `tests/chartRowController.test.js:8`。
- **建议**：测试改为直接 `from '../src/js/format.js'` 导入后删除该 re-export，消除「controller 导出 formatter」的层级倒挂。

### 3-4 [Nit] 全局 `uncaughtException` 静默吞错

- **位置**：`server/index.js:410-417`
- **问题**：守护进程不退出是监控工具的合理取舍，但完全静默可能掩盖状态不一致，且无任何计数。
- **建议**：最低成本做法——保留不退出，但记录出现次数与最后一条堆栈（内存计数 + 定期打一行日志），便于排查偶发异常。

### 3-5 [Nit] 代理与缓存 API 响应 `access-control-allow-origin: *`

- **位置**：`server/index.js`（缓存 API）、`server/proxyService.js`（代理）
- **问题**：任意网页可借本机服务读行情代理数据（仅限 GET 行情数据，无敏感信息、无写操作；momentum scan POST 已有 Host/Origin 双重防护）。个人 LAN 工具可接受。
- **建议**：保持现状即可；若未来暴露公网或加域名访问，需将代理与缓存 API 一并纳入与 scan 端点相同的来源校验。

### 3-6 [观察] 动量口径统一后的行为变化（有意，非缺陷）

`computeTenDayMomentum` 统一要求 `items.length >= lookback+1`（11 根）后，前端本地兜底扫描不再产出上市不足 11 个交易日的次新股（此前前端 `>=2` 根即计算）。这是 M-1 修复的目标行为（前后端口径一致），已由单测固化；仅需知晓：**本地扫描模式下次新股会被静默过滤**。

### 3-7 [环境] C 盘剩余空间告急（非代码问题）

审查期间 C 盘可用空间仅 ~0.5GB（100% 满），曾导致 Git Bash 工具临时故障（ENOSPC）。建议清理 `C:` 临时文件/旧缓存（`npm cache`、Playwright 浏览器旧版本、Windows Update 缓存等），避免开发工具链再次随机故障。

## 4. 整体架构评价

- 服务端：`getOrRefresh` 单飞（inflight dedup）、原子写缓存（tmp+rename 重试）、缓存路径 `sanitizeSegment` + root 前缀双重防穿越、threshold 走 `parsePositiveNumber`、momentum scan 的 CSRF/DNS-rebinding 防护、`TimeoutError`→504 映射，质量均属良好。
- 前端：无 `innerHTML` 注入面（全部 `= ''` 清空 + textNode）、无 eval/new Function、无硬编码密钥；`storage.js` 的 JSON.parse 均有 try 包裹。
- 遗留债务：`app.js` 仍有 1869 行（监控页主逻辑），可作为下一轮拆分对象（monitor 页控制器化），非本轮必须。

## 5. 建议的下一步

1. 修正 3-1 文档数字（一行改动）；
2. 顺手收敛 3-2 双份 root 引用；
3. （可选）3-3 / 3-4 两个 Nit；
4. 关注 C 盘空间。
