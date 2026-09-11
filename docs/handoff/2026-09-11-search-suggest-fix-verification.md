# 核实报告：`3e4486e` 对「添加栏智能联想」审查缺陷的修复

- **核实日期**：2026-09-11
- **被核实的修复提交**：`3e4486e` fix(search-suggest): 修复审查报告中的 B1-B3 缺陷、遗漏需求与优化项
- **审查基线（broken 模式基线）**：`b9e57e5` —— 上一轮 review 的审查对象，且**尚未包含任何修复**；用它跑 `--expect=broken` 才能逐条判定断言是否真的有判别力
- **对照文档**：[`2026-09-11-search-suggest-code-review-handoff.md`](2026-09-11-search-suggest-code-review-handoff.md)（缺陷清单 B1–B3 / C4–C6 / D1–D6）、[`requirements-stock-search-suggest.md`](../requirements-stock-search-suggest.md)
- **复现脚本**：[`2026-09-11-search-suggest-fix-repro.mjs`](2026-09-11-search-suggest-fix-repro.mjs)（零新增依赖，只 import 真实模块 + jsdom 环境，不联网）
- **总结论**：**修复基本成立**——B1、B2（回车路径）、B3、C5、C6、D1、D2、D3 已实测生效，D4/D6 的测试补上了但**证据强度不足**；同时查出 **5 项遗留缺陷**（其中 1 项由本次修复引入）、**1 项需求 S16 仍未覆盖**，以及**收尾记录中的两处过度声明**。

---

## 一、门禁复跑（提交声称 vs 实测）

提交信息与收尾记录声称「794 个单测 + 7 项联想 E2E + ESLint 0 问题 + Vite 构建成功」，逐条实测：

| 门禁 | 声称 | 实测 | 结论 |
|------|------|------|------|
| `npm run lint` | 0 错误 0 警告 | 无任何输出 | ✅ 一致 |
| `npm test`（QUnit） | 794/794 | `# pass 794 / # fail 0` | ✅ 一致 |
| `npx playwright test e2e/search-suggest.spec.js` | 7 项全过 | `7 passed (18.7s)` | ✅ 一致（用例数确为 7） |
| `npm run build` | 成功 | `✓ built in 11.47s`，52 modules | ✅ 一致 |

> 注意：**门禁全绿不等于修复生效**。下表的每一条都用「在旧代码上必须失败」的方式单独验过。

## 二、逐项核实总表

复现脚本分三段：`CLOSURE`（修复项，`fixed` 应全 P / `broken` 应全 F）、`RESIDUAL`（两模式都应 F）、`FIX-INDUCED`（仅修复后才出现：`broken`=P、`fixed`=F）。实测 `--expect=fixed` 与 `--expect=broken` 均为「与期望不符 0 条」。

