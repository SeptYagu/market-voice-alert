# 2026-09-10 修复验证：82c294f 对 R1–R8 审查（M1–M6 / m1–m3）的闭环情况

> [!NOTE]
> **闭环补记（后续提交）**：本文结论描述的是 `82c294f` 当时的状态。本文列出的全部未闭环项与 Minor 项其后已修复：`fa24120`（M3′ 归属判定提到清理之前）、`c01b3da`（M5′ 用显式 `syncMemory` 标记替代 `Function.length` 推断）、`19c2500`（M1′ 以快照 provenance 作为同日证据，恢复主源盘中合并）、`f9055e1`（M2′ 对象封套 + `lastUpdate`/`lastEffectiveAt` 分离 + stale 展示与提醒抑制）、以及 m1′/m3′ 收尾（统一 `formatCacheAge()`、R7 断言改用真实源产物、历史基线标注补到被验证文档）。当前验证：`lint` 0 问题、单测 **764/764**、E2E **63/63**、`build` 通过；脚本 `--expect=fixed` 在当前 `main` 全过、`--expect=broken` 在 `1c62554` 复现全部 8 项。详见文末「闭环记录」。

## 审查概览

- 审查目标：`market-voice-alert` 最新提交
  - `82c294f` fix: resolve M1-M6 review defects, voice backpressure, quote envelope, and momentum freshness
- 审查基线：`d9a2236`（含待验证的审查文档 `2026-09-10-r1r8-fix-review.md`）
- 审查范围：本提交完整 diff（20 文件 / +475 −85）+ 独立复现验证；`d9a2236` 及更早提交未逐行重审
- 验证结果：`npm run lint` 通过；单测 **750/750** 通过（审查时 744，新增 6 例）；E2E **63/63** 通过；`npm run build` 通过
- 独立复现：仓库外临时脚本逐项验证（见文末证据），验证后删除，工作区保持干净
- 合并建议：⚠️ **修改后可合并** —— M4、M6 已闭环；m2 已完成；**M5 实测未修复**、**M3 修复引入新的队列卡死路径**；M1、M2、m1、m3 为部分闭环

## 逐项验收结论

| 缺陷 | 提交声明 | 实测结论 |
| --- | --- | --- |
| M1 报价日期校验对真实源空转 | 已修 | ⚠️ 误合成已消除，但主源（aktools/sina）**永远无法自证日期**，盘中实时合并对它们完全失效（见 M1'） |
| M2 部分缺失仍推进成功时间 | 已修 | ⚠️ 封套/标记已落地；`lastUpdate` 仍推进、`failedCodes` 与 `lastEffectiveTime` 无任何消费方（见 M2'） |
| M3 超时未通知原生合成器 | 已修 | ⚠️ 超时 `cancel()` 已修；但 `finish()` 的清理早于归属判定，旧回调会**清掉当前项的定时器**，队列永久卡死（见 M3'） |
| M4 原因照搬 15:05 规则 | 已修 | ✅ 通过（同交易日 20:30 才允许冻结，16:00 与 20:35 实测判定正确） |
| M5 提醒链路未接线 | 已修 | ❌ **未修复**：`memory` 仍在「尚未真正播出」时写入（见 M5'） |
| M6 `inFlight` 归属未按 token 判定 | 已修 | ✅ 通过（重叠强制刷新下 `inFlight` 归属正确） |
| m1 过期元数据只有一处展示 | 已修 | ⚠️ 部分完成（状态行已加角标；表头/单元格仍无；`generatedAt` 取了但没渲染） |
| m2 死代码再导出与命名歧义 | 已修 | ✅ 通过 |
| m3 复现脚本失效与文档标注 | 已修 | ⚠️ 部分完成（脚本已翻转为期望修复并全绿；但 R7 断言仍空转，历史基线标注加在了另一份文档） |

## 关键问题（Major）

### [M5'] R6 的提醒接线：`memory` 修复在生产接线中被自身兼容分支抵消 — 🟠 Major（声称与实测相反）

