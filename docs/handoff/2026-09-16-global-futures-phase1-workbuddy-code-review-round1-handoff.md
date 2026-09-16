# WorkBuddy 独立代码审查 Round 1（Phase 1 国际期货落地）— 未通过

## 一、审查基本信息与通过项简述

- 被审 HEAD SHA：`43733432b612a32e69e12ba4eedcb9bdaa3bafac`（= 待审提交 `4373343`，已核对一致）
- 基准 SHA：`adf057f3baf27a2e9dd1b6e1bdc6a14cf0cbb4bb`（`adf057f`）
- 实际审查范围：`adf057f..4373343`，18 文件 / +1492 −150；工作区干净，`git pull --ff-only` 无变更；仓库无 `docs/review-checklist.md`
- 通过项（极简）：`inferAssetType` 值域与 `resolveSessionStrategy` 分派经独立探针与仓库单测复核正确；`GlobalFuturesSessionStrategy` 的冬夏结算窗口与周界（夏 05:00-06:00 / 冬 06:00-07:00、周日闭市、周六 05:00 后闭市、周一 06:00 前闭市）9/9 边界实测符合预期；`voiceSchedule.js:28` 判据已按 §3.2.2 逐字改造（`!hasExtendedHoursAssets`）且保留 `after-close` 维度，22:00 混合自选不再误关；`getPriceLimit` 返回 `null` 的消费方短路（`classifyKlineBar:372`）已补齐；TTS 货币后缀（港币/美元/无“元”）实测正确；`npm run lint` 0 问题、`npm test` 858/858、`npm run build` gzip 119.53 KB（≤125.10 KB 红线）均通过。
- 总体判定：**未通过**。**2×P1 + 3×P2 + 5×P3**。10 个外盘品种在真实执行路径上**无法获取实时报价**，且东财解析的注册表分支在生产请求字段下**恒不命中**（价格 10~100× 错位、身份退化为 `sz*`）；§5 验收断言与实现共享同一错误夹具假设，故新增测试全绿而缺陷存续。

---

## 二、审查发现与缺陷清单

### P1-1 10 个外盘期货（含港美股）无法获取任何实时报价 —— `splitCodes` 未按 §3.1.2 改造

- **文件与行号**：`src/js/api.js:99-105`（`splitCodes`）、`:163-252`（`fetchQuotes`）；对照 `src/js/api.js:31-32`（`STOCK_RE`/`FUTURE_RE`）、`:42`（新增 `TENCENT_CODE_RE`）
- **触发条件**：自选池含任一 `GL_*`（或 `hk*`/`us*`）代码时，任何一次行情刷新（`monitorController.js:37` → `fetchQuotes`）
- **实际行为**：`splitCodes` 仍只按 `stock_re.test(c)` 与 `FUTURE_RE.test(c) || isFutureCode(c)` 分桶；实测 `isFutureCode('GL_CL0') === false`、`FUTURE_RE.test('GL_CL0') === false`（`hk00700`/`usAAPL` 同）⇒ 三个新资产族**同时不属于 stocks 也不属于 futures** ⇒ `fetchQuotes` 的 `tasks` 为空数组，既不进入腾讯分支也不进入东财兜底分支。
- **期望行为**：§3.1.2 清单第 10 行明确要求「`src/js/api.js:30-31` (`STOCK_RE`, `FUTURE_RE`) … **改造为资产类型分发器，新标的不被 `buildTencentUrl` 剔除**」，即新资产必须进入抓取分支。
- **根因**：本轮只扩展了 `buildTencentUrl` 的**入参过滤器**（新增 `TENCENT_CODE_RE`），未同步扩展 `splitCodes` 的**分桶判据**；新资产在进入任何数据源分支之前即被静默丢弃（错层修复）。
- **影响范围**：10 个外盘品种的实时报价、涨跌幅、盯盘价格提醒、语音播报、批量导出全部无数据；K 线不受影响（`chartRowController.loadKline` → `buildKlineUrl` → `toEastmoneySecId('GL_CL0')` 正常），形成「有图无价」的割裂状态。
- **复现方法/运行证据**（仓库外探针，`import` 真实模块）：
  ```
  fetchQuotes(['GL_CL0']) => fetchCalls=0  quotes=0  failedCodes=["GL_CL0"]
  fetchQuotes(['hk00700']) => fetchCalls=0  quotes=0  failedCodes=["hk00700"]
  fetchQuotes(['usAAPL'])  => fetchCalls=0  quotes=0  failedCodes=["usAAPL"]
  splitCodes(['GL_CL0'])   => { stocks: [], futures: [] }
  ```