| 项 | 声称 | 实测结论 | 关键证据（repro 原文） |
|----|------|----------|------------------------|
| **B1** | 已修 | ✅ **真修复，但原报告前提有误** | fixed: 10 例全对；broken: `CATL→C(期望null) C919→C NIO→N`。**报告举例的「南京银行」「长江电力」旧代码本来就返回 `null`**（前缀是汉字「南/长」，不是 ASCII `N`/`C`）；对真实 5549 条名称做旧新全量对比：`旧 210 条 / 新 210 条，差异 0 条` → 影响面为零，属防御性修复 |
| **C6** | 已修（与 B1 同源） | ✅ **等价性已证，产物无需重建** | `5549 条名称上新旧 parseBaseName 输出完全一致` → 已提交的 `public/data/stock-suggest-dictionary.json` 不需要重新 `build:dict`（改动只对未来的异常数据有效） |
| **B2** | 已修 | ⚠️ **部分成立：只闭合了回车路径** | fixed: 回车后 `onAddCodes=[]` ✓；broken: `onAddCodes=["sh600519"]` ✗ → 回车这条确实修好了。但指针路径未闭合，见 **R1** |
| **B3** | 已修 | ✅ **真修复**（但仓库自带断言是空转） | repro：`bindEvents 注册 composition 监听 2 个；destroy 后未配平的类型=["compositionstart","compositionend"]`（旧）→ `[]`（新）。**但 `tests/searchSuggestController.test.js` 的 B3 用例在 `b9e57e5` 上照样通过**（见 §三） |
| **C5** | 已修 | ✅ 真修复 | fixed `[]` / broken `["sh600519"]` |
| **C4** | 已修 | ⚠️ **静态可见，未复现** | `handleBlur` 先清旧句柄、`executeAddCandidate`/`destroy` 都清 `blurTimer`；且下拉 DOM 位于 `.add-row` 内，`relatedTarget.closest('.add-row')` 会提前 return，实际竞态窗口很小。**本条为静态推断，未构造出可复现的竞态** |
| **D1** | 已修 | ✅ **真修复，且改对了原本与需求冲突的旧测试** | 需求 §2.1.2 与 S08 明确要求「换行/Tab 分隔」；broken: `换行=[] Tab=[]` ✗ → fixed: `换行=["sh600519","sz000001"] Tab=[...]` ✓，且 `分号=[] 顿号=[]` 无回归。`tests/app.test.js` 里原本断言「换行不分隔」的用例确实与需求矛盾，本次一并更正 |
| **D2** | 已实现 | ✅ **真实现，注入探针安全** | `mark 数=1 首个 mark 文本="600519"`；对抗性夹具（名称含 `浦发<mark>x</mark>银行`，查询 `<mark>`）：`span.textContent="浦发<mark>x</mark>银行"、注入出的嵌套节点=null` → 确认只用 `createTextNode`+`mark`，未拼 innerHTML、未把查询当正则 |
| **D3** | 已实现 | ✅ 真实现 | 渲染 `"数据日期: 2026-09-11"` == 直接从真实产物读到的 `asOfDate`（不是硬编码） |
| **D4** | 已补测试 | ⚠️ **E2E 有效，单测无效** | E2E 7 passed（含新增按钮用例）✅；但单测 `D4` 用例在 `b9e57e5` 上也通过（`ok 9`）→ 属回归守卫，不构成「两入口一致」的证明 |
| **D6** | 已补测试 | ⚠️ **测试通过但夹具契约强于生产** | 单测整体在旧代码上失败（判别有效）；但 `storage.setRaw` 在 `setItem` 抛错时 `threw=false、返回=false`——见 **R4**：生产链路根本不会抛错，D6 的「存储失败」分支只有 mock 能触发 |
| **D5** | 收尾记录称「所有遗漏需求已修复」 | ❌ **未做** | S16（三主题/窄屏/读屏）仍无 E2E；`e2e/search-suggest.spec.js` 的 7 条用例中没有任何主题/窄屏/读屏项 → 见 **收尾声明更正** |
| **C1** | 未声称修复 | ➖ 未处置（报告标「建议改进」） | `KNOWN_FUTURES_PINYIN` 中 `ZN` 与 `SN` 的 `initials` 仍同为 `hx`（`stockSearchService.js` L19/L22），`hx` 无法区分沪锌/沪锡 |
| **C2 / C3** | 未声称修复 | ➖ 未处置（报告已标低优先级/未来） | 维持原样，可接受 |

## 三、仓库自带新测试的判别力（本轮最值得记录的发现）

把 `3e4486e` 的三个测试文件**拷到 `b9e57e5` 的源码树上**运行（新旧实现交叉验证），结果：

```
ok 1..5  (原有 S10–S13)
not ok  6 B2: 防抖窗口内改变输入立即取消旧候选提交资格，不提交过期结果   ← 有判别力
ok      7 B3: destroy 完整移除 composition 监听器，不泄漏              ← 空转断言
not ok  8 C5: keyCode === 229 或 e.isComposing === true 拦截 Enter 提交 ← 有判别力
ok      9 D4: "+ 添加"按钮 (handleSubmit) 与 Enter 键两入口行为一致     ← 空转断言
not ok 10 D6: 快速双击/连按回车幂等，存储失败保留输入并报错             ← 有判别力
not ok 11 D2 & D3: 关键字安全高亮与数据日期 UI 渲染                    ← 有判别力
# pass 7 / # fail 4
```

- **B3 用例是空转断言**：它断言的是「destroy 后触发 keydown 不再添加」（`addCallCount === 0`），而 keydown 的移除在修复前就已存在；`compositionstart` 处理函数只会把 `isComposing` 置真，即使监听器泄漏也不会让 `addCallCount` 变化。**B3 的行为本身确实修好了**（§二 repro 已证），但这条用例证明不了它。
- **D4 单测同理**：修复前后都通过。
- 教训与项目既有记录一致：**新断言必须先确认它在旧代码上会失败，否则等于没写**。