- 位置：`src/js/controllers/voiceController.js:42`；签名 `src/js/tts.js:100`；接线 `src/js/app.js:1172`
- 问题：新增的门控写成

  ```js
  if (!callbackHandled && (speech.syncMemory || speech.speak.length === 1) && result.spoken) {
    memory.set(code, { ...memory.get(code), ...result.spoken });
  }
  ```

  `speak.length` 的本意是「形参只有 1 个 = 旧适配器，不支持回调」。但 `tts.speak` 的签名是 `speak(text, userOpts = {})` —— **带默认值的形参不计入 `Function.length`，实测 `tts.speak.length === 1`**。而生产接线 `speech: { supported, speak: ttsSpeak, cancel }` 里 `ttsSpeak` 就是 `tts.speak` 本体（`app.js:39` `speak as ttsSpeak`），`speech.syncMemory` 又是 `undefined`。于是条件恒为真，`memory.set` 仍与 `speak()` 同步执行。实测（适配器永不触发 `onend`，即该条根本没播出）：

  ```
  tts.speak.length  = 1          speech.syncMemory = undefined
  synth received    = 1 utterance (never ends -> nothing actually spoken)
  memory after speak = [["sh600000",{"price":"10.00 元","percent":"涨 1.00"}]]
  => memory updated even though nothing was played
  ```

- 后果：审查文档 M5 指出的原始症状（「队列/超时导致该条根本没播时，去重记忆仍被写成已播，用户可能永远听不到那个价位」）**一字未改**。`STATUS.md` 中「仅在真实播完回调 `onSpoken` 后更新 `memory` 去重基线」的表述与生产行为不符。超时（`tts.js` 新引入的 `reason='timeout'`）与过期丢弃（`reason='expired'`）这两条新增路径恰好都会走「没播但记忆已写」。
- 为什么测试没测到：`tests/voiceController.test.js:18` 的夹具是 `speak: text => spoken.push(text)` —— 形参恰好 1 个，**正好命中这条有缺陷的分支**，所以「manual speech seeds the same dedup memory」是通过（错误的）立即写入而成立的。若把门控改对而不动夹具，该用例会失败。
- 修复建议：不要用 `Function.length` 推断能力，改用显式能力标记，并让测试走真实回调路径：

  ```js
  // app.js
  speech: { supported: isSpeechSupported, speak: ttsSpeak, cancel: ttsCancel, waitsForPlayback: true }
  // voiceController.js
  if (!callbackHandled && !speech.waitsForPlayback && result.spoken) { memory.set(code, ...); }
  ```

  同时注意反方向风险：若换了环境 `onend` 永不触发，去重基线永不推进会变成每个周期重复播报，因此 `speak()` 内部应为 `onSpoken` 兜底（例如在 `finish('end')` 已覆盖的正常路径之外，对「已确认提交且未报错」的情况给一个带告警的超时兜底），而不是靠调用方立即写入。

### [M3'] 修复本身引入新的泄漏：旧回调清掉当前项的安全定时器，队列永久停滞 — 🟠 Major（新引入）

- 位置：`src/js/tts.js:60`–`66`
- 问题：`finish()` 把「清定时器 + 清 `_finishCurrent`」放在了归属判定之前：

  ```js
  const finish = (reason) => {
    _finishCurrent = null;                       // ← 无条件
    if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }  // ← 无条件
    if (_currentUtterance !== item) return;      // ← 归属判定太晚
    ...
  ```

  超时路径会先 `synth.cancel()`，而浏览器对 `cancel()` 的响应是给被取消的 utterance 异步派发 `onerror`（Chrome 为 `error: 'interrupted'` / `'canceled'`，部分实现还会补一个 `onend`）。此时 `_pump()` 已经启动了下一项 B 并装好了 B 的定时器，紧接着 A 的迟到回调进入 `finish`：先把 B 的 `_safetyTimer` 清掉、把 `_finishCurrent` 清空，然后才因 `_currentUtterance !== A` 返回。结果 B 既没有定时器也没有 finish 句柄，`_currentUtterance` 永远非空，`_pump()` 从此早退 —— 队列整体停滞。实测（适配器模拟 `cancel()` 后异步回调）：

  ```
  after 3 speaks       -> adapter calls: 1, queue: 3
  after A timeout      -> adapter calls: 2, cancelCount: 1, now speaking: "B short"
  after stale onerror  -> speaking: "B short", queue: 2
  B timeout handle still live = false
  callbacks seen       = ["A:timeout"]      ← B 再也没有任何回调或超时
  ```

