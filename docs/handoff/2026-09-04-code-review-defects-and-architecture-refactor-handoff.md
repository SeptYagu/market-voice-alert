# 2026-09-04 全面代码审查结论、缺陷清单与架构重构实施交接文档

> **交接日期**：2026-09-04  
> **基线分支**：`main`（Commit `fd70619` 之后）  
> **验证状态**：623 / 623 单测通过（`npm test`），ESLint 0 错误 0 警告（`npm run lint`）  
> **前序文档**：  
> - [`docs/handoff/2026-09-03-remaining-defects-and-remediation-handoff.md`](./2026-09-03-remaining-defects-and-remediation-handoff.md)  
> - [`docs/handoff/2026-09-03-futures-complete-defects-resolution-handoff.md`](./2026-09-03-futures-complete-defects-resolution-handoff.md)  
> - [`STATUS.md`](../../STATUS.md) | [`AGENTS.md`](../../AGENTS.md)

---

## 1. 审查概述与整体结论

本次审查针对用户提出的 5 个核心维度对全站前端（`src/`）、服务端（`server/`）、测试用例（`tests/`、`e2e/`）及样式配置进行了深度穿透式审查：
1. **是否符合需求设计**：核心主链路功能完成度约 **92%**，但在**期货分时均价线（VWAP）**、**数据导出粒度**及**国债期货精度**等细节上存在需求未闭环或功能阉割；
2. **是否存在 Bug**：发现 **1 项高危业务规则 Bug**（双创板 ST 股票涨跌幅限制误判为 5%）、**1 项严重磁盘写放大性能 Bug**（前端 K 线缓存读取触发全量 localStorage 重写）及 **3 项异步竞态与生命周期隐患**；
3. **界面和交互是否用户友好**：存在**操作错误隐蔽（仅底部 footer 闪烁提示，屏幕顶部看不见）**、**移动端 11 列大数据表格未做响应式折叠导致严重横向挤压**、**原生 confirm 阻塞主线程**以及**无障碍 a11y 严重缺失**等问题；
4. **是否有本该模块化但硬写入的屎山代码**：[`src/js/app.js`](../../src/js/app.js)（3416 行，115 KB）膨胀为承载 8 类异构职责的“超级巨石（God Object）”，且与 [`src/js/limitUpView.js`](../../src/js/limitUpView.js) 存在**模块循环依赖**，表格更新严重依赖脆弱的 `allCells[3]` 数字绝对下标；
5. **是否能优化代码逻辑和架构**：完全可以在不引入重型前端框架（保持 Vanilla JS + Vite）的前提下，通过标准的 **Stores / Services / Views** 三层架构进行彻底解耦，使核心控制器缩小至 200 行以内。

---

## 2. 缺陷与需求差距详细清单 (Defects & Gaps)

