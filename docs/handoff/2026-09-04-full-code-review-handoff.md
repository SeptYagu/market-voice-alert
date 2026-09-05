# 2026-09-04 全量代码审查交接文档（需求符合度 / 缺陷 / UX / 架构与模块化）

> **审查日期**：2026-09-04
> **审查基线**：`main` @ `89bfe3e`（v2.1 数据源修复后）
> **审查范围**：`server/` 全部、`src/js/` 全部、`index.html`、`tests/`（覆盖面评估）、`vite.config.js`
> **验证方式**：三路并行深度审查 + 对 P0/P1 与安全项逐一源码复验（本文件中标注「已复现」的条目均经过实际代码执行/读码确认）
> **前序文档**：[`2026-09-04-aktools-data-source-architecture-and-stability-handoff.md`](./2026-09-04-aktools-data-source-architecture-and-stability-handoff.md)

---

## 1. 结论速览

| 维度 | 评价 |
|---|---|
| **需求符合度** | **高**。SPEC 15 项核心需求 12 项完全符合、3 项形态偏差（见 §2），0 项缺失。 |
| **正确性** | 存在 **1 个 P0（可致进程崩溃）+ 6 个 P1（含 2 个用户可感知的功能失效）**，P2 约 15 项。详见 §3/§4。 |
| **安全** | 1 个 P1 SSRF（已复现）+ 2 个 P2 低危；路径遍历/静态文件/缓存 key 注入经查均已正确防护。 |
| **UI/UX** | 整体友好（中文提示、加载/空态/禁用态完整），但有 3 个高价值体验缺口（首帧闪白、单删无确认、错误直出英文）。 |
| **模块化** | **核心问题**：`app.js` 3583 行承担 10+ 职责，且已出现状态交叉写入与逻辑漂移；server 侧有 6 组复制粘贴逻辑。给出具体拆分方案（§6）。 |
| **测试** | 633 单测 + Playwright E2E，纯函数层覆盖好；但本次发现的 P1 功能失效均发生在「测试盲区」（chart 实例 API 契约、force 刷新参数）。 |

---

## 2. 需求符合度对照（对照 SPEC.md）

| # | 需求 | 结论 | 依据 |
|---|------|:---:|------|
| 1 | 添加标的自动识别股票/期货 | ✅ | `app.js:252-274` 先 `normalizeFuture` 再 `normalizeCode`；`parser.js:5-19` 按 6 位数字首位补 sh/sz/bj |
| 2 | 涨红跌绿平灰（三主题） | ✅ | `style.css:8-44` 三主题 CSS 变量；`limitUpView.js:119` |
| 3 | 导出选中为 txt（每行纯代码） | ⚠️ | 实际导出 **CSV**（`app.js:1950`）；SPEC 要求的 `buildExportText`（`app.js:278`）已实现但**只有测试引用，UI 无入口**。二选一：接线或改 SPEC |
| 4 | 语音播报（定时循环+价格触发） | ✅ | `app.js:2896-2903`、`2885-2887` |
| 5 | 播报间隔 5/10/30/60s/手动 | ⚠️ | 实现为任意秒数输入框（`app.js:633-661`），功能是 SPEC 超集但形态不同 |
| 6 | 音量 0-100 | ✅ | `app.js:670-672` + `clampVolume` |
| 7 | 价格提醒（阈值+桌面通知） | ✅ | `alert.js:33-42`，`pct >= thr` 含等于阈值，符合"达到"语义 |
| 8-13 | 涨停看板 4 分组/8 排序/空响应锁定快照/批量加入/行内 K 线/刷新频率 | ✅ | `limitUp.js:5-157`、`app.js:2129-2140`（文案逐字匹配 SPEC） |
| 14 | 主题三态持久化 | ⚠️ | 功能完整，但**首帧防闪烁失效**（见 §3 P1-6） |
| 15 | 移动端响应式 | ✅ | `style.css:896/908/1123`；SPEC 的 44px 触摸目标未显式保证（按钮 padding 偏小）⚠️ |

---

## 3. P0 / P1 缺陷（P0 及全部 P1 均已逐条源码复验）

### P0-1 后台扫描 unhandled rejection 可直接击溃进程【已复现】
- `server/index.js:57-58` 判断 `job.promise`，但 `startTenDayMomentumScan`（`momentumService.js:475`）**返回的就是裸 Promise**（`return JOBS.get(jobKey).promise`），`job.promise` 恒为 `undefined` → 防御性 `.catch` 永不挂载；
- `momentumService.js:452-470` 的 catch 处理器内部若 `readCache/writeMomentumProgress` 再抛错（磁盘故障），Promise 变 rejected 且无人处理 → Node 20+ 默认 crash。
- **修法**：index.js 改为 `if (job && typeof job.catch === 'function') job.catch(...)`；catch 处理器内部再套 try/catch。

