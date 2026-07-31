/**
 * @deprecated This module is being replaced by Plan Mode modules.
 * Retained as a stub for backward compatibility during migration.
 * Will be removed when index.ts is rewritten in Ticket 05.
 *
 * The new Plan Mode state machine and orchestration live in `./plan-mode.ts`.
 */

import { createPlanModeState } from "./plan-mode.ts";
import type { PlanModeState } from "./state.ts";

// ── Types ──────────────────────────────────────────────────────────────────

/** @deprecated Use Plan Mode state management instead. */
export type GuardState = "normal" | "skill_active";

/** @deprecated Use Plan Mode settings instead. */
export interface GuardMachineOptions {
  targetSkills?: readonly string[];
  autoActivateAfterSkill?: boolean;
}

/** @deprecated Use Plan Mode state instead. */
export interface GuardMachine {
  getState(): GuardState;
  isRuleEngineActive(): boolean;
  activateRuleEngine(): void;
  deactivateRuleEngine(): void;
  isTargetSkill(command: string): boolean;
  handleInput(text: string): void;
  handleAgentSettled(): void;
  handleAllow(): void;
  reset(): void;
  rebuildFromHistory(entries: readonly any[]): void;
}

// ── Backward-compatible stub implementations ───────────────────────────────

/**
 * @deprecated Create a Plan Mode state instead of using the old guard state machine.
 * Use `createPlanModeState()` from `./plan-mode.ts` for new code.
 */
export function createStateMachine(_options?: GuardMachineOptions & { config?: import("./config.ts").GuardConfig }): GuardMachine {
  const planState: PlanModeState = createPlanModeState();
  let ruleEngineActive = false;

  return {
    getState(): GuardState {
      return "normal";
    },
    isRuleEngineActive(): boolean {
      return ruleEngineActive;
    },
    activateRuleEngine(): void {
      ruleEngineActive = true;
    },
    deactivateRuleEngine(): void {
      ruleEngineActive = false;
    },
    isTargetSkill(_command: string): boolean {
      return false;
    },
    handleInput(_text: string): void {
      // No-op stub
    },
    handleAgentSettled(): void {
      // No-op stub
    },
    handleAllow(): void {
      ruleEngineActive = false;
    },
    reset(): void {
      ruleEngineActive = false;
    },
    rebuildFromHistory(_entries: readonly any[]): void {
      // No-op stub
    },
  };
}

/**
 * @deprecated Use `classifyToolCall` from `./plan-mode.ts` instead.
 */
export function extractTextContent(
  content: string | ReadonlyArray<{ type: string; text?: string }> | null | undefined,
): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const first = content[0];
  if (typeof first === "object" && first !== null && "type" in first && first.type === "text") {
    return first.text;
  }
  return undefined;
}

// Re-export deprecated config for backward compatibility
export { DEFAULT_CONFIG, type GuardConfig } from "./config.ts";
export { DEFAULT_TARGET_SKILLS, DEFAULT_ALLOW_WRITE_PATHS } from "./config.ts";
