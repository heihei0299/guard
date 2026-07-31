# Spec: Guard 工具改名，实现与 @narumitw/pi-plan-mode 共存

Status: ready-for-agent

## Problem Statement

用户的 Pi 环境同时安装了 guard 扩展（git 安装）和 `@narumitw/pi-plan-mode`（npm 安装）。
两个扩展注册了完全同名的两个工具：`plan_mode_question` 和 `plan_mode_complete`。

Pi 宿主（`@earendil-works/pi-coding-agent`）对同名工具的处理是"先注册者胜出、静默丢弃后者"：
- `registerTool()` 各自注册、无冲突报错；
- `getAllRegisteredTools()` 按工具名去重，后注册的同名工具被静默丢弃，无警告、无诊断；
- 加载顺序为 project 扩展 → `agentDir/extensions/` → `settings.json` packages 顺序，而
  `@narumitw/pi-plan-mode` 排在 guard 之前。

后果：guard 的 `plan_mode_question` / `plan_mode_complete` 工具定义被 pi-plan-mode 的同名工具
shadow，模型实际调用的是 pi-plan-mode 的实现。guard 的工具 `execute`（`state.enabled` 检查、
`acceptCompletedPlan`、提问 UI 菜单）永远不会执行，而 guard 的 `tool_call` / `tool_result`
事件拦截仍然生效——形成"guard 的违规拦截逻辑作用在 pi-plan-mode 的工具上"的混合态。

## Solution

guard 的工具改名为 `guard_mode_question` / `guard_mode_complete`（常量同步改为
`GUARD_MODE_QUESTION_TOOL_NAME` / `GUARD_MODE_COMPLETE_TOOL_NAME`），与 pi-plan-mode 的工具名
彻底区分，实现两个扩展共存。持久化状态对新旧两个工具名做双名解析，保证旧会话数据不丢失。

## User Stories

1. 作为同时安装两个扩展的用户，我想 guard 的规划工具在宿主注册后不再被 pi-plan-mode 的同名工具 shadow，以便 Guard Mode 的完整流程（enabled 检查、提问 UI、计划提交）真正生效。
2. 作为用户，我想模型在 Guard Mode 中调用 `guard_mode_question` 时执行的是 guard 自己的实现，以便提问走 guard 的 1-3 题/2-4 选项校验和 UI 菜单。
3. 作为用户，我想模型调用 `guard_mode_complete` 后进入 plan ready 状态，以便随后可以 `/guard implement` 或 `/guard show`。
4. 作为用户，我想在 Guard Mode 未激活时调用 `guard_mode_question` / `guard_mode_complete` 得到明确的拒绝（工具仅限 Guard Mode 激活期间使用），以便不会误用。
5. 作为用户，我想恢复旧会话时，之前通过 `plan_mode_complete` 提交的计划仍能恢复为 `latestPlan`，以便改名不丢失历史计划。
6. 作为用户，我想新写入的持久化状态用 `guard_mode_complete` 记录来源，以便与 pi-plan-mode 的数据可区分。
7. 作为用户，我想 pi-plan-mode 的 `plan_mode_question` / `plan_mode_complete` 在它自己的模式中继续正常工作，以便共存没有回归。
8. 作为用户，我想 guard 的 `tool_call` 事件拦截不拦截 pi-plan-mode 的工具（自定义工具分类为 `user-opt-in`），以便两个扩展的事件钩子互不干扰。
9. 作为用户，我想 Guard Mode 激活时模型默认看不到 pi-plan-mode 的规划工具（默认工具集合只含内置工具），以便模型不会混淆该调用哪一套工具。
10. 作为用户，我想 Guard Mode 的 prompt 指令使用 `guard_mode_question` / `guard_mode_complete` 名字，以便模型按正确工具名行动。
11. 作为用户，我想 Guard Mode 未激活时的上下文过滤对新的 `guard_mode_complete` / `guard_mode_question` 记录生效，以便 plan artifacts 不污染非 Guard Mode 的推理。
12. 作为维护者，我想看到一份 ADR 记录"为什么工具不叫 `plan_mode_*`"，以便未来读者不会试图把它们改回去或继续沿用旧名。
13. 作为维护者，我想 README 和 spec 等文档同步新工具名，以便使用者不会用错名字。

## Implementation Decisions

