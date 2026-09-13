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
- **目标目录**：仓库根目录 `D:\AiPrograms\project1\market-voice-alert`。
- **模型调度优先级**：
  1. **优先级 1（首选）**：`deepseek-v4.1-flash`（逻辑与代码审查专精）；
  2. **优先级 2（备选）**：`glm-5.3-flash`（若首选超时、网络故障或不可用时自动降级回退）。
- **派发方式**：调用 `workbuddy-bridge` 技能（CLI `workbuddy_cli.py run` 或 MCP 工具），以非阻塞后台任务派发，Antigravity 挂起等待回传。

### 4.2 WorkBuddy 标准提示词模板（Reviewer Prompt）
派发给 WorkBuddy 的任务描述必须严格遵循以下标准模板：
```text
你现在扮演独立代码审查员（Independent Code Auditor）。

【目标工作区】
当前工作目录为：D:\AiPrograms\project1\market-voice-alert

【审查任务】
Antigravity 刚刚完成了任务「{TASK_DESCRIPTION}」的代码提交并已推送远端。请对最新改动进行严格、独立的质量审查与缺陷核验。

【标准执行流水线】
1. 同步最新代码：执行 `git pull --ff-only`，核对最新 HEAD 提交哈希与 diff。
2. 独立基线复测：执行 `npm run lint` 与 `npm test`，核实提交声称的测试结果是否真实。
3. 深度审查改动：
   - 目标问题是否真正彻底闭环，有无边界遗漏？
   - 是否破坏了现有功能，有无隐蔽 Regression？
   - 是否符合项目规范（ESM、纯函数、单一状态源、内存泄漏防护）？
   - 如发现疑难缺陷或有争议的边界，必须编写独立复现脚本（docs/handoff/{DATE}-review-repro.mjs）。
4. 编写交接文档（docs/handoff/{DATE}-workbuddy-round{N}-code-review-handoff.md）：
   - 必须在文档顶部以结构化格式声明最终裁决：
     ## 审查结论速览
     - **最终裁决**：[VERDICT: PASS] 或 [VERDICT: DEFECTS_FOUND]
     - **缺陷统计**：{N} Critical / {N} Major / {N} Minor / {N} Nit
     - **核心缺陷清单**（若有）：列出问题点、所在行号与影响。
5. 更新与推送：
   - 更新 STATUS.md 记录本轮审查轮次与结论；在 docs/handoff/INDEX.md 登记新文档；
   - 执行 `git add docs/handoff/ STATUS.md`；
   - 执行 `git commit -m "docs(review): WorkBuddy round-{N} code review handoff"` 并 `git push origin <当前分支>`。
```

### 4.3 反馈决策与自愈循环（Resolution Loop）
1. **唤醒与同步**：Antigravity 收到 WorkBuddy 任务完成通知后，立即执行 `git pull --ff-only` 同步新生成的交接文档与脚本。
2. **裁决分支**：
   - **分支 A（通过：[VERDICT: PASS]）**：0 Critical 且 0 Major，且无任何回归缺陷 ➔ 审查闭环通过，向用户汇报最终成果，流程结束。
   - **分支 B（未通过：[VERDICT: DEFECTS_FOUND]）**：存在 Critical/Major 或未闭环缺陷 ➔ 详细分析交接文档与 repro 脚本 ➔ 修复代码并补充单测 ➔ 本地门禁验证 ➔ `git commit` & `git push` ➔ 再次派发 WorkBuddy 审查（进入 round N+1）。
3. **安全熔断（Safeguard）**：
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
