# WorkBuddy 独立代码审查 round 12 交接（涨停看板历史日期图表修复方案）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`7b34bc5`；基准 `f48e592`；实际审查范围 `git diff f48e592..7b34bc5 --stat` = 7 文件 / +965 / -22（`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9/10/11 审查报告、`docs/handoff/INDEX.md`），**全为文档类改动，无产品代码与测试改动**；`git pull --ff-only` = `Already up to date`，工作区干净。
- 通过项简述：round 11 的 P2 主因已实质闭环 —— §4.3 用例 7 新增 `_internal()` 调度层访问器（`app.js:1645-1647`，与现网 `_internal` 返回体一致），并删除"或触发一次 `refresh()` 周期"的手动后门；(b) 步由定时器回调驱动，对 `app.js:1515` 变异**确实可证伪**（实测见 P3-2 证据）。§2.3 表与 §4.2 已收敛为 A1~A3（A4 行删除）；§2.3:99 / §4.2:276 的绝对化表述已按 round 11 要求改为条件式，`state.quotes` 三个写入点（`monitorController.js:44/50`、`app.js:952`、`momentumController.js:141/152`）经逐点核对**完全准确**；"≤3s"/"共计 4 次"已带成立条件。抽查 30 处代码锚点（`parseIntradayService.js:24/203/214/215/261`、`kline.js:200/409/420/439`、`api.js:161/172/415`、`limitUpController.js:259/411/564-567`、`marketSession.js:132`、`parser.js:64/82` 等）**与 HEAD 逐条一致**；`npm test` 复跑 **814/814 通过（0 失败）**。
- 缺陷集中在"保留根数表述仍有 3 处与自身公式冲突"、"用例 7 的 `app.js:1607` 变异证伪声称不成立"、"§2.3 A1 行 `targetDate = null` 与 loadKline 路径矛盾"、"用例 7(b) 的 Fake Timers 驱动机制在本仓库不存在且未指明"。**判定：未通过。**

## 二、审查发现与缺陷清单

### P3（低）保留根数仍有 3 处与自身公式冲突，本轮验收标准"保留根数全天与公式对齐"未实质满足

- **文件与行号**：
  - `docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:23`（§2 mermaid 节点 `F`）、`:68`（§2.2 第 2 条 T-2 分支）、`:135`（§3 第 1 条）；
  - 对照自身公式 `:67`（T-1 `min(240, 320 - x)`）、`:68` 前半句（T-2 `max(0, 80 - x)`）；
  - 关联声称 `STATUS.md:20`（"§2.2 T-1 保留根数全天区间与公式 `min(240, 320 - x)` **完全对齐**"）、`STATUS.md:16`（"§4.2:**277**"，实际为 `:276`，锚点偏移 1 行）。
- **触发条件**：按 `:67`/`:68` 给出的公式复算全天任意 `x ∈ [0, 240]`。
- **实际行为与期望行为**：

  | 位置 | 现文表述 | 按自身公式应得 | 冲突点 |
  | :--- | :--- | :--- | :--- |
  | `:23` | T-1"命中约 **199~240** 根 Bar" | `min(240, 320-x)`：`x=240` 时 **80** 根 | 固定区间仍与公式冲突（round 11 已点名的同类缺陷，仅 `:71` 被修正） |
  | `:68` | T-2"仍有 **1~75** 根 Bar 留在窗口内（例如 **09:30 开盘时剩余 75 根**）" | `max(0, 80-x)`：`x=0` 时 **80** 根，`x=79` 时 1 根 → 应为 **1~80**，09:30 应为 **80 根** | 同一句内公式与取值互相矛盾 |
  | `:135` | "腾讯 320 根滑动窗口**刚好容纳了 T-1 的 199 根**分钟线" | `x≤80` 时为 240 根（如 10:00 开盘半小时 `x≈31` → **240** 根） | 无条件固定值，未带成立条件 |

  - 期望：round 11 验收标准明确要求"§2.2 中所有 T-1/T-2 保留根数表述均可由 `min(240,320-x)`/`max(0,80-x)` 直接算出，**无与之冲突的固定区间**"；本轮验收标准亦为"保留根数全天与公式对齐"。
