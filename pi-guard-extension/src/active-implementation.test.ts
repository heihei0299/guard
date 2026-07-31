import { describe, it, expect } from "vitest";
import { createGuard } from "./index.ts";
import {
  createMockPi,
  createMockContext,
  builtinTool,
  extensionTool,
  planModeStateEntry,
} from "./test-support.ts";

const IMPLEMENTATION_PLAN = "# Compaction-safe implementation\n\n1. Preserve the exact approved plan.";

function resumedImplementation(data: Record<string, unknown>) {
  const stateEntry = planModeStateEntry(data);
  const mock = createMockPi({ activeTools: ["read", "write"], allTools: [builtinTool("read")] });
  createGuard()(mock.pi);
  return {
    mock,
    stateEntry,
    context: createMockContext({
      hasUI: false,
      sessionManager: {
        getBranch: () => [stateEntry],
        getEntries: () => [stateEntry],
      },
    }),
  };
}

describe("active implementation lifecycle", () => {
  it("restores an active implementation independently from Guard mode", async () => {
    const { mock, context } = resumedImplementation({
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "impl-1",
        plan: IMPLEMENTATION_PLAN,
        source: "plan_mode_complete",
        startedAt: 42,
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    expect(context.statuses.get("plan-mode")).toBe("plan implementing");
    expect(mock.rawPi.getActiveTools()).toEqual(["read", "write"]);
  });

  it("fails closed on malformed retained implementation state", async () => {
    const { mock, context } = resumedImplementation({
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "impl-1",
        plan: " ",
        source: "plan_mode_complete",
        startedAt: 42,
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    expect(context.statuses.get("plan-mode")).toBeUndefined();
  });

  it("injects the restored plan into context and shows it via /guard show", async () => {
    const { mock, context } = resumedImplementation({
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "impl-1",
        plan: IMPLEMENTATION_PLAN,
        source: "plan_mode_complete",
        startedAt: 42,
      },
    });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    const contextHook = mock.events.get("context")?.[0];
    expect(contextHook).toBeDefined();
    const result = (await contextHook?.(
      { messages: [{ role: "user", content: "hello" }] },
      context.ctx,
    )) as { messages: unknown[] };
    expect(result.messages[0]).toMatchObject({
      role: "custom",
      customType: "plan-mode-implementation-context",
    });
    expect(String((result.messages[0] as { content?: string }).content)).toContain(
      IMPLEMENTATION_PLAN,
    );

    await mock.commands.get("guard")?.handler("show", context.ctx);
    expect(mock.sentMessages.at(-1)?.message).toMatchObject({ customType: "proposed-plan" });
    expect(
      String((mock.sentMessages.at(-1)?.message as { content?: string }).content),
    ).toContain(IMPLEMENTATION_PLAN);
  });

  it("lets a new Guard-mode workflow supersede the active implementation", async () => {
    const { mock, context } = resumedImplementation({
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "impl-1",
        plan: IMPLEMENTATION_PLAN,
        source: "plan_mode_complete",
        startedAt: 42,
      },
    });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    await mock.commands.get("guard")?.handler("", context.ctx);

    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(mock.rawPi.getActiveTools()).toEqual([
      "read",
      "plan_mode_question",
      "plan_mode_complete",
    ]);
  });

  it("clears the active implementation on /guard exit", async () => {
    const { mock, context } = resumedImplementation({
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "impl-1",
        plan: IMPLEMENTATION_PLAN,
        source: "plan_mode_complete",
        startedAt: 42,
      },
    });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    await mock.commands.get("guard")?.handler("exit", context.ctx);

    expect(context.statuses.get("plan-mode")).toBeUndefined();
    expect(context.notifications.at(-1)?.message).toMatch(/Active implementation plan cleared/);
  });

  it("opens the active-plan menu in UI contexts", async () => {
    const mock = createMockPi({ activeTools: ["read"], allTools: [builtinTool("read")] });
    createGuard()(mock.pi);
    const stateEntry = {
      type: "custom",
      customType: "guard_plan_mode_state",
      data: {
        enabled: false,
        awaitingAction: false,
        activeImplementation: {
          id: "impl-1",
          plan: IMPLEMENTATION_PLAN,
          source: "plan_mode_complete",
          startedAt: 42,
        },
      },
    };
    const context = createMockContext({
      hasUI: true,
      sessionManager: {
        getBranch: () => [stateEntry],
        getEntries: () => [stateEntry],
      },
      select: async (_title: string, choices: string[]) =>
        choices.find((choice) => choice.startsWith("Clear active implementation")),
    });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    await mock.commands.get("guard")?.handler("", context.ctx);

    expect(context.statuses.get("plan-mode")).toBeUndefined();
    expect(context.notifications.at(-1)?.message).toMatch(/Active implementation plan cleared/);
  });

  it("retains branch-local implementation state across shutdown while clearing the UI", async () => {
    const { mock, context } = resumedImplementation({
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "impl-1",
        plan: IMPLEMENTATION_PLAN,
        source: "plan_mode_complete",
        startedAt: 42,
      },
    });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    expect(context.statuses.get("plan-mode")).toBe("plan implementing");

    await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);

    expect(context.statuses.get("plan-mode")).toBeUndefined();
    expect(
      (mock.entries.at(-1)?.data as { activeImplementation?: { id?: string } })
        .activeImplementation?.id,
    ).toBe("impl-1");
  });

  it("lets the --guard flag supersede a resumed active implementation", async () => {
    const { mock, context } = resumedImplementation({
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "impl-1",
        plan: IMPLEMENTATION_PLAN,
        source: "plan_mode_complete",
        startedAt: 42,
      },
    });
    mock.flags.set("guard", { value: true });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);

    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(
      (mock.entries.at(-1)?.data as { activeImplementation?: unknown }).activeImplementation,
    ).toBeUndefined();
  });
});

