# 双智能体审查与自愈协作流程模板 (Dual-Agent Review Loop Template)

> **使用指南**：
> 本模板用于在任何项目中建立**「主开发者（如 Antigravity）编写 ➔ 独立审查员（如 WorkBuddy）质检 ➔ 自动反馈与自愈」**的闭环协同机制。
> **核心原则**：
> - 审查准则、缺陷分级与证伪方法学全部**外置收敛于 WorkBuddy 技能基座标准文件**，杜绝各项目提示词漂移；
> - 项目内仅配置**宿主工作区绑定**与**6 维上下文调用契约**。

```markdown
## 双智能体协同与代码审查闭环（Antigravity ↔ WorkBuddy）

当主开发智能体（Antigravity）完成功能开发或缺陷修复并推送到 Git 后，自动触发 WorkBuddy 独立审查，形成免人工干预的代码质量自愈闭环：

### 1. 审查派发规则（Dispatch Protocol）
- **WorkBuddy 宿主工作区（cwd）**：`{HOST_WORKSPACE_PATH}`（新项目接入时通过 `projects` 探测并固化；若属父级项目则填父级路径，若为独立项目则填仓库根目录）。
- **目标代码仓库**：`{REPO_NAME}`（如子目录名或仓库名）。
- **派发方式**：调用 `workbuddy-bridge` 技能（指定已固化的 `--cwd`，模型调度与执行策略遵循技能内建规则），以非阻塞后台任务派发，主智能体挂起等待回传。

### 2. 独立审查员提示词规范（Reviewer Prompt Reference）
代码审查提示词已外置并收敛于 WorkBuddy 技能基座的标准规范文件中，项目内仅做路径引用：

- **规范模板文件**：`C:\Users\12915\.gemini\config\plugins\workbuddy-plugin\skills\workbuddy-bridge\code-review-prompt.md`

- **派发调用约定**：
  派发给 WorkBuddy 的任务提示词必须读取上述模板文件，仅允许将模板中的占位符严格替换为当前任务真实上下文：
  - `{GOAL}`：本次任务的核心目标简报
  - `{ACCEPTANCE_CRITERIA}`：本次任务的验收标准
  - `{BASE_SHA}`：本次修改前的基准 Commit SHA
  - `{HEAD_SHA}`：Antigravity 提交并推送的待审 Commit SHA
  - `{SCOPE}`：本次修改涉及的模块与文件范围
  - `{KNOWN_LIMITATIONS}`：本次任务已知限制或技术边界（若无则填“无”）

  严禁在模板之外额外添加任何自定义或非标准提示词，审查员必须严格依据规范执行代码阅读、证伪验证、缺陷分级与交付流转。

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
