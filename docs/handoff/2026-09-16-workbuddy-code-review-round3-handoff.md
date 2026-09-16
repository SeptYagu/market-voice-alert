# WorkBuddy 独立代码审查 Round 3 — 国际期货/国际股票接入可行性与架构方案（复查）

> **文件名说明**：本文件使用任务模板指定的 `docs/handoff/2026-09-16-workbuddy-code-review-round3-handoff.md`（该名在仓库内未被占用，已核）。同链 Round 2 报告因模板名被他链占用，另用任务作用域名 `2026-09-16-global-market-workbuddy-code-review-round2-handoff.md`。

## 一、审查基本信息与通过项简述

- 被审 HEAD SHA：`8a97cca63a3a5662324d893b042f6ce6264b9104`（= 待审提交，已核对一致；`git pull --ff-only` 无变更，工作区干净，无 `docs/review-checklist.md`）
- 基准 SHA：`45593a5522343c1ed56725f841b16760f80217b7`；实际审查范围 `45593a5..8a97cca` = 5 文件 / +659 −2，全为文档；本轮修复增量 `6b1b9b2..8a97cca` = 3 文件 / +134 −101。**无产品代码与测试改动**（`git diff --name-only` 全为 `.md`），故门禁不受影响，未重复跑基线。
- 通过项（极简）：Round 2 的 P2-1 主项（`GL_A50` → `104.CN00Y` 实测成立）与其余 8 个 secid、P2-2 冬夏双变体（经真源首根 Bar 独立验证）、P3-2 行号（210/218/232）、P3-5 端点口径（港股 151/无 13:00/331、美股 391 与 390）、`m:100–104` 全量 `clist` 规模（63/104/117/178/33）、§3.4 合约锚点（新浪 `hf_CHA50CFD` 昨结 14271.000 = 东财 `104.CN00Y` `f60` 142710）经本机真源复测逐条闭环；§3.1.2 表其余行号 `sed` 抽查相符；§3.2.2 `default` 兜底已补。
- 总体判定：**未通过**，**1×P2 + 3×P3**。核心问题：Round 2 明确要求「不得在扫描未完成时断言东财无恒指期货合约」的**负向结论被裁剪作用域后升格为架构事实**——东财 `m:134` 实收录恒指期货主力/月份合约且 `qt`+`trends2`+`kline` 三端点可取数（实测 `134.HSI_M` `trends2` n=914、`kline(klt=1)` n=913），据此写死的「`GL_HSI` 纯新浪单源 + 东财无期指合约」降级契约与 §5 验收断言均不成立。

## 二、审查发现与缺陷清单

### P2-1 `GL_HSI`「东财无恒指期货合约 → 纯新浪单源」被真源证伪：东财 `m:134` 收录恒指期货且三端点可取数

- **文件与行号**：
  - `docs/handoff/2026-09-16-global-market-feasibility-and-architecture-handoff.md:57`（§2.1「恒指期货特别说明：东财期货市场号（m:100–124）内未收录恒指期货连续合约……确立为**新浪 `hf_HSI` 单源模式**」）
  - 同文件 `:102`（§3.1.1 注册表 `GL_HSI` 行：东财 secid = `null`、走势图可用性 = 「**仅实时报价**（东财无期指合约，明确单源）」）
  - 同文件 `:207-209`（§3.4.2「对东财无期指合约的 `GL_HSI`……纯新浪单源驱动，图表区显示『该品种暂无历史分时』」）
  - 同文件 `:260`（§5 验收「具备东财源的 9 个品种……单源品种 `GL_HSI` 具备优雅降级断言」）
  - 同步表述：`STATUS.md:9`、`STATUS.md:12`、`docs/handoff/INDEX.md:8`、`docs/handoff/INDEX.md:44`
