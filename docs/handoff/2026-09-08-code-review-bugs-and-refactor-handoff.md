# 2026-09-08 代码审查：功能缺陷、验证结果与重构交接

## 1. 接手结论

- 审查基线：`main`，`9cd782ee1183df385592dd83104495bbd0580bcc`。按 AGENTS.md 执行 `git pull`，远端已同步；开始时工作区干净。
- 本次交付是审查报告和复现脚本，**没有修改业务代码，没有修复下列问题**。
- 发现 **7 项功能缺陷（2 项 P1、5 项 P2）和 2 项工程验证问题（P2）**。没有证据支持整体推倒重写；需要围绕异步任务归属、行情视图一致性和交易会话做局部重构。
- 上轮 handoff 的“没有 Major”不能直接沿用到当前版本；本轮还核验了最近三次语音相关提交。旧报告中 root 引用、代理上限文档、测试重导出等遗留项已有修复，不重复计数。
- 优先处理 R1/R2/R3，再做 R4/R5/R6/R7；同时修复 T1/T2，才能建立可靠的合并门禁。

P1：核心展示或功能在普通使用情形下错误，应优先修复。P2：条件触发的错误、交互失效或质量门禁问题。

## 2. 审查范围与证据边界

重点追踪了：最新语音去重与收盘提醒、app 语音调度、涨停控制器/分组/视图、动量控制器与扫描服务、图表控制器与 API 缓存、服务端缓存与动量任务、代理、期货分时与会话，以及对应测试和运行配置。

本次是关键业务链路审查，不宣称全仓每一行均已覆盖；未进行长时间真实交易时段 UI 观察，也未以外部行情服务的即时结果判定金融规则正确性。期货会话问题依据项目自己的合约元数据和注入日历复现，报告不依赖对外部交易所规则的猜测。

配套脚本：[`2026-09-08-review-repro.mjs`](2026-09-08-review-repro.mjs)。在项目根目录运行：

```powershell
node docs/handoff/2026-09-08-review-repro.mjs
```

该脚本加载真实模块，通过 jsdom、内存 localStorage、人工输入和 fetch stub 复现，不请求市场接口。它是诊断脚本，当前输出错误行为时仍以 0 退出，**不能作为已通过的回归测试**。实施修复时应把场景转成“断言正确结果”的正式测试。

## 3. 功能缺陷与修复方案

### R1 [P2] 语音去重覆盖历史字段，静止行情仍反复播报

**位置**：`src/js/app.js:1255`；`src/js/tts.js:154-176`。

`formatQuoteSpeechDelta` 有意只返回本轮实际播报的 `spoken` 字段，但调用方用 `voiceLastSpoken.set(code, spoken)` 替换整个历史对象。例如先完整播报，随后只有价格字段变化，新的记忆仅剩 price；下一轮误以为 percent 从未播报，再下一轮又误以为 price 从未播报。

**复现输出**（诊断输入用于隔离字段变化，不代表真实报价快照）：

```text
10 / 1 -> 测试股，10.00 元，涨 1.00
11 / 1 -> 测试股，11.00 元
11 / 1 -> 测试股，涨 1.00
11 / 1 -> 测试股，11.00 元
```

**影响**：最新提交承诺的去重失效；单字段变化后即使两个字段均不再变化，播报仍交替持续。

**最小修复**：调用方合并旧记录与本次增量：

```js
state.voiceLastSpoken.set(code, {
  ...state.voiceLastSpoken.get(code),
  ...spoken
});
```

保留开启/重启清空记忆与退订清理的现有语义。不要把尚未播报的字段直接当作已播报。

**验收**：完整→仅价格变化→两轮不变；完整→仅涨跌幅变化→两轮不变；关闭并重新开启字段；手动播报后自动播报。末尾两轮必须为空，且测试要经过调用方记忆回写，不能仅孤立测试 formatter。

### R2 [P1] 语音定时调度忽略期货夜盘，与即时放行逻辑相互冲突

**位置**：`src/js/app.js:1224-1232`、`:1336-1353`，以及 `startVoiceScheduleChecker()`。

`isVoiceAllowedNow()` 对订阅期货且期货开市的情形返回 true；`applyVoiceSchedule()` 却仅通过股票 `getVoiceSession()` 和 `isVoiceAllowedInSession()` 决定暂停。默认自动收盘配置下，夜盘仍被归为股票 after-close，检查器停止语音、cancel 队列，甚至把 `voice.enabled` 写回 false。

