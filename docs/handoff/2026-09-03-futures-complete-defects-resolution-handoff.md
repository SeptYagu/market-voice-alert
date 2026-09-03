# 2026-09-03 境内期货全链路支持与全面代码审查缺陷闭环重构交接文档

> 日期：2026-09-03
> 依据审查报告：[docs/handoff/2026-09-03-gemini-implementation-code-review-handoff.md](./2026-09-03-gemini-implementation-code-review-handoff.md)
> 历史基线文档：[docs/handoff/2026-09-03-phase4-futures-full-pipeline-handoff.md](./2026-09-03-phase4-futures-full-pipeline-handoff.md)

---

## 1. 任务背景与核心原则

本阶段针对第三方及用户多轮 Code Review 提出的 ~72 项缺陷与偷懒行为进行严肃、深度的根因重构与闭环解决。

贯彻执行的核心设计原则：
1. **杜绝 Mock 偷懒与断言降级**：所有数据链路以真实上游（AKTools 本地服务与 Sina 期货直连接口）捕获的真实响应结构为金标准，严禁使用扁平简化 mock 充数。
2. **严防数据契约双重包装与不对齐**：全服务端统一使用 `okEnvelope`（数据存放于 `json.data`），前端 API 层全部对齐契约，彻底消除字段找不到或 `.data.data` 冗余。
3. **交易时段与跨日归属严谨化**：彻底消除将夜盘机械按 24 小时或 00:00 截断的错误；周五夜盘与周六凌晨续盘严格归属为下周一交易日；法定节假日严谨联动交易日历跳过；周日与周一凌晨坚决判定为休市。
4. **彻底消除架构反向依赖（Layer Inversion）**：前端 `src/js/futures/` 严禁反向 `import` 服务端 `server/` 目录；将纯前端数据与解析抽象至 `src/js/futures/contractCatalog.js`，服务端仅做重导出引用。
5. **分时与 K 线双图无缝联动**：分时图动态自适应期货交易时间点（夜盘 21:00-02:30 与日盘 09:00-15:00），以 `prevSettlement`（昨结）作为基准线，实时报价采用增量更新，绝不重置用户的拖拽/缩放手势。
6. **合规规范化与表头语义双重自适应**：合约代码全流程归一化为规范小写（`rb2510`, `rb0`, `if2603`）；监控列表表头自适应显示“量比 / 量”与“成交额 / 持仓”；国债期货动态支持 3 位小数精度。

---

## 2. 批次推进与 Git 提交记录

遵循用户指令：“做一个阶段就推一次git再继续”，每个阶段均完成本地校验后即刻提交并推送至 `origin/main`：

### Batch A: P0 级数据契约与上下游清洗 (Commit `6cc0a51`)
- **真实上游 Fixture 沉淀**: 在 `tests/fixtures/futures/` 中补齐 8 组从 AKTools 和 Sina 实测抓取的商品（RB）与金融（IF、T）期货行情/K线数据。
- **Sina 解析索引矫正**: 在 `src/js/parser.js` 修正新浪字段索引：
  - 商品期货：`f[10]` 昨结价、`f[13]` 持仓量、`f[14]` 成交量。
  - 金融期货（中金所 CFFEX）：`f[0]` 今开、`f[3]` 最新价、`f[6]` 持仓量、`f[14]` 昨收、`f[15]` 昨结。
- **时间解析兼容量化**: `src/js/time.js` 的 `parseBeijingDateTimeToChartSeconds` 兼容 `YYYY-MM-DD` 与 `YYYY-MM-DD HH:mm:ss`。
- **服务端单日分时过滤**: 在 `server/futures/futuresKlineService.js` 中新增 `filterMinuteBarsForTradingDay`，将东财 5 日滚动分时精确裁剪为目标交易日单日分时（~345 根柱）。
- **客户端契约对齐**: 修复 `src/js/futures/futuresApi.js` 读取 `json.data`，消除与服务端 `okEnvelope` 的不对齐。

### Batch B: 交易时段引擎与双图实时同步 (Commit `5022dc0`)
- **时段服务彻底重构**: 在 `server/futures/futuresSessionService.js` 中计算北京时间星期几与分钟偏移：
  - 周五 21:00~24:00 夜盘与周六 00:00~02:30 续盘严格归属为下周一。
  - 周日全天与周一凌晨 00:00~08:55 判定为休市。
  - 联动 `tradeCalendar`，法定节假日严格识别为休市。
