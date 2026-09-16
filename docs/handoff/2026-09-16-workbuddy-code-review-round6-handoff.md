# 国际品种接入方案 WorkBuddy 独立审查 round 6 复查报告

> **结论**：**未通过（2×P2 + 1×P3）**
> 被审 HEAD：`823f3dfb07faaef9d19fbdb2ee3f645ff5e0efbf`
> 基准提交：`45593a5522343c1ed56725f841b16760f80217b7`
> 本轮实际审查增量：`bb2e47d..823f3df` = 3 文件 / +71 −507（纯文档；主方案 769 → 315 行）
> 审查日期：2026-09-16

---

## 一、审查基本信息与通过项简述（≤10 行）

- 版本核验：分支 `main` 已配置上游 `origin/main`、工作区干净、`git pull --ff-only` 返回 `Already up to date`；实际 HEAD `823f3dfb07faaef9d19fbdb2ee3f645ff5e0efbf` 与任务给定待审 SHA **完全一致**；本轮 diff 仅含 `STATUS.md`、`docs/handoff/INDEX.md` 与 6 份 `.md`（无产品代码/测试改动）。
- 通过项（极简）：Round 5 的 5 项缺陷中 **4 项实测闭环** —— P2-1 结构（`awk '/^#/'` 得 H1、`## 1.`~`#### 3.1.2` 各 1 次、章节严格单调、§3.1.2 表 11 行全部以 `|` 闭合）；P2-3 出网点（`server/proxyRoutes.js:10/13`、`server/klineService.js:40` 已入清单，本轮逐主机实测 `push2his`/`90.push2his`/`1.push2`/`push2` 不可达、`push2delay` 的 `qt`/`trends2`/`kline` 三端点全部 `rc=0`）；P3-1 契约 `$` 锚点（按 §3.1.2 行 4 文本逐字实现后，§3.1.1 NOTE 的 10 条断言 **10/10 PASS**，含 `unknown_foo → 'stock_cn'`，且与 `STATUS.md:16` 描述逐字一致）；P3-2 根数表述（全篇仅 `:59` 一处权威表述，`16:18 实测 trends2 964 / kline 963` 与本轮 16:35 实测 976/975 按 HKFE 分钟增量自洽）。
- 另核验：§3.1.1 既有导出断言块（`instrument.js`/`parser.js`）**9/9 PASS**；`m:104`/`m:134`/`m:101`/`m:102` 四品种 `qt` 字段逐位复测成立；§3.4 的 A50 昨结 1:1 断言本轮成立（`142710 × 0.1 = 14271` == `trends2.preClose` == 新浪 `hf_CHA50CFD` 字段 7 `14271.000`）。
- 独立设计并执行 4 组探针（端点单位比值、契约全值域、`parseEastmoney` 实跑、**部分修复数值模拟**），其中 3 组命中新缺陷（见第二节）。

---

## 二、审查发现与缺陷清单

### P2-1 §3.1.2 行 5 的单位归一化只枚举 3 个字段 → `GL_A50` 的开盘/最高/最低仍相差 10 倍，`openChangePercent` 由 `-0.03%` 变为 `-90.00%`

- **严重级别**：P2
- **文件与行号**：
  - 缺陷文本：`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:164`（§3.1.2 表第 5 行 `/ **端点报价单位归一化**：识别 GL_A50（104.CN00Y）将 f43/f60/f169 价格字段除以 10（归一化为点数）…/`）
  - 相关契约：同文件 `:107`（§3.1.1 表列名即「**端点**报价单位 (东财qt:东财trends:新浪)」，A50 行登记 `0.1点 : 1点 : 1点`）、`:62-64`（§2.1 端点单位实测）、`:301-303`（§5 新增断言）
  - 代码落点：`src/js/parser.js:99`（`open = div100(d.f46)`）、`:114`（`high = div100(d.f44)`）、`:115`（`low = div100(d.f45)`）
- **触发条件**：按 `:164` 字面实施 —— 仅把 `f43/f60/f169` 除以 10，`f44/f45/f46` 沿用既有 A 股 `div100`。
- **实际行为与期望行为**：以真源同时刻数据模拟（`qt/stock/get?secid=104.CN00Y`，`push2delay`，2026-09-16 16:35：`f43=143650 f44=144180 f45=141980 f46=142670 f60=142710 f169=940 f170=66`）：

  | 字段 | 按 `:164` 部分修复 | 真值（新浪 `hf_CHA50CFD` / `trends2`） |
  |---|---|---|
  | price | 14365（正确） | 14365.0 |
  | prevClose | 14271（正确） | 14271.000 |
  | **open** | **1426.7** | 14267.000 |
  | **high** | **1441.8** | 14418.000 |
  | **low** | **1419.8** | 14198.000 |
  | **openChangePercent** | **−90.003%** | −0.028% |

  即「1/10 错位」只被消除了 `price/prevClose/change` 三个字段，`open/high/low` 仍为真值的 1/10，且因 `open` 与 `prevClose` 量纲不再一致，派生量 `openChangePercent` 由 ≈0 变成 ≈−90%。
