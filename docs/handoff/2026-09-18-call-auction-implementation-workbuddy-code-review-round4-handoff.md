# WorkBuddy 独立代码审查 Round 4 Handoff — 集合竞价日K下影线消除 / 分时图纳入 / 语音时段去重（修复轮复查 3）

## 一、审查基本信息与通过项简述

- 被审 HEAD：`2b9af28b642a5d85b08ce262b1cf50142397b92f`（`main` 与 `origin/main` 同步，`git pull --ff-only` → already up to date，工作区干净）；基准 `7c955b0cbcdba12adff9b42b5b159fe7c9663823`；任务书范围 `7c955b0..2b9af28` = 13 文件 / +1401 −27，本轮修复提交自身 `a0794db..2b9af28` = `src/js/kline.js` +78、`tests/callAuction.test.js` +174（2 文件 / +241 −11）。仓库内无 `docs/review-checklist.md`。
- 门禁实跑复核：`npm test` **898/898 全绿**（较 Round 3 的 895 新增 `5.1(1h)`/`5.1(1i)`/`5.1(1j)`）、`npx eslint` 0 问题；另在仓库外 pristine 导出上重复 8 次全量运行，均 898/0。
- **通过项（极简）**：Round 3 两项 P2 的**主形态**已真闭环——滞后快照「仅带 open 不带走价」「仅走价不带 open」「延续过 09:30」三形态均保持 `preview`（实测 + 定点变异 M1/M2/M5 确定性转红），M_A 型「零判别力」缺口已由新增 `updateTime` 时效通道与 `5.1(1j)` 堵上。需求 2/3 相关文件本轮未改动（`chart.js`/`marketSession.js`/`voiceController.js` 不在 `a0794db..2b9af28`），本轮实测沿用：A 股 09:18 竞价点走 253 固定网格且 6/6 可见，港股/美股/国际期货/国内期货均数据驱动轴全量可见（轴长 == 点数、可见 == 点数），非 A 股极值不失真（`103/98` 完整保留）。
- 独立验证：仓库外 pristine 导出（`git archive 2b9af28` + 软链 `node_modules`）上完成 **12 点定点变异矩阵**（M1~M12）+ **5 组探针序列**（形态 A/B/C/D/E）；其中 **4 个变异存活**、**3 条反例序列命中**（含一条在基准 `7c955b0` 上回放判定的「残留缺口而非新回归」）→ 本轮发现 **2×P2 + 2×P3**，判定**未通过**。
- 命名说明：模板要求的 `docs/handoff/2026-09-18-workbuddy-code-review-round4-handoff.md` 归属同日「集合竞价方案设计」系列（该系列 `round1/2/3` 均为纯方案审查），沿用前两轮口径采用任务前缀名。

---

## 二、审查发现与缺陷清单

### P2-1 追加分支在报价无时间戳时**不存在任何盘前时效判据** → 09:25:00-09:29:59 到达的盘前滞后快照直接落成非 `preview` 官方柱，虚拟价被写死进当日 `low` 并锁死全天

- **严重级别**：P2
- **文件与行号**：`src/js/kline.js:576-610`（追加分支），判据在 `:578-581`（`isAStock` → `quoteTimeMinutes` → `isQuotePreOpen` → `:581 if (isQuotePreOpen)`），柱构造在 `:596-609`；时效解析 `:456-482`（`getQuoteBeijingTimeMinutes`，`updateTime`/`time` 均缺失时 `return null`）。
- **触发条件**（全部为代码可见路径，无需新增假设）：
  1. A 股 + `period === '1d'` + `isAStock === true`；
  2. `items` 末柱为**上一交易日**（今日柱尚未入库 —— 即需求 1 自述的「用户在 09:15-09:25 期间打开日K / 切页 / 切标的」场景，`chartRowController.js:386-399` 在 `fetchKline` 后用 `applyLiveQuoteToKline` 合并快照）；
  3. 到达一拍的北京时间处于 **09:25:00-09:29:59**（此后 `min < 9*60+25` 的盘前块 `:509` 已被跳过，无任何时钟侧兜底）；
  4. 该拍为**上游滞后快照**（仍是盘前 payload），且**报价对象无 `updateTime` 也无 `time`**。
