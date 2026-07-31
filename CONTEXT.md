# Pi Guard

Pi 扩展，实现 Guard Mode（Plan Mode）协作模式：用户显式进入只读规划空间，AI 通过结构化问答与计划提交工具完成规划，写操作被限制在白名单路径内。

## Language

**Guard Mode（守卫模式）**:
用户显式激活的只读规划协作模式，通过 `/guard` 命令或 `--guard` 启动标志进入。激活期间写操作仅允许路径白名单内的路径，bash 受安全策略约束，AI 必须通过 `guard_mode_complete` 提交计划才能进入实现阶段。
Guard Mode 是**工作流约束（纪律提醒）而非安全边界**：它防的是"规划阶段顺手改代码"这类疏忽，不承诺防御有意的绕过（symlink、进程逃逸等不在防护范围）。
_Avoid_: 三态守卫、守卫状态机

**Planning（规划阶段）**:
Guard Mode 激活后的阶段，AI 可以探索、提问、起草计划，但不能修改白名单外的文件。此阶段没有独立状态值，是 Guard Mode enabled 时的默认行为。
_Avoid_: 探索模式、起草模式

**Plan Ready（计划就绪）**:
AI 通过 `guard_mode_complete` 提交完整计划后的状态，等待用户决定 implement 或 exit。
plan 的生命周期限于提交它的那一轮 agent 回合：新一轮 agent 开始即清除，AI 必须重新提交；跨轮/跨 session 的恢复仅用于用户展示与 implement/exit 决策。
_Avoid_: 计划完成、待审批

**Implementing（实现阶段）**:
用户选择 `/guard implement` 后进入的阶段，Guard Mode 关闭、计划作为生效计划（Active Implementation）注入上下文指导后续实现。
_Avoid_: 执行模式、实施模式

**`/guard` 命令**:
管理 Guard Mode 的 pi 命令族，子命令：`/guard`（激活）、`/guard show`（查看已提交计划）、`/guard finalize`（要求 AI 提交计划）、`/guard implement`（批准计划并进入实现阶段）、`/guard exit`（退出）、`/guard tools`（选择规划阶段可用的扩展工具）。
_Avoid_: `/guard-start`、`/guard:allow`

**`guard_mode_question` 工具**:
Guard Mode 激活期间 AI 使用的结构化提问工具，向用户提 1-3 个带选项的问题以锁定偏好、权衡或假设。
_Avoid_: `plan_mode_question`

**`guard_mode_complete` 工具**:
Guard Mode 激活期间 AI 使用的计划提交工具，提交决策完整的实现计划供用户审查，必须是最后一个独立动作。
_Avoid_: `plan_mode_complete`

**Tool Policy（工具策略）**:
Guard Mode 对工具的分类管控：`read-only`（放行）、`limited`（bash，受安全策略约束）、`blocked`（拦截，如 `edit`、`update_plan`）、`allowlisted`（`write`/`replace`，仅白名单路径）、`user-opt-in`（扩展工具，默认禁用，用户显式启用）。
_Avoid_: 规则引擎、权限表

**Path Allowlist（路径白名单）**:
Guard Mode 中 `write`/`replace` 仍被放行的路径集合：`.scratch/`（前缀匹配）、`docs/`（前缀匹配）、`CONTEXT.md`（精确匹配）。
_Avoid_: 写白名单、允许路径

**Bash Safety Policy（Bash 安全策略）**:
对 bash 命令的静态分析检查：分割复合命令、拦截 shell 展开与重定向、按已知只读命令和结构化命令（`git`、`npm`、`tsc --noEmit` 等）子命令白名单放行，未知命令保守拦截。
_Avoid_: 命令分类器、只读命令列表

**Context Message Filtering（上下文消息过滤）**:
根据 Guard Mode 状态过滤上下文消息的机制：未激活时剥离 plan artifacts（`<proposed_plan>` 块、`guard_mode_complete`/`guard_mode_question` 调用及结果），实现阶段注入生效计划上下文。
_Avoid_: 消息清理、上下文裁剪

**Session State Persistence（会话状态持久化）**:
通过自定义会话条目保存 Guard Mode 状态（enabled、latestPlan、activeImplementation 等），在 session 恢复时精确重建，取代旧的历史文本扫描。
_Avoid_: 状态重建、历史回放

**Active Implementation（生效计划）**:
用户批准后正在执行中的计划。实现阶段注入上下文头部，保证 AI 在编码时始终知道要做什么。
_Avoid_: 进行中计划、实现中计划
