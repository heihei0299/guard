# ADR-0011: Guard Tools Renaming for Coexistence with @narumitw/pi-plan-mode

将 guard 扩展的两个规划工具 `plan_mode_question` / `plan_mode_complete` 改名为
`guard_mode_question` / `guard_mode_complete`，以便与 npm 安装的 `@narumitw/pi-plan-mode`
（注册同名工具）共存，而不是卸载其中一方。

**Status**: accepted

## Context

用户的 Pi 环境同时安装了 guard（git 安装，`https://github.com/heihei0299/guard`）和
`@narumitw/pi-plan-mode`（npm 安装，`~/.pi/agent/settings.json` 的 `packages` 列表）。
两个扩展都注册 `plan_mode_question` / `plan_mode_complete` 两个工具。

Pi 宿主（`@earendil-works/pi-coding-agent`）对同名工具的处理是**先注册者胜出、静默丢弃后者**：

- `registerTool()` 各自写入扩展自己的 tools map，无冲突报错；
- `getAllRegisteredTools()` 按工具名去重，后注册的同名工具被直接丢弃，**无警告、无诊断**；
- 加载顺序为 project 扩展 → `agentDir/extensions/` → `settings.json` packages 顺序，
  而 `@narumitw/pi-plan-mode` 在 packages 列表中排在 guard 之前。

后果：guard 的 `plan_mode_question` / `plan_mode_complete` 工具定义被 pi-plan-mode 的同名工具
静默 shadow，模型实际调用的是 pi-plan-mode 的实现。guard 的工具 `execute`（`state.enabled`
检查、`acceptCompletedPlan`、提问 UI 菜单）永远不会执行，而 guard 的 `tool_call` / `tool_result`
**事件拦截**仍然生效——形成"guard 的违规拦截逻辑作用在 pi-plan-mode 的工具上"的混合态。

## Decision

两者共存，guard 的工具改名：

- `plan_mode_question` → `guard_mode_question`
- `plan_mode_complete` → `guard_mode_complete`
- 常量同步改为 `GUARD_MODE_QUESTION_TOOL_NAME` / `GUARD_MODE_COMPLETE_TOOL_NAME`

改名后两个扩展的工具名完全不同，宿主去重不再丢弃任何一方；且 pi-plan-mode 的 `tool_call`
拦截按精确工具名匹配，不会误伤 guard 的新工具；guard 的 `tool_call` 拦截将自定义工具分类为
`user-opt-in`，也不会拦截 pi-plan-mode 的工具。Guard Mode 激活时默认工具集合只含内置工具
（`defaultPlanModeToolNames`），模型不会同时看到两套规划工具，除非用户显式 `/guard tools` 加入。

### 持久化兼容

`PlanCompletionSource` 扩展为 `"guard_mode_complete" | "plan_mode_complete" | "legacy_proposed_plan"`，
解析函数同时接受新旧两个名字：新写入使用 `guard_mode_complete`，旧会话数据中的
`plan_mode_complete` 仍能正确恢复 `latestPlan`。

### 同步范围

运行时引用（`required-tools.ts`、`plan-mode.ts`、`message-transform.ts`）、`prompt.ts` 中的
模型指令文本、两份 README、`.scratch/guard-plan-mode/spec.md`、全部测试断言同步为新名。
ADR-0007~0010 保持历史原样（它们记录的是决策当时的状态）；`CONTEXT.md` 作为术语表更新为
Guard Mode 架构措辞。错误码 `plan_mode_inactive` / `ui_unavailable` 为 guard 内部字符串、
不与 pi-plan-mode 冲突，保持不变。

## Considered Options

- **卸载 `@narumitw/pi-plan-mode`**——功能与 guard 完全重叠，且 npm 目录中无其他包依赖它。
  被否：用户选择保留双方，guard 与参考实现共存。
- **只保留 pi-plan-mode**——guard 是自研项目，被否。
- **调整加载顺序让 guard 先注册**——依赖 `settings.json` 的列表顺序，脆弱且不可见，被否。
- **注册时检测同名工具并跳过**——guard 功能依旧不可用，只是不冲突了，被否。

## Consequences

- 模型在 Guard Mode 中调用的是 guard 自己的工具实现，`acceptCompletedPlan` 和提问 UI 恢复生效。
- 工具名是模型可见的公开 API 且写入会话历史，改名不可逆地影响旧会话的上下文过滤
  （message-transform 按新名剥离，旧会话中 `plan_mode_complete` 记录可能残留），
  通过持久化双名解析缓解状态丢失，历史消息残留被接受。
- 文档、prompt、测试需全量同步，避免新旧名字混用。

## Related ADRs

- ADR-0007: Replace Guard with Plan Mode
- ADR-0008: Plan Mode Tool Policy and Bash Safety
- ADR-0009: Plan Mode Context Management and State Persistence
- ADR-0010: Plan Mode AI Violation Handling
