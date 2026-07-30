/**
 * Bash command classification for pi-guard-extension.
 *
 * Determines whether a bash command string is readonly (safe to allow
 * in guarded mode) or write (must be blocked).
 *
 * Strategy:
 * 1. If the command contains shell redirect operators (`>`, `>>`, `<`), classify as write.
 * 2. If the first token is a passthrough wrapper (e.g. `rtk`), skip it and
 *    recursively check the inner command.
 * 3. Check the first word against known readonly / write command sets.
 * 4. `git` subcommands are classified by their subcommand token.
 * 5. Default: return `false` (conservative — block when uncertain).
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface BashClassifierConfig {
  readonlyCommands: readonly string[];
  writeCommands: readonly string[];
  passthroughCommands: readonly string[];
  gitReadonlySubcommands: readonly string[];
  gitWriteSubcommands: readonly string[];
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a bash readonly classifier from the given configuration.
 *
 * The returned function checks whether a bash command is readonly
 * (safe to allow in guarded mode).
 */
export function createBashClassifier(config: BashClassifierConfig): (command: string) => boolean {
  const readonlySet = new Set(config.readonlyCommands);
  const writeSet = new Set(config.writeCommands);
  const passthroughSet = new Set(config.passthroughCommands);
  const gitReadonlySet = new Set(config.gitReadonlySubcommands);
  const gitWriteSet = new Set(config.gitWriteSubcommands);

  /**
   * Classify a git command string as readonly or write based on its subcommand.
   */
  function isGitReadonly(tokens: string[]): boolean {
    const sub = tokens[1];

    if (gitReadonlySet.has(sub)) {
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

    if (gitWriteSet.has(sub)) {
      return false;
    }

    // Unknown git subcommand → conservative: block
    return false;
  }

  /**
   * Determine whether a bash command is readonly (safe to allow in guarded mode).
   *
   * @param command - The full bash command string to classify.
   * @returns `true` if the command is readonly, `false` if it should be blocked.
   */
  return function isBashReadonly(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) return false;

    const tokens = trimmed.split(/\s+/);

    // Check for output redirects that target real files (not /dev/null, not &N).
    // This replaces the previous naive /[<>]/ regex which falsely flagged
    // harmless patterns like `2>/dev/null`, `2>&1`, and `< input.txt`.
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // Standalone > or >> : output redirect
      if (t === ">" || t === ">>") {
        if (i + 1 >= tokens.length) return false;
        const target = tokens[i + 1];
        if (target !== "/dev/null" && !target.startsWith("&")) return false;
        continue;
      }
      // Numbered redirect as separate token: N> or N>> (e.g., "2>>" "error.log")
      if (/^\d+>$/.test(t) || /^\d+>>$/.test(t)) {
        if (i + 1 >= tokens.length) return false;
        const target = tokens[i + 1];
        if (target !== "/dev/null" && !target.startsWith("&")) return false;
        continue;
      }
      // Combined redirect+path: N>/dev/null, 2>&1, &>file, etc.
      const match = t.match(/^(\d+|&)(>|>>)(.+)$/);
      if (match) {
        const target = match[3];
        if (target !== "/dev/null" && !target.startsWith("&")) return false;
      }
    }
    const cmd = tokens[0];

    // Passthrough wrapper: skip and check inner command
    if (passthroughSet.has(cmd)) {
      const rest = tokens.slice(1).join(" ");
      return rest ? isBashReadonly(rest) : false;
    }

    // Git subcommand classification
    if (cmd === "git" && tokens.length >= 2) {
      return isGitReadonly(tokens);
    }

    // Known readonly commands
    if (readonlySet.has(cmd)) return true;

    // Known write commands
    if (writeSet.has(cmd)) {
      if ((cmd === "sed" || cmd === "awk") && !tokens.includes("-i")) {
        return true; // sed/awk without -i is readonly
      }
      return false;
    }

    // Conservative default: block unknown commands
    return false;
  };
}

// ── Backward-compatible default instance ──────────────────────────────────

import { DEFAULT_CONFIG } from "./config.ts";

/** Default isBashReadonly using built-in configuration. */
export const isBashReadonly = createBashClassifier(DEFAULT_CONFIG);
