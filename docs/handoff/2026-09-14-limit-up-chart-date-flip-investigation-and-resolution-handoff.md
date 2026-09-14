# 涨停看板切历史日期图表展示异常调查与根因方案交接

## 1. 背景与问题定义

在涨停看板（`#/limit-up`）的日期切换与图表联动中，用户反馈并实测发现以下异常现象：
- **前一天（T-1）**：当看板翻到前一个交易日（例如当前为 2026-09-14，翻到 2026-09-11），点击展开某只涨停标的的图表时，图表展示的是前一天的历史图，**完全缺少今天的日 K 蜡烛线和今天的日内分时**。
- **前两天（T-2）**：当看板翻到前两个交易日（例如 2026-09-10），展开图表却能正常展示最新图（包含今日日 K 蜡烛与今日实时分时走势）。
- **用户核心诉求**：涨停看板翻到历史日期主要是为了回顾过往涨停个股在“今天”的溢价、接力与持续性表现；展开图表时默认应当始终显示最新行情图（包括今日日 K 和今日分时）。用户要求全面审查图表相关逻辑，解释为什么只有前一天的图展示逻辑错误。

---

## 2. 根因深度剖析

经过对全链路代码（包括日期解析、图表控制器、分钟线合成及上游滑动窗口）的审计，确定该现象由 **业务层的人为日期锁定** 与 **上游分钟线 320 根滑动窗口机制** 共同引发。

```mermaid
flowchart TD
    A["用户在涨停看板切到历史日期"] --> B{"切换的目标日期"}
    B -->|切到前一天 T-1| C["limitUpChartMgr.resolveTradeDate 返回 T-1"]
    B -->|切到前两天 T-2| D["limitUpChartMgr.resolveTradeDate 返回 T-2"]
    
    C --> E["请求 T-1 分时数据"]
    E --> F["腾讯旧版 320 根滑动窗口覆盖 T-1 (命中约 199 根 Bar)"]
    F --> G["服务端成功合成 T-1 静态历史分时并渲染"]
    G --> H["isLiveTradeDate(T-1) 为 false，阻断今日实时分时流推送"]
    H --> I["❌ 分时图完全被昨日静态线霸占，造成整图伪装锁死"]

    D --> J["请求 T-2 分时数据"]
    J --> K["320 根滑动窗口物理耗尽 (T-2 命中 0 根)"]
    K --> L["历史分时合成落空，前端提示'暂无分时'"]
    L --> M["✅ 未形成虚假静态分时占位，暴露真实缺省状态"]

    subgraph 共性缺陷["历史看板共性缺陷 (T-1 与 T-2 均存在)"]
        N["报价缺少日期字段时 targetDate 兜底为 inst.selectedTradeDate"]
        N --> O["若本地日K缓存未含当天 (lastDate=T-1): 原地覆盖昨日柱，未追加今日蜡烛"]
    end
    C -.-> N
    D -.-> N
```

### 2.1 机制一：`limitUpChartMgr.resolveTradeDate` 的历史日期强绑定