- **触发条件**：按 §3.1.1 注册表把 `GL_HSI` 的东财 secid 置为 `null`，并按 §3.4.2 实现「无历史分时」降级（图表区提示、只走新浪报价）。
- **实际行为**（本机真源实测，2026-09-16 15:2x，探针在仓库外 `D:/review_r3/`，未触碰仓库）：
  1. 东财 `clist` 全量枚举 `m:134`：`total=112`，含 `恒生指数期货2609/2610/2611/2612/2703/2706/2709/2812…`、`恒生指数期货主力 (HSI_M)`、`小型恒生指数期货2609/2610/2612 (MHI*)`、`H股指数期货*`、`恒指波幅指数期货*`、`恒生科技指数期货*`、`恒指股息期货*` 等。
  2. `134.HSI_M`：`qt/stock/get` → `rc=0`，`{"f57":"HSI_M","f58":"恒生指数期货主力","f43":24714,"f46":24664,"f60":24676,"f170":15}`；`trends2` → `n=914`（`preClose=24676`，`first=2026-09-15 17:00`、`last=2026-09-16 15:28`）；`kline(klt=1)` → `n=913`。两次独立采样数值一致。
  3. `134.HSIU6`（恒生指数期货 2609，前月）与 `134.MHIU6`（小型恒指 2609）同样 `qt rc=0` + `trends2 n=914` + `kline n=913`。
  4. 锚点可比性：新浪 `hf_HSI` 字段 7（昨结）= **24676.000**，与东财 `134.HSI_M` `f60` = **24676** 完全一致（两独立提供商），即改用东财并不破坏 §3.4 的昨结对齐前提。
  5. 对照：`134.HSI00Y`、`134.MHI_M` 为 `rc=100/data:null`（说明并非「随便写个 134 代码都能出数」，`HSI_M`/`HSIU6` 的有效性是可判别的事实）。
- **期望行为**：负向结论必须在其声明的作用域内完成验证后再落为架构事实。若东财存在可用的恒指期货 secid，应登记实测值（连续/主力口径）并保留东财分时/K线能力，新浪 `hf_HSI` 退化为备源；若确无，必须给出**全仓（含分页失败市场）扫描证据**并把范围与残余风险一并登记，而不是把作用域裁剪为 `m:100–124`。
- **根因**：Round 2 待确认风险 1 已明确给出验证方法（「对分页失败市场重跑 `clist` 并以 `f12/f14` 全量落盘后检索 `HSI`，或用 `suggest` 接口按『恒指期货』检索」）与警告（「**不能断言「全仓不存在」**」）。本轮未执行该验证，改为把断言作用域收窄到 `m:100–124`（恰好排除了 HSI 期货所在的 `m:134`），并以「未收录」的措辞升格为 §2.1 的架构结论；同时 §3.1.1/§3.4.2/§5 三处下游契约据此改写，形成「以未完成扫描支撑架构决策」的闭环错误。
- **影响范围**：
  - Phase 1 的 `GL_HSI` 被无必要地降级为纯报价，失去东财分时/K线能力（`trends2` n=914 / `kline` n=913 实测可用），Phase 1 交付范围与验收断言（§5 `:260`）随之写死错误结论；
  - §3.4「外盘期货优先采用东方财富作为第一数据源」被误判为对本品种结构性不可行，团队会按错误的降级契约实现 UI（「该品种暂无历史分时」）并可能写入回归测试固化错误行为；
  - `STATUS.md:9/12`、`INDEX.md:8/44` 的「缺陷全面闭环」结论随之失实。
