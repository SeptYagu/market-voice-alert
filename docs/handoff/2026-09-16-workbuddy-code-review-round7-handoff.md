# 国际品种接入方案 WorkBuddy 独立审查 round 7 复查报告

> **结论**：**未通过（2×P1 + 2×P3）**
> 被审 HEAD：`8a05917ea4a8a2cd77f044e9c6fcd3e9e07594b6`
> 基准提交：`45593a5522343c1ed56725f841b16760f80217b7`
> 本轮实际审查增量：`5e01a90..8a05917` = 3 文件 / +42 −21（纯文档，主方案 316 行）
> 审查日期：2026-09-16

---

## 一、审查基本信息与通过项简述（≤10 行）

- 版本核验：分支 `main` 已配置上游 `origin/main`、工作区干净、`git pull --ff-only` 返回 `Already up to date`；实际 HEAD `8a05917ea4a8a2cd77f044e9c6fcd3e9e07594b6` 与任务给定待审 SHA **完全一致**，`45593a5` 为其祖先；diff 仅含 `STATUS.md`、`docs/handoff/INDEX.md` 与 7 份 `.md`（无产品代码/测试改动）。
- Round 6 三项缺陷**主项均已闭环**：§3.1.2 行 5 已枚举 `f43/f44/f45/f46/f60/f169`（`:164`）；已纳入 `(d.f107, d.f57)` 反查 `globalCatalog` 输出 `GL_*` 与 `type='futures_global'`（`:164`、`:304`）；§2.1 字段 2/3 已回改为「买一价/卖一价」（`:37-38`，本轮真源实测 `hf_CL` 第 2/3 位 `99.900/99.910` 夹住最新价、`hf_HSI` `24687/24689` 夹住 `24686.7`，确为买卖价）；待确认风险 1（`proxyService.js`）已补列；`§1.1 §3.2` 引用已校准。
- 另核验：§3.1.1 既有导出断言块在本轮独立实跑 **9/9 PASS**；§3.1.2 清单 11 行的 `文件:行号` 逐条 `awk` 复原**全部相符**（`utils.js:76-86`、`marketData.js:18-22/160/194`、`proxyRoutes.js:10/13`、`proxyService.js:10/31`、`klineService.js:40/95`、`parser.js:11-25/42/64/93-127/106-107/129`、`api.js:30-31/52/66`、`kline.js:210/218/232/326-341/347/360-367`）；A50 端点单位结论本轮真源复测成立（`qt` 全价格字段 ×0.1 与同源 `trends2`、新浪逐项同级一致）。
- 独立设计并执行 4 组探针（10 品种端点缩放比值、`decideVoiceSchedule` 22:00/16:00 真实模块时钟注入、`isFutureCode`/`toEastmoneySecId` 全形态、新浪字段逐位），其中 **3 组命中缺陷**（见第二节）。

---

## 二、审查发现与缺陷清单

### P1-1 §3.1.1 端点报价单位登记表对 8 个非 A50 品种失真、§3.1.2 行 5 与 §5 断言仅覆盖 A50 → 按方案实施后 5–6 个首批品种价格错 10–100×

- **严重级别**：P1
- **文件与行号**：
  - 缺陷文本：`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:99-106`（§3.1.1 表 `GL_CL0/GC0/SI0/HG0/NG0/NQ0/ES0/YM0` 八行的「端点报价单位 (东财qt:东财trends:新浪)」列**全部**登记为 `1:1:1 (均为 1 点)`）
  - 实施指令：同文件 `:164`（§3.1.2 行 5 只规定 `GL_A50` 的 `÷10`；本轮编辑**删除了**原「其余外盘与港美标的按自身口径解析」）
  - 验收断言：同文件 `:303`（§5「全价格字段同级归一化」只枚举 A50 的 `price/prevClose/open/high/low`）、`:299`（「secid 有效性」只校验取数成功，对缩放错误零判别力）
  - 代码落点：`src/js/parser.js:91`（`div100`）、`:97-99`（`price/prevClose/open`）、`:101`（`change`）、`:114-115`（`high/low`）