- **根因**：本轮仅按 round 11 的行号提示改了 `:71` 一处，未对**同一命题的其余表述**（mermaid 图、T-2 分支、§3 复述）做一致性扫描；`STATUS.md:20` 随之给出"完全对齐"的过强结论。
- **影响范围**：不改动"T-1 恒处于可合成伪分时覆盖带内（`x=240` 时仍有 80 根）"这一主线结论，属量化表述失准；但该三项均是验收标准点名的对象，会使 `STATUS.md` 的闭环声称与文档正文互相矛盾。
- **复现方法/验证证据**：纯算术复算 —— `min(240,320-0)=240`、`min(240,320-121)=199`、`min(240,320-240)=80`；`max(0,80-0)=80`、`max(0,80-79)=1`。`grep -n "199\|75 根\|240 根\|80 根" <doc>` 命中 `:23/:65/:67/:68/:71/:135`。
- **修复建议**：①`:23` 改为"覆盖 T-1（`min(240, 320-x)` 根，恒 ≥80）"；②`:68` 改为"当日第 80 根 Bar 形成之前，T-2 仍有 `max(0, 80-x)` 根（1~80 根，`x=0` 开盘时 80 根）留存在窗口内"；③`:135` 补成立条件（"在 11:30 前后 `x≈121` 时约 199 根；早盘 `x≤80` 时为满仓 240 根"）；④`STATUS.md:20` 相应改为"§2.2 的 T-1/T-2 保留根数表述（含 §2 mermaid 与 §3 复述）已全部按公式改写"；⑤`STATUS.md:16` 的 `§4.2:277` 更正为 `§4.2:276`。
- **修复后验收标准**：全文（含 mermaid、§2.2、§3、`STATUS.md`）任一保留根数表述均可由 `min(240,320-x)`/`max(0,80-x)` 直接复算得出，无与之冲突的固定区间或固定值。

### P3（低）§4.3 用例 7 的 `app.js:1607` 变异证伪声称不成立，且"移除 `stopMonitorTimer()`"被误列为必要修复项

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:434`（A/b 后"变异证伪性保证"）、`:431`（(a) 步）、`:286`（§4.2 改动方案第 1 条）、`:444`（§4.4 风险评估第 1 条）；关联 `STATUS.md:14`；对照代码 `src/js/app.js:1602-1614`（`stopMonitorTimer()` 在 `:1607`、`applyDataRefreshSchedule()` 在 `:1613`）、`src/js/controllers/monitorController.js:73-90`、`:139-140`。
- **触发条件**：按现文实现用例 7，并执行其声明的变异 "**或在 `app.js:1607` 恢复 `stopMonitorTimer()`**"。
- **实际行为与期望行为**：
  - 期望（`:434`）：该变异下 `timerCount === 0`、推进虚拟时钟不触发 `fetchQuotes`、用例"在第 (a) 步与第 (b) 步均确定性报错失败"。
  - 实际：
    1. `:1607` 的 `stopMonitorTimer()` 与 `:1613` 的 `applyDataRefreshSchedule()` **处于同一路由处理函数内且必然连续执行**；`stopTimer()` 会把 `interval` 置 `null`（`monitorController.js:76`），因此 `:1613` 的 `applySchedule(allowed, true)` 必定命中 `interval !== state.refreshInterval`（`monitorController.js:83-86`）**重建** `setInterval`。恢复 `:1607` 对 `timerCount` **无任何影响**。
    2. 用例 7 的执行路径是"手工 `limitUpCtrl.setRootEl(container)` + 直调 `_internal().applyDataRefreshSchedule()`"（`:430-431`），**根本不经过路由处理器**，`app.js:1607` 从未进入执行路径，该变异对该用例不可观测。
  - 实测（真实 `monitorController.js` 模块 + 受控 `timers` 沙盒，等价复现 `1607`→`1613` 序列）：
    ```
    applySchedule(allowed, !hasLimitUpRoot)  -> {"inFlight":false,"timerCount":0}   // 未修的 1515
    applySchedule(allowed, true)   [1515 修复] -> {"inFlight":false,"timerCount":1}
    stopMonitorTimer()             [1607 变异] -> {"inFlight":false,"timerCount":0}
    applySchedule(allowed, true)   [1613 紧接着] -> {"inFlight":false,"timerCount":1}  // 定时器被重建
    ```
- **根因**：把"`#/limit-up` 路由下轮询被停摆"的**唯一**有效修复点（`:1515` 的 `visible` 语义）与其**非必要**伴生调用（`:1607` 的清理调用）混为一谈，未核验同一路由处理函数内后续语句的重建效果。
- **影响范围**：不影响 `app.js:1515` 这一主修复方向（该变异**确已验证可证伪**：`timerCount` 由 1 变 0，(b) 步随之无法触发 `fetchQuotes`）；但：① 验收标准中"**或** `app.js:1607` 恢复 `stopMonitorTimer()`"这一分支**任何测试都无法满足**，作为替代证伪条件不可用；② 实现者会按 `:286`/`:444` 执行一个非必要改动，并据此写出无法失败的"变异实验"，与"测试是否可能在功能实际无效时仍然通过"的审查要求直接冲突。
- **复现方法/验证证据**：见上条实测输出（真实模块 + 注入 `timers` 沙盒，100% 复现）；代码事实见 `src/js/app.js:1607` / `src/js/app.js:1613` / `src/js/controllers/monitorController.js:73-86`。
- **修复建议**：① `:434` 删除"（或在 `app.js:1607` 恢复 `stopMonitorTimer()`）"分支，只保留唯一有效变异 `app.js:1515 → !hasLimitUpRoot`；② `:286`/`:444` 把移除 `:1607` 的 `stopMonitorTimer()` 降级为"可选清理（不影响 `timerCount` 与调度保活结论，其行为由 `:1613` 的 `applyDataRefreshSchedule()` 覆盖）"，或按代码事实完全删除该条；③ `STATUS.md:14` 同步修正，不得再声称该分支可致"`timerCount === 0`"。
- **修复后验收标准**：文档中出现的每一条"变异后用例必须失败"的断言，均已由真实代码路径验证为**行为可观测**（即变异确实改变被测断言所读取的状态），不存在同一处理函数内被后续语句抵消的无效变异。

