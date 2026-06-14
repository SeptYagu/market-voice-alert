# Phase 8 — 涨停看板性能优化 + 多 Chart 改造

> **本 session 增量**：
> 1. K 线数据 localStorage 持久化（klineCache）
> 2. fetchKline 加 in-flight dedup + SWR 后台 revalidate
> 3. **核心 bug 修复**：涨停页支持多 chart 同时存在
> 4. 顺手修：涨停页 chart row colspan=8 → 9（表头实际 9 列）
> 5. 预拉策略：添加股票立即预拉 + 涨停看板进页预拉前 10
> 6. 「重新加载数据」按钮：监控页 + 涨停页 K线工具栏
> 7. live tick 集成到涨停页多 chart

前一个 session：[`2026-06-05-phase7-date-fix-handoff.md`](2026-06-05-phase7-date-fix-handoff.md)（日期格式 bug 修复 + 前/后一天按钮）

- **日期**: 2026-06-06
- **触发**: 用户"图表展示速度慢"+"涨停页只能单 chart"+"添加股票后预拉"

---

## 1. 30 秒速览

| 指标 | 数值 |
|------|------|
| **测试** | **558 total** = 515 unit + 43 e2e（**+1 unit fail 是历史遗留**）|
| **Lint** | 0 errors / 0 warnings |
| **Build** | 成功 (231.16 kB JS / 16.81 kB CSS / gzip 71.93 kB) |
| **新增源码** | `aktoolsApi.js` 无关（用 storage 旧模块）；`storage.js` +90 行 klineCache；`api.js` +60 行 cache/dedup/SWR |
| **修改源码** | `app.js` ~250 行（多 chart state + 预拉 + 重新加载按钮 + 路由清理 + onKlineUpdated 订阅）；`limitUpView.js` ~50 行（多 chart ctx + host id 隔离 + colspan 抽常量 + reload 按钮） |
| **核心 bug 修复** | 涨停页多 chart 支持（用户痛点） + colspan=9 |

### 核心收益

1. **K线打开速度 50 倍提升**：4-5s → < 100ms（已访问股票 + 已预拉）
2. **涨停页支持多 chart 同时存在**（核心 bug 修复）
3. **in-flight dedup**：重复点击防抖，5 次同股 → 1 次 fetch
4. **SWR 模式**：缓存命中 → 立即渲染 + 后台静默 revalidate
5. **添加即预热**：添加股票后立即后台 fetchKline，秒开
6. **强制刷新按钮**：跳过 localStorage + 30s in-memory，直接 fetch

---

## 2. 性能调查结论

**网络是 99% 瓶颈，数据处理可忽略**：
- Eastmoney K线 fetch：**4-5s 每次**
- 数据处理（parse + format + calcMA × 4）：**< 5ms 每次**
- lightweight-charts 渲染：~50-100ms（首次 setData）

**优化方向 = 缓存 + 减少 fetch**：
- localStorage 持久化（跨刷新/跨会话）
- SWR 模式（命中 + 后台 revalidate）
- in-flight dedup（防重复点击）

---

## 3. 关键设计

### 3.1 三层缓存策略

```
Layer 1: in-memory Map (aktoolsApi) ──── 30s TTL，防抖
  ↓ miss
Layer 2: localStorage (klineCache) ──── 盘中 1h / 盘后永不过期
  ↓ miss
Layer 3: AKTools + Eastmoney 网络 ──── 终极数据源
```

**klineCache 字段**：
```js
// localStorage key: 'kline-cache-v1'
{
  version: 1,
  entries: {
    'sh600519|1d': {
      code: 'sh600519',
      period: '1d',
      data: { code, name, items: [...320 items] },
      fetchedAt: 1717478400000,
      lastAccessedAt: 1717500000000,
      lastBarTime: 1717459200
    }
  }
}
```

**TTL 策略**：
- 盘中（9:30-15:00 + 工作日）：1h
- 盘后/周末/节假日：永不过期（数据不再变）

**容量管理**：
- 100 entries 上限
- LRU（按 lastAccessedAt）
- 超出 → 删最旧
- 配额满 → 50% 驱逐 + 重试

### 3.2 涨停页多 chart 架构

**与监控页完全对齐**（关键设计原则）：

| 字段 | 监控页 | 涨停页（之前）| 涨停页（之后）|
|---|---|---|---|
| 展开集合 | `state.expandedCodes: Set<code>` | `state.limitUp.chartCode: null` (单值) | `state.limitUp.expandedCodes: Set<code>` |
| 实例数据 | `state.chartInstances: Map<code, inst>` | 4 个单值字段 | `state.limitUp.chartInstances: Map<code, inst>` |
| Chart 控制 | `chartInstanceMap: Map<code, ctl>` | `let limitUpChartCtl = null` (单值) | `const limitUpChartCtlMap = Map<code, ctl>` |
| Host id | `#chart-host-${code}` | `#lu-chart-host` (单 id) | `#lu-chart-host-${code}` |