- **复现方法/运行证据**（`D:/review_r3/probe4.mjs`、`probe5.mjs`、`probe7.mjs`、`probe8.mjs`）：
  ```
  # m:134 全量
  clist fs=m:134 → total=112 ; 含 134.HSI_M|恒生指数期货主力 / 134.HSIU6|恒生指数期货2609 / 134.MHI* / 134.HHI*
  # 三端点（两次采样一致）
  134.HSI_M  qt rc=0 f58=恒生指数期货主力 f60=24676 | trends2 n=914 | kline klt=1 n=913
  134.HSIU6  qt rc=0 f58=恒生指数期货2609   f60=24676 | trends2 n=914 | kline klt=1 n=913
  134.MHIU6  qt rc=0 f58=小型恒生指数期货2609 f60=24676 | trends2 n=914 | kline klt=1 n=913
  # 反例（证明可判别）
  134.HSI00Y qt rc=100 data=null ; 134.MHI_M qt rc=100 data=null
  # 锚点
  Sina hq_str_hf_HSI 字段7(昨结)=24676.000  ==  东财 134.HSI_M f60=24676
  # 对照（m:100–124 确无恒指期货，与方案原文一致但与结论不等价）
  m:100 total=63（HSI 为现货指数、XIN9 为现货 A50）；m:104 total=33；m:125/130/131/132/133/139/140 等无恒指期货
  ```
  说明：本机对仓库既有轮转主机 `push2his.eastmoney.com` / `90.push2his.eastmoney.com` / `1.push2.eastmoney.com` 全部 `UND_ERR_SOCKET`，`push2.eastmoney.com` 恒 502（与方案 §2.1 所述 502 现象一致），故探针走 `push2delay.eastmoney.com`（4/4 稳定）。**市场号↔代码映射与主机无关**，且本机 `clist` 得到的 `m:100/101/102/103/104` 规模（63/104/117/178/33）与 Round 2 在其它主机上的实测逐一吻合，构成跨主机一致性旁证。
- **修复建议**：
  1. §3.1.1 注册表 `GL_HSI`：东财 secid 由 `null` 改为实测可用值 `134.HSI_M`（主力/连续口径，`f58=恒生指数期货主力`）；若要求与 A50 的「当月连续」口径一致，可登记前月 `134.HSIU6` 并给出换月契约（二者当前同一报价、`trends2/kline` 均可用）。走势图可用性列改为「实时报价 + 分时 + K线」。
  2. §2.1 恒指特别说明改为：`m:100` 为国际指数现货市场；恒指期货位于 **港/亚洲指数期货市场 `m:134`**（112 只，含 HSI/HHI/MHI/HTI 等系列），并登记实测证据；删除「东财无期指合约」表述。
  3. §3.4.2 删除针对 `GL_HSI` 的「纯新浪单源 + 无历史分时」降级契约（改为新浪仅作备源）；§5 `:260` 的验收断言恢复为「Phase 1 全部 10 个品种均可 `qt`+`trends2`+`kline` 三端点取数」。
  4. 同步修正 `STATUS.md:9/12`、`INDEX.md:8/44`。
- **修复后验收标准**：对 Phase 1 **全部 10 个品种**逐个执行 `qt/stock/get` + `trends2` + `kline(klt=1)` 三端点探测，结果与注册表逐行一致（非空、`rc=0`）；文档中不再出现「东财无恒指期货合约」「`GL_HSI` 仅实时报价」的结论；`hf_HSI` 仅作为备源登记，并说明其昨结（24676）与东财 `f60` 的同源对齐关系。

### P3-1 本轮新增的「真实有效的解析层隔离断言」仍引用仓库不存在的标识 `inferAssetType` → 断言块无法加载

