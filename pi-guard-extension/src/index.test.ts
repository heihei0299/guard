import { describe, it, expect } from "vitest";
import { createGuard } from "./index.ts";
import { createMockPi, createMockContext, builtinTool, extensionTool } from "./test-support.ts";
import type { PlanModeSettingsLoadResult } from "./settings.ts";
type MockToolWithExecute = {
  execute: (...args: unknown[]) => Promise<unknown>;
};

function completionTool(mock: ReturnType<typeof createMockPi>) {
  return mock.tools.find(
    (candidate) => candidate.name === "guard_mode_complete",
  ) as MockToolWithExecute | undefined;
}


describe("createGuard assembly", () => {
  it("returns an extension function", () => {
    expect(typeof createGuard()).toBe("function");
  });

  it("registers the guard flag, both tools, the /guard command, and all event hooks", () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);

    expect(mock.flags.has("guard")).toBe(true);
    expect(mock.tools.map((tool) => tool.name)).toEqual([
      "guard_mode_question",
      "guard_mode_complete",
    ]);
    expect(mock.commands.has("guard")).toBe(true);
    expect(typeof mock.commands.get("guard")?.getArgumentCompletions).toBe("function");

    for (const event of [
      "session_start",
      "thinking_level_select",
      "session_shutdown",
      "tool_call",
      "context",
      "before_agent_start",
      "agent_end",
      "agent_settled",
    ]) {
      expect(mock.events.has(event), `missing event hook: ${event}`).toBe(true);
    }
  });

  it("accepts an options bag with a custom settings loader", () => {
    const readSettings = async () => ({ kind: "missing" as const });
    const mock = createMockPi({ activeTools: ["read"] });
    expect(() => createGuard({ readSettings })(mock.pi)).not.toThrow();
  });
});

describe("/guard command", () => {
  it("enters Guard mode with a bare command and activates required tools", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash", "custom"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });

    await mock.commands.get("guard")?.handler("", context.ctx);

    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(mock.rawPi.getActiveTools()).toEqual([
      "bash",
      "read",
      "guard_mode_question",
      "guard_mode_complete",
    ]);
    expect(context.notifications.at(-1)?.message).toMatch(/Guard mode enabled/);
    expect(context.notifications.at(-1)?.message).not.toMatch(/Plan mode/);
  });

  it("enters Guard mode with an inline prompt and delivers it to the agent", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });

    await mock.commands.get("guard")?.handler("design it", context.ctx);

    expect(mock.sentUserMessages.at(-1)).toEqual({ text: "design it", options: undefined });
    expect(context.statuses.get("plan-mode")).toBe("plan active");
  });

  it("implement without a completed plan fails closed", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });

    await mock.commands.get("guard")?.handler("", context.ctx);
    await expect(mock.commands.get("guard")?.handler("implement", context.ctx)).rejects.toThrow(
      /No completed plan/,
    );

    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(mock.sentUserMessages.length).toBe(0);
  });

  it("notifies instead of rejecting in UI contexts", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: true, select: async () => "Stay in Guard mode" });

    await mock.commands.get("guard")?.handler("", context.ctx);
    await expect(mock.commands.get("guard")?.handler("implement", context.ctx)).resolves.toBeUndefined();
    expect(context.notifications.at(-1)?.message).toMatch(/No completed plan/);
    expect(context.statuses.get("plan-mode")).toBe("plan active");
  });

  it("exit and off disable Guard mode and restore the previous tools", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash", "custom"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.rawPi.getActiveTools()).not.toEqual(["read", "bash", "custom"]);

    await mock.commands.get("guard")?.handler("exit", context.ctx);

    expect(context.statuses.get("plan-mode")).toBeUndefined();
    expect(mock.rawPi.getActiveTools()).toEqual(["read", "bash", "custom"]);
    expect(context.notifications.at(-1)?.message).toMatch(/Guard mode disabled/);

    await mock.commands.get("guard")?.handler("", context.ctx);
    await mock.commands.get("guard")?.handler("off", context.ctx);
    expect(context.statuses.get("plan-mode")).toBeUndefined();
  });

  it("finalize requires an active mode and then requests the final plan", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });

    await expect(mock.commands.get("guard")?.handler("finalize", context.ctx)).rejects.toThrow(
      /not active/i,
    );
    expect(mock.sentUserMessages.length).toBe(0);

    await mock.commands.get("guard")?.handler("", context.ctx);
    await mock.commands.get("guard")?.handler("finalize", context.ctx);
    expect(mock.sentUserMessages.at(-1)?.text).toMatch(/guard_mode_complete/);
  });

  it("show without a stored plan rejects in non-UI modes without sending a message", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });

    await mock.commands.get("guard")?.handler("", context.ctx);
    await expect(mock.commands.get("guard")?.handler("show", context.ctx)).rejects.toThrow(
      /No completed plan/,
    );
    expect(mock.sentMessages.length).toBe(0);
  });

  it("show without a stored plan notifies in UI contexts", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: true, select: async () => "Stay in Guard mode" });

    await mock.commands.get("guard")?.handler("", context.ctx);
    await expect(mock.commands.get("guard")?.handler("show", context.ctx)).resolves.toBeUndefined();
    expect(mock.sentMessages.length).toBe(0);
    expect(context.notifications.at(-1)?.message).toMatch(/No completed plan/);
  });
});

