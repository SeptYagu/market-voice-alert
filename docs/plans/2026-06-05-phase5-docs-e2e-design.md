# Phase 5: 测试 + 文档同步 — 设计文档

> 日期: 2026-06-05
> 状态: ✅ 设计已确认，待实施
> 范围: e2e 测试 + 文档同步 + 风险章节更新

## 1. 目标

补全 Phase 4 (涨停看板) 的关键路径 e2e 覆盖 + 同步所有交付物文档，让 Phase 5 完成后整个项目达到"可移交"状态。

## 2. 范围（包含/不包含）

### 2.1 包含
- **e2e 关键路径**（Playwright + Chromium）
  - 路由切换（`#/` ↔ `#/limit-up`）
  - 涨停看板渲染（分组 / 排序 / 复选框 / 立即刷新 / 频率切换）
  - 行点击 → 加入监控 + 自动跳 `#/`
  - 监控页基本功能（添加标的 / 删除 / 主题切换）
  - 多 K 线图展开（监控页与涨停看板各 1 个）
  - localStorage 持久化（刷新后保留配置）
- **文档同步**
  - `docs/plans/2026-06-05-phase4-limit-up-board-design.md` 风险章节：补"空响应锁定显示"（§3.5 已存在但 §7 风险章节未更新）
  - `AGENTS.md` 目录结构：补 4 个新建文件（router/limitUp/limitUpApi/limitUpView）+ 4 个测试文件
  - `AGENTS.md` API 代理：从 4 个补到 6 个
  - `SPEC.md` §3.6 涨停看板：补 4 分组 + 炸板 + 排序
  - `SPEC.md` §5.3 涨停股票对象：补 limitUpCount / firstLimitTime / breakCount / isST
- **用户文档** `docs/phase4-limit-up-board.md`（NEW）：使用指南 + 功能说明 + 浏览器实测截图位
- **CI 验证** `npm run ci`（lint + test + e2e + build）全绿

### 2.2 不包含
- ❌ `renderTable` diff render 优化（推迟 Phase 6）
- ❌ 真实网络 e2e（统一用 `page.route()` mock）
- ❌ 移动端专项 e2e（viewport 调整 + 基础响应式 + 触摸按钮 ≥ 44px 由单元测试 + 浏览器手测覆盖）

## 3. e2e 测试设计

### 3.1 网络 mock 策略

```js
// 启动时拦截所有 /api/* 请求
await page.route('**/api/tencent*', route => route.fulfill({
  status: 200,
  contentType: 'application/javascript',
  body: 'var v_sh600519="1~贵州茅台~600519~1850.00~...~...";'
}));
await page.route('**/api/eastmoney*', route => route.fulfill({ ... }));
await page.route('**/api/limit-up*', route => route.fulfill({ ... }));
await page.route('**/api/eastmoney-kline*', route => route.fulfill({ ... }));
```

**Fixture 设计**：
- `tests/fixtures/tencent-quotes.js` — 3 只股票（sh600519 / sz000858 / sh688981）的实时行情
- `tests/fixtures/eastmoney-kline.js` — sh600519 的日 K 线（30 根）+ 5xx 错误 fixture
- `tests/fixtures/limit-up.js` — 涨停池（10 只，覆盖 3+板 / 2板 / 1板 / 炸板 四组，含 ST）

### 3.2 e2e 用例清单

| # | 文件 | 描述 | 用例数 |
|---|------|------|--------|
| 1 | `e2e/navigation.spec.js` | 路由切换 / nav 高亮 / 未知路径回退 | 3 |
| 2 | `e2e/monitor.spec.js` | 添加 / 删除 / 主题切换 / 刷新频率切换 | 4 |
| 3 | `e2e/limit-up.spec.js` | 看板渲染 / 排序 / 复选框 / 立即刷新 / 频率切换 / 状态栏 | 6 |
| 4 | `e2e/limit-up-row-click.spec.js` | 行点击 → 加入监控 + 自动跳 #/ | 2 |
| 5 | `e2e/chart.spec.js` | 监控页 K 线展开 + 涨停看板行内 K 线 + 多 K 线图 | 3 |
| 6 | `e2e/persistence.spec.js` | 主题/语音/订阅/涨停刷新频率持久化 | 2 |
| | | **合计** | **20** |

