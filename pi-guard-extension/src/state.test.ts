import { describe, it, expect } from "vitest";
import { restorePlanModeState, type PlanModeState } from "./state.ts";
import { PLAN_MODE_MAX_CHARS } from "./completion-tool.ts";

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
      latestPlanSource: "guard_mode_complete",
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
        source: "guard_mode_complete",
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
          latestPlanSource: "guard_mode_complete",
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(true);
    expect(result.latestPlan).toBe("My plan");
    expect(result.latestPlanSource).toBe("guard_mode_complete");
    expect(result.awaitingAction).toBe(true);
  });

  it("restores latestPlan from a legacy plan_mode_complete source", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: {
          enabled: true,
          latestPlan: "Pre-rename plan",
          latestPlanSource: "plan_mode_complete",
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(true);
    expect(result.latestPlan).toBe("Pre-rename plan");
    expect(result.latestPlanSource).toBe("plan_mode_complete");
    expect(result.awaitingAction).toBe(true);
  });

  it("restores latestPlan from a legacy_proposed_plan source", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: {
          enabled: true,
          latestPlan: "Legacy proposed plan",
          latestPlanSource: "legacy_proposed_plan",
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(true);
    expect(result.latestPlan).toBe("Legacy proposed plan");
    expect(result.latestPlanSource).toBe("legacy_proposed_plan");
    expect(result.awaitingAction).toBe(true);
  });

  it("fails closed on an unknown latestPlanSource", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: {
          enabled: true,
          latestPlan: "Plan with unknown source",
          latestPlanSource: "some_future_source",
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(true);
    expect(result.latestPlan).toBeUndefined();
    expect(result.latestPlanSource).toBeUndefined();
    expect(result.awaitingAction).toBe(false);
  });

  it("restores latestPlan when the source field is missing (oldest format)", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: {
          enabled: true,
          latestPlan: "Oldest-format plan",
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(true);
    expect(result.latestPlan).toBe("Oldest-format plan");
    expect(result.latestPlanSource).toBeUndefined();
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
        data: { enabled: true, latestPlan: "Latest plan", latestPlanSource: "guard_mode_complete" },
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
            source: "guard_mode_complete",
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

  it("restores activeImplementation from a legacy plan_mode_complete source", () => {
    const entries = [
      {
        type: "custom",
        customType: "guard_plan_mode_state",
        data: {
          enabled: false,
          activeImplementation: {
            id: "impl-old",
            plan: "Pre-rename implementation",
            source: "plan_mode_complete",
            startedAt: 5000,
          },
        },
      },
    ];
    const result = restorePlanModeState(entries, "guard_plan_mode_state");
    expect(result.enabled).toBe(false);
    expect(result.activeImplementation).toBeDefined();
    expect(result.activeImplementation!.id).toBe("impl-old");
    expect(result.activeImplementation!.plan).toBe("Pre-rename implementation");
    expect(result.activeImplementation!.source).toBe("plan_mode_complete");
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
            source: "guard_mode_complete",
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

describe("restorePlanModeState restoration gaps", () => {
  const stateEntry = (data: Record<string, unknown>) => ({
    type: "custom",
    customType: "guard_plan_mode_state",
    data,
  });

  it("restores selectedToolNames deduplicated when all entries are strings", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: false,
          selectedToolNames: ["read", "bash", "read"],
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.selectedToolNames).toEqual(["read", "bash"]);
  });

  it("fails closed when selectedToolNames contains non-strings", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: false,
          selectedToolNames: ["read", 42],
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.selectedToolNames).toBeUndefined();
  });

  it("restores the applied and previous thinking levels while enabled", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: false,
          previousThinkingLevel: "low",
          appliedThinkingLevel: "medium",
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.previousThinkingLevel).toBe("low");
    expect(result.appliedThinkingLevel).toBe("medium");
  });

  it("restores a manual thinking level while enabled", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: false,
          manualThinkingLevel: "high",
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.manualThinkingLevel).toBe("high");
  });

  it("drops thinking levels but keeps tool selections while disabled", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: false,
          awaitingAction: false,
          previousThinkingLevel: "low",
          appliedThinkingLevel: "medium",
          manualThinkingLevel: "high",
          selectedToolNames: ["read"],
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.previousThinkingLevel).toBeUndefined();
    expect(result.appliedThinkingLevel).toBeUndefined();
    expect(result.manualThinkingLevel).toBeUndefined();
    expect(result.selectedToolNames).toEqual(["read"]);
  });

  it("drops invalid or inherit thinking levels", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: false,
          previousThinkingLevel: "inherit",
          appliedThinkingLevel: "extreme",
          manualThinkingLevel: 5,
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.previousThinkingLevel).toBeUndefined();
    expect(result.appliedThinkingLevel).toBeUndefined();
    expect(result.manualThinkingLevel).toBeUndefined();
  });

  it("trims a persisted plan on restore", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: true,
          latestPlan: "  # Plan  ",
          latestPlanSource: "guard_mode_complete",
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.latestPlan).toBe("# Plan");
  });

  it("fails closed on an oversized persisted plan", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: true,
          latestPlan: "x".repeat(PLAN_MODE_MAX_CHARS + 1),
          latestPlanSource: "guard_mode_complete",
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.latestPlan).toBeUndefined();
    expect(result.latestPlanSource).toBeUndefined();
    expect(result.awaitingAction).toBe(false);
  });

  it("fails closed on a whitespace-only persisted plan", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: true,
          latestPlan: " \n ",
          latestPlanSource: "guard_mode_complete",
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.latestPlan).toBeUndefined();
    expect(result.awaitingAction).toBe(false);
  });

  it("keeps a plan at exactly the maximum size", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: true,
          awaitingAction: true,
          latestPlan: "x".repeat(PLAN_MODE_MAX_CHARS),
          latestPlanSource: "guard_mode_complete",
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.latestPlan).toHaveLength(PLAN_MODE_MAX_CHARS);
    expect(result.awaitingAction).toBe(true);
  });

  it("fails closed on an oversized active implementation plan", () => {
    const result = restorePlanModeState(
      [
        stateEntry({
          enabled: false,
          awaitingAction: false,
          activeImplementation: {
            id: "impl-1",
            plan: "x".repeat(PLAN_MODE_MAX_CHARS + 1),
            source: "guard_mode_complete",
            startedAt: 5000,
          },
        }),
      ],
      "guard_plan_mode_state",
    );
    expect(result.activeImplementation).toBeUndefined();
  });
});