- 后果：这是 R6/M3 想根治的同一类故障（「待播行情排长队」）的新入口，且触发条件是 M3 刚引入的超时分支本身 —— 一旦发生一次超时，之后所有播报（含高优先级价格提醒）全部静默。同一个无条件清理也会被「同一 utterance 重复派发 `onend`/`onerror`」触发，不必等到超时。
- 修复建议：把归属判定提到最前，并让 `_finishCurrent` 只由当前项的清理由者负责：

  ```js
  const finish = (reason) => {
    if (_currentUtterance !== item) return;              // 先判定归属
    if (_finishCurrent === finish) _finishCurrent = null;
    if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }
    if (reason === 'timeout') { try { synth.cancel(); } catch { /* ignore */ } }
    _currentUtterance = null;
    ...
  };
  ```

  并补一条「超时后旧回调迟到」的用例（现有 `phaseCFixes.test.js` 的 M3 用例只调用了 `triggerTimeout()` 一次，看不到这个交叉）。

## 一般问题（Minor）

### [M1'] 日期校验对两个主力行情源永久失效，盘中实时合并被一并关掉 — 🟡 Minor（行为回归）

- 位置：`server/momentumService.js:96`–`103`；源定义 `src/js/aktoolsApi.js:457`–`477`、`server/sinaSpotService.js:15`–`24`；源优先级 `server/spotService.js:47`–`76`
- 结论：误合成确实消除了（审查文档中「隔日报价被写成今日柱」的场景不再成立），但两个前置源在结构上就不可能自证日期：

  | 源（spotService 优先级） | 日期字段 | 盘中能否合成为今日柱 |
  | --- | --- | --- |
  | aktools（主源） | **无任何日期字段** | ❌ |
  | sina（回退 #1） | `updateTime` = `ticktime`，实测为 `'15:00:00'` 纯时间 | ❌ |
  | tencent-batch（末位回退） | `quoteDate` / `updateTime` | ✅（仅当日） |

  实测：`aktools -> synthesizedTodayBar=false`；`sina('15:00:00') -> false`；`tencent(20260909) -> false`；`tencent(20260910) -> true`。
- 影响面（已确认并非全域）：`resolveMomentumScanDates` 在盘前（<09:15）与盘后（≥15:05）都返回 `liveDate: ''`，即两个定时扫描（08:00 / 15:05）本来就走不到合并。**受影响的是 09:15–15:05 的按需/手动扫描**：此前对 aktools 主源会正确地把实时价并成当日柱，现在不会了 —— 盘中点扫描得到的是「截至昨收」的 10 日动量，当日大涨的股票不再因此进入列表，且 `endDateKey` 回落到上一交易日。审查文档的修复建议（「无正向证据即不合成」）正是这个方向的取舍，但建议里默认 sina/tencent 携带日期可用，实测 sina 只有纯时间，因此取舍的实际代价比建议预期更大。
- 修复建议：二选一并在文档写明。要么显式给主源补日期（快照落盘时记录抓取日，或用 `resolveMomentumScanDates` 的交割日作为证据，把「证据」从报价字段改为「快照生成时刻 + 交易日校验」）；要么确认「盘中动量不含当日」是可接受语义，并删掉 `liveDate` 盘中分支与相关死路径，避免以后有人以为它在工作。
- 附带：R7 的老单测仍是空转 —— `tests/phaseBFixes.test.js:19` 传入的 `plan.liveDate` 为 `''`，`mergeLiveQuoteIntoDailyKline` 在 `!liveDateKey` 处就早退，断言与日期校验是否实现无关。新增的 M1 用例（同文件 `:96` 起）传了非空 `liveDateKey`，是有效的。

### [M2'] 报价时效只落到 state，没有落到界面与语义 — 🟡 Minor

