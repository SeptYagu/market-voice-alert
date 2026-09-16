# 国际期货与国际股票接入可行性调研与架构设计方案 (Handoff v3 - 闭环审查修订单)

> **文档性质**：需求可行性调研、系统架构演进规划与全链路实施方案（WorkBuddy Round 2 审查后全量闭环版）  
> **适用项目**：股票期货实时监控助手 (`market-voice-alert`)  
> **日期**：2026-09-16  
> **状态**：Round 2 审查缺陷（2×P2 + 5×P3）已全面修正，提交 Round 3 复审

---

## 1. 背景与目标

### 1.1 历史边界梳理
在项目早期的技术规格文档及需求规划中：
1. [`SPEC.md`](../../SPEC.md)：核心定位为“实时监控中国A股、期货市场价格”，代码规范仅支持 `sh`/`sz`/`bj` 前缀。
2. [`docs/plans/2026-09-03-futures-requirements-technical-plan.md`](../plans/2026-09-03-futures-requirements-technical-plan.md)：§3.2 与 §12.1 明确将“外盘期货、外汇、数字货币、期权”划定为 Out of Scope，仅支持中国境内六家期货交易场所（上期所、上期能源、大商所、郑商所、广期所、中金所）。
3. [`docs/requirements-stock-search-suggest.md`](../requirements-stock-search-suggest.md)：§1.1 明确“ETF、指数、债券、B 股、港美股名称联想及完整月份合约目录不在本期范围”。

### 1.2 本方案演进诉求与覆盖标的
随着用户跨市场资产监控诉求的提出，本方案评估并确立将监控范围扩展至：
1. **国际/外盘主流期货**：COMEX（纽约黄金、白银、美铜）、NYMEX（美原油、天然气）、CME（纳指期货、标普期货、道指期货）、SGX（富时中国A50 `GL_A50`）、HKFE（恒生指数期货 `GL_HSI`）；
2. **国际股票**：港股（腾讯控股、阿里巴巴等）、美股（苹果、特斯拉、英伟达等）。

---

## 2. 外部数据源可行性与实测核验（真源复测校正版）

经 2026-09-16 现场实测与多轮真源复核，公网免费数据源覆盖情况与约束如下：

### 2.1 国际期货（外盘期货）实测与契约约束
* **实时报价源（Sina）**：新浪外盘期货接口 `https://hq.sinajs.cn/list=hf_{CODE}`
  * 必须带请求头 `Referer: https://finance.sina.com.cn`。
  * 实测响应延时 `< 100ms`，原生格式（15 字段）：
    `var hq_str_hf_CL="99.903,,99.940,99.960,100.610,99.360,13:58:38,100.750,100.460,0,1,17,2026-09-16,纽约原油,0";`
  * **字段逐位映射核验**：
    * `0`: 最新价（99.903）
    * `1`: 买价（通常为空）
    * `2`: 买一（99.940）
    * `3`: 卖一（99.960）
    * `4`: 最高价（100.610）
    * `5`: 最低价（99.360）
    * `6`: 报价时间（13:58:38）
    * `7`: 昨结算（100.750）
    * `8`: 今开盘（100.460）
    * `9`: 持仓量（**可用性纠偏**：CME/NYMEX/COMEX 品种盘中恒为 0，因交易所持仓量为日终一次性公布；仅 SGX A50 `CHA50CFD` 与 HKFE `HSI` 盘中返回非零实时持仓量）
    * `10, 11`: 买卖量
    * `12`: 报价日期（2026-09-16）
    * `13`: 品种中文名称（纽约原油）
    * `14`: 状态位
