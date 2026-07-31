import { describe, it, expect } from "vitest"
import {
  updatePlanModeUi,
  clearPlanModeUi,
  planModeStatusText,
} from "./presentation.ts"
import type { PlanModeState } from "./state.ts"

type UiCall = { kind: "status"; key: string; text: string | undefined } | { kind: "widget"; key: string; content: string[] | undefined }

function mockCtx() {
  const calls: UiCall[] = []
  const ctx = {
    ui: {
      setStatus: (key: string, text: string | undefined) => {
        calls.push({ kind: "status", key, text })
      },
      setWidget: (key: string, content: string[] | undefined) => {
        calls.push({ kind: "widget", key, content })
      },
    },
  } as never
  return { ctx: ctx as Parameters<typeof updatePlanModeUi>[0], calls }
}

const toolSummary = () => "Tools: read, bash"

describe("updatePlanModeUi", () => {
  it("shows active status and planning widget when enabled without a plan", () => {
    const { ctx, calls } = mockCtx()
    const state: PlanModeState = { enabled: true, awaitingAction: false }
    updatePlanModeUi(ctx, state, toolSummary)

    expect(calls).toEqual([
      { kind: "status", key: "plan-mode", text: "plan active" },
      {
        kind: "widget",
        key: "plan-mode-plan",
        content: [
          "Guard mode: planning",
          "Tools: read, bash",
          "Finish with plan_mode_complete when decision-ready.",
        ],
      },
    ])
  })

  it("shows ready status and ready widget when a plan exists", () => {
    const { ctx, calls } = mockCtx()
    const state: PlanModeState = {
      enabled: true,
      latestPlan: "# Plan",
      awaitingAction: true,
    }
    updatePlanModeUi(ctx, state, toolSummary)

    expect(calls).toEqual([
      { kind: "status", key: "plan-mode", text: "plan ready" },
      {
        kind: "widget",
        key: "plan-mode-plan",
        content: [
          "Proposed plan ready",
          "Use /guard to implement, revise, or exit Guard mode.",
        ],
      },
    ])
  })

  it("shows implementing status and widget when an implementation is active", () => {
    const { ctx, calls } = mockCtx()
    const state: PlanModeState = {
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "plan-1",
        plan: "# Plan",
        source: "plan_mode_complete",
        startedAt: 1700000000000,
      },
    }
    updatePlanModeUi(ctx, state, toolSummary)

    expect(calls).toEqual([
      { kind: "status", key: "plan-mode", text: "plan implementing" },
      {
        kind: "widget",
        key: "plan-mode-plan",
        content: [
          "Implementation plan active",
          "Use /guard to show, replace, or clear it.",
        ],
      },
    ])
  })

  it("clears the widget when Guard mode is fully off", () => {
    const { ctx, calls } = mockCtx()
    const state: PlanModeState = { enabled: false, awaitingAction: false }
    updatePlanModeUi(ctx, state, toolSummary)

    expect(calls).toEqual([
      { kind: "status", key: "plan-mode", text: undefined },
      { kind: "widget", key: "plan-mode-plan", content: undefined },
    ])
  })
})

describe("clearPlanModeUi", () => {
  it("clears status and widget", () => {
    const { ctx, calls } = mockCtx()
    clearPlanModeUi(ctx)
    expect(calls).toEqual([
      { kind: "status", key: "plan-mode", text: undefined },
      { kind: "widget", key: "plan-mode-plan", content: undefined },
    ])
  })
})

describe("planModeStatusText", () => {
  it("describes an active plan mode without a plan", () => {
    const state: PlanModeState = { enabled: true, awaitingAction: false }
    expect(planModeStatusText(state, toolSummary)).toContain("Guard mode is active")
    expect(planModeStatusText(state, toolSummary)).toContain("plan_mode_complete")
  })

  it("describes a ready plan", () => {
    const state: PlanModeState = { enabled: true, latestPlan: "# Plan", awaitingAction: true }
    expect(planModeStatusText(state, toolSummary)).toContain("a proposed plan is ready")
  })

  it("describes an active implementation", () => {
    const state: PlanModeState = {
      enabled: false,
      awaitingAction: false,
      activeImplementation: {
        id: "plan-1",
        plan: "# Plan",
        source: "plan_mode_complete",
        startedAt: 1700000000000,
      },
    }
    expect(planModeStatusText(state, toolSummary)).toBe("An implementation plan is active.")
  })

  it("describes an off Guard mode", () => {
    const state: PlanModeState = { enabled: false, awaitingAction: false }
    expect(planModeStatusText(state, toolSummary)).toBe("Guard mode is off.")
  })
})
