# WorkBuddy 独立代码审查 Round 4 — 国际期货/国际股票接入可行性与架构方案（复查）

> **文件名说明**：本文件使用任务模板指定的 `docs/handoff/2026-09-16-workbuddy-code-review-round4-handoff.md`（该名在仓库内未被占用，已核）。

## 一、审查基本信息与通过项简述

- 被审 HEAD SHA：`cb49106fe86e1dbd831778e362fdcc308533a160`（= 待审提交，已核对一致；`git pull --ff-only` 无变更，工作区干净，无 `docs/review-checklist.md`）
- 基准 SHA：`45593a5522343c1ed56725f841b16760f80217b7`；实际审查范围 `45593a5..cb49106` = 6 文件 / +839 −2，**全为文档**（无产品代码与测试改动）；本轮修复增量 `7781fe1..cb49106` = 3 文件 / +46 −20。
- 通过项（极简）：Round 3 的 P2-1 主项（`GL_HSI` → `134.HSI_M`）经本机真源复测独立成立（`m:134` 全量 `total=112`，`134.HSI_M` `qt rc=0 f58=恒生指数期货主力 f60=24676`、`kline(klt=1)` 938 根可用；反例 `134.HSI00Y`/`134.MHI_M` 均 `rc=100 data:null` 可判别）；P3-1 断言块改为既有导出后**实跑 9/9 PASS**；P3-2 行号（`326-341` / `:347`）与源码逐字相符；P3-3 美股字段「基准 71 + 偶发追加 2 尾部空字段至 73」经三轮采样（`usAAPL=73/71/71`、`usBABA=71/71/71`、`r_hk00700=78`）复现成立；`m:100–104` 规模 63/104/117/178/33 逐条复现；门禁 `npm test` 843/843 实跑通过。
- 总体判定：**未通过**，**3×P2**。核心问题：① §3.4.2 新增的 A50 合约锚点「完全一致」被真源证伪（两数值相差 10×，实为市场 104 的报价单位约定未登记）；② §2.1 新增的「`push2delay` 与 `push2his` 实测均可稳定拉取」不可复现（本机 `push2his` 族 4/4 全部 `UND_ERR_SOCKET`），以未复现的实测断言"闭环"了 Round 3 待确认风险 1；③ §3.1.2 新增的 `inferAssetType` 契约值域遗漏 `hf_` 形态 → 外盘备源代码被判为 A 股，与方案自身 §3.4.2/§5 冲突。

## 二、审查发现与缺陷清单

### P2-1 §3.4.2 A50 合约锚点「完全一致」被真源证伪：两数值相差 10×，市场 104 的报价单位约定未登记

- **文件与行号**：`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:219`（§3.4.2 第 2 条：「经真源实测核验：新浪 `hf_HSI` 昨结（24676.000）与东财 `134.HSI_M` `f60`（24676）完全一致；新浪 `hf_CHA50CFD` 昨结（14271.000）与东财 `104.CN00Y` `f60`（142710）**完全一致**，保证第一源与备源切换时价格基准无缝对接」）；同步表述 `STATUS.md:15`（本轮新增段）、`docs/handoff/INDEX.md:47`（v4 行"新浪全量备源"结论）
- **触发条件**：按 §3.4.2 实现"切至新浪 `hf_` 备用源时使用新浪字段 7（昨结）重校基准"，即假定 `hf_CHA50CFD` 字段 7 与 `104.CN00Y` `f60` 可直接互换。
- **实际行为**（本机真源实测，2026-09-16 15:49，探针在仓库外 `D:/review_r4/`，未触碰仓库）：
  ```
  EM  104.CN00Y   qt/stock/get -> rc=0 f58=A50期指当月连续 f60=142710 f43=143980
  SINA hf_CHA50CFD            -> 最新14400.000  field7(昨结)=14271.000
  EM  134.HSI_M   qt/stock/get -> rc=0 f58=恒生指数期货主力 f60=24676 f43=24717
  SINA hf_HSI                 -> 最新24725.190  field7(昨结)=24676.000
  ```
  即：恒指一档确为**完全一致**（24676 == 24676.000，无缩放）；而 A50 一档 `142710` 与 `14271.000` **相差恰好 10 倍**（`f43=143980` 对 `14400.000` 亦为 10 倍）。换算后（`142710 / 10 = 14271.0`）两源确在同一条基线上，但**文档写出的"完全一致"作为字面事实为假**，且全方案未在任何位置登记「东财市场 104（SGX）以 0.1 点为单位报价、须 ÷10 归一化」这一约定（同文件 §3.4.1 仅称"共享同源的 `preClose` 昨结算价基准，保证…100% 吻合"）。
