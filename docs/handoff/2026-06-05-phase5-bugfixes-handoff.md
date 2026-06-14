# Phase 5 + 后续 Bug 修复 — 交接文档

> **新窗口从这里开始**：本 session 完成了 Phase 5 (e2e + 文档同步) 并修复了 2 个 K线图相关 bug。读完 STATUS.md + 本文档 + `AGENTS.md` + `SPEC.md` 即可完全接手。

- **日期**: 2026-06-05
- **前一个 session**: 完成 Phase 0-4.3
- **本 session 范围**: Phase 5 + Bug Fix #1 + Bug Fix #2

---

## 1. 30 秒速览

| 指标 | 数值 |
|------|------|
| **测试** | **489 total** = 457 unit + 32 e2e（含 2 个新回归测试），**全 pass** |
| **Lint** | 0 errors / 0 warnings |
| **Build** | 成功 (223.90 kB JS / 15.86 kB CSS / gzip 70.01 kB) |
| **新增 e2e** | 6 文件 / 32 用例 (Phase 5: 30 + Bug Fix 回归: 2) |
| **新增源码** | 0 个（仅修改 app.js 加 2 个 test helper + 1 个函数 + 1 处 finally） |
| **新增 docs** | 4 个 (Phase 5: 3 + handoff 1) |
| **修复 bug** | 2 个（K线不显示 + 缩放被重置） |

---

## 2. Phase 5 任务（已完成）

### 2.1 任务清单
- ✅ **Playwright e2e** 30 个用例（6 spec）
- ✅ **e2e fixtures**（4 个文件：tencent/eastmoney-kline/limit-up + helpers）
- ✅ **设计 + 实施计划**（2 个 docs）
- ✅ **AGENTS.md 同步**（目录结构 + 8 个 API 代理）
- ✅ **SPEC.md 同步**（§3.6 涨停看板 + §5.3 涨停对象）
- ✅ **phase4-limit-up-board.md 用户文档**（含功能/访问/排序/Q&A）
- ✅ **phase4 design 风险章节补全**（6 → 13 条）

### 2.2 e2e 覆盖矩阵
| spec | cases | 覆盖 |
|------|-------|------|
| `navigation.spec.js` | 5 | 路由切换、默认页、未知路径回退、刷新保持 |
| `monitor.spec.js` | 6 | 添加/删除/主题/刷新频率/状态栏 |
| `limit-up.spec.js` | 9 | 4 分组渲染/排序/复选框/全选/频率/空响应锁定 |
| `limit-up-row-click.spec.js` | 3 | 行内 K线/关闭/批量加入跳转 |
| `chart.spec.js` | 5 (+2 回归) | 监控 K线/多 K线/关闭/周期/看板 K线 + 2 bug fix 回归 |
| `persistence.spec.js` | 2 | 监控配置/看板刷新频率 reload 保留 |
| **合计** | **32** | |

### 2.3 e2e 网络 mock 策略
- 所有 `/api/*` 用 `page.route()` 拦截，注入固定 fixture
- Tencent mock 用 `iconv-lite@0.6.3`（vite transitive dep）encode GBK bytes
- localStorage 通过 `sessionStorage` 标记避免 `addInitScript` 重复清空
- 完整 mock setup 在 `e2e/helpers.js`

---

## 3. Bug Fix #1 — K线图加载后不显示

### 3.1 症状
点行 → K线面板展开（标题/周期 tab/关闭按钮/状态文字"日K · 320 根"全在）→ **400px 高的图表区域完全空白**（无 canvas，无网格，无K线）。

### 3.2 根因
1. `openChart(code)` → `renderTable` → `renderInlineChartRow` 创建 chart-host → `mountChartForCode` 创建 chart ctl（**此时 host 有 1 个 child**）
2. 异步 `loadKlineForCode` 完成 → finally 块调 `renderData()` → `renderTable()` → `wrap.innerHTML = ''` **销毁旧 chart-host DOM**
3. `renderInlineChartRow` 创建**新** chart-host
4. `mountChartForCode` 再被调用 → `chartInstanceMap.has(code)` 为 true → **跳过**（不清旧 ctl 也不建新的）
5. 结果：旧 ctl 引用 detached element，**新 host 永远是空的**

跟历史 bug "切周期不显示" 同源（孤儿 chart ctl），但路径不同。

### 3.3 修复
**`src/js/app.js:renderTable`** — 重建前先 destroy 所有 chart ctl：
```js
function renderTable() {
  for (const code of [...state.expandedCodes]) {
    const ctl = chartInstanceMap.get(code);
    if (ctl) {
      try { ctl.destroy(); } catch { /* ignore */ }
      chartInstanceMap.delete(code);
    }
  }
  const wrap = document.getElementById('table-wrap');
  // ... 原逻辑
}
```

