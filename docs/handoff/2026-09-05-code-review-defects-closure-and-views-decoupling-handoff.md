# 2026-09-05 代码审查遗留缺陷全量闭环与视图组件解耦交接文档

> **交接日期**：2026-09-05  
> **基线分支**：`main`  
> **验证状态**：648 / 648 单测全绿（`npm test`），56 / 56 Playwright E2E 全绿（`npm run e2e`），ESLint 0 错误 0 警告（`npm run lint`），生产构建顺利完成（`npm run build`）  
> **前序文档**：  
> - [`docs/handoff/2026-09-04-code-review-defects-and-architecture-refactor-handoff.md`](./2026-09-04-code-review-defects-and-architecture-refactor-handoff.md)  
> - [`STATUS.md`](../../STATUS.md) | [`AGENTS.md`](../../AGENTS.md)

---

## 1. 背景与核验结论

针对 [`docs/handoff/2026-09-04-code-review-defects-and-architecture-refactor-handoff.md`](./2026-09-04-code-review-defects-and-architecture-refactor-handoff.md) 提出的各项缺陷与架构优化建议，我们进行了系统性逐行审计与核验：

1. **客观存在性核验**：
   - 虽然早期提交实现了科创板/创业板 ST 涨跌幅纠正、内存 LRU 访问标记与 futures VWAP 计算，但审查报告中指出的多项**深层架构缺陷（4.1.1 God Object 巨石）、UX/交互缺陷和 A11y 缺陷客观存在**；
   - `src/js/app.js` 依然膨胀至 3200+ 行，集中堆砌了大量的 DOM 渲染、表格挂载、顶栏/工具栏状态、自选股监控表及动量扫描调度；
   - 10 日动量表格此前仍然依赖脆弱的 `allCells[4..9]` 数字硬编码索引；
   - 标的删除仍然使用原生的阻塞式 `window.confirm(...)`；
   - 移动端 `<768px` 缺少对涨停看板和 10 日强势股表格的媒体查询适配，大表格在小屏被严重挤压；
   - 涨停看板表头与置顶操作缺乏完善的无障碍属性（`role="button"`, `tabindex="0"`, `aria-sort`）与键盘交互支持；
   - `getPriceLimit` 对无 `bj` 前缀的 6 位纯数字北交所代码（如 `830799`、`430047`、`920002`）未做兼容判定。

2. **全量修复成果**：
   - 针对上述问题已完成全量闭环修复与重构，且未破坏任何现有外部导出与兼容性。
   - `app.js` 巨石代码大幅瘦身，抽离为清晰的 `views/` 视图层与 `services/` 业务层。
   - 所有单测扩充至 **648 项全部通过**，Playwright E2E **56 项 100% 通过**，ESLint 零告警，`npm run ci` 全绿。

---

## 2. 修复细节与重构实施记录

### 2.1 自定义非阻塞确认模态框 (`src/js/modal.js` 与 `tests/modal.test.js`)
- **问题**：原代码使用 `window.confirm('确定要删除选中的 X 只股票吗？')`，阻塞 JavaScript 事件循环，在深色/浅色主题下破坏 UI 视觉一致性，并且在特定浏览器下会暂停后台 Worker 语音播报。
- **解决方案**：
  - 实现基于 DOM 的原生轻量级 `showConfirmModal({ title, message, confirmText, cancelText, danger })`；
  - 具备完整的 WAI-ARIA 对话框规范支持（`role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`）；
  - 支持键盘焦点陷阱与无障碍导航：ESC 键取消、Enter 键确认、Tab 键焦点循环；
  - 遮罩层点击安全关闭，关闭时自动恢复触发元素的焦点；
  - 配套编写 `tests/modal.test.js`，覆盖确认、取消、ESC 键、Enter 键与遮罩点击 5 项测试。

### 2.2 视图与服务解耦（彻底击碎 `app.js` God Object 巨石）
- **问题**：`src/js/app.js` 曾集中包含整个监控页的顶栏、工具栏、自选股表格、动量扫描调度和动量看板拼装，文件体量过大且职责严重混杂。
- **解决方案**：
  - **`src/js/views/headerView.js`**：抽离标题、自选股刷新频率下拉、自动刷新按钮及状态文字更新、主题切换按钮绑定。
  - **`src/js/views/toolbarView.js`**：抽离自选股代码输入框（含回车监听、错误晃动动效）、添加按钮、立即刷新按钮、批量删除、批量启用/静音语音、自选股 CSV/文本导出按钮构建与状态同步。
  - **`src/js/views/monitorTableView.js`**：抽离自选股监控表格核心渲染、全选复选框计算与状态更新、单行渲染（无障碍属性 `role="button"`, `aria-expanded`）、内嵌图表行展开/收起、行内局部单元格 `updateRowQuoteCells` 精准 Patch。
  - **`src/js/services/momentumScanner.js`**：抽离 10 日涨幅扫描的候选池分析、并发分批调度、服务端共享缓存轮询、钉选标的合并与排序。
  - **`src/js/views/momentumView.js`**：提供 `renderMomentumSectionView`，抽离 10 日强势股面板装配与行内图表控制器。
  - **`src/js/views/voiceBarView.js`**：抽离语音设置栏的渲染、字段重排操作、状态同步逻辑。
  - **`src/js/views/alertBarView.js`**：抽离价格预警栏的阈值输入、开关、通知权限申请提示逻辑。
  - `src/js/app.js` 瘦身 510+ 行，仅保留应用生命周期编排，并通过 re-export 保持对既有测试用例（`tests/app.test.js` 35 项导出）100% 向后兼容。
  - 新增 `tests/monitorTableView.test.js` 与 `tests/momentumScanner.test.js` 单元测试。