- **期望行为**：① 若保留该实测证据，须写明单位换算（如"东财 `104.CN00Y` 报价为新浪的 10 倍，须 `f60/10` 对齐"）或改列换算后的数值，不得写成"完全一致"；② 由于同一方案内两品种的缩放系数不同（HSI 为 1、A50 为 10），§3.4 的"统一合约锚点"须按**市场号**登记各自的缩放系数，而不是隐含"两源数值天然相等"。
- **根因**：本轮重写 §3.4.2 时，对 HSI 一档做了单点比对（确实一致）后，把同一结论**横向套用**到 A50 一档，未对第二个客体做数值级复核；`142710` 系直接沿用 Round 3 报告 `:9` 与 `INDEX.md:44` 中已存在的错误等式「14271.000 = 142710」（该等式本身未经数值校验），属"以上一轮报告为事实来源回填"的同族手法。
- **影响范围**：
  - `GL_A50` 是全方案唯一同时具备"东财第一源 + 新浪备源"且**双源缩放系数不同**的品种；按 §3.4.2 字面实现备源切换，昨结基准将出现 10× 错位 → 涨跌幅、开盘涨跌幅、分时基准线全部异常（约 1000% 量级），而非方案承诺的"无缝对接"；
  - §5 验收断言「外盘分时无日内断裂 / `preClose` 基准对齐」无覆盖此缩放面的用例，Phase 1 落地后该缺陷不会被门禁捕获；
  - `STATUS.md:15`、`INDEX.md:47` 的"新浪全量备源、基准无缝对接"结论随之失实。
- **复现方法/运行证据**（`D:/review_r4/probe_anchor.mjs`）：见上方四行探针输出；`142710 / 14271.0 = 10.0007`，`143980 / 14400.000 = 9.9986`。
- **修复建议**：① §3.4.2 改为「东财 `104.CN00Y` 的 `f60`/`f43` 为新浪 `hf_CHA50CFD` 的 **10 倍**（实测 `f60=142710` 对 `field7=14271.000`），备源切换须按 `×0.1` 归一化；`134.HSI_M` 为 1:1（`f60=24676` 对 `field7=24676.000`）」；② 在 §3.1.1 注册表增列"源间缩放系数"列（`GL_A50` = 0.1，其余 = 1.0），或在 §3.4.1 明确"锚点对齐须逐品种登记缩放系数"。
- **修复后验收标准**：以同一时刻的东财 `f60` 与新浪字段 7 逐品种比对，注册表登记的缩放系数能使两者**精确相等**（含 `GL_A50`）；文档中不再出现把 10× 关系的两个数值称为"完全一致"的表述；§5 增加一条"备源切换后 `preClose` 与第一源误差 = 0"的断言。

### P2-2 §2.1 新增主机断言「`push2delay` 与 `push2his` 实测均可稳定拉取」不可复现——Round 3 待确认风险 1 被未复现的断言"闭环"

