import { describe, it, expect } from "vitest";
import { buildPlanModePrompt } from "./prompt.ts";
import type { PlanModeState } from "./state.ts";

describe("buildPlanModePrompt", () => {
  it("returns planning prompt when enabled without plan", () => {
    const state: PlanModeState = { enabled: true, awaitingAction: false };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toContain("Guard Mode");
    expect(prompt).toContain("plan");
  });

  it("returns plan-ready prompt when plan is submitted", () => {
    const state: PlanModeState = {
      enabled: true,
      latestPlan: "My plan",
      latestPlanSource: "plan_mode_complete",
      awaitingAction: true,
    };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toContain("Plan Ready");
    expect(prompt).toContain("My plan");
  });

  it("returns implementing prompt when active implementation", () => {
    const state: PlanModeState = {
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "impl-1",
        plan: "Implement X",
        source: "plan_mode_complete",
        startedAt: 1000,
      },
    };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toContain("Active Implementation");
    expect(prompt).toContain("Implement X");
  });

  it("returns inactive prompt when guard mode is off", () => {
    const state: PlanModeState = { enabled: false, awaitingAction: false };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toBe("");
  });

  it("includes path allowlist info in planning prompt", () => {
    const state: PlanModeState = { enabled: true, awaitingAction: false };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toContain(".scratch/");
    expect(prompt).toContain("docs/");
    expect(prompt).toContain("CONTEXT.md");
  });

  it("guides the model through three phases", () => {
    const state: PlanModeState = { enabled: true, awaitingAction: false };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toContain("Phase 1");
    expect(prompt).toContain("Phase 2");
    expect(prompt).toContain("Phase 3");
  });

  it("states mode rules", () => {
    const state: PlanModeState = { enabled: true, awaitingAction: false };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toContain("Mode rules");
  });

  it("states the completion rule and references plan_mode_complete", () => {
    const state: PlanModeState = { enabled: true, awaitingAction: false };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toContain("Completion rule");
    expect(prompt).toContain("plan_mode_complete");
  });

  it("is bilingual: includes both English and Chinese guidance", () => {
    const state: PlanModeState = { enabled: true, awaitingAction: false };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).toContain("Guard Mode");
    expect(prompt).toMatch(/[一-龥]/);
  });

  it("does not include plan-ready block during plain planning", () => {
    const state: PlanModeState = { enabled: true, awaitingAction: false };
    const prompt = buildPlanModePrompt(state);
    expect(prompt).not.toContain("Plan Ready");
  });
});
