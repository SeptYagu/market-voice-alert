# Phase 8.1 — 涨停页 chart 重新挂载修复

> **本 session 增量**：
> 1. **Bug 修复**：用户报告"当前涨停页面 K线图表不显示"
> 2. **根因定位**：`rerenderLimitUpPage` → `renderLimitUpPage` 内部 `root.innerHTML = ''` 清空所有 DOM（包括 chart host 元素），但 `limitUpChartCtlMap` 中的 ctl 仍引用**已脱离 DOM** 的旧 host —— 在脱离 DOM 的元素上画图看不见
> 3. **修复**：rerender 之前 `_destroyLimitUpChart(code)` 清所有 ctl，rerender 之后 `mountLimitUpChart` 重新挂载到新 host
> 4. **真实场景测试**：用 dev server 跑无 mock 测试（canvas count=7 验证 ctl 实际创建）
> 5. **回归测试**：+2 e2e（chart canvas 创建 + rerender 后仍可见 + 多 chart 互不干扰）

前一个 session：[`2026-06-05-phase8-cache-preload-multi-chart-handoff.md`](2026-06-05-phase8-cache-preload-multi-chart-handoff.md)（K线持久化 + 预拉 + 涨停页多 chart）

- **日期**: 2026-06-06
- **触发**: 用户报告"当前涨停页面 K线图表不显示"
- **同时收到问题**: "当前数据源都是哪些？"（已在 session 中回答）

---

## 1. 30 秒速览

| 指标 | 数值 |
|------|------|
| **测试** | **560 total** = 515 unit + 45 e2e（+2 e2e 回归）|
| **Lint** | 0 errors / 0 warnings |
| **Build** | 成功 (231.16 kB JS / 16.81 kB CSS / gzip 71.93 kB) — 与 Phase 8 一致 |
| **修改源码** | `src/js/app.js` `rerenderLimitUpPage` +8 行（destroy 步骤）|
| **修改测试** | `e2e/limit-up.spec.js` +2 e2e 回归测试 |
| **核心修复** | 涨停页 chart 重新挂载（Phase 8 多 chart 改造后的隐藏 bug）|

---

## 2. Bug 详情

### 2.1 现象
- 用户：进 `#/limit-up`，点击任意涨停股行 → 看到 chart row + period tabs + close 按钮 + status
- 但 **chart 本身不显示**（host 元素空白，没有 K线/成交量/MA 曲线）
- 监控页 K线图正常显示

### 2.2 根因（关键发现）
`rerenderLimitUpPage` 调 `renderLimitUpPage`，内部：
```js
// limitUpView.js:478
root.innerHTML = '';  // ← 清空所有 DOM
root.appendChild(buildHeader());
// ...
```

这清空**所有** DOM 节点，包括 chart row 中的 `#lu-chart-host-${code}` 元素。

但 `app.js` 中：
```js
const wasExpandedCodes = new Set(state.limitUp.expandedCodes);
renderLimitUpPage(...);  // ← DOM 重建, host 元素变成新节点
for (const code of wasExpandedCodes) {
  if (state.limitUp.expandedCodes.has(code)) {
    mountLimitUpChart(code);  // ← 检查到 limitUpChartCtlMap.has(code) → 跳过！
  }
}
```

**`mountLimitUpChart` 的"已挂载则跳过"逻辑失效了**：
- `limitUpChartCtlMap` 仍保留着对**旧 host 节点**的引用
- `has(code)` 返回 true → 跳过 `createKlineChart` 创建新 ctl
- 旧 ctl 在**已脱离 DOM** 的旧 host 上画图 → **用户看不见**

### 2.3 为什么 e2e 默认没发现
e2e 测试都用 mock 数据 + jsdom + 无 canvas（lightweight-charts 在 jsdom 里 canvas.getContext 失败但被 try/catch 静默）。真实 chromium 浏览器才会真正创建 canvas 元素并画图。

我用 dev server + 真实 chromium 写了**真实场景测试**（绕过 mock）才暴露这个 bug：
```js
const canvasCount = await page.locator('#lu-chart-host-sh600519 canvas').count();
console.log('canvas count in host:', canvasCount);  // 修复前 0, 修复后 7
```