- **文件与行号**：`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:58`（§2.1：「轮转主机 `push2delay.eastmoney.com` 与 `push2his.eastmoney.com` **实测均可稳定拉取** `m:134` 与 `m:100-104` 的 `trends2` 与 `kline` 数据」）；同步表述 `STATUS.md:15`（"主机与风险说明"）
- **触发条件**：按 §2.1 `:50`「必须复用仓库既有 `EASTMONEY_TRENDS_HOSTS` 多主机轮转机制」实现 Phase 1 的东财分时/K线接入，并据 `:58` 认为无需追加主机。
- **实际行为**（本机真源实测，2026-09-16，同一探针对 `134.HSI_M` 的 `trends2` 逐主机 4/4 尝试）：
  ```
  push2his.eastmoney.com        ERR UND_ERR_SOCKET (4/4)
  90.push2his.eastmoney.com     ERR UND_ERR_SOCKET (4/4)
  1.push2.eastmoney.com         ERR UND_ERR_SOCKET (4/4)
  push2.eastmoney.com           HTTP 502
  push2delay.eastmoney.com      HTTP 200 rc=0 trends=935        <-- 唯一可达
  ```
  且仓库自身代码对该主机族的记载与本断言相反：
  - `server/marketData.js:14-16`：`// 2026-09-10 live probes (10 requests per host, mid-session): push2his main ... 90.push2his mirror succeeded 9/10`
  - `server/klineService.js:91-95`：`// push2his main host drops programmatic connections (socket resets, 0/10 in live probes) while the 90.push2his mirror is ...`；`const hosts = ['push2his.eastmoney.com', '90.push2his.eastmoney.com'];`
  - `server/marketData.js:18-22`：`EASTMONEY_TRENDS_HOSTS = ['push2his.eastmoney.com', '90.push2his.eastmoney.com', '90.push2his.eastmoney.com']` —— **轮转清单内不含 `push2delay`**。
  另：仓库 `qt/stock/get` 走 `push2.eastmoney.com`（`server/proxyRoutes.js:13` `/api/eastmoney` → `push2.eastmoney.com`，`src/js/api.js:52`），本机对 `134.HSI_M` 与 A 股 `1.600519` **均返回 502**，仅 `push2delay` 返回 `rc=0`。
- **期望行为**：Round 3 待确认风险 1 明确要求「在网络可达的主机环境下对 `134.HSI_M` 逐主机跑 `trends2`/`kline`，若仅延迟主机可用，则需在 §2.1 主机轮转段登记该约束」。正确落点是**登记约束**（例如"仅 `push2delay` 可达，须将其加入轮转清单"），而不是把未复现的"均可稳定拉取"写成已完成的实测结论。
- **根因**：把"结论应为何"直接写成了"实测结果为何"（未执行该轮验证，却以"实测均可稳定"的措辞升格为事实）——与 Round 3 P2-1「把未完成的负向扫描升格为架构事实」同一失效模式，只是作用对象从"市场号扫描"换成了"主机可达性"。
- **影响范围**：
  - 按 §2.1 `:50` 复用既有 `EASTMONEY_TRENDS_HOSTS` 实现 → 本环境下 Phase 1 **全部 10 个品种**的东财 `trends2`/`kline`（轮转主机）与 `qt/stock/get`（`push2`）均不可达，而唯一可达的 `push2delay` 未被纳入任何清单 → §5「Phase 1 全部 10 个品种均能成功通过 `qt` + `trends2` + `kline` 三端点拉取」验收断言在本环境无法满足；
  - `STATUS.md:15` 的"闭环内容 5：主机与风险说明"构成不实记录。
- **复现方法/运行证据**（`D:/review_r4/probe_hosts.mjs`、`probe_kline_hosts.mjs`）：见上方主机矩阵；配套可判别性对照——`push2delay` 对同一 URL 返回 `rc=0`，证明失败非 URL/参数问题；`push2delay` 对 `m:134`/`m:100-104`/`1.600519` 的 `kline`（`klt=101`、`klt=1`）与 `qt/stock/get` 全部 `rc=0`（`134.HSI_M` `klt=1` = 938 根）。
- **修复建议**：① 删除 `:58` 的"`push2his` 实测均可稳定拉取"表述，改为"本机实测 `push2his` 族 4/4 `UND_ERR_SOCKET`、`push2` 恒 502，**仅 `push2delay.eastmoney.com` 稳定可达**"；② 在 §2.1 `:50` 的轮转机制处显式补一行「须将 `push2delay.eastmoney.com` 追加进 `EASTMONEY_TRENDS_HOSTS`（`server/marketData.js:18-22`）与 `klineService.js:95` 的 hosts 数组，并对 `qt/stock/get` 增加 `push2delay` 兜底主机」；③ 若断言确基于作者侧网络，须写明实测时间、主机与环境，并附逐主机成功率计数。
- **修复后验收标准**：§2.1 主机段所载的主机可用性结论与仓库代码注释、本机 4/4 探针三者一致；轮转清单（文档 + `server/marketData.js`/`server/klineService.js`）包含至少一个本机可达主机；§5 的三端点验收断言可被真实探针逐步复现。