- **可达性（第 4 条的取值来源，均为实测/代码可见）**：
  - `parseEastmoney` 返回对象**完全不含** `updateTime`/`time`/`quoteDate`/`date`（实测键集 = `code,name,price,prevClose,open,high,low,volume,amount,volumeRatio,openChangePercent,change,changePercent,priceDecimals,currency,type,source`）；
  - `api.js:200-228` 的 A 股报价在 Tencent 未返回该 code 或整批失败时**逐码回落到 Eastmoney**（`fetchEastmoneyOne → parseEastmoney`），失败码经 `monitorController.js:37-49` 原样 `state.quotes.set(quote.code, quote)`，不含时间戳；
  - 即使走 Tencent，`parser.js:207-213` 仅在字段 30 命中 `^\d{14}$` 或 `^\d{4}[/-]\d{2}[/-]\d{2}\s+\d{2}:\d{2}:\d{2}$` 时赋值，否则 `updateTime = ''` → `getQuoteBeijingTimeMinutes` 返回 `null`（实测 `''` → `null`）；
  - 且本轮新增用例 `5.1(1g)`/`5.1(1h)`/`5.1(1i)` **本身全部使用不含 `updateTime` 的报价对象**，即实现方亦把「无时间戳」视为常态报价形态。
- **实际行为（真实模块 `applyLiveQuoteToKline` 实跑；真实开盘与全天最低均为 20.50，盘前最后一拍虚拟价 19.60）**：

  ```
  09:25:05  q={price:19.6, open:0,   volume:0}     -> 19.6 / 19.6 / 19.6 / 19.6   preview=false   ← 直接落成"官方柱"
  09:25:35  q={price:20.5, open:20.5, volume:8000} -> 20.5 / 20.5 / 19.6 / 20.5   preview=false
  14:55:00  q={price:21.3, open:20.5, volume:9e5}   -> 20.5 / 21.3 / 19.6 / 21.3   preview=false   ← low 全天 19.60
  ```
  注意：`open: 0` 是**有效输入**——`:596` 的 `open = quoteOpen || price` 会把 `open` 兜底为虚拟价，因此本形态**不依赖**「盘前 `open` 非零」这一未验证前提；`preview` 从未被写入，后续任何 tick 都不具备重基线的机会，`low = min(19.6, 真实价)` 由 `:669` 单调锁死，直到图表重载。
