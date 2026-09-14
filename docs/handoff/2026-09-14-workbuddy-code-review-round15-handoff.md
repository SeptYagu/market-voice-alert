# WorkBuddy 独立代码审查 round 15 交接（涨停看板历史日期图表修复方案）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`bd0e939`；基准 `f48e592`；实际审查范围 `git diff f48e592..bd0e939 --stat` = 10 文件 / +1412 / -22（**全为文档类改动**：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9/10/11/12/13/14 审查报告、`docs/handoff/INDEX.md`，无 `src/`、`server/`、`tests/`）；相对 round 14 HEAD `1adf743` 的增量 = 3 文件 / +39 / -14。`git pull --ff-only` = `Already up to date`，工作区干净，`HEAD == bd0e939` 与派发一致。
- 通过项（极简）：round 14 的 2 项 P3 主项经独立复核**均确认闭环** —— ①`STATUS.md:95` 的 round 12 引文与 `git show c3f5bc0:STATUS.md | sed -n '12p'` 逐字一致（无条件 `恒 ≥80`），与 `STATUS.md:63`（round 13 段）归属唯一、不再互斥；②§4.3 已改为 `registeredTimers.get(inspect().pollTimerId)` 纯身份键，仓库外探针（真实 `monitorController` + 文档 §4.3 原样沙盒）确证 `pollTimerId` 即沙盒 `setInterval` 返回的注册 id，在 `limitUp.ms === monitor.ms`（`10000`/`30000`/`60000` 三档同 ms 撞车）下仍唯一取到行情轮询回调。需求覆盖无遗漏、核心调用链无异常。实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**。
- 独立验证共 4 组（默认组合、同值 `10000`、同值 `30000`、同值 `60000`）：前三组完全符合预期；第 4 组在确认修复机制成立的同时，暴露 1 项 P3（取值域枚举与代码不符）。**判定：未通过。**

## 二、审查发现与缺陷清单

### P3（低）§4.3 对 `state.refreshInterval` 合法取值域的枚举与代码不符（遗漏 `60000`），"全组合 / 同 `ms` 碰撞"分析的行情侧取值域被少列一档

- **文件与行号**：
  - 主实例（本轮新增文本）：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:419` —— 「`ms = state.refreshInterval`，默认 `10000`，**可选 `3000/10000/30000`**」以及「若用户持久化配置使 `state.limitUp.refreshInterval === state.refreshInterval`（**例如同为 `10000` 或同为 `30000`**）」。
  - 同类实例（同一命题、非本轮改动，建议同批修正）：同文件 `:385` —— 「在 1 个报价周期内（**默认 10s，可选 3s**）」。
  - 对照代码：`src/js/app.js:151-156`（`export const REFRESH_OPTIONS = [{3000},{10000},{30000},{**60000**}]`）、`src/js/app.js:803`（`handleRefreshChange` 以 `REFRESH_OPTIONS.some(o => o.value === v)` 白名单校验后才写入 `state.refreshInterval`）、`src/js/app.js:499`（`refreshOptions: REFRESH_OPTIONS` 注入表头下拉）、`src/js/app.js:1569`（`state.refreshInterval = settings.refreshInterval || DEFAULT_REFRESH` 直接载入持久化值、不再校验）、`src/js/app.js:805`（`patchSettings({ refreshInterval: v })` 持久化）、`src/js/controllers/monitorController.js:83-86`（`interval = state.refreshInterval` → `timers.setInterval`）、`src/js/controllers/limitUpController.js:438`（`setInterval(..., lu.refreshInterval)`）。
- **触发条件**：在监控页把刷新周期设为 **60 秒**（`REFRESH_OPTIONS` 第 4 项，UI 可选、经 `patchSettings` 持久化），随后进入 `#/limit-up` 执行 `applyDataRefreshSchedule()`。此时 `state.refreshInterval === 60000`；若用户同时把涨停列表刷新间隔也设为 60 秒（`src/js/format.js:3-7` 的 `LIMIT_UP_REFRESH_OPTIONS` 第 3 项，`src/js/storage.js:230-235` 白名单允许），则 `state.limitUp.refreshInterval === state.refreshInterval === 60000`。
- **实际行为与期望行为**：
  - 期望（文档 `:419` 自述）：`state.refreshInterval` 的合法取值域是 `{3000, 10000, 30000}`，因此同 `ms` 碰撞只可能出现在 `10000` 或 `30000`；§4.3 的"在 `state.limitUp.refreshInterval × state.refreshInterval` **全组合**下均能 … 唯一选中"是对一个完整穷举域作出的结论。
  - 实际：`state.refreshInterval` 的合法取值域是 `{3000, 10000, 30000, 60000}`（`app.js:151-156` + `:803` + `:1569`），**`60000` 同为真实可达值且是第三个碰撞档位**。文档的碰撞示例与"全组合"域因此各少列一档。