- **文件与行号**：`…feasibility-and-architecture-handoff.md:104-119`（§3.1.1「真实有效的解析层隔离与冲突防护断言」，`import { inferAssetType } from '../src/js/parser.js';` 见 `:108`，使用见 `:114/:117/:118`）；关联 `:166`（§3.2.2 `resolveSessionStrategy` 依赖 `inferAssetType`）；同步表述 `STATUS.md:12`、`INDEX.md:44`
- **触发条件**：按该片段创建单测文件（静态 ESM `import`）并运行 `npm test`。
- **实际行为**：
  1. 实跑静态导入 → **链接期报错**：`SyntaxError: The requested module '…/src/js/parser.js' does not provide an export named 'inferAssetType'`。
  2. `src/js/parser.js` 实际导出：`calcPercent, inferMarket, normalizeCode, parseEastmoney, parseEastmoneyTrends, parseSinaFuture, parseTencent, parseTencentMinute, toEastmoneySecId`；`src/js/futures/contractCatalog.js` 导出：`EXCHANGES, PRODUCT_MAP, parseFutureInput`。两模块均无 `inferAssetType`。
  3. 全仓 `grep -rn "inferAssetType"` 仅命中文档（本方案 `:108/:114/:117/:118/:166`、Round 2 报告、`STATUS.md:12`、`INDEX.md:44`），无任何实现或声明。
  4. 片段中另一半断言是成立且有效的：`parseFutureInput('SI0')` → `{"exchange":"gfex","name":"工业硅连续","symbol":"SI0"}`（已实跑）。即「恒真断言」问题确已修好，**仅**「被引用标识与仓库实际导出一致」这一半未闭环。
- **期望行为**：断言须可执行——要么改用仓库既有导出组合表达同一冲突面（`normalizeCode` / `inferMarket` / `parseFutureInput` / `isFutureCode`），要么在本方案中显式定义该新 API（签名、归属模块、`ASSET_TYPES` 值域）并把它纳入 §3.1.2 的改造清单（该清单自称「覆盖全仓 9 处真实行号与消费点」，但未包含新增 `parser.js` 导出这一改造点）。
- **根因**：Round 2 的 P3-1 只被修掉了「恒真」一半，被引用标识的有效性未回仓库求证；`inferAssetType` 系沿用 Round 2 报告 `:50` 的示意写法（该报告同样写作 `inferAssetType('GL_SI0') === FUTURES_GLOBAL`，其中 `FUTURES_GLOBAL` 亦非可引用常量）。这是本链反复出现的同类缺陷：**以文档为事实来源、不回源码求证**。
- **影响范围**：方案声称的「解析层正交性」自动化保证按文档无法运行（实现者照抄会得到红测或需自行发明 API，从而偏离契约）；Round 2 P3-1 的验收标准「被引用标识与仓库实际导出一致」仍未达成。
- **复现方法/运行证据**（`D:/review_r3/snippet.mjs`、`static_import.mjs`）：
  ```
  import { inferAssetType } from '…/src/js/parser.js';
  → SyntaxError: The requested module '…/src/js/parser.js' does not provide an export named 'inferAssetType'
  parser.js exports: calcPercent, inferMarket, normalizeCode, parseEastmoney, parseEastmoneyTrends, parseSinaFuture, parseTencent, parseTencentMinute, toEastmoneySecId
  parseFutureInput('SI0') -> {"exchange":"gfex","name":"工业硅连续","symbol":"SI0","night":null}
  ```
- **修复建议**：二选一。①（推荐）用既有导出改写断言，例如 `assert.equal(inferMarket('sh600519'), 'sh')`、`assert.equal(isFutureCode('SI0'), true)`、`assert.equal(parseFutureInput('GL_SI0'), null)`（国际化前缀 `GL_` 不走国内目录）、并在会话层对 `GL_` 输入单独断言；②若确需新增资产类型推断 API，则在 §3.1.2 补一行「`src/js/parser.js` 新增 `export function inferAssetType(code): ASSET_TYPES值域`」，给出输入形态到 `ASSET_TYPES` 各值的分支表与未知输入的返回值约定（与 §3.2.2 的 `default` 兜底保持一致），并同步核对 `hf_` 形态的归属（`:118` 要求 `inferAssetType('hf_SI') === 'futures_global'`，属需显式定义的行为）。
- **修复后验收标准**：断言文件在仓库内可被真实测试运行器加载并通过；把 `GLOBAL` 目录某条目改为与国内键同名（或让 `inferAssetType` 对 `GL_SI0` 返回 `futures_cn`）时断言必须失败；`grep` 到的每个被引用标识均可在 `src/` 内找到 `export`。

