import { describe, it, expect, vi } from "vitest";
import {
  onAgentSettled,
  setPlanThinkingLevel,
  isStaleExtensionContextError,
} from "./extension-runtime.ts";

describe("onAgentSettled", () => {
  it("registers a handler on agent_settled event", () => {
    const on = vi.fn();
    const pi = { on } as any;
    const handler = vi.fn();

    onAgentSettled(pi, handler);

    expect(on).toHaveBeenCalledWith("agent_settled", handler);
  });
});

describe("setPlanThinkingLevel", () => {
  it("calls setThinkingLevel with the given level", () => {
    const setThinkingLevel = vi.fn();
    const pi = { setThinkingLevel } as any;

    setPlanThinkingLevel(pi, "medium");

    expect(setThinkingLevel).toHaveBeenCalledWith("medium");
  });

  it("calls setThinkingLevel with different levels", () => {
    const setThinkingLevel = vi.fn();
    const pi = { setThinkingLevel } as any;

    setPlanThinkingLevel(pi, "high");
    expect(setThinkingLevel).toHaveBeenCalledWith("high");
  });
});

describe("isStaleExtensionContextError", () => {
  it("returns true for stale context message", () => {
    const error = new Error("This extension ctx is stale after session replacement or reload");
    expect(isStaleExtensionContextError(error)).toBe(true);
  });

  it("returns true for inactive context message", () => {
    const error = new Error("Extension context is no longer active");
    expect(isStaleExtensionContextError(error)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isStaleExtensionContextError(new Error("Something else"))).toBe(false);
    expect(isStaleExtensionContextError(new Error(""))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isStaleExtensionContextError("string error")).toBe(false);
    expect(isStaleExtensionContextError(null)).toBe(false);
    expect(isStaleExtensionContextError(undefined)).toBe(false);
    expect(isStaleExtensionContextError({})).toBe(false);
  });
});