describe("/guard command menus", () => {
  it("opens the Guard mode menu in a UI context and exits through it", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: true,
      select: async () => "Exit Guard mode",
    });

    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(context.statuses.get("plan-mode")).toBe("plan active");

    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(context.statuses.get("plan-mode")).toBeUndefined();
    expect(mock.rawPi.getActiveTools()).toEqual(["read"]);
  });
});

describe("guard_mode_complete tool", () => {
  it("stores a valid plan and enters the ready state", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);

    const tool = completionTool(mock);
    const result = await tool?.execute(
      "call-complete",
      { plan: "# Ship it\n\n## Test Plan\n- Run checks." },
      undefined,
      undefined,
      context.ctx,
    );

    expect((result as { terminate?: boolean }).terminate).toBe(true);
    expect(context.statuses.get("plan-mode")).toBe("plan ready");
    expect((mock.entries.at(-1)?.data as { latestPlan?: string }).latestPlan).toBe(
      "# Ship it\n\n## Test Plan\n- Run checks.",
    );
  });

  it("rejects completion while Guard mode is inactive", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });

    const tool = completionTool(mock);
    await expect(
      tool?.execute("call", { plan: "# Nope" }, undefined, undefined, context.ctx),
    ).rejects.toThrow(/only available while Guard mode is active/);
    expect(context.statuses.get("plan-mode")).toBeUndefined();
  });

  it("rejects empty and oversized plans", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);

    const tool = completionTool(mock);
    await expect(
      tool?.execute("empty", { plan: "   " }, undefined, undefined, context.ctx),
    ).rejects.toThrow(/must not be empty/);
    await expect(
      tool?.execute("large", { plan: "x".repeat(50_001) }, undefined, undefined, context.ctx),
    ).rejects.toThrow(/must not exceed 50000/);
    expect(context.statuses.get("plan-mode")).toBe("plan active");
  });

  it("implements a completed plan: restores tools and hands off with the exact prefix", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash", "custom"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);

    const tool = completionTool(mock);
    await tool?.execute("complete", { plan: "# Implement me" }, undefined, undefined, context.ctx);
    await mock.commands.get("guard")?.handler("implement", context.ctx);

    expect(context.statuses.get("plan-mode")).toBe("plan implementing");
    expect(mock.rawPi.getActiveTools()).toEqual(["read", "bash", "custom"]);
    expect(mock.sentUserMessages.at(-1)?.text).toBe(
      "Guard mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n# Implement me",
    );
  });
});