- **工具名与常量**：`plan_mode_question` → `guard_mode_question`，`plan_mode_complete` →
  `guard_mode_complete`；常量 `PLAN_MODE_QUESTION_TOOL_NAME` → `GUARD_MODE_QUESTION_TOOL_NAME`、
  `PLAN_MODE_COMPLETE_TOOL_NAME` → `GUARD_MODE_COMPLETE_TOOL_NAME`。所有运行时引用
  （工具注册、必需工具管理、事件拦截、上下文过滤）均通过常量，改名后自动生效。
- **Prompt 文本**：prompt 中所有模型可见的指令文本（promptGuidelines、步骤说明等约十余处）
  同步为 `guard_mode_*`，与注册名严格一致。
- **持久化双名兼容**：`PlanCompletionSource` 扩展为
  `"guard_mode_complete" | "plan_mode_complete" | "legacy_proposed_plan"`；解析函数同时接受
  新旧两个名字——新写入用 `guard_mode_complete`，旧会话数据中的 `plan_mode_complete` 仍能
  正确恢复 `latestPlan`。
- **错误码不变**：`plan_mode_inactive` / `ui_unavailable` 是 guard 内部字符串，不与
  pi-plan-mode 冲突，保持不变。
- **事件拦截语义不变**：guard 的 `tool_call` 拦截把自定义工具分类为 `user-opt-in`，本就
  不拦截 pi-plan-mode 的工具；改名后不引入新的拦截逻辑。
- **文档同步**：两份 README、`.scratch/guard-plan-mode/spec.md` 中的工具名同步为新名。
  ADR-0011 已记录本决策（accepted）；ADR-0007~0010 保持历史原样；CONTEXT.md 已更新为
  Guard Mode 架构术语（含 `guard_mode_question` / `guard_mode_complete` 及 `_Avoid_` 旧名）。
- **行为不变**：本改动是纯改名，不改变任何工具行为、策略分类、路径白名单或状态机语义。

## Testing Decisions

好的测试只断言外部可观察行为（注册的工具名、工具执行结果、状态恢复结果），不触及实现细节。

- **主 seam——`createMockPi()` 集成测试（沿用 `index.test.ts` 模式）**：
  - 断言 `createGuard()` 注册的工具名为 `guard_mode_question` / `guard_mode_complete`；
  - 断言 `/guard` 命令族（进入、show、finalize、implement、exit、tools）行为不变；
  - 断言 Guard Mode 激活时默认工具集合包含新工具名；
  - 断言 context filtering 对新的 `guard_mode_complete` / `guard_mode_question` 记录剥离生效；
  - 断言 Guard Mode 未激活时调用新工具返回明确拒绝。
- **辅助 seam——`state.test.ts` 纯函数测试**：
  - 新名 `guard_mode_complete` 写入后可正确解析；
  - 旧数据 `plan_mode_complete` 仍能解析并恢复 `latestPlan`；
  - `legacy_proposed_plan` 路径回归不破坏。
- **先例**：`index.test.ts`（55 个 it，mock 集成）、`state.test.ts`（23 个 it，纯函数）、
  `message-transform.test.ts`（33 个 it）。所有断言中硬编码的旧工具名一并更新。

## Out of Scope

- 卸载 `@narumitw/pi-plan-mode`（已决策保留共存）。
- 调整宿主扩展加载顺序（脆弱方案，已否决）。
- 注册时检测同名工具并跳过（guard 功能依旧不可用，已否决）。
- 旧会话历史消息的改写或迁移——历史消息中 `plan_mode_complete` 记录的残留被接受，
  仅通过持久化双名解析缓解状态丢失。
- 修改任何工具行为、策略分类、路径白名单、状态机语义。
- pi-permission-system 集成。
- CONTEXT.md 与 ADR 的更新（已完成，不在实施范围）。

## Further Notes

- 环境事实：宿主对同名工具"先注册者胜出、静默丢弃"，是本次改名的根本原因；
  `conflict-repro.sh` 可从"检测冲突"反转为"验证无冲突"的回归检查（guard 用 `guard_mode_*`、
  plan-mode 用 `plan_mode_*`，断言两者不同）。
- 实施顺序建议：先改工具名与常量 → 持久化双名兼容 → 测试更新 → README/spec 同步 →
  全量验证（vitest + tsc --noEmit）。
