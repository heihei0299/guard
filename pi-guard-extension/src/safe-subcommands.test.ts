import { describe, it, expect } from "vitest";
import { createGuard } from "./index.ts";
import { createMockPi, createMockContext, builtinTool } from "./test-support.ts";

/**
 * Bash safety integration tests for the DEFAULT structured-command policy.
 *
 * Note: the `safeSubcommands` settings option is normalized but deliberately
 * not enforced yet (recorded as a forward-looking API in Ticket 02 review);
 * these tests cover the built-in safe prefixes only.
 */
describe("bash safety integration", () => {
  it("enforces structured command safety only while Guard mode is active", async () => {
    const mock = createMockPi({
      activeTools: ["bash"],
      allTools: [builtinTool("read"), builtinTool("bash")],
    });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    const hook = mock.events.get("tool_call")?.[0];
    expect(hook).toBeDefined();

    expect(
      await hook?.({ toolName: "bash", input: { command: "gh pr merge 218" } }, context.ctx),
    ).toBeUndefined();

    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);

    expect(
      await hook?.(
        { toolName: "bash", input: { command: "git rev-parse --show-toplevel" } },
        context.ctx,
      ),
    ).toBeUndefined();
    expect(
      await hook?.(
        { toolName: "bash", input: { command: "gh pr view 218 --json number,title" } },
        context.ctx,
      ),
    ).toBeUndefined();
    expect(
      await hook?.({ toolName: "bash", input: { command: "git status --short" } }, context.ctx),
    ).toBeUndefined();
    expect(
      await hook?.({ toolName: "bash", input: { command: "npx tsc --noEmit" } }, context.ctx),
    ).toBeUndefined();

    const blocked = (await hook?.(
      { toolName: "bash", input: { command: "gh pr merge 218" } },
      context.ctx,
    )) as { reason?: string } | undefined;
    expect(blocked).toMatchObject({ block: true });
    expect(blocked?.reason ?? "").toMatch(/non-allowlisted bash commands/);

    expect(
      await hook?.({ toolName: "bash", input: { command: "git commit -m wip" } }, context.ctx),
    ).toMatchObject({ block: true });
  });

  it("blocks multi-line heredoc-style commands via the newline rule", async () => {
    const mock = createMockPi({
      activeTools: ["bash"],
      allTools: [builtinTool("read"), builtinTool("bash")],
    });
    createGuard()(mock.pi);
    const context = createMockContext({ hasUI: false });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    await mock.commands.get("guard")?.handler("", context.ctx);
    const hook = mock.events.get("tool_call")?.[0];
    expect(hook).toBeDefined();

    const heredoc = `python - <<'PY'\nfrom pathlib import Path\nPath("probe.txt").write_text("unexpected write\\n", encoding="utf-8")\nPY`;
    const blocked = (await hook?.(
      { toolName: "bash", input: { command: heredoc } },
      context.ctx,
    )) as { reason?: string } | undefined;
    expect(blocked).toMatchObject({ block: true });
    expect(blocked?.reason ?? "").toMatch(/non-allowlisted bash commands/);
  });
});
