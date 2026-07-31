# ADR-0010: Plan Mode AI Violation Handling

Plan Mode 通过 5 层机制处理 AI 违规行为：tool_call 硬阻断 → agent_end 后验证 →
before_agent_start 状态重置 → context 消息过滤 → TUI 状态提示。

**Status**: accepted

## Context

原 Guard 处理 AI 违规的方式比较粗糙：
- 在 `tool_call` 事件中拦截操作，调用 `ctx.abort()` + `ctx.ui.notify()` + 返回 `{ block, reason }`
- 没有 agent_end 验证——AI 输出的 plan 格式是否正确不会被检查
- 没有 context 清理——被拦截的操作残留可能出现在后续上下文中
- 没有状态重置——AI 可以在下一轮继续尝试违规行为

Plan Mode 需要更完善的违规处理机制，因为：
1. **违规类型更多**：除了写文件和危险 bash，还有 invalid plan 格式、空的 plan、
   多个 plan 块、未闭合的 XML 标签等
2. **违规后果更复杂**：违规划分为"操作时违规"（tool_call）和"输出时违规"（agent_end）
3. **恢复成本更低**：不调用 `ctx.abort()`，让 AI 可以从错误中自然恢复

参考 `@narumitw/pi-plan-mode` 的五层处理链。

## Decision

### 第 1 层：tool_call 硬阻断

Plan Mode 激活时，在 `tool_call` 事件中拦截违禁操作：

```typescript
pi.on("tool_call", async (event) => {
  if (!state.enabled) return;  // Plan Mode 关闭时不拦截

  // (a) update_plan 直接阻止
  if (event.toolName === "update_plan") {
    return { block: true, reason: "Plan mode blocks update_plan..." };
  }

  // (b) subagent 白名单检查（如果配置了）
  if (settings.allowedPlanSubagents !== undefined) {
    const blocked = enforcePlanSubagentAllowlist(event.toolName, event.input, settings.allowedPlanSubagents);
    if (blocked) return blocked;
  }

  // (c) 工具策略检查 + 路径白名单
  const calledTool = toolByName(event.toolName);
  if (calledTool && classifyPlanModeTool(calledTool) === "blocked") {
    return { block: true, reason: `Plan mode blocks tool '${event.toolName}'...` };
  }
  if (calledTool && classifyPlanModeTool(calledTool) === "allowlisted") {
    // write/replace: 检查路径白名单
    const path = event.input?.path;
    if (path && isPathAllowed(path, ALLOWLIST_PATHS)) {
      return; // 放行
    }
    return { block: true, reason: `Plan mode blocks write to '${path}'. Allowed: .scratch/, docs/, CONTEXT.md` };
  }

  // (d) bash 安全策略
  if (event.toolName === "bash") {
    const command = readCommand(event.input);
    if (!isSafeCommand(command)) {
      return { block: true, reason: `Plan mode blocks unsafe bash command.\nCommand: ${command}` };
    }
  }
});
```

关键设计决策：
- **不调用 `ctx.abort()`** —— 依赖 pi 框架对 `{ block: true }` 的内置处理
- **不调用 `ctx.ui.notify()`** —— block reason 由框架自动展示给用户
- **Plan Mode 关闭时完全不拦截** —— 零性能开销
- **返回 `{ block, reason }` 即可** —— pi 框架自动中止当前 turn

### 第 2 层：agent_end 后验证

AI 每个 assistant 回复都会被扫描。如果包含了 `<proposed_plan>` 标签，验证其格式：

```typescript
pi.on("agent_end", async (event, ctx) => {
  if (!state.enabled) return;

  const text = latestAssistantText(event.messages);
  const parsedPlan = parseProposedPlan(text);

  if (parsedPlan.kind !== "valid") {
    if (parsedPlan.kind !== "absent") {
      ctx.ui.notify(invalidPlanMessage(parsedPlan.kind), "warning");
    }
    return;  // 不合规的 plan 被静默忽略
  }

  acceptCompletedPlan(parsedPlan.plan, "legacy_proposed_plan", ctx);
});
```

验证结果：

| 结果 | 含义 | 处理 |
|------|------|------|
| `"absent"` | 没有 plan 块 | 静默忽略（AI 可能在提问） |
| `"valid"` | 有且仅有一个非空 plan 块 | 接受，Plan Mode → plan ready |
| `"empty"` | plan 块内容为空 | 警告："the block is empty" |
| `"multiple"` | 多于一个 plan 块 | 警告："more than one plan block was produced" |
| `"malformed"` | 标签不在独立行上 | 警告："the tags must be on their own lines" |
| `"unclosed"` | 缺少闭合标签 | 警告："the closing tag is missing" |