- **期望行为**（任务书验收标准 1「日K集合竞价下影线彻底消除」）：09:25:00 起当日柱 `high/low` 只能由真实成交价驱动，盘前虚拟价不得进入任何价格字段；`items` 末柱为昨日时，若无法证明该拍已过 09:25（无时间戳即为无法证明），应落成 `preview` 柱或直接丢弃，绝不可落成无标记的「官方柱」。
- **根因**：`getQuoteBeijingTimeMinutes` 返回 `null`（**未知时效**）时，`:580` 的 `isQuotePreOpen` 立即为 `false`，即把「未知」当作「非盘前」处理（fail-open）。`null` 是唯一可靠时效通道缺失的信号，却被判为"新鲜"。原 `min < 9*60+25` 的时钟块只在 09:25 前提供兜底，09:25-09:30 的窗口在无时间戳时完全裸奔。
- **影响范围**：A 股 `1d` 当日 `low` 被盘前虚拟价写死并持续整个交易日（官方K 仅在展开图表/切周期/强制刷新时重载，`app.js:1307/1314/1284`，全仓无周期重载）。仅 A 股 `1d`；非 A 股与分钟周期不受影响（`isAStock` 门禁）。
- **是否本轮新引入**：**否**。以基准 `7c955b0` 回放同一序列得 `20.5 / 21.3 / 19.6 / 21.3`，与 HEAD 逐字段相同 → 属本轮修复**未覆盖的残留缺口**，而非新回归；但本轮修复的自述目标与 Round 3 复审验收标准（「09:25 起任意 tick 后日K `low` 恒为 20.50」）均要求该路径必须闭环。
- **复现方法 / 运行证据**：仓库外探针 `probe2.mjs` 的 `== D ==` 段（真实 `applyLiveQuoteToKline(items, quote, '1d', 'sh603533', new Date('2026-09-18T09:25:05+08:00'))` 逐拍调用）；基准回放见同目录 `base/` 导出（`git archive 7c955b0`）。
- **修复建议**：把「时效未知」与「时效非盘前」分开处理，禁止 fail-open：
  ```javascript
  const quoteTimeMinutes = getQuoteBeijingTimeMinutes(quote);
  const isQuotePreOpen = quoteTimeMinutes !== null && quoteTimeMinutes < 9 * 60 + 25;
  const isQuoteTimeUnknown = quoteTimeMinutes === null;
  // 追加分支：时效未知时同样不得落成无标记官方柱
  if (isQuotePreOpen || isQuoteTimeUnknown) { /* 落 preview 柱（保持现有 preview 语义）*/ }
  ```
  若担心「无时间戳」在 A 股实盘会导致 preview 长期滞留，应补一条**可从本地状态判定**的升级通道（官方日K重载、或"连续 N 拍 `price` 离开 `preview` 价且 `volume>0`"），而不是默认放行。
- **修复后验收标准**：① `items` 末柱为昨日 + 09:25:05 无时间戳滞后快照（`open: 0`）时，末柱必须带 `preview: true`（或该拍被丢弃），且 09:25:35 真实快照到达后全天 `low === 20.50`；② 新增该序列用例，且对「把 `isQuoteTimeUnknown` 分支改回放行」的定点变异确定性转红；③ `5.1(1a~1j)` 既有断言不回归。

---

### P2-2 原地 `preview` 分支的兜底判据仍建立在**内容特征**上，且 `quoteTimeMinutes === null` 被当作「非盘前」→ 滞后快照同步推进时误清除、同价掩盖时误滞留并丢弃真实极值

- **严重级别**：P2
- **文件与行号**：`src/js/kline.js:630-664`；时效与内容判据 `:631-642`（`:631` 取时间戳、`:632` `isQuotePreOpen`、`:634-637` `hasValidOpen/hasPriceShift/hasOpenShift/hasSubstantialShift`、`:639-642` `hasOfficialTradeEvidence`）；清除/重基线 `:644-650`（`delete updated.preview`、`high = max(open, price)`、`low = min(open, price)`）；滞留分支 `:651-663`（`:654-657` 四价全部改写为 `price`、`:658-659` `volume/amount` 归零）。
- **触发条件**：A 股 + `period === '1d'` + 已存在盘前 `preview` 柱（`items` 末柱 `preview: true`）+ 该拍报价**无 `updateTime` 也无 `time`**（`quoteTimeMinutes === null`，来源同 P2-1）：
  1. **形态 A（同步推进）**：09:25:00 之后到达的滞后快照**同时**推进了 `price` 与虚拟 `open`（盘前虚拟撮合价与虚拟开盘参考价本就同步变动；本轮 `5.1(1g)`/`5.1(1j)` 均以 `open === price` 建模）→ `hasPriceShift` 与 `hasOpenShift` 同时为真 → `hasSubstantialShift` 为真 → 被判「已切换为官方成交」；
  2. **形态 C（同价掩盖）**：真实开盘价 == 最后一拍盘前虚拟参考价（撮合收敛的常态）→ 首拍真实快照 `price === open === last.close`，`hasSubstantialShift` 为假，而 `:641` 的成交量分支又硬性要求 `quoteTimeMinutes !== null` → 依然为假 → `preview` 滞留，期间四价被逐拍改写为 `price`、`volume/amount` 被强制归零。