- **根因**：单位契约的登记粒度与实施指令的枚举粒度不一致 —— `:107` 按「**端点**」登记「东财 qt = 0.1 点」（逻辑上覆盖该端点全部价格字段），而 `:164` 只枚举了 3 个字段；且 `:301-303` 的验收断言只覆盖 `price`/`prevClose`，使该缺口在方案自带的断言下不可见。
- **影响范围**：
  - `src/js/views/monitorTableView.js:131`（及增量更新 `:360`）`formatPriceWithPercent(q.open, q.openChangePercent)` → 自选/监控表「开盘」列对 A50 显示 `1,426.70 (-90.00%)`。
  - `src/js/controllers/momentumController.js:347` 用 `q.high` 参与最高价追踪（`Math.max(rawHigh, price, it.maxHigh)`）→ 外盘标的 `maxHigh` 恒被 `price` 覆盖，`pullbackPercent` 恒为 0。
  - §5 `:303` 断言（「断言 `parseEastmoney` 解析 `104.CN00Y` 输出的 `price` 与 `prevClose` 与 `trends2` 完全同级一致」）对该缺口零判别力。
- **复现方法/运行证据**：探针同时对真源取值并模拟「按 `:164` 字面实现」的解析结果，输出 `{"price":14365,"prevClose":14271,"open":1426.7,"high":1441.8,"low":1419.8,"openChangePercent":-90.0028…}`；对照完整归一化（`f43/f44/f45/f46/f60/f169` 统一 ÷10）输出 `{"open":14267,"high":14418,"low":14198,"openChangePercent":-0.0280…}`，与新浪字段 8/4/5 逐值相等。
- **修复建议**：把 `:164` 的枚举改为「A50 的 qt **全部价格字段**（`f43/f44/f45/f46/f60/f169`）以 `÷10`（**取代** A 股 `div100`）归一化为点数」；并在 §5 `:300-303` 的断言块补入 `open/high/low` 三字段与 `openChangePercent` 的同级一致性断言。
- **修复后验收标准**：实现后对 A50 单次真源取数满足 `open == sina.field8`、`high == sina.field4`、`low == sina.field5`、`price == sina.field0`（同刻容差 ≤ 0.2%）、`prevClose == sina.field7`（误差 0），且 `openChangePercent ≈ -0.03%`（|值| < 1%），自选表开盘列不再出现 −90% 量级数值。

### P2-2 §3.1.2 改造清单未覆盖 `parseEastmoney` 的 `code` 身份推导 → `GL_A50`/`GL_HSI` 的报价对象 `code` 为 `szcn00y`/`szhsi_m`，在消费入口被整体丢弃

- **严重级别**：P2
- **文件与行号**：
  - 缺陷文本：`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:164`（§3.1.2 行 5 仅规定单位归一化，未规定输出 `code`）、`:163`（§3.1.2 行 4 只改造输入侧 `normalizeCode`）、`:243`（§3.4「在消费入口…归一化后…保证最新价、涨跌幅与分时图末端价格 100% 吻合」「使得默认主源、分时图与备源在消费层全面 1:1 精确对接」）、`:303`（§5 断言只校验 `price`/`prevClose`，不含 `code`）
  - 代码落点：`src/js/parser.js:106-107`（`const rawCode = String(d.f57).toLowerCase(); const fullCode = normalizeCode(rawCode) || ((d.f107 === 1 ? 'sh' : 'sz') + rawCode);`）、`src/js/api.js:113-120`（`fetchEastmoneyOne` → `parseEastmoney(json)`，调用点持有 `code` 但未透传）、`src/js/controllers/monitorController.js:44`（`if (currentCodes.has(quote.code)) state.quotes.set(quote.code, quote)`）
- **触发条件**：按 §3.4.1/§2.1 让外盘期货实时报价走东财 `qt/stock/get?secid=104.CN00Y`、`134.HSI_M`（方案指定的第一数据源），并仅按 `:164` 实施单位归一化。
- **实际行为与期望行为**：以真源 payload 实跑仓库真实 `parseEastmoney`：
  - A50：`{"code":"szcn00y", "name":"A50期指当月连续", "price":1436.5, "prevClose":1427.1, …}` —— 期望 `code === "GL_A50"`；
  - HSI：`{"code":"szhsi_m", "name":"恒生指数期货主力", "price":246.88, …}` —— 期望 `code === "GL_HSI"`；
  - 佐证：`normalizeCode('CN00Y') === null`、`normalizeCode('HSI_M') === null`，故 `:107` 恒走 `('sz') + f57` 兜底分支。