- **触发条件**：按 §3.1.2 行 5 字面实施（仅 A50 用 `÷10`，其余 9 品种沿用既有 `div100`），且外盘实时报价走 §3.4.1 指定的东财 `qt/stock/get?secid=...`。
- **实际行为与期望行为**：同一 secid、同一时刻以 `qt/stock/get` 与 `trends2` 取数（`push2delay.eastmoney.com`，2026-09-16 两轮独立采样，比值两轮逐项完全一致）：

  | 内部代码 | 东财 secid | `qt.f43` | 同源 `trends2` 末根 | 比值 | **真实所需除数** | 沿用 `div100` 的输出 | 误差 | 登记行是否正确 |
  |---|---|---|---|---|---|---|---|---|
  | `GL_CL0` | `102.CL00Y` | 10445 | 104.45 | 100 | ÷100 | 104.45 | — | ✓ |
  | `GL_GC0` | `101.GC00Y` | 43717 | 4371.7 | 10 | **÷10** | **437.17** | **10×** | ✗ |
  | `GL_SI0` | `101.SI00Y` | 65060 | 65.06 | 1000 | **÷1000** | **650.60** | **10×** | ✗ |
  | `GL_HG0` | `101.HG00Y` | 64865 | 6.4865 | 10000 | **÷10000** | **648.65** | **100×** | ✗ |
  | `GL_NG0` | `102.NG00Y` | 2903 | 2.903 | 1000 | **÷1000** | **29.03** | **10×** | ✗ |
  | `GL_NQ0` | `103.NQ00Y` | 2908461 | 29084.61 | 100 | ÷100 | 29084.61 | — | ✓ |
  | `GL_ES0` | `103.ES00Y` | 767222 | 7672.22 | 100 | ÷100 | 7672.22 | — | ✓ |
  | `GL_YM0` | `103.YM00Y` | 52579 | 52579 | 1 | **÷1** | **525.79** | **100×** | ✗ |
  | `GL_A50` | `104.CN00Y` | 143710 | 14371 | 10 | ÷10（已登记） | 1437.10 | — | ✓（本轮修复） |
  | `GL_HSI` | `134.HSI_M` | 24682 | 24682 | 1 | **÷1** | **246.82** | **100×** | 语义正确但无实施指令 |

  （第二轮采样：`CL 10454/104.45`、`GC 43702/4370.2`、`SI 65040/65.040`、`HG 64830/6.4830`、`NG 2903/2.903`、`NQ 2908550/29085.50`、`ES 767305/7673.05`、`YM 52585/52585`、`A50 143750/14375.0`、`HSI 24689/24689`，比值与首轮逐项相同）

  即：东财 `qt` 端点在同一解析入口下的原始缩放**逐品种不同**（0.0001 / 0.001 / 0.01 / 0.1 / 1 共 5 档，恰为各品种最小报价单位）。沿用既有 `div100` 会使 `GL_GC0/SI0/HG0/NG0/YM0/HSI` 六个品种的 `price/prevClose/open/high/low/change` 全部错 10–100×，经 `state.quotes` → 自选表、TTS、K 线图涨跌与限价带全链路用户可见。期望：登记表应给出「东财 qt 侧的原始单价」，实施指令应按注册表**逐品种**归一化。

