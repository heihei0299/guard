import { describe, it, expect } from "vitest";
import { unique, toolNameFromLegacyKey, compareTools, isBuiltinTool } from "./tool-selection.ts";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

// Helper to create minimal ToolInfo mocks for tests
function makeToolInfo(overrides: Partial<ToolInfo> & { name: string }): ToolInfo {
  return {
    name: overrides.name,
    description: overrides.description ?? "",
    parameters: undefined as any,
    sourceInfo: overrides.sourceInfo ?? { path: "", source: "pi", scope: "user" as const, origin: "package" as const },
  };
}

describe("unique", () => {
  it("returns empty array for empty input", () => {
    expect(unique([])).toEqual([]);
  });

  it("returns same array when no duplicates", () => {
    expect(unique(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("removes duplicates preserving first-seen order", () => {
    expect(unique(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("handles single element", () => {
    expect(unique(["x"])).toEqual(["x"]);
  });

  it("handles all duplicates", () => {
    expect(unique(["a", "a", "a"])).toEqual(["a"]);
  });
});

describe("toolNameFromLegacyKey", () => {
  it("finds tool by direct name match", () => {
    const tools = [
      makeToolInfo({ name: "read", description: "Read files" }),
      makeToolInfo({ name: "bash", description: "Run commands" }),
    ];
    expect(toolNameFromLegacyKey("read", tools)).toBe("read");
  });

  it("returns undefined for unknown key", () => {
    expect(toolNameFromLegacyKey("unknown_tool", [])).toBeUndefined();
  });

  it("finds tool by legacy key with separator", () => {
    const tools = [
      makeToolInfo({
        name: "custom-tool",
        description: "",
        sourceInfo: { path: "", source: "user", scope: "user" as const, origin: "top-level" as const },
      }),
    ];
    // The legacy key format uses \x1f as separator — test the prefix extraction
    expect(toolNameFromLegacyKey("custom-tool\x1fsome-suffix", tools)).toBe("custom-tool");
  });
});

describe("compareTools", () => {
  it("sorts built-in tools before user tools", () => {
    const builtin = makeToolInfo({ name: "read" });
    const user = makeToolInfo({
      name: "my-tool",
      sourceInfo: { path: "/path", source: "user", scope: "user" as const, origin: "top-level" as const },
    });
    expect(compareTools(builtin, user)).toBeLessThan(0);
  });

  it("sorts user tools after built-in tools", () => {
    const builtin = makeToolInfo({ name: "bash" });
    const user = makeToolInfo({
      name: "my-tool",
      sourceInfo: { path: "/path", source: "user", scope: "user" as const, origin: "top-level" as const },
    });
    expect(compareTools(user, builtin)).toBeGreaterThan(0);
  });

  it("sorts tools with same builtin status by name", () => {
    const a = makeToolInfo({ name: "bash" });
    const b = makeToolInfo({ name: "read" });
    expect(compareTools(a, b)).toBeLessThan(0);
  });

  it("sorts tools with same builtin status by name ascending", () => {
    const a = makeToolInfo({ name: "zzz" });
    const b = makeToolInfo({ name: "aaa" });
    expect(compareTools(a, b)).toBeGreaterThan(0);
  });
});
