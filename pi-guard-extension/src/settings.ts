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

export interface PlanModeSettings {
  thinkingLevel: PlanModeThinkingLevel;
  defaultPlanTools?: string[];
  allowedPlanSubagents?: string[];
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

  // The safeSubcommands key was parsed but never enforced; configs that still
  // contain it are rejected as invalid instead of silently ignored.
  if (Object.hasOwn(value, "safeSubcommands")) {
    return undefined;
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