- **修复建议**：把 `splitCodes` 改为按 `inferAssetType(code)` 分桶（`STOCK_CN`/`STOCK_HK`/`STOCK_US` → 报价桶走腾讯优先、东财兜底；`FUTURES_CN` → 既有 futures 桶；`FUTURES_GLOBAL` → 走东财 `qt` + 新浪 `hf_` 备源），并让 `fetchQuotes` 的东财兜底覆盖新桶。
- **修复后验收标准**：新增用例断言 `fetchQuotes(['GL_CL0'])` 至少发起 1 次网络请求且返回 `code === 'GL_CL0'` 的报价；把 `splitCodes` 回退为旧判据时该用例必须确定性转红。

### P1-2 `parseEastmoney` 的市场号取自生产从不请求的 `f116`（实为总市值）→ 外盘/港美股注册表分支恒不命中，价格 10~100× 错位、代码身份退化为 `sz*`

- **文件与行号**：`src/js/parser.js:228-263`（关键：`:229` `const marketId = Number(d.f107 !== undefined && d.f107 !== null ? d.f107 : d.f116)`、`:230` 注册表反查、`:256-261` 兜底 `else` 分支）、`src/js/api.js:34`（`EASTMONEY_FIELDS` 不含 `f107`）
- **触发条件**：对任一非 A 股代码调用东财 `qt/stock/get`（即 `buildEastmoneyUrl` 产出的 URL）
- **实际行为**：生产字段表 `f43,f44,f45,f46,f47,f48,f50,f51,f52,f57,f58,f60,f116,f117,f169,f170` **不含 `f107`** ⇒ `d.f107 === undefined` ⇒ `marketId` 恒取 `Number(d.f116)`。真源实测（`push2delay`，2026-09-17）：`f107` 才是市场号回显（`102/101/104/134/116/107/105/1/0`），而 **`f116` 是总市值**（外盘 8 品种恒 `0`；`116.00700` 为 `3.94e12`；`1.600519` 为 `1.57e12`）⇒ `getGlobalFutureByMarketAndSymbol(marketId, f57)` 恒返回 `null`，`marketId === 116` 与 `105/106/107` 分支同样恒不可达，全部落入 `:256` 的 A 股兜底 `else`。
- **期望行为**：§5 明确要求「断言 `parseEastmoney(a50Payload).code === 'GL_A50'` 且类型为 `'futures_global'`，**杜绝 `'szcn00y'` / `'szhsi_m'` 错误身份导致报价在 `monitorController` 被丢弃**」；§3.1.2 清单第 5 行要求「**根据 `(d.f107, d.f57)` 反查注册表**」（方案自身 §5 示例即写 `f107: 102`）。
- **根因**：实现把「市场号」的来源写成 `f107 ?? f116` 回退，而 `f116` 与市场号语义无关；同时未把 `f107` 加入请求字段表，使 `f107` 分支成为死分支。`f116` 是 A 股总市值字段，被误当作市场号。
- **影响范围**：即使 P1-1 修复，10 个外盘品种 + 港美股仍会：① 代码身份变为 `szcl00y`/`szgc00y`/`szhg00y`/`szcn00y`/`szhsi_m`/`sz00700`/`szaapl`/`szspy`，被 `src/js/controllers/monitorController.js:44` 的 `currentCodes.has(quote.code)` 门禁整体丢弃（永不写入 `state.quotes`）；② `type` 退化为 `'stock'` → TTS/预警尾附「元」、表格按股票口径渲染；③ 价格按 `div100` 缩放 → 黄金 `4301.5→430.15`（10×）、美铜 `6.44→644`（100×）、恒指 `24401→244.01`（100×）、A50 `14331→1433.1`（10×）、港股 `433.4→4334`（10×）、美股 `332.41→3324.1`（10×）；④ `prevClose/high/low/f169` 同比例错位 → 涨跌幅失真、价格提醒误触发。
- **复现方法/运行证据**（探针：2026-09-17 实采 `push2delay` 真实 payload，按生产 `EASTMONEY_FIELDS` 形状喂真实 `parseEastmoney`）：**8/8 FAIL**
  ```
  生产请求字段表 = f43,...,f116,f117,f169,f170   含 f107 ? false
  FAIL GL_CL0  code=szcl00y  type=stock  price=102.15   (真值 102.15  ÷100)
  FAIL GL_GC0  code=szgc00y  type=stock  price=430.15   (真值 4301.5  ÷10)
  FAIL GL_HG0  code=szhg00y  type=stock  price=644      (真值 6.44    ÷10000)
  FAIL GL_A50  code=szcn00y  type=stock  price=1433.1   (真值 14331   ÷10)
  FAIL GL_HSI  code=szhsi_m  type=stock  price=244.01   (真值 24401   ÷1)
  FAIL hk00700  code=sz00700 type=stock  price=4334     (真值 433.4   ÷1000)
  FAIL usAAPL   code=szaapl  type=stock  price=3324.1   (真值 332.41  ÷1000)
  FAIL usSPY    code=szspy   type=stock  price=7540.5   (真值 754.05  ÷1000)
  ```
  对照：同批 payload 补上 `f107` 后 `f107` 分别为 `102/101/104/134/116/107/105` → 证明 `f107` 分支本身可用、缺陷全在字段表与取值来源。
