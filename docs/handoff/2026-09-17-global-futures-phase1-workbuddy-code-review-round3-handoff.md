# WorkBuddy 独立代码审查 Round 3 Handoff — Phase 1 国际期货与外盘基础（修复复查）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`5e02539`（基准 `adf057f`；上轮被审 `9389bcd`，本轮实际审查增量 `9389bcd..5e02539` = 24 文件 / +2501 −196）。工作区干净，`main` 与 `origin/main` 同步。
- 门禁实跑：`npm test` 基线 **869/869** 全绿；lint/build 由交付方门禁覆盖。
- **Round 2 全部 8 项缺陷（P2-1/P2-2/P3-1..P3-6）已实测真闭环**：9 组定点反向变异在 `tests/globalFutures.test.js` / 全量套件下确定性转红（M1c 日历日判据回退、M2 服务端并集判据回退、M3 旧启发式还原、M4 撤销 session ranges 接线、M5+M11 双层 `hf_` 过滤同拆、M6 `breakEnd` 固定 360、M7 还原 `known||'105'`、M8 小数位 `{3,4}` 白名单回退、M9 `quoteDate` 还原 10 位）；真源端到端复核：`toEastmoneySecId('usBA')→null`（降级路径成立）、`GL_CL0 date=2026-09-17` API 返回 232 根与直连 `trends2` **差额 0**、`GL_HSI date=2026-09-16` 返回 600 根含跨午夜夜盘段（09-17 00:00–03:00 181 根保留，无午夜截断）。
- 单层 `hf_` 过滤拆除仍绿系双层冗余（纵深防御），非缺陷；`proxyRoutes` 的 `push2delay` 兜底主机移除全量仍绿（无验收断言要求，属附带建议，不阻塞）。
- **本轮发现 2 项新缺陷（1×P2 + 1×P3）**，均位于本轮新增的 `isHistoricalSnapshotComplete` futures_global 完整性判据（`server/intradayService.js:135-158`），判定**未通过**。

## 二、审查发现与缺陷清单

### P2-1 完整性判据把「美盘 DST 结算时刻」套用于全部 10 品种：GL_HSI 全年、GL_A50 冬令时的历史归档被永久判为不完整（stale 恒真 + 快照缓存永不信任）

- **文件与行号**：`server/intradayService.js:148`（`const breakStart = dst ? 5 * 60 : 6 * 60;`）、`:158`（`return lastMin >= breakStart - 15;`）、`:149`（`stamp.minutes < breakStart + 5` 生成时刻门）；消费点 `:313`（历史快照信任门）、`:336`/`:360`（`stale: ... || (isHistoricalDate(dateKey) && archiveComplete === false)`）；会话模型 `src/js/marketSession.js:234-283`（`globalFuturesStrategy` 对全部外盘统一按美盘 05:00/06:00 结算近似）。
- **触发条件**：对 `GL_HSI`（任意季节）或 `GL_A50`（美冬令时，约 11 月–3 月）请求任一已完成交易日的历史分时，即 `GET /api/cache/intraday?code=GL_HSI&date=<已完成交易日>`。
- **实际行为（北京 2026-09-17 10:0x 实测，全新缓存根，HEAD `5e02539`）**：
  ```
  GET /api/cache/intraday?code=GL_HSI&date=2026-09-16
    → ok:true, source=eastmoney-kline-1m, n=600,
      first=2026-09-16 17:01, last=2026-09-17 03:00,
      archiveComplete=false, 响应 stale=true（:336 判定）
  同刻直连 push2delay kline(134.HSI_M, klt=1)：n=642（09-16 17:01 → 09-17 09:57）；
  夜盘段 09-17 00:00–03:00 共 181 根，03:00 后至 09:15 前无 bar；
  09:15 起日盘 bar 按 getTradingDay 属交易日 09-17（与归并模型一致）。
  ```
  即：按交易日归并模型，交易日 09-16 的全部数据（600 根，17:01 → 03:00）**已完整返回**，但 `:158` 以美盘结算前 15 分钟（夏令时 `05:00-15 = 04:45`）为末根门槛，恒指夜盘真实末根 `03:00`（180 min）< 285 → 恒判不完整。冬令时阈值 345 下 `GL_A50`（夜盘真实末根 `05:15`，315 min，push2delay 实测 `104.CN00Y` 夜盘段 `00:00 → 05:15` 共 316 根）同样恒不通过。
