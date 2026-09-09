# 测试与数据隔离

## 默认门禁

运行 `npm.cmd run ci`（Windows）或 `npm run ci`。包含 lint、QUnit、Playwright 与生产构建。

`npm test` 使用 `scripts/run-tests.mjs` 创建独立系统临时缓存目录，并通过 `MARKET_VOICE_CACHE_ROOT` 传给子进程。退出后只清理本次创建且已校验路径的目录；正常失败也会清理。直接运行 QUnit 并加载 `_jsdom-setup.cjs` 同样获得临时目录。用户的 `data/cache` 不会被单测读取或删除。

默认测试时间锚定北京时间 2026-09-09 10:00，随测试实际经过的毫秒推进，兼容 TTL/超时测试；会话边界测试另传固定 now。浏览器端边界用 Playwright clock 控制。

默认 fetch 是拒绝外网的测试适配器：未提供 fixture 的调用会记录失败断言，即使业务代码吞掉异常，也不能把测试记作通过。网络测试自己安装受控响应，并在结束前取消/等待异步工作、恢复适配器。localStorage 默认不可用，需要测试显式注入内存适配器，避免测试间持久化污染。

期货解析测试读取 `tests/fixtures/futures/` 的录制响应，通过生产 `fetchFuturesMinute`/`fetchFuturesDaily` 触发 fallback；缓存服务测试使用固定 now、行情 fixtures 和临时缓存覆盖分时均价、周/月 K 线，不在测试中复制生产正则。

## 显式联网诊断

`npm run test:integration` 独立运行，**不属于默认 CI**。需要：

- AKTools HTTP 服务可用，默认 `http://127.0.0.1:8888`，可用 `AKTOOLS_BASE` 指定。
- 新浪/AKTools 上游网络可达，且目标交易日的数据已经产生。
- 可选 `FUTURES_INTEGRATION_DATE=YYYY-MM-DD` 指定分时日期；未指定时使用当前会话日期。

该命令也使用临时缓存，不依赖用户已有市场缓存；保留真实时钟并允许联网。输出 source、stale、targetTradingDay、条数及首尾日期。无数据、网络失败和生产解析失败应分别诊断，不得通过清空用户缓存或跳过断言“修复”测试。

本轮没有执行真实联网诊断或长时间真实交易时段实播；相关交互已通过受控行情、生产控制器和真实浏览器验证。
