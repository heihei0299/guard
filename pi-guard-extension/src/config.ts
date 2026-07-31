/**
 * @deprecated This module is being replaced by Guard Plan Mode modules.
 * Retained as a stub for backward compatibility during migration.
 * Will be removed when guard.ts and bash-command-classifier.ts are rewritten
 * in upcoming tickets.
 */

export interface GuardConfig {
  targetSkills: string[];
  allowWritePaths: string[];
  readonlyCommands: string[];
  writeCommands: string[];
  passthroughCommands: string[];
  gitReadonlySubcommands: string[];
  gitWriteSubcommands: string[];
}

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
    "mkdir",
  ],
  writeCommands: [
    "sed", "awk", "tee", "dd", "mkfs", "mount",
    "touch", "rmdir", "rm", "mv", "cp", "ln",
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

export const DEFAULT_TARGET_SKILLS: readonly string[] = DEFAULT_CONFIG.targetSkills;
export const DEFAULT_ALLOW_WRITE_PATHS: readonly string[] = DEFAULT_CONFIG.allowWritePaths;
