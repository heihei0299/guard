/**
 * Path normalization utilities for pi-guard-extension.
 *
 * Handles ~ expansion, path normalization, and generation of equivalent
 * path variants for policy matching.
 *
 * Design follows pi-permission-system's path-normalization.ts.
 *
 * @see https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system
 */

import { homedir } from "os";
import { resolve, isAbsolute } from "path";

// ── Home path expansion ──────────────────────────────────────────────────

/**
 * Expand ~ and $HOME in a path to the user's home directory.
 */
export function expandHomePath(path: string): string {
  const home = homedir();
  if (path.startsWith("~/")) return home + path.slice(1);
  if (path === "~") return home;
  if (path.startsWith("$HOME/")) return home + path.slice(5);
  if (path === "$HOME") return home;
  return path;
}

// ── Path literal normalization ───────────────────────────────────────────

/**
 * Normalize a path policy literal by:
 * 1. Trimming whitespace
 * 2. Stripping surrounding quotes ("...", '...')
 * 3. Stripping leading @ prefix (pi-permission-system convention)
 * 4. Expanding ~ and $HOME
 */
export function normalizePathPolicyLiteral(path: string): string {
  let result = path.trim();

  // Strip surrounding quotes
  if ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1);
  }

  // Strip @ prefix
  if (result.startsWith("@")) {
    result = result.slice(1);
  }

  // Expand home directory
  result = expandHomePath(result);

  return result;
}

// ── Path policy values ───────────────────────────────────────────────────

export interface GetPathPolicyValuesOptions {
  /** Current working directory (used for CWD relative path). */
  cwd?: string;
  /** Resolution base directory (default = cwd). Used in bash for cd targets. */
  resolveBase?: string;
}

/**
 * Get the list of equivalent path values for policy matching.
 *
 * Returns a deduplicated array containing:
 * - Absolute path (if path is relative, resolved against resolveBase or cwd)
 * - CWD-relative path (if path is under cwd)
 * - Literal path (original input after normalization)
 *
 * Does NOT resolve symlinks (Guard is not a security boundary).
 *
 * @param path - The path to generate values for.
 * @param options - Options including cwd and resolveBase.
 * @returns Deduplicated array of equivalent path strings.
 */
export function getPathPolicyValues(
  path: string,
  options: GetPathPolicyValuesOptions = {},
): string[] {
  const normalized = normalizePathPolicyLiteral(path);
  const cwd = options.cwd ?? process.cwd();
  const resolveBase = options.resolveBase ?? cwd;

  const values: string[] = [];

  // Absolute path (resolve relative paths against resolveBase)
  const absolutePath = isAbsolute(normalized)
    ? normalized
    : resolve(resolveBase, normalized);
  values.push(absolutePath);

  // CWD-relative path (if under cwd)
  if (absolutePath.startsWith(cwd + "/") || absolutePath === cwd) {
    const relative = absolutePath === cwd ? "." : absolutePath.slice(cwd.length + 1);
    if (!values.includes(relative)) {
      values.push(relative);
    }
  }

  // Literal path (original after normalization)
  if (!values.includes(normalized)) {
    values.push(normalized);
  }

  return values;
}
