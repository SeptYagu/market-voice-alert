# 2026-09-13 WorkBuddy 审查 round 2 缺陷闭环交接文档

> **交接日期**：2026-09-13
> **解决缺陷**：
> - **P2（Major）**：`src/js/storage.js` LRU 容量淘汰 tie-break 不确定性与偶发测试失败（QUnit 偶发 11/40 失败）
> - **P3（Minor）**：`src/js/parser.js` Eastmoney 行情源缺失量比（`f50`）未与 Tencent 对齐（应为 `undefined` 渲染为 `-` 而非 `0.00`）
> **参考审查文档**：[`2026-09-13-workbuddy-code-review-round2-handoff.md`](2026-09-13-workbuddy-code-review-round2-handoff.md)
> **被审基线提交**：`ffe92b3` (Round 1 闭环) ➔ `518495d` (WorkBuddy Round 2 审查)

---

## 1. 根因剖析与修复方案

### 1.1 P2：`src/js/storage.js` LRU 容量淘汰 tie-break 确定性加固与单测稳定性
- **根因分析**：
  V8 引擎中的 `Array.prototype.sort` 是稳定排序（TimSort）。在 `klineCacheSet` 中，候选键集合以 `new Set([...Object.keys(obj.entries), ..._klineMemoryCache.keys()])` 构造，已持久化的键在前，内存条目在后。
  当写入压力测试或并发密集写入发生在同一毫秒内时，`_getEntryLastAccessed` 返回的时间戳相同（`t1 === t2`）。由于没有二级 tie-breaker，稳定排序保持了原有顺序，导致内存孤岛条目排在最后。每次超出容量循环仅切除前部 1 条，因而在 `KLINE_MAX_ENTRIES + 10` 的写入压力窗口内，内存孤岛条目始终未被切中，导致 `tests/storage.test.js:539` 断言偶发失败（QUnit 下约 27.5% 失败率）。
- **修复措施**：
  1. **当前写入键保护**：在排序比较器最前端显式排除当前正在写入的键（`k1 === key ? 1 : -1`），确保当前数据永远不会在淘汰阶段被误伤。
  2. **内存孤岛优先淘汰**：当访问时间戳相等（`t1 === t2`）时，增加二级排序策略：仅存在于内存中的孤岛条目优先淘汰（`const m1 = !obj.entries[k1] && _klineMemoryCache.has(k1); ... return m1 ? -1 : 1`）。
  3. **确定性键名字典序**：三级比较使用 `k1.localeCompare(k2)` 保证跨平台全排列 100% 确定，彻底消除由于时钟粒度或引擎调度引起的随机性。
  4. **内存上限兜底加固**：在淘汰循环之后增加防御式裁剪检查：若 `_klineMemoryCache.size > KLINE_MAX_ENTRIES`，直接按访问时间淘汰多余内存条目，确保无论何种异常边界，内存占用绝对有界。
  5. **单测稳定性与确定性覆盖**：
     - 在 `tests/storage.test.js` 中新增专门的冻结时钟（`Date.now = () => fixedTime`）用例：`tie-break deterministic eviction prefers evicting memory-only orphan when timestamps tie`，确定性验证在全部毫秒并列的情况下，内存孤岛条目 100% 被优先淘汰且当前键被完好保留。
     - 循环运行 50 次 `tests/storage.test.js`：50/50 全部通过，偶发失败率降至 0。

### 1.2 P3：`src/js/parser.js` Eastmoney 量比缺失语义对齐
- **根因分析**：
  在 Round 1 修复中仅对齐了 Tencent 行情源（`parseFloat(fields[49])` 无效时返回 `undefined`），而 Eastmoney 行情源分支（`parseEastmoney`，`src/js/parser.js:118`）仍使用 `volumeRatio: div100(d.f50)`。
  当东财接口返回的 `f50` 字段为 `undefined`、`null` 或 `'-'` 时，`div100` 函数（`Number(val) / 100 || 0`）将其转换为 `0.00`，导致涨停看板或监控表格显示为 `0.00` 而非预期的 `-`。
- **修复措施**：
  1. 重构 `parseEastmoney` 的 `volumeRatio` 解析：
     ```javascript
     volumeRatio: (d.f50 !== undefined && d.f50 !== null && d.f50 !== '-' && Number.isFinite(Number(d.f50)))
       ? Number((Number(d.f50) / 100).toFixed(2))
       : undefined,
     ```
  2. 在 `tests/parser.test.js` 中新增用例 `parses volumeRatio from f50 and sets undefined when missing`，覆盖正常数值（如 185 ➔ 1.85）、真实 0（0 ➔ 0）、缺失字段（➔ `undefined`）以及破折号（`'-'` ➔ `undefined`）全部分支。

---

## 2. 门禁与验证结果

1. **自动化单测连续高频压力验证**：
   - 连续执行 50 次 `npx qunit tests/storage.test.js`：**50/50 全部通过（0 偶发失败）**。
   - 全量 QUnit 单元测试：**812/812 全部通过**（新增 2 项用例）。
2. **ESLint 静态代码检查**：
   - `npm run lint`：0 错误，0 警告。
3. **生产打包构建**：
   - `npm run build`：生产环境打包成功。
4. **Playwright E2E 全量端到端测试**：
   - `npm run e2e`：**74/74 全部通过**。
5. **Round 1 / Round 2 证据脚本复核**：
   - `node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=fixed`：**5/5 全部通过**。