- 位置：`src/js/controllers/monitorController.js:38`–`56`；`src/js/api.js:236`–`244`
- 已落地：`fetchQuotes` 返回 `{ quotes, failedCodes, asOf, source }`；`fetchEastmoney` 去掉内层 `catch(() => null)` 并在全失败时冒泡；控制器对缺失码保留旧价并置 `stale: true`。
- 未落地：
  1. **`lastUpdate` 仍在部分失败时推进**（实测 `advanced=true`），而审查给出的验收条件是「失败时成功时间不变」。用户仍然看到「更新于 刚刚」，缺的那只仍是昨日价 —— 原始症状未消除。审查建议的「`lastUpdate` 与最后有效行情时间分开存储」只做了一半：`quote.lastEffectiveTime` 只写不读（全项目无消费方）。
  2. `state.failedCodes` 无任何消费方（`grep` 仅命中定义与单测），行情表视图 `src/js/views/monitorTableView.js` 中 `stale` 出现 0 次，用户无从区分新鲜与陈旧行情。
  3. 提醒链路未过滤陈旧报价：`processAlerts()` 仍以 `state.quotes` 全量喂给 `evaluateAlerts`，昨日旧价依旧可以触发价格提醒（M2 原症状之一）。
- 设计气味：封套实现为「给数组挂属性」且自引用（`fulfilled.quotes = fulfilled`，实测 `selfRef: true`）。当前调用方都按数组消费，暂无实际故障，但任何 `JSON.stringify(res)`、`structuredClone(res)` 或把该数组 `postMessage` 出去都会直接抛出 circular 结构错误。建议返回真正的对象封套，或让调用方明确解构 `{ quotes, failedCodes }`。

### [m1'] 过期角标只到状态行，`generatedAt` 取了不显示 — 🟡 Minor

- 已落地：`limitUpController.js:163` 与 `momentumView.js:208` 各推一个 `(过期缓存)` 到状态行文本。
- 未落地：审查要求的「涨停看板表头与动量面板状态区加上统一的『数据时间 / 过期』角标，复用同一个格式化函数」只做了后半段的临时拼接 —— `generatedAt` 已在 `limitUpController.js:301` 与 `momentumController.js:218` 取出，但全项目无渲染点；也没有抽出 `formatCacheAge()`，两处各写一份字符串。表格内部（`monitorTableView.js` / `limitUpView.js`）仍无任何过期标识。

### [m3'] 复现脚本仍以生产不存在的字段自证；历史基线标注挂错了文档 — 🟡 Minor

- 已落地：脚本改为默认期望修复行为（`--expect=fixed`），现在 8 项全绿并输出 `All 8 defect verifications PASSED`，不再在第一条断言崩溃；测试计数已由 733 更新为 750。
- 未落地：
  1. 脚本 `:154`–`:156` 验证 R7 用的仍是虚构字段 `time: '2026-09-09 15:00:00'`（本项目 `time` 的分时语义另有所指），且 `plan.liveDate` 为空 → 断言恒真；真实源字段的覆盖只补在 `tests/phaseBFixes.test.js` 里。
  2. 审查要求「在 handoff 文档标注『R1–R8 已被 33a742d 部分修复，本文为历史基线』」，实际把 `> [!NOTE]` 加到了 `2026-09-10-code-review-requirements-and-modularization-handoff.md`，而被验证的对象 `2026-09-10-r1r8-fix-review.md` 本身没有加标注，后续读者仍可能把它当现行结论。

## 其余核对

- M4 阈值改动落点正确：涨停池仍用 15:05（`isHistoricalLimitUpComplete` 未动），原因独立改为 20:30。残留两个小口子 —— 未存档 `reasonSource`（审查的另一点要求）；`isHistoricalReasonsComplete` 末行「`stamp.dateKey > dateKey` 即判完整」会把**次日生成的空原因结果**冻结为完整，之后再也不会补齐（实测 `next-day 10:00, EMPTY reasons -> complete=true`）。
- M6 一行修复与建议一致（`finally` 内以 `scope.isCurrent(token)` 包裹释放），`inspect()` 增加 `inFlight` 便于观测。`stop()` 中 `inFlight = false` 仍依赖调用顺序（审查已提示），未改。
- m2 完成：`parseEastmoneyTrends` / `parseTencentMinute` 的再导出已删除，两个测试改为从 `parser.js` 直引；`source` / `cacheSource` 语义已在 `api.js:25`–`27` 注释说明。
- 新增用例的取值方向总体是改进的：M1 用例使用 `parseAktoolsSpotList` / `parseSinaSpot` / `parseTencent` 的真实产物，正面回应了上轮「测试用字段在生产不存在」的批评。

## 建议的下一步（按优先级）