- **前端时段开盘判断**: 在 `src/js/marketSession.js` 导出 `isFuturesMarketOpen` 与 `isLiveTradeDate`，放行夜盘（20:55~02:30）与日盘（09:00~15:15）轮询与图表末点更新。
- **图表昨结基准与增量更新**: 在 `src/js/chart.js`（`createIntradayChart`）中优先取 `prevSettlement` 并绘制“昨结”基准线；导出 `updatePoint` 增量更新方法，`chartRowController.js` 在行情轮询时增量追加，不重置视图。
- **动态小数位与名称自动补全**: 国债期货（TF/T/TS/TL）在 `futuresPresenter.js` 动态应用 3 位小数，未带名称的合约自动从目录字典补全中文简称。

### Batch C: 输入解析、消灭反向依赖与表头语义 (Commit `8260739`)
- **清理无用死代码**: 删除全工程无引用的无主文件 `src/js/futures/futuresSession.js`。
- **消灭架构反向依赖**: 新增 `src/js/futures/contractCatalog.js`，服务端 `server/futures/contractCatalog.js` 改为直接重导出，前端彻底切断对 `server/` 的依赖。
- **杜绝别名歧义与空前缀匹配**: 修复 `parseFutureInput`：必须有前缀且前缀匹配要求 >= 2 字符，禁止单独输入“主连”或“主力”误判；彻底剥离 `nf_` / `nf` 前缀。
- **监控列表动态表头**: 当监控列表中含有期货时，表头动态切换为“量比 / 量”与“成交额 / 持仓”，国债期货行价格展示 3 位小数。
- **服务端周期白名单**: 在 `futuresKlineService.js` 中强制校验 `period` 白名单，非法周期拦截并返回 HTTP 400。

### Batch D: E2E 真实性对齐与端到端用例 (Commit `8ce0947`)
- **E2E Mock 动态与真实化**: 在 `e2e/helpers.js` 中支持多合约查询解析，严格区分商品与金融期货字段，修正连续合约正则 `/^[A-Za-z]+0$/`，杜绝 `rb2510` 等以 0 结尾的具体月份合约被误判为连续合约。
- **新增全链路 E2E 规格**: 新增 `e2e/futures.spec.js`，完整覆盖期货代码添加、动态表头自适应、中文别名与股指期货连续合约输入、内嵌图表展开、周期切换及折叠。
- **全套 56 个 Playwright 测试 100% 通过**。

### Batch E: 国债期货高精度与代码健康审查 (Commit `bf2ad61`)
- **服务端行情精度与 priceTick 附带**: 在 `server/futures/futuresQuoteService.js` 中动态判断国债期货的 `priceTick < 0.01` 并保留 3 位小数涨跌幅计算，缓存输出带上 `priceTick`。
- **代码规范与质量严审**: 全工程通过 `npm run lint`（0 error, 0 warning），全部 602 个 QUnit 单元测试通过。

---

## 3. 全量测试与质量指标速览

1. **QUnit 单元测试**:
   - `602` 项测试全部通过（0 fail, 0 skip）。
2. **ESLint 静态代码规范**:
   - 0 error, 0 warning。
3. **Playwright 端到端测试**:
   - `56` 个 E2E 用例全部通过。
4. **生产环境打包**:
   - `npm run build` 成功完成，0 警告。
5. **页面底部时间显示**:
   - 格式统一为 `Updated: YYYY-MM-DD HH:MM:SS`（北京时间格式）。

---

## 4. 关键源码分布

- 境内期货纯前端字典与解析: [`src/js/futures/contractCatalog.js`](../../src/js/futures/contractCatalog.js)
- 期货行展示与动态表头自适应: [`src/js/app.js`](../../src/js/app.js)
- 期货交易时段引擎与交易日归属: [`server/futures/futuresSessionService.js`](../../server/futures/futuresSessionService.js)
- 分时图与昨结参考线: [`src/js/chart.js`](../../src/js/chart.js)
- 境内期货 E2E 自动化测试集: [`e2e/futures.spec.js`](../../e2e/futures.spec.js)
- 真实抓取 Futures Fixtures: [`tests/fixtures/futures/`](../../tests/fixtures/futures/)