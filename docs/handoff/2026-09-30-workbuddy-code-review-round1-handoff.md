# 独立代码审查报告（Round 1 复查）— 周期切换分时联动隔离 / 分钟 K 线全天振幅污染修复

日期：2026-09-30
类型：独立代码审查（代码 diff + 运行验证）
结论：**未通过**（1×P3，最高严重级别 P3）

---

## 一、审查基本信息与通过项简述

- 被审 HEAD：`78b7de64a8b8115898c948ff29a3e8a7bf4785a7`（`origin/main` 与本地 HEAD 一致，`git pull --ff-only` 后无新提交，工作区干净）。基准 `3ea0cfb9b783a5cedb601e375d9f0e5b92e19173`。实际审查范围 `3ea0cfb..78b7de6` = 12 文件 / +329 −50（3 源文件核心改动 + 1 视图 + 1 控制器 + 2 测试改 + 2 新测试 + 3 文档）。审查未做任何 checkout/reset/rebase/合并。
- 通过项简述：两项任务目标（周期切换只更新目标 K 线并保留分时状态/请求/实例；分钟 K 线仅用该周期 OHLCV）均已落地且真实生效，监控/涨停/动量三页周期入口均走共享管理器；调用链与辐射面（图表挂载/销毁、路由 teardown、报价刷新环、K 线 SWR 回写）无异常；门禁复跑 `npm test` 927/927、`npx playwright test` 77/77、`npm run lint` 0 问题、`npm run build` 成功。
- 独立验证：设计了 4 项正向/边界探针（周期往返切换的旧响应归属、收起自停与去重、后台失败保数据并重试、动量周期标签局部更新），均符合预期；另用 2 组变异在独立 worktree 上证明新测试具备判别力（删分钟隔离 → 3 用例确定性转红；恢复“每次都重载分时+整表渲染” → 2 单测 + 2 e2e 转红）；仅有 1 项初始失败探针构造出反例（见 P3-1）。

---

## 二、审查发现与缺陷清单

### P3-1 分钟 K 线后台刷新调度器仅在“首次加载成功”时安装，瞬时失败后永久不自愈

- **严重级别**：P3
- **文件与行号**：
  - `src/js/controllers/chartRowController.js:423-424`（`inst.loading = false; this.startMinuteRefresh(code);`，位于 `try` 内、`if (!isCurrentTask()) return;` 之后）
  - `src/js/controllers/chartRowController.js:572-577`（`startMinuteRefresh`，唯一安装点）
  - `src/js/controllers/chartRowController.js:579-591`（`refreshMinuteKline`，唯一被 15s 定时器驱动）
  - `src/js/controllers/chartRowController.js:563`（`handlePeriodChange` → `loadKline(code,{reloadIntraday:false})`，分钟周期唯一入口）
