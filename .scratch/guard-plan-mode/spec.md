Status: ready-for-agent

## Problem Statement

当前的 Guard 扩展经过多次迭代（三态状态机 → bash 命令分类 → 路径白名单 → 规则引擎），变得越来越复杂，但核心体验仍然不佳：

- Guard 激活后一刀切拦截写操作，只有硬编码的路径白名单例外
- AI 在被拦截前不知道规则边界，只能通过试错学习
- 不支持结构化规划流程——没有 `/plan` 命令、没有 plan 提交工具
- 不支持上下文消息过滤——被拦截的操作残留会污染后续推理
- 不支持会话状态持久化——session resume 后难以准确恢复之前状态

与此同时，Matt Pocock 技能组（wayfinder、domain-modeling、grill-with-docs 等）需要在规划阶段写入特定文件（`.scratch/`、`docs/adr/`、`CONTEXT.md`），但当前系统无法在保护代码的同时允许这些合法写入。

## Solution

将 Guard 扩展改造为 **Guard Mode（Plan Mode）**协作模式：

- 用 `/guard` 命令替代旧 `/guard-start` 和 `/guard:allow`
- 引入 `guard_mode_question` 和 `guard_mode_complete` 工具，支持结构化规划流程
- 引入五类工具策略（read-only / limited / allowlisted / blocked / user-opt-in）
- 引入基于静态分析的 bash 安全策略（`isSafeCommand()`），替代旧命令列表
- 引入路径白名单（`.scratch/`、`docs/`、`CONTEXT.md`），允许技能写入必要文件
- 引入五层违规处理链（tool_call 阻断 → agent_end 验证 → before_agent_start 重置 → context 过滤 → TUI 提示）
- 引入会话状态持久化（`pi.appendEntry()`），session resume 精确恢复

Guard Mode 不是纯只读模式——它允许写入白名单路径，但阻止对 `src/`、`package.json` 等代码路径的修改。

## User Stories

1. 作为用户，我可以通过 `/guard` 命令进入 Guard Mode，以便在规划阶段获得安全约束
2. 作为用户，我可以通过 `/guard <prompt>` 进入 Guard Mode 并立即提交 prompt，以便快速开始规划
3. 作为用户，我可以通过 `/guard tools` 选择 Guard Mode 中可用的工具，以便自定义规划环境
4. 作为用户，我可以通过 `/guard show` 查看已完成的 plan，以便回顾决策
5. 作为用户，我可以通过 `/guard finalize` 要求 AI 完成 plan，以便推进规划
6. 作为用户，我可以通过 `/guard implement` 将已接受的 plan 交给 AI 实现，以便无缝过渡到编码
7. 作为用户，我可以通过 `/guard exit` 退出 Guard Mode，以便恢复正常操作
8. 作为用户，我可以在启动 pi 时使用 `--guard` 标志直接进入 Guard Mode，以便从一开始就受约束
9. 作为用户，当 AI 在 Guard Mode 中尝试写文件时，只有白名单路径（`.scratch/`、`docs/`、`CONTEXT.md`）被放行，其余被拦截并显示明确原因
10. 作为 wayfinder 用户，AI 可以在 Guard Mode 中创建 `.scratch/` 下的 tickets 和 map，以便推进规划
11. 作为 domain-modeling 用户，AI 可以在 Guard Mode 中写入 `docs/adr/` ADRs 和更新 `CONTEXT.md`，以便记录决策
12. 作为用户，AI 在 Guard Mode 中执行 bash 命令时，危险命令（`rm`、`mv`、`cp`、`chmod` 等）被自动拦截
13. 作为用户，AI 在 Guard Mode 中可以运行安全的检查命令（`git status`、`npm test`、`npx tsc --noEmit` 等），以便验证代码
14. 作为用户，AI 可以通过 `guard_mode_question` 工具向我提出 1-3 个结构化问题，以便解决关键决策
15. 作为用户，AI 可以通过 `guard_mode_complete` 工具提交完整 plan，以便我审查和决定下一步
16. 作为用户，当 session 被 resume 后，Guard Mode 状态（激活/关闭、已完成的 plan）被精确恢复
17. 作为用户，当 Guard Mode 关闭或切换状态时，plan artifacts（`<proposed_plan>` 块、工具调用记录）不会出现在上下文中
18. 作为用户，我可以通过 `~/.pi/agent/pi-guard.json` 配置 Guard Mode 的行为（thinking level、默认工具、subagent 白名单）
19. 作为用户，扩展工具在 Guard Mode 中默认禁用，我可以通过 `/guard tools` 自行承担风险启用
20. 作为用户，Guard Mode 的状态（plan active / plan ready / plan implementing）在 TUI statusline 中持续可见

