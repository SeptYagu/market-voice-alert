# A–E 剩余工作完成目标

目标来源：[最新复审剩余项](2026-09-09-followup-review-and-remaining-stages.md)。从 `abecf9a` 开始逐阶段实施，以下只记录已经验证的里程碑。

## C 会话决策与 E 语音控制器

- 已新增纯 `voiceSchedule` 决策及 `voiceController`；播报记忆、Worker/降级定时器、调度检查器由控制器私有持有。clock/speech/storage/timers 通过依赖注入。
- 股票午休只暂停，股票单独订阅保持收盘自动关闭；含期货订阅保持用户开启偏好，日盘至夜盘自动恢复。凌晨最后合约收盘只提醒一次。当天手动关闭持久化 `manualDisabledDate`，不会在当前集合竞价内被自动开启覆盖；下一交易日显式配置的集合竞价自动开启仍有效。
- 手动测试播报及自动播报共用增量记忆；字段重新启用清空记忆；取消订阅清理记忆。停止后迟到的日历预热不会重启定时器。
- 图表初始交易日、实时分时更新传入实际合约与交易日历。旧布尔 `isLiveTradeDate` 参数保留兼容，但生产调用方使用代码。
- 验证：完整 CI（lint、694 单测、57 E2E、build）通过；之后新增实际合约/日历断言，voiceController 定向 6/6 通过。

## 待完成

- E：monitorController 提取。
- T1 与剩余验收：生产 parser/service fixtures、独立缓存、意外网络门禁、完整竞态/UI 回归。

## B 请求归属

- `requestScope` 的 begin/isCurrent/cancel 已接入图表 K 线/分时独立请求、动量扫描/轮询、涨停列表；涨停保留日期与 requestSeq 隔离，stop 使附属 enrichment 失效。
- 图表 destroyAll 同时清理尚未挂载和仅分时实例；AbortSignal 已取消时也不能提交。
- 服务端 `jobRegistry` 使用独立 jobId、替换前失效与按任务键串行提交。初始进度、批量进度、最终结果、success 缓存和错误结果均通过 commit 检查；已经进入写盘的旧写入先完成，新任务写入随后执行。
- 固定时钟模拟十分钟替换，覆盖旧成功/进度/失败/清理与写盘中替换；真实图表覆盖周期/日期切换和销毁后迟到响应。完整 CI：702 单测、57 E2E、lint/build 通过。

## D 涨停增量视图

- 视图维护 code→row/chartRow、group→section 索引；共享 view groups 处理置顶和普通分组。报价修改单元格，结构变化移动现有节点，新增/删除才创建/移除。
- 控制器不再在重新渲染时销毁全部图表；删除标的清理 selection/expanded/instances，批量关闭一次销毁循环后一次更新视图。
- 真实控制器单测覆盖组内反转、炸板/回封/连板分桶、置顶、删除及关闭；真实浏览器验证跨组移动保留 DOM 和图表实例、重新加载发起实际绕缓存请求。
- 验证：703 单测、lint/build 通过；既有 57 E2E 通过。新增 E2E 首次因测试代码使用不存在的 fixture 代码失败，改为实际 fixture 后定向 1/1 通过；最终阶段将再次运行全部 58 项。
