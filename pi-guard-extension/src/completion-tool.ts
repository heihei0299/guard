import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

/**
 * Guard Plan Mode completion tool helpers.
 *
 * Pure validation and result-formatting logic for the `plan_mode_complete`
 * tool. Tool registration lives in the extension entry point (index.ts).
 */

export const PLAN_MODE_COMPLETE_TOOL_NAME = "plan_mode_complete";
export const PLAN_MODE_COMPLETE_VERSION = 1;
export const PLAN_MODE_MAX_CHARS = 50_000;

export type PlanModeCompletionDetails = {
  version: typeof PLAN_MODE_COMPLETE_VERSION;
  source: typeof PLAN_MODE_COMPLETE_TOOL_NAME;
  plan: string;
};

export const PLAN_MODE_COMPLETE_PARAMS = {
  type: "object",
  additionalProperties: false,
  required: ["plan"],
  properties: {
    plan: {
      type: "string",
      minLength: 1,
      maxLength: PLAN_MODE_MAX_CHARS,
      description: "The complete decision-ready implementation plan in Markdown.",
    },
  },
} as const;

type NormalizePlanModeCompletionResult = { ok: true; plan: string } | { ok: false; error: string };

/**
 * Validate and normalize the `plan_mode_complete` tool input.
 * Returns the trimmed plan on success, or an error message.
 */
export function normalizePlanModeCompletion(input: unknown): NormalizePlanModeCompletionResult {
  if (!isRecord(input) || typeof input.plan !== "string") {
    return { ok: false, error: "plan must be a string" };
  }
  const plan = input.plan.trim();
  if (!plan) return { ok: false, error: "plan must not be empty" };
  if (plan.length > PLAN_MODE_MAX_CHARS) {
    return { ok: false, error: `plan must not exceed ${PLAN_MODE_MAX_CHARS} characters` };
  }
  return { ok: true, plan };
}

/**
 * Extract a plan from tool result details, validating version and source.
 * Returns undefined when the details are not a recognized completion result.
 */
export function planFromCompletionDetails(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (
    value.version !== PLAN_MODE_COMPLETE_VERSION ||
    value.source !== PLAN_MODE_COMPLETE_TOOL_NAME
  ) {
    return undefined;
  }
  const normalized = normalizePlanModeCompletion({ plan: value.plan });
  return normalized.ok ? normalized.plan : undefined;
}

/**
 * Build the tool result for a completed plan.
 *
 * The result renders the plan as a **Proposed Plan** markdown block and
 * carries versioned details so the state can be restored from session entries.
 * terminate: true ends the current agent turn.
 */
export function planModeCompleted(plan: string) {
  return {
    content: [{ type: "text" as const, text: `**Proposed Plan**\n\n${plan}` }],
    details: {
      version: PLAN_MODE_COMPLETE_VERSION,
      source: PLAN_MODE_COMPLETE_TOOL_NAME,
      plan,
    } satisfies PlanModeCompletionDetails,
    terminate: true,
  };
}

/**
 * Extract markdown text from a completion tool result.
 *
 * Prefers the rendered text blocks in `content`; falls back to the plan
 * stored in `details` when no text is available.
 */
export function planModeCompletionMarkdown(result: PlanModeCompletionRenderResult) {
  const content = result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (content) return content;
  const plan = planFromCompletionDetails(result.details);
  return plan ? `**Proposed Plan**\n\n${plan}` : "";
}

/**
 * Render the completion result as a Markdown TUI component.
 */
export function renderPlanModeCompletion(result: PlanModeCompletionRenderResult) {
  return new Markdown(planModeCompletionMarkdown(result), 0, 0, getMarkdownTheme());
}

type PlanModeCompletionRenderResult = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