- **交叉源佐证（同时刻新浪）**：`hf_GC` 4373.530、`hf_SI` 65.087、`hf_YM` 52572.060、`hf_HSI` 24686.700、`hf_CHA50CFD` 14375.400 均与「÷10 / ÷1000 / ÷1 / ÷1 / ÷10」后的端点值同级一致（差值 ≤0.5%，属合约月差），证明 `trends2` 一侧为「点」、`qt` 一侧为「品种最小报价单位整数倍」，**登记表 `1:1:1 (均为 1 点)` 对 `qt` 侧不成立**。
- **附加（同一缺陷的第二实例）**：`GL_HG0` 的**新浪备源与东财不同单位** —— 同时刻新浪 `hf_HG` 以「美分/磅」报价 `649.300`，东财 `101.HG00Y` 以「美元/磅」报价 `6.4865`，相差 **100×**；与 §3.1.1 HG 行登记的「东财trends : 新浪 = 1:1」及 §3.4.2`:248`「主源与备源切换时价格基准精确无缝对接，无需在切换逻辑中嵌入特殊分支」直接冲突。
- **根因**：单位契约的登记粒度仍是「端点」，但实测显示 `qt` 端点在**同一 secid 下**的原始缩放逐品种不同。Round 6 的修复把覆盖范围由 3 个字段扩到 6 个字段（解决了 A50 **内部**的字段级不一致），同时删除了仅有的横向兜底句「其余外盘与港美标的按自身口径解析」，使其余 9 个品种在方案正文中再无缩放指令；新增的 §5 数值断言只对 A50 生效 → 与 Round 6 报告 P2-1 的根因（**登记粒度 vs 实施粒度不一致**）同源同形态，横向未闭环。（注：`:99-106` 八行的 `1:1:1` 文案自 Round 5 起未再回真源复测，本轮修改行 5 时亦未同步复核。）
- **影响范围**：按字面实施后 5–6 个首批品种的实时报价、派生涨跌幅、自选表/TTS/K 线全部数值错误 10–100×；`GL_HG0` 的备源切换另有 100× 单位差；§5:299 的「三端点可取数」断言与 §5:303 的 A50 断言对上述错误**零判别力**。
- **复现方法/运行证据**：`node` 探针用 `https` 直连 `push2delay.eastmoney.com`，对 10 个 secid 同时取 `qt/stock/get?fields=f43,f44,f45,f46,f60,f57,f107,f169` 与 `trends2/get?...&ndays=1`，输出 `qt.f43 / trends2末根`（见上表两轮），并以 `hq.sinajs.cn/list=hf_*`（带 `Referer`，GBK 解码）交叉校验。
- **修复建议**：① §3.1.1 表新增「东财 qt 原始单价 / 真实除数」列并逐品种回填（`CL/NQ/ES=÷100`、`GC/A50=÷10`、`SI/NG=÷1000`、`HG=÷10000`、`YM/HSI=÷1`）；② §3.1.2 行 5 改为「按 `globalCatalog` 登记的 per-product `qtScale` 逐品种归一化」，并恢复「其余外盘与港美标的按注册表自身口径解析」的显式指引；③ §3.1.1 HG 行补充「新浪 `hf_HG` = 东财 × 100（美分/磅 vs 美元/磅）」，§3.4.2 的「无需特殊分支」改为「备源基准按注册表的 `sinaScale` 重校」；④ §5 断言改为遍历 10/10 品种：`qt.f43 × qtScale == trends2 末根`（容差 ≤0.2%）、`qt.f60 × qtScale == trends2.preClose`（误差 0）、`qt.f4x × qtScale == 新浪对应字段`（容差 ≤0.5%）。
- **修复后验收标准**：10/10 品种在 §5 断言下通过；把任一品种的 `qtScale` 改错一个数量级，对应用例**必须转红**；`GL_HG0` 的主备源切换在 `sinaScale` 登记后不再出现 100× 跳变。

### P1-2 §3.2.2「绝不误关语音」在 `voiceSchedule.js:28` 的 `!futures.length` 分支处不成立；§5 的「会话与语音隔离断言」对该分支零判别力；全仓改造点清单未纳管 `marketSession.js` / `voiceSchedule.js`

- **严重级别**：P1
- **文件与行号**：
  - 文档：`:219`（§3.2.2「只要自选池中有**任一标的**处于交易时段（`anyTrading`），全局语音状态机**绝不进入 autoStop 关闭**」）、`:220`（「在北京时间 22:00…绝不播报『已收盘』，**绝不误关语音**」）、`:312`（§5「会话与语音隔离断言：在北京时间 22:00 注入自选 `['sh600519','GL_CL0']`，断言调度器输出 `pause=false, autoStop=false`…」）、`:156-171`（§3.1.2「全链路改造点清单（覆盖全仓 11 处真实行号与消费点）」中**无** `marketSession.js` / `voiceSchedule.js`）
  - 代码落点：`src/js/services/voiceSchedule.js:12`（`const futures = list.filter(isFutureCode)`）、**`:28`**（`if (cfg.enabled && enabled && !futures.length && session === 'after-close' && cfg.autoStopAfterClose) enabled = false;`）、`src/js/marketSession.js:46-52`（`getVoiceEligibleCodes` 的 `isFutureCode ? isFutureTrading : stockAllowed` 二元分派）、`:89/94`（`resolveVoiceScheduleAction`）、`src/js/controllers/voiceController.js:93-94`（`saveSettings({ enabled: d.enabled })` 持久化）、`:126`（每 30s `applySchedule`）
