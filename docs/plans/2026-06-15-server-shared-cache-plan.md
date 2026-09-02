# 服务端共享市场数据缓存改造计划

## 目标

把当前“单用户浏览器缓存型 SPA”升级为“多人访问 + 服务端共享公共市场数据缓存”的结构。

核心原则：

- 用户私有数据继续留在浏览器 `localStorage`。
- 公共市场数据放在服务器目录 `data/cache/`，所有用户共享。
- 外部数据源失败时优先返回可用的过期缓存，减少空白页面。
- 前端保留本地 K 线缓存作为二级缓存，后端文件缓存作为一级共享缓存。

## 数据分类

继续留在浏览器：

```text
stock_watch_list          用户自选列表
app_theme                 主题
app_settings              监控页刷新设置
voice_settings            语音设置
price_alerts              价格提醒设置
subscribed_codes          语音订阅
momentum_pinned_codes     10日涨幅池置顶
limit_up_pinned_codes     涨停池置顶
limit_up_settings         涨停页刷新设置
kline-cache-v1            浏览器 K 线二级缓存
```

迁移到服务端共享缓存：

```text
K 线数据
分时数据
涨停池
炸板池
涨停原因
交易日历
10日涨幅池
全市场实时行情快照
```

## 目录结构

```text
server/
├── index.js
├── cacheStore.js
├── marketData.js
├── klineService.js
├── limitUpService.js
├── momentumService.js
├── calendarService.js
├── intradayService.js
├── spotService.js
└── utils.js

data/
└── cache/
    ├── kline/
    │   └── sh600519/
    │       ├── 1d.json
    │       └── 5m.json
    ├── limit-up/
    │   └── 20260615/
    │       ├── limit-up.json
    │       ├── broken.json
    │       ├── reasons.json
    │       └── merged.json
    ├── intraday/
    │   └── sh600519/
    │       └── 20260615-latest-168p0000.json
    ├── momentum/
    │   └── 20260615/
    │       └── ten-day-45pct.json
    ├── calendar/
    │   └── trade-dates.json
    └── spot/
        └── latest.json
```

`data/cache/` 是运行时缓存目录，不提交进 Git。

## API 设计

```text
GET /api/cache/kline?code=sh600519&period=1d
GET /api/cache/intraday?code=sh600519&date=20260615&prevClose=168
GET /api/cache/limit-up?date=20260615
GET /api/cache/limit-up/reasons?date=20260615
GET /api/cache/momentum/ten-day?date=20260615&threshold=45
GET /api/cache/calendar/trade-dates
GET /api/cache/spot/latest
```

统一响应：

```json
{
  "ok": true,
  "source": "cache",
  "stale": false,
  "generatedAt": 1781540000000,
  "ttlMs": 30000,
  "data": {}
}
```

`source` 语义：

```text
cache       命中文件缓存
network     刚从外部数据源刷新
stale       上游失败，返回过期缓存
empty       没有数据
```

## 缓存策略

K 线：

- 日/周/月 K：盘中 TTL 1 小时，盘后长期保存。
- 分钟 K：盘中 TTL 1-5 分钟，盘后当天保存。
- 文件：`data/cache/kline/{code}/{period}.json`

涨停池：

- 盘中 TTL 15-30 秒。
- 盘后长期保存。
- 历史日期直接读文件。
- 文件：`data/cache/limit-up/{YYYYMMDD}/limit-up.json`、`broken.json`、`merged.json`

涨停原因：

- 按日期缓存。
- 盘中 TTL 5-10 分钟。
- 盘后长期保存。
- 文件：`data/cache/limit-up/{YYYYMMDD}/reasons.json`

10 日涨幅池：

- 盘中 TTL 1-5 分钟。
- 盘后长期保存。
- 按阈值区分结果。
- 当前实现是“当前全市场快照 + 最新日 K 线”的强势股扫描；前端扫描入口不再借用涨停页历史日期做缓存 key。
- 文件：`data/cache/momentum/{YYYYMMDD}/ten-day-45pct.json`

交易日历：

- TTL 1 天或 1 周。
- 上游失败时返回旧缓存。
- 文件：`data/cache/calendar/trade-dates.json`

## 实施阶段

### Phase A：基础设施

- 新增 `server/`。
- 新增 `data/cache/` 运行时目录。
- 实现文件缓存读写、TTL 判断、统一响应。
- `.gitignore` 忽略 `data/cache/`。

### Phase B：涨停池服务端缓存