### P1-1 "🔄 重新加载"按钮从未真正联网（参数契约断裂）
- `chartRowController.js:329-347` 向 `fetchKline` 传 `forceRefresh: force` 和 `onData` 回调，但 `api.js:428-470` 的 `fetchKline` 只认 `noCache/sharedCache/signal`——`forceRefresh` 被静默丢弃，reload 实际仍命中 `klineCache`（`api.js:442-447`），从不联网；`onData`（334-346）是永不执行的死回调。
- **修法**：`loadKline` 内改传 `noCache: force`，删除 `onData`。

### P1-2 点击日 K 柱子看对应日期分时的功能整体失效
- `chartRowController.js:234-238` 订阅 `ctl.subscribeBarClick`，但 `chart.js:389-405` 返回的 chart 对象只暴露 `onClick`，**没有 `subscribeBarClick`** → `typeof === 'function'` 恒 false，`handleKlineBarClick`（438-449）全链死路径。用户只能看默认日期分时。
- **修法**：chart.js 暴露 `subscribeBarClick(fn)`（内部包一次 onClick 注册/注销），或删掉 controller 侧订阅。

### P1-3 universe 种子兜底完全失效【已复现】
- `spotService.js:11` 数组字面量**立即求值** `cachePath('..', 'universe.json')`，实测直接抛 `Cache path escaped cache root` → 整个表达式抛异常，连合法的 `cachePath('universe.json')` 分支也永远执行不到。AKTools 挂掉时腾讯兜底退化为"仅 kline 缓存目录"。
- **修法**：`'..'` 那项包进 try/catch 单独求值，或直接删掉（`data/universe.json` 应约定放在 cache 目录内）。

### P1-4 momentum 扫描任务竞态：旧任务 finally 删除新任务注册项
- `momentumService.js:426-429` 清理超 10 分钟旧 job 后另起新 job；但旧 job 的 `.finally`（:471-473）无条件 `JOBS.delete(jobKey)`，会把**新 job** 删掉 → GET 轮询误判、可重复 POST 起第三个并发扫描、进度文件互相覆写。
- **修法**：finally 内校验 `JOBS.get(jobKey)?.promise === job` 再删。

### P1-5 启动扫描缓存 key 与实际写入 key 不一致 → 每次重启必全量扫描
- `momentumService.js:481` 读 `['momentum','ten-day',`${dateKey}-t${threshold}.json`]`，而真实写入 key 是 `['momentum', dateKey, 'ten-day-45pct.json']`（:136-139）→ 重启永远读不到已有结果，每次重启触发一次数千请求的全量扫描。
- **修法**：统一走 `cacheParts()`。

### P1-6 主题首帧防闪烁失效（一行修复）
- `index.html:10` 读 `localStorage.getItem('theme')`，而 `storage.js:5` 存的是 `'app_theme'` → 深色用户**每次刷新闪白**。
- **修法**：key 改 `'app_theme'`。

### P1-7 切到涨停页时 momentum 图表不销毁（内存泄漏）
- 路由 handler（`app.js:3520-3522`）只清理监控页 chart，不处理 `state.momentum.chartInstances`；ResizeObserver（`chart.js:196-201`）仍 observe 已脱离 DOM 的容器，直到切回 `#/` 才释放。盯盘工具长时间挂机的典型泄漏场景。
- **修法**：路由切换抽 `teardownCurrentPage()`，对 momentumChartMgr 逐码 destroy。

### P1-8 stopApp 漏清语音 fallback 定时器
- `app.js:3554-3583` 清理了不存在的 `state.voiceTimer`（见 §5 死代码），但没调 `stopVoiceTimer()`——`state.tickFallback`（`app.js:2914/2919` 的 setInterval）泄漏。
- **修法**：stopApp 直接调 `stopVoiceTimer()`（`2923-2937` 已同时处理 worker+fallback）。

---

## 4. P2 缺陷清单（摘要）

