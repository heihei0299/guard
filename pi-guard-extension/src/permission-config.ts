/**
 * Permission configuration loader for pi-guard-extension.
 *
 * Loads permission config from pi-standard locations:
 *   1. Global: ~/.pi/agent/extensions/pi-guard/config.json
 *   2. Project: <projectRoot>/.pi/pi-guard.json
 *
 * Outputs raw (unmerged) config objects. Merging is done by the caller.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Permission-based configuration for the rule engine.
 *
 * The `permission` field uses the same schema as pi-permission-system:
 * - `"*"`: default action for all surfaces
 * - `"path"`, `"bash"`, `"read"`, `"write"`, `"edit"`, etc.: surface-specific rules
 * - Each surface value can be a string (applied to all patterns) or a
 *   Record<string, string | { action: string; reason?: string }>
 */
export interface PermissionConfig {
  permission?: Record<string, unknown>;
  /** Whether to auto-activate the rule engine after a skill completes. Default: true. */
  autoActivateAfterSkill?: boolean;
}

export interface PermissionConfigResult {
  global: PermissionConfig;
  project: PermissionConfig;
}

// ── Config file paths ────────────────────────────────────────────────────

/** Global config path (~/.pi/agent/extensions/pi-guard/config.json). */
function getGlobalConfigPath(): string {
  return join(homedir(), ".pi", "agent", "extensions", "pi-guard", "config.json");
}

/** Project config path (<projectRoot>/.pi/pi-guard.json). */
function getProjectConfigPath(projectRoot?: string): string | undefined {
  if (!projectRoot) return undefined;
  return join(projectRoot, ".pi", "pi-guard.json");
}

// ── JSON file reader ────────────────────────────────────────────────────

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    // Silently ignore malformed or missing files
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Load permission config from global and project locations.
 *
 * @param projectRoot - Optional project root directory for project-local config.
 *                      If omitted, project-local config is not loaded.
 * @returns Object with `global` and `project` configs. Missing/invalid files
 *          return empty objects (fail open, non-blocking).
 */
export function loadPermissionConfig(projectRoot?: string): PermissionConfigResult {
  const result: PermissionConfigResult = {
    global: {},
    project: {},
  };

  // Global config
  const globalPath = getGlobalConfigPath();
  const globalRaw = readJsonFile(globalPath);
  if (globalRaw) {
    result.global = globalRaw as unknown as PermissionConfig;
  }

  // Project config
  const projectPath = getProjectConfigPath(projectRoot);
  if (projectPath) {
    const projectRaw = readJsonFile(projectPath);
    if (projectRaw) {
      result.project = projectRaw as unknown as PermissionConfig;
    }
  }

  return result;
}