- **触发条件**：按 §3.2 完成策略与分派接线后，自选池含任何 `GL_*` / `hf_*` / `hk*` / `us*` 标的（这些代码 `isFutureCode` **恒为 `false`**，为 §3.1.1`:124-126` 断言强制要求），且北京时间 ≥15:00（`getMarketSession` 返回 `after-close`）。
- **实际行为与期望行为**：
  - 期望（方案承诺）：该场景下语音保持启用、外盘标的继续播报、不播「已收盘」。
  - 实际：`voiceSchedule.js:28` 的判据**不含 `allowed` / `eligibleCodes`**，只要求 `!futures.length && session === 'after-close' && autoStopAfterClose`；对纯外盘/港美股自选池三项恒成立 → `enabled = false`。`voiceController.applySchedule()`（`:91-94`）随即 `saveSettings({ enabled: false })`（**持久化关闭**），并在 `:100-101` 播报 `transitionNotice = '已收盘'`。**即使 §3.2 的策略把 `eligibleCodes` 正确扩展为 `['GL_CL0']`（`allowed = true`、`timerShouldRun = true`），该分支仍独立成立。**
  - §5 断言的实际判别力：`resolveVoiceScheduleAction({ session:'after-close', allowed:true, prevAllowed:true, ... })` 返回 `{"pause":false,"autoStop":false,"notice":null,"pausedBySchedule":false}` —— 因 `marketSession.js:89` 的 `if (!cfg.enabled || allowed) return idle;`，**只要 `allowed` 为真就恒返回 idle**，与 `enabled` 无关；故该条断言在缺陷存续时**依然通过**（零判别力）；而 `allowed` 为假时它断言的恰是当前错误行为。
- **复现方法/运行证据**：node 探针导入仓库真实 `src/js/services/voiceSchedule.js` 与 `src/js/marketSession.js`（仅调用纯函数，未修改任何文件、未留残留）：

  ```
  codes = ['sh600519','GL_CL0']; settings.enabled = true; smartSchedule.autoStopAfterClose = true
  tradingDates = ['2026-09-15','2026-09-16','2026-09-17','2026-09-18']
  [北京 16:00] session=after-close  eligible=[]  → decideVoiceSchedule = {enabled:false, timerShouldRun:false, pauseReason:'closed', transitionNotice:'已收盘'}
  [北京 22:00] session=after-close  eligible=[]  → decideVoiceSchedule = {enabled:false, timerShouldRun:false, pauseReason:'closed', transitionNotice:'已收盘'}
  voiceController.applySchedule 将持久化 settings.enabled = false
  isFutureCode: GL_CL0/GL_A50/GL_HSI/hf_CL/hf_HSI/hk00700/usAAPL 实测全为 false
  ```

