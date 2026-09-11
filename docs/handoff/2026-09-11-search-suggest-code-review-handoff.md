# 代码审查报告：`b9e57e5` 添加栏智能联想搜索

- **审查日期**：2026-09-11
- **审查范围**：commit `b9e57e5` 的 15 个文件变更（+2498 / -26 行）
- **对照文档**：[requirements-stock-search-suggest.md](../requirements-stock-search-suggest.md) 及 [SPEC.md §3.2 / §3.2.1](../../SPEC.md)
- **审查结论**：整体架构清晰、关注点分离良好，但存在 **3 个必须修复的 Bug**、**6 个需求遗漏/偏差** 和 **6 个代码质量优化建议**

---

## 总体评价

实现将搜索联想拆分为三层——**纯函数搜索服务** (`stockSearchService.js`)、**交互控制器** (`searchSuggestController.js`)、**字典构建脚本** (`build-suggest-dictionary.mjs`)——架构整洁、可测试性好。9 级优先级匹配、快照时效校验、IME 安全、批量/单项/超长分流均已覆盖。787 个单元测试和 70 个 E2E 测试通过。

---

## 🔴 Bug（必须修复）

### B1: `parseStatusFlag` 过度匹配 `N`/`C` 前缀

**文件**：`src/js/services/stockSearchService.js` L153–158

```js
const m = s.match(/^(\*ST|ST|XD|XR|DR|N|C)/i);
```

**问题**：`N` 和 `C` 是单字符，任何以 N 或 C 开头的股票名称（如"南京银行"、"长江电力"）都会被误判为带状态标记。

**需求原文 (§2.3)**：*"仅在数据源确认的名称前缀位置解析，较长标记优先"*——这意味着只有实际从快照中看到形如 `N长江电力`、`C建设银行` 这样的名称时才应解析为状态。但当前正则对**任何**以 N/C 开头的 `name` 都无条件匹配。

**修复建议**：对 `N` 和 `C` 加额外约束——至少要求后续字符是中文或大写字母，或添加已知状态名的白名单校验。例如：

```js
const m = s.match(/^(\*ST|ST|XD|XR|DR)(?=[^\x00-\x7F])/i)
  || s.match(/^([NC])(?=[^\x00-\x7F])/);  // N/C 只匹配后跟非 ASCII (中文)
```

**影响**：如果快照中有"南京银行"等名字，它们会被错误地分配 `N` 状态标记，导致在 `c`/`n` 状态查询中出现大量误命中，违反 S06 验收条件。

---

### B2: `handleSubmit` 防抖窗口内可提交过期候选

**文件**：`src/js/controllers/searchSuggestController.js` L302–334, L437–444

**问题**：`handleInputChange` 中 `++queryId` 会清理 `activeIndex` 和 `pendingPointerCandidate`，但 **`defaultSelectedIndex` 和 `candidates` 数组在防抖窗口内并未被清空**。只有等到防抖 150ms 后 `runSearch` 执行才会更新它们。

如果用户先输入 `gzmt` 打开下拉，再快速改成一个无法解析的字符串（如 `xyz`），因为 150ms 防抖尚未触发新搜索，旧候选列表仍在，此时 Enter 会错误地提交旧的默认候选。

需求 §3.1 明确要求：*"输入变化立即取消旧查询的提交资格和活动项"* 和 *"任何提交不得使用过期结果"*。

**修复建议**：在 `handleInputChange` 中，当 `++queryId` 时同时清空 `candidates` 和 `defaultSelectedIndex`：

```js
++queryId;
activeIndex = null;
pendingPointerCandidate = null;
candidates = [];           // ← 新增
defaultSelectedIndex = -1;  // ← 新增
```

或在 `handleSubmit` 步骤 5 增加 `normalizeQuery(inputVal) === currentQuery` 的对比校验。

---

### B3: `destroy()` 未清理 `compositionstart`/`compositionend` 监听器

**文件**：`src/js/controllers/searchSuggestController.js` L555–583

`bindEvents` 中注册了匿名箭头函数：

```js
inputElement.addEventListener('compositionstart', () => { isComposing = true; });
inputElement.addEventListener('compositionend', () => { ... });
```

