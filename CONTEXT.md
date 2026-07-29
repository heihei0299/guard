# Pi Guard

Pi 扩展，在工具调用层面强制执行"技能对话结束后禁止擅自操作"的策略。

## Language

**Guard（守卫）**:
三态状态机机制，在工具调用层强制执行"技能对话后禁止擅自操作"策略。由 `createStateMachine()` 工厂创建，包含三个状态和明确的状态转移规则。
_Avoid_: 开关、锁、拦截器

**Normal Mode（正常模式）**:
守卫的初始和默认状态。不拦截任何工具调用，所有操作正常放行。
_Avoid_: 关闭状态、未激活

**Skill Active Mode（技能活动模式）**:
守卫检测到用户输入目标技能命令后进入的状态。此模式下所有工具调用均被放行，因为技能自身的正常工作需要完整的工具访问权限。
_Avoid_: 技能中、进行中

**Guarded Mode（守卫模式）**:
技能对话完成（`agent_settled` 事件触发）后自动进入的状态。拦截 write/replace/bash 中的写入意图调用，只放行只读操作和白名单路径的写入。用户可通过 `/guard:allow` 退出此状态。
_Avoid_: 锁定模式、拦截模式

**Target Skill（目标技能）**:
可触发守卫的技能名称。用户的 `/skill:<name>` 命令如果匹配目标技能列表，会将守卫从 normal 切换到 skill_active。默认列表：`to-spec`、`to-tickets`、`grill-me`、`grill-with-docs`、`wayfinder`。
_Avoid_: 受控技能、触发技能

**Path Allowlist（路径白名单）**:
在 guarded 模式下仍允许 write/replace 操作的路径集合。目录路径（以 `/` 结尾）使用前缀匹配，文件路径使用精确匹配。默认包含 `.scratch/`、`docs/`、`CONTEXT.md`。
_Avoid_: 例外路径、放行列表

**Bash Command Classification（Bash 命令分类）**:
将 bash 命令文本通过静态分析（第一 token + 子命令）分类为"只读"（放行）和"写入"（拦截）的策略。未知命令保守拦截。
_Avoid_: Bash 过滤、命令审计

**`/guard:allow` 命令**:
用户手动关闭守卫的 pi 命令。将守卫状态从 guarded 或 skill_active 切换到 normal。调用时通过 `ctx.ui.notify` 显示确认提示。
_Avoid_: 解锁命令、放行命令

**Session Resume（会话恢复）**:
通过扫描会话历史重建守卫状态的能力。在 `session_start` 事件中遍历已有条目，若发现目标技能命令则恢复为 guarded 状态。防止通过结束/恢复会话来绕过守卫。
_Avoid_: 状态重建、历史回放

**Agent Settled（Agent 结算）**:
Pi 框架事件，表示 agent 已完成当前回合的全部处理。守卫利用此事件触发 skill_active → guarded 的状态转移。
_Avoid_: 回合结束、处理完成