1. 修 M3'：把 `finish()` 的归属判定提到清理之前（一行挪位），补「超时后旧回调迟到」用例。
2. 修 M5'：用显式能力标记替代 `Function.length` 推断；把 `tests/voiceController.test.js` 的夹具改为真实回调（`opts?.onSpoken?.('end')`），并给 `onSpoken` 缺失场景留兜底。
3. 定 M1' 的语义：主源补日期证据，或明确「盘中动量不含当日」并清掉死路径；顺手让 R7 老单测不再空转。
4. 补 M2' 的展示与语义：`lastUpdate` 与最后有效行情时间分开、`failedCodes`/`stale` 落到界面、提醒跳过陈旧报价；封套改为对象并去掉自引用数组。
5. Minor：m1' 抽 `formatCacheAge()` 并渲染 `generatedAt`；m3' 给 `2026-09-10-r1r8-fix-review.md` 加历史基线标注、脚本 R7 改用真实源产物。

## 验证命令与证据

```bash
npm run lint                                    # 通过
npm run test                                    # 750/750 通过
npx playwright test --reporter=line             # 63 passed (1.3m)
npm run build                                   # 通过
node docs/handoff/2026-09-10-review-repro.mjs   # 8/8 PASSED（已翻转为期望修复）
```

本轮独立复现脚本为仓库外临时文件（覆盖 M1 真实源字段、M2 部分失败封套与 `lastUpdate`、M3 迟到回调交叉、M5 门控真值、M4 发布窗口、M6 归属），验证后已删除；工作区保持干净，未修改任何业务代码。

## 闭环记录

本文列出的每一项未闭环项都已按「功能真实可用」而非「测试通过」的标准修复并复验。

| 项 | 问题实质 | 修复提交 | 复验方式 |
| --- | --- | --- | --- |
| M3′ | `finish()` 在归属校验**之前**清掉 `_safetyTimer`/`_finishCurrent`；被 `cancel()` 的 utterance 迟到回调会掐掉下一条的安全定时器，队列永久卡死 | `fa24120` | 旧代码上 M3 用例 3 例失败 → 新代码 0 失败；另加「迟到回调」「重入 cancel」「恰好上报一次」3 例 |
| M5′ | `speech.speak.length === 1` 恒为真（`speak(text, opts = {})` 的参数带默认值不计入 `Function.length`），`memory` 在播报确认前即被同步写入 | `c01b3da` | 夹具改为真实设备契约（`opts.onSpoken('end')`）；旧代码 1 例失败 → 新代码 0 失败 |
| M1′ | `82c294f` 把证据字段对齐到 `quoteDate`/`updateTime`，但 aktools 无日期字段、新浪只有 `HH:MM:SS`，导致主源盘中合并被整体关死 | `19c2500` | 冻结时钟 + 预置缓存做端到端证明：修复前 `lastClose=20/marketDate=20260909`（今日缺失）→ 修复后 `lastClose=40/marketDate=20260910`；stale 快照在两种情况下均被拒 |
| M2′ | 封套为自引用数组（`JSON.stringify`/`structuredClone` 直接抛错）；部分缺失仍被当作成功 | `f9055e1` | `fetchQuotes` 返回普通对象；`lastUpdate` 仅整批成功时推进；stale 行标记/状态栏/提醒抑制均有单测与 E2E 覆盖 |
| m1′ | `generatedAt` 取出却不渲染，两个视图各拼一份 `(过期缓存)` | 本轮 | 抽出 `formatCacheAge()`，涨停看板表头、动量状态区、分时状态行共用 |
| m3′ | R7 断言用虚构 `time` 字段且 `plan.liveDate` 为空 → 恒真；历史基线标注挂错文档 | 本轮 | R7 改为真实源产物（`quoteDate`/`updateTime`/快照 provenance），并在 `1c62554` 上 `--expect=broken` 复现 8/8、当前 `main` 上 `--expect=fixed` 通过 8/8；标注补到 `2026-09-10-r1r8-fix-review.md` |

M4 残留一并处理：原因归档新增 `reasonSource: aktools-stock_lhb_detail_em`，标明数据来自龙虎榜席位明细而非上涨原因。

最终门禁：`npm run lint` 0 问题；单测 **764/764**；Playwright E2E **63/63**；`npm run build` 通过。
