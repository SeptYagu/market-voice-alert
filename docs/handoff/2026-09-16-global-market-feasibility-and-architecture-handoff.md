# 国际期货与国际股票接入可行性调研与架构设计方案 (Handoff v12 - 5大工程落地盲点全量闭环定稿版)

> **文档性质**：需求可行性调研、系统架构演进规划与全链路实施方案（5 大工程实施盲点闭环与直接实施定稿版）  
> **适用项目**：股票期货实时监控助手 (`market-voice-alert`)  
> **日期**：2026-09-16  
> **状态**：Round 10 审查闭环后进一步对 5 项工程落地关键细节（美股特殊符号正则、探测缓存保护、国内期货分时区间导出、出网代理降级超时与换月自适应锚定）实现 100% 闭环，方案完全定稿，直接启动 Phase 1 编码落地

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
  * 实测响应延时（注：同出口实测量级，新建 TLS 连接建立约 200~600ms，连接复用后约 200ms），原生格式（15 字段）：
    `var hq_str_hf_CL="99.903,,99.940,99.960,100.610,99.360,13:58:38,100.750,100.460,0,1,17,2026-09-16,纽约原油,0";`
  * **字段逐位映射核验**：
    * `0`: 最新价（99.903）
    * `1`: 买价（通常为空）
    * `2`: 买一价（99.940）
    * `3`: 卖一价（99.960）
    * `4`: 最高价（100.610）
    * `5`: 最低价（99.360）
    * `6`: 报价时间（13:58:38）
    * `7`: 昨结算（100.750）
    * `8`: 今开盘（100.460）
    * `9`: 持仓量（**可用性纠偏**：CME/NYMEX/COMEX 品种盘中恒为 0，因交易所持仓量为日终一次性公布；而 SGX A50 `CHA50CFD` 与 HKFE `HSI` 盘中返回非零实时持仓量）
    * `10, 11`: 买卖盘量
    * `12`: 报价日期（2026-09-16）
    * `13`: 品种中文名称（纽约原油）
    * `14`: 状态位
* **分时走势与历史 K 线（Eastmoney）**：
  * **主机轮转与浏览器代理出网约束（彻底闭环）**：
    * **受限网络实测现象**：在受限网络环境实测（2026-09-16，单主机实测），`push2his.eastmoney.com`、`90.push2his.eastmoney.com` 与 `1.push2.eastmoney.com` 全部出现 `UND_ERR_SOCKET` 连接重置，`push2.eastmoney.com` 恒 502；在此环境下，仅 `push2delay.eastmoney.com` 返回 200 `rc=0` 稳定可达。
    * **全链路改造要求与防雪崩超时策略（5大工程盲点闭环 4）**：现有架构中，服务端 `EASTMONEY_TRENDS_HOSTS`（`server/marketData.js:18-22`）与 `server/klineService.js:95` 仅覆盖服务端缓存抓取，而浏览器前端请求路径（`src/js/api.js:52` `/api/eastmoney/qt/stock/get`、`src/js/api.js:66` `/api/eastmoney-kline/qt/stock/trends2/get`、`src/js/kline.js:73` `/api/eastmoney-kline/qt/stock/kline/get`）经由 `server/proxyRoutes.js:10`（目标硬编码 `push2his.eastmoney.com`）与 `server/proxyRoutes.js:13`（目标硬编码 `push2.eastmoney.com`），以及 `server/klineService.js:40`（默认 host 硬编码 `push2his.eastmoney.com`）和 `server/proxyService.js:10, 31`（代理分派与 fetch 执行）。
      * **防雪崩超时与主机健康缓存机制**：`proxyService.js:35` 既有的 `timeoutMs: 15_000`（15秒）在受限网络下（如 `push2his` 发生挂死/重置）会导致前端 3s~5s 轮询请求严重堆叠阻塞甚至浏览器连接池耗尽。因此，多主机轮转时**必须引入快速探测超时（`fastTimeoutMs: 2500ms`）**：在尝试首选主机时若超过 2.5s 或失败，立即降级轮转至 `push2delay.eastmoney.com`；一旦备用主机成功，在内存中对该健康目标维持 **60 秒健康缓存**，后续请求直接直连 `push2delay`，TTL 过期前不重复触发挂死主机的 2.5s 等待，彻底消除前端刷新雪崩。
  * **按交易所精准分发 secid 市场号（彻底纠偏与真实市场号对齐）**：
    东财外盘期货按交易所分设不同市场分类，经全量 `clist` 实测校验：
    * `m:101` = COMEX 贵金属与铜（黄金 `101.GC00Y`、白银 `101.SI00Y`、美铜 `101.HG00Y`，全市场 104 只）
    * `m:102` = NYMEX 能源化工（美原油 `102.CL00Y`、天然气 `102.NG00Y`，全市场 117 只）
    * `m:103` = CME/CBOT 指数利率与农产品（标普期货 `103.ES00Y`、纳指期货 `103.NQ00Y`、道指期货 `103.YM00Y`，全市场 178 只）
    * `m:104` = SGX 新加坡期货（**实测确认**：A50期指连续合约为 `104.CN00Y`，`f58=A50期指当月连续`，全市场 33 只）
    * `m:134` = 港/亚洲指数期货（**实测确认**：全市场 112 只，含恒生指数期货主力 `134.HSI_M`、前月合约 `134.HSIU6` 以及小型恒指 `134.MHI*`；实测 `qt/stock/get` `f58=恒生指数期货主力`、日盘昨结 `f60=24676`，`trends2` 与 `kline(klt=1)` 均 ≥900 根[随交易时段累积，16:18 实测 `trends2` 964 根、`kline` 963 根]；**日盘结算后（16:30 后）**新浪 `hf_HSI` 字段 7 昨结 24676.000 与东财 `f60` 1:1 对齐，夜盘转场衔接详见 §3.4.2 与复采记录表）
    * **市场号说明**：`m:100` 实为国际指数现货市场（含现货 `100.HSI` 与 `100.XIN9`，非期货合约）；真实恒生指数期货位于 `m:134`。
  * **端点报价单位逐品种实测（东财内部 qt 端点原始报价除数与新浪换算）**：
    * **真源多轮实测**：东财 `qt/stock/get` 端点输出的原始价格字段（`f43`最新、`f44`最高、`f45`最低、`f46`今开、`f60`昨结、`f169`涨跌额）是以各品种最小报价单位整数表达。同一时刻对比同源 `trends2` 末根、昨结与新浪真源，各品种真实缩放除数 (`qtDivisor`) 逐品种不同（0.0001 至 1 共 5 档）：
      * `GL_CL0` (`102.CL00Y`): `qt` 10445 / `trends2` 104.45 → **除数 100** (`÷100`)；注意新浪 `hf_CL` 跟踪当月合约，与东财连续指数存在约 4.1%~5.1% 合约基准差（随换月漂移，不作硬门禁），备源切换按 §3.4.2 重校昨结基准
      * `GL_GC0` (`101.GC00Y`): `qt` 43717 / `trends2` 4371.7 → **除数 10** (`÷10`)；新浪 `hf_GC` 4373.530，跨源一致
      * `GL_SI0` (`101.SI00Y`): `qt` 65060 / `trends2` 65.06 → **除数 1000** (`÷1000`)；新浪 `hf_SI` 65.087，跨源一致
      * `GL_HG0` (`101.HG00Y`): `qt` 64865 / `trends2` 6.4865 美元/磅 → **除数 10000** (`÷10000`)；注意新浪 `hf_HG` 以美分/磅报价（649.300），与东财美元/磅报价相差 100 倍，备源切换需应用 `sinaScale = 0.01` 换算
      * `GL_NG0` (`102.NG00Y`): `qt` 2903 / `trends2` 2.903 → **除数 1000** (`÷1000`)；新浪 `hf_NG` 存在约 4.1%~4.5% 合约月差，备源切换按 §3.4.2 重校基准
      * `GL_NQ0` (`103.NQ00Y`): `qt` 2908461 / `trends2` 29084.61 → **除数 100** (`÷100`)；新浪 `hf_NQ` 29070.80，跨源一致（偏差 ≤0.05%）
      * `GL_ES0` (`103.ES00Y`): `qt` 767222 / `trends2` 7672.22 → **除数 100** (`÷100`)；新浪 `hf_ES` 7665.60，跨源一致（偏差 ≤0.05%）
      * `GL_YM0` (`103.YM00Y`): `qt` 52579 / `trends2` 52579 → **除数 1** (`÷1`)；新浪 `hf_YM` 52540.90，跨源一致
      * `GL_A50` (`104.CN00Y`): `qt` 143750 / `trends2` 14375.0 → **除数 10** (`÷10`)；新浪 `hf_CHA50CFD` 14375.40，跨源一致
      * `GL_HSI` (`134.HSI_M`): `qt` 24682 / `trends2` 24682 → **除数 1** (`÷1`)；日盘结算后与新浪 24676 1:1 对齐，夜盘转场基准衔接见 §3.4.2
    * **快照一致性核验**：单次同时刻快照严格满足恒等式 `f169 == f43 - f60`（例如 `104.CN00Y` 采样中 `f43=143750, f60=143650, f169=100`，且 `f44=144180, f45=141980, f46=142670`；`134.HSI_M` 采样中 `f43=24689, f60=24688, f169=1`）。
    * 因此，在 `src/js/parser.js:parseEastmoney` 入口处，必须按注册表 `globalCatalog` 登记的 `qtDivisor` 对全部价格字段（`f43/f44/f45/f46/f60/f169`）逐品种归一化，严禁粗暴套用 A 股 `div100`，杜绝 10~100 倍数值错位与 `-90%` 伪跌幅。