- **触发条件**：已展开标的切换到任一 1/5/15/30/60 分钟周期时，该周期的 K 线源全部失败（东财 2 次尝试 + 腾讯备用源均失败，或因响应为空走到 `kline.js` 的 `K 线数据为空` 抛错）。即 `loadKline` 在成功提交数据前抛出异常。
- **实际行为**：`loadKline` 抛错进入 `catch`，仅 `inst.error = ...`、`inst.loading = false`、`updateKlineStatus`，随后 `return`；`this.startMinuteRefresh(code)` 从未执行 → `minuteRefreshTimers` 无该 code 条目 → 15s 定时器不会被创建 → `refreshMinuteKline` 无任何调用方。此后：`updateChartLastTickMulti` 对该分钟图的两个入口均为空操作（`applyLiveTickToKlineChart` 与 `refreshPreviewKline` 分别因 `isMinutePeriod`、`period!=='1d'` 提前返回），且再次点击**同一**周期按钮会因 `inst.period === p` 提前返回。结果：分钟图停在错误态，不会发起任何后续请求，必须由用户手动点“🔄 重新加载”（`handleForceReloadChart`，默认 `reloadIntraday=true`）或切到其它周期再切回才能恢复。
- **期望行为**：与本次交付自述一致——“后台请求失败时保留已有数据、显示 K 线错误并允许**下个周期重试**”。首次加载瞬时失败后，调度器应仍被安装并遵守 `canRefreshKline`（自动刷新开关/暂停），使下一个 15s 周期自动重试；成功即恢复权威 OHLCV。
- **根因**：`startMinuteRefresh` 的调用点被放在 `loadKline` 成功路径的 `try` 内（数据提交之后），异常路径整体绕过；而安装调度器的唯一入口即此调用，`refreshMinuteKline` 自身不安装定时器，形成“无成功即无调度、无调度即无重试”的死角。同类问题在被改的 `refreshPreviewKline`（1d）上因由报价环驱动而部分掩盖，分钟周期则完全无第二驱动源。
- **影响范围**：任一展开的分钟 K 线图在一次首载失败后被静默降级为“不再自动更新”（与基线相比为行为退化：基线由报价 tick 驱动分钟图，虽会污染振幅但会持续刷新）。非灾难性——错误在状态栏可见且有手动恢复路径——但直接命中的是验收标准中“分钟 K 线……**持续正确更新**”与“自动刷新开关及暂停规则有效”。
- **复现方法 / 运行证据**（独立探针，`globalThis.fetch` 前 3 次返回 `ok:false` 令整条源链失败）：

  ```
  await mgr.loadKline('sh600005', { force: true, reloadIntraday: false })
  inst.error === 'K 线数据为空'      // 首载失败并暴露错误
  mgr.minuteRefreshTimers.size === 0 // 未安装调度器
  // 对照：同一用例在首载成功后 minuteRefreshTimers.size === 1
  ```
  交叉证据：现有 `tests/chartPeriodIsolation.test.js` 第 4 用例（“K-line-only load and force minute reload…”）只断言**成功**首载后 `minuteRefreshTimers.has(...)` 为真，未覆盖失败首载，故此缺口未被任何用例拦截。

- **修复建议**：把调度器的安装从“成功路径”提升为“生命周期安装”，与加载成败解耦。最小改动示例：在 `loadKline` 的 `finally` 内、`if (isCurrentTask())` 分支中补 `this.startMinuteRefresh(code);`（`startMinuteRefresh` 已用 `isMinutePeriod` + `!has(code)` 自守卫）；或在 `handlePeriodChange` 的 `stopMinuteRefresh(code)` 之后立即 `startMinuteRefresh(code)`。要求：仍由 `refreshMinuteKline` 内的 `canRefreshKline`/`isExpanded`/`isMinutePeriod` 决定是否真正发请求；关闭图表（`destroyCharts`）、切到非分钟周期、整体销毁时仍须清理定时器。
- **修复后验收标准**：
  1. 分钟周期首载首次请求失败、随后源恢复：无需任何用户操作，≤1 个刷新间隔（15s）内自动重试并成功渲染权威 OHLCV，`inst.error` 被清除，`minuteRefreshTimers.size === 1`。
  2. 自动刷新关闭或交易时段暂停（`canRefreshKline` 为 false）时，首载失败后虽安装调度器但**不发**任何后台请求；恢复后自动续跑。
  3. 首载失败后关闭图表或切到日/周/月周期，`minuteRefreshTimers.size === 0`。
  4. 新增单测覆盖“首载失败 → 调度器存在 → 源恢复后自动重试成功”，并在失败态下断言无请求（防止变异回退）。

---

## 三、待确认风险与未验证项

- 无未验证的实质性风险项。修复边界与交付自述一致：本轮未联网跑真实行情源，未部署远端；`applyLiveQuoteToKline` 对全部分钟周期（含 A 股/国内期货/国际期货/港股/美股）统一早退，各市场真实分钟端点的 OHLCV 正确性仍由上游数据契约负责（已由 5 市场 × 5 周期 × 4 时间戳的用例覆盖隔离性，但非活体验证）。

---

## 四、推荐修复顺序与复审验收标准

1. **P3-1**（唯一）：按上文修复建议安装调度器并补失败态单测。
2. 复审需确认：`npm test`、`npm run e2e`、`npm run lint`、`npm run build` 全绿；新增失败态用例在“把 `startMinuteRefresh` 留在成功路径”的变异下确定性转红；原 4 项探针与既有 927 单测无回归。