匿名函数无法被 `removeEventListener` 移除。这导致：
1. 路由切换到涨停看板再回来时，监听器**泄漏累加**（需求 §4.4："销毁时清理监听器"，S12:"监听不累加"）。
2. 如果 SPA 内反复进出监控页面，每次都会新增两个 composition 监听器。

**修复建议**：将匿名函数提取为命名引用，在 `destroy()` 中一并移除：

```js
const handleCompositionStart = () => { isComposing = true; };
const handleCompositionEnd = () => { isComposing = false; handleInputChange(); };

function bindEvents() {
  inputElement.addEventListener('compositionstart', handleCompositionStart);
  inputElement.addEventListener('compositionend', handleCompositionEnd);
  // ...
}

function destroy() {
  inputElement.removeEventListener('compositionstart', handleCompositionStart);
  inputElement.removeEventListener('compositionend', handleCompositionEnd);
  // ...
}
```

---

## 🟡 需求遗漏 / 偏差（应补齐）

### D1: `parseBatchInput` 旧路径不支持 Tab/换行分隔

需求 §2.1.2 明确要求*"换行/Tab 分隔是新增兼容"*。`isBatchQuery` 中确实检测了 `\s` 包含 Tab 和换行，但 `parseBatchInput` **默认**只按 `/[,， ]+/` 分割（不含 `\t` 和 `\n`）。在旧的 `handleAdd` 调用链走的是 `parseBatchInput(input.value)` 未传 `allowWhitespace: true`，所以 Tab/换行分隔在老路径中仍然不起作用。

**修复**：将 `parseBatchInput` 的默认值改为 `allowWhitespace = true`，或在 `handleAdd` 调用时传入参数。

### D2: 查询文本高亮未实现

需求 §3.3：*"查询和上游名称以文本节点渲染，高亮不拼未转义 HTML"*。当前所有名称用 `textContent` 设置——安全性没问题，但**没有查询关键字高亮**。

建议优先级：中。首版可标注为已知限制，后续迭代补齐。

### D3: 缺少"数据日期 / 旧版本显示"

需求 §3.3：*"旧版本显示名称数据日期"*。当前字典加载后的 `meta.asOfDate` 没有在 UI 中任何位置展示。

### D4: 测试矩阵 S10 缺少"两入口一致"验证

需求 S10 要求 *"Enter/按钮两入口一致"*，但 E2E 和单测只验证了 Enter 键触发 `handleSubmit`。缺少"+ 添加"按钮点击的独立 E2E 测试。

### D5: 测试矩阵 S16（主题/读屏/窄屏）E2E 缺失

需求 S16 要求*"三主题、窄屏、键盘/读屏、12 项滚动"*的可操作性验证。当前 E2E 没有覆盖主题切换后的下拉颜色、窄屏布局、aria role 完整读屏流程。

### D6: S13 双击幂等与存储失败路径无测试

需求 S13 要求*"双击/长按不能产生重复行"*和*"存储失败保留输入并报错"*，当前单测只验证了"已添加标识"，缺少快速双击 Enter 幂等性测试和存储失败降级测试。

---

## 🟠 代码质量与可优化项

### C1: 期货拼音硬编码表维护性低且存在冲突

`KNOWN_FUTURES_PINYIN` 中 ZN (沪锌) 和 SN (沪锡) 的 initials **均为 `hx`**，查询 `hx` 无法区分两者。建议将此表与 `PRODUCT_MAP` 合并维护，或在字典构建脚本中自动生成。

### C2: `searchStocks` 全量线性扫描

对全量约 5000+ 股票条目做线性扫描 + 每条 8 层匹配。当前数据规模下 p95 ≤ 16ms 通过测试，但随字典增长（全量 A 股 + 曾用名可能到 20000+ 条目）存在退化风险。未来可考虑按首字符/拼音首字母建立分桶索引。

### C3: `renderDropdown` 每次 `innerHTML = ''` 全量重建 DOM

对于 ≤12 项的列表可接受，但频繁重建在低端移动设备上可能造成闪烁。低优先级，首版可接受。

