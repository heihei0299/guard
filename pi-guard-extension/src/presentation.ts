import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { PlanModeState } from "./state.ts"

/**
 * Guard Plan Mode TUI presentation helpers.
 *
 * Keeps the statusline and a small widget in sync with the current
 * Plan Mode state, and renders human-readable mode text.
 */

const STATUS_KEY = "plan-mode"
const PLAN_WIDGET_KEY = "plan-mode-plan"

/**
 * Update the TUI status and widget to reflect the current Plan Mode state.
 *
 * - enabled + latestPlan → "plan ready" with a ready widget
 * - enabled → "plan active" with a planning widget
 * - activeImplementation → "plan implementing" with an active-plan widget
 * - otherwise → no status, no widget
 */
export function updatePlanModeUi(
  ctx: ExtensionContext,
  state: PlanModeState,
  toolSummary: () => string,
) {
  ctx.ui.setStatus(STATUS_KEY, formatStatus(state))
  if (state.enabled && state.latestPlan) {
    ctx.ui.setWidget(PLAN_WIDGET_KEY, [
      "Proposed plan ready",
      "Use /guard to implement, revise, or exit Guard mode.",
    ])
  } else if (state.enabled) {
    ctx.ui.setWidget(PLAN_WIDGET_KEY, [
      "Guard mode: planning",
      toolSummary(),
      "Finish with plan_mode_complete when decision-ready.",
    ])
  } else if (state.activeImplementation) {
    ctx.ui.setWidget(PLAN_WIDGET_KEY, [
      "Implementation plan active",
      "Use /guard to show, replace, or clear it.",
    ])
  } else {
    ctx.ui.setWidget(PLAN_WIDGET_KEY, undefined)
  }
}

/**
 * Clear the Plan Mode status and widget from the TUI.
 */
export function clearPlanModeUi(ctx: ExtensionContext) {
  ctx.ui.setStatus(STATUS_KEY, undefined)
  ctx.ui.setWidget(PLAN_WIDGET_KEY, undefined)
}

/**
 * Build a human-readable one-line description of the current mode.
 */
export function planModeStatusText(state: PlanModeState, toolSummary: () => string) {
  if (state.enabled) {
    if (state.latestPlan) {
      return `Guard mode is active and a proposed plan is ready. ${toolSummary()}`
    }
    return `Guard mode is active. ${toolSummary()} Explore, ask, and finish with plan_mode_complete when decision-ready.`
  }
  if (state.activeImplementation) return "An implementation plan is active."
  return "Guard mode is off."
}

function formatStatus(state: PlanModeState) {
  if (state.enabled) {
    if (state.awaitingAction || state.latestPlan) return "plan ready"
    return "plan active"
  }
  if (state.activeImplementation) return "plan implementing"
  return undefined
}
