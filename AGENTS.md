# AGENTS.md

## 项目概述

股票期货实时监控助手 v2 - 单页 Web 应用

**新窗口速读入口**：
- [`docs/handoff/2026-09-04-aktools-data-source-architecture-and-stability-handoff.md`](docs/handoff/2026-09-04-aktools-data-source-architecture-and-stability-handoff.md) — 2026-09-04 AKTools 数据源稳定性根因分析、全功能评估与架构演进方案交接文档（最新）
- [`docs/handoff/2026-09-04-code-review-defects-and-architecture-refactor-handoff.md`](docs/handoff/2026-09-04-code-review-defects-and-architecture-refactor-handoff.md) — 2026-09-04 全面代码审查结论、缺陷清单与架构重构实施交接文档
- [`docs/handoff/2026-09-03-remaining-defects-and-remediation-handoff.md`](docs/handoff/2026-09-03-remaining-defects-and-remediation-handoff.md) — 2026-09-03 核心缺陷闭环差距分析与剩余未完成缺陷交接
- [`docs/handoff/2026-09-03-futures-complete-defects-resolution-handoff.md`](docs/handoff/2026-09-03-futures-complete-defects-resolution-handoff.md) — 2026-09-03 境内期货全链路支持与全面代码审查缺陷闭环重构交接
- [`docs/handoff/2026-09-03-gemini-implementation-code-review-handoff.md`](docs/handoff/2026-09-03-gemini-implementation-code-review-handoff.md) — 2026-09-03 第三方与 GPT 详细代码审查与缺陷诊断清单
- [`docs/handoff/2026-09-03-phase4-futures-full-pipeline-handoff.md`](docs/handoff/2026-09-03-phase4-futures-full-pipeline-handoff.md) — 2026-09-03 境内期货全链路支持与中低缺陷重构初版交接
- [`docs/handoff/2026-09-02-runtime-bugs-chart-benchmark-handoff.md`](docs/handoff/2026-09-02-runtime-bugs-chart-benchmark-handoff.md) — 10 日涨幅扫描、分时/K 线实时更新与国内行情图对照修复（2026-09-02）
- [`docs/handoff/2026-06-05-phase8-chart-rerender-fix-handoff.md`](docs/handoff/2026-06-05-phase8-chart-rerender-fix-handoff.md) — 涨停页 chart 重新挂载修复（2026-06-06）
- [`docs/handoff/2026-06-05-phase8-cache-preload-multi-chart-handoff.md`](docs/handoff/2026-06-05-phase8-cache-preload-multi-chart-handoff.md) — K线持久化 + 预拉 + 涨停页多 chart（2026-06-05）
- [`docs/handoff/2026-06-05-phase7-date-fix-handoff.md`](docs/handoff/2026-06-05-phase7-date-fix-handoff.md) — 日期格式 bug 修复 + 前一天/后一天按钮（2026-06-05）
- [`docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md`](docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md) — 涨停原因 + 日期选择（2026-06-05）
- [`docs/handoff/2026-06-05-aktools-upgrade-handoff.md`](docs/handoff/2026-06-05-aktools-upgrade-handoff.md) — AKTools 涨停数据源升级（2026-06-05）
- [`docs/handoff/2026-06-05-phase5-bugfixes-handoff.md`](docs/handoff/2026-06-05-phase5-bugfixes-handoff.md) — Phase 5 + 2 个 K线图 bug 修复完整记录
- [`docs/handoff/2026-06-05-phase4-handoff.md`](docs/handoff/2026-06-05-phase4-handoff.md) — Phase 4 (涨停看板) 完整交接文档

读完本文 + `STATUS.md` + 最新 handoff 即可接手；`SPEC.md` 是早期需求源，已标注过时内容，读其中历史章节时要以当前实现和 handoff 为准。

- **技术栈**: Vanilla JS (ESM) + Vite 5 + TradingView Lightweight Charts 4
- **代码规范**: ESLint 8
- **测试**: QUnit 单元测试 + Playwright E2E
- **数据源**: 腾讯实时行情主源 + 东财实时/K 线主源与备源 + QQ K 线备用 + 新浪期货 + **AKTools (涨停看板主源，本地 Python 后端)**
- **构建工具**: Vite 5.x