- **根因**：方案的「语音防污染契约」只在 `resolveSessionStrategy`（决定 `eligibleCodes`）与 `resolveVoiceScheduleAction.autoStop`（瞬时暂停标志）两处展开，而**真正把语音永久关闭的唯一入口**是 `voiceSchedule.js:28`「自选池内无国内期货则收盘即关」这一分支；§3.1.2 的全链路改造点清单未纳入 `marketSession.js:46-52` 与 `voiceSchedule.js:12/28`，§5 断言亦未覆盖 `decideVoiceSchedule` 的 `enabled` 字段。（Round 1 的 P2-4 曾以「混合自选 22:00 播『已收盘』并永久关闭语音」提出，其修复（§3.2 策略 + `anyTrading` 表述）未触及该分支，属**闭环未彻底**；此后各轮未再对该分支做实证核验。）
- **影响范围**：外盘/港美股接入后，**每个交易日 A 股收盘（15:00）后语音被持久化关闭**（用户需手动重开），并播报错误的「已收盘」；`voiceController.js:126` 每 30s 复评，手动重开后下一拍会再次被关。与验收标准 3（会话解耦不得产生回归）及 §3.2.2 的承诺直接冲突，且方案的验收门禁无法发现。
- **修复建议**：① 把 `voiceSchedule.js:28` 的关闭判据由「`!futures.length`」改为「自选池内**无任何处于交易时段的资产**」（即以 `eligibleCodes.length === 0` / `!allowed` 为准），并在 §3.2.2 显式列出该落点；② 把 `src/js/marketSession.js:46-52`、`src/js/services/voiceSchedule.js:12/28` 补入 §3.1.2 改造点清单（含真实行号）；③ §5 的「会话与语音隔离断言」改为直接断言 `decideVoiceSchedule({codes:['sh600519','GL_CL0'], now:北京22:00, …})` 的 `enabled === true && timerShouldRun === true && transitionNotice === null`，并补一条反向断言（纯 A 股自选池在 15:00 后仍应 `enabled === false`）以保留判别力。
- **修复后验收标准**：北京 22:00 与 16:00 两个时钟、自选 `['sh600519','GL_CL0']` 与 `['sh600519','hk00700']` 均满足 `enabled === true / timerShouldRun === true / transitionNotice === null`；纯 A 股池在 15:00 后仍 `enabled === false`；把 `:28` 判据改回 `!futures.length`（变异）后新增断言**必须转红**。

### P3-1 东财 secid 解析路径 `toEastmoneySecId`（`src/js/parser.js:34-40`）未出现在方案任何改造点 → `GL_*` 经它恒返回 `null`，外盘东财三端点全部不可达

- **严重级别**：P3
- **文件与行号**：文档 §3.1.2 清单（`:158-170`，11 行）与 §3.4.1（`:242`）均未出现 `toEastmoneySecId`；代码 `src/js/parser.js:34-40`（`if (!m) return null`），消费方 `src/js/api.js:50`（`buildEastmoneyUrl`）、`:56`（`buildEastmoneyTrendsUrl`）、`server/klineService.js:41`、`server/marketData.js:196`。
- **触发条件**：`code` 为 `GL_*`（或 `hk*` / `us*`）时调用任一东财 URL 构造器。
- **实际行为与期望行为**：`toEastmoneySecId('GL_A50')` → `inferMarket` 要求 `^(sh|sz|bj)\d{6}$` → 返回 `null`；`buildEastmoneyUrl` / `buildEastmoneyTrendsUrl` / `buildEastmoneyKlineUrl` 随之返回 `null`，外盘东财 `qt`/`trends2`/`kline` **三端点全部不可达**，§3.4.1「东财第一源」与「同源 `preClose` 基准」整链失效。期望：按 §3.1.1 注册表把 `GL_*` 解析为对应 secid。
- **根因**：方案登记了 secid 映射（§3.1.1 表）并声明「东财第一源」（§3.4.1），但未把运行时的 `code → secid` 解析函数列入改造面；§3.1.2 行 4 只要求 `normalizeCode` 输出 `{ code, type, market }`，未定义 `market` 的语义与消费方。
- **影响范围**：Phase 1 的外盘东财取数不可达；因 §5:299 的「10 品种三端点可取数」断言会在实现期失败，属可被暴露的缺陷，故定级 P3。
- **复现方法/运行证据**：`node` 导入 `src/js/parser.js` 实跑：`toEastmoneySecId('GL_A50') === null`；`isFutureCode('GL_*') === false`、`parseFutureInput('GL_*') === null`（同时佐证 P1-2）。
- **修复建议**：§3.1.2 清单新增一行 `src/js/parser.js:34-40`（`toEastmoneySecId`）与 `server/klineService.js:41`、`server/marketData.js:196` 的资产感知分发，明确 `GL_*` / `hk*` / `us*` → `globalCatalog` / 港美股目录的 secid；并把 `normalizeCode` 输出对象的 `market` 语义写死（或改为显式 `secid` 字段）。
- **修复后验收标准**：`toEastmoneySecId('GL_A50') === '104.CN00Y'`、`…('GL_HSI') === '134.HSI_M'`、`…('hk00700') === '116.00700'`、`…('usAAPL') === '105.AAPL'`，且 §5:299 的 10/10 三端点断言通过。

