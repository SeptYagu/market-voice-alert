# Round 10 独立审查交接文档（集合竞价方案代码落地修复轮复查 8 / 对象 `79fb603`）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`79fb603234bad00da53e66b095cf26192426191a`（`main` 与 `origin/main` 同步，工作区干净，`git pull --ff-only` 无更新）；基准 `7c955b0`；实际审查范围 `7c955b0..79fb603`（20 文件 / +3274 −29），本轮修复增量 `300820e..79fb603` = 3 文件 / +189 −5（`src/js/app.js` +8、`src/js/controllers/chartRowController.js` +37、`tests/chartRowController.test.js` +121，另有 STATUS/INDEX 登记）。
- 通过项极简：R9 唯一缺陷 P3-1 的实现语义经真实模块独立探针确证生效（坍缩 preview 柱 + 东财兜底无时间戳报价在场时，`refreshPreviewKline` 强制重载官方日K后 `preview` 清除、权威 `open/high/low/volume` 在重合并中全部保真）；`kline.js:673`/`:595` Fail-Closed 合取判据未放宽；需求 1–3 相关代码本轮零改动，继承 Round 9 已确证的闭环结论；本地门禁 `npm test` 916/916 全绿（pristine 工作区实测）、历史轮次判别力不回归。
- 判定：**未通过**（1×P3，测试有效性缺陷，见下）。

## 二、审查发现与缺陷清单

### P3-1 R9 P3-1 修复包只落地「机制本体」半程，生产触发接线零测试判别力（M1 变异全绿存活）

- **严重级别**：P3（实现本身经探针实测正确可用；缺陷在于验收标准 4「测试与变异矩阵全覆盖」的接线维度不成立，未来重构可静默杀死 R9 修复而门禁不可察觉。按本轮"无任何级别遗留"门槛阻断）。
- **文件与行号**：
  - 接线：`src/js/app.js:1368`（监控页循环 `void refreshLiveKlineForCode(code);`）、`src/js/app.js:1385`（涨停页循环 `void refreshLiveKlineForCode(code, true);`）、桥接 `src/js/app.js:1350-1354`（`refreshLiveKlineForCode` 导出体）。
  - 既有测试：`tests/chartRowController.test.js:271-391`（仅直测 `ChartRowManager.refreshPreviewKline` 本体）；`tests/app.test.js:825-843`（`updateChartLastTickMulti` 两个用例均为"不抛异常/可迭代"烟雾断言）。
- **触发条件**：任何后续改动删除或破坏 `updateChartLastTickMulti` 内两处接线调用（或桥接函数路由），R9 P3-1 的兜底重载在生产 Tick 链路中即整体退化为死代码——东财兜底通道当日柱将回到"全天 preview 坍缩态"（R9 缺陷原样复发）。
- **实际行为与期望行为**：
  - 实际（变异 M1：仅删除 `app.js:1368`/`:1385` 两行后跑全量门禁）：**916/916 全绿，0 fail**——全仓没有任何用例能区分"接线存在"与"接线被删"。
  - 期望：接线被删除/破坏时至少一个用例确定性转红（与 R8/R9 轮次对修复点逐行打变异的判别力标准一致）。
