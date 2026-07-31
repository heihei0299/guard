/**
 * Guard Plan Mode extension runtime helpers.
 *
 * Provides thin wrappers around pi's ExtensionAPI for:
 * - Registering agent_settled event handlers (type-safe)
 * - Setting thinking levels
 * - Detecting stale extension context errors
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanModeFixedThinkingLevel } from "./settings.ts";

type AgentSettledHandler = (event: unknown, ctx: ExtensionContext) => unknown;

/**
 * Register a handler for the agent_settled event.
 *
 * agent_settled fires after the agent finishes processing a turn,
 * regardless of whether it produced output or was blocked.
 *
 * @param pi - ExtensionAPI instance
 * @param handler - Callback invoked on agent_settled
 */
export function onAgentSettled(pi: ExtensionAPI, handler: AgentSettledHandler): void {
  (
    pi as unknown as {
      on(event: "agent_settled", callback: AgentSettledHandler): void;
    }
  ).on("agent_settled", handler);
}

/**
 * Set the thinking level for Plan Mode.
 *
 * @param pi - ExtensionAPI instance
 * @param level - The fixed thinking level to apply (not "inherit")
 */
export function setPlanThinkingLevel(pi: ExtensionAPI, level: PlanModeFixedThinkingLevel): void {
  (pi.setThinkingLevel as unknown as (level: PlanModeFixedThinkingLevel) => void)(level);
}

/**
 * Check if an error indicates a stale extension context.
 *
 * This happens when the extension context is replaced (session reload, fork, etc.)
 * and the old context is no longer valid.
 *
 * @param error - The error to check
 * @returns true if the error is a stale context error
 */
export function isStaleExtensionContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("This extension ctx is stale after session replacement or reload") ||
      error.message.includes("Extension context is no longer active"))
  );
}