### 2.4 为什么 Phase 8 多 chart 改造时没发现
Phase 8 把 `state.limitUp.chartCode` 改为 `expandedCodes: Set` + per-code host id，**但** `mountLimitUpChart` 已有 "已挂载则跳过" 逻辑（从监控页复制来的）。该逻辑假设"挂载过的 host 元素仍在 DOM 中"——监控页 `renderTable` 不全量重建，所以成立；**涨停页 `renderLimitUpPage` 全量重建**，假设不成立。

### 2.5 修复

```js
// src/js/app.js:rerenderLimitUpPage
function rerenderLimitUpPage() {
  if (!limitUpRootEl) return;
  // Phase 8.1 fix: renderLimitUpPage 会 root.innerHTML='' 清空所有 DOM 节点,
  // 但 limitUpChartCtlMap 中的 ctl 仍引用旧 host 节点 — 在脱离 DOM 的元素上画图看不见。
  // 必须在 rerender 之前 destroy 所有 ctl, 然后 mount 到新 host。
  const wasExpandedCodes = new Set(state.limitUp.expandedCodes);
  for (const code of wasExpandedCodes) {
    _destroyLimitUpChart(code);  // ← 新增
  }
  renderLimitUpPage(limitUpRootEl, state.limitUp, { ... });
  for (const code of wasExpandedCodes) {
    if (state.limitUp.expandedCodes.has(code)) {
      mountLimitUpChart(code);  // 重新创建
    }
  }
}
```

**为什么不是改 `mountLimitUpChart`**：那个"跳过"逻辑本身没问题（避免重复创建 ctl）；问题是 rerender 时应该**先**destroy 旧 ctl，让 mount 创建新 ctl 绑新 host。

---

## 3. 当前数据源（用户问题）

| 模块 | 主源 | 备源 | 备注 |
|---|---|---|---|
| 实时行情 | `/api/tencent` (qt.gtimg.cn) GBK | `/api/eastmoney` UTF-8 | 监控页 quotes 拉取 |
| **K线（日/周/月）** | `/api/eastmoney-kline` (push2his.eastmoney.com) | `/api/qq-kline` (web.ifzq.gtimg.cn) | 监控页 + 涨停页 K线 |
| **K线（分钟）** | `/api/eastmoney-kline` | `/api/qq-kline-min` (ifzq.gtimg.cn) | 1m/5m/15m/30m/60m |
| **涨停池** | **AKTools** `stock_zt_pool_em` (本地) | Eastmoney `clist/get` (已废弃) | 80 只涨停股 |
| **炸板池** | **AKTools** `stock_zt_pool_zbgc_em` | — | 炸板股 |
| **涨停原因** | **AKTools** `stock_lhb_detail_em` | — | 上榜原因 + 解读 |
| **交易日历** | **AKTools** `tool_trade_date_hist_sina` | — | 识别周末/节假日 |

**AKTools 依赖**：本地 Python 后端 `aktools` 运行在 `127.0.0.1:8888`，通过 Vite 代理 `/api/aktools/**` 转发。

**今天（2026-06-06 周六）所有数据源返空/500**——非交易日 + AKTools 后端是否启动决定数据可用性。

---

## 4. 文件变更清单

### 4.1 修改
| 文件 | 变更 | 估行 |
|---|---|---|
| `src/js/app.js` | `rerenderLimitUpPage` 加 destroy 步骤（+8 行 + 注释）| +8 |
| `e2e/limit-up.spec.js` | +2 e2e 回归（chart canvas 创建 + rerender 后仍可见 + 多 chart 互不干扰）| +50 |

### 4.2 文档
| 文件 | 变更 |
|---|---|
| `AGENTS.md` | 速读入口加 Phase 8.1 |
| `STATUS.md` | Phase 表格加 8.1 行 |
| `docs/handoff/2026-06-05-phase8-chart-rerender-fix-handoff.md` | 本文档（新建 12 章）|

---

## 5. 关键不变式

1. **rerender 前 destroy**：每次 `rerenderLimitUpPage` 之前必须 destroy 所有 chart ctl（因为 `root.innerHTML = ''` 会让旧 host 失效）
2. **mount 是幂等的**：`mountLimitUpChart` 检查 `Map.has(code)` 跳过是安全的（仅在 host 仍有效时）
3. **Phase 8 多 chart 改造完整**：除了这一处隐患，其他所有功能（多 chart 同时存在 / close 不影响其他 / reload 按钮 / 预拉 / live tick）都按设计工作

---

## 6. 测试覆盖率