### P3-2 §3.1.2 行 9 新增的消费方行号 `kline.js:345` 与声称逻辑不符（真实在 347）

- **文件与行号**：`…feasibility-and-architecture-handoff.md:133`（§3.1.2 表第 9 行「`src/js/kline.js:326-345` 与消费方 `:345, 360-367`」「消费方 (`kline.js:345` / `classifyKlineBar`) 增加 `limit === null` 短路保护，不再经 `Number(limit) || 10` 回落」）；同步表述 `STATUS.md:12`、`INDEX.md:44`
- **触发条件**：按该行号定位 `Number(limit) || 10` 并改造。
- **实际行为**：`src/js/kline.js` 精确行内容为
  ```
  343: export function classifyKlineBar(item, prevClose, limit) {
  345:   const pc = Number(prevClose);          <-- 文档所指
  347:   const lim = Number(limit) || 10;       <-- 实际回退点
  ```
  即 `345` 是 `const pc = Number(prevClose);`，与「消费方短路 `Number(limit) || 10`」无关；文档所指的回退表达式在 **347**。（`360-367`（`formatCandleColors` 起、`classifyKlineBar` 调用点）与 `210/218/232` 本轮修正确与源码一致，已核。）
- **期望行为**：行号引用指向真实形态假设点；行 9 应写 `kline.js:343-357`（`classifyKlineBar` 体）/精确点 `347`，而非 `345`。
- **根因**：本轮把行 8 的 `STOCK_CODE_RE` 行号回源校正了（210/218/232），但同一张表行 9 新增的消费方行号未做同等的 `sed -n '<行号>p'` 校验——`345` 系从 Round 2 报告（其 `:71` 亦写作 `kline.js:345`）直接沿用。Round 2 P3-2 建立的验收标准「§3.1.2 表中每条 `文件:行号` 均可由 `sed -n '<行号>p'` 还原出该行声称的逻辑」未在本轮全表执行。
- **影响范围**：P3-3 的修复方案本来就完全依赖「找到消费方回退点」这一步；按 `345` 实施会落在 `const pc = Number(prevClose);` 上，漏改 `347` 的 `Number(limit) || 10` → 「非 A 股涨跌停分类不生效」的目标可能再次落空（与 Round 2 P3-3 是同一失效模式，只是这次由行号错标引入）。
- **复现方法/运行证据**：`awk 'NR==345||NR==347{printf "%d: %s\n",NR,$0}' src/js/kline.js` → `345: const pc = Number(prevClose);` / `347: const lim = Number(limit) || 10;`；`grep -n "STOCK_CODE_RE" src/js/kline.js` → `210/218/232`（与文档相符）。
- **修复建议**：行 9 第二列改为「`src/js/kline.js:326-341`（`getPriceLimit` 体）与消费方 `:347`、`:360-367`」，第四列同步为「消费方 `classifyKlineBar`（`:347` `const lim = Number(limit) || 10;`）增加 `limit === null` 短路」；`STATUS.md` / `INDEX.md` 同步。
- **修复后验收标准**：表内每一条 `文件:行号`（含本轮新增的消费方引用）均可由 `sed -n '<行号>p'` 还原出该单元格声称的逻辑；`getPriceLimit` 与 `classifyKlineBar` 的引用范围不重叠。

### P3-3 §2.3 美股「实测 71 字段（非交易时段实测）」不可复现：同一时点同一标的在 71↔73 间抖动

