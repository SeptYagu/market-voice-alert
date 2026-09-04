# 2026-09-03 核心缺陷闭环差距分析与剩余未完成缺陷交接文档

> **交接日期**：2026-09-03
> **当前基线**：`f63fcbd`（`main`）
> **前序文档**：
> - [`docs/handoff/2026-09-03-gemini-implementation-code-review-handoff.md`](./2026-09-03-gemini-implementation-code-review-handoff.md)
> - [`docs/handoff/2026-09-03-futures-complete-defects-resolution-handoff.md`](./2026-09-03-futures-complete-defects-resolution-handoff.md)

---

## 1. 本次提交（Commit `f63fcbd`）完成项核查

在最新提交 `f63fcbd`（*fix(cache): overhaul isKlineCacheStale with settlement node awareness and fix Eastmoney circuit breaker failure accumulation*）中，针对上一轮审查报告指出的两项历史顽疾完成了高质量的根因修复与单测覆盖：

### 1.1 F-HIGH-6 / §15 #8：K 线缓存过期逻辑重构 (`src/js/storage.js`)
- **根因解决**：彻底删除了原有 `if (!_isMarketOpen(now)) return false;`（闭市即永不失效）的错误逻辑，并解除了对股票交易时段的死板依赖。
- **精细化结算节点机制**：
  1. 盘中日 K 超过 1 小时即判定 stale；
  2. 盘中抓取的日 K 在 15:00 收盘跨越结算节点后，在盘后立即判定 stale；
  3. 15:00 盘后拉取的终盘日 K 在当晚保持新鲜；
  4. 工作日盘后日 K 在次日早盘 09:30 开盘前保持新鲜，开盘后立即判定 stale；
  5. 周五盘后日 K 在周六、周日以及周一早盘 09:30 开盘前均保持新鲜，周一 09:30 开盘后过期；
  6. 分钟 K 线盘中超过 2 分钟过期，跨越 15:00 收盘后过期。
- **单测健全**：在 `tests/storage.test.js` 中新增 9 个精准覆盖上述场景的确定性时间测试，消除了原先仅断言 `typeof stale === 'boolean'` 的“假测试”。

### 1.2 §8.2：东财熔断计数跨请求清零缺陷修复 (`server/klineService.js`)
- **根因解决**：修复了原逻辑中由于 `eastmoneyDisabledUntil` 初始为 0，导致任何新请求都能触发 `Date.now() >= 0` 并把 `eastmoneyFailures` 清零的缺陷。现在仅当熔断确实处于触发状态（`disabledUntil > 0`）且冷却窗口过期时才重置。
- **单测健全**：在 `tests/server.test.js` 中新增单测，验证连续 3 次失败能够成功跨请求累加并触发熔断冷却窗口。

---

## 2. 剩余未完成缺陷详单（Unresolved Issues）

经过逐模块、逐行代码的比对与实测，截至当前基线 `f63fcbd`，以下关键缺陷**仍未解决**，需后续批次彻底闭环：

### 2.1 P0 级：阻断性核心缺陷（5 项）