### 2.2 港股（HK Stocks）实测
* **实时报价**：腾讯 `https://qt.gtimg.cn/q=r_hk00700`（五位代码，实测 78 字段，取值条件：盘中实测验证），时间格式为 `YYYY/MM/DD HH:mm:ss`。
* **分时走势与历史 K 线**：东财 `secid=116.00700`
  * **端点与根数口径明确区分**：
    * **分时走势（`trends2` 口径）**：首根含 09:30 开盘点，早盘 09:30–12:00 共 **151 根**；午后无 13:00 点，从 13:01 起步，午盘 13:01–16:00 共 **180 根**。全日合计 **331 根**。
    * **1 分钟 K 线（`klt=1` 口径）**：首根从 09:31 开始，早盘 09:31–12:00 共 **150 根**；午盘 13:01–16:00 共 **180 根**。全日合计 **330 根**。
  * **东财 `qt` 报价量纲实测（P3-3 实测确认）**：东财 `qt/stock/get` 端点对港股（`m:116`）输出的原始价格字段统一以 0.001 港币为单位（如腾讯控股 `f43=433400`），同源 `trends2` 末根与腾讯实时价均为真实价格 `433.400`。真实除数为 **`÷1000`**。

### 2.3 美股（US Stocks）实测
* **实时报价**：腾讯 `https://qt.gtimg.cn/q=usAAPL`（美股 payload 基准 71 字段[非交易时段实测]，上游偶发追加 2 个尾部空字段使总数达 73 字段；解析器须使用下限守卫 fields.length >= 35 或 >= 71，不得以总数做等值断言），常规收盘价位于 f3，时间格式为 `YYYY-MM-DD HH:mm:ss`。
  * **特殊字符代码实测（5大工程盲点闭环 1）**：美股不仅有纯英文字母代码（如 `AAPL`, `TSLA`），还广泛存在包含点号 `.` 或短横线 `-` 的著名标的（如巴菲特伯克希尔哈撒韦 `BRK.A` / `BRK.B`，优先股 `BF.B` 等）。在腾讯接口中对应为 `v_usBRK.A` / `v_usBRK_A`，东财对应 `106.BRK_A`。因此，服务端与客户端的美股代码正则必须严格兼容 `.`、`_` 与 `-`，绝不得武断限制为纯字母！
* **分时走势与历史 K 线**：东财三大美股市场 `secid=105.AAPL`（纳斯达克）、`secid=106.BABA`（纽交所）、`secid=107.SPY`（美交所/Arca，实测 4774 只标的，腾讯对应 `.AM` 后缀）。
  * `trends2` 端点口径为 **391 根**（含美东 09:30 开盘集合快照，至 16:00 结束共 391 点）；对应 `klt=1` 1分钟K线口径为 **390 根**（从 09:31 开始）。
  * **东财 `qt` 报价量纲实测（P2-1 与 P3-3 实测确认）**：东财 `qt/stock/get` 端点对美股全市场（`m:105, 106, 107`）输出的原始价格字段统一以 0.001 美元为单位（如苹果 `105.AAPL` `f43=331340`、阿里巴巴 `106.BABA` `f43=109340`、标普500ETF `107.SPY` `f43=757390`），同源 `trends2` 末根与腾讯实时价均为真实价格 `331.340` / `109.340` / `757.390`。真实除数统一为 **`÷1000`**。

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

* **自选池代码准入策略与备源代码隔离（待确认风险 1 闭环）**：
  1. **用户输入与自选池准入代码**仅允许标准前缀统一代码：A 股（`sh/sz/bj` + 6 位）、国内期货（`RB0`, `IF2603` 等）、外盘期货（`GL_*`）、港股（`hk` + 5 位）、美股（`us` + 英文代码）；
  2. **备源符号严格内部化**：新浪外盘代码 `hf_*` 仅作为服务端与备源抓取模块的内部路由符号，`normalizeCode` 与搜索联想严禁将其输出为可自选代码，彻底杜绝用户界面同一品种并存两个不同报价或 `hf_*` 缺失图表的问题。

#### 3.1.1 外盘期货元数据与端点报价单位显式注册表（P1-1、P2-2 与风险项 1 闭环版）
在 `src/js/futures/globalCatalog.js` 中逐品种显式注册映射：

