# Phase 5: 实施计划（10 任务）

> 日期: 2026-06-05
> 状态: ✅ 计划已确认，待执行
> 设计文档: `docs/plans/2026-06-05-phase5-docs-e2e-design.md`

## 任务总览

| # | 任务 | 类型 | 估时 | 依赖 |
|---|------|------|------|------|
| 1 | 创建 e2e fixture 文件 | 新建 | 10 min | 无 |
| 2 | 编写路由切换 e2e | 新建 | 15 min | T1 |
| 3 | 编写监控页 e2e | 新建 | 20 min | T1 |
| 4 | 编写涨停看板 e2e | 新建 | 25 min | T1 |
| 5 | 编写行点击 + 跳转 e2e | 新建 | 15 min | T4 |
| 6 | 编写 K 线展开 e2e | 新建 | 20 min | T1 |
| 7 | 编写持久化 e2e | 新建 | 10 min | T1 |
| 8 | 同步 AGENTS.md + SPEC.md | 文档 | 10 min | 无 |
| 9 | 更新 phase4 design 风险章节 | 文档 | 5 min | 无 |
| 10 | 编写用户文档 + 跑 `npm run ci` + 更新 STATUS.md | 文档 + 验证 | 15 min | T1-T9 |

---

## 任务 1: e2e fixture 文件

**目标**：4 个 fixture 文件，覆盖所有 mock 场景

**新建文件**：
- `tests/fixtures/tencent-quotes.js` — 3 只股票（sh600519 / sz000858 / sh688981）
- `tests/fixtures/eastmoney-kline.js` — sh600519 日 K 30 根 + 5xx 错误 fixture
- `tests/fixtures/limit-up.js` — 涨停池 10 只（覆盖 4 分组 + ST + 炸板）
- `tests/fixtures/limit-up-empty.js` — 空 diff + utf-8 错误 + GBK 中文 fixture

**格式**：
```js
// tests/fixtures/tencent-quotes.js
export const TENCENT_QUOTES_BODY = [
  'v_sh600519="1~贵州茅台~600519~1850.00~1807.50~+42.50~+2.35%~1832456~1860.00~1800.00~...~20260605103500~10.00~0.00~...~";',
  'v_sz000858="1~五粮液~000858~165.50~167.50~-2.00~-1.20%~...~";',
  'v_sh688981="1~中芯国际~688981~52.30~50.00~+2.30~+4.60%~...~";'
].join('\n');
```

**验收**：
- 文件存在 + 内容可被 `page.route` 直接 fulfill

---

## 任务 2: 路由切换 e2e（`e2e/navigation.spec.js`）

**3 个用例**：
1. 默认进入 `#/`，监控页可见
2. 点 nav "涨停看板" → 切到 `#/limit-up` + 看板可见
3. 直接访问 `#/limit-up` → 跳到该页（不显示监控）
4. 访问未知 hash `#/unknown` → 回退 `#/`

**断言**：
- URL hash
- `#app > header nav .nav-link.active` 内容
- `#app > section[data-group]` 存在

**mock 设置**：
```js
test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  // 清 localStorage
  await page.addInitScript(() => localStorage.clear());
  await page.route('**/api/**', ...);
});
```

---

## 任务 3: 监控页 e2e（`e2e/monitor.spec.js`）

**4 个用例**：
1. 输入 `sh600519` + 回车 → 表格出现一行
2. 输入 `600519,000858,nf2105` + 回车 → 表格出现 3 行（注意：nf2105 是期货，sina mock）
3. 点删除按钮 → 行消失
4. 主题切换按钮 → data-theme 改变 + localStorage 持久化

**关键元素 selector**：
- 输入框：`#add-input` 或 `input[placeholder*=代码]`
- 添加按钮：`#add-btn` 或 `button:has-text("+ 添加")`
- 删除按钮：行内 `.row-delete` 或类似
- 主题按钮：`#theme-toggle`
- 主题属性：`document.documentElement.dataset.theme`

---

## 任务 4: 涨停看板 e2e（`e2e/limit-up.spec.js`）

**6 个用例**：
1. 看板渲染：4 个分组（3+ / 2 / 1 / broken） + 总数显示
2. 排序切换：选"涨幅" → 行按涨幅降序
3. 复选框：点 2 个 checkbox → "N 已选" 变 2
4. 批量加入：点 "➕ 添加选中" → 跳到 `#/` + 监控页有这些 code
5. 立即刷新：点 "⟳ 立即刷新" → 触发 fetch
6. 频率切换：选 60s → 看板 timer 间隔变 60s（localStorage 验证）

**关键 selector**：
- `.lu-group[data-group="3+"]` 等
- `.lu-row[data-code="sh600519"]`
- `#lu-sort` select
- `#lu-add-selected` button
- `#limit-up-refresh` select
- `#lu-status` footer

---

## 任务 5: 行点击 + 跳转（`e2e/limit-up-row-click.spec.js`）

