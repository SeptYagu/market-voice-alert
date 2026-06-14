# Phase 4 完整交接文档

> **给新窗口的速读说明**：本文档是 Phase 4 (涨停看板独立页面) 的完整工作记录。新窗口读完本文 + `STATUS.md` + `AGENTS.md` + `SPEC.md` 即可完全接手。
>
> **交接日期**: 2026-06-05
> **交接方**: MiniMax-M3 (前一个 session)
> **当前状态**: Phase 0-4 全部完成并通过用户浏览器验证；Phase 5 (测试 + 文档) 待启动
> **代码仓库**: `D:\AiPrograms\project1\` （**非 git 仓库**）

---

## 1. 当前状态（30 秒速览）

| 指标 | 数值 |
|------|------|
| **测试** | **457/457 pass** (was 276 in Phase 3) |
| **Lint** | 0 errors / 0 warnings |
| **Build** | 成功 (223.24 kB JS / 15.86 kB CSS / gzip 69.87 kB) |
| **Worker chunk** | 0.98 kB (独立打包) |
| **JS source files** | 13 个 (`src/js/*.js`) |
| **Test files** | 13 个 (`tests/*.test.js`) |
| **核心依赖** | Vite 5.4 / QUnit 2.20 / jsdom 24.1.3 / lightweight-charts 4.2 / ESLint 8.57 |

**完整命令：**
```bash
npm run dev         # http://127.0.0.1:5173
npm run lint        # eslint check
npm test            # qunit with jsdom
npm run build       # vite production build
npm run ci          # lint + test + e2e + build
```

---

## 2. 进度总览

| Phase | 状态 | 标题 |
|-------|------|------|
| 0 | ✅ | 清理 + 初始化 |
| 1 | ✅ | 基础架构 + 监控列表 |
| 2 | ✅ | 走势图 (TradingView) |
| 3 | ✅ | 语音播报 + 价格提醒 + 实时 K 线 |
| **4** | ✅ | **涨停看板独立页面**（本次工作） |
| 5 | ⬜ | 测试 + 文档同步 + Playwright e2e |

**Phase 4 又分 3 轮迭代：**
- **Phase 4.1**: 基础看板（Hash 路由 + 4 分组 + ST 标记 + 实时价合并 + 空响应锁定显示 + K 线面板）
- **Phase 4.1.1**: 修复 3 个 bug（东财间歇 502 重试、字段映射错误、GBK 编码）
- **Phase 4.2**: 5 个用户需求（炸板分类、排序、复选框+按钮、metadata、行内 K 线）
- **Phase 4.3**: 4 个用户 bug（race condition、多 K 线图、缩放保留）

---

## 3. 完整文件清单

### 3.1 新建文件（Phase 4）

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/js/router.js` | 59 | Hash 路由工厂 `createHashRouter` + `parseHash` + `navigate` |
| `src/js/limitUp.js` | 158 | 纯函数：分桶规则、分类、排序、metadata 合并、ST 识别 |
| `src/js/limitUpApi.js` | 110 | 东财 clist/get 涨停池 fetch + 5xx 重试 + GBK 解码 + metadata 抓取 |
| `src/js/limitUpView.js` | 471 | 涨停看板 UI：工具栏、4 分组卡片、复选框、排序、行内 K 线图 |
| `tests/_jsdom-setup.cjs` | 45 | jsdom 全局暴露（router/limitUpView 测试需要） |
| `tests/router.test.js` | 92 | Hash 路由测试（11 cases） |
| `tests/limitUp.test.js` | 525 | 纯函数测试（24 cases） |
| `tests/limitUpApi.test.js` | 711 | API 解析 + 重试 + GBK + metadata 测试（23 cases） |
| `tests/limitUpView.test.js` | 645 | 视图测试（20 cases） |
| `docs/plans/2026-06-05-phase4-limit-up-board-design.md` | 设计文档 |
| `docs/plans/2026-06-05-phase4-limit-up-board-impl.md` | 实施计划（10 任务） |

### 3.2 修改文件（Phase 4）

| 文件 | 变更 |
|------|------|
| `src/js/app.js` | 路由化 `startApp`、拆 `renderApp → renderMonitorPage`、加 nav、集成 limit-up 路由 + 多 K 线图 + 实时合并 |
| `src/js/storage.js` | 加 `STORAGE_KEYS.LIMIT_UP` + `getLimitUpSettings/setLimitUpSettings/patchLimitUpSettings` |
| `src/js/chart.js` | 加 `updateKline/updateVolume/updateMA` 方法（用 `series.update()` 保留缩放） |
| `src/style.css` | 加 `.app-nav`、`.lu-*` 看板样式、`.chart-row` 内嵌 K 线样式 |
| `vite.config.js` | 加 `/api/limit-up` 和 `/api/limit-up-stock` 代理 |
| `package.json` | 加 `jsdom@^24.1.3`；test script 加 `--require ./tests/_jsdom-setup.cjs` |
| `tests/chart.test.js` | 加 6 cases 测 update* API |
| `tests/app.test.js` | 净增 ~30 cases（state refactor + 多 K 线 + race fix） |

---

## 4. 核心架构

### 4.1 路由

- **单页 hash 路由**：`#/` 监控页；`#/limit-up` 涨停看板
- **`createHashRouter(routes, defaultPath, rootArg)`**：
  - routes: `{ '#/': handler, '#/limit-up': handler }`
  - 未知 hash → 导航到 defaultPath
  - start() 注册 hashchange 监听 + 触发初始路由
- **页面切换时 destroy** 旧页资源（chart instance、timer、AbortController）
- **关键 bug fix**：`limitUpRootEl = null` 必须在 `renderMonitorPage(root)` 之前调用，防止 in-flight `limitUpFetch` 的 finally 块误把 limit-up 渲染到 monitor 容器上（race condition）

### 4.2 涨停数据流

```
eastmoney push2.eastmoney.com (gbk-encoded JSON)
    ↓ Vite 代理 /api/limit-up
fetchLimitUpList() [5xx 重试 + GBK 解码 + utf-8 fallback]
    ↓ parseLimitUpList (字段映射: f12=code, f2=price, f3=pct, f14=name(GBK), f15-f18=OHLC)
    ↓ applyLimitUpFetchResult (空响应锁定显示)
    ↓ buildLimitUpGroups(items, sortKey) [分类+排序: 3+/2/1/炸板]
    ↓ renderLimitUpPage() [UI 渲染]
    ↓ 用户点击行 → openKline(code) → loadLimitUpKline → fetchKline(code, period)
```

### 4.3 K 线图管理（双页面共享模式）

**状态**（多 K 线图支持）：
```js
state.monitor = {
  expandedCodes: new Set(),          // 当前展开的 codes
  chartInstances: new Map(),         // code -> { ctl, period, klineData, loading, error, abort }
}
const chartInstanceMap = new Map();  // code -> createKlineChart instance
```

**生命周期**：
- `openChart(code)` → add to expandedCodes → load kline → render → mountChartForCode
- `closeChart(code)` → remove from expandedCodes → destroy ctl → clear instance → render
- `handlePeriodChange(period, code)` → only that code's period changes
- `applyLiveTickToChartForCode(code, price)` → uses `series.update()` (preserves zoom)
- `mountChartForCode(code)` → finds `#chart-host-${code}` → creates chart instance

**关键 fix**：live tick 用 `updateKline/updateVolume/updateMA`（series.update），不用 `setKline` + `fitContent` → **用户缩放/拖动状态保留**。

---

## 5. 关键数据契约

### 5.1 涨停 item (来自东财 clist/get)
```js
{
  code: 'sh600519',         // normalizeCode 加 sh/sz/bj 前缀
  name: '贵州茅台',         // TextDecoder('gbk') 解码
  market: 'sh',             // sh | sz | bj
  price: 1100.00,           // f2 最新价
  change: 100.00,           // f4 涨跌额
  changePercent: 10.01,     // f3 涨跌幅 %
  open: 1000.00,            // f17
  high: 1100.00,            // f15
  low: 1000.00,             // f16
  amount: 160304839.1,      // f6 成交额（用于排序）
  // 涨停 metadata (best-effort, 当前常为 0/null/0)
  limitUpCount: 0,          // 连板数 (默认 0 = 首板)
  firstLimitTime: null,     // 'HH:mm' or null
  breakCount: 0,            // 炸板次数
  isST: false               // 名字含 ST / *ST
}
```

### 5.2 东财字段映射（curl 验证，2026-06-05）
```
f2  = 最新价 (price)        ← 我曾误以为是 secid，导致所有 items 过滤
f3  = 涨跌幅 %
f4  = 涨跌额
f6  = 成交额
f12 = 6 位代码（无前缀，需 normalizeCode）
f14 = 名称（**GBK 编码**）
f15-f18 = OHLC
f100/f102/f103 = 行业/概念字符串（**不是 涨停 metadata**）
```

### 5.3 分组桶（limitUp.js `LIMIT_UP_GROUPS`）
```js
{ key: '3+', label: '3 连板及以上', match: (n) => n >= 3 }
{ key: '2',  label: '2 连板',        match: (n) => n === 2 }
{ key: '1',  label: '1 连板 / 首板', match: (n) => n === 1 || n === 0 }
{ key: 'broken', label: '炸板',        match: (changePercent < threshold - 0.5) }
```

### 5.4 涨停阈值（kline.js `getPriceLimit`）
| 板块 | 阈值 |
|------|------|
| 主板 (sh 60x / sz 00x) | 10% |
| 创业板 (sz 30x) | 20% |
| 科创板 (sh 688x) | 20% |
| 北交所 (bj) | 30% |
| ST / *ST | 5% |

### 5.5 STORAGE_KEYS 新增
```js
STORAGE_KEYS.LIMIT_UP = 'limit_up_settings'  // { refreshInterval: 10000|30000|60000 }
```

---

## 6. 关键技术决策（沉淀）

### 6.1 数据源
- **实时行情**：腾讯（主）→ 东财（备）→ 新浪（期货）
- **K 线**：东财（主，含 1 次 5xx 重试）→ 腾讯（备）
- **涨停池**：东财 clist/get with 5xx retry + GBK decode

### 6.2 vite 代理键顺序（**至关重要**）
Vite 5 按对象键插入顺序首个 `startsWith` 匹配胜出。前缀重叠时长键必须在前：
```js
'/api/eastmoney-kline'   // 必须先于 eastmoney
'/api/eastmoney'         // 必须先于 limit-up
'/api/limit-up'          // 必须先于 sina
'/api/limit-up-stock'    // 必须先于 sina
'/api/sina'              // 兜底
'/api/qq-kline-min'      // 必须先于 qq-kline
'/api/qq-kline'          // 兜底
```

### 6.3 GBK 编码（东财 clist/get）
- 中文名在 `f14` 字段，**GBK 编码**
- 必须 `new TextDecoder('gbk').decode(arrayBuffer)` + try/catch fallback utf-8
- K 线接口（`/api/qt/stock/get`）用 UTF-8，clist/get 用 GBK

### 6.4 jsdom 测试环境
- 项目**无 jsdom** 时 router/limitUpView 测试会失败（需要 `window/location/HashChangeEvent`）
- 解决：`tests/_jsdom-setup.cjs` 暴露全局 + `qunit --require` 加载
- package.json 已配置

### 6.5 多 K 线图实现
- 每个 expanded code 一个 `createKlineChart` 实例
- `chartInstanceMap: Map<code, ctl>` 管理
- live tick 用 `updateKline(bar)` 不用 `setKline(items)` + `fitContent()` → 缩放/拖动不重置
- `setData` + `fitContent` 留给首次加载/切周期

### 6.6 Race Condition（关键 bug fix）
- 路由切换 `'#/'` 时，**必须** `limitUpRootEl = null` 早于 `renderMonitorPage(root)`
- 否则 in-flight `limitUpFetch` 的 finally 块会 `rerenderLimitUpPage()` 覆盖 monitor 渲染

### 6.7 涨停 metadata (连板数/封板时间/炸板次数) 限制
- **东财公开 API 不直接返回**这些字段
- clist/get 的 f100/f102/f103 是**行业/概念字符串**，不是 metadata
- 当前实现是 **best-effort** per-stock API (`/api/limit-up-stock`)，默认 0/null/0
- 用户已确认接受此限制，未来可通过 AKTools 后端代理升级

### 6.8 空响应锁定显示（2026-06-05 用户增补）
- `applyLimitUpFetchResult` 区分 4 种情况：
  - 非空 items → 用新数据 + 重置 consecutiveEmptyFetches=0
  - 空 items + 有缓存 → 锁定显示缓存，consecutiveEmptyFetches++
  - 空 items + 无缓存 → 显示空（首次空响应）
  - 错误（5xx/网络）→ 不走此函数，items 保留，error 设置
- 状态栏显示"缓存自 HH:MM · 已空 N 次"（仅当有缓存时）

---

## 7. 重要 Bug 修复历史

| 日期 | Bug | 原因 | 修复 |
|------|-----|------|------|
| 2026-06-05 | 0 只涨停但无错 | `_parseItem` 把 f2(最新价)当 secid → marketId="18" 不在 {0,1} | 用 f12 作 code + normalizeCode |
| 2026-06-05 | 名字乱码 | 未处理 GBK 编码 | `TextDecoder('gbk').decode(buf)` + utf-8 fallback |
| 2026-06-05 | 502 频繁报错 | fetchLimitUpList 无 5xx 重试 | 加 `for (attempt=0; attempt<2)` 重试 |
| 2026-06-05 | 涨跌看→监控不更新 | in-flight fetch race | route handler 提前 `limitUpRootEl = null` |
| 2026-06-05 | 缩放被重置 | `setData`+`fitContent` 太重 | 加 `updateKline`/`updateVolume`/`updateMA` 用 `series.update()` |
| 2026-06-05 | 只显示一只 K 线 | `state.chartCode: string` 单值 | 改 `state.expandedCodes: Set<string>` + `chartInstanceMap` |

---

## 8. 已知的"已知限制" / 待办

### 8.1 涨停 metadata (连板数/封板时间/炸板次数)
**当前状态**：best-effort per-stock API + 30s 缓存，默认 0/null/0  
**升级路径**：
- 用户装好 AKTools 后端服务（`pip install aktools`，启动 :8080）
- 修改 `fetchLimitUpMetadata` 改为 fetch 用户的 AKTools 端点
- 或：自建 Node/Python 后端代理东财专用涨停池接口

### 8.2 监控页 K 线的 K-line 数据 reset on close
当 `closeChart(code)` 时清空 `state.chartInstances.get(code).klineData`。如果用户重新 open 同一只，需要重新 fetch。是否要缓存？这是个 UX 决策点。

### 8.3 Phase 5 待办（文档同步 + Playwright e2e）
- Playwright 关键路径 e2e：
  - 路由切换（`#/` ↔ `#/limit-up`）
  - 看板渲染（4 分组、排序、复选框、添加选中）
  - 多 K 线图展开
  - live tick 缩放保留
- 文档：
  - `docs/phase4-limit-up-board.md` 用户使用文档
  - AGENTS.md 目录结构同步
  - SPEC.md 数据契约同步

### 8.4 监控页 rebuild on refresh 可能闪烁
`renderTable` 整个重建 tbody。状态栏/输入框 focus 不影响（不重建），但有大量行时会闪烁。可优化为部分 diff render。**Phase 5 优化项。**

---

## 9. 新窗口的 5 步启动指南

1. **读 3 个核心文档**（30 分钟）：
   - `D:\AiPrograms\project1\STATUS.md` — 项目状态 + 历史决策
   - `D:\AiPrograms\project1\AGENTS.md` — 编码规范
   - `D:\AiPrograms\project1\SPEC.md` — 需求真理源

2. **跑一遍全量验证**（5 分钟）：
   ```bash
   cd D:\AiPrograms\project1
   npm install       # 如果需要
   npm test          # 应得 457 pass
   npm run lint      # 应得 0/0
   npm run build     # 应成功
   ```

3. **启动 dev server 看一眼**（5 分钟）：
   ```bash
   npm run dev       # http://127.0.0.1:5173
   ```
   验证：
   - 默认进 `#/`，看到监控页（有刷新频率下拉、voice-bar、alert-bar、表格）
   - 点顶部"涨停看板"导航 → 切到 `#/limit-up`，看到分组的涨停股
   - 在涨停看板点某只股票 → K 线图在所点行下方展开
   - 切换回"监控"→ 立即看到监控页（**注意是 race fix 验证点**）
   - 监控页点某只股票 → K 线图在该行下方展开
   - 再点另一只 → 第二只的 K 线图也展开（**多 K 线图验证**）
   - 任一 K 线图放大缩小 → 等 10s → 缩放位置应保持

4. **浏览器 hard-refresh 提示**：如果用户反馈名字乱码，让用户按 `Ctrl+Shift+R` 清缓存（GBK 修复后已无 bug，但浏览器可能缓存旧代码）。

5. **进入 Phase 5**：参考 STATUS.md 下一步：
   - Playwright e2e 关键路径
   - 文档同步（用户使用文档、AGENTS.md、SPEC.md）
   - 可选优化（renderTable diff render、metadata 升级）

---

## 10. 紧急 fallback 清单

如果 Phase 5 启动后发现测试 fail 或 build error，按以下顺序排查：

1. **测试环境**：检查 `package.json` 的 `test` script 包含 `--require ./tests/_jsdom-setup.cjs`
2. **代理键顺序**：检查 `vite.config.js` 顺序（§6.2）
3. **GBK 编码**：检查 `limitUpApi.js` 有 `TextDecoder('gbk')` + fallback utf-8
4. **race condition**：`app.js` 的 `'#/'` 路由 handler 是否在 `renderMonitorPage` 之前 `limitUpRootEl = null`
5. **多 K 线图状态**：检查 `state.expandedCodes: Set`、`chartInstanceMap: Map` 初始化是否在 state 对象中
6. **缩放保留**：检查 `chart.js` 的 `updateKline/Volume/MA` 方法是否实现 + `applyLiveTickToChartForCode` 是否使用

---

## 11. 关键文件快速跳转

```
src/js/
├── app.js              ← 主应用 + 路由 + 状态 + 监控/涨停 K 线 (主入口)
├── limitUpView.js      ← 涨停看板 UI
├── limitUp.js          ← 涨停分桶/排序/合并 (纯函数)
├── limitUpApi.js       ← 东财涨停池 fetch + 重试 + GBK
├── router.js           ← Hash 路由
├── chart.js            ← TradingView 封装 + update* API
├── kline.js            ← K 线数据格式化 + 涨停阈值
├── parser.js           ← 代码归一化
├── api.js              ← 实时行情 + K 线 fetch
├── storage.js          ← localStorage 封装
├── theme.js            ← 主题切换
├── tts.js              ← 语音合成
├── alert.js            ← 价格提醒
└── worker.js           ← Web Worker 心跳

tests/
├── _jsdom-setup.cjs    ← jsdom 全局（必须保留）
├── app.test.js         ← 集成测试（最大）
├── limitUpView.test.js ← 视图测试
├── limitUpApi.test.js  ← API 解析 + 重试 + GBK
├── limitUp.test.js     ← 纯函数
├── chart.test.js       ← chart.js 测试（含 update*）
├── router.test.js      ← hash 路由
├── kline.test.js       ← K 线 + 涨停阈值
├── api.test.js         ← 实时行情
├── storage.test.js     ← storage
└── ...

vite.config.js         ← API 代理（**键顺序敏感**）
package.json            ← jsdom 依赖 + qunit --require
index.html              ← SPA 入口
src/style.css           ← 全局 + 主题 + 涨停看板 + 行内 K 线样式
```

---

## 12. 提交者备注

这个项目从 Phase 0 一路做到 Phase 4.3，每次都是用 superpowers 的 brainstorming → writing-plans → subagent-driven-development 流程推进。每轮都做了 TDD：写测试 → 红 → 实现 → 绿 → review。

**做得好的地方**：
- TDD 严格遵循（每次都是先写失败测试）
- 模块化清晰（router/limitUp/limitUpApi/limitUpView 各自独立）
- 调试过程都沉淀到 STATUS.md 调试过程章节，避免重复踩坑
- 实时 bug 修复（GBK、字段映射、race、缩放）都用 TDD 走完整流程

**有遗憾的地方**：
- 涨停 metadata 未能真正获取到（东财公开 API 限制），只能 best-effort
- 一些子代理实现时把"callback" 模式实现成 "element ref" 模式，导致初始版本有 bug，后续修复
- 5xx 重试应该更激进（当前 1 次，可考虑 2-3 次 + 指数退避）

**给后续 AI 的建议**：
- 严格遵循 AGENTS.md 编码规范（ESM / camelCase / UPPER_SNAKE / 无注释除非必要）
- 每次修改前跑 `npm test && npm run lint && npm run build` 作为健康检查
- 修改 vite.config.js 时注意代理键顺序
- 引入新依赖时更新 STATUS.md 调试过程章节
- 重大设计变更前先 brainstorming → writing-plans → subagent-driven

---

**Handoff 完成。新窗口可以开始 Phase 5。**
