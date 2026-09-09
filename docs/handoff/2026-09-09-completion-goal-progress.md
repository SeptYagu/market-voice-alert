# A–E 剩余工作完成目标

目标来源：[最新复审剩余项](2026-09-09-followup-review-and-remaining-stages.md)。从 `abecf9a` 开始逐阶段实施，以下只记录已经验证的里程碑。

## C 会话决策与 E 语音控制器

- 已新增纯 `voiceSchedule` 决策及 `voiceController`；播报记忆、Worker/降级定时器、调度检查器由控制器私有持有。clock/speech/storage/timers 通过依赖注入。
- 股票午休只暂停，股票单独订阅保持收盘自动关闭；含期货订阅保持用户开启偏好，日盘至夜盘自动恢复。凌晨最后合约收盘只提醒一次。当天手动关闭持久化 `manualDisabledDate`，不会在当前集合竞价内被自动开启覆盖；下一交易日显式配置的集合竞价自动开启仍有效。
- 手动测试播报及自动播报共用增量记忆；字段重新启用清空记忆；取消订阅清理记忆。停止后迟到的日历预热不会重启定时器。
- 图表初始交易日、实时分时更新传入实际合约与交易日历。旧布尔 `isLiveTradeDate` 参数保留兼容，但生产调用方使用代码。
- 验证：完整 CI（lint、694 单测、57 E2E、build）通过；之后新增实际合约/日历断言，voiceController 定向 6/6 通过。

## 待完成

- B：共享 requestScope 迁移及服务端串行提交归属。
- D：按 code/group 增量移动节点与图表保留、批量销毁。
- E：monitorController 提取。
- T1 与剩余验收：生产 parser/service fixtures、独立缓存、意外网络门禁、完整竞态/UI 回归。
