# WorkBuddy 独立代码审查 —— 图表日期格式与成交量红绿规则修复（Round 1）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`46a33cab0167903270a14a9c9ba3da2ad983b6f1`；基准：`a3344682efa867d00ecd6a9b5eea1e325b1534c2`；范围：`git diff a334468..46a33ca`（9 文件 / +159 / -20）。工作区干净，`git pull --ff-only` 已确认与远端同步。
- 需求映射：日/周月 K `timeVisible=false` + zh-CN localization、`formatChartTime` BusinessDay/时间戳支持、`isVolumeBarUp` 双判据、`applyLiveTickToKlineChart` prevClose 上下文（`updated.slice(-2)` 传入 `formatCandleColors`）均已落地；`formatVolumeBars` 旧调用方（仅 `chartRowController.js:95/132`）签名向后兼容；`chartTimeToDate` 其余 5 处调用方不受影响。
- 独立验证：node 直跑 `formatChartTime`（9 项边界：null/空串/NaN/残缺 BusinessDay/补零/分钟与日线）均符合预期；但针对「prevClose 缺失」与「分时浮层」的 2 项负向验证**构造出反例**，见缺陷清单。
- 临时验证脚本均以 `node --input-type=module -e` 内联执行，未在仓库遗留任何文件。

## 二、审查发现与缺陷清单

### 缺陷 1（P2）：`isVolumeBarUp` 在 prevClose 缺失时把昨收当 0，数据集首根成交量柱恒为红柱

- **文件与行号**：`src/js/kline.js:169`（`const pc = Number(prevClose)`）与 `src/js/kline.js:176`（`if (Number.isFinite(pc) && close > pc) return true`）；影响入口 `src/js/controllers/chartRowController.js:95` 与 `src/js/kline.js:187-189`。
- **触发条件**：`prevClose` 为 `null`（批量路径首根 `i===0` 且 items 无 `prevClose` 字段、`opts.prevClose` 未传时的兜底值即 `null`；实时路径 `updated.length === 1` 时同样传 `null`）。JS 中 `Number(null) === 0` 且 `Number.isFinite(0) === true`，于是判据 `close > pc` 退化为 `close > 0` —— 任何正价格的 K 线都被判为「收涨」。
- **实际行为**：数据集**首根**成交量柱无论阴线、平盘一律红柱。已用 node 直跑复现：`isVolumeBarUp({open:10, close:9.5}, null)` → `true`（红）；`formatVolumeBars([{open:10,close:9.5,...},{open:9.6,close:9.4,...}])` → `bars[0].color === '#E74C3C'`（红，期望绿）、`bars[1]` 正常绿。
- **期望行为**：验收标准 2 明确「收跌与平盘判定为绿柱」；昨收缺失时无法判定涨跌，应仅按 `close > open` 判定（即回落到阳线判据），阴线/平盘为绿。
- **根因**：缺少与 `classifyKlineBar`（`src/js/kline.js:344`：`if (!Number.isFinite(pc) || pc <= 0) return 'normal'`）一致的 `pc > 0` 守卫；同文件两个函数对「无效昨收」的语义不一致。
- **影响范围**：每次图表加载/切周期，最左侧一根成交量柱颜色错误；单项实时 Tick（首根即最新）同样恒红。这正是本任务要修的「红绿误判」缺陷类别，属于未修干净的残留面。
- **复现方法**：见上方 node 直跑输入输出；或在任意图表加载后观察最左一根阴线日的成交量柱为红。
- **修复建议**：在 `isVolumeBarUp` 中将判据 2 改为 `if (Number.isFinite(pc) && pc > 0 && close > pc) return true`；`formatVolumeBars` 首根兜底逻辑不变。
- **修复后验收标准**：`isVolumeBarUp({open:10, close:9.5}, null) === false`；`isVolumeBarUp({open:10, close:10}, null) === false`；批量首根阴线为绿柱；既有 841 条测试不回归。

### 缺陷 2（P2）：分时图十字线浮层丢失 HH:mm，回退为纯日期（对上一版行为的回归）