describe("session_start", () => {
  it("restores an enabled state with a ready plan and activates required tools", async () => {
    const mock = createMockPi({ activeTools: ["read", "write"] });
    createGuard()(mock.pi);
    const resumedState = {
      type: "custom",
      customType: "guard_plan_mode_state",
      data: { enabled: true, awaitingAction: true, latestPlan: "# Resumed" },
    };
    const context = createMockContext({
      sessionManager: {
        getBranch: () => [resumedState],
        getEntries: () => [resumedState],
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    expect(context.statuses.get("plan-mode")).toBe("plan ready");
    expect(mock.rawPi.getActiveTools()).toEqual([
      "read",
      "guard_mode_question",
      "guard_mode_complete",
    ]);
  });

  it("fails closed on malformed persisted state", async () => {
    const mock = createMockPi({ activeTools: ["read", "write"] });
    createGuard()(mock.pi);
    const malformedState = {
      type: "custom",
      customType: "guard_plan_mode_state",
      data: { enabled: "yes", awaitingAction: 1, selectedToolNames: "read" },
    };
    const context = createMockContext({
      sessionManager: {
        getBranch: () => [malformedState],
        getEntries: () => [malformedState],
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    expect(context.statuses.get("plan-mode")).toBeUndefined();
    expect(mock.rawPi.getActiveTools()).toEqual(["read", "write"]);
  });

  it("activates Guard mode when the --guard flag is set", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    mock.flags.set("guard", { value: true });
    const context = createMockContext();

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect((mock.entries.at(-1)?.data as { enabled?: boolean }).enabled).toBe(true);
  });

  it("uses the injected settings loader and notifies about invalid settings", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard({
      readSettings: async () => ({
        kind: "invalid",
        reason: "invalid settings shape",
      }),
    })(mock.pi);
    const context = createMockContext();

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    expect(context.notifications.at(-1)?.message).toMatch(/settings ignored: invalid settings shape/);
  });
});

describe("session_shutdown", () => {
  it("persists state, restores the previous tools, and clears the TUI", async () => {
    const mock = createMockPi({ activeTools: ["read", "write"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.rawPi.getActiveTools()).not.toEqual(["read", "write"]);

    await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);

    expect(mock.rawPi.getActiveTools()).toEqual(["read", "write"]);
    expect(context.statuses.get("plan-mode")).toBeUndefined();
    expect((mock.entries.at(-1)?.data as { enabled?: boolean }).enabled).toBe(true);
  });
});

describe("context filtering", () => {
  const assistantWithCalls = {
    role: "assistant",
    content: [
      { type: "text", text: "keep explanation" },
      { type: "toolCall", id: "plan-call", name: "guard_mode_complete", arguments: {} },
      { type: "toolCall", id: "read-call", name: "read", arguments: {} },
    ],
  };
  const completionResult = {
    role: "toolResult",
    toolCallId: "plan-call",
    toolName: "guard_mode_complete",
    content: [{ type: "text", text: "**Proposed Plan**\n\n# Discarded" }],
    details: { version: 1, source: "guard_mode_complete", plan: "# Discarded" },
  };
  const unrelatedResult = {
    role: "toolResult",
    toolCallId: "read-call",
    toolName: "read",
    content: [{ type: "text", text: "keep me" }],
  };
  const emptyAssistant = { role: "assistant", content: [] };
  const proposedPlanMessage = {
    role: "custom",
    customType: "proposed-plan",
    content: "**Proposed Plan**\n\n# Old",
  };

  it("strips inactive plan artifacts and empty assistant messages when Guard mode is off", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext();
    const contextHook = mock.events.get("context")?.[0];

    const result = (await contextHook?.(
      {
        messages: [
          assistantWithCalls,
          emptyAssistant,
          proposedPlanMessage,
          completionResult,
          unrelatedResult,
        ],
      },
      context.ctx,
    )) as { messages: unknown[] };

    expect(result.messages).toEqual([
      {
        ...assistantWithCalls,
        content: [assistantWithCalls.content[0], assistantWithCalls.content[2]],
      },
      unrelatedResult,
    ]);
  });

  it("keeps plan artifacts while Guard mode is active", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    const contextHook = mock.events.get("context")?.[0];

    const messages = [assistantWithCalls, completionResult, unrelatedResult];
    const result = (await contextHook?.({ messages }, context.ctx)) as { messages: unknown[] };

    expect(result.messages).toEqual(messages);
  });

  it("keeps the exact implementation handoff and drops stale handoffs", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Active" }, undefined, undefined, context.ctx);
    await mock.commands.get("guard")?.handler("implement", context.ctx);
    const contextHook = mock.events.get("context")?.[0];

    const handoff = {
      role: "user",
      content:
        "Guard mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n# Active",
    };
    const staleHandoff = {
      role: "user",
      content:
        "Guard mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n# Stale",
    };
    const plain = { role: "user", content: "hello" };

    const result = (await contextHook?.(
      { messages: [plain, staleHandoff, handoff] },
      context.ctx,
    )) as { messages: unknown[] };

    expect(result.messages).toEqual([plain, handoff]);
  });

  it("injects the active plan context marker when the handoff is missing", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Active" }, undefined, undefined, context.ctx);
    await mock.commands.get("guard")?.handler("implement", context.ctx);
    const contextHook = mock.events.get("context")?.[0];

    const result = (await contextHook?.(
      { messages: [{ role: "user", content: "hello" }] },
      context.ctx,
    )) as { messages: unknown[] };

    expect(result.messages[0]).toMatchObject({
      role: "custom",
      customType: "plan-mode-implementation-context",
    });
    expect(JSON.stringify(result.messages[0])).toContain("# Active");
    expect(result.messages[1]).toEqual({ role: "user", content: "hello" });
  });
});

describe("tool_call policy", () => {
  it("passes all tool calls through while Guard mode is off", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);
    const context = createMockContext();
    const hook = mock.events.get("tool_call")?.[0];

    expect(
      await hook?.({ toolName: "write", input: { path: "src/x.ts" } }, context.ctx),
    ).toBeUndefined();
  });

  it("blocks update_plan, edit, and non-allowlisted writes; allows allowlisted writes", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash", "write", "edit"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    const hook = mock.events.get("tool_call")?.[0];

    expect(
      await hook?.({ toolName: "update_plan", input: {} }, context.ctx),
    ).toMatchObject({ block: true });
    expect(
      await hook?.(
        { toolName: "edit", input: { path: "src/x.ts", edits: [] } },
        context.ctx,
      ),
    ).toMatchObject({ block: true });
    const blockedWrite = await hook?.({ toolName: "write", input: { path: "src/x.ts" } }, context.ctx);
    expect(blockedWrite).toMatchObject({ block: true });
    expect((blockedWrite as { reason: string }).reason).toContain(".scratch/");
    expect(
      await hook?.({ toolName: "write", input: { path: ".scratch/ticket.md" } }, context.ctx),
    ).toBeUndefined();
    expect(
      await hook?.({ toolName: "replace", input: { path: "docs/adr/new.md" } }, context.ctx),
    ).toBeUndefined();
  });

  it("blocks unsafe bash commands and allows safe ones while active", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    const hook = mock.events.get("tool_call")?.[0];

    const blocked = await hook?.({ toolName: "bash", input: { command: "rm -rf /" } }, context.ctx);
    expect(blocked).toMatchObject({ block: true });
    expect((blocked as { reason: string }).reason).toMatch(/Guard mode blocks mutating or non-allowlisted bash commands/);

    expect(
      await hook?.({ toolName: "bash", input: { command: "ls -la" } }, context.ctx),
    ).toBeUndefined();
  });

  it("enforces the subagent allowlist from settings while active", async () => {
    const mock = createMockPi({
      activeTools: ["read", "subagent"],
      allTools: [builtinTool("read"), extensionTool("subagent")],
    });
    createGuard({
      readSettings: async () => ({
        kind: "loaded",
        settings: { thinkingLevel: "inherit", allowedPlanSubagents: ["plan-researcher"] },
      }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    const hook = mock.events.get("tool_call")?.[0];

    const blocked = await hook?.(
      { toolName: "subagent", input: { agent: "implementer" } },
      context.ctx,
    );
    expect(blocked).toMatchObject({ block: true });

    expect(
      await hook?.(
        { toolName: "subagent", input: { agent: "plan-researcher" } },
        context.ctx,
      ),
    ).toBeUndefined();
  });
});

describe("agent_end validation", () => {
  it("accepts a valid legacy proposed plan into the ready state", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);

    await mock.events.get("agent_end")?.[0]?.(
      {
        messages: [{ role: "assistant", content: "<proposed_plan>\n# Legacy\n</proposed_plan>" }],
      },
      context.ctx,
    );

    expect(context.statuses.get("plan-mode")).toBe("plan ready");
    expect((mock.entries.at(-1)?.data as { latestPlan?: string }).latestPlan).toBe("# Legacy");
  });

  it("notifies and stays active on an invalid proposed plan", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);

    await mock.events.get("agent_end")?.[0]?.(
      { messages: [{ role: "assistant", content: "<proposed_plan>unfinished" }] },
      context.ctx,
    );

    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(context.notifications.at(-1)?.message).toMatch(/closing tag is missing/);
  });

  it("ignores prose-only agent endings without false readiness", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);

    await mock.events.get("agent_end")?.[0]?.(
      { messages: [{ role: "assistant", content: "Now I understand. Let me present the plan." }] },
      context.ctx,
    );

    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(mock.sentMessages.length).toBe(0);
  });
});