- **根因**：改造清单把「东财报价解析」的目标限定为单位归一化，遗漏了**反向身份推导**（`(f107, f57)` → `globalCatalog` 的规范内部码 `GL_*`）；§5 新增断言同样只覆盖数值字段，无法拦截。方案在 `:97-108` 已具备 `GL_A50 ↔ 104.CN00Y`、`GL_HSI ↔ 134.HSI_M` 的注册表，但未与 `parseEastmoney` 的出口绑定。
- **影响范围**：
  - `monitorController.js:44` 的 `currentCodes.has(quote.code)` 门禁使该报价**永远不写入 `state.quotes`** → 图表侧 `chartRowController` 报价合并整段跳过、分时/K 线实时更新与语音播报均取不到 A50/HSI 报价，`§3.4:243` 的「100% 吻合 / 消费层全面 1:1 精确对接」在该增量下不可达；
  - `src/js/api.js:161-167` 的 `gotCodes`/`missingStocks|missingFutures` 判定恒为「缺」，每一轮刷新都会额外触发一次兜底请求。
- **复现方法/运行证据**：`node` 探针 `import` 仓库真实 `src/js/parser.js`，将真源 `qt/stock/get` 的两个 payload 原样喂入 `parseEastmoney({data: …})`，输出 `code` 分别为 `szcn00y` / `szhsi_m`；同探针输出 `normalizeCode('CN00Y')=null`、`normalizeCode('HSI_M')=null`，确认兜底分支被命中。
- **修复建议**：`§3.1.2` 行 5 的目标补为「识别 A50 后除以 10；**并按 `(f107, f57)` 反查 `globalCatalog` 输出规范内部码 `GL_*`（禁止 `('sz') + f57` 兜底）**」，同时把 `src/js/parser.js:106-107`（身份推导）列入改造点清单；`§5` 断言块补入 `assert.equal(parseEastmoney(a50Payload).code, 'GL_A50')` 与 `assert.equal(parseEastmoney(hsiPayload).code, 'GL_HSI')`。
- **修复后验收标准**：`parseEastmoney` 解析 `104.CN00Y` / `134.HSI_M` 的输出 `code` 分别为 `GL_A50` / `GL_HSI`，`name` 与注册表一致；`monitorController.getRefreshCodes()` 中的 `GL_A50` 能命中 `state.quotes`（端到端探针：`state.quotes.has('GL_A50') === true`）。

### P3-1 §2.1 字段 2/3 被改标为「买一量/卖一量」并改写示例值，与同段 payload 及真源矛盾（本轮新引入回归）

- **严重级别**：P3
- **文件与行号**：`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:37-38`（新文本 `2`: 买一量（9.940）/`3`: 卖一量（9.960））；对照同段 `:33` 的 payload `…99.940,99.960,100.610,99.360…`；相邻行 `:45` 已正确标注 `10, 11`: 买卖盘量
- **触发条件**：任何按 §2.1 字段表实现 `parseSinaGlobalFuture`（§3.1.2 行 `parser.js:129`）的读法。
- **实际行为与期望行为**：
  - 文档现写「`2`: 买一量（9.940）、`3`: 卖一量（9.960）」；但同段 payload 的第 2/3 位是 `99.940/99.960`，示例值 9.940/9.960 无任何来源可复现；
  - 真源取证（2026-09-16 16:4x，`hq.sinajs.cn` 带 Referer）：`hf_CL` 第 2/3 位 `99.980/99.990`，恰好夹住第 4 位最高 `100.610` / 第 5 位最低 `99.050`；`hf_CHA50CFD` 第 2 位 `14365.000` **等于同刻 `trends2` 末根收盘 `14365.0`**；真正的量在 `index10/11`（`hf_CL` = `2/7`、`hf_CHA50CFD` = `90/3`）。故 2/3 为**买一价/卖一价**。
  - 该行为**本轮新引入**：`git show bb2e47d:<doc> | sed -n '37,38p'` 为 `2`: 买一（99.940）/`3`: 卖一（99.960）（正确），Round 5 报告的两项 P3 均未要求改动此处。