### P3（低）§2.3 表 A1 行 `targetDate = null` 与本方案 `loadKline` 路径（即用例 3 的场景）矛盾

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:107`（§2.3 表 A1 行"旧代码合并表现"）；对照本方案自身表述 `:211`（§4.2 改造点二 问题现状 1）、`:232`（`loadKline` 修改前代码）与 `:421`（§4.3 用例 3）；对照实现 `src/js/controllers/chartRowController.js:383-384`、`src/js/kline.js:409-412`。
- **触发条件**：`items` 末柱为 `2026-09-11`、`inst.selectedTradeDate = '2026-09-11'`，注入无日期纯价格报价 `{ price: 21.00 }`。
- **实际行为与期望行为**：
  - 期望（`:107`）："原地覆盖：**`targetDate = null`**，`len = 2`"。
  - 实际：该输入在 **`loadKline` 路径**（`:209-210` 明确"改造点二"覆盖该路径；用例 3 也明确"执行 `loadKline` 报价合并逻辑"）下，`targetDate = q.tradingDay || q.date || q.quoteDate || inst.selectedTradeDate || getBeijingDate()`，因 `inst.selectedTradeDate` 为真而取值为 **`'2026-09-11'`**，**并非 `null`**。`:211` 自述"`targetDate` 退化为历史日期"亦与之矛盾。`targetDate = null` 仅成立于 `applyLiveTick` 增量 Tick 路径（旧代码把 `quoteOrPrice` 原样透传）。
  - 实测（真实 `applyLiveQuoteToKline` + 复刻 `chartRowController.js:383-384` 的两条路径）：
    ```
    A1 loadKline-path targetDate = "2026-09-11" | isNull: false
    A1 tick-path     targetDate = null
    ```
  - 注：两路径的**结论**（都是原地覆盖、`len = 2`、末柱被篡改）一致，故不影响 A1 行的定性。
- **根因**：把只在 `applyLiveTick` 路径成立的 `targetDate = null` 直接写入同时描述两条路径的 A1 单元格；该"`targetDate = null`"文字为本轮新增（上一版 A1 行无此值）。
- **影响范围**：§2.3 表是文档作为验收依据的核心表，且验收标准要求"§2.3 与 §4.2 对齐"；A1 行作为**唯一**描述 `loadKline` 路径旧行为的示例，其旧值与本方案 `:211` 互相矛盾，实现者据此写用例 3 的前置断言会得到不同中间值。不影响 `len`/末柱结论与 A2/A3 行（A2 的"`q === undefined` 跳过合并"为 `:214` 已显式澄清的调度层第一因，A3 的"退化为 `selectedTradeDate` 历史日"与代码一致）。
- **复现方法/验证证据**：见上条实测输出（直接调用真实 `kline.js: applyLiveQuoteToKline`，入参按 `chartRowController.js:383-384` 构造）。
- **修复建议**：`:107` 的"旧代码合并表现"改为带路径区分的表述，例如"`loadKline` 路径：`targetDate = inst.selectedTradeDate = '2026-09-11'`→`lastDate < targetDate` 为假→原地覆盖；`applyLiveTick` 路径：`targetDate = null`→原地覆盖；二者 `len = 2`，末根 `2026-09-11` 收盘价被篡改为 21.00"。
- **修复后验收标准**：§2.3 表中每条"旧代码合并表现"与"修复后预期表现"均与其所属调用路径（`loadKline` / `applyLiveTick`）的实际中间量一致，且与 §4.2 改造点二的 A1~A3 描述逐字段吻合。

### P3（低）§4.3 用例 7(b) 声明的 "Fake Timers 虚拟时钟" 驱动机制在本仓库不存在，且未给出可达的替代注入方案

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:432`（用例 7 (b) 步）；关联 `:409`（测试接入说明）；对照 `src/js/app.js:1455-1475`（`monitorCtrl` 创建时**未传** `timers`）、`src/js/controllers/monitorController.js:5`（`timers = globalThis` 默认值）、`src/js/controllers/monitorController.js:139-140`。
- **触发条件**：按现文实现用例 7(b)。
- **实际行为与期望行为**：
  - 期望（`:432`）："通过推进 Fake Timers 虚拟时钟前进一个刷新周期（`10000ms`）"驱动内部定时器回调。
  - 实际：
    1. 本仓库 `package.json` 的 `devDependencies` **无任何 fake timers 依赖**（无 `sinon` / `@sinonjs/fake-timers`），`tests/` 中亦无 `useFakeTimers` / `advanceTimers` / 替换 `globalThis.setInterval` 的用法；现有 6 处定时器测试**全部**采用"向 `createMonitorController({ timers })` 注入沙盒"的模式（`tests/monitorController.test.js:10/35`、`tests/phaseAFixes.test.js:20`、`tests/voiceController.test.js:23/38`、`tests/searchSuggestController.test.js:14`）。
    2. 该既有模式**无法接入用例 7**：用例 7 必须用 `app.js` 的单例 `_internal().monitorCtrl`，而 `app.js:1455` 创建它时未传 `timers`，其 `timers` 已硬绑定 `globalThis`（`monitorController.js:5`），测试无法再注入沙盒。
    3. 唯一可行途径是**在调用 `applyDataRefreshSchedule()` 之前替换 `globalThis.setInterval` / `globalThis.clearInterval`**（因 `timers` 持有 `globalThis` 对象引用、属性在调用时查找）。本轮已实测该途径可行（受控 patch 下 `applySchedule(allowed, true)` → `timerCount = 1`，回调可被捕获并手动触发），但文档未指明。
