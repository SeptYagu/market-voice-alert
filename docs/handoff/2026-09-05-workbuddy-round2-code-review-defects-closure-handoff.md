# 2026-09-05 WorkBuddy 第二轮全量代码审查缺陷彻底闭环与控制器解耦交接文档

## 1. 概述与交付背景

本项目依据 `docs/2026-09-05-workbuddy-code-review-round2.md` 中由 WorkBuddy 提出的第二轮全量代码审查报告，针对 3 个 Major 级缺陷（M-1、M-2、M-3）、6 个 Minor 级缺陷（m-1 ~ m-6）、4 个 Nit 优化项，进行了全量逐项核验、领域算法下沉、控制器解耦与自动化测试补充。

经过严格工程验证：
- **ESLint 代码规范**：`npm run lint` 0 错误 0 警告
- **QUnit 单元测试**：660 / 660 项 100% 全部通过（新增 `tests/momentumMath.test.js` 8 项高覆盖率单测）
- **Playwright E2E 自动化测试**：57 / 57 项 100% 全部通过
- **生产构建打包**：`npm run build` 成功完成（45 个模块秒级构建）

---

## 2. Major 关键架构缺陷闭环

### 2.1 [M-1 & M-3 & Nit 4] 领域数学算法下沉与依赖倒置（消除前后端双实现与反向依赖）
- **根因分析**：
  - 此前 `computeTenDayMomentum` 在 `server/momentumService.js` 与 `src/js/views/momentumView.js` 存在两套独立实现：服务端要求 `items.length >= lookbackDays + 1`、支持 `cutoffDate` 过滤并做两位小数舍入；而前端在 `items.length >= 2` 时即计算涨幅且无截止日过滤。次新股（不足 11 个交易日）在两端结果漂移。
  - `src/js/services/momentumScanner.js` 反向 import 了 `src/js/views/momentumView.js`，违反了「视图层依赖服务层」的架构原则。
  - 常量 `MOMENTUM_THRESHOLD_PCT = 45`、`MOMENTUM_LOOKBACK_TRADING_DAYS = 10` 在前后端多处硬编码。
- **重构方案**：
  - 新建通用领域算法模块 `src/js/services/momentumMath.js`，统一定义并导出：
    - `MOMENTUM_LOOKBACK_TRADING_DAYS = 10`
    - `MOMENTUM_THRESHOLD_PCT = 45`
    - `computeTenDayMomentum(rawBars, options)`：严格要求 `items.length >= lookbackDays + 1`，支持 `cutoffDate`，涨跌幅统一百分比 2 位小数四舍五入。
    - `sortMomentumItems(items, sortKey, sortOrder)`
    - `getMomentumReasonText(item)`
  - 服务端 `server/momentumService.js` 与前端扫描器 `src/js/services/momentumScanner.js` 统一引用 `src/js/services/momentumMath.js`。
  - `src/js/views/momentumView.js` 仅保留视图与 DOM 装配逻辑，向后兼容重导出 `momentumMath.js`。
  - 新增专用单元测试 `tests/momentumMath.test.js`（8 项用例），覆盖次新股过滤、cutoffDate 截断、正负零及无效数据容错。

### 2.2 [M-2] `app.js` 上帝对象控制反转与控制器抽取
- **根因分析**：
  - `src/js/app.js` 达 2786 行，涨停看板、10 日强势股与自选股监控的状态、定时器、网络轮询、生命周期及 DOM 回调全部交织在一起。
- **重构方案**：
  - **抽取 `src/js/controllers/limitUpController.js`**：
    - 封装涨停看板全生命周期（`createLimitUpController`）；
    - 纳管 `state.limitUp`、AKTools 轮询定时器、报价 Cell 就地 Patch、图表实例管理器、交易日切换、收藏置顶等操作；
    - 导出纯函数 `applyLimitUpFetchResult(prevLuState, rawItems)`，保证测试用例 `tests/app.test.js` 兼容性。
  - **抽取 `src/js/controllers/momentumController.js`**：
    - 封装 10 日强势股全生命周期（`createMomentumController`）；
    - 纳管后台扫描触发、进度轮询、降级本地扫描、钉选与排序、图表实例管理器；
    - 暴露统一的 `onViewMount`、`destroy`、`triggerScan`、`closeAllCharts` 契约。
  - **抽取 `src/js/services/batchExportService.js`**：
    - 封装自选股批量导入解析、CSV 导出（含防注入转义与 UTF-8 BOM）与纯文本导出。
  - **精简 `src/js/app.js`**：
    - 移除冗余状态逻辑，将涨停看板与强势股委托给对应 Controller，净瘦身超 920 行代码。
    - 维持 `tests/app.test.js` 依赖的所有外部 API 签名与 Test Helper 导出 100% 向后兼容。

---

## 3. Minor 一般缺陷闭环

