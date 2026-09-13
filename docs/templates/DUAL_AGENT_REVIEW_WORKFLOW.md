# 双智能体审查与自愈协作流程模板 (Dual-Agent Review Loop Template)

> **使用指南**：
> 本模板用于在任何项目中建立**「主开发者（如 Antigravity）编写 ➔ 独立审查员（如 WorkBuddy）质检 ➔ 自动反馈与自愈」**的闭环协同机制。
> 可以直接将下方的核心 Markdown 章节复制并追加至目标项目的 `AGENTS.md`（或 `CLAUDE.md`）中。

```markdown
## 双智能体协同与代码审查闭环（Antigravity ↔ WorkBuddy）

当主开发智能体（Antigravity）完成功能开发或缺陷修复并推送到 Git 后，自动触发 WorkBuddy 独立审查，形成免人工干预的代码质量自愈闭环：

### 1. 审查派发规则（Dispatch Protocol）
- **初始化与工作区探测（Workspace Discovery，初始化配置时执行）**：
  - 在新项目配置或首次引入本流程时，**先查询 WorkBuddy 工作区列表**：调用 `workbuddy_cli.py projects`（或 `wb.list_projects()`）；
  - 检查目标代码仓库物理路径所属的 WorkBuddy 宿主工作区：
    - 若当前仓库位于已存在的工作区内（如父级目录 `{HOST_WORKSPACE}`），**将该宿主工作区作为 `--cwd` 固化写入具体项目的 AGENTS.md**，确保会话直接同步至用户桌面端当前项目窗口并继承项目记忆库，严禁直接传子目录新建隔离项目；
    - 计算出代码仓库相对于该工作区的相对子目录（如 `{REPO_SUBDIR}`），并在提示词中**直接写入确定的结果**；
    - 若未匹配到任何已存在的工作区，则以仓库根目录作为 `--cwd`。
- **派发方式**：调用 `workbuddy-bridge` 技能（直接传入已固化的 `--cwd`），以非阻塞后台任务派发，主智能体挂起等待回传。
- **调度策略**：模型选择、网络重试与执行权限自动遵循 `workbuddy-bridge` 插件规则。

### 2. 独立审查员标准提示词模板（Reviewer Prompt）
派发给 WorkBuddy 的任务描述按如下标准模板组织（在具体项目中使用时，将初始化得出的工作区与仓库子目录确切结果直接填入）：

```text
你是独立代码审查员（Independent Code Auditor）。

【WorkBuddy 主工作区】
当前宿主工作区为：{WORKBUDDY_WORKSPACE}（WorkBuddy 项目根目录）

【目标代码仓库】
审查目标代码位于子目录仓库：{REPO_SUBDIR}（完整路径：{REPO_FULL_PATH}）
注：若仓库即为工作区根目录，直接在当前目录下执行；若为子目录，请先切换至该子目录（例如 `cd {REPO_SUBDIR}`）。

【审查任务】
Antigravity 刚刚完成了任务「{TASK_DESCRIPTION}」的代码提交并已推送远端。请在 {REPO_SUBDIR} 仓库下执行 `git pull --ff-only` 拉取最新代码，运行基线测试（`{LINT_CMD}` 与 `{TEST_CMD}`），并对最新改动进行严格、独立的质量审查与缺陷核验：
1. 若发现问题：请将缺陷定位、根因与方案写入新 handoff（`{REPO_SUBDIR}/docs/handoff/{DATE}-workbuddy-code-review-round{N}-handoff.md`），更新 `STATUS.md` 与 `docs/handoff/INDEX.md`，并在该仓库中执行 `git commit` 与 `git push` 推送远端。
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