| 内部统一代码 | 品种名称 | 计价货币 | 新浪报价符号 | 东财 secid | 交易场所 | 东财 qt 原始单价 / 真实除数 (`qtDivisor`) | 新浪换算系数 (`sinaScale`) 与跨源特性 | 走势图可用性 |
|---|---|---|---|---|---|---|---|---|
| `GL_CL0` | 纽约原油 | `USD` | `hf_CL` | `102.CL00Y` | NYMEX | **÷100** (`f43=10445` → 104.45 点) | 1.0（两源合约月不同，实测价差 4.1%~5.1% 随换月漂移，备源切换按 §3.4.2 绑定自身昨结重校） | 实时报价 + 分时 + K线 |
| `GL_GC0` | 纽约黄金 | `USD` | `hf_GC` | `101.GC00Y` | COMEX | **÷10** (`f43=43717` → 4371.7 点) | 1.0 (新浪 4373.530，同刻偏差 ≤0.05%) | 实时报价 + 分时 + K线 |
| `GL_SI0` | 纽约白银 | `USD` | `hf_SI` | `101.SI00Y` | COMEX | **÷1000** (`f43=65060` → 65.06 点) | 1.0 (新浪 65.087，同刻偏差 ≤0.05%) | 实时报价 + 分时 + K线（隔离国内工业硅） |
| `GL_HG0` | 纽约美铜 | `USD` | `hf_HG` | `101.HG00Y` | COMEX | **÷10000** (`f43=64865` → 6.4865 美元/磅) | **0.01** (新浪 649.300 美分/磅需 ×0.01 换算为美元/磅，同刻偏差 ≤0.05%) | 实时报价 + 分时 + K线 |
| `GL_NG0` | 天然气 | `USD` | `hf_NG` | `102.NG00Y` | NYMEX | **÷1000** (`f43=2903` → 2.903 点) | 1.0（两源合约月不同，实测价差 4.1%~4.5% 随换月漂移，备源切换按 §3.4.2 绑定自身昨结重校） | 实时报价 + 分时 + K线 |
| `GL_NQ0` | 纳斯达克期货 | `USD` | `hf_NQ` | `103.NQ00Y` | CME | **÷100** (`f43=2908461` → 29084.61 点) | 1.0 (新浪 29070.80，同刻偏差 ≤0.05%) | 实时报价 + 分时 + K线 |
| `GL_ES0` | 标普500期货 | `USD` | `hf_ES` | `103.ES00Y` | CME | **÷100** (`f43=767222` → 7672.22 点) | 1.0 (新浪 7665.60，同刻偏差 ≤0.05%) | 实时报价 + 分时 + K线 |
| `GL_YM0` | 道琼斯期货 | `USD` | `hf_YM` | `103.YM00Y` | CME | **÷1** (`f43=52579` → 52579 点) | 1.0 (新浪 52540.90，同刻偏差 ≤0.05%) | 实时报价 + 分时 + K线 |
| `GL_A50` | 富时中国A50 | `USD` | `hf_CHA50CFD` | `104.CN00Y` | SGX | **÷10** (`f43=143750` → 14375.0 点) | 1.0 (新浪 14375.40，同刻偏差 ≤0.05%) | 实时报价 + 分时 + K线（实测 m:104） |
| `GL_HSI` | 恒生指数期货 | `HKD` | `hf_HSI` | `134.HSI_M` | HKFE | **÷1** (`f43=24682` → 24682 点) | 1.0 (日盘结算后 1:1，夜盘转场基准衔接见 §3.4.2) | 实时报价 + 分时 + K线（东财 m:134 主力合约，新浪 hf_HSI 作备源） |

#### 3.1.1.1 港股与美股东财 qt 端点报价量纲实测注册表（P2-1 与 P3-3 闭环版）
在 `src/js/catalog/stockCatalog.js` 或东财解析器内按市场号显式注册默认除数：

| 资产类型 | 标的示例 | 东财 secid | 东财 `qt.f43` 原始值 | 同源 `trends2` 末根 | 腾讯实时价 | 真实除数 (`qtDivisor`) | 说明 |
|---|---|---|---|---|---|---|---|
| 港股 | 腾讯控股 `hk00700` | `116.00700` | 433400 | 433.400 | 433.400 | **÷1000** | 港股端点报价以 0.001 港币为最小单位 |
| 港股 | 阿里巴巴 `hk09988` | `116.09988` | 106200 | 106.200 | 106.200 | **÷1000** | 港股端点报价以 0.001 港币为最小单位 |
| 美股 | 苹果 `usAAPL` | `105.AAPL` | 331340 | 331.340 | 331.34 | **÷1000** | 美股端点报价以 0.001 美元为最小单位 |
| 美股 | 阿里巴巴 `usBABA` | `106.BABA` | 109340 | 109.340 | 109.34 | **÷1000** | 纽交所美股同为 ÷1000 |
| 美股 | 特斯拉 `usTSLA` | `105.TSLA` | 356580 | 356.580 | 356.58 | **÷1000** | 纳斯达克美股同为 ÷1000 |
| 美股 | 标普500ETF `usSPY` | `107.SPY` | 757390 | 757.390 | 757.39 | **÷1000** | 美交所/Arca（m:107，腾讯 .AM 后缀，实测 4774 只）同为 ÷1000；注：105/106 取 107 标的恒 rc:100，必须完整支持 107 |

* **美股市场探测结果双层缓存机制（5大工程盲点闭环 2）**：
  为杜绝前端 3s~5s 高频轮询时对未收录美股代码反复并发执行 105/106/107 三次探测造成上游反爬与时延放大，确立**“探测一次、全程命中”**双层缓存规范：
  1. **内存缓存（一级）**：模块级维护 `Map<string, string>`（如 `'usSPY' -> '107.SPY'`），生命周期内 O(1) 短路直通；
  2. **持久化/共享缓存（二级）**：浏览器端写入 `localStorage` 缓存键 `market_us_secid_cache`，服务端同步写入 `/api/cache/market`，即便刷新页面或重启服务亦无需重新探测。

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
  > 上述断言完全基于仓库既有导出模块直接可执行。在 Phase 1 落地阶段，按 §3.1.2 清单新增导出 `inferAssetType(code)` 后，将补充全值域可执行正交断言：
  > ```js
  > // Phase 1 落地单测：inferAssetType 全值域覆盖与调度防误关断言
  > import { inferAssetType } from '../src/js/parser.js';
  > import { resolveSessionStrategy, chinaStockStrategy, globalFuturesStrategy } from '../src/js/marketSession.js';
  >
  > assert.equal(inferAssetType('SI0'), 'futures_cn');
  > assert.equal(inferAssetType('GL_SI0'), 'futures_global');
  > assert.equal(inferAssetType('hf_SI'), 'futures_global');
  > assert.equal(inferAssetType('hf_HSI'), 'futures_global');
  > assert.equal(inferAssetType('hf_CL'), 'futures_global');
  > assert.equal(inferAssetType('sh600519'), 'stock_cn');
  > assert.equal(inferAssetType('hk00700'), 'stock_hk');
  > assert.equal(inferAssetType('r_hk00700'), 'stock_hk');
  > assert.equal(inferAssetType('usAAPL'), 'stock_us');
  > assert.equal(inferAssetType('unknown_foo'), 'stock_cn'); // 兜底防崩，未命中其他分支回退 A 股
  >
  > // 验证外盘备源代码送入会话调度器时绝不误判为 A 股（杜绝 22:00 误关语音）：
  > assert.equal(resolveSessionStrategy('hf_CL'), globalFuturesStrategy);
  > assert.equal(resolveSessionStrategy('hf_HSI'), globalFuturesStrategy);
  > ```

#### 3.1.2 归一化全链路改造点清单（覆盖全仓 17 处真实行号与消费点，严格保留正则与转义）