- **修复建议**：在 `EASTMONEY_FIELDS`（`src/js/api.js:34`）追加 `f107`；`:229` 改为只取 `f107`（缺失即视为无法判定市场，走原有 A 股兜底并保持 `type:'stock'`），删除 `f116` 回退；同步修正该行的语义注释。
- **修复后验收标准**：用例必须使用**与生产字段表一致**的 payload（含 `f107`），断言 8 个 `GL_*`/`hk*`/`us*` 的 `code`/`type`/`price` 全对；把 `f107` 从字段表移除、或把 `marketId` 改回 `f116` 时用例必须确定性转红。

### P2-1 服务端共享缓存分时仍按 A 股窗口过滤 → 外盘分时被截断/清空

- **文件与行号**：`server/intradayService.js:15-18`（`SESSION_RANGES` = 09:15-11:30 / 13:00-15:00）、`:29-35`（`isTradingSessionTime`）、`:37-47`（`filterIntradaySessions`，`:152`/`:160` 消费）；受害消费方 `src/js/api.js:338-339`（`sharedCache` 命中即直接 `return cached`）
- **触发条件**：`chartRowController.loadIntraday` 以 `sharedCache: true` 拉取 `GL_*` 分时（客户端首选路径）
- **实际行为（起真实服务实测）**：
  ```
  GET /api/cache/intraday?code=GL_CL0&date=2026-09-16 → ok=true, source=eastmoney-kline-1m, n=257
  GET /api/cache/intraday?code=GL_CL0&date=2026-09-17 → ok=true, source=none,              n=0
  GET /api/cache/intraday?code=sh600519&date=2026-09-16 → ok=true,                           n=240
  ```
  同一时刻 `trends2`（`102.CL00Y`）真实报文为 **1375 根**（北京 2026-09-16 06:00 → 2026-09-17 04:54，单窗跨午夜）。外盘连续交易日被 A 股窗口切成 09:15-11:30 + 13:00-15:00 两段 → 仅剩 257 根（丢弃约 **81%**）；跨午夜段（00:00-04:54）全部越界 → 该日期下返回 **0 根但 `ok:true`**，客户端 `api.js:339` 直接采用该空结果。
- **期望行为**：§3.3.1 要求「废除 `api.js:36-39` 全局唯一的 `INTRADAY_SESSION_RANGES` … 根据标的所属策略动态获取时段范围」，§5 要求「**外盘分时无日内断裂**」。客户端 `api.js:265-285` 已完成策略化，服务端同一管线的共享缓存层未同步。
- **根因**：改造只落在浏览器侧 `api.js`，服务端存在同一硬编码的孪生实现（`server/intradayService.js` 的 `SESSION_RANGES`）未纳入改造面（同一根因的另一处未闭环）。
- **影响范围**：外盘（以及 Phase 2/3 的港股、美股）分时图在共享缓存层被静默截断或清空；仅在客户端降级到直连 `trends2` 后才"看起来正常"，而直连路径又受 P2-2 的日期切分影响。
- **修复建议**：`server/intradayService.js` 按 `inferAssetType(code)` 复用 `resolveSessionStrategy(code).getIntradaySessionRanges()`；或在路由层对非 A 股直接透传、不做窗口过滤。
- **修复后验收标准**：同一 `date` 下 `GL_CL0` 的 `/api/cache/intraday` 条数与直连 `trends2` 的条数一致（差额 0）；把服务端窗口变异回 A 股常量时用例必须转红。

