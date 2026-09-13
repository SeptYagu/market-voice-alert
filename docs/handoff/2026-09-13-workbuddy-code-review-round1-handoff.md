# 2026-09-13 WorkBuddy 独立代码审查（round 1）

> **审查日期**：2026-09-13
> **审查对象**：`ad69e35` — *fix: 闭环修复 BUG-03 看板开盘价/量比回归与 BUG-02 降级可见性缺口*
> 及后续文档规范化提交（`dca2e4c`、`4272830`、`5920b9d`、`8bc9464`、`6c49a46`、`ac72c15`）
> **审查基线**：`ad69e35^`（`a566c46`）
> **复现脚本**：[`2026-09-13-review-round1-repro.mjs`](2026-09-13-review-round1-repro.mjs)（双模式 `--expect=broken|fixed`，零依赖，只 import 真实模块）
> **验收标准**：**实现的功能本身**。测试通过 ≠ 修复生效；他人提供的复现脚本一律视为「待验证的主张」，不作为结论依据。

---

## 0. 审查方式说明（为什么不能只看测试）

本轮审查刻意**不**采信以下三类证据，全部改为自行构造反例：

1. 提交方自带的门禁结果（`npm run lint` / `npm test` / `npm run e2e` / `npm run build`）——这些是「必须通过才会提交」的，对缺陷不具判别力；
2. 提交方自带的复现脚本 `2026-09-12-review-fix-verification-repro.mjs` 的 PASS 结果；
3. 提交方新增的单测断言本身。

做法：直接阅读 `ad69e35` 的源码 diff → 针对每个「新写入的状态字段」与「新的读取路径」自行编写探针（共 17 个探针）→ 凡涉及第三方/环境语义的先在本地实测 → 最后用 `git worktree` 在**修复前提交**上复跑同一断言，确认其判别方向。

**关键结论**：`ad69e35` 的两项声称修复（BUG-03、BUG-02）**确实生效**；但它**同时新引入了一处数据一致性回归**（详见 §2）。

---

## 1. 结论总表

| 项 | 提交声称 | 独立实测结论 | 关键证据 |
| :--- | :--- | :--- | :--- |
| **BUG-03** 看板开盘价/量比 | 已闭环 | ✅ **真闭环** | 复现脚本 `BUG-03 open/ratio` 由 `patch返回=false / DOM=0.00 / -` 转为 `true / 1808.50 / 1.85`；`patchRow` 字段覆盖为旧控制器补丁的严格超集 |
| **BUG-02** 内存降级可见性 | 已闭环 | ✅ **闭环（目标行为达成）** | 配额恢复后 `has(mem1)===true`（基线为 `false`）；8 项独立探针（含过期判定、清除联动、跨源优先级）全部符合预期 |
| **【新】R-ORPHAN** 内存孤岛副本 | 未声称 | ❌ **新引入回归（Major）** | 同一断言在基线 `PASS`、在 HEAD `FAIL`：持久化已无该 key，读取仍返回陈旧副本且被判为「新鲜」 |
| **【既有】量比缺失语义** | 未声称 | ⚠️ 既有缺陷（Minor，非本次引入） | `parser.js:73` 的 `parseFloat(fields[49]) \|\| 0` 使「无量比」显示为 `0.00` 而非 `-`（源自 `32da3ca`） |
| AGENTS.md / 模板规范化 | 已完成 | ✅ 自洽 | 终态与派发提示词逐字一致；本轮收到的任务描述即 §4.2 模板实例 |

**门禁复跑（与提交声称一致）**：`npm run lint` 0 问题；`npm test` **808/808**；`npm run build` 成功；`npm run e2e` **74/74**。
→ 即 **测试全绿的同时存在本报告 §2 的数据一致性回归**：现有测试与 E2E 均无覆盖。

---

## 2. 【Major · 新引入回归】内存孤岛副本被当作有效缓存返回

### 2.1 位置与根因

`ad69e35` 把 `src/js/storage.js:356` 的读取逻辑由

