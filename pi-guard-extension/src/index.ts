import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  createStateMachine,
  DEFAULT_TARGET_SKILLS,
  type GuardMachineOptions,
} from "./guard.ts";
import { isBashReadonly } from "./bash-command-classifier.ts";
import { evaluate, evaluateAnyValue, composeRuleset, synthesizeDefaults, normalizeFlatConfig } from "./rule-engine.ts";
import { getPathPolicyValues } from "./path-normalizer.ts";
import { loadPermissionConfig } from "./permission-config.ts";
import { buildGuardPrompt } from "./prompt-injector.ts";

// ── Exports ────────────────────────────────────────────────────────────

export type { GuardState, GuardMachine, GuardMachineOptions } from "./guard.ts";

export interface GuardExtensionOptions {
  /** List of skill names that trigger the guard. */
  targetSkills?: readonly string[];
  /** @deprecated Path allowlist is being replaced by rule engine. */
  allowWritePaths?: readonly string[];
}

/** Bilingual block message shown in skill_active state (skill in progress). */
const BLOCK_REASON_SKILL_ACTIVE = [
  "🔒 技能对话中，请按技能流程执行，禁止擅自操作。",
  "Guard mode: skill in progress, follow the skill process, no unauthorized writes.",
  "请先完成技能讨论再写代码。",
  "Complete the skill process before writing.",
].join("\n");

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build the effective ruleset from permission configs.
 * Composes: defaults → global config → project config
 */
function buildRuleset(projectRoot?: string): Ruleset {
  const config = loadPermissionConfig(projectRoot);

  // Default: allow everything (permissive default, matching current Guard philosophy)
  const defaults = synthesizeDefaults("allow");

  // Global config
  const globalRules = config.global?.permission
    ? normalizeFlatConfig(config.global.permission as Record<string, unknown>)
    : [];

  // Project config
  const projectRules = config.project?.permission
    ? normalizeFlatConfig(config.project.permission as Record<string, unknown>)
    : [];

  return composeRuleset(defaults, globalRules, projectRules);
}

/**
 * Format the block reason from a deny rule.
 */
function formatBlockReason(rule: Rule, toolName: string, value: string): string {
  const lines = [
    "🔒 Guard 规则引擎阻止了此操作。",
    `Guard rule engine blocked this ${toolName} operation.`,
    `触犯规则：${rule.surface} / ${rule.pattern} → ${rule.action}`,
  ];
  if (rule.reason) {
    lines.push(`原因：${rule.reason}`);
  }
  lines.push("");
  lines.push(`值：${value}`);
  return lines.join("\n");
}

/**
 * Format the ask reason for user confirmation.
 */