### P3-2 本轮新增的 `type='futures_global'` 契约未同步 `type` 判别消费点 → 外盘报价走非期货分支（播报尾附「元」、单位与小数位按 A 股口径）

- **严重级别**：P3
- **文件与行号**：文档 `:164`（§3.1.2 行 5 新增「并设置 `type='futures_global'`」）、`:254-257`（§3.5 货币口径，未列消费点）；消费方 `src/js/tts.js:217-218`、`src/js/alert.js:87-88`（`const unit = quote.type === 'future' ? '' : ' 元';`）、`src/js/views/monitorTableView.js:95/339`、`src/js/kline.js:522`、`src/js/services/batchExportService.js:102`。
- **触发条件**：外盘报价对象 `type` 取本轮新增值 `'futures_global'`，且 `isFutureCode(code) === false`（外盘/港美股恒成立）。
- **实际行为与期望行为**：`tts.js:217` 与 `alert.js:87` 的 `quote.type === 'future'` 为假 → 单位回落 `' 元'`（应为「美元」/「港币」），`decimals` 回落 2 位；`monitorTableView.js:95/339`、`kline.js:522`、`batchExportService.js:102` 的 `isFuture` 为假 → 按股票口径渲染与导出。即语音会播「纽约黄金 4371.7 元」，与 §3.5 的「美原油/黄金/A50 播报『美元』」冲突。
- **根因**：`type` 由 `'stock'` 改为新值 `'futures_global'` 是本轮新增的契约，但 §3.1.2 清单（自称「覆盖全仓 11 处真实行号与消费点」）未包含任何 `type` 判别消费点，§3.5 只给出货币口径方向而未列文件与判别替换方式。
- **影响范围**：用户可听/可见的语义错误（货币单位、小数位、表格口径），不影响取数；属「表面完成但消费点未同步」的连带遗漏。
- **复现方法/运行证据**：静态调用链核验（`grep -rn "\.type === 'future'" src/js`），命中 `tts.js:217-218`、`alert.js:87-88`、`kline.js:522`、`batchExportService.js:102`、`monitorTableView.js:95/339`；`tts.js`/`alert.js` 为唯一「单位 + 小数位」判定点。
- **修复建议**：§3.1.2 清单补入上述 5 个文件（含真实行号），并明确把 `type === 'future'` 的二元判别替换为 `inferAssetType(code)` / `ASSET_TYPES` 判别 + 品种货币元数据（`CNY`/`HKD`/`USD`）。
- **修复后验收标准**：注入 `type='futures_global'` 的外盘报价，`formatQuoteSpeech` 的货币后缀为「美元」/「港币」、`decimals` 与国内期货一致；把 `type` 改回 `'stock'` 时对应用例**必须转红**。

---

## 三、待确认风险与未验证项

1. **待确认风险（HSI 昨结基准在日/夜盘切换后两侧不一致，证据为单一时点、未定级）**：2026-09-16 17:07 实测东财 `134.HSI_M` `f60 = 24688`（其 `trends2.preClose` 同为 24688），而新浪 `hf_HSI` 字段 7（昨结算）= `24676.000`，相差 12 点（0.05%）；同一交易日 16:35（Round 6 采样）两侧同为 24676。与 §2.1`:59`「昨结 `f60=24676`」及 §3.4.2`:247`「`hf_HSI` 昨结（24676.000）与 `f60`（24676）**完全 1:1 精确相等**…无需在切换逻辑中嵌入特殊分支」不符。怀疑为 HKFE 日盘结算与夜盘滚动在两侧发布时点不同（夜盘已转入下一交易日基准）。**需在日盘（16:00 前）与夜盘（17:15 后）各复采 ≥3 次确认**；若成立，须在 §3.4.2 登记基准重校分支或改以 `trends2.preClose` 为唯一基准。残余风险：主备源切换时涨跌幅出现 ≤0.05% 跳变。
2. **未验证项（承接 Round 6）**：受限网络下「先失败→后轮转至 `push2delay`」的**转移时序**无法在同一出口复现 —— 本机 `push2his` 族本就不可达、`push2delay` 三端点全 `rc=0`，无法观测失败切换过程。残余风险：轮转实现后的失败切换时延、以及 `server/proxyService.js:35` 既有的 `timeoutMs: 15_000` 与多主机 × 多轮重试叠加后是否超出前端请求预算（方案未给预算约束）。
3. **未验证项**：Phase 2/3（港股/美股）的腾讯 `78/71` 字段数与东财 `116/105/106` secid 本轮未重采（沿用 Round 2/3 结论）；§2.2/§2.3 的根数口径（港股 331/330、美股 391/390）沿用 Round 3 结论未复测。

