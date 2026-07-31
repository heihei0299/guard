/**
 * Guard Plan Mode tool policy — tool classification, bash safety, and path allowlisting.
 *
 * Provides three core functions used by Plan Mode's event handlers:
 * - `classifyPlanModeTool()` — five-category tool classification
 * - `isSafeCommand()` — bash command static analysis
 * - `isPathAllowed()` — path allowlist checking for write/replace tools
 */

import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isBuiltinTool } from "./tool-selection.ts";

// ── Constants ──────────────────────────────────────────────────────────────

/** Built-in tools that are safe to use in Plan Mode without restriction. */
export const SAFE_BUILTIN_PLAN_TOOLS = new Set([
  "read",
  "grep",
  "ffgrep",
  "find",
  "ffind",
  "fffind",
  "ls",
]);

/** Built-in tools whose file path argument is checked against the path allowlist. */
export const ALLOWLISTED_BUILTIN_TOOLS = new Set([
  "write",
  "replace",
]);

/** Built-in tools that are always blocked in Plan Mode. */
export const BLOCKED_BUILTIN_TOOLS = new Set([
  "edit",
  "update_plan",
]);

/** Known readonly commands that are always safe. */
export const READONLY_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "ls",
  "wc",
  "grep",
  "ffgrep",
  "find",
  "ffind",
  "rg",
  "ag",
  "file",
  "stat",
  "du",
  "df",
  "which",
  "type",
  "echo",
  "printf",
  "ps",
  "top",
  "htop",
  "uptime",
  "date",
  "cal",
  "ping",
  "dig",
  "nslookup",
  "host",
  "curl",
  "mkdir",
  "pwd",
  "sort",
  "uniq",
  "diff",
  "tree",
  "whereis",
  "printenv",
  "uname",
  "whoami",
  "id",
  "jq",
  "bat",
  "eza",
  "fd",
]);

/** Known dangerous commands that are always blocked. */
export const DANGEROUS_COMMANDS = new Set([
  "rm",
  "mv",
  "cp",
  "touch",
  "rmdir",
  "ln",
  "chmod",
  "chown",
  "chattr",
  "tee",
  "dd",
  "mkfs",
  "mount",
  "sed",
  "awk",
]);

/** Commands that are passthrough wrappers (skip and check inner command). */
export const PASSTHROUGH_COMMANDS = new Set([
  "rtk",
]);

/**
 * Structured commands with subcommand-level safety rules.
 * Each entry maps a base command to a set of safe subcommand prefixes.
 */
export const STRUCTURED_COMMANDS: Record<string, { safePrefixes: string[] }> = {
  git: {
    safePrefixes: [
      "log",
      "status",
      "diff",
      "show",
      "branch",
      "tag",
      "describe",
      "rev-parse",
      "ls-files",
      "stash list",
    ],
  },
  gh: {
    safePrefixes: [
      "pr view",
      "pr list",
      "issue view",
      "issue list",
      "search",
      "repo",
      "auth",
    ],
  },
  npm: {
    safePrefixes: [
      "list",
      "view",
      "info",
      "search",
      "outdated",
      "audit",
      "test",
      "run test",
      "run check",
      "run typecheck",
      "run lint",
    ],
  },
  npx: {
    safePrefixes: ["tsc --noEmit", "tsc --pretty", "tsc"],
  },
  node: {
    safePrefixes: ["--version"],
  },
  python: {
    safePrefixes: ["--version"],
  },
  python3: {
    safePrefixes: ["--version"],
  },
  cargo: {
    safePrefixes: ["test", "check"],
  },
  go: {
    safePrefixes: ["test", "check", "vet", "fmt"],
  },
  pytest: { safePrefixes: [""] },
  vitest: { safePrefixes: [""] },
  jest: { safePrefixes: [""] },
};

// ── Tool Policy ────────────────────────────────────────────────────────────

export type PlanModeToolPolicy =
  | "read-only"
  | "limited"
  | "allowlisted"
  | "blocked"
  | "user-opt-in";