- **实际行为（真实模块实跑；真实开盘 20.50、盘中最低 20.30、盘终 21.30）**：

  ```
  形态 A（真实开盘/全天最低 20.50，盘前最后一拍 19.60）
    09:24:50 q={price:19.6,open:19.6} -> 19.6/19.6/19.6/19.6 preview=true
    09:25:02 q={price:19.9,open:19.9} -> 19.9/19.9/19.9/19.9 preview=false   ← 误判"新鲜"，重基线到虚拟价
    09:25:32 q={price:20.5,open:20.5} -> 20.5/20.5/19.9/20.5 preview=false
    14:55:00 q={price:21.3,open:20.5} -> 20.5/21.3/19.9/21.3                 ← low 全天 19.90

  形态 C（真实最低 20.30，收盘 21.30）
    09:24:50 q={price:20.5,open:20.5} -> 20.5/20.5/20.5/20.5 preview=true
    09:25:05 q={price:20.5,open:20.5,volume:6000} -> 20.5/20.5/20.5/20.5 vol=0  preview=true  ← 真实成交被判为盘前
    09:26:00 q={price:20.3,open:20.5,volume:20000}-> 20.3/20.3/20.3/20.3 vol=0  preview=true  ← 真实低点只暂存于此
    09:27:00 q={price:20.6,open:20.5,volume:40000}-> 20.5/20.6/20.5/20.6 vol=40000 preview=false ← 重基线丢弃 20.30
    14:55:00 q={price:21.3,open:20.5}            -> 20.5/21.3/20.5/21.3                 ← 全天 low 20.50（真实 20.30）
  ```

  同一序列在报价**带** `updateTime`（Tencent 形态，同本轮 `5.1(1j)`）下表现正确（`low` 恒为 20.50）——即差异完全由时效通道缺失造成。
- **期望行为**：`preview` 的清除只能由**可比的时效证据**（快照自带时间戳 ≥ 09:25:00）或**已重载的官方日K**触发，不得由内容特征触发；在 `preview` 滞留期间，当日柱应作为「已确认真实观测的运行包络」累计（`high = max(prev, price)`、`low = min(prev, price)`、`volume/amount` 取报价的日累计值），而不是把四价压成当前 `price` 并在重基线时丢弃包络。
- **根因**：Round 3 复审建议 ①（以时效为判据）与建议 ②（以实质换挡为判据）被**同时实现为析取**，`updateTime` 缺失时自动退化为建议 ②；而建议 ② 在本轮 Round 3 报告中已被判定为「对上游时效的代理判据，而非时效判据本身」。同时 `:641` 的 `quoteTimeMinutes !== null` 使成交量这一**最有信息量的真实成交证据**在无时间戳时被整体废掉；`:654-659` 的四价坍缩 + 清零使滞留期间的观测值不可恢复。
- **影响范围**：形态 A → 与 Round 1 P1-1/Round 3 P2-1 完全同形，虚假下影线锁死全天（0.60 元）；形态 C → 开盘数拍内的真实极值被永久丢弃、期间 `volume` 显示 0（当日柱区间偏窄、量能缺失），持续到图表重载。均仅 A 股 `1d`。
- **是否本轮新引入**：**是**。`getQuoteBeijingTimeMinutes`、`hasOfficialTradeEvidence` 与 `:651-663` 的滞留分支均为 `2b9af28` 新增；Round 3 时该判据为 `(min < 9*60+30) && !quoteOpen && price === last.close`，形态 A 在旧判据下亦不成立（旧判据要求 `!quoteOpen`），故形态 A 是**本轮新判据引入的新回归**。
- **复现方法 / 运行证据**：仓库外探针 `probe1.mjs` 的 `== A ==`（形态 A）与 `== C ==`（形态 C）段，逐拍调用真实 `applyLiveQuoteToKline`；对照段 `== B ==` 为同序列的 Tencent 形态（`updateTime` 齐备），输出正确。
- **修复建议**：
  1. 取消 `hasSubstantialShift` 对 `preview` 清除的授权，改为 `hasOfficialTradeEvidence = quoteTimeMinutes !== null && quoteTimeMinutes >= 9 * 60 + 25`（时效未知则保持 `preview`）；
  2. 若必须保留内容兜底，则需同时满足「无歧义的真实成交证据」：`quoteVolume > 0 || quoteAmount > 0` **且** `price` 走出 `preview` 价 **且** `quoteOpen` 走出 `preview` 价（现 `:641` 的 `quoteTimeMinutes !== null` 前置应删除，替换为上述合取）；
  3. 滞留分支（`:651-663`）改为**包络累计**：`updated.high = Math.max(_positiveNumber(last.high) || price, price)`、`updated.low = Math.min(_positiveNumber(last.low) || price, price)`，`volume/amount` 取 `quoteVolume || last.volume`，仅在**确认仍在盘前**时保留四价坍缩语义（盘前语义可由 `quoteTimeMinutes !== null && < 09:25` 唯一界定）；
  4. 清除 `preview` 时的重基线改为 `low = Math.min(open, price, 已观测 low 包络)`。