* **分时走势与历史 K 线（Eastmoney）**：
  * **主机轮转架构**：单主机 `push2.eastmoney.com` 对 `trends2` 存在高频 502，必须复用仓库既有 `EASTMONEY_TRENDS_HOSTS` 多主机轮转机制（`1.push2.eastmoney.com`、`90.push2his.eastmoney.com`）。
  * **按交易所精准分发 secid 市场号（彻底纠偏与真实市场号对齐）**：
    东财外盘期货按交易所分设不同市场分类，经全量 `clist` 实测校验：
    * `m:101` = COMEX 贵金属与铜（黄金 `101.GC00Y`、白银 `101.SI00Y`、美铜 `101.HG00Y`，全市场 104 只）
    * `m:102` = NYMEX 能源化工（美原油 `102.CL00Y`、天然气 `102.NG00Y`，全市场 117 只）
    * `m:103` = CME/CBOT 指数利率与农产品（标普期货 `103.ES00Y`、纳指期货 `103.NQ00Y`、道指期货 `103.YM00Y`，全市场 178 只）
    * `m:104` = SGX 新加坡期货（**实测确认**：A50期指连续合约为 `104.CN00Y`，`f58=A50期指当月连续`，全市场 33 只）
    * `m:134` = 港/亚洲指数期货（**实测确认**：全市场 112 只，含恒生指数期货主力 `134.HSI_M`、前月合约 `134.HSIU6` 以及小型恒指 `134.MHI*`；实测 `qt/stock/get` `f58=恒生指数期货主力`、昨结 `f60=24676`，`trends2` n=914，`kline(klt=1)` n=913 全部可用；新浪 `hf_HSI` 字段 7 昨结 24676.000 与东财 `f60` 完全同源一致）
    * **市场号与主机说明**：`m:100` 实为国际指数现货市场（含现货 `100.HSI` 与 `100.XIN9`，非期货合约）；真实恒生指数期货位于 `m:134`；轮转主机 `push2delay.eastmoney.com` 与 `push2his.eastmoney.com` 实测均可稳定拉取 `m:134` 与 `m:100-104` 的 `trends2` 与 `kline` 数据。

### 2.2 港股（HK Stocks）实测
* **实时报价**：腾讯 `https://qt.gtimg.cn/q=r_hk00700`（五位代码，实测 78 字段，取值条件：盘中实测验证），时间格式为 `YYYY/MM/DD HH:mm:ss`。
* **分时走势与历史 K 线**：东财 `secid=116.00700`
  * **端点与根数口径明确区分**：
    * **分时走势（`trends2` 口径）**：首根含 09:30 开盘点，早盘 09:30–12:00 共 **151 根**；午后无 13:00 点，由 13:01 起步，午盘 13:01–16:00 共 **180 根**。全日合计 **331 根**。
    * **1 分钟 K 线（`klt=1` 口径）**：首根从 09:31 开始，早盘 09:31–12:00 共 **150 根**；午盘 13:01–16:00 共 **180 根**。全日合计 **330 根**。

### 2.3 美股（US Stocks）实测
* **实时报价**：腾讯 `https://qt.gtimg.cn/q=usAAPL`（美股 payload 基准 71 字段[非交易时段实测]，上游偶发追加 2 个尾部空字段使总数达 73 字段；解析器须使用下限守卫 fields.length >= 35 或 >= 71，不得以总数做等值断言），常规收盘价位于 f3，时间格式为 `YYYY-MM-DD HH:mm:ss`。
* **分时走势与历史 K 线**：东财 `secid=105.AAPL`（纳斯达克）/ `secid=106.BABA`（纽交所）。
  * `trends2` 端点口径为 **391 根**（含美东 09:30 开盘集合快照，至 16:00 结束共 391 点）；对应 `klt=1` 1分钟K线口径为 **390 根**（从 09:31 开始）。

---

## 3. 系统核心改造点与架构设计

### 3.1 资产领域模型（Domain Model）与代码命名空间隔离
为彻底杜绝外盘代码（如白银 `SI0`）与国内既有品种（广期所工业硅 `gfex/SI0`）发生标识冲突与静默误路由，确立**前缀命名空间（Namespaced Identifier）**与独立元数据目录：

```js
export const ASSET_TYPES = Object.freeze({
  STOCK_CN: 'stock_cn',           // A股 (sh600519, sz000001, bj830001)
  FUTURES_CN: 'futures_cn',       // 国内期货 (RB0, IF2603, SI0[工业硅])
  FUTURES_GLOBAL: 'futures_global', // 外盘期货 (GL_CL0, GL_GC0, GL_SI0[白银], GL_A50, GL_HSI)
  STOCK_HK: 'stock_hk',           // 港股 (hk00700, hk09988)
  STOCK_US: 'stock_us'            // 美股 (usAAPL, usTSLA, usNVDA)
});
```

