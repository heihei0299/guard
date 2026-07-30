/**
 * Bash path allowlist for pi-guard-extension.
 *
 * Second-stage check for write-classified bash commands in guarded mode.
 * After `isBashReadonly()` returns `false`, this function extracts literal
 * path arguments from supported write commands and checks them against an
 * allowlist. If all required paths are in the allowlist, the command is
 * allowed (returns `true`).
 *
 * Never invokes on readonly commands, git commands, or unknown commands —
 * those are filtered by the caller.
 */

import { homedir } from "os";

// ── Always-blocked commands ─────────────────────────────────────────────
const ALWAYS_BLOCKED = new Set([
  "tee",
  "ln",
  "chmod",
  "chown",
  "dd",
  "fallocate",
  "sudo",
  "doas",
]);

// ── Path validation ──────────────────────────────────────────────────────

/**
 * Check if a token is a literal file path (not a variable, glob, or brace).
 * Literal ≈ no shell metacharacters that prevent us from knowing the path.
 * Exception: a leading `~` is allowed and expanded.
 */
function isLiteralPath(token: string): boolean {
  // Allow leading ~
  const rest = token.startsWith("~") ? token.slice(1) : token;
  // Reject if contains any shell metacharacters
  return !/[`$*?[\]{}]/.test(rest);
}

/**
 * Normalize a path token:
 * - Remove leading `./`
 * - Expand leading `~` to home directory
 */
function normalizePath(token: string): string {
  let normalized = token.startsWith("./") ? token.slice(2) : token;
  if (normalized.startsWith("~")) {
    const home = homedir();
    normalized = normalized === "~" ? home : home + normalized.slice(1);
  }
  return normalized;
}

/**
 * Check if a single normalized path is in the allowlist.
 */
function isPathInAllowlist(normalizedPath: string, allowWritePaths: string[]): boolean {
  for (const allowed of allowWritePaths) {
    if (allowed.endsWith("/")) {
      // Directory-type: prefix match or subpath match
      if (
        normalizedPath.startsWith(allowed) ||
        normalizedPath.includes("/" + allowed)
      ) {
        return true;
      }
    } else {
      // File-type: exact match or suffix match
      if (normalizedPath === allowed || normalizedPath.endsWith("/" + allowed)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get all non-flag tokens from a token list.
 */
function getNonFlagTokens(tokens: string[], startIndex: number = 1): string[] {
  const result: string[] = [];
  for (let i = startIndex; i < tokens.length; i++) {
    const t = tokens[i];
    // Skip redirect operator and its target — handled separately
    if (t === ">" || t === ">>") {
      i++; // skip the path after redirect
      continue;
    }
    if (t.startsWith("-")) {
      // Skip flags — they are not path arguments.
      // Conservative: flag values (e.g., -name foo) are also skipped,
      // which may miss a match but won't mistakenly allow a path.
      continue;
    }
    // Stop at shell operators — don't process expressions after them
    if (["&&", "||", ";", "|", "&"].includes(t)) {
      break;
    }
    result.push(t);
  }
  return result;
}

/**
 * Determine whether a bash command with literal paths should be allowed
 * based on the path allowlist.
 *
 * @param command - The full bash command string (after isBashReadonly returned false)
 * @param allowWritePaths - List of allowed path prefixes/files
 * @returns `true` if the command should be allowed, `false` if blocked
 */
export function isBashPathAllowed(command: string, allowWritePaths: string[]): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  const tokens = trimmed.split(/\s+/);
  const cmd = tokens[0];

  // ── Always-blocked commands ──────────────────────────────────────
  if (ALWAYS_BLOCKED.has(cmd)) return false;
  if ((cmd === "sed" || cmd === "awk") && tokens.includes("-i")) return false;

  // ── Redirect-based commands (>, >>) ───────────────────────────────
  // Extract the path after the last redirect operator and check it.
  // This handles patterns like `echo hi > docs/out.md`.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === ">" || t === ">>") {
      if (i + 1 < tokens.length) {
        const redirectPath = tokens[i + 1];
        if (!isLiteralPath(redirectPath)) return false;
        const normalized = normalizePath(redirectPath);
        if (!isPathInAllowlist(normalized, allowWritePaths)) return false;
        // If redirect path is allowlisted, this check passes.
        // Continue checking other path args below.
      }
    }
  }

  // ── Command-specific path extraction ─────────────────────────────
  const nonFlagTokens = getNonFlagTokens(tokens);

  // If no non-flag tokens found, check if we already passed via redirect
  if (nonFlagTokens.length === 0) {
    // If we had a redirect and it passed above, allow
    if (tokens.includes(">") || tokens.includes(">>")) return true;
    // If command is known to need paths but none given, block
    if (cmd === "mkdir" || cmd === "touch" || cmd === "rm" || cmd === "mv" || cmd === "cp") {
      return false;
    }
    // Unknown write command — conservative block
    return false;
  }

  if (cmd === "mkdir") {
    // mkdir -p docs/a — all non-flag args must be in allowlist
    for (const p of nonFlagTokens) {
      if (!isLiteralPath(p)) return false;
      const normalized = normalizePath(p);
      if (!isPathInAllowlist(normalized, allowWritePaths)) return false;
    }
    return true;
  }

  if (cmd === "touch" || cmd === "rm") {
    // All non-flag args must be in allowlist
    for (const p of nonFlagTokens) {
      if (!isLiteralPath(p)) return false;
      const normalized = normalizePath(p);
      if (!isPathInAllowlist(normalized, allowWritePaths)) return false;
    }
    return true;
  }

  if (cmd === "mv") {
    // All non-flag args (source + target) must be in allowlist
    for (const p of nonFlagTokens) {
      if (!isLiteralPath(p)) return false;
      const normalized = normalizePath(p);
      if (!isPathInAllowlist(normalized, allowWritePaths)) return false;
    }
    return true;
  }

  if (cmd === "cp") {
    // All non-flag args EXCEPT the LAST (target) must be in allowlist
    const sources = nonFlagTokens.slice(0, -1);
    if (sources.length === 0) return false;
    for (const p of sources) {
      if (!isLiteralPath(p)) return false;
      const normalized = normalizePath(p);
      if (!isPathInAllowlist(normalized, allowWritePaths)) return false;
    }
    return true;
  }

  // For commands with redirect that we didn't handle above, we already
  // checked the redirect path above. If redirect path is ok, allow.
  if (tokens.includes(">") || tokens.includes(">>")) return true;

  // ── Unknown write command — conservative: block ──────────────────
  return false;
}
