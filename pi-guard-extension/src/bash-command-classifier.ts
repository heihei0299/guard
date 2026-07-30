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

// ── Command classification sets ───────────────────────────────────────

const READONLY_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "less", "more", "wc",
  "grep", "ffgrep", "find", "ffind", "rg", "ag",
  "file", "stat", "du", "df", "which", "type",
  "echo", "printf",
  "ps", "top", "htop", "uptime", "date", "cal",
  "ping", "dig", "nslookup", "host",
  "curl",
]);

const PASSTHROUGH_COMMANDS = new Set([
  "rtk",
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
  "stash",
]);

const GIT_WRITE_SUBCOMMANDS = new Set([
  "add", "commit", "push", "pull", "merge", "rebase",
  "reset", "checkout",
]);

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Classify a git command string as readonly or write based on its subcommand.
 */
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
    return false;
  }

  // Unknown git subcommand → conservative: block
  return false;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Determine whether a bash command is readonly (safe to allow in guarded mode).
 *
 * @param command - The full bash command string to classify.
 * @returns `true` if the command is readonly, `false` if it should be blocked.
 */
export function isBashReadonly(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Redirect operators always indicate write intent
  if (/[<>]/.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/);
  const cmd = tokens[0];

  // Passthrough wrapper: skip and check inner command
  if (PASSTHROUGH_COMMANDS.has(cmd)) {
    const rest = tokens.slice(1).join(" ");
    return rest ? isBashReadonly(rest) : false;
  }

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