## 四、本轮新查出的缺陷（均带可复现证据）

| ID | 严重度 | 位置 | 问题 | 证据 |
|----|--------|------|------|------|
| **R1** | P1（B2 未完全闭合） | `searchSuggestController.js` `handleInputChange` | 清空 `candidates`/`defaultSelectedIndex` 后**没有 `renderDropdown()`**，旧候选仍留在屏幕上且仍带预选中高亮；候选条目的 `click` 回调只判 `alreadyAdded`，所以防抖窗口内**点击残留旧项依然会提交过期标的** | `改输入前候选=1；改输入后旧 DOM 仍在（.suggest-item=1 个，其中预选中高亮=true），且未重绘；点击后 onAddCodes=["sh600519"]（期望 []）` —— 需求 §3.1「任何提交不得使用过期结果」 |
| **R2** | P2 | `toolbarView.js` L59 + `app.js` L507/L824 + 控制器 `bindEvents` | `#code-input` 上挂了**两个** keydown：工具栏的 `onAdd→handleAdd→handleSubmit` 与控制器的 `handleKeyDown→handleSubmit`，两者都不 `stopPropagation` → 一次回车被处理两次。正常路径因输入已清空而无感，但**报错路径会抖出两条一样的提示** | `onFlashMessage 调用 2 次：["未识别到匹配标的，可尝试代码或其他名称","未识别到匹配标的，可尝试代码或其他名称"]` |
| **R3** | P2（**修复引入**） | 控制器 `executeAddCandidate` 的 `catch` | 新加的 catch 会把输入**恢复**（`inputElement.value = prevVal`），于是第二个 keydown 监听立刻**再投递一次**；`broken` 模式下没有 catch、异常直接从监听器抛出、输入被清空，只投递 1 次 → **这条是本次修复新引入的行为** | fixed: `onAddCodes 被调用 2 次`；broken: `1 次`（脚本 `FIX-INDUCED` 段，两模式期望相反） |
| **R4** | P1（需求 S13 实际未达成） | `storage.js` `setRaw` + `app.js handleAddCodes` | `setRaw` 把 `setItem` 异常吞掉并返回 `false`；`setJSON` 虽然把布尔值透传出来，但 `setWatchList`/`setSubscribedCodes` 直接丢弃返回值，`handleAddCodes` 也不检查 → **真实的存储失败既不会抛给控制器、也不会有任何提示，输入照旧被清空**。D6 的「存储失败保留输入并报错」只在 mock 抛错时成立 | `storage.setRaw 在 setItem 抛错时 threw=false、返回=false` |
| **R5** | P2 | 控制器 `initDictionary` 的 `try/catch` | `try` 块把 `runSearch(currentQuery)` 也包了进去，于是**任何搜索/渲染异常都会被记成 `dictionaryError`**，UI 显示「名称搜索暂不可用，仍可输入完整代码添加」——而字典其实早已解析成功；更糟的是 `dictionaryError` 不会被重置，重试按钮先 `initDictionary()`（因 `dictionary` 已存在而立即返回）再 `runSearch`，**再次抛错，状态永久卡死** | `字典其实已成功解析（items=1），但 dictionaryError="item.name.replace is not a function"、UI 显示「名称搜索暂不可用」=true；点击重试后 dictionaryError 仍为该错误，期间新增未处理异常/拒绝 1 条` ※触发条件：字典条目字段类型异常（合成非法条目复现），正常产物不会触发 |
| **R6** | P3（UI/无障碍） | `src/style.css` `.suggest-match-highlight` | 新样式用 `var(--primary, #1890ff)`，但 **`--primary` 在三套主题里都没有定义**（全文件仅出现 1 次，即这处引用）→ 三主题恒为同一个蓝色，与相邻 `.suggest-code` 用 `--accent-color` 的做法不一致；实测对比度全部低于 WCAG AA 4.5:1 | 实测对比度：warm/light 卡片 `3.24:1`、hover `3.01/2.96:1`、dark 卡片 `4.32:1`、dark hover `3.73:1`（13–14px 正文需 4.5:1） |

## 五、收尾声明更正（保留原文，不静默改写）

