/**
 * @deprecated This module is being replaced by Guard Plan Mode modules.
 * Retained as a stub for backward compatibility during migration.
 * Will be removed when index.ts and rule-engine.ts are rewritten
 * in upcoming tickets.
 */

import { homedir } from "os";
import { resolve, isAbsolute } from "path";

export function expandHomePath(path: string): string {
  const home = homedir();
  if (path.startsWith("~/")) return home + path.slice(1);
  if (path === "~") return home;
  if (path.startsWith("$HOME/")) return home + path.slice(5);
  if (path === "$HOME") return home;
  return path;
}

export interface GetPathPolicyValuesOptions {
  cwd?: string;
  resolveBase?: string;
}

export function getPathPolicyValues(
  path: string,
  options: GetPathPolicyValuesOptions = {},
): string[] {
  const normalized = path.trim();
  const cwd = options.cwd ?? process.cwd();
  const resolveBase = options.resolveBase ?? cwd;

  const values: string[] = [];

  const absolutePath = isAbsolute(normalized)
    ? normalized
    : resolve(resolveBase, normalized);
  values.push(absolutePath);

  if (absolutePath.startsWith(cwd + "/") || absolutePath === cwd) {
    const relative = absolutePath === cwd ? "." : absolutePath.slice(cwd.length + 1);
    if (!values.includes(relative)) {
      values.push(relative);
    }
  }

  if (!values.includes(normalized)) {
    values.push(normalized);
  }

  return values;
}