## 命令

```bash
npm run dev         # 启动开发服务器 + 内置 /api/cache (http://127.0.0.1:5173)
npm run server      # 生产后端：服务 dist 静态文件 + /api/cache
npm start           # 同 npm run server
npm run build       # 生产构建
npm run preview     # 构建后用生产后端预览
npm run lint        # ESLint 检查
npm run lint:fix    # ESLint 自动修复
npm test            # QUnit 单元测试
npm run e2e         # Playwright E2E 测试
npm run ci          # 完整 CI (lint + test + e2e + build)
```

## 目录结构

```
project1/
├── index.html                 # SPA 入口
├── package.json
├── vite.config.js             # 含外部 API 代理 + 开发期 /api/cache 中间件
├── server/                    # Node 生产后端 + 共享缓存 API（dist + /api/cache/*）
├── data/cache/                # 运行时公共市场缓存（git ignored）
├── .eslintrc.cjs
├── playwright.config.js
├── SPEC.md                    # 早期需求源（含过时标注；当前实现以 STATUS/handoff/源码为准）
├── STATUS.md                  # 进度状态（每阶段更新）
├── public/                    # 静态资源
├── src/
│   ├── main.js              # 入口
│   ├── style.css            # 全局样式 + 主题 CSS 变量
│   ├── pages/               # 历史规划目录；当前 SPA 主要在 index.html + hash route 内渲染
│   └── js/
│       ├── app.js           # 主应用逻辑 + 路由 + 多 K 线图
│       ├── api.js           # 实时行情 API (Tencent/Eastmoney/Sina)
│       ├── parser.js        # 数据解析器 + normalizeCode
│       ├── storage.js       # localStorage 封装 + STORAGE_KEYS
│       ├── theme.js         # 主题切换（warm/light/dark 循环）
│       ├── chart.js         # TradingView 封装 + updateKline 实时更新
│       ├── kline.js         # K 线格式化 + 涨停/炸板阈值
│       ├── tts.js           # Web Speech API + formatQuoteSpeech
│       ├── worker.js        # Web Worker 心跳
│       ├── alert.js         # 价格提醒 + 桌面通知
│       ├── router.js        # Hash 路由 (#/, #/limit-up)
│       ├── limitUp.js       # 涨停看板纯函数（分桶/排序/合并）
│       ├── limitUpApi.js    # 涨停池 API 薄包装（委托 aktoolsApi）
│       ├── aktoolsApi.js    # AKTools (AKShare HTTP 代理) 封装 + 30s 缓存
│       ├── limitUpView.js   # 涨停看板 UI（分组/复选框/行内 K 线）
│       ├── marketSession.js # 交易时段判断
│       ├── time.js          # 时间工具
│       └── tradeCalendar.js # 交易日历工具
├── tests/                   # QUnit 单元测试
│   ├── _jsdom-setup.cjs     # jsdom 全局暴露（router/limitUpView 依赖）
│   └── *.test.js            # 单元测试文件
├── e2e/                     # Playwright E2E
│   ├── helpers.js           # 共享 mock + setup
│   ├── fixtures/            # 固定 mock 数据
│   └── *.spec.js            # E2E spec（用例数以 STATUS/latest handoff 为准）
├── docs/
│   ├── plans/               # 实施计划
│   ├── handoff/             # 阶段交接文档
│   └── phase4-limit-up-board.md  # 用户文档
└── backups/                 # 旧版本备份
```

## 编码规范

1. **模块化**: ES Modules (import/export)，不要用 CommonJS
2. **纯函数优先**: 业务逻辑放纯函数（api.js / parser.js / limitUp.js / aktoolsApi.js），UI 逻辑放 app.js / limitUpView.js
3. **数据契约**: 数据结构参考 SPEC.md §5，但遇到已标注过时内容时以当前源码、STATUS 和最新 handoff 为准
4. **错误处理**: 所有 API 调用必须有 fallback + try/catch
5. **持久化**: 用户配置用 localStorage，key 在 storage.js 集中管理
6. **注释**: 重要算法/API 边界条件必须注释；不要注释显而易见的代码
7. **命名**:
   - 文件: 小写 + 连字符 (api.js, kline.js, limitUp.js)
   - 变量/函数: camelCase
   - 常量: UPPER_SNAKE
   - 私有函数: _prefix

