import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGuard, type GuardExtensionOptions } from "./index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Mock permission config loader ─────────────────────────────────────────

const mockPermissionConfig = vi.hoisted(() => ({
  global: {} as Record<string, unknown>,
  project: {} as Record<string, unknown>,
}));

vi.mock("./permission-config.ts", () => ({
  loadPermissionConfig: vi.fn(() => mockPermissionConfig),
}));

// ── Helpers ──────────────────────────────────────────────────────────────

type EventHandler = (...args: any[]) => any;
type EventHandlers = Record<string, EventHandler>;

function createMockPi(): {
  pi: ExtensionAPI;
  handlers: EventHandlers;
} {
  const handlers: EventHandlers = {};
  const pi = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers[event] = handler;
    }),
    registerCommand: vi.fn(),
  } as unknown as ExtensionAPI;

  return { pi, handlers };
}

function createMockCtx(overrides?: Record<string, any>): any {
  return {
    hasUI: false,
    cwd: "/home/user/project",
    ui: { notify: vi.fn(), confirm: vi.fn() },
    abort: vi.fn(),
    injectSystemPrompt: vi.fn(),
    removeSystemPrompt: vi.fn(),
    sessionManager: {
      getEntries: vi.fn(() => []),
    },
    ...overrides,
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────

/**
 * Initialize a guard with the given config and run a full session lifecycle:
 * session_start → input (target skill) → agent_settled → rule engine active.
 */
async function setupFullSession(
  pi: any,
  handlers: any,
  config: Record<string, unknown>,
  targetSkill = "/skill:to-spec",
) {
  mockPermissionConfig.global = config;
  mockPermissionConfig.project = {};

  await handlers["session_start"](
    { type: "session_start", reason: "startup" },
    createMockCtx(),
  );

  await handlers["input"](
    { type: "input", text: targetSkill },
    createMockCtx(),
  );

  await handlers["agent_settled"](
    { type: "agent_settled" },
    createMockCtx(),
  );
}

/**
 * Shorthand: set up deny-all path config.
 */
function denyAllConfig(): Record<string, unknown> {
  return {
    permission: {
      "*": "deny",
    },
  };
}

/**
 * Set up rules matching old path allowlist behavior.
 */
function oldAllowlistConfig(): Record<string, unknown> {
  return {
    permission: {
      "*": "deny",
      path: {
        ".scratch/*": "allow",
        "docs/*": "allow",
        "CONTEXT.md": "allow",
      },
    },
  };
}

/**
 * Set up ask-default config.
 */
function askDefaultConfig(): Record<string, unknown> {
  return {
    permission: {
      "*": "ask",
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("createGuard", () => {
  beforeEach(() => {
    mockPermissionConfig.global = {};
    mockPermissionConfig.project = {};
  });

  it("registers event handlers on init", () => {
    const { pi } = createMockPi();
    createGuard()(pi);

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("input", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("agent_settled", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "guard:allow",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "guard-start",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
  });

  it("registers event handlers in correct order", () => {
    const { pi } = createMockPi();
    createGuard()(pi);

    const events = (pi.on as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(events[0]).toBe("session_start");
  });

  describe("session_start handler", () => {
    it("resets state on startup reason", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const ctx = createMockCtx();
      await handlers["session_start"](
        { type: "session_start", reason: "startup" },
        ctx,
      );
    });

    it("scans entries on resume to rebuild rule engine active state", async () => {
      const { pi, handlers } = createMockPi();
      mockPermissionConfig.global = denyAllConfig();
      createGuard()(pi);

      const ctx = createMockCtx({
        sessionManager: {
          getEntries: vi.fn(() => [
            {
              type: "message",
              message: {
                role: "user",
                content: "/skill:to-spec",
              },
            },
          ]),
        },
      });

      await handlers["session_start"](
        { type: "session_start", reason: "resume" },
        ctx,
      );

      const toolHandler = handlers["tool_call"];
      const result = await toolHandler(
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("does not block on resume without target skills", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const ctx = createMockCtx({
        sessionManager: {
          getEntries: vi.fn(() => [
            { type: "message", message: { role: "user", content: "hello world" } },
          ]),
        },
      });

      await handlers["session_start"](
        { type: "session_start", reason: "resume" },
        ctx,
      );

      const toolHandler = handlers["tool_call"];
      const result = await toolHandler(
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });
  });

  describe("input handler", () => {
    it("transitions to skill_active on target skill command", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      await handlers["input"](
        { type: "input", text: "/skill:to-spec" },
        createMockCtx(),
      );

      const toolHandler = handlers["tool_call"];
      const result = await toolHandler(
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("returns continue action", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const result = await handlers["input"](
        { type: "input", text: "hello" },
        createMockCtx(),
      );
      expect(result).toEqual({ action: "continue" });
    });
  });

  describe("agent_settled handler", () => {
    it("activates rule engine when skill was active", async () => {
      const { pi, handlers } = createMockPi();
      mockPermissionConfig.global = denyAllConfig();
      createGuard()(pi);

      await handlers["session_start"](
        { type: "session_start", reason: "startup" },
        createMockCtx(),
      );

      await handlers["input"](
        { type: "input", text: "/skill:to-spec" },
        createMockCtx(),
      );

      await handlers["agent_settled"](
        { type: "agent_settled" },
        createMockCtx(),
      );

      const toolHandler = handlers["tool_call"];
      const result = await toolHandler(
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("does not block if skill was not active", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      await handlers["agent_settled"](
        { type: "agent_settled" },
        createMockCtx(),
      );

      const toolHandler = handlers["tool_call"];
      const result = await toolHandler(
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });
  });

  describe("rule engine evaluation", () => {
    it("allows write to path when rule matches allow", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, oldAllowlistConfig());

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: ".scratch/test.txt" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("blocks write to path when rule matches deny", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, oldAllowlistConfig());

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("allows replace to allowlisted path", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, oldAllowlistConfig());

      const result = await handlers["tool_call"](
        { toolName: "replace", input: { path: ".scratch/file.ts" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("blocks replace to non-allowlisted path", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, oldAllowlistConfig());

      const result = await handlers["tool_call"](
        { toolName: "replace", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("allows write to docs/ path", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, oldAllowlistConfig());

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "docs/guide.md" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("allows write to CONTEXT.md", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, oldAllowlistConfig());

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "CONTEXT.md" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("allows write with ./ prefix", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, oldAllowlistConfig());

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "./.scratch/test.txt" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("blocks write bash commands by default with deny-all config", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const result = await handlers["tool_call"](
        { toolName: "bash", input: { command: "rm -rf /tmp/test" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("allows readonly bash commands (ls) even with deny-all config", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const result = await handlers["tool_call"](
        { toolName: "bash", input: { command: "ls -la" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("allows git readonly commands (git status)", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const result = await handlers["tool_call"](
        { toolName: "bash", input: { command: "git status" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("blocks git write commands (git commit)", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const result = await handlers["tool_call"](
        { toolName: "bash", input: { command: "git commit -m 'test'" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("blocks npm install", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const result = await handlers["tool_call"](
        { toolName: "bash", input: { command: "npm install foo" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("allows read tool (not evaluated by rule engine)", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const result = await handlers["tool_call"](
        { toolName: "read", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("allows grep tool (not evaluated by rule engine)", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const result = await handlers["tool_call"](
        { toolName: "grep", args: {} },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("allows edit tool (not evaluated by rule engine)", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const result = await handlers["tool_call"](
        { toolName: "edit", args: {} },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("does not block when rule engine is not active", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("calls abort and shows notification in UI mode on deny", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const ctx = createMockCtx({
        hasUI: true,
        ui: { notify: vi.fn(), confirm: vi.fn() },
        abort: vi.fn(),
      });

      await setupFullSession(pi, handlers, denyAllConfig());

      await handlers["tool_call"](
        { toolName: "write", input: { path: "src/index.ts" } },
        ctx,
      );

      expect(ctx.abort).toHaveBeenCalledTimes(1);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("🔒"),
        "warning",
      );
    });
  });

  describe("ask action", () => {
    it("prompts user for confirmation when action is ask and UI is available", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const ctx = createMockCtx({
        hasUI: true,
        ui: {
          notify: vi.fn(),
          confirm: vi.fn(async () => true),
        },
        abort: vi.fn(),
      });

      await setupFullSession(pi, handlers, askDefaultConfig());

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "src/index.ts" } },
        ctx,
      );
      expect(result).toBeUndefined();
      expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    });

    it("blocks when user declines ask confirmation", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const ctx = createMockCtx({
        hasUI: true,
        ui: {
          notify: vi.fn(),
          confirm: vi.fn(async () => false),
        },
        abort: vi.fn(),
      });

      await setupFullSession(pi, handlers, askDefaultConfig());

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "src/index.ts" } },
        ctx,
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("需要用户确认"),
      });
    });

    it("blocks when ask has no UI available", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const ctx = createMockCtx({
        hasUI: false,
        ui: { notify: vi.fn(), confirm: vi.fn() },
        abort: vi.fn(),
      });

      await setupFullSession(pi, handlers, askDefaultConfig());

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "src/index.ts" } },
        ctx,
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("无 UI"),
      });
    });
  });

  describe("/guard-start command", () => {
    it("registers guard-start command", () => {
      const { pi } = createMockPi();
      createGuard()(pi);

      expect(pi.registerCommand).toHaveBeenCalledWith(
        "guard-start",
        expect.objectContaining({
          description: expect.any(String),
          handler: expect.any(Function),
        }),
      );
    });

    it("activates rule engine and notifies", async () => {
      const { pi, handlers } = createMockPi();
      mockPermissionConfig.global = denyAllConfig();
      createGuard()(pi);

      const cmd = (pi.registerCommand as ReturnType<typeof vi.fn>).mock
        .calls.find((c: any[]) => c[0] === "guard-start");
      const cmdHandler = cmd[1].handler;
      const ctx = createMockCtx({
        ui: { notify: vi.fn(), confirm: vi.fn() },
        projectRoot: "/project",
      });

      await cmdHandler({}, ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("已激活"),
        "info",
      );

      const toolHandler = handlers["tool_call"];
      const result = await toolHandler(
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("shows already-active message when rule engine is already active", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const cmd = (pi.registerCommand as ReturnType<typeof vi.fn>).mock
        .calls.find((c: any[]) => c[0] === "guard-start");
      const cmdHandler = cmd[1].handler;

      // First activate via /guard-start
      const ctx1 = createMockCtx({
        ui: { notify: vi.fn(), confirm: vi.fn() },
        projectRoot: "/project",
      });
      await cmdHandler({}, ctx1);

      // Activate again
      const ctx2 = createMockCtx({
        ui: { notify: vi.fn(), confirm: vi.fn() },
        projectRoot: "/project",
      });
      await cmdHandler({}, ctx2);

      expect(ctx2.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("无需重复激活"),
        "info",
      );
    });
  });

  describe("/guard:allow command", () => {
    it("registers guard:allow command", () => {
      const { pi } = createMockPi();
      createGuard()(pi);

      expect(pi.registerCommand).toHaveBeenCalledWith(
        "guard:allow",
        expect.objectContaining({
          description: expect.any(String),
          handler: expect.any(Function),
        }),
      );
    });

    it("deactivates rule engine and notifies", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);
      await setupFullSession(pi, handlers, denyAllConfig());

      const cmd = (pi.registerCommand as ReturnType<typeof vi.fn>).mock
        .calls.find((c: any[]) => c[0] === "guard:allow");
      const cmdHandler = cmd[1].handler;
      const ctx = createMockCtx({ ui: { notify: vi.fn(), confirm: vi.fn() } });
      await cmdHandler({}, ctx);

      const toolHandler = handlers["tool_call"];
      const result = await toolHandler(
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("🔓"),
        "info",
      );
    });

    it("shows not-active info when already in normal state", async () => {
      const { pi, handlers } = createMockPi();
      createGuard()(pi);

      const cmd = (pi.registerCommand as ReturnType<typeof vi.fn>).mock
        .calls.find((c: any[]) => c[0] === "guard:allow");
      const cmdHandler = cmd[1].handler;
      const ctx = createMockCtx({ ui: { notify: vi.fn(), confirm: vi.fn() } });

      await cmdHandler({}, ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("未激活"),
        "info",
      );
    });
  });

  describe("custom target skills", () => {
    it("accepts custom target skills via options", async () => {
      const { pi, handlers } = createMockPi();
      mockPermissionConfig.global = denyAllConfig();
      createGuard({ targetSkills: ["my-custom-skill"] })(pi);

      await handlers["session_start"](
        { type: "session_start", reason: "startup" },
        createMockCtx(),
      );

      await handlers["input"](
        { type: "input", text: "/skill:my-custom-skill" },
        createMockCtx(),
      );

      await handlers["agent_settled"](
        { type: "agent_settled" },
        createMockCtx(),
      );

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("🔒"),
      });
    });

    it("does not trigger guard for non-custom skills", async () => {
      const { pi, handlers } = createMockPi();
      mockPermissionConfig.global = denyAllConfig();
      createGuard({ targetSkills: ["my-custom-skill"] })(pi);

      // Default skill to-spec should NOT trigger guard for this instance
      await handlers["session_start"](
        { type: "session_start", reason: "startup" },
        createMockCtx(),
      );

      await handlers["input"](
        { type: "input", text: "/skill:to-spec" },
        createMockCtx(),
      );

      await handlers["agent_settled"](
        { type: "agent_settled" },
        createMockCtx(),
      );

      const result = await handlers["tool_call"](
        { toolName: "write", input: { path: "src/index.ts" } },
        createMockCtx(),
      );
      expect(result).toBeUndefined();
    });
  });
});
