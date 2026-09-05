# 2026-09-05 WorkBuddy 全量代码审查缺陷彻底闭环交接文档

## 1. 概述与交付背景

本项目依据 `docs/2026-09-05-workbuddy-full-code-review.md` 中由 WorkBuddy 提出的全面代码审查报告，针对 3 个 P0 级致命缺陷、7 个前端 P1 级缺陷、5 个服务端 P1 级缺陷、若干 P2 级与 UX 交互问题，进行了全量逐项核验、根因诊断、架构级修复与自动化测试补充。

经过严格工程验证：
- **ESLint 代码规范**：`npm run lint` 0 错误 0 警告
- **QUnit 单元测试**：652 / 652 项 100% 全部通过（净增 1 项）
- **Playwright E2E 自动化测试**：57 / 57 项 100% 全部通过（净增 1 项：10日强势股展开挂载 Canvas 测试）
- **生产构建打包**：`npm run build` 成功完成，产物正常

---

## 2. P0 致命缺陷修复与验证

### 2.1 [F-P0-1] 10 日强势股内嵌图表展开空白（容器 ID 命名错位与单双图结构不匹配）
- **根因分析**：
  - `src/js/views/momentumView.js` 中生成的 host ID 为 `chart-host-momentum-${code}`、`chart-status-momentum-${code}`，而 `momentumChartMgr` 使用的 prefix 为 `'momentum-'`，查找的是 `momentum-chart-host-${code}`。由于 `document.getElementById` 找不到容器，Lightweight Charts 无法在 DOM 中挂载。
  - 另外，`momentumChartMgr.hasIntraday` 为 `false`（强势股只看日 K），但视图却渲染了左右双分屏，导致左侧分时是一个永远空白的占位区。
- **修复方案**：
  - 统一 ID 为 `${prefix}chart-host-${code}`（即 `momentum-chart-host-${code}`、`momentum-chart-status-${code}`、`momentum-chart-reload-${code}`）；
  - 简化强势股图表行为单 Pane（全宽 K 线图），移除无效的左侧分时分屏；
  - 在 `e2e/monitor.spec.js` 中新增专用测试用例，真实断言强势股行点击后展开图表并成功挂载 Canvas。

### 2.2 [F-P0-2] 涨停看板实时报价停滞（刷新未驱动 live tick）
- **根因分析**：
  - `app.js` 内部虽然编写了 `applyLiveTicksToLimitUp()`，但未在 `refreshNow()` 的数据刷新回调链路中被调用，导致涨停池内的价格、涨幅仅能在 30 秒轮询时才全量更新。
- **修复方案**：
  - 在 `refreshNow()` 的 Quote 处理流中补齐 `applyLiveTicksToLimitUp()` 调用；
  - 在 `getRefreshCodes()` 中把交易日当天的 `state.limitUp.items` 标的代码加入全局高频刷新集合，确保涨停标的与自选股同频实时 Tick。

### 2.3 [B-P0-1] `server/utils.js` jsonResponse 崩溃进程（TCP 连接重置与写已销毁 Socket）
- **根因分析**：
  - `jsonResponse` 未校验 `res.headersSent` 和 `res.destroyed`，且未用 `try...catch` 包裹 `writeHead` 与 `end`。当客户端在响应发送前断开或重置 TCP 连接时，在 Node.js 中会抛出未捕获的 Socket 写入异常导致服务崩溃。
- **修复方案**：
  - `server/utils.js` 中的 `jsonResponse` 增加 `if (!res || res.headersSent || res.destroyed) return;` 保护，并用 `try...catch` 拦截底层 Socket EPIPE/ECONNRESET 异常；
  - `server/index.js` 服务端入口增加 `process.on('uncaughtException')` 兜底保护，防止偶发底层网络事件杀死进程。

---

## 3. 前端 P1 缺陷修复

### 3.1 [F1] 涨停看板 30s 周期刷新破坏 DOM 与图表展开状态
- `app.js` 中 `limitUpFetch()` 之前每次轮询都调用 `rerenderLimitUpPage()`，摧毁所有当前已展开的 K 线图表和正在交互的 DOM。
- 修复：仅在首次无数据或根节点未挂载时执行全量渲染，后续周期性后台轮询只调用 `patchLimitUpQuoteCells()` 和 `updateLimitUpStatusBar()`，保障已展开的图表及用户缩放状态持续稳定。

### 3.2 [F2] 图表异步加载 race condition（快速展开又折叠又展开）
- 在 `chartRowController.js` 的 `loadKline` 和 `loadIntraday` 的 `finally` 块中，加入实例身份与展开状态双重校验：`if (this.isExpanded(code) && this.getInst(code) === inst)`，彻底消除由于网络延迟导致的旧请求覆写新请求状态。

### 3.3 [F3] `stopApp()` 清理不彻底（泄漏 router 监听与 abortController）
- `app.js` 中 `stopApp()` 增补清理 `appRouter.stop()`、`abortController.abort()`、`stopMomentumScan()`，确保路由监听器、后台扫描、网络中止控制器与定时器全部安全销毁。

