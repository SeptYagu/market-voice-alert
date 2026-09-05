# 全面代码审查报告 — market-voice-alert

> 审查日期：2026-09-05 · 审查范围：src/（前端 ~13k 行）+ server/（后端 ~3.2k 行）+ UI/UX + SPEC.md 符合度
> 方法：三路并行深审（前端 / 后端 / UX·规格），关键结论均已人工核验到 file:line。
> 前置基线：ESLint 0/0；`npm test` 650/651 通过（唯一失败为 Windows 回收站 API 被沙箱中断，属本机环境问题）。

---

## 一、总体结论

**质量面貌**：基础模块（storage / kline / time / api 竞态防护、fetchKline dedup+SWR、cacheStore 原子写 + single-flight、代理 SSRF 白名单、静态路径遍历防护）质量扎实，此前声称的 P0 安全修复**核验属实**。SPEC §3.1–3.6 核心功能全部落地且多处超越（智能时段调度、多 chart、K 线缓存预拉、确认弹窗、data-field 局部 patch）。用户四大痛点中「按钮真能点 / 禁用不报错 / 输入框不被刷新覆盖」验证成立。

**核心问题**：2026-09-05 的「视图解耦」重构引入了 **2 个 P0 回归**（10 日强势股行内 K 线永远挂不上、涨停页实时价合并从未生效），且无 e2e 覆盖兜住；多处「声称已修复」实际只修了一半路径（modal 焦点陷阱、涨停页全量重建、TTS 3 位小数、data-field 化）。后端存在 1 个可致**进程整体退出**的响应写出崩溃路径。

---

## 二、P0 — 功能性失效 / 崩溃风险（3 项，均本人核验属实）

### F-P0-1 · 10 日强势股行内 K 线永远无法挂载（解耦重构回归）
- `views/momentumView.js:190` 渲染 host id 为 `chart-host-momentum-${code}`；而 `app.js:499-509` 的 `momentumChartMgr` 前缀为 `'momentum-'`，`controllers/chartRowController.js:225` 查找的是 `momentum-chart-host-${code}` → **id 不匹配，`mountKlineChart` 永远找不到 host 静默 return**。
- 触发：点击任意强势股行展开 → 数据能加载，但图表区永久空白。e2e（`e2e/monitor.spec.js:74`）只断言 actions 栏无错误，从未展开 momentum 图表行。
- 修复：统一 id 方案（让 view 从 mgr 获取 id 或改 view 的 id 命名），并补一条「展开 momentum 图表行」的 e2e。

### F-P0-2 · 涨停页「行内实时价合并」从未生效（回调死接线）
- `app.js:1304、2690` 传入 `onLiveTickUpdate: applyLiveTicksToLimitUp`，但 `limitUpView.js` 全文**从未调用**（仅 :620 注释中出现）；`applyLiveTicksToLimitUp`（app.js:1551）实为死代码。
- 触发：停留在涨停看板页时，表格行内价格停留在上次 limitUpFetch 快照，每 30s 才动一次。STATUS「行内价格跟监控 timer 实时合并」与实际不符。
- 修复：在 `limitUpView` 的 patch 路径中接线该回调，或删除死回调改为 view 内直接 patch。

### B-P0-1 · 响应写出阶段异常无兜底，可致整个 Node 进程退出
- `server/utils.js:77-87` 的 `jsonResponse` 直接 `res.writeHead`，不检查 `res.headersSent` / `res.destroyed`；`server/index.js:328-334` 外层 catch 再次调 `jsonResponse` 再抛 → 异常从 `http.createServer` 回调同步冒泡为 uncaughtException。全项目无 `process.on('uncaughtException')` 兜底。
- 触发：浏览器在慢请求（momentum 全市场扫描、代理大响应）期间刷新/关页，对已销毁 socket 写响应 → **进程退出，momentum 定时任务与全部缓存下线**。
- 修复（<10 行）：`jsonResponse` 内加 `if (res.headersSent || res.destroyed) return` + try/catch；外层 catch 前置检查；入口加全局兜底仅记日志。

---

## 三、P1 — 竞态 / 泄漏 / 安全

