# 2026-09-10 提交审查：R1–R8 修复验证（33a742d）

## 审查概览

- 审查目标：`market-voice-alert` 仓库最新一批提交
  - `33a742d` fix: resolve runtime freshness, archive completeness, and voice queue defects (R1-R8)
  - `8d4cb09` docs: audit runtime correctness and modularization with defect reproductions（本轮的需求来源）
- 审查基线：`1c62554`（工作区干净，`main` 与 `origin/main` 一致）
- 审查范围：仅本批 diff + 独立复现验证；`1c62554` 本身未逐行重审
- 技术栈：Vanilla JS (ESM) + Vite 前端、Node 共享缓存后端、QUnit 单测、Playwright E2E
- 验证结果：`npm run lint` 通过；单测 **744/744** 通过；E2E **63/63** 通过；`npm run build` 通过
- 独立复现：新建临时脚本验证 4 项结论（4/4 成立），验证后已删除，工作区保持干净
- 合并建议：⚠️ 修改后可合并——R1 主路径、R3、R4、R5 前半、R8 管道已生效，但 R2/R6/R7 与 R5 后半仍有可复现缺口

## 逐项验收结论

| 缺陷 | 声明 | 实测结论 |
| --- | --- | --- |
| R1 周期刷新取消慢请求 | 已修 | ✅ 普通路径已修；⚠️ 重叠强制刷新时 `inFlight` 归属失效（见 M6） |
| R2 全失败仍算成功 / 缺失不补源 | 已修 | ⚠️ 全失败路径已修；部分缺失仍被当作成功（见 M2） |
| R3 强势股不刷新 | 已修 | ✅ 通过（`momentum.items` 已进入刷新集合） |
| R4 旧扫描覆盖新报价 | 已修 | ✅ 通过（仅无实时值或 snapshot 时写入） |
| R5 历史涨停池视为完整 | 已修 | ⚠️ 池规则正确；原因规则照搬池规则，会永久冻结部分发布的数据（见 M4） |
| R6 语音队列背压 | 已修 | ⚠️ 队列与单条派发已实现；超时路径仍泄漏到原生队列（见 M3），提醒链路未接线（见 M5） |
| R7 盘前扫描合成今日柱 | 已修 | ⚠️ 盘前日期已修；新增的「报价日期校验」对全部真实行情源不生效（见 M1） |
| R8 缓存 stale 信息丢失 | 已修 | ⚠️ 管道已修；仅分时状态行展示，其余表格未见（见 m1） |

## 关键问题（Major）

### [M1] R7 的报价日期校验对全部真实行情源空转 — 🟠 Major

- 位置：`server/momentumService.js:96`–`103`（校验）、`:271`（调用点）；行情源字段定义 `src/js/aktoolsApi.js:446`–`477`、`server/sinaSpotService.js:12`–`24`、`src/js/parser.js:43`–`85`
- 问题：新增校验只读 `quote.time` / `quote.date`，但三个全市场快照源都不产出这两个字段——aktools spot 没有任何日期字段，新浪/腾讯只给 `updateTime`，腾讯额外给 `quoteDate`（注意 `time` 在本项目里是「分时图秒级时间戳」的语义，不是日期字符串）。因此该分支永远不会命中，`mergeLiveQuoteIntoDailyKline` 仍会把无日期或隔日报价合成为今日 K 柱，正是 R7 报告的场景。实测：

  ```
  aktools candidate (no time/date field) -> last bar: {"time":"2026-09-10","open":19,"close":20,...}
  => synthesized today bar? true
  tencent candidate dated 20260909 (quoteDate) -> last bar: {"time":"2026-09-10",...}
  => stale 09-09 quote rewritten as today bar? true
  control (time="2026-09-09 15:00:00") -> last bar: {"time":"2026-09-09",...}   ← 只有这个虚构字段会被拦住
  ```

  后果：当 `liveDate` 非空（09:15–15:05）而快照实际是上一交易日（aktools 主源无法自证日期、腾讯/新浪携带 `quoteDate` 却不被读取）时，10 日窗口会多出一根重复的「昨日」柱，把 10 日涨幅算错（审计文档中的复现即 100% → 81.82%），进而误筛强势股。新增单测 `tests/phaseBFixes.test.js` 只覆盖了虚构的 `time` 字段，未覆盖真实源字段，所以测不到。