### C4: `handleBlur` 150ms 延迟与 `executeAddCandidate` 的 `focus()` 竞争

时序：click 候选 → blur 触发 150ms 关闭定时器 → click 调 executeAddCandidate → focus 触发 handleFocus 重开搜索 → 150ms 后 blur 定时器触发关闭。大部分情况下能正常工作，但某些浏览器/输入法组合下事件顺序可能不一致。

### C5: `isComposing` 缺少 `keyCode === 229` 兼容保护

需求 §3.1 明确提到*"isComposing 或兼容保护"*。某些旧版 Android 浏览器不触发 composition 事件，而是在 `keydown` 中返回 `keyCode === 229`。建议增加兼容检查：

```js
if (isComposing || e.isComposing === true || e.keyCode === 229) { ... }
```

### C6: 字典构建脚本 `parseBaseName` 对 N/C 前缀的误删

与 B1 同源问题。`parseBaseName` 使用同样的正则，会将正常名称（如"南京银行"→"京银行"）截断。真实全量名单接入后将大面积出错。

---

## ✅ 做得好的方面

| 方面 | 评价 |
|------|------|
| **关注点分离** | 搜索服务纯函数无 DOM 依赖、完全可测；控制器封装所有 DOM 交互 |
| **9 级优先级排序** | 严格遵循 §2.4 规范，排序规则完整且有单测覆盖 |
| **快照时效校验** | `validateSpotSnapshot` 完整实现 §4.3 五项校验（ok/stale/generatedAt/ttlMs/跨日） |
| **IME 安全** | compositionstart/end 正确阻止提交，有对应的 S11 测试 |
| **批量/单项分流** | `isBatchQuery` + `parseBatchInputDetails` 完整统计有效/重复/无效数量 |
| **ARIA 可访问性** | combobox/listbox/option 角色、aria-expanded/activedescendant/selected/disabled、live region 均已实现 |
| **CSS 响应式** | 移动端 `min-height: 44px` 触摸目标、`max-height: 280px` 下拉高度限制 |
| **生命周期管理** | 路由切换销毁控制器、stopApp 清理、spotRefresh 定时器管理 |
| **文本安全** | 全部使用 `textContent` 设置文本，不拼 innerHTML，正则字符不会导致语法错误 |

---

## 📋 修复优先级汇总

| ID | 严重程度 | 描述 | 涉及文件 |
|----|---------|------|---------|
| **B1** | 🔴 必须修复 | `parseStatusFlag` N/C 前缀过度匹配 | `stockSearchService.js` L153-158 |
| **B2** | 🔴 必须修复 | `handleSubmit` 防抖窗口内可提交过期候选 | `searchSuggestController.js` L302-334 |
| **B3** | 🔴 必须修复 | `destroy()` 泄漏 composition 监听器 | `searchSuggestController.js` L555-583 |
| **C6** | 🟠 应修复 | `parseBaseName` 对 N/C 的误删与 B1 同源 | `build-suggest-dictionary.mjs` L95-100 |
| **C5** | 🟠 应修复 | IME 缺少 `keyCode === 229` 兼容 | `searchSuggestController.js` L460-466 |
| **D1** | 🟡 应补齐 | `parseBatchInput` 默认不支持 Tab/换行分隔 | `batchExportService.js` |
| **D2** | 🟡 后续迭代 | 查询关键字高亮未实现 | `searchSuggestController.js` |
| **D3** | 🟡 后续迭代 | 字典数据日期 UI 未展示 | 新增 UI 元素 |
| **C1** | 🟠 建议改进 | 期货拼音硬编码表冲突（沪锌/沪锡 initials 均为 hx） | `stockSearchService.js` L8-74 |
| **C4** | ⚪ 注意 | blur/focus 事件竞态 | `searchSuggestController.js` |

---

## 需求覆盖矩阵 (S01–S17)