### 前端
| # | 问题 | 位置 | 要点 |
|---|------|------|------|
| F1 | 涨停页每次轮询仍全量重建 DOM + 销毁重挂所有图表 | `app.js:1380` | `limitUpFetch()` 开头无条件 `rerenderLimitUpPage()`，使 Bug 2.5 的「就地 patch」修复打了对折；监控页 refresh 已改只 patch，涨停页未对齐 |
| F2 | `loadKline` finally 用旧 inst 覆盖新 inst（close→reopen 竞态） | `chartRowController.js:371-375` | finally 未比对 `getInst(code) === inst` 就写回，可留下 `klineData=null` 僵尸实例 → 图表「假死」 |
| F3 | `stopApp` 清理不完整 | `app.js:2715-2734` | 未 abort momentum 扫描与 in-flight refresh、未调 `router.stop()`（hashchange 监听泄漏）、momentum 5s 轮询 setTimeout 无句柄 |
| F4 | momentum 扫描轮询失控 | `app.js:730-733` | 服务端卡在 scanning 时每 5s 请求**永不停止**，路由切换/stopApp 都不能取消 |
| F5 | K 线 SWR revalidate 请求风暴 | `api.js:443-448、519-539` + `momentumScanner.js:71` | 本地扫描对 ~5000 候选逐一触发 revalidate，无 TTL、无并发上限 |
| F6 | momentum 条目直接注入全局 `state.quotes` | `app.js:747-749、789-791` | 缺 prevClose/open/high/low 等字段，同代码在 watchList 时监控行开盘价/量比被刷成 `-`，`formatQuoteSpeech`/`evaluateAlerts` 消费不完整 quote |
| F7 | 期货夜盘节假日误判 | `marketSession.js:54-80` | 凌晨段只查星期几不用 `tradingDates`；夜盘段不校验次一交易日是否节假日 → 节前夜/节假日凌晨 `isFuturesMarketOpen` 误为 true |

### 后端
| # | 问题 | 位置 | 要点 |
|---|------|------|------|
| B1 | POST 扫描接口可被任意网页 CSRF / DNS-rebinding 触发 | `server/index.js:42-71` + `utils.js:77-87`（`access-control-allow-origin: *`） | `POST /api/cache/momentum/ten-day/scan` 是重操作（全市场 ~5000 只日K刷新），无 Origin/Host 校验；建议校验 Host 必须 `127.0.0.1:{port}`（顺带防 rebinding） |
| B2 | 过期 job 被替换时旧任务不取消，双任务并发写同一缓存 | `server/momentumService.js:421-433` | 替换前未 `controller.abort()`；扫描超 10 分钟时用户再点一次即触发 |
| B3 | 客户端 abort 依赖 `AbortSignal.any`，无 engines 约束 | `server/utils.js:41-43` | Node < 20.3 的 fallback 静默丢弃 signal，取消能力失效；`package.json` 应声明 `engines.node >= 20.3` |
| B4 | 代理转发用已废弃的 `req.on('aborted')`，覆盖不全 + body 无大小上限 | `server/proxyService.js:22-39` | 上游等待期间客户端断开不感知 → 白等 15s 后写已销毁 socket（回到 B-P0-1 崩溃路径）；建议改 `res.on('close')` + body 上限 |
| B5 | 期货服务绕过 `fetchWithTimeout`，错误语义不一致 | `futuresQuoteService.js:25-28`、`futuresKlineService.js:33` 等 | 裸 fetch 的 `TimeoutError` 在 cache 路径一律 500 且 message 直接透传前端 |

---

## 四、P2 — 与声称不符 / 边界 / 体验缺陷

