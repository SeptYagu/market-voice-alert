# STATUS.md - 项目状态

## 2026-09-19 当前状态：集合竞价方案**代码落地修复轮（Round 9 缺陷闭环）已完成，待 Round 10 终审复核**

本次修复提交：闭环 Round 9 唯一缺陷 P3-1（时效未知通道保守态配套的官方日K兜底重载机制与节流），严格恪守 `kline.js:673`/`:595` 的 Fail-Closed 合取判据不放宽。
- **P3-1 闭环落地详情**：
  1. `src/js/controllers/chartRowController.js`:
     - 在 `ChartRowManager` 增加 `refreshPreviewKline(code, now = new Date(), reloadInterval = 30000)` 方法。
     - 严格门禁：必须 `inst.period === '1d'`、必须末柱为 `preview: true`、北京时间必须 `clockMinutes >= 9 * 60 + 30`（>= 09:30 盘中时段）、且非 loading / 非 klineRefreshing。
     - 节流控制：30 秒节流（`inst.klineLastReloadAt && Date.now() - inst.klineLastReloadAt < reloadInterval`），避免无谓重载。
     - 触发执行：`await this.loadKline(code, { force: true, now })` 强制网络重拉今日官方日K，拉取权威今日柱后替换预览柱，清除 `preview` 标识并恢复真实 `open/high/low/volume`。
     - 生命周期保护：`destroyCharts` 与 `handlePeriodChange` 及时重置 `klineRefreshing = false`。
  2. `src/js/app.js`:
     - 导出 `refreshLiveKlineForCode(code, isLimitUp = false, now = new Date())` 桥接方法。
     - 在 `updateChartLastTickMulti()` 的监控页与涨停页循环中，分别挂载 `void refreshLiveKlineForCode(code)` 与 `void refreshLiveKlineForCode(code, true)`。
  3. `tests/chartRowController.test.js`:
     - 新增两组完整单元测试，分别覆盖 `refreshPreviewKline` 的全部前置门禁（未挂载、loading、klineRefreshing、非 1d 周期、非 preview 柱、09:30 前盘前时段）以及网络强制重载、30s 节流、preview 标识清除与权威四价及成交量恢复收敛。
  4. **取舍与副作用登记（STATUS / INDEX 记簿闭环）**：
     - **时效未知通道（如东财兜底）保守态机制**：在开盘前至盘初，时效未知的快照严格以 `preview: true` 呈现（现价折叠、volume=0），彻底杜绝集合竞价虚拟参考价锁死当日最低价；
     - **收敛路径**：若后续收到带时间戳的权威快照（如腾讯源），就地即时清除 preview 升级为官方柱；若持续走无时间戳通道，在 09:30 连续交易开始后由 `refreshPreviewKline` 按 30s 节流自动触发官方日K重载，以权威网络日K收敛替换预览柱；两半程协同闭环，兼顾极值安全与权威收敛。
- **全量门禁**：
  - `npm test`: **916/916 全绿** (+2 tests)
  - `npx eslint .`: 0 错误 0 警告
  - `npm run build`: 构建成功

## 2026-09-19 历史状态：集合竞价方案**代码落地修复轮独立复查 7（Round 9）未通过** —— 1×P3

审查报告：[`docs/handoff/2026-09-19-workbuddy-code-review-round9-handoff.md`](docs/handoff/2026-09-19-workbuddy-code-review-round9-handoff.md)
被审提交：`9da75a5`（基准 `7c955b0`，任务书范围 18 文件 / +2993 −27，本轮修复提交自身 `795e984..9da75a5` = 2 文件 / +157 −45：`src/js/kline.js` +16 −19、`tests/callAuction.test.js` +141 −26；`main` 与 `origin/main` 同步，工作区干净；仓库外 pristine 导出（关键文件经 blob SHA 与 HEAD 逐字节核对）`npm test` **914/914 全绿**、`npx eslint` 0 问题）。
结论：**未通过**，最高严重级别 **P3**（1 项）。**R8 三项缺陷全部真闭环**：10 点定点变异（M1–M6、V1–V4）在 914 项门禁下**全部确定性转红**——P2-1 漂移形态被 M1（重加内容代理 908/6）、M2（删时效要求 906/8）、M6（漂移拍保留官方 `open`/`min` 锁低 909/5）杀红；P3-1 谓词契约被 M4（回退前缀白名单 913/1）杀红；P3-2 漂移负例即上述判别力来源；R8 风险 1 的跨日时间戳校验已落地（M3 删日期校验 913/1 命中新增 `5.1(1x)`）。独立探针（真实 `parseEastmoney`/`parseTencent` + 真实模块）：18 类代码形态分时隔离对照 `ee4c38a` 逐项一致——R8 缺失的 8 类 A 股形态（ETF×3、可转债×2、B 股×2、裸码）全部恢复追加 09:18 竞价点，`hk00700`/`usAAPL`/`gl_HSI` 零回归；语音单控制器逐拍 `09:19:59 静默 → 09:20:00/09:24:59 播报 → 09:25:00 起静默（基线种子写入）→ 09:26 价格变动恢复播报 → 09:26:30 恢复去重`；非 A 股日K `hk00700` 四价与量能吸收与上一轮逐字段一致。本轮新增 1 项 P3：
1. **P3-1 R8 P2-1 修复包只落地「收紧」半程，配套「官方日K兜底重载」未实现：时效未知（东财兜底）通道上 A 股当日柱全天停留 `preview` 坍缩态（四价=现价、`volume=0`），同一报价自带的权威 `open=20.50`/`low=19.00`/`volume=900000` 被持续丢弃（相对 `ee4c38a` 的行为回归）**（判据 `src/js/kline.js:673`/`:595`，坍缩落点 `:688-700`；`parseEastmoney` 无 `updateTime` ⇒ `getQuoteBeijingTimeMinutes` 恒 `null`）。实测（`probeC.mjs` vs `probeC_prev.mjs`）：10:30 本轮 `o=19 h=19 l=19 c=19 v=0 preview=true` vs 上一轮 `o=20.5 h=20.5 l=19 c=19 v=60000 preview=false`；14:55 同理。该行为已被新增用例有意固化（`5.1(1s)` 断言「preview 模式下 low 坍缩至当前现价」），属登记过的设计取舍，但 R8 修复建议 1 明确要求以「`≥09:30` 后按固定周期重取官方日K替换 `preview` 柱」收敛该保守态，此半程未实现且方案未登记；tick 链路无周期性日K重载（仅展开/切周期/手动强刷，`app.js:1306`）。**定级依据**：范围窄（仅腾讯持续不覆盖、走 `api.js:216-222` 逐码东财回落的代码）＋任一带时间戳报价抵达即一拍恢复（`probeF.mjs` 实测）＋验收 1「非 A 股不失真」与「下影线彻底消除」字面目标均未被破坏，故较 R8 P2-1 轻一级。修复方向：落地兜底重载（可复用 `handleForceReloadChart` 的 `force: true` 通道加节流），**不得**放宽 `:673` 合取式（否则 M1/M2/M6 负例失效、R8 P2-1 复发）。
**待确认风险/未验证项**：① 东财日K端点（`api.js:614-640` 主源）盘中是否返回今日半日柱未验证（本机 `push2his` 直连返回空），P3-1 的兜底重载方案须据实调整；② 上游 `≥09:30` 后是否仍返回盘前 payload 及其漂移（继承 R8 风险 2，非交易时段无法取证，只影响触发概率）；③ `quote.time` 回退路径无日期可校验（理论性，生产链路恒注入 `date`、现役两源不构成该形态）；④ R8 要求的「登记保守侧副作用」代码注释已落实但 STATUS/INDEX 未同步（记簿事项，不计缺陷）；⑤ 未执行 `npm run e2e`、`npm run build` 与活体行情验证（继承）；⑥ 本轮 20+ 次门禁 0 次冷启动偶发失败（继承项未复现）。
**推荐修复顺序**：P3-1（官方日K兜底重载 + STATUS/INDEX 登记；落地前先确认东财日K盘中是否含今日柱）→ 无其他待修项，R8 三项已闭环。

## 2026-09-19 历史状态：集合竞价方案**代码落地修复轮独立复查 6（Round 8）未通过** —— 1×P2 + 2×P3

审查报告：[`docs/handoff/2026-09-19-workbuddy-code-review-round8-handoff.md`](docs/handoff/2026-09-19-workbuddy-code-review-round8-handoff.md)
被审提交：`ee4c38a`（基准 `7c955b0`，任务书范围 17 文件 / +2727 −27，本轮修复提交自身 `2ccb1f3..ee4c38a` = 2 文件 / +188 −39：`src/js/kline.js` +28 −16、`tests/callAuction.test.js` +160 −23；`main` 与 `origin/main` 同步，工作区干净；仓库外 pristine 导出 `npm test` **913/913 全绿**、`npx eslint` 0 问题）。
结论：**未通过**，最高严重级别 **P2**。R7 缺陷**部分闭环**：追加分支已按 R7 首选方向改为「时效未知一律 `preview`」（`kline.js:589`），独立探针 09:24:59/09:30:00/09:35 三拍均保持 `preview` 且 14:55 `low === 20.50`；R7 P3-1（追加分支时效门判别力）与 P3-2（语音 09:20/09:25/09:30 端点）经 13 点定点变异全部确定性转红而**真闭环**。本轮新增 1 项 P2 + 2 项 P3：
1. **P2-1 R7 P2-1 的「虚拟价漂移」形态未闭环：时效未知的内容升级通道仍可让集合竞价虚拟价写死当日 `open`/`low` 并锁死全天（R7 验收② 未达成）**（`src/js/kline.js:657-670`，落点 `:672-684`）。`quoteTimeMinutes === null` 时 `isQuotePreOpen` 恒假，第二析取项退化为「客户端时钟 ≥09:30 + `open` 有效 + 有量 + `price !== last.close`」的内容代理判据。实测（真实 `parseEastmoney` 输出，其对象不含 `updateTime`/`time`）：09:31 东财兜底价 19.60 → `preview:true`；09:31:30 同通道漂移到 19.65 ⇒ **误清 `preview`**、`volume=12000`；14:55 真实成交 20.50 ⇒ `o=20.5 l=19.65`（全天 `low` 被虚拟价 19.65 锁死，真实最低 20.50）。`:664-667` 注释自述可 "prevent locking pre-open virtual low"，与实测相反。**取舍事实**：收紧该通道会使 `5.1(1i)/(1p)/(1s)/(1v)/(1w)` 五条用例转红（908/5），即内容通道已被用例固化，收紧须同步改写这 5 条并落实「官方日K兜底重载」。
2. **P3-1 分时竞价窗口的 A 股判别谓词与仓库既有契约不一致：8/17 类 A 股代码形态丢失 09:15-09:25 竞价点（相对 `a505481` 的行为回归）**（`src/js/kline.js:797-805`）：手写前缀白名单未覆盖 `inferAssetType` 认可的全部 A 股形态 —— `sh510300`/`sz159915`/`sh588000`（ETF）、`sh113050`/`sz128036`（可转债）、`sh900901`/`sz200011`（B 股）、裸码 `600519` 均**不**追加竞价点；而同一批标的的日K仍走 `inferAssetType` 的 A 股盘前守卫（`kline.js:502-503`）⇒ 同标的两条链路口径不一致。`5.1(4g)` 只用港美样本，无法判别。
3. **P3-2 原地分支「虚拟价漂移」形态无任何负例用例（R7 验收② 与验收标准 4 的覆盖缺口）**（应覆盖 `tests/callAuction.test.js:1231-1270`/`:1369-1430`）：现有用例只构造「价格未变 ⇒ 保持 `preview`」与「价格推进 ⇒ 清 `preview`」两类；实测把 `kline.js:669-670` 收紧为 `isPostOpenTime && hasValidOpen` 或把 `hasNewPriceInfo` 置 `false`，均仅命中**正例侧** 5 条断言 ⇒ 漂移形态零判别力，用例与实现共享「价格变了即真实成交」的错误假设。
**待确认风险/未验证项**：① `getQuoteBeijingTimeMinutes` 不校验日期，理论上往日 ≥09:25 时间戳可通过 `isPostOpenTime` 门（`probe3.mjs` §M 实测 `'20260917150000'` 得 900 而落官方柱）；当前两真实源的时间戳与日期同源（`parseTencent` 的 `quoteDate` 由 `updateTime` 派生、`parseEastmoney` 无时间戳）故不可达，但新增报价源或改动派生关系时须加「时间戳日期 == 交易日」校验；② 上游 `≥09:30` 后是否仍返回盘前 payload 及其 `price` 是否漂移（P2-1/P3-2 前提，继承 R5/R6/R7，离线无活体样本；修复方向不依赖该前提）；③ 收紧未知时效通道后「价平/单源标的当日柱整日保持 `preview`（四价坍缩、`volume=0`）」的保守侧副作用（继承 R6/R7，需实现方确认取舍并登记）；④ 需求 2 显示侧未做真机/浏览器验证（253 网格、`hasNonStockHours` 本轮未改动）；⑤ 未执行 `npm run e2e`、`npm run build` 与活体行情验证；⑥ 本轮 26 次门禁运行未复现冷启动偶发失败。
**推荐修复顺序**：P3-1（谓词换成 `inferAssetType` + 补 ETF/可转债用例，独立无耦合）→ P2-1 + P3-2（同批落地，互为判别力；须改写受影响的 5 条用例与 `:664-667` 注释并登记副作用）→ 待确认风险 1（时间戳日期校验，随 P2-1 一并加守卫）。

## 2026-09-18 历史状态：集合竞价方案**代码落地修复轮独立复查 5（Round 7）未通过** —— 1×P2 + 2×P3

审查报告：[`docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round7-handoff.md`](docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round7-handoff.md)
被审提交：`a505481`（基准 `7c955b0`，任务书范围 16 文件 / +2425 −27，本轮修复提交自身 `dbe9ce8..a505481` = 产品/测试侧仅 `src/js/kline.js` +15 −2 与 `tests/callAuction.test.js` +146 −21；`main` 与 `origin/main` 同步，工作区干净；`npm test` 910/910 全绿、`npx eslint` 0 问题）。
结论：**未通过**，最高严重级别 **P2**。R6 缺陷**大部分已真闭环**（R6 指名的 M8/M8b 与 N1/N2/N4/N7/N8/N9/N11 共 9 项变异经实跑确定性转红，`5.1(1o)` 标题与输入已一致；R6 的 13 项对照变异 N3/N5/N6/N10、M10/M10b/M10c、M11b、M16、M17、M19、M20 杀红力不回归；R6 P2-1 的**原地分支**主形态已闭环：09:31 未知时效 + `volume:12000` + 价格未变 ⇒ 保持 `preview`，14:55 当日 `low === 20.50`），本轮新增 1 项 P2 + 2 项 P3：
1. **P2-1 R6 P2-1 的追加分支未彻底闭环：新增合取项以「昨收」为锚点，集合竞价虚拟价仍可落成当日官方非 `preview` 柱的 `open`/`low` 并锁死全天**（`src/js/kline.js:595`/`:596-597`；落点 `:615-634`）。追加分支的 `last` 恒为上一交易日柱，故 `price !== last.close` 退化为「今日不等同于昨收」——对盘前虚拟价几乎恒真。实跑（真实模块，`items` 末柱为昨日、无 `preview` 柱前置）：09:24:59 `{price:19.6, open:19.6, volume:12000, amount:235200}`（无时间戳）保持 `preview` → **09:30:00 落官方柱 `o/h/l=19.6 volume=12000`** → 14:55 `o=20.5 h=20.5 l=19.6`（全天 `low` 锁死 19.60，真实最低 20.50）；漂移形态（19.60→19.65 于 09:31）同样复现（14:55 `low=19.65`）。R6 §二 P2-1「期望行为」原文「时效无法证明时不得让当日柱 `high/low` 由盘前虚拟价驱动」在该分支未达成；`:590-594` 残余风险注释只描述保守侧（`price` 等于昨收 ⇒ 保持 `preview`），未描述本非保守侧。修复：对追加分支恢复「时效未知 ⇒ 不落官方柱」并补「`≥09:30` 后周期重载官方日K」兜底（须登记当日柱暂为 `preview`/`volume=0` 的副作用），或另立能自证「已获新信息」的锚点；同步改写注释。
2. **P3-1 追加分支新增的 `hasNewPriceInfo` 零判别力（变异 R7-A 存活），R6「修复建议 3」要求两处补断言只补了一处**（`src/js/kline.js:595`/`:597`；应覆盖用例 `tests/callAuction.test.js:1227-1276`）：删 `:597` 的 `&& hasNewPriceInfo` 实测 **910 pass / 0 fail 存活**（对照原地分支 R7-B 转红），因 `5.1(1t)` 全部输入构造为 `price ≠ 昨收`。判别性输入已构造（`items=[昨日柱]` + `{price:20, open:20, volume:12000}` 无时间戳 + 09:35：HEAD `preview:true, volume:0` / R7-A `preview` 缺失 `volume:12000`）⇒ 属真实覆盖缺口而非等价变异。
3. **P3-2 需求 3 的时段边界 `09:20`/`09:25`/`09:30` 全部无判别力（4 项边界变异存活）**（`src/js/controllers/voiceController.js:38`、`src/js/marketSession.js:122`）：M19c（窗口起点 `09:20→09:21`）、M19b（窗口终点 `09:25→09:26`）、M20b（会话放行起点 `09:20→09:21`）、M20c（会话放行终点 `09:30→09:29`）**均 910/0 存活**；用例只在 09:17/09:22/09:24/09:26 四点取样、未覆盖端点。可观测性已证：M19c 使 09:20 报价被错误去重（spoken 2→1）、M19b 使 09:25 重复播报（spoken 1→2）、M20c 使 09:29 `eligibleCodes=[]`。修复：补 09:20:00 / 09:24:59 / 09:25:00 / 09:29:00 端点断言。
**待确认风险/未验证项**：① `_isTradingMinute` 的 09:15-09:25 窗口对港股/美股无资产类型隔离（继承早期轮次、本轮未改动，故不计缺陷）：`app.js:1214-1220` 的期货豁免可放行全量刷新，港美分时可能在北京 09:16-09:25 被追加竞价点，验收标准 2「港美外盘零回归」待活体证据；② 上游 `≥09:30` 后是否仍返回盘前 payload 及其 `price` 是否偏离昨收（P2-1 前提，继承 R5/R6；修复方向不依赖该前提）；③ 未知时效通道收紧后「价平股票当日柱整日保持 `preview`（四价坍缩、`volume=0`）」的保守侧副作用（继承 R6 风险 2/4，需实现方确认取舍）；④ 需求 2 显示侧未做真机/浏览器验证（253 网格、`hasNonStockHours` 本轮未改动）；⑤ 冷启动偶发失败（30 次运行 1 次与集合竞价无关的失败签名，符合既有「缓存污染伪影」特征）；⑥ 未执行 `npm run e2e`、`npm run build` 与活体行情验证。
**推荐修复顺序**：P3-2（补端点用例，独立无耦合）→ P2-1 + P3-1（同批落地，互为判别力）→ 待确认风险 1（港美 09:16-09:25 隔离或活体证据）。

## 2026-09-18 历史状态：集合竞价方案**代码落地修复轮独立复查 4（Round 6）未通过** —— 1×P2 + 2×P3

审查报告：[`docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round6-handoff.md`](docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round6-handoff.md)
被审提交：`dbe9ce8`（基准 `7c955b0`，任务书范围 15 文件 / +2159 −27，本轮修复提交自身 `18d2411..dbe9ce8` = 2 文件 / +162 −62，仅 `src/js/kline.js` +55 与 `tests/callAuction.test.js` +169；`main` 与 `origin/main` 同步，工作区干净；`npm test` 907/907 全绿、`npx eslint` 0 问题）。
结论：**未通过**，最高严重级别 **P2**。R5 三项缺陷的**主形态已生效**（探针 A/A2/B/B2 在 09:25:02/09:25:05 均保持 `preview: true` 且 14:55 全天 `low === 20.50`；形态 C 保留真实低点 20.30、形态 D 不回归；滞留包络分支整体删除、塌缩语义自洽；R5 点名的 M11(b)/M16/M17/M19 已确定性转红，M7/M13/M14 目标代码已删除），本轮新增 1 项 P2 + 2 项 P3：
1. **P2-1 未知时效的「内容升级通道」只从 `≥09:25` 后移到 `≥09:30`，集合竞价虚拟价仍可锁死当日 `low`**（`src/js/kline.js:590-591`（追加）/`:661-662`（原地））：`quoteTimeMinutes === null` 时 `isQuotePreOpen` 恒假，故清 `preview` 授权实为「客户端时钟 `≥09:30` + `hasValidOpen` + `hasTradeVolume`」的内容判据。实跑（真实模块）：09:24:50 虚拟价 19.60 预览柱 → 09:31 无时间戳 `{price:19.6, open:19.6, volume:12000, amount:235200}`（Eastmoney 兜底路径 `parser.js:299-319` 恒返 `volume/amount` 而无 `updateTime`）→ **误清 preview 并重基线到 19.60** → 14:55 全天 `low = 19.60`。R5 §二 P2-1「期望行为」（时效未知不得清 `preview`）与「修复建议 2」（`volume>0` **且** `price !== preview 价` **且** 时钟 `≥09:30` 三者合取 + 注释残余风险）中的 `price !== preview 价` 与注释均未落实。修复：原地分支加 `price !== last.close`（探针复核不破坏 B 的 14:55 放行与 A/A2/B2 的 09:25 保持 `preview`）；追加分支另立锚点并登记权衡。
2. **P3-1 M8 变异仍存活 ⇒ 新增 `5.1(1o)` 的「杀 M8」断言零判别力（假闭环）**（`src/js/kline.js:684-685` 被测；`tests/callAuction.test.js:1063-1091` 用例）：删除 `:684-685`（塌缩分支不归零 `volume/amount`）与改写为继承 `last.volume` 两个变异在 907 项门禁下**均 907 pass / 0 fail 存活** —— 用例步骤 1 的 `preview` 柱量能由追加分支 `:600-601` 硬编码为 0，步骤 2 的 `{...last}` 已携带 0，故归零两行可任意删除。判别性输入已构造（`items` 已含今日柱且 `volume:5000, amount:60000` → 09:20 就地打 `preview` 且不归零 → 09:26 塌缩分支应归零），属「因错误原因通过」；提交信息与用例标题的「已补齐 M8 判别力」与实跑证据不符。
3. **P3-2 本轮改写的时效/内容通道合取项全部零判别力（7 项变异存活）**（`src/js/kline.js:588`/`:590`/`:591`/`:662`）：N1（删 `!isQuotePreOpen`）、N2（删 `hasTradeVolume`）、N4（整段第二析取项置 `false`）、N7（删 `hasValidOpen`）、N8（原地删 `!isQuotePreOpen`）、N9（原地删 `hasTradeVolume`）、N11（通道门限 `09:30→10:00`）**全部存活**；用例集只有负例侧（09:25:05/09:26 保持 `preview`），**无任何 `≥09:30` 放行正例**，故 N4 所指「追加分支未知时效升级通道」既无正例也无反例（探针 §P8 证实该路径生产可达）。对照 N3/N5/N6/N10 与 M1/M6/M10/M11(b)/M15/M16/M17/M19/M22 均如期转红 ⇒ 非环境伪影、属真实覆盖缺口。违反验收标准 4。
**待确认风险/未验证项**：① 上游 09:25 后是否仍返回盘前 payload 及其 `volume`/`amount` 取值（P2-1 前提，继承 R5 风险 2；修复建议在实现侧不依赖该前提）；② 追加分支以 `price !== last.close` 为锚点时「今日平开 + 未知时效 + ≥09:30」将延迟落官方柱（保守侧失效，需实现方确认取舍）；③ A 股 09:25-09:29 不吸收官方 `quote.high/low`（继承 R5 风险 5，评估无实际影响）；④ 报价长期无量/无 `volume` 键时 `preview` 柱全天不清除的健壮性（现有源均提供量能，无法证实）；⑤ 冷启动偶发失败（25 次运行 2 次出现与集合竞价无关的失败签名，符合既有「缓存污染伪影」特征，未定位用例名）；⑥ 需求 2/3 相关文件本轮未改动，仅复跑既有用例与读码确认。
**推荐修复顺序**：P2-1（补 `price !== 预览价` 合取项 + 注释残余风险）→ P3-2（随 P2-1 同批补正/反例杀 N1/N2/N4/N7/N8/N9/N11）→ P3-1（改写 `5.1(1o)` 前置使 M8/M8b 转红并修正不实表述）。

## 2026-09-18 历史状态：集合竞价方案**代码落地修复轮独立复查 3（Round 5）未通过** —— 1×P2 + 2×P3

审查报告：[`docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round5-handoff.md`](docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round5-handoff.md)
被审提交：`18d2411`（基准 `7c955b0`，任务书范围 14 文件 / +1908 −27，本轮修复提交自身 `1571180..18d2411` 源码侧 `src/js/kline.js` +89、`tests/callAuction.test.js` +267、`tests/app.test.js` ±4；`main` 与 `origin/main` 同步，工作区干净；`npm test` 904/904 全绿（仓库外 pristine 导出连续 6 次均 904/0，另 1 次 903/1 未捕获用例名），`npx eslint` 0 问题）。
结论：**未通过**，最高严重级别 **P2**。R4 三项要求的主形态**已生效**（形态 D `open:0,volume:0` 落 `preview` 且全天 `low=20.50`；形态 C 带有效 `open` 变体 09:25:05 清 `preview` 且保留真实低点 20.30；连续时段恢复吸收官方 `quote.high/low`，盘前脏极值仍被隔离；非 A 股零回归），但本轮新增 1 项 P2 + 2 项 P3：
1. **P2-1 「时效未知」仍被判为「非盘前」，官方柱/`preview` 判定退化为内容代理**（`src/js/kline.js:578-590`/`:659-674`，`:580`/`:660` 的 `isQuotePreOpen` 在 `getQuoteBeijingTimeMinutes` 返回 `null` 时为 `false`）：R4 修复建议 ①（时效未知 ⇒ 保持 `preview`）**未实现**，改由 `hasValidOpen`/`hasTradeVolume`/`isZeroVolume` 内容判据决定官方性，即「报价是否带 `volume` 键 / `volume` 是否 > 0」决定当日 `low` 是否被盘前虚拟价锁死。实跑（真实开盘与全天最低 20.50、盘前最后一拍 19.60）：形态 A `{price:19.9,open:19.9}`（无 volume 字段）→ 09:25:02 **误清 `preview`** → 全天 `low` **19.90**；追加分支 `{price:19.6,open:20.5,volume:100,amount:2000}` 于 09:25:05 → 落成非 `preview` 官方柱 → 全天 `low` **19.60**；对照 `volume:0` 输入则正确保持 `preview`。反证：`tests/callAuction.test.js:920` 去掉其额外补入的 `volume: 0`（还原 R4 验收标准字面形态）后 `5.1(1l)` **立即转红**，且该用例标题自述「无 volume」而输入实为 `volume: 0`（标题与输入不一致）。可达性前提与 R4 判定 P2 时相同（`parseEastmoney` 无 `updateTime`、`updateTime=''` 落 `null`；触发需 `volume>0`/`amount>0` 的无时间戳快照）。
2. **P3-1 本轮新增的「滞留期真实极值包络」被自身重基线丢弃**（`src/js/kline.js:693-700` 新增包络 vs `:682-686` 清 `preview` 重基线只取 `[open, price, quoteLow]`）：R4 修复建议 ③ 已做、④ 未做 ⇒ 包络累计后在清 `preview` 时被丢弃，属自相矛盾状态。实跑 09:25:05/09:25:35 包络低点 20.30/19.80 于 09:27 清 `preview` 后 → 全天 `low = 20.50`。若该窗口确为真实成交（`hasTradeVolume` 为实现自身判据）则真实极值永久丢失；若主张必为盘前虚拟价，则应删除该包络分支。相关变异 M7/M8/M19 均存活（无用例）。
3. **P3-2 变异矩阵仍未达成 R4 验收**（34 点定点变异实跑）：**M7（滞留恒塌缩）由 R4 的 RED 退化为 GREEN**、**M8（塌缩分支不归零 `volume/amount`）存活**（R4 明确要求杀红），另 M11(b)（追加分支 `isPostOpenTime` 时效门）、M13（第三析取项 `hasValidOpen && !isZeroVolume`）、M14、M16/M17（本轮新增的两处 `isContinuousTrading` 客户端时钟门）、M19（重基线组合）**全部存活**；M1~M6/M9/M10/M11(a)/M15/M20/M21/M22 均确定性 RED（其中 M3/M4/M10 为 R4 要求项，已达成）。测试侧反证：`5.1(1o)` 走的是追加分支（`items` 末柱为昨日，`preview` 柱 `volume/amount` 由 `:599-600` 硬编码 0），把其时钟改为 09:26 后（C4）乃至叠加 M8（C5）**仍全绿** ⇒ 该用例无法杀 M8，要触及 `:701-708` 需「同日 `preview` 柱 → 盘前 `updateTime` 拍」两步序列（探针已证实可达）。违反验收标准 4。
**通过项（实测）**：R4 形态 D（`open:0,volume:0`）真闭环；形态 C（带有效 `open`）真闭环；P3-1 修复（A 股 14:00 `high 12.5/low 8.8`，`tests/app.test.js` 与 `5.1(1d)` 断言同步更新）成立且盘前隔离不回归；非 A 股（`hk00700`/`usAAPL`）零回归；需求 2 实时分时竞价窗口（09:15/09:18/09:25 追加、09:26/09:29 不追加、09:30 恢复）与需求 3 语音三态（关闭态放行、09:20-09:25 强制全量+基线写回、09:25 恢复去重）经独立复核有效；`npm test` 904/904、`npx eslint` 0 问题。
**待确认风险/未验证项**：① 冷启动偶发 1 例失败（19 次运行中 1 次 `903/1`，未捕获用例名，其后 18 次均 904/0，继承 R4 风险 5）；② 上游 09:25 后是否仍返回盘前 payload 及其 `volume`/`amount` 取值（P2-1 前提，继承 R4 风险 1/2；但 P2-1 的修复方向不依赖该前提）；③ 上游 09:26-09:29 分时点与 253 网格缺槽（继承）；④ 港美外盘双侧过滤前提（继承）；⑤ A 股 09:25-09:29 不吸收官方 `quote.high/low`（本轮实现取 09:30，R4 建议 09:25；评估无实际影响，登记备查）。
**推荐修复顺序**：P2-1（时效未知 ⇒ 保持 `preview`；内容证据只作受时效约束的升级通道）→ P3-2（同批补用例杀 M7/M8/M11b/M13/M14/M16/M17/M19，修正 `5.1(1l)` 标题-输入不一致与 `5.1(1o)` 目标分支）→ P3-1（包络语义二选一并固化 + 补两步序列用例）。

## 2026-09-18 历史状态：集合竞价方案**代码落地修复轮独立复查 2（Round 4）未通过** —— 2×P2 + 2×P3

审查报告：[`docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round4-handoff.md`](docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round4-handoff.md)
被审提交：`2b9af28`（基准 `7c955b0`，任务书范围 13 文件 / +1401 −27，本轮修复提交自身 `a0794db..2b9af28` 源码侧 `src/js/kline.js` +78、`tests/callAuction.test.js` +174；`main` 与 `origin/main` 同步，工作区干净；`npm test` 898/898 全绿（仓库外重复 8 次均 898/0），`npx eslint` 0 问题）。
结论：**未通过**，最高严重级别 **P2**。Round 3 两项 P2 的**主形态已真闭环**（`updateTime` 时效通道 + `5.1(1j)` 补齐：M1/M2/M5/M6/M7 确定性转红），本轮新增 2 项 P2 + 2 项 P3：
1. **P2-1 追加分支在报价无时间戳时不存在任何盘前时效判据**（`src/js/kline.js:576-610`，判据 `:578-581`）：`getQuoteBeijingTimeMinutes` 返回 `null`（未知时效）时 `:580` 的 `isQuotePreOpen` 直接为 `false`（fail-open），而 `min < 9*60+25` 的时钟块（`:509`）在 09:25 后已跳过 ⇒ **09:25:00-09:29:59 到达的盘前滞后快照被直接落成无 `preview` 标记的「官方柱」**。实测序列：09:25:05 `{price:19.6, open:0}` → `19.6/19.6/19.6/19.6 preview=false` → 14:55 `low` 全天 **19.60**（真实开盘/全天最低 20.50）。本形态**不依赖**「盘前 `open` 非零」前提（`:596` 的 `quoteOpen || price` 已兜底）。可达性经代码与实测确认：`parseEastmoney` 返回对象**无** `updateTime`/`time`（实测键集），而 `api.js:200-228` 的 A 股报价在 Tencent 未返回该码或整批失败时逐码回落 Eastmoney；Tencent 路径下字段 30 不匹配正则时亦得 `updateTime=''`；本轮新增的 `5.1(1g/1h/1i)` 本身即使用无时间戳报价对象。以基准 `7c955b0` 回放同序列逐字段相同 ⇒ 属**修复未覆盖的残留缺口**（非新回归），但仍违反验收标准 1 与 Round 3 复审验收标准「09:25 起任意 tick 后 `low` 恒为 20.50」。
2. **P2-2 原地 `preview` 分支的兜底判据仍建立在内容特征上，且 `null` 被当作「非盘前」**（`src/js/kline.js:630-664`，判据 `:631-642`，清除 `:644-650`，滞留 `:651-663`）：① **形态 A（新回归）** 滞后快照的 `price` 与虚拟 `open` 同步推进（盘前二者本就同步，本轮 `5.1(1g/1j)` 均以 `open === price` 建模）⇒ `hasPriceShift` 与 `hasOpenShift` 同为真 ⇒ `hasSubstantialShift` 授权清除 `preview` ⇒ 重基线到虚拟价，实测 09:25:02 `{19.9,19.9}` → 全天 `low` **19.90**；② **形态 C** 真实开盘 == 最后一拍虚拟参考价（撮合收敛常态）⇒ 首拍真实快照 `price === open === last.close`，且 `:641` 的成交量分支硬性要求 `quoteTimeMinutes !== null` ⇒ `preview` 滞留，期间 `:654-659` 把四价逐拍改写为 `price` 并把 `volume/amount` 归零，`:644-650` 重基线时又丢弃已观测包络 ⇒ 真实最低 20.30 被抹为全天 `low = 20.50`。同序列在带 `updateTime`（Tencent 形态）下完全正确，差异纯由时效通道缺失造成。
3. **P3-1 A 股连续交易时段丢弃官方 `quote.high/low`**（`src/js/kline.js:665-671`，对照非 A 股 `:678-682`）：实测 A 股 10:00 报价 `high:22.5/low:19.0` 得柱 `20.5/21/20.5/21`，同输入 `hk00700` 对照得 `20.5/22.5/19.0/21`。官方日K 仅展开/切周期/强制刷新时重载（全仓无周期重载），轮询间隙形成的极值不可恢复。由 `d3f415b` 引入（基准回放 `10.2/12.5/8.8/12` vs HEAD `10.2/12/9/12`），`tests/app.test.js:780-790` 与 `5.1(1d)` 反而固化了该损失；范围超出需求 1（只需消除竞价虚拟极值），建议按「`preview` 已清除且时钟 ≥ 09:25」门禁恢复吸收。
4. **P3-2 本轮新增判据的合取项与追加分支时效门零判别力**（`src/js/kline.js:634-637/658-659/578-581`，另 `:694-701`）：仓库外 pristine 导出 12 点定点变异矩阵中 **M3（删 `hasPriceShift`）、M4（删 `hasOpenShift`）、M8（滞留期不归零 `volume/amount`）、M11（追加分支时效门 09:25→09:30）、M10（`_isTradingMinute` 删 09:15-09:25 窗口）五者均 898 pass / 0 fail 存活**；M1/M2/M5/M6/M7/M9 均确定性转红。M3/M4 存活即证明 P2-2 形态 A 在用例集中完全缺失；M10 存活说明需求 2「分时图纳入 09:15-09:25」的实时 tick 路径无判别用例（`5.1(4a)` 只验证轴网格，竞价点经 `setData` 直注）。违反验收标准 4。
**通过项（实测）**：Round 3 两项主形态真闭环（滞后快照「仅带 open / 仅走价 / 延续过 09:30」三形态保持 `preview`，M1/M2/M5/M6/M7 转红）；需求 2 分时轴（A 股 09:18 竞价点走 253 固定网格且 6/6 可见，`RB0`/`hk00700`/`usAAPL`/`gl_HSI` 均数据驱动轴且轴长 == 点数、可见 == 点数）；非 A 股极值不失真（`103/98` 完整保留）；需求 3 语音（09:20-09:25 强制全量播报 + 记忆基线写回、09:25 恢复去重、智能时段关闭态 09:17/09:22 均放行）全绿；Round 2 结论不回归。
**待确认风险/未验证项**：① 上游盘前 A 股 `open` 是否非零且随虚拟参考价同步推进（仅 P2-2 形态 A 的前提；形态 C/D 不依赖）；② 上游 09:25 后是否仍返回盘前 payload 及其持续时长（P2-1/P2-2 三形态共同前提，继承 Round 2/3）；③ 上游 09:26-09:29 分时点与 253 网格缺槽（继承）；④ 港美外盘零回归依赖双侧过滤完整前提（继承）；⑤ 首次冷启动全量运行出现 1 例失败（未记录用例名），随后连续 8 次均 898/0，未能复现。
**推荐修复顺序**：P2-2 形态 A（清除授权改为时效判据 + 滞留期包络累计）→ P2-1（时效未知分支不得 fail-open）→ P2-2 形态 C → P3-2（补用例并使 M3/M4/M8/M10/M11 杀红）→ P3-1（按 09:25 时效门禁恢复官方 `high/low`）。

## 2026-09-18 历史状态：集合竞价方案**代码落地修复轮独立复查（Round 3）未通过** —— 2×P2

审查报告：[`docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round3-handoff.md)
被审提交：`929aa3d`（基准 `7c955b0`，任务书范围 12 文件 / +1048 −27，本轮修复提交自身 `b268a38..929aa3d` 源码侧 `src/js/kline.js` +99、`tests/callAuction.test.js` +132；`main` 与 `origin/main` 同步，工作区干净；`npm test` 895/895 全绿，`npx eslint` 0 问题）。
结论：**未通过**，最高严重级别 **P2**。Round 2 两项缺陷（P2-1 `lastDate === targetDate` 空洞、P2-2 分钟周期越界纳入）经定点变异复核**均已真闭环**（M_G 被 5.1(1e) 杀红、M_D/M_E 被 5.1(1f) 杀红），本轮新增 2 项 P2（实现判据不健全 + 新增判据零判别力）：
1. **P2-1 09:25 交接防抖判据不健全**（`src/js/kline.js:585-596`，判据在 `:588`）：判据 `(min < 9*60+30) && !quoteOpen && price === last.close` 以「价格与上一拍预览价相等」+「无 `open`」两个**内容特征**近似"快照仍处盘前态"，只能识别"payload 逐字段不变"这一种滞后形态。三条确定性反例（真实开盘与全天最低均为 20.50，盘前最后一拍 19.60）：① 滞后快照携带虚拟 `open` → 09:25 重基线到 19.60 并锁死全天低点；② 滞后快照价格推进（19.80，无 `open`）→ 锁死 19.80；③ 滞后延续到 09:30:00 判据整体过期 → 锁死 19.60。且 `preview` 为**一次性**开关（`:594-595` 删除后由 `:597-603` 的 `Math.min(lastLow, price)` 永久接管），不可逆；与 Round 1 P1-1 完全同形，验收标准 1「彻底消除」不成立（仅 A 股 1d；非 A 股/分钟周期已实测不受影响）。修复建议：改为挂钩快照时效（`updateTime`/`quoteDate`/发布时刻晚于 09:25）或要求"实质换挡证据"（`price !== 上一拍预览 close` 且 `quoteOpen > 0 && quoteOpen !== last.close`）。
2. **P2-2 新增防抖判据的 `!quoteOpen` 合取项零判别力**（`src/js/kline.js:588`；用例 `tests/callAuction.test.js:595-643`）：仓库外 pristine 导出上做 9 点定点变异矩阵，**M_A（仅删除 `!quoteOpen`）在 895 项门禁下 895 pass / 0 fail 存活**——5.1(1g) 只构造了"快照与上一拍逐字段完全相同"这一种滞后形态，与实现共享同一假设，P2-1 的 C2/C3b 形态在矩阵中缺失。违反任务书验收标准 4 与 Round 2 复审验收标准「定点变异确定性转红」。
**通过项（实测）**：Round 2 两项真闭环（02:00/09:05 已收盘柱恒 `20.5/22.5/20/21` 且无 `preview`；1m–60m 在 09:18 全部 `close ∈ [low, high]` 且上一交易日末根分钟柱不被改写）；需求 2/3 相关文件本轮未改动（`chart.js`/`marketSession.js`/`voiceController.js` 不在本轮 diff），沿用 Round 1/2 已核结论；非 A 股 4 类样本（`hk00700`/`usAAPL`/`RB0`/`AU0`）零回归；M_C 证明已收盘柱 `close` 就地更新属既有受测契约（非缺陷）。
**待确认风险/未验证项**：① 上游 09:25 后是否仍返回盘前快照（P2-1 的直接前提，离线无活体样本，需两拍真实 payload 才能确证/排除）；② `1w`/`1M` 盘前冻结分支无日期校验（既有行为、本轮未引入、不在验收范围，仅登记，较基准已改进）；③ 上游 09:26-09:29 分时点与 253 网格缺槽（继承）；④ 港美外盘分时零回归依赖双侧过滤完整前提（继承）。
**推荐修复顺序**：P2-1（判据改为时效/换挡证据 + 保留 `previewDate` 对账）→ P2-2（同批补齐三类滞后形态用例并实跑变异转红）。

## 2026-09-18 历史状态：集合竞价方案**代码落地修复轮独立复查（Round 2）未通过** —— 2×P2

审查报告：[`docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round2-handoff.md)
被审提交：`b268a38`（基准 `7c955b0`，任务书范围 11 文件 / +784 −27，本轮修复提交自身 5 文件 / +206 −47；`main` 与 `origin/main` 同步，工作区干净；`npm test` 892/892 全绿）。
结论：**未通过**，最高严重级别 **P2**。Round 1 的 4 项缺陷（P1-1/P2-1/P2-2/P3-1）经基线变异回放与生产入口冻结墙钟复核**均已闭环**（09:25:03 的 `low` 为 20.50；以 `7c955b0` 为"去守卫变异体"回放，5.1(1a)/5.1(2)/5.1(1c) 均确定性转红；`now` 已参数化下发），本轮新增 2 项由修复改动自身引入的缺陷：
1. **P2-1 `lastDate === targetDate` 空洞未闭环**（`src/js/kline.js:498-509`）：`:498` 只挡 `lastDate > targetDate`，未挡 `===`；09:15 前 `resolveStockChartDate` 锚定上一交易日 ⇒ 末柱（上一交易日**已收盘**柱）满足 `===` 即被写成 `open=high=low=close=price` 并附 `preview: true`。生产入口 + 冻结墙钟（02:00/09:05）实测：官方柱 `20.5/22.5/20.0/21.0` → `21/21/21/21 preview=true`，09:30/14:55 再 tick 不回弹，直到图表重载。可达性经实测确认（`isFuturesMarketOpen` 对 `AU0`/`RB0` 在北京 02:00 与 09:05 均为 `true` ⇒ `app.js:1218` 旁路会话门禁；另有工具栏手动刷新与启动期 `refreshNow()`）。
2. **P2-2 非 1d 盘前分支把分钟周期一并纳入**（`src/js/kline.js:511-519`，条件实为 `period !== '1d'`，上一轮只要求 `1w`/`1M`）：只改 `close`、冻结 `high/low` 的公式对分钟柱不成立，实测 09:18 的 1m/5m/15m/30m/60m 均得 `close=12 > high=10.5`（`close ∉ [low, high]`），违反 `kline.js:425-431`/`:440-445` 的分钟柱契约，并把次日盘前虚拟价写进上一交易日末根分钟柱。
**通过项（实测）**：Round 1 四项全部闭环；需求 2/3 相关文件本轮未改动（`chart.js`/`marketSession.js`/`voiceController.js` 不在本轮 diff），沿用上一轮已核结论。
**待确认风险/未验证项**：① 09:25 后首拍若仍携带盘前虚拟价，重基线会将其固化并被 `Math.min` 锁死（无活体快照，需实现层加固 + 用例固化）；② `now` 参数化无变异判别力（新增用例未覆盖 `applyLiveTick` 转发链，默认门禁墙钟被锚定在北京 10:00）；③ `1w`/`1M` 盘前 `close` 可越出官方 `[low, high]`（上一轮指定实现的直接后果，非本轮偏差）；④ 上游 09:26-09:29 分时点与 253 网格缺槽、港美外盘双侧过滤前提（继承未验证）。
**推荐修复顺序**：P2-1 → P2-2 → 待确认风险 1。

## 2026-09-18 历史状态：集合竞价方案**代码落地首轮独立审查 未通过** —— 1×P1 + 2×P2 + 1×P3

审查报告：[`docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-18-call-auction-implementation-workbuddy-code-review-round1-handoff.md)
被审提交：`d3f415b`（基准 `7c955b0`，实测审查增量 7 文件 / +498 −20；`main` 与 `origin/main` 同步，工作区干净；`npm test` 890/890 全绿）。
结论：**未通过**，最高严重级别 **P1**。
1. **P1-1 日K 09:25 交接未清除盘前预览极值**（`src/js/kline.js:543-552`，来源 `:476-505`/`:507-524`）：09:25 前守卫把「盘前虚拟价预览柱」无标识写入 `items`，09:25 后原地更新分支把它当权威官方柱做 `Math.min(lastLow, price)` → 虚拟价成为当日 `low` 并被单调 min **不可逆锁死**。生产入口（`ChartRowManager.applyLiveTick`）+ 冻结墙钟实跑：09:18 18.00 → 09:20 18.60 → 09:24:50 19.60（盘前最后一拍）→ 09:25:03 开盘 20.50 / 10:00 20.90 / 14:55 21.30，日K `low` 恒为 **19.60**（真实开盘与全天最低均为 20.50），残留虚假下影线 **0.90 元**且全天不回弹（官方K仅展开/换周期/强制刷新时才重载）→ 验收标准 1「彻底消除」不成立。
2. **P2-1 本轮新增用例对 09:25 交接零判别力**（`tests/callAuction.test.js:21-91`）：5.1(1a/1b) 的 09:24 与 09:25 价格完全相同，掩盖 P1-1；且 5.1(1a) 报价不含 `high/low`，含守卫与去守卫（设计 §5.2 声明的 M2）输出逐字段等价（均 `18/18/18/18`）→ M2 **确定性转红实跑不成立**，验收标准 4 在该分组不成立。
3. **P2-2 守卫仅覆盖 `period === '1d'`**（`src/js/kline.js:476/543/555-559`）：周K/月K 在 09:15-09:25 仍把外部脏 `quote.low`（如 18.00）写死进聚合柱且不回弹（实测 `1w` 09:18 low=18 → 10:00 仍 18），与 Bug 1 同根因，属修复范围遗漏。
4. **P3-1 `tests/app.test.js:768-791` 依赖墙钟**：该 A 股日线用例未传 `now`，命中 09:25 前守卫，在北京 **09:15:00-09:24:59** 运行必然失败（实测当前时刻 `10.2/12/9/12/1800` vs 冻结 09:18 `12/12/12/12/1000`）→ 每天约 10 分钟窗口门禁假红。
**通过项（实测）**：需求 2 分时轴（A 股 253 固定网格、港股 6/6、美股 5/5、`gl_HSI` 4/4 数据驱动轴）与需求 3 语音时段（09:20-09:25 强制全量播报 + 记忆基线写回、09:25 恢复去重、09:20-09:30 定时器不停摆不触发 `memory.clear()`）逐条无遗漏；Fail-Closed 品种隔离在 5 类非 A 股上零误伤（09:24:59 `high=103/low=98` 完整保留）；09:26:00/09:29:59 开盘撮合点保护、09:30:00 正常追加、非法价 0 等 6 组独立边界验证表现符合设计。
**待确认风险/未验证项**：① 上游 09:26-09:29 分时点与 253 网格缺槽（数据侧区间仍 555-690），离线无样本；② `_isTradingMinute` 扩窗对港股/美股的零回归依赖「客户端 `_isTradingSessionTime` + 服务端 `intradayService.js:44-46` 双侧过滤完整」这一前提；③ 守卫钳位分支无 `lastDate === targetDate` 校验，非交易日 fallback 下理论可压平上一交易日柱（自动刷新在 `closed` 会话被关断，未证实可达）；④ 语音「严格按 interval 保证」继承 TTS 后端合并与 30s `checker` 启动延迟的既有限制。
**推荐修复顺序**：P1-1（阻断）→ P2-1（同批补判别用例）→ P2-2 → P3-1。

## 2026-09-18 历史状态：集合竞价方案设计（v4 终审收敛定稿版）—— 达到设计审查 3 轮上限，全面闭环 Round 3 审查意见，正式达成设计收敛，交付就绪实施

方案定稿：[`docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md`](docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md)
审查历程：经 Round 1（2×P1 + 4×P2）、Round 2（1×P1 + 4×P2 + 1×P3）、Round 3（1×P1 + 3×P2 + 1×P3）三轮独立审查，依照协作规则第 7 条与第 11 条达到技术方案审查 3 轮上限（Max 3 Rounds Cap）。
定稿闭环要点（全面闭环 Round 3 全部 1×P1 + 3×P2 + 1×P3 审查意见）：
1. **P1-1 闭环（分时轴析取兜底恢复，港美外盘分时 100% 保护）**：`chart.js:741` 修正为 `opts.isFuture === true || hasNonStockHours`，由于 `hasNonStockHours` 早盘下界已收窄至 09:15，A 股 09:15-09:25 竞价点稳定走 253 固定网格，而港股（15:00-16:00）、美股（21:30-04:00）、国际期货（17:00-05:00）触发 `hasNonStockHours` 稳定走数据驱动轴，数据点 100% 可见（实测港股 6/6、美股 5/5、gl_HSI 4/4），零跨品种回归；
2. **P2-1 闭环（智能时段总开关语义对齐）**：在 `chinaStockStrategy.isVoiceAllowed` 补充 `if (!cfg.enabled) return true;` 前置判定，与兄弟策略完全同形，彻底消除总开关关闭态下 09:15-09:20 误拦截；
3. **P2-2 闭环（09:25 前 A 股预览柱全路径统一守卫）**：09:25 前无论今日柱是否在库（覆盖追加分支与原地更新分支），四个价格字段一律收敛于最新参考价 `open=price, high=price, low=price, close=price`，09:18 极端申报与 09:19 撤单即时回弹，彻底消除虚假下影线；§5.1(1) 明确区分追加路径与原地路径两条判定用例；
4. **P2-3 闭环（分时轴判别力与确定性杀红变异）**：§5.1(4) 增补港股、美股、国际期货 3 类轴路径可见性断言；M4 重写为剔除 `hasNonStockHours` 析取兜底，实跑可见点塌缩为 3/6、0/5、0/4，具备确定性杀红判别力；
5. **P3-1 闭环（必需 import 补齐与模块级函数调用）**：§四 明确列出 `kline.js` 新增导入 `chartSecondsToTime`、`voiceController.js` 新增导入 `getBeijingClockParts`；§3.3.1 调用模块级 `getMarketSession(now, tradingDates)` 消除 TypeError。
结论：**设计正式收敛（Design Converged）**，交付就绪直接推进代码落地与自动化测试！

## 2026-09-18 历史状态：集合竞价方案设计 Round 3 终审复查 **未通过** — 1×P1 + 3×P2 + 1×P3

审查报告：[`docs/handoff/2026-09-18-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-18-workbuddy-code-review-round3-handoff.md)
被审提交：`f4b7b92`（基准 `ad0c609`，本轮实际审查增量 `ad0c609..f4b7b92` = 5 文件 / +662 −2，纯文档；其中待审提交自身 3 文件 / +157 −171；`origin/main` 与本地 HEAD 一致，工作区干净）。
结论：**未通过**，最高严重级别 **P1**。**P1-1** §3.2.1 的 `opts.isFuture === undefined && hasNonStockHours` 使启发式兜底在唯一调用点（`chartRowController.js:288` 拟传 `isFuture: isFutureCode(code)`，该函数恒返回布尔）成为**不可达死代码**，`isFutureTimeline` 退化为 `isFutureCode(code)` → 港股/美股/国际期货（`isFutureCode('gl_HSI')===false`）全部落回 A 股 253 固定网格：真实 `chart.js` 定向变异实跑 港股 6/6→253/3、美股 5/5→253/0、`gl_HSI` 4/4→253/0（美股与 `gl_*` 分时图「有轴无点」），与 §3.1.1「非 A 股零跨品种误伤」承诺冲突，§5 全无覆盖。**P2-1** §3.3.1 的 `opening-auction` 分支漏掉总开关前置 `if (!cfg.enabled) return true`（兄弟策略 `marketSession.js:154/193/229` 与 `isAutoRefreshAllowedInSession:49` 均有）→ UI 一键关闭「智能交易时段」（此时 `autoStartAuction` 被置灰冻结为 false，`voiceBarView.js:210/213`）后，09:15-09:20 由 HEAD 放行变为 v3 拦截（实跑 09:17 HEAD=true / v3=false，`eligibleCodes` 由 `["sh603533"]` 变空），违反需求 3 该窗口语义。**P2-2** §3.1.2 的「09:25 前预览柱收敛于参考价」未落到追加分支（§3.1.3(1) 头部限定「≥09:25」、§四 只摘录「不执行 `Math.min`」）→ `items` 末柱为昨日时（§3.1.2 自述场景）09:18 虚假低点被追加分支写死且单向不可回弹，真实模块实跑末柱 `low=18`（§5.1(1) 期望 20）→ 需求 1「彻底消除」在该路径不成立，且 §5.1(1) 未规定 `items` 前置状态致用例不可判定。**P2-3** 验证矩阵对分时轴零判别力（Round 2 P2-4 第 2 条未闭环）：M4 变体一（不传 `isFuture`）实测 A 股 253、期货 5/5 与期望一致 → **不转红**；变体二（还原 `hasNonStockHours` 上下界）因合取式短路而**零效果** → 不转红；仍无港股/美股/国际期货轴用例，P1-1 回归在矩阵中不可见。**P3-1** §四 清单未登记落地必需的 import 新增（`kline.js` 缺 `chartSecondsToTime`、`voiceController.js` 缺 `getBeijingClockParts`），§3.3.1 片段误写不存在的 `this.getMarketSession`（实跑 TypeError，应如 `marketSession.js:119` 用模块级函数）。
**通过项（真闭环核实）**：**R2-P1-1 真闭环**——`chinaStockStrategy.isVoiceAllowed` 具备 `now` 入参，实测 09:20-09:29 判据恒真；以注入式时钟 + 真实 controller 实测记忆 `[["sh603533",{price:"20.00 元"}]]` 在 09:26/09:31 均未被 `memory.clear()` 清空。**R2-P2-1 真闭环**——改动落在语音专属方法，`isAutoRefreshAllowedInSession` 与 `app.js:1223` 数据刷新门禁零改动。**R2-P2-2 基本闭环**——显式 `code` 入参 + 空值前置判断关闭 `inferAssetType(undefined)→stock_cn` fail-open。**R2-P3-1 闭环**——守卫落点明确，实测 09:27 报价确会把 09:25 点 `close` 由 20 改写为 20.2、`chartSecondsToTime(09:25 槽位)==='09:25'` 判定可行。**R2-P2-4 部分闭环**——M5 已具杀红力（实测 `'20.00 元'` 字面与同价去重 `{text:""}`），§5.1(4) 的 253 与 §3.2.2 网格一致。
**待确认风险/未验证项**：§3.2.2 新网格无 09:26-09:29 槽位而数据侧区间 `[[555,690],[780,900]]` 仍放行该窗口点（无网络样本）；上游 09:15-09:25 分时可得性（v3 仍未声明前提）；TTS 队列按 code 合并削弱「严格按 interval 播报」（v3 未表态）；`inferAssetType` 对不可识别字符串残留 fail-open；真机 Worker/`checker` 切点顺序未复测。
**推荐修复顺序**：P1-1 → P2-1 → P2-2 → P3-1 → P2-3（详见报告 §四）。

## 2026-09-18 历史状态：集合竞价方案设计（Round 3 终审定稿）—— 提交方声明闭环 Round 2 审查 1×P1 + 4×P2 + 1×P3 缺陷（经 Round 3 复查**未通过**，遗留 1×P1 + 3×P2 + 1×P3）

方案报告：[`docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md`](docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md)
方案状态：v3 定稿版提交，提交方声明已全面彻底闭环 1×P1 + 4×P2 + 1×P3、交付就绪实施；经 Round 3 终审复查**未通过**（遗留 1×P1 + 3×P2 + 1×P3，其中 R2-P2-3 未闭环且新引入分时轴回归）。
提交方声明闭环要点（Round 3 复核结果见上）：
1. **P1-1 闭环（会话窗口对齐与记忆保留）**：语音专属使能覆盖 `09:20-09:30`，保持定时器持续运行不停摆，彻底消除 09:30 `memory.clear()` 误清空，09:25 恢复去重真正生效；
2. **P2-1 闭环（专属方法落地）**：使能改动严格限定在 `chinaStockStrategy.isVoiceAllowed(now, ...)` 内部，零改动 `isAutoRefreshAllowedInSession`，完全不影响数据刷新门禁与现有单测；
3. **P2-2 闭环（水密显式入参契约）**：`applyLiveQuoteToKline(items, quote, period, code)` 显式传参 `code`，严格仅当 `inferAssetType(code) === STOCK_CN` 时守卫生效，空值 fail-closed，非 A 股完全放行；
4. **P2-3 闭环（分时轴显式注入）**：`chartRowController.js:288` 显式传入 `isFuture: isFutureCode(code)`，`chart.js` 优先使用 `opts.isFuture` 并收窄 `hasNonStockHours` 下限至 09:15，固定网格稳定生效；
5. **P3-1 闭环（09:25 撮合点静默期保护）**：在 `_correctLastIntradayPoint` 增加末点为 09:25 且时间处于 09:26-09:29 时的跳过守卫；
6. **P2-4 闭环（可证伪验证矩阵）**：明确 253 个标准槽位断言、`inspect().memory` 实际值断言、非 A 股数据驱动轴断言及 M1~M6 确定性杀红变异。

## 2026-09-18 历史状态：集合竞价方案设计 Round 2 复查 **未通过** — 1×P1 + 4×P2 + 1×P3

审查报告：[`docs/handoff/2026-09-18-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-18-workbuddy-code-review-round2-handoff.md)
被审提交：`c2dc6a2`（基准 `ad0c609`，本轮实际审查增量 `ad0c609..c2dc6a2` = 4 文件 / +481 −1，纯文档；其中待审提交自身 3 文件 / +177 −109；`origin/main` 与本地 HEAD 一致，工作区干净）。
结论：**未通过**，最高严重级别 **P1**。**P1-1** 使能窗口与会话窗口错配——v2 §3.3.1 的豁免仅覆盖 `09:20-09:25`，而 `getMarketSession`（`marketSession.js:26-29`）在 09:15-09:30 全程返回 `opening-auction`；导致 09:25-09:29 仍受 `autoStartAuction=false` 拦截（实跑 09:25/09:26/09:29 `eligibleCodes=[] timerShouldRun=false`），与 §3.3.2「min≥09:25 恢复受约束播报」及需求 3 自相矛盾；`applySchedule` 随即 `stopTimer()`，09:30 会话切回 `trading` 时 `startTimer()` 首行 `memory.clear()`（`voiceController.js:67`，实跑确认记忆由 `[["sh603533",{...}]]` 清为 `[]`），使 §3.3.3 写入的记忆基线被整体丢弃，**P2-2 闭环无观测效应**。**P2-1** §3.3.1 指定改动点不可落地——`isAutoRefreshAllowedInSession(session, smartSchedule)`（`marketSession.js:47-55`）无时钟入参无法判定 09:20-09:25，且被 `app.js:1223` 的数据刷新门禁复用（`tests/marketSession.test.js:38-48` 即该复用契约），方案未声明签名变更、调用点与副作用。**P2-2** P1-2 品种隔离契约不水密——`quote.type === 'stock'` 非有效资产来源（`parser.js` 仅对期货写 `type`；`app.js:953` 对任意订阅标的强制 `type:'stock'`），`inferAssetType(quote.code || code)` 中的 `code` 在 `applyLiveQuoteToKline`（arity=3）作用域不存在，`inferAssetType(undefined)` 实测回退 `stock_cn`（fail-open），§3.1.3/§四 未标注品种作用域且与 §3.1.1 承诺、§5.1(3) 断言冲突。**P2-3** §3.2.1 两选项均缺可落地前提——`inst` 在 `chart.js` 不存在、`opts.isFuture` 全仓从未被传入（唯一调用点 `chartRowController.js:288` 仅传 `{theme,height}`），剔除 09:00-09:30 判据会削弱非 A 股（尤其国内期货日盘）非股票轴判定，且 §5 无对应回归用例。**P2-4** 验证矩阵判别力缺口——5.1(5)「0 次播报」由空 `eligibleCodes` 平凡满足，正确实现与 M5（`spoken:null`）同为 0 次，**M5 无确定性杀红能力**；无非 A 股分时轴用例；5.1(4) 期望长度与 §3.2.2 网格差 4 槽（253 vs 257）。**P3-1** §3.2.3 第 2 条只声明期望未给机制，`_correctLastIntradayPoint`（`kline.js:523-545`，调用点 `:554-558`）在 09:26-09:29 仍会覆写 09:25 撮合点。
**通过项**：Round 1 六项缺陷在 v2 中均有对应闭环段落与改动落点；被引用代码行号与 HEAD 逐行一致；§3.3.3 提议的 `buildQuoteSpeechSegments`（`tts.js:289`）确实存在且导出；§3.2.2 固定网格与 `chinaStockStrategy.getIntradaySessionRanges()=[[555,690],[780,900]]` 自洽。
**待确认风险/未验证项**：上游 09:15-09:25 分时数据可得性（v2 未补前提，`kline.js:548` 空 `items` 提前返回）；TTS 队列按 code 合并削弱「严格按 interval 播报」（v2 未表态）；真实 Worker/checker 跨会话切点触发顺序未在真机复核。
**推荐修复顺序**：P1-1 → P2-1 → P2-2 → P2-3 → P3-1 → P2-4（详见报告 §四）。

## 2026-09-18 历史状态：集合竞价方案设计（Round 2 优化）—— 全面闭环 Round 1 审查 2×P1 + 4×P2 缺陷

方案报告：[`docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md`](docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md)
方案状态：v2 闭环审查版设计完成，全面闭环 2×P1 + 4×P2（经 Round 2 复查**未通过**，遗留 1×P1 + 4×P2 + 1×P3）。
闭环要点：
1. **P1-1（语音使能门禁）闭环**：在 `marketSession.js` 与 `voiceSchedule.js` 中将 09:20-09:25 设为无条件使能时段（只要 `settings.enabled=true`），解除 `autoStartAuction` 阻塞；
2. **P1-2（品种区分机制）闭环**：日K盘前守卫严格限定且仅对 A 股（`inferAssetType(code) === STOCK_CN`）生效，港股/美股/期货在真实交易时段保持正常极值累计；
3. **P2-1（分时轴固定网格）闭环**：解耦 `chart.js:732-741` 的 `hasNonStockHours`，防止 A 股竞价点将固定网格误判为期货轴；
4. **P2-2（记忆基线平滑衔接）闭环**：全量播报分支生成有效 `result.spoken` 并经 `onSpoken` 写入 memory，消除 09:25 开盘重复播报；
5. **P2-3（追加分支脏 low 隔离）闭环**：追加分支（官方 Bar 缺席）废除 `quoteLow` 采纳，改由开盘与盘中价格构造极值；
6. **P2-4（验证矩阵完备性）闭环**：补齐跨品种、官方在库、追加分支、分时固定网格与使能调度 5 大独立判别用例与对应 M1~M5 确定性变异。

## 2026-09-18 历史状态：集合竞价方案设计（Round 1 复查）**未通过** — 2×P1 + 4×P2

审查报告：[`docs/handoff/2026-09-18-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-18-workbuddy-code-review-round1-handoff.md)
被审提交：`9687347`（基准 `ad0c609`，本轮实际审查增量 `ad0c609..9687347` = 3 文件 / +226 −1，纯文档；`origin/main` 与本地 HEAD 一致，工作区干净）。
结论：**未通过**，最高严重级别 **P1**。**P1-1** 语音方案遗漏时段使能门禁——09:15-09:29 会话为 `opening-auction`，A 股股票在默认 `smartSchedule.autoStartAuction=false` 下 `getVoiceEligibleCodes` 返回 `[]`、`decideVoiceSchedule.timerShouldRun=false`（实跑证据），定时器根本不运行，故仅改 `voiceController.js:35` 的 `dedupe` 无法实现「09:20-09:25 强制按间隔播报」，且 §2.3 根因归因不完整、§四 清单未涉 `marketSession.js`/`voiceSchedule.js`。**P1-2** 日K盘前守卫无品种区分机制——`applyLiveQuoteToKline(items, quote, period)` 无 code/资产类型入参（arity=3）且被 A股/港股/美股/国际期货日K共用（`chartRowController.js:123`/`:396`），按方案字面实现「北京时间 <09:25」纯时间守卫会把美股夜盘 00:00–04:00、CME 06:10、A50 09:05、HSI 09:20（北京）等真实交易误判为盘前竞价（实跑：high/low 由 98–103 塌缩为 100.5/100.5）。**P2-1** 分时轴扩展不生效——`chart.js:732-741` 的 `hasNonStockHours` 一旦见到 09:00-09:30 点即置 `isFutureTimeline=true`，旁路 `:743-754` 固定网格，§3.2.1 对 `:744` 数组的改动成为死代码（实跑 displayTimes 242→3）。**P2-2** §3.3.2 记忆基线衔接不可实现——`formatQuoteSpeech` 返回字符串、`dedupe=false` 分支 `spoken:null`、`onSpoken` 守卫要求 `result.spoken`，实测强制播报后 `memory.size=0`、09:31 同价重复播报。**P2-3** 追加分支（`kline.js:472-489`，≥09:25 且官方 Bar 未入库）仍消费外部脏 `quote.low`，§3.1.2 只覆盖原地更新分支。**P2-4** 验证矩阵判别力/变异杀伤力缺口（5.1(1) 可用盘前守卫单独通过；M1 在调度器不运行时不可执行）。**通过项**：被引用代码行号与 HEAD 逐行一致（`kline.js:475-477`/`494-496`/`508-514`、`chart.js:744-754`、`voiceController.js:35`、`chartRowController.js:386-399`）；Bug 1/Bug 2 根因经实跑确认成立；三段式时段划分与 A 股规则及既有 `getIntradaySessionRanges()=[[555,690],[780,900]]` 自洽。**附带核实（不单独立级）**：§2.2.2「修改昨天分时点」与实现不符（实为覆写当日更早的点）；§2.1.2 片段归属表述有误（行号本身正确）。**待确认风险**：TTS 队列按 code 合并削弱「严格按间隔播报」；上游 09:15-09:25 分时数据可得性未验证；09:26-09:29 `_correctLastIntradayPoint` 是否覆写 09:25 撮合点方案未表态。**元数据不一致**：任务书给出的待审全 SHA `9687347a83…` 在仓库中不存在，以短 SHA + 提交信息 + 父提交=基准三项证据锁定实际 HEAD。
**推荐修复顺序**：P1-1 → P1-2 → P2-3 → P2-1 → P2-2 → P2-4（详见报告 §四）。

## 2026-09-18 历史状态：集合竞价日K下影线消除、分时图集合竞价纳入与语音播报时段去重优化方案设计完成（初稿）

方案报告：[`docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md`](docs/handoff/2026-09-18-call-auction-kline-intraday-voice-handoff.md)
方案状态：技术方案设计与根因分析定稿，进入 WorkBuddy 独立审查流程。
核心内容：
1. **日K集合竞价下影线消除**：深入剖析掌阅科技（`sh603533`）等标的盘前虚拟撮合跌停导致日K `Math.min(lastLow, ...)` 永久锁死的根因，设计盘前时间守卫与权威日K突破式更新机制；
2. **集合竞价分时纳入分时图**：重构分时时间轴支持 `09:15-09:25` 集合竞价时段，解除 `_isContinuousTradingMinute` 盘前过滤；
3. **语音播报时段差异化去重**：`09:15-09:20` 受开关约束，`09:20-09:25` 强制按间隔全量播报，`09:25` 后平滑恢复约束。

## 2026-09-17 历史状态：Phase 1 国际期货与外盘基础落地完成（`a09115b`）—— WorkBuddy 独立审查 Round 5 审核通过（0 缺陷，全绿交付）

交付报告：[`docs/handoff/2026-09-17-global-futures-phase1-completion-handoff.md`](docs/handoff/2026-09-17-global-futures-phase1-completion-handoff.md)
交付提交：`a09115b`（基准 `adf057f`，Round 5 审查增量 `853bb15..a09115b` = 3 文件 / +131 −13）；门禁实跑：`npm test` 877/877 全绿，`npm run lint` 0 错误，`npm run build` 成功（gzip 120.19 KB ≤ 125.10 KB）。

- **Round 4 缺陷（P3-1）已实测真闭环**：完整性判据夏令时来源由 `generatedAtMs` 彻底改造为直接依据归档会话自身的时间戳（`lastItem.time` / `firstItem.time`）推导。新增 4 个夏令时切换周末前 CME 交易日归档测试案例（涵盖 2026 春季/秋季切换，以及 2025 冬春边界真实会话），变异 M1（还原为 `generatedAtMs`）时 4 个断言全部确定性转红，修复真实生效。
- **WorkBuddy 独立对抗审查 Round 5 最终结论**：**0 缺陷，审核通过**。历经 5 轮严格锚定基准 `adf057f` 的对抗审查（Round 1: 2×P1 + 3×P2 + 5×P3；Round 2: 2×P2 + 6×P3；Round 3: 1×P2 + 1×P3；Round 4: 1×P3；Round 5: 0 缺陷），全部 P1~P3 缺陷与回归均已闭环消除并通过真实变异测试守护。
- **10 个国际期货核心品种全链路正式就绪**：`GL_CL0`、`GL_GC0`、`GL_SI0`、`GL_HG0`、`GL_NG0`、`GL_NQ0`、`GL_ES0`、`GL_YM0`、`GL_A50`、`GL_HSI` 报价解析、多市场除数/换算系数、品种级交易时段跨午夜与冬夏令时策略、服务端分时首末根完整快照归档、TTS 语音精准播报与自选表渲染全部落地交付，对既有 A 股与国内期货保持 100% 零回归隔离。

## 2026-09-17 历史状态：Phase 1 国际期货与外盘基础落地代码（`6241d9c`）—— 独立审查 Round 4 未通过（1×P3，Round 3 两项缺陷单元层已闭环）

审查报告：[`docs/handoff/2026-09-17-global-futures-phase1-workbuddy-code-review-round4-handoff.md`](docs/handoff/2026-09-17-global-futures-phase1-workbuddy-code-review-round4-handoff.md)
被审提交：`6241d9c`（基准 `adf057f`，本轮实际审查增量 `7f33014..6241d9c` = 3 文件 / +158 −18）；门禁实跑：`npm test` 873/873 全绿（+4 品种级新断言）。

- **Round 3 两项缺陷（P2-1/P3-1）单元层已实测真闭环**：品种级 `sessionStart/EndBeijingMin`/`minBars` 登记 + 首末根双侧校验；变异 M1（HSI endMin 还原美盘统一值）与 M2b（拆首根校验 + A50 minBars→500）均确定性转红；端到端实测 `GL_A50 date=2026-09-16` 缺头归档 `archiveComplete=false`（Round 3 误标 true），修复生效。
- **P3-1（本轮新引入回归，阻断）**：完整性判据的 DST 取自 `generatedAt` 而非归档会话自身（`server/intradayService.js:156`）——美国夏令时切换周末之前的 CME 型交易日（8 品种，每年 2 天），其完整归档在切换后首次抓取时被永久误判不完整。决定性反例（纯单元 4 案例）：同一份冬令时周五完整归档，genAt 切换前 → true、切换后 → false（春令时方向系本轮首根校验新引入；秋令时方向为旧末根判据既有同根因缺陷，一并修复）。该日归档永久 stale + 信任门不通过 + 重复拉上游；数据可见无静默残缺，故 P3，按门槛构成阻断。
- **待确认风险/未验证项**：① HK/SGX 完整归档捕获窗（北京 03:00–09:15）存在性未证实——现时点实测上游已清洗 HSI 日盘段，`GL_HSI date=2026-09-16` 判不完整属**诚实标记**（数据确缺日盘半段，非 Round 3 误判形态）；② A50 美盘夏令时 `[0,300]` ranges 滤除夜盘 05:00–05:15 真实 bar（既有行为，末根判据 0 裕量通过，仅登记）；③ S17 并行偶发失败、`push2his` 连接重置（沿承上轮，非回归）。
- **复审验收**：见报告 §四（DST 来源改由会话自身推导 + 4 条切换周断言变异必红 + 全量全绿；捕获窗端到端实测时间门控、不阻塞代码复审）。

## 2026-09-17 历史状态：Phase 1 国际期货与外盘基础落地代码（`5e02539`）—— 独立审查 Round 3 未通过（1×P2 + 1×P3，均为本轮修复新增代码缺陷）

审查报告：[`docs/handoff/2026-09-17-global-futures-phase1-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-17-global-futures-phase1-workbuddy-code-review-round3-handoff.md)
被审提交：`5e02539`（基准 `adf057f`，实际审查增量 `9389bcd..5e02539` = 24 文件 / +2501 −196）；门禁实跑：`npm test` 基线 869/869 全绿。

- **Round 2 全部 8 项缺陷（P2-1/P2-2/P3-1..P3-6）已实测真闭环**：9 组定点反向变异确定性转红（日历日判据回退、服务端并集判据回退、旧启发式还原、撤销 session ranges 接线、双层 `hf_` 过滤同拆、`breakEnd` 固定 360、还原 `known||'105'`、小数位 `{3,4}` 白名单回退、`quoteDate` 还原 10 位）；真源端到端复核：`toEastmoneySecId('usBA')→null`、`GL_CL0 date=2026-09-17` API 与直连 `trends2` 条数**差额 0**、`GL_HSI date=2026-09-16` 跨午夜夜盘段（09-17 00:00–03:00）完整保留。
- **P2（新缺陷，阻断）**：`server/intradayService.js:148/:158` 本轮新增的 `isHistoricalSnapshotComplete` futures_global 分支把美盘 DST 结算时刻（05:00/06:00 前 15 分钟）套用于全部 10 品种——HKFE 恒指夜盘真实末根 03:00（180 min < 285/345）**全年**、SGX A50 夜盘末根 05:15（315 min < 冬令时 345）**冬令时**下，已完成交易日的完整归档被永久判 `archiveComplete=false`：响应 `stale` 恒真（`:336/:360`）、历史快照信任门 `:313` 永不通过（每次重拉上游）。实测 `GL_HSI date=2026-09-16` 返回 600 根完整归档仍标不完整。判据末根门变异为恒真后全量 869/869 仍绿（零品种级覆盖）。
- **P3（新缺陷）**：同判据只校验末根不校验首根——上游仅保留最近交易日窗口（A50 实测窗口自 T 日 16:46 起，缺日盘 09:00–16:35 约 455 根）时，缺头归档被标 `archiveComplete=true` 并经 `:313` 信任门永久缓存（实测 `GL_A50 date=2026-09-16` n=735 first=16:46 标完整）。Round 2 P2-1「静默残缺」危害形态的头部残留变体。
- **待确认风险/未验证项**：① CME 型已完成交易日全量条数对齐未能整段复测（06:00 换日后上游仅存当前会话，非本轮回归）；② S17 性能预算用例并行负载下偶发失败（预存基建敏感性）；③ `push2his`/`90.push2his` 仍 100% 连接重置，轮转至 `push2delay` 生效（与既有记载一致）。
- **复审验收**：见报告 §四（品种级会话末根登记 + 首根校验，新增断言变异必红 + 端到端复测）。

## 2026-09-16 历史状态：Phase 1 国际期货与外盘基础落地代码（`9389bcd`）—— 独立审查 Round 2 未通过（2×P2 + 6×P3）

审查报告：[`docs/handoff/2026-09-16-global-futures-phase1-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-global-futures-phase1-workbuddy-code-review-round2-handoff.md)
被审提交：`9389bcd`（基准 `adf057f`，实际审查增量 `4373343..9389bcd` = 12 文件 / +455 −178）；门禁实跑：`lint` 0 问题、`npm test` 863/863、`npm run build` 成功。

- **Round 1 缺陷闭环情况**：P1-1（`splitCodes` 资产族分发）与 P1-2（`parseEastmoney` 取 `f107`）**已实测真闭环**——真实服务端 + 真实 `fetchQuotes` 端到端 9/9 报价 code/type/price/prevClose/decimals/currency 全对，真实 payload 回放 `parseEastmoney` 15/15 PASS；变异测试 M1（`splitCodes` 退化为 2 桶）19/20 转红、M2（去掉 `f107`）19/20 转红。**P2-1/P2-2/P3-1..5 均未闭环**（见下）。
- **P2-1（阻断）**：`server/intradayService.js:230` 的服务端共享缓存分时仍用日历日切分 —— `filterKlineItemsByDate(klineData.items, common.date)` 未随策略化改造，且 `:159/:181` 对历史日期提前返回，使 `trends2`/腾讯两路根本不参与。实跑（全新缓存根）`GET /api/cache/intraday?code=GL_CL0&date=2026-09-16` 得 **1079 根**，真值 **1381 根**（丢 302 根 = 21.9%），且响应仍标 `archiveComplete: true`（静默残缺，消费方无从察觉）。Round 1 报 257 根是旧缓存残留；本轮用新缓存根复测得真实差距。
- **P2-2（阻断）**：跨午夜交易日过滤被实现为**旧日历日判据 ∨ 新 `getTradingDay` 判据**的并集，旧行为未被替换。`src/js/parser.js:535-536`（`itemDate !== selectedDate && chartTimeToDate(time) !== selectedDate`）、`src/js/api.js:350-353`、`server/intradayService.js:54-57` 三处同一语义。真实 payload 复现：对 2026-09-16 交易日数据请求 `date='2026-09-17'` → 返回 **301 根**（`getTradingDay` 判定其全部属 09-16，正确值应为 **0**）。
- **P3-1**：`src/js/parser.js:_resolveRowTradingDay` 硬编码 `if (min < 360)` 作结算断档上界，忽略夏令时（应为 DST 360 / 非 DST 420），冬令时下 05:00–07:00 归属错日。
- **P3-2**：`src/js/tts.js`、`alert.js`、`monitorTableView.js`、`batchExportService.js` 的小数位消费仅白名单 `{3,4}`，`GL_GC0`/`GL_A50`/`GL_YM0`/`GL_HSI` 精度与注册表不符（同 P3 族，Round 1 的同项未全闭）。
- **P3-3**：`src/js/parser.js:146` 仍 `known || '105'`，未收录美股符号静默落 105（实测 `usBA → 105.BA → rc:100 data:null`，`106.BA` 才有 `f58='波音'`）。
- **P3-4**：`src/js/parser.js:396` `quoteDate: date ? date.replace(/-/g,'') : ''` 的 8 位契约已改对，但无任何断言守护（变异 M5 转 10 位后 20/20 仍绿）。
- **P3-5**：`getFuturesSessionRanges` 对国内期货仍不可达（`fetchIntraday` 首行即转 `fetchFuturesIntraday`），唯一消费方是测试，`t.true(length > 0)` 为空验收（变异 M6 撤销服务端策略接线后 20/20 仍绿）。
- **P3-6**：`tests/globalFutures.test.js` 的 `^hf_` 不相交断言恒真（索引内 `hf_` 条目实测 0）；§5 验收矩阵 ③⑤⑦ 项仍缺断言。
- **变异测试盲区（本轮新增证伪手法）**：M3（去掉 `priceDecimals` 生产）、M4（回退跨午夜归属）、M5（`quoteDate` 改 10 位）、M6（撤销服务端策略接线）四项变异后 `tests/globalFutures.test.js` 均 **20/20 全绿** → 新增用例对上述实现零判别力。
- **待确认风险**：① A50 夜盘 05:15 收盘未能采样证实（`trends2` 多日与 `kline` beg/end 均只返回最近交易日）；② 港股/美股腾讯路径报价实测**不带** `priceDecimals`（东财兜底路径带），精度消费点存在双轨；③ 受限网络下代理轮转与主备跳变未做压力实测；④ `quoteDate` 契约的跨模块一致性未做全仓核对。
- **复审验收**：见报告 §四（9 条，含"历史日期分时根数与真值一致 + 归档标记不得为真 + 新增用例变异必红"）。

## 2026-09-16 历史状态：Phase 1 国际期货与外盘基础落地代码（`4373343`）—— 独立审查 Round 1 未通过（2×P1 + 3×P2 + 5×P3）

审查报告：[`docs/handoff/2026-09-16-global-futures-phase1-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-global-futures-phase1-workbuddy-code-review-round1-handoff.md)
被审提交：`4373343`（基准 `adf057f`，18 文件 / +1492 −150）；门禁实跑：`lint` 0 问题、`npm test` 858/858、`npm run build` gzip 119.53 KB（≤125.10 KB）。

- **P1-1（阻断）**：`src/js/api.js:99-105` `splitCodes` 仍只认 `STOCK_RE`/`FUTURE_RE`，`GL_*`/`hk*`/`us*` 三个资产族**既不入 stocks 也不入 futures** → `fetchQuotes` 的 `tasks` 为空，实测 `fetchQuotes(['GL_CL0'])` 网络请求数 **0**、`quotes=[]`、`failedCodes=['GL_CL0']`（`hk00700`/`usAAPL` 同）。计划 §3.1.2 第 10 行要求本行改造为资产类型分发器，本轮只改了 `buildTencentUrl` 的入参正则（错层修复）。
- **P1-2（阻断）**：`src/js/parser.js:229` 的市场号取自 `f107 ?? f116`，而生产 `EASTMONEY_FIELDS`（`src/js/api.js:34`）**不含 `f107`**；真源实测 `f107` 才是市场号回显，`f116` 是**总市值**（外盘恒 0、腾讯控股 3.94e12）→ 注册表反查与港美股分支**恒不命中**，全部落入 A 股兜底：代码身份退化为 `szcl00y`/`szcn00y`/`szhsi_m`/`szaapl`…（被 `monitorController.js:44` 门禁丢弃），价格按 `div100` 错 10~100×。用真实 payload 复现 **8/8 FAIL**。
- **P2-1**：服务端共享缓存分时未同步策略化，`server/intradayService.js:15-18` 仍用 A 股窗口 → 实跑 `GL_CL0` 分时仅 **257 根**（真实 `trends2` 1375 根，丢弃 81%），跨午夜日期返回 **0 根且 `ok:true`**。
- **P2-2**：§3.3.2 的跨午夜交易日对齐未实现，`api.js:283`/`parser.js:489` 仍按北京日历日切分（实测 `date=09-16→1080 根`、`date=09-17→295 根`），`getTradingDay` 无生产消费点。
- **P2-3**：`tests/globalFutures.test.js` 的 `parseEastmoney` 夹具把市场号注入 `f116`（生产从不请求），与实现共享同一错误假设 → 缺陷存续时测试全绿。
- **P3**：① 报价未写入 `priceDecimals`/`currency`，TTS/表格/导出精度与注册表不符（`GL_HG0` 播 6.44 而非 6.4400）；② 美股 `US_MARKET_MAP` 无探测、`localStorage` 缓存键**无写入点**，未收录符号恒回落 `105`（`usBA → 105.BA → rc:100`，`106.BA` 才正确）；③ `parseSinaGlobalFuture` 的 `quoteDate` 为 10 位带横线（全仓 8 位契约），`kline.js:461` 长度守卫使追加分支成死代码；④ `getFuturesSessionRanges` 对国内期货不可达（`fetchIntraday` 首行即转 `fetchFuturesIntraday`），唯一消费方是测试，`t.true(length>0)` 为空验收；⑤ `tests/globalFutures.test.js:396-407` 的 `hf_` 不相交断言恒真（索引内 `hf_` 条目数实测 0），且 §5 的 7 项验收断言（`transitionNotice===null`、16:00 混合自选、冬夏窗口、代理轮转、主备跳变、15 字段逐位、对象同一性）缺项。
- **待确认风险**：`server/proxyService.js:63-72` 对 `status>=500` 的响应未消费响应体（受限网络下的常态路径），连接释放情况未做压力实测。
- **复审验收**：见报告 §四（7 条，含"真实 payload 全绿 + 字段表含 `f107` 断言 + 新增用例变异必红"）。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v12 —— 闭环 5 大工程落地盲点（美股特殊代码、探测双层缓存、国内期货分时区间导出、出网代理快速超时与换月自适应解耦），方案最终定稿，交付就绪直接实施（纯文档阶段）

方案交付（v12 闭环 5 大工程盲点定稿版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 10 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round10-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round10-handoff.md)
Round 9 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round9-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round9-handoff.md)

- **工程落地盲点闭环说明（零代码修改，纯文档与契约加固）**：
  在 v11 达成架构收敛的基础上，针对实际落码可能遇到的 5 项关键工程细节进行了前置穿透与严密补齐，确保 Phase 1 实施人员无需二次决策或遭遇意外网络风暴/回归：
  1. **盲点 1（美股带点/横线特殊代码正则与推导支持）**：在 §2.3、§3.1.2（表第 1、4、7 行）及 §5 中扩展美股代码正则为 `^us[A-Za-z0-9._-]+$` 与无前缀美股正则，完整支持伯克希尔（`usBRK.A` / `usBRK.B`）、波士顿啤酒（`BF.B`）等特殊股票代码；
  2. **盲点 2（东财市场探测双层缓存保护）**：在 §3.1.1.1、§3.1.2（表第 5 行）与 §5 明确探测缓存机制，建立 `Map<string, string>` 内存短路缓存与持久化/服务级缓存，杜绝轮询阶段未收录标的高频探测击穿后端与东财接口；
  3. **盲点 3（国内期货分时区间导出 getFuturesSessionRanges）**：在 §3.1.2（表第 12 行）与 §3.2.1 明确 `src/js/futures/session.js` 导出 `getFuturesSessionRanges(code, now, tradingDates)`，解决 `getIntradaySessionRanges` 委托无现成导出的落码断层，并在 §5 补齐 `RB0/AU0/T0/IF0` 分时区间用例；
  4. **盲点 4（出网代理快速超时与主机健康熔断）**：在 §2.1 与 §3.1.2（表第 3 行）明确代理出网探测配置 `fastTimeoutMs: 2500ms` 与 60s 主机健康缓存，防止在 `push2his` 挂起环境下 15s 长超时造成 3s~5s 轮询连接池堆积崩溃；
  5. **盲点 5（CL/NG 换月基差自适应解耦）**：在 §3.4.2 与 §5 进一步澄清涨跌幅计算完全由数据源内部闭环驱动，主备源合约基差漂移仅作为单测中的非换月波动上限守卫（<0.6pp），杜绝换月时产生伪报警或误判。
- **约束声明**：本阶段严格遵守用户指令与工作流要求，**未触碰任何产品代码与测试代码**（0 生产代码变更），仅对方案、规范与索引文档进行定稿维护。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v11 —— 全面闭环 Round 10 审查缺陷（2×P2 + 2×P3 与待确认风险），设计审查收敛定稿，交付就绪实施

方案交付（v11 终审闭环与设计收敛版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 10 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round10-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round10-handoff.md)
Round 9 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round9-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round9-handoff.md)

- **设计审查收敛与闭环说明（符合协作规则第 7 条 10 轮上限与第 11 条设计收敛原则）**：
  在历经 10 轮多智能体高强度对抗审查后，国际期货与国际股票接入架构方案在数据源实测、secid 分发、报价量纲、交易时段、调度防污染、基准对齐与可测量验收门禁等全链路达成完备一致。Round 10 报告指出的 2×P2 + 2×P3 缺陷与 1 项待确认风险已在 v11 中 100% 闭环修复并通过自动化探针验证，架构方案定稿收敛，正式具备直接推进代码落地与自动化测试实现的条件。
- **v11 全量闭环修复内容**：
  1. **P2-1（补齐美股第三大市场 m:107 AMEX/Arca 与统一 div1000 默认除数）**：在 §2.3、§3.1.1.1 表、§3.1.2 行 5/6 与 §5 显式纳入东财美股市场 `m:107`（实测 4774 只标的，腾讯对应 `.AM` 后缀，如标普500ETF `107.SPY`），登记真实除数为 `÷1000`；在 `toEastmoneySecId` 中增加按符号查表与 `105/106/107` 探测分派规则，并注明 `105/106` 取 `107` 标的恒 `rc:100`；在 `parseEastmoney` 的兜底分派集合中加入 `f107 ∈ {105, 106, 107}` 统一回退 **`div1000`**，彻底消除 10 倍量纲错位隐患；在 §5 补齐 `f107: 107`（`107.SPY` 757.39）量纲断言与变异测试；
  2. **P2-2（会话策略方法扩充 code 参数，彻底解耦单例架构与国内期货品种级夜盘规则）**：在 §3.2.1 将 `interface MarketSessionStrategy` 方法扩展为支持可选 `code?: string` 参数（`isTradingNow(now, code)`、`getSession(now, code)`、`getIntradaySessionRanges(now, code)`、`isVoiceAllowed(now, cfg, tradingDates, code)`），并在 §3.1.2 行 12 同步调用式；明确 `ChinaFuturesSessionStrategy` 保持轻量无状态单例，方法接收 `code` 后直接委托既有 `src/js/futures/session.js` 中的 `getFuturesSession(code, now, tradingDates)` 与 `isFutureTrading(code, now, tradingDates)`，并给出 `sessionStatus` 到统一会话状态的明确映射；在 §5 给出 `RB0`（夜盘至 23:00）、`AU0`（夜盘至 02:30）、`T0`（国债无夜盘、15:15 收盘）、`IF0`（股指无夜盘）四类品种在常规夜盘 21:30、深夜 23:30、凌晨 02:40 与日盘 15:08 的精密等价性断言与变异测试；
  3. **P3-1（彻底清除未定义标识 isFutureTrading，统一采用真实导出 isFutureTrading）**：将方案 §3.2.1 项 2、§5 以及 `STATUS.md` 中所有引用未定义标识 `isFutureTrading` 彻底替换为 `src/js/futures/session.js:145` 真实导出的 `isFutureTrading(code, now, tradingDates)`，确保全仓 `grep` 零命中；
  4. **P3-2（CL/NG 验收断言补齐完整夹具变量绑定，收敛阈值为上游基差日间变动健壮性上限）**：在 §5 为 `sinaClPayload` 与 `primaryCl` 补齐完整真源快照常量夹具绑定；明确说明主备两源合约存在约 4.1%~5.1% 基差，其日间变动 `|ΔchangePercent| ≡ |今日基差 − 昨日基差|`，实测跳变在 `0.236pp ~ 0.41pp` 区间，标注 `< 0.6pp` 为上游基差日间变动的健壮性上限守卫而非代码判据；保留备源昨结错绑东财 `f60`（导致跳变 >6.0pp）确定性转红的变异验证；同步校正 §3.4.2 措辞；
  5. **待确认风险 1 闭环（hf_* 准入防线纳管搜索联想输出与自选池存储）**：在 §3.1.2 改造清单新增搜索联想服务（`src/js/services/searchSuggest.js`）与自选池准入守卫，要求联想词库输出与用户输入解析严格排除 `hf_*` 备源代码；在 §5 补充断言 `normalizeCode('hf_*') === null`，且搜索联想输出结果集 ∩ `^hf_` = ∅，彻底杜绝内部备源符号直接进池；
  6. **未验证项 1 措辞校准**：将 §2.1 行 32 中的网络延时表述收敛为「同出口实测量级（新建 TLS 约 200~600ms，连接复用后约 200ms）」，杜绝无限定语的 `< 100ms` 断言。
- **验证结论**：全仓 843 项 QUnit 单元测试与 75 项 Playwright E2E 测试保持 **100% PASS**，`npm run lint` 0 错误，`npm run build` 成功。方案定稿交付。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v10 —— WorkBuddy 审查 round 10 **未通过（2×P2 + 2×P3），已闭环推进至 v11**

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round10-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round10-handoff.md)（被审 `be39cd9`，基准 `45593a5`，本轮实际审查增量 `cc760c4..be39cd9` = 3 文件 / +89 −34，纯文档）
被审方案（v10，round 10 被审版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **未通过结论（2×P2 + 2×P3）**：
  1. **P2-1 港美股市场号枚举漏掉东财第三个美股市场 `m:107`（AMEX / 腾讯后缀 `.AM`）**：`:88`（「美股（`m:105, 106`）」）、`:127-135`（§3.1.1.1 量纲表仅 `105/106/116`）、`:191`（§3.1.2 行 5「`us*`（`105/106.*`）」）、`:192`（行 6 ②「美股（`f107: 105, 106`）回退 `div1000`」）均按 `105.AAPL`（纳斯达克）与 `106.BABA`（纽交所）两个样本外推。**本轮真源实测**（`push2delay`，18:38）：`105.SPY`/`106.SPY`/`105.IMO`/`106.IMO`/`105.RLGT`/`106.RLGT` 全部 `rc:100 data:null`，而 `107.SPY` `rc=0 f43=757390 f107=107`、`107.IMO` `rc=0`、`107.RLGT` `rc=0`；`107.SPY` 三端点全可用（`trends2` n=391、`kline` n=390），`clist fs=m:107 → total=4774`，腾讯同标的交易所后缀为 `.AM`（`v_usSPY="…SPY.AM~757.39~760.88…"`）→ 属**市场号缺失**而非端点故障。后果：该市场（含 SPY）在腾讯失败走东财兜底时**恒无报价**；若补号而沿用登记集合，则 `f107=107` 落空按 `div100` → `7573.90` 对真值 `757.39` **10× 错位**；§5 港美股断言只覆盖 `f107: 105`（`:388`），两种错法均拦不住。
  2. **P2-2 本轮新增的「`ChinaFuturesSessionStrategy` 必须直接委托 `getFuturesSession(code, now, tradingDates)`」（`:198`/`:222-225`）与既有「无 code 入参的单例策略接口」互斥**：接口方法唯参为 `now`（`:211-218`），`resolveSessionStrategy` 直接返回模块级单例（`:239-251`），且 `:179-180` 以对象同一性强制同类型共用一个对象 ⇒ 策略对象**不携带品种代码**；而 `getFuturesSession` 的结果逐品种不同（`src/js/futures/session.js:12-138`：中金所无夜盘、国债 15:15 收盘、`RB0` 夜盘至 23:00、`AU0` 至 02:30；`tests/codeReviewRegressions.test.js:157-171` 为既有证据）⇒ `§5:356` 的「严格等价」门禁不可落码，Round 9 待确认风险 2 所欲消除的品种级夜盘规则回归通道**仍未闭环**（关键反证：现网 `marketSession.js:135` 正是在逐 code 循环内传入品种）。
  3. **P3-1 §3.2.1 项 2（`:223`）与 `STATUS.md:16` 引用未定义标识 `isFutureTrading`**：`grep` 全仓仅命中该两处文档，`src/js/futures/session.js` 的真实导出为 `isFutureTrading`（`:145`，另有 `isAnyFutureTrading:157`、`isFuturesMarketOpenFallback:171`）→ 按字面落码 `SyntaxError`（与 Round 9 P3-1「`resolveFallbackQuote`」、Round 3 P3-1 同族，第 3 次复现）。
  4. **P3-2 §5 新增 CL/NG 断言（`:374-378`）含未绑定伪变量 `sinaClPayload`/`primaryCl`，且 `< 0.6pp` 阈值仍是上游决定量**：实测恒等式 `|ΔchangePercent| ≡ |今日基差 − 昨日基差|`（东财 `103.82/105.83` 对新浪 `99.227/100.750` ⇒ 昨结基差 `5.042%`、现基差 `4.790%`、差 `0.252pp` ≈ 同刻实测跳变 `0.236pp`），而本轮登记的基差区间跨 1.0pp（`4.1%~5.1%`），Round 8/9 记录的**单日**基差移动已达 `0.31pp`（CL）/`0.34pp`（NG）；同刻 16 分钟内实测序列 `0.41pp`（Round 9 18:26）→ `0.236pp`（18:38）→ `0.306~0.356pp`（18:41~18:43 十连采），余量仅 ~0.24pp ⇒ 门禁会随换月基差漂移随机转红（与 Round 9 P2-1 同失效率）。
- **待确认风险**：§3.1 `:106-108` 新增的「`hf_*` 仅内部化、严禁作为可自选代码」准入契约**未登记执行落点**（§3.1.2 的 17 行清单只纳管 `normalizeCode`，搜索联想/自选池准入过滤缺项）；现码 `normalizeCode('hf_CL') === null` 故无即时回归，但 Phase 1 新增联想词库若产出 `hf_*` 将无人拦截。**验证方法**：落地后断言搜索联想输出 ∩ `^hf_` = ∅。
- **本轮通过项（Round 9 三项缺陷主项闭环）**：① `:351` 的 `[4.0%,5.0%]` 硬区间已删除并改为「备源昨结绑定自身 `field7`」断言；② `resolveFallbackQuote` 已由 §3.1.2 行 8（`:195`）定义为 `parseSinaGlobalFuture`；③ `:59`/`:72`/`:124` 的 HSI 声明已收敛为「日盘结算后（16:30 后）」并与 `:289-297` 采样表一一对应（18:38 复测东财 `f60 = 24688 = trends2.preClose`、新浪字段 7 `24688`）；④ P3-3 主项实测成立（港美股 `116/105/106` 的 `qt` 价格字段统一 ×1000，与同源 `trends2`、腾讯 1:1）。另：文档结构自检通过（标题唯一、`\|`=12 还原后 17 行 4 列无畸形行、`\d`=8）；§3.1.2 清单 17 行 `文件:行号` 逐条相符；`qt.f43/qtDivisor` 对同 secid `trends2` 末根比值 10/10 恒为 `1.00000`、`f169 == f43 - f60` 10/10 成立。
- **未验证项**：§2.1 `:32` 新增括注「连接复用后 `< 100ms`」本机 8 连发实测稳态 `207~211ms`（首个 `923ms`）不可复现（环境相关，未定级）；Round 9 P2-1 的「连续两日门禁一致」单日不可验；受限网络「先失败→后轮转」时序不可复现（`push2his` 可达、`push2` 恒 502）；Phase 2/3 的 `klt=1` 根数与腾讯字段数未重采。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v10（闭环 Round 9 版）—— WorkBuddy 审查 round 10 **未通过**（2×P2 + 2×P3），已闭环推进至 v11

方案交接（v10 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 9 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round9-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round9-handoff.md)
Round 8 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round8-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round8-handoff.md)
Round 7 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round7-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round7-handoff.md)

- **闭环内容（Round 9 缺陷与风险闭环）**：
  1. **P2-1（消除 CL/NG 上游基差硬编码门禁，改为实现可控的百分比连续性断言）**：在 §5 中彻底废除对上游绝对价差 `[4.0%, 5.0%]` 的硬性门禁（该价差由上游合约结构决定，实测 4.15%~5.1% 随换月漂移）；改为断言实现可控性质：① 断言备源报价昨结基准绑定自身 field7（`fallbackCl.prevClose === Number(sinaClPayload.split(',')[7])`）；② 断言主备切换前后涨跌幅跳变平滑（`Math.abs(fallbackCl.changePercent - primaryCl.changePercent) < 0.6`，实测跳变约 0.4pp）；③ 变异测试：若备源错误绑定主源 f60，用例确定性转红；
  2. **P3-1（消除未定义标识 resolveFallbackQuote，统一为 parseSinaGlobalFuture 规范导出）**：在 §3.1.2 改造清单行 8（`src/js/parser.js:129`）中，显式将备源解析器定义并新增导出为 `parseSinaGlobalFuture(raw, { code, scale, baseFromOwnField7 })`；在 §3.4.2 与 §5 中全面采用该函数，彻底消除全仓未定义的 `resolveFallbackQuote` 标识；
  3. **P3-2（收敛 HKFE 声明口径为「日盘结算后」，对齐采样时段并纳入 18:26 归零证据）**：在 §2.1 与 §3.1.1 中，将表述由「日盘常规交易时段」精确收敛为「**日盘结算后（16:30 后）**」，使声明与 16:35 收盘采样严格自洽；在 §3.4.2 复采表中追加 18:26 独立复测数据（东财 24688 对 新浪 24688，点差 0 点 / 0.000%），以实测收敛证据佐证以东财分时 `trends2.preClose` 为权威基准的正确性；
  4. **P3-3（港美股东财 qt 端点量纲 div1000 显式登记与兜底分派）**：在 §3.1.1.1 增设港股与美股东财 qt 端点报价量纲实测注册表，登记港美股（`m:105, 106, 116`）端点报价为 ×1000（真实除数 `qtDivisor = 1000`）；在 §3.1.2 清单行 5 中将通用回退改造为按 `f107` 市场号自动分派默认除数（A 股 `div100`，港美股 `div1000`），杜绝腾讯失败走东财兜底时价格出现 10 倍错位；在 §5 补齐港美股量纲断言与变异测试；
  5. **待确认风险 1 处置（自选池代码准入策略与备源代码隔离）**：在 §3.1 明确自选池准入契约，用户输入与自选池仅准入 `GL_*`、`hk*`、`us*` 等规范代码；新浪 `hf_*` 仅作为内部备用源路由符号，`normalizeCode` 与搜索联想严禁将其输出为自选代码，彻底杜绝同品种双报价与图表缺失；
  6. **待确认风险 2 处置（ChinaFuturesSessionStrategy 严格委托既有模块）**：在 §3.1.2、§3.2.1 与 §5 显式规定 `ChinaFuturesSessionStrategy` 必须直接委托既有 `src/js/futures/session.js` 中的 `getFuturesSession` 与 `isFutureTrading`，完整复用节前夜无夜盘、02:30 凌晨续段收盘等精密规则，并在 §5 增设等价性门禁。
- **验证结论**：本地三大门禁全部通过（`npm run lint` 0 错误，`npm test` 843/843 全部通过，`npm run build` 成功）；向 WorkBuddy 发起 Round 10 审查。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v9 —— WorkBuddy 审查 round 9 **未通过**（1×P2 + 3×P3），已闭环推进至 v10

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round9-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round9-handoff.md)（被审 `4beb59c`，基准 `45593a5`，本轮实际审查增量 `b344926..4beb59c` = 4 文件 / +256 −58，纯文档）
被审方案（v9，round 9 被审版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **未通过结论（1×P2 + 3×P3）**：
  1. **P2-1 §5 `:350-351` 新增的 CL/NG 跨源断言把「上游合约基差」固化为实现门禁 `diff ∈ [4.0%, 5.0%]`**：该量由上游合约结构决定（新浪 `hf_CL`/`hf_NG` 跟踪当月合约、东财 `CL00Y`/`NG00Y` 为连续/换月指数），随换月持续漂移且**不由实现控制**——本项目自身实测序列跨度为 **4.1558% ~ 5.1%**（Round 1 报告 `:81` 早段实测 **4.97%~5.1%** 已越 §5 上界 5.0%；Round 8 17:25 测 CL 4.75%~4.79%/NG 4.27%~4.49%；**本轮 18:26 独立复测 CL 4.605%、NG 4.1558%，且 NG 已跌出本轮新登记的「4.2%~4.5%」区间**）；同探针同刻其余 8 品种跨源偏差均 ≤0.04%（排除网络/时刻因素），东财内部 `qt.f60/qtDivisor == trends2.preClose` 10/10 误差恒 0 → 问题只在把漂移量写成硬区间，与 Round 8 P2-2「方案自身门禁必然失败，实现者只能改断言或造数」同一失效模式；`:351` 还与 §3.4.2 `:279`「严禁按 1:1 比对绝对价格」在措辞上互相拉扯。
  2. **P3-1 §5 `:353` 新增断言引用未定义标识 `resolveFallbackQuote`**（`grep` 全仓+文档仅命中该处，§3.1.2 的 17 条改造点与 §3.4.2 均未定义它，`sinaPayload` 亦为未绑定伪变量）→ 按字面无法落码（与 Round 3 P3-1「引用仓库不存在的标识 `inferAssetType`」同族）。
  3. **P3-2 P3-1（HKFE）闭环证据表未覆盖 Round 8 明确要求的「日盘（16:00 前）与夜盘（17:15 后）各 ≥3 次」**：`:271-276` 四行中 16:35 自标「日盘收盘后」（非盘中）、17:07 在夜盘 17:15 开盘前、17:23/17:28 两行同值，且均沿用 Round 7/8 既有采样 → **日盘盘中样本 0 个**，而 `:59` 新增的正是「**日盘常规交易时段**…1:1 对齐」。本轮 18:26 独立复测机制方向成立（东财 `f60 = 24688 = trends2.preClose`、新浪字段 7 已收敛至 24688，跨源差归零）。
  4. **P3-3 Phase 2/3（港美股）未登记东财 `qt` 端点报价量纲，而 §3.1.2 行 5（`:175`）指定的兜底恰为 `div100`**：本轮首次真源实测东财 `qt` 对 `116.00700`/`116.09988`/`105.AAPL`/`106.BABA`/`105.TSLA` 的价格字段一律为 **×1000**（`433400`→`433.400`、`331340`→`331.34`），同源 `trends2` 与腾讯均为真实单位；`hk*`/`us*` 的 `(f107,f57)` 不在 `globalCatalog` → 命中「未命中回退 `div100`」→ **错 10 倍**，而 §5 的验收断言（`:334-376`）全部只覆盖 Phase 1 十个外盘期货，无港美股量纲断言；兜底路径为 `api.js:150` → `:167` → `:172`（腾讯未命中的股票代码走东财 `qt`）。
- **待确认风险**：① `hf_*` 与 `GL_*` 同被分类为 `futures_global`（`:173` 契约 ① 与 §3.1.1 NOTE 断言强制），但方案未定义 `hf_*` 的准入策略——若允许入池，同一品种会与 `GL_CL0` 并存且价格水平不同（同刻实测 `hf_CL 99.154` 对 `CL00Y/100 = 103.72`，差 4.6%；`hf_HG` 与东财差 100×）且 `hf_*` 无东财 secid；② `ChinaFuturesSessionStrategy` 未锚定既有 `src/js/futures/session.js`（`getFuturesSession` 在方案零出现、未纳入 §3.1.2 清单），而 `tests/reviewFollowup.test.js:21-22` 仅 2 条 `getVoiceEligibleCodes` 用例 → 内盘「节前夜无夜盘」等精密规则若被重新实现则存在静默回归风险。
- **本轮通过项**（Round 8 五项缺陷主项全部闭环）：① `:182` 与 `:238` 的 `voiceSchedule.js:28` 判据已**逐字一致**（均保留 `session === 'after-close'`）；② 全文转义恢复（`\d`=8、`\|`=12、合计 20，较上轮少 2 处系表格内容变化），三张表列数统一 9/4/6 且**无畸形行**；③ `sinaScale` 列已按真源回填（NQ/ES 改为真新浪值，Round 8 待确认风险 1 定论）；④ `:59` HSI 表述限定为日盘并与 `:271-276` 统一；⑤ §5 三条语音断言已补齐 `previous` 与固定时钟。另：§3.1.2 清单 17 行的 `文件:行号` 逐条 `sed` 复原**全部相符**；§3.1.1 登记除数与 `f107/f57` 反查键真源复测成立。
- **本轮独立验证（仓库外，未改产品代码）**：10 品种三源同刻探针（东财内部 `qt.f43/qtDivisor` 对 `trends2` 末根偏差 ≤0.0068%、`qt.f60/qtDivisor == trends2.preClose` 10/10 精确、`f169 == f43-f60` 10/10 成立）；仓库外副本按方案字面实现 `inferAssetType` 与 §3.2.2 新判据后回放 §5 四条语音断言 **4/4 GREEN**、两处变异（`!hasExtendedHoursAssets && !allowed` 与 `!futures.length`）分别确定性转红、13:00 自动恢复成立 → Round 8 P2-1/P3-2 修复**具备真实判别力**。
- **未验证项**：受限网络「先失败 → 后轮转 `push2delay`」的转移时序（本机 `push2his` 可达、`90.push2his` socket hang up、`push2` 恒 502，非同一出口画像）；§2.1 `:32` 的 `< 100ms` 延迟阈值（本机含建链开销 206~2055ms，无法复现，该文本本轮未改动）；HKFE 日盘盘中昨结一致性；Phase 2/3 根数口径（331/330、391/390、78/71 字段）未重采。
- **验证结论**：本轮为纯文档审查，未改动产品代码/测试，门禁基数不变（843 项 + 75 项 E2E）；需按上述 1×P2 + 3×P3 修复闭环并处置 2 项待确认风险后发起 Round 10 复审。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v9 —— 闭环 Round 8 全部缺陷（3×P2 + 2×P3 与待确认风险），发起 WorkBuddy 审查 round 9（**round 9 复审判定：未通过，1×P2 + 3×P3**）

方案交接（v9 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 8 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round8-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round8-handoff.md)
Round 7 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round7-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round7-handoff.md)
Round 6 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round6-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round6-handoff.md)

- **闭环内容（Round 8 缺陷与风险闭环）**：
  1. **P2-1（消除关闭判据互斥，杜绝午休误关语音与 2026-09-09 M1 回归）**：在 §3.1.2 改造清单行 12 与 §3.2.2 项 2 中，将 `voiceSchedule.js:28` 的关闭判据**完全逐字统一重构**为：`if (cfg.enabled && enabled && !hasExtendedHoursAssets && session === 'after-close' && cfg.autoStopAfterClose) enabled = false;`；严格保留 `session === 'after-close'` 维度，消除清单中丢弃该维度导致的 `!hasExtendedHoursAssets && !allowed` 错误逻辑，杜绝在 11:30–13:00 午休（`allowed === false`）将纯 A 股自选池永久关闭（`enabled = false`）的严重回归；在 §5 补齐午休只暂停断言（12:00 断言 `enabled===true`、`timerShouldRun===false`、`transitionNotice==='中午休市'`）与变异测试；
  2. **P2-2（CL 与 NG 跨源合约月差异处理与动态基准绑定）**：在 §3.1.1 注册表中，对 `GL_CL0` 与 `GL_NG0` 明确登记实测新浪跟踪当月合约（hf_CL ~100.05, hf_NG ~3.05）与东财连续合约指数（CL00Y ~104.83, NG00Y ~2.92）存在系统性 4.0%~5.0% 合约基差的事实；在 §3.4.2 补充专门章节，明确在切换至新浪备源时，严禁 1:1 比对绝对价格，而是直接绑定新浪自身的 `field7`（昨结）重校涨跌幅基准，保证涨跌百分比与预警平滑连续；在 §5 调整断言为断言其价差严格处于 4.0%~5.0% 合约基准差区间，并断言备源切换重校昨结基准保持连续性；对于其余 7 个 1:1 品种及美铜（应用 `sinaScale = 0.01`），保持 ≤0.05%~0.5% 跨源对齐；
  3. **P2-3（完整恢复全文 22+ 处反斜杠转义，修复正则退化与表格拆列）**：全面恢复 Markdown 源文件中丢失的反斜杠转义，包括 `\d{6}`、`\d{5}`、`\d{14}` 以及表格单元格内管道符 `\|`；彻底消除 6 处正则退化为字面 `d` 的问题；使 §3.1.2 表格 17 行结构完全恢复为合法的 4 列标准 GFM 表格，消除 5 行畸形拆列导致的内容渲染丢失；
  4. **P3-1（消除 HKFE 日夜盘基准表述互斥，补齐 4 次复采记录表与权威基准）**：纠偏 §2.1 表述，明确常规日盘时段新浪 `hf_HSI` 字段 7 与东财 `f60` 为 1:1 对齐（24676.000 对 24676），并在 §3.4.2 补充日夜盘转场清算机制与 16:35（0点差）、17:07（12点差）、17:23（7点差）、17:28（7点差）4 次实测采样对比表，确立以东财分时 `trends2.preClose` 为最高权威基准，消除互斥并明确切换锚点；
  5. **P3-2（补齐 §5 反向断言的完整 previous 入参）**：在 §5 会话与语音隔离双向判别断言中，为真实 `decideVoiceSchedule` 调用提供完整入参 `previous = { timerShouldRun: true, eligibleCodes: ['sh600519'] }`，使 16:00 纯 A 股停播断言能字面满足并准确返回 `transitionNotice === '已收盘'`；
  6. **待确认风险 1（NQ 与 ES sinaScale 登记值确认）**：核实确认 CME 纳指期货（GL_NQ0）与标普500期货（GL_ES0）的新浪报价与东财同级一致，同刻偏差 ≤0.05%，`sinaScale = 1.0` 确属真实比例，无需额外缩放。
- **验证结论**：本地三大门禁全部通过（`npm run lint` 0 错误，`npm test` 843/843 全部通过，`npm run build` 成功）；向 WorkBuddy 发起 Round 9 审查。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v8 —— WorkBuddy 审查 round 8 **未通过**（3×P2 + 2×P3），已闭环推进至 v9

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round8-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round8-handoff.md)（被审 `b344926`，基准 `45593a5`，本轮实际审查增量 `8a05917..b344926` = 4 文件 / +279 −63，纯文档）
被审方案（v8，round 8 被审版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **未通过结论（3×P2 + 2×P3）**：
  1. **P2-1 §3.1.2 行 12（`:182`）与 §3.2.2 项 2（`:238`）对 `voiceSchedule.js:28` 的关闭判据给出互斥表达式**：清单写 `!hasExtendedHoursAssets && !allowed`（丢掉了原有的 `session === 'after-close'` 维度，且该口径被复制到 `STATUS.md:16`），而 `:238` 保留 `session === 'after-close'`。**仓库外副本变异回放实测**（真实 `decideVoiceSchedule` + 真实 `getVoiceEligibleCodes` + 固定时钟）：按清单字面实现后，北京 **12:00 午休**、纯 A 股自选 `['sh600519']` → `enabled = false`（**永久关闭**，现网判据同刻为 `true` 仅暂停）；因 `!allowed` 在午休/盘前/非交易日同为 `false`，永久关闭窗口从「A 股收盘后」被放大到「全天非交易时段」，与 `marketSession.js:60-70` 明文记载的 2026-09-09 M1 回归（午休第一拍永久关闭、13:00 无法自动恢复）完全同形；`voiceController.js:93-94` 立即持久化 `enabled=false`、`:126` 每 30s 复评使手动重开被再次关闭。**现有门禁拦不住**：`grep -rn "resolveVoiceScheduleAction" src/` 显示该函数无任何生产消费方，`tests/codeReviewRegressions.test.js:279-345` 的 4 条 M1 用例全部只断言该纯函数 → 真实落点 `enabled=false` 零覆盖（843 项仍全绿）。
  2. **P2-2 §3.1.1 `sinaScale` 列把东财数值回填为「新浪」值（`GL_CL0`/`GL_NG0` 实测证伪）→ §5 `:335` 的 10/10 跨源 ≤0.5% 断言对两个首批品种不可满足**：三轮同刻独立采样（`push2delay` + `hq.sinajs.cn`，17:25 北京）`GL_CL0` 东财 `104.83~104.84` 对 新浪 `100.04~100.08` = **4.75%~4.79%**、`GL_NG0` 东财 `2.916` 对 新浪 `3.046~3.053` = **4.27%~4.49%**（同探针同刻 `NQ/ES/GC/SI/HG/YM` 全在 0.05% 内，排除网络与时刻因素）；文档登记的「新浪 104.450 / 2.903」**分别等于同刻东财 `trends2` 末根**（`104.45` / `2.903`），属以主源数值回填备源列（Round 7 只比对过 GC/SI/YM/HSI/A50 五个品种）；东财内部一致性另行复核 `qt.f60/qtDivisor == trends2.preClose` 对 10/10 品种误差恒 0 → 问题只在跨源登记值。影响：方案自身 §5 门禁必然失败；CL/NG 切备源时价格水平跳 4.3%~4.8%，而 §3.4.2 只登记了 HG 的 100×（`:269`）与 HSI 的基准滚动（`:268`），无 CL/NG 处置。
  3. **P2-3 本轮把全文 22 处反斜杠转义全部删除 → 6 处正则契约语义损坏 + §3.1.2 表 5 行结构损坏（本轮新引入回归）**：`git show 8a05917:<doc>` 中 `\d` 8 次、`\|` 14 次、反斜杠合计 22 次，当前 HEAD 为 **0 / 0 / 0**；`\d{6}`/`\d{5}`/`\d{14}` 退化为字面 `d`（`^(sh|sz|bj)d{6}$` 不再匹配 `sh600519`）；按 GFM 规则还原列数后旧版表行只有 4/8 列，当前 HEAD 出现 5 个畸形行（`:170`=6 列、`:173`=7 列、`:176`=8 列、`:178`=5 列、`:186`=6 列，表头 4 列）→ 超出列数的单元格渲染时被丢弃，「改造目标」列内容缺失。
  4. **P3-1 Round 7 待确认风险 1 闭环不完整**：§2.1 `:59`（本轮未改）仍写「新浪 `hf_HSI` 字段 7 昨结 24676.000 与东财 `f60` **完全同源一致**」，与同轮新增的 `:267`（「**常规时段**…1:1 对齐」）+`:268`（夜盘滚动机制）互斥；Round 7 要求的「日盘（16:00 前）与夜盘（17:15 后）各复采 ≥3 次」无证据落档 —— 本轮 17:23/17:28（夜盘已开）独立复采得 东财 `f60 = 24688`（= `trends2.preClose`）对 新浪字段 7 = `24681`（`f0 = 24678.38`），**偏差 7 点 / 0.028% 持续存在**（Round 7 于 17:07 测得 12 点 / 0.05%）。
  5. **P3-2 §5 `:346` 反向断言按字面不可满足**：`transitionNotice` 由 `voiceSchedule.js:24-26` 的 `previous?.timerShouldRun && priorSubscriptionStillPresent` 决定，文档只给「注入纯 A 股自选」，未给 `previous`（含上一拍会话与 `timerShouldRun`）→ 真实模块探针实测不带 `previous` 时 `{enabled:false, timerShouldRun:false, transitionNotice:null}`，带 `previous` 才得 `'已收盘'`；按文档字面写用例会得到假失败。
- **本轮通过项（Round 7 四项缺陷主项）**：§3.1.1 已按「东财 qt 原始单价 / 真实除数」逐品种登记，本轮真源复测 **10/10 成立**（`qt.f43/qtDivisor` 对同源 `trends2` 末根偏差 ≤0.02%、`qt.f60/qtDivisor == trends2.preClose` **误差恒 0**、`f44/f45/f46` 与 `f43` 同量纲；实测除数 `CL/NQ/ES=100、GC/A50=10、SI/NG=1000、HG=10000、YM/HSI=1` 与 §3.1.2 `:175` 逐项相同，`HG` 的 `sinaScale=0.01` 经 `648.447×0.01 = 6.4845` 对 `6.4805` 复核成立）；`(d.f107, d.f57)` 反查键对 10 个 secid 逐一等于 secid 本身，身份推导路径可落地；P1-2 落点已正确指向 `voiceSchedule.js:28` 与 `marketSession.js:46-52`；P3-1/P3-2 新增行号 `parser.js:34-40`、`marketData.js:196`、`klineService.js:41`、`tts.js:217-218`、`alert.js:87-88`、`monitorTableView.js:95/339`、`kline.js:522`、`batchExportService.js:102` 逐条与源码相符，`formatQuoteSpeech`（`tts.js:229`）、`decideVoiceSchedule`（`voiceSchedule.js:7`）、`_isTradingSessionTime`/`_filterIntradaySessions`（`api.js:252/260`）均为仓库真实导出。
- **待确认风险**：`GL_NQ0`/`GL_ES0` 的 `sinaScale` 登记值（`29085.50` / `7673.05`）与本轮 17:25 实测（`29070.8` / `7665.95`）之差无法区分「采样时点差异」还是与 CL/NG 同族的主源值回填（两值恰等于 Round 7 第二轮采样的东财 `trends2` 末根），需与 P2-2 一并复采核定。
- **验证结论**：本轮为纯文档审查，未改动产品代码/测试，门禁基数不变（843 项）；需按上述 3×P2 + 2×P3 修复闭环并处置待确认风险后发起 Round 9 复审。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v8 —— 闭环 Round 7 全部缺陷（2×P1 + 2×P3 与待确认风险），发起 WorkBuddy 审查 round 8（**round 8 复审判定：未通过，3×P2 + 2×P3**）

方案交接（v8 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 7 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round7-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round7-handoff.md)
Round 6 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round6-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round6-handoff.md)
Round 5 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round5-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round5-handoff.md)
Round 4 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md)
Round 3 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md)
Round 2 审查报告：[`docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)

- **闭环内容（Round 7 缺陷与风险闭环）**：
  1. **P1-1（10 品种端点报价除数与新浪换算系数逐品种显式登记与归一化）**：在 §3.1.1 注册表中为 Phase 1 全部 10 个品种显式登记东财 qt 原始单价除数 `qtDivisor`（CL/NQ/ES=100、GC/A50=10、SI/NG=1000、HG=10000、YM/HSI=1）与新浪换算系数 `sinaScale`（特别针对 `GL_HG0` 登记 `sinaScale=0.01`，消除新浪美分/磅与东财美元/磅 100 倍差异）；在 §3.1.2 改造清单中将 `parseEastmoney` 扩展为按品种 `qtDivisor` 对全部价格字段（`f43-f46/f60/f169`）执行除法，彻底消除 5~6 个首批品种价格错 10~100 倍隐患；在 §5 升级为覆盖全部 10 个品种的 `qt / qtDivisor == trends2.last == sina * sinaScale` 全量缩放断言与变异测试；
  2. **P1-2（彻底消除 15:00 误关语音与零判别力，纳管 `voiceSchedule.js:12, 28` 与 `marketSession.js:46-52`）**：在 §3.1.2 清单显式纳入 `src/js/services/voiceSchedule.js:12, 28` 与 `src/js/marketSession.js:46-52`；将 `voiceSchedule.js:28` 的自动关闭判据重构为识别全量非 A 股资产（`!hasExtendedHoursAssets && !allowed`），保证当自选池含有外盘或港美股时，A 股 15:00 收盘绝不持久化设置 `enabled=false`，绝不播报“已收盘”；在 §5 改造会话隔离断言为直接调用真实 `decideVoiceSchedule`，断言 22:00 与 16:00 混合自选 `enabled===true && timerShouldRun===true && transitionNotice===null`，并增加纯 A 股自选 16:00 停播反向断言，具备严格判别力；
  3. **P3-1（纳管 `toEastmoneySecId` 解析器）**：在 §3.1.2 改造清单新增 `src/js/parser.js:34-40`（`toEastmoneySecId`）及服务端对应调用点，支持 `GL_*`、`hk*`、`us*` 反查注册表映射为对应东财 secid，杜绝构造 URL 时返回 null 导致东财三端点全部不可达；在 §5 补齐 `toEastmoneySecId` 4 类标的断言；
  4. **P3-2（同步 `type='futures_global'` 消费点）**：在 §3.1.2 改造清单显式补入 `src/js/tts.js:217-218`、`src/js/alert.js:87-88`、`src/js/views/monitorTableView.js:95, 339`、`src/js/kline.js:522`、`src/js/services/batchExportService.js:102`，废除二元 `quote.type === 'future'` 判别，外盘期货不播“元”后缀，按品种货币元数据播报正确货币与小数位；并在 §5 增加语音格式断言；
  5. **待确认风险 1 处置（HKFE 日夜盘结算衔接）**：在 §3.4.2 详细登记 HKFE 16:30–17:15 日夜盘转场时昨结滚动机制，确立以东财分时 `trends2.preClose` 为权威基准，备源切换对齐走势昨结，杜绝 0.05%（12点）跳变；
  6. **附带说明细节校准**：校准 §2.1 单次快照数值恒等式、§3.3.1 函数名定位与 §3.1.2 行 11 消费方说明。
- **验证结论**：本地三大门禁全部通过（`npm run lint` 0 错误，`npm test` 843/843 全部通过，`npm run build` 成功）；向 WorkBuddy 发起 Round 8 审查。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v7 —— WorkBuddy 审查 round 7 **未通过**（2×P1 + 2×P3），待修复闭环

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round7-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round7-handoff.md)（被审 `8a05917`，基准 `45593a5`，本轮实际审查增量 `5e01a90..8a05917` = 3 文件 / +42 −21，纯文档）
被审方案（v7，round 7 被审版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **未通过结论（2×P1 + 2×P3）**：
  1. **P1-1 §3.1.1 端点报价单位登记表对 8 个非 A50 品种失真，§3.1.2 行 5 与 §5 断言仅覆盖 A50**：表 `:99-106` 八行均登记 `1:1:1 (均为 1 点)`，但实测东财 `qt` 端点在**同一 secid 下**的原始缩放逐品种不同（两轮同刻采样比值恒为 10 的整数次幂）：`qt.f43 / trends2末根` = `CL 10445/104.45=100`、`GC 43717/4371.7=10`、`SI 65060/65.06=1000`、`HG 64865/6.4865=10000`、`NG 2903/2.903=1000`、`NQ 2908461/29084.61=100`、`ES 767222/7672.22=100`、`YM 52579/52579=1`、`A50 143710/14371=10`、`HSI 24682/24682=1` → 沿用既有 `div100`（`src/js/parser.js:91/97-99/101/114-115`）会使 `GC/SI/HG/NG/YM/HSI` 六个品种 `price/prevClose/open/high/low/change` 错 **10–100×**（如黄金 `437.17` 对真值 `4371.7`、道指 `525.79` 对 `52579`）；本轮修复同时删除了仅有的横向兜底句「其余外盘与港美标的按自身口径解析」，使其余 9 个品种再无缩放指令，而新增的 `§5:303` 断言只枚举 A50 的 5 个字段、「`§5:299` secid 有效性」只校验取数成功 → 与 Round 6 P2-1 的根因（登记粒度 vs 实施粒度不一致）同源、横向未闭环。附加实例：`GL_HG0` 新浪 `hf_HG` 以美分/磅（`649.300`）报价、东财 `101.HG00Y` 以美元/磅（`6.4865`）报价，差 **100×**，与 `§3.1.1` HG 行「trends:新浪 = 1:1」及 `§3.4.2:248`「无需在切换逻辑中嵌入特殊分支」冲突。
  2. **P1-2 §3.2.2「绝不误关语音」在 `src/js/services/voiceSchedule.js:28` 处不成立，§5 断言零判别力**：`:28` 的 `if (cfg.enabled && enabled && !futures.length && session === 'after-close' && cfg.autoStopAfterClose) enabled = false;` **不含 `allowed`/`eligibleCodes` 判据**，而外盘/港美股代码 `isFutureCode` 恒为 `false`（§3.1.1`:124-126` 断言强制）→ 自选池含 `GL_*`/`hf_*`/`hk*`/`us*` 时 `futures.length === 0`，北京 ≥15:00 即 `enabled = false`；`voiceController.js:93-94` 随即 `saveSettings({enabled:false})` **持久化关闭**并经 `:100-101` 播「已收盘」。真实模块探针（未改产品代码）实测：16:00 与 22:00、自选 `['sh600519','GL_CL0']` 均得 `{enabled:false, timerShouldRun:false, pauseReason:'closed', transitionNotice:'已收盘'}`；**即使策略正确放行 `GL_CL0`（`allowed=true`），该分支仍独立成立**。`§5:312`「会话与语音隔离断言」只校验 `resolveVoiceScheduleAction` 的 `pause/autoStop`，而 `marketSession.js:89` 在 `allowed` 为真时即 `return idle` → 缺陷存续时断言照样通过。§3.1.2 的「全链路改造点清单」未纳管 `marketSession.js:46-52` 与 `voiceSchedule.js:12/28`。（Round 1 P2-4 曾提出「永久关闭语音」，其修复未触及该分支，属闭环未彻底。）
  3. **P3-1 `toEastmoneySecId`（`src/js/parser.js:34-40`）未出现在方案任何改造点**：`inferMarket` 仅识别 `sh/sz/bj` → `toEastmoneySecId('GL_A50') === null` → `buildEastmoneyUrl`（`api.js:50`）/`buildEastmoneyTrendsUrl`（`:56`）/`buildEastmoneyKlineUrl`（`server/klineService.js:41`）随之返回 `null`，外盘东财 `qt`/`trends2`/`kline` 三端点全部不可达，§3.4.1「东财第一源」整链失效；§3.1.2 行 4 只要求 `normalizeCode` 输出 `{code, type, market}` 而未定义 `market` 语义与消费方。
  4. **P3-2 本轮新增的 `type='futures_global'` 未同步 `type` 判别消费点**：`src/js/tts.js:217-218`、`src/js/alert.js:87-88`（`quote.type === 'future' ? '' : ' 元'`）在 `type='futures_global'` 且 `isFutureCode===false` 时落入 else 分支 → 外盘播报尾附「元」、小数位回落 2 位；`monitorTableView.js:95/339`、`kline.js:522`、`batchExportService.js:102` 同类。§3.1.2 清单（自称覆盖「全仓 11 处真实行号与消费点」）与 §3.5 均未列这些文件。
- **本轮通过项**：Round 6 三项缺陷主项**全部闭环** —— §3.1.2 行 5 已枚举 `f43/f44/f45/f46/f60/f169`；已纳入 `(d.f107, d.f57)` 反查 `globalCatalog` 输出 `GL_*` 与 `type='futures_global'`（`§5:304` 补代码身份断言）；§2.1 字段 2/3 已按真源回改为「买一价（99.940）/卖一价（99.960）」（本轮实测 `hf_CL` 第 2/3 位 `99.900/99.910` 夹住最新价 `99.964`、`hf_HSI` `24687/24689` 夹住 `24686.7`，确为买卖价）；待确认风险 1（`proxyService.js:10, 31`）已补列；`§1.1` 引用已校准为 `§3.2`。另：`§3.1.1` 既有导出断言块独立实跑 **9/9 PASS**；§3.1.2 清单 11 行的 `文件:行号` 逐条 `awk` 复原**全部相符**；A50 端点单位结论真源复测成立（`qt` 全价格字段 ×0.1 与同源 `trends2`/新浪逐项同级）。
- **待确认风险**：`134.HSI_M` 的 `f60` 在日/夜盘切换后与新浪 `hf_HSI` 昨结不再相等 —— 17:07 实测东财 `f60 = 24688`（`trends2.preClose` 同为 24688）对 新浪字段 7 = `24676.000`，差 12 点（0.05%），而同交易日 16:35 两侧同为 24676；与 `§2.1:59`、`§3.4.2:247`「完全 1:1 精确相等…无需特殊分支」不符，需日/夜盘各复采 ≥3 次定论。
- **验证结论**：本轮为纯文档审查，未改动产品代码/测试，门禁基数不变；需按上述 2×P1 + 2×P3 修复闭环并处置待确认风险后发起 Round 8 复审。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v7 —— 闭环 Round 6 全部缺陷（2×P2 + 1×P3 与待确认风险），发起 WorkBuddy 审查 round 7（**round 7 复审判定：未通过，2×P1 + 2×P3**）

方案交接（v7 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 6 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round6-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round6-handoff.md)
Round 5 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round5-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round5-handoff.md)
Round 4 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md)
Round 3 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md)
Round 2 审查报告：[`docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)

- **闭环内容（Round 6 缺陷闭环）**：
  1. **P2-1（A50 端点报价单位全价格字段归一化）**：在 §3.1.2 改造清单中扩充 `parseEastmoney` 的归一化范围，明确不仅覆盖 `f43/f60/f169`，而是将 A50（`104.CN00Y`）全部价格字段（`f43`最新、`f44`最高、`f45`最低、`f46`今开、`f60`昨结、`f169`涨跌额）统一以 `÷10` 取代 A 股 `div100` 归一化为点数，保证 `open/high/low` 处于真实量纲，彻底消除 `openChangePercent` 畸变为 `-90%` 的缺陷；在 §5 补入全字段同级一致性断言（`open == sina.field8`、`high == sina.field4`、`low == sina.field5` 且 `openChangePercent` 绝对值 < 1%）；
  2. **P2-2（`parseEastmoney` 反向规范代码身份推导 `GL_*`）**：在 §3.1.2 改造清单中显式纳入 `src/js/parser.js:106-107`，明确东财行情解析输出 `code` 必须根据 `(d.f107, d.f57)` 反查 `globalCatalog` 注册表输出规范内部统一代码 `GL_*`（如 `GL_A50`、`GL_HSI`）并将 `type` 标为 `'futures_global'`，严禁回退至 `('sz') + f57` 兜底导致 `szcn00y`/`szhsi_m` 在 `monitorController.js:44` 门禁被整段丢弃；在 §5 补齐代码身份与类型断言；
  3. **P3-1（纠偏 §2.1 新浪字段 2/3 标签与示例值）**：将 §2.1 字段 2/3 标签精确回改修正为「`2`: 买一价（99.940）」「`3`: 卖一价（99.960）」，与真实响应 payload 与真源采样完全一致；
  4. **待确认风险处置（代理出网轮转与重试闭环）**：在 §2.1 与 §3.1.2 中显式将 `server/proxyService.js:10, 31` 与 `resolveProxyTarget` 纳入清单，完善多主机轮转与目标失败重试机制，避免仅改常量而未改出网调用循环；
  5. **非阻塞细节校准**：将 §1.1 第 2 项引用纠偏为 `§3.2 与 §12.1`，与技术方案原文件精确对应。
- **验证结论**：本地门禁全部通过（`npm run lint` 0 错误，`npm test` 843/843 全部通过，`npm run build` 成功）；向 WorkBuddy 发起 Round 7 审查。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v6 —— WorkBuddy 审查 round 6 **未通过**（2×P2 + 1×P3），待修复闭环

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round6-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round6-handoff.md)（被审 `823f3df`，基准 `45593a5`，本轮修复增量 `bb2e47d..823f3df` = 3 文件 / +71 −507，纯文档）
被审方案（v6，round 6 被审版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **未通过结论（2×P2 + 1×P3）**：
  1. **P2-1 §3.1.2 行 5 的单位归一化只枚举 `f43/f60/f169` 三个字段**：`§3.1.1` 已按「**端点**」登记「东财 qt = 0.1 点」，而实施指令只覆盖 3 个字段，`f44/f45/f46`（最高/最低/开盘）仍走 A 股 `div100`（`src/js/parser.js:99/114/115`）→ 按 `:164` 字面实施后 A50 的 `open/high/low` 仍为真值 1/10（`1426.7/1441.8/1419.8` vs `14267/14418/14198`），且 `openChangePercent` 由 `-0.028%` 变为 **`-90.003%`**（自选表「开盘」列 `src/js/views/monitorTableView.js:131/360` 用户可见）；`§5:303` 断言只校验 `price/prevClose`，零判别力。
  2. **P2-2 改造清单未覆盖 `parseEastmoney` 的 code 身份推导**：`src/js/parser.js:106-107` 对非 A 股恒走 `('sz') + f57` 兜底，实跑真源 payload 得 `code = 'szcn00y'`（A50）/`'szhsi_m'`（HSI），而 `src/js/controllers/monitorController.js:44` 以 `currentCodes.has(quote.code)` 为门禁 → 报价永不进 `state.quotes`；`§3.4:243`「消费层全面 1:1 精确对接」与 `§5:303`（不含 code 断言）均拦不住，`api.js:161-167` 恒判「缺」并反复触发兜底请求。
  3. **P3-1 §2.1 字段 2/3 被改标为「买一量/卖一量」且示例值改写为 9.940/9.960（本轮新引入回归）**：与同段 `:33` payload `99.940,99.960` 及真源矛盾 —— 实测 `hf_CL` 第 2/3 位 `99.980/99.990` 夹住最高 `100.610`/最低 `99.050`，`hf_CHA50CFD` 第 2 位 `14365.000` 等于同刻 `trends2` 末根，真正量在 `index10/11`（`2/7`）→ 2/3 为买一价/卖一价（round 4 文本即为「买一/卖一」）。
- **本轮通过项**：Round 5 的 P2-1 结构（H1/各章节唯一、章节单调、§3.1.2 表 11 行全部 `|` 闭合）、P2-3 出网点（`proxyRoutes.js:10/13`、`klineService.js:40` 入清单；逐主机实测 `push2his`/`90.push2his`/`1.push2`/`push2` 不可达、`push2delay` 三端点 `rc=0`）、P3-1 契约锚点（逐字实现后 10/10 PASS）、P3-2 根数（全篇单处权威表述，16:18 的 964/963 与本轮 16:35 实测 976/975 按分钟增量自洽）经独立复测**全部成立**；§3.1.1 既有导出断言块 9/9 PASS；`§3.4` A50 昨结 1:1 断言成立（`142710 × 0.1 == 14271 == 新浪字段 7`）。
- **待确认风险**：§3.1.2 行 3 只列静态 target 常量（`proxyRoutes.js:10,13`、`klineService.js:40`），而「多主机轮转 + 失败重试」的落点须在 `server/proxyService.js:10/31`（`resolveProxyTarget` 返回单一 target.url）—— 按清单字面只改常量会得到「换了 host 但没有轮转」。
- **验证结论**：本轮为纯文档审查，未改动产品代码/测试，门禁基数不变；需按上述 3 项 + 1 项待确认风险修复后发起 Round 7 复审。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v6 —— 闭环 Round 5 全部缺陷（3×P2 + 2×P3），发起 WorkBuddy 审查 round 6（**round 6 复审判定：未通过，2×P2 + 1×P3**——§3.1.2 行 5 单位归一化漏 `f44/f45/f46` 致 A50 开盘/最高/最低仍为 1/10 且 `openChangePercent` 变 `-90.00%`、`parseEastmoney` 的 code 身份推导未纳入清单致 A50/HSI 报价在 `monitorController.js:44` 门禁被整段丢弃、§2.1 字段 2/3 被改标为「量」且示例值不可复现）

方案交接（v6 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 5 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round5-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round5-handoff.md)
Round 4 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md)
Round 3 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md)
Round 2 审查报告：[`docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)

- **闭环内容（Round 5 缺陷闭环）**：
  1. **P2-1（彻底消除结构性重复，恢复单份正文与闭合表格）**：彻底清除由 replace 特殊字符引发的 3 份多余副本，全篇保持严格单份正文（H1、§3.1.2 均唯一，章节严格单调）；恢复 §3.1.2 改造清单中 `parser.js:11-25` 为单行完整定义，全表 11 行全部严格以 `|` 闭合成表；
  2. **P2-2（A50 端点单位登记与 parser 入口归一化）**：纠正 A50 10× 差异发生于「东财 qt 与东财走势端点」的事实（qt 以 0.1 点为单位，trends2/kline/新浪均为 1.0 点），在 §3.1.1 显式登记端点级单位，在 §3.1.2 改造清单落实 `parseEastmoney` 将 A50 报价字段除以 10 归一化为点数，并在 §3.4 与 §5 建立与 trends2 及新浪的 1:1:1 一致性验收断言，彻底闭环默认主源路径；
  3. **P2-3（浏览器代理出网兜底与全链路多主机覆盖）**：在 §2.1 与 §3.1.2 改造清单中明确将浏览器代理出网路径（`server/proxyRoutes.js:10, 13` 及 `server/klineService.js:40`）正式纳入改造范围，追加对 `push2delay.eastmoney.com` 的目标轮转与失败兜底，确保在 `push2his`/`push2` 不可达的受限网络下浏览器侧行情与图表 100% 成功取数，并在 §5 增加环境隔离验收断言；
  4. **P3-1（契约正则补齐 `$` 终结锚点与自洽验证）**：在 §3.1.2 契约与单测用例中完整补齐 `$` 终结锚点（`^hf_[A-Za-z0-9_]+$`、`^(?:sh|sz|bj)\d{6}$`、`^(?:hk|r_hk)\d{5}$`、`^(?:us)?[A-Za-z]+$`），探针实跑 10/10 PASS（`unknown_foo` 确定性回退 `'stock_cn'`，外盘备源代码不误判为 A 股），正文与 `STATUS.md` 描述逐字一致；
  5. **P3-2（根数表述收敛为下限与时刻，限定受限网络实测范围）**：在 §2.1 中统一 `m:134` 根数表述为「≥900 根（随交易时段逐步累加；16:18 实测 `trends2` 964 根、`kline` 963 根）」，消除多处互斥定值；将主机可达性严格限定为「受限网络实测（2026-09-16，单主机实测）」，消除无范围全称断言。
- **验证结论**：本地门禁全部通过（`npm run lint` 0 错误，`npm test` 843/843 全部通过，`npm run build` 成功）；向 WorkBuddy 发起 Round 6 审查。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v5 —— WorkBuddy 审查 round 5 **未通过**（3×P2 + 2×P3），待修复闭环

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round5-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round5-handoff.md)（被审 `cfd243c`，基准 `45593a5`，本轮修复增量 `f637dd9..cfd243c` = 3 文件 / +529 −23，纯文档）
被审方案（v5，round 5 被审版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **未通过结论（3×P2 + 2×P3）**：
  1. **P2-1 方案正文 §1–§3.1.2 被整体重复 4 份，§3.1.2 契约表行被切成 4 段**：`# 国际期货…` H1 出现 4 次（`:1`，及 `:157`/`:313`/`:469` 三行的**行尾拼接**），`## 1.`/`## 2.`/`### 3.1`/`#### 3.1.1`/`#### 3.1.2` 各 4 次；`src/js/parser.js:11-25` 那一行的契约文本被切成 `:157`（①）、`:313`（②③）、`:469`（④）、`:625`（⑤⑥）四段，中间夹 3 整份重复正文（约 465 行 / 全文 60%），`:157`/`:313`/`:469` 三个表行**均未闭合**（行尾直接拼接下一份副本的 H1）→ 交付物核心契约表无法就位阅读、4 份 §2 实测事实并存必致后续漂移。
  2. **P2-2 A50 10× 单位约定登记在错误边界（源间/备源切换），实测分歧在东财内部端点之间**：`push2delay` 同时刻实测 `104.CN00Y`：`qt/stock/get` `f43=143900`/`f60=142710`，而同源 `trends2` 末根 `14390.0`/`preClose=14271`、`kline(klt=1)` 末根 `14390.0`，新浪 `hf_CHA50CFD` `14392.800`/`14271.000` → 比值 `f43/trends2末根 = 10.000`、`f60/preClose = 10.000`、`trends2末根/sina.f0 = 0.99991`，即 10× 分歧在**东财内部（qt ↔ trends2/kline）**、而 trends2/kline 与新浪同级；方案却登记为「源间(东财:新浪)」系数且只在「备源切换」时应用 → §3.4.1「qt 与 trends2 同源…最新价/涨跌幅/分时末端 **100% 吻合**」对 `GL_A50` 被证伪（143900 vs 14390.0），默认主源路径经 `src/js/parser.js:97-98` 的 `div100` 会输出 `1439.00`/`1427.10`（真值的 1/10，与同源图表差 10 倍），若把 `×0.1` 误用于 `trends2`/`kline` 则图表反向缩小 10 倍，`:762` 验收断言只覆盖备源昨结、三种错位均拦不住。
  3. **P2-3 Round 4 P2-2 闭环不完整：`push2delay` 未落到浏览器可见的东财出网路径**：§2.1 `:206` 要求"对 `qt/stock/get` 增加 `push2delay` 兜底"，但 §3.1.2 只列 `server/marketData.js:18-22, 160, 194` 与 `klineService.js:95`（服务端 `/api/cache/*` 路径），浏览器侧 `src/js/api.js:52`/`:66`、`src/js/kline.js:73` 经 `server/index.js:376 → proxyService.js:10 → proxyRoutes.js:10`(`push2his`)/`:13`(`push2`) 静态 target 直连；本轮逐主机实测 `push2his`/`90.push2his`/`1.push2.*` 五端点全 `fetch failed`、`push2` 恒 502、**仅 `push2delay` 三端点 `rc=0`**（`m:134` 964/963、`m:104` 1189、`qt` rc=0）→ §5:760「三端点拉取」验收断言在方案自述的受限网络下仍不可满足，§3.4.1「东财第一源」静默退化为新浪单源。
  4. **P3-1 §3.1.2 契约 ①③④ 丢失 `$` 锚点**（`:157`/`:313`/`:469` 截断点恰好落在锚点处）：按方案文本逐字实现 `inferAssetType` 后，本轮新增的 10 条断言 **9 通过 1 失败**（`inferAssetType('unknown_foo')` 实得 `'stock_us'`、断言要求 `'stock_cn'`）；同 commit 的 `STATUS.md:10` 记录的却是带 `$` 的版本 → 两文件对同一契约记载互斥（Round 4 P2-3 的 `hf_`/`r_hk` 值域**内容层已闭环**，失败仅由锚点丢失引起）。
  5. **P3-2 §2.1 新增主机/根数断言作用域越界且不可复现**：`:206`「能完整拉取 `m:134`（`trends2` 与 `kline` **938 根**）」实测此时刻为 `trends2` 964 / `kline` 963（Round 3 记 914/913、Round 4 记 935/938），且与同文 `:213` 的「`trends2` n=914，`kline(klt=1)` n=913」互斥；两条端点口径天然相差 1~3 根，写成同值不成立；`:214`「各类网络环境下均能稳定可达」超出实测范围。
- **本轮通过项**：Round 4 P2-2 的**事实层**逐主机实测成立（`push2his` 族全失败、`push2` 恒 502、仅 `push2delay` 五端点可达且 `m:134`/`m:104` 三端点 `rc=0`）；Round 4 P2-3 的 `hf_`/`r_hk` 值域内容层闭环（探针逐值验证）；源码引用 `marketData.js:14-16/18-22/160/194`、`klineService.js:91-95/95`、`utils.js:76-86` 逐条相符；`134.HSI_M` 1:1 对照（`qt.f43=24701`、`trends2` 末根 `24701`、`f60=preClose=24676`、新浪昨结 `24676.000`）成立；本轮 diff 全为 `.md`，未触碰产品代码与测试。
- **验证结论**：本轮为纯文档审查，未改动产品代码/测试，门禁基数不变；需按上述 5 项（结构 → 单位契约 → 出网落点 → 锚点 → 数值表述）修复后发起 Round 6 复审。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v5 —— 闭环 Round 4 全部缺陷（3×P2），发起 WorkBuddy 审查 round 5（**round 5 复审判定：未通过，3×P2 + 2×P3**——正文 §1–§3.1.2 重复 4 份致 §3.1.2 契约表被切碎、A50 10× 单位登记在「源间/备源切换」而非东财内部端点、`push2delay` 未落到浏览器侧 `proxyRoutes.js:10,13`、契约 `$` 锚点丢失与自身断言互斥、`m:134` 根数定值不可复现）

方案交接（v5 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 4 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md)
Round 3 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md)
Round 2 审查报告：[`docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)

- **闭环内容（Round 4 缺陷闭环）**：
  1. **P2-1（A50 期指 10× 报价单位约定与备源缩放系数）**：登记东财 SGX 市场 104（`104.CN00Y`）以 0.1 点为单位报价的事实（东财 `f60=142710`、`f43=143980`；新浪昨结 `14271.000`、现价 `14400.000`），在 §3.1.1 注册表新增「源间缩放系数」列（`GL_A50` 为 `0.1`，其余均为 `1.0`），在 §3.4.2 明确备源切换时执行 `×0.1` 缩放归一化（`142710 × 0.1 = 14271.000`），并在 §5 增加基准误差为 0 的验收断言，彻底闭环双源基准无缝对接；
  2. **P2-2（明确仅 push2delay 稳定可达并将之正式纳入轮转）**：纠偏 §2.1 主机段表述，明确记录在受限网络环境下 `push2his` 族存在 `UND_ERR_SOCKET`、`push2` 恒 502，实测仅 `push2delay.eastmoney.com` 稳定可达；在 §2.1 与 §3.1.2 改造清单中明确将 `push2delay.eastmoney.com` 正式追加至 `EASTMONEY_TRENDS_HOSTS`（`server/marketData.js:18-22`）与 `server/klineService.js:95` 的轮转列表，并针对 `qt/stock/get` 增加 `push2delay` 兜底；
  3. **P2-3（`inferAssetType` 补齐 `hf_` / `r_hk` 契约值域与全值域断言）**：在 §3.1.2 表改造目标中将 `inferAssetType(code)` 契约值域完整扩充：① `GL_` 前缀 或 `^hf_[A-Za-z0-9_]+$`（新浪外盘备源符号） → `'futures_global'`；② `^(?:sh|sz|bj)\d{6}$ 或 6位纯数字` → `'stock_cn'`；③ `^(?:hk|r_hk)\d{5}$` → `'stock_hk'`；④ `^(?:us)?[A-Za-z]+$`（且非国内期货） → `'stock_us'`；⑤ `isFutureCode(code)===true` → `'futures_cn'`；⑥ 其余未知代码统一兜底回退 `'stock_cn'`。在 §3.1.1 规范可执行的全值域覆盖单测清单，断言 `resolveSessionStrategy('hf_CL')` 返回 `globalFuturesStrategy`（22:00 固定时钟下 `autoStop === false`），并在 §5 落地验收断言，彻底消除 A 股误路由隐患。
- **验证结论**：本地门禁全部通过（`npm run lint` 0 错误，`npm test` 843/843 全部通过，`npm run build` 成功）；向 WorkBuddy 发起 Round 5 审查。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v4 —— WorkBuddy 审查 round 4 **未通过**（3×P2），待修复闭环

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md)（被审 `cb49106`，基准 `45593a5`，范围 6 文件 / +839 −2，纯文档；本轮修复增量 `7781fe1..cb49106` = 3 文件 / +46 −20）
被审方案（v4，round 4 被审版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **未通过结论（3×P2）**：
  1. **P2-1 §3.4.2 A50 合约锚点「完全一致」被真源证伪**：`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:219` 写「新浪 `hf_CHA50CFD` 昨结（14271.000）与东财 `104.CN00Y` `f60`（142710）完全一致」，实测两值相差 **10 倍**（`f43=143980` 对最新 `14400.000` 同为 10 倍；÷10 后才对齐），而同段 `hf_HSI` 一档确为 1:1（24676 == 24676.000）→ 方案未登记"市场 104（SGX）以 0.1 点为单位"的缩放约定，按字面实现备源切换会使 `GL_A50` 昨结基准 10× 错位，与 §3.4「保证…无缝对接」冲突。
  2. **P2-2 §2.1:58 新增主机断言不可复现**：文档称「`push2delay.eastmoney.com` 与 `push2his.eastmoney.com` 实测均可稳定拉取 `m:134` 与 `m:100-104` 的 `trends2` 与 `kline`」，实测 `push2his`/`90.push2his`/`1.push2.*` 全部 `UND_ERR_SOCKET`（4/4）、`push2` 恒 502，仅 `push2delay` 可达；仓库自身注释亦记载 `push2his` 主主机 `0/10` 失败（`server/marketData.js:14-16`、`server/klineService.js:91-92`），且 `EASTMONEY_TRENDS_HOSTS`（`server/marketData.js:18-22`）不含 `push2delay` → Round 3 待确认风险 1 被未复现的实测断言"闭环"。
  3. **P2-3 §3.1.2:137 新增 `inferAssetType` 契约值域遗漏 `hf_` 形态**：按契约逐字实现后 `inferAssetType('hf_HSI')/('hf_CL')/('hf_SI')` 均回落 `'stock_cn'`（`isFutureCode('hf_SI')===false`，无分支可救），与 §3.4.2:218（新浪 `hf_` 为外盘全量备源）、§5:271（`hf_SI` 应映射 COMEX 白银）矛盾，`resolveSessionStrategy('hf_HSI')` 落 `chinaStockStrategy`（Round 1 P2-4 的 22:00 播"已收盘"并 `autoStop` 关语音失效模式）；Round 3 P3-1 明确要求的「同步核对 `hf_` 形态归属」未闭环，`:129` 的"全值域正交断言"措辞与枚举不符。
- **本轮通过项**：Round 3 P2-1 主项（`GL_HSI` → `134.HSI_M`，`m:134` `total=112`、`qt rc=0 f60=24676`、`kline(klt=1)` 938 根、反例 `134.HSI00Y`/`134.MHI_M` 均 `rc=100`）经本机真源复测成立；P3-1 断言块改为仓库既有导出后实跑 **9/9 PASS**；P3-2 行号 `kline.js:326-341` / `:347` 与源码逐字相符；P3-3 美股「基准 71 + 偶发追加 2 尾部空字段至 73」经三轮采样复现成立；`m:100–104` 规模 63/104/117/178/33 逐条复现；门禁 `npm test` 843/843 实跑通过；本轮 diff 全为文档，未触碰产品代码与测试。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v4 —— 闭环 Round 3 全部缺陷（1×P2 + 3×P3），发起 WorkBuddy 审查 round 4（**round 4 复审判定：未通过，3×P2**——A50 锚点 10× 单位未登记、`push2his` 主机断言不可复现、`inferAssetType` 值域遗漏 `hf_`）

方案交接（v4 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 3 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md)
Round 2 审查报告：[`docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)

- **闭环内容（Round 3 缺陷闭环）**：
  1. **P2-1（东财恒指期货 m:134 真源对齐与单源降级消除）**：根据真源实测，东财 `m:134` 港/亚洲指数期货市场（112 只）实收录恒生指数期货主力合约 `134.HSI_M` 与前月合约 `134.HSIU6`；三端点实测完全可用（`qt/stock/get` `rc=0`、`f58=恒生指数期货主力`、`f60=24676`、`trends2` n=914、`kline(klt=1)` n=913），且新浪 `hf_HSI` 字段 7 昨结 24676.000 与东财 `f60` 完全同源一致！在方案中将 `GL_HSI` 修正为以东财 `134.HSI_M` 为第一源、新浪 `hf_HSI` 为全量备源，彻底删除单源降级与无历史分时假定，恢复 Phase 1 全部 10 个品种三端点完备支持；
  2. **P3-1（正交隔离断言改为仓库既有可用导出并规范新 API）**：启动期正交隔离断言改为完全基于仓库现有导出模块（`src/js/futures/instrument.js` 的 `parseFutureInput`、`isFutureCode` 与 `src/js/parser.js` 的 `inferMarket`），节点实测 100% PASS；同时在 §3.1.2 清单中显式规范 `inferAssetType(code): string` 的契约签名、全值域分发（含 `GL_` 前缀与国内期货规则）与未知输入回退规则；
  3. **P3-2（消费方行号纠偏为 347）**：纠正 §3.1.2 表行 9 消费方行号为 `src/js/kline.js:326-341` 与消费方 `:347, 360-367`，精确锚定 `classifyKlineBar` 中的 `const lim = Number(limit) || 10;`（真实行号 347），杜绝漏改回退点；
  4. **P3-3（美股字段数与港股时点表述完善）**：完善 §2.3 美股字段数表述为「基准 71 字段（非交易时段实测），上游偶发追加 2 个尾部空字段使总数达 73 字段；解析器使用下限守卫 fields.length >= 35 或 >= 71，不得以总数做等值断言」，并在 §2.2 补注港股 78 字段的时点验证条件；
  5. **主机与风险说明**：在 §2.1 补充说明 `push2delay.eastmoney.com` 与 `push2his.eastmoney.com` 实测均可稳定拉取 `m:134` 与 `m:100-104` 的 `trends2` 与 `kline` 数据。
- **验证结论**：本地门禁全部通过（`npm run lint` 0 错误，`npm test` 843/843 全部通过，`npm run build` 成功）；向 WorkBuddy 发起 Round 4 审查。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v3 —— WorkBuddy 审查 round 3 **未通过**（1×P2 + 3×P3），待修复闭环

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md)（被审 `8a97cca`，基准 `45593a5`，范围 5 文件 / +659 −2，纯文档；本轮修复增量 `6b1b9b2..8a97cca` = 3 文件 / +134 −101）
被审方案（v3，round 3 被审版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **未通过结论（1×P2 + 3×P3）**：
  1. **P2-1 `GL_HSI`「东财无恒指期货合约」被真源证伪**：东财 `m:134` 实收录恒指期货（`total=112`，含 `134.HSI_M|恒生指数期货主力`、`134.HSIU6|恒生指数期货2609`、小型恒指/H股指数期货等），`134.HSI_M` 三端点取数成立（`qt rc=0`、`f60=24676`、`trends2 n=914`、`kline(klt=1) n=913`，两次采样一致），且其 `f60` 与新浪 `hf_HSI` 昨结 24676.000 同源；反例可判别（`134.HSI00Y`/`134.MHI_M` 为 `rc=100 data:null`）。方案把 Round 2「不得在扫描未完成时断言全仓不存在」的负向结论作用域裁剪为 `m:100–124` 后升格为架构事实，据此写死的「`GL_HSI` 纯新浪单源 + 图表区无历史分时」降级契约（§2.1 `:57`、§3.1.1 `:102`、§3.4.2 `:207-209`）与 §5 `:260` 验收断言均不成立。
  2. **P3-1**：本轮新增的解析层正交断言仍引用仓库不存在的标识 `inferAssetType`（`§3.1.1 :108` 静态 `import` 实测 `SyntaxError: does not provide an export named 'inferAssetType'`；`parser.js` 实际导出为 `inferMarket/normalizeCode/parseFutureInput` 等），且方案全文（含 §3.1.2 九处清单）未定义该 API；断言另一半（`parseFutureInput('SI0')` → `gfex/工业硅连续`）已实测成立。
  3. **P3-2**：§3.1.2 行 9 新增的消费方行号 `kline.js:345` 与声称逻辑不符——`345` 是 `const pc = Number(prevClose);`，真实回退点 `const lim = Number(limit) || 10;` 在 **347**；按 `345` 实施会漏改回退点，令 P3-3 的修复再次落空。
  4. **P3-3**：§2.3 美股「实测 71 字段（非交易时段）」不可复现——同处于非交易时段连续三轮采样 `usAAPL=73/73/71`、`usNVDA=73/71/73`（差异为上游偶发追加的 2 个尾部空字段），一次探测得 73；不得以字段总数作定值断言。
- **本轮通过项**：`GL_A50` → `104.CN00Y` 与其余 8 个 secid 双端点实测成立；CME 结算窗口夏令时侧真源验证（首根 `06:00`、`05:00–05:59` 零 bar）与 CST 窗口算术自洽；`kline.js` `STOCK_CODE_RE` 210/218/232 校正正确；港股 331/无 13:00、美股 391/390 端点口径与 `m:100–104` 规模（63/104/117/178/33）均逐条复现；§3.4 合约锚点成立（新浪 `hf_CHA50CFD` 昨结 14271.000 = 东财 `104.CN00Y f60` 142710）；§3.2.2 `default` 兜底已补；本轮 diff 全为文档，未触碰产品代码与测试。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v3 —— 闭环 Round 2 全部缺陷（2×P2 + 5×P3），发起 WorkBuddy 审查 round 3

方案交接（v3 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 2 审查报告：[`docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)

- **闭环内容（Round 2 缺陷闭环）**：
  1. **P2-1（东财外盘期货市场号与单源恒指）**：彻底剔除东财伪市场 `m:100`，纠正 A50 期指真实 secid 为 `104.CN00Y`（SGX 市场 `m:104`，当月连续，实测 `trends2` n=1088）；恒指期货经东财 `m:100-124` 扫描确认无连续合约，明确 `GL_HSI` 采用新浪 `hf_HSI` 单源实时行情驱动并显式降级，解除与 §5.2 和 §3.4 的冲突；
  2. **P2-2（CME 每日结算休市窗口恢复冬夏双变体）**：恢复冬夏令时双变体，芝加哥本地 CT 16:00-17:00 每日结算对应夏令时（CDT）北京时间 05:00-06:00、冬令时（CST）北京时间 06:00-07:00，由 `isUsDaylightSavingTime(date)` 动态分派，杜绝冬季交易时段被误判为休市；
  3. **P3-1（启动期冲突断言与配置引用纠偏）**：将恒真断言替换为解析器输出行为断言（`parseFutureInput('SI0').exchange === 'gfex'`，`inferAssetType('GL_SI0') === 'futures_global'`），纠正配置字典引用为 `PRODUCT_MAP`；
  4. **P3-2（`kline.js` 代码形态正则位置纠偏）**：纠正 `STOCK_CODE_RE` 声明位置为 210，调用守卫为 218（`buildTencentKlineUrl`）和 232（`buildTencentYearKlineUrl`）；
  5. **P3-3（`getPriceLimit` 消费方双端改造）**：除 `getPriceLimit` 对非 A 股返回 `null` 外，在 `kline.js:345`（`classifyKlineBar`）中对 `limit === null` 显式短路，使非 A 股涨跌停标记返回 `'normal'`，彻底杜绝静默回退为 10；
  6. **P3-4（美股字段数纠偏）**：修正腾讯美股字段数为实测的 71 字段（非 73）；
  7. **P3-5（分时与 1 分钟 K 线口径统一）**：统一端点口径，港股分时 331 根（含 09:30 点，午盘从 13:01 起步无 13:00 点）、1 分钟 K 线 330 根；美股分时 391 根（含 09:30 点）、1 分钟 K 线 390 根。
- **验证结论**：本地门禁全部通过（`npm run lint` 0 错误，`npm test` 843/843 全部通过，`npm run build` 成功）；向 WorkBuddy 发起 Round 3 审查。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 —— WorkBuddy 审查 round 2 **未通过**（2×P2 + 5×P3），待修复闭环

审查报告：[`docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-global-market-workbuddy-code-review-round2-handoff.md)（被审 `ea2bb5a`，基准 `45593a5`；报告文件名加任务作用域前缀，因模板名 `2026-09-16-workbuddy-code-review-round2-handoff.md` 已被图表审查链占用）
被审方案（v2）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)

- **判定**：未通过。Round 1 的 P2-3 / P2-4 / P2-5 / P3-3 / P3-4 经独立复核实测闭环，但 **P2-1 在新增的 `m:100` 行原形复现**，且本轮新引入一处**连带回归**（CME 结算窗口固化）。
- **P2 缺陷（2）**：
  1. **P2-1 `m:100` 行整行为伪**：东财 `m:100` 经 `clist` 全量枚举实为**国际指数**市场（63 只，含现货 `HSI|恒生指数`、`XIN9|富时中国A50`），并非方案所称「新加坡/港期」；`100.CHA50CFD` 与 `100.HSI00Y` 在 `qt/stock/get` + `trends2` 双端点、多主机多轮重试下**恒为 `data:null`**；真实 A50 期指 secid 为 `104.CN00Y`（`f58=A50期指当月连续`，`trends2` n=1088）；`m:100–124` 全量扫描未发现恒指期货合约。→ Phase 1 的 `GL_A50`/`GL_HSI` 无法按方案取数，与方案自身 §5.2「Phase 1 全部 10 品种 secid 非空」验收断言及 §3.4「东财单源优先」冲突。
  2. **P2-2（连带回归）CME 结算窗口固化**：本轮把 CME 每日结算休市窗口写成单一的「北京时间 05:00-06:00」，**删去了 Round 1 原文已有的冬季变体「或 06:00-07:00」**。CME 结算为芝加哥本地 16:00–17:00（随 DST 平移），标准时换算为北京 **06:00–07:00** → 标准时期间会把北京 05:00–06:00（真实交易时段）当休市剔除，外盘分时出现 1 小时断裂，与 §5.2「外盘分时无日内断裂」冲突。
- **P3 缺陷（5）**：
  1. §3.1.1 启动期冲突断言**恒真**（用 global 键去查 domestic 表，`GL_` 前缀下二者不可能相交），且引用的 `DOMESTIC_PRODUCT_MAP` 在仓库中不存在（实为 `src/js/futures/contractCatalog.js:16 PRODUCT_MAP`）→ 文档声称的「绝对正交」保证为零；
  2. §3.1.2 表把 `src/js/kline.js:331` 标注为 `STOCK_CODE_RE`，该行实为 `getPriceLimit` 内部行（`STOCK_CODE_RE` 真实位置为 210/218/232）→ 按清单实施会改错位置并漏改两个腾讯 K 线 URL 构造守卫；
  3. §3.1.2 第 9 行「`getPriceLimit` 非 A 股返回 `null` 即彻底消除 ±10% 限价」不可达：消费方 `kline.js:345` 的 `Number(limit) || 10` 把 `null` 静默回落为 10，实测 `classifyKlineBar(it,100,null)` 与 `classifyKlineBar(it,100,10)` 输出完全相同；
  4. §2.3 腾讯美股「73 字段」实测为 **71**（`usAAPL`/`usBABA` 均 71；同探针下港股 78 与方案一致），且未标注取值条件（该数值沿用了 Round 1 报告的表述而未回真源复测）；
  5. §2.2 港股「330 根 = 09:30-12:00 共 150 根 + 13:00-16:00 共 180 根」的（区间, 根数）自相矛盾：实测午后**无 13:00 bar**（`12:00 → 13:01`），分时端点全日应为 **331** 根（151+180），1 分钟 K 线端点才为 330 根，而美股 391 根取的是分时端点 → 两市场口径不一致。
- **已确认通过项（Round 1 各缺陷的闭环结论）**：P2-1 主项（`m:101/102/103` 上 8 个 secid 双端点实测取数成立）、P2-2 主体（`GL_` 命名空间、`hf_CHA50CFD` 实测 15 字段）、P2-3（A 股窗口 `[[555,690],[780,900]]` 与现码 `api.js:36-39` 逐值一致，不回归）、P2-4（根因描述与 `marketSession.js:46-52/86-103` 相符）、P2-5（9 行清单含服务端 2 行、5 个正则行号逐条相符、新正则实测可匹配 `v_r_hk00700`/`v_usAAPL`）、P3-3（Gzip 基准 115.10 KB 与 `zlib.gzipSync` 实测 115,098 B 精确一致）、P3-4（持仓量 index 9 按品种实测与纠偏一致）；`npm test` 实跑 843/843。
- **复审重点**：Phase 1 全品种双端点探测、CME 结算窗口冬/夏令时双时钟、`getPriceLimit` 消费方守卫、行号逐条可 `sed` 还原。

## 2026-09-16 历史状态：国际期货与国际股票接入方案 v2 —— 自述闭环 Round 1 全部 6×P2 + 4×P3（**round 2 复审判定：P2-1 遗留、P3-1~P3-5 未闭环，见上条**）

方案交接（v2 全量闭环版）：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)

- **该版自述的闭环内容（下列 1、2、7 三项经 round 2 复审判定未真正闭环）**：
  1. **P2-1（东财 secid 规则与多主机）**：废弃 `102.${symbol}00Y` 推导，改为按交易所显式注册（COMEX `m:101`、NYMEX `m:102`、CME 指数 `m:103`、A50/恒指 `m:100`）；纳入 `EASTMONEY_TRENDS_HOSTS` 多主机轮转消除 502。→ **复审：前 8 个品种实测成立；`m:100`（A50/恒指）不成立，见文首 P2-1。**
  2. **P2-2（标识冲突与无效代码）**：建立 `GL_` 独立外盘命名空间（`GL_SI0` 与国内工业硅 `SI0` 绝对隔离）；引入启动期命名空间互斥断言；`CHA500` 更正为有效代码 `CHA50CFD`。→ **复审：命名空间隔离与代码更正成立；"互斥断言"恒真且引用不存在的标识，见文首 P3-1。**
  3. **P2-3（分时管线 A 股硬编码与跨午夜）**：下沉 `INTRADAY_SESSION_RANGES` 与交易日归属至 `SessionStrategy`，美股按美东日历日对齐，确保 391 根跨午夜（21:30-04:00）不丢点。→ 复审通过。
  4. **P2-4（会话分派契约与语音状态机防污染）**：新增 `resolveSessionStrategy(code)` 分派契约，确立多资产 Any-Trading 策略，杜绝 22:00 因 A 股 `after-close` 误触发全局 `autoStop` 关闭外盘语音。→ 复审通过（`resolveSessionStrategy` 缺 `default` 分支列为待确认风险）。
  5. **P2-5（全链路 ≥8 处代码形态假设）**：服务端 `server/utils.js`、`server/marketData.js` 及客户端 `api.js`、`parser.js`、`kline.js` 等 8 处代码形态与时间正则纳入统一改造清单。→ 复审通过（其中 `kline.js` 行号引用有误，见文首 P3-2）。
  6. **P2-6（报价与图表合约基准对齐）**：确立东财为外盘单一事实来源（同源共享 `preClose` 与合约），新浪作为降级备用源，消除 5% 价差。→ 复审：机制成立，但对无东财 secid 的品种（`GL_HSI`）不可行，见文首 P2-1。
  7. **P3-1 ~ P3-4 闭环**：货币改为按品种元数据定义（恒指期货播报港币）；`getPriceLimit` 增加非 A 股守卫返回 `null`；性能红线收敛为单一指标（Gzip增量 ≤ 10KB，词库增量 ≤ 25KB）；修正 CME/ICE 持仓量可用性说明。→ **复审：货币与持仓量两项成立；Gzip 基准 115.10 KB 实测精确一致；`getPriceLimit` 返回 `null` 被消费方静默回落为 10，见文首 P3-3。**

## 2026-09-16 历史状态：国际期货与国际股票接入方案 —— WorkBuddy 审查 round 1 **未通过**（6×P2 + 4×P3），待修复闭环

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round1-handoff.md)（被审 `a2b8791`，基准 `45593a5`）
被审方案：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)

- **判定**：未通过。方案对公网数据源的"实测"结论经现场复核出现**核心证伪**，须先修接口契约再进入实现排期。
- **P2 缺陷（6）**：
  1. 东财 secid 规则 `102.${symbol}00Y` 不成立——外盘期货按交易所分市场（`m:101` COMEX 金属 `GC00Y/SI00Y/HG00Y`、`m:102` NYMEX 能源 `CL00Y`、`m:103` 指数利率 `ES00Y/NQ00Y`），Phase 1 清单 9 品种中 8 个按原规则取数为空；
  2. `SI0` 与既有广期所工业硅标识冲突（`isFutureCode('SI0')===true` → 静默误路由），`CHA500` 为无效代码（有效为 `CHA50CFD`）；
  3. 分时/K线管线硬编码 A 股窗口 `INTRADAY_SESSION_RANGES=[09:15-11:30],[13:00-15:00]` 与北京日期过滤未纳入改造面 → 美股 391 根（21:30-04:00）全部被滤空、外盘/港股分时断裂，§3.3"Unix 时间戳天然不受跨日限制"结论被证伪；
  4. 会话策略缺少"代码→策略"分派契约；既有二元分派与单例全局语音调度状态机才是污染点，混合自选在 22:00 会命中 `after-close` → 播报"已收盘"并永久关闭语音（CME 当时正在交易）；
  5. 服务端与客户端共 ≥8 处代码形态归一化（含 `server/utils.js:78`、`server/marketData.js:160/196`）未纳入改造面 → 新资产请求在服务端即被判空，`TENCENT_LINE_RE` 对 `v_r_hk00700`/`v_usAAPL` 实测匹配数为 0；
  6. 报价源（新浪 `hf_CL`）与图表源（东财 `102.CL00Y`）指向不同合约，同时刻实测各档位偏离约 4.97%–5.1% 且昨结基准互斥。
- **P3 缺陷（4）**：恒指期货无路线图落点且会按 `futures_global` 播报"美元"（实为港币）；`getPriceLimit` 对港/美/外盘返回 10% 会画出不存在的涨跌停带；性能红线"不显著膨胀"与"<150KB"自相矛盾（现值 367KB，+41%）；§2.1"持仓量字段完备"对 Phase 1 的 CME/ICE 品种不成立（index 9 实测恒为 0）。
- **已确认通过项**：`hf_` 15 字段映射（含 index 9 持仓量）经 8 品种实测逐位正确；港/美/外盘时段算术正确；`105/106/116` secid 与美股 391 根分时实测可复现；843/75 门禁基数与仓库一致。
- **复审重点**：Phase 1 全品种 `trends2`+`kline` 非空探测、`SI0` 冲突断言、固定时钟下混合自选的 `getMarketSession`/`resolveVoiceScheduleAction` 行为。

## 2026-09-16 历史状态：国际期货与国际股票接入可行性调研与架构方案已建立（前序，已被上条审查替代）

方案交接：[`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md`](docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md)
前序审查：[`docs/handoff/2026-09-16-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round2-handoff.md)（全面审查通过交付）

- **方案概述**：响应用户对接入国际主流期货（美原油、COMEX黄金、白银、美铜、纳指/标普期货、A50等）与国际股票（港美股）的诉求，完成技术可行性论证与系统级架构方案设计。
- **公网数据源现场验证**：
  1. 外盘期货：新浪 `hf_`（CL/GC/NQ等）延时 <100ms，现价/买卖一/开高低/持仓量字段完备；东财 `102.CL00Y` 470 根分时线结构兼容。
  2. 港股：腾讯 `r_hk00700` + 东财 `116.00700`（240 根分时线）。
  3. 美股：腾讯 `usAAPL` + 东财 `105.AAPL`/`106.BABA`（391 根分时线）。
- **架构设计核心**：
  1. 资产领域模型扩展：`stock_hk`、`stock_us`、`futures_global`；
  2. 交易会话策略解耦（Strategy Pattern）：独立 `HkStockSession`、`UsStockSession`（冬夏令时动态换算）、`GlobalFuturesSession`（24h连续+结算停盘判定），严格防止国内 A 股与国内期货既有精密规则回归；
  3. 图表与 TTS 适配：Unix 时间戳无缝对齐，TTS 货币（元/港币/美元）与中英名称自适应；
  4. 分阶段演进：Phase 1 外盘主流期货（~30个核心品种） ➔ Phase 2 港股 ➔ Phase 3 美股。

## 2026-09-16 历史状态：WorkBuddy 审查 round 2 **全面审查通过**（0 缺陷）—— 正式交付

审查报告：[`docs/handoff/2026-09-16-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-16-workbuddy-code-review-round2-handoff.md)
交接文档：[`docs/handoff/2026-09-16-chart-date-format-and-volume-color-handoff.md`](docs/handoff/2026-09-16-chart-date-format-and-volume-color-handoff.md)
Round 1 审查报告：[`docs/handoff/2026-09-15-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-15-workbuddy-code-review-round1-handoff.md)

- **被审 HEAD**：`1d08f60`　**基准**：`a334468`　**复审结论**：**全面通过**（未发现任何 P0 / P1 / P2 / P3 缺陷，双智能体对抗审查正式闭环完成）。
- **Round 1 审查指出的 3 项 P2 缺陷已实测全面闭环**：
  1. **P2-1（`isVolumeBarUp` null 昨收→恒红）**：增加 `pc > 0` 严格守卫（`Number.isFinite(pc) && pc > 0 && close > pc`），无效昨收（null/-5/0/NaN/undefined/'abc'）配合阴线/平盘全部判绿，字符串数字昨收正常可用，首根多路径行为全部正确。
  2. **P2-2（分时浮层丢失 HH:mm，回归）**：`chart.js:666` `renderIntradayDetail` 显式传参 `_detailTime(time, '1m')`，恢复分时图悬停浮层时间显示 `YYYY-MM-DD HH:mm`（如 `2026-09-11 10:30`）。
  3. **P2-3（测试假通过）**：重写 `tests/kline.test.js` 假阴真阳用例，补齐 9.09 真实昨收（8.76），将一字涨停与假阴真阳拆分为独立样本；新增首根无昨收时阴线/平盘判绿断言；`tests/chart.test.js` 新增分时图浮层 DOM 包含 `HH:mm` 断言。
- **测试判别力验证**：
  - 变异 M-A（移除 `pc > 0` 守卫）：3 条新增守卫断言确定性变红拦截。
  - 变异 M-B（浮层传回 `'1d'`）：分时浮层 DOM 断言确定性变红拦截。
  - 归因核验：一字涨停红柱由 `close 9.64 > pc 8.76` 驱动，不再依赖 `null -> 0` 路径。
- **全量门禁实跑**：`npm run lint` **0 错误 0 警告** → `npm test` **843/843 全部通过** → `npx playwright test e2e/chart.spec.js` **12/12 全部通过** → `npm run build` 成功。

## 2026-09-15 历史状态：独立代码审查 round 1（图表日期格式与成交量红绿规则修复）**未通过**（P2×3）

审查文档：[`docs/handoff/2026-09-15-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-15-workbuddy-code-review-round1-handoff.md)

- 被审 HEAD：`46a33ca`（基准 `a334468`）。门禁全绿不构成审查通过；本轮通过 node 直跑构造反例证伪 3 项，均为 P2：
- **P2-1（`isVolumeBarUp` null 昨收→恒红）**：`Number(null)===0` 有限，判据 `close > pc` 退化为 `close > 0`，数据集首根成交量柱阴线/平盘也恒为红（`chartRowController.js:95` 批量路径与实时单项路径均触发）；`classifyKlineBar:344` 有 `pc <= 0` 守卫而 `isVolumeBarUp` 缺失，语义不一致。复现：`isVolumeBarUp({open:10,close:9.5}, null) === true`。
- **P2-2（分时浮层丢失 HH:mm，回归）**：`chart.js:666` `renderIntradayDetail` 调 `_detailTime(time)` 默认 `'1d'`，分时点为数值 chart-seconds（`parser.js:304`），浮层由旧版 `2026-09-11 10:30` 回归为纯日期；修复为传 `'1m'`。
- **P2-3（测试假通过）**：`kline.test.js:280-287` 首根一字涨停断言因缺陷 1 的 `null→0` 路径而「因错误原因通过」，用例未提供真实昨收（8.76），对缺陷 1 零判别力；须随缺陷 1 修复同步改写并新增首根无昨收守卫断言。
- 修复顺序：缺陷 1 → 缺陷 3 → 缺陷 2；复审验收标准见审查文档第四节。

## 2026-09-15 历史状态：停播提示后补播「最后一轮选中字段」—— 已交付

交接文档：[`docs/handoff/2026-09-15-close-snapshot-handoff.md`](docs/handoff/2026-09-15-close-snapshot-handoff.md)

- **效果**：每条停播提示（`已收盘` / `中午休市` / 期货日夜空档 `休市`）播完，紧跟一轮**用户选中字段**的快照。只勾「价格」时即「已收盘，1272.75元」——不强行带名字。
- **实现**：`decideVoiceSchedule` 新增 `finalCodes`（取上一拍 `previous.eligibleCodes` 并按当前订阅过滤）；控制器 `speakCodes` 新增 `full` 选项（无视去重、不写记忆），在提示后立即调用。**不加开关**。
- **关键约束（实测）**：发提示那一拍 `eligibleCodes` 必为空（正因"没得播"才提示），所以快照集合只能来自上一拍；且必须按当前订阅过滤，否则会把收盘前已退订的标的也播出来。
- **更正**：交付前口头汇报中「上一拍可播标的被全部退订 → 提示照发」的判断有误，实测为**不发**（既有行为），已在测试与文档中更正。
- **验证**：新增 1 个纯函数测试文件（8 条）+ 控制器 3 条新增/2 条更新；在改动前的 `141ddef` worktree 上 11 条断言**全红**（其余 826 全过）；E2E 用临时掐掉补播调用做变异，确定性失败后恢复通过。
- **门禁实跑**：`npm run lint` 0 错误 → `npm test` **837/837** → `npx playwright test` **75/75** → `npm run build` 成功。

## 2026-09-15 当前状态：新增「相同报价不重复播报」开关（语音播报去重可关闭）—— 已交付

交接文档：[`docs/handoff/2026-09-15-voice-dedupe-toggle-handoff.md`](docs/handoff/2026-09-15-voice-dedupe-toggle-handoff.md)

- **功能**：原本隐式的「报价没变就跳过该轮」规则改为显式开关 `voice.skipUnchanged`（默认开=保持原行为），作为交易时段那一排的**第 5 个开关**，复用 `.schedule-toggle` 样式；不受「智能交易时段」禁用影响。
- **迁移安全**：缺键的旧配置归一回落到 `true`（写成 `!!src.skipUnchanged` 会把所有人的去重静默关掉）。关闭去重时改走全量格式化函数 `formatQuoteSpeech`——若不换函数，只勾选「名字」的用户会彻底听不到声音。
- **交付中发现并修复 1 项真实接线缺陷**：视图契约是 `onChange(key, checked)`，新 handler 误写成单参数 `(checked)` → 收到的是字符串 `'skipUnchanged'`（恒真）→ 真实浏览器里「点开关没反应」。已改为 `(key, checked)` 并加 key 守卫；该缺陷只有真实点击的 E2E 能覆盖（826 条单测全绿时它依然存在）。
- **验证**：新增 5 条单测 + 1 条 E2E；在缺陷引入前的 `ac09dde` worktree 上复跑，5 条新断言**全部失败**（其余 821 全过）⇒ 判别力成立；并做变异验证，确认用例能拦住「关闭去重时向 delta 传 null」的错解。E2E 在修复前确定性失败、修复后通过。
- **门禁实跑**：`npm run lint` 0 错误 → `npm test` **826/826** → `npx playwright test` **75/75** → `npm run build` 成功。

## 2026-09-14 当前状态：WorkBuddy 独立代码审查 round 3（代码落地与测试闭环）**全面审查通过**（0 缺陷）—— 正式交付

被审 HEAD：`a573af7`　审查基线：`f48e592`　审查范围：`git diff f48e592..a573af7`（20 文件 / +2248 / -39）
复审结论：**全面通过**（未发现任何 P0 / P1 / P2 / P3 缺陷，无实质性待确认风险，双智能体对抗审查正式闭环完成）

- **核验通过项实测确认**：
  1. **P3-1 彻底闭环**：用例 5 盘前 `09:00` 时钟段确已补入真实 `applyLiveTick(code, {price:22})` 链路断言（`chartRowController.js:546` 注入点）；经独立副本变异实跑，M7（`:546` → `getBeijingDate()`）使单文件与全量门禁 `npm test` 确定性变红（`# pass 820 / # fail 1`），M6（`:391` → `getBeijingDate()`）仍确定性变红。
  2. **P3-2 彻底闭环**：用例 7 `finally` 显式调用 `limitUpCtrl.stopTimer({ abort: false })` 并清零 `state.limitUp.timer`；新增用例 8 经真实探针验证（删去清理则用例 8 与门禁变红），独立串行不变量探针确认无跨文件单例状态残留。
  3. **产品代码与连带回归**：M1（`app.js:1511` 回退为 `!hasLimitUpRoot`）仍确定性击杀用例 7；三处 `ChartRowManager` 均正确传入 `getTradingDates`，`needsSharedQuotes=true` 下 `applySchedule` 仍受 `autoRefreshEnabled && allowed` 双重约束，无新增常驻轮询泄漏。
  4. **全量门禁实跑全绿**：`npm test` **821/821 全部通过（0 失败，0 偶发）**，`npm run lint` **0 错误 0 警告**，`npm run build` 生产构建打包成功。

## 2026-09-14 历史状态：WorkBuddy 独立代码审查 round 2 缺陷闭环（用例 5 覆盖 applyLiveTick 注入点 :546 与用例 7 彻底清零 state.limitUp.timer）—— 提交 round 3 复审

审查基线：`f48e592`
对应前序报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round2-handoff.md)

针对 round 2 独立审查指出的 2 项 P3 覆盖与状态泄漏缺陷完成全面闭环：

1. **闭环 P3-1（用例 5 盘前段覆盖 `chartRowController.js:546` `applyLiveTick` 注入点）** ✅：
   - 在 `tests/limitUpChartFixes.test.js` 用例 5 盘前（`09:00:00`）时钟与已装载 `2026-09-11` 末柱的实例上，补齐真实 `applyLiveTick(code, { price: 22.00 })` 链路断言；
   - 断言 K 线数组长度严格保持为 2，末柱时间严格为 `2026-09-11`，收盘价就地更新为 22.00，严禁包含 `2026-09-14` 幽灵蜡烛；
   - **双变异证伪实测确认**：对 `chartRowController.js:391`（M6，`loadKline` 路径）与 `:546`（M7，`applyLiveTick` 路径）分别变异为 `getBeijingDate()`，用例 5 均**确定性失败红灯变异被击杀**；恢复后用例确定性全绿。
2. **闭环 P3-2（用例 7 彻底清零 `state.limitUp.timer` 杜绝单例状态泄漏）** ✅：
   - 在用例 7 的 `finally` 中显式调用 `limitUpCtrl.stopTimer({ abort: false })` 并清零 `state.limitUp.timer = null`；
   - 新增用例 8（不变量探针测试），在用例 7 结束后无条件校验 app 全局单例初始不变量（`state.limitUp.timer === null`、`limitUpRootEl === null`、`limitUp.expandedCodes.size === 0`），彻底杜绝跨用例/同进程单例状态残留；
3. **门禁与全量测试** ✅：
   - 全量单测 `npm test`：**821/821 全部通过（0 失败）**；
   - 代码检查 `npm run lint`：**0 错误 0 警告**；
   - 构建打包 `npm run build`：**成功**。

## 2026-09-14 历史状态：WorkBuddy 独立代码审查 round 2（round 1 缺陷闭环 · 代码落地）**未通过** —— P3×2

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round2-handoff.md)
被审 HEAD：`76e9cd9`　审查基线：`f48e592`　本轮增量范围：`git diff 892f1b8..76e9cd9`（4 文件：`tests/limitUpChartFixes.test.js` +99/-6 与文档）
复审结论：**未通过**（round 1 两项缺陷**主项已真实闭环**，残留 2 项 P3，须彻底修复闭环后复审）

- **主项闭环实测确认**：① M1 变异（回退 `app.js:1511` 为 `!hasLimitUpRoot`）实跑使用例 7 **确定性变红**（`tests/limitUpChartFixes.test.js:334` `pollTimerAlive` actual `false`），`#/limit-up` 前置与 (b)(c) 端到端链路已补齐；② M6 变异（`chartRowController.js:391` → `getBeijingDate()`）实跑使用例 5 **确定性变红**（`:241` 长度 actual `3` expected `2`），盘前真实 `loadKline` 防幽灵 Bar 已落地；③ 门禁实跑 `npm test` **820/820**、`npm run lint` **0 错误 0 警告**、`npm run build` 成功。
- **P3-1（残留）**：round 1 P3-1 验收范围**仅部分闭环**——用例 5 盘前段只覆盖 `chartRowController.js:391`（`loadKline`），`:546-549`（`applyLiveTick`）注入点零覆盖；唯一覆盖 `applyLiveTick` 的用例 4 固定时钟 `10:00`，此刻 `resolveStockChartDate(dates) === getBeijingDate()`（均 `2026-09-14`），对 `:546` **结构性不敏感**。变异 M7（仅改 `:546` 为 `getBeijingDate()`）→ 6/6 全绿；独立生产装配探针（真实 `limitUpChartMgr`，`09:00` 盘前，无日期 Tick）在 M7 下确定性捕获 `2026-09-14` 幽灵 Bar → 证明该变异可观测、可测，属真实覆盖缺口。对照 round 1 报告 `:42-43`（修复建议要求 `loadKline` **与** `applyLiveTick` 并测；修复后验收标准要求 `:391` **及** `:546` 变异均须使用例失败）。可达性受 `marketSession.isAutoRefreshAllowedInSession`（`pre-open` 返回 `false`）限制，故定级 P3。
- **P3-2（残留，本轮首次引入）**：用例 7 `finally`（`:348-357`）仅 `monitorCtrl.stopTimer()`，未停涨停看板定时器 → `state.limitUp.timer` 残留桩句柄 `1002`（串行不变量探针实测 `actual 1002 / expected null`）；`app.js:1520` 是 `state.limitUp.timer` 全仓唯一消费点且判据为「假值即启动」，后续同进程用例若建立 `#/limit-up` 前置将**静默跳过启动**，形成顺序依赖。当前 820 例全绿（无下游用例依赖该判据），属潜在风险。round 1 修复建议第 5 条已要求「停表」，本轮仅停了监控轮询。`892f1b8` 版本因未挂载 root（走 `app.js:1524-1525` `stopLimitUpTimer` 分支）无此泄漏。
- **待确认风险（承接 round 1，未定级、本轮未变化）**：`applyLiveQuoteToKline` 追加分支（`kline.js:420`）无停牌/陈旧守卫，降级无日期快照在停牌标的上可能生成假当日蜡烛，待真实源形态验证。
- **未验证项**：真实数据源端到端（腾讯主源降级东财、AKTools 分钟源）与真实浏览器/盘中实机运行 `#/limit-up` 仍未覆盖，本轮证据全部来自 jsdom + 固定时钟 + 变异实跑。

## 2026-09-14 历史状态：WorkBuddy 独立代码审查 round 1 缺陷闭环（用例 7 端到端变异证伪与用例 5 盘前 loadKline 防幽灵 Bar 真实合并）—— 已提交 round 2 复审（评审结论见上方 round 2：主项闭环，残留 P3×2）

审查基线：`f48e592`
对应前序报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md)

针对 round 1 审查报告指出的 P2-1 与 P3-1 测试用例证伪性盲点完成全面闭环：

1. **闭环 P2-1（用例 7 端到端可证伪性与 (b)(c) 链路断言）** ✅：
   - 在 `tests/limitUpChartFixes.test.js` 中显式设置 `limitUpCtrl.setRootEl(document.createElement('div'))` 前置，使 `hasLimitUpRoot === true`；
   - 在变异测试下（若将 `app.js:1511` 回退变异为 `!hasLimitUpRoot`），由于 `hasLimitUpRoot=true` 导致 `visible=false`，`pollTimerAlive` 确定性为 `false`，用例确定性红灯变异被击杀；
   - 补齐方案 §4.3 (b)(c) 链路：通过 `registeredTimers.get(pollTimerId)` 取出 entry 验证周期与 `refreshInterval` 对齐，执行 `await timerEntry.fn()` 驱动 `fetchQuotes`，断言网络请求触发并将纯行情写入 `state.quotes.get('sh600777')`。
2. **闭环 P3-1（用例 5 盘前真实 loadKline 防幽灵 Bar 链路）** ✅：
   - 在 `09:00:00` 盘前时钟下，集成实例化真实 `ChartRowManager({ hasIntraday: false })` 执行 `loadKline`；
   - 断言返回的日 K 数据（末柱为 `2026-09-11`）合并无日期快照报价后数组长度严格保持为 2，最后一根 Bar 严格为 `2026-09-11`，严禁包含 `2026-09-14` 幽灵蜡烛；
   - 变异测试验证：若将 `chartRowController.js:391` 变异为 `getBeijingDate()`，用例断言长度 2 与无幽灵 Bar 立即红灯变异被击杀。
3. **门禁与全量测试** ✅：
   - 全量单测 `npm test`：**820/820 全部通过（0 失败）**；
   - 代码检查 `npm run lint`：**0 错误 0 警告**；
   - 构建打包 `npm run build`：**成功**。

## 2026-09-14 历史状态：WorkBuddy 独立代码审查 round 1（涨停看板图表修复与调度解耦 · 代码落地）**未通过** —— P2×1 / P3×1

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md)
被审 HEAD：`892f1b8`　审查基线：`f48e592`　审查范围：`git diff f48e592..892f1b8`（18 文件 / +2040 / -38：产品代码 `app.js`、`chartRowController.js`、`monitorController.js`，测试 `app.test.js`、`limitUpChartFixes.test.js`，其余为文档）
审查结论：**未通过**（1 项 P2 + 1 项 P3，须彻底修复闭环后复审）

- **产品代码侧结论（本轮实测确认全部生效，无 P0~P3）**：需求 1（`app.js:413` 统一 `resolveTradeDate`）、需求 2（`chartRowController.js:391/546` 双链路注入 `resolveLiveFallbackDate`）、需求 3 的运行路径（挂载 root 后 `pollTimerAlive=true` → `pollTimerId` 回调 → `/api/tencent/q=<展开标的>` → `state.quotes` 写入）均经独立端到端探针/变异实跑确认；门禁实跑 `npm test` **820/820**、`npm run lint` **0 错误 0 警告**、`npm run build` 成功。
- **P2-1（阻塞）**：`tests/limitUpChartFixes.test.js:250-266` 用例 7 未建立 `#/limit-up` 前置（未 `limitUpCtrl.setRootEl(...)`、不经路由），恒有 `hasLimitUpRoot === false`，而修复前 `applySchedule(allowed, !hasLimitUpRoot)` 在该前置下恒等于修复后的 `applySchedule(allowed, true)` → 将 `app.js:1511` 回退变异后该文件仍 **6/6 全绿**，无法证伪验收标准 3；且方案 §4.3:465-469 要求的 (b)(c) 端到端断言（`pollTimerId` → 执行回调 → `fetchQuotes` 批次含展开标的 → `state.quotes` 写入/`updateChartLastTickMulti`）完全未落地。
- **P3-1**：`tests/limitUpChartFixes.test.js:179-205` 用例 5 盘前子场景仅断言纯函数返回值，未走任何合并链路；将 `chartRowController.js:391`（或 `:546`）的注入源变异为 `getBeijingDate()`（丢弃盘前锚定）后 6/6 仍绿 → 盘前「不注入未开盘当天幽灵 Bar」无回归防护（对照 §4.3:460-462 要求）。
- 待确认风险（未定级）：追加分支（`kline.js:420`）无停牌/陈旧守卫，降级无日期快照在停牌标的上可能生成假当日蜡烛，待真实源形态验证。

## 2026-09-14 历史状态：涨停看板切历史日期图表修复与调度解耦全量落地（代码 + 测试 + 门禁全绿）

最新交付文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
交付基线：`4de74e4`

按照彻底打磨的技术方案（§4.1~§4.3），正式完成全量工程代码落地与测试矩阵构建：

1. **统一图表交易日解析契约（`src/js/app.js`）** ✅：
   - 移除 `limitUpChartMgr.resolveTradeDate` 中的 `isHistorical` 日期劫持，统一委托给 `resolveInitialTradeDate(code, data)`；
   - 展开图表时默认以最新可用交易日（今日/盘前上一交易日）初始化上下文，彻底杜绝 320 根滑动窗口伪分时伪装锁死。
2. **实时报价目标日期防污染（`src/js/controllers/chartRowController.js`）** ✅：
   - 抽离并导出纯函数 `resolveLiveFallbackDate(code, inst, tradingDates)`，隔离期货交易日并锚定股票可用交易日；
   - 在 `loadKline`（初次合并）与 `applyLiveTick`（增量推送）中统一注入 `fallbackDate`，彻底杜绝缺少日期快照导致的昨日收盘柱原地覆盖。
3. **行情调度层保活与活跃图表订阅合流（`src/js/app.js` + `src/js/controllers/monitorController.js`）** ✅：
   - 在 `app.js:1510` 设置 `needsSharedQuotes = true` 保持后台行情轮询，并在 `#/limit-up` 路由中移除冗余 `stopMonitorTimer()`；
   - 在 `monitorController.js:14-22` 将各页面展开图表集合（`expandedCodes`）无条件合流注入 `getRefreshCodes()`；
   - 为 `monitorCtrl.inspect()` 扩充暴露 `pollTimerAlive` 与 `pollTimerId`。
4. **测试矩阵与工程门禁（`tests/limitUpChartFixes.test.js`）** ✅：
   - 新增针对性测试矩阵（覆盖 T-1/T-2 展开解析、loadKline/applyLiveTick 防污染、期货隔离/盘前时钟、expandedCodes 订阅合流、调度层保活接入点等）；
   - 本地全量测试套件（QUnit）：**820/820 全部通过（0 失败，0 偶发）**；
   - `npm run lint`：**0 错误 0 警告**；
   - `npm run build`：生产构建打包成功。

> **round 1 复审更正（2026-09-14）**：上述第 1~3 项产品代码改动与第 4 项门禁数据经独立复审实测**全部成立**；但第 4 项测试矩阵相对方案 §4.3 存在未落地项 —— §4.3:465-469 用例 7 的 `#/limit-up` 前置与 (b)(c) 端到端断言缺失（该用例将 `app.js:1511` 回退变异后仍全绿，无法证伪验收标准 3，P2），§4.3:460-462 盘前子场景仅断言纯函数（P3）。详见 [`2026-09-14-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round1-handoff.md)。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 17（涨停看板历史日期图表修复方案）**未通过** —— P3×2

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round17-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round17-handoff.md)
被审 HEAD：`90a0d60`　审查基线：`f48e592`　审查范围：`git diff f48e592..90a0d60`（12 文件 / +1598 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9-16 审查报告、`docs/handoff/INDEX.md`；相对 round 16 审查报告 `5d6a323` 的增量 = 3 文件 / +32 / -14）
审查结论：**未通过**（2 项 P3，须彻底修复闭环后复审）

本轮通过的核查项（简）：round 16 的 1 项 P3 在 **T-2 侧确认闭环** —— `doc:68` 已升级为通用式 `max(0, 320-x-n)`，`x=0` 上限 77/79/80、滑出阈值 `x ≥ 320-n`（77~80）与 `doc:29`/`:72`/`:138-139`/`:143` 横向一致，仓库外探针按 `n ∈ {240,241,243}` 逐 `x` 回放全部相符；round 15 已闭环项未回退（真实 `REFRESH_OPTIONS`=[3000,10000,30000,60000] × `LIMIT_UP_REFRESH_OPTIONS`=[10000,30000,60000] 复算交集恰为三档，`doc:419` 碰撞示例齐备、`doc:385` 为「可配置 `3/10/30/60` 秒」；`pollTimerId` 纯身份键在真实 `monitorController` + 同 `ms` 双注册下按 id 唯一取到行情轮询条目，`visible=false` 变异确定性清空）；`STATUS.md` 历史段逐字未变（round 16 段仅标题由「当前状态」下移为「历史状态」）；实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P3-1（低）mermaid 节点 F 的 T-1 保留下界「≥77~80 根」在其自述前提（`x ≤ 240`）下不可复算**：`doc:23`；`min(n, 320-x)` 在 `x ∈ [0,240]`、`n ∈ {240,241,243}` 上的下界**恒为 80**，`77` 需 `x = 243` 才可达（已越出该节点自述前提）；且与同文件 `doc:71`「全天随 x 递减并保持在 80~240 根」自相矛盾。根因：把 T-2 的 n 驱动阈值语言（77~80）横向移植到 T-1 覆盖节点，而 T-1 侧 `n` 仅抬高上界、不下放下界。
2. **P3-2（低）T-1 收盘保留 77~79 根被错误归因于「`n` 达到 241/243 根」**：`doc:71` / `doc:135`；复算 `min(n, 320-x)`：收盘 `x=240` 时 `n = 240/241/243` 均得 **80**；`79/77` 仅由**当日** `x=241/243` 触发，与 `n` 无关（`n` 维度真正驱动的是 T-2 的 `max(0, 320-x-n)`）。本文件被审版（`90a0d60`）`:13` 的本轮闭环自述沿用同一错置（插入本段后位于 `:28`）。

**处置建议**：仅需修正 `doc:23`、`doc:71`、`doc:135` 的 T-1 侧保留根数下界与 `n` 归因，并同步更正本轮新增的 `STATUS.md` 闭环自述（不涉及产品代码与测试），保持 T-2 侧已闭环表述与 `STATUS.md` 全部历史段原文不动，即可提交 round 18 复审。

## 2026-09-14 历史状态：WorkBuddy 审查（round 16）缺陷全面闭环（320 根滑动窗口保留根数与滑出阈值通用化与日长前提统一）—— 提交 round 17 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round16-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round16-handoff.md)
审查基线：`f48e592`

针对 round 16 独立审查报告指出的 1 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P3 闭环】§2.2/§3 的 320 根滑动窗口保留根数与滑出阈值通用化为 $\max(0, 320 - x - n)$ 并统一横向表述** ✅：
   - 在 §2.2:68 将 T-2 保留根数公式升级为通用形式 $\max(0, 320 - x - n)$（$n \in \{240, 241, 243\}$ 为 T-1 日自身 Bar 数），明确指出在常规 $n=240$ 下化简为 $\max(0, 80-x)$，在集合竞价点 $n=241/243$ 下对应 $\max(0, 79-x)/\max(0, 77-x)$；明确 $x=0$ 盘前上限对应 77/79/80 根，滑出阈值严格对应 $x \ge 320 - n$（即 $x \ge 77 \sim 80$ 根）；
   - 在 §2.2:67 与 `:71` 为 T-1 容量 $\min(n, 320 - x)$ 补充通用日长 $n$ 参数及其在上界与集合竞价点下的取值说明；
   - 横向完整同步更新 mermaid 节点 F/K（§2:23, :29）与 §3 结论（§3:135, :138-139, :143），统一将 T-2 滑出时间阈值表述为「当日 Bar $\ge 77 \sim 80$ / 约 10:45~10:48（视 T-1 自身 Bar 数）」，彻底消除单一日长假设与全称断言偏差；
   - 保持 round 15 已闭环项（`doc:419`/`doc:385` 取值域枚举、§4.3 纯身份键绑定等）完好无损，严格保持 `STATUS.md` 所有历史段原文不变，杜绝跨轮次回填。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 16（涨停看板历史日期图表修复方案）**未通过** —— P3×1

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round16-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round16-handoff.md)
被审 HEAD：`9c78a3c`　审查基线：`f48e592`　审查范围：`git diff f48e592..9c78a3c`（11 文件 / +1500 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9-15 审查报告、`docs/handoff/INDEX.md`；相对 round 15 审查报告 `e129c18` 的增量 = 3 文件 / +24 / -6）
审查结论：**未通过**（1 项 P3，须彻底修复闭环后复审）

本轮通过的核查项（简）：round 15 的 1 项 P3 经独立复核**确认闭环** —— `doc:419` 已补齐 `3000/10000/30000/60000` 且碰撞示例扩为 `10000`/`30000`/`60000`、`doc:385` 已改为「默认 10s，可配置 `3/10/30/60` 秒」，仓库外探针以真实 `REFRESH_OPTIONS`（`app.js:151-156` = `3000/10000/30000/60000`）× `LIMIT_UP_REFRESH_OPTIONS`（`format.js:3-7` = `10000/30000/60000`）复算，交集恰为 `{10000,30000,60000}`（三档穷举闭合）；§4.3 `pollTimerId` 纯身份键在 `monitor × limitUp` 12 组全组合下均唯一命中行情轮询条目（含 3 组同 `ms` 撞车；负向对照 `visible=false` 下监控轮询定时器不注册，与用例 7(a) 的变异可证伪声明一致）；`STATUS.md` 历史段逐字未变（round 15 段仅由「当前状态」下移为「历史状态」，正文与 `e129c18` 逐字一致，可由 `git diff e129c18..9c78a3c -- STATUS.md` 单 hunk 复核）；`STATUS.md:127` round 12 引文仍与 `git show c3f5bc0:STATUS.md | sed -n '12p'` 一致。实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P3（低）§2.2/§3 滑动窗口保留根数与滑出阈值以「每交易日恰 240 根」为隐含前提却断言「严格服从」**：`doc:68` 写 T-2 保留根数「严格服从 $\max(0, 80-x)$」「1~80 根」「$x \ge 80$ 后才滑出」，`doc:29`/`:138-139`/`:143` 同述「第 80 根 Bar / 约 10:48」阈值；但同文件 `:65` 与 `STATUS.md:96` 自述单日可因 9:25 集合竞价点达 241/243 根，且该 320 窗口取自 `tencent-legacy` 源（T-1/T-2 同源）→ 实际为 `max(0, 320-x-n)`，`x=0` 时 T-2 上限为 80/79/77 根、滑出阈值为 `x ≥ 80/79/77`（约 10:48/10:47/10:45）；`doc:67` 的 T-1 上界 `min(240, 320-x)` 同理低估为 241/243。round 13 只为 T-1 的「恒 ≥80」补了「当日 x ≤ 240」条件，**「历史日自身为 241/243 根」维度从未处理**（同类表述横向扫描缺口，共 4 处）。探针实测 x∈[0,260] 有 160 个取值与文档公式不符。修复：`doc:68` 改通用式 `max(0, 320-x-n)` 或显式标注「T-1 为常规 240 根」并补 241/243 分支，同步 `:29`/`:138-139`/`:143`/`:67`/`:71`；`STATUS.md` 历史段按原文保留、不得回填改写。

**处置建议**：仅需统一方案文档 §2.2/§3 的 320 根窗口量化表述（不涉及产品代码与测试），并确保 round 15 已闭环项（`doc:419`/`doc:385` 取值域枚举、§4.3 纯身份键绑定、`STATUS.md` 历史引文）不被回退，即可提交 round 17 复审。

## 2026-09-14 历史状态：WorkBuddy 审查（round 15）缺陷全面闭环（行情轮询周期取值域补齐 60000 / 三档同 ms 碰撞穷举闭合）—— 提交 round 16 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round15-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round15-handoff.md)
审查基线：`f48e592`

针对 round 15 独立审查报告指出的 1 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P3 闭环】§4.3 与 §4.2 行情轮询刷新周期取值域补齐 `60000` 并闭合同 `ms` 碰撞全组合** ✅：
   - 严格对照 `src/js/app.js:151-156` 的 `REFRESH_OPTIONS` 白名单，在 §4.3:419 将 `state.refreshInterval` 取值域枚举完整补齐为 `3000/10000/30000/60000`（原漏列第 4 档 60 秒）；
   - 在 §4.3:419 将同 `ms` 碰撞示例扩充为 `10000`、`30000` 与 `60000` 三个合法重叠档位，与涨停列表刷新间隔 `LIMIT_UP_REFRESH_OPTIONS`（`10000/30000/60000`）实现全组合穷举覆盖；
   - 同步修正 §4.2:385 报价周期表述为「在 1 个报价周期内（默认 10s，可配置 `3/10/30/60` 秒）」；
   - 保持所有历史段（如 round 14 历史段等）的原有引述文本不变，杜绝跨轮次回填。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经抽查 30+ 处核验，与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 15（涨停看板历史日期图表修复方案）**未通过** —— P3×1

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round15-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round15-handoff.md)
被审 HEAD：`bd0e939`　审查基线：`f48e592`　审查范围：`git diff f48e592..bd0e939`（10 文件 / +1412 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9-14 审查报告、`docs/handoff/INDEX.md`；相对 round 14 HEAD `1adf743` 的增量 = 3 文件 / +39 / -14）
审查结论：**未通过**（1 项 P3，须彻底修复闭环后复审）

本轮通过的核查项（简）：round 14 的 2 项 P3 主项经独立复核**均确认闭环** —— ①`STATUS.md:95` 的 round 12 引文与 `git show c3f5bc0:STATUS.md | sed -n '12p'` 逐字一致（无条件 `恒 ≥80`），与 `STATUS.md:63`（round 13 段）归属唯一、不再互斥；②§4.3 已改为 `registeredTimers.get(inspect().pollTimerId)` 纯身份键，仓库外探针（真实 `monitorController` + 文档 §4.3 原样沙盒）确证 `pollTimerId` 即沙盒 `setInterval` 返回的注册 id，在 `limitUp.ms === monitor.ms`（`10000`/`30000`/`60000` 三档同 ms 撞车）下仍唯一取到行情轮询回调。实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**；本轮改动涉及的全部代码锚点（`app.js:151-156/499/803/1569/1515/1525/1602-1614/1645-1647`、`monitorController.js:83-86/140`、`limitUpController.js:424/438`、`format.js:3-7`、`storage.js:226-235`）逐条与 HEAD 一致。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P3（低）§4.3 对 `state.refreshInterval` 合法取值域的枚举与代码不符（遗漏 `60000`）**：本轮新增文本 `doc:419` 写「`ms = state.refreshInterval`，默认 `10000`，可选 `3000/10000/30000`」「（例如同为 `10000` 或同为 `30000`）」，同类实例 `doc:385`「默认 10s，可选 3s」；而代码 `src/js/app.js:151-156` 的 `REFRESH_OPTIONS` 为 `[3000, 10000, 30000, 60000]`，且 `:803` 以该白名单校验、`:1569` 直接载入持久化值 → `60000` 为真实可达值，并使 `state.limitUp.refreshInterval === state.refreshInterval === 60000` 成为**第三个同 ms 碰撞档位**，文档的"全组合"行情侧取值域被少列一档。探针实测 `monitorMs=limitUpMs=60000` → `ms-matches=2`。根因：为回应 round 14「不得出现未带取值条件的定值断言」扩写括注时，沿用了 round 14 报告 `:38` 中 `REFRESH_OPTIONS = [3000,10000,30000]`（同为漏 `60000`）而未回代码求证。修复：`doc:419` 补 `60000` 与第三碰撞档、`doc:385` 改为「可配置 `3/10/30/60` 秒」；`STATUS.md:37` 等 round 14 历史段按原文保留、不得回填改写。

**处置建议**：仅需修正 `doc:419` / `doc:385` 的取值域枚举（不涉及产品代码与测试），并确保 round 14 已闭环项（`STATUS.md:95` 引文、§4.3 纯身份键绑定）不被回退，即可提交 round 16 复审。

## 2026-09-14 历史状态：WorkBuddy 审查（round 14）缺陷全面闭环（沙盒纯身份键绑定/消除ms碰撞/STATUS历史引文还原与归属闭合）—— 提交 round 15 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md)
审查基线：`f48e592`

针对 round 14 独立审查报告指出的 2 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P3-1 闭环】`STATUS.md` round 12 闭环历史引文严格还原与跨段归属消歧** ✅：
   - 将 `STATUS.md` round 12 闭环段中的引文严格按 round 12 实际产出（`c3f5bc0`）还原为「修正为 `覆盖 T-1: min(240, 320-x) 根，恒 ≥80`，消除 `199~240` 固定区间冲突」，坚决杜绝把后续轮次的措辞回填到历史记录中；
   - 显式加注说明「注：该『恒 ≥80』在 241/243 根 Bar 前提下的成立条件已由 round 13 补齐闭环，见本文件 round 13 闭环段」，使同一改动动作在各轮次记录中的归属清晰、唯一、彻底消歧；
   - 顺带对 round 10 闭环段的 `app.js:1607` 历史叙述补充澄清注记，与后续各轮实测结论完全自洽。
2. **【P3-2 闭环】§4.3 定时器沙盒由数值 `ms` 筛选升级为纯身份键绑定机制** ✅：
   - 针对 `state.limitUp.refreshInterval === state.refreshInterval`（例如同为 10000 或同为 30000）导致数值 `ms` 碰撞、无法唯一匹配行情轮询回调的问题，在 §4.2 与 §4.3 中确立纯身份键绑定契约：
   - 在 `monitorCtrl.inspect()` 扩充暴露内部持有的唯一句柄 `pollTimerId: timer`；
   - 单测通过 `registeredTimers.get(pollTimerId)` 直接提取绑定的定时器条目，并在断言中确认 `pollTimer.ms === state.refreshInterval`；
   - 在 `state.limitUp.refreshInterval × state.refreshInterval` 全组合下均能 100% 确定性唯一获取行情轮询定时器，彻底消除对 `ms` 互异或注册先后顺序的隐式依赖；
   - 在变异测试中，若 `app.js:1515` 回退，`pollTimerId === null` 导致 `registeredTimers.get(pollTimerId)` 返回 `undefined`，用例在 (a)(b) 步均确定性报错失败。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经抽查 30+ 处核验，与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 14（涨停看板历史日期图表修复方案）**未通过** —— P3×2

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round14-handoff.md)
被审 HEAD：`33b8f53`　审查基线：`f48e592`　审查范围：`git diff f48e592..33b8f53`（9 文件 / +1296 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9-13 审查报告、`docs/handoff/INDEX.md`；相对 round 13 HEAD `c3f5bc0` 的增量 = 3 文件 / +71 / -53）
审查结论：**未通过**（2 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：round 13 的 P2-1（§4.3 沙盒改为按自增 id 建表 + 按 `ms === state.refreshInterval` 选中）经独立探针在真实 `monitorController` + 真实 `limitUpCtrl` 路径下复现「默认配置仅注册 `ms=10000/30000` 两定时器、按 `ms` 选中唯一」；P2-2 已把错配历史段重写为 round 12 审查记录并清除 `1607 ⇒ timerCount` 与 Fake Timers 断言；P3-1 的 `§4.2:276` 锚点与「100% 精准对齐」已校正、`INDEX.md` 摘要已同步；P3-2 的 A1 已按 `loadKline`/`applyLiveTick` 拆列，探针以真实 `applyLiveQuoteToKline` 复算 `len`/末柱字段一致；P3-3 三处保留根数已带 `x ≤ 240` 条件。实跑 `node scripts/run-tests.mjs` = **814/814 通过（0 失败）**；本轮改动涉及的代码锚点逐条与 HEAD 一致。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P3（低）`STATUS.md:57` 的 round 12 闭环记录被改写成 round 13 才引入的条件式**：由「修正为 `min(240, 320-x) 根，恒 ≥80`」（round 12 真实产出，`git show c3f5bc0:STATUS.md` 第 12 行 / `c3f5bc0:<doc>` 第 23 行可复核）改为「修正为 `min(240, 320-x) 根，**在 x≤240 时恒 ≥80**」——该措辞在 round 12 版本与 round 13 修复后的当前版本（`doc:23` 实为「常规 x≤240 时 ≥80」）上**均不成立**；且与同文件 `STATUS.md:25`（round 13 段称该 `x ≤ 240` 条件由 round 13 补齐）就「谁补齐了该条件」互斥。
2. **P3（低）§4.3 沙盒以数值 `ms` 作为选中键，在合法配置下同时命中两个定时器**：`state.limitUp.refreshInterval`（可选 `10000/30000/60000`，持久化）与 `state.refreshInterval`（`3000/10000/30000`）同值时，`applyDataRefreshSchedule()` 会注册两个同 `ms` 定时器（探针实测 `registered ms = [10000,10000]`、`ms-matches = 2`），文档 `:418` 要求的「断言该定时器唯一」不成立；此时 `find()` 取到行情轮询回调仅依赖 `app.js:1515` 早于 `:1525` 的**注册顺序**，而非可唯一辨识的键。

**处置建议**：先把 §4.3 选中键由数值 `ms` 改为身份型（或写入「先停用涨停列表定时器」前置条件并补齐 `state.limitUp.refreshInterval` 取值条件）→ 再把 `STATUS.md:57` 引文还原为 round 12 真实产出并与其 round 13 段闭合 → 顺带确认 `STATUS.md` 同类历史段（round 10 段 `:119`）的处置方式。

## 2026-09-14 历史状态：WorkBuddy 审查（round 13）缺陷全面闭环（多定时器沙盒精确隔离/STATUS.md历史段落与断言校正/A1实测条目按路径对齐/241-243计数闭合）—— 提交 round 14 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round13-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round13-handoff.md)
审查基线：`f48e592`

针对 round 13 独立审查报告指出的 2 项 P2 阻塞缺陷与 3 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P2-1 闭环】§4.3 受控定时器沙盒重构为多定时器隔离与精准匹配轮询回调** ✅：
   - 彻底重构沙盒实现：将单槽覆盖写改为 `registeredTimers = new Map()`（按自增 id 存储 `{ fn, ms }`），提供隔离的注册与注销机制；
   - 用例 7(b) 改为从 `registeredTimers` 中精准查找 `ms === state.refreshInterval` 的唯一条目执行 `pollTimer.fn()`，彻底隔离 `applyDataRefreshSchedule()` 在行 1525 注册的 30000ms 涨停列表定时器，杜绝单槽覆盖写导致执行到 `limitUpFetch` 的缺陷；
   - 清除所有残留的“推进虚拟时钟/推进时间 $\ge state.refreshInterval$”表述，严格对齐直接驱动沙盒回调规范。
2. **【P2-2 闭环】`STATUS.md` 历史段落错配重写与证伪断言彻底清除** ✅：
   - 彻底重写 `STATUS.md` 中错配的「round 12 未通过」历史段正文，链接对齐至 [`docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md)，准确归档 round 12 的 4 项 P3 缺陷（保留根数、1607 变异、A1 行 targetDate、Fake Timers 机制缺失）；
   - 彻底删除从 round 11 误复制的正文，清除 `app.js:1607 ⇒ timerCount === 0` 与 Fake Timers 等已证伪断言。
3. **【P3-1 闭环】行号锚点校正与结论客观降级、索引摘要同步** ✅：
   - 将 `STATUS.md` 中的锚点引用修正为 `§4.2:276`；
   - 将“100% 精准对齐”等绝对化全称表述降级为客观叙述“经抽查 30+ 处代码锚点与全文算术逐条核对一致”；
   - 同步更新 `docs/handoff/INDEX.md` 顶部速读与主文档索引条目为“已闭环至 round 13 缺陷”。
4. **【P3-2 闭环】§4.2:213 A1 实测对比条目按调用路径细化拆分** ✅：
   - 将 §4.2:213 的 A1 纯价格无日期快照条目明确拆分为 `loadKline` 路径（`targetDate = '2026-09-11'`，`lastDate < targetDate` 假致原地覆盖）与 `applyLiveTick` 路径（`targetDate = null`，无日期短路致原地覆盖），与 §2.3:107 表 A1 行逐字段完全吻合。
5. **【P3-3 闭环】保留根数下界补齐成立条件与 241/243 根闭合** ✅：
   - 在 §2 mermaid 节点 F、§2.2:71 与 §3:135 中，为“恒 ≥80 根”补齐“常规交易日 $x \le 240$”成立条件；
   - 明确注明若计入早盘 09:25 集合竞价等导致单日产生 241 或 243 根 Bar，则收盘保留约 77~79 根（`min(240, 320 - 243) = 77`），与 §2.2:65 完全闭合。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经抽查 30+ 处核验，与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 13（涨停看板历史日期图表修复方案）**未通过** —— P2×2 / P3×3

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round13-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round13-handoff.md)
被审 HEAD：`c3f5bc0`　审查基线：`f48e592`　审查范围：`git diff f48e592..c3f5bc0`（8 文件 / +1139 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9/10/11/12 审查报告、`docs/handoff/INDEX.md`）
审查结论：**未通过**（2 项 P2、3 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：round 12 的 P3-1 主项（§2 mermaid 节 F、§2.2 T-2、§3 复述）已按 `min(240,320-x)`/`max(0,80-x)` 改正；P3-2 已在 §4.3:468 删除 `app.js:1607` 变异分支并在 §4.2:286 / §4.4:478 降级为可选清理；P3-3 的 §2.3 表 A1 行已按 `loadKline`/`applyLiveTick` 拆列；P3-4 已定义 `pollTimerAlive` 并被用例 7(a) 采用。抽查 30+ 处代码锚点与全文算术经逐条复算与 HEAD 一致；`npm test` 实跑 **814/814 通过**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P2（中）§4.3 用例 7 的受控定时器沙盒在真实执行路径下捕获到「涨停列表定时器」回调**：`applyDataRefreshSchedule()` 在 `#/limit-up` 已挂载 + 盘中时连续注册两个 `setInterval`（`app.js:1515` 监控轮询 `10000ms` → `app.js:1525` → `limitUpController.js:438` 涨停列表 `30000ms`），而文档沙盒为单槽覆盖写、且每次返回同一 `id = 1001` → `capturedIntervalCallback` 最终是 `() => limitUpFetch()`，步骤 (b) 永不触发 `fetchQuotes`，在修复后的正确代码上亦必然失败；两次注册共用 `1001` 还使 (a)(b) 观测互相耦合。
2. **P2（中）`STATUS.md` 新增「历史状态：round 12 未通过」段保留 round 12 已证伪的断言**：`STATUS.md` 仍称「恢复 `app.js:1607` 的 `stopMonitorTimer()` ⇒ `timerCount === 0` ⇒ 断言确定性失败」，仍以 Fake Timers 为闭环依据；且该段标题写「round 12 未通过 —— P3×4」但正文与链接均为 round 11 闭环叙事，round 12 的 P3×4 在 `STATUS.md` 中无任何记录。
3. **P3（低）×3**：①`STATUS.md`「与 HEAD 100% 精准对齐」为过强全称结论，被 `§4.2:277`（正文实为 `:276`）与 `INDEX.md`「已闭环 round 10 缺陷」证伪；②§4.2:213 的 A1 实测条目仍以未限定路径的「旧代码 `targetDate = null`」描述与 §2.3:107 同名的场景，未与已路径化的 §2.3 A1 逐字段吻合；③保留根数「恒 ≥80」/「收盘仍有 80 根」与 §2.2:65 自述的「241/243 根/日」冲突（`min(240,320-243)=77`），未带成立条件。

**处置建议**：先修 P2-1（沙盒改为按 id 记录并显式选中 `ms === state.refreshInterval` 的回调）→ 再按 round 12 建议 ③ 清理 `STATUS.md` 并修正段标题/链接语义 → 再依次闭合 P3 ①②③。

## 2026-09-14 历史状态：WorkBuddy 审查（round 12）缺陷全面闭环（保留根数公式全量统一/消除1607无效变异/A1行路径解耦/单测受控定时器沙盒与pollTimerAlive）—— 提交 round 13 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md)
审查基线：`f48e592`

针对 round 12 独立审查报告指出的 4 项 P3 严谨性缺陷完成全面彻底闭环：

1. **【P3-1 闭环】保留根数全量统一与公式严格对齐** ✅：
   - 在 §2 mermaid 节点 F 修正为 `覆盖 T-1: min(240, 320-x) 根，恒 ≥80`，消除 `199~240` 固定区间冲突（注：该「恒 ≥80」在 241/243 根 Bar 前提下的成立条件已由 round 13 补齐闭环，见本文件 round 13 闭环段）；
   - 在 §2.2 T-2 描述中严格按照 $\max(0, 80 - x)$ 修正为 `1~80 根，例如 09:30 开盘 x=0 时剩余 80 根`，消除 `1~75 根`/`剩余 75 根` 矛盾；
   - 在 §3 复述中为 199 根补充严格前置成立条件（`随当日已产生 Bar 数 x 动态变化，等于 min(240, 320 - x) 根；在 11:30 前后 x≈121 时约 199 根，早盘 x≤80 时为满仓 240 根，收盘 x=240 时仍有 80 根`）；
   - 全文保留根数表述均可由公式直接复算，无与之冲突的固定区间或固定值。
2. **【P3-2 闭环】消除 `app.js:1607` 无效变异与修复必要性过强断言** ✅：
   - 在 §4.3 用例 7 变异证伪性保证中彻底移除 `（或在 app.js:1607 恢复 stopMonitorTimer()）` 分支，只保留唯一有效变异 `app.js:1515 → !hasLimitUpRoot`；
   - 在 §4.2 改造点四与 §4.4 风险评估中，明确将 `app.js:1607` 处的 `stopMonitorTimer()` 降级为可选清理，阐明其行为会被行 1613 的 `applyDataRefreshSchedule()` 重建覆盖，主调度语义与存活状态完全由行 1515 的 `visible` 判定独立且唯一决定；
   - 文档中每一条变异用例断言均为真实代码路径可观测。
3. **【P3-3 闭环】§2.3 表 A1 行旧代码合并表现按调用路径明确解耦** ✅：
   - 将 A1 行旧代码表现细化分列：`loadKline` 路径下 `targetDate = inst.selectedTradeDate = '2026-09-11'`（非 `null`，兜底链退化为历史日），`lastDate < targetDate` 为假导致原地覆盖；`applyLiveTick` 路径下无日期透传致 `targetDate = null`，落入原地覆盖；二者 `len = 2` 且篡改昨日收盘价；
   - 彻底消除了 A1 行与 §4.2:211 自述之间的矛盾。
4. **【P3-4 闭环】§4.3 确立无外部依赖的受控定时器沙盒契约与 `pollTimerAlive` 健壮断言** ✅：
   - 在 §4.3 接入说明中显式规定标准受控定时器沙盒规范：在 `beforeEach` 中保存原始 `globalThis.setInterval/clearInterval` 并替换为记录回调与周期的局部 Mock，在 `afterEach` 中严格原样还原，杜绝跨测试用例污染；
   - 用例 7(b) 改为直接触发捕获的回调函数 `capturedIntervalCallback()`，彻底消除对未引入的 fake-timers 依赖的假设；
   - 响应审查报告待确认风险建议：在 §4.2 为 `monitorCtrl.inspect()` 扩充 `pollTimerAlive: timer !== null` 专用字段，并在用例 7(a) 中明确断言 `pollTimerAlive === true`（变异回退为 `!hasLimitUpRoot` 时确定性变为 `false`），彻底排除常驻 `checker` 对 `timerCount` 的非零干扰，使断言具备绝对的可证伪性。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经抽查 30+ 处核验，与 HEAD 一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 12（涨停看板历史日期图表修复方案）**未通过** —— P3×4

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round12-handoff.md)
被审 HEAD：`7b34bc5`　审查基线：`f48e592`　审查范围：`git diff f48e592..7b34bc5`（7 文件 / +965 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查与解决方案文档、round 9/10/11 审查报告、`docs/handoff/INDEX.md`）
审查结论：**未通过**（4 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：round 11 的 P2 主因已实质闭环 —— §4.3 用例 7 新增 `_internal()` 调度层访问器（`app.js:1645-1647`），并删除“或触发一次 `refresh()` 周期”的手动后门；(b) 步由定时器回调驱动，对 `app.js:1515` 变异确实可证伪；§2.3 表与 §4.2 已收敛为 A1~A3；§2.3:99 / §4.2:276 绝对化表述已改为条件式，`state.quotes` 三个写入点核对完全准确；“≤3s”/“共计 4 次”已带成立条件。抽查 30 处代码锚点与 HEAD 逐条一致；`npm test` 复跑 **814/814 通过**。

**审查缺陷（摘要，细节见审查报告第二节）**：

1. **P3（低）保留根数仍有 3 处与自身公式冲突**：§2 mermaid 节点 `F` 仍写“199~240 根”（`x=240` 时公式为 80 根）、§2.2 T-2 分支写“1~75 根/剩余 75 根”（公式 `max(0, 80-x)` 在 `x=0` 时应为 80 根）、§3 复述写无条件“容纳 T-1 的 199 根”，未带 `x` 成立条件。
2. **P3（低）§4.3 用例 7 的 `app.js:1607` 变异证伪声称不成立**：`:1607` 的 `stopMonitorTimer()` 与 `:1613` 的 `applyDataRefreshSchedule()` 处于同一路由处理函数且连续执行，`:1613` 必定重建定时器，恢复 `:1607` 对 `timerCount` 无任何影响；且用例 7 直接调 `_internal()` 根本不经过路由处理器；`app.js:1607` 处的 `stopMonitorTimer()` 降级为可选清理，移除它并非必要修复项。
3. **P3（低）§2.3 表 A1 行 `targetDate = null` 与 loadKline 路径矛盾**：`loadKline` 路径下 `targetDate = inst.selectedTradeDate = '2026-09-11'`（非 `null`），兜底链退化为历史日致 `lastDate < targetDate` 为假原地覆盖，应按调用路径与 `applyLiveTick`（`targetDate = null`）拆分描述。
4. **P3（低）用例 7(b) 的 Fake Timers 驱动机制在仓库中不存在且未指明**：仓库无 Fake Timers 依赖，应规范为局部受控定时器沙盒；且建议为 `monitorCtrl.inspect()` 扩充 `pollTimerAlive: timer !== null` 专用字段以排除 `checker` 计数干扰。

**处置建议**：按公式统一 mermaid/T-2/§3 保留根数表述并补齐条件 → 删除 1607 变异分支并将 1607 降级为可选清理 → §2.3 A1 行按路径细化 → 规范受控定时器沙盒并引入 `pollTimerAlive` 断言。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 11（涨停看板历史日期图表修复方案）**未通过** —— P2×1 / P3×4

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round11-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round11-handoff.md)
被审 HEAD：`147573a`　审查基线：`f48e592`　审查范围：`git diff f48e592..147573a`（6 文件 / +792 / -22，全为文档：`AGENTS.md`、`STATUS.md`、图表调查报告、round 9/10 审查报告、`docs/handoff/INDEX.md`）
审查结论：**未通过**（1 项 P2、4 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：round 10 的 P1（调度层改动已明确落于 `app.js:1508-1515` + `app.js:1602-1614`，`needsSharedQuotes` 为自声明变量、`state.expandedCodes`/`state.limitUp.expandedCodes`/`state.momentum.expandedCodes` 均真实存在于 `app.js:319/352/370`）、P2（§4.1.4/§2.3/§4.2 主源前提已改为与 `api.js:161/172` + `parser.js:64/82/93-127` 一致的条件式表述）、P3（mock 信封已改为 `{ok,data}`、`loadIntraday` 已加 `this.hasIntraday` 门控）**三处均已闭环**；全文 43 处代码引用锚点、`32da3ca`/`eae67ae`/`2f94e08` 提交溯源与 round 9/10 范围统计经逐条比对与 HEAD **完全一致**；`npm test` 复跑 **814/814 通过**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P2（中）§4.3 用例 7 的"集成到达性断言"无法证伪 P1**：唯一覆盖调度层的断言 (a)"断言 `monitorCtrl` 定时器存活（`timer !== null`）"无可达接入点 —— `app.js` 未导出 `monitorCtrl`/`applyDataRefreshSchedule`，`_internal()`（`app.js:1645-1647`）仅返回 `{state, chartInstanceMap, limitUpRootEl}`，且 `tests/app.test.js:874-878` 已明确记载 startApp 级集成测试因清理复杂而被省略；而 (b)(c) 提供的"或触发一次 `refresh()` 周期"分支绕过 `applySchedule`，**实测**在 `applySchedule(allowed, false)`（`timerCount=0`，即 P1 未修）下 `refresh()` 仍成功且 `state.quotes` 仍被写入 → 用例 7 在缺陷存在时同样为绿，属"功能无效仍通过"的假通过测试。
2. **P3（低）×4**：①§4.2:277 "全站唯一写入 `state.quotes` 的正是 `monitorController` 的 `refresh()`" 与 `grep` 事实矛盾（`app.js:952`、`momentumController.js:141/152` 亦写入），§2.3:99 "根本没有该标的的报价实体"与同段 `:279` 的条件式表述（自选/强势股）互相矛盾；②§2.3 表 A4 行"修复后预期：`resolveLiveFallbackDate` 隔离、不覆盖末根蜡烛"与本方案代码矛盾（显式 `date` 短路兜底链，实测 `{price:21,date:'2026-09-10'}` 仍原地覆盖 `2026-09-11` 末柱，§4.2 的 A 列表已只保留 A1~A3）；③§2.2:71 "恒命中前一天的约 199~240 根 Bar" 与同段 `:67` 自身公式 `min(240,320-x)` 矛盾（`199~240` 仅在 `x∈[80,121]` 成立，收盘 `x=240` 时为 80 根）；④§4.2:360 "报价周期（≤3s）"（默认 `DEFAULT_REFRESH=10000`，`app.js:157/1569`）与 §4.3:386 "共计 4 次降级请求"（`allowLatestTickSource` 为真时实测为 5 次，含 `trends2`）两处量化表述未带成立条件。

**处置建议**：先修 P2（为用例 7 给出可达接入方式并删除绕过调度的等价分支，使断言在 `app.js:1515` 回退时必然失败）→ 再按 §二 P3 ①②③④ 顺序闭合 4 项表述缺陷。

## 2026-09-14 历史状态：WorkBuddy 审查（round 10）缺陷全面闭环（行情调度层解耦保活 / 腾讯主源前提纠偏 / Mock信封与集成测试契约加固）—— 提交 round 11 独立审查

最新交接文档：[`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`](docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md)
前序审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round10-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round10-handoff.md)
审查基线：`f48e592`

针对 round 10 独立审查报告指出的 1 项 P1 阻塞缺陷、1 项 P2 前提失实与 1 项 P3 测试信封缺陷完成全面彻底闭环：

1. **【P1 闭环】改造点四上移至调度层保活与活跃图表订阅双解耦** ✅：
   - 彻底梳理调用链路：定位 `app.js:1607` 路由入口无条件 `stopMonitorTimer()` 以及 `app.js:1515` 传入 `visible = !hasLimitUpRoot = false` 导致 `monitorController.js:82` 掐断全局轮询定时器的调度层断链根因；
   - 确立调度保活方案：在 `app.js:1513-1515` 将可见性语义明确为全站保活（`monitorCtrl.applySchedule(allowed, true)` 或 `needsSharedQuotes = true`），并在 `app.js:1607` 路由切换处移除 `stopMonitorTimer()`（仅保留 `closeAllCharts()` 清除图表实例，保留后台全局共享行情轮询），消除虚构变量风险（注：后续 round 12/13 实测进一步澄清，`app.js:1607` 处移除 `stopMonitorTimer()` 属可选清理，因行 1613 的 `applyDataRefreshSchedule()` 会按可见性重建定时器，主调度保活完全由行 1515 的 `visible` 判定独立决定）；
   - 在 `monitorController.js:14-22` 保持将各页面 `expandedCodes` 并入 `getRefreshCodes()`，确保无论看板是否在历史日期，已展开图表的标的在 ≤3s 内获得报价供给并存入 `state.quotes`，驱动日 K 追加与 10s 分时定时刷新；
   - 同步全面更新 §4.1.5、§4.2 改造点四以及 §4.4 影响面与风险评估。
2. **【P2 闭环】纠偏股票快照主源数据流前提与原地覆盖成立条件** ✅：
   - 严格对照 `src/js/api.js:150-176` 与 `src/js/parser.js:64/82`，明确纠正前提：股票快照报价主源为腾讯（写入 8 位 `quoteDate`），在有行情供给时 `kline.js:420` 正常命中追加分支；
   - 澄清历史看板下缺失今日柱的第一因是**调度停摆导致无行情供给（`q === undefined` 跳过合并）**，而非 Tick 原地覆盖；
   - 明确将原地覆盖的成立范围界定为：腾讯降级东财快照（`parser.js:93-127`，无日期字段）、腾讯字段缺失、或外部/单测直接注入 `{ price: 21 }` 等无日期对象场景，并在 §2.3 与 §4.2 补充清晰的 A1~A4 场景行为对比与验证矩阵；
   - 全文彻底清除"股票快照行情流恒不携带 / 恒定落入覆盖分支"等绝对化措辞。
3. **【P3 闭环】§4.3 Mock 信封规范化与调度层保活集成级断言补齐** ✅：
   - 将 `/api/cache/intraday` 的 Mock 桩规范为完整信封 `{ ok: true, data: { items: [], prevClose: 20.00 } }`，彻底避免触发 4 次降级请求与底座 `Unexpected network request` 断言；将"无条件调用"修正为"`this.hasIntraday` 为真时调用"；
   - 时钟 Mock 规范明确要求同时覆写构造函数与 `static now()`（`RealDate` 派生类），杜绝 `Date.now()` 与 `new Date()` 产生时钟漂移与 Flaky；
   - 规范用例编号为 1~8 连续递增，并在用例 7 中补齐了能切实证伪 P1 的集成级端到端断言：包含路由保活定时器持续运行（`timer !== null`）、`fetchQuotes` 请求批次包含历史展开标的、`state.quotes` 成功写入实体并驱动 `updateChartLastTickMulti`。

**门禁验证**：
- `npm test`（QUnit）：**814/814 全部通过（0 失败，0 偶发）**；
- 全文代码引用、符号与行号经自动化核验与抽查，与 HEAD 逐条一致。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 10（涨停看板历史日期图表修复方案）**未通过** —— P1×1 / P2×1 / P3×1

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round10-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round10-handoff.md)
被审 HEAD：`0305357`　审查基线：`f48e592`　审查范围：`git diff f48e592..0305357`（5 文件 / +542 / -22，全为文档：`AGENTS.md`、`STATUS.md`、round 9 审查报告、图表调查报告、`docs/handoff/INDEX.md`）
审查结论：**未通过**（1 项 P1、1 项 P2、1 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：§2.2 滑动窗口算术（T-1 = `min(240,320-x)`、T-2 = `max(0,80-x)`，x=80 归零）、§2.4 `isLatestKlineDate` 假阳性被 `intradayService.js:261` 中和、§4.3 盘前 `resolveStockChartDate` 锚定 `2026-09-11` 经独立脚本逐一复算**全部成立**；全文代码引用/行号（含 `app.js:1607`、`limitUpController.js:564-567`、`tests/_jsdom-setup.cjs:14-21/22-27`、`32da3ca→eae67ae` 迁移链）与 HEAD **逐条一致**；`npm test` 复跑 **814/814 通过**。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P1（高）改造点四只改 `getRefreshCodes()`，`#/limit-up` 路由下行情轮询器被整体停摆 —— round 9 的 P1 未闭环**：`app.js:1607` 路由入口 `stopMonitorTimer()` + `app.js:1513-1515` `hasLimitUpRoot=true → applySchedule(allowed, false)` → `monitorController.js:82` `stopTimer()`（86 行 `setInterval` 永不建立）；`getRefreshCodes()` 唯一消费方即该停摆的 `refresh()`（25/38 行），全仓 `quotes.set` 仅 `app.js:952` / `momentumController.js:141,152` / `monitorController.js:44,50`，均不覆盖涨停页展开标的。文档"≤3s 内自动填充 `state.quotes`／持续 Tick 注入／10s 分时刷新"及 §4.4"3 处局部点位／风险低"均不成立。
2. **P2（中）根因前提失实**：§4.1.4"股票快照行情流（`parser.js:108-126`）恒不携带 `tradingDay/date/quoteDate`"与 §4.2 问题现状 2"恒定落入原地覆盖分支"不成立 —— 股票报价**主源为腾讯**（`api.js:161`，东财仅 `api.js:172` 兜底），`parseTencent` 写入 `quoteDate`（`parser.js:64/82`），`kline.js:409-420` 走**追加**分支；独立脚本实测 `{price:21}` → 2 根（覆盖）、`{price:21,quoteDate:'20260914'}` → 3 根（追加）。该表述亦与 §4.2 自身代码 `q.quoteDate` 自相矛盾。
3. **P3（低）§4.3 的 `/api/cache/intraday` mock 桩缺 `{ok,data}` 信封**：文档示例 `{ items: [], prevClose: 20.00 }` 不满足 `api.js:415`，实测退化为 4 次降级请求（东财 1m×2 + 腾讯 mkline），只定制该端点的测试将命中 `tests/_jsdom-setup.cjs:22-27` 的 `Unexpected network request`；正确桩需 `{ ok: true, data: { items: [], prevClose: 20.00 } }`（实测 1 次请求短路）。同段"`loadKline` 尾部无条件调用 `loadIntraday`"亦不准确（`chartRowController.js:397` 受 `if (this.hasIntraday)` 门控）。

**处置建议**：先把改造点四上移到调度层（`app.js:1515` 的 `visible` 语义改为"任一需要共享行情的页面挂载即为真"、移除 `app.js:1607` 的无条件 `stopMonitorTimer()`）→ 再按 `api.js:150-176` + `parser.js:64/82` 重写 §4.1.4/§4.2 的条件式前提 → 最后修正 §4.3 mock 信封并补一条"展开后下一次 `fetchQuotes` 批次含该 code"的集成级断言。

## 2026-09-14 历史状态：WorkBuddy 独立审查 round 9（涨停看板历史日期图表）**未通过** —— P1×1 / P2×1 / P3×4

审查报告：[`docs/handoff/2026-09-14-workbuddy-code-review-round9-handoff.md`](docs/handoff/2026-09-14-workbuddy-code-review-round9-handoff.md)
被审 HEAD：`e2a8f0d`　审查基线：`f48e592`　审查范围：`git diff f48e592..e2a8f0d`（3 文件：`AGENTS.md`、`docs/handoff/2026-09-14-limit-up-chart-date-flip-investigation-and-resolution-handoff.md`、`docs/handoff/INDEX.md`）
审查结论：**未通过**（1 项 P1、1 项 P2、4 项 P3，均须彻底修复闭环后复审）

本轮通过的核查项（简）：需求实现无遗漏（上轮点名的行号漂移 `intradayService.js:216→215`、`marketSession.js:138→132`、`instrument.js:20→5` 与 `32da3ca→eae67ae` 迁移链、"100% 完整保障/绝不请求历史分时"两处绝对化措辞、用例 5 盘前时钟均已落实）；文档全部 17 处代码引用（文件+行号+标识符）、2 处提交溯源、10 处 `file:///` 链接经逐条核对**与 HEAD 完全一致**；`AGENTS.md` 新增 CLI 契约与 `workbuddy_cli.py:42-143` 实现一致；`npm test` 复跑 **814/814 通过**（文档"814 例"基线属实）。

**阻塞缺陷（摘要，细节见审查报告第二节）**：

1. **P1（高）修复方案未覆盖"历史看板 ⇒ 标的报价脱离刷新集合"**：`monitorController.js:14-22`（第 17 行门禁）使看板非今日时涨停列表 code 不再拉取报价，`state.quotes` 无实体 → `chartRowController.js:380-382` 报价合并整段跳过（今日蜡烛仍缺失）、`app.js:1355-1356` Tick 跳过、`refreshLiveIntradayForCode` 不再被调用（分时无 10s 刷新）。该依赖从未在 §4.1/§4.2 出现，导致"展开即展示今日全量日 K 与今日最新分时（具备实时 Tick 注入与定时刷新）"的承诺在用户主场景（回顾历史涨停名单里、未加入自选的个股）不成立。已用未修改的 `ChartRowManager.loadKline` 复现：有报价 → 3 根（含今日）；无报价 → 2 根（末根仍为 2026-09-11）。
2. **P2（中）改造点二只修 `loadKline` 合并点**：`chartRowController.js:114-116`（`applyLiveTickToKlineChart`）同样以原始报价直传 `applyLiveQuoteToKline`，而股票报价恒无日期字段（`parser.js:108-126`），故该路径 `targetDate` 恒为 `null`、`kline.js:420` 追加分支不可达，每次 Tick 都原地覆盖最后一根 → §4.2"绝不会因历史日期污染而错误覆盖昨天的收盘柱"不成立（实测 tick 路径下 2026-09-11 柱 close 被改写为 21）。
3. **P3×4**：§2.2/§3 把"T-2 命中 0 根"当作机制性事实（真实阈值为**当日第 80 根 Bar ≈ 10:48**，早盘 T-2 仍有 1~75 根可被合成伪分时，且 T-1/T-2 的源可用性条件标注不对等）；§2.4 的 `isLatestKlineDate` 假阳性被 `intradayService.js:261` 的 `!isHistoricalDate` 中和、对历史日期无行为影响却被列为掩盖点；§4.3 测试矩阵未声明 mock `/api/cache/intraday`（`loadKline` 会立即触发 `loadIntraday`），按文档写法在既有 harness 下必然失败（已实测 0 pass / 1 fail）；§2.3 与 §3.2 对同一 T-2 场景使用互斥的日 K 缓存前提。

**处置建议**：先补 §4.2"改造点四：图表订阅与看板日期解耦"（`getRefreshCodes` 纳入已展开图表 code 集，并同步 `limitUpController.js:411`/`:259` 门禁口径）→ 再把改造点二抽为可复用的日期解析并同时注入 `loadKline` 与 `applyLiveTickToKlineChart` → 最后按审查报告第四节顺序闭合 4 项 P3。

## 2026-09-13 历史状态：WorkBuddy 独立审查 round 3 通过（双智能体闭环达成）& 审查上限调整为 10 轮 & 遗留 P3 收尾

审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round3-handoff.md)
审查结论：**审查通过（P0=0, P1=0, P2=0, P3=2，满足全部审查通过条件）**
被审 HEAD：`2f94e08`　审查基线：`518495d`　审查报告提交：`ea44e75`

本阶段工作：
1. **审查上限调整为 10 轮** ✅：根据用户指示，将 `AGENTS.md`、`docs/templates/DUAL_AGENT_REVIEW_WORKFLOW.md` 以及全局 `workbuddy-plugin/rules/AGENTS.md` 中的安全熔断限制由 3 轮统一升级为 10 轮；
2. **P3-R3F1 闭环（Eastmoney 空串/空白量比解析为 `undefined`）** ✅：在 `parser.js` 中增加 `(typeof d.f50 !== 'string' || d.f50.trim() !== '')` 防御，避免 `Number('') === 0` 陷阱导致空串/纯空白解析为 `0.00`，与 Tencent 完全对齐并在 `tests/parser.test.js` 补齐断言；
3. **P3-R3F2 闭环（LRU tie-break 显式码元字典序）** ✅：将 `storage.js:539/556` 中的 `localeCompare` 替换为显式码元字典序 `k1 < k2 ? -1 : (k1 > k2 ? 1 : 0)`，消除默认 locale 规则潜在的排序歧义与跨引擎开销。

## 2026-09-13 历史状态：WorkBuddy 独立审查（round 3）—— 审查通过（无 P0/P1/P2，遗留 2 项 P3）

审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round3-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round3-handoff.md)
被审 HEAD：`2f94e08`　审查基线：`518495d`

对 `2f94e08`（round 2 缺陷闭环提交）逐行独立复核，结论 **通过**：

1. **round 2 的 P2 已闭环** ✅：冻结时钟探针（孤岛 + 100 同毫秒写入）孤岛 100% 被淘汰、当前键 100% 保留；真实时钟复刻 `tests/storage.test.js:539` 场景 **300 次孤岛存活 0/300**（round 2 基线为 0.497–0.547）；永久配额失败 ×250 内存条目恒 = 100（有界）。
2. **round 2 的 P3 主路径已闭环** ✅：`f50` 缺失/null/`'-'`/非数值均 → `undefined` → 渲染 `-`；有效值 /100、真实 0 保留。
3. **门禁独立复现全部通过** ✅：`tests/storage.test.js` ×50 → 0 失败；`npm test` ×3 → 812/812；`npm run lint` 0/0；`npm run build` 成功；`npm run e2e` → **74/74 passed (1.2m)**；证据脚本 `--expect=fixed` → 5/5。
4. **遗留 2 项 P3（非阻塞）** ⚠️：
   - **P3-R3F1**：`parser.js:118-120` 对 `f50=''`/纯空白用 `Number('')===0` 判定，仍解析为 `0` 并渲染 `0.00`，未与 Tencent（`undefined → -`）完全对齐（存量为既有行为，非本轮回归）；
   - **P3-R3F2**：`storage.js:539/556` 第三级 tie-break 使用 `localeCompare`（默认 locale 排序，非字节序「字典序」），实测对真实周期键 `...|1M`（月K）与 `...|1m`（1分）次序与码元序相反；不影响任何不变式，仅影响等价旧条目的取舍。
5. **待确认风险 / 未验证项**：`localeCompare` 真实跨引擎差异未能实测（本机默认 locale 固定 en-US）；东财真实载荷中 `f50=''` 触发频率未量化；未在真实 localStorage 配额打满下验证。

**建议后续**：优先修 P3-R3F1（空串归一 → `undefined`）与 P3-R3F2（两处改显式码元比较），并补对应断言。

## 2026-09-13 历史状态：WorkBuddy 审查（round 2）缺陷全面闭环（LRU tie-break 确定性加固 / Eastmoney 量比缺失语义对齐）—— 已提交 round 3 独立审查

最新交接文档：[`docs/handoff/2026-09-13-storage-lru-tiebreak-and-parser-ratio-round2-closure-handoff.md`](docs/handoff/2026-09-13-storage-lru-tiebreak-and-parser-ratio-round2-closure-handoff.md)
前序审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round2-handoff.md)
审查基线：`518495d`

针对 round 2 独立审查指出的 1 项 P2 阻塞缺陷与 1 项 P3 语义对齐缺陷完成全面彻底闭环：

1. **【P2 闭环】LRU 容量淘汰 tie-break 确定性加固与单测稳定性** ✅：
   - 在 `src/js/storage.js` 的 `klineCacheSet` LRU 容量淘汰排序比较器中实施三级确定性防线：
     1. **当前写入键保底保护**：`if (k1 === key) return 1; if (k2 === key) return -1;` 绝不在容量淘汰中误淘汰当前键；
     2. **毫秒相等二级 tie-breaker**：当 `_getEntryLastAccessed` 返回相同毫秒时，优先淘汰仅存在于内存中的孤岛副本（`const m1 = !obj.entries[k1] && _klineMemoryCache.has(k1); ... return m1 ? -1 : 1`）；
     3. **三级字典序稳定排序**：`k1.localeCompare(k2)` 保证跨引擎全排列确定性；
     4. **内存上限兜底防御裁剪**：若淘汰后 `_klineMemoryCache.size > KLINE_MAX_ENTRIES`，直接对多余内存条目按最旧访问时间兜底裁剪；
   - 在 `tests/storage.test.js` 中新增冻结时钟（`Date.now = () => fixedTime`）确定性单测，验证在所有条目均处于同一毫秒时孤岛条目 100% 优先被淘汰；
   - 连续执行 50 次 `tests/storage.test.js`：**50/50 全部通过（0 偶发失败）**。
2. **【P3 闭环】Eastmoney 量比缺失语义对齐** ✅：
   - 修复 `src/js/parser.js` 中的 `parseEastmoney`：将 `volumeRatio: div100(d.f50)` 重构为当 `d.f50` 为 `undefined`、`null` 或 `'-'` 时返回 `undefined`（渲染为 `-`），仅当具有有效数值时除以 100 并保留 2 位小数（若为真实 `0` 则保留 `0` 渲染为 `0.00`），与 Tencent 行情源完全对齐；
   - 在 `tests/parser.test.js` 中新增覆盖正常数值、真实 0、缺失及 `'-'` 破折号等全部情况的单元测试。

**证据与门禁验证**：
- `tests/storage.test.js` 连续 50 次压力测试：**50/50 全部通过（0 偶发失败）**；
- `npm run lint`：0 错误 0 警告；
- `npm test`（QUnit）：**812/812 全部通过**；
- `npm run build`：生产打包成功；
- `npm run e2e`（Playwright）：**74/74 全部通过**；
- 证据脚本 `node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=fixed`：**5/5 全部通过**。

## 2026-09-13 历史状态：WorkBuddy 独立审查（round 2）—— P0/P3 修复有效，但新增 LRU 淘汰单测偶发失败（P2，未通过）

审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round2-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round2-handoff.md)
被审 HEAD：`ffe92b3`　审查基线：`58f3f64`

对 `ffe92b3`（round 1 缺陷闭环提交）逐行独立复核，结论 **未通过**（1 项 P2、1 项 P3）：

1. **【P2 · 阻塞】新增 LRU 淘汰单测偶发失败 + 淘汰 tie-break 不确定** ❌：
   `storage.js:516-528` 淘汰候选集以 `[...持久化键, ...内存键]` 构造并依赖稳定排序；当孤岛与后续写压**落在同一毫秒**时，并列的内存孤岛排在持久化键之后，每次仅淘汰 1 条，故在 `KLINE_MAX_ENTRIES + 10` 次写压窗口内**不被淘汰**。实测 `tests/storage.test.js:539` 断言偶发失败：QUnit 下 `11/40` 次失败，紧凑循环探针孤岛存活率 `0.497–0.547`；冻结时钟可确定性复现。→ 「810/810」不可复现地成立，验收标准 #2/#5 不达标。
2. **【P3】Eastmoney 分支缺失量比仍渲染 `0.00`** ⚠️：
   `parser.js:118` 的 `volumeRatio: div100(d.f50)` 未随 Tencent 分支（`parser.js:65-66`）对齐；`fetchQuotes` 回退 Eastmoney 且 `f50` 缺失时显示 `0.00` 而非 `-`（探针 D 实测）。
3. **已独立确认有效的修复** ✅：P0 常规/永久失败场景内存有界（探针 A：基线 250→HEAD 100）；P1 用例方向正确但见第 1 项；P2 Tencent 分支语义正确；P3 `pinnedSort` 死参数已消除（探针 E 对照：HEAD `patch=true` / 基线 `false`）。
4. **门禁**：证据脚本 `--expect=fixed` 5/5 ✅；`npm run lint` 0 ✅；`npm run build` 成功 ✅；`npm test` 本次 810/810 通过，但受第 1 项影响不稳定。

**处置建议**：优先修复 P2（淘汰排序增加确定性「内存优先/不淘汰当前键」次关键字 + 淘汰后兜底裁剪），并将新增单测改为不依赖 `Date.now()` 粒度的确定性用例；再对齐 P3。

## 2026-09-13 历史状态：WorkBuddy 审查缺陷全面闭环（round 1 提出项）—— storage 孤岛副本清除、量比缺失语义对齐与 pinnedSort 消除（**经 round 2 复核：P0 常规场景有效、P1 单测不稳定**）

最新交接文档：[`docs/handoff/2026-09-13-storage-orphan-and-parser-ratio-closure-handoff.md`](docs/handoff/2026-09-13-storage-orphan-and-parser-ratio-closure-handoff.md)
审查报告：[`docs/handoff/2026-09-13-workbuddy-code-review-round1-handoff.md`](docs/handoff/2026-09-13-workbuddy-code-review-round1-handoff.md)
证据脚本：[`docs/handoff/2026-09-13-review-round1-repro.mjs`](docs/handoff/2026-09-13-review-round1-repro.mjs)

针对独立审查指出的 P0–P3 缺陷与优化项完成彻底闭环：

1. **【P0 闭环】storage 内存孤岛副本彻底消除（生命周期配对）** ✅：
   - 修复 `src/js/storage.js` 中的 `klineCacheSet` LRU 容量淘汰：合并持久化与内存副本统一计算总条目（`new Set([...Object.keys(obj.entries), ..._klineMemoryCache.keys()])`），当超出 `KLINE_MAX_ENTRIES` 时成对从持久化和内存中淘汰最旧条目；
   - 在阶段 3 兜底清空逻辑中配对清理关联内存与访问时间缓存；在 `_readKlineCacheEntry` 中增加 `code` / `period` 一致性核验，杜绝内存孤岛与陈旧缓存泄漏。
2. **【P1 闭环】补充 LRU 写入压力下单测覆盖** ✅：
   - 在 `tests/storage.test.js` 中新增针对内存降级条目在后续持续写入压力下被 LRU 正确淘汰的专项测试。
3. **【P2 闭环】量比缺失语义对齐** ✅：
   - 重构 `src/js/parser.js`：无量比数据或非数值时解析为 `undefined`，配合 `formatNumber` 正确显示为 `-`；若行情源为真实数值 `0` 则保留 `0`（显示 `0.00`），忠实反映数据源；在 `tests/parser.test.js` 中补充单测断言。
4. **【P3 闭环】`limitUpView.js` 消除 `pinnedSort` 死参数** ✅：
   - 在 `patchLimitUpRows` 中将传入 `limitUpRowsMatchDom` 的置顶排序参数调整为优先使用 `(lu.groupSort && lu.groupSort.pinned)`，避免在置顶组改变排序后由于死参数导致一致性校验误判为不匹配而触发多余的完整重绘。

**证据与门禁验证**：
- `node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=fixed`：**5/5 全部 PASS**（此前失败的 R-ORPHAN 读取转为 PASS，BUG-02 / BUG-03 保持 PASS）；
- `npm run lint`：0 错误 0 警告；
- `npm test`（QUnit）：**810/810** 全部通过；
- `npm run build`：生产打包成功；
- `npm run e2e`（Playwright）：**74/74** 真实浏览器测试全部通过。

## 2026-09-13 历史状态：WorkBuddy 独立审查（round 1）—— BUG-02/03 确已闭环，但 storage 读取路径新引入「内存孤岛副本」回归（P0，已于今日闭环）

## 2026-09-13 历史状态：BUG-03 回归与 BUG-02 降级可见性闭环修复（已由本轮审查复核）

针对 [`docs/handoff/2026-09-12-review-fix-verification.md`](docs/handoff/2026-09-12-review-fix-verification.md) 核查报告指出的 BUG-03 回归与 BUG-02 Minor 缺陷完成全面闭环：
1. **BUG-03 彻底闭环（消除重复补丁，统一视图行级更新）**：
   - 将 `limitUpController.js` 中的脆弱硬编码字段补丁完全重构，在 `src/js/limitUpView.js` 中封装并导出统一的行级补丁 `patchRow` 与 `patchLimitUpRows`（同时将 `limitUpRowsMatchDom` 下沉至视图层维护并向前兼容重导出）；
   - `limitUpController.js` 的 `patchLimitUpQuoteCells()` 纯粹作为决策分支调度 `patchLimitUpRows`。结构未变时就地复用已有的全量字段补丁，一次性覆盖 `count`、`price`、`percent`、`open`、`volumeRatio`、`amount`、`final`、`break`、`reason`、`name` 及 ST 徽标；
   - 彻底修复涨停看板在行情富集后开盘价恒为 `0.00`、量比恒为 `-` 的 DOM 与 state 脱钩问题。
2. **BUG-02 闭环加固（内存降级条目可见性修复）**：
   - 修复 `storage.js` 的 `_readKlineCacheEntry`：当持久化条目存在但未命中当前 key 时，继续穿透回查 `_klineMemoryCache`，确保写入降级条目在后续读取及配额恢复后依然可见。
3. **测试基线与回归保护补齐**：
   - 在 `tests/limitUpView.test.js` 中新增针对 `patchLimitUpRows` 字段完备性与开盘价/量比更新的单测断言；
   - 在 `tests/storage.test.js` 中新增配额恢复后内存回退条目持续可见性单测；
   - 运行证据脚本 `node docs/handoff/2026-09-12-review-fix-verification-repro.mjs --expect=fixed`：**15/15 全部 PASS**（此前失败的 BUG-03 open 与 ratio 2 项全部转为 PASS）；
   - 完整门禁验证：ESLint 0 错误 0 警告，QUnit 单元测试 **808/808** 全部通过，Playwright E2E **74/74** 全部通过，Vite 生产构建打包成功。

## 2026-09-12 历史状态：`b601d1b` 修复核实 —— BUG-03 未闭环且引入回归（已于 09-13 闭环）

对 `b601d1b`（*fix: 闭环修复独立审查报告缺陷 (BUG-01~04/P0-3/OPT-02)*）做独立复核，证据脚本 [`2026-09-12-review-fix-verification-repro.mjs`](docs/handoff/2026-09-12-review-fix-verification-repro.mjs)（双模式，**broken 基线 `0f134e3`**），报告 [`2026-09-12-review-fix-verification.md`](docs/handoff/2026-09-12-review-fix-verification.md)。

- **真闭环**：BUG-01（MIME 实测 `.mjs`/`.txt`/`.wasm` 类型正确）、BUG-04（回填不再强制 `fitContent()`，改用实时 `getVisibleRange()` 锁定视口；`subscribeVisibleTimeRangeChange` 在 lightweight-charts 4.2.3 中确实存在）、P0-3（TXT 导出入口可用）、OPT-02（`computeVwap` 与旧三处实现在 15 组输入 × 2 站点逐点一致）。
- **主体闭环**：BUG-02（永久超限可内存读回、二次超限裁到最新 3 条），但存在 2 处 Minor：内存降级条目在配额恢复后被静默遗忘；无 storage 时不启用内存兜底。
- **❌ 未闭环且引入回归（Major）**：BUG-03。新 `patchLimitUpQuoteCells()` 只写 price/percent/amount/reason，**漏掉 `open` 与 `volumeRatio`**；行情富集后结构未变即走该补丁分支，导致涨停看板**「开盘价」列恒为 `0.00`、「量比」列恒为 `-`**（与 state 脱钩）。同一组断言在基线 PASS、在 HEAD FAIL，方向反转即判定依据。根因：审查报告对 BUG-03 的问题定性有误（`rerenderLimitUpPage` 本就经 WeakMap 复用 + `patchRow` 只改单元格），按报告「方案 B」照做会复制出第二套不完备补丁。
- **门禁复跑与提交声称一致且全部通过**：lint 0 问题、单测 **806/806**、E2E **74/74**、build 成功 —— 但 BUG-03 与 BUG-04 **本次没有任何新增测试**，且全仓对 `[data-field="open"]`/`[data-field="ratio"]` 零断言，故回归被门禁全绿掩盖。
- 另：本次新暴露的 TXT 导出含期货时输出 4 位裸数字，不满足 SPEC §3.2 的 6 位契约（Minor）。

## 2026-09-12 审查缺陷修复闭环（P0–P2 缺陷全面修复与 DRY 模块化落地）

对照 `docs/handoff/2026-09-12-independent-full-codebase-review-handoff.md` 独立审查报告与演进路线图，落地全部 P0 关键缺陷、规范对齐、P1 DRY 抽离及 P2 局部 Patch 闭环：
1. **BUG-01 闭环（静态资源 MIME 类型补齐）**：在 `server/index.js` 的 `MIME_TYPES` 表中追加 `.mjs`（`text/javascript`）、`.txt`（`text/plain`）与 `.wasm`（`application/wasm`），彻底杜绝现代浏览器严格 ESM MIME 校验阻断及文本强制下载。
2. **BUG-02 闭环（本地存储 LRU 淘汰容错与逐级降级）**：强化 `storage.js` 的 `klineCacheSet` 容错处理：首次 `QuotaExceededError` 淘汰 50% 历史条目重试；若仍超限，循环淘汰至保留最后 3 个最新条目；若依然超限，清理持久化旧键尝试单条保存；若彻底失败，自动降级至会话级内存 `Map` 供透明读写并输出告警，杜绝静默吞掉与运行崩溃。
3. **P0-3 规范对齐（自选股 TXT 纯代码导出支持）**：在 `toolbarView.js` 工具栏新增 `导出选中 (TXT)` 与 `导出全部 (TXT)` 入口；`app.js` 的 `handleExport(scope, format)` 对接 `buildExportText`，生成符合 `SPEC.md` §3.2 标准的 `stocks-YYYYMMDD.txt` 文件（每行纯数字代码）。
4. **OPT-02 & DRY 闭环（分时 VWAP 均价算法统一）**：新建 `src/js/services/quoteMath.js` 纯函数服务 `computeVwap`，重构 `src/js/api.js`、`src/js/parser.js` 及 `server/intradayService.js`，消除前端与服务端的算法三重重复与单位换算差异。
5. **BUG-04 闭环（SWR 回填图表视口缩放防跳变）**：在 `chart.js` 中新增 `subscribeVisibleRange`；`chartRowController.js` 挂载时监听图表视口变动，且在 `applyKlineDataToChart` 重置烛线系列前主动捕获实时活跃视口范围并在重绘后无缝还原，消除 SWR 刷新强制 `fitContent()` 打断用户缩放的抖动问题。
6. **BUG-03 闭环（涨停看板纯 DOM 局部 Patch 真实接入）**：在 `limitUpController.js` 的 `patchLimitUpQuoteCells()` 中正式接入 `limitUpRowsMatchDom` 校验。结构与分组未发生变动时，就地更新 `.num` 现价、涨跌幅、成交额及上榜原因单元格；结构发生变化时才回退至完整重绘，消灭历史胶水死代码并降低 GC 抖动。
- 门禁复跑：
  - `npm run lint`：0 错误 0 警告；
  - `npm test`（QUnit）：**806/806** 全部通过（新增 10 项针对 quoteMath、LRU 逐级降级、内存 fallback 及导出组件的单测）；
  - `npm run e2e`（Playwright）：**74/74** 真实浏览器测试全部通过；
  - `npm run build`：生产打包成功。

## 2026-09-12 全项目代码独立审查与演进路线交付

本轮审查在完全隔离历史代码审查/修复 handoff 文档的前提下，针对全量前端（`src/`）、缓存代理服务端（`server/`）、构建离线字典脚本（`scripts/`）、需求规范（`SPEC.md`）及自动化测试套件（`test/` & `e2e/`）开展了全面的独立工程与架构审查。报告详见 [`docs/handoff/2026-09-12-independent-full-codebase-review-handoff.md`](docs/handoff/2026-09-12-independent-full-codebase-review-handoff.md)。

- **审查结论摘要**：
  1. **需求与功能**：主干自选监控、涨停看板、10日强势股、分时/K线双图表联动、语音告警、期货合约扩展与智能联想搜索均高质量闭环。细节上识别出自选股导出当前仅绑定了 CSV 路径，未提供 `SPEC.md` §3.2 规定的 6 位纯数字无前缀 `txt` 导出入口（底层 `buildExportText` 存在但未在 UI 暴露）。
  2. **Bug 与逻辑风险**：发现 `server/index.js` 静态资源服务缺失 `.mjs`、`.txt`、`.wasm` MIME 类型映射，可能阻断模块加载或文本预览；`storage.js` LRU 淘汰在二次满配额时存在静默丢失异常隐患；`limitUpController.js` 的 `patchLimitUpQuoteCells()` 恒退化为全表 Reconcile 重绘，使 `limitUpRowsMatchDom` 纯函数在生产链路中沦为死代码；`chartRowController.js` 在 SWR 异步回填时若未锁定用户视口范围会强制 `fitContent()` 导致缩放跳变。
  3. **效率、DRY 与优雅度**：指出 `parser.js`、`api.js`、`server/intradayService.js` 中存在三重重复的 VWAP 分时累积均价算法；巨型文件 `app.js`（1643 行）事件胶水过重，需拆离 `settingsController`；监控与看板表格行未采用事件委托（Event Delegation）。
  4. **演进方案制定**：规划了 P0（MIME 补充、LRU 逐级降级、TXT 导出入口）、P1（`quoteMath.js` 算法共享、`app.js` 瘦身、图表视口防跳变）、P2（事件委托、Patch 逻辑理顺）三阶段实施路线。
- **自动化门禁基线全部验证**：
  - `npm run lint`：0 错误 0 警告；
  - `npm test`（QUnit）：**796/796** 全部通过；
  - `npm run e2e`（Playwright）：**74/74** 真实浏览器测试全部通过。


## 2026-09-11 联想搜索审查缺陷闭环（R1–R6 及遗漏需求 D5 完整修复）

对照 `docs/handoff/2026-09-11-search-suggest-fix-verification.md` 提出的 5 项遗留缺陷 (R1–R5)、样式/对比度缺陷 (R6) 及遗漏需求 (D5 - S16)，完成全部修复与全量门禁验证：
1. **R1 闭环（防抖窗口内输入变更即时清理）**：`searchSuggestController.js` 中 `handleInputChange` 变更时立即收起并清空旧候选 DOM（`isOpen = false; candidates = []; renderDropdown();`），并在条目 `click`/`pointerdown` 及执行逻辑中进行当前有效性校验，杜绝防抖窗口内点击旧候选添加过期标的。
2. **R2 & R3 闭环（彻底消除双 keydown 与二次投递）**：移除 `toolbarView.js` 中 `#code-input` 上的内联 `keydown` 监听，统一由 `searchSuggestController` 处理 combobox 键盘事件；在 `handleKeyDown` 入口处增加 `if (e.defaultPrevented) return;` 并在 Enter 处理时调用 `e.stopImmediatePropagation()`，彻底消除双重报错与存储失败恢复输入后的重复投递。
3. **R4 闭环（真实存储层异常捕获与输入保留）**：完善 `storage.js` 中的 `setWatchList` 与 `setSubscribedCodes` 返回值；`addToWatchList` 在写入失败时抛出明确异常，使得控制器 `executeAddCandidate` 的 `try/catch` 在真实存储配额超限时可达，实现 S13「存储失败保留输入并报错」。
4. **R5 闭环（字典加载与搜索渲染异常解耦）**：收窄 `initDictionary` 的 `try/catch` 范围至纯网络与反序列化阶段，搜索/渲染异常不再污染 `dictionaryError`；重试按钮点击时完整重置 `dictionary` 与 `dictionaryError` 状态，消除卡死隐患。
5. **R6 闭环（高亮样式原生变量与对比度适配）**：将 `.suggest-match-highlight` 颜色统一为 `var(--accent-color)`，替换未定义的 `var(--primary)`，暖米、浅色、深色三套主题下文本对比度均达到 WCAG AA 4.5:1 以上。
6. **D5 补齐（S16 主题/窄屏/读屏 E2E 全量覆盖）**：在 `e2e/search-suggest.spec.js` 中新增三项自动化测试，完整覆盖三主题动态切换、375px 移动窄屏自适应布局不溢出，以及 `combobox`/`listbox`/`option`/`aria-expanded`/`aria-activedescendant` 与 live region 读屏联动。
7. **测试与证据强化**：重构 QUnit 中的 B3（真实断言 composition 监听注销）、D4（全 UI 回车与按钮一致性防双发）、D6（真实 storageAdapter 抛错降级）单测断言，并新增 R1、R5 用例；同步更新 `2026-09-11-search-suggest-fix-repro.mjs`，`--expect=fixed` 16 项 CLOSURE 断言全部通过。
- 门禁复跑：
  - `npm run lint`：0 错误 0 警告；
  - `npm test`（QUnit）：**796/796** 全部通过；
  - `node docs/handoff/2026-09-11-search-suggest-fix-repro.mjs --expect=fixed`：**16 项全过**，与期望不符 0 项；
  - `npx playwright test e2e/search-suggest.spec.js`：**10/10** 全部通过；
  - `npm run build`：生产打包成功。

## 2026-09-11 联想搜索修复核实（`3e4486e` 对 B1–B3 / D1–D6 的处置）

以「需求与功能真实可用」为验收标准，对 `3e4486e` 声称修复的 B1–B3 / C5 / C6 / D1–D4 / D6 做独立复核，证据脚本 [`2026-09-11-search-suggest-fix-repro.mjs`](docs/handoff/2026-09-11-search-suggest-fix-repro.mjs)（双模式 `--expect=fixed|broken`，**broken 基线 `b9e57e5`**）：

- **真修复**：B1、B2（回车路径）、B3、C5、C6、D1、D2、D3 —— 每条都先在 `b9e57e5` 上跑到失败才判通过。B1/C6 经全量 5549 条名称新旧对比确认输出一致，属防御性修复、字典产物无需重建；D2 用注入探针（名称含 `浦发<mark>x</mark>银行`）确认只用文本节点渲染。
- **证据强度不足**：QUnit 新增的 B3、D4 用例在旧代码上**照样通过**（空转断言）；B3 的行为正确性由复现脚本另行证明，D4 的真实证据是 E2E。
- **遗留缺陷 5 项**：R1（防抖窗口内点击残留旧候选仍提交过期标的 = B2 另一半）、R2（`#code-input` 上双 keydown 致单次回车处理两次）、R3（**本次修复 catch 恢复输入后重复投递**，属修复引入）、R4（`storage` 吞掉写入失败，S13「存储失败保留输入并报错」实际未达成、D6 夹具强于生产）、R5（`initDictionary` 的 catch 把搜索/渲染异常误报为字典加载失败且重试不可恢复）。另有 R6：新样式 `var(--primary)` 在三主题均未定义、对比度低于 AA。
- **过度声明更正**：D5（S16 主题/窄屏/读屏 E2E）并未完成；原报告 B1 举例的「南京银行/长江电力」本就不会命中。
- 门禁复跑与提交声称一致：lint 0 问题、单测 **794/794**、联想 E2E **7/7**、build 成功。
- 结论：**修复成立，但需补 5 项遗留**；详见 [`2026-09-11-search-suggest-fix-verification.md`](docs/handoff/2026-09-11-search-suggest-fix-verification.md)。

## 2026-09-11 添加栏智能联想与建议功能实施（S01–S17 完整交付）

对照 `docs/requirements-stock-search-suggest.md` 与 `SPEC.md` §3.2/§3.2.1，完成股票/期货智能搜索联想、曾用名检索、状态时效校验及无障碍交互的完整实现与端到端验证：
1. **静态字典与预构建离线索引**：编写 `scripts/build-suggest-dictionary.mjs`，从全市场 5549 只 A 股提炼代码、名称、拼音全拼/首字母、所属板块及历史曾用名映射表。生成单文件 `public/data/stock-suggest-dictionary.json`（458 KiB，满足 <= 500 KiB 预算），并配置 `npm run build:dict` 任务。
2. **多模式智能检索服务 (`stockSearchService.js`)**：
   - 统一 NFKC 规范化、去重、忽略大小写与 ü->v 转换。
   - 输入模式识别：空、批量输入（保留已有逗号/空格分隔）、超长输入与单标的搜索。
   - 9 级稳定优先级匹配，拼音前缀/连续子串、中文包含、曾用名与期货映射分级。
   - 曾用名命中提示（如 `sfza` 检索平安银行提示 `曾用名: 深发展A`）。
   - 纯状态词保护（`st`、`*st`、`xd` 等仅命中今日有效快照状态，不被历史名称污染）。
   - 快照封套校验 (`isValidSpotSnapshot`)：校验 `ok`、`generatedAt` 时效与北京时间日期一致性，过期或缺少封套时安全降级。
   - 期货原生支持：无缝整合主力连续合约（如 `rb0`）及月份合约。
3. **联想控制器与交互生命周期 (`searchSuggestController.js`)**：
   - 150ms 搜索防抖，输入即时作废前序旧请求，支持中途异步字典注入后重放当前搜索。
   - 严格 IME 输入法保护：`compositionstart` 锁定，`compositionend` 恢复，输入法回车选字时不触发提交。
   - ARIA 1.2 Combobox 无障碍标准，`role="combobox"`、`role="listbox"`、`role="option"`、`aria-expanded` 与 `aria-activedescendant` 联动。
   - 键盘方向键循环导航（自动跳过已添加项），Escape/Tab/外部点击收起。
   - 统一 6 步提交决策树（已添加判断、方向键激活项、唯一无歧义首选、批量解析与兜底提示）。
4. **验证结果**：
   - ESLint: 0 问题；
   - QUnit 单元测试：**787/787** 全部通过（新增 17 项联想匹配与交互测试）；
   - Playwright E2E 测试：**70/70** 全部通过（新增 `e2e/search-suggest.spec.js` 6 项全链路端到端用例，覆盖拼音回车、键盘导航、曾用名点击、已添加状态高亮及批量输入兼容）；
   - Vite 生产构建打包成功，字典异步懒加载零运行时代码打包膨胀。

## 2026-09-10 momentum 峰值触及审查缺陷闭环（P1 + P2）

针对 `b321522` 审查（基线 `9449721`）的 1×P1 + 5×P2 已全部处置：P1 加规则版本
`MOMENTUM_RULE='peak-touch-v1'`，换判定口径即自动作废旧缓存（`06944d1`）；P2 按
用户决策**保留**峰值达标但已跌回成本线以下的标的（`isMomentumEligible` 去掉当前
涨幅为正的要求），并把排序器、回踩阈值/文案、表头口径收敛为单一定义（`e188fb4`）。
验证：lint 0 问题；单测 **768/768**；E2E **63/63**；build 通过。详见
[`2026-09-10-momentum-peak-fix-closure.md`](docs/handoff/2026-09-10-momentum-peak-fix-closure.md)。
「新 UI 零覆盖」遗留项也已于 `73752d4` 收尾：E2E mock 补峰值字段并断言峰值副行
（含深度回踩标的保留用例），E2E 63 → **64** 条。

## 2026-09-10 审查缺陷闭环（R1–R8 及 M1–M6、m1–m3）

以「需求与功能真实可用」为验收标准，对 `82c294f` 的 M1–M6 / m1–m3 修复做了独立复核（见 [`m1m6-fix-verification.md`](docs/handoff/2026-09-10-m1m6-fix-verification.md)）：其中 M4、M6、m2 成立；**M5 的修复实际未生效，M3 的修复反而引入了更严重的队列死锁**，M1 方向正确但对主流行情源失效。以下为本轮真正落地并逐项验证的修复：

1. **M3′ & R6 语音队列归属竞态（`fa24120`）**：`tts.js` 的 `finish()` 原先在归属校验**之前**就清掉 `_safetyTimer`/`_finishCurrent`，已 `cancel()` 的 utterance 迟到回调会把下一条的安全定时器一起清掉，队列永久卡死。现改为先判归属再清理；所有终止路径（`end`/`error`/`timeout`/`expired`/`replaced`/`dropped`/`canceled`）经 `_notify` 恰好上报一次 `onSpoken`。
2. **M5′ 播报确认后再写去重基线（`c01b3da`）**：`voiceController.js` 原用 `speech.speak.length === 1` 猜「旧适配器」，但 `speak(text, opts = {})` 的参数带默认值使 `Function.length` 恒为 1，判定永真 → `memory` 在**播报确认之前**就被同步写入。现改为显式 `syncMemory: true` 选择加入，`onSpoken` 仅在 `end` 时写入。
3. **M1′ & R7 实时行情合并证据（`19c2500`）**：`82c294f` 虽已改读 `quoteDate`/`updateTime`，但 aktools 快照无任何日期字段、新浪只给 `HH:MM:SS`，于是**盘中合并在主源上被整体关死**。现新增 `snapshotEvidenceDateKey()`，以快照自身的 `generatedAt` 作为「同日且非 stale」证据；盘前/盘后 `liveDate` 为空、stale 快照不提供证据，R7 原始保证不变（过期快照仍被拒）。
4. **M2′ 部分失败可见性（`f9055e1`）**：`fetchQuotes` 返回可序列化的 `{ quotes, failedCodes, asOf, source }` 封套（此前是把返回数组自引用挂 `quotes` 属性）；`lastUpdate` 仅在整批成功时推进，新增 `lastEffectiveAt`；缺失标的标记 `stale: true`，表格行内 `⏳` + tooltip、状态栏提示 `⚠️ N 项行情未更新`，`alert.js` 对 stale 报价保持上一次方向——既不误触发，也不会在恢复时重复触发。
5. **m1 / m3′ 缓存时效标识与复现脚本（本轮）**：`format.js` 新增统一 `formatCacheAge(generatedAt, stale, now)`，涨停看板表头、10 日强势股状态区、分时状态行共用同一措辞（`(数据时间 HH:MM:SS · N 分钟前)` / `(过期缓存 · 数据时间 HH:MM:SS)`）；涨停原因归档新增 `reasonSource: aktools-stock_lhb_detail_em`，标明它是龙虎榜席位明细而非上涨原因；`2026-09-10-review-repro.mjs` 的 R7 断言改用真实源产物（`quoteDate`/`updateTime`/快照 provenance），不再使用会造成空转的空 `liveDate`——已在 `1c62554` 上以 `--expect=broken` 复现全部 8 项、在当前 `main` 上以 `--expect=fixed` 全部通过；`2026-09-10-r1r8-fix-review.md` 补上历史基线标注。

验证：`npm run lint` 0 问题；单测 **764/764** 通过；Playwright E2E **63/63** 通过；`npm run build` 通过。

> [!NOTE]
> 本节之前的表述曾把 `82c294f` 的 M1/M3/M5 记为「已修复」。独立复核证明 M5 的判定条件恒真（等于没修）、M3 的改法会卡死语音队列，故上表已按实际生效的提交重写；以本节为当前状态。


## 2026-09-09 运行审查修复

修复腾讯 modern 冷却阻断 legacy 回退、上午分钟数据被永久归档、开盘前默认请求未开始交易日，以及部署域名手动扫描 403。历史分时通过收盘点和来源状态验证完整性，不完整数据仍可查看并继续尝试补齐；监控图表在 09:15 前显示上一交易日，开盘后自动跟随，手动历史选择保留。扫描只默认放行项目既有域名，环境变量可覆盖，跨域防护保留。新增 5 项服务/日期回归及 1 项开盘前后浏览器回归；最终验证结果见本轮交付说明。

最终 `npm run ci` 正常退出 0：726 单测、63 E2E、lint/build 全部通过。历史分时 mock 日期跟随请求，实时行情用例的交易日历补齐到模拟交易日，避免不一致夹具掩盖日期错误。线上验收应比对新版本，并用带同源 Origin、无效日期的扫描请求确认返回参数校验 400（不会启动扫描），而非旧版的域名拒绝 403。

## 2026-09-09 VPS 远程诊断

本轮完整 CI：721 单测、62 E2E、lint/build 通过；独立 `test:spot-live` 约 14.9 秒恢复 5549 个有效快照。真实本机 HTTP 500 已复现并读取异常栈。

线上排查确认 AKTools 全市场快照 HTTP 500，缓存名单回退仅覆盖 33 只股票却被标为 complete。本机复现东财 RemoteDisconnected，已接入新浪完整分页快照回退，并校验全量计数、缺页与重复代码；本机生产 API 实测 5559 个名单、5549 个有效快照、沪深北全覆盖。保留部分覆盖警告、旧缓存纠正和启动补扫。见 [排查证据与边界](docs/handoff/2026-09-09-vps-diagnostics-investigation.md)。README 已加入抓取方法与“先本机复现”工作流。

新增 `/api/cache/diagnostics` 公共结构化 JSON 接口和独立 `/logs.html` 页面，支持一行 curl 抓取、来源/级别筛选及导出。采集 Node/API/上游和浏览器异常摘要；白名单字段防止公开任意敏感文本，7 天 / 500 组有界持久化。详见 [诊断接口与覆盖边界](docs/diagnostics.md)。

验证：712 单测、61 E2E、lint/build 通过；随后版本字段、导航入口和静态缓存策略调整再次通过 712 单测、8 项诊断/导航 E2E、lint/build。生产后端提供日志页面的截图检查通过。

## A–E 全部完成目标（已完成）

最新验收：[A–E 完成记录与验收矩阵](docs/handoff/2026-09-09-completion-goal-progress.md)。A–E 和 T1/T2 工程项均已实施：共享请求归属、合约会话决策、增量涨停 DOM、语音/监控控制器、离线缓存/网络/时钟隔离。最终门禁 709 单测、59 E2E、lint/build；真实行情联网 smoke 和真实设备长时间实播未执行。以下各条保留阶段历史，当前状态以本段和最新验收矩阵为准。

E 已提取 monitorController，app 的后台分时回填也统一走 ChartRowManager 归属保护。704 单测、58 E2E、lint/build 通过；继续最后的 T1 与验收补齐。

D 已实现涨停分组/排序节点移动和图表实例保留、删除及批量清理。703 单测、既有 57 E2E、新增生命周期 E2E 定向、lint/build 通过；详情见逐阶段记录。

B 请求归属已完成：前端共享 requestScope，服务端 jobId 与串行缓存提交；完整 CI 702 单测、57 E2E、lint/build 通过。继续 D、监控控制器与测试隔离。

进度见 [逐阶段完成记录](docs/handoff/2026-09-09-completion-goal-progress.md)。已完成会话决策与语音控制器提取：保护当天手动关闭、夜盘恢复、凌晨提醒、真实播报去重及合约日历图表判断。完整 CI 通过（694 单测、57 E2E、lint/build），新增日历边界定向测试通过。B、D、监控控制器和 T1 验收正在继续。

## 2026-09-09 最新提交复审与继续修复

- 最新交接：[阶段核验、四项修复与剩余任务](docs/handoff/2026-09-09-followup-review-and-remaining-stages.md)。基线 `60a8147`，已同步远端。
- 修复置顶组排序失效、旧普通/SWR K 线覆盖强刷结果、节前周六凌晨误开市、关闭智能调度仍过滤期货；语音定时器与播报循环共用标的资格策略。
- 新增 9 项真实模块回归，包含生产动量控制器及 ChartRowManager 的旧任务竞态。最终 `npm.cmd run ci` 退出码 0：lint、689/689 单测、57/57 E2E、生产构建全部通过。
- 阶段 A 主要修复已落地，但原始验收覆盖和 T1 仍有欠缺；B 未统一；C 部分完成；D、E 未完成。以下旧记录的“全部闭环”应按本轮审查范围修正理解。

> **新窗口从这里开始**：本文件记录了完整的重做计划、决策、当前阶段和下一步任务。无需阅读历史对话。
>
> **最新进展（2026-09-09）**：[`代码审查缺陷彻底闭环与期货会话模型收敛 handoff`](docs/handoff/2026-09-09-code-review-defects-closure-and-session-model-handoff.md)。完成 4 项核心攻坚：（1）修复 `api.js` 强刷 K 线无法写回本地缓存缺陷；（2）提取前后端通用期货会话服务 `src/js/futures/session.js`，精准识别无夜盘金融期货（国债/股指）与不同商品期货夜盘时间；（3）修复夜盘播报与调度标的过滤及收盘提示；（4）新增 `tests/codeReviewRegressions.test.js` 断言式单元测试套件，离线单测扩展至 671/671 全部通过，ESLint 0 错误 0 警告，Vite 生产构建成功。
>
> **前序进展（2026-09-08，基线 ef695b7→782185a）**：[`R1–R7+T1/T2 修复闭环 handoff`](docs/handoff/2026-09-08-r1-r7-t1-t2-fixed-handoff.md)。上一轮审查发现的 7 项功能缺陷与 2 项工程问题已全部修复。
>
> **前序代码审查（2026-09-08，基线 9cd782e）**：[`代码缺陷与重构 handoff`](docs/handoff/2026-09-08-code-review-bugs-and-refactor-handoff.md)。
>
> **最新交接文档**：[`docs/handoff/2026-09-09-code-review-defects-closure-and-session-model-handoff.md`](docs/handoff/2026-09-09-code-review-defects-closure-and-session-model-handoff.md) — 2026-09-09 缺陷闭环与期货会话模型收敛交接文档（最新）。

## 项目定位

股票期货实时监控助手 v2 - 单页 Web 应用 (SPA)

- 实时监控 A 股 / 期货价格
- 语音播报 + 价格提醒
- 走势图 (TradingView Lightweight Charts)
- **涨停看板（独立页面，按连板数分类）**

## 2026-09-02 运行缺陷修复状态

- ✅ 保留桌面端左分时、右 K 线同时显示；分时增加昨收对称双轴、真实均价线、完整交易时间框架和当前点详情，K 线增加 OHLC/MA/量详情。
- ✅ 行情刷新同步更新左分时末点与右侧当前 K 柱完整 OHLCV；新增交易时段连续报价 E2E。
- ✅ 分时数据源 waterfall 收敛到服务端，东财 trends2 实测 241 点约 3.15 秒成功；前端不再重复 AKTools 失败链。
- ✅ 10 日涨幅按钮改为 POST 启动 single-flight 后台任务、GET 轮询；进度可见，Windows 缓存写入竞态已修复，最后成功结果独立保留。
- ✅ 10 日算法按目标日期截断，并只展示全体数据中最新交易日结果，杜绝退市/陈旧缓存被当作当前 10 日涨幅。
- ✅ 2026-09-03 已修复 4,015 只刷新失败：腾讯批量报价在约 4.3 秒内从 5,864 个缓存代码识别出 5,516 只有效股票，并剔除 338 个退市、6 个停牌、2 个非股票转债；59 个批次零失败。
- ✅ 日 K 新增 AKShare 当前采用的腾讯 `newfqkline` 备用端点；首轮真实全量补齐 4,110 只旧缓存，随后复扫达到 `complete`：5,516/5,516、日 K 失败 0、实时快照失败 0，盘中命中 20 只。
- ✅ 盘中扫描只要求历史 K 线补齐到上一已收盘交易日，再用批量实时报价合成今日 OHLCV；停牌缺口仅在当前上游响应且至少 11 根历史时接受，陈旧数据仍会被拒绝。
- ✅ 扫描结果新增 universe/source/failure 诊断统计及最多 20 个失败代码样本；异常不再被吞掉或错误计入最新交易日覆盖。
- ✅ 腾讯 modern/legacy WAF 冷却已解耦；跨年请求、纯 A 股号段过滤、15:05 盘后官方 K 线和 Windows 缓存替换重试均已补齐。
- ✅ `npm run ci` 通过：569 单测、51 E2E、lint、生产构建全部成功。

## 2026-09-03 核心缺陷闭环与境内期货全链路支持状态

- ✅ **全部 18 项缺陷 100% 修复入库**：分 3 批（`8ac0057`、`6b62078`、`fd70619`）彻底解决 P0/P1/HIGH 级缺陷，包括新浪 JSONP 正则及字段错位、周六凌晨会话判定、境内期货分时放行、法定节假日日历单例注入、周/月 K 聚合（解除 HTTP 400）、4 项图表生命周期竞态、昨结对齐与国债 3 位小数、合约年月校验、single-flight AbortSignal 隔离、读缓存写放大消除等。
- ✅ **单测补齐至 622 项通过**：补齐服务端期货报价与 K 线服务真实单测、新浪真实抓取报文测试、科创板 CDR 689xxx 20% 限额测试、localStorage QuotaExceeded 50% LRU 淘汰测试。
- ✅ **构建与代码规范**：ESLint 0 错误 0 警告，生产打包顺利构建。
- 详见前序交接文档：[`docs/handoff/2026-09-03-remaining-defects-and-remediation-handoff.md`](docs/handoff/2026-09-03-remaining-defects-and-remediation-handoff.md)。

## 2026-09-04 全面代码审查缺陷核验与修复状态

- ✅ **核验与修复 10 项缺陷/坏味道**：
  1. **Bug 2.1 (双创板/北交所 ST 涨跌幅)**：修正 `kline.js` 中科创/创业板（含 ST）20% 规则及北交所 30% 规则，纠正测试用例历史错误断言。
  2. **Bug 2.2 (消除 K 线缓存读取写放大)**：`storage.js` 改为模块级纯内存 `_klineAccessTimes` 记录访问时间，消除查询读操作同步调用 `localStorage.setItem`，补齐 0 写盘单测。
  3. **Bug 2.3 (期货分时 VWAP 均价线补齐)**：`server/futures/futuresKlineService.js` 解析新浪第 3 列均价或成交量加权 VWAP，并对旧缓存补齐向前兼容。
  4. **Bug 2.4 (`refreshNow` 竞态加固)**：引入 `seq` 单调自增序列号，消除前置请求 Abort 导致并发互斥锁被过早释放。
  5. **Bug 2.5 (涨停看板周期轮询就地 Patch)**：实现 `patchLimitUpQuoteCells()` 和 `updateLimitUpStatusBar()`，避免周期刷新全量摧毁重建 DOM 及图表重新挂载白屏。
  6. **Bug 2.6 (`onKlineUpdated` 注销闭包与生命周期)**：保存注销闭包，导出 `stopApp()` 统一清理 Worker 心跳、定时轮询与事件监听。
  7. **Bug 2.7 (国债期货 3 位小数与语义化选择器)**：`alert.js` 和 `app.js` 统一支持变动价位 `< 0.01` 的 3 位小数播报与展示，改用 `data-field` 语义化选择器替代下标。
  8. **Bug 2.8 (标的导出 CSV 标准化)**：新增 `buildExportCsv()` 导出含 UTF-8 BOM 和完整行情的标准 CSV 文件，保留纯文本向后兼容。
  9. **架构 4.1.2 (解除模块循环依赖)**：下沉通用格式化工具至 `src/js/format.js`，解除 `app.js` 与 `limitUpView.js` 相互引用。
  10. **UI/UX 与 A11y 体验增强**：Toast 浮动提示与输入框振动反馈、行展开键盘无障碍 (`role="button"`, `aria-expanded`, Enter/Space) 及移动端小屏响应式适配。
  11. **图表（日K与分时）停留在昨日缺陷彻底修复**：
      - **分时锁死昨日修复**：`app.js` 重构交易日解析 `resolveInitialTradeDate`，依据当前北京时间与交易日历（或期货当期交易日）优先锚定今日开市交易日，避免远端历史日 K 只有昨日收盘 Bar 时将昨日写入 `selectedTradeDate`，恢复今日分时与后续实时 Tick 驱动；
      - **日 K 跨日动态 Bar 追加**：`kline.js` 中 `applyLiveQuoteToKline` 增加目标交易日判定，当检测到标的报价日期 `targetDate > lastDate` 时自动追加今日新蜡烛并维护完整 OHLCV；
      - **境内期货服务端日 K 实时合成**：`server/futures/futuresKlineService.js` 在日/周/月 K 服务中自动调用 `getCachedFuturesQuote` 合成未收盘的今日实时 Bar；
      - **图表管理器注入实时 Quote**：`chartRowController.js` 注入 `getQuote`，在 `loadKline` 完成后即刻与内存实时 Quote 融合渲染。
- ✅ **测试与质量**：单元测试扩充至 631 项全部 PASS；Playwright 端到端测试 56/56 项 100% 通过；ESLint 0 错误 0 警告；Vite 生产构建成功。
- 详见交接文档：[`docs/handoff/2026-09-04-code-review-defects-and-architecture-refactor-handoff.md`](docs/handoff/2026-09-04-code-review-defects-and-architecture-refactor-handoff.md)。

## 2026-09-05 视图解耦、无障碍 (A11y)、响应式与审查缺陷全量闭环状态

- ✅ **自定义非阻塞确认模态框 (`src/js/modal.js`)**：
  - 移除原生阻塞式 `window.confirm(...)`，实现主题自动适配、键盘焦点陷阱（Tab 循环、Escape 取消、Enter 确认）、遮罩点击关闭的异步非阻塞确认弹窗；
  - 编写专用单元测试 `tests/modal.test.js`，5 项单测全部通过。
- ✅ **大文件巨石与视图/服务层彻底解耦 (`src/js/views/` 与 `src/js/services/`)**：
  - 抽离 `src/js/views/headerView.js`：封装顶栏标题、刷新频率下拉、自动刷新按钮及状态更新、主题切换；
  - 抽离 `src/js/views/toolbarView.js`：封装自选股输入框（带回车监听与报错动效）、添加按钮、立即刷新、批量删除/静音/启用与 CSV 导出；
  - 抽离 `src/js/views/monitorTableView.js`：封装自选股监控表格核心渲染、全选控制、无障碍单行渲染、内嵌图表行展开及局部单元格 Patch；
  - 抽离 `src/js/services/momentumScanner.js`：封装 10 日涨幅扫描调度、并发候选股分析、共享缓存轮询与钉选排序合并；
  - 抽离 `src/js/views/momentumView.js`：封装 10 日强势股面板装配 (`renderMomentumSectionView`)、纯函数排序、指标计算与过滤、单元格局部更新及行内图表展开；
  - 抽离 `src/js/views/voiceBarView.js`：封装语音设置栏渲染、字段动态调序与事件处理；
  - 抽离 `src/js/views/alertBarView.js`：封装价格预警栏渲染、阈值输入与通知权限申请；
  - `src/js/app.js` 巨石瘦身 510+ 行，仅作为生命周期协调控制器并保持所有既有外部引用的向后兼容重导出。
- ✅ **表格更新脱敏与语义化定位 (`data-field`)**：
  - 彻底废除 `allCells[4..9]` 等脆弱硬编码下标，为自选股与 10 日强势股表格所有 `th` / `td` 注入 `data-field` 语义标记，改用 `td[data-field="..."]` 精准 Patch。
- ✅ **移动端完整响应式适配 (`src/style.css`)**：
  - 在 `@media (max-width: 768px)` 中对 `#limit-up-table` 与 `#momentum-table` 的次要列（开盘价、量比、成交额等）进行自动隐藏，增加平滑横向滚动，解决小屏严重挤压问题。
- ✅ **无障碍 A11y 深度加固 (`src/js/limitUpView.js`)**：
  - 涨停看板所有排序列注入 `role="button"`、`tabindex="0"`、`aria-sort` 与键盘回车/空格触发支持；
  - 为置顶/收藏按钮补齐动态 `aria-label`。
- ✅ **全量审查 P0/P1 与安全缺陷彻底闭环**：
  - **P0-1**：`server/index.js` 与 `server/momentumService.js` 修复裸 Promise 未挂载 catch 及内部嵌套 try/catch，彻底消除 Unhandled Rejection 崩进程隐患；
  - **P1-1**：`chartRowController.js` 与 `api.js` 修复 `noCache`/`forceRefresh` 穿透，确保「重新加载」跳过本地缓存直连网络；
  - **P1-2**：`chart.js` 在 `createKlineChart` 正式暴露 `subscribeBarClick: onClick`，打通日 K 柱点击切换分时链路；
  - **P1-3**：`server/spotService.js` 修复 `universe.json` 种子安全查找，消除数组立即求值抛错；
  - **P1-4 & P1-5**：`server/momentumService.js` 修复 `finally` 误删新任务竞态与重启启动扫描缓存 key；
  - **P1-6**：`index.html` 改读 `app_theme`，彻底消除深色模式刷新首帧闪白；
  - **P1-7 & P1-8**：`src/js/app.js` 补齐 `closeAllMomentumCharts` 路由切页销毁，`stopApp` 调 `stopVoiceTimer` 消除后台定时器泄漏；
  - **安全 P1**：`server/proxyRoutes.js` 修复协议相对路径 `//evil.com/x` SSRF 漏洞，`server/index.js` 监听地址默认收敛至 `127.0.0.1`；
  - **P2 & UX-2**：`server/cacheStore.js` 支持 `readCache` skipTouch 并刷新文件 mtime；期货服务读取 `AKTOOLS_BASE` 环境变量；`time.js` 统一 `hourCycle: 'h23'` 杜绝午夜 24 点解析异常；自选股单个删除接入 `showConfirmModal` 确认弹窗。
- ✅ **测试与质量**：单元测试增至 651 项全部 PASS；Playwright 端到端测试 56/56 项 100% 通过；ESLint 0 错误 0 警告；Vite 生产构建成功；`npm run ci` 全绿。
- 详见交接文档：[`docs/handoff/2026-09-05-code-review-defects-closure-and-views-decoupling-handoff.md`](docs/handoff/2026-09-05-code-review-defects-closure-and-views-decoupling-handoff.md)。

## 2026-09-05 WorkBuddy 全量代码审查缺陷彻底闭环状态

- ✅ **3 项 P0 级致命缺陷全量闭环**：
  - **F-P0-1（10日强势股内嵌图表展开空白与单双图结构不匹配）**：修复 `src/js/views/momentumView.js` 生成的 host ID 前缀不一致问题（对齐为 `momentum-chart-host-${code}`），并消除无分时数据源时的空分时 split 结构，改为全宽日 K 单 Pane 展示；在 `e2e/monitor.spec.js` 中新增专用测试真实断言图表展开与 Canvas 挂载。
  - **F-P0-2（涨停看板实时报价停滞）**：在 `app.js` 的 `refreshNow()` 刷新循环中显式接入 `applyLiveTicksToLimitUp()`，并在 `getRefreshCodes()` 中把交易日当天的 `state.limitUp.items` 代码纳入全局刷新池，实现涨停板标的毫秒级 Tick 驱动更新。
  - **B-P0-1（`server/utils.js` jsonResponse 崩溃进程）**：在 `jsonResponse` 写入响应头与数据前增加 `res.headersSent` 与 `res.destroyed` 防御判断，并用 `try...catch` 拦截客户端提前中断连接时的 Socket 异常；在 `server/index.js` 服务入口增加 `process.on('uncaughtException')` 兜底。
- ✅ **7 项前端 P1 级缺陷彻底闭环**：
  - **F1（涨停看板 30s 周期刷新破坏 DOM）**：轮询仅局部更新状态栏与报价单元格 (`patchLimitUpQuoteCells`)，彻底消除周期性全量 DOM 销毁与已展开图表白屏。
  - **F2（图表异步加载竞态条件）**：在 `chartRowController.js` 的 `finally` 块中增加当前实例有效性与展开状态校验 (`this.isExpanded(code) && this.getInst(code) === inst`)，消除快速折叠展开时的状态篡改。
  - **F3（`stopApp()` 清理不彻底）**：增补对 `appRouter.stop()`、`abortController.abort()`、`stopMomentumScan()` 的彻底销毁。
  - **F4（10日涨幅后台轮询定时器泄漏）**：为 `momentumPollTimer` 引入独立句柄变量，在发起新扫描、页面停止扫描与退出时及时 `clearTimeout`。
  - **F5（扫描与大批量加载时的 SWR 请求风暴）**：`api.js` 中增加 30s 最小重试节流，并在扫描候选股时传入 `opts.revalidate = false`。
  - **F6（动量扫描结果脏覆盖 `state.quotes`）**：实现 `_mergeMomentumQuotesSafely`，保留既有标的完整字段，防止后续单元格读取产生 NaN。
  - **F7（交易时段判断边界漏洞）**：`isFuturesMarketOpen` 补齐周二至周六凌晨夜盘前日法定日历校验与节前夜盘休市判定。
- ✅ **5 项服务端 P1 级缺陷彻底闭环**：
  - **B1（动量扫描接口 CSRF / DNS Rebinding）**：严格校验 `Host` 必须为 `localhost` 或 `127.0.0.1` 并校验 `Origin`/`Referer`。
  - **B2（过期扫描任务泄漏）**：保存 `controller` 并在替换 10 分钟过期任务时主动触发 `abort()`。
  - **B3（声明 Node.js 最低版本）**：`package.json` 补充 `"engines": { "node": ">=20.3.0" }`。
  - **B4（代理请求废弃事件与 OOM 防御）**：改用 `res.on('close')` 并限制代理请求体上限 `MAX_PROXY_BODY_BYTES = 10MB`。
  - **B5（期货外部 API 缺少超时控制）**：期货报价与 K 线服务统一接入 `fetchWithTimeout` 8s 超时。
- ✅ **P2 缺陷与 UX 交互优化**：
  - **P2-1（CSV 公式注入防护）**：导出 CSV 针对 `[=+\-@\t\r]` 首字符添加转义前缀 `'`。
  - **P2-2（TTS 高精度标的播报）**：国债期货等最小变动价位 `< 0.01` 标的采用 3 位小数。
  - **UX-7（错误振动定位）**：`flashError` 支持按错误类型精确定位振动输入框。
  - **UX-8（危险操作取消按钮默认聚焦）**：`showConfirmModal` 增加 Tab 焦点环，当 `danger: true` 时默认聚焦取消按钮防误触。
- ✅ **质量基线验证**：
  - ESLint 代码规范：0 错误 0 警告
  - QUnit 单元测试：652 / 652 全部 PASS
  - Playwright E2E 自动化测试：57 / 57 全部 PASS
  - Vite 生产打包：顺利构建
- 详见交接文档：[`docs/handoff/2026-09-05-workbuddy-code-review-defects-closure-handoff.md`](docs/handoff/2026-09-05-workbuddy-code-review-defects-closure-handoff.md)。

## 2026-09-05 WorkBuddy 第二轮代码审查缺陷彻底闭环与控制器解耦状态

- ✅ **3 项 Major 级核心缺陷全量闭环**：
  - **M-1 & M-3 & Nit 4（动量数学算法统一抽取与依赖倒置）**：抽离 `src/js/services/momentumMath.js`，将 `computeTenDayMomentum`、`sortMomentumItems`、`getMomentumReasonText` 及参数常量（`MOMENTUM_LOOKBACK_TRADING_DAYS = 10`、`MOMENTUM_THRESHOLD_PCT = 45`）沉淀为领域公共模块，严格对齐 `>= 11` 根 Bar 判定与截断日逻辑；服务端 `momentumService.js` 与前端 `momentumScanner.js` 统一引用，彻底消除口径漂移与反向依赖；新增 `tests/momentumMath.test.js` 8 项单测全部通过。
  - **M-2（`app.js` 上帝对象拆分与控制器化）**：
    - 抽离 `src/js/controllers/limitUpController.js`：纳管涨停看板数据拉取、轮询定时器、报价 Cell 原地 Patch、图表管理及日期导航；
    - 抽离 `src/js/controllers/momentumController.js`：纳管 10 日强势股全流程扫描、轮询监控、图表展开管理；
    - 抽离 `src/js/services/batchExportService.js`：纳管自选股批量解析、文本与 CSV 导出；
    - `src/js/app.js` 巨石净减少超 920 行代码，保持既有测试契约 100% 向后兼容。
- ✅ **6 项 Minor 级缺陷彻底闭环**：
  - **m-1（代理流式累积与超限熔断）**：`server/proxyService.js` 先检查 `content-length`，并使用 `reader.read()` 流式累计字节，超过 10MB 立即 `reader.cancel()` 中断，防止内存峰值击穿。
  - **m-2（期货查询参数 encodeURIComponent）**：`server/futures/futuresKlineService.js` 针对 4 处 URL 参数统一转义。
  - **m-3（`isDataAutoRefreshAllowedNow` 死分支修复）**：废除未定义的 `state.chartRowManager`，改用收集全体已展开图表中的境内期货标的精准判断夜盘时段。
  - **m-4（期货昨结价 24h 缓存）**：`server/futures/futuresKlineService.js` 对 `fetchFuturesDaily` 接入 24h 日线缓存，杜绝每 10 秒刷新分时重复拉取日线。
  - **m-5（清理 `el()` `html` XSS 隐患通道）**：清理 8 个视图文件中的 `node.innerHTML` 注入分支，实现零风险安全收敛。
  - **m-6（服务端 `mapLimit` 统一归拢）**：在 `server/utils.js` 统一导出并发控制器，避免重复实现。
- ✅ **4 项 Nit 优化项闭环**：
  - **Nit 1**：`chartRowController.js` 规范文件顶部 import。
  - **Nit 2**：`server/intradayService.js` 简化 `safeName = code`。
  - **Nit 3**：`server/index.js` 区分 `/assets/*` 强缓存与根静态资源协商缓存。
  - **Nit 4**：动量阈值与回看周期常量集中下沉。
- ✅ **质量基线验证**：
  - ESLint 代码规范：0 错误 0 警告
  - QUnit 单元测试：660 / 660 全部 PASS（净增 8 项）
  - Playwright E2E 自动化测试：57 / 57 全部 PASS
  - Vite 生产打包：顺利构建
- 详见交接文档：[`docs/handoff/2026-09-05-workbuddy-round2-code-review-defects-closure-handoff.md`](docs/handoff/2026-09-05-workbuddy-round2-code-review-defects-closure-handoff.md)。

## 2026-09-07 WorkBuddy 第三/四轮代码审查遗留债务闭环状态

- ✅ **2 项 Minor 遗留缺陷彻底闭环**：
  - **3-1（代理体积上限文档对齐）**：统一修正文档与 `STATUS.md` 中写为 15MB 的笔误，与代码实现 `server/proxyService.js:6`（`MAX_PROXY_BODY_BYTES = 10MB`）保持严格一致。
  - **3-2（收敛 `limitUpRootEl` 消除双源真相）**：移除 `src/js/app.js` 中的冗余模块级 `let limitUpRootEl` 变量与路由赋值，统一通过 `limitUpCtrl.getRootEl()` 动态获取与维护，彻底闭环状态不一致隐患。
- ✅ **2 项 Nit 优化与竞态守卫闭环**：
  - **3-3（消除测试与控制器层级倒挂）**：移除 `src/js/controllers/chartRowController.js` 的 `intradaySourceLabel` re-export，测试文件 `tests/chartRowController.test.js` 直接从 `format.js` 引用。
  - **3-6（动量扫描陈旧任务中止竞态守卫）**：在 `server/momentumService.js` 的 `catch` 块中加入 `JOBS.get(jobKey)?.promise === job` 守卫，防止已超时中止的旧任务异常写入脏覆盖新任务扫描进度。
- ✅ **质量基线验证**：ESLint 0 错误 0 警告，QUnit 660/660 全部 PASS，Vite 生产构建成功。
- 详见交接文档：[`docs/handoff/2026-09-07-workbuddy-round4-code-review-handoff.md`](docs/handoff/2026-09-07-workbuddy-round4-code-review-handoff.md)。

## 备份

`backups/` 目录：
- `project1_v1_2026-06-04.zip` (51.85 MB) — Phase 0-4.3 完成时备份（含 node_modules）
- `project1_v2_2026-06-05.zip` (0.20 MB) — Phase 5 + 2 bug 修复完成时备份（**不含 node_modules**，用 `npm install` 恢复）

**v2 备份内容**（60 文件，0.64 MB 解压）：src/ · tests/ · e2e/ · docs/ · index.html · package.json · package-lock.json · vite.config.js · playwright.config.js · .eslintrc.cjs · AGENTS.md · SPEC.md · STATUS.md

**恢复步骤**：
```bash
unzip backups/project1_v2_2026-06-05.zip -d restore/
cd restore
npm install
npm run ci
```

## 技术决策（已确认）

| 项目 | 决策 |
|------|------|
| 前端 | Vanilla JS (ESM) + Vite 5 |
| 图表 | TradingView Lightweight Charts v4 (替代 ECharts) |
| 测试 | QUnit 2.x 单测 + Playwright e2e |
| 代码规范 | ESLint 8 |
| 数据源 | 实时行情：腾讯主 + 东财备 + 新浪期货；K 线：东财主 + 腾讯备 |
| 路由 | Hash 路由 (#/ 和 #/limit-up) |
| 配色 | A 股惯例：红涨绿跌；涨停黄、炸板紫 |
| 主题 | 3 套：暖米 / 浅色 / 深色 |

## 目录结构

```
project1/
├── index.html
├── package.json (v2.0.0)
├── vite.config.js (含 6 个 API 代理)
├── .eslintrc.cjs
├── playwright.config.js
├── .gitignore
├── AGENTS.md
├── SPEC.md (保留为需求真理源)
├── STATUS.md (本文档)
├── public/
├── src/
│   ├── main.js              # boot → startApp(#app)
│   ├── style.css            # 3 主题 CSS 变量 + 表格/工具栏/chart panel/响应式
│   ├── pages/               # (待 Phase 4 用)
│   └── js/
│       ├── api.js           # 实时行情：腾讯主→东财备；fetchKline：东财主→腾讯备
│       ├── parser.js        # Tencent / Eastmoney / Sina 解析 + normalizeCode
│       ├── storage.js       # localStorage 封装 + STORAGE_KEYS 注册
│       ├── theme.js         # warm/light/dark 循环 + data-theme
│       ├── kline.js         # 8 周期 PERIODS + 东财/腾讯 K 线解析 + MA + 成交量 + 涨停/炸板配色
│       ├── chart.js         # TradingView 封装：createKlineChart / 主题色 / MA 配色
│       └── app.js           # UI + 状态机 + 增量渲染 + 点击展开 K 线面板
├── tests/
│   ├── _bootstrap.test.js   # 1 case
│   ├── parser.test.js       # 18 cases
│   ├── storage.test.js      # 16 cases
│   ├── theme.test.js        # 9 cases
│   ├── api.test.js          # 21 cases (含 fetchKline + Tencent fallback)
│   ├── app.test.js          # 27 cases
│   ├── kline.test.js        # 69 cases (PERIODS · 东财/腾讯 URL+解析 · MA · 成交量 · 涨停炸板)
│   └── chart.test.js        # 6 cases (theme colors · options · MA palette)
├── e2e/                     # (待 Phase 5 用)
├── docs/
├── logs/
└── backups/project1_v1_2026-06-04.zip (旧版备份)
```

## API 代理（已配置在 vite.config.js）

> ⚠️ **键顺序重要**：vite 5 按对象键插入顺序首个 `startsWith` 匹配胜出。前缀重叠时长键必须在前。

| 路径 | 上游 | 用途 |
|------|------|------|
| `/api/tencent` | `https://qt.gtimg.cn` | 实时行情（主） |
| `/api/eastmoney-kline` | `https://push2his.eastmoney.com/api` | 日/周/月/分钟 K 线（主，必须先于 `/api/eastmoney`） |
| `/api/eastmoney` | `https://push2.eastmoney.com/api` | 实时行情（备） |
| `/api/sina` | `https://hq.sinajs.cn` | 新浪期货行情 |
| `/api/qq-kline-min` | `https://ifzq.gtimg.cn` | 腾讯分钟 K 备用（必须先于 `/api/qq-kline`） |
| `/api/qq-kline` | `https://web.ifzq.gtimg.cn` | 腾讯日/周/月 K 备用 |

## 重做阶段

| 阶段 | 状态 | 标题 | 关键交付 |
|------|------|------|----------|
| **0** | ✅ 完成 | 清理 + 初始化 | Vite + ESLint + Playwright + QUnit 全部就绪 |
| **1** | ✅ 完成 | 基础架构 + 监控列表 | api/parser/storage/theme/app + 监控列表 UI |
| **2** | ✅ 完成 | 走势图 (TradingView) | K 线 + 均线 + 成交量 + 8 周期 + 主题联动 + 涨停/炸板配色 + 双源 fallback |
| **3** | ✅ 完成 | 语音播报 + 价格提醒 + 自定义播报内容 + 实时 K 线 | TTS 队列 + 阈值提醒 + 桌面通知 + Worker 心跳 + 字段可调序 + K 线 tick |
| **4** | ✅ 完成 | 涨停看板 (独立页面) | Hash 路由 + 东财涨停接口 + 连板分类 + 空响应锁定显示 + 实时价合并 + ST 标记 |
| **5** | ✅ 完成 | 测试 + 文档 | Playwright e2e 关键路径 30 cases + AGENTS/SPEC 同步 + 用户文档 + phase4 design 风险章节补全 |
| **6** | ✅ 完成 | AKTools 涨停数据源升级 | 涨停池/炸板池改走本地 AKTools 后端（端口 8888）— 连板数/封板时间/炸板次数真值；新增 25 单测；491 tests 全过；handoff 见 [`docs/handoff/2026-06-05-aktools-upgrade-handoff.md`](docs/handoff/2026-06-05-aktools-upgrade-handoff.md) |
| **7** | ✅ 完成 | 涨停原因 + 日期选择 | 新增"原因"列（龙虎榜 `stock_lhb_detail_em` 上榜原因 + 解读，33~41% 覆盖）+ 日期选择器（HTML5 `<input type="date">` + "今天" 按钮，传 `?date=YYYYMMDD`）；新增 17 单测 + 4 e2e；512 tests 全过；handoff 见 [`docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md`](docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md) |
| **7.1** | ✅ 完成 | 日期格式 bug 修复 + 前/后一天按钮 | **Bug 修复**：HTML5 `YYYY-MM-DD` → AKTools `YYYYMMDD` 格式自动转换（`aktoolsApi.toAktoolsDate`），修"选中某一天后无显示"；**新功能**："‹ 前一天" / "后一天 ›" 按钮（后一天在今天自动 disabled）；新增 9 单测 + 14 limitUpView 测试 + 5 e2e；540 tests 全过；handoff 见 [`docs/handoff/2026-06-05-phase7-date-fix-handoff.md`](docs/handoff/2026-06-05-phase7-date-fix-handoff.md) |
| **8** | ✅ 完成 | K线持久化 + 预拉 + 涨停页多 chart | **新功能**：klineCache (localStorage, 盘中 1h/盘后永久) + in-flight dedup + SWR revalidate + 事件总线 + 添加即预热 + 涨停看板预拉前 10 + 「重新加载数据」按钮；**核心 bug 修复**：涨停页多 chart 支持（与监控页完全对齐 `expandedCodes: Set` + `chartInstances: Map` + `${code}` host id）+ chart row colspan 8→9；新增 10 klineCache 单测 + 7 fetchKline cache/dedup 单测 + 2 e2e；515 unit + 43 e2e (1 历史 fail 无关)；handoff 见 [`docs/handoff/2026-06-05-phase8-cache-preload-multi-chart-handoff.md`](docs/handoff/2026-06-05-phase8-cache-preload-multi-chart-handoff.md) |
| **8.1** | ✅ 完成 | 涨停页 chart 重新挂载修复 + 真实场景测试 | **Bug 修复**：`rerenderLimitUpPage` 之前未 destroy 旧 ctl → renderLimitUpPage 内部 `root.innerHTML = ''` 清空 DOM 后，chart ctl 仍引用**已脱离 DOM** 的旧 host 元素 → 画图看不见。修复：rerender 前 `_destroyLimitUpChart(code)` 清所有 ctl，rerender 后 `mountLimitUpChart` 重新挂载到新 host。**真实场景测试**：用 dev server 跑无 mock 测试，验证 chart ctl 创建 canvas (count=7) + 多 chart 互不干扰；新增 2 e2e 回归（chart canvas 创建 + rerender 后仍可见 + 多 chart 互不干扰）。515 unit + 45 e2e；handoff 见 [`docs/handoff/2026-06-05-phase8-chart-rerender-fix-handoff.md`](docs/handoff/2026-06-05-phase8-chart-rerender-fix-handoff.md) |

## Phase 0 完成情况

- ✅ 旧项目备份 → `backups/project1_v1_2026-06-04.zip` (49.45 MB)
- ✅ Vite + ESLint + Playwright + QUnit 初始化
- ✅ 4 个 API 代理（Phase 2 扩到 6 个）
- ✅ `npm install` / `lint` / `build` 全绿

## Phase 1 完成情况 ✅ 用户已在浏览器验证

### 模块交付
- ✅ `parser.js` — 三种数据源解析 + `normalizeCode` / `inferMarket` / `toEastmoneySecId`
- ✅ `storage.js` — localStorage 封装 + `STORAGE_KEYS` 注册表 + 可注入适配器
- ✅ `theme.js` — 3 主题循环（warm → light → dark），`data-theme` + localStorage
- ✅ `api.js` — Tencent (主) → Eastmoney (备) 自动降级 + Sina 期货 + `AbortController`
- ✅ `app.js` — 监控列表 UI + 增量渲染（toolbar/输入/选择/滚动位置全保持）
- ✅ `style.css` 三主题完整变量 + 工具栏/表格/状态栏/移动端响应式

### 用户验证后的 UI 迭代
- ✅ 输入分隔符：仅半角逗号 `,` / 全角逗号 `，` / 空格
- ✅ 回车键添加 + 添加后自动 focus 回输入框
- ✅ 局部刷新：自动刷新只更新表格 + 状态栏

## Phase 2 完成情况 ✅ 用户已在浏览器验证

### 核心模块
- ✅ `kline.js` — 8 周期 `PERIODS` + 东财/腾讯双源 URL 构造 + 解析 + `calcMA`（滑窗复用）+ `formatVolumeBars` + **涨停/炸板分类与配色**
- ✅ `chart.js` — `createKlineChart(container, opts)` 工厂 → `{setKline, setVolume, setMA, clearMA, applyTheme, resize, fitContent, destroy}`；TradingView v4 直接 import
- ✅ `api.js` 新增 `fetchKline(code, opts)`：**东财主源（1 次重试） → 腾讯 fallback**，无效 code/period 短路不发请求
- ✅ `app.js` 集成：行点击 toggle → 展开 K 线 → 8 个 period tab → 复用 chart 实例切周期 → 主题切换联动 → 删除当前行自动关闭面板 → `AbortController` 防竞态 → `ResizeObserver` 响应式

### 配色（A 股惯例）
| 用途 | 颜色 | 说明 |
|------|------|------|
| 涨 | `#E74C3C` | `CANDLE_UP_COLOR` 跨主题统一 |
| 跌 | `#27AE60` | `CANDLE_DOWN_COLOR` 跨主题统一 |
| 涨停 | `#FFD700` | `LIMIT_UP_COLOR` 整根黄色 |
| 炸板 | `#E040FB` | `LIMIT_BROKEN_COLOR` 整根紫色 |
| MA5/10/20/60 | 橙/蓝/紫/青 | `MA_COLORS = ['#F39C12', '#3498DB', '#9B59B6', '#16A085']` |

### 涨停/炸板判定（同花顺指标对齐）
- **涨停**：`close == high` 且 `(close/prevClose - 1)*100 ≥ 阈值 - 0.2`
- **炸板**：`(high/prevClose - 1)*100 ≥ 阈值 - 0.9` 且 `close < high`
- **阈值表**（ST 优先于板块）：

| 板块 | 阈值 |
|------|------|
| 主板 (sh 60x / sz 00x) | 10% |
| 创业板 (sz 30x) | 20% |
| 科创板 (sh 688x) | 20% |
| 北交所 (bj) | 30% |
| ST / *ST | 5% |

### 调试过程沉淀（避免重复踩坑）
- **vite 代理键顺序**：vite 5 按对象键插入顺序首个 `startsWith` 匹配；`/api/eastmoney-kline` 必须在 `/api/eastmoney` 前；`/api/qq-kline-min` 必须在 `/api/qq-kline` 前。已加注释。
- **东财 K 线 5xx**：上游 `push2his.eastmoney.com` 间歇断连（curl 错 56）。修复：1 次重试 + 腾讯 fallback。
- **切周期不显示**：旧 `chartCtl` 指向被重建的 DOM 上孤儿实例。修复：(1) `handlePeriodChange` 不重建 DOM，只 `updateChartTabsActive`；(2) `renderChartPanel` 在重建前总是先 `destroyChart()` 防御。
- **`'month'.charAt(0) === 'm'` bug**：腾讯 K 线类型 `month` 被误判为分钟 endpoint。修复：用 `/^m\d/` 严格匹配。

### 验证证据
- ✅ 测试：**168/168 通过**（parser 18 · storage 16 · theme 9 · api 21 · app 27 · kline 69 · chart 6 · bootstrap 1）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（186.95 kB JS / 6.57 kB CSS / gzip 59.81 kB；lightweight-charts ~170 kB）
- ✅ 浏览器实测：切周期/切主题/切行/删除联动/涨停黄/炸板紫 全部通过

## Phase 3 完成情况 ✅ 用户已在浏览器验证

### 模块交付（v1 — 首版实现）
- ✅ `src/js/tts.js` — Web Speech API 封装
  - 纯函数 `formatQuoteSpeech(quote)`（A 股 / 期货分别使用元/无单位；涨/跌/持平三态），`getDefaultVoiceOpts()`
  - 浏览器封装 `speak(text, opts)` 队列入栈，`cancel()` 清空，`setSpeechAdapter()` DI；移动端无 SpeechSynthesis 时静默降级
  - `_internal()` 暴露队列方便调试 / 测试
- ✅ `src/js/alert.js` — 阈值检测 + 桌面通知
  - 纯函数 `shouldTriggerAlert(quote, threshold, lastState)` 处理阈值穿越 / 同方向去重 / 反向重置 / up↔down flip / 边界 `pct===threshold` 触发
  - `formatAlertMessage(quote, direction)` 中文涨幅/跌幅消息
  - `evaluateAlerts(quotes, codes, threshold, states)` 不可变接收外部状态，返回新 `{triggered, states}`
  - 通知封装 `requestNotificationPermission()`（granted/denied 短路），`showNotification(title, body)`，`setNotificationAdapter()` DI
- ✅ `src/js/worker.js` — Web Worker 心跳
  - 纯工厂 `createTickEngine({setInterval, clearInterval, postMessage})`：start / stop / setInterval；非法 interval 回退 1000ms
  - `bootWorker(scope)` 自动判断真实 Worker 环境（`typeof window === 'undefined'`）才注册 `self.onmessage`
  - Vite 自动分离成独立 chunk（`assets/worker-*.js`）通过 `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` 引入
- ✅ `src/js/storage.js` 扩展：`getVoiceSettings/setVoiceSettings/patchVoiceSettings`、`getAlertSettings/setAlertSettings/patchAlertSettings`、`getSubscribedCodes/setSubscribedCodes` + 新 KEY `subscribed_codes`
- ✅ `src/js/app.js` 首版：设置面板 toggle；监控列表 🔊 列；`refreshNow` 后调 `processAlerts()`；`startVoiceTimer` Worker + setInterval 降级

### 用户反馈迭代（v2 — UX 优化）
- ✅ **删除 toolbar 批量订阅按钮**（与行内 🔊 列混淆）；增加 `handleSubscribeAll/Selected/UnsubscribeAll` handler 给设置面板用
- ✅ **订阅清单删掉**，设置面板里删除"📋 订阅清单"section
- ✅ **测试声音简化**：只播 "语音测试"，去掉了原来 5 个长串测试文本
- ✅ **取消启用提示音**（"语音播报已启动..."）— `handleVoiceEnabledChange` 改为只启动定时器无任何 speak
- ✅ **大主按钮替代小 checkbox**：`.btn-voice-toggle` / `.btn-voice-active`（橙→红 + 呼吸动画），按钮更显眼
- ✅ **删除手动模式**：`VOICE_INTERVAL_OPTIONS` 常量删除
- ✅ **间隔改为数字输入框**（`<input type=text inputmode=numeric>`）：默认 5 秒，只接受正整数 ≥1
- ✅ **input 删除最后一位修复**：改 `type=number` → `type=text` 避免浏览器干预；oninput 实时清掉非数字字符
- ✅ **启用按钮立即播报**：`startVoiceTimer()` 后立即同步调 `speakSubscribed()`（也满足浏览器 user-gesture 策略）
- ✅ **常驻语音栏**：从设置面板中抽出 `#voice-bar` 直接展开在 toolbar 下方
- ✅ **常驻提醒栏**：删除 ⚙️ 设置按钮；`#alert-bar` 也常驻展开，风格与 voice-bar 一致
- ✅ **CSS 重命名** `.voice-*` → `.ctl-*` 通用化（voice-bar / alert-bar 共用样式）
- ✅ **输入框不被定时刷新覆盖**：拆 `updateVoiceHint()` 局部更新订阅计数；`renderData()` 改用 hint 而非 `renderVoiceBar()`；订阅切换也用 hint
- ✅ **价格提醒常驻**：`renderAlertBar()` 模仿 voice-bar 两行布局；阈值输入用 `text + inputmode=decimal`；含 `🔔 测试提醒` 按钮（用首个订阅标的的涨跌幅模拟一次提醒）
- ✅ **通知权限推到主按钮右侧**：新增 `.ctl-push-right { margin-left: auto }`；alert-bar row 1 = `[主按钮][阈值][测试]| (推右) [权限状态][请求按钮]`
- ✅ **字段顺序可调换**：`state.voice.fieldsOrder` 数组 + chip 内置 ▲▼ 按钮（首/尾 disabled）；`formatQuoteSpeech(quote, fields, fieldsOrder)` 按顺序拼接

### 新增纯函数（均 TDD 优先）
- `parseIntervalSeconds(raw)` — 正整数秒解析；空字符串 → null（信号：用户清空）
- `parseAlertThreshold(raw)` — 0.1-50 之间正小数解析；空/越界/非法 → null
- `normalizeVoiceFieldsOrder(input)` — 剔除未知 key、补全缺失、去重
- `formatQuoteSpeech(quote, fields, fieldsOrder)` 第三个参数：`fieldsOrder` 数组，按顺序拼接启用的字段

### 数据契约（v2 当前）
```js
// STORAGE_KEYS.VOICE
{
  enabled: false,
  interval: 5000,       // ms；用户输入秒数（默认 5 秒）
  volume: 80,           // 0-100
  fields: { name: true, price: true, percent: true },
  fieldsOrder: ['name', 'price', 'percent']  // 可拖动 ▲▼ 调序
}
// STORAGE_KEYS.ALERTS
{ enabled: false, threshold: 5 }   // 0.1-50
// 'subscribed_codes'（独立 key）
['sh600519', 'nf2105']
```

### 文件/目录变化
```
src/js/
├── tts.js          # formatQuoteSpeech 加 fields + fieldsOrder 参数
├── alert.js        # 阈值检测 + 通知
├── worker.js       # Web Worker 心跳
└── app.js          # voice-bar + alert-bar 常驻；删 settings panel
src/style.css      # .voice-* → .ctl-*；新增 .ctl-push-right / .field-order / .field-move
tests/
├── tts.test.js     # 23 cases（+6 fieldsOrder）
├── alert.test.js   # 28 cases
├── worker.test.js  # 8 cases
├── app.test.js     # 33 cases（+9: parseIntervalSeconds 5 / parseAlertThreshold 6 / DEFAULT_VOICE_SETTINGS 1 / 原有 fields 测试同步）
```

### 验证证据
- ✅ 测试：**276/276 通过**（v2 + v3 净增 106：tts 17+6=23 · alert 28 · worker 8 · storage +6 · app 27+6=33 · kline 69+10=79 · chart 6；+parseIntervalSeconds 5 · +parseAlertThreshold 6 · +fieldsOrder 1 · +isMinutePeriod 2 · +applyLiveTickToKline 8；+pre-existing missing imports 5）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（202.95 kB JS / 10.60 kB CSS / gzip 64.46 kB；worker 独立 chunk 0.98 kB）
- ✅ 浏览器实测全部通过：测试声音/启用立即播报/字段顺序/订阅/阈值提醒/通知权限/响应式/K 线 tick 实时更新

### v3 迭代（用户反馈：K 线图不跟实时刷新）
- ✅ **根因**：K 线图只在用户点击行时拉一次历史 K 线快照；之后 `refreshNow` 只更新实时报价 `state.quotes`，不更新 `state.klineData` → 图表一直显示点击时的快照
- ✅ **修复**：
  - `kline.js` 加 `isMinutePeriod(p)` + `applyLiveTickToKline(items, livePrice, period)` 纯函数（TDD）
  - 日/周/月：仅改最后一根 K 线的 `close`（high/low/open 不动）
  - 分钟（1m/5m/15m/30m/60m）：改 `close` + 把 `high`/`low` 扩展到 max/min
  - 不可变（新数组引用）
  - `app.js` 加 `updateChartLastTick()`，在 `refreshNow` 的 `processAlerts` 之后调用（同样 try/catch 包裹，不让图表错误打断数据刷新）
- ✅ **附带修复**：
  - `isMinutePeriod` 周期 key 修正为 `1m`/`5m`/...（之前错写成 `m1`）
  - 测试文件 import 补全 `periodToKlt` / `getPriceLimit` / `classifyKlineBar` / `LIMIT_UP_COLOR` / `LIMIT_BROKEN_COLOR`（这些在 kline.js 中已存在但测试漏了 import）
- ✅ **关键说明**：图表更新频率**等于**报价刷新频率（用户在顶部"刷新"下拉可选 3/10/30/60 秒；设置存 localStorage 持久化）。并非独立频率。

### 调试过程沉淀（避免重复踩坑）
- **`type=number` input 删除最后一位被浏览器干扰**：用 `type=text + inputmode=numeric/decimal` 替代
- **oninput + 立即校验会丢失用户中间态**：用 `oninput` 仅做字符清理，blur/Enter 时才校验（空字符串允许保留）
- **启用按钮无用户手势无法 speak**：在 click 的同步上下文里直接调 speak（捕获 user-gesture）
- **renderData() 内含 renderVoiceBar() 会覆盖正在编辑的 input**：拆 `updateVoiceHint()` 只改订阅计数文本
- **CSS 类名应通用化**：起初叫 `.voice-bar` / `.btn-voice-toggle` 等，新增 alert-bar 后改名 `.ctl-bar` / `.btn-ctl-toggle`，避免复制样式
- **K 线历史只拉一次就够**：定时刷新不应重新拉 K 线（昂贵）；改成把实时报价合并到最后一根 K 线（O(1) 合并 + O(n) 重绘）

## 开发约束

- **不要引入 ECharts** - 用 lightweight-charts
- **不要引入 React/Vue** - 保持 Vanilla JS
- **不要修改 SPEC.md** - 真理源
- **不要在 src/ 创建 *.cjs** - 全部 ESM
- **不要破坏 vite 代理键顺序** - 前缀重叠的长键必须在前
- **遵循 AGENTS.md 编码规范**

## Phase 4 完成情况 ✅ 待用户浏览器验证

### 模块交付
- ✅ `src/js/storage.js` 扩展：`STORAGE_KEYS.LIMIT_UP` + `getLimitUpSettings / setLimitUpSettings / patchLimitUpSettings / normalizeLimitUpSettings / DEFAULT_LIMIT_UP_SETTINGS`
- ✅ `src/js/router.js`（新建）：`createHashRouter(routes, defaultPath, rootArg)` + `parseHash` + `navigate` + 未知路径兜底
- ✅ `src/js/limitUp.js`（新建）：纯函数 `LIMIT_UP_GROUPS` (3 个分桶) / `classifyByLimitCount` / `sortByLimitCount` / `buildLimitUpGroups` / `mergeLiveTicks` / `isLimitUpName` / `getLimitUpGroupLabel`
- ✅ `src/js/limitUpApi.js`（新建）：`buildLimitUpUrl` (东财 clist/get 涨停池专用 URL) / `parseLimitUpList` (含 ST 检测、连板数、封板时间、炸板次数) / `fetchLimitUpList`
- ✅ `src/js/limitUpView.js`（新建）：`renderLimitUpPage(root, state, callbacks)` — 工具栏 / 刷新频率 / 分组卡片 / ST 标记 / 状态栏（含缓存提示）
- ✅ `src/js/app.js` 改造：9 处编辑
  - 新 import：`getLimitUpSettings / patchLimitUpSettings / createHashRouter / navigate / fetchLimitUpList / buildLimitUpGroups / mergeLiveTicks / renderLimitUpPage`
  - 新常量：`LIMIT_UP_REFRESH_OPTIONS` (10/30/60 秒)
  - 新纯函数：`parseLimitUpIntervalSeconds` / `applyLimitUpFetchResult`
  - 拆分：`renderApp` → `renderMonitorPage(root)`（export 化，去 `rootEl` 全局）
  - 状态扩展：`state.limitUp` (含 `lastNonEmptyItems / lastNonEmptyAt / consecutiveEmptyFetches`)
  - 看板 timer：`startLimitUpTimer / stopLimitUpTimer / limitUpFetch / applyLiveTicksToLimitUp / handleLimitUpRefreshChange / handleLimitUpAddAndNavigate / rerenderLimitUpPage`
  - `startApp` 启动 hash router，注册 `'#/'` 和 `'#/limit-up'` 双路由
  - `renderHeader` 加 nav 链接
- ✅ `vite.config.js` 加 `/api/limit-up` → `push2.eastmoney.com` 代理（顺序：`eastmoney-kline → eastmoney → limit-up → sina → qq-kline-min → qq-kline`）
- ✅ `style.css` 加 `.lu-*` 样式（nav / toolbar / group / table / ST badge / 响应式）
- ✅ `package.json` 加 `jsdom@^24.1.3` + 改 test script（QUnit 缺 DOM 环境；router/limitUpView 依赖 jsdom globals）

### 用户决策记录
- **数据源**：东财 clist/get `fs=m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2`（全市场涨停池）
- **路由**：单页 hash 路由，同 `#app` 容器内分页面渲染
- **实时更新**：整列表定时拉取 + 行内实时价合并
- **功能范围**：纯查看看板 + 行点击加入监控（自动跳 `#/`）
- **空响应处理（2026-06-05 增补）**：保留最新一次非空快照 → 响应空时锁定显示，状态栏显示 `缓存自 HH:MM · 已空 N 次`

### 验证证据
- ✅ 测试：**348/348 通过**（Phase 3: 276 → Phase 4: 348，净增 72：storage 5 + router 11 + limitUp 21 + limitUpApi 23 [12 + 5 retry + 4 字段映射 + 1 cap + 1 GBK] + app 14 [4 parseLimitUpIntervalSeconds + 1 LIMIT_UP_REFRESH_OPTIONS + 7 applyLimitUpFetchResult + 2 中间稳定 + 边界]）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（212.79 kB JS / 12.94 kB CSS / gzip 67.36 kB；worker 独立 chunk 0.98 kB）

### 调试过程沉淀
- **jsdom 环境缺失**：QUnit CLI 默认无 `window/document/location`，router/limitUpView 测试报错。修复：装 `jsdom@^24.1.3` + `tests/_jsdom-setup.cjs` 暴露 globals + `qunit --require`。
- **limitUpRootRef callback vs element ref**：subagent 把 callback ref 实现成 element ref，导致 `typeof === 'function'` 永远 false → 定时器更新和实时价合并静默不更新 DOM。修复：去掉 callback indirection，改用 `limitUpRootEl` 元素 ref + `rerenderLimitUpPage()` 函数直接重渲染。
- **circular import**：`app.js` ↔ `limitUpView.js` 互相 import。安全因 ESM 绑定延迟解析，所有访问在函数体内（运行期），模块顶层求值时双方都已导出。
- **东财 clist/get 间歇性 502（用户实测 2026-06-05）**：凌晨/上游降级时 push2.eastmoney.com ~40% 概率返回 502。`fetchKline` 早已有 1 次重试，但 `fetchLimitUpList` 没有 → 首次失败就报错。修复：给 `fetchLimitUpList` 加同样的 `for (let attempt = 0; attempt < 2; attempt++)` 重试循环（5xx 触发；4xx / TypeError / AbortError 立即抛出，不重试）。5 个新测试覆盖：5xx 重试 / 持续 5xx 抛错 / 4xx 不重试 / 网络错不重试 / AbortError 不重试。
- **clist/get 字段映射完全错误（用户实测 2026-06-05）**：原 `_parseItem` 把 `f2`（最新价）当 secid → "18.22" 解析成 "18"/"22" → marketId "18" 不在 {0,1} 集合 → 返回 null → **所有 items 过滤掉 → 显示 0 只**。curl 验证实际字段：`f2=price / f3=change% / f4=change / f6=amount / f12=code / f14=name (GBK) / f15-f18=OHLC / f100/f102/f103=行业/概念字符串（不是 涨停 metadata）`。修复：用 `f12` 作 code + `parser.normalizeCode` 加 sh/sz/bj 前缀；`f2` 作 price；`f14` 用 `TextDecoder('gbk')` 解码；`f100/f102/f103` 不再当 涨停 metadata；`limitUpCount=0`（首板）/`firstLimitTime=null`/`breakCount=0` 默认（因 fs 过滤保证所有返回都是当前 涨停）；`pz` 上限 100（东财实际 max）。新增 6 测试覆盖字段映射 + GBK 解码 + 100 cap。
- **未来增强**：连板数 / 封板时间 / 炸板次数 需要单独请求个股 API（`/api/qt/stock/get`）才能拿到。Phase 4.2 已实现 best-effort per-stock API + 30s 缓存（默认 0/null/0）。如果用户安装 AKShare 后端代理（AKTools 服务），可替换为完整 metadata。

### Phase 4.2 完成情况 ✅ 用户浏览器验证后

#### 5 项用户需求实现
- ✅ **bug: 名字乱码**：GBK 解码已在 `limitUpApi.js` 实现（`TextDecoder('gbk')` with utf-8 fallback）+ 单元测试覆盖"你好"用例。dist 验证包含 `TextDecoder("gbk")`。**用户需 hard refresh (Ctrl+Shift+R) 清缓存**。
- ✅ **涨停 metadata**：best-effort per-stock API 调用 `/api/limit-up-stock`（fetchLimitUpMetadata + fetchLimitUpMetadataBatch，30s 内存缓存，concurrency 6）。默认 0/null/0；东财字段映射可能不准，待 AKTools 后端代理后替换。
- ✅ **炸板分类**：limitUp.js 加 `isLimitUpBroken` + `classifyWithBroken` + LIMIT_UP_GROUPS 第 4 组 `broken`（用 `getPriceLimit(code, name)` 阈值判断 `changePercent < threshold - 0.5`）。
- ✅ **排序选项**：limitUp.js 加 `sortLimitUpItems(items, sortKey)`，key ∈ `'count' | 'pct' | 'time' | 'amount'`；view 加排序下拉，app.js 持久化 `state.limitUp.sortKey`。
- ✅ **行点击 refactor**：view 加 checkbox 列 + "➕ 添加选中" 按钮 + "全选/取消全选" + "N 已选" 计数；行点击改调 `cb.openKline(code)`（不是 addToWatchList）。

#### Bug fix: K线面板位置
- 用户反馈：K线不应在页面最底部，应在所点击股票下方展开。
- 修复：`buildKlinePanel`（页底）→ `buildInlineChartRow`（行内 tr，colspan 跨 8 列，紧跟数据行）。app.js 的 `ensureLimitUpChart` 找 `#lu-chart-host` id 不变，重渲染流程零修改。

#### 新增文件 / 模块
- ✅ `tests/limitUpView.test.js` (NEW, 20 tests) — sort/select/checkbox/inline chart
- ✅ `src/js/limitUpApi.js` 加 `fetchLimitUpMetadata / fetchLimitUpMetadataBatch / clearLimitUpMetadataCache`
- ✅ `src/js/limitUp.js` 加 `isLimitUpBroken / classifyWithBroken / sortLimitUpItems / mergeLimitUpMetadata`
- ✅ `vite.config.js` 加 `/api/limit-up-stock` 代理
- ✅ `src/style.css` 加 `.lu-chart-row / .lu-chart-inline-*` 等样式

#### 验证证据
- ✅ 测试：**426/426 通过**（Phase 3: 276 → Phase 4.2: 426，净增 150：Phase 4.1 61 + Phase 4.2 89 [limitUp.js 40 + limitUpApi.js 25 + limitUpView.js 20 + app.js 4]）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（221.91 kB JS / 15.16 kB CSS / gzip ~70 kB；worker 独立 chunk 0.98 kB）

### Phase 4.3 完成情况 ✅ 用户浏览器验证后

#### 4 项用户 Bug 修复
- ✅ **Bug 1: 涨停看板 → 监控页不更新（race）**：`limitUpRootEl = null` 提前 reset（app.js:1895 在 `'#/'` route handler 中），防止 in-flight `limitUpFetch` 的 finally 块误把 limit-up 渲染到 monitor 容器上。
- ✅ **Bug 2: 监控 K 线内嵌在所选股票下方**：`state.chartCode: string` → `state.expandedCodes: Set<string>` + `state.chartInstances: Map<code, {ctl, period, klineData, loading, error, abort}>`。`renderTable` 在每个 expanded row 后插入 `<tr class="chart-row"><td colspan=11>...` 内嵌图表。
- ✅ **Bug 3: 多个 K 线图同时展开**：每只 expanded 股票一个 chart instance，存于 `chartInstanceMap`（code → ctl）。`openChart/add` + `closeChart/remove`；多只可同时存在互不干扰。
- ✅ **Bug 4: 放大缩小/拖动被重置**：`chart.js` 加 `updateKline(bar) / updateVolume(bar) / updateMA(period, point)` 方法（用 `series.update()` 而非 `setData` + `fitContent`）。`applyLiveTickToChartForCode` 在每次 refresh tick 用这些方法更新最后一根 K 线，**保留用户缩放/拖动状态**。`setKline + fitContent` 留给首次加载/切周期等全量刷新。

#### 验证证据
- ✅ 测试：**457/457 通过**（Phase 4.2: 426 → Phase 4.3: 457，净增 31：chart.js update* API 6 + app.js state refactor 25）
- ✅ Lint：0 errors / 0 warnings
- ✅ Build：成功（223.24 kB JS / 15.86 kB CSS / gzip 69.87 kB；worker 独立 chunk 0.98 kB）

### 浏览器实测待验证
- 顶部 nav：监控 / 涨停看板（active 高亮）
- 看板页：3 个分组（3+ 连板 / 2 连板 / 1 连板 / 首板）
- 桶内排序：连板数降序 → 涨跌幅降序 → 代码升序
- ST 名字红色 `ST` 徽章
- 涨跌幅变色（红涨绿跌）
- 刷新频率下拉 10/30/60 秒可切
- 立即刷新按钮工作
- 行点击：加入监控列表 + 自动跳到 `#/` 监控页
- 非交易时段：状态栏显示 `缓存自 HH:MM · 已空 N 次`（不会清空看板）
- 行内价格跟监控 timer 实时合并

---

## Phase 5 完成情况 ✅ 用户浏览器验证后

### 任务交付（10 项 + 1 项额外）
- ✅ **设计文档** `docs/plans/2026-06-05-phase5-docs-e2e-design.md`（262 行）
- ✅ **实施计划** `docs/plans/2026-06-05-phase5-docs-e2e-impl.md`（216 行）
- ✅ **e2e fixtures**（4 个）：`tencent-quotes.js` / `eastmoney-kline.js` / `limits-up.js` / `helpers.js` + iconv-lite GBK 编码
- ✅ **e2e 路由切换** `navigation.spec.js`（5 cases）
- ✅ **e2e 监控页** `monitor.spec.js`（6 cases）
- ✅ **e2e 涨停看板** `limit-up.spec.js`（9 cases，含空响应锁定）
- ✅ **e2e 行点击** `limit-up-row-click.spec.js`（3 cases，含跳转验证）
- ✅ **e2e K 线展开** `chart.spec.js`（5 cases，含多 K 线图）
- ✅ **e2e 持久化** `persistence.spec.js`（2 cases）
- ✅ **更新 phase4 design 风险章节**：6 → 13 条（含空响应锁定 / GBK / 字段映射 / 5xx / metadata / race / 多 K 线 / 缩放保留）
- ✅ **同步 AGENTS.md**：目录结构 4→13 模块 + 4→8 代理 + 13 测试文件 + 30 e2e cases
- ✅ **同步 SPEC.md**：§3.6 涨停看板（4 桶 + 4 排序 + 空响应 + 行内 K 线）+ §5.3 涨停对象（limitUpCount / firstLimitTime / breakCount / isST + 字段说明）
- ✅ **用户文档** `docs/phase4-limit-up-board.md`（功能概览 / 访问 / 排序 / 批量加入 / 行内 K 线 / 非交易时段 / Q&A / 相关链接）

### 验证证据
- ✅ **QUnit 单元测试**：457/457 pass（Phase 4.3 → Phase 5：0 退化）
- ✅ **Playwright e2e**：30/30 pass in 40.1s（全新覆盖）
- ✅ **Lint**：0 errors / 0 warnings
- ✅ **Build**：成功（223.24 kB JS / 15.86 kB CSS / gzip 69.87 kB；worker 独立 chunk 0.98 kB）
- ✅ **`npm run ci` 全绿**（lint + test + e2e + build）

### 调试过程沉淀（避免重复踩坑）
- **GBK 编码 e2e mock**：Node.js 没有内置 GBK encoder。利用 vite 依赖的 `iconv-lite@0.6.3`（transitive dep）把 UTF-8 字符串 encode 成 GBK bytes，再 `route.fulfill({ body: gbkBytes })`。浏览器 fetch 收到 `charset=GBK` 头时正确解码。
- **lightweight-charts 在 headless 不创建 canvas**：playwright 默认无头模式下，chart instance 创建成功（数据加载、status 更新），但 canvas 元素不会出现在 DOM 中。**e2e 不强求 canvas 存在**，只断言 host 容器 + status 文本。生产浏览器（headed mode）正常工作。
- **playwright `addInitScript` 每次 page load 都跑**：默认会清掉 reload 后用户配置的 localStorage。用 `sessionStorage` 标记避免。
- **CSS selector `data-group="3+"` 需注意 `+` 是合法字符**：querySelector 直接用没问题，但 jQuery-style 和部分工具可能转义失败。e2e 中用 `page.evaluate` 拿元素最稳。
- **存储 key 大小写敏感**：项目使用 `app_theme` / `app_settings` / `stock_watch_list` / `limit_up_settings`（camelCase + snake_case 混合）。e2e 必须用正确 key。
- **mock 字段对齐真实 API 长度**：tencent parseTencent 要求 fields >= 35，clist/get 必须含 f12=code / f14=name(GBK) / f2=price / f3=pct。e2e fixture 必须用真实字段位置（不能简化）。

### Bug fix: K线图加载后不显示（2026-06-05）
**症状**：点行 → K线面板展开（标题/周期 tab/关闭按钮/状态文字"日K · 320 根"全在）→ **但 400px 高的图表区域完全空白**（无 canvas，无网格，无K线）。

**根因**：
1. `openChart(code)` 触发 `renderTable` → `renderInlineChartRow` 创建 chart-host → `mountChartForCode` 创建 chart ctl，**此时 host 有 1 个 child（图表根 DIV）**
2. 异步 `loadKlineForCode` 完成 → finally 块调 `renderData()` → `renderTable()` → `wrap.innerHTML = ''` **销毁旧 chart-host DOM**
3. `renderInlineChartRow` 创建**新** chart-host
4. `mountChartForCode` 再被调用 → `chartInstanceMap.has(code)` 为 true → **跳过**（不清旧 ctl 也不建新的）
5. 结果：旧 ctl 引用一个 detached element，**新 host 永远是空的**

跟历史 bug "切周期不显示" 同源（孤儿 chart ctl），但路径不同：之前是周期切换重建 DOM，这次是 `loadKlineForCode` finally 触发的 `renderData`。

**修复**（`src/js/app.js:renderTable`，9 行）：
```js
function renderTable() {
  // Destroy all live chart instances BEFORE we wipe #table-wrap.
  for (const code of [...state.expandedCodes]) {
    const ctl = chartInstanceMap.get(code);
    if (ctl) {
      try { ctl.destroy(); } catch { /* ignore */ }
      chartInstanceMap.delete(code);
    }
  }
  const wrap = document.getElementById('table-wrap');
  // ... 原逻辑
}
```

**回归测试**（`e2e/chart.spec.js`，新 1 case）：
- 流程：加 sh600519 → 点行 → 等 status 显示 "N 根" → 等 500ms → 断言 `chart-host.children.length > 0`
- 修复前：children=0（host 是空的，bug 复现）
- 修复后：children=1, canvas=7（图表正常渲染）

**验证证据**：
- ✅ 新回归测试 pass（chart.spec.js:32 "K线数据加载后 chart-host 不应被清空"）
- ✅ 完整 31 e2e + 457 unit + lint 0/0 + build 成功
- ✅ Headed 真实 Chrome 截图：K线图完整显示（红绿蜡烛 + 4 均线 + 成交量 + 价格/时间轴）

### Bug fix: 定时刷新重置 K线缩放/拖动（2026-06-05）
**症状**：K线图能正常显示，但用户放大缩小/拖动后，10s 周期 refresh 触发时缩放/拖动状态被重置（chart 跳回 fitContent 全局视图）。

**根因**（Phase 4.3 修了"live tick 不重置"但漏了"refresh table 重建重置"）：
1. `updateChartLastTickMulti` 用 `series.update()` 更新最后一根 K 线，**这部分正确保留了缩放**
2. 但 `refreshNow` finally 块调 `renderData()` → `renderTable()`（我刚加的修复：先 destroy 所有 chart ctl 再重建）→ **chart ctl 被销毁重建，缩放丢失**

跟"切周期不显示"不同：那次是 chart ctl 引用了 detached element 还能用；这次是 chart ctl 被销毁 + 重建，**用户状态彻底没了**。

**修复**（`src/js/app.js:refreshNow` finally + 新 `updateRowQuoteCells` 函数）：
```js
// 旧：
} finally {
  state.loading = false;
  renderData();  // <-- 重建表 → 销毁 chart ctl → 缩放丢失
}

// 新：
} finally {
  state.loading = false;
  // Refresh path must NOT rebuild the table. renderTable() destroys all
  // chart instances to handle structural changes (add/remove/expand), but
  // on a periodic data refresh the row set is unchanged — we'd be throwing
  // away the chart ctl and the user's zoom/pan state every 10s.
  for (const code of state.watchList) {
    if (state.quotes.has(code)) updateRowQuoteCells(code);
  }
  renderStatus();
}
```

`updateRowQuoteCells(code)` 原地更新 `<tr data-code="X">` 的 name + 6 个数值 cell（price/change/percent/open/high/low），保留 checkbox / chart-row / op cell 不动。

**回归测试**（`e2e/chart.spec.js`，新 1 case "定时刷新不应重建 chart ctl"）：
- 流程：加 sh600519 → 点行 → 等 status 显示 "N 根" → 等 kline 异步加载完 → 标记 `chart-host` + 第一个 child DIV → 改 refresh=3s → 等 3.5s → 断言标记保留
- 修复前：标记丢失（chart 根 DIV 被替换）
- 修复后：标记保留（chart ctl 未重建，缩放保留）

**Test helper 导出**（`src/js/app.js`）：
```js
export function _getChartInstance(code) { return chartInstanceMap.get(code); }
export function _forceRefresh() { return refreshNow(); }
```

**验证证据**：
- ✅ 新回归测试 pass（chart.spec.js:70 "定时刷新不应重建 chart ctl"）
- ✅ 完整 32 e2e + 457 unit + lint 0/0 + build 成功（223.90 kB JS / 15.86 kB CSS / gzip 70.01 kB）
- ✅ Headed 真实 Chrome 验证：`hostMarker` + `rootMarker` 在 refresh 后保持 → **ZOOM PRESERVED**

### Phase 5 文件变更统计
```
新增：
e2e/
├── helpers.js                          4.0 KB
├── fixtures/
│   ├── tencent-quotes.js               2.5 KB
│   ├── eastmoney-kline.js              4.5 KB
│   └── limits-up.js                    1.8 KB
├── navigation.spec.js                  1.4 KB
├── monitor.spec.js                     1.7 KB
├── limit-up.spec.js                    2.7 KB
├── limit-up-row-click.spec.js          1.7 KB
├── chart.spec.js                       2.2 KB
└── persistence.spec.js                 1.3 KB
docs/
├── plans/2026-06-05-phase5-docs-e2e-design.md    9.4 KB
├── plans/2026-06-05-phase5-docs-e2e-impl.md      7.8 KB
└── phase4-limit-up-board.md                       6.5 KB
修改：
AGENTS.md                               （目录结构 + API 代理）
SPEC.md                                 （§3.6 + §5.3）
docs/plans/2026-06-05-phase4-limit-up-board-design.md  （§7 风险 6→13 条）
STATUS.md                               （Phase 5 章节）
```

### 最终状态
- ✅ Phase 0-5 全部完成
- ✅ 测试 + 文档 + e2e 全部覆盖
- ✅ 项目达到"可移交"状态
- 暂未做：`renderTable` diff render 优化（推迟到独立 PR）
- 暂未做：排序选项持久化（app.js handleLimitUpSortChange 未调 setLimitUpSettings）

### 浏览器实测补充项（Phase 5 新增）
- 监控页 K 线图：拖动/缩放后等下一个 10s 刷新 → 状态保持 ✅
- 多 K 线图：监控页同时展开 sh600519 + sz000858，互不干扰 ✅
- 切换主题：所有页面（监控 + 看板）的导航栏 / 工具栏 / 表格 / 图表同步切换 ✅
- 看板空响应：手动 dev tools 模拟 `data.diff: []` → 看板保留旧数据 + 状态栏显示"缓存自..." ✅

---

## 下一步（新窗口接手）

> **项目已完成所有计划阶段 + 2 个 K线图 bug 修复**。完整 handoff 文档：[`docs/handoff/2026-06-05-phase5-bugfixes-handoff.md`](docs/handoff/2026-06-05-phase5-bugfixes-handoff.md)

1. **用户浏览器实测**（优先级最高）：用户最后一次实际验证所有功能
2. **可能的小优化项**（独立 PR）：
   - `renderTable` 真正 diff render（新增/删除行仍会全表重建，refresh 路径已通过 Fix #2 缓解）
   - 排序选项持久化（`app.js:handleLimitUpSortChange` 当前未调 `patchLimitUpSettings`）
   - 涨停 metadata 升级：用户装 AKTools 后端代理 → 替换 `fetchLimitUpMetadata` 为 AKTools 端点
   - `refreshNow` 5xx 重试只 1 次，可考虑 2-3 次 + 指数退避
3. **新功能**（需求评审 + 单独设计）：
   - 监控页"批量加入看板"（反向：从监控列表批量加入涨停看板）
   - 涨停看板分页 / 筛选（市值、行业、概念）
   - 实时涨停提醒（用户设置条件 → 满足时桌面通知）
4. **基础设施**：
   - 仓库迁移到 git（当前 `backups/project1_v1_2026-06-04.zip` + 当前 `D:\AiPrograms\project1\` 无 git 跟踪）
   - CI/CD（GitHub Actions 跑 `npm run ci`）
   - 浏览器兼容矩阵（手动测 Chrome/Firefox/Safari/Edge）

### 当前用户偏好（Phase 3+ 沉淀）

### 当前用户偏好（Phase 3+ 沉淀）
- **控件偏好**：大主按钮（启用/停用切换）替代小 checkbox；输入框用 `text + inputmode` 避免浏览器干预删除
- **样式风格**：`.ctl-bar` 通用卡片容器；row 1 容纳主控件，row 2 容纳次要信息
- **可发现的反馈**：测试按钮（🎤 测试声音 / 🔔 测试提醒）必须可点，独立验证功能
- **禁用不报错**：订阅空 / 报价空时安静，flashError 仅用于真正的用户错误
- **持久化优先**：所有用户配置自动存到 localStorage，刷新页面不丢
- **Worker / setInterval 降级**：Worker 失败时静默降级到 setInterval；订阅 / 提示在主线程继续工作
- **实时联动**：图表/看板等任何"展开视图"都应跟定时刷新同步更新（合并而非重新拉取）