#### 3.1.1 外盘期货元数据与 secid 静态显式注册表（真源实测对齐版）
在 `src/js/futures/globalCatalog.js` 中逐品种显式注册映射：

| 内部统一代码 | 品种名称 | 计价货币 | 新浪报价符号 | 东财 secid | 交易场所 | 走势图可用性 |
|---|---|---|---|---|---|---|
| `GL_CL0` | 纽约原油 | `USD` | `hf_CL` | `102.CL00Y` | NYMEX | 实时报价 + 分时 + K线 |
| `GL_GC0` | 纽约黄金 | `USD` | `hf_GC` | `101.GC00Y` | COMEX | 实时报价 + 分时 + K线 |
| `GL_SI0` | 纽约白银 | `USD` | `hf_SI` | `101.SI00Y` | COMEX | 实时报价 + 分时 + K线（隔离国内工业硅） |
| `GL_HG0` | 纽约美铜 | `USD` | `hf_HG` | `101.HG00Y` | COMEX | 实时报价 + 分时 + K线 |
| `GL_NG0` | 天然气 | `USD` | `hf_NG` | `102.NG00Y` | NYMEX | 实时报价 + 分时 + K线 |
| `GL_NQ0` | 纳斯达克期货 | `USD` | `hf_NQ` | `103.NQ00Y` | CME | 实时报价 + 分时 + K线 |
| `GL_ES0` | 标普500期货 | `USD` | `hf_ES` | `103.ES00Y` | CME | 实时报价 + 分时 + K线 |
| `GL_YM0` | 道琼斯期货 | `USD` | `hf_YM` | `103.YM00Y` | CME | 实时报价 + 分时 + K线 |
| `GL_A50` | 富时中国A50 | `USD` | `hf_CHA50CFD` | `104.CN00Y` | SGX | 实时报价 + 分时 + K线（更正为实测 m:104） |
| `GL_HSI` | 恒生指数期货 | `HKD` | `hf_HSI` | `134.HSI_M` | HKFE | 实时报价 + 分时 + K线（东财 m:134 主力合约，新浪 hf_HSI 作备源） |

* **真实有效的解析层隔离与冲突防护断言**：
  ```js
  // 单元测试中验证解析层正交性，确保国内代码与外盘代码分派完全正确且互不污染
  import { parseFutureInput, isFutureCode } from '../src/js/futures/instrument.js';
  import { inferMarket } from '../src/js/parser.js';

  // 1. 验证国内 SI0 依然严格解析为广期所工业硅，绝不走外盘通道
  const domesticSi = parseFutureInput('SI0');
  assert.equal(domesticSi?.exchange, 'gfex');
  assert.equal(domesticSi?.name, '工业硅连续');
  assert.equal(isFutureCode('SI0'), true);

  // 2. 验证国内期货目录绝不误识外盘代码（严格返回 null / false）
  assert.equal(parseFutureInput('GL_SI0'), null);
  assert.equal(isFutureCode('GL_SI0'), false);
  assert.equal(parseFutureInput('hf_SI'), null);
  assert.equal(isFutureCode('hf_SI'), false);

  // 3. 验证股票市场推断器 inferMarket 保持对 A 股准确识别且对外盘返回 null
  assert.equal(inferMarket('sh600519'), 'sh');
  assert.equal(inferMarket('GL_SI0'), null);
  ```

  > [!NOTE]
  > 上述断言完全基于仓库既有导出模块直接可执行。在 Phase 1 落地阶段，按 §3.1.2 清单新增导出 `inferAssetType(code)` 后，将补充全值域正交断言（`assert.equal(inferAssetType('SI0'), 'futures_cn')`，`assert.equal(inferAssetType('GL_SI0'), 'futures_global')` 等）。

#### 3.1.2 归一化全链路改造点清单（覆盖全仓 9 处真实行号与消费点）

