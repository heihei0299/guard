# ADR-0009: Plan Mode Context Management and State Persistence

Plan Mode 通过上下文消息过滤（Context Message Filtering）和会话状态持久化
（Session State Persistence）保证 AI 不会受到 stale plan artifacts 的干扰，
且 Plan Mode 状态在 session resume 后正确恢复。

**Status**: accepted

## Context

原 Guard 在 session resume 时通过 `rebuildFromHistory()` 扫描会话历史来重建状态。
这种方法脆弱且不精确——依赖于遍历所有历史条目的文本内容来猜测状态。

Plan Mode 的 context 管理面临几个挑战：
1. AI 在 Plan Mode 中可能产生大量 plan artifacts（`<proposed_plan>` 块、
   `plan_mode_complete` 调用结果等），这些在非 Plan Mode 时不应出现在上下文中
2. 已接受的 plan 需要在实现阶段持续对 AI 可见
3. Session resume 后 Plan Mode 状态必须精确恢复
4. 实现 handoff 消息不应在后续的规划轮次中干扰 AI

参考 `@narumitw/pi-plan-mode` 的消息过滤和状态持久化设计。

## Decision

### 上下文消息过滤（context event）

在 `context` 事件中，根据 Plan Mode 状态过滤消息：

**Plan Mode 激活时**：
- 移除旧的 `plan-mode-context` 和 `plan-mode-implementation-context` 标记
- 移除 `plan-mode-implementation-handoff` 用户消息
- 注入 Plan Mode system prompt（通过 `before_agent_start` 事件）

**Plan Mode 未激活时**：
- 移除 `plan-mode-context` 和 `plan-mode-implementation-context` 标记
- 移除 `plan-mode-implementation-handoff` 用户消息
- 移除以下 artifact：
  - `proposed-plan` 类型的自定义消息
  - `plan_mode_complete` 工具调用结果
  - `plan_mode_question` 工具调用结果（含 questions 的细节）
  - `<proposed_plan>` XML 块（从 assistant 文本中剥离）
  - `plan_mode_complete` 工具调用（从 assistant content 中剥离）
  - 空的 assistant 消息（内容数组为空的）

**实现阶段（Active Implementation）**：
- 保留最近的 `plan-mode-implementation-handoff` 用户消息
- 注入 `plan-mode-implementation-context` 标记到上下文头部
- 标记内容包含完整 plan 文本

过滤流程：
```typescript
pi.on("context", async (event) => {
  // 1. 移除旧的 context 标记
  const messagesWithoutPlanContext = event.messages.filter(
    (m) => !isLegacyPlanContextArtifact(m) &&
          !isImplementationContextArtifact(m)
  );

  if (state.enabled) {
    // Plan Mode 激活：只移除 handoff
    return { messages: messagesWithoutPlanContext.filter(
      (m) => !isImplementationHandoff(m)
    )};
  }

  // Plan Mode 未激活：移除所有 artifacts
  const messages = messagesWithoutPlanContext
    .filter((m) => !isInactivePlanArtifact(m))  // proposed_plan, completion 结果
    .map(stripProposedPlanBlocks)                 // 从文本中剥离 <proposed_plan>
    .map(stripPlanModeCompletionCalls)             // 从内容中剥离 completion 调用
    .filter((m) => !isEmptyAssistantMessage(m));   // 移除空消息

  // 实现阶段：注入 active implementation 上下文
  return state.activeImplementation
    ? injectActiveImplementationContext(messages, state.activeImplementation)
    : messages;
});
```

### 会话状态持久化

通过 `pi.appendEntry()` 将 Plan Mode 状态保存为自定义会话条目：

```typescript
export interface PlanModeState {
  enabled: boolean;                    // Plan Mode 是否激活
  latestPlan?: string;                 // 最新的已完成 plan
  latestPlanSource?: string;           // plan 来源（completion 工具 / legacy）
  awaitingAction: boolean;             // 是否有待处理的 plan
  activeImplementation?: {             // 当前生效的实现中 plan
    id: string;
    plan: string;
    source: string;
    startedAt: number;
  };
  selectedToolNames?: string[];        // 用户选择的工具列表
  previousThinkingLevel?: string;      // 进入 Plan Mode 前的 thinking level
  appliedThinkingLevel?: string;       // Plan Mode 应用的 thinking level
  manualThinkingLevel?: string;        // 用户手动调整的 thinking level
}
```

存储方式：
```typescript
pi.appendEntry<PlanModeState>("plan-mode-state", state);
```

恢复方式（在 `session_start` 中）：
```typescript
function restorePlanModeState(entries, stateEntryType): PlanModeState {
  // 从后向前扫描，找到最新的 "plan-mode-state" 条目
  // 如果 enabled，从条目 data 中恢复完整状态
  // 如果 enabled 但 latestPlan 缺失，尝试从后续的 completion 工具结果中恢复
  // 如果 disabled，检查 activeImplementation 并恢复
}
```

### Session resume 状态恢复

在 `session_start` 事件中：
1. 递增 `menuGeneration`，中止上一个菜单控制器
2. 调用 `restoreState(ctx)` 从会话记录中恢复 PlanModeState
3. 加载配置文件 `~/.pi/agent/pi-guard.json`
4. 如果 `--guard` flag 被设置，强制激活 Guard Mode
5. 如果状态显示 enabled，调用 `activatePlanModeTools()` + `applyPlanThinkingLevel()`
6. 更新 TUI 状态

### Session shutdown 状态保存

在 `session_shutdown` 事件中：
1. 递增 `menuGeneration`，中止菜单控制器
2. 捕获当前 thinking level
3. 持久化状态
4. 如果 Plan Mode 激活，恢复工具列表和 thinking level
5. 清理 TUI

### 与旧机制的对比

| 方面 | 旧 Guard | 新 Plan Mode |
|------|---------|-------------|
| 状态存储 | 无持久化，通过 `rebuildFromHistory()` 猜测 | `pi.appendEntry()` 精确持久化 |
| Context 过滤 | 无 | 五类 artifact 过滤 |
| Resume 策略 | 扫描历史文本找技能命令 | 读取持久化状态条目 |
| 实现阶段上下文 | 无 | 注入 active implementation plan |
| Thinking level | 无 | Plan Mode 可设置独立 thinking level |

## Consequences

- Session resume 后 Plan Mode 状态精确恢复，不再需要猜测。
- Context 消息过滤防止 plan artifacts 污染非 Plan Mode 的 AI 推理。
- 实现阶段自动注入 plan，AI 在编码时始终知道要做什么。
- 状态持久化增加了扩展初始化时的恢复逻辑复杂度。
- 需要处理 `isStaleExtensionContextError` —— session 替换/重载时 context 会过期。
- Session shutdown 时正确清理资源（恢复工具列表、thinking level）。

## Related ADRs

- ADR-0007: Replace Guard with Plan Mode
- ADR-0010: Plan Mode AI Violation Handling