- **期望行为**：本轮为闭环 Round 2 P2-1 而新增的完整性判据应基于**所判品种自身的交易日窗口末根**。HKFE 恒指交易日 T = T 日 17:00 → T+1 03:00（夜盘）∪ T+1 日盘（归属 T+1），其交易日末根即 T+1 03:00；SGX A50 夜盘末根 05:15。二者均不随美盘 DST 变化。
- **根因**：`isHistoricalSnapshotComplete` 的 futures_global 分支直接复用了 `marketSession.js` 的美盘统一近似（`isUsDaylightSavingTime → breakStart 300/360`）作为「会话应结束时刻」。该近似对 `isTradingNow`（语音调度的瞬时判定）影响有限，但完整性判定把近似值**固化为持久化的错误标记**：判据写死单一会话模型，未按品种（目录 `globalCatalog.js` 已有 exchange 字段）区分真实收盘分钟。
- **影响范围**：
  1. `:336`/`:360` 使 GL_HSI（全年）/GL_A50（冬令时）的**所有**历史分时响应永久带 `stale: true`，客户端 `formatIntradayStatus`（`chartRowController.js:174-178`）永远显示过期/缓存标记；
  2. `:313` 信任门永不通过 → 每次查看 HSI 历史分时都重新发起上游 kline 拉取（无法用快照摊销）；上游换日窗口过后 fetch 返回 0 根，回落 `getOrRefresh` 旧快照，数据可见但标记永错；
  3. 本轮 P2-1 修复的原始危害形态（「被标记为不完整，用户无从察觉数据实际完整」）在 1/10 品种上全年复现。
- **复现方法/运行证据**：
  ```
  rm -rf <fresh-cache>; PORT=<p> MARKET_VOICE_CACHE_ROOT=<fresh-cache> node server/index.js
  curl "http://127.0.0.1:<p>/api/cache/intraday?code=GL_HSI&date=2026-09-16"   # → archiveComplete=false
  curl -s "https://push2delay.eastmoney.com/api/qt/stock/kline/get?secid=134.HSI_M&klt=1&fqt=1&lmt=1000&beg=0&end=20500000&..."  # 夜盘末根 03:00
  ```
  **测试有效性（同一缺陷的第二面）**：把 `:158` 变异为 `return true;`（整段末根判据失效），全量套件 **869/869 仍全绿**——该判据本轮新增但零品种级覆盖（既有断言只覆盖美盘型品种的 DST 边界，与实现共享同一美盘假设）。
- **修复建议**：按品种登记交易日末根分钟（如 `globalCatalog` 增加 `sessionEndBeijingMin`：HSI=180、A50=315、CME 族按 DST 300/360），`isHistoricalSnapshotComplete` 改用该登记值（或从 `resolveSessionStrategy(code)` 提供品种级会话末根）；补两条断言：GL_HSI 完成交易日归档 `archiveComplete=true`（末根 03:00 样本）、GL_A50 冬令时样本（末根 05:15、`isUsDaylightSavingTime=false`）`archiveComplete=true`。
- **修复后验收标准**：上述两条断言全绿；把 `breakStart` 还原为统一美盘值、或把 HSI 登记值改回 300/360 时，用例必须确定性转红；实测 `GET /api/cache/intraday?code=GL_HSI&date=<已完成交易日>` 的 `stale=false` 且二次请求命中快照缓存（不再重拉上游）。

### P3-1 完整性判据只校验末根不校验首根：头部被上游窗口截断的归档被标 `archiveComplete=true` 并经信任门永久缓存