- **根因**：本轮重写 §2.1 时未回真源逐位复核，把唯一的价格档位错误改标为量纲，并把示例值改写为不可复现值；同时与同段 `:37` 自身剩余的价格字段（`:36` 买价）语义不连贯。
- **影响范围**：该字段表是 `parseSinaGlobalFuture` 的字段契约与「字段完整性」论证依据；按字面实现会把买卖价当作量纲使用。仓库现有消费方不读取该两字段（`src/js/parser.js:131-208` 的 `parseSinaFuture` 未使用 index 2/3），故用户可见影响有限，属非阻塞健壮性问题。
- **复现方法/运行证据**：单次真源取数打印逐位索引（`0:100.030 | 1: | 2:99.980 | 3:99.990 | 4:100.610 | 5:99.050 | … | 10:2 | 11:7`）；`hf_CHA50CFD` 第 2 位与同刻 `trends2` 末根同值可判别。
- **修复建议**：把 `:37-38` 回改为「`2`: 买一价（99.940）」「`3`: 卖一价（99.960）」，与 `:33` payload 逐位对齐。
- **修复后验收标准**：文档字段 2/3 的标签与示例值均可由 `hq.sinajs.cn/list=hf_CL` 的单次响应逐位复现。

---

## 三、待确认风险与未验证项

1. **待确认风险（低置信度，建议但未定级）**：§3.1.2 行 3（`:162`）把浏览器代理出网的改造落点写成 `server/proxyRoutes.js:10, 13` 与 `server/klineService.js:40`，但该两处只是**静态 target 常量**；`resolveProxyTarget`（`server/proxyRoutes.js:22-35`）返回单一 `target.url`，真正的出网调用与重试循环在 `server/proxyService.js:10/31`。若按清单只改常量而不改 `resolveProxyTarget` 的返回形态与 `proxyService` 的 fetch 循环，会得到「换了 host 但没有轮转/兜底」。怀疑依据：代码结构如上（`proxyService.js` 全仓唯一的 `fetchWithTimeout(target.url, …)` 在此）。建议在清单中显式补列 `server/proxyService.js`（及 `resolveProxyTarget`）。
2. **未验证项**：① 「可通过本地代理或 hosts 模拟」的受限环境断言（§5 `:305`）未实跑 —— 本机 `push2his`/`90.push2his`/`1.push2`/`push2` 本就不可达、`push2delay` 三端点全部 `rc=0`，无法在同一出口复现「先失败后轮转」的转移过程；残余风险：轮转实现后未验证失败切换的时序与超时预算。② §5 `:301` 的 0.2% 容差与 `:302` 的「误差恒为 0」本轮采样成立（`143650 × 0.1 = 14365.0` 对 `trends2` 末根 `14365.0`；`142710 × 0.1 = 14271` 对 `preClose` `14271` 与新浪字段 7 `14271.000`），但未做跨时段（结算窗口前后）复采。

---

## 四、推荐修复顺序与复审验收标准

**推荐修复顺序**：P2-2（身份推导，影响面最大：报价对象在消费入口被整体丢弃）→ P2-1（字段枚举，用户可见数值错位）→ P3-1（字段标签回改）→ 待确认风险 1 的清单补列。

**复审验收标准**：
1. §3.1.2 行 5 的改造目标同时覆盖「A50 全部 qt 价格字段 ÷10」与「按 `(f107, f57)` 输出规范内部码 `GL_*`」，并把 `src/js/parser.js:106-107` 列入清单；
2. §5 断言块覆盖 `open/high/low/openChangePercent` 与 `code` 身份，且这些断言在**缺陷存续时必定失败**（可变异验证：把 `÷10` 仅施加于 `f43/f60/f169`、或把 `code` 改回 `('sz') + f57`，对应用例必须转红）；
3. §2.1 字段 2/3 与真源逐位一致；
4. 探针复跑：A50 的 `price/prevClose/open/high/low` 与新浪字段 `0/7/8/4/5` 同刻同级一致、`openChangePercent` 为 0 附近，`parseEastmoney` 输出的 `code` 为 `GL_A50`/`GL_HSI`。

**附带（非阻塞）建议**：`:15` 本轮把引用由 `§3.2 与 §12.1` 改为 `§1.2 与 §12.1`。经核 `docs/plans/2026-09-03-futures-requirements-technical-plan.md`：`### 3.2 本方案不包含`（第 52 行）才含「外盘期货、外汇、数字货币」，而 `## 1. 背景与现状` 无子节（不存在 §1.2）；`§12.1 已确定` 含「不在本轮实现期权、外盘和下单」。属历史边界叙述中的引用细节，未按缺陷定级，建议顺手改回 `§3.2`。

**审查通过条件**：上述 3 项缺陷 100% 修复闭环 + 待确认风险 1 明确处置 + 未验证项列明，方可判定通过。