- 修复建议：改为「无正向证据即不合成」，并读取真实字段：

  ```js
  const rawDate = quote && (quote.quoteDate || quote.date);
  const rawTime = quote && quote.updateTime;
  const evidence = String(rawDate || (rawTime && rawTime.slice(0, 8)) || '').replace(/\D/g, '');
  if (!evidence || evidence !== normalizeDateKey(liveDateKey)) return data;
  ```

  同时在 `tests/phaseBFixes.test.js` 用 `_parseAktoolsSpotItem` / `parseSinaSpot` / `parseTencent` 的真实产物做用例，避免再次出现「测试用字段在生产不存在」的情况。

### [M2] R2 只修了全失败，部分缺失仍推进成功时间 — 🟠 Major

- 位置：`src/js/api.js:136`–`172`（`fetchQuotes` 内层回退）、`:205`–`222`（`allSettled` 汇总）、`src/js/controllers/monitorController.js:36`–`41`
- 问题：`fetchQuotes` 只要拿到任意一条报价就 resolve，`monitorController` 随即写 `state.lastUpdate = clock()` 并触发 `onQuotes()`；`failedCodes` / `asOf` 封套没有按审计方案返回。更隐蔽的是 `src/js/api.js:120`–`125` 的 `fetchEastmoney` 用 `.catch(() => null)` 吞掉每只股票的失败，于是「部分成功」与「真的没有这只票」在返回结果里无法区分。实测（腾讯只回 1 只、东财全挂）：

  ```
  fetchQuotes resolved with 1 of 2 codes (no throw): sh600000
  after refresh -> lastUpdate advanced: true | missing code still shows old 8.00 dated 20260909
  ```

  后果：用户看到「更新于 刚刚」，但缺的那只仍是昨日价，且提醒逻辑拿旧价评估——正是 R2 要消除的「用请求完成时间冒充报价时间」。审计文档给 R2 的验收条件（「失败时成功时间不变，旧行情可见但不伪装成新行情」）在部分失败场景未满足。
- 修复建议：让 `fetchQuotes` 返回封套 `{ quotes, failedCodes, asOf, source }`；控制器只在 `failedCodes.length` 变化时保留旧价并标记 `quote.stale = true`，`lastUpdate` 与「最后有效行情时间」分开存储；`fetchEastmoney` 去掉内层 `catch(() => null)`，把失败冒泡给聚合层统一记账。

### [M3] R6 的 10 秒超时推进后没有通知原生合成器取消 — 🟠 Major

- 位置：`src/js/tts.js:50`–`74`（`cleanup` / `_safetyTimer` / `_pump`）
- 问题：`cleanup()` 在超时路径上只从应用队列移除元素并 `_pump()` 下一条，从未对「已被判定超时」的那条调用 `synth.cancel()`；而那条早已 `synth.speak(item)` 提交进设备队列。实测（适配器不自动结束）：

  ```
  after 2 speaks -> native calls: 1 | app queue: 2
  after 10s safety timeout -> native calls: 2 | native cancelCount: 0
  => native synth now holds 2 utterances while app believes 1 is playing: true
  ```

  后果：应用层「同一时刻只向原生合成器提交一条」的承诺在暂停/锁屏/设备卡住时失效——被放弃的旧行情仍躺在设备队列里，恢复播放时会按队列顺序补播过时价格，而此时应用层已无法再合并或丢弃它（`code` 合并只作用于应用队列）。这正是 R6 要解决的「几分钟前的待播行情排长队」。现有 `tests/phaseCFixes.test.js` 用「手动调 `onend`」验证正常路径，覆盖不到超时路径。
- 修复建议：超时视为设备异常，先取消再推进；并把「超时」与「正常结束」区分开：

  ```js
  const finish = (reason) => {
    if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }
    if (_currentUtterance !== item) return;
    if (reason === 'timeout') { try { synth.cancel(); } catch { /* ignore */ } }
    _currentUtterance = null;
    const i = _queue.indexOf(item);
    if (i >= 0) _queue.splice(i, 1);
    _pump();
  };
  item.onend = () => finish('end');
  item.onerror = () => finish('error');
  _safetyTimer = setTimeout(() => finish('timeout'), timeoutMsFor(item));
  ```

  超时阈值不要再写死 10s，应按文本长度估算（当前一个较长播报就可能被误判超时）。

### [M4] R5 的原因完整性照搬了涨停池的 15:05 规则 — 🟠 Major

