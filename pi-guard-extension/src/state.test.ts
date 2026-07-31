import { describe, it, expect } from "vitest";
import { restorePlanModeState, type PlanModeState } from "./state.ts";

describe("PlanModeState", () => {
  it("has correct default shape", () => {
    const state: PlanModeState = { enabled: false, awaitingAction: false };
    expect(state.enabled).toBe(false);
    expect(state.awaitingAction).toBe(false);
    expect(state.latestPlan).toBeUndefined();
    expect(state.latestPlanSource).toBeUndefined();
    expect(state.activeImplementation).toBeUndefined();
  });

  it("accepts enabled state with plan", () => {
    const state: PlanModeState = {
      enabled: true,
      latestPlan: "Step 1: do X",
      latestPlanSource: "plan_mode_complete",
      awaitingAction: true,
    };
    expect(state.enabled).toBe(true);
    expect(state.latestPlan).toBe("Step 1: do X");
    expect(state.awaitingAction).toBe(true);
  });

  it("accepts activeImplementation", () => {
    const state: PlanModeState = {
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "abc-123",
        plan: "Implement X",
        source: "plan_mode_complete",
        startedAt: 1000,
      },
    };
    expect(state.activeImplementation?.id).toBe("abc-123");
    expect(state.activeImplementation?.plan).toBe("Implement X");
  });
});

describe("restorePlanModeState", () => {
  it("returns disabled state when no entries provided", () => {
    const result = restorePlanModeState([], "guard_plan_mode_state");
    expect(result.enabled).toBe(false);
    expect(result.awaitingAction).toBe(false);
  });

  it("returns disabled state when entries is empty array", () => {
    const result = restorePlanModeState([], "guard_plan_mode_state");
    expect(result.enabled).toBe(false);
    expect(result.awaitingAction).toBe(false);
  });

  it("restores enabled state from session entry", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: {
          enabled: true,
          latestPlan: "My plan",
          latestPlanSource: "plan_mode_complete",
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(true);
    expect(result.latestPlan).toBe("My plan");
    expect(result.latestPlanSource).toBe("plan_mode_complete");
    expect(result.awaitingAction).toBe(true);
  });

  it("returns disabled state when entry has no data", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(false);
    expect(result.awaitingAction).toBe(false);
  });

  it("finds the latest state entry when multiple exist", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: { enabled: false },
      },
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: { enabled: true, latestPlan: "Latest plan", latestPlanSource: "plan_mode_complete" },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(true);
    expect(result.latestPlan).toBe("Latest plan");
  });

  it("ignores entries with different customType", () => {
    const entries = [
      {
        type: "custom",
        customType: "other_type",
        data: { enabled: true },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(false);
  });

  it("handles non-array entries gracefully", () => {
    const result = restorePlanModeState(null as unknown as unknown[], "guard_plan_mode_state");
    expect(result.enabled).toBe(false);
  });

  it("restores activeImplementation when enabled is false", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: {
          enabled: false,
          activeImplementation: {
            id: "impl-1",
            plan: "Implement feature",
            source: "plan_mode_complete",
            startedAt: 5000,
          },
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(false);
    expect(result.activeImplementation).toBeDefined();
    expect(result.activeImplementation!.id).toBe("impl-1");
    expect(result.activeImplementation!.plan).toBe("Implement feature");
  });

  it("ignores activeImplementation when enabled is true", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: {
          enabled: true,
          activeImplementation: {
            id: "impl-1",
            plan: "Implement feature",
            source: "plan_mode_complete",
            startedAt: 5000,
          },
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(true);
    expect(result.activeImplementation).toBeUndefined();
  });
});
