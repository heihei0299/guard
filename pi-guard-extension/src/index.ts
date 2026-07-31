import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  createStateMachine,
  DEFAULT_TARGET_SKILLS,
  type GuardMachineOptions,
} from "./guard.ts";
import { isBashReadonly } from "./bash-command-classifier.ts";
import { evaluate, evaluateAnyValue, wildcardMatch, composeRuleset, synthesizeDefaults, normalizeFlatConfig } from "./rule-engine.ts";
import type { Rule, Ruleset } from "./rule-engine.ts";
import { getPathPolicyValues } from "./path-normalizer.ts";
import { loadPermissionConfig } from "./permission-config.ts";


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

/**
 * Handle ask action: prompt user for confirmation or block if no UI.
 */
async function handleAsk(rule: Rule, toolName: string, value: string, ctx: any) {
  if (ctx.hasUI) {
    const confirmed = await ctx.ui.confirm(
      formatAskReason(rule, toolName, value),
    );
    if (confirmed) return undefined;
    ctx.ui.notify("操作已取消 / Operation cancelled", "info");
    ctx.abort();
    return {
      block: true,
      reason: `操作需要用户确认 / Operation requires confirmation: ${value}`,
    };
  }
  ctx.abort();
  return {
    block: true,
    reason: `此操作需要用户确认（无 UI）/ Operation requires confirmation (no UI): ${value}`,
  };
}

/**
 * Handle deny action: block operation with reason.
 */
async function handleDeny(rule: Rule, toolName: string, value: string, ctx: any) {
  const reason = formatBlockReason(rule, toolName, value);
  if (ctx.hasUI) {
    ctx.ui.notify(reason, "warning");
  }
  ctx.abort();
  return { block: true, reason };
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


    /**
     * Load the effective ruleset from config files.
     */
    function reloadRuleset(projectRoot?: string) {
      currentRuleset = buildRuleset(projectRoot);
    }

    /**
     * @deprecated Legacy rule-engine prompt injection.
     * No-op stub: the prompt-injector module was removed in Ticket 03.
     * This function and its call sites are deleted when index.ts is
     * rewritten in Ticket 05.
     */
    function injectPrompt(_ctx: unknown) {
      // No-op — Guard Mode prompt building now lives in prompt.ts.
    }

    /**
     * @deprecated Legacy rule-engine prompt removal.
     * No-op stub: the prompt-injector module was removed in Ticket 03.
     * Removed entirely when index.ts is rewritten in Ticket 05.
     */
    function removePrompt(_ctx: unknown) {
      // No-op — prompt injection no longer exists.
    }

    // ── Session start: rebuild guard state from history ──────────────
    pi.on("session_start", async (event, ctx) => {
      if (event.reason === "startup") {
        guard.reset();
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
        // ── Path-bearing tools: evaluate on tool-specific + path surface ──
        if (event.input?.path) {
          const filePath = event.input.path as string;
          const pathValues = getPathPolicyValues(filePath, {
            cwd: ctx.cwd ?? process.cwd(),
          });

          // Evaluate on path surface first (most specific to the file operation)
          const pathResult = evaluateAnyValue("path", pathValues, currentRuleset);

          // If path surface has a non-default rule, use it (highest priority)
          if (pathResult.rule.layer !== "default" && pathResult.rule.surface === "path") {
            switch (pathResult.rule.action) {
              case "allow": return undefined;
              case "ask": return await handleAsk(pathResult.rule, toolName, filePath, ctx);
              case "deny": return await handleDeny(pathResult.rule, toolName, filePath, ctx);
            }
          }

          // Next, check tool-specific surface (e.g., "read", "write")
          // Only consider rules whose surface matches the tool name (not catch-all "*")
          for (let i = currentRuleset.length - 1; i >= 0; i--) {
            const rule = currentRuleset[i];
            if (rule.surface === toolName && wildcardMatch(rule.pattern, filePath)) {
              switch (rule.action) {
                case "allow": return undefined;
                case "ask": return await handleAsk(rule, toolName, filePath, ctx);
                case "deny": return await handleDeny(rule, toolName, filePath, ctx);
              }
            }
          }

          // Fall back to catch-all "*" rules (any surface)
          const defaultResult = evaluate("*", filePath, currentRuleset);
          switch (defaultResult.action) {
            case "allow": return undefined;
            case "ask": return await handleAsk(defaultResult, toolName, filePath, ctx);
            case "deny": return await handleDeny(defaultResult, toolName, filePath, ctx);
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
              return undefined;
            case "ask":
              return await handleAsk(result, toolName, command, ctx);
            case "deny":
              return await handleDeny(result, toolName, command, ctx);
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