- 位置：`server/limitUpService.js:40`–`51`
- 问题：`isHistoricalReasonsComplete` 在「当天 15:05 之后 + 非空」即判完整。龙虎榜明细当晚才发布，15:05 之后很容易拿到「只有部分股票」的非空结果，一旦落盘就被永久标记为 `stale: false` 完整数据，后续打开不再补齐。审计文档已明确写过「原因需要发布后的延迟重试窗口，不能简单复制 15:00 分时收盘点规则」，本次实现正好复制了该规则。（涨停池本身用 15:05 规则是正确的，因为集合竞价结果 15:05 已定稿。）
- 修复建议：原因用独立阈值与重试窗口（例如北京时间 20:30 之后才允许冻结，之前的非空结果只做展示不落完整标记），或引入「未发布 / 部分发布 / 已核验」状态，并把 `reasonSource` 一并存档，避免把龙虎榜上榜原因当成因果解释（审计文档的另一点要求）。

### [M5] R6 的提醒链路没有接线：优先级未传、播报记忆先于真实播出 — 🟠 Major

- 位置：`src/js/app.js:1159`（提醒播报）、`:904`–`910`、`:1094`；`src/js/controllers/voiceController.js:34`–`35`；`src/js/tts.js:96`–`108`
- 问题：`tts.js` 新增的 `priority` 与 `code` 两个参数在生产调用点都没用到——真实价格提醒走的是 `ttsSpeak(item.message, { volume })`，既无 `code`（无法按标的合并）也无 `priority`（无法插队）。同时队列溢出策略 `_queue.splice(1, 1)` 丢的是「最旧的待播项」，所以高频routine播报下一条已经排队的价格提醒会被静默丢弃，而 `alertStates` 已更新、不会重播。另外 `voiceController.js:34`–`35` 在 `speak()` 返回后立即 `memory.set(...)`，队列/超时导致该条根本没播时，去重记忆仍被写成「已播」，之后只会报「相对这条没播过的文本」的增量，用户可能永远听不到那个价位。审计文档已把「提醒设优先级及有效期」「memory 在调用 speak 后立即更新」明确列为 R6 范围，本次未落地。
- 修复建议：提醒链路改成 `ttsSpeak(item.message, { volume, priority: 'high', code: item.code })`，用完即失效（给提醒加过期时间，过期直接丢弃）；溢出时优先丢 routine 项而不是插队后的提醒项；把 `memory.set` 移到 `onend` 回调（`speak(text, { code, onSpoken })`），只有真正播完才更新去重基线。

### [M6] R1 的 `inFlight` 归属未按 token 判定 — 🟠 Major

- 位置：`src/js/controllers/monitorController.js:24`、`:27`、`:45`
- 问题：`finally` 里无条件 `inFlight = false`，而被取消的「上一代」请求同样会走这个 `finally`。于是当两次强制刷新重叠（连点刷新、或在 `applySchedule` 的可见性/时段切换时又点了刷新），旧请求落地瞬间把 `inFlight` 清零，随后一个定时 tick 就能合法启动新请求并通过 `scope.begin()` 取消仍在进行中的有效请求——R1 的症状复活。实测：

  ```
  after 2 manual refreshes -> requests: 2 | #1 aborted: true | #2 aborted: false
  after one scheduled tick -> requests: 3 | #2 (legit in-flight) aborted by tick: true | #3 aborted: false
  ```

- 修复建议：与同段其他语句保持一致，按归属释放：

  ```js
  } finally {
    if (scope.isCurrent(token)) { inFlight = false; state.loading = false; onRefresh(); onStatus(); }
  }
  ```

  另外 `stop()` 里的 `inFlight = false` 应改为随 `lifecycle` 失效（当前写法依赖调用顺序，后续若新增入口容易再次踩坑）。

## 一般问题（Minor）

### [m1] R8 的元数据只有分时状态行会展示 — 🟡 Minor

- 位置：`src/js/controllers/chartRowController.js:157`–`180`（唯一展示点）、`src/js/limitUpApi.js:198`–`220`、`src/js/services/momentumScanner.js:31`–`37`
- 问题：`stale/generatedAt/cacheSource` 已能穿透适配层，但前端只有分时状态行拼接了 `(过期缓存)`；涨停看板与 10 日强势股列表拿到了 `stale` 却没有任何渲染（全项目 grep 无消费点）。审计文档要求的「所有图表/列表显示 asOf 与过期提示」只完成了一处，用户在涨停/动量表看到的旧数据仍与新鲜数据无从区分。
- 修复建议：在涨停看板表头与动量面板状态区加上统一的「数据时间 / 过期」角标，复用同一个格式化函数（例如 `formatCacheAge(generatedAt, stale)`），避免每个视图各写一份。

