# 2026-09-08 缺陷修复交接：R1–R7 + T1/T2 全部闭环

## 1. 接手结论

- 上游：[`2026-09-08-code-review-bugs-and-refactor-handoff.md`](2026-09-08-code-review-bugs-and-refactor-handoff.md)（基线 `ef695b7`）。
- 本轮按其"阶段 A"完成 **R1–R7 全部 7 项功能缺陷 + T1/T2 两项工程验证问题**，每组独立提交，已全部推送 `main`。
- 未做阶段 B/C/D/E 的结构性重构（requestScope 抽取、共享会话模块、涨停视图按标的更新、app.js 拆分）；R3/R6 采用的是 handoff 中的"短期修复/守卫"方案，重构项见文末"剩余工作"。

## 2. 修复明细（按提交顺序）

| 提交 | 项 | 内容 |
| --- | --- | --- |
| `3acb31b` | R1 | `app.js` `voiceLastSpoken` 改为 `{...旧记录, ...spoken}` 合并，修复单字段变化后另一字段被误判从未播报、交替重播 |
| `3acb31b` | R4 | `loadLimitUpKline` 透传 options，重新加载按钮传 `{ force: true }`；`api.js` 强制请求不再复用普通 in-flight promise，finally 仅清理自己的条目 |
| `1e2d90f` | R3 | `patchLimitUpQuoteCells` 逐组比较 `data-group` 键与每组有序 code 序列（并核对总行数），任何归属/顺序不一致返回 false 走全量重绘。**过渡方案**：会重新挂载图表 |
| `b017a57` | R5 | 动量扫描引入 `momentumScanGeneration`；stop 先失效 generation 再 abort；所有 await 后状态提交、worker 进度、轮询回调、catch/finally 均以 `isCurrent()` 守卫 |
| `b017a57` | R6 | 图表 kline/分时加载捕获本次 inst、AbortController、period/date，提交前校验"仍展开 + 实例未替换 + 请求未替换 + 参数仍匹配"；旧响应不再经当前 ctl Map 写入新图表，AbortError 不误清新请求 loading |
| `445d5c4` | R2 | `applyVoiceSchedule` 改用与播报入口相同的 `isVoiceAllowedNow()`；订阅期货夜盘仍在交易时不再被股票 after-close 全局停用/自动关闭 |
| `445d5c4` | R7 | 服务端 `getFuturesSession`：当晚分支按 `nightSessionEnd` 收盘（RB0 23:00 后不再 isTrading）；当晚校验次日为相邻交易日（节前最后一夜不开夜盘）；凌晨续段校验前一自然日为交易日且其夜盘归属目标交易日 |
| `782185a` | T1 | 5 个依赖真实行情/日期/缓存的期货用例移至 `tests/integration/futuresServices.integration.js`，经新增 `npm run test:integration` 显式运行；默认 `npm test` 只含离线单测 |
| `782185a` | T2 | `playwright.config.js` webServer 弃用 shell 包装 npm，改为 `node node_modules/vite/bin/vite.js --host 127.0.0.1` + env `DISABLE_BACKGROUND_JOBS=1` |

## 3. 验证结果

| 检查 | 结果 |
| --- | --- |
| git pull / push | 每组独立提交并推送，`main` 至 `782185a` |
| lint（全量） | ✅ 0 错误 0 警告 |
| QUnit 全量（离线 `npm test`） | ✅ **665/665**（修复后回归，无失败；670→665 为 5 个联网用例移出） |
| E2E（新 webServer 配置原命令） | ✅ **57/57，约 1.1 分钟** |
| `npm run build` | ✅ Vite 5.4.21 构建成功 |
| `npm run ci` | 各阶段均单独通过（lint → test → e2e → build） |

## 4. 验收清单对照

- [x] R1–R7 均按 handoff 最小/短期方案修复；本轮未补写"修复前失败"的正式回归测试用例（复现脚本 `2026-09-08-review-repro.mjs` 可验证旧行为），**建议后续把场景转成断言正确结果的正式测试**。
- [x] 单测不依赖真实行情、当前日期、用户 cache；真实数据测试独立命令 `npm run test:integration`。
- [x] 原始 E2E 命令可独立启动服务，无需调整操作系统执行策略。
- [x] lint、全量单测、57 项 E2E、build 通过。
- [ ] 手工检查混合订阅夜盘语音、炸板/回封分组、展开图表跨组移动、重新加载（待真实交易时段观察）。

## 5. 剩余工作（对应上游 handoff 阶段 B–E，未开始）

1. **阶段 B**：抽取 `src/js/services/requestScope.js` 统一异步任务归属；动量/图表/涨停逐步切换。
2. **阶段 C**：抽取共享纯会话模块（前端 `src/js/futures/session.js` + 服务端薄适配层），voice schedule 纯决策函数；R2 目前只是统一入口判定，"一个期货开市放行所有股票"的播报粒度问题仍在（夜盘期间股票字段变动也会被播报）。
3. **阶段 D**：涨停视图按 code/group 索引做增量结构更新，消除 R3 过渡方案的全量重绘（图表重新挂载）。
4. **阶段 E**：app.js 拆出 voiceController / monitorController。
5. 补写 R1/R3/R5/R6/R7 的断言式回归测试；服务端 `momentumService.js` 后台任务竞态核验。

## 6. 新窗口接手指引

1. `git pull`；读本文件与上游 handoff 第 6 节。
2. 剩余工作从阶段 B 或补测试开始均可；R3 重构（阶段 D）收益最大但改动面最广，建议在补齐 R3 回归测试后再做。
3. 运行门禁：`npm run lint && npm run test && npm run e2e && npm run build`；联网验证另跑 `npm run test:integration`。
