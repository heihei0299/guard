/**
 * Guard Plan Mode state types and serialization/deserialization.
 *
 * Stores the Plan Mode state (enabled/disabled, completed plans, active implementations)
 * using pi's session entry persistence mechanism.
 */

export type PlanCompletionSource = "plan_mode_complete" | "legacy_proposed_plan";

export interface ActiveImplementationPlan {
  id: string;
  plan: string;
  source: PlanCompletionSource;
  startedAt: number;
}

export interface PlanModeState {
  enabled: boolean;
  latestPlan?: string;
  latestPlanSource?: PlanCompletionSource;
  awaitingAction: boolean;
  activeImplementation?: ActiveImplementationPlan;
  selectedToolNames?: string[];
  previousThinkingLevel?: string;
  appliedThinkingLevel?: string;
  manualThinkingLevel?: string;
}

type SessionEntry = {
  type?: string;
  customType?: string;
  data?: Record<string, unknown>;
  message?: {
    role?: string;
    toolName?: string;
    details?: unknown;
  };
};

/**
 * Restore PlanModeState from session entries.
 *
 * Scans entries in reverse to find the latest guard_plan_mode_state custom entry,
 * then reconstructs the PlanModeState from its data field.
 *
 * @param entries - Session entries array
 * @param stateEntryType - The customType value used to identify state entries (e.g. "guard_plan_mode_state")
 * @returns Restored PlanModeState (defaults to disabled if not found)
 */
export function restorePlanModeState(
  entries: unknown[],
  stateEntryType: string,
): PlanModeState {
  if (!Array.isArray(entries)) {
    return { enabled: false, awaitingAction: false };
  }

  const branch = entries as SessionEntry[];

  // Find the latest state entry matching our customType
  let stateEntryIndex = -1;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const candidate = branch[index];
    if (candidate?.type === "custom" && candidate.customType === stateEntryType) {
      stateEntryIndex = index;
      break;
    }
  }

  const entry = branch[stateEntryIndex];
  if (!isRecord(entry?.data)) {
    return { enabled: false, awaitingAction: false };
  }

  const enabled = entry.data.enabled === true;

  // Only restore latestPlan/latestPlanSource when enabled
  const latestPlan = enabled ? stringValue(entry.data.latestPlan) : undefined;
  const latestPlanSource: PlanCompletionSource | undefined =
    enabled ? planCompletionSource(entry.data.latestPlanSource) : undefined;

  // Only restore activeImplementation when NOT enabled
  const activeImplementation = enabled
    ? undefined
    : normalizeActiveImplementation(entry.data.activeImplementation);

  return {
    enabled,
    latestPlan,
    latestPlanSource,
    awaitingAction: enabled && latestPlan !== undefined,
    activeImplementation,
  };
}

function normalizeActiveImplementation(
  value: unknown,
): ActiveImplementationPlan | undefined {
  if (!isRecord(value)) return undefined;

  const id = typeof value.id === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(value.id)
    ? value.id
    : undefined;
  const source = planCompletionSource(value.source);
  const plan = typeof value.plan === "string" && value.plan.trim().length > 0
    ? value.plan.trim()
    : undefined;
  const startedAt =
    typeof value.startedAt === "number" &&
    Number.isSafeInteger(value.startedAt) &&
    value.startedAt >= 0
      ? value.startedAt
      : undefined;

  if (!id || !source || !plan || startedAt === undefined) return undefined;
  return { id, plan, source, startedAt };
}

function planCompletionSource(value: unknown): PlanCompletionSource | undefined {
  return value === "plan_mode_complete" || value === "legacy_proposed_plan"
    ? (value as PlanCompletionSource)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