- **根因**：新增两组测试均以 `new ChartRowManager(...)` 直测方法本体，未沿调用链上探一层覆盖 `refreshLiveKlineForCode` 桥接与 `updateChartLastTickMulti` 的挂载点；`grep -rn "refreshLiveKlineForCode\|refreshPreviewKline" tests/` 证实零引用。此为 R1（`892f1b8` 用例 7 接入点降级）与 R2（`:546` 注入点零覆盖）同族模式在本轮的再现。
- **影响范围**：仅测试有效性，生产行为不受影响（接线当前真实存在且经探针验证可用）。
- **复现方法 / 验证证据**：
  - M1（接线判别力）：`sed` 删除 `app.js:1368`/`:1385` 两行 → `npm test` → **916 pass / 0 fail 存活**（已恢复原状）。
  - M2（本体判别力对照）：`refreshPreviewKline` 首行置 `return false` → **915 pass / 1 fail**（判别力成立，判定缺陷仅限接线层，已恢复原状）。
  - 独立探针（真实 `ChartRowManager` + 真实 `loadKline`/`applyLiveQuoteToKline`，仓库外执行）：坍缩 preview 柱（`o=h=l=c=1462, v=0, preview:true`）+ 东财兜底形态报价（`price/open/high/low/volume` 在场、无任何时间戳字段）+ 官方日K响应（今日柱 `1462/1471/1449/900000`）→ 10:30 调用返回 `true`，末柱 `{open:1462, close:1461.5, high:1471, low:1449, volume:900000, preview 缺失}`——该"报价在场时重载后重合并不回坍缩"的关键场景同样无用例覆盖（实测行为正确，仅作证据记录，不单独定级）。
- **修复建议**（二选一，推荐 a）：
  - a. 新增一条接线级用例：对 `monitorChartMgr`（`app.js:392` 已导出）与 `limitUpChartMgr`（`app.js:409`）临时 monkey-patch `refreshPreviewKline` 记录调用，调用 `_internal()` 导出的 `updateChartLastTickMulti`（`tests/app.test.js:36` 已有导入范式）并向 `state.quotes`/`state.expandedCodes` 注入最小前置，断言两管理器分别被调用且 `isLimitUp` 路由正确；沿用 `isolatedChartRequests` 夹具防真实网络。
  - b. 或在现有 `updateChartLastTickMulti` 烟雾用例（`tests/app.test.js:837-842`）中补 spy 断言。
- **修复后的验收标准**：对 `app.js:1368`、`app.js:1385`、`app.js:1350-1354` 三个点逐一打反向变异（删调用 / 删桥接 / 改错 `isLimitUp` 路由），每项变异必须至少命中一个用例确定性转红；正向全量门禁保持全绿。

## 三、待确认风险与未验证项

- **东财日K端点盘中是否返回今日半日柱（继承 R9，仍未获活体证据）**：本审查于 2026-09-19（周六）尝试活体验证——直连 `push2his.eastmoney.com` 返回空响应，经本地 `node server/index.js` 代理 `/api/eastmoney-kline`（`127.0.0.1:3001`）探测亦未获得上游数据（本机网络受限）。R9 已明示"兜底方案须据实调整"，实现方在无活体证据的情况下落地了以该端点为收敛源的机制。残余风险：若上游盘中不返回今日柱，`refreshPreviewKline` 将按 30s 节流持续重试但 preview 柱不收敛（行为不劣于修复前，但 R9 P3-1 的"权威收敛"承诺在真实环境未验证）。建议：下一交易日 09:30 后对任一走东财兜底通道的代码抓取一次真实重载结果。
- 其余继承项（上游盘前 payload 持续性、`quote.time` 回退路径日期校验等）与 R9 登记一致，本轮未改动、无新证据，不再重复展开。

## 四、推荐修复顺序与复审验收标准

1. P3-1（唯一项）：按修复建议 a/b 补接线级判别力用例，三个变异点（删监控页接线 / 删涨停页接线 / 删桥接或改错路由）逐一杀红并回报变异矩阵。
2. 复审验收：正向 `npm test` 全绿 + 3 项变异确定性转红 + 既有 M2 本体判别力不回归；接线用例不得引入单例定时器/状态泄漏（参考 R2 落地轮 `state.limitUp.timer` 残留教训，`finally` 中还原 monkey-patch 与前置状态）。
3. P3-1 闭环且无新增缺陷后，本轮审查方可通过；东财日K盘中行为活体证据可在下一交易日补验，不阻断本轮门禁判定，但须在 STATUS 中保留登记直至验证完成。