describe("agent_settled presentation", () => {
  it("presents the ready menu exactly once after settlement", async () => {
    let selectCalls = 0;
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: true,
      select: async () => {
        selectCalls += 1;
        return "Stay in Guard mode";
      },
    });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Ready" }, undefined, undefined, context.ctx);
    expect(selectCalls).toBe(0);

    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);

    expect(selectCalls).toBe(1);
    expect(mock.sentMessages.length).toBe(0);
    expect(context.statuses.get("plan-mode")).toBe("plan ready");
  });

  it("presents a legacy accepted plan once after settlement", async () => {
    let selectCalls = 0;
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: true,
      select: async () => {
        selectCalls += 1;
        return "Stay in Guard mode";
      },
    });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await mock.events.get("agent_end")?.[0]?.(
      { messages: [{ role: "assistant", content: "<proposed_plan>\n# Legacy\n</proposed_plan>" }] },
      context.ctx,
    );

    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);

    expect(selectCalls).toBe(1);
    expect(mock.sentMessages.length).toBe(1);
    expect(mock.sentMessages[0]?.message).toMatchObject({ customType: "proposed-plan" });
  });

  it("keeps the ready state without UI presentation", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Headless" }, undefined, undefined, context.ctx);

    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);

    expect(context.statuses.get("plan-mode")).toBe("plan ready");
    expect(mock.sentMessages.length).toBe(0);
  });
});

