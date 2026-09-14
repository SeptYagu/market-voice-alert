# WorkBuddy 独立代码审查 round 14 交接（涨停看板历史日期图表修复方案）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`33b8f53`；基准 `f48e592`；实际审查范围 `git diff f48e592..33b8f53 --stat` = 9 文件 / +1296 / -22（`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9/10/11/12/13 审查报告、`docs/handoff/INDEX.md`），**全为文档类改动，无产品代码与测试改动**；本轮相对 round 13 HEAD `c3f5bc0` 的增量 = 3 文件 / +71 / -53；`git pull --ff-only` = `Already up to date`，工作区干净。
- 通过项简述：round 13 的 P2-1（§4.3 沙盒）已改为按自增 id 建表选择，独立探针在真实 `monitorController` + 真实 `limitUpCtrl` 路径下复现「仅注册 `ms=10000/30000` 两定时器、按 `ms === state.refreshInterval` 选中唯一」；P2-2 已把错配历史段重写为 round 12 审查记录并清除 `1607 ⇒ timerCount` 与 Fake Timers 断言；P3-1 的 `§4.2:276` 锚点与「100% 精准对齐」已校正、`INDEX.md` 摘要已同步；P3-2 的 A1 已按 `loadKline`/`applyLiveTick` 拆列（真实代码复算一致）；P3-3 的三处保留根数已带 `x ≤ 240` 条件。实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**；本轮改动涉及的全部代码锚点（`app.js:1513-1531/1602-1614/1645-1647`、`monitorController.js:14-22/78-90/140`、`limitUpController.js:434/438`、`kline.js:402-453`、`chartRowController.js:114/383`、`format.js:3-6`、`storage.js:227-234`、`limitUpView.js:91`）逐条与 HEAD 一致。
- 独立验证：仓库外探针（`%TEMP%/mvaprobe14/probe.cjs`，未入库）以**真实** `applyLiveQuoteToKline` 复算 A1~A4 报价合并形态（`{price:21}`→`len=2` 覆盖、`{price:21,date:'2026-09-11'}`→`len=2` 覆盖、`{quoteDate:'20260914'}`→`len=3` 追加、`{date:'2026-09-14'}`→`len=3` 追加，与 §2.3/§4.2 完全吻合），并按 §4.3 原样沙盒回放两处注册 → 命中 1 项缺陷（P3-2）。**判定：未通过。**

## 二、审查发现与缺陷清单

### P3（低）`STATUS.md` 的 round 12 闭环记录被改写成 round 13 才引入的条件式，既不等于 round 12 实际产出，也与同文件 round 13 闭环段自相矛盾

- **文件与行号**：`STATUS.md:57`（本轮被修改的行）；对照 `STATUS.md:25`（本轮新增的 round 13 闭环段）；对照 `docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:23`；对照 `c3f5bc0`（round 12 交付版本）的文档 `:23` 与 `STATUS.md:12`。
- **触发条件**：阅读 `STATUS.md` 第 48 行起的「历史状态：WorkBuddy 审查（round 12）缺陷全面闭环……提交 round 13 独立审查」段，并与同文件顶部 round 13 闭环段交叉核对。
- **实际行为与期望行为**：
  - 实际：本轮把该段的引文从「修正为 `覆盖 T-1: min(240, 320-x) 根，恒 ≥80`」（`c3f5bc0:STATUS.md:12` 原文）改写为「修正为 `覆盖 T-1: min(240, 320-x) 根，**在 x≤240 时恒 ≥80**`」（`STATUS.md:57`）。该改写后的引文**在任何一个版本上都不成立**：
    - round 12 的实际产出是 **`min(240, 320-x) 根，恒 ≥80`**（无条件，`git show c3f5bc0:<doc> | sed -n '23p'` 与 `git show c3f5bc0:STATUS.md | sed -n '12p'` 均可复核），正是 round 13 的 P3-3 所指「`恒 ≥80` 与 §2.2:65 的 241/243 根前提冲突」；
    - round 13 修复后的当前文本是 **`min(240, 320-x) 根，常规 x≤240 时 ≥80`**（`doc:23`），措辞为「常规 x≤240 时 ≥80」，并非 `STATUS.md:57` 所写的「在 x≤240 时恒 ≥80」。
  - 同文件 `STATUS.md:25`（round 13 闭环段）明确写「在 §2 mermaid 节点 F、§2.2:71 与 §3:135 中，为**「恒 ≥80 根」补齐「常规交易日 $x \le 240$」成立条件**」。即：**round 13 段声明该条件由 round 13 补齐，round 12 段却声明该条件在 round 12 就已写入** —— 同一文件内对「谁补齐了该条件」存在两处互斥陈述。
  - 期望：本轮验收标准第 2 条要求「`STATUS.md` 历史段与断言彻底自洽」。历史段可以保留历史的（随后被取代的）原文引述，但不得把一个由本轮改动才产生的形态回填到上一轮的历史记录中；同一事实在 round 12/round 13 两段中的归属必须唯一。