describe("re-entered Guard mode hides the previous implementation handoff", () => {
  it("filters the old handoff after a new planning workflow starts", async () => {
    const mock = createMockPi({ activeTools: ["read", "bash", "custom"] });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.commands.get("guard")?.handler("", context.ctx);
    const executeComplete = mock.tools.find((candidate) => candidate.name === "plan_mode_complete")
      ?.execute as ((...args: unknown[]) => Promise<unknown>) | undefined;
    expect(executeComplete).toBeDefined();
    await executeComplete?.("complete", { plan: "# Plan Mode repro" }, undefined, undefined, context.ctx);
    await mock.commands.get("guard")?.handler("implement", context.ctx);

    const implementationHandoff = mock.sentUserMessages.at(-1)?.text ?? "";
    expect(implementationHandoff).toMatch(/Guard mode is now disabled/);
    expect(implementationHandoff).toMatch(/Implement this proposed plan now/);
    expect(context.statuses.get("plan-mode")).toBe("plan implementing");

    const contextHook = mock.events.get("context")?.[0];
    expect(contextHook).toBeDefined();
    const implementationMessages = [
      { role: "user", content: "Plan a one-line README change." },
      { role: "user", content: implementationHandoff },
      { role: "assistant", content: "Implemented the requested plan." },
    ];
    const inactiveContext = (await contextHook?.(
      { messages: implementationMessages },
      context.ctx,
    )) as { messages: unknown[] };
    expect(inactiveContext.messages).toEqual(implementationMessages);

    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(context.statuses.get("plan-mode")).toBe("plan active");
    expect(mock.rawPi.getActiveTools()).toEqual([
      "bash",
      "read",
      "plan_mode_question",
      "plan_mode_complete",
    ]);

    const activeMessages = [...implementationMessages, { role: "user", content: "continue" }];
    const activeContext = (await contextHook?.({ messages: activeMessages }, context.ctx)) as {
      messages: unknown[];
    };
    expect(activeContext.messages).toEqual([
      implementationMessages[0],
      implementationMessages[2],
      activeMessages[3],
    ]);
    expect(JSON.stringify(activeContext.messages)).not.toMatch(
      /Guard mode is now disabled\. Full tool access is restored/,
    );
  });
});
