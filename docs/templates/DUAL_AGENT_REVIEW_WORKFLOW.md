# 双智能体审查与自愈协作流程模板 (Dual-Agent Review Loop Template)

> **使用指南**：
> 本模板用于在任何项目中建立**「主开发者（如 Antigravity）编写 ➔ 独立审查员（如 WorkBuddy）质检 ➔ 自动反馈与自愈」**的闭环协同机制。
> **接入两步法**：
> 1. **工作区探测**：通过 `workbuddy_cli.py projects` 确认 WorkBuddy 宿主路径，填入第 1 节的 `--cwd`；
> 2. **提示词固化**：将第 2 节的 `{REPO_NAME}`（仓库名）和 `{GATE_COMMANDS}`（真实门禁，如 TS 项目为 `npx tsc --noEmit`、`npm run lint` 与 `npm test`；纯 JS 项目为 `npm run lint` 与 `npm test`；Python 项目为 `pytest` 与 `ruff check`）直接替换为确定结果。**固化后日常派发仅允许替换 `{TASK_DESCRIPTION}`，严禁在【审查任务】一节添加任何额外自定义提示词**。

```markdown
## 双智能体协同与代码审查闭环（Antigravity ↔ WorkBuddy）

当主开发智能体（Antigravity）完成功能开发或缺陷修复并推送到 Git 后，自动触发 WorkBuddy 独立审查，形成免人工干预的代码质量自愈闭环：

### 1. 审查派发规则（Dispatch Protocol）
- **WorkBuddy 宿主工作区（cwd）**：`{HOST_WORKSPACE_PATH}`（新项目接入时通过 `projects` 探测并固化；若属父级项目则填父级路径，若为独立项目则填仓库根目录）。
- **目标代码仓库**：`{REPO_NAME}`（如子目录名或仓库名）。
- **派发方式**：调用 `workbuddy-bridge` 技能（指定已固化的 `--cwd`，模型调度与执行策略遵循技能内建规则），以非阻塞后台任务派发，主智能体挂起等待回传。

### 2. 独立审查员标准提示词模板（Reviewer Prompt）
派发给 WorkBuddy 的任务描述必须严格遵循如下标准模板，仅允许将 {TASK_DESCRIPTION} 替换为当前任务简报，严禁在【审查任务】一节中额外添加任何自定义或非标准提示词：

```text
你是独立代码审查员（Independent Code Auditor）。
【审查任务】
Antigravity 刚刚完成了 {REPO_NAME} 仓库的任务「{TASK_DESCRIPTION}」的代码提交并已推送远端。请在仓库目录下执行 `git pull --ff-only` 拉取最新代码，运行基线测试（{GATE_COMMANDS}），并对最新改动及其对整体项目的连带影响（回归风险与系统兼容性）进行严格、独立的质量审查与缺陷核验：
1. 若发现问题：请将缺陷定位、根因与方案写入新 handoff（`docs/handoff/{DATE}-workbuddy-code-review-round{N}-handoff.md`），更新 `STATUS.md` 与 `docs/handoff/INDEX.md`，并执行 `git commit` 与 `git push` 推送远端。
2. 若无问题：简要回复说明审查通过与测试验证结论即可，无需额外生成文档与提交。
```

### 3. 反馈决策与自愈循环（Resolution Loop）
1. **唤醒与判断**：
   - **分支 A（审查通过）**：WorkBuddy 简要回复确认通过且无新增缺陷 handoff ➔ 审查闭环完成，向用户汇报最终成果，流程结束。
   - **分支 B（发现缺陷）**：WorkBuddy 发现问题并推送了新 handoff ➔ 主智能体执行 `git pull --ff-only` 同步交接文档 ➔ 根据 handoff 修复代码并补充测试 ➔ 本地门禁全绿 ➔ `git commit` & `git push` ➔ 再次派发 WorkBuddy 复审（轮次计数 `N = N + 1`）。
2. **安全熔断（Safeguard）**：
   - 最大自动循环次数为 **3 轮**。若达到 3 轮仍存在分歧或未闭环，自动中断循环，整理双方论据向用户汇报，由用户裁决。
```

---

## 核心设计机制说明

1. **零多余提交开销（Zero Overhead on Pass）**：
   - 审查通过时不需要强行生成空洞的交接文档或额外的 Git Commit，直接在对话响应中简要说明结论，避免 Git 历史记录污染。
2. **严格单向令牌（Unidirectional Token）**：
   - 主智能体编码提交期间，审查智能体处于待机状态；
   - 审查智能体运行期间，主智能体挂起等待，严禁跨进程交叉修改业务文件，杜绝 Git 冲突。
3. **闭环自愈契约（Auto-Healing Contract）**：
   - 审查智能体若发现缺陷，负责给出明确的定位、根因与复现证据；
   - 主智能体被唤醒后必须针对性修复缺陷并补充针对性测试，提交后自动送回复审，形成自动化自愈闭环。