- **修复后验收标准**：① 形态 A（09:25:02 滞后快照 `price:19.9/open:19.9`）保持 `preview: true`，14:55 日K `low === 20.50`；② 形态 C 在 09:27 重基线后 `low === 20.30`，且 09:25:05-09:26:59 期间 `volume === 6000/20000`（非 0）；③ 对「删除 `quoteTimeMinutes !== null` 前置」与「把 `hasSubstantialShift` 重新纳入清除授权」两类变异各至少 1 条断言确定性转红；④ `5.1(1a~1j)` 与「盘前四价坍缩于 `price`」的既有断言不回归。

---

### P3-1 A 股日K在连续交易时段丢弃官方 `quote.high`/`quote.low` → 轮询间隙形成的日内极值不可恢复，且无周期官方K重载兜底

- **严重级别**：P3
- **文件与行号**：`src/js/kline.js:665-671`（A 股 `else` 分支，仅 `Math.max(last.high, price)` / `Math.min(last.low, price)`，`updated.open = quoteOpen` 但不含 `quote.low`）；对照 `:678-682`（非 A 股路径同时吸收 `quoteHigh`/`quoteLow`）；追加分支同形 `:596-598`。相关断言：`tests/app.test.js:780-790`、`tests/callAuction.test.js:201-222`（`5.1(1d)` 14:00 断言 `low === 9` 而报价 `low === 8.8`）。
- **触发条件**：A 股 `1d` 任意盘中时刻，报价携带交易所口径的当日 `high`/`low`，而该极值形成于两次轮询之间（默认 `refreshInterval` 10s，`app.js:156/315`）。
- **实际行为（真实模块实跑）**：

  ```
  A 股 sh603533   09:31 q={price:20.5,open:20.5,high:20.5,low:20.5} -> 20.5/20.5/20.5/20.5
                  10:00 q={price:21.0,open:20.5,high:22.5,low:19.0} -> 20.5/21 /20.5 /21     ← 官方 22.5/19.0 被丢弃
  港股 hk00700（同输入对照）                                        -> 20.5/22.5/19.0/21    ← 官方极值被吸收
  ```
  官方日K 仅在展开图表/切周期/强制刷新时重载（`app.js:1284/1307/1314`，全仓无周期重载），故该偏差持续到用户手动重载。
