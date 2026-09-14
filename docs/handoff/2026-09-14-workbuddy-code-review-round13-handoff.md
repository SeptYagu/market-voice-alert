# WorkBuddy 独立代码审查 round 13 交接（涨停看板历史日期图表修复方案）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`c3f5bc0`；基准 `f48e592`；实际审查范围 `git diff f48e592..c3f5bc0 --numstat` = 8 文件 / +1139 / -22（`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9/10/11/12 审查报告、`docs/handoff/INDEX.md`），**全为文档类改动，无产品代码与测试改动**；本轮相对 round 12 HEAD `7b34bc5` 的增量 = 4 文件 / +191 / -17；`git pull --ff-only` = `Already up to date`，工作区干净。
- 通过项简述：round 12 的 P3-1 主项（`:23` mermaid 节 F、`:68` T-2、`:135` §3 复述）已按 `min(240,320-x)`/`max(0,80-x)` 改正并经全天算术复算通过；P3-2 已在 §4.3:468 删除 `app.js:1607` 变异分支并在 §4.2:286/§4.4:478 降级为可选清理；P3-3 的 §2.3 表 A1 行已按 `loadKline`/`applyLiveTick` 两路径拆列（`'2026-09-11'` / `null`），与代码一致；P3-4 的 `pollTimerAlive: timer !== null` 已在 §4.2 改动点 5 定义并被用例 7(a) 采用。抽查 30+ 处代码锚点（`app.js:414-419/952/1306/1324/1354-1358/1440-1454/1455/1508-1515/1542/1602-1614/1645-1647`、`monitorController.js:14-22/17/44/50/73-90/139-140`、`chartRowController.js:108-116/135/380-390/397-399/445/491-503/533-539`、`kline.js:194/200/402/409-420/439-453`、`api.js:150-176/161/172/415`、`parser.js:64/82/93-127`、`intradayService.js:24-27/179-194/203/214/215/261`、`klineService.js:40/48/86-122`、`marketSession.js:132`、`tradeCalendar.js:106/118`、`limitUpController.js:259/411/438/564-567`、`momentumController.js:141/152`、`tests/_jsdom-setup.cjs:14-21/22-27`、`tests/chartRequestOwnership.test.js:6-8`）**逐条与 HEAD 一致**；`npm test` 实跑 **814/814 通过（0 失败）**；`package.json` 确无 `sinon`/`@sinonjs/fake-timers`。
- 独立验证：以仓库外探针（真实 `monitorController.js` + 真实 `app.js` 单例 + 文档 §4.3 原样沙盒 + 固定时钟 `2026-09-14 10:00+08:00`）回放用例 7 执行路径，命中一项新缺陷（P2-1）；另复跑 `app.js:1607→1613` 序列与 `1515` 变异探针（1607 为 no-op、1515 可证伪，与 round 12 结论一致）。**判定：未通过。**

## 二、审查发现与缺陷清单