| 层级 | 文件位置 | 既有逻辑 | 改造目标 |
|---|---|---|---|
| **服务端** | `server/utils.js:76-86` (`normalizeCodeParam`) | 仅匹配 `^(sh\|sz\|bj)\d{6}$` 或 6 位纯数字，其余返空 | 支持 `hk\d{5}`、`us[A-Za-z0-9._-]+`（兼容 `BRK.A`/`BRK.B` 等特殊代码，盲点 1 闭环）、`GL_[A-Z0-9]+`、`hf_[A-Za-z0-9_]+` |
| **服务端** | `server/marketData.js:18-22, 160, 194` | `EASTMONEY_TRENDS_HOSTS` 仅含 `push2his` 族，且代码截取 slice(2) | **主机扩展与资产感知**：将 `push2delay.eastmoney.com` 追加进轮转与兜底清单；按资产类型分发各市场东财 secid 与 Aktools 参数 |
| **服务端** | `server/proxyRoutes.js:10, 13`、`server/proxyService.js:10, 31` 及 `server/klineService.js:40, 95` | 静态 target 硬编码 `push2his` 与 `push2`，`resolveProxyTarget` 返回单目标无轮转兜底 | **浏览器代理出网兜底与防雪崩轮转（盲点 4 闭环）**：对 `/api/eastmoney-kline` 与 `/api/eastmoney` 增加目标多主机轮转与 `push2delay.eastmoney.com` 失败重试/兜底；引入 `fastTimeoutMs: 2500ms` 快速探测超时与 60s 主机健康状态缓存，杜绝 15s 超时造成的前端刷新雪崩；`buildEastmoneyKlineUrl` 默认 host 接入轮转；`proxyService` 完善重试循环 |
| **客户端** | `src/js/parser.js:11-25` (`normalizeCode`) | 仅识别 `sh/sz/bj` | 扩展并新增导出 `inferAssetType(code): string`（契约值域严格对照 `ASSET_TYPES`：① `GL_` 前缀 或 `^hf_[A-Za-z0-9_]+$` → `'futures_global'`；② `^(?:sh\|sz\|bj)\d{6}$` 或 6位纯数字 → `'stock_cn'`；③ `^(?:hk\|r_hk)\d{5}$` → `'stock_hk'`；④ `^(?:us)?[A-Za-z0-9._-]+$` 且 `isFutureCode===false` → `'stock_us'`（盲点 1 闭环：覆盖 `BRK.A` 等标的）；⑤ `isFutureCode(code)===true` → `'futures_cn'`；⑥ 其余未知输入兜底回退 `'stock_cn'`），同时改造 `normalizeCode` 输出规范化资产对象 `{ code, type, market, secid }` |
| **客户端** | `src/js/parser.js:34-40` (`toEastmoneySecId`) 及服务端 `marketData.js:196` / `klineService.js:41` | 仅依 `inferMarket` 识别 A 股 `1.sh / 0.sz`，外盘恒返回 `null` | **代码到东财 secid 解析器扩展与探测双层缓存（盲点 2 闭环）**：支持外盘期货 `GL_*`（查 `globalCatalog` 映射为 `101/102/103/104/134.*`）、港股 `hk*`（`116.*`）与美股 `us*`（按美股符号查 `usCatalog` 字典；未收录时对 `105/106/107` 三大市场号依次探测，首个 `rc=0` 者为准，并立即写入内存与本地持久化缓存 `Map<code, marketId>`，后续轮询直接命中，严禁重复探测）；使浏览器与服务端东财三端点构造正常可达 |
| **客户端** | `src/js/parser.js:93-127` (`parseEastmoney`) 及 `:106-107` | 对价格字段统一执行 `div100`（A 股口径），代码推导恒走 `('sz') + f57` 兜底 | **P1-1、P2-1 与 P3-3 闭环：端点单位全字段逐品种归一化与规范身份推导**：根据 `(d.f107, d.f57)` 反查注册表：① 若命中外盘期货注册表，价格字段（`f43/f44/f45/f46/f60/f169`）统一除以品种特定的 `qtDivisor`（`CL/NQ/ES=100`、`GC/A50=10`、`SI/NG=1000`、`HG=10000`、`YM/HSI=1`），并输出 `GL_*` 及 `type='futures_global'`；② 若未命中外盘注册表，按市场号 `f107` 自动分派默认除数：A 股（`f107: 0, 1`）回退 **`div100`**，港股（`f107: 116`）与美股（`f107: 105, 106, 107`）回退 **`div1000`**，彻底消除港美股在腾讯失败走东财兜底时价格出现 10 倍错位的缺陷；③ 规范输出 `hk*` 与 `us*` 内部代码及类型 |
| **客户端** | `src/js/parser.js:42` (`TENCENT_LINE_RE`) | 正则 `v_([a-z]{2}\d{6})` | 扩展为支持 `v_((?:sh\|sz\|bj)\d{6}\|r_hk\d{5}\|us[A-Za-z0-9._-]+)`（盲点 1 闭环） |
| **客户端** | `src/js/parser.js:64` (时间字段校验) | 硬编码 `^\d{14}$` (如 20260916142000) | 兼容港股 `YYYY/MM/DD HH:mm:ss` 与美股 `YYYY-MM-DD HH:mm:ss` |
| **客户端** | `src/js/parser.js:129` (`SINA_FUTURE_RE`) | 正则 `hq_str_(nf_?[a-z0-9]+)` | **P3-1 闭环**：扩展支持 `hq_str_(?:nf_?[a-z0-9]+\|hf_[A-Za-z0-9_]+)`，新增导出 `parseSinaGlobalFuture(raw, { code, scale, baseFromOwnField7 })`，对 `GL_HG0` 应用 `sinaScale = 0.01` 消除美分/美元量纲差，对 `GL_CL0`/`GL_NG0` 自动绑定自身 `field7` 昨结重校涨跌基准 |
| **客户端** | `src/js/api.js:30-31` (`STOCK_RE`, `FUTURE_RE`) | 仅支持国内 A 股与国内期货 | 改造为资产类型分发器，新标的不被 `buildTencentUrl` 剔除 |
| **客户端** | `src/js/api.js:36-39, 252-260` (`INTRADAY_SESSION_RANGES`) | 硬编码 A 股两段交易时间，在 `_isTradingSessionTime:257` 与 `_filterIntradaySessions:260` 消费 | 改造为按标的策略动态获取时段窗口，杜绝外盘与港美股分时被全量滤空 |
| **客户端** | `src/js/marketSession.js:46-52` (`getVoiceEligibleCodes`) 及 `src/js/futures/session.js` | 仅判断 `isFutureCode ? isFutureTrading : stockAllowed` 二元分派，缺少日内区间导出 | **多资产时段策略分派与期货日内时段区间补齐（盲点 3 闭环）**：遍历标的调用 `resolveSessionStrategy(code).isVoiceAllowed(now, cfg, tradingDates, code)`；其中国内期货策略直接委托既有 `session.js` 中的 `isFutureTrading` 与 `getFuturesSession`；并在 `session.js` 中新增导出 `getFuturesSessionRanges(code, now, tradingDates)` 供 `getIntradaySessionRanges` 统一调用，外盘活跃时不被 A 股收盘滤空 |
| **客户端** | `src/js/services/voiceSchedule.js:12, 28` | `futures = list.filter(isFutureCode)`，`:28` 判据为 `!futures.length && session === 'after-close' && autoStopAfterClose` | **P2-1 闭环：契约严格一致，消除误关语音并杜绝午休回归**：重构第 28 行判据为 `if (cfg.enabled && enabled && !hasExtendedHoursAssets && session === 'after-close' && cfg.autoStopAfterClose) enabled = false;`（严格保留 `session === 'after-close'` 维度，与 §3.2.2 逐字一致，绝不在午休 11:30–13:00 误关语音） |
| **客户端** | `src/js/tts.js:217-218` 与 `src/js/alert.js:87-88` | 硬编码 `quote.type === 'future' ? '' : ' 元'` 与 2/3 位小数 | **P3-2 闭环：语音与预警单位适配**：识别 `type === 'futures_global'`，废除尾附“元”，根据元数据播报正确货币（美元/港币）并匹配其精度 |
| **客户端** | `src/js/views/monitorTableView.js:95, 339`、`src/js/kline.js:522` 及 `src/js/services/batchExportService.js:102` | 以 `quote.type === 'future'` 判定期货口径 | **P3-2 闭环：消费层统一资产感知**：同步支持 `'futures_global'`，消除外盘标的被误作股票渲染与导出的缺陷 |
| **客户端** | `src/js/kline.js:210, 218, 232` (`STOCK_CODE_RE`) | 仅处理 6 位 A 股 | 修正行号：声明于 210，分别守卫 218 (`buildTencentKlineUrl`) 与 232 (`buildTencentYearKlineUrl`)，改造为分发港股、美股与外盘 |
| **客户端** | `src/js/kline.js:326-341` 与消费方 `:347, 360-367` | 默认回落 10% 涨跌停判定 | **双端改造**：`getPriceLimit` 对非 A 股返回 `null`；消费方 `classifyKlineBar`（`:347` `const lim = Number(limit) \|\| 10;`）增加 `limit === null` 显式短路保护直接返回 `'normal'`，彻底消除非 A 股涨跌停假标识（注：`limitUp.js:37` 仅由 A 股涨停池调用，不受影响） |
| **客户端** | `src/js/services/searchSuggest.js` 与自选池准入守卫 | 仅针对 A 股代码及全拼进行联想 | **待确认风险 1 闭环：搜索联想与自选准入防线**：搜索联想词库输出与用户输入解析严格排除 `hf_*` 备源代码；断言搜索联想输出集合 ∩ `^hf_` = ∅，`normalizeCode('hf_*')` 恒返回 `null`，确保自选池仅准入 `GL_*` 等规范代码 |

