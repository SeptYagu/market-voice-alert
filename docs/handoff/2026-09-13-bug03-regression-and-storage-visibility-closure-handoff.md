# 2026-09-13 BUG-03 回归与存储降级可见性闭环交接文档

> **交接日期**：2026-09-13  
> **交接对象**：BUG-03 回归修复、BUG-02 降级条目可见性修复及测试基线覆盖  
> **对应审查**：[`docs/handoff/2026-09-12-review-fix-verification.md`](2026-09-12-review-fix-verification.md)  
> **核验脚本**：[`docs/handoff/2026-09-12-review-fix-verification-repro.mjs`](2026-09-12-review-fix-verification-repro.mjs)（实测 **15/15 全部 PASS**）

---

## 1. 核心修复详情

### 1.1 BUG-03 彻底闭环（消除重复补丁，统一视图行级更新）
- **问题根因**：
  前序提交 `b601d1b` 在 `limitUpController.js` 的 `patchLimitUpQuoteCells()` 中手工编写了一套局部更新逻辑，只提取了 4 个字段（price/percent/amount/reason），遗漏了 `open`（开盘价）与 `volumeRatio`（量比）。由于涨停主接口并不产出真实开盘价与量比（硬编码为 0 或 undefined），行情富集（`enrichLimitUpItemsWithQuotes`）是这两列数据的唯一来源。结构未变走补丁分支时，DOM 永远无法更新，导致看板「开盘价」恒为 `0.00`、「量比」恒为 `-`。
- **架构重构与修复**：
  1. 废除控制器中第二套不完备的字段补丁，将 DOM 行级补丁统一收敛至视图层 `src/js/limitUpView.js`。
  2. 导出已有的完备行补丁 `patchRow(row, item, ctx)`，并封装 `patchLimitUpRows(root, state)`：在结构与代码序列一致时，直接就地更新整行，一次性完整同步 `count`、`price`、`percent`、`open`、`volumeRatio`、`amount`、`final`、`break`、`reason`、`name` 以及 ST 徽标；
  3. 将 `limitUpRowsMatchDom` 下沉至视图层维护，并在 `limitUpController.js` 中向前兼容重导出；
  4. 控制器中的 `patchLimitUpQuoteCells()` 纯粹作为调度分支：结构一致时直接委托 `patchLimitUpRows` 原地更新，不一致时才回退至 Reconcile 全表重绘，彻底解决 DOM 与 state 脱钩。

### 1.2 BUG-02 内存降级可见性加固
- **问题根因**：
  `storage.js` 的 `_readKlineCacheEntry` 在持久化存储存在 `kline-cache-v1` 但缺少指定 key 时，直接返回了 `null`，未穿透回查 `_klineMemoryCache`。导致在配额超限降级写入内存后，一旦后续写入成功使存储恢复，之前降级到内存中的条目被静默遗忘。
- **修复**：
  将 `_readKlineCacheEntry` 的判定调整为：只有在持久化 entries 中真实命中 `obj.entries[key]` 时才直接返回；未命中时继续穿透查询 `_klineMemoryCache.get(key)`，保证降级条目在会话期间生命周期的持续可见性。

---

## 2. 自动化测试与质量门禁验证

1. **核验复现脚本（Repro Script）**：
   - 运行命令：`node docs/handoff/2026-09-12-review-fix-verification-repro.mjs --expect=fixed`
   - 实测结果：**15/15 全部 PASS**（此前失败的 `BUG-03 open` 与 `BUG-03 ratio` 2 项断言全部转为 PASS，不一致项为 0）。
2. **ESLint 语法与代码规范**：
   - 运行命令：`npm run lint`
   - 实测结果：**0 错误，0 警告**。
3. **QUnit 离线单元测试**：
   - 运行命令：`npm test`
   - 实测结果：**808 / 808 全部 PASS**（新增 `tests/limitUpView.test.js` 中针对 `patchLimitUpRows` 就地更新开盘价与量比的专项单测，以及 `tests/storage.test.js` 中针对配额恢复后内存降级条目持续可见性的单测）。
4. **Playwright 真实浏览器端到端测试**：
   - 运行命令：`npm run e2e`
   - 实测结果：**74 / 74 全部 PASS**。
5. **Vite 生产构建打包**：
   - 运行命令：`npm run build`
   - 实测结果：顺利打包通过，产物无异常。
