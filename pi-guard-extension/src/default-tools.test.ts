import { describe, it, expect } from "vitest";
import { stripVTControlCharacters } from "node:util";
import { createGuard } from "./index.ts";
import {
  createMockPi,
  createMockContext,
  builtinTool,
  extensionTool,
  driveCustomSelector,
  createCustomSelectorHarness,
  planModeStateEntry,
  settingsLoader,
} from "./test-support.ts";

const REQUIRED_PLAN_TOOLS = ["guard_mode_question", "guard_mode_complete"];

describe("default plan tools", () => {
  it("uses configured default tools on entry and restores the previous tools on exit", async () => {
    const mock = createMockPi({
      activeTools: ["read", "write"],
      allTools: [
        builtinTool("read"),
        builtinTool("bash"),
        builtinTool("write"),
        extensionTool("custom"),
      ],
    });
    createGuard({
      readSettings: settingsLoader({
        defaultPlanTools: ["bash", "custom", "write", "missing", "bash"],
      }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);

    // write is selectable in our policy (allowlisted); order follows the sorted tool list,
    // built-in first, then user tools.
    expect(mock.rawPi.getActiveTools()).toEqual([
      "bash",
      "write",
      "custom",
      ...REQUIRED_PLAN_TOOLS,
    ]);

    await mock.commands.get("guard")?.handler("exit", context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual(["read", "write"]);
  });

  it("keeps missing and empty default tool settings distinct", async () => {
    const allTools = [
      builtinTool("read"),
      builtinTool("bash"),
      builtinTool("grep"),
      builtinTool("write"),
      extensionTool("custom"),
    ];

    const missing = createMockPi({ activeTools: ["write"], allTools });
    createGuard({ readSettings: settingsLoader({}) })(missing.pi);
    const missingContext = createMockContext({ hasUI: false });
    await missing.events.get("session_start")?.[0]?.({}, missingContext.ctx);
    await missing.commands.get("guard")?.handler("", missingContext.ctx);
    expect(missing.rawPi.getActiveTools()).toEqual([
      "bash",
      "grep",
      "read",
      ...REQUIRED_PLAN_TOOLS,
    ]);

    const empty = createMockPi({ activeTools: ["write"], allTools });
    createGuard({ readSettings: settingsLoader({ defaultPlanTools: [] }) })(empty.pi);
    const emptyContext = createMockContext({ hasUI: false });
    await empty.events.get("session_start")?.[0]?.({}, emptyContext.ctx);
    await empty.commands.get("guard")?.handler("", emptyContext.ctx);
    expect(empty.rawPi.getActiveTools()).toEqual(REQUIRED_PLAN_TOOLS);
  });

  it("stays fail closed when tool metadata is unavailable", async () => {
    const explicit = createMockPi({ activeTools: ["write"], allTools: [] });
    createGuard({ readSettings: settingsLoader({ defaultPlanTools: [] }) })(explicit.pi);
    const explicitContext = createMockContext({ hasUI: false });
    await explicit.events.get("session_start")?.[0]?.({}, explicitContext.ctx);
    await explicit.commands.get("guard")?.handler("", explicitContext.ctx);
    expect(explicit.rawPi.getActiveTools()).toEqual(REQUIRED_PLAN_TOOLS);

    const fallback = createMockPi({ activeTools: ["write"], allTools: [] });
    createGuard({ readSettings: settingsLoader({}) })(fallback.pi);
    const fallbackContext = createMockContext({ hasUI: false });
    await fallback.events.get("session_start")?.[0]?.({}, fallbackContext.ctx);
    await fallback.commands.get("guard")?.handler("", fallbackContext.ctx);
    expect(fallback.rawPi.getActiveTools()).toEqual(["read", "bash", ...REQUIRED_PLAN_TOOLS]);
  });

  it("reloads settings between sessions so new defaults apply", async () => {
    let defaults: string[] = ["bash", "custom"];
    const mock = createMockPi({
      activeTools: ["write"],
      allTools: [
        builtinTool("read"),
        builtinTool("bash"),
        builtinTool("write"),
        extensionTool("custom"),
      ],
    });
    createGuard({
      readSettings: async () => ({
        kind: "loaded",
        settings: { thinkingLevel: "inherit", defaultPlanTools: defaults },
      }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual(["bash", "custom", ...REQUIRED_PLAN_TOOLS]);
    await mock.commands.get("guard")?.handler("exit", context.ctx);

    defaults = ["read"];
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual(["read", ...REQUIRED_PLAN_TOOLS]);
  });

  it("falls back to built-in defaults when settings are invalid", async () => {
    const mock = createMockPi({
      activeTools: ["read", "bash"],
      allTools: [builtinTool("read"), builtinTool("bash")],
    });
    createGuard({
      readSettings: async () => ({ kind: "invalid", reason: "invalid settings shape" }),
    })(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    expect(context.notifications.at(-1)?.message).toMatch(/settings ignored/);

    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual(["bash", "read", ...REQUIRED_PLAN_TOOLS]);
  });

  it("restores only the active branch state", async () => {
    const activeBranch = [
      planModeStateEntry({
        enabled: true,
        awaitingAction: true,
        latestPlan: "# Active branch",
        latestPlanSource: "guard_mode_complete",
      }),
    ];
    const mock = createMockPi({ activeTools: ["read"], allTools: [builtinTool("read")] });
    createGuard()(mock.pi);
    const context = createMockContext({
      hasUI: false,
      sessionManager: {
        getBranch: () => activeBranch,
        getEntries: () => [
          ...activeBranch,
          planModeStateEntry({ enabled: false, awaitingAction: false }),
        ],
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    expect(context.statuses.get("plan-mode")).toBe("plan ready");

    await mock.commands.get("guard")?.handler("show", context.ctx);
    const sent = mock.sentMessages.at(-1)?.message as { content?: string } | undefined;
    expect(sent?.content ?? "").toContain("# Active branch");
  });
});

describe("host-added tool visibility", () => {
  it("activates built-in tools when the host reports source \"builtin\"", async () => {
    // 真实宿主（pi-coding-agent）中内置工具 sourceInfo.source === "builtin"，
    // 而非 guard 测试 mock 里的 "pi"。
    const mock = createMockPi({
      activeTools: ["read", "bash", "write", "grep", "find", "ls"],
      allTools: [
        { name: "read", sourceInfo: { source: "builtin" } },
        { name: "bash", sourceInfo: { source: "builtin" } },
        { name: "write", sourceInfo: { source: "builtin" } },
        { name: "grep", sourceInfo: { source: "builtin" } },
        { name: "find", sourceInfo: { source: "builtin" } },
        { name: "ls", sourceInfo: { source: "builtin" } },
      ],
    });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);

    // 默认工具集应包含只读内置工具 + 必需工具，而不是只剩 guard 两个工具
    expect(mock.rawPi.getActiveTools()).toEqual(
      expect.arrayContaining(["read", "bash", "grep", "find", "ls", ...REQUIRED_PLAN_TOOLS]),
    );
  });

  it("keeps a host-activated write tool visible across before_agent_start", async () => {
    const mock = createMockPi({
      activeTools: ["read", "bash"],
      allTools: [
        builtinTool("read"),
        builtinTool("bash"),
        builtinTool("write"),
        builtinTool("grep"),
        builtinTool("find"),
        builtinTool("ls"),
      ],
    });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);

    // 用户在 Guard 模式内通过宿主 UI 激活 write（宿主 setActiveTools 生效）
    mock.rawPi.setActiveTools(["read", "bash", "write", ...REQUIRED_PLAN_TOOLS]);
    expect(mock.rawPi.getActiveTools()).toContain("write");

    // 下一轮 agent 开始——guard 不应把宿主激活的 write 顶掉
    await mock.events.get("before_agent_start")?.[0]?.(
      { systemPrompt: "base", prompt: "continue", systemPromptOptions: {} },
      context.ctx,
    );

    expect(mock.rawPi.getActiveTools()).toContain("write");
  });
});

describe("restored tool selections", () => {
  function resumedMock(data: Record<string, unknown>, settings: Record<string, unknown>) {
    const mock = createMockPi({
      activeTools: ["write"],
      allTools: [
        builtinTool("read"),
        builtinTool("bash"),
        builtinTool("grep"),
        extensionTool("custom"),
      ],
    });
    createGuard({ readSettings: settingsLoader(settings) })(
mock.pi);
    const entry = planModeStateEntry(data);
    const context = createMockContext({
      sessionManager: {
        getBranch: () => [entry],
        getEntries: () => [entry],
      },
    });
    return { mock, context };
  }

  it("override configured defaults after a session resume", async () => {
    const { mock, context } = resumedMock(
      { enabled: true, awaitingAction: false, selectedToolNames: ["read"] },
      { defaultPlanTools: ["bash", "custom"] },
    );
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual(["read", ...REQUIRED_PLAN_TOOLS]);
  });

  it("restore an intentionally empty active-tool set", async () => {
    const { mock, context } = resumedMock(
      { enabled: true, awaitingAction: false, selectedToolNames: [] },
      { defaultPlanTools: ["bash", "custom"] },
    );
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual(REQUIRED_PLAN_TOOLS);
  });

  it("fall back to configured defaults when no selections were persisted", async () => {
    const { mock, context } = resumedMock(
      { enabled: true, awaitingAction: false },
      { defaultPlanTools: ["bash", "custom"] },
    );
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual(["bash", "custom", ...REQUIRED_PLAN_TOOLS]);
  });
});

describe("implementation handoff", () => {
  it("restores the original tools after using configured defaults", async () => {
    const mock = createMockPi({
      activeTools: ["read", "write", "custom"],
      allTools: [
        builtinTool("read"),
        builtinTool("bash"),
        builtinTool("write"),
        extensionTool("custom"),
      ],
    });
    createGuard({ readSettings: settingsLoader({ defaultPlanTools: ["bash"] }) })(
mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    expect(mock.rawPi.getActiveTools()).toEqual(["bash", ...REQUIRED_PLAN_TOOLS]);

    const execute = mock.tools.find((tool) => tool.name === "guard_mode_complete")?.execute as
      | ((...args: unknown[]) => Promise<unknown>)
      | undefined;
    expect(execute).toBeDefined();
    await execute?.("complete", { plan: "# Configured handoff" }, undefined, undefined, context.ctx);
    await mock.commands.get("guard")?.handler("implement", context.ctx);

    expect(mock.rawPi.getActiveTools()).toEqual(["read", "write", "custom"]);
    expect(mock.sentUserMessages.at(-1)?.text ?? "").toMatch(/# Configured handoff/);
  });
});

describe("tool selector", () => {
  it("keeps the cursor on the toggled row", async () => {
    const mock = createMockPi({
      activeTools: ["write"],
      allTools: [
        builtinTool("read"),
        builtinTool("bash"),
        builtinTool("write"),
        extensionTool("custom"),
      ],
    });
    createGuard({ readSettings: settingsLoader({ defaultPlanTools: ["bash", "custom"] }) })(
mock.pi);
    let customCalled = false;
    const context = createMockContext({
      hasUI: true,
      custom: async (factory: unknown) => {
        customCalled = true;
        const { renders, result } = driveCustomSelector(factory, [
          "tui.select.down",
          "tui.select.confirm",
          "tui.select.cancel",
        ]);
        expect(renders[1]?.some((line) => line.includes("› [x] read"))).toBe(true);
        return result;
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    await mock.commands.get("guard")?.handler("tools", context.ctx);

    expect(customCalled).toBe(true);
    expect(mock.rawPi.getActiveTools()).toEqual([
      "bash",
      "read",
      "custom",
      ...REQUIRED_PLAN_TOOLS,
    ]);
  });

  it("searches metadata and toggles the stable tool name", async () => {
    const mock = createMockPi({
      activeTools: ["write"],
      allTools: [
        builtinTool("read"),
        builtinTool("bash"),
        builtinTool("write"),
        { ...extensionTool("custom"), description: "Remote inspection helper" },
      ],
    });
    createGuard({ readSettings: settingsLoader({ defaultPlanTools: ["bash", "custom"] }) })(
mock.pi);
    let customCalled = false;
    const context = createMockContext({
      hasUI: true,
      custom: async (factory: unknown) => {
        customCalled = true;
        const harness = createCustomSelectorHarness(factory, 60);
        for (const input of ["r", "e", "m", "o", "t", "e"]) harness.handleInput(input);
        const filtered = stripVTControlCharacters(harness.render().join("\n"));
        expect(filtered).toMatch(/custom/);
        expect(filtered).not.toMatch(/› .*bash|› .*read|› .*write/);
        harness.handleInput("tui.select.confirm");
        for (let index = 0; index < 6; index += 1) harness.handleInput("\u007f");
        expect(stripVTControlCharacters(harness.render().join("\n"))).toMatch(/› \[ \] custom/);
        harness.handleInput("tui.select.cancel");
        await harness.waitForPending();
        return harness.result;
      },
    });

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    await mock.commands.get("guard")?.handler("tools", context.ctx);

    expect(customCalled).toBe(true);
    expect(mock.rawPi.getActiveTools()).toEqual(["bash", ...REQUIRED_PLAN_TOOLS]);
    const persisted = mock.entries.at(-1)?.data as { selectedToolNames?: string[] } | undefined;
    expect(persisted?.selectedToolNames).toEqual(["bash"]);
  });
});