### P2-3 §3.1.2 新增 `inferAssetType` 契约值域遗漏 `hf_` 形态 → 外盘备源代码被判为 A 股，与 §3.4.2 / §5 自相矛盾

- **文件与行号**：`docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:137`（§3.1.2 第 3 行改造目标：「新增导出 `inferAssetType(code): string`（契约值域**严格对照** `ASSET_TYPES`：`GL_` 前缀 → `'futures_global'`；`sh/sz/bj`+6位 → `'stock_cn'`；`hk`+5位 → `'stock_hk'`；`us`+字母 → `'stock_us'`；`isFutureCode(code)===true` → `'futures_cn'`；**其余或未知代码统一兜底回退 `'stock_cn'`**）」；关联 `:129`（§3.1.1 NOTE 声称将补"**全值域**正交断言"）、`:135`（服务端 `normalizeCodeParam` 须支持 `hf_[A-Za-z0-9_]+`）、`:140`（`SINA_FUTURE_RE` 须支持 `hf_` 并挂载 `parseSinaGlobalFuture`）、`:218`（新浪 `hf_` 为外盘**全量**备源）、`:271`（§5 防误路由断言"`GL_SI0` / `hf_SI` 准确映射为 COMEX 白银"）；同步表述 `STATUS.md:12`（"全值域分发"）
- **触发条件**：按该契约实现 `inferAssetType`，并把方案自身要求支持的 `hf_` 形态代码（服务端 `:135` 明列）送入 §3.2.2 的 `resolveSessionStrategy(code)`。
- **实际行为**（`D:/review_r4/probe_contract.mjs`，按 `:137` 契约逐字实现后对全值域取值）：
  ```
  "SI0"          -> futures_cn       OK
  "GL_SI0"       -> futures_global   OK
  "hf_SI"        -> stock_cn         <<< 与 §5 :271 要求（COMEX 白银）矛盾
  "hf_HSI"       -> stock_cn         <<< 与 §3.4.2 :218 要求（外盘全量备源）矛盾
  "hf_CHA50CFD"  -> stock_cn         <<< 同上
  "hf_CL"        -> stock_cn         <<< 同上
  "hk00700"      -> stock_hk         OK
  "r_hk00700"    -> stock_cn         <<< 腾讯侧 HK 代码形态（§3.1.2 :138 要求解析）
  "usAAPL"       -> stock_us         OK
  "sh600519"     -> stock_cn         OK
  §3.2.2 分派: resolveSessionStrategy("hf_HSI") -> chinaStockStrategy（A 股策略）
  ```
  即 `hf_` 前缀不属 `GL_`、不匹配 `sh/sz/bj|hk|us`、`isFutureCode('hf_SI') === false`（已实测）→ 命中"其余"分支回落 `'stock_cn'`。而 `:129` 却称该断言集为"**全值域**正交断言"。