### P2（中）§4.3 的受控定时器沙盒在用例 7 真实执行路径下捕获到「涨停列表定时器」回调，步骤 (b) 按文档实现必然失败

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:417-440`（§4.3 定时器沙盒契约，单槽 `capturedIntervalCallback`）、`:466`（用例 7 (b) 步）、`:468`（变异证伪性保证）；对照代码 `src/js/app.js:1515`（`monitorCtrl.applySchedule(...)`）与 `src/js/app.js:1517-1531`（同一函数内紧随其后的 `startLimitUpTimer({ immediate: wasPaused })`）、`src/js/controllers/limitUpController.js:438`（`lu.timer = setInterval(() => { limitUpFetch(); }, interval);`）、`src/js/controllers/monitorController.js:5/86`（`timers = globalThis` → 属性在调用时查找）。
- **触发条件**：按文档实现用例 7 —— 固定时钟 `2026-09-14 10:00+08:00`、注入交易日历后 `limitUpCtrl.setRootEl(container)`（`hasLimitUpRoot = true`）→ 执行 `_internal().applyDataRefreshSchedule()` → 执行捕获的 `capturedIntervalCallback()`。此时 `state.limitUp.autoRefreshEnabled` 默认 `true`（`app.js:341`）、`isDataAutoRefreshAllowedNow()` 于盘中返回 `true`，`app.js:1525` 必然调用 `startLimitUpTimer`。
- **实际行为与期望行为**：
  - 期望（`:440`、`:466`）：沙盒「记录回调函数与刷新间隔」后，`capturedIntervalCallback()` 即**监控轮询回调**，执行它可由内部定时器自动触发 `fetchQuotes`（请求批次含 `sh600777`）。
  - 实际：`applyDataRefreshSchedule()` 在同一次调用中**连续注册两个 `setInterval`** —— 先 `monitorController.js:86` 的轮询定时器（`10000ms`），后 `limitUpController.js:438` 的涨停列表定时器（`30000ms`）；文档沙盒为**单槽覆盖写**，且对每次调用都返回同一 `id = 1001`，因此 `capturedIntervalCallback` 最终指向**涨停列表回调 `() => limitUpFetch()`**，`capturedIntervalMs = 30000`。执行它只会走 `limitUpFetch()`（在既有 harness 下还会撞上 `tests/_jsdom-setup.cjs:22-27` 的 `Unexpected network request`），**绝不会调用 `fetchQuotes`** → 步骤 (b) 在**修复后的正确代码上也会失败**。
  - 次生问题：两次 `setInterval` 均返回 `1001`，使 `clearInterval(1001)` 无法区分两个定时器；任一方的 `stopTimer()/stopLimitUpTimer()` 都会把同一槽位清空，(a)(b) 两步的观测因此互相耦合。
- **根因**：沙盒把「定时器回调」当作全局唯一量来捕获，而用例 7 的执行路径（`#/limit-up` 已挂载 + 盘中）必然同时存在监控轮询与涨停列表两个 `setInterval`；文档只核对了「mock 能否拦截 `globalThis.setInterval`」，未核对「拦截到的到底是哪一个」。
- **影响范围**：直接命中本轮验收标准第 4 条（「§4.3 用例 7 给出……受控定时器沙盒」）与 round 12 P3-4 的「可实际执行、不污染其他用例」要求；用例 7 是 round 11 P2（调度层保活）唯一的闭环证据，其 (b) 步不可用将使调度层保活重新失去端到端验证。不影响 (a) 步的可证伪性（`pollTimerAlive` 读取的是 `monitorController` 内部 `timer`，探针实测 `applySchedule(true,false)` → `timerCount 0`、`applySchedule(true,true)` → `1`）。
- **复现方法/验证证据**（仓库外探针，`%TEMP%/mvaprobe/`，未入库）：
  ```
  node node_modules/qunit/bin/qunit.js --require ./tests/_jsdom-setup.cjs <探针>   # 真实 monitorController + 真实 app.js 单例
  PROBE intervals(ms)= 10000,30000 | captured.ms= 30000 | lu.timer= 1001
  # 执行文档的 capturedIntervalCallback() 实际进入涨停列表回调：
  TypeError: root.replaceChildren is not a function
      at renderLimitUpPage (limitUpView.js:769)
      at rerenderLimitUpPage (limitUpController.js:141)
      at limitUpFetch (limitUpController.js:231)
      at limitUpController.js:439        <-- 即被捕获的定时器回调
  ```
  （同探针中断言 `registered.length === 2`、`capturedIntervalCallback !== registered[0].fn`、`capturedIntervalMs === 30000` 均成立。）