`2026-09-11-search-suggest-code-review-handoff.md` 末尾「修复完成记录」有两处与实际不符，按项目惯例在此更正、不改写历史段落：

1. **「已针对报告中的所有必须修复 Bug、缺陷与质量优化项完成修复与验证」** → 实际 **D5（S16 主题/窄屏/读屏 E2E）未做**，C1/C2/C3 也未处置（C2/C3 原报告已标低优先级，可接受；C1 仍未解决）。建议改为「除 D5、C1–C3 外均已处置」。
2. **「D6：…持久化存储失败时保留输入并弹窗报错的降级单测」** → 该单测通过，但**生产链路不可达**（R4）：`storage.setRaw` 吞异常返回 `false`，`handleAddCodes` 不检查返回值。S13 的「存储失败保留输入并报错」**尚未真正达成**。

另需更正两处原报告的判断：
- **B1 的前提不成立**：`南京银行`/`长江电力` 以汉字开头，旧正则从不命中；真实数据上旧新结果 100% 一致。B1 的价值是防御未来数据，而非修复现存误判——**不影响本次修复的正确性，但影响严重度评估**。
- **B2 的修复不完整**：只闭合了 Enter 路径（R1）。

## 六、复现方式

```bash
# 修复后（应 exit 0，CLOSURE 段全 P）
node docs/handoff/2026-09-11-search-suggest-fix-repro.mjs --expect=fixed

# 修复前基线（应 exit 0，CLOSURE 段 8 条 F）
git worktree add --detach "D:/AiPrograms/project1/.tmp_wt_old" b9e57e5   # 必须传原生路径，否则 msys 会改写成 D:/d/...
# node_modules 用 PowerShell 建 junction 链接主仓库（Git Bash 的 mklink 会被转义搞坏）
cp docs/handoff/2026-09-11-search-suggest-fix-repro.mjs "D:/AiPrograms/project1/.tmp_wt_old/docs/handoff/"
cd "D:/AiPrograms/project1/.tmp_wt_old" && node docs/handoff/2026-09-11-search-suggest-fix-repro.mjs --expect=broken
# 清理：先非递归删 junction（切勿 rm -rf，会穿透删掉真实 node_modules），再 git worktree remove --force + prune
```

新测试判别力的复核方式（§三）：

```bash
# 在 b9e57e5 的 worktree 里，用 HEAD 的测试文件覆盖旧测试文件后运行
cp tests/searchSuggestController.test.js <old-tree>/tests/
cd <old-tree> && node node_modules/qunit/bin/qunit.js --require ./tests/_jsdom-setup.cjs tests/searchSuggestController.test.js
# 结果：# pass 7 / # fail 4 —— 通过的那几条即为空转断言
```

> 遗留：`D:/AiPrograms/project1/.tmp_wt_old` 已清空但目录本身被宿主的回收站保护机制拦下（`SAFE_DELETE_FAIL_CLOSED`）删不掉，手工删掉即可；`git worktree list` 已只剩主工作树。

## 七、建议的处置顺序（待确认后实施）

| 优先级 | 项 | 建议做法 |
|--------|----|----------|
| 1 | **R4** | 让 `setWatchList`/`setSubscribedCodes` 把 `setJSON` 的布尔值返回出来，`handleAddCodes` 检查失败时保留输入 + `flashError`；同步把 D6 单测夹具换成「真实 `storage` + 抛错的 storage adapter」，而不是让 mock 的 `onAddCodes` 直接抛 |
| 2 | **R1** | 在 `handleInputChange` 清空状态后补一次 `renderDropdown()`（关掉残留列表/预选中），或让候选 `click` 回调校验 `candidate === candidates[idx]` |
| 3 | **R2 / R3** | 控制器 `handleKeyDown` 里加 `if (e.defaultPrevented) return;`，或在工具栏 `onAdd` 里判断事件来源，保证一次按键只提交一次 |
| 4 | **R5** | 把 `initDictionary` 的 `try` 收窄到 `loadStockDictionary` 一行；重试时清 `dictionaryError`；渲染/搜索异常单独处理 |
| 5 | **D5 + R6** | 补 S16 的 E2E（三主题切换后下拉配色、窄屏布局、读屏 role 流程）；高亮改用已有的 `--accent-color`（顺带解决未定义变量与对比度） |
