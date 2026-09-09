# 2026-09-09 缺陷闭环与期货会话模型收敛交接文档

## 1. 接手背景与审查闭环结论

针对 2026-09-08 审查及后续验证中暴露的深层次缺陷，本轮完成以下核心修复与重构：
1. **K 线强刷写回本地缓存彻底闭环**：修复 `src/js/api.js` 中 `force: true` 强刷时阻止数据写回 `klineCache` 和跳过 `emitKlineUpdated` 的缺陷；
2. **提取前后端共享期货会话模型（阶段 C 核心）**：新建 `src/js/futures/session.js`，支持根据合约属性（`isFinancial`, `nightSessionEnd`）和日历规则精准判断各品种日盘/夜盘开闭市；
3. **前端调度与播报标的级精准识别**：
   - 解决前端无夜盘期货（国债 T0/TF0/TS0、股指 IF0/IH0/IC0/IM0）在 21:00 后被粗暴放行夜盘的缺陷；
   - 解决螺纹钢等 23:00 收盘品种在 23:00~02:30 期间前后端会话状态不一致缺陷；
   - 解决夜盘收盘时缺乏“已收盘”提示且股票收盘状态硬套夜盘的问题；
   - `speakSubscribed()` 增加标的级交易状态过滤，夜盘期间自动静默已收盘股票。
4. **自动化回归测试套件补齐**：新增 `tests/codeReviewRegressions.test.js`，为 R1、R4、R5、R6、R7 以及本次修复编写了完整的断言式单元测试，全量离线单测扩展至 671 项。

---

## 2. 变更文件清单

| 变更类型 | 文件路径 | 说明 |
| --- | --- | --- |
| **NEW** | `src/js/futures/session.js` | 前后端通用纯期货交易会话计算模块（支持国债/股指无夜盘、商品不同收盘时间及节前日历判定） |
| **MODIFY** | `src/js/api.js` | 修复强刷数据落地缓存与更新广播（解除 `!noCache` 写入阻断） |
| **MODIFY** | `src/js/marketSession.js` | 委托共享期货会话服务，`isFuturesMarketOpen` 支持接收标的代码列表精准判定 |
| **MODIFY** | `server/futures/futuresSessionService.js` | 服务端收敛，委托共享模块 `src/js/futures/session.js` |
| **MODIFY** | `src/js/app.js` | `isVoiceAllowedNow`、`isDataAutoRefreshAllowedNow` 和 `speakSubscribed` 接入标的级开闭市检查；完善收盘过渡提示 |
| **NEW** | `tests/codeReviewRegressions.test.js` | R1–R7 核心回归与会话模型断言式单元测试 |

---

## 3. 质量门禁验证

| 验证项 | 结果 | 耗时/指标 |
| --- | --- | --- |
| **ESLint 代码规范** | ✅ 通过 | 0 错误 0 警告 |
| **QUnit 离线单元测试** | ✅ **671 / 671 全部 PASS** | 无失败、无跳过（较上轮 665 扩充 6 个关键断言组） |
| **Vite 生产打包构建** | ✅ 成功 | 46 modules transformed，13.55s 构建成功 |

---

## 4. 后续任务建议

1. **阶段 D（涨停看板 DOM 增量更新）**：当前 R3 为全量重绘过渡方案，后续可推进按 code/group 进行 DOM 节点增量移动与人数更新，彻底消除盘中炸板/回封时的图表重挂载白屏；
2. **阶段 B / 阶段 E（架构解耦）**：继续拆解 `app.js`，抽离 `voiceController` 与 `monitorController`。