### P2-2 跨午夜交易日对齐未实现（§3.3.2）→ 外盘分时按北京日历日切分

- **文件与行号**：`src/js/api.js:276-286`（`_filterIntradaySessions`，`:283` 仍为 `chartTimeToDate(it.time) !== selectedDate`）、`src/js/parser.js:485-490`（`_parseTrendRow` 内同款日期比对）；`src/js/marketSession.js:107/133/171/202/238` 导出的 `getTradingDay` **无任何生产消费点**（全仓 `grep` 仅见定义与单例对象方法）
- **触发条件**：外盘分时请求（单窗跨北京时间午夜）
- **实际行为**：真实 `trends2` 报文（`102.CL00Y`：2026-09-16 06:00 → 2026-09-17 04:54，1375 根）经真实 `parseEastmoneyTrends(json, { date })` 过滤：
  ```
  date=undefined => 1375 根
  date=2026-09-16 => 1080 根   （丢掉 09-17 00:00-04:54 共 295 根）
  date=2026-09-17 =>  295 根   （丢掉 09-16 06:00-23:59 共 1080 根）
  ```
- **期望行为**：§3.3.2 明确「**废除** `chartTimeToDate(it.time) !== selectedDate` 简单的北京日历日比对；**改为** `strategy.getTradingDay(it.time) !== selectedTradingDay`，美股 391 根分钟点统一归属于美东同日交易日，绝不截断」。
- **根因**：`getTradingDay` 契约已实现但未接线到过滤层，属「表面完成、真实执行路径未生效」。
- **影响范围**：外盘分时无论如何选日期都会丢掉跨午夜的一半左右数据（CME 单交易日 = 北京 06:00 → 次日 05:00）；Phase 3 美股的 391 根同样会被切分。
- **修复建议**：在 `_filterIntradaySessions` / `_parseTrendRow` 中以 `resolveSessionStrategy(code).getTradingDay(it.time)` 归一化归属键后比较。
- **修复后验收标准**：`GL_CL0` 单次请求返回的根数与 `trends2` 原始根数相等（1375 级别）；把比较改回 `chartTimeToDate` 时用例必须转红。

### P2-3 新增测试的报价夹具与真实接口契约不符（把 `f116` 当市场号）→ 与实现共享同一错误假设，使 P1-2 不可见

- **文件与行号**：`tests/globalFutures.test.js:112/122/129/136/143/150/157/164/171/178`（`f116: catalog.GL_*.marketId`）、`:187`/`:194`（`f116: 116` / `f116: 105`）
- **触发条件**：运行该测试文件
- **实际行为**：全部 `parseEastmoney` 用例都把市场号注入 `f116`，而生产的 `EASTMONEY_FIELDS` 从不请求 `f107`、`f116` 的真实语义是总市值。因此「用夹具能过、用真实报文 8/8 FAIL」同时成立——测试对 P1-2 **零判别力**。
- **期望行为**：§5 的断言样例本身写作 `parseEastmoney({ data: { f107: 102, f57: 'CL00Y', ... } })`；测试夹具必须与生产请求字段一致。
- **根因**：夹具由实现者按实现内部假设构造，未回真源/真请求核验字段语义（测试与实现共享同一错误假设）。
- **修复建议**：把夹具改为**捕获自真实东财响应的 payload**（含 `f107`），并额外加一条"字段表契约"用例：断言 `EASTMONEY_FIELDS` 含 `f107`。
- **修复后验收标准**：在不改产品代码、仅把夹具换成真实 payload 时该文件必须转红；产品代码按 P1-2 修复后必须全绿。

### P3-1 TTS/表格/导出未消费 `GLOBAL_FUTURES_CATALOG.priceDecimals`／`currency`（元数据死字段）