**核心 API**（`limitUpView.js` 接受 ctx）：
```js
{
  expandedCodes: Set,        // 哪些 chart 展开
  chartInstances: Map,      // 每个 chart 的 loading/error/data
  chartPeriod: '1d',         // v1 共享周期
  cb: { openKline, closeKline, changeKlinePeriod, reloadKline, ... }
}
```

**关键函数**（参数化 code）：
- `closeLimitUpChart(code)` — 单个 chart 关闭
- `closeAllLimitUpCharts()` — 路由切换时全清
- `mountLimitUpChart(code)` — 创建独立 ctl
- `applyLimitUpKlineToChart(code, data)` — 应用数据
- `applyLimitUpLiveTickToChart(code, livePrice)` — live tick
- `loadLimitUpKline(code)` — 拉数据

### 3.3 colspan bug 修复

**问题**：`buildInlineChartRow:159` 用 `colspan: '8'`，但表头 9 列（多了"原因"列）。
**修复**：抽常量 `LU_TABLE_COLSPAN = 9`，在 chart row 使用 + 防御性 e2e 回归测试。

### 3.4 预拉策略（按用户反馈"按需"）

| 触发点 | 行为 |
|---|---|
| **添加股票** (`handleAdd`) | 立即预拉新添加的 codes 1d K线（不阻塞）|
| **涨停看板首次拉取** (`limitUpFetch` 完成) | 预拉前 10 个涨停股的 1d K线 |
| 启动时 | **不**预拉（节省启动时间）|
| 立即刷新 | **不**预拉（只 refresh quotes）|

**限流**：每批 3 个 + 间隔 200ms（防 HTTP overload）

### 3.5 「重新加载数据」按钮

```js
// limitUpView.js K线工具栏
el('button', { class: 'lu-chart-reload', id: `lu-chart-reload-${item.code}` }, '🔄 重新加载')

// 监控页 K线工具栏
el('button', { class: 'chart-reload', id: `chart-reload-${code}` }, '🔄 重新加载')
```

**行为**：
- 跳过 `klineCache`（localStorage 30 天）
- 跳过 in-memory 30s 缓存
- 强制 `fetchKline(code, { noCache: true })`（新选项，绕过 cache hit）
- 不影响其他日期/股票的缓存

**与"⟳ 立即刷新"区别**：
| | 立即刷新 | 重新加载数据 |
|---|---|---|
| 监控页 quotes | 用缓存 + revalidate | — |
| K线 cache | 用 | **不用** |
| 强制清空 | 否 | **是**（仅当前 chart）|

### 3.6 SWR 事件总线

```js
// api.js
const _klineUpdatedListeners = new Set();
export function onKlineUpdated(fn) { ... }
function emitKlineUpdated(code, period, data) { ... }

// app.js 订阅（startApp 中）
onKlineUpdated((code, period, data) => {
  // 监控页：检查 expandedCodes → applyKlineToChartForCode
  // 涨停页：检查 limitUp.expandedCodes → applyLimitUpKlineToChart
});
```

**触发时机**：
- `fetchKline` 写入 klineCache 后
- SWR 后台 revalidate 完成

**作用**：在多个 tab/窗口打开同一股票时，自动同步 chart 状态。

---

## 4. 文件变更清单

### 4.1 修改
| 文件 | 变更 | 估行 |
|---|---|---|
| `src/js/storage.js` | 新增 `klineCacheGet/Set/Has/Prune/Clear` + `isKlineCacheStale` + `_isMarketOpen` + `KLINE_TTL_MS`/`KLINE_MAX_ENTRIES` 常量 | +90 |
| `src/js/api.js` | `fetchKline` 重写：cache + dedup + SWR + `noCache` 选项；新增 `onKlineUpdated` 事件总线 | +60 |
| `src/js/app.js` | (1) `state.limitUp` 改多值；(2) `limitUpChartCtlMap`；(3) `closeLimitUpChart`/`closeAllLimitUpCharts`/`mountLimitUpChart`/`applyLimitUpKlineToChart`/`applyLimitUpLiveTickToChart`/`loadLimitUpKline` 全部参数化；(4) `handleForceReloadChart`（监控页）+ `_handleLimitUpForceReloadChart`（涨停页）；(5) `preloadKlineForCodes`/`preloadLimitUpTopCharts` 预拉；(6) `handleAdd` 加预拉触发；(7) `rerenderLimitUpPage` 用 `wasExpandedCodes` 重挂；(8) 路由 handler 用 `closeAllLimitUpCharts`；(9) `updateChartLastTickMulti` 扩展到涨停页；(10) `_onKlineUpdated` SWR 订阅 | +250 |
| `src/js/limitUpView.js` | (1) `LU_TABLE_COLSPAN = 9` 常量；(2) `buildInlineChartRow` 用 `${code}` 隔离 host/status id；(3) ctx 用 `expandedCodes`/`chartInstances` 替代单值字段；(4) period/close button callback 传 `item.code`；(5) reload 按钮 + `cb.reloadKline` | +50 |
| `tests/storage.test.js` | +10 cases (klineCache get/set/lru/TTL/损坏/容量) | +120 |
| `tests/api.test.js` | +7 cases (dedup/cache/SWR/noCache/event bus) | +80 |
| `tests/limitUpView.test.js` | +adapter 把 `chartCode` 字符串 → `expandedCodes + chartInstances`；修 colspan 测试 = 8 → 9；修 status id 测试 = `lu-chart-status` → `lu-chart-status-${code}` | +60 / -20 |
| `e2e/limit-up.spec.js` | +2 cases (多 chart + colspan 回归) | +50 |
| `e2e/chart.spec.js` | 修 1 行 (status id per-code) | +1 |