### 3.4 回归测试
`e2e/chart.spec.js:32` "K 线数据加载后 chart-host 不应被清空"：
- 流程：加 sh600519 → 点行 → 等 status "N 根" → 等 500ms → 断言 `chart-host.children.length > 0`
- 修复前：children=0
- 修复后：children=1, canvas=7

---

## 4. Bug Fix #2 — 定时刷新重置 K线缩放

### 4.1 症状
K线图能正常显示，但用户放大缩小/拖动后，10s 周期 refresh 触发时缩放/拖动状态被重置（chart 跳回 fitContent）。

### 4.2 根因
Phase 4.3 修了"live tick 不重置"（`updateChartLastTickMulti` 用 `series.update()`），但漏了"refresh 重建表重置"：
1. `updateChartLastTickMulti` 用 `series.update()` 保留缩放 ✓
2. 但 `refreshNow` finally 调 `renderData()` → `renderTable()`（**Bug Fix #1 加的 destroy 逻辑**）→ **chart ctl 整个被销毁重建，缩放丢失**

跟 Fix #1 反向：Fix #1 是 chart 不显示；Fix #2 修了 Fix #1 后又引入新问题。

### 4.3 修复
**`src/js/app.js:refreshNow` finally** + 新函数 `updateRowQuoteCells`：
```js
// 旧：
} finally {
  state.loading = false;
  renderData();  // 重建表 → 销毁 chart ctl → 缩放丢失
}

// 新：
} finally {
  state.loading = false;
  // Refresh path 不重建表。chart ctl 通过 series.update 保留缩放
  for (const code of state.watchList) {
    if (state.quotes.has(code)) updateRowQuoteCells(code);
  }
  renderStatus();
}
```

`updateRowQuoteCells(code)` 原地更新 `<tr data-code="X">` 的 name + 6 个数值 cell（price/change/percent/open/high/low）。

### 4.4 回归测试
`e2e/chart.spec.js:70` "定时刷新不应重建 chart ctl"：
- 流程：加 sh600519 → 点行 → 等 status "N 根" → 标记 chart-host + 根 DIV → 改 refresh=3s → 等 3.5s → 断言标记保留
- 修复前：标记丢失
- 修复后：标记保留

### 4.5 Test helper 导出
```js
// src/js/app.js
export function _getChartInstance(code) { return chartInstanceMap.get(code); }
export function _forceRefresh() { return refreshNow(); }
```

---

## 5. 关键文件变更

### 5.1 源码（仅 `src/js/app.js` 修改）
- `renderTable()`: 新增 8 行 destroy chart ctl 循环
- `refreshNow()` finally: `renderData()` → `updateRowQuoteCells` 循环
- 新增 `updateRowQuoteCells(code)`: 30 行，原地更新 row cells
- 新增 `_getChartInstance` / `_forceRefresh`: 7 行 test helper

总修改：~45 行

### 5.2 新增文件
```
docs/
├── plans/2026-06-05-phase5-docs-e2e-design.md    (Phase 5 设计)
├── plans/2026-06-05-phase5-docs-e2e-impl.md      (Phase 5 实施)
└── phase4-limit-up-board.md                       (用户文档)

e2e/
├── helpers.js                                     (mock setup)
├── fixtures/tencent-quotes.js                     (Tencent GBK mock)
├── fixtures/eastmoney-kline.js                    (K线 mock)
├── fixtures/limits-up.js                          (涨停池 mock)
├── navigation.spec.js                             (5 cases)
├── monitor.spec.js                                (6 cases)
├── limit-up.spec.js                               (9 cases)
├── limit-up-row-click.spec.js                     (3 cases)
├── chart.spec.js                                  (7 cases = 5 + 2 回归)
└── persistence.spec.js                            (2 cases)
```

### 5.3 修改文件
- `AGENTS.md` — 目录结构 + 8 个 API 代理
- `SPEC.md` — §3.6 涨停看板 + §5.3 涨停对象
- `docs/plans/2026-06-05-phase4-limit-up-board-design.md` — 风险章节 6→13 条
- `STATUS.md` — Phase 5 章节 + 2 bug fix 章节 + 文件统计

---

## 6. 调试过程沉淀（避免重复踩坑）

### 6.1 K线图相关
- **K线历史只拉一次就够**：定时刷新不应重新拉 K线（昂贵）；改成把实时报价合并到最后一根 K线
- **lightweight-charts headless 限制**：playwright 默认 headless 模式不创建 canvas，但 chart instance 创建成功。e2e 只断言 host children > 0
- **chart ctl 一旦 attach 就跟 host 绑定**：host 被销毁 → ctl 引用 detached element。destroy 必须显式调
- **renderTable 重建前必须 destroy 所有 chart ctl**：否则 ctl 引用 detached element，新 host 永远空（Fix #1 根因）
- **renderTable 重建会丢失用户缩放**：周期 refresh 不应走 renderTable 路径（Fix #2 根因）
- **live tick 用 series.update() 保留缩放**：但只在不重建表的前提下才有效