/**
 * Classify a tool into one of five Plan Mode policy categories.
 *
 * - `read-only`: tools that are always safe (read, grep, find, ls)
 * - `limited`: tools with safety constraints (bash)
 * - `allowlisted`: tools whose path argument is checked against the allowlist (write, replace)
 * - `blocked`: tools that are always intercepted (edit, update_plan)
 * - `user-opt-in`: custom/user tools, disabled by default
 */
export function classifyPlanModeTool(tool: ToolInfo): PlanModeToolPolicy {
  if (!isBuiltinTool(tool)) return "user-opt-in";
  if (BLOCKED_BUILTIN_TOOLS.has(tool.name)) return "blocked";
  if (ALLOWLISTED_BUILTIN_TOOLS.has(tool.name)) return "allowlisted";
  if (tool.name === "bash") return "limited";
  if (SAFE_BUILTIN_PLAN_TOOLS.has(tool.name)) return "read-only";
  return "blocked";
}

// ── Bash Safety Policy ────────────────────────────────────────────────────

export interface SafeSubcommands {
  git?: string[];
  gh?: string[];
}

/**
 * Check if a bash command is safe to execute in Plan Mode.
 *
 * Performs static analysis on the command string:
 * 1. Splits compound commands (;, |, ||, &&) into segments
 * 2. Checks each segment for shell expansion, dangerous commands, redirects
 * 3. Allows structured commands (git, npm, npx, etc.) with subcommand safety
 * 4. Default: unsafe (conservative)
 */
export function isSafeCommand(command: string, _safeSubcommands?: SafeSubcommands): boolean {
  const trimmed = command.trim();
  if (!trimmed) return true;

  // Block newlines and backticks (subshell)
  if (trimmed.includes("\n")) return false;
  if (trimmed.includes("`")) return false;

  // Split into segments by ;, |, ||, &&
  const segments = splitShellSegments(trimmed);

  // All segments must be safe
  return segments.every((segment) => isSafeSegment(segment.trim()));
}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Split a command string into individual segments by shell separators.
 */
function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = i + 1 < command.length ? command[i + 1] : "";

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    // Only split on operators outside quotes
    if (!inSingleQuote && !inDoubleQuote) {
      // ; splits into separate segments
      if (ch === ";" && next !== ";") {
        segments.push(current);
        current = "";
        continue;
      }
      // && splits into separate segments
      if (ch === "&" && next === "&") {
        segments.push(current);
        current = "";
        i++; // skip next &
        continue;
      }
      // || splits into separate segments
      if (ch === "|" && next === "|") {
        segments.push(current);
        current = "";
        i++; // skip next |
        continue;
      }
      // | (pipe) splits into separate segments
      if (ch === "|" && next !== "|") {
        segments.push(current);
        current = "";
        continue;
      }
    }

    current += ch;
  }

  // Push the last segment
  if (current.trim()) {
    segments.push(current);
  }

  return segments;
}

/**
 * Check if a single command segment is safe.
 */