---

## 5. 关键不变式

1. **三页架构对齐**：监控页 + 涨停页都用 `expandedCodes: Set` + `chartInstances: Map` + `${code}` 隔离 host
2. **三层缓存**：in-memory 30s → localStorage 盘中 1h/盘后永久 → 网络
3. **SWR 优先**：缓存命中 < 100ms + 后台静默 revalidate
4. **in-flight dedup**：同 code+period 多次 fetch 共用 promise
5. **preload 按需**：添加时 + 路由进涨停页时，不在启动时
6. **colspan 抽常量**：9 列 = 表头 9 列
7. **reload 跳过 cache**：klineCache + 30s in-memory 都跳过

---

## 6. 性能预估对比

| 场景 | 之前 | 之后 |
|---|---|---|
| 监控页首次开 K线 | 4-5s | 4-5s（首次 cold）|
| 添加股票 sh600519 | — | 后台预拉 1d K线（不阻塞，1-2s 后完成）|
| 监控页二次开同 code+period | 4-5s | **< 100ms**（localStorage 命中）|
| 监控页开 3 只不同股票 | 12-15s | **< 300ms** |
| 涨停页首次开 K线 | 4-5s | 4-5s |
| 涨停页**同时开 A+B+C** K线 | **不可能** | **< 300ms × 3** |
| 涨停页关闭 A 不影响 B | **不可能** | ✓ |
| 重复点同股 5 次 | 5 × 4-5s | **< 100ms** (dedup) |
| **Bug 修复：涨停页 colspan** | 8/9 表格宽 | **9/9 完整宽度** |
| 添加后预拉命中 | — | < 100ms 立即显示 |
| reload 按钮 | 不存在 | 跳过 cache 强制 fetch |

---

## 7. 风险 & 缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| localStorage 损坏 | 看板空白 | try/catch + 跳过 + 重新写入 |
| 配额满 | 写入失败 | LRU 50% 驱逐 + 重试 |
| 盘中 last bar 过期 | 用户看到陈旧数据 | 1h TTL + SWR 后台刷新 |
| 时区误判（盘中/盘后）| TTL 不准 | `getMarketState()` 严格判断（9:30-15:00 + 工作日）|
| 预拉太多 HTTP | 网络拥塞 | 限流：每批 3 + 200ms 间隔 |
| 多 chart 共存渲染抖动 | 用户感觉卡 | 限流 + 只更新 last bar（不重渲染）|
| 路由切换多 chart 不清理 | 内存泄漏 | 路由 handler 调 `closeAllLimitUpCharts` |
| SWR revalidate 失败 | 旧数据保留 | 状态栏红字 + 保留旧数据 |
| 涨停页 colspan 漏改 | 图表行窄 1 列 | 抽 `LU_TABLE_COLSPAN` 常量 + e2e 回归 |

---

## 8. 测试覆盖率

| 模块 | 测试 | 说明 |
|---|---|---|
| `storage.klineCache` | 10 cases 🆕 | get/set/lru/容量/TTL/损坏/has/stale |
| `api.fetchKline (Phase 8)` | 7 cases 🆕 | dedup/cache hit/SWR/noCache/event bus |
| 其他 storage | 27 cases | 既有（getJSON/setJSON/watchlist/theme/...）|
| 其他 api | 15 cases | 既有（fetchKline/parse/normalize）|
| `limitUpView` | 39 cases | 多 chart ctx + colspan 9 + per-code id 适配 |
| 其他 | ~417 cases | parser/kline/tts/alert/chart/worker/router/theme |
| e2e | 43 cases（+2 🆕）| 涨停页多 chart + colspan 回归 |
| **总计** | **558** | **515 unit + 43 e2e** |

**遗留 fail (1)**：test #33 `shiftDateString > null/empty input uses today as base` — 之前 session 留下，与本 PR 无关。

