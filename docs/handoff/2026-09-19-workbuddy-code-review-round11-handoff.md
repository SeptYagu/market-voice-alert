# Round 11 独立审查交接文档（集合竞价方案代码落地 Round 10 缺陷闭环轮复查 / 对象 `62b8938`）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`62b89384ed40dbc35c976133a6f5c979aec8cf4c`（`main` 与 `origin/main` 同步，工作区干净，`git pull --ff-only` 无更新）；基准 `7c955b0`；实际审查范围 `7c955b0..62b8938`（21 文件 / +3468 −30），本轮修复增量 `06f0cdf..62b8938` = 4 文件 / +2393 −4（`tests/callAuction.test.js` +1556、`tests/chartRowController.test.js` +188、`tests/app.test.js` +62、产品侧 `app.js` +12 / `chart.js` +14 / `chartRowController.js` +49 / `voiceController.js` +24 / `kline.js` +258 / `marketSession.js` +8，另有 STATUS/INDEX 登记）。
- 通过项极简：R10 唯一缺陷 P3-1（接线判别力）已真闭环——`tests/app.test.js:846-895` 新用例经 monkey-patch 两管理器实证 `app.js:1368`/`:1385` 挂载与 `:1350-1354` 桥接路由，实现方三项定点变异（M1/M2/M3）与本次复查复核结论一致可杀红；需求 1–3 的本体实现（盘前冻结/preview 机制、253 网格纳入 09:15-09:25、语音 09:20 强制播报 + 09:25 平滑去重）经逐文件阅读与既有 34 条 `5.1` 用例矩阵核验无遗漏；本地门禁 `npm test` 918/918 全绿（pristine 工作区实测）、`npx eslint` 0 问题。独立设计 3 项时序探针（真实 `applyLiveQuoteToKline`），2 项证伪实现（见 P2-1），1 项对照确认 preview 既有防护路径仍有效。
- 判定：**未通过**（1×P2，见下）。

## 二、审查发现与缺陷清单

### P2-1 交接期（09:25-09:30）官方柱原地更新分支无时效门控：盘前滞后快照可污染已确立的官方柱 open/low/close，且低点全天锁死、无任何自动恢复路径（验收标准 1「下影线彻底消除」被旁路复发）

- **严重级别**：P2（特定时序场景下核心功能错误、直接违背验收标准 1，且一旦触发当日不可自愈；R8 P2-1「虚拟价锁死全天 low」同族缺陷经未设防路径复发）。
- **文件与行号**：`src/js/kline.js:690-706`（原地分支的 `else` 路径，即 `last.preview` 为 false 的官方柱原地更新）；关联判据缺失点 `kline.js:692-696`（未调用 `getQuoteBeijingTimeMinutes`）。
- **触发条件**（三个前提同时成立，均为项目自身威胁模型内的一等风险——`5.1(1g)/(1h)/(1j)/(1o)` 已把「滞后快照在 09:25 后到达」建模为真实场景）：
  1. 当日官方柱已确立（preview 已清除：冷启动官方追加 `kline.js:640` 落柱，或 preview 经 `isPostOpenTime && hasValidOpen` 升级 `kline.js:672-688`）；
  2. 随后一拍快照仍是盘前滞后数据（`updateTime` 为 09:25 之前的盘前时间戳，`price`/`open` 为未撮合虚拟价，如 19.60）；
  3. 到达时客户端时钟处于 09:25-09:30（`min < 9*60+30`，`isContinuousTrading === false`）。
- **实际行为与期望行为**：
  - 实测（独立探针，真实模块、仓库外执行）：
    - **S1**：09:18 preview 追加 → 09:25:03 官方快照升级（`o=20.5 l=20.5 v=90000`，preview 清除）→ 09:26 到达滞后快照 `{price:19.6, open:19.6, updateTime:'20260918091800'}` ⇒ 官方柱变为 `{open:19.6, high:20.5, low:19.6, close:19.6}`——**下影线重现、open/close 同步污染**；
    - **S2**：09:25:00 冷启动官方追加（`o=20.5 l=20.5`）→ 09:27 到达滞后快照（`updateTime:'20260918092450'`）⇒ 同样污染为 `o=19.6 l=19.6 c=19.6`；
    - **S3（对照）**：同款滞后快照打在 preview 柱上 ⇒ 正确走坍缩滞留路径（保持 preview、volume=0），既有防护有效。
  - 期望：官方柱在 09:25-09:30 交接期内对「盘前时效快照」与 preview 分支/追加分支保持同等门控——`quoteTimeMinutes < 09:25` 的快照不得驱动官方柱 `open`/`low`/`close` 极值。