| 层级 | 文件位置 | 既有逻辑 | 改造目标 |
|---|---|---|---|
| **服务端** | `server/utils.js:76-86` (`normalizeCodeParam`) | 仅匹配 `^(sh\|sz\|bj)\d{6}$` 或 6 位纯数字，其余返空 | 支持 `hk\d{5}`、`us[A-Za-z]+`、`GL_[A-Z0-9]+`、`hf_[A-Za-z0-9_]+` |
| **服务端** | `server/marketData.js:160, 194` | `normalizeCodeParam(code).slice(2)` 取数字 | 接入资产感知，按资产类型分发各市场的东财 secid 与 Aktools 参数 |
| **客户端** | `src/js/parser.js:11-25` (`normalizeCode`) | 仅识别 `sh/sz/bj` | 扩展并新增导出 `inferAssetType(code): string`（契约值域严格对照 `ASSET_TYPES`：`GL_` 前缀 → `'futures_global'`；`sh/sz/bj`+6位 → `'stock_cn'`；`hk`+5位 → `'stock_hk'`；`us`+字母 → `'stock_us'`；`isFutureCode(code)===true` → `'futures_cn'`；其余或未知代码统一兜底回退 `'stock_cn'`），同时改造 `normalizeCode` 统一输出规范化资产对象 `{ code, type, market }` |
| **客户端** | `src/js/parser.js:42` (`TENCENT_LINE_RE`) | 正则 `v_([a-z]{2}\d{6})` | 扩展为支持 `v_((?:sh\|sz\|bj)\d{6}\|r_hk\d{5}\|us[A-Za-z]+)` |
| **客户端** | `src/js/parser.js:64` (时间字段校验) | 硬编码 `^\d{14}$` (如 20260916142000) | 兼容港股 `YYYY/MM/DD HH:mm:ss` 与美股 `YYYY-MM-DD HH:mm:ss` |
| **客户端** | `src/js/parser.js:129` (`SINA_FUTURE_RE`) | 正则 `hq_str_(nf_?[a-z0-9]+)` | 扩展支持 `hq_str_(?:nf_?[a-z0-9]+\|hf_[A-Za-z0-9_]+)` 并挂载 `parseSinaGlobalFuture` |
| **客户端** | `src/js/api.js:30-31` (`STOCK_RE`, `FUTURE_RE`) | 仅支持国内 A 股与国内期货 | 改造为资产类型分发器，新标的不被 `buildTencentUrl` 剔除 |
| **客户端** | `src/js/kline.js:210, 218, 232` (`STOCK_CODE_RE`) | 仅处理 6 位 A 股 | 修正行号：声明于 210，分别守卫 218 (`buildTencentKlineUrl`) 与 232 (`buildTencentYearKlineUrl`)，改造为分发港股、美股与外盘 |
| **客户端** | `src/js/kline.js:326-341` 与消费方 `:347, 360-367` | 默认回落 10% 涨跌停判定 | **双端改造**：`getPriceLimit` 非 A 股返回 `null`；消费方 `classifyKlineBar`（`:347` `const lim = Number(limit) \|\| 10;`）增加 `limit === null` 显式短路保护直接返回 `'normal'`，不再经 `Number(limit) \|\| 10` 回落，彻底消除非 A 股涨跌停假标记 |

---

### 3.2 交易会话（Market Session）解耦与语音调度防污染契约

#### 3.2.1 策略模式（Strategy Pattern）接口契约
```ts
interface MarketSessionStrategy {
  readonly assetType: string;
  isTradingNow(now: Date): boolean;
  getSession(now: Date): 'pre-open' | 'trading' | 'lunch' | 'after-close' | 'closed';
  getIntradaySessionRanges(now: Date): Array<[startMinutes: number, endMinutes: number]>;
  getTradingDay(now: Date): string; // YYYY-MM-DD
}
```

1. **`ChinaStockSessionStrategy`**：保持原 09:30-11:30, 13:00-15:00 与节假日日历不变。
2. **`ChinaFuturesSessionStrategy`**：保持原日夜盘、节前夜无夜盘、品种闭市时点不变。
3. **`HkStockSessionStrategy`**：早盘 09:30-12:00，午盘 13:00-16:00；独立香港交易日历。
4. **`UsStockSessionStrategy`**：
   * 采用纯函数 `isUsDaylightSavingTime(date)` 严格判定美东夏冬令时（每年 3 月第二个周日 至 11 月第一个周日）；
   * 夏令时常规时段：北京时间 21:30 - 次日 04:00；冬令时：北京时间 22:30 - 次日 05:00；
   * 美东交易日归属：以美东本地日历日作为该交易日分时的唯一归属键，解决跨午夜拆分问题。