**2 个用例**：
1. 看板点行 → 跳 `#/` + 监控页有该 code
2. 看板点行 → 行内 K 线展开（不跳转）— 验证 inline K 线模式

**关键**：根据 `limitUpView.js:88-94`，点行调 `cb.openKline(code)` 而不是 addToWatchList。但根据 handoff 文档（§4.1）"行点击 → addToWatchList + navigate(#/)"。

需要确认当前行为。看 `app.js` 的 limit-up row click handler 决定行为。

**实际行为**（从代码推断）：
- limitUpView.js:88-94: `ctx.cb.openKline(item.code)` - 调 openKline
- openKline 在 app.js: 处理行内 K 线展开，不跳 #/

**用 e2e 验证**：
- case 1: 点行 → 行下方出现 `.lu-chart-row` (不跳 #/)
- case 2: 点 checkbox + "添加选中" → 跳 #/ + 监控页有 code

---

## 任务 6: K 线展开 e2e（`e2e/chart.spec.js`）

**3 个用例**：
1. 监控页点行 → 行下方展开 K 线
2. 监控页点 2 行 → 2 个 K 线图同时存在（不互斥）
3. 涨停看板点行 → 行内 K 线展开（带周期 tab）

**关键 selector**：
- 监控页图表容器：`#chart-host-{code}` 或 `[id^="chart-host-"]`
- 涨停看板图表容器：`#lu-chart-host`（在 `.lu-chart-row` 内）
- 周期 tab：`.period-tab` 或 `.lu-period-tab`
- canvas：`canvas` 元素存在（验证 TradingView 渲染成功）

---

## 任务 7: 持久化 e2e（`e2e/persistence.spec.js`）

**2 个用例**：
1. 监控页：添加 2 个 code + 改主题为 dark + 改刷新为 60s → reload → 全部保留
2. 看板页：改排序为"涨幅" + 改刷新为 10s → reload → 全部保留

**关键断言**：
```js
const watchList = await page.evaluate(() => JSON.parse(localStorage.getItem('watch_list')));
expect(watchList).toContain('sh600519');
const theme = await page.evaluate(() => localStorage.getItem('theme'));
expect(theme).toBe('dark');
```

---

## 任务 8: 同步 AGENTS.md + SPEC.md

**AGENTS.md** 2 处变更：
1. 目录结构：补 4 个 src/js + 4 个 tests + 1 个 docs/plans
2. API 代理：4 个 → 8 个

**SPEC.md** 2 处变更：
1. §3.6 涨停看板：补 4 桶 / 排序 / 实时价合并 / 空响应
2. §5.3 涨停对象：补 limitUpCount / firstLimitTime / breakCount / isST

**重要约束**：
- **不删除** 既有内容（用户强调真理源）
- 仅**追加** / **补全**

---

## 任务 9: 更新 phase4 design 风险章节

**当前 §7 风险与注意**（1-6 编号）：
1. 东财 clist/get 在非交易时段返回空 diff → 看板正常显示空
2. pz=200 上限
3. 页面切换要 destroy 看板 timer + 监控 chart
4. vite 代理键顺序敏感
5. 行点击加入监控的去重
6. mock fetch in tests

**需要补的**：
- 风险 7：**"数据源静默导致空看板"** → §3.5 的空响应锁定显示是解决方案
- 风险 8：**GBK 编码**（curl 验证 + TextDecoder）
- 风险 9：**字段映射 f2/f12/f14**（f2=price, f12=code, f14=name(GBK)）
- 风险 10：**5xx 间歇**（fetchLimitUpList 1 次重试）

---

## 任务 10: 用户文档 + CI + STATUS

### 10.1 `docs/phase4-limit-up-board.md`

**结构**（参见 design §4.3）：
1. 功能概览
2. 访问方式
3. 看板布局
4. 排序选项
5. 批量加入监控
6. 行内 K 线
7. 非交易时段行为
8. 常见问题

### 10.2 跑 `npm run ci`

```bash
npm run lint      # 应 0/0
npm test          # 应 457 pass
npm run e2e       # 应 20 pass（新增）
npm run build     # 应成功
```

**失败时排查**：
- e2e 超时 → 检查 dev server 启动
- mock 路径不匹配 → 检查 `**/api/*` 正则
- localStorage 污染 → 检查 beforeEach

### 10.3 更新 STATUS.md

新增 "Phase 5 完成情况" 章节，附：
- 任务完成情况
- 验证证据（test/lint/build/e2e）
- 调试过程沉淀
- 下一步

---

## 验证标准

- ✅ `npm run lint` 0/0
- ✅ `npm test` 457+ pass（0 退化）
- ✅ `npm run e2e` 20 pass（新增）
- ✅ `npm run build` 成功
- ✅ 4 个文档文件同步（AGENTS/SPEC/design/user-guide）一致

---

## 提交策略

不在 git 仓库内（用户已知），不自动 commit。
用户验证后再由用户决定是否备份。

---

**Plan 完成。开始执行。**