- **文件与行号**：`src/js/chart.js:666`（`renderIntradayDetail` 内 `_detailTime(time)`，未传 period，默认 `'1d'`）。
- **触发条件**：分时图（`createIntradayChart`）上移动十字线，浮层读取 `intradayDataMap` 中的点。分时点的 `time` 是**数值型 chart-seconds**（`src/js/parser.js:304` `parseTencentMinuteToChartSeconds` 返回数值）。
- **实际行为**：`formatChartTime(numeric, '1d')` 只返回日期。已用 node 直跑复现：同一时间戳，旧实现（`[chartTimeToDate, chartSecondsToTime].join(' ')`）输出 `"2026-09-11 10:30"`，新实现输出 `"2026-09-11"` —— 分钟信息丢失。分时图全天同一天，日期列完全无信息量，时刻（唯一有用信息）消失。
- **期望行为**：验收标准 1 要求分钟线使用 `YYYY-MM-DD HH:mm` 格式；分时图浮层作为分钟级展示面应保留 HH:mm。旧版 `_detailTime` 本就输出「日期 时刻」，本提交在重构 `_detailTime` 时漏掉了这个未随 K 线浮层一起改的调用点。
- **根因**：`_detailTime` 增加 `period` 参数时默认值 `'1d'`，`renderDetail`（K 线）同步改为 `_detailTime(time, currentPeriod)`，但 `renderIntradayDetail`（分时）的调用点未同步传 `'1m'`。
- **影响范围**：仅分时图十字线浮层（时间轴刻度与 localization 不受影响——分时图走 `buildChartOptions({period:'1m'})` 与 `_intradayTimeScaleOptions`）。属交互信息回归。
- **复现方法**：打开任意标的分时图，移动十字线，观察浮层第一段只显示日期不显示时刻。
- **修复建议**：`src/js/chart.js:666` 改为 `_detailTime(time, '1m')`。
- **修复后验收标准**：分时浮层输出 `YYYY-MM-DD HH:mm`；`tests/chart.test.js` 不回归。

### 缺陷 3（P2，测试有效性）：假阴真阳用例的首根断言「因错误原因通过」，与实现共享同一错误假设，掩盖缺陷 1

- **文件与行号**：`tests/kline.test.js:280-287`（`'colors fake-yin positive day ... as red'` 中 `t.equal(bars[0].color, '#E74C3C', 'limit up day is red')`）。
- **触发条件**：该用例的首根样本（9.10 一字涨停，`open=close=9.64`）**未提供真实昨收（8.76）**，`formatVolumeBars` 内首根兜底为 `null` → 依缺陷 1 的 `null→0` 路径，`9.64 > 0` 即红。
- **实际行为**：断言通过，但归因错误——不是「一字涨停（close > 昨收）被判红」，而是「昨收被当 0、任何正价格被判红」。该用例无法证伪一字涨停判定逻辑：即使把真实判据删掉，只要保留 `null→0` 缺陷它依然绿；反之若把缺陷 1 按建议修复（`pc > 0` 守卫），此断言将**翻红失败**（close==open 且判据 2 被跳过 → 绿），而真实世界 9.10 确实应显红——用例数据本身缺少支撑结论的字段。
- **期望行为**：测试应独立于实现的错误假设。首根样本需携带可验证的昨收上下文（如 `opts: { prevClose: 8.76 }` 或给首根项补 `prevClose` 字段），断言才真正检验「一字涨停 → 红」。
- **根因**：测试与实现共享「null 昨收可参与比较」的同一假设；用例数据取自 9.11 见顶日叙事但丢弃了 9.10 的昨收信息。
- **影响范围**：测试矩阵对缺陷 1 完全无判别力（该用例在缺陷 1 存在时通过、恰因其存在而通过）。
- **复现方法**：对 `formatVolumeBars` 做变异（删去 `close > open` 与 `close > pc` 两判据、仅保留 `Number.isFinite(Number(null)) && close > 0` 的等价路径），用例仍绿；node 直跑见缺陷 1 证据。
- **修复建议**：随缺陷 1 修复同步改写：首根以 `{ prevClose: 8.76 }`（或 `opts.prevClose`）显式提供昨收，断言 9.10 一字涨停为红；并新增「首根无昨收 + 阴线 → 绿」「首根无昨收 + 平盘 → 绿」两条守卫断言，防止缺陷 1 复发。
- **修复后验收标准**：变异 `isVolumeBarUp` 为恒真/恒假时新用例确定性变红；缺陷 1 的验收断言全部落地。

## 三、待确认风险与未验证项

- 未验证项：`lightweight-charts` 真实渲染层的 localization/tickMarkFormatter 表现（E2E 已有 12/12 覆盖顶部浮层与时间轴，本轮未在浏览器中重复验证缺陷 2 场景——分时浮层是否被既有 E2E 断言覆盖未逐一核对）。残余风险：低，缺陷 2 已由纯函数级证据锁定。
- 批量路径首根之外（`i>0`）以 `items[i-1].close` 作昨收，对日 K 即真实昨收、对分钟 K 为上一分钟收盘——分钟线成交量柱语义由「close>open」变为「close>open 或 较上一分钟收涨」，与验收枚举一致，判定为符合预期，不列缺陷。

## 四、推荐修复顺序与复审验收标准

1. 缺陷 1（`kline.js` `pc > 0` 守卫）→ 2. 缺陷 3（改写用例使归因正确 + 新增守卫断言）→ 3. 缺陷 2（`chart.js:666` 传 `'1m'`）。
4. 复审验收：`isVolumeBarUp(…, null)` 阴线/平盘为 false；分时浮层含 HH:mm；kline.test.js 假阴真阳用例提供真实昨收且变异测试可被拦截；`npm run lint` 0/0、`npm test` 全绿、`npm run build` 成功、e2e 通过。

**审查结论：未通过（P2×3，需修复闭环）**
