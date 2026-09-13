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
- **提交与推送（Push on Delivery）**：
  - 门禁全绿后，仅暂存任务相关文件，执行规范提交（`feat(...)`、`fix(...)`、`docs(...)`）；
  - 立即执行 `git push origin <branch>` 推送至远端，保持本地与远端干净一致。

---

## 4. 双智能体协同与代码审查闭环（Antigravity ↔ WorkBuddy）

当 Antigravity 完成功能开发或缺陷修复并推送到 Git 后，必须按照以下流程触发 WorkBuddy 独立审查，形成自动验证闭环：

### 4.1 审查派发规则（Dispatch Protocol）
- **WorkBuddy 宿主工作区（cwd）**：`D:\AiPrograms\project1`（即用户在 WorkBuddy 桌面端已打开的主项目）。
- **目标代码仓库**：子目录 `market-voice-alert`（完整路径：`D:\AiPrograms\project1\market-voice-alert`）。
- **派发方式**：调用 `workbuddy-bridge` 技能（指定 `--cwd "D:\AiPrograms\project1"`，模型调度与执行策略遵循技能内建规则），以非阻塞后台任务派发，Antigravity 挂起等待回传。

### 4.2 WorkBuddy 标准提示词（Reviewer Prompt）
派发给 WorkBuddy 的任务描述按如下模板组织（直接固化本项目已确定的工作区与仓库子目录）：
```text
你是独立代码审查员（Independent Code Auditor）。

【WorkBuddy 主工作区】
当前宿主工作区为：D:\AiPrograms\project1（WorkBuddy project1 项目根目录）

【目标代码仓库】
审查目标代码位于子目录仓库：market-voice-alert（完整路径：D:\AiPrograms\project1\market-voice-alert）
注：请在子目录仓库 market-voice-alert 下（例如执行 `cd market-voice-alert`）执行以下审查与门禁操作。

【审查任务】
Antigravity 刚刚完成了任务「{TASK_DESCRIPTION}」的代码提交并已推送远端。请在 market-voice-alert 仓库下执行 `git pull --ff-only` 拉取最新代码，运行基线测试（`npm run lint` 与 `npm test`），并对最新改动进行严格、独立的质量审查与缺陷核验：
1. 若发现问题：请将缺陷定位、根因与方案写入新 handoff（`market-voice-alert/docs/handoff/{DATE}-workbuddy-code-review-round{N}-handoff.md`），更新 `STATUS.md` 与 `docs/handoff/INDEX.md`，并在 market-voice-alert 仓库中执行 `git commit` 与 `git push` 推送远端。
2. 若无问题：简要回复说明审查通过与测试验证结论即可，无需额外生成文档与提交。
```

### 4.3 反馈决策与自愈循环（Resolution Loop）
1. **唤醒与判断**：
   - **分支 A（无问题）**：WorkBuddy 回复确认审查通过，且无新增缺陷 handoff ➔ 审查闭环通过，向用户汇报最终成果，流程结束。
   - **分支 B（有缺陷）**：WorkBuddy 发现了问题并推送了新 handoff ➔ Antigravity 执行 `git pull --ff-only` 同步交接文档 ➔ 根据 handoff 修改代码并补充测试 ➔ 本地门禁验证 ➔ `git commit` & `git push` ➔ 再次派发 WorkBuddy 审查（进入 round N+1）。
2. **安全熔断（Safeguard）**：
   - 最大自动循环次数为 **3 轮**。若达到 3 轮仍存在分歧或未通过，自动中断循环，整理双方论据向用户汇报，由用户裁决。

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
