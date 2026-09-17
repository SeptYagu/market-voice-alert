# WorkBuddy 独立代码审查 Round 4 Handoff — Phase 1 国际期货与外盘基础（Round 3 修复复查）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`6241d9c`（基准 `adf057f`；上轮被审 `5e02539`，本轮实际审查增量 `7f33014..6241d9c` = 3 文件 / +158 −18）。工作区干净，`main` 与 `origin/main` 同步（`git pull --ff-only` 已确认 up to date）。
- 门禁实跑：`npm test` **873/873** 全绿（较上轮 +4，全部为 `isHistoricalSnapshotComplete` 品种级新断言）。
- **Round 3 两项缺陷在单元层已实测真闭环**：品种级 `sessionStartBeijingMin`/`sessionEndBeijingMin`/`minBars` 登记（CME 族按 DST 420/360–300/360、A50 固定 540/315/800、HSI 固定 555/180/500）+ 首末根双侧校验；4 条新断言直接调用真实现、无 mock 掩盖。变异证伪：M1（HSI `sessionEndBeijingMin` 还原为统一美盘值）→ HSI 用例确定性转红；M2b（同时拆除首根校验 + A50 `minBars`→500）→ A50 截断用例转红（仅拆首根校验时样本被 `minBars:800` 兜住，双层冗余拦截、非假阳性）。
- 端到端真源复核（全新缓存根，北京 09-17 10:3x）：`GET /api/cache/intraday?code=GL_A50&date=2026-09-16` → n=735、`archiveComplete=false`（Round 3 误标 true 的缺头归档，**P3-1 修复生效**）；`GL_HSI date=2026-09-16` → n=600（17:01→03:00）、`archiveComplete=false` 属**诚实标记**——实测上游 kline（`134.HSI_M`，668 根）已清洗 09-16 日盘段（09:15–16:00），按合并模型该交易日确缺日盘半段，非 Round 3 P2-1 的「数据完整误标不完整」形态（详见 §三.1）。
- **本轮发现 1 项新缺陷（1×P3，本轮新增首根校验引入的回归）**，判定**未通过**。

## 二、审查发现与缺陷清单

### P3-1 完整性判据的 DST 取自 `generatedAt` 而非归档会话自身：美国夏令时切换周末之前的 CME 型交易日，其完整归档在切换后首次抓取时被永久误判不完整

- **严重级别**：P3
- **文件与行号**：`server/intradayService.js:156`（`const dst = isUsDaylightSavingTime(new Date(n));`，n 为 `generatedAtMs`）、`:165`（首根门 `if (firstMin > startMin + 15) return false;`）、`:177`（末根门 `return lastMin >= endMin - 15;`）；DST 判定 `src/js/marketSession.js:57`（`isUsDaylightSavingTime` 按时刻点判定，实现正确，问题在调用侧取时）。
- **触发条件**：8 个 CME 型品种（GL_CL0/GC0/SI0/HG0/NG0/NQ0/ES0/YM0）在**夏令时切换日（2026 春令时 3 月第二个周日、秋令时 11 月第一个周日）之前最后一个交易日**（通常为周五）的归档，其首次成功抓取/重建发生在切换点之后（如切换后周一查看历史分时）。
- **实际行为与期望行为**：同一份**完整**归档，仅因 `generatedAt` 越过切换点即由 `archiveComplete=true` 翻转为 `false`：
  - 春令时方向（本轮**新引入回归**）：切换前周五交易日为冬令时会话（首根 T 07:00=420 min、末根 T+1 05:59=359 min）。切换前生成（genAt 冬令时）→ `startMin=420`，420 ≤ 435、359 ≥ 345 → **true**；切换后重新生成（genAt 夏令时）→ `startMin=360`，首根 420 > 375 → **false**。旧实现（无首根校验、末根门 285）该场景判 true，故为本轮回归。
  - 秋令时方向（既有同根因缺陷，本轮未改动但同处一行修复面）：切换前周五为夏令时会话（首根 T 06:00、末根 T+1 05:00=300 min）。切换后生成（genAt 冬令时）→ `endMin=360`，末根 300 < 345 → **false**。旧实现同样误判（`5e02539` 的 `breakStart` 亦取自 genAt），非本轮回归，但根因相同、修复必须一并覆盖。