### 3.3 关键断言模式

```js
// 1. 路由切换
await page.goto('http://127.0.0.1:5173/');
await expect(page).toHaveURL(/#\/$/);
await page.click('a[data-route="#/limit-up"]');
await expect(page).toHaveURL(/#\/limit-up$/);
await expect(page.locator('.lu-group')).toHaveCount(4); // 3+ / 2 / 1 / broken
await page.click('a[data-route="#/"]');
await expect(page.locator('#refresh-select')).toBeVisible();

// 2. 行点击 → 加入监控 + 自动跳 #/
await page.click('.lu-row[data-code="sh600519"]');
await expect(page).toHaveURL(/#\/$/);
// 监控页应包含 sh600519
await expect(page.locator('[data-code="sh600519"]')).toBeVisible();

// 3. 主题切换持久化
await page.click('#theme-toggle');
await page.reload();
const theme = await page.evaluate(() => document.documentElement.dataset.theme);
expect(['light', 'dark', 'warm']).toContain(theme);
```

### 3.4 关键关注点

- **`limitUpRootEl = null` race fix 验证**：
  - 切到 `#/limit-up` → 切回 `#/`，确认监控页正常渲染
  - 期间若有 in-flight fetch，不能污染 monitor 容器
- **多 K 线图验证**：监控页同时展开 2 只股票，两图各自独立
- **localStorage 隔离**：每个 e2e 用例 `beforeEach` 清 localStorage，避免用例间污染

## 4. 文档设计

### 4.1 AGENTS.md 同步点

```diff
- src/js/
-   ├── api.js
+ src/js/
+   ├── api.js
+   ├── router.js          # NEW: Hash 路由
+   ├── limitUp.js         # NEW: 涨停看板纯函数
+   ├── limitUpApi.js      # NEW: 涨停池 API
+   ├── limitUpView.js     # NEW: 涨停看板视图
+   └── tts.js / alert.js / worker.js
```