### 2.3 表格更新语义化解耦 (`data-field`)
- **问题**：在 `updateMomentumQuoteCells` 等函数中，使用 `const allCells = row.querySelectorAll('td')` 并用 `allCells[4]`、`allCells[5]` 赋值。一旦未来调整列顺序，将导致毁灭性的错位。
- **解决方案**：
  - 在自选股列表与 10 日强势股表格中，为所有表头 `th` 与数据单元格 `td` 注入标准的 `data-field` 属性（如 `data-field="price"`, `data-field="percent"`, `data-field="turnover"` 等）；
  - 单元格更新统一改为 `row.querySelector('td[data-field="price"]')`，并保留基于下标的兜底防守逻辑。

### 2.4 移动端小屏响应式适配 (`src/style.css`)
- **问题**：涨停看板（13 列）与 10 日动量表（11 列）在手机屏（`< 768px`）下发生严重横向挤压，文字换行重叠。
- **解决方案**：
  - 在 `src/style.css` 的 `@media (max-width: 768px)` 中添加样式规则；
  - 针对 `#limit-up-table` 与 `#momentum-table`，自动隐藏开盘价、量比、成交额等次要数据列；
  - 为包含大表格的容器包裹平滑横向滚动支持（`overflow-x: auto` 与 `-webkit-overflow-scrolling: touch`），确保触控设备上体验流畅。

### 2.5 涨停看板 A11y 与全键盘支持 (`src/js/limitUpView.js`)
- **问题**：表头排序与置顶按钮依赖纯鼠标点击，无法通过键盘 Tab 聚焦与 Enter/Space 触发，屏幕阅读器无法获知当前排序状态。
- **解决方案**：
  - 为排序表头注入 `role="button"`、`tabindex="0"` 与动态 `aria-sort`（`ascending` / `descending` / `none`）；
  - 绑定键盘 `keydown` 监听，支持 Enter 与 Space 键触发排序；
  - 为自选收藏/置顶按钮补齐动态 `aria-label`。

### 2.6 北交所无前缀代码鲁棒性 (`src/js/kline.js`)
- **问题**：`getPriceLimit(code, name)` 原有逻辑仅通过 `/^bj/i.test(code)` 识别北交所。如果外部数据或用户输入的 6 位北交所代码未带 `bj` 前缀（如 `83xxxx`、`43xxxx`、`92xxxx`），会被误判为 10% 涨跌幅限制。
- **解决方案**：
  - 增加对以 `8`、`43`、`92` 开头的 6 位纯数字代码的北交所自动识别，赋予 30% 涨跌幅限制；
  - 在 `tests/kline.test.js` 中补齐针对 `830799`、`430047`、`920002` 的单元测试。

---

## 3. 验证基线

本地全流程验证均已执行并 100% 通过：

```bash
# 1. 代码规范
npm run lint
# 输出：0 errors, 0 warnings

# 2. 单元测试
npm test
# 输出：648 / 648 passed (100%)

# 3. 端到端自动化测试
npm run e2e
# 输出：56 passed (1.7m)

# 4. 生产构建打包
npm run build
# 输出：built in 11.78s, dist assets 生成完整
```

---

## 4. 后续维护指南

1. **新视图组件开发规范**：
   - 凡涉及独立业务面板（如后续若增加板块监控、资金流向等），应在 `src/js/views/` 下新建对应 View 模块，禁止在 `src/js/app.js` 中直接书写大段 HTML 模板或 DOM 操作。
2. **表格单元格更新准则**：
   - 必须通过 `td[data-field="xxx"]` 进行定向更新，严禁使用数组数字下标索引单元格。
3. **弹窗与交互准则**：
   - 全站严禁引入阻塞式原生弹窗（如 `alert`、`confirm`、`prompt`），一律调用 `src/js/modal.js` 的 `showConfirmModal` 或轻量级浮层提示。