**证据**：固定北京时间 `2026-09-08 21:10`，现有策略函数返回 `futuresOpen=true`、`scheduleAllowed=false`。源码完整显示这两个结论分别控制启动/播报与周期停用。本轮未等待真实夜盘做浏览器实播。

**触发**：订阅 rb0，启用默认智能调度，在夜盘开启语音；下一次调度检查会按股票收盘停掉语音。国债等收盘晚于股票的合约也应纳入边界回归。

**最小修复**：调度器与播报入口共用同一允许策略；存在正在交易的已订阅合约时，股票收盘不得触发全局禁用。收盘提醒应绑定实际暂停的会话。

**完整方案**：抽取按标的判断的会话策略。先判断每个订阅标的，再聚合是否需要运行定时器；播报循环只读取对应允许的标的，避免“只要有一个期货开市，就放行所有股票”。将用户手动开关与按时段暂停分开保存，保留现有股票自动启停选项的明确行为。

**验收**：冻结时钟覆盖股票午休/15:00、国债延后收盘、rb 夜盘、无夜盘金融期货、股票与期货混合订阅。夜盘运行检查器后仍能播报有效合约，手动关闭不能被无关会话自动覆盖。

### R3 [P1] 涨停局部刷新只改数字，不更新分组与排序

**位置**：`src/js/controllers/limitUpController.js:125-182`，特别是 `:133`；`src/js/limitUpView.js:302-350`。

控制器重新计算了 `lu.groups`，但 `patchLimitUpQuoteCells()` 只验证行数、代码是否存在。代码集合不变时直接 patch 单元格并返回 true，未检查股票属于哪个分组，也不移动排序位置或修改分组人数。

**实测**：单只首板股涨幅从 10% 降到 5% 后，`stateGroup="broken"`，DOM 仍为 `domGroup="1"`，只把涨幅改成 `+5.00%`。

**影响**：炸板仍显示在首板/连板组，回封后仍留在炸板组；按成交额/涨幅等排序的 DOM 与数据排序不一致；分组人数和内容可能矛盾。只有全量重绘或成员集合变化后才恢复。

**短期修复**：patch 前比较每组有序 code 序列与当前 DOM，任何组归属/顺序变化均返回 false，交由现有全量重绘恢复正确性。这可能重新挂载图表，应明确作为过渡方案。

**重构方案**：按 code 维护行和相邻图表行的映射，按 group key 维护容器。结构更新时移动现有节点、更新人数，新增/删除才创建/销毁；仅报价变化时 patch 单元格。行移动时同时移动图表行，保留图表实例和可视区。

**验收**：同集合炸板/回封、连板分桶更新、组内排序反转、空组变非空、删除已展开标的。断言 DOM 所属组、有序 code 和人数与 state 一致；重构版还应断言存活标的图表实例未被销毁。

### R4 [P2] 涨停看板“重新加载”未传 force，仍可读旧缓存

**位置**：`src/js/controllers/limitUpController.js:657-670`、`:684-685`。

`_handleLimitUpForceReloadChart()` 清空页面图表数据后调用 `loadLimitUpKline(code)`，后者仅调用 manager 的 `loadKline(code)`。manager 默认 `force=false`，没有走已实现的 noCache/forceRefresh 路径。

**实测**：对真实控制器调用 `handleForceReloadChart('sh600000')`，manager 收到的参数只有 `["sh600000"]`。

**修复**：让包装器透传 options，并在重新加载入口调用 `loadLimitUpKline(code, { force: true })`；或直接复用 manager 方法，删除重复重置逻辑。进一步核验 `api.js` 的 in-flight key：当前相同 code/period 的普通请求可被强制请求复用，需要明确强制请求是否允许等待该请求，若不允许则区分请求策略，并用 promise 身份检查清理 Map。

**验收**：预置旧缓存，点击按钮后断言实际请求路径和返回的新数据；再覆盖已有普通请求未完成时的强制重载。仅断言 Canvas 存在无法证明重载生效。

### R5 [P2] 停止后立即重启扫描，旧任务 finally 清除新任务 loading

**位置**：`src/js/controllers/momentumController.js:145-249`，尤其 `:245-246`。