| # | 位置 | 问题 |
|---|---|---|
| 1 | `cacheStore.js:45` | `readCache` 无第二参数，`momentumService.js:377,453,456,483`、`klineService.js:215` 传的 `skipTouch` 全部被忽略；`lastAccessedAt` 读取时从不更新 → "30 天未访问才删"实为"30 天前生成即删"，热点缓存也会被 prune |
| 2 | `cacheStore.js:107-127` | force=1 撞上在飞普通请求会复用其结果，force 语义被绕过（涨停页手动刷新可能拿到旧数据） |
| 3 | `futuresQuoteService.js:54` 等 6 处 | 期货模块硬编码 `http://127.0.0.1:8888`，无视 `AKTOOLS_BASE` env（marketData.js:14 读它）→ 改端口时期货链路静默失效 |
| 4 | `futuresKlineService.js:498-510` | VWAP 二次补算：有效 bar 不累加 volume/amount → 后续无效 bar 的累计均价分母偏小、系统性偏高；且与 :447-467 重复实现 |
| 5 | `futuresQuoteService.js:189` | quote 部分失败 `catch(()=>null)` 静默吞掉，前端无法区分"跌为 0"与"拉取失败" |
| 6 | `index.js:201-203` | 期货 K 线上游错误统一映射 400 并泄漏上游报文，应为 502/504 |
| 7 | `proxyService.js:23,39` | `req.on('aborted')` 已废弃（应改 `close`）；`await upstream.arrayBuffer()` 整包缓冲大响应有内存尖峰 |
| 8 | `vite.config.js:40` + `index.js:335` | dev 与 prod 同时运行时两份 momentum 定时调度写同一批缓存文件 |
| 9 | `momentumService.js:447` | partial 落 success 缓存要求 `scanned >= 100`，universe 不足 100 时（种子失败）零失败也不留快照 |
| 10 | `app.js:1319-1322` | momentum 轮询 setTimeout 无句柄，stop 与重开有低概率并发竞态 |
| 11 | `app.js:2335-2338` | 涨停页 loading 双重渲染（同交互 3 次全量 rerender，中间一轮纯浪费） |
| 12 | `app.js:1336/1371` | `state.quotes` 只增不减（momentum/limitUp 来源永不清理），长跑内存缓涨 |
| 13 | `app.js:2528-2543` | 手工版周期切换漏 `intradayAbort.abort()`（mgr 版有），旧分时请求不被取消 |
| 14 | `time.js:30` | `hour12:false` 部分引擎午夜返回 hour=24 → 00:00-00:59 期货夜盘误判不开盘；应改 `hourCycle:'h23'` |
| 15 | `marketSession.js:74-77` | 期货次日凌晨段只看星期几不查交易日历，周五为节假日时周六凌晨仍判开盘 |
| 16 | `storage.js:41-46` | quota 写失败返回 false 但 `setWatchList/patchSettings` 全部忽略 → 配置静默丢失无提示（klineCache 反而有降级重试） |
| 17 | `alert.js` | 阈值改小时旧 direction 保留，改小后首次越界可能不触发（边角） |

---

## 5. 安全审查

| 级别 | 发现 | 位置 |
|---|---|---|
| **P1（已复现）** | **代理路由 protocol-relative SSRF**：`resolveProxyTarget` 把 `pathname.slice(prefix.length)` 直接拼进 `new URL(path, target)`。对 `upstreamPrefix:''` 的路由（tencent/sina/aktools/qq-kline），请求 `/api/tencent//evil.com/x` → `new URL('//evil.com/x', 'https://qt.gtimg.cn')` = `https://evil.com/x`（已用 node 实测）。配合 `index.js` 默认绑定 `0.0.0.0`，局域网内可借本机为跳板 | `server/proxyRoutes.js:26-29` |
| P2 | POST /api/cache/momentum/ten-day 无鉴权重负载 + `access-control-allow-origin:*`，任意网页可驱动本机全市场扫描 | `index.js:48-69`、`utils.js:82` |
| ✅ | 静态文件 `safeStaticPath`、缓存路径 `resolveCachePath` 双保险、期货合约白名单——**均正确**，无路径注入 | `index.js:256-268` 等 |

**修法**：proxyRoutes 中 `upstreamPath = route.upstreamPrefix + '/' + suffix.replace(/^\/+/, '')`（一行守卫）；server 默认 host 改 `127.0.0.1`。

---

## 6. 屎山评估与拆分方案（app.js 3583 行）

### 现状职责清单
| 行号 | 职责 |
|---|---|
| 317-395 | **三域合一的全局可变 state**（monitor + limitUp + momentum） |
| 491-1113 | 监控页 + 语音条 + 提醒条渲染（handler 大量内联） |
| 1119-1453 | Momentum 扫描全部逻辑 + 渲染 |
| 1455-1804 | 监控表格渲染 |
| 1958-2566 | 涨停页全部 controller |
| 2569-3013 | 语音播报 + 提醒 + 定时器 + 交易时段调度 |
| 3217-3462 | 数据刷新 + 单元格 patch + 自动刷新调度 |
| 3464-3583 | SWR 订阅 + startApp/stopApp |

### 最危险的三处隐式耦合
1. `app.js:394` `limitUpRootEl` 模块级可变量，被 8 处函数隐式读取当"路由状态"——**用 DOM 引用当路由状态是最大耦合源**；
2. `state.quotes` 被 3 个域交叉写入（refreshNow :3232、momentum :1336/:1371、toggleSubscribe :2580），单向数据流已破坏；
3. `state.tradingDates` 与 `state.limitUp.tradingDates` 双写，4 处 `a || b` 兜底（:402/443/2826/2831…）。