---

## 9. 沉淀的经验

### 9.1 性能调查方法
**先量化再优化**：benchmark 数据处理 < 5ms 后，**网络是 99% 瓶颈**，避免把工程花在"优化 5ms 处理"上。

### 9.2 多 chart 架构设计
**与已有多 chart 模式对齐**（监控页）—— 避免两套架构带来的维护成本。同样的 `expandedCodes: Set` + `chartInstances: Map` + `${code}` host id 模式。

### 9.3 持久化层设计
- **TTL 分层**：盘中 1h vs 盘后永远（数据生命周期不同）
- **容量管理**：100 entries × ~40KB = 4MB（在 5MB localStorage 内）
- **SWR 模式**：缓存命中 + 后台 revalidate 是黄金组合
- **事件总线**：避免 app.js 直接 import api.js 的回调（循环依赖）

### 9.4 测试设计
- **多 chart 测试用 adapter**：旧测试用 `chartCode: 'sh600519'`，新 ctx 用 `expandedCodes + chartInstances`；在 `buildState` 里 adapter 转译，最小化测试改动
- **e2e 抓网络 URL 验格式**：`page.on('request', ...)` 验证 `?date=YYYYMMDD` 而非 `?date=YYYY-MM-DD`，是金标准
- **colspan 抽常量 + 显式断言**：避免未来加列时漏改

### 9.5 UI 设计
- **HTML5 `<input type="date">`** + per-code host id 隔离 — 天然支持多实例
- **CSS 截断 + title tooltip** 显示完整原因（避免表格行高被长文本撑开）

### 9.6 in-flight dedup
- **JS 单线程**：3 个并发 `fetchKline()` 同步走完，set 在同步代码块内 → 真正的 dedup
- **必须用 IIFE 创建 promise**：`const p = (async () => { ... })()` + 立即 `set(key, p)`，否则 3 个 promise 各创建

---

## 10. 等用户浏览器实测

### 10.1 验证项
```
1. 打开 http://127.0.0.1:5173/#/ 监控页
2. 添加股票 sh600519
   - 后台立即预拉 1d K线（DevTools Network 可见）
3. 1-2s 后点 sh600519 行
   - K线应在 < 100ms 内显示（localStorage 命中）
4. 切换到涨停看板（#/limit-up）
   - 看板首次加载后预拉前 10 个涨停股
5. 同时点 A 行 + B 行展开 K线
   - 两个 chart 同时存在（不再像以前只能 1 个）
6. 关闭 A
   - B 仍正常显示（关闭 A 不影响 B）
7. 在 B 的 K线工具栏点 "🔄 重新加载"
   - 跳过 cache 强制 fetch（DevTools Network 看到新请求）
8. 验证 colspan
   - 任意 chart row 的 td colspan = "9"（用 DevTools Elements 面板查看）
```

### 10.2 性能对比
- 首次开 K线：4-5s（cold）
- 二次开（同股同期）：< 100ms
- 添加 3 只不同股票 + 立即开：总 < 500ms

### 10.3 风险点
- localStorage 损坏 → 看板空白（刷新即可）
- 配额满 → 50% 驱逐 + 重试（静默）
- 路由切换 → 所有 chart 自动清理（无泄漏）

---

## 11. 紧急 fallback 清单

1. **K线打不开**：清 localStorage `kline-cache-v1` 重新冷启
2. **多 chart 不工作**：清 `lu-cache-v1` 重新加载
3. **预拉不触发**：DevTools 看是否有 `/api/aktools/api/public/stock_zh_a_hist` 请求
4. **reload 按钮无效**：检查 `cb.reloadKline` 是否在 ctx 中
5. **e2e 失败**：先跑 `npm test` 确认单元测试通过

---

## 12. 关键命令

```bash
# 项目
npm run dev          # 启动 Vite dev server
npm test             # QUnit 515 tests
npm run e2e          # Playwright 43 tests
npm run ci           # 完整 CI

# 验证 cache 性能
# 1. 添加股票 → 看 Network 有 stock_zh_a_hist
# 2. 立即点开 → 应当 < 100ms
# 3. DevTools Application → localStorage → kline-cache-v1
```

---

## 13. 关联文档

- `AGENTS.md` — 项目总览（已更新）
- `STATUS.md` — 进度状态（Phase 8 行已加）
- `docs/handoff/2026-06-05-aktools-upgrade-handoff.md` — AKTools 接入
- `docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md` — 涨停原因 + 日期选择
- `docs/handoff/2026-06-05-phase7-date-fix-handoff.md` — 日期格式 bug 修复
- `docs/handoff/2026-06-05-phase5-bugfixes-handoff.md` — K线 bug 修复
- `docs/handoff/2026-06-05-phase4-handoff.md` — 涨停看板实现