- **根因**：本轮为回应 round 14「不得出现未带取值条件的定值断言」，把 `:418` 的括注 `（ms = state.refreshInterval = 10000）` 扩写为带枚举的括注，但**未把枚举与代码白名单逐项核对**；沿用而非复核了 round 14 报告 `docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md:38` 中的 `src/js/app.js:151-154`（`REFRESH_OPTIONS = [3000, 10000, 30000]`）——该处本身即漏 `60000` 且行区间只覆盖前三项（`REFRESH_OPTIONS` 实为 `:151-156`）。属 round 12 教训"同一命题未做横向一致性扫描"的同族变体：**修复文字时新增的枚举未回到代码求证**。
- **影响范围**：仅文档可信度与用例边界覆盖（本轮无产品代码、测试与运行期改动）。
  1. 若实现者据 `:419` 的枚举编写用例 7 的边界组合，`60000` 这一真实碰撞档不会被覆盖，round 14 P3-2 的"消除同 `ms` 碰撞"在文档层面留下的验证域并不完整；
  2. `STATUS.md:37`（round 14 历史段）与其所引 round 14 报告正文中的同一枚举（`3000/10000/30000`）将与修正后的当前文档并存而数值不同 —— 这是**历史记录与当前事实的差异**，按 round 14 P3-1 的既定原则应保留历史原文、不得回填改写（见"修复建议"）。
- **复现方法/验证证据**（仓库外探针 `%TEMP%/mvaprobe15/probe.mjs`，未入库；真实 `createMonitorController` + 文档 §4.3 原样 `Map` 沙盒；固定时钟 `2026-09-14 10:00+08:00`）：
  ```
  LIMIT_UP_REFRESH_OPTIONS = [ 10000, 30000, 60000 ]
  [default]        monitorMs=10000 limitUpMs=30000  registered ms=[10000,30000]  ms-matches=1 -> UNIQUE
  [same-as-10000]  monitorMs=10000 limitUpMs=10000  ms-matches=2 -> COLLISION ; pollTimerId=1001 entry.ms=10000 drivesFetchQuotes=true
  [same-as-30000]  monitorMs=30000 limitUpMs=30000  ms-matches=2 -> COLLISION ; pollTimerId=1001 entry.ms=30000 drivesFetchQuotes=true
  [same-as-60000]  monitorMs=60000 limitUpMs=60000  ms-matches=2 -> COLLISION ; pollTimerId=1001 entry.ms=60000 drivesFetchQuotes=true
  ```
  （`monitorMs=60000` 一栏即"文档枚举外的第三个碰撞档"；同探针同时证明 `pollTimerId` 身份键在三档下均唯一命中行情回调 → **round 14 P3-2 的修复机制本身成立，本缺陷只在其取值域描述上**。）
