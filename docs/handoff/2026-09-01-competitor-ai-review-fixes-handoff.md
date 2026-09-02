# 竞争对手 AI 代码审查修复 Handoff

- **日期**：2026-09-01
- **修复基线**：`4b9de69` (`main`, `origin/main`)
- **对应审查**：[`2026-09-01-competitor-ai-code-review-handoff.md`](2026-09-01-competitor-ai-code-review-handoff.md)
- **结果**：审查中列出的 P1 阻断项和主要 P2 问题已修复，最终 `npm run ci` 退出码为 0

## 1. 本轮完成内容

### 1.1 生产 API 链路

- 新增 `server/proxyRoutes.js`：集中定义腾讯、东财、AKTools、新浪和腾讯 K 线备用源的允许列表。
- 新增 `server/proxyService.js`：生产 Node 服务器可转发现有 `/api/tencent`、`/api/eastmoney*`、`/api/aktools`、`/api/sina`、`/api/qq-kline*` 路径。
- `server/index.js` 对未知 `/api/*` 返回 JSON 404，不再落入 SPA `index.html` fallback。
- 代理请求限制为固定上游和 GET/HEAD/OPTIONS，不能由客户端指定任意目标。

### 1.2 北京时间统一

- `src/js/time.js` 新增 `getBeijingClockParts()` 和 `getBeijingDate()`。
- 涨停页的“今天”、强制刷新、实时行情补全和 live tick 判断统一使用北京时间。
- 交易日历默认 anchor 改为北京时间。
- 浏览器 K 线缓存的盘中判断改为北京时间，并正确排除午休。
- 服务端 `normalizeDateKey()` 默认使用北京日期。

### 1.3 服务端缓存可靠性

- `server/cacheStore.js` 增加按缓存 key 的 single-flight：20 个并发冷缓存请求只执行一次上游刷新。
- 强制刷新增加 5 秒最短年龄保护，避免连续 `force=1` 冲击 AKTools。
- `server/utils.js` 新增统一 `fetchWithTimeout()`；AKTools、东财、腾讯 K 线和生产代理均有服务器端 deadline。
- 分钟 K 共享缓存 TTL 改为 2 分钟；日/周/月保持 1 小时。
- 浏览器分钟 K 缓存盘中 TTL 同步改为 2 分钟。
- K 线 SWR 在共享缓存模式下优先重新访问 `/api/cache/kline`，生产环境不再依赖 Vite 专用代理。

### 1.4 涨停与 10 日涨幅

- 涨停池 30 秒刷新不再顺带请求龙虎榜原因；原因继续使用独立 10 分钟缓存。
- “立即刷新”在北京时间今天会设置受保护的强制刷新。
- 全市场 spot 空数组不再写成有效成功结果；已有空缓存也会被拒绝。
- 10 日涨幅启动检查不再把 `universeSize=0` 的 complete 缓存视为有效完成。

### 1.5 页面版本显示

页面底部新增 Git 版本信息：

```text
Version: <git rev-parse --short HEAD> Updated: <git commit date>
```

位置：`index.html` + `src/style.css` + `vite.config.js`。Vite 在开发服务器启动或生产构建时读取当前 Git HEAD 和提交日期并替换占位符；页脚使用主题变量，三种主题下均保持低干扰显示。无 `.git` 的源码包可用 `APP_VERSION` / `APP_UPDATED_DATE` 显式注入。

## 2. 测试与验证

新增 `tests/server.test.js`，覆盖：

- 20 个并发冷缓存请求只访问一次刷新函数。
- 分钟/长周期 K 线 TTL。
- 服务端默认北京日期。
- 生产代理路径与 query 重写。
- 未知生产 API 返回 JSON 404。

其他回归：

- `tests/time.test.js`：宿主机仍处于前一天时，北京日期正确跨日。
- `tests/limitUpView.test.js`：默认日期预期改为北京时间。
- `e2e/navigation.spec.js`：页脚版本文字可见且内容精确。
- Playwright 单用例 timeout 调整为 60 秒，以容纳 Windows CI 冷启动时 Vite 对 `lightweight-charts` 的首次预打包；零重试复跑首个 chart 用例通过。

最终验证：

```text
npm run ci
  exit code 0
  lint: pass
  unit: 552 / 552 pass
  e2e: 49 tests pass
  build: pass
```

生产 smoke：

```json
{
  "health": 200,
  "index": 200,
  "footer": true,
  "unknownApi": 404,
  "unknownType": "application/json; charset=utf-8"
}
```

单元测试仍会输出 jsdom 未实现 `HTMLCanvasElement.getContext` 的既有噪声，但退出码为 0；真实图表行为由 Playwright 覆盖。

## 3. 关键文件

```text
server/index.js             生产 HTTP 路由
server/proxyRoutes.js       固定代理允许列表
server/proxyService.js      生产代理实现
server/cacheStore.js        文件缓存 + single-flight
server/utils.js             北京日期 + fetch timeout
server/klineService.js      周期化 TTL
server/limitUpService.js    涨停池/原因缓存解耦
server/spotService.js       空快照校验
src/js/time.js              浏览器北京时间工具
src/js/storage.js           北京盘中 + 分钟 K TTL
src/js/api.js               共享缓存 SWR
src/js/app.js               涨停日期/刷新修复
index.html                  版本页脚
tests/server.test.js        服务端回归
```

## 4. 保留的边界

- `src/js/app.js` 仍然较大；控制器拆分属于后续结构优化，不应与本轮可靠性修复混在同一个风险面中。
- 版本文字由构建时 Git 元数据自动注入；部署必须从 Git checkout 构建，或设置 `APP_VERSION` / `APP_UPDATED_DATE`。
- AKTools 仍需在服务器本机 `127.0.0.1:8888` 运行；可用 `AKTOOLS_BASE` 覆盖地址。