只有 `mState.abort = null` 被身份判断保护，紧接着的 `mState.loading = false` 和重新渲染不受保护；catch 中 `serverScanning=false` 也没有任务归属校验。

**实测顺序**：启动 A（等待 POST）→ stopScan abort A → 同步启动 B → 等待 A 的 catch/finally。输出 `newRequestStillActive=true, loading=false`，B 仍在请求但 UI/互斥标志已被 A 清除。

**影响**：新扫描显示为未加载，可以再次触发扫描；旧任务可能改写进度和轮询状态。只保护 abort 引用不足以保证整体生命周期正确。

**修复**：每次扫描分配 generation 或捕获 controller，以 `isCurrent()` 守卫所有 await 后的状态提交、catch、finally、轮询安排和本地 worker 进度写入。stop 时先使当前 generation 失效，再取消请求与定时器。finally 整段仅由当前任务执行；不要在 finally 中 return，以免改变异常/返回值语义。

**验收**：用 deferred fetch 精确控制 A/B 完成顺序；旧任务 abort、失败、成功均不得修改 B 的 loading/error/items/scanned/serverScanning，且只能存在一个当前轮询计时器。

### R6 [P2] 图表响应仅在 finally 校验实例，旧结果已写入新图表

**位置**：`src/js/controllers/chartRowController.js:317-374`、`:378-420`；核心写入位于 `:337-338` 和 `:400-401`。

success/catch 只检查 `isExpanded(code)`。同一代码重新展开后它仍为 true，旧请求会持有旧 inst，却从当前 ctl Map 找到新图表并写入。finally 的 `getInst(code) === inst` 才做检查已经太晚。同一实例切换周期/日期还需要请求身份保护，仅比较实例不够。

**实测**：预置 localStorage K 线命中，启动旧实例 loadKline，在 Promise continuation 之前替换成新实例。旧响应向当前 controller 调用 `setKline` 一次，而新实例 `klineData` 仍为空：`chartWrites=1, newInstanceHasData=false`。此用例模拟响应已完成、取消来不及阻止 continuation 的边界。

**修复**：捕获 `inst`、本次 controller、period/date，提交前同时检查：仍展开、实例相同、请求 controller 相同且未 aborted、周期/日期仍匹配。成功写状态/绘图、错误写状态、finally 通知都使用同一守卫。K 线与分时各自维护独立 generation，销毁时失效。

**验收**：旧请求先开始后完成；折叠重开同 code；连续切换周期；快速点击两个日期；立即缓存命中后销毁；新请求进行中旧 AbortError 不应清除其 loading。断言 controller 实际接收到的数据和 state 一致，而不只检查 Map 中保存哪个 inst。

### R7 [P2] 服务端期货会话忽略部分合约收盘点和夜盘日历约束

**位置**：`server/futures/futuresSessionService.js:77-113`。

当晚分支 `timeMin >= 21 * 60 && timeMin < 24 * 60` 对所有有夜盘的品种放行；计算出的 `endMin` 仅用在凌晨分支。项目元数据中 RB0 的 `nightSessionEnd` 为 23:00，23:30 却仍返回 `isTrading:true`。另外，当晚未像前端一样校验节前日历间隔，凌晨分支未核对前一个自然日是否允许开夜盘。

**实测**：

```text
RB0 元数据 declaredEnd=23:00；2026-09-08 23:30 服务端 isTrading=true
人工日历 [2026-09-08, 2026-09-10]，09-08 21:10：frontend=false，backend=true
```

第二例为注入日历的一致性测试，不声称现实中 09-09 是休市日。

**影响**：服务端错误选择盘中刷新 TTL/实时合成逻辑，前后端对会话和交易日的判断不一致；会话状态不能可靠指导语音和图表。

**修复**：当晚分支应用 `Math.min(endMin, 24 * 60)`；抽取夜盘可开市的日历判断，凌晨续段必须验证前一自然日对应的夜盘许可。随后用共享纯会话模块替换前后端重复逻辑，保留合约属性，而非统一放宽为“任意期货可能开市”。

**验收**：元数据中的 23:00/01:00/02:30 三类收盘点及之后一分钟；周六凌晨、周一凌晨；节前/节后第一天；无夜盘合约。对相同 instrument/now/calendar，前后端必须产生同一业务结论。

## 4. 工程验证问题