function isSafeSegment(segment: string): boolean {
  if (!segment) return true;

  // Block shell expansion characters
  if (/[\$\*\?\[\{]/.test(segment) && !isQuoted(segment)) {
    // But allow $ in /dev/null and &N patterns
    if (!segment.includes("/dev/null") && !segment.match(/&\d+/)) {
      return false;
    }
  }

  // Detect env var assignment at the start (KEY=value)
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment)) {
    return false;
  }

  // Check for < input redirect
  if (/[^&]<\s*\S/.test(segment) || /^<\s*\S/.test(segment)) {
    return false;
  }

  // Check for standalone & (not &&)
  if (/(?:^|\s)&(?:$|\s)/.test(segment) || segment.endsWith(" &")) {
    return false;
  }

  // Check for ( subshell
  if (segment.includes("(") || segment.includes(")")) {
    return false;
  }

  const tokens = tokenize(segment);
  if (tokens.length === 0) return true;

  const cmd = tokens[0];

  // Passthrough wrapper: skip and check inner command
  if (PASSTHROUGH_COMMANDS.has(cmd)) {
    const rest = tokens.slice(1).join(" ");
    return rest ? isSafeSegment(rest) : true;
  }

  // Check for dangerous redirects (> or >>)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === ">" || t === ">>") {
      if (i + 1 >= tokens.length) return false;
      const target = tokens[i + 1];
      if (target === "/dev/null" || target.startsWith("&")) continue;
      return false;
    }
    // Numbered redirect: N> or N>>
    if (/^\d+>$/.test(t) || /^\d+>>$/.test(t)) {
      if (i + 1 >= tokens.length) return false;
      const target = tokens[i + 1];
      if (target === "/dev/null" || target.startsWith("&")) continue;
      return false;
    }
    // Combined redirect+target: N>/dev/null, 2>&1, &>file
    const match = t.match(/^(\d+|&)(>|>>)(.+)$/);
    if (match) {
      const target = match[3];
      if (target !== "/dev/null" && !target.startsWith("&")) return false;
    }
  }

  // Known readonly commands
  if (READONLY_COMMANDS.has(cmd)) return true;

  // Known dangerous commands
  if (DANGEROUS_COMMANDS.has(cmd)) {
    // sed/awk without -i is readonly
    if ((cmd === "sed" || cmd === "awk") && !tokens.includes("-i")) {
      return true;
    }
    return false;
  }

  // Structured command check
  const rest = tokens.slice(1).join(" ");
  const struct = STRUCTURED_COMMANDS[cmd];
  if (struct) {
    return struct.safePrefixes.some((prefix) => {
      if (prefix === "") return true; // base command alone is safe
      return rest === prefix || rest.startsWith(prefix + " ");
    });
  }

  // Conservative default: block unknown commands
  return false;
}

/**
 * Basic tokenizer that respects quotes.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSQ = false;
  let inDQ = false;

  for (const ch of input) {
    if (ch === "'" && !inDQ) {
      inSQ = !inSQ;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSQ) {
      inDQ = !inDQ;
      current += ch;
      continue;
    }

    if (ch === " " && !inSQ && !inDQ) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Check if a segment is fully quoted (single or double).
 */
function isQuoted(segment: string): boolean {
  return (
    (segment.startsWith("'") && segment.endsWith("'")) ||
    (segment.startsWith('"') && segment.endsWith('"'))
  );
}

// ── Path Allowlist ────────────────────────────────────────────────────────

/** Default paths that are allowed for write/replace in Plan Mode. */
export const DEFAULT_ALLOW_WRITE_PATHS = [
  ".scratch/",
  "docs/",
  "CONTEXT.md",
];

/**
 * Check if a file path is in the Plan Mode path allowlist.
 *
 * Directory-type entries (.scratch/, docs/) match by prefix AND subpath
 * (startsWith or includes /<dir>/).
 * File-type entries (CONTEXT.md) match by exact or suffix (endsWith /<filename>).
 * Leading ./ is normalized, ~ is expanded via os.homedir().
 *
 * @param path - The file path to check
 * @param allowlist - Optional custom allowlist (defaults to DEFAULT_ALLOW_WRITE_PATHS)
 */
export function isPathAllowed(path: string, allowlist?: string[]): boolean {
  if (!path) return false;

  const list = allowlist ?? DEFAULT_ALLOW_WRITE_PATHS;

  // Normalize leading ./
  let normalized = path.startsWith("./") ? path.slice(2) : path;

  // Expand ~ to home directory
  if (normalized.startsWith("~/")) {
    normalized = homedir() + normalized.slice(1);
  } else if (normalized === "~") {
    normalized = homedir();
  }

  for (const entry of list) {
    if (entry.endsWith("/")) {
      // Directory-type: match by prefix AND subpath
      // A directory entry like ".scratch/" should match:
      // - ".scratch/foo/bar.md" (prefix)
      // - "/abs/project/.scratch/ticket.md" (subpath containing "/.scratch/")
      // The normalized entry (without leading ./)
      const dirEntry = entry.startsWith("./") ? entry.slice(2) : entry;
      if (
        normalized.startsWith(dirEntry) ||
        normalized.includes("/" + dirEntry)
      ) {
        return true;
      }
    } else {
      // File-type: match by exact or suffix
      if (
        normalized === entry ||
        normalized.endsWith("/" + entry)
      ) {
        return true;
      }
    }
  }

  return false;
}
