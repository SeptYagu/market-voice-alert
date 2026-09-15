# 语音播报「相同报价不重复播报」开关 — 交付交接

日期：2026-09-15
类型：功能交付（含 1 项接线缺陷的发现与修复）
分支：`main`（单人项目，直接提交推送）

## 1. 需求

定时语音播报原本有一条隐式规则：**现价/涨幅与上一轮"确实播完"的值相同时整条跳过**（去重）。
用户要求把这条规则做成开关，并**沿用交易时段那一排开关的样式放在同一排**：

```
交易时段:  [智能交易时段] [午休暂停/下午恢复] [收盘自动停止] [集合竞价自动开始] [相同报价不重复播报]
```

## 2. 语义

| 开关 | 行为 |
|---|---|
| 开（默认） | 保持原行为：报价没变就跳过该轮 |
| 关 | 每轮都完整播报（走全量措辞，等价于手动/测试播报） |

- 状态键：`voice.skipUnchanged`，与 `fields` 平级，**不放进 `smartSchedule`**（那边是时段语义，`decideVoiceSchedule` / `isAutoRefreshAllowedInSession` 会读它）。
- 开关**不受「智能交易时段」禁用影响**：它有独立语义，始终可操作性。其余 3 个时段子项在 `smart.enabled=false` 时依旧置灰。
- 关闭去重后不写去重基线（memory），切换开关时清一次基线。

## 3. 改动清单

| 文件 | 位置 | 内容 |
|---|---|---|
| `src/js/app.js` | `DEFAULT_VOICE_SETTINGS` | 新增 `skipUnchanged: true` |
| `src/js/app.js` | `normalizeVoiceSettings()` | 缺键时回落到默认 `true`（见 §4.1） |
| `src/js/app.js` | `handleVoiceSkipUnchangedChange(key, checked)` | 更新 state → `patchVoiceSettings` → `voiceCtrl.resetMemory()` → `renderVoiceBar()`；不重启定时器（每轮实时读 settings） |
| `src/js/app.js` | `renderVoiceBar()` handlers | 接 `onSkipUnchangedChange` |
| `src/js/controllers/voiceController.js` | `speakCodes()` | `dedupe = !manual && settings.skipUnchanged !== false`；关闭时走 `formatQuoteSpeech`（全量）而非 `formatQuoteSpeechDelta` |
| `src/js/controllers/voiceController.js` | 返回值 | 新增 `resetMemory()`；`resetFields` 改为其别名（行为不变，语义更清楚） |
| `src/js/views/voiceBarView.js` | `renderVoiceScheduleToggle()` | 末尾增加可选 `title`（**必须加在 `onChange` 之后**） |
| `src/js/views/voiceBarView.js` | `renderVoiceBar()` row3 | 追加第 5 个开关，复用同一渲染函数与 `.schedule-toggle` 样式 |

## 4. 三个必须处理的坑

### 4.1 迁移极性（静默改行为的风险）
老用户 localStorage 里没有这个键。若归一化写成 `!!src.skipUnchanged`，缺键会被算成 `false` → 所有人的去重被静默关掉、播报立刻变吵。故显式区分「缺键」与「显式 false」：

```js
skipUnchanged: src.skipUnchanged === undefined ? DEFAULT_VOICE_SETTINGS.skipUnchanged : !!src.skipUnchanged
```

### 4.2 不能用 `formatQuoteSpeechDelta(quote, null, …)` 充当"关闭去重"
`formatQuoteSpeechDelta` 要求 `changedPrice || changedPercent` 为真，否则返回空文本。若用户只勾选「名字」（现价+涨幅都关掉），传 `null` 依然不出声 —— 关了开关却没播报。故关闭去重时改用全量格式化函数 `formatQuoteSpeech`。

### 4.3 记忆基线失效
去重基线只对记录它的那种模式有意义：关掉去重后再打开，旧基线会吞掉第一轮。故切换开关时清 `memory`，且关闭去重期间不写入基线。

## 5. 交付过程中发现的接线缺陷（真实 bug，已修复）

**现象**：E2E 真实浏览器里点击新开关没有任何效果（勾选状态不变、无播报行为变化）。

**根因**：视图对回调的调用契约是 `onChange(key, checked)`（`voiceBarView.js:33`）。既有 4 个开关的 handler 都声明为 `(key, checked)`；新的 handler 我写成了 `handleVoiceSkipUnchangedChange(checked)`，于是形参 `checked` 实际收到的是字符串 `'skipUnchanged'`，`!!'skipUnchanged' === true` → 无论怎么点都被写成 `true`，表现为"点不动"。

**证据链**（真实浏览器埋点，非推断）：

