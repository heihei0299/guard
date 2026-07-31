/**
 * Guard Plan Mode settings — config shape validation and file loading.
 *
 * Settings are read from `~/.pi/agent/pi-guard.json` or an explicitly provided path.
 * Validates the JSON shape and returns a typed PlanModeSettings object.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const PLAN_MODE_SETTINGS_FILE = "pi-guard.json";

export const PLAN_MODE_THINKING_LEVELS = [
  "inherit",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type PlanModeThinkingLevel = (typeof PLAN_MODE_THINKING_LEVELS)[number];
export type PlanModeFixedThinkingLevel = Exclude<PlanModeThinkingLevel, "inherit">;

export const SAFE_GIT_SUBCOMMANDS = [
  "log",
  "status",
  "diff",
  "show",
  "branch",
  "tag",
  "describe",
  "rev-parse",
  "ls-files",
  "stash",
] as const;

export const SAFE_GH_SUBCOMMAND_PATHS = [
  "pr",
  "issue",
  "search",
  "repo",
  "auth",
] as const;

export type SafeGitSubcommand = (typeof SAFE_GIT_SUBCOMMANDS)[number];
export type SafeGhSubcommandPath = (typeof SAFE_GH_SUBCOMMAND_PATHS)[number];

export interface SafeSubcommands {
  git?: SafeGitSubcommand[];
  gh?: SafeGhSubcommandPath[];
}

export interface PlanModeSettings {
  thinkingLevel: PlanModeThinkingLevel;
  defaultPlanTools?: string[];
  allowedPlanSubagents?: string[];
  safeSubcommands?: SafeSubcommands;
}

export type PlanModeSettingsLoadResult =
  | { kind: "missing"; notice?: string }
  | { kind: "invalid"; reason: string; notice?: string }
  | { kind: "loaded"; settings: PlanModeSettings; notice?: string };

/**
 * Validate and normalize a raw config object into PlanModeSettings.
 * Returns undefined if the shape is invalid.
 */
export function normalizePlanModeSettings(value: unknown): PlanModeSettings | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const thinkingLevel = Object.hasOwn(value, "thinkingLevel")
    ? Reflect.get(value, "thinkingLevel")
    : "inherit";

  if (!PLAN_MODE_THINKING_LEVELS.includes(thinkingLevel as PlanModeThinkingLevel)) {
    return undefined;
  }

  const settings: PlanModeSettings = {
    thinkingLevel: thinkingLevel as PlanModeThinkingLevel,
  };

  if (Object.hasOwn(value, "defaultPlanTools")) {
    const defaultPlanTools = normalizeStringArray(Reflect.get(value, "defaultPlanTools"));
    if (!defaultPlanTools) return undefined;
    settings.defaultPlanTools = defaultPlanTools;
  }

  if (Object.hasOwn(value, "allowedPlanSubagents")) {
    const allowedPlanSubagents = normalizeStringArray(Reflect.get(value, "allowedPlanSubagents"));
    if (!allowedPlanSubagents) return undefined;
    settings.allowedPlanSubagents = allowedPlanSubagents;
  }

  if (Object.hasOwn(value, "safeSubcommands")) {
    const safeSubcommands = normalizeSafeSubcommands(Reflect.get(value, "safeSubcommands"));
    if (!safeSubcommands) return undefined;
    settings.safeSubcommands = safeSubcommands;
  }

  return settings;
}

/**
 * Load and normalize PlanModeSettings from a JSON file.
 *
 * @param settingsPath - Optional explicit path. If omitted, uses getAgentDir() + "pi-guard.json"
 * @returns A PlanModeSettingsLoadResult describing the outcome
 */
export async function readPlanModeSettings(
  settingsPath?: string,
): Promise<PlanModeSettingsLoadResult> {
  const path = settingsPath ?? join(getAgentDir(), PLAN_MODE_SETTINGS_FILE);

  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "invalid", reason: formatError(error) };
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    const settings = normalizePlanModeSettings(parsed);
    return settings
      ? { kind: "loaded", settings }
      : { kind: "invalid", reason: "invalid settings shape" };
  } catch (error: unknown) {
    return { kind: "invalid", reason: formatError(error) };
  }
}

/**
 * Get a fixed (non-inherit) thinking level from settings, or undefined if inherit.
 */
export function configuredThinkingLevel(
  settings: PlanModeSettings,
): PlanModeFixedThinkingLevel | undefined {
  return settings.thinkingLevel === "inherit" ? undefined : settings.thinkingLevel;
}

// ── Internal helpers ──────────────────────────────────────────────────────

function normalizeStringArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === "string" && item.trim().length > 0)
  ) {
    return undefined;
  }
  return Array.from(new Set(value));
}

function normalizeSafeSubcommands(value: unknown): SafeSubcommands | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const allowedKeys = new Set(["git", "gh"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return undefined;

  const safeSubcommands: SafeSubcommands = {};

  if (Object.hasOwn(value, "git")) {
    const git = normalizeKnownValues(Reflect.get(value, "git"), SAFE_GIT_SUBCOMMANDS as unknown as readonly string[]);
    if (!git) return undefined;
    safeSubcommands.git = git as SafeGitSubcommand[];
  }

  if (Object.hasOwn(value, "gh")) {
    const gh = normalizeKnownValues(Reflect.get(value, "gh"), SAFE_GH_SUBCOMMAND_PATHS as unknown as readonly string[]);
    if (!gh) return undefined;
    safeSubcommands.gh = gh as SafeGhSubcommandPath[];
  }

  return safeSubcommands;
}

function normalizeKnownValues(
  value: unknown,
  supported: readonly string[],
): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === "string" && supported.includes(item))
  ) {
    return undefined;
  }
  return Array.from(new Set(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
