/**
 * Guard state machine for pi-guard-extension.
 *
 * Two states: normal ↔ skill_active
 * After skill_active ends (agent_settled), the rule engine can be activated.
 * Transitions are driven by input detection, agent_settled, and /guard:allow.
 */
import type { GuardConfig } from "./config.ts";

// ── Types ────────────────────────────────────────────────────────────────

export type GuardState = "normal" | "skill_active";

export interface GuardMachineOptions {
  /** List of skill names (without "/skill:" prefix) that trigger the guard. */
  targetSkills?: readonly string[];
  /** Whether to auto-activate the rule engine after a skill completes.
   *  Default: true */
  autoActivateAfterSkill?: boolean;
}

export interface GuardMachine {
  /** Current state. */
  getState(): GuardState;
  /** Whether the rule engine is currently active. */
  isRuleEngineActive(): boolean;
  /** Activate the rule engine (used after skill completes or via /guard-start). */
  activateRuleEngine(): void;
  /** Deactivate the rule engine (via /guard:allow). */
  deactivateRuleEngine(): void;
  /** Check if a command string matches a target skill. */
  isTargetSkill(command: string): boolean;
  /** Process an input text to detect target skill commands. */
  handleInput(text: string): void;
  /** Handle agent_settled → if autoActivateAfterSkill, activate rule engine. */
  handleAgentSettled(): void;
  /** Handle /guard:allow → transition to normal, deactivate rule engine. */
  handleAllow(): void;
  /** Reset to normal state, deactivate rule engine. */
  reset(): void;
  /** Rebuild state by scanning session history for target skill calls. */
  rebuildFromHistory(entries: readonly any[]): void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract plain text content from a user/assistant message.
 *
 * Content can be:
 * - A plain string (returned as-is)
 * - An array of content parts (extract the first `type: "text"` part)
 * - null / undefined (return undefined)
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

// ── State machine factory ────────────────────────────────────────────────

export function createStateMachine(config?: GuardMachineOptions & { config?: GuardConfig }): GuardMachine {
  const targetSkills = config?.targetSkills ?? config?.config?.targetSkills ?? DEFAULT_CONFIG.targetSkills;
  const autoActivateAfterSkill = config?.autoActivateAfterSkill ?? true;
  let state: GuardState = "normal";
  let ruleEngineActive = false;

  return {
    getState(): GuardState {
      return state;
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

    isTargetSkill(command: string): boolean {
      // Check /skill:<name> format (exact match)
      for (const skill of targetSkills) {
        if (command === `/skill:${skill}`) return true;
      }
      // Check <skill name="..."> XML tag format (search anywhere in text)
      const match = command.match(/<skill\s+name\s*=\s*(["'])([^"']+)\1[^>]*\/?\s*>/i);
      if (match) {
        return targetSkills.includes(match[2]);
      }
      return false;
    },

    handleInput(text: string): void {
      const extracted = extractTextContent(text) ?? text;
      const trimmed = extracted.trim();

      if (this.isTargetSkill(trimmed)) {
        state = "skill_active";
        // Entering skill_active deactivates the rule engine
        ruleEngineActive = false;
      }
      // Non-target-skill commands do not change state.
    },

    handleAgentSettled(): void {
      if (state === "skill_active") {
        state = "normal";
        if (autoActivateAfterSkill) {
          ruleEngineActive = true;
        }
      }
      // No-op in normal state.
    },

    handleAllow(): void {
      state = "normal";
      ruleEngineActive = false;
    },

    reset(): void {
      state = "normal";
      ruleEngineActive = false;
    },

    rebuildFromHistory(entries: readonly any[]): void {
      for (const entry of entries) {
        // Duck-type: extract role and content from various entry shapes
        // SessionMessageEntry: { type: "message", message: { role, content } }
        // Test HistoryEntry: { role, content }
        const role = entry.role ?? entry.message?.role;
        if (role !== "user" && role !== "User") continue;

        // Try direct content field first, then message.content for SessionMessageEntry
        const rawContent = entry.content ?? entry.message?.content ?? "";
        const text = extractTextContent(rawContent) ?? "";
        const trimmed = text.trim();

        if (this.isTargetSkill(trimmed)) {
          state = "normal";
          ruleEngineActive = true;
          break; // Once we find one, we know we need rule engine active.
        }
      }
    },
  };
}

// Re-export DEFAULT_CONFIG for backward compatibility in tests
import { DEFAULT_CONFIG } from "./config.ts";
export { DEFAULT_CONFIG, type GuardConfig } from "./config.ts";
export { DEFAULT_TARGET_SKILLS, DEFAULT_ALLOW_WRITE_PATHS } from "./config.ts";