- **期望行为**：任务书验收标准 1 只要求消除**集合竞价**虚拟极值（盘前守卫已达成该目标）；连续交易时段的官方 `quote.high/low` 属交易所权威口径，应继续参与 `Math.max`/`Math.min`（盘前守卫应只作用于 09:25 前）。
- **根因**：Round 1 P2-2 的修复把「盘前不得吸收外部虚拟极值」实现为 `isAStock` 的**全时段**分支（`:665-671` 无时钟条件），范围超出需求；`tests/app.test.js` 与 `5.1(1d)` 的断言随之固化了该损失。
- **影响范围**：A 股日K在两次重载之间的 `high/low` 偏窄（差距 = 轮询间隙内的极值幅度）。影响有限、有明确规避方案（强制刷新），故定 P3。**是否本轮新引入**：否（`d3f415b` 引入，`a0794db..2b9af28` 未改动该段）；历轮矩阵亦未覆盖。
- **复现方法 / 运行证据**：仓库外探针 `probe2.mjs` 的 `== E ==`（A 股）与 `== E2 ==`（`hk00700` 对照）段；基准 `7c955b0` 回放同输入得 `10.2/12.5/8.8/12`（吸收官方极值），HEAD 得 `10.2/12/9/12`。
- **修复建议**：把 A 股 `1d` 的极值吸收改为**按时效门禁**：`preview` 未清除（即盘前或无法证明已过 09:25）时保持现有收敛/包络语义；`preview` 已清除且时钟 ≥ 09:25 时恢复 `high = Math.max(lastHigh, quoteHigh, price)`、`low = Math.min(lastLow, quoteLow, price)`。
- **修复后验收标准**：① A 股 14:00 报价 `high:12.5/low:8.8` 时末柱 `high === 12.5 && low === 8.8`；② 盘前（09:18）报价携带脏 `high/low` 时仍收敛于 `price`（`5.1(1d)` 前半段、`5.1(2)` 不回归）；③ 对「恢复 `quoteHigh/quoteLow` 但删除时效门禁」的变异确定性转红。

---

### P3-2 本轮新增判据的合取项与追加分支时效门**零判别力**（4 个变异存活），且需求 2 的实时分时竞价窗口无判别力 → 验收标准 4「测试与变异矩阵全覆盖」未达成

- **严重级别**：P3
- **文件与行号**：`src/js/kline.js:634-637`（`hasPriceShift`/`hasOpenShift`）、`:658-659`（滞留期 `volume/amount` 归零）、`:578-581`（追加分支时效门）、`:694-701`（`_isTradingMinute` 的 09:15-09:25 窗口）；对应用例 `tests/callAuction.test.js:595-810`（`5.1(1g~1j)`）。
- **触发条件**：运行全量门禁即成立（非偶发）。
- **实际行为（仓库外 pristine 导出 + 12 点定点变异矩阵实跑）**：

  | 变异 | 目标 | 结果 |
  |---|---|---|
  | **M3** `hasSubstantialShift` 删除 `hasPriceShift` | `kline.js:637` | **898 pass / 0 fail → 存活** |
  | **M4** `hasSubstantialShift` 删除 `hasOpenShift` | `kline.js:637` | **898 pass / 0 fail → 存活** |
  | **M8** 滞留分支不再把 `volume/amount` 归零 | `kline.js:658-659` | **898 pass / 0 fail → 存活** |
  | **M11** 追加分支时效门 09:25 → 09:30 | `kline.js:580` | **898 pass / 0 fail → 存活** |
  | **M10** `_isTradingMinute` 删除 09:15-09:25 竞价窗口 | `kline.js:697` | **898 pass / 0 fail → 存活** |
  | M1 `evidence = !isQuotePreOpen` | `kline.js:639-642` | RED（`5.1(1g/1h/1i/1j)`） ✅ |
  | M2 删除 `!isQuotePreOpen` | `kline.js:639` | RED（`5.1(1g)`） ✅ |
  | M5 `isQuotePreOpen` 门限 09:25 → 09:30 | `kline.js:632` | RED（`5.1(1j)`） ✅ |
  | M6 时效通道恒 `null`（等价于 Eastmoney 报价） | `kline.js:456-458` | RED（`5.1(1j)`） ✅ |
  | M7 滞留分支改为恒重基线 | `kline.js:644` | RED（`5.1(1g/1h/1i)`） ✅ |
  | M9 `_correctLastIntradayPoint` 09:25 防抖窗口删除 | `kline.js:713-719` | RED（`5.1(5)`） ✅ |
  | M12 `_positiveNumber` 去掉 `n > 0` 下界 | `kline.js:453` | 存活（负值无输入源，等价变异体） |