- **根因**：`isHistoricalSnapshotComplete` 用 `generatedAtMs` 推导 DST 体制，而归档校验的对象是**会话窗自身**的 DST 体制；切换周末二者相悖（会话在切换前结束，`generatedAt` 在切换后）。首根校验（本轮新增）使该错配从「秋令时方向单侧」扩大为「双侧」。
- **影响范围**：每年 2 个切换日 × 8 个 CME 型品种的切换前最后交易日；该日归档永久 `archiveComplete=false` → 响应 `stale=true`（`:336/:360`）、信任门 `:313` 永不通过、每次查看重拉上游。数据可见、无静默残缺，故定级 P3；但按现行门槛（P0–P3 全部闭环）构成阻断。
- **复现方法/运行证据**（决定性反例脚本，4 案例、纯单元、无网络）：
  ```
  构造完整归档（chart seconds，北京墙钟）：
  SF = 首根 2026-03-06 07:00、末根 2026-03-07 05:59、1379 根（冬令时会话）
  FB = 首根 2026-10-30 06:00、末根 2026-10-31 05:00、1380 根（夏令时会话）
  call(genAt, dateDash, items) = isHistoricalSnapshotComplete(genAt, dateDash, {code:'GL_CL0', items}, 'GL_CL0')
  SF genAt=2026-03-07 08:00（切换前，EST）  : expect true -> true
  SF genAt=2026-03-09 10:00（切换后，EDT）  : expect true -> false   ← 误判
  FB genAt=2026-11-02 10:00（切换后，EST）  : expect true -> false   ← 误判
  FB genAt=2026-10-31 08:00（切换前，EDT）  : expect true -> true
  ```
- **修复建议**：DST 体制改由归档会话自身推导——以末根 bar 时刻判定（`isUsDaylightSavingTime(new Date(lastItem.time * 1000))`，末根紧贴结算收盘、体制归属无歧义），首根/末根门共用该值；或对首根、末根分别推导。HSI/A50 为固定常量不受影响，CME 族随即与切换周末自洽。
- **修复后验收标准**：
  1. 上述 4 案例反例全部返回 true（补为正式断言：切换周周五完整归档 × 切换前/后 generatedAt 共 4 条）；
  2. 将 DST 来源还原为 `generatedAtMs` 时，4 条断言中至少 2 条确定性转红；
  3. `npm test` 全量全绿；既有 HSI/A50/CME 断言无一转红（无连带回归）。

## 三、待确认风险与未验证项

1. **HK/SGX 完整归档捕获窗的存在性未证实**：合并模型下 GL_HSI 交易日 T = T 日日盘（09:15–16:00）∪ 夜盘（17:00→T+1 03:00）。实测（北京 09-17 10:3x）上游 `134.HSI_M` 仅 668 根（09-16 17:01 起），09-16 日盘段已被清洗 → `GL_HSI date=2026-09-16` 夜盘-only 归档（600 根）被判不完整。该标记**诚实**（数据确缺日盘半段），Round 3 P2-1 验收标准「已完成交易日 stale=false」在现时点不可满足的原因是**上游数据确残缺**而非误判。**未验证**：北京 03:00–09:15（HSI）/05:15–09:00（A50）窗口内上游是否仍同时保有 T 日日盘与完整夜盘——若在，窗口内抓取可得完整归档并经信任门固化；若不在，HSI/A50 的完整归档永远不可得（上游保留策略限制，标记仍诚实，最坏后果仅为该两类品种历史归档永久 stale + 重复拉取）。**验证方法**：下一窗口（北京 09-18 03:00–09:15）实测 `GET /api/cache/intraday?code=GL_HSI&date=2026-09-17` → `archiveComplete=true` 且二次请求命中快照缓存。
2. A50 美盘夏令时期间 `globalFuturesStrategy.getIntradaySessionRanges` 返回 `[0,300]`，会滤除夜盘 05:00–05:15 的真实 bar（SGX 不随美 DST，A50 夜盘实际 05:15 收盘），使夏令时归档末根=05:00，本轮末根判据以 **0 裕量**通过（300 ≥ 315−15）。既有行为（本轮未改动该 ranges），仅登记；若 A50 夏令时末根 bar 缺失 05:00 一根即被误判不完整，建议后续随 P3-1 一并按品种对齐 ranges。
3. 沿承上轮：S17 性能预算用例并行负载偶发失败（预存基建敏感性，单跑通过）；`push2his`/`90.push2his` 仍 100% 连接重置、轮转至 `push2delay` 生效（与既有记载一致）。均非本轮回归。

## 四、推荐修复顺序与复审验收标准

1. **P3-1**（一行级修复：DST 来源由 `generatedAtMs` 改为归档会话自身）→ 补 §二验收标准 1 的 4 条切换周断言 → 变异必红实测。
2. 复审验收：P3-1 验收标准逐条实测；`npm test` 全绿；§三.1 的窗口内端到端实测可顺延至下一捕获窗执行（时间门控项，不阻塞代码修复的复审）。