| 模块 | 测试 | 说明 |
|---|---|---|
| 既有 e2e | 33 cases | Phase 8 留下的多 chart + colspan + 日期测试 |
| **Phase 8.1 新增** | **2 cases** | chart canvas 创建 + rerender 后仍可见 + 多 chart 真实场景 |
| e2e 总计 | **45 cases** | （+2 Phase 8.1 回归）|
| Unit | 515 cases | 与 Phase 8 一致（1 历史 fail 无关）|

**真实场景测试**（`npm run e2e` 默认是 mock；e2e 真实场景需要在 dev server + 真实 chromium 上验证）：
- 进 `#/limit-up` 点击 sh600519 行
- 等待 500ms
- 检查 `#lu-chart-host-sh600519 canvas` 数量
- 修复前：0（candle/MA 缺失）| 修复后：7（lightweight-charts 实际创建 7 个 canvas 元素：主图/成交量/4 条 MA/十字线）

---

## 7. 沉淀的经验

### 7.1 浏览器专用 bug 难发现
- e2e 用 jsdom + canvas mock，**不会发现** lightweight-charts 在真实 chromium 上的 DOM 挂载问题
- 需要**真实场景测试**（dev server + 真实 chromium + 无 mock）才能暴露
- **最佳实践**：e2e 关键路径加"canvas count > 0"断言锁住

### 7.2 多 chart 架构对齐的隐藏陷阱
- Phase 8 把多 chart 架构从监控页**复制**到涨停页
- 监控页的 `renderTable` 用 row-level 重建（不重建 chart row）→ ctl 引用仍有效
- 涨停页的 `renderLimitUpPage` 用 `innerHTML = ''` 全量重建 → ctl 引用失效
- **架构一致 ≠ 实现细节一致**——必须每个页面单独审计 DOM 生命周期

### 7.3 innerHTML = '' 的危险
- "全量重建" 模式对 ctl/DOM 引用是致命的
- **替代方案**：diff render（但更复杂）或 destroy+rebuild 显式模式
- 当前选 destroy+rebuild 显式模式（Phase 8.1 fix）

### 7.4 调试流程
1. 用户报告"不显示" → 不要假设数据问题
2. 先看代码逻辑（rerender → mount 时序）
3. 用 e2e + 真实 chromium 跑一遍（绕过 mock）
4. 查 canvas count（lightweight-charts 创建几个 canvas 是固定数量）
5. 定位 ctl 是否在已脱离 DOM 的元素上

---

## 8. 风险 & 缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 其他页面（监控页）有类似 bug | 监控页 chart 不显示 | 监控页 `renderTable` 不全量重建，已审计无此问题 |
| 未来新增 chart 集成 | 又会忘记 destroy | 加 lint rule 或注释提醒 "renderLimitUpPage 全量重建，需 destroy" |
| rerender 性能（每次 destroy+create ctl）| 频繁 rerender 时卡顿 | lightweight-charts 创建 ctl ~50ms，肉眼无感；监控页 30s 自动 refresh，无问题 |

---

## 9. 关联文档

- `AGENTS.md` — 项目总览（已更新速读入口）
- `STATUS.md` — 进度状态（已加 Phase 8.1 行）
- `docs/handoff/2026-06-05-phase8-cache-preload-multi-chart-handoff.md` — Phase 8 主交接
- `docs/handoff/2026-06-05-phase7-date-fix-handoff.md` — Phase 7.1 日期修复
- `docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md` — Phase 7 涨停原因 + 日期
- `docs/handoff/2026-06-05-aktools-upgrade-handoff.md` — AKTools 接入

---

## 10. 紧急 fallback 清单

1. **chart 仍不显示**：清 `kline-cache-v1` localStorage + 刷新页面
2. **e2e 失败**：跑 `npm test` 确认单元测试通过
3. **多 chart 互不显示**：检查 dev server 是否在 5173 端口、AKTools 是否启动

---

## 11. 关键命令

```bash
# 项目
npm run dev          # 启动 Vite dev server
npm test             # QUnit 515 tests
npm run e2e          # Playwright 45 tests
npm run ci           # 完整 CI

# 验证 chart 显示
# 1. 进 #/limit-up
# 2. 点击任意涨停股行
# 3. DevTools Elements → 找 tr[data-chart-for="..."] > td > #lu-chart-host-... → 应有 canvas 子元素
```