- **期望行为**：Round 3 复审验收标准要求「删除/弱化新判据后至少 1 条断言确定性转红」「M_D/M_E/M_F/M_G/M_I 覆盖力不回归」，任务书验收标准 4 要求「测试与变异矩阵全覆盖」。M3/M4 存活说明 P2-2 的形态 A（两合取项**同时**成立）在用例集中完全缺失——`5.1(1g)` 两值同步不变、`5.1(1h)` 只有价格走、`5.1(1j)` 由时效通道兜住，三者都绕开了该合取组合；M11 存活说明追加分支的时效门（P2-1 的落点）无用例；M8 存活说明滞留期 `volume/amount` 归零的契约未固化；M10 存活说明需求 2「分时图纳入 09:15-09:25」的**实时 tick 路径**（`applyLiveQuoteToIntraday` 在 09:15-09:25 追加竞价分钟点）无任何判别用例——现有 `5.1(4a)` 只验证轴网格，竞价点由 `setData` 直接注入，不经 `_isTradingMinute`。
- **根因**：新增用例仍以「单点形态」为构造单位（一次只变动一个特征），未构造实现所依赖的**特征组合**；追加分支与实时分时路径沿用旧用例集合，未随本轮判据改写同步扩充。
- **影响范围**：即使 P2-1/P2-2 所述缺陷真实发生，898 项门禁仍全绿——「实现缺失仍全绿」的盲区在本轮新增守卫上依旧存在（与 Round 1 P2-1、Round 3 P2-2 同族）。
- **复现方法 / 运行证据**：仓库外 `mutate.mjs`（`git archive 2b9af28` 导出 + 软链 `node_modules`，逐变异跑 `scripts/run-tests.mjs` 并还原），上表为实跑输出；`probe1.mjs == A ==` 提供了 M3/M4 组合形态的具体输入。
- **修复建议**：① 新增用例「09:25:02 滞后快照 `price` 与虚拟 `open` 同步推进」（即 P2-2 形态 A）与「`items` 末柱为昨日 + 09:25:05 无时间戳滞后快照」（即 P2-1 形态 D），并对 M3/M4/M11 做定点变异杀红；② 新增「滞留期 `volume/amount` 为 0」断言（杀 M8）；③ 新增 `applyLiveQuoteToIntraday(items, quote, 09:18, false)` 的竞价窗口追加断言（杀 M10），并补一条 09:15/09:25 边界（`minutes === 9*60+25` 含端点）用例。
- **修复后验收标准**：M3/M4/M8/M10/M11 各自在实跑中**确定性转红**；M1/M2/M5/M6/M7/M9 杀红力不回归；`npm test` 全绿（含新增断言）。

---

## 三、待确认风险与未验证项