### 建议拆分（依赖方向：视图 → controller → 纯函数，禁止反向）
| 新模块 | 迁移范围 | 说明 |
|---|---|---|
| `state.js` | :317-395 | 三域拆成三个独立 state 或至少分域命名空间 |
| `momentumController.js` | :919-1453 | 依赖只指向 api/limitUp/state |
| `limitUpController.js` | :1958-2566 | 纯逻辑 `applyLimitUpFetchResult`(2119) 下沉 limitUp.js |
| `voiceController.js` + `alertController.js` | :2577-3013 | 含 worker/smart schedule |
| `refreshScheduler.js` | :3217-3462 | 含 updateRowQuoteCells/patch 系列 |
| `dom.js` | el() + toast/flash | :466、:3167-3215 |

### 其余重复/死代码（"label 式"遗留清算）
- `app.js:1755-1779 intradayStatusParts` ≈ `chartRowController.js formatIntradayStatus`（文案已漂移："错误:" vs "分时错误:"）——删 app.js 版；
- `app.js:2491-2511 closeLimitUpChart` ≈ `chartRowController.destroyCharts`，可一行替换；
- `app.js:2825-2833` `getVoiceSession` 与 `getDataRefreshSession` 逐字符相同；
- 死代码：`state.voiceTimer` 清理分支（:3561，字段从未赋值）、app.js:89-99 re-export 层、`_getChartInstance`/`_forceRefresh` 测试 helper、`buildExportText`（仅测试用）、chartRowController 的 `onData`/`onKlineBarClick` 死链（见 P1-1/P1-2）。

### server 侧复制粘贴清单（应抽公共层）
`mapLimit`（momentumService:121 vs marketData:72，一个带让步一个不带）、`beijingDateKey`（momentumService:146 vs utils:9）、`readHistoricalCache`（intradayService:108 vs limitUpService:13 逐字相同）、`isHistoricalDate`、两份行为不同的 `fetchJson`。**最大例外**：futures/ 三 service 完全绕过共享基建——6 处裸 `fetch`+`AbortSignal.timeout`，不复用 `fetchWithTimeout`，外部 signal 无法取消这些上游请求。

---

## 7. UX 与交互审查

**做得好的**：中文 toast + 状态栏 + 输入框抖动三通道反馈；加载/空态齐全；禁用态逻辑正确（批量添加、语音不支持、"后一天"越界）；alert 阈值含等于、同向去重、回落重置设计正确；storage 的 JSON 解析有类型守卫兜底。

**三个高价值缺口**：
1. **首帧闪白**（P1-6，一行修复）；
2. **单个删除标的无确认且不可撤销**（`app.js:1896-1905`）——批量删除反而有 confirm；这是盯盘最高频操作之一，建议加一次 confirm 或 5 秒撤销 toast；
3. **网络错误直出英文**：AKTools 挂掉时用户看到 `HTTP 502`/`Failed to fetch`（`app.js:2219` 直接 `e.message`），应映射为"本地行情服务(AKTools)未启动，请运行 aktools startup.bat"类可操作文案。

---

## 8. 优化建议（按投入产出比排序）

| 优先级 | 事项 |
|---|---|
| 立即（≤1h） | P1-6 主题 key（1 行）；P1-3 universe 路径（3 行）；SSRF 守卫（1 行）+ host 改 127.0.0.1；P1-8 stopApp 调 stopVoiceTimer；P1-5 缓存 key 统一 |
| 短期 | P1-1 force 刷新接线；P1-2 subscribeBarClick 暴露；P0-1 job.catch 修正；单删确认；错误文案中文映射 |
| 中期 | 路由 teardown 统一（P1-7）；app.js 按 §6 拆分（先拆 state + momentum）；futures 接入 fetchWithTimeout + AKTOOLS_BASE；`skipTouch` 实现 touch 或删除 |
| 低 | 新浪期货批量报价（N 请求 → ceil(N/20)）；momentum 进度写盘防抖；`el()` 与路由表化 handleCacheRequest；导出 txt 接线或移除 |

---

## 9. 验收标准（修复本报告 P0/P1 后）

1. `kill -USR1` 模拟：momentum 扫描 catch 内抛错不再导致进程退出；
2. 监控页/涨停页点"🔄 重新加载"后，Network 面板可见真实上游请求（而非缓存命中）；
3. 点日 K 柱可切换对应日期分时（subscribeBarClick 生效）；
4. 深色主题刷新无白闪；
5. AKTools 停止时，涨停看板错误提示为中文可操作文案；universe.json 存在时腾讯兜底覆盖种子标的；
6. `npm run ci` 全绿（lint + test + e2e + build）。
