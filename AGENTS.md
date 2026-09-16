# AGENTS.md

> 本文件是本仓库智能体（Antigravity、WorkBuddy 等）的核心行为准则、工程红线与协作协议中枢。
> 数据字典、状态记录与历史档案均已外置，提示词仅保留纯粹的**规则（Rules）**与**流程（Workflows）**。

---

## 1. 核心技术红线与规范

- **架构选型**：原生 JavaScript（Vanilla JS ESM，`import`/`export`）+ Vite + TradingView Lightweight Charts。严禁引入 React/Vue/其他前端框架；严禁重新引入 ECharts；严禁在 `src/` 下创建 CommonJS（`*.cjs`）。
- **设计范式**：业务逻辑收敛于纯函数（`api.js`, `parser.js`, `services/`），UI 控制器与 DOM 渲染分离（`controllers/`, `views/`）。状态单一来源，禁止双重状态赋值。
- **样式规范**：主题与颜色严格使用 `src/style.css` 声明的 CSS 变量（`--theme-*`、`--accent-color` 等），严禁在 JS/HTML 中内联硬编码 Hex 色值。
- **数据与网络契约**：外部行情统一由 Vite / Server 代理转发；公共持久化缓存统一由服务端 `/api/cache/*` 提供；涨停池依赖本机 AKTools（Python 后端 8888 端口）。详细路由映射查阅 `vite.config.js` 与 `server/proxyRoutes.js`。
- **架构职责分层**：
  - `server/`：生产后端、接口代理、公共数据缓存（K 线/分时/涨停/动量池/交易日历）。
  - `src/js/controllers/`：页面生命周期、事件绑定与交互状态控制。
  - `src/js/views/`：纯 DOM 装配与渲染，接收数据渲染节点，不直接持有业务状态。
  - `src/js/services/`：独立领域服务与纯数学模型（如 `quoteMath.js`, `momentumMath.js`）。

---

## 2. 状态获取与交接流程

- **开始任务前的状态读取**：
  - 必须首先查看根目录 [`STATUS.md`](STATUS.md) 了解当前阶段状态、已知缺陷与验收基线；
  - 查看 [`docs/handoff/INDEX.md`](docs/handoff/INDEX.md) 检索最新交接文档（如存在缺陷核验或审查报告，以最新一篇为准）。
- **任务完成时的交接沉淀**：
  - 阶段交付时，在 `docs/handoff/` 目录下生成标准命名文档（如 `YYYY-MM-DD-*-handoff.md`）；
  - 并在 [`docs/handoff/INDEX.md`](docs/handoff/INDEX.md) 顶部追加登记，更新 `STATUS.md`。

---

## 3. 本地工程门禁与 Git 同步协议

- **前置同步（Pull First）**：
  - 开始任何代码开发、修复或审查前，必须首先执行 `git pull --ff-only`，确保本地分支与远端实时同步；
  - 若工作区有未提交改动，不得自动 stash/reset，先说明情况。
- **本地门禁验证（Gate Baseline）**：
  - 任何代码交付前，必须在本地完整运行并全部通过：
    1. `npm run lint`（0 错误 0 警告）
    2. `npm test`（QUnit 单元测试全部 PASS）
    3. `npm run build`（生产构建打包无报错）
    4. 涉及端到端交互或联想搜索时运行 `npm run e2e`。
- **提交与推送（Push for Review，非终态）**：
  - 门禁全绿后，仅暂存任务相关文件，执行规范提交（`feat(...)`、`fix(...)`、`docs(...)`）；
  - 立即执行 `git push origin <branch>` 推送至远端，保持本地与远端干净一致；
  - **【流程强绑定与消除歧义】推送仅代表代码提交待审，绝非任务完成交付**。推送成功后必须**立即、无缝进入第 4 节派发 WorkBuddy 独立审查**并挂起等待判定，严禁在未收到 WorkBuddy 审查判定前向用户宣称任务完成或终止执行流程。

---

## 4. 双智能体协同与代码审查闭环（Antigravity ↔ WorkBuddy）

**标准工程生命周期状态机**：
`需求/缺陷 ➔ 编码开发 ➔ 本地全量门禁 ➔ 提交并推送 ➔ 立即触发 WorkBuddy 审查 ➔ 等待判定 ➔ [自愈循环: 修复 ➔ 门禁 ➔ 推送 ➔ 复审] ➔ 审查通过/熔断 ➔ 最终向用户交付`

当 Antigravity 完成功能开发或缺陷修复并推送到 Git 后，必须按照以下流程触发 WorkBuddy 独立审查，形成自动验证闭环：

### 4.1 审查派发强卡点（Mandatory Review CLI Hard Gate）
为彻底杜绝大模型在多轮审查中“自由发挥自定义提示词、诱导提问、放松审查边界”的退化行为，**严禁使用 `run --prompt` 手工拼装提示词**。必须统一通过底层机械化 CLI 审查命令发起：

