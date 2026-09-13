# 2026-09-13 WorkBuddy 审查缺陷全面闭环交接文档

> **交接日期**：2026-09-13
> **解决缺陷**：
> - **P0（Major）**：`src/js/storage.js` storage 内存孤岛副本泄漏（R-ORPHAN）
> - **P1（测试）**：`tests/storage.test.js` 补齐容量淘汰下内存条目驱逐断言
> - **P2（Minor）**：`src/js/parser.js` 缺失量比解析为 `undefined`（渲染为 `-`）而非 `0.00`
> - **P3（代码异味）**：`src/js/limitUpView.js` `patchLimitUpRows` 传入真实的 `(lu.groupSort && lu.groupSort.pinned)` 消除死参数
> **参考审查文档**：[`2026-09-13-workbuddy-code-review-round1-handoff.md`](2026-09-13-workbuddy-code-review-round1-handoff.md)
> **验证脚本**：[`2026-09-13-review-round1-repro.mjs`](2026-09-13-review-round1-repro.mjs)

---

## 1. 修复方案与变更清单

### 1.1 P0：`src/js/storage.js` 内存孤岛副本闭环修复与生命周期配对
- **根因**：`klineCacheSet` 中的 LRU 容量淘汰此前仅统计持久化 `obj.entries`，未纳入仅在内存降级存储的条目；导致持久化条目被写满时，早期的内存副本永远不被淘汰成为长生不老的“孤岛”，在后续读取时被当作新鲜缓存命中。
- **修复措施**：
  1. **LRU 候选集与淘汰合并**：`allKeys = new Set([...Object.keys(obj.entries), ..._klineMemoryCache.keys()])`。超过 `KLINE_MAX_ENTRIES` 时，按访问时间统一排序，成对从持久化 `obj.entries` 与内存 `_klineMemoryCache` 中删除并清理访问时间索引。
  2. **阶段 3 兜底清理配对**：在写入单条或彻底降级清空持久化键时，同步清理原持久化集合在 `_klineMemoryCache` 和访问时间中的关联条目，避免残留。
  3. **数据完整性加固**：在 `_readKlineCacheEntry` 中读取条目时核验其 `code` 和 `period` 匹配，杜绝错配条目被当成有效缓存。

### 1.2 P1：`tests/storage.test.js` 写入压力与 LRU 内存淘汰回归测试
- 引入 `KLINE_MAX_ENTRIES` 常量。
- 新增单测 `in-memory fallback entry is properly evicted by LRU capacity under write pressure`，模拟配额降级后恢复并持续写入，严格断言内存降级条目在压力下被 LRU 正确淘汰，`klineCacheHas` 为 `false` 且 `klineCacheGet` 返回 `null`。

### 1.3 P2：`src/js/parser.js` 量比缺失语义对齐
- 将 `volumeRatio: parseFloat(fields[49]) || 0` 重构为：
  ```javascript
  const vr = parseFloat(fields[49]);
  const volumeRatio = Number.isFinite(vr) ? vr : undefined;
  ```
- 当腾讯行情源未提供或提供空量比时返回 `undefined`，配合 `formatNumber` 正确显示为 `-`；若数据源给出真实 `0` 则保留为 `0`（显示 `0.00`），忠实反映数据源语义。
- 在 `tests/parser.test.js` 中新增缺失/非数值量比返回 `undefined` 的断言。

### 1.4 P3：`src/js/limitUpView.js` 消除 `pinnedSort` 死参数
- 在 `patchLimitUpRows` 中将传入 `limitUpRowsMatchDom` 的置顶排序参数调整为优先使用 `(lu.groupSort && lu.groupSort.pinned)`，避免在置顶组改变排序后由于死参数导致一致性校验误判为不匹配而触发多余的完整重绘。

---

## 2. 验证结果与门禁核验

1. **审查复现脚本实测**：
   ```bash
   node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=fixed
   ```
   - **5/5 全部 PASS**（此前失败的 `[R-ORPHAN 读取]` 转为 PASS，`BUG-02` 与 `BUG-03` 保持 PASS）。
2. **ESLint 代码检查**：
   ```bash
   npm run lint
   ```
   - 0 errors, 0 warnings。
3. **QUnit 单元测试**：
   ```bash
   npm test
   ```
   - **810/810 全部通过**（新增 2 项单测全部通过）。
4. **Vite 生产构建**：
   ```bash
   npm run build
   ```
   - 生产打包成功。
5. **Playwright E2E 测试**：
   ```bash
   npm run e2e
   ```
   - **74/74 全部通过**。