- **文件与行号**：生产者缺失——`src/js/parser.js:263-283`（`parseEastmoney` 返回对象）与 `:344-368`（`parseSinaGlobalFuture` 返回对象）均不含 `priceDecimals`/`currency`；消费者 `src/js/tts.js:226-227`、`src/js/alert.js:96-97`、`src/js/views/monitorTableView.js:97/340`、`src/js/services/batchExportService.js:107`
- **触发条件**：任意外盘报价的播报/表格渲染/导出
- **实际行为**：`priceDecimals` 恒为 `undefined` ⇒ 全部走 `: 2` 分支，与注册表登记的精度（`GL_GC0=1`、`GL_SI0=3`、`GL_HG0=4`、`GL_CL0=2`）不一致。实测：`formatQuoteSpeech({type:'futures_global',price:6.44,priceDecimals:4})` → `6.4400`，而解析器真实输出的报价 → `6.44`。
- **期望行为**：§3.1.2 TTS 行「识别 `type === 'futures_global'`，废除尾附"元"，**根据元数据播报正确货币（美元/港币）并匹配其精度**」；§5「语音单位与小数位断言」。
- **根因**：格式化侧已备好 `priceDecimals` 分支，但生产者从未把注册表元数据写入报价对象（`currency` 同样只存在于注册表）。
- **修复建议**：在 `parseEastmoney` / `parseSinaGlobalFuture` 的输出中写入 `priceDecimals` 与 `currency`（或在格式化侧按 `code` 反查 `globalCatalog`）。
- **修复后验收标准**：断言 `GL_HG0` 播报含 4 位小数、`GL_GC0` 含 1 位；把生产者字段移除时用例必须转红。

### P3-2 美股市场号探测与双层缓存未实现，未收录美股符号恒回落 `105`（错误 secid）

- **文件与行号**：`src/js/parser.js:94-113`（17 条硬编码 `US_MARKET_MAP`）、`:115-133`（`resolveUsMarketId`，`:118` `const marketId = known || '105';`）；`:120` 读取 `localStorage` 键 `market_us_${clean}`，**全仓无写入点**（`grep -rn "market_us" src server` 仅命中该读取行）；无 `/api/cache/market` 端点
- **触发条件**：任何不在 17 条映射内的美股符号走东财兜底
- **实际行为（探针）**：
  ```
  usBA  -> marketId 105 -> 105.BA  -> rc=100 data=null        （错误）
  对照 106.BA -> rc=0 f58='波音' f107=106                      （正确市场号）
  usAMD -> 105.AMD -> rc=0 f58='超威半导体'                     （偶然正确）
  localStorage 内容 = {} （无任何写入）
  ```
- **期望行为**：§3.1.1.1「未收录时对 `105/106/107` 三大市场号依次探测，首个 `rc=0` 者为准，并立即写入内存与本地持久化缓存」+ §5「未收录美股标的首次探测确立 marketId 后立即存入双层缓存；二次调用额外网络发包为 0」。
- **根因**：只落了硬编码映射表与"读缓存"，未实现探测与写缓存。
- **影响范围**：仅影响美股（Phase 3 标的）且仅在腾讯源失败时暴露；不影响 Phase 1 的 10 个外盘品种。
- **修复建议**：实现 105/106/107 顺序探测 + 内存/持久化双层写入；或明确收敛为登记表并把未登记符号显式降级为"暂不支持"而非静默用错的 secid。

### P3-3 `parseSinaGlobalFuture` 的 `quoteDate` 为 10 位带横线格式，与全仓 8 位契约不一致（对应分支成死代码）

- **文件与行号**：`src/js/parser.js:374`（`quoteDate: date`，真实值为 `'2026-09-17'`）；消费方 `src/js/kline.js:461-462`（要求 `quote.quoteDate.length === 8` 才做格式转换）、`src/js/controllers/chartRowController.js:394`（直接把它当日期键）
- **实际行为**：真实新浪报文字段 12 = `2026-09-17` ⇒ `quoteDate` 长度 **10** ⇒ `kline.js:461` 的长度守卫判为 `null` ⇒ `rawTargetDate === null` ⇒ `applyLiveQuoteToKline` 的「按日追加新 Bar」分支（`:467`）永不命中，退化为原地覆盖最后一根。同文件其余解析器（`parseTencent`）产出 8 位（`'20260916'`），契约不一致。
- **期望行为**：同一字段在全仓应保持单一格式（或在每个消费方显式兼容两种）。
- **修复建议**：`quoteDate` 统一输出 8 位（`date.replace(/-/g,'')`），或在 `kline.js`/`chartRowController.js` 兼容 10 位。
- **修复后验收标准**：备源报价的 `quoteDate.length === 8`，且复用 `applyLiveQuoteToKline` 时原本的日期分支可达。