- **修复建议**：把沙盒改为**按 id 记录**而非单槽覆盖，并显式指定驱动对象，二选一 ——
  1. `const timers = new Map(); globalThis.setInterval = (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; };` 驱动时取 `[...timers.values()].find(t => t.ms === state.refreshInterval).fn`（并断言该条唯一）；
  2. 保留单槽，但在 `applyDataRefreshSchedule()` 之前显式 `state.limitUp.autoRefreshEnabled = false`（或先 `limitUpCtrl.stopTimer()`），使该路径只产生监控轮询一个 `setInterval`，并在文档中写明该前置条件。
  同时删除 `:466` 中残留的「推进时间 $\ge state.refreshInterval$」表述（本仓库无 fake timers，只有手动触发回调），并把 `clearInterval` 的还原/隔离责任写成按 id 精确匹配。
- **修复后验收标准**：按 §4.3 实现的用例 7 在**修复后代码上为绿**且在 `app.js:1515 → !hasLimitUpRoot` 变异下 (a)(b) 确定性失败；驱动 `fetchQuotes` 的回调可被唯一确定（按 `state.refreshInterval` 或等价判别式选中），不依赖「同一路径只注册一个定时器」的隐含假设；`afterEach` 还原后 `globalThis.setInterval/clearInterval` 与原始引用严格相等。

### P2（中）STATUS.md 新增的「历史状态：round 12 未通过」段保留 round 12 已证伪的 `app.js:1607` 变异断言与 Fake Timers 机制，标题与正文错配，与同文件顶部结论自相矛盾

- **文件与行号**：`STATUS.md:32`（段标题）、`:42`、`:43`、`:45`、`:49`；对照同文件顶部新增段 `STATUS.md:17-18`、`:30`；对照 `docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:468`（1607 分支已删除）；对照 round 12 报告 `docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md:52`（修复建议 ③）。
- **触发条件**：阅读 `STATUS.md`；或按 `STATUS.md:43` 的指引设计变异实验。
- **实际行为与期望行为**：
  - 实际：
    1. `STATUS.md:43`：「若将 `app.js:1515` 变异回退为 `!hasLimitUpRoot` **或恢复 `app.js:1607` 的 `stopMonitorTimer()`**，则 `timerCount === 0`，推进时钟绝不触发 `fetchQuotes`，断言确定性失败」。round 12 已实测证伪：`app.js:1607` 与 `app.js:1613` 在同一路由处理函数内连续执行，`stopTimer()` 置 `interval = null`（`monitorController.js:76`）后 `applySchedule(allowed, true)` 必定命中 `interval !== state.refreshInterval`（`:83-86`）重建定时器 —— 本轮独立探针复现：`applySchedule(true,true)` → `timerCount 1` → `stopTimer()` → `0` → 再 `applySchedule(true,true)` → **1**，即该变异为**行为 no-op**，不可能使断言失败。round 12 修复建议 ③ 明确要求「`STATUS.md` 同步修正，不得再声称该分支可致 `timerCount === 0`」，**未落实**。
    2. `STATUS.md:42`：「规定必须完全依托 Fake Timers 推进虚拟时钟（推进时间 ≥ `state.refreshInterval`）」。本仓库 `devDependencies` 无任何 fake timers 依赖（已核 `package.json`），且正文 `:417` 已改为自闭环受控沙盒 —— `STATUS.md` 仍以 Fake Timers 为闭环依据。
    3. `STATUS.md:49` 仍写 §2.2 保留根数与公式「**完全对齐**」；`:45` 仍写「在 **§4.2:277** 澄清……」（正文对应段实为 `:276`，见 P3-1）。
    4. 段标题 `:32`「历史状态：WorkBuddy 独立审查 round 12（……）**未通过** —— P3×4」，但其正文（`:34-53`）是**round 11 闭环叙事**（「针对 round 11 独立审查报告指出的 1 项 P2 阻塞缺陷与 4 项 P3……」），且 `:35` 链接的是 round 11 报告；round 12 的实际 P3×4（保留根数残留 / 1607 变异不可证伪 / A1 行 targetDate / Fake Timers 缺失）在 `STATUS.md` 中**没有任何记录**。同文件其余「round N 未通过」段均按「round N 的审查报告摘要」撰写，此段与全局体例不一致。
  - 期望：round 12 的修复要求与同文件顶部 `:17-18`（「彻底移除 `app.js:1607` 变异分支」「`pollTimerAlive` 排除 checker 干扰」）逐条一致；`STATUS.md` 各处不得再出现已被证伪的机制性断言；每个「round N」段的标题与其正文/链接自洽。