- 实现 `/api/cache/limit-up`。
- 实现 `/api/cache/limit-up/reasons`。
- 后端访问 AKTools。
- 前端 `limitUpApi.js` 优先走新接口，失败回退旧 AKTools 路径。

### Phase C：K 线服务端缓存

- 实现 `/api/cache/kline`。
- 后端直接请求东财，失败回退腾讯。
- 前端 `fetchKline()` 优先走后端缓存 API。
- 浏览器 `kline-cache-v1` 保留为二级缓存。

### Phase D：10 日涨幅池服务端缓存

- 实现 `/api/cache/momentum/ten-day`。
- 后端读取 AKTools 全市场实时快照。
- 后端复用 K 线服务计算最近 10 个交易日涨幅。
- 前端扫描按钮优先请求服务端结果，失败再使用旧前端扫描逻辑。

### Phase E：交易日历和分时

- 实现 `/api/cache/calendar/trade-dates`。
- 实现 `/api/cache/intraday`。
- 实现 `/api/cache/spot/latest`。
- 进一步减少浏览器直连 AKTools。
- 前端交易日历、分时图、10 日涨幅全市场快照优先访问服务端共享缓存，失败后回退旧路径。

### Phase F：部署整理

- 开发环境：`npm run dev` 由 Vite 同一进程提供前端、外部 API 代理和内置 `/api/cache/*`，不再需要单独 `dev:cache`。
- 生产环境：`npm run server` / `npm start` 由同一个 Node 后端提供 `dist/` 静态前端和 `/api/cache/*`。
- AKTools 仍只在服务器本地运行。
- 浏览器侧继续优先访问 `/api/cache/*`，失败再走旧路径。
- 已更新 README / AGENTS 启动说明。

## 验证

每阶段至少运行：

```bash
npm run lint
npm test
npm run build
```

涉及页面行为时运行：

```bash
npm run e2e
```

重点检查：

- 缓存命中不请求上游。
- 缓存过期会刷新。
- 上游失败返回 stale cache。
- 历史日期直接读缓存。
- 多人请求同一数据不会重复打上游。
- 10 日涨幅池结果与前端旧算法一致。

## 2026-06-15 试用反馈与修正项

用户试用反馈：

- 缓存文件需要确认是否真实生成。
- 涨停页面切换日期后，列表没有马上跟着日期切换，或切换非常慢。
- 10 日涨幅扫描疑似没有从全股票中扫描，缺少可见进度和落盘反馈。

现场确认：

- `data/cache/limit-up/` 已生成多个交易日的 `merged.json` / `reasons.json`。
- `data/cache/kline/` 已生成大量股票的 `1d.json`。
- `data/cache/momentum/` 未生成，说明 10 日涨幅后端扫描没有成功完成并落盘。

追加改造：

- 涨停切日期时立刻取消上一轮请求、清空旧日期列表、显示 loading，避免旧列表误导用户。
- 涨停池先渲染服务端缓存返回的原始列表，再异步合并实时行情，避免等行情 enrichment 才换列表。
- 10 日涨幅后端改为后台扫描任务：请求立即返回 `status: "scanning"`，同时写入进度缓存文件。
- 前端识别 `status: "scanning"` 后显示扫描进度并自动轮询，完成后展示完整结果。
- “先渲染原始列表，再异步合并实时行情”只适用于当天数据；历史日期必须直接展示该交易日缓存/AKTools 数据，不能混入今天实时行情。

## 2026-06-15 缓存准确性与保留策略

用户补充要求：

- 当天数据不能被缓存影响准确性；切换到今天时应该强制更新一次。
- 非当天数据可以直接使用缓存显示。
- 服务端缓存默认保留最近 60 天的数据文件。
- 如果数据文件超过 60 天，再判断最近 30 天是否被调用过；调用过则继续保留，否则删除。

落地规则：

- `/api/cache/limit-up?force=1` 绕过 TTL，强制刷新并写回缓存。
- 前端只在用户切换到今天时传 `force=1`；普通自动刷新仍走短 TTL，避免多人访问时冲击 AKTools。
- 服务端缓存文件写入 `generatedAt` 和 `lastAccessedAt`。
- `lastAccessedAt` 每次读取缓存时更新。
- 清理策略：`generatedAt` 在 60 天内保留；超过 60 天但 `lastAccessedAt` 在 30 天内也保留；否则删除。

## 2026-06-15 历史日期被今天数据覆盖反馈

用户试用反馈：

- 在涨停页向前切换历史日期后，历史数据只显示几秒钟，随后又被今天的最新数据覆盖。