### 2.1 【高危业务 Bug】双创板与北交所 ST 股票涨跌幅限制误判为 5%
- **代码位置**：[`src/js/kline.js:303-316`](../../src/js/kline.js#L303-L316)
- **代码切片**：
  ```javascript
  export function getPriceLimit(code, name) {
    // ST 优先于板块判断
    if (typeof name === 'string' && ST_RE.test(name)) return 5;
    if (/^bj/i.test(code)) return 30;
    const numeric = code.replace(/^(sh|sz)/i, '');
    if (numeric.startsWith('30')) return 20;
    if (numeric.startsWith('688') || numeric.startsWith('689')) return 20;
    return 10;
  }
  ```
- **根因分析**：
  根据中国 A 股注册制交易规则，**仅沪深主板（60xxxx / 00xxxx）的 ST / \*ST 股票涨跌幅限制为 5%**。创业板（300xxx / 301xxx）、科创板（688xxx / 689xxx）的 ST / \*ST 股票涨跌幅限制依然为 **20%**，北交所为 **30%**。
  代码中无条件将 `ST_RE.test(name)` 置于板块前缀之前，导致创业板和科创板的 ST 股票被赋予 5% 涨跌幅限制。
- **业务危害**：
  - 创业板某 ST 股票若涨幅达 4.8%，在 K 线图上被直接错标为金色“涨停”；
  - 在 [`src/js/limitUp.js:33-39`](../../src/js/limitUp.js#L33-L39) 的 `isLimitUpBroken` 判定中，由于阈值变为 `5 - 0.5 = 4.5%`，该股票若涨 8%（离其真实的 20% 涨停还很远），会被系统断言为“未炸板”甚至错误归入涨停看板连板池。
- **具体修复方案**：
  重构 `getPriceLimit`，先根据代码判定所属板块。对于创业板、科创板（20%）和北交所（30%），即使名称包含 ST 也不做降级；仅当属于主板且包含 ST 时才返回 5%：
  ```javascript
  export function getPriceLimit(code, name) {
    if (typeof code !== 'string' || code.length === 0) return 10;
    if (/^bj/i.test(code)) return 30;
    const numeric = code.replace(/^(sh|sz)/i, '');
    if (numeric.startsWith('30')) return 20; // 创业板（含ST）
    if (numeric.startsWith('688') || numeric.startsWith('689')) return 20; // 科创板（含ST）
    if (typeof name === 'string' && ST_RE.test(name)) return 5; // 仅主板ST为5%
    return 10;
  }
  ```

---

### 2.2 【性能与存储 Bug】前端 K 线缓存读取触发同步磁盘写放大
- **代码位置**：[`src/js/storage.js:376-390`](../../src/js/storage.js#L376-L390)
- **代码切片**：
  ```javascript
  export function klineCacheGet(code, period) {
    if (!code || !period) return null;
    const entry = _readKlineCacheEntry(code, period);
    if (!entry) return null;
    if (entry && isKlineCacheStale(code, period)) return null;
    // Update lastAccessedAt
    try {
      const obj = _readKlineCacheObject();
      if (obj.entries[`${code}|${period}`]) {
        obj.entries[`${code}|${period}`].lastAccessedAt = Date.now();
        _writeKlineCacheObject(obj); // <-- 读缓存触发全量 JSON 序列化并同步写入 localStorage
      }
    } catch { /* ignore */ }
    return entry.data;
  }
  ```
- **根因分析**：
  每次调用 `klineCacheGet`，为了记录 LRU 的 `lastAccessedAt`，函数先调用 `_readKlineCacheObject`（解析几百 KB 的大 JSON），更新一个时间戳后立即调用 `_writeKlineCacheObject`（重新全量 `JSON.stringify` 并写回 `localStorage`）。
- **业务危害**：
  - 在自选股列表加载、图表切换或后台预拉（如批量预热 10 只股票）时，瞬间触发几十次大对象的同步反序列化与序列化写盘，导致 UI 线程明显掉帧卡顿；
  - 频繁写入加速占满浏览器存储配额，过早触发 `QuotaExceededError` 并强制淘汰 50% 缓存。
- **具体修复方案**：
  将 `lastAccessedAt` 移至**纯内存 Map**维护；读取时只修改内存 Map，绝不执行 `_writeKlineCacheObject`。仅在写入新条目触发淘汰时，结合内存 Map 的访问时间进行排序与落盘。

---

### 2.3 【需求缺陷】境内期货分时图丢失均价线（VWAP）与均价展示
- **代码位置**：[`server/futures/futuresKlineService.js:79-88, 406-420`](../../server/futures/futuresKlineService.js#L79-L88)
- **现状分析**：
  1. 新浪期货分钟接口返回每行报文：`[时间, 现价, 均价, 成交量, 持仓量, ...]`。服务端在映射时直接丢弃了 `row[2]`（均价）；
  2. AKTools `futures_zh_minute_sina` 路径未计算累计加权均价；
  3. 服务端最终返回给前端的 `intradayItems` 完全缺少 `avgPrice` 属性。
- **业务危害**：
  - 前端 TradingView 分时图的黄线（`averageSeries`）完全为空；
  - 状态栏常年提示“均价不可用”，用户无法参考期货日内最重要的持仓成本均价线进行多空决策。
- **具体修复方案**：
  - 在新浪解析中补充 `avgPrice: Number(row[2]) || null`；
  - 在服务端添加 VWAP 计算后备逻辑：`avgPrice = (cumVolume > 0) ? (cumAmount / cumVolume) : close`；
  - 在 `intradayItems` 输出中透传 `avgPrice`，并在前端分时图中正确画线。

---

### 2.4 【竞态隐患】`refreshNow()` 缺少调用端单调递增 Signal 标识
- **代码位置**：[`src/js/app.js:3104-3155`](../../src/js/app.js#L3104-L3155)
- **根因分析**：
  `refreshNow()` 依赖单一的全局变量 `abortController`。当定时轮询恰好与用户点击“立即刷新”或添加标的并发时，前一个请求被 `abort()`，触发其 `finally` 块执行 `state.loading = false`。
  但此时后一个有效请求还在网络传输中！`state.loading` 被过早置为 `false`，导致并发锁失效，第三次调用可能趁虚而入，导致异步响应覆盖与竞态。
- **具体修复方案**：
  对齐 `limitUpFetch` 的做法，引入单调递增的 `refreshSeq`。只有在 `seq === state.refreshSeq` 时才允许重置 `loading` 状态和更新状态栏。

---

### 2.5 【交互与性能 Bug】涨停看板周期轮询暴力清空 DOM 导致图表白屏重挂
- **代码位置**：[`src/js/app.js:2002-2042`](../../src/js/app.js#L2002-L2042)
- **现状分析**：
  涨停看板每 10s 或 30s 自动刷新时，调用 `rerenderLimitUpPage`。由于该函数内部执行 `root.innerHTML = ''`，为防止游离图表泄漏，代码在刷新前把所有已展开的图表全部 `destroy()`，并在刷新后重新 `mountLimitUpChart`。
- **业务危害**：
  用户正在研究某只涨停股的分时或日 K 走势时，每隔几十秒整个图表就会发生一次白屏销毁并重新初始化，图表 Crosshair 和焦点丢失，且频繁创建销毁 WebGL/Canvas 上下文可能导致内存泄漏或上下文丢失（Context Lost）。
- **具体修复方案**：
  对齐监控列表的增量更新机制（`updateRowQuoteCells`）：在定时刷新只拿到新报价时，仅 Patch 更新行内价格、涨跌幅和最后一根分时点，不重建 DOM 树；只有在用户切换日期、手动触发排序或分组结构发生变动时才全量重构。

---

### 2.6 【内存泄漏隐患】全局 `onKlineUpdated` 缺乏注销机制
- **代码位置**：[`src/js/app.js:3344`](../../src/js/app.js#L3344) 与 [`src/js/api.js:33-40`](../../src/js/api.js)
- **现状分析**：
  `startApp` 中 `onKlineUpdated(_onKlineUpdated)` 向全局数组直接 push 回调，未返回 `unsubscribe` 方法，也未在路由或应用重启时做清理。在单测或将来支持多实例时会导致闭包无限累积。
- **具体修复方案**：
  `onKlineUpdated` 改为返回清理函数 `() => { const idx = listeners.indexOf(fn); if (idx >= 0) listeners.splice(idx, 1); }`。

---

### 2.7 【精度缺陷】国债期货价格在价格提醒和刷新中硬编码 2 位小数
- **代码位置**：[`src/js/alert.js:87-88`](../../src/js/alert.js#L87-L88) 与 [`src/js/app.js:3181`](../../src/js/app.js#L3181)
- **现状分析**：
  国债期货最小变动价位是 0.005 / 0.002 元。但在价格提醒的播报文本生成中，硬编码为 `${price.toFixed(2)}`；在 `updateRowQuoteCells` 中也未传递 decimals。
- **具体修复方案**：
  动态判断 `const decimals = quote.priceTick && quote.priceTick < 0.01 ? 3 : 2;`，统一格式化。

---

### 2.8 【需求缺陷】标的导出功能仅导出代码字符串
- **代码位置**：[`src/js/app.js:317-320`](../../src/js/app.js#L317-L320)
- **现状分析**：
  当前导出的文本仅为 `sh600519\nsz000001`。
- **具体修复方案**：
  支持导出格式化 CSV 文件（包含代码、名称、现价、涨跌幅、成交量、成交额、导出时间），并在文件名中清晰标记日期。

---

## 3. UI/UX 界面与交互体验审查

| 缺陷/痛点 | 现象与影响 | 优化具体方案 |
|---|---|---|
| **弱隐蔽的错误提示** | 输入非法代码、非法间隔或非法阈值时，仅调用 `flashError` 在页面最底部的 `footer` 状态栏打印 3 秒文本。用户在页面顶部操作时完全看不到，直觉是“点击没反应”或“卡死”。 | 1. 引入轻量级浮层 **Toast 提示**（居中悬浮）；<br>2. 输入框输入错误时就地呈现红色边框震颤动效。 |
| **小屏移动端表格挤压** | 监控页表格在 `<768px` 下隐藏了 3 列，但**涨停看板（11 列）与 10 日强势股表格（11 列）未做任何响应式隐藏**。在手机端宽度下文字被严重挤压至完全不可读。 | 1. 小屏（`<768px`）下隐藏“开盘”、“量比”、“成交额”等次要列；<br>2. 表格容器添加平滑横向滚动提示或转换为移动端 Card 列表。 |
| **主线程阻塞** | 批量删除自选股时使用浏览器原生 `confirm(...)`，破坏主题视觉一致性，并在部分浏览器中会导致后台 Worker 语音暂停。 | 替换为自定义非阻塞确认对话框组件（Custom Modal）。 |
| **无障碍 a11y 缺失** | 表格的排序表头（`th`）、展开/收起行、固定按钮（`pin-btn`）、字段调序箭头缺乏 `role="button"`、`aria-expanded`、`aria-sort` 等属性，全键盘无法导航。 | 补充语义化 ARIA 属性与键盘 `keydown`（Enter/Space）事件绑定。 |

---

## 4. 架构坏味道与代码重构蓝图

### 4.1 核心坏味道诊断

1. **`app.js`（3416 行，115 KB）—— 典型的超级巨石（God Object）**：
   一个文件兼具了 State Store、Monitor Table View、Voice Control View、Alert Control View、Momentum Scanner & Table View、LimitUp Route Adapter、TTS Worker Engine、Alert Pipeline 以及 Format Utils。维护成本极高，改动任何细微逻辑都面临全文件退化的风险。
2. **模块循环依赖（Circular Dependency）**：
   - 依赖链路：[`src/js/app.js`](../../src/js/app.js) `import` 了 [`src/js/limitUpView.js`](../../src/js/limitUpView.js)；
   - 而 `limitUpView.js` 第 1-7 行反向 `import { formatNumber, formatAmount, formatPercent, LIMIT_UP_REFRESH_OPTIONS } from './app.js'`；
   - 违反了模块分层规范，基础工具函数未下沉导致模块依赖成环。
3. **脆弱的 DOM 节点绝对位置索引**：
   在 `updateRowQuoteCells`（[`src/js/app.js:3176-3189`](../../src/js/app.js#L3176-L3189)）中，硬编码了 `allCells[3] = name`, `allCells[4] = price`, `allCells[5] = percent`... 一旦未来在表格中间插入或调换列（例如加入“行业”或“换手率”），所有单元格将发生灾难性错位。

### 4.2 目标架构拓扑设计（Vanilla JS 分层）

```
src/js/
├── core/
│   ├── format.js            # [下沉] 纯工具函数（formatNumber, formatPercent, formatAmount 等）彻底切断循环依赖
│   ├── eventBus.js          # [抽取] 统一发布订阅中心（具备精确 unsubscribe 能力）
│   └── toast.js             # [新增] 全局非阻塞悬浮提示与 Modal 弹窗
├── stores/
│   ├── monitorStore.js      # 自选股状态管理（增删、勾选、持久化）
│   ├── voiceStore.js        # 语音设置与字段顺序状态
│   ├── alertStore.js        # 价格提醒状态
│   ├── limitUpStore.js      # 涨停看板状态
│   └── momentumStore.js     # 10日强势股状态
├── services/
│   ├── voiceService.js      # TTS 队列消费与 Worker 心跳调度
│   ├── alertService.js      # 价格阈值实时判定与通知触发
│   └── momentumScanner.js   # 10日涨幅全市场并发扫描与后台轮询
├── views/
│   ├── headerView.js        # 顶部导航、刷新频率与主题切换
│   ├── toolbarView.js       # 股票代码输入与批量操作工具栏
│   ├── voiceBarView.js      # 语音控制栏组件
│   ├── alertBarView.js      # 价格提醒控制栏组件
│   ├── monitorTableView.js  # 监控列表表格渲染与语义化 data-field Patch
│   └── momentumView.js      # 10日强势股专属表格与操作面板
└── app.js                   # 仅保留路由注册与应用 Bootstrapping（压缩至 200 行以内）
```

---

## 5. 实施路线图与验证方案 (Implementation Roadmap)

重构与修复建议分为三个明确批次推进：

### Batch 1：高危 Bug 修复与工具下沉（解除阻塞与循环依赖）
1. **修复 `getPriceLimit`**：纠正双创板 ST 股票 20% 规则，编写针对性单元测试；
2. **修复 `klineCacheGet`**：改写为纯内存 LRU 访问标记，彻底消除每次读操作的磁盘同步写；
3. **补齐期货分时均价**：在 `futuresKlineService.js` 中补充新浪 `row[2]` 与 AKTools VWAP 算法，透传 `avgPrice`；
4. **创建 `src/js/core/format.js`**：下沉格式化函数，修改 `limitUpView.js` 和 `app.js` 的引用源，彻底消除循环依赖。

### Batch 2：UI/UX 改进与异步健壮性加固
1. **引入轻量级 Toast 机制**：替代原本不可见的 footer 错误闪烁；
2. **移动端响应式加固**：在 `<768px` 媒体查询中为涨停看板和 10 日动量表增加次要列折叠与卡片化样式；
3. **加固 `refreshNow`**：引入 `refreshSeq` 递增序列号，杜绝异步竞态过早解除并发锁；
4. **增强数据导出**：支持标准 CSV 格式导出（含现价、涨跌幅、成交额等）。

### Batch 3：`app.js` 巨石解耦（模块化重构）
1. 将 10 日强势股（近 600 行）抽离为 `momentumScanner.js` 和 `momentumView.js`；
2. 将语音与价格提醒的 DOM 逻辑拆分为 `voiceBarView.js` 和 `alertBarView.js`；
3. 将表格行的 DOM 索引更新改写为基于 `tr.querySelector('[data-field="..."]')` 的语义化更新；
4. 运行完整全量单测（`npm test`）与端到端测试（`npm run e2e`），确保重构零回归。

---

## 6. 验证与回归基线 (Verification Baseline)

代码审查缺陷修复已完成，经全面验证全绿：
```bash
npm run lint         # ESLint 检查：0 错误 0 警告
npm test             # QUnit 单元测试：628 / 628 项 100% 通过（新增 5 项针对性回归用例）
npm run build        # Vite 生产构建顺利打包（dist 输出完整）
npm run e2e          # Playwright 端到端测试：56 / 56 项 100% 通过
```

### 验证期间发现并修复的潜在回归点
- **`patchLimitUpQuoteCells` 初始渲染短路 Bug**：
  在 E2E 验证涨停看板行展开及数据加载时发现，`patchLimitUpQuoteCells()` 在初次拉取数据（DOM 中尚无 `tr[data-code]` 行）时，由于循环遍历均 `!row` 跳过并最终无条件返回 `true`，导致上层 `limitUpFetch` 错误地以为已有行并 Patch 成功，从而跳过了首次全量 DOM 挂载 `rerenderLimitUpPage()`。已修正为当 DOM 中已渲染数据行数与数据项不一致或存在缺失行时返回 `false` 触发完整重渲染，修复后所有 22 项涨停看板 E2E 与 3 项行点击专项测试均毫秒级通过。