### T1 [P2] 单元测试依赖实时网络、运行日期和已有缓存，不能稳定作为 CI 门禁

**位置**：`tests/futuresServices.test.js:7-55`、`:145` 附近周/月 K 测试。

这些测试直接调用真实服务，没有固定时间或隔离 cache root，也没有为相关网络响应设置 fixture。默认 `getCachedFuturesIntraday('RB0')` 查询“当前会话交易日”，随后无条件断言非空。上游失败、当前日期数据尚未产生或本地缓存变化，都可以影响结果。

本轮第一次完整测试是 669/670 通过，失败为 `Failed to fetch futures minute kline for RB0`。获准联网复跑该文件后是 9/10 通过，同一个用例改为返回空 bars，非空及均价断言失败。**不能据此断言生产分时解析必然有 bug，也不能记录为测试全绿。**

另一个覆盖缺口：`:60`、`:89` 等“解析测试”在测试代码中复制正则和字段映射，没有经过生产解析入口；它们通过不能证明生产 fallback 没有回归。

**方案**：单元测试注入固定 now、独立临时 cache root 与受控 fetch；用已有 futures fixtures 调用生产 parser/service，禁止意外外网请求。真实联网检查移至显式的 integration 命令，注明 AKTools/网络/数据日期前置条件，输出 source/stale/targetTradingDay/返回区间诊断信息。失败清理临时缓存，绝不能删除用户的 `data/cache` 来“重置测试”。

### T2 [P2] E2E 启动命令绑定 PowerShell，并触发本机 npm.ps1 执行策略错误

**位置**：`playwright.config.js:23`。

原命令启动失败，提示 `npm.ps1 cannot be loaded because running scripts is disabled`。这发生在测试浏览器启动之前，不是 57 个用例失败。配置还依赖系统具备 powershell，不利于非 Windows CI。

**本轮验证方式**：没有修改机器策略；在独立进程设置 `DISABLE_BACKGROUND_JOBS=1`，直接运行 `node node_modules/vite/bin/vite.js --host 127.0.0.1`，让 Playwright 复用该服务。随后 E2E **57/57 通过，58.9 秒**。

**修复方案**：使用 Node 启动入口，或在 Playwright webServer 配置中通过 env 注入 `DISABLE_BACKGROUND_JOBS`，command 直接调用 Node/Vite。保留关闭真实后台扫描的要求，不需要改变用户机器执行策略。

## 5. 实际质量结果

| 检查 | 本轮结果 | 说明 |
| --- | --- | --- |
| git pull | 已同步 | 基线 9cd782e |
| lint | 通过 | 完整 ci 首阶段完成 |
| QUnit 全量 | 669 pass / 1 fail | 670 项；期货分时数据请求失败 |
| 期货文件联网复跑 | 9 pass / 1 fail | 同一分时用例得到空数据 |
| E2E 原命令 | 启动失败 | PowerShell npm.ps1 策略阻止 |
| E2E 直接启动 Vite 后 | 57/57 通过 | 使用仓库现有测试，没有补写绕过断言 |
| npm run build | 通过 | Vite 5.4.21，45 modules |
| 定向诊断脚本 | 成功复现 | R1/R3/R4/R5/R6 直接执行；R2 为策略函数加调用链核验；R7 为纯函数实测 |
| npm run ci 整体 | **未通过** | 在 QUnit 阶段中断；后续检查单独执行 |

现有测试通过的部分不覆盖以上缺陷。原始检查日志保存在本机 git-ignored `review-ci.log`、`review-futures.log`、`review-e2e.log`、`review-e2e-retry.log`；关键结果已完整摘入本文件，不依赖这些未提交日志接手。

## 6. 详细重构实施计划

### 阶段 A：先修正确性，保持改动可单独回退

1. R1 合并去重记忆，补调用方多轮测试；R4 force 参数透传，补缓存命中测试。
2. R3 增加分组有序代码比较，以全量渲染作临时正确性兜底；明确暂时允许图表重新挂载。
3. R5/R6 先在现有文件中完整加入任务身份守卫，不同时搬迁目录，便于定位行为变化。
4. R2/R7 修复两端调度冲突与具体收盘/日历判断。
5. T1/T2 建立离线稳定测试门禁；基线存在失败时不得标记“全部闭环”。

每组独立提交，提交说明包含触发情形、行为变化和定向测试结果；若出现回归可以仅回退该组。