原因判断：

- 这不是历史缓存文件本身一定错误，而是前端存在异步竞态。
- 进入涨停页、定时刷新、日期切换、实时行情补全、涨停原因补全会并发返回。
- 旧请求返回较晚时，仍可能写入 `state.limitUp`，导致当前历史日期页面被旧的今天请求覆盖。

修正项：

- 为涨停页请求增加 `requestSeq` 序号。
- 日期切换时立即递增序号并中止上一轮请求，使旧回调失效。
- `ensureLimitUpTradingDate`、列表拉取、实时行情补全、metadata 补全、原因补全都必须确认 `requestSeq` 和 `selectedDate` 仍匹配后才能写 UI。
- 日期切换不再先异步校正日期再拉取，避免旧日期校正回调覆盖新选择；统一由当前列表请求负责日期校正。

## 2026-06-15 历史日期切换时两套数据交替反馈

用户试用反馈：

- 往前切换历史日期时，页面会请求到两套数据，中间交替闪动，最后才停留在正确历史数据。

原因判断：

- 历史涨停池列表返回后，前端仍会发实时行情 `fetchQuotes` 补全请求。
- 该实时行情是当天行情，不适合覆盖历史日期的价格、涨跌幅、成交额等字段。
- 旧兼容逻辑 `fetchLimitUpMetadataBatch` 也会重复拉一遍同日期涨停池；主列表已经包含连板、封板、炸板字段时没有必要再请求。

修正项：

- 只有当前选择日期等于今天时，才允许执行实时行情补全。
- 历史日期禁止 `mergeLiveTicks` 合并当前实时行情。
- metadata 兼容补拉只在主列表缺少相关字段时触发，避免同日期重复拉取涨停池。

## 2026-06-15 收尾状态

已完成：

- Phase A-F 已落地。
- 开发环境和生产环境都合并为同一个 Node/Vite 后端入口，不再需要单独启动缓存后端。
- `/api/cache/kline`、`/api/cache/intraday`、`/api/cache/limit-up`、`/api/cache/limit-up/reasons`、`/api/cache/momentum/ten-day`、`/api/cache/calendar/trade-dates`、`/api/cache/spot/latest` 已接入。
- 前端涨停页、K 线、分时、交易日历、10 日涨幅扫描均优先使用服务端共享缓存，失败后回退旧路径。
- 历史涨停日期切换的旧请求覆盖、实时行情覆盖历史数据、重复 metadata 请求问题已修复。
- 服务端缓存保留规则已实现：60 天内保留；超过 60 天但最近 30 天被访问过也保留；否则清理。

验证结果：

```bash
npm run lint
npm test
npm run e2e
npm run build
npm run ci
```

全部通过。`npm test` 在 jsdom 环境仍会打印 lightweight-charts 触发的 `HTMLCanvasElement.prototype.getContext` 未实现噪声，但退出码为 0，不影响测试结论。

## 2026-06-15 10 日涨幅 500 与盘后刷新反馈

用户反馈：

- 10 日涨幅出现 HTTP 500，疑似后端 `socket hang up` 后停止。
- 10 日涨幅不应等用户点击后才开始全市场扫描。
- 后端应在北京时间 08:00 盘前、15:01 盘后自动扫描。
- 首页监控和涨停页数据在收盘后不需要自动刷新，开盘后自动恢复。
- 数据刷新不要和语音开关绑在一起；只复用交易时段判断逻辑。

修正项：

- `/api/cache/momentum/ten-day` 改成只读缓存/扫描状态，不再由用户请求启动全市场扫描。
- 服务端启动后台任务：启动时如果当天 10 日涨幅缓存缺失会补扫一次，并每天北京时间 08:00、15:01 定时扫描。
- 10 日涨幅后台任务捕获上游异常并写入 `status: "error"` 缓存，避免未处理异常导致 Node 进程退出。
- 开发环境 Vite 和生产 `npm run server` 都会启动后台任务；E2E 通过 `DISABLE_BACKGROUND_JOBS=1` 关闭真实后台扫描。
- 新增独立的数据自动刷新守护：只复用 `getMarketSession()` / `isAutoRefreshAllowedInSession()`，不读取或修改语音开关。
- 首页监控和涨停页都有独立的 `autoRefreshEnabled` 与 `autoRefreshPausedBySchedule` 状态；午休/收盘暂停自动刷新，交易时段恢复。
- 手动“立即刷新”仍可在收盘后主动拉一次数据；点击语音不会启动数据自动刷新。