- **根因**：与「同一命题的其余表述未做一致性扫描」同族 —— 修复 `doc:23` 时，顺手把 `STATUS.md` 中引用该行的**历史记录**也改成新措辞，但采用了既非旧文亦非新文的第三种写法，且未与该文件顶部 round 13 闭环段的归属声明做闭合校验。
- **影响范围**：仅限文档可信度（`STATUS.md` 是外部读者判断「哪一轮改了什么」的首要入口）。会让后续读者/实现者误以为 `x ≤ 240` 条件在 round 12 就已存在，从而在复盘 round 13 P3-3 时得出「round 13 的修复是重复劳动」的错误结论；无产品代码与测试影响（本轮无代码改动）。
- **复现方法/验证证据**：
  ```
  git show c3f5bc0:STATUS.md | sed -n '12p'
  #   - 在 §2 mermaid 节点 F 修正为 `覆盖 T-1: min(240, 320-x) 根，恒 ≥80`，消除 `199~240` 固定区间冲突；
  git show c3f5bc0:docs/handoff/2026-09-14-...-handoff.md | sed -n '23p'
  #   E --> F["腾讯旧版 320 根滑动窗口覆盖 T-1 (min(240, 320-x) 根，恒 ≥80)"]
  sed -n '57p;25p' STATUS.md
  #   :57  ...修正为 `覆盖 T-1: min(240, 320-x) 根，在 x≤240 时恒 ≥80`...
  #   :25  ...为“恒 ≥80 根”补齐“常规交易日 $x \le 240$”成立条件...
  ```
- **修复建议**：把 `STATUS.md:57` 的引文改回 round 12 的真实产出 —— `覆盖 T-1: min(240, 320-x) 根，恒 ≥80`（并在其后保留「消除 `199~240` 固定区间冲突」的原表述）；同时在该段末尾补一句「（该 `恒 ≥80` 的 241/243 根前提缺口已由 round 13 闭环，见本文件顶部 round 13 段）」以显式承接，消除两段之间的归属冲突。**不得**继续以「在 x≤240 时恒 ≥80」这类未在任一版本出现过的措辞充当历史引文。
- **修复后验收标准**：`STATUS.md` 中每一处对改动前文本的引述，均可由 `git show <该轮 HEAD>:<文件>` 逐字复核；同一修复动作（`x ≤ 240` 条件的引入）在 round 12 段与 round 13 段中的归属唯一、不互相矛盾。