```js
if (obj && typeof obj === 'object' && obj.entries) {
  return obj.entries[key] || null;          // 修复前：持久化未命中 ⇒ 直接 null
}
```
改为
```js
if (obj && typeof obj === 'object' && obj.entries && obj.entries[key]) {
  return obj.entries[key];                  // 修复后：持久化未命中 ⇒ 继续回查内存
}
```
...
return _klineMemoryCache.get(key) || null;  // storage.js:363
```

这个改动本身是 BUG-02 的正确修法。**问题出在它与 `_klineMemoryCache` 的生命周期管理不匹配**：

`_klineMemoryCache` 只在「降级写」这一条路径被**写入**（`storage.js:468`，位于 `_persistKlineCacheWithFallback` 的最末兜底分支）。而容量淘汰（`storage.js:497`）是：

```js
const entries = Object.entries(obj.entries);   // ← 只遍历「持久化」entries
if (entries.length > KLINE_MAX_ENTRIES) { ... _klineMemoryCache.delete(k); }
```

**淘汰候选集来自持久化 `obj.entries`，而孤岛副本根本不在其中** → 它永远不会被容量淘汰清理。修复后的读取路径又对它敞开了门，于是这个「内存里有、持久化里没有」的条目变成了**永生且可读**的孤岛副本。

### 2.2 复现与判别力证明

```bash
# HEAD：应出现 1 条 FAIL（R-ORPHAN 读取）
node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=fixed