- **期望行为**：`hf_` 是方案内一等代码形态（服务端归一化 `:135`、新浪解析 `:140`、全量备源 `:218`、§5 防误路由 `:271` 均以它为前提），契约须显式给出 `^hf_[A-Za-z0-9_]+$ → 'futures_global'`（Round 3 P3-1 的修复建议第 ② 项已明确要求「**同步核对 `hf_` 形态的归属**（``inferAssetType('hf_SI') === 'futures_global'``，属需显式定义的行为）」）；并把 `r_hk\d{5}`（腾讯侧形态）与内部 `hk\d{5}` 的映射关系一并写明。
- **根因**：本轮为闭环 Round 3 P3-1，新增了契约签名与"全值域分发"，但值域枚举只覆盖**内部形态**（`ASSET_TYPES` 注释中的 `sh600519/hk00700/usAAPL/GL_*/SI0`），未回 §3.1.2 同表 `:135`/`:138`/`:140` 与 §3.4.2/§5 逐条核对方案自身要求支持的代码形态 → 上一轮点名的 `hf_` 一项**未闭环**，并新增了 `r_hk` 同族缺口。
- **影响范围**：
  - 会话/语音全链路误路由：`resolveSessionStrategy('hf_HSI')`（或 `'hf_CL'`）命中 §3.2.2 的 `STOCK_CN` 分支 → `chinaStockStrategy`，在北京时间 22:00 返回 `after-close` → 触发 `autoStop` 永久关闭语音并播报"已收盘"，而 CME/HKFE 当时正在交易 —— 这正是 Round 1 P2-4 的失效模式，方案自称"彻底杜绝回归"的前提由此不成立；
  - 归一化层（`normalizeCodeParam`、`normalizeCode` 的 `{ code, type, market }`）会把 `hf_` 标的标成 A 股 → 下游 `getPriceLimit`（已按 D 方案返回 `null`）、东财 secid 分发、涨跌停分类全部走 A 股分支；
  - `STATUS.md:12` 的"全值域分发"结论失实。
- **复现方法/运行证据**：`D:/review_r4/probe_contract.mjs` 输出见上；配套 `isFutureCode('hf_SI')` 实测 `false`、`parseFutureInput('hf_SI')` 实测 `null`（`D:/review_r4/assert_probe.mjs`），确认 `hf_` 不会经 `isFutureCode` 分支被救回 `'futures_cn'`。
- **修复建议**：在 `:137` 的契约值域中补两条并调整兜底语义：① `^hf_[A-Za-z0-9_]+$ → 'futures_global'`（新浪外盘备源符号）；② `^r_hk\d{5}$ → 'stock_hk'`（腾讯侧形态，或显式声明该形态在进入 `inferAssetType` 前已被归一化为 `hk\d{5}`）；③ 把 `:129` 的"全值域正交断言"改为可执行清单，逐值覆盖 `SI0 / GL_SI0 / hf_SI / hf_CL / hk00700 / usAAPL / sh600519 / 含 `_` 未知码`，并断言 `resolveSessionStrategy('hf_CL')` 返回 `globalFuturesStrategy`。
- **修复后验收标准**：按契约实现的 `inferAssetType` 对 `hf_HSI`/`hf_CL`/`hf_SI` 返回 `'futures_global'`、对 `SI0` 返回 `'futures_cn'`、对 `GL_SI0` 返回 `'futures_global'`；`resolveSessionStrategy('hf_CL')` 在北京时间 22:00 的固定时钟下返回 `globalFuturesStrategy` 且 `autoStop === false`；`STATUS.md`/`INDEX.md` 的"全值域"措辞与契约实际枚举一致。

## 三、待确认风险与未验证项

