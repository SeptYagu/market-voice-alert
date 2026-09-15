# 停播提示后补播「最后一轮」— 交付交接

日期：2026-09-15
类型：功能交付（语音播报）
分支：`main`（单人项目，直接提交推送）

## 1. 需求

播报每条**停播/休市提示**之后，紧跟一轮「用户选中字段」的最终快照。

用户要求的效果（原话）：订阅贵州茅台、只勾选「价格」字段时 ——
> 已收盘，1272.75元。

即：**提示 + 只含选中字段的快照**（没勾「名字」就不出现名字）。

拍板结论：

| 项 | 结论 |
|---|---|
| 快照内容 | 只播**用户选中的字段**（不是"只播变化过的字段"；不强行带上名字） |
| 触发范围 | **全部停播提示**：`已收盘`、`中午休市`、`休市`（期货日夜空档） |
| 期货一天两次收盘（日盘 + 夜盘）各补播一次 | 接受 |
| 是否加开关 | **不加**，直接生效 |

## 2. 实现

| 文件 | 改动 |
|---|---|
| `src/js/services/voiceSchedule.js` | `decideVoiceSchedule` 返回值新增 `finalCodes`：`transitionNotice` 存在时 = `previous.eligibleCodes.filter(c => list.includes(c))`，否则 `[]` |
| `src/js/controllers/voiceController.js` | `speakCodes(codes, { manual, full })` 新增 `full` 选项（无视 `skipUnchanged`、不写去重记忆）；`applySchedule` 播完提示后立刻 `speakCodes(d.finalCodes, { full: true })` |

快照文本走既有 `formatQuoteSpeech(quote, fields, fieldsOrder)`：只拼**启用字段**、按用户排序 —— 只勾价格时结果就是 `1272.75 元`，与需求示例一致。

### 为什么不放在控制器里读 `previous`

`previous` 是控制器内部变量，且在同一函数结尾**紧接着就被 `previous = d` 覆盖**，依赖它读取顺序极脆弱；
放进纯函数后可直接单测（顺带补上了 `decideVoiceSchedule` 一直没有专门测试文件的空缺）。

### 顺序与生命周期（已逐条核对）

- `speech.cancel()` 发生在播提示**之前**（`voiceController.js:87-90`），所以提示与其后的快照都不会被清掉。
- 30s 检查器下一拍 `previous.timerShouldRun` 已为 false → `transitionNotice` 为 null → 不会重复补播。
- 快照 `spoken: null` → 不写去重基线；`applySchedule` 停表时不清 memory（只有 `startTimer` 清），下次启动自然重置。

## 3. 关键约束（都有实测证据）

用真实函数探针（`decideVoiceSchedule` 直接 import，逐拍喂 `previous`）拿到的事实：

| 场景 | 时刻 | notice | 本拍 eligibleCodes | 上一拍集合 |
|---|---|---|---|---|
| 纯股票收盘 | 15:00:30 | **已收盘** | `[]` | `['sh600519']` |
| 螺纹日盘收 | 15:00:30 | **已收盘** | `[]` | `['rb0']` |
| 螺纹夜盘收 | 23:00:30 | **已收盘** | `[]` | `['rb0']` |
| 沪金凌晨收 | 02:31:00 | **已收盘** | `[]` | `['au0']` |
| 股票午休 | 11:30:30 | **中午休市** | `[]` | 全部在播标的 |
| 螺纹日夜空档 | 20:00:00 | *(无提示)* | `[]` | `[]` |

1. **发提示那一拍 `eligibleCodes` 必为空**（正因为"没得播"才提示）→ 快照集合**只能**取自上一拍。
   谁顺手用 `d.eligibleCodes` 去播，就是播一场空（且有测试钉住）。
2. **必须按当前订阅过滤**：实测 14:59:30 两只股票都可播、15:00:30 只剩一只时，提示照发 —— 不过滤就会把已退订的那只也播出来。
3. **上一拍可播标的被全部退订 → 连提示都不发**（既有行为，未改动）：
   实测夜盘只有 rb0 可播、退订 rb0 后 `notice === null`。
   ⚠️ 交付前的口头汇报里我把这个场景误判成"提示照发"，实际相反；已在测试与交接中更正。
4. 期货日盘 15:00 收盘发的是 **「已收盘」而不是「休市」**；20:00 日夜空档根本不发提示
   —— `pauseReason === 'break'` 的「休市」分支在常规序列里几乎不触发，但代码上同样带快照（需求要求覆盖）。

## 4. 验证

### 新增 / 更新断言

| 文件 | 内容 |
|---|---|
| `tests/voiceSchedule.test.js`（新） | 补播集合取自上一拍、三类提示都有、普通拍为空、按订阅过滤、全退订不发提示、关掉自动停播/午休后无提示无补播、提示只发一次不重复补播 |
| `tests/voiceController.test.js` | 更新 2 条既有用例（午休/收盘/日夜衔接的出声序列现在含快照）；新增：只勾价格时快照为 `['已收盘', '11.25 元']`、快照不动去重记忆、无报价的标的被跳过 |

### 判别力（在改动前的 `141ddef` detached worktree 上跑新断言）

```
not ok 809 stock lunch resumes, stock close disables, same-day manual off overrides auction
not ok 810 mixed futures pause across day/night gaps and announce midnight close once
not ok 811 the closing snapshot repeats an unchanged quote in the selected fields only
not ok 822..829 services.voiceSchedule: 停播提示后的最后一轮（8 条）
# pass 826 / # fail 11
```
11 条全部失败、其余 826 条通过 ⇒ 有判别力且无连带回归。

**注**：其中 `the closing snapshot leaves the dedup memory untouched` 与 `skips codes without a quote` 两条**在旧代码上同样通过**——它们本质是"守卫"（断言快照不做某件事/不因缺报价而抛错），不是新行为的判别器；真正的判别器是 `repeats an unchanged quote in the selected fields only`。

### E2E 变异验证

`e2e/voice-session.spec.js` 新增断言：23:00 螺纹收盘那一拍 `reviewSpoken.slice(-2) === ['已收盘', 'Rebar sentinel…']`。
该场景整段夜盘报价未变（一直静默），所以这一条同时证明"确实补播"与"确实绕过去重"。
**把 `applySchedule` 里的补播调用临时掐掉（`if (false && …)`）后该用例确定性失败，恢复后通过** ⇒ 断言确实依赖新代码。

### 门禁实跑

| 门禁 | 结果 |
|---|---|
| `npm run lint` | 0 错误 0 警告 |
| `npm test` | **837 / 837 通过**（上一版 826，+11） |
| `npx playwright test` | **75 / 75 通过** |
| `npm run build` | 成功（`dist/assets/index-CgI_22eJ.js`） |

命令：`npm run lint && npm test && npx playwright test && npm run build`
（若 `test-results/` 遗留文件较多，沙箱的批量删除守卫会拦下 Playwright 的清理动作，加 `--output=artifacts/pw-results` 即可。）

## 5. 上线注意事项

- VPS 由 Git 自动更新：推送后等约 200 秒刷新页面验收（本次不涉及服务端缓存）。
- 验收方式：交易时段内把「播报内容」只勾选「价格」，等收盘（或临时把系统时间调到 15:00 之后触发调度）听一次；
  或直接观察控制台：提示语音之后应紧跟一条只含价格的播报。
