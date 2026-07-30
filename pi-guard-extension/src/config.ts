/**
 * Configuration loader for pi-guard-extension.
 *
 * Loads and merges configuration from pi-standard locations:
 *   1. Default built-in values
 *   2. User-global: ~/.pi/agent/pi-guard.json
 *   3. Project-local: <projectRoot>/.pi/pi-guard.json
 *
 * Later sources override earlier ones (project overrides user, user overrides defaults).
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { resolve, join } from "path";

// ── Types ────────────────────────────────────────────────────────────────

export interface GuardConfig {
  /** Skill names that trigger the guard (without "/skill:" prefix). */
  targetSkills: string[];
  /** Paths allowed for write/replace in guarded mode.
   *  Directory entries (ending with "/") match by prefix or subpath;
   *  file entries match by exact filename or suffix. */
  allowWritePaths: string[];
  /** Bash commands considered read-only (safe in guarded mode). */
  readonlyCommands: string[];
  /** Bash commands considered write (blocked in guarded mode). */
  writeCommands: string[];
  /** Passthrough wrapper commands that delegate to an inner command. */
  passthroughCommands: string[];
  /** Git subcommands that are read-only. */
  gitReadonlySubcommands: string[];
  /** Git subcommands that are write. */
  gitWriteSubcommands: string[];
}

// ── Defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: GuardConfig = {
  targetSkills: ["to-spec", "to-tickets", "grill-me", "grill-with-docs", "wayfinder", "grilling"],
  allowWritePaths: [".scratch/", "docs/", "CONTEXT.md"],
  readonlyCommands: [
    "ls", "cat", "head", "tail", "less", "more", "wc",
    "grep", "ffgrep", "find", "ffind", "rg", "ag",
    "file", "stat", "du", "df", "which", "type",
    "echo", "printf",
    "ps", "top", "htop", "uptime", "date", "cal",
    "ping", "dig", "nslookup", "host",
    "curl",
  ],
  writeCommands: [
    "sed", "awk", "tee", "dd", "mkfs", "mount",
    "touch", "mkdir", "rmdir", "rm", "mv", "cp", "ln",
    "chmod", "chown", "chattr",
    "npm", "uv", "pip",
  ],
  passthroughCommands: ["rtk"],
  gitReadonlySubcommands: [
    "log", "status", "diff", "show", "branch", "tag",
    "describe", "rev-parse", "ls-files",
    "stash",
  ],
  gitWriteSubcommands: [
    "add", "commit", "push", "pull", "merge", "rebase",
    "reset", "checkout",
  ],
};

// ── Config file paths ────────────────────────────────────────────────────

/** User-global config path (~/.pi/agent/pi-guard.json). */
function getUserConfigPath(): string {
  return join(homedir(), ".pi", "agent", "pi-guard.json");
}

/** Project-local config path (<projectRoot>/.pi/pi-guard.json). */
function getProjectConfigPath(projectRoot?: string): string | undefined {
  if (!projectRoot) return undefined;
  return join(projectRoot, ".pi", "pi-guard.json");
}

// ── JSON file reader (returns partial object or null) ────────────────────

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Silently ignore malformed or missing files
    return null;
  }
}

// ── Merge helper ─────────────────────────────────────────────────────────

/**
 * Merge partial config into base config.
 * Only defined (non-undefined) keys in `partial` override `base`.
 * Array fields are replaced, not concatenated.
 */
function mergeConfig(base: GuardConfig, partial: Partial<GuardConfig>): GuardConfig {
  const merged = { ...base };
  for (const key of Object.keys(partial) as (keyof GuardConfig)[]) {
    const val = partial[key];
    if (val !== undefined) {
      (merged as any)[key] = val;
    }
  }
  return merged;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Load guard configuration from pi-standard locations.
 *
 * Resolution order (last wins):
 *   1. Built-in defaults
 *   2. ~/.pi/agent/pi-guard.json (user-global)
 *   3. <projectRoot>/.pi/pi-guard.json (project-local)
 *
 * @param projectRoot - Optional project root directory for project-local config.
 *                      If omitted, project-local config is not loaded.
 * @returns Merged GuardConfig
 */
export function loadGuardConfig(projectRoot?: string): GuardConfig {
  let config: GuardConfig = { ...DEFAULT_CONFIG };

  // User-global config
  const userConfigPath = getUserConfigPath();
  const userRaw = readJsonFile(userConfigPath);
  if (userRaw) {
    config = mergeConfig(config, userRaw as Partial<GuardConfig>);
  }

  // Project-local config
  const projectConfigPath = getProjectConfigPath(projectRoot);
  if (projectConfigPath) {
    const projectRaw = readJsonFile(projectConfigPath);
    if (projectRaw) {
      config = mergeConfig(config, projectRaw as Partial<GuardConfig>);
    }
  }

  return config;
}

/**
 * Resolve the project root from a working directory by looking for package.json.
 * Walks up from cwd until it finds package.json, or falls back to cwd.
 */
export function resolveProjectRoot(cwd?: string): string | undefined {
  const start = cwd ?? process.cwd();
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) return undefined; // Hit filesystem root
    dir = parent;
  }
  return undefined;
}

// ── Named exports for backward compatibility ───────────────────────────────

/** @deprecated Use DEFAULT_CONFIG.targetSkills instead. */
export const DEFAULT_TARGET_SKILLS: readonly string[] = DEFAULT_CONFIG.targetSkills;
/** @deprecated Use DEFAULT_CONFIG.allowWritePaths instead. */
export const DEFAULT_ALLOW_WRITE_PATHS: readonly string[] = DEFAULT_CONFIG.allowWritePaths;