**注意**：`plan_mode_complete` 工具的 plan 在工具执行阶段验证（`normalizePlanModeCompletion`），
不在 agent_end 中再次验证。agent_end 只验证 legacy `<proposed_plan>` 格式。

### 第 3 层：before_agent_start 状态重置

每轮 agent 开始前，清除上一轮的 pending plan：

```typescript
pi.on("before_agent_start", (event, ctx) => {
  if (state.latestPlan || state.awaitingAction) {
    state = { ...state, latestPlan: undefined, latestPlanSource: undefined, awaitingAction: false };
    persistState();
    updateUi(ctx);
  }
  // 注入 Plan Mode system prompt
  return { systemPrompt: `${event.systemPrompt}\n\n${buildPlanModePrompt()}` };
});
```

这样 AI 不能"偷偷留下一份 plan 然后下一轮继续"——
每轮都必须重新用 `plan_mode_complete` 提交 plan。

### 第 4 层：context 消息过滤

在 `context` 事件中，非 Plan Mode 时自动剥离所有 plan artifacts：

```typescript
pi.on("context", async (event) => {
  // Plan Mode 未激活时：
  const messages = inactiveMessages
    .filter((m) => !messageContainsInactivePlanModeArtifact(m))   // proposed_plan + completion 结果
    .map(stripProposedPlanBlocksFromMessage)                        // <proposed_plan> 块
    .map(stripPlanModeCompletionCallsFromMessage)                   // plan_mode_complete 调用
    .filter((m) => !isEmptyAssistantMessage(m));                    // 空 assistant
  return { messages };
});
```

防止以下污染：
- 之前的违规操作残留（如被拦截的 write 调用结果）
- 旧的 plan 块在非规划上下文中误导 AI
- 空 assistant 消息浪费 token

### 第 5 层：TUI 状态提示

通过 `ctx.ui.setStatus()` 和 `ctx.ui.setWidget()` 持续展示当前模式：

| 状态 | Status | Widget | 说明 |
|------|--------|--------|------|
| Plan mode 规划中 | `plan active` | "Plan mode: planning" + tool summary | 可见但无可执行的 plan |
| Plan 已完成 | `plan ready` | "Proposed plan ready" + 使用说明 | 有 plan 待处理 |
| 实现中 | `plan implementing` | "Implementation plan active" + 使用说明 | Plan Mode 关闭 |
| Plan Mode 关闭 | 无 | 无 | 正常模式 |

### 与旧 Guard 的对比

| 方面 | 旧 Guard | 新 Plan Mode |
|------|---------|-------------|
| tool_call 拦截 | `ctx.abort()` + `ctx.ui.notify()` + `{ block, reason }` | 仅返回 `{ block, reason }` |
| 写文件策略 | 路径白名单例外 | **路径白名单放行，其余拦截** |
| agent_end 验证 | 无 | 5 种 plan 格式验证 |
| before_agent_start | 无 | 清除 pending plan |
| context 过滤 | 无 | 5 类 artifact 过滤 |
| TUI 提示 | `ctx.ui.notify()` 单次通知 | 持续 statusline + widget 展示 |
| 违规后恢复 | turn 被中止，AI 无法继续 | turn 中止但 AI 可自然重试 |
| 绕过风险 | session resume 可能丢失状态 | 状态持久化 + context 过滤双重保护 |
| 扩展工具 | 默认放行 | 默认禁用，用户 opt-in |

## Consequences

- AI 违规后的用户体验更好：block reason 由框架展示，AI 可以自然地从错误中恢复。
- 5 层机制各有侧重：tool_call 阻止即时操作，agent_end 验证输出质量，
  before_agent_start 重置状态，context 过滤清理残留，TUI 提供可见性。
- **tool_call 层增加了路径白名单检查**：write/replace 工具在白名单路径（`.scratch/`、`docs/`、`CONTEXT.md`）
  上放行，其余路径拦截。edit 和 update_plan 仍然完全拦截。
- 不再需要 `ctx.abort()` 调用——框架自动处理 turn 中止。
- agent_end 验证只针对 legacy `<proposed_plan>` 格式，`plan_mode_complete`
  工具的验证在执行时完成。
- 状态重置确保了 plan 提交的原子性：AI 不能跨轮积累 plan。
- Context 过滤是安全的最后一道防线——即使前 4 层有漏洞，stale artifacts
  也不会污染后续上下文。

## Related ADRs

- ADR-0007: Replace Guard with Plan Mode
- ADR-0008: Plan Mode Tool Policy and Bash Safety
- ADR-0009: Plan Mode Context Management and State Persistence