### P3-4 `getFuturesSessionRanges` 无生产消费点 —— 计划声称的「国内期货分时区间导出」在真实路径上未生效，用例为空验收

- **文件与行号**：`src/js/futures/session.js:187`（导出）、`src/js/marketSession.js:133-136`（仅被 `chinaFuturesStrategy.getIntradaySessionRanges` 调用）、`src/js/api.js:265-274`（唯一消费者 `_isTradingSessionTime`）；单测 `tests/globalFutures.test.js:254-255`
- **实际行为**：`_isTradingSessionTime` 仅由 `_filterIntradaySessions`（`api.js:364/375/386/402`）调用，而后者仅存在于 `fetchIntraday` 的**非期货分支**；国内期货代码在 `fetchIntraday` 首行即 `if (isFutureCode(code)) return fetchFuturesIntraday(code, opts)` 提前返回（`api.js:331-333`），其分时走服务端 `/api/cache/futures/intraday`（`futuresApi.js:58-76`）。故 `getFuturesSessionRanges` 对 `RB0/AU0/T0/IF0` **不可达**，唯一消费者是测试自身（`t.true(...length > 0)` 断言恒真）。
- **期望行为**：§3.2.1「针对 `getIntradaySessionRanges(now, code)` … 策略类的 `getIntradaySessionRanges(now, code)` 直接调用该函数，**彻底解决分时图绘制与分时过滤缺乏底层时段区间支撑的隐患**」——该闭环须落在真实执行路径上。
- **根因**：把导出接到了一条对国内期货不可达的分支上（验收断言与真实路径错层）。
- **影响范围**：Phase 1 验收中「国内期货分时区间」一条无实际效果；对 Phase 1 外盘无影响（`GL_*` 非 `isFutureCode`，确实会走 `_filterIntradaySessions`，`globalFuturesStrategy` 的静态窗口生效）。
- **修复建议**：要么让国内期货分时的窗口判定也接入该导出（服务端 `futures` 分时链路），要么在报告中如实收敛该盲点结论；并补充一条"断言该函数在真实 `fetchIntraday('RB0')` 路径上被调用"的用例。

### P3-5 新增测试含恒真断言，且 §5 的多项验收断言缺项

- **文件与行号**：`tests/globalFutures.test.js:396-407`（`全局搜索候选项与内部 hf_* 集合完全不相交`）；对照 `src/js/services/stockSearchService.js:306-345`（索引来源仅 `PRODUCT_MAP` + `GLOBAL_FUTURES_CATALOG`）
- **实际行为（探针）**：`createStockSearchIndex({items: []})` 的条目中 `^hf_` 命中数为 **0**（索引构造器从不产出 `hf_*` 条目）⇒ 该断言在任何实现下都不可证伪（同义反复）。唯一有效的防线是 `normalizeCode('hf_*') === null`（已实现且已有断言），搜索侧的过滤（`stockSearchService.js:776`）为死代码。
- **§5 缺项**（计划列为验收标准但无对应用例）：① 会话与语音隔离的 `transitionNotice === null`（22:00 混合自选）；② 16:00 `['sh600519','GL_HSI']` 断言 `timerShouldRun === true`；③ 冬夏结算窗口断言（以冬/夏两个固定时钟驱动 `GlobalFuturesSessionStrategy`）；④ 代理出网兜底与 `push2delay` 轮转断言；⑤ 主备源涨跌幅跳变 `< 0.6pp` 守卫（现有用例断言的 `|changePercent − (price−prevClose)/prevClose×100| < 0.6` 是自洽性检查，与主备跳变不是同一量）；⑥ `parseSinaGlobalFuture` 15 字段**逐位**断言（现用自造样本，未覆盖字段 1 为空串的真实形态）；⑦ `inferAssetType` 全值域块缺 `assert.equal(resolveSessionStrategy('hf_CL'), globalFuturesStrategy)` 等 §3.1.1 NOTE 中的对象同一性断言。
- **修复建议**：删除/替换恒真断言为可证伪形式（如直接断言 `createStockSearchIndex` 输出集合与 `hf_` 不相交的同时，注入一个 `hf_` 条目验证过滤生效）；补齐 §5 列出的 7 项验收断言，并对每一项标注变异方式。