5. **`GlobalFuturesSessionStrategy`（彻底修复冬夏令时休市双变体）**：
   * CME 电子盘连续交易（周一开盘至周六收盘）；
   * **每日结算休市窗口（CT 16:00–17:00）随 DST 纯函数动态分派**：
     * **夏令时（CDT）**：北京时间 **05:00–06:00** 结算休市（实测符合当前夏令时 06:00 首根 Bar）；
     * **标准时 / 冬令时（CST）**：北京时间 **06:00–07:00** 结算休市（严禁在冬季将 05:00–06:00 真实交易段作为休市剔除！）。

#### 3.2.2 调度分派器（含 Default 安全兜底）与全局语音防污染
```js
export function resolveSessionStrategy(code) {
  const asset = inferAssetType(code);
  switch (asset) {
    case ASSET_TYPES.STOCK_CN: return chinaStockStrategy;
    case ASSET_TYPES.FUTURES_CN: return chinaFuturesStrategy;
    case ASSET_TYPES.STOCK_HK: return hkStockStrategy;
    case ASSET_TYPES.STOCK_US: return usStockStrategy;
    case ASSET_TYPES.FUTURES_GLOBAL: return globalFuturesStrategy;
    default:
      // 缺省安全兜底：记录警告并回落到基础 A 股策略，防止未知代码解引用抛错拖垮主调度引擎
      console.warn(`[Session] Unknown asset code: ${code}, fallback to ChinaStockStrategy`);
      return chinaStockStrategy;
  }
}
```

* **多资产 Any-Trading 调度与安全收窄**：
  * 只要自选池中有**任一标的**处于交易时段（`anyTrading`），全局语音状态机**绝不进入 autoStop 关闭**；
  * 在北京时间 22:00（A股收盘、美原油/美股交易中），A 股标的静默跳过，外盘标的正常播报，绝不播报“已收盘”，绝不误关语音。

---

### 3.3 分时与 K 线数据管线改造（消除 A 股硬编码与冬夏动态适配）

1. **分时交易窗口参数化**：
   * 废除 `api.js:36-39` 全局唯一的 `INTRADAY_SESSION_RANGES = [[9:15,11:30],[13:00,15:00]]`；
   * 改为在 `_filterIntradaySessions(items, code, now)` 中动态获取：
     * A 股：`[[555, 690], [780, 900]]`
     * 港股：`[[570, 720], [781, 960]]`（13:01–16:00，与实测无 13:00 点相符）
     * 美股：夏令时 `[[1290, 1440], [0, 240]]`；冬令时 `[[1350, 1440], [0, 300]]`
     * 外盘期货：全天窗口，随 DST 纯函数动态剔除每日结算窗口（夏令时剔除 05:00–06:00，冬令时剔除 06:00–07:00）。
2. **交易日跨午夜对齐**：
   * 废除 `chartTimeToDate(it.time) !== selectedDate` 简单的北京日历日比对；
   * 改为 `strategy.getTradingDay(it.time) !== selectedTradingDay`，美股 391 根分钟点统一归属于美东同日交易日，绝不截断。

---

### 3.4 报价源与图表源合约及基准对齐机制（5% 偏离闭环）

1. **统一合约锚点（Single Source / Consistent Anchor）**：
   * 外盘期货**优先采用东方财富作为第一数据源**（实时行情 `qt/stock/get?secid=...` 与 `trends2` 分时图同源）；
   * 两者直接共享同源的 `preClose` 昨结算价基准，保证最新价、涨跌幅与分时图末端价格 100% 吻合。
2. **新浪备源切换与昨结基准对齐机制**：
   * 所有外盘期货均以东方财富为第一数据源（分时与 K 线同源）；新浪 `hf_` 仅作为全量实时报价备用源；
   * 当切至新浪 `hf_` 备用源时，显式使用新浪字段 7（昨结）重校基准。经真源实测核验：新浪 `hf_HSI` 昨结（24676.000）与东财 `134.HSI_M` `f60`（24676）完全一致；新浪 `hf_CHA50CFD` 昨结（14271.000）与东财 `104.CN00Y` `f60`（142710）完全一致，保证第一源与备源切换时价格基准无缝对接。

---

### 3.5 语音播报（TTS）与货币单位适配