# 修复前基线：同一断言应为 PASS（证明是本次引入）
git worktree add --detach "D:/AiPrograms/.tmp_wt_r1b" ad69e35^
# 用 PowerShell 建 node_modules junction（非递归，勿用 rm -rf）
node docs/handoff/2026-09-13-review-round1-repro.mjs --expect=broken
```

实测（同一脚本、同一断言）：

| 断言 | 基线 `a566c46` | HEAD `ac72c15` |
| :--- | :--- | :--- |
| `R-ORPHAN` 读取：持久化无此 key 时不得返回内存副本 | **P**（读 = `null`） | **F**（读 = `A-OLD`，且 `isKlineCacheStale=false`） |
| `BUG-02` 降级可见性 | F（`has=false`） | **P** |
| `BUG-03 open` | F（`0.00`） | **P**（`1808.50`） |
| `BUG-03 ratio` | F（`-`） | **P**（`1.85`） |

`R-ORPHAN` 的**方向反转**（旧代码通过、新代码失败）即为本次回归的判定依据。

### 2.3 影响面（为什么定 Major）

- 消费方：`src/js/api.js:473` 的 `klineCacheGet()` 命中即 `Promise.resolve(cached)` 并仅后台异步 revalidate（SWR）。
- 孤岛副本的 `fetchedAt` 是**首次降级写入时**的时间戳，`isKlineCacheStale` 实测返回 `false` → 被当作**新鲜缓存命中**，直接把陈旧 K 线喂给图表。
- 触发条件真实存在：localStorage 配额超限（本应用缓存量大，`KLINE_MAX_ENTRIES=100` 条 K 线）是**已在代码中专门处理**的常态场景，说明作者预期它会发生。
- 与既有 `_klineMemoryCache.delete` 的配对逻辑不同：容量淘汰/降级裁剪/prune/clear 都成对清理，**唯独 `remove(KLINE_CACHE_KEY)`（storage.js:459）与「从来不在持久化的孤岛」这两类没有被覆盖**。

> 备注：作者已意识到「降级条目会丢」，本轮修复正是为它补读路径。但补读取的同时未同步补**清理**，属于「修复只做了一半」。

### 2.4 建议修法

保持 BUG-02 的目标行为不变，仅补齐生命周期配对：

1. **首选**：让容量淘汰同时考虑内存副本。把淘汰候选集改为 `new Set([...Object.keys(obj.entries), ..._klineMemoryCache.keys()])`，对超出上限者同时 `delete obj.entries[k]` 与 `_klineMemoryCache.delete(k)`；
2. **兜底**：在 `remove(KLINE_CACHE_KEY)` 的分支（`storage.js:459` / `:467`）同时 `_klineMemoryCache.clear()`，保证「持久化整体清空」时内存不残留；
3. **可选加固**：读取到内存副本时校验其 `code/period` 与请求 key 一致（防止 `_klineMemoryCache.set(currentKey, currentEntry)` 的调用方传错 key 造成错配）。

> 修完请在 `--expect=fixed` 下确认 `R-ORPHAN` 转 PASS，同时 `BUG-02` 仍为 PASS（**不要**用「退回 `|| null`」的写法修，那会把本次 BUG-02 修复一起回滚）。

---

## 3. 【Minor · 既有，非本次引入】量比缺失被渲染为 0.00

- **位置**：`src/js/parser.js:73` → `volumeRatio: parseFloat(fields[49]) || 0`
- **现象**：腾讯行情缺失量比字段时（盘前、停牌、部分 ST）→ `0` → `formatNumber(0)` = `"0.00"`；而「真无数据」应显示 `-`（`formatNumber(undefined)` = `"-"`）。
- **后果**：用户无法区分「量比恰为 0」与「无该数据」，与本次修复所追求的「开盘价/量比列必须真实反映数据源」的目标相悖。
- **来源归属**：`git log -S "parseFloat(fields[49]) || 0"` → `32da3ca`，**早于本次提交，非 ad69e35 引入**。记录在案以免后人误判为本次回归。
- **建议**：改为 `const vr = parseFloat(fields[49]); volumeRatio: Number.isFinite(vr) ? vr : undefined`。

---

## 4. 已核查并**排除**的可疑点（避免后人重复怀疑）

以下均由探针实测否定，记录在此：

1. **`patchRow` 的 ST 徽标是否累积？** —— 否。`patchRow` 先 `name.textContent = 名称`（会自动清空既有子节点）再 `appendChild`，20 次连续补丁后徽标数恒为 1；非 ST 标的不会出现徽标；摘帽/戴帽均正确。`buildRow` 与 `patchRow` 在此字段上行为一致。
2. **`patchRow` 是否引入 XSS？** —— 否。名称经 `textContent` 写入，`<img src=x onerror=...>` 被转义为纯文本。
3. **`limitUpRowsMatchDom` 是否会把「行序已变」误判为一致（假阳性）？** —— 用**真实** `buildLimitUpGroupsForState` 构造状态时判定正确返回 `false`（触发 reconcile）。初审用「手工拼接、组内未排序」的状态曾出现假阳性，**属探针构造错误，非代码缺陷**。
4. **`lu.pinnedSort` 恒为 `undefined`（全仓从未赋值）是否致错配？** —— 否（仅性能）。置顶组改排序后，校验侧用默认 `amount` 期望顺序与 DOM 实际（`groupSort.pinned` 顺序）不符 → 判定 `false` → 退回全量 reconcile。**结果是正确的，只是多付出一次重绘**。属死参数/潜在隐患，非缺陷。
5. **`patchRow` 新增覆盖的 `count`/`final`/`break`/`open`/`ratio` 字段是否有显示回归？** —— 否，4 项探针（含归零、清空、转跌方向类名）全部符合预期；且字段覆盖为旧控制器补丁的**严格超集**（旧补丁漏 `open`/`volumeRatio`，正是 BUG-03 的成因）。
6. **`patchLimitUpRows` 在页面索引缺失（`pageIndexes` 无记录）时是否崩？** —— 否，回退到 `viewContext(lu, {})`，且 `limitUpRowsMatchDom` 前置判定为假时直接返回 `false`。控制器 `patchLimitUpQuoteCells()` 返回 `false` 时正确回退 `rerenderLimitUpPage()`（`limitUpController.js:256/279/350/376/416` 五处调用点均已配对）。
7. **storage 各淘汰路径是否成对清理内存？** —— 容量淘汰（`:433`）、stage-1（`:433`）、stage-2（`:449`）、prune（`:515/:526`）、clear（`:536`）**均已配对**；缺口仅在于「不在持久化的孤岛」（§2）。

---

## 5. 为什么 808 单测 + 74 E2E 全绿仍然漏掉 §2

- 新增单测（`tests/storage.test.js`）覆盖的是「**降级条目能否读回**」，即修复**目标**方向；未构造「**降级条目应当消失**」的逆向场景。
- 全仓无任何断言将 `_klineMemoryCache` 与持久化 `entries` 的**集合一致性**挂钩（例如「内存 keys ⊆ 持久化 keys」这一不变式），因此孤岛副本天然无感。
- E2E 走真实浏览器 localStorage，配额极难在测试中被打满，属环境不可达，**不能作为免检理由**。
- §2.2 的对照表证明：该断言在旧代码上会失败（`--expect=broken` 下为 `FAIL`）——即它是**有判别力的有效断言**，可直接补进 `tests/storage.test.js`。

---

## 6. 处置建议

| 优先级 | 项 | 说明 |
| :--- | :--- | :--- |
| **P0** | §2 R-ORPHAN 孤岛副本 | 会把陈旧 K 线当新鲜缓存送进图表；按 §2.4 修法补齐生命周期配对，并补一条回归断言 |
| P1 | §5 补测试 | 把 `R-ORPHAN` 断言搬进 `tests/storage.test.js`（已在复现脚本中验证判别力） |
| P2 | §3 量比缺失语义 | 既有缺陷，建议顺手改为 `undefined` 语义 |
| P3 | §4.4 `pinnedSort` 死参数 | 建议删除该形参或改为直接传入 `state.groupSort.pinned`，消除误导 |

**对 `STATUS.md` 的更正建议**：本轮「BUG-03 / BUG-02 全面闭环」的描述应补充为：
**BUG-03 闭环；BUG-02 目标行为达成；但 storage 读取路径新引入「内存孤岛副本」回归（P0，待修）。**