1. **待确认风险：作者侧网络是否可稳定访问 `push2his` 族主机。** 怀疑依据——本机 4/4 `UND_ERR_SOCKET`，且仓库 `server/marketData.js:14-16`、`server/klineService.js:91-92` 的 2026-09-10 生产探针记载 `push2his` 主主机 `0/10` 失败；但若作者在网络可达环境下测得成功，则 `:58` 的断言可能对该环境成立。建议验证方法——在作者环境对 `push2his`/`90.push2his`/`push2delay` 各跑 ≥10 次 `trends2`+`kline` 并记录成功率与环境，结论写入 §2.1。残余风险——若不补充，Phase 1 的东财分时/K线可能在本机环境整体不可用（见 P2-2）。
2. **未验证项：`m:134` 的 `trends2`/`kline` 根数与 `m:100–104` 各品种三端点的逐品种一致性。** 本轮已独立复现 `134.HSI_M`（`qt rc=0`、`kline klt=1` 938 根）与 `m:100–104` 规模；但 `m:100–104` 上 9 个 secid 的三端点取数系沿用 Round 2/3 结论（本轮未逐个重跑），且 `:57` 所载 `trends2 n=914`/`kline n=913` 为**时间点快照**（本轮同时刻实测为 935/938，随交易分钟累积而增长）。需要条件——在可达主机上对 10 个 secid 逐品种执行三端点探测并记录时刻。残余风险——低（只影响证据可复现性，不影响契约）。
3. **未验证项：CME 冬令时（CST）结算窗口 06:00–07:00 的真源观测（沿用 Round 3 未验证项 3）。** 当前为夏令时，`08` 侧无法观测冬季窗口；文档已把两档写入 §5 的固定时钟断言，需在落地阶段以固定时钟单测验证。残余风险——低（窗口算术自洽，且冬夏双变体已恢复）。
4. **非阻塞观察（不计入缺陷）**：`m:134` 的 `trends2` 与 `kline(klt=1)` 根数关系与 §2.2/§2.3 的"分时 = K线 + 1"口径不同（同时刻实测 `trends2=935 < kline=938`，而文档 `:57` 引用的 914/913 为 +1 关系）。该差异不影响任何已登记契约（外盘走"全天窗口"而非固定根数断言），建议后续修订时把 `:57` 的两个根数标注为"某时刻快照"以免误导。

## 四、推荐修复顺序与复审验收标准

**修复顺序**（先修数据契约事实，再修主机可达性契约，最后收敛值域枚举）：

1. **P2-1**：§3.4.2 `:219` 登记 `104.CN00Y` 的 ×10 缩放（或改写数值），并在 §3.1.1 增列"源间缩放系数"；同步 `STATUS.md:15`、`INDEX.md:47`。
2. **P2-2**：§2.1 `:58` 改写为主机可达性实测结论（`push2his` 族不可达、仅 `push2delay` 稳定），并在 `:50` 明确须把 `push2delay` 追加进 `EASTMONEY_TRENDS_HOSTS`（`server/marketData.js:18-22`）与 `server/klineService.js:95` 的 hosts；同步 `STATUS.md:15`。
3. **P2-3**：§3.1.2 `:137` 契约补 `hf_` → `'futures_global'`（及 `r_hk` 归一化声明），`§3.1.1 :129` 的"全值域断言"改为逐值可执行清单；同步 `STATUS.md:12`、`INDEX.md:47`。
4. **待确认风险 1**：补作者环境的主机成功率计数与环境说明，写入 §2.1。

**复审验收标准（逐条可判定，复审将独立重跑）**：

- 同一时刻逐品种比对东财 `f60` 与新浪字段 7，文档登记的缩放系数使两者精确相等（必须覆盖 `GL_A50` 的 10× 与 `GL_HSI` 的 1× 两个不同档）；文档中不再出现把 10× 关系的两个数值称为"完全一致"。
- §2.1 主机段的可用性结论与本机探针、仓库代码注释三者一致；文档指定的轮转主机清单包含至少一个本机可达主机，且 `EASTMONEY_TRENDS_HOSTS`（文档与 `server/marketData.js:18-22`）与之对齐；§5 的三端点验收断言可由真实探针复现。
- `inferAssetType` 契约值域对 `hf_SI`/`hf_HSI`/`hf_CL` 返回 `'futures_global'`、对 `SI0` 返回 `'futures_cn'`、对 `GL_SI0` 返回 `'futures_global'`，且 `resolveSessionStrategy('hf_CL')` 在 22:00 固定时钟下返回 `globalFuturesStrategy`（`autoStop === false`）；"全值域正交断言"清单逐值覆盖且可实跑通过。
- Round 3 已闭环项保持不回退：`GL_HSI` → `134.HSI_M` 三端点可用、`§3.1.1` 断言块实跑 PASS、`kline.js:326-341`/`:347` 引用、美股 71/73 字段表述。
- 既有门禁保持 `npm test` 843/843（本轮 diff 全为文档，未触碰产品代码与测试）。