* **按品种元数据定义货币（废除按资产粗暴推断）**：
  * A 股 / 国内期货：`CNY`（播报“元”）
  * 港股 / 恒指期货（`GL_HSI`）：`HKD`（播报“港币”）
  * 美股 / 美原油 / 黄金 / A50：`USD`（播报“美元”）
* **英文代码与中文名播报规则**：
  * 美股优先播报注册中文名（如“苹果”），无中文名拼读字母；外盘期货直接播报品名（如“纽约原油”）。

---

## 4. 分阶段演进实施路线图（Roadmap）

```mermaid
gantt
    title 国际品种接入分阶段实施计划 (v4)
    dateFormat  YYYY-MM-DD
    section Phase 1 外盘主流期货
    建立 globalCatalog 与实测 secid 表     :2026-09-17, 2d
    全仓 9 处代码归一化改造 & 东财多主机接入 :2026-09-19, 2d
    多时区会话策略与语音调度防污染         :2026-09-21, 2d
    外盘期货离线/在线单测与门禁验证        :2026-09-23, 1d
    section Phase 2 港股接入
    港股代码接入与五位代码解析             :2026-09-24, 2d
    港股时段 (09:30-16:00) 与分时 331 根   :2026-09-26, 2d
    section Phase 3 美股接入
    美东冬夏令时纯函数与美东日期归属       :2026-09-28, 3d
    美股跨午夜 391 根分时与报价解析        :2026-10-01, 2d
```

### Phase 1: 外盘主流期货（首批 10 个高频品种）
* **标的范围**：`GL_CL0`(原油)、`GL_GC0`(黄金)、`GL_SI0`(白银)、`GL_HG0`(美铜)、`GL_NG0`(天然气)、`GL_NQ0`(纳指)、`GL_ES0`(标普)、`GL_YM0`(道指)、`GL_A50`(富时A50)、`GL_HSI`(恒指期货)。
* **关键成果**：打通多主机东财外盘分时/K线（覆盖全部 10 个品种，含 m:134 恒指期货） + 新浪备源，落地会话策略解耦，消除国内标的回归隐患。

### Phase 2: 港股接入（时差为零）
* **标的范围**：港股五位代码全量支持输入，头部 30 只恒生科技成份股支持拼音联想。

### Phase 3: 美股接入（攻克冬夏令时与跨夜分时）
* **标的范围**：美股代码直接输入添加，头部标普/纳指成分股拼音联想。

---

## 5. 验收标准与单一可测量门禁规范

1. **防回归严格门禁**：
   * 既有 A 股与国内期货所有 843 项 QUnit 单元测试与 75 项 Playwright E2E 测试保持 **100% PASS**。
2. **新资产功能验收断言**：
   * **secid 有效性**：Phase 1 全部 10 个品种均具备明确的东财 secid，且均能成功通过 `qt` + `trends2` + `kline` 三端点拉取行情与图表，新浪 `hf_` 作为全量备源；
   * **防误路由断言**：断言 `parseFutureInput('SI0')` 保持国内工业硅，而 `GL_SI0` / `hf_SI` 准确映射为 COMEX 白银；
   * **冬夏结算窗口断言**：以冬令时/夏令时两个固定时钟驱动 `GlobalFuturesSessionStrategy`，分别断言结算窗口为 `06:00-07:00` 与 `05:00-06:00`；
   * **限价带短路断言**：断言非 A 股标的的 `classifyKlineBar` 返回 `'normal'`，无涨跌停带；
   * **会话与语音隔离断言**：在北京时间 22:00 注入自选 `['sh600519', 'GL_CL0']`，断言调度器输出 `pause=false, autoStop=false`，美原油正常获得播报，且不播报“已收盘”；
   * **分时完整性断言**：美股分时图 391 根（trends2）数据点无截断丢失，外盘分时无日内断裂。
3. **单一客观性能红线**：
   * **构建体积门禁**：生产打包产物 `dist/assets/index-*.js` 的 Gzip 压缩后体积相比基准增量 **≤ 10.0 KB**（当前 Gzip 基准为 115.10 KB，构建后不得超过 125.10 KB）；
   * **静态词库增量**：新增国际品种词典静态 JSON 增量 **≤ 25.0 KB**。