| 观测 | 值 |
|---|---|
| 点击前 | `input.checked=true`, `state.voice.skipUnchanged=true`, localStorage 无 `voice_settings` |
| 事件序列 | `click(LABEL)` → `click(INPUT, checked=false)` → `change(checked=false)`（仅 1 次 change 事件） |
| 唯一的 localStorage 写入 | `{"skipUnchanged":true}`（写入栈落在 `patchVoiceSettings`）→ 与 DOM 上真实的 `false` 矛盾 ⇒ 只有 handler 参数错位能解释 |
| 对照 1：最小页面（同结构 label） | 点 label → 1 次 change、`checked=false` ⇒ 浏览器 label 转发语义正常 |
| 对照 2：既有开关「午休暂停/下午恢复」 | 点击后 `domChecked=false`、`state.pauseLunchBreak=false`、存储同步 ⇒ 既有接线正常，缺陷只在新开关 |

**修复**：handler 改为与视图契约一致的 `(key, checked)`，并加 `if (key !== 'skipUnchanged') return;` 守卫，避免同类错位再次静默改变状态。

**为什么单测没抓到**：这是**接线层**（view ↔ app handler）的形状错位，826 条单测不经过该组合；只有真实点击的 E2E 能覆盖。故本功能把"点击后状态必须翻转"作为 E2E 的必测断言。

## 6. 验证矩阵

新增断言 **5 条**（1 归一化 + 2 控制器 + 2 视图），另有 1 条 E2E。

**判别力验证（在缺陷引入前的提交 `ac09dde` 的 detached worktree 上跑新断言）**：
`git worktree add --detach "D:/AiPrograms/mva-old-verify" ac09dde` + PowerShell junction `node_modules` + 拷入新测试文件 →

```
not ok 169 app.normalizeVoiceSettings > skipUnchanged defaults to true ...
not ok 805 views.voiceBarView > the dedup switch is the 5th of the row and reports (key, checked)
not ok 806 views.voiceBarView > legacy state renders checked, an explicit off renders unchecked
not ok 816 Production voice controller > skipUnchanged off re-announces an unchanged quote every round
not ok 817 Production voice controller > skipUnchanged off still announces a name-only field selection
# pass 821 / # fail 5
```
5 条全部失败、其余 821 条全过 ⇒ 断言有判别力，且改动无连带回归。

**变异验证（防"最省事的错解"）**：把实现换成 §4.2 的错解（关闭去重时向 delta 传 `null`）后复跑：

```
not ok 816 ... message: dedup off records no baseline at all (actual 1 / expected 0)
             message: the first round after re-enabling dedup is heard (actual 0)
not ok 817 ... message: the full formatter is used, not the change-only variant (actual 0 / expected 2)
```
⇒ 用例 816/817 能拦住该错解（`816` 还额外拦住"关闭去重期间污染基线"）。

**E2E 反证**：修复前 `e2e/voice-dedupe-toggle.spec.js` 在"点击后应为未勾选"处确定性失败；修复后通过。

### E2E 用例断言清单（`e2e/voice-dedupe-toggle.spec.js`）

1. 交易时段那一排 `.schedule-toggle` 数量为 5，新开关在其中、默认勾选、**未被禁用**；
2. 去重开：启用播报后连续 6 个 tick、报价不变 → 播报数**零增长**；
3. **反空转前置**：改一次现价 → 下一轮必须播且文本含新价 ⇒ 证明定时器真实在跑（断言 2 不是"根本没 tick"）；
4. 关掉去重：同一报价连续 6 个 tick → 播报数 ≥5；
5. 关掉的状态写入 `localStorage.voice_settings.skipUnchanged === false`，刷新后仍为未勾选。

### 门禁实跑

| 门禁 | 结果 |
|---|---|
| `npm run lint` | 0 错误 0 警告 |
| `npm test`（QUnit） | **826 / 826 通过，0 失败**（基线 821，+5 新增断言） |
| `npx playwright test` | **75 / 75 通过，0 失败**（基线 74，+1） |
| `npm run build` | 成功（53 modules，`dist/assets/index-DK1OpGRI.js`） |

复现命令：
```bash
npm run lint && npm test && npx playwright test && npm run build
npx playwright test e2e/voice-dedupe-toggle.spec.js   # 单跑本功能用例
```

## 7. 上线注意事项

- 开关状态存在浏览器 `localStorage`（`voice_settings`），**逐机生效**（用户有多台机器），不涉及服务端缓存失效，无需清缓存。
- VPS 由 Git 自动更新：推送后等约 200 秒刷新页面，进入语音播报条确认第 5 个开关存在、可点、刷新后保持。