在 [`src/js/app.js:414-419`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/app.js#L414-L419)：
```javascript
resolveTradeDate: (code, data) => {
  const dates = state.tradingDates || state.limitUp.tradingDates || [];
  const latestTradeDate = resolveLatestTradingDate(getBeijingDate(), dates);
  const isHistorical = state.limitUp.selectedDate && latestTradeDate && state.limitUp.selectedDate < latestTradeDate;
  return isHistorical ? state.limitUp.selectedDate : resolveInitialTradeDate(code, data);
}
```
自选监控页（[`monitorChartMgr`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/app.js#L387-L400)）始终使用 `resolveInitialTradeDate`（即今天）。而在以前某次缺陷修复中，开发者为 `limitUpChartMgr` 增加了当 `selectedDate < latestTradeDate` 时强制返回 `state.limitUp.selectedDate` 的逻辑，导致展开图表时 `inst.selectedTradeDate` 被硬编码为历史日期。

### 2.2 机制二：上游 1 分钟 K 线降级源的 320 根滚动滑动窗口覆盖差异（为什么偏偏是前一天被锁）

1. **分钟源接口与滑动窗口深度**：
   - 东方财富 1 分钟 K 线接口（[`buildEastmoneyKlineUrl`](file:///d:/AiPrograms/project1/market-voice-alert/server/klineService.js#L40)）参数上限设为 1000 根（`lmt=1000`）。
   - 腾讯旧版 K 线构造函数 [`buildTencentKlineUrl`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/kline.js#L194)（默认参数行位于 [`kline.js:200`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/kline.js#L200)）其默认限制均为 **320 根 Bar**（`lmt=320`）。
   - 在服务端实现中，分时服务（[`server/intradayService.js:203`](file:///d:/AiPrograms/project1/market-voice-alert/server/intradayService.js#L203)）在主历史源不可用时，会调用 `getCachedKline({ period: '1m' })` 降级提取历史分钟 Bar。当东财接口遇到限流冷却（`klineService.js:90-120`）而降级回退到腾讯源时，本地缓存的分钟 K 线（如 `data/cache/kline/sh600519/1m.json`，源标为 `tencent-legacy`）严格受限于这 **320 根 Bar 的滚动滑动窗口**。
2. **A 股时间尺度与滑动窗口实际分布**：
   A 股每个常规交易日包含 240 根 1 分钟 Bar（9:30-11:30 为 120 根，13:00-15:00 为 120 根）。在盘中运行时，320 根 Bar 的分布特性如下：
   - **当天（T）**：盘中已产生的部分 Bar 优先占据窗口顶部（例如上午 11:30 产生约 121 根 Bar）。
   - **前一天（T-1）**：窗口剩余容量（320 - 121 = 199 根）完整容纳前一交易日的大部分/全部 Bar（盘前未开盘时则为完整 240 根）。
   - **前两天（T-2）**：由于 121 + 240 = 361 > 320，前两天的数据已被物理滑出窗口，匹配项恒为 0 根。
3. **分时合成的致命差异**：
   - **当请求前一天（T-1）时**：[`server/intradayService.js:215`](file:///d:/AiPrograms/project1/market-voice-alert/server/intradayService.js#L215) 执行 `filterKlineItemsByDate(klineData.items, 'T-1')`，在 320 根窗口内**精准命中前一天的约 199~240 根 Bar**，成功拼装出前一天的静态分时走势并返回前端渲染。
   - **当请求前两天（T-2）时**：320 根窗口内匹配项为 0。在 AKTools 历史分钟源未就绪时，无法拼装出走势，返回空数据或报错。
4. **实时推送切断**：
   当 `inst.selectedTradeDate` 被锁定为前一天（T-1）后，[`src/js/marketSession.js:138`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/marketSession.js#L138) 的 `isLiveTradeDate(selectedDate)` 判定非当日返回 `false`，导致 [`chartRowController.js:135`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/controllers/chartRowController.js#L135) 和 [`app.js:1324`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/app.js#L1324) 彻底拒收并跳过今日的一切实时分时注入。

### 2.3 机制三：日 K 的 `applyLiveQuoteToKline` 覆盖逻辑（历史看板通用缺陷）

在 [`src/js/controllers/chartRowController.js:380-389`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/controllers/chartRowController.js#L380-L389)：
```javascript
const targetDate = q.tradingDay || q.date || q.quoteDate || inst.selectedTradeDate || getBeijingDate();
const quoteForKline = (q.tradingDay || q.quoteDate || q.date) ? q : { ...q, date: targetDate };
const merged = applyLiveQuoteToKline(inst.klineData.items, quoteForKline, inst.period);
```
当股票报价缺少显式日期字段时（例如东财快照行情流缺少 `tradingDay/date/quoteDate`），`targetDate` 兜底取了 `inst.selectedTradeDate`。
传入 [`src/js/kline.js:420`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/kline.js#L420) 的 `applyLiveQuoteToKline`：
```javascript
if (period === '1d' && lastDate && targetDate && lastDate < targetDate) {
  return [...items, newBar]; // 追加今日新蜡烛
}
// 否则：原地修改最后一根 Bar！
const updated = { ...last, close: price };
return [...items.slice(0, -1), updated];
```
- **触发前置条件**：
  1. 日 K 缓存处于未含当天状态（如依据 1 小时 TTL 命中盘前生成的静态日 K 缓存文件，`lastDate = 'T-1'`）；
  2. 行情源未提供独立日期字段，`targetDate` 退化取历史日期 `selectedTradeDate`。
- **共性缺陷定性（核心澄清）**：
  在满足上述条件时，`lastDate < targetDate` 判定恒为 `false`（对于 T-1 看板，`T-1 < T-1` 为假；对于 T-2 看板，`T-1 < T-2` 亦为假）。**系统没有为今天追加新蜡烛 Bar，反而把最后一根柱子原地覆盖成了今天的现价**。
  **因此，日 K 报价覆盖缺陷是所有历史看板（T-1 与 T-2）共有的底层问题，并非 T-1 独有。**

### 2.4 掩盖点：`isLatestKlineDate` 的逻辑假阳性

在 [`src/js/app.js:714-719`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/app.js#L714-L719)：
```javascript
function isLatestKlineDate(inst, date) {
  if (!date) return false;
  if (isLimitUpDateToday(date)) return true;
  if (!inst || !inst.klineData || !Array.isArray(inst.klineData.items)) return false;
  return getLastKlineDate(inst.klineData.items) === date;
}
```
当日 K 最后一根 Bar 为前一天时，传入前一天 `date`，`getLastKlineDate === date` 判定为 `true`。系统误以为“昨天就是最新日期”，形成了闭环假象。

---

## 3. 为什么用户会觉得“只有前一天展示错误，前两天没有问题”？

由于日 K 覆盖逻辑对 T-1 与 T-2 是对称的，**导致用户体验出现巨大反差的真正元凶，是分时图的“伪装占领”机制**：

1. **前一天（T-1）：“假分时”成功装填，达成整图伪装锁死**：
   - 腾讯 320 根滑动窗口刚好容纳了 T-1 的 199 根分钟线，分时图画出了一条看似“极其完整、真实”的历史走势；
   - 随后 `isLiveTradeDate(T-1)` 默默关死了今日实时推送；
   - 叠加日 K 的静态展示，用户看到的是一张**表面毫无破绽、但完完全全属于昨天的全套图表**。用户期望看到今天的接力走势，却被昨天的假分时死死占领，因而强烈感知到“展示的是前一天的图，少了今天的分时和K线”。
2. **前两天（T-2）：滑动窗口物理耗尽，假象闭环被当场击穿**：
   - T-2 跌出了 320 根滑动窗口的物理极限（匹配为 0 根），服务端无法合成走势，分时图直接显示“暂无分时 / 点击右侧日K查看分时”；
   - **分时图没有被假数据占领**，暴露了真实缺省状态；
   - 在网络日 K 包含当天柱（`lastDate = Today`）时，日 K 正常显示今日柱，分时提示暂无；用户并不会产生“这是一张完美的前天历史图”的错觉。
3. **结论**：
   用户感知到的“只有前一天图表展示逻辑错误”，本质上是因为 **T-1 刚好命中了 320 根分钟滑动窗口能够合成历史伪分时的临界上界**，形成了“伪静态分时 + 推送静默切断”的闭环；而 T-2 跌出了该滑动窗口，伪装链条破裂，从而避免了“整图被伪装锁死”的假象！

---

## 4. 架构优化与修复方案

### 方案概述
1. **统一图表交易日解析契约**：
   修改 [`src/js/app.js:414-419`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/app.js#L414-L419)，将 `limitUpChartMgr` 的 `resolveTradeDate` 调整为与 `monitorChartMgr` 一致，统一使用 `resolveInitialTradeDate(code, data)`。无论看板翻到哪一天，展开图表默认始终展示当下最新交易日。
2. **实时报价目标日期防污染**：
   在 [`src/js/controllers/chartRowController.js:383`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/controllers/chartRowController.js#L383)，实时报价的 `targetDate` 兜底应当优先使用北京当前交易日（`resolveStockChartDate` 或 `getBeijingDate`），不再受任何历史 `selectedTradeDate` 污染，确保日 K 线始终追加今日蜡烛。
3. **保留历史分时查阅通道**：
   若用户确需查看某历史日期的分时走势，保留并依托成熟的原生能力：点击日 K 对应柱子（[`chartRowController.handleKlineBarClick`](file:///d:/AiPrograms/project1/market-voice-alert/src/js/controllers/chartRowController.js#L491)），即可精准切换至指定历史日期的分时。