---

## 三、待确认风险与未验证项

**待确认风险**

1. `server/proxyService.js:63-72`：当上游返回 `status >= 500` 时只记录 `lastError` 并继续下一个候选主机，**未消费/取消该响应体**。在受限网络（`push2` 恒 502）下这是每次轮询都会走的路径，可能在连接池留下未释放的响应。本轮未做压力实测，无法量化泄漏幅度；建议在轮转实现中显式 `response.body?.cancel()` 或 `await response.arrayBuffer()` 后丢弃，并由一条"连续 5xx 后连接数不增长"的用例固化。
2. `/api/limit-up-stock`、`/api/limit-up` 两条目标为 `push2.eastmoney.com` 的路由未加入 `targets` 轮转（`server/proxyRoutes.js:11-12`）。本轮计划的 §3.1.2 只点名了 `/api/eastmoney-kline` 与 `/api/eastmoney`，故不作为缺陷；但在受限网络下涨停看板仍会阻断，建议后续一并纳入轮转。

**未验证项（受环境限制）**

1. Playwright E2E（75 项）：本机未运行（需浏览器与运行中的服务端）。已运行的门禁为 `lint`（0 问题）、`npm test`（858/858）、`npm run build`（gzip 119.53 KB）。E2E 对本次缺陷的判别力未知。
2. 真实浏览器端到端（含 `state.quotes` 写入 → 盯盘表格 → 语音）：受 P1-1/P1-2 阻断，无法在该版本上观察到"修复后"的行为，仅能以模块级探针复现缺陷。
3. `push2his` 族主机可达性：与本机探查（`UND_ERR_SOCKET`）一致，但受限网络的具体形态无法在单机复现，`fastTimeoutMs=2500ms` 的实际收益未量化。

---

## 四、推荐修复顺序与复审验收标准

**修复顺序**

1. **P1-2**（字段表补 `f107` + `marketId` 只取 `f107`）：一行级改动，且必须先修，否则 P2-3 的夹具修正后会立即暴露成片的真实性失败。
2. **P1-1**（`splitCodes` 资产分桶）：新资产进入抓取分支，使整条报价链路可达。
3. **P2-3**（测试夹具回真源）：把 `parseEastmoney` 夹具换成捕获的真实 payload，并补"字段表契约"用例——后续任何字段表回归都能被拦住。
4. **P2-1 / P2-2**（服务端窗口策略化 + 跨午夜交易日归属）：分时链路的一致性。
5. **P3-1 ~ P3-5**：精度元数据、美股探测缓存、`quoteDate` 契约、`getFuturesSessionRanges` 落点、恒真断言与 §5 缺项断言。

**复审验收标准（缺一不可）**

1. 用**捕获自真实上游**的 payload（`push2delay` + `qt/stock/get`）跑 8 个 `GL_*`/`hk*`/`us*` 用例，`code`/`type`/`price`/`prevClose` 全对；`EASTMONEY_FIELDS` 含 `f107` 有显式断言。
2. `fetchQuotes(['GL_CL0','hk00700','usAAPL'])` 至少各发起 1 次请求且返回对应代码的报价；变异 `splitCodes` 必红。
3. `/api/cache/intraday?code=GL_CL0&date=<外盘交易日>` 的条数与直连 `trends2` 条数一致（差额 0）。
4. 外盘分时按交易日归属不切分：`date` 语义与 `getTradingDay` 对齐，跨午夜不断裂。
5. `formatQuoteSpeech`/`formatAlertMessage`/表格/导出对小数列按注册表输出（`GL_GC0` 1 位、`GL_SI0` 3 位、`GL_HG0` 4 位）。
6. 上一轮 P3-4 的恒真断言被替换为可证伪形式；§5 的 7 项缺项断言补齐且每一项提供变异方式与"变异后必红"的实测结果。
7. `npm run lint` 0 问题、`npm test` 全绿（含新增用例）、`npm run build` gzip ≤125.10 KB。