- **文件与行号**：`…feasibility-and-architecture-handoff.md:67`（「腾讯 `https://qt.gtimg.cn/q=usAAPL`（实测 71 字段，取值条件：非交易时段实测；开盘盘中字段数可能有增补）」）；同步 `STATUS.md:14`、`INDEX.md:44`
- **触发条件**：按该字段数编写/校验美股报价解析器（例如 `assert.equal(fields.length, 71)` 或 `fields.length >= 73`），或要求「字段数可由一次真源探测复现」。
- **实际行为**（2026-09-16 15:2x，美股处于**非交易时段**（夏令时 21:30–次日 04:00），连续采样）：
  ```
  round1: usAAPL=73  usTSLA=71  usNVDA=73  usBABA=71  r_hk00700=78  r_hk09988=78
  round2: usAAPL=73  usTSLA=71  usNVDA=71  usBABA=71  r_hk00700=78  r_hk09988=78
  round3: usAAPL=71  usTSLA=73  usNVDA=73  usBABA=71  r_hk00700=78  r_hk09988=78
  ```
  即在文档声明的取值条件（非交易时段）下，一次探测 `usAAPL` 得 **73**（≠ 文档的 71），且同一标的跨采样在 71/73 间跳变。字段级对比显示差异为**尾部两个空字段**：73 字段 payload 的 `idx71=""`、`idx72=""`，71 字段 payload 无这两个下标，其余字段一一对应（`f1=苹果`、`f3=331.34`、`f30=2026-09-15 16:00:01`）。
- **期望行为**：不得以「字段总数」作为跨时点定值断言。应写为「美股 payload 基准 71 字段（实测于非交易时段），上游偶发追加 2 个尾部空字段使总数达 73；解析须按最小字段数（如既有 `parseTencent` 的 `fields.length < 35` 守卫）而非精确总数校验」。
- **根因**：Round 2 P3-4 的取证是**单次采样**（`usAAPL`/`usBABA` 恰为 71），本轮据此把 73 改成 71 并只补了会话状态条件，未做重复采样/稳定性验证——与本链历轮反复出现的「单样本外推全局规则」同源（Round 1 P2-1 即此根因）。
- **影响范围**：验收标准 1（数据源「字段完整性」评估）的支撑数字不可复现，Round 2 验收标准「§2.2/§2.3 的字段数均可由一次真源探测复现」未达成（此刻一次探测得 73）；若实现按 71 做等值校验，美股解析会随上游抖动误判为不完整。
- **复现方法/运行证据**（`D:/review_r3/probe6.mjs`）：见上方三轮采样输出与字段级 diff（尾部空字段）。
- **修复建议**：`§2.3` 改为「基准 71 字段（非交易时段实测），上游偶发追加 2 个尾部空字段（总数 73）；不得以总数做等值断言」；`§2.2` 港股 78 字段补注本轮实际验证的时点（盘中；盘后未验证，见 §三）。
- **修复后验收标准**：连续 ≥3 次真源探测的结果都能被文档表述完整解释（71 与 73 均符合描述），文档中不再存在「实测 N 字段」这类**不可复现的单点定值**断言；并由一条字段数下限守卫（而非等值）覆盖解析测试。

## 三、待确认风险与未验证项

