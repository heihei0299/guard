import { describe, it, expect } from "vitest";
import { createPlanModeState, classifyToolCall } from "./plan-mode.ts";
import type { PlanModeState } from "./state.ts";

describe("createPlanModeState", () => {
  it("returns a disabled state by default", () => {
    const state = createPlanModeState();
    expect(state.enabled).toBe(false);
    expect(state.awaitingAction).toBe(false);
    expect(state.latestPlan).toBeUndefined();
  });
});

describe("classifyToolCall", () => {
  const enabledState: PlanModeState = { enabled: true, awaitingAction: false };

  it("allows read tool in planning mode", () => {
    const result = classifyToolCall("read", {}, enabledState);
    expect(result.allow).toBe(true);
  });

  it("allows bash with safe command in planning mode", () => {
    const result = classifyToolCall("bash", { command: "ls -la" }, enabledState);
    expect(result.allow).toBe(true);
  });

  it("blocks bash with unsafe command in planning mode", () => {
    const result = classifyToolCall("bash", { command: "rm -rf /" }, enabledState);
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("unsafe");
  });

  it("allows write to allowlisted path in planning mode", () => {
    const result = classifyToolCall("write", { path: ".scratch/foo.md" }, enabledState);
    expect(result.allow).toBe(true);
  });

  it("blocks write to non-allowlisted path in planning mode", () => {
    const result = classifyToolCall("write", { path: "src/main.ts" }, enabledState);
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("Allowed");
  });

  it("blocks edit tool in planning mode", () => {
    const result = classifyToolCall("edit", { path: "file.ts" }, enabledState);
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("not available");
  });

  it("blocks update_plan tool in planning mode", () => {
    const result = classifyToolCall("update_plan", {}, enabledState);
    expect(result.allow).toBe(false);
  });

  it("allows plan_mode_question in planning mode", () => {
    const result = classifyToolCall("plan_mode_question", {}, enabledState);
    expect(result.allow).toBe(true);
  });

  it("allows plan_mode_complete in planning mode", () => {
    const result = classifyToolCall("plan_mode_complete", {}, enabledState);
    expect(result.allow).toBe(true);
  });

  it("allows all tools when plan mode is disabled", () => {
    const disabledState: PlanModeState = { enabled: false, awaitingAction: false };
    const result = classifyToolCall("write", { path: "src/main.ts" }, disabledState);
    expect(result.allow).toBe(true);
  });

  it("passes through when not enabled (no block reason)", () => {
    const disabledState: PlanModeState = { enabled: false, awaitingAction: false };
    const result = classifyToolCall("bash", { command: "rm -rf /" }, disabledState);
    expect(result.allow).toBe(true);
  });

  it("allows bash with safe structured command (npx tsc --noEmit)", () => {
    const result = classifyToolCall("bash", { command: "npx tsc --noEmit" }, enabledState);
    expect(result.allow).toBe(true);
  });
});