- **根因**：本轮只把 round 11 闭环段整体下移并改写标题为「历史状态：round 12 未通过」，未按其新语义重写正文，也未执行 round 12 点名要求的 `STATUS.md` 同步修正（与「同一命题的其余表述未做一致性扫描」同族）。
- **影响范围**：`STATUS.md` 是外部读者判断项目状态的首要入口；该段同时构成「与正文矛盾」（P3-2 已删的变异分支在此仍被宣称可致失败）与「与自身矛盾」（顶部声称已移除、下方仍保留），会让后续实现者按已证伪的分支编写必然失败的变异实验。不影响产品代码与测试（本轮无代码改动）。
- **复现方法/验证证据**：
  - 文本比对：`git show 7b34bc5:STATUS.md | sed -n '1,15p'` 与 `STATUS.md:32-53` —— 正文逐字未改，仅标题行被替换；
  - 机制复现（仓库外探针 v3）：`applySchedule(true,false)` → `timerCount 0`；`applySchedule(true,true)` → `1`；`stopTimer()` → `0`；`applySchedule(true,true)` → `1`（`ok 1`，全断言通过）；
  - 依赖核对：`node -e "require('./package.json').devDependencies"` 无 `sinon`/`@sinonjs/fake-timers`；
  - 行号核对：`grep -n "全站向" docs/handoff/2026-09-14-…-handoff.md` → `276`。
- **修复建议**：① 删除 `STATUS.md:43` 中「或恢复 `app.js:1607` 的 `stopMonitorTimer()`……`timerCount === 0`……」整段分支，只保留 `app.js:1515 → !hasLimitUpRoot` 这一条（与正文 `:468` 一致）；② 将 `:42` 的「Fake Timers」改为「受控 `globalThis.setInterval/clearInterval` 沙盒 + 手动触发捕获回调」；③ 将 `:49` 的「完全对齐」改为列举实际改写范围（§2 mermaid 节 F、§2.2 T-2、§3 复述）；④ 将 `:45` 的 `§4.2:277` 更正为 `§4.2:276`；⑤ 把 `:32-53` 重写为 round 12 的审查记录（P3×4 缺陷清单 + 链接 round 12 报告），或保留 round 11 闭环叙事但改回与正文相符的标题与链接。
- **修复后验收标准**：`STATUS.md` 中不存在任何声称 `app.js:1607` 变异会改变 `timerCount`/断言结果的表述；不存在 Fake Timers 依赖假设；每个「round N」段的标题、正文、链接三者互相自洽且与主文档结论一致。

### P3（低）「与 HEAD 100% 精准对齐」为过强结论，且被同文件 `§4.2:277` 锚点与 `INDEX.md` 摘要直接证伪

- **文件与行号**：`STATUS.md:30`（本轮新增，「全文代码引用、符号与行号经自动化脚本逐一校验，与 HEAD **100% 精准对齐**」；同句另见 `:57`、`:99`）、`STATUS.md:45`（`§4.2:277`）、`docs/handoff/INDEX.md:31`（investigation 文档摘要「（已闭环 **round 10** 缺陷）」）。
- **触发条件**：逐条核对 `STATUS.md` 摘要中引用的锚点。
- **实际行为与期望行为**：
  - 实际：正文中「全站向 `state.quotes` 写入报价实体的点」位于 `:276`（`grep -n "全站向" …` → `276`），而 `STATUS.md:45` 写作「在 §4.2:**277** 澄清」—— 锚点偏移 1 行，且正是 round 12 修复建议 ⑤ 点名要求更正的那一处（未落实）。据此「100% 精准对齐」不成立。
  - 同时 `INDEX.md:31` 的该文档摘要仍为「已闭环 round 10 缺陷」，而 `INDEX.md:7` 顶部速读与 `STATUS.md:3` 均已写「round 12 缺陷已全面闭环」——同一文档的摘要自相矛盾。
  - 期望：round 12 复审验收标准要求「`STATUS.md` 的闭环声称与文档正文逐条一致，不再出现『完全对齐』一类未覆盖全部同类表述的过强结论」；本轮把「完全对齐」换成了等价的「100% 精准对齐」，属同类过强结论的改写而非消除。