1. **待确认风险：`m:134` 的 `trends2`/`kline` 是否由仓库既有轮转主机提供。** 本机对 `push2his`/`90.push2his`/`1.push2.*` 全部 `UND_ERR_SOCKET`、`push2.eastmoney.com` 恒 502（与方案所述现象一致），故上述 `m:134` 证据取自 `push2delay.eastmoney.com`（4/4 成功）。市场号↔代码映射与主机无关，且本机 `clist` 规模与 Round 2 跨主机实测一致，但仍建议：**怀疑依据**——`EASTMONEY_TRENDS_HOSTS`（`server/marketData.js:18-22`）仅含 `push2his`/`90.push2his`，是否服务 `m:134` 的 `trends2` 未经本机证实；**建议验证方法**——在网络可达的主机环境下对 `134.HSI_M` 逐主机跑 `trends2`/`kline`，若仅延迟主机可用，则需在 §2.1 主机轮转段登记该约束；**残余风险**——若轮转主机不服务该市场，则 `GL_HSI` 的东财分时需额外主机或仍走新浪备源。
2. **未验证项：港股「78 字段，取值条件：盘中与盘后一致」（`:60`）中的「盘后」一半。** 探针时点为 15:2x（港股盘中，16:00 收盘），无法验证盘后字段数是否仍为 78。需在港股收盘后复测一次；残余风险为低（该数值仅作评估，不构成解析契约）。
3. **未验证项：CME 冬令时（CST）结算窗口 06:00–07:00 的真源观测。** 当前处于夏令时，实测 `102.CL00Y`/`101.GC00Y` 当日首根 Bar 均为 `06:00` 且 `05:00–05:59` **零 bar**（与夏令时变体 `05:00–06:00` 结算休市一致，P2-2 本轮修复方向正确）；冬令时一档为 CT 16:00–17:00 + CST(UTC-6) 的窗口算术推导，需以固定时钟单测验证（文档已列入 §5 验收断言）。
4. **非阻塞观察（不计入缺陷）**：`:54` 将 `m:102` 描述为「NYMEX 能源化工」，实测该市场 117 只中还包含 `102.PA00Y|NYMEX钯金` 等贵金属；该括注枚举不影响任何已登记 secid 与契约，可在下次修订时一并补全（同类：`m:101` 描述为「贵金属与铜」，实测含 `101.QI*|迷你白银`）。

## 四、推荐修复顺序与复审验收标准

**修复顺序**（先修架构事实，再修可执行性，最后收敛引用精度）：

1. **P2-1**：`GL_HSI` 东财 secid 改为实测可用值（推荐 `134.HSI_M`，并给出主力换月契约）；`§2.1` 增补 `m:134` 港/亚洲指数期货市场并删除「东财无期指合约」；`§3.4.2` 删除纯新浪降级契约（新浪降为备源）；`§5` 恢复 10 品种三端点验收断言；同步 `STATUS.md`、`INDEX.md`。
2. **P3-1**：`§3.1.1` 断言改为可执行形态（既有导出组合，或显式定义 `inferAssetType` 并入 §3.1.2 清单）。
3. **P3-2**：行 9 消费方行号 `345` → `347`（并收紧 `getPriceLimit` 区间为 `326-341`）。
4. **P3-3**：`§2.3` 字段数改为「基准 71 + 偶发尾部空字段至 73」的稳定性表述，`§2.2` 补港股取值时点；同步 `STATUS.md`、`INDEX.md`。
5. **待确认风险 1**：在可达主机上补测 `m:134` 的 `trends2`/`kline` 可用性，结论写入方案。

**复审验收标准（逐条可判定，复审将独立重跑）**：

- 对 Phase 1 **全部 10 个品种**执行 `qt/stock/get` + `trends2` + `kline(klt=1)` 三端点探测，结果与 §3.1.1 注册表逐行一致（非空、`rc=0`）；文档中不再出现「东财无恒指期货合约」或「`GL_HSI` 仅实时报价」。
- §3.1.1 断言块在仓库测试运行器中**可实跑通过**，且在人为制造标识冲突时失败；被引用标识均可在 `src/` 找到 `export`（或已在 §3.1.2 清单中显式登记为新增导出）。
- §3.1.2 表内每条 `文件:行号` 均可由 `sed -n '<行号>p'` 还原出该单元格声称的逻辑（含 `347` 的 `Number(limit) || 10`）。
- §2.2/§2.3 的字段数表述可由连续 ≥3 次真源探测复现（71/73 两种结果均被文档覆盖），且解析契约使用字段数**下限**而非等值。
- CME 结算窗口在冬令时/夏令时两个固定时钟下分别输出 `06:00-07:00` / `05:00-06:00`（本轮已实测夏令时侧：首根 06:00、05:00–05:59 零 bar）。
- 既有门禁保持 `npm test` 843/843（本轮 diff 全为文档，未触碰产品代码与测试）。