### P3（低）§4.3 沙盒以数值 `ms` 作为选中键，在 `state.limitUp.refreshInterval === state.refreshInterval` 的合法配置下会同时命中两个定时器，与文档自身「断言该定时器唯一」的契约冲突

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:418`（§4.3 定时器沙盒契约：「系统会先后注册……行情轮询定时器（`ms = state.refreshInterval = 10000`）以及……涨停列表定时器（`ms = 30000`）」「断言该定时器唯一且有效」）、`:465`（用例 7(b) `const pollTimer = [...registeredTimers.values()].find(t => t.ms === state.refreshInterval);`）；对照代码 `src/js/controllers/monitorController.js:83-86`（`interval = state.refreshInterval` → `timers.setInterval(..., interval)`）、`src/js/controllers/limitUpController.js:434/438`（`const interval = lu.refreshInterval;` → `setInterval(..., interval)`）、`src/js/format.js:3-6`（`LIMIT_UP_REFRESH_OPTIONS = [10000, 30000, 60000]`）、`src/js/app.js:151-154`（`REFRESH_OPTIONS = [3000, 10000, 30000]`）、`src/js/storage.js:227-234`（`refreshInterval` 允许值与默认 30000，且持久化）。
- **触发条件**：`state.limitUp.refreshInterval` 被设为与 `state.refreshInterval` 相同的值（`10000` 是涨停列表**首选项**、亦为行情刷新选项；`30000` 同时是涨停列表默认值与行情选项），再执行文档 §4.3 的沙盒与 `applyDataRefreshSchedule()` 路径。
- **实际行为与期望行为**：
  - 期望（`:418`）：该路径只产生「10000（行情轮询）+ 30000（涨停列表）」两个互异 `ms` 的定时器，可按 `ms === state.refreshInterval` 唯一选中行情轮询回调，`断言该定时器唯一且有效` 成立。
  - 实际（探针实测，真实 `monitorController` + 真实 `app.limitUpCtrl.startTimer()` + 文档原样 Map 沙盒）：默认 `limitUp=30000` 时 `ms-matches = 1`（唯一，OK）；但 `limitUp=10000` 时 `registered ms = [10000,10000]`、`ms-matches = 2`、`isPollCallbackUnique = false` —— 文档要求的「唯一」断言不成立。此时 `find()` 之所以仍取到行情轮询定时器，只是因为 `app.js:1515` 的 `applySchedule` 先于 `app.js:1525` 的 `startLimitUpTimer` 注册（**依赖注册顺序**），而非依赖可唯一辨识的键。
  - 期望修正后：选中依据必须是**身份/序号**（例如把 `monitorController` 注册时返回的 `timer` id 记录为被驱动对象），或按 round 13 修复建议方案 2 显式规定前置条件（驱动前 `state.limitUp.autoRefreshEnabled = false` / 先 `limitUpCtrl.stopTimer()`），使该路径只产生一个定时器。
- **根因**：本轮把 round 13 的「单槽覆盖」缺陷改为「按 id 建表」是正确的一半；但**选中键仍是数值 `ms`**，而「涨停列表刷新间隔」是与「行情刷新间隔」取值域重叠、且用户可持久化设置的量 → 同一执行路径可能注册两个同 `ms` 定时器。与 round 13 P2-1（「拦截到的到底是哪一个」）属同一缺陷族：可观测量的选取必须是身份型而非值型。
- **影响范围**：仅限 §4.3 用例 7 的测试契约（本轮无代码、无用例落地，故无运行期影响）。若按文档逐字实现，在 `limit_up_settings.refreshInterval = 10000`（或行情与涨停列表同为 `30000`）的配置下，用例 7(b) 的「唯一」断言会**假失败**；若实现者为了让它通过而删掉唯一断言，则 round 13 P2-1 想恢复的「精准选中」保证又退回「依赖注册顺序」的隐式假设。
- **复现方法/验证证据**（仓库外探针，`%TEMP%/mvaprobe14/probe.cjs`，未入库；固定时钟 `2026-09-14 10:00+08:00`、`state.tradingDates=['2026-09-10','2026-09-11','2026-09-14']`、文档 §4.3 原样 Map 沙盒）：
  ```
  node <探针>
  (a) limitUp=30000 (default): registered ms = [10000,30000] | ms-matches = 1 | find() picked ms=10000 | isPollCallbackUnique=true
  (b) limitUp=10000 (legal: LIMIT_UP_REFRESH_OPTIONS[0]): registered ms = [10000,10000] | ms-matches = 2 | find() picked ms=10000 | isPollCallbackUnique=false
  ```
  同探针另复核 A 系列（真实 `applyLiveQuoteToKline`）：`{price:21}`→`len=2`（覆写，末柱 `2026-09-11` 收 21）、`{price:21,date:'2026-09-11'}`→`len=2`（覆写）、`{price:21,quoteDate:'20260914'}`→`len=3`（追加 `2026-09-14`）、`{price:21,date:'2026-09-14'}`→`len=3`，与 §2.3 表 A1/A2/A3 的 `len`/末柱字段一致（**P3-2 主项已闭环**）。
- **修复建议**：二选一 ——（1）选中键改为身份型：在沙盒中对 `monitorController` 的注册单独留存 id（如按调用序号取 `registeredTimers` 中**首个** `ms === state.refreshInterval` 的条目并同时断言「同 ms 条目数 ≥ 1 且该条目在 `applySchedule` 之后、`startLimitUpTimer` 之前产生」），或直接在文档中规定「以 `app.js:1515` 调用后新产生的 id 为准」；（2）沿用 round 13 修复建议方案 2：在驱动前显式 `state.limitUp.autoRefreshEnabled = false`（或先 `limitUpCtrl.stopTimer()`），并把 `state.limitUp.refreshInterval` 与 `state.refreshInterval` 同值的边界写入 §4.3 的前置条件说明。同时把 `:418` 的 `（ms = 30000）` 补注为「默认值；`state.limitUp.refreshInterval` 可取 `10000/30000/60000`，与行情刷新间隔同值时需按上述方式区分」。
- **修复后验收标准**：§4.3 的选中规则在 `state.limitUp.refreshInterval ∈ {10000, 30000, 60000}` 且 `state.refreshInterval ∈ {3000, 10000, 30000}` 的**全组合**下，都能唯一、可复现地取到由 `app.js:1515` 注册的行情轮询回调（身份型或显式前置条件二者之一），不再依赖「两定时器 `ms` 互异」或「注册先后顺序」的隐含假设；文档不再出现「`（ms = 30000）`」式未带取值条件的定值断言。

## 三、待确认风险与未验证项

1. **未验证（环境限制，沿用前轮）**：§4.3 的 8 个用例**均未实现**，其可行性仅经静态契约核对与定点探针验证；`resolveLiveFallbackDate`、`getRefreshCodes()` 的 `expandedCodes` 合流、`_internal()` 扩展（`monitorCtrl`/`applyDataRefreshSchedule`）、`pollTimerAlive` 字段**均未落地**；端到端「展开 → 追加今日蜡烛」未在真实浏览器/真实定时器环境下执行；本机离线，未做真实行情验证。
2. **未验证（本轮环境限制）**：本轮仅复跑 QUnit（`814/814`）与本机 Node 探针，未执行 `npm run lint` / `npm run build` / Playwright E2E（本轮无代码改动，风险较低）。
3. **待确认风险（`STATUS.md` 同类历史记录）**：`STATUS.md:119`（round 10 闭环段）仍写「在 `app.js:1607` 路由切换处移除 `stopMonitorTimer()`（……保留后台全局共享行情轮询），消除虚构变量风险」，与后续各轮「`app.js:1607` 属可选清理、其效果被行 1613 覆盖」的定论并存。该句**不构成** round 13 点名禁止的「`1607 ⇒ timerCount` 变化」断言（故未按缺陷计入），但同属「历史段保留已被后续结论取代的表述」。**建议**：修复 P3-1 时一并确认该类历史段是否需要加注「后续已修正」，或按 round 12/13 的做法统一收敛。
4. **残余风险（沿用 round 11/12/13 §三）**：方案要求 `#/limit-up` 期间保持后台轮询，会使 `onQuotes`（`app.js:1464-1468` 的 `mergeQuotesIntoMomentumItems` / `processAlerts` / `updateChartLastTickMulti`）与 `onRefresh` 被更频繁触发；语音告警 `processAlerts` 在涨停页期间的重复播报行为仍未做端到端验证（需浏览器 + 真实行情）。
5. **待确认风险（沿用 round 13）**：`tencent-legacy` 1m 缓存当日实际 Bar 数为 240 还是 241/243，本机离线无法从真实响应取证；本轮 P3-3 的核对按文档内部算式（`min(240, 320-243)=77`）完成，不依赖线上实测。