### 3.4 [F4] 10 日涨幅后台扫描进度轮询定时器泄漏
- 在 `app.js` 中为 `momentumPollTimer` 引入独立句柄变量，在发起新扫描、页面停止扫描 (`stopMomentumScan()`) 以及组件销毁时及时执行 `clearTimeout`。

### 3.5 [F5] 扫描与大批量加载时的 SWR 请求风暴
- 在 `api.js` 中增加 `REVALIDATE_MIN_INTERVAL_MS = 30_000` 模块级节流，同一标的与周期 30 秒内不重复触发后台重新拉取；
- 在 `momentumScanner.js` 调用 `fetchKline` 扫描时明确传入 `opts.revalidate = false`，杜绝成百上千只股票同时扫描时引发 SWR 击穿服务器。

### 3.6 [F6] 10 日涨幅扫描结果对全局行情对象 `state.quotes` 的脏覆盖
- `app.js` 中提取 `_mergeMomentumQuotesSafely(items)`，在合并动量候选股报价到 `state.quotes` 时保留既有完整字段（开盘价、成交量、量比、买卖盘等），仅安全更新现价、涨跌幅、成交额，防止后续表格单元格 Patch 读取 `undefined` 产生 NaN。

### 3.7 [F7] 交易时段判断边界漏洞（早盘 00:00-02:30 与节前夜盘）
- `marketSession.js` 中的 `isFuturesMarketOpen` 补齐日历检验：周二至周六凌晨夜盘会话检查前一日是否为法定交易日；晚间 20:55-24:00 夜盘会话检查次日是否为交易日（节假日前夕不开夜盘）。

---

## 4. 服务端 P1 缺陷修复

### 4.1 [B1] 动量扫描接口 CSRF / DNS Rebinding 安全隐患
- `server/index.js` 在处理 `POST /api/cache/momentum/ten-day/scan` 时，校验 `Host` 必须为 `localhost` 或 `127.0.0.1`，并对 `Origin` / `Referer` 进行校验，禁止跨站任意网站诱导触发全市场大算力扫描。

### 4.2 [B2] 过期扫描任务泄漏（Aborted Controller 未触发中止）
- `server/momentumService.js` 中 `JOBS` 对象除了保留 `promise` 和 `startedAt`，同步保留对应的 `controller`。在检测到超过 10 分钟的过期任务被替换时，先调用 `existing.controller?.abort()`，终止过期的后台扫描循环。

### 4.3 [B3] 声明 Node.js 最低版本要求
- `package.json` 补充 `"engines": { "node": ">=20.3.0" }`，明确对 `AbortSignal.any` 及 modern Fetch API 的原生支持要求。

### 4.4 [B4] 代理请求监听废弃事件与潜在 OOM
- `server/proxyService.js` 废弃 `req.on('aborted')`，改用标准的 `res.on('close')`；
- 为代理请求体读取添加 `MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024`（10MB）上限阈值，超出立即返回 HTTP 413 Payload Too Large 并断开，防范内存耗尽。

### 4.5 [B5] 期货服务外部 API 调用缺少超时控制
- `server/futures/futuresQuoteService.js` 和 `futuresKlineService.js` 中所有直接调用原生 `fetch` 的网络请求，全部替换为 `fetchWithTimeout(url, opts, 8000)`，杜绝因外部网络挂起导致服务挂死。

---

## 5. P2 缺陷与 UX 体验优化

1. **[P2-1 / 安全] CSV 公式注入防护**：
   - `src/js/app.js` 的 `buildExportCsv` 针对导出的标的名称等字符串字段，若首字符为 `[=+\-@\t\r]`，自动转义前置 `'`，消除导出的 CSV 在 Excel 中被当作公式执行的隐患。
2. **[P2-2] TTS 播报国债期货等高精度标的精度支持**：
   - `src/js/tts.js` 针对 `priceTick < 0.01` 或 `priceDecimals === 3` 的期货品种（如国债期货 T/TF/TS），播报时使用 3 位小数。
3. **[UX-3] 强势股图表单/双图适配**：
   - 移除 `momentumView.js` 中的空白分时占位，采用纯 K 线全宽展示，解决左右不对称与混淆。
4. **[UX-7] 错误振动反馈定位**：
   - `flashError(msg, targetInputId)` 支持按错误目标只 shake 对应输入框，避免非代码报错误触 `#code-input` 振动。
5. **[UX-8] 模态框危险操作取消按钮默认聚焦**：
   - `src/js/modal.js` 增加 Tab 键盘焦点循环陷阱；当 `danger: true` 时默认聚焦「取消」按钮，防止用户误敲 Enter 误删标的。

---

## 6. 验证结果与质量基线

- **单元测试**：652 / 652 全部通过
- **端到端测试**：57 / 57 全部通过
- **代码规范**：ESLint 0 错误 0 警告
- **构建输出**：Vite 生产构建通过

---

## 7. 交付物与 Git 同步

所有代码修改已全部测试通过。符合全局交付规则：将立即提交 commit 并推送至远端仓库 `origin/main`。