- **修复建议**：
  1. 将 `:419` 的 `可选 `3000/10000/30000`` 更正为 `可选 `3000/10000/30000/60000``，并把「（例如同为 `10000` 或同为 `30000`）」补齐为「（例如同为 `10000`、`30000` 或 `60000`）」；
  2. 同批修正 `:385` 的「（默认 10s，可选 3s）」为「（默认 10s，可配置 `3/10/30/60` 秒）」；
  3. **不要**改写 `STATUS.md:37`（round 14 历史段）及 round 14 报告正文中的原枚举 —— 它们如实记录了 round 14 当时的结论，属历史状态；如需消歧，仿照 `STATUS.md:95` 的既有做法在**本轮**记录中写明明细，而非回填历史段（避免重演 round 14 P3-1 的"历史引文回填"缺陷）。
- **修复后验收标准**：文档中任何描述 `state.refreshInterval` 取值域的位置，均与 `src/js/app.js:151-156` 的 `REFRESH_OPTIONS` 逐项一致（含 `60000`）；`:419` 的碰撞示例覆盖 `10000`/`30000`/`60000` 三档；`STATUS.md:37` 等 round 14 历史段保持原文未变（可由 `git show 1adf743:STATUS.md | sed -n '37p'` 复核）。

## 三、待确认风险与未验证项

1. **未验证（环境限制，沿用前轮）**：§4.3 的 8 个用例**仍未落地**；§4.2 提议的 `pollTimerId`/`pollTimerAlive` 字段、`_internal()` 扩展（`monitorCtrl`/`applyDataRefreshSchedule`）、`getRefreshCodes()` 的 `expandedCodes` 合流、`resolveLiveFallbackDate` 均**未在代码中实现**（本轮与 round 9-14 一致，均为纯文档改动，本审查按"方案契约"判定，非按"已实现代码"判定）。端到端"展开 → 追加今日蜡烛"未在真实浏览器/真实定时器环境执行；本机离线，未做真实行情验证。
2. **未验证（本轮环境限制）**：仅复跑 QUnit（`814/814`）与 Node 探针，未执行 `npm run lint` / `npm run build` / Playwright E2E（本轮无代码改动，风险低）。
3. **待确认风险（沿用 round 11-14 §三）**：方案要求 `#/limit-up` 期间保持后台轮询，会使 `app.js:1464-1468` 的 `onQuotes`（`mergeQuotesIntoMomentumItems` / `processAlerts` / `updateChartLastTickMulti`）与 `onRefresh` 被更频繁触发，语音告警 `processAlerts` 在涨停页期间的重复播报行为仍未做端到端验证（需浏览器 + 真实行情）。
4. **待确认风险（沿用 round 13/14）**：`tencent-legacy` 1m 缓存当日实际 Bar 数为 240 还是 241/243，本机离线无法从真实响应取证；相关算式按文档内部公式核对，不依赖线上实测。

## 四、推荐修复顺序与复审验收标准

1. **只修 1 项 P3**（不涉及产品代码/测试）：按"修复建议"①② 更正 `doc:419`（补 `60000` 及第三个碰撞档）与 `doc:385`，并保持 `STATUS.md:37` 等历史段原文不动。
2. **复审验收标准（全部须满足）**：
   - `doc:419` / `doc:385` 的 `state.refreshInterval` 取值域与 `src/js/app.js:151-156` 逐项一致（含 `60000`）；碰撞示例覆盖 `10000`/`30000`/`60000`；
   - round 14 已闭环项未被破坏：`STATUS.md:95` 引文仍与 `git show c3f5bc0:STATUS.md | sed -n '12p'` 逐字一致、与 `STATUS.md:63` 归属唯一；§4.3 仍为 `registeredTimers.get(inspect().pollTimerId)` 纯身份键（三方对比：`git diff 1adf743..<新 HEAD> -- STATUS.md docs/handoff/*investigation*` 中不得出现回退为数值 `ms` 选中的改动）；
   - 全文不再出现"未带取值条件/枚举不完整"的刷新周期断言；历史段引文可逐字复核且归属唯一；
   - `npm test` 复跑仍为 **814/814**；`git diff --stat` 仍只含文档类改动（不含 `src/`、`server/`、`tests/`）。
