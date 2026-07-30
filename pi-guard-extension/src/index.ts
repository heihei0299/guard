import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  createStateMachine,
  DEFAULT_TARGET_SKILLS,
  type GuardMachineOptions,
} from "./guard.ts";
import { isBashReadonly } from "./bash-command-classifier.ts";

// ── Exports ────────────────────────────────────────────────────────────

export type { GuardState, GuardMachine, GuardMachineOptions } from "./guard.ts";

export interface GuardExtensionOptions {
  /** List of skill names that trigger the guard. */
  targetSkills?: readonly string[];
}

/** Bilingual block message shown when an action is intercepted. */
const BLOCK_REASON_SKILL_ACTIVE = [
  "🔒 技能进行中，请按技能流程执行，禁止擅自写代码。",
  "Guard mode: skill in progress, follow the skill process, no unauthorized writes.",
  "如需写入，请先完成技能流程。",
  "Complete the skill process before writing.",
].join("\n");

/** Bilingual block message shown when action is intercepted after skill settled. */
const BLOCK_REASON_GUARDED = [
  "🔒 技能讨论已完成，禁止擅自操作。",
  "Guard mode: skill conversation completed, unauthorized actions blocked.",
  "请使用 /guard:allow 临时关闭守卫。",
  "Use /guard:allow to temporarily disable guard mode.",
].join("\n");


// ── Extension factory ──────────────────────────────────────────────────

/**
 * Create a guard extension instance with the given options.
 *
 * Usage:
 * ```typescript
 * // With defaults
 * export default createGuard();
 *
 * // With custom target skills
 * export default createGuard({ targetSkills: ["to-tickets", "grill-me"] });
 * ```
 */
export function createGuard(options?: GuardExtensionOptions) {
  const targetSkills = options?.targetSkills ?? DEFAULT_TARGET_SKILLS;

  return function guardExtension(pi: ExtensionAPI): void {
    const guard = createStateMachine({ targetSkills } satisfies GuardMachineOptions);

    // ── Session start: rebuild guard state from history ──────────────
    pi.on("session_start", async (event, ctx) => {
      if (event.reason === "startup") {
        guard.reset();
      }
      // Scan existing entries to rebuild state
      const entries = ctx.sessionManager.getEntries();
      guard.rebuildFromHistory(entries);
    });

    // ── Input detection: target skill commands → skill_active ────────
    pi.on("input", async (event, _ctx) => {
      guard.handleInput(event.text);
      return { action: "continue" };
    });

    // ── Agent settled: skill_active → guarded ────────────────────────
    pi.on("agent_settled", async (_event, _ctx) => {
      guard.handleAgentSettled();
    });

    // ── Tool call interception: block write/replace/bash in guarded mode ──
    pi.on("tool_call", async (event, ctx) => {
      if (!guard.isBlocking()) return undefined;

      const { toolName } = event;

      // Tools that pass through in guarded mode (read, grep, find, ls, etc.)
      if (toolName !== "write" && toolName !== "replace" && toolName !== "bash") {
        return undefined;
      }

      // write/replace: check path allowlist
      if ((toolName === "write" || toolName === "replace") && event.input?.path) {
        if (guard.isPathAllowed(event.input.path as string)) {
          return undefined;
        }
      }

      // bash: check if the command is readonly
      if (toolName === "bash" && event.input?.command) {
        if (isBashReadonly(event.input.command as string)) {
          return undefined;
        }
      }

      // Show notification in UI mode
      if (ctx.hasUI) {
        const state = guard.getState();
        const msg = state === "skill_active" ? BLOCK_REASON_SKILL_ACTIVE : BLOCK_REASON_GUARDED;
        ctx.ui.notify(msg, "warning");
      }

      // Abort the agent turn
      ctx.abort();

      const state = guard.getState();
      const reason = state === "skill_active" ? BLOCK_REASON_SKILL_ACTIVE : BLOCK_REASON_GUARDED;
      return { block: true, reason };
    });

    // ── /guard:allow command ─────────────────────────────────────────
    pi.registerCommand("guard:allow", {
      description:
        "Temporarily disable guard mode, allowing write/replace/bash operations",
      handler: async (_args, ctx) => {
        if (guard.getState() === "normal") {
          ctx.ui.notify("🔓 守卫当前未激活 / Guard mode is not active", "info");
          return;
        }

        guard.handleAllow();
        ctx.ui.notify(
          "🔓 守卫已关闭，操作已放行 / Guard mode disabled, operations allowed",
          "info",
        );
      },
    });
  };
}

/** Default export: guard extension with default target skills. */
export default createGuard();