- **根因**：方案采用了 round 11 建议的"访问器"路线（而非其建议 2 的"给 `app.js` 注入 `timers`"），却未同步给出与之匹配的定时器驱动机制；沿用了 round 10 遗留的"Fake Timers"措辞。
- **影响范围**：属用例 7(b) 的可执行性缺口。按文档字面实现时，实现者若照搬仓库既有"注入 `timers` 沙盒"模式将无法驱动单例定时器；若改用 `globalThis` patch，则需额外承担跨用例状态隔离责任（`globalThis.setInterval` 为全局），否则污染同进程其他测试。不影响对 `app.js:1515` 的证伪结论本身。
- **复现方法/验证证据**：`grep -rn "useFakeTimers\|sinon\|advanceTimers\|setInterval = " tests/` 返回空；`sed -n '/"devDependencies"/,/}/p' package.json` 无 fake timers 依赖；`src/js/app.js:1455-1475` 未传 `timers`；受控 patch 实测可捕获定时器回调（见 P3-2 证据）。
- **修复建议**：`:432` 明确写出机制，二选一 —— ①（推荐，与仓库既有风格一致）在 `app.js:1455` 为 `createMonitorController` 增加 `timers` 注入能力（可由 `_internal()` 或测试入口透出），复用 `tests/monitorController.test.js` 的沙盒模式；②保持访问器路线，但显式规定"测试在 `beforeEach` 保存并替换 `globalThis.setInterval/clearInterval`、在 `afterEach` 原样还原"，并在 `:409` 的接入说明中一并列出。
- **修复后验收标准**：`:432`/`:409` 给出**在本仓库可实际执行**且不污染其他用例的定时器驱动方案，并指明其隔离与还原责任；该方案下用例 7(a)(b)(c) 均可实现，且在 `app.js:1515` 变异时确定性失败。