function formatAskReason(rule: Rule, toolName: string, value: string): string {
  const lines = [
    "🔒 此操作需要用户确认。",
    `This operation requires your confirmation.`,
    `工具：${toolName}`,
    `值：${value}`,
  ];
  if (rule.reason) {
    lines.push(`原因：${rule.reason}`);
  }
  return lines.join("\n");
}

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
    let currentRuleset: Ruleset = [];
    let promptInjected = false;

    /**
     * Load the effective ruleset from config files.
     */
    function reloadRuleset(projectRoot?: string) {
      currentRuleset = buildRuleset(projectRoot);
    }

    /**
     * Inject the guard prompt into the system message.
     */
    function injectPrompt(ctx: any) {
      if (promptInjected) return;
      // Build and inject the prompt
      const prompt = buildGuardPrompt(currentRuleset);
      // Try to inject via ctx API (pi may support system prompt injection)
      try {
        if (typeof ctx.injectSystemPrompt === "function") {
          ctx.injectSystemPrompt(prompt);
          promptInjected = true;
        }
      } catch {
        // Silently fail if injection is not supported
      }
    }

    /**
     * Remove the injected guard prompt.
     */
    function removePrompt(ctx: any) {
      if (!promptInjected) return;
      try {
        if (typeof ctx.removeSystemPrompt === "function") {
          ctx.removeSystemPrompt();
          promptInjected = false;
        }
      } catch {
        // Silently fail
      }
    }

    // ── Session start: rebuild guard state from history ──────────────
    pi.on("session_start", async (event, ctx) => {
      if (event.reason === "startup") {
        guard.reset();
        promptInjected = false;
      }
      // Load ruleset
      const projectRoot = event.projectRoot
        ?? (typeof ctx.resolveProjectRoot === "function" ? ctx.resolveProjectRoot() : undefined);
      reloadRuleset(projectRoot);

      // Scan existing entries to rebuild state
      const entries = ctx.sessionManager.getEntries();
      guard.rebuildFromHistory(entries);

      // If rule engine was activated by rebuild, inject prompt
      if (guard.isRuleEngineActive()) {
        injectPrompt(ctx);
      }
    });

    // ── Input detection: target skill commands → skill_active ────────
    pi.on("input", async (event, _ctx) => {
      guard.handleInput(event.text);
      return { action: "continue" };
    });

    // ── Agent settled: skill_active → normal + rule engine activation ────
    pi.on("agent_settled", async (_event, ctx) => {
      const wasActive = guard.isRuleEngineActive();
      guard.handleAgentSettled();
      // If rule engine was just activated by handleAgentSettled
      if (!wasActive && guard.isRuleEngineActive()) {
        injectPrompt(ctx);
      }
    });

    // ── Tool call handler: rule engine evaluation ────────────────────
    pi.on("tool_call", async (event, ctx) => {
      const state = guard.getState();
      const ruleActive = guard.isRuleEngineActive();

      // If no guard is active, pass through
      if (state === "normal" && !ruleActive) return undefined;

      const { toolName } = event;

      // Block in skill_active state (transitional: preserve old behavior)
      if (state === "skill_active") {
        // Only block write/replace/bash
        if (toolName !== "write" && toolName !== "replace" && toolName !== "bash") {
          return undefined;
        }
        // For bash, allow readonly commands even in skill_active
        if (toolName === "bash" && event.input?.command) {
          if (isBashReadonly(event.input.command as string)) {
            return undefined;
          }
        }
        // Block in skill_active
        if (ctx.hasUI) {
          ctx.ui.notify(BLOCK_REASON_SKILL_ACTIVE, "warning");
        }
        ctx.abort();
        return { block: true, reason: BLOCK_REASON_SKILL_ACTIVE };
      }

      // ── Rule engine is active: evaluate with rule engine ───────────
      if (ruleActive) {
        // Currently only evaluate write/replace/bash (progressive, extend later)
        if (toolName !== "write" && toolName !== "replace" && toolName !== "bash") {
          return undefined;
        }

        // ── write / replace: path surface evaluation ────────────────
        if ((toolName === "write" || toolName === "replace") && event.input?.path) {
          const filePath = event.input.path as string;
          const pathValues = getPathPolicyValues(filePath, {
            cwd: ctx.cwd ?? process.cwd(),
          });

          const result = evaluateAnyValue("path", pathValues, currentRuleset);

          switch (result.rule.action) {
            case "allow":
              return undefined; // Pass through
            case "ask":
              if (ctx.hasUI) {
                // Show confirm dialog
                const confirmed = await ctx.ui.confirm(
                  formatAskReason(result.rule, toolName, result.value),
                );
                if (confirmed) return undefined; // User confirmed
                // User declined → block
                ctx.ui.notify("操作已取消 / Operation cancelled", "info");
                ctx.abort();
                return {
                  block: true,
                  reason: `操作需要用户确认 / Operation requires confirmation: ${filePath}`,
                };
              }
              // No UI → block
              ctx.abort();
              return {
                block: true,
                reason: `此操作需要用户确认（无 UI）/ Operation requires confirmation (no UI): ${filePath}`,
              };
            case "deny": {
              const reason = formatBlockReason(result.rule, toolName, result.value);
              if (ctx.hasUI) {
                ctx.ui.notify(reason, "warning");
              }
              ctx.abort();
              return { block: true, reason };
            }
          }
        }

        // ── bash: bash surface evaluation ───────────────────────────
        if (toolName === "bash" && event.input?.command) {
          const command = event.input.command as string;

          // First, check if it's a readonly command (transitional: keep old behavior)
          if (isBashReadonly(command)) {
            return undefined;
          }

          // Evaluate with rule engine
          const result = evaluate("bash", command, currentRuleset);

          switch (result.action) {
            case "allow":
              return undefined; // Pass through
            case "ask":
              if (ctx.hasUI) {
                const confirmed = await ctx.ui.confirm(
                  formatAskReason(result, toolName, command),
                );
                if (confirmed) return undefined;
                ctx.ui.notify("操作已取消 / Operation cancelled", "info");
                ctx.abort();
                return {
                  block: true,
                  reason: `操作需要用户确认 / Operation requires confirmation: ${command}`,
                };
              }
              ctx.abort();
              return {
                block: true,
                reason: `此操作需要用户确认（无 UI）/ Operation requires confirmation (no UI): ${command}`,
              };
            case "deny": {
              const reason = formatBlockReason(result, toolName, command);
              if (ctx.hasUI) {
                ctx.ui.notify(reason, "warning");
              }
              ctx.abort();
              return { block: true, reason };
            }
          }
        }

        // Fallback: pass through for unevaluated tools
        return undefined;
      }

      // Fallback: pass through
      return undefined;
    });

    // ── /guard-start command ──────────────────────────────────────────
    pi.registerCommand("guard-start", {
      description:
        "Activate Guard rule engine and inject rule prompt into system message",
      handler: async (_args, ctx) => {
        if (guard.isRuleEngineActive()) {
          ctx.ui.notify(
            "🔒 Guard 规则已激活，无需重复激活 / Guard is already active",
            "info",
          );
          return;
        }

        // Reload ruleset from config
        reloadRuleset(ctx.projectRoot);
        guard.activateRuleEngine();
        injectPrompt(ctx);

        ctx.ui.notify(
          "🔒 Guard 规则已激活 / Guard rules activated",
          "info",
        );
      },
    });

    // ── /guard:allow command ─────────────────────────────────────────
    pi.registerCommand("guard:allow", {
      description:
        "Deactivate Guard rule engine and remove rule prompt",
      handler: async (_args, ctx) => {
        if (guard.getState() === "normal" && !guard.isRuleEngineActive()) {
          ctx.ui.notify("🔓 守卫当前未激活 / Guard mode is not active", "info");
          return;
        }

        removePrompt(ctx);
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