---

### 3.2 交易会话（Market Session）解耦与语音调度防污染契约

#### 3.2.1 策略模式（Strategy Pattern）接口契约
```ts
interface MarketSessionStrategy {
  readonly assetType: string;
  isTradingNow(now: Date, code?: string): boolean;
  getSession(now: Date, code?: string): 'pre-open' | 'trading' | 'lunch' | 'after-close' | 'closed';
  getIntradaySessionRanges(now: Date, code?: string): Array<[startMinutes: number, endMinutes: number]>;
  getTradingDay(now: Date, code?: string): string; // YYYY-MM-DD
  isVoiceAllowed(now: Date, cfg: SmartScheduleConfig, tradingDates: string[], code?: string): boolean;
}
```

1. **`ChinaStockSessionStrategy`**：保持原 09:30-11:30, 13:00-15:00 与节假日日历不变。
2. **`ChinaFuturesSessionStrategy`（P2-2 与 P3-1 闭环：带品种参数，严格委托既有模块）**：
   * **复用现网精密规则**：方法接收 `code?: string` 参数，内部必须直接委托既有 `src/js/futures/session.js` 中的 `getFuturesSession(code, now, tradingDates)` 与 `isFutureTrading(code, now, tradingDates)`；
   * **会话状态严格映射**：`getSession(now, code)` 将委托调用的返回值映射为统一会话状态：
     * 若 `getFuturesSession(code, now, tradingDates).sessionStatus === 'trading'`，映射为 `'trading'`；
     * 若处于日盘休市/盘后，映射为 `'after-close'` 或 `'closed'`；
     * `isTradingNow(now, code)` 直接返回 `isFutureTrading(code, now, tradingDates)`；
   * **分时交易窗口显式委托（5大工程盲点闭环 3）**：针对 `getIntradaySessionRanges(now, code)`，在 `src/js/futures/session.js` 中新增导出 `getFuturesSessionRanges(code, now, tradingDates)`：
     * 中金所金融期货：国债 T0 等返回 `[[555, 690], [780, 915]]`（09:15-11:30, 13:00-15:15）；股指 IF0 等返回 `[[570, 690], [780, 900]]`（09:30-11:30, 13:00-15:00），无夜盘；
     * 商品期货日盘：常规返回 `[[540, 615], [630, 690], [810, 900]]`（09:00-10:15, 10:30-11:30, 13:30-15:00）；
     * 商品期货夜盘：若为夜盘交易日，依据品种 `nightEnd` 追加时段：23:00 收盘（如 RB0）追加 `[[1260, 1380]]`；01:00 收盘追加 `[[1260, 1440], [0, 60]]`；02:30 收盘（如 AU0）追加 `[[1260, 1440], [0, 150]]`；
     * 策略类的 `getIntradaySessionRanges(now, code)` 直接调用该函数，彻底解决分时图绘制与分时过滤缺乏底层时段区间支撑的隐患；
   * 严禁重写会话状态机，完整继承原日盘、夜盘（21:00-23:00/01:00/02:30）、中金所金融期货无夜盘、国债 15:15 收盘、法定节假日前夜无夜盘、周末休市等精密逻辑；
   * 在 §5 中设置覆盖 RB0/AU0/T0/IF0 四类品种的严格等价性与变异门禁。
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

#### 3.2.2 调度分派器、Any-Trading 调度与全局语音防污染（P1-2 与 P2-1 闭环）
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
      console.warn(`[Session] Unknown asset code: ${code}, fallback to ChinaStockStrategy`);
      return chinaStockStrategy;
  }
}

