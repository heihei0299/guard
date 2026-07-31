# 04 — Infrastructure

**What to build:** 实现 Guard Mode 的基础设施模块——上下文消息过滤（strip plan artifacts）、TUI 状态展示、`/guard` 命令参数补全、subagent 白名单策略、以及活跃实现状态的交互菜单。

**Blocked by:** 02 — Core Logic, 03 — Plan Submission Tools

**Status:** resolved

- [x] `src/message-transform.ts`：`parseProposedPlan()` 解析 legacy `<proposed_plan>` XML 标签（6 种结果）
- [x] `src/message-transform.ts`：`stripProposedPlanBlocks()` / `stripProposedPlanBlocksFromMessage()`
- [x] `src/message-transform.ts`：`stripPlanModeCompletionCallsFromMessage()`
- [x] `src/message-transform.ts`：`messageContainsInactivePlanModeArtifact()`
- [x] `src/message-transform.ts`：`injectActiveImplementationContext()`
- [x] `src/message-transform.ts`：`isEmptyAssistantMessage()`
- [x] `src/presentation.ts`：`updatePlanModeUi()`、`clearPlanModeUi()`、`planModeStatusText()`
- [x] `src/command.ts`：`/guard` 命令参数补全（show/finalize/implement/exit/off/tools）
- [x] `src/subagent-policy.ts`：`enforcePlanSubagentAllowlist()` 子代理白名单检查
- [x] `src/active-implementation-menu.ts`：TUI 交互菜单（show/start new/clear）
- [x] `npx tsc --noEmit` 通过 — 新模块 0 错误（整仓 13 个预存错误均在旧文件 index.ts/index.test.ts/rule-engine.ts，Ticket 05 重写后清零）

## Answer

Ticket 04 已实现 Infrastructure 模块，按 tdd-implement 流程（seams 确认 → 红-绿循环 → typecheck → code-review 双轴 → 修复）完成。

### 新增模块（5 个源码 + 5 个测试文件）

- `src/message-transform.ts` — 上下文消息过滤（33 测试）
  - `parseProposedPlan()`：legacy `<proposed_plan>` XML 解析，6 种结果（absent/valid/empty/multiple/malformed/unclosed）
  - `stripProposedPlanBlocks()` / `stripProposedPlanBlocksFromMessage()`：剥离合法 plan 块（malformed 内联标签不动）
  - `stripPlanModeCompletionCallsFromMessage()`：移除 assistant content 中的 `plan_mode_complete` toolCall 块
  - `messageContainsInactivePlanModeArtifact()`：识别 proposed-plan 自定义消息 + `plan_mode_complete` toolResult
  - `injectActiveImplementationContext()`：移除 stale context 标记与旧 handoff，保留精确匹配的当前 handoff，无匹配时在头部（summary 消息之后）注入 `plan-mode-implementation-context` 标记
  - `isEmptyAssistantMessage()`：assistant + 空 content 数组
  - 辅助导出（Ticket 05 接线需要）：`extractProposedPlan` / `invalidPlanMessage` / `latestAssistantText` / `messageContainsLegacyPlanModeContextArtifact` / `messageContainsPlanModeImplementationContextArtifact` / `messageContainsPlanModeImplementationHandoff`
  - **导出 `PLAN_IMPLEMENTATION_HANDOFF_PREFIX` 常量**（code review 发现）：Ticket 05 的 implement 命令必须用同一常量写 handoff，否则过滤匹配失败
- `src/presentation.ts` — TUI 状态展示（9 测试）：`updatePlanModeUi()`（plan active/plan ready/plan implementing/off 四态 status + widget）、`clearPlanModeUi()`、`planModeStatusText()`
- `src/command.ts` — `/guard` 参数补全（5 测试）：`completePlanArguments()`（show/finalize/implement/exit/off/tools，前缀大小写不敏感匹配，多词/null 返回 null）
- `src/subagent-policy.ts` — 子代理白名单（7 测试）：`enforcePlanSubagentAllowlist()`（覆盖 subagent/subagent_spawn 的 agent/tasks/chain/aggregator 全部形态，无法验证的角色 → block）
- `src/active-implementation-menu.ts` — TUI 交互菜单（2 smoke 测试）：`showActiveImplementationMenu()`（show/start new/clear 三项，基于 `@narumitw/pi-tui-kit` 的 defineMenu/runMenu）

### Code review 修复

- **硬违规**（Standards + Spec 双轴均发现）：面向用户字符串从参考实现的 "Plan mode" 改为项目 CONTEXT.md 规定的 "Guard mode"（`invalidPlanMessage`、subagent 拒绝理由、handoff 前缀），并**导出 `PLAN_IMPLEMENTATION_HANDOFF_PREFIX`** 供 Ticket 05 复用。审查报告存于 `.scratch/guard-plan-mode/reviews/04-standards.md` 与 `04-spec.md`
- 判断项（未修）：TUI 文本仅英文（与参考实现及 Ticket 03 惯例一致）；新模块尚未接线（Ticket 05 负责）

### 测试与类型检查

- 新增 56 个测试全部通过（message-transform 33 + presentation 9 + command 5 + subagent-policy 7 + menu 2）
- 完整套件：16/17 文件通过，318 passed；`index.test.ts` 14 个失败为旧行为测试（预期噪音，Ticket 05 重写 index.ts 时处理）
- `npx tsc --noEmit`：13 个错误全部在旧文件（index.ts ×6 / index.test.ts ×4 / rule-engine.ts ×3），新模块 0 错误