describe("before_agent_start", () => {
  it("clears a stale pending plan and injects the Guard mode prompt", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Stale" }, undefined, undefined, context.ctx);
    expect(context.statuses.get("plan-mode")).toBe("plan ready");

    const result = (await mock.events.get("before_agent_start")?.[0]?.(
      { systemPrompt: "base", prompt: "continue", systemPromptOptions: {} },
      context.ctx,
    )) as { systemPrompt: string };

    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(result.systemPrompt).toContain("base");
    expect(result.systemPrompt).toMatch(/Guard Mode（守卫模式）/);
    expect(result.systemPrompt).toMatch(/guard_mode_complete/);
  });

  it("does not inject the Guard mode prompt while inactive", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });

    const result = await mock.events.get("before_agent_start")?.[0]?.(
      { systemPrompt: "base", prompt: "hi", systemPromptOptions: {} },
      context.ctx,
    );

    expect(result).toBeUndefined();
  });
});

describe("thinking level", () => {
  it("applies the configured thinking level on entry and restores it on exit", async () => {
    const mock = createMockPi({ activeTools: ["read"], thinkingLevel: "low" });
    createGuard({
      readSettings: async () => ({ kind: "loaded", settings: { thinkingLevel: "medium" } }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.thinkingLevel).toBe("medium");

    await mock.commands.get("guard")?.handler("exit", context.ctx);
    expect(mock.thinkingLevel).toBe("low");
  });

  it("remembers a manual thinking change and keeps it on exit", async () => {
    const mock = createMockPi({ activeTools: ["read"], thinkingLevel: "low" });
    createGuard({
      readSettings: async () => ({ kind: "loaded", settings: { thinkingLevel: "medium" } }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.thinkingLevel).toBe("medium");

    mock.rawPi.setThinkingLevel("high");
    await mock.events.get("thinking_level_select")?.[0]?.(
      { level: "high", previousLevel: "medium" },
      context.ctx,
    );

    await mock.commands.get("guard")?.handler("exit", context.ctx);
    expect(mock.thinkingLevel).toBe("high");
  });

  it("restores the previous thinking level on shutdown while active", async () => {
    const mock = createMockPi({ activeTools: ["read"], thinkingLevel: "low" });
    createGuard({
      readSettings: async () => ({ kind: "loaded", settings: { thinkingLevel: "medium" } }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.thinkingLevel).toBe("medium");

    await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
    expect(mock.thinkingLevel).toBe("low");
  });
});

describe("thinking level session restore", () => {
  it("resets a previously loaded fixed thinking level when settings go missing", async () => {
    let settings: PlanModeSettingsLoadResult = {
      kind: "loaded",
      settings: { thinkingLevel: "medium" },
    };
    const mock = createMockPi({ activeTools: ["read"], thinkingLevel: "low" });
    createGuard({ readSettings: async () => settings })(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.thinkingLevel).toBe("medium");
    await mock.commands.get("guard")?.handler("exit", context.ctx);
    expect(mock.thinkingLevel).toBe("low");

    settings = { kind: "missing" };
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.thinkingLevel).toBe("low");
  });

  it("does not restore a stale applied thinking level when settings inherit", async () => {
    const mock = createMockPi({ activeTools: ["read"], thinkingLevel: "medium" });
    createGuard({
      readSettings: async () => ({ kind: "loaded", settings: { thinkingLevel: "inherit" } }),
    })(mock.pi);
    const inheritedState = {
      type: "custom",
      customType: "guard_plan_mode_state",
      data: {
        enabled: true,
        awaitingAction: false,
        previousThinkingLevel: "low",
        appliedThinkingLevel: "medium",
      },
    };
    const context = createMockContext({
      hasUI: false,
      sessionManager: {
        getBranch: () => [inheritedState],
        getEntries: () => [inheritedState],
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("exit", context.ctx);

    expect(mock.thinkingLevel).toBe("medium");
  });

  it("reapplies the configured thinking level on resume and restores it on exit", async () => {
    const mock = createMockPi({ activeTools: ["read"], thinkingLevel: "low" });
    createGuard({
      readSettings: async () => ({ kind: "loaded", settings: { thinkingLevel: "medium" } }),
    })(mock.pi);
    const resumedState = {
      type: "custom",
      customType: "guard_plan_mode_state",
      data: {
        enabled: true,
        awaitingAction: false,
        previousThinkingLevel: "low",
        appliedThinkingLevel: "medium",
      },
    };
    const context = createMockContext({
      hasUI: false,
      sessionManager: {
        getBranch: () => [resumedState],
        getEntries: () => [resumedState],
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    expect(mock.thinkingLevel).toBe("medium");

    await mock.commands.get("guard")?.handler("exit", context.ctx);
    expect(mock.thinkingLevel).toBe("low");
  });

  it("keeps a manual thinking change across shutdown and resume", async () => {
    const mock = createMockPi({ activeTools: ["read"], thinkingLevel: "low" });
    createGuard({
      readSettings: async () => ({ kind: "loaded", settings: { thinkingLevel: "medium" } }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.thinkingLevel).toBe("medium");

    mock.rawPi.setThinkingLevel("high");
    await mock.events.get("thinking_level_select")?.[0]?.(
      { level: "high", previousLevel: "medium" },
      context.ctx,
    );
    await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
    expect(mock.thinkingLevel).toBe("high");

    const persisted = mock.entries.at(-1)?.data as { manualThinkingLevel?: string };
    expect(persisted.manualThinkingLevel).toBe("high");
    const resumedState = {
      type: "custom",
      customType: "guard_plan_mode_state",
      data: { ...persisted, enabled: true },
    };
    const resumedContext = createMockContext({
      hasUI: false,
      sessionManager: {
        getBranch: () => [resumedState],
        getEntries: () => [resumedState],
      },
    });
    await mock.events.get("session_start")?.[0]?.({}, resumedContext.ctx);
    expect(mock.thinkingLevel).toBe("high");

    await mock.commands.get("guard")?.handler("exit", resumedContext.ctx);
    expect(mock.thinkingLevel).toBe("high");
  });
});

describe("delivery failures", () => {
  it("keeps a completed plan ready when show delivery fails", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Still ready" }, undefined, undefined, context.ctx);
    mock.rawPi.sendMessage = () => {
      throw new Error("display unavailable");
    };

    await expect(mock.commands.get("guard")?.handler("show", context.ctx)).resolves.toBeUndefined();
    expect(context.statuses.get("plan-mode")).toBe("plan ready");
    expect(context.notifications.at(-1)?.message ?? "").toMatch(/display unavailable/);
  });

  it("finalize rejects while Guard mode is inactive", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: true });

    await mock.commands.get("guard")?.handler("finalize", context.ctx);
    expect(mock.sentUserMessages.length).toBe(0);
    expect(context.notifications.at(-1)?.message ?? "").toMatch(/not active/i);
  });

  it("finalize delivers idle-safely while active", async () => {
    let idle = true;
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: true, isIdle: () => idle });

    await mock.commands.get("guard")?.handler("", context.ctx);
    await mock.commands.get("guard")?.handler("finalize", context.ctx);
    expect(mock.sentUserMessages.at(-1)?.text ?? "").toMatch(/guard_mode_complete/);
    expect(mock.sentUserMessages.at(-1)?.options).toBeUndefined();

    idle = false;
    await mock.commands.get("guard")?.handler("finalize", context.ctx);
    expect(mock.sentUserMessages.at(-1)?.options).toEqual({ deliverAs: "followUp" });
  });

  it("keeps Guard mode active when finalize delivery fails", async () => {
    const mock = createMockPi({ activeTools: ["read"] });
    mock.rawPi.sendUserMessage = () => {
      throw new Error("Extension context is no longer active");
    };
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);

    await expect(mock.commands.get("guard")?.handler("finalize", context.ctx)).resolves.toBeUndefined();
    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(context.notifications.at(-1)?.message ?? "").toMatch(/no longer active/);
  });

  it("rolls back a newly entered Guard mode when the inline prompt delivery fails", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    mock.rawPi.sendUserMessage = () => {
      throw new Error("Extension context is no longer active");
    };
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });

    await expect(mock.commands.get("guard")?.handler("design it", context.ctx)).resolves.toBeUndefined();

    expect(context.statuses.get("plan-mode")).toBeUndefined();
    expect(mock.rawPi.getActiveTools()).toEqual(["read", "bash"]);
    expect(context.notifications.at(-1)?.message ?? "").toMatch(/no longer active/);
  });

  it("restores the ready state when implement delivery fails", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash"] });
    mock.rawPi.sendUserMessage = () => {
      throw new Error("Extension context is no longer active");
    };
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Ready again" }, undefined, undefined, context.ctx);

    await expect(mock.commands.get("guard")?.handler("implement", context.ctx)).resolves.toBeUndefined();

    expect(context.statuses.get("plan-mode")).toBe("plan ready");
    expect(mock.rawPi.getActiveTools()).toEqual([
      "bash",
      "read",
      "guard_mode_question",
      "guard_mode_complete",
    ]);
    expect((mock.entries.at(-1)?.data as { latestPlan?: string }).latestPlan).toBe("# Ready again");
  });
});

describe("ready presentation edge cases", () => {
  it("waits for idle and pending-free state before presenting", async () => {
    let idle = false;
    let pending = false;
    let selectCalls = 0;
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: true,
      isIdle: () => idle,
      hasPendingMessages: () => pending,
      select: async () => {
        selectCalls += 1;
        return "Stay in Guard mode";
      },
    });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Wait for idle" }, undefined, undefined, context.ctx);

    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    expect(selectCalls).toBe(0);

    idle = true;
    pending = true;
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    expect(selectCalls).toBe(0);

    pending = false;
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    expect(selectCalls).toBe(1);
    expect(context.statuses.get("plan-mode")).toBe("plan ready");
  });

  it("presents duplicate and replacement completions only once each", async () => {
    let selectCalls = 0;
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: true,
      select: async () => {
        selectCalls += 1;
        return "Stay in Guard mode";
      },
    });
    await mock.commands.get("guard")?.handler("", context.ctx);
    const tool = completionTool(mock);

    await tool?.execute("complete", { plan: "# First" }, undefined, undefined, context.ctx);
    await tool?.execute("complete", { plan: "# First" }, undefined, undefined, context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    expect(selectCalls).toBe(1);

    await tool?.execute("complete", { plan: "# Second" }, undefined, undefined, context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    expect(selectCalls).toBe(2);
    expect(context.statuses.get("plan-mode")).toBe("plan ready");
  });

  it("ignores a stale ready presentation intent without losing the ready state", async () => {
    let selectCalls = 0;
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: true,
      select: async () => {
        selectCalls += 1;
        return "Stay in Guard mode";
      },
    });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Superseded" }, undefined, undefined, context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Current" }, undefined, undefined, context.ctx);

    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);

    expect(selectCalls).toBe(1);
    expect(context.statuses.get("plan-mode")).toBe("plan ready");
    expect((mock.entries.at(-1)?.data as { latestPlan?: string }).latestPlan).toBe("# Current");
  });

  it("cancels a stale ready presentation when a newer turn starts", async () => {
    let selectCalls = 0;
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: true,
      select: async () => {
        selectCalls += 1;
        return "Stay in Guard mode";
      },
    });
    await mock.commands.get("guard")?.handler("", context.ctx);
    await completionTool(mock)?.execute("complete", { plan: "# Stale" }, undefined, undefined, context.ctx);

    await mock.events.get("before_agent_start")?.[0]?.(
      { systemPrompt: "base", prompt: "continue", systemPromptOptions: {} },
      context.ctx,
    );
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);

    expect(selectCalls).toBe(0);
    expect(context.statuses.get("plan-mode")).toBe("plan active");
  });

  it("presents repeated legacy agent_end plans once", async () => {
    let selectCalls = 0;
    const mock = createMockPi({ activeTools: ["read"] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: true,
      select: async () => {
        selectCalls += 1;
        return "Stay in Guard mode";
      },
    });
    await mock.commands.get("guard")?.handler("", context.ctx);
    const legacy = {
      messages: [{ role: "assistant", content: "<proposed_plan>\n# Legacy once\n</proposed_plan>" }],
    };

    await mock.events.get("agent_end")?.[0]?.(legacy, context.ctx);
    await mock.events.get("agent_end")?.[0]?.(legacy, context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
    await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);

    expect(selectCalls).toBe(1);
    expect(mock.sentMessages.length).toBe(1);
    expect(mock.sentMessages[0]?.message).toMatchObject({ customType: "proposed-plan" });
  });
});