- **根因**：把「抽查通过」上升为「全文 100% 对齐」的全称断言，且未对本轮新增/下移段落中的同族锚点与摘要做横向扫描。
- **影响范围**：摘要性过强结论会掩盖真实的锚点漂移；不影响产品代码。
- **复现方法/验证证据**：`grep -n "全站向" docs/handoff/2026-09-14-…-handoff.md` → `276`；`grep -n "§4.2:277" STATUS.md` → `45`；`grep -n "已闭环 round" docs/handoff/INDEX.md` → `31`。
- **修复建议**：① 把 `§4.2:277` 更正为 `§4.2:276`（或直接引用小节名「§4.2 改造点四 问题现状 1」以避免行号漂移）；② 把「100% 精准对齐」降级为可核验的表述（如「本轮抽查的 N 处锚点均一致」，并注明 N 与核对方式）；③ 更新 `INDEX.md:31` 摘要为「已闭环至 round 12 缺陷」。
- **修复后验收标准**：`STATUS.md`/`INDEX.md` 全文无「100%/完全对齐/彻底」类未量化的全称通过声称；所有指向正文的锚点经 `grep -n` 复算一致。

### P3（低）§4.2 的 A1 实测对比条目未按调用路径同步，与已路径化的 §2.3 表 A1 给出不同中间量

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:213`（§4.2 改造点二「实测验证对比」A1 条）、对照 `:107`（§2.3 表 A1 行）、`:210`（问题现状 1）、`:211`（问题现状 2）；对照代码 `chartRowController.js:383`、`kline.js:409-412`。
- **触发条件**：以同一标签 A1（`{ price: 21.00 }`、`items` 末柱 `2026-09-11`）交叉核对 §2.3 表与 §4.2 清单。
- **实际行为与期望行为**：
  - 实际：`§2.3:107` 已按路径拆列 —— `loadKline` 路径 `targetDate = inst.selectedTradeDate = '2026-09-11'`、`applyLiveTick` 路径 `targetDate = null`；而 `§4.2:213` 仍以未加路径限定的形式写「A1 纯价格注入 `{ price: 21.00 }`：旧代码 **`targetDate = null`**」，未给出 `loadKline` 路径的 `'2026-09-11'`。同一标签 A1 在两处呈现不同中间量（`:213` 的表述在 `loadKline` 路径下为**假**）。
  - 期望：round 12 修复建议要求「§2.3 表 A1~A3 每条……与 §4.2 改造点二的 A1~A3 描述**逐字段吻合**」；本轮只改了 §2.3，§4.2 未同步。
- **根因**：与 round 12 P3-3 同源（「只在 `applyLiveTick` 路径成立的 `targetDate = null` 被写在同时描述两条路径的条目里」），本轮修复仅覆盖被点名的 §2.3 单元格，未对 §4.2 的同名条目做横向扫描。
- **影响范围**：`结论`（原地覆盖、`len = 2`、末柱被篡改）两处一致，不影响定性；但实现者若以 §4.2:213 为准编写用例 3/8 的前置断言，会得到与 §2.3 不同的中间量，构成验收依据的二义性。
- **复现方法/验证证据**：`awk 'NR>=212 && NR<=215' <doc>` 与 `awk 'NR==107' <doc>` 对照；代码事实 `chartRowController.js:383` 兜底链含 `inst.selectedTradeDate`，`kline.js:409-412` 的 `rawTargetDate` 为空时 `targetDate = null`。
- **修复建议**：把 `:213` 的 A1 条同样按两条路径拆列（`loadKline`：`'2026-09-11'` → `lastDate < targetDate` 为假 → 原地覆盖；`applyLiveTick`：`null` → 原地覆盖），或显式标注该条仅描述 `applyLiveTick` 路径并补上 `loadKline` 路径的对照。
- **修复后验收标准**：§2.3 表 A1~A3 与 §4.2 的 A1~A3 在同一标签下逐字段一致（数据源、`targetDate`、`len`、末柱结果四项均可一一对应）。

### P3（低）保留根数下界「恒 ≥80」未闭合，与 §2.2 自述的「241/243 根/日」前提冲突

- **文件与行号**：`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md:23`（§2 mermaid 节 F「`min(240, 320-x)` 根，**恒 ≥80**」）、`:135`（§3「收盘 $x=240$ 时仍有 80 根」）、`:71`（「恒保持在 80~240 根」）；对照 `:65`（「A 股每个常规交易日标准包含 240 根 1 分钟 Bar……**若腾讯等数据源计入 9:25 开盘集合竞价点则为 241/243 根**」）。
- **触发条件**：取文档自述允许的当日 Bar 数上界 `x = 243` 复算。
- **实际行为与期望行为**：
  - 实际：`min(240, 320 - 243) = 77 < 80`，故「恒 ≥80」与「收盘仍有 80 根」在 `x = 243` 时均不成立；文档自身在 `:65` 明确承认该数据源可能产生 241/243 根（同理 T-1 自身若为 243 根，公式应为 `min(243, 320-x)`）。
  - 期望：本轮验收标准要求「全文任一保留根数表述均可由 `min(240,320-x)`/`max(0,80-x)` 复算得出**无冲突**固定区间」—— 该两处表述与本段自述的前提存在冲突，未标注成立条件。
- **根因**：公式 `min(240, 320-x)` 隐含「T-1 恰有 240 根、当日 `x ≤ 240`」两个前提，而同一小节已声明 `241/243` 根的可能性；修复时按 round 12 建议原样写入「恒 ≥80」，未与本小节的 Bar 计数前提做闭合校验。
- **影响范围**：影响量化为「T-1 恒处于可合成伪分时覆盖带内」的下界（`x=243` 时为 77 根，主线结论仍成立）；不影响 `T-2 = max(0,80-x)` 与 `x ≥ 80` 滑出阈值（`x=243` 时 T-2 亦为 0）。属量化表述未闭合，非机制性错误。
- **复现方法/验证证据**：纯算术复算 `min(240,320-243)=77`、`max(0,80-243)=0`；源句 `:65` 与 `:23`/`:135` 对照（`grep -n "241/243\|恒 ≥80\|收盘 \$x=240\$" <doc>`）。
- **修复建议**：给两处补成立条件（如「在当日已生成 Bar 数 `x ≤ 240` 时 `min(240,320-x) ≥ 80`；若数据源计入集合竞价点使当日达 241/243 根，则 T-1 保留 `min(B_{T-1}, 320-x)` 根，收盘约为 77~79 根」），或把公式统一改写为 `min(B_{T-1}, 320-x)` 并注明 `B` 的取值来源。
- **修复后验收标准**：全文保留根数表述在 `x ∈ [0, 243]` 全区间内均与写明的公式及前提自洽，无未带条件的「恒/始终」型下界。

## 三、待确认风险与未验证项

1. **未验证（环境限制，沿用前轮）**：§4.3 的 8 个用例**均未实现**，其可行性仅经静态契约核对与定点探针验证；`resolveLiveFallbackDate`、`getRefreshCodes()` 合流、`_internal()` 扩展、`pollTimerAlive` 字段**均未落地**；端到端「展开 → 追加今日蜡烛」未在真实浏览器/真实定时器环境下执行。本机离线，未做真实行情验证。
2. **未验证（本轮环境限制）**：本轮仅复跑 QUnit（`814/814`），未执行 `npm run lint` / `npm run build` / Playwright E2E（本轮无代码改动，风险较低）。
3. **待确认风险（P2-1 的边界形态）**：若实现者按 §4.3 注释 2 统一接管 `globalThis.fetch` 响应全部端点，P2-1 的表现会从「触发 `limitUpFetch()` 并撞上 harness 致命断言」变为「`fetchQuotes` 批次断言失败」——两者都是红，但后者会掩盖「捕获到错误定时器」这一真因；修复时建议同时断言「按 `state.refreshInterval` 选中的回调唯一」以固定语义。
4. **残余风险（沿用 round 11/12 §三）**：方案要求 `#/limit-up` 期间保持后台轮询，会使 `onQuotes`（`app.js:1464-1468` 的 `mergeQuotesIntoMomentumItems` / `processAlerts` / `updateChartLastTickMulti`）与 `onRefresh` 被更频繁触发；语音告警 `processAlerts` 在涨停页期间的重复播报行为仍未做端到端验证（需浏览器 + 真实行情）。
5. **待确认风险（P3-3 的前提来源）**：`tencent-legacy` 1m 缓存当日实际 Bar 数为 240 还是 241/243，本机离线无法从真实响应取证；文档 `:65` 已把两种计数都写为可能，故 P3-3 按「文档内部两处表述冲突」定性，不依赖线上实测。

