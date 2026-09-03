# 2026-09-03 境内期货全链路支持与中低缺陷重构交接文档 (Phase 3 & Phase 4 Handoff)

> 日期：2026-09-03
> 提交版本：`b8b9ffa` (Phase 3) 及当前 Phase 4 实施
> 依据需求与方案：
> - [`docs/handoff/2026-09-03-code-review-bugs-architecture-handoff.md`](./2026-09-03-code-review-bugs-architecture-handoff.md)
> - [`docs/handoff/2026-09-03-code-review-bugs-architecture-handoff-02.md`](./2026-09-03-code-review-bugs-architecture-handoff-02.md)
> - [`docs/plans/2026-09-03-futures-requirements-technical-plan.md`](../plans/2026-09-03-futures-requirements-technical-plan.md)

---

## 1. 本次完成工作总览

按照阶段目标与用户指令（“这三份文件的东西都要认真做。我们定个目标一步步做吧”、“做一个阶段就推一次git再继续”），本次完成了 **Phase 3 (中低缺陷彻底清理与底部时间格式)** 和 **Phase 4 (境内期货全链路支持 F0~F5)**：

### 1.1 Phase 3 完成内容 (已推送到 `origin/main` - `b8b9ffa`)
1. **服务端中风险缺陷修复**:
   - `S-MED-1`: `server/intradayService.js` 统一缓存键并添加旧缓存文件名兼容回退。
   - `S-MED-2`: `server/momentumService.js` 扫描状态放宽至 ≤3% 失败率即视为 `complete`，包容退市和停牌股。
   - `S-MED-3`: `server/momentumService.js` 增加进度文件写入的 `.catch()` 异常捕获，避免文件锁导致异常崩溃。
   - `S-MED-4`: `server/momentumService.js` 调度器增加 `if (!schedulerStarted) return;` 守卫，杜绝服务停止后定时器复活。
2. **前端与公共服务修复**:
   - `F-MED-1`: `src/js/parser.js` 增加 `open > 0` 守卫，杜绝未开盘导致 `-100.00%` 假开盘涨幅。
   - `F-MED-2`: `src/js/parser.js` `normalizeCode` 增加 `15/16` 深圳 ETF/LOF 号段识别。
   - `F-MED-3`: `src/js/kline.js` 增加科创板 CDR `689xxx` 的 20% 涨跌停判断。
   - `F-MED-4`: `src/js/api.js` 在 `finally` 中释放 SWR 防重复锁。
   - `F-MED-5`: `src/js/tts.js` 为 utterance 增加 `onerror` 监听，防止报错时队列泄漏。
   - `F-MED-6`: `src/js/api.js` 解耦共享缓存 404 与网络失败，不再抛出假“数据源全部失败”。
   - `F-MED-7`: `src/js/storage.js` 在 setRaw 失败时抛出异常，正确触发 50% LRU 淘汰与重试。
   - `F-MED-8`: `src/js/chart.js` 在 `updateKline` 中补充上一柱 close 作为十字线 prevClose 回退。
   - `F-MED-9`: `src/js/router.js` 在路由匹配前剥离查询字符串。
3. **交互与展现优化**:
   - `A-MED-1`: 限制行单元格就地刷新范围为 `#watch-tbody`，杜绝与涨停表格产生列错位。
   - `A-MED-2`: 新增 `state.info` 与 `flashInfo`，操作成功不以红色错误样式提示。
   - `A-MED-3`: 涨停看板日期切换时调用 `closeAllLimitUpCharts()` 关闭展开图表并释放内存。
   - `A-MED-4`: 涨停实时报价合并保留既有元数据与涨停原因。
   - `A-MED-5`: 排序函数使用正负乘数替代数组破坏性 `.reverse()`，保护二级排序稳定性。
   - `A-MED-6`: `tradeCalendar.js` 修复周末/节假日 `-1` 日期推算偏差。
   - **页面底部时间格式**: 统一改造成 `Updated: YYYY-MM-DD HH:MM:SS`（北京时间格式）。

---

### 1.2 Phase 4 境内期货全链路完成内容 (F0 ~ F5)