- **根因**：`kline.js` 原地分支的防护只覆盖 preview 半程：`if (last.preview)` 内有 `isPostOpenTime && hasValidOpen` 合取门（`:672`），而 `else`（官方柱）路径在非连续交易时段执行 `updated.low = Math.min(lastLow, price)`（`:703`）与 `if (quoteOpen) updated.open = quoteOpen`（`:706`）时**完全未检查报价时效**。前三轮（R7-R10）建立的「时效未知/盘前时效 ⇒ Fail-Closed」判据在第三条路径上缺席，形成防护矩阵的结构性缺口。
- **影响范围**：A 股日K（`1d`）。污染后不可自愈：① `low` 一旦被拖到 19.6，后续连续竞价 `low = min(lastLow=19.6, quoteLow, price)` 恒 ≤19.6（全天锁死）；② R9 落地的自愈通道 `refreshPreviewKline`（`chartRowController.js:550`）以 `last.preview` 为前置门禁，官方柱被污染后**永不触发**强制重载；仅手动切换周期/强刷可恢复。同时 `open`/`close` 被虚拟价改写，直接展示错误价格。
- **复现方法 / 验证证据**：上述 S1/S2/S3 三步序列探针可直接复现（逐拍调用真实 `applyLiveQuoteToKline(items, quote, '1d', 'sh603533', now)`）。测试覆盖缺口证实：`tests/callAuction.test.js` 全部 34 条用例中，所有「盘前滞后快照」负例（1g/1h/1i/1j/1o）的前置均为 **preview 柱**，无任何用例构造「官方柱 + 盘前时效快照 @09:25-09:30」——变异验证：在 `:692-706` 处任意增删时间戳门控，918 项门禁零用例转红（该路径判别力为零）。
- **修复建议**：在原地 `else` 分支（`:690-706`）非连续交易时段（`clockMinutes < 09:30`）增加与 `:672` 同源的门控：`const quoteTimeMinutes = getQuoteBeijingTimeMinutes(quote, targetDate);`——当 `quoteTimeMinutes !== null && quoteTimeMinutes < 9*60+25`（盘前时效实锤）时，跳过对官方柱 `open`/`low`/`high`/`close` 的写入（整拍视为陈旧数据，`return items` 或仅更新 `changePercent`）；`quoteTimeMinutes === null`（未知时效）的取舍须显式登记（建议与既有 Fail-Closed 口径一致：不动官方柱极值，仅 `close` 随现价——若采纳后者须补对应负例）。
- **修复后的验收标准**：
  1. 新增负例用例：官方柱前置 + 盘前时效快照（`updateTime < 09:25`）@09:26/09:27/09:29 三拍 ⇒ `open/low/high` 保持官方值，断言确定性转红于「删除时间戳门控」变异；
  2. 本探针 S1/S2 序列复测结果为 contained（`low === 20.5` 且 `open === 20.5` 全天保持）；
  3. 既有 34 条 `5.1` 用例与 918 项门禁全绿不回归；`refreshPreviewKline` 前置门禁不放宽。

## 三、待确认风险与未验证项

- **东财日K端点盘中是否返回今日半日柱（继承 R9/R10，仍未获活体证据）**：当日为周六，无法盘中取证；若上游不返回今日柱，`refreshPreviewKline` 按 30s 节流持续重试但 preview 不收敛（不劣于修复前）。建议下一交易日 09:30 后对东财兜底通道代码抓取一次真实重载结果。
- **`quote.time` 回退路径（`kline.js:481-486`）无日期校验**（继承 R8）：当前两现役源不构成该形态（腾讯 `quoteDate` 由 `updateTime` 派生、东财无时间戳），理论性残余风险，随 P2-1 门控一并加固即可。
- 其余继承项（上游 ≥09:30 后盘前 payload 持续性、`npm run e2e`/`build` 与活体行情验证）与 R10 登记一致，本轮无新证据，不再展开。

## 四、推荐修复顺序与复审验收标准

1. **P2-1（唯一项）**：按修复建议为原地 `else` 分支补时效门控（与 `:672` 判据同源、不放宽既有合取式），同步补「官方柱 + 盘前时效快照」负例用例并登记未知时效取舍。
2. 复审验收：P2-1 修复后的三项验收标准全部达成 + 918 项门禁全绿 + 本文档 S1/S2 探针序列复测 contained；接线判别力（R10 P3-1 三项变异）不回归。
3. P2-1 闭环且无新增缺陷后，本轮审查方可通过；东财日K活体证据可在下一交易日补验，不阻断门禁判定，但须在 STATUS 中保留登记直至验证完成。