// 策略架构说明（P2-2 闭环）：策略实例按资产类别维持单例（通过 resolveSessionStrategy(code).assetType 判别）。
// 对于国内期货（futures_cn），策略方法接收具体 code 入参并直接委托既有 session.js，既保持策略实例轻量无状态，又彻底解决不同品种日夜盘时间窗口分歧问题。
```

* **全仓语音调度状态机防污染改造（彻底闭环 `voiceSchedule.js:28` 与消除午休回归）**：
  * **根因与机制修复**：原有代码在 `src/js/services/voiceSchedule.js:28` 中硬编码 `if (cfg.enabled && enabled && !futures.length && session === 'after-close' && cfg.autoStopAfterClose) enabled = false;`。由于外盘与港美股的 `isFutureCode` 恒为 `false`，导致自选池即便包含正在交易的外盘期货或美股，一到北京时间 15:00（A股收盘）就会被直接关停语音（`enabled=false` 持久化到配置）并播放“已收盘”；
  * **改造原则（两处契约完全逐字一致）**：
    1. 在 `voiceSchedule.js:12` 中识别全量非 A 股交易时段资产：`const hasExtendedHoursAssets = list.some(c => inferAssetType(c) !== ASSET_TYPES.STOCK_CN);`；
    2. 将第 28 行判据重构为：`if (cfg.enabled && enabled && !hasExtendedHoursAssets && session === 'after-close' && cfg.autoStopAfterClose) enabled = false;`；
    3. **杜绝午休回归保护**：严格保留 `session === 'after-close'` 判定维度，绝不在 `session === 'lunch'` 时将 `enabled` 置为 `false`（午休仅将 `timerShouldRun` 置为 `false` 并播报“中午休市”，13:00 自动恢复）；
    4. 只要自选池中有**任一标的**处于交易时段（`allowed === true` / `eligibleCodes.length > 0`）或属于跨时区/非A股资产，全局语音状态机**绝不进入 autoStop 关闭**；
    5. 在北京时间 16:00 或 22:00（A股已收盘、港美股或外盘期货交易中），A 股标的静默跳过，外盘标的正常播报，**绝不播报“已收盘”，绝不误关语音**。

---

### 3.3 分时与 K 线数据管线改造（消除 A 股硬编码与冬夏动态适配）

1. **分时交易窗口参数化**：
   * 废除 `api.js:36-39` 全局唯一的 `INTRADAY_SESSION_RANGES = [[9:15,11:30],[13:00,15:00]]`；
   * 改为在 `_isTradingSessionTime`（`api.js:252-258`）与 `_filterIntradaySessions(data, selectedDate)`（`api.js:260`）中根据标的所属策略动态获取时段范围：
     * A 股：`[[555, 690], [780, 900]]`
     * 港股：`[[570, 720], [781, 960]]`（13:01–16:00，与实测无 13:00 点相符）
     * 美股：夏令时 `[[1290, 1440], [0, 240]]`；冬令时 `[[1350, 1440], [0, 300]]`
     * 外盘期货：全天窗口，随 DST 纯函数动态剔除每日结算窗口（夏令时剔除 05:00–06:00，冬令时剔除 06:00–07:00）。
2. **交易日跨午夜对齐**：
   * 废除 `chartTimeToDate(it.time) !== selectedDate` 简单的北京日历日比对；
   * 改为 `strategy.getTradingDay(it.time) !== selectedTradingDay`，美股 391 根分钟点统一归属于美东同日交易日，绝不截断。

---

### 3.4 报价源与图表源合约及基准对齐机制（5% 偏离与多源闭环）

1. **统一合约锚点与端点归一化（Single Source / Consistent Anchor）**：
   * 外盘期货**优先采用东方财富作为第一数据源**（实时行情 `qt/stock/get?secid=...` 与 `trends2` 分时图同源）；
   * 在消费入口（`src/js/parser.js:parseEastmoney`）根据 `globalCatalog` 登记的 `qtDivisor` 对全部价格字段（`f43/f44/f45/f46/f60/f169`）执行除法归一化，并正确推导规范内部代码（`GL_*`）及设置 `type='futures_global'`，实时报价与分时图直接共享同源的 `preClose` 昨结算价基准，保证最新价、今开、最高、最低、涨跌幅与分时图末端价格 100% 吻合，并保证能正常写入 `state.quotes`。
2. **新浪备源切换与昨结基准对齐机制（P2-1、P2-2 与 P3-1 闭环）**：
   * 所有外盘期货均以东方财富为第一数据源（分时与 K 线同源）；新浪 `hf_` 仅作为全量实时报价备用源，由 `src/js/parser.js:parseSinaGlobalFuture` 统一解析；
   * 当切至新浪 `hf_` 备用源时，显式使用新浪字段 7（昨结）重校基准：
     * **1:1 同合约品种对齐**：在常规交易时段，`GL_GC0`、`GL_SI0`、`GL_NQ0`、`GL_ES0`、`GL_YM0`、`GL_A50` 的主备源同刻偏差均 ≤0.05%~0.5%，切换平滑；
     * **HKFE 日夜盘切换基准衔接规范与复采记录（P3-2 闭环）**：
       实测显示 HKFE 在 16:30–17:15 日夜盘转场清算时，东财 `f60` 与 `trends2.preClose` 会按交易所规则滚动至新交易日结算基准（如 24688），而新浪备源发布可能存在延迟或仍带前收盘：
       | 采样时刻（北京） | 市场状态 | 东财 `134.HSI_M` (`f60` / `trends2.preClose`) | 新浪 `hf_HSI` (字段 7 昨结) | 偏差点数 / 百分比 | 机制说明 |
       |---|---|---|---|---|---|
       | 16:35 | 日盘结算后 | 24676 / 24676 | 24676.000 | 0 点 / 0.000% | 日盘收盘后常规结算，两侧 1:1 完全一致 |
       | 17:07 | 转场清算中 | 24688 / 24688 | 24676.000 | 12 点 / 0.049% | 东财已滚动至夜盘新基准，新浪尚未更新 |
       | 17:23 | 夜盘已开盘 | 24688 / 24688 | 24681.000 | 7 点 / 0.028% | 新浪更新但仍与东财结算价存在微小基准差 |
       | 17:28 | 夜盘交易中 | 24688 / 24688 | 24681.000 | 7 点 / 0.028% | 东财与同源分时走势基准恒定一致 |
       | **18:26（本轮复测）** | **夜盘交易中** | **24688 / 24688** | **24688.000** | **0 点 / 0.000%** | **新浪已完全同步至夜盘新基准，偏差归零** |
       确立以东财分时 `trends2.preClose` 为最高权威基准；备源切换时优先以同源走势昨结作为换算锚点，杜绝主备切换出现跳变；
     * **美铜量纲换算对齐**：对于 `GL_HG0`，新浪 `hf_HG` 以美分/磅报价（如 649.300），而东财以美元/磅报价（6.4865）。备源解析器 `parseSinaGlobalFuture` 自动乘以注册表指定的 `sinaScale = 0.01`，将价格无缝统一为美元/磅，消除 100 倍量纲差异；
      * **CL 与 NG 跨源合约月差异、换月自适应解耦机制（P2-1 与盲点 5 闭环）**：
        实测显示新浪 `hf_CL`（~99.15）与 `hf_NG`（~3.05）跟踪当月合约，而东财连续合约（CL00Y ~103.72, NG00Y ~2.92）跟踪主力换月指数，存在系统性约 4.1%~5.1% 合约基差。**该价差由上游两源合约结构决定，随换月持续漂移，不作为实现的硬性门禁**。
        * **自适应解耦设计**：备源切换时，系统严禁跨源比对绝对价格，而是通过 `parseSinaGlobalFuture` 将 `prevClose` 直接重锚定为新浪自身的 `field7`（昨结）。涨跌幅计算完全基于备源内部闭环数据（`(price - prevClose) / prevClose`），因此在极端主力换月日即便两源绝对基差剧烈重构（如基差变动暂时突破 0.6pp），也**绝不会导致百分比计算突变或触发伪告警**；
        * **跳变守卫**：实测常规交易日主备切换同一时刻跳变受两源合约基差日间变动影响（实测在 0.236pp~0.41pp），设置 `< 0.6pp` 仅作为非换月日平滑性守卫；
      * **点数基准无缝对接**：东财 `104.CN00Y` 经归一化后的实时报价（昨结 14271.0）与新浪 `hf_CHA50CFD` 字段 7 昨结（14271.000）完全在点数单位上 1:1 对齐。

---

### 3.5 语音播报（TTS）与货币单位适配（P3-2 闭环）

* **按品种元数据定义货币与语音后缀（P3-2 闭环）**：
  * A 股：`CNY`（播报“元”）
  * 国内期货：`CNY`（播报无“元”后缀，仅播数字）
  * 港股：`HKD`（播报“港币”）
  * 恒指期货（`GL_HSI`）：`HKD`（`type='futures_global'`，播报无“元”后缀，或按需提示“点/港币”）
  * 美股：`USD`（播报“美元”）
  * 外盘期货（美原油、美黄金、美白银、美铜、天然气、纳指、标普、道指、A50）：`USD`（`type='futures_global'`，**严禁播报“元”**，语音播报仅播点数或“美元”）
* **英文代码与中文名播报规则**：
  * 美股优先播报注册中文名（如“苹果”），无中文名拼读字母；外盘期货直接播报品名（如“纽约原油”）。

---

## 4. 分阶段演进实施路线图（Roadmap）

```mermaid
gantt
    title 国际品种接入分阶段实施计划 (v10)
    dateFormat  YYYY-MM-DD
    section Phase 1 外盘主流期货
    建立 globalCatalog 与实测 secid 表     :2026-09-17, 2d
    全仓 17 处归一化与出网代理多主机兜底   :2026-09-19, 2d
    多时区会话策略与语音调度防污染         :2026-09-21, 2d
    外盘期货离线/在线单测与门禁验证        :2026-09-23, 1d
    section Phase 2 港股接入
    港股代码接入与五位代码解析             :2026-09-24, 2d
    港股时段 (09:30-16:00) 与分时 331 根   :2026-09-26, 2d
    东财港股 qt 端点 div1000 归一化        :2026-09-27, 1d
    section Phase 3 美股接入
    美东冬夏令时纯函数与美东日期归属       :2026-09-28, 3d
    美股跨午夜 391 根分时与报价解析        :2026-10-01, 2d
    东财美股 qt 端点 div1000 归一化        :2026-10-02, 1d