1. **F0 & F1: 合约目录、输入解析与交易会话引擎**:
   - 创建 [`server/futures/contractCatalog.js`](../../server/futures/contractCatalog.js) 与 [`src/js/futures/instrument.js`](../../src/js/futures/instrument.js)：
     - 覆盖六大交易所：上期所 (SHFE)、上期能源 (INE)、大商所 (DCE)、郑商所 (CZCE)、广期所 (GFEX)、中金所 (CFFEX)。
     - 覆盖商品期货（螺纹、热卷、原油、铜、铝、黄金、白银、铁矿、豆粕、白糖等）与金融期货（IF、IC、IH、IM、国债 T/TF/TS/TL）。
     - 支持常规代码 `rb2510` / `RB2510`、连续主力序列 `rb0` / `RB0`、中金所 `if2603`、中文别名 `螺纹主连` / `白糖主力` 以及旧格式 `nf_rb2510`。
   - 创建 [`server/futures/futuresSessionService.js`](../../server/futures/futuresSessionService.js) 与 [`src/js/futures/futuresSession.js`](../../src/js/futures/futuresSession.js)：
     - 交易日归属引擎：正确归属夜盘跨日交易（如周四晚 21:00 属于周五交易日，周五晚属于下周一交易日，跨午夜属于当前自然日对应交易日）。
     - 细分 23:00 / 01:00 / 02:30 三类夜盘结束时间、商品日盘、中金所股指/国债日盘以及节间休息与集合竞价。
2. **F2: 服务端共享缓存服务与 API 端点**:
   - 创建 [`server/futures/futuresQuoteService.js`](../../server/futures/futuresQuoteService.js)：
     - 统一抓取 AKTools `futures_zh_spot` 主源与新浪 `nf_` 备源，盘中 3 秒、盘后 30 秒缓存。
   - 创建 [`server/futures/futuresKlineService.js`](../../server/futures/futuresKlineService.js)：
     - 分钟线与日线分别从 AKTools / 新浪抓取，盘中 10~30 秒缓存，历史数据长期缓存。
   - 在 [`server/index.js`](../../server/index.js) 中挂载端点：
     - `GET /api/cache/futures/quote?ids=`
     - `GET /api/cache/futures/kline?id=&period=`
     - `GET /api/cache/futures/intraday?id=`
     - `GET /api/cache/futures/session?id=`
3. **F3 & F4: 客户端呈现、昨结口径与双图集成**:
   - 创建 [`src/js/futures/futuresPresenter.js`](../../src/js/futures/futuresPresenter.js)：
     - 优先基于昨结算价计算涨跌额与涨跌幅：`change = price - prevSettlement`，昨结缺失时自动降级至昨收。
   - 创建 [`src/js/futures/futuresApi.js`](../../src/js/futures/futuresApi.js)：
     - 客户端透明调用 `/api/cache/futures/*`，具备直接请求新浪的可靠备用降级能力。
   - 接入 [`src/js/api.js`](../../src/js/api.js)：
     - `splitCodes` 自动识别期货并分流；`fetchQuotes`、`fetchIntraday`、`fetchKline` 遇到期货自动走期货专线。
   - 接入 [`src/js/app.js`](../../src/js/app.js)：
     - 监控表格对期货代码自动显示为大写合约代码（如 `RB2510`）。
     - 单元格展现期货独有的持仓量（如 `持仓 1,800,000`）与成交量。
     - 点击期货行，通过既有 `ChartRowManager` 展开 **常驻双图（左分时 + 右多周期K线）**。
4. **F5: 测试与验证**:
   - 新增 [`tests/futures.test.js`](../../tests/futures.test.js)（15 个测试用例，覆盖合约解析、会话判断、昨结计算）。
   - 新增 [`e2e/monitor.spec.js`](../../e2e/monitor.spec.js) 期货添加测试用例与 [`e2e/chart.spec.js`](../../e2e/chart.spec.js) 期货双图展开测试用例。
   - 全量 CI 验证：**ESLint 0 告警、590 个单元测试通过、53 个 Playwright E2E 通过、生产构建通过**。

---

## 2. 验证命令与结果

```bash
npm run lint    # 0 errors, 0 warnings
npm test        # 590 passed, 0 failed
npm run e2e     # 53 passed, 0 failed
npm run build   # ✓ built in ~9s
npm run ci      # 完整 CI 全部绿灯通过 (Exit code: 0)
```