## Implementation Decisions

### 架构

状态模型从三态（normal → skill_active → guarded）变为扁平状态：

```
Guard disabled ←→ Guard enabled
                   ├── planning（探索、提问、起草）
                   ├── plan ready（plan 已完成待处理）
                   └── implementing（Guard Mode 关闭，plan 在生效）
```

### 模块划分

- **`index.ts`** — 扩展入口，注册事件、命令、工具。对外暴露 `createGuard()` 工厂
- **`plan-mode.ts`** — 状态管理（enabled、latestPlan、awaitingAction、activeImplementation）。核心编排逻辑
- **`tool-policy.ts`** — 五类工具策略 + bash 安全策略 + 路径白名单检查
- **`question-tool.ts`** — `guard_mode_question` 工具参数定义、验证、交互逻辑
- **`completion-tool.ts`** — `guard_mode_complete` 工具参数定义、验证、渲染
- **`prompt.ts`** — Guard Mode system prompt 构建（三阶段引导 + mode rules + 完成规则）
- **`message-transform.ts`** — 上下文消息过滤（strip plan artifacts、检测 stale artifact）
- **`state.ts`** — PlanModeState 类型定义、序列化/反序列化
- **`settings.ts`** — 配置文件加载（`~/.pi/agent/pi-guard.json`）
- **`command.ts`** — `/guard` 命令参数补全
- **`presentation.ts`** — TUI statusline/widget 更新
- **`subagent-policy.ts`** — Subagent 白名单检查
- **`tool-selection.ts`** — 工具比较、名称解析、去重工具函数
- **`required-tools.ts`** — Guard Mode 必需工具管理（guard_mode_question + guard_mode_complete）
- **`extension-runtime.ts`** — agent_settled 事件注册 + thinkingLevel 设置适配
- **`active-implementation-menu.ts`** — 实现状态下的交互菜单

### 工具策略分类

| 分类 | 策略 | 内置工具 |
|------|------|----------|
| `read-only` | 直接放行 | `read`、`grep`、`find`、`ls` |
| `limited` | 受安全策略约束放行 | `bash` |
| `allowlisted` | 路径白名单内放行，其余拦截 | `write`、`replace` |
| `blocked` | 直接拦截 | `edit`、`update_plan` |
| `user-opt-in` | 默认禁用，用户选择后启用 | 所有扩展工具和自定义工具 |

### 路径白名单

| 路径 | 匹配规则 | 用途 |
|------|---------|------|
| `.scratch/` | 目录前缀匹配 | wayfinder 创建 tickets 和 map |
| `docs/` | 目录前缀匹配 | domain-modeling 创建 ADRs |
| `CONTEXT.md` | 文件后缀匹配 | domain-modeling 更新 glossary |

### Bash 安全策略