**「声称已修复」核验不符项**（重点，STATUS.md 需要更诚实）：
1. **modal「Tab 循环焦点陷阱」不存在** — `modal.js:89-103` 只处理 Escape/Enter，Tab 可移出弹窗到背景（声称 a11y 加固）。
2. **TTS 3 位小数播报缺失** — `tts.js:124` 固定 `toFixed(2)`，`alert.js:88` 通知侧已支持 3 位；Bug 2.7 声称「播报与展示统一」只完成了一半，国债期货 102.345 被播成 102.35。
3. **「data-field 彻底废除脆弱选择器」半完成** — `app.js:1258-1281` `patchLimitUpQuoteCells` 仍用 `.lu-price/.lu-pct` class 定位；`monitorTableView.js:337`、`momentumView.js:225-246` 仍保留硬编码下标 fallback。
4. **「app.js 瘦身、仅作生命周期协调」部分属实** — views 已物理拆出 ✓，但 app.js 仍 2738 行、保留全部 handler/校验/导出，:119-148 的向后兼容重导出块唯一消费者是测试（生产包袱）。
5. **「stopApp 统一清理」** — 见 F3，不完整。

**前端其他**：
- 死代码：`state.chartRowManager`（app.js:2048）从未赋值→期货判断分支永假；`state.dataLastSession`/`voiceLastSession` 只写不读；`getVoiceSession` 与 `getDataRefreshSession` 完全相同（app.js:2035-2043）。
- 分时/K线状态文案逻辑存在 **4 份拷贝**（chartRowController / app.js:949-982 / limitUpView:38-62 / momentumView:162-187），行为已分叉。
- `el()` 工厂被复制 **8 份**且保留 `html:` innerHTML 通道（当前无人用，属潜在 XSS 陷阱），应删该分支下沉共享 `dom.js`。
- `services/momentumScanner.js:4-8` 反向 import views 层的纯计算函数 — 「解耦」只完成物理拆分、未完成依赖治理。
- CSV 导出公式注入风险：`app.js:331-350` 名称以 `=`/`+`/`-`/`@` 开头时 Excel 当公式执行，建议加 `'` 前缀。

**后端其他**：
- dev/prod 双份代理配置靠注释人工同步（`vite.config.js:74-196` vs `server/proxyRoutes.js`），建议 dev 中间件统一走 `handleProxyRequest` 复用 proxyRoutes。
- `allowLatestTickSource=0` 查当天返回陈旧分时（`intradayService.js:222-238` 不检查新鲜度）。
- `normalizeDateKey` 接受 `2026-13-45` 等非法日期（`utils.js:23-31`），静默返回空而非 400。
- HEAD 打 `/api/cache/*` 返回 405；OPTIONS 204 带响应体（`index.js:42-72`）。
- 15:05 全市场扫描 32 并发直打 eastmoney 无限速（WAF 风险，一旦熔断全落 tencent 要 ~15 分钟）。
- `cacheStore.getOrRefresh` 对 AbortError 也回落 stale，掩盖取消语义（`cacheStore.js:139-151`）。
- 缓存维度无界增长：`prevClose` 除权即新文件、threshold 任意小数即新文件（60 天 prune 兜底但 I/O 尖峰）。
- AKTOOLS_BASE 三处硬编码（marketData/futuresQuoteService/futuresKlineService），建议 `server/config.js` 集中读 env。

---

## 五、SPEC.md 符合度（摘要）

- **全部落地且多处超越**：数据源架构（§3.1）、监控列表（§3.2，导出升级为 CSV+TXT 双格式）、K线（§3.3，8 周期）、提醒（§3.4）、涨停看板（§3.6，排序升级为 8 键×每组独立×升降向 + 置顶组）。
- **有记录的偏离**（视为合理）：播报间隔改自由输入、「手动」模式按用户反馈删除、3 主题替代深蓝黑。
- **遗留缺口**：①§4.5「触摸目标 ≥44px」部分不达标（▲▼ 调序钮 ~14px、复选框 16px、pin 按钮）；②§4.3 Roboto Mono 未加载 webfont（Windows 实际渲染 Consolas，视觉无伤）；③「配置自动持久化」剩两个缺口——涨停页排序键/组排序、监控自动刷新开关未落盘。

## 六、UX / 体验型问题（用户实际会遇到的）

