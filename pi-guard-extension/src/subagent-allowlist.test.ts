import { describe, it, expect } from "vitest";
import { createGuard } from "./index.ts";
import { createMockPi, createMockContext, builtinTool, extensionTool, settingsLoader } from "./test-support.ts";
import type { PlanModeSettings } from "./settings.ts";

describe("subagent allowlist integration", () => {
  it("guards blocking and detached launches only while Guard mode is active", async () => {
    const mock = createMockPi({
      activeTools: ["read"],
      allTools: [builtinTool("read"), extensionTool("subagent"), extensionTool("subagent_spawn")],
    });
    createGuard({
      readSettings: settingsLoader({
        defaultPlanTools: ["subagent", "subagent_spawn"],
        allowedPlanSubagents: ["plan-scout", "plan-reviewer"],
      }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    const hook = mock.events.get("tool_call")?.[0];
    expect(hook).toBeDefined();

    expect(
      await hook?.({ toolName: "subagent", input: { agent: "worker", task: "Implement" } }, context.ctx),
    ).toBeUndefined();

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual([
      "subagent",
      "subagent_spawn",
      "guard_mode_question",
      "guard_mode_complete",
    ]);

    expect(
      await hook?.({ toolName: "subagent", input: { agent: "plan-scout", task: "Inspect" } }, context.ctx),
    ).toBeUndefined();

    const blockedTasks = (await hook?.(
      {
        toolName: "subagent",
        input: {
          tasks: [
            { agent: "plan-scout", task: "Inspect" },
            { agent: "worker", task: "Implement" },
          ],
        },
      },
      context.ctx,
    )) as { reason?: string } | undefined;
    expect(blockedTasks?.reason ?? "").toMatch(/role\(s\): worker/);

    const blockedSpawn = (await hook?.(
      { toolName: "subagent_spawn", input: { agent: "worker", task: "Implement" } },
      context.ctx,
    )) as { reason?: string } | undefined;
    expect(blockedSpawn?.reason ?? "").toMatch(/role\(s\): worker/);

    const unverifiable = (await hook?.(
      { toolName: "subagent", input: { tasks: [] } },
      context.ctx,
    )) as { reason?: string } | undefined;
    expect(unverifiable?.reason ?? "").toMatch(/could not verify subagent roles/);
  });

  it("keeps omitted and empty role allowlists distinct", async () => {
    const allTools = [builtinTool("read"), extensionTool("subagent")];
    const omitted = createMockPi({ activeTools: ["read"], allTools });
    createGuard({ readSettings: settingsLoader({ defaultPlanTools: ["subagent"] }) })(omitted.pi);
    const omittedContext = createMockContext({ hasUI: false });
    await omitted.events.get("session_start")?.[0]?.({}, omittedContext.ctx);
    await omitted.commands.get("guard")?.handler("", omittedContext.ctx);
    expect(
      await omitted.events.get("tool_call")?.[0]?.(
        { toolName: "subagent", input: { agent: "worker", task: "Implement" } },
        omittedContext.ctx,
      ),
    ).toBeUndefined();

    const empty = createMockPi({ activeTools: ["read"], allTools });
    createGuard({
      readSettings: settingsLoader({
        defaultPlanTools: ["subagent"],
        allowedPlanSubagents: [],
      }),
    })(empty.pi);
    const emptyContext = createMockContext({ hasUI: false });
    await empty.events.get("session_start")?.[0]?.({}, emptyContext.ctx);
    await empty.commands.get("guard")?.handler("", emptyContext.ctx);
    const blocked = (await empty.events.get("tool_call")?.[0]?.(
      { toolName: "subagent", input: { agent: "plan-scout", task: "Inspect" } },
      emptyContext.ctx,
    )) as { reason?: string } | undefined;
    expect(blocked?.reason ?? "").toMatch(/No subagent roles are allowed/);
  });

  it("replaces and removes the role policy on settings reload", async () => {
    let allowed: string[] | undefined = ["plan-scout"];
    const mock = createMockPi({
      activeTools: ["read"],
      allTools: [builtinTool("read"), extensionTool("subagent")],
    });
    createGuard({
      readSettings: async () => {
        const settings: PlanModeSettings = {
          thinkingLevel: "inherit",
          defaultPlanTools: ["subagent"],
        };
        if (allowed !== undefined) settings.allowedPlanSubagents = allowed;
        return { kind: "loaded", settings };
      },
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    const hook = mock.events.get("tool_call")?.[0];
    expect(hook).toBeDefined();

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(await hook?.({ toolName: "subagent", input: { agent: "worker" } }, context.ctx)).toMatchObject({ block: true });
    await mock.commands.get("guard")?.handler("exit", context.ctx);

    allowed = ["worker"];
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(
      await hook?.({ toolName: "subagent", input: { agent: "worker" } }, context.ctx),
    ).toBeUndefined();
    expect(await hook?.({ toolName: "subagent", input: { agent: "plan-scout" } }, context.ctx)).toMatchObject({ block: true });
    await mock.commands.get("guard")?.handler("exit", context.ctx);

    allowed = undefined;
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(
      await hook?.({ toolName: "subagent", input: { agent: "worker" } }, context.ctx),
    ).toBeUndefined();
  });

  it("is inert when no subagent tools are installed", async () => {
    const mock = createMockPi({ activeTools: ["read"], allTools: [builtinTool("read")] });
    createGuard({ readSettings: settingsLoader({ allowedPlanSubagents: ["plan-scout"] }) })(
mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);

    expect(mock.rawPi.getActiveTools().includes("subagent")).toBe(false);
    expect(
      await mock.events.get("tool_call")?.[0]?.(
        { toolName: "custom_delegate", input: { agent: "worker" } },
        context.ctx,
      ),
    ).toBeUndefined();
  });
});

  it("keeps a session-level tools selection guarded by the role policy", async () => {
    const mock = createMockPi({
      activeTools: ["read"],
      allTools: [builtinTool("read"), extensionTool("subagent")],
    });
    createGuard({
      readSettings: settingsLoader({ defaultPlanTools: [], allowedPlanSubagents: ["plan-scout"] }),
    })(mock.pi);
    let selectedSubagent = false;
    const context = createMockContext({
      hasUI: true,
      select: async (_title: string, choices: string[]) => {
        if (selectedSubagent) return undefined;
        selectedSubagent = true;
        return choices.find((choice) => choice === "subagent");
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    await mock.commands.get("guard")?.handler("tools", context.ctx);

    expect(mock.rawPi.getActiveTools().includes("subagent")).toBe(true);
    const blocked = (await mock.events.get("tool_call")?.[0]?.(
      { toolName: "subagent", input: { agent: "worker", task: "Implement" } },
      context.ctx,
    )) as { reason?: string } | undefined;
    expect(blocked).toMatchObject({ block: true });
    expect(blocked?.reason ?? "").toMatch(/role\(s\): worker/);
  });