### 6.2 e2e 框架
- **`page.route()` 拦截所有 `/api/*`**：用 `iconv-lite` encode GBK bytes（vite transitive dep，无需新装）
- **`addInitScript` 每次 page load 都跑**：用 sessionStorage 标记避免 reload 时清 localStorage
- **CSS selector `data-group="3+"`**：querySelector 直接用 OK，但 e2e 中用 `page.evaluate` 拿元素最稳
- **storage key 大小写敏感**：`app_theme` / `stock_watch_list` / `limit_up_settings`（项目实际 key）
- **mock 字段必须对齐真实 API 长度**：tencent `parseTencent` 要求 fields >= 35

### 6.3 vite 代理（**键顺序敏感**）
vite 5 按对象键插入顺序首个 `startsWith` 匹配胜出。前缀重叠时长键必须在前：
- `/api/eastmoney-kline` 必须在 `/api/eastmoney` 前
- `/api/eastmoney` 必须在 `/api/limit-up` 前
- `/api/limit-up` 必须在 `/api/sina` 前
- `/api/qq-kline-min` 必须在 `/api/qq-kline` 前

### 6.4 HMR 注意
修改 `src/js/app.js` 后 vite HMR 会自动推送，但浏览器可能缓存旧代码。如果测试结果与预期不符，**手动 hard refresh (Ctrl+Shift+R) 或重启 dev server**。

---

## 7. 关键命令

```bash
npm run dev         # http://127.0.0.1:5173
npm run lint        # 0/0
npm test            # 457 pass
npx playwright test # 32 pass in ~40s
npm run build       # 成功
npm run ci          # lint + test + e2e + build
```

单测修复（修复某模块后单独跑）：
```bash
npx playwright test e2e/chart.spec.js:32    # Fix #1 回归
npx playwright test e2e/chart.spec.js:70    # Fix #2 回归
```

---

## 8. 已知遗留（不在 Phase 5 范围）

1. **`renderTable` 整表重建**（大量行闪烁）→ 已通过 Fix #2 部分缓解（refresh 路径不重建）；新增/删除行仍会全表重建。彻底解决需 diff render
2. **排序选项未持久化**（`app.js:handleLimitUpSortChange` 未调 `patchLimitUpSettings`）
3. **涨停 metadata 公开 API 拿不到**（连板数/封板时间/炸板次数）→ 当前 best-effort per-stock API 默认 0/null/0；升级路径：AKTools 后端代理
4. **5xx 重试只 1 次** — push2.eastmoney.com 凌晨/上游降级 ~40% 502。考虑 2-3 次重试 + 指数退避

---

## 9. 下一步建议（新窗口）

按优先级：

1. **用户浏览器最终验证**（监控 + 看板 + K线 + 持久化 + 主题切换 + 缩放保留）
2. **可选优化**（独立 PR）：
   - `renderTable` 真正 diff render（保留 DOM，避免闪烁）
   - 排序选项持久化
   - 涨停 metadata 升级（AKTools 后端代理）
3. **新功能**（需求评审 + 单独设计）：
   - 监控页"批量加入看板"
   - 涨停看板分页 / 筛选（市值、行业、概念）
   - 实时涨停提醒
4. **基础设施**：
   - 仓库迁移到 git（当前 `D:\AiPrograms\project1\` 无 git 跟踪）
   - CI/CD（GitHub Actions 跑 `npm run ci`）
   - 浏览器兼容矩阵

---

## 10. 紧急 fallback 清单

如果 Phase 5+ 工作遇到问题：

1. **测试 fail**：`package.json` 的 `test` script 包含 `--require ./tests/_jsdom-setup.cjs`
2. **e2e 缺浏览器**：`npx playwright install chromium`
3. **GBK 编码 e2e mock 不工作**：检查 `e2e/helpers.js` 用 `iconv-lite`
4. **K线图空白**：检查 `renderTable` 开头有 destroy 循环
5. **缩放被重置**：检查 `refreshNow` finally 调 `updateRowQuoteCells` 不是 `renderData`
6. **Chart ctl 引用错误**：`chartInstanceMap` 必须与 `state.chartInstances` 同步

---

## 11. 测试覆盖率（最终）

| 层级 | 工具 | 数量 | 覆盖 |
|------|------|------|------|
| 单元 | QUnit + jsdom | 457 | 纯函数 / API 解析 / 视图渲染 / 路由状态 |
| e2e | Playwright + Chromium | 32 | 路由 / 看板 / 监控 / K线 / 持久化 + 2 bug fix 回归 |
| 浏览器手测 | 真实 Chrome | (用户验证) | 视觉 / 主题 / 触摸 / 响应式 |
| CI | `npm run ci` | 全绿 | lint + test + e2e + build |

---

**Phase 5 + Bug Fixes 全部完成并验证通过。新窗口可以基于此接手。**