```diff
- - `/api/tencent` → 实时行情
- - `/api/eastmoney` → 实时行情（备）
- - `/api/eastmoney-kline` → K 线
- - `/api/sina` → 新浪行情
+ - `/api/tencent` → `https://qt.gtimg.cn` 实时行情（主）
+ - `/api/eastmoney` → `https://push2.eastmoney.com/api` 实时行情（备）
+ - `/api/eastmoney-kline` → `https://push2his.eastmoney.com/api` K 线（主）
+ - `/api/limit-up` → `https://push2.eastmoney.com/api` 涨停池
+ - `/api/limit-up-stock` → `https://push2.eastmoney.com/api` 个股涨停 metadata
+ - `/api/sina` → `https://hq.sinajs.cn` 新浪期货
+ - `/api/qq-kline-min` → `https://ifzq.gtimg.cn` 腾讯分钟 K 备
+ - `/api/qq-kline` → `https://web.ifzq.gtimg.cn` 腾讯 K 线备
```

### 4.2 SPEC.md 同步点

**§3.6 涨停看板**：
```diff
- | 分类方式 | 按连续涨停数分类 (1板、2板、3板...) |
- | 排序规则 | 连板数多的排在前面 |
- | 刷新频率 | 10s / 30s / 60s (可调) |
- | 页面类型 | 独立路由页面 |
+ | 分类方式 | 3+ 连板 / 2 连板 / 1 连板或首板 / 炸板（4 桶） |
+ | 排序规则 | 连板数 / 涨跌幅 / 封板时间 / 成交金额（4 选项） |
+ | 实时价合并 | 监控 timer 后台拉取 → 行内价格跟随 |
+ | 空响应处理 | 锁定最近一次非空快照，状态栏提示 |
+ | 复选框 | 多选 → 批量加入监控 |
+ | 行内 K 线 | 点行 → K 线在所点行下方内嵌展开 |
+ | 页面类型 | Hash 路由 (#/limit-up) 独立页面 |
+ | 刷新频率 | 10s / 30s / 60s (可调，默认 30s) |
```

**§5.3 涨停股票对象**：
```diff
  {
    code: "sh600519",
    name: "贵州茅台",
    price: 1850.00,
    changePercent: 10.00,
-   limitUpCount: 3,
+   limitUpCount: 3,         // 连板数（0=首板）
+   firstLimitTime: "09:35", // 首次封板时间 'HH:mm'（未封板=null）
+   breakCount: 0,           // 炸板次数
+   isST: false,             // 名字含 ST / *ST
    time: "09:25:00",
    type: "stock"
  }
```

### 4.3 用户文档 `docs/phase4-limit-up-board.md`

**结构**：
1. **功能概览**（1 段，1 张看板截图位）
2. **访问方式**（点击 nav "涨停看板"）
3. **看板布局**（4 个分组卡片 + 状态栏）
4. **排序选项**（连板数 / 涨幅 / 封板时间 / 成交金额）
5. **批量加入监控**（复选框 → 添加选中）
6. **行内 K 线**（点行展开）
7. **非交易时段行为**（缓存自 HH:MM 提示）
8. **常见问题**（Q&A）

## 5. 测试矩阵（最终）

| 层级 | 工具 | 覆盖 | 数量 |
|------|------|------|------|
| 单元 | QUnit + jsdom | 纯函数 / API 解析 / 视图渲染 / 路由状态 | 457 |
| 集成 | Playwright | 路由 / 看板 / 监控 / K 线 / 持久化 | 20 (新增) |
| 端到端 | 浏览器手测 | 视觉 / 主题切换 / 触摸 / 响应式 | (用户验证) |
| CI | `npm run ci` | lint + test + e2e + build | 全绿 |

## 6. 实施顺序

1. **e2e fixture** + `tests/fixtures/*.js`（4 个 fixture 文件）
2. **e2e 路由测试** `e2e/navigation.spec.js`（3 cases）
3. **e2e 监控测试** `e2e/monitor.spec.js`（4 cases）
4. **e2e 看板测试** `e2e/limit-up.spec.js`（6 cases）
5. **e2e 行点击测试** `e2e/limit-up-row-click.spec.js`（2 cases）
6. **e2e K 线测试** `e2e/chart.spec.js`（3 cases）
7. **e2e 持久化测试** `e2e/persistence.spec.js`（2 cases）
8. **更新 phase4 design 风险章节** + 同步 AGENTS.md + 同步 SPEC.md
9. **编写用户文档** `docs/phase4-limit-up-board.md`
10. **跑 `npm run ci`** 全绿 + **更新 STATUS.md**

## 7. 风险与注意

1. **e2e 启动慢**：Playwright 启动 Chromium + vite dev server 约 5-10s。考虑用 `webServer.reuseExistingServer: !process.env.CI` 复用本地 dev server（已配置）
2. **localStorage 污染**：每个 test `beforeEach` 清空 + 独立 context
3. **mock fixture 必须覆盖所有 view 状态**：空响应 / 5xx 错误 / GBK 中文 / ST 名字 / 多分组
4. **vite 代理路径要 mock 准确**：`/api/limit-up` 不是 `/api/limit-up-stock`，正则必须 `**/api/limit-up*` 覆盖
5. **K 线图渲染需要 canvas**：jsdom 不支持 canvas，但 Playwright Chromium 真浏览器支持 → e2e 才能验证
6. **AGENTS.md / SPEC.md 是真理源**：只追加 / 补全，不删除既有内容（已确认）