## 四、推荐修复顺序与复审验收标准

1. **先修 P2-1**（唯一影响本轮验收标准第 4 条、且直接决定用例 7 能否落地的缺陷）：把 §4.3 定时器沙盒改为按 id 记录并显式选中「`ms === state.refreshInterval`」的回调（或写明先停用涨停列表定时器的前置条件），删除 `:466` 的「推进时间 ≥ …」残留；同步在 `:409-440` 的接入说明中写清隔离与还原责任。
2. **再修 P2-2**：按 round 12 修复建议 ③ 删除 `STATUS.md:43` 的 `app.js:1607` 分支断言，替换 `:42` 的 Fake Timers 表述，并修正 `:32` 段标题/链接与其正文的语义错配（或按 round 12 记录重写该段）。
3. **再修 P3-1**：更正 `§4.2:277` → `:276`，把「100% 精准对齐」改为可核验表述，更新 `INDEX.md:31` 摘要。
4. **再修 P3-2**：把 §4.2:213 的 A1 条按 `loadKline`/`applyLiveTick` 两路径补齐，与 §2.3 A1 逐字段对齐。
5. **最后修 P3-3**：为「恒 ≥80」等三处补成立条件或统一公式为 `min(B_{T-1}, 320-x)`。
6. **复审验收标准（全部须满足）**：
   - §4.3 的定时器沙盒能唯一确定监控轮询回调，(a)(b) 步在修复后代码为绿、在 `app.js:1515 → !hasLimitUpRoot` 变异下确定性失败；全文不再出现 Fake Timers 依赖表述；
   - 全文每一条「变异后用例必须失败」的断言均为代码路径可观测，`app.js:1607` 分支已在正文与 `STATUS.md` 中一致地按事实处置（删除或说明其为 no-op）；
   - §2.3 表 A1~A3 与 §4.2 的 A1~A3 在同一标签下逐字段一致（数据源 / `targetDate` / `len` / 末柱结果）；
   - 全文保留根数表述在 `x ∈ [0, 243]` 全区间内与写明的公式自洽，无未带条件的「恒/始终」型下界；
   - `STATUS.md` 每个「round N」段的标题、正文、链接自洽，且不再出现「100%/完全对齐」类未量化全称结论；`INDEX.md` 摘要与 `STATUS.md` 一致；
   - `npm test` 复跑仍为 **814/814**；本轮复审 diff 仍只含文档类改动（`git diff --stat` 不含 `src/`、`server/`、`tests/`）。