### 阶段 B：统一异步任务归属

建议新增 `src/js/services/requestScope.js`，提供 begin/isCurrent/cancel，不感知 DOM、行情或缓存。每次 begin 返回独立 token 和 AbortSignal；cancel 先失效 token，再 abort。controller 自己负责状态，scope 不自动吞异常。

- 图表：每个 code 分别保存 kline/intraday scope，切周期/日期只失效相关 scope；节点销毁使两个 scope 失效。
- 动量：扫描请求与轮询共享当前扫描 generation，轮询回调捕获 generation；stop 清 timer 并失效 scope。
- 涨停：保留 selectedDate + requestSeq 的已有保护，逐步统一相同契约，不能回退已有日期隔离。
- 每个 scope 都要覆盖“旧请求已 resolved、continuation 尚未执行”和“abort 后旧请求仍成功”的测试。

服务端 `momentumService.js` 目前只在 catch/finally 做部分任务归属保护。后续对 progress、success cache 的写入也做独立竞态测试，确保旧任务无法提交；本轮没有做服务端 10 分钟任务替换的完整动态复现，作为补充核验项，不混入已复现数量。不要直接把前端 scope 搬到后台任务，后台应使用自己的 jobId 与提交协议。

### 阶段 C：收敛交易会话模型

建议新增 `src/js/futures/session.js`（纯 ESM，可被 Node 复用），输入 instrument、now、tradingDates，输出 isTrading/sessionKind/sessionStatus/tradingDay。从现有服务端细分合约实现迁移，并先修 R7；禁止把现有 bug 原样做成“共享标准”。

前端 `marketSession.js` 保留股票会话与兼容导出；服务端 `futuresSessionService.js` 变为薄适配层。调用方需传实际合约，避免失去 nightSessionEnd/isFinancial/isTreasury 等信息。

另设 voice schedule 纯决策函数，输入订阅列表与用户配置，输出 timerShouldRun、eligibleCodes、pauseReason、transitionNotice。app 只执行决策；股票关闭不能直接否定期货夜盘。交易日期归属、开市状态、用户偏好应分别表达。

迁移顺序：固定时钟契约测试→提取共享模块→服务端切换→前端逐调用方切换→删除重复逻辑。保留原导出兼容层至调用方与测试迁移完成。

### 阶段 D：涨停视图按标的更新，图表生命周期独立

把结构对比/节点移动移入视图层；控制器输出已分组排序的 view model。维护 code→row/chartRow，group→tbody/headCount 的索引。价格变化只 patch；排序/分组变化 move；消失项 destroy。图表的加载请求和实例不跟随全表重建。

为批量收起实现一次销毁循环加一次渲染，避免当前逐个 close 都触发全表重建的放大。处理删除项时同步清理 selection/expanded/chartInstances；固定标的的展示规则沿用既有行为。

验收既看正确性也看生命周期：一次 tick 不应触发同 code 的 chart destroy/create；分组移动保留展开状态；批量关闭后 maps、requests、timers 全部归零。无需引入 React/Vue 或替换 lightweight-charts。

### 阶段 E：app.js 按职责继续拆分

完成上述正确性修复后再提取 `voiceController` 和 `monitorController`。voiceController 管订阅播报、增量记忆、定时器与会话决策；monitorController 管监控列表和刷新周期。app 仅组装依赖、路由和 stop/start。

依赖通过参数注入（clock、speech、fetch、storage），保留当前公共导出作为短期兼容，逐步把测试从 app 的转导出改为实际模块入口。不要仅为了文件行数搬函数；每次提取必须减少跨模块共享可变状态。

## 7. 接手验收清单

- [ ] R1–R7 均有断言正确行为、修复前失败的回归测试。
- [ ] 单测不依赖真实行情、当前日期、用户 cache；真实数据测试使用独立命令。
- [ ] 原始 E2E 命令可以独立启动服务，无需调整操作系统策略。
- [ ] lint、全量单测、57 项既有 E2E及新增边界用例、build 通过。
- [ ] 手工检查混合订阅夜盘语音、炸板/回封分组、展开图表跨组移动和重新加载。
- [ ] 检查 stop/start 后任务、图表、timer 资源清理；旧响应不能写新状态。
- [ ] 更新 STATUS 与新 handoff，明确实际完成项和剩余项，再按仓库流程提交推送。