1. **上游盘前 A 股 `open` 是否非零、且是否随虚拟参考价同步推进（P2-2 形态 A 的唯一前提）**：离线无活体快照。若可提供 09:24:5x 与 09:25:0x 两拍真实 payload（含 `open`/`high`/`low`/`updateTime`），即可确证或排除形态 A。**注意形态 C（P2-2）与形态 D（P2-1）均不依赖该前提**（C 只要求"官方开盘价 == 最后一拍虚拟参考价"这一撮合收敛常态；D 以 `open: 0` 构造）。
2. **上游时效：09:25:00 之后是否仍返回盘前 payload、持续多久（P2-1/P2-2 三形态的共同前提，继承 Round 2/3）**：本环境无法离线证实；前提一旦成立，三条反例 100% 复现。需 09:24:5x 与 09:25:0x 两拍真实样本。
3. **上游 09:26-09:29 分时点与 253 固定网格缺槽（继承 Round 1-3）**：`chinaStockStrategy.getIntradaySessionRanges()` 仍放行 09:26-09:29，而网格无对应槽位，该窗口点会进入 `arr`/`byTime` 却不落在 `displayTimes` 上。无网络样本，无法判定上游是否实际返回。
4. **港美外盘分时零回归依赖「客户端 `_isTradingSessionTime` + 服务端 `intradayService.js` 双侧过滤完整」这一前提（继承）**：本轮未改动相关代码，实测 253/6/5/4 与全量可见性均符合预期。
5. **首次冷启动全量运行出现 1 例失败（898 中 1，未记录用例名），随后连续 8 次运行均 898/0，无法复现**：可能为冷启动/资源竞争的偶发 flake，也可能是被后续运行掩盖的真实 flake。建议在 CI 上以「失败即保留完整日志」的方式观察 3-5 次，以定位该用例名。

---

## 四、推荐修复顺序与复审验收标准

**推荐修复顺序**：

1. **P2-2 形态 A**（`kline.js:639-642` 的 `hasSubstantialShift` 授权 + `:651-663` 包络累计）——与验收标准 1「彻底消除」直接冲突，且为本轮新判据引入的新回归，先修。
2. **P2-1**（`kline.js:578-581` 追加分支的时效未知分支）——同一根因（`null` fail-open），与 P2-2 同批定稿。
3. **P2-2 形态 C**（滞留期包络与量能语义）——决定开盘数拍的真实极值是否可保留。
4. **P3-2**（用例与变异矩阵补齐，含 M3/M4/M8/M10/M11 杀红）。
5. **P3-1**（A 股连续时段恢复官方 `quote.high/low`，需保留盘前时效门禁）。

**复审验收标准**（下一轮需逐条提供可复现证据）：

- 形态 A：09:25:02 滞后快照（`price:19.9`、虚拟 `open:19.9`、无 `updateTime`）保持 `preview: true`；14:55 日K `low === 20.50`（不得出现 19.60/19.80/19.90）。
- 形态 C：真实最低 20.30 的序列在 09:27 重基线后 `low === 20.30`；09:25:05-09:26:59 期间 `volume/amount` 取报价日累计值（非 0）。
- 形态 D：`items` 末柱为昨日 + 09:25:05 无时间戳滞后快照（`open: 0`）时末柱带 `preview` 或被丢弃；后续真实快照到达后全天 `low === 20.50`。
- P3-1：A 股 14:00 报价 `high:12.5/low:8.8` 时末柱 `high === 12.5 && low === 8.8`，同时盘前（09:18）仍收敛于 `price`。
- P3-2：M3/M4/M8/M10/M11 各自实跑确定性转红并给出变异前后对照（轴长/可见点数/柱四价）；M1/M2/M5/M6/M7/M9 杀红力不回归。
- Round 3 两项闭环结论不回归（`5.1(1g/1h/1i/1j)` 全绿）；Round 1-2 结论不回归（09:25:03 `low=20.50`；02:00/09:05 已收盘柱 `20.5/22.5/20/21`；1m-60m 09:18 `close ∈ [low, high]`）；需求 2 分时轴（A 股 253、港股 6/6、美股 5/5、`gl_HSI` 4/4、`RB0` 数据驱动）与需求 3 语音（09:20-09:25 强制全量 + 基线写回、09:25 恢复去重、智能时段关闭态 09:17/09:22 均放行）全绿。
- `npm test` 全绿（当前 898 + 新增）、`npx eslint` 0 问题；`git diff` 范围仅含修复与用例，不夹带无关改动。