#### 【P0-1】新浪期货 K 线 Fallback 100% 失败且字段严重错位（原 P0-S4）
- **文件与行号**：[`server/futures/futuresKlineService.js:52, 133, 56-73`](../../server/futures/futuresKlineService.js#L52)
- **缺陷现象**：
  1. 正则匹配失败：新浪真实 JSONP 返回 `/*<script>location.href='//sina.com';</script>*/\nvar _data=([ ... ]);`。正则 `/var\s+_data\s*=\s*(\[[\s\S]*\])/` 因缺少对 `(` 的兼容导致 `match` 恒为 `null`；
  2. 字段灾难性映射：新浪 `InnerFuturesNewService.getMinLine` 返回单行格式为 `[时间, 现价, 均价, 成交量, 持仓量, ...]`。代码把 `row[3]`（成交量）映射为 `low`，把 `row[4]`（持仓量）映射为 `close`。一旦触发降级，分时收盘价将被赋值为几十万的持仓量！
- **修复方案**：
  - 正则改为 `/var\s+_data\s*=\s*\(?\s*(\[[\s\S]*\])/`；
  - 纠正分时字段解析：`open: row[1]`, `high: row[1]`, `low: row[1]`, `close: row[1]`, `volume: row[3]`, `openInterest: row[4]`，并在首根 bar 从 `row[6]` 提取基准日期。

#### 【P0-2】实时分时图在期货时段被股票时段硬编码拦截（原 P0-6）
- **文件与行号**：[`src/js/kline.js:424-437`](../../src/js/kline.js#L424-L437)
- **缺陷现象**：
  ```javascript
  function _isContinuousTradingMinute(parts) {
    const minutes = parts.hour * 60 + parts.minute;
    return (
      (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) ||
      (minutes >= 13 * 60 && minutes < 15 * 60)
    );
  }
  ...
  export function applyLiveQuoteToIntraday(items, quote, now = new Date()) {
    ...
    if (!_isContinuousTradingMinute(parts)) return items;
  ```
  `applyLiveQuoteToIntraday` 的判定只识别股票 09:30-11:30、13:00-15:00。在境内期货早盘 **09:00 - 09:30** 以及 **21:00 - 02:30 全部夜盘时段**，实时分时图无法追加最新数据点，函数直接 return。
- **修复方案**：判断当前品种是否为期货（或由调用方传入），期货使用 `isFuturesMarketOpen` 判定时段，放行 09:00-15:15 与夜盘时段。

#### 【P0-3】周六凌晨夜盘续段在前端刷新与分时更新中被拦截（原 P0-S6）
- **文件与行号**：[`src/js/marketSession.js:82-99`](../../src/js/marketSession.js#L82-L99)
- **缺陷现象**：
  `isLiveTradeDate` 中，对夜盘交易日判定仅检查了 `if (timeMin >= 20 * 60 + 50)`。在周六凌晨 00:00 - 02:30 时，`timeMin < 150`，北京自然日 `beijingToday` 为周六，但期货交易日 `selectedDate` 属于下周一。条件不满足返回 `false`，导致 [`app.js:2986`](../../src/js/app.js#L2986) 中 `refreshLiveIntradayForCode` 和 [`chartRowController.js:114`](../../src/js/controllers/chartRowController.js#L114) 中 `applyLiveQuoteToIntradayChart` 在周六凌晨全部被阻断。
- **修复方案**：补充周六凌晨逻辑：当 `now` 是周六凌晨且 `timeMin <= 2*60+30` 时，若 `selectedDate` 等于下周一交易日，判定为 live 会话。

#### 【P0-4】法定节假日交易判定在生产运行时依然误判（原 P0-S1）
- **文件与行号**：[`server/futures/futuresSessionService.js:22-24`](../../server/futures/futuresSessionService.js#L22-L24)、[`server/futures/futuresQuoteService.js:110`](../../server/futures/futuresQuoteService.js#L110)
- **缺陷现象**：
  `futuresSessionService.js` 虽然接收 `tradingDates`，但生产环境中的 `futuresQuoteService` 和 `futuresKlineService` 调用 `getFuturesSession(inst)` 时**根本没有传入 `tradingDates`**（传空数组）。生产服务中 `hasCalendar` 恒为 `false`，直接走 `!isWeekend`，导致国庆、春节等周一至周五工作日假期依然误判为开市。
- **修复方案**：在服务端引入交易日历缓存加载或单例注入，确保生产调用 `getFuturesSession` 时使用真实交易日历。

#### 【P0-5】`chartRowController.destroyCharts` 未取消网络请求（原 P0-S7）
- **文件与行号**：[`src/js/controllers/chartRowController.js:271-282`](../../src/js/controllers/chartRowController.js#L271-L282)
- **缺陷现象**：
  折叠展开行或切换路由销毁图表时，仅清除了图表 DOM 实例，未调用 `inst.abort?.abort()` 和 `inst.intradayAbort?.abort()`，导致异步网络请求泄漏与潜在竞态覆盖。
- **修复方案**：在 `destroyCharts(code)` 中获取对应实例并触发 abort。

---

### 2.2 P1 级：严重正确性与功能完整性（7 项）

#### 【P1-1】周线与月线 K 线切换报 HTTP 400 错误（原 P1-3）
- **文件与行号**：[`server/futures/futuresKlineService.js:164-170`](../../server/futures/futuresKlineService.js#L164-L170)
- **缺陷现象**：
  未实现周/月线聚合，而是加入 `VALID_PERIODS` 白名单拦截。用户点击周 K 或月 K 时，服务端抛错返回 HTTP 400：`{"ok":false,"error":"Invalid futures kline period: 1w"}`，图表报错中断。
- **修复方案**：实现从日 K 线数据聚合周 K（以自然周五或该周最后一个交易日聚合 OHLCV/持仓）与月 K 的通用聚合函数。

#### 【P1-2】分时多日滚动数据过滤缺陷与空回退污染（原 P0-S3 / P1-4）
- **文件与行号**：[`server/futures/futuresKlineService.js:210-252, 277`](../../server/futures/futuresKlineService.js#L210-L252)
- **缺陷现象**：
  1. `const itemsToUse = dayBars.length ? dayBars : raw.items;`：一旦当天过滤无数据，回退至全部 5 日 1000+ 根分钟柱，严重污染图表；
  2. `getPreviousTradeDayStr` 未接入真实交易日历，法定节假日后首日的前一日计算错误；
  3. 周一对应周五夜盘时，对 01:00/02:30 品种构建的过滤窗口跨越整个周末。
- **修复方案**：精准使用 `shiftTradingDate` 计算上一交易日；过滤为空时返回空数组或 `source: 'empty'`，禁止塞入多日滚动数据。

#### 【P1-3】`chartRowController` 4 项生命周期缺陷（原 §14 #1, #2, #3, #4）
- **文件与行号**：[`src/js/controllers/chartRowController.js`](../../src/js/controllers/chartRowController.js)
- **缺陷清单**：
  1. `handlePeriodChange`（第 421-440 行）未调用 `inst.intradayAbort?.abort()`，旧分时请求返回后覆盖新周期；
  2. `handlePeriodChange` 未重置 `inst.selectedTradeDate`，切换周期后分时图仍滞留在历史日期；
  3. SWR `onData`（第 315-327 行）未比对 `currentInst.period === inst.period`，后台旧周期刷新会覆盖当前展示的周期；
  4. `getPrevCloseForDate`（第 25-33 行）在分钟 K 线上会把前一分钟 bar 的收盘价错当成“昨收”返回。

#### 【P1-4】降级源昨结与昨收基准混淆及精度截断（原 P0-4 / P1-5）
- **文件与行号**：[`src/js/parser.js:168, 186`](../../src/js/parser.js#L168)
- **缺陷现象**：
  `src/js/parser.js:168` 依然优先使用 `prevClose` 作为 `basePrice`，与服务端 `futuresQuoteService.js:65` 优先使用 `prevSettlement`（昨结）矛盾；国债期货 `change.toFixed(2)` 截断最小变动价位。
- **修复方案**：对齐基准取 `prevSettlement > 0 ? prevSettlement : prevClose`；动态支持 3 位小数。

#### 【P1-5】服务端期货包络硬编码 `stale: false`（原 §14 #19）
- **文件与行号**：[`server/index.js:155, 173, 193`](../../server/index.js#L155)
- **缺陷现象**：
  服务端的 `/api/cache/futures/*` 接口抛弃了 `cacheStore.getOrRefresh` 返回的真实 `stale` 字段，硬编码返回 `stale: false`，过期的陈旧数据向前端伪装为新鲜数据。

#### 【P1-6】连续与主力合约未区分且缺少动态合约目录（原 P1-7）
- **文件与行号**：[`src/js/futures/contractCatalog.js:135-152`](../../src/js/futures/contractCatalog.js#L135)
- **缺陷现象**：
  “螺纹主力”与“螺纹主连”均硬编码解析为 `'0'`（`RB0`）；缺少 `/api/cache/futures/contracts` 动态目录接口；2026 年未做合约到期合法性校验。

#### 【P1-7】前端代码剥离前缀残留下划线（原 §14 #16）
- **文件与行号**：[`src/js/app.js:298-301`](../../src/js/app.js#L298-L301)
- **缺陷现象**：
  `stripPrefix` 正则 `/^(?:sh|sz|bj|nf)?(.+)$/i` 缺少下划线匹配，输入 `nf_rb0` 时返回 `_rb0`。应改为 `/^(?:sh|sz|bj|nf_?)?(.+)$/i`。

---

### 2.3 历史未关闭的架构级 HIGH 风险项（6 项）

| 编号 | 位置 | 缺陷描述 | 修复建议 |
|---|---|---|---|
| **S-HIGH-6** | `server/cacheStore.js:51, 58-71` | 读缓存触发 `touchCacheAccess` 导致巨量磁盘写放大 | 移除读时写磁盘逻辑，改为纯内存 LRU 或定时落盘 |
| **F-HIGH-4** | `src/js/api.js:382, 394-412` | K 线 single-flight 绑定首个 AbortSignal，首个取消打崩所有并发者 | Promise 中解耦调用者的单独 signal，使用独立内部 controller |
| **F-HIGH-5** | `src/js/tradeCalendar.js:64-67` | 交易日历 AbortError 被最外层 catch 吞掉，污染工作日兜底缓存 | 在 catch 中校验 `if (e.name === 'AbortError') throw e;` |
| **A-HIGH-4** | `src/js/tts.js:45` | 语音播报队列无上限，后台滞后导致内存无限制增长 | 设置 `MAX_QUEUE_SIZE = 20`，超出时丢弃陈旧播报 |
| **C-HIGH-1** | `vite.config.js:61-171` | 代理缺少 `proxy.on('error')`，上游断开易崩溃开发服务 | 在 proxy configure 中统一定义 error handler |
| **Body超时** | `server/utils.js:33-62` | `fetchWithTimeout` 在 `finally` 中过早清除了超时定时器 | 在返回 response 前保证读取流有独立的超时保护 |
| **§8.1** | `server/momentumService.js:343` | 失败率 <= 3% 判定动量扫描为 `complete` | 真实标记状态为 `partial`，保留失败清单，不粉饰结果 |

---

## 3. 测试覆盖缺口清单

1. **核心服务端期货模块 0 单测**：`server/futures/futuresQuoteService.js` 与 `server/futures/futuresKlineService.js` 目前没有独立的单元测试或集成测试；
2. **新浪解析单测造假**：`tests/parser.test.js:171-196` 仍在使用虚构的 `nf2105` 假数据，未补充基于真实商品期货（`RB0`）与金融期货（`IF0`）抓取字符串的解析测试；
3. **CDR 689xxx 涨跌幅单测缺失**：`tests/kline.test.js:444-484` 缺少科创板 CDR 股票的 20% 涨跌幅断言；
4. **Storage QuotaExceeded 单测缺失**：缺少 localStorage 写入爆满触发 50% LRU 淘汰的断言用例。

---

## 4. 下一步建议执行批次

- **Batch 1 (P0 数据链路与图表时段阻断解除)**:
  - 修复 `futuresKlineService.js` 的新浪 JSONP 正则与字段解析；
  - 修复 `kline.js` 的 `_isContinuousTradingMinute` 和 `marketSession.js` 的 `isLiveTradeDate`（放行周六凌晨与期货日夜盘）；
  - 修复 `futuresSessionService.js` 生产日历数据注入；
  - 修复 `chartRowController.destroyCharts` 的 abort 调用。
- **Batch 2 (P1 周期聚合与生命周期健全)**:
  - 实现从日 K 聚合周 K、月 K，解除 400 报错；
  - 闭环 `chartRowController` 的 4 项生命周期缺陷；
  - 纠正 `parser.js` 的昨结基准与 `app.js` 的 `stripPrefix`。
- **Batch 3 (架构级 HIGH 缺陷治理与真实测试补齐)**:
  - 移除 `touchCacheAccess` 磁盘写放大；
  - 闭环 `api.js` single-flight AbortSignal 隔离；
  - 为 `futuresQuoteService`、`futuresKlineService` 补充真实 fixture 驱动的单测。