## 主题色（A 股惯例：红涨绿跌）

| 状态 | 浅色主题 | 深色主题 | 暖米主题 |
|------|----------|----------|----------|
| 背景 | #F8F8F8 | #1E1E2E | #F5F0E6 |
| 卡片 | #FFFFFF | #2A2A3E | #FFFFFF |
| 文字 | #333333 | #E8E8E8 | #333333 |
| 涨 | #E74C3C | #FF4757 | #E74C3C |
| 跌 | #27AE60 | #2ED573 | #27AE60 |
| 强调 | #3498DB | #5B9BD5 | #E67E22 |

## API 代理

开发时所有外部 API 通过 Vite 代理访问（**键顺序敏感**，前缀重叠时长键在前）；`/api/cache/*` 由 Vite 内置中间件直接调用 `server/` 模块：

| 路径 | 上游 | 用途 |
|------|------|------|
| `/api/tencent` | `https://qt.gtimg.cn` | 实时行情（主，GBK） |
| `/api/eastmoney-kline` | `https://push2his.eastmoney.com/api` | 日/周/月/分钟 K 线（主） |
| `/api/eastmoney` | `https://push2.eastmoney.com/api` | 实时行情（备，UTF-8） |
| `/api/limit-up` | `https://push2.eastmoney.com/api` | 涨停池 clist/get（**已废弃**，2026-06-05 改用 AKTools）|
| `/api/limit-up-stock` | `https://push2.eastmoney.com/api` | 个股涨停 metadata（**已废弃**）|
| `/api/aktools` | `http://127.0.0.1:8888` | **AKTools (AKShare HTTP 代理) 涨停池/炸板池（主）** |
| `/api/sina` | `https://hq.sinajs.cn` | 新浪期货 |
| `/api/qq-kline-min` | `https://ifzq.gtimg.cn` | 腾讯分钟 K 备用 |
| `/api/qq-kline` | `https://web.ifzq.gtimg.cn` | 腾讯日/周/月 K 备用 |

| 路径 | 来源 | 用途 |
|------|------|------|
| `/api/cache/kline` | `server/` 内置模块 | K 线共享缓存 |
| `/api/cache/intraday` | `server/` 内置模块 | 分时共享缓存 |
| `/api/cache/limit-up` | `server/` 内置模块 | 涨停池 + 炸板池共享缓存 |
| `/api/cache/limit-up/reasons` | `server/` 内置模块 | 涨停原因/龙虎榜共享缓存 |
| `/api/cache/momentum/ten-day` | `server/` 内置模块 | 10 日涨幅池共享缓存 |
| `/api/cache/calendar/trade-dates` | `server/` 内置模块 | 交易日历共享缓存 |
| `/api/cache/spot/latest` | `server/` 内置模块 | 全市场实时快照共享缓存 |

`/api/cache/*` 开发期由 Vite 挂载，生产期由 `npm run server` 挂载。
服务启动时会启动服务端后台任务：10 日涨幅池会在启动时补齐当天缓存，并按北京时间 08:00、15:01 自动扫描；E2E 通过 `DISABLE_BACKGROUND_JOBS=1` 关闭真实后台扫描。

> **涨停数据源（2026-06-05 升级）**：本项目依赖本地 AKTools 服务（Python 后端，端口 8888）拿涨停池/炸板池数据，含连板数/炸板次数/封板时间真值。安装：`pip install aktools`；启动：`aktools`（或项目根目录的 `aktools startup.bat`）。非交易日接口返回 `[]`。

## 重要约束

- **不要重新引入 ECharts** - 用 lightweight-charts
- **不要在 src/ 下创建 *.cjs** - 全部用 ESM
- **不要无说明地修改 SPEC.md** - 它是早期需求源；如需调整，只做清晰标注或在 PR/讨论中说明变更依据
- **不要引入 React/Vue/其他框架** - 保持 Vanilla JS

## 进度

参考 `STATUS.md` 查看当前阶段和已完成功能。