静态分析命令字符串，按 `;`、`|`、`&&` 分割为段，每段独立检查：
- shell 展开（`$`、`` ` ``、`*`、`?`、`[`、`{`）→ 不安全
- 环境变量赋值（`KEY=value`）→ 不安全
- 已知危险命令（`rm`、`mv`、`cp`、`chmod` 等）→ 不安全
- 重定向（`>`、`>>`、`<`）→ 整段不安全
- 结构化命令（`git status`、`npm test`、`npx tsc --noEmit` 等）→ 参数验证后放行
- 已知只读命令（`cat`、`ls`、`grep`、`echo` 等）→ 直接放行

### 违规处理链（5 层）

1. **tool_call 拦截** — 返回 `{ block: true, reason }`，不调用 `ctx.abort()`
2. **agent_end 验证** — 解析 AI 输出的 `<proposed_plan>` 标签格式（empty/multiple/malformed/unclosed 时 warning）
3. **before_agent_start 重置** — 清除上一轮 pending plan
4. **context 过滤** — 非 Guard Mode 时剥离所有 plan artifacts
5. **TUI 提示** — statusline 显示 guard active/ready/implementing

## Testing Decisions

### 测试原则

- 测试通过 public 接口验证行为，不耦合实现细节
- 纯函数优先——状态管理、工具策略、消息过滤等无副作用的逻辑直接单元测试
- 有副作用的模块（文件读取、UI 交互）通过依赖注入或 mock 测试
- 每个测试一个逻辑断言

### Seams 与测试策略

| Seam | 模块 | 测试方式 | 关键测试内容 |
|------|------|---------|-------------|
| 工具策略 + bash 安全 | `tool-policy.ts` | 纯函数单元测试 | `classifyPlanModeTool()` 正确分类各类工具；`isSafeCommand()` 拦截危险命令、放行安全命令；`isPathAllowed()` 正确匹配白名单 |
| 状态管理 | `state.ts` | 纯函数单元测试 | `restorePlanModeState()` 从 session 条目正确恢复状态；处理缺失/无效数据 |
| Context 过滤 | `message-transform.ts` | 纯函数单元测试 | `parseProposedPlan()` 正确识别 6 种结果；`stripProposedPlanBlocks()` 正确剥离 XML 块 |
| Plan 提交工具 | `question-tool.ts`, `completion-tool.ts` | 参数验证 + 格式化测试 | `normalizePlanModeQuestionParams()` 验证 1-3 个问题和 2-4 个选项；`normalizePlanModeCompletion()` 验证 plan 内容（非空、≤50K 字符） |
| 配置加载 | `settings.ts` | 文件读取 mock | `normalizePlanModeSettings()` 验证 JSON 形状；`readPlanModeSettings()` 处理缺失/无效/有效三种情况 |
| 扩展集成 | `index.ts` | mock ExtensionAPI | 事件注册完整性；命令/工具注册；生命周期流程 |

### 已有测试基础设施

- 测试框架：vitest（已配置，`src/**/*.test.ts` 模式匹配）
- 现有测试风格可参考：`index.test.ts`（mock pi API 的集成测试）、`guard.test.ts`（纯函数状态机测试）
- 本改造将删除旧测试，替换为新模块的测试

## Out of Scope

- npm 发布
- 旧配置自动迁移（`~/.pi/agent/pi-guard.json` → 新格式需手动重新配置）
- `/guard-start` / `/guard:allow` 兼容别名
- pi-permission-system 集成
- 自动检测技能命令并激活 Guard Mode（用户必须手动 `/guard` 进入）
- 路径白名单的运行时修改（编译时固定）
- symlink 解析（Guard 不是安全边界）

## Further Notes

- 包名保持 `pi-guard-extension`，原地改造
- 参考实现：`/home/shial/Project/Pi/guard/pi-extensions/extensions/pi-plan-mode/`
- 所有用户面向消息使用中英双语
- TDD 流程实施中：Ticket 01（Foundation）部分完成（`tool-selection.ts` 通过、`required-tools.ts` 测试已写）
- 实现分 7 个 wayfinder tickets，单个 ticket 内使用 TDD 循环