## 四、推荐修复顺序与复审验收标准

1. **先修 P3-2**（唯一影响 §4.3 测试契约可执行性与 round 13 P2-1 闭环强度的缺陷）：把 §4.3 的选中键由数值 `ms` 改为身份型（或写入「先停用涨停列表定时器」的前置条件），并补齐 `:418` 的 `state.limitUp.refreshInterval` 取值条件。
2. **再修 P3-1**：把 `STATUS.md:57` 的引文还原为 round 12 的真实产出（`恒 ≥80`）并加注后续闭环归属，使其与 `STATUS.md:25` 不再互斥。
3. **顺带确认** §三.3（`STATUS.md:119`）的历史段处置方式，避免同类问题在下一轮以 P3 形式再次出现。
4. **复审验收标准（全部须满足）**：
   - §4.3 的沙盒在 `state.limitUp.refreshInterval × state.refreshInterval` 全组合下均能唯一、确定地取到 `app.js:1515` 注册的行情轮询回调，不再依赖 `ms` 互异或注册顺序；`app.js:1515 → !hasLimitUpRoot` 变异下 (a)(b) 仍确定性失败；(c) 步驱动 `fetchQuotes` 批次含 `sh600777`；
   - `STATUS.md` 中所有「某轮改了什么」的引述均可由 `git show <该轮 HEAD>:<文件>` 逐字复核，且同一修复动作的归属在各 round 段之间唯一、不互斥；全文不存在「100%/完全对齐」类未量化全称结论；
   - §2.3 表 A1~A3 与 §4.2 的 A1~A3 在同一标签下逐字段一致（数据源 / `targetDate` / `len` / 末柱结果）—— 本轮已实测确认 `len` 与末柱字段一致，复审时仅需确认未被新改动破坏；
   - 全文保留根数表述在 `x ∈ [0, 243]` 全区间内与写明的公式及前提自洽，无未带条件的「恒/始终」型下界；
   - `npm test` 复跑仍为 **814/814**；本轮复审 diff 仍只含文档类改动（`git diff --stat` 不含 `src/`、`server/`、`tests/`）。