```powershell
python "C:\Users\12915\.gemini\config\plugins\workbuddy-plugin\scripts\workbuddy_cli.py" review `
  --repo-dir "D:\AiPrograms\project1\market-voice-alert" `
  --goal "<本次任务核心目标>" `
  --criteria "<验收标准>" `
  --base-sha "<修改前的初始基准 Commit SHA>" `
  --head-sha "<待审的最新 Commit SHA>" `
  --round <当前审查轮次编号，如 1, 2, ...>
```
- **宿主工作区与路径映射**：CLI 会自动关联宿主工作区 `D:\AiPrograms\project1`，并向审查员精准注入目标子仓库绝对路径，无需人工干预。
- **变更范围（`--scope`）**：若省略，CLI 会在目标仓库自动执行 `git diff --stat {BASE_SHA}..{HEAD_SHA}` 提取精确变更文件。
- **异步调度**：派发时通过 `run_command`（`WaitMsBeforeAsync: 2000`）在后台运行，Antigravity 挂起等待回传唤醒。

### 4.2 双盲对抗审计与多轮基准连续性（Anti-Drift & Double-Blind Protocol）
- **规范模板硬绑定**：审查命令在底层强制加载并渲染规范模板 `code-review-prompt.md`，彻底剥夺了大模型自由添加指令的权力。
- **严禁诱导提问（No Leading Questions）**：在多轮复查（Round 2+）中，Antigravity **严禁**向审查员附带传递“*我已经修复了第 40 行的 Bug*”、“*请核验问题是否已解决*”、“*本次只是微小修改*”等任何主观辩解或诱导性信息。审查员必须作为冷启动的对抗性审计员，基于代码 diff 和构造反例独立裁决。
- **基准 SHA 锚定原则**：在整个需求生命周期的所有审查轮次（Round 1、Round 2……）中，`--base-sha` 必须始终保持为**最初开工前的原始基准提交**（而不是上一轮被拒的中间提交），确保审查员对累计改动的全局回归与连带影响拥有全量视野。

### 4.3 反馈决策与自愈循环（Resolution Loop）
1. **唤醒与判断**：
   - **分支 A（无问题）**：WorkBuddy 回复确认审查通过，且无新增缺陷 handoff ➔ 审查闭环通过，向用户汇报最终成果，流程结束。
   - **分支 B（有缺陷）**：WorkBuddy 发现了问题并推送了新 handoff ➔ Antigravity 执行 `git pull --ff-only` 同步交接文档 ➔ 根据 handoff 修改代码并补充测试 ➔ 本地门禁验证 ➔ `git commit` & `git push` ➔ 再次调用 `workbuddy_cli.py review`（指定 `--round 2` 等）派发 WorkBuddy 复审。
   - **分支 C（方案收敛与推进代码，最多 3 轮上限）**：若当前属于纯技术方案/文档阶段审查（git diff 均为 `.md` / `docs/`），且复审已达到 **3 轮上限**，或审查报告中仅残留非代码级建议、伪代码变量绑定、纯文档/文书/笔误类轻微瑕疵（核心架构可行性与接口契约已闭合），Antigravity 必须果断判定方案收敛定稿，坚决终止文档复审循环，直接推进至源码实现与自动化测试落地阶段。在代码与测试全部就绪后，再进入针对真实代码实现的独立审查闭环。
2. **安全熔断与分级轮次上限（Safeguard & Tiered Review Loop Limits）**：
   - **纯技术方案 / 架构调研 / 文档审查**：**严格限制最多 3 轮**（`Round <= 3`）。杜绝在方案阶段过度推演、把 Markdown 当编译器审计造成的“分析瘫痪”与无休止拉扯。到第 3 轮只要方向可行即可收敛，必须将精力转移至代码编写与测试实测。
   - **真实代码实现审查**（包含 `src/`、`server/`、`tests/` 代码变更）：**最多允许 10 轮**高强度对抗性自愈循环。若达到 10 轮仍存在分歧或未通过，自动中断循环，整理双方论据向用户汇报，由用户裁决。

---

## 5. 常用命令速查

```bash
npm run dev         # 启动开发服务器 + 内置 /api/cache (http://127.0.0.1:5173)
npm run server      # 生产后端：服务 dist 静态文件 + /api/cache
npm run build       # 生产构建打包
npm run lint        # ESLint 语法与规范检查
npm test            # QUnit 单元测试
npm run e2e         # Playwright 浏览器端到端测试
npm run ci          # 完整 CI 门禁 (lint + test + e2e + build)
```

---

## 6. 线上排障诊断

- **诊断日志读取**：`curl.exe -fsS --max-time 15 https://market.yagu.ddns-ip.net/api/cache/diagnostics`（网页辅助：`https://market.yagu.ddns-ip.net/logs.html`）。
- **排障原则**：优先在本机根据错误堆栈实际调用同一接口复现排查；详细字段契约与安全说明见 [`docs/diagnostics.md`](docs/diagnostics.md)。