### [m2] Phase D 的兼容再导出已成死代码，且缓存来源有两套命名 — 🟡 Minor

- 位置：`src/js/api.js:27`、`:399`–`406`、`:503`–`508`
- 问题：`export { parseEastmoneyTrends, parseTencentMinute }` 在 `server/marketData.js` 改从 `parser.js` 导入后已无消费方（grep 仅剩定义处）；同时 `_fetchIntradayFromSharedCache` / `_fetchKlineFromSharedCache` 里把服务端封套的 `source` 重命名为 `cacheSource`，而数据自身的来源仍叫 `source`，会造成「`source` 到底是数据源还是缓存状态」的长期歧义。
- 修复建议：删除该再导出（审计文档也建议把纯解析函数收拢到共享领域目录）；缓存状态统一命名 `cacheSource`，数据来源统一 `source`，并补一行注释说明二者区别。

### [m3] 08:00 扫描语义改变后与盘后扫描重复，且旧复现脚本已失效 — 🟡 Minor

- 位置：`server/momentumService.js:78`–`82`；`docs/handoff/2026-09-10-review-repro.mjs:36`
- 问题：盘前分支把 `marketDate` 锚到上一交易日后，08:00 扫描产出的 10 日窗口与前一交易日盘后扫描完全相同（同一阈值、同一窗口），只是缓存在今天的 key 下；如果这个时间点还有独立价值（例如给盘前决策一个不依赖实时源的结果），建议在文档里说明，否则可以合并。另外旧复现脚本仍按「缺陷成立」断言，当前直接崩溃：

  ```
  AssertionError: false !== true  at docs/handoff/2026-09-10-review-repro.mjs:36
  ```

  脚本在第一条 R1 断言就退出，其余 7 项状态无法观测，而交接文档仍把它写成可用证据。
- 修复建议：按交接文档自己的要求，把脚本断言改成期望行为并移入 `tests/`（或加 `--expect=fixed` 开关）；同时在 handoff 文档标注「R1–R8 已被 33a742d 部分修复，本文为历史基线」。顺带更新 STATUS 的测试计数（当前实际 744，文档仍写 733）。

## 架构评估

- 模块边界：Phase D 把趋势解析搬到 `src/js/parser.js`，服务端不再反向依赖前端 `api.js`，依赖方向正确，是本次最有价值的一次纯结构调整。
- 依赖方向：`server/* → src/js/parser.js` 单向；前端 `api.js → parser.js → time.js` 无环。新增的 `snapshot: true` 标记写在全局 `quotes` 上属于临时约定，建议尽快以统一的 `quoteStore`（按 `asOf`/来源质量整条替换）替代，否则「哪些字段能被覆盖」的规则会继续散落在各控制器里。
- 正确性主线依然清晰：本次改动集中在「谁有权写报价」和「什么时候算数据可信」，方向与审计文档的阶段 A/B/C 一致；剩余缺口都落在「证据字段没对齐真实数据源」（M1）和「状态机只覆盖了主路径」（M2/M3/M6）。
- 主要风险：单测新增 5 个用例均通过，但其中 R7 与 R8 的用例构造了生产环境不存在的字段形态（虚构 `time`、虚构封套 `source: 'stale'`），这类「测试自证」会掩盖真实缺口，建议用例一律使用真实解析函数的输出。

## 建议的下一步（按优先级）

1. 修 M1（改读 `quoteDate`/`updateTime`，无证据不合成），并用真实解析产物补测——直接决定 10 日池是否可信。
2. 修 M2（返回 `failedCodes`/`asOf` 封套，`lastUpdate` 与有效行情时间分离）。
3. 修 M3（超时先 `cancel()` 再推进，超时阈值按文本长度），补延迟适配器用例。
4. 修 M4（原因独立发布窗口）与 M5（提醒优先级接线 + `memory` 移到 `onend`）。
5. M6 一行修复，可与上面任一提交合并。
6. Minor 项（m1 过期角标、m2 清理、m3 脚本与文档）随后处理，不影响正确性。

## 验证命令与证据

```bash
npm run lint      # 通过
npm run test      # 744/744 通过
npm run e2e       # 63/63 通过
npm run build     # 通过
node docs/handoff/2026-09-10-review-repro.mjs   # 当前在 R1 断言处崩溃（见 m3）
```

本轮 M1/M2/M3/M6 的复现脚本为临时文件，验证后已删除；工作区保持干净，未修改任何业务代码。