1. **「挂后台听播报」主场景的最大隐患**：监控刷新是主线程 `setInterval`（`app.js:2547`），Chrome 后台标签 5 分钟后 Intensive Throttling 最低 ~1 次/分钟，3s 刷新实际变 60s；SPEC §10.3 低估了此点。Worker 同样可能被节流。
2. **刷新页面后语音静默不响**：Chrome user-activation 策略拦截恢复的定时播报，且无任何提示（`app.js:2667`）。建议显示「点击页面任意处激活语音」提示条。
3. **强势股「分时图」窗格永远空白**：`momentumChartMgr` 为 `hasIntraday: false` 但 view 仍渲染分时窗格并提示「点击右侧日K查看分时」——点了永远不会出（`momentumView.js:184-210`）。建议不渲染或补齐链路。
4. **勾选复选框 → 整页重建 → 焦点丢失 + 已展开图表全部销毁重挂**（`app.js:1653-1668`，涨停页批量勾选最明显）。
5. **网络抖动行情静默停更**：失败只写底部 13px 状态栏小字，无 toast、无 aria-live（`app.js:2462-2465`）；toast 基础设施已有，接上即可。
6. **AKTools 未启动时涨停页像「坏了」**：整页「0 只」卡片，无「请先启动 aktools（端口 8888）/今天是周末」引导（`limitUpView.js:303-346`）。
7. **flashError 语义错位**：语音间隔/阈值输错，抖动的是顶部「添加代码」输入框（`app.js:2400-2406`），用户会以为代码错了。
8. **modal 删除确认默认聚焦「确认」**，回车即删危险操作，建议 danger 弹窗默认聚焦取消。
9. **「置顶股票 0 只」空组永远显示**（`limitUpView.js:596`）。
10. 收盘后智能调度自动停用语音并落盘（`app.js:2170-2175`）——符合设计但次日易被当成「坏了」，可在语音栏加一行说明。

## 七、架构优化建议（按投入产出排序）

1. **先修 3 个 P0**（合计改动 < 50 行）+ 为 momentum 图表展开补 1 条 e2e —— 这是本次审查最紧急事项。
2. **renderTable 结构 diff**：`onStateChange → renderData → 全表重建 → destroy/mount 全部 chart` 的回调环是多数「闪烁/丢缩放/焦点丢失」类问题的共同根源（F1、UX-4 同源）。新增/删除行才动 DOM，chart 生命周期与表格渲染彻底分离。
3. **3 套同构的 render+destroy+mount 流水线收敛**：monitor / limitUp / momentum 三套 `expandedCodes + chartInstances + ChartRowManager` 配置高度重复（`monitorTableView.js:869-883` 与 `app.js:626-636` 几乎复制）。引入轻量 pub/sub（每页面域一个 store slice）即可消除，不必上框架。
4. **重复代码收敛**：`beijingDateKey`、`mapLimit`、`readHistoricalCache`、`fetchJson`、GBK 解码、`_loadTradingDates` 在 server/ 均有 2 份实现；`el()` 工厂 8 份、状态文案 4 份在前端。各下沉到 `utils.js` / `dom.js` / `format.js`。
5. **上游容错统一**：klineService 有熔断+限速+重试，marketData 仅部分重试，futures 全裸奔——抽 `withRetry(fn, {attempts, breaker})` 统一，顺带解决 B5。
6. **app.js 彻底卸载**：handler（voice/alert 的 DOM 直读）、导出/Toast、校验逻辑迁入对应 view/service；测试改为直接 import 源模块后删除向后兼容重导出块，预计再减 500-900 行。
7. **vite dev 代理与 proxyRoutes 合一**（B 后端建议 7），消灭「键顺序注释警告」这一人工同步点。

## 八、修复优先级清单（可直接当任务列表用）

| 优先级 | 项 | 预估 |
|---|---|---|
| 🔴 立即 | F-P0-1 momentum 图表 id 失配 + 补 e2e | 小 |
| 🔴 立即 | F-P0-2 涨停页 onLiveTickUpdate 接线 | 小 |
| 🔴 立即 | B-P0-1 jsonResponse headersSent/destroyed 兜底 | 小 |
| 🟠 本周 | B1 POST 扫描 Host/Origin 校验；B2 过期 job abort；F2 finally inst 比对；F1 涨停页轮询去全量重建；UX-3 假分时窗格；UX-1/2 后台节流与语音激活提示 | 中 |
| 🟡 后续 | P2 各项 + 第七节架构项 2-7 | 大（可分批） |
