# 图表日期中国习惯格式化与成交量颜色修复交接文档 (Handoff)

## 1. 概述与背景

用户反馈在日 K 线图表中发现两个视觉与交互问题（以新农开发 600359 见顶日 2026-09-11 截图为例）：
1. **时间轴坐标提示年月日反了**：原十字线在时间轴悬停时显示为西式日-月-年格式（例如 `11 9月 '26 00:00`），未遵循中国市场的年-月-日习惯，且日 K 线携带多余无意义的 `00:00`。
2. **成交量柱颜色错误**：在 9.11 见顶日，该标的高开低走但全天收涨（昨收 9.64，开盘 10.38，收盘 9.72，涨幅 +0.83%），但成交量显示为绿色（绿柱）；同类的一字涨停（开盘价等于收盘价且收涨）在原代码中也被判定为绿柱。

---

## 2. 根因剖析与修改方案

### 2.1 问题一：图表时间轴日期格式西式反转与日K分钟泄漏
- **根因**：
  1. `lightweight-charts` 原生默认 `dateFormat` 为 `'dd MMM \'yy'`，在中文语言环境下渲染为 `11 9月 '26`（日-月-年）。
  2. `src/js/chart.js` 中 `_timeScaleOptions` 将 `timeVisible` 无条件写死为 `true`，导致日 K 线也强行渲染了 `00:00`。
  3. 未在图表初始化及周期切换时通过 `localization` 注册中国本土化日期格式化器。
- **修复**：
  1. `_timeScaleOptions(c, period)` 中将 `timeVisible` 绑定为 `isMinute`（仅 `1m`/`5m`/`15m`/`30m`/`60m` 为 true，日周月 K 线为 false）。
  2. `buildChartOptions` 增加 `localization: { locale: 'zh-CN', dateFormat: 'yyyy-MM-dd', timeFormatter: (time) => formatChartTime(time, period) }`。
  3. `time.js` 中的 `formatChartTime` 扩展对轻量图表 BusinessDay 对象 `{ year, month, day }` 与时间戳的完备支持，保证日 K 线返回中国规范 `YYYY-MM-DD`，分钟线返回 `YYYY-MM-DD HH:mm`。
  4. `chart.js` 中 `_detailTime` 联动传入当前周期，十字线顶部浮层与底部时间轴彻底对齐年-月-日。

### 2.2 问题二：成交量柱红绿判定未考虑昨收与假阴真阳
- **根因**：
  1. `src/js/kline.js` 中的 `formatVolumeBars` 原实现为简单三元表达式 `it.close > it.open ? up : down`。
  2. 当发生“高开低走但收盘高于昨收”（假阴真阳，如 9.11 见顶日开盘 10.38、收盘 9.72、昨收 9.64、涨幅 +0.83%）或“一字涨停”（开盘 9.64、收盘 9.64、昨收 8.76、涨幅 +10.05%）时，`close > open` 均判定为 false，错误染成绿色。
  3. `chartRowController.js:130` 在实时 Tick 刷新时向 `formatVolumeBars([last])` 仅传入单元素数组，丢失了前收盘价 `prevClose` 上下文。
- **修复**：
  1. 在 `kline.js` 中新增并导出纯函数 `isVolumeBarUp(it, prevClose)`：
     - 收盘高于开盘（阳线）→ 红色；
     - 收盘高于昨收（高开低走假阴线收涨、一字涨停）→ 红色；
     - 其余情况（收跌、平盘、假阳实跌以外的收阴等）→ 绿色。
  2. `formatVolumeBars(items, opts = {})` 自动从 `i > 0 ? items[i - 1].close : opts.prevClose` 获取基准昨收。
  3. `chartRowController.js` 的 `applyLiveTickToKlineChart` 补全 `prevClose = updated[updated.length - 2].close` 与 `opts.prevClose`，实时行情与历史 K 线行为一致。

---

## 3. 门禁验证与影响范围

1. **单测覆盖**：
   - `tests/kline.test.js` 新增 9.11 见顶日真实样本假阴收涨红柱断言、一字涨停红柱断言、`opts.prevClose` 单项断言、`isVolumeBarUp` 状态机断言（平盘保持绿柱以兼容既有不变量）。
   - `tests/chart.test.js` 新增 `localization` 中文年-月-日格式化器与 `timeVisible: isMinute` 断言。
2. **门禁实跑**：
   - `npm run lint`：0 错误 0 警告
   - `npm test`：**843/843 全部通过**（无跳过、无失败）
   - `npm run build`：生产构建成功（`dist/` 编译通过）
   - `npx playwright test e2e/chart.spec.js`：**12/12 全部通过**

---

## 4. Round 1 审查缺陷闭环（Round 2 修复详情）

依据 WorkBuddy Round 1 独立代码审查报告（`docs/handoff/2026-09-15-workbuddy-code-review-round1-handoff.md`）指出的 3 项 P2 缺陷，在 Round 2 完成严格闭环：

1. **P2-1 闭环（`src/js/kline.js`）**：
   - 根因：`Number(null) === 0`，且 `Number.isFinite(0) === true`。原代码未守卫 `pc > 0`，当 `prevClose === null` 时，判据 `close > pc` 退化为 `close > 0`，导致数据集最左侧首根阴线或平盘恒为红柱。
   - 修复：在 `isVolumeBarUp` 中补齐 `pc > 0` 严格数值守卫：`if (Number.isFinite(pc) && pc > 0 && close > pc) return true`。与 `classifyKlineBar` 的 `pc <= 0` 语义严格保持一致。
2. **P2-2 闭环（`src/js/chart.js`）**：
   - 根因：`renderIntradayDetail(time)` 调用 `_detailTime(time)` 未传递周期，默认取 `'1d'`，分时图的数值 chart-seconds（由 `parseTencentMinuteToChartSeconds` 生成）被 `formatChartTime` 剥离了时分，导致分时图顶部浮层由原本的 `2026-09-11 10:30` 回归为纯日期。
   - 修复：在 `renderIntradayDetail` 中显式指定分时周期：`_detailTime(time, '1m')`，浮层恢复完整的 `YYYY-MM-DD HH:mm`。
3. **P2-3 闭环（`tests/kline.test.js` & `tests/chart.test.js`）**：
   - 测试重构与判别力补齐：
     - 在 `tests/kline.test.js` 中为假阴真阳样本补充真实 9.09 昨收（8.76），将 9.10 一字涨停与 9.11 假阴真阳明确分离，消除 `null -> 0` 的假通过假象。
     - 新增 `prevClose is null/missing does not coerce null to 0` 专项测试，覆盖首根为阴线或平盘且 `prevClose === null` 时必须显绿、只有真正阳线显红的边界断言，具备击杀 P2-1 的真实判别力。
     - 在 `tests/chart.test.js` 中新增 `createIntradayChart detail legend renders HH:mm time alongside price and volume` 单元测试，直接断言分时图浮层 DOM 包含 `YYYY-MM-DD HH:mm`（如 `2026-09-11 10:30`），具备击杀 P2-2 的真实判别力。
