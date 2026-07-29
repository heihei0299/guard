import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  createStateMachine,
  DEFAULT_TARGET_SKILLS,
  type GuardMachineOptions,
} from "./guard.ts";

// ── Exports ────────────────────────────────────────────────────────────

export type { GuardState, GuardMachine, GuardMachineOptions } from "./guard.ts";

export interface GuardExtensionOptions {
  /** List of skill names that trigger the guard. */
  targetSkills?: readonly string[];
}

/** Bilingual block message shown when an action is intercepted. */
const BLOCK_REASON = [
  "🔒 技能讨论已完成，禁止擅自操作。",
  "Guard mode: skill conversation completed, unauthorized actions blocked.",
  "请使用 /guard:allow 临时关闭守卫。",
  "Use /guard:allow to temporarily disable guard mode.",
].join("\n");

// ── Bash command classification ────────────────────────────────────────

const READONLY_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "less", "more", "wc",
  "grep", "ffgrep", "find", "ffind", "rg", "ag",
  "file", "stat", "du", "df", "which", "type",
  "echo", "printf",
  "ps", "top", "htop", "uptime", "date", "cal",
  "ping", "dig", "nslookup", "host",
  "curl",
]);

const WRITE_COMMANDS = new Set([
  "sed", "awk", "tee", "dd", "mkfs", "mount",
  "touch", "mkdir", "rmdir", "rm", "mv", "cp", "ln",
  "chmod", "chown", "chattr",
  "npm", "uv", "pip",
]);

const GIT_READONLY_SUBCOMMANDS = new Set([
  "log", "status", "diff", "show", "branch", "tag",
  "describe", "rev-parse", "ls-files",
]);

const GIT_WRITE_SUBCOMMANDS = new Set([
  "add", "commit", "push", "pull", "merge", "rebase",
  "reset", "checkout", "stash",
]);

/**
 * Determine whether a bash command is readonly (safe to allow in guarded mode).
 *
 * Strategy:
 * 1. If the command contains shell redirect operators (`>`, `>>`, `<`), classify as write.
 * 2. Check the first word against known readonly / write command sets.
 * 3. `git` subcommands are classified by their subcommand token.
 * 4. Default: return `false` (conservative — block when uncertain).
 */
export function isBashReadonly(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Redirect operators always indicate write intent
  if (/[<>]/.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/);
  const cmd = tokens[0];

  // Git subcommand classification
  if (cmd === "git" && tokens.length >= 2) {
    return isGitReadonly(tokens);
  }

  // Known readonly commands
  if (READONLY_COMMANDS.has(cmd)) return true;

  // Known write commands
  if (WRITE_COMMANDS.has(cmd)) {
    if ((cmd === "sed" || cmd === "awk") && !tokens.includes("-i")) {
      return true; // sed/awk without -i is readonly
    }
    return false;
  }

  // Conservative default: block unknown commands
  return false;
}

function isGitReadonly(tokens: string[]): boolean {
  const sub = tokens[1];

  if (GIT_READONLY_SUBCOMMANDS.has(sub)) {
    if (sub === "stash") {
      // git stash list is readonly; push/drop are write
      return tokens.length >= 3 && tokens[2] === "list";
    }
    if (sub === "branch") {
      // git branch with -d/-D is write
      return !(tokens.includes("-d") || tokens.includes("-D"));
    }
    if (sub === "tag") {
      // git tag with -d is write
      return !tokens.includes("-d");
    }
    return true;
  }

  if (GIT_WRITE_SUBCOMMANDS.has(sub)) {
    // `git stash list` is handled above, so all stash here is write
    return false;
  }

  // Unknown git subcommand → conservative: block
  return false;
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
        ctx.ui.notify(BLOCK_REASON, "warning");
      }

      // Abort the agent turn
      ctx.abort();

      return { block: true, reason: BLOCK_REASON };
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