## 三、待确认风险与未验证项

1. **待确认风险（`timerCount` 作为"轮询定时器存活"代理不稳健）**：`monitorController.js:140` 的 `inspect().timerCount` 为 `timer` + `checker` + `preloadTimer` 三者之和。`checker` 由 `startApp`（`app.js:1587` → `monitorController.js:104`）无条件建立且仅在 `stop()` 时清除。实测：`checker` 存活时 `stopTimer()` 后 `timerCount = 1`（即轮询定时器已被掐灭但断言仍为真）。当前用例 7 不调用 `startApp`，故 (a) 步仍可证伪；**但**若实现者改用 `startApp` 引导（为获得真实路由/`state` 初始化），或同进程内其他用例已启动 `startChecker`，(a) 步将退化为**恒真**的空断言，且跨用例状态泄漏会使证伪性随机失效。建议 `inspect()` 额外暴露专用字段（如 `pollTimerAlive: timer !== null`）并让 (a) 步改断言该字段。验证方法：`startApp` 引导后跑变异实验，观察 (a) 步是否仍能失败。
2. **未验证项**：§4.3 的 8 个用例**均未实现**，其可行性本轮仅经静态契约核对与定点实测；`resolveLiveFallbackDate`、`getRefreshCodes()` 合流、`_internal()` 扩展**均未落地**，端到端"展开→追加今日蜡烛"未在任何真实定时器/DOM 环境下执行。本机离线，未做真实行情验证。
3. **残余风险（沿用 round 11 §三-1）**：方案要求 `#/limit-up` 期间保持后台轮询，会使 `onQuotes`（`app.js:1464-1468` 的 `mergeQuotesIntoMomentumItems` / `processAlerts` / `updateChartLastTickMulti`）与 `onRefresh`（`app.js:1469-1473`）被更频繁触发；其中语音告警 `processAlerts`（`app.js:1211-1225`）在涨停页期间的重复播报行为仍未做端到端验证（需浏览器 + 真实行情）。
4. **未验证（环境限制）**：本轮未复跑 `npm run lint` / `npm run build` / Playwright E2E，仅复跑 QUnit `814/814`。

## 四、推荐修复顺序与复审验收标准

1. **先修 P3-2（唯一涉及"断言可证伪性"的缺陷，直接影响本轮验收标准）**：删除 `:434` 的 `app.js:1607` 变异分支，并按代码事实降级/删除 `:286`、`:444`、`STATUS.md:14` 中"移除 `stopMonitorTimer()`"的必要性表述。
2. **再修 P3-4（用例 7 的可执行性）**：`app.js:1455` 增加 `timers` 注入，或显式规定 `globalThis.setInterval/clearInterval` 的替换与还原约定。
3. **再修 P3-3（§2.3 表 A1 行）**：按 `loadKline` / `applyLiveTick` 两路径分列 `targetDate` 旧值，与 `:211` 对齐。
4. **最后修 P3-1（保留根数一致性）**：`:23` / `:68` / `:135` 三处按 `min(240,320-x)` / `max(0,80-x)` 改写，并同步 `STATUS.md:16`（`§4.2:277`→`:276`）、`STATUS.md:20`（"完全对齐"→列举实际改写范围）。四项互不依赖。
5. **复审验收标准（全部须满足）**：
   - 全文（含 mermaid、§2.2、§3、`STATUS.md`）任一 T-1/T-2 保留根数表述均可由 `min(240,320-x)`/`max(0,80-x)` 复算得出，无冲突的固定区间或固定值；
   - 文档中每一条"变异后用例必须失败"的断言均为代码路径可观测——`app.js:1515` 变异分支保留且经真实模块验证；`app.js:1607` 分支已删除或已按代码事实说明其不影响断言；
   - §2.3 表 A1~A3 每条"旧代码合并表现"与"修复后预期表现"均与其调用路径的实际中间量一致，且与 §4.2 改造点二逐字段吻合；
   - §4.3 用例 7 给出一套在本仓库可实际执行、不污染其他用例的定时器驱动方案，(a) 步断言不依赖 `timerCount` 中被 `checker` 恒定贡献的量；
   - `STATUS.md` 的闭环声称与文档正文逐条一致，不再出现"完全对齐"一类未覆盖全部同类表述的过强结论；
   - `npm test` 复跑仍为 **814/814**；本轮复审 diff 仍只含文档类改动。