```

### Phase 1: 外盘主流期货（首批 10 个高频品种）
* **标的范围**：`GL_CL0`(原油)、`GL_GC0`(黄金)、`GL_SI0`(白银)、`GL_HG0`(美铜)、`GL_NG0`(天然气)、`GL_NQ0`(纳指)、`GL_ES0`(标普)、`GL_YM0`(道指)、`GL_A50`(富时A50)、`GL_HSI`(恒指期货)。
* **关键成果**：打通多主机东财外盘分时/K线（覆盖全部 10 个品种，含 m:134 恒指期货与浏览器代理出网兜底） + 新浪备源，落地会话策略解耦，消除国内标的回归隐患。

### Phase 2: 港股接入（时差为零）
* **标的范围**：港股五位代码全量支持输入，头部 30 只恒生科技成份股支持拼音联想；接入东财 `div1000` 归一化。

### Phase 3: 美股接入（攻克冬夏令时与跨夜分时）
* **标的范围**：美股代码直接输入添加，头部标普/纳指成分股拼音联想；接入东财 `div1000` 归一化。

---

## 5. 验收标准与单一可测量门禁规范

1. **防回归严格门禁**：
   * 既有 A 股与国内期货所有 843 项 QUnit 单元测试与 75 项 Playwright E2E 测试保持 **100% PASS**。
   * **国内期货会话精密等价性门禁（P2-2 与 P3-1 闭环：覆盖 RB0/AU0/T0/IF0 四类品种）**：
     * **常规夜盘 21:30**：RB0（螺纹钢，夜盘至 23:00）与 AU0（黄金，夜盘至次日 02:30）开市交易，T0（国债）与 IF0（股指）中金所无夜盘休市：
       `const regularNight = new Date('2026-09-16T21:30:00+08:00');`
       `assert.equal(chinaFuturesStrategy.isTradingNow(regularNight, 'RB0'), isFutureTrading('RB0', regularNight)); // true`
       `assert.equal(chinaFuturesStrategy.isTradingNow(regularNight, 'AU0'), isFutureTrading('AU0', regularNight)); // true`
       `assert.equal(chinaFuturesStrategy.isTradingNow(regularNight, 'T0'), isFutureTrading('T0', regularNight));   // false`
       `assert.equal(chinaFuturesStrategy.isTradingNow(regularNight, 'IF0'), isFutureTrading('IF0', regularNight)); // false`
     * **深夜 23:30**：RB0（23:00 收盘）已休市，AU0（次日 02:30 收盘）仍在交易：
       `const lateNight = new Date('2026-09-16T23:30:00+08:00');`
       `assert.equal(chinaFuturesStrategy.isTradingNow(lateNight, 'RB0'), false);`
       `assert.equal(chinaFuturesStrategy.isTradingNow(lateNight, 'AU0'), true);`
       `assert.equal(chinaFuturesStrategy.isTradingNow(lateNight, 'AU0'), isFutureTrading('AU0', lateNight));`
     * **凌晨 02:40**：AU0（02:30 收盘）已休市，全品种关闭：
       `const afterLateNight = new Date('2026-09-17T02:40:00+08:00');`
       `assert.equal(chinaFuturesStrategy.isTradingNow(afterLateNight, 'AU0'), false);`
       `assert.equal(chinaFuturesStrategy.isTradingNow(afterLateNight, 'AU0'), isFutureTrading('AU0', afterLateNight));`
     * **日盘 15:08**：国债 T0 仍在交易（15:15 收盘），股指 IF0 与商品已休市（15:00 收盘）：
       `const treasuryLateDay = new Date('2026-09-16T15:08:00+08:00');`
       `assert.equal(chinaFuturesStrategy.isTradingNow(treasuryLateDay, 'T0'), true);`
       `assert.equal(chinaFuturesStrategy.isTradingNow(treasuryLateDay, 'IF0'), false);`
       `assert.equal(chinaFuturesStrategy.isTradingNow(treasuryLateDay, 'RB0'), false);`
      * **分时时段区间断言（盲点 3 闭环）**：
        `const rbRanges = chinaFuturesStrategy.getIntradaySessionRanges(regularNight, 'RB0');`
        `assert.ok(rbRanges.some(([s, e]) => s === 1260 && e === 1380)); // 含夜盘 21:00-23:00`
        `const auRanges = chinaFuturesStrategy.getIntradaySessionRanges(regularNight, 'AU0');`
        `assert.ok(auRanges.some(([s, e]) => s === 0 && e === 150));    // 含次日凌晨 00:00-02:30`
        `const t0Ranges = chinaFuturesStrategy.getIntradaySessionRanges(regularNight, 'T0');`
        `assert.ok(t0Ranges.some(([s, e]) => e === 915));                 // 国债 15:15 收盘`
        `const ifRanges = chinaFuturesStrategy.getIntradaySessionRanges(regularNight, 'IF0');`
        `assert.ok(ifRanges.every(([s]) => s < 900));                    // 股指无夜盘`
      * 变异验证：若将 `ChinaFuturesSessionStrategy` 变异为「不委托、套用 A 股二元分派或无品种单例」，上述 21:30、23:30、02:40、15:08 与分时区间用例**必须确定性转红**！
 2. **新资产功能验收断言（全面升级）**：
    * **secid 有效性与 `toEastmoneySecId` 解析断言（P3-1 闭环）**：
      * Phase 1 全部 10 个品种均具备明确的东财 secid，且均能成功通过 `qt` + `trends2` + `kline` 三端点拉取行情与图表，新浪 `hf_` 作为全量备源；
      * 断言解析器正确返回真实 secid：
        `assert.equal(toEastmoneySecId('GL_A50'), '104.CN00Y')`；
        `assert.equal(toEastmoneySecId('GL_HSI'), '134.HSI_M')`；
        `assert.equal(toEastmoneySecId('GL_CL0'), '102.CL00Y')`；
        `assert.equal(toEastmoneySecId('hk00700'), '116.00700')`；
        `assert.equal(toEastmoneySecId('usAAPL'), '105.AAPL')`。
    * **美股特殊符号与探测缓存断言（盲点 1 与 盲点 2 闭环）**：
      * 断言美股正则与类型解析器完整支持点号与短横线特殊代码：
        `assert.equal(inferAssetType('usBRK.A'), 'stock_us')`；
        `assert.equal(inferAssetType('usBRK.B'), 'stock_us')`；
        `assert.equal(inferAssetType('usBF.B'), 'stock_us')`；
        `assert.equal(inferAssetType('BRK.A'), 'stock_us')`；
      * 断言未收录美股标的首次探测确立 marketId 后，立即存入双层缓存；二次调用时直接从内存短路返回，额外网络发包为 0。
    * **10 品种端点单位全字段与备源一致性断言（P1-1、P2-1 与 P3-1 闭环）**：
      * 断言 10/10 品种同一时刻真源取数缩放对齐（东财内部）：
        `assert.ok(Math.abs(qt.f43 / qtDivisor - trends2.last.close) / trends2.last.close <= 0.005)`；
        `assert.equal(qt.f60 / qtDivisor, trends2.preClose)`；
      * 断言跨源对齐：
        * 针对 1:1 品种（GC, SI, NQ, ES, YM, A50, HSI）及比例品种（HG*0.01）：
          `assert.ok(Math.abs(qt.f43 / qtDivisor - sina.field0 * sinaScale) / (sina.field0 * sinaScale) <= 0.005)`；
        * 针对两源合约月差异品种（CL, NG，P2-1、P3-2 与盲点 5 闭环）：
          `// 核心断言备源报价的昨结基准绑定自身 field7（消除换月价差错位，P3-2 完整绑定）：`
          `const sinaClPayload = 'var hq_str_hf_CL="99.227,,99.140,99.160,100.610,98.990,18:38:00,100.750,100.460,0,1,17,2026-09-16,纽约原油,0";';`
          `const primaryCl = parseEastmoney({ data: { f107: 102, f57: 'CL00Y', f43: 10382, f60: 10583 } });`
          `const fallbackCl = parseSinaGlobalFuture(sinaClPayload, { code: 'GL_CL0' });`
          `assert.equal(fallbackCl.prevClose, Number(sinaClPayload.split(',')[7])); // 100.750`
          `// 换月解耦说明：涨跌幅严格依据备源内部闭环数据计算（(price - prevClose) / prevClose），两源基差漂移不污染计算。`
          `// 常规非换月日跳变受两源合约基差日间变动影响（实测 0.236pp ~ 0.41pp），设定 < 0.6pp 仅作为平滑性上限守卫：`
          `assert.ok(Math.abs(fallbackCl.changePercent - primaryCl.changePercent) < 0.6);`
          `// 变异验证：若将备源昨结错误绑定为东财 f60（105.83），计算所得 fallbackCl.changePercent 将出现严重偏离（偏离 > 6.0pp），对应用例必须确定性转红！`
      * 断言全部 10 个品种的 `open/high/low` 经 `qtDivisor` 归一化后同级一致，且 `openChangePercent` 处于正常区间（|值| < 5%，绝不出现 10~100 倍错位或 -90% 伪跌幅）；
      * 变异验证：将任一品种的 `qtDivisor` 改错一个数量级，对应用例**必须确定性转红**。
    * **港美股东财 qt 端点量纲（div1000）验收断言（P2-1 与 P3-3 闭环）**：
      * 断言港美股通过 `parseEastmoney` 兜底时正确应用 `div1000`：
        `const parsedHk = parseEastmoney({ data: { f107: 116, f57: '00700', f43: 433400, f60: 438800 } });`
        `assert.equal(parsedHk.code, 'hk00700');`
        `assert.equal(parsedHk.type, 'stock_hk');`
        `assert.equal(parsedHk.price, 433.40);`
        `assert.equal(parsedHk.prevClose, 438.80);`
        `const parsedUsNas = parseEastmoney({ data: { f107: 105, f57: 'AAPL', f43: 331340, f60: 330000 } });`
        `assert.equal(parsedUsNas.code, 'usAAPL');`
        `assert.equal(parsedUsNas.type, 'stock_us');`
        `assert.equal(parsedUsNas.price, 331.34);`
        `const parsedUsAmex = parseEastmoney({ data: { f107: 107, f57: 'SPY', f43: 757390, f60: 760880 } });`
        `assert.equal(parsedUsAmex.code, 'usSPY');`
        `assert.equal(parsedUsAmex.type, 'stock_us');`
        `assert.equal(parsedUsAmex.price, 757.39);`
        `assert.equal(parsedUsAmex.prevClose, 760.88);`
      * 变异验证：若将港美股任一市场号（116, 105, 106, 107）除数遗漏或改错为 100（A 股默认），该断言**必须确定性转红**。
   * **规范身份推导断言**：
     * 断言 `parseEastmoney(a50Payload).code === 'GL_A50'` 且 `parseEastmoney(hsiPayload).code === 'GL_HSI'`，且类型为 `'futures_global'`，杜绝 `'szcn00y'` / `'szhsi_m'` 错误身份导致报价在 `monitorController` 被丢弃。
   * **会话与语音隔离双向判别断言（P1-2、P2-1 与 P3-2 闭环）**：
     * **跨时区活跃播报断言**：调用真实 `decideVoiceSchedule`，在北京时间 22:00（`now = new Date('2026-09-16T22:00:00+08:00')`）注入自选 `codes = ['sh600519', 'GL_CL0']`，给定 `settings = { enabled: true, smartSchedule: { enabled: true, autoStopAfterClose: true, pauseLunchBreak: true } }` 与 `previous = { timerShouldRun: true, eligibleCodes: ['sh600519', 'GL_CL0'] }`，断言：
       `enabled === true`、`timerShouldRun === true`、`transitionNotice === null`（美原油正常播报，绝不被 A 股收盘误关）；
     * **A 股盘后外盘活跃断言**：在北京时间 16:00 注入自选 `codes = ['sh600519', 'GL_HSI']` 与 `previous = { timerShouldRun: true, eligibleCodes: ['sh600519', 'GL_HSI'] }`，断言 `enabled === true`、`timerShouldRun === true`；
     * **纯 A 股收盘正常停播反向断言（P3-2 完整入参）**：在北京时间 16:00 注入纯 A 股自选 `codes = ['sh600519']`，给定上述同等 `settings` 与 `previous = { timerShouldRun: true, eligibleCodes: ['sh600519'] }`，断言：
       `enabled === false`、`timerShouldRun === false`、`transitionNotice === '已收盘'`；
     * **午休只暂停断言（P2-1 防回归防误关断言）**：在北京时间 12:00（`now = new Date('2026-09-16T12:00:00+08:00')`）注入纯 A 股自选 `codes = ['sh600519']`，给定上述同等 `settings`（`pauseLunchBreak: true`）与 `previous = { timerShouldRun: true, eligibleCodes: ['sh600519'] }`，断言：
       `enabled === true`（绝不永久关闭）、`timerShouldRun === false`（暂停计时器）、`transitionNotice === '中午休市'`；
     * 变异验证：若将 `voiceSchedule.js:28` 判据变异为 `!hasExtendedHoursAssets && !allowed`（即丢弃 `session === 'after-close'`），该午休断言**必须确定性转红**；若回退为 `!futures.length`，跨时区 22:00 用例**必须确定性转红**。
   * **语音单位与小数位断言（P3-2 闭环）**：
     * 注入 `type='futures_global'` 的外盘报价，断言 `formatQuoteSpeech` 输出中不含“元”后缀，美原油/黄金播报格式符合期货规范；把 `type` 变异为 `'stock'` 时用例**必须转红**。
   * **代理出网与受限环境兜底断言**：
     * 断言在 `push2his` 族主机与 `push2` 均不可达的受限环境下（可通过本地代理或 hosts 模拟），浏览器侧 `/api/eastmoney*` 代理路由与 `proxyService` 自动轮转至 `push2delay.eastmoney.com`，三端点仍能 100% 成功取数。
   * **内部备源符号 hf_* 准入防线与全值域正交断言（待确认风险 1 闭环）**：
     * 断言 `parseFutureInput('SI0')` 保持国内工业硅，而 `GL_SI0` / `hf_SI` / `hf_HSI` / `hf_CL` 经 `inferAssetType` 均准确解析为 `futures_global`，送入会话调度器时绝不误判为 A 股策略；
     * 断言 `normalizeCode('hf_CL') === null`、`normalizeCode('hf_HSI') === null`、`normalizeCode('hf_CHA50CFD') === null`，严禁内部符号直接进入自选池；
     * 断言搜索联想输出结果集不含任何 `hf_` 符号（`searchSuggest('原油').every(item => !item.code.startsWith('hf_'))` 且 `searchSuggest('原油').some(item => item.code === 'GL_CL0')`）；
     * 运行全值域覆盖单测，断言 10/10 场景全部符合预期（包含 `unknown_foo` 严格回退 `stock_cn` 兜底防崩）。
   * **冬夏结算窗口断言**：以冬令时/夏令时两个固定时钟驱动 `GlobalFuturesSessionStrategy`，分别断言结算窗口为 `06:00-07:00` 与 `05:00-06:00`。
   * **限价带短路断言**：断言非 A 股标的的 `classifyKlineBar` 返回 `'normal'`，无涨跌停带。
   * **分时完整性断言**：美股分时图 391 根（trends2）数据点无截断丢失，外盘分时无日内断裂。
3. **单一客观性能红线**：
   * **构建体积门禁**：生产打包产物 `dist/assets/index-*.js` 的 Gzip 压缩后体积相比基准增量 **≤ 10.0 KB**（当前 Gzip 基准为 115.10 KB，构建后不得超过 125.10 KB）；
   * **静态词库增量**：新增国际品种词典静态 JSON 增量 **≤ 25.0 KB**。