- **文件与行号**：`server/intradayService.js:150-158`（仅 `items.length < 500`、`lastDate`、`lastMin` 三类检查，无首根/窗口起点校验）；`:313`（信任门）。
- **触发条件**：上游（push2delay kline，`lmt=1000`）仅保留最近交易日窗口且该窗口头部已越过所请求交易日的窗口起点（如 A50：交易日 T 的日盘 09:00–16:35 段已被丢弃、夜盘段仍在）时，请求 `date=T`。
- **实际行为（同刻实测，全新缓存根）**：
  ```
  GET /api/cache/intraday?code=GL_A50&date=2026-09-16
    → ok:true, source=eastmoney-kline-1m, n=735,
      first=2026-09-16 16:46, last=2026-09-17 05:00/05:15,
      archiveComplete=true
  直连同 secid：窗口 n=808（09-16 16:46 → 09-17 09:58），交易日 09-16 的
  日盘 09:00–16:35 段（约 455 根）已不在上游返回中。
  ```
- **期望行为**：缺头归档（首根 16:46，缺失 T 日日盘约 38%）不应判为完整归档；或至少不得经 `:313` 信任门作为终版归档永久缓存。
- **根因**：完整性判据是「末根单边」检查——只验证会话收尾，不验证窗口起点/最小条数与品种会话结构的匹配（`items.length < 500` 的下限低于 A50 交易日真实约 1190 根）。
- **影响范围**：A50 类品种在上游窗口滚动后（T+1 日间）首次请求历史 `date=T` 即固化残缺归档：后续请求永远命中信任门返回该残缺快照，用户侧图表从 16:46 开始且无任何缺失提示。属 Round 2 P2-1 危害形态（「静默残缺、用户无从察觉」）在头部方向的残留变体。
- **复现方法/运行证据**：见上（真实上游 + 全新缓存根可复现；变异回放可对种子归档 `first=16:46` 断言 `archiveComplete=false` 当前必红）。
- **修复建议**：增加首根校验（首根时间落在品种交易日窗口起点容差内，如 A50 日盘 09:00 ±15min / 美盘 06:00/07:00 ±15min），或按品种登记交易日条数下限；不满足时 `archiveComplete=false`（允许作为部分数据返回，但不进 `:313` 信任门）。
- **修复后验收标准**：以 `first=16:46` 的 A50 种子归档断言 `archiveComplete=false`（当前实现下必红）；以首根完整的归档断言 `archiveComplete=true` 不受影响。

## 三、待确认风险与未验证项

1. **已完成 CME 型交易日（如 GL_CL0 `date=2026-09-16`）的全量条数对齐（Round 2 P2-1 验收标准「差额 ≤ 1」）未能整段复测**：北京时间 09-17 06:00 换日后，push2delay kline 仅返回当前会话（实测 102.CL00Y n=227，09-17 06:01 起），昨日 bars 已不可从上游获得（`9389bcd` 同一上游限制，非本轮回归）。已验证的替代证据：当日进行中请求差额 0（232=232）+ 跨午夜段保留（HSI 181 根）+ 归并判据变异必红。**残余风险**：若服务器在某交易日收尾窗口（收盘 → 次日会话开盘）期间从未成功拉取，该日归档永久不可获得（上游限制，需上游多日数据源或 AKTools 链路才能根治）。
2. `tests/…S17 性能预算（p95 ≤ 16ms）` 在并行负载下 8 次运行偶发 2 次失败（单跑复现 通过）——预存测试基建对负载敏感，非本轮引入，不阻塞；建议后续隔离压测确认。
3. `push2his` / `90.push2his` 本轮实测仍 100% 连接重置（curl http=000），`klineService.js:95` 轮转至 `push2delay` 后成功——与仓库既有记载一致，非回归。

## 四、推荐修复顺序与复审验收标准

1. **P2-1**（品种级会话末根登记 + 两条断言 + 变异必红实测）→ **P3-1**（首根校验 + 头部截断种子断言）。
2. 复审验收：上列两缺陷的「修复后验收标准」逐条实测；`npm test` 全绿且新增断言在对应变异下确定性转红；历史分时端到端复测（HSI 完成交易日 `stale=false`、A50 头部截断样本不进信任门）。
