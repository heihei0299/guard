# ADR-0007: Replace Guard with Guard Mode (Plan Mode)

将 Guard 扩展从"技能后禁止写操作"的三态守卫 + 规则引擎 + 路径白名单架构，
改造为 Codex 风格的 Guard Mode（Plan Mode）协作模式，实现只读规划 + 结构化 plan 提交流程。
**Status**: accepted

**Supersedes**: ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006

## Context

原有的 Guard 扩展经过多次迭代，从三态状态机（ADR-0001）→ bash 命令分类（ADR-0002）→
路径白名单（ADR-0003）→ bash 路径白名单（ADR-0004）→ 简化 bash 权限（ADR-0005）→
规则引擎（ADR-0006，未实施），变得越来越复杂。

核心问题在于：Guard 尝试解决"技能对话后防止 AI 擅自写文件"这个具体问题，却演化出了
一套通用的权限规则引擎。而 pi 生态中已经有 pi-permission-system 在做权限控制。

与此同时，`@narumitw/pi-plan-mode` 展示了另一种思路：
- 不是"阻止坏行为"（pessimistic），而是"创建一个只读规划空间"（optimistic）
- 不是用复杂的规则引擎表达约束，而是用简单的工具策略 + bash 安全策略
- 增加了结构化 plan 提交流程（`plan_mode_question` → 探索 → `plan_mode_complete`）
- 提供了完整的违规处理链（tool_call 拦截 → agent_end 验证 → context 清理）

## Decision

### 架构变更

将 Guard 扩展完全改造为 Guard Mode（Plan Mode）扩展：

```
旧 Guard 架构：
  状态机 (normal/skill_active/guarded) → 规则引擎 → 路径白名单 + bash 分类器 → prompt 注入

新 Guard Mode 架构：
  Guard 状态 (enabled/disabled) → Tool Policy → Bash Safety → Context Filtering → Prompt
```
新 Plan Mode 架构：
  PlanMode 状态 (enabled/disabled) → Tool Policy → Bash Safety → Context Filtering → Prompt
```

### 状态模型从三态变为扁平

旧（ADR-0001）：
```
normal → skill_active → guarded (+ rule engine)
```

新：
```
Guard disabled ←→ Guard enabled
                   ├── planning（探索、提问、起草）
                   ├── plan ready（plan 已完成待处理）
                   └── implementing（Guard Mode 关闭，plan 在生效）
```

新：
```
Plan Mode disabled ←→ Plan Mode enabled
                           ├── planning（探索、提问、起草）
                           ├── plan ready（plan 已完成待处理）
                           └── implementing（Plan Mode 关闭，plan 在生效）
```

关键变化：
- **移除 rule engine** —— 不再用声明式规则评估 allow/ask/deny
- **路径白名单重构** —— 从旧 Guard 的 rule-engine 白名单改为 native Plan Mode 白名单：`.scratch/`、`docs/`、`CONTEXT.md` 在 Guard Mode 中仍可写
- **移除 bash 命令分类器** —— 不再维护 readonly/write 命令列表
- **移除规则注入 prompt** —— 不再向 system prompt 注入规则 JSON
- **移除 `/guard-start` 和 `/guard:allow`** —— 改为 `/guard` 系列命令
- **移除 `isTargetSkill()`** —— 不再检测技能命令自动激活

### 新增的能力

| 能力 | 说明 |
|------|------|
| `plan_mode_question` 工具 | AI 向用户提 1-3 个结构化问题，每个 2-4 个选项 |
| `plan_mode_complete` 工具 | AI 提交完整 plan，Guard Mode 进入 ready 状态 |
| `/guard` 命令 | 含 show/finalize/implement/exit/tools 子命令 |
| `--guard` 标志 | 启动时直接进入 Guard Mode |
| Bash 安全策略 | 基于静态分析的细粒度 bash 安全检查 |
| 上下文消息过滤 | 非 Guard Mode 时自动剥离 plan artifacts |
| 状态持久化 | Session 状态保存和恢复 |
| TUI 状态展示 | Statusline 显示 guard active/ready/implementing |
| Subagent 白名单 | 可选限制规划阶段可用的 subagent 角色 |

### 合并后的文件结构

```
src/
├── index.ts               # 扩展入口，事件注册 + 命令注册 + 工具注册
├── plan-mode.ts           # 状态管理（enabled、latestPlan、activeImplementation）
├── tool-policy.ts         # 工具策略分类 + bash 安全策略 + 路径白名单
├── question-tool.ts       # plan_mode_question 工具实现
├── completion-tool.ts     # plan_mode_complete 工具实现
├── prompt.ts              # Guard Mode system prompt 构建
├── message-transform.ts   # 上下文消息过滤（strip plan artifacts）
├── state.ts               # Session 状态持久化（appendEntry + restore）
├── settings.ts            # 配置文件加载（~/.pi/agent/pi-guard.json）
├── command.ts             # /guard 命令参数补全
├── presentation.ts        # TUI statusline/widget 更新
├── subagent-policy.ts     # Subagent 白名单检查
├── tool-selection.ts      # 工具选择工具函数
├── required-tools.ts      # Guard Mode 必需工具管理
├── extension-runtime.ts   # agent_settled + thinkingLevel 适配
└── active-implementation-menu.ts  # 实现中状态的交互菜单
```

### 删除的文件

```
src/guard.ts                 → 由 plan-mode.ts 替代
src/config.ts                → 由 settings.ts 替代
src/rule-engine.ts           → 不再需要
src/bash-command-classifier.ts → 由 tool-policy.ts 中的 isSafeCommand() 替代
src/path-normalizer.ts       → 不再需要
src/permission-config.ts     → 不再需要
src/prompt-injector.ts       → 由 prompt.ts 替代
对应的 .test.ts 文件          → 由新测试文件替代
```

## Consequences

- 扩展行为从"拦截坏操作"变为"创建带白名单的规划空间"——写操作仅放行 `.scratch/`、`docs/`、`CONTEXT.md`
- 移除了 2 个核心模块（rule-engine、bash-command-classifier）和对应的测试，代码量减少
- **路径白名单保留**：`.scratch/`、`docs/`、`CONTEXT.md` 在 Guard Mode 中仍可写，
  确保 wayfinder（创建 tickets）和 domain-modeling（创建 ADRs）正常工作
- 需要用户学习新的 `/guard` 命令体系，不再有 `/guard-start` 和 `/guard:allow`
- 不再自动检测技能命令——用户必须手动 `/guard` 进入规划模式
- 配置方式改变：从 `~/.pi/agent/pi-guard.json` 改为 `~/.pi/agent/pi-guard.json`（保持同名简化迁移）
- 原有的"技能后自动激活"机制被移除——Guard Mode 是用户显式进入的
- Bash 安全检查更严格但不更复杂——移除了命令列表维护，改为策略规则
- Session resume 能力保留——通过状态持久化机制

## Related ADRs

- ADR-0001: Three-State Guard State Machine (superseded)
- ADR-0002: Bash Command Classification (superseded)
- ADR-0003: Path Allowlist (superseded)
- ADR-0004: Bash Path Allowlist (superseded)
- ADR-0005: Simplify Bash Permission (superseded)
- ADR-0006: Rules Engine Architecture (superseded)
- ADR-0008: Plan Mode Tool Policy and Bash Safety
- ADR-0009: Plan Mode Context Management and State Persistence
- ADR-0010: Plan Mode AI Violation Handling
