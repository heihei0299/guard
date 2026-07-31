/**
 * Guard Plan Mode — core orchestration logic.
 *
 * Provides the central decision-making functions for Plan Mode:
 * - State factory and helpers
 * - System prompt builder (three-mode prompt)
 * - Tool call classification (allow/block decisions)
 *
 * Event handler registration is not included here — it belongs in the
 * extension entry point (index.ts), which will be rewritten in a later ticket.
 */

import type { PlanModeState } from "./state.ts";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { classifyPlanModeTool, isSafeCommand, isPathAllowed, DEFAULT_ALLOW_WRITE_PATHS } from "./tool-policy.ts";
// ── State ──────────────────────────────────────────────────────────────────

/**
 * Create a default (disabled) PlanModeState.
 */
export function createPlanModeState(): PlanModeState {
  return { enabled: false, awaitingAction: false };
}

// ── Prompt Builder ─────────────────────────────────────────────────────────

/**
 * Build the Plan Mode system prompt based on the current state.
 *
 * Returns an empty string when Plan Mode is inactive.
 * Otherwise returns a three-section prompt describing the current mode,
 * path allowlist, and any active plan/implementation.
 */
export function buildPlanModePrompt(state: PlanModeState): string {
  if (!state.enabled && !state.activeImplementation) return "";

  const sections: string[] = [];

  if (state.activeImplementation) {
    // Active Implementation mode
    sections.push("🔧 Guard Mode: Active Implementation");
    sections.push("");
    sections.push("You are implementing an accepted plan. Full tool access is restored.");
    sections.push("");
    sections.push("【Active Plan】");
    sections.push(state.activeImplementation.plan);
    sections.push("");
    sections.push("Use `/guard show` to view the active plan at any time.");
    return sections.join("\n");
  }

  if (!state.enabled) return "";

  // Plan Mode is enabled
  if (state.awaitingAction && state.latestPlan) {
    // Plan Ready state
    sections.push("✅ Guard Mode: Plan Ready");
    sections.push("");
    sections.push("A plan has been submitted and is waiting for your decision.");
    sections.push("");
    sections.push("【Submitted Plan】");
    sections.push(state.latestPlan);
    sections.push("");
    sections.push("Options:");
    sections.push("- `/guard implement` — Accept and implement the plan");
    sections.push("- `/guard continue` — Continue planning without implementing");
    sections.push("- `/guard exit` — Exit Guard Mode and discard the plan");
    return sections.join("\n");
  }

  // Planning mode
  sections.push("🔒 Guard Mode: Planning");
  sections.push("");
  sections.push("You are in Guard Mode. You can explore the codebase, ask questions, and create a plan.");
  sections.push("Direct code changes are restricted to allowlisted paths.");
  sections.push("");
  sections.push("【Path Allowlist】");
  sections.push(`The following paths can be written to:`);
  for (const p of DEFAULT_ALLOW_WRITE_PATHS) {
    sections.push(`  - \`${p}\``);
  }
  sections.push("");
  sections.push("【Workflow】");
  sections.push("1. Explore and understand the codebase");
  sections.push("2. Ask questions using `plan_mode_question` if needed");
  sections.push("3. Submit your plan using `plan_mode_complete`");
  sections.push("4. Wait for the user to review and decide");

  return sections.join("\n");
}

// ── Tool Call Classification ───────────────────────────────────────────────

export interface ToolCallResult {
  allow: boolean;
  block?: boolean;
  reason?: string;
}

/**
 * Classify a tool call and decide whether to allow or block it.
 *
 * When Plan Mode is disabled, all tools pass through (allow: true).
 * When enabled, the tool's policy category determines the behavior:
 * - read-only → allow
 * - limited (bash) → check with isSafeCommand
 * - allowlisted (write/replace) → check with isPathAllowed
 * - blocked → block
 * - user-opt-in → block (unless explicitly enabled)
 *
 * Plan Mode required tools (plan_mode_question, plan_mode_complete) are always allowed.
 */
export function classifyToolCall(
  toolName: string,
  input: Record<string, unknown>,
  state: PlanModeState,
): ToolCallResult {
  // When Plan Mode is disabled, pass through everything
  if (!state.enabled) {
    return { allow: true };
  }

  // Always allow Plan Mode required tools
  if (toolName === "plan_mode_question" || toolName === "plan_mode_complete") {
    return { allow: true };
  }

  // Build a minimal ToolInfo for classification
  const tool: ToolInfo = {
    name: toolName,
    description: "",
    parameters: undefined as any,
    promptGuidelines: undefined as any,
    sourceInfo: { source: "pi", path: "", scope: "user", origin: "package" },
  };

  const policy = classifyPlanModeTool(tool);

  switch (policy) {
    case "read-only":
      return { allow: true };

    case "limited":
      // bash: check command safety
      if (toolName === "bash") {
        const command = typeof input.command === "string" ? input.command : "";
        if (!command) return { allow: true };
        if (isSafeCommand(command)) {
          return { allow: true };
        }
        return {
          allow: false,
          block: true,
          reason: `Guard Mode blocks unsafe bash command.\nCommand: ${command}`,
        };
      }
      return { allow: true };

    case "allowlisted":
      // write/replace: check path allowlist
      if (toolName === "write" || toolName === "replace") {
        const path = typeof input.path === "string" ? input.path : "";
        if (isPathAllowed(path)) {
          return { allow: true };
        }
        return {
          allow: false,
          block: true,
          reason: `Guard Mode blocks write to '${path}'. Allowed: .scratch/, docs/, CONTEXT.md`,
        };
      }
      return { allow: true };

    case "blocked":
      return {
        allow: false,
        block: true,
        reason: `Guard Mode blocks tool '${toolName}'. This tool is not available during planning.`,
      };

    case "user-opt-in":
      return {
        allow: false,
        block: true,
        reason: `Guard Mode blocks custom tool '${toolName}'. Use '/guard tools' to enable it.`,
      };

    default:
      return { allow: true };
  }
}
