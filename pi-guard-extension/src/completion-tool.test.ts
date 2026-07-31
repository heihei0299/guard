import { describe, it, expect } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  PLAN_MODE_MAX_CHARS,
  PLAN_MODE_COMPLETE_VERSION,
  GUARD_MODE_COMPLETE_TOOL_NAME,
  normalizePlanModeCompletion,
  planFromCompletionDetails,
  planModeCompleted,
  planModeCompletionMarkdown,
  renderPlanModeCompletion,
} from "./completion-tool.ts";

describe("normalizePlanModeCompletion", () => {
  it("accepts a valid non-empty plan", () => {
    const result = normalizePlanModeCompletion({ plan: "# Plan\n\nImplement X." });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toBe("# Plan\n\nImplement X.");
  });

  it("trims surrounding whitespace from the plan", () => {
    const result = normalizePlanModeCompletion({ plan: "  # Plan  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toBe("# Plan");
  });

  it("rejects non-object input", () => {
    const result = normalizePlanModeCompletion("not an object");
    expect(result).toEqual({ ok: false, error: "plan must be a string" });
  });

  it("rejects a non-string plan", () => {
    const result = normalizePlanModeCompletion({ plan: 42 });
    expect(result).toEqual({ ok: false, error: "plan must be a string" });
  });

  it("rejects an empty or whitespace-only plan", () => {
    const result = normalizePlanModeCompletion({ plan: "   " });
    expect(result).toEqual({ ok: false, error: "plan must not be empty" });
  });

  it("rejects a plan longer than 50000 characters", () => {
    const result = normalizePlanModeCompletion({ plan: "x".repeat(PLAN_MODE_MAX_CHARS + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("50000");
  });

  it("accepts a plan of exactly 50000 characters", () => {
    const result = normalizePlanModeCompletion({ plan: "x".repeat(PLAN_MODE_MAX_CHARS) });
    expect(result.ok).toBe(true);
  });
});

describe("planFromCompletionDetails", () => {
  it("extracts a plan from valid completion details", () => {
    const details = {
      version: PLAN_MODE_COMPLETE_VERSION,
      source: GUARD_MODE_COMPLETE_TOOL_NAME,
      plan: "# Plan",
    };
    expect(planFromCompletionDetails(details)).toBe("# Plan");
  });

  it("returns undefined for non-object input", () => {
    expect(planFromCompletionDetails(null)).toBeUndefined();
    expect(planFromCompletionDetails("plan")).toBeUndefined();
  });

  it("returns undefined when version does not match", () => {
    const details = {
      version: 99,
      source: GUARD_MODE_COMPLETE_TOOL_NAME,
      plan: "# Plan",
    };
    expect(planFromCompletionDetails(details)).toBeUndefined();
  });

  it("returns undefined when source does not match", () => {
    const details = {
      version: PLAN_MODE_COMPLETE_VERSION,
      source: "other_tool",
      plan: "# Plan",
    };
    expect(planFromCompletionDetails(details)).toBeUndefined();
  });

  it("returns undefined when plan is empty", () => {
    const details = {
      version: PLAN_MODE_COMPLETE_VERSION,
      source: GUARD_MODE_COMPLETE_TOOL_NAME,
      plan: "   ",
    };
    expect(planFromCompletionDetails(details)).toBeUndefined();
  });
});

describe("planModeCompleted", () => {
  it("renders the plan as a Proposed Plan text block", () => {
    const result = planModeCompleted("# Plan\n\nImplement X.");
    expect(result.content).toEqual([
      { type: "text", text: "**Proposed Plan**\n\n# Plan\n\nImplement X." },
    ]);
  });

  it("includes versioned completion details", () => {
    const result = planModeCompleted("# Plan");
    expect(result.details).toEqual({
      version: PLAN_MODE_COMPLETE_VERSION,
      source: GUARD_MODE_COMPLETE_TOOL_NAME,
      plan: "# Plan",
    });
  });

  it("sets terminate to true", () => {
    const result = planModeCompleted("# Plan");
    expect(result.terminate).toBe(true);
  });
});

describe("planModeCompletionMarkdown", () => {
  it("joins text blocks from the content", () => {
    const result = planModeCompletionMarkdown({
      content: [
        { type: "text", text: "**Proposed Plan**" },
        { type: "text", text: "# Plan" },
      ],
    });
    expect(result).toBe("**Proposed Plan**\n# Plan");
  });

  it("ignores non-text blocks", () => {
    const imageBlock = { type: "image", url: "x.png" } as { type: string; text?: string };
    const result = planModeCompletionMarkdown({
      content: [imageBlock, { type: "text", text: "# Plan" }],
    });
    expect(result).toBe("# Plan");
  });
  it("falls back to details when content has no text", () => {
    const result = planModeCompletionMarkdown({
      content: [],
      details: {
        version: PLAN_MODE_COMPLETE_VERSION,
        source: GUARD_MODE_COMPLETE_TOOL_NAME,
        plan: "# Plan",
      },
    });
    expect(result).toBe("**Proposed Plan**\n\n# Plan");
  });

  it("returns empty string when nothing is available", () => {
    expect(planModeCompletionMarkdown({ content: [] })).toBe("");
    expect(planModeCompletionMarkdown({ content: [] as never[] })).toBe("");
  });
});

function renderWithoutAnsi(result: Parameters<typeof renderPlanModeCompletion>[0]) {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return renderPlanModeCompletion(result)
    .render(80)
    .map((line) => line.replace(ansiPattern, ""))
    .join("\n");
}

describe("renderPlanModeCompletion", () => {
  it("renders the plan as Markdown without leaking raw syntax", () => {
    initTheme("dark");
    const rendered = renderWithoutAnsi(
      planModeCompleted("# Title\n\n- item\n\n```ts\nconst x = 1;\n```"),
    );

    expect(rendered).toMatch(/Proposed Plan/);
    expect(rendered).toMatch(/const x = 1;/);
    expect(rendered).not.toMatch(/\*\*Proposed Plan\*\*/);
    expect(rendered).not.toMatch(/# Title/);
  });

  it("falls back to details when content has no text blocks", () => {
    initTheme("dark");
    const result = planModeCompleted("# Fallback");
    const rendered = renderWithoutAnsi({ content: [], details: result.details });

    expect(rendered).toMatch(/Proposed Plan/);
    expect(rendered).toMatch(/Fallback/);
  });
});