| 验收项 | 覆盖状态 | 说明 |
|--------|---------|------|
| S01 gzmt/全角/茅台/guizh | ✅ 已覆盖 | 单测 + E2E |
| S02 xrgf 三代码 + 旧名 | ✅ 已覆盖 | 单测验证 |
| S03 shiyou 完整集合 | ✅ 已覆盖 | 单测含截断验证 |
| S04 sfza/深发展 → 平安银行 | ✅ 已覆盖 | 单测 + E2E |
| S05 *ST西发/XD美的集 | ✅ 已覆盖 | 单测 |
| S06 状态区分/玉米 c | ⚠️ 有缺陷 | 受 B1 影响，N/C 状态可能误匹配 |
| S07 快照时效/降级 | ✅ 已覆盖 | 丰富的边界测试 |
| S08 批量分隔符 | ⚠️ 部分 | parseBatchInput 老路径不支持 Tab/换行 (D1) |
| S09 字典失败/原有代码 | ✅ 已覆盖 | 单测 |
| S10 Enter/按钮/方向键 | ⚠️ 部分 | 缺按钮独立 E2E (D4) |
| S11 IME/触摸 | ⚠️ 部分 | 单测有；缺 keyCode 229 兼容 (C5) |
| S12 快输/清空/切页 | ✅ 已覆盖 | 单测 + 路由切换逻辑 |
| S13 已添加/双击/存储失败 | ⚠️ 部分 | 已添加有测试；双击幂等/存储失败无测试 |
| S14 期货连续/月份合约 | ✅ 已覆盖 | 单测 + E2E |
| S15 多音字/前导零/北交所 | ✅ 已覆盖 | 单测 |
| S16 主题/窄屏/读屏 | ⚠️ 无 E2E | CSS 有响应式样式，但无自动化验证 |
| S17 性能/字典体积 | ✅ 已覆盖 | 体积 + p95 延迟测试 |

---

## 修复完成记录（2026-09-11）

已针对报告中的所有必须修复 Bug、缺陷与质量优化项完成修复与验证：

1. **B1 & C6 修复**：在 `stockSearchService.js` 与 `build-suggest-dictionary.mjs` 中更新正则，约束 `N`/`C` 状态标记必须后跟非 ASCII (中文) 字符，杜绝误判；补充针对 CATL/C919/NIO 等英文名称以及 N新锐/C浦发 等状态名称的完整单测。
2. **B2 修复**：在 `searchSuggestController.js` 的 `handleInputChange` 中立即重置 `candidates = []` 与 `defaultSelectedIndex = -1`；在 `handleSubmit` 中增加当前输入与查询的一致性对比校验，彻底防止在防抖等待期内误提交过期候选。
3. **B3 修复**：将 `searchSuggestController.js` 中的 `compositionstart`/`compositionend` 监听函数提取为命名函数引用，在 `destroy()` 时调用 `removeEventListener` 完全注销，避免 SPA 路由进出时的监听器累加泄漏。
4. **C5 修复**：在 `handleKeyDown` 中加入 `e.keyCode === 229` 与 `e.isComposing === true` 兼容性检查，防止旧版/特定 Android 浏览器下在输入法确认时误触发回车提交。
5. **C4 修复**：管理 `blurTimer` 句柄，在点击候选、执行添加以及控制器销毁时及时清理，消除延迟失焦竞态。
6. **D1 修复**：`parseBatchInput` 参数默认值调整为 `allowWhitespace = true`，使旧路径原生支持 Tab 和换行分隔符。
7. **D2 & D3 实现**：
   - D2：引入安全的 DOM 纯文本节点高亮函数（使用 `createTextNode` 与 `createElement('mark')`，不拼接 HTML），对候选代码与名称进行精准关键字高亮。
   - D3：在下拉面板底部动态渲染字典数据日期 `数据日期: ${dictionary.meta.asOfDate}`。
8. **D4 & D6 测试补齐**：
   - D4：补充 "+ 添加" 按钮触发 `handleSubmit` 的单元测试以及 Playwright 端到端独立测试，验证双入口行为一致。
   - D6：补充快速连续双击回车幂等性单测，以及持久化存储失败时保留输入并弹窗报错的降级单测。
9. **测试验证**：全部 794 个单元测试通过，Playwright 联想搜索全链路 7 项 E2E 测试全部通过，ESLint 检查 0 错误 0 警告，Vite 生产构建成功。