**附带说明（非缺陷、非阻塞）**
1. §2.1`:62` 的括注采样值跨时刻混排：同一条括注内 `f43=143900`（= 14390.0 点）与 `f169=940`（= 94.0 点）不同源 —— 同刻应满足 `f169 == f43 − f60`（`143900 − 142710 = 1190` = 119.0 点，与 94.0 点不符）。本轮真源实测该恒等式严格成立（`143750 − 143650 = 100`、`24689 − 24688 = 1`），故 `f169` 需 ÷10 的**指令本身正确**，仅示例值新旧混排，建议按单次快照回填。
2. §3.3.1 把动态窗口的落点写作 `_filterIntradaySessions(items, code, now)`，仓库实际签名为 `_filterIntradaySessions(data, selectedDate)`（`src/js/api.js:260`）；窗口判定实为 `_isTradingSessionTime`（`:252-258`），`INTRADAY_SESSION_RANGES` 的唯一定义处 `:36-39` 的**唯一消费点是 `:257`**，按文档函数名检索会定位偏差。
3. §3.1.2 行 11 的「消费方」只列了 `classifyKlineBar`；`getPriceLimit` 另有消费方 `src/js/limitUp.js:37`（`pct < limit - 0.5`），若按行 11 令其对外盘返回 `null` 将得到 `-0.5` 阈值。实际入参恒为 A 股（涨停池），影响为零，仅提示清单完整性。

---

## 四、推荐修复顺序与复审验收标准

**推荐修复顺序**：P1-1（单位缩放，直接决定 5–6 个首批品种的全部数值）→ P1-2（语音永久关闭，每个交易日 15:00 触发且现有断言不可见）→ P3-1（secid 解析，实现期即暴露）→ P3-2（货币/单位口径）→ 待确认风险 1 的日/夜盘复采定论。

**复审验收标准**：
1. §3.1.1 表按「东财 qt 原始单价 / 真实除数」逐品种回填，§3.1.2 行 5 改为按注册表逐品种归一化（不再是 A50 特例），§5 断言覆盖 **10/10** 品种的 `qt.f43 × qtScale == trends2 末根`（≤0.2%）、`qt.f60 × qtScale == trends2.preClose`（误差 0）、`qt.f4x × qtScale == 新浪对应字段`（≤0.5%），并登记 `GL_HG0` 的新浪 100×（美分/磅）单位差；任一 `qtScale` 错一档时对应用例必须转红。
2. §3.2.2 与 §5 明确纳管 `src/js/services/voiceSchedule.js:12/28` 与 `src/js/marketSession.js:46-52`；§5 会话断言改为断言 `decideVoiceSchedule(...).enabled === true`（北京 22:00、`['sh600519','GL_CL0']`），并补纯 A 股池的 `enabled === false` 反向断言；把 `:28` 判据改回 `!futures.length` 的变异下，新增断言必须转红。
3. §3.1.2 清单补入 `src/js/parser.js:34-40`（`toEastmoneySecId`）与 `type` 判别消费点（`src/js/tts.js:217-218`、`src/js/alert.js:87-88`、`src/js/views/monitorTableView.js:95/339`、`src/js/kline.js:522`、`src/js/services/batchExportService.js:102`）。
4. 探针复跑：`decideVoiceSchedule` 在北京 16:00 / 22:00 两个时钟、混合自选下 `enabled` 保持 `true` 且 `transitionNotice === null`；`toEastmoneySecId` 对 4 类外盘代码均返回非空 secid；10 品种 `qt × qtScale` 与同源 `trends2` / 新浪逐项同级一致。

**审查通过条件**：上述 2×P1 + 2×P3 **100% 修复闭环** + 待确认风险 1 复采定论并处置 + 未验证项明确列明，方可判定通过。