### 3.1 [m-1] 代理上游流式读取与体积限制前置
- **位置**：`server/proxyService.js`
- **修复方案**：
  - 先检查响应头 `content-length`，若超出 `MAX_PROXY_BODY_BYTES`（15MB）直接拒绝；
  - 弃用全量 `upstream.arrayBuffer()`，改用 `upstream.body.getReader()` 流式分块累加，一旦累加字节超过上限立即 `reader.cancel()` 中断上游连接，防范内存峰值耗尽。

### 3.2 [m-2] 期货行情 URL 参数参数化转义
- **位置**：`server/futures/futuresKlineService.js`
- **修复方案**：
  - 对 4 处日线/分钟线 URL 查询参数中的 `inst.symbol` 统一添加 `encodeURIComponent`，对齐防御性编码标准。

### 3.3 [m-3] `isDataAutoRefreshAllowedNow` 死代码分支修复
- **位置**：`src/js/app.js`
- **修复方案**：
  - 废除未定义的 `state.chartRowManager`，改用收集当前所有活跃展开行集合：
    `const expandedAnywhere = [...state.expandedCodes, ...state.limitUp.expandedCodes, ...state.momentum.expandedCodes];`
  - 正确根据自选股与任意展开图表中的境内期货合约判断当前是否处于期货交易时段。

### 3.4 [m-4] 期货分时昨日结算价（prevSettlement）缓存优化
- **位置**：`server/futures/futuresKlineService.js`
- **修复方案**：
  - 在 `getCachedFuturesIntraday` 提取昨结价时，对 `fetchFuturesDaily(inst)` 引入 `getOrRefresh(['futures', 'kline', ...], KLINE_HISTORICAL_TTL_MS, ...)` 24 小时缓存保护，杜绝盘中每 10 秒刷新分时重复向外部请求日线。

### 3.5 [m-5] 视图助手 `el()` 安全通道清理（XSS 隐患杜绝）
- **位置**：`src/js/app.js`、`limitUpView.js`、`headerView.js`、`alertBarView.js`、`momentumView.js`、`monitorTableView.js`、`voiceBarView.js`、`toolbarView.js`
- **修复方案**：
  - 彻底移除全部 8 个视图文件中的 `else if (k === 'html') node.innerHTML = v;` 分支。
  - 外部文本与名称严格走 textNode，防止未来代码意外借道 `html` 属性引发 DOM XSS。

### 3.6 [m-6] 服务端 `mapLimit` 并发控制统一归拢
- **位置**：`server/utils.js`、`server/marketData.js`、`server/momentumService.js`
- **修复方案**：
  - 在 `server/utils.js` 统一定义并导出增强版 `mapLimit(items, limit, fn, { yieldTick = false })`；
  - `server/marketData.js` 与 `server/momentumService.js` 统一引用该公共工具，消除重复实现。

---

## 4. Nit 优化项闭环

1. **[Nit 1] 模块顶部 Import 规范**：
   - 将 `src/js/controllers/chartRowController.js` 中部的 `import { intradaySourceLabel }` 移至文件头部。
2. **[Nit 2] 内部变量简化**：
   - `server/intradayService.js` 简化 `safeName = code`，删除无实际作用的 `sanitizeSegment(name)`。
3. **[Nit 3] 生产静态资源缓存头精准分流**：
   - `server/index.js` 对带哈希构建产物（`/assets/*`）应用 `public, max-age=31536000, immutable`；对根目录未哈希静态资源（如 `favicon.ico`、`manifest.json`）应用 `public, max-age=3600`。
4. **[Nit 4] 常量集中化**：
   - 统一下沉 `MOMENTUM_THRESHOLD_PCT` 与 `MOMENTUM_LOOKBACK_TRADING_DAYS` 至 `src/js/services/momentumMath.js`。

---

## 5. 关键修复过程中的避坑与稳定性保障

1. **`state.limitUp` 引用稳定性**：
   - 涨停看板轮询更新时，不能以 `state.limitUp = applyLimitUpFetchResult(...)` 直接替换顶层对象引用，否则局部闭包与正在运行的异步方法所持有的 `lu` 引用会与全局脱节。采用 `Object.assign(lu, updated)` 原地合并，保障了 `#lu-status` 状态栏即时解除「加载中...」。
2. **`tests/app.test.js` 导出兼容保障**：
   - 虽然大量逻辑下沉到 `batchExportService.js` 和 `limitUpController.js`，但 `app.js` 保持了对原有核心工具函数（如 `parseBatchInput`、`buildExportCsv`、`applyLimitUpFetchResult`、`isLimitUpDateToday` 等）的 re-export，使得 652+ 用例在零侵入的前提下平滑升级。

---

## 6. 验证结果与质量基线

- **ESLint 代码规范**：`npm run lint` 0 错误 0 警告
- **单元测试**：660 / 660 项全部通过（100% GREEN）
- **端到端测试**：57 / 57 项全部通过（100% GREEN）
- **生产打包**：`npm run build` 成功

---

## 7. 交付物与 Git 状态

- 本次涉及所有修改（核心代码、控制器、领域算法服务、测试用例、文档）均已完成自测与全面回归，满足项目规则，将自动提交 commit 并推送到远端 `origin/main`。
